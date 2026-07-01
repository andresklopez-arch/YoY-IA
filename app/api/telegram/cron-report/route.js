import { NextResponse } from 'next/server';
import { db } from '@/lib/firebase';
import { doc, getDoc, setDoc, getDocs, collection, query, where, orderBy, limit } from 'firebase/firestore';

function hashPhone(phone) {
  if (!phone) return '';
  const clean = phone.replace(/\D/g, '');
  let hash = 0;
  for (let i = 0; i < clean.length; i++) {
    const char = clean.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16);
}

function obfuscatePhone(phone) {
  if (!phone) return null;
  const clean = phone.replace(/\D/g, '');
  if (clean.length <= 4) return `+${clean}`;
  const start = clean.slice(0, 2);
  const end = clean.slice(-4);
  return `+${start}******${end}`;
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const force = searchParams.get('force') === 'true';

    // 1. Cargar la configuración de Telegram
    const tgSnap = await getDoc(doc(db, 'config', 'telegram'));
    if (!tgSnap.exists()) {
      return NextResponse.json({ 
        success: false, 
        error: 'Telegram no está configurado. Por favor, ve a la pestaña "Configuración" en el panel de Administración, ingresa los datos de Telegram (ej. Modo Simplificado y tu teléfono) y haz clic en "Guardar".' 
      }, { status: 404 });
    }
    const tgConfig = tgSnap.data();
    if (!tgConfig.enabled) {
      return NextResponse.json({ 
        success: false, 
        error: 'Las alertas de Telegram están desactivadas. Actívalas seleccionando "Habilitar Alertas" en la pestaña "Configuración" del panel de Administración y guarda los cambios.' 
      });
    }

    // Si no está activado el reporte periódico y no es un envío forzado, omitir
    if (!tgConfig.notifyPeriodicReport && !force) {
      return NextResponse.json({ success: false, error: 'Reporte periódico de Telegram desactivado en la configuración' });
    }

    const stateRef = doc(db, 'config', 'telegram_report_state');
    const stateSnap = await getDoc(stateRef);
    const now = Date.now();
    const mxDateStr = new Date().toLocaleString('sv-SE', { timeZone: 'America/Mexico_City' }).split(' ')[0];

    let history = [];
    let currentDate = mxDateStr;

    if (stateSnap.exists()) {
      const stateData = stateSnap.data();
      currentDate = stateData.currentDate || mxDateStr;
      if (currentDate === mxDateStr) {
        history = stateData.history || [];
      } else {
        history = [];
        currentDate = mxDateStr;
      }
    }

    if (!force) {
      if (stateSnap.exists()) {
        const lastSentAt = stateSnap.data().lastSentAt || 0;
        const diffMs = now - lastSentAt;
        const targetInterval = 1.5 * 60 * 60 * 1000; // 1.5 horas en milisegundos
        
        if (diffMs < targetInterval) {
          const remainingMins = Math.round((targetInterval - diffMs) / 60000);
          return NextResponse.json({ 
            success: true, 
            skipped: true, 
            reason: `Faltan ${remainingMins} minutos para el siguiente reporte periódico.` 
          });
        }
      }
    }

    // 2. Recopilar datos en tiempo real para las 10 métricas operativas

    // Métrica 1: Ocupación Actual
    let activeMesas = 0;
    let totalMesas = 0;
    let mesasEstado = [];
    const mesasSnap = await getDoc(doc(db, 'config', 'mesas_estado'));
    if (mesasSnap.exists()) {
      mesasEstado = mesasSnap.data().mesas || [];
      totalMesas = mesasEstado.length;
      activeMesas = mesasEstado.filter(m => m.estado === 'ocupada').length;
    }
    const ocupacionPct = totalMesas > 0 ? Math.round((activeMesas / totalMesas) * 100) : 0;

    // Métrica 2: Monto Vendido Hoy (Bitácora de cobros)
    const qBitacora = query(
      collection(db, 'bitacora'),
      where('fecha', '>=', mxDateStr + 'T00:00:00'),
      where('fecha', '<=', mxDateStr + 'T23:59:59.999Z')
    );
    const snapBitacora = await getDocs(qBitacora);
    let montoVendido = 0;
    snapBitacora.forEach(d => {
      const e = d.data();
      const acc = e.accion;
      if (acc === 'Cierre Directo' || acc === 'Mesa a Cuenta' || acc === 'Cobro Manual' || acc === 'Venta Barra' || acc === 'Cobro Barra' || acc === 'Clientes - Suscripción' || acc === 'Torneos - Registro') {
        if (e.monto && Number(e.monto) > 0) {
          montoVendido += Number(e.monto);
        }
      }
    });

    // Métrica 3: Meta de Ingresos Diaria
    let metaMensual = 100000;
    const sucursalSnap = await getDoc(doc(db, 'config', 'sucursal'));
    if (sucursalSnap.exists()) {
      metaMensual = Number(sucursalSnap.data().metaMensual) || 100000;
    }
    const metaDiaria = metaMensual / 30;
    const avanceMetaPct = metaDiaria > 0 ? Math.round((montoVendido / metaDiaria) * 100) : 0;

    // Métrica 4: Trabajadores en Turno
    const qAsist = query(
      collection(db, 'nomina_asistencia_log'),
      where('fecha', '==', mxDateStr)
    );
    const snapAsist = await getDocs(qAsist);
    const lastStatusByWorker = {};
    snapAsist.forEach(d => {
      const data = d.data();
      const empId = data.empleadoId;
      const time = data.createdAt?.toDate ? data.createdAt.toDate().getTime() : 0;
      if (!lastStatusByWorker[empId] || time > lastStatusByWorker[empId].time) {
        lastStatusByWorker[empId] = { tipo: data.tipo, name: data.nombre, time };
      }
    });
    const presentWorkers = Object.values(lastStatusByWorker).filter(w => w.tipo === 'entrada');
    const presentWorkersCount = presentWorkers.length;
    const presentWorkersNames = presentWorkers.map(w => w.name).join(', ') || 'Ninguno';

    // Métrica 5: Clientes en Fila de Espera
    const qFila = query(collection(db, 'fila_espera'), where('estado', '==', 'espera'));
    const snapFila = await getDocs(qFila);
    const clientesEsperaCount = snapFila.size;

    // Métrica 6: Mesa con Mayor Consumo Actual (Renta acumulada + consumos)
    let mesaMayorConsumoNombre = 'Ninguna';
    let mesaMayorConsumoTotal = 0;
    const cuentasSnap = await getDoc(doc(db, 'config', 'cuentas_estado'));
    if (cuentasSnap.exists()) {
      const listCuentas = cuentasSnap.data().cuentas || [];
      listCuentas.forEach(c => {
        const mesa = mesasEstado.find(m => m.id === c.mesaId);
        if (mesa && mesa.estado === 'ocupada') {
          let totalRenta = 0;
          if (mesa.inicio) {
            const horas = (Date.now() - mesa.inicio) / 3600000;
            totalRenta = horas * (mesa.tarifa || 60);
          }
          const totalConsumos = (c.consumos || []).reduce((sum, item) => sum + (item.precio * item.cantidad), 0);
          const totalMesa = totalRenta + totalConsumos;
          if (totalMesa > mesaMayorConsumoTotal) {
            mesaMayorConsumoTotal = totalMesa;
            mesaMayorConsumoNombre = mesa.nombre || `Mesa ${mesa.id}`;
          }
        }
      });
    }

    // Métrica 7: Gastos del Día
    const qGastos = query(
      collection(db, 'gastos'),
      where('fecha', '>=', mxDateStr + 'T00:00:00'),
      where('fecha', '<=', mxDateStr + 'T23:59:59.999Z')
    );
    const snapGastos = await getDocs(qGastos);
    let totalGastos = 0;
    snapGastos.forEach(d => {
      const data = d.data();
      if (data.monto) {
        totalGastos += Number(data.monto);
      }
    });

    // Métrica 8: Comandas Cocina Pendientes
    const qComandas = query(
      collection(db, 'mesa_pedidos'),
      where('tipo', '==', 'pedido'),
      where('estado', '==', 'pendiente')
    );
    const snapComandas = await getDocs(qComandas);
    const comandasPendientesCount = snapComandas.size;

    // Métrica 9: Alertas y Desviaciones
    const desviaciones = [];
    const mesasSinAtender = [];
    if (cuentasSnap.exists()) {
      const listCuentas = cuentasSnap.data().cuentas || [];
      mesasEstado.forEach(m => {
        if (m.estado !== 'ocupada' || !m.inicio) return;
        const elapsedMin = (Date.now() - m.inicio) / 60000;
        if (elapsedMin < 15) return;
        const cuenta = listCuentas.find(c => c.mesaId === m.id);
        let needsAlert = false;
        if (!cuenta || !cuenta.consumos || cuenta.consumos.length === 0) {
          needsAlert = true;
        } else {
          const lastTime = cuenta.consumos.reduce((max, item) => Math.max(max, item.timestamp || 0), m.inicio);
          if ((Date.now() - lastTime) / 60000 > 15) {
            needsAlert = true;
          }
        }
        if (needsAlert) {
          mesasSinAtender.push(m.nombre || `Mesa ${m.id}`);
        }
      });
    }
    const mesasExcesivas = mesasEstado.filter(m => {
      if (m.estado !== 'ocupada' || !m.inicio) return false;
      const elapsedHrs = (Date.now() - m.inicio) / 3600000;
      return elapsedHrs > 4 && !m.preTicketImpreso;
    }).map(m => m.nombre || `Mesa ${m.id}`);

    let demoradasCount = 0;
    snapComandas.forEach(d => {
      const s = d.data();
      if (s.createdAt) {
        const elapsedMin = (Date.now() - s.createdAt) / 60000;
        if (elapsedMin > 20) {
          demoradasCount++;
        }
      }
    });

    if (mesasSinAtender.length > 0) {
      desviaciones.push(`⚠️ Mesas sin atención (>15m): ${mesasSinAtender.join(', ')}`);
    }
    if (mesasExcesivas.length > 0) {
      desviaciones.push(`⚠️ Tiempo excesivo juego (>4h): ${mesasExcesivas.join(', ')}`);
    }
    if (demoradasCount > 0) {
      desviaciones.push(`⚠️ Pedidos demorados cocina (>20m): ${demoradasCount}`);
    }
    if (presentWorkersCount === 0 && activeMesas > 0) {
      desviaciones.push(`⚠️ Alerta: Billar operando sin personal fichado hoy.`);
    }
    const desviacionesStr = desviaciones.length > 0 ? desviaciones.join('\n') : 'Ninguna desviación detectada. Operación estable.';

    // Métrica 10: Último Corte de Caja
    const qCortes = query(
      collection(db, 'cortes_caja'),
      orderBy('fecha', 'desc'),
      limit(1)
    );
    const snapCortes = await getDocs(qCortes);
    let corteCajaStatus = 'Sin cortes de caja recientes';
    if (!snapCortes.empty) {
      const c = snapCortes.docs[0].data();
      const diff = Number(c.diferencia || 0);
      corteCajaStatus = diff === 0 ? 'Caja cuadrada ✓' : `Descuadre de $${diff.toFixed(2)} MXN`;
    }

    // Formatear hora de la CDMX para el punto en el gráfico
    const currentTimeStr = new Date().toLocaleString('es-MX', { 
      timeZone: 'America/Mexico_City', 
      hour: '2-digit', 
      minute: '2-digit', 
      hour12: false 
    });

    // Evitar duplicados del mismo minuto en el historial
    if (history.length === 0 || history[history.length - 1].time !== currentTimeStr) {
      history.push({
        time: currentTimeStr,
        sales: Math.round(montoVendido),
        occupancy: Math.round(ocupacionPct)
      });
    }

    // Limitar historial diario a 30 cortes máximo
    if (history.length > 30) {
      history.shift();
    }

    // 3. Ensamblar y enviar el reporte por Telegram
    const branchName = sucursalSnap.exists() ? (sucursalSnap.data().nombre || 'YoY Billar') : 'YoY Billar';
    const reportText = `📊 *REPORTE DE OPERACIÓN - ${branchName.toUpperCase()}* 📊\n` +
      `🕒 *Hora:* ${new Date().toLocaleString('es-MX', { timeZone: 'America/Mexico_City', hour12: true })}\n\n` +
      `1️⃣ *Ocupación Actual:* ${ocupacionPct}% (${activeMesas}/${totalMesas} mesas ocupadas)\n` +
      `2️⃣ *Monto Vendido Hoy:* $${montoVendido.toLocaleString('es-MX')} MXN\n` +
      `3️⃣ *Avance de Meta:* Meta mensual: $${metaMensual.toLocaleString('es-MX')} MXN (Meta diaria: $${Math.round(metaDiaria).toLocaleString('es-MX')} MXN). Avance hoy: *${avanceMetaPct}%*\n` +
      `4️⃣ *Trabajadores en Turno:* ${presentWorkersCount} activo(s) (${presentWorkersNames})\n` +
      `5️⃣ *Clientes en Espera:* ${clientesEsperaCount} en fila\n` +
      `6️⃣ *Mayor Renta Activa:* ${mesaMayorConsumoNombre} ($${Math.round(mesaMayorConsumoTotal).toLocaleString('es-MX')} MXN)\n` +
      `7️⃣ *Gastos de Hoy:* $${totalGastos.toLocaleString('es-MX')} MXN\n` +
      `8️⃣ *Pedidos Cocina:* ${comandasPendientesCount} comandas pendientes\n` +
      `9️⃣ *Corte de Caja:* ${corteCajaStatus}\n` +
      `🔟 *Desviaciones Operativas:*\n${desviacionesStr}\n\n` +
      `🔗 *Acceder al Sistema:* [YoY IA Billar](https://yoy-ia-billar.vercel.app)`;

    // Resolver chatId si no está disponible directamente
    let targetChatId = tgConfig.mode === 'custom' ? tgConfig.chatId : null;
    const botToken = tgConfig.mode === 'custom' ? tgConfig.botToken : (process.env.TELEGRAM_OFFICIAL_BOT_TOKEN || '7438459438:AAElh_L0K0kHDF9sd832jklsd-Central');

    if (!targetChatId && tgConfig.phone) {
      const cleanPhone = tgConfig.phone.replace(/\D/g, '');
      const vincRef = doc(db, 'telegram_vinculaciones', hashPhone(cleanPhone));
      const vincSnap = await getDoc(vincRef);
      if (vincSnap.exists()) {
        targetChatId = vincSnap.data().chatId;
      }
    }

    if (!targetChatId) {
      return NextResponse.json({ success: false, error: 'No se pudo resolver el Chat ID de Telegram' }, { status: 400 });
    }

    // 4. Configurar el gráfico de QuickChart (Líneas para historial o barras para primer corte)
    let chartConfig;
    if (history.length > 1) {
      chartConfig = {
        type: 'line',
        data: {
          labels: history.map(h => h.time),
          datasets: [
            {
              label: 'Ventas ($)',
              data: history.map(h => h.sales),
              borderColor: '#39ff14',
              backgroundColor: 'rgba(57, 255, 20, 0.1)',
              fill: true,
              yAxisID: 'y-sales'
            },
            {
              label: 'Ocupación (%)',
              data: history.map(h => h.occupancy),
              borderColor: '#d4af37',
              backgroundColor: 'rgba(212, 175, 55, 0.1)',
              fill: true,
              yAxisID: 'y-occupancy'
            }
          ]
        },
        options: {
          title: {
            display: true,
            text: 'Historial de Operación de Hoy (Cortes 1.5 hrs)',
            fontColor: '#ffffff',
            fontSize: 14
          },
          scales: {
            yAxes: [
              {
                id: 'y-sales',
                type: 'linear',
                position: 'left',
                ticks: { fontColor: '#39ff14', beginAtZero: true },
                scaleLabel: { display: true, labelString: 'Ventas ($)', fontColor: '#39ff14' }
              },
              {
                id: 'y-occupancy',
                type: 'linear',
                position: 'right',
                ticks: { fontColor: '#d4af37', beginAtZero: true, max: 100 },
                gridLines: { drawOnChartArea: false },
                scaleLabel: { display: true, labelString: 'Ocupación (%)', fontColor: '#d4af37' }
              }
            ],
            xAxes: [{ ticks: { fontColor: '#ffffff' } }]
          }
        }
      };
    } else {
      chartConfig = {
        type: 'bar',
        data: {
          labels: ['Meta Diaria', 'Venta Realizada', 'Ocupación (%)'],
          datasets: [{
            data: [Math.round(metaDiaria), Math.round(montoVendido), Math.round(ocupacionPct)],
            backgroundColor: ['rgba(212, 175, 55, 0.5)', 'rgba(57, 255, 20, 0.7)', 'rgba(0, 191, 255, 0.6)'],
            borderColor: ['#d4af37', '#39ff14', '#00bfff'],
            borderWidth: 1
          }]
        },
        options: {
          title: {
            display: true,
            text: 'Rendimiento Operativo YoY Billar (Primer Corte)',
            fontColor: '#ffffff',
            fontSize: 14
          },
          legend: { display: false },
          scales: {
            yAxes: [{ ticks: { beginAtZero: true, fontColor: '#ffffff' } }],
            xAxes: [{ ticks: { fontColor: '#ffffff' } }]
          }
        }
      };
    }
    const chartUrl = `https://quickchart.io/chart?c=${encodeURIComponent(JSON.stringify(chartConfig))}&bkg=%23121212`;

    const photoUrl = `https://api.telegram.org/bot${botToken}/sendPhoto`;
    let res = await fetch(photoUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: targetChatId,
        photo: chartUrl,
        caption: reportText,
        parse_mode: 'Markdown'
      })
    });

    // Fallback si falla sendPhoto (ej. problemas con QuickChart)
    if (!res.ok) {
      console.warn("sendPhoto falló o no se pudo entregar, intentando con sendMessage normal...");
      const sendUrl = `https://api.telegram.org/bot${botToken}/sendMessage`;
      res = await fetch(sendUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: targetChatId,
          text: reportText,
          parse_mode: 'Markdown'
        })
      });
    }

    if (res.ok) {
      // Guardar el estado del reporte enviado
      await setDoc(stateRef, { 
        lastSentAt: now,
        currentDate: currentDate,
        history: history
      }, { merge: true });
      return NextResponse.json({ success: true, text: reportText });
    } else {
      const errData = await res.json();
      return NextResponse.json({ success: false, error: errData.description || 'Error al enviar a Telegram' }, { status: 500 });
    }

  } catch (err) {
    console.error("Error en API cron-report:", err);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

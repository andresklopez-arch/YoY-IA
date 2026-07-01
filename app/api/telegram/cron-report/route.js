import { NextResponse } from 'next/server';
import { db } from '@/lib/firebase';
import { doc, getDoc, setDoc, getDocs, collection, query, where, orderBy, limit, addDoc, serverTimestamp } from 'firebase/firestore';
import { adminDb } from '@/lib/firebase-admin';

// Wrappers para usar Firebase Admin (evitar fallos de permisos en servidor) con fallback a Cliente SDK
async function fetchDocument(collectionName, docId) {
  if (adminDb) {
    const snap = await adminDb.collection(collectionName).doc(docId).get();
    return {
      exists: () => snap.exists,
      data: () => snap.data()
    };
  } else {
    const snap = await getDoc(doc(db, collectionName, docId));
    return snap;
  }
}

async function fetchCollectionQuery(collectionName, constraints = []) {
  if (adminDb) {
    let ref = adminDb.collection(collectionName);
    for (const c of constraints) {
      if (c.type === 'where') {
        ref = ref.where(c.field, c.op, c.value);
      } else if (c.type === 'orderBy') {
        ref = ref.orderBy(c.field, c.direction || 'asc');
      } else if (c.type === 'limit') {
        ref = ref.limit(c.limitVal);
      }
    }
    const snap = await ref.get();
    return {
      empty: snap.empty,
      size: snap.size,
      forEach: (cb) => snap.forEach(cb),
      docs: snap.docs.map(d => ({
        data: () => d.data()
      }))
    };
  } else {
    let clientRef = collection(db, collectionName);
    const clientConstraints = [];
    constraints.forEach(c => {
      if (c.type === 'where') {
        clientConstraints.push(where(c.field, c.op, c.value));
      } else if (c.type === 'orderBy') {
        clientConstraints.push(orderBy(c.field, c.direction || 'asc'));
      } else if (c.type === 'limit') {
        clientConstraints.push(limit(c.limitVal));
      }
    });
    const q = query(clientRef, ...clientConstraints);
    const snap = await getDocs(q);
    return snap;
  }
}

async function saveDocument(collectionName, docId, data, options = {}) {
  if (adminDb) {
    await adminDb.collection(collectionName).doc(docId).set(data, options);
  } else {
    await setDoc(doc(db, collectionName, docId), data, options);
  }
}

async function appendDocument(collectionName, data) {
  if (adminDb) {
    const docRef = await adminDb.collection(collectionName).add({
      ...data,
      createdAt: new Date()
    });
    return docRef;
  } else {
    const docRef = await addDoc(collection(db, collectionName), {
      ...data,
      createdAt: serverTimestamp()
    });
    return docRef;
  }
}

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

async function getShortChartUrl(chartConfig) {
  try {
    const res = await fetch('https://quickchart.io/chart/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chart: chartConfig, bkg: '#121212' })
    });
    if (res.ok) {
      const data = await res.json();
      if (data.success && data.url) return data.url;
    }
  } catch (err) {
    console.warn("Fallo al acortar URL en QuickChart, usando URL larga:", err);
  }
  return `https://quickchart.io/chart?c=${encodeURIComponent(JSON.stringify(chartConfig))}&bkg=%23121212`;
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const force = searchParams.get('force') === 'true';
    const salonId = searchParams.get('salonId') || 'default_salon';

    // 1. Cargar la configuración de Telegram
    const tgSnap = await fetchDocument('config', `telegram_${salonId}`);
    if (!tgSnap.exists()) {
      return NextResponse.json({ 
        success: false, 
        error: 'Telegram no está configurado. Ve a Configuración, ACTIVA EL SWITCH principal "ALERTAS TELEGRAM" (azul), ingresa tu teléfono y haz clic en "GUARDAR TELEGRAM".' 
      }, { status: 404 });
    }
    const tgConfig = tgSnap.data();
    if (!tgConfig.enabled) {
      return NextResponse.json({ 
        success: false, 
        error: 'Las alertas de Telegram están apagadas en el sistema. Activa el switch principal "ALERTAS TELEGRAM" (azul) en Configuración y haz clic en "GUARDAR TELEGRAM" para activarlas.' 
      });
    }

    // Si no está activado el reporte periódico y no es un envío forzado, omitir
    if (!tgConfig.notifyPeriodicReport && !force) {
      return NextResponse.json({ success: false, error: 'Reporte periódico de Telegram desactivado en la configuración' });
    }

    const stateSnap = await fetchDocument('config', `telegram_report_state_${salonId}`);
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
    const mesasSnap = await fetchDocument('config', `mesas_estado_${salonId}`);
    if (mesasSnap.exists()) {
      mesasEstado = mesasSnap.data().mesas || [];
      totalMesas = mesasEstado.length;
      activeMesas = mesasEstado.filter(m => m.estado === 'ocupada').length;
    }
    const ocupacionPct = totalMesas > 0 ? Math.round((activeMesas / totalMesas) * 100) : 0;

    // Métrica 2: Monto Vendido Hoy (Bitácora de cobros)
    const snapBitacoraRaw = await fetchCollectionQuery('bitacora', [
      { type: 'where', field: 'fecha', op: '>=', value: mxDateStr + 'T00:00:00' },
      { type: 'where', field: 'fecha', op: '<=', value: mxDateStr + 'T23:59:59.999Z' }
    ]);
    const snapBitacora = snapBitacoraRaw.docs.filter(d => d.data().salonId === salonId);
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
    const sucursalSnap = await fetchDocument('config', `sucursal_${salonId}`);
    if (sucursalSnap.exists()) {
      metaMensual = Number(sucursalSnap.data().metaMensual) || 100000;
    }
    const metaDiaria = metaMensual / 30;
    const avanceMetaPct = metaDiaria > 0 ? Math.round((montoVendido / metaDiaria) * 100) : 0;

    // Métrica 4: Trabajadores en Turno
    const snapAsist = await fetchCollectionQuery('nomina_asistencia_log', [
      { type: 'where', field: 'salonId', op: '==', value: salonId },
      { type: 'where', field: 'fecha', op: '==', value: mxDateStr }
    ]);
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
    const snapFila = await fetchCollectionQuery('fila_espera', [
      { type: 'where', field: 'salonId', op: '==', value: salonId },
      { type: 'where', field: 'estado', op: '==', value: 'espera' }
    ]);
    const clientesEsperaCount = snapFila.size;

    // Métrica 6: Mesa con Mayor Consumo Actual (Renta acumulada + consumos)
    let mesaMayorConsumoNombre = 'Ninguna';
    let mesaMayorConsumoTotal = 0;
    const cuentasSnap = await fetchDocument('config', `cuentas_estado_${salonId}`);
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
    const snapGastosRaw = await fetchCollectionQuery('gastos', [
      { type: 'where', field: 'fecha', op: '>=', value: mxDateStr + 'T00:00:00' },
      { type: 'where', field: 'fecha', op: '<=', value: mxDateStr + 'T23:59:59.999Z' }
    ]);
    const snapGastos = snapGastosRaw.docs.filter(d => d.data().salonId === salonId);
    let totalGastos = 0;
    snapGastos.forEach(d => {
      const data = d.data();
      if (data.monto) {
        totalGastos += Number(data.monto);
      }
    });

    // Métrica 8: Comandas Cocina Pendientes
    const snapComandas = await fetchCollectionQuery('mesa_pedidos', [
      { type: 'where', field: 'salonId', op: '==', value: salonId },
      { type: 'where', field: 'tipo', op: '==', value: 'pedido' },
      { type: 'where', field: 'estado', op: '==', value: 'pendiente' }
    ]);
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
    const snapCortesRaw = await fetchCollectionQuery('cortes_caja', [
      { type: 'orderBy', field: 'fecha', direction: 'desc' },
      { type: 'limit', limitVal: 30 }
    ]);
    const snapCortes = snapCortesRaw.docs.filter(d => d.data().salonId === salonId);
    let corteCajaStatus = 'Sin cortes de caja recientes';
    if (snapCortes.length > 0) {
      const c = snapCortes[0].data();
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
    const chartUrl = await getShortChartUrl(chartConfig);

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
      await saveDocument('config', `telegram_report_state_${salonId}`, { 
        lastSentAt: now,
        currentDate: currentDate,
        history: history
      }, { merge: true });

      try {
        await appendDocument('telegram_alert_logs', {
          salonId: salonId,
          phone: obfuscatePhone(tgConfig.phone),
          chatId: targetChatId || null,
          text: 'Reporte Periódico de Operación (Corte)',
          mode: tgConfig.mode || 'simplified',
          status: 'sent'
        });
      } catch (logErr) {
        console.error("Error al registrar bitácora de reporte (Success):", logErr);
      }

      return NextResponse.json({ success: true, text: reportText });
    } else {
      const errData = await res.json();
      const errMsg = errData.description || 'Error al enviar a Telegram';

      try {
        await appendDocument('telegram_alert_logs', {
          salonId: salonId,
          phone: obfuscatePhone(tgConfig.phone),
          chatId: targetChatId || null,
          text: 'Reporte Periódico de Operación (Corte)',
          mode: tgConfig.mode || 'simplified',
          status: 'failed',
          error: errMsg
        });
      } catch (logErr) {
        console.error("Error al registrar bitácora de reporte (Failed):", logErr);
      }

      return NextResponse.json({ success: false, error: errMsg }, { status: 500 });
    }

  } catch (err) {
    console.error("Error en API cron-report:", err);
    try {
      await appendDocument('telegram_alert_logs', {
        salonId: salonId || 'default_salon',
        phone: tgConfig?.phone ? obfuscatePhone(tgConfig.phone) : null,
        chatId: targetChatId || null,
        text: 'Reporte Periódico de Operación (Corte)',
        mode: tgConfig?.mode || 'simplified',
        status: 'failed',
        error: err.message
      });
    } catch (logErr) {
      console.error("Error al registrar bitácora de reporte (Catch):", logErr);
    }
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

import { NextResponse } from 'next/server';
import { db } from '@/lib/firebase';
import { doc, getDoc, setDoc, getDocs, collection, query, where, orderBy, limit, addDoc, serverTimestamp } from 'firebase/firestore';
import { adminDb } from '@/lib/firebase-admin';
import PDFDocument from 'pdfkit';

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
      body: JSON.stringify({ chart: chartConfig, width: 500, height: 320, bkg: '#121212' })
    });
    if (res.ok) {
      const data = await res.json();
      if (data.success && data.url) return data.url;
    }
  } catch (err) {
    console.warn("Fallo al acortar URL en QuickChart, usando URL larga:", err);
  }
  const configStr = typeof chartConfig === 'string' ? chartConfig : JSON.stringify(chartConfig);
  return `https://quickchart.io/chart?c=${encodeURIComponent(configStr)}&w=500&h=320&bkg=%23121212`;
}

function generatePdfReport(params) {
  const {
    branchName,
    mxDateStr,
    ocupacionPct,
    activeMesas,
    totalMesas,
    montoVendido,
    metaMensual,
    metaDiaria,
    avanceMetaPct,
    presentWorkersNames,
    clientesEsperaCount,
    mesaMayorConsumoNombre,
    mesaMayorConsumoTotal,
    totalGastos,
    comandasPendientesCount,
    corteCajaStatus,
    desviacionesStr
  } = params;

  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 45, size: 'A4' });
      const chunks = [];
      doc.on('data', chunk => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', err => reject(err));

      // --- 1. HEADER (Fondo y Título) ---
      doc.rect(45, 45, 10, 75).fill('#C29B38');

      doc.fillColor('#1A202C')
         .fontSize(22)
         .font('Helvetica-Bold')
         .text('REPORTE EJECUTIVO DE OPERACIÓN', 70, 50);

      doc.fillColor('#718096')
         .fontSize(10)
         .font('Helvetica')
         .text(`SUCURSAL: ${branchName.toUpperCase()}`, 70, 75)
         .text(`FECHA DE EMISIÓN: ${mxDateStr} | GENERADO POR YoY IA SYSTEM`, 70, 90);

      doc.moveTo(45, 135).lineTo(550, 135).strokeColor('#E2E8F0').lineWidth(1).stroke();

      // --- 2. SECCIÓN 1: RESUMEN DE VENTAS Y METAS ---
      doc.fillColor('#1A202C')
         .fontSize(13)
         .font('Helvetica-Bold')
         .text('1. RENDIMIENTO FINANCIERO Y METAS', 45, 155);

      doc.rect(45, 175, 240, 65).fill('#F7FAFC');
      doc.fillColor('#C29B38')
         .fontSize(11)
         .font('Helvetica-Bold')
         .text('Monto Vendido Hoy', 60, 185);
      doc.fillColor('#1A202C')
         .fontSize(18)
         .font('Helvetica-Bold')
         .text(`$${montoVendido.toLocaleString('es-MX')} MXN`, 60, 205);

      doc.rect(305, 175, 245, 65).fill('#F7FAFC');
      doc.fillColor('#4A5568')
         .fontSize(11)
         .font('Helvetica-Bold')
         .text('Meta Diaria Establecida', 320, 185);
      doc.fillColor('#1A202C')
         .fontSize(18)
         .font('Helvetica-Bold')
         .text(`$${Math.round(metaDiaria).toLocaleString('es-MX')} MXN`, 320, 205);

      doc.fillColor('#4A5568')
         .fontSize(10)
         .font('Helvetica-Bold')
         .text(`Avance de Meta Diaria: ${avanceMetaPct}%`, 45, 260);

      doc.rect(45, 275, 505, 12).fill('#EDF2F7');
      const progressWidth = Math.min(505, Math.max(0, (avanceMetaPct / 100) * 505));
      if (progressWidth > 0) {
        doc.rect(45, 275, progressWidth, 12).fill('#C29B38');
      }

      // --- 3. SECCIÓN 2: OPERACIÓN Y ASISTENCIA ---
      doc.fillColor('#1A202C')
         .fontSize(13)
         .font('Helvetica-Bold')
         .text('2. ESTADO DE OPERACIÓN Y ASISTENCIA', 45, 310);

      const yStart = 335;
      const rowHeight = 22;

      doc.rect(45, yStart, 505, 20).fill('#EDF2F7');
      doc.fillColor('#4A5568')
         .fontSize(9.5)
         .font('Helvetica-Bold')
         .text('INDICADOR', 55, yStart + 6)
         .text('ESTADO / DETALLE', 250, yStart + 6);

      const items = [
        { label: 'Ocupación de Mesas', value: `${ocupacionPct}% (${activeMesas} de ${totalMesas} mesas ocupadas)` },
        { label: 'Trabajadores en Turno', value: presentWorkersNames },
        { label: 'Clientes en Espera', value: `${clientesEsperaCount} cliente(s) en fila` },
        { label: 'Mayor Renta Activa', value: `${mesaMayorConsumoNombre} ($${Math.round(mesaMayorConsumoTotal).toLocaleString('es-MX')} MXN)` },
        { label: 'Gastos de la Jornada', value: `$${totalGastos.toLocaleString('es-MX')} MXN` },
        { label: 'Pedidos Cocina Pendientes', value: `${comandasPendientesCount} comanda(s)` },
        { label: 'Cierre / Corte de Caja', value: corteCajaStatus }
      ];

      items.forEach((item, index) => {
        const y = yStart + 20 + (index * rowHeight);
        if (index % 2 === 1) {
          doc.rect(45, y, 505, rowHeight).fill('#F7FAFC');
        }
        doc.fillColor('#2D3748')
           .fontSize(9)
           .font('Helvetica')
           .text(item.label, 55, y + 6);

        doc.fillColor('#1A202C')
           .fontSize(9)
           .font('Helvetica-Bold')
           .text(String(item.value), 250, y + 6);
      });

      // --- 4. SECCIÓN 3: DESVIACIONES OPERATIVAS ---
      const yDesv = yStart + 20 + (items.length * rowHeight) + 25;
      doc.fillColor('#1A202C')
         .fontSize(13)
         .font('Helvetica-Bold')
         .text('3. DESVIACIONES Y ALERTAS IA', 45, yDesv);

      doc.rect(45, yDesv + 15, 505, 80).fill('#FFF5F5');
      doc.rect(45, yDesv + 15, 4, 80).fill('#E53E3E');

      const lines = desviacionesStr.split('\n');
      let offsetText = yDesv + 25;
      lines.forEach(line => {
        doc.fillColor('#C53030')
           .fontSize(9.5)
           .font('Helvetica-Bold')
           .text(line, 60, offsetText);
        offsetText += 16;
      });

      // --- 5. PIE DE PÁGINA ---
      doc.fillColor('#A0AEC0')
         .fontSize(8)
         .font('Helvetica')
         .text('Este documento es confidencial y para uso exclusivo del administrador del establecimiento.', 45, 740, { align: 'center', width: 505 })
         .text('Soporte y Auditoría Inteligente por YoY IA Billar System.', 45, 755, { align: 'center', width: 505 });

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
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

    let stateSnap = await fetchDocument('config', `telegram_report_state_${salonId}`);
    const now = Date.now();
    const mxDateStr = new Date().toLocaleString('sv-SE', { timeZone: 'America/Mexico_City' }).split(' ')[0];

    // A. Auto-Salida nocturna automática a las 05:00 a.m. (ejecutar una vez al día)
    const mxDateNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Mexico_City' }));
    const currentHourNow = mxDateNow.getHours();
    const currentMinNow = mxDateNow.getMinutes();

    if (currentHourNow === 5 && currentMinNow < 15) {
      let alreadyRunToday = false;
      if (stateSnap.exists()) {
        const stateData = stateSnap.data();
        if (stateData.lastAutoSalidaDate === mxDateStr) {
          alreadyRunToday = true;
        }
      }

      if (!alreadyRunToday) {
        console.log("Ejecutando auto-salida automática nocturna para turnos olvidados...");
        try {
          const snapAsistAll = await fetchCollectionQuery('nomina_asistencia_log', [
            { type: 'where', field: 'salonId', op: '==', value: salonId }
          ]);
          const asistDocsAll = snapAsistAll.docs.map(d => d.data());
          
          asistDocsAll.sort((a, b) => {
            const tA = a.createdAt?.toDate ? a.createdAt.toDate().getTime() : (a.createdAt || 0);
            const tB = b.createdAt?.toDate ? b.createdAt.toDate().getTime() : (b.createdAt || 0);
            return tB - tA;
          });

          const lastLogByWorker = {};
          asistDocsAll.forEach(data => {
            const empId = data.empleadoId;
            if (empId && !lastLogByWorker[empId]) {
              lastLogByWorker[empId] = data;
            }
          });

          for (const empId of Object.keys(lastLogByWorker)) {
            const lastLog = lastLogByWorker[empId];
            if (lastLog.tipo === 'entrada' && lastLog.fecha !== mxDateStr) {
              console.log(`Auto-cerrando turno de días anteriores para: ${lastLog.nombre}`);
              await appendDocument('nomina_asistencia_log', {
                empleadoId: empId,
                nombre: lastLog.nombre,
                rol: lastLog.rol || 'Mesero',
                fecha: lastLog.fecha,
                tipo: 'salida',
                coordenadas: { lat: null, lng: null, precision: null, status: 'Cierre automático nocturno' },
                dispositivo: 'SISTEMA (Auto-Cierre)',
                salonId: salonId
              });
            }
          }

          await saveDocument('config', `telegram_report_state_${salonId}`, { 
            lastAutoSalidaDate: mxDateStr
          }, { merge: true });

          // Recargar stateSnap para reflejar el cambio
          stateSnap = await fetchDocument('config', `telegram_report_state_${salonId}`);
        } catch (err) {
          console.error("Error en proceso de auto-salida nocturna:", err);
        }
      }
    }

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
      const reportInterval = tgConfig.reportInterval !== undefined ? Number(tgConfig.reportInterval) : 4;
      const reportHour = tgConfig.reportHour !== undefined ? Number(tgConfig.reportHour) : 9;

      if (reportInterval === 24) {
        // Enviar una vez al día a partir de reportHour
        const mxDate = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Mexico_City' }));
        const currentHour = mxDate.getHours();
        
        const lastSentDate = stateSnap.exists() ? (stateSnap.data().lastSentDate || '') : '';
        if (lastSentDate === mxDateStr) {
          return NextResponse.json({
            success: true,
            skipped: true,
            reason: `El reporte periódico de 24 horas ya se envió hoy (${mxDateStr}).`
          });
        }
        
        if (currentHour < reportHour) {
          return NextResponse.json({
            success: true,
            skipped: true,
            reason: `Aún no es la hora de envío configurada (${reportHour}:00h). Hora actual: ${currentHour}:00h.`
          });
        }
      } else {
        // Enviar cada reportInterval horas
        if (stateSnap.exists()) {
          const lastSentAt = stateSnap.data().lastSentAt || 0;
          const diffMs = now - lastSentAt;
          const targetInterval = reportInterval * 60 * 60 * 1000;
          
          if (diffMs < targetInterval) {
            const remainingMins = Math.round((targetInterval - diffMs) / 60000);
            return NextResponse.json({ 
              success: true, 
              skipped: true, 
              reason: `Faltan ${remainingMins} minutos para el siguiente reporte periódico de ${reportInterval}h.` 
            });
          }
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

    let poolOcupadas = 0;
    let carambolaOcupadas = 0;
    let mesasLibres = 0;
    mesasEstado.forEach(m => {
      if (m.estado === 'ocupada') {
        const t = (m.tipo || '').toLowerCase();
        if (t.includes('pool')) {
          poolOcupadas++;
        } else {
          carambolaOcupadas++;
        }
      } else {
        mesasLibres++;
      }
    });

    // Métrica 2: Monto Vendido Hoy (Bitácora de cobros)
    const snapBitacoraRaw = await fetchCollectionQuery('bitacora', [
      { type: 'where', field: 'fecha', op: '>=', value: mxDateStr + 'T00:00:00' },
      { type: 'where', field: 'fecha', op: '<=', value: mxDateStr + 'T23:59:59.999Z' }
    ]);
    const snapBitacora = snapBitacoraRaw.docs.filter(d => d.data().salonId === salonId);
    let montoVendido = 0;
    let rentaIngresos = 0;
    let barraIngresos = 0;
    let otrosIngresos = 0;
    snapBitacora.forEach(d => {
      const e = d.data();
      const acc = e.accion;
      const m = Number(e.monto || 0);
      if (m > 0) {
        if (acc === 'Cierre Directo' || acc === 'Mesa a Cuenta' || acc === 'Cobro Manual' || acc === 'Venta Barra' || acc === 'Cobro Barra' || acc === 'Clientes - Suscripción' || acc === 'Torneos - Registro') {
          montoVendido += m;
          if (acc === 'Cierre Directo' || acc === 'Mesa a Cuenta' || acc === 'Cobro Manual') {
            rentaIngresos += m;
          } else if (acc === 'Venta Barra' || acc === 'Cobro Barra') {
            barraIngresos += m;
          } else {
            otrosIngresos += m;
          }
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
    // 1. Obtener empleados del salón
    const snapEmpleadosRaw = await fetchCollectionQuery('nomina_empleados', [
      { type: 'where', field: 'salonId', op: '==', value: salonId }
    ]);
    const listEmpleados = snapEmpleadosRaw.docs.map(d => ({ id: d.id, ...d.data() }));

    // 2. Obtener asistencia de hoy
    const snapAsistRaw = await fetchCollectionQuery('nomina_asistencia', [
      { type: 'where', field: 'salonId', op: '==', value: salonId },
      { type: 'where', field: 'fecha', op: '==', value: mxDateStr }
    ]);
    
    const activeSet = new Set();
    const activeNames = [];

    // Agregar trabajadores que pasaron lista hoy (estado presente o tardanza)
    snapAsistRaw.forEach(d => {
      const data = d.data();
      if (data.estado === 'presente' || data.estado === 'tardanza') {
        const emp = listEmpleados.find(e => e.id === data.empleadoId);
        if (emp) {
          const fullName = `${emp.nombre} ${emp.apellido || ''}`.trim();
          if (!activeSet.has(fullName.toLowerCase())) {
            activeSet.add(fullName.toLowerCase());
            activeNames.push(fullName);
          }
        }
      }
    });

    // 3. Agregar operadores activos hoy en la bitácora
    snapBitacora.forEach(d => {
      const e = d.data();
      const op = (e.operador || '').trim();
      if (op && op.toLowerCase() !== 'sistema' && op.toLowerCase() !== 'sistema (auto-protección)') {
        if (!activeSet.has(op.toLowerCase())) {
          activeSet.add(op.toLowerCase());
          activeNames.push(op);
        }
      }
    });

    const presentWorkersCount = activeNames.length;
    const presentWorkersNames = activeNames.join(', ') || 'Ninguno';

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

    const formatTableList = (tables) => {
      if (tables.length === 0) return '';
      if (tables.length <= 3) return tables.join(', ');
      return `${tables.slice(0, 3).join(', ')}... (+${tables.length - 3} más)`;
    };

    if (mesasSinAtender.length > 0) {
      desviaciones.push(`🔔 Mesas sin atención (>15m): ${formatTableList(mesasSinAtender)}`);
    }
    if (mesasExcesivas.length > 0) {
      desviaciones.push(`⏱️ Tiempo excesivo juego (>4h): ${formatTableList(mesasExcesivas)}`);
    }
    if (demoradasCount > 0) {
      desviaciones.push(`🍳 Pedidos demorados cocina (>20m): ${demoradasCount}`);
    }
    if (presentWorkersCount === 0 && activeMesas > 0) {
      desviaciones.push(`👥 Alerta: Billar operando sin personal fichado hoy.`);
    }
    const desviacionesStr = desviaciones.length > 0 ? desviaciones.join('\n') : 'Ninguna desviación detectada. Operación estable.';

    // Métrica 10: Último Corte de Caja
    const snapCortesRaw = await fetchCollectionQuery('cortes_caja', [
      { type: 'orderBy', field: 'fecha', direction: 'desc' },
      { type: 'limit', limitVal: 30 }
    ]);
    const snapCortes = snapCortesRaw.docs.filter(d => d.data().salonId === salonId);
    let corteCajaStatus = '⚪ Sin cortes de caja recientes';
    if (snapCortes.length > 0) {
      const c = snapCortes[0].data();
      const diff = Number(c.diferencia || 0);
      corteCajaStatus = diff === 0 
        ? '🟢 Caja cuadrada ✓' 
        : `🔴 Descuadre de $${diff.toLocaleString('es-MX')} MXN`;
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
    
    let metaEmoji = '🔴';
    if (avanceMetaPct >= 80) {
      metaEmoji = '🟢';
    } else if (avanceMetaPct >= 40) {
      metaEmoji = '🟡';
    }

    let trendEmoji = '➡️';
    if (history.length > 1) {
      const prevOccupancy = history[history.length - 2].occupancy;
      if (ocupacionPct > prevOccupancy) {
        trendEmoji = '📈';
      } else if (ocupacionPct < prevOccupancy) {
        trendEmoji = '📉';
      }
    }

    const reportText = `📊 *REPORTE DE OPERACIÓN - ${branchName.toUpperCase()}* 📊\n` +
      `🕒 *Hora:* ${new Date().toLocaleString('es-MX', { timeZone: 'America/Mexico_City', hour12: true })}\n\n` +
      `1️⃣ *Ocupación Actual:* ${ocupacionPct}% ${trendEmoji} (${activeMesas}/${totalMesas} mesas ocupadas)\n` +
      `2️⃣ *Monto Vendido Hoy:* $${montoVendido.toLocaleString('es-MX')} MXN\n` +
      `3️⃣ *Avance de Meta:* Meta mensual: $${metaMensual.toLocaleString('es-MX')} MXN (Meta diaria: $${Math.round(metaDiaria).toLocaleString('es-MX')} MXN). Avance hoy: ${metaEmoji} *${avanceMetaPct}%*\n` +
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

    let res = null;

    if (tgConfig.reportIncludeCharts) {
      // 4. Configurar el gráfico de QuickChart (Doble dona con texturas)
      const ventaMetaValue = Math.min(Math.round(montoVendido), Math.round(metaDiaria));
      const restoMetaValue = Math.max(0, Math.round(metaDiaria - montoVendido));
      const excedenteMetaValue = Math.max(0, Math.round(montoVendido - metaDiaria));

      const hasIngresos = (rentaIngresos + barraIngresos + otrosIngresos) > 0;
      const innerData = hasIngresos 
        ? `[${Math.round(rentaIngresos)}, ${Math.round(barraIngresos)}, ${Math.round(otrosIngresos)}]`
        : `[0.001, 0.001, 0.001]`;
      const innerColors = hasIngresos
        ? `[
            pattern.draw('diagonal-right-left', '#00BFFF'), 
            pattern.draw('zigzag', '#FF7F50'), 
            pattern.draw('square', '#FFD700')
          ]`
        : `['#2A2F3D', '#2A2F3D', '#2A2F3D']`;

      const chartConfig = `{
        type: 'doughnut',
        data: {
          labels: ['Meta Alcanzada', 'Faltante Meta', 'Excedente Ventas', 'Pool Ocupada', 'Carambola Ocupada', 'Mesa Libre', 'Ingresos Renta', 'Ingresos Barra', 'Otros Ingresos'],
          datasets: [
            {
              data: [${ventaMetaValue}, ${restoMetaValue}, ${excedenteMetaValue}],
              backgroundColor: [
                pattern.draw('diagonal', '#00F5A0'), 
                pattern.draw('square', '#7F00FF'),
                pattern.draw('zigzag', '#39ff14')
              ],
              borderColor: '#121212',
              borderWidth: 3,
              label: 'Avance Ventas ($)'
            },
            {
              data: [${poolOcupadas}, ${carambolaOcupadas}, ${mesasLibres}],
              backgroundColor: [
                pattern.draw('zigzag-vertical', '#FFB800'), 
                pattern.draw('vertical-line', '#FF007F'), 
                '#2A2F3D'
              ],
              borderColor: '#121212',
              borderWidth: 3,
              label: 'Ocupación Mesas'
            },
            {
              data: ${innerData},
              backgroundColor: ${innerColors},
              borderColor: '#121212',
              borderWidth: 3,
              label: 'Desglose Ventas ($)'
            }
          ]
        },
        options: {
          title: {
            display: true,
            text: 'DESEMPEÑO Y OPERACIÓN HOY',
            fontColor: '#ffffff',
            fontSize: 15,
            fontStyle: 'bold',
            fontFamily: "'Outfit', 'Inter', sans-serif",
            padding: 15
          },
          legend: {
            display: true,
            position: 'bottom',
            labels: {
              fontColor: '#a0aec0',
              fontFamily: "'Outfit', 'Inter', sans-serif",
              fontSize: 9,
              boxWidth: 10
            }
          },
          plugins: {
            datalabels: {
              display: true,
              color: '#ffffff',
              backgroundColor: 'rgba(18, 18, 18, 0.85)',
              borderRadius: 4,
              font: {
                family: "'Outfit', 'Inter', sans-serif",
                weight: 'bold',
                size: 8
              },
              formatter: (value, context) => {
                if (value === 0 || value < 0.1) return null;
                if (context.datasetIndex === 0 || context.datasetIndex === 2) {
                  return '$' + Number(value).toLocaleString('es-MX');
                }
                return value + (value === 1 ? ' mesa' : ' mesas');
              }
            }
          }
        }
      }`;
      const chartUrl = await getShortChartUrl(chartConfig);

      // Descargar el gráfico de QuickChart a un buffer en el servidor
      let imageBuffer = null;
      try {
        console.log("Descargando gráfico de QuickChart:", chartUrl);
        const imgRes = await fetch(chartUrl);
        if (imgRes.ok) {
          imageBuffer = await imgRes.arrayBuffer();
        }
      } catch (err) {
        console.error("Error al descargar gráfico de QuickChart:", err);
      }

      const photoUrl = `https://api.telegram.org/bot${botToken}/sendPhoto`;

      if (imageBuffer) {
        // 1. Intentar enviar foto con caption completo (límite 1024 caracteres)
        try {
          const formData = new FormData();
          formData.append('chat_id', String(targetChatId));
          const blob = new Blob([imageBuffer], { type: 'image/png' });
          formData.append('photo', blob, 'chart.png');
          formData.append('caption', reportText);
          formData.append('parse_mode', 'Markdown');

          res = await fetch(photoUrl, {
            method: 'POST',
            body: formData
          });

          if (!res.ok) {
            const errText = await res.text();
            console.warn("Fallo al enviar foto con caption completo:", errText);
          }
        } catch (err) {
          console.error("Excepción al enviar foto con caption completo:", err);
        }

        // 2. Fallback si falló el envío conjunto
        if (!res || !res.ok) {
          try {
            console.warn("Intentando envío por separado (foto + texto)...");
            const shortCaption = `📊 *REPORTE DE OPERACIÓN - ${branchName.toUpperCase()}*\n(Ver desglose detallado en el siguiente mensaje)`;
            
            const formDataSep = new FormData();
            formDataSep.append('chat_id', String(targetChatId));
            const blobSep = new Blob([imageBuffer], { type: 'image/png' });
            formDataSep.append('photo', blobSep, 'chart.png');
            formDataSep.append('caption', shortCaption);
            formDataSep.append('parse_mode', 'Markdown');

            await fetch(photoUrl, {
              method: 'POST',
              body: formDataSep
            });

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
          } catch (err) {
            console.error("Excepción en fallback por separado:", err);
          }
        }
      }
    }

    // 3. Enviar el reporte por Telegram usando solo texto si no hay gráfico o si falló el envío de la foto
    if (!res || !res.ok) {
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
        lastSentDate: mxDateStr,
        currentDate: currentDate,
        history: history
      }, { merge: true });

      // Generar y enviar el PDF Ejecutivo si está habilitado
      if (tgConfig.reportIncludePdf) {
        try {
          console.log("Generando reporte ejecutivo en PDF...");
          const pdfBuffer = await generatePdfReport({
            branchName,
            mxDateStr,
            ocupacionPct,
            activeMesas,
            totalMesas,
            montoVendido,
            metaMensual,
            metaDiaria,
            avanceMetaPct,
            presentWorkersNames,
            clientesEsperaCount,
            mesaMayorConsumoNombre,
            mesaMayorConsumoTotal,
            totalGastos,
            comandasPendientesCount,
            corteCajaStatus,
            desviacionesStr
          });

          console.log("Enviando reporte PDF a Telegram...");
          const docUrl = `https://api.telegram.org/bot${botToken}/sendDocument`;
          const formData = new FormData();
          formData.append('chat_id', String(targetChatId));
          const blob = new Blob([pdfBuffer], { type: 'application/pdf' });
          formData.append('document', blob, `Reporte_Ejecutivo_${branchName.replace(/\s+/g, '_')}_${mxDateStr}.pdf`);
          formData.append('caption', '📄 *Reporte Ejecutivo de Operación en PDF*');
          formData.append('parse_mode', 'Markdown');

          await fetch(docUrl, {
            method: 'POST',
            body: formData
          });
        } catch (pdfErr) {
          console.error("Fallo al generar o enviar reporte PDF:", pdfErr);
        }
      }

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

import { NextResponse } from 'next/server';
import { db } from '@/lib/firebase';
import { 
  doc, 
  getDoc, 
  getDocs, 
  updateDoc, 
  collection, 
  query, 
  where, 
  orderBy, 
  limit 
} from 'firebase/firestore';

// Helper de fecha de negocio (zona horaria CDMX, corte a las 6:00 AM)
const getBusinessDate = () => {
  const now = new Date();
  const offset = -6; // GMT-6
  const localTime = new Date(now.getTime() + (offset * 3600000));
  let hour = localTime.getUTCHours();
  let fecha = localTime.toISOString().split('T')[0];
  if (hour < 6) {
    const yesterday = new Date(localTime.getTime() - 24 * 3600000);
    fecha = yesterday.toISOString().split('T')[0];
  }
  return fecha;
};

// Helper para enviar a Telegram resolviendo los modos Simplificado/Custom
const sendTelegramAlert = async (text, tgData) => {
  try {
    let branchName = 'Sucursal';
    try {
      const sucRef = doc(db, 'config', 'sucursal');
      const sucSnap = await getDoc(sucRef);
      if (sucSnap.exists() && sucSnap.data().nombre) {
        branchName = sucSnap.data().nombre;
      }
    } catch (err) {
      console.error("Error al cargar sucursal en alert sender:", err);
    }

    // Prefijar con el nombre de la sucursal
    const formattedText = `🏢 *[${branchName}]*\n\n${text}`;

    const officialBotToken = process.env.TELEGRAM_OFFICIAL_BOT_TOKEN;
    if (tgData.mode === 'simplified') {
      if (officialBotToken) {
        const cleanPhone = (tgData.phone || '').replace(/\D/g, '');
        if (cleanPhone) {
          const vincRef = doc(db, 'telegram_vinculaciones', cleanPhone);
          const vincSnap = await getDoc(vincRef);
          if (vincSnap.exists()) {
            const resolvedChatId = vincSnap.data().chatId;
            await fetch(`https://api.telegram.org/bot${officialBotToken}/sendMessage`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                chat_id: resolvedChatId,
                text: formattedText,
                parse_mode: 'Markdown'
              })
            });
          }
        }
      } else {
        // Enviar a central
        await fetch('https://yoy-ia-billar.vercel.app/api/telegram/send-alert', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            mode: 'central-resolve',
            phone: tgData.phone,
            text: formattedText
          })
        });
      }
    } else if (tgData.mode === 'custom' && tgData.botToken && tgData.chatId) {
      await fetch(`https://api.telegram.org/bot${tgData.botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: tgData.chatId,
          text: formattedText,
          parse_mode: 'Markdown'
        })
      });
    }
  } catch (err) {
    console.error("Error de conexión al enviar mensaje a Telegram:", err);
  }
};

export async function POST(request) {
  try {
    const { empleadoId, tipo, nombre, rol, dispositivo } = await request.json();

    if (!empleadoId || !tipo || !nombre) {
      return NextResponse.json({ success: false, error: 'Parámetros incompletos' }, { status: 400 });
    }

    // 1. Obtener configuración de Telegram
    const tgRef = doc(db, 'config', 'telegram');
    const tgSnap = await getDoc(tgRef);
    if (!tgSnap.exists()) {
      return NextResponse.json({ success: true, message: 'Sin configuración de Telegram' });
    }
    const tgData = tgSnap.data();

    // Si la integración completa de alertas de Telegram está desactivada, salimos temprano
    if (!tgData.enabled) {
      return NextResponse.json({ success: true, message: 'Alertas desactivadas globalmente' });
    }

    const fechaHoy = getBusinessDate();
    const currentDevice = dispositivo || 'Terminal Local';

    // 2. Consultar registros de hoy para calcular personal activo
    const qLogs = query(
      collection(db, 'nomina_asistencia_log'),
      where('fecha', '==', fechaHoy)
    );
    const logsSnap = await getDocs(qLogs);
    const logs = logsSnap.docs.map(d => d.data());

    // Agrupar por empleado para saber su estado actual
    const statusMap = {};
    logs.forEach(log => {
      if (log.empleadoId) {
        statusMap[log.empleadoId] = log;
      }
    });

    // Contar cuántos empleados están actualmente activos (último estado = entrada)
    let activeEmployees = Object.keys(statusMap).filter(empId => {
      // El empleado que está ejecutando esta acción cambiará su estado en la base,
      // pero simulamos el estado final en base a la acción que viene en la petición
      if (empId === empleadoId) {
        return tipo === 'entrada';
      }
      return statusMap[empId].tipo === 'entrada';
    });

    // Si el empleado que ejecuta la acción no tenía registros previos hoy
    if (!statusMap[empleadoId] && tipo === 'entrada') {
      activeEmployees.push(empleadoId);
    }

    const activeCount = activeEmployees.length;

    // 3. Evaluar transiciones y enviar notificaciones
    if (tgData.notifyAttendance) {
      const nowStr = new Date().toLocaleString('es-MX', { timeZone: 'America/Mexico_City', hour: '2-digit', minute: '2-digit' });

      if (tipo === 'entrada') {
        if (activeCount === 1) {
          // A: Transición 0 -> 1 (Primer empleado en llegar - Inicio de Jornada)
          const alertMsg = `✈️ *[YoY Billar]*\n\n` +
                           `🚪 *Inicio de Jornada*\n` +
                           `👤 *Primer empleado activo:* ${nombre} (${rol || 'Staff'})\n` +
                           `📱 *Dispositivo:* \`${currentDevice}\`\n` +
                           `📅 *Hora de Entrada:* ${nowStr}`;
          
          await sendTelegramAlert(alertMsg, tgData);

          // Si está activado, enviar el resumen de la jornada anterior (corte anterior)
          if (tgData.notifyPrevShiftSummary) {
            try {
              const qCortes = query(
                collection(db, 'cortes_caja'),
                orderBy('fecha', 'desc'),
                limit(1)
              );
              const cortesSnap = await getDocs(qCortes);
              if (!cortesSnap.empty) {
                const lastCorteDoc = cortesSnap.docs[0];
                const lastCorte = lastCorteDoc.data();

                if (!lastCorte.reporteEnviadoTelegram) {
                  // Obtener inventarios críticos para adjuntarlos al reporte
                  let criticalInventoryText = '• Todos los insumos se encuentran en niveles óptimos ✅';
                  try {
                    const invRef = doc(db, 'config', 'inventario');
                    const invSnap = await getDoc(invRef);
                    if (invSnap.exists() && Array.isArray(invSnap.data().productos)) {
                      const criticals = invSnap.data().productos.filter(p => (p.stock || 0) <= (p.stockMinimo || 0));
                      if (criticals.length > 0) {
                        criticalInventoryText = criticals.map(p => `• *${p.nombre}*: ${p.stock} pza (Mínimo: ${p.stockMinimo})`).join('\n');
                      }
                    }
                  } catch (invErr) {
                    console.error("Error cargando inventario para reporte:", invErr);
                  }

                  const fechaCorte = lastCorte.fecha?.toDate ? lastCorte.fecha.toDate().toLocaleDateString('es-MX') : new Date().toLocaleDateString('es-MX');

                  const reportMsg = `✈️ *[YoY Billar - Reporte de Inteligencia]*\n\n` +
                                    `📊 *Resumen de Jornada Anterior*\n\n` +
                                    `👤 *Operador Cierre:* ${lastCorte.operador || 'Cajero'}\n` +
                                    `📅 *Fecha de Corte:* ${fechaCorte}\n\n` +
                                    `💵 *Flujo de Caja:*\n` +
                                    `• Ingresos Totales: *$${(lastCorte.totalIngresos || 0).toLocaleString('es-MX')}*\n` +
                                    `• Egresos / Gastos: *$${(lastCorte.totalGastos || 0).toLocaleString('es-MX')}*\n` +
                                    `• Efectivo Esperado: *$${(lastCorte.efectivoEsperado || 0).toLocaleString('es-MX')}*\n` +
                                    `• Efectivo Contado: *$${(lastCorte.efectivoContado || 0).toLocaleString('es-MX')}*\n` +
                                    `• Diferencia: *${lastCorte.diferencia >= 0 ? '+' : ''}$${(lastCorte.diferencia || 0).toLocaleString('es-MX')}* ${lastCorte.diferencia !== 0 ? '⚠️' : '✅'}\n\n` +
                                    `🤖 *Análisis IA del Negocio:*\n_${lastCorte.resumenIA || 'Sin resumen disponible.'}_\n\n` +
                                    `⚠️ *Alertas de Inventario Crítico:*\n${criticalInventoryText}`;

                  await sendTelegramAlert(reportMsg, tgData);
                  await updateDoc(doc(db, 'cortes_caja', lastCorteDoc.id), {
                    reporteEnviadoTelegram: true
                  });
                }
              }
            } catch (corteErr) {
              console.error("Error al procesar reporte de jornada anterior:", corteErr);
            }
          }
        } else {
          // B: Entrada de personal regular
          const alertMsg = `✈️ *[YoY Billar]*\n\n` +
                           `📥 *Pase de Lista - Entrada*\n` +
                           `👤 *Empleado:* ${nombre} (${rol || 'Staff'})\n` +
                           `📱 *Dispositivo:* \`${currentDevice}\`\n` +
                           `📅 *Hora:* ${nowStr}`;
          await sendTelegramAlert(alertMsg, tgData);
        }
      } else if (tipo === 'salida') {
        if (activeCount === 0) {
          // C: Transición 1 -> 0 (Último empleado en salir - Fin de Jornada)
          const alertMsg = `✈️ *[YoY Billar]*\n\n` +
                           `🔒 *Fin de Jornada / Cierre*\n` +
                           `👤 *Último empleado salió:* ${nombre} (${rol || 'Staff'})\n` +
                           `📱 *Dispositivo:* \`${currentDevice}\`\n` +
                           `📅 *Hora:* ${nowStr}\n\n` +
                           `⚠️ *La sucursal se encuentra vacía (sin personal activo).*`;
          await sendTelegramAlert(alertMsg, tgData);
        } else {
          // D: Salida de personal regular
          const alertMsg = `✈️ *[YoY Billar]*\n\n` +
                           `📤 *Pase de Lista - Salida*\n` +
                           `👤 *Empleado:* ${nombre} (${rol || 'Staff'})\n` +
                           `📱 *Dispositivo:* \`${currentDevice}\`\n` +
                           `📅 *Hora:* ${nowStr}`;
          await sendTelegramAlert(alertMsg, tgData);
        }
      }
    }

    return NextResponse.json({ success: true, activeCount });
  } catch (err) {
    console.error('Error en API attendance-alert:', err);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
import { NextResponse } from 'next/server';
import { db } from '@/lib/firebase';
import { doc, getDoc, getDocs, addDoc, setDoc, collection, query, where, serverTimestamp } from 'firebase/firestore';
import crypto from 'crypto';
import { deobfuscateWithKey } from '@/lib/crypto';
import { getBusinessDate } from '@/lib/date-utils';
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

const SECRET = process.env.QR_SECRET || 'yoy_billar_secret_key_2026_io';

const getDistanceInMeters = (lat1, lon1, lat2, lon2) => {
  const R = 6371e3; // Radio de la Tierra en metros
  const φ1 = lat1 * Math.PI / 180;
  const φ2 = lat2 * Math.PI / 180;
  const Δφ = (lat2 - lat1) * Math.PI / 180;
  const Δλ = (lon2 - lon1) * Math.PI / 180;

  const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
            Math.cos(φ1) * Math.cos(φ2) *
            Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
};

export async function POST(request) {
  try {
    const { token, payload, preCheck, accion } = await request.json();

    if (!token || !payload) {
      return NextResponse.json({ success: false, error: 'Parámetros incompletos o payload inválido' }, { status: 400 });
    }

    // Desofuscar el payload utilizando el token dinámico como clave RC4
    const decryptedPayload = deobfuscateWithKey(token, payload);
    if (!decryptedPayload) {
      return NextResponse.json({ success: false, error: 'Petición corrupta o clave incorrecta' }, { status: 400 });
    }

    const { empleadoId, expires, coordenadas, dispositivo } = decryptedPayload;

    if (!empleadoId || !expires) {
      return NextResponse.json({ success: false, error: 'Datos de payload incompletos' }, { status: 400 });
    }

    // 1. Validar firma criptográfica
    const expectedToken = crypto
      .createHmac('sha256', SECRET)
      .update(`${empleadoId}:${expires}`)
      .digest('hex');

    if (token !== expectedToken) {
      return NextResponse.json({ success: false, error: 'Código QR no válido o manipulado' }, { status: 401 });
    }

    // 2. Validar expiración (5 minutos)
    if (Date.now() > Number(expires)) {
      return NextResponse.json({ success: false, error: 'El código QR ha expirado' }, { status: 401 });
    }

    // 4. Obtener datos del empleado
    const empSnap = await fetchDocument('nomina_empleados', empleadoId);
    if (!empSnap.exists()) {
      return NextResponse.json({ success: false, error: 'Empleado no encontrado' }, { status: 404 });
    }
    const emp = { id: empleadoId, ...empSnap.data() };
    const fechaHoy = getBusinessDate();

    // 3. Obtener logs de asistencia de hoy para saber si está actualmente de turno
    const logsSnap = await fetchCollectionQuery('nomina_asistencia_log', [
      { type: 'where', field: 'empleadoId', op: '==', value: emp.id },
      { type: 'where', field: 'fecha', op: '==', value: fechaHoy }
    ]);
    
    let isCurrentlyCheckedIn = false;
    let autoTipoRegistro = 'entrada';
    
    if (!logsSnap.empty) {
      const logsList = logsSnap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(l => l.tipo === 'entrada' || l.tipo === 'salida');

      if (logsList.length > 0) {
        logsList.sort((a, b) => {
          const tA = a.createdAt?.toDate ? a.createdAt.toDate().getTime() : (a.createdAt || 0);
          const tB = b.createdAt?.toDate ? b.createdAt.toDate().getTime() : (b.createdAt || 0);
          return tB - tA;
        });
        const lastLog = logsList[0];
        isCurrentlyCheckedIn = lastLog.tipo === 'entrada';
        autoTipoRegistro = isCurrentlyCheckedIn ? 'salida' : 'entrada';
      }
    }

    // Si es preCheck, solo retornamos los datos del empleado y su estado actual sin consumir el token
    if (preCheck) {
      return NextResponse.json({
        success: true,
        emp,
        isCurrentlyCheckedIn
      });
    }

    // Protección Anti-Replay: Verificar si el token ya fue consumido (solo para acciones de fichaje/cambio)
    const tokenSnap = await fetchDocument('used_qr_tokens', token);
    if (tokenSnap.exists()) {
      return NextResponse.json({ success: false, error: 'Este código QR ya ha sido utilizado para registrar asistencia.' }, { status: 401 });
    }

    // Registrar token como consumido para evitar re-uso
    await saveDocument('used_qr_tokens', token, {
      empleadoId,
      usedAt: new Date(),
      expiresAt: Number(expires)
    });

    const finalCoordenadas = coordenadas || { lat: null, lng: null, precision: null, status: 'No requerido' };

    // Determinar tipo de registro final según el parámetro de la petición o auto-detección
    let tipoRegistro = autoTipoRegistro;
    if (accion === 'entrada' || accion === 'salida') {
      tipoRegistro = accion;
    } else if (accion === 'login_only') {
      tipoRegistro = 'login_only';
    }

    // Si la acción es únicamente iniciar sesión en el celular
    if (tipoRegistro === 'login_only') {
      return NextResponse.json({
        success: true,
        tipoRegistro: 'login_only',
        emp
      });
    }

    // Detección de Celular Inusual y Alerta por Telegram (sin bloquear)
    try {
      const allLogsSnap = await fetchCollectionQuery('nomina_asistencia_log', [
        { type: 'where', field: 'empleadoId', op: '==', value: emp.id }
      ]);
      const allLogs = allLogsSnap.docs.map(d => d.data());
      const phoneLogs = allLogs.filter(l => l.dispositivo && l.dispositivo !== 'PC/Terminal');

      const phoneCounts = {};
      phoneLogs.forEach(l => {
        phoneCounts[l.dispositivo] = (phoneCounts[l.dispositivo] || 0) + 1;
      });

      let mostFrequentPhone = '';
      let maxPhoneCount = 0;
      Object.keys(phoneCounts).forEach(phone => {
        if (phoneCounts[phone] > maxPhoneCount) {
          maxPhoneCount = phoneCounts[phone];
          mostFrequentPhone = phone;
        }
      });

      const currentDevice = dispositivo || 'Móvil';
      const isCelularInusual = phoneLogs.length >= 3 && 
                               currentDevice !== 'PC/Terminal' && 
                               currentDevice !== mostFrequentPhone;

      if (isCelularInusual) {
        const empSalonId = emp.salonId || 'default_salon';
        const tgSnap = await fetchDocument('config', `telegram_${empSalonId}`);
        if (tgSnap.exists()) {
          const tgData = tgSnap.data();
          const isSimplified = tgData.mode === 'simplified' || (!tgData.botToken && tgData.chatId);
          const hasCustom = tgData.mode === 'custom' && tgData.botToken && tgData.chatId;

          if (tgData.enabled && (isSimplified || hasCustom)) {
            // Obtener nombre de sucursal
            let branchName = 'Sucursal';
            try {
              const sucSnap = await fetchDocument('config', `sucursal_${empSalonId}`);
              if (sucSnap.exists() && sucSnap.data().nombre) {
                branchName = sucSnap.data().nombre;
              }
            } catch (err) {
              console.error("Error al cargar nombre de sucursal en verify-attendance:", err);
            }

            const messageText = `🏢 *[${branchName}]*\n\n` +
                                `⚠️ *Alerta de Fichaje Inusual*\n\n` +
                                `👤 *Empleado:* ${emp.nombre} ${emp.apellido || ''}\n` +
                                `🏷️ *Rol:* ${emp.rol || 'Mesero'}\n` +
                                `📥 *Evento:* ${tipoRegistro === 'entrada' ? 'ENTRADA' : 'SALIDA'}\n` +
                                `📱 *Celular Utilizado:* \`${currentDevice}\`\n` +
                                `🔄 *Celular Habitual:* \`${mostFrequentPhone}\`\n` +
                                `📅 *Fecha/Hora:* ${new Date().toLocaleString('es-MX', { timeZone: 'America/Mexico_City' })}\n\n` +
                                `🔗 *Acceder al Sistema:* [YoY IA Billar](https://yoy-ia-billar.vercel.app)`;
            
            const replyMarkup = {
              inline_keyboard: [
                [{ text: '⚠️ Registrar Incidencia', callback_data: `reportar_incidencia_${emp.id}` }]
              ]
            };

            const officialBotToken = process.env.TELEGRAM_OFFICIAL_BOT_TOKEN;
            if (isSimplified) {
              if (officialBotToken) {
                // Servidor central: resolver y enviar directamente
                const cleanPhone = (tgData.phone || '').replace(/\D/g, '');
                if (cleanPhone) {
                  const vincSnap = await fetchDocument('telegram_vinculaciones', cleanPhone);
                  if (vincSnap.exists()) {
                    const resolvedChatId = vincSnap.data().chatId;
                    fetch(`https://api.telegram.org/bot${officialBotToken}/sendMessage`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        chat_id: resolvedChatId,
                        text: messageText,
                        parse_mode: 'Markdown',
                        reply_markup: replyMarkup
                      })
                    }).catch(err => console.error("Telegram official sendMessage failed:", err));
                  }
                }
              } else {
                // Instancia clonada: reenviar a servidor central para resolución remota
                fetch('https://yoy-ia-billar.vercel.app/api/telegram/send-alert', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    mode: 'central-resolve',
                    phone: tgData.phone,
                    text: messageText,
                    reply_markup: replyMarkup
                  })
                }).catch(err => console.error("Telegram send-alert fetch failed:", err));
              }
            } else if (hasCustom) {
              // Bot personalizado
              fetch(`https://api.telegram.org/bot${tgData.botToken}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  chat_id: tgData.chatId,
                  text: messageText,
                  parse_mode: 'Markdown',
                  reply_markup: replyMarkup
                })
              }).catch(err => console.error("Telegram custom sendMessage failed:", err));
            }
          }
        }
      }
    } catch (tgErr) {
      console.error("Error al evaluar celular inusual o enviar a Telegram:", tgErr);
    }

    // 10. Registrar log de asistencia en Firestore
    await appendDocument('nomina_asistencia_log', {
      salonId: emp.salonId || null,
      empleadoId: emp.id,
      nombre: `${emp.nombre} ${emp.apellido || ''}`.trim(),
      rol: emp.rol || 'Mesero',
      fecha: fechaHoy,
      tipo: tipoRegistro,
      coordenadas: finalCoordenadas,
      dispositivo: dispositivo || 'Móvil'
    });

    // Disparar alertas de asistencia y de transición de jornada a Telegram
    try {
      const protocol = request.headers.get('x-forwarded-proto') || 'http';
      const host = request.headers.get('host') || 'localhost:3000';
      const alertUrl = `${protocol}://${host}/api/telegram/attendance-alert`;
      
      fetch(alertUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          empleadoId: emp.id,
          tipo: tipoRegistro,
          nombre: `${emp.nombre} ${emp.apellido || ''}`.trim(),
          rol: emp.rol || 'Mesero',
          dispositivo: dispositivo || 'Móvil'
        })
      }).catch(alertErr => {
        console.error("Error al disparar alerta de asistencia:", alertErr);
      });
    } catch (alertErr) {
      console.error("Error al disparar alerta de asistencia:", alertErr);
    }

    // 11. Registrar asistencia diaria legacy (solo Entrada)
    if (tipoRegistro === 'entrada') {
      const snapAsist = await fetchCollectionQuery('nomina_asistencia', [
        { type: 'where', field: 'empleadoId', op: '==', value: emp.id },
        { type: 'where', field: 'fecha', op: '==', value: fechaHoy }
      ]);
      if (snapAsist.empty) {
        await appendDocument('nomina_asistencia', {
          salonId: emp.salonId || null,
          empleadoId: emp.id,
          fecha: fechaHoy,
          estado: 'presente',
          coordenadas: finalCoordenadas
        });
      }
    }

    // 12. Registrar bitácora general de actividades
    await appendDocument('bitacora', {
      salonId: emp.salonId || null,
      fecha: new Date().toISOString(),
      accion: `Fichaje QR ${tipoRegistro === 'entrada' ? 'Entrada' : 'Salida'}`,
      detalle: `Fichaje QR: ${emp.nombre} (${emp.rol || 'Mesero'}) marcó ${tipoRegistro === 'entrada' ? 'entrada' : 'salida'} desde ${dispositivo || 'Móvil'}. Ubicación: Obtenido (Servidor)`,
      monto: 0,
      operador: emp.nombre,
      rolOperador: (emp.rol || 'mesero').toLowerCase()
    });

    return NextResponse.json({
      success: true,
      tipoRegistro,
      emp
    });
  } catch (error) {
    console.error('Error in verify-attendance route:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

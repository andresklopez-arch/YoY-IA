import { NextResponse } from 'next/server';
import { db } from '@/lib/firebase';
import { doc, getDoc, addDoc, collection, serverTimestamp } from 'firebase/firestore';

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

// Helper para encolar alertas fallidas en la colección telegram_alert_pending
async function enqueueFailedAlert(body, errorMsg, resolvedChatId, resolvedToken) {
  try {
    let { token, chatId, phone, text, mode } = body;
    
    // Usar valores resueltos si están disponibles
    const finalToken = token || resolvedToken || process.env.TELEGRAM_OFFICIAL_BOT_TOKEN;
    let finalChatId = chatId || resolvedChatId;
    
    // Si no tenemos chatId pero tenemos el teléfono, buscar vinculación
    if (!finalChatId && phone) {
      const cleanPhone = phone.replace(/\D/g, '');
      const vincRef = doc(db, 'telegram_vinculaciones', hashPhone(cleanPhone));
      const vincSnap = await getDoc(vincRef);
      if (vincSnap.exists()) {
        finalChatId = vincSnap.data().chatId;
      }
    }

    if (!finalToken || !finalChatId) {
      console.warn("No se pudo encolar alerta pendiente por falta de token o chatId:", { phone, mode });
      return;
    }

    await addDoc(collection(db, 'telegram_alert_pending'), {
      token: finalToken,
      chatId: finalChatId,
      phone: phone || null,
      text: text,
      mode: mode || 'custom',
      retries: 0,
      lastError: errorMsg,
      createdAt: new Date(),
      nextRetryAt: new Date() // Intentar de inmediato en el próximo barrido
    });
  } catch (err) {
    console.error("Error al encolar alerta en telegram_alert_pending:", err);
  }
}

export async function POST(request) {
  let body = {};
  let targetChatId = null;
  let targetToken = null;
  try {
    body = await request.json();
    let { token, chatId, phone, text, mode, sucursalName } = body;

    // Obtener nombre de sucursal si no viene en el body
    if (!sucursalName) {
      try {
        const sucRef = doc(db, 'config', 'sucursal');
        const sucSnap = await getDoc(sucRef);
        if (sucSnap.exists() && sucSnap.data().nombre) {
          sucursalName = sucSnap.data().nombre;
        }
      } catch (err) {
        console.error("Error al obtener sucursalName en send-alert:", err);
      }
    }

    // Prepend sucursal name multitenant prefix
    if (sucursalName && text && !text.startsWith('🏢')) {
      text = `🏢 *[${sucursalName}]*\n\n${text}`;
      body.text = text; // Actualizar en el cuerpo para guardarlo en la cola de pendientes
    }

    targetToken = token;
    targetChatId = chatId;

    // Obtener token oficial desde variables de entorno
    const officialBotToken = process.env.TELEGRAM_OFFICIAL_BOT_TOKEN;

    // Caso A: Resolviendo desde el Servidor Central (SaaS Hub)
    if (mode === 'central-resolve' || (mode === 'simplified' && officialBotToken)) {
      if (!phone) {
        return NextResponse.json({ error: 'Número de teléfono faltante para resolución central' }, { status: 400 });
      }

      // Limpiar teléfono
      const cleanPhone = phone.replace(/\D/g, '');
      
      // Buscar el chatId en la colección central de vinculaciones
      const vincRef = doc(db, 'telegram_vinculaciones', hashPhone(cleanPhone));
      const vincSnap = await getDoc(vincRef);

      if (vincSnap.exists()) {
        targetChatId = vincSnap.data().chatId;
        targetToken = officialBotToken || '7438459438:AAElh_L0K0kHDF9sd832jklsd-Central'; // fallback central token
      } else {
        return NextResponse.json({ 
          error: `El teléfono +${cleanPhone} no está vinculado con el Bot Central. Por favor abre Telegram, busca @YoYBillarBot y comparte tu contacto.` 
        }, { status: 404 });
      }
    } 
    // Caso B: Ejecutándose en una instancia cliente clonada (Modo Simplificado sin Token Central)
    else if (mode === 'simplified' && !officialBotToken) {
      if (!phone) {
        return NextResponse.json({ error: 'Número de teléfono de gerencia faltante en configuración' }, { status: 400 });
      }

      // Reenviar la petición al servidor central de ALR SaaS para que él la resuelva y envíe
      const centralUrl = 'https://yoy-ia-billar.vercel.app/api/telegram/send-alert';
      
      try {
        const resCentral = await fetch(centralUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            mode: 'central-resolve',
            phone: phone,
            text: text,
            reply_markup: body.reply_markup || undefined
          })
        });

        const dataCentral = await resCentral.json();
        if (resCentral.ok) {
          try {
            await addDoc(collection(db, 'telegram_alert_logs'), {
              phone: obfuscatePhone(phone),
              chatId: targetChatId || null,
              text: text,
              mode: mode || 'simplified',
              status: 'sent_via_central',
              createdAt: serverTimestamp()
            });
          } catch (logErr) {
            console.error("Error al registrar bitácora de alertas (Case B):", logErr);
          }
          return NextResponse.json({ success: true, fromCentral: true });
        } else {
          try {
            await addDoc(collection(db, 'telegram_alert_logs'), {
              phone: obfuscatePhone(phone),
              chatId: targetChatId || null,
              text: text,
              mode: mode || 'simplified',
              status: 'failed',
              error: dataCentral.error || 'Error central',
              createdAt: serverTimestamp()
            });
          } catch (logErr) {
            console.error("Error al registrar bitácora de alertas (Case B Failed):", logErr);
          }
          // Encolar alerta pendiente localmente
          await enqueueFailedAlert(body, dataCentral.error || 'Error central', targetChatId, targetToken);

          return NextResponse.json({ error: dataCentral.error || 'Error en el servidor central de SaaS' }, { status: resCentral.status });
        }
      } catch (errCentral) {
        console.error('Error al contactar al servidor central de SaaS:', errCentral);
        try {
          await addDoc(collection(db, 'telegram_alert_logs'), {
            phone: obfuscatePhone(phone),
            chatId: targetChatId || null,
            text: text,
            mode: mode || 'simplified',
            status: 'failed',
            error: 'No se pudo conectar con el servidor central: ' + errCentral.message,
            createdAt: serverTimestamp()
          });
        } catch (logErr) {
          console.error("Error al registrar bitácora de alertas (Case B Exception):", logErr);
        }
        // Encolar alerta pendiente localmente
        await enqueueFailedAlert(body, 'No se pudo conectar con el servidor central: ' + errCentral.message, targetChatId, targetToken);

        return NextResponse.json({ error: 'No se pudo conectar con el servidor central de ALR SaaS: ' + errCentral.message }, { status: 502 });
      }
    }

    // Caso C: Modo Personalizado (Custom Bot)
    if (!targetToken) {
      return NextResponse.json({ error: 'No se ha configurado el Token del Bot de Telegram.' }, { status: 400 });
    }

    if (!targetChatId) {
      return NextResponse.json({ error: 'Falta configurar o vincular el ID de Chat de Telegram.' }, { status: 400 });
    }

    // Enviar el mensaje a la API de Telegram
    const url = `https://api.telegram.org/bot${targetToken}/sendMessage`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: targetChatId,
        text: text,
        parse_mode: 'Markdown',
        reply_markup: body.reply_markup || undefined
      })
    });

    if (res.ok) {
      try {
        await addDoc(collection(db, 'telegram_alert_logs'), {
          phone: obfuscatePhone(phone),
          chatId: targetChatId || null,
          text: text,
          mode: mode || 'custom',
          status: 'sent',
          createdAt: serverTimestamp()
        });
      } catch (logErr) {
        console.error("Error al registrar bitácora de alertas (Success):", logErr);
      }
      return NextResponse.json({ success: true });
    } else {
      const errorData = await res.json();
      try {
        await addDoc(collection(db, 'telegram_alert_logs'), {
          phone: obfuscatePhone(phone),
          chatId: targetChatId || null,
          text: text,
          mode: mode || 'custom',
          status: 'failed',
          error: errorData.description || 'Error de Telegram',
          createdAt: serverTimestamp()
        });
      } catch (logErr) {
        console.error("Error al registrar bitácora de alertas (Failed):", logErr);
      }
      // Encolar alerta pendiente localmente
      await enqueueFailedAlert(body, errorData.description || 'Error de Telegram', targetChatId, targetToken);

      return NextResponse.json({ error: errorData.description || 'Error al enviar mensaje a Telegram' }, { status: res.status });
    }
  } catch (err) {
    console.error('Error en API send-alert:', err);
    try {
      await addDoc(collection(db, 'telegram_alert_logs'), {
        phone: obfuscatePhone(body.phone),
        chatId: targetChatId || body.chatId || null,
        text: body.text || '',
        mode: body.mode || 'unknown',
        status: 'failed',
        error: err.message,
        createdAt: serverTimestamp()
      });
    } catch (logErr) {
      console.error("Error al registrar bitácora de alertas (Catch):", logErr);
    }
    // Encolar alerta pendiente localmente
    await enqueueFailedAlert(body, err.message, targetChatId, targetToken);

    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

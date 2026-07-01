import { NextResponse } from 'next/server';
import { db } from '@/lib/firebase';
import { doc, getDoc, addDoc, collection, serverTimestamp } from 'firebase/firestore';
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
      const vincSnap = await fetchDocument('telegram_vinculaciones', hashPhone(cleanPhone));
      if (vincSnap.exists()) {
        finalChatId = vincSnap.data().chatId;
      }
    }

    if (!finalToken || !finalChatId) {
      console.warn("No se pudo encolar alerta pendiente por falta de token o chatId:", { phone, mode });
      return;
    }

    await appendDocument('telegram_alert_pending', {
      token: finalToken,
      chatId: finalChatId,
      phone: phone || null,
      text: text,
      mode: mode || 'custom',
      retries: 0,
      lastError: errorMsg,
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
        const salonId = body.salonId || 'default_salon';
        const sucSnap = await fetchDocument('config', `sucursal_${salonId}`);
        if (sucSnap.exists() && sucSnap.data().nombre) {
          sucursalName = sucSnap.data().nombre;
        } else {
          // Fallback al sucursal global por compatibilidad
          const globalSucSnap = await fetchDocument('config', 'sucursal');
          if (globalSucSnap.exists() && globalSucSnap.data().nombre) {
            sucursalName = globalSucSnap.data().nombre;
          }
        }
      } catch (err) {
        console.error("Error al obtener sucursalName en send-alert:", err);
      }
    }

    // Prepend sucursal name multitenant prefix
    if (sucursalName && text && !text.startsWith('🏢')) {
      text = `🏢 *[${sucursalName}]*\n\n${text}`;
    }

    // Append YoY app link signature
    if (text && !text.includes('yoy-ia-billar.vercel.app')) {
      text = `${text}\n\n🔗 *Acceder al Sistema:* [YoY IA Billar](https://yoy-ia-billar.vercel.app)`;
    }
    body.text = text;

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
      const vincSnap = await fetchDocument('telegram_vinculaciones', hashPhone(cleanPhone));

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
        await appendDocument('telegram_alert_logs', {
          phone: obfuscatePhone(phone),
          chatId: targetChatId || null,
          text: text,
          mode: mode || 'simplified',
          status: 'sent_via_central'
        });
      } catch (logErr) {
        console.error("Error al registrar bitácora de alertas (Case B):", logErr);
      }
      return NextResponse.json({ success: true, fromCentral: true });
    } else {
      try {
        await appendDocument('telegram_alert_logs', {
          phone: obfuscatePhone(phone),
          chatId: targetChatId || null,
          text: text,
          mode: mode || 'simplified',
          status: 'failed',
          error: dataCentral.error || 'Error central'
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
      await appendDocument('telegram_alert_logs', {
        phone: obfuscatePhone(phone),
        chatId: targetChatId || null,
        text: text,
        mode: mode || 'simplified',
        status: 'failed',
        error: 'No se pudo conectar con el servidor central: ' + errCentral.message
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

    // Enviar el mensaje o foto a la API de Telegram
    const isPhoto = !!body.photo;
    const method = isPhoto ? 'sendPhoto' : 'sendMessage';
    const url = `https://api.telegram.org/bot${targetToken}/${method}`;
    const payload = isPhoto ? {
      chat_id: targetChatId,
      photo: body.photo,
      caption: text,
      parse_mode: 'Markdown',
      reply_markup: body.reply_markup || undefined
    } : {
      chat_id: targetChatId,
      text: text,
      parse_mode: 'Markdown',
      reply_markup: body.reply_markup || undefined
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (res.ok) {
      try {
        await appendDocument('telegram_alert_logs', {
          phone: obfuscatePhone(phone),
          chatId: targetChatId || null,
          text: text,
          mode: mode || 'custom',
          status: 'sent'
        });
      } catch (logErr) {
        console.error("Error al registrar bitácora de alertas (Success):", logErr);
      }
      return NextResponse.json({ success: true });
    } else {
      const errorData = await res.json();
      try {
        await appendDocument('telegram_alert_logs', {
          phone: obfuscatePhone(phone),
          chatId: targetChatId || null,
          text: text,
          mode: mode || 'custom',
          status: 'failed',
          error: errorData.description || 'Error de Telegram'
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
      await appendDocument('telegram_alert_logs', {
        phone: obfuscatePhone(body.phone),
        chatId: targetChatId || body.chatId || null,
        text: body.text || '',
        mode: body.mode || 'unknown',
        status: 'failed',
        error: err.message
      });
    } catch (logErr) {
      console.error("Error al registrar bitácora de alertas (Catch):", logErr);
    }
    // Encolar alerta pendiente localmente
    await enqueueFailedAlert(body, err.message, targetChatId, targetToken);

    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

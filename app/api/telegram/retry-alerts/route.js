import { NextResponse } from 'next/server';
import { db } from '@/lib/firebase';
import { collection, query, where, getDocs, doc, deleteDoc, updateDoc, addDoc, serverTimestamp } from 'firebase/firestore';

function obfuscatePhone(phone) {
  if (!phone) return null;
  const clean = phone.replace(/\D/g, '');
  if (clean.length <= 4) return `+${clean}`;
  const start = clean.slice(0, 2);
  const end = clean.slice(-4);
  return `+${start}******${end}`;
}

// Función para enviar notificaciones de respaldo (SMS / Email) en fallas definitivas (Sugerencia 3)
async function sendBackupNotification(data, errorMsg) {
  try {
    // 1. Guardar siempre en la colección de emergencia para auditoría
    await addDoc(collection(db, 'alertas_emergencia'), {
      originalAlert: {
        phone: obfuscatePhone(data.phone),
        chatId: data.chatId || null,
        text: data.text,
        mode: data.mode || 'unknown'
      },
      lastError: errorMsg,
      failedAt: new Date(),
      status: 'pending_manual_review'
    });

    console.warn("Alerta crítica de Telegram falló permanentemente. Registrado en alertas_emergencia.");

    // 2. Intentar enviar correo con SendGrid si está configurado en variables de entorno
    if (process.env.SENDGRID_API_KEY && process.env.ADMIN_EMAIL) {
      await fetch('https://api.sendgrid.com/v3/mail/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.SENDGRID_API_KEY}`
        },
        body: JSON.stringify({
          personalizations: [{ to: [{ email: process.env.ADMIN_EMAIL }] }],
          from: { email: 'soporte@yoybillar.com', name: 'YoY Billar Alertas' },
          subject: '⚠️ ALERTA DE EMERGENCIA - Falla en Alerta Telegram YoY Billar',
          content: [{
            type: 'text/plain',
            value: `La siguiente alerta no pudo ser entregada a Telegram tras 5 reintentos:\n\n${data.text}\n\nError reportado:\n${errorMsg}`
          }]
        })
      });
    }

    // 3. Intentar enviar SMS con Twilio si está configurado en variables de entorno
    if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_TO_NUMBER && process.env.TWILIO_FROM_NUMBER) {
      const auth = Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64');
      const bodyParams = new URLSearchParams();
      bodyParams.append('To', process.env.TWILIO_TO_NUMBER);
      bodyParams.append('From', process.env.TWILIO_FROM_NUMBER);
      bodyParams.append('Body', `⚠️ ALERTA YoY Billar: Telegram falló. Detalle: ${data.text.substring(0, 100)}...`);

      await fetch(`https://api.twilio.com/2010-04-01/Accounts/${process.env.TWILIO_ACCOUNT_SID}/Messages.json`, {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: bodyParams
      });
    }
  } catch (backupErr) {
    console.error("Fallo al despachar notificación de respaldo de emergencia:", backupErr);
  }
}

export async function GET(request) {
  try {
    // Validación de Token de Seguridad (Sugerencia 2)
    const authHeader = request.headers.get('Authorization');
    const expectedToken = process.env.TELEGRAM_RETRY_SECRET || 'central-retry-secret-key-2026';
    if (!authHeader || authHeader !== `Bearer ${expectedToken}`) {
      return NextResponse.json({ error: 'No autorizado. Token de seguridad inválido.' }, { status: 401 });
    }

    const now = new Date();
    
    // Consultar alertas pendientes cuya fecha programada de reintento ya haya expirado
    const q = query(
      collection(db, 'telegram_alert_pending'),
      where('nextRetryAt', '<=', now)
    );
    const snap = await getDocs(q);
    const results = [];

    for (const d of snap.docs) {
      const data = d.data();
      const alertId = d.id;
      
      let success = false;
      let errorMsg = '';
      
      try {
        // Enviar a Telegram
        const url = `https://api.telegram.org/bot${data.token}/sendMessage`;
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: data.chatId,
            text: data.text,
            parse_mode: 'Markdown'
          })
        });

        if (res.ok) {
          success = true;
        } else {
          const errData = await res.json();
          errorMsg = errData.description || 'Error de Telegram';
        }
      } catch (tgErr) {
        errorMsg = tgErr.message;
      }

      if (success) {
        // Borrar de pendientes e insertar en logs
        await deleteDoc(doc(db, 'telegram_alert_pending', alertId));
        await addDoc(collection(db, 'telegram_alert_logs'), {
          phone: obfuscatePhone(data.phone),
          chatId: data.chatId || null,
          text: data.text,
          mode: data.mode || 'custom',
          status: 'sent_after_retry',
          retries: (data.retries || 0) + 1,
          createdAt: serverTimestamp()
        });
        results.push({ id: alertId, status: 'sent' });
      } else {
        const nextRetries = (data.retries || 0) + 1;
        if (nextRetries >= 5) {
          // Descartar de pendientes tras 5 intentos fallidos
          await deleteDoc(doc(db, 'telegram_alert_pending', alertId));
          await addDoc(collection(db, 'telegram_alert_logs'), {
            phone: obfuscatePhone(data.phone),
            chatId: data.chatId || null,
            text: data.text,
            mode: data.mode || 'custom',
            status: 'failed_permanently',
            retries: nextRetries,
            error: errorMsg,
            createdAt: serverTimestamp()
          });
          
          // Despachar a canales de respaldo de emergencia (SMS/Email/Firestore)
          await sendBackupNotification(data, errorMsg);

          results.push({ id: alertId, status: 'failed_permanently', error: errorMsg });
        } else {
          // Incrementar conteo de intentos y programar con backoff exponencial
          const delayMinutes = Math.pow(2, nextRetries); // 2, 4, 8, 16 minutos
          const nextRetryDate = new Date();
          nextRetryDate.setMinutes(nextRetryDate.getMinutes() + delayMinutes);
          
          await updateDoc(doc(db, 'telegram_alert_pending', alertId), {
            retries: nextRetries,
            lastError: errorMsg,
            nextRetryAt: nextRetryDate
          });
          results.push({ id: alertId, status: 'retry_scheduled', retries: nextRetries, nextRetryAt: nextRetryDate });
        }
      }
    }

    return NextResponse.json({ processed: results.length, details: results });
  } catch (err) {
    console.error("Error en API retry-alerts:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

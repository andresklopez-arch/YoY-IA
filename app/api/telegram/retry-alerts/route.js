import { NextResponse } from 'next/server';
import { db } from '@/lib/firebase';
import { collection, query, where, getDocs, doc, deleteDoc, updateDoc, addDoc, serverTimestamp } from 'firebase/firestore';

export async function GET() {
  try {
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
          phone: data.phone || null,
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
          // Descartar permanentemente tras 5 intentos fallidos
          await deleteDoc(doc(db, 'telegram_alert_pending', alertId));
          await addDoc(collection(db, 'telegram_alert_logs'), {
            phone: data.phone || null,
            chatId: data.chatId || null,
            text: data.text,
            mode: data.mode || 'custom',
            status: 'failed_permanently',
            retries: nextRetries,
            error: errorMsg,
            createdAt: serverTimestamp()
          });
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

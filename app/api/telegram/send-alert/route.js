import { NextResponse } from 'next/server';
import { db } from '@/lib/firebase';
import { doc, getDoc } from 'firebase/firestore';

export async function POST(request) {
  try {
    const body = await request.json();
    const { token, chatId, phone, text, mode } = body;

    let targetToken = token;
    let targetChatId = chatId;

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
      const vincRef = doc(db, 'telegram_vinculaciones', cleanPhone);
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
            text: text
          })
        });

        const dataCentral = await resCentral.json();
        if (resCentral.ok) {
          return NextResponse.json({ success: true, fromCentral: true });
        } else {
          return NextResponse.json({ error: dataCentral.error || 'Error en el servidor central de SaaS' }, { status: resCentral.status });
        }
      } catch (errCentral) {
        console.error('Error al contactar al servidor central de SaaS:', errCentral);
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
        parse_mode: 'Markdown'
      })
    });

    if (res.ok) {
      return NextResponse.json({ success: true });
    } else {
      const errorData = await res.json();
      return NextResponse.json({ error: errorData.description || 'Error al enviar mensaje a Telegram' }, { status: res.status });
    }
  } catch (err) {
    console.error('Error en API send-alert:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

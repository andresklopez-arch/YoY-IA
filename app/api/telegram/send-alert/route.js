import { NextResponse } from 'next/server';

export async function POST(request) {
  try {
    const body = await request.json();
    const { token, chatId, text, mode } = body;

    let targetToken = token;
    let targetChatId = chatId;

    if (mode === 'simplified') {
      // Token del Bot Oficial Centralizado de YoY Billar
      // Si no está definido en las variables de entorno, usamos el bot central por defecto
      targetToken = process.env.TELEGRAM_OFFICIAL_BOT_TOKEN || '7438459438:AAElh_L0K0kHDF9sd832jklsd-Central'; 
    }

    if (!targetToken) {
      return NextResponse.json({ error: 'No se ha configurado el Token del Bot Oficial de Telegram.' }, { status: 400 });
    }

    if (!targetChatId) {
      return NextResponse.json({ error: 'Falta configurar o vincular el ID de Chat de Telegram.' }, { status: 400 });
    }

    const url = `https://api.telegram.org/bot${targetToken}/sendMessage`;
    const res = await fetch(resUrl => {
      // Usaremos try-catch o fetch normal
    });
    const responseTelegram = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: targetChatId,
        text: text,
        parse_mode: 'Markdown'
      })
    });

    if (responseTelegram.ok) {
      return NextResponse.json({ success: true });
    } else {
      const errorData = await responseTelegram.json();
      return NextResponse.json({ error: errorData.description || 'Error al enviar mensaje a Telegram' }, { status: responseTelegram.status });
    }
  } catch (err) {
    console.error('Error en API send-alert:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

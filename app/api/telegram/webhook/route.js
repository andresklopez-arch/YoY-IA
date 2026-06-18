import { NextResponse } from 'next/server';
import { db } from '@/lib/firebase';
import { doc, setDoc } from 'firebase/firestore';

export async function POST(request) {
  try {
    const update = await request.json();
    console.log('Recibido update de Telegram:', JSON.stringify(update));

    const message = update.message;
    if (!message) {
      return NextResponse.json({ ok: true });
    }

    const chatId = message.chat.id;
    const text = message.text;
    const contact = message.contact;

    const botToken = process.env.TELEGRAM_OFFICIAL_BOT_TOKEN || '7438459438:AAElh_L0K0kHDF9sd832jklsd-Central';

    // 1. Manejar el comando de Inicio /start
    if (text && text.startsWith('/start')) {
      const welcomeText = `👋 *¡Hola! Bienvenido al Bot Central de YoY Billar.*\n\nPara poder enviarte alertas en tiempo real (de caja, stock, seguridad) a este chat sin configuraciones complejas, necesitamos verificar tu número telefónico.\n\nPresiona el botón de abajo 👇 para compartir tu contacto.`;
      
      const replyMarkup = {
        keyboard: [
          [{ text: '📱 Compartir Número Telefónico', request_contact: true }]
        ],
        one_time_keyboard: true,
        resize_keyboard: true
      };

      await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: welcomeText,
          parse_mode: 'Markdown',
          reply_markup: replyMarkup
        })
      });

      return NextResponse.json({ ok: true });
    }

    // 2. Manejar la recepción del contacto telefónico compartido
    if (contact) {
      const rawPhone = contact.phone_number;
      // Limpiar el teléfono para dejar solo dígitos (ej. +52 1 55... -> 52155...)
      const cleanPhone = rawPhone.replace(/\D/g, '');

      // Guardar la vinculación en Firestore en la colección centralizada
      const vinculacionRef = doc(db, 'telegram_vinculaciones', cleanPhone);
      await setDoc(vinculacionRef, {
        chatId: chatId.toString(),
        phone: cleanPhone,
        nombre: contact.first_name || '',
        updatedAt: new Date().toISOString()
      }, { merge: true });

      const successText = `✅ *¡Vinculación Exitosa!*\n\nTu número *+${cleanPhone}* ha sido enlazado a este chat de Telegram.\n\nAhora ya puedes ingresar este número telefónico en el panel de **Configuración -> Alertas Telegram** de tu billar para empezar a recibir notificaciones automáticas.`;
      
      // Remover el teclado personalizado y confirmar al usuario
      await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: successText,
          parse_mode: 'Markdown',
          reply_markup: { remove_keyboard: true }
        })
      });

      return NextResponse.json({ ok: true });
    }

    // Respuesta por defecto para otros mensajes
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('Error en Webhook de Telegram:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

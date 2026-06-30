import { NextResponse } from 'next/server';
import { db } from '@/lib/firebase';
import { doc, setDoc, getDoc, collection, query, where, getDocs, addDoc } from 'firebase/firestore';

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

function ipToLong(ip) {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some(isNaN)) return 0;
  return (parts[0] * 16777216) + (parts[1] * 65536) + (parts[2] * 256) + parts[3];
}

function isTelegramIp(ip) {
  if (!ip) return false;
  let cleanIp = ip.split(',')[0].trim();
  if (cleanIp.startsWith('::ffff:')) {
    cleanIp = cleanIp.substring(7);
  }
  const ipLong = ipToLong(cleanIp);
  if (ipLong === 0) return false;

  const start1 = ipToLong('149.154.160.0');
  const end1 = ipToLong('149.154.175.255');
  const start2 = ipToLong('91.108.4.0');
  const end2 = ipToLong('91.108.7.255');

  return (ipLong >= start1 && ipLong <= end1) || (ipLong >= start2 && ipLong <= end2);
}

export async function POST(request) {
  // IP Whitelisting for Telegram Webhook (only in production)
  if (process.env.NODE_ENV === 'production') {
    const clientIp = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || '';
    if (!isTelegramIp(clientIp)) {
      console.warn(`[Webhook Telegram Blocked] IP no autorizada: ${clientIp}`);
      return NextResponse.json({ error: 'Unauthorized IP' }, { status: 401 });
    }
  }

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

    // Sugerencia 1: Rate Limiter en Firestore
    if (chatId) {
      try {
        const now = Date.now();
        const limitRef = doc(db, 'telegram_rate_limit', chatId.toString());
        const limitSnap = await getDoc(limitRef);
        if (limitSnap.exists()) {
          const lastTime = limitSnap.data().timestamp;
          if (now - lastTime < 1000) { // Máximo 1 petición por segundo
            console.warn(`[Webhook Telegram Rate Limit] Silenciando petición para chatId: ${chatId}`);
            return NextResponse.json({ ok: true });
          }
        }
        await setDoc(limitRef, { timestamp: now });
      } catch (errLim) {
        console.error("Error en rate limiter:", errLim);
      }
    }

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

    // 1b. Manejar comando de ayuda /ayuda o /help
    if (text && (text.startsWith('/ayuda') || text.startsWith('/help'))) {
      const helpText = `ℹ️ *Ayuda - Bot Central de YoY Billar*\n\n` +
                       `Este bot centralizado te permite recibir alertas de tu sucursal sin tener que crear tu propio bot en Telegram.\n\n` +
                       `*¿Cómo funciona la vinculación?*\n` +
                       `1. Usa el comando /start o presiona "Compartir Número Telefónico".\n` +
                       `2. El bot registrará la relación entre tu número y tu chat.\n` +
                       `3. En el sistema de tu billar (**Configuración -> Alertas Telegram**), ingresa tu número telefónico a 10 dígitos.\n` +
                       `4. ¡Listo! Recibirás notificaciones de inmediato.\n\n` +
                       `*¿Qué alertas recibiré?*\n` +
                       `• ⚠️ *Asistencias inusuales:* Si un empleado registra entrada/salida desde un teléfono no habitual.\n` +
                       `• 💸 *Cortes de Caja y Gastos:* Reportes detallados al registrar gastos de nómina.\n` +
                       `• 📦 *Alertas de Stock:* Insumos bajos.\n\n` +
                       `*Comandos disponibles:*\n` +
                       `• /start - Iniciar el proceso de vinculación compartiendo tu contacto.\n` +
                       `• /ayuda o /help - Mostrar este mensaje de ayuda.\n` +
                       `• /estado - Consultar el estado operativo del billar (Gerentes autorizados).`;

      await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: helpText,
          parse_mode: 'Markdown'
        })
      });

      return NextResponse.json({ ok: true });
    }

    // 1c. Manejar comando de consulta de estado /estado
    if (text && text.startsWith('/estado')) {
      // Verificar vinculación en Firestore
      const q = query(collection(db, 'telegram_vinculaciones'), where('chatId', '==', chatId.toString()));
      const snap = await getDocs(q);
      
      let isAuthorized = false;
      let userPhoneObfuscated = '';
      if (!snap.empty) {
        userPhoneObfuscated = snap.docs[0].data().phoneObfuscated || '';
        const userHash = snap.docs[0].id;
        
        // Verificar si el teléfono coincide con el configurado como gerente en config/telegram
        const tgRef = doc(db, 'config', 'telegram');
        const tgSnap = await getDoc(tgRef);
        if (tgSnap.exists()) {
          const tgData = tgSnap.data();
          const cleanManagerPhone = (tgData.phone || '').replace(/\D/g, '');
          const managerHash = hashPhone(cleanManagerPhone);
          if (managerHash === userHash || chatId.toString() === tgData.chatId?.toString()) {
            isAuthorized = true;
          }
        }
      }

      if (!isAuthorized) {
        await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: `❌ *Acceso Denegado*\n\nEste chat de Telegram o tu número de teléfono (${userPhoneObfuscated ? userPhoneObfuscated : 'No vinculado'}) no está configurado como gerente en el panel de administración del billar.\n\nPor favor comparte tu contacto usando /start o configura tu número en la app.`,
            parse_mode: 'Markdown'
          })
        });
        return NextResponse.json({ ok: true });
      }

      // Obtener estado operativo
      let activeTables = 0;
      let freeTables = 0;
      let totalTables = 0;
      
      const mesasSnap = await getDoc(doc(db, 'config', 'mesas_estado'));
      if (mesasSnap.exists()) {
        const list = mesasSnap.data().mesas || [];
        totalTables = list.length;
        activeTables = list.filter(m => m.estado === 'ocupada').length;
        freeTables = list.filter(m => m.estado === 'libre').length;
      }

      const qOrders = query(
        collection(db, 'mesa_pedidos'),
        where('tipo', '==', 'pedido'),
        where('estado', 'in', ['pendiente', 'listo', 'en_camino'])
      );
      const ordersSnap = await getDocs(qOrders);
      const activeOrders = ordersSnap.size;

      const qAlerts = query(
        collection(db, 'mesa_pedidos'),
        where('tipo', 'in', ['asistencia', 'cuenta']),
        where('estado', '==', 'pendiente')
      );
      const alertsSnap = await getDocs(qAlerts);
      const activeAlerts = alertsSnap.size;

      // Obtener nombre de sucursal
      let branchName = 'YoY Billar';
      const sucSnap = await getDoc(doc(db, 'config', 'sucursal'));
      if (sucSnap.exists() && sucSnap.data().nombre) {
        branchName = sucSnap.data().nombre;
      }

      const statusText = `📊 *Estado Operativo - ${branchName}*\n\n` +
                         `🎱 *Mesas Ocupadas:* ${activeTables} / ${totalTables}\n` +
                         `🟢 *Mesas Libres:* ${freeTables}\n` +
                         `🍔 *Comandas Activas:* ${activeOrders}\n` +
                         `🛎️ *Asistencias/Cuentas Pendientes:* ${activeAlerts}\n\n` +
                         `🕒 *Actualizado:* ${new Date().toLocaleString('es-MX', { timeZone: 'America/Mexico_City' })}`;

      await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: statusText,
          parse_mode: 'Markdown'
        })
      });

      // Registrar evento en la bitácora del billar
      try {
        await addDoc(collection(db, 'bitacora'), {
          salonId: 'central',
          fecha: new Date().toISOString(),
          accion: 'Consulta Telegram',
          detalle: `El gerente consultó el estado operativo del salón desde Telegram (${userPhoneObfuscated || 'ID: ' + chatId}).`,
          monto: 0,
          operador: snap.docs[0].data().nombre || 'Gerente Telegram',
          rolOperador: 'gerente'
        });
      } catch (logErr) {
        console.error("Error al registrar consulta en la bitácora:", logErr);
      }

      return NextResponse.json({ ok: true });
    }

    // 2. Manejar la recepción del contacto telefónico compartido
    if (contact) {
      const rawPhone = contact.phone_number;
      // Limpiar el teléfono para dejar solo dígitos (ej. +52 1 55... -> 52155...)
      const cleanPhone = rawPhone.replace(/\D/g, '');

      // Guardar la vinculación en Firestore en la colección centralizada
      const vinculacionRef = doc(db, 'telegram_vinculaciones', hashPhone(cleanPhone));
      await setDoc(vinculacionRef, {
        chatId: chatId.toString(),
        phoneObfuscated: obfuscatePhone(cleanPhone),
        nombre: contact.first_name || '',
        updatedAt: new Date().toISOString()
      }, { merge: true });

      const successText = `✅ *¡Vinculación Exitosa!*\n\nTu número *${obfuscatePhone(cleanPhone)}* ha sido enlazado a este chat de Telegram.\n\nAhora ya puedes ingresar este número telefónico en el panel de **Configuración -> Alertas Telegram** de tu billar para empezar a recibir notificaciones automáticas.`;
      
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

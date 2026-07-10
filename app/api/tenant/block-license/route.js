import { NextResponse } from 'next/server';
import { getApps, initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import fs from 'fs';
import path from 'path';

let isAdminConfigured = false;
try {
  if (!getApps().length) {
    let serviceAccount = null;
    const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT;
    const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'yoy-ia-billar';

    if (serviceAccountJson) {
      let cleanJson = serviceAccountJson.replace(/\r?\n/g, '').trim();
      if (!cleanJson.startsWith('{')) {
        cleanJson = '{' + cleanJson;
      }
      if (!cleanJson.endsWith('}')) {
        cleanJson = cleanJson + '}';
      }
      serviceAccount = JSON.parse(cleanJson);
    } else {
      const localKeyPath = path.join(process.cwd(), 'serviceAccountKey.json');
      if (fs.existsSync(localKeyPath)) {
        serviceAccount = JSON.parse(fs.readFileSync(localKeyPath, 'utf8'));
      }
    }

    if (serviceAccount) {
      initializeApp({
        credential: cert(serviceAccount),
        projectId
      });
      isAdminConfigured = true;
    } else {
      initializeApp({ projectId });
      isAdminConfigured = true;
    }
  } else {
    isAdminConfigured = true;
  }
} catch (e) {
  console.warn("Firebase Admin SDK no se pudo inicializar en block-license:", e.message);
}

export async function POST(request) {
  try {
    if (!isAdminConfigured) {
      return NextResponse.json({ error: 'Firebase Admin SDK no configurado en el servidor' }, { status: 500 });
    }

    // 1. Autorización: verificar que sea masteradmin
    const authHeader = request.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'No autorizado. Se requiere token JWT.' }, { status: 401 });
    }

    const token = authHeader.split('Bearer ')[1];
    let decodedToken;
    try {
      decodedToken = await getAuth().verifyIdToken(token);
      if (decodedToken.email !== 'masteradmin@yoybillar.mx' && !decodedToken.email.startsWith('masteradmin@')) {
        return NextResponse.json({ error: 'Prohibido. Se requieren privilegios de Master Admin.' }, { status: 403 });
      }
    } catch (err) {
      return NextResponse.json({ error: 'Token JWT inválido o expirado.' }, { status: 401 });
    }

    const { salonId, motivo } = await request.json();

    if (!salonId) {
      return NextResponse.json({ error: 'Faltan parámetros requeridos: salonId' }, { status: 400 });
    }

    const db = getFirestore();
    const cleanSalonId = salonId.trim().toLowerCase();

    // 2. Buscar licencia actual
    const licRef = db.collection('saas_licencias').doc(cleanSalonId);
    const licSnap = await licRef.get();
    if (!licSnap.exists) {
      return NextResponse.json({ error: `No existe licencia para el salón ${cleanSalonId}.` }, { status: 404 });
    }

    const licData = licSnap.data();
    const ahoraIso = new Date().toISOString();
    const motivoBloqueo = motivo || 'Bloqueado manualmente por el administrador maestro';

    // 3. Bloquear licencia
    await licRef.update({
      active: false,
      bloqueada: true,
      motivoBloqueo,
      lastVerified: ahoraIso
    });

    // 4. Registrar en la bitácora
    const provSnap = await db.collection('provisioning_logs')
      .where('salonId', '==', cleanSalonId)
      .limit(1)
      .get();
    
    let nombre = cleanSalonId;
    let embajador = 'Alfonso Iturbide';
    if (!provSnap.empty) {
      const pData = provSnap.docs[0].data();
      nombre = pData.nombre || nombre;
      embajador = pData.embajador || embajador;
    }

    await db.collection('provisioning_logs').add({
      salonId: cleanSalonId,
      nombre,
      embajador,
      numeroLicencia: licData.numeroLicencia || '',
      fechaVencimiento: licData.fechaVencimiento || ahoraIso,
      creadoPor: decodedToken.email,
      fecha: ahoraIso,
      status: 'bloqueado',
      motivo: motivoBloqueo
    });

    // 5. Enviar alerta a Telegram de la directiva (Sugerencia 2)
    try {
      const masterTgDoc = await db.collection('config').doc('telegram').get();
      if (masterTgDoc.exists) {
        const tgData = masterTgDoc.data();
        if (tgData.enabled && tgData.botToken && tgData.chatId) {
          const messageText = `🔒 *[ALR SaaS] Salón Bloqueado Manualmente*\n\n` +
                              `• *ID:* \`${cleanSalonId}\`\n` +
                              `• *Nombre:* ${nombre}\n` +
                              `• *Embajador:* ${embajador}\n` +
                              `• *Motivo:* ${motivoBloqueo}\n` +
                              `• *Bloqueado por:* ${decodedToken.email}`;
          
          await fetch(`https://api.telegram.org/bot${tgData.botToken}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: tgData.chatId,
              text: messageText,
              parse_mode: 'Markdown'
            })
          });
        }
      }
    } catch (tgErr) {
      console.warn("Fallo al enviar alerta de bloqueo a Telegram:", tgErr.message);
    }

    return NextResponse.json({
      success: true,
      bloqueada: true,
      motivoBloqueo
    });
  } catch (err) {
    console.error("Error al bloquear licencia:", err);
    return NextResponse.json({ error: 'Error interno de servidor', detalle: err.message }, { status: 500 });
  }
}

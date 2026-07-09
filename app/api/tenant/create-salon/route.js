import { NextResponse } from 'next/server';
import { getApps, initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import fs from 'fs';
import path from 'path';

// Inicializar Firebase Admin SDK
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
  console.warn("Firebase Admin SDK no se pudo inicializar en create-salon:", e.message);
}

export async function POST(request) {
  try {
    if (!isAdminConfigured) {
      return NextResponse.json({ error: 'Firebase Admin SDK no configurado en el servidor' }, { status: 500 });
    }

    // 1. Autorización: verificar que sea masteradmin o venga de ALR SaaS autorizado
    const authHeader = request.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'No autorizado. Se requiere token JWT.' }, { status: 401 });
    }

    const token = authHeader.split('Bearer ')[1];
    try {
      const decodedToken = await getAuth().verifyIdToken(token);
      if (decodedToken.email !== 'masteradmin@yoybillar.mx' && !decodedToken.email.startsWith('masteradmin@')) {
        return NextResponse.json({ error: 'Prohibido. Se requieren privilegios de Master Admin.' }, { status: 403 });
      }
    } catch (err) {
      return NextResponse.json({ error: 'Token JWT inválido o expirado.' }, { status: 401 });
    }

    const { salonId, nombre, direccion, embajador } = await request.json();

    if (!salonId || !nombre) {
      return NextResponse.json({ error: 'Faltan parámetros requeridos: salonId y nombre' }, { status: 400 });
    }

    const db = getFirestore();
    const cleanSalonId = salonId.trim().toLowerCase();

    // 2. Crear documento de Salón
    const salonRef = db.collection('salones').doc(cleanSalonId);
    const salonSnap = await salonRef.get();
    if (salonSnap.exists) {
      return NextResponse.json({ error: `El salón con ID ${cleanSalonId} ya existe.` }, { status: 409 });
    }

    const ahoraIso = new Date().toISOString();
    const vencimientoIso = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(); // 1 año de vigencia

    await salonRef.set({
      id: cleanSalonId,
      nombre: nombre.trim(),
      direccion: (direccion || '').trim(),
      embajador: (embajador || 'Alfonso Iturbide').trim(),
      status: 'activo',
      createdAt: ahoraIso
    });

    // 3. Crear Licencia SaaS de 1 año automáticamente
    const numLic = `ALR-2026-${Math.random().toString(36).substring(2, 6).toUpperCase()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
    await db.collection('licencias_saas').doc(cleanSalonId).set({
      numeroLicencia: numLic,
      fechaCreacion: ahoraIso,
      fechaVencimiento: vencimientoIso,
      status: 'activa',
      diasOfflineMaximo: 15,
      salonId: cleanSalonId,
      ultimaSincronizacion: ahoraIso,
      dispositivoFirma: 'ALR-SaaS-AutoProvisioning'
    });

    // 4. Inicializar configuraciones aisladas de marca blanca por defecto
    await db.collection('config').doc(`telegram_${cleanSalonId}`).set({
      enabled: false,
      mode: 'simplified',
      botToken: '',
      chatId: '',
      phone: '',
      notifyStatements: true,
      notifyPayments: true,
      notifyPrevShiftSummary: true,
      notifyAttendance: true,
      notifyDisruptiveAlerts: true,
      notifyPeriodicReport: true,
      discrepancyThreshold: 100,
      salonId: cleanSalonId
    });

    await db.collection('config').doc(`ia_alertas_${cleanSalonId}`).set({
      enabled: true,
      sensibilidad: 'normal',
      alertarDesviacionCierre: true,
      alertarMeseroInactivo: true,
      alertarConsumoAnormal: true,
      salonId: cleanSalonId
    });

    await db.collection('config').doc(`sucursal_${cleanSalonId}`).set({
      nombre: nombre.trim(),
      direccion: (direccion || '').trim(),
      telefono: '',
      embajador: (embajador || 'Alfonso Iturbide').trim(),
      salonId: cleanSalonId
    });

    // Inicializar estado de mesas vacío (8 mesas por defecto)
    const defaultMesas = Array.from({ length: 8 }, (_, i) => ({
      id: `mesa_${i + 1}`,
      numero: i + 1,
      nombre: `Mesa ${i + 1}`,
      activa: false,
      status: 'libre',
      comanda: null,
      totalAcumulado: 0
    }));

    await db.collection('config').doc(`mesas_estado_${cleanSalonId}`).set({
      mesas: defaultMesas,
      salonId: cleanSalonId,
      lastUpdated: ahoraIso
    });

    console.log(`[ALR SaaS] Salón ${cleanSalonId} creado, licenciado por 1 año e inicializado correctamente.`);

    return NextResponse.json({
      success: true,
      salonId: cleanSalonId,
      numeroLicencia: numLic,
      fechaVencimiento: vencimientoIso,
      message: 'Salón creado, licenciado por 1 año y configuraciones aisladas inicializadas con éxito.'
    });

  } catch (error) {
    console.error("Error en create-salon API:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

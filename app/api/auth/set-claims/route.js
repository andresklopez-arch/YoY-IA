import { NextResponse } from 'next/server';
import { getApps, initializeApp, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import fs from 'fs';
import path from 'path';

// Inicializar el SDK de administración de forma segura
let isAdminConfigured = false;
try {
  if (!getApps().length) {
    let serviceAccount = null;
    const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT;
    
    if (serviceAccountJson) {
      serviceAccount = JSON.parse(serviceAccountJson);
    } else {
      // Intentar cargar localmente desde la raíz del proyecto para desarrollo
      const localKeyPath = path.join(process.cwd(), 'serviceAccountKey.json');
      if (fs.existsSync(localKeyPath)) {
        serviceAccount = JSON.parse(fs.readFileSync(localKeyPath, 'utf8'));
      }
    }
    
    if (serviceAccount) {
      initializeApp({
        credential: cert(serviceAccount)
      });
      isAdminConfigured = true;
    } else {
      initializeApp();
      isAdminConfigured = true;
    }
  } else {
    isAdminConfigured = true;
  }
} catch (e) {
  console.warn("Firebase Admin SDK no se pudo inicializar (clave de cuenta de servicio no configurada):", e.message);
}

export async function POST(request) {
  try {
    const { uid, salonId } = await request.json();
    
    if (!uid || !salonId) {
      return NextResponse.json({ error: 'Faltan parametros: uid y salonId' }, { status: 400 });
    }

    if (isAdminConfigured) {
      const authHeader = request.headers.get('Authorization');
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return NextResponse.json({ error: 'No autorizado. Se requiere token JWT.' }, { status: 401 });
      }
      const token = authHeader.split('Bearer ')[1];
      try {
        const decodedToken = await getAuth().verifyIdToken(token);
        // El usuario solo puede actualizar sus propias claims, a menos que sea el admin principal
        if (decodedToken.uid !== uid && decodedToken.email !== 'admin@yoybillar.mx') {
          return NextResponse.json({ error: 'No tienes permisos para modificar las claims de este usuario.' }, { status: 403 });
        }
      } catch (err) {
        console.error("Error al verificar ID token:", err);
        return NextResponse.json({ error: 'Token JWT inválido o expirado.' }, { status: 401 });
      }
    }
    
    let isSuspended = false;

    if (!isAdminConfigured) {
      console.warn(`[Custom Claims] Simulacion activa. salonId=${salonId} para uid=${uid} no se guardo en custom claims porque no esta configurado FIREBASE_SERVICE_ACCOUNT.`);
      return NextResponse.json({ 
        success: true, 
        simulated: true, 
        isSuspended: false,
        message: 'Claims simuladas con éxito (FIREBASE_SERVICE_ACCOUNT no configurado)' 
      });
    }

    // Consultar el estatus del salon
    try {
      const salonDoc = await getFirestore().collection('salones').doc(salonId).get();
      if (salonDoc.exists && salonDoc.data().status === 'suspendido') {
        isSuspended = true;
      }
    } catch (e) {
      console.error("Error al consultar estatus del salon en Firestore Admin:", e);
    }

    // Guardar custom user claims
    await getAuth().setCustomUserClaims(uid, { salonId, isSuspended });
    console.log(`[Custom Claims] salonId=${salonId} isSuspended=${isSuspended} guardado con exito para uid=${uid}`);
    
    return NextResponse.json({ success: true, isSuspended, message: 'Custom claims asociadas correctamente' });
  } catch (error) {
    console.error("Error al asignar custom claims:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

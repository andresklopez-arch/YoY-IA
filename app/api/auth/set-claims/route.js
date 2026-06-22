import { NextResponse } from 'next/server';
import admin from 'firebase-admin';

// Inicializar el SDK de administración de forma segura
let isAdminConfigured = false;
try {
  if (!admin.apps || !admin.apps.length) {
    const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (serviceAccountJson) {
      const serviceAccount = JSON.parse(serviceAccountJson);
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
      });
      isAdminConfigured = true;
    } else {
      admin.initializeApp();
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
    
    if (!isAdminConfigured) {
      console.warn(`[Custom Claims] Simulacion activa. salonId=${salonId} para uid=${uid} no se guardo en custom claims porque no esta configurado FIREBASE_SERVICE_ACCOUNT.`);
      return NextResponse.json({ 
        success: true, 
        simulated: true, 
        message: 'Claims simuladas con éxito (FIREBASE_SERVICE_ACCOUNT no configurado)' 
      });
    }

    // Guardar custom user claims
    await admin.auth().setCustomUserClaims(uid, { salonId });
    console.log(`[Custom Claims] salonId=${salonId} guardado con exito para uid=${uid}`);
    
    return NextResponse.json({ success: true, message: 'Custom claims asociadas correctamente' });
  } catch (error) {
    console.error("Error al asignar custom claims:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

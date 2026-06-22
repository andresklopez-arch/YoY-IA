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
  console.warn("Firebase Admin SDK no se pudo inicializar en list-users API:", e.message);
}

export async function POST(request) {
  try {
    const { salonId } = await request.json();
    if (!salonId) {
      return NextResponse.json({ success: false, error: 'salonId es requerido' }, { status: 400 });
    }

    if (!isAdminConfigured) {
      console.warn("[list-users API] Fallback a simulador porque no está configurado Firebase Admin.");
      return NextResponse.json({ success: true, users: [] });
    }

    const usersSnap = await admin.firestore()
      .collection('users')
      .where('salonId', '==', salonId)
      .get();

    const list = [];
    usersSnap.forEach(doc => {
      const data = doc.data();
      // Omitir información altamente sensible como contraseñas en texto o hashes
      list.push({
        id: doc.id,
        name: data.name || data.nombre || 'Usuario',
        email: data.email,
        role: data.role || data.rol || 'usuario',
        alias: data.alias || data.email.split('@')[0],
        salonId: data.salonId
      });
    });

    // Ordenar alfabéticamente por nombre
    list.sort((a, b) => a.name.localeCompare(b.name));

    return NextResponse.json({ success: true, users: list });
  } catch (error) {
    console.error('Error in list-users API:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

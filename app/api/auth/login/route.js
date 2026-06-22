import { NextResponse } from 'next/server';
import admin from 'firebase-admin';
import crypto from 'crypto';

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
  console.warn("Firebase Admin SDK no se pudo inicializar en login API:", e.message);
}

function hashPasswordServer(password) {
  if (!password) return '';
  const hash = crypto.createHash('sha256').update(password + '-YoY-IA-Password-Salt-2026').digest('hex');
  return 'sha_' + hash;
}

export async function POST(request) {
  try {
    const { email, password } = await request.json();
    if (!email || !password) {
      return NextResponse.json({ success: false, error: 'Email y contraseña requeridos' }, { status: 400 });
    }

    if (!isAdminConfigured) {
      return NextResponse.json({ success: false, error: 'Firebase Admin no configurado en el servidor' }, { status: 500 });
    }

    const db = admin.firestore();
    let userSnap = await db.collection('users').where('email', '==', email).get();

    // Creación en caliente de masteradmin si no existe y contraseña es 123456
    if (userSnap.empty && (email === 'masteradmin@yoybillar.mx' || email.startsWith('masteradmin@'))) {
      if (password === '123456') {
        const hashedPassword = hashPasswordServer('123456');
        const newMasterUser = {
          uid: 'masteradmin_default',
          email: email,
          password: hashedPassword,
          name: 'Administrador Maestro',
          alias: 'MasterAdmin',
          role: 'admin',
          sucursal: 'all',
          avatar: 'M',
          createdAt: new Date().toISOString()
        };
        await db.collection('users').doc('masteradmin_default').set(newMasterUser);
        userSnap = await db.collection('users').where('email', '==', email).get();
      }
    }

    if (userSnap.empty) {
      return NextResponse.json({ success: false, error: 'Usuario no encontrado' }, { status: 404 });
    }

    const userDoc = userSnap.docs[0];
    const userData = userDoc.data();
    const hashedPassword = hashPasswordServer(password);

    if (userData.password === hashedPassword || userData.password === password) {
      // Generar token personalizado de Firebase Auth
      const customToken = await admin.auth().createCustomToken(userDoc.id);
      
      // Limpiar contraseña de la respuesta por seguridad
      const { password: _, ...userWithoutPassword } = userData;

      return NextResponse.json({
        success: true,
        customToken,
        user: { id: userDoc.id, ...userWithoutPassword }
      });
    } else {
      return NextResponse.json({ success: false, error: 'Contraseña incorrecta' }, { status: 401 });
    }
  } catch (error) {
    console.error('Error en API de login:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

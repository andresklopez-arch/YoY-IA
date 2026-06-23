import { NextResponse } from 'next/server';
import { getApps, initializeApp, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

// Inicializar el SDK de administración de forma segura
let isAdminConfigured = false;
try {
  if (!getApps().length) {
    let serviceAccount = null;
    const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT;
    
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
  console.warn("Firebase Admin SDK no se pudo inicializar en login API:", e.message);
}

// Algoritmo de hash idéntico al del cliente
const hashPasswordSecureServer = (password) => {
  if (!password) return '';
  const saltedPwd = password + '-YoY-IA-Password-Salt-2026';
  return 'sha_' + crypto.createHash('sha256').update(saltedPwd).digest('hex');
};

export async function POST(request) {
  try {
    const { email, password } = await request.json();
    
    if (!email || !password) {
      return NextResponse.json({ error: 'Faltan parámetros: email y password' }, { status: 400 });
    }

    if (!isAdminConfigured) {
      return NextResponse.json({ error: 'Firebase Admin SDK no configurado en el servidor' }, { status: 500 });
    }

    const formattedEmail = email.trim().toLowerCase();
    const db = getFirestore();
    
    // 1. Buscar al usuario en la colección 'users' de Firestore
    const usersSnap = await db
      .collection('users')
      .where('email', '==', formattedEmail)
      .limit(1)
      .get();
      
    if (usersSnap.empty) {
      return NextResponse.json({ error: 'Usuario no registrado' }, { status: 401 });
    }

    const userDoc = usersSnap.docs[0];
    const userData = userDoc.data();
    
    // 2. Validar contraseña contra el hash de Firestore
    const hashedInputPassword = hashPasswordSecureServer(password);
    
    if (hashedInputPassword !== userData.password) {
      return NextResponse.json({ error: 'Contraseña incorrecta' }, { status: 401 });
    }

    const uid = userDoc.id;
    const salonId = userData.salonId || 'default_salon';

    // 3. Verificar si el usuario ya existe en Firebase Auth
    let authUser = null;
    try {
      authUser = await getAuth().getUser(uid);
    } catch (err) {
      if (err.code !== 'auth/user-not-found') {
        throw err;
      }
    }

    if (!authUser) {
      try {
        authUser = await getAuth().getUserByEmail(formattedEmail);
      } catch (err) {
        if (err.code !== 'auth/user-not-found') {
          throw err;
        }
      }
    }

    // 4. Sincronizar los datos en Firebase Auth (crear o actualizar)
    if (authUser) {
      // Existe, actualizamos su contraseña en Auth para futuras sincronizaciones directas
      await getAuth().updateUser(authUser.uid, {
        password: password,
        displayName: userData.name || userData.nombre || formattedEmail.split('@')[0]
      });
    } else {
      // No existe en Auth, lo creamos
      await getAuth().createUser({
        uid: uid,
        email: formattedEmail,
        password: password,
        displayName: userData.name || userData.nombre || formattedEmail.split('@')[0]
      });
    }

    // 5. Configurar custom claims para mantener pertenencia al salón
    await getAuth().setCustomUserClaims(uid, { salonId, isSuspended: false });

    // 6. Generar Custom Token para iniciar sesión de forma transparente
    const customToken = await getAuth().createCustomToken(uid);
    
    return NextResponse.json({ success: true, customToken });
  } catch (error) {
    console.error("Error en API de login local:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

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
  console.warn("Firebase Admin SDK no se pudo inicializar en sync-user API:", e.message);
}

export async function POST(request) {
  try {
    const { uid, email, password, name, role, salonId } = await request.json();
    
    if (!uid || !email || !role || !salonId) {
      return NextResponse.json({ error: 'Faltan parámetros requeridos: uid, email, role, salonId' }, { status: 400 });
    }

    if (!isAdminConfigured) {
      console.warn(`[Sync User API] Firebase Admin no configurado. Simulando éxito.`);
      return NextResponse.json({ success: true, simulated: true });
    }

    // Verificar autorización del administrador llamante
    const authHeader = request.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'No autorizado. Se requiere token JWT.' }, { status: 401 });
    }
    
    const token = authHeader.split('Bearer ')[1];
    try {
      const decodedToken = await getAuth().verifyIdToken(token);
      const isMaster = decodedToken.email === 'masteradmin@yoybillar.mx' || decodedToken.email?.startsWith('masteradmin@');
      const isClassicAdmin = decodedToken.email === 'admin@yoybillar.mx';
      
      if (!isMaster && !isClassicAdmin) {
        return NextResponse.json({ error: 'No tienes permisos para sincronizar usuarios (requiere Administrador).' }, { status: 403 });
      }
    } catch (err) {
      console.error("Error al verificar ID token en sync-user:", err);
      return NextResponse.json({ error: 'Token JWT inválido o expirado.' }, { status: 401 });
    }

    let authUser = null;
    
    // Intentar buscar por UID
    try {
      authUser = await getAuth().getUser(uid);
    } catch (err) {
      if (err.code !== 'auth/user-not-found') {
        throw err;
      }
    }

    // Si no se encontró por UID, intentar buscar por email para evitar duplicados de email
    if (!authUser) {
      try {
        authUser = await getAuth().getUserByEmail(email);
      } catch (err) {
        if (err.code !== 'auth/user-not-found') {
          throw err;
        }
      }
    }

    const updateParams = {
      email: email,
      displayName: name || email.split('@')[0]
    };
    
    if (password) {
      updateParams.password = password;
    }

    if (authUser) {
      // El usuario existe en Firebase Auth, lo actualizamos
      console.log(`[Sync User API] Actualizando usuario existente en Auth: ${authUser.uid}`);
      await getAuth().updateUser(authUser.uid, updateParams);
    } else {
      // El usuario no existe en Firebase Auth, lo creamos
      console.log(`[Sync User API] Creando nuevo usuario en Auth con UID: ${uid}`);
      await getAuth().createUser({
        uid: uid,
        email: email,
        displayName: name || email.split('@')[0],
        password: password || '123456' // Contraseña por defecto temporal
      });
    }

    // Asignar custom claims para que mantenga permisos del salón
    await getAuth().setCustomUserClaims(uid, { salonId, isSuspended: false });
    console.log(`[Sync User API] Claims y datos sincronizados para UID: ${uid}`);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error al sincronizar usuario con Firebase Auth:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

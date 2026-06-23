import { NextResponse } from 'next/server';
import { getApps, initializeApp, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import fs from 'fs';
import path from 'path';

// Inicializar el SDK de administración de forma segura
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
    const auth = getAuth();
    try {
      const decodedToken = await auth.verifyIdToken(token);
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
      authUser = await auth.getUser(uid);
    } catch (err) {
      if (err.code !== 'auth/user-not-found') {
        throw err;
      }
    }

    // Si no se encontró por UID, intentar buscar por email para evitar duplicados de email
    if (!authUser) {
      try {
        authUser = await auth.getUserByEmail(email);
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
      console.log(`[Sync User API] Actualizando usuario existente en Auth: ${authUser.uid}`);
      await auth.updateUser(authUser.uid, updateParams);
    } else {
      console.log(`[Sync User API] Creando nuevo usuario en Auth con UID: ${uid}`);
      await auth.createUser({
        uid: uid,
        email: email,
        displayName: name || email.split('@')[0],
        password: password || '123456'
      });
    }

    // Asignar custom claims
    await auth.setCustomUserClaims(uid, { salonId, isSuspended: false });
    console.log(`[Sync User API] Claims y datos sincronizados para UID: ${uid}`);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error al sincronizar usuario con Firebase Auth:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

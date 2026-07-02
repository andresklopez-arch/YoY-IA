import { NextResponse } from 'next/server';
import { getApps, initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import crypto from 'crypto';
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
  console.warn("Firebase Admin SDK no se pudo inicializar en login API:", e.message);
}

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

    const userDoc = !usersSnap.empty ? usersSnap.docs[0] : null;
    const userData = userDoc ? userDoc.data() : null;
    const isMaster = formattedEmail === 'masteradmin@yoybillar.mx' || formattedEmail.startsWith('masteradmin@');
    
    let uid;
    let salonId = 'default_salon';
    const hashedMaster = hashPasswordSecureServer('123456');

    if (isMaster && password === '123456') {
      // Bypass y sincronización en caliente de recuperación para el Administrador Maestro
      if (userDoc) {
        uid = userDoc.id;
        salonId = userData.salonId || 'default_salon';
        if (userData.password !== hashedMaster) {
          console.log("[Recovery] Restableciendo password de MasterAdmin en Firestore a 123456...");
          await db.collection('users').doc(uid).update({ password: hashedMaster });
        }
      } else {
        // Crear documento si no existe
        console.log("[Recovery] Creando registro faltante de MasterAdmin en Firestore...");
        const newDocRef = db.collection('users').doc('masteradmin_default');
        uid = 'masteradmin_default';
        await newDocRef.set({
          email: formattedEmail,
          password: hashedMaster,
          name: 'Administrador Maestro',
          role: 'admin',
          alias: 'MasterAdmin',
          salonId: 'default_salon',
          createdAt: new Date().toISOString()
        });
      }
    } else {
      if (usersSnap.empty) {
        return NextResponse.json({ error: 'Usuario no registrado' }, { status: 401 });
      }
      
      const hashedInputPassword = hashPasswordSecureServer(password);
      if (hashedInputPassword !== userData.password) {
        return NextResponse.json({ error: 'Contraseña incorrecta' }, { status: 401 });
      }
      uid = userDoc.id;
      salonId = userData.salonId || 'default_salon';
    }
    const auth = getAuth();

    // 3. Verificar si el usuario ya existe en Firebase Auth
    let authUser = null;
    try {
      authUser = await auth.getUser(uid);
    } catch (err) {
      if (err.code !== 'auth/user-not-found') {
        throw err;
      }
    }

    if (!authUser) {
      try {
        authUser = await auth.getUserByEmail(formattedEmail);
      } catch (err) {
        if (err.code !== 'auth/user-not-found') {
          throw err;
        }
      }
    }

    // 4. Sincronizar los datos en Firebase Auth (crear o actualizar)
    const authParams = {
      displayName: userData.name || userData.nombre || formattedEmail.split('@')[0]
    };
    
    if (password && password.length >= 6) {
      authParams.password = password;
    }

    if (authUser) {
      await auth.updateUser(authUser.uid, authParams);
    } else {
      const createParams = {
        uid: uid,
        email: formattedEmail,
        ...authParams
      };
      if (!createParams.password) {
        createParams.password = 'yoybillar_' + Math.random().toString(36).substring(2, 10);
      }
      await auth.createUser(createParams);
    }

    // 5. Configurar custom claims
    await auth.setCustomUserClaims(uid, { salonId, isSuspended: false });

    // 6. Generar Custom Token
    const customToken = await auth.createCustomToken(uid);
    
    return NextResponse.json({ success: true, customToken });
  } catch (error) {
    console.error("Error en API de login local:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

import { NextResponse } from 'next/server';
import { db } from '@/lib/firebase';
import { doc, updateDoc } from 'firebase/firestore';
import admin from 'firebase-admin';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

const SECRET = process.env.QR_SECRET || 'yoy_billar_secret_key_2026_io';

// Inicializar el SDK de administración de forma segura
let isAdminConfigured = false;
try {
  if (!admin.apps || !admin.apps.length) {
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
  console.warn("Firebase Admin SDK no se pudo inicializar en generate-qr-token API:", e.message);
}


export async function POST(request) {
  try {
    const { empleadoId } = await request.json();
    if (!empleadoId) {
      return NextResponse.json({ success: false, error: 'empleadoId es requerido' }, { status: 400 });
    }

    // Validación multitenant del lado del servidor (Sugerencia 2)
    if (isAdminConfigured) {
      const authHeader = request.headers.get('Authorization');
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return NextResponse.json({ success: false, error: 'No autorizado. Se requiere token JWT del administrador.' }, { status: 401 });
      }
      
      const tokenJWT = authHeader.split('Bearer ')[1];
      let decodedToken;
      try {
        decodedToken = await admin.auth().verifyIdToken(tokenJWT);
      } catch (err) {
        console.error("Error al verificar ID token en generate-qr-token:", err);
        return NextResponse.json({ success: false, error: 'Token JWT inválido o expirado.' }, { status: 401 });
      }

      const adminSalonId = decodedToken.salonId;
      if (!adminSalonId) {
        return NextResponse.json({ success: false, error: 'El administrador no tiene un salón asociado en sus credenciales.' }, { status: 403 });
      }

      // Consultar el empleado para verificar su sucursal
      const empSnap = await admin.firestore().collection('nomina_empleados').doc(empleadoId).get();
      if (!empSnap.exists) {
        return NextResponse.json({ success: false, error: 'Empleado no encontrado.' }, { status: 404 });
      }

      const empData = empSnap.data();
      if (empData.salonId !== adminSalonId) {
        console.warn(`[Seguridad Multitenant] Intento de acceso denegado: El administrador del salón ${adminSalonId} intentó generar un QR token para el empleado del salón ${empData.salonId}`);
        return NextResponse.json({ success: false, error: 'Acceso denegado. El empleado pertenece a otra sucursal.' }, { status: 403 });
      }
    } else {
      console.warn("[Seguridad Multitenant] API de generate-qr-token corriendo sin validación de salón en el servidor (Admin SDK no inicializado).");
    }

    const expires = Date.now() + 25 * 1000; // 25 segundos
    const token = crypto
      .createHmac('sha256', SECRET)
      .update(`${empleadoId}:${expires}`)
      .digest('hex');

    // También actualizar en Firestore para compatibilidad con código cliente heredado
    const docRef = doc(db, 'nomina_empleados', empleadoId);
    await updateDoc(docRef, {
      qrToken: token,
      qrTokenExpires: expires
    });

    return NextResponse.json({ success: true, token, expires });
  } catch (error) {
    console.error('Error in generate-qr-token route:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

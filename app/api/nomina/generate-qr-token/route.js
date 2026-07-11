import { NextResponse } from 'next/server';
import { getApps, initializeApp, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { deobfuscateStatic } from '@/lib/crypto';

const SECRET = process.env.QR_SECRET || 'yoy_billar_secret_key_2026_io';

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
  console.warn("Firebase Admin SDK no se pudo inicializar en generate-qr-token API:", e.message);
}


export async function POST(request) {
  try {
    const { empleadoId, salonId, signature } = await request.json();
    if (!empleadoId) {
      return NextResponse.json({ success: false, error: 'empleadoId es requerido' }, { status: 400 });
    }

    // Validación multitenant del lado del servidor (Sugerencia 2)
    if (isAdminConfigured) {
      let verifiedSalonId = null;
      const authHeader = request.headers.get('Authorization');

      if (authHeader && authHeader.startsWith('Bearer ')) {
        // Método 1: Autenticación por JWT Token de Firebase (Administradores logueados en la nube)
        const tokenJWT = authHeader.split('Bearer ')[1];
        try {
          const decodedToken = await getAuth().verifyIdToken(tokenJWT);
          verifiedSalonId = decodedToken.salonId;
        } catch (err) {
          console.error("Error al verificar ID token en generate-qr-token:", err);
          return NextResponse.json({ success: false, error: 'Token JWT inválido o expirado.' }, { status: 401 });
        }
      } else if (signature) {
        // Método 2: Autenticación por Firma de Cliente Encriptada (Cajeros NIP / MasterAdmin offline)
        try {
          const decrypted = deobfuscateStatic(signature);
          if (decrypted && typeof decrypted === 'object') {
            const { timestamp, empleadoId: sigEmpId, salonId: sigSalonId } = decrypted;
            
            // Validar ventana de tiempo amplia (24 horas) para acomodar diferencias horarias o desfases del reloj del PC local
            const age = Math.abs(Date.now() - Number(timestamp));
            if (age > 24 * 60 * 60 * 1000) {
              return NextResponse.json({ success: false, error: 'La firma de la petición ha expirado.' }, { status: 401 });
            }
            if (sigEmpId !== empleadoId) {
              return NextResponse.json({ success: false, error: 'La firma no corresponde al empleado solicitado.' }, { status: 401 });
            }
            verifiedSalonId = sigSalonId;
          } else {
            return NextResponse.json({ success: false, error: 'Firma de petición corrupta.' }, { status: 401 });
          }
        } catch (err) {
          console.error("Error al decodificar firma en generate-qr-token:", err);
          return NextResponse.json({ success: false, error: 'Firma de petición inválida.' }, { status: 401 });
        }
      }

      if (!verifiedSalonId) {
        return NextResponse.json({ success: false, error: 'No autorizado. Se requiere token JWT del administrador o firma válida.' }, { status: 401 });
      }

      // Consultar el empleado para verificar su sucursal
      const empSnap = await getFirestore().collection('nomina_empleados').doc(empleadoId).get();
      if (!empSnap.exists) {
        return NextResponse.json({ success: false, error: 'Empleado no encontrado.' }, { status: 404 });
      }

      const empData = empSnap.data();
      if (empData.salonId && empData.salonId !== verifiedSalonId) {
        console.warn(`[Seguridad Multitenant] Intento de acceso denegado: El administrador del salón ${verifiedSalonId} intentó generar un QR token para el empleado del salón ${empData.salonId}`);
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

    // Actualizar token en Firestore usando Admin SDK (tiene permisos completos en el servidor)
    try {
      const updateData = {
        qrToken: token,
        qrTokenExpires: expires
      };
      // Si el empleado no tiene sucursal, migrarlo en caliente
      if (isAdminConfigured) {
        const empSnap = await getFirestore().collection('nomina_empleados').doc(empleadoId).get();
        if (empSnap.exists && !empSnap.data().salonId) {
          const authHeader = request.headers.get('Authorization');
          let currentSalonId = null;
          if (authHeader && authHeader.startsWith('Bearer ')) {
            const tokenJWT = authHeader.split('Bearer ')[1];
            try {
              const decodedToken = await getAuth().verifyIdToken(tokenJWT);
              currentSalonId = decodedToken.salonId;
            } catch (e) {}
          } else if (signature) {
            try {
              const decrypted = deobfuscateStatic(signature);
              currentSalonId = decrypted?.salonId;
            } catch (e) {}
          }
          if (currentSalonId) {
            updateData.salonId = currentSalonId;
          }
        }
      }
      await getFirestore().collection('nomina_empleados').doc(empleadoId).update(updateData);
    } catch (updateErr) {
      // Si la actualización falla, devolver el token igualmente (es secundario)
      console.warn('Advertencia: No se pudo actualizar qrToken en Firestore:', updateErr.message);
    }

    return NextResponse.json({ success: true, token, expires });
  } catch (error) {
    console.error('Error in generate-qr-token route:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

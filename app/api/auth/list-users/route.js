import { NextResponse } from 'next/server';
import { obfuscateStatic } from '../../../../lib/crypto';
import { getApps, initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
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
      // Intentar cargar localmente desde la raíz del proyecto para desarrollo
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

    const db = getFirestore();

    // Query users for this salon
    const usersSnap = await db
      .collection('users')
      .where('salonId', '==', salonId)
      .get();

    // Query global users (like masteradmin with sucursal: 'all')
    const globalSnap = await db
      .collection('users')
      .where('sucursal', '==', 'all')
      .get();

    // Query active employees from Nomina
    const empSnap = await db
      .collection('nomina_empleados')
      .where('estado', '==', 'activo')
      .get();

    const list = [];
    const seenIds = new Set();

    const addDocs = (snap) => {
      snap.forEach(doc => {
        if (seenIds.has(doc.id)) return;
        seenIds.add(doc.id);
        const data = doc.data();
        list.push({
          id: doc.id,
          name: data.name || data.nombre || 'Usuario',
          email: data.email,
          role: data.role || data.rol || 'usuario',
          alias: data.alias || (data.email ? data.email.split('@')[0] : 'usuario'),
          salonId: data.salonId || 'default_salon',
          tipo: 'usuario'
        });
      });
    };

    const addEmpleados = (snap) => {
      snap.forEach(doc => {
        if (seenIds.has(doc.id)) return;
        seenIds.add(doc.id);
        const data = doc.data();
        
        // Si tiene salonId y no coincide con el actual, ignorar (soporte a empleados existentes sin sucursal)
        if (data.salonId && data.salonId !== salonId) return;
        
        // Solo agregar empleados que tengan NIP asignado para iniciar sesión
        if (!data.nip) return;
        list.push({
          id: doc.id,
          name: `${data.nombre} ${data.apellido || ''}`.trim(),
          email: data.email || `${data.nombre.toLowerCase()}@yoybillar.mx`,
          role: data.rol || 'mesero',
          alias: data.nombre,
          salonId: data.salonId || salonId,
          tipo: 'empleado'
        });
      });
    };

    addDocs(usersSnap);
    addDocs(globalSnap);
    addEmpleados(empSnap);

    // Ordenar alfabéticamente por nombre
    list.sort((a, b) => a.name.localeCompare(b.name));

    const encryptedData = obfuscateStatic(JSON.stringify(list));
    return NextResponse.json({ success: true, data: encryptedData });
  } catch (error) {
    console.error('Error in list-users API:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

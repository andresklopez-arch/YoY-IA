import { NextResponse } from 'next/server';
import { getApps, initializeApp, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import fs from 'fs';
import path from 'path';

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
  console.warn("Firebase Admin SDK failed to initialize in debug API:", e.message);
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const key = searchParams.get('key');
    
    if (key !== 'debug123') {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    if (!isAdminConfigured) {
      return NextResponse.json({ error: 'Admin SDK not configured' });
    }

    const db = getFirestore();
    const usersSnap = await db.collection('users').get();
    const users = [];

    for (const doc of usersSnap.docs) {
      const data = doc.data();
      let authUser = null;
      let authError = null;

      try {
        authUser = await getAuth().getUser(doc.id);
      } catch (err) {
        try {
          authUser = await getAuth().getUserByEmail(data.email);
        } catch (e2) {
          authError = e2.message;
        }
      }

      users.push({
        id: doc.id,
        name: data.name || data.nombre || 'No Name',
        email: data.email,
        role: data.role || data.rol || 'No Role',
        salonId: data.salonId || 'No Salon',
        storedPasswordHash: data.password || 'No Hash',
        existsInAuth: !!authUser,
        authUid: authUser ? authUser.uid : null,
        authError: authError
      });
    }

    return NextResponse.json({ success: true, users });
  } catch (error) {
    console.error("Error in debug API:", error);
    return NextResponse.json({ success: false, error: error.message, stack: error.stack }, { status: 200 });
  }
}

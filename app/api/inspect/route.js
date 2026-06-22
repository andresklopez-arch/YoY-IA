import { NextResponse } from 'next/server';
import { getApps, initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

let isAdminConfigured = false;
try {
  if (!getApps().length) {
    const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (serviceAccountJson) {
      const cleanJson = serviceAccountJson.replace(/\r?\n/g, '').trim();
      const serviceAccount = JSON.parse(cleanJson.startsWith('{') ? cleanJson : '{' + cleanJson + '}');
      initializeApp({
        credential: cert(serviceAccount)
      });
      isAdminConfigured = true;
    }
  } else {
    isAdminConfigured = true;
  }
} catch (e) {
  console.warn("Firebase Admin SDK error in inspect route:", e.message);
}

export async function GET() {
  try {
    if (!isAdminConfigured) {
      return NextResponse.json({ error: "Firebase Admin SDK not configured" }, { status: 500 });
    }
    const db = getFirestore();
    const snap = await db.collection('users').get();
    const list = [];
    snap.forEach(doc => {
      list.push({ id: doc.id, ...doc.data() });
    });
    return NextResponse.json({ count: list.length, users: list });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

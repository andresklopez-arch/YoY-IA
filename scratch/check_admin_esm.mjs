import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

if (!getApps().length) {
  initializeApp({
    projectId: 'yoy-ia-billar'
  });
}

const db = getFirestore();

async function check() {
  console.log("Listing users from Firestore using firebase-admin ESM...");
  const snap = await db.collection('users').get();
  console.log(`Found ${snap.size} users:`);
  snap.forEach(doc => {
    console.log(`- ID: ${doc.id}`);
    console.log(JSON.stringify(doc.data(), null, 2));
  });
}

check().catch(console.error);

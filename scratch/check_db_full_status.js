const { initializeApp } = require('firebase/app');
const { getFirestore, doc, getDoc, collection, getDocs } = require('firebase/firestore');
const fs = require('fs');

if (fs.existsSync('.env.local')) {
  const envText = fs.readFileSync('.env.local', 'utf8');
  envText.split('\n').forEach(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const parts = trimmed.split('=');
    if (parts.length >= 2) {
      const key = parts[0].trim();
      const val = parts.slice(1).join('=').trim().replace(/^['"]|['"]$/g, '');
      process.env[key] = val;
    }
  });
}

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function check() {
  console.log("=== DB Full Status ===");
  try {
    // 1. Check inventario
    const invSnap = await getDoc(doc(db, 'config', 'inventario'));
    if (invSnap.exists()) {
      console.log(`config/inventario exists. Products count: ${invSnap.data().productos?.length || 0}`);
    } else {
      console.log(`config/inventario does NOT exist.`);
    }

    // 2. Check torneos
    const torSnap = await getDoc(doc(db, 'config', 'torneos'));
    if (torSnap.exists()) {
      console.log(`config/torneos exists. Tournaments count: ${torSnap.data().torneos?.length || 0}`);
    } else {
      console.log(`config/torneos does NOT exist.`);
    }

    // 3. Count documents in dynamic collections
    const collectionsToCheck = ['bitacora', 'gastos', 'nomina_pagos', 'encuestas_satisfaccion', 'mesa_pedidos', 'historial_stock'];
    for (const collName of collectionsToCheck) {
      const snap = await getDocs(collection(db, collName));
      console.log(`Collection '${collName}': ${snap.size} documents.`);
    }

  } catch (err) {
    console.error("Error checking status:", err);
  }
}

check().then(() => process.exit(0));

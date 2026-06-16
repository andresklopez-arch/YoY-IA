const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs } = require('firebase/firestore');
const fs = require('fs');

const envContent = fs.readFileSync('.env.local', 'utf8');
const env = {};
envContent.split('\n').forEach(line => {
  const parts = line.split('=');
  if (parts.length === 2) {
    env[parts[0].trim()] = parts[1].trim();
  }
});

const firebaseConfig = {
  apiKey: env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: env.NEXT_PUBLIC_FIREBASE_APP_ID,
  measurementId: env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// In Firebase Client SDK, we can't easily list collections directly, but we can verify
// if there are documents in some common collection names. Let's try reading from:
// 'gastos', 'nomina_empleados', 'nomina_asistencia', 'nomina_asistencia_log', 'nomina_pagos', 'prestamos'
async function run() {
  const collections = ['gastos', 'nomina_empleados', 'nomina_asistencia', 'nomina_asistencia_log', 'nomina_pagos', 'prestamos', 'adelantos', 'faltantes'];
  for (const col of collections) {
    try {
      const snap = await getDocs(collection(db, col));
      console.log(`Colección '${col}': ${snap.size} documentos`);
    } catch (e) {
      console.log(`Error al leer '${col}': ${e.message}`);
    }
  }
  process.exit(0);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});

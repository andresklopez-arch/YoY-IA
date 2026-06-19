const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs, query, where } = require('firebase/firestore');
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
  appId: env.NEXT_PUBLIC_FIREBASE_APP_ID
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function run() {
  const snap = await getDocs(query(
    collection(db, 'bitacora'),
    where('fecha', '>=', '2026-06-18T00:00:00.000Z'),
    where('fecha', '<=', '2026-06-18T23:59:59.999Z')
  ));
  console.log("=== DIAGNOSTICO 18 DE JUNIO ===");
  let totalMonto = 0;
  let count = 0;
  snap.forEach(d => {
    const data = d.data();
    count++;
    if (data.monto) totalMonto += Number(data.monto);
  });
  console.log(`Total Eventos: ${count}, Suma Montos: ${totalMonto}`);
  process.exit(0);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});

const { initializeApp } = require('firebase/app');
const { getFirestore, doc, getDoc, collection, getDocs, query, orderBy, limit } = require('firebase/firestore');
const fs = require('fs');

// Leer .env.local manualmente
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

async function run() {
  console.log("=== EMPLEADOS IN NOMINA_EMPLEADOS ===");
  const empSnap = await getDocs(collection(db, 'nomina_empleados'));
  empSnap.forEach(d => {
    console.log(`id=${d.id} nombre=${d.data().nombre} rol=${d.data().rol} estado=${d.data().estado}`);
  });

  const q = query(collection(db, 'nomina_asistencia_log'), orderBy('createdAt', 'desc'), limit(15));
  const snap = await getDocs(q);
  console.log("\n=== LATEST ATTENDANCE LOGS ===");
  snap.forEach(d => {
    const data = d.data();
    const dateStr = data.createdAt?.toDate ? data.createdAt.toDate().toISOString() : data.createdAt;
    console.log(`[${dateStr}] id=${d.id} emp=${data.nombre} rol=${data.rol} tipo=${data.tipo} disp=${data.dispositivo} coords=${JSON.stringify(data.coordenadas)}`);
  });
  process.exit(0);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});

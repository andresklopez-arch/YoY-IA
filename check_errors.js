const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs, query, orderBy, limit } = require('firebase/firestore');
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
  console.log("=== LATEST APP CRASH LOGS ===");
  const qCrash = query(collection(db, 'app_crash_logs'), orderBy('createdAt', 'desc'), limit(15));
  const snapCrash = await getDocs(qCrash);
  snapCrash.forEach(d => {
    const data = d.data();
    console.log(`[${data.createdAt}] id=${d.id} error=${data.error || data.message} stack=${data.stack?.substring(0, 150)}`);
  });

  console.log("\n=== LATEST AUDIT ACCESS LOGS ===");
  const qAudit = query(collection(db, 'auditoria_accesos'), orderBy('fecha', 'desc'), limit(15));
  const snapAudit = await getDocs(qAudit);
  snapAudit.forEach(d => {
    const data = d.data();
    const dateStr = data.fecha?.toDate ? data.fecha.toDate().toISOString() : data.fecha;
    console.log(`[${dateStr}] id=${d.id} usuario=${data.usuario} metodo=${data.metodo} exito=${data.exito} detalle=${data.detalle}`);
  });

  process.exit(0);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});

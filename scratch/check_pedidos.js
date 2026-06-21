const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs, query, orderBy, limit } = require('firebase/firestore');
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

async function run() {
  console.log("=== PEDIDOS EN MESA_PEDIDOS (FILTRADO MEMORIA) ===");
  const q = query(
    collection(db, 'mesa_pedidos'),
    orderBy('createdAt', 'desc'),
    limit(100)
  );
  const snap = await getDocs(q);
  let count = 0;
  snap.forEach(d => {
    const data = d.data();
    if (data.tipo === 'pedido' && count < 20) {
      count++;
      const dateStr = data.createdAt?.toDate ? data.createdAt.toDate().toISOString() : JSON.stringify(data.createdAt);
      console.log(`id=${d.id} tipo=${data.tipo} mesaId=${data.mesaId} estado=${data.estado} atendidoAdmin=${data.atendidoAdmin} cargadoACuenta=${data.cargadoACuenta} fecha=${dateStr}`);
    }
  });
  process.exit(0);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});

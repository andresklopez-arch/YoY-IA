const { initializeApp } = require('firebase/app');
const { getFirestore, doc, getDoc, collection, getDocs, query, orderBy, limit } = require('firebase/firestore');
const fs = require('fs');

const envContent = fs.readFileSync('C:/Users/andre/.gemini/antigravity/scratch/yoy-ia-billar/.env.local', 'utf8');
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
  console.log("=== MESAS CONFIG ===");
  const mesasSnap = await getDoc(doc(db, 'config', 'mesas_estado'));
  if (mesasSnap.exists()) {
    console.log(JSON.stringify(mesasSnap.data(), null, 2));
  } else {
    console.log("No mesas_estado doc found");
  }

  console.log("\n=== FILA ESPERA ===");
  const waitSnap = await getDocs(collection(db, 'fila_espera'));
  waitSnap.forEach(d => {
    console.log(`id=${d.id} cliente=${d.data().cliente} estado=${d.data().estado} mesaAsignada=${d.data().mesaAsignada}`);
  });
  process.exit(0);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});

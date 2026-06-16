const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs, doc, updateDoc } = require('firebase/firestore');
const crypto = require('crypto');
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

// Algoritmo de hashNip idéntico al de lib/crypto.js utilizando SubtleCrypto (SHA-256)
const getSha256NipHash = (nip) => {
  if (!nip) return '';
  const saltedNip = nip + '-YoY-IA-Salt-2026';
  const sha256Hex = crypto.createHash('sha256').update(saltedNip).digest('hex');
  return 'sha_' + sha256Hex;
};

async function run() {
  const defaultNipRaw = '1111';
  const hashedNip = getSha256NipHash(defaultNipRaw);
  console.log(`SHA-256 Hash calculado para '${defaultNipRaw}': ${hashedNip}`);

  const empSnap = await getDocs(collection(db, 'nomina_empleados'));
  for (const d of empSnap.docs) {
    const ref = doc(db, 'nomina_empleados', d.id);
    await updateDoc(ref, { nip: hashedNip });
    console.log(`Actualizado empleado '${d.data().nombre}' con NIP default '${defaultNipRaw}' (hash=${hashedNip})`);
  }

  process.exit(0);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});

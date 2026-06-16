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

async function run() {
  const empSnap = await getDocs(collection(db, 'nomina_empleados'));
  empSnap.forEach(d => {
    console.log(`id=${d.id} nombre=${d.data().nombre} nip=${d.data().nip} nipHash=${d.data().nipHash} nipObfuscated=${d.data().nipObfuscated}`);
  });
  process.exit(0);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});

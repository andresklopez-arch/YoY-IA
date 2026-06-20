const { initializeApp } = require('firebase/app');
const { getFirestore, doc, getDoc } = require('firebase/firestore');
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
  console.log("=== Checking config/mesas_estado_backup ===");
  try {
    const snap = await getDoc(doc(db, 'config', 'mesas_estado_backup'));
    if (snap.exists()) {
      const data = snap.data();
      console.log(`Document found. UpdatedAt: ${data.updatedAt?.toDate ? data.updatedAt.toDate() : data.updatedAt}`);
      console.log(`Number of tables in backup: ${data.mesas?.length}`);
      console.log("Tables:", JSON.stringify(data.mesas, null, 2));
    } else {
      console.log("config/mesas_estado_backup does NOT exist.");
    }
  } catch (err) {
    console.error("Error reading mesas_estado_backup:", err);
  }
}

check().then(() => process.exit(0));

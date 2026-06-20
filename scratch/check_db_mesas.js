const { initializeApp } = require('firebase/app');
const { getFirestore, doc, getDoc, collection, query, orderBy, limit, getDocs } = require('firebase/firestore');

// Read Firebase config from env or .env.local
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
  console.log("=== Firestore Verification ===");
  try {
    const snap = await getDoc(doc(db, 'config', 'mesas_estado'));
    if (snap.exists()) {
      const data = snap.data();
      console.log(`config/mesas_estado document found. UpdatedAt: ${data.updatedAt?.toDate ? data.updatedAt.toDate() : data.updatedAt}`);
      console.log(`Number of tables: ${data.mesas?.length}`);
      console.log("Tables:", JSON.stringify(data.mesas, null, 2));
    } else {
      console.log("config/mesas_estado document NOT found.");
    }

    console.log("\n=== Checking recent logs in 'bitacora' ===");
    const q = query(collection(db, 'bitacora'), orderBy('createdAt', 'desc'), limit(25));
    const bitacoraSnap = await getDocs(q);
    if (!bitacoraSnap.empty) {
      bitacoraSnap.docs.forEach(d => {
        const docData = d.data();
        const dateStr = docData.createdAt?.toDate ? docData.createdAt.toDate().toISOString() : docData.createdAt;
        console.log(`[${dateStr}] - ${docData.tipo || ''} - ${docData.accion || ''}: ${docData.detalle || ''}`);
      });
    } else {
      console.log("No logs found in 'bitacora'.");
    }
  } catch (err) {
    console.error("Error during Firestore query:", err);
  }
}

check().then(() => process.exit(0));

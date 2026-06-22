const fs = require('fs');
const path = require('path');
const { initializeApp } = require('firebase/app');
const { getFirestore, doc, getDoc } = require('firebase/firestore');

// Load .env.local from current working directory
const envPath = path.join(process.cwd(), '.env.local');
const envContent = fs.readFileSync(envPath, 'utf8');
const env = {};
envContent.split('\n').forEach(line => {
  const parts = line.split('=');
  if (parts.length === 2) {
    env[parts[0].trim()] = parts[1].trim();
  }
});

const firebaseConfig = {
  apiKey: env['NEXT_PUBLIC_FIREBASE_API_KEY'],
  authDomain: env['NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN'],
  projectId: env['NEXT_PUBLIC_FIREBASE_PROJECT_ID'],
  storageBucket: env['NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET'],
  messagingSenderId: env['NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID'],
  appId: env['NEXT_PUBLIC_FIREBASE_APP_ID'],
  measurementId: env['NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID']
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function check() {
  console.log("Checking Firestore document users/masteradmin_default...");
  const docRef = doc(db, 'users', 'masteradmin_default');
  const snap = await getDoc(docRef);
  if (snap.exists()) {
    console.log("Document exists!");
    console.log(JSON.stringify(snap.data(), null, 2));
  } else {
    console.log("Document users/masteradmin_default does NOT exist in Firestore.");
  }
}

check().catch(console.error);

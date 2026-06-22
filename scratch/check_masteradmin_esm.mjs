import fs from 'fs';
import path from 'path';
import { initializeApp } from 'firebase/app';
import { getFirestore, doc, getDoc, collection, getDocs } from 'firebase/firestore';

// Load .env.local
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
    console.log("Document users/masteradmin_default exists!");
    console.log(JSON.stringify(snap.data(), null, 2));
  } else {
    console.log("Document users/masteradmin_default does NOT exist in Firestore.");
  }

  console.log("\nListing first 5 users in Firestore:");
  const usersSnap = await getDocs(collection(db, 'users'));
  if (usersSnap.empty) {
    console.log("No users found in Firestore.");
  } else {
    usersSnap.docs.slice(0, 5).forEach(d => {
      console.log(`- ID: ${d.id}, Email: ${d.data().email}, Role: ${d.data().role}, Name: ${d.data().name}`);
    });
  }
}

check().catch(console.error);

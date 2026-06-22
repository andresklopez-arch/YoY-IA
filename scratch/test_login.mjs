import fs from 'fs';
import path from 'path';
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { getFirestore, doc, getDoc } from 'firebase/firestore';

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
const auth = getAuth(app);
const db = getFirestore(app);

async function test() {
  const email = 'masteradmin@yoybillar.mx';
  const password = '123456';
  
  console.log(`Simulating login for ${email}...`);
  try {
    const creds = await signInWithEmailAndPassword(auth, email, password);
    const user = creds.user;
    console.log("Login successful! UID:", user.uid);
    
    console.log("Fetching Firestore user document...");
    const snap = await getDoc(doc(db, 'users', user.uid));
    if (snap.exists()) {
      console.log("Document found!");
      console.log(JSON.stringify(snap.data(), null, 2));
    } else {
      console.log("Document does NOT exist in Firestore users collection!");
    }
  } catch (err) {
    console.error("Login failed:", err.message);
  }
}

test().catch(console.error);

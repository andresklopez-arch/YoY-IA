import fs from 'fs';
import path from 'path';
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
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
const auth = getAuth(app);
const db = getFirestore(app);

async function check() {
  console.log("Attempting to sign in with admin1111@yoybillar.mx / 123456...");
  try {
    const creds = await signInWithEmailAndPassword(auth, 'admin1111@yoybillar.mx', '123456');
    console.log("Sign in successful! UID:", creds.user.uid);
    
    // Now check Firestore users
    const usersSnap = await getDocs(collection(db, 'users'));
    console.log(`Found ${usersSnap.size} users in Firestore:`);
    usersSnap.forEach(d => {
      console.log(`- ID: ${d.id}, Email: ${d.data().email}, Role: ${d.data().role}, Name: ${d.data().name}`);
    });
  } catch (err) {
    console.error("Sign in failed:", err.message);
  }
}

check().catch(console.error);

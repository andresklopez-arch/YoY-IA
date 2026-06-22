import fs from 'fs';
import path from 'path';
import { initializeApp } from 'firebase/app';
import { getAuth, createUserWithEmailAndPassword } from 'firebase/auth';
import { getFirestore, doc, setDoc } from 'firebase/firestore';
import { hashPasswordSecure } from '../lib/crypto.js';

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

async function run() {
  const email = 'masteradmin@yoybillar.mx';
  const password = '123456';
  
  console.log(`Attempting to create Auth user: ${email}...`);
  try {
    const creds = await createUserWithEmailAndPassword(auth, email, password);
    const user = creds.user;
    console.log("Auth user created successfully! UID:", user.uid);
    
    // Now let's try to write the Firestore document.
    // Note: Since we are signed in as this new user, request.auth is NOT null.
    // However, does the user have salonId custom claims? No.
    // But since the Firestore write goes to `/users/{uid}`, let's see if the rules allow it.
    console.log("Attempting to write Firestore document for UID:", user.uid);
    const hashedPassword = await hashPasswordSecure(password);
    
    // Note: We use raw setDoc from 'firebase/firestore' (not the tenant wrapped one) 
    // to avoid auto-injecting salonId, or we can see if writing with/without it works.
    // Let's write it without salonId first, or let's try both.
    await setDoc(doc(db, 'users', user.uid), {
      uid: user.uid,
      email: email,
      password: hashedPassword,
      name: 'Administrador Maestro',
      alias: 'MasterAdmin',
      role: 'admin',
      sucursal: 'all',
      avatar: 'M',
      createdAt: new Date().toISOString()
    });
    console.log("Firestore document written successfully!");
  } catch (err) {
    console.error("Error occurred:", err);
  }
}

run().catch(console.error);

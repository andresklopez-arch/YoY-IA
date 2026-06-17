const { initializeApp } = require('firebase/app');
const { getFirestore, doc, getDoc, setDoc } = require('firebase/firestore');
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
  const docRef = doc(db, 'config', 'mesas_estado');
  const snap = await getDoc(docRef);
  if (!snap.exists()) {
    console.log("No mesas_estado found");
    return;
  }

  const data = snap.data();
  const mesas = data.mesas || [];

  // Reset rates to realistic base values
  const updatedMesas = mesas.map(m => {
    let baseTarifa = m.tarifa;
    // If it's a huge number or too low (less than 20), reset it
    if (typeof baseTarifa !== 'number' || baseTarifa > 10000 || baseTarifa < 20 || isNaN(baseTarifa)) {
      if (m.tipo && m.tipo.toLowerCase().includes('carambola')) {
        baseTarifa = 80;
      } else if (m.tipo && m.tipo.toLowerCase().includes('snooker')) {
        baseTarifa = 100;
      } else if (m.tipo && m.tipo.toLowerCase().includes('domin')) {
        baseTarifa = 50;
      } else {
        baseTarifa = 60;
      }
    }
    // Also reset Mesa 7 if it was 0
    if (m.id === 7 && baseTarifa === 0) {
      baseTarifa = 80;
    }
    // Ensure Mesa 1 and Mesa 2 are reset from exponential values
    if (m.id === 1) baseTarifa = 80;
    if (m.id === 2) baseTarifa = 80;

    return {
      ...m,
      tarifa: baseTarifa,
      tarifaBase: baseTarifa
    };
  });

  await setDoc(docRef, { mesas: updatedMesas, tarifaAutopilotActivo: false }, { merge: true });
  console.log("Mesas rates reset successfully!");
  process.exit(0);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});

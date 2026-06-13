const { initializeApp } = require('firebase/app');
const { getFirestore, doc, getDoc, setDoc } = require('firebase/firestore');
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
  const docRef = doc(db, 'config', 'cuentas_estado');
  const snap = await getDoc(docRef);
  if (!snap.exists()) {
    console.error("No existe el documento de cuentas");
    process.exit(1);
  }

  const data = snap.data();
  let cuentas = data.cuentas || [];

  // 1. Modificar la cuenta vieja de "Público" (id: 1781227582914)
  cuentas = cuentas.map(c => {
    if (c.id === 1781227582914) {
      const nuevosConsumos = c.consumos.map(item => {
        if (item.productoId === 1) {
          return { ...item, cantidad: 2 }; // Regresa a 2 (original)
        }
        return item;
      }).filter(item => item.productoId !== 7); // Eliminar las aguas
      return { ...c, consumos: nuevosConsumos };
    }
    return c;
  });

  // 2. Crear la cuenta dedicada para Mesa 9
  const cuentaMesa9 = {
    id: 1781362749755,
    mesaId: 9,
    cliente: "Público",
    tiempoJuego: 0,
    consumos: [
      {
        id: 1781365629818,
        productoId: 1,
        producto: "Cerveza Corona Extra",
        precio: 45,
        cantidad: 2
      },
      {
        id: 1781368597816,
        productoId: 7,
        producto: "Agua Embotellada 600ml",
        precio: 20,
        cantidad: 5
      }
    ],
    inicio: 1781362749755
  };

  // Evitar duplicar si ya existe
  cuentas = cuentas.filter(c => c.mesaId !== 9);
  cuentas.push(cuentaMesa9);

  await setDoc(docRef, {
    cuentas: cuentas,
    updatedAt: new Date()
  });

  console.log("¡Cuentas corregidas exitosamente!");
  console.log("Cuentas actuales:");
  console.log(JSON.stringify(cuentas, null, 2));
  process.exit(0);
}

run().catch(console.error);

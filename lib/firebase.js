import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { initializeFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY?.trim(),
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN?.trim(),
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID?.trim(),
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET?.trim(),
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID?.trim(),
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID?.trim(),
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID?.trim()
};

if (!firebaseConfig.apiKey) {
  console.error("🔥 ERROR: La variable NEXT_PUBLIC_FIREBASE_API_KEY no está definida. Asegúrate de que el archivo .env.local existe y de reiniciar el servidor (npm run dev).");
}

// Initialize Firebase only once
const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();

const auth = getAuth(app);

// IMPORTANTE: Se eliminó persistentMultipleTabManager para garantizar que CADA
// pestaña (cajero, mesero, cocina) tenga su propia conexión WebSocket directa
// con Firestore. El multi-tab manager anterior designaba solo UNA pestaña como
// "primaria" para recibir actualizaciones del servidor, haciendo que las demás
// pestañas quedaran bloqueadas esperando reenvíos a través de IndexedDB —
// causando que los pedidos de los clientes no aparecieran en cocina y mesero.
const db = initializeFirestore(app, {
  experimentalForceLongPolling: true
});

export { app, auth, db };


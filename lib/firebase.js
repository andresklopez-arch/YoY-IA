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
// Detectar si está configurado el aislamiento físico a nivel de base de datos en variables de entorno (SaaS)
const useNamedDatabases = process.env.NEXT_PUBLIC_SAAS_USE_NAMED_DATABASES === 'true';

const getDbInstance = () => {
  // Intentar deducir e inicializar base de datos física de Firestore en caliente para la pestaña
  if (useNamedDatabases && typeof window !== 'undefined') {
    try {
      const getActiveSalonId = () => {
        if (window.location && window.location.search) {
          const params = new URLSearchParams(window.location.search);
          const s = params.get('s') || params.get('salonId');
          if (s) return s;
        }
        const stored = sessionStorage.getItem('yoy_client_salon_id') || localStorage.getItem('yoy_client_salon_id');
        if (stored) return stored;
        return null;
      };

      const salonId = getActiveSalonId();
      if (salonId && salonId !== 'default' && salonId !== 'default_salon') {
        const cleanDbId = salonId.toLowerCase().replace(/[^a-z0-9-]/g, '-');
        console.log(`[Firestore Named DB] Conectando a base de datos de sucursal: ${cleanDbId}`);
        return initializeFirestore(app, { experimentalForceLongPolling: true }, cleanDbId);
      }
    } catch (e) {
      console.warn("Fallo al inicializar base de datos con nombre de Firestore, usando default:", e);
    }
  }
  return initializeFirestore(app, { experimentalForceLongPolling: true });
};

const db = getDbInstance();

export { app, auth, db };


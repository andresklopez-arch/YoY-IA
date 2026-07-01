const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs, limit, query } = require('firebase/firestore');
const fs = require('fs');

const fbConfig = {
  apiKey: '',
  authDomain: '',
  projectId: 'yoy-ia-billar',
  storageBucket: '',
  messagingSenderId: '',
  appId: ''
};

try {
  const env = fs.readFileSync('.env.local', 'utf8');
  env.split('\n').forEach(line => {
    const m = line.match(/^NEXT_PUBLIC_FIREBASE_(\w+)=(.*)$/);
    if (m) {
      const key = m[1].toLowerCase().replace(/_([a-z])/g, (g) => g[1].toUpperCase());
      fbConfig[key] = m[2].trim().replace(/['"\r]/g, '');
    }
  });
} catch(e) {
  console.error("No se pudo leer .env.local", e);
}

const app = initializeApp(fbConfig);
const db = getFirestore(app);

getDocs(query(collection(db, 'nomina_empleados'), limit(3))).then(snap => {
  snap.forEach(doc => console.log(doc.id, doc.data()));
  process.exit(0);
}).catch(e => {
  console.error(e);
  process.exit(1);
});

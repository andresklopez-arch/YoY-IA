const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs, writeBatch } = require('firebase/firestore');
const fs = require('fs');

// Leer .env.local
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

const COLLECTIONS = [
  'bitacora', 'clientes_vip', 'cocina_insumos', 'conciliaciones_bancarias', 'cortes_caja', 
  'cupones_retencion', 'gastos', 'historial_ocupacion', 'historial_stock', 
  'mantenimientos_historicos', 'mermas_auditoria', 'nomina_asistencia', 'nomina_asistencia_log', 
  'nomina_empleados', 'nomina_pagos', 'presupuestos', 'productos', 'tarifas_cambios_log', 
  'tickets', 'torneos', 'users', 'auditoria_sistema'
];

async function migrate() {
  console.log("=== INICIANDO MIGRACION DE BASE DE DATOS ===");
  for (const colName of COLLECTIONS) {
    console.log(`\nProcesando coleccion: ${colName}...`);
    try {
      const snap = await getDocs(collection(db, colName));
      let count = 0;
      let batch = writeBatch(db);
      
      snap.forEach(d => {
        const data = d.data();
        if (!data.salonId) {
          batch.update(d.ref, { salonId: 'default_salon' });
          count++;
        }
      });
      
      if (count > 0) {
        await batch.commit();
        console.log(`  MIGRACION COMPLETADA: se actualizaron ${count} documentos en ${colName} [OK]`);
      } else {
        console.log(`  Sin cambios necesarios para ${colName}.`);
      }
    } catch (err) {
      console.error(`  ERROR al procesar ${colName}:`, err.message);
    }
  }
  console.log("\n=== MIGRACION FINALIZADA CON EXITO ===");
  process.exit(0);
}

migrate().catch(err => {
  console.error("Error fatal en la migracion:", err);
  process.exit(1);
});

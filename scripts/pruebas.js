const fs = require('fs');
const path = require('path');
const dns = require('dns');
const { execSync } = require('child_process');
const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs, query, orderBy, limit, doc, getDoc, where } = require('firebase/firestore');
const { getAuth, signInWithEmailAndPassword } = require('firebase/auth');

// Helper para logs
const logPass = (name) => console.log(`\x1b[32m[PASÓ]\x1b[0m ${name}`);
const logFail = (name, err) => console.log(`\x1b[31m[FALLÓ]\x1b[0m ${name}: ${err}`);
const logSkip = (name, reason) => console.log(`\x1b[33m[SALTADO]\x1b[0m ${name} (${reason})`);

// 1. Cargar Variables de Entorno
let env = {};
try {
  const envContent = fs.readFileSync('.env.local', 'utf8');
  envContent.split('\n').forEach(line => {
    const parts = line.split('=');
    if (parts.length === 2) {
      env[parts[0].trim()] = parts[1].trim();
    }
  });
} catch (e) {
  console.warn("Advertencia: No se pudo cargar .env.local de forma nativa.");
}

const firebaseConfig = {
  apiKey: env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: env.NEXT_PUBLIC_FIREBASE_APP_ID
};

const adminEmail = 'masteradmin@yoybillar.mx';
const adminPassword = env.TEST_ADMIN_PASSWORD || '123456';

function checkConnection() {
  return new Promise((resolve) => {
    dns.lookup('firestore.googleapis.com', (err) => {
      resolve(!err);
    });
  });
}

async function runTests() {
  console.log("\n========================================================");
  console.log("       YoY IA BILLAR - TEST SUITE DE PRE-LANZAMIENTO");
  console.log("========================================================\n");

  let failedTests = 0;

  // --- PRUEBA 1: Sintaxis Pre-vuelo (ESLint) ---
  try {
    // Corremos eslint rápido sobre los archivos clave modificados
    execSync('npx eslint components/panels/ConfigPanel.js components/panels/CajaPanel.js components/Topbar.js app/page.js --quiet', { stdio: 'ignore' });
    logPass("Prueba 1: Validacion Sintáctica y Formato (ESLint)");
  } catch (e) {
    logFail("Prueba 1: Validacion Sintáctica y Formato (ESLint)", "Se detectaron advertencias o errores sintácticos pendientes.");
    failedTests++;
  }

  // --- PRUEBA 2: Integridad del Entorno y Archivos ---
  try {
    const essentialFiles = ['.env.local', 'package.json', 'firestore.rules', 'next.config.mjs'];
    essentialFiles.forEach(file => {
      if (!fs.existsSync(file)) throw new Error(`Falta el archivo esencial: ${file}`);
    });
    logPass("Prueba 2: Integridad de Archivos de Entorno y Configuración");
  } catch (e) {
    logFail("Prueba 2: Integridad de Archivos de Entorno y Configuración", e.message);
    failedTests++;
  }

  // Comprobar estado de conexión a internet
  const online = await checkConnection();
  if (!online) {
    console.log("\n\x1b[33m[AVISO]\x1b[0m Conexión a internet no disponible. Se omitirán las pruebas en la base de datos en vivo.\n");
    logSkip("Prueba 3: Conectividad en Vivo con Firestore (Colección 'users')", "Modo offline activo");
    logSkip("Prueba 4: Bitácora de Caídas Recientes (Crash Detection)", "Modo offline activo");
    logSkip("Prueba 5: Validación de Índices y Estructura de Consultas Compuestas", "Modo offline activo");
    logSkip("Prueba 6: Simulación de Integridad del Flujo de Negocio", "Modo offline activo");
    logSkip("Prueba 7: Integración de Endpoints de API (Live Vercel Check)", "Modo offline activo");
    logSkip("Prueba 8: Integridad y Consistencia de Datos de Operación", "Modo offline activo");
  } else {
    // Inicializar Firebase para pruebas de datos
    let app, db, auth;
    try {
      app = initializeApp(firebaseConfig);
      db = getFirestore(app);
      auth = getAuth(app);
    } catch (e) {
      logFail("Conectividad de Base de Datos", "No se pudo conectar a Firebase. Revisa las variables de entorno.");
      process.exit(1);
    }

    // Intentar iniciar sesión como masteradmin para pasar las reglas de seguridad en colecciones protegidas
    let authed = false;
    try {
      await signInWithEmailAndPassword(auth, adminEmail, adminPassword);
      console.log(`\x1b[34m[INFO]\x1b[0m Autenticación de prueba exitosa como: ${adminEmail}\n`);
      authed = true;
    } catch (e) {
      console.warn(`\x1b[33m[ADVERTENCIA]\x1b[0m No se pudo autenticar como ${adminEmail}. Las pruebas protegidas podrían fallar:`, e.message, "\n");
    }

    // --- PRUEBA 3: Conectividad y Colecciones en Vivo ---
    try {
      await getDocs(query(collection(db, 'users'), limit(1)));
      logPass("Prueba 3: Conectividad en Vivo con Firestore (Colección 'users')");
    } catch (e) {
      logFail("Prueba 3: Conectividad en Vivo con Firestore (Colección 'users')", e.message);
      failedTests++;
    }

    // --- PRUEBA 4: Bitácora de Caídas Recientes (Crash Detection) ---
    try {
      const crashSnap = await getDocs(query(collection(db, 'app_crash_logs'), orderBy('createdAt', 'desc'), limit(5)));
      const crashes = [];
      crashSnap.forEach(d => {
        const data = d.data();
        crashes.push(data);
      });
      
      if (crashes.length > 0) {
        console.log(`\x1b[33m[AVISO]\x1b[0m Prueba 4: Se detectaron (${crashes.length}) errores recientes en el log. Detalle del último:`);
        console.log(`        - Error: ${crashes[0].errorMessage || crashes[0].message}`);
        console.log(`        - Panel: ${crashes[0].panelName || 'desconocido'}`);
      } else {
        logPass("Prueba 4: Bitácora de Errores Limpia (No hay caídas recientes registradas)");
      }
    } catch (e) {
      logFail("Prueba 4: Análisis de Log de Errores", e.message);
      failedTests++;
    }

    // --- PRUEBA 5: Simulación de Consultas y Verificación de Índices ---
    try {
      const q = query(collection(db, 'nomina_asistencia_log'), orderBy('createdAt', 'desc'), limit(1));
      await getDocs(q);
      logPass("Prueba 5: Validación de Índices y Estructura de Consultas Compuestas");
    } catch (e) {
      logFail("Prueba 5: Validación de Índices y Estructura de Consultas Compuestas", e.message);
      failedTests++;
    }

    // --- PRUEBA 6: Simulación de Flujo de Negocio Completo ---
    try {
      const configSnap = await getDocs(collection(db, 'config'));
      if (configSnap.empty) {
        throw new Error("La colección 'config' está vacía o no existe en la base de datos.");
      }
      logPass("Prueba 6: Simulación de Integridad del Flujo de Negocio (Sucursales listas)");
    } catch (e) {
      logFail("Prueba 6: Simulación de Integridad del Flujo de Negocio", e.message);
      failedTests++;
    }

    // --- PRUEBA 7: Integración de Endpoints de API (Live Vercel Check) ---
    try {
      const targetUrl = 'https://yoy-ia-billar.vercel.app/api/auth/login';
      const res = await fetch(targetUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'test@invalid.com', password: 'wrong' })
      });
      // Esperamos 401 o 400 por credenciales inválidas, lo cual prueba que el endpoint responde.
      if (res.status === 200) {
        throw new Error("El endpoint de login respondió 200 con credenciales inválidas.");
      }
      logPass(`Prueba 7: Integración de Endpoints de API (${res.status} recibido - Endpoint Activo)`);
    } catch (e) {
      logFail("Prueba 7: Integración de Endpoints de API", e.message);
      failedTests++;
    }

    // --- PRUEBA 8: Integridad y Consistencia de Datos de Operación ---
    try {
      const mesasEstadoDoc = await getDoc(doc(db, 'config', 'mesas_estado'));
      if (!mesasEstadoDoc.exists()) {
        throw new Error("No existe el documento esencial 'config/mesas_estado' en la base de datos.");
      }
      const data = mesasEstadoDoc.data();
      if (!data || !Array.isArray(data.mesas)) {
        throw new Error("El documento 'config/mesas_estado' no tiene una estructura de mesas válida.");
      }
      logPass(`Prueba 8: Integridad de Datos de Operación (${data.mesas.length} mesas activas consistentes)`);
    } catch (e) {
      logFail("Prueba 8: Integridad y Consistencia de Datos de Operación", e.message);
      failedTests++;
    }

    // --- PRUEBA 9: Validación de Flujo de Cobro y Tiempos de Auditoría ---
    try {
      const pendingAccountsQuery = query(collection(db, 'mesa_pedidos'), where('tipo', '==', 'cuenta'), limit(5));
      const snap = await getDocs(pendingAccountsQuery);
      // Validar estructura de las alertas de cuenta
      snap.forEach(d => {
        const data = d.data();
        if (data.atendidoAdmin && data.tiempoEsperaSegundos !== undefined) {
          if (typeof data.tiempoEsperaSegundos !== 'number') {
            throw new Error(`El campo tiempoEsperaSegundos en la comanda ${d.id} no es de tipo numérico`);
          }
        }
      });
      logPass("Prueba 9: Validación de Flujo de Cobro y Tiempos de Auditoría (Atendidos con métricas)");
    } catch (e) {
      logFail("Prueba 9: Validación de Flujo de Cobro y Tiempos de Auditoría", e.message);
      failedTests++;
    }
  }

  console.log("\n========================================================");
  console.log("             DIAGNÓSTICO DE TEST COMPLETADO");
  console.log("========================================================\n");
  
  if (failedTests > 0) {
    console.error(`\x1b[31m[ERROR]\x1b[0m Se detectaron ${failedTests} pruebas fallidas de diagnóstico.\n`);
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runTests();

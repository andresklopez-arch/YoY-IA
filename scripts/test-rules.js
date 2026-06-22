const { initializeTestEnvironment, assertFails, assertSucceeds } = require('@firebase/rules-unit-testing');
const fs = require('fs');
const path = require('path');

async function runTests() {
  console.log('=== CARGANDO REGLAS DE SEGURIDAD ===');
  const rulesPath = path.join(__dirname, '../firestore.rules');
  const rulesContent = fs.readFileSync(rulesPath, 'utf8');

  // Inicializar entorno de prueba del emulador
  const testEnv = await initializeTestEnvironment({
    projectId: 'yoy-ia-billar-test-rules',
    firestore: {
      rules: rulesContent,
      host: '127.0.0.1',
      port: 8080
    }
  });

  let failed = false;
  const assertTest = async (promise, shouldSucceed, description) => {
    try {
      if (shouldSucceed) {
        await assertSucceeds(promise);
      } else {
        await assertFails(promise);
      }
      console.log(`[PASS] ${description}`);
    } catch (err) {
      console.error(`[FAIL] ${description}`);
      console.error(err);
      failed = true;
    }
  };

  try {
    console.log('\n=== CONFIGURANDO CONTEXTOS DE USUARIO ===');
    const aliceContext = testEnv.authenticatedContext('alice_emp', { salonId: 'salon_A' });
    const bobContext = testEnv.authenticatedContext('bob_emp', { salonId: 'salon_B' });
    const unauthedContext = testEnv.unauthenticatedContext();

    const dbAlice = aliceContext.firestore();
    const dbBob = bobContext.firestore();
    const dbUnauthed = unauthedContext.firestore();

    // Limpiar base de datos antes de las pruebas
    await testEnv.clearFirestore();

    console.log('\n=== INICIANDO CASOS DE PRUEBA ===');

    // 1. Acceso correcto al mismo salón (Alice escribe y lee su propio salón)
    await assertTest(
      dbAlice.collection('users').doc('user_alice').set({
        name: 'Alice',
        salonId: 'salon_A'
      }),
      true,
      'Alice (salon_A) puede crear un documento en users con salonId "salon_A"'
    );

    await assertTest(
      dbAlice.collection('users').doc('user_alice').get(),
      true,
      'Alice (salon_A) puede leer su propio documento'
    );

    // 2. Bob escribe en su propio salón
    await assertTest(
      dbBob.collection('users').doc('user_bob').set({
        name: 'Bob',
        salonId: 'salon_B'
      }),
      true,
      'Bob (salon_B) puede crear un documento en users con salonId "salon_B"'
    );

    // 3. Intento de lectura cruzada (Alice intenta leer datos de Bob)
    await assertTest(
      dbAlice.collection('users').doc('user_bob').get(),
      false,
      'Alice (salon_A) NO puede leer un documento de Bob (salon_B)'
    );

    // 4. Intento de escritura cruzada (Alice intenta modificar datos de Bob)
    await assertTest(
      dbAlice.collection('users').doc('user_bob').set({
        name: 'Hack de Alice',
        salonId: 'salon_B'
      }),
      false,
      'Alice (salon_A) NO puede escribir o modificar un documento de Bob (salon_B)'
    );

    // 5. Intento de usurpar salón (Alice intenta crear un documento con salonId de Bob)
    await assertTest(
      dbAlice.collection('users').doc('usurpacion').set({
        name: 'Impostor',
        salonId: 'salon_B'
      }),
      false,
      'Alice (salon_A) NO puede crear un documento con salonId "salon_B"'
    );

    // 6. Intento de acceso sin autenticación
    await assertTest(
      dbUnauthed.collection('users').doc('user_alice').get(),
      false,
      'Un usuario no autenticado NO puede leer datos protegidos de users'
    );

    await assertTest(
      dbUnauthed.collection('users').doc('anonymous_user').set({
        name: 'Hacker',
        salonId: 'salon_A'
      }),
      false,
      'Un usuario no autenticado NO puede escribir en users'
    );

    // 7. Validar colecciones públicas (como mesa_pedidos o clientes_anonimos)
    await assertTest(
      dbUnauthed.collection('clientes_anonimos').doc('anon_123').set({
        nickname: 'AnonPlayer',
        createdAt: new Date()
      }),
      true,
      'Cualquier usuario puede escribir en clientes_anonimos sin autenticarse'
    );

    console.log('\n=== PRUEBAS COMPLETADAS ===');
    if (failed) {
      console.error('\nResultados: ALGUNAS PRUEBAS FALLARON.');
      process.exit(1);
    } else {
      console.log('\nResultados: TODAS LAS PRUEBAS PASARON EXITOSAMENTE.');
      process.exit(0);
    }
  } catch (globalErr) {
    console.error('Error durante la ejecucion de pruebas:', globalErr);
    process.exit(1);
  } finally {
    await testEnv.cleanup();
  }
}

runTests();

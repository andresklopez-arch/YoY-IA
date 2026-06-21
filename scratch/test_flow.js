const puppeteer = require('puppeteer');

async function run() {
  console.log("Iniciando prueba con Puppeteer...");
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();

  // Capturar logs de consola de la página
  page.on('console', msg => {
    console.log(`[PÁGINA CONSOLA] ${msg.type().toUpperCase()}: ${msg.text()}`);
  });

  try {
    console.log("Navegando a la aplicación...");
    await page.goto('https://yoy-ia-billar.vercel.app/', { waitUntil: 'networkidle2' });

    console.log("Esperando a que la pantalla de inicio de sesión cargue...");
    await page.waitForSelector('select.form-select', { timeout: 10000 });

    console.log("Seleccionando el usuario Administrador Maestro...");
    await page.select('select.form-select', 'admin1111@yoybillar.mx');

    console.log("Ingresando la contraseña...");
    await page.type('input[type="password"]', 'admin1111');

    console.log("Haciendo clic en ingresar...");
    await Promise.all([
      page.click('button[type="submit"]'),
      page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }).catch(() => {})
    ]);

    console.log("Verificando si ingresamos al panel principal...");
    // Esperar a que se cargue la cabecera o el panel de mesas
    await page.waitForSelector('.page-header, .panel-header, button', { timeout: 10000 });
    console.log("¡Inicio de sesión exitoso!");

    // Tomar una captura de pantalla de comprobación
    await page.screenshot({ path: 'scratch/login_success.png' });
    console.log("Captura de pantalla guardada en scratch/login_success.png");

  } catch (error) {
    console.error("Error durante la prueba de login:", error);
    await page.screenshot({ path: 'scratch/login_error.png' });
  } finally {
    await browser.close();
    console.log("Navegador cerrado.");
  }
}

run();

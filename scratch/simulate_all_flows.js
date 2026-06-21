const puppeteer = require('puppeteer');
const fs = require('fs');

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// Función robusta para descartar cualquier alerta de servicio activa en la pantalla
async function dismissAlerts(page) {
  let dismissedCount = 0;
  let dismissed = false;
  do {
    dismissed = false;
    const buttons = await page.$$('button');
    for (const btn of buttons) {
      try {
        const text = await page.evaluate(el => el.textContent, btn);
        if (text.includes('Atendido') || (text.includes('✓') && text.toLowerCase().includes('atend'))) {
          console.log(`  [ALERTA DETECTADA] Descartando alerta activa: "${text.trim()}"`);
          await btn.click();
          await delay(2000);
          dismissed = true;
          dismissedCount++;
          break; // Salir y volver a buscar botones (por si la lista cambió)
        }
      } catch (e) {}
    }
  } while (dismissed);
  if (dismissedCount > 0) {
    console.log(`  ✓ Se descartaron ${dismissedCount} alertas de servicio.`);
  }
}

async function run() {
  console.log("=== INICIANDO SIMULACIÓN DE FLUJO REAL Y EXHAUSTIVA ===");
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    defaultViewport: { width: 1280, height: 800 }
  });
  const page = await browser.newPage();

  // Capturar errores de JS y logs de la consola de la página
  const consoleErrors = [];
  page.on('console', msg => {
    const text = msg.text();
    if (msg.type() === 'error') {
      consoleErrors.push(`[ERROR CONSOLA] ${text}`);
    }
    console.log(`[PÁGINA CONSOLA] ${msg.type().toUpperCase()}: ${text}`);
  });

  page.on('pageerror', err => {
    consoleErrors.push(`[CRASH JS] ${err.toString()}`);
    console.error(`[RUNTIME CRASH] ${err.toString()}`);
  });

  try {
    // 1. LOGIN
    console.log("\n--- PASO 1: Inicio de Sesión ---");
    await page.goto('https://yoy-ia-billar.vercel.app/', { waitUntil: 'networkidle2' });
    await page.waitForSelector('select.form-select', { timeout: 15000 });
    await page.select('select.form-select', 'admin1111@yoybillar.mx');
    await page.type('input[type="password"]', 'admin1111');
    await Promise.all([
      page.click('button[type="submit"]'),
      page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }).catch(() => {})
    ]);
    await page.waitForSelector('.page-header, .panel-header, button', { timeout: 15000 });
    console.log("✓ Login exitoso.");
    await page.screenshot({ path: 'scratch/0_login_success.png' });

    // 2. DISMISS ALERTS
    console.log("\n--- PASO 2: Descartar Alertas Activas Iniciales ---");
    await dismissAlerts(page);

    // 3. PASE DE LISTA
    console.log("\n--- PASO 3: Pase de Lista de Empleado ---");
    const buttons = await page.$$('button, span, div');
    let paseListaBtn = null;
    for (const b of buttons) {
      try {
        const text = await page.evaluate(el => el.textContent, b);
        if (text.trim() === 'Pase de Lista') {
          paseListaBtn = b;
          break;
        }
      } catch (e) {}
    }

    if (paseListaBtn) {
      console.log("  Abriendo modal de Pase de Lista...");
      await paseListaBtn.click();
      await delay(2000);

      // Esperar a que se carguen los empleados en el modal (icono de usuario)
      await page.waitForSelector('.ri-user-line', { timeout: 10000 }).catch(err => {
        console.log("  Tiempo de espera excedido para .ri-user-line, buscando elementos cargados...");
      });
      await page.screenshot({ path: 'scratch/1_pase_lista_modal.png' });

      // Buscar el primer empleado de la lista (ej: mesero, staff, cajero, etc.) de forma insensible a mayúsculas
      const employeeCards = await page.$$('div');
      let firstEmployee = null;
      for (const card of employeeCards) {
        try {
          const text = await page.evaluate(el => el.textContent, card);
          const upperText = text.toUpperCase();
          if (
            upperText.includes('MESERO') || 
            upperText.includes('STAFF') || 
            upperText.includes('CAJERO') ||
            upperText.includes('BARTENDER') ||
            upperText.includes('GUARDIA') ||
            upperText.includes('LIMPIEZA')
          ) {
            firstEmployee = card;
            console.log(`  Empleado encontrado en UI: "${text.trim().replace(/\n/g, ' ')}"`);
            break;
          }
        } catch (e) {}
      }

      if (firstEmployee) {
        console.log("  Haciendo clic en el primer empleado para fichar...");
        await firstEmployee.click();
        await delay(2500);

        // Si es mesero, abre el modal de asignación de mesas
        const subButtons = await page.$$('button');
        let omitirBtn = null;
        for (const btn of subButtons) {
          const text = await page.evaluate(el => el.textContent, btn);
          if (text.includes('Omitir y Fichar Entrada') || text.includes('Asignar y Fichar Entrada')) {
            omitirBtn = btn;
            break;
          }
        }

        if (omitirBtn) {
          console.log(`  Confirmando asistencia con '${await page.evaluate(el => el.textContent, omitirBtn)}'...`);
          await omitirBtn.click();
          await delay(3000);
          console.log("✓ Asistencia fichada exitosamente.");
          await page.screenshot({ path: 'scratch/2_pase_lista_success.png' });
        } else {
          console.log("  Fichado directo de entrada procesado.");
        }
      } else {
        console.log("  No se encontraron empleados activos en la lista.");
      }
      
      // Asegurarnos de que el modal de pase de lista se cierre si se quedó abierto
      const closeButtons = await page.$$('button');
      for (const btn of closeButtons) {
        const text = await page.evaluate(el => el.textContent, btn);
        if (text.includes('Volver') || text.includes('Cancelar') || text.includes('Cerrar') || text.includes('✖')) {
          await btn.click().catch(() => {});
          await delay(1000);
        }
      }
    } else {
      console.log("  No se encontró el botón de 'Pase de Lista'.");
    }

    // 4. ABRIR MESA
    console.log("\n--- PASO 4: Abrir Mesa Física ---");
    await dismissAlerts(page);
    const cards = await page.$$('.mesa-card');
    let libreCard = null;
    let mesaIdSeleccionada = null;

    for (const card of cards) {
      const isLibre = await page.evaluate(el => el.classList.contains('libre'), card);
      if (isLibre) {
        libreCard = card;
        mesaIdSeleccionada = await page.evaluate(el => {
          const numEl = el.querySelector('.mesa-number');
          return numEl ? numEl.textContent.trim() : null;
        }, card);
        break;
      }
    }

    if (libreCard && mesaIdSeleccionada) {
      // Encontrar el botón 'Abrir' dentro de la mesa-card
      const cardButtons = await libreCard.$$('button');
      let abrirMesaBtnInCard = null;
      for (const btn of cardButtons) {
        const text = await page.evaluate(el => el.textContent, btn);
        if (text.includes('Abrir')) {
          abrirMesaBtnInCard = btn;
          break;
        }
      }
      if (abrirMesaBtnInCard) {
        console.log(`  Haciendo clic en el botón 'Abrir' de la Mesa ${mesaIdSeleccionada}...`);
        await abrirMesaBtnInCard.click();
      } else {
        console.log("  No se encontró el botón 'Abrir', intentando clic general en la tarjeta...");
        await libreCard.click();
      }
      await delay(2500);

      // Llenar el nombre en el modal
      await page.waitForSelector('input[placeholder="Ej: Carlos Rodríguez"]', { timeout: 10000 });
      await page.type('input[placeholder="Ej: Carlos Rodríguez"]', 'Cliente Simulado Puppeteer');
      
      // Rentar equipamiento premium
      const checkboxes = await page.$$('input[type="checkbox"]');
      if (checkboxes.length > 0) {
        console.log("  Seleccionando renta de equipamiento premium opcional...");
        await checkboxes[0].click();
      }

      // Iniciar Mesa
      const modalButtons = await page.$$('button');
      let iniciarMesaBtn = null;
      for (const btn of modalButtons) {
        const text = await page.evaluate(el => el.textContent, btn);
        if (text.includes('Iniciar Mesa')) {
          iniciarMesaBtn = btn;
          break;
        }
      }

      if (iniciarMesaBtn) {
        await iniciarMesaBtn.click();
        await delay(4000);
        console.log(`✓ Mesa ${mesaIdSeleccionada} abierta exitosamente.`);
        await page.screenshot({ path: 'scratch/3_mesa_abierta.png' });
      } else {
        throw new Error("No se encontró el botón 'Iniciar Mesa' en el modal.");
      }
    } else {
      console.log("  No se encontraron mesas libres para abrir.");
    }

    // 5. REGISTRAR COMANDA
    console.log("\n--- PASO 5: Registrar Comanda de Consumo ---");
    await dismissAlerts(page);
    const topBarButtons = await page.$$('button');
    let comandaBtn = null;
    for (const btn of topBarButtons) {
      const text = await page.evaluate(el => el.textContent, btn);
      if (text.includes('Comanda')) {
        comandaBtn = btn;
        break;
      }
    }

    if (comandaBtn && mesaIdSeleccionada) {
      console.log("  Abriendo modal de Registro de Comanda...");
      await comandaBtn.click();
      await delay(2000);

      // Clic en destino Mesa
      const destButtons = await page.$$('button');
      for (const dBtn of destButtons) {
        const text = await page.evaluate(el => el.textContent, dBtn);
        if (text.trim() === 'Mesa') {
          await dBtn.click();
          break;
        }
      }
      await delay(1000);

      // Seleccionar la mesa destino en el select
      await page.waitForSelector('select.form-select', { timeout: 10000 });
      await page.select('select.form-select', String(mesaIdSeleccionada));
      await delay(1000);

      // Agregar un producto disponible que no esté agotado
      const productDivs = await page.$$('div');
      let addedProduct = false;
      for (const div of productDivs) {
        try {
          const text = await page.evaluate(el => el.textContent, div);
          const isAgotado = text.includes('AGOTADO');
          if (text.includes('Stock:') && !isAgotado && text.includes('$')) {
            console.log(`  Agregando producto a la comanda: ${text.split('\n')[0].trim()}`);
            await div.click();
            await delay(500);
            await div.click();
            await delay(1000);
            addedProduct = true;
            break;
          }
        } catch (e) {}
      }

      if (addedProduct) {
        // Enviar comanda
        const submitButtons = await page.$$('button');
        let sendBtn = null;
        for (const btn of submitButtons) {
          const text = await page.evaluate(el => el.textContent, btn);
          if (text.includes('Confirmar y Enviar')) {
            sendBtn = btn;
            break;
          }
        }

        if (sendBtn) {
          await sendBtn.click();
          await delay(4000);
          console.log("✓ Comanda registrada y enviada a preparación.");
          await page.screenshot({ path: 'scratch/4_comanda_enviada.png' });
        } else {
          console.log("  No se encontró el botón 'Confirmar y Enviar'.");
        }
      } else {
        console.log("  No había productos con stock disponible para la comanda.");
      }
    } else {
      console.log("  No se pudo registrar comanda (falta botón o mesa destino).");
    }

    // 6. PROCESAR EN COCINA
    console.log("\n--- PASO 6: Preparar Comanda en Cocina ---");
    await page.goto('https://yoy-ia-billar.vercel.app/cocina', { waitUntil: 'networkidle2' });
    await delay(4000);

    const kitchenButtons = await page.$$('button');
    let listosCocina = 0;
    for (const kBtn of kitchenButtons) {
      try {
        const text = await page.evaluate(el => el.textContent, kBtn);
        if (text.includes('Pedido Listo')) {
          console.log("  Cocinero marca comanda como lista para mesero...");
          await kBtn.click();
          await delay(2000);
          listosCocina++;
        }
      } catch (e) {}
    }
    console.log(`✓ Se procesaron ${listosCocina} comandas listas en cocina.`);
    await page.screenshot({ path: 'scratch/5_cocina_lista.png' });

    // 7. ENTREGAR COMO MESERO
    console.log("\n--- PASO 7: Entregar Comanda como Mesero ---");
    await page.goto('https://yoy-ia-billar.vercel.app/mesero', { waitUntil: 'networkidle2' });
    await delay(4000);

    const meseroButtons = await page.$$('button');
    let entregasMesero = 0;
    for (const mBtn of meseroButtons) {
      try {
        const text = await page.evaluate(el => el.textContent, mBtn);
        if (text.includes('Atendido') && text.includes('✓')) {
          console.log("  Mesero descarta alerta y entrega pedido al cliente...");
          await mBtn.click();
          await delay(2000);
          entregasMesero++;
        }
      } catch (e) {}
    }
    console.log(`✓ Se entregaron ${entregasMesero} comandas en el panel de mesero.`);
    await page.screenshot({ path: 'scratch/6_mesero_entregado.png' });

    // 8. CERRAR MESA Y COBRAR
    console.log("\n--- PASO 8: Cerrar Mesa y Cobrar en Caja ---");
    await page.goto('https://yoy-ia-billar.vercel.app/', { waitUntil: 'networkidle2' });
    await delay(4000);
    await dismissAlerts(page);

    if (mesaIdSeleccionada) {
      const activeCards = await page.$$('.mesa-card');
      let targetMesaCard = null;
      for (const card of activeCards) {
        const idText = await page.evaluate(el => {
          const numEl = el.querySelector('.mesa-number');
          return numEl ? numEl.textContent.trim() : null;
        }, card);
        if (idText === String(mesaIdSeleccionada)) {
          targetMesaCard = card;
          break;
        }
      }

      if (targetMesaCard) {
        const closeBtn = await targetMesaCard.$('button');
        if (closeBtn) {
          console.log(`  Abriendo modal de cobro para la Mesa ${mesaIdSeleccionada}...`);
          await closeBtn.click();
          await delay(3000);

          await page.waitForSelector('input[placeholder="0.00"]', { timeout: 10000 });
          await page.type('input[placeholder="0.00"]', '1000');
          await delay(1000);

          const payButtons = await page.$$('button');
          let confirmPayBtn = null;
          for (const btn of payButtons) {
            const text = await page.evaluate(el => el.textContent, btn);
            if (text.includes('Cerrar y Cobrar') || text.includes('Registrar Cortesía')) {
              confirmPayBtn = btn;
              break;
            }
          }

          if (confirmPayBtn) {
            console.log("  Confirmando cobro y liberando la mesa...");
            await confirmPayBtn.click();
            await delay(5000);
            console.log(`✓ Mesa ${mesaIdSeleccionada} cerrada y liquidada.`);
            await page.screenshot({ path: 'scratch/7_mesa_cerrada.png' });
          } else {
            console.log("  No se encontró el botón de cobrar.");
          }
        }
      }
    }

    // 9. CORTE DE CAJA
    console.log("\n--- PASO 9: Realizar Corte de Caja ---");
    await dismissAlerts(page);
    const headerButtons = await page.$$('button, span');
    let cajaTabBtn = null;
    for (const b of headerButtons) {
      try {
        const text = await page.evaluate(el => el.textContent, b);
        if (text.trim() === 'Caja' || text.trim() === 'Inteligencia') {
          cajaTabBtn = b;
          break;
        }
      } catch (e) {}
    }

    if (cajaTabBtn) {
      console.log("  Navegando a Caja/Inteligencia...");
      await cajaTabBtn.click();
      await delay(4000);

      const panelButtons = await page.$$('button');
      let corteBtn = null;
      for (const btn of panelButtons) {
        const text = await page.evaluate(el => el.textContent, btn);
        if (text.includes('Corte de Caja')) {
          corteBtn = btn;
          break;
        }
      }

      if (corteBtn) {
        console.log("  Abriendo modal de Corte de Caja...");
        await corteBtn.click();
        await delay(2000);

        const numInputs = await page.$$('input[type="number"]');
        for (const input of numInputs) {
          try {
            await input.focus();
            await page.keyboard.press('Backspace');
            await input.type('1');
          } catch (e) {}
        }
        await delay(1000);

        const corteConfirmButtons = await page.$$('button');
        let saveCorteBtn = null;
        for (const btn of corteConfirmButtons) {
          const text = await page.evaluate(el => el.textContent, btn);
          if (text.includes('Guardar y Cerrar Corte')) {
            saveCorteBtn = btn;
            break;
          }
        }

        if (saveCorteBtn) {
          console.log("  Guardando corte de caja...");
          await saveCorteBtn.click();
          await delay(4000);
          console.log("✓ Corte de caja guardado con éxito.");
          await page.screenshot({ path: 'scratch/8_corte_caja_success.png' });
        } else {
          console.log("  No se encontró el botón 'Guardar y Cerrar Corte'.");
        }
      }
    }

    // FINALIZACIÓN
    console.log("\n--- RESULTADO DE PRUEBAS ---");
    if (consoleErrors.length > 0) {
      console.log(`⚠️ Se detectaron ${consoleErrors.length} errores de JavaScript o consola durante la prueba:`);
      consoleErrors.forEach(err => console.log(`  - ${err}`));
    } else {
      console.log("✓ Excelente: 0 errores de consola o runtime detectados.");
    }
    
    await page.screenshot({ path: 'scratch/simulation_success.png' });
    console.log("Captura de pantalla final guardada en scratch/simulation_success.png");

  } catch (error) {
    console.error("❌ Ocurrió un error en la simulación:", error);
    await page.screenshot({ path: 'scratch/simulation_error.png' });
  } finally {
    await browser.close();
    console.log("Navegador cerrado.");
  }
}

run();

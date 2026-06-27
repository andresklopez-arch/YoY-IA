const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log("=== INICIANDO VALIDACION DE ESPACIO Y ARCHIVOS ===");

// ── CHEQUEO DE ARCHIVOS GRANDES (> 2 MB) ──
const MAX_FILE_SIZE = 2 * 1024 * 1024; // 2 MB
const IGNORED_PATHS = ['node_modules', '.git', '.next', '.vercel', 'backups'];

function checkLargeFiles(dir) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    if (IGNORED_PATHS.some(ignored => fullPath.includes(ignored))) continue;
    
    try {
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        checkLargeFiles(fullPath);
      } else if (stat.size > MAX_FILE_SIZE) {
        console.warn(`\n⚠️  ADVERTENCIA DE RENDIMIENTO:`);
        console.warn(`   Archivo muy pesado detectado: ${fullPath} (${(stat.size / (1024 * 1024)).toFixed(2)} MB)`);
        console.warn(`   Esto causara lentitud al subir cambios con Git.\n`);
      }
    } catch (e) {}
  }
}

try {
  checkLargeFiles('.');
} catch (e) {
  console.warn("No se pudo realizar el chequeo de archivos grandes:", e.message);
}

console.log("\n=== INICIANDO VALIDACION SINTACTICA CON ESLINT ===");

try {
  console.log("Analizando archivos en components/panels y app/page.js (excluyendo recovered)...");
  const stdout = execSync('npx eslint components/panels app/page.js --format=json --ignore-pattern "**/*recovered*"', { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
  const results = JSON.parse(stdout);
  
  let hasSyntaxErrors = false;
  results.forEach(result => {
    const syntaxErrors = result.messages.filter(msg => msg.fatal || !msg.ruleId);
    if (syntaxErrors.length > 0) {
      console.error(`❌ Error de sintaxis en: ${result.filePath}`);
      syntaxErrors.forEach(msg => {
        console.error(`   Linea ${msg.line}, Col ${msg.column}: ${msg.message}`);
      });
      hasSyntaxErrors = true;
    }
  });
  
  if (hasSyntaxErrors) {
    console.log("❌ Validacion fallida. Se encontraron errores de parsing/sintaxis.");
    process.exit(1);
  } else {
    console.log("✓ Validacion exitosa. Todos los archivos son sintacticamente validos.");
    process.exit(0);
  }
} catch (error) {
  if (error.stdout) {
    try {
      const results = JSON.parse(error.stdout);
      let hasSyntaxErrors = false;
      results.forEach(result => {
        const syntaxErrors = result.messages.filter(msg => msg.fatal || !msg.ruleId);
        if (syntaxErrors.length > 0) {
          console.error(`❌ Error de sintaxis en: ${result.filePath}`);
          syntaxErrors.forEach(msg => {
            console.error(`   Linea ${msg.line}, Col ${msg.column}: ${msg.message}`);
          });
          hasSyntaxErrors = true;
        }
      });
      
      if (hasSyntaxErrors) {
        console.log("❌ Validacion fallida. Se encontraron errores de parsing/sintaxis.");
        process.exit(1);
        return;
      }
      
      console.log("✓ Validacion exitosa (los avisos del linter no-sintacticos fueron ignorados).");
      process.exit(0);
      return;
    } catch (e) {
      console.error("Error al parsear el JSON de salida de ESLint:", e);
    }
  }
  
  console.error("Error al ejecutar ESLint:", error.message);
  process.exit(1);
}

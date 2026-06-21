const fs = require('fs');

const content = fs.readFileSync('app/mesero/page.js', 'utf8');
const lines = content.split('\n');

// Buscar dónde se usa 'err' y no está en la firma de un catch o parámetro
lines.forEach((line, idx) => {
  if (line.includes('err')) {
    console.log(`${idx + 1}: ${line.trim()}`);
  }
});

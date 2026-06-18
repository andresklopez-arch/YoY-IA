const fs = require('fs');

const lines = fs.readFileSync('components/panels/MesasPanel.js', 'utf-8').split('\n');

for (let i = 4940; i <= 5150; i++) {
  const line = lines[i];
  if (line.includes('height') || line.includes('aspect')) {
    console.log(`${i + 1}: ${line.trim()}`);
  }
}

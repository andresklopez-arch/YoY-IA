const fs = require('fs');

const content = fs.readFileSync('styles/globals.css', 'utf-8');

// Match css rules
const regex = /([^{]+)\{([^}]+)\}/g;
let match;
while ((match = regex.exec(content)) !== null) {
  const selector = match[1].trim();
  const body = match[2].trim();
  if (selector.includes('mesa')) {
    console.log(`Selector: ${selector}`);
    body.split('\n').forEach(line => {
      console.log(`  ${line.trim()}`);
    });
    console.log("-".repeat(40));
  }
}

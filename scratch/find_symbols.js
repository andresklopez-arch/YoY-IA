const fs = require('fs');
const code = fs.readFileSync('components/panels/CajaPanel.js', 'utf8');
const lines = code.split('\n');
const query = process.argv[2] || '';
const isRegex = process.argv[3] === 'true';

console.log(`Searching for "${query}" (regex: ${isRegex}):`);
lines.forEach((line, index) => {
  let matches = false;
  if (isRegex) {
    matches = new RegExp(query, 'i').test(line);
  } else {
    matches = line.toLowerCase().includes(query.toLowerCase());
  }
  if (matches) {
    console.log(`${index + 1}: ${line.trim().substring(0, 120)}`);
  }
});

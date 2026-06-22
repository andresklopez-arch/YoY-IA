const fs = require('fs');
const parser = require('@babel/parser');

const code = fs.readFileSync('components/Topbar.js', 'utf8');

try {
  parser.parse(code, {
    sourceType: 'module',
    plugins: ['jsx']
  });
  console.log("Successfully parsed Topbar.js!");
} catch (err) {
  console.error("Babel parser error:");
  console.error(err.message);
  console.error(`Position: line ${err.loc.line}, col ${err.loc.column}`);
}

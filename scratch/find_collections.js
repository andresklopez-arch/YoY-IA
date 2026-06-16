const fs = require('fs');
const path = require('path');

function walk(dir) {
  fs.readdirSync(dir).forEach(f => {
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) {
      if (f !== 'node_modules' && f !== '.next' && f !== '.git') walk(p);
    } else if (f.endsWith('.js') || f.endsWith('.jsx')) {
      const code = fs.readFileSync(p, 'utf8');
      const regex = /collection\s*\(\s*db\s*,\s*['"]([^'"]+)['"]/g;
      let m;
      while ((m = regex.exec(code)) !== null) {
        console.log(`${p}: ${m[1]}`);
      }
    }
  });
}

walk('.');
process.exit(0);

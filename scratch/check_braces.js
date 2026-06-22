const fs = require('fs');

const content = fs.readFileSync('components/Topbar.js', 'utf8');

const stack = [];
let inString = null; // ' or " or `
let isEscaped = false;
let line = 1;
let col = 1;

for (let i = 0; i < content.length; i++) {
  const char = content[i];
  if (char === '\n') {
    line++;
    col = 1;
  } else {
    col++;
  }

  if (isEscaped) {
    isEscaped = false;
    continue;
  }

  if (char === '\\') {
    isEscaped = true;
    continue;
  }

  // Handle strings (rough, but works for basic brace check)
  if (inString) {
    if (char === inString) {
      inString = null;
    }
    continue;
  }

  if (char === "'" || char === '"' || char === '`') {
    inString = char;
    continue;
  }

  // Handle comments
  if (char === '/' && content[i + 1] === '/') {
    // skip line
    while (i < content.length && content[i] !== '\n') {
      i++;
    }
    line++;
    col = 1;
    continue;
  }
  if (char === '/' && content[i + 1] === '*') {
    // skip block comment
    i += 2;
    while (i < content.length && !(content[i] === '*' && content[i + 1] === '/')) {
      if (content[i] === '\n') {
        line++;
        col = 1;
      } else {
        col++;
      }
      i++;
    }
    i++;
    continue;
  }

  if (char === '{' || char === '(' || char === '[') {
    stack.push({ char, line, col, index: i });
  } else if (char === '}' || char === ')' || char === ']') {
    if (stack.length === 0) {
      console.log(`Unmatched closing ${char} at line ${line}, col ${col}`);
      continue;
    }
    const last = stack.pop();
    const matches = { '}': '{', ')': '(', ']': '[' };
    if (last.char !== matches[char]) {
      console.log(`Mismatched closing ${char} at line ${line}, col ${col} (expected to match ${last.char} from line ${last.line}, col ${last.col})`);
    }
  }
}

if (stack.length > 0) {
  console.log(`Unclosed items left on stack:`);
  stack.forEach(item => {
    console.log(`  Unclosed ${item.char} at line ${item.line}, col ${item.col}`);
  });
} else {
  console.log("No unmatched braces/brackets found by basic scanner.");
}

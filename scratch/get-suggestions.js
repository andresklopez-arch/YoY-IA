const fs = require('fs');
const path = require('path');

const logPath = 'C:\\Users\\andre\\.gemini\\antigravity\\brain\\3c3ca309-1a16-4444-9c95-d15d3e041370\\.system_generated\\logs\\transcript.jsonl';
if (!fs.existsSync(logPath)) {
  console.log("Log path doesn't exist: " + logPath);
  process.exit(1);
}

const content = fs.readFileSync(logPath, 'utf8');
const lines = content.split('\n').filter(Boolean);

for (let i = 0; i < lines.length; i++) {
  try {
    const obj = JSON.parse(lines[i]);
    if (obj.step_index === 536) {
      console.log(`\n--- STEP ${obj.step_index} (${obj.type}) (${obj.created_at}) ---`);
      console.log(obj.content);
      console.log("-------------------------\n");
    }
  } catch (e) {
  }
}

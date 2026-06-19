const fs = require('fs');

const logPath = 'C:\\Users\\andre\\.gemini\\antigravity\\brain\\445d2bfa-db3b-4699-a3c6-950ee47c8a4b\\.system_generated\\logs\\transcript.jsonl';
if (!fs.existsSync(logPath)) {
  console.log("Log path doesn't exist");
  process.exit(1);
}

const content = fs.readFileSync(logPath, 'utf8');
const lines = content.split('\n').filter(Boolean);

let count = 0;
for (let i = lines.length - 1; i >= 0; i--) {
  try {
    const obj = JSON.parse(lines[i]);
    if (obj.source === 'MODEL' && obj.type === 'PLANNER_RESPONSE') {
      const text = obj.content || '';
      if (text.length > 500 && (text.toLowerCase().includes('sugerencia') || text.toLowerCase().includes('sugerir'))) {
        console.log(`\n--- STEP ${obj.step_index} (${obj.created_at}) ---`);
        console.log(text.substring(0, 1500));
        console.log("...\n");
        count++;
        if (count >= 5) break;
      }
    }
  } catch (e) {
  }
}

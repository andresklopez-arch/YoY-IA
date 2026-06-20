const fs = require('fs');
const readline = require('readline');

async function processLineByLine() {
  const fileStream = fs.createReadStream('C:/Users/andre/.gemini/antigravity/brain/445d2bfa-db3b-4699-a3c6-950ee47c8a4b/.system_generated/logs/transcript.jsonl');

  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });

  const lines = [];
  for await (const line of rl) {
    lines.push(line);
  }

  // Print last 50 steps
  const lastLines = lines.slice(-50);
  lastLines.forEach(line => {
    try {
      const data = JSON.parse(line);
      console.log(`\n--- STEP ${data.step_index} (${data.type}) ---`);
      if (data.tool_calls) {
        console.log("Tools called:");
        data.tool_calls.forEach(tc => {
          console.log(`  - ${tc.name}: ${JSON.stringify(tc.arguments)}`);
        });
      }
      if (data.content && data.content.trim().length > 0) {
        console.log("Content summary:", data.content.substring(0, 200) + "...");
      }
    } catch(e) {
      console.log("Error parsing line", e);
    }
  });
}

processLineByLine();

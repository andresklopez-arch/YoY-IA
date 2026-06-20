const fs = require('fs');
const readline = require('readline');

async function processLineByLine() {
  const fileStream = fs.createReadStream('C:/Users/andre/.gemini/antigravity/brain/445d2bfa-db3b-4699-a3c6-950ee47c8a4b/.system_generated/logs/transcript.jsonl');

  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });

  let stepIdx = 0;
  for await (const line of rl) {
    try {
      const data = JSON.parse(line);
      if (data.type === 'USER_INPUT') {
        console.log(`\n--- STEP ${data.step_index} (USER) ---`);
        console.log(data.content);
      } else if (data.type === 'PLANNER_RESPONSE') {
        // Just print the first 200 chars of model response to understand context
        console.log(`--- STEP ${data.step_index} (MODEL) ---`);
        const text = data.content || '';
        console.log(text.substring(0, 300) + '...');
      }
    } catch (e) {
      // ignore
    }
  }
}

processLineByLine();

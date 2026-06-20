const fs = require('fs');
const readline = require('readline');

async function processLineByLine() {
  const fileStream = fs.createReadStream('C:/Users/andre/.gemini/antigravity/brain/445d2bfa-db3b-4699-a3c6-950ee47c8a4b/.system_generated/logs/transcript.jsonl');

  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });

  for await (const line of rl) {
    try {
      const data = JSON.parse(line);
      const idx = data.step_index;
      if (idx === 11743 || idx === 11744) {
        console.log(`\n--- STEP ${idx} (${data.type}) ---`);
        console.log(JSON.stringify(data, null, 2));
      }
    } catch(e) {
      // ignore
    }
  }
}

processLineByLine();

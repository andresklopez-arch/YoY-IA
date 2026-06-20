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
      if (idx >= 11727 && idx <= 11744) {
        console.log(`\n--- STEP ${idx} (${data.type}) ---`);
        if (data.tool_calls) {
          data.tool_calls.forEach(tc => {
            console.log(`  Tool: ${tc.name}`);
            if (tc.arguments.TargetFile) console.log(`    TargetFile: ${tc.arguments.TargetFile}`);
            if (tc.arguments.CommandLine) console.log(`    CommandLine: ${tc.arguments.CommandLine}`);
            if (tc.arguments.Instruction) console.log(`    Instruction: ${tc.arguments.Instruction}`);
            if (tc.arguments.Description) console.log(`    Description: ${tc.arguments.Description}`);
            if (tc.arguments.ReplacementChunks) {
              console.log(`    ReplacementChunks count: ${tc.arguments.ReplacementChunks.length}`);
              tc.arguments.ReplacementChunks.forEach((chunk, cIdx) => {
                console.log(`      Chunk ${cIdx}: lines ${chunk.StartLine}-${chunk.EndLine}`);
              });
            }
          });
        }
        if (data.content && data.content.trim().length > 0) {
          console.log("Content summary:", data.content.substring(0, 300) + "...");
        }
      }
    } catch(e) {
      // ignore
    }
  }
}

processLineByLine();

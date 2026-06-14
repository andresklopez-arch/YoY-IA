const fs = require('fs');
const { execSync } = require('child_process');

try {
  const envContent = fs.readFileSync('.env.local', 'utf8');
  const lines = envContent.split('\n');

  for (let line of lines) {
    line = line.trim();
    if (!line || line.startsWith('#')) continue;
    const eqIdx = line.indexOf('=');
    if (eqIdx === -1) continue;
    const key = line.slice(0, eqIdx).trim();
    let value = line.slice(eqIdx + 1).trim();
    
    // Remove enclosing quotes if present
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    
    if (key && value) {
      console.log(`Syncing ${key}...`);
      try {
        // Add to production
        execSync(`npx vercel env add ${key} production --value "${value.replace(/"/g, '\\"')}" --force --yes`, { stdio: 'inherit' });
        // Add to preview
        execSync(`npx vercel env add ${key} preview --value "${value.replace(/"/g, '\\"')}" --force --yes`, { stdio: 'inherit' });
      } catch (err) {
        console.error(`Error syncing ${key}:`, err.message);
      }
    }
  }
  console.log('All env vars synced successfully!');
} catch (err) {
  console.error('Failed to run sync_env_vars:', err);
}

const { execSync } = require('child_process');

try {
  const date = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const dateStr = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  
  console.log(`[Backup] Iniciando creación de copia de seguridad para timestamp: ${dateStr}...`);
  
  const zipPath = `backups\\yoy-ia-billar-backup-${dateStr}.zip`;
  const latestPath = `backups\\yoy-ia-billar-backup-latest.zip`;
  
  execSync(`powershell -Command "Get-ChildItem -Path . -Exclude 'node_modules', '.next', '.git', 'backups', '.vercel' | Compress-Archive -DestinationPath '${zipPath}' -Force"`);
  execSync(`powershell -Command "Copy-Item '${zipPath}' '${latestPath}' -Force"`);
  
  console.log(`[Backup] Copia de seguridad guardada con éxito: ${zipPath}`);
} catch (error) {
  console.error('[Backup] Error al crear la copia de seguridad:', error.message);
  process.exit(1);
}

@echo off
echo ================================
echo  YoY IA BILLAR - Subir Cambios
echo ================================

echo  Creando copia de seguridad local (Backup)...
powershell -Command "$dateStr = Get-Date -Format 'yyyyMMdd_HHmmss'; Get-ChildItem -Path . -Exclude 'node_modules', '.next', '.git', 'backups', '.vercel' | Compress-Archive -DestinationPath \"..\yoy-ia-billar-backup-$dateStr.zip\" -Force; Copy-Item \"..\yoy-ia-billar-backup-$dateStr.zip\" \"..\yoy-ia-billar-backup-latest.zip\" -Force"
echo  Backup local guardado.

echo  Desplegando reglas de seguridad de Firestore...
call npx firebase deploy --only firestore:rules
echo.

git add .
git commit -m "Actualizacion: %date% %time%"

:: Intentar git push
git push
if %ERRORLEVEL% EQU 0 (
  echo ================================
  echo  Cambios subidos correctamente (GitHub)
  echo ================================
  goto end
)

echo.
echo  Git push no disponible. Desplegando en segundo plano con Vercel...
npx vercel --prod --no-wait --yes
if %ERRORLEVEL% EQU 0 (
  echo ================================
  echo  Despliegue iniciado en Vercel (En segundo plano)
  echo ================================
) else (
  echo ================================
  echo  ERROR al iniciar despliegue en Vercel
  echo ================================
)

:end
pause

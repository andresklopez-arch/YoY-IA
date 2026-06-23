@echo off
echo ================================
echo  YoY IA BILLAR - Subir Cambios
echo ================================

echo  Creando copia de seguridad local (Backup)...
powershell -Command "$dateStr = Get-Date -Format 'yyyyMMdd_HHmmss'; Get-ChildItem -Path . -Exclude 'node_modules', '.next', '.git', 'backups', '.vercel' | Compress-Archive -DestinationPath \"..\yoy-ia-billar-backup-$dateStr.zip\" -Force; Copy-Item \"..\yoy-ia-billar-backup-$dateStr.zip\" \"..\yoy-ia-billar-backup-latest.zip\" -Force"
echo  Backup local guardado.

echo  Corriendo validador sintactico pre-vuelo...
call node scripts/validate-jsx.js
if %ERRORLEVEL% NEQ 0 (
  echo ====================================================
  echo  ERROR: La validacion de codigo fallo. Abortando despliegue.
  echo ====================================================
  goto end
)
echo  Validacion sintactica exitosa.
echo.

echo  Ejecutando suite de pruebas de diagnostico (PRUEBAS)...
call node scripts/pruebas.js
if %ERRORLEVEL% NEQ 0 (
  echo ====================================================
  echo  ERROR: Las pruebas de diagnostico fallaron. Abortando despliegue.
  echo ====================================================
  goto end
)
echo  Pruebas completadas exitosamente.
echo.

echo  Validando compilacion local (npm run build)...
call npm run build
if %ERRORLEVEL% NEQ 0 (
  echo ====================================================
  echo  ERROR: La compilacion ha fallado. Abortando despliegue.
  echo ====================================================
  goto end
)
echo  Compilacion local verificada con exito.
echo.

echo  Desplegando reglas de seguridad de Firestore...
call npx firebase deploy --only firestore:rules
echo.

git add .
git commit -m "Actualizacion: %date% %time%"

:: Intentar git push
git push
if %ERRORLEVEL% EQU 0 (
  echo ================================
  echo  Cambios subidos correctamente a GitHub
  echo ================================
) else (
  echo ================================
  echo  ADVERTENCIA: No se pudo subir a GitHub
  echo ================================
)

echo.
echo  Desplegando en Vercel (Producción)...
call npx vercel deploy --prod --yes
if %ERRORLEVEL% EQU 0 (
  echo ================================
  echo  Despliegue completado con éxito en Vercel
  echo ================================
) else (
  echo ================================
  echo  ERROR al desplegar en Vercel
  echo ================================
)

:end
pause

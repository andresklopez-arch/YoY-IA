@echo off
echo ================================
echo  YoY IA BILLAR - Subir Cambios
echo ================================

echo  Desplegando reglas de seguridad de Firestore...
call npx firebase deploy --only firestore:rules
echo.

git add .
git commit -m "Actualizacion: %date% %time%"

:: Intentar git push
git push
if %ERRORLEVEL% EQU 0 (
  echo ================================
  echo  Cambios subidos correctamente
  echo ================================
  goto end
)

echo.
echo  Git push no disponible. Desplegando con Vercel CLI...
npx vercel --prod --yes
if %ERRORLEVEL% EQU 0 (
  echo ================================
  echo  Desplegado en Vercel OK
  echo ================================
) else (
  echo ================================
  echo  ERROR al desplegar en Vercel
  echo ================================
)

:end
pause

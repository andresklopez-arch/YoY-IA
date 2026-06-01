@echo off
echo ================================
echo  YoY IA BILLAR - Subir Cambios
echo ================================
git add .
git commit -m "Actualizacion: %date% %time%"

:: Intentar git push
git push
IF %ERRORLEVEL% NEQ 0 (
  echo.
  echo  Git push no disponible. Desplegando con Vercel CLI...
  npx vercel --prod --yes
  IF %ERRORLEVEL% EQU 0 (
    echo ================================
    echo  Desplegado en Vercel OK
    echo ================================
  ) ELSE (
    echo ================================
    echo  ERROR al desplegar en Vercel
    echo ================================
  )
) ELSE (
  echo ================================
  echo  Cambios subidos correctamente
  echo ================================
)
pause

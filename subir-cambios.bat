@echo off
echo ================================
echo  YoY IA BILLAR - Subir Cambios
echo ================================
git add .
git commit -m "Actualizacion: %date% %time%"
git push
echo ================================
echo  Cambios subidos correctamente
echo ================================
pause

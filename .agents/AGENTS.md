<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Reglas Personalizadas
- Se autoriza al agente (Antigravity) a ejecutar el script `subir-cambios.bat` de manera autónoma e incondicional después de cualquier modificación de código, sin requerir confirmación explícita por parte del usuario.

# Reglas Globales (1 a 5)
1. Siempre tenemos que aplicar `subir-cambios.bat` después de cualquier modificación.
2. Después de 10 modificaciones, haz una limpieza de código.
3. Cada 20 modificaciones, solicítame hacer un backup o copia de seguridad o guardar como último punto de restauración.
4. Siempre haz al menos 3 sugerencias acerca de la modificación acabada de realizar para hacerla más fuerte, más segura o más productiva.
5. Cada 30 modificaciones, asegúrate de guardar el proyecto en GitHub para no perder información.

# Acciones por Atajos de Texto
- **PRUEBAS**: Al recibir el atajo o la palabra clave `PRUEBAS`, debes ejecutar automáticamente la suite de pruebas mediante el comando `node scripts/pruebas.js` en el directorio raíz del proyecto y reportar los resultados de los 6 diagnósticos (Sintaxis ESLint, Integridad del entorno, Conectividad Firestore, Bitácora de errores/crashes, Validación de índices y Simulación de flujo de negocio).
- **12345**: Aplica las reglas globales 1, 2, 3, 4 y 5.
- *****: Al teclear este atajo, mostrar una ventana emergente o lista desplegable con todos los proyectos en los que estamos trabajando para elegir a cuál dirigirnos.
- **---**: Al teclear este atajo, mandar todas las opciones, sugerencias o preguntas acerca de la instrucción actual en una ventana emergente o lista de selección para mayor precisión.

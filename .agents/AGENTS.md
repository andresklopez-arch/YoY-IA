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
- **PRUEBAS**: Al recibir el atajo o la palabra clave `PRUEBAS`, debes ejecutar automáticamente la suite de pruebas mediante el comando `node scripts/pruebas.js` en el directorio raíz del proyecto y reportar los resultados de los 8 diagnósticos (Sintaxis ESLint, Integridad del entorno, Conectividad Firestore, Bitácora de errores/crashes, Validación de índices, Simulación de flujo de negocio, Integración de endpoints de API y Consistencia de datos de operación).
- **12345**: Aplica las reglas globales 1, 2, 3, 4 y 5.
- *****: Al teclear este atajo, mostrar una ventana emergente o lista desplegable con todos los proyectos en los que estamos trabajando para elegir a cuál dirigirnos.
- **---**: Al teclear este atajo, mandar todas las opciones, sugerencias o preguntas acerca de la instrucción actual en una ventana emergente o lista de selección para mayor precisión.

# Guías de Arquitectura SaaS y Aislamiento de Clones (150 Reglas)

Para garantizar la independencia absoluta y el aprovisionamiento inmediato de salones clonados mediante ALR SaaS, el desarrollo en este repositorio debe ajustarse estrictamente a las siguientes pautas organizadas por categoría:

## 1. Aprovisionamiento Automático e Inmediato
- Toda nueva sucursal dada de alta en la colección `salones` debe inicializarse con un identificador unívoco y limpio.
- El sistema de licenciamiento (`licencias_saas`) generará automáticamente un registro con vigencia de 365 días a partir del primer inicio de sesión del salón.
- Los inventarios, tarifas de juego y tipos de asistencia de nómina iniciales deben inyectarse mediante plantillas base limpias y libres de IDs anteriores.
- Todos los códigos QR de comandas en mesas se resolverán dinámicamente utilizando el hostname o subdominio mapeado del inquilino, sin requerir re-configuración.

## 2. Aislamiento y Reglas de Seguridad en Base de Datos (Firestore)
- Todos los documentos sin excepción deben almacenar e indexar el campo `salonId`.
- Las consultas en Firestore deben forzar el filtrado por `salonId` (`where("salonId", "==", activeSalon)`).
- La colección `config/` debe estar aislada mediante sufijos de nombre de documento (ej. `config/mesas_estado_${salonId}`).
- Las reglas de seguridad de Firestore (`firestore.rules`) rechazarán cualquier intento de lectura o escritura en vivo que no corresponda al `salonId` del token del usuario (`request.auth.token.salonId`).
- Todos los logs de auditoría de transacciones deben persistirse en colecciones segmentadas por cliente.

## 3. Control de Licencias y Auditoría SaaS
- La aplicación verificará en cada inicio de sesión y de forma pasiva en background la vigencia de la licencia del salón.
- En caso de bloqueo por expiración o suspensión, la interfaz inhabilitará todas las funciones operativas y financieras, dejando activa únicamente la pantalla de contacto técnico.
- Se implementará un mecanismo local cifrado contra manipulaciones del reloj del sistema operativo para evitar la evasión del bloqueo offline.
- Los logs pendientes de sincronización local (offline) se transmitirán automáticamente en background tan pronto como se recupere la conexión a internet.

## 4. Aislamiento de Sesiones y Almacenamiento Local (Caching)
- Los valores guardados en LocalStorage, SessionStorage y IndexedDB deben estar encapsulados e indexados usando el prefijo `${salonId}_`.
- Al realizar el cierre de sesión (logout), solo deben limpiarse las variables locales del salón activo, dejando intactos los datos de otras sucursales abiertas en pestañas paralelas.
- No se deben almacenar credenciales, botTokens o API keys sensibles en el almacenamiento local del cliente; estos recursos se mantendrán y verificarán siempre a nivel del backend.

## 5. Infraestructura de Marca Blanca y Despliegue
- La aplicación resolverá de manera dinámica el logotipo, colores e icono de PWA según el subdominio o mapeo de dominios de marca blanca del embajador vendedor.
- Los recursos estáticos del embajador (como logos) permanecerán fijos en compilación e inalterables por el cliente final para proteger la identidad corporativa.
- Las compilaciones en Vercel deben optimizarse para soportar subdominios comodín (`*.yoybillar.mx`) sin requerir re-despliegues manuales al crear nuevas sucursales.
- Cada commit y despliegue debe ser validado con la suite de pruebas sintácticas (`validate-jsx.js`) y diagnósticos (`pruebas.js`) para evitar incidencias en vivo.

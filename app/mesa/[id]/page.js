'use client';
import { useState, useEffect, useCallback, use } from 'react';
import {
  collection, addDoc, onSnapshot, query,
  where, orderBy, serverTimestamp, doc, updateDoc, setDoc, getDoc
} from 'firebase/firestore';
import { db, auth } from '@/lib/firebase';
import { signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import '@/styles/mesa-cliente.css';
import { obfuscateStatic, deobfuscateStatic } from '@/lib/crypto';

// ── Emoji por categoría de producto ───────────────────────
const CAT_EMOJI = {
  Cerveza: '🍺', Refresco: '🥤', Snack: '🍟',
  Comida: '🍗', Bebida: '☕', Bar: '🍸', default: '🛒',
};

// ── Decodificador del cifrado de BarPanel (XOR + Base64) ──
function decodeBarStock(raw) {
  if (!raw) return [];
  try {
    if (raw.startsWith('[')) {
      const cb1 = raw.indexOf(']');
      if (cb1 > 0) {
        const dateStr = raw.substring(1, cb1);
        const rest = raw.substring(cb1 + 1);
        const cb2 = rest.startsWith('[') ? rest.indexOf(']') : -1;
        const encPart = cb2 > 0 ? rest.substring(cb2 + 1) : rest;
        const xor = decodeURIComponent(escape(atob(encPart)));
        const base64 = xor.split('').map((c, i) =>
          String.fromCharCode(c.charCodeAt(0) ^ dateStr.charCodeAt(i % dateStr.length))
        ).join('');
        return JSON.parse(decodeURIComponent(escape(atob(base64))));
      }
    }
    return JSON.parse(decodeURIComponent(escape(atob(raw))));
  } catch { return []; }
}

// ── TIPOS DE ASISTENCIA POR DEFECTO ───────────────────────
const DEFAULT_ASISTENCIAS = [
  { id: 'mesero',       label: 'Llamar Mesero',        icon: '🙋', color: '#cd7f32' },
  { id: 'limpiar_mesa',  label: 'Limpiar mesa',         icon: '🧹', color: '#22c55e' },
  { id: 'cerrar_tiempo', label: 'Cerrar tiempo',        icon: '⏱️', color: '#f59e0b' },
  { id: 'tiempo_nuevo',  label: 'Tiempo y tiempo nuevo',icon: '🔄', color: '#3b82f6' },
  { id: 'orientacion',   label: 'Orientación',          icon: '❓', color: '#a78bfa' },
  { id: 'urgente',       label: 'Urgente',              icon: '🚨', color: '#ef4444' },
];

// ═══════════════════════════════════════════════════════════
// PÁGINA PÚBLICA DEL CLIENTE (sin autenticación)
// ═══════════════════════════════════════════════════════════
export default function MesaClientePage({ params }) {
  const { id } = use(params);
  const mesaId = parseInt(id);

  const [tab, setTab] = useState('menu');
  const [productos, setProductos] = useState([]);
  const [carrito, setCarrito] = useState({}); // { prodId: cantidad }
  const [tiposAsistencia, setTiposAsistencia] = useState(DEFAULT_ASISTENCIAS);
  const [pedidosMesa, setPedidosMesa] = useState([]);
  const [showCarrito, setShowCarrito] = useState(false);
  const [showAsistConfirm, setShowAsistConfirm] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const [exito, setExito] = useState(null); // 'pedido' | 'asistencia' | 'cuenta'
  const [mesaInfo, setMesaInfo] = useState(null);
  const [loadingMesaInfo, setLoadingMesaInfo] = useState(true);

  // Nombre del cliente (pre-poblado si la mesa tiene cliente asignado)
  const [clienteNombre, setClienteNombre] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('yoy_cliente_nombre') || '';
    }
    return '';
  });
  const [showNombre, setShowNombre] = useState(false);
  const [isOffline, setIsOffline] = useState(false);

  // Estados de Diagnóstico de Red/Conexión
  const [authStatus, setAuthStatus] = useState('cargando'); // 'conectado' | 'error' | 'cargando'
  const [authError, setAuthError] = useState('');
  const [dbConnected, setDbConnected] = useState(false);
  const [showTechDetails, setShowTechDetails] = useState(false);

  // Control de dispositivo único y encuestas
  const [isSecondaryDevice, setIsSecondaryDevice] = useState(false);
  const [showSurvey, setShowSurvey] = useState(false);
  const [ratingAtencion, setRatingAtencion] = useState(5);
  const [ratingRapidez, setRatingRapidez] = useState(5);
  const [ratingLimpieza, setRatingLimpieza] = useState(5);
  const [ratingEquipo, setRatingEquipo] = useState(5);
  const [comentarios, setComentarios] = useState('');
  const [mostrarQuejas, setMostrarQuejas] = useState(false);

  // ── Helper de escritura con Timeout para redes inestables ──
  const addDocWithTimeout = async (collRef, data, timeoutMs = 8000) => {
    const writePromise = addDoc(collRef, data);
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Timeout de red: No se pudo conectar con el servidor de Firebase. Verifica tu conexión de red o los permisos.")), timeoutMs)
    );
    return Promise.race([writePromise, timeoutPromise]);
  };

  // ── Guardar nombre en Firebase ──
  // Actualizar el timestamp de última actividad de la mesa en Firestore
  const actualizarActividadMesa = async () => {
    if (!auth.currentUser || !mesaId) return;
    try {
      const ref = doc(db, 'config', 'mesas_estado');
      const snap = await getDoc(ref);
      if (snap.exists()) {
        const list = snap.data().mesas || [];
        const updatedList = list.map(m => m.id === mesaId
          ? { ...m, clienteLastActive: Date.now() }
          : m
        );
        await setDoc(ref, {
          mesas: updatedList,
          updatedAt: serverTimestamp()
        });
      }
    } catch (err) {
      console.error("Error al actualizar actividad de mesa:", err);
    }
  };

  // Cerrar la sesión de forma manual (liberar la mesa)
  const liberarMesa = async () => {
    const confirmar = window.confirm("¿Deseas cerrar tu sesión de esta mesa? Tu dispositivo ya no podrá realizar pedidos directos hasta que escanees de nuevo.");
    if (!confirmar) return;
    
    setEnviando(true);
    try {
      const ref = doc(db, 'config', 'mesas_estado');
      const snap = await getDoc(ref);
      if (snap.exists()) {
        const list = snap.data().mesas || [];
        const updatedList = list.map(m => m.id === mesaId
          ? { ...m, clienteUid: '', clienteLastActive: 0 }
          : m
        );
        await setDoc(ref, {
          mesas: updatedList,
          updatedAt: serverTimestamp()
        });
        setIsSecondaryDevice(false);
        alert("Sesión cerrada. Mesa liberada con éxito. Ya puedes cerrar el navegador o dejar que otra persona escanee.");
      }
    } catch (err) {
      alert("Error al liberar mesa: " + err.message);
    } finally {
      setEnviando(false);
    }
  };

  // ── Guardar nombre en Firebase ──
  const guardarNombreCliente = async (nombre) => {
    setClienteNombre(nombre);
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem('yoy_cliente_nombre', nombre);
      } catch (e) {}
    }
    await actualizarActividadMesa();
    if (auth.currentUser) {
      try {
        const nombreCifrado = obfuscateStatic(nombre);
        await setDoc(doc(db, 'clientes_anonimos', auth.currentUser.uid), {
          nombre: nombreCifrado,
          updatedAt: serverTimestamp()
        });
      } catch (err) {
        console.error("Error al guardar nombre de cliente en Firestore:", err);
      }
    }
  };

  // ── Monitoreo de conexión a internet en tiempo real ──
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleOnline = () => setIsOffline(false);
    const handleOffline = () => setIsOffline(true);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    setIsOffline(!navigator.onLine);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // ── Sincronizar encuestas guardadas localmente al estar online ──
  useEffect(() => {
    const sincronizarEncuestasPendientes = async () => {
      if (typeof window === 'undefined' || isOffline) return;
      try {
        const rawPending = localStorage.getItem('yoy_pending_surveys');
        if (!rawPending) return;
        const pending = JSON.parse(rawPending);
        if (!Array.isArray(pending) || pending.length === 0) return;

        console.log("Sincronizando encuestas pendientes offline...", pending.length);
        const remaining = [];

        for (const survey of pending) {
          try {
            await addDoc(collection(db, 'encuestas_satisfaccion'), {
              mesaId: survey.mesaId,
              cliente: survey.cliente,
              calificaciones: survey.calificaciones,
              comentarios: survey.comentarios,
              createdAt: serverTimestamp(),
              sincronizadoOffline: true
            });
          } catch (err) {
            console.error("Error sincronizando encuesta offline, se reintentará luego:", err);
            remaining.push(survey);
          }
        }

        if (remaining.length > 0) {
          localStorage.setItem('yoy_pending_surveys', JSON.stringify(remaining));
        } else {
          localStorage.removeItem('yoy_pending_surveys');
        }
      } catch (e) {
        console.warn("Error en sync de encuestas offline:", e);
      }
    };

    sincronizarEncuestasPendientes();
  }, [isOffline]);

  // ── Sincronizar pedidos guardados localmente al estar online ──
  useEffect(() => {
    const sincronizarPedidosPendientes = async () => {
      if (typeof window === 'undefined' || isOffline) return;
      try {
        const rawPending = localStorage.getItem('yoy_pending_orders');
        if (!rawPending) return;
        const pending = JSON.parse(rawPending);
        if (!Array.isArray(pending) || pending.length === 0) return;

        console.log("Sincronizando pedidos pendientes offline...", pending.length);
        const remaining = [];

        for (const order of pending) {
          try {
            await addDoc(collection(db, 'mesa_pedidos'), {
              mesaId: order.mesaId,
              cliente: order.cliente,
              items: order.items,
              total: order.total,
              estado: order.estado,
              tipo: order.tipo,
              etiqueta: order.etiqueta,
              icono: order.icono,
              clienteUid: order.clienteUid || '',
              atendidoAdmin: order.atendidoAdmin,
              atendidoMesero: order.atendidoMesero,
              createdAt: serverTimestamp(),
              sincronizadoOffline: true
            });
          } catch (err) {
            console.error("Error sincronizando comanda offline, se reintentará luego:", err);
            remaining.push(order);
          }
        }

        if (remaining.length > 0) {
          localStorage.setItem('yoy_pending_orders', JSON.stringify(remaining));
        } else {
          localStorage.removeItem('yoy_pending_orders');
        }
      } catch (e) {
        console.warn("Error en sync de comandas offline:", e);
      }
    };

    sincronizarPedidosPendientes();
  }, [isOffline]);

  // ── Sesión anónima para evitar bloqueos de reglas de Firestore ──
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        setAuthStatus('cargando');
        signInAnonymously(auth)
          .then(() => {
            setAuthStatus('conectado');
            console.log("Sesión anónima de cliente iniciada correctamente");
          })
          .catch(err => {
            setAuthStatus('error');
            setAuthError(err.message);
            console.warn("Error al iniciar sesión anónima de cliente:", err);
            try {
              addDoc(collection(db, 'intentos_fallidos_conexion'), {
                mesaId: mesaId || 0,
                error: err.message,
                code: err.code || 'unknown',
                userAgent: typeof window !== 'undefined' ? navigator.userAgent : 'unknown',
                createdAt: serverTimestamp()
              }).catch(() => {});
            } catch (e) {}
          });
      } else {
        setAuthStatus('conectado');
        console.log("Sesión anónima existente detectada:", user.uid);
        // Intentar recuperar el nombre persistido desde Firestore
        try {
          const userSnap = await getDoc(doc(db, 'clientes_anonimos', user.uid));
          if (userSnap.exists()) {
            const data = userSnap.data();
            if (data.nombre) {
              const nombreDescifrado = deobfuscateStatic(data.nombre);
              setClienteNombre(nombreDescifrado);
            }
          }
        } catch (err) {
          console.error("Error al recuperar nombre del cliente:", err);
        }
      }
    });
    return unsubscribe;
  }, []);

  // ── Leer productos del BarPanel en tiempo real con caché offline en localStorage ──
  useEffect(() => {
    // Intentar precargar desde la caché offline local
    try {
      const cached = localStorage.getItem('yoy_client_cached_stock');
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setProductos(parsed.filter(p => p.stock > 0));
        }
      }
    } catch (e) {}

    const unsub = onSnapshot(doc(db, 'config', 'inventario'), snap => {
      setDbConnected(true);
      if (snap.exists()) {
        const prods = snap.data().productos || [];
        const filtered = prods.filter(p => p.stock > 0);
        setProductos(filtered);
        try {
          localStorage.setItem('yoy_client_cached_stock', JSON.stringify(prods));
        } catch (e) {}
      } else {
        // Fallback: productos de demostración
        const fallback = [
          { id: 1, nombre: 'Cerveza Corona Extra', categoria: 'Cerveza', precioVenta: 45, stock: 100 },
          { id: 2, nombre: 'Coca-Cola 355ml', categoria: 'Refresco', precioVenta: 30, stock: 80 },
          { id: 3, nombre: 'Nachos con Queso', categoria: 'Snack', precioVenta: 75, stock: 50 },
          { id: 4, nombre: 'Alitas de Pollo x10', categoria: 'Comida', precioVenta: 120, stock: 35 },
          { id: 5, nombre: 'Agua 600ml', categoria: 'Bebida', precioVenta: 20, stock: 150 },
          { id: 6, nombre: 'Café Americano', categoria: 'Bebida', precioVenta: 35, stock: 100 },
        ];
        setProductos(fallback);
      }
    }, err => {
      setDbConnected(false);
      console.error("Error al cargar inventario en tiempo real para cliente:", err);
    });
    return unsub;
  }, []);

  // ── Leer información de la mesa (cliente asignado) en tiempo real desde Firestore ──
  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'config', 'mesas_estado'), snap => {
      setLoadingMesaInfo(false);
      if (snap.exists()) {
        const list = snap.data().mesas || [];
        const mesa = list.find(m => m.id === mesaId);
        if (mesa) {
          setMesaInfo(mesa);
          if (mesa.cliente && mesa.cliente !== 'Público') {
            setClienteNombre(mesa.cliente);
            try {
              localStorage.setItem('yoy_cliente_nombre', mesa.cliente);
            } catch (e) {}
          }
        } else {
          setMesaInfo(null);
        }
      }
    }, err => {
      setLoadingMesaInfo(false);
      console.error("Error al escuchar información de la mesa en Firestore:", err);
    });
    return unsub;
  }, [mesaId]);

  // ── Reclamar y Bloquear Mesa en tiempo real con inactividad de 15 minutos ──
  useEffect(() => {
    if (authStatus !== 'conectado' || !auth.currentUser || !mesaInfo || mesaInfo.estado !== 'ocupada') return;

    const currentUid = auth.currentUser.uid;
    const lastActive = mesaInfo.clienteLastActive || 0;
    const isExpired = lastActive > 0 && (Date.now() - lastActive > 15 * 60 * 1000);

    if (mesaInfo.clienteUid && mesaInfo.clienteUid !== currentUid && !isExpired) {
      setIsSecondaryDevice(true);
    } else {
      setIsSecondaryDevice(false);
      
      // Si no tiene dueño, o la sesión expiró por inactividad
      if (!mesaInfo.clienteUid || isExpired) {
        const registrarReclamo = async () => {
          try {
            const ref = doc(db, 'config', 'mesas_estado');
            const snap = await getDoc(ref);
            if (snap.exists()) {
              const list = snap.data().mesas || [];
              const mesaObj = list.find(m => m.id === mesaId);
              // Validamos de nuevo si sigue vacío o expirado
              const objLastActive = mesaObj?.clienteLastActive || 0;
              const objExpired = objLastActive > 0 && (Date.now() - objLastActive > 15 * 60 * 1000);
              
              if (mesaObj && (!mesaObj.clienteUid || objExpired)) {
                const updatedList = list.map(m => m.id === mesaId
                  ? { ...m, clienteUid: currentUid, clienteLastActive: Date.now() }
                  : m
                );
                await setDoc(ref, {
                  mesas: updatedList,
                  updatedAt: serverTimestamp()
                });
                console.log(`Mesa ${mesaId} reclamada/renovada por el cliente: ${currentUid}`);
              }
            }
          } catch (err) {
            console.error("Error al reclamar mesa:", err);
          }
        };
        registrarReclamo();
      }
    }
  }, [authStatus, mesaInfo, mesaId]);

  // ── Leer tipos de asistencia personalizados desde Firebase ──
  useEffect(() => {
    const q = query(collection(db, 'tipos_asistencia'));
    const unsub = onSnapshot(q, snap => {
      const tipos = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      if (tipos.length > 0) setTiposAsistencia(tipos);
    });
    return unsub;
  }, []);

  // ── Leer pedidos de esta mesa en tiempo real ────────────
  useEffect(() => {
    const q = query(
      collection(db, 'mesa_pedidos'),
      where('mesaId', '==', mesaId),
      where('estado', 'in', ['pendiente', 'listo', 'en_camino', 'entregado'])
    );
    const unsub = onSnapshot(q, snap => {
      const items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      
      // Filtrar comandas antiguas creadas antes del inicio de la sesión actual de la mesa
      const inicioSesion = mesaInfo?.inicio || 0;
      const estadoMesa = mesaInfo?.estado || '';
      let filteredItems = items;
      
      if (estadoMesa === 'ocupada' && inicioSesion > 0) {
        filteredItems = items.filter(item => {
          const itemTime = item.createdAt?.toDate ? item.createdAt.toDate().getTime() : (item.createdAt || 0);
          return !itemTime || itemTime >= inicioSesion;
        });
      } else if (estadoMesa !== 'ocupada') {
        // Si la mesa no está ocupada, no debería haber comandas activas visibles para el cliente
        filteredItems = [];
      }

      filteredItems.sort((a, b) => {
        const tA = a.createdAt?.toDate ? a.createdAt.toDate().getTime() : (a.createdAt || 0);
        const tB = b.createdAt?.toDate ? b.createdAt.toDate().getTime() : (b.createdAt || 0);
        return tB - tA;
      });
      setPedidosMesa(filteredItems);
    });
    return unsub;
  }, [mesaId, mesaInfo?.inicio, mesaInfo?.estado]);

  // ── Carrito ─────────────────────────────────────────────
  const modificarCarrito = (prodId, delta) => {
    setCarrito(prev => {
      const actual = prev[prodId] || 0;
      const nuevo = Math.max(0, actual + delta);
      if (nuevo === 0) { const { [prodId]: _, ...rest } = prev; return rest; }
      return { ...prev, [prodId]: nuevo };
    });
  };

  const totalCarrito = Object.entries(carrito).reduce((sum, [id, cant]) => {
    const prod = productos.find(p => p.id === parseInt(id));
    return sum + (prod?.precioVenta || 0) * cant;
  }, 0);

  const itemsCarrito = Object.values(carrito).reduce((s, c) => s + c, 0);

  // ── Enviar pedido ───────────────────────────────────────
  const enviarPedido = async () => {
    if (itemsCarrito === 0) return;
    if (isSecondaryDevice) {
      alert('Operación bloqueada: Este dispositivo no es el principal de la mesa.');
      return;
    }
    if (!mesaInfo || mesaInfo.estado !== 'ocupada') {
      alert('Operación denegada: Esta mesa no se encuentra activa en caja. Solicita su apertura.');
      return;
    }
    setEnviando(true);
    const items = Object.entries(carrito).map(([id, cant]) => {
      const prod = productos.find(p => p.id === parseInt(id));
      return { productoId: parseInt(id), nombre: prod?.nombre, precio: prod?.precioVenta, cantidad: cant, subtotal: (prod?.precioVenta || 0) * cant };
    });
    const orderData = {
      mesaId,
      cliente: clienteNombre || `Mesa ${mesaId}`,
      items,
      total: totalCarrito,
      estado: 'pendiente',
      tipo: 'pedido',
      etiqueta: `Pedido de Consumo: ${items.map(i => `${i.cantidad}x ${i.nombre}`).join(', ')}`,
      icono: '🍔',
      clienteUid: auth.currentUser?.uid || '',
      atendidoAdmin: false,
      atendidoMesero: false,
    };
    try {
      await addDocWithTimeout(collection(db, 'mesa_pedidos'), {
        ...orderData,
        createdAt: serverTimestamp(),
      });
      await actualizarActividadMesa();
      setCarrito({});
      setShowCarrito(false);
      setExito('pedido');
      setTimeout(() => setExito(null), 3000);
    } catch (e) {
      console.warn("Error al enviar pedido, guardando en caché offline...", e);
      try {
        const rawPending = localStorage.getItem('yoy_pending_orders') || '[]';
        const pending = JSON.parse(rawPending);
        pending.push({
          ...orderData,
          createdAtOffline: new Date().toISOString()
        });
        localStorage.setItem('yoy_pending_orders', JSON.stringify(pending));
        
        // Simular éxito para el cliente
        setCarrito({});
        setShowCarrito(false);
        setExito('pedido');
        setTimeout(() => setExito(null), 3000);
        alert('⚠️ Pedido guardado localmente debido a una falla de red. Se enviará automáticamente cuando recuperes la conexión.');
      } catch (errLocal) {
        alert('Error al enviar comanda: ' + e.message);
      }
    }
    setEnviando(false);
  };

  // ── Solicitar asistencia ────────────────────────────────
  const solicitarAsistencia = async (tipo) => {
    if (isSecondaryDevice) {
      alert('Operación bloqueada: Este dispositivo no es el principal de la mesa.');
      return;
    }
    if (!mesaInfo || mesaInfo.estado !== 'ocupada') {
      alert('Operación denegada: Esta mesa no se encuentra activa en caja. Solicita su apertura.');
      return;
    }
    setEnviando(true);
    try {
      await addDocWithTimeout(collection(db, 'mesa_pedidos'), {
        mesaId,
        cliente: clienteNombre || `Mesa ${mesaId}`,
        tipo: 'asistencia',
        tipoAsistencia: tipo.id || tipo,
        etiqueta: tipo.label || tipo,
        icono: tipo.icon || '🙋',
        estado: 'pendiente',
        clienteUid: auth.currentUser?.uid || '',
        atendidoAdmin: false,
        atendidoMesero: false,
        createdAt: serverTimestamp(),
      });
      await actualizarActividadMesa();
      setShowAsistConfirm(null);
      setExito('asistencia');
      setTimeout(() => setExito(null), 3000);
    } catch (e) { alert('Error: ' + e.message); }
    setEnviando(false);
  };

  // ── Solicitar la cuenta ─────────────────────────────────
  const solicitarCuentaClick = () => {
    if (isSecondaryDevice) {
      alert('Operación bloqueada: Este dispositivo no es el principal de la mesa.');
      return;
    }
    if (!mesaInfo || mesaInfo.estado !== 'ocupada') {
      alert('Operación denegada: Esta mesa no se encuentra activa en caja. Solicita su apertura.');
      return;
    }
    setRatingAtencion(5);
    setRatingRapidez(5);
    setRatingLimpieza(5);
    setRatingEquipo(5);
    setComentarios('');
    setMostrarQuejas(false);
    setShowSurvey(true);
  };

  const enviarEncuestaYSolicitarCuenta = async () => {
    setEnviando(true);
    const surveyData = {
      mesaId,
      cliente: clienteNombre || `Mesa ${mesaId}`,
      calificaciones: {
        atencion: ratingAtencion,
        rapidez: ratingRapidez,
        limpieza: ratingLimpieza,
        equipo: ratingEquipo
      },
      comentarios: comentarios.trim()
    };

    try {
      // 1. Guardar encuesta de satisfacción
      await addDocWithTimeout(collection(db, 'encuestas_satisfaccion'), {
        ...surveyData,
        createdAt: serverTimestamp(),
      });
    } catch (err) {
      console.warn("Error al enviar encuesta de satisfacción, guardando en caché offline:", err);
      try {
        const rawPending = localStorage.getItem('yoy_pending_surveys') || '[]';
        const pending = JSON.parse(rawPending);
        pending.push({
          ...surveyData,
          createdAtOffline: new Date().toISOString()
        });
        localStorage.setItem('yoy_pending_surveys', JSON.stringify(pending));
      } catch (e) {
        console.error("No se pudo guardar la encuesta offline en localStorage:", e);
      }
    }

    try {
      // 2. Enviar alerta de cuenta
      await addDocWithTimeout(collection(db, 'mesa_pedidos'), {
        mesaId,
        cliente: clienteNombre || `Mesa ${mesaId}`,
        tipo: 'cuenta',
        etiqueta: 'Solicitud de Cuenta',
        icono: '💳',
        estado: 'pendiente',
        atendidoAdmin: false,
        atendidoMesero: false,
        totalAcumulado,
        createdAt: serverTimestamp(),
      });

      setShowSurvey(false);
      setExito('cuenta');
      setTimeout(() => setExito(null), 4000);
    } catch (e) {
      alert('Error al enviar la solicitud de cuenta: ' + e.message);
    }
    setEnviando(false);
  };

  // ── Calcular total acumulado ─────────────────────────────
  const totalAcumulado = pedidosMesa
    .filter(p => p.tipo === 'pedido')
    .reduce((s, p) => s + (p.total || 0), 0);

  const pendientesEntrega = pedidosMesa.filter(p => p.tipo === 'pedido' && p.estado === 'pendiente').length;

  // ── TABS ────────────────────────────────────────────────
  const TABS = [
    { id: 'menu',       label: 'Menú',       icon: 'ri-restaurant-line' },
    { id: 'asistencia', label: 'Asistencia', icon: 'ri-customer-service-2-line' },
    { id: 'cuenta',     label: 'Mi Cuenta',  icon: 'ri-receipt-line',    badge: pendientesEntrega },
    { id: 'pagar',      label: 'Pagar',      icon: 'ri-secure-payment-line' },
  ];

  if (loadingMesaInfo) {
    return (
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100dvh',
        background: 'var(--cl-bg, #0b0f19)',
        color: '#fff',
        fontFamily: "'Inter', sans-serif"
      }}>
        <div style={{ fontSize: 32, marginBottom: 16, animation: 'spin 1.8s linear infinite' }}>🔄</div>
        <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)' }}>Verificando estado de la mesa...</div>
      </div>
    );
  }

  if (mesaInfo && mesaInfo.estado !== 'ocupada') {
    return (
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100dvh',
        padding: 24,
        textAlign: 'center',
        background: 'var(--cl-bg, #0b0f19)',
        color: '#fff',
        fontFamily: "'Inter', sans-serif"
      }}>
        <style>{`@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800;900&display=swap');`}</style>
        <div style={{ fontSize: 64, marginBottom: 20 }}>🔒</div>
        <h2 style={{ fontSize: 22, fontWeight: 900, marginBottom: 12, color: 'var(--cl-bronze-light, #cd7f32)' }}>Mesa Inactiva</h2>
        <p style={{ color: 'rgba(255,255,255,0.6)', maxWidth: 340, fontSize: 14, lineHeight: 1.6, marginBottom: 24 }}>
          Esta mesa no se encuentra activa en el sistema de la caja. Por favor, solicita la apertura de la <strong>Mesa {mesaId}</strong> con el personal del establecimiento para poder realizar pedidos y solicitar asistencia.
        </p>
        <div style={{
          padding: '12px 20px',
          background: 'rgba(205,127,50,0.1)',
          border: '1px solid rgba(205,127,50,0.25)',
          borderRadius: 12,
          fontSize: 12,
          color: 'var(--cl-bronze-light, #cd7f32)',
          fontWeight: 600
        }}>
          YoY IA Billar · Sistema de Gestión
        </div>
      </div>
    );
  }

  if (isNaN(mesaId)) {
    return (
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100dvh',
        padding: 20,
        textAlign: 'center',
        background: 'var(--cl-bg)',
        color: 'var(--cl-text)',
        fontFamily: "'Inter', sans-serif"
      }}>
        <style>{`@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800;900&display=swap');`}</style>
        <div style={{ fontSize: 64, marginBottom: 20 }}>⚠️</div>
        <h2 style={{ fontSize: 20, fontWeight: 800, marginBottom: 10, color: 'var(--cl-bronze-light)' }}>Mesa no identificada</h2>
        <p style={{ color: 'var(--cl-muted)', maxWidth: 320, fontSize: 14, lineHeight: 1.6 }}>
          No hemos podido detectar el número de mesa en el enlace. Por favor, escanea nuevamente el código QR ubicado en tu mesa física.
        </p>
      </div>
    );
  }

  return (
    <>
      {/* LINK a Google Fonts Inter */}
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800;900&display=swap');`}</style>

      {/* HEADER */}
      <header className="mc-header">
        <div className="mc-header-logo">
          <div className="mc-header-logo-icon">🎱</div>
          <div>
            <div className="mc-header-title">YoY IA BILLAR <span style={{ fontSize: 9, color: 'var(--cl-bronze-light)', fontWeight: 800, display: 'block', marginTop: 1 }}>By Alfonso Iturbide</span></div>
            <div className="mc-header-sub" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <div style={{ display: 'flex', alignItems: 'center' }}>
                <span className="mc-live-dot" style={{ marginRight: 4 }} />
                {mesaInfo?.estado === 'ocupada' ? `${mesaInfo.cliente || 'Cliente'}` : 'Bienvenido'}
              </div>
              <div className="mc-diag-pills">
                <span className={`mc-diag-pill ${isOffline ? 'offline' : 'online'}`}>
                  📶 {isOffline ? 'Offline' : 'Red OK'}
                </span>
                <span className={`mc-diag-pill ${authStatus === 'conectado' ? 'auth-ok' : authStatus === 'error' ? 'auth-err' : 'auth-loading'}`}>
                  🔑 {authStatus === 'conectado' ? 'Auth OK' : authStatus === 'error' ? 'Auth Err' : 'Auth...'}
                </span>
                <span className={`mc-diag-pill ${dbConnected ? 'db-ok' : 'db-offline'}`}>
                  📦 {dbConnected ? 'DB OK' : 'DB Offline'}
                </span>
              </div>
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {!isSecondaryDevice && mesaInfo?.clienteUid === auth.currentUser?.uid && (
            <button 
              onClick={liberarMesa} 
              title="Liberar Mesa" 
              style={{
                background: 'rgba(239, 68, 68, 0.15)',
                border: '1px solid rgba(239, 68, 68, 0.3)',
                color: '#ef4444',
                padding: '6px 10px',
                borderRadius: 8,
                fontSize: 11,
                fontWeight: 700,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 4
              }}
            >
              <i className="ri-logout-box-line" /> Liberar
            </button>
          )}
          <div className="mc-mesa-badge">Mesa {mesaId}</div>
        </div>
      </header>

      {/* TABS */}
      <nav className="mc-tabs">
        {TABS.map(t => (
          <button key={t.id} className={`mc-tab${tab === t.id ? ' active' : ''}`} onClick={() => setTab(t.id)}>
            <i className={t.icon} />
            {t.label}
            {t.badge > 0 && <span className="mc-tab-badge">{t.badge}</span>}
          </button>
        ))}
      </nav>

      {/* CUERPO */}
      <main className="mc-body">
        {isSecondaryDevice && (
          <div style={{
            background: 'rgba(245, 158, 11, 0.12)',
            border: '1px solid rgba(245, 158, 11, 0.3)',
            color: '#f59e0b',
            padding: '12px 16px',
            borderRadius: 14,
            marginBottom: 16,
            fontSize: 12,
            lineHeight: 1.5,
            display: 'flex',
            alignItems: 'center',
            gap: 10
          }}>
            <span style={{ fontSize: 20 }}>🔒</span>
            <div>
              <div style={{ fontWeight: 800, fontSize: 13, marginBottom: 2 }}>Mesa vinculada a otro dispositivo</div>
              <p style={{ margin: 0, color: 'rgba(255,255,255,0.7)' }}>Solo se permite que un dispositivo realice pedidos o solicite asistencia para evitar fraudes y duplicados.</p>
            </div>
          </div>
        )}

        {authStatus === 'error' && (
          <div style={{
            background: 'rgba(239, 68, 68, 0.15)',
            border: '1px solid rgba(239, 68, 68, 0.4)',
            color: '#ef4444',
            padding: '12px 16px',
            borderRadius: 14,
            marginBottom: 16,
            fontSize: 12,
            lineHeight: 1.5
          }}>
            <div style={{ fontWeight: 800, fontSize: 13, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
              🚨 Error de Conexión Firebase
            </div>
            <p style={{ marginBottom: 6 }}>No se pudo establecer una sesión segura con el servidor. Revisa tu conexión o escanea el QR de nuevo.</p>
            <button
              onClick={() => setShowTechDetails(prev => !prev)}
              style={{
                background: 'rgba(239, 68, 68, 0.2)',
                border: '1px solid rgba(239, 68, 68, 0.3)',
                color: '#ef4444',
                padding: '4px 8px',
                borderRadius: 6,
                fontSize: 10,
                fontWeight: 700,
                cursor: 'pointer',
                marginBottom: showTechDetails ? 8 : 0,
                outline: 'none'
              }}
            >
              {showTechDetails ? 'Ocultar detalles técnicos ▲' : 'Ver detalles técnicos ▼'}
            </button>
            {showTechDetails && (
              <code style={{ display: 'block', background: 'rgba(0,0,0,0.3)', padding: 8, borderRadius: 8, fontSize: 10, fontFamily: 'monospace', overflowX: 'auto', whiteSpace: 'pre-wrap' }}>
                {authError || 'Error de permisos o inicio anónimo deshabilitado (auth/operation-not-allowed). Por favor habilita el proveedor Anónimo en la Consola Firebase.'}
                {`\n\nClave de API en uso: ${auth.app?.options?.apiKey || 'No detectada'}`}
              </code>
            )}
          </div>
        )}

        {isOffline && (
          <div style={{
            background: 'rgba(239, 68, 68, 0.95)',
            color: '#fff',
            padding: '12px 16px',
            textAlign: 'center',
            fontSize: 12,
            fontWeight: 700,
            borderRadius: 14,
            marginBottom: 16,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            boxShadow: '0 4px 12px rgba(239,68,68,0.25)',
            animation: 'pulseBg 2s infinite'
          }}>
            <i className="ri-wifi-off-line" style={{ fontSize: 16 }} />
            Sin conexión a internet. Los pedidos y llamadas de asistencia están pausados.
          </div>
        )}

        {/* ── ÉXITO TOAST ─────────────────────────────────── */}
        {exito && (
          <div style={{ background: exito === 'cuenta' ? 'rgba(59,130,246,0.1)' : 'rgba(34,197,94,0.1)', border: `1px solid ${exito === 'cuenta' ? 'rgba(59,130,246,0.4)' : 'rgba(34,197,94,0.4)'}`, borderRadius: 14, padding: 16, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 12, animation: 'slideUp 0.3s ease' }}>
            <span style={{ fontSize: 28 }}>{exito === 'pedido' ? '✅' : exito === 'asistencia' ? '🔔' : '💳'}</span>
            <div>
              <div style={{ fontSize: 14, fontWeight: 800 }}>
                {exito === 'pedido' ? '¡Pedido enviado!' : exito === 'asistencia' ? '¡Asistencia solicitada!' : '¡Cuenta solicitada!'}
              </div>
              <div style={{ fontSize: 12, color: 'var(--cl-muted)', marginTop: 2 }}>
                {exito === 'pedido' ? 'Tu mesero está en camino.' : exito === 'asistencia' ? 'El personal fue notificado.' : 'El mesero traerá tu cuenta.'}
              </div>
            </div>
          </div>
        )}

        {/* ════════════════════════ TAB: MENÚ ════════════════════════ */}
        {tab === 'menu' && (
          <>
            {/* Nombre del cliente */}
            <div style={{ background: 'var(--cl-card)', border: '1px solid var(--cl-border)', borderRadius: 14, padding: '12px 16px', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
              <i className="ri-user-line" style={{ color: 'var(--cl-bronze-light)', fontSize: 18 }} />
              {clienteNombre ? (
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 11, color: 'var(--cl-muted)' }}>Hola,</div>
                  <div style={{ fontSize: 14, fontWeight: 700 }}>{clienteNombre}</div>
                </div>
              ) : (
                <button onClick={() => setShowNombre(true)} style={{ flex: 1, background: 'none', border: 'none', color: 'var(--cl-muted)', fontSize: 13, textAlign: 'left', cursor: 'pointer' }}>
                  ¿Cómo te llamas? (opcional)
                </button>
              )}
            </div>

            {/* Resumen de consumo */}
            {totalAcumulado > 0 && (
              <div style={{
                background: 'linear-gradient(135deg, rgba(205,127,50,0.15), rgba(15,13,12,0.95))',
                border: '1px solid var(--cl-border-bronze)',
                borderRadius: 16,
                padding: '14px 18px',
                marginBottom: 16,
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                boxShadow: '0 8px 24px rgba(205,127,50,0.1)'
              }}>
                <div style={{ textAlign: 'left' }}>
                  <div style={{ fontSize: 10, color: 'rgba(255, 255, 255, 0.4)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Llevas consumido:</div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#fff', marginTop: 2 }}>
                    {pedidosMesa.filter(p => p.tipo === 'pedido').reduce((sum, p) => sum + (p.items || []).reduce((s, i) => s + i.cantidad, 0), 0)} productos
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 10, color: 'rgba(255, 255, 255, 0.4)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Monto total:</div>
                  <div style={{ fontSize: 18, fontWeight: 900, color: 'var(--cl-bronze-light)', marginTop: 2 }}>
                    ${totalAcumulado} <span style={{ fontSize: 10, fontWeight: 500, color: 'rgba(255, 255, 255, 0.4)' }}>MXN</span>
                  </div>
                </div>
              </div>
            )}

            {/* Status Tracking Bar/Card (Sugerencia 1) */}
            {(() => {
              const pedidoListo = pedidosMesa.find(p => p.estado === 'listo');
              const pedidoEnCamino = pedidosMesa.find(p => p.estado === 'en_camino');
              if (!pedidoListo && !pedidoEnCamino) return null;
              
              const isListo = !!pedidoListo;
              const emoji = isListo ? '🍳' : '🚚';
              const titulo = isListo ? '¡Tu pedido está listo!' : '¡Pedido en camino!';
              const desc = isListo ? 'El mesero está recogiéndolo en la cocina.' : 'El mesero está llevándolo a tu mesa.';
              const color = isListo ? '#a78bfa' : '#f59e0b';
              const bg = isListo ? 'rgba(167,139,250,0.1)' : 'rgba(245,158,11,0.1)';
              const border = isListo ? 'rgba(167,139,250,0.25)' : 'rgba(245,158,11,0.25)';
              
              return (
                <div style={{
                  background: bg,
                  border: `1px solid ${border}`,
                  borderRadius: 16,
                  padding: '14px 18px',
                  marginBottom: 16,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 14,
                  animation: 'pulse 2s infinite ease-in-out'
                }}>
                  <div style={{
                    fontSize: 26,
                    background: 'rgba(255,255,255,0.05)',
                    borderRadius: 12,
                    width: 44,
                    height: 44,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    border: `1px solid ${border}`
                  }}>
                    {emoji}
                  </div>
                  <div style={{ flex: 1, textAlign: 'left' }}>
                    <div style={{ fontSize: 13, fontWeight: 800, color: '#fff' }}>{titulo}</div>
                    <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)', marginTop: 2 }}>{desc}</div>
                    {/* Barra de progreso */}
                    <div style={{ background: 'rgba(255,255,255,0.1)', height: 4, borderRadius: 2, marginTop: 8, overflow: 'hidden' }}>
                      <div style={{
                        background: color,
                        height: '100%',
                        width: isListo ? '75%' : '90%',
                        borderRadius: 2
                      }} />
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* Grilla de productos */}
            <div className="mc-menu-grid">
              {productos.map(prod => {
                const emoji = CAT_EMOJI[prod.categoria] || CAT_EMOJI.default;
                const cant = carrito[prod.id] || 0;
                return (
                  <div key={prod.id} className={`mc-producto-card${prod.stock <= 0 ? ' agotado' : ''}`}>
                    <span className="mc-badge-cat">{prod.categoria}</span>
                    <div className="mc-producto-emoji">{emoji}</div>
                    <div className="mc-producto-nombre">{prod.nombre}</div>
                    <div className="mc-producto-precio">${prod.precioVenta}</div>
                    <div className="mc-producto-controls">
                      <button className="mc-qty-btn" onClick={() => !isSecondaryDevice && modificarCarrito(prod.id, -1)} disabled={isSecondaryDevice} style={{ opacity: isSecondaryDevice ? 0.4 : 1, cursor: isSecondaryDevice ? 'not-allowed' : 'pointer' }}>−</button>
                      <span className="mc-qty-val">{cant}</span>
                      <button className="mc-qty-btn" onClick={() => !isSecondaryDevice && modificarCarrito(prod.id, 1)} disabled={isSecondaryDevice} style={{ opacity: isSecondaryDevice ? 0.4 : 1, cursor: isSecondaryDevice ? 'not-allowed' : 'pointer' }}>+</button>
                    </div>
                  </div>
                );
              })}
            </div>

            {productos.length === 0 && (
              <div className="mc-empty">
                <i className="ri-restaurant-line" />
                <p>El menú se carga en un momento...</p>
              </div>
            )}
          </>
        )}

        {/* ════════════════════════ TAB: ASISTENCIA ════════════════════════ */}
        {tab === 'asistencia' && (
          <>
            <p style={{ fontSize: 13, color: 'var(--cl-muted)', marginBottom: 20, lineHeight: 1.6 }}>
              Toca el tipo de ayuda que necesitas. El personal será notificado de inmediato.
            </p>
            <div className="mc-asist-grid">
              {tiposAsistencia.map(tipo => (
                <button
                  key={tipo.id || tipo.label}
                  className="mc-asist-btn"
                  onClick={() => !isSecondaryDevice && setShowAsistConfirm(tipo)}
                  disabled={isSecondaryDevice}
                  style={{ borderColor: `${tipo.color}40`, opacity: isSecondaryDevice ? 0.4 : 1, cursor: isSecondaryDevice ? 'not-allowed' : 'pointer' }}
                >
                  <div className="mc-asist-icon">{tipo.icon}</div>
                  <div className="mc-asist-label" style={{ color: tipo.color }}>{tipo.label}</div>
                </button>
              ))}
            </div>
          </>
        )}

        {/* ════════════════════════ TAB: MI CUENTA ════════════════════════ */}
        {tab === 'cuenta' && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
              <span className="mc-live-dot" />
              <span style={{ fontSize: 12, color: 'var(--cl-muted)' }}>Actualizando en tiempo real</span>
            </div>

            {pedidosMesa.filter(p => p.tipo === 'pedido').length === 0 ? (
              <div className="mc-empty">
                <i className="ri-receipt-line" />
                <p>Aún no tienes pedidos. ¡Ordena algo del menú!</p>
              </div>
            ) : (
              <>
                {pedidosMesa.filter(p => p.tipo === 'pedido').map(pedido => (
                  <div key={pedido.id} style={{ background: 'var(--cl-card)', border: '1px solid var(--cl-border)', borderRadius: 14, padding: '14px 16px', marginBottom: 10 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                      <span style={{ fontSize: 11, color: 'var(--cl-muted)' }}>
                        {pedido.createdAt?.toDate ? pedido.createdAt.toDate().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }) : '—'}
                      </span>
                      <span style={{
                        fontSize: 10, fontWeight: 800, padding: '2px 8px', borderRadius: 999,
                        background: pedido.estado === 'entregado' ? 'rgba(34,197,94,0.15)' : 
                                    pedido.estado === 'listo' ? 'rgba(167,139,250,0.15)' : 
                                    pedido.estado === 'en_camino' ? 'rgba(245,158,11,0.15)' : 'rgba(59,130,246,0.15)',
                        color: pedido.estado === 'entregado' ? '#22c55e' : 
                               pedido.estado === 'listo' ? '#a78bfa' : 
                               pedido.estado === 'en_camino' ? '#f59e0b' : '#3b82f6',
                      }}>
                        {pedido.estado === 'entregado' ? '✅ Entregado' : 
                         pedido.estado === 'listo' ? '🍳 Preparado' : 
                         pedido.estado === 'en_camino' ? '🚀 En camino' : '⏳ Pendiente'}
                      </span>
                    </div>
                    {pedido.items?.map((item, i) => (
                      <div key={i} className="mc-cuenta-item" style={{ paddingTop: i === 0 ? 0 : 8 }}>
                        <span style={{ fontSize: 13 }}>{item.cantidad}× {item.nombre}</span>
                        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--cl-bronze-light)' }}>${item.subtotal}</span>
                      </div>
                    ))}
                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--cl-border)' }}>
                      <span style={{ fontSize: 14, fontWeight: 800, color: 'var(--cl-bronze-light)' }}>Total: ${pedido.total}</span>
                    </div>
                  </div>
                ))}

                <div className="mc-total-box">
                  <div style={{ fontSize: 11, color: 'var(--cl-bronze-light)', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 700, marginBottom: 6 }}>Total Acumulado</div>
                  <div style={{ fontSize: 36, fontWeight: 900, color: 'var(--cl-bronze-light)', fontVariantNumeric: 'tabular-nums' }}>${totalAcumulado}</div>
                  <div style={{ fontSize: 11, color: 'var(--cl-muted)', marginTop: 4 }}>MXN · Mesa {mesaId}</div>
                </div>

                {!isSecondaryDevice && mesaInfo?.clienteUid === auth.currentUser?.uid && (
                  <button
                    onClick={liberarMesa}
                    style={{
                      width: '100%',
                      marginTop: 16,
                      background: 'rgba(239, 68, 68, 0.1)',
                      border: '1px solid rgba(239, 68, 68, 0.3)',
                      color: '#ef4444',
                      padding: '12px',
                      borderRadius: 14,
                      fontSize: 13,
                      fontWeight: 700,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 6
                    }}
                  >
                    <i className="ri-logout-box-line" /> Cerrar Sesión de esta Mesa
                  </button>
                )}
              </>
            )}
          </>
        )}

        {/* ════════════════════════ TAB: PAGAR ════════════════════════ */}
        {tab === 'pagar' && (
          <>
            <div style={{ textAlign: 'center', padding: '32px 0 24px' }}>
              <div style={{ fontSize: 64, marginBottom: 16 }}>💳</div>
              <div style={{ fontSize: 20, fontWeight: 800, marginBottom: 8 }}>Solicitar la Cuenta</div>
              <div style={{ fontSize: 14, color: 'var(--cl-muted)', lineHeight: 1.6, marginBottom: 24 }}>
                El mesero traerá tu cuenta impresa. El pago se realiza en caja.
              </div>
              {totalAcumulado > 0 && (
                <div className="mc-total-box" style={{ marginBottom: 24 }}>
                  <div style={{ fontSize: 11, color: 'var(--cl-muted)', marginBottom: 4 }}>Total estimado</div>
                  <div style={{ fontSize: 32, fontWeight: 900, color: 'var(--cl-bronze-light)' }}>${totalAcumulado}</div>
                </div>
              )}
            </div>
            <button
              className="mc-btn-primary"
              onClick={solicitarCuentaClick}
              disabled={enviando || isSecondaryDevice}
              style={{ opacity: isSecondaryDevice ? 0.5 : 1, cursor: isSecondaryDevice ? 'not-allowed' : 'pointer' }}
            >
              {enviando ? <><i className="ri-loader-4-line" /> Enviando...</> : <><i className="ri-secure-payment-line" /> Solicitar mi Cuenta</>}
            </button>
            <button className="mc-btn-secondary" onClick={() => setTab('cuenta')}>
              Ver mi consumo detallado
            </button>
          </>
        )}
      </main>

      {/* ── FAB CARRITO ─────────────────────────────────── */}
      {itemsCarrito > 0 && tab === 'menu' && (
        <button className="mc-carrito-fab" onClick={() => setShowCarrito(true)}>
          <i className="ri-shopping-cart-2-line" />
          {itemsCarrito} {itemsCarrito === 1 ? 'ítem' : 'ítems'} · ${totalCarrito}
        </button>
      )}

      {/* ── SHEET: CONFIRMAR PEDIDO ─────────────────────── */}
      {showCarrito && (
        <div className="mc-overlay" onClick={e => e.target.classList.contains('mc-overlay') && setShowCarrito(false)}>
          <div className="mc-sheet">
            <div className="mc-sheet-handle" />
            <div style={{ fontWeight: 800, fontSize: 17, marginBottom: 20 }}>🛒 Tu pedido</div>
            {Object.entries(carrito).map(([id, cant]) => {
              const prod = productos.find(p => p.id === parseInt(id));
              if (!prod) return null;
              return (
                <div key={id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: 12, marginBottom: 12, borderBottom: '1px solid var(--cl-border)' }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 700 }}>{cant}× {prod.nombre}</div>
                    <div style={{ fontSize: 12, color: 'var(--cl-muted)' }}>${prod.precioVenta} c/u</div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <button className="mc-qty-btn" onClick={() => modificarCarrito(prod.id, -1)}>−</button>
                    <span className="mc-qty-val">{cant}</span>
                    <button className="mc-qty-btn" onClick={() => modificarCarrito(prod.id, 1)}>+</button>
                  </div>
                </div>
              );
            })}
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 0 20px', fontSize: 16, fontWeight: 800 }}>
              <span>Total</span>
              <span style={{ color: 'var(--cl-bronze-light)' }}>${totalCarrito}</span>
            </div>
            <button className="mc-btn-primary" onClick={enviarPedido} disabled={enviando}>
              {enviando ? <><i className="ri-loader-4-line" /> Enviando...</> : <><i className="ri-send-plane-line" /> Enviar Pedido</>}
            </button>
            <button className="mc-btn-secondary" onClick={() => setShowCarrito(false)}>Seguir ordenando</button>
          </div>
        </div>
      )}

      {/* ── SHEET: CONFIRMAR ASISTENCIA ─────────────────── */}
      {showAsistConfirm && (
        <div className="mc-overlay" onClick={e => e.target.classList.contains('mc-overlay') && setShowAsistConfirm(null)}>
          <div className="mc-sheet">
            <div className="mc-sheet-handle" />
            <div style={{ textAlign: 'center', padding: '8px 0 24px' }}>
              <div style={{ fontSize: 56, marginBottom: 12 }}>{showAsistConfirm.icon}</div>
              <div style={{ fontSize: 20, fontWeight: 800, marginBottom: 6 }}>{showAsistConfirm.label}</div>
              <div style={{ fontSize: 14, color: 'var(--cl-muted)' }}>El personal recibirá una notificación inmediata.</div>
            </div>
            <button className="mc-btn-primary" style={{ background: showAsistConfirm.color || 'var(--cl-bronze)' }} onClick={() => solicitarAsistencia(showAsistConfirm)} disabled={enviando}>
              {enviando ? 'Enviando...' : `Solicitar ${showAsistConfirm.label}`}
            </button>
            <button className="mc-btn-secondary" onClick={() => setShowAsistConfirm(null)}>Cancelar</button>
          </div>
        </div>
      )}

      {/* ── SHEET: INGRESAR NOMBRE ─────────────────────── */}
      {showNombre && (
        <div className="mc-overlay" onClick={e => e.target.classList.contains('mc-overlay') && setShowNombre(false)}>
          <div className="mc-sheet">
            <div className="mc-sheet-handle" />
            <div style={{ fontWeight: 800, fontSize: 17, marginBottom: 16 }}>👋 ¿Cómo te llamas?</div>
            <p style={{ fontSize: 13, color: 'var(--cl-muted)', marginBottom: 20 }}>Opcional — para personalizar tu servicio.</p>
            <input
              type="text"
              placeholder="Tu nombre..."
              value={clienteNombre}
              onChange={e => setClienteNombre(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  guardarNombreCliente(clienteNombre);
                  setShowNombre(false);
                }
              }}
              autoFocus
              style={{ width: '100%', padding: '14px 16px', background: 'var(--cl-surface)', border: '1px solid var(--cl-border-bronze)', borderRadius: 12, color: 'var(--cl-text)', fontSize: 16, marginBottom: 16, outline: 'none' }}
            />
            <button className="mc-btn-primary" onClick={() => {
              guardarNombreCliente(clienteNombre);
              setShowNombre(false);
            }}>Listo ✓</button>
          </div>
        </div>
      )}

      {/* ── MODAL: ENCUESTA DE SATISFACCIÓN ─────────────────── */}
      {showSurvey && (
        <div className="mc-overlay" style={{ zIndex: 1100 }} onClick={e => e.target.classList.contains('mc-overlay') && setShowSurvey(false)}>
          <div className="mc-sheet" style={{ maxHeight: '90vh', overflowY: 'auto' }}>
            <div className="mc-sheet-handle" />
            <div style={{ textAlign: 'center', padding: '8px 0 16px' }}>
              <div style={{ fontSize: 48, marginBottom: 8 }}>⭐</div>
              <div style={{ fontSize: 18, fontWeight: 900, marginBottom: 4 }}>Encuesta de Satisfacción</div>
              <p style={{ fontSize: 12, color: 'var(--cl-muted)', margin: 0 }}>Ayúdanos a mejorar tu experiencia.</p>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginBottom: 20 }}>
              {[
                { label: 'Atención del Personal', value: ratingAtencion, setter: setRatingAtencion },
                { label: 'Rapidez', value: ratingRapidez, setter: setRatingRapidez },
                { label: 'Limpieza', value: ratingLimpieza, setter: setRatingLimpieza },
                { label: 'Calidad del equipo', value: ratingEquipo, setter: setRatingEquipo },
              ].map((item, idx) => (
                <div key={idx} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>{item.label}</div>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    {[1, 2, 3, 4, 5].map(star => (
                      <button
                        key={star}
                        type="button"
                        onClick={() => item.setter(star === item.value ? 0 : star)}
                        style={{
                          background: 'none',
                          border: 'none',
                          padding: 0,
                          fontSize: 28,
                          cursor: 'pointer',
                          color: star <= item.value ? '#ffb020' : 'rgba(255, 255, 255, 0.15)',
                          textShadow: star <= item.value ? '0 0 10px rgba(255, 176, 32, 0.3)' : 'none',
                          transition: 'transform 0.1s'
                        }}
                      >
                        ★
                      </button>
                    ))}
                    <span style={{ fontSize: 12, color: 'var(--cl-muted)', marginLeft: 8 }}>{item.value}/5</span>
                  </div>
                </div>
              ))}

              <div style={{ borderTop: '1px solid var(--cl-border)', paddingTop: 14 }}>
                <button
                  type="button"
                  onClick={() => setMostrarQuejas(p => !p)}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'var(--cl-bronze-light)',
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: 0
                  }}
                >
                  {mostrarQuejas ? '▲ Ocultar quejas o sugerencias' : '💬 ¿Tienes quejas o sugerencias extras?'}
                </button>
                {mostrarQuejas && (
                  <textarea
                    placeholder="Escribe tus comentarios aquí..."
                    value={comentarios}
                    onChange={e => setComentarios(e.target.value)}
                    style={{
                      width: '100%',
                      height: 80,
                      marginTop: 10,
                      padding: 10,
                      background: 'var(--cl-surface)',
                      border: '1px solid var(--cl-border)',
                      borderRadius: 10,
                      color: '#fff',
                      fontSize: 13,
                      resize: 'none',
                      outline: 'none'
                    }}
                  />
                )}
              </div>
            </div>

            <button
              className="mc-btn-primary"
              onClick={enviarEncuestaYSolicitarCuenta}
              disabled={enviando}
            >
              {enviando ? 'Enviando...' : 'Enviar y Solicitar Cuenta'}
            </button>
            <button className="mc-btn-secondary" onClick={() => setShowSurvey(false)}>Cancelar</button>
          </div>
        </div>
      )}
    </>
  );
}

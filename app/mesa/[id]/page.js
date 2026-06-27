'use client';
import { useState, useEffect, useCallback, use, useRef } from 'react';
import {
  collection, addDoc, onSnapshot, query,
  where, orderBy, serverTimestamp, doc, updateDoc, setDoc, getDoc
} from '@/lib/firestore-tenant';
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

// ── CONSTANTES DE NOMBRES DE LOCALSTORAGE CON VERSIONADO ──
const KEY_CLIENTE_NOMBRE = 'yoy_v2_cliente_nombre';
const KEY_PENDING_ORDERS = 'yoy_v2_pending_orders';
const KEY_PENDING_SURVEYS = 'yoy_v2_pending_surveys';
const KEY_CLIENT_CACHED_STOCK = 'yoy_v2_client_cached_stock';
const getMesaInfoKey = (id) => `yoy_v2_mesa_info_${id}`;
const getMesaSessionInicioKey = (id) => `yoy_v2_mesa_session_inicio_${id}`;

// ═══════════════════════════════════════════════════════════
// PÁGINA PÚBLICA DEL CLIENTE (sin autenticación)
// ═══════════════════════════════════════════════════════════
export default function MesaClientePage({ params }) {
  const { id } = use(params);
  const mesaId = parseInt(id);

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

  const lastActivityWriteRef = useRef(0);
  const renewSessionIfNeeded = async () => {
    if (Date.now() - lastActivityWriteRef.current > 30000) {
      lastActivityWriteRef.current = Date.now();
      await actualizarActividadMesa();
    }
  };

  const [tab, setTabRaw] = useState('menu');
  const setTab = (newTab) => {
    renewSessionIfNeeded();
    setTabRaw(newTab);
  };
  const [productos, setProductos] = useState([]);
  const [rentaExtras, setRentaExtras] = useState([]);
  const [now, setNow] = useState(Date.now());

  // Ticker timer para actualizar el tiempo jugado en tiempo real
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => clearInterval(timer);
  }, []);
  const [carrito, setCarrito] = useState({}); // { prodId: cantidad }
  const [tiposAsistencia, setTiposAsistencia] = useState(DEFAULT_ASISTENCIAS);
  const [pedidosMesa, setPedidosMesa] = useState([]);
  const [showCarrito, setShowCarrito] = useState(false);
  const [showAsistConfirm, setShowAsistConfirm] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const [exito, setExito] = useState(null); // 'pedido' | 'asistencia' | 'cuenta'
  const [mesaInfo, setMesaInfo] = useState(() => {
    if (typeof window !== 'undefined') {
      try {
        const stored = localStorage.getItem(getMesaInfoKey(mesaId));
        return stored ? JSON.parse(stored) : null;
      } catch (e) {}
    }
    return null;
  });
  const [loadingMesaInfo, setLoadingMesaInfo] = useState(true);
  const [notification, setNotification] = useState(null);
  const [cuentasActivas, setCuentasActivas] = useState([]);

  // Nombre del cliente (pre-poblado si la mesa tiene cliente asignado)
  const [clienteNombre, setClienteNombre] = useState(() => {
    if (typeof window !== 'undefined') {
      const rawCached = localStorage.getItem(KEY_CLIENTE_NOMBRE) || '';
      const cached = rawCached.startsWith('[RC4-STATIC]') ? (deobfuscateStatic(rawCached) || '') : rawCached;
      // Si el nombre guardado en caché es el nombre de otra mesa, lo ignoramos
      if (cached.toLowerCase().startsWith('mesa ') && cached.toLowerCase() !== `mesa ${mesaId}`) {
        return '';
      }
      return cached;
    }
    return '';
  });
  const [showNombre, setShowNombre] = useState(false);
  const [isOffline, setIsOffline] = useState(false);

  // Limpiar activamente el caché si es un nombre genérico de otra mesa
  useEffect(() => {
    if (typeof window !== 'undefined') {
      try {
        const rawCached = localStorage.getItem(KEY_CLIENTE_NOMBRE) || '';
        const cached = rawCached.startsWith('[RC4-STATIC]') ? (deobfuscateStatic(rawCached) || '') : rawCached;
        if (cached.toLowerCase().startsWith('mesa ') && cached.toLowerCase() !== `mesa ${mesaId}`) {
          localStorage.removeItem(KEY_CLIENTE_NOMBRE);
        }
      } catch (e) {}
    }
  }, [mesaId]);

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

  const [alertingReservada, setAlertingReservada] = useState(false);
  const prevEstadoRef = useRef(null);
  const audioCtxRef = useRef(null);
  const beepIntervalRef = useRef(null);

  const [notificationPermission, setNotificationPermission] = useState('default');
  const swRegistrationRef = useRef(null);
  const [isSupported, setIsSupported] = useState(true);
  const beepCountRef = useRef(0);

  const [alertFrequency, setAlertFrequency] = useState(880);
  const alertStartedAtRef = useRef(null);

  const guardarLogAlerta = useCallback(async (tipo) => {
    if (!alertStartedAtRef.current) return;
    const duracion = Math.round((Date.now() - alertStartedAtRef.current) / 1000);
    alertStartedAtRef.current = null; // reset
    try {
      await addDoc(collection(db, 'alertas_digitales_log'), {
        tipo,
        mesaId: mesaId,
        cliente: mesaInfo?.cliente || 'Público',
        duracionSegundos: duracion,
        createdAt: serverTimestamp()
      });
      console.log("Log de alerta de mesa guardado con éxito. Duración:", duracion);
    } catch (e) {
      console.error("Error al guardar log de alerta de mesa:", e);
    }
  }, [mesaId, mesaInfo]);

  const probarAlerta = () => {
    if (typeof window !== 'undefined' && window.navigator && window.navigator.vibrate) {
      window.navigator.vibrate(100);
    }
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (AudioContext) {
        const ctx = new AudioContext();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(alertFrequency, ctx.currentTime);
        gain.gain.setValueAtTime(0, ctx.currentTime);
        gain.gain.linearRampToValueAtTime(0.3, ctx.currentTime + 0.05);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.2);
        
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.2);
        
        setTimeout(() => ctx.close(), 500);
      }
    } catch (e) {
      console.warn("Error al probar sonido:", e);
    }
  };

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const supported = ('Notification' in window) && ('serviceWorker' in navigator);
      setIsSupported(supported);
    }

    if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js')
        .then((reg) => {
          swRegistrationRef.current = reg;
          console.log("Service Worker registrado con éxito para mesa:", reg.scope);
        })
        .catch((err) => {
          console.error("Error al registrar el Service Worker para mesa:", err);
        });
    }

    if (typeof window !== 'undefined' && 'Notification' in window) {
      setNotificationPermission(Notification.permission);
    }
  }, []);

  const requestNotificationPermission = () => {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      Notification.requestPermission().then((permission) => {
        setNotificationPermission(permission);
        if (permission === 'granted') {
          if (swRegistrationRef.current) {
            swRegistrationRef.current.showNotification("Notificaciones Activas 🔔", {
              body: "Recibirás una alerta en este dispositivo cuando tu mesa sea activada.",
              icon: "/icon.png",
              tag: "test-notification-mesa"
            });
          }
        }
      });
    }
  };

  // Disparar notificación del sistema cuando se activa la mesa
  useEffect(() => {
    if (alertingReservada) {
      if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
        if (swRegistrationRef.current) {
          swRegistrationRef.current.showNotification("¡MESA ACTIVADA! 🔔", {
            body: `Tu Mesa ${mesaId} ha sido activada en caja. ¡Ya puedes comenzar a jugar y ordenar!`,
            icon: "/icon.png",
            vibrate: [300, 200, 300, 200, 500],
            tag: "mesa-activada",
            requireInteraction: true,
            actions: [
              { action: 'silenciar', title: '🔇 Silenciar Alarma' }
            ]
          });
        }
      }
    }
  }, [alertingReservada, mesaId]);

  // Escuchar mensajes del Service Worker para silenciar la alarma
  useEffect(() => {
    if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
      const handleSWMessage = (event) => {
        if (event.data && event.data.type === 'SILENCE_ALERT') {
          console.log("Alarma de mesa silenciada desde la notificación de sistema.");
          guardarLogAlerta('reserva_activada');
          setAlertingReservada(false);
          beepCountRef.current = 0;
          if (typeof window !== 'undefined' && window.navigator && window.navigator.vibrate) {
            window.navigator.vibrate(0);
          }
        }
      };

      navigator.serviceWorker.addEventListener('message', handleSWMessage);
      return () => {
        navigator.serviceWorker.removeEventListener('message', handleSWMessage);
      };
    }
  }, [guardarLogAlerta]);

  // Monitorear transición de reservada a ocupada
  useEffect(() => {
    if (!mesaInfo) return;
    if (prevEstadoRef.current === 'reservada' && mesaInfo.estado === 'ocupada') {
      if (!alertingReservada) {
        alertStartedAtRef.current = Date.now();
      }
      setAlertingReservada(true);
    }
    prevEstadoRef.current = mesaInfo.estado;
  }, [mesaInfo]);

  // Alerta sonora y de vibración para reservación activada
  useEffect(() => {
    if (alertingReservada) {
      if (typeof window !== 'undefined' && window.navigator && window.navigator.vibrate) {
        window.navigator.vibrate([300, 200, 300, 200, 500]);
        const vibrateInterval = setInterval(() => {
          window.navigator.vibrate([300, 200, 300, 200, 500]);
        }, 2000);
        return () => clearInterval(vibrateInterval);
      }
    }
  }, [alertingReservada]);

  useEffect(() => {
    if (alertingReservada) {
      try {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (AudioContext) {
          const ctx = new AudioContext();
          audioCtxRef.current = ctx;
          beepCountRef.current = 0;

          const playBeep = () => {
            if (ctx.state === 'suspended') {
              ctx.resume();
            }
            beepCountRef.current += 1;
            const targetVol = Math.min(0.5, 0.1 + (beepCountRef.current - 1) * 0.1);

            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(alertFrequency, ctx.currentTime);
            gain.gain.setValueAtTime(0, ctx.currentTime);
            gain.gain.linearRampToValueAtTime(targetVol, ctx.currentTime + 0.05);
            gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.4);
            
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start();
            osc.stop(ctx.currentTime + 0.4);
          };

          playBeep();
          beepIntervalRef.current = setInterval(playBeep, 1000);
        }
      } catch (err) {
        console.error("Error al iniciar Web Audio API para reservación:", err);
      }
    } else {
      if (beepIntervalRef.current) {
        clearInterval(beepIntervalRef.current);
        beepIntervalRef.current = null;
      }
      if (audioCtxRef.current) {
        audioCtxRef.current.close();
        audioCtxRef.current = null;
      }
    }

    return () => {
      if (beepIntervalRef.current) clearInterval(beepIntervalRef.current);
      if (audioCtxRef.current) audioCtxRef.current.close();
    };
  }, [alertingReservada, alertFrequency]);

  // ── Helper de escritura con Timeout para redes inestables ──
  const addDocWithTimeout = async (collRef, data, timeoutMs = 8000) => {
    const writePromise = addDoc(collRef, data);
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Timeout de red: No se pudo conectar con el servidor de Firebase. Verifica tu conexión de red o los permisos.")), timeoutMs)
    );
    return Promise.race([writePromise, timeoutPromise]);
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
        // No guardamos nombres genéricos de mesa en caché
        const isGeneric = nombre.toLowerCase().startsWith('mesa ');
        if (!isGeneric) {
          localStorage.setItem(KEY_CLIENTE_NOMBRE, obfuscateStatic(nombre));
        }
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

  // ── Limpiar claves obsoletas de versiones anteriores en localStorage ──
  useEffect(() => {
    if (typeof window !== 'undefined') {
      try {
        const legacyKeys = [
          'yoy_cliente_nombre',
          'yoy_pending_orders',
          'yoy_pending_surveys',
          'yoy_client_cached_stock',
          `yoy_mesa_info_${mesaId}`,
          `yoy_mesa_session_inicio_${mesaId}`
        ];
        legacyKeys.forEach(k => {
          localStorage.removeItem(k);
        });
        console.log("[Mantenimiento] Claves de caché heredadas eliminadas del localStorage.");
      } catch (e) {}
    }
  }, [mesaId]);

  // ── Sincronizar encuestas guardadas localmente al estar online ──
  useEffect(() => {
    const sincronizarEncuestasPendientes = async () => {
      if (typeof window === 'undefined' || isOffline) return;
      try {
        const rawPending = localStorage.getItem(KEY_PENDING_SURVEYS);
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
          localStorage.setItem(KEY_PENDING_SURVEYS, JSON.stringify(remaining));
        } else {
          localStorage.removeItem(KEY_PENDING_SURVEYS);
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
        const rawPending = localStorage.getItem(KEY_PENDING_ORDERS);
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
          localStorage.setItem(KEY_PENDING_ORDERS, JSON.stringify(remaining));
        } else {
          localStorage.removeItem(KEY_PENDING_ORDERS);
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
      const cached = localStorage.getItem(KEY_CLIENT_CACHED_STOCK);
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
          localStorage.setItem(KEY_CLIENT_CACHED_STOCK, JSON.stringify(prods));
        } catch (e) {}
      } else {
        // Fallback: productos de demostración
        const fallback = [
          { id: 1, nombre: 'Cerveza Corona Extra', categoria: 'Cerveza', precioVenta: 45, stock: 0 },
          { id: 2, nombre: 'Coca-Cola 355ml', categoria: 'Refresco', precioVenta: 30, stock: 0 },
          { id: 3, nombre: 'Nachos con Queso', categoria: 'Snack', precioVenta: 75, stock: 0 },
          { id: 4, nombre: 'Alitas de Pollo x10', categoria: 'Comida', precioVenta: 120, stock: 0 },
          { id: 5, nombre: 'Agua 600ml', categoria: 'Bebida', precioVenta: 20, stock: 0 },
          { id: 6, nombre: 'Café Americano', categoria: 'Bebida', precioVenta: 35, stock: 0 },
        ];
        setProductos(fallback);
      }
    }, err => {
      setDbConnected(false);
      console.error("Error al cargar inventario en tiempo real para cliente:", err);
    });
    return unsub;
  }, []);

  // ── Leer renta_extras en tiempo real desde Firestore ──
  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'config', 'renta_extras'), snap => {
      if (snap.exists()) {
        setRentaExtras(snap.data().extras || []);
      }
    }, err => {
      console.error("Error al cargar renta_extras en tiempo real para cliente:", err);
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
          try {
            localStorage.setItem(getMesaInfoKey(mesaId), JSON.stringify(mesa));
          } catch (e) {}
          
          // Verificar si es una nueva sesión para limpiar el nombre de cliente anterior
          if (typeof window !== 'undefined') {
            try {
              const savedInicio = localStorage.getItem(getMesaSessionInicioKey(mesaId)) || '';
              const currentInicio = mesa.inicio ? String(mesa.inicio) : '';
              if (savedInicio !== currentInicio) {
                localStorage.setItem(getMesaSessionInicioKey(mesaId), currentInicio);
                localStorage.removeItem(KEY_CLIENTE_NOMBRE);
                setClienteNombre('');
              }
            } catch (e) {}
          }

          if (mesa.cliente && mesa.cliente !== 'Público') {
            setClienteNombre(mesa.cliente);
            const isGeneric = mesa.cliente.toLowerCase().startsWith('mesa ');
            if (!isGeneric) {
              try {
                localStorage.setItem(KEY_CLIENTE_NOMBRE, obfuscateStatic(mesa.cliente));
              } catch (e) {}
            }
          } else {
            setClienteNombre('');
            try {
              localStorage.removeItem(KEY_CLIENTE_NOMBRE);
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

  // Detectar cambios en la configuración de la mesa en tiempo real y mostrar notificaciones
  const prevMesaConfig = useRef(null);
  useEffect(() => {
    if (!mesaInfo) return;
    
    if (prevMesaConfig.current) {
      const prev = prevMesaConfig.current;
      const changes = [];
      if (prev.tarifa !== mesaInfo.tarifa) changes.push(`Tarifa a $${mesaInfo.tarifa}/hr`);
      if (prev.rentarTaco !== mesaInfo.rentarTaco) changes.push(mesaInfo.rentarTaco ? 'Taco Premium añadido' : 'Taco Premium retirado');
      if (prev.rentarBolas !== mesaInfo.rentarBolas) changes.push(mesaInfo.rentarBolas ? 'Bolas Premium añadidas' : 'Bolas Premium retiradas');
      if (prev.rentarTiza !== mesaInfo.rentarTiza) changes.push(mesaInfo.rentarTiza ? 'Tiza Premium añadida' : 'Tiza Premium retirada');
      if (prev.socios !== mesaInfo.socios) changes.push(mesaInfo.socios ? 'Tarifa miembro activada' : 'Tarifa miembro desactivada');

      if (changes.length > 0) {
        setNotification(`Mesa actualizada: ${changes.join(', ')} ⚡`);
        const timer = setTimeout(() => setNotification(null), 4000);
        return () => clearTimeout(timer);
      }
    }

    prevMesaConfig.current = {
      tarifa: mesaInfo.tarifa,
      rentarTaco: mesaInfo.rentarTaco,
      rentarBolas: mesaInfo.rentarBolas,
      rentarTiza: mesaInfo.rentarTiza,
      socios: mesaInfo.socios
    };
  }, [mesaInfo]);

  // ── Leer cuentas activas en tiempo real desde Firestore ──
  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'config', 'cuentas_estado'), snap => {
      if (snap.exists()) {
        const list = snap.data().cuentas || [];
        setCuentasActivas(list);
      }
    }, err => {
      console.error("Error al escuchar cuentas activas en Firestore:", err);
    });
    return unsub;
  }, []);

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
    renewSessionIfNeeded();
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
    if (mesaInfo.preTicketImpreso) {
      alert('Operación denegada: La mesa se encuentra en proceso de cobro (pre-ticket impreso). No se permiten pedidos adicionales.');
      return;
    }

    // Eliminado el mensaje de confirmación redundante por solicitud del cliente
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
    if (mesaInfo.preTicketImpreso) {
      alert('Operación denegada: La mesa se encuentra en proceso de cobro. No se permite solicitar asistencias adicionales.');
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

  // Calcular tiempo y costo de juego en tiempo real
  const getTiempoJuegoData = () => {
    if (!mesaInfo || !mesaInfo.inicio || mesaInfo.estado !== 'ocupada') {
      return { elapsedStr: '00:00:00', costo: 0, hrs: 0 };
    }
    const diffMs = Math.max(0, now - mesaInfo.inicio);
    const s = Math.floor(diffMs / 1000);
    const h = Math.floor(s / 3600).toString().padStart(2, '0');
    const m = Math.floor((s % 3600) / 60).toString().padStart(2, '0');
    const sc = (s % 60).toString().padStart(2, '0');
    
    const hrs = diffMs / 3600000;
    let baseCosto = mesaInfo.socios ? 0 : Math.ceil(hrs * mesaInfo.tarifa);
    const tacoExtra = (rentaExtras && rentaExtras.find(e => e.id === 'taco')) || { precio: 25, tipo: 'hora' };
    const bolasExtra = (rentaExtras && rentaExtras.find(e => e.id === 'bolas')) || { precio: 35, tipo: 'hora' };
    const tizaExtra = (rentaExtras && rentaExtras.find(e => e.id === 'tiza')) || { precio: 10, tipo: 'fijo' };

    let premiumCosto = 0;
    if (mesaInfo.rentarTaco) {
      premiumCosto += (tacoExtra.tipo === 'hora' ? Math.ceil(hrs * tacoExtra.precio) : tacoExtra.precio);
    }
    if (mesaInfo.rentarBolas) {
      premiumCosto += (bolasExtra.tipo === 'hora' ? Math.ceil(hrs * bolasExtra.precio) : bolasExtra.precio);
    }
    if (mesaInfo.rentarTiza) {
      premiumCosto += (tizaExtra.tipo === 'hora' ? Math.ceil(hrs * tizaExtra.precio) : tizaExtra.precio);
    }
    const costo = baseCosto + premiumCosto;

    return {
      elapsedStr: `${h}:${m}:${sc}`,
      costo,
      hrs,
      baseCosto,
      premiumCosto
    };
  };

  const tiempoData = getTiempoJuegoData();

  // ── Buscar cuenta asociada y calcular consumos reales de la caja ──
  const cuentaAsociada = cuentasActivas.find(c => 
    c.mesaId === mesaId ||
    (c.cliente && (
      (mesaInfo?.cliente && !['público', 'publico'].includes(mesaInfo.cliente.toLowerCase()) && c.cliente.toLowerCase() === mesaInfo.cliente.toLowerCase()) || 
      c.cliente.toLowerCase() === `mesa ${mesaId}`
    ))
  );

  const consumosList = cuentaAsociada ? (cuentaAsociada.consumos || []) : [];
  const costoConsumoReal = consumosList.reduce((sum, item) => sum + (item.precio || 0) * (item.cantidad || 0), 0);

  // ── Calcular total acumulado ─────────────────────────────
  const totalAcumulado = tiempoData.costo + costoConsumoReal;

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

  if (mesaInfo && mesaInfo.estado === 'reservada') {
    const permissionBannerStyle = {
      background: 'rgba(197, 168, 128, 0.12)',
      border: '1px solid rgba(197, 168, 128, 0.3)',
      borderRadius: 16,
      padding: '12px 14px',
      marginBottom: 20,
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      textAlign: 'left'
    };

    const permissionButtonStyle = {
      background: '#c5a880',
      color: '#0a0a0f',
      border: 'none',
      padding: '8px 16px',
      borderRadius: 10,
      fontWeight: 800,
      fontSize: 12,
      cursor: 'pointer',
      whiteSpace: 'nowrap',
      boxShadow: '0 2px 8px rgba(197, 168, 128, 0.2)'
    };

    const controlsContainerStyle = {
      background: 'rgba(255, 255, 255, 0.02)',
      border: '1px solid rgba(255, 255, 255, 0.05)',
      borderRadius: 14,
      padding: '10px 14px',
      marginTop: 14,
      width: '100%'
    };

    const testButtonStyle = {
      background: 'rgba(197, 168, 128, 0.1)',
      border: '1px solid rgba(197, 168, 128, 0.25)',
      color: '#c5a880',
      padding: '6px 12px',
      borderRadius: 8,
      fontWeight: 600,
      fontSize: 12,
      cursor: 'pointer',
      flex: 1
    };

    const selectStyle = {
      background: '#14141c',
      border: '1px solid rgba(255, 255, 255, 0.08)',
      color: '#fff',
      padding: '6px 10px',
      borderRadius: 8,
      fontSize: 12,
      cursor: 'pointer',
      outline: 'none',
      flex: 1
    };

    return (
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100dvh',
        padding: 24,
        textAlign: 'center',
        background: '#0a0a0f',
        color: '#fff',
        fontFamily: "'Inter', sans-serif"
      }}>
        <style>{`
          @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800;900&display=swap');
          @keyframes pulse {
            0% { transform: scale(1); box-shadow: 0 0 0 0 rgba(197, 168, 128, 0.4); }
            70% { transform: scale(1.05); box-shadow: 0 0 0 15px rgba(197, 168, 128, 0); }
            100% { transform: scale(1); box-shadow: 0 0 0 0 rgba(197, 168, 128, 0); }
          }
        `}</style>
        <div style={{
          background: 'rgba(20, 20, 28, 0.65)',
          border: '1px solid rgba(197, 168, 128, 0.15)',
          borderRadius: 24,
          padding: '32px 24px',
          width: '100%',
          maxWidth: 380,
          textAlign: 'center',
          backdropFilter: 'blur(10px)',
          boxShadow: '0 8px 32px 0 rgba(0, 0, 0, 0.37)'
        }}>
          {isSupported && notificationPermission === 'default' && (
            <div style={permissionBannerStyle}>
              <span style={{ fontSize: 22 }}>🔔</span>
              <div style={{ flex: 1, textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 2 }}>
                <div style={{ fontWeight: 800, fontSize: 13, color: '#fff' }}>Notificaciones Activas</div>
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)', lineHeight: 1.3 }}>Permite recibir alertas cuando tu mesa esté lista, incluso si bloqueas tu celular.</div>
              </div>
              <button onClick={requestNotificationPermission} style={permissionButtonStyle}>
                Activar
              </button>
            </div>
          )}
          {!isSupported && (
            <div style={{
              background: 'rgba(255, 255, 255, 0.02)',
              border: '1px solid rgba(255, 255, 255, 0.05)',
              borderRadius: 14,
              padding: '10px 14px',
              fontSize: 11,
              color: 'rgba(255, 255, 255, 0.4)',
              marginBottom: 20,
              textAlign: 'left'
            }}>
              ℹ️ Abre este enlace directamente en <strong>Safari</strong> o <strong>Chrome</strong> si deseas recibir notificaciones en segundo plano y pantalla bloqueada.
            </div>
          )}
          <div style={{ fontSize: 64, marginBottom: 20, animation: 'pulse 2s infinite', borderRadius: '50%', background: 'rgba(197, 168, 128, 0.1)', padding: 12, display: 'inline-block' }}>📅</div>
          <h2 style={{ fontSize: 22, fontWeight: 800, color: '#c5a880', marginBottom: 16, letterSpacing: '0.02em' }}>Mesa Reservada</h2>
          <div style={{
            display: 'inline-block',
            background: 'linear-gradient(135deg, #c5a880, #967a57)',
            color: '#0a0a0f',
            padding: '6px 16px',
            borderRadius: 20,
            fontWeight: 800,
            fontSize: 14,
            marginBottom: 20,
            letterSpacing: '0.05em'
          }}>
            Mesa {mesaId}
          </div>
          
          <div style={{
            background: 'rgba(255, 255, 255, 0.03)',
            border: '1px solid rgba(255, 255, 255, 0.05)',
            borderRadius: 16,
            padding: '16px 20px',
            width: '100%',
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            textAlign: 'left'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
              <span style={{ color: 'rgba(255, 255, 255, 0.4)' }}>Cliente:</span>
              <span style={{ color: '#fff', fontWeight: 600 }}>{mesaInfo.cliente || 'Reservado'}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
              <span style={{ color: 'rgba(255, 255, 255, 0.4)' }}>Estado:</span>
              <span style={{ color: '#c5a880', fontWeight: 600 }}>Esperando activación</span>
            </div>
          </div>

          <div style={controlsContainerStyle}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
              <button onClick={probarAlerta} style={testButtonStyle}>
                🔊 Probar Alerta
              </button>
              <select 
                value={alertFrequency} 
                onChange={(e) => setAlertFrequency(parseInt(e.target.value))}
                style={selectStyle}
              >
                <option value={440}>Tono Grave 🔉</option>
                <option value={880}>Tono Normal 🔔</option>
                <option value={1200}>Tono Agudo 🔊</option>
              </select>
            </div>
          </div>

          <p style={{ fontSize: 13, color: 'rgba(255, 255, 255, 0.6)', lineHeight: 1.6, marginTop: 16 }}>
            Esta mesa se encuentra apartada para ti. Mantén esta página abierta. Tu dispositivo sonará y vibrará cuando el personal active la mesa desde la caja.
          </p>
        </div>
      </div>
    );
  }

  if (mesaInfo && mesaInfo.estado !== 'ocupada' && mesaInfo.estado !== 'reservada') {
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

  if (!mesaInfo) {
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
        <div style={{ fontSize: 64, marginBottom: 20 }}>⚠️</div>
        <h2 style={{ fontSize: 22, fontWeight: 900, marginBottom: 12, color: 'var(--cl-bronze-light, #cd7f32)' }}>Mesa no registrada</h2>
        <p style={{ color: 'rgba(255,255,255,0.6)', maxWidth: 340, fontSize: 14, lineHeight: 1.6, marginBottom: 24 }}>
          Esta mesa no existe en el sistema de la caja. Por favor, verifica el número de mesa o contacta al personal del establecimiento.
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

  if (mesaInfo && mesaInfo.estado === 'ocupada' && mesaInfo.preTicketImpreso) {
    return (
      <div style={{
        minHeight: '100vh',
        background: 'var(--bg-primary, #0c0c0e)',
        color: '#fff',
        fontFamily: "'Inter', sans-serif",
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '30px 20px',
        boxSizing: 'border-box',
        textAlign: 'center'
      }}>
        <style>{`
          @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800;900&display=swap');
          :root {
            --bg-elevated: #16161a;
            --border-bronze: #cd7f32;
            --bronze-light: #c5a880;
          }
        `}</style>
        <div style={{
          background: 'var(--bg-elevated, #16161a)',
          border: '1px solid var(--border-bronze, #cd7f32)',
          borderRadius: 20,
          padding: '40px 24px',
          maxWidth: 400,
          boxShadow: '0 8px 32px rgba(0,0,0,0.5), 0 0 16px rgba(205,127,50,0.1)'
        }}>
          <div style={{ fontSize: 64, marginBottom: 20, animation: 'pulse 2s infinite' }}>⏳</div>
          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--bronze-light, #c5a880)', margin: '0 0 12px' }}>
            Cuenta en Proceso
          </h2>
          <div style={{ fontSize: 16, fontWeight: 700, margin: '0 0 16px' }}>Mesa {mesaId} ({mesaInfo.cliente || 'Público'})</div>
          <p style={{ fontSize: 13, color: '#aaa', lineHeight: 1.5, margin: '0 0 24px' }}>
            Tu pre-ticket de cuenta ya ha sido impreso y se encuentra en caja. En breve el mesero llevará la cuenta a tu mesa o puedes proceder directamente a pagar en caja.
          </p>
          <div style={{
            fontSize: 11,
            color: '#777',
            background: 'rgba(255,255,255,0.02)',
            padding: '10px 14px',
            borderRadius: 10,
            border: '1px solid rgba(255,255,255,0.05)'
          }}>
            <i className="ri-information-line" style={{ marginRight: 4 }} /> No se permiten pedidos ni asistencias adicionales por este medio en este momento.
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      {/* LINK a Google Fonts Inter */}
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800;900&display=swap');
        @keyframes pulseAlert {
          0% { transform: scale(1); box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.5); }
          70% { transform: scale(1.08); box-shadow: 0 0 0 20px rgba(239, 68, 68, 0); }
          100% { transform: scale(1); box-shadow: 0 0 0 0 rgba(239, 68, 68, 0); }
        }
      `}</style>

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

        {notification && (
          <div style={{
            background: 'linear-gradient(135deg, rgba(205,127,50,0.15), rgba(15,13,12,0.95))',
            border: '1px solid var(--cl-border-bronze, rgba(205,127,50,0.45))',
            borderRadius: 14,
            padding: '14px 16px',
            marginBottom: 16,
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            animation: 'slideUp 0.35s cubic-bezier(0.175, 0.885, 0.32, 1.275)',
            boxShadow: '0 8px 24px rgba(205,127,50,0.15)'
          }}>
            <span style={{ fontSize: 26 }}>⚡</span>
            <div>
              <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--cl-bronze-light)' }}>
                Configuración Actualizada
              </div>
              <div style={{ fontSize: 12, color: '#fff', marginTop: 2 }}>
                {notification}
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

            {/* 🕒 TIEMPO DE JUEGO */}
            {mesaInfo?.inicio && mesaInfo?.estado === 'ocupada' && (
              <div style={{
                background: 'linear-gradient(135deg, var(--cl-card), rgba(205,127,50,0.05))',
                border: '1px solid var(--cl-border-bronze, rgba(205,127,50,0.3))',
                borderRadius: 16,
                padding: '16px 20px',
                marginBottom: 16,
                boxShadow: '0 4px 20px rgba(0,0,0,0.2)'
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--cl-bronze-light)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                    🕒 Tiempo de Juego
                  </span>
                  <span style={{
                    fontFamily: 'monospace',
                    fontSize: 15,
                    fontWeight: 700,
                    color: '#fff',
                    background: 'rgba(255,255,255,0.06)',
                    padding: '2px 8px',
                    borderRadius: 8
                  }}>
                    {tiempoData.elapsedStr}
                  </span>
                </div>
                
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: 'var(--cl-text-secondary)' }}>
                    <span>Tarifa por hora:</span>
                    <span>${mesaInfo.tarifa}/hr {mesaInfo.socios && '(Socio)'}</span>
                  </div>
                  
                  {(mesaInfo.rentarTaco || mesaInfo.rentarBolas || mesaInfo.rentarTiza) && (
                    <div style={{ fontSize: 11, color: 'var(--cl-muted)', paddingLeft: 8, borderLeft: '2px solid rgba(205,127,50,0.2)', margin: '4px 0', display: 'flex', flexDirection: 'column', gap: 3 }}>
                      {mesaInfo.rentarTaco && (
                        <div>
                          • Renta de {(rentaExtras && rentaExtras.find(e => e.id === 'taco')?.nombre) || 'Taco Premium'}{' '}
                          (+${(rentaExtras && rentaExtras.find(e => e.id === 'taco')?.precio) || 25}
                          /{(rentaExtras && rentaExtras.find(e => e.id === 'taco')?.tipo) === 'hora' ? 'hr' : 'única'})
                        </div>
                      )}
                      {mesaInfo.rentarBolas && (
                        <div>
                          • Renta de {(rentaExtras && rentaExtras.find(e => e.id === 'bolas')?.nombre) || 'Bolas Premium'}{' '}
                          (+${(rentaExtras && rentaExtras.find(e => e.id === 'bolas')?.precio) || 35}
                          /{(rentaExtras && rentaExtras.find(e => e.id === 'bolas')?.tipo) === 'hora' ? 'hr' : 'única'})
                        </div>
                      )}
                      {mesaInfo.rentarTiza && (
                        <div>
                          • Renta de {(rentaExtras && rentaExtras.find(e => e.id === 'tiza')?.nombre) || 'Tiza Premium'}{' '}
                          (+${(rentaExtras && rentaExtras.find(e => e.id === 'tiza')?.precio) || 10}
                          /{(rentaExtras && rentaExtras.find(e => e.id === 'tiza')?.tipo) === 'hora' ? 'hr' : 'única'})
                        </div>
                      )}
                    </div>
                  )}

                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, fontWeight: 700, marginTop: 4, paddingTop: 6, borderTop: '1px dashed var(--cl-border)' }}>
                    <span style={{ color: '#fff' }}>Costo de Mesa:</span>
                    <span style={{ color: 'var(--cl-bronze-light)' }}>${tiempoData.costo}</span>
                  </div>
                </div>
              </div>
            )}

            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--cl-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>
              🍹 Consumos de Menú (Cargados en cuenta)
            </div>

            {consumosList.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '20px 16px', background: 'rgba(255,255,255,0.02)', border: '1px dashed var(--cl-border)', borderRadius: 14, marginBottom: 16 }}>
                <i className="ri-receipt-line" style={{ fontSize: 22, color: 'var(--cl-muted)', display: 'block', marginBottom: 6 }} />
                <p style={{ margin: 0, fontSize: 12, color: 'var(--cl-muted)' }}>Ningún consumo cargado oficialmente en la mesa todavía.</p>
              </div>
            ) : (
              <div style={{ background: 'var(--cl-card)', border: '1px solid var(--cl-border)', borderRadius: 16, padding: '14px 16px', marginBottom: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
                {consumosList.map((item, idx) => (
                  <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13, paddingBottom: idx === consumosList.length - 1 ? 0 : 8, borderBottom: idx === consumosList.length - 1 ? 'none' : '1px solid rgba(255,255,255,0.03)' }}>
                    <span>{item.cantidad}× {item.producto}</span>
                    <span style={{ fontWeight: 700, color: 'var(--cl-bronze-light)' }}>${(item.precio || 0) * (item.cantidad || 0)}</span>
                  </div>
                ))}
                <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: 8, borderTop: '1px solid var(--cl-border)' }}>
                  <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--cl-bronze-light)' }}>Subtotal Consumo: ${costoConsumoReal}</span>
                </div>
              </div>
            )}

            {(() => {
              const ordenesEnProceso = pedidosMesa.filter(p => p.tipo === 'pedido' && p.estado !== 'entregado');
              if (ordenesEnProceso.length === 0) return null;
              
              return (
                <>
                  <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--cl-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginTop: 16, marginBottom: 10 }}>
                    ⏳ Pedidos en Preparación / Camino
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
                    {ordenesEnProceso.map(pedido => (
                      <div key={pedido.id} style={{ background: 'rgba(255,255,255,0.01)', border: '1px dashed var(--cl-border)', borderRadius: 14, padding: '12px 14px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                          <span style={{ fontSize: 11, color: 'var(--cl-muted)' }}>
                            {pedido.createdAt?.toDate ? pedido.createdAt.toDate().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }) : '—'}
                          </span>
                          <span style={{
                            fontSize: 9, fontWeight: 800, padding: '1px 6px', borderRadius: 999,
                            background: pedido.estado === 'listo' ? 'rgba(167,139,250,0.15)' : 
                                        pedido.estado === 'en_camino' ? 'rgba(245,158,11,0.15)' : 'rgba(59,130,246,0.15)',
                            color: pedido.estado === 'listo' ? '#a78bfa' : 
                                   pedido.estado === 'en_camino' ? '#f59e0b' : '#3b82f6',
                          }}>
                            {pedido.estado === 'listo' ? '🍳 Preparado' : 
                             pedido.estado === 'en_camino' ? '🚀 En camino' : '⏳ Pendiente'}
                          </span>
                        </div>
                        {pedido.items?.map((item, i) => (
                          <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--cl-text-secondary)', padding: '2px 0' }}>
                            <span>{item.cantidad}× {item.nombre}</span>
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                </>
              );
            })()}

            {(() => {
              if (totalAcumulado === 0) return null;
              
              const pctMesa = Math.round((tiempoData.costo / totalAcumulado) * 100);
              const pctConsumo = Math.round((costoConsumoReal / totalAcumulado) * 100);
              
              return (
                <div style={{ background: 'var(--cl-card)', border: '1px solid var(--cl-border)', borderRadius: 16, padding: 14, marginBottom: 16 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--cl-muted)', marginBottom: 8, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    <span>Proporción de Gasto</span>
                    <span>{pctConsumo}% Consumo</span>
                  </div>
                  
                  <div style={{ height: 8, background: 'rgba(255,255,255,0.05)', borderRadius: 4, overflow: 'hidden', display: 'flex' }}>
                    {tiempoData.costo > 0 && <div style={{ width: `${(tiempoData.costo / totalAcumulado) * 100}%`, background: 'var(--cl-bronze-light, #cd7f32)', transition: 'width 0.3s ease' }} />}
                    {costoConsumoReal > 0 && <div style={{ width: `${(costoConsumoReal / totalAcumulado) * 100}%`, background: '#22c55e', transition: 'width 0.3s ease' }} />}
                  </div>
                  
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginTop: 8, fontSize: 11 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, color: 'var(--cl-text-secondary)' }}>
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--cl-bronze-light)' }} />
                      Mesa: ${tiempoData.costo} ({pctMesa}%)
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, color: 'var(--cl-text-secondary)' }}>
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#22c55e' }} />
                      Menú: ${costoConsumoReal} ({pctConsumo}%)
                    </div>
                  </div>
                </div>
              );
            })()}

            <div className="mc-total-box" style={{ marginTop: 8, marginBottom: 16 }}>
              <div style={{ fontSize: 11, color: 'var(--cl-bronze-light)', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 700, marginBottom: 6 }}>Total Acumulado (Mesa + Consumo)</div>
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

      {/* ── MODAL: ALERTA DE MESA ACTIVADA ─────────────────── */}
      {alertingReservada && (
        <div className="mc-overlay" style={{ zIndex: 1200 }}>
          <div className="mc-sheet" style={{ textAlign: 'center', padding: '32px 24px' }}>
            <div style={{ fontSize: 72, marginBottom: 16, animation: 'pulseAlert 1.5s infinite' }}>🔔</div>
            <h2 style={{ fontSize: 24, fontWeight: 900, color: '#ef4444', marginBottom: 12 }}>¡MESA ACTIVADA!</h2>
            <p style={{ fontSize: 15, color: '#fff', lineHeight: 1.6, marginBottom: 24 }}>
              Tu mesa **Mesa {mesaId}** ha sido activada en caja. ¡Ya puedes comenzar a jugar y ordenar!
            </p>
            <button
              className="mc-btn-primary"
              onClick={() => {
                guardarLogAlerta('reserva_activada');
                setAlertingReservada(false);
                beepCountRef.current = 0;
                if (typeof window !== 'undefined' && window.navigator && window.navigator.vibrate) {
                  window.navigator.vibrate(0);
                }
                if (swRegistrationRef.current && swRegistrationRef.current.getNotifications) {
                  swRegistrationRef.current.getNotifications().then((notifications) => {
                    notifications.forEach((n) => n.close());
                  }).catch((err) => console.warn(err));
                }
              }}
              style={{ background: '#22c55e', border: 'none', width: '100%' }}
            >
              Aceptar / Comenzar
            </button>
          </div>
        </div>
      )}
    </>
  );
}

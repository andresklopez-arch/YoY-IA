'use client';
import { useState, useEffect, useRef, useMemo } from 'react';
import {
  collection, onSnapshot, query, where,
  orderBy, updateDoc, doc, serverTimestamp, addDoc, getDoc,
  writeBatch, getDocs, getActiveSalonId
} from '@/lib/firestore-tenant';
import { db } from '@/lib/firebase';
import { useAuth } from '@/lib/auth-context';
import { AuthProvider } from '@/lib/auth-context';
import { getBusinessDate } from '@/lib/date-utils';

const normalizeText = (str) => {
  if (!str) return '';
  return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
};

const startsWithBoundary = (fullStr, subStr) => {
  if (!fullStr || !subStr) return false;
  if (!fullStr.startsWith(subStr)) return false;
  if (fullStr.length === subStr.length) return true;
  const nextChar = fullStr.charAt(subStr.length);
  return !/[a-zA-Z0-9]/.test(nextChar);
};

// ═══════════════════════════════════════════════════════════
// VISTA MESERO — Dashboard de pedidos y asistencias en tiempo real
// ═══════════════════════════════════════════════════════════
function MeseroContent() {
  const { user, loading, logout, loginWithEmpleadoId } = useAuth();

  const handleLogout = async () => {
    if (window.confirm('¿Estás seguro de que deseas cerrar sesión de mesero?')) {
      await logout();
      window.location.href = '/';
    }
  };

  useEffect(() => {
    if (loading) return;

    const urlParams = new URLSearchParams(window.location.search);
    const queryEmpleadoId = urlParams.get('empleadoId');

    const checkAndRecoverSession = async () => {
      if (queryEmpleadoId && queryEmpleadoId !== 'sin_mesero' && queryEmpleadoId !== 'todos' && !user) {
        try {
          await loginWithEmpleadoId(queryEmpleadoId);
          return;
        } catch (e) {
          console.error("Error logging in via queryEmpleadoId:", e);
        }
      }

      if (!user) {
        window.location.href = '/';
        return;
      }

      const rolLower = (user.role || '').toLowerCase();
      const isAuthorized = 
        rolLower.includes('admin') || 
        rolLower.includes('cajero') || 
        rolLower.includes('caja') || 
        rolLower.includes('gerente') || 
        rolLower.includes('tecnico') || 
        rolLower.includes('mesero') ||
        user.isFreeAccess === true;

      if (!isAuthorized) {
        window.location.href = '/';
      }
    };

    checkAndRecoverSession();
  }, [user, loading]);

  const [pedidos, setPedidos] = useState([]);
  const [rawPedidos, setRawPedidos] = useState([]);
  const [sonido, setSonido] = useState(true);
  const [ultimoCount, setUltimoCount] = useState(0);
  const [showAsistenciaModal, setShowAsistenciaModal] = useState(false);
  const [loadingAlertaId, setLoadingAlertaId] = useState(null);
  
  const [toast, setToast] = useState(null);
  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  // Estados para capturar venta
  const [showCapturarModal, setShowCapturarModal] = useState(false);
  const [capturaMesaId, setCapturaMesaId] = useState('1');
  const [capturaCarrito, setCapturaCarrito] = useState({}); // { prodId: cant }
  const [productosBar, setProductosBar] = useState([]);
  const [isClosing, setIsClosing] = useState(false);

  // Sincronización y estados de mesas/cuentas
  const [mesas, setMesas] = useState([]);
  const [cuentas, setCuentas] = useState([]);
  const [rentaExtras, setRentaExtras] = useState([]);

  // Estados para avisar a otro mesero
  const [showModalAvisarMesero, setShowModalAvisarMesero] = useState(false);
  const [alertaDestinatarioId, setAlertaDestinatarioId] = useState('');
  const [alertaMesaId, setAlertaMesaId] = useState('');
  const [todosLosMeseros, setTodosLosMeseros] = useState([]);

  useEffect(() => {
    let unsubAsist = null;
    const qEmp = query(collection(db, 'nomina_empleados'), where('estado', '==', 'activo'));
    const unsubEmp = onSnapshot(qEmp, snapEmp => {
      const activeEmployees = snapEmp.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      
      if (unsubAsist) unsubAsist();
      
      const fechaHoy = getBusinessDate();
      const qAsist = query(collection(db, 'nomina_asistencia'), where('fecha', '==', fechaHoy));
      unsubAsist = onSnapshot(qAsist, snapAsist => {
        const presentIds = snapAsist.docs
          .map(doc => doc.data())
          .filter(a => a.estado === 'presente' || a.estado === 'tardanza')
          .map(a => a.empleadoId);

        const presentWaiters = activeEmployees.filter(emp => 
          presentIds.includes(emp.id) &&
          ((emp.rol || emp.role || '').toLowerCase().includes('mesero') || (emp.rol || emp.role || '').toLowerCase().includes('staff') || !(emp.rol || emp.role))
        );
        setTodosLosMeseros(presentWaiters);
        try {
          localStorage.setItem('yoy_cached_waiters_present', JSON.stringify(presentWaiters));
        } catch (e) {}
      }, err => {
        console.warn("Error loading attendance in waiter view:", err);
        try {
          const cached = localStorage.getItem('yoy_cached_waiters_present');
          if (cached) setTodosLosMeseros(JSON.parse(cached));
        } catch (e) {}
      });
    }, err => console.warn("Error loading employees in waiter view:", err));

    return () => {
      unsubEmp();
      if (unsubAsist) unsubAsist();
    };
  }, []);

  // Buscar mesa asociada a una cuenta
  const findMesaAsociada = (c) => {
    return mesas.find(m => 
      (c.mesaId && String(m.id) === String(c.mesaId)) ||
      (c.cliente && (
        (m.cliente && !['publico'].includes(normalizeText(m.cliente)) && startsWithBoundary(normalizeText(c.cliente), normalizeText(m.cliente))) ||
        normalizeText(c.cliente) === `mesa ${m.id}` ||
        normalizeText(c.cliente) === `mesa ${m.id} - pendiente` ||
        normalizeText(c.cliente).startsWith(`mesa ${m.id} `)
      ))
    );
  };

  // Unificar cuentas reales con las mesas ocupadas que aún no tengan cuenta registrada
  const getCuentasActivasUnificadas = () => {
    // Filtrar cuentas asociadas a mesas en mantenimiento para evitar que aparezcan en la vista del mesero
    const cuentasFiltradas = cuentas.filter(c => {
      if (c.mesaId) {
        const m = mesas.find(tbl => String(tbl.id) === String(c.mesaId));
        if (m && m.estado === 'manten') return false;
      }
      const mesaAsoc = findMesaAsociada(c);
      if (mesaAsoc && mesaAsoc.estado === 'manten') return false;
      return true;
    });

    const unificadas = [...cuentasFiltradas];
    mesas.forEach(m => {
      if (m.estado === 'ocupada') {
        const tieneCuenta = cuentasFiltradas.some(c => 
          (c.mesaId && String(c.mesaId) === String(m.id)) ||
          (c.cliente && (
            (m.cliente && !['publico'].includes(normalizeText(m.cliente)) && startsWithBoundary(normalizeText(c.cliente), normalizeText(m.cliente))) ||
            normalizeText(c.cliente) === `mesa ${m.id}` ||
            normalizeText(c.cliente) === `mesa ${m.id} - pendiente` ||
            normalizeText(c.cliente).startsWith(`mesa ${m.id} `)
          ))
        );
        if (!tieneCuenta) {
          unificadas.push({
            id: `mesa_${m.id}`,
            mesaId: m.id,
            cliente: (m.cliente && !['publico'].includes(normalizeText(m.cliente))) ? m.cliente : `Mesa ${m.id}`,
            consumos: [],
            tiempoJuego: 0
          });
        }
      }
    });
    return unificadas;
  };

  const getUnloadedConsumosForCuenta = (c) => {
    const mesaAsociada = findMesaAsociada(c);
    const mId = c.mesaId || (mesaAsociada ? mesaAsociada.id : null);
    
    return rawPedidos.reduce((sum, p) => {
      if (p.tipo === 'pedido' && !p.cargadoACuenta) {
        const matchMesa = mId && String(p.mesaId) === String(mId);
        const matchCliente = p.cliente && c.cliente && p.cliente.toLowerCase() === c.cliente.toLowerCase();
        if (matchMesa || matchCliente) {
          return sum + (p.total || 0);
        }
      }
      return sum;
    }, 0);
  };

  const getTodosConsumos = (c) => {
    const todos = c.consumos ? c.consumos.map(item => ({ ...item })) : [];
    const mesaAsociada = findMesaAsociada(c);
    const mId = c.mesaId || (mesaAsociada ? mesaAsociada.id : null);

    rawPedidos.forEach(p => {
      if (p.tipo === 'pedido' && !p.cargadoACuenta) {
        const matchMesa = mId && String(p.mesaId) === String(mId);
        const matchCliente = p.cliente && c.cliente && p.cliente.toLowerCase() === c.cliente.toLowerCase();
        if (matchMesa || matchCliente) {
          (p.items || []).forEach(item => {
            const existe = todos.find(i => 
              (item.productoId && i.productoId === item.productoId) ||
              i.producto.toLowerCase() === item.nombre.toLowerCase()
            );
            if (existe) {
              existe.cantidad += item.cantidad;
            } else {
              todos.push({
                producto: item.nombre,
                precio: item.precio,
                cantidad: item.cantidad,
                unloaded: true
              });
            }
          });
        }
      }
    });
    return todos;
  };

  const [nuevoClienteNombre, setNuevoClienteNombre] = useState('');

  const [isOffline, setIsOffline] = useState(false);

  const sincronizarAlertasOffline = async () => {
    if (typeof window === 'undefined') return;
    const stored = localStorage.getItem('yoy_pending_waiter_alerts');
    if (!stored) return;
    try {
      const pending = JSON.parse(stored);
      if (pending && pending.length > 0) {
        showToast(`Sincronizando ${pending.length} alerta(s) guardadas sin conexión...`, 'info');
        for (const alerta of pending) {
          await addDoc(collection(db, 'mesa_pedidos'), {
            ...alerta,
            createdAt: serverTimestamp()
          });
        }
        localStorage.removeItem('yoy_pending_waiter_alerts');
        showToast('¡Alertas offline sincronizadas con éxito! ✓', 'success');
      }
    } catch (err) {
      console.error("Error al sincronizar alertas offline:", err);
    }
  };

  const sincronizarEntregasOffline = async () => {
    if (typeof window === 'undefined') return;
    const stored = localStorage.getItem('yoy_pending_deliveries');
    if (!stored) return;
    try {
      const pending = JSON.parse(stored);
      if (pending && pending.length > 0) {
        showToast(`Sincronizando ${pending.length} entrega(s) sin conexión...`, 'info');
        for (const entrega of pending) {
          const docRef = doc(db, 'mesa_pedidos', entrega.id);
          const updateData = {
            atendidoMesero: true,
            updatedAt: serverTimestamp(),
          };
          if (entrega.tipo !== 'pedido') {
            updateData.estado = 'atendido';
            updateData.atendidoAt = serverTimestamp();
          } else {
            if (['listo', 'en_camino'].includes(entrega.estado)) {
              updateData.estado = 'entregado';
              updateData.entregadoAt = serverTimestamp();
            }
          }
          await updateDoc(docRef, updateData);

          // Crear bitacora_servicio
          const bitacoraRef = doc(collection(db, 'bitacora_servicio'));
          await setDoc(bitacoraRef, {
            pedidoId: entrega.id,
            mesaId: entrega.mesaId || '',
            cliente: entrega.cliente || '',
            meseroId: user?.uid || 'desconocido',
            meseroNombre: user?.nombre || user?.name || 'Mesero',
            minutosRetraso: entrega.minutosRetraso || 0,
            entregadoAt: serverTimestamp(),
            createdAt: serverTimestamp(),
            salonId: getActiveSalonId(),
            offlineSincronizado: true
          });
        }
        localStorage.removeItem('yoy_pending_deliveries');
        showToast('¡Entregas offline sincronizadas con éxito! ✓', 'success');
      }
    } catch (err) {
      console.error("Error al sincronizar entregas offline:", err);
    }
  };

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setIsOffline(!navigator.onLine);
      const handleOnline = () => {
        setIsOffline(false);
        sincronizarAlertasOffline();
        sincronizarEntregasOffline();
      };
      const handleOffline = () => setIsOffline(true);
      window.addEventListener('online', handleOnline);
      window.addEventListener('offline', handleOffline);
      return () => {
        window.removeEventListener('online', handleOnline);
        window.removeEventListener('offline', handleOffline);
      };
    }
  }, []);

  useEffect(() => {
    if (typeof window !== 'undefined' && navigator.onLine) {
      sincronizarAlertasOffline();
      sincronizarEntregasOffline();
    }
  }, []);

  const handleCloseCapturarModal = () => {
    if (Object.keys(capturaCarrito).length > 0) {
      sessionStorage.setItem('yoy_draft_mesero_carrito', JSON.stringify({ capturaMesaId, capturaCarrito }));
    }
    setIsClosing(true);
    setTimeout(() => {
      setShowCapturarModal(false);
      setIsClosing(false);
      setCapturaCarrito({});
    }, 150);
  };

  useEffect(() => {
    if (showCapturarModal) {
      const draft = sessionStorage.getItem('yoy_draft_mesero_carrito');
      if (draft) {
        try {
          const parsed = JSON.parse(draft);
          if (parsed.capturaCarrito && Object.keys(parsed.capturaCarrito).length > 0) {
            setCapturaMesaId(parsed.capturaMesaId);
            setCapturaCarrito(parsed.capturaCarrito);
          }
          sessionStorage.removeItem('yoy_draft_mesero_carrito');
        } catch (e) {}
      }
    }
  }, [showCapturarModal]);

  // Escuchar mesas y cuentas en tiempo real
  useEffect(() => {
    const unsubMesas = onSnapshot(doc(db, 'config', 'mesas_estado'), snap => {
      if (snap.exists()) {
        setMesas(snap.data().mesas || []);
      }
    });
    const unsubCuentas = onSnapshot(doc(db, 'config', 'cuentas_estado'), snap => {
      if (snap.exists()) {
        setCuentas(snap.data().cuentas || []);
      }
    });
    const unsubExtras = onSnapshot(doc(db, 'config', 'renta_extras'), snap => {
      if (snap.exists()) {
        setRentaExtras(snap.data().extras || []);
      }
    });
    return () => {
      unsubMesas();
      unsubCuentas();
      unsubExtras();
    };
  }, []);

  // Inicializar select con la primera opción disponible
  useEffect(() => {
    if (showCapturarModal) {
      const activeMesas = mesas.filter(m => m.estado === 'ocupada');
      const activeCuentas = cuentas.filter(c => 
        !activeMesas.some(m => m.cliente && m.cliente.toLowerCase() === c.cliente.toLowerCase())
      );
      
      if (activeMesas.length > 0) {
        setCapturaMesaId(`mesa_${activeMesas[0].id}`);
      } else if (activeCuentas.length > 0) {
        setCapturaMesaId(`cuenta_${activeCuentas[0].id}`);
      } else {
        setCapturaMesaId('nueva_cuenta');
      }
    }
  }, [showCapturarModal, mesas, cuentas]);
  
  // Alertas de asistencia activa para ventana emergente
  const [alertasAsistencia, setAlertasAsistencia] = useState([]);

  const [queryEmpleado, setQueryEmpleado] = useState(null);

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const queryId = urlParams.get('empleadoId');
    if (queryId) {
      if (queryId === 'sin_mesero') {
        setQueryEmpleado({ id: 'sin_mesero', nombre: 'Sin Mesero', alias: 'Sin Mesero' });
      } else {
        getDoc(doc(db, 'nomina_empleados', queryId)).then(snap => {
          if (snap.exists()) {
            setQueryEmpleado({ id: snap.id, ...snap.data() });
          }
        });
      }
    } else {
      setQueryEmpleado(null);
    }
  }, [user]);

  const activeFilterId = useMemo(() => {
    if (!user) return null;
    const rolLower = (user.role || '').toLowerCase();
    const isStaff = rolLower.includes('admin') || rolLower.includes('cajero') || rolLower.includes('caja') || rolLower.includes('gerente') || rolLower.includes('tecnico') || user.isFreeAccess;

    const urlParams = new URLSearchParams(window.location.search);
    const queryId = urlParams.get('empleadoId');

    if (isStaff) {
      if (!queryId || queryId === 'todos') {
        return 'todos';
      }
      return queryId;
    } else {
      return user.uid;
    }
  }, [user]);

  const displayTitle = useMemo(() => {
    if (activeFilterId === 'todos') {
      return 'Todos los Meseros';
    }
    if (activeFilterId === 'sin_mesero') {
      return 'Mesas Sin Mesero';
    }
    if (queryEmpleado) {
      return `Vista Mesero · ${queryEmpleado.alias || queryEmpleado.nombre}`;
    }
    return `Vista Mesero · ${user?.alias || user?.name?.split(' ')[0] || ''}`;
  }, [activeFilterId, queryEmpleado, user]);

  const mesasRef = useRef(mesas);
  useEffect(() => {
    mesasRef.current = mesas;
  }, [mesas]);

  const isAlertaParaMi = (alerta) => {
    if (!activeFilterId) return false;
    
    // Si queremos ver todos los meseros
    if (activeFilterId === 'todos') return true;

    // Si queremos ver sin mesero asignado
    if (activeFilterId === 'sin_mesero') {
      const hasMesero = alerta.meseroId || (alerta.meseroIds && alerta.meseroIds.length > 0);
      if (hasMesero) return false;
      if (alerta.mesaId) {
        const mesaAsoc = mesasRef.current?.find(m => String(m.id) === String(alerta.mesaId));
        if (mesaAsoc) {
          const mesaHasMesero = mesaAsoc.meseroId || (mesaAsoc.meseroIds && mesaAsoc.meseroIds.length > 0);
          if (mesaHasMesero) return false;
        }
      }
      return true;
    }
    
    // 1. Si la comanda/alerta tiene un meseroId explícito o arreglo meseroIds
    if (alerta.meseroId && alerta.meseroId === activeFilterId) {
      return true;
    }
    if (alerta.meseroIds && Array.isArray(alerta.meseroIds) && alerta.meseroIds.includes(activeFilterId)) {
      return true;
    }
    
    // 2. Si está asociada a una mesa
    if (alerta.mesaId) {
      const mesaAsoc = mesasRef.current?.find(m => String(m.id) === String(alerta.mesaId));
      if (mesaAsoc) {
        const isAssigned = 
          (mesaAsoc.meseroId && mesaAsoc.meseroId === activeFilterId) ||
          (mesaAsoc.meseroIds && Array.isArray(mesaAsoc.meseroIds) && mesaAsoc.meseroIds.includes(activeFilterId));
        
        if (isAssigned) return true;
        
        // Si la mesa tiene meseros asignados y yo no soy uno de ellos, no es para mí
        const tieneAsignados = mesaAsoc.meseroId || (mesaAsoc.meseroIds && mesaAsoc.meseroIds.length > 0);
        if (tieneAsignados) return false;
      }
    }
    
    // 3. De lo contrario, es una alerta general (por ejemplo, "Para Llevar" sin mesero o asistencia general), notificar a todos
    return true;
  };

  const alertasAsistenciaParaMi = alertasAsistencia.filter(isAlertaParaMi);

  const prevAlertasCountRef = useRef(0);
  const notifiedAssistIds = useRef(new Set());
  useEffect(() => {
    if (alertasAsistenciaParaMi.length > prevAlertasCountRef.current) {
      setShowAsistenciaModal(true);
    } else if (alertasAsistenciaParaMi.length === 0) {
      setShowAsistenciaModal(false);
    }
    prevAlertasCountRef.current = alertasAsistenciaParaMi.length;
  }, [alertasAsistenciaParaMi.length]);

  // Estados para el panel de Cuentas Activas integrado
  const [permissionStatus, setPermissionStatus] = useState('default');

  useEffect(() => {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      setPermissionStatus(Notification.permission);
    }
  }, []);

  const solicitarPermisoNotificaciones = async () => {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      const permission = await Notification.requestPermission();
      setPermissionStatus(permission);
    }
  };

  const [expandedIds, setExpandedIds] = useState({});
  const [filtroMesaTexto, setFiltroMesaTexto] = useState('');
  const [verSoloMisMesas, setVerSoloMisMesas] = useState(false);
  const [filtroCuentaTexto, setFiltroCuentaTexto] = useState('');
  const [tick, setTick] = useState(0);
  const [loadingCuentaId, setLoadingCuentaId] = useState(null);
  const [localRequestedCuentas, setLocalRequestedCuentas] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('yoy_local_requested_cuentas');
      return saved ? JSON.parse(saved) : {};
    }
    return {};
  });

  // Limpiar caché local de cobros solicitados si la cuenta ya no está activa
  useEffect(() => {
    setLocalRequestedCuentas(prev => {
      let changed = false;
      const next = { ...prev };
      Object.keys(next).forEach(clienteKey => {
        const existeEnActivas = getCuentasActivasUnificadas().some(c => c.cliente.toLowerCase() === clienteKey);
        if (!existeEnActivas) {
          delete next[clienteKey];
          changed = true;
        }
      });
      if (changed) {
        localStorage.setItem('yoy_local_requested_cuentas', JSON.stringify(next));
        return next;
      }
      return prev;
    });
  }, [cuentas, mesas]);

  // Alerta háptica sutil al detectar alertas pendientes
  useEffect(() => {
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      const tieneAlertasAsistenciaPantalla = (alertasAsistenciaParaMi || []).some(alerta => 
        !alerta.atendidoMesero
      );
      if (tieneAlertasAsistenciaPantalla) {
        navigator.vibrate([100, 50, 100]);
      }
    }
  }, [alertasAsistenciaParaMi.length]);

  useEffect(() => {
    const interval = setInterval(() => {
      setTick(t => t + 1);
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  // ── Tiempo transcurrido desde creación ──────────────────
  const tiempoTranscurrido = (fecha) => {
    if (!fecha?.toDate) return '—';
    const seg = Math.floor((Date.now() - fecha.toDate().getTime()) / 1000);
    if (seg < 60) return `${seg}s`;
    if (seg < 3600) return `${Math.floor(seg / 60)}min`;
    return `${Math.floor(seg / 3600)}h`;
  };

  // Solicitar permiso de notificaciones nativas del sistema
  useEffect(() => {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      if (Notification.permission === 'default') {
        Notification.requestPermission();
      }
    }
  }, []);

  // ── Cargar productos de BarPanel en tiempo real desde Firestore ──
  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'config', 'inventario'), snap => {
      if (snap.exists()) {
        const prods = snap.data().productos || [];
        setProductosBar(prods.filter(p => p.stock > 0));
      } else {
        // Fallback: productos por defecto
        setProductosBar([
          { id: 1, nombre: 'Cerveza Corona Extra', categoria: 'Cerveza', precioVenta: 45, stock: 0 },
          { id: 2, nombre: 'Coca-Cola 355ml', categoria: 'Refresco', precioVenta: 30, stock: 0 },
          { id: 3, nombre: 'Nachos con Queso', categoria: 'Snack', precioVenta: 75, stock: 0 },
          { id: 4, nombre: 'Alitas de Pollo x10', categoria: 'Comida', precioVenta: 120, stock: 0 },
          { id: 5, nombre: 'Agua 600ml', categoria: 'Bebida', precioVenta: 20, stock: 0 },
          { id: 6, nombre: 'Café Americano', categoria: 'Bebida', precioVenta: 35, stock: 0 },
        ]);
      }
    }, err => {
      console.warn('Error al cargar inventario de bar en vista mesero:', err);
    });
    return unsub;
  }, []);

  // ── Suscripción a pedidos activos ────────────────────────
  const [listosNotificados, setListosNotificados] = useState(new Set());

  useEffect(() => {
    const q = query(
      collection(db, 'mesa_pedidos'),
      where('estado', 'in', ['pendiente', 'listo', 'en_camino', 'entregado'])
    );
    const unsub = onSnapshot(q, snap => {
      const items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      items.sort((a, b) => {
        const tA = a.createdAt?.toDate ? a.createdAt.toDate().getTime() : (a.createdAt || 0);
        const tB = b.createdAt?.toDate ? b.createdAt.toDate().getTime() : (b.createdAt || 0);
        return tB - tA;
      });
      setRawPedidos(items);
      const filtered = items.filter(p => !p.atendidoMesero);
      setPedidos(filtered);

      // 1. Detectar si hay algún pedido recién puesto en 'listo'
      let nuevoListoDetectado = false;
      const nuevosListos = new Set(listosNotificados);
      
      items.forEach(item => {
        if (item.estado === 'listo' && !listosNotificados.has(item.id)) {
          nuevoListoDetectado = true;
          nuevosListos.add(item.id);
        }
      });

      if (nuevoListoDetectado) {
        setListosNotificados(nuevosListos);
        // Reproducir sonido especial de campana de cocina (high-low double chime)
        try {
          const ctx = new (window.AudioContext || window.webkitAudioContext)();
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.connect(gain); gain.connect(ctx.destination);
          osc.frequency.setValueAtTime(1200.00, ctx.currentTime); // D#6 - Tono alto de campana
          gain.gain.setValueAtTime(0.9, ctx.currentTime);
          osc.start(); osc.stop(ctx.currentTime + 0.12);
          setTimeout(() => {
            const osc2 = ctx.createOscillator();
            const gain2 = ctx.createGain();
            osc2.connect(gain2); gain2.connect(ctx.destination);
            osc2.frequency.setValueAtTime(1500.00, ctx.currentTime); // G6 - Tono campanilla
            gain2.gain.setValueAtTime(0.9, ctx.currentTime);
            osc2.start(); osc2.stop(ctx.currentTime + 0.3);
          }, 120);

          // Disparar notificación del sistema también si está en background
          if (typeof window !== 'undefined' && document.hidden && Notification.permission === 'granted') {
            new Notification(`🍳 ¡Pedido Listo en Cocina!`, {
              body: `El pedido de la Mesa ha sido preparado.`,
              icon: '/icon.png'
            });
          }
        } catch { /* sin audio */ }
      }

      // 2. Sonido de alerta sutil en nuevos pedidos/cambios ordinarios (solo si no se disparó el de 'listo')
      if (!nuevoListoDetectado && sonido && items.length > ultimoCount && ultimoCount > 0) {
        try {
          const ctx = new (window.AudioContext || window.webkitAudioContext)();
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.connect(gain); gain.connect(ctx.destination);
          osc.frequency.value = 880; gain.gain.value = 0.9;
          osc.start(); osc.stop(ctx.currentTime + 0.2);
          setTimeout(() => { osc.frequency.value = 1100; osc.start(ctx.currentTime + 0.25); osc.stop(ctx.currentTime + 0.45); }, 250);
        } catch { /* sin audio */ }
      }
      setUltimoCount(items.length);
    }, err => {
      console.warn("Error en onSnapshot de pedidos (mesero):", err);
    });
    return unsub;
  }, [sonido, ultimoCount, listosNotificados]);

  // ── Suscripción a asistencias pendientes (Alertas Emergentes) ──
  useEffect(() => {
    const q = query(
      collection(db, 'mesa_pedidos'),
      where('estado', 'in', ['pendiente', 'listo', 'en_camino', 'entregado'])
    );
    const unsub = onSnapshot(q, snap => {
      const items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      const filtered = items.filter(alerta => 
        ['asistencia', 'cuenta', 'pedido'].includes(alerta.tipo) && !alerta.atendidoMesero
      );
      setAlertasAsistencia(filtered);

      // Si la app está en segundo plano y llega nueva alerta, disparar Web Notification
      const unattendedForMe = filtered.filter(isAlertaParaMi);
      unattendedForMe.sort((a, b) => {
        const tA = a.createdAt?.toDate ? a.createdAt.toDate().getTime() : (a.createdAt || 0);
        const tB = b.createdAt?.toDate ? b.createdAt.toDate().getTime() : (b.createdAt || 0);
        return tB - tA;
      });

      if (unattendedForMe.length > 0 && typeof window !== 'undefined' && document.hidden) {
        const masReciente = unattendedForMe[0];
        if (Notification.permission === 'granted' && !notifiedAssistIds.current.has(masReciente.id)) {
          // Mantener el Set por debajo de 100 elementos (FIFO) para evitar acumulación en memoria
          if (notifiedAssistIds.current.size >= 100) {
            const oldestId = notifiedAssistIds.current.values().next().value;
            if (oldestId) {
              notifiedAssistIds.current.delete(oldestId);
            }
          }
          notifiedAssistIds.current.add(masReciente.id);
          new Notification(`🚨 Mesa ${masReciente.mesaId} - ${masReciente.etiqueta || 'Nuevo Pedido'}`, {
            body: `El cliente solicita: ${masReciente.etiqueta || 'Preparación de consumos'}`,
            icon: '/icon.png',
            silent: false
          });
        }
      }
    }, err => {
      console.warn("Error en onSnapshot de alertasAsistencia (mesero):", err);
    });
    return unsub;
  }, []);

  // ── Alarma sonora periódica para asistencias pendientes ──
  useEffect(() => {
    if (!sonido || alertasAsistenciaParaMi.length === 0) return;

    const tieneDemorado = alertasAsistenciaParaMi.some(alerta => {
      if (alerta.tipo !== 'pedido' || alerta.estado !== 'listo') return false;
      const listoAt = alerta.cocinaAtendidoAt?.toDate 
        ? alerta.cocinaAtendidoAt.toDate().getTime() 
        : (alerta.cocinaAtendidoAt || 0);
      if (!listoAt) return false;
      return (Date.now() - listoAt) > 5 * 60 * 1000;
    });
    
    const sonarAlerta = () => {
      try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        
        if (tieneDemorado) {
          // Sonido de alerta urgente (tres tonos agudos rápidos)
          const playTono = (freq, startOffset, duration) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain); gain.connect(ctx.destination);
            osc.frequency.setValueAtTime(freq, ctx.currentTime + startOffset);
            gain.gain.setValueAtTime(0.7, ctx.currentTime + startOffset);
            osc.start(ctx.currentTime + startOffset);
            osc.stop(ctx.currentTime + startOffset + duration);
          };
          playTono(987.77, 0, 0.08); // B5
          playTono(987.77, 0.1, 0.08); // B5
          playTono(1318.51, 0.2, 0.15); // E6 (alarma urgente)

          if (typeof navigator !== 'undefined' && navigator.vibrate) {
            navigator.vibrate([100, 50, 100, 50, 150]);
          }
        } else {
          // Sonido normal
          const osc1 = ctx.createOscillator();
          const gain1 = ctx.createGain();
          osc1.connect(gain1); gain1.connect(ctx.destination);
          osc1.frequency.value = 660; gain1.gain.value = 0.9;
          osc1.start();
          osc1.stop(ctx.currentTime + 0.15);
          
          setTimeout(() => {
            const osc2 = ctx.createOscillator();
            const gain2 = ctx.createGain();
            osc2.connect(gain2); gain2.connect(ctx.destination);
            osc2.frequency.value = 880; gain2.gain.value = 0.9;
            osc2.start();
            osc2.stop(ctx.currentTime + 0.3);
          }, 180);

          if (typeof navigator !== 'undefined' && navigator.vibrate) {
            navigator.vibrate([150, 100, 150]);
          }
        }
      } catch { /* sin audio */ }
    };

    sonarAlerta();
    const intervalTime = tieneDemorado ? 2500 : 4000;
    const t = setInterval(sonarAlerta, intervalTime);
    return () => clearInterval(t);
  }, [sonido, alertasAsistenciaParaMi, alertasAsistenciaParaMi.length]);

  // ── Autolimpieza de Alertas Huérfanas (> 6 horas) ──
  useEffect(() => {
    const limpiarHuerfanas = async () => {
      try {
        const ahora = Date.now();
        const limiteSeisHoras = ahora - (6 * 60 * 60 * 1000); // 6 horas
        
        const q = query(
          collection(db, 'mesa_pedidos'),
          where('estado', 'in', ['pendiente', 'listo', 'en_camino', 'entregado'])
        );
        const snap = await getDocs(q);
        const batch = writeBatch(db);
        let count = 0;
        
        snap.forEach(d => {
          const data = d.data();
          if (['asistencia', 'cuenta'].includes(data.tipo)) {
            const createdAtMs = data.createdAt?.toDate ? data.createdAt.toDate().getTime() : (data.createdAt || 0);
            if (createdAtMs > 0 && createdAtMs < limiteSeisHoras) {
              const docRef = doc(db, 'mesa_pedidos', d.id);
              batch.update(docRef, {
                atendidoMesero: true,
                estado: 'atendido',
                atendidoAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
                autoLimpiado: true
              });
              count++;
            }
          }
        });
        
        if (count > 0) {
          await batch.commit();
          console.log(`[AutoLimpieza] Se archivaron automáticamente ${count} alertas huérfanas.`);
        }
      } catch (e) {
        console.error("Error en autolimpieza de alertas:", e);
      }
    };

    limpiarHuerfanas();
    const interval = setInterval(limpiarHuerfanas, 15 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  // Escuchar tecla Escape para cerrar modal de captura de venta con control de cooldown, desenfoque y confirmación
  useEffect(() => {
    let lastBlurTime = 0;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && showCapturarModal) {
        const now = Date.now();
        if (document.activeElement && 
            (document.activeElement.tagName === 'INPUT' || 
             document.activeElement.tagName === 'SELECT' || 
             document.activeElement.tagName === 'TEXTAREA')) {
          e.preventDefault();
          const activeEl = document.activeElement;
          activeEl.blur();
          
          // Efecto visual: resplandor dorado momentáneo
          const originalTransition = activeEl.style.transition;
          const originalBoxShadow = activeEl.style.boxShadow;
          activeEl.style.transition = 'box-shadow 0.2s ease';
          activeEl.style.boxShadow = '0 0 10px var(--bronze-light, #c5a880)';
          setTimeout(() => {
            activeEl.style.boxShadow = originalBoxShadow;
            setTimeout(() => {
              activeEl.style.transition = originalTransition;
            }, 200);
          }, 300);
          
          lastBlurTime = now;
          return;
        }

        if (now - lastBlurTime < 300) {
          return;
        }

        if (Object.keys(capturaCarrito).length > 0) {
          if (!window.confirm('¿Deseas salir? Perderás los artículos agregados a la venta.')) {
            return;
          }
        }
        handleCloseCapturarModal();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showCapturarModal, capturaCarrito, handleCloseCapturarModal]);

  const handleEnviarAvisoOtroMesero = async () => {
    if (!alertaDestinatarioId) {
      showToast('Selecciona un mesero para avisar.', 'warning');
      return;
    }
    if (!alertaMesaId) {
      showToast('Selecciona una mesa.', 'warning');
      return;
    }

    const destinatario = todosLosMeseros.find(m => m.id === alertaDestinatarioId);
    const mesa = mesas.find(m => m.id === parseInt(alertaMesaId));

    try {
      await addDoc(collection(db, 'mesa_pedidos'), {
        mesaId: String(alertaMesaId),
        cliente: 'Te llaman para asistir en esta mesa.',
        etiqueta: `Llamado de Mesero (por ${user?.nombre || user?.name || 'compañero'})`,
        tipo: 'asistencia',
        icono: '📢',
        estado: 'pendiente',
        atendidoMesero: false,
        meseroId: alertaDestinatarioId,
        creadoPorNombre: user?.nombre || user?.name || 'Mesero',
        createdAt: serverTimestamp()
      });

      showToast('Aviso enviado con éxito.', 'success');
      setShowModalAvisarMesero(false);
      setAlertaDestinatarioId('');
      setAlertaMesaId('');
    } catch (err) {
      console.error("Error al enviar aviso a otro mesero:", err);
      showToast('Error al enviar aviso: ' + err.message, 'error');
    }
  };

  // ── Acciones del mesero ───────────────────────────────────
  const marcarEnCamino = async (id) => {
    await updateDoc(doc(db, 'mesa_pedidos', id), {
      estado: 'en_camino',
      atendidoMesero: true, // Cerrar automáticamente la ventana emergente de listo
      meseroId: user?.uid || 'mesero',
      updatedAt: serverTimestamp(),
    });
  };

  const marcarEntregado = async (id) => {
    try {
      const docRef = doc(db, 'mesa_pedidos', id);
      const snap = await getDoc(docRef);
      if (snap.exists()) {
        const updateData = {
          atendidoMesero: true,
          entregadoAt: serverTimestamp(), // Registrar hora de entrega para auditoría de tiempos
          updatedAt: serverTimestamp(),
          estado: 'entregado'
        };
        await updateDoc(docRef, updateData);
      }
    } catch (e) {
      console.error("Error al marcar entregado:", e);
    }
  };

  const marcarAtendido = async (id, tipo, estado) => {
    // Optimistic local state update to dismiss the alert immediately in the UI
    setAlertasAsistencia(prev => prev.filter(alerta => alerta.id !== id));
    setLoadingAlertaId(id);

    // Obtener información adicional de la alerta si la tenemos en el estado actual para la bitácora
    const alertaEnCache = alertasAsistencia.find(a => a.id === id);
    const mesaId = alertaEnCache?.mesaId || '';
    const cliente = alertaEnCache?.cliente || '';
    const cocinaAtendidoAtMs = alertaEnCache?.cocinaAtendidoAt?.toDate 
      ? alertaEnCache.cocinaAtendidoAt.toDate().getTime() 
      : (alertaEnCache?.cocinaAtendidoAt || Date.now());
    const minutosRetraso = Math.max(0, Math.round((Date.now() - cocinaAtendidoAtMs) / 60000));

    try {
      const docRef = doc(db, 'mesa_pedidos', id);
      const updateData = {
        atendidoMesero: true,
        updatedAt: serverTimestamp(),
      };
      // Solo archivar si no es un pedido (ya que el pedido debe seguir en cocina/entrega)
      if (tipo !== 'pedido') {
        updateData.estado = 'atendido';
        updateData.atendidoAt = serverTimestamp();
      } else {
        // Si el pedido está listo o en camino, el mesero lo entrega
        if (['listo', 'en_camino'].includes(estado)) {
          updateData.estado = 'entregado';
          updateData.entregadoAt = serverTimestamp();
        }
      }

      if (navigator.onLine) {
        // Enviar online
        await updateDoc(docRef, updateData);

        // Crear bitacora_servicio
        const bitacoraRef = doc(collection(db, 'bitacora_servicio'));
        await setDoc(bitacoraRef, {
          pedidoId: id,
          mesaId,
          cliente,
          meseroId: user?.uid || 'desconocido',
          meseroNombre: user?.nombre || user?.name || 'Mesero',
          minutosRetraso,
          entregadoAt: serverTimestamp(),
          createdAt: serverTimestamp(),
          salonId: getActiveSalonId()
        });
        showToast('Solicitud atendida ✓', 'success');
      } else {
        // Forzar error offline para caer en catch
        throw new Error("offline");
      }

      // Haptic feedback confirmation for mobile devices
      if (typeof window !== 'undefined' && navigator.vibrate) {
        navigator.vibrate([50, 30, 50]);
      }
    } catch (e) {
      console.warn("Fallo en envío online (o modo offline). Guardando en caché offline...", e);

      const rawQueue = localStorage.getItem('yoy_pending_deliveries') || '[]';
      const queue = JSON.parse(rawQueue);
      queue.push({
        id,
        tipo,
        estado,
        mesaId,
        cliente,
        minutosRetraso,
        timestamp: Date.now()
      });
      localStorage.setItem('yoy_pending_deliveries', JSON.stringify(queue));

      showToast('Entrega guardada localmente (Modo Offline) ✓', 'warning');

      if (typeof window !== 'undefined' && navigator.vibrate) {
        navigator.vibrate([100, 50, 100]);
      }
    } finally {
      setLoadingAlertaId(null);
    }
  };

  const modificarCapturaCarrito = (prodId, delta) => {
    setCapturaCarrito(prev => {
      const actual = prev[prodId] || 0;
      const nuevo = Math.max(0, actual + delta);
      if (nuevo === 0) {
        const { [prodId]: _, ...rest } = prev;
        return rest;
      }
      return { ...prev, [prodId]: nuevo };
    });
  };

  const guardarCapturaVenta = async () => {
    const items = Object.entries(capturaCarrito).map(([id, cant]) => {
      const prod = productosBar.find(p => p.id === parseInt(id));
      return {
        productoId: parseInt(id),
        nombre: prod?.nombre,
        precio: prod?.precioVenta,
        cantidad: cant,
        subtotal: (prod?.precioVenta || 0) * cant
      };
    });
    
    if (items.length === 0) return alert('Selecciona al menos un producto');
    const totalOrder = items.reduce((sum, item) => sum + item.subtotal, 0);

    let targetMesaId = 0;
    let targetCliente = '';
    
    if (capturaMesaId.startsWith('mesa_')) {
      const mId = parseInt(capturaMesaId.replace('mesa_', ''));
      targetMesaId = mId;
      const mesaObj = mesas.find(m => m.id === mId);
      targetCliente = mesaObj ? mesaObj.cliente : `Mesa ${mId}`;
    } else if (capturaMesaId.startsWith('cuenta_')) {
      const cId = parseFloat(capturaMesaId.replace('cuenta_', ''));
      targetMesaId = 0;
      const cuentaObj = cuentas.find(c => c.id === cId);
      targetCliente = cuentaObj ? cuentaObj.cliente : `Cliente`;
    } else if (capturaMesaId === 'nueva_cuenta') {
      if (!nuevoClienteNombre.trim()) {
        alert('Por favor escribe el nombre del cliente para la nueva cuenta');
        return;
      }
      targetMesaId = 0;
      targetCliente = nuevoClienteNombre.trim();
    } else {
      targetMesaId = parseInt(capturaMesaId) || 0;
      targetCliente = `Mesa ${targetMesaId}`;
    }

    try {
      await addDoc(collection(db, 'mesa_pedidos'), {
        mesaId: targetMesaId,
        cliente: targetCliente,
        items,
        total: totalOrder,
        estado: 'pendiente',
        tipo: 'pedido',
        origen: 'mesero_captura',
        atendidoAdmin: false,
        atendidoMesero: false,
        meseroId: user?.uid || null,
        meseroNombre: user?.nombre || user?.name || null,
        createdAt: serverTimestamp(),
      });
      
      setCapturaCarrito({});
      setNuevoClienteNombre('');
      setShowCapturarModal(false);
      alert(`Venta registrada exitosamente para ${targetMesaId ? `Mesa ${targetMesaId}` : targetCliente} ✅`);
    } catch (e) {
      alert('Error al capturar venta: ' + e.message);
    }
  };

  const pedirCuenta = async (cuenta) => {
    setLoadingCuentaId(cuenta.id);
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      navigator.vibrate(50);
    }
    const mesaAsociada = findMesaAsociada(cuenta);
    const mesaId = mesaAsociada ? mesaAsociada.id : 0;
    const consumosTotal = cuenta.consumos.reduce((sum, item) => sum + item.precio * item.cantidad, 0) + getUnloadedConsumosForCuenta(cuenta);
    const costoTiempo = (mesaAsociada && mesaAsociada.estado === 'ocupada')
      ? (mesaAsociada.socios ? 0 : calcCosto(mesaAsociada, rentaExtras))
      : (cuenta.tiempoJuego || 0);
    const totalAcumulado = costoTiempo + consumosTotal;

    const dataAlerta = {
      mesaId: mesaId,
      cliente: cuenta.cliente,
      tipo: 'cuenta',
      etiqueta: 'Solicita Cuenta (Caja)',
      estado: 'pendiente',
      totalAcumulado: totalAcumulado,
      atendidoAdmin: false,
      atendidoMesero: false
    };

    if (isOffline) {
      try {
        const stored = localStorage.getItem('yoy_pending_waiter_alerts');
        const pending = stored ? JSON.parse(stored) : [];
        const yaExiste = pending.some(alerta => 
          alerta.tipo === 'cuenta' && 
          alerta.cliente && 
          alerta.cliente.toLowerCase() === cuenta.cliente.toLowerCase()
        );
        if (!yaExiste) {
          pending.push(dataAlerta);
          localStorage.setItem('yoy_pending_waiter_alerts', JSON.stringify(pending));
        }

        setLocalRequestedCuentas(prev => {
          const next = { ...prev, [cuenta.cliente.toLowerCase()]: true };
          localStorage.setItem('yoy_local_requested_cuentas', JSON.stringify(next));
          return next;
        });

        showToast('Modo offline: Solicitud guardada localmente. Se enviará al reconectar.', 'warning');
      } catch (err) {
        console.error("Error al guardar en buffer offline:", err);
      } finally {
        setLoadingCuentaId(null);
      }
    } else {
      try {
        await addDoc(collection(db, 'mesa_pedidos'), {
          ...dataAlerta,
          createdAt: serverTimestamp()
        });

        setLocalRequestedCuentas(prev => {
          const next = { ...prev, [cuenta.cliente.toLowerCase()]: true };
          localStorage.setItem('yoy_local_requested_cuentas', JSON.stringify(next));
          return next;
        });

        showToast(`Solicitud de cuenta enviada a caja para ${cuenta.cliente} ✓`, 'success');
      } catch (err) {
        console.error(err);
        alert('Error al solicitar la cuenta: ' + err.message);
      } finally {
        setLoadingCuentaId(null);
      }
    }
  };

  const getMesasFiltradas = () => {
    let list = getCuentasActivasUnificadas().filter(c => c.mesaId || findMesaAsociada(c));
    
    if (activeFilterId && activeFilterId !== 'todos') {
      list = list.filter(c => {
        const mesaAsociada = findMesaAsociada(c);
        if (activeFilterId === 'sin_mesero') {
          return mesaAsociada && !mesaAsociada.meseroId && (!mesaAsociada.meseroIds || mesaAsociada.meseroIds.length === 0);
        }
        return mesaAsociada && (
          mesaAsociada.meseroId === activeFilterId || 
          (mesaAsociada.meseroIds && Array.isArray(mesaAsociada.meseroIds) && mesaAsociada.meseroIds.includes(activeFilterId))
        );
      });
    }

    const term = filtroMesaTexto.trim().toLowerCase();
    if (!term) return list;
    return list.filter(c => {
      const mesaAsociada = findMesaAsociada(c);
      const matchCliente = c.cliente.toLowerCase().includes(term);
      
      const numTerm = parseInt(term, 10);
      const matchMesaId = !isNaN(numTerm) && (
        (c.mesaId && String(c.mesaId) === String(numTerm)) || 
        (mesaAsociada && String(mesaAsociada.id) === String(numTerm))
      );
      
      const matchMesaText = mesaAsociada ? `mesa ${mesaAsociada.id}`.includes(term) : false;
      return matchCliente || matchMesaId || matchMesaText;
    });
  };

  const getCuentasDirectasFiltradas = () => {
    let list = getCuentasActivasUnificadas().filter(c => !c.mesaId && !findMesaAsociada(c));
    
    if (activeFilterId && activeFilterId !== 'todos') {
      list = list.filter(c => {
        if (activeFilterId === 'sin_mesero') {
          return !c.meseroId;
        }
        return c.meseroId === activeFilterId;
      });
    }

    const term = filtroCuentaTexto.trim().toLowerCase();
    if (!term) return list;
    return list.filter(c => c.cliente.toLowerCase().includes(term));
  };

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-primary)', padding: '0 0 40px' }}>

      {/* ── HEADER ─────────────────────────────────── */}
      <div style={{ background: 'var(--bg-card)', borderBottom: '1px solid var(--border-bronze)', padding: '16px 20px', position: 'sticky', top: 0, zIndex: 10 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', maxWidth: 900, margin: '0 auto' }}>
          <div>
            <h1 style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--bronze-light)', lineHeight: 1 }}>
              🎱 {displayTitle}
              {isOffline && (
                <span style={{ fontSize: 10, background: 'var(--danger)', color: '#fff', padding: '3px 8px', borderRadius: 10, fontWeight: 700, letterSpacing: 'normal' }}>
                  OFFLINE
                </span>
              )}
            </h1>
            {user && (
              <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.4)', marginTop: 4, display: 'flex', flexWrap: 'wrap', gap: '8px 12px', fontFamily: 'monospace' }}>
                <span style={{ color: 'var(--success)' }}>🏢 Salón: {getActiveSalonId()}</span>
                <span>📋 Mesas: {mesas.length}</span>
                <span>💰 Cuentas: {cuentas.length}</span>
                <span>👤 Rol: {user.role}</span>
                <span style={{ color: '#cd7f32' }}>🔑 SalonUsr: {user.salonId || 'null'}</span>
              </div>
            )}
            <p 
              onClick={() => {
                if (alertasAsistenciaParaMi.length > 0) {
                  setShowAsistenciaModal(true);
                }
              }}
              style={{ 
                fontSize: 12, 
                color: 'var(--text-muted)', 
                marginTop: 4, 
                cursor: alertasAsistenciaParaMi.length > 0 ? 'pointer' : 'default',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                userSelect: 'none',
                transition: 'all 0.15s'
              }}
              onMouseEnter={e => {
                if (alertasAsistenciaParaMi.length > 0) {
                  e.currentTarget.style.color = 'var(--bronze-light)';
                }
              }}
              onMouseLeave={e => {
                e.currentTarget.style.color = 'var(--text-muted)';
              }}
            >
              {alertasAsistenciaParaMi.length > 0
                ? <><span style={{ color: 'var(--danger)', fontWeight: 700, textDecoration: 'underline' }}>{alertasAsistenciaParaMi.length} pendiente(s)</span> · Activo <i className="ri-arrow-right-s-line" style={{ fontSize: 14 }} /></>
                : <><span style={{ color: 'var(--success)' }}>✓</span> Sin pendientes</>
              }
            </p>
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            {/* Botón Avisar a Mesero */}
            <button
              onClick={() => setShowModalAvisarMesero(true)}
              style={{
                background: 'linear-gradient(135deg, #f59e0b, #d97706)',
                border: 'none',
                borderRadius: 10,
                padding: '8px 16px',
                cursor: 'pointer',
                color: '#0d0d0f',
                fontSize: 13,
                fontWeight: 700,
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                boxShadow: '0 2px 10px rgba(245,158,11,0.3)',
                transition: 'all 0.2s',
              }}
              onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-1px)'; }}
              onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)'; }}
            >
              <i className="ri-megaphone-line" />
              Avisar Mesero
            </button>

            {/* Botón Capturar Venta */}
            <button
              onClick={() => setShowCapturarModal(true)}
              style={{
                background: 'linear-gradient(135deg, var(--bronze), var(--bronze-light))',
                border: 'none',
                borderRadius: 10,
                padding: '8px 16px',
                cursor: 'pointer',
                color: '#0d0d0f',
                fontSize: 13,
                fontWeight: 700,
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                boxShadow: '0 2px 10px rgba(205,127,50,0.3)',
                transition: 'all 0.2s',
              }}
              onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-1px)'; }}
              onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)'; }}
            >
              <i className="ri-shopping-basket-line" />
              Capturar Venta
            </button>

            {/* Sonido ON - Siempre activo en Vista Mesero */}
            <div
              title="El sonido de alertas está activado de forma permanente para no omitir solicitudes"
              style={{ background: 'var(--bg-elevated)', border: '1px solid rgba(34,197,94,0.3)', borderRadius: 10, padding: '8px 12px', color: 'var(--success)', fontSize: 13, display: 'flex', alignItems: 'center', gap: 6, cursor: 'default', userSelect: 'none' }}
            >
              <i className="ri-volume-up-line" />
              Sonido ON
            </div>

            {/* Notificaciones Push Status */}
            {permissionStatus === 'granted' ? (
              <div
                title="Notificaciones push del sistema activadas con éxito"
                style={{
                  background: 'var(--bg-elevated)',
                  border: '1px solid rgba(34,197,94,0.3)',
                  borderRadius: 10,
                  padding: '8px 12px',
                  color: 'var(--success)',
                  fontSize: 13,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  cursor: 'default',
                  userSelect: 'none'
                }}
              >
                <i className="ri-notification-3-line" />
                Push ON
              </div>
            ) : permissionStatus === 'denied' ? (
              <div
                title="Las notificaciones push están bloqueadas en este navegador. Revisa la configuración de tu navegador."
                style={{
                  background: 'var(--bg-elevated)',
                  border: '1px solid rgba(239,68,68,0.3)',
                  borderRadius: 10,
                  padding: '8px 12px',
                  color: '#ef4444',
                  fontSize: 13,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  cursor: 'help',
                  userSelect: 'none'
                }}
              >
                <i className="ri-notification-off-line" />
                Push Bloqueado
              </div>
            ) : (
              <button
                onClick={solicitarPermisoNotificaciones}
                title="Haz clic para activar las notificaciones push en este dispositivo"
                style={{
                  background: 'var(--bg-elevated)',
                  border: '1px solid rgba(234,179,8,0.4)',
                  borderRadius: 10,
                  padding: '8px 12px',
                  color: '#eab308',
                  fontSize: 13,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  cursor: 'pointer',
                  transition: 'all 0.2s'
                }}
                onMouseEnter={e => { e.currentTarget.style.background = 'rgba(234,179,8,0.08)'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'var(--bg-elevated)'; }}
              >
                <i className="ri-notification-line" />
                Activar Push
              </button>
            )}

            {/* Botón Cerrar Sesión */}
            <button
              onClick={handleLogout}
              title="Cerrar Sesión"
              style={{
                background: 'var(--bg-elevated)',
                border: '1px solid rgba(239,68,68,0.3)',
                borderRadius: 10,
                padding: '8px 12px',
                cursor: 'pointer',
                color: '#ef4444',
                fontSize: 13,
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                transition: 'all 0.2s'
              }}
              onMouseEnter={e => { e.currentTarget.style.background = 'rgba(239,68,68,0.08)'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'var(--bg-elevated)'; }}
            >
              <i className="ri-logout-box-r-line" />
              Salir
            </button>

            {/* Botón X — cerrar y volver a Mesas */}
            <button
              onClick={() => {
                window.location.href = '/';
              }}
              title="Cerrar y volver a Mesas"
              style={{
                width: 38, height: 38,
                background: 'rgba(239,68,68,0.08)',
                border: '1px solid rgba(239,68,68,0.3)',
                borderRadius: 10,
                cursor: 'pointer',
                color: '#ef4444',
                fontSize: 20,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                transition: 'all 0.2s',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = 'rgba(239,68,68,0.18)'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'rgba(239,68,68,0.08)'; }}
            >
              <i className="ri-close-line" />
            </button>
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 900, margin: '0 auto', padding: '20px 16px' }}>

        {/* CSS para animaciones, grilla responsiva y scroll */}
        <style>{`
          @keyframes wiggle {
            0%, 100% { transform: rotate(0deg); }
            15% { transform: rotate(-15deg); }
            30% { transform: rotate(12deg); }
            45% { transform: rotate(-10deg); }
            60% { transform: rotate(8deg); }
            75% { transform: rotate(-4deg); }
            90% { transform: rotate(2deg); }
          }
          .wiggle-bell {
            animation: wiggle 2s infinite ease-in-out;
            transform-origin: top center;
            display: inline-block;
          }
          .waiter-dashboard-grid {
            display: grid;
            grid-template-columns: 1.2fr 1.1fr;
            gap: 20px;
            margin-top: 10px;
            text-align: left;
          }
          @media (max-width: 768px) {
            .waiter-dashboard-grid {
              grid-template-columns: 1fr;
              gap: 20px;
            }
          }
          .section-card {
            background: var(--bg-card);
            border: 1px solid var(--border);
            border-radius: 16px;
            padding: 16px;
            display: flex;
            flex-direction: column;
            max-height: 80vh;
            overflow: hidden;
          }
          .section-header-title {
            font-size: 15px;
            font-weight: 800;
            color: var(--bronze-light);
            margin-bottom: 12px;
            display: flex;
            align-items: center;
            gap: 8px;
            border-bottom: 1px solid var(--border);
            padding-bottom: 8px;
          }
          .scrollable-list {
            overflow-y: auto;
            flex: 1;
            display: flex;
            flex-direction: column;
            gap: 8px;
          }
          @keyframes pulse-border {
            0% { border-color: #ef4444; box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.4); }
            70% { border-color: rgba(239, 68, 68, 0.5); box-shadow: 0 0 0 10px rgba(239, 68, 68, 0); }
            100% { border-color: #ef4444; box-shadow: 0 0 0 0 rgba(239, 68, 68, 0); }
          }
        `}</style>

        <div className="waiter-dashboard-grid">
          {/* ── COLUMNA 1: MESAS ACTIVAS ── */}
          <div className="section-card">
            <div className="section-header-title">
              <i className="ri-golf-ball-line" style={{ color: 'var(--bronze-light)' }} />
              Salón: Mesas Activas ({getMesasFiltradas().length})
            </div>

            {/* Buscador Interactivo Inline y Filtro de Mis Mesas */}
            <div style={{ marginBottom: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                <i className="ri-search-line" style={{ position: 'absolute', left: 10, color: 'var(--text-muted)' }} />
                <input
                  type="text"
                  placeholder="Buscar mesa..."
                  value={filtroMesaTexto}
                  onChange={e => setFiltroMesaTexto(e.target.value)}
                  style={{
                    width: '100%',
                    background: 'var(--bg-main)',
                    border: '1px solid var(--border)',
                    borderRadius: 8,
                    padding: '6px 12px 6px 32px',
                    color: '#fff',
                    fontSize: 12,
                    outline: 'none'
                  }}
                />
                {filtroMesaTexto && (
                  <button 
                    onClick={() => setFiltroMesaTexto('')}
                    style={{ position: 'absolute', right: 10, background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
                  >
                    <i className="ri-close-line" />
                  </button>
                )}
              </div>

              {/* Toggle de Mis Mesas */}
              {user && !(user.role || user.rol || '').toLowerCase().includes('mesero') && (
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    onClick={() => setVerSoloMisMesas(false)}
                    style={{
                      flex: 1,
                      background: !verSoloMisMesas ? 'rgba(197, 168, 128, 0.15)' : 'var(--bg-elevated)',
                      border: !verSoloMisMesas ? '1px solid var(--border-bronze)' : '1px solid var(--border)',
                      color: !verSoloMisMesas ? 'var(--bronze-light)' : 'var(--text-muted)',
                      borderRadius: 8,
                      padding: '6px 12px',
                      fontSize: 11,
                      fontWeight: 700,
                      cursor: 'pointer',
                      transition: 'all 0.2s'
                    }}
                  >
                    🌐 Todas las Mesas
                  </button>
                  <button
                    onClick={() => setVerSoloMisMesas(true)}
                    style={{
                      flex: 1,
                      background: verSoloMisMesas ? 'rgba(197, 168, 128, 0.15)' : 'var(--bg-elevated)',
                      border: verSoloMisMesas ? '1px solid var(--border-bronze)' : '1px solid var(--border)',
                      color: verSoloMisMesas ? 'var(--bronze-light)' : 'var(--text-muted)',
                      borderRadius: 8,
                      padding: '6px 12px',
                      fontSize: 11,
                      fontWeight: 700,
                      cursor: 'pointer',
                      transition: 'all 0.2s'
                    }}
                  >
                    🙋 Mis Mesas Asignadas
                  </button>
                </div>
              )}
            </div>

            {/* Botón de Expansión Global */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
              <button
                type="button"
                onClick={() => {
                  const filteredList = getMesasFiltradas();
                  const allExpanded = filteredList.length > 0 && filteredList.every(c => !!expandedIds[c.id]);
                  if (allExpanded) {
                    setExpandedIds({});
                  } else {
                    const next = {};
                    filteredList.forEach(c => { next[c.id] = true; });
                    setExpandedIds(next);
                  }
                }}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--bronze-light)',
                  fontSize: 11,
                  cursor: 'pointer',
                  textDecoration: 'underline',
                  padding: 0
                }}
              >
                {getMesasFiltradas().length > 0 && getMesasFiltradas().every(c => !!expandedIds[c.id]) ? 'Contraer todo ▲' : 'Expandir todo ▼'}
              </button>
            </div>

            {/* Listado de Mesas */}
            <div className="scrollable-list">
              {getMesasFiltradas().length === 0 ? (
                <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)', fontSize: 13 }}>
                  {getCuentasActivasUnificadas().filter(c => c.mesaId || findMesaAsociada(c)).length === 0 ? 'No hay mesas activas.' : 'No se encontraron resultados.'}
                </div>
              ) : (
                getMesasFiltradas().map(c => {
                  const mesaAsociada = findMesaAsociada(c);
                  const consumosTotal = c.consumos.reduce((sum, item) => sum + item.precio * item.cantidad, 0) + getUnloadedConsumosForCuenta(c);
                  const costoTiempo = (mesaAsociada && mesaAsociada.estado === 'ocupada')
                    ? (mesaAsociada.socios ? 0 : calcCosto(mesaAsociada, rentaExtras))
                    : (c.tiempoJuego || 0);
                  const total = costoTiempo + consumosTotal;
                  const isExpanded = !!expandedIds[c.id];

                  const cuentaSolicitada = (alertasAsistenciaParaMi || []).some(alerta => 
                    alerta.tipo === 'cuenta' && 
                    alerta.cliente && 
                    alerta.cliente.toLowerCase() === c.cliente.toLowerCase()
                  ) || !!localRequestedCuentas[c.cliente.toLowerCase()];

                  const displayClienteName = c.mesaId 
                    ? (c.cliente && (normalizeText(c.cliente).startsWith('mesa ') || ['publico'].includes(normalizeText(c.cliente))) ? `Mesa ${c.mesaId}` : c.cliente)
                    : (mesaAsociada ? (c.cliente && (normalizeText(c.cliente).startsWith('mesa ') || ['publico'].includes(normalizeText(c.cliente))) ? `Mesa ${mesaAsociada.id}` : c.cliente) : c.cliente);

                  const tieneAsistenciaPendiente = (alertasAsistenciaParaMi || []).some(alerta => 
                    !alerta.atendidoMesero &&
                    (
                      (c.mesaId && String(alerta.mesaId) === String(c.mesaId)) ||
                      (alerta.cliente && c.cliente && alerta.cliente.toLowerCase() === c.cliente.toLowerCase())
                    )
                  );

                  return (
                    <div key={c.id} style={{
                      background: tieneAsistenciaPendiente ? 'rgba(239, 68, 68, 0.08)' : 'var(--bg-elevated)',
                      border: tieneAsistenciaPendiente ? '1px solid #ef4444' : '1px solid var(--border)',
                      boxShadow: tieneAsistenciaPendiente ? '0 0 10px rgba(239, 68, 68, 0.15)' : 'none',
                      animation: tieneAsistenciaPendiente ? 'pulse-border 2s infinite' : 'none',
                      borderRadius: 10,
                      padding: '8px 12px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 6,
                      contentVisibility: 'auto',
                      containIntrinsicSize: '0 44px'
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 800, fontSize: 13, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'flex', alignItems: 'center' }}>
                            {displayClienteName}
                            {tieneAsistenciaPendiente && (
                              <i className="ri-notification-3-fill wiggle-bell" style={{ color: 'var(--bronze-light)', marginLeft: 6, fontSize: 12, verticalAlign: 'middle' }} title="Llamada de asistencia o pedido pendiente" />
                            )}
                          </div>
                          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 1, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                            <span>📍 Mesa {c.mesaId || (mesaAsociada ? mesaAsociada.id : '—')}</span>
                            <span>·</span>
                            <span>Tiempo: ${costoTiempo}</span>
                            {((mesaAsociada?.meseroIds && mesaAsociada.meseroIds.length > 0) || mesaAsociada?.meseroNombre) && (
                              <>
                                <span>·</span>
                                <span style={{ color: 'var(--bronze-light)', fontWeight: 600 }}>
                                  👤 {(mesaAsociada.meseroIds && mesaAsociada.meseroIds.length > 0) 
                                    ? mesaAsociada.meseroNombres.join(', ') 
                                    : mesaAsociada.meseroNombre}
                                </span>
                              </>
                            )}
                          </div>
                        </div>
                        
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <div style={{ textAlign: 'right' }}>
                            <div style={{ fontSize: 14, fontWeight: 900, color: 'var(--success)' }}>${total} MXN</div>
                            <button
                              onClick={() => setExpandedIds(prev => ({ ...prev, [c.id]: !prev[c.id] }))}
                              style={{
                                background: 'none',
                                border: 'none',
                                color: 'var(--bronze-light)',
                                fontSize: 10,
                                cursor: 'pointer',
                                textDecoration: 'underline',
                                padding: 0,
                                lineHeight: 1
                              }}
                            >
                              {isExpanded ? 'Ocultar ▲' : 'Detalle ▼'}
                            </button>
                          </div>

                          <button
                            className="btn btn-sm"
                            onClick={() => !cuentaSolicitada && loadingCuentaId !== c.id && pedirCuenta(c)}
                            disabled={cuentaSolicitada || loadingCuentaId === c.id}
                            style={{
                              background: (cuentaSolicitada || loadingCuentaId === c.id)
                                ? 'var(--bg-hover)' 
                                : 'linear-gradient(135deg, var(--bronze), var(--bronze-light))',
                              color: (cuentaSolicitada || loadingCuentaId === c.id) ? 'var(--text-muted)' : '#0d0d0f',
                              fontWeight: 700,
                              fontSize: 10,
                              padding: '4px 10px',
                              borderRadius: 6,
                              display: 'flex',
                              alignItems: 'center',
                              gap: 3,
                              border: 'none',
                              cursor: (cuentaSolicitada || loadingCuentaId === c.id) ? 'not-allowed' : 'pointer',
                              whiteSpace: 'nowrap',
                              height: 28
                            }}
                          >
                            {loadingCuentaId === c.id ? (
                              <i className="ri-loader-4-line ri-spin" style={{ fontSize: 12 }} />
                            ) : (
                              <i className="ri-secure-payment-line" style={{ fontSize: 12 }} />
                            )}
                            {loadingCuentaId === c.id ? 'Enviando...' : (cuentaSolicitada ? 'Pedido...' : 'Cobrar')}
                          </button>
                        </div>
                      </div>

                      {isExpanded && (
                        <div style={{
                          background: 'rgba(0, 0, 0, 0.15)',
                          borderRadius: 6,
                          padding: 8,
                          fontSize: 11,
                          marginTop: 2,
                          border: '1px solid rgba(255, 255, 255, 0.05)'
                        }}>
                          <div style={{ fontWeight: 'bold', color: 'var(--bronze-light)', marginBottom: 2 }}>Productos consumidos:</div>
                          {getTodosConsumos(c).length === 0 ? (
                            <div style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>Sin consumos registrados</div>
                          ) : (
                            <ul style={{ margin: 0, paddingLeft: 14, color: 'var(--text-secondary)' }}>
                              {getTodosConsumos(c).map((item, idx) => (
                                <li key={idx} style={{ marginBottom: 1 }}>
                                  {item.cantidad}x {item.producto} (${item.precio * item.cantidad}){item.unloaded && <span style={{ color: 'var(--bronze-light)', fontSize: 9, marginLeft: 6 }}>(por cargar)</span>}
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* ── COLUMNA 2: CUENTAS DIRECTAS ── */}
          <div className="section-card">
            <div className="section-header-title">
              <i className="ri-user-line" style={{ color: 'var(--success)' }} />
              Cuentas Directas ({getCuentasDirectasFiltradas().length})
            </div>

            {/* Buscador Interactivo Inline */}
            <div style={{ marginBottom: 12 }}>
              <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                <i className="ri-search-line" style={{ position: 'absolute', left: 10, color: 'var(--text-muted)' }} />
                <input
                  type="text"
                  placeholder="Buscar cliente..."
                  value={filtroCuentaTexto}
                  onChange={e => setFiltroCuentaTexto(e.target.value)}
                  style={{
                    width: '100%',
                    background: 'var(--bg-main)',
                    border: '1px solid var(--border)',
                    borderRadius: 8,
                    padding: '6px 12px 6px 32px',
                    color: '#fff',
                    fontSize: 12,
                    outline: 'none'
                  }}
                />
                {filtroCuentaTexto && (
                  <button 
                    onClick={() => setFiltroCuentaTexto('')}
                    style={{ position: 'absolute', right: 10, background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
                  >
                    <i className="ri-close-line" />
                  </button>
                )}
              </div>
            </div>

            {/* Botón de Expansión Global */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
              <button
                type="button"
                onClick={() => {
                  const filteredList = getCuentasDirectasFiltradas();
                  const allExpanded = filteredList.length > 0 && filteredList.every(c => !!expandedIds[c.id]);
                  if (allExpanded) {
                    setExpandedIds({});
                  } else {
                    const next = {};
                    filteredList.forEach(c => { next[c.id] = true; });
                    setExpandedIds(next);
                  }
                }}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--bronze-light)',
                  fontSize: 11,
                  cursor: 'pointer',
                  textDecoration: 'underline',
                  padding: 0
                }}
              >
                {getCuentasDirectasFiltradas().length > 0 && getCuentasDirectasFiltradas().every(c => !!expandedIds[c.id]) ? 'Contraer todo ▲' : 'Expandir todo ▼'}
              </button>
            </div>

            {/* Listado de Cuentas Directas */}
            <div className="scrollable-list">
              {getCuentasDirectasFiltradas().length === 0 ? (
                <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)', fontSize: 13 }}>
                  {getCuentasActivasUnificadas().filter(c => !c.mesaId && !findMesaAsociada(c)).length === 0 ? 'No hay cuentas directas.' : 'No se encontraron resultados.'}
                </div>
              ) : (
                getCuentasDirectasFiltradas().map(c => {
                  const consumosTotal = c.consumos.reduce((sum, item) => sum + item.precio * item.cantidad, 0) + getUnloadedConsumosForCuenta(c);
                  const costoTiempo = c.tiempoJuego || 0;
                  const total = costoTiempo + consumosTotal;
                  const isExpanded = !!expandedIds[c.id];

                  const cuentaSolicitada = (alertasAsistenciaParaMi || []).some(alerta => 
                    alerta.tipo === 'cuenta' && 
                    alerta.cliente && 
                    alerta.cliente.toLowerCase() === c.cliente.toLowerCase()
                  ) || !!localRequestedCuentas[c.cliente.toLowerCase()];

                  const tieneAsistenciaPendiente = (alertasAsistenciaParaMi || []).some(alerta => 
                    !alerta.atendidoMesero &&
                    alerta.cliente && c.cliente && alerta.cliente.toLowerCase() === c.cliente.toLowerCase()
                  );

                  return (
                    <div key={c.id} style={{
                      background: 'var(--bg-elevated)',
                      border: '1px solid var(--border)',
                      borderRadius: 10,
                      padding: '8px 12px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 6,
                      contentVisibility: 'auto',
                      containIntrinsicSize: '0 44px'
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 800, fontSize: 13, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'flex', alignItems: 'center' }}>
                            {c.cliente}
                            {tieneAsistenciaPendiente && (
                              <i className="ri-notification-3-fill wiggle-bell" style={{ color: 'var(--bronze-light)', marginLeft: 6, fontSize: 12, verticalAlign: 'middle' }} title="Llamada de asistencia o pedido pendiente" />
                            )}
                          </div>
                          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 1 }}>
                            👤 Cuenta Directa · Consumo: ${consumosTotal} {c.meseroNombre ? `· Mesero: ${c.meseroNombre}` : ''}
                          </div>
                        </div>
                        
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <div style={{ textAlign: 'right' }}>
                            <div style={{ fontSize: 14, fontWeight: 900, color: 'var(--success)' }}>${total} MXN</div>
                            <button
                              onClick={() => setExpandedIds(prev => ({ ...prev, [c.id]: !prev[c.id] }))}
                              style={{
                                background: 'none',
                                border: 'none',
                                color: 'var(--bronze-light)',
                                fontSize: 10,
                                cursor: 'pointer',
                                textDecoration: 'underline',
                                padding: 0,
                                lineHeight: 1
                              }}
                            >
                              {isExpanded ? 'Ocultar ▲' : 'Detalle ▼'}
                            </button>
                          </div>

                          <button
                            className="btn btn-sm"
                            onClick={() => !cuentaSolicitada && loadingCuentaId !== c.id && pedirCuenta(c)}
                            disabled={cuentaSolicitada || loadingCuentaId === c.id}
                            style={{
                              background: (cuentaSolicitada || loadingCuentaId === c.id)
                                ? 'var(--bg-hover)' 
                                : 'linear-gradient(135deg, var(--bronze), var(--bronze-light))',
                              color: (cuentaSolicitada || loadingCuentaId === c.id) ? 'var(--text-muted)' : '#0d0d0f',
                              fontWeight: 700,
                              fontSize: 10,
                              padding: '4px 10px',
                              borderRadius: 6,
                              display: 'flex',
                              alignItems: 'center',
                              gap: 3,
                              border: 'none',
                              cursor: (cuentaSolicitada || loadingCuentaId === c.id) ? 'not-allowed' : 'pointer',
                              whiteSpace: 'nowrap',
                              height: 28
                            }}
                          >
                            {loadingCuentaId === c.id ? (
                              <i className="ri-loader-4-line ri-spin" style={{ fontSize: 12 }} />
                            ) : (
                              <i className="ri-secure-payment-line" style={{ fontSize: 12 }} />
                            )}
                            {loadingCuentaId === c.id ? 'Enviando...' : (cuentaSolicitada ? 'Pedido...' : 'Cobrar')}
                          </button>
                        </div>
                      </div>

                      {isExpanded && (
                        <div style={{
                          background: 'rgba(0, 0, 0, 0.15)',
                          borderRadius: 6,
                          padding: 8,
                          fontSize: 11,
                          marginTop: 2,
                          border: '1px solid rgba(255, 255, 255, 0.05)'
                        }}>
                          <div style={{ fontWeight: 'bold', color: 'var(--bronze-light)', marginBottom: 2 }}>Productos consumidos:</div>
                          {getTodosConsumos(c).length === 0 ? (
                            <div style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>Sin consumos registrados</div>
                          ) : (
                            <ul style={{ margin: 0, paddingLeft: 14, color: 'var(--text-secondary)' }}>
                              {getTodosConsumos(c).map((item, idx) => (
                                <li key={idx} style={{ marginBottom: 1 }}>
                                  {item.cantidad}x {item.producto} (${item.precio * item.cantidad}){item.unloaded && <span style={{ color: 'var(--bronze-light)', fontSize: 9, marginLeft: 6 }}>(por cargar)</span>}
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── VENTANA EMERGENTE: ALERTA DE ASISTENCIA / SERVICIOS ── */}
      {showAsistenciaModal && alertasAsistenciaParaMi.length > 0 && (
        <div className="modal-overlay" style={{ zIndex: 1000, background: 'rgba(13,13,15,0.85)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'fixed', top: 0, left: 0, right: 0, bottom: 0 }}>
          <div className="modal" style={{ maxWidth: 460, border: '2px solid var(--danger)', boxShadow: '0 0 30px rgba(239,68,68,0.35)', animation: 'scaleUp 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)' }}>
            <div className="modal-header" style={{ borderBottom: '1px solid rgba(239,68,68,0.2)', paddingBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span className="modal-title" style={{ color: 'var(--danger)', display: 'flex', alignItems: 'center', gap: 8, fontSize: 18, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                <span style={{ fontSize: 24, animation: 'pulse 1s infinite' }}>🚨</span> Alerta de Servicio
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 11, background: 'rgba(239,68,68,0.15)', color: 'var(--danger)', padding: '2px 8px', borderRadius: 999, fontWeight: 800 }}>
                  {alertasAsistenciaParaMi.length} PENDIENTE(S)
                </span>
                <button
                  onClick={() => setShowAsistenciaModal(false)}
                  title="Dejar pendientes y cerrar"
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'var(--text-muted)',
                    cursor: 'pointer',
                    fontSize: 18,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: 4,
                    transition: 'color 0.15s'
                  }}
                  onMouseEnter={e => e.currentTarget.style.color = '#fff'}
                  onMouseLeave={e => e.currentTarget.style.color = 'var(--text-muted)'}
                >
                  <i className="ri-close-line" />
                </button>
              </div>
            </div>
            <div className="modal-body" style={{ maxHeight: 360, overflowY: 'auto', padding: '16px 0' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                 {alertasAsistenciaParaMi.map((alerta) => {
                  const listoAt = alerta.cocinaAtendidoAt?.toDate 
                    ? alerta.cocinaAtendidoAt.toDate().getTime() 
                    : (alerta.cocinaAtendidoAt || 0);
                  const esDemorado = alerta.tipo === 'pedido' && alerta.estado === 'listo' && listoAt && (Date.now() - listoAt) > 5 * 60 * 1000;

                  return (
                    <div 
                      key={alerta.id} 
                      style={{ 
                        background: esDemorado ? 'rgba(239, 68, 68, 0.08)' : 'rgba(255,255,255,0.03)', 
                        border: esDemorado ? '1px solid #ef4444' : '1px solid rgba(255,255,255,0.06)', 
                        boxShadow: esDemorado ? '0 0 10px rgba(239, 68, 68, 0.15)' : 'none',
                        animation: esDemorado ? 'pulse-border 2s infinite' : 'none',
                        borderRadius: 14, 
                        padding: 16, 
                        display: 'flex', 
                        justifyContent: 'space-between', 
                        alignItems: 'center', 
                        gap: 12 
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <div style={{ fontSize: 32 }}>{alerta.icono || '🙋'}</div>
                        <div style={{ textAlign: 'left' }}>
                          <div style={{ fontSize: 16, fontWeight: 800, color: '#fff' }}>
                            Mesa {alerta.mesaId}
                          </div>
                          <div style={{ fontSize: 13, color: 'var(--text-secondary)', fontWeight: 600, marginTop: 2 }}>
                            Solicitud: <span style={{ color: alerta.estado === 'listo' ? 'var(--success)' : 'var(--bronze-light)' }}>
                              {alerta.estado === 'listo' ? '🍳 ¡LISTO PARA SERVIR! ' : ''}
                              {alerta.etiqueta} {alerta.tipo === 'cuenta' && alerta.totalAcumulado ? `($${alerta.totalAcumulado} MXN)` : alerta.tipo === 'pedido' && alerta.total ? `($${alerta.total} MXN)` : ''}
                            </span>
                            {esDemorado && (
                              <span style={{ fontSize: 9, background: 'rgba(239, 68, 68, 0.2)', color: '#ef4444', border: '1px solid #ef4444', borderRadius: 4, padding: '1px 4px', marginLeft: 6, fontWeight: 800, textTransform: 'uppercase' }}>
                                ⚠️ Demorado
                              </span>
                            )}
                          </div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                          {alerta.cliente} · {alerta.createdAt?.toDate ? new Date(alerta.createdAt.toDate()).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : 'Ahora'}
                        </div>
                      </div>
                    </div>
                    <button
                      onClick={() => marcarAtendido(alerta.id, alerta.tipo, alerta.estado)}
                      disabled={loadingAlertaId === alerta.id}
                      style={{
                        background: (alerta.tipo === 'pedido' && alerta.estado === 'listo') 
                          ? 'rgba(34,197,94,0.25)' 
                          : 'rgba(34,197,94,0.15)',
                        border: (alerta.tipo === 'pedido' && alerta.estado === 'listo')
                          ? '1px solid rgba(34,197,94,0.6)'
                          : '1px solid rgba(34,197,94,0.4)',
                        color: 'var(--success)',
                        padding: '8px 16px',
                        borderRadius: 10,
                        fontWeight: 700,
                        fontSize: 13,
                        cursor: (loadingAlertaId === alerta.id) ? 'not-allowed' : 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        transition: 'all 0.15s',
                        flexShrink: 0,
                        opacity: (loadingAlertaId === alerta.id) ? 0.6 : 1
                      }}
                      onMouseEnter={e => { if (loadingAlertaId !== alerta.id) e.currentTarget.style.background = 'rgba(34,197,94,0.35)'; }}
                      onMouseLeave={e => { if (loadingAlertaId !== alerta.id) e.currentTarget.style.background = (alerta.tipo === 'pedido' && alerta.estado === 'listo') ? 'rgba(34,197,94,0.25)' : 'rgba(34,197,94,0.15)'; }}
                    >
                      {loadingAlertaId === alerta.id ? (
                        <i className="ri-loader-4-line ri-spin" />
                      ) : (
                        <i className={alerta.tipo === 'pedido' && alerta.estado === 'listo' ? 'ri-check-double-line' : 'ri-check-line'} />
                      )}
                      {loadingAlertaId === alerta.id ? 'Entregando...' : (alerta.tipo === 'pedido' && alerta.estado === 'listo' ? 'Entregar' : 'Atendido')}
                    </button>
                  </div>
                );
              })}
              </div>
            </div>
            <div className="modal-footer" style={{ borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div
                style={{ color: 'var(--success)', fontSize: 12, display: 'flex', alignItems: 'center', gap: 6, userSelect: 'none' }}
                title="Las alertas de sonido están activadas permanentemente"
              >
                <i className="ri-volume-up-line" />
                Alarma encendida
              </div>
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>YoY IA Billar By Alfonso Iturbide</span>
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL: CAPTURAR VENTA DIRECTA (MESERO) ── */}
      {showCapturarModal && (
        <div className={`modal-overlay ${isClosing ? 'modal-closing' : ''}`} onClick={e => e.target === e.currentTarget && handleCloseCapturarModal()} style={{ zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.6)' }}>
          <div className="modal" style={{ maxWidth: 640 }}>
            <div className="modal-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span className="modal-title">🛍️ Capturar Venta Directa</span>
              <button onClick={handleCloseCapturarModal} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 20, cursor: 'pointer' }}><i className="ri-close-line" /></button>
            </div>
            
            <div className="modal-body" style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 20, maxHeight: '60vh', overflowY: 'auto' }}>
              {/* Lado Izquierdo: Configuración y Productos */}
              <div style={{ textAlign: 'left' }}>
                <div className="form-group" style={{ marginBottom: 16 }}>
                  <label className="form-label">Seleccionar Destino de Comanda</label>
                  <select className="form-select" value={capturaMesaId} onChange={e => setCapturaMesaId(e.target.value)} style={{ width: '100%' }}>
                    {/* Mesas Ocupadas */}
                    {mesas.filter(m => {
                      if (m.estado !== 'ocupada') return false;
                      const rolLower = (user?.role || user?.rol || '').toLowerCase();
                      if (rolLower.includes('mesero') && user?.uid) {
                        return m.meseroId === user.uid || (m.meseroIds && Array.isArray(m.meseroIds) && m.meseroIds.includes(user.uid));
                      }
                      return true;
                    }).map(m => (
                      <option key={`mesa_${m.id}`} value={`mesa_${m.id}`} style={{ color: 'var(--bronze-light)' }}>
                        🏓 Mesa {m.id} ({m.cliente})
                      </option>
                    ))}
                    {/* Cuentas Directas por Nombre (excluyendo mesas) */}
                    {cuentas.filter(c => !c.mesaId && !mesas.some(m => m.estado === 'ocupada' && m.cliente && m.cliente.toLowerCase() === c.cliente.toLowerCase())).map(c => (
                      <option key={`cuenta_${c.id}`} value={`cuenta_${c.id}`} style={{ color: '#2ec55e' }}>
                        👤 Cuenta: {c.cliente}
                      </option>
                    ))}
                    {/* Nueva Cuenta */}
                    <option value="nueva_cuenta" style={{ fontWeight: 'bold' }}>
                      ➕ Abrir nueva cuenta sin mesa...
                    </option>
                  </select>
                </div>

                {capturaMesaId === 'nueva_cuenta' && (
                  <div className="form-group" style={{ marginBottom: 16, animation: 'fadeIn 0.2s ease' }}>
                    <label className="form-label">Nombre del Cliente (Nueva Cuenta)</label>
                    <input
                      type="text"
                      className="form-input"
                      placeholder="Ej: Pedro Torres"
                      value={nuevoClienteNombre}
                      onChange={e => setNuevoClienteNombre(e.target.value)}
                      style={{ width: '100%' }}
                    />
                  </div>
                )}
                
                <div className="form-label" style={{ marginBottom: 8 }}>Productos del Bar</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 260, overflowY: 'auto', paddingRight: 6 }}>
                  {productosBar.map(p => {
                    const cant = capturaCarrito[p.id] || 0;
                    return (
                      <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 10, padding: '8px 12px' }}>
                        <div>
                          <div style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>{p.nombre}</div>
                          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>${p.precioVenta} · Stock: {p.stock}</div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <button className="btn btn-secondary btn-icon" style={{ width: 26, height: 26, minWidth: 26, padding: 0 }} onClick={() => modificarCapturaCarrito(p.id, -1)}>−</button>
                          <span style={{ fontSize: 13, fontWeight: 700, minWidth: 16, textAlign: 'center' }}>{cant}</span>
                          <button className="btn btn-secondary btn-icon" style={{ width: 26, height: 26, minWidth: 26, padding: 0 }} onClick={() => modificarCapturaCarrito(p.id, 1)}>+</button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
              
              {/* Lado Derecho: Carrito/Resumen */}
              <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 14, padding: 16, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', textAlign: 'left' }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--bronze-light)', marginBottom: 12, borderBottom: '1px solid var(--border)', paddingBottom: 8 }}>
                    🛒 Resumen: {
                      capturaMesaId.startsWith('mesa_') ? `Mesa ${capturaMesaId.replace('mesa_', '')}` :
                      capturaMesaId.startsWith('cuenta_') ? `Cuenta: ${cuentas.find(c => c.id === parseFloat(capturaMesaId.replace('cuenta_', '')))?.cliente || ''}` :
                      'Nueva Cuenta'
                    }
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxHeight: 200, overflowY: 'auto' }}>
                    {Object.entries(capturaCarrito).map(([id, cant]) => {
                      const prod = productosBar.find(p => p.id === parseInt(id));
                      if (!prod) return null;
                      return (
                        <div key={id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, alignItems: 'center' }}>
                          <span>{cant}× {prod.nombre}</span>
                          <span style={{ fontWeight: 700, color: 'var(--bronze-light)' }}>${prod.precioVenta * cant}</span>
                        </div>
                      );
                    })}
                    {Object.keys(capturaCarrito).length === 0 && (
                      <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '40px 0', fontSize: 12 }}>
                        El carrito está vacío
                      </div>
                    )}
                  </div>
                </div>
                
                <div style={{ marginTop: 20 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 15, fontWeight: 800, borderTop: '1px solid var(--border)', paddingTop: 10, marginBottom: 16 }}>
                    <span>Total:</span>
                    <span style={{ color: 'var(--bronze-light)' }}>
                      ${Object.entries(capturaCarrito).reduce((s, [id, cant]) => s + (productosBar.find(p => p.id === parseInt(id))?.precioVenta || 0) * cant, 0)}
                    </span>
                  </div>
                  
                  <button
                    className="btn btn-primary"
                    style={{ width: '100%' }}
                    onClick={guardarCapturaVenta}
                    disabled={Object.keys(capturaCarrito).length === 0}
                  >
                    <i className="ri-save-line" /> Guardar Venta
                  </button>
                </div>
              </div>
            </div>
            
            <div className="modal-footer" style={{ borderTop: '1px solid var(--border)', paddingTop: 12, display: 'flex', justifyContent: 'flex-end' }}>
              <button className="btn btn-secondary" onClick={handleCloseCapturarModal}>Cancelar</button>
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL: AVISAR A OTRO MESERO ── */}
      {showModalAvisarMesero && (
        <div className="modal-overlay" onClick={() => setShowModalAvisarMesero(false)} style={{ zIndex: 1100, display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.6)' }}>
          <div className="modal" style={{ maxWidth: 400, width: '90%', background: 'var(--bg-card)', borderRadius: 12, padding: 20 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border)', paddingBottom: 10, marginBottom: 16 }}>
              <span className="modal-title" style={{ fontSize: 16, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}>
                📢 Avisar a Compañero
              </span>
              <button onClick={() => setShowModalAvisarMesero(false)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 20, cursor: 'pointer' }}>
                <i className="ri-close-line" />
              </button>
            </div>
            
            <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div className="form-group" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label className="form-label" style={{ fontSize: 12, fontWeight: 600 }}>Seleccionar Mesero Destinatario</label>
                <select 
                  className="form-select" 
                  value={alertaDestinatarioId} 
                  onChange={e => setAlertaDestinatarioId(e.target.value)} 
                  style={{ width: '100%', padding: 8, borderRadius: 8, background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
                >
                  <option value="">Seleccionar mesero...</option>
                  {todosLosMeseros.filter(m => m.id !== user?.uid).map(m => (
                    <option key={m.id} value={m.id}>{m.nombre}</option>
                  ))}
                </select>
              </div>

              <div className="form-group" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label className="form-label" style={{ fontSize: 12, fontWeight: 600 }}>Seleccionar Mesa de Referencia</label>
                <select 
                  className="form-select" 
                  value={alertaMesaId} 
                  onChange={e => setAlertaMesaId(e.target.value)} 
                  style={{ width: '100%', padding: 8, borderRadius: 8, background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
                >
                  <option value="">Seleccionar mesa...</option>
                  {[...mesas].sort((a,b) => a.id - b.id).map(m => (
                    <option key={m.id} value={m.id}>
                      Mesa {m.id} {m.estado === 'ocupada' ? `(Ocupada - ${m.cliente})` : '(Libre)'}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            
            <div className="modal-footer" style={{ borderTop: '1px solid var(--border)', paddingTop: 12, marginTop: 16, display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button className="btn btn-secondary" onClick={() => setShowModalAvisarMesero(false)} style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid var(--border)', background: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}>
                Cancelar
              </button>
              <button 
                className="btn btn-primary" 
                onClick={handleEnviarAvisoOtroMesero} 
                disabled={!alertaDestinatarioId || !alertaMesaId}
                style={{ 
                  padding: '8px 16px', 
                  borderRadius: 8, 
                  border: 'none', 
                  background: (!alertaDestinatarioId || !alertaMesaId) ? 'var(--bg-hover)' : 'linear-gradient(135deg, var(--bronze), var(--bronze-light))', 
                  color: '#0d0d0f', 
                  fontWeight: 700,
                  cursor: (!alertaDestinatarioId || !alertaMesaId) ? 'not-allowed' : 'pointer'
                }}
              >
                Enviar Aviso
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div style={{
          position: 'fixed',
          bottom: 24,
          left: '50%',
          transform: 'translateX(-50%)',
          background: toast.type === 'error' ? 'var(--danger)' : 'linear-gradient(135deg, var(--bronze), var(--bronze-light))',
          color: toast.type === 'error' ? '#fff' : '#0d0d0f',
          padding: '12px 24px',
          borderRadius: 12,
          fontWeight: 700,
          boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
          zIndex: 2000,
          animation: 'fadeInUp 0.3s ease'
        }}>
          {toast.message}
        </div>
      )}
    </div>
  );
}

const calcCosto = (m, rentaExtras) => {
  if (!m || !m.inicio) return 0;
  const hrs = (Date.now() - m.inicio) / 3600000;
  let baseCosto = m.socios ? 0 : Math.ceil(hrs * m.tarifa);
  const tacoExtra = (rentaExtras && rentaExtras.find(e => e.id === 'taco')) || { precio: 25, tipo: 'hora' };
  const bolasExtra = (rentaExtras && rentaExtras.find(e => e.id === 'bolas')) || { precio: 35, tipo: 'hora' };
  const tizaExtra = (rentaExtras && rentaExtras.find(e => e.id === 'tiza')) || { precio: 10, tipo: 'fijo' };

  let premiumCosto = 0;
  if (m.rentarTaco) {
    premiumCosto += (tacoExtra.tipo === 'hora' ? Math.ceil(hrs * tacoExtra.precio) : tacoExtra.precio);
  }
  if (m.rentarBolas) {
    premiumCosto += (bolasExtra.tipo === 'hora' ? Math.ceil(hrs * bolasExtra.precio) : bolasExtra.precio);
  }
  if (m.rentarTiza) {
    premiumCosto += (tizaExtra.tipo === 'hora' ? Math.ceil(hrs * tizaExtra.precio) : tizaExtra.precio);
  }
  return baseCosto + premiumCosto;
};



export default function MeseroPage() {
  return (
    <AuthProvider>
      <MeseroContent />
    </AuthProvider>
  );
}

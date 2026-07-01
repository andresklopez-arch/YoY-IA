'use client';
import { useState, useEffect, useRef } from 'react';
import {
  collection, onSnapshot, query,
  orderBy, updateDoc, doc, serverTimestamp, addDoc, getDocs, setDoc, getDoc, deleteDoc, getActiveSalonId
} from '@/lib/firestore-tenant';
import { db } from '@/lib/firebase';
import { AuthProvider, useAuth } from '@/lib/auth-context';
import { obfuscate, deobfuscate } from '@/lib/crypto';

// ── Emoji por categoría de producto ───────────────────────
const CAT_EMOJI = {
  Cerveza: '🍺', Refresco: '🥤', Snack: '🍟',
  Comida: '🍗', Bebida: '☕', Bar: '🍸', default: '🛒',
};


// Insumos iniciales por defecto para semilla
const DEFAULT_INSUMOS = [
  { nombre: 'Papas para freír', nivelActual: 25, nivelMin: 15, nivelOptimo: 50, unidad: 'kg', categoria: 'Cocina General' },
  { nombre: 'Aceite vegetal para freidora', nivelActual: 12, nivelMin: 8, nivelOptimo: 30, unidad: 'L', categoria: 'Cocina General' },
  { nombre: 'Alitas de pollo crudas', nivelActual: 18, nivelMin: 15, nivelOptimo: 50, unidad: 'kg', categoria: 'Comida' },
  { nombre: 'Carne de res para hamburguesa', nivelActual: 10, nivelMin: 8, nivelOptimo: 25, unidad: 'kg', categoria: 'Comida' },
  { nombre: 'Pan para hamburguesa', nivelActual: 30, nivelMin: 15, nivelOptimo: 50, unidad: 'pz', categoria: 'Comida' },
  { nombre: 'Queso Cheddar rebanado', nivelActual: 45, nivelMin: 20, nivelOptimo: 80, unidad: 'pz', categoria: 'Comida' },
  { nombre: 'Totopos de maíz', nivelActual: 8, nivelMin: 5, nivelOptimo: 20, unidad: 'kg', categoria: 'Snack' },
  { nombre: 'Queso para nachos líquido', nivelActual: 6, nivelMin: 4, nivelOptimo: 15, unidad: 'L', categoria: 'Snack' },
  { nombre: 'Salsa Valentina', nivelActual: 5, nivelMin: 2, nivelOptimo: 10, unidad: 'L', categoria: 'Aderezos' },
  { nombre: 'Salsa BBQ', nivelActual: 4, nivelMin: 2, nivelOptimo: 10, unidad: 'L', categoria: 'Aderezos' },
  { nombre: 'Salsa Catsup', nivelActual: 7, nivelMin: 3, nivelOptimo: 15, unidad: 'L', categoria: 'Aderezos' },
  { nombre: 'Mostaza preparada', nivelActual: 3, nivelMin: 2, nivelOptimo: 8, unidad: 'L', categoria: 'Aderezos' },
  { nombre: 'Mayonesa premium', nivelActual: 4, nivelMin: 2, nivelOptimo: 10, unidad: 'kg', categoria: 'Aderezos' },
  { nombre: 'Limones frescos', nivelActual: 6, nivelMin: 3, nivelOptimo: 12, unidad: 'kg', categoria: 'Cocina General' },
  { nombre: 'Sal de mesa', nivelActual: 5, nivelMin: 2, nivelOptimo: 10, unidad: 'kg', categoria: 'Cocina General' },
  { nombre: 'Pimienta negra molida', nivelActual: 800, nivelMin: 300, nivelOptimo: 1500, unidad: 'g', categoria: 'Cocina General' },
  { nombre: 'Cebollas frescas', nivelActual: 8, nivelMin: 4, nivelOptimo: 15, unidad: 'kg', categoria: 'Cocina General' },
  { nombre: 'Jitomates frescos', nivelActual: 10, nivelMin: 5, nivelOptimo: 20, unidad: 'kg', categoria: 'Cocina General' },
  { nombre: 'Lechuga romana', nivelActual: 12, nivelMin: 6, nivelOptimo: 25, unidad: 'pz', categoria: 'Cocina General' },
  { nombre: 'Aguacates', nivelActual: 5, nivelMin: 4, nivelOptimo: 15, unidad: 'kg', categoria: 'Cocina General' },
  { nombre: 'Servilletas de papel', nivelActual: 15, nivelMin: 8, nivelOptimo: 30, unidad: 'paq', categoria: 'Limpieza e Insumos' }
];

function CocinaContent() {
  const { user, loading, logout, loginWithEmpleadoId } = useAuth();

  const handleLogout = async () => {
    if (window.confirm('¿Estás seguro de que deseas cerrar sesión de cocina/barra?')) {
      await logout();
      window.location.href = '/';
    }
  };

  useEffect(() => {
    if (loading) return;

    const urlParams = new URLSearchParams(window.location.search);
    const queryEmpleadoId = urlParams.get('empleadoId');

    const checkAndRecoverSession = async () => {
      // Recuperación de sesión desde URL si localStorage fue limpiado por race condition
      if (queryEmpleadoId && queryEmpleadoId !== 'sin_cocina' && !user) {
        try {
          await loginWithEmpleadoId(queryEmpleadoId);
          return;
        } catch (e) {
          console.error("Error logging in via queryEmpleadoId en cocina:", e);
        }
      }

      if (!user) {
        try { sessionStorage.setItem('yoy_auth_redirect_reason', 'Acceso denegado: No hay una sesión activa de cocina/barra.'); } catch (e) {}
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
        rolLower.includes('cocina') || 
        rolLower.includes('bartender') || 
        rolLower.includes('barman') || 
        rolLower.includes('cocinero') ||
        user.isFreeAccess === true;

      if (!isAuthorized) {
        try { sessionStorage.setItem('yoy_auth_redirect_reason', `Rol '${user.role}' no autorizado para la vista de cocina/barra.`); } catch (e) {}
        window.location.href = '/';
      }
    };

    checkAndRecoverSession();
  }, [user, loading]);

  const [tab, setTab] = useState('pedidos'); // pedidos | insumos | inventario
  const [pedidos, setPedidos] = useState([]);
  const [historial, setHistorial] = useState([]);
  const [insumos, setInsumos] = useState([]);
  const [productos, setProductos] = useState([]);
  const [busquedaProd, setBusquedaProd] = useState('');
  const [filtroCat, setFiltroCat] = useState('Todas');
  
  // Controles de sonido y notificaciones
  const [sonido, setSonido] = useState(true);
  const ultimoPedidosCountRef = useRef(0);
  const sonidoRef = useRef(sonido);
  useEffect(() => {
    sonidoRef.current = sonido;
  }, [sonido]);

  // Estados de formularios/modales para insumos
  const [showInsumoModal, setShowInsumoModal] = useState(false);
  const [newInsumo, setNewInsumo] = useState({ nombre: '', nivelActual: 10, nivelMin: 5, nivelOptimo: 20, unidad: 'pz', categoria: 'Comida', toleranciaDesviacion: 25 });
  const [editingInsumo, setEditingInsumo] = useState(null);
  const [showCierreTurnoModal, setShowCierreTurnoModal] = useState(false);
  const [cierreInsumos, setCierreInsumos] = useState([]);
  const [isClosing, setIsClosing] = useState(false);
  const [iaPrevisiones, setIaPrevisiones] = useState({});
  const [updatingIds, setUpdatingIds] = useState(new Set());

  const syncInsumoToInventario = async (insumoData, action = 'update') => {
    try {
      const docRef = doc(db, 'config', 'inventario');
      const snap = await getDoc(docRef);
      if (snap.exists()) {
        let prods = snap.data().productos || [];
        const idx = prods.findIndex(p => p.nombre.toLowerCase() === insumoData.nombre.toLowerCase());
        
        if (idx >= 0) {
          if (action === 'delete') {
            prods = prods.filter((_, i) => i !== idx);
          } else {
            prods[idx] = {
              ...prods[idx],
              nombre: insumoData.nombre,
              stock: Number(insumoData.nivelActual),
              stockMin: Number(insumoData.nivelMin),
              stockOptimo: Number(insumoData.nivelOptimo),
              unidad: insumoData.unidad,
              categoria: 'Insumo',
              precioCosto: prods[idx].precioCosto || 0,
              precioVenta: 0,
              toleranciaDesviacion: Number(insumoData.toleranciaDesviacion !== undefined ? insumoData.toleranciaDesviacion : 25)
            };
          }
        } else if (action === 'update' || action === 'add') {
          const maxId = prods.reduce((max, p) => p.id > max ? p.id : max, 0);
          prods.push({
            id: maxId + 1,
            nombre: insumoData.nombre,
            stock: Number(insumoData.nivelActual),
            stockMin: Number(insumoData.nivelMin),
            stockOptimo: Number(insumoData.nivelOptimo),
            unidad: insumoData.unidad,
            categoria: 'Insumo',
            precioCosto: 0,
            precioVenta: 0,
            toleranciaDesviacion: Number(insumoData.toleranciaDesviacion !== undefined ? insumoData.toleranciaDesviacion : 25)
          });
        }
        await setDoc(docRef, { productos: prods, updatedAt: serverTimestamp() });
      }
    } catch (err) {
      console.error("Error al sincronizar insumo con inventario central:", err);
    }
  };

  const handleCloseInsumoModal = () => {
    const isModified = newInsumo.nombre !== '' || 
                      newInsumo.nivelActual !== 10 || 
                      newInsumo.nivelMin !== 5 || 
                      newInsumo.nivelOptimo !== 20 || 
                      newInsumo.unidad !== 'pz' || 
                      newInsumo.categoria !== 'Comida' ||
                      newInsumo.toleranciaDesviacion !== 25;
    if (isModified) {
      sessionStorage.setItem('yoy_draft_new_insumo', JSON.stringify(newInsumo));
    }
    setIsClosing(true);
    setTimeout(() => {
      setShowInsumoModal(false);
      setIsClosing(false);
      setNewInsumo({ nombre: '', nivelActual: 10, nivelMin: 5, nivelOptimo: 20, unidad: 'pz', categoria: 'Comida', toleranciaDesviacion: 25 });
    }, 150);
  };

  useEffect(() => {
    if (showInsumoModal) {
      const draft = sessionStorage.getItem('yoy_draft_new_insumo');
      if (draft) {
        try {
          const parsed = JSON.parse(draft);
          setNewInsumo(parsed);
          sessionStorage.removeItem('yoy_draft_new_insumo');
        } catch (e) {}
      }
    }
  }, [showInsumoModal]);

  // 1. Escuchar pedidos de cocina (Unificado y sin requerimiento de índices compuestos)
  useEffect(() => {
    const q = query(collection(db, 'mesa_pedidos'));
    const unsub = onSnapshot(q, snap => {
      const allItems = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      
      // Filtrar y ordenar pendientes
      const pending = allItems.filter(p => p.tipo === 'pedido' && p.estado === 'pendiente');
      pending.sort((a, b) => {
        const tA = a.createdAt?.toDate ? a.createdAt.toDate().getTime() : (a.createdAt || 0);
        const tB = b.createdAt?.toDate ? b.createdAt.toDate().getTime() : (b.createdAt || 0);
        return tB - tA;
      });
      setPedidos(pending);

      // Reproducir sonido si hay nuevos pedidos entrantes
      if (sonidoRef.current && pending.length > ultimoPedidosCountRef.current && ultimoPedidosCountRef.current > 0) {
        try {
          const ctx = new (window.AudioContext || window.webkitAudioContext)();
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.connect(gain); gain.connect(ctx.destination);
          osc.frequency.value = 587.33; // D5
          gain.gain.value = 0.3;
          osc.start(); osc.stop(ctx.currentTime + 0.15);
          setTimeout(() => {
            const osc2 = ctx.createOscillator();
            const gain2 = ctx.createGain();
            osc2.connect(gain2); gain2.connect(ctx.destination);
            osc2.frequency.value = 880; // A5
            gain2.gain.value = 0.3;
            osc2.start(); osc2.stop(ctx.currentTime + 0.3);
          }, 180);
        } catch (err) {
          console.warn('AudioContext error:', err);
        }
      }
      ultimoPedidosCountRef.current = pending.length;

      // Filtrar y ordenar historial de hoy (Atendidas/Entregadas)
      const history = allItems.filter(p => p.tipo === 'pedido' && ['listo', 'en_camino', 'entregado'].includes(p.estado));
      history.sort((a, b) => {
        const tA = a.createdAt?.toDate ? a.createdAt.toDate().getTime() : (a.createdAt || 0);
        const tB = b.createdAt?.toDate ? b.createdAt.toDate().getTime() : (b.createdAt || 0);
        return tB - tA;
      });
      setHistorial(history.slice(0, 15));
    }, err => {
      console.error("Error en onSnapshot de cocina:", err);
    });
    return unsub;
  }, []);

  // 3. Escuchar/Sincronizar Insumos en tiempo real
  useEffect(() => {
    const q = query(collection(db, 'cocina_insumos'));
    const unsub = onSnapshot(q, async snap => {
      if (snap.empty) {
        // Sembrar insumos por defecto si la colección está vacía
        for (const item of DEFAULT_INSUMOS) {
          await addDoc(collection(db, 'cocina_insumos'), {
            ...item,
            createdAt: serverTimestamp()
          });
          await syncInsumoToInventario(item, 'add');
        }
        return;
      }
      const items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      // Ordenar por nivel crítico primero
      items.sort((a, b) => (a.nivelActual / a.nivelMin) - (b.nivelActual / b.nivelMin));
      setInsumos(items);
    });
    return unsub;
  }, []);

  // Escuchar alertas predictivas de la IA para insumos
  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'config', 'ia_prevision_insumos'), snap => {
      if (snap.exists()) {
        setIaPrevisiones(snap.data().previsiones || {});
      }
    });
    return unsub;
  }, []);

  // Sincronizador automático de cola offline para surtido de cocina
  useEffect(() => {
    const processOfflineQueue = async () => {
      if (typeof window === 'undefined' || !navigator.onLine) return;
      try {
        const queue = JSON.parse(localStorage.getItem('yoy_pending_surtido_requests') || '[]');
        if (queue.length === 0) return;
        
        console.log(`Procesando cola offline de solicitudes (${queue.length} pendientes)...`);
        const remaining = [];
        for (const item of queue) {
          try {
            if (item.isNewProduct && item.productData) {
              await setDoc(doc(db, 'cocina_insumos', item.id), {
                ...item.productData,
                surtidoSolicitado: item.targetVal,
                surtidoSolicitadoAt: item.targetVal ? serverTimestamp() : null,
                createdAt: serverTimestamp()
              });
            } else {
              await updateDoc(doc(db, 'cocina_insumos', item.id), {
                surtidoSolicitado: item.targetVal,
                surtidoSolicitadoAt: item.targetVal ? serverTimestamp() : null,
                updatedAt: serverTimestamp()
              });
            }
          } catch (err) {
            remaining.push(item);
          }
        }
        localStorage.setItem('yoy_pending_surtido_requests', JSON.stringify(remaining));
      } catch (e) {
        console.error("Error procesando cola offline:", e);
      }
    };

    window.addEventListener('online', processOfflineQueue);
    const interval = setInterval(processOfflineQueue, 15000);
    return () => {
      window.removeEventListener('online', processOfflineQueue);
      clearInterval(interval);
    };
  }, []);

  // 4. Sincronizar Inventario de productos (LocalStorage <-> Firestore)
  useEffect(() => {
    // Escuchar el documento centralizado del inventario en Firestore
    const unsub = onSnapshot(doc(db, 'config', 'inventario'), snap => {
      if (snap.exists()) {
        const firestoreProds = snap.data().productos || [];
        if (firestoreProds.length > 0) {
          setProductos(firestoreProds);
          // Guardar de forma local en el localStorage cifrado
          try {
            localStorage.setItem('yoy_billar_stock', obfuscate(firestoreProds));
          } catch (e) {
            console.error('Error al guardar localmente el stock ofuscado:', e);
          }
        }
      } else {
        // Si no existe en Firestore, jalar de localStorage y subirlo
        try {
          const raw = localStorage.getItem('yoy_billar_stock');
          const localProds = deobfuscate(raw) || [];
          if (localProds.length > 0) {
            setProductos(localProds);
            setDoc(doc(db, 'config', 'inventario'), { productos: localProds, updatedAt: serverTimestamp() });
          } else {
            // Fallback total
            const fallback = [
              { id: 1, nombre: 'Cerveza Corona Extra', categoria: 'Cerveza', precioCosto: 22, precioVenta: 45, stock: 0, stockMin: 30, stockOptimo: 150, unidad: 'bot' },
              { id: 2, nombre: 'Refresco Coca-Cola 355ml', categoria: 'Refresco', precioCosto: 14, precioVenta: 30, stock: 0, stockMin: 20, stockOptimo: 100, unidad: 'pz' },
              { id: 3, nombre: 'Nachos con Queso Gigantes', categoria: 'Snack', precioCosto: 32, precioVenta: 75, stock: 0, stockMin: 15, stockOptimo: 60, unidad: 'porc' },
              { id: 4, nombre: 'Papas Fritas Crujientes', categoria: 'Snack', precioCosto: 20, precioVenta: 55, stock: 0, stockMin: 12, stockOptimo: 50, unidad: 'porc' },
              { id: 5, nombre: 'Alitas de Pollo x10', categoria: 'Comida', precioCosto: 58, precioVenta: 120, stock: 0, stockMin: 10, stockOptimo: 45, unidad: 'pz' },
              { id: 6, nombre: 'Café Americano Organico', categoria: 'Bebida', precioCosto: 12, precioVenta: 35, stock: 0, stockMin: 25, stockOptimo: 120, unidad: 'taza' },
              { id: 7, nombre: 'Agua Embotellada 600ml', categoria: 'Bebida', precioCosto: 8, precioVenta: 20, stock: 0, stockMin: 40, stockOptimo: 180, unidad: 'pz' },
            ];
            setProductos(fallback);
            localStorage.setItem('yoy_billar_stock', obfuscate(fallback));
            setDoc(doc(db, 'config', 'inventario'), { productos: fallback, updatedAt: serverTimestamp() });
          }
        } catch (err) {
          console.warn(err);
        }
      }
    });

    return unsub;
  }, []);

  // Escuchar tecla Escape para cerrar modal de insumos con control de cooldown, desenfoque y confirmación
  useEffect(() => {
    let lastBlurTime = 0;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && showInsumoModal) {
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

        const isModified = newInsumo.nombre !== '' || 
                          newInsumo.nivelActual !== 10 || 
                          newInsumo.nivelMin !== 5 || 
                          newInsumo.nivelOptimo !== 20 || 
                          newInsumo.unidad !== 'pz' || 
                          newInsumo.categoria !== 'Comida';

        if (isModified) {
          if (!window.confirm('¿Deseas salir? Perderás los datos ingresados del insumo.')) {
            return;
          }
        }
        handleCloseInsumoModal();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showInsumoModal, newInsumo, handleCloseInsumoModal]);

  // ── ACCIONES DE PEDIDO ───────────────────────────────────
  const marcarAtendido = async (id) => {
    try {
      await updateDoc(doc(db, 'mesa_pedidos', id), {
        estado: 'listo',
        atendidoMesero: false, // Reset mesero notification status so they get the popup again
        cocinaAtendidoAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      alert('Error al actualizar pedido: ' + err.message);
    }
  };

  // ── ACCIONES DE INSUMO ───────────────────────────────────
  const guardarInsumo = async (e) => {
    e.preventDefault();
    if (!newInsumo.nombre) return;
    try {
      const insData = {
        ...newInsumo,
        nivelActual: Number(newInsumo.nivelActual),
        nivelMin: Number(newInsumo.nivelMin),
        nivelOptimo: Number(newInsumo.nivelOptimo),
        toleranciaDesviacion: Number(newInsumo.toleranciaDesviacion || 25)
      };
      await addDoc(collection(db, 'cocina_insumos'), {
        ...insData,
        createdAt: serverTimestamp()
      });
      await syncInsumoToInventario(insData, 'add');
      setShowInsumoModal(false);
      setNewInsumo({ nombre: '', nivelActual: 10, nivelMin: 5, nivelOptimo: 20, unidad: 'pz', categoria: 'Comida', toleranciaDesviacion: 25 });
    } catch (err) {
      alert('Error al agregar insumo: ' + err.message);
    }
  };

  const guardarEdicionInsumo = async (e) => {
    e.preventDefault();
    if (!editingInsumo || !editingInsumo.nombre) return;
    try {
      const docRef = doc(db, 'cocina_insumos', editingInsumo.id);
      const updatedData = {
        nombre: editingInsumo.nombre,
        categoria: editingInsumo.categoria,
        unidad: editingInsumo.unidad,
        nivelActual: Number(editingInsumo.nivelActual),
        nivelMin: Number(editingInsumo.nivelMin),
        nivelOptimo: Number(editingInsumo.nivelOptimo),
        toleranciaDesviacion: Number(editingInsumo.toleranciaDesviacion || 25)
      };
      await updateDoc(docRef, {
        ...updatedData,
        updatedAt: serverTimestamp()
      });
      await syncInsumoToInventario({
        ...updatedData
      }, 'update');
      setEditingInsumo(null);
    } catch (err) {
      alert('Error al editar insumo: ' + err.message);
    }
  };

  const eliminarInsumo = async (id, nombre) => {
    if (!window.confirm(`¿Estás seguro de que deseas eliminar el insumo "${nombre}"?`)) return;
    try {
      await deleteDoc(doc(db, 'cocina_insumos', id));
      await syncInsumoToInventario({ nombre }, 'delete');
      setEditingInsumo(null);
    } catch (err) {
      alert('Error al eliminar insumo: ' + err.message);
    }
  };

  const modificarInsumoNivel = async (id, delta) => {
    const ins = insumos.find(i => i.id === id);
    if (!ins) return;
    const nuevoNivel = Math.max(0, ins.nivelActual + delta);
    try {
      await updateDoc(doc(db, 'cocina_insumos', id), {
        nivelActual: nuevoNivel,
        updatedAt: serverTimestamp()
      });
      await syncInsumoToInventario({
        ...ins,
        nivelActual: nuevoNivel
      }, 'update');
    } catch (err) {
      console.error(err);
    }
  };

  const toggleSolicitudSurtido = async (id, currentVal) => {
    if (updatingIds.has(id)) return;
    setUpdatingIds(prev => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
    const targetVal = !currentVal;
    try {
      await updateDoc(doc(db, 'cocina_insumos', id), {
        surtidoSolicitado: targetVal,
        surtidoSolicitadoAt: targetVal ? serverTimestamp() : null,
        updatedAt: serverTimestamp()
      });
    } catch (err) {
      console.warn("Fallo en red al cambiar solicitud de surtido de cocina, encolando offline:", err);
      try {
        const queue = JSON.parse(localStorage.getItem('yoy_pending_surtido_requests') || '[]');
        if (!queue.some(item => item.id === id)) {
          queue.push({ id, targetVal, timestamp: Date.now() });
          localStorage.setItem('yoy_pending_surtido_requests', JSON.stringify(queue));
        }
      } catch (e) {
        console.error("Error al guardar en localStorage offline queue:", e);
      }
    } finally {
      setUpdatingIds(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };
  
  const solicitarProducto = async (product) => {
    const keyId = `prod-${product.id}`;
    if (updatingIds.has(keyId)) return;
    
    setUpdatingIds(prev => {
      const next = new Set(prev);
      next.add(keyId);
      return next;
    });

    const insumoExistente = insumos.find(i => i.nombre.toLowerCase() === product.nombre.toLowerCase());
    const targetVal = insumoExistente ? !insumoExistente.surtidoSolicitado : true;
    const docId = insumoExistente ? insumoExistente.id : doc(collection(db, 'cocina_insumos')).id;

    try {
      if (insumoExistente) {
        await updateDoc(doc(db, 'cocina_insumos', docId), {
          surtidoSolicitado: targetVal,
          surtidoSolicitadoAt: targetVal ? serverTimestamp() : null,
          updatedAt: serverTimestamp()
        });
      } else {
        await setDoc(doc(db, 'cocina_insumos', docId), {
          nombre: product.nombre,
          nivelActual: Number(product.stock),
          nivelMin: Number(product.stockMin || 0),
          nivelOptimo: Number(product.stockOptimo || product.stockMin * 2 || 10),
          unidad: product.unidad || 'pz',
          categoria: product.categoria,
          surtidoSolicitado: targetVal,
          surtidoSolicitadoAt: targetVal ? serverTimestamp() : null,
          createdAt: serverTimestamp()
        });
      }
    } catch (err) {
      console.warn("Fallo en red al solicitar producto, encolando offline:", err);
      try {
        const queue = JSON.parse(localStorage.getItem('yoy_pending_surtido_requests') || '[]');
        if (!queue.some(item => item.id === docId)) {
          queue.push({ 
            id: docId, 
            targetVal, 
            timestamp: Date.now(), 
            isNewProduct: !insumoExistente, 
            productData: !insumoExistente ? {
              nombre: product.nombre,
              nivelActual: Number(product.stock),
              nivelMin: Number(product.stockMin || 0),
              nivelOptimo: Number(product.stockOptimo || product.stockMin * 2 || 10),
              unidad: product.unidad || 'pz',
              categoria: product.categoria
            } : null 
          });
          localStorage.setItem('yoy_pending_surtido_requests', JSON.stringify(queue));
        }
      } catch (e) {
        console.error("Error al guardar en localStorage offline queue para producto:", e);
      }
    } finally {
      setUpdatingIds(prev => {
        const next = new Set(prev);
        next.delete(keyId);
        return next;
      });
    }
  };

  const handleAbrirCierreTurno = () => {
    const criticos = insumos.filter(ins => ins.nivelActual <= ins.nivelMin);
    const noCriticos = insumos.filter(ins => ins.nivelActual > ins.nivelMin);
    const seleccionados = [...criticos, ...noCriticos].slice(0, 5).map(ins => ({
      id: ins.id,
      nombre: ins.nombre,
      unidad: ins.unidad,
      nivelActual: ins.nivelActual,
      conteoFisico: ins.nivelActual,
      nivelMin: ins.nivelMin,
      nivelOptimo: ins.nivelOptimo,
      categoria: ins.categoria,
      toleranciaDesviacion: ins.toleranciaDesviacion !== undefined ? ins.toleranciaDesviacion : 25
    }));
    setCierreInsumos(seleccionados);
    setShowCierreTurnoModal(true);
  };

  const guardarCierreTurno = async (e) => {
    e.preventDefault();
    try {
      const detallesList = [];
      for (const item of cierreInsumos) {
        const docRef = doc(db, 'cocina_insumos', item.id);
        const conteo = Number(item.conteoFisico);
        await updateDoc(docRef, {
          nivelActual: conteo,
          updatedAt: serverTimestamp()
        });
        await syncInsumoToInventario({
          nombre: item.nombre,
          nivelActual: conteo,
          nivelMin: item.nivelMin,
          nivelOptimo: item.nivelOptimo,
          unidad: item.unidad,
          categoria: item.categoria,
          toleranciaDesviacion: item.toleranciaDesviacion
        }, 'update');
        detallesList.push(`${item.nombre}: ${conteo} ${item.unidad}`);
      }
      await addDoc(collection(db, 'bitacora'), {
        fecha: new Date().toISOString(),
        tipo: 'cocina',
        operador: user?.nombre || user?.name || 'Personal Cocina',
        rolOperador: 'cocina',
        accion: 'Cierre Turno Cocina',
        detalle: `Cierre de Turno y Conciliación Física de Insumos: ${detallesList.join(', ')}`,
        monto: 0
      });
      setShowCierreTurnoModal(false);
      alert('¡Cierre de Turno y Conciliación de Insumos guardado correctamente en inventario y bitácora! ✓');
    } catch (err) {
      alert('Error al procesar Cierre de Turno: ' + err.message);
    }
  };

  // ── ACCIONES DE PRODUCTO (INVENTARIO DE BEBIDAS Y VENTAS) ───────────
  const modificarProductoStock = async (id, delta) => {
    const actualizados = productos.map(p => {
      if (p.id === id) {
        return { ...p, stock: Math.max(0, p.stock + delta), lastModified: Date.now() };
      }
      return p;
    });
    setProductos(actualizados);

    try {
      // Guardar en local storage (ofuscado)
      localStorage.setItem('yoy_billar_stock', obfuscate(actualizados));
      // Sincronizar con Firestore
      await setDoc(doc(db, 'config', 'inventario'), {
        productos: actualizados,
        updatedAt: serverTimestamp()
      });
    } catch (err) {
      console.error('Error al sincronizar el stock modificado:', err);
    }
  };

  // ── COPIAR FALTANTES WHATSAPP ────────────────────────────
  const copiarFaltantesWhatsApp = () => {
    const faltantes = insumos.filter(ins => ins.nivelActual <= ins.nivelMin);
    const bajos = insumos.filter(ins => ins.nivelActual > ins.nivelMin && ins.nivelActual <= ins.nivelMin * 1.5);

    if (faltantes.length === 0 && bajos.length === 0) {
      alert('¡Todo está en orden! No hay insumos en nivel bajo o faltante.');
      return;
    }

    let texto = `*⚠️ REPORTE DE INSUMOS DE COCINA - YOY IA BILLAR*\n`;
    texto += `Fecha: ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}\n\n`;

    if (faltantes.length > 0) {
      texto += `*❌ INSUMOS FALTANTES (CRÍTICOS):*\n`;
      faltantes.forEach(ins => {
        texto += `- ${ins.nombre}: ${ins.nivelActual}/${ins.nivelOptimo} ${ins.unidad} (Mín: ${ins.nivelMin})\n`;
      });
      texto += `\n`;
    }

    if (bajos.length > 0) {
      texto += `*🚨 INSUMOS BAJOS:*\n`;
      bajos.forEach(ins => {
        texto += `- ${ins.nombre}: ${ins.nivelActual}/${ins.nivelOptimo} ${ins.unidad} (Mín: ${ins.nivelMin})\n`;
      });
      texto += `\n`;
    }

    texto += `Por favor surtir lo antes posible. ¡Gracias!`;

    navigator.clipboard.writeText(texto)
      .then(() => {
        const url = `https://api.whatsapp.com/send?text=${encodeURIComponent(texto)}`;
        window.open(url, '_blank');
      })
      .catch(err => {
        console.error('Error al copiar al portapapeles: ', err);
        const url = `https://api.whatsapp.com/send?text=${encodeURIComponent(texto)}`;
        window.open(url, '_blank');
      });
  };

  // ── FILTROS INVENTARIO ───────────────────────────────────
  const productosFiltrados = productos.filter(p => {
    const catOk = filtroCat === 'Todas' || p.categoria === filtroCat;
    const busOk = !busquedaProd || p.nombre.toLowerCase().includes(busquedaProd.toLowerCase());
    return catOk && busOk;
  });

  const CATEGORIAS_PRODUCTO = ['Todas', 'Cerveza', 'Refresco', 'Snack', 'Comida', 'Bebida'];

  // Helper para porcentaje visual de barra
  const getPorcentajeInsumo = (ins) => {
    const pct = (ins.nivelActual / ins.nivelOptimo) * 100;
    return Math.min(100, Math.max(0, pct));
  };

  const getColorInsumo = (ins) => {
    if (ins.nivelActual <= ins.nivelMin) return 'var(--danger)'; // Rojo crítico
    if (ins.nivelActual <= ins.nivelMin * 1.5) return 'var(--warning)'; // Amarillo bajo
    return 'var(--success)'; // Verde saludable
  };

  // Tiempo transcurrido helper
  const tiempoTranscurrido = (fecha) => {
    if (!fecha?.toDate) return '—';
    const seg = Math.floor((Date.now() - fecha.toDate().getTime()) / 1000);
    if (seg < 60) return `${seg}s`;
    if (seg < 3600) return `${Math.floor(seg / 60)}min`;
    return `${Math.floor(seg / 3600)}h`;
  };

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-primary)', padding: '0 0 50px' }}>
      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes transmittingRadar {
          0% {
            transform: scale(1);
            box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.7);
          }
          70% {
            transform: scale(1.05);
            box-shadow: 0 0 0 10px rgba(239, 68, 68, 0);
          }
          100% {
            transform: scale(1);
            box-shadow: 0 0 0 0 rgba(239, 68, 68, 0);
          }
        }
        .radar-active {
          animation: transmittingRadar 1.5s infinite;
        }
      `}} />
      
      {/* ── HEADER ── */}
      <div style={{ background: 'var(--bg-card)', borderBottom: '1px solid var(--border-bronze)', padding: '16px 24px', position: 'sticky', top: 0, zIndex: 100 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', maxWidth: 1000, margin: '0 auto' }}>
          <div>
            <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--bronze-light)', display: 'flex', alignItems: 'center', gap: 10 }}>
              🍳 Pantalla de Cocina {user?.name ? `· ${user.alias || user.name.split(' ')[0]}` : ''}
            </h1>
            {user && (
              <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.4)', marginTop: 4, display: 'flex', flexWrap: 'wrap', gap: '8px 12px', fontFamily: 'monospace' }}>
                <span style={{ color: 'var(--success)' }}>🏢 Salón: {getActiveSalonId()}</span>
                <span>📋 Pendientes Cocina: {pedidos.length}</span>
                <span>👤 Rol: {user.role}</span>
                <span style={{ color: '#cd7f32' }}>🔑 SalonUsr: {user.salonId || 'null'}</span>
              </div>
            )}
            <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 6 }}>
              Monitoreo de comandas en tiempo real, insumos críticos e inventario general
            </p>
          </div>

          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            {/* Sonido Toggle */}
            <button
              onClick={() => setSonido(!sonido)}
              style={{
                background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 10,
                padding: '8px 14px', cursor: 'pointer', color: sonido ? 'var(--bronze-light)' : 'var(--text-muted)',
                fontSize: 13, display: 'flex', alignItems: 'center', gap: 6
              }}
            >
              <i className={sonido ? 'ri-volume-up-line' : 'ri-volume-mute-line'} />
              {sonido ? 'Sonido ON' : 'Silencio'}
            </button>

            {/* Botón Cerrar Sesión */}
            <button
              onClick={handleLogout}
              title="Cerrar Sesión"
              style={{
                background: 'var(--bg-elevated)',
                border: '1px solid rgba(239,68,68,0.3)',
                borderRadius: 10,
                padding: '8px 14px',
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

            {/* Volver a Inicio */}
            <button
              onClick={() => {
                window.location.href = '/';
              }}
              style={{
                width: 38, height: 38, background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)',
                borderRadius: 10, cursor: 'pointer', color: '#ef4444', fontSize: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.2s'
              }}
              onMouseEnter={e => e.currentTarget.style.background = 'rgba(239,68,68,0.18)'}
              onMouseLeave={e => e.currentTarget.style.background = 'rgba(239,68,68,0.08)'}
              title="Cerrar cocina y volver"
            >
              <i className="ri-close-line" />
            </button>
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 1000, margin: '24px auto 0', padding: '0 16px' }}>

        {/* ── TABS NAVEGACIÓN INTERNA ── */}
        <div style={{ display: 'flex', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 14, padding: 4, marginBottom: 24 }}>
          {[
            { id: 'pedidos', label: 'Comandas Activas', icon: 'ri-restaurant-line', count: pedidos.length },
            { id: 'insumos', label: 'Checklist de Insumos', icon: 'ri-checkbox-list-line', count: insumos.filter(i => i.nivelActual < (i.nivelOptimo || 0)).length },
            { id: 'inventario', label: 'Inventario General', icon: 'ri-archive-line', count: productos.filter(p => p.stock <= p.stockMin).length }
          ].map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              style={{
                flex: 1, padding: '12px 16px', background: tab === t.id ? 'var(--bronze-subtle)' : 'none',
                border: 'none', borderRadius: 10, color: tab === t.id ? 'var(--bronze-light)' : 'var(--text-secondary)',
                fontSize: 14, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, transition: 'all 0.2s'
              }}
            >
              <i className={t.icon} style={{ fontSize: 16 }} />
              {t.label}
              {t.count > 0 && (
                <span style={{
                  background: t.id === 'pedidos' ? 'var(--bronze-light)' : 'var(--danger)',
                  color: t.id === 'pedidos' ? '#0d0d0f' : '#fff',
                  fontSize: 10, fontWeight: 900, borderRadius: 99, padding: '2px 8px', marginLeft: 4
                }}>
                  {t.count}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* ════════════════════════ TAB: PEDIDOS ════════════════════════ */}
        {tab === 'pedidos' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 20, alignItems: 'start' }}>
            
            {/* Lado Izquierdo: Comandas Activas */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <h2 style={{ fontSize: 15, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)', fontWeight: 800 }}>
                  Pedidos pendientes por preparar ({pedidos.length})
                </h2>
              </div>

              {pedidos.length === 0 ? (
                <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 16, padding: '60px 20px', textAlign: 'center', color: 'var(--text-muted)' }}>
                  <i className="ri-bowl-line" style={{ fontSize: 56, color: 'var(--success)', display: 'block', marginBottom: 16 }} />
                  <h3 style={{ fontSize: 18, fontWeight: 800, color: '#fff', marginBottom: 6 }}>¡Cocina limpia!</h3>
                  <p style={{ fontSize: 13 }}>No hay comandan pendientes en este momento. Buen trabajo.</p>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  {pedidos.map(pedido => {
                    const esUrgente = pedido.createdAt?.toDate && (Date.now() - pedido.createdAt.toDate().getTime()) > 5 * 60 * 1000;
                    return (
                      <div
                        key={pedido.id}
                        style={{
                          background: 'var(--bg-card)',
                          border: `1px solid ${esUrgente ? 'var(--danger)' : 'var(--border-bronze)'}`,
                          boxShadow: esUrgente ? '0 0 20px rgba(239,68,68,0.15)' : 'none',
                          borderRadius: 16, padding: 18, position: 'relative'
                        }}
                      >
                        {/* Header comanda */}
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, borderBottom: '1px solid var(--border)', paddingBottom: 10 }}>
                          <div>
                            <span style={{ fontSize: 18, fontWeight: 900, color: 'var(--bronze-light)' }}>
                              Mesa {pedido.mesaId}
                            </span>
                            {pedido.cliente && 
                             !pedido.cliente.toLowerCase().startsWith('mesa ') && 
                             pedido.cliente.toLowerCase() !== 'público' && 
                             pedido.cliente.toLowerCase() !== 'publico' ? (
                              <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 8 }}>
                                ({pedido.cliente})
                              </span>
                            ) : (
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 9, background: 'rgba(239, 68, 68, 0.12)', border: '1px solid rgba(239, 68, 68, 0.3)', color: 'var(--danger)', padding: '2px 6px', borderRadius: 4, fontWeight: 700, marginLeft: 8 }}>
                                <i className="ri-error-warning-line" /> SIN CLIENTE ASIGNADO
                              </span>
                            )}
                          </div>
                          <div style={{ textAlign: 'right' }}>
                            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                              Ordenado hace: <strong style={{ color: esUrgente ? 'var(--danger)' : '#fff' }}>{tiempoTranscurrido(pedido.createdAt)}</strong>
                            </span>
                            {esUrgente && (
                              <span style={{ display: 'block', fontSize: 9, background: 'var(--danger)', color: '#fff', padding: '1px 6px', borderRadius: 4, fontWeight: 900, marginTop: 4, textAlign: 'center', textTransform: 'uppercase' }}>
                                Retrasado
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Contenido comanda */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, margin: '12px 0 16px' }}>
                          {pedido.items?.map((item, index) => (
                            <div key={index} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.03)', borderRadius: 10, padding: '10px 14px' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                <span style={{ fontSize: 20 }}>{CAT_EMOJI[item.categoria] || '🛒'}</span>
                                <span style={{ fontSize: 14, fontWeight: 700, color: '#fff' }}>
                                  {item.nombre}
                                </span>
                              </div>
                              <span style={{ fontSize: 18, fontWeight: 900, color: 'var(--bronze-light)', background: 'var(--bronze-subtle)', border: '1px solid var(--border-bronze)', borderRadius: 8, padding: '4px 12px' }}>
                                {item.cantidad}×
                              </span>
                            </div>
                          ))}
                        </div>

                        {/* Acción comanda */}
                        <button
                          onClick={() => marcarAtendido(pedido.id)}
                          style={{
                            width: '100%', padding: '12px', background: 'var(--bronze)', color: '#0d0d0f',
                            border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 800, cursor: 'pointer',
                            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, transition: 'all 0.2s'
                          }}
                          onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.boxShadow = '0 4px 15px rgba(205,127,50,0.3)'; }}
                          onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = 'none'; }}
                        >
                          <i className="ri-check-line" style={{ fontSize: 18 }} />
                          Pedido Listo (Notificar al mesero)
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Lado Derecho: Historial de comandas listas / recientes */}
            <div>
              <h2 style={{ fontSize: 13, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)', fontWeight: 800, marginBottom: 16 }}>
                Comandas completadas hoy ({historial.length})
              </h2>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxHeight: '65vh', overflowY: 'auto' }}>
                {historial.map(pedido => (
                  <div key={pedido.id} style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 12, padding: 12, fontSize: 12 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: 6, marginBottom: 6 }}>
                      <span style={{ fontWeight: 800, color: 'var(--text-secondary)' }}>
                        Mesa {pedido.mesaId}
                        {pedido.cliente && 
                         !pedido.cliente.toLowerCase().startsWith('mesa ') && 
                         pedido.cliente.toLowerCase() !== 'público' && 
                         pedido.cliente.toLowerCase() !== 'publico' ? (
                          ` (${pedido.cliente})`
                        ) : (
                          <span style={{ color: 'var(--danger)', fontSize: 9, marginLeft: 4, fontWeight: 'normal' }}> (Sin Cliente)</span>
                        )}
                      </span>
                      <span style={{
                        fontSize: 9, fontWeight: 800, padding: '1px 6px', borderRadius: 99,
                        background: pedido.estado === 'entregado' ? 'rgba(34,197,94,0.15)' : 'rgba(205,127,50,0.15)',
                        color: pedido.estado === 'entregado' ? 'var(--success)' : 'var(--bronze-light)'
                      }}>
                        {pedido.estado === 'entregado' ? 'Entregado ✓' : 'Listo en Cocina'}
                      </span>
                    </div>
                    <div>
                      {pedido.items?.map((item, idx) => (
                        <div key={idx} style={{ color: 'var(--text-secondary)', padding: '2px 0' }}>
                          {item.cantidad}× {item.nombre}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
                {historial.length === 0 && (
                  <p style={{ color: 'var(--text-muted)', fontSize: 12, textAlign: 'center', padding: '20px 0' }}>
                    Ningún pedido completado todavía.
                  </p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ════════════════════════ TAB: INSUMOS ════════════════════════ */}
        {tab === 'insumos' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div>
                <h2 style={{ fontSize: 16, fontWeight: 800, color: '#fff' }}>Checklist de Insumos e Ingredientes</h2>
                <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
                  Registra qué insumos hacen falta y controla sus niveles de manera muy visual
                </p>
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                <button
                  onClick={copiarFaltantesWhatsApp}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, padding: '8px 16px',
                    background: 'rgba(34,197,94,0.15)', border: '1px solid rgba(34,197,94,0.3)',
                    borderRadius: 10, cursor: 'pointer', color: 'var(--success)', fontWeight: 700,
                    transition: 'all 0.2s'
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = 'rgba(34,197,94,0.25)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'rgba(34,197,94,0.15)'}
                >
                  📋 Copiar Faltantes WhatsApp
                </button>
                <button
                  className="btn btn-primary"
                  onClick={handleAbrirCierreTurno}
                  style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, padding: '8px 16px', background: 'var(--bronze-dark)', borderColor: 'var(--border-bronze)' }}
                >
                  <i className="ri-shut-down-line" /> Cierre de Turno
                </button>
                <button
                  className="btn btn-primary"
                  onClick={() => setShowInsumoModal(true)}
                  style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, padding: '8px 16px' }}
                >
                  <i className="ri-add-line" /> Agregar Insumo
                </button>
              </div>
            </div>

            {/* Listado Visual de Insumos en Formato de Lista */}
            <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 16, padding: '16px 20px', marginTop: 16 }}>
              <div style={{ overflowX: 'auto' }}>
                <table className="table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--border)', textAlign: 'left', color: 'var(--text-muted)' }}>
                      <th style={{ padding: '12px 8px' }}>Insumo</th>
                      <th style={{ padding: '12px 8px' }}>Categoría</th>
                      <th style={{ padding: '12px 8px', textAlign: 'center' }}>Nivel Actual / Óptimo</th>
                      <th style={{ padding: '12px 8px', width: 180 }}>Progreso</th>
                      <th style={{ padding: '12px 8px', textAlign: 'center' }}>Estado</th>
                      <th style={{ padding: '12px 8px', textAlign: 'center' }}>Tolerancia IA</th>
                      <th style={{ padding: '12px 8px', textAlign: 'center' }}>Solicitar Surtido</th>
                      <th style={{ padding: '12px 8px', textAlign: 'center' }}>Ajustar Nivel</th>
                      <th style={{ padding: '12px 8px', textAlign: 'center' }}>Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {insumos.map(ins => {
                      const esCritico = ins.nivelActual <= ins.nivelMin;
                      const pct = getPorcentajeInsumo(ins);
                      const color = getColorInsumo(ins);
                      const iaPrevision = iaPrevisiones[ins.nombre];
                      const tieneRiesgoIA = iaPrevision && iaPrevision.riesgoDesabasto === true;

                      return (
                        <tr key={ins.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)', verticalAlign: 'middle' }}>
                          <td style={{ padding: '10px 8px' }}>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <span style={{ fontSize: 14, fontWeight: 800, color: '#fff' }}>{ins.nombre}</span>
                                {tieneRiesgoIA && (
                                  <span 
                                    title={iaPrevision.motivo} 
                                    style={{
                                      display: 'inline-flex', alignItems: 'center', gap: 3,
                                      fontSize: 9, background: 'rgba(239, 68, 68, 0.12)',
                                      color: 'var(--danger)', border: '1px solid rgba(239, 68, 68, 0.3)',
                                      borderRadius: 6, padding: '1px 6px', fontWeight: 800, cursor: 'help'
                                    }}
                                  >
                                    <i className="ri-brain-line" /> IA RIESGO
                                  </span>
                                )}
                              </div>
                              {tieneRiesgoIA && (
                                <span style={{ fontSize: 9, color: 'var(--danger)', fontWeight: 600 }}>
                                  ⚠️ {iaPrevision.motivo}
                                </span>
                              )}
                            </div>
                          </td>
                          <td style={{ padding: '10px 8px' }}>
                            <span style={{ fontSize: 9, background: 'var(--bg-elevated)', color: 'var(--text-muted)', padding: '2px 6px', borderRadius: 4, textTransform: 'uppercase' }}>
                              {ins.categoria}
                            </span>
                          </td>
                          <td style={{ padding: '10px 8px', textAlign: 'center', fontWeight: 600 }}>
                            <span style={{ color: color }}>{ins.nivelActual}</span> / <span style={{ color: 'var(--text-muted)' }}>{ins.nivelOptimo} {ins.unidad}</span>
                            <div style={{ fontSize: 9, color: 'var(--text-muted)', fontWeight: 'normal' }}>Mínimo: {ins.nivelMin}</div>
                          </td>
                          <td style={{ padding: '10px 8px' }}>
                            <div style={{ width: '100%', height: 6, background: 'var(--bg-elevated)', borderRadius: 99, overflow: 'hidden', border: '1px solid var(--border)' }}>
                              <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 99, transition: 'width 0.3s ease' }} />
                            </div>
                          </td>
                          <td style={{ padding: '10px 8px', textAlign: 'center' }}>
                            <span style={{
                              fontSize: 9, fontWeight: 900, padding: '2px 8px', borderRadius: 99,
                              background: `${color}15`, color: color, border: `1px solid ${color}30`
                            }}>
                              {ins.nivelActual <= ins.nivelMin ? 'FALTANTE ⚠️' : ins.nivelActual < ins.nivelOptimo ? 'BAJO OPTIMO 🚨' : 'SUFICIENTE ✓'}
                            </span>
                          </td>
                          <td style={{ padding: '10px 8px', textAlign: 'center', fontSize: 11, color: 'var(--text-secondary)' }}>
                            {ins.toleranciaDesviacion !== undefined ? ins.toleranciaDesviacion : 25}%
                          </td>
                          <td style={{ padding: '10px 8px', textAlign: 'center' }}>
                            <button
                              onClick={() => toggleSolicitudSurtido(ins.id, ins.surtidoSolicitado)}
                              disabled={updatingIds.has(ins.id)}
                              className={ins.surtidoSolicitado ? 'radar-active' : ''}
                              style={{
                                padding: '6px 12px',
                                borderRadius: '8px',
                                fontSize: '11px',
                                fontWeight: 'bold',
                                border: ins.surtidoSolicitado ? '1px solid #ef4444' : '1px solid var(--border)',
                                background: ins.surtidoSolicitado ? '#ef4444' : 'var(--bg-elevated)',
                                color: ins.surtidoSolicitado ? '#fff' : 'var(--text-secondary)',
                                cursor: updatingIds.has(ins.id) ? 'not-allowed' : 'pointer',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '6px',
                                transition: 'all 0.2s',
                                opacity: updatingIds.has(ins.id) ? 0.6 : 1
                              }}
                            >
                              <i className={updatingIds.has(ins.id) ? "ri-loader-4-line ri-spin" : (ins.surtidoSolicitado ? "ri-broadcast-line" : "ri-signal-tower-line")} style={{ fontSize: 13 }} />
                              {updatingIds.has(ins.id) ? 'Procesando...' : (ins.surtidoSolicitado ? 'Solicitado' : 'Solicitar')}
                            </button>
                          </td>
                          <td style={{ padding: '10px 8px', textAlign: 'center' }}>
                            <div style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                              <button
                                className="btn btn-secondary btn-icon"
                                style={{ width: 26, height: 26, minWidth: 26, padding: 0 }}
                                onClick={() => modificarInsumoNivel(ins.id, -1)}
                              >
                                −
                              </button>
                              <span style={{ fontSize: 13, fontWeight: 700, minWidth: 24, textAlign: 'center' }}>{ins.nivelActual}</span>
                              <button
                                className="btn btn-secondary btn-icon"
                                style={{ width: 26, height: 26, minWidth: 26, padding: 0 }}
                                onClick={() => modificarInsumoNivel(ins.id, 1)}
                              >
                                +
                              </button>
                            </div>
                          </td>
                          <td style={{ padding: '10px 8px', textAlign: 'center' }}>
                            <button
                              onClick={() => setEditingInsumo(ins)}
                              className="btn btn-secondary btn-icon"
                              style={{ width: 28, height: 28, minWidth: 28, padding: 0, color: 'var(--bronze-light)' }}
                              title="Editar Insumo"
                            >
                              <i className="ri-settings-4-line" />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ════════════════════════ TAB: INVENTARIO ════════════════════════ */}
        {tab === 'inventario' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 12 }}>
              <div>
                <h2 style={{ fontSize: 16, fontWeight: 800, color: '#fff' }}>Inventario de Bebidas y Ventas</h2>
                <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
                  Productos generales de todo el negocio. La cocina puede despachar bebidas y snacks directamente.
                </p>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  type="text"
                  placeholder="Buscar producto..."
                  className="form-input"
                  style={{ width: 200, padding: '6px 12px', fontSize: 13 }}
                  value={busquedaProd}
                  onChange={e => setBusquedaProd(e.target.value)}
                />
              </div>
            </div>

            {/* Categorías de Filtro */}
            <div style={{ display: 'flex', gap: 6, marginBottom: 20, overflowX: 'auto', paddingBottom: 6 }}>
              {CATEGORIAS_PRODUCTO.map(c => (
                <button
                  key={c}
                  onClick={() => setFiltroCat(c)}
                  className={`btn btn-sm ${filtroCat === c ? 'btn-primary' : 'btn-secondary'}`}
                  style={{ fontSize: 11, padding: '6px 12px' }}
                >
                  {c}
                </button>
              ))}
            </div>

            {/* Listado del Inventario */}
            <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 16, padding: 16, overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, textAlign: 'left' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border)', color: 'var(--text-muted)' }}>
                    <th style={{ padding: '10px 8px' }}>Producto</th>
                    <th style={{ padding: '10px 8px' }}>Categoría</th>
                    <th style={{ padding: '10px 8px', textAlign: 'center' }}>Stock</th>
                    <th style={{ padding: '10px 8px', textAlign: 'center' }}>Mínimo</th>
                    <th style={{ padding: '10px 8px', textAlign: 'right' }}>Precio Venta</th>
                    <th style={{ padding: '10px 8px', textAlign: 'center' }}>Solicitar</th>
                  </tr>
                </thead>
                <tbody>
                  {productosFiltrados.map(p => {
                    const esCritico = p.stock <= p.stockMin;
                    const emoji = CAT_EMOJI[p.categoria] || CAT_EMOJI.default;
                    const insumoExistente = insumos.find(i => i.nombre.toLowerCase() === p.nombre.toLowerCase());
                    const surtidoSolicitado = insumoExistente ? insumoExistente.surtidoSolicitado : false;
                    const keyId = `prod-${p.id}`;
                    const isProcessing = updatingIds.has(keyId);

                    return (
                      <tr key={p.id} style={{ borderBottom: '1px solid var(--border)', background: esCritico ? 'rgba(239,68,68,0.02)' : 'none' }}>
                        <td style={{ padding: '12px 8px', fontWeight: 600 }}>
                          <span style={{ marginRight: 8 }}>{emoji}</span>
                          {p.nombre}
                        </td>
                        <td style={{ padding: '12px 8px', color: 'var(--text-secondary)' }}>{p.categoria}</td>
                        <td style={{ padding: '12px 8px', textAlign: 'center', fontWeight: 700, color: esCritico ? 'var(--danger)' : 'var(--text-primary)' }}>
                          {p.stock} <span style={{ fontSize: 10, fontWeight: 400, color: 'var(--text-muted)' }}>{p.unidad || 'pz'}</span>
                        </td>
                        <td style={{ padding: '12px 8px', textAlign: 'center', color: 'var(--text-muted)' }}>{p.stockMin}</td>
                        <td style={{ padding: '12px 8px', textAlign: 'right', fontWeight: 700 }}>${p.precioVenta}</td>
                        <td style={{ padding: '12px 8px', textAlign: 'center' }}>
                          <button
                            onClick={() => solicitarProducto(p)}
                            disabled={isProcessing}
                            className={surtidoSolicitado ? 'radar-active' : ''}
                            style={{
                              padding: '6px 12px',
                              borderRadius: '8px',
                              fontSize: '11px',
                              fontWeight: 'bold',
                              border: surtidoSolicitado ? '1px solid #ef4444' : '1px solid var(--border)',
                              background: surtidoSolicitado ? '#ef4444' : 'var(--bg-elevated)',
                              color: surtidoSolicitado ? '#fff' : 'var(--text-secondary)',
                              cursor: isProcessing ? 'not-allowed' : 'pointer',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '6px',
                              transition: 'all 0.2s',
                              opacity: isProcessing ? 0.6 : 1
                            }}
                          >
                            <i className={isProcessing ? "ri-loader-4-line ri-spin" : (surtidoSolicitado ? "ri-broadcast-line" : "ri-signal-tower-line")} style={{ fontSize: 13 }} />
                            {isProcessing ? 'Procesando...' : (surtidoSolicitado ? 'Solicitado' : 'Solicitar')}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                  {productosFiltrados.length === 0 && (
                    <tr>
                      <td colSpan="6" style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '24px 0' }}>
                        No se encontraron productos en esta categoría.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {showInsumoModal && (
        <div 
          className={`modal-overlay ${isClosing ? 'modal-closing' : ''}`}
          style={{ background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(5px)', zIndex: 1000 }}
          onClick={handleCloseInsumoModal}
        >
          <div className="card modal" style={{ width: '100%', maxWidth: 450, padding: 24, border: '1px solid var(--border-bronze)', boxShadow: 'var(--shadow-bronze)', animation: 'fadeIn 0.25s ease', textAlign: 'left' }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h3 style={{ fontSize: 16, fontWeight: 700, margin: 0, textTransform: 'uppercase', letterSpacing: '0.1em' }} className="gradient-bronze">
                <i className="ri-add-box-line" style={{ marginRight: 8 }} />Nuevo Insumo de Cocina
              </h3>
              <button
                onClick={handleCloseInsumoModal}
                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 20 }}
              >
                <i className="ri-close-line" />
              </button>
            </div>

            <form onSubmit={guardarInsumo} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div className="form-group">
                <label className="form-label">Nombre del Insumo / Ingrediente</label>
                <input
                  className="form-input"
                  placeholder="Ej: Carne de Hamburguesa, Aceite, Salsa BBQ"
                  value={newInsumo.nombre}
                  onChange={e => setNewInsumo(p => ({ ...p, nombre: e.target.value }))}
                  required
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div className="form-group">
                  <label className="form-label">Categoría</label>
                  <select
                    className="form-input"
                    value={newInsumo.categoria}
                    onChange={e => setNewInsumo(p => ({ ...p, categoria: e.target.value }))}
                    style={{ background: 'var(--bg-elevated)', color: 'var(--text-main)', border: '1px solid var(--border)' }}
                  >
                    <option value="Comida">Comida / Carnes</option>
                    <option value="Vegetales">Vegetales / Frescos</option>
                    <option value="Aderezos">Aderezos / Salsas</option>
                    <option value="Snack">Botanas / Snacks</option>
                    <option value="Cocina General">Cocina General / Insumos</option>
                  </select>
                </div>

                <div className="form-group">
                  <label className="form-label">Unidad de Medida</label>
                  <select
                    className="form-input"
                    value={newInsumo.unidad}
                    onChange={e => setNewInsumo(p => ({ ...p, unidad: e.target.value }))}
                    style={{ background: 'var(--bg-elevated)', color: 'var(--text-main)', border: '1px solid var(--border)' }}
                  >
                    <option value="pz">Pieza (pz)</option>
                    <option value="kg">Kilogramo (kg)</option>
                    <option value="L">Litro (L)</option>
                    <option value="porc">Porción (porc)</option>
                    <option value="caja">Caja (caja)</option>
                  </select>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
                <div className="form-group">
                  <label className="form-label">Cant. Actual</label>
                  <input
                    className="form-input"
                    type="number"
                    value={newInsumo.nivelActual}
                    onChange={e => setNewInsumo(p => ({ ...p, nivelActual: e.target.value }))}
                    required
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Nivel Mínimo</label>
                  <input
                    className="form-input"
                    type="number"
                    value={newInsumo.nivelMin}
                    onChange={e => setNewInsumo(p => ({ ...p, nivelMin: e.target.value }))}
                    required
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Nivel Óptimo</label>
                  <input
                    className="form-input"
                    type="number"
                    value={newInsumo.nivelOptimo}
                    onChange={e => setNewInsumo(p => ({ ...p, nivelOptimo: e.target.value }))}
                    required
                  />
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">Tolerancia de Desviación IA (%)</label>
                <input
                  className="form-input"
                  type="number"
                  placeholder="Ej: 25"
                  value={newInsumo.toleranciaDesviacion}
                  onChange={e => setNewInsumo(p => ({ ...p, toleranciaDesviacion: e.target.value }))}
                  required
                />
              </div>

              <div style={{ display: 'flex', gap: 12, marginTop: 12 }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{ flex: 1, background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}
                  onClick={handleCloseInsumoModal}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  style={{ flex: 1 }}
                >
                  Agregar Insumo
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {editingInsumo && (
        <div 
          className="modal-overlay"
          style={{ background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(5px)', zIndex: 1000 }}
          onClick={() => setEditingInsumo(null)}
        >
          <div className="card modal" style={{ width: '100%', maxWidth: 450, padding: 24, border: '1px solid var(--border-bronze)', boxShadow: 'var(--shadow-bronze)', animation: 'fadeIn 0.25s ease', textAlign: 'left' }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h3 style={{ fontSize: 16, fontWeight: 700, margin: 0, textTransform: 'uppercase', letterSpacing: '0.1em' }} className="gradient-bronze">
                <i className="ri-edit-box-line" style={{ marginRight: 8 }} />Editar Insumo de Cocina
              </h3>
              <button
                onClick={() => setEditingInsumo(null)}
                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 20 }}
              >
                <i className="ri-close-line" />
              </button>
            </div>

            <form onSubmit={guardarEdicionInsumo} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div className="form-group">
                <label className="form-label">Nombre del Insumo / Ingrediente</label>
                <input
                  className="form-input"
                  placeholder="Ej: Carne de Hamburguesa, Aceite"
                  value={editingInsumo.nombre}
                  onChange={e => setEditingInsumo(p => ({ ...p, nombre: e.target.value }))}
                  required
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div className="form-group">
                  <label className="form-label">Categoría</label>
                  <select
                    className="form-input"
                    value={editingInsumo.categoria}
                    onChange={e => setEditingInsumo(p => ({ ...p, categoria: e.target.value }))}
                    style={{ background: 'var(--bg-elevated)', color: 'var(--text-main)', border: '1px solid var(--border)' }}
                  >
                    <option value="Comida">Comida / Carnes</option>
                    <option value="Vegetales">Vegetales / Frescos</option>
                    <option value="Aderezos">Aderezos / Salsas</option>
                    <option value="Snack">Botanas / Snacks</option>
                    <option value="Cocina General">Cocina General / Insumos</option>
                  </select>
                </div>

                <div className="form-group">
                  <label className="form-label">Unidad de Medida</label>
                  <select
                    className="form-input"
                    value={editingInsumo.unidad}
                    onChange={e => setEditingInsumo(p => ({ ...p, unidad: e.target.value }))}
                    style={{ background: 'var(--bg-elevated)', color: 'var(--text-main)', border: '1px solid var(--border)' }}
                  >
                    <option value="pz">Pieza (pz)</option>
                    <option value="kg">Kilogramo (kg)</option>
                    <option value="L">Litro (L)</option>
                    <option value="porc">Porción (porc)</option>
                    <option value="caja">Caja (caja)</option>
                  </select>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
                <div className="form-group">
                  <label className="form-label">Cant. Actual</label>
                  <input
                    className="form-input"
                    type="number"
                    value={editingInsumo.nivelActual}
                    onChange={e => setEditingInsumo(p => ({ ...p, nivelActual: e.target.value }))}
                    required
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Nivel Mínimo</label>
                  <input
                    className="form-input"
                    type="number"
                    value={editingInsumo.nivelMin}
                    onChange={e => setEditingInsumo(p => ({ ...p, nivelMin: e.target.value }))}
                    required
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Nivel Óptimo</label>
                  <input
                    className="form-input"
                    type="number"
                    value={editingInsumo.nivelOptimo}
                    onChange={e => setEditingInsumo(p => ({ ...p, nivelOptimo: e.target.value }))}
                    required
                  />
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">Tolerancia de Desviación IA (%)</label>
                <input
                  className="form-input"
                  type="number"
                  placeholder="Ej: 25"
                  value={editingInsumo.toleranciaDesviacion !== undefined ? editingInsumo.toleranciaDesviacion : 25}
                  onChange={e => setEditingInsumo(p => ({ ...p, toleranciaDesviacion: e.target.value }))}
                  required
                />
              </div>

              <div style={{ display: 'flex', gap: 12, marginTop: 12 }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{ flex: 1, background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}
                  onClick={() => setEditingInsumo(null)}
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  className="btn btn-danger"
                  style={{ flex: 1 }}
                  onClick={() => eliminarInsumo(editingInsumo.id, editingInsumo.nombre)}
                >
                  Eliminar
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  style={{ flex: 1 }}
                >
                  Guardar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showCierreTurnoModal && (
        <div 
          className="modal-overlay"
          style={{ background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(5px)', zIndex: 1000 }}
          onClick={() => setShowCierreTurnoModal(false)}
        >
          <div className="card modal" style={{ width: '100%', maxWidth: 500, padding: 24, border: '1px solid var(--border-bronze)', boxShadow: 'var(--shadow-bronze)', animation: 'fadeIn 0.25s ease', textAlign: 'left' }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 15 }}>
              <h3 style={{ fontSize: 16, fontWeight: 700, margin: 0, textTransform: 'uppercase', letterSpacing: '0.1em' }} className="gradient-bronze">
                <i className="ri-shut-down-line" style={{ marginRight: 8 }} />Cierre de Turno & Conciliación Física
              </h3>
              <button
                onClick={() => setShowCierreTurnoModal(false)}
                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 20 }}
              >
                <i className="ri-close-line" />
              </button>
            </div>

            <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 20 }}>
              Ingresa el conteo físico real medido en cocina para los siguientes insumos críticos. Esto actualizará el stock físico y alimentará el reporte de auditoría de robo hormiga por IA.
            </p>

            <form onSubmit={guardarCierreTurno} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {cierreInsumos.map((item, idx) => (
                  <div key={item.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 12, padding: '10px 14px' }}>
                    <div style={{ flex: 1, marginRight: 10 }}>
                      <div style={{ fontSize: 13, fontWeight: 800, color: '#fff' }}>{item.nombre}</div>
                      <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>Stock teórico: {item.nivelActual} {item.unidad}</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <input
                        type="number"
                        step="any"
                        className="form-input"
                        style={{ width: 80, padding: '6px 8px', fontSize: 13, textAlign: 'center', margin: 0 }}
                        value={item.conteoFisico}
                        onChange={e => {
                          const val = e.target.value;
                          setCierreInsumos(prev => prev.map((p, i) => i === idx ? { ...p, conteoFisico: val } : p));
                        }}
                        required
                      />
                      <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600, minWidth: 24 }}>{item.unidad}</span>
                    </div>
                  </div>
                ))}
              </div>

              <div style={{ display: 'flex', gap: 12, marginTop: 10 }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{ flex: 1, background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}
                  onClick={() => setShowCierreTurnoModal(false)}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  style={{ flex: 1, background: 'var(--bronze-dark)', borderColor: 'var(--border-bronze)' }}
                >
                  Guardar y Cerrar Turno
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}

export default function CocinaPage() {
  return (
    <AuthProvider>
      <CocinaContent />
    </AuthProvider>
  );
}

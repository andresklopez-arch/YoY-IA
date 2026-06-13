'use client';
import { useState, useEffect } from 'react';
import {
  collection, onSnapshot, query, where,
  orderBy, updateDoc, doc, serverTimestamp, addDoc, getDoc
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/lib/auth-context';
import { AuthProvider } from '@/lib/auth-context';

// ═══════════════════════════════════════════════════════════
// VISTA MESERO — Dashboard de pedidos y asistencias en tiempo real
// ═══════════════════════════════════════════════════════════
function MeseroContent() {
  const [pedidos, setPedidos] = useState([]);
  const [filtro, setFiltro] = useState('todos'); // todos | pedido | asistencia | cuenta
  const [sonido, setSonido] = useState(true);
  const [ultimoCount, setUltimoCount] = useState(0);
  const { user } = useAuth();
  
  const [showCuentasModal, setShowCuentasModal] = useState(false);
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

  // Unificar cuentas reales con las mesas ocupadas que aún no tengan cuenta registrada
  const getCuentasActivasUnificadas = () => {
    const unificadas = [...cuentas];
    mesas.forEach(m => {
      if (m.estado === 'ocupada') {
        const tieneCuenta = cuentas.some(c => c.mesaId === m.id);
        if (!tieneCuenta) {
          unificadas.push({
            id: `mesa_${m.id}`,
            mesaId: m.id,
            cliente: m.cliente || `Mesa ${m.id}`,
            consumos: [],
            tiempoJuego: 0
          });
        }
      }
    });
    return unificadas;
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

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setIsOffline(!navigator.onLine);
      const handleOnline = () => {
        setIsOffline(false);
        sincronizarAlertasOffline();
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
    return () => {
      unsubMesas();
      unsubCuentas();
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
          { id: 1, nombre: 'Cerveza Corona Extra', categoria: 'Cerveza', precioVenta: 45, stock: 100 },
          { id: 2, nombre: 'Coca-Cola 355ml', categoria: 'Refresco', precioVenta: 30, stock: 80 },
          { id: 3, nombre: 'Nachos con Queso', categoria: 'Snack', precioVenta: 75, stock: 50 },
          { id: 4, nombre: 'Alitas de Pollo x10', categoria: 'Comida', precioVenta: 120, stock: 35 },
          { id: 5, nombre: 'Agua 600ml', categoria: 'Bebida', precioVenta: 20, stock: 150 },
          { id: 6, nombre: 'Café Americano', categoria: 'Bebida', precioVenta: 35, stock: 100 },
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
      where('estado', 'in', ['pendiente', 'listo', 'en_camino'])
    );
    const unsub = onSnapshot(q, snap => {
      const items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      items.sort((a, b) => {
        const tA = a.createdAt?.toDate ? a.createdAt.toDate().getTime() : (a.createdAt || 0);
        const tB = b.createdAt?.toDate ? b.createdAt.toDate().getTime() : (b.createdAt || 0);
        return tB - tA;
      });
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
          gain.gain.setValueAtTime(0.25, ctx.currentTime);
          osc.start(); osc.stop(ctx.currentTime + 0.12);
          setTimeout(() => {
            const osc2 = ctx.createOscillator();
            const gain2 = ctx.createGain();
            osc2.connect(gain2); gain2.connect(ctx.destination);
            osc2.frequency.setValueAtTime(1500.00, ctx.currentTime); // G6 - Tono campanilla
            gain2.gain.setValueAtTime(0.25, ctx.currentTime);
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
          osc.frequency.value = 880; gain.gain.value = 0.3;
          osc.start(); osc.stop(ctx.currentTime + 0.2);
          setTimeout(() => { osc.frequency.value = 1100; osc.start(ctx.currentTime + 0.25); osc.stop(ctx.currentTime + 0.45); }, 250);
        } catch { /* sin audio */ }
      }
      setUltimoCount(items.length);
    });
    return unsub;
  }, [sonido, ultimoCount, listosNotificados]);

  // ── Suscripción a asistencias pendientes (Alertas Emergentes) ──
  useEffect(() => {
    const q = query(
      collection(db, 'mesa_pedidos'),
      where('tipo', 'in', ['asistencia', 'cuenta', 'pedido']),
      where('estado', 'in', ['pendiente', 'listo', 'en_camino', 'entregado'])
    );
    const unsub = onSnapshot(q, snap => {
      const items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      const filtered = items.filter(alerta => !alerta.atendidoMesero);
      setAlertasAsistencia(filtered);

      // Si la app está en segundo plano y llega nueva alerta, disparar Web Notification
      if (items.length > 0 && typeof window !== 'undefined' && document.hidden) {
        if (Notification.permission === 'granted') {
          const masReciente = items[0];
          new Notification(`🚨 Mesa ${masReciente.mesaId} - ${masReciente.etiqueta}`, {
            body: `El cliente solicita: ${masReciente.etiqueta}`,
            icon: '/icon.png',
            silent: false
          });
        }
      }
    });
    return unsub;
  }, []);

  // ── Alarma sonora periódica para asistencias pendientes ──
  useEffect(() => {
    if (!sonido || alertasAsistencia.length === 0) return;
    
    const sonarAlerta = () => {
      try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const osc1 = ctx.createOscillator();
        const gain1 = ctx.createGain();
        osc1.connect(gain1); gain1.connect(ctx.destination);
        osc1.frequency.value = 660; gain1.gain.value = 0.25;
        osc1.start();
        osc1.stop(ctx.currentTime + 0.15);
        
        setTimeout(() => {
          const osc2 = ctx.createOscillator();
          const gain2 = ctx.createGain();
          osc2.connect(gain2); gain2.connect(ctx.destination);
          osc2.frequency.value = 880; gain2.gain.value = 0.25;
          osc2.start();
          osc2.stop(ctx.currentTime + 0.3);
        }, 180);

        if (typeof navigator !== 'undefined' && navigator.vibrate) {
          navigator.vibrate([150, 100, 150]); // Vibración rítmica
        }
      } catch { /* sin audio */ }
    };

    sonarAlerta();
    const t = setInterval(sonarAlerta, 4000);
    return () => clearInterval(t);
  }, [sonido, alertasAsistencia.length]);

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
        const data = snap.data();
        const updateData = {
          atendidoMesero: true,
          entregadoAt: serverTimestamp(), // Registrar hora de entrega para auditoría de tiempos
          updatedAt: serverTimestamp(),
        };
        if (data.atendidoAdmin === true) {
          updateData.estado = 'entregado';
        }
        await updateDoc(docRef, updateData);
      }
    } catch (e) {
      console.error("Error al marcar entregado:", e);
    }
  };

  const marcarAtendido = async (id) => {
    try {
      const docRef = doc(db, 'mesa_pedidos', id);
      const snap = await getDoc(docRef);
      if (snap.exists()) {
        const data = snap.data();
        const updateData = {
          atendidoMesero: true,
          updatedAt: serverTimestamp(),
        };
        // Solo archivar si no es un pedido (ya que el pedido debe seguir en cocina/entrega)
        if (data.tipo !== 'pedido') {
          if (data.atendidoAdmin === true) {
            updateData.estado = 'atendido';
            updateData.atendidoAt = serverTimestamp();
          }
        }
        await updateDoc(docRef, updateData);
      }
    } catch (e) {
      console.error("Error al marcar atendido:", e);
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

  // ── Filtrado ─────────────────────────────────────────────
  const pedidosFiltrados = pedidos.filter(p =>
    filtro === 'todos' || p.tipo === filtro
  );

  const counts = {
    todos:     pedidos.length,
    pedido:    pedidos.filter(p => p.tipo === 'pedido').length,
    asistencia:pedidos.filter(p => p.tipo === 'asistencia').length,
    cuenta:    pedidos.filter(p => p.tipo === 'cuenta').length,
  };

  // ── Color/ícono según tipo ────────────────────────────────
  const tipoConfig = {
    pedido:     { label: 'Pedido',     icon: '🍺', color: '#cd7f32', bg: 'rgba(205,127,50,0.08)' },
    asistencia: { label: 'Asistencia', icon: '🔔', color: '#3b82f6', bg: 'rgba(59,130,246,0.08)' },
    cuenta:     { label: 'Cuenta',     icon: '💳', color: '#22c55e', bg: 'rgba(34,197,94,0.08)' },
  };

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-primary)', padding: '0 0 40px' }}>

      {/* ── HEADER ─────────────────────────────────── */}
      <div style={{ background: 'var(--bg-card)', borderBottom: '1px solid var(--border-bronze)', padding: '16px 20px', position: 'sticky', top: 0, zIndex: 10 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', maxWidth: 900, margin: '0 auto' }}>
          <div>
            <h1 style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--bronze-light)', lineHeight: 1 }}>
              🎱 Vista Mesero
              {isOffline && (
                <span style={{ fontSize: 10, background: 'var(--danger)', color: '#fff', padding: '3px 8px', borderRadius: 10, fontWeight: 700, letterSpacing: 'normal' }}>
                  OFFLINE
                </span>
              )}
            </h1>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
              {pedidos.length > 0
                ? <><span style={{ color: 'var(--danger)', fontWeight: 700 }}>{pedidos.length} pendiente(s)</span> · Activo</>
                : <><span style={{ color: 'var(--success)' }}>✓</span> Sin pedidos pendientes</>
              }
            </p>
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
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

            {/* Toggle sonido */}
            <button
              onClick={() => setSonido(!sonido)}
              title={sonido ? 'Silenciar alertas' : 'Activar alertas de sonido'}
              style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 10, padding: '8px 12px', cursor: 'pointer', color: sonido ? 'var(--bronze-light)' : 'var(--text-muted)', fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}
            >
              <i className={sonido ? 'ri-volume-up-line' : 'ri-volume-mute-line'} />
              {sonido ? 'Sonido ON' : 'Silencio'}
            </button>

            {/* Botón X — cerrar y volver a Mesas */}
            <button
              onClick={() => {
                window.location.href = 'https://yoy-ia-billar.vercel.app';
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

        {/* ── STATS ───────────────────────────────────── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 24 }}>
          {[
            { key: 'todos',      label: 'Total',      icon: 'ri-list-check-2',            color: 'var(--text-primary)', count: counts.todos },
            { key: 'pedido',     label: 'Pedidos',    icon: 'ri-restaurant-line',          color: 'var(--bronze-light)', count: counts.pedido },
            { key: 'asistencia', label: 'Asistencia', icon: 'ri-customer-service-2-line',  color: 'var(--info)', count: counts.asistencia },
            { key: 'cuenta',     label: 'Cuentas',    icon: 'ri-secure-payment-line',      color: 'var(--success)', count: getCuentasActivasUnificadas().length },
          ].map(s => (
            <div 
              key={s.key} 
              className="stat-card" 
              style={{ cursor: 'pointer', border: (s.key === 'cuenta' && showCuentasModal) || (s.key !== 'cuenta' && filtro === s.key) ? '1px solid var(--border-bronze)' : '1px solid var(--border)' }} 
              onClick={() => {
                if (s.key === 'cuenta') {
                  setShowCuentasModal(true);
                } else {
                  setFiltro(s.key);
                }
              }}
            >
              <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 4 }}>{s.label}</div>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 800, color: s.color }}>{s.count}</div>
            </div>
          ))}
        </div>

        {/* ── LISTA DE PEDIDOS ─────────────────────────── */}
        {pedidosFiltrados.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--text-muted)' }}>
            <i className="ri-checkbox-circle-line" style={{ fontSize: 56, display: 'block', marginBottom: 16, color: 'var(--success)' }} />
            <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>¡Todo al día!</div>
            <div style={{ fontSize: 14 }}>No hay pedidos pendientes en este momento.</div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {pedidosFiltrados.map(pedido => {
              const cfg = tipoConfig[pedido.tipo] || tipoConfig.pedido;
              const urgente = pedido.createdAt?.toDate && (Date.now() - pedido.createdAt.toDate().getTime()) > 5 * 60 * 1000;

              return (
                <div key={pedido.id} style={{
                  background: pedido.estado === 'listo' ? 'rgba(34,197,94,0.06)' : cfg.bg,
                  border: pedido.estado === 'listo' ? '1px solid var(--success)' : `1px solid ${cfg.color}30`,
                  borderLeft: pedido.estado === 'listo' ? '4px solid var(--success)' : `4px solid ${cfg.color}`,
                  borderRadius: 16,
                  padding: 18,
                  animation: pedido.estado === 'listo' ? 'pulseBorder 2s infinite, slideUp 0.25s ease' : 'slideUp 0.25s ease',
                  boxShadow: pedido.estado === 'listo' ? '0 0 20px rgba(34,197,94,0.18)' : urgente ? `0 0 20px ${cfg.color}20` : 'none',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <div style={{ fontSize: 28 }}>{pedido.icono || (pedido.estado === 'listo' ? '🍳' : cfg.icon)}</div>
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 800, color: pedido.estado === 'listo' ? 'var(--success)' : cfg.color }}>
                            Mesa {pedido.mesaId}
                          </span>
                          {urgente && <span style={{ fontSize: 9, background: 'var(--danger)', color: '#fff', padding: '2px 6px', borderRadius: 999, fontWeight: 800 }}>URGENTE</span>}
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                          {pedido.cliente} · {tiempoTranscurrido(pedido.createdAt)} · {cfg.label}
                        </div>
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      {pedido.tipo === 'pedido' && (
                        <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--bronze-light)' }}>${pedido.total}</div>
                      )}
                      <div style={{
                        fontSize: 10, fontWeight: 800, marginTop: 4, padding: '3px 8px', borderRadius: 999,
                        background: pedido.estado === 'listo' ? 'rgba(34,197,94,0.15)' : pedido.estado === 'en_camino' ? 'rgba(245,158,11,0.15)' : 'rgba(59,130,246,0.15)',
                        color: pedido.estado === 'listo' ? 'var(--success)' : pedido.estado === 'en_camino' ? 'var(--warning)' : 'var(--info)',
                        border: pedido.estado === 'listo' ? '1px solid var(--success)' : 'none',
                      }}>
                        {pedido.estado === 'listo' ? '🍳 ¡Listo en Cocina!' : pedido.estado === 'en_camino' ? '🚀 En camino' : '⏳ Pendiente'}
                      </div>
                    </div>
                  </div>

                  {/* Items del pedido */}
                  {pedido.tipo === 'pedido' && pedido.items && (
                    <div style={{ background: 'rgba(0,0,0,0.2)', borderRadius: 10, padding: '10px 12px', marginBottom: 14 }}>
                      {pedido.items.map((item, i) => (
                        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '3px 0', borderBottom: i < pedido.items.length - 1 ? '1px solid rgba(255,255,255,0.05)' : 'none' }}>
                          <span>{item.cantidad}× {item.nombre}</span>
                          <span style={{ color: 'var(--bronze-light)', fontWeight: 600 }}>${item.subtotal}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Asistencia tipo */}
                  {pedido.tipo === 'asistencia' && (
                    <div style={{ background: 'rgba(0,0,0,0.2)', borderRadius: 10, padding: '10px 14px', marginBottom: 14, fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>
                      {pedido.etiqueta}
                    </div>
                  )}

                  {/* Cuenta solicitada */}
                  {pedido.tipo === 'cuenta' && (
                    <div style={{ background: 'rgba(0,0,0,0.2)', borderRadius: 10, padding: '10px 14px', marginBottom: 14 }}>
                      <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Total a cobrar:</div>
                      <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--success)' }}>${pedido.totalAcumulado || '—'}</div>
                    </div>
                  )}

                  {/* Acciones */}
                  <div style={{ display: 'flex', gap: 8 }}>
                    {(pedido.estado === 'pendiente' || pedido.estado === 'listo') && (
                      <button
                        onClick={() => marcarEnCamino(pedido.id)}
                        style={{ flex: 1, padding: '10px 14px', background: pedido.estado === 'listo' ? 'rgba(245,158,11,0.12)' : `${cfg.color}15`, border: `1px solid ${pedido.estado === 'listo' ? 'var(--warning)' : `${cfg.color}40`}`, borderRadius: 10, color: pedido.estado === 'listo' ? 'var(--warning)' : cfg.color, fontWeight: 700, fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
                      >
                        <i className="ri-run-line" /> En camino
                      </button>
                    )}
                    <button
                      onClick={() => marcarEntregado(pedido.id)}
                      style={{ flex: 1, padding: '10px 14px', background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.3)', borderRadius: 10, color: 'var(--success)', fontWeight: 700, fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
                    >
                      <i className="ri-check-double-line" /> Completado ✓
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── VENTANA EMERGENTE: ALERTA DE ASISTENCIA / SERVICIOS ── */}
      {alertasAsistencia.length > 0 && (
        <div className="modal-overlay" style={{ zIndex: 1000, background: 'rgba(13,13,15,0.85)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'fixed', top: 0, left: 0, right: 0, bottom: 0 }}>
          <div className="modal" style={{ maxWidth: 460, border: '2px solid var(--danger)', boxShadow: '0 0 30px rgba(239,68,68,0.35)', animation: 'scaleUp 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)' }}>
            <div className="modal-header" style={{ borderBottom: '1px solid rgba(239,68,68,0.2)', paddingBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span className="modal-title" style={{ color: 'var(--danger)', display: 'flex', alignItems: 'center', gap: 8, fontSize: 18, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                <span style={{ fontSize: 24, animation: 'pulse 1s infinite' }}>🚨</span> Alerta de Servicio
              </span>
              <span style={{ fontSize: 11, background: 'rgba(239,68,68,0.15)', color: 'var(--danger)', padding: '2px 8px', borderRadius: 999, fontWeight: 800 }}>
                {alertasAsistencia.length} PENDIENTE(S)
              </span>
            </div>
            <div className="modal-body" style={{ maxHeight: 360, overflowY: 'auto', padding: '16px 0' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                {alertasAsistencia.map((alerta) => (
                  <div key={alerta.id} style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 14, padding: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
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
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                          {alerta.cliente} · {alerta.createdAt?.toDate ? new Date(alerta.createdAt.toDate()).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : 'Ahora'}
                        </div>
                      </div>
                    </div>
                    <button
                      onClick={() => marcarAtendido(alerta.id)}
                      style={{
                        background: 'rgba(34,197,94,0.15)',
                        border: '1px solid rgba(34,197,94,0.4)',
                        color: 'var(--success)',
                        padding: '8px 16px',
                        borderRadius: 10,
                        fontWeight: 700,
                        fontSize: 13,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        transition: 'all 0.15s',
                        flexShrink: 0
                      }}
                      onMouseEnter={e => { e.currentTarget.style.background = 'rgba(34,197,94,0.25)'; }}
                      onMouseLeave={e => { e.currentTarget.style.background = 'rgba(34,197,94,0.15)'; }}
                    >
                      <i className="ri-check-line" /> Atendido
                    </button>
                  </div>
                ))}
              </div>
            </div>
            <div className="modal-footer" style={{ borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <button
                onClick={() => setSonido(!sonido)}
                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
              >
                <i className={sonido ? 'ri-volume-up-line' : 'ri-volume-mute-line'} />
                {sonido ? 'Alarma encendida' : 'Alarma silenciada'}
              </button>
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
                    {mesas.filter(m => m.estado === 'ocupada').map(m => (
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
      {showCuentasModal && (
        <ModalCuentasMesero
          cuentas={getCuentasActivasUnificadas()}
          mesas={mesas}
          alertasAsistencia={alertasAsistencia}
          isOffline={isOffline}
          onClose={() => setShowCuentasModal(false)}
          showToast={showToast}
        />
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

const calcCosto = (m) => {
  if (!m || !m.inicio) return 0;
  const hrs = (Date.now() - m.inicio) / 3600000;
  let baseCosto = m.socios ? 0 : Math.ceil(hrs * m.tarifa);
  let premiumCosto = 0;
  if (m.rentarTaco) premiumCosto += Math.ceil(hrs * 25);
  if (m.rentarBolas) premiumCosto += Math.ceil(hrs * 35);
  if (m.rentarTiza) premiumCosto += 10;
  return baseCosto + premiumCosto;
};

function ModalCuentasMesero({ cuentas, mesas, alertasAsistencia, isOffline, onClose, showToast }) {
  const [expandedId, setExpandedId] = useState(null);
  const [filtroTexto, setFiltroTexto] = useState('');
  const [tick, setTick] = useState(0);
  const [loadingCuentaId, setLoadingCuentaId] = useState(null);

  useEffect(() => {
    const interval = setInterval(() => {
      setTick(t => t + 1);
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  const pedirCuenta = async (cuenta) => {
    setLoadingCuentaId(cuenta.id);
    const mesaAsociada = mesas.find(m => m.id === cuenta.mesaId || (m.cliente && m.cliente.toLowerCase() === cuenta.cliente.toLowerCase()));
    const mesaId = mesaAsociada ? mesaAsociada.id : 0;
    const consumosTotal = cuenta.consumos.reduce((sum, item) => sum + item.precio * item.cantidad, 0);
    const costoTiempo = (mesaAsociada && mesaAsociada.estado === 'ocupada')
      ? (mesaAsociada.socios ? 0 : calcCosto(mesaAsociada))
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
        showToast('Modo offline: Solicitud guardada localmente. Se enviará al reconectar.', 'warning');
        onClose();
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
        showToast(`Solicitud de cuenta enviada a caja para ${cuenta.cliente} ✓`, 'success');
      } catch (err) {
        console.error(err);
        alert('Error al solicitar la cuenta: ' + err.message);
      } finally {
        setLoadingCuentaId(null);
      }
    }
  };

  const cuentasFiltradas = cuentas.filter(c => {
    const term = filtroTexto.trim().toLowerCase();
    if (!term) return true;
    const mesaAsociada = mesas.find(m => m.id === c.mesaId || (m.cliente && m.cliente.toLowerCase() === c.cliente.toLowerCase()));
    const matchCliente = c.cliente.toLowerCase().includes(term);
    
    // Si el término es un número entero, intentar coincidir exactamente con el ID de la mesa
    const numTerm = parseInt(term, 10);
    const matchMesaId = !isNaN(numTerm) && (c.mesaId === numTerm || (mesaAsociada && mesaAsociada.id === numTerm));
    
    const matchMesaText = mesaAsociada ? `mesa ${mesaAsociada.id}`.includes(term) : false;
    return matchCliente || matchMesaId || matchMesaText;
  });

  return (
    <div className="modal-overlay" onClick={onClose} style={{ zIndex: 1100, display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.6)' }}>
      <div className="modal" style={{ maxWidth: 500, maxHeight: '85vh', display: 'flex', flexDirection: 'column' }} onClick={e => e.stopPropagation()}>
        <div className="modal-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span className="modal-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <i className="ri-secure-payment-line" style={{ color: 'var(--success)' }} />
            Cuentas Activas ({cuentas.length})
          </span>
          <button onClick={onClose} className="btn-icon btn btn-secondary" style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 20, cursor: 'pointer' }}>
            <i className="ri-close-line" />
          </button>
        </div>

        {/* Buscador Interactivo */}
        <div style={{ padding: '8px 16px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
            <i className="ri-search-line" style={{ position: 'absolute', left: 10, color: 'var(--text-muted)' }} />
            <input
              type="text"
              placeholder="Buscar por cliente o mesa..."
              value={filtroTexto}
              onChange={e => setFiltroTexto(e.target.value)}
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
            {filtroTexto && (
              <button 
                onClick={() => setFiltroTexto('')}
                style={{ position: 'absolute', right: 10, background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
              >
                <i className="ri-close-line" />
              </button>
            )}
          </div>
        </div>

        <div className="modal-body" style={{ overflowY: 'auto', flex: 1, padding: '12px 16px', textAlign: 'left' }}>
          {cuentasFiltradas.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)' }}>
              {cuentas.length === 0 ? 'No hay cuentas activas en este momento.' : 'No se encontraron cuentas que coincidan.'}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {cuentasFiltradas.map(c => {
                const mesaAsociada = mesas.find(m => m.id === c.mesaId || (m.cliente && m.cliente.toLowerCase() === c.cliente.toLowerCase()));
                const consumosTotal = c.consumos.reduce((sum, item) => sum + item.precio * item.cantidad, 0);
                const costoTiempo = (mesaAsociada && mesaAsociada.estado === 'ocupada')
                  ? (mesaAsociada.socios ? 0 : calcCosto(mesaAsociada))
                  : (c.tiempoJuego || 0);
                const total = costoTiempo + consumosTotal;
                const isExpanded = expandedId === c.id;

                const cuentaSolicitada = (alertasAsistencia || []).some(alerta => 
                  alerta.tipo === 'cuenta' && 
                  alerta.cliente && 
                  alerta.cliente.toLowerCase() === c.cliente.toLowerCase()
                );

                const displayClienteName = c.mesaId 
                  ? (c.cliente && c.cliente.toLowerCase().startsWith('mesa ') ? `Mesa ${c.mesaId}` : c.cliente)
                  : c.cliente;

                const tieneAsistenciaPendiente = (alertasAsistencia || []).some(alerta => 
                  !alerta.atendidoMesero &&
                  (
                    (c.mesaId && alerta.mesaId === c.mesaId) ||
                    (alerta.cliente && c.cliente && alerta.cliente.toLowerCase() === c.cliente.toLowerCase())
                  )
                );

                return (
                  <div key={c.id} style={{
                    background: 'var(--bg-elevated)',
                    border: '1px solid var(--border)',
                    borderRadius: 10,
                    padding: '8px 12px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 6
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 800, fontSize: 13, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'flex', alignItems: 'center' }}>
                          {displayClienteName}
                          {tieneAsistenciaPendiente && (
                            <i className="ri-notification-3-fill" style={{ color: 'var(--bronze-light)', marginLeft: 6, fontSize: 12, verticalAlign: 'middle' }} title="Llamada de asistencia o pedido pendiente" />
                          )}
                        </div>
                        <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 1 }}>
                          {c.mesaId ? `📍 Mesa ${c.mesaId}` : (mesaAsociada ? `📍 Mesa ${mesaAsociada.id}` : '👤 Cuenta Directa')} · Tiempo: ${costoTiempo}
                        </div>
                      </div>
                      
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontSize: 14, fontWeight: 900, color: 'var(--success)' }}>${total} MXN</div>
                          <button
                            onClick={() => setExpandedId(isExpanded ? null : c.id)}
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
                        {c.consumos.length === 0 ? (
                          <div style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>Sin consumos registrados</div>
                        ) : (
                          <ul style={{ margin: 0, paddingLeft: 14, color: 'var(--text-secondary)' }}>
                            {c.consumos.map((item, idx) => (
                              <li key={idx} style={{ marginBottom: 1 }}>
                                {item.cantidad}x {item.producto} (${item.precio * item.cantidad})
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
        <div className="modal-footer" style={{ padding: '8px 16px', display: 'flex', justifyContent: 'flex-end', borderTop: '1px solid var(--border)' }}>
          <button className="btn btn-secondary" onClick={onClose}>Cerrar</button>
        </div>
      </div>
    </div>
  );
}

export default function MeseroPage() {
  return (
    <AuthProvider>
      <MeseroContent />
    </AuthProvider>
  );
}

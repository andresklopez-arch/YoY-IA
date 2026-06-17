'use client';
import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useAuth } from '@/lib/auth-context';
import { useAlertasNomina } from '@/components/panels/NominaPanel';
import { QRCodeSVG } from 'qrcode.react';
import { collection, query, where, onSnapshot, doc, getDoc, setDoc, addDoc, getDocs, serverTimestamp, updateDoc, orderBy, limit, writeBatch } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { deobfuscate, obfuscate } from '@/lib/crypto';
import { getBusinessDate } from '@/lib/date-utils';


// Hook: pedidos pendientes de clientes via QR
function usePedidosPendientes() {
  const [total, setTotal] = useState(0);
  useEffect(() => {
    const q = query(collection(db, 'mesa_pedidos'), where('estado', 'in', ['pendiente', 'en_camino']));
    const unsub = onSnapshot(q, snap => setTotal(snap.size));
    return unsub;
  }, []);
  return total;
}

// Hook: pedidos pendientes en cocina
function usePedidosCocina() {
  const [total, setTotal] = useState(0);
  useEffect(() => {
    const q = query(collection(db, 'mesa_pedidos'), where('tipo', '==', 'pedido'), where('estado', '==', 'pendiente'));
    const unsub = onSnapshot(q, snap => setTotal(snap.size));
    return unsub;
  }, []);
  return total;
}

const PANEL_LABELS = {
  dashboard: 'Dashboard',
  mesas:     'Control de Mesas',
  caja:      'INTELIGENCIA',
  bar:       'Inventario Inteligente IA',
  clientes:  'Clientes',
  torneos:   'Torneos y Ligas',
  nomina:    'Nómina & Gastos',
  reportes:  'INTELIGENCIA',
  config:    'Configuración',
};

const QUICK_NAV_TARGETS = [
  { nav: 'mesas' },
  { nav: 'caja' },
  { nav: 'bar' },
  { nav: 'torneos' },
  { nav: 'nomina' },
  { nav: 'config' },
  { href: '/mesero' },
  { href: '/cocina' },
];

export default function Topbar({ user, activePanel, showToast, onNavigate }) {
  const { logout, loginWithEmpleadoId } = useAuth();
  const [time, setTime] = useState(new Date());
  const [showMenu, setShowMenu] = useState(false);
  const [showModalPaseLista, setShowModalPaseLista] = useState(false);
  const [empleadosPaseLista, setEmpleadosPaseLista] = useState([]);
  const [busquedaPaseLista, setBusquedaPaseLista] = useState('');
  const [focusedEmpleadoQR, setFocusedEmpleadoQR] = useState(null);
  const [qrCountdown, setQrCountdown] = useState(0);
  const [recentFichajes, setRecentFichajes] = useState([]);

  // Estados para asignación interactiva de mesas en pase de lista
  const [todasLasMesas, setTodasLasMesas] = useState([]);
  const [asignacionPaseEmpleado, setAsignacionPaseEmpleado] = useState(null);
  const [mesasAsignadasPase, setMesasAsignadasPase] = useState([]);

  useEffect(() => {
    if (!showModalPaseLista) return;
    const docRef = doc(db, 'config', 'mesas_estado');
    getDoc(docRef).then(snap => {
      if (snap.exists()) {
        setTodasLasMesas(snap.data().mesas || []);
      }
    }).catch(err => console.error("Error loading tables for Topbar:", err));
  }, [showModalPaseLista]);

  const regenerarQROnTimeout = async () => {
    if (!focusedEmpleadoQR) return;
    try {
      const res = await fetch('/api/nomina/generate-qr-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ empleadoId: focusedEmpleadoQR.id })
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Error en servidor');
      }
      setFocusedEmpleadoQR(prev => prev ? {
        ...prev,
        qrToken: data.token,
        qrTokenExpires: data.expires
      } : null);
      showToast('Código QR regenerado automáticamente por seguridad ✓', 'success');
    } catch (err) {
      console.error("Error al regenerar token QR:", err);
    }
  };

  // Sugerencia 1: Cuenta regresiva de 5 minutos y regeneración automática
  useEffect(() => {
    if (!focusedEmpleadoQR) {
      setQrCountdown(0);
      return;
    }
    const updateCountdown = () => {
      const remaining = Math.max(0, Math.round((focusedEmpleadoQR.qrTokenExpires - Date.now()) / 1000));
      setQrCountdown(remaining);
      if (remaining <= 0) {
        regenerarQROnTimeout();
      }
    };
    updateCountdown();
    const timer = setInterval(updateCountdown, 1000);
    return () => clearInterval(timer);
  }, [focusedEmpleadoQR]);

  // Sugerencia 3: Mostrar los últimos 3 fichajes exitosos en tiempo real
  useEffect(() => {
    if (!focusedEmpleadoQR) {
      setRecentFichajes([]);
      return;
    }
    const q = query(
      collection(db, 'nomina_asistencia_log'),
      where('empleadoId', '==', focusedEmpleadoQR.id)
    );
    const unsub = onSnapshot(q, snap => {
      const logs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      const successfulLogs = logs.filter(log => log.tipo === 'entrada' || log.tipo === 'salida');
      successfulLogs.sort((a, b) => {
        const tA = a.createdAt?.toDate ? a.createdAt.toDate().getTime() : (a.createdAt || 0);
        const tB = b.createdAt?.toDate ? b.createdAt.toDate().getTime() : (b.createdAt || 0);
        return tB - tA;
      });
      setRecentFichajes(successfulLogs.slice(0, 3));
    }, err => {
      console.warn("Error listening to recent logs:", err);
    });
    return unsub;
  }, [focusedEmpleadoQR]);

  useEffect(() => {
    if (!showModalPaseLista) return;
    const q = query(collection(db, 'nomina_empleados'), where('estado', '==', 'activo'));
    const unsub = onSnapshot(q, snap => {
      setEmpleadosPaseLista(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
    return unsub;
  }, [showModalPaseLista]);

  const handlePaseListaClick = async (emp) => {
    try {
      const fechaHoy = getBusinessDate();
      const hour = new Date().getHours();
      let turnoActual = 'noche';
      if (hour >= 6 && hour < 14) turnoActual = 'manana';
      else if (hour >= 14 && hour < 22) turnoActual = 'tarde';

      const q = query(
        collection(db, 'nomina_asistencia'),
        where('empleadoId', '==', emp.id),
        where('fecha', '==', fechaHoy),
        where('turno', '==', turnoActual)
      );
      const snap = await getDocs(q);
      if (snap.empty) {
        await addDoc(collection(db, 'nomina_asistencia'), {
          empleadoId: emp.id,
          fecha: fechaHoy,
          turno: turnoActual,
          estado: 'presente',
          createdAt: serverTimestamp()
        });
        showToast(`Asistencia de ${emp.nombre} registrada ✅`, 'success');
      } else {
        showToast(`${emp.nombre} ya tiene asistencia registrada para este turno.`, 'info');
      }

      // Obtener información del dispositivo
      const ua = typeof navigator !== 'undefined' ? navigator.userAgent : 'Desconocido';
      let dispositivo = 'PC/Terminal';
      if (/Mobi|Android|iPhone/i.test(ua)) dispositivo = 'Móvil';
      else if (/Tablet|iPad/i.test(ua)) dispositivo = 'Tablet';

      // Registrar de inmediato en la bitácora general para el panel de Reportes
      await addDoc(collection(db, 'bitacora'), {
        fecha: new Date().toISOString(),
        accion: 'Asistencia Consola',
        detalle: `Pase de lista de ${emp.nombre} (${emp.rol || 'Mesero'}) registrado desde pantalla administrador por ${dispositivo}`,
        monto: 0,
        operador: emp.nombre,
        rolOperador: (emp.rol || 'mesero').toLowerCase()
      });

      // No iniciamos sesión ni redirigimos en el equipo del administrador
      setShowModalPaseLista(false);
    } catch (err) {
      console.error(err);
      showToast('Error al registrar pase de lista: ' + err.message, 'error');
    }
  };

  const processAttendanceAndAssignments = async (emp, selectedMesaIds) => {
    // 1. Registrar asistencia
    await handlePaseListaClick(emp);

    // 2. Registrar asignaciones de mesas
    if (selectedMesaIds.length > 0) {
      try {
        const docRef = doc(db, 'config', 'mesas_estado');
        const snap = await getDoc(docRef);
        if (snap.exists()) {
          const currentMesas = snap.data().mesas || [];
          const updatedMesas = currentMesas.map(m => {
            if (selectedMesaIds.includes(m.id)) {
              let currentIds = m.meseroIds || [];
              let currentNombres = m.meseroNombres || [];
              
              if (m.meseroId && !currentIds.includes(m.meseroId)) {
                currentIds = [m.meseroId, ...currentIds];
                currentNombres = [m.meseroNombre || 'Mesero', ...currentNombres];
              }

              if (!currentIds.includes(emp.id)) {
                currentIds = [...currentIds, emp.id];
                currentNombres = [...currentNombres, emp.nombre];
              }

              const firstId = currentIds[0] || null;
              const firstNombre = currentNombres[0] || null;

              return {
                ...m,
                meseroIds: currentIds,
                meseroNombres: currentNombres,
                meseroId: firstId,
                meseroNombre: firstNombre
              };
            }
            return m;
          });

          await setDoc(docRef, {
            mesas: updatedMesas,
            updatedAt: serverTimestamp()
          }, { merge: true });

          if (typeof window !== 'undefined') {
            localStorage.setItem('yoy_billar_mesas', obfuscate(updatedMesas));
          }
          
          showToast(`Mesas asignadas a ${emp.nombre} exitosamente`, 'success');
        }
      } catch (err) {
        console.error("Error al asignar mesas en el pase de lista:", err);
        showToast("Error al asignar las mesas.", "danger");
      }
    }
    setAsignacionPaseEmpleado(null);
  };

  const alertasNomina = useAlertasNomina();
  const pedidosPendientes = usePedidosPendientes();
  const pedidosCocina = usePedidosCocina();
  const [locale, setLocale] = useState('es-MX');
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [isDismissing, setIsDismissing] = useState(false);

  // Estados de Notificaciones Drawer
  const [showNotificationDrawer, setShowNotificationDrawer] = useState(false);
  const [pedidosAlerts, setPedidosAlerts] = useState([]);
  const [stockAlerts, setStockAlerts] = useState([]);
  const [dismissedAlerts, setDismissedAlerts] = useState([]);

  const playUISound = () => {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.setValueAtTime(800, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(1200, ctx.currentTime + 0.05);
      gain.gain.setValueAtTime(0.04, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.05);
      osc.start();
      osc.stop(ctx.currentTime + 0.06);
    } catch (err) {
      // Fallback silencioso
    }
  };

  const dismissOnboarding = async () => {
    try {
      localStorage.setItem('yoy_shortcuts_onboarding_shown_v1', 'true');
    } catch (e) {}

    if (user?.uid && user.uid !== 'bypass-admin') {
      try {
        const userDocRef = doc(db, 'users', user.uid);
        await setDoc(userDocRef, { shortcutsOnboardingShown_v1: true }, { merge: true });
      } catch (err) {
        console.warn('Error al guardar onboarding en Firestore:', err);
      }
    }

    setIsDismissing(true);
    setTimeout(() => {
      setShowOnboarding(false);
      const activeBtn = document.querySelector('.topbar-quick-btn.active');
      if (activeBtn) activeBtn.focus();
    }, 280);
  };

  // Carga inicial: comprobar onboarding
  useEffect(() => {
    const checkOnboardingStatus = async () => {
      try {
        const localShown = localStorage.getItem('yoy_shortcuts_onboarding_shown_v1');
        if (localShown === 'true') {
          return;
        }
      } catch (e) {}

      if (user?.uid && user.uid !== 'bypass-admin') {
        try {
          const userDocRef = doc(db, 'users', user.uid);
          const userDoc = await getDoc(userDocRef);
          if (userDoc.exists() && userDoc.data().shortcutsOnboardingShown_v1) {
            try {
              localStorage.setItem('yoy_shortcuts_onboarding_shown_v1', 'true');
            } catch (e) {}
            return;
          }
        } catch (err) {
          console.warn('Error al leer onboarding de Firestore:', err);
        }
      }

      setShowOnboarding(true);
    };

    checkOnboardingStatus();
  }, [user]);

  // Carga de Alertas de Pedidos en Tiempo Real (Firestore)
  useEffect(() => {
    const q = query(collection(db, 'mesa_pedidos'), where('estado', '==', 'pendiente'));
    const unsub = onSnapshot(q, snap => {
      const list = [];
      snap.forEach(doc => {
        const data = doc.data();
        list.push({
          id: doc.id,
          tipo: data.tipo || 'asistencia',
          titulo: data.tipo === 'pedido' ? `Pedido Mesa ${data.mesaId}` : `Llamada Mesa ${data.mesaId}`,
          desc: data.detalle || (data.tipo === 'pedido' ? 'Solicitó menú preparado' : 'Solicita mesero en mesa'),
          fecha: 'Pendiente'
        });
      });
      setPedidosAlerts(list);
    }, err => {
      console.warn("Mesa pedidos alerts offline:", err);
    });
    return unsub;
  }, []);

  // Carga de Alertas de Stock Bajo
  useEffect(() => {
    const checkStockAlerts = () => {
      const savedStock = localStorage.getItem('yoy_billar_stock');
      if (savedStock) {
        try {
          const stockData = deobfuscate(savedStock);
          if (stockData) {
            const lowStockList = stockData
              .filter(p => p.stock <= p.stockMin)
              .map(p => ({
                id: 'stock_' + p.id,
                tipo: 'stock',
                titulo: `Stock Bajo: ${p.nombre}`,
                desc: `Existencia: ${p.stock} ${p.unidad} (Mínimo: ${p.stockMin})`,
                fecha: 'Inventario'
              }));
            setStockAlerts(lowStockList);
          }
        } catch (e) {
          console.error(e);
        }
      }
    };

    checkStockAlerts();
    const intv = setInterval(checkStockAlerts, 10000);
    return () => clearInterval(intv);
  }, []);

  // Auto-ocultar onboarding
  useEffect(() => {
    if (showOnboarding && !isDismissing) {
      const timer = setTimeout(() => {
        dismissOnboarding();
      }, 30000);
      return () => clearTimeout(timer);
    }
  }, [showOnboarding, isDismissing]);

  // Atajos de Teclado
  useEffect(() => {
    const handleKeyDown = (e) => {
      const activeEl = document.activeElement;
      
      if (e.key === 'Escape') {
        if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.isContentEditable)) {
          activeEl.blur();
          return;
        } else if (showOnboarding && !isDismissing) {
          dismissOnboarding();
          return;
        }
      }

      const hasOpenModal = document.querySelector('.modal-overlay');
      if (hasOpenModal) {
        return;
      }

      const isAltHelp = e.altKey && (e.key === '?' || e.key === 'h' || e.key === 'H');
      const isCtrlShiftHelp = e.ctrlKey && e.shiftKey && (e.key === 'h' || e.key === 'H');
      if (isAltHelp || isCtrlShiftHelp) {
        e.preventDefault();
        setIsDismissing(false);
        setShowOnboarding(true);
        return;
      }

      if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.isContentEditable)) {
        return;
      }

      const isAltShortcut = e.altKey && !e.ctrlKey && !e.shiftKey;
      const isCtrlShiftShortcut = e.ctrlKey && e.shiftKey && !e.altKey;

      if ((isAltShortcut || isCtrlShiftShortcut) && !isNaN(e.key) && e.key >= '1' && e.key <= '9') {
        const index = parseInt(e.key) - 1;
        const target = QUICK_NAV_TARGETS[index];
        if (target) {
          e.preventDefault();
          setShowMenu(false);
          if (target.href) {
            window.open(target.href, '_blank');
          } else {
            playUISound();
            onNavigate(target.nav);
          }
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onNavigate, showOnboarding, isDismissing]);

  useEffect(() => {
    if (typeof window !== 'undefined' && navigator.language) {
      setLocale(navigator.language);
    }
    const t = setInterval(() => setTime(new Date()), 10000);
    return () => clearInterval(t);
  }, []);

  // Cargar alertas descartadas desde localStorage al montar
  useEffect(() => {
    try {
      const saved = localStorage.getItem('yoy_billar_alertas_descartadas');
      if (saved) {
        setDismissedAlerts(JSON.parse(saved) || []);
      }
    } catch (e) {
      console.error("Error al cargar alertas descartadas:", e);
    }
  }, []);

  const descartarAlerta = async (n) => {
    if (n.tipo === 'pedido' || n.tipo === 'asistencia' || n.id.startsWith('pedido_') || n.id.startsWith('asistencia_')) {
      try {
        const docRef = doc(db, 'mesa_pedidos', n.id);
        await updateDoc(docRef, {
          estado: 'atendido',
          atendidoAdmin: true,
          atendidoAt: serverTimestamp()
        });
        showToast('Alerta atendida ✓', 'success');
      } catch (err) {
        console.error("Error al atender alerta en Firestore:", err);
        showToast('Error al atender alerta', 'danger');
      }
    } else {
      const updated = [...dismissedAlerts, n.id];
      setDismissedAlerts(updated);
      try {
        localStorage.setItem('yoy_billar_alertas_descartadas', JSON.stringify(updated));
      } catch (e) {
        console.error(e);
      }
      showToast('Alerta descartada', 'info');
    }
  };

  const limpiarTodoElDrawer = async () => {
    const firestoreAlerts = allNotifications.filter(n => n.tipo === 'pedido' || n.tipo === 'asistencia');
    if (firestoreAlerts.length > 0) {
      try {
        const batch = writeBatch(db);
        firestoreAlerts.forEach(n => {
          const docRef = doc(db, 'mesa_pedidos', n.id);
          batch.update(docRef, {
            estado: 'atendido',
            atendidoAdmin: true,
            atendidoAt: serverTimestamp()
          });
        });
        await batch.commit();
      } catch (err) {
        console.error("Error al limpiar alertas en lote:", err);
      }
    }

    const localAlerts = allNotifications.filter(n => n.tipo !== 'pedido' && n.tipo !== 'asistencia');
    if (localAlerts.length > 0) {
      const newDismissed = [...dismissedAlerts, ...localAlerts.map(n => n.id)];
      setDismissedAlerts(newDismissed);
      try {
        localStorage.setItem('yoy_billar_alertas_descartadas', JSON.stringify(newDismissed));
      } catch (e) {}
    }

    showToast('Todas las alertas marcadas como leídas', 'success');
    setShowNotificationDrawer(false);
  };

  const timeStr = time.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  const dateStr = time.toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short' });

  // Lista unificada de notificaciones
  const rawNotifications = [
    ...alertasNomina.map((n, i) => ({
      id: 'nomina_' + i,
      tipo: 'nomina',
      titulo: 'Alerta de Nómina',
      desc: n.mensaje || n.descripcion || String(n),
      fecha: 'Nómina'
    })),
    ...pedidosAlerts,
    ...stockAlerts
  ];

  const allNotifications = rawNotifications.filter(n => !dismissedAlerts.includes(n.id));

  return (
    <header className="topbar">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button
          onClick={() => onNavigate('mesas')}
          style={{
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border)',
            color: 'var(--bronze-light)',
            fontSize: 16,
            cursor: 'pointer',
            padding: '5px 9px',
            borderRadius: 8,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'all 0.15s'
          }}
          onMouseEnter={e => {
            e.currentTarget.style.borderColor = 'var(--border-bronze)';
            e.currentTarget.style.background = 'var(--bronze-subtle)';
          }}
          onMouseLeave={e => {
            e.currentTarget.style.borderColor = 'var(--border)';
            e.currentTarget.style.background = 'var(--bg-elevated)';
          }}
          title="Ir a Mesas (Inicio)"
        >
          <i className="ri-home-4-line" />
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--success)', boxShadow: '0 0 6px var(--success)', animation: 'pulse 1.4s infinite' }} />
          <span style={{ fontFamily: 'var(--font-display)', fontSize: 14, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--bronze-light)' }}>
            {PANEL_LABELS[activePanel] || activePanel}
          </span>
          {activePanel === 'mesas' && (user?.permisos?.nomina === true || user?.role === 'admin') && (
            <button
              onClick={() => setShowModalPaseLista(true)}
              className="btn btn-secondary btn-xs btn-pase-lista-glow"
              style={{
                height: 28,
                padding: '4px 14px',
                fontSize: 11,
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                border: '1px solid rgba(227, 168, 105, 0.45)',
                borderRadius: 8,
                color: '#fff',
                fontFamily: 'var(--font-display)',
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                cursor: 'pointer',
                marginLeft: 12,
                transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                position: 'relative',
                overflow: 'hidden',
                textShadow: '0 0 4px rgba(227, 168, 105, 0.5)'
              }}
              onMouseEnter={e => {
                e.currentTarget.style.border = '1px solid #e3a869';
                e.currentTarget.style.boxShadow = '0 0 25px rgba(227, 168, 105, 0.9)';
                e.currentTarget.style.transform = 'translateY(-1px) scale(1.05)';
                e.currentTarget.style.background = 'linear-gradient(135deg, rgba(227, 168, 105, 0.3) 0%, rgba(205, 127, 50, 0.5) 100%)';
              }}
              onMouseLeave={e => {
                e.currentTarget.style.border = '1px solid rgba(227, 168, 105, 0.45)';
                e.currentTarget.style.boxShadow = '';
                e.currentTarget.style.transform = 'translateY(0) scale(1)';
                e.currentTarget.style.background = '';
              }}
              title="Pase de Lista / Código QR"
            >
              {/* CSS Embebido para efectos dinámicos premium */}
              <style>{`
                @keyframes pulse-glow-gold {
                  0%, 100% {
                    box-shadow: 0 0 8px rgba(227, 168, 105, 0.2);
                    border-color: rgba(227, 168, 105, 0.4);
                    background: linear-gradient(135deg, rgba(227, 168, 105, 0.12) 0%, rgba(205, 127, 50, 0.22) 100%);
                  }
                  50% {
                    box-shadow: 0 0 18px rgba(227, 168, 105, 0.65);
                    border-color: rgba(227, 168, 105, 0.95);
                    background: linear-gradient(135deg, rgba(227, 168, 105, 0.22) 0%, rgba(205, 127, 50, 0.4) 100%);
                  }
                }
                .btn-pase-lista-glow {
                  animation: pulse-glow-gold 2s infinite ease-in-out;
                }
                @keyframes pulse-green-led {
                  0%, 100% {
                    transform: scale(1);
                    box-shadow: 0 0 4px #10b981;
                    opacity: 1;
                  }
                  50% {
                    transform: scale(1.3);
                    box-shadow: 0 0 12px #10b981, 0 0 20px #10b981;
                    opacity: 0.7;
                  }
                }
                .led-green-pulse {
                  animation: pulse-green-led 1.2s infinite ease-in-out;
                }
              `}</style>
              {/* Led indicador pulsante verde para denotar acción de fichaje activa */}
              <span className="led-green-pulse" style={{
                width: 7,
                height: 7,
                borderRadius: '50%',
                background: '#10b981',
                display: 'inline-block'
              }} />
              <i className="ri-qr-code-line" style={{ fontSize: 13, color: '#e3a869' }} />
              <span style={{ letterSpacing: '0.03em' }}>Pase de Lista</span>
            </button>
          )}
        </div>
      </div>

      {/* Accesos Rápidos */}
      <div className="topbar-quick-actions">
        {[
          { label: 'Mesa', icon: 'ri-play-circle-line', color: 'var(--success)', nav: 'mesas', shortcut: 'Alt + 1' },
          { label: 'INTELIGENCIA', icon: 'ri-money-dollar-box-line', color: 'var(--bronze-light)', nav: 'caja', shortcut: 'Alt + 2' },
          { label: 'Inventario', icon: 'ri-archive-line', color: 'var(--blue-light)', nav: 'bar', shortcut: 'Alt + 3' },
          { label: 'Torneos', icon: 'ri-trophy-line', color: '#ffd700', nav: 'torneos', shortcut: 'Alt + 4' },
          { label: 'Nómina', icon: 'ri-briefcase-4-line', color: 'var(--bronze-light)', nav: 'nomina', badge: alertasNomina.length, shortcut: 'Alt + 5' },
          { label: 'Ajustes', icon: 'ri-settings-4-line', color: 'var(--text-muted)', nav: 'config', shortcut: 'Alt + 6' },
          { label: 'Mesero', icon: 'ri-customer-service-2-line', color: 'var(--success)', href: '/mesero', badge: pedidosPendientes, shortcut: 'Alt + 7' },
          { label: 'Cocina', icon: 'ri-restaurant-line', color: 'var(--blue-light)', href: '/cocina', badge: pedidosCocina, shortcut: 'Alt + 8' },
        ].map((a, i) => {
          const isActive = activePanel === a.nav;
          return (
            <button
              key={i}
              onClick={() => a.href ? window.open(a.href, '_blank') : onNavigate(a.nav)}
              className={`topbar-quick-btn ${isActive ? 'active' : ''}`}
              style={{
                '--btn-color': a.color,
                '--btn-bg-hover': `${a.color}11`,
                '--btn-glow-hover': `${a.color}22`,
                '--btn-bg-active': `${a.color}22`,
                '--btn-glow-active': `${a.color}44`,
                '--btn-glow-inset': `${a.color}15`,
                '--btn-bg-active-hover': `${a.color}33`,
                '--btn-glow-active-hover': `${a.color}66`,
                '--btn-glow-inset-hover': `${a.color}25`,
              }}
              title={`${a.label} [${a.shortcut}]`}
            >
              <div style={{ position: 'relative', display: 'inline-flex', flexDirection: 'column', alignItems: 'center' }}>
                <i className={a.icon} style={{ fontSize: 16, color: a.color }} />
                {isActive && (
                  <span style={{
                    width: 4,
                    height: 4,
                    borderRadius: '50%',
                    background: a.color,
                    boxShadow: `0 0 6px ${a.color}`,
                    position: 'absolute',
                    bottom: -8,
                    left: '50%',
                    transform: 'translateX(-50%)',
                    animation: 'activeDotPop 0.25s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards'
                  }} />
                )}
                {a.badge > 0 && (
                  <span style={{
                    position: 'absolute', top: -5, right: -6,
                    background: 'var(--danger)', color: '#fff',
                    fontSize: 8, fontWeight: 800, borderRadius: 999,
                    minWidth: 14, height: 14, display: 'flex', alignItems: 'center',
                    justifyContent: 'center', padding: '0 2px',
                    animation: 'pulse 1.5s ease-in-out infinite',
                    boxShadow: '0 0 6px rgba(239,68,68,0.6)'
                  }}>{a.badge}</span>
                )}
              </div>
              <span className="topbar-quick-label" style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', lineHeight: 1.1 }}>
                <span>{a.label}</span>
                <span style={{ fontSize: 8, color: 'var(--text-muted)', fontWeight: 500, marginTop: 1 }}>
                  {a.shortcut}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
        {/* Reloj */}
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 700, letterSpacing: '0.1em', color: 'var(--text-primary)', lineHeight: 1, whiteSpace: 'nowrap' }}>
            {timeStr}
          </div>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em', marginTop: 2, whiteSpace: 'nowrap' }}>
            {dateStr}
          </div>
        </div>

        {/* Notificaciones Botón (Abre Drawer Lateral) */}
        <button
          onClick={() => setShowNotificationDrawer(!showNotificationDrawer)}
          style={{
            background: allNotifications.length > 0 ? 'rgba(239,68,68,0.08)' : 'var(--bg-elevated)',
            border: `1px solid ${allNotifications.length > 0 ? 'rgba(239,68,68,0.3)' : 'var(--border)'}`,
            borderRadius: 10, width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', color: allNotifications.length > 0 ? 'var(--danger)' : 'var(--text-secondary)',
            fontSize: 16, position: 'relative', transition: 'all 0.2s'
          }}
          title={allNotifications.length > 0 ? `${allNotifications.length} alertas pendientes` : 'Sin notificaciones'}
        >
          <i className={allNotifications.length > 0 ? 'ri-alarm-warning-line' : 'ri-notification-3-line'} />
          {allNotifications.length > 0 && (
            <span style={{
              position: 'absolute', top: -4, right: -4,
              background: 'var(--danger)', color: '#fff',
              fontSize: 9, fontWeight: 800, borderRadius: 999,
              minWidth: 16, height: 16, display: 'flex', alignItems: 'center',
              justifyContent: 'center', padding: '0 3px',
              animation: 'pulse 1.5s ease-in-out infinite'
            }}>{allNotifications.length}</span>
          )}
        </button>

        {/* Perfil */}
        <div style={{ position: 'relative' }}>
          <button
            onClick={() => setShowMenu(p => !p)}
            style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 10, padding: '6px 12px', cursor: 'pointer', transition: 'border-color 0.15s' }}
            onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--border-bronze)'}
            onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border)'}
          >
            <div style={{ width: 24, height: 24, borderRadius: 6, background: 'linear-gradient(135deg, var(--bronze-dark), var(--bronze))', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800, color: '#fff' }}>
              {user?.avatar || '?'}
            </div>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>{user?.alias}</span>
            <i className="ri-arrow-down-s-line" style={{ fontSize: 14, color: 'var(--text-muted)' }} />
          </button>

          {showMenu && (
            <div style={{
              position: 'absolute', top: '110%', right: 0, minWidth: 180,
              background: 'var(--bg-card)', border: '1px solid var(--border-bronze)',
              borderRadius: 12, padding: 8, zIndex: 200,
              boxShadow: 'var(--shadow-lg), var(--shadow-bronze)',
              animation: 'slideUp 0.2s ease',
            }}>
              <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)', marginBottom: 4 }}>
                <div style={{ fontSize: 13, fontWeight: 700 }}>{user?.name}</div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>{user?.email}</div>
              </div>
              <button onClick={() => { logout(); setShowMenu(false); }} style={{ width: '100%', textAlign: 'left', background: 'none', border: 'none', padding: '8px 12px', borderRadius: 8, cursor: 'pointer', fontSize: 13, color: 'var(--danger)', display: 'flex', alignItems: 'center', gap: 8 }}>
                <i className="ri-logout-box-r-line" /> Cerrar Sesión
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Tutorial Shortcuts Onboarding */}
      {showOnboarding && (
        <div style={{
          position: 'fixed',
          bottom: 80,
          right: 24,
          zIndex: 1500,
          background: 'rgba(26, 26, 32, 0.95)',
          backdropFilter: 'blur(8px)',
          border: '1px solid var(--border-bronze)',
          borderRadius: 16,
          padding: 16,
          maxWidth: 320,
          boxShadow: 'var(--shadow-lg), var(--shadow-bronze)',
          animation: isDismissing ? 'slideDownOut 0.28s ease-in forwards' : 'slideUp 0.3s ease-out',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
            <span style={{ fontSize: 20 }}>💡</span>
            <div style={{ textAlign: 'left' }}>
              <h4 style={{ fontSize: 13, fontWeight: 700, color: 'var(--bronze-light)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Atajos de Navegación</h4>
              <p style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 4, lineHeight: 1.4 }}>
                Navega al instante usando <strong style={{ color: '#fff' }}>Alt + [1-9]</strong> o <strong style={{ color: '#fff' }}>Ctrl + Shift + [1-9]</strong>.
              </p>
              <p style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}>
                Si estás escribiendo, presiona <strong style={{ color: 'var(--bronze-light)' }}>Esc</strong> para desenfocar e interactuar.
              </p>
            </div>
          </div>
          <button
            onClick={dismissOnboarding}
            style={{
              alignSelf: 'flex-end',
              background: 'var(--bronze-subtle)',
              border: '1px solid var(--border-bronze)',
              color: 'var(--bronze-light)',
              fontSize: 10,
              fontWeight: 700,
              padding: '5px 12px',
              borderRadius: 8,
              cursor: 'pointer',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              transition: 'all 0.15s',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.background = 'var(--bronze)';
              e.currentTarget.style.color = '#000';
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = 'var(--bronze-subtle)';
              e.currentTarget.style.color = 'var(--bronze-light)';
            }}
          >
            ¡Entendido!
          </button>
        </div>
      )}

      {/* PANEL LATERAL DE NOTIFICACIONES (DRAWER DESLIZABLE) */}
      {showNotificationDrawer && (
        <div style={{
          position: 'fixed', top: 0, right: 0, bottom: 0, width: 330,
          background: 'rgba(20, 20, 25, 0.98)', borderLeft: '1px solid var(--border-bronze)',
          zIndex: 2000, boxShadow: '-5px 0 25px rgba(0,0,0,0.85)',
          display: 'flex', flexDirection: 'column',
          backdropFilter: 'blur(10px)',
          animation: 'slideLeft 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards'
        }}>
          <div style={{ padding: '20px 16px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ fontSize: 13, fontWeight: 800, color: 'var(--bronze-light)', textTransform: 'uppercase', letterSpacing: '0.1em', margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
              <i className="ri-notification-3-line" /> Alertas ({allNotifications.length})
            </h3>
            <button
              onClick={() => setShowNotificationDrawer(false)}
              style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 18 }}
            >
              ✕
            </button>
          </div>
          
          <div style={{ flex: 1, overflowY: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {allNotifications.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '60px 10px', color: 'var(--text-muted)', fontSize: 12 }}>
                <i className="ri-checkbox-circle-line" style={{ fontSize: 36, display: 'block', marginBottom: 10, color: 'var(--success)' }} />
                ¡Todo al día! No hay alertas ni avisos pendientes.
              </div>
            ) : (
              allNotifications.map(n => {
                let icon = 'ri-notification-line';
                let color = 'var(--bronze-light)';
                if (n.tipo === 'stock') { icon = 'ri-error-warning-line'; color = 'var(--danger)'; }
                if (n.tipo === 'nomina') { icon = 'ri-briefcase-line'; color = 'var(--warning)'; }
                if (n.tipo === 'pedido') { icon = 'ri-restaurant-line'; color = 'var(--blue-light)'; }
                if (n.tipo === 'asistencia') { icon = 'ri-user-voice-line'; color = 'var(--success)'; }

                return (
                  <div
                    key={n.id}
                    onClick={() => {
                      setShowNotificationDrawer(false);
                      if (n.tipo === 'stock') onNavigate('bar');
                      if (n.tipo === 'nomina') onNavigate('nomina');
                      if (n.tipo === 'pedido' || n.tipo === 'asistencia') onNavigate('mesas');
                    }}
                    style={{
                      background: 'var(--bg-elevated)', border: '1px solid var(--border)',
                      borderRadius: 10, padding: 12, cursor: 'pointer',
                      transition: 'all 0.2s', position: 'relative'
                    }}
                    onMouseEnter={e => {
                      e.currentTarget.style.borderColor = 'var(--border-bronze)';
                      e.currentTarget.style.background = 'rgba(255,255,255,0.02)';
                    }}
                    onMouseLeave={e => {
                      e.currentTarget.style.borderColor = 'var(--border)';
                      e.currentTarget.style.background = 'var(--bg-elevated)';
                    }}
                  >
                    <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', flex: 1 }}>
                        <div style={{ width: 28, height: 28, borderRadius: 6, background: 'rgba(255,255,255,0.02)', border: `1px solid ${color}`, display: 'flex', alignItems: 'center', justifyContent: 'center', color, flexShrink: 0 }}>
                          <i className={icon} />
                        </div>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 11, fontWeight: 700, color: '#fff' }}>{n.titulo}</div>
                          <p style={{ fontSize: 10, color: 'var(--text-secondary)', marginTop: 2, lineHeight: 1.4, margin: 0 }}>{n.desc}</p>
                          <span style={{ fontSize: 8, color: 'var(--text-muted)', marginTop: 6, display: 'block' }}>{n.fecha}</span>
                        </div>
                      </div>
                      <button
                        onClick={async (e) => {
                          e.stopPropagation();
                          await descartarAlerta(n);
                        }}
                        style={{
                          background: 'none', border: 'none', color: 'var(--text-muted)',
                          cursor: 'pointer', padding: 4, borderRadius: '55%',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: 16, transition: 'all 0.15s', flexShrink: 0
                        }}
                        onMouseEnter={e => {
                          e.currentTarget.style.color = 'var(--success)';
                          e.currentTarget.style.background = 'rgba(34, 197, 94, 0.1)';
                        }}
                        onMouseLeave={e => {
                          e.currentTarget.style.color = 'var(--text-muted)';
                          e.currentTarget.style.background = 'none';
                        }}
                        title="Descartar / Atender"
                      >
                        <i className="ri-check-line" style={{ fontWeight: 800 }} />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
          
          {allNotifications.length > 0 && (
            <div style={{ padding: 12, borderTop: '1px solid var(--border)', display: 'flex', gap: 10 }}>
              <button
                className="btn btn-secondary btn-sm"
                onClick={limpiarTodoElDrawer}
                style={{ width: '100%' }}
              >
                Limpiar Drawer
              </button>
            </div>
          )}
        </div>
      )}
      {/* ── MODAL PASE DE LISTA QR ── REESCRITO COMPLETAMENTE ── */}
      {showModalPaseLista && typeof window !== 'undefined' && createPortal(
        <>
          {/* BACKDROP: fondo oscuro que cubre toda la pantalla */}
          <div
            onClick={() => setShowModalPaseLista(false)}
            style={{
              position: 'fixed',
              top: 0, left: 0, right: 0, bottom: 0,
              background: 'rgba(0,0,0,0.85)',
              backdropFilter: 'blur(4px)',
              zIndex: 99998,
            }}
          />

          {/* MODAL BOX: posicionado de forma independiente con transform centrado */}
          <div
            onClick={e => e.stopPropagation()}
            style={{
              position: 'fixed',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, calc(-50% + 35px))',
              zIndex: 99999,
              width: '90vw',
              maxWidth: 700,
              maxHeight: 'calc(100vh - 120px)',
              background: 'var(--bg-card)',
              border: '1px solid var(--border-bronze)',
              borderRadius: 20,
              boxShadow: '0 25px 60px rgba(0,0,0,0.8), 0 0 30px rgba(205,127,50,0.2)',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
            }}
          >
            {/* Cabecera */}
            <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
              <span style={{ fontSize: 16, fontWeight: 800, color: 'var(--bronze-light)', textTransform: 'uppercase', letterSpacing: '0.1em', display: 'flex', alignItems: 'center', gap: 8 }}>
                <i className="ri-qr-code-line" /> Pase de Lista y Acceso de Empleados
              </span>
              <button
                onClick={() => setShowModalPaseLista(false)}
                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 22, cursor: 'pointer', lineHeight: 1, padding: 4 }}
              >
                <i className="ri-close-line" />
              </button>
            </div>

            {/* Cuerpo con scroll */}
            {asignacionPaseEmpleado ? (
              /* PASO 2: ASIGNACIÓN DE MESAS */
              <div style={{ flex: 1, overflowY: 'auto', padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div style={{ background: 'rgba(197, 168, 128, 0.08)', border: '1px solid rgba(197, 168, 128, 0.2)', borderRadius: 12, padding: 14 }}>
                  <h3 style={{ fontSize: 14, fontWeight: 800, color: 'var(--bronze-light)', margin: 0, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    ¿Qué mesas se asignan a {asignacionPaseEmpleado.nombre}?
                  </h3>
                  <p style={{ fontSize: 11, color: 'var(--text-secondary)', margin: '6px 0 0 0', lineHeight: 1.4 }}>
                    Seleccione las mesas asignadas. Si el empleado es mesero, las alertas y comisiones de las ventas se le asociarán automáticamente.
                  </p>
                </div>

                {/* Accesos rápidos */}
                <div>
                  <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', display: 'block', marginBottom: 6 }}>Selección Rápida</label>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    <button 
                      className="btn btn-secondary btn-sm"
                      style={{ fontSize: 11, padding: '6px 12px', background: 'rgba(255,255,255,0.04)', borderColor: 'rgba(255,255,255,0.08)', color: '#fff', cursor: 'pointer', borderRadius: 8 }}
                      onClick={() => {
                        if (mesasAsignadasPase.length === todasLasMesas.length) {
                          setMesasAsignadasPase([]);
                        } else {
                          setMesasAsignadasPase(todasLasMesas.map(m => m.id));
                        }
                      }}
                    >
                      {mesasAsignadasPase.length === todasLasMesas.length ? '❌ Deseleccionar Todas' : '✅ Seleccionar Todas'}
                    </button>

                    {Array.from(new Set(todasLasMesas.map(m => m.tipo || 'Carambola'))).filter(Boolean).map(tipo => {
                      const mesasDeTipo = todasLasMesas.filter(m => (m.tipo || 'Carambola') === tipo);
                      const idsDeTipo = mesasDeTipo.map(m => m.id);
                      const todasDeTipoSeleccionadas = idsDeTipo.every(id => mesasAsignadasPase.includes(id));
                      
                      return (
                        <button 
                          key={tipo}
                          className="btn btn-secondary btn-sm"
                          style={{ 
                            fontSize: 11, 
                            padding: '6px 12px', 
                            background: todasDeTipoSeleccionadas ? 'rgba(197, 168, 128, 0.15)' : 'rgba(255,255,255,0.04)', 
                            borderColor: todasDeTipoSeleccionadas ? 'var(--border-bronze)' : 'rgba(255,255,255,0.08)', 
                            color: todasDeTipoSeleccionadas ? 'var(--bronze-light)' : '#fff',
                            cursor: 'pointer',
                            borderRadius: 8
                          }}
                          onClick={() => {
                            if (todasDeTipoSeleccionadas) {
                              setMesasAsignadasPase(prev => prev.filter(id => !idsDeTipo.includes(id)));
                            } else {
                              setMesasAsignadasPase(prev => Array.from(new Set([...prev, ...idsDeTipo])));
                            }
                          }}
                        >
                          ⚡ {tipo}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Cuadrícula de mesas */}
                <div>
                  <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', display: 'block', marginBottom: 6 }}>Mesas Individuales</label>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))', gap: 10 }}>
                    {todasLasMesas.map(mesa => {
                      const isSelected = mesasAsignadasPase.includes(mesa.id);
                      return (
                        <div 
                          key={mesa.id}
                          onClick={() => {
                            if (isSelected) {
                              setMesasAsignadasPase(prev => prev.filter(id => id !== mesa.id));
                            } else {
                              setMesasAsignadasPase(prev => [...prev, mesa.id]);
                            }
                          }}
                          style={{
                            background: isSelected ? 'rgba(197, 168, 128, 0.12)' : 'var(--bg-elevated)',
                            border: isSelected ? '1px solid var(--border-bronze)' : '1px solid var(--border)',
                            borderRadius: 10,
                            padding: '10px 12px',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 8,
                            transition: 'all 0.15s'
                          }}
                        >
                          <input 
                            type="checkbox" 
                            checked={isSelected}
                            onChange={() => {}} 
                            style={{ accentColor: 'var(--bronze-light)', cursor: 'pointer' }}
                          />
                          <div style={{ display: 'flex', flexDirection: 'column' }}>
                            <span style={{ fontSize: 12, fontWeight: 700, color: isSelected ? 'var(--bronze-light)' : '#fff' }}>Mesa {mesa.id}</span>
                            <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>{mesa.tipo || 'Carambola'}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Botones de acción */}
                <div style={{ display: 'flex', gap: 12, marginTop: 16, borderTop: '1px solid var(--border)', paddingTop: 16 }}>
                  <button 
                    className="btn btn-secondary" 
                    style={{ flex: 1, cursor: 'pointer' }}
                    onClick={() => processAttendanceAndAssignments(asignacionPaseEmpleado, [])}
                  >
                    Omitir y Fichar Entrada
                  </button>
                  <button 
                    className="btn btn-success" 
                    style={{ flex: 1, cursor: 'pointer' }}
                    onClick={() => processAttendanceAndAssignments(asignacionPaseEmpleado, mesasAsignadasPase)}
                  >
                    Asignar y Fichar Entrada
                  </button>
                  <button 
                    className="btn btn-danger" 
                    style={{ cursor: 'pointer' }}
                    onClick={() => {
                      setAsignacionPaseEmpleado(null);
                      setMesasAsignadasPase([]);
                    }}
                  >
                    Volver
                  </button>
                </div>
              </div>
            ) : (
              /* PASO 1: LISTADO DE EMPLEADOS */
              <div style={{ flex: 1, overflowY: 'auto', padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
                <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: 0, lineHeight: 1.5 }}>
                  Selecciona tu código QR para registrar tu hora de entrada y activar tu sesión de trabajo en este dispositivo.
                </p>

                {/* Buscador */}
                <div style={{ position: 'relative' }}>
                  <input
                    type="text"
                    placeholder="Buscar empleado por nombre..."
                    value={busquedaPaseLista}
                    onChange={e => setBusquedaPaseLista(e.target.value)}
                    style={{
                      width: '100%', boxSizing: 'border-box',
                      paddingLeft: 36, height: 38,
                      background: 'var(--bg-elevated)',
                      border: '1px solid var(--border)',
                      borderRadius: 10,
                      color: 'var(--text-primary)',
                      fontSize: 13,
                      outline: 'none',
                    }}
                  />
                  <i className="ri-search-line" style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', fontSize: 16 }} />
                </div>

                {/* Lista de empleados */}
                {empleadosPaseLista.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '60px 10px', color: 'var(--text-muted)' }}>
                    <i className="ri-loader-4-line" style={{ fontSize: 36, display: 'block', marginBottom: 10, animation: 'spin 1s linear infinite' }} />
                    Cargando empleados activos...
                  </div>
                ) : (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 14 }}>
                    {empleadosPaseLista
                      .filter(emp =>
                        emp.nombre.toLowerCase().includes(busquedaPaseLista.toLowerCase()) ||
                        (emp.apellido || '').toLowerCase().includes(busquedaPaseLista.toLowerCase())
                      )
                      .map(emp => (
                        <div
                          key={emp.id}
                          onClick={() => {
                            const isMeseroOStaff = (emp.rol || emp.role || '').toLowerCase().includes('mesero') || 
                                                   (emp.rol || emp.role || '').toLowerCase().includes('staff') || 
                                                   (emp.rol || emp.role || '').toLowerCase().includes('mesera') || 
                                                   !(emp.rol || emp.role);
                            if (isMeseroOStaff) {
                              setAsignacionPaseEmpleado(emp);
                              setMesasAsignadasPase([]);
                            } else {
                              handlePaseListaClick(emp);
                            }
                          }}
                          onMouseEnter={e => {
                            e.currentTarget.style.borderColor = 'var(--bronze-light)';
                            e.currentTarget.style.transform = 'translateY(-3px)';
                            e.currentTarget.style.boxShadow = '0 6px 16px rgba(205,127,50,0.2)';
                          }}
                          onMouseLeave={e => {
                            e.currentTarget.style.borderColor = 'var(--border)';
                            e.currentTarget.style.transform = 'none';
                            e.currentTarget.style.boxShadow = 'none';
                          }}
                          style={{
                            background: 'var(--bg-elevated)',
                            border: '1px solid var(--border)',
                            borderRadius: 14,
                            padding: 12,
                            textAlign: 'center',
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            gap: 10,
                            cursor: 'pointer',
                            transition: 'all 0.18s ease',
                          }}
                        >
                          <div style={{
                            width: 48, height: 48, borderRadius: '50%',
                            background: 'var(--bg-card)', border: '1px solid var(--border)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontSize: 20, color: 'var(--bronze-light)'
                          }}>
                            <i className="ri-user-line" />
                          </div>
                          <div style={{ width: '100%' }}>
                            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {emp.nombre}
                            </div>
                            <div style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', marginTop: 2 }}>
                              {emp.rol || 'Mesero'}
                            </div>
                          </div>
                          <button
                            onClick={async (e) => {
                              e.stopPropagation(); // Evitar registrar asistencia al hacer clic en ver QR
                              
                              try {
                                const res = await fetch('/api/nomina/generate-qr-token', {
                                  method: 'POST',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({ empleadoId: emp.id })
                                });
                                const data = await res.json();
                                if (!res.ok || !data.success) {
                                  throw new Error(data.error || 'Error en servidor');
                                }
                                setFocusedEmpleadoQR({
                                  ...emp,
                                  qrToken: data.token,
                                  qrTokenExpires: data.expires
                                });
                              } catch (err) {
                                console.error("Error al generar token QR:", err);
                                showToast('Error al generar token QR: ' + err.message, 'error');
                              }
                            }}
                            style={{
                              marginTop: 4,
                              width: '100%',
                              background: 'rgba(205,127,50,0.1)',
                              border: '1px solid rgba(205,127,50,0.2)',
                              borderRadius: 8,
                              color: 'var(--bronze-light)',
                              padding: '6px 8px',
                              fontSize: 10,
                              fontWeight: 700,
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              gap: 4,
                              transition: 'all 0.2s'
                            }}
                          >
                            <i className="ri-qr-code-line" /> Acceso Móvil
                          </button>
                        </div>
                      ))}
                  </div>
                )}
              </div>
            )}

            {/* Pie */}
            <div style={{ padding: '14px 24px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end', flexShrink: 0 }}>
              <button
                onClick={() => setShowModalPaseLista(false)}
                style={{
                  background: 'var(--bg-elevated)',
                  border: '1px solid var(--border)',
                  borderRadius: 10,
                  color: 'var(--text-primary)',
                  padding: '8px 20px',
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: 'pointer',
                  letterSpacing: '0.04em',
                }}
              >
                Cerrar
              </button>
            </div>
          </div>

          {/* OVERLAY ENFOCADO PARA ESCANEAR QR INDIVIDUAL */}
          {focusedEmpleadoQR && (
            <>
              <style dangerouslySetInnerHTML={{ __html: `
                @keyframes modalPopIn {
                  from { opacity: 0; transform: translate(-50%, -45%) scale(0.95); }
                  to { opacity: 1; transform: translate(-50%, -50%) scale(1); }
                }
                @keyframes overlayFadeIn {
                  from { opacity: 0; }
                  to { opacity: 0.9; }
                }
              `}} />
              <div
                onClick={() => setFocusedEmpleadoQR(null)}
                style={{
                  position: 'fixed',
                  top: 0, left: 0, right: 0, bottom: 0,
                  background: 'rgba(0,0,0,0.9)',
                  backdropFilter: 'blur(8px)',
                  zIndex: 999998,
                  animation: 'overlayFadeIn 0.2s ease forwards'
                }}
              />
              <div
                style={{
                  position: 'fixed',
                  top: '50%',
                  left: '50%',
                  transform: 'translate(-50%, -50%)',
                  zIndex: 999999,
                  width: '90vw',
                  maxWidth: 360,
                  background: 'var(--bg-card)',
                  border: '1px solid var(--border-bronze)',
                  borderRadius: 24,
                  boxShadow: '0 25px 60px rgba(0,0,0,0.9), 0 0 40px rgba(205,127,50,0.3)',
                  padding: 24,
                  textAlign: 'center',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 16,
                  animation: 'modalPopIn 0.25s cubic-bezier(0.16, 1, 0.3, 1) forwards'
                }}
              >
                <div>
                  <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--bronze-light)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                    Acceso Móvil
                  </div>
                  <div style={{ fontSize: 13, color: '#fff', fontWeight: 700, marginTop: 4 }}>
                    {focusedEmpleadoQR.nombre} {focusedEmpleadoQR.apellido || ''}
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', marginTop: 2, letterSpacing: '0.04em' }}>
                    {focusedEmpleadoQR.rol || 'Mesero'}
                  </div>
                </div>

                <div style={{ background: '#fff', padding: 16, borderRadius: 16, boxShadow: '0 8px 24px rgba(0,0,0,0.2)' }}>
                  <QRCodeSVG 
                    value={typeof window !== 'undefined' ? 
                      `${window.location.origin}/?scanId=${focusedEmpleadoQR.id}${focusedEmpleadoQR.qrToken ? `&token=${focusedEmpleadoQR.qrToken}&expires=${focusedEmpleadoQR.qrTokenExpires}` : ''}` : 
                      `https://yoy-ia-billar.vercel.app/?scanId=${focusedEmpleadoQR.id}${focusedEmpleadoQR.qrToken ? `&token=${focusedEmpleadoQR.qrToken}&expires=${focusedEmpleadoQR.qrTokenExpires}` : ''}`} 
                    size={180} 
                    bgColor="#fff" 
                    fgColor="#000" 
                  />
                </div>

                {/* Sugerencia 1: Countdown Timer UI */}
                {qrCountdown > 0 ? (
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 6,
                    fontSize: 12,
                    color: qrCountdown <= 60 ? 'var(--danger)' : 'var(--bronze-light)',
                    fontWeight: 700,
                    background: qrCountdown <= 60 ? 'rgba(239,68,68,0.1)' : 'rgba(205,127,50,0.08)',
                    padding: '4px 12px',
                    borderRadius: 8,
                    border: `1px solid ${qrCountdown <= 60 ? 'rgba(239,68,68,0.2)' : 'rgba(205,127,50,0.2)'}`
                  }}>
                    <i className="ri-time-line" style={{ animation: qrCountdown <= 60 ? 'pulse 1s infinite' : 'none' }} />
                    <span>Expira en: {Math.floor(qrCountdown / 60)}:{(qrCountdown % 60).toString().padStart(2, '0')}</span>
                  </div>
                ) : (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, fontSize: 12, color: 'var(--danger)', fontWeight: 700 }}>
                    <i className="ri-error-warning-line" />
                    <span>Token expirado. Regenerando...</span>
                  </div>
                )}

                <div style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.5, padding: '0 10px' }}>
                  Escanea este código con tu celular para registrar asistencia e ingresar a tu área de trabajo.
                </div>

                {typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') && (
                  <div style={{
                    padding: '8px 12px',
                    background: 'rgba(245, 158, 11, 0.1)',
                    border: '1px solid rgba(245, 158, 11, 0.2)',
                    borderRadius: 10,
                    fontSize: 9,
                    color: 'var(--warning)',
                    lineHeight: 1.4,
                    textAlign: 'center'
                  }}>
                    <strong>Aviso de Red Local:</strong> Estás ejecutando en localhost. Para que el celular se conecte, usa la URL de producción o tu dirección IP local (ej. http://192.168.X.X:3000).
                  </div>
                )}

                {/* Sugerencia 3: Panel de Fichajes Recientes */}
                <div style={{ width: '100%', borderTop: '1px solid var(--border)', paddingTop: 16, textAlign: 'left' }}>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 800, letterSpacing: '0.08em', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 4 }}>
                    <i className="ri-history-line" /> Últimos 3 Fichajes
                  </div>
                  {recentFichajes.length === 0 ? (
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', fontStyle: 'italic', padding: '4px 0' }}>
                      Sin registros para el día de hoy
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {recentFichajes.map(log => {
                        const dateObj = log.createdAt?.toDate ? log.createdAt.toDate() : new Date(log.createdAt);
                        const timeStr = isNaN(dateObj.getTime()) ? '-' : dateObj.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
                        const dateStr = isNaN(dateObj.getTime()) ? '-' : dateObj.toLocaleDateString('es-MX', { day: '2-digit', month: 'short' });
                        const isEntrada = log.tipo === 'entrada';
                        return (
                          <div key={log.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(255,255,255,0.02)', padding: '6px 10px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.03)' }}>
                            <span style={{ fontSize: 11, fontWeight: 700, color: isEntrada ? 'var(--success)' : 'var(--bronze-light)', display: 'flex', alignItems: 'center', gap: 4 }}>
                              <i className={isEntrada ? 'ri-login-box-line' : 'ri-logout-box-line'} />
                              {isEntrada ? 'Entrada' : 'Salida'}
                            </span>
                            <span style={{ fontSize: 10, color: 'var(--text-secondary)' }}>
                              {dateStr} - {timeStr}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                <button
                  onClick={() => setFocusedEmpleadoQR(null)}
                  style={{
                    width: '100%',
                    background: 'var(--bg-elevated)',
                    border: '1px solid var(--border)',
                    borderRadius: 12,
                    color: 'var(--text-primary)',
                    padding: '10px 0',
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: 'pointer',
                    transition: 'all 0.2s'
                  }}
                >
                  Cerrar
                </button>
              </div>
            </>
          )}
        </>,
        document.body
      )}

    </header>


  );
}

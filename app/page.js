'use client';
import { useState, useEffect, Component, useRef, useMemo } from 'react';
import Topbar from '@/components/Topbar';
import ToastContainer from '@/components/ToastContainer';
import MesasPanel from '@/components/panels/MesasPanel';
import CajaPanel from '@/components/panels/CajaPanel';
import BarPanel from '@/components/panels/BarPanel';
import ClientesPanel from '@/components/panels/ClientesPanel';
import TorneosPanel from '@/components/panels/TorneosPanel';
import DashboardPanel from '@/components/panels/DashboardPanel';
import ConfigPanel from '@/components/panels/ConfigPanel';
import NominaPanel from '@/components/panels/NominaPanel';
import LoginScreen from '@/components/LoginScreen';
import { AuthProvider, useAuth } from '@/lib/auth-context';
import { collection, query, where, orderBy, limit, onSnapshot, doc, updateDoc, serverTimestamp, getDoc, addDoc, getDocs, setDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { obfuscateWithKey, hashPasswordSecure } from '@/lib/crypto';
import { getBusinessDate } from '@/lib/date-utils';

// ── ERROR BOUNDARY: captura crashes en paneles sin matar la app ──
class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  componentDidCatch(error, info) {
    console.error('[YoY ErrorBoundary] Panel crash:', error, info);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'var(--bg-base)', padding: 24
        }}>
          <div style={{
            background: 'var(--bg-elevated)', border: '1px solid rgba(239,68,68,0.3)',
            borderRadius: 16, padding: 32, maxWidth: 480, textAlign: 'center'
          }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>⚠️</div>
            <h2 style={{ fontSize: 18, fontWeight: 800, color: '#ef4444', marginBottom: 8 }}>Error en el panel</h2>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 20, lineHeight: 1.6 }}>
              Se produjo un error inesperado. Haz clic en Recargar para volver al sistema.
              Si el problema persiste, limpia el caché del navegador con <strong>Ctrl+Shift+R</strong>.
            </p>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', background: 'var(--bg-main)', padding: '8px 12px', borderRadius: 8, marginBottom: 20, textAlign: 'left', fontFamily: 'monospace', wordBreak: 'break-all' }}>
              {this.state.error?.message || 'Error desconocido'}
            </div>
            <button
              onClick={() => { this.setState({ hasError: false, error: null }); window.location.reload(); }}
              style={{
                background: 'linear-gradient(135deg, var(--bronze), var(--bronze-light))',
                color: '#fff', border: 'none', borderRadius: 10, padding: '10px 24px',
                fontWeight: 700, fontSize: 13, cursor: 'pointer'
              }}
            >
              🔄 Recargar Sistema
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// ── UTILIDADES DE SINCRONIZACIÓN DE CRASH LOGS ──
function saveCrashLogLocally(log) {
  if (typeof window === 'undefined') return;
  try {
    const pending = localStorage.getItem('yoy_pending_crash_logs');
    const list = pending ? JSON.parse(pending) : [];
    list.push(log);
    localStorage.setItem('yoy_pending_crash_logs', JSON.stringify(list));
    console.log('[PanelErrorBoundary] Log de crash guardado en localStorage (offline).');
  } catch (e) {
    console.error('Error al guardar crash log localmente:', e);
  }
}

function syncPendingCrashLogs() {
  if (typeof window === 'undefined') return;
  try {
    const pending = localStorage.getItem('yoy_pending_crash_logs');
    if (!pending) return;
    const list = JSON.parse(pending);
    if (list.length === 0) return;

    console.log(`[YoY Sync] Sincronizando ${list.length} crash logs offline...`);
    Promise.all(list.map(log => {
      return addDoc(collection(db, 'app_crash_logs'), log);
    })).then(() => {
      localStorage.removeItem('yoy_pending_crash_logs');
      console.log(`[YoY Sync] Sincronizacion exitosa.`);
    }).catch(err => {
      console.warn('[YoY Sync] Error al sincronizar logs offline:', err);
    });
  } catch (e) {
    console.error('Error en syncPendingCrashLogs:', e);
  }
}

// ── PANEL ERROR BOUNDARY: captura crashes locales por panel sin tumbar la navegación ──
class PanelErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  componentDidCatch(error, info) {
    console.error(`[YoY ErrorBoundary] Panel [${this.props.name || 'desconocido'}] crash:`, error, info);
    try {
      const panelName = this.props.name || 'desconocido';
      const errMessage = error?.message || String(error);
      const errStack = error?.stack || '';
      const compStack = info?.componentStack || '';
      const userAgent = typeof navigator !== 'undefined' ? navigator.userAgent : 'desconocido';
      const url = typeof window !== 'undefined' ? window.location.href : 'desconocido';
      const userEmail = this.props.user?.email || 'no-autenticado';
      const userId = this.props.user?.uid || 'no-autenticado';

      const logData = {
        panelName,
        errorMessage: errMessage,
        errorStack: errStack,
        componentStack: compStack,
        userAgent,
        url,
        userEmail,
        userId,
        createdAt: new Date().toISOString()
      };

      // 1. Guardar log en Firestore (con fallback offline a localStorage)
      addDoc(collection(db, 'app_crash_logs'), logData).catch(e => {
        console.error('[PanelErrorBoundary] Error al guardar log en Firestore, guardando localmente:', e);
        saveCrashLogLocally(logData);
      });

      // 2. Enviar Alerta a Telegram
      getDoc(doc(db, 'config', 'telegram')).then(snap => {
        if (snap.exists() && snap.data().enabled) {
          const d = snap.data();
          const text = `🚨 *FALLO EN PANEL DETECTADO* 🚨\n\n` +
            `• *Panel:* ${panelName}\n` +
            `• *Error:* \`${errMessage.substring(0, 100)}\`\n` +
            `• *Usuario:* ${userEmail}\n` +
            `• *Navegador:* ${userAgent.substring(0, 50)}...\n` +
            `• *Fecha:* ${new Date().toLocaleString()}`;

          fetch('/api/telegram/send-alert', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              mode: d.mode,
              token: d.botToken,
              chatId: d.chatId,
              phone: d.phone,
              text: text
            })
          }).catch(err => console.error('[PanelErrorBoundary] Error al enviar Telegram:', err));
        }
      }).catch(err => console.error('[PanelErrorBoundary] Error al obtener config de Telegram:', err));

    } catch (e) {
      console.error('[PanelErrorBoundary] Falló el proceso de reporte de error:', e);
    }
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'var(--bg-base)', padding: 32, minHeight: '400px', borderRadius: 16,
          border: '1px dashed rgba(239,68,68,0.2)', width: '100%'
        }}>
          <div style={{
            background: 'var(--bg-elevated)', border: '1px solid rgba(239,68,68,0.3)',
            borderRadius: 16, padding: 32, maxWidth: 480, width: '100%', textAlign: 'center',
            boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)'
          }}>
            <div style={{ fontSize: 36, marginBottom: 12 }}>⚠️</div>
            <h2 style={{ fontSize: 16, fontWeight: 800, color: '#ef4444', marginBottom: 8 }}>
              Error en el panel {this.props.name ? `"${this.props.name}"` : ''}
            </h2>
            <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 16, lineHeight: 1.5 }}>
              Ocurrió un error inesperado en este componente. Puedes restablecer este panel o recargar la aplicación.
            </p>
            <div style={{ 
              fontSize: 11, color: 'var(--text-muted)', background: 'var(--bg-main)', 
              padding: '10px 14px', borderRadius: 8, marginBottom: 20, 
              textAlign: 'left', fontFamily: 'monospace', wordBreak: 'break-all',
              maxHeight: '120px', overflowY: 'auto', border: '1px solid var(--border)'
            }}>
              {this.state.error?.message || 'Error desconocido'}
            </div>
            <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
              <button
                onClick={() => { this.setState({ hasError: false, error: null }); }}
                style={{
                  background: 'rgba(255, 255, 255, 0.05)',
                  border: '1px solid var(--border)',
                  color: 'var(--text-main)', borderRadius: 10, padding: '8px 16px',
                  fontWeight: 600, fontSize: 12, cursor: 'pointer', transition: 'all 0.2s'
                }}
              >
                🔄 Restablecer Panel
              </button>
              <button
                onClick={() => { window.location.reload(); }}
                style={{
                  background: 'linear-gradient(135deg, var(--bronze), var(--bronze-light))',
                  color: '#fff', border: 'none', borderRadius: 10, padding: '8px 16px',
                  fontWeight: 700, fontSize: 12, cursor: 'pointer', transition: 'all 0.2s'
                }}
              >
                🖥️ Recargar App
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function AppContent() {
  const { user, loading, loginWithEmpleadoId, logout, isSuspended } = useAuth();
  const [minLoadingDone, setMinLoadingDone] = useState(false);
  const [imageError, setImageError] = useState(false);
  const [activePanel, setActivePanel] = useState('mesas');
  const [toasts, setToasts] = useState([]);

  const showToast = (message, type = 'info') => {
    const id = Date.now();
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4000);
  };
  const [showPasswordChangeReminder, setShowPasswordChangeReminder] = useState(false);
  const [isDefaultPin, setIsDefaultPin] = useState(false);
  const [isDefaultPassword, setIsDefaultPassword] = useState(false);
  const [showCredentialsModal, setShowCredentialsModal] = useState(false);
  const [dismissedSessionReminder, setDismissedSessionReminder] = useState(false);

  useEffect(() => {
    if (user && (user.email === 'masteradmin@yoybillar.mx' || user.email?.startsWith('masteradmin@'))) {
      const checkCredentials = async () => {
        try {
          const tempHash = await hashPasswordSecure('123456');
          const hasDefaultPass = user.password === tempHash || user.password === '123456';
          setIsDefaultPassword(hasDefaultPass);
          
          let hasDefaultPin = false;
          const secDoc = await getDoc(doc(db, 'config', 'seguridad'));
          if (secDoc.exists() && secDoc.data().adminPinHash) {
            hasDefaultPin = secDoc.data().adminPinHash === '56760663';
          } else {
            hasDefaultPin = true;
          }
          
          setIsDefaultPin(hasDefaultPin);
          const needsChange = hasDefaultPass || hasDefaultPin;
          setShowPasswordChangeReminder(needsChange);
          
          if (needsChange) {
            const sessionDismissed = sessionStorage.getItem('yoy_dismissed_credentials_reminder');
            if (sessionDismissed) {
              setDismissedSessionReminder(true);
            } else {
              setDismissedSessionReminder(false);
              setShowCredentialsModal(true);
            }
          } else {
            setShowCredentialsModal(false);
            setDismissedSessionReminder(false);
          }
        } catch (e) {
          console.error(e);
        }
      };
      checkCredentials();
    } else {
      setShowPasswordChangeReminder(false);
      setIsDefaultPin(false);
      setIsDefaultPassword(false);
      setShowCredentialsModal(false);
      setDismissedSessionReminder(false);
    }
  }, [user]);

  const [isProcessingQR, setIsProcessingQR] = useState(() => {
    if (typeof window !== 'undefined') {
      return !!new URLSearchParams(window.location.search).get('scanId');
    }
    return false;
  });

  const [fichajeSoporteExitoso, setFichajeSoporteExitoso] = useState(null);
  const [fichajeError, setFichajeError] = useState(null);
  const [qrDecisionEmployee, setQrDecisionEmployee] = useState(null);
  const [scanParams, setScanParams] = useState(() => {
    if (typeof window !== 'undefined') {
      try {
        const stored = localStorage.getItem('temp_scan_params');
        return stored ? JSON.parse(stored) : null;
      } catch (e) {
        return null;
      }
    }
    return null;
  });
  const processedRef = useRef(false);

  // Removido el autocierre automático del error de asistencia para evitar redirigir al login admin


  // Medir y establecer el ancho de la barra de desplazamiento como una variable CSS
  useEffect(() => {
    const calculateScrollbarWidth = () => {
      const width = window.innerWidth - document.documentElement.clientWidth;
      document.documentElement.style.setProperty('--scrollbar-width', `${width}px`);
    };
    calculateScrollbarWidth();
    window.addEventListener('resize', calculateScrollbarWidth);
    return () => window.removeEventListener('resize', calculateScrollbarWidth);
  }, []);

  // Sincronizar crash logs offline pendientes en segundo plano
  useEffect(() => {
    syncPendingCrashLogs();
  }, []);

  // Limpiar Service Workers obsoletos y caché del navegador para evitar assets obsoletos
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistrations().then(regs => {
        regs.forEach(reg => reg.unregister());
      }).catch(() => {});
    }
    if (typeof window !== 'undefined' && 'caches' in window) {
      caches.keys().then(names => {
        names.forEach(name => {
          caches.delete(name);
        });
      }).catch(() => {});
    }
  }, []);

  // Asegura que la animación de carga se muestre al menos durante 5 segundos
  useEffect(() => {
    const timer = setTimeout(() => {
      setMinLoadingDone(true);
    }, 5000);
    return () => clearTimeout(timer);
  }, []);

  // Alerta de captura de mesero (3 segundos)
  const [capturaAlert, setCapturaAlert] = useState(null); // { mesaId, total }
  
  // Alertas de asistencia pendientes para popup principal
  const [alertasAsistencia, setAlertasAsistencia] = useState([]);
  const [sonidoAdmin, setSonidoAdmin] = useState(true);
  const [insumosBajos, setInsumosBajos] = useState([]);
  const [iaPrevisiones, setIaPrevisiones] = useState({});
  const [cocinaSolicitudes, setCocinaSolicitudes] = useState([]);

  const [mesas, setMesas] = useState([]);
  const [cuentas, setCuentas] = useState([]);
  const [personalActivo, setPersonalActivo] = useState([]);
  const [ultimoCorte, setUltimoCorte] = useState(null);
  const [iaAlerts, setIaAlerts] = useState({
    activeIds: ['stockBajo', 'altaOcupacion'],
    states: {
      stockBajo: true,
      altaOcupacion: true,
      clienteNoAtendido: true,
      altoConsumo: true,
      mesaSinConsumo: true,
      descuadreCaja: true,
      comandaSinMesa: true,
      tiempoExcesivo: true,
      insumoCritico: true,
      comandaDemorada: true,
      inactividadMesero: true,
      sinPersonalActivo: true,
      excesoCortesias: true,
      tarifaDinamicaRecomendada: true
    },
    telegramAlerts: {}
  });

  useEffect(() => {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      if (Notification.permission !== 'granted' && Notification.permission !== 'denied') {
        Notification.requestPermission();
      }
    }
  }, []);

  // 1. Escuchar inventario para insumos por debajo de stock óptimo y sincronizar a cocina_insumos
  useEffect(() => {
    if (!user) return;
    const unsub = onSnapshot(doc(db, 'config', 'inventario'), async snap => {
      if (snap.exists()) {
        const prods = snap.data().productos || [];
        const bajos = prods.filter(p => p.categoria === 'Insumo' && p.stock < (p.stockOptimo || 0));
        setInsumosBajos(bajos);

        // Sincronización automática de inventario general hacia cocina_insumos
        try {
          const insSnap = await getDocs(collection(db, 'cocina_insumos'));
          const batchUpdates = [];
          const bitacoraLogs = [];
          
          insSnap.forEach(insDoc => {
            const insData = insDoc.data();
            const matchingProd = prods.find(p => p.nombre.toLowerCase() === insData.nombre.toLowerCase());
            if (matchingProd) {
              const stock = Number(matchingProd.stock);
              const stockOptimo = Number(matchingProd.stockOptimo || 0);
              
              let needsUpdate = false;
              const updates = {};
              
              if (insData.nivelActual !== stock) {
                updates.nivelActual = stock;
                needsUpdate = true;
              }
              
              if (insData.surtidoSolicitado === true && stock >= stockOptimo) {
                updates.surtidoSolicitado = false;
                needsUpdate = true;
                
                // Calcular tiempo de respuesta
                const solicitadoAt = insData.surtidoSolicitadoAt?.toDate ? insData.surtidoSolicitadoAt.toDate() : null;
                let duracionMinutosStr = "Desconocido";
                if (solicitadoAt) {
                  const diffMs = Date.now() - solicitadoAt.getTime();
                  const diffMins = Math.round(diffMs / 1000 / 60);
                  duracionMinutosStr = `${diffMins} min`;
                }
                
                bitacoraLogs.push({
                  fecha: new Date().toISOString(),
                  tipo: 'inventario',
                  operador: user?.nombre || user?.alias || 'Administración',
                  rolOperador: user?.role || 'admin',
                  accion: 'Surtido de Cocina Atendido',
                  detalle: `Se surtió el insumo "${insData.nombre}" (Stock: ${stock} >= Óptimo: ${stockOptimo}). Tiempo de respuesta: ${duracionMinutosStr}.`,
                  monto: 0
                });
              }
              
              if (needsUpdate) {
                batchUpdates.push({ ref: doc(db, 'cocina_insumos', insDoc.id), data: updates });
              }
            }
          });
          
          if (batchUpdates.length > 0) {
            const { writeBatch } = await import('firebase/firestore');
            const batch = writeBatch(db);
            batchUpdates.forEach(u => {
              batch.update(u.ref, { ...u.data, updatedAt: serverTimestamp() });
            });
            await batch.commit();
          }

          if (bitacoraLogs.length > 0) {
            for (const log of bitacoraLogs) {
              await addDoc(collection(db, 'bitacora'), log);
            }
          }
        } catch (err) {
          console.error("Error sincronizando a cocina_insumos:", err);
        }
      }
    });
    return unsub;
  }, [user]);

  // 1b. Escuchar solicitudes de surtido de cocina activas y reproducir alerta acústica
  useEffect(() => {
    if (!user) return;
    const q = query(collection(db, 'cocina_insumos'), where('surtidoSolicitado', '==', true));
    const unsub = onSnapshot(q, snap => {
      const list = [];
      snap.forEach(doc => {
        list.push({ id: doc.id, ...doc.data() });
      });
      
      // Si hay nuevas solicitudes, reproducir tono acústico y lanzar notificación push nativa
      if (list.length > cocinaSolicitudes.length && list.length > 0 && sonidoAdmin) {
        try {
          const ctx = new (window.AudioContext || window.webkitAudioContext)();
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.frequency.setValueAtTime(659.25, ctx.currentTime);
          gain.gain.setValueAtTime(0.12, ctx.currentTime);
          osc.start();
          osc.stop(ctx.currentTime + 0.1);
          setTimeout(() => {
            const osc2 = ctx.createOscillator();
            const gain2 = ctx.createGain();
            osc2.connect(gain2);
            gain2.connect(ctx.destination);
            osc2.frequency.setValueAtTime(659.25, ctx.currentTime);
            gain2.gain.setValueAtTime(0.12, ctx.currentTime);
            osc2.start();
            osc2.stop(ctx.currentTime + 0.1);
          }, 150);
        } catch (e) {}

        // Notificación nativa del navegador
        try {
          if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
            const nuevosInsumos = list.filter(item => !cocinaSolicitudes.some(prev => prev.id === item.id));
            nuevosInsumos.forEach(item => {
              new Notification("⚠️ YoY IA Billar - Cocina solicita surtido", {
                body: `Urgente: Se requiere surtir "${item.nombre}". Cantidad actual: ${item.nivelActual} ${item.unidad}.`,
                icon: '/icon.png'
              });
            });
          }
        } catch (err) {
          console.warn("Fallo al enviar notificación nativa:", err);
        }
      }
      setCocinaSolicitudes(list);
    });
    return unsub;
  }, [user, cocinaSolicitudes.length, sonidoAdmin]);

  // 2. Escuchar alertas predictivas de la IA
  useEffect(() => {
    if (!user) return;
    const unsub = onSnapshot(doc(db, 'config', 'ia_prevision_insumos'), snap => {
      if (snap.exists()) {
        setIaPrevisiones(snap.data().previsiones || {});
      }
    });
    return unsub;
  }, [user]);

  // 3. Escuchar configuración de Alertas IA
  useEffect(() => {
    if (!user) return;
    const unsubIaAlerts = onSnapshot(doc(db, 'config', 'ia_alertas'), snap => {
      if (snap.exists()) {
        const d = snap.data();
        setIaAlerts({
          activeIds: d.activeIds || ['stockBajo', 'altaOcupacion'],
          states: d.states || {
            stockBajo: true,
            altaOcupacion: true,
            clienteNoAtendido: true,
            altoConsumo: true,
            mesaSinConsumo: true,
            descuadreCaja: true,
            comandaSinMesa: true,
            tiempoExcesivo: true,
            insumoCritico: true,
            comandaDemorada: true,
            inactividadMesero: true,
            sinPersonalActivo: true,
            excesoCortesias: true,
            tarifaDinamicaRecomendada: true
          },
          telegramAlerts: d.telegramAlerts || {}
        });
      }
    });
    return unsubIaAlerts;
  }, [user]);

  // 4. Escuchar mesas, cuentas y personal en tiempo real para las alertas IA
  useEffect(() => {
    if (!user) return;
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
    const unsubAsistencia = onSnapshot(collection(db, 'nomina_asistencia'), snap => {
      const list = [];
      snap.forEach(doc => {
        list.push({ id: doc.id, ...doc.data() });
      });
      setPersonalActivo(list);
    });
    const qCortes = query(collection(db, 'cortes_caja'), orderBy('fecha', 'desc'), limit(1));
    const unsubCortes = onSnapshot(qCortes, snap => {
      if (!snap.empty) {
        setUltimoCorte({ id: snap.docs[0].id, ...snap.docs[0].data() });
      }
    });

    return () => {
      unsubMesas();
      unsubCuentas();
      unsubAsistencia();
      unsubCortes();
    };
  }, [user]);

  // --- Estado y Handlers para Alertas Silenciadas (Snooze por 1 hora) ---
  const [snoozedAlerts, setSnoozedAlerts] = useState({});

  // Cargar de localStorage al inicio
  useEffect(() => {
    if (typeof window !== 'undefined') {
      try {
        const stored = localStorage.getItem('yoy_snoozed_alerts');
        if (stored) {
          setSnoozedAlerts(JSON.parse(stored));
        }
      } catch (e) {
        console.error("Error al cargar alertas silenciadas de localStorage:", e);
      }
    }
  }, []);

  const handleSnoozeAlert = (alertId) => {
    const until = Date.now() + 3600000; // 1 hora de silencio
    const updated = { ...snoozedAlerts, [alertId]: until };
    setSnoozedAlerts(updated);
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem('yoy_snoozed_alerts', JSON.stringify(updated));
      } catch (e) {
        console.error(e);
      }
    }
  };

  // Ref para rastrear envíos de Telegram y evitar duplicados/spam
  const lastSentTelegramAlerts = useRef({});

  // Evaluador de Alertas IA (Memorizado para optimizar rendimiento)
  const activeAlertsList = useMemo(() => {
    const list = [];
    if (!iaAlerts || !iaAlerts.activeIds) return list;

    iaAlerts.activeIds.forEach(id => {
      if (!iaAlerts.states || iaAlerts.states[id] === false) return;

      switch (id) {
        case 'stockBajo':
          if (insumosBajos.length > 0) {
            list.push({
              id,
              icon: '⚠️',
              text: `Monitoreo de Inventario: Hay ${insumosBajos.length} insumo(s) por debajo de su nivel óptimo (${insumosBajos.slice(0, 2).map(i => i.nombre).join(', ')}).`,
              btnText: 'Ver Inventario',
              panel: 'config'
            });
          }
          break;
        case 'altaOcupacion':
          const ocupadas = mesas.filter(m => m.estado === 'ocupada').length;
          const pct = mesas.length > 0 ? (ocupadas / mesas.length) * 100 : 0;
          if (pct >= 70) {
            list.push({
              id,
              icon: '📈',
              text: `Alta Ocupación: Se supera el 70% de mesas ocupadas (${ocupadas}/${mesas.length}). Sugerir tarifa dinámica.`,
              btnText: 'Ver Mesas',
              panel: 'mesas'
            });
          }
          break;
        case 'clienteNoAtendido':
          const mesasSinAtender = mesas.filter(m => {
            if (m.estado !== 'ocupada' || !m.inicio) return false;
            const elapsedMin = (Date.now() - m.inicio) / 60000;
            if (elapsedMin < 15) return false;
            const cuenta = cuentas.find(c => c.mesaId === m.id);
            if (!cuenta || !cuenta.consumos || cuenta.consumos.length === 0) return true;
            const lastTime = cuenta.consumos.reduce((max, item) => Math.max(max, item.timestamp || 0), m.inicio);
            return (Date.now() - lastTime) / 60000 > 15;
          });
          if (mesasSinAtender.length > 0) {
            list.push({
              id,
              icon: '⏳',
              text: `Cliente no Atendido: Mesa(s) [${mesasSinAtender.map(m => m.nombre || m.id).join(', ')}] llevan más de 15 minutos sin atención.`,
              btnText: 'Ver Mesas',
              panel: 'mesas'
            });
          }
          break;
        case 'altoConsumo':
          const desabastoList = Object.entries(iaPrevisiones).filter(([_, data]) => data.riesgoDesabasto === true);
          if (desabastoList.length > 0) {
            list.push({
              id,
              icon: '🧠',
              text: `Alerta IA (Riesgo de Desabasto): Insumo(s) [${desabastoList.map(([name]) => name).join(', ')}] en alto consumo y pueden agotarse hoy.`,
              btnText: 'Ver Inventario',
              panel: 'config'
            });
          }
          break;
        case 'mesaSinConsumo':
          const mesasSinConsumoList = mesas.filter(m => {
            if (m.estado !== 'ocupada' || !m.inicio) return false;
            const elapsedHrs = (Date.now() - m.inicio) / 3600000;
            if (elapsedHrs < 2) return false;
            const cuenta = cuentas.find(c => c.mesaId === m.id);
            const sumConsumos = cuenta && cuenta.consumos ? cuenta.consumos.reduce((sum, item) => sum + item.precio * item.cantidad, 0) : 0;
            return sumConsumos < 100;
          });
          if (mesasSinConsumoList.length > 0) {
            list.push({
              id,
              icon: '🥤',
              text: `Mesa sin Consumo: Mesa(s) [${mesasSinConsumoList.map(m => m.nombre || m.id).join(', ')}] llevan más de 2 horas con consumo menor a $100.`,
              btnText: 'Ver Mesas',
              panel: 'mesas'
            });
          }
          break;
        case 'descuadreCaja':
          if (ultimoCorte && Math.abs(ultimoCorte.diferencia || 0) > 100) {
            list.push({
              id,
              icon: '💵',
              text: `Descuadre de Caja: Se detectó una diferencia de $${Math.abs(ultimoCorte.diferencia).toFixed(2)} MXN en el último corte de caja.`,
              btnText: 'Ir a Caja',
              panel: 'caja'
            });
          }
          break;
        case 'comandaSinMesa':
          const comandasHuerfanas = cocinaSolicitudes.filter(s => {
            if (!s.mesaId) return false;
            const mesa = mesas.find(m => m.id === s.mesaId);
            return !mesa || mesa.estado !== 'ocupada';
          });
          if (comandasHuerfanas.length > 0) {
            list.push({
              id,
              icon: '🚫',
              text: `Comanda sin Mesa: Hay comanda(s) enviadas a la mesa libre/inexistente [${comandasHuerfanas.map(c => c.mesaId).join(', ')}].`,
              btnText: 'Ver Pedidos',
              panel: 'bar'
            });
          }
          break;
        case 'tiempoExcesivo':
          const mesasExcesivas = mesas.filter(m => {
            if (m.estado !== 'ocupada' || !m.inicio) return false;
            const elapsedHrs = (Date.now() - m.inicio) / 3600000;
            return elapsedHrs > 4 && !m.preTicketImpreso;
          });
          if (mesasExcesivas.length > 0) {
            list.push({
              id,
              icon: '🕰️',
              text: `Tiempo Excesivo: Mesa(s) [${mesasExcesivas.map(m => m.nombre || m.id).join(', ')}] llevan más de 4 horas jugando sin emitir cuenta.`,
              btnText: 'Ver Mesas',
              panel: 'mesas'
            });
          }
          break;
        case 'insumoCritico':
          const insCriticos = insumosBajos.filter(i => (i.stockOptimo && i.stock <= i.stockOptimo * 0.3));
          if (insCriticos.length > 0) {
            list.push({
              id,
              icon: '🚨',
              text: `Insumo Crítico Bajo: ${insCriticos.length} insumo(s) clave en nivel crítico (menos del 30% de óptimo: ${insCriticos.slice(0, 2).map(i => i.nombre).join(', ')}).`,
              btnText: 'Ver Inventario',
              panel: 'config'
            });
          }
          break;
        case 'comandaDemorada':
          const ordenesDemoradas = cocinaSolicitudes.filter(s => {
            if (s.estado !== 'pendiente' || !s.createdAt) return false;
            const elapsedMin = (Date.now() - s.createdAt) / 60000;
            return elapsedMin > 20;
          });
          if (ordenesDemoradas.length > 0) {
            list.push({
              id,
              icon: '🍳',
              text: `Comanda Demorada: Hay ${ordenesDemoradas.length} orden(es) de barra/cocina demorada(s) por más de 20 minutos.`,
              btnText: 'Ver Barra/Cocina',
              panel: 'bar'
            });
          }
          break;
        case 'sinPersonalActivo':
          const personalActivoCount = personalActivo ? personalActivo.length : 0;
          const mesasOcupadasCount = mesas.filter(m => m.estado === 'ocupada').length;
          if (mesasOcupadasCount > 0 && personalActivoCount === 0) {
            list.push({
              id,
              icon: '👤',
              text: `Sin Personal Activo: Hay ${mesasOcupadasCount} mesa(s) ocupada(s) pero no hay registros de check-in activos en nómina.`,
              btnText: 'Ver Nómina',
              panel: 'nomina'
            });
          }
          break;
        case 'excesoCortesias':
          const cortesiasCount = (cuentas || []).reduce((sum, c) => sum + (c.cortesiasCount || 0), 0);
          if (cortesiasCount > 5) {
            list.push({
              id,
              icon: '🎁',
              text: `Exceso de Cortesías: Se han registrado ${cortesiasCount} cortesías en el turno actual, superando la recomendación diaria.`,
              btnText: 'Ver Auditoría',
              panel: 'caja'
            });
          }
          break;
        case 'tarifaDinamicaRecomendada':
          const dt = new Date();
          const day = dt.getDay();
          const hour = dt.getHours();
          const activeMesasCount = mesas.filter(m => m.estado === 'ocupada').length;
          if ((day === 5 || day === 6) && hour >= 18 && activeMesasCount >= mesas.length * 0.5) {
            list.push({
              id,
              icon: '⚡',
              text: `Recomendación de Tarifa: Alta afluencia fin de semana. Se sugiere activar Tarifa Dinámica (+15% por hora).`,
              btnText: 'Ir a Tarifas',
              panel: 'config'
            });
          }
          break;
      }
    });

    return list;
  }, [iaAlerts, insumosBajos, mesas, cuentas, iaPrevisiones, ultimoCorte, cocinaSolicitudes, personalActivo]);

  // Alertas IA que no están silenciadas actualmente
  const displayedAlerts = useMemo(() => {
    const ahora = Date.now();
    return activeAlertsList.filter(alert => {
      const until = snoozedAlerts[alert.id];
      return !until || ahora > until;
    });
  }, [activeAlertsList, snoozedAlerts]);

  // Enviar notificaciones de Telegram para Alertas IA configuradas (Opcional y con control de duplicados)
  useEffect(() => {
    if (!user || !activeAlertsList || activeAlertsList.length === 0) return;

    const sendTelegramAlerts = async () => {
      try {
        let tgConfig = null;
        for (const alert of activeAlertsList) {
          const alertId = alert.id;
          
          // Verificar si esta alerta tiene habilitado el envío por Telegram
          if (!iaAlerts.telegramAlerts || !iaAlerts.telegramAlerts[alertId]) {
            continue;
          }

          // Evitar re-enviar la misma alerta en menos de 1 hora (3600000 ms)
          const ahora = Date.now();
          const lastSentTime = lastSentTelegramAlerts.current[alertId] || 0;
          if (ahora - lastSentTime < 3600000) {
            continue;
          }

          // Cargar configuración de Telegram
          if (!tgConfig) {
            const snap = await getDoc(doc(db, 'config', 'telegram'));
            if (snap.exists()) {
              tgConfig = snap.data();
            }
          }

          if (tgConfig && tgConfig.enabled) {
            // Actualizar timestamp de envío antes de disparar el fetch para evitar race conditions
            lastSentTelegramAlerts.current[alertId] = ahora;

            const text = `🤖 *ALERTA IA CRÍTICA* 🤖\n\n` +
              `• *Alerta:* ${alert.text}\n` +
              `• *Acción:* ${alert.btnText}\n` +
              `• *Fecha:* ${new Date().toLocaleString()}`;

            fetch('/api/telegram/send-alert', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                mode: tgConfig.mode,
                token: tgConfig.botToken,
                chatId: tgConfig.chatId,
                phone: tgConfig.phone,
                text: text
              })
            })
            .then(res => res.json())
            .then(data => {
              if (data && data.success) {
                console.log(`Telegram enviado para alerta ${alertId}`);
              } else {
                console.error(`Error al enviar Telegram para alerta ${alertId}:`, data?.error || 'Error desconocido');
              }
            })
            .catch(err => {
              console.error(`Error de red al enviar Telegram para alerta ${alertId}:`, err);
            });
          }
        }
      } catch (err) {
        console.error("Error al procesar envío de Telegram para Alertas IA:", err);
      }
    };

    sendTelegramAlerts();
  }, [activeAlertsList, iaAlerts.telegramAlerts, user]);

  // Motor de Aprendizaje IA Diario
  const ejecutarAprendizajeIA = async () => {
    try {
      const hoy = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD
      const lastRun = localStorage.getItem('yoy_last_ia_learning_run');
      if (lastRun === hoy) {
        console.log("El aprendizaje diario de IA ya se ejecutó hoy.");
        return;
      }

      console.log("Ejecutando motor de aprendizaje diario IA...");
      
      // 1. Obtener recetas de costeo unificadas desde localStorage (desofuscar)
      let recetas = [];
      try {
        const savedRecetas = localStorage.getItem('yoy_recetas_costeo');
        if (savedRecetas) {
          const { deobfuscate } = await import('@/lib/crypto');
          recetas = deobfuscate(savedRecetas) || [];
        }
      } catch (e) {
        console.warn("No se pudieron leer recetas para aprendizaje IA:", e);
      }

      // 2. Consultar las últimas comandas completadas filtrando en memoria
      const q = query(
        collection(db, 'mesa_pedidos'),
        orderBy('createdAt', 'desc'),
        limit(300)
      );
      const snap = await getDocs(q);
      const allPedidos = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      const pedidosCompletados = allPedidos
        .filter(p => p.tipo === 'pedido' && p.estado === 'entregado')
        .slice(0, 150);

      if (pedidosCompletados.length === 0) {
        console.log("No hay comandas completadas suficientes para entrenar la IA.");
        localStorage.setItem('yoy_last_ia_learning_run', hoy);
        return;
      }

      // 3. Obtener el inventario actual
      const invSnap = await getDoc(doc(db, 'config', 'inventario'));
      if (!invSnap.exists()) return;
      const productos = invSnap.data().productos || [];
      const insumos = productos.filter(p => p.categoria === 'Insumo');

      // 4. Helper para clasificar turnos horarios
      const getShiftFromHour = (hour) => {
        if (hour >= 10 && hour < 16) return 'manana';
        if (hour >= 16 && hour < 20) return 'tarde';
        if (hour >= 20 || hour < 2) return 'noche';
        return 'cerrado';
      };

      // 5. Calcular el consumo histórico agrupado por día de la semana y turno
      const consumosPorDiaTurno = Array.from({ length: 7 }, () => ({
        manana: {},
        tarde: {},
        noche: {}
      }));
      
      const fechasUnicasPorDiaTurno = Array.from({ length: 7 }, () => ({
        manana: new Set(),
        tarde: new Set(),
        noche: new Set()
      }));

      pedidosCompletados.forEach(p => {
        const date = p.createdAt?.toDate ? p.createdAt.toDate() : new Date(p.createdAt);
        if (isNaN(date.getTime())) return;
        const dayOfWeek = date.getDay();
        const hour = date.getHours();
        const shift = getShiftFromHour(hour);
        if (shift === 'cerrado') return;

        const dateStr = date.toLocaleDateString('en-CA');
        fechasUnicasPorDiaTurno[dayOfWeek][shift].add(dateStr);

        if (Array.isArray(p.items)) {
          p.items.forEach(item => {
            const recipe = recetas.find(r => r.productoId === item.productoId);
            if (recipe && Array.isArray(recipe.ingredientes)) {
              recipe.ingredientes.forEach(ing => {
                const nameKey = ing.nombreInsumo || ing.insumoId;
                if (!nameKey) return;
                const qty = (item.cantidad || 0) * Number(ing.cantidad) * (1 + (Number(ing.mermaPct) || 0) / 100);
                consumosPorDiaTurno[dayOfWeek][shift][nameKey] = (consumosPorDiaTurno[dayOfWeek][shift][nameKey] || 0) + qty;
              });
            }
          });
        }
      });

      // 6. Calcular promedios por día y turno
      const promediosDiaTurno = {};
      insumos.forEach(ins => {
        promediosDiaTurno[ins.nombre] = Array.from({ length: 7 }, () => ({
          manana: 0,
          tarde: 0,
          noche: 0
        }));
        for (let d = 0; d < 7; d++) {
          for (const shift of ['manana', 'tarde', 'noche']) {
            const numDias = fechasUnicasPorDiaTurno[d][shift].size || 1;
            const totalConsumo = consumosPorDiaTurno[d][shift][ins.nombre] || consumosPorDiaTurno[d][ins.id] || 0;
            promediosDiaTurno[ins.nombre][d][shift] = totalConsumo / numDias;
          }
        }
      });

      // 7. Proyectar la demanda de las próximas 48 horas basadas en turnos/turnos
      const hoyD = new Date().getDay();
      const mananaD = (hoyD + 1) % 7;
      const pasadomananaD = (hoyD + 2) % 7;
      
      const getProximosTurnos48h = () => {
        const ahora = new Date();
        const horaActual = ahora.getHours();
        const turnos = [];
        const shiftActual = getShiftFromHour(horaActual);
        
        if (shiftActual === 'manana') {
          turnos.push({ day: hoyD, shift: 'manana' });
          turnos.push({ day: hoyD, shift: 'tarde' });
          turnos.push({ day: hoyD, shift: 'noche' });
        } else if (shiftActual === 'tarde') {
          turnos.push({ day: hoyD, shift: 'tarde' });
          turnos.push({ day: hoyD, shift: 'noche' });
        } else if (shiftActual === 'noche') {
          turnos.push({ day: hoyD, shift: 'noche' });
        } else {
          // Cerrado/madrugada
          turnos.push({ day: hoyD, shift: 'manana' });
          turnos.push({ day: hoyD, shift: 'tarde' });
          turnos.push({ day: hoyD, shift: 'noche' });
        }
        
        // Mañana (completo)
        turnos.push({ day: mananaD, shift: 'manana' });
        turnos.push({ day: mananaD, shift: 'tarde' });
        turnos.push({ day: mananaD, shift: 'noche' });
        
        // Pasado mañana (completo)
        turnos.push({ day: pasadomananaD, shift: 'manana' });
        turnos.push({ day: pasadomananaD, shift: 'tarde' });
        turnos.push({ day: pasadomananaD, shift: 'noche' });
        
        return turnos;
      };

      const previsiones = {};

      // 8. Cargar torneos
      let multiplierTorneo = 1.0;
      try {
        const rawTorneos = localStorage.getItem('yoy_billar_torneos');
        if (rawTorneos) {
          const { deobfuscate } = await import('@/lib/crypto');
          const torneos = deobfuscate(rawTorneos) || [];
          const ahoraMs = Date.now();
          const limiteMs = ahoraMs + 48 * 60 * 60 * 1000;
          const hayTorneoProximo = torneos.some(t => {
            const tDate = new Date(t.fechaInicio).getTime();
            return tDate >= ahoraMs && tDate <= limiteMs;
          });
          if (hayTorneoProximo) {
            multiplierTorneo = 1.5;
            console.log("¡Evento/Torneo detectado en las próximas 48h! Aplicando multiplicador IA de 1.5x.");
          }
        }
      } catch (e) {
        console.warn("Error evaluando torneos para predicción IA:", e);
      }

      insumos.forEach(ins => {
        const turnos48h = getProximosTurnos48h();
        let demandaProyectada = 0;
        turnos48h.forEach(t => {
          demandaProyectada += promediosDiaTurno[ins.nombre][t.day][t.shift] || 0;
        });
        demandaProyectada = demandaProyectada * multiplierTorneo;

        // Comprobar si hay riesgo crítico en el turno pico de la noche
        const turnosNoche = turnos48h.filter(t => t.shift === 'noche');
        let demandaNoches = 0;
        turnosNoche.forEach(t => {
          demandaNoches += promediosDiaTurno[ins.nombre][t.day][t.shift] || 0;
        });
        const riesgoNoche = ins.stock < demandaNoches * multiplierTorneo && demandaNoches > 0;

        const riesgo = ins.stock < demandaProyectada;
        let motivo = '';
        if (riesgo) {
          motivo = `Demanda 48h estimada (${demandaProyectada.toFixed(1)} ${ins.unidad}) superará stock actual (${ins.stock} ${ins.unidad}).`;
          if (riesgoNoche) {
            motivo += ` Riesgo crítico en turno pico noche (demanda: ${(demandaNoches * multiplierTorneo).toFixed(1)} ${ins.unidad}).`;
          }
          if (multiplierTorneo > 1.0) {
            motivo += ` Incrementado por torneo.`;
          }
        } else {
          motivo = `Stock suficiente para demanda 48h (${demandaProyectada.toFixed(1)} ${ins.unidad}).`;
        }

        previsiones[ins.nombre] = {
          consumoDiarioPromedio: Number((demandaProyectada / 2).toFixed(1)),
          demandaProxima48h: Number(demandaProyectada.toFixed(1)),
          riesgoDesabasto: riesgo || riesgoNoche,
          motivo,
          cantidadSugerida: (riesgo || riesgoNoche) ? Math.max(0, Math.ceil(ins.stockOptimo - ins.stock)) : 0
        };
      });

      // 8. Guardar previsor en Firestore config/ia_prevision_insumos
      await setDoc(doc(db, 'config', 'ia_prevision_insumos'), {
        previsiones,
        updatedAt: serverTimestamp(),
        lastRunDate: hoy
      });

      localStorage.setItem('yoy_last_ia_learning_run', hoy);
      console.log("¡Aprendizaje IA completado con éxito! Previsiones guardadas en Firestore.");
    } catch (err) {
      console.error("Error en ejecutarAprendizajeIA:", err);
    }
  };

  // Ejecutar aprendizaje IA al iniciar sesión
  useEffect(() => {
    if (user && (user.role === 'admin' || user.role === 'cajero' || user.role === 'gerente')) {
      ejecutarAprendizajeIA();
    }
  }, [user]);

  // Redirigir si no tiene permisos para el panel activo
  useEffect(() => {
    if (isProcessingQR) return;
    if (user) {
      const panelRoles = {
        dashboard: ['admin', 'gerente', 'cajero'],
        mesas:     ['admin', 'gerente', 'cajero', 'mesero'],
        caja:      ['admin', 'gerente', 'cajero'],
        bar:       ['admin', 'gerente', 'mesero'],
        torneos:   ['admin', 'gerente', 'arbitro'],
        nomina:    ['admin', 'gerente'],
        config:    ['admin']
      };

      const userRole = user.role || 'cajero';
      let tienePermiso = true;

      if (user.permisos) {
        if (typeof user.permisos[activePanel] !== 'undefined') {
          tienePermiso = user.permisos[activePanel] === true;
        } else {
          tienePermiso = panelRoles[activePanel]?.includes(userRole) || false;
        }
      } else {
        tienePermiso = panelRoles[activePanel]?.includes(userRole) || false;
      }

      if (!tienePermiso) {
        const primerPermitido = ['dashboard', 'mesas', 'caja', 'bar', 'torneos', 'nomina', 'config']
          .find(key => {
            if (user.permisos && typeof user.permisos[key] !== 'undefined') {
              return user.permisos[key] === true;
            }
            return panelRoles[key]?.includes(userRole);
          });
        if (primerPermitido) {
          setActivePanel(primerPermitido);
        }
      }
    }
  }, [user, activePanel, isProcessingQR]);

  // Auto-redireccionar si el usuario es mesero, cocina o bartender y accede al panel principal (Sugerencia 3)
  useEffect(() => {
    if (isProcessingQR) return;
    if (user) {
      const rolLower = (user.role || '').toLowerCase();
      if (rolLower.includes('mesero')) {
        window.location.href = '/mesero';
      } else if (
        rolLower.includes('cocina') ||
        rolLower.includes('bartender') ||
        rolLower.includes('barman') ||
        rolLower.includes('cocinero')
      ) {
        window.location.href = '/cocina';
      }
    }
  }, [user, isProcessingQR]);

  const procesarLoginQR = async (params, isRetry = false) => {
    if (!params || (isRetry && isProcessingQR)) return;
    try {
      setIsProcessingQR(true);
      setFichajeError(null);
      
      // Forzar un retraso artificial de 1 segundo para permitir que React pinte la pantalla de carga
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Sugerencia 1: Limpieza explícita inmediata de la sesión previa en localStorage, Firebase y Contexto
      if (user) {
        await logout();
      } else {
        localStorage.removeItem('yoy_ia_session');
      }

      let geoData = { lat: null, lng: null, precision: null, status: 'No requerido' };

      // Obtener el tipo de dispositivo que escanea con detalle de modelo
      const ua = navigator.userAgent;
      let dispositivo = 'PC/Terminal';
      if (/Mobi|Android|iPhone/i.test(ua)) {
        let mobileBrand = 'Móvil';
        if (/iPhone/i.test(ua)) {
          const match = ua.match(/iPhone;\s*([^;)]+)/);
          mobileBrand = match ? `iPhone (${match[1]})` : 'iPhone';
        } else if (/Android/i.test(ua)) {
          const match = ua.match(/Android\s+([^;)]+)(?:;\s*([^;)]+))?/);
          let model = '';
          if (match) {
            const osVer = match[1];
            const modelMatch = ua.match(/;\s*([^;)]+)\s+Build\//);
            model = modelMatch ? modelMatch[1] : '';
            mobileBrand = `Android ${osVer}${model ? ` (${model})` : ''}`;
          } else {
            mobileBrand = 'Android';
          }
        }
        dispositivo = mobileBrand;
      } else if (/Tablet|iPad/i.test(ua)) {
        dispositivo = /iPad/i.test(ua) ? 'iPad' : 'Tablet';
      }

      const rawPayload = {
        empleadoId: params.scanId,
        expires: params.expires || Date.now(),
        coordenadas: geoData,
        dispositivo
      };
      const obfuscatedPayload = obfuscateWithKey(params.token, rawPayload);

      // 2. Llamar a la API del servidor para validar de forma segura
      const res = await fetch('/api/nomina/verify-attendance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: params.token,
          payload: obfuscatedPayload
        })
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        setFichajeError(data.error || 'Error al procesar asistencia');
        setIsProcessingQR(false);
        return;
      }

      const { tipoRegistro, emp } = data;

      // Limpiar parámetros de escaneo tras registro exitoso
      setScanParams(null);
      if (typeof window !== 'undefined') {
        try {
          localStorage.removeItem('temp_scan_params');
        } catch (e) {}
      }

      // 3. Determinar comportamiento según el rol (Mesero/Cocina loguea, Soporte solo ficha)
      const rolLower = (emp.rol || '').toLowerCase();
      const esMeseroOKitchen = rolLower.includes('mesero') ||
                               rolLower.includes('cocina') ||
                               rolLower.includes('bartender') ||
                               rolLower.includes('barman') ||
                               rolLower.includes('cocinero');

      if (esMeseroOKitchen) {
        // Loguear al empleado en el dispositivo escaneador
        await loginWithEmpleadoId(emp.id);
        showToast(`Sesión iniciada como ${emp.nombre} ✓`, 'success');

        // Redireccionar de inmediato a su área de trabajo
        if (rolLower.includes('mesero')) {
          window.location.href = '/mesero';
        } else {
          window.location.href = '/cocina';
        }
      } else {
        // Personal de soporte: no inician sesión. Mostrar pantalla visual de éxito
        setFichajeSoporteExitoso({
          nombre: `${emp.nombre} ${emp.apellido || ''}`.trim(),
          rol: emp.rol || 'Soporte',
          tipo: tipoRegistro
        });
        setIsProcessingQR(false);
        showToast(`Asistencia de ${emp.nombre} registrada ✅`, 'success');
      }
    } catch (err) {
      console.error(err);
      setFichajeError('Error al registrar asistencia con QR: ' + err.message);
      setIsProcessingQR(false);
    }
  };

  const checkAsistenciaAndDecide = async (params) => {
    try {
      const scanId = params.scanId;
      const empDoc = await getDoc(doc(db, 'nomina_empleados', scanId));
      
      if (empDoc.exists()) {
        const empData = empDoc.data();
        const fechaHoy = getBusinessDate();
        
        // Buscar logs de asistencia de hoy para este empleado
        const q = query(
          collection(db, 'nomina_asistencia_log'),
          where('empleadoId', '==', scanId),
          where('fecha', '==', fechaHoy)
        );
        const snap = await getDocs(q);
        const logs = snap.docs.map(d => d.data());
        const statusLogs = logs.filter(l => l.tipo === 'entrada' || l.tipo === 'salida');

        // Ordenar desc por fecha
        statusLogs.sort((a, b) => {
          const tA = a.createdAt?.toDate ? a.createdAt.toDate().getTime() : (a.createdAt || 0);
          const tB = b.createdAt?.toDate ? b.createdAt.toDate().getTime() : (b.createdAt || 0);
          return tB - tA;
        });

        const isCurrentlyCheckedIn = statusLogs.length > 0 && statusLogs[0].tipo === 'entrada';

        if (isCurrentlyCheckedIn) {
          // Mostrar pantalla de decisión
          setQrDecisionEmployee({ id: scanId, ...empData, params });
        } else {
          // Si no está de turno o es su entrada inicial, registrar normal
          procesarLoginQR(params);
        }
      } else {
        procesarLoginQR(params);
      }
    } catch (err) {
      console.error("Error al verificar asistencia previa:", err);
      procesarLoginQR(params); // Fallback
    }
  };

  // Escuchar si se abre la app escaneando un código QR con ?scanId=xxx (Para iniciar sesión en el dispositivo del empleado)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const urlParams = new URLSearchParams(window.location.search);
    const scanId = urlParams.get('scanId');
    const token = urlParams.get('token');
    const expires = urlParams.get('expires');
    
    if (!scanId || processedRef.current) {
      return;
    }
    processedRef.current = true;

    const params = { scanId, token, expires };
    setScanParams(params);
    try {
      localStorage.setItem('temp_scan_params', JSON.stringify(params));
    } catch (e) {
      console.error('Error saving scan params to localStorage:', e);
    }

    // Limpiar el parámetro de la URL inmediatamente para evitar ejecuciones repetidas al recargar
    const newUrl = window.location.pathname;
    window.history.replaceState({}, document.title, newUrl);

    checkAsistenciaAndDecide(params);
  }, [loginWithEmpleadoId, logout]);

  // 1. Escuchar capturas de venta del mesero
  useEffect(() => {
    if (!user) return;
    const q = query(
      collection(db, 'mesa_pedidos'),
      where('origen', '==', 'mesero_captura')
    );
    const unsub = onSnapshot(q, snap => {
      if (snap.empty) return;
      const items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      items.sort((a, b) => {
        const tA = a.createdAt?.toDate ? a.createdAt.toDate().getTime() : (a.createdAt || 0);
        const tB = b.createdAt?.toDate ? b.createdAt.toDate().getTime() : (b.createdAt || 0);
        return tB - tA;
      });
      const dData = items[0];
      const creado = dData.createdAt?.toDate ? dData.createdAt.toDate().getTime() : Date.now();
      
      // Si fue creado en los últimos 10 segundos, disparar el popup de 3 segundos
      if (Date.now() - creado < 10000) {
        setCapturaAlert({ mesaId: dData.mesaId, total: dData.total });
        const timer = setTimeout(() => {
          setCapturaAlert(null);
        }, 3000);
        return () => clearTimeout(timer);
      }
    });
    return unsub;
  }, [user]);

  // 2. Escuchar asistencias pendientes para alerta emergente admin
  useEffect(() => {
    if (!user) return;
    const q = query(
      collection(db, 'mesa_pedidos'),
      where('tipo', 'in', ['asistencia', 'cuenta', 'pedido']),
      where('estado', 'in', ['pendiente', 'listo', 'en_camino', 'entregado'])
    );
    const unsub = onSnapshot(q, snap => {
      const items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      // Filtrar sólo las que no han sido atendidas por el administrador
      const filtered = items.filter(alerta => !alerta.atendidoAdmin);
      setAlertasAsistencia(filtered);
    });
    return unsub;
  }, [user]);

  // 3. Alarma sonora sutil para el administrador
  useEffect(() => {
    if (!user || !sonidoAdmin || alertasAsistencia.length === 0) return;
    
    const sonarChime = () => {
      try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain); gain.connect(ctx.destination);
        osc.frequency.value = 523.25; // C5
        gain.gain.value = 0.15;
        osc.start(); osc.stop(ctx.currentTime + 0.15);
        
        setTimeout(() => {
          const osc2 = ctx.createOscillator();
          const gain2 = ctx.createGain();
          osc2.connect(gain2); gain2.connect(ctx.destination);
          osc2.frequency.value = 659.25; // E5
          gain2.gain.value = 0.15;
          osc2.start(); osc2.stop(ctx.currentTime + 0.3);
        }, 150);

        if (typeof navigator !== 'undefined' && navigator.vibrate) {
          navigator.vibrate([150, 100, 150]); // Vibración rítmica
        }
      } catch { /* sin audio */ }
    };

    sonarChime();
    const t = setInterval(sonarChime, 5000);
    return () => clearInterval(t);
  }, [user, sonidoAdmin, alertasAsistencia.length]);

  const marcarAtendidoAdmin = async (id) => {
    try {
      const docRef = doc(db, 'mesa_pedidos', id);
      const snap = await getDoc(docRef);
      if (snap.exists()) {
        const data = snap.data();
        const updateData = {
          atendidoAdmin: true,
          updatedAt: serverTimestamp()
        };
        // Solo archivar si no es un pedido
        if (data.tipo !== 'pedido') {
          updateData.estado = 'atendido';
          updateData.atendidoAt = serverTimestamp();
        }
        await updateDoc(docRef, updateData);
        showToast('Solicitud marcada como atendida ✓', 'success');
      }
    } catch (e) {
      console.error(e);
      showToast('Error al marcar solicitud como atendida', 'danger');
    }
  };

  const imprimirOrdenCompraTFT = (ordenItems) => {
    if (!ordenItems || ordenItems.length === 0) return;

    const printWindow = window.open('', '_blank', 'width=600,height=600');
    if (!printWindow) {
      localStorage.setItem('yoy_popups_blocked_warning', 'true');
      showToast('Permita las ventanas emergentes para imprimir la orden de compra', 'warning');
      return;
    } else {
      localStorage.removeItem('yoy_popups_blocked_warning');
    }

    const dateStr = new Date().toLocaleDateString('es-MX', { year: 'numeric', month: '2-digit', day: '2-digit' });
    const timeStr = new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
    const totalCosto = ordenItems.reduce((s, o) => s + o.costoTotal, 0);
    const totalRetorno = ordenItems.reduce((s, o) => s + o.retornoPotencial, 0);
    const totalGanancia = ordenItems.reduce((s, o) => s + o.gananciaProyectada, 0);

    const itemsHtml = ordenItems.map(o => `
      <tr style="border-bottom: 1px dashed #000;">
        <td style="padding: 4px 0; font-size: 11px;"><b>${o.nombre}</b><br>Pedir: ${o.cantidadAPedir} ${o.unidad || 'pz'} (Stock: ${o.stock})</td>
        <td style="text-align: right; padding: 4px 0; font-size: 11px; vertical-align: bottom;">$${o.costoTotal}</td>
      </tr>
    `).join('');

    printWindow.document.write(`
      <html>
        <head>
          <title>Orden de Compra IA</title>
          <style>
            @page {
              size: 80mm auto;
              margin: 0;
            }
            body {
              font-family: 'Courier New', Courier, monospace;
              width: 72mm;
              margin: 0;
              padding: 10px;
              color: #000;
              background: #fff;
            }
            h3, p {
              margin: 4px 0;
              text-align: center;
            }
            .divider {
              border-top: 1px dashed #000;
              margin: 8px 0;
            }
            .totals table {
              width: 100%;
            }
            .totals td {
              font-size: 11px;
              padding: 2px 0;
            }
          </style>
        </head>
        <body>
          <h3>YOY IA BILLAR</h3>
          <p style="font-size: 10px; font-weight: bold;">ORDEN DE COMPRA SUGERIDA IA</p>
          <div class="divider"></div>
          <p style="font-size: 9px; text-align: left;">Fecha: ${dateStr} - Hora: ${timeStr}</p>
          <p style="font-size: 9px; text-align: left;">Origen: Generacion Automatica IA</p>
          <div class="divider"></div>
          
          <table style="width: 100%; border-collapse: collapse;">
            <thead>
              <tr style="border-bottom: 1px solid #000;">
                <th style="text-align: left; font-size: 10px; padding-bottom: 4px;">Producto</th>
                <th style="text-align: right; font-size: 10px; padding-bottom: 4px;">Costo</th>
              </tr>
            </thead>
            <tbody>
              ${itemsHtml}
            </tbody>
          </table>
          
          <div class="divider"></div>
          
          <div class="totals">
            <table>
              <tr>
                <td><b>COSTO ADQUISICION:</b></td>
                <td style="text-align: right;"><b>$${totalCosto} MXN</b></td>
              </tr>
              <tr>
                <td>RETORNO PROYECTADO:</td>
                <td style="text-align: right;">$${totalRetorno} MXN</td>
              </tr>
              <tr>
                <td>GANANCIA ESTIMADA:</td>
                <td style="text-align: right;">$${totalGanancia} MXN</td>
              </tr>
            </table>
          </div>
          
          <div class="divider"></div>
          <p style="font-size: 8px; text-align: center; margin-top: 15px;">
            Yoy IA Billar - Alfonso Iturbide<br>
            * TICKET DE REORDEN AUTOMATICO *
          </p>
          <br><br>
          <script>
            window.onload = function() {
              window.print();
              setTimeout(function() { window.close(); }, 500);
            };
          </script>
        </body>
      </html>
    `);
    printWindow.document.close();
  };

  // Autocheck y reorden diario automatico al iniciar sesion
  useEffect(() => {
    if (!user) return;

    // Solo permitir auto-impresion a roles autorizados que operan la consola y ticketera termica
    const rolesAutorizados = ['admin', 'cajero', 'gerente'];
    if (!rolesAutorizados.includes(user.role)) return;

    const hoy = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD
    const lastAutoPrint = localStorage.getItem('yoy_last_auto_print_purchase_order');

    if (lastAutoPrint !== hoy) {
      const docRef = doc(db, 'config', 'inventario');
      getDoc(docRef).then(snap => {
        if (snap.exists()) {
          const productos = snap.data().productos || [];
          const itemsReorden = [];
          
          productos.forEach(p => {
            if (p.stock <= p.stockMin && p.activoIA !== false) {
              const cantidadPedir = p.stockOptimo - p.stock;
              if (cantidadPedir > 0) {
                itemsReorden.push({
                  id: p.id,
                  nombre: p.nombre,
                  stock: p.stock,
                  min: p.stockMin,
                  optimo: p.stockOptimo,
                  cantidadAPedir: cantidadPedir,
                  costoUnitario: p.precioCosto,
                  costoTotal: cantidadPedir * p.precioCosto,
                  retornoPotencial: cantidadPedir * p.precioVenta,
                  gananciaProyectada: (cantidadPedir * p.precioVenta) - (cantidadPedir * p.precioCosto),
                  unidad: p.unidad || 'pz'
                });
              }
            }
          });

          if (itemsReorden.length > 0) {
            const totalCosto = itemsReorden.reduce((s, o) => s + o.costoTotal, 0);
            const totalRetorno = itemsReorden.reduce((s, o) => s + o.retornoPotencial, 0);
            const totalGanancia = itemsReorden.reduce((s, o) => s + o.gananciaProyectada, 0);

            const ultimaOrden = {
              fecha: hoy,
              items: itemsReorden,
              totalCosto,
              totalRetorno,
              totalGanancia,
              impresoAt: new Date().toISOString()
            };

            updateDoc(docRef, { ultimaOrdenDiaria: ultimaOrden })
              .then(() => {
                localStorage.setItem('yoy_last_auto_print_purchase_order', hoy);
                setTimeout(() => {
                  imprimirOrdenCompraTFT(itemsReorden);
                  showToast('Impresion de Orden de Compra IA diaria enviada ✓', 'success');
                }, 3000);
              })
              .catch(err => {
                console.error("Error al guardar ultimaOrdenDiaria en Firestore:", err);
                // Fallback: marcar localmente de todas formas para no ciclar
                localStorage.setItem('yoy_last_auto_print_purchase_order', hoy);
                setTimeout(() => {
                  imprimirOrdenCompraTFT(itemsReorden);
                }, 3000);
              });
          } else {
            // Guardar orden vacia en Firestore indicando que hoy se reviso pero no hubo faltantes
            updateDoc(docRef, { 
              ultimaOrdenDiaria: {
                fecha: hoy,
                items: [],
                totalCosto: 0,
                totalRetorno: 0,
                totalGanancia: 0,
                impresoAt: new Date().toISOString()
              }
            }).finally(() => {
              localStorage.setItem('yoy_last_auto_print_purchase_order', hoy);
            });
          }
        }
      }).catch(err => {
        console.warn("Auto-check de compra diario fallido:", err);
      });
    }
  }, [user]);


  if (fichajeSoporteExitoso) {
    return (
      <div style={{
        minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'var(--bg-base)', padding: 24
      }}>
        <div style={{
          background: 'var(--bg-elevated)', border: '2px solid var(--bronze-light)',
          borderRadius: 20, padding: 40, maxWidth: 450, width: '100%', textAlign: 'center',
          boxShadow: '0 10px 40px rgba(0,0,0,0.5), var(--shadow-bronze)',
          position: 'relative', overflow: 'hidden'
        }}>
          <div style={{ fontSize: 64, marginBottom: 20 }}>
            {fichajeSoporteExitoso.tipo === 'entrada' ? '🌅' : '🌙'}
          </div>
          <h2 style={{ fontSize: 22, fontWeight: 900, color: '#fff', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            {fichajeSoporteExitoso.tipo === 'entrada' ? 'Asistencia aplicada correctamente' : 'Salida registrada correctamente'}
          </h2>
          <p style={{ fontSize: 16, color: 'var(--bronze-light)', fontWeight: 700, marginBottom: 4 }}>
            {fichajeSoporteExitoso.nombre}
          </p>
          <p style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 24 }}>
            {fichajeSoporteExitoso.rol}
          </p>
          
          <div style={{
            background: 'var(--bg-card)', border: '1px solid var(--border)',
            borderRadius: 12, padding: '16px 20px', marginBottom: 24, fontSize: 13,
            color: 'var(--text-secondary)', lineHeight: 1.6
          }}>
            {fichajeSoporteExitoso.tipo === 'entrada' 
              ? '¡Tu pase de lista de entrada ha sido registrado exitosamente!' 
              : '¡Tu registro de salida ha sido guardado exitosamente!'}
          </div>

          <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 24 }}>
            Ya puedes cerrar esta pestaña del navegador.
          </p>

          <button
            onClick={() => {
              if (typeof window !== 'undefined') {
                window.close();
              }
            }}
            style={{
              background: 'linear-gradient(135deg, var(--bronze), var(--bronze-light))',
              color: '#fff', border: 'none', borderRadius: 12, padding: '12px 32px',
              fontWeight: 800, fontSize: 13, cursor: 'pointer', width: '100%',
              textTransform: 'uppercase', letterSpacing: '0.05em', transition: 'transform 0.15s'
            }}
            onMouseEnter={e => { e.currentTarget.style.transform = 'scale(1.02)'; }}
            onMouseLeave={e => { e.currentTarget.style.transform = 'none'; }}
          >
            Cerrar Ventana
          </button>
        </div>
      </div>
    );
  }

  if (fichajeError) {
    return (
      <div style={{
        minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'var(--bg-base)', padding: 24
      }}>
        <div style={{
          background: 'var(--bg-elevated)', border: '2px solid var(--danger)',
          borderRadius: 20, padding: 40, maxWidth: 450, width: '100%', textAlign: 'center',
          boxShadow: '0 10px 40px rgba(0,0,0,0.5), var(--shadow-danger)',
          position: 'relative', overflow: 'hidden'
        }}>
          <div style={{ fontSize: 64, marginBottom: 20 }}>❌</div>
          <h2 style={{ fontSize: 22, fontWeight: 900, color: '#fff', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Fallo de Asistencia
          </h2>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 24, lineHeight: 1.6 }}>
            {fichajeError}
          </p>
          
          <p style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 24 }}>
            Puedes intentar obtener tu ubicación nuevamente o cerrar esta pestaña.
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <button
              onClick={() => procesarLoginQR(scanParams, true)}
              style={{
                background: 'linear-gradient(135deg, var(--bronze), var(--bronze-light))',
                color: '#fff', border: 'none', borderRadius: 12, padding: '12px 32px',
                fontWeight: 800, fontSize: 13, cursor: 'pointer', width: '100%',
                textTransform: 'uppercase', letterSpacing: '0.05em', transition: 'transform 0.15s'
              }}
              onMouseEnter={e => { e.currentTarget.style.transform = 'scale(1.02)'; }}
              onMouseLeave={e => { e.currentTarget.style.transform = 'none'; }}
            >
              🔄 Reintentar Geolocalización
            </button>

            <button
              onClick={() => {
                setScanParams(null);
                if (typeof window !== 'undefined') {
                  try {
                    localStorage.removeItem('temp_scan_params');
                  } catch (e) {}
                  window.close();
                }
              }}
              style={{
                background: 'var(--bg-elevated)',
                border: '1px solid var(--border)',
                borderRadius: 12, padding: '12px 32px',
                color: 'var(--text-primary)',
                fontWeight: 800, fontSize: 13, cursor: 'pointer', width: '100%',
                textTransform: 'uppercase', letterSpacing: '0.05em', transition: 'transform 0.15s'
              }}
              onMouseEnter={e => { e.currentTarget.style.transform = 'scale(1.02)'; }}
              onMouseLeave={e => { e.currentTarget.style.transform = 'none'; }}
            >
              Cerrar Ventana
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (loading || !minLoadingDone || isProcessingQR) {
    return (
      <div style={{ display:'flex', alignItems:'center', justifyContent:'center', minHeight:'100vh', background:'var(--bg-base)' }}>
        <div style={{ textAlign:'center', padding: '24px' }}>
          {!imageError ? (
            <img 
              src="/logo-largo.png" 
              alt="YoY IA Billar By Alfonso Iturbide" 
              fetchpriority="high"
              loading="eager"
              onError={() => setImageError(true)}
              className="animate-heartbeat"
              style={{ 
                width: 260, 
                height: 'auto', 
                objectFit: 'contain',
                margin: '0 auto 24px',
                display: 'block'
               }} 
            />
          ) : (
            <div className="animate-heartbeat" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', margin: '0 auto 24px' }}>
              <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="var(--bronze-light)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ filter: 'drop-shadow(0 0 8px var(--bronze-light))' }}>
                <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" fill="var(--bronze-subtle)" />
              </svg>
              <span style={{ color: 'var(--bronze-light)', fontSize: 14, fontWeight: 700, marginTop: 8, letterSpacing: '0.1em' }}>YoY IA Billar</span>
            </div>
          )}
          <p style={{ color:'var(--text-secondary)', fontSize: 10, letterSpacing:'0.2em', textTransform:'uppercase', fontWeight: 600 }}>
            {isProcessingQR ? 'Procesando código de acceso...' : 'Iniciando sistema...'}
          </p>
        </div>
        
        <style>{`
          @keyframes heartbeat {
            0% { transform: scale(1); }
            14% { transform: scale(1.12); }
            28% { transform: scale(1); }
            42% { transform: scale(1.2); }
            70% { transform: scale(1); }
          }
          .animate-heartbeat {
            animation: heartbeat 2.4s infinite ease-in-out;
            will-change: transform;
            filter: drop-shadow(0 0 15px rgba(205,127,50,0.25));
          }
        `}</style>
      </div>
    );
  }

  if (!user) return <LoginScreen showToast={showToast} />;

  const panels = {
    dashboard: (
      <PanelErrorBoundary name="Dashboard" user={user}>
        <DashboardPanel showToast={showToast} onNavigate={setActivePanel} />
      </PanelErrorBoundary>
    ),
    mesas: (
      <PanelErrorBoundary name="Mesas" user={user}>
        <MesasPanel showToast={showToast} />
      </PanelErrorBoundary>
    ),
    caja: (
      <PanelErrorBoundary name="Caja" user={user}>
        <CajaPanel showToast={showToast} />
      </PanelErrorBoundary>
    ),
    bar: (
      <PanelErrorBoundary name="Bar / Cocina" user={user}>
        <BarPanel showToast={showToast} />
      </PanelErrorBoundary>
    ),
    clientes: (
      <PanelErrorBoundary name="Clientes" user={user}>
        <ClientesPanel showToast={showToast} />
      </PanelErrorBoundary>
    ),
    torneos: (
      <PanelErrorBoundary name="Torneos" user={user}>
        <TorneosPanel showToast={showToast} />
      </PanelErrorBoundary>
    ),
    nomina: (
      <PanelErrorBoundary name="Nómina" user={user}>
        <NominaPanel showToast={showToast} />
      </PanelErrorBoundary>
    ),
    reportes: (
      <PanelErrorBoundary name="Reportes" user={user}>
        <CajaPanel showToast={showToast} />
      </PanelErrorBoundary>
    ),
    config: (
      <PanelErrorBoundary name="Configuración" user={user}>
        <ConfigPanel showToast={showToast} />
      </PanelErrorBoundary>
    ),
  };

  if (isSuspended) {
    return (
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        background: 'var(--bg-base)',
        color: 'var(--text-primary)',
        fontFamily: 'var(--font-main)',
        padding: '20px',
        textAlign: 'center',
        zIndex: 999999
      }}>
        <div style={{
          maxWidth: 480,
          background: 'var(--bg-card)',
          border: '1px solid var(--border-bronze)',
          borderRadius: 24,
          boxShadow: '0 25px 60px rgba(0,0,0,0.8), 0 0 30px rgba(205,127,50,0.15)',
          padding: 40,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 20
        }}>
          <div style={{
            width: 64, height: 64, borderRadius: '50%',
            background: 'rgba(239,68,68,0.1)',
            border: '1px solid rgba(239,68,68,0.2)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 32, color: 'var(--danger)',
            flexShrink: 0
          }}>
            <i className="ri-error-warning-fill" />
          </div>

          <h2 style={{ fontSize: 22, fontWeight: 800, fontFamily: 'var(--font-display)', letterSpacing: '0.02em', margin: 0 }}>
            Servicio Suspendido
          </h2>

          <p style={{ fontSize: 13.5, color: 'var(--text-secondary)', lineHeight: 1.5, margin: 0 }}>
            La suscripción mensual/anual de esta sala de billar se encuentra vencida o no hemos podido procesar el pago. 
            Por favor, ponte en contacto con administración o realiza el pago correspondiente para reactivar el servicio.
          </p>

          <div style={{ width: '100%', borderTop: '1px solid var(--border)', paddingTop: 20, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <button
              onClick={() => {
                showToast('Redirigiendo a pasarela de pagos segura...', 'info');
                window.open('https://stripe.com', '_blank');
              }}
              style={{
                width: '100%',
                background: 'linear-gradient(135deg, var(--bronze), var(--bronze-light))',
                border: 'none',
                borderRadius: 12,
                color: '#fff',
                padding: '12px 0',
                fontSize: 13.5,
                fontWeight: 700,
                cursor: 'pointer',
                boxShadow: '0 4px 12px rgba(205,127,50,0.3)',
                transition: 'all 0.2s',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6
              }}
            >
              <i className="ri-secure-payment-line" /> Pagar Suscripción
            </button>

            <button
              onClick={logout}
              style={{
                width: '100%',
                background: 'var(--bg-elevated)',
                border: '1px solid var(--border)',
                borderRadius: 12,
                color: 'var(--text-primary)',
                padding: '10px 0',
                fontSize: 12.5,
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'all 0.2s'
              }}
            >
              Cerrar Sesión / Salir
            </button>
          </div>

          <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
            ID del Salón: <code style={{ color: 'var(--bronze-light)' }}>{user?.salonId || 'default_salon'}</code>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="app-wrapper">
      <div className="main-content">
        <Topbar
          user={user}
          activePanel={activePanel}
          showToast={showToast}
          onNavigate={(panel) => {
            setActivePanel(panel);
          }}
        />
        {/* Banner de Contraseña Temporal (MasterAdmin) */}
        {showPasswordChangeReminder && !dismissedSessionReminder && (
          <div style={{
            background: 'linear-gradient(135deg, rgba(239, 68, 68, 0.95), rgba(185, 28, 28, 0.95))',
            borderBottom: '1px solid rgba(220, 38, 38, 0.4)',
            padding: '12px 24px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 16,
            animation: 'slideDownAlert 0.4s ease',
            boxShadow: '0 4px 20px rgba(239, 68, 68, 0.2)'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ fontSize: 20, animation: 'pulseRedAlert 1.5s infinite' }}>⚠️</span>
              <div style={{ textAlign: 'left' }}>
                <span style={{ fontSize: 13, color: '#fff', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Contraseña Temporal Activa
                </span>
                <p style={{ margin: '2px 0 0 0', fontSize: 12, color: 'rgba(255, 255, 255, 0.9)', fontWeight: 500 }}>
                  Estás utilizando la contraseña temporal predeterminada. Por motivos de seguridad, cámbiala lo antes posible.
                </p>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <button
                onClick={() => setActivePanel('config')}
                style={{
                  background: '#fff',
                  color: '#b91c1c',
                  border: 'none',
                  borderRadius: 8,
                  padding: '8px 16px',
                  fontWeight: 700,
                  fontSize: 12,
                  cursor: 'pointer',
                  boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                  transition: 'all 0.2s',
                  whiteSpace: 'nowrap'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = 'scale(1.05)';
                  e.currentTarget.style.boxShadow = '0 6px 16px rgba(0,0,0,0.25)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = 'scale(1)';
                  e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)';
                }}
              >
                🔐 Cambiar Contraseña Ahora
              </button>
              <button
                onClick={() => {
                  sessionStorage.setItem('yoy_dismissed_credentials_reminder', 'true');
                  setDismissedSessionReminder(true);
                }}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'rgba(255, 255, 255, 0.8)',
                  fontSize: 20,
                  cursor: 'pointer',
                  outline: 'none',
                  padding: 6,
                  transition: 'color 0.2s',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
                onMouseEnter={e => e.currentTarget.style.color = '#fff'}
                onMouseLeave={e => e.currentTarget.style.color = 'rgba(255, 255, 255, 0.8)'}
                title="Descartar alerta en esta sesión"
              >
                <i className="ri-close-line" />
              </button>
            </div>
          </div>
        )}

        {/* Banner de Insumos Críticos / Faltantes y Alertas IA */}
        {(cocinaSolicitudes.length > 0 || displayedAlerts.length > 0) && (
          <div style={{
            background: 'linear-gradient(135deg, rgba(20, 20, 25, 0.95), rgba(40, 30, 25, 0.95))',
            borderBottom: '1px solid rgba(205, 127, 50, 0.25)',
            padding: '8px 24px',
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            animation: 'slideDownAlert 0.4s ease',
            maxHeight: '200px',
            overflowY: 'auto',
            boxShadow: '0 4px 20px rgba(0,0,0,0.4)'
          }}>
            {/* Cocina Solicitudes de Surtido URGENTE (Siempre Prioritario) */}
            {cocinaSolicitudes.length > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0', borderBottom: displayedAlerts.length > 0 ? '1px solid rgba(255,255,255,0.05)' : 'none' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, animation: 'pulseRedAlert 1.5s infinite' }}>
                  <i className="ri-broadcast-line" style={{ fontSize: 16, color: 'var(--danger)' }} />
                  <span style={{ fontSize: 12, color: '#fff', fontWeight: 800 }}>
                    ATENCIÓN: Cocina solicita surtir urgente: <strong style={{ color: 'var(--danger)', textDecoration: 'underline' }}>{cocinaSolicitudes.map(s => s.nombre).join(', ')}</strong>
                  </span>
                </div>
                <button
                  className="btn btn-danger btn-xs"
                  onClick={() => setActivePanel('bar')}
                  style={{ padding: '2px 8px', fontSize: 10, borderRadius: 6 }}
                >
                  Surtir Barra/Cocina
                </button>
              </div>
            )}

            {/* Alertas IA Dinámicas */}
            {displayedAlerts.map((alert, idx) => (
              <div key={idx} style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '4px 0',
                borderBottom: idx < displayedAlerts.length - 1 ? '1px solid rgba(255,255,255,0.05)' : 'none'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 14 }}>{alert.icon}</span>
                  <span style={{ fontSize: 12, color: '#fff', fontWeight: 600 }}>
                    {alert.text}
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <button
                    className="btn btn-secondary btn-xs"
                    onClick={() => setActivePanel(alert.panel)}
                    style={{
                      padding: '2px 8px',
                      fontSize: 10,
                      borderRadius: 6,
                      color: '#fff',
                      borderColor: 'var(--border)',
                      background: 'rgba(255,255,255,0.04)',
                      cursor: 'pointer'
                    }}
                  >
                    {alert.btnText}
                  </button>
                  <button
                    onClick={() => handleSnoozeAlert(alert.id)}
                    title="Silenciar por 1 hora"
                    style={{
                      background: 'none',
                      border: 'none',
                      color: 'rgba(255,255,255,0.3)',
                      cursor: 'pointer',
                      padding: '2px 6px',
                      fontSize: 12,
                      display: 'flex',
                      alignItems: 'center',
                      transition: 'color 0.2s'
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.color = '#fff'}
                    onMouseLeave={(e) => e.currentTarget.style.color = 'rgba(255,255,255,0.3)'}
                  >
                    <i className="ri-notification-off-line" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="page-content">
          {user && user.permisos && user.permisos[activePanel] !== true ? (
            <div className="card" style={{ padding: 40, textAlign: 'center', border: '1px solid var(--border-bronze)', maxWidth: 500, margin: '40px auto' }}>
              <i className="ri-shield-keyhole-line" style={{ fontSize: 48, color: 'var(--bronze-light)', marginBottom: 16, display: 'block' }} />
              <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Acceso Restringido</h3>
              <p style={{ color: 'var(--text-secondary)', fontSize: 13 }}>No tienes los permisos requeridos para visualizar este panel. Consulta al administrador.</p>
            </div>
          ) : (
            panels[activePanel] || panels.dashboard
          )}
        </div>
      </div>
      <ToastContainer toasts={toasts} />

      {/* ── STYLE TAG FOR CUSTOM ANIMATIONS ── */}
      <style>{`
        @keyframes shrinkWidth {
          from { width: 100%; }
          to { width: 0%; }
        }
        @keyframes slideDownAlert {
          from { transform: translate(-50%, -40px); opacity: 0; }
          to { transform: translate(-50%, 0); opacity: 1; }
        }
        @keyframes scaleUpAlert {
          from { transform: scale(0.95); opacity: 0; }
          to { transform: scale(1); opacity: 1; }
        }
        @keyframes pulseRedAlert {
          0% { opacity: 0.85; transform: scale(1); }
          50% { opacity: 1; transform: scale(1.01); filter: brightness(1.25); }
          100% { opacity: 0.85; transform: scale(1); }
        }
        @keyframes breathingGoldenGlow {
          0% { box-shadow: 0 0 4px rgba(227, 168, 105, 0.3); border-color: rgba(227, 168, 105, 0.5); }
          50% { box-shadow: 0 0 12px rgba(227, 168, 105, 0.7); border-color: rgba(227, 168, 105, 1); transform: scale(1.02); }
          100% { box-shadow: 0 0 4px rgba(227, 168, 105, 0.3); border-color: rgba(227, 168, 105, 0.5); }
        }
      `}</style>

      {/* ── ALERTA TEMPORAL 3 SEG: CAPTURA DE VENTA POR MESERO ── */}
      {capturaAlert && (
        <div style={{
          position: 'fixed', top: 24, left: '50%', transform: 'translateX(-50%)',
          background: 'linear-gradient(135deg, #1e1b18, #0f0d0c)',
          border: '2px solid var(--bronze-light)',
          boxShadow: '0 10px 30px rgba(205,127,50,0.3), var(--shadow-bronze)',
          borderRadius: 16, padding: '16px 24px', zIndex: 2000,
          display: 'flex', alignItems: 'center', gap: 14,
          animation: 'slideDownAlert 0.35s cubic-bezier(0.175, 0.885, 0.32, 1.275)'
        }}>
          <div style={{ fontSize: 24, background: 'var(--bronze-subtle)', width: 44, height: 44, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--bronze-light)' }}>
            🛍️
          </div>
          <div style={{ textAlign: 'left' }}>
            <div style={{ fontSize: 11, color: 'var(--bronze-light)', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.12em' }}>Venta Capturada Directa</div>
            <div style={{ fontSize: 15, fontWeight: 800, color: '#fff', marginTop: 2 }}>Mesa {capturaAlert.mesaId} · <span style={{ color: 'var(--success)' }}>${capturaAlert.total}</span></div>
          </div>
          
          {/* Barra de progreso de 3 segundos */}
          <div style={{
            position: 'absolute', bottom: 0, left: 0, height: 3, background: 'var(--bronze-light)',
            width: '100%', animation: 'shrinkWidth 3s linear forwards', borderBottomLeftRadius: 16, borderBottomRightRadius: 16
          }} />
        </div>
      )}

      {/* ── VENTANA EMERGENTE ADMIN: ALERTA DE SERVICIO PENDIENTE ── */}
      {alertasAsistencia.length > 0 && (
        <div className="modal-overlay" style={{ zIndex: 1999, background: 'rgba(13,13,15,0.8)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'fixed', top: 0, left: 0, right: 0, bottom: 0 }}>
          <div className="modal" style={{ maxWidth: 440, border: '2px solid var(--danger)', boxShadow: '0 0 30px rgba(239,68,68,0.25)', animation: 'scaleUpAlert 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)' }}>
            <div className="modal-header" style={{ borderBottom: '1px solid rgba(239,68,68,0.15)', paddingBottom: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span className="modal-title" style={{ color: 'var(--danger)', display: 'flex', alignItems: 'center', gap: 8, fontSize: 16, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                🚨 Alerta de Servicio (Cliente)
              </span>
              <span style={{ fontSize: 10, background: 'rgba(239,68,68,0.12)', color: 'var(--danger)', padding: '1px 6px', borderRadius: 999, fontWeight: 800 }}>
                {alertasAsistencia.length} PENDIENTE
              </span>
            </div>
            <div className="modal-body" style={{ maxHeight: 300, overflowY: 'auto', padding: '12px 0' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {alertasAsistencia.map((alerta) => (
                  <div key={alerta.id} style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: 12, padding: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ fontSize: 26 }}>{alerta.icono || '🙋'}</span>
                      <div style={{ textAlign: 'left' }}>
                        <div style={{ fontSize: 14, fontWeight: 800, color: '#fff' }}>Mesa {alerta.mesaId}</div>
                        <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
                          {alerta.etiqueta} {alerta.tipo === 'cuenta' && alerta.totalAcumulado ? `($${alerta.totalAcumulado} MXN)` : alerta.tipo === 'pedido' && alerta.total ? `($${alerta.total} MXN)` : ''}
                        </div>
                        <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}>{alerta.cliente}</div>
                      </div>
                    </div>
                    <button
                      onClick={() => marcarAtendidoAdmin(alerta.id)}
                      style={{
                        background: 'rgba(34,197,94,0.12)',
                        border: '1px solid rgba(34,197,94,0.3)',
                        color: 'var(--success)',
                        padding: '6px 12px',
                        borderRadius: 8,
                        fontWeight: 700,
                        fontSize: 12,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4,
                        transition: 'all 0.15s',
                        flexShrink: 0
                      }}
                      onMouseEnter={e => { e.currentTarget.style.background = 'rgba(34,197,94,0.2)'; }}
                      onMouseLeave={e => { e.currentTarget.style.background = 'rgba(34,197,94,0.12)'; }}
                    >
                      <i className="ri-check-line" /> Atendido
                    </button>
                  </div>
                ))}
              </div>
            </div>
            <div className="modal-footer" style={{ borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <button
                onClick={() => setSonidoAdmin(!sonidoAdmin)}
                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 11, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}
              >
                <i className={sonidoAdmin ? 'ri-volume-up-line' : 'ri-volume-mute-line'} />
                {sonidoAdmin ? 'Chime ON' : 'Silencio'}
              </button>
              <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>YoY IA Billar By Alfonso Iturbide</span>
            </div>
          </div>
        </div>
      )}

      {/* Modal de decisión al escanear QR con sesión activa */}
      {qrDecisionEmployee && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            width: '100vw',
            height: '100vh',
            background: 'rgba(13, 13, 15, 0.96)',
            backdropFilter: 'blur(8px)',
            zIndex: 99999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 24
          }}
        >
          <div
            style={{
              background: 'var(--bg-card)',
              border: '1px solid var(--border-bronze)',
              borderRadius: 16,
              padding: 28,
              maxWidth: 400,
              width: '100%',
              textAlign: 'center',
              boxShadow: '0 20px 40px rgba(0,0,0,0.6)'
            }}
          >
            <i className="ri-shield-user-line" style={{ fontSize: 48, color: 'var(--bronze-light)', display: 'block', marginBottom: 16 }} />
            <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 800, textTransform: 'uppercase', color: 'var(--text)', marginBottom: 8 }}>
              Turno Activo Detectado
            </h2>
            <p style={{ fontSize: 14, color: 'var(--text-muted)', marginBottom: 24, lineHeight: 1.5 }}>
              Hola <strong>{qrDecisionEmployee.nombre}</strong>. Ya tienes un turno registrado como <strong>PRESENTE</strong> hoy. ¿Qué deseas hacer?
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {/* Opción 1: Solo recuperar pantalla */}
              <button
                onClick={async () => {
                  try {
                    await loginWithEmpleadoId(qrDecisionEmployee.id);
                    showToast('Pantalla recuperada con éxito ✓', 'success');
                    
                    // Redireccionar según el rol
                    const rolLower = (qrDecisionEmployee.rol || '').toLowerCase();
                    if (rolLower.includes('mesero')) {
                      window.location.href = '/mesero';
                    } else {
                      window.location.href = '/cocina';
                    }
                  } catch (err) {
                    console.error("Error al recuperar pantalla:", err);
                    alert("Error: " + err.message);
                  } finally {
                    setQrDecisionEmployee(null);
                  }
                }}
                style={{
                  background: 'linear-gradient(135deg, var(--bronze), var(--bronze-light))',
                  color: '#0d0d0f',
                  border: 'none',
                  borderRadius: 10,
                  padding: '14px 20px',
                  fontWeight: 700,
                  fontSize: 14,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                  transition: 'transform 0.2s',
                  boxShadow: '0 4px 12px rgba(205,127,50,0.3)'
                }}
                onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-1px)'; }}
                onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)'; }}
              >
                <i className="ri-external-link-line" />
                Recuperar mi Pantalla
              </button>

              {/* Opción 2: Registrar Salida (Pase de lista normal) */}
              <button
                onClick={() => {
                  const params = qrDecisionEmployee.params;
                  setQrDecisionEmployee(null);
                  procesarLoginQR(params);
                }}
                style={{
                  background: 'rgba(239, 68, 68, 0.1)',
                  color: '#ef4444',
                  border: '1px solid rgba(239, 68, 68, 0.3)',
                  borderRadius: 10,
                  padding: '12px 20px',
                  fontWeight: 600,
                  fontSize: 13,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                  transition: 'background 0.2s'
                }}
                onMouseEnter={e => { e.currentTarget.style.background = 'rgba(239, 68, 68, 0.18)'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'rgba(239, 68, 68, 0.1)'; }}
              >
                <i className="ri-logout-box-line" />
                Registrar Salida de Turno
              </button>

              {/* Opción Cancelar / Cerrar */}
              <button
                onClick={() => setQrDecisionEmployee(null)}
                style={{
                  background: 'transparent',
                  color: 'var(--text-muted)',
                  border: 'none',
                  fontSize: 12,
                  marginTop: 8,
                  cursor: 'pointer'
                }}
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Advertencia de Credenciales Predeterminadas (MasterAdmin) */}
      {showCredentialsModal && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            width: '100vw',
            height: '100vh',
            background: 'rgba(13, 13, 15, 0.94)',
            backdropFilter: 'blur(6px)',
            zIndex: 99999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16
          }}
        >
          <div
            style={{
              position: 'relative',
              background: 'var(--bg-card)',
              border: '2px solid #ef4444',
              borderRadius: 12,
              padding: '20px 22px',
              maxWidth: 320,
              width: '100%',
              textAlign: 'center',
              boxShadow: '0 15px 35px rgba(239, 68, 68, 0.15)',
              animation: 'scaleUpAlert 0.25s cubic-bezier(0.34, 1.56, 0.64, 1)'
            }}
          >
            {/* Botón de Cerrar (X) */}
            <button
              onClick={() => {
                setShowCredentialsModal(false);
                sessionStorage.setItem('yoy_dismissed_credentials_reminder', 'true');
                setDismissedSessionReminder(true);
              }}
              style={{
                position: 'absolute',
                top: 10,
                right: 10,
                background: 'transparent',
                border: 'none',
                color: 'var(--text-muted)',
                fontSize: 18,
                cursor: 'pointer',
                outline: 'none',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: 4,
                transition: 'color 0.15s'
              }}
              onMouseEnter={e => e.currentTarget.style.color = '#ef4444'}
              onMouseLeave={e => e.currentTarget.style.color = 'var(--text-muted)'}
              title="Cerrar y recordar en la próxima sesión"
            >
              <i className="ri-close-line" />
            </button>

            <i className="ri-shield-keyhole-line" style={{ fontSize: 36, color: '#ef4444', display: 'block', marginBottom: 10, animation: 'pulseRedAlert 1.5s infinite' }} />
            <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 900, textTransform: 'uppercase', color: 'var(--text)', marginBottom: 8, letterSpacing: '0.05em' }}>
              ⚠️ Seguridad Crítica
            </h2>
            <p style={{ fontSize: 12, color: 'var(--text)', marginBottom: 12, lineHeight: 1.5, textAlign: 'left' }}>
              Estimado <strong>Administrador Maestro</strong>, estás ingresando con credenciales predeterminadas de fábrica:
            </p>
            <div style={{ background: 'rgba(0,0,0,0.25)', border: '1px solid var(--border)', borderRadius: 8, padding: 10, marginBottom: 14, textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 5 }}>
              {isDefaultPassword && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: 'var(--text-secondary)' }}>
                  <span style={{ color: '#ef4444' }}>❌</span> Contraseña: <code style={{ background: 'var(--bg-elevated)', padding: '1px 5px', borderRadius: 3, color: '#ef4444', fontWeight: 'bold' }}>123456</code>
                </div>
              )}
              {isDefaultPin && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: 'var(--text-secondary)' }}>
                  <span style={{ color: '#ef4444' }}>❌</span> PIN Admin: <code style={{ background: 'var(--bg-elevated)', padding: '1px 5px', borderRadius: 3, color: '#ef4444', fontWeight: 'bold' }}>123456</code>
                </div>
              )}
            </div>
            <p style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 16, lineHeight: 1.4 }}>
              Actualiza estas credenciales en Configuración para proteger tu negocio.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <button
                onClick={() => {
                  setShowCredentialsModal(false);
                  setActivePanel('config');
                }}
                className="btn btn-primary"
                style={{
                  width: '100%',
                  padding: '9px 16px',
                  fontWeight: 800,
                  fontSize: 11,
                  textTransform: 'uppercase',
                  background: 'linear-gradient(135deg, #ef4444, #b91c1c)',
                  border: 'none',
                  color: '#fff',
                  borderRadius: 8,
                  cursor: 'pointer',
                  boxShadow: '0 3px 8px rgba(239,68,68,0.2)'
                }}
              >
                🔐 Ir a Configuración Ahora
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function Home() {
  return (
    <AuthProvider>
      <ErrorBoundary>
        <AppContent />
      </ErrorBoundary>
    </AuthProvider>
  );
}

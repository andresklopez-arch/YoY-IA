'use client';
import { useState, useEffect } from 'react';
import Sidebar from '@/components/Sidebar';
import Topbar from '@/components/Topbar';
import ToastContainer from '@/components/ToastContainer';
import MesasPanel from '@/components/panels/MesasPanel';
import CajaPanel from '@/components/panels/CajaPanel';
import BarPanel from '@/components/panels/BarPanel';
import ClientesPanel from '@/components/panels/ClientesPanel';
import TorneosPanel from '@/components/panels/TorneosPanel';
import ReportesPanel from '@/components/panels/ReportesPanel';
import DashboardPanel from '@/components/panels/DashboardPanel';
import ConfigPanel from '@/components/panels/ConfigPanel';
import NominaPanel from '@/components/panels/NominaPanel';
import LoginScreen from '@/components/LoginScreen';
import { AuthProvider, useAuth } from '@/lib/auth-context';
import { collection, query, where, orderBy, limit, onSnapshot, doc, updateDoc, serverTimestamp, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';

function AppContent() {
  const { user, loading } = useAuth();
  const [minLoadingDone, setMinLoadingDone] = useState(false);
  const [imageError, setImageError] = useState(false);
  const [activePanel, setActivePanel] = useState('mesas');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [toasts, setToasts] = useState([]);

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

  // Redirigir si no tiene permisos para el panel activo
  useEffect(() => {
    if (user && user.permisos) {
      if (user.permisos[activePanel] !== true) {
        const primerPermitido = ['dashboard', 'mesas', 'caja', 'bar', 'clientes', 'torneos', 'nomina', 'reportes', 'config']
          .find(key => user.permisos[key] === true);
        if (primerPermitido) {
          setActivePanel(primerPermitido);
        }
      }
    }
  }, [user, activePanel]);

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
          if (data.atendidoMesero === true || data.estado === 'entregado') {
            updateData.estado = 'atendido';
            updateData.atendidoAt = serverTimestamp();
          }
        }
        await updateDoc(docRef, updateData);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const showToast = (message, type = 'info') => {
    const id = Date.now();
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4000);
  };

  if (loading || !minLoadingDone) {
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
          <p style={{ color:'var(--text-secondary)', fontSize: 10, letterSpacing:'0.2em', textTransform:'uppercase', fontWeight: 600 }}>Iniciando sistema...</p>
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
    dashboard: <DashboardPanel showToast={showToast} onNavigate={setActivePanel} />,
    mesas:     <MesasPanel showToast={showToast} />,
    caja:      <CajaPanel showToast={showToast} />,
    bar:       <BarPanel showToast={showToast} />,
    clientes:  <ClientesPanel showToast={showToast} />,
    torneos:   <TorneosPanel showToast={showToast} />,
    nomina:    <NominaPanel showToast={showToast} />,
    reportes:  <ReportesPanel showToast={showToast} />,
    config:    <ConfigPanel showToast={showToast} />,
  };

  return (
    <div className="app-wrapper">
      {/* Sensor de hover invisible en el borde izquierdo */}
      <div 
        onMouseEnter={() => setSidebarOpen(true)}
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          bottom: 0,
          width: 12,
          zIndex: 1050,
          background: 'transparent',
          cursor: 'pointer'
        }}
      />

      <Sidebar
        activePanel={activePanel}
        onNavigate={(panel) => {
          setActivePanel(panel);
          setSidebarOpen(false);
        }}
        open={sidebarOpen}
        onMouseEnter={() => setSidebarOpen(true)}
        onMouseLeave={() => setSidebarOpen(false)}
        user={user}
      />
      <div className="main-content">
        <Topbar
          user={user}
          activePanel={activePanel}
          onToggleSidebar={() => setSidebarOpen(p => !p)}
          showToast={showToast}
          onNavigate={(panel) => {
            setActivePanel(panel);
            setSidebarOpen(false);
          }}
        />
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
    </div>
  );
}

export default function Home() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}

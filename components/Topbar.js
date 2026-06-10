'use client';
import { useState, useEffect } from 'react';
import { useAuth } from '@/lib/auth-context';
import { useAlertasNomina } from '@/components/panels/NominaPanel';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase';

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

const PANEL_LABELS = {
  dashboard: 'Dashboard',
  mesas:     'Control de Mesas',
  caja:      'Caja y POS',
  bar:       'Inventario Inteligente IA',
  clientes:  'Clientes',
  torneos:   'Torneos y Ligas',
  nomina:    'Nómina & Gastos',
  reportes:  'Reportes',
  config:    'Configuración',
};

export default function Topbar({ user, activePanel, onToggleSidebar, showToast, onNavigate }) {
  const { logout } = useAuth();
  const [time, setTime] = useState(new Date());
  const [showMenu, setShowMenu] = useState(false);
  const alertasNomina = useAlertasNomina();
  const pedidosPendientes = usePedidosPendientes();
  const [locale, setLocale] = useState('es-MX');

  useEffect(() => {
    if (typeof window !== 'undefined' && navigator.language) {
      setLocale(navigator.language);
    }
    const t = setInterval(() => setTime(new Date()), 10000); // Actualiza cada 10 segundos
    return () => clearInterval(t);
  }, []);

  const timeStr = time.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  const dateStr = time.toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short' });

  return (
    <header className="topbar">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button
          onClick={onToggleSidebar}
          style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', fontSize: 20, cursor: 'pointer', padding: 4, borderRadius: 6 }}
        >
          <i className="ri-menu-line" />
        </button>

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
        </div>
      </div>

      {/* Accesos Rápidos en el Centro */}
      <div className="topbar-quick-actions">
        {[
          { label: 'Mesa', icon: 'ri-play-circle-line', color: 'var(--success)', nav: 'mesas' },
          { label: 'Caja', icon: 'ri-money-dollar-circle-line', color: 'var(--bronze-light)', nav: 'caja' },
          { label: 'Inventario', icon: 'ri-archive-line', color: 'var(--blue-light)', nav: 'bar' },
          { label: 'Torneos', icon: 'ri-trophy-line', color: '#ffd700', nav: 'torneos' },
          { label: 'Nómina', icon: 'ri-briefcase-4-line', color: 'var(--bronze-light)', nav: 'nomina', badge: alertasNomina.length },
          { label: 'Mesero', icon: 'ri-customer-service-2-line', color: 'var(--success)', href: '/mesero', badge: pedidosPendientes },
          { label: 'Reportes', icon: 'ri-bar-chart-2-line', color: 'var(--silver)', nav: 'reportes' },
          { label: 'Ajustes', icon: 'ri-settings-4-line', color: 'var(--text-muted)', nav: 'config' },
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
              title={a.label}
            >
              <div style={{ position: 'relative', display: 'inline-flex' }}>
                <i className={a.icon} style={{ fontSize: 16, color: a.color }} />
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
              <span className="topbar-quick-label">{a.label}</span>
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

        {/* Notificaciones */}
        <button
          onClick={() => alertasNomina.length > 0
            ? onNavigate('nomina')
            : showToast('Sin notificaciones nuevas', 'info')}
          style={{ background: alertasNomina.length > 0 ? 'rgba(239,68,68,0.08)' : 'var(--bg-elevated)', border: `1px solid ${alertasNomina.length > 0 ? 'rgba(239,68,68,0.3)' : 'var(--border)'}`, borderRadius: 10, width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: alertasNomina.length > 0 ? 'var(--danger)' : 'var(--text-secondary)', fontSize: 16, position: 'relative', transition: 'all 0.2s' }}
          title={alertasNomina.length > 0 ? `${alertasNomina.length} alertas de ausencias en nómina` : 'Sin notificaciones'}
        >
          <i className={alertasNomina.length > 0 ? 'ri-alarm-warning-line' : 'ri-notification-3-line'} />
          {alertasNomina.length > 0 && (
            <span style={{
              position: 'absolute', top: -4, right: -4,
              background: 'var(--danger)', color: '#fff',
              fontSize: 9, fontWeight: 800, borderRadius: 999,
              minWidth: 16, height: 16, display: 'flex', alignItems: 'center',
              justifyContent: 'center', padding: '0 3px',
              animation: 'pulse 1.5s ease-in-out infinite'
            }}>{alertasNomina.length}</span>
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
    </header>
  );
}

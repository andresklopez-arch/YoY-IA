'use client';
import { useState, useEffect } from 'react';
import { useAuth } from '@/lib/auth-context';

const PANEL_LABELS = {
  dashboard: 'Dashboard',
  mesas:     'Control de Mesas',
  caja:      'Caja y POS',
  bar:       'Inventario Inteligente IA',
  clientes:  'Clientes',
  torneos:   'Torneos y Ligas',
  reportes:  'Reportes',
  config:    'Configuración',
};

export default function Topbar({ user, activePanel, onToggleSidebar, showToast, onNavigate }) {
  const { logout } = useAuth();
  const [time, setTime] = useState(new Date());
  const [showMenu, setShowMenu] = useState(false);

  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const timeStr = time.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const dateStr = time.toLocaleDateString('es-MX', { weekday: 'short', day: 'numeric', month: 'short' });

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
          { label: 'Reportes', icon: 'ri-bar-chart-2-line', color: 'var(--silver)', nav: 'reportes' },
          { label: 'Ajustes', icon: 'ri-settings-4-line', color: 'var(--text-muted)', nav: 'config' },
        ].map((a, i) => (
          <button
            key={i}
            onClick={() => onNavigate(a.nav)}
            className="topbar-quick-btn"
            onMouseEnter={e => {
              e.currentTarget.style.borderColor = a.color;
              e.currentTarget.style.background = `${a.color}11`;
            }}
            onMouseLeave={e => {
              e.currentTarget.style.borderColor = 'var(--border)';
              e.currentTarget.style.background = 'var(--bg-elevated)';
            }}
            title={a.label}
          >
            <i className={a.icon} style={{ fontSize: 16, color: a.color }} />
            <span className="topbar-quick-label">{a.label}</span>
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
        {/* Reloj */}
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 700, letterSpacing: '0.1em', color: 'var(--text-primary)', lineHeight: 1 }}>
            {timeStr}
          </div>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em', marginTop: 2 }}>
            {dateStr}
          </div>
        </div>

        {/* Notificaciones */}
        <button
          onClick={() => showToast('Sin notificaciones nuevas', 'info')}
          style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 10, width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'var(--text-secondary)', fontSize: 16, position: 'relative' }}
        >
          <i className="ri-notification-3-line" />
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

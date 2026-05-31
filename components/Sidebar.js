'use client';
import { useAuth } from '@/lib/auth-context';

const NAV_ITEMS = [
  { id: 'dashboard', label: 'Dashboard', icon: 'ri-dashboard-3-line',   roles: ['admin','gerente','cajero'] },
  { id: 'mesas',     label: 'Mesas',     icon: 'ri-billiards-line',      roles: ['admin','gerente','cajero','mesero'],  badge: null },
  { id: 'caja',      label: 'Caja / POS',icon: 'ri-money-dollar-box-line', roles: ['admin','gerente','cajero'] },
  { id: 'bar',       label: 'Bar e Inventario', icon: 'ri-cup-line',    roles: ['admin','gerente','mesero'] },
  { id: 'clientes',  label: 'Clientes',  icon: 'ri-group-line',          roles: ['admin','gerente','cajero'] },
  { id: 'torneos',   label: 'Torneos',   icon: 'ri-trophy-line',         roles: ['admin','gerente','arbitro'] },
  { id: 'reportes',  label: 'Reportes',  icon: 'ri-bar-chart-2-line',    roles: ['admin','gerente'] },
  { id: 'config',    label: 'Configuración', icon: 'ri-settings-4-line', roles: ['admin'] },
];

const ROLE_COLORS = {
  admin:   'var(--bronze-light)',
  gerente: 'var(--silver)',
  cajero:  'var(--success)',
  mesero:  'var(--blue-light)',
  arbitro: 'var(--warning)',
};

const ROLE_LABELS = {
  admin:   'Administrador',
  gerente: 'Gerente de Turno',
  cajero:  'Cajero',
  mesero:  'Mesero',
  arbitro: 'Árbitro',
};

export default function Sidebar({ activePanel, onNavigate, collapsed, onToggle, user }) {
  const { logout } = useAuth();
  const visibleItems = NAV_ITEMS.filter(item => item.roles.includes(user?.role || 'cajero'));

  return (
    <aside className={`sidebar ${collapsed ? 'collapsed' : ''}`}>
      {/* Logo con Logo Corto */}
      <div className="sidebar-logo" style={{ gap: collapsed ? 0 : 10, padding: collapsed ? '14px 0' : '16px 16px', display: 'flex', alignItems: 'center', justifyContent: collapsed ? 'center' : 'flex-start' }}>
        <img 
          src="/logo-corto.png" 
          alt="YoY IA" 
          fetchpriority="high"
          loading="eager"
          style={{
            width: collapsed ? 32 : 36, 
            height: collapsed ? 32 : 36, 
            objectFit: 'contain',
            borderRadius: collapsed ? 8 : 10,
            boxShadow: '0 0 12px rgba(205,127,50,0.18)',
            transition: 'all 0.2s ease',
            flexShrink: 0
          }} 
        />
        {!collapsed && (
          <div className="sidebar-logo-text">
            <span className="sidebar-logo-name" style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--text-primary)' }}>YoY IA BILLAR</span>
            <span className="sidebar-logo-sub" style={{ fontSize: 9, color: 'var(--text-muted)' }}>Gestión Inteligente</span>
          </div>
        )}
      </div>

      {/* Navegación */}
      <nav className="sidebar-nav">
        <div className="nav-section-label">Principal</div>

        {visibleItems.map(item => (
          <button
            key={item.id}
            className={`nav-item ${activePanel === item.id ? 'active' : ''}`}
            onClick={() => onNavigate(item.id)}
            title={collapsed ? item.label : ''}
          >
            <i className={`nav-icon ${item.icon}`} />
            <span className="nav-label">{item.label}</span>
            {item.badge && <span className="nav-badge">{item.badge}</span>}
          </button>
        ))}
      </nav>

      {/* Footer del sidebar: usuario + cerrar sesión */}
      <div className="sidebar-footer">
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0',
          borderTop: '1px solid var(--border)', marginBottom: 8,
        }}>
          <div style={{
            width: 32, height: 32, borderRadius: 8, flexShrink: 0,
            background: `linear-gradient(135deg, ${ROLE_COLORS[user?.role] || 'var(--bronze)'}33, ${ROLE_COLORS[user?.role] || 'var(--bronze)'}22)`,
            border: `1px solid ${ROLE_COLORS[user?.role] || 'var(--bronze)'}44`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 13, fontWeight: 700, color: ROLE_COLORS[user?.role] || 'var(--bronze-light)',
          }}>
            {user?.avatar || '?'}
          </div>
          {!collapsed && (
            <div style={{ overflow: 'hidden', flex: 1 }}>
              <div style={{ fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {user?.name || 'Usuario'}
              </div>
              <div style={{ fontSize: 9, color: ROLE_COLORS[user?.role] || 'var(--bronze-light)', textTransform: 'uppercase', letterSpacing: '0.12em', fontWeight: 700 }}>
                {ROLE_LABELS[user?.role] || user?.role}
              </div>
            </div>
          )}
        </div>

        <button
          className="nav-item"
          onClick={logout}
          title={collapsed ? 'Cerrar Sesión' : ''}
          style={{ color: 'var(--danger)', borderRadius: 8 }}
          onMouseEnter={e => e.currentTarget.style.background = 'rgba(239,68,68,0.08)'}
          onMouseLeave={e => e.currentTarget.style.background = 'none'}
        >
          <i className="nav-icon ri-logout-box-r-line" />
          <span className="nav-label">Cerrar Sesión</span>
        </button>

        <button
          className="nav-item"
          onClick={onToggle}
          title={collapsed ? 'Expandir' : 'Colapsar'}
          style={{ borderRadius: 8 }}
        >
          <i className={`nav-icon ri-${collapsed ? 'arrow-right-s' : 'arrow-left-s'}-line`} />
          <span className="nav-label">{collapsed ? 'Expandir' : 'Colapsar'}</span>
        </button>
      </div>
    </aside>
  );
}

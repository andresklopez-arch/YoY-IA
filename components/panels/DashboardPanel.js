'use client';
import { useState } from 'react';

function MiniPulse({ value, max, color }) {
  const pct = Math.min(100, (value / max) * 100);
  return (
    <div style={{ height: 4, background: 'var(--bg-elevated)', borderRadius: 2, overflow: 'hidden', marginTop: 6 }}>
      <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 2, transition: 'width 0.5s ease' }} />
    </div>
  );
}

export default function DashboardPanel({ showToast, onNavigate }) {
  const [mesasVivas] = useState([]);

  function elapsedStr(inicio) {
    const ms = Date.now() - inicio;
    const m = Math.floor(ms / 60000);
    const h = Math.floor(m / 60);
    const mm = m % 60;
    return `${h}h ${mm.toString().padStart(2, '0')}m`;
  }

  function calcCosto(tarifa, inicio) {
    if (!tarifa) return 0;
    return Math.ceil((Date.now() - inicio) / 3600000 * tarifa);
  }

  const alertasIA = [
    { icon: '⚡', tipo: 'Surge Pricing', msg: 'Ocupación al 75% · Activa tarifa pico +20%', urgencia: 'warning', accion: 'Activar' },
    { icon: '📦', tipo: 'Stock bajo', msg: 'Ron Bacardí y Tequila Jimador bajo mínimo', urgencia: 'danger', accion: 'Ver' },
    { icon: '🏆', tipo: 'Torneo', msg: 'Faltan 2 jugadores para el torneo del sábado', urgencia: 'info', accion: 'Ver' },
  ];

  return (
    <div>

      {/* KPIs rápidos */}
      <div className="stat-grid" style={{ marginBottom: 24 }}>
        {[
          { label: 'Mesas Ocupadas', value: '2/8', sub: '6 disponibles', icon: 'ri-billiards-line', color: 'icon-danger', accent: 'var(--danger)', nav: 'mesas' },
          { label: 'Ingresos Hoy', value: '$3,560', sub: '+12% vs ayer', icon: 'ri-money-dollar-circle-line', color: 'icon-success', accent: 'var(--success)', nav: 'caja' },
          { label: 'Comandas Bar', value: '8', sub: 'Hoy · $1,240 MXN', icon: 'ri-cup-line', color: 'icon-bronze', accent: 'var(--bronze-light)', nav: 'bar' },
          { label: 'Clientes Hoy', value: '14', sub: '3 socios · 11 públicos', icon: 'ri-group-line', color: 'icon-blue', accent: 'var(--blue-light)', nav: 'clientes' },
        ].map((s, i) => (
          <div key={i} className="stat-card" style={{ cursor: 'pointer' }} onClick={() => onNavigate(s.nav)}>
            <div className={`stat-card-icon ${s.color}`}><i className={s.icon} /></div>
            <div className="stat-card-value" style={{ fontSize: 26, color: s.accent }}>{s.value}</div>
            <div className="stat-card-label">{s.label}</div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{s.sub}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 20 }}>
        {/* Mesas en juego AHORA */}
        <div className="card card-bronze">
          <div className="card-header">
            <h3 className="card-title"><i className="ri-record-circle-line" style={{ marginRight: 6, color: 'var(--danger)' }} />En Juego Ahora</h3>
            <button className="btn btn-secondary btn-sm" onClick={() => onNavigate('mesas')}>Ver todas</button>
          </div>
          {mesasVivas.length === 0 ? (
            <p style={{ color: 'var(--text-muted)', fontSize: 13, textAlign: 'center', padding: '16px 0' }}>Sin mesas activas</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {mesasVivas.map(m => (
                <div key={m.id} style={{ background: 'var(--bg-elevated)', borderRadius: 12, padding: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center', border: '1px solid var(--border)' }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                      <div style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--danger)', boxShadow: '0 0 6px var(--danger)', animation: 'pulse 1.4s infinite' }} />
                      <span style={{ fontWeight: 700, fontSize: 14 }}>Mesa {m.id}</span>
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{m.cliente}</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 700, color: 'var(--bronze-light)' }}>{elapsedStr(m.inicio)}</div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: m.tarifa ? 'var(--text-primary)' : 'var(--success)' }}>
                      {m.tarifa ? `$${calcCosto(m.tarifa, m.inicio)}` : 'Socio ✓'}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Alertas IA */}
        <div className="card">
          <div className="card-header">
            <h3 className="card-title"><i className="ri-robot-line" style={{ marginRight: 6 }} />Alertas IA</h3>
            <div style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--bronze)', boxShadow: '0 0 8px var(--bronze)', animation: 'pulse 2s infinite' }} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {alertasIA.map((a, i) => (
              <div key={i} style={{
                background: 'var(--bg-elevated)',
                borderRadius: 10,
                padding: 12,
                display: 'flex',
                gap: 10,
                alignItems: 'center',
                border: `1px solid ${a.urgencia === 'danger' ? 'rgba(239,68,68,0.2)' : a.urgencia === 'warning' ? 'rgba(245,158,11,0.2)' : 'var(--border)'}`,
              }}>
                <span style={{ fontSize: 18, flexShrink: 0 }}>{a.icon}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: a.urgencia === 'danger' ? 'var(--danger)' : a.urgencia === 'warning' ? 'var(--warning)' : 'var(--bronze-light)', marginBottom: 2 }}>{a.tipo}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{a.msg}</div>
                </div>
                <button
                  className="btn btn-sm btn-secondary"
                  style={{ flexShrink: 0, fontSize: 10 }}
                  onClick={() => showToast(`Acción: ${a.accion} - ${a.tipo}`, 'info')}
                >
                  {a.accion}
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Accesos rápidos */}
      <div className="card">
        <div className="card-header">
          <h3 className="card-title">Accesos Rápidos</h3>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 10 }}>
          {[
            { label: 'Nueva Mesa', icon: 'ri-play-circle-line', color: 'var(--success)', nav: 'mesas' },
            { label: 'Cobro Manual', icon: 'ri-money-dollar-circle-line', color: 'var(--bronze-light)', nav: 'caja' },
            { label: 'Nueva Comanda', icon: 'ri-cup-line', color: 'var(--blue-light)', nav: 'bar' },
            { label: 'Ver Torneos', icon: 'ri-trophy-line', color: '#ffd700', nav: 'torneos' },
            { label: 'Reportes', icon: 'ri-bar-chart-2-line', color: 'var(--silver)', nav: 'reportes' },
            { label: 'Configurar', icon: 'ri-settings-4-line', color: 'var(--text-muted)', nav: 'config' },
          ].map((a, i) => (
            <button
              key={i}
              onClick={() => onNavigate(a.nav)}
              style={{
                background: 'var(--bg-elevated)', border: '1px solid var(--border)',
                borderRadius: 12, padding: '14px 10px', cursor: 'pointer',
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
                transition: 'all 0.15s',
              }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = a.color; e.currentTarget.style.background = `${a.color}11`; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.background = 'var(--bg-elevated)'; }}
            >
              <i className={a.icon} style={{ fontSize: 22, color: a.color }} />
              <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', textAlign: 'center' }}>{a.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

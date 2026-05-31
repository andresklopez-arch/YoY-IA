'use client';
import { useState } from 'react';

const CLIENTES = [
  { id: 1, nombre: 'Carlos Rodríguez', tipo: 'Socio', puntos: 1240, partidas: 87, nivel: 'Oro', ultima: '2026-05-27', gasto: 8400, telefono: '55-1234-5678' },
  { id: 2, nombre: 'Pedro Martínez',   tipo: 'Público', puntos: 320, partidas: 23, nivel: 'Plata', ultima: '2026-05-26', gasto: 2100, telefono: '55-9876-5432' },
  { id: 3, nombre: 'Ana García',       tipo: 'Socio', puntos: 2100, partidas: 145, nivel: 'Diamante', ultima: '2026-05-28', gasto: 15200, telefono: '55-5555-1234' },
  { id: 4, nombre: 'Luis Hernández',   tipo: 'Público', puntos: 80, partidas: 8, nivel: 'Bronce', ultima: '2026-05-20', gasto: 640, telefono: '55-3333-7777' },
  { id: 5, nombre: 'Socio #12',        tipo: 'Socio', puntos: 890, partidas: 62, nivel: 'Oro', ultima: '2026-05-28', gasto: 4800, telefono: '55-1111-2222' },
];

const NIVEL_COLORS = {
  Bronce:   { bg: 'rgba(205,127,50,0.12)', text: 'var(--bronze-light)', border: 'var(--border-bronze)' },
  Plata:    { bg: 'rgba(176,184,200,0.12)', text: 'var(--silver)',        border: 'rgba(176,184,200,0.3)' },
  Oro:      { bg: 'rgba(255,215,0,0.12)',   text: '#ffd700',              border: 'rgba(255,215,0,0.3)' },
  Diamante: { bg: 'rgba(37,99,235,0.12)',  text: 'var(--blue-light)',    border: 'rgba(37,99,235,0.3)' },
};

export default function ClientesPanel({ showToast }) {
  const [clientes] = useState(CLIENTES);
  const [busqueda, setBusqueda] = useState('');
  const [filtroTipo, setFiltroTipo] = useState('Todos');
  const [clienteDetalle, setClienteDetalle] = useState(null);

  const filtrados = clientes.filter(c => {
    const busOk = !busqueda || c.nombre.toLowerCase().includes(busqueda.toLowerCase());
    const tipoOk = filtroTipo === 'Todos' || c.tipo === filtroTipo;
    return busOk && tipoOk;
  });

  const socios = clientes.filter(c => c.tipo === 'Socio').length;
  const topGastador = [...clientes].sort((a, b) => b.gasto - a.gasto)[0];

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title gradient-bronze">Clientes</h1>
          <p className="page-subtitle">CRM · Historial · Gamificación · Reservas</p>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn btn-secondary btn-sm" onClick={() => showToast('Función en desarrollo', 'info')}>
            <i className="ri-notification-3-line" /> Campaña WhatsApp
          </button>
          <button className="btn btn-primary btn-sm" onClick={() => showToast('Función en desarrollo', 'info')}>
            <i className="ri-user-add-line" /> Nuevo Cliente
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="stat-grid" style={{ marginBottom: 24 }}>
        {[
          { label: 'Total Clientes', value: clientes.length, icon: 'ri-group-line', color: 'icon-bronze', accent: 'var(--bronze-light)' },
          { label: 'Socios Activos', value: socios, icon: 'ri-vip-crown-line', color: 'icon-blue', accent: 'var(--blue-light)' },
          { label: 'Puntos Emitidos', value: clientes.reduce((s, c) => s + c.puntos, 0).toLocaleString(), icon: 'ri-star-line', color: 'icon-success', accent: 'var(--success)' },
          { label: 'Top Gasto', value: `$${topGastador?.gasto.toLocaleString()}`, icon: 'ri-medal-line', color: 'icon-bronze', accent: 'var(--bronze-light)' },
        ].map((s, i) => (
          <div key={i} className="stat-card">
            <div className={`stat-card-icon ${s.color}`}><i className={s.icon} /></div>
            <div className="stat-card-value" style={{ fontSize: 22, color: s.accent }}>{s.value}</div>
            <div className="stat-card-label">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Filtros */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
        <input className="form-input" style={{ width: 240, padding: '8px 14px', fontSize: 13 }} placeholder="Buscar cliente..." value={busqueda} onChange={e => setBusqueda(e.target.value)} />
        {['Todos', 'Socio', 'Público'].map(t => (
          <button key={t} onClick={() => setFiltroTipo(t)} className={`btn btn-sm ${filtroTipo === t ? 'btn-primary' : 'btn-secondary'}`}>{t}</button>
        ))}
      </div>

      {/* Tabla de clientes */}
      <div className="card" style={{ padding: 0 }}>
        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Cliente</th>
                <th>Nivel / Tipo</th>
                <th>Partidas</th>
                <th>Puntos</th>
                <th>Gasto Total</th>
                <th>Última Visita</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filtrados.map(c => {
                const nv = NIVEL_COLORS[c.nivel] || NIVEL_COLORS.Bronce;
                return (
                  <tr key={c.id}>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{ width: 34, height: 34, borderRadius: 10, background: 'var(--bg-elevated)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 13, color: 'var(--bronze-light)' }}>
                          {c.nombre[0]}
                        </div>
                        <div>
                          <div style={{ fontWeight: 700, fontSize: 13 }}>{c.nombre}</div>
                          <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{c.telefono}</div>
                        </div>
                      </div>
                    </td>
                    <td>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: nv.bg, color: nv.text, border: `1px solid ${nv.border}`, width: 'fit-content' }}>
                          {c.nivel}
                        </span>
                        <span style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>{c.tipo}</span>
                      </div>
                    </td>
                    <td><span style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 700 }}>{c.partidas}</span></td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <i className="ri-star-fill" style={{ color: '#ffd700', fontSize: 12 }} />
                        <span style={{ fontWeight: 700, color: '#ffd700' }}>{c.puntos.toLocaleString()}</span>
                      </div>
                    </td>
                    <td><span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, color: 'var(--bronze-light)' }}>${c.gasto.toLocaleString()}</span></td>
                    <td><span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{c.ultima}</span></td>
                    <td>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button className="btn btn-sm btn-secondary" onClick={() => setClienteDetalle(c)} title="Ver perfil">
                          <i className="ri-eye-line" />
                        </button>
                        <button className="btn btn-sm btn-secondary" onClick={() => showToast(`WhatsApp a ${c.nombre}`, 'info')} title="WhatsApp">
                          <i className="ri-whatsapp-line" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal detalle cliente */}
      {clienteDetalle && (
        <div className="modal-overlay" onClick={() => setClienteDetalle(null)}>
          <div className="modal" style={{ maxWidth: 420 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">Perfil del Jugador</span>
              <button onClick={() => setClienteDetalle(null)} style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 20 }}>✕</button>
            </div>
            <div className="modal-body">
              <div style={{ textAlign: 'center', marginBottom: 20 }}>
                <div style={{ width: 64, height: 64, borderRadius: 18, background: 'linear-gradient(135deg, var(--bronze-dark), var(--bronze))', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28, fontWeight: 800, color: '#fff', margin: '0 auto 12px', boxShadow: 'var(--shadow-bronze)' }}>
                  {clienteDetalle.nombre[0]}
                </div>
                <div style={{ fontSize: 18, fontWeight: 800 }}>{clienteDetalle.nombre}</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>{clienteDetalle.tipo} · {clienteDetalle.nivel}</div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                {[
                  { label: 'Partidas', value: clienteDetalle.partidas, icon: '🎱' },
                  { label: 'Puntos', value: clienteDetalle.puntos.toLocaleString() + ' ⭐', icon: '🏆' },
                  { label: 'Gasto Total', value: `$${clienteDetalle.gasto.toLocaleString()}`, icon: '💰' },
                  { label: 'Última Visita', value: clienteDetalle.ultima, icon: '📅' },
                ].map((s, i) => (
                  <div key={i} style={{ background: 'var(--bg-elevated)', borderRadius: 10, padding: 14, textAlign: 'center' }}>
                    <div style={{ fontSize: 20, marginBottom: 4 }}>{s.icon}</div>
                    <div style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 700, color: 'var(--bronze-light)' }}>{s.value}</div>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em', marginTop: 2 }}>{s.label}</div>
                  </div>
                ))}
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setClienteDetalle(null)}>Cerrar</button>
              <button className="btn btn-primary" onClick={() => showToast(`Reserva creada para ${clienteDetalle.nombre}`, 'success')}>
                <i className="ri-calendar-check-line" /> Reservar Mesa
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

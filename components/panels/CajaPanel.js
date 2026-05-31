'use client';
import { useState } from 'react';

const TRANSACCIONES = [
  { id: 1, tipo: 'mesa', descripcion: 'Mesa 2 - 1.5h', cliente: 'Carlos R.', monto: 120, metodo: 'efectivo', hora: '14:30', color: 'var(--success)' },
  { id: 2, tipo: 'bar',  descripcion: 'Comanda - 4 Coronas + Botana', cliente: 'Mesa 7', monto: 280, metodo: 'efectivo', hora: '13:15', color: 'var(--success)' },
  { id: 3, tipo: 'mesa', descripcion: 'Mesa 3 - 2h', cliente: 'Pedro M.', monto: 160, metodo: 'spei', hora: '12:00', color: 'var(--success)' },
  { id: 4, tipo: 'gasto',descripcion: 'Compra de bebidas', cliente: 'Proveedor ABC', monto: -650, metodo: 'efectivo', hora: '11:00', color: 'var(--danger)' },
  { id: 5, tipo: 'mesa', descripcion: 'Mesa 1 - 3h', cliente: 'Torneo Local', monto: 240, metodo: 'efectivo', hora: '09:30', color: 'var(--success)' },
];

const METODO_ICONS = {
  efectivo: 'ri-money-dollar-circle-line',
  spei:     'ri-qr-code-line',
  tarjeta:  'ri-bank-card-line',
};

export default function CajaPanel({ showToast }) {
  const [cobros, setCobros] = useState(TRANSACCIONES);
  const [mostrarCobroManual, setMostrarCobroManual] = useState(false);
  const [nuevoMonto, setNuevoMonto] = useState('');
  const [nuevaDesc, setNuevaDesc] = useState('');
  const [nuevoMetodo, setNuevoMetodo] = useState('efectivo');

  const totalHoy = cobros.filter(t => t.monto > 0).reduce((s, t) => s + t.monto, 0);
  const totalGastos = Math.abs(cobros.filter(t => t.monto < 0).reduce((s, t) => s + t.monto, 0));
  const utilidad = totalHoy - totalGastos;

  const registrarCobro = () => {
    if (!nuevoMonto || !nuevaDesc) { showToast('Completa todos los campos', 'warning'); return; }
    const monto = parseFloat(nuevoMonto);
    setCobros(prev => [{
      id: Date.now(),
      tipo: 'manual',
      descripcion: nuevaDesc,
      cliente: 'Manual',
      monto: monto,
      metodo: nuevoMetodo,
      hora: new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }),
      color: monto > 0 ? 'var(--success)' : 'var(--danger)',
    }, ...prev]);
    showToast(`Cobro de $${monto} registrado`, 'success');
    setMostrarCobroManual(false);
    setNuevoMonto(''); setNuevaDesc('');
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title gradient-bronze">Caja y POS</h1>
          <p className="page-subtitle">Corte del día · Turno actual</p>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn btn-secondary btn-sm" onClick={() => showToast('Generando corte de caja...', 'info')}>
            <i className="ri-file-list-3-line" /> Corte de Caja
          </button>
          <button className="btn btn-primary btn-sm" onClick={() => setMostrarCobroManual(true)}>
            <i className="ri-add-circle-line" /> Cobro Manual
          </button>
        </div>
      </div>

      {/* Resumen financiero */}
      <div className="stat-grid" style={{ marginBottom: 24 }}>
        {[
          { label: 'Ingresos Hoy', value: `$${totalHoy.toLocaleString()}`, icon: 'ri-arrow-up-circle-line', color: 'icon-success', accent: 'var(--success)' },
          { label: 'Gastos Hoy', value: `$${totalGastos.toLocaleString()}`, icon: 'ri-arrow-down-circle-line', color: 'icon-danger', accent: 'var(--danger)' },
          { label: 'Utilidad', value: `$${utilidad.toLocaleString()}`, icon: 'ri-funds-line', color: 'icon-blue', accent: utilidad > 0 ? 'var(--success)' : 'var(--danger)' },
          { label: 'Transacciones', value: cobros.length, icon: 'ri-receipt-line', color: 'icon-bronze', accent: 'var(--bronze-light)' },
        ].map((s, i) => (
          <div key={i} className="stat-card">
            <div className={`stat-card-icon ${s.color}`}><i className={s.icon} /></div>
            <div className="stat-card-value" style={{ fontSize: 24, color: s.accent }}>{s.value}</div>
            <div className="stat-card-label">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Métodos de pago breakdown */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 24 }}>
        {[
          { label: 'Efectivo', icon: 'ri-money-dollar-circle-line', metodo: 'efectivo', color: 'var(--success)' },
          { label: 'SPEI / QR', icon: 'ri-qr-code-line', metodo: 'spei', color: 'var(--blue-light)' },
          { label: 'Tarjeta', icon: 'ri-bank-card-line', metodo: 'tarjeta', color: 'var(--bronze-light)' },
        ].map(m => {
          const subtotal = cobros.filter(t => t.metodo === m.metodo && t.monto > 0).reduce((s, t) => s + t.monto, 0);
          return (
            <div key={m.metodo} className="card" style={{ padding: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <i className={m.icon} style={{ fontSize: 18, color: m.color }} />
                <span style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-muted)', fontWeight: 600 }}>{m.label}</span>
              </div>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 700, color: m.color }}>${subtotal.toLocaleString()}</div>
            </div>
          );
        })}
      </div>

      {/* Tabla de transacciones */}
      <div className="card">
        <div className="card-header">
          <h3 className="card-title">Movimientos del Turno</h3>
          <button className="btn btn-secondary btn-sm" onClick={() => showToast('Exportando...', 'info')}>
            <i className="ri-download-line" /> Exportar
          </button>
        </div>
        <div className="table-wrapper" style={{ border: 'none' }}>
          <table>
            <thead>
              <tr>
                <th>Hora</th>
                <th>Descripción</th>
                <th>Cliente / Destino</th>
                <th>Método</th>
                <th style={{ textAlign: 'right' }}>Monto</th>
              </tr>
            </thead>
            <tbody>
              {cobros.map(t => (
                <tr key={t.id}>
                  <td style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-display)', fontSize: 12 }}>{t.hora}</td>
                  <td style={{ fontWeight: 600 }}>{t.descripcion}</td>
                  <td style={{ color: 'var(--text-secondary)' }}>{t.cliente}</td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <i className={METODO_ICONS[t.metodo] || 'ri-cash-line'} style={{ fontSize: 14, color: 'var(--text-muted)' }} />
                      <span style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'capitalize' }}>{t.metodo}</span>
                    </div>
                  </td>
                  <td style={{ textAlign: 'right', fontFamily: 'var(--font-display)', fontSize: 15, fontWeight: 700, color: t.color }}>
                    {t.monto > 0 ? '+' : ''}${Math.abs(t.monto).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal cobro manual */}
      {mostrarCobroManual && (
        <div className="modal-overlay" onClick={() => setMostrarCobroManual(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">Registrar Cobro Manual</span>
              <button onClick={() => setMostrarCobroManual(false)} style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 20 }}>✕</button>
            </div>
            <div className="modal-body">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div className="form-group">
                  <label className="form-label">Descripción</label>
                  <input className="form-input" placeholder="Ej: Torneo especial, Renta privada..." value={nuevaDesc} onChange={e => setNuevaDesc(e.target.value)} />
                </div>
                <div className="form-group">
                  <label className="form-label">Monto (negativo = gasto)</label>
                  <input className="form-input" type="number" placeholder="Ej: 500 o -200" value={nuevoMonto} onChange={e => setNuevoMonto(e.target.value)} />
                </div>
                <div className="form-group">
                  <label className="form-label">Método de Pago</label>
                  <select className="form-select" value={nuevoMetodo} onChange={e => setNuevoMetodo(e.target.value)}>
                    <option value="efectivo">💵 Efectivo</option>
                    <option value="spei">📱 SPEI / QR CoDi</option>
                    <option value="tarjeta">💳 Tarjeta</option>
                  </select>
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setMostrarCobroManual(false)}>Cancelar</button>
              <button className="btn btn-primary" onClick={registrarCobro}>Registrar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

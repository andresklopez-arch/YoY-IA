'use client';
import { useState, useEffect } from 'react';
import { obfuscate, deobfuscate } from '@/lib/crypto';

const INIT_CLIENTES = [
  { id: 1, nombre: 'Carlos Rodríguez', tipo: 'Socio', puntos: 1240, partidas: 87, nivel: 'Oro', ultima: '2026-05-27', gasto: 8400, telefono: '55-1234-5678', saldo: 350, historialSaldo: [{ fecha: '2026-05-27', monto: 350, concepto: 'Recarga Inicial' }] },
  { id: 2, nombre: 'Pedro Martínez',   tipo: 'Público', puntos: 320, partidas: 23, nivel: 'Plata', ultima: '2026-05-26', gasto: 2100, telefono: '55-9876-5432', saldo: 0, historialSaldo: [] },
  { id: 3, nombre: 'Ana García',       tipo: 'Socio', puntos: 2100, partidas: 145, nivel: 'Diamante', ultima: '2026-05-28', gasto: 15200, telefono: '55-5555-1234', saldo: 1200, historialSaldo: [{ fecha: '2026-05-28', monto: 1200, concepto: 'Recarga Bono Premium' }] },
  { id: 4, nombre: 'Luis Hernández',   tipo: 'Público', puntos: 80, partidas: 8, nivel: 'Bronce', ultima: '2026-05-20', gasto: 640, telefono: '55-3333-7777', saldo: 0, historialSaldo: [] },
  { id: 5, nombre: 'Socio #12',        tipo: 'Socio', puntos: 890, partidas: 62, nivel: 'Oro', ultima: '2026-05-28', gasto: 4800, telefono: '55-1111-2222', saldo: 150, historialSaldo: [{ fecha: '2026-05-28', monto: 150, concepto: 'Cashback 5% Acreditado' }] },
];

const NIVEL_COLORS = {
  Bronce:   { bg: 'rgba(205,127,50,0.12)', text: 'var(--bronze-light)', border: 'var(--border-bronze)' },
  Plata:    { bg: 'rgba(176,184,200,0.12)', text: 'var(--silver)',        border: 'rgba(176,184,200,0.3)' },
  Oro:      { bg: 'rgba(255,215,0,0.12)',   text: '#ffd700',              border: 'rgba(255,215,0,0.3)' },
  Diamante: { bg: 'rgba(37,99,235,0.12)',  text: 'var(--blue-light)',    border: 'rgba(37,99,235,0.3)' },
};

export default function ClientesPanel({ showToast }) {
  const [clientes, setClientes] = useState([]);
  const [busqueda, setBusqueda] = useState('');
  const [filtroTipo, setFiltroTipo] = useState('Todos');
  const [clienteDetalle, setClienteDetalle] = useState(null);

  // Modales
  const [showNuevoCliente, setShowNuevoCliente] = useState(false);

  // Formulario Nuevo Cliente
  const [nuevoNombre, setNuevoNombre] = useState('');
  const [nuevoTelefono, setNuevoTelefono] = useState('');
  const [nuevoTipo, setNuevoTipo] = useState('Público');
  const [nuevoNivel, setNuevoNivel] = useState('Bronce');
  const [nuevoSaldo, setNuevoSaldo] = useState('0');

  // Formulario Recarga
  const [montoRecarga, setMontoRecarga] = useState('');

  // ELO de torneos mapeado
  const [elosMap, setElosMap] = useState({});

  useEffect(() => {
    // Cargar clientes
    const saved = localStorage.getItem('yoy_billar_clientes');
    if (saved) {
      const data = deobfuscate(saved);
      if (data && data.length > 0) {
        setClientes(data);
      } else {
        setClientes(INIT_CLIENTES);
        localStorage.setItem('yoy_billar_clientes', obfuscate(INIT_CLIENTES));
      }
    } else {
      setClientes(INIT_CLIENTES);
      localStorage.setItem('yoy_billar_clientes', obfuscate(INIT_CLIENTES));
    }

    // Cargar ELOs desde torneos
    const torneosSaved = localStorage.getItem('yoy_billar_torneos');
    if (torneosSaved) {
      const torneosData = deobfuscate(torneosSaved);
      if (torneosData) {
        const elos = {};
        torneosData.forEach(t => {
          if (t.ranking) {
            t.ranking.forEach(r => {
              // Si ya existe, guardamos el ELO más alto o más reciente
              elos[r.nombre.toLowerCase()] = Math.max(elos[r.nombre.toLowerCase()] || 0, r.elo);
            });
          }
        });
        setElosMap(elos);
      }
    }
  }, []);

  const saveClientes = (newClientes) => {
    setClientes(newClientes);
    localStorage.setItem('yoy_billar_clientes', obfuscate(newClientes));
  };

  const filtrados = clientes.filter(c => {
    const busOk = !busqueda || c.nombre.toLowerCase().includes(busqueda.toLowerCase());
    const tipoOk = filtroTipo === 'Todos' || c.tipo === filtroTipo;
    return busOk && tipoOk;
  });

  const sociosCount = clientes.filter(c => c.tipo === 'Socio').length;
  const topGastador = [...clientes].sort((a, b) => b.gasto - a.gasto)[0];

  const handleNuevoCliente = (e) => {
    e.preventDefault();
    if (!nuevoNombre.trim()) {
      showToast('Por favor introduce un nombre válido', 'error');
      return;
    }

    const valSaldo = parseFloat(nuevoSaldo) || 0;
    const nuevo = {
      id: Date.now(),
      nombre: nuevoNombre.trim(),
      telefono: nuevoTelefono.trim() || 'Sin teléfono',
      tipo: nuevoTipo,
      nivel: nuevoNivel,
      puntos: 0,
      partidas: 0,
      gasto: 0,
      ultima: new Date().toISOString().split('T')[0],
      saldo: valSaldo,
      historialSaldo: valSaldo > 0 ? [{ fecha: new Date().toISOString().split('T')[0], monto: valSaldo, concepto: 'Saldo Inicial Creado' }] : []
    };

    const updated = [...clientes, nuevo];
    saveClientes(updated);
    setShowNuevoCliente(false);
    // Reset
    setNuevoNombre('');
    setNuevoTelefono('');
    setNuevoTipo('Público');
    setNuevoNivel('Bronce');
    setNuevoSaldo('0');

    showToast('Cliente registrado correctamente', 'success');
  };

  const handleRecarga = (e) => {
    e.preventDefault();
    const num = parseFloat(montoRecarga);
    if (isNaN(num) || num <= 0) {
      showToast('Introduce un monto de recarga válido', 'error');
      return;
    }

    const updated = clientes.map(c => {
      if (c.id === clienteDetalle.id) {
        const currentSaldo = c.saldo || 0;
        const currentHist = c.historialSaldo || [];
        return {
          ...c,
          saldo: currentSaldo + num,
          historialSaldo: [
            { fecha: new Date().toISOString().split('T')[0], monto: num, concepto: 'Recarga Monedero' },
            ...currentHist
          ]
        };
      }
      return c;
    });

    saveClientes(updated);
    const updatedDetalle = updated.find(c => c.id === clienteDetalle.id);
    setClienteDetalle(updatedDetalle);
    setMontoRecarga('');
    showToast(`Recarga de $${num} exitosa. Nuevo Saldo: $${updatedDetalle.saldo}`, 'success');
  };

  const getEloOfCliente = (nombre) => {
    return elosMap[nombre.toLowerCase()] || 1500;
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title gradient-bronze">Clientes</h1>
          <p className="page-subtitle">CRM · Monedero Virtual con Cashback del 5% · Historial y ELO</p>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn btn-secondary btn-sm" onClick={() => showToast('Función en desarrollo', 'info')}>
            <i className="ri-notification-3-line" /> Campaña WhatsApp
          </button>
          <button className="btn btn-primary btn-sm" onClick={() => setShowNuevoCliente(true)}>
            <i className="ri-user-add-line" /> Nuevo Cliente
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="stat-grid" style={{ marginBottom: 24 }}>
        {[
          { label: 'Total Clientes', value: clientes.length, icon: 'ri-group-line', color: 'icon-bronze', accent: 'var(--bronze-light)' },
          { label: 'Socios Activos', value: sociosCount, icon: 'ri-vip-crown-line', color: 'icon-blue', accent: 'var(--blue-light)' },
          { label: 'Saldo Acumulado', value: `$${clientes.reduce((s, c) => s + (c.saldo || 0), 0).toLocaleString()}`, icon: 'ri-wallet-3-line', color: 'icon-success', accent: 'var(--success)' },
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
                <th>Partidas / ELO</th>
                <th>Puntos</th>
                <th>Monedero</th>
                <th>Gasto Total</th>
                <th>Última Visita</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filtrados.map(c => {
                const nv = NIVEL_COLORS[c.nivel] || NIVEL_COLORS.Bronce;
                const clientElo = getEloOfCliente(c.nombre);
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
                    <td>
                      <div style={{ display: 'flex', flexDirection: 'column' }}>
                        <span style={{ fontFamily: 'var(--font-display)', fontSize: 14, fontWeight: 700 }}>{c.partidas} jugadas</span>
                        <span style={{ fontSize: 10, color: 'var(--blue-light)', fontWeight: 600 }}>ELO: {clientElo}</span>
                      </div>
                    </td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <i className="ri-star-fill" style={{ color: '#ffd700', fontSize: 12 }} />
                        <span style={{ fontWeight: 700, color: '#ffd700' }}>{c.puntos.toLocaleString()}</span>
                      </div>
                    </td>
                    <td>
                      <div style={{ fontWeight: 700, color: (c.saldo || 0) > 0 ? 'var(--success)' : 'var(--text-muted)' }}>
                        ${(c.saldo || 0).toLocaleString()}
                      </div>
                    </td>
                    <td><span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, color: 'var(--bronze-light)' }}>${c.gasto.toLocaleString()}</span></td>
                    <td><span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{c.ultima}</span></td>
                    <td>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button className="btn btn-sm btn-secondary" onClick={() => setClienteDetalle(c)} title="Ver perfil / Monedero">
                          <i className="ri-wallet-3-line" /> Perfil
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

      {/* Modal detalle cliente / Monedero */}
      {clienteDetalle && (
        <div className="modal-overlay" onClick={() => setClienteDetalle(null)}>
          <div className="modal" style={{ maxWidth: 500 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">Perfil del Jugador y Monedero</span>
              <button onClick={() => setClienteDetalle(null)} style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 20 }}>✕</button>
            </div>
            <div className="modal-body" style={{ maxHeight: '75vh', overflowY: 'auto' }}>
              <div style={{ textAlign: 'center', marginBottom: 20 }}>
                <div style={{ width: 64, height: 64, borderRadius: 18, background: 'linear-gradient(135deg, var(--bronze-dark), var(--bronze))', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28, fontWeight: 800, color: '#fff', margin: '0 auto 12px', boxShadow: 'var(--shadow-bronze)' }}>
                  {clienteDetalle.nombre[0]}
                </div>
                <div style={{ fontSize: 18, fontWeight: 800 }}>{clienteDetalle.nombre}</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                  {clienteDetalle.tipo} · {clienteDetalle.nivel} · ELO: {getEloOfCliente(clienteDetalle.nombre)}
                </div>
              </div>

              {/* Grid de Stats */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 20 }}>
                <div style={{ background: 'var(--bg-elevated)', borderRadius: 10, padding: 10, textAlign: 'center' }}>
                  <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--success)' }}>${(clienteDetalle.saldo || 0).toLocaleString()}</div>
                  <div style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', marginTop: 2 }}>Saldo Monedero</div>
                </div>
                <div style={{ background: 'var(--bg-elevated)', borderRadius: 10, padding: 10, textAlign: 'center' }}>
                  <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--bronze-light)' }}>${clienteDetalle.gasto.toLocaleString()}</div>
                  <div style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', marginTop: 2 }}>Gasto Total</div>
                </div>
              </div>

              {/* Formulario de recarga */}
              <form onSubmit={handleRecarga} style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 12, padding: 14, marginBottom: 16 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--bronze-light)', marginBottom: 8 }}><i className="ri-add-circle-line" /> Recargar Monedero</div>
                <div style={{ display: 'flex', gap: 10 }}>
                  <input className="form-input" style={{ flex: 1 }} type="number" min={1} placeholder="Monto a recargar (MXN)" value={montoRecarga} onChange={e => setMontoRecarga(e.target.value)} />
                  <button type="submit" className="btn btn-primary btn-sm">Recargar</button>
                </div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 6 }}>
                  * Los socios mensuales acumulan automáticamente un 5% de cashback en rentas y consumos.
                </div>
              </form>

              {/* Historial de Movimientos de Saldo */}
              <div style={{ border: '1px solid var(--border)', borderRadius: 12, padding: 14 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 8 }}><i className="ri-history-line" /> Historial de Transacciones</div>
                {(!clienteDetalle.historialSaldo || clienteDetalle.historialSaldo.length === 0) ? (
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center', padding: '10px 0' }}>No hay movimientos registrados</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 150, overflowY: 'auto' }}>
                    {clienteDetalle.historialSaldo.map((h, i) => (
                      <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, borderBottom: '1px solid var(--border-subtle)', paddingBottom: 4 }}>
                        <div>
                          <div style={{ fontWeight: 600, color: 'var(--text-secondary)' }}>{h.concepto}</div>
                          <div style={{ fontSize: 9, color: 'var(--text-muted)' }}>{h.fecha}</div>
                        </div>
                        <div style={{ fontWeight: 700, color: h.monto >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                          {h.monto >= 0 ? `+$${h.monto}` : `-$${Math.abs(h.monto)}`}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setClienteDetalle(null)}>Cerrar</button>
              <button className="btn btn-primary" onClick={() => {
                showToast(`Reserva creada para ${clienteDetalle.nombre}`, 'success');
                setClienteDetalle(null);
              }}>
                <i className="ri-calendar-check-line" /> Reservar Mesa
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Nuevo Cliente */}
      {showNuevoCliente && (
        <div className="modal-overlay" onClick={() => setShowNuevoCliente(false)}>
          <div className="modal" style={{ maxWidth: 450 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">Agregar Nuevo Cliente</span>
              <button onClick={() => setShowNuevoCliente(false)} style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 20 }}>✕</button>
            </div>
            <form onSubmit={handleNuevoCliente}>
              <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div className="form-group">
                  <label className="form-label">Nombre Completo *</label>
                  <input className="form-input" required placeholder="Ej: Carlos Rodríguez" value={nuevoNombre} onChange={e => setNuevoNombre(e.target.value)} />
                </div>
                <div className="form-group">
                  <label className="form-label">Teléfono (WhatsApp)</label>
                  <input className="form-input" placeholder="Ej: 55-1234-5678" value={nuevoTelefono} onChange={e => setNuevoTelefono(e.target.value)} />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div className="form-group">
                    <label className="form-label">Tipo de Cliente</label>
                    <select className="form-select" value={nuevoTipo} onChange={e => setNuevoTipo(e.target.value)}>
                      <option value="Público">Público General</option>
                      <option value="Socio">Socio / Miembro</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Nivel de Socio</label>
                    <select className="form-select" value={nuevoNivel} onChange={e => setNuevoNivel(e.target.value)}>
                      <option value="Bronce">Bronce</option>
                      <option value="Plata">Plata</option>
                      <option value="Oro">Oro</option>
                      <option value="Diamante">Diamante</option>
                    </select>
                  </div>
                </div>
                <div className="form-group">
                  <label className="form-label">Saldo Inicial Monedero</label>
                  <input className="form-input" type="number" min={0} value={nuevoSaldo} onChange={e => setNuevoSaldo(e.target.value)} />
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setShowNuevoCliente(false)}>Cancelar</button>
                <button type="submit" className="btn btn-primary">Registrar Cliente</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

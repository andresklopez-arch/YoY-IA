'use client';
import { useState, useEffect, useRef } from 'react';

// ── DATOS INICIALES DE MESAS ───────────────────────────────
const INIT_MESAS = [
  { id: 1, nombre: 'Mesa 1', tipo: 'Carambola 3B', estado: 'libre',    cliente: null, inicio: null, tarifa: 80, socios: false },
  { id: 2, nombre: 'Mesa 2', tipo: 'Carambola 3B', estado: 'ocupada',  cliente: 'Carlos R.', inicio: Date.now() - 45*60000, tarifa: 80, socios: false },
  { id: 3, nombre: 'Mesa 3', tipo: 'Pool 9B',      estado: 'reservada', cliente: 'Pedro M.', inicio: null, tarifa: 60, socios: false },
  { id: 4, nombre: 'Mesa 4', tipo: 'Carambola 3B', estado: 'libre',    cliente: null, inicio: null, tarifa: 80, socios: false },
  { id: 5, nombre: 'Mesa 5', tipo: 'Snooker',      estado: 'manten',   cliente: null, inicio: null, tarifa: 100, socios: false },
  { id: 6, nombre: 'Mesa 6', tipo: 'Pool 9B',      estado: 'libre',    cliente: null, inicio: null, tarifa: 60, socios: false },
  { id: 7, nombre: 'Mesa 7', tipo: 'Carambola 3B', estado: 'ocupada',  cliente: 'Socio #12', inicio: Date.now() - 1.5*60*60000, tarifa: 0, socios: true },
  { id: 8, nombre: 'Mesa 8', tipo: 'Pool 9B',      estado: 'libre',    cliente: null, inicio: null, tarifa: 60, socios: false },
];

const ESTADO_CONFIG = {
  libre:     { label: 'Libre',     color: 'var(--mesa-libre)',     icon: 'ri-checkbox-blank-circle-line' },
  ocupada:   { label: 'Ocupada',   color: 'var(--mesa-ocupada)',   icon: 'ri-record-circle-line' },
  reservada: { label: 'Reservada', color: 'var(--mesa-reservada)', icon: 'ri-bookmark-fill' },
  manten:    { label: 'Mantenimiento', color: 'var(--mesa-manten)', icon: 'ri-tools-line' },
};

function formatTime(ms) {
  if (!ms) return '00:00:00';
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600).toString().padStart(2, '0');
  const m = Math.floor((s % 3600) / 60).toString().padStart(2, '0');
  const sc = (s % 60).toString().padStart(2, '0');
  return `${h}:${m}:${sc}`;
}

function calcCosto(mesa) {
  if (!mesa.inicio || mesa.socios) return 0;
  const hrs = (Date.now() - mesa.inicio) / 3600000;
  return Math.ceil(hrs * mesa.tarifa);
}

// ── MODAL ABRIR MESA ──────────────────────────────────────
function ModalAbrirMesa({ mesa, onClose, onConfirm }) {
  const [cliente, setCliente] = useState(mesa.cliente || '');
  const [esSocio, setEsSocio] = useState(mesa.esSocio || false);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title"><i className="ri-play-circle-line" style={{ marginRight: 8 }} />{mesa.nombre}</span>
          <button onClick={onClose} className="btn-icon btn btn-secondary" style={{ background: 'none', border: 'none' }}>
            <i className="ri-close-line" style={{ fontSize: 20 }} />
          </button>
        </div>
        <div className="modal-body">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ padding: 16, background: 'var(--bronze-subtle)', border: '1px solid var(--border-bronze)', borderRadius: 12 }}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 4 }}>Tipo de mesa</div>
              <div style={{ fontSize: 16, fontWeight: 700 }}>{mesa.tipo}</div>
              <div style={{ fontSize: 13, color: 'var(--bronze-light)', marginTop: 4 }}>${mesa.tarifa}/hr (público) · Socios: sin cargo</div>
            </div>

            <div className="form-group">
              <label className="form-label">Nombre del cliente (opcional)</label>
              <input className="form-input" placeholder="Ej: Carlos Rodríguez" value={cliente} onChange={e => setCliente(e.target.value)} />
            </div>

            <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', padding: '10px 14px', background: 'var(--bg-elevated)', borderRadius: 10, border: '1px solid var(--border)' }}>
              <input type="checkbox" checked={esSocio} onChange={e => setEsSocio(e.target.checked)} style={{ width: 16, height: 16, accentColor: 'var(--bronze)' }} />
              <span style={{ fontSize: 13, fontWeight: 600 }}>Es miembro / socio mensual</span>
              <span className="badge badge-bronze" style={{ marginLeft: 'auto' }}>Sin cargo</span>
            </label>
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary" onClick={() => onConfirm({ cliente: cliente || 'Público', esSocio })}>
            <i className="ri-play-circle-line" /> Iniciar Mesa
          </button>
        </div>
      </div>
    </div>
  );
}

// ── MODAL CERRAR MESA ────────────────────────────────────
function ModalCerrarMesa({ mesa, onClose, onCerrar }) {
  const [elapsed, setElapsed] = useState(Date.now() - (mesa.inicio || Date.now()));
  const [metodo, setMetodo] = useState('efectivo');

  useEffect(() => {
    const t = setInterval(() => setElapsed(Date.now() - (mesa.inicio || Date.now())), 1000);
    return () => clearInterval(t);
  }, [mesa.inicio]);

  const costo = calcCosto({ ...mesa, inicio: mesa.inicio });
  const hrs = (elapsed / 3600000).toFixed(2);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title"><i className="ri-stop-circle-line" style={{ marginRight: 8, color: 'var(--danger)' }} />Cerrar {mesa.nombre}</span>
          <button onClick={onClose} className="btn btn-secondary" style={{ background: 'none', border: 'none', padding: 4 }}>
            <i className="ri-close-line" style={{ fontSize: 20 }} />
          </button>
        </div>
        <div className="modal-body">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* Resumen */}
            <div style={{ background: 'var(--bg-elevated)', borderRadius: 12, padding: 16, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 4 }}>Tiempo</div>
                <div style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--bronze-light)' }}>{formatTime(elapsed)}</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{hrs} hrs · ${mesa.tarifa}/hr</div>
              </div>
              <div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 4 }}>Total a Cobrar</div>
                <div style={{ fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 900, color: mesa.socios ? 'var(--success)' : 'var(--text-primary)' }}>
                  {mesa.socios ? 'SOCIO' : `$${costo}`}
                </div>
                {!mesa.socios && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>MXN</div>}
              </div>
            </div>

            {/* Cliente */}
            <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
              <i className="ri-user-line" style={{ marginRight: 6 }} />
              {mesa.cliente || 'Público General'}
            </div>

            {/* Método de pago */}
            {!mesa.socios && (
              <div className="form-group">
                <label className="form-label">Método de Pago</label>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                  {[
                    { id: 'efectivo', label: 'Efectivo', icon: 'ri-money-dollar-circle-line' },
                    { id: 'spei',     label: 'SPEI/QR',  icon: 'ri-qr-code-line' },
                    { id: 'tarjeta',  label: 'Tarjeta',  icon: 'ri-bank-card-line' },
                  ].map(m => (
                    <button
                      key={m.id}
                      onClick={() => setMetodo(m.id)}
                      style={{
                        background: metodo === m.id ? 'var(--bronze-subtle)' : 'var(--bg-elevated)',
                        border: `1px solid ${metodo === m.id ? 'var(--border-bronze)' : 'var(--border)'}`,
                        borderRadius: 10, padding: '10px 8px', cursor: 'pointer',
                        color: metodo === m.id ? 'var(--bronze-light)' : 'var(--text-secondary)',
                        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
                        fontSize: 11, fontWeight: 600, transition: 'all 0.15s',
                      }}
                    >
                      <i className={m.icon} style={{ fontSize: 20 }} />
                      {m.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cancelar</button>
          <button
            className="btn btn-primary"
            onClick={() => onCerrar({ costo, metodo, tiempo: elapsed })}
            style={{ background: 'linear-gradient(135deg, var(--danger), #ff6b6b)' }}
          >
            <i className="ri-stop-circle-line" /> Cerrar y Cobrar
          </button>
        </div>
      </div>
    </div>
  );
}

// ── TIMER HOOK ────────────────────────────────────────────
function useLiveTick() {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick(p => p + 1), 1000);
    return () => clearInterval(t);
  }, []);
  return tick;
}

// ── PANEL PRINCIPAL DE MESAS ──────────────────────────────
export default function MesasPanel({ showToast }) {
  const [mesas, setMesas] = useState(INIT_MESAS);
  const [filtro, setFiltro] = useState('todas');
  const [modalAbrir, setModalAbrir] = useState(null);
  const [modalCerrar, setModalCerrar] = useState(null);
  const [modalNuevaMesa, setModalNuevaMesa] = useState(false);
  const [modalFila, setModalFila] = useState(false);
  const [fila, setFila] = useState([
    { id: 1, cliente: 'Roberto G.', contacto: '55-1234-5678', tipo: 'Pool 9B', personas: 4, registro: Date.now() - 20*60000 },
    { id: 2, cliente: 'Diana L.', contacto: '55-8765-4321', tipo: 'Snooker', personas: 2, registro: Date.now() - 5*60000 },
  ]);
  const tick = useLiveTick();

  const totales = {
    libres:    mesas.filter(m => m.estado === 'libre').length,
    ocupadas:  mesas.filter(m => m.estado === 'ocupada').length,
    reservadas:mesas.filter(m => m.estado === 'reservada').length,
    manten:    mesas.filter(m => m.estado === 'manten').length,
  };

  const mesasFiltradas = filtro === 'todas' ? mesas : mesas.filter(m => m.estado === filtro);

  const abrirMesa = (mesa) => {
    if (mesa.estado === 'ocupada') { setModalCerrar(mesa); return; }
    if (mesa.estado === 'manten') { showToast('Mesa en mantenimiento, no disponible.', 'warning'); return; }
    setModalAbrir(mesa);
  };

  const confirmarAbrirMesa = (mesaId, { cliente, esSocio }) => {
    setMesas(prev => prev.map(m => m.id === mesaId
      ? { ...m, estado: 'ocupada', cliente, inicio: Date.now(), socios: esSocio }
      : m
    ));
    
    if (modalAbrir && modalAbrir.filaId) {
      setFila(prev => prev.filter(f => f.id !== modalAbrir.filaId));
    }
    
    setModalAbrir(null);
    showToast(`Mesa ${mesaId} iniciada para ${cliente}`, 'success');
  };

  const registrarNuevaMesa = (nueva) => {
    const mesaId = parseInt(nueva.id);
    if (mesas.some(m => m.id === mesaId)) {
      showToast(`La mesa ${mesaId} ya está registrada.`, 'warning');
      return;
    }
    setMesas(prev => [
      ...prev,
      {
        id: mesaId,
        nombre: `Mesa ${mesaId}`,
        tipo: nueva.tipo,
        estado: 'libre',
        cliente: null,
        inicio: null,
        tarifa: parseFloat(nueva.tarifa),
        socios: false
      }
    ]);
    setModalNuevaMesa(false);
    showToast(`Mesa ${mesaId} registrada con éxito.`, 'success');
  };

  const asignarClienteDeFila = (clienteEspera) => {
    let table = mesas.find(m => m.estado === 'libre' && m.tipo === clienteEspera.tipo);
    if (!table) {
      table = mesas.find(m => m.estado === 'libre');
    }
    
    if (table) {
      setModalFila(false);
      setModalAbrir({
        ...table,
        cliente: clienteEspera.cliente,
        esSocio: false,
        filaId: clienteEspera.id
      });
    } else {
      showToast('No hay mesas libres disponibles.', 'warning');
    }
  };

  const confirmarCerrarMesa = (mesaId, { costo, metodo, tiempo }) => {
    setMesas(prev => prev.map(m => m.id === mesaId
      ? { ...m, estado: 'libre', cliente: null, inicio: null, socios: false }
      : m
    ));
    setModalCerrar(null);
    if (costo > 0) {
      showToast(`Cobrado $${costo} MXN por ${metodo} ✓`, 'success');
    } else {
      showToast(`Mesa cerrada (Socio sin cargo)`, 'info');
    }
  };

  const ingresosActivos = mesas
    .filter(m => m.estado === 'ocupada' && !m.socios)
    .reduce((sum, m) => sum + calcCosto(m), 0);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title gradient-bronze">Control de Mesas</h1>
          <p className="page-subtitle">Gestión en tiempo real · {mesas.length} mesas registradas</p>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn btn-secondary btn-sm" onClick={() => setModalFila(true)}>
            <i className="ri-qr-code-line" /> Fila Virtual
            {fila.length > 0 && (
              <span className="badge badge-bronze" style={{ marginLeft: 6, padding: '2px 6px', fontSize: 9 }}>
                {fila.length}
              </span>
            )}
          </button>
          <button className="btn btn-primary btn-sm" onClick={() => setModalNuevaMesa(true)}>
            <i className="ri-add-line" /> Nueva Mesa
          </button>
        </div>
      </div>

      {/* Stats rápidas */}
      <div className="stat-grid" style={{ marginBottom: 24 }}>
        {[
          { label: 'Libres', value: totales.libres, icon: 'ri-checkbox-blank-circle-line', color: 'icon-success', accent: 'var(--success)' },
          { label: 'Ocupadas', value: totales.ocupadas, icon: 'ri-record-circle-line', color: 'icon-danger', accent: 'var(--danger)' },
          { label: 'Reservadas', value: totales.reservadas, icon: 'ri-bookmark-fill', color: 'icon-bronze', accent: 'var(--bronze-light)' },
          { label: 'Ingresos en curso', value: `$${ingresosActivos}`, icon: 'ri-coins-line', color: 'icon-blue', accent: 'var(--blue-light)' },
        ].map((s, i) => (
          <div key={i} className="stat-card">
            <div className={`stat-card-icon ${s.color}`}><i className={s.icon} /></div>
            <div className="stat-card-value" style={{ color: s.accent, fontSize: 26 }}>{s.value}</div>
            <div className="stat-card-label">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Filtros */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
        {[
          { id: 'todas', label: 'Todas' },
          { id: 'libre', label: 'Libres' },
          { id: 'ocupada', label: 'Ocupadas' },
          { id: 'reservada', label: 'Reservadas' },
          { id: 'manten', label: 'Mantenimiento' },
        ].map(f => (
          <button
            key={f.id}
            onClick={() => setFiltro(f.id)}
            className={`btn btn-sm ${filtro === f.id ? 'btn-primary' : 'btn-secondary'}`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Grid de mesas */}
      <div className="mesa-grid">
        {mesasFiltradas.map(mesa => {
          const elapsed = mesa.inicio ? Date.now() - mesa.inicio : 0;
          const costo = calcCosto(mesa);
          const cfg = ESTADO_CONFIG[mesa.estado];

          return (
            <div
              key={mesa.id}
              className={`mesa-card ${mesa.estado}`}
              onClick={() => abrirMesa(mesa)}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                <div className="mesa-number">{mesa.id}</div>
                <span className={`mesa-status-badge ${mesa.estado}`}>
                  <span className={mesa.estado === 'ocupada' ? 'dot-live' : ''} style={{ width: 6, height: 6, borderRadius: '50%', background: cfg.color, flexShrink: 0 }} />
                  {cfg.label}
                </span>
              </div>

              <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6 }}>
                {mesa.tipo}
              </div>

              {mesa.estado === 'ocupada' && (
                <>
                  <div className="mesa-timer">{formatTime(elapsed)}</div>
                  <div className="mesa-client">
                    <i className="ri-user-line" style={{ fontSize: 10, marginRight: 4 }} />
                    {mesa.cliente}
                    {mesa.socios && <span className="badge badge-bronze" style={{ marginLeft: 6, fontSize: 8 }}>Socio</span>}
                  </div>
                  <div className="mesa-rate" style={{ marginTop: 6, fontSize: 13, fontWeight: 700, color: 'var(--bronze-light)' }}>
                    {mesa.socios ? 'Sin cargo' : `$${costo} MXN`}
                  </div>
                </>
              )}

              {mesa.estado === 'reservada' && (
                <div className="mesa-client" style={{ marginTop: 6 }}>
                  <i className="ri-bookmark-line" style={{ fontSize: 10, marginRight: 4 }} />
                  {mesa.cliente}
                </div>
              )}

              {mesa.estado === 'manten' && (
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6, display: 'flex', alignItems: 'center', gap: 4 }}>
                  <i className="ri-tools-line" /> En reparación
                </div>
              )}

              <div className="mesa-actions" onClick={e => e.stopPropagation()}>
                {mesa.estado === 'libre' && (
                  <button className="btn btn-success btn-sm" style={{ flex: 1 }} onClick={() => abrirMesa(mesa)}>
                    <i className="ri-play-fill" /> Abrir
                  </button>
                )}
                {mesa.estado === 'ocupada' && (
                  <button className="btn btn-danger btn-sm" style={{ flex: 1 }} onClick={() => setModalCerrar(mesa)}>
                    <i className="ri-stop-fill" /> Cerrar
                  </button>
                )}
                {mesa.estado === 'reservada' && (
                  <button className="btn btn-primary btn-sm" style={{ flex: 1 }} onClick={() => abrirMesa(mesa)}>
                    <i className="ri-play-fill" /> Activar
                  </button>
                )}
                <button
                  className="btn btn-secondary btn-sm btn-icon"
                  title="Cambiar estado"
                  onClick={() => showToast('Función en desarrollo', 'info')}
                >
                  <i className="ri-more-2-line" />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Modales */}
      {modalAbrir && (
        <ModalAbrirMesa
          mesa={modalAbrir}
          onClose={() => setModalAbrir(null)}
          onConfirm={(data) => confirmarAbrirMesa(modalAbrir.id, data)}
        />
      )}
      {modalCerrar && (
        <ModalCerrarMesa
          mesa={modalCerrar}
          onClose={() => setModalCerrar(null)}
          onCerrar={(data) => confirmarCerrarMesa(modalCerrar.id, data)}
        />
      )}
      {modalNuevaMesa && (
        <ModalNuevaMesa
          mesas={mesas}
          onClose={() => setModalNuevaMesa(false)}
          onConfirm={registrarNuevaMesa}
        />
      )}
      {modalFila && (
        <ModalFilaVirtual
          fila={fila}
          setFila={setFila}
          mesas={mesas}
          onAssign={asignarClienteDeFila}
          onClose={() => setModalFila(false)}
          showToast={showToast}
        />
      )}
    </div>
  );
}

// ── MODAL NUEVA MESA ─────────────────────────────────────
function ModalNuevaMesa({ mesas, onClose, onConfirm }) {
  const [id, setId] = useState(mesas.length > 0 ? Math.max(...mesas.map(m => m.id)) + 1 : 1);
  const [tipo, setTipo] = useState('Carambola 3B');
  const [tarifa, setTarifa] = useState(80);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title"><i className="ri-add-line" style={{ marginRight: 8 }} />Registrar Nueva Mesa</span>
          <button onClick={onClose} className="btn-icon btn btn-secondary" style={{ background: 'none', border: 'none' }}>
            <i className="ri-close-line" style={{ fontSize: 20 }} />
          </button>
        </div>
        <div className="modal-body">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div className="form-group">
              <label className="form-label">Número de Mesa</label>
              <input type="number" className="form-input" value={id} onChange={e => setId(e.target.value)} />
            </div>

            <div className="form-group">
              <label className="form-label">Tipo de Mesa</label>
              <select className="form-select" value={tipo} onChange={e => setTipo(e.target.value)}>
                <option value="Carambola 3B">Carambola 3B</option>
                <option value="Pool 9B">Pool 9B</option>
                <option value="Snooker">Snooker</option>
              </select>
            </div>

            <div className="form-group">
              <label className="form-label">Tarifa por Hora (MXN)</label>
              <input type="number" className="form-input" value={tarifa} onChange={e => setTarifa(e.target.value)} />
            </div>
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary" onClick={() => onConfirm({ id, tipo, tarifa })}>
            Registrar Mesa
          </button>
        </div>
      </div>
    </div>
  );
}

// ── MODAL FILA VIRTUAL ───────────────────────────────────
function ModalFilaVirtual({ fila, setFila, mesas, onAssign, onClose, showToast }) {
  const [cliente, setCliente] = useState('');
  const [contacto, setContacto] = useState('');
  const [tipo, setTipo] = useState('Carambola 3B');
  const [personas, setPersonas] = useState(2);

  const agregarFila = () => {
    if (!cliente) {
      showToast('Por favor ingrese el nombre del cliente.', 'warning');
      return;
    }
    const nuevo = {
      id: Date.now(),
      cliente,
      contacto: contacto || 'N/A',
      tipo,
      personas: parseInt(personas),
      registro: Date.now(),
    };
    setFila(prev => [...prev, nuevo]);
    setCliente('');
    setContacto('');
    showToast(`${cliente} agregado a la lista de espera.`, 'success');
  };

  const quitarFila = (id) => {
    setFila(prev => prev.filter(f => f.id !== id));
    showToast('Cliente retirado de la lista.', 'info');
  };

  const libres = mesas.filter(m => m.estado === 'libre');

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 620 }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">
            <i className="ri-qr-code-line" style={{ marginRight: 8, color: 'var(--bronze)' }} />
            Fila Virtual / Lista de Espera
          </span>
          <button onClick={onClose} className="btn-icon btn btn-secondary" style={{ background: 'none', border: 'none' }}>
            <i className="ri-close-line" style={{ fontSize: 20 }} />
          </button>
        </div>
        <div className="modal-body" style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 20 }}>
          {/* Panel Izquierdo: Lista */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <h4 style={{ fontSize: 12, textTransform: 'uppercase', color: 'var(--text-secondary)', letterSpacing: '0.05em' }}>Clientes en Espera ({fila.length})</h4>
            {fila.length === 0 ? (
              <p style={{ color: 'var(--text-muted)', fontSize: 13, textAlign: 'center', padding: '40px 0' }}>No hay clientes en espera.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxHeight: 320, overflowY: 'auto', paddingRight: 4 }}>
                {fila.map(f => {
                  const waitTime = Math.floor((Date.now() - f.registro) / 60000);
                  return (
                    <div key={f.id} style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 10, padding: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontWeight: 700, fontSize: 13, color: 'var(--text-primary)' }}>{f.cliente}</span>
                        <span style={{ fontSize: 10, color: 'var(--bronze-light)', fontWeight: 600 }}>Hace {waitTime} min</span>
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                        Mesa: <span style={{ color: 'var(--bronze-light)', fontWeight: 700 }}>{f.tipo}</span> · {f.personas} pers.
                      </div>
                      {f.contacto !== 'N/A' && (
                        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                          <i className="ri-phone-line" style={{ marginRight: 4 }} />{f.contacto}
                        </div>
                      )}
                      <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                        <button 
                          className="btn btn-success btn-sm" 
                          style={{ flex: 1, padding: '4px 8px', fontSize: 10 }}
                          onClick={() => {
                            if (libres.length === 0) {
                              showToast('No hay mesas disponibles en este momento.', 'warning');
                              return;
                            }
                            onAssign(f);
                          }}
                        >
                          Asignar Mesa
                        </button>
                        <button 
                          className="btn btn-danger btn-sm btn-icon sm" 
                          title="Quitar"
                          onClick={() => quitarFila(f.id)}
                        >
                          <i className="ri-delete-bin-line" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Panel Derecho: Formulario */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, borderLeft: '1px solid var(--border)', paddingLeft: 20 }}>
            <h4 style={{ fontSize: 12, textTransform: 'uppercase', color: 'var(--text-secondary)', letterSpacing: '0.05em' }}>Registrar en Espera</h4>
            <div className="form-group">
              <label className="form-label">Nombre del Cliente</label>
              <input className="form-input" placeholder="Nombre completo" value={cliente} onChange={e => setCliente(e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">Teléfono (opcional)</label>
              <input className="form-input" placeholder="Ej: 55-1234-5678" value={contacto} onChange={e => setContacto(e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">Tipo de Mesa</label>
              <select className="form-select" value={tipo} onChange={e => setTipo(e.target.value)}>
                <option value="Carambola 3B">Carambola 3B</option>
                <option value="Pool 9B">Pool 9B</option>
                <option value="Snooker">Snooker</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Personas</label>
              <input type="number" className="form-input" value={personas} onChange={e => setPersonas(e.target.value)} />
            </div>
            <button className="btn btn-primary" style={{ marginTop: 8 }} onClick={agregarFila}>
              Añadir a la Fila
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

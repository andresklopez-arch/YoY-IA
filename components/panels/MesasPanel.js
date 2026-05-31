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
function ModalCerrarMesa({ mesa, cuentasActivas, onClose, onCerrar, onAgregarACuenta }) {
  const [elapsed, setElapsed] = useState(Date.now() - (mesa.inicio || Date.now()));
  const [metodo, setMetodo] = useState('efectivo');
  const [tipoCierre, setTipoCierre] = useState('liquidar'); // 'liquidar' o 'cuenta'
  const [cuentaSeleccionada, setCuentaSeleccionada] = useState('');
  const [nuevoCliente, setNuevoCliente] = useState(mesa.cliente || '');

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
                <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 4 }}>Total de Mesa</div>
                <div style={{ fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 900, color: mesa.socios ? 'var(--success)' : 'var(--text-primary)' }}>
                  {mesa.socios ? 'SOCIO' : `$${costo}`}
                </div>
                {!mesa.socios && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>MXN</div>}
              </div>
            </div>

            {/* Opciones de Cierre */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <button
                className={`btn btn-sm ${tipoCierre === 'liquidar' ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setTipoCierre('liquidar')}
                style={{ flex: 1 }}
              >
                Liquidar Ahora
              </button>
              <button
                className={`btn btn-sm ${tipoCierre === 'cuenta' ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setTipoCierre('cuenta')}
                style={{ flex: 1 }}
              >
                Agregar a Cuenta
              </button>
            </div>

            {/* Panel de Liquidación */}
            {tipoCierre === 'liquidar' ? (
              <>
                <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                  <i className="ri-user-line" style={{ marginRight: 6 }} />
                  {mesa.cliente || 'Público General'}
                </div>

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
              </>
            ) : (
              /* Panel de Agregar a Cuenta */
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div className="form-group">
                  <label className="form-label">Seleccionar Cuenta Activa</label>
                  <select
                    className="form-select"
                    value={cuentaSeleccionada}
                    onChange={e => {
                      setCuentaSeleccionada(e.target.value);
                      if (e.target.value !== '') setNuevoCliente('');
                    }}
                  >
                    <option value="">-- Crear nueva cuenta temporal --</option>
                    {cuentasActivas.map(c => (
                      <option key={c.id} value={c.id}>{c.cliente} (Acumulado: ${c.tiempoJuego + c.consumos.reduce((s,i)=>s+i.precio*i.cantidad,0)} MXN)</option>
                    ))}
                  </select>
                </div>

                {cuentaSeleccionada === '' && (
                  <div className="form-group">
                    <label className="form-label">Nombre del Nuevo Cliente Temporal</label>
                    <input
                      className="form-input"
                      placeholder="Ej: Pedro Domínguez"
                      value={nuevoCliente}
                      onChange={e => setNuevoCliente(e.target.value)}
                    />
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cancelar</button>
          {tipoCierre === 'liquidar' ? (
            <button
              className="btn btn-primary"
              onClick={() => onCerrar({ costo, metodo, tiempo: elapsed })}
              style={{ background: 'linear-gradient(135deg, var(--danger), #ff6b6b)' }}
            >
              <i className="ri-stop-circle-line" /> Cerrar y Cobrar
            </button>
          ) : (
            <button
              className="btn btn-primary"
              onClick={() => onAgregarACuenta({
                costo,
                cuentaId: cuentaSeleccionada,
                nombreNuevo: nuevoCliente || 'Cliente Temporal'
              })}
              style={{ background: 'linear-gradient(135deg, var(--bronze), var(--bronze-light))' }}
            >
              <i className="ri-folder-add-line" /> Guardar en Cuenta
            </button>
          )}
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
  const [modalCuentas, setModalCuentas] = useState(false);
  const [modalAbrirCuenta, setModalAbrirCuenta] = useState(false);
  const [modalCambiarMesa, setModalCambiarMesa] = useState(null);
  const [modalVincular, setModalVincular] = useState(null);
  const [cuentasActivas, setCuentasActivas] = useState([
    { id: 101, cliente: 'Juan Pérez', tiempoJuego: 160, consumos: [{ id: 1, producto: 'Cerveza Corona', precio: 45, cantidad: 2 }, { id: 2, producto: 'Refresco Coca-Cola', precio: 30, cantidad: 1 }], inicio: Date.now() - 1.5*3600000 },
    { id: 102, cliente: 'Marta S.', tiempoJuego: 0, consumos: [{ id: 3, producto: 'Nachos con Queso', precio: 75, cantidad: 1 }], inicio: Date.now() - 40*60000 }
  ]);
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

  const confirmarCambioMesa = (origenId, destinoId) => {
    const mesaOrigen = mesas.find(m => m.id === origenId);
    const mesaDestino = mesas.find(m => m.id === destinoId);

    if (!mesaOrigen || !mesaDestino) {
      showToast('Error en la transferencia de mesas.', 'danger');
      return;
    }

    setMesas(prev => prev.map(m => {
      if (m.id === destinoId) {
        return {
          ...m,
          estado: 'ocupada',
          cliente: mesaOrigen.cliente,
          inicio: mesaOrigen.inicio,
          socios: mesaOrigen.socios,
          filaId: mesaOrigen.filaId
        };
      }
      if (m.id === origenId) {
        return {
          ...m,
          estado: 'libre',
          cliente: null,
          inicio: null,
          socios: false,
          filaId: null
        };
      }
      return m;
    }));

    setModalCambiarMesa(null);
    showToast(`Sesión de juego transferida con éxito de Mesa ${origenId} a Mesa ${destinoId} ✓`, 'success');
  };

  const confirmarVincularCliente = (mesaId, nuevoNombre) => {
    setMesas(prev => prev.map(m => m.id === mesaId
      ? { ...m, cliente: nuevoNombre }
      : m
    ));
    setModalVincular(null);
    showToast(`Cliente de Mesa ${mesaId} actualizado a ${nuevoNombre} ✓`, 'success');
  };

  const agregarSesionACuenta = ({ costo, cuentaId, nombreNuevo }) => {
    if (cuentaId) {
      setCuentasActivas(prev => prev.map(c => c.id === parseInt(cuentaId)
        ? { ...c, tiempoJuego: c.tiempoJuego + costo }
        : c
      ));
      showToast(`Mesa cerrada. Costo de $${costo} MXN agregado a la cuenta del cliente.`, 'success');
    } else {
      const nueva = {
        id: Date.now(),
        cliente: nombreNuevo,
        tiempoJuego: costo,
        consumos: [],
        inicio: Date.now()
      };
      setCuentasActivas(prev => [...prev, nueva]);
      showToast(`Mesa cerrada. Cuenta abierta para ${nombreNuevo} con $${costo} MXN de tiempo.`, 'success');
    }

    setMesas(prev => prev.map(m => m.id === modalCerrar.id
      ? { ...m, estado: 'libre', cliente: null, inicio: null, socios: false }
      : m
    ));

    if (modalCerrar && modalCerrar.filaId) {
      setFila(prev => prev.filter(f => f.id !== modalCerrar.filaId));
    }

    setModalCerrar(null);
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
          <button className="btn btn-secondary btn-sm" style={{ color: 'var(--bronze-light)', borderColor: 'var(--border-bronze)' }} onClick={() => setModalAbrirCuenta(true)}>
            <i className="ri-folder-add-line" /> Abrir Cuenta
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
          { label: 'Cuentas Activas', value: `${cuentasActivas.length} cls`, icon: 'ri-folder-open-line', color: 'icon-bronze', accent: 'var(--bronze-light)', onClick: () => setModalCuentas(true) },
          { label: 'Ingresos en curso', value: `$${ingresosActivos}`, icon: 'ri-coins-line', color: 'icon-blue', accent: 'var(--blue-light)' },
        ].map((s, i) => (
          <div key={i} className="stat-card" style={{ cursor: s.onClick ? 'pointer' : 'default' }} onClick={s.onClick}>
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
                  <>
                    <button className="btn btn-danger btn-sm" style={{ flex: 2 }} onClick={() => setModalCerrar(mesa)}>
                      <i className="ri-stop-fill" /> Cerrar
                    </button>
                    <button
                      className="btn btn-secondary btn-sm btn-icon"
                      title="Cambiar de Mesa"
                      onClick={() => setModalCambiarMesa(mesa)}
                      style={{ color: 'var(--bronze-light)' }}
                    >
                      <i className="ri-swap-line" />
                    </button>
                    <button
                      className="btn btn-secondary btn-sm btn-icon"
                      title="Vincular Cuenta / Agregar Cliente"
                      onClick={() => setModalVincular(mesa)}
                    >
                      <i className="ri-user-add-line" />
                    </button>
                  </>
                )}
                {mesa.estado === 'reservada' && (
                  <button className="btn btn-primary btn-sm" style={{ flex: 1 }} onClick={() => abrirMesa(mesa)}>
                    <i className="ri-play-fill" /> Activar
                  </button>
                )}
                {mesa.estado !== 'ocupada' && (
                  <button
                    className="btn btn-secondary btn-sm btn-icon"
                    title="Cambiar estado"
                    onClick={() => showToast('Función en desarrollo', 'info')}
                  >
                    <i className="ri-more-2-line" />
                  </button>
                )}
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
          cuentasActivas={cuentasActivas}
          onClose={() => setModalCerrar(null)}
          onCerrar={(data) => confirmarCerrarMesa(modalCerrar.id, data)}
          onAgregarACuenta={agregarSesionACuenta}
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
      {modalCuentas && (
        <ModalCuentasActivas
          cuentas={cuentasActivas}
          setCuentas={setCuentasActivas}
          onClose={() => setModalCuentas(false)}
          showToast={showToast}
        />
      )}
      {modalAbrirCuenta && (
        <ModalAbrirCuentaDirecta
          cuentas={cuentasActivas}
          setCuentas={setCuentasActivas}
          onClose={() => setModalAbrirCuenta(false)}
          showToast={showToast}
        />
      )}
      {modalCambiarMesa && (
        <ModalCambiarMesa
          mesa={modalCambiarMesa}
          mesas={mesas}
          onClose={() => setModalCambiarMesa(null)}
          onConfirm={confirmarCambioMesa}
        />
      )}
      {modalVincular && (
        <ModalVincularCliente
          mesa={modalVincular}
          onClose={() => setModalVincular(null)}
          onConfirm={(nombre) => confirmarVincularCliente(modalVincular.id, nombre)}
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

// ── MODAL CUENTAS ACTIVAS ────────────────────────────────
function ModalCuentasActivas({ cuentas, setCuentas, onClose, showToast }) {
  const [cuentaSel, setCuentaSel] = useState(null);
  const [prodSel, setProdSel] = useState('Corona');
  const [cantSel, setCantSel] = useState(1);
  const [metodoPago, setMetodoPago] = useState('efectivo');
  const [showCheckout, setShowCheckout] = useState(false);

  const PRODUCTOS = [
    { producto: 'Cerveza Corona', precio: 45 },
    { producto: 'Refresco Coca-Cola', precio: 30 },
    { producto: 'Nachos con Queso', precio: 75 },
    { producto: 'Papas Fritas', precio: 55 },
    { producto: 'Alitas de Pollo x10', precio: 120 },
    { producto: 'Café Americano', precio: 35 },
    { producto: 'Agua Embotellada', precio: 20 },
  ];

  const agregarConsumo = () => {
    if (!cuentaSel) return;
    const pInfo = PRODUCTOS.find(p => p.producto.includes(prodSel)) || PRODUCTOS[0];
    const nuevoConsumo = {
      id: Date.now(),
      producto: pInfo.producto,
      precio: pInfo.precio,
      cantidad: parseInt(cantSel)
    };

    setCuentas(prev => prev.map(c => {
      if (c.id === cuentaSel.id) {
        const actualizadas = {
          ...c,
          consumos: [...c.consumos, nuevoConsumo]
        };
        setCuentaSel(actualizadas);
        return actualizadas;
      }
      return c;
    }));

    showToast(`Agregado ${cantSel}x ${pInfo.producto} ✓`, 'success');
  };

  const eliminarConsumo = (cId, itemId) => {
    setCuentas(prev => prev.map(c => {
      if (c.id === cId) {
        const actualizadas = {
          ...c,
          consumos: c.consumos.filter(i => i.id !== itemId)
        };
        setCuentaSel(actualizadas);
        return actualizadas;
      }
      return c;
    }));
    showToast('Consumo retirado de la cuenta.', 'info');
  };

  const liquidarCuentaDefinitiva = () => {
    if (!cuentaSel) return;
    setCuentas(prev => prev.filter(c => c.id !== cuentaSel.id));
    showToast(`Cuenta de ${cuentaSel.cliente} liquidada con éxito por $${calcTotal(cuentaSel)} MXN ✓`, 'success');
    setCuentaSel(null);
    setShowCheckout(false);
  };

  const calcTotal = (c) => {
    if (!c) return 0;
    const tConsumos = c.consumos.reduce((s, i) => s + (i.precio * i.cantidad), 0);
    return c.tiempoJuego + tConsumos;
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: cuentaSel ? 760 : 500 }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">
            <i className="ri-folder-open-line" style={{ marginRight: 8, color: 'var(--bronze-light)' }} />
            Cuentas Activas de Clientes
          </span>
          <button onClick={onClose} className="btn-icon btn btn-secondary" style={{ background: 'none', border: 'none' }}>
            <i className="ri-close-line" style={{ fontSize: 20 }} />
          </button>
        </div>
        <div className="modal-body" style={{ display: 'grid', gridTemplateColumns: cuentaSel ? '1.1fr 1.3fr' : '1fr', gap: 20 }}>
          {/* Panel Izquierdo: Lista de cuentas abiertas */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <h4 style={{ fontSize: 12, textTransform: 'uppercase', color: 'var(--text-secondary)' }}>Cuentas Abiertas</h4>
            {cuentas.length === 0 ? (
              <p style={{ color: 'var(--text-muted)', fontSize: 13, textAlign: 'center', padding: '40px 0' }}>No hay cuentas pendientes.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 380, overflowY: 'auto' }}>
                {cuentas.map(c => (
                  <div
                    key={c.id}
                    onClick={() => { setCuentaSel(c); setShowCheckout(false); }}
                    style={{
                      background: cuentaSel?.id === c.id ? 'var(--bronze-subtle)' : 'var(--bg-elevated)',
                      border: `1px solid ${cuentaSel?.id === c.id ? 'var(--border-bronze)' : 'var(--border)'}`,
                      borderRadius: 10, padding: 12, cursor: 'pointer', transition: 'all 0.15s'
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: 13 }}>
                      <span>{c.cliente}</span>
                      <span style={{ color: 'var(--bronze-light)' }}>${calcTotal(c)} MXN</span>
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 4, display: 'flex', justifyContent: 'space-between' }}>
                      <span>Juego: ${c.tiempoJuego} MXN</span>
                      <span>{c.consumos.length} consumos</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Panel Derecho: Detalle de la cuenta seleccionada */}
          {cuentaSel && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14, borderLeft: '1px solid var(--border)', paddingLeft: 20 }}>
              {!showCheckout ? (
                <>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <h3 style={{ fontSize: 16, fontWeight: 800, color: 'var(--text-primary)' }}>Detalle de {cuentaSel.cliente}</h3>
                    <span className="badge badge-bronze">Cuenta Activa</span>
                  </div>

                  {/* Consumos */}
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 220, overflowY: 'auto' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-muted)', borderBottom: '1px solid var(--border)', pb: 4 }}>
                      <span>TIEMPO DE JUEGO ACUMULADO</span>
                      <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>${cuentaSel.tiempoJuego} MXN</span>
                    </div>

                    {cuentaSel.consumos.length === 0 ? (
                      <p style={{ color: 'var(--text-muted)', fontSize: 12, padding: '10px 0' }}>Sin consumos extras.</p>
                    ) : (
                      cuentaSel.consumos.map(item => (
                        <div key={item.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12 }}>
                          <span style={{ flex: 1 }}>{item.cantidad}x {item.producto} <span style={{ color: 'var(--text-muted)' }}>(${item.precio})</span></span>
                          <span style={{ fontWeight: 700, marginRight: 10 }}>${item.precio * item.cantidad} MXN</span>
                          <button
                            className="btn btn-secondary btn-icon sm"
                            onClick={() => eliminarConsumo(cuentaSel.id, item.id)}
                            style={{ padding: 4, height: 24, width: 24, border: 'none', background: 'none', color: 'var(--danger)' }}
                            title="Quitar"
                          >
                            <i className="ri-close-fill" />
                          </button>
                        </div>
                      ))
                    )}
                  </div>

                  {/* Agregar Consumo */}
                  <div style={{ background: 'var(--bg-elevated)', borderRadius: 10, padding: 10, display: 'grid', gridTemplateColumns: '2fr 1fr auto', gap: 6, alignItems: 'end' }}>
                    <div className="form-group" style={{ gap: 4 }}>
                      <label className="form-label" style={{ fontSize: 9 }}>Producto</label>
                      <select className="form-select" style={{ padding: '6px 8px', fontSize: 12 }} value={prodSel} onChange={e => setProdSel(e.target.value)}>
                        {PRODUCTOS.map((p, i) => <option key={i} value={p.producto}>{p.producto} (${p.precio})</option>)}
                      </select>
                    </div>
                    <div className="form-group" style={{ gap: 4 }}>
                      <label className="form-label" style={{ fontSize: 9 }}>Cant.</label>
                      <input type="number" className="form-input" style={{ padding: '6px 8px', fontSize: 12 }} value={cantSel} onChange={e => setCantSel(e.target.value)} min={1} />
                    </div>
                    <button className="btn btn-primary btn-sm" style={{ padding: '8px 12px' }} onClick={agregarConsumo}>
                      Agregar
                    </button>
                  </div>

                  {/* Footer detalle */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid var(--border)', pt: 10 }}>
                    <div>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>GRAN TOTAL ACUMULADO</div>
                      <div style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 900, color: 'var(--bronze-light)' }}>${calcTotal(cuentaSel)} MXN</div>
                    </div>
                    <button className="btn btn-primary" onClick={() => setShowCheckout(true)} style={{ background: 'linear-gradient(135deg, var(--success), #2ed573)', color: '#0d0d0f' }}>
                      <i className="ri-money-dollar-box-line" /> Cobrar Cuenta
                    </button>
                  </div>
                </>
              ) : (
                /* Detalle Checkout */
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <button className="btn btn-secondary btn-icon sm" onClick={() => setShowCheckout(false)} style={{ border: 'none', background: 'none' }}>
                      <i className="ri-arrow-left-line" style={{ fontSize: 18 }} />
                    </button>
                    <h3 style={{ fontSize: 16, fontWeight: 800 }}>Liquidar Cuenta: {cuentaSel.cliente}</h3>
                  </div>

                  <div style={{ background: 'var(--bg-elevated)', padding: 14, borderRadius: 10 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border)', pb: 6, fontSize: 12 }}>
                      <span>Tiempo de Juego</span>
                      <span>${cuentaSel.tiempoJuego} MXN</span>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, mt: 6, borderBottom: '1px solid var(--border)', pb: 6 }}>
                      {cuentaSel.consumos.map(item => (
                        <div key={item.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-secondary)' }}>
                          <span>{item.cantidad}x {item.producto}</span>
                          <span>${item.precio * item.cantidad} MXN</span>
                        </div>
                      ))}
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', mt: 8, fontWeight: 900, fontSize: 16 }}>
                      <span>Total Neto</span>
                      <span style={{ color: 'var(--bronze-light)' }}>${calcTotal(cuentaSel)} MXN</span>
                    </div>
                  </div>

                  {/* Método */}
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
                          onClick={() => setMetodoPago(m.id)}
                          style={{
                            background: metodoPago === m.id ? 'var(--bronze-subtle)' : 'var(--bg-elevated)',
                            border: `1px solid ${metodoPago === m.id ? 'var(--border-bronze)' : 'var(--border)'}`,
                            borderRadius: 10, padding: '8px 4px', cursor: 'pointer',
                            color: metodoPago === m.id ? 'var(--bronze-light)' : 'var(--text-secondary)',
                            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
                            fontSize: 10, fontWeight: 600,
                          }}
                        >
                          <i className={m.icon} style={{ fontSize: 16 }} />
                          {m.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <button className="btn btn-primary btn-lg" onClick={liquidarCuentaDefinitiva} style={{ background: 'linear-gradient(135deg, var(--success), #2ed573)', color: '#0d0d0f', width: '100%', mt: 6 }}>
                    <i className="ri-checkbox-circle-line" /> Confirmar Cobro e Impresión
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── MODAL ABRIR CUENTA DIRECTA ───────────────────────────
function ModalAbrirCuentaDirecta({ cuentas, setCuentas, onClose, showToast }) {
  const [cliente, setCliente] = useState('');

  const handleCrear = () => {
    if (!cliente) {
      showToast('Por favor ingrese el nombre del cliente.', 'warning');
      return;
    }
    const nueva = {
      id: Date.now(),
      cliente,
      tiempoJuego: 0,
      consumos: [],
      inicio: Date.now()
    };
    setCuentas(prev => [...prev, nueva]);
    showToast(`Cuenta creada para ${cliente} ✓`, 'success');
    onClose();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title"><i className="ri-folder-add-line" style={{ marginRight: 8 }} />Abrir Cuenta Activa</span>
          <button onClick={onClose} className="btn-icon btn btn-secondary" style={{ background: 'none', border: 'none' }}>
            <i className="ri-close-line" style={{ fontSize: 20 }} />
          </button>
        </div>
        <div className="modal-body">
          <div className="form-group">
            <label className="form-label">Nombre del Cliente</label>
            <input className="form-input" placeholder="Ej: Juan Pérez" value={cliente} onChange={e => setCliente(e.target.value)} />
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary" onClick={handleCrear}>
            Abrir Cuenta
          </button>
        </div>
      </div>
    </div>
  );
}

// ── MODAL CAMBIAR MESA ───────────────────────────────────
function ModalCambiarMesa({ mesa, mesas, onClose, onConfirm }) {
  const [destino, setDestino] = useState('');
  const libres = mesas.filter(m => m.estado === 'libre');

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title"><i className="ri-swap-line" style={{ marginRight: 8 }} />Cambiar Mesa de Sesión</span>
          <button onClick={onClose} className="btn-icon btn btn-secondary" style={{ background: 'none', border: 'none' }}>
            <i className="ri-close-line" style={{ fontSize: 20 }} />
          </button>
        </div>
        <div className="modal-body">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ padding: 12, background: 'var(--bg-elevated)', borderRadius: 10, border: '1px solid var(--border)' }}>
              <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>MESA DE ORIGEN SELECCIONADA</div>
              <div style={{ fontWeight: 700, fontSize: 14 }}>{mesa.nombre} (Ocupada por {mesa.cliente})</div>
            </div>

            <div className="form-group">
              <label className="form-label">Seleccionar Mesa Destino Disponible</label>
              {libres.length === 0 ? (
                <p style={{ color: 'var(--danger)', fontSize: 13, fontWeight: 600 }}>No hay mesas libres disponibles en este momento.</p>
              ) : (
                <select className="form-select" value={destino} onChange={e => setDestino(e.target.value)}>
                  <option value="">-- Seleccionar Mesa Libre --</option>
                  {libres.map(m => (
                    <option key={m.id} value={m.id}>{m.nombre} ({m.tipo} · ${m.tarifa}/hr)</option>
                  ))}
                </select>
              )}
            </div>
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cancelar</button>
          <button 
            className="btn btn-primary" 
            onClick={() => onConfirm(mesa.id, parseInt(destino))}
            disabled={!destino}
          >
            Confirmar Cambio
          </button>
        </div>
      </div>
    </div>
  );
}

// ── MODAL VINCULAR CLIENTE ───────────────────────────────
function ModalVincularCliente({ mesa, onClose, onConfirm }) {
  const [nombre, setNombre] = useState(mesa.cliente || '');

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title"><i className="ri-user-add-line" style={{ marginRight: 8 }} />Asignar Cliente / Editar Nombre</span>
          <button onClick={onClose} className="btn-icon btn btn-secondary" style={{ background: 'none', border: 'none' }}>
            <i className="ri-close-line" style={{ fontSize: 20 }} />
          </button>
        </div>
        <div className="modal-body">
          <div className="form-group">
            <label className="form-label">Nombre del Cliente de Mesa {mesa.id}</label>
            <input className="form-input" placeholder="Nombre completo" value={nombre} onChange={e => setNombre(e.target.value)} />
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary" onClick={() => onConfirm(nombre)}>
            Guardar Cliente
          </button>
        </div>
      </div>
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

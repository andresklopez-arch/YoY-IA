'use client';
import { useState, useEffect } from 'react';
import { db } from '@/lib/firebase';
import { doc, onSnapshot } from 'firebase/firestore';

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

const hashPassword = (pwd) => {
  if (!pwd) return '';
  let hash = 0;
  for (let i = 0; i < pwd.length; i++) {
    hash = (hash << 5) - hash + pwd.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(16);
};

export default function CajaPanel({ showToast }) {
  const [isAdminUnlocked, setIsAdminUnlocked] = useState(false);
  const [adminPassword, setAdminPassword] = useState('');
  const [adminPinHash, setAdminPinHash] = useState('170842'); // Hash of '1234'
  const [cobros, setCobros] = useState(TRANSACCIONES);
  const [mostrarCobroManual, setMostrarCobroManual] = useState(false);
  const [nuevoMonto, setNuevoMonto] = useState('');
  const [nuevaDesc, setNuevaDesc] = useState('');
  const [nuevoMetodo, setNuevoMetodo] = useState('efectivo');
  const [pinAutorizacion, setPinAutorizacion] = useState('');

  const [mostrarCorte, setMostrarCorte] = useState(false);
  const [cantidades, setCantidades] = useState({
    1000: '', 500: '', 200: '', 100: '', 50: '', 20: '', 10: '', 5: '', 2: '', 1: '', 0.5: ''
  });

  // Modo Kiosco (Pantalla completa)
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Cola de impresión térmica
  const [colaImpresion, setColaImpresion] = useState([
    { id: 1, hora: '14:31', tipo: 'caja', detalle: 'Ticket de Venta #1024 (Mesa 2) - $120', estado: 'Impreso ✓' },
    { id: 2, hora: '13:16', tipo: 'cocina', detalle: 'Comanda Cocina #882 (Nachos + Alitas) - Mesa 7', estado: 'Impreso ✓' },
    { id: 3, hora: '13:15', tipo: 'barra', detalle: 'Comanda Barra #881 (4 Coronas) - Mesa 7', estado: 'Impreso ✓' }
  ]);

  // Escuchar PIN de Administrador desde Firestore
  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'config', 'seguridad'), snap => {
      if (snap.exists() && snap.data().adminPinHash) {
        const hash = snap.data().adminPinHash;
        setAdminPinHash(hash);
        localStorage.setItem('yoy_admin_pin_hash', hash);
      } else {
        if (typeof window !== 'undefined') {
          const localHash = localStorage.getItem('yoy_admin_pin_hash');
          if (localHash) setAdminPinHash(localHash);
        }
      }
    }, err => {
      console.warn("Firestore seguridad sync error (offline fallback):", err);
      if (typeof window !== 'undefined') {
        const localHash = localStorage.getItem('yoy_admin_pin_hash');
        if (localHash) setAdminPinHash(localHash);
      }
    });
    return unsub;
  }, []);

  // Cargar borrador de corte de caja en mount
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const draft = localStorage.getItem('yoy_caja_corte_draft');
      if (draft) {
        try {
          setCantidades(JSON.parse(draft));
        } catch (e) {
          console.error(e);
        }
      }
    }

    const handleFsChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFsChange);
    return () => document.removeEventListener('fullscreenchange', handleFsChange);
  }, []);

  const handleCantidadChange = (den, val) => {
    const updated = { ...cantidades, [den]: val };
    setCantidades(updated);
    localStorage.setItem('yoy_caja_corte_draft', JSON.stringify(updated));
  };

  const totalHoy = cobros.filter(t => t.monto > 0).reduce((s, t) => s + t.monto, 0);
  const totalGastos = Math.abs(cobros.filter(t => t.monto < 0).reduce((s, t) => s + t.monto, 0));
  const utilidad = totalHoy - totalGastos;

  const totalEfectivoEsperado = cobros.filter(t => t.metodo === 'efectivo').reduce((s, t) => s + t.monto, 0);
  const sumaContada = Object.keys(cantidades).reduce((acc, val) => {
    const qty = parseInt(cantidades[val]) || 0;
    return acc + (parseFloat(val) * qty);
  }, 0);
  const diferencia = sumaContada - totalEfectivoEsperado;

  const handleUnlockAdmin = () => {
    if (hashPassword(adminPassword) === adminPinHash) {
      setIsAdminUnlocked(true);
      showToast('Acceso administrador autorizado', 'success');
      setAdminPassword('');
    } else {
      showToast('Contraseña incorrecta', 'danger');
    }
  };

  const registrarCobro = () => {
    if (!nuevoMonto || !nuevaDesc) { showToast('Completa todos los campos', 'warning'); return; }
    if (hashPassword(pinAutorizacion) !== adminPinHash) {
      showToast('PIN de autorización incorrecto', 'danger');
      return;
    }
    const monto = parseFloat(nuevoMonto);
    setCobros(prev => [{
      id: Date.now(),
      tipo: 'manual',
      descripcion: nuevaDesc,
      cliente: 'Manual (Autorizado)',
      monto: monto,
      metodo: nuevoMetodo,
      hora: new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }),
      color: monto > 0 ? 'var(--success)' : 'var(--danger)',
    }, ...prev]);
    showToast(`Cobro de $${monto} registrado`, 'success');

    // Registrar comanda simulada en la cola de impresión
    triggerSimulatedPrint('caja', `Ticket de Venta (Manual) - $${monto}`);

    setMostrarCobroManual(false);
    setNuevoMonto(''); setNuevaDesc(''); setPinAutorizacion('');
  };

  const guardarCorteCaja = () => {
    setCobros(prev => [{
      id: Date.now(),
      tipo: 'corte',
      descripcion: `Corte de Caja (Contado: $${sumaContada.toLocaleString()} - Esperado: $${totalEfectivoEsperado.toLocaleString()})`,
      cliente: 'Administrador',
      monto: diferencia,
      metodo: 'efectivo',
      hora: new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }),
      color: diferencia >= 0 ? 'var(--success)' : 'var(--danger)',
    }, ...prev]);

    showToast(`Corte registrado. Diferencia: $${diferencia.toLocaleString()}`, diferencia >= 0 ? 'success' : 'danger');
    triggerSimulatedPrint('caja', `Reporte de Corte de Caja - Diferencia: $${diferencia}`);
    setMostrarCorte(false);
    localStorage.removeItem('yoy_caja_corte_draft');
    setCantidades({
      1000: '', 500: '', 200: '', 100: '', 50: '', 20: '', 10: '', 5: '', 2: '', 1: '', 0.5: ''
    });
  };

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().then(() => {
        setIsFullscreen(true);
      }).catch((err) => {
        showToast('Error al activar modo kiosco', 'error');
      });
    } else {
      document.exitFullscreen();
      setIsFullscreen(false);
    }
  };

  const triggerSimulatedPrint = (tipo, detalle) => {
    const nuevoPrint = {
      id: Date.now(),
      hora: new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }),
      tipo,
      detalle,
      estado: 'Enviando...'
    };
    setColaImpresion(prev => [nuevoPrint, ...prev]);

    setTimeout(() => {
      setColaImpresion(prev => prev.map(p => p.id === nuevoPrint.id ? { ...p, estado: 'Impreso ✓' } : p));
      showToast(`Ticket impreso correctamente en impresora ${tipo.toUpperCase()}`, 'success');
    }, 1200);
  };

  return (
    <div style={{ minHeight: isFullscreen ? '100vh' : 'auto', padding: isFullscreen ? '20px' : '0', background: isFullscreen ? 'var(--bg-main)' : 'transparent' }}>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 className="page-title gradient-bronze">Caja y POS</h1>
          <p className="page-subtitle">Corte del día · Turno actual · {isFullscreen ? 'Modo Kiosco Activo' : 'Modo Estándar'}</p>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          {/* Botón de Modo Kiosco */}
          <button className="btn btn-secondary btn-sm" onClick={toggleFullscreen} title="Activar Modo Kiosco">
            <i className={isFullscreen ? 'ri-fullscreen-exit-fill' : 'ri-fullscreen-fill'} style={{ marginRight: 4 }} />
            {isFullscreen ? 'Salir Kiosco' : 'Modo Kiosco'}
          </button>
          {isAdminUnlocked && (
            <>
              <button className="btn btn-secondary btn-sm" onClick={() => setMostrarCorte(true)}>
                <i className="ri-file-list-3-line" /> Corte de Caja
              </button>
              <button className="btn btn-primary btn-sm" onClick={() => setMostrarCobroManual(true)}>
                <i className="ri-add-circle-line" /> Cobro Manual
              </button>
            </>
          )}
        </div>
      </div>

      {!isAdminUnlocked ? (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '60px 20px', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 16, marginTop: 20 }}>
          <i className="ri-lock-password-line" style={{ fontSize: 48, color: 'var(--bronze-light)', marginBottom: 16 }} />
          <h2 style={{ fontSize: 18, fontWeight: 900, color: '#fff', marginBottom: 8 }}>🔐 Información Financiera Protegida</h2>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', textAlign: 'center', maxWidth: 360, marginBottom: 20 }}>
            Ingresa la contraseña de administrador para ver ingresos, egresos, movimientos y realizar cortes de caja.
          </p>
          <div style={{ display: 'flex', gap: 10, width: '100%', maxWidth: 300 }}>
            <input
              type="password"
              className="form-input"
              placeholder="Contraseña (Default: 1234)"
              value={adminPassword}
              onChange={e => setAdminPassword(e.target.value)}
              style={{ textAlign: 'center' }}
              onKeyDown={e => { if (e.key === 'Enter') handleUnlockAdmin(); }}
            />
            <button className="btn btn-primary" onClick={handleUnlockAdmin}>Desbloquear</button>
          </div>
        </div>
      ) : (
        <>
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
              const subtotal = cobros.filter(t => m.metodo === 'efectivo' ? (t.metodo === m.metodo && t.tipo !== 'corte') : (t.metodo === m.metodo)).reduce((s, t) => s + t.monto, 0);
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

          {/* Cola de Impresión Térmica */}
          <div className="card" style={{ marginBottom: 24 }}>
            <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <div>
                <h3 className="card-title"><i className="ri-printer-line" style={{ marginRight: 6 }} />Historial de Colas de Impresión (Red/USB)</h3>
                <p style={{ fontSize: 10, color: 'var(--text-muted)', margin: 0 }}>Simulador de envío de tickets directos a comandas de cocina y barra</p>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button className="btn btn-secondary btn-xs" onClick={() => triggerSimulatedPrint('caja', 'Ticket de Prueba - Impresora Caja')}>Test Caja</button>
                <button className="btn btn-secondary btn-xs" onClick={() => triggerSimulatedPrint('cocina', 'Comanda de Prueba - Impresora Cocina')}>Test Cocina</button>
                <button className="btn btn-secondary btn-xs" onClick={() => triggerSimulatedPrint('barra', 'Comanda de Prueba - Impresora Barra')}>Test Barra</button>
              </div>
            </div>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 150, overflowY: 'auto' }}>
              {colaImpresion.map(p => (
                <div key={p.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', background: 'rgba(255,255,255,0.01)', border: '1px solid var(--border)', borderRadius: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ width: 26, height: 26, borderRadius: 6, background: 'var(--bg-elevated)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, color: 'var(--bronze-light)' }}>
                      <i className="ri-printer-line" />
                    </div>
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 700 }}>{p.detalle}</div>
                      <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>Tipo: {p.tipo.toUpperCase()} · {p.hora}</span>
                    </div>
                  </div>
                  <span className={`badge ${p.estado.includes('Impreso') ? 'badge-success' : 'badge-warning'}`} style={{ fontSize: 9 }}>
                    {p.estado}
                  </span>
                </div>
              ))}
            </div>
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
                    <tr key={t.id} style={{ background: t.tipo === 'corte' ? 'rgba(205,127,50,0.05)' : 'none' }}>
                      <td style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-display)', fontSize: 12 }}>{t.hora}</td>
                      <td style={{ fontWeight: 600 }}>
                        {t.tipo === 'corte' ? '📋 ' : ''}{t.descripcion}
                      </td>
                      <td style={{ color: 'var(--text-secondary)' }}>{t.cliente}</td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <i className={METODO_ICONS[t.metodo] || 'ri-cash-line'} style={{ fontSize: 14, color: 'var(--text-muted)' }} />
                          <span style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'capitalize' }}>{t.metodo}</span>
                        </div>
                      </td>
                      <td style={{ textAlign: 'right', fontFamily: 'var(--font-display)', fontSize: 15, fontWeight: 700, color: t.color }}>
                        {t.monto > 0 ? '+' : ''}${t.monto.toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

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
                <div className="form-group" style={{ borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: 12 }}>
                  <label className="form-label" style={{ color: 'var(--bronze-light)', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <i className="ri-shield-user-line" /> Contraseña de Autorización Admin
                  </label>
                  <input
                    className="form-input"
                    type="password"
                    placeholder="Ingrese PIN (1234)"
                    value={pinAutorizacion}
                    onChange={e => setPinAutorizacion(e.target.value)}
                    style={{ borderColor: 'var(--border-bronze)' }}
                  />
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

      {/* Modal Corte de Caja por Denominaciones */}
      {mostrarCorte && (
        <div className="modal-overlay" onClick={() => setMostrarCorte(false)}>
          <div className="modal" style={{ maxWidth: 500 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">📋 Corte de Caja interactivo</span>
              <button onClick={() => setMostrarCorte(false)} style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 20 }}>✕</button>
            </div>
            <div className="modal-body" style={{ maxHeight: '70vh', overflowY: 'auto' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
                {/* Billetes */}
                <div>
                  <h4 style={{ fontSize: 13, color: 'var(--bronze-light)', marginBottom: 10, textTransform: 'uppercase', fontWeight: 800 }}>Billetes</h4>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {[1000, 500, 200, 100, 50, 20].map(den => (
                      <div key={den} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'rgba(255,255,255,0.02)', padding: '6px 12px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.04)' }}>
                        <span style={{ fontSize: 13, fontWeight: 700 }}>${den}</span>
                        <input
                          type="number"
                          className="form-input"
                          style={{ width: 80, padding: '4px 8px', fontSize: 12, textAlign: 'right' }}
                          placeholder="0"
                          value={cantidades[den]}
                          onChange={e => handleCantidadChange(den, e.target.value)}
                        />
                      </div>
                    ))}
                  </div>
                </div>

                {/* Monedas */}
                <div>
                  <h4 style={{ fontSize: 13, color: 'var(--bronze-light)', marginBottom: 10, textTransform: 'uppercase', fontWeight: 800 }}>Monedas</h4>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {[10, 5, 2, 1, 0.5].map(den => (
                      <div key={den} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'rgba(255,255,255,0.02)', padding: '6px 12px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.04)' }}>
                        <span style={{ fontSize: 13, fontWeight: 700 }}>${den.toFixed(2)}</span>
                        <input
                          type="number"
                          className="form-input"
                          style={{ width: 80, padding: '4px 8px', fontSize: 12, textAlign: 'right' }}
                          placeholder="0"
                          value={cantidades[den]}
                          onChange={e => handleCantidadChange(den, e.target.value)}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 12, padding: 14, marginTop: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: 13 }}>
                  <span style={{ color: 'var(--text-secondary)' }}>Efectivo Esperado:</span>
                  <strong style={{ color: '#fff' }}>${totalEfectivoEsperado.toLocaleString()}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: 13 }}>
                  <span style={{ color: 'var(--text-secondary)' }}>Efectivo Real Contado:</span>
                  <strong style={{ color: 'var(--bronze-light)' }}>${sumaContada.toLocaleString()}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: 6, fontSize: 14 }}>
                  <span style={{ fontWeight: 800, color: 'var(--text-main)' }}>Diferencia:</span>
                  <strong style={{ color: diferencia === 0 ? 'var(--success)' : diferencia > 0 ? 'var(--warning)' : 'var(--danger)' }}>
                    {diferencia >= 0 ? '+' : ''}${diferencia.toLocaleString()}
                  </strong>
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setMostrarCorte(false)}>Cancelar</button>
              <button className="btn btn-primary" onClick={guardarCorteCaja}>Guardar y Cerrar Corte</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

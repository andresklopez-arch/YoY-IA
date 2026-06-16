'use client';
import { useState } from 'react';
import { db } from '@/lib/firebase';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { useAuth } from '@/lib/auth-context';

function MiniPulse({ value, max, color }) {
  const pct = Math.min(100, (value / max) * 100);
  return (
    <div style={{ height: 4, background: 'var(--bg-elevated)', borderRadius: 2, overflow: 'hidden', marginTop: 6 }}>
      <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 2, transition: 'width 0.5s ease' }} />
    </div>
  );
}

export default function DashboardPanel({ showToast, onNavigate }) {
  const { user } = useAuth();
  const [mesasVivas] = useState([]);

  // Estados para Registro de Gasto
  const [mostrarModalGasto, setMostrarModalGasto] = useState(false);
  const [tipoGasto, setTipoGasto] = useState('mantenimiento');
  const [montoGasto, setMontoGasto] = useState('');
  const [descGasto, setDescGasto] = useState('');
  const [fechaGasto, setFechaGasto] = useState(new Date().toISOString().substring(0, 10));
  const [metodoPagoGasto, setMetodoPagoGasto] = useState('efectivo');
  const [guardandoGasto, setGuardandoGasto] = useState(false);

  const handleGuardarGasto = async (e) => {
    e.preventDefault();
    if (!montoGasto || !descGasto) {
      showToast('Por favor completa los campos obligatorios', 'danger');
      return;
    }
    setGuardandoGasto(true);
    try {
      await addDoc(collection(db, 'gastos'), {
        categoria: tipoGasto,
        monto: Number(montoGasto),
        concepto: descGasto,
        descripcion: descGasto,
        detalle: descGasto,
        fecha: new Date(fechaGasto + 'T12:00:00').toISOString(),
        metodoPago: metodoPagoGasto,
        operador: user ? (user.name || user.alias || user.email) : 'Sistema',
        rolOperador: user ? (user.role || 'staff') : 'sistema',
        createdAt: serverTimestamp()
      });
      
      await addDoc(collection(db, 'bitacora'), {
        accion: 'Gasto Registrado',
        detalle: `${tipoGasto.toUpperCase()}: ${descGasto} - Monto: $${montoGasto}`,
        monto: -Number(montoGasto),
        operador: user ? (user.name || user.alias || user.email) : 'Sistema',
        rolOperador: user ? (user.role || 'staff') : 'sistema',
        fecha: new Date().toISOString(),
        tipo: 'egreso'
      });

      showToast('¡Gasto registrado con éxito! 💸', 'success');
      setMostrarModalGasto(false);
      setMontoGasto('');
      setDescGasto('');
    } catch (err) {
      console.error(err);
      showToast('Error al guardar el gasto: ' + err.message, 'danger');
    } finally {
      setGuardandoGasto(false);
    }
  };

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
            { label: 'Registrar Gasto', icon: 'ri-arrow-down-circle-line', color: 'var(--danger)', action: 'gasto' },
            { label: 'Configurar', icon: 'ri-settings-4-line', color: 'var(--text-muted)', nav: 'config' },
          ].map((a, i) => (
            <button
              key={i}
              onClick={() => a.action === 'gasto' ? setMostrarModalGasto(true) : onNavigate(a.nav)}
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

      {/* MODAL REGISTRO DE GASTO OPERATIVO */}
      {mostrarModalGasto && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999
        }}>
          <div className="card animate-fadeIn" style={{ width: 450, padding: 20, background: 'var(--bg-card)', border: '1px solid var(--border-bronze)', boxShadow: 'var(--shadow-bronze)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border)', paddingBottom: 10, marginBottom: 15 }}>
              <span style={{ fontSize: 11, fontWeight: 800, color: 'var(--bronze-light)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                <i className="ri-arrow-down-circle-line" style={{ marginRight: 6 }} />
                Registrar Gasto / Mantenimiento
              </span>
              <button onClick={() => setMostrarModalGasto(false)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}>
                <i className="ri-close-line" style={{ fontSize: 18 }} />
              </button>
            </div>
            
            <form onSubmit={handleGuardarGasto} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase' }}>Concepto / Tipo de Servicio:</label>
                <select
                  value={tipoGasto}
                  onChange={e => setTipoGasto(e.target.value)}
                  className="form-select"
                  style={{ width: '100%', height: 36, background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 8, color: '#fff', fontSize: 12, padding: '0 8px' }}
                >
                  <option value="mantenimiento">Mantenimiento de Mesas & Paños</option>
                  <option value="renta">Renta del Local</option>
                  <option value="energia">Energía Eléctrica (CFE)</option>
                  <option value="agua">Agua Potable</option>
                  <option value="internet">Internet, Telefonía & WiFi</option>
                  <option value="limpieza">Artículos de Limpieza & Sanitarios</option>
                  <option value="musica">Música & Audio (Licencia Autores/Lectores)</option>
                  <option value="fumigacion">Control de Plagas & Fumigación</option>
                  <option value="seguridad">Seguridad, Monitoreo & Vigilancia</option>
                  <option value="publicidad">Publicidad, Redes & Marketing</option>
                  <option value="insumos">Insumos de Alimentos & Bebidas (Caja)</option>
                  <option value="papeleria">Papelería, Tickets & Suministros</option>
                  <option value="seguros">Seguro de Local contra Siniestros</option>
                  <option value="banco">Comisiones Bancarias (Terminal TPV)</option>
                  <option value="otros">Otros Gastos Operativos</option>
                </select>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <label style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase' }}>Monto ($):</label>
                  <input
                    type="number"
                    min="0.01"
                    step="0.01"
                    required
                    value={montoGasto}
                    onChange={e => setMontoGasto(e.target.value)}
                    placeholder="0.00"
                    style={{ width: '100%', height: 36, background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 8, color: '#fff', fontSize: 12, padding: '0 8px' }}
                  />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <label style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase' }}>Fecha de Pago:</label>
                  <input
                    type="date"
                    required
                    value={fechaGasto}
                    onChange={e => setFechaGasto(e.target.value)}
                    style={{ width: '100%', height: 36, background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 8, color: '#fff', fontSize: 12, padding: '0 8px' }}
                  />
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase' }}>Método de Pago:</label>
                <select
                  value={metodoPagoGasto}
                  onChange={e => setMetodoPagoGasto(e.target.value)}
                  className="form-select"
                  style={{ width: '100%', height: 36, background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 8, color: '#fff', fontSize: 12, padding: '0 8px' }}
                >
                  <option value="efectivo">Efectivo (Caja Chica)</option>
                  <option value="transferencia">Transferencia Electrónica / SPEI</option>
                  <option value="tarjeta">Tarjeta de Crédito / Débito</option>
                </select>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase' }}>Detalle / Concepto:</label>
                <textarea
                  required
                  rows="3"
                  value={descGasto}
                  onChange={e => setDescGasto(e.target.value)}
                  placeholder="Ej: Pago de recibo CFE periodo Mayo-Junio o Pulido de bolas Aramith..."
                  style={{ width: '100%', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 8, color: '#fff', fontSize: 12, padding: 8, resize: 'none' }}
                />
              </div>

              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 10 }}>
                <button
                  type="button"
                  onClick={() => setMostrarModalGasto(false)}
                  className="btn btn-secondary btn-sm"
                  style={{ height: 34, padding: '0 15px' }}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={guardandoGasto}
                  className="btn btn-primary btn-sm"
                  style={{ height: 34, padding: '0 15px' }}
                >
                  {guardandoGasto ? 'Guardando...' : 'Guardar Gasto'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

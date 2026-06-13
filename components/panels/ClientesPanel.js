'use client';
import { useState, useEffect } from 'react';
import { obfuscate, deobfuscate } from '@/lib/crypto';

const INIT_CLIENTES = [];

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
  const [tabActiva, setTabActiva] = useState('listado'); // 'listado' o 'analisis'
  const [showReporteCRM, setShowReporteCRM] = useState(false);

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
    const term = busqueda.toLowerCase();
    const busOk = !busqueda || 
      c.nombre.toLowerCase().includes(term) ||
      (c.telefono && c.telefono.includes(term)) ||
      (c.codigo && c.codigo.toLowerCase().includes(term));
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
    const nextNum = 1000 + clientes.length + 1;
    const codigo = `YOY-2026-${nextNum}`;

    const nuevo = {
      id: Date.now(),
      codigo,
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
          <button className="btn btn-secondary btn-sm" style={{ color: 'var(--bronze-light)', borderColor: 'var(--border-bronze)' }} onClick={() => setShowReporteCRM(true)}>
            <i className="ri-file-text-line" /> Reporte CRM
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

      {/* Tabs de Secciones */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        <button className={`btn btn-sm ${tabActiva === 'listado' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setTabActiva('listado')}>
          <i className="ri-team-line" /> Listado de Clientes
        </button>
        <button className={`btn btn-sm ${tabActiva === 'analisis' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setTabActiva('analisis')}>
          <i className="ri-robot-line" /> Analizador de Clientes IA
        </button>
      </div>

      {tabActiva === 'listado' ? (
        <>
          {/* Filtros */}
          <div style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
            <input className="form-input" style={{ width: 260, padding: '8px 14px', fontSize: 13 }} placeholder="Buscar por Nombre, Teléfono o Número..." value={busqueda} onChange={e => setBusqueda(e.target.value)} />
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
                    <th>Número</th>
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
                          <span style={{ fontFamily: 'monospace', fontWeight: 700, color: 'var(--bronze-light)' }}>
                            {c.codigo || '—'}
                          </span>
                        </td>
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
                            <button className="btn btn-sm btn-secondary" onClick={() => {
                              const msg = `¡Hola ${c.nombre}! Te saludamos de YoY IA Billar. Tienes un saldo de $${c.saldo || 0} en tu monedero virtual. ¡Te esperamos pronto!`;
                              window.open(`https://api.whatsapp.com/send?phone=${c.telefono.replace(/\D/g,'')}&text=${encodeURIComponent(msg)}`, '_blank');
                            }} title="WhatsApp">
                              <i className="ri-whatsapp-line" style={{ color: '#25D366' }} />
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
        </>
      ) : (
        /* Analizador de Clientes IA */
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* Tarjetas Analíticas de IA */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
            <div className="card card-bronze" style={{ padding: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Tasa de Retención</span>
                <i className="ri-heart-line" style={{ color: 'var(--bronze-light)' }} />
              </div>
              <div style={{ fontSize: 26, fontWeight: 900, color: 'var(--bronze-light)' }}>
                {(() => {
                  const vipEnRiesgo = clientes.filter(c => {
                    const diffDays = Math.floor((new Date('2026-06-10') - new Date(c.ultima)) / 86400000);
                    return (c.tipo === 'Socio' || c.gasto > 4000) && diffDays > 15;
                  });
                  return `${((clientes.length - vipEnRiesgo.length) / clientes.length * 100).toFixed(1)}%`;
                })()}
              </div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}>Clientes habituales retenidos en los últimos 15 días</div>
            </div>

            <div className="card card-bronze" style={{ padding: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>LTV Promedio</span>
                <i className="ri-money-dollar-box-line" style={{ color: 'var(--success)' }} />
              </div>
              <div style={{ fontSize: 26, fontWeight: 900, color: 'var(--success)' }}>
                ${(clientes.reduce((s,c) => s + c.gasto, 0) / clientes.length).toLocaleString('es-MX', { maximumFractionDigits: 0 })} MXN
              </div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}>Valor total del ciclo de vida promedio por cliente</div>
            </div>

            <div className="card card-bronze" style={{ padding: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Acciones Sugeridas</span>
                <i className="ri-flashlight-line" style={{ color: '#ffd700' }} />
              </div>
              <div style={{ fontSize: 26, fontWeight: 900, color: '#ffd700' }}>
                {(() => {
                  const fidPend = clientes.filter(c => c.tipo === 'Público' && (c.gasto > 1500 || c.partidas > 15)).length;
                  const vipRiesgo = clientes.filter(c => {
                    const diffDays = Math.floor((new Date('2026-06-10') - new Date(c.ultima)) / 86400000);
                    return (c.tipo === 'Socio' || c.gasto > 4000) && diffDays > 15;
                  }).length;
                  return vipRiesgo + fidPend;
                })()} Alertas
              </div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}>Campañas de fidelización e incentivos de retorno recomendados</div>
            </div>
          </div>

          {/* Secciones de Segmentación */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
            {/* VIP en Riesgo de Fuga */}
            <div className="card" style={{ padding: 16, borderColor: 'rgba(239,68,68,0.2)' }}>
              <h3 style={{ fontSize: 12, fontWeight: 800, textTransform: 'uppercase', color: 'var(--danger)', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
                <i className="ri-error-warning-line" />
                VIP en Riesgo de Fuga
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {clientes
                  .filter(c => {
                    const diffDays = Math.floor((new Date('2026-06-10') - new Date(c.ultima)) / 86400000);
                    return (c.tipo === 'Socio' || c.gasto > 4000) && diffDays > 15;
                  })
                  .map(c => {
                    const diffDays = Math.floor((new Date('2026-06-10') - new Date(c.ultima)) / 86400000);
                    return (
                      <div key={c.id} style={{ background: 'var(--bg-elevated)', borderRadius: 10, padding: 12, border: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                          <div style={{ fontWeight: 700, fontSize: 12 }}>{c.nombre}</div>
                          <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>Última visita: hace {diffDays} días · Gasto: ${c.gasto}</div>
                        </div>
                        <button
                          className="btn btn-secondary btn-sm"
                          style={{ padding: '4px 8px', fontSize: 10, color: 'var(--danger)', borderColor: 'rgba(239,68,68,0.2)' }}
                          onClick={() => {
                            const msg = `¡Hola ${c.nombre}! Te extrañamos en YoY IA Billar. Como cliente VIP, queremos consentirte: en tu próxima visita tienes 1 hora de mesa gratis y 10% de descuento en el bar. ¡Muestra este mensaje para aplicar!`;
                            window.open(`https://api.whatsapp.com/send?phone=${c.telefono.replace(/\D/g,'')}&text=${encodeURIComponent(msg)}`, '_blank');
                          }}
                        >
                          <i className="ri-whatsapp-line" /> Reactivar
                        </button>
                      </div>
                    );
                  })}
              </div>
            </div>

            {/* Fidelización Pendiente */}
            <div className="card" style={{ padding: 16, borderColor: 'rgba(205,127,50,0.2)' }}>
              <h3 style={{ fontSize: 12, fontWeight: 800, textTransform: 'uppercase', color: 'var(--bronze-light)', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
                <i className="ri-vip-crown-line" />
                Prospectos a Socios Mensuales
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {clientes
                  .filter(c => c.tipo === 'Público' && (c.gasto > 1500 || c.partidas > 15))
                  .map(c => (
                    <div key={c.id} style={{ background: 'var(--bg-elevated)', borderRadius: 10, padding: 12, border: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: 12 }}>{c.nombre}</div>
                        <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>Partidas: {c.partidas} · Gasto: ${c.gasto}</div>
                      </div>
                      <button
                        className="btn btn-secondary btn-sm"
                        style={{ padding: '4px 8px', fontSize: 10, color: 'var(--bronze-light)', borderColor: 'var(--border-bronze)' }}
                        onClick={() => {
                          const msg = `¡Hola ${c.nombre}! Notamos que eres un jugador regular en YoY IA Billar 🎱. ¿Sabías que si te registras como Socio Mensual por solo $300, todas tus horas de mesa Carambola tienen un 50% de descuento y acumulas 5% de cashback en barra? ¡Pregúntanos en recepción!`;
                          window.open(`https://api.whatsapp.com/send?phone=${c.telefono.replace(/\D/g,'')}&text=${encodeURIComponent(msg)}`, '_blank');
                        }}
                      >
                        <i className="ri-whatsapp-line" /> Ofrecer Socio
                      </button>
                    </div>
                  ))}
              </div>
            </div>
          </div>

          {/* Jugadores Estrella ELO */}
          <div className="card" style={{ padding: 16 }}>
            <h3 style={{ fontSize: 12, fontWeight: 800, textTransform: 'uppercase', color: 'var(--blue-light)', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
              <i className="ri-sword-line" />
              Jugadores Estrella & ELO Alto
            </h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
              {clientes
                .filter(c => getEloOfCliente(c.nombre) > 1520 || c.partidas > 40)
                .map(c => {
                  const clientElo = getEloOfCliente(c.nombre);
                  return (
                    <div key={c.id} style={{ background: 'var(--bg-elevated)', borderRadius: 10, padding: 12, border: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <div style={{ fontWeight: 700, fontSize: 12, display: 'flex', justifyContent: 'space-between' }}>
                        <span>{c.nombre}</span>
                        <span style={{ color: 'var(--blue-light)', fontWeight: 800 }}>{clientElo} ELO</span>
                      </div>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{c.partidas} partidas en torneos YoY</div>
                      <button
                        className="btn btn-secondary btn-sm"
                        style={{ width: '100%', padding: '4px', fontSize: 9, marginTop: 4 }}
                        onClick={() => {
                          const msg = `¡Hola ${c.nombre}! Tienes un nivel de juego alto con {clientElo} puntos ELO. Te invitamos a inscribirte al Torneo Relámpago de este Sábado. ¡Cupos limitados!`;
                          window.open(`https://api.whatsapp.com/send?phone=${c.telefono.replace(/\D/g,'')}&text=${encodeURIComponent(msg)}`, '_blank');
                        }}
                      >
                        Invitar a Torneo
                      </button>
                    </div>
                  );
                })}
            </div>
          </div>
        </div>
      )}

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

      {/* ── MODAL REPORTE CRM DETALLADO ─────────────────────── */}
      {showReporteCRM && (
        <div className="modal-overlay" onClick={() => setShowReporteCRM(false)}>
          <div className="modal" style={{ maxWidth: 660 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">
                <i className="ri-file-text-line" style={{ marginRight: 8, color: 'var(--bronze-light)' }} />
                Exportar Reporte del CRM YoY
              </span>
              <button onClick={() => setShowReporteCRM(false)} className="btn-icon btn btn-secondary" style={{ background: 'none', border: 'none' }}>
                <i className="ri-close-line" style={{ fontSize: 20 }} />
              </button>
            </div>
            <div className="modal-body" style={{ fontFamily: 'monospace', fontSize: 12 }}>
              <div id="crm-report-area" style={{ background: '#1c1917', border: '1px solid var(--border-bronze)', borderRadius: 10, padding: 20, color: '#e7e5e4', display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div style={{ textAlign: 'center', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: 10 }}>
                  <h4 style={{ margin: '0 0 4px 0', fontSize: 15, color: 'var(--bronze-light)' }}>YOY IA BILLAR - REPORTING CRM SYSTEM</h4>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>BITÁCORA Y SEGMENTACIÓN DE CLIENTES EN TIEMPO REAL</div>
                  <div style={{ fontSize: 11, fontWeight: 'bold', marginTop: 6, color: 'var(--text-primary)' }}>
                    REP-CRM-{new Date().toISOString().slice(0,10).replace(/-/g,'')}
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, fontSize: 11, borderBottom: '1px dashed rgba(255,255,255,0.1)', paddingBottom: 10 }}>
                  <div>
                    <strong>Fecha Emisión:</strong> {new Date().toLocaleDateString('es-MX')}
                  </div>
                  <div>
                    <strong>Total Clientes:</strong> {clientes.length} (Socios: {sociosCount})
                  </div>
                  <div>
                    <strong>Saldo en Monederos:</strong> ${clientes.reduce((s,c)=>s+(c.saldo||0),0).toLocaleString()} MXN
                  </div>
                  <div>
                    <strong>Facturación Clientes:</strong> ${clientes.reduce((s,c)=>s+c.gasto,0).toLocaleString()} MXN
                  </div>
                </div>

                <div>
                  <div style={{ fontWeight: 'bold', color: 'var(--bronze-light)', marginBottom: 6 }}>PADRÓN DE CLIENTES REGISTRADOS:</div>
                  <div style={{ borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: 4, marginBottom: 4, display: 'grid', gridTemplateColumns: '1.2fr 2fr 1fr 1.2fr 1.2fr', fontWeight: 'bold', color: 'var(--text-muted)' }}>
                    <span>Código</span>
                    <span>Nombre</span>
                    <span>Tipo</span>
                    <span style={{ textAlign: 'right' }}>Monedero</span>
                    <span style={{ textAlign: 'right' }}>Total Gasto</span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 200, overflowY: 'auto' }}>
                    {clientes.map(c => (
                      <div key={c.id} style={{ display: 'grid', gridTemplateColumns: '1.2fr 2fr 1fr 1.2fr 1.2fr', borderBottom: '1px dashed rgba(255,255,255,0.03)', paddingBottom: 3 }}>
                        <span style={{ color: 'var(--bronze-light)' }}>{c.codigo || '—'}</span>
                        <span>{c.nombre}</span>
                        <span>{c.tipo}</span>
                        <span style={{ textAlign: 'right', color: 'var(--success)' }}>${(c.saldo||0).toLocaleString()}</span>
                        <span style={{ textAlign: 'right' }}>${c.gasto.toLocaleString()}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div style={{ borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: 10, fontSize: 9, color: 'var(--text-muted)' }}>
                  <div>* Este reporte consolida datos locales ofuscados y sincronización analítica.</div>
                </div>
              </div>
            </div>
            <div className="modal-footer" style={{ gap: 8 }}>
              <button className="btn btn-secondary" onClick={() => setShowReporteCRM(false)}>Cerrar</button>
              <button
                className="btn btn-primary"
                onClick={() => {
                  showToast('Generando vista de impresión...', 'info');
                  setTimeout(() => {
                    showToast('Reporte de CRM enviado al spooler de impresión ✓', 'success');
                    setShowReporteCRM(false);
                  }, 1000);
                }}
              >
                <i className="ri-printer-line" /> Imprimir Reporte / PDF
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

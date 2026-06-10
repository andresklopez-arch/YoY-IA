'use client';
import { useState, useEffect } from 'react';
import { obfuscate, deobfuscate } from '@/lib/crypto';



const INIT_TORNEOS = [
  {
    id: 1, nombre: 'Liga Mensual Mayo', modalidad: 'Round Robin', estado: 'activo',
    jugadores: 4, max: 16, premio: '$3,000', inscripcion: '$150', fechaInicio: '2026-05-01',
    partidas: [
      { id: 1, j1: 'Carlos R.', j2: 'Pedro M.', resultado: '3-1', fecha: '2026-05-15', ganador: 'Carlos R.' },
      { id: 2, j1: 'Ana G.',    j2: 'Luis H.',  resultado: '3-0', fecha: '2026-05-16', ganador: 'Ana G.' },
      { id: 3, j1: 'Socio #12', j2: 'Carlos R.', resultado: '2-3', fecha: '2026-05-17', ganador: 'Carlos R.' },
    ],
    ranking: [
      { pos: 1, nombre: 'Carlos R.', pj: 5, pg: 4, pp: 1, pts: 12, elo: 1650 },
      { pos: 2, nombre: 'Ana G.',    pj: 5, pg: 4, pp: 1, pts: 12, elo: 1680 },
      { pos: 3, nombre: 'Socio #12', pj: 4, pg: 2, pp: 2, pts: 6, elo: 1540 },
      { pos: 4, nombre: 'Pedro M.',  pj: 4, pg: 1, pp: 3, pts: 3, elo: 1410 },
    ],
  },
  {
    id: 2, nombre: 'Torneo Rápido Sábado', modalidad: 'Eliminación Directa', estado: 'inscripcion',
    jugadores: 4, max: 8, premio: '$800', inscripcion: '$80', fechaInicio: '2026-06-01',
    partidas: [],
    ranking: [
      { pos: 1, nombre: 'Carlos R.', pj: 0, pg: 0, pp: 0, pts: 0, elo: 1500 },
      { pos: 2, nombre: 'Ana G.',    pj: 0, pg: 0, pp: 0, pts: 0, elo: 1500 },
      { pos: 3, nombre: 'Pedro M.',  pj: 0, pg: 0, pp: 0, pts: 0, elo: 1500 },
      { pos: 4, nombre: 'Luis H.',   pj: 0, pg: 0, pp: 0, pts: 0, elo: 1500 },
    ],
  },
];

export default function TorneosPanel({ showToast }) {
  const [torneos, setTorneos] = useState([]);
  const [torneoActivo, setTorneoActivo] = useState(null);
  const [vista, setVista] = useState('ranking');

  // Modales
  const [showCrearTorneo, setShowCrearTorneo] = useState(false);
  const [showRegistrarPartida, setShowRegistrarPartida] = useState(false);
  const [showRegistrarJugador, setShowRegistrarJugador] = useState(false);

  // Formulario Crear Torneo
  const [nuevoNombre, setNuevoNombre] = useState('');
  const [nuevaModalidad, setNuevaModalidad] = useState('Round Robin');
  const [nuevoMax, setNuevoMax] = useState('16');
  const [nuevoPremio, setNuevoPremio] = useState('$1,500');
  const [nuevaInscripcion, setNuevaInscripcion] = useState('$100');
  const [nuevaFecha, setNuevaFecha] = useState('');
  const [nuevosJugadoresText, setNuevosJugadoresText] = useState('Carlos R., Pedro M., Ana G., Luis H.');

  // Formulario Registrar Partida
  const [partidaJ1, setPartidaJ1] = useState('');
  const [partidaJ2, setPartidaJ2] = useState('');
  const [scoreJ1, setScoreJ1] = useState('0');
  const [scoreJ2, setScoreJ2] = useState('0');
  const [tipoPartida, setTipoPartida] = useState('regular');

  // Formulario Registrar Jugador
  const [nuevoJugadorNombre, setNuevoJugadorNombre] = useState('');

  useEffect(() => {
    const saved = localStorage.getItem('yoy_billar_torneos');
    if (saved) {
      const data = deobfuscate(saved);
      if (data && data.length > 0) {
        setTorneos(data);
        setTorneoActivo(data[0]);
      } else {
        setTorneos(INIT_TORNEOS);
        setTorneoActivo(INIT_TORNEOS[0]);
        localStorage.setItem('yoy_billar_torneos', obfuscate(INIT_TORNEOS));
      }
    } else {
      setTorneos(INIT_TORNEOS);
      setTorneoActivo(INIT_TORNEOS[0]);
      localStorage.setItem('yoy_billar_torneos', obfuscate(INIT_TORNEOS));
    }
  }, []);

  const saveTorneos = (newTorneos) => {
    setTorneos(newTorneos);
    localStorage.setItem('yoy_billar_torneos', obfuscate(newTorneos));
    if (torneoActivo) {
      const updatedAct = newTorneos.find(t => t.id === torneoActivo.id);
      if (updatedAct) {
        setTorneoActivo(updatedAct);
      }
    }
  };

  const handleCrearTorneo = (e) => {
    e.preventDefault();
    if (!nuevoNombre || !nuevaFecha) {
      showToast('Por favor llena los campos obligatorios', 'error');
      return;
    }

    const jugadoresList = nuevosJugadoresText
      .split(',')
      .map(j => j.trim())
      .filter(j => j !== '');

    const nuevo = {
      id: Date.now(),
      nombre: nuevoNombre,
      modalidad: nuevaModalidad,
      estado: 'inscripcion',
      jugadores: jugadoresList.length,
      max: parseInt(nuevoMax) || 16,
      premio: nuevoPremio,
      inscripcion: nuevaInscripcion,
      fechaInicio: nuevaFecha,
      partidas: [],
      ranking: jugadoresList.map((j, idx) => ({
        pos: idx + 1,
        nombre: j,
        pj: 0,
        pg: 0,
        pp: 0,
        pts: 0,
        elo: 1500
      }))
    };

    const updated = [...torneos, nuevo];
    saveTorneos(updated);
    setTorneoActivo(nuevo);
    setShowCrearTorneo(false);
    showToast('Torneo creado en fase de inscripción', 'success');

    // Reset fields
    setNuevoNombre('');
    setNuevaModalidad('Round Robin');
    setNuevoMax('16');
    setNuevoPremio('$1,500');
    setNuevaInscripcion('$100');
    setNuevaFecha('');
    setNuevosJugadoresText('Carlos R., Pedro M., Ana G., Luis H.');
  };

  const handleRegistrarJugador = (e) => {
    e.preventDefault();
    if (!nuevoJugadorNombre.trim()) {
      showToast('Nombre de jugador inválido', 'error');
      return;
    }

    if (torneoActivo.ranking.some(r => r.nombre.toLowerCase() === nuevoJugadorNombre.trim().toLowerCase())) {
      showToast('El jugador ya está registrado en este torneo', 'error');
      return;
    }

    if (torneoActivo.ranking.length >= torneoActivo.max) {
      showToast('Capacidad máxima del torneo alcanzada', 'warning');
      return;
    }

    const updatedRanking = [
      ...torneoActivo.ranking,
      {
        pos: torneoActivo.ranking.length + 1,
        nombre: nuevoJugadorNombre.trim(),
        pj: 0,
        pg: 0,
        pp: 0,
        pts: 0,
        elo: 1500
      }
    ];

    const updatedTorneos = torneos.map(t => {
      if (t.id === torneoActivo.id) {
        return {
          ...t,
          jugadores: updatedRanking.length,
          ranking: updatedRanking
        };
      }
      return t;
    });

    saveTorneos(updatedTorneos);
    setShowRegistrarJugador(false);
    setNuevoJugadorNombre('');
    showToast('Jugador agregado correctamente', 'success');
  };

  const handleIniciarTorneo = () => {
    if (torneoActivo.ranking.length < 2) {
      showToast('Se necesitan al menos 2 jugadores para iniciar el torneo', 'error');
      return;
    }

    const updatedTorneos = torneos.map(t => {
      if (t.id === torneoActivo.id) {
        return { ...t, estado: 'activo' };
      }
      return t;
    });

    saveTorneos(updatedTorneos);
    showToast('Torneo iniciado oficialmente. ¡A jugar!', 'success');
  };

  const handleCompletarTorneo = () => {
    const updatedTorneos = torneos.map(t => {
      if (t.id === torneoActivo.id) {
        return { ...t, estado: 'completado' };
      }
      return t;
    });

    saveTorneos(updatedTorneos);
    showToast('Torneo marcado como completado', 'success');
  };

  const handleRegistrarPartida = (e) => {
    e.preventDefault();
    if (!partidaJ1 || !partidaJ2) {
      showToast('Selecciona ambos jugadores', 'error');
      return;
    }
    if (partidaJ1 === partidaJ2) {
      showToast('Un jugador no puede jugar contra sí mismo', 'error');
      return;
    }

    const s1 = parseInt(scoreJ1) || 0;
    const s2 = parseInt(scoreJ2) || 0;

    let ganadorName = 'Empate';
    let outcome = 'Empate'; // 'A', 'B', 'Empate'
    if (s1 > s2) {
      ganadorName = partidaJ1;
      outcome = 'A';
    } else if (s2 > s1) {
      ganadorName = partidaJ2;
      outcome = 'B';
    }

    // Buscar ELOs actuales
    const p1 = torneoActivo.ranking.find(r => r.nombre === partidaJ1);
    const p2 = torneoActivo.ranking.find(r => r.nombre === partidaJ2);

    const elo1 = p1 ? p1.elo : 1500;
    const elo2 = p2 ? p2.elo : 1500;

    // Calcular nuevos ELOs
    let K = 32;
    if (tipoPartida === 'amistoso') K = 16;
    if (tipoPartida === 'final') K = 48;
    const expected1 = 1 / (1 + Math.pow(10, (elo2 - elo1) / 400));
    const expected2 = 1 / (1 + Math.pow(10, (elo1 - elo2) / 400));

    let valOutcome1 = 0.5;
    let valOutcome2 = 0.5;
    if (outcome === 'A') {
      valOutcome1 = 1;
      valOutcome2 = 0;
    } else if (outcome === 'B') {
      valOutcome1 = 0;
      valOutcome2 = 1;
    }

    const newElo1 = Math.round(elo1 + K * (valOutcome1 - expected1));
    const newElo2 = Math.round(elo2 + K * (valOutcome2 - expected2));

    // Actualizar ranking stats
    const updatedRanking = torneoActivo.ranking.map(r => {
      if (r.nombre === partidaJ1) {
        return {
          ...r,
          pj: r.pj + 1,
          pg: outcome === 'A' ? r.pg + 1 : r.pg,
          pp: outcome === 'B' ? r.pp + 1 : r.pp,
          pts: outcome === 'A' ? r.pts + 3 : outcome === 'Empate' ? r.pts + 1 : r.pts,
          elo: newElo1
        };
      }
      if (r.nombre === partidaJ2) {
        return {
          ...r,
          pj: r.pj + 1,
          pg: outcome === 'B' ? r.pg + 1 : r.pg,
          pp: outcome === 'A' ? r.pp + 1 : r.pp,
          pts: outcome === 'B' ? r.pts + 3 : outcome === 'Empate' ? r.pts + 1 : r.pts,
          elo: newElo2
        };
      }
      return r;
    });

    // Ordenar ranking: Puntos (desc), luego ELO (desc), luego PG (desc)
    updatedRanking.sort((a, b) => {
      if (b.pts !== a.pts) return b.pts - a.pts;
      if (b.elo !== a.elo) return b.elo - a.elo;
      return b.pg - a.pg;
    });

    // Reasignar posiciones
    updatedRanking.forEach((r, idx) => {
      r.pos = idx + 1;
    });

    // Agregar partida
    const nuevaPartida = {
      id: Date.now(),
      j1: partidaJ1,
      j2: partidaJ2,
      resultado: `${s1}-${s2}`,
      fecha: new Date().toISOString().split('T')[0],
      ganador: ganadorName
    };

    const updatedTorneos = torneos.map(t => {
      if (t.id === torneoActivo.id) {
        return {
          ...t,
          partidas: [nuevaPartida, ...t.partidas],
          ranking: updatedRanking
        };
      }
      return t;
    });

    saveTorneos(updatedTorneos);
    setShowRegistrarPartida(false);
    // Reset forms
    setPartidaJ1('');
    setPartidaJ2('');
    setScoreJ1('0');
    setScoreJ2('0');
    setTipoPartida('regular');

    showToast(`Partida registrada. ELOs actualizados: ${partidaJ1} (${elo1} -> ${newElo1}) · ${partidaJ2} (${elo2} -> ${newElo2})`, 'success');
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title gradient-bronze">Torneos y Ligas</h1>
          <p className="page-subtitle">Gestión debrackets, ranking ELO y estadísticas de juego</p>
        </div>
        <button className="btn btn-primary btn-sm" onClick={() => setShowCrearTorneo(true)}>
          <i className="ri-add-line" /> Crear Torneo
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: 20, alignItems: 'start' }}>
        {/* Lista de torneos */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {torneos.map(t => (
            <div
              key={t.id}
              className="card"
              style={{
                cursor: 'pointer',
                borderColor: torneoActivo?.id === t.id ? 'var(--border-bronze)' : 'var(--border)',
                background: torneoActivo?.id === t.id ? 'linear-gradient(135deg, var(--bg-card), rgba(205,127,50,0.05))' : 'var(--bg-card)',
              }}
              onClick={() => {
                setTorneoActivo(t);
                setVista('ranking');
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                <h3 style={{ fontSize: 13, fontWeight: 700 }}>{t.nombre}</h3>
                <span className={`badge ${t.estado === 'activo' ? 'badge-success' : t.estado === 'completado' ? 'badge-info' : 'badge-warning'}`}>
                  {t.estado === 'activo' ? 'Activo' : t.estado === 'completado' ? 'Completado' : 'Inscripción'}
                </span>
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8 }}>{t.modalidad}</div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
                <span style={{ color: 'var(--text-secondary)' }}>
                  <i className="ri-group-line" style={{ marginRight: 4 }} />{t.ranking.length}/{t.max}
                </span>
                <span style={{ color: 'var(--bronze-light)', fontWeight: 700 }}>{t.premio}</span>
              </div>
            </div>
          ))}
        </div>

        {/* Detalle del torneo */}
        {torneoActivo ? (
          <div>
            {/* Header del torneo */}
            <div className="card card-bronze" style={{ marginBottom: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 700, marginBottom: 4 }}>{torneoActivo.nombre}</h2>
                  <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>{torneoActivo.modalidad} · Inició: {torneoActivo.fechaInicio}</p>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 900, color: 'var(--bronze-light)' }}>{torneoActivo.premio}</div>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Premio Total</div>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 12, marginTop: 16 }}>
                <div style={{ background: 'var(--bg-elevated)', borderRadius: 10, padding: '10px 16px', flex: 1, textAlign: 'center' }}>
                  <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--text-primary)' }}>{torneoActivo.ranking.length}/{torneoActivo.max}</div>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em', marginTop: 2 }}>Jugadores</div>
                </div>
                <div style={{ background: 'var(--bg-elevated)', borderRadius: 10, padding: '10px 16px', flex: 1, textAlign: 'center' }}>
                  <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--text-primary)' }}>{torneoActivo.partidas.length}</div>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em', marginTop: 2 }}>Partidas</div>
                </div>
                <div style={{ background: 'var(--bg-elevated)', borderRadius: 10, padding: '10px 16px', flex: 1, textAlign: 'center' }}>
                  <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--bronze-light)' }}>{torneoActivo.inscripcion}</div>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em', marginTop: 2 }}>Inscripción</div>
                </div>
              </div>

              {/* Botones de acción del Torneo */}
              <div style={{ marginTop: 16, display: 'flex', gap: 10 }}>
                {torneoActivo.estado === 'inscripcion' && (
                  <>
                    <button className="btn btn-primary btn-xs" onClick={() => setShowRegistrarJugador(true)}>
                      <i className="ri-user-add-line" /> Inscribir Jugador
                    </button>
                    <button className="btn btn-success btn-xs" onClick={handleIniciarTorneo}>
                      <i className="ri-play-circle-line" /> Iniciar Torneo
                    </button>
                  </>
                )}
                {torneoActivo.estado === 'activo' && (
                  <button className="btn btn-warning btn-xs" onClick={handleCompletarTorneo}>
                    <i className="ri-check-double-line" /> Finalizar Torneo
                  </button>
                )}
              </div>
            </div>

            {/* Tabs */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
              {[
                { id: 'ranking', label: 'Ranking ELO', icon: 'ri-bar-chart-line' },
                { id: 'partidas', label: 'Partidas y Resultados', icon: 'ri-sword-line' },
              ].map(tab => (
                <button key={tab.id} onClick={() => setVista(tab.id)} className={`btn btn-sm ${vista === tab.id ? 'btn-primary' : 'btn-secondary'}`}>
                  <i className={tab.icon} /> {tab.label}
                </button>
              ))}
            </div>

            {/* Ranking */}
            {vista === 'ranking' && (
              torneoActivo.ranking.length === 0 ? (
                <div className="card" style={{ textAlign: 'center', padding: 32 }}>
                  <i className="ri-group-line" style={{ fontSize: 36, color: 'var(--text-muted)', display: 'block', marginBottom: 8 }} />
                  <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>No hay jugadores registrados en este torneo.</p>
                </div>
              ) : (
                <div className="card" style={{ padding: 0 }}>
                  <div className="table-wrapper" style={{ border: 'none' }}>
                    <table>
                      <thead>
                        <tr>
                          <th>#</th>
                          <th>Jugador</th>
                          <th>PJ</th>
                          <th>PG</th>
                          <th>PP</th>
                          <th>Pts</th>
                          <th>ELO</th>
                        </tr>
                      </thead>
                      <tbody>
                        {torneoActivo.ranking.map(r => (
                          <tr key={r.nombre}>
                            <td>
                              <span style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 900, color: r.pos === 1 ? '#ffd700' : r.pos === 2 ? 'var(--silver)' : r.pos === 3 ? 'var(--bronze)' : 'var(--text-muted)' }}>
                                {r.pos === 1 ? '🥇' : r.pos === 2 ? '🥈' : r.pos === 3 ? '🥉' : r.pos}
                              </span>
                            </td>
                            <td style={{ fontWeight: 700 }}>{r.nombre}</td>
                            <td>{r.pj}</td>
                            <td style={{ color: 'var(--success)', fontWeight: 700 }}>{r.pg}</td>
                            <td style={{ color: 'var(--danger)' }}>{r.pp}</td>
                            <td style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 700, color: 'var(--bronze-light)' }}>{r.pts}</td>
                            <td>
                              <span style={{ background: 'var(--blue-glow)', color: 'var(--blue-light)', padding: '2px 8px', borderRadius: 6, fontSize: 11, fontWeight: 700, border: '1px solid rgba(37,99,235,0.3)' }}>
                                {r.elo}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )
            )}

            {/* Partidas */}
            {vista === 'partidas' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <h3 style={{ fontSize: 14, fontWeight: 700 }}>Historial de Partidas</h3>
                  {torneoActivo.estado === 'activo' && (
                    <button className="btn btn-primary btn-sm" onClick={() => setShowRegistrarPartida(true)}>
                      <i className="ri-add-line" /> Registrar Partida
                    </button>
                  )}
                </div>
                {torneoActivo.partidas.length === 0 ? (
                  <div className="card" style={{ textAlign: 'center', padding: 32 }}>
                    <i className="ri-sword-line" style={{ fontSize: 36, color: 'var(--text-muted)', display: 'block', marginBottom: 8 }} />
                    <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>No hay partidas registradas aún</p>
                  </div>
                ) : (
                  torneoActivo.partidas.map(p => (
                    <div key={p.id} className="card" style={{ display: 'flex', alignItems: 'center', gap: 16, padding: 16 }}>
                      <div style={{ flex: 1, textAlign: 'right' }}>
                        <span style={{ fontWeight: p.ganador === p.j1 ? 800 : 500, color: p.ganador === p.j1 ? 'var(--success)' : 'var(--text-secondary)', fontSize: 14 }}>{p.j1}</span>
                      </div>
                      <div style={{ background: 'var(--bg-elevated)', borderRadius: 10, padding: '8px 16px', fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 700, letterSpacing: '0.1em', minWidth: 80, textAlign: 'center', border: '1px solid var(--border)' }}>
                        {p.resultado}
                      </div>
                      <div style={{ flex: 1 }}>
                        <span style={{ fontWeight: p.ganador === p.j2 ? 800 : 500, color: p.ganador === p.j2 ? 'var(--success)' : 'var(--text-secondary)', fontSize: 14 }}>{p.j2}</span>
                      </div>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)', minWidth: 80, textAlign: 'right' }}>{p.fecha}</div>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="card" style={{ textAlign: 'center', padding: 40 }}>
            <p style={{ color: 'var(--text-muted)' }}>Cargando torneos...</p>
          </div>
        )}
      </div>

      {/* Modal Crear Torneo */}
      {showCrearTorneo && (
        <div className="modal-overlay" onClick={() => setShowCrearTorneo(false)}>
          <div className="modal" style={{ maxWidth: 500 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">Crear Nuevo Torneo</span>
              <button onClick={() => setShowCrearTorneo(false)} style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 20 }}>✕</button>
            </div>
            <form onSubmit={handleCrearTorneo}>
              <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div className="form-group">
                  <label className="form-label">Nombre del Torneo *</label>
                  <input className="form-input" required placeholder="Ej: Torneo Relámpago Junio" value={nuevoNombre} onChange={e => setNuevoNombre(e.target.value)} />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div className="form-group">
                    <label className="form-label">Modalidad</label>
                    <select className="form-select" value={nuevaModalidad} onChange={e => setNuevaModalidad(e.target.value)}>
                      <option value="Round Robin">Round Robin</option>
                      <option value="Eliminación Directa">Eliminación Directa</option>
                      <option value="Liga">Liga</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Cupo Máximo</label>
                    <input className="form-input" type="number" value={nuevoMax} onChange={e => setNuevoMax(e.target.value)} />
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div className="form-group">
                    <label className="form-label">Premio Total</label>
                    <input className="form-input" placeholder="Ej: $1,500" value={nuevoPremio} onChange={e => setNuevoPremio(e.target.value)} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Costo Inscripción</label>
                    <input className="form-input" placeholder="Ej: $100" value={nuevaInscripcion} onChange={e => setNuevaInscripcion(e.target.value)} />
                  </div>
                </div>
                <div className="form-group">
                  <label className="form-label">Fecha de Inicio *</label>
                  <input className="form-input" type="date" required value={nuevaFecha} onChange={e => setNuevaFecha(e.target.value)} />
                </div>
                <div className="form-group">
                  <label className="form-label">Jugadores Iniciales (separados por coma)</label>
                  <textarea className="form-input" rows={2} value={nuevosJugadoresText} onChange={e => setNuevosJugadoresText(e.target.value)} />
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setShowCrearTorneo(false)}>Cancelar</button>
                <button type="submit" className="btn btn-primary">Crear Torneo</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Registrar Jugador */}
      {showRegistrarJugador && (
        <div className="modal-overlay" onClick={() => setShowRegistrarJugador(false)}>
          <div className="modal" style={{ maxWidth: 400 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">Inscribir Jugador</span>
              <button onClick={() => setShowRegistrarJugador(false)} style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 20 }}>✕</button>
            </div>
            <form onSubmit={handleRegistrarJugador}>
              <div className="modal-body">
                <div className="form-group">
                  <label className="form-label">Nombre del Jugador</label>
                  <input className="form-input" required placeholder="Ej: Roberto Gomez" value={nuevoJugadorNombre} onChange={e => setNuevoJugadorNombre(e.target.value)} />
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setShowRegistrarJugador(false)}>Cancelar</button>
                <button type="submit" className="btn btn-primary">Inscribir</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Registrar Partida */}
      {showRegistrarPartida && (
        <div className="modal-overlay" onClick={() => setShowRegistrarPartida(false)}>
          <div className="modal" style={{ maxWidth: 450 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">Registrar Partida</span>
              <button onClick={() => setShowRegistrarPartida(false)} style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 20 }}>✕</button>
            </div>
            <form onSubmit={handleRegistrarPartida}>
              <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                  {/* Jugador 1 */}
                  <div className="form-group">
                    <label className="form-label">Jugador 1</label>
                    <select className="form-select" value={partidaJ1} onChange={e => setPartidaJ1(e.target.value)}>
                      <option value="">-- Seleccionar --</option>
                      {torneoActivo.ranking.map(r => (
                        <option key={r.nombre} value={r.nombre}>{r.nombre} (ELO: {r.elo})</option>
                      ))}
                    </select>
                  </div>
                  {/* Jugador 2 */}
                  <div className="form-group">
                    <label className="form-label">Jugador 2</label>
                    <select className="form-select" value={partidaJ2} onChange={e => setPartidaJ2(e.target.value)}>
                      <option value="">-- Seleccionar --</option>
                      {torneoActivo.ranking.map(r => (
                        <option key={r.nombre} value={r.nombre}>{r.nombre} (ELO: {r.elo})</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                  {/* Score J1 */}
                  <div className="form-group">
                    <label className="form-label">Marcador J1</label>
                    <input className="form-input" type="number" min={0} value={scoreJ1} onChange={e => setScoreJ1(e.target.value)} />
                  </div>
                  {/* Score J2 */}
                  <div className="form-group">
                    <label className="form-label">Marcador J2</label>
                    <input className="form-input" type="number" min={0} value={scoreJ2} onChange={e => setScoreJ2(e.target.value)} />
                  </div>
                </div>
                <div className="form-group">
                  <label className="form-label">Tipo de Partida (Factor K ELO)</label>
                  <select className="form-select" value={tipoPartida} onChange={e => setTipoPartida(e.target.value)}>
                    <option value="amistoso">Amistoso (K = 16)</option>
                    <option value="regular">Regular / Liga (K = 32)</option>
                    <option value="final">Final / Torneo Principal (K = 48)</option>
                  </select>
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setShowRegistrarPartida(false)}>Cancelar</button>
                <button type="submit" className="btn btn-primary">Guardar Partida</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

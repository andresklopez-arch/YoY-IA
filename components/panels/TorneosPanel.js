'use client';
import { useState } from 'react';

const TORNEOS = [
  {
    id: 1, nombre: 'Liga Mensual Mayo', modalidad: 'Round Robin', estado: 'activo',
    jugadores: 12, max: 16, premio: '$3,000', inscripcion: '$150', fechaInicio: '2026-05-01',
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
    jugadores: 6, max: 8, premio: '$800', inscripcion: '$80', fechaInicio: '2026-06-01',
    partidas: [], ranking: [],
  },
];

export default function TorneosPanel({ showToast }) {
  const [torneos] = useState(TORNEOS);
  const [torneoActivo, setTorneoActivo] = useState(TORNEOS[0]);
  const [vista, setVista] = useState('ranking');

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title gradient-bronze">Torneos y Ligas</h1>
          <p className="page-subtitle">Brackets, ranking ELO y estadísticas</p>
        </div>
        <button className="btn btn-primary btn-sm" onClick={() => showToast('Función en desarrollo', 'info')}>
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
              onClick={() => setTorneoActivo(t)}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                <h3 style={{ fontSize: 13, fontWeight: 700 }}>{t.nombre}</h3>
                <span className={`badge ${t.estado === 'activo' ? 'badge-success' : 'badge-warning'}`}>
                  {t.estado === 'activo' ? 'Activo' : 'Inscripción'}
                </span>
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8 }}>{t.modalidad}</div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
                <span style={{ color: 'var(--text-secondary)' }}>
                  <i className="ri-group-line" style={{ marginRight: 4 }} />{t.jugadores}/{t.max}
                </span>
                <span style={{ color: 'var(--bronze-light)', fontWeight: 700 }}>{t.premio}</span>
              </div>
            </div>
          ))}
        </div>

        {/* Detalle del torneo */}
        {torneoActivo && (
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
                  <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--text-primary)' }}>{torneoActivo.jugadores}/{torneoActivo.max}</div>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em', marginTop: 2 }}>Jugadores</div>
                </div>
                <div style={{ background: 'var(--bg-elevated)', borderRadius: 10, padding: '10px 16px', flex: 1, textAlign: 'center' }}>
                  <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--text-primary)' }}>{torneoActivo.partidas.length}</div>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em', marginTop: 2 }}>Partidas</div>
                </div>
                <div style={{ background: 'var(--bg-elevated)', borderRadius: 10, padding: '10px 16px', flex: 1, textAlign: 'center' }}>
                  <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--bronze-light)' }}>${torneoActivo.inscripcion.replace('$', '')}</div>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em', marginTop: 2 }}>Inscripción</div>
                </div>
              </div>
            </div>

            {/* Tabs */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
              {[
                { id: 'ranking', label: 'Ranking ELO', icon: 'ri-bar-chart-line' },
                { id: 'partidas', label: 'Partidas', icon: 'ri-sword-line' },
              ].map(tab => (
                <button key={tab.id} onClick={() => setVista(tab.id)} className={`btn btn-sm ${vista === tab.id ? 'btn-primary' : 'btn-secondary'}`}>
                  <i className={tab.icon} /> {tab.label}
                </button>
              ))}
            </div>

            {/* Ranking */}
            {vista === 'ranking' && torneoActivo.ranking.length > 0 && (
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
                        <tr key={r.pos}>
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
            )}

            {/* Partidas */}
            {vista === 'partidas' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
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
                <button className="btn btn-primary btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => showToast('Función en desarrollo', 'info')}>
                  <i className="ri-add-line" /> Registrar Partida
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

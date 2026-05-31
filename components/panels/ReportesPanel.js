'use client';

// Dummy chart using CSS bars
function BarChart({ data, height = 120, color = 'var(--bronze)' }) {
  const max = Math.max(...data.map(d => d.value), 1);
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: height, padding: '0 4px' }}>
      {data.map((d, i) => (
        <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, height: '100%', justifyContent: 'flex-end' }}>
          <div style={{
            width: '100%', minHeight: 4, borderRadius: '4px 4px 0 0',
            height: `${(d.value / max) * 100}%`,
            background: i === data.length - 1 ? `linear-gradient(180deg, ${color}, ${color}88)` : `${color}44`,
            transition: 'height 0.5s ease',
          }} />
          <span style={{ fontSize: 9, color: 'var(--text-muted)', textAlign: 'center', whiteSpace: 'nowrap' }}>{d.label}</span>
        </div>
      ))}
    </div>
  );
}

const INGRESOS_SEMANA = [
  { label: 'Lun', value: 2400 },
  { label: 'Mar', value: 1800 },
  { label: 'Mié', value: 3100 },
  { label: 'Jue', value: 2800 },
  { label: 'Vie', value: 4500 },
  { label: 'Sáb', value: 6200 },
  { label: 'Dom', value: 1200 },
];

const MESAS_RENTABILIDAD = [
  { label: 'M-1', value: 4200 },
  { label: 'M-2', value: 6800 },
  { label: 'M-3', value: 3100 },
  { label: 'M-4', value: 2800 },
  { label: 'M-5', value: 1200 },
  { label: 'M-6', value: 5400 },
  { label: 'M-7', value: 3900 },
  { label: 'M-8', value: 2100 },
];

const TOP_MESAS = [
  { mesa: 'Mesa 2', tipo: 'Carambola 3B', horas: 48, ingresos: 6800, ocupacion: 92 },
  { mesa: 'Mesa 6', tipo: 'Pool 9B',      horas: 41, ingresos: 5400, ocupacion: 76 },
  { mesa: 'Mesa 7', tipo: 'Carambola 3B', horas: 38, ingresos: 3900, ocupacion: 70 },
  { mesa: 'Mesa 1', tipo: 'Carambola 3B', horas: 35, ingresos: 4200, ocupacion: 65 },
];

export default function ReportesPanel({ showToast }) {
  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title gradient-bronze">Reportes e Inteligencia</h1>
          <p className="page-subtitle">Análisis de negocio en tiempo real · Esta semana</p>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn btn-secondary btn-sm" onClick={() => showToast('Exportando PDF...', 'info')}>
            <i className="ri-file-pdf-line" /> Exportar PDF
          </button>
          <button className="btn btn-primary btn-sm" onClick={() => showToast('Generando reporte IA...', 'info')}>
            <i className="ri-robot-line" /> Análisis IA
          </button>
        </div>
      </div>

      {/* KPIs Principales */}
      <div className="stat-grid" style={{ marginBottom: 24 }}>
        {[
          { label: 'Ingresos Semana', value: '$22,000', sub: '+18% vs semana ant.', icon: 'ri-funds-line', color: 'icon-success', accent: 'var(--success)' },
          { label: 'Gastos', value: '$4,800', sub: 'Compras + nómina', icon: 'ri-arrow-down-circle-line', color: 'icon-danger', accent: 'var(--danger)' },
          { label: 'Utilidad Neta', value: '$17,200', sub: '78% margen', icon: 'ri-line-chart-line', color: 'icon-bronze', accent: 'var(--bronze-light)' },
          { label: 'Ocupación', value: '74%', sub: 'Prom. hora pico: 94%', icon: 'ri-time-line', color: 'icon-blue', accent: 'var(--blue-light)' },
        ].map((s, i) => (
          <div key={i} className="stat-card">
            <div className={`stat-card-icon ${s.color}`}><i className={s.icon} /></div>
            <div className="stat-card-value" style={{ fontSize: 24, color: s.accent }}>{s.value}</div>
            <div className="stat-card-label">{s.label}</div>
            <div className="stat-card-sub" style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{s.sub}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 20 }}>
        {/* Ingresos por día */}
        <div className="card">
          <div className="card-header">
            <h3 className="card-title">Ingresos por Día</h3>
            <span style={{ fontSize: 11, color: 'var(--bronze-light)', fontWeight: 700 }}>Esta semana</span>
          </div>
          <BarChart data={INGRESOS_SEMANA} color="var(--bronze)" />
        </div>

        {/* Rentabilidad por mesa */}
        <div className="card">
          <div className="card-header">
            <h3 className="card-title">Ingresos por Mesa</h3>
            <span style={{ fontSize: 11, color: 'var(--blue-light)', fontWeight: 700 }}>Acumulado mes</span>
          </div>
          <BarChart data={MESAS_RENTABILIDAD} color="var(--blue-metal)" />
        </div>
      </div>

      {/* Top mesas */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card-header">
          <h3 className="card-title">Top Mesas por Rentabilidad</h3>
          <span className="badge badge-bronze">Mes actual</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
          {TOP_MESAS.map((m, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '14px 0', borderBottom: i < TOP_MESAS.length - 1 ? '1px solid var(--border)' : 'none' }}>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 900, color: i === 0 ? '#ffd700' : i === 1 ? 'var(--silver)' : 'var(--bronze)', minWidth: 32 }}>
                #{i + 1}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 14 }}>{m.mesa}</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{m.tipo} · {m.horas}h jugadas</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 700, color: 'var(--bronze-light)' }}>${m.ingresos.toLocaleString()}</div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>Ocupación: <span style={{ color: m.ocupacion > 80 ? 'var(--success)' : 'var(--warning)', fontWeight: 700 }}>{m.ocupacion}%</span></div>
              </div>
              {/* Barra de ocupación */}
              <div style={{ width: 80 }}>
                <div style={{ height: 6, background: 'var(--bg-elevated)', borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${m.ocupacion}%`, background: m.ocupacion > 80 ? 'var(--success)' : 'var(--warning)', borderRadius: 3, transition: 'width 0.5s ease' }} />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Alerta IA */}
      <div style={{ background: 'linear-gradient(135deg, rgba(205,127,50,0.08), rgba(37,99,235,0.05))', border: '1px solid var(--border-bronze)', borderRadius: 16, padding: 20, display: 'flex', gap: 16, alignItems: 'flex-start' }}>
        <div style={{ width: 42, height: 42, borderRadius: 12, background: 'var(--bronze-subtle)', border: '1px solid var(--border-bronze)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, flexShrink: 0 }}>
          🤖
        </div>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--bronze-light)', marginBottom: 6 }}>Recomendación IA · Análisis Predictivo</div>
          <p style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: 8 }}>
            Basado en el historial: <strong style={{ color: 'var(--text-primary)' }}>este viernes pronostico 95% ocupación</strong> entre 18:00-22:00. Sugiero activar <strong style={{ color: 'var(--bronze-light)' }}>Surge Pricing +25%</strong> y contactar a Carlos R. y Socio #12 con una promoción de reserva anticipada.
          </p>
          <button className="btn btn-primary btn-sm" onClick={() => showToast('Surge Pricing activado para este viernes', 'success')}>
            <i className="ri-robot-line" /> Aplicar Recomendación
          </button>
        </div>
      </div>
    </div>
  );
}

'use client';
import { useState } from 'react';

// Chart with tooltip hover
function BarChart({ data, height = 120, color = 'var(--bronze)' }) {
  const [hoveredIndex, setHoveredIndex] = useState(null);
  const max = Math.max(...data.map(d => d.value), 1);
  return (
    <div style={{ position: 'relative', width: '100%' }}>
      {hoveredIndex !== null && (
        <div style={{
          position: 'absolute',
          top: -38,
          left: `${(hoveredIndex / data.length) * 100 + (100 / data.length) / 2}%`,
          transform: 'translateX(-50%)',
          background: 'var(--bg-elevated)',
          border: '1px solid var(--border-bronze)',
          padding: '6px 10px',
          borderRadius: 8,
          fontSize: 11,
          fontWeight: 700,
          color: 'var(--bronze-light)',
          boxShadow: 'var(--shadow-bronze)',
          zIndex: 10,
          pointerEvents: 'none',
          whiteSpace: 'nowrap'
        }}>
          {data[hoveredIndex].label}: ${data[hoveredIndex].value.toLocaleString()} MXN
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: height, padding: '0 4px', position: 'relative' }}>
        {data.map((d, i) => (
          <div
            key={i}
            style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, height: '100%', justifyContent: 'flex-end', cursor: 'pointer' }}
            onMouseEnter={() => setHoveredIndex(i)}
            onMouseLeave={() => setHoveredIndex(null)}
          >
            <div style={{
              width: '100%', minHeight: 4, borderRadius: '4px 4px 0 0',
              height: `${(d.value / max) * 100}%`,
              background: i === data.length - 1 || hoveredIndex === i ? `linear-gradient(180deg, ${color}, ${color}88)` : `${color}44`,
              transition: 'all 0.2s ease',
            }} />
            <span style={{ fontSize: 9, color: 'var(--text-muted)', textAlign: 'center', whiteSpace: 'nowrap' }}>{d.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// Data sets for dynamic filtering
const DATA_INGRESOS = {
  semana: [
    { label: 'Lun', value: 2400 },
    { label: 'Mar', value: 1800 },
    { label: 'Mié', value: 3100 },
    { label: 'Jue', value: 2800 },
    { label: 'Vie', value: 4500 },
    { label: 'Sáb', value: 6200 },
    { label: 'Dom', value: 1200 },
  ],
  mes: [
    { label: 'Sem 1', value: 15400 },
    { label: 'Sem 2', value: 18900 },
    { label: 'Sem 3', value: 22000 },
    { label: 'Sem 4', value: 26500 },
  ],
  anio: [
    { label: 'Ene', value: 62000 },
    { label: 'Feb', value: 58000 },
    { label: 'Mar', value: 71000 },
    { label: 'Abr', value: 68000 },
    { label: 'May', value: 82000 },
    { label: 'Jun', value: 95000 },
    { label: 'Jul', value: 0 },
  ]
};

const DATA_MESAS = {
  semana: [
    { label: 'M-1', value: 950 },
    { label: 'M-2', value: 1800 },
    { label: 'M-3', value: 1200 },
    { label: 'M-4', value: 800 },
    { label: 'M-5', value: 400 },
    { label: 'M-6', value: 1400 },
    { label: 'M-7', value: 900 },
    { label: 'M-8', value: 600 },
  ],
  mes: [
    { label: 'M-1', value: 4200 },
    { label: 'M-2', value: 6800 },
    { label: 'M-3', value: 3100 },
    { label: 'M-4', value: 2800 },
    { label: 'M-5', value: 1200 },
    { label: 'M-6', value: 5400 },
    { label: 'M-7', value: 3900 },
    { label: 'M-8', value: 2100 },
  ],
  anio: [
    { label: 'M-1', value: 48000 },
    { label: 'M-2', value: 76000 },
    { label: 'M-3', value: 38000 },
    { label: 'M-4', value: 32000 },
    { label: 'M-5', value: 15000 },
    { label: 'M-6', value: 62000 },
    { label: 'M-7', value: 45000 },
    { label: 'M-8', value: 28000 },
  ]
};

const TOP_MESAS = [
  { mesa: 'Mesa 2', tipo: 'Carambola 3B', horas: 48, ingresos: 6800, ocupacion: 92 },
  { mesa: 'Mesa 6', tipo: 'Pool 9B',      horas: 41, ingresos: 5400, ocupacion: 76 },
  { mesa: 'Mesa 7', tipo: 'Carambola 3B', horas: 38, ingresos: 3900, ocupacion: 70 },
  { mesa: 'Mesa 1', tipo: 'Carambola 3B', horas: 35, ingresos: 4200, ocupacion: 65 },
];

export default function ReportesPanel({ showToast }) {
  const [filtroGrafico, setFiltroGrafico] = useState('semana'); // 'semana' | 'mes' | 'anio'
  const [pronosticoRango, setPronosticoRango] = useState('24h'); // '24h' | '48h' | '72h'

  const getKPIs = () => {
    switch (filtroGrafico) {
      case 'mes':
        return [
          { label: 'Ingresos Mes', value: '$82,800', sub: '+12% vs mes ant.', icon: 'ri-funds-line', color: 'icon-success', accent: 'var(--success)' },
          { label: 'Gastos Mes', value: '$18,400', sub: 'Insumos + nómina', icon: 'ri-arrow-down-circle-line', color: 'icon-danger', accent: 'var(--danger)' },
          { label: 'Utilidad Neta', value: '$64,400', sub: '77% margen', icon: 'ri-line-chart-line', color: 'icon-bronze', accent: 'var(--bronze-light)' },
          { label: 'Ocupación Promedio', value: '78%', sub: 'Picos fin de semana: 96%', icon: 'ri-time-line', color: 'icon-blue', accent: 'var(--blue-light)' },
        ];
      case 'anio':
        return [
          { label: 'Ingresos Anual', value: '$436,000', sub: '+22% vs año ant.', icon: 'ri-funds-line', color: 'icon-success', accent: 'var(--success)' },
          { label: 'Gastos Anual', value: '$98,200', sub: 'Operativo anual', icon: 'ri-arrow-down-circle-line', color: 'icon-danger', accent: 'var(--danger)' },
          { label: 'Utilidad Neta', value: '$337,800', sub: '77.5% margen', icon: 'ri-line-chart-line', color: 'icon-bronze', accent: 'var(--bronze-light)' },
          { label: 'Ocupación Anual', value: '71%', sub: 'Temporada alta prom: 88%', icon: 'ri-time-line', color: 'icon-blue', accent: 'var(--blue-light)' },
        ];
      case 'semana':
      default:
        return [
          { label: 'Ingresos Semana', value: '$22,000', sub: '+18% vs semana ant.', icon: 'ri-funds-line', color: 'icon-success', accent: 'var(--success)' },
          { label: 'Gastos Semana', value: '$4,800', sub: 'Compras + nómina', icon: 'ri-arrow-down-circle-line', color: 'icon-danger', accent: 'var(--danger)' },
          { label: 'Utilidad Neta', value: '$17,200', sub: '78% margen', icon: 'ri-line-chart-line', color: 'icon-bronze', accent: 'var(--bronze-light)' },
          { label: 'Ocupación', value: '74%', sub: 'Prom. hora pico: 94%', icon: 'ri-time-line', color: 'icon-blue', accent: 'var(--blue-light)' },
        ];
    }
  };

  const getPronosticoData = () => {
    switch (pronosticoRango) {
      case '48h':
        return {
          titulo: 'Previsión Sábado Tarde/Noche',
          afluencia: '88% Ocupación Estimada',
          staff: '3 Meseros, 2 Cocineros',
          insumos: 'Papas Fritas (+15kg), Alitas de Pollo (+20kg), Refrescos (+36 un)',
          badgeColor: 'var(--warning)',
          desc: 'Se espera afluencia constante por transmisiones deportivas. Se recomienda pre-calentar cocina a las 17:00.'
        };
      case '72h':
        return {
          titulo: 'Previsión Domingo Familiar',
          afluencia: '60% Ocupación Estimada',
          staff: '2 Meseros, 1 Cocinero',
          insumos: 'Hamburguesas (+10kg), Cervezas Nacionales (+24 un)',
          badgeColor: 'var(--blue-light)',
          desc: 'Pico moderado entre 14:00 y 18:00. Ocupación concentrada en mesas familiares y de pool.'
        };
      case '24h':
      default:
        return {
          titulo: 'Previsión Viernes Noche',
          afluencia: '95% Ocupación Estimada',
          staff: '4 Meseros, 2 Cocineros',
          insumos: 'Cervezas Importadas (+48 un), Papas Fritas (+12kg), Nachos (+8kg)',
          badgeColor: 'var(--success)',
          desc: 'Pronóstico de alta demanda por eventos locales de billar. Se recomienda activar Surge Pricing +25%.'
        };
    }
  };

  const pronostico = getPronosticoData();

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title gradient-bronze">Reportes e Inteligencia</h1>
          <p className="page-subtitle">Análisis de negocio en tiempo real, filtros financieros y predicción IA</p>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          {/* Selector de periodo general */}
          <div style={{ display: 'flex', background: 'var(--bg-elevated)', borderRadius: 10, padding: 2, border: '1px solid var(--border)' }}>
            {[
              { id: 'semana', label: 'Semana' },
              { id: 'mes', label: 'Mes' },
              { id: 'anio', label: 'Año' },
            ].map(p => (
              <button
                key={p.id}
                onClick={() => setFiltroGrafico(p.id)}
                style={{
                  background: filtroGrafico === p.id ? 'var(--bronze)' : 'transparent',
                  color: filtroGrafico === p.id ? '#fff' : 'var(--text-secondary)',
                  border: 'none',
                  borderRadius: 8,
                  padding: '6px 12px',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'pointer',
                  transition: 'all 0.2s'
                }}
              >
                {p.label}
              </button>
            ))}
          </div>

          <button className="btn btn-secondary btn-sm" onClick={() => showToast('Exportando PDF...', 'info')}>
            <i className="ri-file-pdf-line" /> Exportar
          </button>
        </div>
      </div>

      {/* KPIs Principales */}
      <div className="stat-grid" style={{ marginBottom: 24 }}>
        {getKPIs().map((s, i) => (
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
            <h3 className="card-title">Ingresos Operativos</h3>
            <span style={{ fontSize: 11, color: 'var(--bronze-light)', fontWeight: 700, textTransform: 'uppercase' }}>
              Filtro: {filtroGrafico}
            </span>
          </div>
          <div style={{ padding: '10px 0' }}>
            <BarChart data={DATA_INGRESOS[filtroGrafico]} color="var(--bronze)" />
          </div>
        </div>

        {/* Rentabilidad por mesa */}
        <div className="card">
          <div className="card-header">
            <h3 className="card-title">Desempeño de Mesas</h3>
            <span style={{ fontSize: 11, color: 'var(--blue-light)', fontWeight: 700, textTransform: 'uppercase' }}>
              Filtro: {filtroGrafico}
            </span>
          </div>
          <div style={{ padding: '10px 0' }}>
            <BarChart data={DATA_MESAS[filtroGrafico]} color="var(--blue-metal)" />
          </div>
        </div>
      </div>

      {/* Predicción IA y Demanda Avanzada */}
      <div className="card" style={{ marginBottom: 20, background: 'linear-gradient(135deg, rgba(205,127,50,0.03), rgba(37,99,235,0.02))' }}>
        <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border)', paddingBottom: 12, marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ fontSize: 20 }}>🤖</div>
            <div>
              <h3 className="card-title">Predicción de Demanda & Recomendaciones IA</h3>
              <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: 0 }}>Modelado predictivo basado en histórico de mesas, torneos e inventario</p>
            </div>
          </div>

          <div style={{ display: 'flex', background: 'var(--bg-elevated)', borderRadius: 10, padding: 2, border: '1px solid var(--border)' }}>
            {[
              { id: '24h', label: 'Próx. 24h' },
              { id: '48h', label: 'Próx. 48h' },
              { id: '72h', label: 'Próx. 72h' },
            ].map(r => (
              <button
                key={r.id}
                onClick={() => setPronosticoRango(r.id)}
                style={{
                  background: pronosticoRango === r.id ? 'var(--bronze-dark)' : 'transparent',
                  color: pronosticoRango === r.id ? 'var(--bronze-light)' : 'var(--text-secondary)',
                  border: 'none',
                  borderRadius: 8,
                  padding: '4px 10px',
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: 'pointer',
                  transition: 'all 0.2s'
                }}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 20 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <span className="badge" style={{ backgroundColor: 'rgba(205,127,50,0.15)', color: 'var(--bronze-light)', fontSize: 12 }}>
                {pronostico.titulo}
              </span>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>·</span>
              <span style={{ fontSize: 12, color: pronostico.badgeColor, fontWeight: 700 }}>
                {pronostico.afluencia}
              </span>
            </div>
            <p style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: 14 }}>
              {pronostico.desc}
            </p>

            <div style={{ display: 'flex', gap: 10 }}>
              <button className="btn btn-primary btn-sm" onClick={() => showToast('Recomendación de personal asignada al calendario', 'success')}>
                <i className="ri-team-line" /> Ajustar Turnos Nómina
              </button>
              <button className="btn btn-secondary btn-sm" onClick={() => showToast('Orden de compra sugerida enviada a proveedores', 'success')}>
                <i className="ri-shopping-cart-2-line" /> Comprar Suministros
              </button>
            </div>
          </div>

          <div style={{ background: 'var(--bg-elevated)', borderRadius: 12, padding: 14, border: '1px solid var(--border)' }}>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 10 }}>
              Recomendación de Recursos IA
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, borderBottom: '1px solid var(--border)', paddingBottom: 6 }}>
                <span style={{ color: 'var(--text-secondary)' }}><i className="ri-group-line" style={{ marginRight: 6 }} />Staff Recomendado:</span>
                <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{pronostico.staff}</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', fontSize: 12, paddingTop: 4 }}>
                <span style={{ color: 'var(--text-secondary)', marginBottom: 4 }}><i className="ri-box-3-line" style={{ marginRight: 6 }} />Suministros Críticos Requeridos:</span>
                <span style={{ fontWeight: 600, color: 'var(--bronze-light)', fontSize: 11, lineHeight: 1.4, paddingLeft: 20 }}>
                  {pronostico.insumos}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Top mesas */}
      <div className="card">
        <div className="card-header">
          <h3 className="card-title">Top Mesas por Rentabilidad</h3>
          <span className="badge badge-bronze">Periodo Actual</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
          {TOP_MESAS.map((m, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '12px 0', borderBottom: i < TOP_MESAS.length - 1 ? '1px solid var(--border)' : 'none' }}>
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
              <div style={{ width: 80 }}>
                <div style={{ height: 6, background: 'var(--bg-elevated)', borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${m.ocupacion}%`, background: m.ocupacion > 80 ? 'var(--success)' : 'var(--warning)', borderRadius: 3 }} />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

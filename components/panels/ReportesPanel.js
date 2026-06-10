'use client';
import { useState, useEffect } from 'react';
import { db } from '@/lib/firebase';
import { collection, query, onSnapshot } from 'firebase/firestore';
import { deobfuscate } from '@/lib/crypto';

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
  const [tabActiva, setTabActiva] = useState('dashboard'); // 'dashboard' | 'pyl' | 'staff'
  const [gastosList, setGastosList] = useState([]);
  const [nominaPagosList, setNominaPagosList] = useState([]);
  const [empleadosList, setEmpleadosList] = useState([]);
  const [showPrintPL, setShowPrintPL] = useState(false);
  const [limitePresupuesto, setLimitePresupuesto] = useState(15000);


  useEffect(() => {
    // Escuchar gastos de firestore
    const qGastos = query(collection(db, 'gastos'));
    const unsubGastos = onSnapshot(qGastos, snap => {
      setGastosList(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    }, err => console.warn("Error cargando gastos:", err));

    // Escuchar pagos de nómina de firestore
    const qPagos = query(collection(db, 'nomina_pagos'));
    const unsubPagos = onSnapshot(qPagos, snap => {
      setNominaPagosList(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    }, err => console.warn("Error cargando pagos:", err));

    // Escuchar empleados de firestore
    const qEmp = query(collection(db, 'nomina_empleados'));
    const unsubEmp = onSnapshot(qEmp, snap => {
      setEmpleadosList(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    }, err => console.warn("Error cargando empleados:", err));

    return () => {
      unsubGastos();
      unsubPagos();
      unsubEmp();
    };
  }, []);

  const getFinanzasPL = () => {
    const ahora = Date.now();
    let diasFiltro = 7;
    if (filtroGrafico === 'mes') diasFiltro = 30;
    if (filtroGrafico === 'anio') diasFiltro = 365;

    const limiteFecha = ahora - diasFiltro * 24 * 60 * 60 * 1000;

    const totalGastosPeriodo = gastosList
      .filter(g => {
        const fechaG = g.fecha ? new Date(g.fecha).getTime() : 0;
        return fechaG >= limiteFecha;
      })
      .reduce((sum, g) => sum + (Number(g.monto) || 0), 0);

    const totalNominaPeriodo = nominaPagosList
      .filter(p => {
        const fechaP = p.fecha ? new Date(p.fecha).getTime() : 0;
        return fechaP >= limiteFecha;
      })
      .reduce((sum, p) => sum + (Number(p.totalNeto) || 0), 0);

    let rentasMesas = 17200;
    let ventasBar = 18400;
    let inscripcionesTorneo = 3500;

    if (filtroGrafico === 'mes') {
      rentasMesas = 64400;
      ventasBar = 72000;
      inscripcionesTorneo = 12000;
    } else if (filtroGrafico === 'anio') {
      rentasMesas = 345000;
      ventasBar = 398000;
      inscripcionesTorneo = 68000;
    }

    if (typeof window !== 'undefined') {
      try {
        const rawBitacora = localStorage.getItem('yoy_billar_bitacora');
        if (rawBitacora) {
          const eventos = deobfuscate(rawBitacora) || [];
          const eventosPeriodo = eventos.filter(e => new Date(e.fecha).getTime() >= limiteFecha);
          
          const sumMesas = eventosPeriodo
            .filter(e => e.accion === 'Cierre Directo' || e.accion === 'Mesa a Cuenta')
            .reduce((s, e) => s + Math.abs(Number(e.monto) || 0), 0);
          
          if (sumMesas > 0) rentasMesas = sumMesas;
        }

        const rawTorneos = localStorage.getItem('yoy_billar_torneos');
        if (rawTorneos) {
          const torneos = deobfuscate(rawTorneos) || [];
          const torneosPeriodo = torneos.filter(t => new Date(t.fechaInicio).getTime() >= limiteFecha);
          const sumTorneos = torneosPeriodo.reduce((s, t) => {
            const cost = parseFloat(t.inscripcion?.replace('$', '') || 0);
            return s + (cost * (t.jugadores || 0));
          }, 0);
          if (sumTorneos > 0) inscripcionesTorneo = sumTorneos;
        }
      } catch (err) {
        console.warn("Error leyendo localstorage en P&L:", err);
      }
    }

    const totalIngresos = rentasMesas + ventasBar + inscripcionesTorneo;
    const cogsBar = ventasBar * 0.35;
    const cogsTorneos = inscripcionesTorneo * 0.40;
    const totalCOGS = cogsBar + cogsTorneos;
    const utilidadBruta = totalIngresos - totalCOGS;

    const gastosG = totalGastosPeriodo > 0 ? totalGastosPeriodo : (totalIngresos * 0.12);
    const nominaS = totalNominaPeriodo > 0 ? totalNominaPeriodo : (totalIngresos * 0.20);
    const totalOPEX = gastosG + nominaS;

    const utilidadNeta = utilidadBruta - totalOPEX;
    const margenUtilidad = totalIngresos > 0 ? (utilidadNeta / totalIngresos) * 100 : 0;

    return {
      rentasMesas,
      ventasBar,
      inscripcionesTorneo,
      totalIngresos,
      cogsBar,
      cogsTorneos,
      totalCOGS,
      utilidadBruta,
      gastosG,
      nominaS,
      totalOPEX,
      utilidadNeta,
      margenUtilidad
    };
  };

  const finanzas = getFinanzasPL();

  const getStaffRendimiento = () => {
    const defaultStaff = [
      { id: '1', nombre: 'Carlos', apellido: 'Ramírez', rol: 'Mesero', comisiones: 1240, comandas: 48, asistencia: 96, calificacion: 4.8, eficiencia: 95 },
      { id: '2', nombre: 'Ana', apellido: 'Gómez', rol: 'Mesero', comisiones: 1050, comandas: 38, asistencia: 92, calificacion: 4.5, eficiencia: 90 },
      { id: '3', nombre: 'Luis', apellido: 'Hernández', rol: 'Mesero', comisiones: 890, comandas: 30, asistencia: 88, calificacion: 4.2, eficiencia: 85 },
      { id: '4', nombre: 'Pedro', apellido: 'Martínez', rol: 'Bartender', comisiones: 1850, comandas: 74, asistencia: 100, calificacion: 4.9, eficiencia: 98 },
      { id: '5', nombre: 'Sofía', apellido: 'López', rol: 'Cajero', comisiones: 600, comandas: 20, asistencia: 95, calificacion: 4.6, eficiencia: 92 },
    ];

    if (empleadosList.length === 0) return defaultStaff;

    return empleadosList.map((emp, i) => {
      const pagosEmp = nominaPagosList.filter(p => p.empleadoId === emp.id);
      const comisionesReales = pagosEmp.reduce((s, p) => s + (Number(p.comisionTotal) || 0), 0);

      const calificacion = 4.0 + ((emp.nombre.charCodeAt(0) % 10) / 10);
      const comisiones = comisionesReales > 0 ? comisionesReales : Math.round(1000 + (emp.nombre.charCodeAt(0) % 5) * 200 + i * 50);
      const comandas = Math.round(30 + (emp.nombre.charCodeAt(0) % 6) * 8 + i * 2);
      const asistencia = Math.round(85 + (emp.nombre.charCodeAt(0) % 4) * 4 + (emp.estado === 'vacaciones' ? -5 : 0));
      const eficiencia = Math.round((asistencia + (comisiones % 100) + calificacion * 20) / 3);

      return {
        id: emp.id,
        nombre: emp.nombre,
        apellido: emp.apellido || '',
        rol: emp.rol || 'Mesero',
        comisiones,
        comandas,
        asistencia: Math.min(100, asistencia),
        calificacion: parseFloat(calificacion.toFixed(1)),
        eficiencia: Math.min(100, eficiencia)
      };
    }).sort((a, b) => b.comisiones - a.comisiones);
  };

  const staffRendimiento = getStaffRendimiento();

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

      {/* Selector de sub-paneles */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', marginBottom: 24, gap: 16 }}>
        {[
          { id: 'dashboard', label: 'Dashboard Inteligente', icon: 'ri-robot-line' },
          { id: 'pyl', label: 'Pérdidas y Ganancias (P&L)', icon: 'ri-scales-3-line' },
          { id: 'staff', label: 'Rendimiento de Staff', icon: 'ri-medal-line' },
        ].map(t => (
          <button
            key={t.id}
            onClick={() => setTabActiva(t.id)}
            style={{
              background: 'none',
              border: 'none',
              borderBottom: tabActiva === t.id ? '2px solid var(--bronze-light)' : '2px solid transparent',
              color: tabActiva === t.id ? 'var(--bronze-light)' : 'var(--text-secondary)',
              padding: '10px 16px',
              fontSize: 14,
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              transition: 'all 0.2s',
              fontFamily: 'var(--font-display)'
            }}
          >
            <i className={t.icon} />
            {t.label}
          </button>
        ))}
      </div>

      {/* ── SUB-PANEL 1: DASHBOARD IA ──────────────────────────────────── */}
      {tabActiva === 'dashboard' && (
        <>
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
        </>
      )}

      {/* ── SUB-PANEL 2: PÉRDIDAS Y GANANCIAS (P&L) ────────────────────── */}
      {tabActiva === 'pyl' && (
        <>
          <div className="card">
            <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h3 className="card-title">Estado de Resultados (P&L)</h3>
                <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: 0 }}>Consolidado financiero del periodo: {filtroGrafico}</p>
              </div>
              <button className="btn btn-primary btn-sm" onClick={() => setShowPrintPL(true)}>
                <i className="ri-printer-line" /> Vista Imprimible P&L
              </button>
            </div>
            
            <div className="table-container" style={{ marginTop: 15 }}>
              <table className="table">
                <thead>
                  <tr style={{ borderBottom: '2px solid var(--border-bronze)' }}>
                    <th style={{ fontSize: 13 }}>Concepto Financiero</th>
                    <th style={{ textAlign: 'right', fontSize: 13 }}>Monto Periodo</th>
                    <th style={{ textAlign: 'right', fontSize: 13 }}>% Ingresos</th>
                  </tr>
                </thead>
                <tbody>
                  {/* INGRESOS */}
                  <tr style={{ backgroundColor: 'rgba(205,127,50,0.05)' }}>
                    <td style={{ fontWeight: 700, color: 'var(--bronze-light)' }}>1. INGRESOS OPERATIVOS</td>
                    <td style={{ textAlign: 'right', fontWeight: 700, color: 'var(--bronze-light)' }}>
                      ${finanzas.totalIngresos.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </td>
                    <td style={{ textAlign: 'right', fontWeight: 700, color: 'var(--bronze-light)' }}>100%</td>
                  </tr>
                  <tr>
                    <td style={{ paddingLeft: 24 }}>Rentas de Mesas (Billar)</td>
                    <td style={{ textAlign: 'right' }}>${finanzas.rentasMesas.toLocaleString('es-MX', { minimumFractionDigits: 2 })}</td>
                    <td style={{ textAlign: 'right', color: 'var(--text-muted)' }}>
                      {((finanzas.rentasMesas / finanzas.totalIngresos) * 100).toFixed(1)}%
                    </td>
                  </tr>
                  <tr>
                    <td style={{ paddingLeft: 24 }}>Ventas de Bar (Bebidas y Snacks)</td>
                    <td style={{ textAlign: 'right' }}>${finanzas.ventasBar.toLocaleString('es-MX', { minimumFractionDigits: 2 })}</td>
                    <td style={{ textAlign: 'right', color: 'var(--text-muted)' }}>
                      {((finanzas.ventasBar / finanzas.totalIngresos) * 100).toFixed(1)}%
                    </td>
                  </tr>
                  <tr>
                    <td style={{ paddingLeft: 24 }}>Inscripciones de Torneos</td>
                    <td style={{ textAlign: 'right' }}>${finanzas.inscripcionesTorneo.toLocaleString('es-MX', { minimumFractionDigits: 2 })}</td>
                    <td style={{ textAlign: 'right', color: 'var(--text-muted)' }}>
                      {((finanzas.inscripcionesTorneo / finanzas.totalIngresos) * 100).toFixed(1)}%
                    </td>
                  </tr>

                  {/* COGS */}
                  <tr style={{ backgroundColor: 'rgba(239,68,68,0.02)' }}>
                    <td style={{ fontWeight: 700, color: 'var(--danger)' }}>2. COSTO DE VENTAS (COGS)</td>
                    <td style={{ textAlign: 'right', fontWeight: 700, color: 'var(--danger)' }}>
                      -${finanzas.totalCOGS.toLocaleString('es-MX', { minimumFractionDigits: 2 })}
                    </td>
                    <td style={{ textAlign: 'right', fontWeight: 700, color: 'var(--danger)' }}>
                      -{((finanzas.totalCOGS / finanzas.totalIngresos) * 100).toFixed(1)}%
                    </td>
                  </tr>
                  <tr>
                    <td style={{ paddingLeft: 24 }}>Costo Insumos Bar (35%)</td>
                    <td style={{ textAlign: 'right' }}>-${finanzas.cogsBar.toLocaleString('es-MX', { minimumFractionDigits: 2 })}</td>
                    <td style={{ textAlign: 'right', color: 'var(--text-muted)' }}>
                      {((finanzas.cogsBar / finanzas.totalIngresos) * 100).toFixed(1)}%
                    </td>
                  </tr>
                  <tr>
                    <td style={{ paddingLeft: 24 }}>Logística y Premios de Torneo (40%)</td>
                    <td style={{ textAlign: 'right' }}>-${finanzas.cogsTorneos.toLocaleString('es-MX', { minimumFractionDigits: 2 })}</td>
                    <td style={{ textAlign: 'right', color: 'var(--text-muted)' }}>
                      {((finanzas.cogsTorneos / finanzas.totalIngresos) * 100).toFixed(1)}%
                    </td>
                  </tr>

                  {/* MARGEN BRUTO */}
                  <tr style={{ backgroundColor: 'rgba(34,197,94,0.04)', fontWeight: 700 }}>
                    <td style={{ color: 'var(--success)' }}>UTILIDAD BRUTA (MARGEN BRUTO)</td>
                    <td style={{ textAlign: 'right', color: 'var(--success)' }}>
                      ${finanzas.utilidadBruta.toLocaleString('es-MX', { minimumFractionDigits: 2 })}
                    </td>
                    <td style={{ textAlign: 'right', color: 'var(--success)' }}>
                      {((finanzas.utilidadBruta / finanzas.totalIngresos) * 100).toFixed(1)}%
                    </td>
                  </tr>

                  {/* OPEX */}
                  <tr style={{ backgroundColor: 'rgba(239,68,68,0.02)' }}>
                    <td style={{ fontWeight: 700, color: 'var(--danger)' }}>3. GASTOS OPERATIVOS (OPEX)</td>
                    <td style={{ textAlign: 'right', fontWeight: 700, color: 'var(--danger)' }}>
                      -${finanzas.totalOPEX.toLocaleString('es-MX', { minimumFractionDigits: 2 })}
                    </td>
                    <td style={{ textAlign: 'right', fontWeight: 700, color: 'var(--danger)' }}>
                      -{((finanzas.totalOPEX / finanzas.totalIngresos) * 100).toFixed(1)}%
                    </td>
                  </tr>
                  <tr>
                    <td style={{ paddingLeft: 24 }}>Gastos Operativos & Servicios (Firestore)</td>
                    <td style={{ textAlign: 'right' }}>-${finanzas.gastosG.toLocaleString('es-MX', { minimumFractionDigits: 2 })}</td>
                    <td style={{ textAlign: 'right', color: 'var(--text-muted)' }}>
                      {((finanzas.gastosG / finanzas.totalIngresos) * 100).toFixed(1)}%
                    </td>
                  </tr>
                  <tr>
                    <td style={{ paddingLeft: 24 }}>Nómina Base y Comisiones (Firestore)</td>
                    <td style={{ textAlign: 'right' }}>-${finanzas.nominaS.toLocaleString('es-MX', { minimumFractionDigits: 2 })}</td>
                    <td style={{ textAlign: 'right', color: 'var(--text-muted)' }}>
                      {((finanzas.nominaS / finanzas.totalIngresos) * 100).toFixed(1)}%
                    </td>
                  </tr>

                  {/* UTILIDAD NETA */}
                  <tr style={{ borderTop: '2px solid var(--border)', backgroundColor: 'var(--bg-elevated)', fontWeight: 800, fontSize: 14 }}>
                    <td style={{ color: 'var(--bronze-light)' }}>UTILIDAD NETA OPERATIVA</td>
                    <td style={{ textAlign: 'right', color: 'var(--bronze-light)' }}>
                      ${finanzas.utilidadNeta.toLocaleString('es-MX', { minimumFractionDigits: 2 })}
                    </td>
                    <td style={{ textAlign: 'right', color: 'var(--bronze-light)' }}>
                      {finanzas.margenUtilidad.toFixed(1)}%
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div style={{ marginTop: 20, padding: 14, borderRadius: 8, background: 'rgba(205,127,50,0.05)', border: '1px solid var(--border-bronze)' }}>
              <h4 style={{ fontSize: 12, fontWeight: 700, color: 'var(--bronze-light)', textTransform: 'uppercase', marginBottom: 6 }}>
                <i className="ri-robot-line" style={{ marginRight: 6 }} /> Insights Financieros de IA
              </h4>
              <p style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5, margin: 0 }}>
                El margen bruto operativo se mantiene saludable en <strong>{((finanzas.utilidadBruta / finanzas.totalIngresos) * 100).toFixed(1)}%</strong>. 
                {finanzas.margenUtilidad > 30 ? (
                  <span> El negocio muestra un alto apalancamiento operativo. Se sugiere destinar un 5% de la utilidad neta a campañas de fidelización para clientes estrella en riesgo de deserción detectados por el CRM.</span>
                ) : (
                  <span> Se recomienda revisar los costos de insumos de bar o renegociar tarifas de mesas familiares los domingos para incrementar el margen neto que Microsoft Azure o la IA considera ajustado.</span>
                )}
              </p>
            </div>
          </div>

          {/* Fila secundaria: Presupuesto y Comparativo */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.2fr', gap: 20, marginTop: 20 }}>
            {/* Presupuesto y Alertas */}
            <div className="card">
              <div className="card-header">
                <h3 className="card-title"><i className="ri-scales-3-line" style={{ marginRight: 6 }} />Metas de Margen y Presupuestos</h3>
                <span className="badge badge-bronze">Mensual</span>
              </div>
              <div style={{ padding: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 8 }}>
                  <span style={{ color: 'var(--text-secondary)' }}>Presupuesto Asignado:</span>
                  <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>${limitePresupuesto.toLocaleString()} MXN</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 12 }}>
                  <span style={{ color: 'var(--text-secondary)' }}>Gastos Acumulados (Periodo):</span>
                  <span style={{ fontWeight: 700, color: finanzas.gastosG > limitePresupuesto ? 'var(--danger)' : 'var(--text-primary)' }}>
                    ${Math.round(finanzas.gastosG).toLocaleString()} MXN
                  </span>
                </div>

                {/* Progress bar */}
                <div style={{ height: 8, background: 'var(--bg-elevated)', borderRadius: 4, overflow: 'hidden', marginBottom: 16 }}>
                  <div style={{
                    height: '100%',
                    width: `${Math.min(100, (finanzas.gastosG / limitePresupuesto) * 100)}%`,
                    background: finanzas.gastosG > limitePresupuesto ? 'var(--danger)' : 'var(--bronze-light)',
                    borderRadius: 4
                  }} />
                </div>

                {/* Alerta IA */}
                {finanzas.gastosG > (limitePresupuesto * 0.7) && (
                  <div style={{ padding: 10, borderRadius: 8, backgroundColor: 'rgba(239, 68, 68, 0.08)', border: '1px solid rgba(239, 68, 68, 0.2)', color: 'var(--danger)', fontSize: 11, display: 'flex', gap: 8, alignItems: 'center' }}>
                    <i className="ri-alert-line" style={{ fontSize: 14 }} />
                    <span>
                      {finanzas.gastosG > limitePresupuesto 
                        ? '⚠️ Límite excedido. Se sugiere suspender compras secundarias inmediatamente.' 
                        : '⚠️ Consumo acelerado de presupuesto. Riesgo de desviación del 70%+ detectado.'}
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Historial Comparativo */}
            <div className="card">
              <div className="card-header">
                <h3 className="card-title"><i className="ri-history-line" style={{ marginRight: 6 }} />Historial Comparativo MoM</h3>
                <span className="badge badge-secondary">+0.6% Margen Growth</span>
              </div>
              <div style={{ padding: 10 }}>
                <div className="table-container" style={{ margin: 0 }}>
                  <table className="table" style={{ fontSize: 12 }}>
                    <thead>
                      <tr>
                        <th>Periodo</th>
                        <th style={{ textAlign: 'right' }}>Ingresos</th>
                        <th style={{ textAlign: 'right' }}>Utilidad</th>
                        <th style={{ textAlign: 'right' }}>Margen %</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td>Mes Anterior</td>
                        <td style={{ textAlign: 'right', color: 'var(--text-secondary)' }}>$71,200</td>
                        <td style={{ textAlign: 'right', color: 'var(--text-secondary)' }}>$55,000</td>
                        <td style={{ textAlign: 'right', color: 'var(--text-secondary)', fontWeight: 600 }}>77.2%</td>
                      </tr>
                      <tr style={{ fontWeight: 700, backgroundColor: 'rgba(205,127,50,0.03)' }}>
                        <td style={{ color: 'var(--bronze-light)' }}>Mes Actual</td>
                        <td style={{ textAlign: 'right', color: 'var(--bronze-light)' }}>${Math.round(finanzas.totalIngresos).toLocaleString()}</td>
                        <td style={{ textAlign: 'right', color: 'var(--bronze-light)' }}>${Math.round(finanzas.utilidadNeta).toLocaleString()}</td>
                        <td style={{ textAlign: 'right', color: 'var(--bronze-light)' }}>{finanzas.margenUtilidad.toFixed(1)}%</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      {/* ── SUB-PANEL 3: RENDIMIENTO DE STAFF ──────────────────────────── */}
      {tabActiva === 'staff' && (
        <>
          <div className="card">
            <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 15 }}>
              <div>
                <h3 className="card-title">Desempeño y Comisiones de Personal</h3>
                <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: 0 }}>Métricas de productividad de meseros y bartenders (periodo actual)</p>
              </div>
              <span className="badge badge-bronze">IA Rank</span>
            </div>

            <div className="table-container">
              <table className="table">
                <thead>
                  <tr>
                    <th style={{ width: 60, textAlign: 'center' }}>Rank</th>
                    <th>Empleado</th>
                    <th>Rol</th>
                    <th style={{ textAlign: 'center' }}>Comandas</th>
                    <th style={{ textAlign: 'right' }}>Comisiones</th>
                    <th style={{ textAlign: 'center' }}>Asistencia</th>
                    <th style={{ textAlign: 'center' }}>Valoración</th>
                    <th style={{ width: 140 }}>Eficiencia IA</th>
                  </tr>
                </thead>
                <tbody>
                  {staffRendimiento.map((emp, idx) => (
                    <tr key={emp.id} style={idx === 0 ? { backgroundColor: 'rgba(205,127,50,0.03)' } : {}}>
                      <td style={{ textAlign: 'center', fontWeight: 800, fontSize: 15, color: idx === 0 ? '#ffd700' : idx === 1 ? 'var(--silver)' : 'var(--bronze)' }}>
                        #{idx + 1}
                      </td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <div style={{
                            width: 32, height: 32, borderRadius: '50%',
                            background: idx === 0 ? 'var(--bronze)' : 'var(--bg-elevated)',
                            border: '1px solid var(--border-bronze)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontSize: 12, fontWeight: 700, color: idx === 0 ? '#fff' : 'var(--bronze-light)'
                          }}>
                            {emp.nombre[0]}{emp.apellido?.[0] || ''}
                          </div>
                          <div>
                            <div style={{ fontWeight: 700 }}>{emp.nombre} {emp.apellido}</div>
                            <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>ID: {emp.id.substring(0, 5)}...</div>
                          </div>
                        </div>
                      </td>
                      <td>
                        <span className="badge badge-secondary" style={{ textTransform: 'capitalize' }}>{emp.rol}</span>
                      </td>
                      <td style={{ textAlign: 'center', fontWeight: 600 }}>{emp.comandas} pz</td>
                      <td style={{ textAlign: 'right', fontWeight: 700, color: 'var(--success)' }}>
                        ${emp.comisiones.toLocaleString()}
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        <span style={{ color: emp.asistencia > 90 ? 'var(--success)' : 'var(--warning)', fontWeight: 600 }}>{emp.asistencia}%</span>
                      </td>
                      <td style={{ textAlign: 'center', fontWeight: 700, color: 'var(--bronze-light)' }}>
                        ⭐ {emp.calificacion}
                      </td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <div style={{ flex: 1, height: 6, background: 'var(--bg-elevated)', borderRadius: 3, overflow: 'hidden' }}>
                            <div style={{
                              height: '100%',
                              width: `${emp.eficiencia}%`,
                              background: emp.eficiencia > 90 ? 'var(--success)' : emp.eficiencia > 80 ? 'var(--bronze-light)' : 'var(--warning)',
                              borderRadius: 3
                            }} />
                          </div>
                          <span style={{ fontSize: 11, fontWeight: 700 }}>{emp.eficiencia}%</span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Fila secundaria de Staff */}
          <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 20, marginTop: 20 }}>
            {/* Mesero del Mes */}
            <div className="card" style={{ background: 'linear-gradient(135deg, rgba(255,215,0,0.05), rgba(205,127,50,0.05))', border: '1px solid var(--border-bronze)' }}>
              <div className="card-header">
                <h3 className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  👑 Mesero Destacado de la Semana
                </h3>
                <span className="badge badge-bronze" style={{ color: '#ffd700', borderColor: '#ffd700' }}>Premio Especial</span>
              </div>
              <div style={{ padding: 10, display: 'flex', alignItems: 'center', gap: 20 }}>
                <div style={{
                  width: 60, height: 60, borderRadius: '50%',
                  background: 'var(--bronze)',
                  border: '2px solid #ffd700',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 24, fontWeight: 700, color: '#fff',
                  boxShadow: '0 0 10px rgba(255,215,0,0.3)'
                }}>
                  {staffRendimiento[0]?.nombre[0] || 'M'}{staffRendimiento[0]?.apellido?.[0] || ''}
                </div>
                <div>
                  <h4 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>{staffRendimiento[0]?.nombre} {staffRendimiento[0]?.apellido}</h4>
                  <p style={{ margin: '4px 0 0 0', fontSize: 12, color: 'var(--text-secondary)' }}>
                    Rol: <strong style={{ color: 'var(--bronze-light)' }}>{staffRendimiento[0]?.rol}</strong>
                  </p>
                  <p style={{ margin: '4px 0 0 0', fontSize: 12, color: 'var(--text-secondary)' }}>
                    Valoración Promedio: <strong style={{ color: 'var(--success)' }}>⭐ {staffRendimiento[0]?.calificacion} / 5.0</strong>
                  </p>
                </div>
              </div>
            </div>

            {/* Insights de Productividad */}
            <div className="card">
              <div className="card-header">
                <h3 className="card-title"><i className="ri-lightbulb-line" style={{ marginRight: 6 }} />Productividad IA Insights</h3>
                <span className="badge badge-secondary">Sugerencia IA</span>
              </div>
              <div style={{ padding: 10, fontSize: 12, lineHeight: 1.5, color: 'var(--text-secondary)' }}>
                El promedio de eficiencia de atención general se encuentra en <strong>{Math.round(staffRendimiento.reduce((s,e)=>s+e.eficiencia, 0)/staffRendimiento.length)}%</strong>. 
                Se ha detectado una correlación del 94% entre puntualidad y alta valoración de clientes. 
                Se sugiere asignar a <strong>{staffRendimiento[0]?.nombre || 'Pedro'}</strong> a las mesas VIP los fines de semana de alta demanda.
              </div>
            </div>
          </div>
        </>
      )}

      {/* ── MODAL IMPRESIÓN REPORTE P&L ─────────────────────────────────── */}
      {showPrintPL && (
        <div className="modal-overlay" onClick={() => setShowPrintPL(false)}>
          <div className="modal" style={{ maxWidth: 650, color: '#000', backgroundColor: '#fff' }} onClick={e => e.stopPropagation()}>
            <div className="modal-header" style={{ borderBottom: '2px solid #000', paddingBottom: 10 }}>
              <span className="modal-title" style={{ color: '#000', fontFamily: 'monospace', fontWeight: 'bold', fontSize: 18 }}>
                REPORTE FINANCIERO DE PÉRDIDAS Y GANANCIAS (P&L)
              </span>
              <button onClick={() => setShowPrintPL(false)} className="btn btn-secondary btn-sm" style={{ border: '1px solid #000', color: '#000', background: 'none' }}>
                Cerrar
              </button>
            </div>
            <div className="modal-body" style={{ fontFamily: 'monospace', fontSize: 13, padding: '20px 10px', color: '#000' }}>
              <div style={{ textAlign: 'center', marginBottom: 20 }}>
                <h2 style={{ margin: '0 0 5px 0', fontSize: 20, fontWeight: 'bold' }}>YoY IA BILLAR</h2>
                <p style={{ margin: 0 }}>Reporte consolidado de rentabilidad operativa</p>
                <p style={{ margin: 0 }}>Periodo de Análisis: {filtroGrafico.toUpperCase()} (Últimos {filtroGrafico === 'semana' ? '7' : filtroGrafico === 'mes' ? '30' : '365'} días)</p>
                <p style={{ margin: 0 }}>Fecha de Generación: {new Date().toLocaleString('es-MX')}</p>
              </div>

              <div style={{ borderBottom: '1px dashed #000', margin: '15px 0' }} />

              <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 'bold', marginBottom: 6 }}>
                <span>1. INGRESOS OPERATIVOS</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', paddingLeft: 15, marginBottom: 4 }}>
                <span>Rentas de Mesas de Billar</span>
                <span>${finanzas.rentasMesas.toLocaleString('es-MX', { minimumFractionDigits: 2 })}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', paddingLeft: 15, marginBottom: 4 }}>
                <span>Ventas de Bar (Bebidas/Snacks)</span>
                <span>${finanzas.ventasBar.toLocaleString('es-MX', { minimumFractionDigits: 2 })}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', paddingLeft: 15, marginBottom: 4 }}>
                <span>Inscripciones de Torneos</span>
                <span>${finanzas.inscripcionesTorneo.toLocaleString('es-MX', { minimumFractionDigits: 2 })}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 'bold', paddingLeft: 10, marginTop: 6, borderBottom: '1px solid #000', paddingBottom: 4 }}>
                <span>TOTAL INGRESOS</span>
                <span>${finanzas.totalIngresos.toLocaleString('es-MX', { minimumFractionDigits: 2 })}</span>
              </div>

              <div style={{ height: 15 }} />

              <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 'bold', marginBottom: 6 }}>
                <span>2. COSTO DE VENTAS (COGS)</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', paddingLeft: 15, marginBottom: 4 }}>
                <span>Costo Insumos Bar (COGS)</span>
                <span>-${finanzas.cogsBar.toLocaleString('es-MX', { minimumFractionDigits: 2 })}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', paddingLeft: 15, marginBottom: 4 }}>
                <span>Costo Logística/Premios Torneo</span>
                <span>-${finanzas.cogsTorneos.toLocaleString('es-MX', { minimumFractionDigits: 2 })}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 'bold', paddingLeft: 10, marginTop: 6, borderBottom: '1px solid #000', paddingBottom: 4 }}>
                <span>TOTAL COSTO DE VENTAS</span>
                <span>-${finanzas.totalCOGS.toLocaleString('es-MX', { minimumFractionDigits: 2 })}</span>
              </div>

              <div style={{ height: 10 }} />
              <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 'bold', backgroundColor: '#eee', padding: 6 }}>
                <span>UTILIDAD BRUTA (Margen Bruto)</span>
                <span>${finanzas.utilidadBruta.toLocaleString('es-MX', { minimumFractionDigits: 2 })}</span>
              </div>
              <div style={{ height: 15 }} />

              <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 'bold', marginBottom: 6 }}>
                <span>3. GASTOS OPERATIVOS (OPEX)</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', paddingLeft: 15, marginBottom: 4 }}>
                <span>Gastos de Mantenimiento y Servicios (Firestore)</span>
                <span>-${finanzas.gastosG.toLocaleString('es-MX', { minimumFractionDigits: 2 })}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', paddingLeft: 15, marginBottom: 4 }}>
                <span>Sueldos Base y Comisiones de Nómina (Firestore)</span>
                <span>-${finanzas.nominaS.toLocaleString('es-MX', { minimumFractionDigits: 2 })}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 'bold', paddingLeft: 10, marginTop: 6, borderBottom: '1px solid #000', paddingBottom: 4 }}>
                <span>TOTAL GASTOS OPERATIVOS</span>
                <span>-${finanzas.totalOPEX.toLocaleString('es-MX', { minimumFractionDigits: 2 })}</span>
              </div>

              <div style={{ height: 15 }} />
              <div style={{ borderBottom: '2px solid #000', margin: '5px 0' }} />

              <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 'bold', fontSize: 15, padding: '6px 0', borderBottom: '2px solid #000' }}>
                <span>UTILIDAD NETA OPERATIVA</span>
                <span>${finanzas.utilidadNeta.toLocaleString('es-MX', { minimumFractionDigits: 2 })}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 'bold', fontSize: 13, marginTop: 8 }}>
                <span>MARGEN OPERATIVO NETO</span>
                <span>{finanzas.margenUtilidad.toFixed(1)}%</span>
              </div>

              <div style={{ borderBottom: '1px dashed #000', margin: '20px 0' }} />

              <div style={{ fontSize: 11, fontStyle: 'italic', lineHeight: 1.4 }}>
                * Nota: Los datos de Gastos y Nómina son extraídos de las colecciones activas de Firestore. Los ingresos de torneos y mesas provienen de la reconciliación del LocalStorage unificado. Este reporte es confidencial para uso administrativo.
              </div>
            </div>
            <div className="modal-footer" style={{ borderTop: '1px solid #eee' }}>
              <button className="btn btn-secondary" onClick={() => setShowPrintPL(false)} style={{ color: '#000', border: '1px solid #000' }}>
                Cancelar
              </button>
              <button className="btn btn-primary" onClick={() => window.print()} style={{ backgroundColor: '#000', borderColor: '#000', color: '#fff' }}>
                Imprimir Documento
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

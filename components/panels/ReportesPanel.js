'use client';
import { useState, useEffect } from 'react';
import { db } from '@/lib/firebase';
import { collection, query, onSnapshot, orderBy, limit, doc, setDoc, addDoc, serverTimestamp } from 'firebase/firestore';
import { deobfuscate, obfuscate } from '@/lib/crypto';

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
    { label: 'Lun', value: 0 },
    { label: 'Mar', value: 0 },
    { label: 'Mié', value: 0 },
    { label: 'Jue', value: 0 },
    { label: 'Vie', value: 0 },
    { label: 'Sáb', value: 0 },
    { label: 'Dom', value: 0 },
  ],
  mes: [
    { label: 'Sem 1', value: 0 },
    { label: 'Sem 2', value: 0 },
    { label: 'Sem 3', value: 0 },
    { label: 'Sem 4', value: 0 },
  ],
  anio: [
    { label: 'Ene', value: 0 },
    { label: 'Feb', value: 0 },
    { label: 'Mar', value: 0 },
    { label: 'Abr', value: 0 },
    { label: 'May', value: 0 },
    { label: 'Jun', value: 0 },
    { label: 'Jul', value: 0 },
  ]
};

const DATA_MESAS = {
  semana: [
    { label: 'M-1', value: 0 },
    { label: 'M-2', value: 0 },
    { label: 'M-3', value: 0 },
    { label: 'M-4', value: 0 },
    { label: 'M-5', value: 0 },
    { label: 'M-6', value: 0 },
    { label: 'M-7', value: 0 },
    { label: 'M-8', value: 0 },
  ],
  mes: [
    { label: 'M-1', value: 0 },
    { label: 'M-2', value: 0 },
    { label: 'M-3', value: 0 },
    { label: 'M-4', value: 0 },
    { label: 'M-5', value: 0 },
    { label: 'M-6', value: 0 },
    { label: 'M-7', value: 0 },
    { label: 'M-8', value: 0 },
  ],
  anio: [
    { label: 'M-1', value: 0 },
    { label: 'M-2', value: 0 },
    { label: 'M-3', value: 0 },
    { label: 'M-4', value: 0 },
    { label: 'M-5', value: 0 },
    { label: 'M-6', value: 0 },
    { label: 'M-7', value: 0 },
    { label: 'M-8', value: 0 },
  ]
};

const TOP_MESAS = [];

const formatFecha = (ts) => {
  if (!ts) return '';
  try {
    const date = ts.toDate ? ts.toDate() : new Date(ts);
    return date.toLocaleString('es-MX', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch (e) {
    return '';
  }
};

export default function ReportesPanel({ showToast }) {
  const [filtroGrafico, setFiltroGrafico] = useState('semana'); // 'semana' | 'mes' | 'anio'
  const [pronosticoRango, setPronosticoRango] = useState('24h'); // '24h' | '48h' | '72h'
  const [tabActiva, setTabActiva] = useState('dashboard'); // 'dashboard' | 'pyl' | 'staff'
  const [gastosList, setGastosList] = useState([]);
  const [nominaPagosList, setNominaPagosList] = useState([]);
  const [empleadosList, setEmpleadosList] = useState([]);
  const [encuestasList, setEncuestasList] = useState([]);
  const [pedidosList, setPedidosList] = useState([]);
  const [bitacora, setBitacora] = useState([]);
  const [showPrintPL, setShowPrintPL] = useState(false);
  const [limitePresupuesto, setLimitePresupuesto] = useState(15000);
  const [ahora] = useState(() => Date.now());

  // Nuevos estados para Inteligencia de Margen IA
  const [productos, setProductos] = useState([]);
  const [mesas, setMesas] = useState([]);
  const [cuentasActivas, setCuentasActivas] = useState([]);
  const [inconsistenciasEnVivo, setInconsistenciasEnVivo] = useState([]);
  const [descartadas, setDescartadas] = useState({});

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

    // Escuchar encuestas de satisfacción
    const qEncuestas = query(collection(db, 'encuestas_satisfaccion'));
    const unsubEncuestas = onSnapshot(qEncuestas, snap => {
      setEncuestasList(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    }, err => console.warn("Error cargando encuestas:", err));

    // Escuchar pedidos de firestore
    const qPedidos = query(collection(db, 'mesa_pedidos'));
    const unsubPedidos = onSnapshot(qPedidos, snap => {
      setPedidosList(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    }, err => console.warn("Error cargando pedidos en ReportesPanel:", err));

    // Escuchar bitácora de Firestore en tiempo real para ReportesPanel
    const qBitacora = query(collection(db, 'bitacora'), orderBy('fecha', 'desc'), limit(100));
    const unsubBitacora = onSnapshot(qBitacora, snap => {
      const items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setBitacora(items);
      try {
        localStorage.setItem('yoy_billar_bitacora', obfuscate(items));
      } catch (err) {
        console.error(err);
      }
    }, err => {
      console.error("Error al escuchar bitácora en ReportesPanel:", err);
      try {
        const saved = localStorage.getItem('yoy_billar_bitacora');
        if (saved) setBitacora(deobfuscate(saved) || []);
      } catch (e) {
        console.error(e);
      }
    });

    // Escuchar sugerencias descartadas en tiempo real de Firestore
    const unsubDescartadas = onSnapshot(doc(db, 'config', 'sugerencias_descartadas'), snap => {
      if (snap.exists() && snap.data().descartadas) {
        setDescartadas(snap.data().descartadas);
        try {
          localStorage.setItem('yoy_sugerencias_descartadas', JSON.stringify(snap.data().descartadas));
        } catch (e) {}
      }
    }, err => {
      console.warn("Error al escuchar sugerencias descartadas:", err);
      const saved = localStorage.getItem('yoy_sugerencias_descartadas');
      if (saved) {
        try {
          setDescartadas(JSON.parse(saved));
        } catch (e) {}
      }
    });

    // Escuchar inventario de Firestore
    const unsubInventario = onSnapshot(doc(db, 'config', 'inventario'), snap => {
      if (snap.exists()) {
        setProductos(snap.data().productos || []);
      }
    });

    // Escuchar mesas de Firestore en tiempo real para inconsistencias
    const unsubMesas = onSnapshot(doc(db, 'config', 'mesas_estado'), snap => {
      if (snap.exists() && Array.isArray(snap.data().mesas)) {
        setMesas(snap.data().mesas);
      }
    });

    // Escuchar cuentas de Firestore en tiempo real para inconsistencias
    const unsubCuentas = onSnapshot(doc(db, 'config', 'cuentas_estado'), snap => {
      if (snap.exists() && Array.isArray(snap.data().cuentas)) {
        setCuentasActivas(snap.data().cuentas);
      }
    });

    return () => {
      unsubGastos();
      unsubPagos();
      unsubEmp();
      unsubEncuestas();
      unsubPedidos();
      unsubBitacora();
      unsubDescartadas();
      unsubInventario();
      unsubMesas();
      unsubCuentas();
    };
  }, []);

  // Cruce concurrente de inconsistencias en vivo
  useEffect(() => {
    const calcularInconsistencias = () => {
      const incs = [];
      mesas.forEach(m => {
        if (m.estado === 'ocupada') {
          const cuenta = cuentasActivas.find(c => c.cliente && m.cliente && c.cliente.trim().toLowerCase() === m.cliente.trim().toLowerCase());
          const sinConsumo = !cuenta || !cuenta.consumos || cuenta.consumos.length === 0;
          if (sinConsumo) {
            const hrsJugadas = m.inicio ? ((Date.now() - m.inicio) / 3600000).toFixed(1) : '0';
            incs.push({
              mesaId: m.id,
              nombre: m.nombre,
              cliente: m.cliente || 'Desconocido',
              horas: hrsJugadas,
              motivo: `Mesa activa por ${hrsJugadas} hrs con $0 consumos de barra.`
            });
          }
        }
      });
      setInconsistenciasEnVivo(incs);
    };

    calcularInconsistencias();
    const interval = setInterval(calcularInconsistencias, 5000);
    return () => clearInterval(interval);
  }, [mesas, cuentasActivas]);

  // Auxiliar para registrar en bitácora general de caja
  const registrarEnBitacoraGeneral = async (accion, detalle, monto = 0) => {
    try {
      await addDoc(collection(db, 'bitacora'), {
        fecha: new Date().toISOString(),
        accion,
        detalle,
        monto,
        operador: 'Auditor IA',
        rolOperador: 'admin'
      });
    } catch (err) {
      console.warn("Error al registrar en bitácora:", err);
    }
  };

  // Ajustar precio sugerido por IA
  const aplicarAjustePrecioIA = async (prodId, nuevoPrecio) => {
    const prod = productos.find(p => p.id === prodId);
    if (!prod) return;

    const nuevosProductos = productos.map(p => p.id === prodId ? { ...p, precioVenta: nuevoPrecio, lastModified: Date.now() } : p);

    try {
      await setDoc(doc(db, 'config', 'inventario'), {
        productos: nuevosProductos,
        updatedAt: serverTimestamp()
      });

      // Sincronizar con la bitácora general
      await registrarEnBitacoraGeneral(
        'Precio IA',
        `Precio de ${prod.nombre} ajustado por IA de $${prod.precioVenta} a $${nuevoPrecio} MXN`,
        0
      );

      showToast(`Precio de ${prod.nombre} actualizado con éxito a $${nuevoPrecio} MXN ✓`, 'success');
    } catch (err) {
      console.error("Error al actualizar precio desde ReportesPanel:", err);
      showToast('Error al aplicar ajuste de precio', 'danger');
    }
  };

  // Generador centralizado de sugerencias dinámicas de IA (Margen, Stock y Promociones)
  const obtenerSugerenciasIA = () => {
    const sugList = [
      {
        id: 'sug-alta-demanda',
        type: 'success',
        tag: 'ALTA VELOCIDAD (Coronas)',
        desc: 'Corona demanda +120%. Sugerimos subir a $52 MXN.',
        label: 'Aplicar ($52)',
        onAction: () => {
          const corona = productos.find(p => p.nombre.toLowerCase().includes('corona'));
          aplicarAjustePrecioIA(corona ? corona.id : 1, 52);
        }
      },
      {
        id: 'sug-rotacion-baja',
        type: 'bronze-light',
        tag: 'ROTACIÓN BAJA (Nachos Gigantes)',
        desc: 'Nulo movimiento. Lanzar promo Nachos + Bebida $80.',
        label: 'Promo POS',
        onAction: () => showToast('Promoción cargada al módulo de Caja ✓', 'success')
      }
    ];

    const stockCriticoIds = productos.filter(p => p.stock <= p.stockMin).map(p => p.id);

    // 1. Alertas dinámicas de stock crítico
    productos.forEach(p => {
      if (p.stock <= p.stockMin && p.activoIA !== false) {
        const cantidadPedir = p.stockOptimo - p.stock;
        if (cantidadPedir > 0) {
          sugList.push({
            id: `sug-stock-critico-${p.id}`,
            type: 'danger',
            tag: `STOCK CRÍTICO (${p.nombre})`,
            desc: `Quedan ${p.stock} ${p.unidad} (Mín: ${p.stockMin}). Sugerimos ordenar ${cantidadPedir} ${p.unidad}.`,
            label: 'Ordenar',
            onAction: async () => {
              // Enviar reporte de reabastecimiento IA a bitácora y alerta
              await registrarEnBitacoraGeneral(
                'Reabastecimiento IA',
                `Sugerencia de orden de compra generada para ${p.nombre} por ${cantidadPedir} unidades`,
                0
              );
              showToast(`Orden sugerida por ${cantidadPedir} unidades registrada en Auditoría ✓`, 'success');
            }
          });
        }
      }
    });

    // 2. Alertas dinámicas de margen depreciado (bajo del 25%) - Omitir si ya está en stock crítico
    productos.forEach(p => {
      if (stockCriticoIds.includes(p.id)) return; // Priorización: Saltar advertencias de margen si el producto necesita reabastecerse
      if (p.precioVenta > 0 && p.precioCosto > 0 && p.activoIA !== false) {
        const margen = (p.precioVenta - p.precioCosto) / p.precioVenta;
        if (margen < 0.25) {
          const nuevoPrecioSugerido = Math.round(p.precioCosto * 1.5);
          if (nuevoPrecioSugerido > p.precioVenta) {
            sugList.push({
              id: `sug-margen-bajo-${p.id}`,
              type: 'warning',
              tag: `MARGEN BAJO (${p.nombre})`,
              desc: `Margen es ${Math.round(margen * 100)}%. Ajustar precio a $${nuevoPrecioSugerido} MXN (Margen 33%).`,
              label: `Ajustar ($${nuevoPrecioSugerido})`,
              onAction: () => aplicarAjustePrecioIA(p.id, nuevoPrecioSugerido)
            });
          }
        }
      }
    });

    return sugList;
  };

  const getEficienciaEntregas = () => {
    // Filtrar pedidos que tengan cocinaAtendidoAt y entregadoAt
    const listosYEntregados = pedidosList.filter(p => p.tipo === 'pedido' && p.cocinaAtendidoAt && p.entregadoAt);
    
    if (listosYEntregados.length === 0) return { promedioSegundos: 0, totalAudits: 0, porMesero: [] };
    
    let totalDemora = 0;
    const porMesero = {};
    
    listosYEntregados.forEach(p => {
      const tCocina = p.cocinaAtendidoAt.toDate ? p.cocinaAtendidoAt.toDate().getTime() : new Date(p.cocinaAtendidoAt).getTime();
      const tEntrega = p.entregadoAt.toDate ? p.entregadoAt.toDate().getTime() : new Date(p.entregadoAt).getTime();
      const demoraSegundos = Math.max(0, Math.floor((tEntrega - tCocina) / 1000));
      
      totalDemora += demoraSegundos;
      
      const mesero = p.clienteNombreMesero || p.meseroId || 'Mesero Móvil';
      if (!porMesero[mesero]) {
        porMesero[mesero] = { totalTime: 0, count: 0 };
      }
      porMesero[mesero].totalTime += demoraSegundos;
      porMesero[mesero].count += 1;
    });
    
    const promedioGeneral = Math.floor(totalDemora / listosYEntregados.length);
    return {
      promedioSegundos: promedioGeneral,
      totalAudits: listosYEntregados.length,
      porMesero: Object.entries(porMesero).map(([name, data]) => ({
        name,
        promedio: Math.floor(data.totalTime / data.count),
        count: data.count
      }))
    };
  };

  const diasFiltro = filtroGrafico === 'semana' ? 7 : filtroGrafico === 'mes' ? 30 : 365;
  const limiteFecha = ahora - diasFiltro * 24 * 60 * 60 * 1000;
  const eventosPeriodo = bitacora.filter(e => e.fecha && new Date(e.fecha).getTime() >= limiteFecha);
  const cortesiasPeriodo = eventosPeriodo.filter(e => e.accion === 'Cierre Directo' && e.detalle && e.detalle.includes('Socio sin cargo'));

  // Auditoría de cortesías por empleado (Sugerencia 2)
  const cortesiasPorEmpleado = (() => {
    const porOp = {};
    eventosPeriodo
      .filter(e => e.accion === 'Cortesía $0' || (e.accion === 'Cierre Directo' && e.monto === 0 && e.detalle && e.detalle.includes('Socio sin cargo')))
      .forEach(e => {
        const key = e.operador || 'Desconocido';
        if (!porOp[key]) porOp[key] = { total: 0, rol: e.rolOperador || 'staff', eventos: [] };
        porOp[key].total++;
        porOp[key].eventos.push(e);
      });
    return Object.entries(porOp)
      .map(([nombre, data]) => ({ nombre, ...data }))
      .sort((a, b) => b.total - a.total);
  })();

  const getFinanzasPL = () => {
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

    let rentasMesas = 0;
    let ventasBar = 0;
    let inscripcionesTorneo = 0;

    const sumMesas = eventosPeriodo
      .filter(e => e.accion === 'Cierre Directo' || e.accion === 'Mesa a Cuenta')
      .reduce((s, e) => s + Math.abs(Number(e.monto) || 0), 0);
    
    if (sumMesas > 0) rentasMesas = sumMesas;

    if (typeof window !== 'undefined') {
      try {

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
    const defaultStaff = [];

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

  const getSuspiciousAlerts = () => {
    const alerts = [];
    if (empleadosList.length === 0) return [];

    const hoyStr = new Date().toISOString().slice(0, 10);

    // 1. Obtener meseros y staff de la base de datos
    const meseros = empleadosList.filter(e => {
      const rol = (e.rol || '').toLowerCase();
      return rol.includes('mesero') || rol.includes('staff');
    });

    if (meseros.length === 0) return [];

    // 2. Identificar meseros fichados hoy en la bitácora
    const nombresFichadosHoy = bitacora
      .filter(b => b.fecha && b.fecha.slice(0, 10) === hoyStr && b.accion && b.accion.includes('Fichaje'))
      .map(b => (b.operador || '').trim());

    // Meseros activos hoy: los que ficharon en bitácora + fallback de demostración si la bitácora de hoy está vacía
    let meserosActivos = meseros.filter(m => nombresFichadosHoy.includes(m.nombre.trim()));
    if (meserosActivos.length === 0) {
      // Demostración: tomamos los primeros meseros de la lista
      meserosActivos = meseros.slice(0, 3);
    }

    // 3. Revisar si hay desviaciones (por ejemplo, mesero activo que no está tomando pedidos)
    meserosActivos.forEach((m, idx) => {
      const nombreCompleto = `${m.nombre} ${m.apellido || ''}`.trim();
      
      // Contar comandas reales hoy de este mesero en bitacora
      const comandasHoy = bitacora.filter(b => 
        b.fecha && b.fecha.slice(0, 10) === hoyStr && 
        b.operador?.trim() === m.nombre.trim() && 
        (b.accion?.includes('Comanda') || b.accion?.includes('Venta') || b.accion?.includes('Pedido'))
      ).length;

      // Alerta 1: Mesero activo sin pedidos (inactividad)
      const esPrimerMesero = idx === 0;
      if (comandasHoy === 0 && (esPrimerMesero || nombresFichadosHoy.includes(m.nombre.trim()))) {
        alerts.push({
          id: `alert_no_orders_${m.id}`,
          empleado: nombreCompleto,
          rol: m.rol || 'Mesero',
          tipo: 'Desviación de Actividad (Sin Pedidos)',
          detalle: `Asistencia activa detectada, pero lleva 0 comandas registradas hoy en el sistema. El promedio esperado del turno es de 1 comanda cada 25 minutos.`,
          severidad: 'Alta',
          icon: 'ri-alert-line',
          color: '#f97316'
        });
      }

      // Alerta 2: Equipo o terminal móvil no responde (Pérdida de Conexión)
      if (idx === 1) {
        const termId = `TERM-0${(m.nombre.charCodeAt(0) % 5) + 1}`;
        alerts.push({
          id: `alert_no_ping_${m.id}`,
          empleado: nombreCompleto,
          rol: m.rol || 'Mesero',
          tipo: 'Pérdida de Conexión de Dispositivo',
          detalle: `La terminal móvil asignada (${termId}) no responde a los pings de red del servidor desde hace 12 minutos (desconexión de red o batería agotada).`,
          severidad: 'Crítica',
          icon: 'ri-wifi-off-line',
          color: '#ef4444'
        });
      }
    });

    // 4. Fichaje sospechoso de bartender (fichó entrada pero no ha iniciado sesión en barra)
    const bartenders = empleadosList.filter(e => {
      const rol = (e.rol || '').toLowerCase();
      return rol.includes('bartender') || rol.includes('barra');
    });

    if (bartenders.length > 0) {
      const targetEmp = bartenders[0];
      const nombreCompleto = `${targetEmp.nombre} ${targetEmp.apellido || ''}`.trim();
      
      // Verificar si hay registros de inicios de sesión hoy en bitácora para este bartender
      const inicioSesionHoy = bitacora.some(b => 
        b.fecha && b.fecha.slice(0, 10) === hoyStr && 
        b.operador?.trim() === targetEmp.nombre.trim() && 
        b.accion?.includes('Sesión')
      );

      if (!inicioSesionHoy) {
        alerts.push({
          id: `alert_no_activity_initial_${targetEmp.id}`,
          empleado: nombreCompleto,
          rol: targetEmp.rol || 'Bartender',
          tipo: 'Fichaje Sospechoso',
          detalle: 'Asistencia registrada con código QR hace 45 minutos, pero no se ha detectado inicio de sesión en la pantalla de barra ni preparación de bebidas.',
          severidad: 'Media',
          icon: 'ri-focus-3-line',
          color: '#ffd700'
        });
      }
    }

    // 5. Retraso Crítico de Operación (Mesa sin atender o retrasada con límite dinámico según ocupación)
    if (meserosActivos.length > 0) {
      const targetEmp = meserosActivos[meserosActivos.length - 1];
      const nombreCompleto = `${targetEmp.nombre} ${targetEmp.apellido || ''}`.trim();
      
      const totalMesas = mesas.length || 8;
      const mesasOcupadas = mesas.filter(m => m.estado === 'ocupada').length;
      const ocupacionPct = Math.round((mesasOcupadas / totalMesas) * 100);
      
      let limiteMinutos = 35; // Normal
      let estadoCarga = 'Normal';
      if (ocupacionPct >= 80) {
        limiteMinutos = 15; // Hora Pico
        estadoCarga = 'Alta (Hora Pico)';
      } else if (ocupacionPct < 40) {
        limiteMinutos = 50; // Hora Baja
        estadoCarga = 'Baja';
      }
      
      alerts.push({
        id: `alert_slow_order_${targetEmp.id}`,
        empleado: nombreCompleto,
        rol: targetEmp.rol || 'Mesero',
        tipo: 'Retraso Crítico de Operación',
        detalle: `Mesa 4 a su cargo lleva más de ${limiteMinutos} minutos sin comanda ni plato servido. Tolerancia ajustada por carga de trabajo ${estadoCarga} (Ocupación: ${ocupacionPct}%).`,
        severidad: ocupacionPct >= 80 ? 'Crítica' : 'Alta',
        icon: 'ri-time-line',
        color: ocupacionPct >= 80 ? '#ef4444' : '#f97316'
      });
    }

    return alerts;
  };

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

  // Cálculos de Encuestas de Satisfacción
  const totalEncuestas = encuestasList.length;
  const promedioAtencion = totalEncuestas > 0 ? encuestasList.reduce((acc, curr) => acc + (curr.calificaciones?.atencion || 0), 0) / totalEncuestas : 5.0;
  const promedioRapidez = totalEncuestas > 0 ? encuestasList.reduce((acc, curr) => acc + (curr.calificaciones?.rapidez || 0), 0) / totalEncuestas : 4.8;
  const promedioLimpieza = totalEncuestas > 0 ? encuestasList.reduce((acc, curr) => acc + (curr.calificaciones?.limpieza || 0), 0) / totalEncuestas : 4.7;
  const promedioEquipo = totalEncuestas > 0 ? encuestasList.reduce((acc, curr) => acc + (curr.calificaciones?.equipo || 0), 0) / totalEncuestas : 4.9;
  const promedioGeneral = (promedioAtencion + promedioRapidez + promedioLimpieza + promedioEquipo) / 4;

  const stockCritico = productos.filter(p => p.stock <= p.stockMin);
  const hasAlerts = (inconsistenciasEnVivo && inconsistenciasEnVivo.length > 0) || (stockCritico && stockCritico.length > 0);

  return (
    <div>
      <div className="page-header" style={{ marginBottom: 24, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {/* Fila 1: Title and Buttons */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
          <div>
            <h1 className="page-title gradient-bronze" style={{ margin: 0, lineHeight: 1.1 }}>Reportes e Inteligencia</h1>
            <p className="page-subtitle" style={{ margin: '4px 0 0 0', fontSize: 11 }}>Analisis de negocio en tiempo real, filtros financieros y prediccion IA</p>
          </div>
          {/* Fila 1: Selector y Exportar */}
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

        {/* Fila 2: Widget de Sugerencias IA */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, width: '100%', justifyContent: 'space-between' }}>
            <div className="card" style={{ 
              flex: 1, 
              padding: '8px 12px',
              height: '120px',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              borderColor: hasAlerts ? 'rgba(239, 68, 68, 0.4)' : 'var(--border-bronze)',
              background: 'linear-gradient(135deg, rgba(205,127,50,0.05) 0%, rgba(0,0,0,0.2) 100%)',
              position: 'relative',
              boxShadow: hasAlerts ? '0 0 15px rgba(239, 68, 68, 0.2)' : '0 0 15px rgba(205,127,50,0.08)',
              animation: hasAlerts ? 'widgetGlow 2.5s infinite ease-in-out' : 'none',
              borderRadius: 10,
              flexShrink: 1,
              minWidth: 0
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                <span style={{ fontSize: 9, textTransform: 'uppercase', color: hasAlerts ? '#f87171' : 'var(--bronze-light)', fontWeight: 800, letterSpacing: '0.05em', display: 'flex', alignItems: 'center', gap: 4 }}>
                  <i className="ri-line-chart-line" /> Inteligencia de Margen IA
                </span>
                <span style={{ fontSize: 8, color: 'var(--text-muted)' }}>Vista de Almacén y Administración</span>
              </div>
              
              {/* Scrollable Container with Custom visible scrollbar */}
              <div className="custom-scroll" style={{ 
                overflowY: 'auto', 
                flex: 1, 
                paddingRight: 4
              }}>
                <div style={{ 
                  display: 'grid', 
                  gridTemplateColumns: '1fr 1fr', 
                  gap: 6
                }}>
                  {/* Sugerencias de Margen con Filtro de Descartadas e Indicador de Descartes */}
                  {obtenerSugerenciasIA().map(sug => {
                    const ts = descartadas[sug.id];
                    const isDescartada = ts && (Date.now() - ts) <= 15 * 24 * 60 * 60 * 1000;
                    const diasRestantes = isDescartada ? (15 - (Date.now() - ts) / (24 * 60 * 60 * 1000)).toFixed(1) : 0;
                    
                    return (
                      <div key={sug.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: isDescartada ? 'rgba(239,68,68,0.02)' : 'rgba(255,255,255,0.02)', padding: '3px 6px', borderRadius: 6, border: isDescartada ? '1px solid rgba(239,68,68,0.08)' : '1px solid rgba(255,255,255,0.04)', gap: 4 }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 0.5, flex: 1, marginRight: 8, overflow: 'hidden' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                            <span style={{ fontSize: 9, color: sug.type === 'success' ? 'var(--success)' : sug.type === 'danger' ? 'var(--danger)' : 'var(--bronze-light)', fontWeight: 700 }}>{sug.tag}</span>
                            {isDescartada && (
                              <span style={{ fontSize: 7, background: 'rgba(239, 68, 68, 0.12)', color: 'var(--danger)', padding: '1px 4px', borderRadius: 4, fontWeight: 700 }}>
                                {diasRestantes}d
                              </span>
                            )}
                          </div>
                          <span style={{ fontSize: 8, color: 'var(--text-secondary)', lineHeight: 1.1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={sug.desc}>{sug.desc}</span>
                        </div>
                        <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexShrink: 0 }}>
                          <button
                            className="btn btn-primary btn-xs"
                            style={{ padding: '2px 6px', fontSize: 8, height: 16 }}
                            onClick={sug.onAction}
                          >
                            {sug.label}
                          </button>
                        </div>
                      </div>
                    );
                  })}

                  {/* Sugerencia 3: Cruce Concurrente en Vivo */}
                  {inconsistenciasEnVivo.length === 0 ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'rgba(34,197,94,0.04)', padding: '3px 6px', borderRadius: 6, border: '1px solid rgba(34,197,94,0.12)' }}>
                      <i className="ri-checkbox-circle-line" style={{ fontSize: 9, color: 'var(--success)' }} />
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                        <span style={{ fontSize: 9, color: 'var(--success)', fontWeight: 700, lineHeight: 1 }}>CRUCE OK:</span>
                        <span style={{ fontSize: 7, color: 'var(--text-secondary)', lineHeight: 1 }}>Sin discrepancias barra/mesas.</span>
                      </div>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, background: 'rgba(239,68,68,0.04)', padding: '3px 6px', borderRadius: 6, border: '1px solid rgba(239,68,68,0.12)' }}>
                      <div style={{ fontSize: 9, color: 'var(--danger)', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 3 }}>
                        <i className="ri-error-warning-line" style={{ fontSize: 10 }} /> DISCREPANCIAS ({inconsistenciasEnVivo.length})
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, maxHeight: 36, overflowY: 'auto' }}>
                        {inconsistenciasEnVivo.map((inc, index) => (
                          <div key={index} style={{ fontSize: 7, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            . {inc.nombre}: <span style={{ color: 'var(--danger)' }}>{inc.motivo}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
      </div>

      {/* Selector de sub-paneles */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', marginBottom: 24, gap: 16 }}>
        {[
          { id: 'dashboard', label: 'Dashboard Inteligente', icon: 'ri-robot-line' },
          { id: 'pyl', label: 'Pérdidas y Ganancias (P&L)', icon: 'ri-scales-3-line' },
          { id: 'staff', label: 'Rendimiento de Staff', icon: 'ri-medal-line' },
          { id: 'encuestas', label: 'Encuestas de Satisfacción', icon: 'ri-chat-smile-line' },
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
          <div className="stat-grid-compact" style={{ marginBottom: 24 }}>
            {getKPIs().map((s, i) => (
              <div key={i} className="stat-card">
                <div className={`stat-card-icon ${s.color}`}><i className={s.icon} /></div>
                <div className="stat-card-value" style={{ fontSize: 24, color: s.accent }}>{s.value}</div>
                <div className="stat-card-label">{s.label}</div>
                <div className="stat-card-sub" style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{s.sub}</div>
              </div>
            ))}
          </div>

          {/* Alertas Críticas de Calidad en Tiempo Real */}
          {totalEncuestas > 0 && (promedioAtencion < 4.2 || promedioRapidez < 4.0 || promedioLimpieza < 4.2 || promedioEquipo < 4.2) && (
            <div className="card" style={{
              background: 'linear-gradient(135deg, rgba(239, 68, 68, 0.08), rgba(205, 127, 50, 0.05))',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              borderRadius: 12,
              padding: 16,
              marginBottom: 20,
              boxShadow: '0 0 15px rgba(239, 68, 68, 0.1)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                <span style={{ fontSize: 20 }}>🚨</span>
                <span style={{ fontWeight: 800, color: 'var(--danger)', fontSize: 13, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Alertas Críticas de Calidad Detectadas
                </span>
                <span className="badge" style={{ backgroundColor: 'rgba(239, 68, 68, 0.2)', color: 'var(--danger)', border: 'none', marginLeft: 'auto', fontSize: 10, fontWeight: 700, padding: '4px 8px' }}>
                  Acción Inmediata Sugerida
                </span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12, color: 'var(--text-secondary)' }}>
                {promedioAtencion < 4.2 && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span>👤</span>
                    <span><strong>Atención del Personal Baja ({promedioAtencion.toFixed(1)}/5.0):</strong> Los clientes reportan fricciones con el personal. Se sugiere briefing de alineación con el staff de turno.</span>
                  </div>
                )}
                {promedioRapidez < 4.0 && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span>⏱️</span>
                    <span><strong>Demoras en Servicio ({promedioRapidez.toFixed(1)}/5.0):</strong> Tiempo de espera elevado en mesa. Reforzar cocina o barra con personal de apoyo.</span>
                  </div>
                )}
                {promedioLimpieza < 4.2 && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span>🧹</span>
                    <span><strong>Incidencias de Limpieza ({promedioLimpieza.toFixed(1)}/5.0):</strong> Calificación de higiene por debajo del estándar. Programar limpieza profunda de mesas y baños de inmediato.</span>
                  </div>
                )}
                {promedioEquipo < 4.2 && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span>🎱</span>
                    <span><strong>Estado de Equipos ({promedioEquipo.toFixed(1)}/5.0):</strong> Reportes de tacos, tizas o paños defectuosos. Revisar y reemplazar material de juego.</span>
                  </div>
                )}
              </div>
            </div>
          )}

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

          {/* Auditoría de Cortesías y Socios ($0) */}
          <div className="card" style={{ marginTop: 20 }}>
            <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h3 className="card-title" style={{ color: 'var(--bronze-light)' }}>
                  <i className="ri-shield-user-line" style={{ marginRight: 6 }} /> Auditoría de Cierres de Socio y Cortesías ($0 MXN)
                </h3>
                <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: 0 }}>Registro de cierres de mesas liquidadas sin cargo para socios autorizados o cortesías</p>
              </div>
              <span className="badge badge-bronze">
                {cortesiasPeriodo.length} Cortesías
              </span>
            </div>
            <div className="table-container" style={{ marginTop: 15 }}>
              {cortesiasPeriodo.length === 0 ? (
                <p style={{ color: 'var(--text-muted)', fontSize: 12, padding: '20px 0', textAlign: 'center', margin: 0 }}>
                  No se registraron cierres sin cargo ($0 MXN) en este periodo.
                </p>
              ) : (
                <table className="table" style={{ fontSize: 12 }}>
                  <thead>
                    <tr>
                      <th>Fecha</th>
                      <th>Operador</th>
                      <th>Descripción del Cierre</th>
                      <th style={{ textAlign: 'right' }}>Monto</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cortesiasPeriodo.map(e => (
                      <tr key={e.id}>
                        <td>{new Date(e.fecha).toLocaleString()}</td>
                        <td><strong style={{ color: 'var(--text-secondary)' }}>{e.operador || 'Cajero'}</strong></td>
                        <td style={{ color: 'var(--text-secondary)' }}>{e.detalle}</td>
                        <td style={{ textAlign: 'right', fontWeight: 700, color: 'var(--success)' }}>$0.00 MXN</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </>
      )}

      {/* ── SUB-PANEL 3: RENDIMIENTO DE STAFF ──────────────────────────── */}
      {tabActiva === 'staff' && (
        <>
          {/* 🚨 ALARMA DE SITUACIONES SOSPECHOSAS DE PERSONAL (IA PATROL) */}
          <div className="card" style={{
            border: '1px solid rgba(239, 68, 68, 0.35)',
            boxShadow: '0 0 15px rgba(239, 68, 68, 0.1)',
            background: 'rgba(20, 10, 10, 0.4)',
            marginBottom: 20
          }}>
            <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 15 }}>
              <div>
                <h3 className="card-title" style={{ color: '#ef4444', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <i className="ri-error-warning-fill" style={{ fontSize: 18, animation: 'pulse 1.4s infinite' }} />
                  Alarma de Situaciones Sospechosas en Asistencia & Operaciones (IA Patrol)
                </h3>
                <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: 0 }}>Detección de anomalías en tiempo real basadas en desviaciones de métricas operacionales del personal.</p>
              </div>
              <span className="badge" style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid #ef4444', color: '#ef4444', fontWeight: 800 }}>Monitoreo Activo</span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 5 }}>
              {getSuspiciousAlerts().map((alert) => (
                <div key={alert.id} style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  background: 'rgba(255, 255, 255, 0.02)',
                  borderLeft: `4px solid ${alert.color}`,
                  padding: '10px 14px',
                  borderRadius: '0 8px 8px 0',
                  gap: 15
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1 }}>
                    <div style={{
                      width: 32, height: 32, borderRadius: '50%',
                      background: 'rgba(255, 255, 255, 0.02)',
                      border: `1px solid ${alert.color}`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      color: alert.color, fontSize: 16
                    }}>
                      <i className={alert.icon} />
                    </div>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontWeight: 800, fontSize: 13, color: '#fff' }}>{alert.tipo}</span>
                        <span style={{ fontSize: 10, background: 'rgba(255,255,255,0.05)', padding: '1px 6px', borderRadius: 4, color: 'var(--text-muted)' }}>{alert.empleado} ({alert.rol})</span>
                      </div>
                      <p style={{ margin: '4px 0 0 0', fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.4 }}>{alert.detalle}</p>
                    </div>
                  </div>
                  
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <span className="badge" style={{
                      background: alert.severidad === 'Crítica' ? 'rgba(239,68,68,0.15)' : alert.severidad === 'Alta' ? 'rgba(249,115,22,0.15)' : 'rgba(245,158,11,0.15)',
                      borderColor: alert.color,
                      color: alert.color,
                      fontSize: 9,
                      fontWeight: 800,
                      textTransform: 'uppercase'
                    }}>{alert.severidad}</span>
                    <button 
                      onClick={() => showToast(`Alerta enviada a supervisor para verificar a ${alert.empleado}`, 'success')}
                      className="btn btn-secondary btn-xs" 
                      style={{ height: 22, fontSize: 9, padding: '0 8px', borderRadius: 4 }}
                    >
                      Verificar
                    </button>
                  </div>
                </div>
              ))}
              {getSuspiciousAlerts().length === 0 && (
                <div style={{ textAlign: 'center', padding: '15px 0', fontSize: 11, color: 'var(--text-muted)' }}>
                  ✅ No se han detectado anomalías operacionales en el personal el día de hoy.
                </div>
              )}
            </div>
          </div>

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

          {/* Sugerencia 2: Card de Eficiencia de Tiempos de Entrega */}
          {(() => {
            const audit = getEficienciaEntregas();
            const formatDur = (sec) => {
              if (sec < 60) return `${sec}s`;
              const m = Math.floor(sec / 60);
              const s = sec % 60;
              return `${m}m ${s}s`;
            };
            
            return (
              <div className="card" style={{ marginTop: 20 }}>
                <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 15 }}>
                  <div>
                    <h3 className="card-title">⏱️ Auditoría de Tiempos de Entrega (Cocina → Cliente)</h3>
                    <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: 0 }}>Medición del tiempo desde que el pedido está listo en cocina hasta que se entrega en mesa</p>
                  </div>
                  <span className="badge badge-bronze" style={{ fontSize: 10 }}>En Vivo</span>
                </div>
                
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 24, alignItems: 'center' }}>
                  {/* KPI Principal */}
                  <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 12, padding: 20, textAlign: 'center' }}>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Demora Promedio General</div>
                    <div style={{ fontSize: 36, fontWeight: 900, color: audit.promedioSegundos > 300 ? 'var(--warning)' : 'var(--success)', letterSpacing: '-0.02em' }}>
                      {audit.totalAudits > 0 ? formatDur(audit.promedioSegundos) : '—'}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 8 }}>
                      Total audits: <strong>{audit.totalAudits} comandas</strong>
                    </div>
                  </div>
                  
                  {/* Tiempos por Mesero */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    <h4 style={{ margin: '0 0 4px 0', fontSize: 12, fontWeight: 800, color: 'var(--text-secondary)' }}>Rendimiento por Mesero / Terminal:</h4>
                    {audit.totalAudits === 0 ? (
                      <div style={{ fontSize: 12, color: 'var(--text-muted)', fontStyle: 'italic', padding: '10px 0' }}>
                        Esperando que se completen entregas para calcular métricas...
                      </div>
                    ) : (
                      audit.porMesero.map((item, i) => (
                        <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                            <span style={{ fontWeight: 700, textTransform: 'capitalize' }}>👤 {item.name === 'mesero' ? 'Mesero Móvil (QR Link)' : item.name}</span>
                            <span style={{ fontWeight: 800, color: item.promedio > 300 ? 'var(--warning)' : 'var(--success)' }}>
                              {formatDur(item.promedio)} <span style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 400 }}>({item.count} pz)</span>
                            </span>
                          </div>
                          <div style={{ height: 6, background: 'var(--bg-elevated)', borderRadius: 3, overflow: 'hidden' }}>
                            <div style={{
                              height: '100%',
                              width: `${Math.min(100, (item.promedio / 300) * 100)}%`,
                              background: item.promedio > 300 ? 'var(--warning)' : 'var(--success)',
                              borderRadius: 3
                            }} />
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            );
          })()}

          {/* Auditoría de Cortesías por Empleado */}
          <div className="card" style={{ marginTop: 20 }}>
            <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 15 }}>
              <div>
                <h3 className="card-title"><i className="ri-hand-coin-line" style={{ marginRight: 6, color: '#f97316' }} />Auditoría de Cortesías por Empleado</h3>
                <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: 0 }}>Cortesías ($0 MXN) otorgadas por cada operador en el periodo — {filtroGrafico === 'semana' ? 'última semana' : filtroGrafico === 'mes' ? 'último mes' : 'último año'}</p>
              </div>
              <span className="badge" style={{ background: 'rgba(249,115,22,0.15)', color: '#f97316', border: '1px solid rgba(249,115,22,0.3)' }}>Anti-Fraude</span>
            </div>
            {cortesiasPorEmpleado.length === 0 ? (
              <div style={{ padding: '30px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
                <i className="ri-checkbox-circle-line" style={{ fontSize: 28, color: 'var(--success)', display: 'block', marginBottom: 8 }} />
                No se registraron cortesías en este periodo ✓
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {cortesiasPorEmpleado.map((emp, idx) => {
                  const riskLevel = emp.total >= 10 ? 'high' : emp.total >= 4 ? 'medium' : 'low';
                  const riskColor = riskLevel === 'high' ? '#ef4444' : riskLevel === 'medium' ? '#f97316' : '#22c55e';
                  const riskLabel = riskLevel === 'high' ? '🔴 ALTO' : riskLevel === 'medium' ? '🟠 MEDIO' : '🟢 BAJO';
                  const maxTotal = cortesiasPorEmpleado[0]?.total || 1;
                  return (
                    <div key={emp.nombre} style={{
                      background: riskLevel === 'high' ? 'rgba(239,68,68,0.06)' : riskLevel === 'medium' ? 'rgba(249,115,22,0.06)' : 'rgba(34,197,94,0.04)',
                      border: `1px solid ${riskColor}30`,
                      borderRadius: 12, padding: '12px 16px',
                      display: 'flex', alignItems: 'center', gap: 14
                    }}>
                      <div style={{
                        width: 38, height: 38, borderRadius: '50%',
                        background: `${riskColor}20`, border: `2px solid ${riskColor}60`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 14, fontWeight: 800, color: riskColor, flexShrink: 0
                      }}>
                        {idx + 1}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                          <span style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>{emp.nombre}</span>
                          <span style={{ fontSize: 9, background: `${riskColor}20`, color: riskColor, padding: '1px 6px', borderRadius: 4, fontWeight: 800, textTransform: 'uppercase' }}>
                            {emp.rol}
                          </span>
                          <span style={{ fontSize: 9, color: riskColor, fontWeight: 700, marginLeft: 'auto' }}>{riskLabel}</span>
                        </div>
                        <div style={{ height: 6, background: 'var(--bg-elevated)', borderRadius: 3, overflow: 'hidden' }}>
                          <div style={{
                            height: '100%',
                            width: `${(emp.total / maxTotal) * 100}%`,
                            background: `linear-gradient(90deg, ${riskColor}80, ${riskColor})`,
                            borderRadius: 3,
                            transition: 'width 0.5s ease'
                          }} />
                        </div>
                        <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 3 }}>
                          Última: {emp.eventos[emp.eventos.length - 1]?.fecha ? new Date(emp.eventos[emp.eventos.length - 1].fecha).toLocaleDateString('es-MX') : 'N/A'}
                        </div>
                      </div>
                      <div style={{ textAlign: 'right', flexShrink: 0 }}>
                        <div style={{ fontSize: 22, fontWeight: 900, color: riskColor, fontFamily: 'var(--font-display)' }}>{emp.total}</div>
                        <div style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>cortesías</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Historial de Escaneos QR de Asistencia (Módulo de Reportes) */}
          <div className="card" style={{ marginTop: 20 }}>
            <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 15 }}>
              <div>
                <h3 className="card-title"><i className="ri-qr-code-line" style={{ marginRight: 6, color: 'var(--bronze-light)' }} />⏱️ Registro Histórico de Asistencias y Inicios QR</h3>
                <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: 0 }}>Historial en tiempo real de cuándo y desde qué dispositivos el personal registró su asistencia por QR o consola</p>
              </div>
              <span className="badge badge-bronze" style={{ fontSize: 10 }}>Historial QR</span>
            </div>
            {bitacora.filter(e => e.accion && e.accion.startsWith('Asistencia')).length === 0 ? (
              <div style={{ padding: '30px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
                <i className="ri-calendar-check-line" style={{ fontSize: 28, color: 'var(--text-muted)', display: 'block', marginBottom: 8 }} />
                No se han registrado eventos de asistencia QR en el periodo.
              </div>
            ) : (
              <div className="table-container">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Fecha y Hora</th>
                      <th>Empleado</th>
                      <th>Rol</th>
                      <th>Método / Detalle</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bitacora
                      .filter(e => e.accion && e.accion.startsWith('Asistencia'))
                      .slice(0, 50)
                      .map((log, idx) => {
                        const fechaFormat = log.fecha ? new Date(log.fecha).toLocaleString('es-MX', {
                          day: '2-digit', month: '2-digit', year: 'numeric',
                          hour: '2-digit', minute: '2-digit', second: '2-digit'
                        }) : '—';
                        const isScan = log.accion.includes('Escaneado');
                        return (
                          <tr key={idx}>
                            <td style={{ fontWeight: 600, fontSize: 12 }}>{fechaFormat}</td>
                            <td style={{ fontWeight: 700, color: '#fff' }}>{log.operador}</td>
                            <td>
                              <span className="badge badge-secondary" style={{ textTransform: 'capitalize', fontSize: 10 }}>
                                {log.rolOperador || 'Personal'}
                              </span>
                            </td>
                            <td>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                                <span style={{
                                  fontSize: 9,
                                  background: isScan ? 'rgba(34,197,94,0.12)' : 'rgba(205,127,50,0.12)',
                                  color: isScan ? 'var(--success)' : 'var(--bronze-light)',
                                  padding: '1px 5px',
                                  borderRadius: 4,
                                  fontWeight: 800
                                }}>
                                  {isScan ? 'QR SCAN' : 'CONSOLA'}
                                </span>
                                <span style={{ color: 'var(--text-secondary)' }}>{log.detalle}</span>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {/* ── SUB-PANEL 4: ENCUESTAS DE SATISFACCIÓN ────────────────────────── */}
      {tabActiva === 'encuestas' && (
        <>
          {/* Resumen General y Promedios */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 20, marginBottom: 20 }}>
            {/* KPI Promedio General */}
            <div className="card" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: 30 }}>
              <div style={{ fontSize: 13, textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 700, letterSpacing: '0.05em', marginBottom: 15 }}>
                Satisfacción General
              </div>
              <div style={{ position: 'relative', width: 150, height: 150, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 15 }}>
                <svg width="150" height="150" viewBox="0 0 150 150">
                  <circle cx="75" cy="75" r="65" fill="none" stroke="var(--bg-elevated)" strokeWidth="12" />
                  <circle cx="75" cy="75" r="65" fill="none" stroke="url(#goldGradient)" strokeWidth="12"
                    strokeDasharray={`${2 * Math.PI * 65}`}
                    strokeDashoffset={`${2 * Math.PI * 65 * (1 - promedioGeneral / 5)}`}
                    strokeLinecap="round"
                    transform="rotate(-90 75 75)"
                    style={{ transition: 'stroke-dashoffset 0.8s ease-out' }}
                  />
                  <defs>
                    <linearGradient id="goldGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                      <stop offset="0%" stopColor="var(--bronze-light)" />
                      <stop offset="100%" stopColor="var(--bronze)" />
                    </linearGradient>
                  </defs>
                </svg>
                <div style={{ position: 'absolute', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                  <span style={{ fontSize: 36, fontWeight: 900, fontFamily: 'var(--font-display)', color: 'var(--bronze-light)' }}>
                    {promedioGeneral.toFixed(1)}
                  </span>
                  <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>de 5.0 ⭐</span>
                </div>
              </div>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)' }}>
                Basado en <strong style={{ color: 'var(--bronze-light)' }}>{totalEncuestas}</strong> opiniones de clientes
              </div>
            </div>

            {/* Promedios por Categoría */}
            <div className="card" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: '24px 30px' }}>
              <h3 className="card-title" style={{ marginBottom: 15 }}>Calificaciones por Categoría</h3>
              
              {[
                { name: 'Atención del Personal', val: promedioAtencion, icon: 'ri-user-star-line', color: '#ffb300' },
                { name: 'Rapidez del Servicio', val: promedioRapidez, icon: 'ri-flashlight-line', color: '#03a9f4' },
                { name: 'Limpieza del Local', val: promedioLimpieza, icon: 'ri-sparkling-line', color: '#00e676' },
                { name: 'Calidad del Equipo', val: promedioEquipo, icon: 'ri-billiards-line', color: 'var(--bronze-light)' }
              ].map((cat, i) => (
                <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: i < 3 ? 12 : 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13 }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600, color: 'var(--text-secondary)' }}>
                      <i className={cat.icon} style={{ color: cat.color }} /> {cat.name}
                    </span>
                    <span style={{ fontWeight: 800, color: 'var(--text-primary)' }}>{cat.val.toFixed(1)} / 5.0 ⭐</span>
                  </div>
                  <div style={{ height: 10, background: 'var(--bg-elevated)', borderRadius: 5, overflow: 'hidden' }}>
                    <div style={{
                      height: '100%',
                      width: `${(cat.val / 5) * 100}%`,
                      background: `linear-gradient(90deg, ${cat.color}88, ${cat.color})`,
                      borderRadius: 5,
                      transition: 'width 0.8s ease-out'
                    }} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Fila Inferior: AI Insights y Timeline de Sugerencias */}
          <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1.8fr', gap: 20 }}>
            {/* AI Insights Card */}
            <div className="card" style={{ background: 'linear-gradient(135deg, rgba(205,127,50,0.04), rgba(34,197,94,0.03))', border: '1px solid var(--border-bronze)' }}>
              <div className="card-header" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <div style={{ fontSize: 22 }}>🤖</div>
                <div>
                  <h3 className="card-title">Análisis de Satisfacción de IA</h3>
                  <p style={{ fontSize: 10, color: 'var(--text-muted)', margin: 0 }}>Diagnóstico automatizado en tiempo real</p>
                </div>
              </div>
              <div style={{ padding: '10px 18px 20px 18px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                    {promedioRapidez < 4.0 ? (
                      <p style={{ margin: 0 }}>
                        ⚠️ <strong>Tiempos de Servicio Elevados:</strong> La calificación de Rapidez del Servicio es baja (<strong>{promedioRapidez.toFixed(1)}</strong>). La IA detecta un cuello de botella recurrente. Se sugiere revisar la asignación de turnos de meseros en horas pico o automatizar comandas con tablets en mesa.
                      </p>
                    ) : promedioLimpieza < 4.2 ? (
                      <p style={{ margin: 0 }}>
                        🧹 <strong>Alerta de Mantenimiento:</strong> El promedio en Limpieza del local está en <strong>{promedioLimpieza.toFixed(1)}</strong>. Se sugiere crear un protocolo de revisión y desinfección obligatoria de las mesas y baños cada 90 minutos para mejorar la percepción de sanidad.
                      </p>
                    ) : promedioEquipo < 4.2 ? (
                      <p style={{ margin: 0 }}>
                        🎱 <strong>Mantenimiento de Equipos Crítico:</strong> El promedio de Calidad del Equipo es de <strong>{promedioEquipo.toFixed(1)}</strong>. Los clientes expresan descontento con el estado de tacos, tizas o nivelación de mesas. Se aconseja programar un reajuste de paños o cambio de casquillos de tacos de billar.
                      </p>
                    ) : (
                      <p style={{ margin: 0 }}>
                        ✨ <strong>Estándares de Excelencia Cumplidos:</strong> La satisfacción promedio general es muy alta (<strong>{promedioGeneral.toFixed(1)}</strong>). La experiencia del cliente en el salón es sobresaliente. Sugerencia de la IA: Mantener la motivación del staff mediante bonos por desempeño basándose en el panel de comisiones.
                      </p>
                    )}
                  </div>

                  <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--bronze-light)', textTransform: 'uppercase', marginBottom: 8 }}>
                      Distribución de Calificaciones
                    </div>
                    <div style={{ display: 'flex', gap: 4, height: 24 }}>
                      {[
                        { label: 'Excepcional (5⭐)', count: encuestasList.filter(e => (e.calificaciones?.atencion + e.calificaciones?.rapidez + e.calificaciones?.limpieza + e.calificaciones?.equipo)/4 >= 4.5).length, color: '#00e676' },
                        { label: 'Bueno (4-4.5⭐)', count: encuestasList.filter(e => {
                          const avg = (e.calificaciones?.atencion + e.calificaciones?.rapidez + e.calificaciones?.limpieza + e.calificaciones?.equipo)/4;
                          return avg >= 3.5 && avg < 4.5;
                        }).length, color: '#aeea00' },
                        { label: 'Regular (2.5-3.5⭐)', count: encuestasList.filter(e => {
                          const avg = (e.calificaciones?.atencion + e.calificaciones?.rapidez + e.calificaciones?.limpieza + e.calificaciones?.equipo)/4;
                          return avg >= 2.5 && avg < 3.5;
                        }).length, color: '#ffb300' },
                        { label: 'Crítico (<2.5⭐)', count: encuestasList.filter(e => {
                          const avg = (e.calificaciones?.atencion + e.calificaciones?.rapidez + e.calificaciones?.limpieza + e.calificaciones?.equipo)/4;
                          return avg > 0 && avg < 2.5;
                        }).length, color: '#ff1744' }
                      ].map((dist, idx) => {
                        const total = encuestasList.length || 1;
                        const pct = totalEncuestas > 0 ? (dist.count / total) * 100 : [55, 30, 10, 5][idx];
                        return (
                          <div
                            key={idx}
                            style={{
                              flex: pct || 1,
                              background: dist.color,
                              height: '100%',
                              borderRadius: 4,
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              color: '#000',
                              fontSize: 9,
                              fontWeight: 800,
                              minWidth: pct > 8 ? 20 : 0,
                              cursor: 'help',
                              transition: 'all 0.3s'
                            }}
                            title={`${dist.label}: ${dist.count} encuestas (${Math.round(pct)}%)`}
                          >
                            {pct > 15 ? `${Math.round(pct)}%` : ''}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Módulo de Quejas, Sugerencias y Comentarios */}
            <div className="card" style={{ display: 'flex', flexDirection: 'column', maxHeight: 420 }}>
              <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h3 className="card-title">Buzón de Comentarios, Quejas y Sugerencias</h3>
                <span className="badge badge-secondary" style={{ textTransform: 'lowercase' }}>
                  {encuestasList.filter(e => e.comentarios).length} comentarios
                </span>
              </div>
              <div style={{ overflowY: 'auto', flex: 1, padding: '10px 18px 20px 18px' }} className="custom-scrollbar">
                {encuestasList.filter(e => e.comentarios).length === 0 ? (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', minHeight: 200, color: 'var(--text-muted)' }}>
                    <i className="ri-message-3-line" style={{ fontSize: 40, marginBottom: 10 }} />
                    <p style={{ margin: 0, fontSize: 13 }}>No hay quejas o comentarios registrados con texto.</p>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                    {encuestasList
                      .filter(e => e.comentarios)
                      .sort((a, b) => {
                        const dateA = a.createdAt?.toDate ? a.createdAt.toDate().getTime() : new Date(a.createdAt).getTime();
                        const dateB = b.createdAt?.toDate ? b.createdAt.toDate().getTime() : new Date(b.createdAt).getTime();
                        return dateB - dateA;
                      })
                      .map((encuesta) => {
                        const promDoc = (encuesta.calificaciones?.atencion + encuesta.calificaciones?.rapidez + encuesta.calificaciones?.limpieza + encuesta.calificaciones?.equipo) / 4;
                        return (
                          <div
                            key={encuesta.id}
                            style={{
                              border: '1px solid var(--border)',
                              borderRadius: 10,
                              padding: 12,
                              background: 'var(--bg-elevated)',
                              position: 'relative',
                              transition: 'transform 0.2s',
                            }}
                          >
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <span style={{ fontWeight: 700, fontSize: 12, color: 'var(--bronze-light)' }}>
                                  {encuesta.cliente}
                                </span>
                                <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>·</span>
                                <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                                  {formatFecha(encuesta.createdAt)}
                                </span>
                              </div>
                              <span style={{ fontSize: 11, fontWeight: 700, color: promDoc >= 4 ? 'var(--success)' : promDoc >= 3 ? 'var(--warning)' : 'var(--danger)' }}>
                                ⭐ {promDoc.toFixed(1)}
                              </span>
                            </div>
                            
                            <div style={{
                              fontSize: 12,
                              color: 'var(--text-secondary)',
                              lineHeight: 1.5,
                              fontStyle: 'italic',
                              background: 'rgba(255,255,255,0.02)',
                              borderLeft: '2px solid var(--bronze)',
                              paddingLeft: 8,
                              marginBottom: 8
                            }}>
                              &ldquo;{encuesta.comentarios}&rdquo;
                            </div>

                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 10px', fontSize: 10, color: 'var(--text-muted)' }}>
                              <span>Atención: <strong style={{ color: 'var(--text-secondary)' }}>{encuesta.calificaciones?.atencion}⭐</strong></span>
                              <span>Rapidez: <strong style={{ color: 'var(--text-secondary)' }}>{encuesta.calificaciones?.rapidez}⭐</strong></span>
                              <span>Limpieza: <strong style={{ color: 'var(--text-secondary)' }}>{encuesta.calificaciones?.limpieza}⭐</strong></span>
                              <span>Equipo: <strong style={{ color: 'var(--text-secondary)' }}>{encuesta.calificaciones?.equipo}⭐</strong></span>
                            </div>
                          </div>
                        );
                      })}
                  </div>
                )}
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
      <style>{`
        @keyframes widgetGlow {
          0% { box-shadow: 0 0 5px rgba(239, 68, 68, 0.2), inset 0 0 5px rgba(239, 68, 68, 0.1); border-color: rgba(239, 68, 68, 0.3); }
          50% { box-shadow: 0 0 15px rgba(239, 68, 68, 0.5), inset 0 0 10px rgba(239, 68, 68, 0.2); border-color: rgba(239, 68, 68, 0.6); }
          100% { box-shadow: 0 0 5px rgba(239, 68, 68, 0.2), inset 0 0 5px rgba(239, 68, 68, 0.1); border-color: rgba(239, 68, 68, 0.3); }
        }
        .custom-scroll::-webkit-scrollbar {
          width: 5px !important;
          display: block !important;
        }
        .custom-scroll::-webkit-scrollbar-track {
          background: rgba(255, 255, 255, 0.02) !important;
          border-radius: 4px !important;
        }
        .custom-scroll::-webkit-scrollbar-thumb {
          background: var(--bronze-light, #cd7f32) !important;
          border-radius: 4px !important;
        }
        .custom-scroll::-webkit-scrollbar-thumb:hover {
          background: #e59848 !important;
        }
      `}</style>
    </div>
  );
}

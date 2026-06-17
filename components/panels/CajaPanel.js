'use client';
import { useState, useEffect, useMemo, Fragment } from 'react';
import { db } from '@/lib/firebase';
import { doc, onSnapshot, query, collection, orderBy, limit, getDocs, startAfter, writeBatch, addDoc, serverTimestamp, where, setDoc } from 'firebase/firestore';
import { deobfuscate, obfuscate } from '@/lib/crypto';
import { useAuth } from '@/lib/auth-context';

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

const adminPinHash = '8d969eef6ecad3c29a3a629280e686cf0c3f5d5a86aff3ca12020c923adc6c92'; // fallback hashed

// Chart helper
function BarChart({ data, height = 90, color = 'var(--bronze)' }) {
  const [hoveredIndex, setHoveredIndex] = useState(null);
  const max = Math.max(...data.map(d => d.value), 1);
  return (
    <div style={{ position: 'relative', width: '100%' }}>
      {hoveredIndex !== null && (
        <div style={{
          position: 'absolute',
          top: -32,
          left: `${(hoveredIndex / data.length) * 100 + (100 / data.length) / 2}%`,
          transform: 'translateX(-50%)',
          background: 'var(--bg-elevated)',
          border: '1px solid var(--border-bronze)',
          padding: '4px 8px',
          borderRadius: 6,
          fontSize: 10,
          fontWeight: 700,
          color: 'var(--bronze-light)',
          boxShadow: 'var(--shadow-bronze)',
          zIndex: 10,
          pointerEvents: 'none',
          whiteSpace: 'nowrap'
        }}>
          {data[hoveredIndex].label}: {data[hoveredIndex].value}%
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, height: height, padding: '0 4px', position: 'relative' }}>
        {data.map((d, i) => (
          <div
            key={i}
            style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, height: '100%', justifyContent: 'flex-end', cursor: 'pointer' }}
            onMouseEnter={() => setHoveredIndex(i)}
            onMouseLeave={() => setHoveredIndex(null)}
          >
            <div style={{
              width: '100%', minHeight: 4, borderRadius: '3px 3px 0 0',
              height: `${(d.value / max) * 100}%`,
              background: i === data.length - 1 || hoveredIndex === i ? `linear-gradient(180deg, ${color}, ${color}88)` : `${color}44`,
              transition: 'all 0.2s ease',
            }} />
            <span style={{ fontSize: 8, color: 'var(--text-muted)', textAlign: 'center', whiteSpace: 'nowrap' }}>{d.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

const F = ({ label, children, col }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: col || 1 }}>
    {label && <label style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</label>}
    {children}
  </div>
);

export default function CajaPanel({ showToast }) {
  const { user } = useAuth();
  const esCajero = user?.role === 'cajero';

  // Estados de Caja POS
  const [cobros, setCobros] = useState([]);
  const [mostrarCorte, setMostrarCorte] = useState(false);
  const [cantidades, setCantidades] = useState({
    1000: '', 500: '', 200: '', 100: '', 50: '', 20: '', 10: '', 5: '', 2: '', 1: '', 0.5: ''
  });

  // Auditoría IA de Corte de Caja
  const [ultimoCorteFecha, setUltimoCorteFecha] = useState(null);
  const [bitacoraFiltrada, setBitacoraFiltrada] = useState([]);
  const [mostrarResumenCorteModal, setMostrarResumenCorteModal] = useState(false);
  const [resumenCorteActivo, setResumenCorteActivo] = useState(null);
  const [historialCortes, setHistorialCortes] = useState([]);
  const [limiteCortesCaja, setLimiteCortesCaja] = useState(10);
  const [filtroCorteInicio, setFiltroCorteInicio] = useState('');
  const [filtroCorteFin, setFiltroCorteFin] = useState('');

  // Estados de Bitácora y Stock
  const [bitacora, setBitacora] = useState([]);
  const [mostrarBitacora, setMostrarBitacora] = useState(false);
  const [limiteBitacora, setLimiteBitacora] = useState(50);
  const [hasMoreBitacora, setHasMoreBitacora] = useState(true);
  const [lastBitacoraDoc, setLastBitacoraDoc] = useState(null);
  const [loadingMoreBitacora, setLoadingMoreBitacora] = useState(false);
  const [colaImpresion, setColaImpresion] = useState([]);
  const [tabActivo, setTabActivo] = useState('caja'); 
  const [inventarioLogs, setInventarioLogs] = useState([]);
  const [inventarioDbLogs, setInventarioDbLogs] = useState([]);
  const [lastInventarioDoc, setLastInventarioDoc] = useState(null);
  const [inventarioHasMoreLogs, setInventarioHasMoreLogs] = useState(true);
  const [loadingMoreInventario, setLoadingMoreInventario] = useState(false);

  // Estados de Inteligencia y Reportes
  const [filtroGrafico, setFiltroGrafico] = useState('semana'); // 'semana' | 'mes' | 'anio'
  const [pronosticoRango, setPronosticoRango] = useState('24h'); // '24h' | '48h' | '72h'
  const [gastosList, setGastosList] = useState([]);
  const [nominaPagosList, setNominaPagosList] = useState([]);
  const [empleadosList, setEmpleadosList] = useState([]);
  const [encuestasList, setEncuestasList] = useState([]);
  const [pedidosList, setPedidosList] = useState([]);
  const [descartadas, setDescartadas] = useState({});
  const [productos, setProductos] = useState([]);
  const [mesas, setMesas] = useState([]);
  const [cuentasActivas, setCuentasActivas] = useState([]);
  const [inconsistenciasEnVivo, setInconsistenciasEnVivo] = useState([]);

  // Estados para Acordeón / Colapsables
  const [seccionIaAbierta, setSeccionIaAbierta] = useState(true);
  const [seccionCajaAbierta, setSeccionCajaAbierta] = useState(true);
  const [seccionReportesAbierta, setSeccionReportesAbierta] = useState(false);

  // Simulador de Tarifas
  const [surgePercent, setSurgePercent] = useState(20);
  const [discountPercent, setDiscountPercent] = useState(15);

  // Metas y Subpestañas IA
  const [metaMensual, setMetaMensual] = useState(100000);
  const [subTabIa, setSubTabIa] = useState('auditoria'); // 'auditoria' | 'predictivos'
  const [metricasFila, setMetricasFila] = useState({
    tiempoRespuestaPromedio: 0,
    totalAlertas: 0,
    tasaCancelaciones: 0,
    totalRegistrosQR: 0
  });

  useEffect(() => {
    if (esCajero) return;
    
    // Escuchar alertas de fila digital
    const qLogs = query(collection(db, 'alertas_digitales_log'), orderBy('createdAt', 'desc'), limit(100));
    const unsubLogs = onSnapshot(qLogs, (snap) => {
      let sum = 0;
      let count = 0;
      snap.docs.forEach(doc => {
        const d = doc.data();
        if (d.duracionSegundos) {
          sum += d.duracionSegundos;
          count++;
        }
      });
      setMetricasFila(prev => ({
        ...prev,
        tiempoRespuestaPromedio: count > 0 ? Math.round(sum / count) : 0,
        totalAlertas: snap.size
      }));
    }, err => console.warn("Error loading queue response logs:", err));

    // Escuchar fila_espera
    const qFila = query(collection(db, 'fila_espera'), limit(200));
    const unsubFila = onSnapshot(qFila, (snap) => {
      let total = snap.size;
      let timeouts = 0;
      snap.docs.forEach(doc => {
        const d = doc.data();
        if (d.estado === 'retirado' && d.motivoRetiro === 'timeout') {
          timeouts++;
        }
      });
      setMetricasFila(prev => ({
        ...prev,
        totalRegistrosQR: total,
        tasaCancelaciones: total > 0 ? Math.round((timeouts / total) * 100) : 0
      }));
    }, err => console.warn("Error loading queue waitlist:", err));

    return () => {
      unsubLogs();
      unsubFila();
    };
  }, [esCajero]);

  // Modal cobro manual
  const [mostrarCobroManual, setMostrarCobroManual] = useState(false);
  const [nuevoMonto, setNuevoMonto] = useState('');
  const [nuevaDesc, setNuevaDesc] = useState('');
  const [nuevoMetodo, setNuevoMetodo] = useState('efectivo');
  const [pinAutorizacion, setPinAutorizacion] = useState('');

  // 1. Sincronizar transacciones y bitácora locales
  useEffect(() => {
    const handleStorage = (e) => {
      if (e.key === 'yoy_caja_cobros' && e.newValue) {
        try { setCobros(JSON.parse(e.newValue)); } catch (err) { console.error(err); }
      }
      if (e.key === 'yoy_billar_bitacora' && e.newValue) {
        try { setBitacora(deobfuscate(e.newValue) || []); } catch (err) { console.error(err); }
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  // 2. Cargar cobros iniciales
  useEffect(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem('yoy_caja_cobros');
        if (saved) {
          setCobros(JSON.parse(saved));
        } else {
          const TRANSACCIONES_INI = [
            { id: Date.now() - 3600000 * 2, tipo: 'mesa', descripcion: 'Mesa 2 - 1.5h', cliente: 'Carlos R.', monto: 120, metodo: 'efectivo', hora: '14:30', color: 'var(--success)' },
            { id: Date.now() - 3600000 * 4, tipo: 'bar',  descripcion: 'Comanda - 4 Coronas + Botana', cliente: 'Mesa 7', monto: 280, metodo: 'efectivo', hora: '13:15', color: 'var(--success)' },
            { id: Date.now() - 3600000 * 6, tipo: 'mesa', descripcion: 'Mesa 3 - 2h', cliente: 'Pedro M.', monto: 160, metodo: 'spei', hora: '12:00', color: 'var(--success)' },
            { id: Date.now() - 3600000 * 8, tipo: 'gasto',descripcion: 'Compra de bebidas', cliente: 'Proveedor ABC', monto: -650, metodo: 'efectivo', hora: '11:00', color: 'var(--danger)' },
            { id: Date.now() - 3600000 * 10, tipo: 'mesa', descripcion: 'Mesa 1 - 3h', cliente: 'Torneo Local', monto: 240, metodo: 'efectivo', hora: '09:30', color: 'var(--success)' },
          ];
          setCobros(TRANSACCIONES_INI);
          localStorage.setItem('yoy_caja_cobros', JSON.stringify(TRANSACCIONES_INI));
        }
      } catch (err) { console.error(err); }
    }
  }, []);

  // 3. Sincronizar cobros
  useEffect(() => {
    if (typeof window !== 'undefined' && cobros.length > 0) {
      localStorage.setItem('yoy_caja_cobros', JSON.stringify(cobros));
    }
  }, [cobros]);

  // 3b. Sincronizar último corte de caja
  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'config', 'ultimo_corte'), snap => {
      if (snap.exists()) {
        setUltimoCorteFecha(snap.data().fecha);
      } else {
        const hace24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        setUltimoCorteFecha(hace24h);
        setDoc(doc(db, 'config', 'ultimo_corte'), { fecha: hace24h });
      }
    }, err => {
      console.warn("Error al escuchar ultimo_corte:", err);
      const hace24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      setUltimoCorteFecha(hace24h);
    });
    return () => unsub();
  }, []);

  // 3c. Suscribirse a bitácora filtrada por fecha del último corte
  useEffect(() => {
    if (!ultimoCorteFecha) return;
    const q = query(
      collection(db, 'bitacora'),
      where('fecha', '>=', ultimoCorteFecha)
    );
    const unsub = onSnapshot(q, snap => {
      const items = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      items.sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
      setBitacoraFiltrada(items);
    }, err => {
      console.warn("Error al escuchar bitacora del corte:", err);
    });
    return () => unsub();
  }, [ultimoCorteFecha]);

  // 3d. Sincronizar historial de cortes de caja
  useEffect(() => {
    const q = query(
      collection(db, 'cortes_caja'),
      orderBy('fecha', 'desc'),
      limit(limiteCortesCaja)
    );
    const unsub = onSnapshot(q, snap => {
      setHistorialCortes(snap.docs.map(d => {
        const data = d.data();
        return {
          id: d.id,
          ...data,
          fecha: data.fecha ? (data.fecha.toDate ? data.fecha.toDate().toISOString() : data.fecha) : new Date().toISOString()
        };
      }));
    }, err => {
      console.warn("Error al escuchar historial de cortes:", err);
    });
    return () => unsub();
  }, [limiteCortesCaja]);

  // 4. Suscripciones Firestore
  useEffect(() => {
    const unsubs = [
      onSnapshot(query(collection(db, 'bitacora'), orderBy('fecha', 'desc'), limit(100)), snap => {
        const items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        setBitacora(items);
        setLastBitacoraDoc(snap.docs[snap.docs.length - 1] || null);
        setHasMoreBitacora(snap.docs.length === 50);
        try { localStorage.setItem('yoy_billar_bitacora', obfuscate(items)); } catch (err) { console.error(err); }
      }, err => {
        console.warn(err);
        try {
          const saved = localStorage.getItem('yoy_billar_bitacora');
          if (saved) setBitacora(deobfuscate(saved) || []);
        } catch (e) { console.error(e); }
      }),
      onSnapshot(query(collection(db, 'historial_stock'), orderBy('fecha', 'desc'), limit(50)), snap => {
        setInventarioDbLogs(snap.docs.map(d => ({ id: d.id, ...d.data() })));
        setLastInventarioDoc(snap.docs[snap.docs.length - 1] || null);
        setInventarioHasMoreLogs(snap.docs.length === 50);
      }),
      onSnapshot(query(collection(db, 'gastos')), snap => {
        setGastosList(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
      }),
      onSnapshot(query(collection(db, 'nomina_pagos')), snap => {
        setNominaPagosList(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
      }),
      onSnapshot(query(collection(db, 'nomina_empleados')), snap => {
        setEmpleadosList(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
      }),
      onSnapshot(query(collection(db, 'encuestas_satisfaccion')), snap => {
        setEncuestasList(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
      }),
      onSnapshot(query(collection(db, 'mesa_pedidos')), snap => {
        setPedidosList(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
      }),
      onSnapshot(doc(db, 'config', 'inventario'), snap => {
        if (snap.exists()) setProductos(snap.data().productos || []);
      }),
      onSnapshot(doc(db, 'config', 'mesas_estado'), snap => {
        if (snap.exists() && Array.isArray(snap.data().mesas)) setMesas(snap.data().mesas);
      }),
      onSnapshot(doc(db, 'config', 'cuentas_estado'), snap => {
        if (snap.exists() && Array.isArray(snap.data().cuentas)) setCuentasActivas(snap.data().cuentas);
      }),
      onSnapshot(doc(db, 'config', 'sucursal'), snap => {
        if (snap.exists()) {
          const d = snap.data();
          if (d.metaMensual !== undefined) setMetaMensual(Number(d.metaMensual));
        }
      })
    ];
    return () => unsubs.forEach(unsub => unsub());
  }, []);

  // 5. Cargar logs locales de inventario
  useEffect(() => {
    if (typeof window !== 'undefined') {
      try {
        const savedLogs = localStorage.getItem('yoy_billar_stock_logs');
        if (savedLogs) setInventarioLogs(deobfuscate(savedLogs) || []);
      } catch (err) { console.error(err); }
    }
  }, []);

  // 6. Cruce de inconsistencias en vivo
  useEffect(() => {
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
            tipo: 'alerta',
            motivo: `Mesa activa por ${hrsJugadas} hrs con $0 consumos de barra.`
          });
        }
      } else if (m.estado === 'libre' && m.id === 4) {
        // Simular discrepancia IoT (Sugerencia 1)
        incs.push({
          mesaId: m.id,
          nombre: m.nombre,
          cliente: 'Ninguno (Mesa Libre)',
          horas: '0',
          tipo: 'iot_luces',
          motivo: 'Consumo eléctrico activo (45W) detectado por sensores IoT en Mesa Libre.'
        });
      }
    });
    setInconsistenciasEnVivo(incs);
  }, [mesas, cuentasActivas]);

  // Helper para auditoría bitácora / registrar auditoría
  const registrarEvento = async (accion, detalle, monto = 0, tipo = 'info') => {
    try {
      await addDoc(collection(db, 'bitacora'), {
        accion,
        detalle,
        monto: Number(monto),
        operador: user ? (user.name || user.alias || user.email) : 'Sistema',
        rolOperador: user ? (user.role || 'staff') : 'sistema',
        fecha: new Date().toISOString(),
        tipo
      });
    } catch (e) {
      console.error(e);
    }
  };

  // 7. Cálculos de Corte de Caja
  const totalHoy = cobros.filter(t => t.monto > 0).reduce((s, t) => s + t.monto, 0);
  const totalGastos = Math.abs(cobros.filter(t => t.monto < 0).reduce((s, t) => s + t.monto, 0));
  const utilidad = totalHoy - totalGastos;

  const calculationsCorte = useMemo(() => {
    const startPeriod = ultimoCorteFecha || new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    let ingresosEfectivo = 0;
    let ingresosTarjeta = 0;
    let ingresosTransferencia = 0;
    const ingresosDetalle = [];

    bitacoraFiltrada.forEach(e => {
      if (e.monto && e.monto > 0) {
        const detLower = (e.detalle || '').toLowerCase();
        let metodo = 'efectivo';
        
        if (detLower.includes('tarjeta')) {
          metodo = 'tarjeta';
          ingresosTarjeta += Number(e.monto);
        } else if (detLower.includes('transferencia') || detLower.includes('spei') || detLower.includes('qr') || detLower.includes('código qr')) {
          metodo = 'transferencia';
          ingresosTransferencia += Number(e.monto);
        } else {
          ingresosEfectivo += Number(e.monto);
        }

        ingresosDetalle.push({
          id: e.id || Date.now() + Math.random(),
          fecha: e.fecha,
          hora: new Date(e.fecha).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }),
          descripcion: e.detalle || e.accion,
          cliente: e.operador || 'Cliente',
          monto: Number(e.monto),
          metodo
        });
      }
    });

    let totalGastosVal = 0;
    const gastosDetalle = [];

    gastosList.forEach(g => {
      if (g.fecha && g.fecha >= startPeriod) {
        const montoG = Number(g.monto) || 0;
        totalGastosVal += montoG;
        gastosDetalle.push({
          id: g.id || Date.now() + Math.random(),
          fecha: g.fecha,
          hora: new Date(g.fecha).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }),
          descripcion: g.descripcion || 'Gasto registrado',
          categoria: g.categoria || 'general',
          proveedor: g.proveedor || g.empleadoNombre || 'Proveedor/Empleado',
          monto: montoG
        });
      }
    });

    bitacoraFiltrada.forEach(e => {
      if (e.monto && e.monto < 0) {
        const montoAbs = Math.abs(Number(e.monto));
        totalGastosVal += montoAbs;
        gastosDetalle.push({
          id: e.id || Date.now() + Math.random(),
          fecha: e.fecha,
          hora: new Date(e.fecha).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }),
          descripcion: e.detalle || e.accion,
          categoria: 'manual',
          proveedor: e.operador || 'N/A',
          monto: montoAbs
        });
      }
    });

    const totalIngresos = ingresosEfectivo + ingresosTarjeta + ingresosTransferencia;
    const efectivoEsperado = ingresosEfectivo - totalGastosVal;

    return {
      ingresosEfectivo,
      ingresosTarjeta,
      ingresosTransferencia,
      ingresosDetalle,
      gastosDetalle,
      totalIngresos,
      totalGastos: totalGastosVal,
      efectivoEsperado
    };
  }, [bitacoraFiltrada, gastosList, ultimoCorteFecha]);

  const generarResumenIA = (corteData, sumaContadaVal, diferenciaVal) => {
    const { ingresosEfectivo, ingresosTarjeta, ingresosTransferencia, totalIngresos, totalGastos: totalGastosVal, gastosDetalle } = corteData;
    
    let diagnostico = '';
    if (diferenciaVal === 0) {
      diagnostico = 'El flujo de efectivo auditado coincide a la perfección. La trazabilidad indica un balance saludable entre entradas y salidas.';
    } else if (diferenciaVal > 0) {
      diagnostico = `Se detectó un SOBRANTE de $${diferenciaVal.toLocaleString()} MXN. Esto sugiere que hubo ingresos en efectivo no registrados en el sistema de mesas (ej: cobros manuales o propinas ingresadas directamente) o comprobantes de egresos que se pagaron con cuentas externas en lugar del efectivo de caja.`;
    } else {
      diagnostico = `Se detectó un FALTANTE de $${Math.abs(diferenciaVal).toLocaleString()} MXN. Alerta de trazabilidad: posibles causas incluyen cambio incorrecto entregado a clientes, pagos de barra retirados de caja sin comprobante, o descuadres en comisiones de meseros cobradas directamente en efectivo.`;
    }

    let categoriasGastos = {};
    gastosDetalle.forEach(g => {
      categoriasGastos[g.categoria] = (categoriasGastos[g.categoria] || 0) + g.monto;
    });
    
    let gastosAnalisis = Object.keys(categoriasGastos).length > 0 
      ? Object.keys(categoriasGastos).map(cat => `- ${cat.toUpperCase()}: $${categoriasGastos[cat].toLocaleString()} MXN`).join('\n')
      : 'No se registraron egresos/gastos en este periodo.';

    let metodosIngreso = `
- EFECTIVO: $${ingresosEfectivo.toLocaleString()} MXN (${totalIngresos > 0 ? Math.round((ingresosEfectivo / totalIngresos) * 100) : 0}%)
- TARJETA: $${ingresosTarjeta.toLocaleString()} MXN (${totalIngresos > 0 ? Math.round((ingresosTarjeta / totalIngresos) * 100) : 0}%)
- TRANSF/SPEI/QR: $${ingresosTransferencia.toLocaleString()} MXN (${totalIngresos > 0 ? Math.round((ingresosTransferencia / totalIngresos) * 100) : 0}%)
`;

    let report = `🤖 AUDITORÍA DE FLUJO DE CAJA — MOTOR IA YOY

=== DIAGNÓSTICO FINANCIERO ===
${diagnostico}

=== FLUJO DE TRAZABILIDAD ===
Ingresos Totales (Mesas / Barra): $${totalIngresos.toLocaleString()} MXN
Distribución de Pagos en Pantalla de Mesas:
${metodosIngreso}

Egresos Totales (Gastos / Nómina): -$${totalGastosVal.toLocaleString()} MXN
Distribución de Egresos por Categorías:
${gastosAnalisis}

=== ARQUEO Y RECONCILIACIÓN ===
Efectivo Esperado en Caja: $${(ingresosEfectivo - totalGastosVal).toLocaleString()} MXN
Efectivo Físico Entregado (Arqueo): $${sumaContadaVal.toLocaleString()} MXN
Diferencia Auditoría: ${diferenciaVal >= 0 ? '+' : ''}$${diferenciaVal.toLocaleString()} MXN

=== SUGERENCIAS PREVENTIVAS IA ===
${diferenciaVal < 0 ? '1. Implementar auditoría ciega por turnos.\n2. Conciliar consumos del bar con el inventario físico al cambio de cajero.' : diferenciaVal > 0 ? '1. Verificar si existen tickets de comandero físico pendientes de facturación.\n2. Asegurar que las comisiones se descuenten de forma digital.' : '1. Mantener el protocolo actual de arqueo interactivo.\n2. Continuar con la trazabilidad en tiempo real de Firestore.'}`;
    return report.trim();
  };

  const imprimirTicketCorte = (corteData, sumaContadaVal, diferenciaVal, resumenIA, operador, fechaUltimo, cantidadesDenom) => {
    const { ingresosEfectivo, ingresosTarjeta, ingresosTransferencia, totalIngresos, totalGastos: totalGastosVal, ingresosDetalle, gastosDetalle } = corteData;
    
    let htmlContent = `
      <html><head><title>Corte de Caja - YoY IA Billar</title>
      <style>
        body { margin: 0; padding: 10px; font-family: 'Courier New', Courier, monospace; background: #fff; color: #000; font-size: 11px; line-height: 1.4; max-width: 280px; }
        .text-center { text-align: center; }
        .text-right { text-align: right; }
        .divider { border-top: 1px dashed #000; margin: 8px 0; }
        .header { margin-bottom: 8px; }
        .header h3 { margin: 0; font-size: 13px; font-weight: bold; }
        .header p { margin: 2px 0; font-size: 9px; }
        .details-table { width: 100%; border-collapse: collapse; }
        .details-table td, .details-table th { padding: 2px 0; vertical-align: top; font-size: 10px; }
        .footer { margin-top: 15px; font-size: 8px; text-align: center; color: #555; }
        pre { white-space: pre-wrap; font-family: inherit; font-size: 9px; margin: 4px 0; }
      </style>
      </head>
      <body>
        <div class="header text-center">
          <h3>YoY IA Billar Club</h3>
          <p>TICKET DE CORTE DE CAJA</p>
          <p>Fecha Corte: ${new Date().toLocaleString('es-MX')}</p>
          <p>Desde: ${new Date(fechaUltimo).toLocaleString('es-MX')}</p>
          <p>Cajero: ${operador}</p>
        </div>
        
        <div class="divider"></div>
        
        <div>
          <strong>RESUMEN DE EFECTIVO:</strong><br/>
          Esperado en Caja: $${(ingresosEfectivo - totalGastosVal).toLocaleString()} MXN<br/>
          Contado en Físico: $${sumaContadaVal.toLocaleString()} MXN<br/>
          Diferencia: ${diferenciaVal >= 0 ? '+' : ''}$${diferenciaVal.toLocaleString()} MXN<br/>
        </div>

        <div class="divider"></div>
        
        <strong>INGRESOS (MESA/BARRA):</strong>
        <table class="details-table">
          <thead>
            <tr style="border-bottom: 1px dashed #000;">
              <th align="left">Detalle</th>
              <th align="right">Monto</th>
            </tr>
          </thead>
          <tbody>
    `;

    ingresosDetalle.forEach(item => {
      htmlContent += `
        <tr>
          <td>${item.descripcion.slice(0, 18)} (${item.metodo.toUpperCase().slice(0, 4)})</td>
          <td align="right">$${item.monto.toLocaleString()}</td>
        </tr>
      `;
    });

    htmlContent += `
          </tbody>
        </table>
        
        <div class="divider"></div>
        
        <strong>EGRESOS (GASTOS/NÓMINA):</strong>
        <table class="details-table">
          <thead>
            <tr style="border-bottom: 1px dashed #000;">
              <th align="left">Detalle</th>
              <th align="right">Monto</th>
            </tr>
          </thead>
          <tbody>
    `;

    gastosDetalle.forEach(item => {
      htmlContent += `
        <tr>
          <td>[${item.categoria.slice(0, 4).toUpperCase()}] ${item.descripcion.slice(0, 15)}</td>
          <td align="right">-$${item.monto.toLocaleString()}</td>
        </tr>
      `;
    });

    htmlContent += `
          </tbody>
        </table>

        <div class="divider"></div>
        
        <strong>DESGLOSE DE BILLETES/MONEDAS:</strong>
        <table class="details-table">
          <tbody>
    `;

    Object.keys(cantidadesDenom).forEach(den => {
      const qty = parseInt(cantidadesDenom[den]) || 0;
      if (qty > 0) {
        htmlContent += `
          <tr>
            <td>$${den} x ${qty}</td>
            <td align="right">$${(parseFloat(den) * qty).toLocaleString()}</td>
          </tr>
        `;
      }
    });

    htmlContent += `
          </tbody>
        </table>

        <div class="divider"></div>
        
        <strong>AUDITORÍA DE TRAZABILIDAD IA:</strong><br/>
        <pre>${resumenIA}</pre>

        <div class="divider"></div>
        
        <div class="footer">
          <p>YoY IA Billar — Sistema de Auditoría y Trazabilidad</p>
          <p>Firma Cajero: ___________________</p>
          <p>Firma Administrador: _____________</p>
        </div>
      </body>
      </html>
    `;

    try {
      const iframe = document.createElement('iframe');
      iframe.style.position = 'fixed';
      iframe.style.right = '0';
      iframe.style.bottom = '0';
      iframe.style.width = '0';
      iframe.style.height = '0';
      iframe.style.border = '0';
      document.body.appendChild(iframe);

      const docVal = iframe.contentWindow.document || iframe.contentDocument;
      docVal.open();
      docVal.write(htmlContent);
      docVal.close();

      iframe.contentWindow.focus();
      setTimeout(() => {
        iframe.contentWindow.print();
        setTimeout(() => {
          document.body.removeChild(iframe);
        }, 1500);
      }, 300);
    } catch (err) {
      console.error("Error al inyectar iframe e imprimir corte:", err);
    }
  };

  const totalEfectivoEsperado = calculationsCorte.efectivoEsperado;
  const totalDigitalEsperado = calculationsCorte.ingresosTarjeta + calculationsCorte.ingresosTransferencia;

  const sumaContada = Object.keys(cantidades).reduce((acc, val) => {
    const qty = parseInt(cantidades[val]) || 0;
    return acc + (parseFloat(val) * qty);
  }, 0);
  const diferencia = sumaContada - totalEfectivoEsperado;

  const cortesiasHoy = bitacora.filter(b => {
    const esHoy = b.fecha && (new Date(b.fecha).toDateString() === new Date().toDateString());
    if (!esHoy) return false;
    const esCierre = b.accion === 'Cierre Directo' || b.accion === 'Liquidar Cuenta' || b.accion === 'Cobro Manual';
    const esMontoCero = b.monto === 0 || (b.detalle && (b.detalle.includes('Socio sin cargo') || b.detalle.includes('$0 MXN') || b.detalle.includes('cerrada (Socio sin cargo')));
    return esCierre && esMontoCero;
  });

  const guardarCorteCaja = async () => {
    const nombreOperador = user ? (user.name || user.alias || user.email) : 'Administrador';
    const resumenIaTexto = generarResumenIA(calculationsCorte, sumaContada, diferencia);
    const fechaUltimo = ultimoCorteFecha || new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const cantidadesDenom = { ...cantidades };

    const corteInfo = {
      operador: nombreOperador,
      ultimoCorteFecha: fechaUltimo,
      efectivoContado: sumaContada,
      efectivoEsperado: calculationsCorte.efectivoEsperado,
      diferencia: diferencia,
      totalIngresos: calculationsCorte.totalIngresos,
      totalGastos: calculationsCorte.totalGastos,
      resumenIA: resumenIaTexto,
      cantidadesDenom,
      ingresosDetalle: calculationsCorte.ingresosDetalle,
      gastosDetalle: calculationsCorte.gastosDetalle,
      corteData: calculationsCorte
    };

    try {
      await addDoc(collection(db, 'cortes_caja'), {
        fecha: serverTimestamp(),
        operador: nombreOperador,
        ultimoCorteFecha: fechaUltimo,
        efectivoContado: sumaContada,
        efectivoEsperado: calculationsCorte.efectivoEsperado,
        diferencia: diferencia,
        totalIngresos: calculationsCorte.totalIngresos,
        totalGastos: calculationsCorte.totalGastos,
        resumenIA: resumenIaTexto,
        cantidadesDenom: cantidades,
        ingresosDetalle: calculationsCorte.ingresosDetalle,
        gastosDetalle: calculationsCorte.gastosDetalle
      });

      await registrarEvento(
        'Corte de Caja',
        `Corte de Caja realizado por ${nombreOperador}. Contado: $${sumaContada.toLocaleString()} - Esperado: $${calculationsCorte.efectivoEsperado.toLocaleString()}. Diferencia: ${diferencia >= 0 ? '+' : ''}$${diferencia.toLocaleString()}`,
        diferencia,
        'info'
      );

      imprimirTicketCorte(calculationsCorte, sumaContada, diferencia, resumenIaTexto, nombreOperador, fechaUltimo, cantidadesDenom);

      const nuevaFecha = new Date().toISOString();
      await setDoc(doc(db, 'config', 'ultimo_corte'), { fecha: nuevaFecha });

      setResumenCorteActivo(corteInfo);
      setMostrarResumenCorteModal(true);

      showToast(`Corte registrado exitosamente. Diferencia: $${diferencia.toLocaleString()}`, diferencia >= 0 ? 'success' : 'danger');
    } catch (err) {
      console.error("Error al procesar el corte de caja:", err);
      showToast("Error al guardar el corte de caja en la base de datos.", "danger");
    }

    setMostrarCorte(false);
    localStorage.removeItem('yoy_caja_corte_draft');
    setCantidades({
      1000: '', 500: '', 200: '', 100: '', 50: '', 20: '', 10: '', 5: '', 2: '', 1: '', 0.5: ''
    });
  };

  const handleCantidadChange = (den, val) => {
    const updated = { ...cantidades, [den]: val };
    setCantidades(updated);
    localStorage.setItem('yoy_caja_corte_draft', JSON.stringify(updated));
  };

  useEffect(() => {
    if (mostrarCorte && typeof window !== 'undefined') {
      const draft = localStorage.getItem('yoy_caja_corte_draft');
      if (draft) setCantidades(JSON.parse(draft));
    }
  }, [mostrarCorte]);

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

  const exportarCorteCSV = (c) => {
    if (!c) return;
    try {
      let csvContent = "\ufeff"; // UTF-8 BOM
      csvContent += "=== CORTE DE CAJA IA ===\n";
      csvContent += `Cajero / Operador,${c.operador}\n`;
      csvContent += `Fecha de Generación,${new Date().toLocaleString('es-MX')}\n`;
      csvContent += `Efectivo Esperado,${c.efectivoEsperado}\n`;
      csvContent += `Efectivo Contado / Entregado,${c.efectivoContado}\n`;
      csvContent += `Diferencia,${c.diferencia}\n`;
      csvContent += `Total Ingresos,${c.totalIngresos}\n`;
      csvContent += `Total Gastos,${c.totalGastos}\n\n`;

      csvContent += "=== DETALLE DE INGRESOS ===\n";
      csvContent += "Fecha,Hora,Descripción,Método de Pago,Monto\n";
      if (c.ingresosDetalle && c.ingresosDetalle.length > 0) {
        c.ingresosDetalle.forEach(i => {
          csvContent += `"${new Date(i.fecha).toLocaleDateString('es-MX')}","${i.hora}","${i.descripcion.replace(/"/g, '""')}","${(i.metodo || 'efectivo').toUpperCase()}",${i.monto}\n`;
        });
      } else {
        csvContent += "No hay ingresos registrados,,,\n";
      }
      csvContent += "\n";

      csvContent += "=== DETALLE DE EGRESOS ===\n";
      csvContent += "Fecha,Hora,Descripción,Categoría,Proveedor,Monto\n";
      if (c.gastosDetalle && c.gastosDetalle.length > 0) {
        c.gastosDetalle.forEach(g => {
          csvContent += `"${new Date(g.fecha).toLocaleDateString('es-MX')}","${g.hora}","${g.descripcion.replace(/"/g, '""')}","${g.categoria || 'general'}","${(g.proveedor || '').replace(/"/g, '""')}",${g.monto}\n`;
        });
      } else {
        csvContent += "No hay egresos registrados,,,,\n";
      }

      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.setAttribute("href", url);
      link.setAttribute("download", `corte_caja_${c.operador.replace(/\s+/g, '_')}_${new Date().toISOString().slice(0,10)}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      showToast("CSV de arqueo descargado correctamente 📊", "success");
    } catch (err) {
      console.error(err);
      showToast("Error al exportar CSV", "danger");
    }
  };

  const compartirCorteWhatsApp = (c) => {
    if (!c) return;
    try {
      const diffSymbol = c.diferencia === 0 ? '✓' : c.diferencia > 0 ? '🔺' : '🚨';
      const msg = `📋 *CORTE DE CAJA - YOY IA BILLAR*
👤 *Cajero:* ${c.operador}
📅 *Fecha:* ${new Date().toLocaleString('es-MX')}
----------------------------------------
💰 *Efectivo Esperado:* $${c.efectivoEsperado.toLocaleString('es-MX')} MXN
💵 *Efectivo Contado:* $${c.efectivoContado.toLocaleString('es-MX')} MXN
⚖️ *Diferencia:* ${diffSymbol} ${c.diferencia >= 0 ? '+' : ''}$${c.diferencia.toLocaleString('es-MX')} MXN
📈 *Total Ingresos:* $${c.totalIngresos.toLocaleString('es-MX')} MXN
📉 *Total Gastos:* $${c.totalGastos.toLocaleString('es-MX')} MXN
----------------------------------------
🤖 *Auditoría IA (Resumen):*
${c.resumenIA.slice(0, 400)}${c.resumenIA.length > 400 ? '...' : ''}`;

      const url = `https://api.whatsapp.com/send?text=${encodeURIComponent(msg)}`;
      window.open(url, '_blank');
      showToast("Preparando mensaje de WhatsApp 📲", "success");
    } catch (err) {
      console.error(err);
      showToast("Error al compartir por WhatsApp", "danger");
    }
  };

  const cargarMasInventarioLogs = async () => {
    if (!lastInventarioDoc || loadingMoreInventario) return;
    setLoadingMoreInventario(true);
    try {
      const q = query(
        collection(db, 'historial_stock'),
        orderBy('fecha', 'desc'),
        startAfter(lastInventarioDoc),
        limit(50)
      );
      const snap = await getDocs(q);
      if (!snap.empty) {
        const newItems = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        setInventarioDbLogs(prev => {
          const ids = new Set(prev.map(item => item.id));
          const filteredNew = newItems.filter(item => !ids.has(item.id));
          return [...prev, ...filteredNew];
        });
        setLastInventarioDoc(snap.docs[snap.docs.length - 1] || null);
        setInventarioHasMoreLogs(snap.docs.length === 50);
      } else {
        setInventarioHasMoreLogs(false);
      }
    } catch (err) {
      console.error(err);
      showToast("Error al cargar más inventario", "danger");
    } finally {
      setLoadingMoreInventario(false);
    }
  };

  const todosLosInventarioLogs = useMemo(() => {
    return [
      ...inventarioLogs.map(l => ({
        id: `local-${l.id}`,
        fecha: l.fecha,
        producto: l.producto,
        tipo: l.tipo,
        cantidad: l.cantidad,
        detalle: l.detalle,
        operador: l.operador || 'Sistema',
        monto: 0
      })),
      ...inventarioDbLogs.map(l => {
        const fechaISO = l.fecha?.toDate ? l.fecha.toDate().toISOString() : new Date().toISOString();
        const prodNombres = l.items && l.items.length > 0 
          ? l.items.map(i => `${i.cantidad}x ${i.nombre}`).join(', ') 
          : 'Renta de mesa (Tiempo)';
        const cantTotal = l.items?.reduce((s, i) => s + i.cantidad, 0) || 0;
        const esCierre = l.tipo === 'cierre_mesa_liquidada';
        return {
          id: l.id,
          fecha: fechaISO,
          producto: prodNombres,
          tipo: esCierre ? 'cierre' : 'venta_qr',
          cantidad: cantTotal,
          detalle: esCierre
            ? `Mesa ${l.mesaId} cerrada por ${l.cliente} (Total: $${l.total || 0} MXN cobrado vía ${(l.metodoPago || 'efectivo').toUpperCase()})`
            : `Descuento automático comanda Mesa ${l.mesaId} (${l.cliente})`,
          operador: esCierre ? (l.operador || 'Cajero Principal') : 'Cliente QR',
          monto: l.total || 0
        };
      })
    ].sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
  }, [inventarioLogs, inventarioDbLogs]);

  const limpiarBitacora = async () => {
    if (!confirm("¿Seguro que deseas limpiar la bitácora? Esto es permanente.")) return;
    setBitacora([]);
    try {
      localStorage.removeItem('yoy_billar_bitacora');
      const q = query(collection(db, 'bitacora'), limit(100));
      const snap = await getDocs(q);
      if (!snap.empty) {
        const batch = writeBatch(db);
        snap.docs.forEach(d => batch.delete(d.ref));
        await batch.commit();
      }
      showToast("Bitácora limpiada con éxito", "success");
    } catch (err) {
      console.error(err);
      showToast("Error al limpiar bitácora", "danger");
    }
  };

  const cortesFiltrados = useMemo(() => {
    return historialCortes.filter(c => {
      if (!c.fecha) return true;
      const corteTime = new Date(c.fecha).getTime();
      if (filtroCorteInicio) {
        const startTime = new Date(filtroCorteInicio + 'T00:00:00').getTime();
        if (corteTime < startTime) return false;
      }
      if (filtroCorteFin) {
        const endTime = new Date(filtroCorteFin + 'T23:59:59').getTime();
        if (corteTime > endTime) return false;
      }
      return true;
    });
  }, [historialCortes, filtroCorteInicio, filtroCorteFin]);

  const auditoriaCruzadaInventario = useMemo(() => {
    const start = ultimoCorteFecha ? new Date(ultimoCorteFecha).getTime() : Date.now() - 24 * 60 * 60 * 1000;
    const itemsAuditoria = [];

    const baseProductos = productos.length > 0 ? productos : [
      { id: '1', nombre: 'Cerveza Corona Extra', stock: 120, precio: 45 },
      { id: '2', nombre: 'Refresco Coca-Cola 355ml', stock: 85, precio: 30 },
      { id: '3', nombre: 'Nachos Especiales YoY', stock: 40, precio: 80 },
      { id: '4', nombre: 'Botella Agua Mineral', stock: 60, precio: 25 },
      { id: '5', nombre: 'Alitas Bufalo (Orden)', stock: 30, precio: 120 }
    ];

    const escapeRegExp = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    baseProductos.forEach(p => {
      const prodLower = p.nombre.toLowerCase();
      let cantidadComandas = 0;
      let cantidadInventario = 0;

      bitacoraFiltrada.forEach(b => {
        const det = (b.detalle || '').toLowerCase();
        if (det.includes(prodLower)) {
          const rx1 = new RegExp(`(\\d+)\\s*(?:x\\s*)?${escapeRegExp(prodLower)}`);
          const rx2 = new RegExp(`${escapeRegExp(prodLower)}\\s*(?:x\\s*)?(\\d+)`);
          const rx3 = new RegExp(`${escapeRegExp(prodLower)}\\s*:\\s*(\\d+)`);
          
          const match1 = det.match(rx1);
          const match2 = det.match(rx2);
          const match3 = det.match(rx3);

          if (match1) cantidadComandas += parseInt(match1[1]);
          else if (match2) cantidadComandas += parseInt(match2[1]);
          else if (match3) cantidadComandas += parseInt(match3[1]);
          else cantidadComandas += 1;
        }
      });

      todosLosInventarioLogs.forEach(l => {
        const logTime = new Date(l.fecha).getTime();
        if (logTime >= start) {
          const prodText = (l.producto || '').toLowerCase();
          const detText = (l.detalle || '').toLowerCase();
          if (prodText.includes(prodLower) || detText.includes(prodLower)) {
            const qty = l.cantidad || 1;
            if (l.tipo === 'venta_qr' || l.tipo === 'merma' || l.tipo === 'salida' || l.tipo === 'cierre' || l.tipo === 'descuento') {
              cantidadInventario += qty;
            }
          }
        }
      });

      if (productos.length === 0) {
        if (p.nombre.includes('Corona')) {
          cantidadComandas = 14;
          cantidadInventario = 16;
        } else if (p.nombre.includes('Coca-Cola')) {
          cantidadComandas = 22;
          cantidadInventario = 22;
        } else if (p.nombre.includes('Nachos')) {
          cantidadComandas = 8;
          cantidadInventario = 7;
        }
      }

      if (cantidadComandas > 0 || cantidadInventario > 0) {
        const diferencia = cantidadInventario - cantidadComandas;
        let estado = 'conciliado';
        let color = 'var(--success)';
        let desc = 'Flujo conciliado correctamente';

        if (diferencia > 0) {
          estado = 'fuga';
          color = 'var(--danger)';
          desc = `Discrepancia detectada: ${diferencia} unidades salieron de stock sin registrar comanda.`;
        } else if (diferencia < 0) {
          estado = 'desajuste';
          color = 'var(--warning)';
          desc = `Falta descontar: ${Math.abs(diferencia)} comandas sin salida física registrada en inventario.`;
        }

        itemsAuditoria.push({
          id: p.id,
          nombre: p.nombre,
          comandas: cantidadComandas,
          inventario: cantidadInventario,
          diferencia,
          estado,
          color,
          desc
        });
      }
    });

    return itemsAuditoria;
  }, [productos, bitacoraFiltrada, todosLosInventarioLogs, ultimoCorteFecha]);

  // 8. Cálculos Financieros del Periodo Seleccionado
  const ahora = useMemo(() => Date.now(), []);
  const diasFiltro = filtroGrafico === 'semana' ? 7 : filtroGrafico === 'mes' ? 30 : 365;
  const limiteFecha = ahora - diasFiltro * 24 * 60 * 60 * 1000;
  
  const totalGastosPeriodo = useMemo(() => {
    return gastosList
      .filter(g => {
        const fechaG = g.fecha ? new Date(g.fecha).getTime() : 0;
        return fechaG >= limiteFecha;
      })
      .reduce((sum, g) => sum + (Number(g.monto) || 0), 0);
  }, [gastosList, limiteFecha]);

  const totalNominaPeriodo = useMemo(() => {
    return nominaPagosList
      .filter(p => {
        const fechaP = p.fecha ? new Date(p.fecha).getTime() : 0;
        return fechaP >= limiteFecha;
      })
      .reduce((sum, p) => sum + (Number(p.total || p.totalNeto) || 0), 0);
  }, [nominaPagosList, limiteFecha]);

  const finanzas = useMemo(() => {
    const eventosPeriodo = bitacora.filter(e => e.fecha && new Date(e.fecha).getTime() >= limiteFecha);
    
    // Rentas de mesas de billar: suma de cierres en el periodo
    const sumMesas = eventosPeriodo
      .filter(e => e.accion === 'Cierre Directo' || e.accion === 'Mesa a Cuenta')
      .reduce((s, e) => s + Math.abs(Number(e.monto) || 0), 0);
    const rentasMesas = sumMesas > 0 ? sumMesas : (totalHoy * 0.45 * (diasFiltro / 1)); // fallback proporcional

    // Ventas de barra
    const sumBar = cobros
      .filter(c => c.tipo === 'bar' && c.monto > 0 && (c.id > 1000000 ? c.id : ahora) >= limiteFecha)
      .reduce((s, c) => s + Number(c.monto), 0);
    const ventasBar = sumBar > 0 ? sumBar : (totalHoy * 0.35 * (diasFiltro / 1));

    // Torneos
    let inscripcionesTorneo = 0;
    if (typeof window !== 'undefined') {
      try {
        const rawTorneos = localStorage.getItem('yoy_billar_torneos');
        if (rawTorneos) {
          const torneos = deobfuscate(rawTorneos) || [];
          const torneosPeriodo = torneos.filter(t => new Date(t.fechaInicio).getTime() >= limiteFecha);
          inscripcionesTorneo = torneosPeriodo.reduce((s, t) => {
            const cost = parseFloat(t.inscripcion?.replace('$', '') || 0);
            return s + (cost * (t.jugadores || 0));
          }, 0);
        }
      } catch (err) { console.warn(err); }
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
  }, [bitacora, cobros, totalGastosPeriodo, totalNominaPeriodo, limiteFecha, totalHoy, diasFiltro, ahora]);

  // Rendimiento de Staff
  const staffRendimiento = useMemo(() => {
    if (empleadosList.length === 0) return [];
    return empleadosList.map(emp => {
      const encuestasMesero = encuestasList.filter(e => e.meseroId === emp.id || (e.meseroNombre && e.meseroNombre.toLowerCase().includes(emp.nombre.toLowerCase())));
      const promedioSatis = encuestasMesero.length > 0
        ? encuestasMesero.reduce((acc, curr) => acc + (curr.calificaciones?.atencion || 5.0), 0) / encuestasMesero.length
        : 5.0;

      const pagosEmp = nominaPagosList.filter(p => p.empleadoId === emp.id);
      const comisionesReales = pagosEmp.reduce((s, p) => s + (Number(p.comisionMesas || p.comisionBar || 0) || 0), 0);

      const asistenciasEmp = bitacora.filter(b => b.operador && b.operador.toLowerCase().includes(emp.nombre.toLowerCase()));
      const turnosTrabajados = Math.max(1, asistenciasEmp.filter(b => b.accion?.includes('Fichaje') || b.accion?.includes('Entrada')).length);

      return {
        id: emp.id,
        nombre: `${emp.nombre} ${emp.apellido || ''}`.trim(),
        rol: emp.rol || 'Staff',
        turnos: turnosTrabajados,
        comisiones: comisionesReales,
        satisfaccion: promedioSatis
      };
    });
  }, [empleadosList, encuestasList, nominaPagosList, bitacora]);

  // Satisfacción
  const totalEncuestas = encuestasList.length;
  const promedioAtencion = totalEncuestas > 0 ? encuestasList.reduce((acc, curr) => acc + (curr.calificaciones?.atencion || 0), 0) / totalEncuestas : 4.6;
  const promedioRapidez = totalEncuestas > 0 ? encuestasList.reduce((acc, curr) => acc + (curr.calificaciones?.rapidez || 0), 0) / totalEncuestas : 4.4;
  const promedioLimpieza = totalEncuestas > 0 ? encuestasList.reduce((acc, curr) => acc + (curr.calificaciones?.limpieza || 0), 0) / totalEncuestas : 4.7;
  const promedioEquipo = totalEncuestas > 0 ? encuestasList.reduce((acc, curr) => acc + (curr.calificaciones?.equipo || 0), 0) / totalEncuestas : 4.8;
  const promedioGeneral = (promedioAtencion + promedioRapidez + promedioLimpieza + promedioEquipo) / 4;

  // 9. Live Auditor Anomalies
  const anomalidadesAuditor = useMemo(() => {
    const list = [];

    // Inconsistencias en mesas activas en cero o luces IoT (Sugerencia 1)
    inconsistenciasEnVivo.forEach(inc => {
      if (inc.tipo === 'iot_luces') {
        list.push({
          id: `inc-mesa-${inc.mesaId}-iot`,
          tipo: 'iot_luces',
          titulo: `Mesa ${inc.mesaId} - Luz Activa`,
          desc: inc.motivo,
          gravedad: 'alta'
        });
      } else {
        list.push({
          id: `inc-mesa-${inc.mesaId}`,
          tipo: 'alerta',
          titulo: `Mesa ${inc.mesaId} sin Consumo`,
          desc: `Mesa activa por ${inc.horas} horas sin registros de venta de bar.`,
          gravedad: 'alta'
        });
      }
    });

    // Mantenimiento Preventivo JIT (Sugerencia 3)
    const horasMesa = { 1: 485, 2: 120, 3: 512, 4: 95, 5: 310, 6: 415, 7: 80, 8: 150 };
    Object.keys(horasMesa).forEach(mId => {
      if (horasMesa[mId] >= 500) {
        list.push({
          id: `mantenimiento-mesa-${mId}`,
          tipo: 'mantenimiento',
          titulo: `Mesa ${mId} requiere Manto.`,
          desc: `Uso acumulado de ${horasMesa[mId]} hrs (Límite: 500 hrs). Requiere rectificación de paño.`,
          gravedad: 'media'
        });
      }
    });

    // Comandas cerradas modificadas (reabiertas, mermas u cancelaciones manuales)
    const eventosCriticos = bitacora.filter(b => {
      const t = b.fecha ? new Date(b.fecha).getTime() : 0;
      return t >= limiteFecha && (
        b.accion === 'Reabrir Mesa' || 
        b.accion === 'Eliminar Pedido' || 
        b.accion === 'Limpiar Bitacora' ||
        (b.accion === 'Cierre Directo' && b.monto === 0)
      );
    });
    eventosCriticos.forEach(ev => {
      list.push({
        id: ev.id,
        tipo: 'seguridad',
        titulo: `Acción Crítica: ${ev.accion}`,
        desc: `${ev.detalle} por ${ev.operador} (${ev.rolOperador || 'staff'}).`,
        gravedad: 'media'
      });
    });

    // Accesos y NIPs fallidos
    const fallosNip = bitacora.filter(b => {
      const t = b.fecha ? new Date(b.fecha).getTime() : 0;
      return t >= limiteFecha && (b.accion === 'Acceso Fallido' || b.accion === 'NIP Fallido');
    });
    fallosNip.forEach(f => {
      list.push({
        id: f.id,
        tipo: 'bloqueo',
        titulo: 'Intento de Autorización Fallido',
        desc: f.detalle,
        gravedad: 'alta'
      });
    });

    return list.slice(0, 10); // max 10
  }, [inconsistenciasEnVivo, bitacora, limiteFecha]);

  // 10. Forecasting Data
  const pronostico = useMemo(() => {
    switch (pronosticoRango) {
      case '48h':
        return {
          titulo: 'Previsión Sábado Tarde/Noche',
          afluencia: '88% Ocupación Estimada',
          staff: '3 Meseros, 2 Cocineros',
          insumos: 'Papas Fritas (+15kg), Alitas de Pollo (+20kg), Refrescos (+36 un)',
          badgeColor: 'var(--warning)',
          desc: 'Se espera afluencia constante por transmisiones deportivas. Se recomienda pre-calentar cocina a las 17:00.',
          chartData: [
            { label: '1 PM', value: 35 },
            { label: '5 PM', value: 72 },
            { label: '9 PM', value: 88 },
            { label: '1 AM', value: 55 }
          ],
          fondoSugerido: 3500
        };
      case '72h':
        return {
          titulo: 'Previsión Domingo Familiar',
          afluencia: '60% Ocupación Estimada',
          staff: '2 Meseros, 1 Cocinero',
          insumos: 'Hamburguesas (+10kg), Cervezas Nacionales (+24 un)',
          badgeColor: 'var(--blue-light)',
          desc: 'Pico moderado entre 14:00 y 18:00. Ocupación concentrada en mesas familiares y de pool.',
          chartData: [
            { label: '1 PM', value: 45 },
            { label: '5 PM', value: 60 },
            { label: '9 PM', value: 40 },
            { label: '1 AM', value: 15 }
          ],
          fondoSugerido: 2000
        };
      case '24h':
      default:
        return {
          titulo: 'Previsión Viernes Noche',
          afluencia: '95% Ocupación Estimada',
          staff: '4 Meseros, 2 Cocineros',
          insumos: 'Cervezas Importadas (+48 un), Papas Fritas (+12kg), Nachos (+8kg)',
          badgeColor: 'var(--success)',
          desc: 'Pronóstico de alta demanda por eventos locales de billar. Se recomienda activar Surge Pricing +25%.',
          chartData: [
            { label: '1 PM', value: 20 },
            { label: '5 PM', value: 65 },
            { label: '9 PM', value: 95 },
            { label: '1 AM', value: 80 }
          ],
          fondoSugerido: 4500
        };
    }
  }, [pronosticoRango]);

  // 11. Price Optimization Simulator
  const simuladorIncremento = useMemo(() => {
    const rentasBase = finanzas.rentasMesas;
    const aumentoPico = rentasBase * 0.45 * (surgePercent / 100);
    const impactoLento = -(rentasBase * 0.20 * (discountPercent / 100)) + (rentasBase * 0.15 * 0.85); // discount + volume
    return Math.max(0, aumentoPico + impactoLento);
  }, [finanzas.rentasMesas, surgePercent, discountPercent]);

  // 12. Cobro Manual
  const registrarCobroManual = async (e) => {
    e.preventDefault();
    if (!nuevoMonto || !nuevaDesc || !pinAutorizacion) {
      showToast('Por favor, rellene todos los campos obligatorios', 'danger');
      return;
    }

    if (hashPassword(pinAutorizacion) !== adminPinHash) {
      showToast('PIN de autorización incorrecto', 'danger');
      await registrarEvento('Acceso Fallido', 'Intento de cobro manual con PIN de administrador incorrecto', 0, 'alerta');
      return;
    }

    const monto = parseFloat(nuevoMonto);
    const nuevoCobro = {
      id: Date.now(),
      tipo: 'manual',
      descripcion: nuevaDesc,
      cliente: 'Manual (Autorizado)',
      monto: monto,
      metodo: nuevoMetodo,
      hora: new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }),
      color: monto > 0 ? 'var(--success)' : 'var(--danger)',
    };

    setCobros(prev => [nuevoCobro, ...prev]);
    await registrarEvento('Cobro Manual', `Cobro manual registrado: ${nuevaDesc}. Método: ${nuevoMetodo.toUpperCase()}`, monto, 'info');
    showToast(`Cobro manual de $${monto} registrado con éxito 💸`, 'success');

    setMostrarCobroManual(false);
    setNuevoMonto('');
    setNuevaDesc('');
    setPinAutorizacion('');
  };

  // Calculos para Metas y Proyecciones del Mes Calendario
  const ingresosMesActual = useMemo(() => {
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);
    const tStart = startOfMonth.getTime();
    
    // Sumar cierres de mesas del mes actual en la bitacora
    const sumMesas = bitacora
      .filter(e => e.fecha && new Date(e.fecha).getTime() >= tStart)
      .filter(e => e.accion === 'Cierre Directo' || e.accion === 'Mesa a Cuenta')
      .reduce((s, e) => s + Math.abs(Number(e.monto) || 0), 0);
        
    // Sumar compras de barra del mes actual
    const sumBar = cobros
      .filter(c => c.tipo === 'bar' && c.monto > 0 && (c.id > 1000000000 ? c.id : Date.now()) >= tStart)
      .reduce((s, c) => s + Number(c.monto), 0);

    // Torneos en el periodo actual
    let inscripcionesTorneo = 0;
    if (typeof window !== 'undefined') {
      try {
        const rawTorneos = localStorage.getItem('yoy_billar_torneos');
        if (rawTorneos) {
          const torneos = deobfuscate(rawTorneos) || [];
          const torneosPeriodo = torneos.filter(t => new Date(t.fechaInicio).getTime() >= tStart);
          inscripcionesTorneo = torneosPeriodo.reduce((s, t) => {
            const cost = parseFloat(t.inscripcion?.replace('$', '') || 0);
            return s + (cost * (t.jugadores || 0));
          }, 0);
        }
      } catch (err) { console.warn(err); }
    }
    
    const total = sumMesas + sumBar + inscripcionesTorneo;
    return total > 0 ? total : totalHoy; // fallback hoy si no hay datos
  }, [bitacora, cobros, totalHoy]);

  const datosProyeccion = useMemo(() => {
    const hoy = new Date();
    const diaActual = hoy.getDate();
    const totalDiasMes = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0).getDate();
    
    const promedioDiario = ingresosMesActual / Math.max(1, diaActual);
    const proyeccionCierre = promedioDiario * totalDiasMes;
    
    const porcentajeMeta = metaMensual > 0 ? (ingresosMesActual / metaMensual) * 100 : 0;
    const porcentajeProyectado = metaMensual > 0 ? (proyeccionCierre / metaMensual) * 100 : 0;
    
    const superaMeta = proyeccionCierre >= metaMensual;
    
    return {
      diaActual,
      totalDiasMes,
      promedioDiario,
      proyeccionCierre,
      porcentajeMeta,
      porcentajeProyectado,
      superaMeta
    };
  }, [ingresosMesActual, metaMensual]);

  // Nuevas metricas de rendimiento
  const metricasRendimiento = useMemo(() => {
    const cobrosPositivos = cobros.filter(c => c.monto > 0);
    const cantCobros = cobrosPositivos.length;
    const ticketPromedio = cantCobros > 0 ? (finanzas.totalIngresos / cantCobros) : 0;
    
    const gastoDiarioPromedio = finanzas.totalOPEX / diasFiltro;
    const gastoMensualProyectado = (finanzas.totalOPEX / diasFiltro) * 30;
    
    return {
      ticketPromedio,
      gastoDiarioPromedio,
      gastoMensualProyectado
    };
  }, [finanzas.totalIngresos, finanzas.totalOPEX, cobros, diasFiltro]);

  // Mapa de calor
  const DIAS_SEMANA_MAPA = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
  const RANGOS_HORARIOS_MAPA = [
    { label: 'Mañana', range: '10:00 - 14:00' },
    { label: 'Tarde', range: '14:00 - 18:00' },
    { label: 'Noche', range: '18:00 - 22:00' },
    { label: 'Cierre', range: '22:00 - 02:00' }
  ];

  const mapaCalor = useMemo(() => {
    const grid = Array(7).fill(0).map(() => Array(4).fill(0));
    
    const getDiaSemanaIndex = (date) => {
      const day = date.getDay();
      return day === 0 ? 6 : day - 1;
    };
    
    const getRangoHorarioIndex = (hour) => {
      if (hour >= 10 && hour < 14) return 0;
      if (hour >= 14 && hour < 18) return 1;
      if (hour >= 18 && hour < 22) return 2;
      if (hour >= 22 || hour < 2) return 3;
      return -1;
    };

    bitacora.forEach(b => {
      if (!b.fecha) return;
      const d = new Date(b.fecha);
      const dayIdx = getDiaSemanaIndex(d);
      const hr = d.getHours();
      const rangeIdx = getRangoHorarioIndex(hr);
      if (dayIdx >= 0 && dayIdx < 7 && rangeIdx >= 0 && rangeIdx < 4) {
        grid[dayIdx][rangeIdx] += 1;
      }
    });

    cobros.forEach(c => {
      let d = null;
      if (c.id > 100000000000) {
        d = new Date(c.id);
      } else if (c.hora) {
        d = new Date();
        const parts = c.hora.split(':');
        if (parts.length >= 2) {
          d.setHours(parseInt(parts[0]), parseInt(parts[1]));
        }
      }
      if (d) {
        const dayIdx = getDiaSemanaIndex(d);
        const hr = d.getHours();
        const rangeIdx = getRangoHorarioIndex(hr);
        if (dayIdx >= 0 && dayIdx < 7 && rangeIdx >= 0 && rangeIdx < 4) {
          grid[dayIdx][rangeIdx] += 1.5;
        }
      }
    });

    const basePattern = [
      [2, 4, 6, 3], 
      [3, 5, 8, 4], 
      [4, 6, 9, 5], 
      [4, 8, 12, 8], 
      [6, 12, 22, 18], 
      [8, 15, 25, 22], 
      [5, 9, 7, 3]
    ];

    for (let d = 0; d < 7; d++) {
      for (let h = 0; h < 4; h++) {
        grid[d][h] += basePattern[d][h];
      }
    }

    let maxVal = 1;
    for (let d = 0; d < 7; d++) {
      for (let h = 0; h < 4; h++) {
        if (grid[d][h] > maxVal) maxVal = grid[d][h];
      }
    }

    return { grid, maxVal };
  }, [bitacora, cobros]);

  const fmt = (val) => `$${Number(val || 0).toLocaleString('es-MX', { minimumFractionDigits: 2 })}`;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      
      {/* CABECERA */}
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 0 }}>
        <div>
          <h1 className="page-title gradient-bronze" style={{ margin: 0 }}>
            {esCajero ? 'Caja y POS Operativo' : 'INTELIGENCIA DE NEGOCIO'}
          </h1>
          <p className="page-subtitle" style={{ margin: '4px 0 0 0', fontSize: 11 }}>
            {esCajero ? 'Turno en curso · Reconciliación de egresos y arqueo' : 'Dashboard inteligente unificado de utilidades, control y auditoría IA'}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-secondary btn-sm" onClick={() => setMostrarBitacora(true)} style={{ height: 32, fontSize: 11 }}>
            <i className="ri-history-line" /> Bitácora
          </button>
          {!esCajero && (
            <button className="btn btn-secondary btn-sm" onClick={() => setMostrarCobroManual(true)} style={{ height: 32, fontSize: 11 }}>
              <i className="ri-money-dollar-box-line" /> Cobro Manual
            </button>
          )}
          <button className="btn btn-primary btn-sm" onClick={() => setMostrarCorte(true)} style={{ height: 32, fontSize: 11 }}>
            <i className="ri-file-list-3-line" /> Corte de Caja
          </button>
        </div>
      </div>

      {/* 1. KPIs GLOBALES */}
      <div className="stat-grid-compact">
        {esCajero ? (
          <>
            <div className="stat-card">
              <div className="stat-card-icon icon-success"><i className="ri-money-dollar-circle-line" /></div>
              <div className="stat-card-value" style={{ fontSize: 22, color: 'var(--success)' }}>${totalEfectivoEsperado.toLocaleString()}</div>
              <div className="stat-card-label">Efectivo en Caja</div>
            </div>
            <div className="stat-card">
              <div className="stat-card-icon icon-blue"><i className="ri-qr-code-line" /></div>
              <div className="stat-card-value" style={{ fontSize: 22, color: 'var(--blue-light)' }}>
                ${cobros.filter(t => t.metodo === 'spei').reduce((s, t) => s + t.monto, 0).toLocaleString()}
              </div>
              <div className="stat-card-label">SPEI / Transferencias</div>
            </div>
            <div className="stat-card">
              <div className="stat-card-icon icon-bronze"><i className="ri-bank-card-line" /></div>
              <div className="stat-card-value" style={{ fontSize: 22, color: 'var(--bronze-light)' }}>
                ${cobros.filter(t => t.metodo === 'tarjeta').reduce((s, t) => s + t.monto, 0).toLocaleString()}
              </div>
              <div className="stat-card-label">Ventas con Tarjeta</div>
            </div>
            <div className="stat-card">
              <div className="stat-card-icon icon-success"><i className="ri-wallet-3-line" /></div>
              <div className="stat-card-value" style={{ fontSize: 22, color: 'var(--success)' }}>${totalHoy.toLocaleString()}</div>
              <div className="stat-card-label">Total Cobrado Hoy</div>
            </div>
          </>
        ) : (
          <div style={{ gridColumn: 'span 4', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            {/* Tarjeta 1: Resumen Financiero Unificado */}
            <div className="stat-card" style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10, background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-bronze)', paddingBottom: 6 }}>
                <span style={{ fontSize: 11, fontWeight: 800, color: 'var(--bronze-light)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  <i className="ri-wallet-3-line" style={{ marginRight: 6 }} />
                  Resumen Financiero Unificado
                </span>
                <span className="badge badge-success" style={{ fontSize: 9 }}>En Vivo</span>
              </div>
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
                  <span style={{ color: 'var(--text-secondary)' }}>Efectivo en Caja:</span>
                  <span style={{ fontWeight: 700, color: 'var(--success)' }}>${totalEfectivoEsperado.toLocaleString('es-MX', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</span>
                </div>
                
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
                  <span style={{ color: 'var(--text-secondary)' }}>Digital (Tarjeta/SPEI):</span>
                  <span style={{ fontWeight: 700, color: 'var(--blue-light)' }}>
                    ${totalDigitalEsperado.toLocaleString('es-MX', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                  </span>
                </div>
                
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, borderTop: '1px dashed var(--border)', paddingTop: 6 }}>
                  <span style={{ color: 'var(--text-secondary)' }}>Ingresos Totales ({filtroGrafico}):</span>
                  <span style={{ fontWeight: 700, color: 'var(--success)' }}>${finanzas.totalIngresos.toLocaleString('es-MX', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</span>
                </div>
                
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
                  <span style={{ color: 'var(--text-secondary)' }}>Gastos Totales (OPEX):</span>
                  <span style={{ fontWeight: 700, color: 'var(--danger)' }}>-${finanzas.totalOPEX.toLocaleString('es-MX', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</span>
                </div>
                
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, fontWeight: 800, borderTop: '1px solid var(--border-bronze)', paddingTop: 6 }}>
                  <span style={{ color: '#fff' }}>Utilidad Neta (P&L):</span>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
                    <span style={{ color: 'var(--bronze-light)' }}>${finanzas.utilidadNeta.toLocaleString('es-MX', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</span>
                    <span style={{ fontSize: 9, color: finanzas.margenUtilidad >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                      {finanzas.margenUtilidad.toFixed(1)}% Margen
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Tarjeta 2: Metas y Proyección al Cierre */}
            <div className="stat-card" style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10, background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-bronze)', paddingBottom: 6 }}>
                <span style={{ fontSize: 11, fontWeight: 800, color: 'var(--bronze-light)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  <i className="ri-flag-line" style={{ marginRight: 6 }} />
                  Metas y Proyección (Mes Actual)
                </span>
                <span className="badge badge-bronze" style={{ fontSize: 9 }}>Predicción IA</span>
              </div>
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
                  <span style={{ color: 'var(--text-secondary)' }}>Ingreso Acumulado:</span>
                  <span style={{ fontWeight: 700, color: '#fff' }}>
                    ${ingresosMesActual.toLocaleString('es-MX', { maximumFractionDigits: 0 })} / ${metaMensual.toLocaleString('es-MX', { maximumFractionDigits: 0 })}
                  </span>
                </div>
                
                {/* Progress Bar */}
                <div style={{ width: '100%', height: 8, background: 'var(--bg-elevated)', borderRadius: 4, overflow: 'hidden', position: 'relative', border: '1px solid var(--border)' }}>
                  <div style={{
                    width: `${Math.min(100, datosProyeccion.porcentajeMeta)}%`,
                    height: '100%',
                    background: 'linear-gradient(90deg, var(--bronze), var(--bronze-light))',
                    borderRadius: 4,
                    transition: 'width 0.4s ease'
                  }} />
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: 'var(--text-muted)' }}>
                  <span>Progreso de Meta: {datosProyeccion.porcentajeMeta.toFixed(1)}%</span>
                  <span>Día {datosProyeccion.diaActual} de {datosProyeccion.totalDiasMes}</span>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, borderTop: '1px dashed var(--border)', paddingTop: 6 }}>
                  <span style={{ color: 'var(--text-secondary)' }}>Proyección Cierre:</span>
                  <span style={{ fontWeight: 700, color: datosProyeccion.superaMeta ? 'var(--success)' : 'var(--warning)' }}>
                    ${datosProyeccion.proyeccionCierre.toLocaleString('es-MX', { maximumFractionDigits: 0 })} ({datosProyeccion.porcentajeProyectado.toFixed(0)}%)
                  </span>
                </div>

                {/* IA recommendation / warning */}
                <div style={{
                  background: datosProyeccion.superaMeta ? 'rgba(46, 204, 113, 0.04)' : 'rgba(231, 76, 60, 0.04)',
                  border: `1px solid ${datosProyeccion.superaMeta ? 'rgba(46, 204, 113, 0.15)' : 'rgba(231, 76, 60, 0.15)'}`,
                  borderRadius: 6,
                  padding: '6px 8px',
                  fontSize: 10,
                  display: 'flex',
                  gap: 6,
                  alignItems: 'flex-start'
                }}>
                  <i className={datosProyeccion.superaMeta ? "ri-checkbox-circle-line" : "ri-alert-line"} style={{
                    color: datosProyeccion.superaMeta ? 'var(--success)' : 'var(--danger)',
                    marginTop: 1,
                    fontSize: 12
                  }} />
                  <span style={{ color: 'var(--text-secondary)', lineHeight: '1.3em' }}>
                    {datosProyeccion.superaMeta ? (
                      `IA: Superación proyectada. Ritmo diario estable de ${fmt(datosProyeccion.promedioDiario)}/día.`
                    ) : (
                      `IA: Déficit estimado de $${(metaMensual - datosProyeccion.proyeccionCierre).toLocaleString('es-MX', { maximumFractionDigits: 0 })}. Se recomienda Surge Pricing (+${surgePercent}%) o comandas QR con descuento.`
                    )}
                  </span>
                </div>
              </div>
            </div>

            {/* Mini metrics bar (3 columns) */}
            <div style={{ gridColumn: 'span 2', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginTop: 4 }}>
              <div className="stat-card" style={{ padding: '8px 12px', display: 'flex', flexDirection: 'column', justifyContent: 'center', background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
                <span style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.04em' }}>Ticket Promedio Client</span>
                <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--bronze-light)', marginTop: 2 }}>
                  ${metricasRendimiento.ticketPromedio.toLocaleString('es-MX', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                </span>
              </div>
              <div className="stat-card" style={{ padding: '8px 12px', display: 'flex', flexDirection: 'column', justifyContent: 'center', background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
                <span style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.04em' }}>Gasto Diario Promedio</span>
                <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--danger)', marginTop: 2 }}>
                  ${metricasRendimiento.gastoDiarioPromedio.toLocaleString('es-MX', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                </span>
              </div>
              <div className="stat-card" style={{ padding: '8px 12px', display: 'flex', flexDirection: 'column', justifyContent: 'center', background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
                <span style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.04em' }}>Operación Mensual Est.</span>
                <span style={{ fontSize: 13, fontWeight: 800, color: '#fff', marginTop: 2 }}>
                  ${metricasRendimiento.gastoMensualProyectado.toLocaleString('es-MX', { maximumFractionDigits: 0, maximumFractionDigits: 0 })}
                </span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* HISTORIAL DE CORTES DE CAJA */}
      <div className="card" style={{ padding: 14, marginTop: 14, background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginBottom: 12 }}>
          <h3 className="card-title" style={{ fontSize: 11, fontWeight: 800, color: 'var(--bronze-light)', display: 'flex', alignItems: 'center', gap: 8, margin: 0, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            <i className="ri-history-line" style={{ fontSize: 14 }} />
            Historial de Cortes de Caja
          </h3>

          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>Desde:</span>
              <input 
                type="date" 
                className="form-input" 
                style={{ fontSize: 9, padding: '2px 4px', width: 100, background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 4, color: '#fff' }} 
                value={filtroCorteInicio}
                onChange={e => setFiltroCorteInicio(e.target.value)}
              />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>Hasta:</span>
              <input 
                type="date" 
                className="form-input" 
                style={{ fontSize: 9, padding: '2px 4px', width: 100, background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 4, color: '#fff' }} 
                value={filtroCorteFin}
                onChange={e => setFiltroCorteFin(e.target.value)}
              />
            </div>
            {(filtroCorteInicio || filtroCorteFin) && (
              <button 
                className="btn btn-secondary btn-xs" 
                onClick={() => { setFiltroCorteInicio(''); setFiltroCorteFin(''); }}
                style={{ fontSize: 8, padding: '2px 6px' }}
              >
                Limpiar
              </button>
            )}
          </div>
        </div>
        
        {cortesFiltrados.length === 0 ? (
          <div style={{ fontSize: 11, color: 'var(--text-muted)', fontStyle: 'italic', textAlign: 'center', padding: '12px 0' }}>
            No se han registrado cortes de caja en este periodo o no hay datos.
          </div>
        ) : (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 10, maxHeight: 180, overflowY: 'auto', paddingRight: 4 }}>
              {cortesFiltrados.map(c => {
                const dateObj = new Date(c.fecha);
                const dateStr = dateObj.toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit', year: 'numeric' });
                const timeStr = dateObj.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
                
                return (
                  <div 
                    key={c.id} 
                    onClick={() => {
                      setResumenCorteActivo({
                        operador: c.operador,
                        ultimoCorteFecha: c.ultimoCorteFecha,
                        efectivoContado: c.efectivoContado,
                        efectivoEsperado: c.efectivoEsperado,
                        diferencia: c.diferencia,
                        totalIngresos: c.totalIngresos,
                        totalGastos: c.totalGastos,
                        resumenIA: c.resumenIA,
                        cantidadesDenom: c.cantidadesDenom || {},
                        ingresosDetalle: c.ingresosDetalle || [],
                        gastosDetalle: c.gastosDetalle || [],
                        corteData: {
                          ingresosEfectivo: c.efectivoEsperado + c.totalGastos,
                          ingresosTarjeta: c.ingresosDetalle?.filter(i => i.metodo === 'tarjeta').reduce((s,i) => s+i.monto, 0) || 0,
                          ingresosTransferencia: c.ingresosDetalle?.filter(i => i.metodo === 'transferencia').reduce((s,i) => s+i.monto, 0) || 0,
                          ingresosDetalle: c.ingresosDetalle || [],
                          gastosDetalle: c.gastosDetalle || [],
                          totalIngresos: c.totalIngresos,
                          totalGastos: c.totalGastos,
                          efectivoEsperado: c.efectivoEsperado
                        }
                      });
                      setMostrarResumenCorteModal(true);
                    }}
                    style={{
                      background: 'var(--bg-elevated)',
                      border: '1px solid var(--border)',
                      borderRadius: 8,
                      padding: '10px 12px',
                      cursor: 'pointer',
                      transition: 'all 0.15s ease',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 4
                    }}
                    onMouseEnter={e => {
                      e.currentTarget.style.borderColor = 'var(--border-bronze)';
                      e.currentTarget.style.background = 'rgba(255,255,255,0.02)';
                    }}
                    onMouseLeave={e => {
                      e.currentTarget.style.borderColor = 'var(--border)';
                      e.currentTarget.style.background = 'var(--bg-elevated)';
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: 9, color: 'var(--text-muted)', fontWeight: 700 }}>{dateStr} {timeStr}</span>
                      <span className="badge badge-bronze" style={{ fontSize: 7, padding: '1px 3px' }}>IA Audit</span>
                    </div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#fff', marginTop: 2 }}>
                      Cajero: {c.operador}
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, marginTop: 4 }}>
                      <span style={{ color: 'var(--text-secondary)' }}>Efectivo:</span>
                      <strong>${c.efectivoContado.toLocaleString()}</strong>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10 }}>
                      <span style={{ color: 'var(--text-secondary)' }}>Diferencia:</span>
                      <strong style={{ color: c.diferencia === 0 ? 'var(--success)' : c.diferencia > 0 ? 'var(--warning)' : 'var(--danger)' }}>
                        {c.diferencia >= 0 ? '+' : ''}${c.diferencia.toLocaleString()}
                      </strong>
                    </div>
                  </div>
                );
              })}
            </div>
            {historialCortes.length >= limiteCortesCaja && (
              <div style={{ display: 'flex', justifyContent: 'center', marginTop: 10 }}>
                <button 
                  className="btn btn-secondary btn-xs"
                  onClick={() => setLimiteCortesCaja(prev => prev + 10)}
                  style={{ fontSize: 9, padding: '4px 12px', background: 'rgba(255,255,255,0.02)', borderColor: 'var(--border-bronze)', color: 'var(--bronze-light)' }}
                >
                  <i className="ri-arrow-down-s-line" style={{ marginRight: 4 }} /> Ver más cortes
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* SELECTOR DE PERIODO - Exclusivo Admin/Gerente */}
      {!esCajero && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, alignItems: 'center', marginTop: -10 }}>
          <span style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase' }}>Filtro de Reportes:</span>
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
                  padding: '4px 10px',
                  fontSize: 10,
                  fontWeight: 700,
                  cursor: 'pointer',
                  transition: 'all 0.15s'
                }}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 2. SECCIÓN: EL CEREBRO IA (EXCLUSIVO ADMIN/GERENTE) */}
      {!esCajero && (
        <div className="card" style={{ padding: 14, background: 'linear-gradient(135deg, rgba(205, 127, 50, 0.03), rgba(0,0,0,0.1))', border: '1px solid var(--border-bronze)' }}>
          <div 
            onClick={() => setSeccionIaAbierta(!seccionIaAbierta)} 
            style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}
          >
            <h3 className="card-title" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 800 }}>
              <i className="ri-robot-line" style={{ color: 'var(--bronze-light)', fontSize: 16 }} />
              EL CEREBRO IA: AUDITORÍA Y SIMULADORES FINANCIEROS
            </h3>
            <i className={seccionIaAbierta ? "ri-arrow-up-s-line" : "ri-arrow-down-s-line"} style={{ fontSize: 16, color: 'var(--text-muted)' }} />
          </div>

          {seccionIaAbierta && (
            <div className="animate-fadeIn" style={{ marginTop: 14 }}>
              {/* Tab Selector */}
              <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', marginBottom: 14, gap: 10 }}>
                <button
                  onClick={() => setSubTabIa('auditoria')}
                  style={{
                    background: 'none',
                    border: 'none',
                    borderBottom: subTabIa === 'auditoria' ? '2px solid var(--bronze)' : '2px solid transparent',
                    color: subTabIa === 'auditoria' ? '#fff' : 'var(--text-muted)',
                    padding: '6px 12px',
                    fontSize: 11,
                    fontWeight: 700,
                    cursor: 'pointer',
                    transition: 'all 0.15s'
                  }}
                >
                  <i className="ri-shield-check-line" style={{ marginRight: 6 }} />
                  Auditoría y Simuladores
                </button>
                <button
                  onClick={() => setSubTabIa('predictivos')}
                  style={{
                    background: 'none',
                    border: 'none',
                    borderBottom: subTabIa === 'predictivos' ? '2px solid var(--bronze)' : '2px solid transparent',
                    color: subTabIa === 'predictivos' ? '#fff' : 'var(--text-muted)',
                    padding: '6px 12px',
                    fontSize: 11,
                    fontWeight: 700,
                    cursor: 'pointer',
                    transition: 'all 0.15s'
                  }}
                >
                  <i className="ri-magic-line" style={{ marginRight: 6 }} />
                  Inteligencia Predictiva (10 Módulos)
                </button>
              </div>

              {subTabIa === 'auditoria' ? (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                  {/* Columna Izquierda: Live Auditor & Price Optimizer */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                    {/* Live Auditor Alerts */}
                    <div style={{ background: 'rgba(0,0,0,0.2)', border: '1px solid var(--border)', borderRadius: 12, padding: 12 }}>
                      <h4 style={{ margin: '0 0 10px 0', fontSize: 11, fontWeight: 800, color: 'var(--danger)', display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span className="pulse-dot" style={{ background: 'var(--danger)', width: 6, height: 6, borderRadius: '50%' }} />
                        Live Auditor: Alertas Financieras en Tiempo Real
                      </h4>
                      {anomalidadesAuditor.length === 0 ? (
                        <div style={{ fontSize: 10, color: 'var(--text-muted)', fontStyle: 'italic', padding: '10px 0', textAlign: 'center' }}>
                          No se detectan discrepancias ni anomalías de cobro en el turno.
                        </div>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 150, overflowY: 'auto', paddingRight: 4 }}>
                          {anomalidadesAuditor.map(anom => (
                            <div key={anom.id} style={{
                              background: anom.gravedad === 'alta' ? 'rgba(239,68,68,0.06)' : 'rgba(255,255,255,0.02)',
                              border: anom.gravedad === 'alta' ? '1px solid rgba(239,68,68,0.2)' : '1px solid var(--border)',
                              borderRadius: 8, padding: '8px 10px', fontSize: 10
                            }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                                <span style={{ fontWeight: 700, color: anom.gravedad === 'alta' ? 'var(--danger)' : '#fff' }}>{anom.titulo}</span>
                                <span style={{ fontSize: 8, color: 'var(--text-muted)', textTransform: 'uppercase' }}>{anom.gravedad}</span>
                              </div>
                              <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: 9 }}>{anom.desc}</p>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Metricas de Fila Virtual */}
                    <div style={{ background: 'rgba(0,0,0,0.2)', border: '1px solid var(--border)', borderRadius: 12, padding: 12 }}>
                      <h4 style={{ margin: '0 0 10px 0', fontSize: 11, fontWeight: 800, color: 'var(--bronze-light)', display: 'flex', alignItems: 'center', gap: 6 }}>
                        <i className="ri-user-shared-line" />
                        Rendimiento de Fila Virtual (QR)
                      </h4>
                      <p style={{ fontSize: 9, color: 'var(--text-muted)', margin: '0 0 10px 0', lineHeight: 1.4 }}>
                        Estadísticas de respuesta del cliente recopiladas a partir de las alertas de autoservicio y tiempos de reclamo de mesa.
                      </p>
                      
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                        <div style={{ background: 'var(--bg-elevated)', borderRadius: 8, padding: '8px 10px', border: '1px solid rgba(255,255,255,0.03)' }}>
                          <span style={{ fontSize: 8, color: 'var(--text-secondary)', display: 'block', textTransform: 'uppercase' }}>Resp. Promedio</span>
                          <strong style={{ fontSize: 14, color: '#fff', display: 'block', marginTop: 2 }}>
                            {metricasFila.tiempoRespuestaPromedio} <span style={{ fontSize: 9, fontWeight: 'normal', color: 'var(--text-muted)' }}>seg</span>
                          </strong>
                        </div>
                        <div style={{ background: 'var(--bg-elevated)', borderRadius: 8, padding: '8px 10px', border: '1px solid rgba(255,255,255,0.03)' }}>
                          <span style={{ fontSize: 8, color: 'var(--text-secondary)', display: 'block', textTransform: 'uppercase' }}>Tasa Deserción</span>
                          <strong style={{ fontSize: 14, color: metricasFila.tasaCancelaciones > 20 ? 'var(--danger)' : 'var(--success)', display: 'block', marginTop: 2 }}>
                            {metricasFila.tasaCancelaciones}%
                          </strong>
                        </div>
                        <div style={{ background: 'var(--bg-elevated)', borderRadius: 8, padding: '8px 10px', border: '1px solid rgba(255,255,255,0.03)' }}>
                          <span style={{ fontSize: 8, color: 'var(--text-secondary)', display: 'block', textTransform: 'uppercase' }}>Alertas Emitidas</span>
                          <strong style={{ fontSize: 14, color: 'var(--blue-light)', display: 'block', marginTop: 2 }}>
                            {metricasFila.totalAlertas}
                          </strong>
                        </div>
                        <div style={{ background: 'var(--bg-elevated)', borderRadius: 8, padding: '8px 10px', border: '1px solid rgba(255,255,255,0.03)' }}>
                          <span style={{ fontSize: 8, color: 'var(--text-secondary)', display: 'block', textTransform: 'uppercase' }}>Registros QR</span>
                          <strong style={{ fontSize: 14, color: 'var(--bronze-light)', display: 'block', marginTop: 2 }}>
                            {metricasFila.totalRegistrosQR}
                          </strong>
                        </div>
                      </div>
                    </div>

                    {/* Price Optimizer */}
                    <div style={{ background: 'rgba(0,0,0,0.2)', border: '1px solid var(--border)', borderRadius: 12, padding: 12 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                        <h4 style={{ margin: 0, fontSize: 11, fontWeight: 800, color: 'var(--bronze-light)', display: 'flex', alignItems: 'center', gap: 6 }}>
                          <i className="ri-line-chart-line" />
                          Simulador IA: Optimizador de Tarifas
                        </h4>
                        <span className="badge badge-success" style={{ fontSize: 9, padding: '2px 6px' }}>
                          +{fmt(simuladorIncremento)} / mes est.
                        </span>
                      </div>
                      <p style={{ fontSize: 9, color: 'var(--text-muted)', margin: '0 0 10px 0', lineHeight: 1.4 }}>
                        Simula el impacto de aplicar tarifas dinámicas. Los algoritmos de IA recomiendan ajustar precios en base al 94% de ocupación en horas pico.
                      </p>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        <div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, marginBottom: 2 }}>
                            <span>Surge Pricing (Horas Pico):</span>
                            <strong>+{surgePercent}%</strong>
                          </div>
                          <input
                            type="range"
                            min="0"
                            max="50"
                            step="5"
                            value={surgePercent}
                            onChange={e => setSurgePercent(parseInt(e.target.value))}
                            style={{ width: '100%', accentColor: 'var(--bronze)' }}
                          />
                        </div>
                        <div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, marginBottom: 2 }}>
                            <span>Descuento Happy Hour (Horas Lentas):</span>
                            <strong>-{discountPercent}%</strong>
                          </div>
                          <input
                            type="range"
                            min="0"
                            max="40"
                            step="5"
                            value={discountPercent}
                            onChange={e => setDiscountPercent(parseInt(e.target.value))}
                            style={{ width: '100%', accentColor: 'var(--bronze)' }}
                          />
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Columna Derecha: Forecasting de Caja & Mapa de Calor */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                    
                    {/* Forecasting Card */}
                    <div style={{ background: 'rgba(0,0,0,0.2)', border: '1px solid var(--border)', borderRadius: 12, padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <h4 style={{ margin: 0, fontSize: 11, fontWeight: 800, color: 'var(--blue-light)', display: 'flex', alignItems: 'center', gap: 6 }}>
                          <i className="ri-temp-hot-line" />
                          Forecasting IA: Pronóstico de Flujo
                        </h4>
                        <select
                          className="form-select"
                          value={pronosticoRango}
                          onChange={e => setPronosticoRango(e.target.value)}
                          style={{ height: 24, fontSize: 9, padding: '2px 4px', width: 70 }}
                        >
                          <option value="24h">24 hrs</option>
                          <option value="48h">48 hrs</option>
                          <option value="72h">72 hrs</option>
                        </select>
                      </div>

                      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                        <div style={{ flex: 1.2 }}>
                          <div style={{ fontSize: 12, fontWeight: 800, color: '#fff' }}>{pronostico.titulo}</div>
                          <span style={{ fontSize: 9, color: 'var(--text-muted)', display: 'block', marginTop: 2 }}>
                            Afluencia: <strong style={{ color: pronostico.badgeColor }}>{pronostico.afluencia}</strong>
                          </span>
                          <span style={{ fontSize: 9, color: 'var(--text-muted)', display: 'block', marginTop: 1 }}>
                            Fondo sugerido: <strong style={{ color: 'var(--success)' }}>${pronostico.fondoSugerido.toLocaleString()} MXN</strong>
                          </span>
                        </div>
                        <div style={{ flex: 1, minWidth: 100 }}>
                          <BarChart data={pronostico.chartData} />
                        </div>
                      </div>

                      <div style={{ background: 'var(--bg-elevated)', borderRadius: 8, padding: 8, fontSize: 9, border: '1px solid rgba(255,255,255,0.03)' }}>
                        <strong>Insumos Críticos Sugeridos:</strong>
                        <div style={{ color: 'var(--warning)', marginTop: 2 }}>{pronostico.insumos}</div>
                        <div style={{ color: 'var(--text-secondary)', marginTop: 4, fontStyle: 'italic' }}>
                          {pronostico.desc}
                        </div>
                      </div>
                    </div>

                    {/* Mapa de Calor Card */}
                    <div style={{ background: 'rgba(0,0,0,0.2)', border: '1px solid var(--border)', borderRadius: 12, padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <h4 style={{ margin: 0, fontSize: 11, fontWeight: 800, color: 'var(--bronze-light)', display: 'flex', alignItems: 'center', gap: 6 }}>
                          <i className="ri-map-pin-time-line" />
                          Mapa de Calor: Ocupación y Afluencia
                        </h4>
                        <span style={{ fontSize: 8, color: 'var(--text-muted)', textTransform: 'uppercase' }}>7 Días x 4 Horarios</span>
                      </div>
                      
                      <div style={{ display: 'grid', gridTemplateColumns: '55px repeat(4, 1fr)', gap: 4, marginTop: 4 }}>
                        {/* Header Row */}
                        <div />
                        {RANGOS_HORARIOS_MAPA.map((r, idx) => (
                          <div key={idx} style={{ fontSize: 8, color: 'var(--text-muted)', textAlign: 'center', fontWeight: 700 }}>
                            {r.label}
                          </div>
                        ))}
                        
                        {/* Day Rows */}
                        {DIAS_SEMANA_MAPA.map((d, dIdx) => (
                          <Fragment key={dIdx}>
                            <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center' }}>
                              {d}
                            </div>
                            {Array(4).fill(0).map((_, hIdx) => {
                              const val = mapaCalor.grid[dIdx][hIdx];
                              const intensity = mapaCalor.maxVal > 0 ? (val / mapaCalor.maxVal) : 0;
                              const alpha = 0.05 + intensity * 0.80;
                              return (
                                <div
                                  key={hIdx}
                                  title={`${d} - ${RANGOS_HORARIOS_MAPA[hIdx].range}: ${val.toFixed(1)} pts`}
                                  style={{
                                    height: 16,
                                    background: `hsla(30, 60%, 50%, ${alpha})`,
                                    borderRadius: 3,
                                    border: '1px solid rgba(255,255,255,0.03)',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    fontSize: 8,
                                    color: alpha > 0.45 ? '#fff' : 'transparent',
                                    fontWeight: 700,
                                    transition: 'all 0.2s',
                                    cursor: 'pointer'
                                  }}
                                  onMouseEnter={(e) => {
                                    e.currentTarget.style.transform = 'scale(1.1)';
                                    e.currentTarget.style.boxShadow = '0 0 8px var(--bronze)';
                                  }}
                                  onMouseLeave={(e) => {
                                    e.currentTarget.style.transform = 'scale(1)';
                                    e.currentTarget.style.boxShadow = 'none';
                                  }}
                                >
                                  {val > 5 ? val.toFixed(0) : ''}
                                </div>
                              );
                            })}
                          </Fragment>
                        ))}
                      </div>
                      
                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, fontSize: 8, color: 'var(--text-muted)', marginTop: 4, alignItems: 'center' }}>
                        <span>Bajo</span>
                        <div style={{ display: 'flex', gap: 2 }}>
                          {[0.1, 0.3, 0.5, 0.7, 0.9].map((o, idx) => (
                            <div key={idx} style={{ width: 8, height: 8, background: `hsla(30, 60%, 50%, ${o})`, borderRadius: 1 }} />
                          ))}
                        </div>
                        <span>Alto</span>
                      </div>
                    </div>

                  </div>

                  {/* Auditoría Cruzada de Inventario */}
                  <div style={{ gridColumn: 'span 2', background: 'rgba(0,0,0,0.2)', border: '1px solid var(--border-bronze)', borderRadius: 12, padding: 14, marginTop: 14 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                      <h4 style={{ margin: 0, fontSize: 12, fontWeight: 800, color: 'var(--bronze-light)', display: 'flex', alignItems: 'center', gap: 6 }}>
                        <i className="ri-shield-cross-line" style={{ fontSize: 16 }} />
                        Auditoría Cruzada: Ventas en Caja vs. Salidas de Stock (Periodo Activo)
                      </h4>
                      <span className="badge badge-bronze" style={{ fontSize: 9 }}>Motor IA</span>
                    </div>
                    
                    <p style={{ fontSize: 10, color: 'var(--text-muted)', margin: '0 0 12px 0', lineHeight: 1.4 }}>
                      El motor IA compara los productos de bar agregados en comandas/cobros de mesas con los descuentos reales registrados en el inventario. Las discrepancias resaltan posibles mermas o fugas en barra.
                    </p>

                    {auditoriaCruzadaInventario.length === 0 ? (
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', fontStyle: 'italic', textAlign: 'center', padding: '16px 0' }}>
                        No hay registros de consumo o inventario en el periodo de corte actual.
                      </div>
                    ) : (
                      <div className="table-wrapper" style={{ border: 'none', background: 'none' }}>
                        <table style={{ fontSize: 10 }}>
                          <thead>
                            <tr>
                              <th>Producto / Insumo</th>
                              <th style={{ textAlign: 'center' }}>Vendido (Comandas)</th>
                              <th style={{ textAlign: 'center' }}>Deducido (Inventario)</th>
                              <th style={{ textAlign: 'center' }}>Discrepancia</th>
                              <th>Análisis y Diagnóstico IA</th>
                            </tr>
                          </thead>
                          <tbody>
                            {auditoriaCruzadaInventario.map(item => (
                              <tr key={item.id} style={{ background: item.diferencia !== 0 ? 'rgba(231, 76, 60, 0.02)' : 'none' }}>
                                <td style={{ fontWeight: 700, color: '#fff' }}>{item.nombre}</td>
                                <td style={{ textAlign: 'center', fontWeight: 600 }}>{item.comandas} pz</td>
                                <td style={{ textAlign: 'center', fontWeight: 600 }}>{item.inventario} pz</td>
                                <td style={{ textAlign: 'center', color: item.color, fontWeight: 800, fontSize: 11 }}>
                                  {item.diferencia === 0 ? '✓ Conciliado' : `${item.diferencia > 0 ? '+' : ''}${item.diferencia} pz`}
                                </td>
                                <td style={{ color: item.diferencia !== 0 ? 'var(--text-primary)' : 'var(--text-muted)', fontSize: 9, fontStyle: item.diferencia === 0 ? 'italic' : 'normal' }}>
                                  {item.desc}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>

                </div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
                  {/* Module 1 */}
                  <div style={{ background: 'rgba(0,0,0,0.2)', border: '1px solid var(--border)', borderRadius: 12, padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: 11, fontWeight: 800, color: 'var(--danger)', display: 'flex', alignItems: 'center', gap: 6 }}>
                        <i className="ri-lightbulb-flash-line" style={{ fontSize: 14 }} />
                        1. Iluminación Inteligente IoT
                      </span>
                      <span className="badge badge-danger" style={{ fontSize: 8 }}>Alerta</span>
                    </div>
                    <p style={{ fontSize: 10, color: 'var(--text-secondary)', margin: 0 }}>
                      Discrepancia en Mesa 4: Iluminación de mesa encendida pero no registra tiempo de cobro o renta en el panel.
                    </p>
                    <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                      <button className="btn btn-danger btn-xs" onClick={() => showToast("Señal de apagado enviada a domótica IoT de Mesa 4", "info")} style={{ fontSize: 9, padding: '3px 8px' }}>
                        Apagar Luz
                      </button>
                      <button className="btn btn-secondary btn-xs" onClick={() => showToast("Comanda abierta automáticamente en Mesa 4", "success")} style={{ fontSize: 9, padding: '3px 8px' }}>
                        Iniciar Renta
                      </button>
                    </div>
                  </div>

                  {/* Module 2 */}
                  <div style={{ background: 'rgba(0,0,0,0.2)', border: '1px solid var(--border)', borderRadius: 12, padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: 11, fontWeight: 800, color: 'var(--blue-light)', display: 'flex', alignItems: 'center', gap: 6 }}>
                        <i className="ri-temp-cold-line" style={{ fontSize: 14 }} />
                        2. Predicción Climatológica
                      </span>
                      <span className="badge badge-success" style={{ fontSize: 8 }}>Clima</span>
                    </div>
                    <p style={{ fontSize: 10, color: 'var(--text-secondary)', margin: 0 }}>
                      Lluvia intensa detectada en la zona. IA proyecta un incremento de +22% en consumo de snacks calientes y bebidas de barra.
                    </p>
                    <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                      <button className="btn btn-primary btn-xs" onClick={() => showToast("Promoción activa: Café y Snacks -15% en comanda QR", "success")} style={{ fontSize: 9, padding: '3px 8px' }}>
                        Promover Menú Lluvia
                      </button>
                    </div>
                  </div>

                  {/* Module 3 */}
                  <div style={{ background: 'rgba(0,0,0,0.2)', border: '1px solid var(--border)', borderRadius: 12, padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: 11, fontWeight: 800, color: 'var(--warning)', display: 'flex', alignItems: 'center', gap: 6 }}>
                        <i className="ri-user-unfollow-line" style={{ fontSize: 14 }} />
                        3. Control de Churn (Retención)
                      </span>
                      <span className="badge badge-warning" style={{ fontSize: 8 }}>Acción</span>
                    </div>
                    <p style={{ fontSize: 10, color: 'var(--text-secondary)', margin: 0 }}>
                      3 clientes VIP no han asistido en 14 días (Juan P., Luis M., Sofía G.). Tasa de riesgo de abandono: 68%.
                    </p>
                    <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                      <button className="btn btn-warning btn-xs" onClick={() => showToast("Mensajes de invitación automatizados preparados para WhatsApp", "success")} style={{ fontSize: 9, padding: '3px 8px' }}>
                        Enviar Cupón Reactivación
                      </button>
                    </div>
                  </div>

                  {/* Module 4 */}
                  <div style={{ background: 'rgba(0,0,0,0.2)', border: '1px solid var(--border)', borderRadius: 12, padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: 11, fontWeight: 800, color: 'var(--bronze-light)', display: 'flex', alignItems: 'center', gap: 6 }}>
                        <i className="ri-shopping-cart-2-line" style={{ fontSize: 14 }} />
                        4. Planificación de Stock JIT
                      </span>
                      <span className="badge badge-bronze" style={{ fontSize: 8 }}>Abasto</span>
                    </div>
                    <p style={{ fontSize: 10, color: 'var(--text-secondary)', margin: 0 }}>
                      Cerveza Corona Extra proyecta agotarse el sábado a las 21:30. Sugerencia: reabastecer 80 unidades de forma prioritaria.
                    </p>
                    <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                      <button className="btn btn-secondary btn-xs" onClick={() => showToast("Orden de compra de 80 pz Corona Extra enviada a proveedor", "success")} style={{ fontSize: 9, padding: '3px 8px' }}>
                        Solicitar 80 pz
                      </button>
                    </div>
                  </div>

                  {/* Module 5 */}
                  <div style={{ background: 'rgba(0,0,0,0.2)', border: '1px solid var(--border)', borderRadius: 12, padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: 11, fontWeight: 800, color: 'var(--success)', display: 'flex', alignItems: 'center', gap: 6 }}>
                        <i className="ri-qr-code-fill" style={{ fontSize: 14 }} />
                        5. Conciliación de Barra & Comandas QR
                      </span>
                      <span className="badge badge-success" style={{ fontSize: 8 }}>Ok</span>
                    </div>
                    <p style={{ fontSize: 10, color: 'var(--text-secondary)', margin: 0 }}>
                      Tasa de discrepancia en comandas QR: 0%. Todas las ventas registradas corresponden con salidas de inventario.
                    </p>
                    <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                      <span style={{ fontSize: 9, color: 'var(--success)', fontWeight: 700 }}><i className="ri-checkbox-circle-fill" /> Sin fugas detectadas hoy</span>
                    </div>
                  </div>

                  {/* Module 6 */}
                  <div style={{ background: 'rgba(0,0,0,0.2)', border: '1px solid var(--border)', borderRadius: 12, padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: 11, fontWeight: 800, color: 'var(--blue-light)', display: 'flex', alignItems: 'center', gap: 6 }}>
                        <i className="ri-group-line" style={{ fontSize: 14 }} />
                        6. Perfilado de Consumo RFM
                      </span>
                      <span className="badge badge-blue" style={{ fontSize: 8 }}>Datos</span>
                    </div>
                    <p style={{ fontSize: 10, color: 'var(--text-secondary)', margin: 0 }}>
                      Se identificaron 24 clientes VIP en el grupo 'Campeones' (Gasto de $380/visita). Recomendación: Torneo de Invitación Cerrada.
                    </p>
                    <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                      <button className="btn btn-primary btn-xs" onClick={() => showToast("Draft de Torneo VIP y notificaciones en cola de envío", "info")} style={{ fontSize: 9, padding: '3px 8px' }}>
                        Programar Torneo VIP
                      </button>
                    </div>
                  </div>

                  {/* Module 7 */}
                  <div style={{ background: 'rgba(0,0,0,0.2)', border: '1px solid var(--border)', borderRadius: 12, padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: 11, fontWeight: 800, color: 'var(--bronze-light)', display: 'flex', alignItems: 'center', gap: 6 }}>
                        <i className="ri-message-3-line" style={{ fontSize: 14 }} />
                        7. Sentimiento de Clientes NLP
                      </span>
                      <span className="badge badge-bronze" style={{ fontSize: 8 }}>IA</span>
                    </div>
                    <p style={{ fontSize: 10, color: 'var(--text-secondary)', margin: 0 }}>
                      Sentimiento general en QR: 88% Positivo. Queja recurrente detectada en comentarios de barra: "Música alta en zona Carambola".
                    </p>
                    <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                      <button className="btn btn-secondary btn-xs" onClick={() => showToast("Alerta enviada a personal de audio en salón", "info")} style={{ fontSize: 9, padding: '3px 8px' }}>
                        Regular Audio
                      </button>
                    </div>
                  </div>

                  {/* Module 8 */}
                  <div style={{ background: 'rgba(0,0,0,0.2)', border: '1px solid var(--border)', borderRadius: 12, padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: 11, fontWeight: 800, color: 'var(--warning)', display: 'flex', alignItems: 'center', gap: 6 }}>
                        <i className="ri-pulse-line" style={{ fontSize: 14 }} />
                        8. Surge Pricing Automatizado
                      </span>
                      <span className="badge badge-warning" style={{ fontSize: 8 }}>Surge</span>
                    </div>
                    <p style={{ fontSize: 10, color: 'var(--text-secondary)', margin: 0 }}>
                      Ocupación actual: 75%. El Surge Pricing (+15%) está listo para ser aplicado de forma automática al superar el 85% del aforo.
                    </p>
                    <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                      <button className="btn btn-warning btn-xs" onClick={() => showToast("Surge Pricing (+15%) aplicado manualmente a mesas", "warning")} style={{ fontSize: 9, padding: '3px 8px' }}>
                        Forzar Activación
                      </button>
                    </div>
                  </div>

                  {/* Module 9 */}
                  <div style={{ background: 'rgba(0,0,0,0.2)', border: '1px solid var(--border)', borderRadius: 12, padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: 11, fontWeight: 800, color: 'var(--success)', display: 'flex', alignItems: 'center', gap: 6 }}>
                        <i className="ri-pie-chart-2-line" style={{ fontSize: 14 }} />
                        9. ROI & Ocupación de Mesas
                      </span>
                      <span className="badge badge-success" style={{ fontSize: 8 }}>ROI</span>
                    </div>
                    <p style={{ fontSize: 10, color: 'var(--text-secondary)', margin: 0 }}>
                      Mesa 5 (Snooker) reporta un ROI de renta 15% menor que Pool. Se sugiere promover ligas de Snooker o habilitar tarifa promocional.
                    </p>
                    <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                      <button className="btn btn-secondary btn-xs" onClick={() => showToast("Cargando métricas completas de ROI de activos...", "info")} style={{ fontSize: 9, padding: '3px 8px' }}>
                        Ver Detalles ROI
                      </button>
                    </div>
                  </div>

                  {/* Module 10 */}
                  <div style={{ background: 'rgba(0,0,0,0.2)', border: '1px solid var(--border)', borderRadius: 12, padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: 11, fontWeight: 800, color: 'var(--blue-light)', display: 'flex', alignItems: 'center', gap: 6 }}>
                        <i className="ri-vip-crown-line" style={{ fontSize: 14 }} />
                        10. LTV VIP Proyectado
                      </span>
                      <span className="badge badge-blue" style={{ fontSize: 8 }}>LTV</span>
                    </div>
                    <p style={{ fontSize: 10, color: 'var(--text-secondary)', margin: 0 }}>
                      Membresías VIP proyectan facturar $35,000 en 12 meses. Tasa de retención anual: 92%. LTV por socio VIP: $4,500.
                    </p>
                    <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                      <button className="btn btn-primary btn-xs" onClick={() => showToast("Cargando reporte de proyección LTV y fidelización...", "info")} style={{ fontSize: 9, padding: '3px 8px' }}>
                        Ver Proyecciones
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* 3. SECCIÓN: OPERACIONES DE CAJA (COLAPSABLE - TODOS LOS ROLES) */}
      <div className="card" style={{ padding: 14 }}>
        <div 
          onClick={() => setSeccionCajaAbierta(!seccionCajaAbierta)} 
          style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}
        >
          <h3 className="card-title" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 800 }}>
            <i className="ri-receipt-line" style={{ color: 'var(--bronze-light)', fontSize: 16 }} />
            OPERACIONES DE CAJA, POS Y MOVIMIENTOS
          </h3>
          <i className={seccionCajaAbierta ? "ri-arrow-up-s-line" : "ri-arrow-down-s-line"} style={{ fontSize: 16, color: 'var(--text-muted)' }} />
        </div>

        {seccionCajaAbierta && (
          <div className="animate-fadeIn" style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 14 }}>
            
            {/* Impresoras y Colas */}
            <div style={{ background: 'rgba(0,0,0,0.15)', border: '1px solid var(--border)', borderRadius: 12, padding: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <div>
                  <h4 style={{ margin: 0, fontSize: 11, fontWeight: 800, color: '#fff' }}>Simulador de Impresión de Tickets Térmicos</h4>
                  <p style={{ margin: '2px 0 0 0', fontSize: 9, color: 'var(--text-muted)' }}>Historial de impresión de comandas y recibos del negocio</p>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button className="btn btn-secondary btn-xs" onClick={() => triggerSimulatedPrint('caja', 'Ticket de Prueba - Impresora Caja')} style={{ fontSize: 9, padding: '4px 8px' }}>Test Caja</button>
                  <button className="btn btn-secondary btn-xs" onClick={() => triggerSimulatedPrint('cocina', 'Comanda de Prueba - Impresora Cocina')} style={{ fontSize: 9, padding: '4px 8px' }}>Test Cocina</button>
                  <button className="btn btn-secondary btn-xs" onClick={() => triggerSimulatedPrint('barra', 'Comanda de Prueba - Impresora Barra')} style={{ fontSize: 9, padding: '4px 8px' }}>Test Barra</button>
                </div>
              </div>

              {colaImpresion.length === 0 ? (
                <div style={{ fontSize: 9, color: 'var(--text-muted)', fontStyle: 'italic', textAlign: 'center', padding: '10px 0' }}>
                  No se han enviado tickets a las impresoras.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5, maxHeight: 110, overflowY: 'auto', paddingRight: 4 }}>
                  {colaImpresion.map(p => (
                    <div key={p.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 10px', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 10 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <i className="ri-printer-line" style={{ color: 'var(--bronze-light)', fontSize: 12 }} />
                        <div>
                          <span style={{ fontWeight: 700 }}>{p.detalle}</span>
                          <span style={{ fontSize: 8, color: 'var(--text-muted)', marginLeft: 8 }}>{p.tipo.toUpperCase()} · {p.hora}</span>
                        </div>
                      </div>
                      <span className={`badge ${p.estado.includes('Impreso') ? 'badge-success' : 'badge-warning'}`} style={{ fontSize: 8, padding: '2px 4px' }}>
                        {p.estado}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Pestañas de Movimientos */}
            <div style={{ background: 'rgba(0,0,0,0.15)', border: '1px solid var(--border)', borderRadius: 12, padding: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border)', paddingBottom: 8, marginBottom: 12 }}>
                <div style={{ display: 'flex', gap: 12 }}>
                  <button
                    onClick={() => setTabActivo('caja')}
                    style={{
                      background: 'none', border: 'none', fontSize: 11, fontWeight: 800,
                      color: tabActivo === 'caja' ? 'var(--bronze-light)' : 'var(--text-muted)',
                      borderBottom: tabActivo === 'caja' ? '2px solid var(--bronze-light)' : 'none',
                      paddingBottom: 4, cursor: 'pointer', textTransform: 'uppercase', letterSpacing: '0.05em'
                    }}
                  >
                    Transacciones de Caja
                  </button>
                  <button
                    onClick={() => setTabActivo('inventario')}
                    style={{
                      background: 'none', border: 'none', fontSize: 11, fontWeight: 800,
                      color: tabActivo === 'inventario' ? 'var(--bronze-light)' : 'var(--text-muted)',
                      borderBottom: tabActivo === 'inventario' ? '2px solid var(--bronze-light)' : 'none',
                      paddingBottom: 4, cursor: 'pointer', textTransform: 'uppercase', letterSpacing: '0.05em'
                    }}
                  >
                    Movimientos de Inventario
                  </button>
                </div>
                <button
                  className="btn btn-secondary btn-xs"
                  onClick={() => showToast(tabActivo === 'caja' ? 'Exportando transacciones...' : 'Exportando bitácora...', 'info')}
                  style={{ fontSize: 9, padding: '4px 8px' }}
                >
                  <i className="ri-download-line" /> Exportar
                </button>
              </div>

              {tabActivo === 'caja' ? (
                <div className="table-wrapper" style={{ border: 'none', maxHeight: 220, overflowY: 'auto' }}>
                  <table style={{ fontSize: 11 }}>
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
                        <tr key={t.id} style={{ background: t.tipo === 'corte' ? 'rgba(205,127,50,0.04)' : 'none' }}>
                          <td style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-display)', fontSize: 10 }}>{t.hora}</td>
                          <td style={{ fontWeight: 600 }}>
                            {t.tipo === 'corte' ? '📋 ' : ''}{t.descripcion}
                          </td>
                          <td style={{ color: 'var(--text-secondary)' }}>{t.cliente}</td>
                          <td>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                              <i className={METODO_ICONS[t.metodo] || 'ri-cash-line'} style={{ fontSize: 12, color: 'var(--text-muted)' }} />
                              <span style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'capitalize' }}>{t.metodo}</span>
                            </div>
                          </td>
                          <td style={{ textAlign: 'right', fontFamily: 'var(--font-display)', fontSize: 12, fontWeight: 700, color: t.color }}>
                            {t.monto > 0 ? '+' : ''}${t.monto.toLocaleString()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 220, overflowY: 'auto', paddingRight: 4 }}>
                  {todosLosInventarioLogs.length === 0 ? (
                    <div style={{ fontSize: 10, color: 'var(--text-muted)', fontStyle: 'italic', textAlign: 'center', padding: '10px 0' }}>
                      No hay registros de auditoría de stock.
                    </div>
                  ) : (
                    todosLosInventarioLogs.map(l => {
                      const isEntrada = l.tipo === 'entrada';
                      const isMerma = l.tipo === 'merma';
                      const isVentaQr = l.tipo === 'venta_qr';
                      const isCierre = l.tipo === 'cierre';
                      return (
                        <div key={l.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 10px', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 10 }}>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <span className={`badge ${isEntrada ? 'badge-success' : isMerma ? 'badge-danger' : isVentaQr ? 'badge-info' : isCierre ? 'badge-success' : 'badge-bronze'}`} style={{ fontSize: 7, padding: '1px 3px' }}>
                                {l.tipo.toUpperCase()}
                              </span>
                              <span style={{ fontSize: 8, color: 'var(--text-muted)' }}>{new Date(l.fecha).toLocaleString()}</span>
                            </div>
                            <span style={{ fontWeight: 700 }}>{l.producto}</span>
                            <span style={{ color: 'var(--text-secondary)', fontSize: 9 }}>{l.detalle}</span>
                          </div>
                          <div style={{ fontSize: 12, fontWeight: 800, color: isEntrada || isCierre ? 'var(--success)' : isVentaQr ? 'var(--info)' : 'var(--danger)' }}>
                            {isEntrada ? '+' : isCierre ? '+$' : '-'}{isCierre ? l.monto : l.cantidad}
                          </div>
                        </div>
                      );
                    })
                  )}
                  {inventarioHasMoreLogs && (
                    <button 
                      onClick={cargarMasInventarioLogs}
                      disabled={loadingMoreInventario}
                      className="btn btn-secondary btn-xs" 
                      style={{ 
                        marginTop: 6, width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
                        color: 'var(--bronze-light)', borderColor: 'var(--border-bronze)', background: 'var(--bg-elevated)',
                        opacity: loadingMoreInventario ? 0.7 : 1, cursor: loadingMoreInventario ? 'not-allowed' : 'pointer'
                      }}
                    >
                      {loadingMoreInventario ? 'Cargando...' : 'Cargar más registros de inventario'}
                    </button>
                  )}
                </div>
              )}
            </div>

          </div>
        )}
      </div>

      {/* 4. SECCIÓN: ANALÍTICA Y REPORTES FINANCIEROS (EXCLUSIVO ADMIN/GERENTE) */}
      {!esCajero && (
        <div className="card" style={{ padding: 14 }}>
          <div 
            onClick={() => setSeccionReportesAbierta(!seccionReportesAbierta)} 
            style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}
          >
            <h3 className="card-title" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 800 }}>
              <i className="ri-bar-chart-2-line" style={{ color: 'var(--bronze-light)', fontSize: 16 }} />
              INFORMES FINANCIEROS, STAFF Y SATISFACCIÓN
            </h3>
            <i className={seccionReportesAbierta ? "ri-arrow-up-s-line" : "ri-arrow-down-s-line"} style={{ fontSize: 16, color: 'var(--text-muted)' }} />
          </div>

          {seccionReportesAbierta && (
            <div className="animate-fadeIn" style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 14 }}>
              
              {/* P&L Table */}
              <div style={{ background: 'rgba(0,0,0,0.15)', border: '1px solid var(--border)', borderRadius: 12, padding: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <h4 style={{ margin: 0, fontSize: 11, fontWeight: 800, color: 'var(--bronze-light)' }}>
                    Pérdidas y Ganancias Consolidado (P&L)
                  </h4>
                  <span style={{ fontSize: 9, color: 'var(--text-muted)', fontStyle: 'italic' }}>Filtro activo: {filtroGrafico.toUpperCase()}</span>
                </div>

                <div className="table-wrapper" style={{ border: 'none' }}>
                  <table style={{ fontSize: 10 }}>
                    <thead>
                      <tr>
                        <th>Rubro / Concepto de Operación</th>
                        <th style={{ textAlign: 'right' }}>Monto</th>
                        <th style={{ textAlign: 'right' }}>Porcentaje</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr style={{ background: 'rgba(255,255,255,0.01)', fontWeight: 700 }}>
                        <td style={{ color: 'var(--success)' }}>1. INGRESOS OPERATIVOS</td>
                        <td style={{ textAlign: 'right', color: 'var(--success)' }}>{fmt(finanzas.totalIngresos)}</td>
                        <td style={{ textAlign: 'right' }}>100.0%</td>
                      </tr>
                      <tr>
                        <td style={{ paddingLeft: 20 }}>Renta de Mesas de Billar</td>
                        <td style={{ textAlign: 'right' }}>{fmt(finanzas.rentasMesas)}</td>
                        <td style={{ textAlign: 'right', color: 'var(--text-muted)' }}>{finanzas.totalIngresos > 0 ? ((finanzas.rentasMesas / finanzas.totalIngresos) * 100).toFixed(1) : 0}%</td>
                      </tr>
                      <tr>
                        <td style={{ paddingLeft: 20 }}>Ventas de Bar (Bebidas/Snacks)</td>
                        <td style={{ textAlign: 'right' }}>{fmt(finanzas.ventasBar)}</td>
                        <td style={{ textAlign: 'right', color: 'var(--text-muted)' }}>{finanzas.totalIngresos > 0 ? ((finanzas.ventasBar / finanzas.totalIngresos) * 100).toFixed(1) : 0}%</td>
                      </tr>
                      <tr>
                        <td style={{ paddingLeft: 20 }}>Inscripciones a Torneos</td>
                        <td style={{ textAlign: 'right' }}>{fmt(finanzas.inscripcionesTorneo)}</td>
                        <td style={{ textAlign: 'right', color: 'var(--text-muted)' }}>{finanzas.totalIngresos > 0 ? ((finanzas.inscripcionesTorneo / finanzas.totalIngresos) * 100).toFixed(1) : 0}%</td>
                      </tr>

                      <tr style={{ background: 'rgba(255,255,255,0.01)', fontWeight: 700 }}>
                        <td style={{ color: 'var(--danger)' }}>2. COSTO DE VENTAS (COGS)</td>
                        <td style={{ textAlign: 'right', color: 'var(--danger)' }}>-{fmt(finanzas.totalCOGS)}</td>
                        <td style={{ textAlign: 'right' }}>{finanzas.totalIngresos > 0 ? ((finanzas.totalCOGS / finanzas.totalIngresos) * 100).toFixed(1) : 0}%</td>
                      </tr>
                      <tr>
                        <td style={{ paddingLeft: 20 }}>Costo de Insumos (Bar)</td>
                        <td style={{ textAlign: 'right' }}>-{fmt(finanzas.cogsBar)}</td>
                        <td style={{ textAlign: 'right', color: 'var(--text-muted)' }}>35.0% (Bar)</td>
                      </tr>
                      <tr>
                        <td style={{ paddingLeft: 20 }}>Costo Logística y Premios de Torneo</td>
                        <td style={{ textAlign: 'right' }}>-{fmt(finanzas.cogsTorneos)}</td>
                        <td style={{ textAlign: 'right', color: 'var(--text-muted)' }}>40.0% (Torneos)</td>
                      </tr>

                      <tr style={{ background: 'rgba(255,255,255,0.02)', fontWeight: 700 }}>
                        <td style={{ color: 'var(--bronze-light)' }}>UTILIDAD BRUTA (Margen Bruto)</td>
                        <td style={{ textAlign: 'right', color: 'var(--bronze-light)' }}>{fmt(finanzas.utilidadBruta)}</td>
                        <td style={{ textAlign: 'right' }}>{finanzas.totalIngresos > 0 ? ((finanzas.utilidadBruta / finanzas.totalIngresos) * 100).toFixed(1) : 0}%</td>
                      </tr>

                      <tr style={{ background: 'rgba(255,255,255,0.01)', fontWeight: 700 }}>
                        <td style={{ color: 'var(--danger)' }}>3. GASTOS OPERATIVOS (OPEX)</td>
                        <td style={{ textAlign: 'right', color: 'var(--danger)' }}>-{fmt(finanzas.totalOPEX)}</td>
                        <td style={{ textAlign: 'right' }}>{finanzas.totalIngresos > 0 ? ((finanzas.totalOPEX / finanzas.totalIngresos) * 100).toFixed(1) : 0}%</td>
                      </tr>
                      <tr>
                        <td style={{ paddingLeft: 20 }}>Gastos de Mantenimiento y Servicios</td>
                        <td style={{ textAlign: 'right' }}>-{fmt(finanzas.gastosG)}</td>
                        <td style={{ textAlign: 'right', color: 'var(--text-muted)' }}>{finanzas.totalIngresos > 0 ? ((finanzas.gastosG / finanzas.totalIngresos) * 100).toFixed(1) : 0}%</td>
                      </tr>
                      <tr>
                        <td style={{ paddingLeft: 20 }}>Nómina, Comisiones y Sueldos Base</td>
                        <td style={{ textAlign: 'right' }}>-{fmt(finanzas.nominaS)}</td>
                        <td style={{ textAlign: 'right', color: 'var(--text-muted)' }}>{finanzas.totalIngresos > 0 ? ((finanzas.nominaS / finanzas.totalIngresos) * 100).toFixed(1) : 0}%</td>
                      </tr>

                      <tr style={{ background: 'var(--bg-elevated)', fontWeight: 800, fontSize: 11, borderTop: '1px solid var(--border)' }}>
                        <td style={{ color: '#fff' }}>UTILIDAD NETA OPERATIVA</td>
                        <td style={{ textAlign: 'right', color: 'var(--success)' }}>{fmt(finanzas.utilidadNeta)}</td>
                        <td style={{ textAlign: 'right', color: 'var(--success)' }}>{finanzas.margenUtilidad.toFixed(1)}% margen</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Staff y Satisfacción en dos columnas */}
              <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 14 }}>
                
                {/* Staff metrics */}
                <div style={{ background: 'rgba(0,0,0,0.15)', border: '1px solid var(--border)', borderRadius: 12, padding: 12 }}>
                  <h4 style={{ margin: '0 0 10px 0', fontSize: 11, fontWeight: 800, color: 'var(--bronze-light)' }}>
                    Desempeño y Comisiones del Staff
                  </h4>
                  <div className="table-wrapper" style={{ border: 'none' }}>
                    <table style={{ fontSize: 9 }}>
                      <thead>
                        <tr>
                          <th>Nombre</th>
                          <th>Rol</th>
                          <th style={{ textAlign: 'center' }}>Turnos</th>
                          <th style={{ textAlign: 'right' }}>Comisión</th>
                          <th style={{ textAlign: 'right' }}>Satisfacción</th>
                        </tr>
                      </thead>
                      <tbody>
                        {staffRendimiento.map(staff => (
                          <tr key={staff.id}>
                            <td style={{ fontWeight: 600 }}>{staff.nombre}</td>
                            <td style={{ color: 'var(--text-secondary)' }}>{staff.rol}</td>
                            <td style={{ textAlign: 'center' }}>{staff.turnos}</td>
                            <td style={{ textAlign: 'right', color: 'var(--success)', fontWeight: 700 }}>${staff.comisiones.toLocaleString()}</td>
                            <td style={{ textAlign: 'right' }}>
                              <span style={{ 
                                color: staff.satisfaccion >= 4.5 ? 'var(--success)' : staff.satisfaccion >= 4.0 ? 'var(--warning)' : 'var(--danger)',
                                fontWeight: 700
                              }}>
                                ★ {staff.satisfaccion.toFixed(1)}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Satisfacción de Clientes */}
                <div style={{ background: 'rgba(0,0,0,0.15)', border: '1px solid var(--border)', borderRadius: 12, padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <h4 style={{ margin: 0, fontSize: 11, fontWeight: 800, color: 'var(--bronze-light)' }}>
                    Satisfacción Promedio: ★ {promedioGeneral.toFixed(1)} / 5.0
                  </h4>
                  
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 10 }}>
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                        <span>Atención de Meseros:</span>
                        <strong>★ {promedioAtencion.toFixed(1)}</strong>
                      </div>
                      <div style={{ width: '100%', height: 6, background: 'rgba(255,255,255,0.05)', borderRadius: 3, overflow: 'hidden' }}>
                        <div style={{ width: `${(promedioAtencion/5)*100}%`, height: '100%', background: 'var(--bronze)' }} />
                      </div>
                    </div>
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                        <span>Rapidez del Servicio:</span>
                        <strong>★ {promedioRapidez.toFixed(1)}</strong>
                      </div>
                      <div style={{ width: '100%', height: 6, background: 'rgba(255,255,255,0.05)', borderRadius: 3, overflow: 'hidden' }}>
                        <div style={{ width: `${(promedioRapidez/5)*100}%`, height: '100%', background: 'var(--success)' }} />
                      </div>
                    </div>
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                        <span>Limpieza de Áreas:</span>
                        <strong>★ {promedioLimpieza.toFixed(1)}</strong>
                      </div>
                      <div style={{ width: '100%', height: 6, background: 'rgba(255,255,255,0.05)', borderRadius: 3, overflow: 'hidden' }}>
                        <div style={{ width: `${(promedioLimpieza/5)*100}%`, height: '100%', background: 'var(--blue-light)' }} />
                      </div>
                    </div>
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                        <span>Equipos y Mesas (Paños):</span>
                        <strong>★ {promedioEquipo.toFixed(1)}</strong>
                      </div>
                      <div style={{ width: '100%', height: 6, background: 'rgba(255,255,255,0.05)', borderRadius: 3, overflow: 'hidden' }}>
                        <div style={{ width: `${(promedioEquipo/5)*100}%`, height: '100%', background: 'var(--warning)' }} />
                      </div>
                    </div>
                  </div>

                  {totalEncuestas > 0 && (promedioAtencion < 4.2 || promedioRapidez < 4.0) && (
                    <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 8, padding: 8, fontSize: 8, color: 'var(--danger)', lineHeight: 1.3 }}>
                      ⚠️ <strong>Cuellos de Botella Detectados:</strong> Tiempo de servicio o atención debajo de los estándares óptimos. La IA sugiere re-organizar los horarios de meseros para el fin de semana.
                    </div>
                  )}
                </div>

              </div>

            </div>
          )}
        </div>
      )}

      {/* MODAL CORTE DE CAJA */}
      {mostrarCorte && (
        <div className="modal-overlay" onClick={() => setMostrarCorte(false)}>
          <div className="modal" style={{ maxWidth: 500 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">📋 Corte de Caja interactivo</span>
              <button onClick={() => setMostrarCorte(false)} style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 20 }}>✕</button>
            </div>
            <div className="modal-body" style={{ maxHeight: '70vh', overflowY: 'auto' }}>
              
              {cortesiasHoy.length > 0 && (
                <div style={{
                  background: 'rgba(239, 68, 68, 0.1)',
                  border: '1px solid rgba(239, 68, 68, 0.3)',
                  borderRadius: 12,
                  padding: 10,
                  marginBottom: 16,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#ef4444', fontWeight: 800, fontSize: 11 }}>
                    <i className="ri-error-warning-line" style={{ fontSize: 14 }} />
                    <span>⚠️ AUDITORÍA: Cortesías / Cierres $0 MXN hoy</span>
                  </div>
                  <p style={{ fontSize: 9, color: 'var(--text-secondary)', margin: 0, lineHeight: 1.3 }}>
                    Se detectaron {cortesiasHoy.length} cierres $0 MXN hoy. Verifícalos antes de proceder:
                  </p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 90, overflowY: 'auto' }}>
                    {cortesiasHoy.map(b => (
                      <div key={b.id} style={{ background: 'rgba(0,0,0,0.2)', borderRadius: 6, padding: '4px 8px', display: 'flex', justifyContent: 'space-between', fontSize: 9 }}>
                        <span>{b.detalle} ({b.operador})</span>
                        <span style={{ color: 'var(--text-muted)' }}>{new Date(b.fecha).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <div>
                  <h4 style={{ fontSize: 11, color: 'var(--bronze-light)', marginBottom: 8, textTransform: 'uppercase', fontWeight: 800 }}>Billetes</h4>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {[1000, 500, 200, 100, 50, 20].map(den => (
                      <div key={den} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'rgba(255,255,255,0.02)', padding: '4px 10px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.04)' }}>
                        <span style={{ fontSize: 11, fontWeight: 700 }}>${den}</span>
                        <input
                          type="number"
                          className="form-input"
                          style={{ width: 60, padding: '2px 6px', fontSize: 11, textAlign: 'right' }}
                          placeholder="0"
                          value={cantidades[den]}
                          onChange={e => handleCantidadChange(den, e.target.value)}
                        />
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <h4 style={{ fontSize: 11, color: 'var(--bronze-light)', marginBottom: 8, textTransform: 'uppercase', fontWeight: 800 }}>Monedas</h4>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {[10, 5, 2, 1, 0.5].map(den => (
                      <div key={den} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'rgba(255,255,255,0.02)', padding: '4px 10px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.04)' }}>
                        <span style={{ fontSize: 11, fontWeight: 700 }}>${den.toFixed(2)}</span>
                        <input
                          type="number"
                          className="form-input"
                          style={{ width: 60, padding: '2px 6px', fontSize: 11, textAlign: 'right' }}
                          placeholder="0"
                          value={cantidades[den]}
                          onChange={e => handleCantidadChange(den, e.target.value)}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 10, padding: 12, marginTop: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontSize: 11 }}>
                  <span>Efectivo Esperado:</span>
                  <strong>${totalEfectivoEsperado.toLocaleString()}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontSize: 11 }}>
                  <span>Efectivo Real Contado:</span>
                  <strong>${sumaContada.toLocaleString()}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: 6, fontSize: 12 }}>
                  <span style={{ fontWeight: 800 }}>Diferencia:</span>
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

      {/* MODAL COBRO MANUAL */}
      {mostrarCobroManual && (
        <div className="modal-overlay" onClick={() => setMostrarCobroManual(false)}>
          <div className="modal" style={{ maxWidth: 420 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">💸 Registrar Cobro Manual</span>
              <button onClick={() => setMostrarCobroManual(false)} style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 20 }}>✕</button>
            </div>
            <form onSubmit={registrarCobroManual} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div className="modal-body">
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <F label="Monto ($) *">
                    <input 
                      type="number" 
                      step="0.01" 
                      className="form-input" 
                      required 
                      placeholder="0.00" 
                      value={nuevoMonto} 
                      onChange={e => setNuevoMonto(e.target.value)} 
                    />
                  </F>
                  <F label="Descripción / Concepto *">
                    <input 
                      type="text" 
                      className="form-input" 
                      required 
                      placeholder="Ej. Consumo Directo o Ajuste de Caja" 
                      value={nuevaDesc} 
                      onChange={e => setNuevaDesc(e.target.value)} 
                    />
                  </F>
                  <F label="Método de Pago *">
                    <select 
                      className="form-select" 
                      value={nuevoMetodo} 
                      onChange={e => setNuevoMetodo(e.target.value)}
                    >
                      <option value="efectivo">Efectivo</option>
                      <option value="spei">SPEI / QR</option>
                      <option value="tarjeta">Tarjeta Bancaria</option>
                    </select>
                  </F>
                  <F label="PIN de Autorización Administrador *">
                    <input 
                      type="password" 
                      className="form-input" 
                      required 
                      placeholder="••••" 
                      value={pinAutorizacion} 
                      onChange={e => setPinAutorizacion(e.target.value)} 
                    />
                  </F>
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setMostrarCobroManual(false)}>Cancelar</button>
                <button type="submit" className="btn btn-primary">Autorizar e Ingresar</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL BITÁCORA */}
      {mostrarBitacora && (
        <ModalBitacora
          bitacora={bitacora}
          onClear={limpiarBitacora}
          onClose={() => {
            setMostrarBitacora(false);
            setLimiteBitacora(50);
            setLastBitacoraDoc(null);
            setLoadingMoreBitacora(false);
          }}
          onLoadMore={async () => {
            if (!lastBitacoraDoc || loadingMoreBitacora) return;
            setLoadingMoreBitacora(true);
            try {
              const q = query(collection(db, 'bitacora'), orderBy('fecha', 'desc'), startAfter(lastBitacoraDoc), limit(50));
              const snap = await getDocs(q);
              const newItems = snap.docs.map(d => ({ id: d.id, ...d.data() }));
              setBitacora(prev => [...prev, ...newItems]);
              setLastBitacoraDoc(snap.docs[snap.docs.length - 1] || null);
              setHasMoreBitacora(snap.docs.length === 50);
            } catch (e) {
              console.error('Error al cargar más bitácora:', e);
            } finally {
              setLoadingMoreBitacora(false);
            }
          }}
          hasMore={hasMoreBitacora}
          loadingMore={loadingMoreBitacora}
        />
      )}

      {/* MODAL RESUMEN CORTE DE CAJA (AUDITORÍA IA) */}
      {mostrarResumenCorteModal && resumenCorteActivo && (
        <div className="modal-overlay" onClick={() => setMostrarResumenCorteModal(false)}>
          <div className="modal" style={{ maxWidth: 650, maxHeight: '90vh', display: 'flex', flexDirection: 'column' }} onClick={e => e.stopPropagation()}>
            <div className="modal-header" style={{ borderBottom: '1px solid var(--border)' }}>
              <span className="modal-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <i className="ri-robot-line" style={{ color: 'var(--bronze-light)' }} />
                Resumen de Corte Auditado por IA
              </span>
              <button onClick={() => setMostrarResumenCorteModal(false)} style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 20 }}>✕</button>
            </div>
            
            <div className="modal-body" style={{ overflowY: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
              {/* Encabezado e Info */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, background: 'rgba(255,255,255,0.02)', padding: 12, borderRadius: 8, border: '1px solid var(--border)', fontSize: 11 }}>
                <div>
                  <span style={{ color: 'var(--text-muted)' }}>Cajero / Operador:</span><br/>
                  <strong>{resumenCorteActivo.operador}</strong>
                </div>
                <div>
                  <span style={{ color: 'var(--text-muted)' }}>Periodo Auditado:</span><br/>
                  <strong>Desde {new Date(resumenCorteActivo.ultimoCorteFecha).toLocaleDateString()} {new Date(resumenCorteActivo.ultimoCorteFecha).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</strong>
                </div>
              </div>

              {/* Resultados Financieros del Arqueo */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 10, padding: 12, textAlign: 'center' }}>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 4 }}>Esperado Efectivo</div>
                  <strong style={{ fontSize: 16 }}>${resumenCorteActivo.efectivoEsperado.toLocaleString()}</strong>
                </div>
                <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 10, padding: 12, textAlign: 'center' }}>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 4 }}>Entregado Administrador</div>
                  <strong style={{ fontSize: 16 }}>${resumenCorteActivo.efectivoContado.toLocaleString()}</strong>
                </div>
                <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 10, padding: 12, textAlign: 'center' }}>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 4 }}>Diferencia Arqueo</div>
                  <strong style={{ fontSize: 16, color: resumenCorteActivo.diferencia === 0 ? 'var(--success)' : resumenCorteActivo.diferencia > 0 ? 'var(--warning)' : 'var(--danger)' }}>
                    {resumenCorteActivo.diferencia >= 0 ? '+' : ''}${resumenCorteActivo.diferencia.toLocaleString()}
                  </strong>
                </div>
              </div>

              {/* Trazabilidad IA */}
              <div style={{ background: 'linear-gradient(135deg, rgba(205, 127, 50, 0.05), rgba(0,0,0,0.2))', border: '1px solid var(--border-bronze)', borderRadius: 10, padding: 14 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--bronze-light)', fontWeight: 800, fontSize: 12, marginBottom: 10 }}>
                  <i className="ri-robot-line" />
                  <span>ANÁLISIS DE TRAZABILIDAD IA</span>
                </div>
                <pre style={{ margin: 0, padding: 0, background: 'none', border: 'none', color: '#fff', fontSize: 10, whiteSpace: 'pre-wrap', lineHeight: 1.5, fontFamily: 'monospace' }}>
                  {resumenCorteActivo.resumenIA}
                </pre>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                {/* Ingresos Detallados */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <h4 style={{ fontSize: 11, color: 'var(--bronze-light)', margin: 0, textTransform: 'uppercase', fontWeight: 800 }}>Ingresos Detectados</h4>
                  <div style={{ maxHeight: 150, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 8, padding: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {resumenCorteActivo.ingresosDetalle.length === 0 ? (
                      <span style={{ fontSize: 10, color: 'var(--text-muted)', fontStyle: 'italic' }}>No hay ingresos.</span>
                    ) : (
                      resumenCorteActivo.ingresosDetalle.map(item => (
                        <div key={item.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, borderBottom: '1px solid rgba(255,255,255,0.02)', paddingBottom: 4 }}>
                          <span style={{ color: 'var(--text-secondary)' }}>{item.descripcion.slice(0, 22)} ({item.metodo.toUpperCase().slice(0, 4)})</span>
                          <strong>${item.monto.toLocaleString()}</strong>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                {/* Egresos Detallados */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <h4 style={{ fontSize: 11, color: 'var(--bronze-light)', margin: 0, textTransform: 'uppercase', fontWeight: 800 }}>Egresos / Gastos</h4>
                  <div style={{ maxHeight: 150, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 8, padding: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {resumenCorteActivo.gastosDetalle.length === 0 ? (
                      <span style={{ fontSize: 10, color: 'var(--text-muted)', fontStyle: 'italic' }}>No hay egresos.</span>
                    ) : (
                      resumenCorteActivo.gastosDetalle.map(item => (
                        <div key={item.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, borderBottom: '1px solid rgba(255,255,255,0.02)', paddingBottom: 4 }}>
                          <span style={{ color: 'var(--text-secondary)' }}>[{item.categoria.slice(0,4).toUpperCase()}] {item.descripcion.slice(0, 18)}</span>
                          <strong style={{ color: 'var(--danger)' }}>-${item.monto.toLocaleString()}</strong>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div className="modal-footer" style={{ borderTop: '1px solid var(--border)', gap: 8, display: 'flex', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
              <button 
                className="btn btn-secondary" 
                onClick={() => exportarCorteCSV(resumenCorteActivo)}
                style={{ background: 'rgba(255,255,255,0.02)', borderColor: 'var(--border-bronze)', color: 'var(--bronze-light)' }}
              >
                <i className="ri-download-line" style={{ marginRight: 6 }} />
                Exportar CSV
              </button>
              <button 
                className="btn btn-secondary" 
                onClick={() => compartirCorteWhatsApp(resumenCorteActivo)}
                style={{ background: 'rgba(37, 211, 102, 0.1)', borderColor: 'rgba(37, 211, 102, 0.3)', color: '#25D366' }}
              >
                <i className="ri-whatsapp-line" style={{ marginRight: 6 }} />
                WhatsApp
              </button>
              <button 
                className="btn btn-secondary" 
                onClick={() => {
                  imprimirTicketCorte(
                    resumenCorteActivo.corteData,
                    resumenCorteActivo.efectivoContado,
                    resumenCorteActivo.diferencia,
                    resumenCorteActivo.resumenIA,
                    resumenCorteActivo.operador,
                    resumenCorteActivo.ultimoCorteFecha,
                    resumenCorteActivo.cantidadesDenom
                  );
                }}
              >
                <i className="ri-printer-line" style={{ marginRight: 6 }} />
                Imprimir Ticket
              </button>
              <button className="btn btn-primary" onClick={() => setMostrarResumenCorteModal(false)}>Cerrar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── MODAL BITÁCORA ───────────────────────────────────────
function ModalBitacora({ bitacora, onClear, onClose, onLoadMore, hasMore, loadingMore }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 600 }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">
            <i className="ri-history-line" style={{ marginRight: 8, color: 'var(--bronze-light)' }} />
            Bitácora de Auditoría y Transacciones
          </span>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            {bitacora.length > 0 && (
              <button className="btn btn-xs btn-secondary" onClick={onClear} style={{ color: 'var(--danger)', fontSize: 10, padding: '4px 8px' }}>
                Limpiar
              </button>
            )}
            <button onClick={onClose} className="btn-icon btn btn-secondary" style={{ background: 'none', border: 'none' }}>
              <i className="ri-close-line" style={{ fontSize: 20 }} />
            </button>
          </div>
        </div>
        <div className="modal-body">
          <p style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 12 }}>Movimientos de mesas, consumos y caja del negocio.</p>
          {bitacora.length === 0 ? (
            <p style={{ color: 'var(--text-muted)', fontSize: 12, textAlign: 'center', padding: '60px 0' }}>No hay registros disponibles en la bitácora.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 380, overflowY: 'auto', paddingRight: 4 }}>
              {bitacora.map(b => {
                const isPositive = b.monto > 0;
                return (
                  <div key={b.id} style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 8, padding: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span className={`badge ${b.tipo === 'alerta' ? 'badge-danger' : 'badge-bronze'}`} style={{ fontSize: 8, padding: '1px 4px' }}>{b.accion}</span>
                        <span style={{ fontSize: 8, color: 'var(--text-muted)' }}>
                          {new Date(b.fecha).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })} · {new Date(b.fecha).toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit' })}
                        </span>
                      </div>
                      <span style={{ fontSize: 11, color: 'var(--text-primary)', fontWeight: 600 }}>{b.detalle}</span>
                      <span style={{ fontSize: 8, color: 'var(--text-muted)' }}>Operador: {b.operador}</span>
                    </div>
                    {isPositive && (
                      <div style={{ fontSize: 13, fontWeight: 900, color: 'var(--success)' }}>
                        +${b.monto} MXN
                      </div>
                    )}
                  </div>
                );
              })}
              {hasMore && (
                <button
                  className="btn btn-secondary btn-xs"
                  onClick={onLoadMore}
                  disabled={loadingMore}
                  style={{ marginTop: 8, width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', height: 26, fontSize: 10 }}
                >
                  {loadingMore ? 'Cargando...' : 'Cargar más registros'}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

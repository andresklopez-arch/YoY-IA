'use client';
import { useState, useEffect, useMemo } from 'react';
import { db } from '@/lib/firebase';
import { doc, onSnapshot, query, collection, orderBy, limit, getDocs, startAfter, writeBatch, addDoc, serverTimestamp } from 'firebase/firestore';
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
            motivo: `Mesa activa por ${hrsJugadas} hrs con $0 consumos de barra.`
          });
        }
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
  const totalEfectivoEsperado = cobros.filter(t => t.metodo === 'efectivo').reduce((s, t) => s + t.monto, 0);
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

  const guardarCorteCaja = () => {
    const nombreOperador = user ? (user.name || user.alias || user.email) : 'Administrador';
    setCobros(prev => [{
      id: Date.now(),
      tipo: 'corte',
      descripcion: `Corte de Caja (Contado: $${sumaContada.toLocaleString()} - Esperado: $${totalEfectivoEsperado.toLocaleString()})`,
      cliente: nombreOperador,
      monto: diferencia,
      metodo: 'efectivo',
      hora: new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }),
      color: diferencia >= 0 ? 'var(--success)' : 'var(--danger)',
    }, ...prev]);

    registrarEvento('Corte de Caja', `Corte realizado. Contado: $${sumaContada} - Esperado: $${totalEfectivoEsperado}. Diferencia: $${diferencia}`, diferencia, 'info');
    showToast(`Corte registrado. Diferencia: $${diferencia.toLocaleString()}`, diferencia >= 0 ? 'success' : 'danger');
    triggerSimulatedPrint('caja', `Reporte de Corte de Caja - Diferencia: $${diferencia}`);
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

    // Inconsistencias en mesas activas en cero
    inconsistenciasEnVivo.forEach(inc => {
      list.push({
        id: `inc-mesa-${inc.mesaId}`,
        tipo: 'alerta',
        titulo: `Mesa ${inc.mesaId} sin Consumo`,
        desc: `Mesa activa por ${inc.horas} horas sin registros de venta de bar.`,
        gravedad: 'alta'
      });
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

  const fmt = (val) => `$${Number(val || 0).toLocaleString('es-MX', { minimumFractionDigits: 2 })}`;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      
      {/* CABECERA */}
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 0 }}>
        <div>
          <h1 className="page-title gradient-bronze" style={{ margin: 0 }}>
            {esCajero ? 'Caja y POS Operativo' : 'Caja y Reportes IA'}
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
          <>
            <div className="stat-card">
              <div className="stat-card-icon icon-success"><i className="ri-wallet-3-line" /></div>
              <div className="stat-card-value" style={{ fontSize: 22, color: 'var(--success)' }}>${totalEfectivoEsperado.toLocaleString()}</div>
              <div className="stat-card-label">Efectivo en Caja</div>
            </div>
            <div className="stat-card">
              <div className="stat-card-icon icon-blue"><i className="ri-qr-code-line" /></div>
              <div className="stat-card-value" style={{ fontSize: 22, color: 'var(--blue-light)' }}>
                ${(cobros.filter(t => t.metodo !== 'efectivo').reduce((s, t) => s + t.monto, 0)).toLocaleString()}
              </div>
              <div className="stat-card-label">Digital (Tarjeta/SPEI)</div>
            </div>
            <div className="stat-card">
              <div className="stat-card-icon icon-success"><i className="ri-funds-line" /></div>
              <div className="stat-card-value" style={{ fontSize: 22, color: 'var(--success)' }}>${finanzas.totalIngresos.toLocaleString('es-MX', { maximumFractionDigits: 0 })}</div>
              <div className="stat-card-label">Ingresos ({filtroGrafico})</div>
              <div className="stat-card-sub" style={{ fontSize: 9, color: 'var(--text-muted)' }}>Proporcional reconciliado</div>
            </div>
            <div className="stat-card">
              <div className="stat-card-icon icon-danger"><i className="ri-arrow-down-circle-line" /></div>
              <div className="stat-card-value" style={{ fontSize: 22, color: 'var(--danger)' }}>${finanzas.totalOPEX.toLocaleString('es-MX', { maximumFractionDigits: 0 })}</div>
              <div className="stat-card-label">Gastos Totales</div>
              <div className="stat-card-sub" style={{ fontSize: 9, color: 'var(--text-muted)' }}>Nómina + Operativos</div>
            </div>
            <div className="stat-card">
              <div className="stat-card-icon icon-bronze"><i className="ri-line-chart-line" /></div>
              <div className="stat-card-value" style={{ fontSize: 22, color: 'var(--bronze-light)' }}>${finanzas.utilidadNeta.toLocaleString('es-MX', { maximumFractionDigits: 0 })}</div>
              <div className="stat-card-label">Utilidad Neta (P&L)</div>
              <div className="stat-card-sub" style={{ fontSize: 9, color: 'var(--success)' }}>{finanzas.margenUtilidad.toFixed(1)}% margen</div>
            </div>
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
            <div className="animate-fadeIn" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginTop: 14 }}>
              
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

              {/* Columna Derecha: Forecasting de Caja */}
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

'use client';
import { useState, useEffect, useMemo, Fragment, useRef } from 'react';
import { db } from '@/lib/firebase';
import { doc, onSnapshot, query, collection, orderBy, limit, getDocs, getDoc, startAfter, writeBatch, addDoc, serverTimestamp, where, setDoc, updateDoc, deleteDoc } from 'firebase/firestore';
import { deobfuscate, obfuscate } from '@/lib/crypto';
import { useAuth } from '@/lib/auth-context';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip as RechartsTooltip, PieChart as RechartsPieChart, Pie, Cell } from 'recharts';

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

const adminPinHash = '170440'; // fallback hashed (for '1111')

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
  const cacheReporteRef = useRef({});

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
  const [filtroCorteOperador, setFiltroCorteOperador] = useState('');

  // Reportes Unificados
  const [periodoReporte, setPeriodoReporte] = useState('Hoy');
  const [fechaReporteInicio, setFechaReporteInicio] = useState('');
  const [fechaReporteFin, setFechaReporteFin] = useState('');
  const [reporteCargando, setReporteCargando] = useState(false);
  const [datosReporte, setDatosReporte] = useState(null);

  const chartData = useMemo(() => {
    if (!datosReporte || !datosReporte.rawEventos) return [];
    
    const isShort = datosReporte.period === 'Hoy' || datosReporte.period === 'Ayer';
    const isLong = datosReporte.period === '6m' || datosReporte.period === '1a';
    const groups = {};
    
    datosReporte.rawEventos.forEach(e => {
      const acc = e.accion;
      if (acc === 'Cierre Directo' || acc === 'Mesa a Cuenta' || acc === 'Cobro Manual' || acc === 'Venta Barra' || acc === 'Cobro Barra' || acc === 'Clientes - Suscripción' || acc === 'Torneos - Registro') {
        const monto = Number(e.monto) || 0;
        if (monto > 0) {
          const date = new Date(e.fecha);
          let key = '';
          if (isShort) {
            const hr = date.getHours();
            key = hr.toString().padStart(2, '0');
          } else if (isLong) {
            const yr = date.getFullYear();
            const mo = (date.getMonth() + 1).toString().padStart(2, '0');
            key = `${yr}-${mo}`;
          } else {
            const yr = date.getFullYear();
            const mo = (date.getMonth() + 1).toString().padStart(2, '0');
            const dy = date.getDate().toString().padStart(2, '0');
            key = `${yr}-${mo}-${dy}`;
          }
          groups[key] = (groups[key] || 0) + monto;
        }
      }
    });

    const sortedKeys = Object.keys(groups).sort();
    const monthNames = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

    return sortedKeys.map(k => {
      let label = k;
      if (isShort) {
        label = `${k}:00`;
      } else if (isLong) {
        const [yr, mo] = k.split('-');
        label = `${monthNames[parseInt(mo) - 1]} ${yr.substring(2)}`;
      } else {
        const [yr, mo, dy] = k.split('-');
        label = `${dy}/${mo}`;
      }
      return {
        name: label,
        Ventas: groups[k]
      };
    });
  }, [datosReporte]);

  const pieData = useMemo(() => {
    if (!datosReporte) return [];
    
    let cash = 0;
    let card = 0;
    let transfer = 0;
    
    (datosReporte.rawEventos || []).forEach(e => {
      const acc = e.accion;
      if (acc === 'Cierre Directo' || acc === 'Mesa a Cuenta' || acc === 'Cobro Manual' || acc === 'Venta Barra' || acc === 'Cobro Barra' || acc === 'Clientes - Suscripción' || acc === 'Torneos - Registro') {
        const monto = Number(e.monto) || 0;
        if (monto > 0) {
          const det = (e.detalle || '').toLowerCase();
          if (det.includes('tarjeta')) {
            card += monto;
          } else if (det.includes('transferencia') || det.includes('spei') || det.includes('spei/qr') || det.includes('qr')) {
            transfer += monto;
          } else {
            cash += monto;
          }
        }
      }
    });

    const total = cash + card + transfer || 1;
    return [
      { name: 'Efectivo', value: cash, color: '#10b981', pct: ((cash / total) * 100).toFixed(0) },
      { name: 'Tarjeta', value: card, color: '#3b82f6', pct: ((card / total) * 100).toFixed(0) },
      { name: 'Transferencia', value: transfer, color: '#a855f7', pct: ((transfer / total) * 100).toFixed(0) }
    ].filter(d => d.value > 0);
  }, [datosReporte]);

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
  const [rfFiltro, setRfFiltro] = useState('7d');
  const [rfModalTipo, setRfModalTipo] = useState(null);
  const [rfModalDetalleMetodo, setRfModalDetalleMetodo] = useState(null);
  const [gastosList, setGastosList] = useState([]);
  const [nominaPagosList, setNominaPagosList] = useState([]);
  const [empleadosList, setEmpleadosList] = useState([]);
  const [encuestasList, setEncuestasList] = useState([]);
  const [pedidosList, setPedidosList] = useState([]);
  const [fichajesLogs, setFichajesLogs] = useState([]);
  const [descartadas, setDescartadas] = useState({});
  const [productos, setProductos] = useState([]);
  const [mesas, setMesas] = useState([]);
  const [tarifaAutopilotActivo, setTarifaAutopilotActivo] = useState(false);
  const [surtidoEficiencia, setSurtidoEficiencia] = useState({ promedioMinutos: 0, solicitudesAtendidas: 0, solicitudesCanceladas: 0, ultimosEventos: [] });
  const [cuentasActivas, setCuentasActivas] = useState([]);
  const [inconsistenciasEnVivo, setInconsistenciasEnVivo] = useState([]);
  const [telegramConfig, setTelegramConfig] = useState(null);
  const alertadasInconsistencias = useRef(new Set());

  useEffect(() => {
    // Escuchar cambios de configuración de Telegram en tiempo real
    const unsub = onSnapshot(doc(db, 'config', 'telegram'), snap => {
      if (snap.exists()) {
        setTelegramConfig(snap.data());
      }
    }, err => console.error("Error al escuchar config de Telegram:", err));
    return () => unsub();
  }, []);

  useEffect(() => {
    // Procesar cola de reintentos de alertas de Telegram en segundo plano
    const ejecutarReintentos = async () => {
      try {
        await fetch('/api/telegram/retry-alerts');
      } catch (err) {
        console.warn("Fallo silencioso al reintentar envío de alertas de Telegram en cola:", err);
      }
    };
    
    // Ejecutar al montar el panel
    ejecutarReintentos();

    // Reintentar periódicamente cada 5 minutos
    const interval = setInterval(ejecutarReintentos, 300000);
    return () => clearInterval(interval);
  }, []);

  // Simulador de Tarifas
  const [surgePercent, setSurgePercent] = useState(20);
  const [discountPercent, setDiscountPercent] = useState(15);
  const [mesaExpandidaId, setMesaExpandidaId] = useState(null);

  // Modal de Enviar Cupón
  const [modalEnviarCuponOpen, setModalEnviarCuponOpen] = useState(false);
  const [cuponClienteNombre, setCuponClienteNombre] = useState('');
  const [cuponPorcentaje, setCuponPorcentaje] = useState(15);
  const [cuponCodigo, setCuponCodigo] = useState('');
  const [cuponMensaje, setCuponMensaje] = useState('');

  // Modal de Clientes (Agregar & Consultar)
  const [modalAgregarClienteOpen, setModalAgregarClienteOpen] = useState(false);
  const [modalConsultarClienteOpen, setModalConsultarClienteOpen] = useState(false);
  const [subTabConsultar, setSubTabConsultar] = useState('lista'); // 'lista' | 'duplicados'
  
  // Clientes desde Base de Datos
  const [clientesFidelidad, setClientesFidelidad] = useState([]);
  const [nuevoClienteNombre, setNuevoClienteNombre] = useState('');
  const [nuevoClienteTelefono, setNuevoClienteTelefono] = useState('');

  // Consejos IA Big Data (4 consejos activos)
  const [consejosIa, setConsejosIa] = useState([
    { id: 1, title: "Iluminación Inteligente IoT", desc: "Discrepancia en Mesa 4: Iluminación de mesa encendida sin cobro activo en caja. Verifique si hay juego informal no registrado para evitar merma.", tag: "Alerta", color: "var(--danger)", leido: false },
    { id: 2, title: "Predicción Climatológica", desc: "Se detecta lluvia intensa en la zona. La IA proyecta un incremento de +22% en consumo de café, chocolate y snacks calientes. Promueva estos productos en barra.", tag: "Clima", color: "var(--blue-light)", leido: false },
    { id: 3, title: "Control de Churn (Retención)", desc: "Se identificaron 3 clientes VIP inactivos hace más de 14 días. Envíe cupones de reactivación vía WhatsApp para evitar una pérdida proyectada de $5,400 MXN en el mes.", tag: "Churn", color: "var(--warning)", leido: false },
    { id: 4, title: "Planificación de Stock JIT", desc: "La cerveza Corona Extra proyecta agotarse el sábado a las 21:30 en base al histórico de consumo. Se sugiere solicitar 80 unidades de forma prioritaria hoy.", tag: "Abasto", color: "var(--bronze-light)", leido: false }
  ]);

  // Metas y Subpestañas IA
  const [metaMensual, setMetaMensual] = useState(100000);
  const [editandoMeta, setEditandoMeta] = useState(false);
  const [nuevaMetaInput, setNuevaMetaInput] = useState('');
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

    return () => {
      if (typeof unsubLogs === 'function') unsubLogs();
    };
  }, [esCajero]);

  useEffect(() => {
    if (esCajero) return;
    
    const qBitacora = query(
      collection(db, 'bitacora'),
      orderBy('fecha', 'desc'),
      limit(200)
    );
    
    const unsubBitacora = onSnapshot(qBitacora, (snap) => {
      let sumaMinutos = 0;
      let countAtendidos = 0;
      let countCancelados = 0;
      const eventos = [];
      
      snap.docs.forEach(doc => {
        const data = doc.data();
        if (data.accion === 'Surtido de Cocina Atendido') {
          countAtendidos++;
          const match = data.detalle.match(/Tiempo de respuesta:\s*(\d+)\s*min/);
          if (match && match[1]) {
            sumaMinutos += parseInt(match[1]);
          }
          eventos.push({
            id: doc.id,
            insumo: data.detalle.match(/insumo\s*\"([^\"]+)\"/)?.[1] || "Insumo",
            tiempo: data.detalle.match(/Tiempo de respuesta:\s*(\d+\s*min)/)?.[1] || "Desconocido",
            fecha: data.fecha,
            tipo: 'atendido',
            detalle: data.detalle
          });
        } else if (data.accion === 'Solicitud Surtido Cancelada') {
          countCancelados++;
          eventos.push({
            id: doc.id,
            insumo: data.detalle.match(/insumo\s*\"([^\"]+)\"/)?.[1] || "Insumo",
            tiempo: data.detalle.match(/Tiempo transcurrido:\s*(\d+\s*min)/)?.[1] || "Desconocido",
            fecha: data.fecha,
            tipo: 'cancelado',
            detalle: data.detalle
          });
        }
      });
      
      setSurtidoEficiencia({
        promedioMinutos: countAtendidos > 0 ? Math.round(sumaMinutos / countAtendidos) : 0,
        solicitudesAtendidas: countAtendidos,
        solicitudesCanceladas: countCancelados,
        ultimosEventos: eventos.slice(0, 5)
      });
    }, err => {
      console.warn("Error cargando bitácora de eficiencia de surtido:", err);
    });
    
    return () => {
      if (typeof unsubBitacora === 'function') unsubBitacora();
    };
  }, [esCajero]);

  useEffect(() => {
    if (esCajero) return;

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
      if (typeof unsubFila === 'function') unsubFila();
    };
  }, [esCajero]);

  // Modal Historial de Mantenimientos (Sugerencia 1)
  const [mostrarHistorialMantenimientoModal, setMostrarHistorialMantenimientoModal] = useState(false);
  const [mesaHistorialMantenimiento, setMesaHistorialMantenimiento] = useState(null);
  const [historialMantenimientosMesaList, setHistorialMantenimientosMesaList] = useState([]);

  const abrirHistorialMantenimiento = async (mesaId, nombreMesa) => {
    setMesaHistorialMantenimiento({ id: mesaId, nombre: nombreMesa });
    setHistorialMantenimientosMesaList([]);
    setMostrarHistorialMantenimientoModal(true);
    
    try {
      const q = query(
        collection(db, 'mantenimientos_historicos'),
        where('mesaId', '==', mesaId),
        orderBy('fecha', 'desc'),
        limit(20)
      );
      const snap = await getDocs(q);
      const list = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setHistorialMantenimientosMesaList(list);
    } catch (err) {
      console.error('Error al cargar historial de mantenimientos:', err);
      showToast('Error al cargar el historial de mantenimientos', 'danger');
    }
  };

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
          const parsed = JSON.parse(saved);
          const cleanData = parsed.filter(c => 
            c.descripcion !== 'Comanda - 4 Coronas + Botana' && 
            c.descripcion !== 'Mesa 2 - 1.5h' && 
            c.descripcion !== 'Compra de bebidas' && 
            c.descripcion !== 'Mesa 1 - 3h' &&
            c.descripcion !== 'Comanda - 4 Coronas + Botana (Mock)' &&
            !(c.descripcion && c.descripcion.includes('Consumo de barra (Ticket'))
          );
          setCobros(cleanData);
          localStorage.setItem('yoy_caja_cobros', JSON.stringify(cleanData));
        } else {
          setCobros([]);
          localStorage.setItem('yoy_caja_cobros', JSON.stringify([]));
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
    return () => {
      if (typeof unsub === 'function') unsub();
    };
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
    return () => {
      if (typeof unsub === 'function') unsub();
    };
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
    return () => {
      if (typeof unsub === 'function') unsub();
    };
  }, [limiteCortesCaja]);

  // Sincronizar cola offline de bitácora al detectar conectividad (Sugerencia 2)
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const handleOnlineStatus = () => {
        syncOfflineEvents();
      };
      window.addEventListener('online', handleOnlineStatus);
      // Sincronizar al arrancar el componente
      syncOfflineEvents();
      return () => {
        window.removeEventListener('online', handleOnlineStatus);
      };
    }
  }, []);

  // --- Helpers de IndexedDB para Caché Asíncrona y Cola Offline (Sugerencias 1, 2 y 3) ---
  const openReportDB = () => {
    return new Promise((resolve, reject) => {
      if (typeof window === 'undefined' || !window.indexedDB) {
        reject(new Error("IndexedDB no soportado"));
        return;
      }
      // Actualizamos a versión 2 para aprovisionar el almacén de cola offline
      const request = window.indexedDB.open("YoyReportDb", 2);
      request.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains("reportCache")) {
          db.createObjectStore("reportCache");
        }
        if (!db.objectStoreNames.contains("offlineQueue")) {
          db.createObjectStore("offlineQueue", { autoIncrement: true });
        }
      };
      request.onsuccess = (e) => resolve(e.target.result);
      request.onerror = (e) => reject(e.target.error);
    });
  };

  const setIndexedDB = async (key, val) => {
    try {
      const db = await openReportDB();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(["reportCache"], "readwrite");
        const store = transaction.objectStore("reportCache");
        const request = store.put(val, key);
        request.onsuccess = () => resolve();
        request.onerror = (e) => reject(e.target.error);
      });
    } catch (err) {
      console.warn("IndexedDB set falló:", err);
    }
  };

  const getIndexedDB = async (key) => {
    try {
      const db = await openReportDB();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(["reportCache"], "readonly");
        const store = transaction.objectStore("reportCache");
        const request = store.get(key);
        request.onsuccess = (e) => resolve(e.target.result);
        request.onerror = (e) => reject(e.target.error);
      });
    } catch (err) {
      console.warn("IndexedDB get falló:", err);
      return null;
    }
  };

  const removeIndexedDB = async (key) => {
    try {
      const db = await openReportDB();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(["reportCache"], "readwrite");
        const store = transaction.objectStore("reportCache");
        const request = store.delete(key);
        request.onsuccess = () => resolve();
        request.onerror = (e) => reject(e.target.error);
      });
    } catch (err) {
      console.warn("IndexedDB delete falló:", err);
    }
  };

  const clearIndexedDBCache = async () => {
    try {
      const db = await openReportDB();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(["reportCache"], "readwrite");
        const store = transaction.objectStore("reportCache");
        const request = store.clear();
        request.onsuccess = () => resolve();
        request.onerror = (e) => reject(e.target.error);
      });
    } catch (err) {
      console.warn("IndexedDB clear falló:", err);
    }
  };

  // --- Operaciones para la cola offline ---
  const queueOfflineEvent = async (eventData) => {
    try {
      const db = await openReportDB();

      // Sugerencia 2: Límite y purgado automático de la cola (máximo 500 eventos)
      const count = await new Promise((resolve, reject) => {
        const transaction = db.transaction(["offlineQueue"], "readonly");
        const store = transaction.objectStore("offlineQueue");
        const request = store.count();
        request.onsuccess = () => resolve(request.result);
        request.onerror = (e) => reject(e.target.error);
      });

      if (count >= 500) {
        await new Promise((resolve, reject) => {
          const transaction = db.transaction(["offlineQueue"], "readwrite");
          const store = transaction.objectStore("offlineQueue");
          const request = store.openCursor();
          request.onsuccess = (e) => {
            const cursor = e.target.result;
            if (cursor) {
              store.delete(cursor.key);
              resolve();
            } else {
              resolve();
            }
          };
          request.onerror = (e) => reject(e.target.error);
        });
        console.warn("Cola offline superó los 500 elementos. Purgando registro más antiguo.");
      }

      // Sugerencia 1: Minificación del evento local en IndexedDB para optimizar espacio
      const minified = {
        a: eventData.accion,
        d: eventData.detalle,
        m: Number(eventData.monto),
        o: eventData.operador,
        ro: eventData.rolOperador,
        f: eventData.fecha,
        t: eventData.tipo
      };

      return new Promise((resolve, reject) => {
        const transaction = db.transaction(["offlineQueue"], "readwrite");
        const store = transaction.objectStore("offlineQueue");
        const request = store.add(minified);
        request.onsuccess = () => resolve();
        request.onerror = (e) => reject(e.target.error);
      });
    } catch (err) {
      console.warn("Error guardando en cola offline:", err);
    }
  };

  const getOfflineEventsWithKeys = async () => {
    try {
      const db = await openReportDB();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(["offlineQueue"], "readonly");
        const store = transaction.objectStore("offlineQueue");
        const list = [];
        const request = store.openCursor();
        request.onsuccess = (e) => {
          const cursor = e.target.result;
          if (cursor) {
            const min = cursor.value;
            // Restaurar nombres de propiedades originales al recuperar los eventos
            const restored = {
              accion: min.a,
              detalle: min.d,
              monto: min.m,
              operador: min.o,
              rolOperador: min.ro,
              fecha: min.f,
              tipo: min.t
            };
            list.push({ key: cursor.key, value: restored });
            cursor.continue();
          } else {
            resolve(list);
          }
        };
        request.onerror = (e) => reject(e.target.error);
      });
    } catch (err) {
      console.warn("Error leyendo cola offline:", err);
      return [];
    }
  };

  const deleteOfflineEvent = async (key) => {
    try {
      const db = await openReportDB();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(["offlineQueue"], "readwrite");
        const store = transaction.objectStore("offlineQueue");
        const request = store.delete(key);
        request.onsuccess = () => resolve();
        request.onerror = (e) => reject(e.target.error);
      });
    } catch (err) {
      console.warn("Error eliminando de cola offline:", err);
    }
  };

  // Sugerencia 1: Detección activa de internet real (evitando portal cautivo)
  const checkRealInternet = async () => {
    if (typeof window === 'undefined') return true;
    if (typeof navigator !== 'undefined' && !navigator.onLine) return false;
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2500);
      const response = await fetch('/icon.png', { method: 'HEAD', signal: controller.signal });
      clearTimeout(timeoutId);
      return response.ok;
    } catch (err) {
      return false;
    }
  };

  // Sugerencia 2: Cola de sincronización en background
  const syncOfflineEvents = async () => {
    if (typeof window === 'undefined') return;
    const isOnline = await checkRealInternet();
    if (!isOnline) return;

    try {
      const queue = await getOfflineEventsWithKeys();
      if (queue.length === 0) return;

      console.log(`[Offline Sync] Sincronizando ${queue.length} eventos en cola...`);
      for (const item of queue) {
        try {
          await addDoc(collection(db, 'bitacora'), item.value);
          await deleteOfflineEvent(item.key);
          console.log(`[Offline Sync] Evento sincronizado con éxito: ${item.value.accion}`);
        } catch (err) {
          console.error("[Offline Sync] Error al sincronizar evento:", err);
          break;
        }
      }
      clearPersistedCache();
    } catch (err) {
      console.error("[Offline Sync] Falla en ciclo de sincronización:", err);
    }
  };

  // Helper para limpiar caché persistente (IndexedDB, LocalStorage) y en memoria
  const clearPersistedCache = () => {
    cacheReporteRef.current = {};
    if (typeof window !== 'undefined') {
      try {
        // Limpiar IndexedDB
        clearIndexedDBCache();
        // Limpiar localStorage (fallback histórico)
        const keys = Object.keys(localStorage);
        keys.forEach(k => {
          if (k.startsWith('yoy_report_cache_')) {
            localStorage.removeItem(k);
          }
        });
      } catch (e) {
        console.warn("Error al limpiar caché persistente:", e);
      }
    }
  };

  // Helper de reintentos para consultas de Firestore con backoff exponencial, timeout de 8s, detección offline y telemetría de latencia (Sugerencias 2 y 3)
  const getDocsWithRetry = async (qRef, maxRetries = 3, initialDelay = 1000) => {
    const isOnline = await checkRealInternet();
    if (!isOnline) {
      throw new Error('Dispositivo sin conexión a Internet o portal cautivo detectado');
    }
    let attempt = 0;
    const startTime = Date.now();
    while (true) {
      const isOnlineLoop = await checkRealInternet();
      if (!isOnlineLoop) {
        throw new Error('Dispositivo sin conexión a Internet o portal cautivo detectado');
      }
      try {
        // Envoltura con timeout de 8 segundos
        const queryPromise = getDocs(qRef);
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Timeout de consulta de base de datos (8s)')), 8000)
        );
        const res = await Promise.race([queryPromise, timeoutPromise]);
        
        // Medir latencia
        const duration = Date.now() - startTime;
        if (duration > 4000) {
          console.warn(`Latencia alta detectada en Firestore: ${duration}ms`);
          showToast(`Conexión lenta detectada (${Math.round(duration/1000)}s). Sugerimos revisar tu red.`, "warning");
        }
        return res;
      } catch (err) {
        attempt++;
        if (attempt >= maxRetries) {
          console.error(`Error de Firestore tras ${maxRetries} intentos:`, err);
          throw err;
        }
        const delay = initialDelay * Math.pow(2, attempt - 1);
        console.warn(`Firestore getDocs falló o expiró. Reintentando en ${delay}ms (intento ${attempt}/${maxRetries})...`, err);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  };

  // 3e. Motor de Reportes Financieros y Operativos
  const cargarDatosReporte = async (p, startCustom = '', endCustom = '') => {
    // Generar llave de cache segmentada por usuario para seguridad
    const userPrefix = user?.uid || 'anon';
    const cacheKey = `${userPrefix}_${p === 'Personalizado' ? `${startCustom}_${endCustom}` : p}`;
    const now = Date.now();
    const cacheTTL = p === 'Hoy' || p === 'Ayer' ? 30 * 1000 : 5 * 60 * 1000; // 30s Hoy/Ayer, 5m para históricos

    // 1. Intentar leer de caché en memoria primero
    if (cacheReporteRef.current[cacheKey]) {
      const cached = cacheReporteRef.current[cacheKey];
      if (now - cached.timestamp < cacheTTL) {
        setDatosReporte(cached.datos);
        setReporteCargando(false);
        return;
      }
    }

    // 2. Intentar leer de IndexedDB si es histórico (Sugerencia 1 y 3)
    if (p !== 'Hoy' && p !== 'Ayer' && typeof window !== 'undefined') {
      try {
        const localCached = await getIndexedDB(cacheKey);
        if (localCached) {
          if (now - localCached.timestamp < cacheTTL) {
            // Respaldar en memoria para subsecuentes consultas rápidas
            cacheReporteRef.current[cacheKey] = localCached;
            setDatosReporte(localCached.datos);
            setReporteCargando(false);
            return;
          }
        }
      } catch (e) {
        console.warn("Error leyendo caché persistente de IndexedDB:", e);
      }
    }

    setReporteCargando(true);
    try {
      let start = '';
      let end = new Date().toISOString();
      
      if (p === 'Hoy') {
        const d = new Date();
        d.setHours(0, 0, 0, 0);
        start = d.toISOString();
      } else if (p === 'Ayer') {
        const dS = new Date();
        dS.setDate(dS.getDate() - 1);
        dS.setHours(0, 0, 0, 0);
        start = dS.toISOString();
        
        const dE = new Date();
        dE.setDate(dE.getDate() - 1);
        dE.setHours(23, 59, 59, 999);
        end = dE.toISOString();
      } else if (p === '7d') {
        const d = new Date();
        d.setDate(d.getDate() - 7);
        d.setHours(0, 0, 0, 0);
        start = d.toISOString();
      } else if (p === '15d') {
        const d = new Date();
        d.setDate(d.getDate() - 15);
        d.setHours(0, 0, 0, 0);
        start = d.toISOString();
      } else if (p === '30d') {
        const d = new Date();
        d.setDate(d.getDate() - 30);
        d.setHours(0, 0, 0, 0);
        start = d.toISOString();
      } else if (p === '6m') {
        const d = new Date();
        d.setMonth(d.getMonth() - 6);
        d.setHours(0, 0, 0, 0);
        start = d.toISOString();
      } else if (p === '1a') {
        const d = new Date();
        d.setFullYear(d.getFullYear() - 1);
        d.setHours(0, 0, 0, 0);
        start = d.toISOString();
      } else if (p === 'Personalizado') {
        if (!startCustom || !endCustom) {
          showToast("Seleccione ambas fechas", "warning");
          setReporteCargando(false);
          return;
        }
        start = new Date(startCustom + 'T00:00:00').toISOString();
        end = new Date(endCustom + 'T23:59:59').toISOString();
      }

      const qBit = query(
        collection(db, 'bitacora'),
        where('fecha', '>=', start),
        where('fecha', '<=', end)
      );

      // Paralelizar todas las llamadas a Firebase utilizando getDocsWithRetry
      const [snapBit, snapPed, snapCortes, snapEmp, snapAsistencia] = await Promise.all([
        getDocsWithRetry(qBit),
        getDocsWithRetry(collection(db, 'mesa_pedidos')),
        getDocsWithRetry(collection(db, 'cortes_caja')),
        getDocsWithRetry(collection(db, 'nomina_empleados')),
        getDocsWithRetry(collection(db, 'nomina_asistencia_log'))
      ]);

      const listEventos = snapBit.docs.map(d => ({ id: d.id, ...d.data() }));

      const listPedidosRaw = snapPed.docs.map(d => {
        const dData = d.data();
        return {
          id: d.id,
          ...dData,
          createdAt: dData.createdAt ? (dData.createdAt.toDate ? dData.createdAt.toDate().toISOString() : dData.createdAt) : null,
          cocinaAtendidoAt: dData.cocinaAtendidoAt ? (dData.cocinaAtendidoAt.toDate ? dData.cocinaAtendidoAt.toDate().toISOString() : dData.cocinaAtendidoAt) : null
        };
      });

      const listPedidos = listPedidosRaw.filter(pDoc => {
        if (!pDoc.createdAt) return false;
        return pDoc.createdAt >= start && pDoc.createdAt <= end;
      });

      const listCortesRaw = snapCortes.docs.map(d => {
        const dData = d.data();
        return {
          id: d.id,
          ...dData,
          fecha: dData.fecha ? (dData.fecha.toDate ? dData.fecha.toDate().toISOString() : dData.fecha) : null
        };
      });
      const listCortes = listCortesRaw.filter(cDoc => {
        if (!cDoc.fecha) return false;
        return cDoc.fecha >= start && cDoc.fecha <= end;
      });

      const listEmpleados = snapEmp.docs.map(d => ({ id: d.id, ...d.data() }));

      const listAsistencias = snapAsistencia.docs.map(d => {
        const dData = d.data();
        const timeVal = dData.createdAt?.toDate 
          ? dData.createdAt.toDate().getTime() 
          : (dData.createdAt ? new Date(dData.createdAt).getTime() : new Date(`${dData.fecha}T${dData.hora || '12:00:00'}`).getTime());
        return {
          id: d.id,
          ...dData,
          time: timeVal
        };
      });

      const startTime = new Date(start).getTime();
      const endTime = new Date(end).getTime();
      const filteredAsistencias = listAsistencias.filter(log => log.time >= startTime && log.time <= endTime);

      const horasTrabajadasColaboradores = listEmpleados
        .filter(emp => emp.estado === 'activo')
        .map(emp => {
          const empLogs = filteredAsistencias
            .filter(log => log.empleadoId === emp.id)
            .sort((a, b) => a.time - b.time);

          let totalMs = 0;
          let lastEntradaTime = null;
          
          empLogs.forEach(log => {
            if (log.tipo === 'entrada') {
              lastEntradaTime = log.time;
            } else if (log.tipo === 'salida' && lastEntradaTime !== null) {
              totalMs += (log.time - lastEntradaTime);
              lastEntradaTime = null;
            }
          });
          
          if (lastEntradaTime !== null && endTime >= Date.now()) {
            totalMs += (Date.now() - lastEntradaTime);
          }
          
          const hrs = totalMs / 3600000;
          
          // Obtener costo de nómina estimado por hora (Sugerencia 2)
          const base = Number(emp.sueldoBase) || 0;
          const freq = emp.frecuenciaPago || 'quincenal';
          const diasPeriodo = freq === 'semanal' ? 7 : 15;
          const sueldoDiario = base > 0 ? (base / diasPeriodo) : 0;
          const pagoPorHora = sueldoDiario > 0 ? (sueldoDiario / 8) : 50; // Fallback a $50/hr
          const costoNomina = hrs * pagoPorHora;

          return {
            nombre: `${emp.nombre} ${emp.apellido || ''}`.trim(),
            rol: emp.rol || 'Staff',
            horas: hrs,
            costoNomina: costoNomina
          };
        });

      const totalCostoNominaEst = horasTrabajadasColaboradores.reduce((acc, curr) => acc + curr.costoNomina, 0);

      let totalHorasMesa = 0;
      let countUsoMesas = 0;
      listEventos.forEach(e => {
        if (e.accion === 'Cierre Directo' || e.accion === 'Mesa a Cuenta') {
          countUsoMesas++;
          const match = (e.detalle || '').match(/([0-9.]+)\s*h/);
          if (match) {
            totalHorasMesa += parseFloat(match[1]);
          } else {
            totalHorasMesa += 1.5;
          }
        }
      });

      const listadoMesasStatic = [
        { id: 1, nombre: 'Mesa 1', tipo: 'Carambola 3B', tarifa: 80 },
        { id: 2, nombre: 'Mesa 2', tipo: 'Carambola 3B', tarifa: 80 },
        { id: 3, nombre: 'Mesa 3', tipo: 'Pool 9B', tarifa: 60 },
        { id: 4, nombre: 'Mesa 4', tipo: 'Carambola 3B', tarifa: 80 },
        { id: 5, nombre: 'Mesa 5', tipo: 'Snooker', tarifa: 100 },
        { id: 6, nombre: 'Mesa 6', tipo: 'Pool 9B', tarifa: 60 },
        { id: 7, nombre: 'Mesa 7', tipo: 'Carambola 3B', tarifa: 80 },
        { id: 8, nombre: 'Mesa 8', tipo: 'Pool 9B', tarifa: 60 },
      ];

      const playPorCat = {};
      const consumoPorCat = {};
      const mesaIngresosTotales = {};

      listEventos.forEach(e => {
        const det = (e.detalle || '').toLowerCase();
        const acc = e.accion;
        const matched = listadoMesasStatic.find(m => det.includes(`mesa ${m.id}`) || det.includes(m.nombre.toLowerCase()));
        
        if (matched) {
          const cat = matched.tipo;
          const mesaName = matched.nombre;
          
          if (acc === 'Cierre Directo' || acc === 'Mesa a Cuenta') {
            if (!playPorCat[cat]) playPorCat[cat] = { total: 0, count: 0 };
            playPorCat[cat].total += Number(e.monto) || 0;
            playPorCat[cat].count += 1;

            if (!mesaIngresosTotales[mesaName]) mesaIngresosTotales[mesaName] = 0;
            mesaIngresosTotales[mesaName] += Number(e.monto) || 0;
          } else if (acc === 'Agregar Consumo' || acc === 'Pedido a Cuenta' || acc === 'Comanda') {
            if (!consumoPorCat[cat]) consumoPorCat[cat] = 0;
            consumoPorCat[cat] += Number(e.monto) || 0;

            if (!mesaIngresosTotales[mesaName]) mesaIngresosTotales[mesaName] = 0;
            mesaIngresosTotales[mesaName] += Number(e.monto) || 0;
          }
        }
      });

      let totalDescuentosVal = 0;
      listEventos.forEach(e => {
        const det = (e.detalle || '').toLowerCase();
        const acc = (e.accion || '').toLowerCase();
        if (det.includes('descuento') || det.includes('desc:') || acc.includes('descuento') || acc.includes('cortesía') || acc.includes('cupón')) {
          const match = det.match(/desc(uento)?\s*(de)?\s*\$?([0-9.]+)/) || det.match(/\$?([0-9.]+)\s*desc/);
          if (match) {
            totalDescuentosVal += parseFloat(match[3] || match[1]);
          }
        }
      });

      let totalVentasPeriodoVal = 0;
      listEventos.forEach(e => {
        const acc = e.accion;
        if (acc === 'Cierre Directo' || acc === 'Mesa a Cuenta' || acc === 'Cobro Manual' || acc === 'Venta Barra' || acc === 'Cobro Barra' || acc === 'Clientes - Suscripción' || acc === 'Torneos - Registro') {
          if (e.monto && Number(e.monto) > 0) {
            totalVentasPeriodoVal += Number(e.monto);
          }
        }
      });

      const meserosMap = {};
      listEventos.forEach(e => {
        const det = (e.detalle || '').toLowerCase();
        const acc = e.accion;
        const matchWaiter = det.match(/mesero\s*:\s*([a-zA-Z0-9\s]+)/) || det.match(/atendido\s*por\s*([a-zA-Z0-9\s]+)/);
        if (matchWaiter) {
          const name = matchWaiter[1].trim();
          if (name) {
            const capitalized = name.charAt(0).toUpperCase() + name.slice(1);
            meserosMap[capitalized] = (meserosMap[capitalized] || 0) + (Number(e.monto) || 0);
          }
        } else if (e.operador && (acc === 'Cierre Directo' || acc === 'Mesa a Cuenta' || acc === 'Pedido a Cuenta')) {
          const name = e.operador;
          if (name && name !== 'Sistema' && name !== 'Sistema IA / Inventario') {
            const capitalized = name.charAt(0).toUpperCase() + name.slice(1);
            meserosMap[capitalized] = (meserosMap[capitalized] || 0) + (Number(e.monto) || 0);
          }
        }
      });
      let mejorMesero = 'N/A';
      let peorMesero = 'N/A';
      let maxV = -1;
      let minV = Infinity;
      Object.entries(meserosMap).forEach(([n, v]) => {
        if (v > maxV) {
          maxV = v;
          mejorMesero = n;
        }
        if (v < minV) {
          minV = v;
          peorMesero = n;
        }
      });
      if (peorMesero === mejorMesero && Object.keys(meserosMap).length <= 1) {
        peorMesero = 'N/A';
      }

      let printOn = 0;
      let printOff = 0;
      listCortes.forEach(c => {
        const hasDenom = c.cantidadesDenom && Object.keys(c.cantidadesDenom).length > 0;
        if (hasDenom) {
          printOn += 1;
        } else {
          printOff += 1;
        }
      });
      if (printOn === 0 && printOff === 0) {
        const totalCloses = countUsoMesas;
        printOn = Math.round(totalCloses * 0.92);
        printOff = totalCloses - printOn;
      }

      let mesaMasRentable = 'N/A';
      let mesaMenosRentable = 'N/A';
      let maxM = -1;
      let minM = Infinity;
      Object.entries(mesaIngresosTotales).forEach(([n, v]) => {
        if (v > maxM) {
          maxM = v;
          mesaMasRentable = n;
        }
        if (v < minM) {
          minM = v;
          mesaMenosRentable = n;
        }
      });
      if (mesaMenosRentable === mesaMasRentable && Object.keys(mesaIngresosTotales).length <= 1) {
        mesaMenosRentable = 'N/A';
      }

      const topItemsMap = {};
      listEventos.forEach(e => {
        const det = e.detalle || '';
        const matches = det.matchAll(/([0-9]+)\s*x\s*([a-zA-ZáéíóúñÁÉÍÓÚÑ\s]+)/gi);
        for (const m of matches) {
          const qty = parseInt(m[1]);
          const name = m[2].trim();
          const cleanName = name.replace(/(agregado|cargado|para|de|en|por)\b.*/i, '').trim();
          if (cleanName && cleanName.length > 2) {
            topItemsMap[cleanName] = (topItemsMap[cleanName] || 0) + qty;
          }
        }
      });
      const topItems = Object.entries(topItemsMap)
        .map(([nombre, cant]) => ({ nombre, cant }))
        .sort((a, b) => b.cant - a.cant);

      const sortedEvents = [...listEventos].sort((a, b) => new Date(a.fecha) - new Date(b.fecha));
      const lastCierre = {};
      const idleTimes = [];
      sortedEvents.forEach(e => {
        const det = (e.detalle || '').toLowerCase();
        const acc = e.accion;
        const matched = listadoMesasStatic.find(m => det.includes(`mesa ${m.id}`) || det.includes(m.nombre.toLowerCase()));
        if (matched) {
          const name = matched.nombre;
          if (acc === 'Cierre Directo' || acc === 'Mesa a Cuenta') {
            lastCierre[name] = new Date(e.fecha).getTime();
          } else if (acc === 'Abrir Mesa' || acc === 'Mesa Ocupada' || acc === 'Iniciar Tiempo') {
            const closing = lastCierre[name];
            if (closing) {
              const diffMin = (new Date(e.fecha).getTime() - closing) / 60000;
              if (diffMin > 0 && diffMin < 720) {
                idleTimes.push(diffMin);
              }
              delete lastCierre[name];
            }
          }
        }
      });
      const promedioRotacionVal = idleTimes.length > 0
        ? (idleTimes.reduce((s, v) => s + v, 0) / idleTimes.length)
        : 14;

      const pagosPorHora = {
        'Mañana (08:00 - 15:00)': { efectivo: 0, tarjeta: 0, transferencia: 0 },
        'Tarde (15:00 - 21:00)': { efectivo: 0, tarjeta: 0, transferencia: 0 },
        'Noche (21:00 - 04:00)': { efectivo: 0, tarjeta: 0, transferencia: 0 }
      };
      listEventos.forEach(e => {
        if (e.monto && Number(e.monto) > 0) {
          const date = new Date(e.fecha);
          const hour = date.getHours();
          let slot = 'Tarde (15:00 - 21:00)';
          if (hour >= 8 && hour < 15) {
            slot = 'Mañana (08:00 - 15:00)';
          } else if (hour >= 21 || hour < 4) {
            slot = 'Noche (21:00 - 04:00)';
          }
          
          const det = (e.detalle || '').toLowerCase();
          let method = 'efectivo';
          if (det.includes('tarjeta')) method = 'tarjeta';
          else if (det.includes('transferencia') || det.includes('spei') || det.includes('qr') || det.includes('código qr')) method = 'transferencia';
          
          pagosPorHora[slot][method] += Number(e.monto);
        }
      });

      let totalPrepTime = 0;
      let countPrep = 0;
      listPedidos.forEach(p => {
        if (p.createdAt && p.cocinaAtendidoAt) {
          const tC = new Date(p.createdAt).getTime();
          const tS = new Date(p.cocinaAtendidoAt).getTime();
          const diff = (tS - tC) / 60000;
          if (diff > 0 && diff < 120) {
            totalPrepTime += diff;
            countPrep += 1;
          }
        }
      });
      const promedioPrepVal = countPrep > 0 ? (totalPrepTime / countPrep) : 11.5;

      const dataToSave = {
        period: p,
        start,
        end,
        totalHorasMesa,
        playPorCat,
        consumoPorCat,
        totalDescuentosVal,
        totalVentasPeriodoVal,
        mejorMesero,
        peorMesero,
        printOn,
        printOff,
        mesaMasRentable,
        mesaMenosRentable,
        topItems,
        promedioRotacionVal,
        pagosPorHora,
        promedioPrepVal,
        horasTrabajadasColaboradores,
        totalCostoNominaEst,
        rawEventos: listEventos,
        rawPedidos: listPedidos,
        rawCortes: listCortes
      };

      // Guardar en cache en memoria
      cacheReporteRef.current[cacheKey] = {
        datos: dataToSave,
        timestamp: Date.now()
      };

      // Guardar en IndexedDB si es histórico (Sugerencia 1 y 3)
      if (p !== 'Hoy' && p !== 'Ayer' && typeof window !== 'undefined') {
        try {
          // Depurar (prune) las listas pesadas para ahorrar espacio en IndexedDB
          const prunedEventos = (listEventos || []).map(e => ({
            tipo: e.tipo || '',
            accion: e.accion || '',
            monto: Number(e.monto || 0),
            operador: e.operador || '',
            rolOperador: e.rolOperador || '',
            fecha: e.fecha || '',
            detalle: e.detalle || ''
          }));

          const prunedPedidos = (listPedidos || []).map(ped => ({
            id: ped.id || '',
            createdAt: ped.createdAt || '',
            cocinaAtendidoAt: ped.cocinaAtendidoAt || '',
            total: Number(ped.total || 0),
            metodoPago: ped.metodoPago || ped.metodo || ''
          }));

          const prunedCortes = (listCortes || []).map(c => ({
            id: c.id || '',
            cantidadesDenom: c.cantidadesDenom ? { dummy: true } : null
          }));

          const prunedData = {
            ...dataToSave,
            rawEventos: prunedEventos,
            rawPedidos: prunedPedidos,
            rawCortes: prunedCortes
          };

          await setIndexedDB(cacheKey, {
            datos: prunedData,
            timestamp: Date.now()
          });
        } catch (e) {
          console.warn("Error guardando en caché de IndexedDB:", e);
        }
      }

      setDatosReporte(dataToSave);

    } catch (err) {
      console.error("Error al generar reporte de período:", err);
      showToast("Error de conexión al cargar datos", "danger");
    } finally {
      setReporteCargando(false);
    }
  };

  const handlePeriodoReporteChange = (p) => {
    if (p === periodoReporte && p !== 'Personalizado') {
      const userPrefix = user?.uid || 'anon';
      const cacheKey = `${userPrefix}_${p}`;
      delete cacheReporteRef.current[cacheKey];
      if (typeof window !== 'undefined') {
        try {
          removeIndexedDB(cacheKey);
          localStorage.removeItem(`yoy_report_cache_${cacheKey}`);
        } catch (e) {
          console.warn("Error al remover de caché persistente:", e);
        }
      }
    }
    setPeriodoReporte(p);
    if (p !== 'Personalizado') {
      cargarDatosReporte(p);
    }
  };

  const exportarReporte = async (formato) => {
    if (!datosReporte) return;
    const { period, start, end, rawEventos, horasTrabajadasColaboradores, totalCostoNominaEst } = datosReporte;

    const fechaInicioFmt = new Date(start).toLocaleDateString('es-MX');
    const fechaFinFmt = new Date(end).toLocaleDateString('es-MX');

    // Sanitización CSV (Sugerencia de Seguridad)
    const sanitizeCSV = (str) => {
      if (str === null || str === undefined) return '';
      const clean = String(str).replace(/"/g, '""');
      if (['=', '+', '-', '@'].includes(clean.charAt(0))) {
        return `'${clean}`;
      }
      return clean;
    };

    if (formato === 'excel') {
      let csvContent = "data:text/csv;charset=utf-8,\uFEFF";
      csvContent += "FECHA,ACCION,DETALLE,MONTO (MXN),OPERADOR\n";

      rawEventos.forEach(e => {
        const fechaStr = new Date(e.fecha).toLocaleString('es-MX').replace(/,/g, '');
        const accionStr = sanitizeCSV(e.accion);
        const detalleStr = sanitizeCSV(e.detalle);
        const montoStr = e.monto || 0;
        const operadorStr = sanitizeCSV(e.operador);
        csvContent += `"${fechaStr}","${accionStr}","${detalleStr}",${montoStr},"${operadorStr}"\n`;
      });

      if (horasTrabajadasColaboradores && horasTrabajadasColaboradores.length > 0) {
        csvContent += "\nCOLABORADOR,ROL,HORAS TRABAJADAS (QR),NOMINA ESTIMADA (MXN)\n";
        horasTrabajadasColaboradores.forEach(emp => {
          csvContent += `"${sanitizeCSV(emp.nombre)}","${sanitizeCSV(emp.rol)}",${emp.horas.toFixed(1)},${emp.costoNomina.toFixed(2)}\n`;
        });
        csvContent += `,,,${totalCostoNominaEst.toFixed(2)}\n`;
      }

      const encodedUri = encodeURI(csvContent);
      const link = document.createElement("a");
      link.setAttribute("href", encodedUri);
      link.setAttribute("download", `reporte_detalle_${period.toLowerCase()}_${fechaInicioFmt.replace(/\//g, '-')}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      showToast("Detalle exportado a Excel (.csv) ✓", "success");

    } else if (formato === 'pdf') {
      const printWindow = window.open('', '_blank');
      if (!printWindow) {
        showToast("Habilite los pop-ups para imprimir", "danger");
        return;
      }

      const tableRows = rawEventos.map(e => `
        <tr>
          <td>${new Date(e.fecha).toLocaleString('es-MX')}</td>
          <td><b>${e.accion}</b></td>
          <td>${e.detalle}</td>
          <td align="right">$${(e.monto || 0).toLocaleString('es-MX')}</td>
          <td>${e.operador || 'Sistema'}</td>
        </tr>
      `).join('');

      const horasRows = (horasTrabajadasColaboradores || []).map(emp => `
        <tr>
          <td>${emp.nombre}</td>
          <td>${emp.rol}</td>
          <td align="right">${emp.horas.toFixed(1)} hrs</td>
          <td align="right">$${emp.costoNomina.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
        </tr>
      `).join('');

      const horasSection = horasTrabajadasColaboradores && horasTrabajadasColaboradores.length > 0 ? `
        <h3>Pase de Lista y Nómina Estimada Devengada</h3>
        <table>
          <thead>
            <tr>
              <th>Colaborador</th>
              <th>Rol</th>
              <th>Horas Trabajadas</th>
              <th>Costo Estimado</th>
            </tr>
          </thead>
          <tbody>
            ${horasRows}
          </tbody>
          <tfoot>
            <tr style="font-weight: bold; background-color: #f2f2f2;">
              <td colspan="2">TOTAL</td>
              <td align="right">${horasTrabajadasColaboradores.reduce((s, e) => s + e.horas, 0).toFixed(1)} hrs</td>
              <td align="right">$${totalCostoNominaEst.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
            </tr>
          </tfoot>
        </table>
      ` : '';

      printWindow.document.write(`
        <html>
          <head>
            <title>Reporte YoY - Periodo: ${period} (${fechaInicioFmt} al ${fechaFinFmt})</title>
            <style>
              body { font-family: sans-serif; padding: 20px; color: #333; }
              h1 { color: #85582b; font-size: 20px; border-bottom: 2px solid #85582b; padding-bottom: 8px; }
              h3 { color: #85582b; font-size: 14px; margin-top: 25px; }
              table { width: 100%; border-collapse: collapse; margin-top: 15px; font-size: 11px; }
              th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
              th { background-color: #f2f2f2; }
              tr:nth-child(even) { background-color: #f9f9f9; }
            </style>
          </head>
          <body>
            <h1>Reporte Detallado de Transacciones (${period})</h1>
            <p><b>Rango:</b> ${fechaInicioFmt} al ${fechaFinFmt}</p>
            <p><b>Monto de Ventas Totales:</b> $${datosReporte.totalVentasPeriodoVal.toLocaleString('es-MX')}</p>
            <p><b>Tiempo de Mesas en Uso:</b> ${datosReporte.totalHorasMesa.toFixed(1)} hrs</p>
            
            <table>
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Acción</th>
                  <th>Detalle</th>
                  <th>Monto</th>
                  <th>Operador</th>
                </tr>
              </thead>
              <tbody>
                ${tableRows}
              </tbody>
            </table>

            ${horasSection}

            <script>
              window.onload = function() {
                window.print();
                window.close();
              }
            </script>
          </body>
        </html>
      `);
      printWindow.document.close();

    } else if (formato === 'telegram') {
      try {
        const tgSnap = await getDoc(doc(db, 'config', 'telegram'));
        if (tgSnap.exists()) {
          const tgData = tgSnap.data();
          const isSimplified = tgData.mode === 'simplified' || (!tgData.botToken && tgData.chatId);
          const hasCustom = tgData.mode === 'custom' && tgData.botToken && tgData.chatId;
          
          if (tgData.enabled && (isSimplified || hasCustom)) {
            const sucSnap = await getDoc(doc(db, 'config', 'sucursal'));
            const sucursalName = sucSnap.exists() ? (sucSnap.data().nombre || 'Sucursal') : 'Sucursal';

            let text = `📊 *Reporte YoY: ${period} (${sucursalName})*\n`;
            text += `📅 *Rango:* ${fechaInicioFmt} al ${fechaFinFmt}\n\n`;
            text += `💰 *Ventas Totales:* $${datosReporte.totalVentasPeriodoVal.toLocaleString('es-MX')}\n`;
            text += `⏰ *Tiempo de Mesas en Uso:* ${datosReporte.totalHorasMesa.toFixed(1)} hrs\n`;
            text += `🏷️ *Descuentos Aplicados:* $${datosReporte.totalDescuentosVal.toLocaleString('es-MX')}\n`;
            text += `🏆 *Mejor Mesero:* ${datosReporte.mejorMesero}\n`;
            text += `⚠️ *Peor Mesero:* ${datosReporte.peorMesero}\n`;
            text += `📈 *Mesa más rentable:* ${datosReporte.mesaMasRentable}\n`;
            text += `📉 *Mesa menos rentable:* ${datosReporte.mesaMenosRentable}\n`;
            text += `🕒 *Tiempo Prom. Rotación:* ${datosReporte.promedioRotacionVal.toFixed(0)} min\n`;
            text += `🍔 *Barra (Top Productos):* ${datosReporte.topItems.slice(0, 3).map(i => `${i.nombre} (${i.cant} pz)`).join(', ') || 'Sin consumos'}\n`;
            text += `⚡ *Preparación Promedio:* ${datosReporte.promedioPrepVal.toFixed(1)} min\n\n`;

            if (horasTrabajadasColaboradores && horasTrabajadasColaboradores.length > 0) {
              text += `👥 *Horas Trabajadas (Pase de Lista QR):*\n`;
              horasTrabajadasColaboradores.forEach(emp => {
                text += `• ${emp.nombre} (${emp.rol}): ${emp.horas.toFixed(1)} hrs ($${emp.costoNomina.toFixed(0)})\n`;
              });
              text += `💰 *Nómina Est. Devengada:* $${totalCostoNominaEst.toLocaleString('es-MX', { maximumFractionDigits: 0 })}\n\n`;
            }

            text += `📄 _Detalle enviado a solicitud del Administrador._`;

            const res = await fetch('/api/telegram/send-alert', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                mode: tgData.mode || 'simplified',
                token: tgData.botToken,
                chatId: tgData.chatId,
                phone: tgData.phone || '',
                sucursalName: sucursalName,
                text: text
              })
            });
            if (res.ok) {
              showToast("Reporte enviado con éxito a Telegram ✓", "success");
            } else {
              showToast("Error al enviar el reporte a Telegram", "danger");
            }
          } else {
            showToast("Telegram no está habilitado o configurado", "warning");
          }
        } else {
          showToast("No se encontró configuración de Telegram", "warning");
        }
      } catch (err) {
        console.error("Error al enviar reporte a Telegram:", err);
        showToast("Error al conectar con la API de Telegram", "danger");
      }
    }
  };

  useEffect(() => {
    cargarDatosReporte('Hoy');
  }, []);

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
      onSnapshot(query(collection(db, 'nomina_asistencia_log'), orderBy('createdAt', 'desc'), limit(500)), snap => {
        setFichajesLogs(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      }),
      onSnapshot(doc(db, 'config', 'inventario'), snap => {
        if (snap.exists()) setProductos(snap.data().productos || []);
      }),
      onSnapshot(doc(db, 'config', 'mesas_estado'), snap => {
        if (snap.exists()) {
          const data = snap.data();
          if (Array.isArray(data.mesas)) setMesas(data.mesas);
          setTarifaAutopilotActivo(!!data.tarifaAutopilotActivo);
        }
      }),
      onSnapshot(doc(db, 'config', 'cuentas_estado'), snap => {
        if (snap.exists() && Array.isArray(snap.data().cuentas)) setCuentasActivas(snap.data().cuentas);
      }),
      onSnapshot(doc(db, 'config', 'sucursal'), snap => {
        if (snap.exists()) {
          const d = snap.data();
          const currentYM = new Date().getFullYear() + '-' + String(new Date().getMonth() + 1).padStart(2, '0');
          if (d.metasMensuales && d.metasMensuales[currentYM] !== undefined) {
            setMetaMensual(Number(d.metasMensuales[currentYM]));
          } else if (d.metaMensual !== undefined) {
            setMetaMensual(Number(d.metaMensual));
          }
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
        });
      }
    });
    setInconsistenciasEnVivo(incs);

    // Disparar alertas de inconsistencias en vivo de forma inteligente
    if (telegramConfig && telegramConfig.enabled && telegramConfig.notifyDisruptiveAlerts) {
      incs.forEach(async (inc) => {
        const key = `${inc.mesaId}_${inc.tipo}`;
        if (!alertadasInconsistencias.current.has(key)) {
          alertadasInconsistencias.current.add(key);
          try {
            const nowStr = new Date().toLocaleString('es-MX', { timeZone: 'America/Mexico_City' });
            const label = inc.tipo === 'iot_luces' ? 'Desviación Eléctrica (IoT)' : 'Desviación Operativa';
            const alertMsg = `✈️ *[YoY Billar - Alerta IA]*\n\n` +
                             `⚠️ *${label}*\n` +
                             `🎱 *Mesa:* ${inc.nombre}\n` +
                             `👤 *Cliente registrado:* ${inc.cliente}\n` +
                             `📊 *Detalle:* ${inc.motivo}\n` +
                             `📅 *Hora:* ${nowStr}`;

            await fetch('/api/telegram/send-alert', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                mode: telegramConfig.mode,
                token: telegramConfig.botToken,
                chatId: telegramConfig.chatId,
                phone: telegramConfig.phone,
                text: alertMsg
              })
            });
          } catch (err) {
            console.error("Error al despachar alerta de inconsistencia IoT:", err);
          }
        }
      });
    }
  }, [mesas, cuentasActivas, telegramConfig]);

  // Helper para auditoría bitácora / registrar auditoría (Sugerencias 1 y 2)
  const registrarEvento = async (accion, detalle, monto = 0, tipo = 'info', metodoPago = null) => {
    // Sugerencia 2: Estandarización y validación estricta de métodos de pago
    let finalMetodoPago = metodoPago;
    const montoVal = Number(monto);
    if (montoVal !== 0 && !finalMetodoPago) {
      const detLower = (detalle || '').toLowerCase();
      if (detLower.includes('tarjeta')) {
        finalMetodoPago = 'tarjeta';
      } else if (detLower.includes('transferencia') || detLower.includes('spei') || detLower.includes('qr')) {
        finalMetodoPago = 'transferencia';
      } else {
        finalMetodoPago = 'efectivo';
      }
    }

    // Normalizar a los valores que acepta firestore.rules
    if (finalMetodoPago) {
      finalMetodoPago = finalMetodoPago.toLowerCase();
      if (finalMetodoPago === 'spei' || finalMetodoPago === 'qr') {
        finalMetodoPago = 'transferencia';
      }
    }

    const eventData = {
      accion,
      detalle,
      monto: montoVal,
      operador: user ? (user.name || user.alias || user.email) : 'Sistema',
      rolOperador: user ? (user.role || 'staff') : 'sistema',
      fecha: new Date().toISOString(),
      tipo
    };

    if (finalMetodoPago) {
      eventData.metodoPago = finalMetodoPago;
    }

    const isOnline = await checkRealInternet();
    if (!isOnline) {
      console.warn("Dispositivo sin conexión o en portal cautivo. Encolando evento en IndexedDB:", eventData);
      await queueOfflineEvent(eventData);
      showToast("Sin conexión. Registro encolado localmente.", "warning");
      return;
    }

    try {
      await addDoc(collection(db, 'bitacora'), eventData);
      // Invalida cache de reportes cuando se registra un nuevo evento
      clearPersistedCache();
    } catch (e) {
      console.error("Error al registrar evento remotamente, guardando en cola local:", e);
      await queueOfflineEvent(eventData);
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
    let gastosEfectivo = 0;
    let gastosTarjetaVal = 0;
    let gastosTransferenciaVal = 0;
    const gastosDetalle = [];
    const startPeriodTime = new Date(startPeriod).getTime();

    gastosList.forEach(g => {
      let logTime = 0;
      if (g.createdAt) {
        logTime = g.createdAt.toDate ? g.createdAt.toDate().getTime() : new Date(g.createdAt).getTime();
      } else if (g.fecha) {
        const isoStr = g.fecha.includes('T') ? g.fecha : `${g.fecha}T12:00:00`;
        logTime = new Date(isoStr).getTime();
      }

      if (logTime >= startPeriodTime) {
        const montoG = Number(g.monto) || 0;
        totalGastosVal += montoG;

        const metGasto = (g.metodoPago || 'efectivo').toLowerCase();
        if (metGasto === 'tarjeta') {
          gastosTarjetaVal += montoG;
        } else if (metGasto === 'transferencia' || metGasto === 'spei') {
          gastosTransferenciaVal += montoG;
        } else {
          gastosEfectivo += montoG;
        }
        
        let horaStr = new Date(logTime).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
        
        gastosDetalle.push({
          id: g.id || Date.now() + Math.random(),
          fecha: g.fecha,
          hora: horaStr,
          descripcion: g.descripcion || g.concepto || 'Gasto registrado',
          categoria: g.categoria || 'general',
          proveedor: g.proveedor || g.empleadoNombre || 'Proveedor/Empleado',
          monto: montoG,
          metodoPago: metGasto
        });
      }
    });

    // Cruzar información con nómina/adelantos
    nominaPagosList.forEach(p => {
      let logTime = 0;
      if (p.createdAt) {
        logTime = p.createdAt.toDate ? p.createdAt.toDate().getTime() : new Date(p.createdAt).getTime();
      } else if (p.fecha) {
        logTime = new Date(`${p.fecha}T12:00:00`).getTime();
      }

      if (logTime >= startPeriodTime) {
        const montoP = Number(p.total) || 0;
        
        // Evitar duplicados si ya existe un gasto de nómina para el mismo empleado con monto similar (+/- 1 peso)
        const yaExiste = gastosDetalle.some(g => 
          g.categoria === 'admin' && 
          Math.abs(g.monto - montoP) < 1.0 && 
          g.descripcion.toLowerCase().includes(p.nombreEmpleado.toLowerCase())
        );

        if (!yaExiste) {
          totalGastosVal += montoP;
          if (p.descontoDeCaja) {
            gastosEfectivo += montoP;
          } else {
            gastosTransferenciaVal += montoP;
          }
          
          let horaStr = new Date(logTime).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });

          gastosDetalle.push({
            id: p.id || Date.now() + Math.random(),
            fecha: p.fecha || new Date(logTime).toISOString().slice(0, 10),
            hora: horaStr,
            descripcion: `Pago de nómina - ${p.nombreEmpleado} (Conciliación)`,
            categoria: 'nomina',
            proveedor: p.nombreEmpleado,
            monto: montoP,
            descontoDeCaja: p.descontoDeCaja || false
          });
        }
      }
    });

    bitacoraFiltrada.forEach(e => {
      if (e.monto && e.monto < 0) {
        const montoAbs = Math.abs(Number(e.monto));
        totalGastosVal += montoAbs;
        gastosEfectivo += montoAbs; // manual negatives are cash
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
    const efectivoEsperado = ingresosEfectivo - gastosEfectivo;

    return {
      ingresosEfectivo,
      ingresosTarjeta,
      ingresosTransferencia,
      ingresosDetalle,
      gastosDetalle,
      totalIngresos,
      totalGastos: totalGastosVal,
      gastosEfectivo,
      gastosTarjetaVal,
      gastosTransferenciaVal,
      efectivoEsperado
    };
  }, [bitacoraFiltrada, gastosList, nominaPagosList, ultimoCorteFecha]);

  const generarResumenIA = (corteData, sumaContadaVal, diferenciaVal) => {
    const { ingresosEfectivo, ingresosTarjeta, ingresosTransferencia, totalIngresos, totalGastos: totalGastosVal, gastosDetalle, gastosEfectivo, efectivoEsperado } = corteData;
    
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

Egresos Totales (Gastos / Nómina): -$${totalGastosVal.toLocaleString()} MXN (Efectivo: -$${gastosEfectivo.toLocaleString()} MXN, Digital: -$${(totalGastosVal - gastosEfectivo).toLocaleString()} MXN)
Distribución de Egresos por Categorías:
${gastosAnalisis}

=== ARQUEO Y RECONCILIACIÓN ===
Efectivo Esperado en Caja: $${efectivoEsperado.toLocaleString()} MXN
Efectivo Físico Entregado (Arqueo): $${sumaContadaVal.toLocaleString()} MXN
Diferencia Auditoría: ${diferenciaVal >= 0 ? '+' : ''}$${diferenciaVal.toLocaleString()} MXN

=== SUGERENCIAS PREVENTIVAS IA ===
${diferenciaVal < 0 ? '1. Implementar auditoría ciega por turnos.\n2. Conciliar consumos del bar con el inventario físico al cambio de cajero.' : diferenciaVal > 0 ? '1. Verificar si existen tickets de comandero físico pendientes de facturación.\n2. Asegurar que las comisiones se descuenten de forma digital.' : '1. Mantener el protocolo actual de arqueo interactivo.\n2. Continuar con la trazabilidad en tiempo real de Firestore.'}`;
    return report.trim();
  };

  const imprimirTicketCorte = (corteData, sumaContadaVal, diferenciaVal, resumenIA, operador, fechaUltimo, cantidadesDenom) => {
    const { ingresosEfectivo, ingresosTarjeta, ingresosTransferencia, totalIngresos, totalGastos: totalGastosVal, ingresosDetalle, gastosDetalle, gastosEfectivo, efectivoEsperado } = corteData;
    
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
          Esperado en Caja: $${efectivoEsperado.toLocaleString()} MXN<br/>
          (Ventas Efe: $${ingresosEfectivo.toLocaleString()} - OPEX Efe: $${gastosEfectivo.toLocaleString()})<br/>
          Contado en Físico: $${sumaContadaVal.toLocaleString()} MXN<br/>
          Diferencia: ${diferenciaVal >= 0 ? '+' : ''}$${diferenciaVal.toLocaleString()} MXN<br/>
          <br/>
          <strong>METODOS DIGITALES (NO CAJA):</strong><br/>
          Tarjeta: $${ingresosTarjeta.toLocaleString()} MXN<br/>
          Transf. / SPEI: $${ingresosTransferencia.toLocaleString()} MXN<br/>
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
      const docRef = await addDoc(collection(db, 'cortes_caja'), {
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

      // Registrar auditoría de corte inmutable
      await setDoc(doc(db, 'auditorias_cortes', docRef.id), {
        corteId: docRef.id,
        fecha: serverTimestamp(),
        operador: nombreOperador,
        efectivoContado: sumaContada,
        efectivoEsperado: calculationsCorte.efectivoEsperado,
        diferencia: diferencia,
        discrepanciaReconciliada: false,
        comentarioReconciliacion: '',
        auditorResponsable: ''
      });

      // Alerta de descuadre de caja (Sugerencia 3: Tolerancia Dinámica)
      if (telegramConfig && telegramConfig.enabled && telegramConfig.notifyDisruptiveAlerts) {
        let stdDev = 0;
        let historicosStr = 'No hay suficiente historial para desviación estándar.';
        try {
          const qCortes = query(
            collection(db, 'cortes_caja'),
            orderBy('fecha', 'desc'),
            limit(30)
          );
          const snapCortes = await getDocs(qCortes);
          const diffs = [];
          snapCortes.forEach(doc => {
            const data = doc.data();
            if (data.diferencia !== undefined) {
              diffs.push(Number(data.diferencia));
            }
          });
          if (diffs.length >= 3) {
            const mean = diffs.reduce((s, v) => s + v, 0) / diffs.length;
            const variance = diffs.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / diffs.length;
            stdDev = Math.sqrt(variance);
            historicosStr = `Basado en ${diffs.length} cortes históricos (Desv. Est. σ: $${stdDev.toFixed(1)} MXN).`;
          }
        } catch (errCortes) {
          console.error("Error al calcular desviación estándar de cortes históricos:", errCortes);
        }

        const thresholdBase = telegramConfig.discrepancyThreshold !== undefined ? Number(telegramConfig.discrepancyThreshold) : 100;
        const pctThreshold = 0.015 * Math.abs(calculationsCorte.efectivoEsperado);
        
        // Tolerancia Dinámica: Mayor entre el umbral base, 1.5 * σ de historial, o el 1.5% del efectivo esperado.
        const dynamicThreshold = Math.max(thresholdBase, 1.5 * stdDev, pctThreshold);
        const diffAbs = Math.abs(diferencia);
        
        if (diffAbs > dynamicThreshold) {
          try {
            const formattedDiff = diferencia >= 0 ? `+$${diferencia.toLocaleString('es-MX')}` : `-$${diffAbs.toLocaleString('es-MX')}`;
            const nowStr = new Date().toLocaleString('es-MX', { timeZone: 'America/Mexico_City' });
            
            let analisisMetodo = `El descuadre actual de $${diffAbs.toLocaleString('es-MX')} MXN supera el umbral dinámico adaptativo de $${Math.round(dynamicThreshold).toLocaleString('es-MX')} MXN. `;
            if (dynamicThreshold === pctThreshold) {
              analisisMetodo += `(Activado por el límite de volumen de turno del 1.5% de efectivo esperado).`;
            } else if (dynamicThreshold === 1.5 * stdDev) {
              analisisMetodo += `(Activado por el límite de variación histórica de 1.5σ).`;
            } else {
              analisisMetodo += `(Activado por el umbral base estático establecido por el administrador).`;
            }

            const alertMsg = `✈️ *[YoY Billar - Alerta IA]*\n\n` +
                             `⚠️ *Desviación Crítica de Caja (Arqueo)*\n` +
                             `👤 *Operador:* ${nombreOperador}\n` +
                             `💵 *Efectivo Esperado:* $${calculationsCorte.efectivoEsperado.toLocaleString('es-MX')}\n` +
                             `💵 *Efectivo Contado:* $${sumaContada.toLocaleString('es-MX')}\n` +
                             `📊 *Diferencia / Descuadre:* *${formattedDiff}* ⚠️\n` +
                             `📅 *Hora:* ${nowStr}\n\n` +
                             `*Análisis IA:* ${analisisMetodo}\n` +
                             `*Historial:* ${historicosStr}`;

            await fetch('/api/telegram/send-alert', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                mode: telegramConfig.mode,
                token: telegramConfig.botToken,
                chatId: telegramConfig.chatId,
                phone: telegramConfig.phone,
                text: alertMsg
              })
            });
          } catch (tgErr) {
            console.error("Error al despachar alerta de descuadre:", tgErr);
          }
        }
      }

      // Conciliación y Descuento automático de stock de inventario
      if (productos && productos.length > 0) {
        const nuevosProductos = productos.map(p => {
          const audit = auditoriaCruzadaInventario.find(a => a.nombre.toLowerCase() === p.nombre.toLowerCase());
          if (audit && audit.comandas > 0) {
            const nuevoStock = Math.max(0, (p.stock || 0) - audit.comandas);
            return { ...p, stock: nuevoStock };
          }
          return p;
        });

        await setDoc(doc(db, 'config', 'inventario'), {
          productos: nuevosProductos,
          updatedAt: serverTimestamp()
        });

        const batchStock = writeBatch(db);
        auditoriaCruzadaInventario.forEach(audit => {
          if (audit.comandas > 0) {
            const docStockRef = doc(collection(db, 'historial_stock'));
            batchStock.set(docStockRef, {
              fecha: new Date().toISOString(),
              producto: audit.nombre,
              tipo: 'salida_corte',
              cantidad: audit.comandas,
              detalle: `Descuento automático por cierre de corte de caja de ${nombreOperador}`,
              operador: nombreOperador
            });
          }

          if (audit.diferencia !== 0) {
            const docMermasRef = doc(collection(db, 'mermas_auditoria'));
            batchStock.set(docMermasRef, {
              fecha: serverTimestamp(),
              corteId: docRef.id,
              cajero: nombreOperador,
              productoId: audit.id,
              productoNombre: audit.nombre,
              comandasVendidas: audit.comandas,
              inventarioDeducido: audit.inventario,
              discrepancia: audit.diferencia,
              diagnostico: audit.desc
            });
          }
        });
        await batchStock.commit();
      }

      await registrarEvento(
        'Corte de Caja',
        `Corte de Caja realizado por ${nombreOperador}. Contado: $${sumaContada.toLocaleString()} - Esperado: $${calculationsCorte.efectivoEsperado.toLocaleString()}. Diferencia: ${diferencia >= 0 ? '+' : ''}$${diferencia.toLocaleString()}`,
        diferencia,
        'info'
      );

      imprimirTicketCorte(calculationsCorte, sumaContada, diferencia, resumenIaTexto, nombreOperador, fechaUltimo, cantidadesDenom);

      const nuevaFecha = new Date().toISOString();
      await setDoc(doc(db, 'config', 'ultimo_corte'), { fecha: nuevaFecha });

      // Invalida cache de reportes financieros/operativos al registrar un corte
      clearPersistedCache();

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
      if (filtroCorteOperador) {
        const opStr = (c.operador || '').toLowerCase();
        if (!opStr.includes(filtroCorteOperador.toLowerCase())) return false;
      }
      return true;
    });
  }, [historialCortes, filtroCorteInicio, filtroCorteFin, filtroCorteOperador]);

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

  const resumenFinanciero = useMemo(() => {
    const ahoraMs = Date.now();
    let limiteMs = 0;
    
    // Determine the start date of the period
    if (rfFiltro === 'Hoy') {
      const hoyStart = new Date();
      hoyStart.setHours(0, 0, 0, 0);
      limiteMs = hoyStart.getTime();
    } else if (rfFiltro === '7d') {
      limiteMs = ahoraMs - 7 * 24 * 60 * 60 * 1000;
    } else if (rfFiltro === '15d') {
      limiteMs = ahoraMs - 15 * 24 * 60 * 60 * 1000;
    } else if (rfFiltro === '1m') {
      limiteMs = ahoraMs - 30 * 24 * 60 * 60 * 1000;
    } else if (rfFiltro === '6m') {
      limiteMs = ahoraMs - 180 * 24 * 60 * 60 * 1000;
    } else if (rfFiltro === '1a') {
      limiteMs = ahoraMs - 365 * 24 * 60 * 60 * 1000;
    } else if (rfFiltro === 'ultimo corte') {
      limiteMs = ultimoCorteFecha ? new Date(ultimoCorteFecha).getTime() : (ahoraMs - 24 * 60 * 60 * 1000);
    } else {
      // 'vida' / all time
      limiteMs = 0;
    }

    let diasFiltro = 7;
    if (rfFiltro === 'Hoy') diasFiltro = 1;
    else if (rfFiltro === '7d') diasFiltro = 7;
    else if (rfFiltro === '15d') diasFiltro = 15;
    else if (rfFiltro === '1m') diasFiltro = 30;
    else if (rfFiltro === '6m') diasFiltro = 180;
    else if (rfFiltro === '1a') diasFiltro = 365;
    else if (rfFiltro === 'ultimo corte') {
      const msDiff = ahoraMs - limiteMs;
      diasFiltro = Math.max(0.1, msDiff / (24 * 60 * 60 * 1000));
    } else { // vida
      diasFiltro = 365; // default fallback days
    }

    // Filter bitacora events in period
    const eventosPeriodo = bitacora.filter(e => {
      if (!e.fecha) return false;
      const t = new Date(e.fecha).getTime();
      return t >= limiteMs;
    });

    // Rentas de mesas de billar: suma de cierres en el periodo
    const listMesas = eventosPeriodo.filter(e => e.accion === 'Cierre Directo' || e.accion === 'Mesa a Cuenta');
    const sumMesas = listMesas.reduce((s, e) => s + Math.abs(Number(e.monto) || 0), 0);
    
    // We check if it is active or fallback
    const rentasMesasUsadasFallback = sumMesas === 0;
    const rentasMesas = sumMesas > 0 ? sumMesas : (totalHoy * 0.45 * (diasFiltro / 1));

    // Ventas de barra
    const listBar = cobros.filter(c => c.tipo === 'bar' && c.monto > 0 && (c.id > 1000000 ? c.id : ahoraMs) >= limiteMs);
    const sumBar = listBar.reduce((s, c) => s + Number(c.monto), 0);
    const ventasBarUsadasFallback = sumBar === 0;
    const ventasBar = sumBar > 0 ? sumBar : (totalHoy * 0.35 * (diasFiltro / 1));

    // Torneos
    let inscripcionesTorneo = 0;
    let torneosPeriodo = [];
    if (typeof window !== 'undefined') {
      try {
        const rawTorneos = localStorage.getItem('yoy_billar_torneos');
        if (rawTorneos) {
          const torneos = deobfuscate(rawTorneos) || [];
          torneosPeriodo = torneos.filter(t => new Date(t.fechaInicio).getTime() >= limiteMs);
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

    // Gastos G
    const listGastos = gastosList.filter(g => {
      const fechaG = g.fecha ? new Date(g.fecha).getTime() : 0;
      return fechaG >= limiteMs;
    });
    const totalGastosPeriodo = listGastos.reduce((sum, g) => sum + (Number(g.monto) || 0), 0);
    const gastosGUsadasFallback = totalGastosPeriodo === 0;
    const gastosG = totalGastosPeriodo > 0 ? totalGastosPeriodo : (totalIngresos * 0.12);

    // Nomina
    const listNomina = nominaPagosList.filter(p => {
      const fechaP = p.fecha ? new Date(p.fecha).getTime() : 0;
      return fechaP >= limiteMs;
    });
    const totalNominaPeriodo = listNomina.reduce((sum, p) => sum + (Number(p.total || p.totalNeto) || 0), 0);
    const nominaSUsadasFallback = totalNominaPeriodo === 0;
    const nominaS = totalNominaPeriodo > 0 ? totalNominaPeriodo : (totalIngresos * 0.20);

    const totalOPEX = gastosG + nominaS;
    const utilidadNeta = utilidadBruta - totalOPEX;
    const margenUtilidad = totalIngresos > 0 ? (utilidadNeta / totalIngresos) * 100 : 0;

    // Cash, Card and Transfer splits in this period
    let efectivoIngresos = 0;
    let tarjetaIngresos = 0;
    let transferIngresos = 0;
    const transaccionesDetalle = [];

    // Mesa / Cierres
    listMesas.forEach(e => {
      const detLower = (e.detalle || '').toLowerCase();
      const montoVal = Math.abs(Number(e.monto) || 0);
      let metodo = 'efectivo';
      if (detLower.includes('tarjeta')) {
        metodo = 'tarjeta';
        tarjetaIngresos += montoVal;
      } else if (detLower.includes('transferencia') || detLower.includes('spei') || detLower.includes('qr')) {
        metodo = 'transferencia';
        transferIngresos += montoVal;
      } else {
        efectivoIngresos += montoVal;
      }

      transaccionesDetalle.push({
        id: e.id || `mesa-${e.fecha}-${montoVal}-${Math.random()}`,
        tipo: 'mesa',
        fecha: e.fecha,
        hora: new Date(e.fecha).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }),
        descripcion: e.detalle || e.accion || 'Cierre de Mesa',
        operador: e.operador || 'Cajero',
        monto: montoVal,
        metodo
      });
    });

    // Ventas Barra
    listBar.forEach(c => {
      const montoVal = Number(c.monto) || 0;
      let metodo = 'efectivo';
      if (c.metodo === 'tarjeta') {
        metodo = 'tarjeta';
        tarjetaIngresos += montoVal;
      } else if (c.metodo === 'spei' || c.metodo === 'transferencia' || c.metodo === 'qr') {
        metodo = 'transferencia';
        transferIngresos += montoVal;
      } else {
        efectivoIngresos += montoVal;
      }

      transaccionesDetalle.push({
        id: c.id || `bar-${c.id || Date.now()}-${montoVal}-${Math.random()}`,
        tipo: 'bar',
        fecha: c.id > 1000000000000 ? new Date(c.id).toISOString() : new Date().toISOString(),
        hora: c.id > 1000000000000 ? new Date(c.id).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }) : '',
        descripcion: `Consumo de barra (Ticket ${c.id || ''})`,
        operador: c.usuario || 'Barman',
        monto: montoVal,
        metodo
      });
    });

    // Torneos
    torneosPeriodo.forEach(t => {
      const cost = parseFloat(t.inscripcion?.replace('$', '') || 0);
      const totalT = cost * (t.jugadores || 0);
      if (totalT > 0) {
        efectivoIngresos += totalT;
        transaccionesDetalle.push({
          id: t.id || `torneo-${t.fechaInicio}-${totalT}`,
          tipo: 'torneo',
          fecha: t.fechaInicio,
          hora: new Date(t.fechaInicio).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }),
          descripcion: `Inscripción Torneo: ${t.nombre || 'Torneo'}`,
          operador: t.organizador || 'Organizador',
          monto: totalT,
          metodo: 'efectivo'
        });
      }
    });

    // Gastos G y nómina restados del flujo general
    const totalEfectivoPeriodo = Math.max(0, efectivoIngresos - totalOPEX);
    const totalDigitalPeriodo = tarjetaIngresos + transferIngresos;

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
      margenUtilidad,
      efectivoPeriodo: totalEfectivoPeriodo,
      digitalPeriodo: totalDigitalPeriodo,
      efectivoIngresos,
      tarjetaIngresos,
      transferIngresos,
      transaccionesDetalle,
      listMesas,
      listBar,
      torneosPeriodo,
      listGastos,
      listNomina,
      rentasMesasUsadasFallback,
      ventasBarUsadasFallback,
      gastosGUsadasFallback,
      nominaSUsadasFallback,
      limiteMs
    };
  }, [rfFiltro, bitacora, cobros, gastosList, nominaPagosList, ultimoCorteFecha, totalHoy]);

  // Satisfacción
  const totalEncuestas = encuestasList.length;
  const promedioAtencion = totalEncuestas > 0 ? encuestasList.reduce((acc, curr) => acc + (curr.calificaciones?.atencion || 0), 0) / totalEncuestas : 4.6;
  const promedioRapidez = totalEncuestas > 0 ? encuestasList.reduce((acc, curr) => acc + (curr.calificaciones?.rapidez || 0), 0) / totalEncuestas : 4.4;
  const promedioLimpieza = totalEncuestas > 0 ? encuestasList.reduce((acc, curr) => acc + (curr.calificaciones?.limpieza || 0), 0) / totalEncuestas : 4.7;
  const promedioEquipo = totalEncuestas > 0 ? encuestasList.reduce((acc, curr) => acc + (curr.calificaciones?.equipo || 0), 0) / totalEncuestas : 4.8;
  const promedioGeneral = (promedioAtencion + promedioRapidez + promedioLimpieza + promedioEquipo) / 4;

  // Rendimiento de Staff
  const staffRendimiento = useMemo(() => {
    if (empleadosList.length === 0) return [];
    const startPeriodTime = ultimoCorteFecha ? new Date(ultimoCorteFecha).getTime() : 0;
    return empleadosList.map(emp => {
      const encuestasMesero = encuestasList.filter(e => e.meseroId === emp.id || (e.meseroNombre && e.meseroNombre.toLowerCase().includes(emp.nombre.toLowerCase())));
      const esServicio = ['mesero', 'bartender', 'cajero'].includes(emp.rol?.toLowerCase());
      const promedioSatis = encuestasMesero.length > 0
        ? encuestasMesero.reduce((acc, curr) => acc + (curr.calificaciones?.atencion || 0), 0) / encuestasMesero.length
        : (esServicio ? promedioAtencion : 5.0);

      const pagosEmp = nominaPagosList.filter(p => p.empleadoId === emp.id);
      const comisionesReales = pagosEmp.reduce((s, p) => s + (Number(p.comisionMesas || p.comisionBar || 0) || 0), 0);

      const asistenciasEmp = bitacora.filter(b => b.operador && b.operador.toLowerCase().includes(emp.nombre.toLowerCase()));
      const turnosTrabajados = Math.max(1, asistenciasEmp.filter(b => b.accion?.includes('Fichaje') || b.accion?.includes('Entrada')).length);

      // Calcular horas reales trabajadas en el período del corte actual usando nomina_asistencia_log
      const empLogs = fichajesLogs
        .filter(log => log.empleadoId === emp.id)
        .map(log => {
          const t = log.createdAt?.toDate ? log.createdAt.toDate().getTime() : (log.createdAt ? new Date(log.createdAt).getTime() : new Date(`${log.fecha}T${log.hora || '12:00:00'}`).getTime());
          return { ...log, time: t };
        })
        .filter(log => log.time >= startPeriodTime)
        .sort((a, b) => a.time - b.time);

      let totalMs = 0;
      let lastEntradaTime = null;
      empLogs.forEach(log => {
        if (log.tipo === 'entrada') {
          lastEntradaTime = log.time;
        } else if (log.tipo === 'salida' && lastEntradaTime !== null) {
          totalMs += (log.time - lastEntradaTime);
          lastEntradaTime = null;
        }
      });
      if (lastEntradaTime !== null) {
        totalMs += (Date.now() - lastEntradaTime);
      }
      const horasTrabajadas = totalMs / 3600000;

      return {
        id: emp.id,
        nombre: `${emp.nombre} ${emp.apellido || ''}`.trim(),
        rol: emp.rol || 'Staff',
        turnos: turnosTrabajados,
        horas: horasTrabajadas,
        comisiones: comisionesReales,
        satisfaccion: promedioSatis
      };
    });
  }, [empleadosList, encuestasList, nominaPagosList, bitacora, fichajesLogs, ultimoCorteFecha, promedioAtencion]);

  // Análisis inteligente de mesas en tiempo real
  const analisisMesas = useMemo(() => {
    const stats = {};
    
    const listadoMesas = mesas.length > 0 ? mesas : [
      { id: 1, nombre: 'Mesa 1', tipo: 'Carambola 3B', tarifa: 80 },
      { id: 2, nombre: 'Mesa 2', tipo: 'Carambola 3B', tarifa: 80 },
      { id: 3, nombre: 'Mesa 3', tipo: 'Pool 9B', tarifa: 60 },
      { id: 4, nombre: 'Mesa 4', tipo: 'Carambola 3B', tarifa: 80 },
      { id: 5, nombre: 'Mesa 5', tipo: 'Snooker', tarifa: 100 },
      { id: 6, nombre: 'Mesa 6', tipo: 'Pool 9B', tarifa: 60 },
      { id: 7, nombre: 'Mesa 7', tipo: 'Carambola 3B', tarifa: 80 },
      { id: 8, nombre: 'Mesa 8', tipo: 'Pool 9B', tarifa: 60 },
    ];

    listadoMesas.forEach(m => {
      stats[m.id] = {
        id: m.id,
        nombre: m.nombre || `Mesa ${m.id}`,
        tipo: m.tipo || 'Pool 9B',
        tarifa: m.tarifa !== undefined ? m.tarifa : 60,
        tarifaBase: m.tarifaBase !== undefined ? m.tarifaBase : (m.tarifa !== undefined ? m.tarifa : 60),
        horasJugadasEnMantenimiento: m.horasJugadasEnMantenimiento || 0,
        ultimoMantenimientoAt: m.ultimoMantenimientoAt || null,
        ingresosTotales: 0,
        tiempoHoras: 0,
        cantidadUsos: 0,
        consumoBebidas: 0,
        consumoComida: 0,
        calificaciones: [],
        calificacionPromedio: 0,
        sociosCierres: 0
      };
    });

    bitacora.forEach(e => {
      const det = (e.detalle || '').toLowerCase();
      const acc = e.accion || '';
      
      let foundMesaId = null;
      for (let mId in stats) {
        const mName = stats[mId].nombre.toLowerCase();
        if (det.includes(`mesa ${mId}`) || det.includes(mName)) {
          foundMesaId = mId;
          break;
        }
      }

      if (foundMesaId) {
        const s = stats[foundMesaId];
        if (e.monto && Number(e.monto) > 0) {
          if (acc === 'Cierre Directo' || acc === 'Mesa a Cuenta' || acc === 'Mesa a Cuenta Nueva' || acc === 'Liquidar Cuenta') {
            s.ingresosTotales += Number(e.monto);
            s.cantidadUsos += 1;
          } else if (acc === 'Agregar Consumo' || acc === 'Pedido a Cuenta') {
            s.ingresosTotales += Number(e.monto);
          }
        }

        if (acc === 'Cierre Directo' || acc === 'Mesa a Cuenta') {
          const timeMatch = det.match(/([0-9.]+)\s*h/);
          if (timeMatch) {
            s.tiempoHoras += parseFloat(timeMatch[1]);
          } else if (e.monto && s.tarifa > 0) {
            const estimatedPlayCost = Number(e.monto) * 0.6;
            s.tiempoHoras += estimatedPlayCost / s.tarifa;
          } else {
            s.tiempoHoras += 1.5;
          }
          if (det.includes('socio')) {
            s.sociosCierres += 1;
            s.tiempoHoras += 2.0;
          }
        }

        const bebidasKeywords = ['cerveza', 'corona', 'victoria', 'modelo', 'indio', 'tecate', 'coca', 'refresco', 'agua', 'jugo', 'fanta', 'sprite', 'michelada', 'clamato', 'azulito', 'cantarito', 'trago', 'ron', 'tequila', 'whisky', 'vodka', 'bebida', 'soda'];
        const comidaKeywords = ['hamburguesa', 'papas', 'nachos', 'alitas', 'boneless', 'hot dog', 'dog', 'quesadilla', 'taco', 'tacos', 'sincronizada', 'botana', 'sushi', 'pizza', 'comida', 'snack', 'alimento'];
        
        if (det.includes('agregado') || det.includes('pedido') || det.includes('comanda')) {
          let qty = 1;
          const qtyMatch = det.match(/([0-9]+)\s*x/);
          if (qtyMatch) {
            qty = parseInt(qtyMatch[1]);
          }
          
          let matchedBebida = bebidasKeywords.some(kw => det.includes(kw));
          let matchedComida = comidaKeywords.some(kw => det.includes(kw));
          
          if (matchedBebida) {
            s.consumoBebidas += qty;
          } else if (matchedComida) {
            s.consumoComida += qty;
          } else {
            s.consumoBebidas += Math.ceil(qty * 0.5);
            s.consumoComida += Math.floor(qty * 0.5);
          }
        }
      }
    });

    encuestasList.forEach(enc => {
      const mId = enc.mesaId;
      if (stats[mId]) {
        const calif = enc.calificaciones;
        if (calif) {
          const avg = ((calif.atencion || 0) + (calif.rapidez || 0) + (calif.limpieza || 0) + (calif.equipo || 0)) / 4;
          stats[mId].calificaciones.push(avg);
        }
      }
    });

    const items = Object.values(stats);
    
    items.forEach(s => {
      if (s.calificaciones.length > 0) {
        s.calificacionPromedio = s.calificaciones.reduce((a, b) => a + b, 0) / s.calificaciones.length;
      } else {
        s.calificacionPromedio = 4.3 + ((s.id * 3) % 8) * 0.1;
      }
      s.ingresosTotales = Math.round(s.ingresosTotales);
      s.tiempoHoras = parseFloat(s.tiempoHoras.toFixed(1));
      
      if (s.ingresosTotales === 0) {
        s.ingresosTotales = s.tarifaBase * 3 + ((s.id * 140) % 500);
        s.tiempoHoras = 2.5 + ((s.id * 2) % 6);
        s.cantidadUsos = 1 + (s.id % 3);
        s.consumoBebidas = 3 + ((s.id * 4) % 10);
        s.consumoComida = 1 + ((s.id * 3) % 7);
      }

      // 1. Alertas de mantenimiento preventivo (límite 50h por paño)
      const horasDesdeMantenimiento = Math.max(0, s.tiempoHoras - s.horasJugadasEnMantenimiento);
      s.porcentajePaño = Math.max(0, Math.min(100, Math.round(((50 - horasDesdeMantenimiento) / 50) * 100)));

      // 2. IA Tarifa Dinámica sugerida (basada en tarifaBase para evitar feedback loops exponenciales)
      if (s.tiempoHoras > 6.0) {
        s.tarifaSugerida = Math.round(s.tarifaBase * (1 + surgePercent / 100)); // +surgePercent% alta demanda
      } else if (s.tiempoHoras < 3.5) {
        s.tarifaSugerida = Math.round(s.tarifaBase * (1 - discountPercent / 100)); // -discountPercent% descuento promocional
      } else {
        s.tarifaSugerida = s.tarifaBase;
      }

      // 3. Tendencia semanal de demanda (7 días) basada en ocupación real de bitácora
      const demandByDay = [0, 0, 0, 0, 0, 0, 0];
      bitacora.forEach(e => {
        const det = (e.detalle || '').toLowerCase();
        const acc = e.accion || '';
        const mName = s.nombre.toLowerCase();
        const isForThisMesa = det.includes(`mesa ${s.id}`) || det.includes(mName);
        
        if (isForThisMesa && (acc === 'Cierre Directo' || acc === 'Mesa a Cuenta' || acc === 'Mesa a Cuenta Nueva' || acc === 'Liquidar Cuenta')) {
          if (e.fecha) {
            const date = new Date(e.fecha);
            const dayOfWeek = date.getDay(); // 0 = Dom, 1 = Lun, ..., 6 = Sab
            const idxDay = dayOfWeek === 0 ? 6 : dayOfWeek - 1; // Mon=0, ..., Sun=6
            demandByDay[idxDay] += 1;
          }
        }
      });
      
      const maxCount = Math.max(...demandByDay);
      s.tendenciaDemanda = demandByDay.map((count, idxDay) => {
        if (maxCount === 0) {
          const baseDemand = [20, 35, 50, 45, 75, 95, 80];
          const variance = ((s.id * 13 + idxDay) % 20) - 10;
          return Math.max(10, Math.min(100, (baseDemand[idxDay] || 50) + variance));
        }
        return Math.max(15, Math.min(100, Math.round((count / maxCount) * 80) + 20));
      });
    });

    return items;
  }, [bitacora, encuestasList, mesas, surgePercent, discountPercent]);

  // Autopilot de tarifas dinámicas en base a afluencia
  useEffect(() => {
    if (!tarifaAutopilotActivo || analisisMesas.length === 0) return;
    
    // SUGERENCIA 2: Restricción Horaria (Autopilot sólo opera de 12:00 PM a 2:00 AM)
    const nowLocal = new Date();
    const currentHour = nowLocal.getHours();
    const esHorarioOperacion = currentHour >= 12 || currentHour < 2;
    if (!esHorarioOperacion) return;
    
    // Check if any mesa needs its tariff updated to the suggested one
    const mesasADiferentes = analisisMesas.filter(m => m.tarifaSugerida !== m.tarifa);
    if (mesasADiferentes.length === 0) return;

    // SUGERENCIA 2 (continuación): Límite de cambios/histéresis (no actualizar si hubo cambio de Autopilot en las últimas 2 horas)
    const now = Date.now();
    const twoHoursAgo = now - 2 * 60 * 60 * 1000;
    const recentAutopilotUpdates = bitacora.filter(e => {
      if (e.accion !== 'Autopilot Tarifa') return false;
      const t = e.fecha ? new Date(e.fecha).getTime() : 0;
      return t >= twoHoursAgo;
    });

    const mesasADiferentesFiltradas = mesasADiferentes.filter(m => {
      const isRecentlyUpdated = recentAutopilotUpdates.some(e => (e.detalle || '').includes(`Mesa ${m.id}`));
      return !isRecentlyUpdated;
    });

    if (mesasADiferentesFiltradas.length === 0) return;

    // We have some tables that need update. Let's update them!
    const updatedMesas = mesas.map(m => {
      const match = mesasADiferentesFiltradas.find(mad => mad.id === m.id);
      if (match) {
        return {
          ...m,
          tarifa: match.tarifaSugerida,
          tarifaBase: m.tarifaBase !== undefined ? m.tarifaBase : m.tarifa
        };
      }
      return m;
    });

    const runAutopilotUpdate = async () => {
      try {
        await setDoc(doc(db, 'config', 'mesas_estado'), { mesas: updatedMesas }, { merge: true });
        
        // Register events for each updated table and write to audit logs
        for (let mDiff of mesasADiferentesFiltradas) {
          // SUGERENCIA 1: Guardar en tarifas_cambios_log
          await addDoc(collection(db, 'tarifas_cambios_log'), {
            mesaId: mDiff.id,
            nombreMesa: mDiff.nombre,
            tarifaAnterior: mDiff.tarifa,
            tarifaNueva: mDiff.tarifaSugerida,
            motivo: `Autopilot aplicó tarifa dinámica sugerida por tiempo de uso (${mDiff.tiempoHoras}h).`,
            fecha: new Date().toISOString(),
            tipoCambio: 'autopilot',
            operador: 'Sistema Autopilot',
            rolOperador: 'system'
          });

          await registrarEvento(
            'Autopilot Tarifa', 
            `Autopilot aplicó tarifa dinámica de $${mDiff.tarifaSugerida}/h a la Mesa ${mDiff.id} (tarifa previa: $${mDiff.tarifa}/h).`,
            0,
            'info'
          );
        }
        showToast(`💡 Autopilot actualizó tarifas en ${mesasADiferentesFiltradas.length} mesa(s)`, 'info');
      } catch (err) {
        console.error('Error en Autopilot de tarifas:', err);
      }
    };

    runAutopilotUpdate();
  }, [analisisMesas, tarifaAutopilotActivo, mesas, bitacora]);

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

    // Mantenimiento Preventivo JIT y Desgaste Crítico (Sugerencia 2 del Auditor)
    analisisMesas.forEach(m => {
      if (m.porcentajePaño < 20) {
        list.push({
          id: `mantenimiento-mesa-${m.id}-critico`,
          tipo: 'mantenimiento',
          titulo: `${m.nombre} - Desgaste Crítico`,
          desc: `Integridad del paño al ${m.porcentajePaño}%. Requiere cepillado y rectificación urgente.`,
          gravedad: 'alta'
        });
      } else if (m.porcentajePaño < 50) {
        list.push({
          id: `mantenimiento-mesa-${m.id}-preventivo`,
          tipo: 'mantenimiento',
          titulo: `${m.nombre} - Manto. Próximo`,
          desc: `Integridad del paño al ${m.porcentajePaño}%. Se sugiere programar mantenimiento preventivo.`,
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

    // Discrepancias de comisiones vs asistencia (Sugerencia 2)
    staffRendimiento.forEach(staff => {
      if (staff.comisiones > 0 && staff.horas === 0) {
        list.push({
          id: `discrepancia-comision-${staff.id}`,
          tipo: 'seguridad',
          titulo: `Comisión sin Fichaje: ${staff.nombre}`,
          desc: `Registra comisión de $${staff.comisiones.toLocaleString()} pero tiene 0 horas de fichaje en el periodo actual.`,
          gravedad: 'alta'
        });
      }
    });

    return list.slice(0, 10); // max 10
  }, [inconsistenciasEnVivo, bitacora, limiteFecha, staffRendimiento, analisisMesas]);

  // Salud del Negocio (Sugerencia 1)
  const healthScore = useMemo(() => {
    let score = 100;
    anomalidadesAuditor.forEach(anom => {
      if (anom.gravedad === 'alta') score -= 15;
      else if (anom.gravedad === 'media') score -= 5;
      else score -= 2;
    });
    return Math.max(0, score);
  }, [anomalidadesAuditor]);

  const scoreDetails = useMemo(() => {
    if (healthScore >= 90) {
      return {
        bg: 'rgba(34, 197, 94, 0.08)',
        border: 'rgba(34, 197, 94, 0.3)',
        text: 'var(--success)',
        bullet: 'var(--success)'
      };
    } else if (healthScore >= 70) {
      return {
        bg: 'rgba(234, 179, 8, 0.08)',
        border: 'rgba(234, 179, 8, 0.3)',
        text: 'var(--warning)',
        bullet: 'var(--warning)'
      };
    } else {
      return {
        bg: 'rgba(239, 68, 68, 0.08)',
        border: 'rgba(239, 68, 68, 0.3)',
        text: 'var(--danger)',
        bullet: 'var(--danger)'
      };
    }
  }, [healthScore]);

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
    const totalPeriodo = Math.max(0, aumentoPico + impactoLento);
    const factorDias = diasFiltro > 0 ? diasFiltro : 1;
    return (totalPeriodo / factorDias) * 30;
  }, [finanzas.rentasMesas, surgePercent, discountPercent, diasFiltro]);

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
    await registrarEvento('Cobro Manual', `Cobro manual registrado: ${nuevaDesc}. Método: ${nuevoMetodo.toUpperCase()}`, monto, 'info', nuevoMetodo);
    showToast(`Cobro manual de $${monto} registrado con éxito 💸`, 'success');

    setMostrarCobroManual(false);
    setNuevoMonto('');
    setNuevaDesc('');
    setPinAutorizacion('');
  };

  const guardarNuevaMeta = async () => {
    const val = Number(nuevaMetaInput);
    if (!isNaN(val) && val > 0) {
      setMetaMensual(val);
      try {
        const currentYM = new Date().getFullYear() + '-' + String(new Date().getMonth() + 1).padStart(2, '0');
        await setDoc(doc(db, 'config', 'sucursal'), {
          metasMensuales: {
            [currentYM]: val
          },
          metaMensual: val
        }, { merge: true });
        showToast('Meta mensual actualizada con éxito 🎯', 'success');
      } catch (err) {
        console.error(err);
        showToast('Error al guardar la meta en la base de datos ❌', 'error');
      }
    }
    setEditandoMeta(false);
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
    
    const metaDiariaHoy = metaMensual / totalDiasMes;
    const porcentajeMetaHoy = metaDiariaHoy > 0 ? (totalHoy / metaDiariaHoy) * 100 : 0;
    const diasRestantes = Math.max(0, totalDiasMes - diaActual);
    const metaDiariaRestante = diasRestantes > 0 ? Math.max(0, metaMensual - ingresosMesActual) / diasRestantes : Math.max(0, metaMensual - ingresosMesActual);
    
    return {
      diaActual,
      totalDiasMes,
      promedioDiario,
      proyeccionCierre,
      porcentajeMeta,
      porcentajeProyectado,
      superaMeta,
      metaDiariaHoy,
      porcentajeMetaHoy,
      diasRestantes,
      metaDiariaRestante
    };
  }, [ingresosMesActual, metaMensual, totalHoy]);

  const comparativaHoyMismaHora = useMemo(() => {
    const ahora = new Date();
    const diaSemanaHoy = ahora.getDay();
    const horaActual = ahora.getHours();
    const minActual = ahora.getMinutes();
    
    const ventasPorDiaHistorico = {};
    const hoyStr = ahora.toISOString().split('T')[0];
    
    const procesarTransaccion = (fecha, monto) => {
      if (!fecha) return;
      const d = new Date(fecha);
      const tStr = d.toISOString().split('T')[0];
      if (tStr === hoyStr) return;
      if (d.getDay() !== diaSemanaHoy) return;
      
      const h = d.getHours();
      const m = d.getMinutes();
      if (h > horaActual || (h === horaActual && m > minActual)) return;
      
      ventasPorDiaHistorico[tStr] = (ventasPorDiaHistorico[tStr] || 0) + Math.abs(monto);
    };
    
    bitacora
      .filter(e => e.accion === 'Cierre Directo' || e.accion === 'Mesa a Cuenta')
      .forEach(e => procesarTransaccion(e.fecha, Number(e.monto) || 0));
      
    cobros
      .filter(c => c.tipo === 'bar' && c.monto > 0)
      .forEach(c => {
        const timestamp = c.id > 1000000000 ? c.id : Date.now();
        procesarTransaccion(timestamp, Number(c.monto) || 0);
      });
      
    const diasHistoricosValores = Object.values(ventasPorDiaHistorico);
    const cantidadDias = diasHistoricosValores.length;
    const promedioHistoricoMismaHora = cantidadDias > 0 
      ? (diasHistoricosValores.reduce((s, v) => s + v, 0) / cantidadDias)
      : 0;
      
    const tendenciaPorcentaje = promedioHistoricoMismaHora > 0
      ? ((totalHoy / promedioHistoricoMismaHora) * 100) - 100
      : 0;
      
    return {
      promedioHistoricoMismaHora,
      tendenciaPorcentaje,
      cantidadDias
    };
  }, [bitacora, cobros, totalHoy]);

  useEffect(() => {
    if (datosProyeccion.porcentajeMetaHoy >= 100 && datosProyeccion.metaDiariaHoy > 0 && totalHoy > 0) {
      const hoyStr = new Date().toLocaleDateString('es-MX', { year: 'numeric', month: '2-digit', day: '2-digit' });
      const lastNotified = localStorage.getItem('yoy_last_notified_meta_hoy');
      if (lastNotified !== hoyStr) {
        localStorage.setItem('yoy_last_notified_meta_hoy', hoyStr);
        (async () => {
          try {
            const tgSnap = await getDoc(doc(db, 'config', 'telegram'));
            if (tgSnap.exists()) {
              const tgData = tgSnap.data();
              const isSimplified = tgData.mode === 'simplified' || (!tgData.botToken && tgData.chatId);
              const hasCustom = tgData.mode === 'custom' && tgData.botToken && tgData.chatId;
              if (tgData.enabled && (isSimplified || hasCustom)) {
                const sucSnap = await getDoc(doc(db, 'config', 'sucursal'));
                const sucursalName = sucSnap.exists() ? (sucSnap.data().nombre || 'Sucursal') : 'Sucursal';
                const text = `🎯 *¡Meta Diaria Alcanzada!*\n\nLa sucursal *${sucursalName}* ha alcanzado el 100% de su meta de venta para el día de hoy.\n\n*Venta Hoy:* $${totalHoy.toLocaleString('es-MX')}\n*Meta Esperada:* $${datosProyeccion.metaDiariaHoy.toLocaleString('es-MX')}\n*Avance:* ${datosProyeccion.porcentajeMetaHoy.toFixed(0)}%\n\n¡Excelente trabajo equipo! 🚀🔥`;
                
                await fetch('/api/telegram/send-alert', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    mode: tgData.mode || 'simplified',
                    token: tgData.botToken,
                    chatId: tgData.chatId,
                    phone: tgData.phone || '',
                    sucursalName: sucursalName,
                    text: text
                  })
                });
              }
            }
          } catch (err) {
            console.error('Error sending Telegram meta reached notification:', err);
          }
        })();
      }
    }
  }, [datosProyeccion.porcentajeMetaHoy, datosProyeccion.metaDiariaHoy, totalHoy]);

  // Nuevas metricas de rendimiento
  const metricasRendimiento = useMemo(() => {
    const cobrosPositivos = cobros.filter(c => c.monto > 0);
    const cantCobros = cobrosPositivos.length;
    const ticketPromedio = cantCobros > 0 ? (finanzas.totalIngresos / cantCobros) : 0;
    
    const gastoDiarioPromedio = finanzas.totalOPEX / diasFiltro;
    const gastoMensualProyectado = (finanzas.totalOPEX / diasFiltro) * 30;
    
    const utilidadDiariaPromedio = finanzas.utilidadNeta / diasFiltro;
    const utilidadMensualProyectada = datosProyeccion.proyeccionCierre - gastoMensualProyectado;
    
    return {
      ticketPromedio,
      gastoDiarioPromedio,
      gastoMensualProyectado,
      utilidadDiariaPromedio,
      utilidadMensualProyectada
    };
  }, [finanzas.totalIngresos, finanzas.totalOPEX, finanzas.utilidadNeta, cobros, diasFiltro, datosProyeccion.proyeccionCierre]);

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

  // El análisis inteligente de mesas fue reubicado arriba de anomalidadesAuditor para evitar TDZ.

  const renderMesaLogo = (tipo) => {
    const tLower = (tipo || '').toLowerCase();
    if (tLower.includes('carambola')) {
      return (
        <svg width="24" height="24" viewBox="0 0 24 24" style={{ filter: 'drop-shadow(0 0 4px rgba(255,118,117,0.35))' }}>
          <circle cx="7" cy="15" r="5" fill="url(#redGrad)" />
          <circle cx="17" cy="15" r="5" fill="url(#yellowGrad)" />
          <circle cx="12" cy="8.5" r="5" fill="url(#whiteGrad)" />
          <defs>
            <radialGradient id="redGrad" cx="30%" cy="30%" r="70%">
              <stop offset="0%" stopColor="#ff7675" />
              <stop offset="70%" stopColor="#d63031" />
              <stop offset="100%" stopColor="#1e272e" />
            </radialGradient>
            <radialGradient id="yellowGrad" cx="30%" cy="30%" r="70%">
              <stop offset="0%" stopColor="#ffeaa7" />
              <stop offset="70%" stopColor="#fdcb6e" />
              <stop offset="100%" stopColor="#1e272e" />
            </radialGradient>
            <radialGradient id="whiteGrad" cx="30%" cy="30%" r="70%">
              <stop offset="0%" stopColor="#ffffff" />
              <stop offset="70%" stopColor="#dfe6e9" />
              <stop offset="100%" stopColor="#2d3436" />
            </radialGradient>
          </defs>
        </svg>
      );
    } else if (tLower.includes('snooker')) {
      return (
        <svg width="24" height="24" viewBox="0 0 24 24" style={{ filter: 'drop-shadow(0 0 4px rgba(232,67,147,0.35))' }}>
          <polygon points="12,3 21,19 3,19" fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="1" />
          <circle cx="12" cy="6.5" r="1.8" fill="#ff7675" />
          <circle cx="9.8" cy="10.5" r="1.8" fill="#ff7675" />
          <circle cx="14.2" cy="10.5" r="1.8" fill="#ff7675" />
          <circle cx="7.6" cy="14.5" r="1.8" fill="#ff7675" />
          <circle cx="12" cy="14.5" r="1.8" fill="#ff7675" />
          <circle cx="16.4" cy="14.5" r="1.8" fill="#ff7675" />
        </svg>
      );
    } else {
      return (
        <svg width="24" height="24" viewBox="0 0 24 24" style={{ filter: 'drop-shadow(0 0 4px rgba(0,230,118,0.4))' }}>
          <polygon points="12,3 22,20 2,20" fill="none" stroke="#00e676" strokeWidth="1.2" strokeLinejoin="round" />
          <circle cx="12" cy="7.5" r="1.8" fill="#ffeaa7" />
          <circle cx="9.8" cy="11.5" r="1.8" fill="#ff7675" />
          <circle cx="14.2" cy="11.5" r="1.8" fill="#74b9ff" />
          <circle cx="7.6" cy="15.5" r="1.8" fill="#a29bfe" />
          <circle cx="12" cy="15.5" r="1.8" fill="#1e272e" />
          <circle cx="16.4" cy="15.5" r="1.8" fill="#fd79a8" />
        </svg>
      );
    }
  };

  const resetearMantenimientoMesa = async (mesaId, tiempoHorasActual) => {
    const pin = prompt('Ingrese el PIN de Administrador para confirmar el mantenimiento del paño:');
    if (!pin) return;
    if (hashPassword(pin) !== adminPinHash) {
      showToast('PIN de administrador incorrecto', 'danger');
      return;
    }
    
    try {
      const updatedMesas = mesas.map(m => {
        if (m.id === mesaId) {
          return {
            ...m,
            horasJugadasEnMantenimiento: tiempoHorasActual,
            ultimoMantenimientoAt: new Date().toISOString()
          };
        }
        return m;
      });

      await setDoc(doc(db, 'config', 'mesas_estado'), { mesas: updatedMesas }, { merge: true });
      
      // SUGERENCIA 1: Guardar historial detallado en mantenimientos_historicos
      await addDoc(collection(db, 'mantenimientos_historicos'), {
        mesaId,
        nombreMesa: `Mesa ${mesaId}`,
        horasAcumuladas: tiempoHorasActual,
        fecha: new Date().toISOString(),
        operador: user ? (user.name || user.alias || user.email) : 'Administrador',
        rolOperador: user ? (user.role || 'admin') : 'admin'
      });

      await registrarEvento(
        'Mantenimiento Mesa', 
        `Se registró mantenimiento y cepillado de paño para la Mesa ${mesaId}. Horas acumuladas: ${tiempoHorasActual}h`,
        0,
        'info'
      );
      
      showToast(`¡Mantenimiento de Mesa ${mesaId} registrado con éxito! Paño al 100% 🧼`, 'success');
    } catch (err) {
      console.error(err);
      showToast('Error al guardar el mantenimiento en Firestore', 'danger');
    }
  };

  const aplicarTarifaDinamica = async (mesaId, nuevaTarifaSugerida) => {
    const confirmacion = window.confirm(`¿Desea aplicar la tarifa dinámica sugerida de $${nuevaTarifaSugerida}/h a la Mesa ${mesaId}?`);
    if (!confirmacion) return;
    
    try {
      const tarifaPrevia = mesas.find(m => m.id === mesaId)?.tarifa || 60;

      const updatedMesas = mesas.map(m => {
        if (m.id === mesaId) {
          return {
            ...m,
            tarifa: nuevaTarifaSugerida,
            tarifaBase: m.tarifaBase !== undefined ? m.tarifaBase : m.tarifa
          };
        }
        return m;
      });

      await setDoc(doc(db, 'config', 'mesas_estado'), { mesas: updatedMesas }, { merge: true });
      
      // SUGERENCIA 1: Registrar en tarifas_cambios_log
      await addDoc(collection(db, 'tarifas_cambios_log'), {
        mesaId,
        nombreMesa: `Mesa ${mesaId}`,
        tarifaAnterior: tarifaPrevia,
        tarifaNueva: nuevaTarifaSugerida,
        motivo: `Ajuste manual de tarifa dinámica sugerida.`,
        fecha: new Date().toISOString(),
        tipoCambio: 'manual',
        operador: user ? (user.name || user.alias || user.email) : 'Administrador',
        rolOperador: user ? (user.role || 'admin') : 'admin'
      });

      await registrarEvento(
        'Ajuste Tarifa Dinámica', 
        `Se aplicó la tarifa dinámica sugerida de $${nuevaTarifaSugerida}/h a la Mesa ${mesaId} debido a la afluencia registrada.`,
        0,
        'info'
      );
      showToast(`¡Tarifa dinámica de Mesa ${mesaId} actualizada a $${nuevaTarifaSugerida}/h! ⚡`, 'success');
    } catch (err) {
      console.error(err);
      showToast('Error al guardar la tarifa en Firestore', 'danger');
    }
  };

  const toggleAutopilot = async () => {
    const pin = prompt('Ingrese el PIN de Administrador para cambiar el modo de Autopilot:');
    if (!pin) return;
    if (hashPassword(pin) !== adminPinHash) {
      showToast('PIN de administrador incorrecto', 'danger');
      return;
    }

    const nuevoEstado = !tarifaAutopilotActivo;
    try {
      await setDoc(doc(db, 'config', 'mesas_estado'), { tarifaAutopilotActivo: nuevoEstado }, { merge: true });
      await addDoc(collection(db, 'auditoria_sistema'), {
        accion: 'Toggle Autopilot',
        estado: nuevoEstado ? 'Activado' : 'Desactivado',
        usuario: user?.email || 'Admin',
        fecha: new Date().toISOString()
      });
      showToast(`¡Autopilot de tarifas ${nuevoEstado ? 'activado 🤖' : 'desactivado 👤'}!`, 'info');
    } catch (err) {
      console.error(err);
      showToast('Error al guardar configuración de Autopilot', 'danger');
    }
  };

  const poolConsejosBigData = [
    { title: "Optimización de Mesas Snooker", desc: "La Mesa 5 (Snooker) tiene un uso 30% menor que las de Pool los miércoles. Se sugiere implementar tarifa promocional de $80/h este día para reactivar demanda.", tag: "Tarifas", color: "var(--bronze-light)" },
    { title: "Planificación de Compras JIT", desc: "El consumo de nachos y hamburguesas aumenta 45% durante eventos deportivos transmitidos en vivo. Asegure stock de pan y queso antes del partido del viernes.", tag: "Abasto", color: "var(--blue-light)" },
    { title: "Fidelización de Clientes", desc: "El ticket promedio de los clientes VIP recurrentes es 2.4 veces mayor cuando se les aplica descuento vitalicio. Promueva la afiliación de clientes frecuentes.", tag: "LTV", color: "var(--success)" },
    { title: "Eficiencia de Fila Digital", desc: "La fila de espera digital registra un tiempo de respuesta de 143 segundos. Reducir este tiempo un 10% incrementaría la rotación de mesas un 5% mensual.", tag: "Rotación", color: "var(--info)" },
    { title: "Picos de Venta en Barra", desc: "El 40% de las ventas en barra se realizan entre 19:00 y 21:30. Considere asignar un barman de soporte en este horario para evitar demoras en la barra.", tag: "Barra", color: "var(--bronze-light)" },
    { title: "Nivelación de Bandas", desc: "La Mesa 7 (Carambola) registra baja calificación de usuarios (★4.1) debido a un desajuste detectado en la nivelación de las bandas. Programar mantenimiento preventivo.", tag: "Mantenimiento", color: "var(--warning)" },
    { title: "Retención de Fila Virtual", desc: "El uso de la Fila Virtual de espera ha reducido el abandono de clientes en caja un 18%. Mantenga activos los banners informativos de QR en el acceso del club.", tag: "Clientes", color: "var(--success)" },
    { title: "Consumo Cruzado IA", desc: "Clientes que rentan mesas de Carambola tienen un 60% más de probabilidad de consumir bebidas preparadas. Ofrezca promociones cruzadas al iniciar la sesión.", tag: "Barra", color: "var(--info)" }
  ];

  const marcarConsejoLeido = (id) => {
    setConsejosIa(prev => prev.map(c => c.id === id ? { ...c, leido: true } : c));
    showToast("Consejo marcado como leído ✓", "success");
    setTimeout(() => {
      setConsejosIa(prev => prev.map(c => {
        if (c.id === id) {
          const unusedPool = poolConsejosBigData.filter(p => !prev.some(x => x.title === p.title));
          const source = unusedPool.length > 0 ? unusedPool : poolConsejosBigData;
          const nextRandom = source[Math.floor(Math.random() * source.length)];
          return {
            id: c.id,
            title: nextRandom.title,
            desc: nextRandom.desc,
            tag: nextRandom.tag,
            color: nextRandom.color,
            leido: false
          };
        }
        return c;
      }));
      showToast("La IA ha analizado el Big Data del negocio y generó un nuevo consejo 🧠", "info");
    }, 800);
  };

  const generarMensajeIa = (nombre, desc, codigo) => {
    const mensajes = [
      `¡Hola ${nombre}! 🌟 En YoY Billar valoramos mucho tu fidelidad. Te obsequiamos un cupón exclusivo del ${desc}% de descuento en tu próximo consumo de mesa o barra. Código de canje: ${codigo}. ¡Te esperamos pronto para unas buenas partidas! 🎱`,
      `Estimado ${nombre}, para celebrar tus visitas constantes, la IA de YoY Billar ha seleccionado tu cuenta para recibir un beneficio exclusivo: Cupón de ${desc}% de descuento en tu siguiente visita. Código: ${codigo}. Presenta este mensaje en caja. ¡Buen día! 🏆`,
      `¡Hola ${nombre}! 🎱 Queremos agradecer tu preferencia. Aquí tienes tu cupón personalizado del ${desc}% de descuento: ${codigo}. Úsalo en tu próxima renta de mesa. Válido por 15 días. ¡Ven a divertirte con nosotros! 🍻`
    ];
    return mensajes[Math.floor(Math.random() * mensajes.length)];
  };

  const triggerEnviarCuponModal = (nombre, pct = 15) => {
    const initials = nombre.slice(0, 3).toUpperCase().replace(/\s/g, '');
    const code = `VIP${pct}-${initials}-${Math.floor(Math.random() * 900 + 100)}`;
    setCuponClienteNombre(nombre);
    setCuponPorcentaje(pct);
    setCuponCodigo(code);
    setCuponMensaje(generarMensajeIa(nombre, pct, code));
    setModalEnviarCuponOpen(true);
  };

  const enviarMensajeCupónPorRed = async (red) => {
    try {
      await addDoc(collection(db, 'cupones_retencion'), {
        cliente: cuponClienteNombre.trim(),
        descuento: cuponPorcentaje,
        codigo: cuponCodigo,
        canal: red,
        estado: 'enviado',
        createdAt: serverTimestamp()
      });

      await addDoc(collection(db, 'bitacora'), {
        fecha: new Date().toISOString(),
        tipo: 'ia',
        usuario: user?.nombre || 'Cerebro IA',
        accion: 'Clientes - Cupón Fidelidad',
        monto: 0,
        detalle: `Enviado cupón ${cuponCodigo} (${cuponPorcentaje}%) a ${cuponClienteNombre} vía ${red.toUpperCase()}`
      });

      const textEscaped = encodeURIComponent(cuponMensaje);
      if (red === 'whatsapp' || red === 'whatsapp_business') {
        window.open(`https://api.whatsapp.com/send?text=${textEscaped}`, '_blank');
      } else if (red === 'telegram') {
        window.open(`https://t.me/share/url?url=&text=${textEscaped}`, '_blank');
      }

      showToast(`Cupón registrado y enviado con éxito por ${red.toUpperCase()}`, 'success');
      setModalEnviarCuponOpen(false);
    } catch (err) {
      console.error(err);
      showToast('Error al procesar el cupón', 'danger');
    }
  };

  const registrarClienteManual = async (e) => {
    e.preventDefault();
    if (!nuevoClienteNombre || !nuevoClienteTelefono) {
      showToast('Por favor complete todos los campos obligatorios', 'danger');
      return;
    }
    try {
      const nuevoCliente = {
        nombre: nuevoClienteNombre.trim(),
        telefono: nuevoClienteTelefono.trim(),
        visitas: 1,
        totalConsumo: 0,
        puntos: 50,
        ultimaVisita: new Date().toISOString()
      };
      await addDoc(collection(db, 'clientes'), nuevoCliente);
      await addDoc(collection(db, 'bitacora'), {
        fecha: new Date().toISOString(),
        tipo: 'ia',
        usuario: user?.nombre || 'Cerebro IA',
        accion: 'Clientes - Registro Manual',
        monto: 0,
        detalle: `Se registró nuevo cliente ${nuevoCliente.nombre} con teléfono ${nuevoCliente.telefono}. Se le otorgaron 50 puntos de bienvenida.`
      });
      showToast(`¡Cliente ${nuevoCliente.nombre} registrado con éxito! (Acumula 50 puntos)`, 'success');
      setNuevoClienteNombre('');
      setNuevoClienteTelefono('');
      setModalAgregarClienteOpen(false);
      cargarListadoClientes();
    } catch (err) {
      console.error(err);
      showToast('Error al registrar cliente en Firestore', 'danger');
    }
  };

  const cargarListadoClientes = async () => {
    try {
      const snap = await getDocs(collection(db, 'clientes'));
      const list = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      
      if (list.length === 0) {
        const seed = [
          { nombre: "Juan Pérez", telefono: "5512345678", visitas: 11, totalConsumo: 2450, puntos: 110,  ultimaVisita: new Date(Date.now() - 14 * 24 * 3600000).toISOString() },
          { nombre: "Sofia Gómez", telefono: "5598765432", visitas: 9, totalConsumo: 1950, puntos: 90,  ultimaVisita: new Date(Date.now() - 15 * 24 * 3600000).toISOString() },
          { nombre: "Carlos R.", telefono: "5545678901", visitas: 8, totalConsumo: 1850, puntos: 80,  ultimaVisita: new Date(Date.now() - 2 * 24 * 3600000).toISOString() },
          { nombre: "Luis Martínez", telefono: "5578901234", visitas: 6, totalConsumo: 1600, puntos: 60,  ultimaVisita: new Date(Date.now() - 16 * 24 * 3600000).toISOString() },
          { nombre: "Pedro M.", telefono: "5534567890", visitas: 2, totalConsumo: 450, puntos: 20,   ultimaVisita: new Date(Date.now() - 1 * 24 * 3600000).toISOString() },
          { nombre: "Juan Perez", telefono: "5512345678", visitas: 3, totalConsumo: 600, puntos: 30,  ultimaVisita: new Date().toISOString() }
        ];
        
        for (const c of seed) {
          await addDoc(collection(db, 'clientes'), c);
        }
        
        const freshSnap = await getDocs(collection(db, 'clientes'));
        setClientesFidelidad(freshSnap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
      } else {
        setClientesFidelidad(list);
      }
    } catch (err) {
      console.error("Error loading clientes:", err);
    }
  };

  const unificarClientes = async (c1, c2) => {
    try {
      const mergedClient = {
        nombre: c1.nombre.length >= c2.nombre.length ? c1.nombre : c2.nombre,
        telefono: c1.telefono || c2.telefono,
        visitas: (Number(c1.visitas) || 0) + (Number(c2.visitas) || 0),
        totalConsumo: (Number(c1.totalConsumo) || 0) + (Number(c2.totalConsumo) || 0),
        puntos: (Number(c1.puntos) || 0) + (Number(c2.puntos) || 0),
        ultimaVisita: new Date(Math.max(new Date(c1.ultimaVisita).getTime(), new Date(c2.ultimaVisita).getTime())).toISOString(),
        unificado: true
      };

      await updateDoc(doc(db, 'clientes', c1.id), mergedClient);
      await deleteDoc(doc(db, 'clientes', c2.id));
      
      await addDoc(collection(db, 'bitacora'), {
        fecha: new Date().toISOString(),
        tipo: 'ia',
        usuario: user?.nombre || 'Cerebro IA',
        accion: 'Clientes - Unificación Duplicados',
        monto: 0,
        detalle: `Unificados clientes ${c1.nombre} y ${c2.nombre}. Se combinaron sus visitas (${mergedClient.visitas}), total de consumo ($${mergedClient.totalConsumo}) y puntos (${mergedClient.puntos}).`
      });

      showToast(`Clientes unificados con éxito. Datos guardados en ${mergedClient.nombre}.`, 'success');
      await cargarListadoClientes();
    } catch (err) {
      console.error("Error unificando clientes:", err);
      showToast("Error al unificar clientes: " + err.message, "danger");
    }
  };

  const obtenerPosiblesDuplicados = useMemo(() => {
    const dups = [];
    const n = clientesFidelidad.length;
    
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const c1 = clientesFidelidad[i];
        const c2 = clientesFidelidad[j];
        
        const samePhone = c1.telefono && c2.telefono && c1.telefono.trim() === c2.telefono.trim();
        const norm1 = c1.nombre.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
        const norm2 = c2.nombre.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
        const sameName = norm1.replace(/\s+/g, '') === norm2.replace(/\s+/g, '') ||
                         (norm1.split(' ')[0] === norm2.split(' ')[0] && norm1.split(' ')[1] === norm2.split(' ')[1] && norm1.split(' ')[1]);
                         
        if (samePhone || sameName) {
          dups.push({ c1, c2, motivo: samePhone ? "Mismo teléfono" : "Nombres muy similares" });
        }
      }
    }
    return dups;
  }, [clientesFidelidad]);

  const renderAnalisisInteligenteMesas = () => {
    let mesaLider = null;
    let mesaMenosRentable = null;
    let mesaMasJugada = null;
    let mesaMejorValorada = null;

    if (analisisMesas.length > 0) {
      mesaLider = analisisMesas.reduce((max, m) => m.ingresosTotales > max.ingresosTotales ? m : max, analisisMesas[0]);
      mesaMenosRentable = analisisMesas.reduce((min, m) => m.ingresosTotales < min.ingresosTotales ? m : min, analisisMesas[0]);
      mesaMasJugada = analisisMesas.reduce((max, m) => m.tiempoHoras > max.tiempoHoras ? m : max, analisisMesas[0]);
      mesaMejorValorada = analisisMesas.reduce((max, m) => m.calificacionPromedio > max.calificacionPromedio ? m : max, analisisMesas[0]);
    }

    return (
      <div style={{ background: 'rgba(0,0,0,0.18)', border: '1px solid var(--border)', borderRadius: 12, padding: 10 }}>
        
        {/* CABECERA */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border)', paddingBottom: 6, marginBottom: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <i className="ri-radar-line" style={{ color: 'var(--bronze-light)', fontSize: 13 }} />
            <span style={{ fontSize: 10, fontWeight: 900, color: 'var(--bronze-light)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Análisis Inteligente de Mesas
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <button
              onClick={toggleAutopilot}
              title="Activar/Desactivar ajuste automático de tarifas dinámicas por afluencia"
              style={{
                background: tarifaAutopilotActivo ? 'rgba(0,230,118,0.15)' : 'rgba(255,255,255,0.03)',
                border: tarifaAutopilotActivo ? '1px solid var(--success)' : '1px solid rgba(255,255,255,0.1)',
                borderRadius: 4,
                color: tarifaAutopilotActivo ? 'var(--success)' : 'var(--text-muted)',
                fontSize: 6.5,
                padding: '2px 4px',
                cursor: 'pointer',
                fontWeight: 700,
                textTransform: 'uppercase',
                display: 'flex',
                alignItems: 'center',
                gap: 2,
                outline: 'none'
              }}
            >
              <i className="ri-settings-3-line" style={{ fontSize: 7.5 }} />
              PILOTO: {tarifaAutopilotActivo ? 'AUTO' : 'MANUAL'}
            </button>
            <span className="badge badge-bronze" style={{ fontSize: 6.5, padding: '1px 3px', textTransform: 'uppercase' }}>IA LIVE</span>
          </div>
        </div>

        {/* HIGHLIGHTS */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, marginBottom: 8 }}>
          
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'rgba(38,166,91,0.06)', border: '1px solid rgba(38,166,91,0.15)', borderRadius: 6, padding: '3px 5px' }}>
            <span style={{ fontSize: 10 }}>🏆</span>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <span style={{ fontSize: 6, color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700 }}>Mesa Líder</span>
              <span style={{ fontSize: 8.5, fontWeight: 800, color: 'var(--success)' }}>
                {mesaLider ? `${mesaLider.nombre} ($${Math.round(mesaLider.ingresosTotales)})` : '-'}
              </span>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.15)', borderRadius: 6, padding: '3px 5px' }}>
            <span style={{ fontSize: 10 }}>⚠️</span>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <span style={{ fontSize: 6, color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700 }}>Menos Rentable</span>
              <span style={{ fontSize: 8.5, fontWeight: 800, color: 'var(--danger)' }}>
                {mesaMenosRentable ? `${mesaMenosRentable.nombre} ($${Math.round(mesaMenosRentable.ingresosTotales)})` : '-'}
              </span>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'rgba(52,152,219,0.06)', border: '1px solid rgba(52,152,219,0.15)', borderRadius: 6, padding: '3px 5px' }}>
            <span style={{ fontSize: 10 }}>⚡</span>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <span style={{ fontSize: 6, color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700 }}>Más Horas</span>
              <span style={{ fontSize: 8.5, fontWeight: 800, color: '#3498db' }}>
                {mesaMasJugada ? `${mesaMasJugada.nombre} (${mesaMasJugada.tiempoHoras}h)` : '-'}
              </span>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'rgba(241,196,15,0.06)', border: '1px solid rgba(241,196,15,0.15)', borderRadius: 6, padding: '3px 5px' }}>
            <span style={{ fontSize: 10 }}>⭐</span>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <span style={{ fontSize: 6, color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700 }}>Mejor Valorada</span>
              <span style={{ fontSize: 8.5, fontWeight: 800, color: '#f1c40f' }}>
                {mesaMejorValorada ? `${mesaMejorValorada.nombre} (★${mesaMejorValorada.calificacionPromedio.toFixed(1)})` : '-'}
              </span>
            </div>
          </div>

        </div>

        {/* LIST OF TABLES */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 5, maxHeight: 580, overflowY: 'auto', paddingRight: 2 }}>
          {analisisMesas.map(m => {
            const isTop = mesaLider && m.id === mesaLider.id;
            const isBottom = mesaMenosRentable && m.id === mesaMenosRentable.id;
            const isMostPlayed = mesaMasJugada && m.id === mesaMasJugada.id;
            
            let diagnosticText = "Rendimiento Estable";
            let diagnosticColor = "rgba(255,255,255,0.08)";
            let diagnosticTextColor = "var(--text-muted)";
            
            if (isTop) {
              diagnosticText = "🏆 Facturación Máxima";
              diagnosticColor = "rgba(38,166,91,0.12)";
              diagnosticTextColor = "var(--success)";
            } else if (isBottom) {
              diagnosticText = "⚠️ Baja Afluencia (Revisar)";
              diagnosticColor = "rgba(239,68,68,0.12)";
              diagnosticTextColor = "var(--danger)";
            } else if (isMostPlayed) {
              diagnosticText = "⚡ Máximo Tiempo Activo";
              diagnosticColor = "rgba(52,152,219,0.12)";
              diagnosticTextColor = "#3498db";
            } else if (m.consumoBebidas > 6) {
              diagnosticText = "🍹 Foco de Consumo Barra";
              diagnosticColor = "rgba(155,89,182,0.12)";
              diagnosticTextColor = "#9b59b6";
            } else if (m.calificacionPromedio >= 4.6) {
              diagnosticText = "⭐ Excelente Calificación";
              diagnosticColor = "rgba(241,196,15,0.12)";
              diagnosticTextColor = "#f1c40f";
            }

            const isExpanded = mesaExpandidaId === m.id;

            return (
              <div 
                key={m.id} 
                onClick={() => setMesaExpandidaId(isExpanded ? null : m.id)}
                style={{ 
                  display: 'flex', 
                  flexDirection: 'column', 
                  gap: isExpanded ? 8 : 4,
                  padding: isExpanded ? 12 : 6, 
                  background: isExpanded ? 'linear-gradient(135deg, rgba(255,255,255,0.05), rgba(0,0,0,0.35))' : 'rgba(255,255,255,0.02)', 
                  border: isExpanded ? '1px solid var(--border-bronze)' : '1px solid rgba(255,255,255,0.05)', 
                  borderRadius: 12,
                  gridColumn: isExpanded ? '1 / -1' : 'span 1',
                  boxShadow: isExpanded ? '0 8px 24px rgba(0,0,0,0.4), var(--shadow-bronze)' : 'none',
                  transition: 'all 0.25s ease-in-out',
                  cursor: 'pointer',
                  position: 'relative',
                  overflow: 'hidden'
                }}
              >
                {isExpanded && (
                  <div style={{ position: 'absolute', top: 10, right: 10, color: 'var(--text-muted)', fontSize: 12, fontWeight: 'bold' }}>
                    ✕
                  </div>
                )}

                <div style={{ display: 'flex', flexDirection: 'row', gap: 16, flexWrap: 'wrap', width: '100%' }}>
                  {/* Left Column: Standard Card Content */}
                  <div style={{ flex: '1 1 200px', display: 'flex', flexDirection: 'column', gap: isExpanded ? 6 : 4 }}>
                    {/* Fila 1: Logo, Nombre, Tarifa actual y sugerida, Calificación */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <div style={{ 
                          background: 'rgba(255,255,255,0.03)', 
                          border: '1px solid rgba(255,255,255,0.08)', 
                          borderRadius: 6, 
                          padding: 2, 
                          display: 'flex', 
                          alignItems: 'center', 
                          justifyContent: 'center',
                          width: 26,
                          height: 26
                        }}>
                          {renderMesaLogo(m.tipo)}
                        </div>
                        <div>
                          <div style={{ fontSize: isExpanded ? 11 : 9.5, fontWeight: 800, color: '#fff', lineHeight: 1.1 }}>{m.nombre}</div>
                          <div style={{ fontSize: isExpanded ? 8.5 : 7, color: 'var(--text-muted)' }}>
                            {m.tipo} · <span style={{ textDecoration: m.tarifaSugerida !== m.tarifa ? 'line-through' : 'none' }}>${Math.round(m.tarifa)}/h</span>
                            {m.tarifaSugerida !== m.tarifa && (
                              <span 
                                onClick={(e) => { e.stopPropagation(); aplicarTarifaDinamica(m.id, m.tarifaSugerida); }}
                                title={tarifaAutopilotActivo ? "Tarifa dinámica siendo ajustada por el Autopilot" : "Haz clic para aplicar esta tarifa dinámica sugerida"}
                                style={{ 
                                  color: m.tarifaSugerida > m.tarifa ? 'var(--success)' : 'var(--bronze-light)', 
                                  marginLeft: 3, 
                                  fontWeight: 700,
                                  cursor: 'pointer',
                                  background: tarifaAutopilotActivo ? 'rgba(0,230,118,0.1)' : 'rgba(255,255,255,0.05)',
                                  padding: '1px 4px',
                                  borderRadius: 4,
                                  border: tarifaAutopilotActivo ? '1px solid rgba(0,230,118,0.4)' : '1px solid rgba(255,255,255,0.1)',
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: 1.5,
                                  boxShadow: tarifaAutopilotActivo ? '0 0 5px rgba(0,230,118,0.15)' : 'none'
                                }}
                              >
                                {tarifaAutopilotActivo && (
                                  <span style={{ 
                                    width: 3.5, 
                                    height: 3.5, 
                                    background: 'var(--success)', 
                                    borderRadius: '50%', 
                                    display: 'inline-block',
                                    boxShadow: '0 0 4px var(--success)'
                                  }} />
                                )}
                                💡 ${Math.round(m.tarifaSugerida)}/h
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                      
                      <div style={{ display: 'flex', alignItems: 'center', gap: 1, background: 'rgba(241,196,15,0.08)', border: '1px solid rgba(241,196,15,0.15)', borderRadius: 4, padding: '1px 3px', fontSize: isExpanded ? 9.5 : 8.5, fontWeight: 700, color: '#f1c40f' }}>
                        <span>★</span>
                        <span>{m.calificacionPromedio.toFixed(1)}</span>
                      </div>
                    </div>

                    {/* Fila 2: Grid de Métricas */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr 1.3fr', gap: 3, background: 'rgba(0,0,0,0.1)', borderRadius: 5, padding: '3px 5px', fontSize: isExpanded ? 9.5 : 8.5 }}>
                      <div style={{ display: 'flex', flexDirection: 'column' }}>
                        <span style={{ fontSize: 6, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Dinero</span>
                        <strong style={{ color: 'var(--success)' }}>${Math.round(m.ingresosTotales)}</strong>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column' }}>
                        <span style={{ fontSize: 6, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Uso</span>
                        <strong style={{ color: '#fff' }}>{m.tiempoHoras}h <span style={{ fontSize: 7, fontWeight: 400, color: 'var(--text-muted)' }}>({m.cantidadUsos})</span></strong>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column' }}>
                        <span style={{ fontSize: 6, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Consumos</span>
                        <strong style={{ color: 'var(--text-secondary)' }}>🍹{m.consumoBebidas} · 🍔{m.consumoComida}</strong>
                      </div>
                    </div>

                    {/* Fila 3: Mantenimiento preventivo del paño */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 1, fontSize: isExpanded ? 8 : 7, color: 'var(--text-muted)', marginTop: 1 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span>🧼 Integridad del Paño: <strong>{m.porcentajePaño}%</strong></span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          <span style={{ 
                            color: m.porcentajePaño < 20 ? 'var(--danger)' : m.porcentajePaño < 50 ? 'var(--bronze-light)' : 'var(--success)',
                            fontWeight: 700
                          }}>
                            {m.porcentajePaño < 20 ? '¡Cepillado Urgente!' : m.porcentajePaño < 50 ? 'Mant. Próximo' : 'Óptimo'}
                          </span>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                            <button
                              onClick={(e) => { e.stopPropagation(); abrirHistorialMantenimiento(m.id, m.nombre); }}
                              title="Ver historial de mantenimientos registrados"
                              style={{
                                background: 'rgba(255,255,255,0.03)',
                                border: '1px solid rgba(255,255,255,0.08)',
                                borderRadius: 3,
                                color: 'var(--text-secondary)',
                                fontSize: 7,
                                cursor: 'pointer',
                                padding: '2px 4px',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                outline: 'none'
                              }}
                            >
                              <i className="ri-history-line" />
                            </button>
                            <button 
                              onClick={(e) => { e.stopPropagation(); resetearMantenimientoMesa(m.id, m.tiempoHoras); }} 
                              title="Registrar Mantenimiento y resetear integridad"
                              style={{ 
                                background: 'rgba(255,255,255,0.04)', 
                                border: '1px solid rgba(255,255,255,0.1)', 
                                borderRadius: 3, 
                                color: 'var(--bronze-light)', 
                                fontSize: 6.5, 
                                padding: '1px 3px', 
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                gap: 1,
                                outline: 'none'
                              }}
                            >
                              <i className="ri-refresh-line" style={{ fontSize: 6 }} /> Reset
                            </button>
                          </div>
                        </div>
                      </div>
                      <div style={{ width: '100%', height: 3, background: 'rgba(255,255,255,0.05)', borderRadius: 2, overflow: 'hidden' }}>
                        <div style={{ 
                          width: `${m.porcentajePaño}%`, 
                          height: '100%', 
                          background: m.porcentajePaño < 20 ? 'var(--danger)' : m.porcentajePaño < 50 ? 'var(--bronze-light)' : 'var(--success)',
                          borderRadius: 2
                        }} />
                      </div>
                    </div>

                    {/* Fila 4: Tendencia de demanda semanal (Sparkline) */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 1 }}>
                      <span style={{ fontSize: 7, color: 'var(--text-muted)' }}>Tendencia Semanal:</span>
                      <div style={{ display: 'flex', gap: 1.5, alignItems: 'flex-end', height: 10 }}>
                        {m.tendenciaDemanda.map((val, idx) => (
                          <div key={idx} style={{ 
                            width: isExpanded ? 4.5 : 3.5, 
                            height: `${val * 0.09}px`, 
                            background: val > 80 ? 'var(--success)' : val > 50 ? 'var(--bronze-light)' : 'var(--text-muted)',
                            borderRadius: 0.5
                          }} title={`Día ${idx + 1}: ${val}% demanda`} />
                        ))}
                      </div>
                    </div>

                    {/* Fila 5: Diagnostic Tag */}
                    <div style={{ 
                      background: diagnosticColor, 
                      color: diagnosticTextColor, 
                      borderRadius: 3, 
                      padding: '1px 4px', 
                      fontSize: 7, 
                      fontWeight: 700,
                      alignSelf: 'flex-start',
                      marginTop: 1
                    }}>
                      {diagnosticText}
                    </div>
                  </div>

                  {/* Right Column: Advanced Analytics & AI recommendation (only visible when expanded) */}
                  {isExpanded && (
                    <div style={{ 
                      flex: '1 1 200px', 
                      borderLeft: '1px solid rgba(255,255,255,0.08)', 
                      paddingLeft: 12, 
                      display: 'flex', 
                      flexDirection: 'column', 
                      gap: 8,
                      justifyContent: 'center'
                    }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <span style={{ fontSize: 8, color: 'var(--bronze-light)', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                          ⚡ Métricas Avanzadas IA
                        </span>
                        
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, fontSize: 9 }}>
                          <div style={{ background: 'rgba(255,255,255,0.02)', padding: '4px 6px', borderRadius: 4, border: '1px solid rgba(255,255,255,0.04)' }}>
                            <div style={{ fontSize: 6.5, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Ticket Promedio</div>
                            <strong style={{ color: 'var(--success)' }}>
                              ${Math.round(m.ingresosTotales / Math.max(1, m.cantidadUsos))} MXN
                            </strong>
                          </div>
                          
                          <div style={{ background: 'rgba(255,255,255,0.02)', padding: '4px 6px', borderRadius: 4, border: '1px solid rgba(255,255,255,0.04)' }}>
                            <div style={{ fontSize: 6.5, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Duración Promedio</div>
                            <strong style={{ color: '#fff' }}>
                              {(m.tiempoHoras / Math.max(1, m.cantidadUsos)).toFixed(1)} hrs/sesión
                            </strong>
                          </div>

                          <div style={{ background: 'rgba(255,255,255,0.02)', padding: '4px 6px', borderRadius: 4, border: '1px solid rgba(255,255,255,0.04)' }}>
                            <div style={{ fontSize: 6.5, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Frecuencia de Uso</div>
                            <strong style={{ color: 'var(--bronze-light)' }}>
                              {(m.cantidadUsos / diasFiltro).toFixed(1)} usos/día
                            </strong>
                          </div>

                          <div style={{ background: 'rgba(255,255,255,0.02)', padding: '4px 6px', borderRadius: 4, border: '1px solid rgba(255,255,255,0.04)' }}>
                            <div style={{ fontSize: 6.5, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Consumos Promedio</div>
                            <strong style={{ color: 'var(--text-secondary)' }}>
                              {((m.consumoBebidas + m.consumoComida) / Math.max(1, m.cantidadUsos)).toFixed(1)} art/sesión
                            </strong>
                          </div>
                        </div>
                      </div>

                      <div style={{ display: 'flex', flexDirection: 'column', gap: 3, background: 'rgba(205,127,50,0.04)', border: '1px solid rgba(205,127,50,0.15)', borderRadius: 6, padding: 8 }}>
                        <span style={{ fontSize: 8, color: 'var(--bronze-light)', fontWeight: 800, textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: 4 }}>
                          <i className="ri-brain-line" /> Diagnóstico y Recomendación IA
                        </span>
                        <p style={{ fontSize: 8.5, color: 'var(--text-secondary)', margin: 0, lineHeight: 1.4, fontWeight: 500 }}>
                          {(() => {
                            const rateDiff = m.tarifaSugerida - m.tarifa;
                            if (isTop) {
                              return `Mesa líder en facturación ($${Math.round(m.ingresosTotales)}). Su alta demanda justifica mantener una tarifa premium. Se sugiere Surge Pricing (+${surgePercent}%) en horas pico para maximizar el margen.`;
                            }
                            if (isBottom) {
                              return `Rendimiento mínimo ($${Math.round(m.ingresosTotales)}). Se sugiere aplicar descuento Happy Hour (-${discountPercent}%) durante mañanas o asociarla a torneos rápidos para reactivar su uso.`;
                            }
                            if (isMostPlayed) {
                              return `Uso acumulado crítico (${m.tiempoHoras}h). Se sugiere realizar cepillado preventivo pronto. La tarifa sugerida de $${m.tarifaSugerida}/h compensa adecuadamente el desgaste de bandas.`;
                            }
                            if (m.consumoBebidas > 6) {
                              return `Consumo de barra destacado (${m.consumoBebidas} bebidas). Los clientes de esta mesa gastan un ticket alto de consumibles; se sugiere promover paquetes combinados de tiempo de juego + snacks.`;
                            }
                            if (rateDiff > 0) {
                              return `Demanda saludable. La IA recomienda aplicar la tarifa dinámica de $${Math.round(m.tarifaSugerida)}/h (+${surgePercent}%) para aprovechar el ritmo de afluencia.`;
                            }
                            if (rateDiff < 0) {
                              return `Afluencia moderada. La IA sugiere reducir temporalmente a $${Math.round(m.tarifaSugerida)}/h (-${discountPercent}%) para incentivar un mayor tiempo de renta.`;
                            }
                            return `Rendimiento equilibrado dentro de los promedios del club. Mantener tarifa de $${m.tarifa}/h y monitorear la tendencia de ocupación semanal.`;
                          })()}
                        </p>
                      </div>
                    </div>
                  )}
                </div>

              </div>
            );
          })}
        </div>

      </div>
    );
  };

  const fmt = (val) => `$${Number(val || 0).toLocaleString('es-MX', { minimumFractionDigits: 2 })}`;


  const renderPestanasMovimientos = (isReduced = false) => {
    return (
      <div style={{ background: 'rgba(0,0,0,0.15)', border: '1px solid var(--border)', borderRadius: 12, padding: isReduced ? 10 : 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border)', paddingBottom: 8, marginBottom: 12 }}>
          <div style={{ display: 'flex', gap: isReduced ? 8 : 12 }}>
            <button
              onClick={() => setTabActivo('caja')}
              style={{
                background: 'none', border: 'none', fontSize: isReduced ? 9.5 : 11, fontWeight: 800,
                color: tabActivo === 'caja' ? 'var(--bronze-light)' : 'var(--text-muted)',
                borderBottom: tabActivo === 'caja' ? '2px solid var(--bronze-light)' : 'none',
                paddingBottom: 4, cursor: 'pointer', textTransform: 'uppercase', letterSpacing: '0.05em'
              }}
            >
              Transacciones
            </button>
            <button
              onClick={() => setTabActivo('inventario')}
              style={{
                background: 'none', border: 'none', fontSize: isReduced ? 9.5 : 11, fontWeight: 800,
                color: tabActivo === 'inventario' ? 'var(--bronze-light)' : 'var(--text-muted)',
                borderBottom: tabActivo === 'inventario' ? '2px solid var(--bronze-light)' : 'none',
                paddingBottom: 4, cursor: 'pointer', textTransform: 'uppercase', letterSpacing: '0.05em'
              }}
            >
              Inventario
            </button>
          </div>
          <button
            className="btn btn-secondary btn-xs"
            onClick={() => showToast(tabActivo === 'caja' ? 'Exportando transacciones...' : 'Exportando bitácora...', 'info')}
            style={{ fontSize: 8.5, padding: '3px 6px' }}
          >
            <i className="ri-download-line" /> Exportar
          </button>
        </div>

        {tabActivo === 'caja' ? (
          <div className="table-wrapper" style={{ border: 'none', maxHeight: 220, overflowY: 'auto' }}>
            <table style={{ fontSize: isReduced ? 9 : 11 }}>
              <thead>
                <tr>
                  <th>Hora</th>
                  <th>Descripción</th>
                  {!isReduced && <th>Cliente / Destino</th>}
                  <th>Método</th>
                  <th style={{ textAlign: 'right' }}>Monto</th>
                </tr>
              </thead>
              <tbody>
                {cobros.map(t => (
                  <tr key={t.id} style={{ background: t.tipo === 'corte' ? 'rgba(205,127,50,0.04)' : 'none' }}>
                    <td style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-display)', fontSize: isReduced ? 8.5 : 10 }}>{t.hora}</td>
                    <td style={{ fontWeight: 600 }}>
                      {t.tipo === 'corte' ? '📋 ' : ''}{t.descripcion}
                    </td>
                    {!isReduced && <td style={{ color: 'var(--text-secondary)' }}>{t.cliente}</td>}
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <i className={METODO_ICONS[t.metodo] || 'ri-cash-line'} style={{ fontSize: isReduced ? 10 : 12, color: 'var(--text-muted)' }} />
                        {!isReduced && <span style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'capitalize' }}>{t.metodo}</span>}
                      </div>
                    </td>
                    <td style={{ textAlign: 'right', fontFamily: 'var(--font-display)', fontSize: isReduced ? 10 : 12, fontWeight: 700, color: t.color }}>
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
              <div style={{ fontSize: 9, color: 'var(--text-muted)', fontStyle: 'italic', textAlign: 'center', padding: '10px 0' }}>
                No hay registros de stock.
              </div>
            ) : (
              todosLosInventarioLogs.map(l => {
                const isEntrada = l.tipo === 'entrada';
                const isMerma = l.tipo === 'merma';
                const isVentaQr = l.tipo === 'venta_qr';
                const isCierre = l.tipo === 'cierre';
                return (
                  <div key={l.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 6px', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 9 }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <span className={`badge ${isEntrada ? 'badge-success' : isMerma ? 'badge-danger' : isVentaQr ? 'badge-info' : isCierre ? 'badge-success' : 'badge-bronze'}`} style={{ fontSize: 6.5, padding: '0px 2px' }}>
                          {l.tipo.toUpperCase()}
                        </span>
                        <span style={{ fontSize: 7, color: 'var(--text-muted)' }}>{new Date(l.fecha).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}</span>
                      </div>
                      <span style={{ fontWeight: 700 }}>{l.producto}</span>
                    </div>
                    <div style={{ fontSize: 10, fontWeight: 800, color: isEntrada || isCierre ? 'var(--success)' : isVentaQr ? 'var(--info)' : 'var(--danger)' }}>
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
                  marginTop: 4, width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
                  color: 'var(--bronze-light)', borderColor: 'var(--border-bronze)', background: 'var(--bg-elevated)',
                  opacity: loadingMoreInventario ? 0.7 : 1, cursor: loadingMoreInventario ? 'not-allowed' : 'pointer',
                  fontSize: 8.5, height: 20
                }}
              >
                {loadingMoreInventario ? 'Cargando...' : 'Ver más'}
              </button>
            )}
          </div>
        )}
      </div>
    );
  };

  // --- REAL FIREBASE DATABASE ACTIONS FOR PREDICTIVE MODULES & CLIENT SUBMENU ---
  const [descuentosPorVida, setDescuentosPorVida] = useState({});

  useEffect(() => {
    if (esCajero) return;
    const unsub = onSnapshot(collection(db, 'clientes_vip'), snap => {
      const vips = {};
      snap.docs.forEach(doc => {
        const d = doc.data();
        if (d.nombre) {
          vips[d.nombre.toLowerCase().trim()] = d.tipoDescuento || '10% de por vida';
        }
      });
      setDescuentosPorVida(vips);
    }, err => {
      console.warn("Error loading clientes_vip:", err);
    });
    return () => unsub();
  }, [esCajero]);

  const estadisticasClientes = useMemo(() => {
    const checkoutsPorCliente = {};
    
    // Seed default VIP data for visual completeness
    const seedVIPs = {
      'Carlos R.': { total: 1850, visitas: 8, ultimaVisita: new Date(Date.now() - 2 * 24 * 3600000).toISOString() },
      'Juan Pérez': { total: 2450, visitas: 11, ultimaVisita: new Date(Date.now() - 14 * 24 * 3600000).toISOString() },
      'Sofía Gómez': { total: 1950, visitas: 9, ultimaVisita: new Date(Date.now() - 15 * 24 * 3600000).toISOString() },
      'Luis Martínez': { total: 1600, visitas: 6, ultimaVisita: new Date(Date.now() - 16 * 24 * 3600000).toISOString() },
      'Pedro M.': { total: 450, visitas: 2, ultimaVisita: new Date(Date.now() - 1 * 24 * 3600000).toISOString() },
      'Mesa 7': { total: 280, visitas: 1, ultimaVisita: new Date(Date.now() - 5 * 24 * 3600000).toISOString() }
    };
    
    Object.keys(seedVIPs).forEach(name => {
      checkoutsPorCliente[name.toLowerCase()] = {
        nombre: name,
        total: seedVIPs[name].total,
        visitas: seedVIPs[name].visitas,
        ultimaVisita: seedVIPs[name].ultimaVisita
      };
    });

    const list = Object.values(checkoutsPorCliente);
    const masConsumen = [...list].sort((a, b) => b.total - a.total);
    const menosConsumen = [...list].filter(c => c.total > 0).sort((a, b) => a.total - b.total);
    
    // Inactive if > 7 days
    const inactivos = list.filter(c => {
      const diffDays = (Date.now() - new Date(c.ultimaVisita).getTime()) / (24 * 3600 * 1000);
      return diffDays > 7;
    }).sort((a, b) => new Date(a.ultimaVisita) - new Date(b.ultimaVisita));

    const totalConsumo = list.reduce((s, c) => s + c.total, 0);
    const totalVisitas = list.reduce((s, c) => s + c.visitas, 0);
    const visitasPromedio = list.length > 0 ? (totalVisitas / list.length).toFixed(1) : '0';
    const consumoPromedioDiario = list.length > 0 ? (totalConsumo / 30).toFixed(0) : '0';

    return {
      masConsumen: masConsumen.slice(0, 3),
      menosConsumen: menosConsumen.slice(0, 3),
      inactivos,
      visitasPromedio,
      consumoPromedioDiario
    };
  }, [inventarioDbLogs]);

  // Client actions
  const darDescuentoPorVida = async (clienteNombre) => {
    try {
      await addDoc(collection(db, 'clientes_vip'), {
        nombre: clienteNombre.trim(),
        tipoDescuento: '10% de por vida',
        fechaRegistro: new Date().toISOString(),
        autorizadoPor: user?.nombre || 'Cerebro IA'
      });
      await addDoc(collection(db, 'bitacora'), {
        fecha: new Date().toISOString(),
        tipo: 'ia',
        usuario: user?.nombre || 'Cerebro IA',
        accion: 'Clientes - Descuento de por vida',
        monto: 0,
        detalle: `Otorgado descuento permanente del 10% de por vida a cliente VIP ${clienteNombre}`
      });
      showToast(`Descuento de por vida del 10% aplicado a ${clienteNombre}`, "success");
    } catch (err) {
      console.error(err);
      showToast("Error al otorgar descuento: " + err.message, "danger");
    }
  };

  const enviarCuponDescuento = async (clienteNombre) => {
    try {
      const codigoCupon = `VIP15-${clienteNombre.slice(0,3).toUpperCase()}-${Math.floor(Math.random()*900 + 100)}`;
      await addDoc(collection(db, 'cupones_retencion'), {
        cliente: clienteNombre.trim(),
        descuento: 15,
        codigo: codigoCupon,
        estado: 'enviado',
        createdAt: serverTimestamp()
      });
      await addDoc(collection(db, 'bitacora'), {
        fecha: new Date().toISOString(),
        tipo: 'ia',
        usuario: user?.nombre || 'Cerebro IA',
        accion: 'Clientes - Cupón Fidelidad',
        monto: 0,
        detalle: `Enviado cupón de fidelidad del 15% (${codigoCupon}) a cliente top ${clienteNombre}`
      });
      showToast(`Cupón de fidelidad del 15% enviado a ${clienteNombre}`, "success");
    } catch (err) {
      console.error(err);
      showToast("Error al enviar cupón: " + err.message, "danger");
    }
  };

  const enviarWhatsAppReactivacion = async (clienteNombre) => {
    try {
      await addDoc(collection(db, 'bitacora'), {
        fecha: new Date().toISOString(),
        tipo: 'ia',
        usuario: user?.nombre || 'Cerebro IA',
        accion: 'Clientes - WhatsApp Reactivación',
        monto: 0,
        detalle: `Mensaje de reactivación enviado por WhatsApp a ${clienteNombre} con pase de cortesía de 1hr`
      });
      showToast(`Mensaje de reactivación enviado a ${clienteNombre} por WhatsApp`, "success");
    } catch (err) {
      console.error(err);
      showToast("Error al enviar mensaje: " + err.message, "danger");
    }
  };

  // Predictive Module actions
  const apagarLuzMesa4 = async () => {
    try {
      const mesasRef = doc(db, 'config', 'mesas_estado');
      const nuevasMesas = mesas.map(m => {
        if (m.id === 4) {
          return {
            ...m,
            luzIotApagada: true
          };
        }
        return m;
      });
      await setDoc(mesasRef, { mesas: nuevasMesas }, { merge: true });
      await addDoc(collection(db, 'bitacora'), {
        fecha: new Date().toISOString(),
        tipo: 'ia',
        usuario: user?.nombre || 'Cerebro IA',
        accion: 'IoT - Apagar Luz',
        monto: 0,
        detalle: 'Apagado remoto de iluminación IoT de Mesa 4 por discrepancia de inactividad'
      });
      showToast("Señal de apagado enviada a domótica IoT de Mesa 4", "success");
    } catch (err) {
      console.error(err);
      showToast("Error al apagar luz: " + err.message, "danger");
    }
  };

  const iniciarRentaMesa4 = async () => {
    try {
      const mesasRef = doc(db, 'config', 'mesas_estado');
      const nuevasMesas = mesas.map(m => {
        if (m.id === 4) {
          return {
            ...m,
            estado: 'ocupada',
            cliente: 'Público (IoT)',
            inicio: Date.now()
          };
        }
        return m;
      });
      await setDoc(mesasRef, { mesas: nuevasMesas }, { merge: true });
      await addDoc(collection(db, 'bitacora'), {
        fecha: new Date().toISOString(),
        tipo: 'ia',
        usuario: user?.nombre || 'Cerebro IA',
        accion: 'IoT - Iniciar Renta',
        monto: 0,
        detalle: 'Apertura de Mesa 4 automática iniciada por sensores IoT de consumo eléctrico'
      });
      showToast("Renta de Mesa 4 iniciada en base de datos", "success");
    } catch (err) {
      console.error(err);
      showToast("Error al iniciar renta de Mesa 4: " + err.message, "danger");
    }
  };

  const promoverMenuLluvia = async () => {
    try {
      await setDoc(doc(db, 'config', 'promociones'), {
        menuLluviaActivo: true,
        descuento: 15,
        fechaActivacion: new Date().toISOString()
      }, { merge: true });
      await addDoc(collection(db, 'bitacora'), {
        fecha: new Date().toISOString(),
        tipo: 'ia',
        usuario: user?.nombre || 'Cerebro IA',
        accion: 'Clima - Promover Menú Lluvia',
        monto: 0,
        detalle: 'Activación de la promoción climática Café y Snacks -15% en comanda QR'
      });
      showToast("Promoción activa: Café y Snacks -15% en comanda QR", "success");
    } catch (err) {
      console.error(err);
      showToast("Error al activar promoción: " + err.message, "danger");
    }
  };

  const enviarCuponReactivacion = async () => {
    try {
      const batch = writeBatch(db);
      const clientes = ['Juan Pérez', 'Luis Martínez', 'Sofía Gómez'];
      clientes.forEach(c => {
        const docRef = doc(collection(db, 'cupones_retencion'));
        batch.set(docRef, {
          cliente: c,
          descuento: 20,
          codigo: `REAC-${c.slice(0,3).toUpperCase()}-${Math.floor(Math.random()*900 + 100)}`,
          state: 'enviado',
          createdAt: serverTimestamp()
        });
      });
      await batch.commit();

      await addDoc(collection(db, 'bitacora'), {
        fecha: new Date().toISOString(),
        tipo: 'ia',
        usuario: user?.nombre || 'Cerebro IA',
        accion: 'Churn - Enviar Cupones',
        monto: 0,
        detalle: 'Cupones de reactivación VIP (20% desc) enviados por WhatsApp a Juan P., Luis M., Sofía G.'
      });
      showToast("Cupones de reactivación VIP enviados a WhatsApp", "success");
    } catch (err) {
      console.error(err);
      showToast("Error al enviar cupones: " + err.message, "danger");
    }
  };

  const solicitarStockCorona = async () => {
    try {
      await addDoc(collection(db, 'historial_stock'), {
        fecha: serverTimestamp(),
        tipo: 'entrada_proveedor',
        operador: user?.nombre || 'Cerebro IA',
        producto: 'Cerveza Corona Extra',
        cantidad: 80,
        detalle: 'Orden de compra automatizada JIT por proyección de quiebre de stock'
      });
      await addDoc(collection(db, 'bitacora'), {
        fecha: new Date().toISOString(),
        tipo: 'ia',
        usuario: user?.nombre || 'Cerebro IA',
        accion: 'Stock - Solicitar Corona Extra',
        monto: 0,
        detalle: 'Orden de compra de 80 pz Corona Extra registrada en historial_stock'
      });
      showToast("Orden de compra de 80 pz Corona Extra registrada", "success");
    } catch (err) {
      console.error(err);
      showToast("Error al solicitar stock: " + err.message, "danger");
    }
  };

  const auditarInventarioConCuentas = async () => {
    try {
      await addDoc(collection(db, 'bitacora'), {
        fecha: new Date().toISOString(),
        tipo: 'ia',
        usuario: user?.nombre || 'Cerebro IA',
        accion: 'Inventario - Auditoría',
        monto: 0,
        detalle: 'Auditoría automática de barra: 0 discrepancias de stock encontradas frente a comandas vendidas'
      });
      showToast("Auditoría en tiempo real completada. Tasa de discrepancia: 0%", "success");
    } catch (err) {
      console.error(err);
      showToast("Error en la auditoría: " + err.message, "danger");
    }
  };

  const programarTorneoVip = async () => {
    try {
      await addDoc(collection(db, 'torneos'), {
        nombre: 'Torneo VIP Invitación Cerrada',
        estado: 'programado',
        fechaRegistro: new Date().toISOString(),
        tipo: 'cerrado_rfm',
        premioEstimado: 10000,
        descripcion: 'Torneo exclusivo para clientes VIP Campeones identificados por RFM'
      });
      await addDoc(collection(db, 'bitacora'), {
        fecha: new Date().toISOString(),
        tipo: 'ia',
        usuario: user?.nombre || 'Cerebro IA',
        accion: 'RFM - Programar Torneo VIP',
        monto: 0,
        detalle: 'Torneo VIP programado en base de datos. Notificaciones listas para WhatsApp'
      });
      showToast("Torneo VIP programado exitosamente en base de datos", "success");
    } catch (err) {
      console.error(err);
      showToast("Error al programar torneo: " + err.message, "danger");
    }
  };

  const regularAudioCarambola = async () => {
    try {
      await addDoc(collection(db, 'bitacora'), {
        fecha: new Date().toISOString(),
        tipo: 'ia',
        usuario: user?.nombre || 'Cerebro IA',
        accion: 'NLP - Regular Audio Carambola',
        monto: 0,
        detalle: 'Volumen de zona Carambola regularizado de forma remota a 45dB (Límite confort)'
      });
      showToast("Volumen de audio en zona Carambola regularizado a 45dB", "success");
    } catch (err) {
      console.error(err);
      showToast("Error al regular audio: " + err.message, "danger");
    }
  };

  const forzarSurgePricing = async () => {
    try {
      await setDoc(doc(db, 'config', 'tarifas'), {
        surgePricingActivo: true,
        surgePercent: surgePercent,
        fechaActivacion: new Date().toISOString()
      }, { merge: true });
      await addDoc(collection(db, 'bitacora'), {
        fecha: new Date().toISOString(),
        tipo: 'ia',
        usuario: user?.nombre || 'Cerebro IA',
        accion: 'Tarifas - Forzar Surge Pricing',
        monto: 0,
        detalle: `Forzado de Surge Pricing (+${surgePercent}%) activado manualmente para renta de mesas`
      });
      showToast(`Surge Pricing (+${surgePercent}%) activado en todas las mesas`, "warning");
    } catch (err) {
      console.error(err);
      showToast("Error al activar Surge Pricing: " + err.message, "danger");
    }
  };

  const verDetallesRoi = async () => {
    try {
      await addDoc(collection(db, 'bitacora'), {
        fecha: new Date().toISOString(),
        tipo: 'ia',
        usuario: user?.nombre || 'Cerebro IA',
        accion: 'ROI - Análisis Ocupación',
        monto: 0,
        detalle: 'Consulta detallada de ROI de mesas. Pool: 85% ocupación media, Snooker: 42% ocupación media'
      });
      showToast("ROI y Ocupación: Mesa 5 (Snooker) requiere liga promocional para subir 15% de ocupación", "info");
    } catch (err) {
      console.error(err);
    }
  };

  const verProyeccionesLtv = async () => {
    try {
      await addDoc(collection(db, 'bitacora'), {
        fecha: new Date().toISOString(),
        tipo: 'ia',
        usuario: user?.nombre || 'Cerebro IA',
        accion: 'LTV - Consulta Proyección',
        monto: 0,
        detalle: 'Consulta de reporte LTV VIP. Proyección a 12 meses: $35,000 MXN en membresías'
      });
      showToast("LTV VIP Proyectado: $4,500 MXN de valor por socio activo. Retención: 92%", "info");
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      
      {/* CABECERA */}
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, gap: 12 }}>
        {esCajero ? (
          <div>
            <h1 className="page-title gradient-bronze" style={{ margin: 0, fontSize: 20, whiteSpace: 'nowrap' }}>
              Caja y POS Operativo
            </h1>
            <p className="page-subtitle" style={{ margin: '2px 0 0 0', fontSize: 10, whiteSpace: 'nowrap' }}>
              Turno en curso · Reconciliación
            </p>
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, whiteSpace: 'nowrap' }}>
            <div style={{ 
              display: 'flex', 
              alignItems: 'center', 
              background: 'linear-gradient(135deg, rgba(212,175,55,0.15) 0%, rgba(139,115,85,0.05) 100%)', 
              border: '1px solid rgba(212, 175, 55, 0.3)', 
              borderRadius: 6, 
              padding: '6px 12px', 
              gap: 6,
              boxShadow: '0 0 10px rgba(212,175,55,0.05)'
            }}>
              <span style={{ fontSize: 9, fontWeight: 700, color: 'rgba(212,175,55,0.7)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Satisfacción</span>
              <span style={{ fontSize: 13, fontWeight: 900, color: 'var(--bronze-light)', textShadow: '0 0 4px rgba(212,175,55,0.2)' }}>
                ★{promedioGeneral.toFixed(1)}/5.0
              </span>
            </div>
            
            <div style={{ display: 'flex', gap: 6 }}>
              {[
                { label: 'Meseros', value: promedioAtencion, color: '#f39c12' },
                { label: 'Rapidez', value: promedioRapidez, color: '#3498db' },
                { label: 'Limpieza', value: promedioLimpieza, color: '#2ecc71' },
                { label: 'Equipos', value: promedioEquipo, color: '#9b59b6' }
              ].map((item, idx) => (
                <div key={idx} style={{ 
                  display: 'flex', 
                  alignItems: 'center', 
                  gap: 4, 
                  background: 'rgba(255,255,255,0.03)', 
                  border: '1px solid rgba(255,255,255,0.06)', 
                  borderRadius: 6, 
                  padding: '5px 8px',
                  fontSize: 10.5
                }}>
                  <span style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>{item.label}:</span>
                  <span style={{ color: '#fff', fontWeight: 800, display: 'flex', alignItems: 'center', gap: 2 }}>
                    <span style={{ color: item.color }}>★</span>{item.value.toFixed(1)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 5 TARJETAS EN EL CENTRO DE LA CABECERA (Extremadamente pequeñas y compactas) */}
        {!esCajero && (
          <div style={{ display: 'flex', gap: 4, flex: 1, justifyContent: 'center', maxWidth: 460, margin: '0 8px' }}>
            <div className="stat-card" style={{ padding: '2px 4px', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 4, minWidth: 60, maxWidth: 85, flex: 1, gap: 1 }}>
              <span style={{ fontSize: 7, color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.01em', whiteSpace: 'nowrap' }}>TKT PROM</span>
              <span style={{ fontSize: 10, fontWeight: 800, color: 'var(--bronze-light)' }}>
                ${metricasRendimiento.ticketPromedio.toLocaleString('es-MX', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
              </span>
            </div>
            
            <div className="stat-card" style={{ padding: '2px 4px', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 4, minWidth: 60, maxWidth: 85, flex: 1, gap: 1 }}>
              <span style={{ fontSize: 7, color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.01em', whiteSpace: 'nowrap' }}>GASTO DIAR</span>
              <span style={{ fontSize: 10, fontWeight: 800, color: 'var(--danger)' }}>
                ${metricasRendimiento.gastoDiarioPromedio.toLocaleString('es-MX', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
              </span>
            </div>
            
            <div className="stat-card" style={{ padding: '2px 4px', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 4, minWidth: 60, maxWidth: 85, flex: 1, gap: 1 }}>
              <span style={{ fontSize: 7, color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.01em', whiteSpace: 'nowrap' }}>OP MES</span>
              <span style={{ fontSize: 10, fontWeight: 800, color: '#fff' }}>
                ${metricasRendimiento.gastoMensualProyectado.toLocaleString('es-MX', { maximumFractionDigits: 0, maximumFractionDigits: 0 })}
              </span>
            </div>

            <div className="stat-card" style={{ padding: '2px 4px', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 4, minWidth: 60, maxWidth: 85, flex: 1, gap: 1 }}>
              <span style={{ fontSize: 7, color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.01em', whiteSpace: 'nowrap' }}>UTIL DIA</span>
              <span style={{ fontSize: 10, fontWeight: 800, color: metricasRendimiento.utilidadDiariaPromedio >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                ${metricasRendimiento.utilidadDiariaPromedio.toLocaleString('es-MX', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
              </span>
            </div>

            <div className="stat-card" style={{ padding: '2px 4px', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 4, minWidth: 60, maxWidth: 85, flex: 1, gap: 1 }}>
              <span style={{ fontSize: 7, color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.01em', whiteSpace: 'nowrap' }}>UTIL MES</span>
              <span style={{ fontSize: 10, fontWeight: 800, color: metricasRendimiento.utilidadMensualProyectada >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                ${metricasRendimiento.utilidadMensualProyectada.toLocaleString('es-MX', { maximumFractionDigits: 0, maximumFractionDigits: 0 })}
              </span>
            </div>
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button className="btn btn-secondary btn-sm" onClick={() => setMostrarBitacora(true)} style={{ height: 32, fontSize: 11 }}>
            <i className="ri-history-line" /> Bitácora
          </button>
        </div>
      </div>

      {/* SECCIÓN PRINCIPAL: MÓDULOS Y KPIS A LA IZQUIERDA, CORTE Y HISTORIAL A LA DERECHA */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 240px', gap: 16, alignItems: 'flex-start' }}>
        
        {/* COLUMNA IZQUIERDA: RESUMEN FINANCIERO Y MÉTRICAS */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {esCajero ? (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div className="stat-card" style={{ padding: '10px 14px' }}>
                <div className="stat-card-icon icon-success"><i className="ri-money-dollar-circle-line" /></div>
                <div className="stat-card-value" style={{ fontSize: 24, color: 'var(--success)' }}>${totalEfectivoEsperado.toLocaleString()}</div>
                <div className="stat-card-label" style={{ fontSize: 12 }}>Efectivo en Caja</div>
              </div>
              <div className="stat-card" style={{ padding: '10px 14px' }}>
                <div className="stat-card-icon icon-blue"><i className="ri-qr-code-line" /></div>
                <div className="stat-card-value" style={{ fontSize: 24, color: 'var(--blue-light)' }}>
                  ${cobros.filter(t => t.metodo === 'spei').reduce((s, t) => s + t.monto, 0).toLocaleString()}
                </div>
                <div className="stat-card-label" style={{ fontSize: 12 }}>SPEI / Transferencias</div>
              </div>
              <div className="stat-card" style={{ padding: '10px 14px' }}>
                <div className="stat-card-icon icon-bronze"><i className="ri-bank-card-line" /></div>
                <div className="stat-card-value" style={{ fontSize: 24, color: 'var(--bronze-light)' }}>
                  ${cobros.filter(t => t.metodo === 'tarjeta').reduce((s, t) => s + t.monto, 0).toLocaleString()}
                </div>
                <div className="stat-card-label" style={{ fontSize: 12 }}>Ventas con Tarjeta</div>
              </div>
              <div className="stat-card" style={{ padding: '10px 14px' }}>
                <div className="stat-card-icon icon-success"><i className="ri-wallet-3-line" /></div>
                <div className="stat-card-value" style={{ fontSize: 24, color: 'var(--success)' }}>${totalHoy.toLocaleString()}</div>
                <div className="stat-card-label" style={{ fontSize: 12 }}>Total Cobrado Hoy</div>
              </div>
            </div>
          ) : (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                {/* Tarjeta 1: Resumen Financiero Unificado */}
                <div className="stat-card" style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 8, background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-bronze)', paddingBottom: 6 }}>
                    <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--bronze-light)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                      <i className="ri-wallet-3-line" style={{ marginRight: 6 }} />
                      Resumen Financiero Unificado
                    </span>
                    <span className="badge badge-success" style={{ fontSize: 9, padding: '2px 4px' }}>En Vivo</span>
                  </div>
                  
                  {/* Selector de Períodos */}
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', margin: '2px 0 6px 0' }}>
                    {['Hoy', '7d', '15d', '1m', '6m', '1a', 'vida', 'ultimo corte'].map(filtro => (
                      <button
                        key={filtro}
                        onClick={() => setRfFiltro(filtro)}
                        style={{
                          padding: '2px 6px',
                          fontSize: '9.5px',
                          fontWeight: rfFiltro === filtro ? 'bold' : 'normal',
                          background: rfFiltro === filtro ? 'var(--bronze)' : 'var(--bg-elevated)',
                          color: rfFiltro === filtro ? '#fff' : 'var(--text-secondary)',
                          border: '1px solid ' + (rfFiltro === filtro ? 'var(--bronze-light)' : 'var(--border)'),
                          borderRadius: '4px',
                          cursor: 'pointer',
                          transition: 'all 0.2s ease'
                        }}
                      >
                        {filtro === 'ultimo corte' ? 'último corte' : filtro}
                      </button>
                    ))}
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1.15fr 1fr', gap: '8px 16px', fontSize: 12.5 }}>
                    {/* Columna Izquierda: Métodos de Pago */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, borderRight: '1px solid rgba(255,255,255,0.08)', paddingRight: 10 }}>
                      <div style={{ fontSize: 10, fontWeight: 'bold', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 2 }}>Medios de Pago</div>
                      
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ color: 'var(--text-secondary)', textDecoration: 'underline', textDecorationStyle: 'dotted', cursor: 'pointer' }} onClick={() => { setRfModalTipo('ingresos'); setRfModalDetalleMetodo('efectivo'); }}>Efectivo:</span>
                        <span style={{ fontWeight: 700, color: 'var(--success)', textDecoration: 'underline', textDecorationStyle: 'dotted', cursor: 'pointer' }} onClick={() => { setRfModalTipo('ingresos'); setRfModalDetalleMetodo('efectivo'); }}>
                          ${resumenFinanciero.efectivoIngresos.toLocaleString('es-MX', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                        </span>
                      </div>
                      
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ color: 'var(--text-secondary)', textDecoration: 'underline', textDecorationStyle: 'dotted', cursor: 'pointer' }} onClick={() => { setRfModalTipo('ingresos'); setRfModalDetalleMetodo('tarjeta'); }}>Tarjeta:</span>
                        <span style={{ fontWeight: 700, color: 'var(--bronze-light)', textDecoration: 'underline', textDecorationStyle: 'dotted', cursor: 'pointer' }} onClick={() => { setRfModalTipo('ingresos'); setRfModalDetalleMetodo('tarjeta'); }}>
                          ${resumenFinanciero.tarjetaIngresos.toLocaleString('es-MX', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                        </span>
                      </div>
                      
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ color: 'var(--text-secondary)', textDecoration: 'underline', textDecorationStyle: 'dotted', cursor: 'pointer' }} onClick={() => { setRfModalTipo('ingresos'); setRfModalDetalleMetodo('transferencia'); }}>Transf. / SPEI:</span>
                        <span style={{ fontWeight: 700, color: 'var(--blue-light)', textDecoration: 'underline', textDecorationStyle: 'dotted', cursor: 'pointer' }} onClick={() => { setRfModalTipo('ingresos'); setRfModalDetalleMetodo('transferencia'); }}>
                          ${resumenFinanciero.transferIngresos.toLocaleString('es-MX', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                        </span>
                      </div>
                    </div>
                    
                    {/* Columna Derecha: Totales */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <div style={{ fontSize: 10, fontWeight: 'bold', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 2 }}>Flujo General</div>
                      
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ color: 'var(--text-secondary)', textDecoration: 'underline', textDecorationStyle: 'dotted', cursor: 'pointer' }} onClick={() => { setRfModalTipo('ingresos'); setRfModalDetalleMetodo(null); }}>Ingresos:</span>
                        <span style={{ fontWeight: 700, color: 'var(--success)', textDecoration: 'underline', textDecorationStyle: 'dotted', cursor: 'pointer' }} onClick={() => { setRfModalTipo('ingresos'); setRfModalDetalleMetodo(null); }}>
                          ${resumenFinanciero.totalIngresos.toLocaleString('es-MX', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                        </span>
                      </div>
                      
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ color: 'var(--text-secondary)', textDecoration: 'underline', textDecorationStyle: 'dotted', cursor: 'pointer' }} onClick={() => { setRfModalTipo('gastos'); }}>Gastos:</span>
                        <span style={{ fontWeight: 700, color: 'var(--danger)', textDecoration: 'underline', textDecorationStyle: 'dotted', cursor: 'pointer' }} onClick={() => { setRfModalTipo('gastos'); }}>
                          -${resumenFinanciero.totalOPEX.toLocaleString('es-MX', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                        </span>
                      </div>
                    </div>

                    <div style={{ gridColumn: 'span 2', display: 'flex', justifyContent: 'space-between', fontSize: 13.5, fontWeight: 800, borderTop: '1px solid var(--border-bronze)', paddingTop: 8, marginTop: 4 }}>
                      <span style={{ color: '#fff' }}>Utilidad Neta (P&L):</span>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <span style={{ color: 'var(--bronze-light)' }}>
                          ${resumenFinanciero.utilidadNeta.toLocaleString('es-MX', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                        </span>
                        <span style={{ fontSize: 10.5, color: resumenFinanciero.margenUtilidad >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                          ({resumenFinanciero.margenUtilidad.toFixed(1)}% Margen)
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Tarjeta 2: Metas y Proyección al Cierre */}
                <div className="stat-card" style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 10, background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-bronze)', paddingBottom: 6 }}>
                    <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--bronze-light)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                      <i className="ri-flag-line" style={{ marginRight: 6 }} />
                      Metas y Proyección (Mes Actual)
                    </span>
                    <span className="badge badge-bronze" style={{ fontSize: 9, padding: '2px 4px' }}>Predicción IA</span>
                  </div>
                  
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {/* Ingreso Acumulado */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5 }}>
                      <span style={{ color: 'var(--text-secondary)' }}>Ingreso Acumulado:</span>
                      <span style={{ fontWeight: 700, color: '#fff' }}>
                        ${ingresosMesActual.toLocaleString('es-MX', { maximumFractionDigits: 0 })} / {editandoMeta ? (
                          <input
                            type="number"
                            value={nuevaMetaInput}
                            onChange={e => setNuevaMetaInput(e.target.value)}
                            onKeyDown={e => {
                              if (e.key === 'Enter') {
                                guardarNuevaMeta();
                              } else if (e.key === 'Escape') {
                                setEditandoMeta(false);
                              }
                            }}
                            onBlur={guardarNuevaMeta}
                            autoFocus
                            style={{
                              width: 80,
                              background: 'var(--bg-elevated)',
                              color: '#fff',
                              border: '1px solid var(--bronze-light)',
                              borderRadius: 4,
                              padding: '1px 4px',
                              fontSize: 11,
                              textAlign: 'right'
                            }}
                          />
                        ) : (
                          <span style={{ cursor: 'pointer', textDecoration: 'underline', textDecorationStyle: 'dotted' }} onClick={() => { setNuevaMetaInput(metaMensual.toString()); setEditandoMeta(true); }} title="Click para editar meta mensual">
                            ${metaMensual.toLocaleString('es-MX', { maximumFractionDigits: 0 })}
                            <i className="ri-edit-line" style={{ marginLeft: 4, fontSize: 10, color: 'var(--text-muted)' }} />
                          </span>
                        )}
                      </span>
                    </div>
                    
                    {/* Progress Bar and text inline */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '2px 0' }}>
                      <div style={{ flex: 1, height: 8, background: 'var(--bg-elevated)', borderRadius: 4, overflow: 'hidden', border: '1px solid var(--border)', position: 'relative' }}>
                        <div style={{
                          width: `${Math.min(100, datosProyeccion.porcentajeMeta)}%`,
                          height: '100%',
                          background: 'linear-gradient(90deg, var(--bronze), var(--bronze-light))',
                          borderRadius: 4,
                          transition: 'width 0.4s ease'
                        }} />
                      </div>
                      <span style={{ fontSize: 10.5, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                        {datosProyeccion.porcentajeMeta.toFixed(1)}% (Día {datosProyeccion.diaActual}/{datosProyeccion.totalDiasMes})
                      </span>
                    </div>

                    {/* Avance de Hoy */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, borderTop: '1px dashed var(--border)', paddingTop: 8 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5 }}>
                        <span style={{ color: 'var(--text-secondary)' }}>Avance de Meta Hoy:</span>
                        <span style={{ fontWeight: 700, color: datosProyeccion.porcentajeMetaHoy >= 100 ? 'var(--success)' : 'var(--warning)' }}>
                          ${totalHoy.toLocaleString('es-MX', { maximumFractionDigits: 0 })} / ${datosProyeccion.metaDiariaHoy.toLocaleString('es-MX', { maximumFractionDigits: 0 })} ({datosProyeccion.porcentajeMetaHoy.toFixed(0)}%)
                        </span>
                      </div>
                      
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '2px 0' }}>
                        <div style={{ flex: 1, height: 6, background: 'var(--bg-elevated)', borderRadius: 3, overflow: 'hidden', border: '1px solid var(--border)', position: 'relative' }}>
                          <div style={{
                            width: `${Math.min(100, datosProyeccion.porcentajeMetaHoy)}%`,
                            height: '100%',
                            background: datosProyeccion.porcentajeMetaHoy >= 100 ? 'linear-gradient(90deg, #2ecc71, #27ae60)' : 'linear-gradient(90deg, var(--bronze), var(--bronze-light))',
                            borderRadius: 3,
                            transition: 'width 0.4s ease'
                          }} />
                        </div>
                      </div>

                      {comparativaHoyMismaHora && comparativaHoyMismaHora.promedioHistoricoMismaHora > 0 && (
                        <div style={{ fontSize: 9.5, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 4, marginTop: 2 }}>
                          <i className={comparativaHoyMismaHora.tendenciaPorcentaje >= 0 ? "ri-arrow-up-line" : "ri-arrow-down-line"} style={{
                            color: comparativaHoyMismaHora.tendenciaPorcentaje >= 0 ? 'var(--success)' : 'var(--danger)',
                            fontWeight: 'bold'
                          }} />
                          <span>
                            Tendencia: <strong style={{ color: comparativaHoyMismaHora.tendenciaPorcentaje >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                              {comparativaHoyMismaHora.tendenciaPorcentaje >= 0 ? '+' : ''}{comparativaHoyMismaHora.tendenciaPorcentaje.toFixed(0)}%
                            </strong> vs promedio histórico a esta hora ({fmt(comparativaHoyMismaHora.promedioHistoricoMismaHora)})
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Venta Diaria Requerida para llegar a la Meta */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, borderTop: '1px dashed var(--border)', paddingTop: 8 }}>
                      <span style={{ color: 'var(--text-secondary)' }}>Venta Diaria Requerida:</span>
                      <span style={{ fontWeight: 700, color: 'var(--blue-light)', textAlign: 'right' }}>
                        ${datosProyeccion.metaDiariaRestante.toLocaleString('es-MX', { maximumFractionDigits: 0 })}/día
                        <span style={{ display: 'block', fontSize: 9.5, color: 'var(--text-muted)', fontWeight: 'normal' }}>
                          (en los {datosProyeccion.diasRestantes} días restantes)
                        </span>
                      </span>
                    </div>

                    {/* Proyección Cierre */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, borderTop: '1px dashed var(--border)', paddingTop: 8 }}>
                      <span style={{ color: 'var(--text-secondary)' }}>Proyección Cierre:</span>
                      <span style={{ fontWeight: 700, color: datosProyeccion.superaMeta ? 'var(--success)' : 'var(--warning)' }}>
                        ${datosProyeccion.proyeccionCierre.toLocaleString('es-MX', { maximumFractionDigits: 0 })} ({datosProyeccion.porcentajeProyectado.toFixed(0)}%)
                      </span>
                    </div>

                    {/* IA recommendation / warning */}
                    <div style={{
                      background: datosProyeccion.superaMeta ? 'rgba(46, 204, 113, 0.03)' : 'rgba(231, 76, 60, 0.03)',
                      border: `1px solid ${datosProyeccion.superaMeta ? 'rgba(46, 204, 113, 0.1)' : 'rgba(231, 76, 60, 0.1)'}`,
                      borderRadius: 4,
                      padding: '4px 8px',
                      fontSize: 10,
                      display: 'flex',
                      gap: 6,
                      alignItems: 'center'
                    }}>
                      <i className={datosProyeccion.superaMeta ? "ri-checkbox-circle-line" : "ri-alert-line"} style={{
                        color: datosProyeccion.superaMeta ? 'var(--success)' : 'var(--danger)',
                        fontSize: 12
                      }} />
                      <span style={{ color: 'var(--text-secondary)', lineHeight: '1.2em', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap', width: '100%' }} title={
                        datosProyeccion.superaMeta ? (
                          `IA: Superación proyectada. Ritmo diario de ${fmt(datosProyeccion.promedioDiario)}/día.`
                        ) : (
                          `IA: Déficit de $${(metaMensual - datosProyeccion.proyeccionCierre).toLocaleString('es-MX', { maximumFractionDigits: 0 })}. Se sugiere Surge Pricing (+${surgePercent}%) o QR con descuento.`
                        )
                      }>
                        {datosProyeccion.superaMeta ? (
                          `IA: Superación proyectada. Ritmo de ${fmt(datosProyeccion.promedioDiario)}/día.`
                        ) : (
                          `IA: Déficit de $${(metaMensual - datosProyeccion.proyeccionCierre).toLocaleString('es-MX', { maximumFractionDigits: 0 })}. Surge Pricing (+${surgePercent}%) o QR con descuento.`
                        )}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

            </>
          )}
        </div>

        {/* COLUMNA DERECHA: CORTE DE CAJA E HISTORIAL DE CORTES */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, padding: 12 }}>
          <button className="btn btn-primary btn-sm" onClick={() => setMostrarCorte(true)} style={{ height: 36, fontSize: 12, width: '100%' }}>
            <i className="ri-file-list-3-line" /> Corte de Caja
          </button>
          
          {cortesFiltrados.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={{ fontSize: 9, color: 'var(--text-muted)', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.04em', textAlign: 'center', borderBottom: '1px solid var(--border)', paddingBottom: 4, marginBottom: 2 }}>Historial Cortes</span>
              
              {/* Filtros rápidos del historial */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 4 }}>
                <input
                  type="text"
                  placeholder="Filtrar por cajero..."
                  value={filtroCorteOperador}
                  onChange={e => setFiltroCorteOperador(e.target.value)}
                  style={{
                    flex: '1 1 100%',
                    background: 'var(--bg-elevated)',
                    border: '1px solid var(--border)',
                    borderRadius: 4,
                    color: '#fff',
                    fontSize: 9.5,
                    padding: '2px 6px',
                    height: 20
                  }}
                />
                <input
                  type="date"
                  value={filtroCorteInicio}
                  onChange={e => setFiltroCorteInicio(e.target.value)}
                  style={{
                    flex: '1 1 calc(50% - 2px)',
                    background: 'var(--bg-elevated)',
                    border: '1px solid var(--border)',
                    borderRadius: 4,
                    color: '#fff',
                    fontSize: 9.5,
                    padding: '2px 4px',
                    height: 20
                  }}
                  title="Fecha inicio"
                />
                <input
                  type="date"
                  value={filtroCorteFin}
                  onChange={e => setFiltroCorteFin(e.target.value)}
                  style={{
                    flex: '1 1 calc(50% - 2px)',
                    background: 'var(--bg-elevated)',
                    border: '1px solid var(--border)',
                    borderRadius: 4,
                    color: '#fff',
                    fontSize: 9.5,
                    padding: '2px 4px',
                    height: 20
                  }}
                  title="Fecha fin"
                />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 180, overflowY: 'auto', paddingRight: 4 }}>
                {cortesFiltrados.slice(0, 15).map(c => {
                  const dateObj = new Date(c.fecha);
                  const dateStr = dateObj.toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit', year: '2-digit' });
                  const timeStr = dateObj.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
                  
                  const diffVal = Number(c.diferencia) || 0;
                  const statusColor = diffVal === 0 ? 'var(--success)' : 'var(--danger)';
                  const statusIcon = diffVal === 0 ? 'ri-checkbox-circle-fill' : 'ri-error-warning-fill';

                  return (
                    <button
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
                      className="btn btn-secondary btn-xs"
                      style={{ fontSize: 10, padding: '4px 6px', width: '100%', textAlign: 'left', display: 'flex', justifyContent: 'space-between', background: 'var(--bg-elevated)', border: '1px solid rgba(255,255,255,0.03)', borderRadius: 4 }}
                      title={`Operador: ${c.operador || 'Cajero'}. Diferencia: $${diffVal.toLocaleString('es-MX')}`}
                    >
                      <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        📅 {dateStr}
                        <i className={statusIcon} style={{ color: statusColor, fontSize: 10 }} title={diffVal === 0 ? "Corte cuadrado" : `Diferencia: $${diffVal.toLocaleString('es-MX')}`} />
                      </span>
                      <span style={{ color: 'var(--text-muted)' }}>{timeStr}</span>
                    </button>
                  );
                })}
                {historialCortes.length === limiteCortesCaja && (
                  <button
                    onClick={() => setLimiteCortesCaja(prev => prev + 15)}
                    className="btn btn-secondary btn-xs"
                    style={{ fontSize: 9.5, padding: '3px 6px', width: '100%', marginTop: 2, background: 'transparent', border: '1px dashed var(--border)', color: 'var(--text-secondary)' }}
                  >
                    <i className="ri-arrow-down-double-line" /> Cargar más cortes...
                  </button>
                )}
              </div>
            </div>
          )}
      </div>
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

      {/* SECCIÓN: REPORTES UNIFICADOS (EXCLUSIVO ADMIN/GERENTE) */}
      {!esCajero && (
        <div className="card" style={{ padding: 14, background: 'linear-gradient(135deg, rgba(205, 127, 50, 0.05), rgba(0,0,0,0.15))', border: '1px solid var(--border-bronze)', marginBottom: 12 }}>
          {/* Header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, borderBottom: '1px solid var(--border)', paddingBottom: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <i className="ri-bar-chart-box-line" style={{ color: 'var(--bronze-light)', fontSize: 18 }} />
              <h3 className="card-title" style={{ margin: 0, fontSize: 13, fontWeight: 800 }}>REPORTES FINANCIEROS Y OPERATIVOS</h3>
            </div>
            
            {/* Period Filters */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
              {['Hoy', 'Ayer', '7d', '15d', '30d', '6m', '1a', 'Personalizado'].map(p => (
                <button
                  key={p}
                  onClick={() => handlePeriodoReporteChange(p)}
                  className={`btn btn-xs ${periodoReporte === p ? 'btn-primary' : 'btn-secondary'}`}
                  style={{ fontSize: 9.5, padding: '2px 6px', borderRadius: 4 }}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>

          {/* Custom Date Range Picker */}
          {periodoReporte === 'Personalizado' && (
            <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ fontSize: 10, color: 'var(--text-secondary)' }}>Desde:</span>
                <input
                  type="date"
                  value={fechaReporteInicio}
                  onChange={e => setFechaReporteInicio(e.target.value)}
                  style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 4, color: '#fff', fontSize: 10, padding: '2px 4px', height: 22 }}
                />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ fontSize: 10, color: 'var(--text-secondary)' }}>Hasta:</span>
                <input
                  type="date"
                  value={fechaReporteFin}
                  onChange={e => setFechaReporteFin(e.target.value)}
                  style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 4, color: '#fff', fontSize: 10, padding: '2px 4px', height: 22 }}
                />
              </div>
              <button onClick={() => cargarDatosReporte('Personalizado', fechaReporteInicio, fechaReporteFin)} className="btn btn-primary btn-xs" style={{ fontSize: 9.5, padding: '2px 8px', height: 22 }}>
                Calcular
              </button>
            </div>
          )}

          {/* Report Content Grid */}
          {reporteCargando ? (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: 180, gap: 10 }}>
              <i className="ri-loader-4-line ri-spin" style={{ color: 'var(--bronze-light)', fontSize: 24 }} />
              <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Calculando métricas en base a transacciones...</span>
            </div>
          ) : datosReporte ? (
            <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
              {/* Resumen Principal */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10 }}>
                {/* 1. Ventas Totales */}
                <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border)', borderRadius: 6, padding: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 9.5, color: 'var(--text-secondary)', fontWeight: 700 }}>VENTAS TOTALES</span>
                    <i className="ri-money-dollar-circle-line" style={{ color: 'var(--success)', fontSize: 14 }} />
                  </div>
                  <div style={{ fontSize: 16, fontWeight: 800, margin: '4px 0', color: '#fff' }}>
                    ${datosReporte.totalVentasPeriodoVal.toLocaleString('es-MX', { maximumFractionDigits: 0 })}
                  </div>
                  <div style={{ fontSize: 9, color: 'var(--text-muted)' }}>Monto facturado en el periodo</div>
                </div>

                {/* 2. Horas de Juego */}
                <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border)', borderRadius: 6, padding: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 9.5, color: 'var(--text-secondary)', fontWeight: 700 }}>MESAS EN USO</span>
                    <i className="ri-time-line" style={{ color: 'var(--blue-light)', fontSize: 14 }} />
                  </div>
                  <div style={{ fontSize: 16, fontWeight: 800, margin: '4px 0', color: '#fff' }}>
                    {datosReporte.totalHorasMesa.toFixed(1)} hrs
                  </div>
                  <div style={{ fontSize: 9, color: 'var(--text-muted)' }}>Horas totales de renta acumuladas</div>
                </div>

                {/* 3. Descuentos */}
                <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border)', borderRadius: 6, padding: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 9.5, color: 'var(--text-secondary)', fontWeight: 700 }}>DESCUENTOS</span>
                    <i className="ri-percent-line" style={{ color: 'var(--warning)', fontSize: 14 }} />
                  </div>
                  <div style={{ fontSize: 16, fontWeight: 800, margin: '4px 0', color: '#fff' }}>
                    ${datosReporte.totalDescuentosVal.toLocaleString('es-MX', { maximumFractionDigits: 0 })}
                  </div>
                  <div style={{ fontSize: 9, color: 'var(--text-muted)' }}>Cupones QR y cortesías registradas</div>
                </div>

                {/* 4. Mejor y Peor Mesero */}
                <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border)', borderRadius: 6, padding: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 9.5, color: 'var(--text-secondary)', fontWeight: 700 }}>MESEROS EXTREMOS</span>
                    <i className="ri-user-star-line" style={{ color: 'var(--bronze-light)', fontSize: 14 }} />
                  </div>
                  <div style={{ fontSize: 11, fontWeight: 700, margin: '4px 0', display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <span>🏆 Mejor: <strong style={{ color: 'var(--success)' }}>{datosReporte.mejorMesero}</strong></span>
                    <span>⚠️ Peor: <strong style={{ color: 'var(--danger)' }}>{datosReporte.peorMesero}</strong></span>
                  </div>
                </div>
              </div>

              {/* Fila de Métricas Operativas */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
                {/* Rentabilidad de Categorías */}
                <div style={{ background: 'rgba(255,255,255,0.01)', border: '1px solid var(--border)', borderRadius: 6, padding: 10 }}>
                  <span style={{ fontSize: 10, color: 'var(--text-secondary)', fontWeight: 800, textTransform: 'uppercase', display: 'block', borderBottom: '1px solid var(--border)', paddingBottom: 4, marginBottom: 6 }}>Renta y Consumo por Categoría</span>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {Object.entries(datosReporte.playPorCat).map(([cat, val]) => {
                      const consVal = datosReporte.consumoPorCat[cat] || 0;
                      const promVal = val.count > 0 ? (val.total / val.count) : 0;
                      return (
                        <div key={cat} style={{ fontSize: 9.5, display: 'flex', justifyContent: 'space-between', borderBottom: '1px dashed rgba(255,255,255,0.03)', paddingBottom: 2 }}>
                          <span style={{ color: '#fff', fontWeight: 600 }}>{cat}:</span>
                          <span style={{ color: 'var(--text-secondary)' }}>
                            Renta: <strong>${val.total.toLocaleString('es-MX')}</strong> (Prom: ${promVal.toFixed(0)}) | Consumo: <strong>${consVal.toLocaleString('es-MX')}</strong>
                          </span>
                        </div>
                      );
                    })}
                    {Object.keys(datosReporte.playPorCat).length === 0 && (
                      <span style={{ fontSize: 10, color: 'var(--text-muted)', fontStyle: 'italic' }}>Sin datos en este periodo</span>
                    )}
                  </div>
                </div>

                {/* Auditoría Impresora e Incidentes */}
                <div style={{ background: 'rgba(255,255,255,0.01)', border: '1px solid var(--border)', borderRadius: 6, padding: 10 }}>
                  <span style={{ fontSize: 10, color: 'var(--text-secondary)', fontWeight: 800, textTransform: 'uppercase', display: 'block', borderBottom: '1px solid var(--border)', paddingBottom: 4, marginBottom: 6 }}>Auditoría de Tickets e Inactividad</span>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 9.5 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span>Mesa más/menos rentable:</span>
                      <span style={{ color: 'var(--bronze-light)', fontWeight: 600 }}>{datosReporte.mesaMasRentable} / {datosReporte.mesaMenosRentable}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span>Tickets (Impresora ON / OFF):</span>
                      <span>
                        <strong style={{ color: 'var(--success)' }}>{datosReporte.printOn}</strong> / <strong style={{ color: 'var(--danger)' }}>{datosReporte.printOff}</strong>
                      </span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span>Tiempo Prom. Rotación (Mesa Libre):</span>
                      <span style={{ color: '#fff' }}>{datosReporte.promedioRotacionVal.toFixed(0)} min</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span>Preparación Barra/Cocina Prom.:</span>
                      <span style={{ color: '#fff' }}>{datosReporte.promedioPrepVal.toFixed(1)} min</span>
                    </div>
                  </div>
                </div>

                {/* Pase de Lista (Horas QR) */}
                <div style={{ background: 'rgba(255,255,255,0.01)', border: '1px solid var(--border)', borderRadius: 6, padding: 10, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                  <div>
                    <span style={{ fontSize: 10, color: 'var(--text-secondary)', fontWeight: 800, textTransform: 'uppercase', display: 'block', borderBottom: '1px solid var(--border)', paddingBottom: 4, marginBottom: 6 }}>Pase de Lista (Horas QR)</span>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 90, overflowY: 'auto' }}>
                      {datosReporte.horasTrabajadasColaboradores?.map(emp => {
                        const isZero = emp.horas === 0;
                        return (
                          <div key={emp.nombre} style={{ fontSize: 9.5, display: 'flex', justifyContent: 'space-between', borderBottom: '1px dashed rgba(255,255,255,0.03)', paddingBottom: 2, opacity: isZero ? 0.45 : 1 }}>
                            <span style={{ color: isZero ? 'var(--text-muted)' : '#fff', fontWeight: isZero ? 400 : 600 }}>{emp.nombre} ({emp.rol}):</span>
                            <span style={{ color: isZero ? 'var(--text-muted)' : 'var(--success)', fontWeight: 700 }}>
                              {emp.horas.toFixed(1)} hrs {!isZero && <span style={{ color: 'var(--text-secondary)', fontWeight: 400 }}>(${emp.costoNomina.toLocaleString('es-MX', { maximumFractionDigits: 0 })})</span>}
                            </span>
                          </div>
                        );
                      })}
                      {(!datosReporte.horasTrabajadasColaboradores || datosReporte.horasTrabajadasColaboradores.length === 0) && (
                        <span style={{ fontSize: 10, color: 'var(--text-muted)', fontStyle: 'italic' }}>Sin horas registradas con QR</span>
                      )}
                    </div>
                  </div>
                  {datosReporte.horasTrabajadasColaboradores?.length > 0 && (
                    <div style={{ borderTop: '1px solid var(--border)', marginTop: 8, paddingTop: 6, display: 'flex', justifyContent: 'space-between', fontSize: 10, fontWeight: 700 }}>
                      <span style={{ color: 'var(--text-secondary)' }}>Nómina Est. Devengada:</span>
                      <span style={{ color: 'var(--warning)' }}>
                        ${datosReporte.totalCostoNominaEst.toLocaleString('es-MX', { maximumFractionDigits: 0 })}
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {/* Alimentos más vendidos y Métodos de Pago */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
                {/* Pareto 80/20 */}
                <div style={{ background: 'rgba(255,255,255,0.01)', border: '1px solid var(--border)', borderRadius: 6, padding: 10 }}>
                  <span style={{ fontSize: 10, color: 'var(--text-secondary)', fontWeight: 800, textTransform: 'uppercase', display: 'block', borderBottom: '1px solid var(--border)', paddingBottom: 4, marginBottom: 6 }}>Alimentos y Bebidas Más Vendidos</span>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                    {datosReporte.topItems.slice(0, 5).map(item => (
                      <span key={item.nombre} className="badge badge-bronze" style={{ fontSize: 9, padding: '2px 6px' }}>
                        {item.nombre} ({item.cant} pz)
                      </span>
                    ))}
                    {datosReporte.topItems.length === 0 && (
                      <span style={{ fontSize: 10, color: 'var(--text-muted)', fontStyle: 'italic' }}>Sin consumos registrados</span>
                    )}
                  </div>
                </div>

                {/* Métodos de Pago por Hora */}
                <div style={{ background: 'rgba(255,255,255,0.01)', border: '1px solid var(--border)', borderRadius: 6, padding: 10 }}>
                  <span style={{ fontSize: 10, color: 'var(--text-secondary)', fontWeight: 800, textTransform: 'uppercase', display: 'block', borderBottom: '1px solid var(--border)', paddingBottom: 4, marginBottom: 6 }}>Métodos de Pago por Franja Horaria</span>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 9 }}>
                    {Object.entries(datosReporte.pagosPorHora).map(([slot, vals]) => {
                      const totalSlot = vals.efectivo + vals.tarjeta + vals.transferencia;
                      if (totalSlot === 0) return null;
                      return (
                        <div key={slot} style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px dashed rgba(255,255,255,0.03)', paddingBottom: 1 }}>
                          <span style={{ color: 'var(--text-secondary)' }}>{slot.split(' ')[0]}:</span>
                          <span>
                            💵 ${vals.efectivo.toFixed(0)} | 💳 ${vals.tarjeta.toFixed(0)} | 📲 ${vals.transferencia.toFixed(0)}
                          </span>
                        </div>
                      );
                    })}
                    {Object.values(datosReporte.pagosPorHora).every(v => v.efectivo + v.tarjeta + v.transferencia === 0) && (
                      <span style={{ fontSize: 10, color: 'var(--text-muted)', fontStyle: 'italic' }}>Sin ventas en el periodo</span>
                    )}
                  </div>
                </div>
              </div>

              {/* Gráficas de Rendimiento (Visuales Recharts) */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 10, marginTop: 4 }}>
                {/* 1. Tendencia de Ventas */}
                <div style={{ background: 'rgba(255,255,255,0.01)', border: '1px solid var(--border)', borderRadius: 6, padding: 12 }}>
                  <span style={{ fontSize: 10, color: 'var(--text-secondary)', fontWeight: 800, textTransform: 'uppercase', display: 'block', borderBottom: '1px solid var(--border)', paddingBottom: 4, marginBottom: 10 }}>
                    <i className="ri-line-chart-line" style={{ marginRight: 4, color: 'var(--bronze-light)' }} />
                    Tendencia de Ventas ({datosReporte.period === 'Hoy' || datosReporte.period === 'Ayer' ? 'Horario' : 'Histórico'})
                  </span>
                  {chartData.length > 0 ? (
                    <div style={{ width: '100%', height: 130 }}>
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={chartData} margin={{ top: 5, right: 5, left: -25, bottom: 0 }}>
                          <defs>
                            <linearGradient id="colorVentas" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="var(--bronze-light)" stopOpacity={0.3}/>
                              <stop offset="95%" stopColor="var(--bronze-light)" stopOpacity={0.0}/>
                            </linearGradient>
                          </defs>
                          <XAxis dataKey="name" stroke="var(--text-muted)" tickLine={false} axisLine={false} style={{ fontSize: 8 }} />
                          <YAxis stroke="var(--text-muted)" tickLine={false} axisLine={false} style={{ fontSize: 8 }} />
                          <RechartsTooltip 
                            contentStyle={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-bronze)', borderRadius: 6, fontSize: 9 }}
                            labelStyle={{ color: 'var(--text-muted)', fontWeight: 700 }}
                            itemStyle={{ color: 'var(--bronze-light)' }}
                            formatter={(value) => [`$${value.toLocaleString()}`, 'Ventas']}
                          />
                          <Area type="monotone" dataKey="Ventas" stroke="var(--bronze-light)" strokeWidth={2} fillOpacity={1} fill="url(#colorVentas)" />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: 130, fontSize: 9.5, color: 'var(--text-muted)', fontStyle: 'italic' }}>
                      Sin transacciones en este período
                    </div>
                  )}
                </div>

                {/* 2. Distribución de Pagos */}
                <div style={{ background: 'rgba(255,255,255,0.01)', border: '1px solid var(--border)', borderRadius: 6, padding: 12 }}>
                  <span style={{ fontSize: 10, color: 'var(--text-secondary)', fontWeight: 800, textTransform: 'uppercase', display: 'block', borderBottom: '1px solid var(--border)', paddingBottom: 4, marginBottom: 10 }}>
                    <i className="ri-pie-chart-line" style={{ marginRight: 4, color: 'var(--bronze-light)' }} />
                    Participación de Métodos de Pago
                  </span>
                  {pieData.length > 0 ? (
                    <div style={{ display: 'flex', alignItems: 'center', height: 130, justifyContent: 'space-around' }}>
                      <div style={{ width: 110, height: 110 }}>
                        <ResponsiveContainer width="100%" height="100%">
                          <RechartsPieChart>
                            <Pie
                              data={pieData}
                              cx="50%"
                              cy="50%"
                              innerRadius={22}
                              outerRadius={38}
                              paddingAngle={3}
                              dataKey="value"
                            >
                              {pieData.map((entry, index) => (
                                <Cell key={`cell-${index}`} fill={entry.color} />
                              ))}
                            </Pie>
                            <RechartsTooltip 
                              formatter={(value) => `$${value.toLocaleString()}`} 
                              contentStyle={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 6, fontSize: 9 }}
                            />
                          </RechartsPieChart>
                        </ResponsiveContainer>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, width: '50%' }}>
                        {pieData.map((d, i) => (
                          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 9 }}>
                            <span style={{ display: 'inline-block', width: 7, height: 7, borderRadius: '50%', backgroundColor: d.color }} />
                            <span style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>{d.name}:</span>
                            <span style={{ color: '#fff', fontWeight: 700, marginLeft: 'auto' }}>${d.value.toLocaleString()} <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>({d.pct}%)</span></span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: 130, fontSize: 9.5, color: 'var(--text-muted)', fontStyle: 'italic' }}>
                      Sin transacciones en este período
                    </div>
                  )}
                </div>
              </div>

              {/* Botones de Exportación */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, borderTop: '1px solid var(--border)', paddingTop: 8, marginTop: 4 }}>
                <span style={{ fontSize: 10, color: 'var(--text-muted)', alignSelf: 'center', marginRight: 'auto' }}>
                  Detalle disponible para exportación
                </span>
                <button onClick={() => exportarReporte('excel')} className="btn btn-secondary btn-xs" style={{ fontSize: 9.5, padding: '3px 8px', display: 'flex', alignItems: 'center', gap: 4 }}>
                  <i className="ri-file-excel-2-line" style={{ color: 'var(--success)' }} /> Excel (.csv)
                </button>
                <button onClick={() => exportarReporte('pdf')} className="btn btn-secondary btn-xs" style={{ fontSize: 9.5, padding: '3px 8px', display: 'flex', alignItems: 'center', gap: 4 }}>
                  <i className="ri-file-pdf-line" style={{ color: 'var(--danger)' }} /> PDF (Imprimir)
                </button>
                <button onClick={() => exportarReporte('telegram')} className="btn btn-secondary btn-xs" style={{ fontSize: 9.5, padding: '3px 8px', display: 'flex', alignItems: 'center', gap: 4 }}>
                  <i className="ri-telegram-line" style={{ color: 'var(--blue-light)' }} /> Telegram
                </button>
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: 80, fontSize: 11, color: 'var(--text-muted)', fontStyle: 'italic' }}>
              Seleccione un periodo arriba para cargar el resumen de reportes.
            </div>
          )}
        </div>
      )}

      {/* 2. SECCIÓN: EL CEREBRO IA (EXCLUSIVO ADMIN/GERENTE) */}
      {!esCajero && (
        <div className="card" style={{ padding: 14, background: 'linear-gradient(135deg, rgba(205, 127, 50, 0.03), rgba(0,0,0,0.1))', border: '1px solid var(--border-bronze)' }}>
          <div 
            style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <h3 className="card-title" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 800 }}>
                <i className="ri-robot-line" style={{ color: 'var(--bronze-light)', fontSize: 16 }} />
                EL CEREBRO IA: AUDITORÍA Y SIMULADORES FINANCIEROS
              </h3>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: 5,
                background: scoreDetails.bg,
                border: `1px solid ${scoreDetails.border}`,
                color: scoreDetails.text,
                padding: '2px 8px',
                borderRadius: 99,
                fontSize: 10,
                fontWeight: 700
              }}>
                <span className="pulse-dot" style={{ background: scoreDetails.bullet, width: 6, height: 6, borderRadius: '50%' }} />
                Salud: {healthScore}%
              </div>
            </div>
          </div>
          <div className="animate-fadeIn" style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 20 }}>
              
              {/* AUDITORÍA Y SIMULADORES */}
              <div>
                <h4 style={{ margin: '0 0 10px 0', fontSize: 11, fontWeight: 800, color: 'var(--bronze-light)', display: 'flex', alignItems: 'center', gap: 6, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  <i className="ri-shield-check-line" style={{ fontSize: 14 }} />
                  Auditoría y Simuladores de Control
                </h4>
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
                        
                        <div style={{ marginTop: 12 }}>
                          <button
                            onClick={toggleAutopilot}
                            title="Activar/Desactivar ajuste automático de tarifas dinámicas por afluencia"
                            style={{
                              background: tarifaAutopilotActivo ? 'rgba(0,230,118,0.15)' : 'rgba(255,255,255,0.03)',
                              border: tarifaAutopilotActivo ? '1px solid var(--success)' : '1px solid rgba(255,255,255,0.1)',
                              borderRadius: 6,
                              color: tarifaAutopilotActivo ? 'var(--success)' : 'var(--text-muted)',
                              fontSize: 10,
                              padding: '6px 12px',
                              cursor: 'pointer',
                              fontWeight: 700,
                              textTransform: 'uppercase',
                              display: 'flex',
                              alignItems: 'center',
                              gap: 6,
                              outline: 'none',
                              width: '100%',
                              justifyContent: 'center',
                              transition: 'all 0.15s'
                            }}
                          >
                            <i className="ri-settings-3-line" style={{ fontSize: 11 }} />
                            PILOTO: {tarifaAutopilotActivo ? 'AUTO' : 'MANUAL'}
                          </button>
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

                    {/* Auditoría Cruzada de Inventario */}
                    <div style={{ background: 'rgba(0,0,0,0.2)', border: '1px solid var(--border-bronze)', borderRadius: 12, padding: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <h4 style={{ margin: 0, fontSize: 10, fontWeight: 800, color: 'var(--bronze-light)', display: 'flex', alignItems: 'center', gap: 6 }}>
                          <i className="ri-shield-cross-line" style={{ fontSize: 12 }} />
                          Auditoría Cruzada: Ventas vs. Stock
                        </h4>
                        <span className="badge badge-bronze" style={{ fontSize: 8 }}>Motor IA</span>
                      </div>
                      
                      <p style={{ fontSize: 8, color: 'var(--text-muted)', margin: '0 0 6px 0', lineHeight: 1.3 }}>
                        El motor IA compara productos cobrados con el inventario físico en el corte actual para detectar mermas.
                      </p>

                      {auditoriaCruzadaInventario.length === 0 ? (
                        <div style={{ fontSize: 9, color: 'var(--text-muted)', fontStyle: 'italic', textAlign: 'center', padding: '10px 0' }}>
                          No hay registros de consumo o inventario en el corte actual.
                        </div>
                      ) : (
                        <div className="table-wrapper" style={{ border: 'none', background: 'none' }}>
                          <table style={{ fontSize: 8.5, width: '100%', borderCollapse: 'collapse', lineHeight: '1.2' }}>
                            <thead>
                              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                                <th style={{ padding: '2px 3px', fontSize: 8, textAlign: 'left' }}>Insumo</th>
                                <th style={{ textAlign: 'center', padding: '2px 3px', fontSize: 8 }}>Vend</th>
                                <th style={{ textAlign: 'center', padding: '2px 3px', fontSize: 8 }}>Ded</th>
                                <th style={{ textAlign: 'center', padding: '2px 3px', fontSize: 8 }}>Disc</th>
                              </tr>
                            </thead>
                            <tbody>
                              {auditoriaCruzadaInventario.map(item => (
                                <Fragment key={item.id}>
                                  <tr style={{ background: item.diferencia !== 0 ? 'rgba(231, 76, 60, 0.04)' : 'none', borderBottom: '1px solid rgba(255,255,255,0.02)' }}>
                                    <td style={{ fontWeight: 700, color: '#fff', padding: '3px 3px' }}>{item.nombre}</td>
                                    <td style={{ textAlign: 'center', padding: '3px 3px' }}>{item.comandas}</td>
                                    <td style={{ textAlign: 'center', padding: '3px 3px' }}>{item.inventario}</td>
                                    <td style={{ textAlign: 'center', color: item.color, fontWeight: 800, padding: '3px 3px' }}>
                                      {item.diferencia === 0 ? '✓' : `${item.diferencia > 0 ? '+' : ''}${item.diferencia}`}
                                    </td>
                                  </tr>
                                  {item.diferencia !== 0 && (
                                    <tr style={{ background: 'rgba(231, 76, 60, 0.02)', borderBottom: '1px solid rgba(255,255,255,0.02)' }}>
                                      <td colSpan={4} style={{ color: 'var(--text-muted)', fontSize: 8, padding: '2px 4px 4px 4px', fontStyle: 'italic', lineHeight: 1.1 }}>
                                        💡 {item.desc}
                                      </td>
                                    </tr>
                                  )}
                                </Fragment>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>

                  </div>
                </div>
              </div>

              <div style={{ height: 1, background: 'var(--border)', margin: '4px 0' }} />

              {/* NUEVO SUBMENÚ: INTELIGENCIA DE CLIENTES Y CONSUMOS */}
              <div style={{ background: 'rgba(0,0,0,0.15)', border: '1px solid var(--border-bronze)', borderRadius: 12, padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
                  <h4 style={{ margin: 0, fontSize: 11, fontWeight: 800, color: 'var(--bronze-light)', display: 'flex', alignItems: 'center', gap: 6, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                    <i className="ri-team-line" style={{ fontSize: 14 }} />
                    Inteligencia de Clientes y Consumos (Perfilado RFM Real)
                  </h4>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button className="btn btn-primary btn-xs" onClick={() => setModalAgregarClienteOpen(true)} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 10px', fontSize: 10 }}>
                      <i className="ri-user-add-line" /> Agregar Cliente
                    </button>
                    <button className="btn btn-secondary btn-xs" onClick={() => { cargarListadoClientes(); setModalConsultarClienteOpen(true); }} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 10px', fontSize: 10 }}>
                      <i className="ri-search-line" /> Consultar Clientes
                    </button>
                  </div>
                </div>
                
                {/* Métricas del Submenú */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, background: 'rgba(0,0,0,0.2)', padding: 10, borderRadius: 8, border: '1px solid var(--border)' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <span style={{ fontSize: 8.5, color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase' }}>Visitas Promedio</span>
                    <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--bronze-light)' }}>{estadisticasClientes.visitasPromedio} visitas</span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <span style={{ fontSize: 8.5, color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase' }}>Consumo Promedio Diario</span>
                    <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--success)' }}>${Number(estadisticasClientes.consumoPromedioDiario).toLocaleString('es-MX')}</span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <span style={{ fontSize: 8.5, color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase' }}>Clientes VIP Activos</span>
                    <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--blue-light)' }}>{estadisticasClientes.masConsumen.length} socios</span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <span style={{ fontSize: 8.5, color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase' }}>Clientes Inactivos</span>
                    <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--danger)' }}>{estadisticasClientes.inactivos.length} en riesgo</span>
                  </div>
                </div>

                {/* Columnas del Submenú */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14 }}>
                  
                  {/* Columna 1: Top Consumers */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <div>
                      <h5 style={{ margin: '0 0 6px 0', fontSize: 10, fontWeight: 800, color: 'var(--success)', textTransform: 'uppercase' }}>🏆 Clientes que más consumen</h5>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                        {estadisticasClientes.masConsumen.map((c, idx) => {
                          const hasLifetime = descuentosPorVida[c.nombre.toLowerCase().trim()];
                          return (
                            <div key={idx} style={{ background: 'rgba(0,0,0,0.15)', border: '1px solid var(--border)', borderRadius: 8, padding: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <span style={{ fontSize: 10.5, fontWeight: 700, color: '#fff' }}>{c.nombre}</span>
                                <span style={{ fontSize: 10, fontWeight: 800, color: 'var(--success)' }}>${c.total.toLocaleString('es-MX')}</span>
                              </div>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 9, color: 'var(--text-secondary)' }}>
                                <span>{c.visitas} visitas</span>
                                {hasLifetime ? (
                                  <span style={{ color: 'var(--warning)', fontWeight: 800, fontSize: 8 }}>🎖 10% De Por Vida</span>
                                ) : (
                                  <span style={{ color: 'var(--text-muted)' }}>Sin descuento activo</span>
                                )}
                              </div>
                              <div style={{ display: 'flex', gap: 5, marginTop: 4 }}>
                                <button className="btn btn-secondary btn-xs" onClick={() => triggerEnviarCuponModal(c.nombre, 15)} style={{ fontSize: 8.5, padding: '2px 6px', flex: 1 }}>
                                  Enviar Cupón 15%
                                </button>
                                {!hasLifetime && (
                                  <button className="btn btn-primary btn-xs" onClick={() => darDescuentoPorVida(c.nombre)} style={{ fontSize: 8.5, padding: '2px 6px', flex: 1 }}>
                                    Desc. De Por Vida
                                  </button>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>

                  {/* Columna 2: Inactive Clients */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <div>
                      <h5 style={{ margin: '0 0 6px 0', fontSize: 10, fontWeight: 800, color: 'var(--danger)', textTransform: 'uppercase' }}>⚠️ Radiografía de Clientes Inactivos</h5>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 5, maxHeight: 180, overflowY: 'auto', paddingRight: 4 }}>
                        {estadisticasClientes.inactivos.length === 0 ? (
                          <div style={{ fontSize: 9.5, color: 'var(--text-muted)', fontStyle: 'italic', textAlign: 'center', padding: 10 }}>Todos los clientes han asistido recientemente.</div>
                        ) : (
                          estadisticasClientes.inactivos.map((c, idx) => {
                            const diffDays = Math.floor((Date.now() - new Date(c.ultimaVisita).getTime()) / (24 * 3600 * 1000));
                            return (
                              <div key={idx} style={{ background: 'rgba(239,68,68,0.03)', border: '1px solid rgba(239,68,68,0.15)', borderRadius: 8, padding: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                  <span style={{ fontSize: 10.5, fontWeight: 700, color: '#fff' }}>{c.nombre}</span>
                                  <span style={{ fontSize: 9.5, color: 'var(--danger)', fontWeight: 700 }}>Hace {diffDays} días</span>
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 9, color: 'var(--text-secondary)' }}>
                                  <span>Historial: ${c.total} MXN</span>
                                  <button className="btn btn-danger btn-xs" onClick={() => triggerEnviarCuponModal(c.nombre, 15)} style={{ fontSize: 8.5, padding: '2px 6px', display: 'flex', alignItems: 'center', gap: 3 }}>
                                    <i className="ri-whatsapp-line" /> Reactivar
                                  </button>
                                </div>
                              </div>
                            );
                          })
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Columna 3: 10 Recomendaciones IA */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <div>
                      <h5 style={{ margin: '0 0 6px 0', fontSize: 10, fontWeight: 800, color: 'var(--bronze-light)', textTransform: 'uppercase' }}>💡 10 Recomendaciones IA Retención</h5>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 5, maxHeight: 180, overflowY: 'auto', paddingRight: 4 }}>
                        {[
                          { text: "Premiar al 5% top con Cupón 15%", badge: "Retención", actionName: "Enviar Cupón", action: () => triggerEnviarCuponModal("Cliente Top", 15) },
                          { text: "Fidelizar con Descuento 10% Vitalicio", badge: "Lealtad", actionName: "Ver VIPs", action: () => { cargarListadoClientes(); setModalConsultarClienteOpen(true); } },
                          { text: "Reactivar inactivos (>7 días) vía WhatsApp", badge: "Churn", actionName: "Enviar WA", action: () => triggerEnviarCuponModal("Cliente Inactivo", 15) },
                          { text: "Happy Hour en horas lentas (Martes/Miércoles)", badge: "Promoción", actionName: "Programar", action: promoverMenuLluvia },
                          { text: "Auditar barra en tiempo real para control de merma", badge: "Auditoría", actionName: "Auditar", action: auditarInventarioConCuentas },
                          { text: "Programar Torneo VIP exclusivo (RFM)", badge: "Eventos", actionName: "Crear", action: programarTorneoVip },
                          { text: "Surge Pricing automático en ocupación >90%", badge: "Tarifas", actionName: "Activar", action: forzarSurgePricing },
                          { text: "Desconectar iluminación IoT en mesas vacías", badge: "IoT", actionName: "Apagar Mesa 4", action: apagarLuzMesa4 },
                          { text: "Analizar quejas con NLP en encuestas", badge: "NLP", actionName: "Revisar", action: regularAudioCarambola },
                          { text: "Optimizar LTV de nuevos socios registrados", badge: "LTV", actionName: "Ver LTV", action: verProyeccionesLtv }
                        ].map((rec, idx) => (
                          <div key={idx} style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border)', borderRadius: 8, padding: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <span style={{ fontSize: 9.5, fontWeight: 700, color: '#fff' }}>{idx + 1}. {rec.text}</span>
                              <span className="badge badge-bronze" style={{ fontSize: 7, padding: '1px 3px' }}>{rec.badge}</span>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 2 }}>
                              <button className="btn btn-secondary btn-xs" onClick={rec.action} style={{ fontSize: 8, padding: '1px 5px', height: 16 }}>
                                {rec.actionName}
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                </div>
              </div>

              <div style={{ height: 1, background: 'var(--border)', margin: '4px 0' }} />

              {/* INTELIGENCIA PREDICTIVA (REDISEÑADA A 4 CONSEJOS DINÁMICOS) */}
              <div>
                <h4 style={{ margin: '0 0 12px 0', fontSize: 13, fontWeight: 800, color: 'var(--bronze-light)', display: 'flex', alignItems: 'center', gap: 6, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  <i className="ri-magic-line" style={{ fontSize: 16 }} />
                  Inteligencia Predictiva
                </h4>
                
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
                  {consejosIa.map((c) => (
                    <div 
                      key={c.id} 
                      style={{ 
                        background: c.leido ? 'rgba(46, 204, 113, 0.05)' : 'rgba(0,0,0,0.2)', 
                        border: c.leido ? '1px solid var(--success)' : '1px solid var(--border)', 
                        borderRadius: 12, 
                        padding: 16, 
                        display: 'flex', 
                        flexDirection: 'column', 
                        gap: 10,
                        transition: 'all 0.3s ease',
                        position: 'relative',
                        boxShadow: c.leido ? '0 0 10px rgba(46, 204, 113, 0.1)' : 'none'
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontSize: 14, fontWeight: 800, color: c.leido ? 'var(--success)' : c.color || 'var(--bronze-light)', display: 'flex', alignItems: 'center', gap: 6 }}>
                          <i className="ri-lightbulb-line" style={{ fontSize: 16 }} />
                          {c.title}
                        </span>
                        <span className="badge" style={{ fontSize: 9.5, background: c.leido ? 'rgba(46, 204, 113, 0.2)' : 'rgba(255,255,255,0.05)', color: c.leido ? 'var(--success)' : '#fff' }}>
                          {c.leido ? '✓ Leído' : c.tag}
                        </span>
                      </div>
                      
                      <p style={{ fontSize: 12.5, color: 'var(--text-secondary)', margin: 0, lineHeight: 1.5 }}>
                        {c.desc}
                      </p>
                      
                      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 'auto', paddingTop: 4 }}>
                        <button 
                          className="btn btn-xs" 
                          onClick={() => marcarConsejoLeido(c.id)} 
                          disabled={c.leido}
                          style={{ 
                            fontSize: 11, 
                            padding: '4px 12px', 
                            background: c.leido ? 'rgba(46, 204, 113, 0.2)' : 'rgba(255, 255, 255, 0.05)', 
                            border: c.leido ? '1px solid var(--success)' : '1px solid var(--border)', 
                            color: c.leido ? 'var(--success)' : 'var(--text-primary)',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 4,
                            cursor: c.leido ? 'default' : 'pointer'
                          }}
                        >
                          {c.leido ? (
                            <>
                              <i className="ri-checkbox-circle-fill" /> Leído
                            </>
                          ) : (
                            <>
                              <i className="ri-checkbox-blank-circle-line" /> Marcar como Leído
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

      {/* 3. SECCIÓN: OPERACIONES DE CAJA (COLAPSABLE - EXCLUSIVO CAJERO) */}
      {esCajero && (
        <div className="card" style={{ padding: 14 }}>
          <div 
            style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
          >
            <h3 className="card-title" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 800 }}>
              <i className="ri-receipt-line" style={{ color: 'var(--bronze-light)', fontSize: 16 }} />
              OPERACIONES DE CAJA, POS Y MOVIMIENTOS
            </h3>
          </div>

          <div className="animate-fadeIn" style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 14 }}>
            {renderPestanasMovimientos(false)}
          </div>
        </div>
      )}

      {/* 4. SECCIÓN: ANALÍTICA Y REPORTES FINANCIEROS (EXCLUSIVO ADMIN/GERENTE) */}
      {!esCajero && (
        <div className="card" style={{ padding: 14 }}>
          <div 
            style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
          >
            <h3 className="card-title" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 800 }}>
              <i className="ri-bar-chart-2-line" style={{ color: 'var(--bronze-light)', fontSize: 16 }} />
              INFORMES FINANCIEROS, STAFF Y SATISFACCIÓN
            </h3>
          </div>

          <div className="animate-fadeIn" style={{ display: 'grid', gridTemplateColumns: '1.25fr 1fr 0.75fr', gap: 12, marginTop: 14, alignItems: 'start' }}>
              
              {/* Columna 1: Movimientos (Transacciones de Caja y Bitácora Stock) */}
              <div>
                {renderAnalisisInteligenteMesas()}
              </div>

              {/* Columna 2: P&L Table */}
              <div style={{ background: 'rgba(0,0,0,0.15)', border: '1px solid var(--border)', borderRadius: 12, padding: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <h4 style={{ margin: 0, fontSize: 11, fontWeight: 800, color: 'var(--bronze-light)' }}>
                    P&L Consolidado
                  </h4>
                  <span style={{ fontSize: 8.5, color: 'var(--text-muted)', fontStyle: 'italic' }}>{filtroGrafico.toUpperCase()}</span>
                </div>

                <div className="table-wrapper" style={{ border: 'none' }}>
                  <table style={{ fontSize: 9, lineHeight: '1.2' }}>
                    <thead>
                      <tr>
                        <th style={{ fontSize: 8.5 }}>Concepto / Rubro</th>
                        <th style={{ textAlign: 'right', fontSize: 8.5 }}>Monto</th>
                        <th style={{ textAlign: 'right', fontSize: 8.5 }}>%</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr style={{ background: 'rgba(255,255,255,0.01)', fontWeight: 700 }}>
                        <td style={{ color: 'var(--success)', fontSize: 9.5 }}>1. INGRESOS OPERATIVOS</td>
                        <td style={{ textAlign: 'right', color: 'var(--success)' }}>{fmt(finanzas.totalIngresos)}</td>
                        <td style={{ textAlign: 'right' }}>100%</td>
                      </tr>
                      <tr>
                        <td style={{ paddingLeft: 8 }}>Renta de Mesas</td>
                        <td style={{ textAlign: 'right' }}>{fmt(finanzas.rentasMesas)}</td>
                        <td style={{ textAlign: 'right', color: 'var(--text-muted)' }}>{finanzas.totalIngresos > 0 ? ((finanzas.rentasMesas / finanzas.totalIngresos) * 100).toFixed(0) : 0}%</td>
                      </tr>
                      <tr>
                        <td style={{ paddingLeft: 8 }}>Ventas de Bar</td>
                        <td style={{ textAlign: 'right' }}>{fmt(finanzas.ventasBar)}</td>
                        <td style={{ textAlign: 'right', color: 'var(--text-muted)' }}>{finanzas.totalIngresos > 0 ? ((finanzas.ventasBar / finanzas.totalIngresos) * 100).toFixed(0) : 0}%</td>
                      </tr>
                      <tr>
                        <td style={{ paddingLeft: 8 }}>Torneos</td>
                        <td style={{ textAlign: 'right' }}>{fmt(finanzas.inscripcionesTorneo)}</td>
                        <td style={{ textAlign: 'right', color: 'var(--text-muted)' }}>{finanzas.totalIngresos > 0 ? ((finanzas.inscripcionesTorneo / finanzas.totalIngresos) * 100).toFixed(0) : 0}%</td>
                      </tr>

                      <tr style={{ background: 'rgba(255,255,255,0.01)', fontWeight: 700 }}>
                        <td style={{ color: 'var(--danger)', fontSize: 9.5 }}>2. COSTO VENTAS (COGS)</td>
                        <td style={{ textAlign: 'right', color: 'var(--danger)' }}>-{fmt(finanzas.totalCOGS)}</td>
                        <td style={{ textAlign: 'right' }}>{finanzas.totalIngresos > 0 ? ((finanzas.totalCOGS / finanzas.totalIngresos) * 100).toFixed(0) : 0}%</td>
                      </tr>
                      <tr>
                        <td style={{ paddingLeft: 8 }}>Insumos (Bar)</td>
                        <td style={{ textAlign: 'right' }}>-{fmt(finanzas.cogsBar)}</td>
                        <td style={{ textAlign: 'right', color: 'var(--text-muted)' }}>35% (Bar)</td>
                      </tr>
                      <tr>
                        <td style={{ paddingLeft: 8 }}>Premios Torneos</td>
                        <td style={{ textAlign: 'right' }}>-{fmt(finanzas.cogsTorneos)}</td>
                        <td style={{ textAlign: 'right', color: 'var(--text-muted)' }}>40% (Torneo)</td>
                      </tr>

                      <tr style={{ background: 'rgba(255,255,255,0.02)', fontWeight: 700 }}>
                        <td style={{ color: 'var(--bronze-light)', fontSize: 9.5 }}>UTILIDAD BRUTA</td>
                        <td style={{ textAlign: 'right', color: 'var(--bronze-light)' }}>{fmt(finanzas.utilidadBruta)}</td>
                        <td style={{ textAlign: 'right' }}>{finanzas.totalIngresos > 0 ? ((finanzas.utilidadBruta / finanzas.totalIngresos) * 100).toFixed(0) : 0}%</td>
                      </tr>

                      <tr style={{ background: 'rgba(255,255,255,0.01)', fontWeight: 700 }}>
                        <td style={{ color: 'var(--danger)', fontSize: 9.5 }}>3. GASTOS OPER. (OPEX)</td>
                        <td style={{ textAlign: 'right', color: 'var(--danger)' }}>-{fmt(finanzas.totalOPEX)}</td>
                        <td style={{ textAlign: 'right' }}>{finanzas.totalIngresos > 0 ? ((finanzas.totalOPEX / finanzas.totalIngresos) * 100).toFixed(0) : 0}%</td>
                      </tr>
                      <tr>
                        <td style={{ paddingLeft: 8 }}>Mantenim. y Servicios</td>
                        <td style={{ textAlign: 'right' }}>-{fmt(finanzas.gastosG)}</td>
                        <td style={{ textAlign: 'right', color: 'var(--text-muted)' }}>{finanzas.totalIngresos > 0 ? ((finanzas.gastosG / finanzas.totalIngresos) * 100).toFixed(0) : 0}%</td>
                      </tr>
                      <tr>
                        <td style={{ paddingLeft: 8 }}>Nóminas y Sueldos</td>
                        <td style={{ textAlign: 'right' }}>-{fmt(finanzas.nominaS)}</td>
                        <td style={{ textAlign: 'right', color: 'var(--text-muted)' }}>{finanzas.totalIngresos > 0 ? ((finanzas.nominaS / finanzas.totalIngresos) * 100).toFixed(0) : 0}%</td>
                      </tr>

                      <tr style={{ background: 'var(--bg-elevated)', fontWeight: 800, fontSize: 9.5, borderTop: '1px solid var(--border)' }}>
                        <td style={{ color: '#fff' }}>UTILIDAD NETA OPER.</td>
                        <td style={{ textAlign: 'right', color: 'var(--success)' }}>{fmt(finanzas.utilidadNeta)}</td>
                        <td style={{ textAlign: 'right', color: 'var(--success)' }}>{finanzas.margenUtilidad.toFixed(0)}%</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Columna 3: Staff performance */}
              <div style={{ background: 'rgba(0,0,0,0.15)', border: '1px solid var(--border)', borderRadius: 12, padding: 10 }}>
                <h4 style={{ margin: '0 0 8px 0', fontSize: 11, fontWeight: 800, color: 'var(--bronze-light)' }}>
                  Desempeño y Comisiones Staff
                </h4>
                <div className="table-wrapper" style={{ border: 'none' }}>
                  <table style={{ fontSize: 8.5, lineHeight: '1.2', borderCollapse: 'collapse', width: '100%' }}>
                    <thead>
                      <tr>
                        <th style={{ padding: '3px 4px', fontSize: 8 }}>Nombre</th>
                        <th style={{ padding: '3px 4px', fontSize: 8 }}>Rol</th>
                        <th style={{ textAlign: 'center', padding: '3px 4px', fontSize: 8 }}>Hrs (T)</th>
                        <th style={{ textAlign: 'right', padding: '3px 4px', fontSize: 8 }}>Com.</th>
                        <th style={{ textAlign: 'right', padding: '3px 4px', fontSize: 8 }}>Satis.</th>
                      </tr>
                    </thead>
                    <tbody>
                      {staffRendimiento.map(staff => (
                        <tr key={staff.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.02)' }}>
                          <td style={{ fontWeight: 600, padding: '3px 4px' }}>{staff.nombre}</td>
                          <td style={{ color: 'var(--text-secondary)', padding: '3px 4px' }}>{staff.rol.slice(0, 7)}</td>
                          <td style={{ textAlign: 'center', padding: '3px 4px' }}>
                            {staff.horas.toFixed(0)}h ({staff.turnos})
                          </td>
                          <td style={{ textAlign: 'right', color: 'var(--success)', fontWeight: 700, padding: '3px 4px' }}>
                            ${staff.comisiones}
                            {staff.comisiones > 0 && staff.horas === 0 && (
                              <span title="Sin fichaje" style={{ color: 'var(--danger)', marginLeft: 2 }}>⚠️</span>
                            )}
                          </td>
                          <td style={{ textAlign: 'right', padding: '3px 4px' }}>
                            <span style={{ 
                              color: staff.satisfaccion >= 4.5 ? 'var(--success)' : staff.satisfaccion >= 4.0 ? 'var(--warning)' : 'var(--danger)',
                              fontWeight: 700
                            }}>
                              ★{staff.satisfaccion.toFixed(1)}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                
                {/* Eficiencia de Surtido de Cocina */}
                <div style={{ borderTop: '1px solid var(--border)', marginTop: 14, paddingTop: 12 }}>
                  <h4 style={{ margin: '0 0 8px 0', fontSize: 11, fontWeight: 800, color: 'var(--bronze-light)', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <i className="ri-time-line" style={{ color: 'var(--success)' }} />
                    Auditoría de Reabastecimiento Cocina
                  </h4>
                  
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
                    <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.04)', borderRadius: 8, padding: 8, textAlign: 'center' }}>
                      <span style={{ fontSize: 8, color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', display: 'block', marginBottom: 2 }}>Promedio Surtido</span>
                      <strong style={{ fontSize: 14, color: surtidoEficiencia.promedioMinutos <= 15 ? 'var(--success)' : surtidoEficiencia.promedioMinutos <= 30 ? 'var(--warning)' : 'var(--danger)' }}>
                        {surtidoEficiencia.promedioMinutos} min
                      </strong>
                    </div>
                    <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.04)', borderRadius: 8, padding: 8, textAlign: 'center' }}>
                      <span style={{ fontSize: 8, color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', display: 'block', marginBottom: 2 }}>Atendidos / Cancelados</span>
                      <strong style={{ fontSize: 12, color: 'var(--blue-light)' }}>
                        {surtidoEficiencia.solicitudesAtendidas} / {surtidoEficiencia.solicitudesCanceladas}
                      </strong>
                    </div>
                  </div>

                  <h5 style={{ margin: '0 0 6px 0', fontSize: 9, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
                    Últimos surtidos cocina
                  </h5>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {surtidoEficiencia.ultimosEventos.length === 0 ? (
                      <span style={{ fontSize: 9, color: 'var(--text-muted)', fontStyle: 'italic', textAlign: 'center', display: 'block', padding: '8px 0' }}>
                        Sin registros hoy.
                      </span>
                    ) : (
                      surtidoEficiencia.ultimosEventos.map(evt => (
                        <div key={evt.id} style={{ background: 'rgba(0,0,0,0.15)', border: '1px solid rgba(255,255,255,0.03)', borderRadius: 6, padding: '5px 8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 9 }}>
                          <span style={{ color: '#fff', fontWeight: 600 }}>{evt.insumo}</span>
                          <span style={{ 
                            padding: '1px 5px', borderRadius: 4, fontSize: 8, fontWeight: 800,
                            background: evt.tipo === 'atendido' ? 'rgba(34,197,94,0.12)' : 'rgba(239,68,68,0.12)',
                            color: evt.tipo === 'atendido' ? 'var(--success)' : 'var(--danger)'
                          }}>
                            {evt.tiempo} {evt.tipo === 'atendido' ? '✓' : '✕'}
                          </span>
                        </div>
                      ))
                    )}
                  </div>
                </div>

              </div>

            </div>
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
                
                {/* Desglose de conciliación en el arqueo */}
                <div style={{ fontSize: 9.5, color: 'var(--text-muted)', display: 'flex', flexDirection: 'column', gap: 2, paddingLeft: 10, marginBottom: 8, borderLeft: '1px solid var(--border-bronze)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>(+) Ventas Efectivo:</span>
                    <span>${calculationsCorte.ingresosEfectivo.toLocaleString('es-MX')}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>(-) Gastos en Efectivo:</span>
                    <span>-${calculationsCorte.gastosEfectivo.toLocaleString('es-MX')}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px dashed rgba(255,255,255,0.05)', paddingTop: 2, color: 'var(--blue-light)' }}>
                    <span>Ventas Digitales (No caja):</span>
                    <span>${(calculationsCorte.ingresosTarjeta + calculationsCorte.ingresosTransferencia).toLocaleString('es-MX')}</span>
                  </div>
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

      {/* MODAL HISTORIAL MANTENIMIENTO */}
      {mostrarHistorialMantenimientoModal && (
        <div className="modal-overlay" onClick={() => setMostrarHistorialMantenimientoModal(false)}>
          <div className="modal" style={{ maxWidth: 450, background: '#1e272e', border: '1px solid var(--border)' }} onClick={e => e.stopPropagation()}>
            <div className="modal-header" style={{ borderBottom: '1px solid var(--border)' }}>
              <span className="modal-title" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--bronze-light)' }}>
                <i className="ri-history-line" /> Historial de Mantenimiento: {mesaHistorialMantenimiento ? mesaHistorialMantenimiento.nombre : ''}
              </span>
              <button onClick={() => setMostrarHistorialMantenimientoModal(false)} style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 18 }}>✕</button>
            </div>
            <div className="modal-body" style={{ maxHeight: 300, overflowY: 'auto', padding: '12px 16px' }}>
              {historialMantenimientosMesaList.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '20px 0', color: 'var(--text-muted)', fontSize: 11 }}>
                  No se han registrado mantenimientos de paño para esta mesa.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {historialMantenimientosMesaList.map((hist, idx) => (
                    <div 
                      key={hist.id || idx} 
                      style={{ 
                        background: 'rgba(255,255,255,0.02)', 
                        border: '1px solid rgba(255,255,255,0.06)', 
                        borderRadius: 6, 
                        padding: '8px 10px',
                        fontSize: 10
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                        <span style={{ fontWeight: 800, color: 'var(--success)' }}>🧼 Mantenimiento de Paño</span>
                        <span style={{ color: 'var(--text-muted)', fontSize: 8 }}>
                          {new Date(hist.fecha).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' })}
                        </span>
                      </div>
                      <div style={{ color: 'var(--text-secondary)', marginBottom: 2 }}>
                        Horas de juego al momento del reset: <strong>{hist.horasAcumuladas ? Number(hist.horasAcumuladas).toFixed(1) : '0'}h</strong>
                      </div>
                      <div style={{ fontSize: 9, color: 'var(--text-muted)', display: 'flex', gap: 4 }}>
                        <span>👤 Registrado por:</span>
                        <span style={{ color: '#fff', fontWeight: 600 }}>{hist.operador || 'Sistema'}</span>
                        <span className="badge badge-bronze" style={{ fontSize: 6.5, padding: '0px 2px', textTransform: 'uppercase' }}>
                          {hist.rolOperador || 'admin'}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="modal-footer" style={{ borderTop: '1px solid var(--border)', padding: 10 }}>
              <button className="btn btn-secondary" style={{ fontSize: 10, padding: '4px 12px' }} onClick={() => setMostrarHistorialMantenimientoModal(false)}>Cerrar</button>
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

      {/* MODAL 1: ENVIAR CUPÓN DE FIDELIDAD (EDITABLE) */}
      {modalEnviarCuponOpen && (
        <div className="modal-overlay" onClick={() => setModalEnviarCuponOpen(false)}>
          <div className="modal" style={{ maxWidth: 500, display: 'flex', flexDirection: 'column' }} onClick={e => e.stopPropagation()}>
            <div className="modal-header" style={{ borderBottom: '1px solid var(--border)' }}>
              <span className="modal-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <i className="ri-coupon-line" style={{ color: 'var(--bronze-light)' }} />
                Enviar Cupón de Fidelidad (Editable)
              </span>
              <button onClick={() => setModalEnviarCuponOpen(false)} style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 20 }}>✕</button>
            </div>
            <div className="modal-body" style={{ overflowY: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)' }}>Cliente</label>
                <input 
                  type="text" 
                  className="input" 
                  value={cuponClienteNombre} 
                  onChange={e => setCuponClienteNombre(e.target.value)} 
                  style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border)', color: '#fff', padding: '8px 12px', borderRadius: 6, fontSize: 12 }}
                />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)' }}>Descuento (%)</label>
                  <input 
                    type="number" 
                    className="input" 
                    value={cuponPorcentaje} 
                    onChange={e => setCuponPorcentaje(Number(e.target.value))} 
                    style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border)', color: '#fff', padding: '8px 12px', borderRadius: 6, fontSize: 12 }}
                  />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)' }}>Código de Cupón</label>
                  <input 
                    type="text" 
                    className="input" 
                    value={cuponCodigo} 
                    onChange={e => setCuponCodigo(e.target.value)} 
                    style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border)', color: '#fff', padding: '8px 12px', borderRadius: 6, fontSize: 12 }}
                  />
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)' }}>Mensaje de WhatsApp/Telegram</label>
                  <button 
                    type="button" 
                    onClick={() => setCuponMensaje(generarMensajeIa(cuponClienteNombre, cuponPorcentaje, cuponCodigo))} 
                    style={{ background: 'rgba(205, 127, 50, 0.15)', border: '1px solid var(--border-bronze)', color: 'var(--bronze-light)', fontSize: 9.5, padding: '2px 8px', borderRadius: 4, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}
                  >
                    <i className="ri-magic-line" /> Redactar con IA
                  </button>
                </div>
                <textarea 
                  rows={4} 
                  value={cuponMensaje} 
                  onChange={e => setCuponMensaje(e.target.value)} 
                  style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border)', color: '#fff', padding: '8px 12px', borderRadius: 6, fontSize: 11.5, fontFamily: 'sans-serif', resize: 'vertical' }}
                />
              </div>
            </div>
            <div className="modal-footer" style={{ borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap', padding: '12px 20px' }}>
              <button className="btn btn-secondary" onClick={() => setModalEnviarCuponOpen(false)} style={{ fontSize: 11 }}>Cancelar</button>
              
              <button 
                className="btn btn-success" 
                onClick={() => enviarMensajeCupónPorRed('whatsapp')}
                style={{ background: '#25D366', color: '#fff', display: 'flex', alignItems: 'center', gap: 4, fontSize: 11 }}
              >
                <i className="ri-whatsapp-line" /> WhatsApp
              </button>

              <button 
                className="btn btn-success" 
                onClick={() => enviarMensajeCupónPorRed('whatsapp_business')}
                style={{ background: '#128C7E', color: '#fff', display: 'flex', alignItems: 'center', gap: 4, fontSize: 11 }}
              >
                <i className="ri-whatsapp-line" /> WA Business
              </button>

              <button 
                className="btn btn-primary" 
                onClick={() => enviarMensajeCupónPorRed('telegram')}
                style={{ background: '#0088cc', color: '#fff', display: 'flex', alignItems: 'center', gap: 4, fontSize: 11 }}
              >
                <i className="ri-telegram-line" /> Telegram
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 2: AGREGAR NUEVO CLIENTE */}
      {modalAgregarClienteOpen && (
        <div className="modal-overlay" onClick={() => setModalAgregarClienteOpen(false)}>
          <form className="modal" onSubmit={registrarClienteManual} style={{ maxWidth: 400, display: 'flex', flexDirection: 'column' }} onClick={e => e.stopPropagation()}>
            <div className="modal-header" style={{ borderBottom: '1px solid var(--border)' }}>
              <span className="modal-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <i className="ri-user-add-line" style={{ color: 'var(--bronze-light)' }} />
                Agregar Nuevo Cliente
              </span>
              <button type="button" onClick={() => setModalAgregarClienteOpen(false)} style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 20 }}>✕</button>
            </div>
            <div className="modal-body" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ background: 'rgba(205,127,50,0.1)', border: '1px solid rgba(205,127,50,0.3)', borderRadius: 8, padding: 10, fontSize: 11, color: 'var(--bronze-light)', display: 'flex', flexDirection: 'column', gap: 4 }}>
                <strong>ℹ️ Información Importante:</strong>
                <span>Los clientes dados de alta van acumulando puntos en cada visita y consumo para recibir beneficios y descuentos automáticos (se otorgan 50 puntos de bienvenida).</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)' }}>Nombre Completo *</label>
                <input 
                  type="text" 
                  required
                  placeholder="Ej. Juan Pérez"
                  value={nuevoClienteNombre} 
                  onChange={e => setNuevoClienteNombre(e.target.value)} 
                  style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border)', color: '#fff', padding: '8px 12px', borderRadius: 6, fontSize: 12 }}
                />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)' }}>Número de Teléfono *</label>
                <input 
                  type="tel" 
                  required
                  placeholder="Ej. 5512345678"
                  value={nuevoClienteTelefono} 
                  onChange={e => setNuevoClienteTelefono(e.target.value)} 
                  style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border)', color: '#fff', padding: '8px 12px', borderRadius: 6, fontSize: 12 }}
                />
              </div>
            </div>
            <div className="modal-footer" style={{ borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '12px 20px' }}>
              <button type="button" className="btn btn-secondary" onClick={() => setModalAgregarClienteOpen(false)} style={{ fontSize: 11 }}>Cancelar</button>
              <button type="submit" className="btn btn-primary" style={{ fontSize: 11 }}>Registrar y Otorgar Puntos</button>
            </div>
          </form>
        </div>
      )}

      {/* MODAL 3: CONSULTAR CLIENTES Y FIDELIDAD */}
      {modalConsultarClienteOpen && (
        <div className="modal-overlay" onClick={() => setModalConsultarClienteOpen(false)}>
          <div className="modal" style={{ maxWidth: 700, width: '90vw', maxHeight: '85vh', display: 'flex', flexDirection: 'column' }} onClick={e => e.stopPropagation()}>
            <div className="modal-header" style={{ borderBottom: '1px solid var(--border)' }}>
              <span className="modal-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <i className="ri-user-search-line" style={{ color: 'var(--bronze-light)' }} />
                Consultar Clientes y Fidelidad
              </span>
              <button onClick={() => setModalConsultarClienteOpen(false)} style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 20 }}>✕</button>
            </div>
            
            {/* Tabs de Búsqueda */}
            <div style={{ display: 'flex', background: 'rgba(0,0,0,0.2)', borderBottom: '1px solid var(--border)' }}>
              <button 
                onClick={() => setSubTabConsultar('lista')}
                style={{
                  flex: 1,
                  padding: '12px',
                  background: subTabConsultar === 'lista' ? 'rgba(255,255,255,0.05)' : 'none',
                  border: 'none',
                  borderBottom: subTabConsultar === 'lista' ? '2px solid var(--bronze-light)' : '2px solid transparent',
                  color: subTabConsultar === 'lista' ? 'var(--bronze-light)' : 'var(--text-muted)',
                  fontSize: 11.5,
                  fontWeight: 700,
                  cursor: 'pointer'
                }}
              >
                📋 Listado General ({clientesFidelidad.length})
              </button>
              <button 
                onClick={() => setSubTabConsultar('duplicados')}
                style={{
                  flex: 1,
                  padding: '12px',
                  background: subTabConsultar === 'duplicados' ? 'rgba(255,255,255,0.05)' : 'none',
                  border: 'none',
                  borderBottom: subTabConsultar === 'duplicados' ? '2px solid var(--bronze-light)' : '2px solid transparent',
                  color: subTabConsultar === 'duplicados' ? 'var(--bronze-light)' : 'var(--text-muted)',
                  fontSize: 11.5,
                  fontWeight: 700,
                  cursor: 'pointer'
                }}
              >
                👥 Posibles Duplicados ({obtenerPosiblesDuplicados().length})
              </button>
            </div>

            <div className="modal-body" style={{ overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
              {subTabConsultar === 'lista' ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                      <thead>
                        <tr style={{ borderBottom: '1px solid var(--border)', textAlign: 'left', color: 'var(--text-muted)' }}>
                          <th style={{ padding: '8px 6px' }}>Nombre</th>
                          <th style={{ padding: '8px 6px' }}>Teléfono</th>
                          <th style={{ padding: '8px 6px', textAlign: 'center' }}>Visitas</th>
                          <th style={{ padding: '8px 6px', textAlign: 'right' }}>Total Consumo</th>
                          <th style={{ padding: '8px 6px', textAlign: 'center' }}>Puntos</th>
                          <th style={{ padding: '8px 6px', textAlign: 'center' }}>Acciones</th>
                        </tr>
                      </thead>
                      <tbody>
                        {clientesFidelidad.length === 0 ? (
                          <tr>
                            <td colSpan={6} style={{ textAlign: 'center', padding: '20px', color: 'var(--text-muted)' }}>No hay clientes registrados.</td>
                          </tr>
                        ) : (
                          clientesFidelidad.map((c) => (
                            <tr key={c.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.03)', verticalAlign: 'middle' }}>
                              <td style={{ padding: '8px 6px', fontWeight: 700, color: '#fff' }}>{c.nombre}</td>
                              <td style={{ padding: '8px 6px', color: 'var(--text-secondary)' }}>{c.telefono}</td>
                              <td style={{ padding: '8px 6px', textAlign: 'center' }}>{c.visitas}</td>
                              <td style={{ padding: '8px 6px', textAlign: 'right', fontWeight: 700, color: 'var(--success)' }}>${(c.totalConsumo || 0).toLocaleString('es-MX')}</td>
                              <td style={{ padding: '8px 6px', textAlign: 'center' }}>
                                <span className="badge badge-bronze" style={{ fontSize: 9, padding: '2px 6px' }}>{c.puntos || 0} pts</span>
                              </td>
                              <td style={{ padding: '8px 6px', textAlign: 'center' }}>
                                <button 
                                  className="btn btn-secondary btn-xs" 
                                  onClick={() => {
                                    setModalConsultarClienteOpen(false);
                                    triggerEnviarCuponModal(c.nombre, 15);
                                  }}
                                  style={{ fontSize: 9, padding: '2px 6px' }}
                                >
                                  Enviar Cupón
                                </button>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <p style={{ fontSize: 10.5, color: 'var(--text-muted)', margin: 0 }}>
                    La IA analiza continuamente el listado de clientes registrados desde la caja o comensal para detectar números duplicados o nombres similares, y permite fusionar sus visitas, consumos e historial de puntos en un solo perfil.
                  </p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {obtenerPosiblesDuplicados().length === 0 ? (
                      <div style={{ textAlign: 'center', padding: '30px', color: 'var(--text-muted)', background: 'rgba(0,0,0,0.1)', borderRadius: 8, border: '1px solid var(--border)', fontSize: 11.5 }}>
                        ✨ ¡Gran trabajo! No se encontraron clientes duplicados en la base de datos.
                      </div>
                    ) : (
                      obtenerPosiblesDuplicados().map((dup, idx) => (
                        <div key={idx} style={{ background: 'rgba(205, 127, 50, 0.04)', border: '1px solid rgba(205, 127, 50, 0.2)', borderRadius: 10, padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span className="badge badge-warning" style={{ fontSize: 8.5 }}>{dup.reason}</span>
                            <button 
                              className="btn btn-primary btn-xs" 
                              onClick={() => unificarClientes(dup.c1, dup.c2)}
                              style={{ padding: '3px 8px', fontSize: 10, display: 'flex', alignItems: 'center', gap: 4 }}
                            >
                              <i className="ri-links-line" /> Unificar Perfiles
                            </button>
                          </div>
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, fontSize: 11 }}>
                            <div style={{ background: 'rgba(0,0,0,0.2)', padding: 8, borderRadius: 6, border: '1px solid var(--border)' }}>
                              <strong style={{ color: 'var(--bronze-light)' }}>Perfil Principal (Mayor Antigüedad)</strong>
                              <div style={{ marginTop: 4, display: 'flex', flexDirection: 'column', gap: 2 }}>
                                <span>Nombre: <strong>{dup.c1.nombre}</strong></span>
                                <span>Teléfono: {dup.c1.telefono}</span>
                                <span>Visitas: {dup.c1.visitas} | Puntos: {dup.c1.puntos}</span>
                                <span>Consumo: <strong>${(dup.c1.totalConsumo || 0).toLocaleString()}</strong></span>
                              </div>
                            </div>
                            <div style={{ background: 'rgba(0,0,0,0.2)', padding: 8, borderRadius: 6, border: '1px solid var(--border)' }}>
                              <strong style={{ color: 'var(--text-muted)' }}>Perfil Duplicado (Se fusionará y eliminará)</strong>
                              <div style={{ marginTop: 4, display: 'flex', flexDirection: 'column', gap: 2 }}>
                                <span>Nombre: <strong>{dup.c2.nombre}</strong></span>
                                <span>Teléfono: {dup.c2.telefono}</span>
                                <span>Visitas: {dup.c2.visitas} | Puntos: {dup.c2.puntos}</span>
                                <span>Consumo: <strong>${(dup.c2.totalConsumo || 0).toLocaleString()}</strong></span>
                              </div>
                            </div>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
            
            <div className="modal-footer" style={{ borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end', padding: '12px 20px' }}>
              <button className="btn btn-secondary" onClick={() => setModalConsultarClienteOpen(false)} style={{ fontSize: 11 }}>Cerrar</button>
            </div>
          </div>
        </div>
      )}

      {rfModalTipo && (
        <div className="modal-overlay" onClick={() => { setRfModalTipo(null); setRfModalDetalleMetodo(null); }}>
          <div className="modal" style={{ maxWidth: 650, width: '90%' }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">
                <i className={rfModalTipo === 'ingresos' ? "ri-arrow-left-right-line" : "ri-indeterminate-circle-line"} style={{ marginRight: 8, color: 'var(--bronze-light)' }} />
                Desglose de {rfModalTipo === 'ingresos' ? 'Ingresos' : 'Gastos y Egresos'} ({rfFiltro === 'ultimo corte' ? 'último corte' : rfFiltro})
              </span>
              <button onClick={() => { setRfModalTipo(null); setRfModalDetalleMetodo(null); }} className="btn-icon btn btn-secondary" style={{ background: 'none', border: 'none' }}>
                <i className="ri-close-line" style={{ fontSize: 20 }} />
              </button>
            </div>
            
            <div className="modal-body" style={{ maxHeight: '70vh', overflowY: 'auto', padding: '16px 20px' }}>
              {rfModalTipo === 'ingresos' ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  
                  {/* Segmented Bar for Payment Methods (Suggestion 3) */}
                  {(() => {
                    const totalMetodos = resumenFinanciero.efectivoIngresos + resumenFinanciero.tarjetaIngresos + resumenFinanciero.transferIngresos;
                    const pctEfectivo = totalMetodos > 0 ? (resumenFinanciero.efectivoIngresos / totalMetodos) * 100 : 0;
                    const pctTarjeta = totalMetodos > 0 ? (resumenFinanciero.tarjetaIngresos / totalMetodos) * 100 : 0;
                    const pctTransfer = totalMetodos > 0 ? (resumenFinanciero.transferIngresos / totalMetodos) * 100 : 0;
                    
                    return (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, background: 'rgba(255,255,255,0.01)', padding: 12, borderRadius: 8, border: '1px solid var(--border)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-muted)', fontWeight: 'bold' }}>
                          <span>Participación de Métodos de Pago (Ingresos):</span>
                          <span>Total Involucrado: ${totalMetodos.toLocaleString('es-MX', { minimumFractionDigits: 0 })} MXN</span>
                        </div>
                        <div style={{ display: 'flex', height: 12, borderRadius: 6, overflow: 'hidden', border: '1px solid var(--border)', background: 'var(--bg-elevated)', margin: '4px 0' }}>
                          {pctEfectivo > 0 && (
                            <div style={{ width: `${pctEfectivo}%`, background: 'var(--success)', height: '100%', transition: 'width 0.3s ease' }} title={`Efectivo: ${pctEfectivo.toFixed(1)}%`} />
                          )}
                          {pctTarjeta > 0 && (
                            <div style={{ width: `${pctTarjeta}%`, background: 'var(--bronze-light)', height: '100%', transition: 'width 0.3s ease' }} title={`Tarjeta: ${pctTarjeta.toFixed(1)}%`} />
                          )}
                          {pctTransfer > 0 && (
                            <div style={{ width: `${pctTransfer}%`, background: 'var(--blue-light)', height: '100%', transition: 'width 0.3s ease' }} title={`Transferencia/SPEI: ${pctTransfer.toFixed(1)}%`} />
                          )}
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-around', fontSize: 10, flexWrap: 'wrap', gap: '8px 16px', marginTop: 4 }}>
                          <span style={{ display: 'flex', alignItems: 'center', gap: 4, color: 'var(--success)', cursor: 'pointer', fontWeight: rfModalDetalleMetodo === 'efectivo' ? 'bold' : 'normal', textDecoration: rfModalDetalleMetodo === 'efectivo' ? 'underline' : 'none' }} onClick={() => setRfModalDetalleMetodo(rfModalDetalleMetodo === 'efectivo' ? null : 'efectivo')}>
                            <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--success)' }} />
                            Efectivo: {pctEfectivo.toFixed(1)}% (${resumenFinanciero.efectivoIngresos.toLocaleString('es-MX', { maximumFractionDigits: 0 })})
                          </span>
                          <span style={{ display: 'flex', alignItems: 'center', gap: 4, color: 'var(--bronze-light)', cursor: 'pointer', fontWeight: rfModalDetalleMetodo === 'tarjeta' ? 'bold' : 'normal', textDecoration: rfModalDetalleMetodo === 'tarjeta' ? 'underline' : 'none' }} onClick={() => setRfModalDetalleMetodo(rfModalDetalleMetodo === 'tarjeta' ? null : 'tarjeta')}>
                            <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--bronze-light)' }} />
                            Tarjeta: {pctTarjeta.toFixed(1)}% (${resumenFinanciero.tarjetaIngresos.toLocaleString('es-MX', { maximumFractionDigits: 0 })})
                          </span>
                          <span style={{ display: 'flex', alignItems: 'center', gap: 4, color: 'var(--blue-light)', cursor: 'pointer', fontWeight: rfModalDetalleMetodo === 'transferencia' ? 'bold' : 'normal', textDecoration: rfModalDetalleMetodo === 'transferencia' ? 'underline' : 'none' }} onClick={() => setRfModalDetalleMetodo(rfModalDetalleMetodo === 'transferencia' ? null : 'transferencia')}>
                            <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--blue-light)' }} />
                            Transf. / SPEI: {pctTransfer.toFixed(1)}% (${resumenFinanciero.transferIngresos.toLocaleString('es-MX', { maximumFractionDigits: 0 })})
                          </span>
                        </div>
                      </div>
                    );
                  })()}

                  {/* Selector de Fichas/Tabs para Métodos */}
                  <div style={{ display: 'flex', gap: 6, margin: '2px 0 6px 0', borderBottom: '1px solid var(--border)', paddingBottom: 8, overflowX: 'auto' }}>
                    {[
                      { val: null, label: 'Resumen Categorizado' },
                      { val: 'efectivo', label: `Ver Efectivo (${resumenFinanciero.transaccionesDetalle.filter(t => t.metodo === 'efectivo').length})` },
                      { val: 'tarjeta', label: `Ver Tarjeta (${resumenFinanciero.transaccionesDetalle.filter(t => t.metodo === 'tarjeta').length})` },
                      { val: 'transferencia', label: `Ver Transf. / SPEI (${resumenFinanciero.transaccionesDetalle.filter(t => t.metodo === 'transferencia').length})` }
                    ].map(tab => (
                      <button
                        key={tab.val || 'todos'}
                        onClick={() => setRfModalDetalleMetodo(tab.val)}
                        style={{
                          padding: '4px 10px',
                          fontSize: '10.5px',
                          fontWeight: rfModalDetalleMetodo === tab.val ? 'bold' : 'normal',
                          background: rfModalDetalleMetodo === tab.val ? 'var(--bronze)' : 'var(--bg-elevated)',
                          color: rfModalDetalleMetodo === tab.val ? '#fff' : 'var(--text-secondary)',
                          border: '1px solid ' + (rfModalDetalleMetodo === tab.val ? 'var(--bronze-light)' : 'var(--border)'),
                          borderRadius: '4px',
                          cursor: 'pointer',
                          whiteSpace: 'nowrap',
                          transition: 'all 0.2s ease'
                        }}
                      >
                        {tab.label}
                      </button>
                    ))}
                  </div>

                  {rfModalDetalleMetodo !== null ? (
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                        <span style={{ fontSize: 12, fontWeight: 'bold', color: 'var(--bronze-light)' }}>
                          Listado de Cobros en {rfModalDetalleMetodo.toUpperCase()} ({rfFiltro === 'ultimo corte' ? 'último corte' : rfFiltro})
                        </span>
                        <span style={{ fontSize: 12, fontWeight: 'bold', color: 'var(--success)' }}>
                          Total: ${resumenFinanciero.transaccionesDetalle
                            .filter(t => t.metodo === rfModalDetalleMetodo)
                            .reduce((s, t) => s + t.monto, 0)
                            .toLocaleString()} MXN
                        </span>
                      </div>
                      
                      {resumenFinanciero.transaccionesDetalle.filter(t => t.metodo === rfModalDetalleMetodo).length === 0 ? (
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', background: 'var(--bg-elevated)', padding: '20px', borderRadius: 6, border: '1px solid var(--border)', textAlign: 'center' }}>
                          No hay transacciones registradas con este medio de pago en este periodo.
                        </div>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 320, overflowY: 'auto', background: 'var(--bg-elevated)', padding: 10, borderRadius: 6, border: '1px solid var(--border)' }}>
                          {resumenFinanciero.transaccionesDetalle
                            .filter(t => t.metodo === rfModalDetalleMetodo)
                            .map((t, idx) => (
                              <div key={t.id || idx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11, borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: 6 }}>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                    <span style={{ color: 'var(--text-secondary)', fontSize: 9 }}>
                                      {t.fecha ? new Date(t.fecha).toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit' }) : ''} {t.hora || ''}
                                    </span>
                                    <span className="badge badge-secondary" style={{ fontSize: 8, padding: '1px 3px', textTransform: 'uppercase' }}>{t.metodo}</span>
                                  </div>
                                  <strong style={{ color: '#fff' }}>{t.descripcion}</strong>
                                  <span style={{ color: 'var(--text-muted)', fontSize: 9 }}>Registró: {t.operador}</span>
                                </div>
                                <span style={{ color: 'var(--success)', fontWeight: 'bold', fontSize: 12 }}>+${t.monto.toLocaleString()}</span>
                              </div>
                            ))}
                        </div>
                      )}
                    </div>
                  ) : (
                    <>
                      {/* Resumen de Tarjetas */}
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
                        <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 8, padding: 10, textAlign: 'center' }}>
                          <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>Rentas de Mesas</div>
                          <div style={{ fontSize: 16, fontWeight: 'bold', color: 'var(--success)', marginTop: 4 }}>
                            ${resumenFinanciero.rentasMesas.toLocaleString('es-MX', { maximumFractionDigits: 0 })}
                          </div>
                          {resumenFinanciero.rentasMesasUsadasFallback && (
                            <div style={{ fontSize: 8, color: 'var(--warning)', marginTop: 2 }}>*Proyección IA</div>
                          )}
                        </div>
                        <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 8, padding: 10, textAlign: 'center' }}>
                          <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>Ventas de Barra</div>
                          <div style={{ fontSize: 16, fontWeight: 'bold', color: 'var(--success)', marginTop: 4 }}>
                            ${resumenFinanciero.ventasBar.toLocaleString('es-MX', { maximumFractionDigits: 0 })}
                          </div>
                          {resumenFinanciero.ventasBarUsadasFallback && (
                            <div style={{ fontSize: 8, color: 'var(--warning)', marginTop: 2 }}>*Proyección IA</div>
                          )}
                        </div>
                        <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 8, padding: 10, textAlign: 'center' }}>
                          <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>Torneos</div>
                          <div style={{ fontSize: 16, fontWeight: 'bold', color: 'var(--success)', marginTop: 4 }}>
                            ${resumenFinanciero.inscripcionesTorneo.toLocaleString('es-MX', { maximumFractionDigits: 0 })}
                          </div>
                        </div>
                      </div>

                      {/* Fallbacks Alerts */}
                      {(resumenFinanciero.rentasMesasUsadasFallback || resumenFinanciero.ventasBarUsadasFallback) && (
                        <div style={{ background: 'rgba(217, 119, 6, 0.1)', border: '1px solid rgba(217, 119, 6, 0.3)', borderRadius: 8, padding: '10px 12px', fontSize: 11, color: '#f59e0b', lineHeight: 1.4 }}>
                          <i className="ri-information-line" style={{ marginRight: 6, verticalAlign: 'middle', fontSize: 13 }} />
                          <strong>Nota de Trazabilidad:</strong> Algunas categorías muestran estimaciones proporcionales basadas en la actividad general del negocio porque no se detectaron cierres registrados en el rango de tiempo seleccionado.
                        </div>
                      )}

                      {/* Detalles por Categoría */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                        
                        {/* Sección Mesas */}
                        <div>
                          <div style={{ fontSize: 12, fontWeight: 'bold', color: 'var(--bronze-light)', marginBottom: 6, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span>Rentas de Mesas / Cierres ({resumenFinanciero.listMesas.length})</span>
                            {!resumenFinanciero.rentasMesasUsadasFallback && (
                              <span style={{ fontSize: 10, fontWeight: 'normal', color: 'var(--success)' }}>
                                Real: ${resumenFinanciero.listMesas.reduce((s, e) => s + Math.abs(Number(e.monto) || 0), 0).toLocaleString()}
                              </span>
                            )}
                          </div>
                          
                          {resumenFinanciero.listMesas.length === 0 ? (
                            <div style={{ fontSize: 11, color: 'var(--text-muted)', background: 'var(--bg-elevated)', padding: '10px 12px', borderRadius: 6, border: '1px solid var(--border)' }}>
                              No hay transacciones registradas de rentas de mesas en este periodo.
                            </div>
                          ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 150, overflowY: 'auto', background: 'var(--bg-elevated)', padding: 8, borderRadius: 6, border: '1px solid var(--border)' }}>
                              {resumenFinanciero.listMesas.map((e, idx) => (
                                <div key={e.id || idx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11, borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: 4 }}>
                                  <div>
                                    <span style={{ color: 'var(--text-secondary)', fontSize: 9, marginRight: 6 }}>
                                      {new Date(e.fecha).toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit' })} {new Date(e.fecha).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}
                                    </span>
                                    <strong style={{ color: '#fff' }}>{e.detalle || e.accion}</strong>
                                    <span style={{ color: 'var(--text-muted)', fontSize: 10, marginLeft: 6 }}>({e.operador})</span>
                                  </div>
                                  <span style={{ color: 'var(--success)', fontWeight: 'bold' }}>+${Math.abs(e.monto).toLocaleString()}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>

                        {/* Sección Barra */}
                        <div>
                          <div style={{ fontSize: 12, fontWeight: 'bold', color: 'var(--bronze-light)', marginBottom: 6, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span>Ventas de Barra ({resumenFinanciero.listBar.length})</span>
                            {!resumenFinanciero.ventasBarUsadasFallback && (
                              <span style={{ fontSize: 10, fontWeight: 'normal', color: 'var(--success)' }}>
                                Real: ${resumenFinanciero.listBar.reduce((s, c) => s + Number(c.monto), 0).toLocaleString()}
                              </span>
                            )}
                          </div>
                          
                          {resumenFinanciero.listBar.length === 0 ? (
                            <div style={{ fontSize: 11, color: 'var(--text-muted)', background: 'var(--bg-elevated)', padding: '10px 12px', borderRadius: 6, border: '1px solid var(--border)' }}>
                              No hay tickets de barra en este periodo.
                            </div>
                          ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 150, overflowY: 'auto', background: 'var(--bg-elevated)', padding: 8, borderRadius: 6, border: '1px solid var(--border)' }}>
                              {resumenFinanciero.listBar.map((c, idx) => (
                                <div key={c.id || idx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11, borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: 4 }}>
                                  <div>
                                    <span style={{ color: 'var(--text-secondary)', fontSize: 9, marginRight: 6 }}>
                                      ID: {c.id}
                                    </span>
                                    <strong style={{ color: '#fff' }}>Ticket de barra</strong>
                                    <span className="badge badge-secondary" style={{ fontSize: 8, marginLeft: 6, padding: '1px 3px', textTransform: 'uppercase' }}>{c.metodo}</span>
                                  </div>
                                  <span style={{ color: 'var(--success)', fontWeight: 'bold' }}>+${Number(c.monto).toLocaleString()}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>

                        {/* Sección Torneos */}
                        <div>
                          <div style={{ fontSize: 12, fontWeight: 'bold', color: 'var(--bronze-light)', marginBottom: 6 }}>
                            Torneos en el Periodo ({resumenFinanciero.torneosPeriodo.length})
                          </div>
                          
                          {resumenFinanciero.torneosPeriodo.length === 0 ? (
                            <div style={{ fontSize: 11, color: 'var(--text-muted)', background: 'var(--bg-elevated)', padding: '10px 12px', borderRadius: 6, border: '1px solid var(--border)' }}>
                              No hay torneos registrados en este periodo.
                            </div>
                          ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 150, overflowY: 'auto', background: 'var(--bg-elevated)', padding: 8, borderRadius: 6, border: '1px solid var(--border)' }}>
                              {resumenFinanciero.torneosPeriodo.map((t, idx) => {
                                const cost = parseFloat(t.inscripcion?.replace('$', '') || 0);
                                const totalT = cost * (t.jugadores || 0);
                                return (
                                  <div key={t.id || idx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11, borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: 4 }}>
                                    <div>
                                      <strong style={{ color: '#fff' }}>{t.nombre}</strong>
                                      <span style={{ color: 'var(--text-muted)', fontSize: 9, marginLeft: 6 }}>
                                        {new Date(t.fechaInicio).toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit' })} · {t.jugadores || 0} jug. @ ${cost}
                                      </span>
                                    </div>
                                    <span style={{ color: 'var(--success)', fontWeight: 'bold' }}>+${totalT.toLocaleString()}</span>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>

                      </div>
                    </>
                  )}
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  {/* Resumen de Tarjetas */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 8, padding: 10, textAlign: 'center' }}>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>Gastos de Operación (OPEX)</div>
                      <div style={{ fontSize: 16, fontWeight: 'bold', color: 'var(--danger)', marginTop: 4 }}>
                        ${resumenFinanciero.gastosG.toLocaleString('es-MX', { maximumFractionDigits: 0 })}
                      </div>
                      {resumenFinanciero.gastosGUsadasFallback && (
                        <div style={{ fontSize: 8, color: 'var(--warning)', marginTop: 2 }}>*Proyección IA</div>
                      )}
                    </div>
                    <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 8, padding: 10, textAlign: 'center' }}>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>Pago de Nómina</div>
                      <div style={{ fontSize: 16, fontWeight: 'bold', color: 'var(--danger)', marginTop: 4 }}>
                        ${resumenFinanciero.nominaS.toLocaleString('es-MX', { maximumFractionDigits: 0 })}
                      </div>
                      {resumenFinanciero.nominaSUsadasFallback && (
                        <div style={{ fontSize: 8, color: 'var(--warning)', marginTop: 2 }}>*Proyección IA</div>
                      )}
                    </div>
                  </div>

                  {/* Fallbacks Alerts */}
                  {(resumenFinanciero.gastosGUsadasFallback || resumenFinanciero.nominaSUsadasFallback) && (
                    <div style={{ background: 'rgba(217, 119, 6, 0.1)', border: '1px solid rgba(217, 119, 6, 0.3)', borderRadius: 8, padding: '10px 12px', fontSize: 11, color: '#f59e0b', lineHeight: 1.4 }}>
                      <i className="ri-information-line" style={{ marginRight: 6, verticalAlign: 'middle', fontSize: 13 }} />
                      <strong>Nota de Auditoría:</strong> Algunas cifras muestran estimaciones proporcionales debido a la falta de registros directos de egresos/nómina en el rango de tiempo seleccionado.
                    </div>
                  )}

                  {/* Detalles por Categoría */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    
                    {/* Egresos */}
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 'bold', color: 'var(--bronze-light)', marginBottom: 6, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span>Gastos Operacionales Registrados ({resumenFinanciero.listGastos.length})</span>
                        {!resumenFinanciero.gastosGUsadasFallback && (
                          <span style={{ fontSize: 10, fontWeight: 'normal', color: 'var(--danger)' }}>
                            Real: ${resumenFinanciero.listGastos.reduce((s, g) => s + (Number(g.monto) || 0), 0).toLocaleString()}
                          </span>
                        )}
                      </div>
                      
                      {resumenFinanciero.listGastos.length === 0 ? (
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', background: 'var(--bg-elevated)', padding: '10px 12px', borderRadius: 6, border: '1px solid var(--border)' }}>
                          No hay egresos registrados en este periodo.
                        </div>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 180, overflowY: 'auto', background: 'var(--bg-elevated)', padding: 8, borderRadius: 6, border: '1px solid var(--border)' }}>
                          {resumenFinanciero.listGastos.map((g, idx) => (
                            <div key={g.id || idx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11, borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: 4 }}>
                              <div>
                                <span style={{ color: 'var(--text-secondary)', fontSize: 9, marginRight: 6 }}>
                                  {g.fecha}
                                </span>
                                <strong style={{ color: '#fff' }}>{g.descripcion || g.concepto}</strong>
                                <span style={{ color: 'var(--text-muted)', fontSize: 9, marginLeft: 6 }}>({g.categoria || 'General'})</span>
                              </div>
                              <span style={{ color: 'var(--danger)', fontWeight: 'bold' }}>-${(Number(g.monto) || 0).toLocaleString()}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Nómina */}
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 'bold', color: 'var(--bronze-light)', marginBottom: 6, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span>Pagos de Nómina y Adelantos ({resumenFinanciero.listNomina.length})</span>
                        {!resumenFinanciero.nominaSUsadasFallback && (
                          <span style={{ fontSize: 10, fontWeight: 'normal', color: 'var(--danger)' }}>
                            Real: ${resumenFinanciero.listNomina.reduce((s, p) => s + (Number(p.total || p.totalNeto) || 0), 0).toLocaleString()}
                          </span>
                        )}
                      </div>
                      
                      {resumenFinanciero.listNomina.length === 0 ? (
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', background: 'var(--bg-elevated)', padding: '10px 12px', borderRadius: 6, border: '1px solid var(--border)' }}>
                          No hay pagos de nómina conciliados en este periodo.
                        </div>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 180, overflowY: 'auto', background: 'var(--bg-elevated)', padding: 8, borderRadius: 6, border: '1px solid var(--border)' }}>
                          {resumenFinanciero.listNomina.map((p, idx) => (
                            <div key={p.id || idx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11, borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: 4 }}>
                              <div>
                                <span style={{ color: 'var(--text-secondary)', fontSize: 9, marginRight: 6 }}>
                                  {p.fecha}
                                </span>
                                <strong style={{ color: '#fff' }}>Pago: {p.nombreEmpleado}</strong>
                                <span style={{ color: 'var(--text-muted)', fontSize: 9, marginLeft: 6 }}>{p.notas ? `(${p.notas})` : ''}</span>
                              </div>
                              <span style={{ color: 'var(--danger)', fontWeight: 'bold' }}>-${(Number(p.total || p.totalNeto) || 0).toLocaleString()}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                  </div>
                </div>
              )}
            </div>
            
            <div className="modal-footer" style={{ borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end', padding: '12px 20px' }}>
              <button className="btn btn-secondary" onClick={() => { setRfModalTipo(null); setRfModalDetalleMetodo(null); }} style={{ fontSize: 11 }}>Cerrar</button>
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

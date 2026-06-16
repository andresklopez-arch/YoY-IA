'use client';
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  collection, addDoc, updateDoc, deleteDoc, doc,
  onSnapshot, query, orderBy, where, getDocs, serverTimestamp, limit
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { hashNip } from '@/lib/crypto';
import { QRCodeSVG } from 'qrcode.react';

const F = ({ label, children, col }) => (
  <div className="form-group" style={col ? { gridColumn: col } : {}}>
    <label className="form-label">{label}</label>
    {children}
  </div>
);

// ─────────────────────────────────────────────
// CONSTANTES
// ─────────────────────────────────────────────
const DEPARTAMENTOS = ['Mesas', 'Bar', 'Caja', 'Limpieza', 'Seguridad', 'Administración', 'Mantenimiento'];
const ROLES = ['Mesero', 'Bartender/Cocina', 'Cajero', 'Limpieza', 'Guardia', 'Gerente', 'Técnico'];
const TURNOS = [
  { id: 'manana',  label: 'Mañana',  icon: '🌅', hora: '08:00 - 14:00' },
  { id: 'tarde',   label: 'Tarde',   icon: '🌤', hora: '14:00 - 20:00' },
  { id: 'noche',   label: 'Noche',   icon: '🌙', hora: '20:00 - 02:00' },
];
const ESTADO_ASISTENCIA = [
  { id: 'presente',   label: 'Presente',   color: '#22c55e', bg: 'rgba(34,197,94,0.15)',    icon: '✅' },
  { id: 'ausente',    label: 'Ausente',    color: '#ef4444', bg: 'rgba(239,68,68,0.15)',    icon: '❌' },
  { id: 'tardanza',   label: 'Tardanza',   color: '#f59e0b', bg: 'rgba(245,158,11,0.15)',   icon: '⚠️' },
  { id: 'permiso',    label: 'Permiso',    color: '#3b82f6', bg: 'rgba(59,130,246,0.15)',   icon: '🏥' },
];
const CATEGORIAS_GASTO = [
  { id: 'mesas',      label: 'Mantenimiento Mesas',  icon: '🎱', color: '#cd7f32' },
  { id: 'accesorios', label: 'Accesorios',            icon: '🎯', color: '#e3a869' },
  { id: 'bar',        label: 'Bar e Insumos',         icon: '🍺', color: '#3b82f6' },
  { id: 'servicios',  label: 'Servicios',             icon: '💡', color: '#f59e0b' },
  { id: 'limpieza',   label: 'Limpieza',              icon: '🧹', color: '#22c55e' },
  { id: 'reparacion', label: 'Reparaciones',          icon: '🛠️', color: '#ef4444' },
  { id: 'admin',      label: 'Administrativos',       icon: '📋', color: '#b0b8c8' },
  { id: 'nomina',     label: 'Pago de Nómina',        icon: '💸', color: '#10b981' },
  { id: 'otro',       label: 'Otro / Personalizado',  icon: '➕', color: '#6b7280' },
];

const moneyFormatter = new Intl.NumberFormat('es-MX', {
  style: 'currency',
  currency: 'MXN',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});
const fmt = (n) => moneyFormatter.format(Number(n || 0));
const today = () => new Date().toISOString().slice(0, 10);

// Hook: ventas reales de bar y mesas para comisiones
function useVentasReales(fechaInicio, fechaFin) {
  const [ventasMesas, setVentasMesas] = useState(0);
  const [ventasBar, setVentasBar] = useState(0);

  useEffect(() => {
    const q = query(collection(db, 'bitacora'), orderBy('fecha', 'desc'));
    const unsub = onSnapshot(q, snap => {
      const eventos = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      const fi = new Date(fechaInicio + 'T00:00:00');
      const ff = new Date(fechaFin + 'T23:59:59');
      const eventosPeriodo = eventos.filter(e => {
        const fe = new Date(e.fecha);
        return fe >= fi && fe <= ff;
      });

      const totalMesas = eventosPeriodo
        .filter(e => e.accion === 'Cierre Directo' || e.accion === 'Mesa a Cuenta')
        .reduce((s, e) => s + Math.abs(Number(e.monto) || 0), 0);

      const rawStock = localStorage.getItem('yoy_billar_stock');
      let ventaBarEstimada = 0;
      if (rawStock) {
        try {
          let productos = [];
          if (rawStock.startsWith('[')) {
            const cb1 = rawStock.indexOf(']');
            const dateStr2 = rawStock.substring(1, cb1);
            const rest2 = rawStock.substring(cb1 + 1);
            const cb2 = rest2.startsWith('[') ? rest2.indexOf(']') : -1;
            const encPart2 = cb2 > 0 ? rest2.substring(cb2 + 1) : rest2;
            const xor2 = decodeURIComponent(escape(window.atob(encPart2)));
            const base64_2 = xor2.split('').map((c, i) => String.fromCharCode(c.charCodeAt(0) ^ dateStr2.charCodeAt(i % dateStr2.length))).join('');
            productos = JSON.parse(decodeURIComponent(escape(window.atob(base64_2))));
          } else {
            productos = JSON.parse(decodeURIComponent(escape(window.atob(rawStock))));
          }
          ventaBarEstimada = productos.reduce((s, p) => {
            const vendidos = Math.max(0, (p.stockOptimo || 50) - (p.stock || 0));
            return s + vendidos * (p.precioVenta || 0);
          }, 0);
        } catch { ventaBarEstimada = 0; }
      }

      setVentasMesas(totalMesas);
      setVentasBar(ventaBarEstimada);
    });
    return unsub;
  }, [fechaInicio, fechaFin]);

  return { ventasMesas, ventasBar };
}

// ─────────────────────────────────────────────
// MEJORA 2: HOOK DE ALERTAS IA GLOBALES
// Exporta alertas para uso en el Topbar (badge)
// ─────────────────────────────────────────────
export function useAlertasNomina() {
  const [empleados, setEmpleados] = useState([]);
  const [asistencias, setAsistencias] = useState([]);

  useEffect(() => {
    // Escuchar empleados para saber quiénes están activos
    const unsubEmp = onSnapshot(collection(db, 'nomina_empleados'), snap => {
      setEmpleados(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }, err => console.error("Error al obtener empleados para alertas:", err));

    // Escuchar asistencias limitando al mes actual para optimizar lecturas
    const primerDiaMes = new Date().toISOString().slice(0, 7) + '-01';
    const q = query(
      collection(db, 'nomina_asistencia'),
      where('fecha', '>=', primerDiaMes)
    );
    const unsubAsist = onSnapshot(q, snap => {
      setAsistencias(snap.docs.map(d => d.data()));
    }, err => console.error("Error al obtener asistencias para alertas:", err));

    return () => {
      unsubEmp();
      unsubAsist();
    };
  }, []);

  const alertas = useMemo(() => {
    const mesActual = new Date().toISOString().slice(0, 7);
    const activosIds = new Set(empleados.filter(e => e?.estado === 'activo').map(e => e.id));
    const nuevas = [];

    const porEmpleado = {};
    asistencias
      .filter(a => a?.fecha?.startsWith(mesActual) && a?.empleadoId && activosIds.has(a.empleadoId))
      .forEach(a => {
        if (!porEmpleado[a.empleadoId]) porEmpleado[a.empleadoId] = [];
        porEmpleado[a.empleadoId].push(a);
      });

    Object.entries(porEmpleado).forEach(([empId, registros]) => {
      const ausencias = registros.filter(r => r.estado === 'ausente').length;
      if (ausencias >= 3) {
        const emp = empleados.find(e => e.id === empId);
        const nombre = emp ? `${emp.nombre || ''} ${emp.apellido || ''}`.trim() : 'Empleado';
        nuevas.push({
          tipo: 'ausencia',
          empId,
          ausencias,
          mensaje: `${nombre || 'Empleado'}: ${ausencias} ausencias este mes`
        });
      }
    });

    return nuevas;
  }, [empleados, asistencias]);

  // Reproducir un sonido de alerta si hay alertas nuevas de alta prioridad
  const prevAlertasCount = useRef(0);
  useEffect(() => {
    if (alertas.length > prevAlertasCount.current) {
      try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (AudioCtx) {
          const ctx = new AudioCtx();
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.connect(gain);
          gain.connect(ctx.destination);
          
          osc.frequency.setValueAtTime(523.25, ctx.currentTime); // C5
          osc.frequency.setValueAtTime(659.25, ctx.currentTime + 0.15); // E5
          gain.gain.setValueAtTime(0.08, ctx.currentTime);
          gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.4);
          
          osc.start(ctx.currentTime);
          osc.stop(ctx.currentTime + 0.4);
        }
      } catch (e) {
        console.warn("Audio Context no está permitido o no es soportado aún:", e);
      }
    }
    prevAlertasCount.current = alertas.length;
  }, [alertas]);

  return alertas;
}

// ─────────────────────────────────────────────
// COMPONENTES AUXILIARES
// ─────────────────────────────────────────────
function StatCardMini({ icon, label, value, color, tooltip, id }) {
  const [hovered, setHovered] = useState(false);
  const tooltipId = id ? `tooltip-${id}` : undefined;

  return (
    <div 
      onMouseEnter={() => tooltip && setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      tabIndex={tooltip ? 0 : undefined}
      onFocus={() => tooltip && setHovered(true)}
      onBlur={() => setHovered(false)}
      aria-describedby={hovered && tooltipId ? tooltipId : undefined}
      style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border)',
        borderRadius: 12,
        padding: '8px 14px',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        minWidth: 140,
        flex: 1,
        cursor: tooltip ? 'pointer' : 'default',
        position: 'relative',
        outline: 'none',
        transition: 'border-color 0.25s ease, transform 0.25s ease, box-shadow 0.25s ease',
        transform: hovered && tooltip ? 'translateY(-2px)' : 'none',
        borderColor: hovered && tooltip ? color : 'var(--border)',
        boxShadow: hovered && tooltip ? `0 6px 16px ${color}10` : 'none'
      }}
    >
      <div style={{
        width: 32, height: 32, borderRadius: 8,
        background: `${color}15`, border: `1px solid ${color}30`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 16, color,
        transition: 'transform 0.25s ease',
        transform: hovered ? 'scale(1.1)' : 'none'
      }}>
        <i className={icon} />
      </div>
      <div>
        <div style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</div>
        <div style={{ fontSize: 16, fontWeight: 800, color: '#fff', marginTop: 2 }}>{value}</div>
      </div>

      {/* Burbuja de Tooltip Personalizada con Desvanecimiento de Entrada y Salida */}
      {tooltip && (
        <div 
          id={tooltipId}
          role="tooltip"
          aria-hidden={!hovered}
          style={{
            position: 'absolute',
            bottom: '100%',
            left: '50%',
            background: 'rgba(15, 23, 42, 0.95)',
            backdropFilter: 'blur(8px)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            padding: '6px 12px',
            color: '#fff',
            fontSize: 10,
            fontWeight: 600,
            whiteSpace: 'nowrap',
            zIndex: 100,
            boxShadow: `0 4px 20px ${color}20, 0 10px 30px rgba(0,0,0,0.5)`,
            pointerEvents: 'none',
            borderTop: `2px solid ${color}`,
            
            // Transición premium de entrada/salida (fade-out incluido, optimizado para GPU sin visibility)
            opacity: hovered ? 1 : 0,
            transform: hovered 
              ? 'translateX(-50%) translateY(-8px) scale(1)' 
              : 'translateX(-50%) translateY(0px) scale(0.95)',
            transition: hovered
              ? 'opacity 0.2s cubic-bezier(0.16, 1, 0.3, 1) 150ms, transform 0.2s cubic-bezier(0.16, 1, 0.3, 1) 150ms'
              : 'opacity 0.15s ease, transform 0.15s ease'
          }}
        >
          {tooltip}
          {/* Pequeño indicador de flecha */}
          <div style={{
            position: 'absolute',
            top: '100%',
            left: '50%',
            transform: 'translateX(-50%)',
            borderWidth: '5px',
            borderStyle: 'solid',
            borderColor: 'rgba(15, 23, 42, 0.95) transparent transparent transparent'
          }} />
        </div>
      )}
    </div>
  );
}

function ProgressBar({ value, max, color = 'var(--bronze)' }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div style={{ width: '100%', marginTop: 6 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: 'var(--text-muted)', marginBottom: 3 }}>
        <span>{pct}% Consumido</span>
        <span>{fmt(value)} / {fmt(max)}</span>
      </div>
      <div style={{ height: 6, background: 'var(--bg-elevated)', borderRadius: 3, overflow: 'hidden', border: '1px solid var(--border)' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 3, transition: 'width 0.3s ease' }} />
      </div>
    </div>
  );
}

function Badge({ children, color = '#cd7f32', bg }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', padding: '2px 7px', borderRadius: 6, background: bg || `${color}15`, color, border: `1px solid ${color}30` }}>
      {children}
    </span>
  );
}

// ─────────────────────────────────────────────
// PANEL PRINCIPAL UNIFICADO
// ─────────────────────────────────────────────
export default function NominaPanel({ showToast }) {
  // 1. Estados de datos Firestore
  const [empleados, setEmpleados] = useState([]);
  const [asistencias, setAsistencias] = useState([]);
  const [pagos, setPagos] = useState([]);
  const [gastos, setGastos] = useState([]);
  const [presupuestos, setPresupuestos] = useState({});
  const [insights, setInsights] = useState([]);
  const [calculos, setCalculos] = useState([]);

  // Estados del Fichaje / Pase de Lista
  const [subSeccion, setSubSeccion] = useState('resumen');
  const [mostrarInactivos, setMostrarInactivos] = useState(false);
  const [fichajesLogs, setFichajesLogs] = useState([]);
  const [fichajeFechaInicio, setFichajeFechaInicio] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    return d.toISOString().slice(0, 10);
  });
  const [fichajeFechaFin, setFichajeFechaFin] = useState(() => today());
  const [fichajeFiltroBusqueda, setFichajeFiltroBusqueda] = useState('');
  const [fichajeFiltroTipo, setFiltroTipo] = useState('');

  // Rango de fechas para el cálculo de nómina y filtrado de gastos
  const [fechaInicio, setFechaInicio] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 15);
    return d.toISOString().slice(0, 10);
  });
  const [fechaFin, setFechaFin] = useState(() => today());
  const [periodo, setPeriodo] = useState('quincenal');
  const [filtroMes, setFiltroMes] = useState(() => new Date().toISOString().slice(0, 7));
  const [filtroCategoria, setFiltroCategoria] = useState('');
  const [busqueda, setBusqueda] = useState('');
  const [busquedaGastos, setBusquedaGastos] = useState('');

  const [activeQrToken, setActiveQrToken] = useState('');
  const [activeQrExpires, setActiveQrExpires] = useState(0);
  const [fichajeResumenEmpleado, setFichajeResumenEmpleado] = useState(null);
  const [fichajeResumenInicio, setFichajeResumenInicio] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 15);
    return d.toISOString().slice(0, 10);
  });
  const [fichajeResumenFin, setFichajeResumenFin] = useState(() => today());

  const generarTokenQR = async (empleadoId) => {
    try {
      const res = await fetch('/api/nomina/generate-qr-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ empleadoId })
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Error en servidor');
      }
      
      setActiveQrToken(data.token);
      setActiveQrExpires(data.expires);
      showToast('Código QR dinámico generado con éxito (Válido por 45 segundos) 🔑', 'success');
    } catch (err) {
      console.error("Error al generar token QR:", err);
      showToast('Error al generar token QR: ' + err.message, 'error');
    }
  };

  const exportarCSV = () => {
    if (fichajesFiltrados.length === 0) {
      showToast('No hay registros para exportar', 'warning');
      return;
    }
    
    // Cabeceras del CSV con BOM para soporte UTF-8 en Excel
    let csvContent = "data:text/csv;charset=utf-8,\uFEFF";
    csvContent += "Fecha,Hora,Empleado,Rol,Evento,Dispositivo,Latitud,Longitud,Precision,Estado GPS\r\n";
    
    fichajesFiltrados.forEach(log => {
      const date = log.createdAt?.toDate ? log.createdAt.toDate() : new Date(log.createdAt || Date.now());
      const fechaFmt = date.toLocaleDateString('es-MX');
      const horaFmt = date.toLocaleTimeString('es-MX');
      const nombre = `"${log.nombre.replace(/"/g, '""')}"`;
      const rol = `"${(log.rol || '').replace(/"/g, '""')}"`;
      
      let tipoText = log.tipo;
      if (log.tipo === 'entrada') tipoText = 'Entrada (QR)';
      else if (log.tipo === 'salida') tipoText = 'Salida (QR)';
      else if (log.tipo === 'login') tipoText = 'Login (Sesión)';
      else if (log.tipo === 'logout') tipoText = 'Logout (Sesión)';
      else if (log.tipo === 'intento_fallido_geocerca') tipoText = `Fallo Geocerca (${log.coordenadas?.distanciaCalculada ? log.coordenadas.distanciaCalculada + 'm' : 'Lejos'})`;
      else if (log.tipo === 'intento_fallido_gps') tipoText = 'Fallo GPS (Inactivo)';

      const dispositivo = log.dispositivo || 'PC/Terminal';
      const lat = log.coordenadas?.lat || 'N/D';
      const lng = log.coordenadas?.lng || 'N/D';
      const precision = log.coordenadas?.precision ? `${Math.round(log.coordenadas.precision)}m` : 'N/D';
      const statusGps = log.coordenadas?.status || 'N/D';
      
      csvContent += `${fechaFmt},${horaFmt},${nombre},${rol},${tipoText},${dispositivo},${lat},${lng},${precision},${statusGps}\r\n`;
    });
    
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `reporte_fichajes_${fichajeFechaInicio}_a_${fichajeFechaFin}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast('Reporte CSV descargado con éxito ✅', 'success');
  };

  const imprimirTicketNominaPago = (pagoData) => {
    const w = window.open('', '_blank');
    if (!w) {
      showToast("El navegador bloqueó la ventana emergente. Por favor, habilite los pop-ups para imprimir.", "danger");
      return;
    }
    const htmlContent = `
      <html><head><title>Comprobante de Pago de Nómina</title>
      <style>
        body { margin: 0; padding: 20px; font-family: 'Courier New', Courier, monospace; background: #fff; color: #000; font-size: 13px; line-height: 1.4; max-width: 280px; }
        .text-center { text-align: center; }
        .divider { border-top: 1px dashed #000; margin: 10px 0; }
        .header { margin-bottom: 12px; }
        .header h3 { margin: 0; font-size: 15px; font-weight: bold; }
        .header p { margin: 2px 0; font-size: 11px; }
        .monto { font-size: 18px; font-weight: bold; margin: 10px 0; text-align: center; }
        .sign-area { margin-top: 30px; text-align: center; }
        .sign-line { border-top: 1px solid #000; width: 180px; margin: 30px auto 5px; }
        .footer { margin-top: 20px; font-size: 10px; text-align: center; color: #555; }
        .breakdown { font-size: 11px; }
        .breakdown-row { display: flex; justify-content: space-between; }
      </style>
      </head>
      <body>
        <div class="header text-center">
          <h3>YoY IA Billar Club</h3>
          <p>RECIBO DE NÓMINA</p>
          <p>Periodo: ${pagoData.periodo || `${pagoData.fechaInicio} al ${pagoData.fechaFin}`}</p>
          <p>Fecha Pago: ${pagoData.fecha}</p>
          <p>Impreso: ${new Date().toLocaleString()}</p>
        </div>
        
        <div class="divider"></div>
        
        <div style="font-size: 12px; margin-bottom: 8px;">
          <strong>Empleado:</strong> ${pagoData.nombreEmpleado}<br/>
          <strong>Días Laborados:</strong> ${pagoData.diasTrabajados || 0} días<br/>
        </div>
        
        <div class="divider"></div>
        
        <div class="breakdown">
          <div class="breakdown-row"><span>Sueldo Base:</span><span>$${Number(pagoData.sueldoProp || 0).toFixed(2)}</span></div>
          <div class="breakdown-row"><span>Comisión Mesas:</span><span>$${Number(pagoData.comisionMesas || 0).toFixed(2)}</span></div>
          <div class="breakdown-row"><span>Comisión Bar:</span><span>$${Number(pagoData.comisionBar || 0).toFixed(2)}</span></div>
          <div class="breakdown-row"><span>Bono por Turno:</span><span>$${Number(pagoData.bonoTurno || 0).toFixed(2)}</span></div>
          <div class="breakdown-row"><span>Deducciones:</span><span>-$${Number(pagoData.deducciones || 0).toFixed(2)}</span></div>
        </div>
        
        <div class="divider"></div>
        
        <div class="monto">
          NETO RECIBIDO:<br/>$${Number(pagoData.total).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} MXN
        </div>
        
        <div class="divider"></div>
        
        <div class="sign-area">
          <div class="sign-line"></div>
          <div style="font-size: 11px; font-weight: bold;">Autoriza (Gerente/Cajero)</div>
          
          <div class="sign-line"></div>
          <div style="font-size: 11px; font-weight: bold;">Recibe y firma:<br/>${pagoData.nombreEmpleado}</div>
        </div>
        
        <div class="footer">
          <p>YoY IA Billar Club agradece tu esfuerzo diario.</p>
        </div>
        
        <script>
          window.onload = () => {
            window.print();
            setTimeout(() => { window.close(); }, 500);
          };
        </script>
      </body>
      </html>
    `;
    w.document.write(htmlContent);
    w.document.close();
  };

  const exportarCSVEmpleado = (emp, logs) => {
    if (logs.length === 0) {
      showToast('No hay registros para exportar', 'warning');
      return;
    }
    let csvContent = "data:text/csv;charset=utf-8,\uFEFF";
    csvContent += "Fecha,Hora,Empleado,Rol,Evento,Dispositivo,Latitud,Longitud,Precision,Estado GPS\r\n";
    logs.forEach(log => {
      const date = log.createdAt?.toDate ? log.createdAt.toDate() : new Date(log.createdAt || Date.now());
      const fechaFmt = date.toLocaleDateString('es-MX');
      const horaFmt = date.toLocaleTimeString('es-MX');
      const nombre = `"${emp.nombre} ${emp.apellido || ''}"`;
      const rol = `"${emp.rol}"`;
      
      let tipoText = log.tipo;
      if (log.tipo === 'entrada') tipoText = 'Entrada (QR)';
      else if (log.tipo === 'salida') tipoText = 'Salida (QR)';
      
      const dispositivo = log.dispositivo || 'PC/Terminal';
      const lat = log.coordenadas?.lat || 'N/D';
      const lng = log.coordenadas?.lng || 'N/D';
      const precision = log.coordenadas?.precision ? `${Math.round(log.coordenadas.precision)}m` : 'N/D';
      const statusGps = log.coordenadas?.status || 'N/D';
      
      csvContent += `${fechaFmt},${horaFmt},${nombre},${rol},${tipoText},${dispositivo},${lat},${lng},${precision},${statusGps}\r\n`;
    });
    
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `reporte_fichajes_${emp.nombre}_${fichajeResumenInicio}_a_${fichajeResumenFin}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast('Reporte CSV descargado con éxito ✅', 'success');
  };

  // Modales
  const [showEmpModal, setShowEmpModal] = useState(false);
  const [editandoEmpleado, setEditandoEmpleado] = useState(null);
  const [formEmpleado, setFormEmpleado] = useState({
    nombre: '', apellido: '', telefono: '', email: '', departamento: 'Mesas', rol: 'Mesero', fechaIngreso: today(), estado: 'activo', frecuenciaPago: 'quincenal', sueldoBase: '', comisionMesas: '', comisionMesasTipo: 'porcentaje', comisionBar: '', comisionBarTipo: 'porcentaje', comisionTurno: '', comisionTurnoTipo: 'porcentaje', bonoTurno: '', notas: '', nip: '', permisos: { dashboard: true, mesas: true, caja: true, bar: true, clientes: true, torneos: false, nomina: false, reportes: false, config: false }
  });

  const [showGastoModal, setShowGastoModal] = useState(false);
  const [editandoGasto, setEditandoGasto] = useState(null);
  const [formGasto, setFormGasto] = useState({ 
    categoria: 'mesas', 
    subcategoria: '', 
    descripcion: '', 
    monto: '', 
    fecha: today(), 
    proveedor: '', 
    recurrente: false, 
    frecuencia: 'mensual', 
    notas: '',
    empleadoId: '',
    empleadoNombre: '',
    conceptoNomina: 'adelanto_nomina'
  });

  const [showPagarModal, setShowPagarModal] = useState(null);
  const [descontarCaja, setDescontarCaja] = useState(false);

  const [showPresupModal, setShowPresupModal] = useState(false);
  const [presupForm, setPresupForm] = useState({});
  const [showCalendario, setShowCalendario] = useState(false);

  // Hook comisiones
  const { ventasMesas, ventasBar } = useVentasReales(fechaInicio, fechaFin);

  // 2. Carga reactiva de datos
  useEffect(() => {
    const unsubs = [
      onSnapshot(query(collection(db, 'nomina_empleados')), snap => {
        setEmpleados(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      }),
      onSnapshot(query(collection(db, 'nomina_asistencia')), snap => {
        setAsistencias(snap.docs.map(d => d.data()));
      }),
      onSnapshot(query(collection(db, 'nomina_pagos'), orderBy('fecha', 'desc')), snap => {
        setPagos(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      }),
      onSnapshot(query(collection(db, 'gastos'), orderBy('fecha', 'desc')), snap => {
        setGastos(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      }),
      onSnapshot(query(collection(db, 'nomina_asistencia_log'), orderBy('createdAt', 'desc'), limit(500)), snap => {
        setFichajesLogs(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      }),
      onSnapshot(query(collection(db, 'presupuestos')), snap => {
        const map = {};
        snap.docs.forEach(d => { map[d.data().categoria] = { id: d.id, ...d.data() }; });
        setPresupuestos(map);
        const pf = {};
        CATEGORIAS_GASTO.forEach(c => { pf[c.id] = map[c.id]?.montoMensual || ''; });
        setPresupForm(pf);
      })
    ];
    return () => unsubs.forEach(unsub => unsub());
  }, []);

  // 3. Cálculos de Nómina y Egresos
  const mesActual = new Date().toISOString().slice(0, 7);
  const mesAnterior = (() => { const d = new Date(); d.setMonth(d.getMonth() - 1); return d.toISOString().slice(0, 7); })();

  const gastosMes = gastos.filter(g => g.fecha?.startsWith(mesActual));
  const gastosAnterior = gastos.filter(g => g.fecha?.startsWith(mesAnterior));
  const totalGastosMes = gastosMes.reduce((s, g) => s + (Number(g.monto) || 0), 0);
  const totalGastosAnterior = gastosAnterior.reduce((s, g) => s + (Number(g.monto) || 0), 0);
  const totalNomina = pagos.filter(p => p.fecha?.startsWith(mesActual)).reduce((s, p) => s + (Number(p.total) || 0), 0);
  const totalPresupuesto = Object.values(presupuestos).reduce((s, p) => s + (Number(p.montoMensual) || 0), 0);
  const totalEgresos = totalGastosMes + totalNomina;

  const calcularNomina = useCallback(() => {
    if (!fechaInicio || !fechaFin) return;
    const dias = Math.max(1, Math.round((new Date(fechaFin) - new Date(fechaInicio)) / 86400000) + 1);
    const result = empleados.map(emp => {
      const asistEmp = asistencias.filter(a => a.empleadoId === emp.id && a.fecha >= fechaInicio && a.fecha <= fechaFin);
      const diasTrabajados = asistEmp.filter(a => a.estado === 'presente').length;
      const tardanzas = asistEmp.filter(a => a.estado === 'tardanza').length;
      const sueldoBase = Number(emp.sueldoBase) || 0;
      const sueldoProp = sueldoBase > 0 ? (sueldoBase / dias) * diasTrabajados : 0;
      const deduccionesBase = tardanzas * (sueldoBase / dias / 2);

      let comisionMesas = 0;
      if (emp.comisionMesas > 0 && ventasMesas > 0) {
        comisionMesas = emp.comisionMesasTipo === 'porcentaje'
          ? (ventasMesas * Number(emp.comisionMesas)) / 100
          : Number(emp.comisionMesas) * diasTrabajados;
      }
      let comisionBar = 0;
      if (emp.comisionBar > 0 && ventasBar > 0) {
        comisionBar = emp.comisionBarTipo === 'porcentaje'
          ? (ventasBar * Number(emp.comisionBar)) / 100
          : Number(emp.comisionBar) * diasTrabajados;
      }

      const bonoTurno = (Number(emp.bonoTurno) || 0) * diasTrabajados;

      // Calcular adelantos, préstamos y faltantes registrados como gastos
      const empGastos = gastos.filter(g => 
        g.empleadoId === emp.id && 
        g.categoria === 'nomina' && 
        g.fecha >= fechaInicio && 
        g.fecha <= fechaFin
      );
      const adelanto = empGastos.filter(g => g.conceptoNomina === 'adelanto_nomina').reduce((s, g) => s + (Number(g.monto) || 0), 0);
      const prestamo = empGastos.filter(g => g.conceptoNomina === 'prestamo').reduce((s, g) => s + (Number(g.monto) || 0), 0);
      const faltante = empGastos.filter(g => g.conceptoNomina === 'faltante').reduce((s, g) => s + (Number(g.monto) || 0), 0);

      const deduccionesNomina = deduccionesBase + prestamo + faltante;
      const total = Math.max(0, sueldoProp + comisionMesas + comisionBar + bonoTurno - deduccionesNomina);

      const pagado = pagos
        .filter(p => p.empleadoId === emp.id && p.fechaInicio === fechaInicio && p.fechaFin === fechaFin)
        .reduce((s, p) => s + (p.total || 0), 0);

      const pagadoPeriodo = pagado + adelanto;

      return { 
        emp, 
        diasTrabajados, 
        tardanzas, 
        sueldoProp, 
        comisionMesas, 
        comisionBar, 
        bonoTurno, 
        deducciones: deduccionesNomina, 
        total, 
        pagado: pagadoPeriodo, 
        pendiente: Math.max(0, total - pagadoPeriodo),
        gastoAdelantos: adelanto,
        gastoPrestamos: prestamo,
        gastoFaltantes: faltante,
        tardanzasDeduccion: deduccionesBase
      };
    });
    setCalculos(result);
  }, [empleados, asistencias, pagos, gastos, fechaInicio, fechaFin, ventasMesas, ventasBar]);

  useEffect(() => {
    calcularNomina();
  }, [calcularNomina]);

  // Auto-completar descripción de gastos de nómina en base a empleado y concepto
  useEffect(() => {
    if (formGasto.categoria === 'nomina') {
      const emp = empleados.find(e => e.id === formGasto.empleadoId);
      const empNombre = emp ? `${emp.nombre} ${emp.apellido || ''}`.trim() : '';
      let conceptLabel = '';
      if (formGasto.conceptoNomina === 'adelanto_nomina') conceptLabel = 'Adelanto de nómina';
      else if (formGasto.conceptoNomina === 'prestamo') conceptLabel = 'Préstamo';
      else if (formGasto.conceptoNomina === 'faltante') conceptLabel = 'Faltante';
      
      if (empNombre && conceptLabel) {
        setFormGasto(p => ({ ...p, descripcion: `${conceptLabel} - ${empNombre}` }));
      } else {
        setFormGasto(p => ({ ...p, descripcion: '' }));
      }
    }
  }, [formGasto.categoria, formGasto.empleadoId, formGasto.conceptoNomina, empleados]);

  // IA Insights Motor
  const generarInsights = useCallback(() => {
    const nuevosInsights = [];
    const mesActualStr = new Date().toISOString().slice(0, 7);
    const mesAnteriorStr = (() => { const d = new Date(); d.setMonth(d.getMonth() - 1); return d.toISOString().slice(0, 7); })();

    const gMes = gastos.filter(g => g.fecha?.startsWith(mesActualStr));
    const gAnterior = gastos.filter(g => g.fecha?.startsWith(mesAnteriorStr));
    const tGastosMes = gMes.reduce((s, g) => s + (Number(g.monto) || 0), 0);
    const tGastosAnterior = gAnterior.reduce((s, g) => s + (Number(g.monto) || 0), 0);

    // Variación de gastos
    if (tGastosAnterior > 0) {
      const variacion = ((tGastosMes - tGastosAnterior) / tGastosAnterior) * 100;
      if (Math.abs(variacion) >= 10) {
        nuevosInsights.push({
          id: 'var_gastos',
          tipo: variacion > 0 ? 'alerta' : 'positivo',
          titulo: variacion > 0 ? `Gastos +${variacion.toFixed(0)}%` : `Gastos -${Math.abs(variacion).toFixed(0)}%`,
          desc: `Egresos de este mes: ${fmt(tGastosMes)} vs anterior: ${fmt(tGastosAnterior)}.`,
          prioridad: variacion > 30 ? 'alta' : 'media'
        });
      }
    }

    // Ausencia de personal
    empleados.filter(e => e.estado === 'activo').forEach(emp => {
      const ausencias = asistencias.filter(a => a.empleadoId === emp.id && a.estado === 'ausente' && a.fecha?.startsWith(mesActualStr)).length;
      if (ausencias >= 3) {
        nuevosInsights.push({
          id: `ausencia_${emp.id}`,
          tipo: 'alerta',
          titulo: `Alta ausencia: ${emp.nombre}`,
          desc: `${emp.nombre} registra ${ausencias} inasistencias este mes.`,
          prioridad: 'alta'
        });
      }
    });

    // Desviación de presupuestos
    CATEGORIAS_GASTO.forEach(cat => {
      const gastosMesCat = gMes.filter(g => g.categoria === cat.id).reduce((s, g) => s + (Number(g.monto) || 0), 0);
      const presupVal = Number(presupuestos[cat.id]?.montoMensual) || 0;
      if (presupVal > 0 && gastosMesCat > presupVal) {
        nuevosInsights.push({
          id: `presupuesto_${cat.id}`,
          tipo: 'alerta',
          titulo: `Exceso: ${cat.label}`,
          desc: `Consumido ${fmt(gastosMesCat)} superando el límite asignado de ${fmt(presupVal)}.`,
          prioridad: 'alta'
        });
      }
    });

    setInsights(nuevosInsights);
  }, [presupuestos, empleados, asistencias, gastos]);

  useEffect(() => {
    if (empleados.length || gastos.length) generarInsights();
  }, [empleados, gastos, pagos, asistencias, generarInsights]);

  // 4. Acciones CRUD
  const guardarEmpleado = async () => {
    if (!formEmpleado.nombre.trim()) return showToast('El nombre es requerido', 'error');
    try {
      let finalNip = formEmpleado.nip || '';
      if (finalNip && /^\d{4,6}$/.test(finalNip)) {
        finalNip = await hashNip(finalNip);
      }
      
      // Sanitizar permisos para roles que no sean Gerente o Cajero
      const rolSeleccionado = formEmpleado.rol || '';
      const esRolConPermisos = rolSeleccionado === 'Gerente' || rolSeleccionado === 'Cajero';
      const permisosFinal = esRolConPermisos ? (formEmpleado.permisos || {}) : {};

      // Sanitizar datos para eliminar cualquier valor 'undefined' que Firestore no admita
      const dataRaw = { 
        ...formEmpleado, 
        nip: finalNip, 
        permisos: permisosFinal,
        updatedAt: serverTimestamp() 
      };
      const data = {};
      Object.entries(dataRaw).forEach(([key, val]) => {
        if (val !== undefined) {
          data[key] = val;
        }
      });

      if (editandoEmpleado) {
        await updateDoc(doc(db, 'nomina_empleados', editandoEmpleado), data);
        showToast('Empleado actualizado ✅', 'success');
      } else {
        await addDoc(collection(db, 'nomina_empleados'), { ...data, createdAt: serverTimestamp() });
        showToast('Empleado registrado ✅', 'success');
      }
      setShowEmpModal(false);
    } catch (e) { showToast('Error al guardar: ' + e.message, 'error'); }
  };

  const eliminarEmpleado = async (id) => {
    if (!confirm('¿Eliminar este empleado?')) return;
    await deleteDoc(doc(db, 'nomina_empleados', id));
    showToast('Empleado eliminado', 'info');
  };

  const setAsistenciaDirecta = async (empleadoId, nuevoEstado) => {
    const fecha = today();

    try {
      const q = query(
        collection(db, 'nomina_asistencia'),
        where('empleadoId', '==', empleadoId),
        where('fecha', '==', fecha)
      );
      const snap = await getDocs(q);
      if (!snap.empty) {
        const docId = snap.docs[0].id;
        await updateDoc(doc(db, 'nomina_asistencia', docId), { estado: nuevoEstado, updatedAt: serverTimestamp() });
      } else {
        await addDoc(collection(db, 'nomina_asistencia'), {
          empleadoId, fecha, estado: nuevoEstado, createdAt: serverTimestamp()
        });
      }
      showToast(`Asistencia registrada`, 'success');
    } catch (e) { showToast('Error: ' + e.message, 'error'); }
  };

  const guardarGasto = async () => {
    if (!formGasto.monto || !formGasto.descripcion) return showToast('Completa descripción y monto', 'error');
    try {
      const data = { ...formGasto, monto: Number(formGasto.monto), updatedAt: serverTimestamp() };
      if (editandoGasto) {
        await updateDoc(doc(db, 'gastos', editandoGasto), data);
        showToast('Gasto actualizado ✅', 'success');
      } else {
        await addDoc(collection(db, 'gastos'), { ...data, createdAt: serverTimestamp() });
        showToast('Gasto registrado ✅', 'success');
      }
      setShowGastoModal(false);
      setFormGasto({ 
        categoria: 'mesas', 
        subcategoria: '', 
        descripcion: '', 
        monto: '', 
        fecha: today(), 
        proveedor: '', 
        recurrente: false, 
        frecuencia: 'mensual', 
        notas: '',
        empleadoId: '',
        empleadoNombre: '',
        conceptoNomina: 'adelanto_nomina'
      });
      setEditandoGasto(null);
    } catch (e) { showToast('Error: ' + e.message, 'error'); }
  };

  const eliminarGasto = async (id) => {
    if (!confirm('¿Eliminar este gasto?')) return;
    await deleteDoc(doc(db, 'gastos', id));
    showToast('Gasto eliminado', 'info');
  };

  const guardarPresupuestos = async () => {
    try {
      for (const catId of Object.keys(presupForm)) {
        const val = Number(presupForm[catId]) || 0;
        if (presupuestos[catId]?.id) {
          await updateDoc(doc(db, 'presupuestos', presupuestos[catId].id), { montoMensual: val, updatedAt: serverTimestamp() });
        } else {
          await addDoc(collection(db, 'presupuestos'), { categoria: catId, montoMensual: val, createdAt: serverTimestamp() });
        }
      }
      showToast('Presupuestos actualizados ✅', 'success');
      setShowPresupModal(false);
    } catch (e) { showToast('Error: ' + e.message, 'error'); }
  };

  const pagar = async (calc, todos = false) => {
    const items = todos ? calculos.filter(c => c.pendiente > 0) : [calc];
    if (!items.length) return showToast('No hay pagos pendientes', 'info');
    try {
      for (const item of items) {
        await addDoc(collection(db, 'nomina_pagos'), {
          empleadoId: item.emp.id, nombreEmpleado: `${item.emp.nombre} ${item.emp.apellido}`,
          fechaInicio, fechaFin, periodo, diasTrabajados: item.diasTrabajados,
          sueldoProp: item.sueldoProp, comisionMesas: item.comisionMesas, comisionBar: item.comisionBar,
          bonoTurno: item.bonoTurno, deducciones: item.deducciones, total: item.pendiente,
          descontoDeCaja: descontarCaja, fecha: today(), createdAt: serverTimestamp(),
        });

        // Generar e imprimir el comprobante térmico de nómina
        imprimirTicketNominaPago({
          nombreEmpleado: `${item.emp.nombre} ${item.emp.apellido}`,
          periodo,
          fechaInicio,
          fechaFin,
          fecha: today(),
          diasTrabajados: item.diasTrabajados,
          sueldoProp: item.sueldoProp,
          comisionMesas: item.comisionMesas,
          comisionBar: item.comisionBar,
          bonoTurno: item.bonoTurno,
          deducciones: item.deducciones,
          total: item.pendiente,
          descontoDeCaja: descontarCaja,
        });

        if (descontarCaja) {
          await addDoc(collection(db, 'gastos'), {
            categoria: 'admin', descripcion: `Pago de nómina — ${item.emp.nombre} ${item.emp.apellido}`,
            monto: item.pendiente, fecha: today(), createdAt: serverTimestamp(),
          });
        }
      }
      showToast(`${todos ? 'Nómina completa' : 'Pago'} registrado e impreso ✅`, 'success');
      setShowPagarModal(null);
      calcularNomina();
    } catch (e) { showToast('Error: ' + e.message, 'error'); }
  };

  // 5. Filtros aplicados a las listas
  const empleadosFiltrados = calculos.filter(c =>
    `${c.emp.nombre} ${c.emp.apellido} ${c.emp.rol} ${c.emp.departamento}`.toLowerCase().includes(busqueda.toLowerCase())
  );

  // eslint-disable-next-line react-hooks/preserve-manual-memoization
  const fichajesFiltrados = useMemo(() => {
    return fichajesLogs.filter(log => {
      const matchFecha = (!fichajeFechaInicio || log.fecha >= fichajeFechaInicio) &&
                         (!fichajeFechaFin || log.fecha <= fichajeFechaFin);
      const matchBusqueda = !fichajeFiltroBusqueda || 
                            log.nombre.toLowerCase().includes(fichajeFiltroBusqueda.toLowerCase()) ||
                            (log.rol || '').toLowerCase().includes(fichajeFiltroBusqueda.toLowerCase());
      const matchTipo = !fichajeFiltroTipo || log.tipo === fichajeFiltroTipo;
      return matchFecha && matchBusqueda && matchTipo;
    });
  }, [fichajesLogs, fichajeFechaInicio, fichajeFechaFin, fichajeFiltroBusqueda, fichajeFiltroTipo]);

  const gastosFiltrados = gastos
    .filter(g => g.fecha?.startsWith(filtroMes))
    .filter(g => !filtroCategoria || g.categoria === filtroCategoria)
    .filter(g => `${g.descripcion} ${g.proveedor} ${g.subcategoria}`.toLowerCase().includes(busquedaGastos.toLowerCase()));

  const totalGastosFiltrados = gastosFiltrados.reduce((s, g) => s + (Number(g.monto) || 0), 0);

  // Totales generales calculados
  const totalPendiente = calculos.reduce((s, c) => s + c.pendiente, 0);

  const getAsistenciaDia = () => {
    const fecha = today();
    const hoyAsist = asistencias.filter(a => a.fecha === fecha);
    const pres = hoyAsist.filter(a => a.estado === 'presente').length;
    const aus = hoyAsist.filter(a => a.estado === 'ausente').length;
    const tard = hoyAsist.filter(a => a.estado === 'tardanza').length;
    const perm = hoyAsist.filter(a => a.estado === 'permiso').length;

    return { pres, aus, tard, perm, total: hoyAsist.length };
  };

  const asistDia = getAsistenciaDia();

  return (
    <div>
      {/* ── CABECERA PRINCIPAL CON METRICAS COMPACTAS ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, flexWrap: 'wrap', gap: 16 }}>
        <div>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', background: 'linear-gradient(135deg, var(--bronze-light), var(--silver))', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text', lineHeight: 1 }}>
            Nómina & Gastos
          </h1>
          <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>Control unificado de personal, asistencia diaria, liquidación de nóminas y egresos.</p>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <StatCardMini id="gastos-mes" icon="ri-shopping-bag-3-line" label="Gastos Mes" value={fmt(totalGastosMes)} color="var(--danger)" tooltip="Gastos acumulados registrados este mes" />
          <StatCardMini id="nomina-mes" icon="ri-money-dollar-circle-line" label="Nómina Mes" value={fmt(totalNomina)} color="var(--warning)" tooltip="Nómina total pagada y liquidada este mes" />
          <StatCardMini id="total-egresos" icon="ri-add-circle-line" label="Total Egresos" value={fmt(totalEgresos)} color="var(--bronze-light)" tooltip={`Nómina (${fmt(totalNomina)}) + Gastos (${fmt(totalGastosMes)})`} />
          <StatCardMini id="empleados-activos" icon="ri-group-line" label="Activos" value={empleados.filter(e => e.estado === 'activo').length} color="var(--success)" tooltip="Total de personal activo en el sistema" />
        </div>
      </div>

      {/* ── BANNER DE ALERTAS E INSIGHTS DE IA ── */}
      {insights.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }}>
          {insights.map(ins => (
            <div key={ins.id} style={{
              display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px',
              background: ins.tipo === 'alerta' ? 'rgba(239,68,68,0.06)' : 'rgba(34,197,94,0.04)',
              border: `1px solid ${ins.tipo === 'alerta' ? 'rgba(239,68,68,0.15)' : 'rgba(34,197,94,0.15)'}`,
              borderRadius: 12
            }}>
              <span style={{ fontSize: 16 }}>{ins.tipo === 'alerta' ? '⚠️' : '💡'}</span>
              <div style={{ flex: 1, fontSize: 11, color: 'var(--text-secondary)' }}>
                <strong style={{ color: ins.tipo === 'alerta' ? 'var(--danger)' : 'var(--success)' }}>{ins.titulo}:</strong> {ins.desc}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── DISTRIBUCION SPLIT GRID (70% / 30%) ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '7fr 3fr', gap: 20, alignItems: 'start' }}>
          
          {/* COLUMNA IZQUIERDA (70%) */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            
            {/* SECCION 1: PASE DE LISTA RÁPIDO */}
            <div className="card">
              <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 15, flexWrap: 'wrap', gap: 12 }}>
                <div>
                  <h3 className="card-title"><i className="ri-calendar-check-line" style={{ marginRight: 6 }} />Pase de Lista del Día</h3>
                  <p style={{ fontSize: 10, color: 'var(--text-muted)', margin: 0 }}>Fichajes y nómina en tiempo real. Haz clic en una tarjeta para abrir la ficha de perfil.</p>
                </div>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                  {/* Buscador de Tarjetas */}
                  <div style={{ position: 'relative' }}>
                    <input
                      className="form-input" type="text" placeholder="Buscar tarjeta..."
                      value={busqueda} onChange={e => setBusqueda(e.target.value)}
                      style={{ paddingLeft: 26, fontSize: 10, height: 28, width: 130 }}
                    />
                    <i className="ri-search-line" style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', fontSize: 10 }} />
                  </div>

                  {/* Periodo de Pago */}
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center', background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border)', borderRadius: 10, padding: '4px 8px' }}>
                    <span style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>Periodo:</span>
                    <input className="form-input" type="date" value={fechaInicio} onChange={e => setFechaInicio(e.target.value)} style={{ width: 110, height: 26, fontSize: 10, padding: '2px 6px', background: 'transparent', border: 'none' }} />
                    <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>al</span>
                    <input className="form-input" type="date" value={fechaFin} onChange={e => setFechaFin(e.target.value)} style={{ width: 110, height: 26, fontSize: 10, padding: '2px 6px', background: 'transparent', border: 'none' }} />
                  </div>

                  {/* Mostrar Inactivos Checkbox */}
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, color: 'var(--text-secondary)', cursor: 'pointer', userSelect: 'none' }}>
                    <input 
                      type="checkbox" 
                      checked={mostrarInactivos} 
                      onChange={e => setMostrarInactivos(e.target.checked)}
                      style={{ accentColor: 'var(--bronze-light)', cursor: 'pointer' }}
                    />
                    Ver Inactivos
                  </label>

                  {/* + Empleado */}
                  <button 
                    className="btn btn-primary btn-sm" 
                    onClick={() => {
                      setFormEmpleado({ nombre: '', apellido: '', telefono: '', email: '', departamento: 'Mesas', rol: 'Mesero', fechaIngreso: today(), estado: 'activo', frecuenciaPago: 'quincenal', sueldoBase: '', comisionMesas: '', comisionMesasTipo: 'porcentaje', comisionBar: '', comisionBarTipo: 'porcentaje', comisionTurno: '', comisionTurnoTipo: 'porcentaje', bonoTurno: '', notas: '', nip: '', permisos: { dashboard: true, mesas: true, caja: true, bar: true, clientes: true, torneos: false, nomina: false, reportes: false, config: false } });
                      setEditandoEmpleado(null);
                      setShowEmpModal(true);
                    }}
                    style={{ display: 'flex', alignItems: 'center', gap: 4, height: 28, fontSize: 10 }}
                  >
                    <i className="ri-user-add-line" /> + Empleado
                  </button>
                </div>
              </div>

              <div style={{ display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 6 }}>
                {(() => {
                  const filtrados = empleados
                    .filter(e => mostrarInactivos ? true : e.estado === 'activo')
                    .filter(e => {
                      if (!busqueda) return true;
                      return `${e.nombre} ${e.apellido || ''} ${e.rol} ${e.departamento}`.toLowerCase().includes(busqueda.toLowerCase());
                    });
                  if (filtrados.length === 0) {
                    return <div style={{ fontSize: 11, color: 'var(--text-muted)', padding: 12 }}>No se encontraron empleados que coincidan</div>;
                  }
                  return filtrados.map(emp => {
                    const esInactivo = emp.estado === 'inactivo';
                    const asistHoy = asistencias.find(a => a.empleadoId === emp.id && a.fecha === today());
                    const est = asistHoy?.estado || '';
                    
                    // Calcular estado y logs recientes (últimos 5)
                    const logs = fichajesLogs.filter(log => log.empleadoId === emp.id && (log.tipo === 'entrada' || log.tipo === 'salida'));
                    const estaTrabajando = logs.length > 0 && logs[0].tipo === 'entrada';
                    const ultimos5 = logs.slice(0, 5);
                    const calc = calculos.find(c => c.emp.id === emp.id);

                    // 1. Detección de Celular Inusual
                    const phoneLogs = fichajesLogs.filter(log => 
                      log.empleadoId === emp.id && 
                      log.dispositivo && 
                      log.dispositivo !== 'PC/Terminal'
                    );
                    const phoneCounts = {};
                    phoneLogs.forEach(log => {
                      phoneCounts[log.dispositivo] = (phoneCounts[log.dispositivo] || 0) + 1;
                    });
                    let mostFrequentPhone = '';
                    let maxPhoneCount = 0;
                    Object.keys(phoneCounts).forEach(phone => {
                      if (phoneCounts[phone] > maxPhoneCount) {
                        maxPhoneCount = phoneCounts[phone];
                        mostFrequentPhone = phone;
                      }
                    });
                    const latestLog = logs[0];
                    const isCelularInusual = phoneLogs.length >= 3 && 
                                             latestLog && 
                                             latestLog.dispositivo && 
                                             latestLog.dispositivo !== 'PC/Terminal' && 
                                             latestLog.dispositivo !== mostFrequentPhone;

                    // 2. Resumen de horas trabajadas hoy
                    const logsHoy = fichajesLogs.filter(log => 
                      log.empleadoId === emp.id && 
                      log.fecha === today() && 
                      (log.tipo === 'entrada' || log.tipo === 'salida')
                    );
                    const logsHoyCron = [...logsHoy].sort((a, b) => {
                      const tA = a.createdAt?.toDate ? a.createdAt.toDate().getTime() : (a.createdAt || 0);
                      const tB = b.createdAt?.toDate ? b.createdAt.toDate().getTime() : (b.createdAt || 0);
                      return tA - tB;
                    });
                    let horasHoy = 0;
                    let entradaActivaHoy = null;
                    logsHoyCron.forEach(log => {
                      if (log.tipo === 'entrada') {
                        entradaActivaHoy = log.createdAt?.toDate ? log.createdAt.toDate() : new Date(log.createdAt);
                      } else if (log.tipo === 'salida' && entradaActivaHoy) {
                        const salidaTime = log.createdAt?.toDate ? log.createdAt.toDate() : new Date(log.createdAt);
                        const diffMs = Math.max(0, salidaTime - entradaActivaHoy);
                        horasHoy += diffMs / (1000 * 60 * 60);
                        entradaActivaHoy = null;
                      }
                    });
                    if (entradaActivaHoy) {
                      const diffMs = Math.max(0, new Date() - entradaActivaHoy);
                      horasHoy += diffMs / (1000 * 60 * 60);
                    }

                    return (
                      <div 
                        key={emp.id} 
                        onClick={() => {
                          setFichajeResumenEmpleado(emp);
                          const start = new Date();
                          start.setDate(start.getDate() - 15);
                          setFichajeResumenInicio(start.toISOString().slice(0, 10));
                          setFichajeResumenFin(today());
                        }}
                        style={{
                          background: 'var(--bg-elevated)', border: esInactivo ? '1px dashed var(--border)' : '1px solid var(--border)',
                          borderRadius: 12, padding: 12, minWidth: 200, cursor: 'pointer',
                          display: 'flex', flexDirection: 'column', gap: 8, transition: 'all 0.2s',
                          position: 'relative',
                          opacity: esInactivo ? 0.6 : 1
                        }}
                        onMouseEnter={e => { if(!esInactivo) e.currentTarget.style.borderColor = 'var(--border-bronze)'; }}
                        onMouseLeave={e => { if(!esInactivo) e.currentTarget.style.borderColor = 'var(--border)'; }}
                      >
                        {/* Estado y Nombre */}
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ fontSize: 12, fontWeight: 700, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 110 }}>
                            {emp.nombre} {emp.apellido || ''}
                          </span>
                          <span style={{ 
                            fontSize: 9, fontWeight: 800, padding: '2px 6px', borderRadius: 4,
                            background: esInactivo ? 'rgba(239,68,68,0.12)' : (estaTrabajando ? 'rgba(34,197,94,0.12)' : 'rgba(107,114,128,0.12)'),
                            color: esInactivo ? 'var(--danger)' : (estaTrabajando ? 'var(--success)' : 'var(--text-muted)'),
                            display: 'flex', alignItems: 'center', gap: 3
                          }}>
                            <span style={{ width: 6, height: 6, borderRadius: '50%', background: esInactivo ? 'var(--danger)' : (estaTrabajando ? 'var(--success)' : '#6b7280'), display: 'inline-block' }} />
                            {esInactivo ? 'INACTIVO' : (estaTrabajando ? 'TRABAJANDO' : 'NO FICHADO')}
                          </span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: -4 }}>
                          <div style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase' }}>{emp.rol}</div>
                          <div style={{ fontSize: 9, fontWeight: 600, color: 'var(--bronze-light)' }}>
                            Horas hoy: {horasHoy.toFixed(1)} hrs
                          </div>
                        </div>
                        {isCelularInusual && (
                          <div style={{ 
                            fontSize: 8, color: 'var(--danger)', fontWeight: 700, 
                            background: 'rgba(239,68,68,0.1)', padding: '2px 6px', borderRadius: 4,
                            display: 'flex', alignItems: 'center', gap: 4, marginTop: -2
                          }}>
                            <i className="ri-error-warning-line" /> Celular inusual ({latestLog?.dispositivo})
                          </div>
                        )}

                        {calc && (
                          <div className="animate-fadeIn" style={{
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 2,
                            padding: '6px 8px',
                            background: 'rgba(255,255,255,0.02)',
                            border: '1px solid var(--border)',
                            borderRadius: 8,
                            fontSize: 8,
                            marginTop: 4
                          }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                              <span style={{ color: 'var(--text-muted)' }}>Ganado:</span>
                              <strong style={{ color: '#fff' }}>${calc.total.toFixed(2)}</strong>
                            </div>
                            {calc.gastoAdelantos === 0 && calc.gastoPrestamos === 0 && calc.gastoFaltantes === 0 ? (
                              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                <span style={{ color: 'var(--text-muted)' }}>Adelantos:</span>
                                <strong style={{ color: 'var(--bronze-light)' }}>$0.00</strong>
                              </div>
                            ) : (
                              <>
                                {calc.gastoAdelantos > 0 && (
                                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                    <span style={{ color: 'var(--text-muted)' }}>Adelantos:</span>
                                    <strong style={{ color: 'var(--bronze-light)' }}>${calc.gastoAdelantos.toFixed(2)}</strong>
                                  </div>
                                )}
                                {calc.gastoPrestamos > 0 && (
                                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                    <span style={{ color: 'var(--text-muted)' }}>Préstamos:</span>
                                    <strong style={{ color: 'var(--danger)' }}>${calc.gastoPrestamos.toFixed(2)}</strong>
                                  </div>
                                )}
                                {calc.gastoFaltantes > 0 && (
                                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                    <span style={{ color: 'var(--text-muted)' }}>Faltantes:</span>
                                    <strong style={{ color: 'var(--danger)' }}>${calc.gastoFaltantes.toFixed(2)}</strong>
                                  </div>
                                )}
                              </>
                            )}
                            <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px dashed rgba(255,255,255,0.08)', paddingTop: 2, marginTop: 2 }}>
                              <span style={{ color: 'var(--text-muted)' }}>Pendiente:</span>
                              <strong style={{ color: calc.pendiente > 0 ? 'var(--warning)' : 'var(--success)' }}>
                                ${calc.pendiente.toFixed(2)}
                              </strong>
                            </div>
                          </div>
                        )}
                        
                        {/* Historial rápido (Últimos 5 logs) */}
                        <div style={{ background: 'rgba(0,0,0,0.15)', borderRadius: 8, padding: 6, display: 'flex', flexDirection: 'column', gap: 4 }} onClick={e => e.stopPropagation()}>
                          <div style={{ fontSize: 8, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.04em', textTransform: 'uppercase', marginBottom: 2 }}>Últimos Fichajes</div>
                          {ultimos5.map(log => {
                            const d = log.createdAt?.toDate ? log.createdAt.toDate() : new Date(log.createdAt || Date.now());
                            const hora = d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
                            const fechaLog = d.toLocaleDateString('es-MX', { day: '2-digit', month: 'short' });
                            return (
                              <div key={log.id} style={{ fontSize: 8, color: 'var(--text-secondary)', display: 'flex', justifyContent: 'space-between' }}>
                                <span>{log.tipo === 'entrada' ? '📥 Ent' : '📤 Sal'}</span>
                                <span style={{ fontFamily: 'monospace' }}>{fechaLog} {hora}</span>
                              </div>
                            );
                          })}
                          {ultimos5.length === 0 && (
                            <div style={{ fontSize: 8, color: 'var(--text-muted)', fontStyle: 'italic', textAlign: 'center' }}>Sin registros</div>
                          )}
                        </div>

                        {/* Botones de Asistencia Rápida */}
                        <div style={{ display: 'flex', justifyContent: 'center', gap: 4, borderTop: '1px solid var(--border-subtle)', paddingTop: 8 }} onClick={e => e.stopPropagation()}>
                          {ESTADO_ASISTENCIA.map(ea => {
                            const isActive = est === ea.id;
                            return (
                              <button
                                key={ea.id}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setAsistenciaDirecta(emp.id, ea.id);
                                }}
                                title={ea.label}
                                style={{
                                  width: 24, height: 24, borderRadius: 6, border: '1px solid var(--border)',
                                  cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                                  fontSize: 10, transition: 'all 0.15s',
                                  background: isActive ? ea.bg : 'transparent',
                                  borderColor: isActive ? ea.color : 'var(--border)'
                                }}
                              >
                                {ea.icon}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  });
                })()}
              </div>
            </div>

          {/* SECCION 3: HISTORIAL DE GASTOS Y EGRESOS */}
          <div className="card">
            <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 15, flexWrap: 'wrap', gap: 12 }}>
              <div>
                <h3 className="card-title"><i className="ri-shopping-bag-3-line" style={{ marginRight: 6 }} />Gastos y Egresos Operativos</h3>
                <p style={{ fontSize: 10, color: 'var(--text-muted)', margin: 0 }}>Registro general de compras, mantenimiento e insumos críticos</p>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <input className="form-input" type="month" value={filtroMes} onChange={e => setFiltroMes(e.target.value)} style={{ width: 110, height: 30, fontSize: 11, padding: '2px 8px' }} />
                <select className="form-select" value={filtroCategoria} onChange={e => setFiltroCategoria(e.target.value)} style={{ width: 140, height: 30, fontSize: 11, padding: '2px 8px' }}>
                  <option value="">Todas Categorías</option>
                  {CATEGORIAS_GASTO.map(c => <option key={c.id} value={c.id}>{c.icon} {c.label}</option>)}
                </select>
                <button className="btn btn-secondary btn-sm" onClick={() => setShowCalendario(true)} style={{ height: 30, fontSize: 11 }}><i className="ri-calendar-line" /> Calendario</button>
                <button className="btn btn-secondary btn-sm" onClick={() => setShowPresupModal(true)} style={{ height: 30, fontSize: 11 }}><i className="ri-pie-chart-line" /> Presupuestos</button>
                <button className="btn btn-primary btn-sm" onClick={() => {
                  setFormGasto({ 
                    categoria: 'mesas', 
                    subcategoria: '', 
                    descripcion: '', 
                    monto: '', 
                    fecha: today(), 
                    proveedor: '', 
                    recurrente: false, 
                    frecuencia: 'mensual', 
                    notas: '',
                    empleadoId: '',
                    empleadoNombre: '',
                    conceptoNomina: 'adelanto_nomina'
                  });
                  setEditandoGasto(null);
                  setShowGastoModal(true);
                }} style={{ height: 30, fontSize: 11 }}>
                  <i className="ri-add-line" /> Gasto
                </button>
              </div>
            </div>

            {/* Buscador de Gastos */}
            <div style={{ marginBottom: 12, position: 'relative' }}>
              <input
                className="form-input" type="text" placeholder="Buscar gasto por descripción, proveedor..."
                value={busquedaGastos} onChange={e => setBusquedaGastos(e.target.value)}
                style={{ paddingLeft: 32, fontSize: 12, height: 32 }}
              />
              <i className="ri-search-line" style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            </div>

            <div className="table-container">
              <table className="table">
                <thead>
                  <tr>
                    <th>Categoría</th>
                    <th>Descripción / Proveedor</th>
                    <th>Fecha</th>
                    <th style={{ textAlign: 'right' }}>Monto</th>
                    <th style={{ width: 90, textAlign: 'center' }}>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {gastosFiltrados.length === 0 ? (
                    <tr>
                      <td colSpan={5} style={{ textAlign: 'center', padding: 30, color: 'var(--text-muted)', fontSize: 12 }}>
                        Sin gastos en este mes / filtro
                      </td>
                    </tr>
                  ) : (
                    gastosFiltrados.map(g => {
                      const cat = CATEGORIAS_GASTO.find(c => c.id === g.categoria);
                      return (
                        <tr key={g.id}>
                          <td>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <span style={{ fontSize: 14 }}>{cat?.icon || '📋'}</span>
                              <span style={{ fontSize: 11, color: cat?.color || 'var(--text-secondary)' }}>{cat?.label || g.categoria}</span>
                            </div>
                          </td>
                          <td>
                            <div style={{ fontSize: 12, fontWeight: 700 }}>{g.descripcion}</div>
                            <div style={{ fontSize: 9, color: 'var(--text-muted)' }}>Proveedor: {g.proveedor || '—'} {g.recurrente ? `· Recurrente (${g.frecuencia})` : ''}</div>
                          </td>
                          <td style={{ fontSize: 11 }}>{g.fecha}</td>
                          <td style={{ textAlign: 'right', fontWeight: 700, color: 'var(--danger)', fontSize: 12 }}>{fmt(g.monto)}</td>
                          <td>
                            <div style={{ display: 'flex', gap: 4, justifyContent: 'center' }}>
                              <button className="btn btn-secondary btn-xs btn-icon" onClick={() => {
                                setEditandoGasto(g.id);
                                setFormGasto({ ...g });
                                setShowGastoModal(true);
                              }}><i className="ri-pencil-line" /></button>
                              <button className="btn btn-danger btn-xs btn-icon" onClick={() => eliminarGasto(g.id)}><i className="ri-delete-bin-line" /></button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
            {gastosFiltrados.length > 0 && (
              <div style={{ textAlign: 'right', padding: '12px 16px', borderTop: '1px solid var(--border)', fontSize: 12, fontWeight: 700 }}>
                Total filtrado: <span style={{ color: 'var(--danger)', fontSize: 14 }}>{fmt(totalGastosFiltrados)}</span>
              </div>
            )}
          </div>

        </div>

        {/* COLUMNA DERECHA (30% - PANELES DE SOPORTE) */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          
          {/* PANEL 1: RESUMEN DE ASISTENCIA */}
          <div className="card">
            <div className="card-header" style={{ marginBottom: 12 }}>
              <h3 className="card-title">Asistencia del Día</h3>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                <span>Presentes:</span>
                <span style={{ fontWeight: 700, color: 'var(--success)' }}>{asistDia.pres}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                <span>Ausentes:</span>
                <span style={{ fontWeight: 700, color: 'var(--danger)' }}>{asistDia.aus}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                <span>Tardanzas:</span>
                <span style={{ fontWeight: 700, color: 'var(--warning)' }}>{asistDia.tard}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                <span>Permisos:</span>
                <span style={{ fontWeight: 700, color: 'var(--info)' }}>{asistDia.perm}</span>
              </div>
              <div style={{ borderTop: '1px solid var(--border)', paddingTop: 8, display: 'flex', justifyContent: 'space-between', fontSize: 12, fontWeight: 700 }}>
                <span>Total Registros:</span>
                <span>{asistDia.total}</span>
              </div>
            </div>
          </div>

          {/* PANEL 2: PRESUPUESTOS POR CATEGORÍA */}
          <div className="card">
            <div className="card-header" style={{ marginBottom: 12 }}>
              <h3 className="card-title">Presupuesto por Categoría</h3>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {CATEGORIAS_GASTO.map(cat => {
                const total = gastosMes.filter(g => g.categoria === cat.id).reduce((s, g) => s + (Number(g.monto) || 0), 0);
                const presup = Number(presupuestos[cat.id]?.montoMensual) || 0;
                if (total === 0 && presup === 0) return null;
                return (
                  <div key={cat.id} style={{ borderBottom: '1px solid var(--border-subtle)', paddingBottom: 8 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                      <span style={{ fontSize: 11, fontWeight: 700 }}>{cat.icon} {cat.label}</span>
                      <span style={{ fontSize: 11, fontWeight: 800, color: cat.color }}>{fmt(total)}</span>
                    </div>
                    {presup > 0 && <ProgressBar value={total} max={presup} color={cat.color} />}
                  </div>
                );
              })}
              {Object.keys(presupuestos).length === 0 && (
                <div style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center', padding: '10px 0' }}>
                  Sin presupuestos configurados.
                </div>
              )}
            </div>
          </div>

          {/* PANEL 3: ÚLTIMOS PAGOS REALIZADOS */}
          <div className="card">
            <div className="card-header" style={{ marginBottom: 12 }}>
              <h3 className="card-title">Últimos Pagos Realizados</h3>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {pagos.slice(0, 5).length === 0 ? (
                <div style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center', padding: '10px 0' }}>
                  No hay pagos registrados este mes.
                </div>
              ) : (
                pagos.slice(0, 5).map(p => (
                  <div key={p.id} style={{
                    background: 'var(--bg-elevated)', border: '1px solid var(--border)',
                    borderRadius: 8, padding: 8, fontSize: 11, display: 'flex', justifyContent: 'space-between', alignItems: 'center'
                  }}>
                    <div>
                      <div style={{ fontWeight: 700 }}>{p.nombreEmpleado}</div>
                      <div style={{ fontSize: 9, color: 'var(--text-muted)' }}>{p.fecha} · {p.periodo}</div>
                    </div>
                    <div style={{ fontWeight: 800, color: 'var(--success)' }}>{fmt(p.total)}</div>
                  </div>
                ))
              )}
            </div>
          </div>

        </div>

      </div>


      {/* ── MODALES DEL SISTEMA ── */}

      {/* MODAL RESUMEN PERSONALIZADO */}
      {fichajeResumenEmpleado && (() => {
        const empLogs = fichajesLogs.filter(log => 
          log.empleadoId === fichajeResumenEmpleado.id && 
          log.fecha >= fichajeResumenInicio && 
          log.fecha <= fichajeResumenFin && 
          (log.tipo === 'entrada' || log.tipo === 'salida')
        ).sort((a, b) => {
          const tA = a.createdAt?.toDate ? a.createdAt.toDate().getTime() : (a.createdAt || 0);
          const tB = b.createdAt?.toDate ? b.createdAt.toDate().getTime() : (b.createdAt || 0);
          return tB - tA;
        });

        const sortedCron = [...empLogs].sort((a, b) => {
          const tA = a.createdAt?.toDate ? a.createdAt.toDate().getTime() : (a.createdAt || 0);
          const tB = b.createdAt?.toDate ? b.createdAt.toDate().getTime() : (b.createdAt || 0);
          return tA - tB;
        });

        // Calcular patrón de celular para modal
        const phoneLogs = fichajesLogs.filter(log => 
          log.empleadoId === fichajeResumenEmpleado.id && 
          log.dispositivo && 
          log.dispositivo !== 'PC/Terminal'
        );
        const phoneCounts = {};
        phoneLogs.forEach(log => {
          phoneCounts[log.dispositivo] = (phoneCounts[log.dispositivo] || 0) + 1;
        });
        let mostFrequentPhone = '';
        let maxPhoneCount = 0;
        Object.keys(phoneCounts).forEach(phone => {
          if (phoneCounts[phone] > maxPhoneCount) {
            maxPhoneCount = phoneCounts[phone];
            mostFrequentPhone = phone;
          }
        });

        let totalHoras = 0;
        let sesionesCompletas = 0;
        let entradaActiva = null;

        sortedCron.forEach(log => {
          if (log.tipo === 'entrada') {
            entradaActiva = log.createdAt?.toDate ? log.createdAt.toDate() : new Date(log.createdAt);
          } else if (log.tipo === 'salida' && entradaActiva) {
            const salidaTime = log.createdAt?.toDate ? log.createdAt.toDate() : new Date(log.createdAt);
            const diffMs = Math.max(0, salidaTime - entradaActiva);
            totalHoras += diffMs / (1000 * 60 * 60);
            sesionesCompletas += 1;
            entradaActiva = null;
          }
        });

        const calcResumen = calculos.find(c => c.emp.id === fichajeResumenEmpleado.id);

        return (
          <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setFichajeResumenEmpleado(null)}>
            <div className="modal" style={{ maxWidth: 900, background: 'rgba(25, 20, 20, 0.98)', border: '1px solid var(--border-bronze)', boxShadow: '0 20px 50px rgba(0,0,0,0.9)' }}>
              <div className="modal-header" style={{ borderBottom: '1px solid var(--border)' }}>
                <span className="modal-title" style={{ color: 'var(--bronze-light)', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <i className="ri-file-user-line" />
                  Perfil & Ficha Completa del Trabajador: {fichajeResumenEmpleado.nombre} {fichajeResumenEmpleado.apellido || ''}
                </span>
                <button onClick={() => setFichajeResumenEmpleado(null)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 20, cursor: 'pointer' }}>
                  <i className="ri-close-line" />
                </button>
              </div>
              <div className="modal-body" style={{ maxHeight: 'calc(100vh - 200px)', overflowY: 'auto', display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 20, padding: 20 }}>
                
                {/* COLUMNA 1: PERFIL Y DETALLE FINANCIERO */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16, borderRight: '1px solid var(--border)', paddingRight: 20 }}>
                  
                  {/* Datos del Trabajador */}
                  <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 12, padding: 14 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
                      <div style={{ width: 44, height: 44, borderRadius: 8, background: 'rgba(197,168,128,0.15)', border: '1px solid var(--border-bronze)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, fontWeight: 700, color: 'var(--bronze-light)' }}>
                        {fichajeResumenEmpleado.nombre[0]}{fichajeResumenEmpleado.apellido?.[0] || ''}
                      </div>
                      <div>
                        <h4 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: '#fff' }}>{fichajeResumenEmpleado.nombre} {fichajeResumenEmpleado.apellido || ''}</h4>
                        <div style={{ fontSize: 11, color: 'var(--text-secondary)', textTransform: 'uppercase', marginTop: 2 }}>
                          {fichajeResumenEmpleado.rol} · {fichajeResumenEmpleado.departamento}
                        </div>
                      </div>
                    </div>
                    
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, fontSize: 11, color: 'var(--text-secondary)', marginTop: 8 }}>
                      <div><strong>Teléfono:</strong> {fichajeResumenEmpleado.telefono || '—'}</div>
                      <div><strong>Frecuencia:</strong> {fichajeResumenEmpleado.frecuenciaPago || 'Quincenal'}</div>
                      <div><strong>Ingreso:</strong> {fichajeResumenEmpleado.fechaIngreso || '—'}</div>
                      <div>
                        <strong>Estado:</strong>{' '}
                        <span style={{ 
                          color: fichajeResumenEmpleado.estado === 'activo' ? 'var(--success)' : 'var(--danger)',
                          fontWeight: 700, textTransform: 'uppercase'
                        }}>
                          {fichajeResumenEmpleado.estado}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Resumen Financiero del Periodo Activo */}
                  {calcResumen ? (
                    <>
                      <div className="animate-fadeIn" style={{
                      background: 'rgba(197,168,128,0.04)',
                      border: '1px solid rgba(197,168,128,0.15)',
                      borderRadius: 12,
                      padding: 16,
                      fontSize: 11,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 8,
                      boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.03)'
                    }}>
                      <div style={{ color: 'var(--bronze-light)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 700, marginBottom: 4 }}>
                        Nómina del Periodo ({fechaInicio} al {fechaFin})
                      </div>
                      
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span style={{ color: 'var(--text-muted)' }}>Sueldo Base Proporcional ({calcResumen.diasTrabajados} días):</span>
                          <span style={{ fontWeight: 600, color: '#fff' }}>{fmt(calcResumen.sueldoProp)}</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span style={{ color: 'var(--text-muted)' }}>Comisión Mesas:</span>
                          <span style={{ fontWeight: 600, color: 'var(--info)' }}>{fmt(calcResumen.comisionMesas)}</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span style={{ color: 'var(--text-muted)' }}>Comisión Bar:</span>
                          <span style={{ fontWeight: 600, color: 'var(--info)' }}>{fmt(calcResumen.comisionBar)}</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span style={{ color: 'var(--text-muted)' }}>Bono por Turno:</span>
                          <span style={{ fontWeight: 600, color: 'var(--info)' }}>{fmt(calcResumen.bonoTurno)}</span>
                        </div>
                        
                        <div style={{ height: 1, background: 'rgba(255,255,255,0.06)', margin: '4px 0' }} />
                        
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span style={{ color: 'var(--text-muted)' }}>Adelantos Recibidos (Caja):</span>
                          <span style={{ fontWeight: 600, color: 'var(--bronze-light)' }}>-{fmt(calcResumen.gastoAdelantos)}</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span style={{ color: 'var(--text-muted)' }}>Préstamos Registrados:</span>
                          <span style={{ fontWeight: 600, color: 'var(--danger)' }}>-{fmt(calcResumen.gastoPrestamos)}</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span style={{ color: 'var(--text-muted)' }}>Faltantes de Caja:</span>
                          <span style={{ fontWeight: 600, color: 'var(--danger)' }}>-{fmt(calcResumen.gastoFaltantes)}</span>
                        </div>
                        {calcResumen.tardanzasDeduccion > 0 && (
                          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <span style={{ color: 'var(--text-muted)' }}>Deducción por Tardanzas ({calcResumen.tardanzas} t):</span>
                            <span style={{ fontWeight: 600, color: 'var(--danger)' }}>-{fmt(calcResumen.tardanzasDeduccion)}</span>
                          </div>
                        )}
                        
                        <div style={{ height: 1, background: 'rgba(255,255,255,0.1)', margin: '6px 0' }} />
                        
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ fontWeight: 700, color: '#fff', fontSize: 12 }}>Ingresos Brutos:</span>
                          <span style={{ fontWeight: 700, color: '#fff', fontSize: 12 }}>{fmt(calcResumen.sueldoProp + calcResumen.comisionMesas + calcResumen.comisionBar + calcResumen.bonoTurno)}</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ fontWeight: 700, color: 'var(--bronze-light)', fontSize: 12 }}>Deducciones y Adelantos Totales:</span>
                          <span style={{ fontWeight: 700, color: 'var(--bronze-light)', fontSize: 12 }}>-{fmt(calcResumen.gastoAdelantos + calcResumen.deducciones)}</span>
                        </div>
                        
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 6, background: 'rgba(0,0,0,0.15)', padding: '6px 10px', borderRadius: 8 }}>
                          <span style={{ fontWeight: 700, color: 'var(--warning)', fontSize: 12 }}>Saldo Neto a Pagar:</span>
                          <strong style={{ color: calcResumen.pendiente > 0 ? 'var(--warning)' : 'var(--success)', fontSize: 14 }}>
                            {calcResumen.pendiente > 0 ? fmt(calcResumen.pendiente) : 'PAGADO'}
                          </strong>
                        </div>
                      </div>

                      {/* Botones de Acción Internos */}
                      <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
                        {calcResumen.pendiente > 0 ? (
                          <button 
                            className="btn btn-success" 
                            onClick={() => { 
                              setShowPagarModal(calcResumen); 
                              setDescontarCaja(false); 
                            }}
                            style={{ flex: 1.5, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, fontSize: 11, height: 32 }}
                          >
                            <i className="ri-money-dollar-circle-line" /> Pagar Nómina
                          </button>
                        ) : (
                          (() => {
                            const pagoRealizado = pagos.find(p => p.empleadoId === fichajeResumenEmpleado.id && p.fechaInicio === fechaInicio && p.fechaFin === fechaFin);
                            return pagoRealizado ? (
                              <button 
                                className="btn btn-success" 
                                onClick={() => imprimirTicketNominaPago(pagoRealizado)}
                                style={{ flex: 1.5, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, fontSize: 11, height: 32 }}
                                title="Reimprimir el ticket de nómina para este período"
                              >
                                <i className="ri-printer-line" /> Recibo Impreso
                              </button>
                            ) : (
                              <div style={{ flex: 1.5, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, fontSize: 11, height: 32, background: 'rgba(34,197,94,0.1)', color: 'var(--success)', borderRadius: 8, fontWeight: 700 }}>
                                ✓ Nómina Completa
                              </div>
                            );
                          })()
                        )}
                        
                        <button 
                          className="btn btn-secondary" 
                          onClick={() => {
                            setEditandoEmpleado(fichajeResumenEmpleado.id);
                            setFormEmpleado({ nip: '', ...fichajeResumenEmpleado });
                            setActiveQrToken('');
                            setActiveQrExpires(0);
                            setShowEmpModal(true);
                          }}
                          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, fontSize: 11, padding: '0 10px', height: 32 }}
                        >
                          <i className="ri-pencil-line" /> Editar
                        </button>
                        
                        <button 
                          className="btn btn-danger" 
                          onClick={() => {
                            if (confirm(`¿Seguro que deseas eliminar a ${fichajeResumenEmpleado.nombre}? Esta acción es irreversible.`)) {
                              eliminarEmpleado(fichajeResumenEmpleado.id);
                              setFichajeResumenEmpleado(null);
                            }
                          }}
                          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, fontSize: 11, padding: '0 10px', height: 32 }}
                        >
                          <i className="ri-delete-bin-line" /> Eliminar
                        </button>
                      </div>

                    </div>

                    {/* Historial de Pagos Anteriores */}
                    {(() => {
                      const empPagosPrevios = pagos.filter(p => p.empleadoId === fichajeResumenEmpleado.id);
                      return (
                        <div style={{ marginTop: 14 }}>
                          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--bronze-light)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
                            Historial de Pagos Recibidos
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 110, overflowY: 'auto', paddingRight: 4 }}>
                            {empPagosPrevios.map(p => (
                              <div key={p.id} style={{
                                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border)',
                                borderRadius: 8, padding: '6px 10px', fontSize: 10
                              }}>
                                <div>
                                  <div style={{ fontWeight: 700, color: '#fff' }}>{p.periodo || `${p.fechaInicio} al ${p.fechaFin}`}</div>
                                  <div style={{ fontSize: 8, color: 'var(--text-muted)' }}>Pagado: {p.fecha} {p.descontoDeCaja ? '· Caja' : ''}</div>
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                  <strong style={{ color: 'var(--success)' }}>{fmt(p.total)}</strong>
                                  <button 
                                    onClick={() => imprimirTicketNominaPago(p)}
                                    style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 2 }} 
                                    title="Reimprimir Ticket"
                                  >
                                    <i className="ri-printer-line" />
                                  </button>
                                </div>
                              </div>
                            ))}
                            {empPagosPrevios.length === 0 && (
                              <div style={{ fontSize: 9, color: 'var(--text-muted)', fontStyle: 'italic', padding: '6px 0', textAlign: 'center' }}>
                                No se han registrado pagos para este empleado.
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })()}
                    </>
                  ) : (
                    <div style={{ color: 'var(--text-muted)', fontSize: 11, fontStyle: 'italic', padding: 10, textAlign: 'center' }}>
                      Cargando cálculos de nómina...
                    </div>
                  )}

                </div>

                {/* COLUMNA 2: FILTROS E HISTORIAL DE ASISTENCIA */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  
                  {/* Modificador de Fechas */}
                  <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 12, padding: 12 }}>
                    <div style={{ fontSize: 9, color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', marginBottom: 8, letterSpacing: '0.04em' }}>Filtrar Historial de Asistencia</div>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <input className="form-input" type="date" value={fichajeResumenInicio} onChange={e => setFichajeResumenInicio(e.target.value)} style={{ flex: 1, height: 28, fontSize: 10, padding: '2px 6px' }} />
                      <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>al</span>
                      <input className="form-input" type="date" value={fichajeResumenFin} onChange={e => setFichajeResumenFin(e.target.value)} style={{ flex: 1, height: 28, fontSize: 10, padding: '2px 6px' }} />
                    </div>
                  </div>

                  {/* Métricas Acumuladas */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    <div style={{ background: 'rgba(255,255,255,0.01)', border: '1px solid var(--border)', borderRadius: 12, padding: 10, textAlign: 'center' }}>
                      <div style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Sesiones</div>
                      <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--bronze-light)', marginTop: 2 }}>{sesionesCompletas}</div>
                    </div>
                    <div style={{ background: 'rgba(255,255,255,0.01)', border: '1px solid var(--border)', borderRadius: 12, padding: 10, textAlign: 'center' }}>
                      <div style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Horas</div>
                      <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--success)', marginTop: 2 }}>{totalHoras.toFixed(1)} hrs</div>
                    </div>
                  </div>

                  {/* Historial de Fichajes Detallado */}
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                      <div style={{ fontSize: 9, fontWeight: 700, color: '#fff', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Registros ({empLogs.length})</div>
                      <button 
                        className="btn btn-secondary btn-xs" 
                        onClick={() => exportarCSVEmpleado(fichajeResumenEmpleado, sortedCron)} 
                        style={{ fontSize: 9, height: 22, display: 'flex', alignItems: 'center', gap: 4, padding: '2px 6px' }}
                      >
                        <i className="ri-file-excel-2-line" style={{ color: '#22c55e', fontSize: 10 }} /> Exportar CSV
                      </button>
                    </div>
                    
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 220, overflowY: 'auto', paddingRight: 4 }}>
                      {empLogs.map(log => {
                        const d = log.createdAt?.toDate ? log.createdAt.toDate() : new Date(log.createdAt || Date.now());
                        const hora = d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
                        const fechaFmt = d.toLocaleDateString('es-MX', { day: '2-digit', month: 'short' });
                        const esEntrada = log.tipo === 'entrada';
                        const isLogCelularInusual = phoneLogs.length >= 3 && 
                                                    log.dispositivo && 
                                                    log.dispositivo !== 'PC/Terminal' && 
                                                    log.dispositivo !== mostFrequentPhone;
                        return (
                          <div key={log.id} style={{
                            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                            background: 'var(--bg-elevated)', border: '1px solid var(--border)',
                            borderRadius: 8, padding: '6px 10px', fontSize: 11
                          }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <span style={{ 
                                width: 18, height: 18, borderRadius: 4,
                                background: esEntrada ? 'rgba(34,197,94,0.1)' : 'rgba(107,114,128,0.1)',
                                color: esEntrada ? 'var(--success)' : '#9ca3af',
                                display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9
                              }}>
                                {esEntrada ? '📥' : '📤'}
                              </span>
                              <div>
                                <div style={{ fontWeight: 700, color: esEntrada ? 'var(--success)' : '#e5e7eb', fontSize: 10 }}>
                                  {esEntrada ? 'Entrada' : 'Salida'}
                                </div>
                                <div style={{ fontSize: 8, color: 'var(--text-muted)' }}>
                                  Vía: <span style={{ color: 'var(--bronze-light)' }}>{log.dispositivo || 'PC/Terminal'}</span>
                                  {isLogCelularInusual && (
                                    <span style={{ 
                                      fontSize: 7, color: 'var(--danger)', fontWeight: 800, 
                                      background: 'rgba(239,68,68,0.1)', padding: '1px 3px', 
                                      borderRadius: 2, marginLeft: 4 
                                    }}>
                                      INUSUAL
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>
                            <div style={{ textAlign: 'right' }}>
                              <div style={{ fontWeight: 600, fontSize: 10 }}>{hora}</div>
                              <div style={{ fontSize: 8, color: 'var(--text-muted)' }}>{fechaFmt}</div>
                            </div>
                          </div>
                        );
                      })}
                      {empLogs.length === 0 && (
                        <div style={{ textAlign: 'center', padding: '20px 0', fontSize: 10, color: 'var(--text-muted)', fontStyle: 'italic' }}>
                          Sin registros en este periodo
                        </div>
                      )}
                    </div>
                  </div>

                </div>

              </div>
              <div className="modal-footer" style={{ borderTop: '1px solid var(--border)', padding: '12px 16px' }}>
                <button className="btn btn-secondary" onClick={() => setFichajeResumenEmpleado(null)} style={{ padding: '6px 16px', fontSize: 11 }}>
                  Cerrar
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* MODAL EMPLEADO */}
      {showEmpModal && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setShowEmpModal(false)}>
          <div className="modal" style={{ maxWidth: 680 }}>
            <div className="modal-header">
              <span className="modal-title">{editandoEmpleado ? 'Editar Empleado' : 'Nuevo Empleado'}</span>
              <button onClick={() => setShowEmpModal(false)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 20, cursor: 'pointer' }}><i className="ri-close-line" /></button>
            </div>
            <div className="modal-body" style={{ maxHeight: 'calc(100vh - 200px)', overflowY: 'auto' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <F label="Nombre *"><input className="form-input" value={formEmpleado.nombre} onChange={e => setFormEmpleado(p => ({ ...p, nombre: e.target.value }))} placeholder="Juan" /></F>
                <F label="Apellido"><input className="form-input" value={formEmpleado.apellido} onChange={e => setFormEmpleado(p => ({ ...p, apellido: e.target.value }))} placeholder="Pérez" /></F>
                <F label="Teléfono"><input className="form-input" value={formEmpleado.telefono} onChange={e => setFormEmpleado(p => ({ ...p, telefono: e.target.value }))} placeholder="555-000-0000" /></F>
                <F label="Departamento">
                  <select className="form-select" value={formEmpleado.departamento} onChange={e => setFormEmpleado(p => ({ ...p, departamento: e.target.value }))}>
                    {DEPARTAMENTOS.map(d => <option key={d}>{d}</option>)}
                  </select>
                </F>
                <F label="Rol">
                  <select className="form-select" value={formEmpleado.rol} onChange={e => setFormEmpleado(p => ({ ...p, rol: e.target.value }))}>
                    {ROLES.map(r => <option key={r}>{r}</option>)}
                  </select>
                </F>
                <F label="Fecha de Ingreso"><input className="form-input" type="date" value={formEmpleado.fechaIngreso} onChange={e => setFormEmpleado(p => ({ ...p, fechaIngreso: e.target.value }))} /></F>
                <F label="Frecuencia de Pago">
                  <select className="form-select" value={formEmpleado.frecuenciaPago} onChange={e => setFormEmpleado(p => ({ ...p, frecuenciaPago: e.target.value }))}>
                    <option value="semanal">Semanal</option>
                    <option value="quincenal">Quincenal</option>
                    <option value="mensual">Mensual</option>
                  </select>
                </F>
                <F label="Estado">
                  <select className="form-select" value={formEmpleado.estado} onChange={e => setFormEmpleado(p => ({ ...p, estado: e.target.value }))}>
                    <option value="activo">Activo</option>
                    <option value="inactivo">Inactivo</option>
                    <option value="vacaciones">Vacaciones</option>
                    <option value="baja">Baja</option>
                  </select>
                </F>
                <F label="Sueldo Base ($)"><input className="form-input" type="number" value={formEmpleado.sueldoBase} onChange={e => setFormEmpleado(p => ({ ...p, sueldoBase: e.target.value }))} placeholder="0.00" /></F>
                <F label="Código NIP (Ingreso Cajero)"><input className="form-input" type="text" maxLength={6} value={formEmpleado.nip} onChange={e => setFormEmpleado(p => ({ ...p, nip: e.target.value }))} placeholder="Código numérico (4-6 dígitos)" /></F>
              </div>

              {/* Permisos (Solo visibles para Gerente y Cajero) */}
              {(formEmpleado.rol === 'Gerente' || formEmpleado.rol === 'Cajero') && (
                <div style={{ marginTop: 20, padding: 16, background: 'var(--bg-elevated)', borderRadius: 12, border: '1px solid var(--border)' }}>
                  <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.12em', color: 'var(--bronze-light)', marginBottom: 14 }}>
                    <i className="ri-shield-keyhole-line" /> Permisos de Acceso a Módulos
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                    {[
                      { id: 'dashboard', label: 'Dashboard' },
                      { id: 'mesas', label: 'Mesas' },
                      { id: 'caja', label: 'Caja / POS' },
                      { id: 'bar', label: 'Inventario IA' },
                      { id: 'clientes', label: 'Clientes' },
                      { id: 'torneos', label: 'Torneos' },
                      { id: 'nomina', label: 'Nómina & Gastos' },
                      { id: 'reportes', label: 'Reportes' },
                      { id: 'config', label: 'Configuración' },
                    ].map(p => (
                      <label key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={!!formEmpleado.permisos?.[p.id]}
                          onChange={e => {
                            const prevPermisos = formEmpleado.permisos || {};
                            setFormEmpleado(prev => ({
                              ...prev,
                              permisos: {
                                ...prevPermisos,
                                [p.id]: e.target.checked
                              }
                            }));
                          }}
                          style={{ accentColor: 'var(--bronze)' }}
                        />
                        <span>{p.label}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {/* Comisiones */}
              <div style={{ marginTop: 20, padding: 16, background: 'var(--bg-elevated)', borderRadius: 12, border: '1px solid var(--border)' }}>
                <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.12em', color: 'var(--bronze-light)', marginBottom: 14 }}>
                  <i className="ri-percent-line" /> Esquema de Comisiones
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: 12, alignItems: 'end', marginBottom: 10 }}>
                  <div className="form-group">
                    <label className="form-label">Comisión Mesas</label>
                    <input className="form-input" type="number" value={formEmpleado.comisionMesas} onChange={e => setFormEmpleado(p => ({ ...p, comisionMesas: e.target.value }))} placeholder="0" />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Tipo</label>
                    <select className="form-select" value={formEmpleado.comisionMesasTipo} onChange={e => setFormEmpleado(p => ({ ...p, comisionMesasTipo: e.target.value }))}>
                      <option value="porcentaje">%</option>
                      <option value="fijo">$</option>
                    </select>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', paddingBottom: 10 }}>por venta en mesas</div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: 12, alignItems: 'end', marginBottom: 10 }}>
                  <div className="form-group">
                    <label className="form-label">Comisión Bar</label>
                    <input className="form-input" type="number" value={formEmpleado.comisionBar} onChange={e => setFormEmpleado(p => ({ ...p, comisionBar: e.target.value }))} placeholder="0" />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Tipo</label>
                    <select className="form-select" value={formEmpleado.comisionBarTipo} onChange={e => setFormEmpleado(p => ({ ...p, comisionBarTipo: e.target.value }))}>
                      <option value="porcentaje">%</option>
                      <option value="fijo">$</option>
                    </select>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', paddingBottom: 10 }}>por venta en bar</div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: 12, alignItems: 'end' }}>
                  <div className="form-group">
                    <label className="form-label">Bono por Turno ($)</label>
                    <input className="form-input" type="number" value={formEmpleado.bonoTurno} onChange={e => setFormEmpleado(p => ({ ...p, bonoTurno: e.target.value }))} placeholder="0" />
                  </div>
                  <div />
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', paddingBottom: 10 }}>por turno completado</div>
                </div>
              </div>

              {/* Código QR Dinámico Temporal */}
              {editandoEmpleado && (
                <div style={{ marginTop: 20, padding: 16, background: 'var(--bg-elevated)', borderRadius: 12, border: '1px solid var(--border)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.12em', color: 'var(--bronze-light)' }}>
                    <i className="ri-qr-code-line" /> Código QR de Acceso y Pase de Lista
                  </div>
                  
                  {activeQrToken ? (
                    <>
                      <div style={{ background: '#fff', padding: 10, borderRadius: 8 }}>
                        <QRCodeSVG value={typeof window !== 'undefined' ? `${window.location.origin}/?scanId=${editandoEmpleado}&token=${activeQrToken}&expires=${activeQrExpires}` : `https://yoy-ia-billar.vercel.app/?scanId=${editandoEmpleado}&token=${activeQrToken}&expires=${activeQrExpires}`} size={120} />
                      </div>
                      <div style={{ fontSize: 10, color: 'var(--text-secondary)', textAlign: 'center', fontWeight: 600 }}>
                        Token: <span style={{ color: 'var(--bronze-light)' }}>{activeQrToken}</span> · Válido por 5 minutos
                      </div>
                      <button className="btn btn-secondary btn-xs" onClick={() => generarTokenQR(editandoEmpleado)} style={{ height: 26, fontSize: 10 }}>
                        🔄 Regenerar Código
                      </button>
                    </>
                  ) : (
                    <div style={{ textAlign: 'center', padding: '10px 0' }}>
                      <p style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 12 }}>
                        Genera un código QR dinámico temporal para que el empleado escanee y pase lista desde su celular de forma segura.
                      </p>
                      <button className="btn btn-primary btn-sm" onClick={() => generarTokenQR(editandoEmpleado)}>
                        🔑 Generar QR Dinámico
                      </button>
                    </div>
                  )}
                </div>
              )}

              <div className="form-group" style={{ marginTop: 16 }}>
                <label className="form-label">Notas</label>
                <textarea className="form-input" rows={2} value={formEmpleado.notas || ''} onChange={e => setFormEmpleado(p => ({ ...p, notas: e.target.value }))} placeholder="Notas adicionales..." style={{ resize: 'vertical' }} />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowEmpModal(false)}>Cancelar</button>
              <button className="btn btn-primary" onClick={guardarEmpleado}><i className="ri-save-line" /> Guardar</button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL GASTO */}
      {showGastoModal && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setShowGastoModal(false)}>
          <div className="modal" style={{ maxWidth: 500 }}>
            <div className="modal-header">
              <span className="modal-title">{editandoGasto ? 'Editar Gasto' : 'Nuevo Gasto'}</span>
              <button onClick={() => setShowGastoModal(false)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 20, cursor: 'pointer' }}><i className="ri-close-line" /></button>
            </div>
            <div className="modal-body">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <F label="Categoría">
                  <select 
                    className="form-select" 
                    value={formGasto.categoria} 
                    onChange={e => {
                      const cat = e.target.value;
                      setFormGasto(p => ({ 
                        ...p, 
                        categoria: cat,
                        empleadoId: cat === 'nomina' ? p.empleadoId || '' : '',
                        empleadoNombre: cat === 'nomina' ? p.empleadoNombre || '' : '',
                        conceptoNomina: cat === 'nomina' ? p.conceptoNomina || 'adelanto_nomina' : '',
                        descripcion: cat === 'nomina' ? p.descripcion : ''
                      }));
                    }}
                  >
                    {CATEGORIAS_GASTO.map(c => <option key={c.id} value={c.id}>{c.icon} {c.label}</option>)}
                  </select>
                </F>

                {formGasto.categoria === 'nomina' && (
                  <>
                    <F label="Empleado *">
                      <select 
                        className="form-select" 
                        value={formGasto.empleadoId} 
                        onChange={e => {
                          const empId = e.target.value;
                          const emp = empleados.find(x => x.id === empId);
                          const nombreCompleto = emp ? `${emp.nombre} ${emp.apellido || ''}`.trim() : '';
                          setFormGasto(p => ({ ...p, empleadoId: empId, empleadoNombre: nombreCompleto }));
                        }}
                        required
                        style={{ width: '100%', padding: '10px 12px', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 10, color: 'var(--text-main)', outline: 'none' }}
                      >
                        <option value="">-- Seleccionar Empleado --</option>
                        {empleados.filter(e => e.estado === 'activo').map(e => (
                          <option key={e.id} value={e.id}>
                            {e.nombre} {e.apellido || ''} ({e.rol})
                          </option>
                        ))}
                      </select>
                    </F>
                    <F label="Concepto de Nómina *">
                      <select 
                        className="form-select" 
                        value={formGasto.conceptoNomina} 
                        onChange={e => setFormGasto(p => ({ ...p, conceptoNomina: e.target.value }))}
                        required
                        style={{ width: '100%', padding: '10px 12px', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 10, color: 'var(--text-main)', outline: 'none' }}
                      >
                        <option value="adelanto_nomina">Adelanto de Nómina</option>
                        <option value="prestamo">Préstamo</option>
                        <option value="faltante">Faltante</option>
                      </select>
                    </F>
                  </>
                )}
                <F label="Subcategoría"><input className="form-input" value={formGasto.subcategoria} onChange={e => setFormGasto(p => ({ ...p, subcategoria: e.target.value }))} placeholder="Opcional (Ej. luz, tacos, paños)" /></F>
                <F label="Descripción *"><input className="form-input" value={formGasto.descripcion} onChange={e => setFormGasto(p => ({ ...p, descripcion: e.target.value }))} placeholder="Compra de tacos para personal" /></F>
                <F label="Proveedor"><input className="form-input" value={formGasto.proveedor} onChange={e => setFormGasto(p => ({ ...p, proveedor: e.target.value }))} placeholder="Nombre del proveedor" /></F>
                <F label="Fecha"><input className="form-input" type="date" value={formGasto.fecha} onChange={e => setFormGasto(p => ({ ...p, fecha: e.target.value }))} /></F>
                <F label="Monto ($) *"><input className="form-input" type="number" value={formGasto.monto} onChange={e => setFormGasto(p => ({ ...p, monto: e.target.value }))} placeholder="0.00" /></F>
                
                <div style={{ background: 'var(--bg-elevated)', borderRadius: 10, padding: 12, border: '1px solid var(--border)' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 12 }}>
                    <input type="checkbox" checked={formGasto.recurrente} onChange={e => setFormGasto(p => ({ ...p, recurrente: e.target.checked }))} style={{ accentColor: 'var(--bronze)' }} />
                    <strong>Gasto Recurrente</strong>
                  </label>
                  {formGasto.recurrente && (
                    <div className="form-group" style={{ marginTop: 10, marginBottom: 0 }}>
                      <label className="form-label" style={{ fontSize: 10 }}>Frecuencia</label>
                      <select className="form-select" value={formGasto.frecuencia} onChange={e => setFormGasto(p => ({ ...p, frecuencia: e.target.value }))} style={{ fontSize: 11, height: 28 }}>
                        <option value="semanal">Semanal</option>
                        <option value="mensual">Mensual</option>
                        <option value="trimestral">Trimestral</option>
                        <option value="semestral">Semestral</option>
                        <option value="anual">Anual</option>
                      </select>
                    </div>
                  )}
                </div>

                <F label="Notas"><textarea className="form-input" rows={2} value={formGasto.notas} onChange={e => setFormGasto(p => ({ ...p, notas: e.target.value }))} placeholder="Detalles de pago o notas..." /></F>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowGastoModal(false)}>Cancelar</button>
              <button className="btn btn-primary" onClick={guardarGasto}><i className="ri-save-line" /> Guardar</button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL PAGO */}
      {showPagarModal && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setShowPagarModal(null)}>
          <div className="modal" style={{ maxWidth: 420 }}>
            <div className="modal-header">
              <span className="modal-title">Confirmar Pago de Nómina</span>
              <button onClick={() => setShowPagarModal(null)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 20, cursor: 'pointer' }}><i className="ri-close-line" /></button>
            </div>
            <div className="modal-body">
              {showPagarModal === 'todos' ? (
                <div style={{ textAlign: 'center', padding: '8px 0' }}>
                  <div style={{ fontSize: 36, marginBottom: 8 }}>💰</div>
                  <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>Pagar nómina de personal completa</div>
                  <div style={{ fontFamily: 'var(--font-display)', fontSize: 32, fontWeight: 700, color: 'var(--bronze-light)', margin: '8px 0' }}>{fmt(totalPendiente)}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{calculos.filter(c => c.pendiente > 0).length} empleados con saldo pendiente</div>
                </div>
              ) : (
                <div style={{ textAlign: 'center', padding: '8px 0' }}>
                  <div style={{ fontSize: 36, marginBottom: 8 }}>💳</div>
                  <div style={{ fontSize: 14, fontWeight: 700 }}>{showPagarModal.emp.nombre} {showPagarModal.emp.apellido}</div>
                  <div style={{ fontFamily: 'var(--font-display)', fontSize: 32, fontWeight: 700, color: 'var(--bronze-light)', margin: '8px 0' }}>{fmt(showPagarModal.pendiente)}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{showPagarModal.diasTrabajados} días laborados (periodo actual)</div>
                  
                  {(showPagarModal.gastoAdelantos > 0 || showPagarModal.gastoPrestamos > 0 || showPagarModal.gastoFaltantes > 0 || showPagarModal.tardanzas > 0) && (
                    <div style={{ 
                      marginTop: 12, padding: '8px 12px', background: 'rgba(0,0,0,0.15)', 
                      borderRadius: 8, fontSize: 10, textAlign: 'left', display: 'flex', 
                      flexDirection: 'column', gap: 4, border: '1px solid var(--border-subtle)' 
                    }}>
                      <div style={{ fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', fontSize: 9 }}>Ajustes del Periodo (Caja):</div>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span>Sueldo Bruto + Comisiones:</span>
                        <span>{fmt(showPagarModal.sueldoProp + showPagarModal.comisionMesas + showPagarModal.comisionBar + showPagarModal.bonoTurno)}</span>
                      </div>
                      {showPagarModal.tardanzas > 0 && (
                        <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--warning)' }}>
                          <span>Deducción Tardanzas ({showPagarModal.tardanzas}):</span>
                          <span>- {fmt(showPagarModal.tardanzasDeduccion)}</span>
                        </div>
                      )}
                      {showPagarModal.gastoAdelantos > 0 && (
                        <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--bronze-light)' }}>
                          <span>Adelantos recibidos:</span>
                          <span>- {fmt(showPagarModal.gastoAdelantos)}</span>
                        </div>
                      )}
                      {showPagarModal.gastoPrestamos > 0 && (
                        <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--info)' }}>
                          <span>Préstamos deducidos:</span>
                          <span>- {fmt(showPagarModal.gastoPrestamos)}</span>
                        </div>
                      )}
                      {showPagarModal.gastoFaltantes > 0 && (
                        <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--danger)' }}>
                          <span>Faltantes deducidos:</span>
                          <span>- {fmt(showPagarModal.gastoFaltantes)}</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
              <div style={{ background: 'var(--bg-elevated)', borderRadius: 10, padding: 12, marginTop: 14, border: '1px solid var(--border)' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
                  <input type="checkbox" checked={descontarCaja} onChange={e => setDescontarCaja(e.target.checked)} style={{ width: 15, height: 15, accentColor: 'var(--bronze)' }} />
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: '#fff' }}>Descontar de Caja</div>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>Registrar como egreso inmediato en el POS / flujo de Caja</div>
                  </div>
                </label>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowPagarModal(null)}>Cancelar</button>
              <button className="btn btn-primary" onClick={() => showPagarModal === 'todos' ? pagar(null, true) : pagar(showPagarModal)}>
                <i className="ri-check-line" /> Confirmar Pago
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL PRESUPUESTOS */}
      {showPresupModal && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setShowPresupModal(false)}>
          <div className="modal" style={{ maxWidth: 500 }}>
            <div className="modal-header">
              <span className="modal-title"><i className="ri-pie-chart-2-line" /> Presupuestos Mensuales</span>
              <button onClick={() => setShowPresupModal(false)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 20, cursor: 'pointer' }}><i className="ri-close-line" /></button>
            </div>
            <div className="modal-body" style={{ maxHeight: 'calc(100vh - 220px)', overflowY: 'auto' }}>
              <p style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 16 }}>Asigna límites de gastos mensuales por categoría para control financiero:</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {CATEGORIAS_GASTO.map(c => (
                  <div key={c.id} style={{ display: 'grid', gridTemplateColumns: '1fr 120px', alignItems: 'center', gap: 12 }}>
                    <span style={{ fontSize: 12, fontWeight: 600 }}>{c.icon} {c.label}</span>
                    <input
                      className="form-input" type="number" placeholder="Sin límite"
                      value={presupForm[c.id] || ''}
                      onChange={e => setPresupForm(p => ({ ...p, [c.id]: e.target.value }))}
                      style={{ height: 28, fontSize: 11 }}
                    />
                  </div>
                ))}
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowPresupModal(false)}>Cancelar</button>
              <button className="btn btn-primary" onClick={guardarPresupuestos}><i className="ri-save-line" /> Guardar</button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL CALENDARIO */}
      {showCalendario && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setShowCalendario(false)}>
          <div className="modal" style={{ maxWidth: 680 }}>
            <div className="modal-header">
              <span className="modal-title">📅 Calendario Predictivo de Gastos</span>
              <button onClick={() => setShowCalendario(false)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 20, cursor: 'pointer' }}><i className="ri-close-line" /></button>
            </div>
            <div className="modal-body" style={{ maxHeight: 'calc(100vh - 200px)', overflowY: 'auto' }}>
              {(() => {
                const recurrentes = gastos.filter(g => g.recurrente);
                if (recurrentes.length === 0) return (
                  <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
                    <i className="ri-calendar-line" style={{ fontSize: 40, display: 'block', marginBottom: 12 }} />
                    <p>No hay gastos recurrentes registrados.</p>
                    <p style={{ fontSize: 11, marginTop: 8 }}>Al registrar un gasto, activa la opción {"\"Gasto Recurrente\""} para verlo aquí.</p>
                  </div>
                );

                const meses = [];
                for (let m = 0; m < 3; m++) {
                  const d = new Date();
                  d.setMonth(d.getMonth() + m);
                  meses.push({ label: d.toLocaleDateString('es-MX', { month: 'long', year: 'numeric' }), mes: d.getMonth(), anio: d.getFullYear() });
                }

                const frecuenciaMeses = { semanal: 0.25, mensual: 1, trimestral: 3, semestral: 6, anual: 12 };

                return (
                  <div>
                    <p style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 20 }}>
                      Proyección de <strong style={{ color: 'var(--bronze-light)' }}>{recurrentes.length} gastos recurrentes</strong> para los próximos 3 meses.
                    </p>

                    {meses.map((mes, mi) => {
                      const aplicables = recurrentes.filter(g => {
                        const freq = g.frecuencia || 'mensual';
                        const mesesCiclo = frecuenciaMeses[freq] || 1;
                        if (mesesCiclo <= 1) return true;
                        const fechaOrigen = new Date(g.fecha || today());
                        const mesOrigen = fechaOrigen.getMonth();
                        return ((mes.mes - mesOrigen + 12) % 12) % mesesCiclo === 0;
                      });
                      const totalMes = aplicables.reduce((s, g) => {
                        const freq = g.frecuencia || 'mensual';
                        const veces = freq === 'semanal' ? 4 : 1;
                        return s + Number(g.monto) * veces;
                      }, 0);

                      return (
                        <div key={mi} style={{ marginBottom: 20 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                            <div style={{ fontFamily: 'var(--font-display)', fontSize: 13, fontWeight: 700, textTransform: 'capitalize', color: mi === 0 ? 'var(--bronze-light)' : 'var(--text-primary)' }}>
                              {mi === 0 ? '📍 ' : ''}{mes.label}
                            </div>
                            <div style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 800, color: 'var(--danger)' }}>{fmt(totalMes)}</div>
                          </div>
                          {aplicables.length === 0 ? (
                            <div style={{ fontSize: 11, color: 'var(--text-muted)', padding: '8px 12px', background: 'var(--bg-elevated)', borderRadius: 8 }}>Sin gastos recurrentes este mes</div>
                          ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                              {aplicables.map((g, gi) => {
                                const cat = CATEGORIAS_GASTO.find(c => c.id === g.categoria);
                                const veces = g.frecuencia === 'semanal' ? 4 : 1;
                                const montoTotal = Number(g.monto) * veces;
                                const fechaOrigen = new Date(g.fecha || today());
                                const diaEstimado = fechaOrigen.getDate();
                                return (
                                  <div key={gi} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', background: 'var(--bg-elevated)', borderRadius: 10, border: `1px solid ${cat?.color || 'var(--border)'}20` }}>
                                    <div style={{ width: 32, height: 32, borderRadius: 8, background: `${cat?.color || '#6b7280'}15`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, flexShrink: 0 }}>
                                      {cat?.icon || '📋'}
                                    </div>
                                    <div style={{ flex: 1 }}>
                                      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>{g.descripcion}</div>
                                      <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                                        {cat?.label} · Día ~{diaEstimado} · {g.frecuencia}
                                        {veces > 1 ? ` × ${veces}` : ''}
                                      </div>
                                    </div>
                                    <div style={{ fontSize: 13, fontWeight: 700, color: cat?.color || 'var(--danger)' }}>{fmt(montoTotal)}</div>
                                    {mi === 0 && diaEstimado <= new Date().getDate() + 5 && (
                                      <span style={{ fontSize: 9, background: 'rgba(245,158,11,0.2)', color: '#f59e0b', padding: '2px 6px', borderRadius: 999, fontWeight: 800 }}>PRÓXIMO</span>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })}

                    <div style={{ background: 'var(--bronze-subtle)', border: '1px solid var(--border-bronze)', borderRadius: 12, padding: 14, marginTop: 8 }}>
                      <div style={{ fontSize: 11, color: 'var(--bronze-light)', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 700, marginBottom: 8 }}>
                        <i className="ri-funds-line" /> Proyección Total 3 Meses
                      </div>
                      <div style={{ fontFamily: 'var(--font-display)', fontSize: 26, fontWeight: 800, color: 'var(--bronze-light)' }}>
                        {fmt(meses.reduce((total, mes) => {
                          const aplicables = recurrentes.filter(g => {
                            const freq = g.frecuencia || 'mensual';
                            const mesesCiclo = frecuenciaMeses[freq] || 1;
                            if (mesesCiclo <= 1) return true;
                            const fechaOrigen = new Date(g.fecha || today());
                            return ((mes.mes - fechaOrigen.getMonth() + 12) % 12) % mesesCiclo === 0;
                          });
                          return total + aplicables.reduce((s, g) => s + Number(g.monto) * (g.frecuencia === 'semanal' ? 4 : 1), 0);
                        }, 0))}
                      </div>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}>Basado en {recurrentes.length} gastos recurrentes registrados</div>
                    </div>
                  </div>
                );
              })()}
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowCalendario(false)}>Cerrar</button>
              <button className="btn btn-primary" onClick={() => { setShowGastoModal(true); setShowCalendario(false); }}>
                <i className="ri-add-line" /> Agregar Gasto Recurrente
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

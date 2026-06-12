'use client';
import { useState, useEffect, useCallback } from 'react';
import {
  collection, addDoc, updateDoc, deleteDoc, doc,
  onSnapshot, query, orderBy, where, getDocs, Timestamp, serverTimestamp
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { hashNip } from '@/lib/crypto';


// ─────────────────────────────────────────────
// CONSTANTES
// ─────────────────────────────────────────────
const TABS = [
  { id: 'empleados',   label: 'Empleados',    icon: 'ri-team-line' },
  { id: 'asistencia',  label: 'Pase de Lista', icon: 'ri-calendar-check-line' },
  { id: 'nomina',      label: 'Nómina',        icon: 'ri-money-dollar-circle-line' },
  { id: 'gastos',      label: 'Gastos',        icon: 'ri-shopping-bag-3-line' },
  { id: 'ia',          label: 'IA & Reportes', icon: 'ri-robot-2-line' },
];

const DEPARTAMENTOS = ['Mesas', 'Bar', 'Caja', 'Limpieza', 'Seguridad', 'Administración', 'Mantenimiento'];
const ROLES = ['Mesero', 'Bartender', 'Cajero', 'Limpieza', 'Guardia', 'Gerente', 'Técnico'];
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
  { id: 'otro',       label: 'Otro / Personalizado',  icon: '➕', color: '#6b7280' },
];

const fmt = (n) => `$${Number(n || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const today = () => new Date().toISOString().slice(0, 10);

// ─────────────────────────────────────────────
// MEJORA 1: LECTOR DE VENTAS REALES (localStorage)
// Lee la bitácora de Mesas y Bar para calcular comisiones reales
// ─────────────────────────────────────────────
function useVentasReales(fechaInicio, fechaFin) {
  const [ventasMesas, setVentasMesas] = useState(0);
  const [ventasBar, setVentasBar] = useState(0);
  const [bitacora, setBitacora] = useState([]);

  useEffect(() => {
    // Escuchar la colección de bitacora desde Firestore para obtener datos de ventas reales
    const q = query(collection(db, 'bitacora'), orderBy('fecha', 'desc'));
    const unsub = onSnapshot(q, snap => {
      const eventos = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      
      // Filtrar por rango de fechas
      const fi = new Date(fechaInicio + 'T00:00:00');
      const ff = new Date(fechaFin + 'T23:59:59');
      const eventosPeriodo = eventos.filter(e => {
        const fe = new Date(e.fecha);
        return fe >= fi && fe <= ff;
      });

      setBitacora(eventosPeriodo);

      // Calcular ventas de mesas: eventos tipo 'Cierre Directo' o 'Mesa a Cuenta'
      const totalMesas = eventosPeriodo
        .filter(e => e.accion === 'Cierre Directo' || e.accion === 'Mesa a Cuenta')
        .reduce((s, e) => s + Math.abs(Number(e.monto) || 0), 0);

      // Calcular ventas de bar
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
    }, err => {
      console.error("Error al obtener bitácora para nómina:", err);
    });
    
    return unsub;
  }, [fechaInicio, fechaFin]);

  return { ventasMesas, ventasBar, bitacora };
}

// ─────────────────────────────────────────────
// MEJORA 2: HOOK DE ALERTAS IA GLOBALES
// Exporta alertas para uso en el Topbar (badge)
// ─────────────────────────────────────────────
export function useAlertasNomina() {
  const [alertas, setAlertas] = useState([]);

  useEffect(() => {
    const q = query(collection(db, 'nomina_asistencia'));
    const unsub = onSnapshot(q, snap => {
      const asistencias = snap.docs.map(d => d.data());
      const mesActual = new Date().toISOString().slice(0, 7);
      const nuevas = [];

      // Detectar empleados con 3+ ausencias este mes
      const porEmpleado = {};
      asistencias.filter(a => a.fecha?.startsWith(mesActual)).forEach(a => {
        if (!porEmpleado[a.empleadoId]) porEmpleado[a.empleadoId] = [];
        porEmpleado[a.empleadoId].push(a);
      });

      Object.entries(porEmpleado).forEach(([empId, registros]) => {
        const ausencias = registros.filter(r => r.estado === 'ausente').length;
        if (ausencias >= 3) {
          nuevas.push({ tipo: 'ausencia', empId, ausencias, mensaje: `${ausencias} ausencias este mes` });
        }
      });

      setAlertas(nuevas);
    });
    return unsub;
  }, []);

  return alertas;
}

// ─────────────────────────────────────────────
// COMPONENTES AUXILIARES
// ─────────────────────────────────────────────
function PanelHeader({ title, subtitle, icon, children }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 24, flexWrap: 'wrap', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <div style={{ width: 44, height: 44, borderRadius: 12, background: 'var(--bronze-subtle)', border: '1px solid var(--border-bronze)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, color: 'var(--bronze-light)' }}>
          <i className={icon} />
        </div>
        <div>
          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-primary)', lineHeight: 1 }}>{title}</h2>
          {subtitle && <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>{subtitle}</p>}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>{children}</div>
    </div>
  );
}

function StatCard({ icon, label, value, sub, color = 'var(--bronze-light)', iconBg = 'var(--bronze-subtle)' }) {
  return (
    <div className="stat-card" style={{ gap: 6 }}>
      <div style={{ width: 38, height: 38, borderRadius: 10, background: iconBg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 17, color, marginBottom: 4 }}>
        <i className={icon} />
      </div>
      <div className="stat-card-label">{label}</div>
      <div className="stat-card-value" style={{ fontSize: 24, color }}>{value}</div>
      {sub && <div className="stat-card-sub">{sub}</div>}
    </div>
  );
}

function Badge({ children, color = '#cd7f32', bg }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', padding: '3px 8px', borderRadius: 999, background: bg || `${color}20`, color, border: `1px solid ${color}40` }}>
      {children}
    </span>
  );
}

function ProgressBar({ value, max, color = 'var(--bronze)' }) {
  const pct = Math.min(100, Math.round((value / max) * 100)) || 0;
  const overBudget = pct >= 100;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <div style={{ flex: 1, height: 6, background: 'var(--bg-elevated)', borderRadius: 999, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: overBudget ? 'var(--danger)' : color, borderRadius: 999, transition: 'width 0.4s ease', boxShadow: overBudget ? '0 0 8px rgba(239,68,68,0.4)' : 'none' }} />
      </div>
      <span style={{ fontSize: 11, fontWeight: 700, color: overBudget ? 'var(--danger)' : 'var(--text-secondary)', minWidth: 36, textAlign: 'right' }}>{pct}%</span>
    </div>
  );
}

// ─────────────────────────────────────────────
// TAB 1 — EMPLEADOS
// ─────────────────────────────────────────────
function EmpleadosTab({ showToast }) {
  const [empleados, setEmpleados] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [editando, setEditando] = useState(null);
  const [filtro, setFiltro] = useState('');
  const [form, setForm] = useState({
    nombre: '', apellido: '', telefono: '', email: '',
    departamento: 'Mesas', rol: 'Mesero', fechaIngreso: today(),
    estado: 'activo', frecuenciaPago: 'quincenal',
    sueldoBase: '', comisionMesas: '', comisionMesasTipo: 'porcentaje',
    comisionBar: '', comisionBarTipo: 'porcentaje',
    comisionTurno: '', comisionTurnoTipo: 'porcentaje',
    bonoTurno: '', notas: '',
  });

  useEffect(() => {
    const q = query(collection(db, 'nomina_empleados'), orderBy('nombre'));
    const unsub = onSnapshot(q, snap => setEmpleados(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
    return unsub;
  }, []);

  const abrirNuevo = () => {
    setEditando(null);
    setForm({
      nombre: '', apellido: '', telefono: '', email: '', departamento: 'Mesas', rol: 'Mesero', fechaIngreso: today(), estado: 'activo', frecuenciaPago: 'quincenal', sueldoBase: '', comisionMesas: '', comisionMesasTipo: 'porcentaje', comisionBar: '', comisionBarTipo: 'porcentaje', comisionTurno: '', comisionTurnoTipo: 'porcentaje', bonoTurno: '', notas: '',
      nip: '',
      permisos: {
        dashboard: true,
        mesas: true,
        caja: true,
        bar: true,
        clientes: true,
        torneos: false,
        nomina: false,
        reportes: false,
        config: false
      }
    });
    setShowModal(true);
  };

  const abrirEditar = (emp) => {
    setEditando(emp.id);
    setForm({
      nip: '',
      permisos: {
        dashboard: false, mesas: false, caja: false, bar: false, clientes: false, torneos: false, nomina: false, reportes: false, config: false
      },
      ...emp
    });
    setShowModal(true);
  };

  const guardar = async () => {
    if (!form.nombre.trim()) return showToast('El nombre es requerido', 'error');
    if (form.nip && (form.nip.length < 4 || form.nip.length > 6)) {
      return showToast('El NIP debe tener entre 4 y 6 dígitos', 'error');
    }
    try {
      let finalNip = form.nip;
      if (finalNip && /^\d{4,6}$/.test(finalNip)) {
        finalNip = await hashNip(finalNip);
      }
      const data = { ...form, nip: finalNip, updatedAt: serverTimestamp() };
      if (editando) {
        await updateDoc(doc(db, 'nomina_empleados', editando), data);
        showToast('Empleado actualizado ✅', 'success');
      } else {
        await addDoc(collection(db, 'nomina_empleados'), { ...data, createdAt: serverTimestamp() });
        showToast('Empleado registrado ✅', 'success');
      }
      setShowModal(false);
    } catch (e) { showToast('Error al guardar: ' + e.message, 'error'); }
  };

  const eliminar = async (id) => {
    if (!confirm('¿Eliminar este empleado?')) return;
    await deleteDoc(doc(db, 'nomina_empleados', id));
    showToast('Empleado eliminado', 'info');
  };

  const filtrados = empleados.filter(e =>
    `${e.nombre} ${e.apellido} ${e.rol} ${e.departamento}`.toLowerCase().includes(filtro.toLowerCase())
  );

  const estadoColor = { activo: 'var(--success)', inactivo: 'var(--text-muted)', vacaciones: 'var(--info)', baja: 'var(--danger)' };
  const F = ({ label, children, col }) => (
    <div className="form-group" style={col ? { gridColumn: col } : {}}>
      <label className="form-label">{label}</label>
      {children}
    </div>
  );

  return (
    <div>
      <PanelHeader title="Empleados" subtitle={`${empleados.length} empleados registrados`} icon="ri-team-line">
        <div style={{ position: 'relative' }}>
          <i className="ri-search-line" style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', fontSize: 14 }} />
          <input className="form-input" placeholder="Buscar..." value={filtro} onChange={e => setFiltro(e.target.value)} style={{ paddingLeft: 32, width: 200, height: 36, fontSize: 13 }} />
        </div>
        <button className="btn btn-primary btn-sm" onClick={abrirNuevo}><i className="ri-user-add-line" /> Nuevo Empleado</button>
      </PanelHeader>

      {/* Stats rápidas */}
      <div className="stat-grid" style={{ marginBottom: 24 }}>
        <StatCard icon="ri-user-star-line" label="Activos" value={empleados.filter(e => e.estado === 'activo').length} color="var(--success)" iconBg="rgba(34,197,94,0.1)" />
        <StatCard icon="ri-rest-time-line" label="Vacaciones" value={empleados.filter(e => e.estado === 'vacaciones').length} color="var(--info)" iconBg="rgba(59,130,246,0.1)" />
        <StatCard icon="ri-user-unfollow-line" label="Inactivos" value={empleados.filter(e => e.estado === 'inactivo' || e.estado === 'baja').length} color="var(--text-muted)" iconBg="var(--bg-elevated)" />
        <StatCard icon="ri-building-4-line" label="Departamentos" value={[...new Set(empleados.map(e => e.departamento))].length} color="var(--bronze-light)" />
      </div>

      <div className="table-wrapper">
        <table>
          <thead>
            <tr>
              <th>Empleado</th>
              <th>Departamento / Rol</th>
              <th>Esquema de Pago</th>
              <th>Frecuencia</th>
              <th>Estado</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {filtrados.length === 0 ? (
              <tr><td colSpan={6} style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
                <i className="ri-team-line" style={{ fontSize: 32, display: 'block', marginBottom: 8 }} />
                No hay empleados registrados
              </td></tr>
            ) : filtrados.map(emp => (
              <tr key={emp.id}>
                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ width: 36, height: 36, borderRadius: 10, background: 'var(--bronze-subtle)', border: '1px solid var(--border-bronze)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-display)', fontSize: 15, fontWeight: 700, color: 'var(--bronze-light)', flexShrink: 0 }}>
                      {(emp.nombre?.[0] || '') + (emp.apellido?.[0] || '')}
                    </div>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>{emp.nombre} {emp.apellido}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{emp.telefono}</div>
                    </div>
                  </div>
                </td>
                <td>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{emp.departamento}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{emp.rol}</div>
                </td>
                <td>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                    {emp.sueldoBase > 0 && <span style={{ fontSize: 11, color: 'var(--bronze-light)' }}>💰 Base: {fmt(emp.sueldoBase)}</span>}
                    {emp.comisionMesas > 0 && <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>🎱 Mesas: {emp.comisionMesas}{emp.comisionMesasTipo === 'porcentaje' ? '%' : '$'}</span>}
                    {emp.comisionBar > 0 && <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>🍺 Bar: {emp.comisionBar}{emp.comisionBarTipo === 'porcentaje' ? '%' : '$'}</span>}
                    {emp.bonoTurno > 0 && <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>⭐ Bono turno: {fmt(emp.bonoTurno)}</span>}
                  </div>
                </td>
                <td><Badge color="var(--bronze-light)">{emp.frecuenciaPago}</Badge></td>
                <td><Badge color={estadoColor[emp.estado] || 'var(--text-muted)'}>{emp.estado}</Badge></td>
                <td>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button className="btn btn-secondary btn-sm btn-icon" onClick={() => abrirEditar(emp)} title="Editar"><i className="ri-edit-line" /></button>
                    <button className="btn btn-danger btn-sm btn-icon" onClick={() => eliminar(emp.id)} title="Eliminar"><i className="ri-delete-bin-line" /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Modal */}
      {showModal && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setShowModal(false)}>
          <div className="modal" style={{ maxWidth: 680 }}>
            <div className="modal-header">
              <span className="modal-title">{editando ? 'Editar Empleado' : 'Nuevo Empleado'}</span>
              <button onClick={() => setShowModal(false)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 20, cursor: 'pointer' }}><i className="ri-close-line" /></button>
            </div>
            <div className="modal-body">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <F label="Nombre *"><input className="form-input" value={form.nombre} onChange={e => setForm(p => ({ ...p, nombre: e.target.value }))} placeholder="Juan" /></F>
                <F label="Apellido"><input className="form-input" value={form.apellido} onChange={e => setForm(p => ({ ...p, apellido: e.target.value }))} placeholder="Pérez" /></F>
                <F label="Teléfono"><input className="form-input" value={form.telefono} onChange={e => setForm(p => ({ ...p, telefono: e.target.value }))} placeholder="555-000-0000" /></F>
                <F label="Email"><input className="form-input" value={form.email} onChange={e => setForm(p => ({ ...p, email: e.target.value }))} placeholder="juan@example.com" /></F>
                <F label="Departamento">
                  <select className="form-select" value={form.departamento} onChange={e => setForm(p => ({ ...p, departamento: e.target.value }))}>
                    {DEPARTAMENTOS.map(d => <option key={d}>{d}</option>)}
                  </select>
                </F>
                <F label="Rol">
                  <select className="form-select" value={form.rol} onChange={e => setForm(p => ({ ...p, rol: e.target.value }))}>
                    {ROLES.map(r => <option key={r}>{r}</option>)}
                  </select>
                </F>
                <F label="Fecha de Ingreso"><input className="form-input" type="date" value={form.fechaIngreso} onChange={e => setForm(p => ({ ...p, fechaIngreso: e.target.value }))} /></F>
                <F label="Frecuencia de Pago">
                  <select className="form-select" value={form.frecuenciaPago} onChange={e => setForm(p => ({ ...p, frecuenciaPago: e.target.value }))}>
                    <option value="semanal">Semanal</option>
                    <option value="quincenal">Quincenal</option>
                    <option value="mensual">Mensual</option>
                  </select>
                </F>
                <F label="Estado">
                  <select className="form-select" value={form.estado} onChange={e => setForm(p => ({ ...p, estado: e.target.value }))}>
                    <option value="activo">Activo</option>
                    <option value="inactivo">Inactivo</option>
                    <option value="vacaciones">Vacaciones</option>
                    <option value="baja">Baja</option>
                  </select>
                </F>
                <F label="Sueldo Base ($)"><input className="form-input" type="number" value={form.sueldoBase} onChange={e => setForm(p => ({ ...p, sueldoBase: e.target.value }))} placeholder="0.00" /></F>
                <F label="NIP de Ingreso (4-6 dígitos)"><input className="form-input" maxLength={6} type="password" value={form.nip || ''} onChange={e => setForm(p => ({ ...p, nip: e.target.value.replace(/\D/g, '') }))} placeholder="Ej: 1234" /></F>
              </div>

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
                        checked={!!form.permisos?.[p.id]}
                        onChange={e => {
                          const prevPermisos = form.permisos || {};
                          setForm(prev => ({
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

              <div style={{ marginTop: 20, padding: 16, background: 'var(--bg-elevated)', borderRadius: 12, border: '1px solid var(--border)' }}>
                <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.12em', color: 'var(--bronze-light)', marginBottom: 14 }}>
                  <i className="ri-percent-line" /> Esquema de Comisiones
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: 12, alignItems: 'end', marginBottom: 10 }}>
                  <div className="form-group">
                    <label className="form-label">Comisión Mesas</label>
                    <input className="form-input" type="number" value={form.comisionMesas} onChange={e => setForm(p => ({ ...p, comisionMesas: e.target.value }))} placeholder="0" />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Tipo</label>
                    <select className="form-select" value={form.comisionMesasTipo} onChange={e => setForm(p => ({ ...p, comisionMesasTipo: e.target.value }))}>
                      <option value="porcentaje">%</option>
                      <option value="fijo">$</option>
                    </select>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', paddingBottom: 10 }}>por venta en mesas</div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: 12, alignItems: 'end', marginBottom: 10 }}>
                  <div className="form-group">
                    <label className="form-label">Comisión Bar</label>
                    <input className="form-input" type="number" value={form.comisionBar} onChange={e => setForm(p => ({ ...p, comisionBar: e.target.value }))} placeholder="0" />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Tipo</label>
                    <select className="form-select" value={form.comisionBarTipo} onChange={e => setForm(p => ({ ...p, comisionBarTipo: e.target.value }))}>
                      <option value="porcentaje">%</option>
                      <option value="fijo">$</option>
                    </select>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', paddingBottom: 10 }}>por venta en bar</div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: 12, alignItems: 'end' }}>
                  <div className="form-group">
                    <label className="form-label">Bono por Turno ($)</label>
                    <input className="form-input" type="number" value={form.bonoTurno} onChange={e => setForm(p => ({ ...p, bonoTurno: e.target.value }))} placeholder="0" />
                  </div>
                  <div />
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', paddingBottom: 10 }}>por turno completado</div>
                </div>
              </div>

              <div className="form-group" style={{ marginTop: 16 }}>
                <label className="form-label">Notas</label>
                <textarea className="form-input" rows={2} value={form.notas} onChange={e => setForm(p => ({ ...p, notas: e.target.value }))} placeholder="Notas adicionales..." style={{ resize: 'vertical' }} />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowModal(false)}>Cancelar</button>
              <button className="btn btn-primary" onClick={guardar}><i className="ri-save-line" /> {editando ? 'Actualizar' : 'Guardar'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// TAB 2 — PASE DE LISTA
// ─────────────────────────────────────────────
function AsistenciaTab({ showToast }) {
  const [empleados, setEmpleados] = useState([]);
  const [asistencias, setAsistencias] = useState({});
  const [fecha, setFecha] = useState(today());
  const [turno, setTurno] = useState('manana');
  const [loading, setLoading] = useState(false);
  const [vistaHistorial, setVistaHistorial] = useState(false);
  const [historial, setHistorial] = useState([]);

  useEffect(() => {
    const q = query(collection(db, 'nomina_empleados'), where('estado', '==', 'activo'));
    const unsub = onSnapshot(q, snap => setEmpleados(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
    return unsub;
  }, []);

  useEffect(() => {
    cargarAsistencias();
  }, [fecha, turno]);

  const cargarAsistencias = async () => {
    try {
      const q = query(collection(db, 'nomina_asistencia'), where('fecha', '==', fecha), where('turno', '==', turno));
      const snap = await getDocs(q);
      const map = {};
      snap.docs.forEach(d => { map[d.data().empleadoId] = { id: d.id, ...d.data() }; });
      setAsistencias(map);
    } catch (e) { console.error(e); }
  };

  const toggleAsistencia = async (empleadoId, estadoActual) => {
    const estados = ['presente', 'ausente', 'tardanza', 'permiso'];
    const idx = estados.indexOf(estadoActual || 'ausente');
    const nuevoEstado = estados[(idx + 1) % estados.length];
    setLoading(true);
    try {
      const registroExistente = asistencias[empleadoId];
      if (registroExistente) {
        await updateDoc(doc(db, 'nomina_asistencia', registroExistente.id), { estado: nuevoEstado, updatedAt: serverTimestamp() });
      } else {
        await addDoc(collection(db, 'nomina_asistencia'), { empleadoId, fecha, turno, estado: nuevoEstado, createdAt: serverTimestamp() });
      }
      setAsistencias(prev => ({ ...prev, [empleadoId]: { ...prev[empleadoId], empleadoId, estado: nuevoEstado } }));
    } catch (e) { showToast('Error: ' + e.message, 'error'); }
    setLoading(false);
  };

  const marcarTodos = async (estado) => {
    setLoading(true);
    for (const emp of empleados) {
      const registroExistente = asistencias[emp.id];
      if (registroExistente) {
        await updateDoc(doc(db, 'nomina_asistencia', registroExistente.id), { estado, updatedAt: serverTimestamp() });
      } else {
        await addDoc(collection(db, 'nomina_asistencia'), { empleadoId: emp.id, fecha, turno, estado, createdAt: serverTimestamp() });
      }
    }
    await cargarAsistencias();
    setLoading(false);
    showToast(`Todos marcados como ${estado} ✅`, 'success');
  };

  const presentes = empleados.filter(e => asistencias[e.id]?.estado === 'presente').length;
  const ausentes = empleados.filter(e => asistencias[e.id]?.estado === 'ausente').length;
  const tardan = empleados.filter(e => asistencias[e.id]?.estado === 'tardanza').length;
  const permisos = empleados.filter(e => asistencias[e.id]?.estado === 'permiso').length;
  const turnoInfo = TURNOS.find(t => t.id === turno);

  return (
    <div>
      <PanelHeader title="Pase de Lista" subtitle="Registro de asistencia por turno" icon="ri-calendar-check-line">
        <button className="btn btn-secondary btn-sm" onClick={() => setVistaHistorial(!vistaHistorial)}>
          <i className={vistaHistorial ? 'ri-grid-line' : 'ri-history-line'} /> {vistaHistorial ? 'Pase de Lista' : 'Historial'}
        </button>
      </PanelHeader>

      {/* Controles de Fecha y Turno */}
      <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginBottom: 20, flexWrap: 'wrap' }}>
        <div className="form-group" style={{ margin: 0 }}>
          <label className="form-label">Fecha</label>
          <input className="form-input" type="date" value={fecha} onChange={e => setFecha(e.target.value)} style={{ width: 160 }} />
        </div>
        <div>
          <div className="form-label" style={{ marginBottom: 6 }}>Turno</div>
          <div style={{ display: 'flex', gap: 8 }}>
            {TURNOS.map(t => (
              <button key={t.id} onClick={() => setTurno(t.id)} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, padding: '8px 16px', borderRadius: 10, border: `1px solid ${turno === t.id ? 'var(--bronze)' : 'var(--border)'}`, background: turno === t.id ? 'var(--bronze-subtle)' : 'var(--bg-elevated)', cursor: 'pointer', transition: 'all 0.15s' }}>
                <span style={{ fontSize: 16 }}>{t.icon}</span>
                <span style={{ fontSize: 11, fontWeight: 700, color: turno === t.id ? 'var(--bronze-light)' : 'var(--text-secondary)' }}>{t.label}</span>
                <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>{t.hora}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Contadores */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 20 }}>
        {[
          { label: 'Presentes', val: presentes, color: '#22c55e', icon: '✅' },
          { label: 'Ausentes',  val: ausentes,  color: '#ef4444', icon: '❌' },
          { label: 'Tardanza',  val: tardan,    color: '#f59e0b', icon: '⚠️' },
          { label: 'Permiso',   val: permisos,  color: '#3b82f6', icon: '🏥' },
        ].map(({ label, val, color, icon }) => (
          <div key={label} style={{ background: 'var(--bg-card)', border: `1px solid ${color}30`, borderRadius: 12, padding: '14px 16px', textAlign: 'center' }}>
            <div style={{ fontSize: 22 }}>{icon}</div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 700, color, lineHeight: 1, margin: '4px 0' }}>{val}</div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>{label}</div>
          </div>
        ))}
      </div>

      {/* Acciones rápidas */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
        <button className="btn btn-success btn-sm" onClick={() => marcarTodos('presente')} disabled={loading}><i className="ri-checkbox-circle-line" /> Marcar Todos Presente</button>
        <button className="btn btn-danger btn-sm" onClick={() => marcarTodos('ausente')} disabled={loading}><i className="ri-close-circle-line" /> Marcar Todos Ausente</button>
      </div>

      {/* Grid de empleados */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 14 }}>
        {empleados.map(emp => {
          const asist = asistencias[emp.id];
          const estadoInfo = ESTADO_ASISTENCIA.find(e => e.id === (asist?.estado || '')) || { color: 'var(--border)', bg: 'var(--bg-elevated)', icon: '—', label: 'Sin registro' };
          return (
            <button
              key={emp.id}
              onClick={() => toggleAsistencia(emp.id, asist?.estado)}
              disabled={loading}
              style={{ background: estadoInfo.bg, border: `2px solid ${estadoInfo.color}`, borderRadius: 16, padding: '16px 12px', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, transition: 'all 0.2s', boxShadow: asist?.estado === 'presente' ? `0 0 16px ${estadoInfo.color}30` : 'none' }}
              onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-3px)'; }}
              onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)'; }}
            >
              <div style={{ width: 52, height: 52, borderRadius: 14, background: 'var(--bg-card)', border: `2px solid ${estadoInfo.color}50`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 800, color: estadoInfo.color }}>
                {(emp.nombre?.[0] || '') + (emp.apellido?.[0] || '')}
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.2 }}>{emp.nombre}</div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>{emp.rol}</div>
              </div>
              <div style={{ fontSize: 18 }}>{estadoInfo.icon}</div>
              <div style={{ fontSize: 10, fontWeight: 700, color: estadoInfo.color, textTransform: 'uppercase', letterSpacing: '0.1em' }}>{estadoInfo.label}</div>
            </button>
          );
        })}
        {empleados.length === 0 && (
          <div style={{ gridColumn: '1/-1', textAlign: 'center', padding: 60, color: 'var(--text-muted)' }}>
            <i className="ri-team-line" style={{ fontSize: 40, display: 'block', marginBottom: 12 }} />
            No hay empleados activos. Registra empleados primero.
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// TAB 3 — NÓMINA
// ─────────────────────────────────────────────
function NominaTab({ showToast }) {
  const [empleados, setEmpleados] = useState([]);
  const [asistencias, setAsistencias] = useState([]);
  const [pagos, setPagos] = useState([]);
  const [periodo, setPeriodo] = useState('quincenal');
  const [fechaInicio, setFechaInicio] = useState(() => { const d = new Date(); d.setDate(1); return d.toISOString().slice(0, 10); });
  const [fechaFin, setFechaFin] = useState(today());
  const [calculos, setCalculos] = useState([]);
  const [showPagarModal, setShowPagarModal] = useState(null);
  const [descontarCaja, setDescontarCaja] = useState(false);
  const [historialEmp, setHistorialEmp] = useState(null);

  // MEJORA 1 INTEGRADA: leer ventas reales de localStorage
  const { ventasMesas, ventasBar } = useVentasReales(fechaInicio, fechaFin);

  const calcularNomina = useCallback(() => {
    if (!empleados.length) {
      setCalculos([]);
      return;
    }
    const dias = Math.max(1, Math.round((new Date(fechaFin) - new Date(fechaInicio)) / 86400000) + 1);
    const result = empleados.map(emp => {
      const asistEmp = asistencias.filter(a => a.empleadoId === emp.id);
      const diasTrabajados = asistEmp.filter(a => a.estado === 'presente').length;
      const tardanzas = asistEmp.filter(a => a.estado === 'tardanza').length;
      const sueldoBase = Number(emp.sueldoBase) || 0;
      const sueldoProp = sueldoBase > 0 ? (sueldoBase / dias) * diasTrabajados : 0;
      const deducciones = tardanzas * (sueldoBase / dias / 2);

      // ── COMISIONES REALES desde datos de Mesas y Bar ──────────
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
      // ─────────────────────────────────────────────────────────

      const bonoTurno = (Number(emp.bonoTurno) || 0) * diasTrabajados;
      const total = Math.max(0, sueldoProp + comisionMesas + comisionBar + bonoTurno - deducciones);
      const pagado = pagos.filter(p => p.empleadoId === emp.id && p.fechaInicio === fechaInicio && p.fechaFin === fechaFin).reduce((s, p) => s + (p.total || 0), 0);
      return { emp, diasTrabajados, tardanzas, sueldoProp, comisionMesas, comisionBar, bonoTurno, deducciones, total, pagado, pendiente: Math.max(0, total - pagado) };
    });
    setCalculos(result);
  }, [empleados, asistencias, pagos, fechaInicio, fechaFin, ventasMesas, ventasBar]);

  const cargarAsistenciasPeriodo = useCallback(async () => {
    if (!fechaInicio || !fechaFin) return;
    try {
      const q = query(collection(db, 'nomina_asistencia'), where('fecha', '>=', fechaInicio), where('fecha', '<=', fechaFin));
      const snap = await getDocs(q);
      setAsistencias(snap.docs.map(d => d.data()));
    } catch (e) {
      console.error("Error al cargar asistencias del periodo:", e);
    }
  }, [fechaInicio, fechaFin]);

  useEffect(() => {
    cargarAsistenciasPeriodo();
  }, [cargarAsistenciasPeriodo]);

  useEffect(() => {
    const unsub1 = onSnapshot(query(collection(db, 'nomina_empleados'), where('estado', '==', 'activo')), snap => setEmpleados(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
    const unsub2 = onSnapshot(query(collection(db, 'nomina_pagos'), orderBy('fecha', 'desc')), snap => setPagos(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
    return () => { unsub1(); unsub2(); };
  }, []);

  useEffect(() => {
    calcularNomina();
  }, [calcularNomina]);

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
        if (descontarCaja) {
          await addDoc(collection(db, 'gastos'), {
            categoria: 'admin', descripcion: `Pago de nómina — ${item.emp.nombre} ${item.emp.apellido}`,
            monto: item.pendiente, fecha: today(), createdAt: serverTimestamp(),
          });
        }
      }
      showToast(`${todos ? 'Nómina completa' : 'Pago'} registrado ✅`, 'success');
      setShowPagarModal(null);
      calcularNomina();
    } catch (e) { showToast('Error: ' + e.message, 'error'); }
  };

  const totalPendiente = calculos.reduce((s, c) => s + c.pendiente, 0);
  const totalPagado = calculos.reduce((s, c) => s + c.pagado, 0);

  return (
    <div>
      <PanelHeader title="Nómina" subtitle="Cálculo y pago de nómina por período" icon="ri-money-dollar-circle-line">
        <button className="btn btn-primary btn-sm" onClick={() => { setShowPagarModal('todos'); setDescontarCaja(false); }} disabled={totalPendiente === 0}>
          <i className="ri-group-line" /> Pagar Todos ({fmt(totalPendiente)})
        </button>
      </PanelHeader>

      {/* Período */}
      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-bronze)', borderRadius: 14, padding: 16, marginBottom: 20, display: 'flex', gap: 16, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div className="form-group" style={{ margin: 0 }}>
          <label className="form-label">Período</label>
          <select className="form-select" value={periodo} onChange={e => setPeriodo(e.target.value)} style={{ width: 140 }}>
            <option value="semanal">Semanal</option>
            <option value="quincenal">Quincenal</option>
            <option value="mensual">Mensual</option>
          </select>
        </div>
        <div className="form-group" style={{ margin: 0 }}>
          <label className="form-label">Fecha Inicio</label>
          <input className="form-input" type="date" value={fechaInicio} onChange={e => setFechaInicio(e.target.value)} style={{ width: 160 }} />
        </div>
        <div className="form-group" style={{ margin: 0 }}>
          <label className="form-label">Fecha Fin</label>
          <input className="form-input" type="date" value={fechaFin} onChange={e => setFechaFin(e.target.value)} style={{ width: 160 }} />
        </div>
        <button className="btn btn-secondary btn-sm" onClick={cargarAsistenciasPeriodo}><i className="ri-refresh-line" /> Recalcular</button>
      </div>

      {/* Banner ventas reales integradas */}
      {(ventasMesas > 0 || ventasBar > 0) && (
        <div style={{ background: 'rgba(34,197,94,0.06)', border: '1px solid rgba(34,197,94,0.2)', borderRadius: 12, padding: '10px 16px', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
          <i className="ri-link" style={{ color: 'var(--success)', fontSize: 16 }} />
          <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
            <strong style={{ color: 'var(--success)' }}>✅ Comisiones integradas con ventas reales:</strong>{' '}
            Mesas {fmt(ventasMesas)} · Bar {fmt(ventasBar)} — Las comisiones se calculan automáticamente.
          </div>
        </div>
      )}

      {/* Stats */}
      <div className="stat-grid" style={{ marginBottom: 20 }}>
        <StatCard icon="ri-user-line" label="Empleados" value={calculos.length} />
        <StatCard icon="ri-money-dollar-box-line" label="Total Nómina" value={fmt(totalPendiente + totalPagado)} color="var(--bronze-light)" />
        <StatCard icon="ri-check-double-line" label="Ya Pagado" value={fmt(totalPagado)} color="var(--success)" iconBg="rgba(34,197,94,0.1)" />
        <StatCard icon="ri-time-line" label="Pendiente" value={fmt(totalPendiente)} color="var(--warning)" iconBg="rgba(245,158,11,0.1)" />
      </div>

      <div className="table-wrapper">
        <table>
          <thead>
            <tr>
              <th>Empleado</th>
              <th>Días</th>
              <th>Sueldo Base</th>
              <th>Comisiones</th>
              <th>Deducciones</th>
              <th>Total</th>
              <th>Estado</th>
              <th>Acción</th>
            </tr>
          </thead>
          <tbody>
            {calculos.length === 0 ? (
              <tr><td colSpan={8} style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>No hay empleados activos</td></tr>
            ) : calculos.map(calc => (
              <tr key={calc.emp.id}>
                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ width: 32, height: 32, borderRadius: 8, background: 'var(--bronze-subtle)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 800, color: 'var(--bronze-light)' }}>
                      {(calc.emp.nombre?.[0] || '') + (calc.emp.apellido?.[0] || '')}
                    </div>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>{calc.emp.nombre} {calc.emp.apellido}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{calc.emp.rol}</div>
                    </div>
                  </div>
                </td>
                <td>
                  <span style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 700, color: 'var(--text-primary)' }}>{calc.diasTrabajados}</span>
                  {calc.tardanzas > 0 && <span style={{ fontSize: 10, color: 'var(--warning)', display: 'block' }}>⚠️ {calc.tardanzas} tardanza(s)</span>}
                </td>
                <td style={{ color: 'var(--bronze-light)' }}>{fmt(calc.sueldoProp)}</td>
                <td style={{ color: 'var(--info)' }}>{fmt(calc.comisionMesas + calc.comisionBar + calc.bonoTurno)}</td>
                <td style={{ color: 'var(--danger)' }}>{calc.deducciones > 0 ? `-${fmt(calc.deducciones)}` : '—'}</td>
                <td><strong style={{ fontSize: 15, color: 'var(--text-primary)' }}>{fmt(calc.total)}</strong></td>
                <td>
                  {calc.pendiente === 0
                    ? <Badge color="var(--success)"><i className="ri-check-line" /> Pagado</Badge>
                    : calc.pagado > 0
                      ? <Badge color="var(--info)">Parcial</Badge>
                      : <Badge color="var(--warning)">Pendiente</Badge>
                  }
                </td>
                <td>
                  {calc.pendiente > 0 && (
                    <button className="btn btn-success btn-sm" onClick={() => { setShowPagarModal(calc); setDescontarCaja(false); }}>
                      <i className="ri-money-dollar-box-line" /> Pagar {fmt(calc.pendiente)}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Modal de pago */}
      {showPagarModal && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setShowPagarModal(null)}>
          <div className="modal" style={{ maxWidth: 440 }}>
            <div className="modal-header">
              <span className="modal-title">Confirmar Pago</span>
              <button onClick={() => setShowPagarModal(null)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 20, cursor: 'pointer' }}><i className="ri-close-line" /></button>
            </div>
            <div className="modal-body">
              {showPagarModal === 'todos' ? (
                <div style={{ textAlign: 'center', padding: '8px 0' }}>
                  <div style={{ fontSize: 40, marginBottom: 12 }}>💰</div>
                  <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>Pagar nómina completa</div>
                  <div style={{ fontFamily: 'var(--font-display)', fontSize: 36, fontWeight: 700, color: 'var(--bronze-light)', margin: '8px 0' }}>{fmt(totalPendiente)}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{calculos.filter(c => c.pendiente > 0).length} empleados pendientes</div>
                </div>
              ) : (
                <div style={{ textAlign: 'center', padding: '8px 0' }}>
                  <div style={{ fontSize: 40, marginBottom: 12 }}>💳</div>
                  <div style={{ fontSize: 15, fontWeight: 700 }}>{showPagarModal.emp.nombre} {showPagarModal.emp.apellido}</div>
                  <div style={{ fontFamily: 'var(--font-display)', fontSize: 36, fontWeight: 700, color: 'var(--bronze-light)', margin: '8px 0' }}>{fmt(showPagarModal.pendiente)}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{showPagarModal.diasTrabajados} días trabajados</div>
                </div>
              )}
              <div style={{ background: 'var(--bg-elevated)', borderRadius: 10, padding: 14, marginTop: 16 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
                  <input type="checkbox" checked={descontarCaja} onChange={e => setDescontarCaja(e.target.checked)} style={{ width: 16, height: 16, accentColor: 'var(--bronze)' }} />
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>Descontar de Caja</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Registrar como egreso en el módulo de Caja</div>
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
    </div>
  );
}

// ─────────────────────────────────────────────
// TAB 4 — GASTOS & MANTENIMIENTO
// ─────────────────────────────────────────────
function GastosTab({ showToast }) {
  const [gastos, setGastos] = useState([]);
  const [presupuestos, setPresupuestos] = useState({});
  const [showModal, setShowModal] = useState(false);
  const [showPresupModal, setShowPresupModal] = useState(false);
  const [showCalendario, setShowCalendario] = useState(false); // MEJORA 3
  const [filtroMes, setFiltroMes] = useState(() => new Date().toISOString().slice(0, 7));
  const [filtroCategoria, setFiltroCategoria] = useState('');
  const [form, setForm] = useState({ categoria: 'mesas', subcategoria: '', descripcion: '', monto: '', fecha: today(), proveedor: '', recurrente: false, frecuencia: 'mensual', notas: '' });
  const [presupForm, setPresupForm] = useState({});

  useEffect(() => {
    const q = query(collection(db, 'gastos'), orderBy('fecha', 'desc'));
    const unsub = onSnapshot(q, snap => setGastos(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
    return unsub;
  }, []);

  useEffect(() => {
    const q = query(collection(db, 'presupuestos'));
    const unsub = onSnapshot(q, snap => {
      const map = {};
      snap.docs.forEach(d => { map[d.data().categoria] = { id: d.id, ...d.data() }; });
      setPresupuestos(map);
      const pf = {};
      CATEGORIAS_GASTO.forEach(c => { pf[c.id] = map[c.id]?.montoMensual || ''; });
      setPresupForm(pf);
    });
    return unsub;
  }, []);

  const guardarGasto = async () => {
    if (!form.monto || !form.descripcion) return showToast('Completa descripción y monto', 'error');
    try {
      await addDoc(collection(db, 'gastos'), { ...form, monto: Number(form.monto), createdAt: serverTimestamp() });
      showToast('Gasto registrado ✅', 'success');
      setShowModal(false);
      setForm({ categoria: 'mesas', subcategoria: '', descripcion: '', monto: '', fecha: today(), proveedor: '', recurrente: false, frecuencia: 'mensual', notas: '' });
    } catch (e) { showToast('Error: ' + e.message, 'error'); }
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

  const eliminarGasto = async (id) => {
    if (!confirm('¿Eliminar este gasto?')) return;
    await deleteDoc(doc(db, 'gastos', id));
    showToast('Gasto eliminado', 'info');
  };

  const gastosMes = gastos.filter(g => g.fecha?.startsWith(filtroMes));
  const gastosFiltrados = gastosMes.filter(g => !filtroCategoria || g.categoria === filtroCategoria);

  const totalMes = gastosMes.reduce((s, g) => s + (Number(g.monto) || 0), 0);
  const totalPresupuesto = Object.values(presupuestos).reduce((s, p) => s + (Number(p.montoMensual) || 0), 0);

  const gastosPorCategoria = CATEGORIAS_GASTO.map(cat => {
    const total = gastosMes.filter(g => g.categoria === cat.id).reduce((s, g) => s + (Number(g.monto) || 0), 0);
    const presup = Number(presupuestos[cat.id]?.montoMensual) || 0;
    return { ...cat, total, presup };
  }).filter(c => c.total > 0 || c.presup > 0);

  return (
    <div>
      <PanelHeader title="Gastos & Mantenimiento" subtitle="Control de egresos operativos" icon="ri-shopping-bag-3-line">
        <button className="btn btn-secondary btn-sm" onClick={() => setShowCalendario(true)}><i className="ri-calendar-2-line" /> Calendario</button>
        <button className="btn btn-secondary btn-sm" onClick={() => setShowPresupModal(true)}><i className="ri-pie-chart-2-line" /> Presupuestos</button>
        <button className="btn btn-primary btn-sm" onClick={() => setShowModal(true)}><i className="ri-add-line" /> Nuevo Gasto</button>
      </PanelHeader>

      {/* Stats */}
      <div className="stat-grid" style={{ marginBottom: 20 }}>
        <StatCard icon="ri-money-dollar-box-line" label="Gasto del Mes" value={fmt(totalMes)} color="var(--danger)" iconBg="rgba(239,68,68,0.1)" />
        <StatCard icon="ri-pie-chart-2-line" label="Presupuesto" value={fmt(totalPresupuesto)} color="var(--info)" iconBg="rgba(59,130,246,0.1)" />
        <StatCard icon="ri-arrow-up-circle-line" label="Disponible" value={fmt(Math.max(0, totalPresupuesto - totalMes))} color="var(--success)" iconBg="rgba(34,197,94,0.1)" />
        <StatCard icon="ri-receipt-line" label="Transacciones" value={gastosMes.length} />
      </div>

      {/* Resumen por categoría */}
      {gastosPorCategoria.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 12, marginBottom: 20 }}>
          {gastosPorCategoria.map(cat => (
            <div key={cat.id} style={{ background: 'var(--bg-card)', border: `1px solid ${cat.color}30`, borderRadius: 12, padding: 14, cursor: 'pointer', transition: 'border-color 0.15s' }}
              onClick={() => setFiltroCategoria(filtroCategoria === cat.id ? '' : cat.id)}
              style={{ background: filtroCategoria === cat.id ? `${cat.color}10` : 'var(--bg-card)', border: `1px solid ${filtroCategoria === cat.id ? cat.color : cat.color + '30'}`, borderRadius: 12, padding: 14, cursor: 'pointer', transition: 'all 0.15s' }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 18 }}>{cat.icon}</span>
                  <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>{cat.label}</span>
                </div>
                <span style={{ fontSize: 13, fontWeight: 700, color: cat.color }}>{fmt(cat.total)}</span>
              </div>
              {cat.presup > 0 && (
                <>
                  <ProgressBar value={cat.total} max={cat.presup} color={cat.color} />
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 6 }}>Presupuesto: {fmt(cat.presup)}</div>
                </>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Filtros */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
        <input className="form-input" type="month" value={filtroMes} onChange={e => setFiltroMes(e.target.value)} style={{ width: 160 }} />
        <select className="form-select" value={filtroCategoria} onChange={e => setFiltroCategoria(e.target.value)} style={{ width: 220 }}>
          <option value="">Todas las categorías</option>
          {CATEGORIAS_GASTO.map(c => <option key={c.id} value={c.id}>{c.icon} {c.label}</option>)}
        </select>
      </div>

      {/* Tabla de gastos */}
      <div className="table-wrapper">
        <table>
          <thead>
            <tr>
              <th>Categoría</th>
              <th>Descripción</th>
              <th>Proveedor</th>
              <th>Fecha</th>
              <th>Recurrente</th>
              <th style={{ textAlign: 'right' }}>Monto</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {gastosFiltrados.length === 0 ? (
              <tr><td colSpan={7} style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
                <i className="ri-receipt-line" style={{ fontSize: 32, display: 'block', marginBottom: 8 }} />
                Sin gastos registrados para este período
              </td></tr>
            ) : gastosFiltrados.map(gasto => {
              const cat = CATEGORIAS_GASTO.find(c => c.id === gasto.categoria);
              return (
                <tr key={gasto.id}>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 16 }}>{cat?.icon || '📋'}</span>
                      <span style={{ fontSize: 12, color: cat?.color || 'var(--text-secondary)' }}>{cat?.label || gasto.categoria}</span>
                    </div>
                  </td>
                  <td>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{gasto.descripcion}</div>
                    {gasto.subcategoria && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{gasto.subcategoria}</div>}
                  </td>
                  <td style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{gasto.proveedor || '—'}</td>
                  <td style={{ fontSize: 12 }}>{gasto.fecha}</td>
                  <td>{gasto.recurrente ? <Badge color="var(--info)"><i className="ri-repeat-line" /> {gasto.frecuencia}</Badge> : '—'}</td>
                  <td style={{ textAlign: 'right', fontWeight: 700, color: 'var(--danger)', fontSize: 14 }}>{fmt(gasto.monto)}</td>
                  <td><button className="btn btn-danger btn-sm btn-icon" onClick={() => eliminarGasto(gasto.id)}><i className="ri-delete-bin-line" /></button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Modal Nuevo Gasto */}
      {showModal && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setShowModal(false)}>
          <div className="modal" style={{ maxWidth: 580 }}>
            <div className="modal-header">
              <span className="modal-title">Registrar Gasto</span>
              <button onClick={() => setShowModal(false)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 20, cursor: 'pointer' }}><i className="ri-close-line" /></button>
            </div>
            <div className="modal-body">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <div className="form-group" style={{ gridColumn: '1/-1' }}>
                  <label className="form-label">Categoría</label>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
                    {CATEGORIAS_GASTO.map(cat => (
                      <button key={cat.id} onClick={() => setForm(p => ({ ...p, categoria: cat.id }))}
                        style={{ padding: '10px 8px', borderRadius: 10, border: `1px solid ${form.categoria === cat.id ? cat.color : 'var(--border)'}`, background: form.categoria === cat.id ? `${cat.color}15` : 'var(--bg-elevated)', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, transition: 'all 0.15s' }}>
                        <span style={{ fontSize: 20 }}>{cat.icon}</span>
                        <span style={{ fontSize: 9, fontWeight: 700, color: form.categoria === cat.id ? cat.color : 'var(--text-muted)', textAlign: 'center', lineHeight: 1.2 }}>{cat.label}</span>
                      </button>
                    ))}
                  </div>
                </div>
                <div className="form-group" style={{ gridColumn: '1/-1' }}>
                  <label className="form-label">Descripción *</label>
                  <input className="form-input" value={form.descripcion} onChange={e => setForm(p => ({ ...p, descripcion: e.target.value }))} placeholder="Ej: Cambio de paño Mesa 3" />
                </div>
                <div className="form-group">
                  <label className="form-label">Subcategoría</label>
                  <input className="form-input" value={form.subcategoria} onChange={e => setForm(p => ({ ...p, subcategoria: e.target.value }))} placeholder="Opcional" />
                </div>
                <div className="form-group">
                  <label className="form-label">Monto *</label>
                  <input className="form-input" type="number" value={form.monto} onChange={e => setForm(p => ({ ...p, monto: e.target.value }))} placeholder="0.00" />
                </div>
                <div className="form-group">
                  <label className="form-label">Fecha</label>
                  <input className="form-input" type="date" value={form.fecha} onChange={e => setForm(p => ({ ...p, fecha: e.target.value }))} />
                </div>
                <div className="form-group">
                  <label className="form-label">Proveedor / Responsable</label>
                  <input className="form-input" value={form.proveedor} onChange={e => setForm(p => ({ ...p, proveedor: e.target.value }))} placeholder="Nombre del proveedor" />
                </div>
                <div className="form-group" style={{ gridColumn: '1/-1' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
                    <input type="checkbox" checked={form.recurrente} onChange={e => setForm(p => ({ ...p, recurrente: e.target.checked }))} style={{ width: 16, height: 16, accentColor: 'var(--bronze)' }} />
                    <span className="form-label" style={{ margin: 0 }}>Gasto Recurrente</span>
                  </label>
                  {form.recurrente && (
                    <select className="form-select" value={form.frecuencia} onChange={e => setForm(p => ({ ...p, frecuencia: e.target.value }))} style={{ marginTop: 8 }}>
                      <option value="semanal">Semanal</option>
                      <option value="mensual">Mensual</option>
                      <option value="trimestral">Trimestral</option>
                      <option value="semestral">Semestral</option>
                      <option value="anual">Anual</option>
                    </select>
                  )}
                </div>
                <div className="form-group" style={{ gridColumn: '1/-1' }}>
                  <label className="form-label">Notas</label>
                  <textarea className="form-input" rows={2} value={form.notas} onChange={e => setForm(p => ({ ...p, notas: e.target.value }))} style={{ resize: 'vertical' }} />
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowModal(false)}>Cancelar</button>
              <button className="btn btn-primary" onClick={guardarGasto}><i className="ri-save-line" /> Guardar Gasto</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Presupuestos */}
      {showPresupModal && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setShowPresupModal(false)}>
          <div className="modal" style={{ maxWidth: 500 }}>
            <div className="modal-header">
              <span className="modal-title">Presupuestos Mensuales</span>
              <button onClick={() => setShowPresupModal(false)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 20, cursor: 'pointer' }}><i className="ri-close-line" /></button>
            </div>
            <div className="modal-body">
              <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 16 }}>Define el presupuesto mensual máximo por categoría. Se mostrará una alerta cuando se supere.</p>
              {CATEGORIAS_GASTO.map(cat => (
                <div key={cat.id} style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                  <span style={{ fontSize: 20, width: 28, textAlign: 'center', flexShrink: 0 }}>{cat.icon}</span>
                  <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', flex: 1 }}>{cat.label}</span>
                  <input className="form-input" type="number" value={presupForm[cat.id] || ''} onChange={e => setPresupForm(p => ({ ...p, [cat.id]: e.target.value }))} placeholder="$0.00" style={{ width: 120 }} />
                </div>
              ))}
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowPresupModal(false)}>Cancelar</button>
              <button className="btn btn-primary" onClick={guardarPresupuestos}><i className="ri-save-line" /> Guardar Presupuestos</button>
            </div>
          </div>
        </div>
      )}

      {/* MEJORA 3 — Modal Calendario Predictivo de Gastos Recurrentes */}
      {showCalendario && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setShowCalendario(false)}>
          <div className="modal" style={{ maxWidth: 680 }}>
            <div className="modal-header">
              <span className="modal-title">📅 Calendario Predictivo de Gastos</span>
              <button onClick={() => setShowCalendario(false)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 20, cursor: 'pointer' }}><i className="ri-close-line" /></button>
            </div>
            <div className="modal-body">
              {/* Generamos proyección de 3 meses */}
              {(() => {
                const recurrentes = gastos.filter(g => g.recurrente);
                if (recurrentes.length === 0) return (
                  <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
                    <i className="ri-calendar-line" style={{ fontSize: 40, display: 'block', marginBottom: 12 }} />
                    <p>No hay gastos recurrentes registrados.</p>
                    <p style={{ fontSize: 12, marginTop: 8 }}>Al registrar un gasto, activa la opción "Gasto Recurrente" para verlo aquí.</p>
                  </div>
                );

                // Proyectar para los próximos 3 meses
                const meses = [];
                for (let m = 0; m < 3; m++) {
                  const d = new Date();
                  d.setMonth(d.getMonth() + m);
                  meses.push({ label: d.toLocaleDateString('es-MX', { month: 'long', year: 'numeric' }), mes: d.getMonth(), anio: d.getFullYear() });
                }

                const frecuenciaMeses = { semanal: 0.25, mensual: 1, trimestral: 3, semestral: 6, anual: 12 };

                return (
                  <div>
                    <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 20 }}>
                      Proyección de <strong style={{ color: 'var(--bronze-light)' }}>{recurrentes.length} gastos recurrentes</strong> para los próximos 3 meses.
                    </p>

                    {meses.map((mes, mi) => {
                      // Filtrar gastos que aplican en este mes según frecuencia
                      const aplicables = recurrentes.filter(g => {
                        const freq = g.frecuencia || 'mensual';
                        const mesesCiclo = frecuenciaMeses[freq] || 1;
                        if (mesesCiclo <= 1) return true; // mensual o semanal siempre aplica
                        // Trimestral/semestral/anual: calcular si toca este mes
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
                            <div style={{ fontFamily: 'var(--font-display)', fontSize: 14, fontWeight: 700, textTransform: 'capitalize', color: mi === 0 ? 'var(--bronze-light)' : 'var(--text-primary)' }}>
                              {mi === 0 ? '📍 ' : ''}{mes.label}
                            </div>
                            <div style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 800, color: 'var(--danger)' }}>{fmt(totalMes)}</div>
                          </div>
                          {aplicables.length === 0 ? (
                            <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '8px 12px', background: 'var(--bg-elevated)', borderRadius: 8 }}>Sin gastos recurrentes este mes</div>
                          ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                              {aplicables.map((g, gi) => {
                                const cat = CATEGORIAS_GASTO.find(c => c.id === g.categoria);
                                const veces = g.frecuencia === 'semanal' ? 4 : 1;
                                const montoTotal = Number(g.monto) * veces;
                                // Calcular día estimado de pago
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
                                    {/* Indicador de urgencia */}
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

                    {/* Resumen total proyectado */}
                    <div style={{ background: 'var(--bronze-subtle)', border: '1px solid var(--border-bronze)', borderRadius: 12, padding: 14, marginTop: 8 }}>
                      <div style={{ fontSize: 11, color: 'var(--bronze-light)', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 700, marginBottom: 8 }}>
                        <i className="ri-funds-line" /> Proyección Total 3 Meses
                      </div>
                      <div style={{ fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 800, color: 'var(--bronze-light)' }}>
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
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>Basado en {recurrentes.length} gastos recurrentes registrados</div>
                    </div>
                  </div>
                );
              })()}
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowCalendario(false)}>Cerrar</button>
              <button className="btn btn-primary" onClick={() => { setShowModal(true); setShowCalendario(false); }}>
                <i className="ri-add-line" /> Agregar Gasto Recurrente
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// TAB 5 — IA & REPORTES
// ─────────────────────────────────────────────
function IAReportesTab({ showToast }) {
  const [empleados, setEmpleados] = useState([]);
  const [gastos, setGastos] = useState([]);
  const [pagos, setPagos] = useState([]);
  const [asistencias, setAsistencias] = useState([]);
  const [insights, setInsights] = useState([]);
  const [loadingIA, setLoadingIA] = useState(false);
  const [activeInsight, setActiveInsight] = useState(null);

  useEffect(() => {
    const unsubs = [
      onSnapshot(query(collection(db, 'nomina_empleados')), s => setEmpleados(s.docs.map(d => ({ id: d.id, ...d.data() })))),
      onSnapshot(query(collection(db, 'gastos'), orderBy('fecha', 'desc')), s => setGastos(s.docs.map(d => ({ id: d.id, ...d.data() })))),
      onSnapshot(query(collection(db, 'nomina_pagos'), orderBy('fecha', 'desc')), s => setPagos(s.docs.map(d => ({ id: d.id, ...d.data() })))),
      onSnapshot(query(collection(db, 'nomina_asistencia')), s => setAsistencias(s.docs.map(d => d.data()))),
    ];
    return () => unsubs.forEach(u => u());
  }, []);



  const mesActual = new Date().toISOString().slice(0, 7);
  const mesAnterior = (() => { const d = new Date(); d.setMonth(d.getMonth() - 1); return d.toISOString().slice(0, 7); })();

  const gastosMes = gastos.filter(g => g.fecha?.startsWith(mesActual));
  const gastosAnterior = gastos.filter(g => g.fecha?.startsWith(mesAnterior));
  const totalGastosMes = gastosMes.reduce((s, g) => s + (Number(g.monto) || 0), 0);
  const totalGastosAnterior = gastosAnterior.reduce((s, g) => s + (Number(g.monto) || 0), 0);
  const totalNomina = pagos.filter(p => p.fecha?.startsWith(mesActual)).reduce((s, p) => s + (Number(p.total) || 0), 0);

  const generarInsights = useCallback(() => {
    setLoadingIA(true);
    const nuevosInsights = [];

    // 1. Análisis de gastos vs mes anterior
    if (totalGastosAnterior > 0) {
      const variacion = ((totalGastosMes - totalGastosAnterior) / totalGastosAnterior) * 100;
      if (Math.abs(variacion) >= 10) {
        nuevosInsights.push({
          id: 'var_gastos',
          tipo: variacion > 0 ? 'alerta' : 'positivo',
          titulo: variacion > 0 ? `⚠️ Gastos aumentaron ${variacion.toFixed(0)}%` : `✅ Gastos redujeron ${Math.abs(variacion).toFixed(0)}%`,
          descripcion: `Mes actual: ${fmt(totalGastosMes)} vs mes anterior: ${fmt(totalGastosAnterior)}.${variacion > 0 ? ' Revisa los gastos por categoría para identificar el origen.' : ' ¡Excelente gestión de costos!'}`,
          accion: 'Ver detalle de gastos',
          prioridad: variacion > 30 ? 'alta' : 'media',
        });
      }
    }

    // 2. Empleados con alta ausencia
    const mesActualStr = new Date().toISOString().slice(0, 7);
    empleados.filter(e => e.estado === 'activo').forEach(emp => {
      const ausencias = asistencias.filter(a => a.empleadoId === emp.id && a.estado === 'ausente' && a.fecha?.startsWith(mesActualStr)).length;
      if (ausencias >= 3) {
        nuevosInsights.push({
          id: `ausencia_${emp.id}`,
          tipo: 'alerta',
          titulo: `⚠️ Alta ausencia: ${emp.nombre} ${emp.apellido}`,
          descripcion: `${ausencias} ausencias este mes. Considera una revisión de su situación laboral.`,
          accion: 'Ver historial de asistencia',
          prioridad: ausencias >= 5 ? 'alta' : 'media',
        });
      }
    });

    // 3. Gastos por categoría anómalos
    const categorias = [...new Set(gastos.map(g => g.categoria))];
    categorias.forEach(cat => {
      const gastosAnteriorCat = gastosAnterior.filter(g => g.categoria === cat).reduce((s, g) => s + (Number(g.monto) || 0), 0);
      const gastosMesCat = gastosMes.filter(g => g.categoria === cat).reduce((s, g) => s + (Number(g.monto) || 0), 0);
      if (gastosAnteriorCat > 0 && gastosMesCat > gastosAnteriorCat * 1.5) {
        const catInfo = CATEGORIAS_GASTO.find(c => c.id === cat);
        nuevosInsights.push({
          id: `anomalia_${cat}`,
          tipo: 'anomalia',
          titulo: `🔍 Anomalía detectada: ${catInfo?.label || cat}`,
          descripcion: `Gasto ${((gastosMesCat / gastosAnteriorCat - 1) * 100).toFixed(0)}% mayor al mes anterior (${fmt(gastosMesCat)} vs ${fmt(gastosAnteriorCat)})`,
          accion: 'Revisar gastos',
          prioridad: 'alta',
        });
      }
    });

    // 4. Predicción de gastos próximo mes
    if (totalGastosMes > 0 && totalGastosAnterior > 0) {
      const promedio = (totalGastosMes + totalGastosAnterior) / 2;
      const tendencia = totalGastosMes > totalGastosAnterior ? 1.05 : 0.97;
      const prediccion = promedio * tendencia;
      nuevosInsights.push({
        id: 'prediccion',
        tipo: 'prediccion',
        titulo: `📈 Predicción: Próximo mes ~${fmt(prediccion)}`,
        descripcion: `Basado en el historial de los últimos 2 meses. ${tendencia > 1 ? 'Tendencia al alza, considera revisar presupuestos.' : 'Tendencia estable o a la baja.'}`,
        accion: 'Ver análisis completo',
        prioridad: 'baja',
      });
    }

    // 5. Optimización de turnos (si hay suficientes datos)
    if (asistencias.length > 20) {
      nuevosInsights.push({
        id: 'optimizacion',
        tipo: 'sugerencia',
        titulo: `🗓️ Sugerencia de Turnos`,
        descripcion: `Con los datos de asistencia actuales, puedes optimizar la distribución de turnos para reducir costos en días de menor actividad.`,
        accion: 'Ver sugerencias',
        prioridad: 'baja',
      });
    }

    // 6. Ratio nómina/ingresos (placeholder - integrar con datos reales)
    if (totalNomina > 0) {
      nuevosInsights.push({
        id: 'ratio_nomina',
        tipo: 'info',
        titulo: `💡 Nómina del mes: ${fmt(totalNomina)}`,
        descripcion: `La nómina representa el costo de personal este mes. Integra con módulo de Caja para calcular el ratio % de ingresos.`,
        accion: 'Ver detalles',
        prioridad: 'baja',
      });
    }

    // Si no hay suficientes datos
    if (nuevosInsights.length === 0) {
      nuevosInsights.push({
        id: 'sin_datos',
        tipo: 'info',
        titulo: '🤖 Motor IA listo',
        descripcion: 'Registra empleados, asistencia y gastos para comenzar a recibir análisis e insights automáticos.',
        accion: null,
        prioridad: 'baja',
      });
    }

    setInsights(nuevosInsights.sort((a, b) => ({ alta: 0, media: 1, baja: 2 }[a.prioridad] - { alta: 0, media: 1, baja: 2 }[b.prioridad])));
    setLoadingIA(false);
  }, [empleados, gastos, pagos, asistencias, totalGastosMes, totalGastosAnterior, totalNomina]);

  useEffect(() => {
    if (empleados.length || gastos.length) generarInsights();
  }, [empleados, gastos, pagos, asistencias, generarInsights]);

  const insightColors = {
    alerta:    { color: '#f59e0b', bg: 'rgba(245,158,11,0.1)',  border: 'rgba(245,158,11,0.3)'  },
    anomalia:  { color: '#ef4444', bg: 'rgba(239,68,68,0.1)',   border: 'rgba(239,68,68,0.3)'   },
    prediccion:{ color: '#3b82f6', bg: 'rgba(59,130,246,0.1)',  border: 'rgba(59,130,246,0.3)'  },
    sugerencia:{ color: '#cd7f32', bg: 'rgba(205,127,50,0.1)',  border: 'rgba(205,127,50,0.3)'  },
    positivo:  { color: '#22c55e', bg: 'rgba(34,197,94,0.1)',   border: 'rgba(34,197,94,0.3)'   },
    info:      { color: '#b0b8c8', bg: 'rgba(176,184,200,0.08)' ,border: 'rgba(176,184,200,0.2)' },
  };

  // Datos para reporte
  const rentabilidadEmpleados = empleados.filter(e => e.estado === 'activo').map(emp => {
    const pagoEmp = pagos.filter(p => p.empleadoId === emp.id && p.fecha?.startsWith(mesActual)).reduce((s, p) => s + (p.total || 0), 0);
    const asistEmp = asistencias.filter(a => a.empleadoId === emp.id && a.fecha?.startsWith(mesActual));
    const presentes = asistEmp.filter(a => a.estado === 'presente').length;
    return { ...emp, costoMes: pagoEmp, diasTrabajados: presentes };
  }).sort((a, b) => b.costoMes - a.costoMes);

  const gastosBarras = CATEGORIAS_GASTO.map(cat => ({
    ...cat,
    total: gastosMes.filter(g => g.categoria === cat.id).reduce((s, g) => s + (Number(g.monto) || 0), 0),
  })).filter(c => c.total > 0).sort((a, b) => b.total - a.total);

  const maxGasto = Math.max(...gastosBarras.map(c => c.total), 1);

  return (
    <div>
      <PanelHeader title="IA & Reportes" subtitle="Análisis inteligente y generación de reportes" icon="ri-robot-2-line">
        <button className="btn btn-secondary btn-sm" onClick={generarInsights} disabled={loadingIA}>
          <i className={`ri-refresh-line ${loadingIA ? 'spin' : ''}`} /> {loadingIA ? 'Analizando...' : 'Actualizar IA'}
        </button>
        <button className="btn btn-primary btn-sm" onClick={() => window.print()}>
          <i className="ri-file-pdf-line" /> Exportar PDF
        </button>
      </PanelHeader>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 24 }}>
        {/* Insights IA */}
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.12em', color: 'var(--bronze-light)', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
            <i className="ri-robot-2-line" /> Motor de Análisis IA
            {loadingIA && <span style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 400 }}>Procesando...</span>}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {insights.map(ins => {
              const style = insightColors[ins.tipo] || insightColors.info;
              return (
                <div key={ins.id} style={{ background: style.bg, border: `1px solid ${style.border}`, borderRadius: 12, padding: 14, cursor: ins.accion ? 'pointer' : 'default', transition: 'all 0.15s' }}
                  onClick={() => ins.accion && setActiveInsight(activeInsight === ins.id ? null : ins.id)}
                  onMouseEnter={e => { if (ins.accion) e.currentTarget.style.transform = 'translateX(4px)'; }}
                  onMouseLeave={e => e.currentTarget.style.transform = 'translateX(0)'}
                >
                  <div style={{ fontWeight: 700, fontSize: 13, color: style.color, marginBottom: 4 }}>{ins.titulo}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5 }}>{ins.descripcion}</div>
                  {ins.prioridad === 'alta' && <Badge color={style.color} style={{ marginTop: 8, display: 'inline-flex' }}>🔴 Alta Prioridad</Badge>}
                </div>
              );
            })}
          </div>
        </div>

        {/* Gráfica de Gastos por Categoría */}
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.12em', color: 'var(--bronze-light)', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
            <i className="ri-bar-chart-2-line" /> Gastos por Categoría (Mes Actual)
          </div>
          {gastosBarras.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)', background: 'var(--bg-card)', borderRadius: 12, border: '1px solid var(--border)' }}>
              <i className="ri-bar-chart-line" style={{ fontSize: 32, display: 'block', marginBottom: 8 }} />
              Sin datos de gastos este mes
            </div>
          ) : (
            <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, padding: 16 }}>
              {gastosBarras.map(cat => (
                <div key={cat.id} style={{ marginBottom: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 14 }}>{cat.icon}</span>
                      <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{cat.label}</span>
                    </div>
                    <span style={{ fontSize: 13, fontWeight: 700, color: cat.color }}>{fmt(cat.total)}</span>
                  </div>
                  <div style={{ height: 8, background: 'var(--bg-elevated)', borderRadius: 999, overflow: 'hidden' }}>
                    <div style={{ width: `${(cat.total / maxGasto) * 100}%`, height: '100%', background: cat.color, borderRadius: 999, transition: 'width 0.6s ease', boxShadow: `0 0 8px ${cat.color}60` }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Rentabilidad por Empleado */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.12em', color: 'var(--bronze-light)', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
          <i className="ri-trophy-line" /> Análisis de Personal — {mesActual}
        </div>
        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Empleado</th>
                <th>Departamento</th>
                <th>Días Trabajados</th>
                <th>Costo del Mes</th>
                <th>Asistencia %</th>
              </tr>
            </thead>
            <tbody>
              {rentabilidadEmpleados.length === 0 ? (
                <tr><td colSpan={5} style={{ textAlign: 'center', padding: 30, color: 'var(--text-muted)' }}>Sin datos de empleados activos</td></tr>
              ) : rentabilidadEmpleados.map(emp => {
                const pctAsistencia = emp.diasTrabajados > 0 ? Math.min(100, Math.round((emp.diasTrabajados / 22) * 100)) : 0;
                return (
                  <tr key={emp.id}>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{ width: 32, height: 32, borderRadius: 8, background: 'var(--bronze-subtle)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 800, color: 'var(--bronze-light)' }}>
                          {(emp.nombre?.[0] || '') + (emp.apellido?.[0] || '')}
                        </div>
                        <div>
                          <div style={{ fontWeight: 600, fontSize: 13 }}>{emp.nombre} {emp.apellido}</div>
                          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{emp.rol}</div>
                        </div>
                      </div>
                    </td>
                    <td>{emp.departamento}</td>
                    <td style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 700 }}>{emp.diasTrabajados}</td>
                    <td style={{ fontWeight: 700, color: 'var(--danger)' }}>{fmt(emp.costoMes)}</td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{ flex: 1, height: 6, background: 'var(--bg-elevated)', borderRadius: 999 }}>
                          <div style={{ width: `${pctAsistencia}%`, height: '100%', background: pctAsistencia >= 80 ? 'var(--success)' : pctAsistencia >= 60 ? 'var(--warning)' : 'var(--danger)', borderRadius: 999 }} />
                        </div>
                        <span style={{ fontSize: 11, fontWeight: 700, minWidth: 36 }}>{pctAsistencia}%</span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Resumen financiero */}
      <div className="stat-grid">
        <StatCard icon="ri-money-dollar-box-line" label="Gastos del Mes" value={fmt(totalGastosMes)} color="var(--danger)" iconBg="rgba(239,68,68,0.1)" sub={totalGastosAnterior > 0 ? `vs ${fmt(totalGastosAnterior)} mes anterior` : ''} />
        <StatCard icon="ri-group-line" label="Nómina del Mes" value={fmt(totalNomina)} color="var(--warning)" iconBg="rgba(245,158,11,0.1)" />
        <StatCard icon="ri-add-circle-line" label="Total Egresos" value={fmt(totalGastosMes + totalNomina)} color="var(--bronze-light)" />
        <StatCard icon="ri-user-star-line" label="Empleados Activos" value={empleados.filter(e => e.estado === 'activo').length} />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// PANEL PRINCIPAL
// ─────────────────────────────────────────────
export default function NominaPanel({ showToast }) {
  const [activeTab, setActiveTab] = useState('empleados');

  return (
    <div>
      {/* Header del Panel */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 }}>
          <div style={{ width: 48, height: 48, borderRadius: 14, background: 'linear-gradient(135deg, var(--bronze-subtle), rgba(205,127,50,0.15))', border: '1px solid var(--border-bronze)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, color: 'var(--bronze-light)' }}>
            💼
          </div>
          <div>
            <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', background: 'linear-gradient(135deg, var(--bronze-light), var(--silver))', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text', lineHeight: 1 }}>
              Nómina & Gastos
            </h1>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>Gestión de personal, nómina, gastos y mantenimiento · Motor IA integrado</p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 28, background: 'var(--bg-card)', borderRadius: 14, padding: 6, border: '1px solid var(--border)', flexWrap: 'wrap' }}>
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              display: 'flex', alignItems: 'center', gap: 8, padding: '9px 18px', borderRadius: 10,
              border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600, transition: 'all 0.2s',
              background: activeTab === tab.id ? 'linear-gradient(135deg, var(--bronze), var(--bronze-light))' : 'transparent',
              color: activeTab === tab.id ? '#0d0d0f' : 'var(--text-secondary)',
              boxShadow: activeTab === tab.id ? '0 2px 12px var(--bronze-glow)' : 'none',
            }}
            onMouseEnter={e => { if (activeTab !== tab.id) e.currentTarget.style.background = 'var(--bg-elevated)'; }}
            onMouseLeave={e => { if (activeTab !== tab.id) e.currentTarget.style.background = 'transparent'; }}
          >
            <i className={tab.icon} />
            {tab.label}
            {tab.id === 'ia' && <span style={{ fontSize: 9, background: 'rgba(205,127,50,0.3)', color: 'var(--bronze-light)', padding: '1px 5px', borderRadius: 999, fontWeight: 800 }}>IA</span>}
          </button>
        ))}
      </div>

      {/* Contenido del Tab Activo */}
      {activeTab === 'empleados'  && <EmpleadosTab  showToast={showToast} />}
      {activeTab === 'asistencia' && <AsistenciaTab showToast={showToast} />}
      {activeTab === 'nomina'     && <NominaTab     showToast={showToast} />}
      {activeTab === 'gastos'     && <GastosTab     showToast={showToast} />}
      {activeTab === 'ia'         && <IAReportesTab showToast={showToast} />}
    </div>
  );
}

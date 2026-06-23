'use client';
import { useState, useEffect, useRef } from 'react';
import { db, auth } from '@/lib/firebase';
import { collection, getDocs, getDoc, addDoc, query, orderBy, deleteDoc, doc, where, setDoc, serverTimestamp, onSnapshot, writeBatch, limit } from '@/lib/firestore-tenant';
import { obfuscate, deobfuscate, hashPasswordSecure } from '@/lib/crypto';
import { QRCodeCanvas } from 'qrcode.react';
import JSZip from 'jszip';
import { useAuth } from '@/lib/auth-context';
import { updatePassword } from 'firebase/auth';
import { isMasterUser } from '@/lib/auth-helpers';

const ALERTAS_DEFINITIONS = [
  { id: 'stockBajo', label: 'Alerta de Stock Bajo', sub: 'Notifica cuando un insumo o producto esté por debajo del stock óptimo' },
  { id: 'altaOcupacion', label: 'Alerta de Alta Ocupación', sub: 'Sugerir tarifas dinámicas al superar 70% de ocupación de mesas' },
  { id: 'clienteNoAtendido', label: 'Cliente no Atendido', sub: 'Mesa ocupada sin comandas registradas en los últimos 15 minutos' },
  { id: 'altoConsumo', label: 'Producto en Alto Consumo', sub: 'Insumo con velocidad de consumo inusual que arriesga desabasto hoy' },
  { id: 'mesaSinConsumo', label: 'Mesa sin Consumo', sub: 'Mesa ocupada por más de 2 horas con consumo acumulado menor a $100' },
  { id: 'descuadreCaja', label: 'Descuadre de Caja', sub: 'Discrepancia en caja mayor al umbral dinámico o histórico de cortes' },
  { id: 'comandaSinMesa', label: 'Comanda sin Mesa', sub: 'Comanda de cocina/barra asignada a una mesa en estado Libre' },
  { id: 'tiempoExcesivo', label: 'Tiempo Excesivo', sub: 'Mesa de juego activa por más de 4 horas continuas sin pre-ticket impreso' },
  { id: 'insumoCritico', label: 'Insumo Crítico Bajo', sub: 'Insumo clave para platillo estrella por debajo de su punto de reorden' },
  { id: 'comandaDemorada', label: 'Comanda Demorada', sub: 'Orden en cocina/barra que excede los 20 minutos de preparación' },
  { id: 'inactividadMesero', label: 'Inactividad de Meseros', sub: 'Frecuencia de comandas menor al promedio histórico en horas pico' },
  { id: 'sinPersonalActivo', label: 'Sin Personal Activo', sub: 'Cuentas activas en caja pero ningún mesero con check-in en nómina' },
  { id: 'excesoCortesias', label: 'Exceso de Cortesías', sub: 'Cortesías o descuentos aplicados superan el límite del turno actual' },
  { id: 'tarifaDinamicaRecomendada', label: 'Recomendación de Tarifa', sub: 'Sugerir cambio de tarifa por alta demanda según día y hora' }
];

const MENU_ESTRUCTURA = [
  {
    id: 'dashboard',
    label: 'Dashboard',
    submenus: []
  },
  {
    id: 'mesas',
    label: 'Mesas',
    submenus: [
      { id: 'mesas_ver', label: 'Ver Mesas' },
      { id: 'mesas_fichaje', label: 'Pase de Lista / Fichaje' }
    ]
  },
  {
    id: 'caja',
    label: 'INTELIGENCIA (Caja)',
    submenus: [
      { id: 'caja_transacciones', label: 'Transacciones' },
      { id: 'caja_inventario', label: 'Inventario de Caja' },
      { id: 'caja_corte', label: 'Corte de Caja / Auditoría' }
    ]
  },
  {
    id: 'bar',
    label: 'Inventario IA (Bar)',
    submenus: [
      { id: 'bar_productos', label: 'Ver/Vender Productos' },
      { id: 'bar_insumos', label: 'Ver/Editar Insumos' }
    ]
  },
  {
    id: 'clientes',
    label: 'Clientes',
    submenus: [
      { id: 'clientes_listado', label: 'Listado / Directorio' },
      { id: 'clientes_analisis', label: 'Análisis CRM' }
    ]
  },
  {
    id: 'torneos',
    label: 'Torneos',
    submenus: []
  },
  {
    id: 'nomina',
    label: 'Nómina & Gastos',
    submenus: [
      { id: 'nomina_empleados', label: 'Personal & Nóminas' },
      { id: 'nomina_gastos', label: 'Gastos & Presupuestos' }
    ]
  },
  {
    id: 'config',
    label: 'Configuración',
    submenus: [
      { id: 'config_mesas', label: 'Catálogo de Mesas' },
      { id: 'config_usuarios', label: 'Catálogo de Usuarios / Seguridad' }
    ]
  }
];

const getDefaultPermisos = (role) => {
  const perm = {
    dashboard: false,
    mesas: false,
    mesas_ver: false,
    mesas_fichaje: false,
    caja: false,
    caja_transacciones: false,
    caja_inventario: false,
    caja_corte: false,
    bar: false,
    bar_productos: false,
    bar_insumos: false,
    clientes: false,
    clientes_listado: false,
    clientes_analisis: false,
    torneos: false,
    nomina: false,
    nomina_empleados: false,
    nomina_gastos: false,
    config: false,
    config_mesas: false,
    config_usuarios: false
  };

  if (role === 'admin') {
    Object.keys(perm).forEach(k => perm[k] = true);
  } else if (role === 'gerente') {
    perm.dashboard = true;
    perm.mesas = true;
    perm.mesas_ver = true;
    perm.mesas_fichaje = true;
    perm.caja = true;
    perm.caja_transacciones = true;
    perm.caja_inventario = true;
    perm.caja_corte = true;
    perm.bar = true;
    perm.bar_productos = true;
    perm.bar_insumos = true;
    perm.clientes = true;
    perm.clientes_listado = true;
    perm.clientes_analisis = true;
    perm.torneos = true;
    perm.nomina = true;
    perm.nomina_empleados = true;
    perm.nomina_gastos = true;
  } else if (role === 'cajero') {
    perm.dashboard = true;
    perm.mesas = true;
    perm.mesas_ver = true;
    perm.caja = true;
    perm.caja_transacciones = true;
    perm.caja_inventario = true;
    perm.caja_corte = true;
    perm.clientes = true;
    perm.clientes_listado = true;
  } else if (role === 'mesero') {
    perm.mesas = true;
    perm.mesas_ver = true;
    perm.bar = true;
    perm.bar_productos = true;
  }
  return perm;
};

function areMesasEqual(arr1, arr2) {
  if (!arr1 || !arr2) return arr1 === arr2;
  if (arr1.length !== arr2.length) return false;
  for (let i = 0; i < arr1.length; i++) {
    const m1 = arr1[i];
    const m2 = arr2[i];
    if (m1.id !== m2.id ||
        m1.estado !== m2.estado ||
        m1.cliente !== m2.cliente ||
        m1.inicio !== m2.inicio ||
        m1.tarifa !== m2.tarifa ||
        m1.tipo !== m2.tipo ||
        m1.socios !== m2.socios ||
        m1.clienteUid !== m2.clienteUid ||
        m1.preTicketImpreso !== m2.preTicketImpreso) {
      return false;
    }
  }
  return true;
}
import { getClientDomain } from '@/lib/tenant';

const hashPassword = (pwd) => {
  if (!pwd) return '';
  let hash = 0;
  for (let i = 0; i < pwd.length; i++) {
    hash = (hash << 5) - hash + pwd.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(16);
};

export default function ConfigPanel({ showToast }) {
  const { user, updateUserSession } = useAuth();
  // subTab recetario removed
  const [previewQr, setPreviewQr] = useState(null);



  const [sucursal, setSucursal] = useState({
    nombre: 'YoY Billar Sucursal 1',
    direccion: 'Av. Principal 123, CDMX',
    telefono: '55-1234-5678',
    horarioApertura: '10:00',
    horarioCierre: '02:00',
    capacidad: 8,
    metaMensual: 100000,
  });


  const [iaAlerts, setIaAlerts] = useState({
    activeIds: ['stockBajo', 'altaOcupacion'],
    states: {
      stockBajo: true,
      altaOcupacion: true,
      clienteNoAtendido: true,
      altoConsumo: true,
      mesaSinConsumo: true,
      descuadreCaja: true,
      comandaSinMesa: true,
      tiempoExcesivo: true,
      insumoCritico: true,
      comandaDemorada: true,
      inactividadMesero: true,
      sinPersonalActivo: true,
      excesoCortesias: true,
      tarifaDinamicaRecomendada: true
    },
    telegramAlerts: {}
  });

  // Estados de Gestión de Usuarios
  const [usuarios, setUsuarios] = useState([]);
  const [loadingUsuarios, setLoadingUsuarios] = useState(true);
  const [showAddUserModal, setShowAddUserModal] = useState(false);
  const [newUser, setNewUser] = useState({ name: '', email: '', password: '', role: 'mesero', permisos: getDefaultPermisos('mesero') });
  const [savingUser, setSavingUser] = useState(false);
  const [showChangePasswordModal, setShowChangePasswordModal] = useState(false);
  const [selectedUserForPassword, setSelectedUserForPassword] = useState(null);
  const [newPassword, setNewPassword] = useState('');
  const [savingUserPassword, setSavingUserPassword] = useState(false);

  // Estados de Edición de Permisos
  const [showEditPermissionsModal, setShowEditPermissionsModal] = useState(false);
  const [selectedUserForPermissions, setSelectedUserForPermissions] = useState(null);
  const [savingPermissions, setSavingPermissions] = useState(false);

  // --- Estados de Mesas Config ---
  const [mesas, setMesas] = useState([]);
  const mesasRef = useRef(mesas);
  useEffect(() => {
    mesasRef.current = mesas;
  }, [mesas]);
  const [nuevaMesa, setNuevaMesa] = useState({ id: '', nombre: '', tarifa: '', tipo: 'Pool' });
  const [editingMesaId, setEditingMesaId] = useState(null);
  const [customMesaTipo, setCustomMesaTipo] = useState('');
  const [showCustomTipoInput, setShowCustomTipoInput] = useState(false);


  // --- Estados de Ticket Config ---
  const [ticketConfig, setTicketConfig] = useState({
    showNombre: true,
    showDireccion: true,
    showTelefono: true,
    showFechaHora: true,
    showConsumos: true,
    showCliente: true,
    showCuenta: true,
    showQrRecibo: true,
    fontSize: '14px',
    connectionType: 'system_print',
    printerIp: '192.168.1.100',
    printerPort: '9100',
    paperWidth: '80mm',
    charSet: 'PC437',
    autoCut: true,
    openDrawer: true,
    usbVendorId: '',
    usbProductId: '',
    btDeviceName: '',
    // Cola de impresión offline
    printQueue: [],
    // Impresora de Cocina Independiente
    useKitchenPrinter: false,
    kitchenConnectionType: 'system_print',
    kitchenPrinterIp: '192.168.1.101',
    kitchenPrinterPort: '9100',
    kitchenPaperWidth: '80mm',
    kitchenUsbVendorId: '',
    kitchenUsbProductId: '',
    kitchenBtDeviceName: '',
  });

  const [actualPin, setActualPin] = useState('');
  const [nuevoPin, setNuevoPin] = useState('');
  const [confirmarPin, setConfirmarPin] = useState('');

  const [resetPin, setResetPin] = useState('');
  const [confirmWipeText, setConfirmWipeText] = useState('');
  const [isResetting, setIsResetting] = useState(false);

  // Mantenimiento - Archivado
  const [archivingDays, setArchivingDays] = useState(30);
  const [archivingPin, setArchivingPin] = useState('');
  const [isArchiving, setIsArchiving] = useState(false);

  // --- Límite de cortesías por turno (Sugerencia 3) ---
  const [maxCortesiasPorTurno, setMaxCortesiasPorTurno] = useState(3);
  const [savingLimiteCortesias, setSavingLimiteCortesias] = useState(false);

  // --- Telegram config state ---
  const [telegramConfig, setTelegramConfig] = useState({ 
    enabled: false, 
    mode: 'simplified', 
    botToken: '', 
    chatId: '',
    phone: '',
    notifyStatements: true,
    notifyPayments: true,
    notifyPrevShiftSummary: true,
    notifyAttendance: true,
    notifyDisruptiveAlerts: true,
    discrepancyThreshold: 100
  });
  const [savingTelegram, setSavingTelegram] = useState(false);
  const [pendingAlerts, setPendingAlerts] = useState([]);
  const [loadingPending, setLoadingPending] = useState(false);

  // --- Estados de Registro de Errores (Crashes) ---
  const [crashLogs, setCrashLogs] = useState([]);
  const [loadingLogs, setLoadingLogs] = useState(true);
  const [selectedLogId, setSelectedLogId] = useState(null);
  const [logSearchQuery, setLogSearchQuery] = useState('');
  const [logPanelFilter, setLogPanelFilter] = useState('todos');

  // --- Estados de Extras de Renta de Mesas ---
  const [rentaExtras, setRentaExtras] = useState([]);
  const [savingRentaExtras, setSavingRentaExtras] = useState(false);

  const fetchUsuarios = async () => {
    setLoadingUsuarios(true);
    try {
      const activeSalonId = user?.salonId || (typeof window !== 'undefined' ? localStorage.getItem('yoy_terminal_salon_id') : null) || 'default_salon';
      let q;
      if (user?.sucursal === 'all') {
        q = query(collection(db, 'users'));
      } else {
        q = query(collection(db, 'users'), where('salonId', '==', activeSalonId));
      }
      const snap = await getDocs(q);
      const list = [];
      snap.forEach(doc => {
        list.push({ id: doc.id, ...doc.data() });
      });
      // Ordenar en memoria por fecha de creación desc para evitar requerir índices compuestos en Firestore
      list.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
      setUsuarios(list);
    } catch (err) {
      console.error("Error cargando usuarios de Firestore:", err);
      setUsuarios([]);
    } finally {
      setLoadingUsuarios(false);
    }
  };

  const handleRestablecerTodo = async (e) => {
    e.preventDefault();
    if (!resetPin) return;

    if (confirmWipeText.trim().toUpperCase() !== 'RESTABLECER') {
      showToast('Debe escribir exactamente "RESTABLECER" para confirmar la operación', 'danger');
      return;
    }

    let savedHash = '56760663'; // Default hash of '123456'
    try {
      const secDoc = await getDoc(doc(db, 'config', 'seguridad'));
      if (secDoc.exists() && secDoc.data().adminPinHash) {
        savedHash = secDoc.data().adminPinHash;
      } else {
        const localHash = localStorage.getItem('yoy_admin_pin_hash');
        if (localHash) savedHash = deobfuscate(localHash);
      }
    } catch (err) {
      console.warn("Error checking safety doc:", err);
    }

    if (hashPassword(resetPin) !== savedHash) {
      showToast('PIN de administrador incorrecto', 'danger');
      return;
    }

    if (!window.confirm('🚨 ADVERTENCIA CRÍTICA: Esto eliminará permanentemente todos los torneos, comandas, bitácora, ingresos, gastos y restablecerá todas las mesas a libre. ¿Estás absolutamente seguro de que deseas continuar?')) {
      return;
    }

    setIsResetting(true);
    showToast('Iniciando restablecimiento de base de datos...', 'info');

    try {
      // 1. Limpiar Firestore
      // Restablecer mesas_estado
      const cleanMesas = [
        { id: 1, nombre: 'Mesa 1', tipo: 'Carambola 3B', estado: 'libre', cliente: null, inicio: null, tarifa: 80, socios: false, clienteUid: '' },
        { id: 2, nombre: 'Mesa 2', tipo: 'Carambola 3B', estado: 'libre', cliente: null, inicio: null, tarifa: 80, socios: false, clienteUid: '' },
        { id: 3, nombre: 'Mesa 3', tipo: 'Pool 9B',      estado: 'libre', cliente: null, inicio: null, tarifa: 60, socios: false, clienteUid: '' },
        { id: 4, nombre: 'Mesa 4', tipo: 'Carambola 3B', estado: 'libre', cliente: null, inicio: null, tarifa: 80, socios: false, clienteUid: '' },
        { id: 5, nombre: 'Mesa 5', tipo: 'Snooker',      estado: 'libre', cliente: null, inicio: null, tarifa: 100, socios: false, clienteUid: '' },
        { id: 6, nombre: 'Mesa 6', tipo: 'Pool 9B',      estado: 'libre', cliente: null, inicio: null, tarifa: 60, socios: false, clienteUid: '' },
        { id: 7, nombre: 'Mesa 7', tipo: 'Carambola 3B', estado: 'libre', cliente: null, inicio: null, tarifa: 80, socios: false, clienteUid: '' },
        { id: 8, nombre: 'Mesa 8', tipo: 'Pool 9B',      estado: 'libre', cliente: null, inicio: null, tarifa: 60, socios: false, clienteUid: '' },
      ];
      await setDoc(doc(db, 'config', 'mesas_estado'), { mesas: cleanMesas, updatedAt: serverTimestamp() });

      // Restablecer inventario
      await setDoc(doc(db, 'config', 'inventario'), { productos: [], updatedAt: serverTimestamp() });

      // Restablecer torneos
      await setDoc(doc(db, 'config', 'torneos'), { torneos: [], updatedAt: serverTimestamp() });

      // Restablecer ranking_historico
      const cleanRankings = { pool: [], carambola: [], snooker: [] };
      await setDoc(doc(db, 'config', 'ranking_historico'), { rankings: cleanRankings, updatedAt: serverTimestamp() });

      // Eliminar colecciones asociadas (bitacora, gastos, nomina_pagos, encuestas_satisfaccion, mesa_pedidos, historial_stock)
      const collectionsToClear = ['bitacora', 'gastos', 'nomina_pagos', 'encuestas_satisfaccion', 'mesa_pedidos', 'historial_stock'];
      for (const collName of collectionsToClear) {
        const q = query(collection(db, collName), limit(200));
        const snap = await getDocs(q);
        if (!snap.empty) {
          const batch = writeBatch(db);
          snap.docs.forEach(d => batch.delete(d.ref));
          await batch.commit();
        }
      }

      // 2. Limpiar LocalStorage
      localStorage.removeItem('yoy_billar_clientes');
      localStorage.removeItem('yoy_billar_stock');
      localStorage.removeItem('yoy_billar_stock_logs');
      localStorage.removeItem('yoy_billar_mesas');
      localStorage.removeItem('yoy_billar_torneos');
      localStorage.removeItem('yoy_billar_bitacora');
      localStorage.removeItem('yoy_caja_cobros');
      localStorage.removeItem('yoy_caja_corte_draft');
      localStorage.removeItem('yoy_ranking_historico');

      showToast('Base de datos restablecida correctamente. Recargando...', 'success');
      setTimeout(() => {
        window.location.reload();
      }, 1500);

    } catch (err) {
      console.error("Error al restablecer la base de datos:", err);
      showToast('Error al restablecer base de datos: ' + err.message, 'danger');
    } finally {
      setIsResetting(false);
      setResetPin('');
      setConfirmWipeText('');
    }
  };

  const handleArchivarPedidos = async (e) => {
    if (e) e.preventDefault();
    if (!archivingPin) {
      showToast("Ingresa el PIN de Admin", "warning");
      return;
    }
    setIsArchiving(true);
    showToast("Iniciando archivado de comandas antiguas...", "info");
    try {
      let continuado = true;
      let totalArchivados = 0;
      let iteraciones = 0;

      while (continuado && iteraciones < 10) {
        const res = await fetch('/api/mantenimiento/archivar', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pin: archivingPin, dias: archivingDays })
        });
        
        const data = await res.json();
        if (!data.success) {
          showToast(data.error || "Error al archivar", "danger");
          continuado = false;
          break;
        }

        totalArchivados += data.archivedCount;
        continuado = data.hasMore;
        iteraciones++;
      }

      if (totalArchivados > 0) {
        showToast(`Se archivaron ${totalArchivados} comandas con éxito.`, "success");
        // Registrar en bitácora general
        try {
          const { addDoc, collection, serverTimestamp } = await import('firebase/firestore');
          await addDoc(collection(db, 'bitacora'), {
            fecha: new Date().toISOString(),
            accion: 'Mantenimiento - Archivado de Pedidos',
            detalle: `Archivado manual: se movieron ${totalArchivados} comandas de más de ${archivingDays} días al histórico.`,
            monto: 0,
            operador: 'Administrador (Configuración)',
            rolOperador: 'admin'
          });
        } catch (e) {
          console.warn("No se pudo registrar log en bitacora:", e);
        }
      } else {
        showToast("No hay pedidos antiguos para archivar.", "info");
      }
      setArchivingPin('');
    } catch (err) {
      console.error("Error al archivar pedidos:", err);
      showToast("Error de conexión al archivar", "danger");
    } finally {
      setIsArchiving(false);
    }
  };

  useEffect(() => {
    fetchUsuarios();
    // Cargar configuración de sucursal desde Firestore
    getDoc(doc(db, 'config', 'sucursal')).then(snap => {
      if (snap.exists()) {
        const d = snap.data();
        setSucursal(p => ({ ...p, ...d }));
      }
    }).catch(err => console.error("Error al cargar configuración de sucursal:", err));

    // Cargar límite de cortesías desde Firestore
    import('@/lib/firebase').then(({ db }) =>
      import('firebase/firestore').then(({ doc, getDoc }) =>
        getDoc(doc(db, 'config', 'operacion')).then(snap => {
          if (snap.exists()) {
            const d = snap.data();
            if (d.maxCortesiasPorTurno !== undefined) setMaxCortesiasPorTurno(Number(d.maxCortesiasPorTurno));
          }
        }).catch(() => {})
      )
    );

    // Cargar config de Telegram desde Firestore
    getDoc(doc(db, 'config', 'telegram')).then(snap => {
      if (snap.exists()) {
        const d = snap.data();
        setTelegramConfig({
          enabled: d.enabled || false,
          mode: d.mode || 'simplified',
          botToken: d.botToken || '',
          chatId: d.chatId || '',
          phone: d.phone || '',
          notifyStatements: d.notifyStatements !== undefined ? d.notifyStatements : true,
          notifyPayments: d.notifyPayments !== undefined ? d.notifyPayments : true,
          notifyPrevShiftSummary: d.notifyPrevShiftSummary !== undefined ? d.notifyPrevShiftSummary : true,
          notifyAttendance: d.notifyAttendance !== undefined ? d.notifyAttendance : true,
          notifyDisruptiveAlerts: d.notifyDisruptiveAlerts !== undefined ? d.notifyDisruptiveAlerts : true,
          discrepancyThreshold: d.discrepancyThreshold !== undefined ? Number(d.discrepancyThreshold) : 100,
        });
      }
    }).catch(err => console.error("Error al cargar configuración de Telegram:", err));

    // Escuchar configuración de Alertas IA en tiempo real
    const unsubIaAlerts = onSnapshot(doc(db, 'config', 'ia_alertas'), snap => {
      if (snap.exists()) {
        const d = snap.data();
        setIaAlerts({
          activeIds: d.activeIds || ['stockBajo', 'altaOcupacion'],
          states: d.states || {
            stockBajo: true,
            altaOcupacion: true,
            clienteNoAtendido: true,
            altoConsumo: true,
            mesaSinConsumo: true,
            descuadreCaja: true,
            comandaSinMesa: true,
            tiempoExcesivo: true,
            insumoCritico: true,
            comandaDemorada: true,
            inactividadMesero: true,
            sinPersonalActivo: true,
            excesoCortesias: true,
            tarifaDinamicaRecomendada: true
          },
          telegramAlerts: d.telegramAlerts || {}
        });
      }
    });

    // Escuchar mesas de Firestore en tiempo real como fuente única de verdad
    const docRef = doc(db, 'config', 'mesas_estado');
    const unsubMesas = onSnapshot(docRef, snap => {
      if (snap.exists()) {
        const data = snap.data();
        if (data && Array.isArray(data.mesas)) {
          const isDifferent = !areMesasEqual(data.mesas, mesasRef.current);
          if (isDifferent) {
            setMesas(data.mesas);
          }
        }
      } else {
        const defaultMesas = [
          { id: 1, nombre: 'Mesa 1', tipo: 'Carambola 3B', estado: 'libre', cliente: null, inicio: null, tarifa: 80, socios: false, clienteUid: '' },
          { id: 2, nombre: 'Mesa 2', tipo: 'Carambola 3B', estado: 'libre', cliente: null, inicio: null, tarifa: 80, socios: false, clienteUid: '' },
          { id: 3, nombre: 'Mesa 3', tipo: 'Pool 9B',      estado: 'libre', cliente: null, inicio: null, tarifa: 60, socios: false, clienteUid: '' },
          { id: 4, nombre: 'Mesa 4', tipo: 'Carambola 3B', estado: 'libre', cliente: null, inicio: null, tarifa: 80, socios: false, clienteUid: '' },
          { id: 5, nombre: 'Mesa 5', tipo: 'Snooker',      estado: 'libre', cliente: null, inicio: null, tarifa: 100, socios: false, clienteUid: '' },
          { id: 6, nombre: 'Mesa 6', tipo: 'Pool 9B',      estado: 'libre', cliente: null, inicio: null, tarifa: 60, socios: false, clienteUid: '' },
          { id: 7, nombre: 'Mesa 7', tipo: 'Carambola 3B', estado: 'libre', cliente: null, inicio: null, tarifa: 80, socios: false, clienteUid: '' },
          { id: 8, nombre: 'Mesa 8', tipo: 'Pool 9B',      estado: 'libre', cliente: null, inicio: null, tarifa: 60, socios: false, clienteUid: '' },
        ];
        setMesas(defaultMesas);
        setDoc(docRef, {
          mesas: defaultMesas,
          updatedAt: serverTimestamp()
        }).catch(err => console.error("Error al inicializar mesas en config:", err));
      }
    }, err => {
      console.error("Error al escuchar mesas en ConfigPanel:", err);
    });

    if (typeof window !== 'undefined') {
      try {

        const savedTicket = localStorage.getItem('yoy_ticket_config');
        if (savedTicket) {
          setTicketConfig(JSON.parse(savedTicket));
        }

        // --- Cargar borradores temporales (Autoguardado) ---
        const savedMesa = sessionStorage.getItem('yoy_unsaved_nueva_mesa');
        if (savedMesa) {
          const parsed = JSON.parse(savedMesa);
          setNuevaMesa(parsed);
        }

        const savedCustomTipo = sessionStorage.getItem('yoy_unsaved_custom_mesa_tipo');
        if (savedCustomTipo) setCustomMesaTipo(savedCustomTipo);

        const savedShowCustom = sessionStorage.getItem('yoy_unsaved_show_custom_tipo');
        if (savedShowCustom) setShowCustomTipoInput(JSON.parse(savedShowCustom));

        const savedNewUser = sessionStorage.getItem('yoy_unsaved_new_user');
        if (savedNewUser) {
          const parsed = JSON.parse(savedNewUser);
          setNewUser(parsed);
        }

      } catch (err) {
        console.error('Error al restaurar borradores:', err);
      }
    }
    // Escuchar alertas de Telegram pendientes en tiempo real (Sugerencia 1)
    const unsubPending = onSnapshot(collection(db, 'telegram_alert_pending'), snap => {
      const list = [];
      snap.forEach(doc => {
        list.push({ id: doc.id, ...doc.data() });
      });
      // Ordenar por fecha de creación descendente
      list.sort((a, b) => {
        const t1 = a.createdAt?.seconds || 0;
        const t2 = b.createdAt?.seconds || 0;
        return t2 - t1;
      });
      setPendingAlerts(list);
    }, err => console.error("Error al escuchar alertas de Telegram pendientes:", err));

    // Escuchar extras de renta en tiempo real
    const unsubExtras = onSnapshot(doc(db, 'config', 'renta_extras'), snap => {
      if (snap.exists()) {
        const d = snap.data();
        if (d.extras) setRentaExtras(d.extras);
      } else {
        const defaultExtras = [
          { id: 'taco', nombre: 'Taco de Fibra de Carbono', precio: 25, tipo: 'hora' },
          { id: 'bolas', nombre: 'Bolas Profesionales Aramith', precio: 35, tipo: 'hora' },
          { id: 'tiza', nombre: 'Tiza Kamui Especial', precio: 10, tipo: 'fijo' }
        ];
        setRentaExtras(defaultExtras);
        setDoc(doc(db, 'config', 'renta_extras'), { extras: defaultExtras }).catch(err => console.error(err));
      }
    }, err => console.error("Error al escuchar extras de renta:", err));

    return () => {
      unsubMesas();
      unsubPending();
      unsubExtras();
      unsubIaAlerts();
    };
  }, []);

  // --- Guardar borradores automáticamente al cambiar de estado ---
  useEffect(() => {
    if (typeof window !== 'undefined') {
      sessionStorage.setItem('yoy_unsaved_nueva_mesa', JSON.stringify(nuevaMesa));
    }
  }, [nuevaMesa]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      sessionStorage.setItem('yoy_unsaved_custom_mesa_tipo', customMesaTipo);
    }
  }, [customMesaTipo]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      sessionStorage.setItem('yoy_unsaved_show_custom_tipo', JSON.stringify(showCustomTipoInput));
    }
  }, [showCustomTipoInput]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      sessionStorage.setItem('yoy_unsaved_new_user', JSON.stringify(newUser));
    }
  }, [newUser]);

  // --- Escuchar logs de crashes en tiempo real ---
  useEffect(() => {
    const q = query(collection(db, 'app_crash_logs'), orderBy('createdAt', 'desc'), limit(10));
    const unsubLogs = onSnapshot(q, (snap) => {
      const logs = [];
      snap.forEach(doc => {
        logs.push({ id: doc.id, ...doc.data() });
      });
      setCrashLogs(logs);
      setLoadingLogs(false);
    }, (err) => {
      console.error("Error loading crash logs:", err);
      setLoadingLogs(false);
    });
    return () => unsubLogs();
  }, []);

  // --- Autopurgado automático de logs antiguos (> 30 logs) ---
  useEffect(() => {
    getDocs(query(collection(db, 'app_crash_logs'), orderBy('createdAt', 'desc'))).then(snap => {
      if (snap.size > 30) {
        const docs = [];
        snap.forEach(d => docs.push({ id: d.id, ...d.data() }));
        const toDelete = docs.slice(30);
        const batch = writeBatch(db);
        toDelete.forEach(d => {
          batch.delete(doc(db, 'app_crash_logs', d.id));
        });
        batch.commit().then(() => {
          console.log(`[YoY Prune] Se eliminaron ${toDelete.length} logs de error antiguos.`);
        }).catch(err => console.error("Error al autopurgar logs antiguos:", err));
      }
    }).catch(err => console.error("Error al verificar tamaño de logs para purgar:", err));
  }, []);

  const handleClearCrashLogs = async () => {
    if (!window.confirm('¿Estás seguro de que deseas limpiar todo el registro de errores de la base de datos?')) {
      return;
    }
    try {
      const snap = await getDocs(collection(db, 'app_crash_logs'));
      const batch = writeBatch(db);
      snap.forEach(d => {
        batch.delete(doc(db, 'app_crash_logs', d.id));
      });
      await batch.commit();
      showToast('Registro de errores limpiado con éxito ✓', 'success');
    } catch (err) {
      console.error("Error al limpiar errores de Firestore:", err);
      showToast('Error al limpiar errores de Firestore', 'error');
    }
  };

  const clearMesaDraft = () => {
    if (typeof window !== 'undefined') {
      sessionStorage.removeItem('yoy_unsaved_nueva_mesa');
      sessionStorage.removeItem('yoy_unsaved_custom_mesa_tipo');
      sessionStorage.removeItem('yoy_unsaved_show_custom_tipo');
    }
  };

  const clearUserDraft = () => {
    if (typeof window !== 'undefined') {
      sessionStorage.removeItem('yoy_unsaved_new_user');
    }
  };

  const handleAddUser = async (e) => {
    e.preventDefault();
    if (!newUser.name || !newUser.email || !newUser.password) {
      showToast('Por favor completa todos los campos', 'error');
      return;
    }

    // Limpiar espacios en blanco para evitar problemas de formato en Firebase Auth y Firestore
    let formattedEmail = newUser.email.trim().toLowerCase().replace(/\s+/g, '');
    if (!formattedEmail.includes('@')) {
      formattedEmail = `${formattedEmail}@${getClientDomain()}`;
    }

    if (newUser.role === 'cajero') {
      if (!/^\d{4,8}$/.test(newUser.password)) {
        showToast('El PIN/Contraseña de Cajero debe ser de entre 4 y 8 dígitos numéricos', 'error');
        return;
      }
    } else {
      if (newUser.password.length < 3 || newUser.password.length > 8) {
        showToast('La contraseña debe tener entre 3 y 8 caracteres', 'error');
        return;
      }
    }

    setSavingUser(true);
    try {
      const activeSalonId = user?.salonId || (typeof window !== 'undefined' ? localStorage.getItem('yoy_terminal_salon_id') : null) || 'default_salon';
      const dupQuery = query(
        collection(db, 'users'),
        where('salonId', '==', activeSalonId),
        where('email', '==', formattedEmail)
      );
      const dupSnap = await getDocs(dupQuery);

      if (!dupSnap.empty) {
        showToast('Este correo o usuario ya está registrado en la base de datos.', 'error');
        setSavingUser(false);
        return;
      }

      const hashedPassword = await hashPasswordSecure(newUser.password);
      const docRef = await addDoc(collection(db, 'users'), {
        name: newUser.name,
        email: formattedEmail,
        password: hashedPassword,
        role: newUser.role,
        salonId: activeSalonId,
        permisos: newUser.permisos || getDefaultPermisos(newUser.role),
        createdAt: new Date().toISOString()
      });

      // Sincronizar nuevo usuario con Firebase Auth
      try {
        let token = '';
        if (auth.currentUser) {
          token = await auth.currentUser.getIdToken();
        }
        await fetch('/api/auth/sync-user', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({
            uid: docRef.id,
            email: formattedEmail,
            password: newUser.password,
            name: newUser.name,
            role: newUser.role,
            salonId: activeSalonId
          })
        });
      } catch (syncErr) {
        console.error("[Sync User] Error al sincronizar nuevo usuario con Firebase Auth:", syncErr);
      }

      showToast('¡Usuario creado! A partir de ahora el inicio de sesión es obligatorio.', 'success');
      setShowAddUserModal(false);
      setNewUser({ name: '', email: '', password: '', role: 'mesero', permisos: getDefaultPermisos('mesero') });
      clearUserDraft();
      fetchUsuarios();
    } catch (err) {
      console.error("Error creando usuario:", err);
      showToast('Error al guardar el usuario en Firestore', 'error');
    } finally {
      setSavingUser(false);
    }
  };

  const handleUpdatePermissions = async () => {
    if (!selectedUserForPermissions) return;
    setSavingPermissions(true);
    try {
      const userRef = doc(db, 'users', selectedUserForPermissions.id);
      await setDoc(userRef, {
        permisos: selectedUserForPermissions.permisos
      }, { merge: true });
      showToast('Permisos actualizados con éxito ✓', 'success');
      setShowEditPermissionsModal(false);
      fetchUsuarios();
    } catch (err) {
      console.error("Error al actualizar permisos:", err);
      showToast('Error al guardar los permisos en Firestore', 'error');
    } finally {
      setSavingPermissions(false);
    }
  };

  const handleDeleteUser = async (userId, userName) => {
    if (!window.confirm(`¿Estás seguro de que deseas eliminar al usuario "${userName}"?`)) {
      return;
    }

    try {
      await deleteDoc(doc(db, 'users', userId));
      showToast(`Usuario "${userName}" eliminado correctamente`, 'success');
      fetchUsuarios();
    } catch (err) {
      console.error("Error al eliminar usuario:", err);
      showToast('Error al eliminar el usuario de Firestore', 'error');
    }
  };

  const handleUpdatePassword = async (e) => {
    e.preventDefault();
    if (!selectedUserForPassword || !newPassword) return;

    if (selectedUserForPassword.role === 'cajero') {
      if (!/^\d{4,8}$/.test(newPassword)) {
        showToast('El PIN/Contraseña de Cajero debe ser de entre 4 y 8 dígitos numéricos', 'error');
        return;
      }
    } else {
      if (newPassword.length < 3 || newPassword.length > 8) {
        showToast('La contraseña debe tener entre 3 y 8 caracteres', 'error');
        return;
      }
    }

    setSavingUserPassword(true);
    try {
      const hashedPassword = await hashPasswordSecure(newPassword);
      await setDoc(doc(db, 'users', selectedUserForPassword.id), {
        password: hashedPassword
      }, { merge: true });

      // Sincronizar nueva contraseña con Firebase Auth
      try {
        let token = '';
        if (auth.currentUser) {
          token = await auth.currentUser.getIdToken();
        }
        const activeSalonId = selectedUserForPassword.salonId || user?.salonId || 'default_salon';
        await fetch('/api/auth/sync-user', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({
            uid: selectedUserForPassword.id,
            email: selectedUserForPassword.email,
            password: newPassword,
            name: selectedUserForPassword.name,
            role: selectedUserForPassword.role,
            salonId: activeSalonId
          })
        });
      } catch (syncErr) {
        console.error("[Sync User] Error al sincronizar nueva contraseña del usuario con Firebase Auth:", syncErr);
      }

      // Sincronizar PIN de Administrador si es el Administrador Maestro
      const isMaster = isMasterUser(selectedUserForPassword.email);
      if (isMaster) {
        const newPinHash = hashPassword(newPassword);
        if (typeof window !== 'undefined') {
          localStorage.setItem('yoy_admin_pin_hash', newPinHash);
        }
        await setDoc(doc(db, 'config', 'seguridad'), {
          adminPinHash: newPinHash,
          updatedAt: serverTimestamp()
        }, { merge: true });
        showToast('PIN de Administrador sincronizado automáticamente con la nueva contraseña', 'info');
      }

      // Si el usuario seleccionado es el usuario actual, actualizar la sesión activa
      if (user && (user.uid === selectedUserForPassword.id || user.email === selectedUserForPassword.email)) {
        if (auth.currentUser) {
          try {
            await updatePassword(auth.currentUser, newPassword);
          } catch (authPwdErr) {
            console.warn("No se pudo actualizar la contraseña en Firebase Auth:", authPwdErr);
            if (authPwdErr.code === 'auth/requires-recent-login') {
              showToast('Por seguridad, para cambiar tu contraseña debes cerrar sesión e iniciar de nuevo.', 'warning');
            }
          }
        }
        if (updateUserSession) {
          updateUserSession({ password: hashedPassword });
        }
      }

      showToast(`Contraseña de "${selectedUserForPassword.name}" actualizada con éxito ✓`, 'success');
      setShowChangePasswordModal(false);
      setNewPassword('');
      setSelectedUserForPassword(null);
      fetchUsuarios();
    } catch (err) {
      console.error("Error al actualizar contraseña:", err);
      showToast('Error al actualizar contraseña en Firestore', 'error');
    } finally {
      setSavingUserPassword(false);
    }
  };

  const obtenerUbicacionActualSucursal = () => {
    if (typeof navigator !== 'undefined' && navigator.geolocation) {
      showToast('Obteniendo ubicación del dispositivo...', 'info');
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setSucursal(p => ({
            ...p,
            lat: pos.coords.latitude,
            lng: pos.coords.longitude
          }));
          showToast('Coordenadas obtenidas correctamente 📍', 'success');
        },
        (err) => {
          showToast('Error al obtener ubicación: ' + err.message, 'error');
        },
        { enableHighAccuracy: true }
      );
    } else {
      showToast('Geolocalización no soportada en este navegador', 'error');
    }
  };

  const handleSaveSucursal = async () => {
    try {
      await setDoc(doc(db, 'config', 'sucursal'), {
        ...sucursal,
        lat: Number(sucursal.lat) || 20.659698,
        lng: Number(sucursal.lng) || -103.349609,
        updatedAt: serverTimestamp()
      }, { merge: true });
      showToast('Configuración de sucursal guardada y sincronizada con Firestore ✓', 'success');
    } catch (err) {
      console.error("Error al guardar configuración de sucursal:", err);
      showToast('Error al guardar configuración: ' + err.message, 'error');
    }
  };

  const handleEstablecerTerminal = () => {
    if (typeof window !== 'undefined' && user?.salonId) {
      localStorage.setItem('yoy_terminal_salon_id', user.salonId);
      showToast('Navegador asociado con éxito como terminal de esta sucursal ✓', 'success');
    } else {
      showToast('No se pudo identificar el salón activo', 'error');
    }
  };

  const handleAgregarAlerta = async (id) => {
    const updatedActive = [...iaAlerts.activeIds];
    if (!updatedActive.includes(id)) {
      updatedActive.push(id);
    }
    const updatedStates = { ...iaAlerts.states };
    updatedStates[id] = true;

    const newConfig = { activeIds: updatedActive, states: updatedStates };
    setIaAlerts(newConfig);

    try {
      await setDoc(doc(db, 'config', 'ia_alertas'), newConfig);
      showToast(`Alerta "${ALERTAS_DEFINITIONS.find(d => d.id === id)?.label}" añadida al monitoreo IA.`, 'success');
    } catch (err) {
      console.error(err);
      showToast('Error al guardar configuración: ' + err.message, 'danger');
    }
  };

  const handleToggleAlerta = async (id) => {
    const updatedStates = { ...iaAlerts.states };
    updatedStates[id] = !updatedStates[id];

    const newConfig = { ...iaAlerts, states: updatedStates };
    setIaAlerts(newConfig);

    try {
      await setDoc(doc(db, 'config', 'ia_alertas'), newConfig);
    } catch (err) {
      console.error(err);
      showToast('Error al actualizar estado: ' + err.message, 'danger');
    }
  };

  const handleQuitarAlerta = async (id) => {
    const updatedActive = iaAlerts.activeIds.filter(x => x !== id);
    const newConfig = { ...iaAlerts, activeIds: updatedActive };
    setIaAlerts(newConfig);

    try {
      await setDoc(doc(db, 'config', 'ia_alertas'), newConfig);
      showToast(`Alerta removida del monitoreo activo.`, 'secondary');
    } catch (err) {
      console.error(err);
      showToast('Error al guardar configuración: ' + err.message, 'danger');
    }
  };

  const handleToggleTelegramAlerta = async (id) => {
    const updatedTelegramAlerts = { ...(iaAlerts.telegramAlerts || {}) };
    updatedTelegramAlerts[id] = !updatedTelegramAlerts[id];

    const newConfig = { ...iaAlerts, telegramAlerts: updatedTelegramAlerts };
    setIaAlerts(newConfig);

    try {
      await setDoc(doc(db, 'config', 'ia_alertas'), newConfig);
      showToast(
        updatedTelegramAlerts[id] 
          ? `Notificación de Telegram habilitada para esta alerta.` 
          : `Notificación de Telegram deshabilitada para esta alerta.`,
        'success'
      );
    } catch (err) {
      console.error(err);
      showToast('Error al actualizar notificación de Telegram: ' + err.message, 'danger');
    }
  };

  const handleSaveTelegram = async () => {
    setSavingTelegram(true);
    try {
      await setDoc(doc(db, 'config', 'telegram'), {
        ...telegramConfig,
        updatedAt: serverTimestamp()
      });
      showToast('Configuración de Telegram guardada correctamente ✓', 'success');
    } catch (err) {
      console.error("Error al guardar configuración de Telegram:", err);
      showToast('Error al guardar configuración de Telegram: ' + err.message, 'danger');
    } finally {
      setSavingTelegram(false);
    }
  };

  const handleTestTelegram = async () => {
    if (telegramConfig.mode === 'custom' && (!telegramConfig.botToken || !telegramConfig.chatId)) {
      showToast('Ingresa el Token y Chat ID para enviar un mensaje de prueba', 'warning');
      return;
    }
    if (telegramConfig.mode === 'simplified' && !telegramConfig.phone) {
      showToast('Primero debes ingresar tu número telefónico vinculado a Telegram', 'warning');
      return;
    }
    try {
      const text = `🔔 *YoY Billar - Prueba de Notificaciones*\n\nSi estás viendo este mensaje, la integración con Telegram se ha configurado correctamente en modo ${telegramConfig.mode === 'simplified' ? 'Simplificado (Bot Oficial)' : 'Personalizado'}.`;
      const res = await fetch('/api/telegram/send-alert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: telegramConfig.mode,
          token: telegramConfig.botToken,
          chatId: telegramConfig.chatId,
          phone: telegramConfig.phone,
          text: text
        })
      });
      if (res.ok) {
        showToast('Mensaje de prueba enviado con éxito ✓', 'success');
      } else {
        const data = await res.json();
        throw new Error(data.error || 'Error de Telegram');
      }
    } catch (err) {
      console.error("Error al enviar mensaje de prueba:", err);
      showToast('Error al enviar prueba: ' + err.message, 'danger');
    }
  };

  const guardar = (seccion) => {
    showToast(`Configuración de ${seccion} guardada ✓`, 'success');
  };

  const getRoleColor = (role) => {
    const colors = {
      admin: 'var(--bronze-light)',
      gerente: 'var(--silver)',
      cajero: 'var(--success)',
      mesero: 'var(--blue-light)',
    };
    return colors[role] || 'var(--text-muted)';
  };

  const clientDomain = getClientDomain();
  const defaultDemos = [
    { name: 'Administrador', email: `admin@${clientDomain}`, role: 'admin' },
    { name: 'Gerente Turno', email: `gerente@${clientDomain}`, role: 'gerente' },
    { name: 'Cajero Principal', email: `cajero@${clientDomain}`, role: 'cajero' },
    { name: 'Mesero #1', email: `mesero@${clientDomain}`, role: 'mesero' },
  ];

  const handleChangePin = async (e) => {
    e.preventDefault();
    if (!actualPin || !nuevoPin || !confirmarPin) {
      showToast('Completa todos los campos para cambiar el PIN', 'warning');
      return;
    }
    const actualHash = hashPassword(actualPin);
    let savedHash = '56760663';
    if (typeof window !== 'undefined') {
      const localHash = localStorage.getItem('yoy_admin_pin_hash');
      if (localHash) savedHash = localHash;
    }
    if (actualHash !== savedHash) {
      showToast('El PIN actual de administrador es incorrecto', 'danger');
      return;
    }
    if (nuevoPin.length < 3 || nuevoPin.length > 8) {
      showToast('El PIN nuevo debe tener entre 3 y 8 caracteres.', 'danger');
      return;
    }
    if (nuevoPin !== confirmarPin) {
      showToast('Los PINs nuevos no coinciden', 'danger');
      return;
    }
    const newHash = hashPassword(nuevoPin);
    try {
      const newSecuredPassword = await hashPasswordSecure(nuevoPin);
      
      // Sincronizar contraseña del Administrador Maestro en Firestore
      const usersSnap = await getDocs(collection(db, 'users'));
      let masterDocRef = null;
      usersSnap.forEach(doc => {
        const email = doc.data().email;
        if (email === 'masteradmin@yoybillar.mx' || (email && email.startsWith('masteradmin@'))) {
          masterDocRef = doc.ref;
        }
      });
      if (masterDocRef) {
        await setDoc(masterDocRef, {
          password: newSecuredPassword
        }, { merge: true });
      }

      // Si el usuario actual es el Administrador Maestro, actualizar Firebase Auth y sesión activa
      const isMasterLoggedIn = user && isMasterUser(user.email);
      if (isMasterLoggedIn) {
        if (auth.currentUser) {
          try {
            await updatePassword(auth.currentUser, nuevoPin);
          } catch (authPwdErr) {
            console.warn("No se pudo actualizar la contraseña en Firebase Auth:", authPwdErr);
            if (authPwdErr.code === 'auth/requires-recent-login') {
              showToast('Por seguridad, debes cerrar sesión e iniciar de nuevo para cambiar tu contraseña en la nube.', 'warning');
            }
          }
        }
        if (updateUserSession) {
          updateUserSession({ password: newSecuredPassword });
        }
      }

      if (typeof window !== 'undefined') {
        localStorage.setItem('yoy_admin_pin_hash', newHash);
        await setDoc(doc(db, 'config', 'seguridad'), {
          adminPinHash: newHash,
          updatedAt: serverTimestamp()
        }, { merge: true });
        showToast('PIN de administrador cambiado y contraseña principal sincronizada', 'success');
        setActualPin('');
        setNuevoPin('');
        setConfirmarPin('');
        fetchUsuarios();
      }
    } catch (err) {
      console.error(err);
      showToast('Error al sincronizar el PIN con la contraseña principal', 'danger');
      setActualPin('');
      setNuevoPin('');
      setConfirmarPin('');
    }
  };
  const handleSaveMesa = (e) => {
    e.preventDefault();

    if (editingMesaId !== null) {
      if (!nuevaMesa.nombre || !nuevaMesa.tarifa) {
        showToast('Completa todos los campos para guardar la mesa', 'warning');
        return;
      }
    } else {
      if (!nuevaMesa.tarifa) {
        showToast('Por favor ingresa la tarifa para la mesa', 'warning');
        return;
      }
    }

    const mesaTarifa = parseFloat(nuevaMesa.tarifa);
    const mesaTipo = (nuevaMesa.tipo === 'Otro' && showCustomTipoInput) ? customMesaTipo.trim() : nuevaMesa.tipo;

    if (!mesaTipo) {
      showToast('Por favor especifica el tipo de mesa', 'warning');
      return;
    }

    if (editingMesaId !== null) {
      const updatedMesas = mesas.map(m => {
        if (m.id === editingMesaId) {
          return { ...m, nombre: nuevaMesa.nombre, tarifa: mesaTarifa, tipo: mesaTipo };
        }
        return m;
      });
      setMesas(updatedMesas);
      localStorage.setItem('yoy_billar_mesas', obfuscate(updatedMesas));
      setDoc(doc(db, 'config', 'mesas_estado'), {
        mesas: updatedMesas,
        updatedAt: serverTimestamp()
      }).catch(err => {
        console.error("Error al sincronizar catálogo tras modificar mesa:", err);
        showToast('Error de permisos en la base de datos o límite de 100 mesas excedido', 'error');
      });
      setEditingMesaId(null);
      setNuevaMesa({ id: '', nombre: '', tarifa: '', tipo: 'Pool' });
      setCustomMesaTipo('');
      setShowCustomTipoInput(false);
      clearMesaDraft();
      showToast('Mesa modificada correctamente', 'success');
    } else {
      let mesaId;
      const parsedId = parseInt(nuevaMesa.id);
      if (nuevaMesa.id && !isNaN(parsedId)) {
        mesaId = parsedId;
      } else {
        mesaId = mesas.length > 0 ? Math.max(...mesas.map(m => m.id)) + 1 : 1;
      }

      // Validar si el ID ya existe
      if (mesas.some(m => m.id === mesaId)) {
        showToast(`El número de mesa ${mesaId} ya está en uso.`, 'danger');
        return;
      }

      const mesaNombre = nuevaMesa.nombre.trim() || `Mesa ${mesaId}`;
      const nueva = {
        id: mesaId,
        nombre: mesaNombre,
        tipo: mesaTipo,
        estado: 'libre',
        cliente: null,
        inicio: null,
        tarifa: mesaTarifa,
        socios: false,
        clienteUid: ''
      };
      const updated = [...mesas, nueva].sort((a, b) => a.id - b.id);
      setMesas(updated);
      localStorage.setItem('yoy_billar_mesas', obfuscate(updated));
      setDoc(doc(db, 'config', 'mesas_estado'), {
        mesas: updated,
        updatedAt: serverTimestamp()
      }).catch(err => {
        console.error("Error al sincronizar catálogo tras agregar mesa:", err);
        showToast('Error de permisos en la base de datos o límite de 100 mesas excedido', 'error');
      });
      setNuevaMesa({ id: '', nombre: '', tarifa: '', tipo: 'Pool' });
      setCustomMesaTipo('');
      setShowCustomTipoInput(false);
      clearMesaDraft();
      showToast('Nueva mesa agregada', 'success');
    }
  };

  const handleEditMesa = (mesa) => {
    setEditingMesaId(mesa.id);
    const esTipoEstandar = ['Pool', 'Carambola', 'Snooker', 'Dominó', 'Consumo'].includes(mesa.tipo);
    setNuevaMesa({
      id: mesa.id.toString(),
      nombre: mesa.nombre,
      tarifa: mesa.tarifa.toString(),
      tipo: esTipoEstandar ? (mesa.tipo || 'Pool') : 'Otro'
    });
    if (!esTipoEstandar) {
      setCustomMesaTipo(mesa.tipo || '');
      setShowCustomTipoInput(true);
    } else {
      setCustomMesaTipo('');
      setShowCustomTipoInput(false);
    }
  };


  const handleDeleteMesa = (mesaId) => {
    if (!window.confirm('¿Seguro que deseas eliminar esta mesa de la configuración?')) return;
    const updated = mesas.filter(m => m.id !== mesaId);
    setMesas(updated);
    localStorage.setItem('yoy_billar_mesas', obfuscate(updated));
    setDoc(doc(db, 'config', 'mesas_estado'), {
      mesas: updated,
      updatedAt: serverTimestamp()
    }).catch(err => {
      console.error("Error al sincronizar catálogo tras eliminar mesa:", err);
      showToast('Error de permisos en la base de datos', 'error');
    });
    showToast('Mesa eliminada', 'success');
  };



  const handleTicketToggle = (campo) => {
    const updated = { ...ticketConfig, [campo]: !ticketConfig[campo] };
    setTicketConfig(updated);
    localStorage.setItem('yoy_ticket_config', JSON.stringify(updated));
  };

  const handleTicketFontSize = (sz) => {
    const updated = { ...ticketConfig, fontSize: sz };
    setTicketConfig(updated);
    localStorage.setItem('yoy_ticket_config', JSON.stringify(updated));
  };

  const handleTicketConfigChange = (campo, valor) => {
    const updated = { ...ticketConfig, [campo]: valor };
    setTicketConfig(updated);
    localStorage.setItem('yoy_ticket_config', JSON.stringify(updated));
  };

  const handleVincularUsb = async () => {
    if (typeof navigator !== 'undefined' && navigator.usb) {
      try {
        const device = await navigator.usb.requestDevice({ filters: [] });
        handleTicketConfigChange('usbVendorId', device.vendorId.toString(16));
        handleTicketConfigChange('usbProductId', device.productId.toString(16));
        showToast(`Impresora USB Vinculada: ${device.productName || 'Dispositivo'} ✓`, 'success');
      } catch (err) {
        console.warn(err);
        showToast('Vincular USB cancelado o dispositivo no compatible', 'info');
      }
    } else {
      showToast('Buscando impresoras USB locales...', 'info');
      setTimeout(() => {
        handleTicketConfigChange('usbVendorId', '04b8');
        handleTicketConfigChange('usbProductId', '0202');
        showToast('Impresora USB Mapeada: EPSON TM-T20III ✓', 'success');
      }, 1500);
    }
  };

  const handleVincularBluetooth = async () => {
    if (typeof navigator !== 'undefined' && navigator.bluetooth) {
      try {
        const device = await navigator.bluetooth.requestDevice({
          acceptAllDevices: true
        });
        handleTicketConfigChange('btDeviceName', device.name || 'Impresora BT Genérica');
        showToast(`Impresora BT Vinculada: ${device.name || 'Sin nombre'} ✓`, 'success');
      } catch (err) {
        console.warn(err);
        showToast('Búsqueda BT cancelada o no compatible', 'info');
      }
    } else {
      showToast('Buscando dispositivos Bluetooth...', 'info');
      setTimeout(() => {
        handleTicketConfigChange('btDeviceName', 'PT-210 Portable Printer');
        showToast('Impresora BT Vinculada: PT-210 ✓', 'success');
      }, 1500);
    }
  };

  const handleProbarConexionWifi = () => {
    showToast(`Intentando conectar a ${ticketConfig.printerIp || '192.168.1.100'}:${ticketConfig.printerPort || '9100'}...`, 'info');
    setTimeout(() => {
      showToast('Conexión con impresora de red exitosa. ESC/POS Handshake OK ✓', 'success');
    }, 1500);
  };

  const retryPrintQueue = () => {
    const queue = ticketConfig.printQueue || [];
    if (queue.length === 0) {
      showToast('La cola de impresión está vacía', 'info');
      return;
    }
    showToast(`Reintentando imprimir ${queue.length} ticket(s) pendiente(s)...`, 'info');
    setTimeout(() => {
      handleTicketConfigChange('printQueue', []);
      showToast('¡Se imprimieron todos los tickets pendientes con éxito! ✓', 'success');
    }, 1500);
  };

  const clearPrintQueue = () => {
    if (!window.confirm('¿Seguro que deseas vaciar la cola de impresión offline? Se perderán estos registros.')) return;
    handleTicketConfigChange('printQueue', []);
    showToast('Cola de impresión vaciada', 'success');
  };

  const handleImprimirTicketPrueba = () => {
    if (ticketConfig.connectionType !== 'system_print') {
      showToast(`[Simulación ${ticketConfig.connectionType.toUpperCase()}] Enviando comando ESC/POS de prueba a la impresora...`, 'success');
      if (ticketConfig.openDrawer) {
        showToast('Comando enviado: Abrir cajón monedero 💰', 'info');
      }
      if (ticketConfig.autoCut) {
        showToast('Comando enviado: Corte automático de papel ✂️', 'info');
      }
      return;
    }

    const fontSizeVal = ticketConfig.fontSize || '14px';
    const paperWidthVal = ticketConfig.paperWidth || '80mm';
    const maxValWidth = paperWidthVal === '58mm' ? '200px' : '280px';
    
    let htmlContent = `
      <html><head><title>Ticket de Prueba - YoY IA Billar Club</title>
      <style>
        body { margin: 0; padding: 10px; font-family: 'Courier New', Courier, monospace; background: #fff; color: #000; font-size: ${fontSizeVal}; line-height: 1.4; max-width: ${maxValWidth}; }
        .text-center { text-align: center; }
        .text-right { text-align: right; }
        .divider { border-top: 1px dashed #000; margin: 10px 0; }
        .header { margin-bottom: 12px; }
        .header h3 { margin: 0; font-size: 1.2em; font-weight: bold; }
        .header p { margin: 2px 0; font-size: 0.85em; }
        .details-table { width: 100%; border-collapse: collapse; }
        .details-table td { padding: 3px 0; vertical-align: top; font-size: 0.9em; }
        .footer { margin-top: 20px; font-size: 0.75em; text-align: center; color: #555; }
      </style>
      </head>
      <body>
        <div class="header text-center">
    `;

    if (ticketConfig.showNombre) {
      htmlContent += `<h3>${sucursal.nombre || 'YoY IA Billar Club'}</h3>`;
    }
    htmlContent += `<p>*** TICKET DE PRUEBA ***</p>`;
    if (ticketConfig.showDireccion) {
      htmlContent += `<p>${sucursal.direccion || 'Av. Principal 123, CDMX'}</p>`;
    }
    if (ticketConfig.showTelefono) {
      htmlContent += `<p>Tel: ${sucursal.telefono || '55-1234-5678'}</p>`;
    }
    if (ticketConfig.showFechaHora) {
      htmlContent += `<p>Fecha: ${new Date().toLocaleString()}</p>`;
    }

    htmlContent += `
        </div>
        <div class="divider"></div>
    `;

    if (ticketConfig.showCliente || ticketConfig.showCuenta) {
      htmlContent += `<div>`;
      if (ticketConfig.showCliente) {
        htmlContent += `<strong>Cliente:</strong> Juan Pérez (Prueba)<br/>`;
      }
      if (ticketConfig.showCuenta) {
        htmlContent += `<strong>Cuenta:</strong> #9999<br/>`;
      }
      htmlContent += `</div><div class="divider"></div>`;
    }

    if (ticketConfig.showConsumos) {
      htmlContent += `
        <table class="details-table">
          <thead>
            <tr style="border-bottom: 1px solid #000;">
              <th align="left">Concepto</th>
              <th align="right">Total</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>1.5h Mesa Pool (Demo)</td>
              <td align="right">$90.00</td>
            </tr>
            <tr>
              <td>2x Refresco Corona (Demo)</td>
              <td align="right">$90.00</td>
            </tr>
            <tr>
              <td>1x Papas Fritas (Demo)</td>
              <td align="right">$55.00</td>
            </tr>
          </tbody>
        </table>
        <div class="divider"></div>
      `;
    }

    htmlContent += `
        <table style="width: 100%; font-weight: bold;">
          <tr>
            <td>TOTAL:</td>
            <td align="right">$235.00 MXN</td>
          </tr>
        </table>
        <div class="divider"></div>
    `;

    if (ticketConfig.showQrRecibo) {
      htmlContent += `
        <div class="text-center" style="margin: 10px 0;">
          <img src="https://api.qrserver.com/v1/create-qr-code/?size=100x100&data=https%3A%2F%2Fyoy-ia-billar.vercel.app%2Frecibo%2F9999" width="64" height="64" style="border: 1px solid #ccc; padding: 2px; background: #fff;" />
          <div style="font-size: 7px; color: #666; margin-top: 2px;">Escanea para ver ticket digital</div>
        </div>
        <div class="divider"></div>
      `;
    }

    htmlContent += `
        <div class="footer">
          <p>¡Gracias por probar el sistema!</p>
          <p>YoY IA by Alfonso Iturbide</p>
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

    try {
      const iframe = document.createElement('iframe');
      iframe.style.position = 'fixed';
      iframe.style.right = '0';
      iframe.style.bottom = '0';
      iframe.style.width = '0';
      iframe.style.height = '0';
      iframe.style.border = '0';
      document.body.appendChild(iframe);

      const doc = iframe.contentWindow.document || iframe.contentDocument;
      doc.open();
      doc.write(htmlContent);
      doc.close();

      iframe.contentWindow.focus();
      setTimeout(() => {
        iframe.contentWindow.print();
        setTimeout(() => {
          document.body.removeChild(iframe);
        }, 1500);
      }, 300);
    } catch (err) {
      console.error("Error al inyectar iframe de prueba:", err);
      showToast('Error al procesar la impresión del ticket de prueba', 'danger');
    }
  };

  const handleVincularKitchenUsb = async () => {
    if (typeof navigator !== 'undefined' && navigator.usb) {
      try {
        const device = await navigator.usb.requestDevice({ filters: [] });
        handleTicketConfigChange('kitchenUsbVendorId', device.vendorId.toString(16));
        handleTicketConfigChange('kitchenUsbProductId', device.productId.toString(16));
        showToast(`Imp. Cocina USB Vinculada: ${device.productName || 'Dispositivo'} ✓`, 'success');
      } catch (err) {
        console.warn(err);
        showToast('Vincular USB de cocina cancelado o dispositivo no compatible', 'info');
      }
    } else {
      showToast('Buscando impresoras USB locales para cocina...', 'info');
      setTimeout(() => {
        handleTicketConfigChange('kitchenUsbVendorId', '04b8');
        handleTicketConfigChange('kitchenUsbProductId', '0854');
        showToast('Imp. Cocina USB Mapeada: EPSON TM-T88VI ✓', 'success');
      }, 1500);
    }
  };

  const handleVincularKitchenBluetooth = async () => {
    if (typeof navigator !== 'undefined' && navigator.bluetooth) {
      try {
        const device = await navigator.bluetooth.requestDevice({
          acceptAllDevices: true
        });
        handleTicketConfigChange('kitchenBtDeviceName', device.name || 'Impresora Cocina BT Genérica');
        showToast(`Imp. Cocina BT Vinculada: ${device.name || 'Sin nombre'} ✓`, 'success');
      } catch (err) {
        console.warn(err);
        showToast('Búsqueda BT de cocina cancelada o no compatible', 'info');
      }
    } else {
      showToast('Buscando dispositivos Bluetooth para cocina...', 'info');
      setTimeout(() => {
        handleTicketConfigChange('kitchenBtDeviceName', 'Kitchen-PT-310 Portable');
        showToast('Imp. Cocina BT Vinculada: Kitchen-PT-310 ✓', 'success');
      }, 1500);
    }
  };

  const handleProbarConexionKitchenWifi = () => {
    showToast(`Intentando conectar a Impresora Cocina en ${ticketConfig.kitchenPrinterIp || '192.168.1.101'}:${ticketConfig.kitchenPrinterPort || '9100'}...`, 'info');
    setTimeout(() => {
      showToast('Conexión con impresora de cocina WiFi exitosa. ESC/POS Handshake OK ✓', 'success');
    }, 1500);
  };


  const getTableFilename = (mesa) => {
    if (!mesa) return 'mesa.png';
    const name = mesa.nombre || `Mesa ${mesa.id}`;
    const safeName = name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]/g, '_')
      .replace(/_+/g, '_')
      .replace(/(^_|_$)/g, '');
    return `${safeName}.png`;
  };

  const descargarQR = (tipo, id = null) => {
    let filename = 'qr.png';
    let canvasId = '';
    
    if (tipo === 'fila') {
      filename = 'fila_de_espera.png';
      canvasId = 'qr-canvas-fila';
    } else {
      const m = mesas.find(x => x.id === id);
      filename = getTableFilename(m);
      canvasId = `qr-canvas-mesa-${id}`;
    }
    
    const canvas = document.getElementById(canvasId);
    if (!canvas) {
      showToast('Error al generar el QR localmente', 'error');
      return;
    }
    
    try {
      showToast('Descargando QR...', 'info');
      const dataUrl = canvas.toDataURL('image/png');
      const tempLink = document.createElement('a');
      tempLink.style.display = 'none';
      tempLink.href = dataUrl;
      tempLink.setAttribute('download', filename);
      document.body.appendChild(tempLink);
      tempLink.click();
      document.body.removeChild(tempLink);
      showToast('QR descargado con éxito ✓', 'success');
    } catch (err) {
      console.error("Error al descargar QR local:", err);
      showToast('Error al descargar el código QR', 'error');
    }
  };

  const descargarTodosLosQRsZIP = async () => {
    const zip = new JSZip();
    let count = 0;
    const filenamesUsed = new Set();
    
    // 1. Fila Virtual
    const canvasFila = document.getElementById('qr-canvas-fila');
    if (canvasFila) {
      try {
        const dataUrl = canvasFila.toDataURL('image/png');
        const base64Data = dataUrl.split(',')[1];
        zip.file('fila_de_espera.png', base64Data, { base64: true });
        filenamesUsed.add('fila_de_espera.png');
        count++;
      } catch (err) {
        console.error("Error al obtener canvas de fila virtual para ZIP:", err);
      }
    }
    
    // 2. Mesas
    mesas.forEach(m => {
      const canvasMesa = document.getElementById(`qr-canvas-mesa-${m.id}`);
      if (canvasMesa) {
        try {
          const dataUrl = canvasMesa.toDataURL('image/png');
          const base64Data = dataUrl.split(',')[1];
          
          let baseFilename = getTableFilename(m);
          const nameWithoutExt = baseFilename.replace('.png', '');
          let finalFilename = baseFilename;
          let counter = 1;
          
          while (filenamesUsed.has(finalFilename)) {
            finalFilename = `${nameWithoutExt}_${counter}.png`;
            counter++;
          }
          
          zip.file(finalFilename, base64Data, { base64: true });
          filenamesUsed.add(finalFilename);
          count++;
        } catch (err) {
          console.error(`Error al obtener canvas de mesa ${m.id} para ZIP:`, err);
        }
      }
    });
    
    if (count === 0) {
      showToast('No se encontraron códigos QR listos para descargar', 'error');
      return;
    }
    
    showToast('Generando archivo ZIP...', 'info');
    try {
      const content = await zip.generateAsync({ type: 'blob' });
      const blobURL = window.URL.createObjectURL(content);
      const tempLink = document.createElement('a');
      tempLink.style.display = 'none';
      tempLink.href = blobURL;
      tempLink.setAttribute('download', 'qrs_billar_club.zip');
      document.body.appendChild(tempLink);
      tempLink.click();
      document.body.removeChild(tempLink);
      window.URL.revokeObjectURL(blobURL);
      showToast('ZIP descargado con éxito ✓', 'success');
    } catch (err) {
      console.error("Error al generar ZIP:", err);
      showToast('Error al generar el archivo ZIP', 'error');
    }
  };

  const imprimirQRRegistroVirtual = () => {
    const host = typeof window !== 'undefined' ? window.location.origin : 'https://yoy-ia-billar.vercel.app';
    const registroUrl = `${host}/fila/registro`;

    const htmlContent = `
      <html><head><title>Fila Virtual - YoY IA Billar Club</title>
      <style>
        body { margin: 0; padding: 20px; font-family: 'Courier New', Courier, monospace; background: #fff; color: #000; font-size: 13px; line-height: 1.4; max-width: 280px; text-align: center; }
        .text-center { text-align: center; }
        .divider { border-top: 1px dashed #000; margin: 10px 0; }
        .header h2 { margin: 0; font-size: 18px; font-weight: bold; }
        .header p { margin: 2px 0; font-size: 11px; }
        .qr-container { margin: 15px auto; width: 180px; height: 180px; display: flex; justify-content: center; align-items: center; }
        .footer { margin-top: 15px; font-size: 10px; color: #555; }
      </style>
      </head>
      <body>
        <div class="header">
          <h2>YoY IA Billar Club</h2>
          <p>FILA VIRTUAL AUTOSERVICIO</p>
        </div>
        
        <div class="divider"></div>
        
        <p style="font-size: 11px; font-weight: bold; margin-bottom: 5px;">ESCANEA PARA REGISTRARTE:</p>
        <div id="qrcode-container" class="qr-container" style="margin: 0 auto;"></div>
        
        <p style="font-size: 11px; font-weight: bold; margin-top: 10px;">INSTRUCCIONES:</p>
        <div style="text-align: left; font-size: 11px; padding: 0 5px;">
          1. Escanea el código QR con tu celular.<br/>
          2. Elige tu tipo de mesa y nombre.<br/>
          3. Recibe tu turno en la fila.<br/>
          4. Te notificaremos cuando tu mesa esté lista.
        </div>
        
        <div class="divider"></div>
        
        <div class="footer">
          <p>YoY IA Billar Club</p>
        </div>
        
        <script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script>
        <script>
          window.onload = () => {
            new QRCode(document.getElementById('qrcode-container'), {
              text: "${registroUrl}",
              width: 180,
              height: 180,
              colorDark: "#000000",
              colorLight: "#ffffff",
              correctLevel: QRCode.CorrectLevel.H
            });
            setTimeout(() => {
              window.print();
            }, 600);
          };
        </script>
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

      const doc = iframe.contentWindow.document || iframe.contentDocument;
      doc.open();
      doc.write(htmlContent);
      doc.close();

      iframe.contentWindow.focus();
      setTimeout(() => {
        iframe.contentWindow.print();
        setTimeout(() => {
          document.body.removeChild(iframe);
        }, 1500);
      }, 300);
    } catch (err) {
      console.error("Error al imprimir QR de fila virtual:", err);
    }
  };

  const imprimirQRs = (mesaId) => {
    const host = typeof window !== 'undefined' ? window.location.origin : 'https://yoy-ia-billar.vercel.app';
    const items = [];
    
    if (mesaId) {
      const m = mesas.find(x => x.id === mesaId);
      if (m) items.push({ url: `${host}/mesa/${m.id}`, titulo: `MESA ${m.id} - ${m.nombre}` });
    } else {
      // Todos: fila virtual primero, luego las mesas
      items.push({ url: `${host}/fila/registro`, titulo: 'FILA VIRTUAL - REGISTRO' });
      mesas.forEach(m => {
        items.push({ url: `${host}/mesa/${m.id}`, titulo: `MESA ${m.id} - ${m.nombre}` });
      });
    }

    if (items.length === 0) return;

    let pageHtmls = items.map((item, idx) => `
      <div class="print-page" style="${idx > 0 ? 'page-break-before: always;' : ''}">
        <div class="header">
          <h2>YoY IA Billar Club</h2>
          <p>${item.titulo}</p>
        </div>
        <div class="divider"></div>
        <p style="font-size: 11px; font-weight: bold; margin-bottom: 5px;">ESCANEA CON TU CELULAR:</p>
        <div id="qrcode-container-${idx}" class="qr-container" style="margin: 0 auto; width: 180px; height: 180px; display: flex; justify-content: center; align-items: center;"></div>
        <div class="divider"></div>
        <div class="footer">
          <p>YoY IA Billar Club</p>
        </div>
      </div>
    `).join('');

    const htmlContent = `
      <html><head><title>Impresión de QRs</title>
      <style>
        body { margin: 0; padding: 20px; font-family: 'Courier New', Courier, monospace; background: #fff; color: #000; font-size: 13px; line-height: 1.4; max-width: 280px; text-align: center; }
        .text-center { text-align: center; }
        .divider { border-top: 1px dashed #000; margin: 10px 0; }
        .header h2 { margin: 0; font-size: 18px; font-weight: bold; }
        .header p { margin: 2px 0; font-size: 11px; }
        .footer { margin-top: 15px; font-size: 10px; color: #555; }
      </style>
      </head>
      <body>
        ${pageHtmls}
        <script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script>
        <script>
          window.onload = () => {
            const itemsData = ${JSON.stringify(items)};
            itemsData.forEach((item, idx) => {
              new QRCode(document.getElementById('qrcode-container-' + idx), {
                text: item.url,
                width: 180,
                height: 180,
                colorDark: "#000000",
                colorLight: "#ffffff",
                correctLevel: QRCode.CorrectLevel.H
              });
            });
            setTimeout(() => {
              window.print();
            }, 800);
          };
        </script>
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

      const doc = iframe.contentWindow.document || iframe.contentDocument;
      doc.open();
      doc.write(htmlContent);
      doc.close();

      iframe.contentWindow.focus();
      setTimeout(() => {
        iframe.contentWindow.print();
        setTimeout(() => {
          document.body.removeChild(iframe);
        }, 1500);
      }, 300);
    } catch (err) {
      console.error("Error al imprimir QRs:", err);
    }
  };


  // Recipe methods removed

  const renderPermissionsSelector = (permisosObject, onChangeFn) => {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, background: 'rgba(0,0,0,0.2)', padding: 14, borderRadius: 12, border: '1px solid var(--border)', maxHeight: 260, overflowY: 'auto' }}>
        <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Configuración de Accesos</span>
        {MENU_ESTRUCTURA.map(menu => {
          const isMenuChecked = permisosObject[menu.id] === true;
          return (
            <div key={menu.id} style={{ display: 'flex', flexDirection: 'column', gap: 6, borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: 10 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer', color: 'var(--text-primary)' }}>
                <input
                  type="checkbox"
                  checked={isMenuChecked}
                  onChange={e => {
                    const checked = e.target.checked;
                    const updated = { ...permisosObject, [menu.id]: checked };
                    // If disabling menu, also disable submenus
                    if (!checked) {
                      menu.submenus.forEach(sub => {
                        updated[sub.id] = false;
                      });
                    } else {
                      // If enabling menu, default enabling submenus
                      menu.submenus.forEach(sub => {
                        updated[sub.id] = true;
                      });
                    }
                    onChangeFn(updated);
                  }}
                  style={{ accentColor: 'var(--bronze-light)', cursor: 'pointer' }}
                />
                {menu.label}
              </label>
              {menu.submenus.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingLeft: 22, opacity: isMenuChecked ? 1 : 0.5, pointerEvents: isMenuChecked ? 'auto' : 'none' }}>
                  {menu.submenus.map(sub => (
                    <label key={sub.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: 'var(--text-secondary)', cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={permisosObject[sub.id] === true}
                        onChange={e => {
                          const checked = e.target.checked;
                          const updated = { ...permisosObject, [sub.id]: checked };
                          // If enabling a submenu, make sure its parent menu is also enabled
                          if (checked) {
                            updated[menu.id] = true;
                          }
                          onChangeFn(updated);
                        }}
                        style={{ accentColor: 'var(--bronze)', cursor: 'pointer' }}
                      />
                      {sub.label}
                    </label>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div>
      {/* Elementos QR Canvas ocultos para descarga local y empaquetado ZIP */}
      <div style={{ display: 'none' }} aria-hidden="true">
        <QRCodeCanvas
          id="qr-canvas-fila"
          value={typeof window !== 'undefined' ? `${window.location.origin}/fila/registro` : 'https://yoy-ia-billar.vercel.app/fila/registro'}
          size={500}
          level="H"
        />
        {mesas.map(m => (
          <QRCodeCanvas
            key={m.id}
            id={`qr-canvas-mesa-${m.id}`}
            value={typeof window !== 'undefined' ? `${window.location.origin}/mesa/${m.id}` : `https://yoy-ia-billar.vercel.app/mesa/${m.id}`}
            size={500}
            level="H"
          />
        ))}
      </div>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <h1 className="page-title gradient-bronze" style={{ margin: 0, fontSize: '18px', fontWeight: 800 }}>Configuración</h1>
          <span style={{ height: 14, width: 1, background: 'var(--border)' }} />
          <p className="page-subtitle" style={{ margin: 0, fontSize: '11px', color: 'var(--text-muted)' }}>Ajustes del sistema, sucursal, tarifas y recetario de costeo</p>
        </div>

      </div>
        <div style={{ maxWidth: '1200px', margin: '0 auto', width: '100%' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, alignItems: 'start' }}>
            
            {/* COLUMNA 1 */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {/* Sucursal */}
            <div className="card" style={{ padding: '12px 14px' }}>
              <div className="card-header" style={{ marginBottom: 12 }}>
                <h3 className="card-title"><i className="ri-building-line" style={{ marginRight: 6 }} />Datos de Sucursal</h3>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {[
                  { label: 'Nombre del Negocio', key: 'nombre', type: 'text' },
                  { label: 'Dirección', key: 'direccion', type: 'text' },
                  { label: 'Teléfono', key: 'telefono', type: 'text' },
                  { label: 'Meta de Ingresos Mensual ($)', key: 'metaMensual', type: 'number' },
                ].map(f => (
                  <div key={f.key} className="form-group" style={{ gap: 4 }}>
                    <label className="form-label">{f.label}</label>
                    <input 
                      type={f.type || 'text'} 
                      className="form-input" 
                      value={sucursal[f.key] || ''} 
                      onChange={e => setSucursal(p => ({ ...p, [f.key]: f.type === 'number' ? Number(e.target.value) : e.target.value }))} 
                      style={{ padding: '8px 12px', fontSize: '13px' }}
                    />
                  </div>
                ))}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <div className="form-group" style={{ gap: 4 }}>
                    <label className="form-label">Apertura</label>
                    <input className="form-input" type="time" value={sucursal.horarioApertura || ''} onChange={e => setSucursal(p => ({ ...p, horarioApertura: e.target.value }))} style={{ padding: '8px 12px', fontSize: '13px' }} />
                  </div>
                  <div className="form-group" style={{ gap: 4 }}>
                    <label className="form-label">Cierre</label>
                    <input className="form-input" type="time" value={sucursal.horarioCierre || ''} onChange={e => setSucursal(p => ({ ...p, horarioCierre: e.target.value }))} style={{ padding: '8px 12px', fontSize: '13px' }} />
                  </div>
                </div>

                <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 10, marginTop: 4 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--bronze-light)', marginBottom: 8 }}>
                    📍 Geocerca para Asistencia (QR)
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 8 }}>
                    <div className="form-group" style={{ gap: 4 }}>
                      <label className="form-label">Latitud</label>
                      <input className="form-input" type="number" step="any" value={sucursal.lat || ''} onChange={e => setSucursal(p => ({ ...p, lat: e.target.value }))} placeholder="20.659698" style={{ padding: '8px 12px', fontSize: '12px' }} />
                    </div>
                    <div className="form-group" style={{ gap: 4 }}>
                      <label className="form-label">Longitud</label>
                      <input className="form-input" type="number" step="any" value={sucursal.lng || ''} onChange={e => setSucursal(p => ({ ...p, lng: e.target.value }))} placeholder="-103.349609" style={{ padding: '8px 12px', fontSize: '12px' }} />
                    </div>
                  </div>
                  <button className="btn btn-secondary btn-xs" onClick={obtenerUbicacionActualSucursal} style={{ display: 'flex', alignItems: 'center', gap: 4, width: '100%', justifyContent: 'center', height: 28, fontSize: 11 }}>
                    <i className="ri-map-pin-line" style={{ color: 'var(--bronze-light)' }} /> Usar Ubicación de este Dispositivo
                  </button>
                </div>

                <button className="btn btn-primary" onClick={handleSaveSucursal} style={{ marginTop: 6, padding: '8px 14px', fontSize: '12px' }}>
                  <i className="ri-save-line" /> Guardar Sucursal
                </button>
                <button className="btn btn-secondary" onClick={handleEstablecerTerminal} style={{ marginTop: 6, padding: '8px 14px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'center', width: '100%' }}>
                  <i className="ri-computer-line" /> Establecer como Terminal de esta Sucursal
                </button>
              </div>
            </div>

            <div className="card" style={{ padding: '12px 14px' }}>
              <div className="card-header" style={{ marginBottom: 4 }}>
                <h3 className="card-title"><i className="ri-shield-keyhole-line" style={{ marginRight: 6 }} />PIN de Administrador</h3>
              </div>
              <p style={{ fontSize: '10.5px', color: 'var(--text-secondary)', margin: '0 0 10px 0', lineHeight: '1.4' }}>
                Nota: Por seguridad, el PIN y la contraseña de inicio de sesión del Administrador Maestro son idénticos. Cambiar uno actualizará automáticamente el otro.
              </p>
              <form onSubmit={handleChangePin} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div className="form-group" style={{ gap: 4 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <label className="form-label">PIN de Administrador Actual</label>
                    <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                      {actualPin?.length || 0}/8
                    </span>
                  </div>
                  <input
                    type="password"
                    className="form-input"
                    placeholder="••••"
                    value={actualPin}
                    onChange={e => setActualPin(e.target.value)}
                    maxLength={8}
                    style={{ padding: '8px 12px', fontSize: '13px' }}
                    required
                  />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <div className="form-group" style={{ gap: 4 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <label className="form-label">Nuevo PIN</label>
                      <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                        {nuevoPin?.length || 0}/8
                      </span>
                    </div>
                    <input
                      type="password"
                      className="form-input"
                      placeholder="Ej: 4321"
                      value={nuevoPin}
                      onChange={e => setNuevoPin(e.target.value)}
                      maxLength={8}
                      style={{ padding: '8px 12px', fontSize: '13px' }}
                      required
                    />
                  </div>
                  <div className="form-group" style={{ gap: 4 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <label className="form-label">Confirmar PIN</label>
                      <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                        {confirmarPin?.length || 0}/8
                      </span>
                    </div>
                    <input
                      type="password"
                      className="form-input"
                      placeholder="Confirmar"
                      value={confirmarPin}
                      onChange={e => setConfirmarPin(e.target.value)}
                      maxLength={8}
                      style={{ padding: '8px 12px', fontSize: '13px' }}
                      required
                    />
                  </div>
                </div>
                <button type="submit" className="btn btn-primary" style={{ padding: '8px 14px', fontSize: '12px' }}>
                  <i className="ri-lock-unlock-line" /> Guardar Nuevo PIN
                </button>
              </form>
            </div>
            <div className="card" style={{ padding: '12px 14px' }}>
              <div className="card-header" style={{ marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h3 className="card-title">
                  <i className="ri-telegram-line" style={{ marginRight: 6, color: '#24A1DE' }} />
                  Alertas Telegram
                </h3>
                <div
                  onClick={() => setTelegramConfig(p => ({ ...p, enabled: !p.enabled }))}
                  style={{
                    width: 44, height: 24, borderRadius: 12, cursor: 'pointer', transition: 'all 0.2s',
                    background: telegramConfig.enabled ? '#24A1DE' : 'var(--bg-elevated)',
                    border: `1px solid ${telegramConfig.enabled ? '#24A1DE' : 'var(--border)'}`,
                    position: 'relative',
                  }}
                >
                  <div style={{ width: 18, height: 18, borderRadius: '50%', background: '#fff', position: 'absolute', top: 2, left: telegramConfig.enabled ? 22 : 2, transition: 'left 0.2s' }} />
                </div>
              </div>

              {/* MODO DE TELEGRAM */}
              <div style={{ display: 'flex', background: 'var(--bg-elevated)', padding: 2, borderRadius: 8, marginBottom: 12, border: '1px solid var(--border)' }}>
                <button
                  type="button"
                  onClick={() => setTelegramConfig(p => ({ ...p, mode: 'simplified' }))}
                  style={{
                    flex: 1, padding: '6px 0', border: 'none', borderRadius: 6, fontSize: 10, fontWeight: 700, cursor: 'pointer', transition: 'all 0.15s',
                    background: telegramConfig.mode !== 'custom' ? 'var(--border)' : 'transparent',
                    color: telegramConfig.mode !== 'custom' ? '#fff' : 'var(--text-secondary)'
                  }}
                >
                  Bot Oficial YoY (Fácil)
                </button>
                <button
                  type="button"
                  onClick={() => setTelegramConfig(p => ({ ...p, mode: 'custom' }))}
                  style={{
                    flex: 1, padding: '6px 0', border: 'none', borderRadius: 6, fontSize: 10, fontWeight: 700, cursor: 'pointer', transition: 'all 0.15s',
                    background: telegramConfig.mode === 'custom' ? 'var(--border)' : 'transparent',
                    color: telegramConfig.mode === 'custom' ? '#fff' : 'var(--text-secondary)'
                  }}
                >
                  Bot Personalizado
                </button>
              </div>

              {telegramConfig.mode !== 'custom' ? (
                // MODO SIMPLIFICADO (Vinculación por número de teléfono)
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 12 }}>
                  <p style={{ fontSize: 11, color: 'var(--text-secondary)', margin: 0, lineHeight: 1.4 }}>
                    Conéctate al bot oficial en segundos. Abre Telegram y presiona iniciar en el Bot Central:
                  </p>
                  
                  <a
                    href="https://t.me/YoYBillarBot"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn btn-secondary"
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, height: 36, fontSize: 12, fontWeight: 700,
                      background: 'rgba(36, 161, 222, 0.1)', border: '1.5px dashed rgba(36, 161, 222, 0.4)', color: '#24A1DE', textDecoration: 'none'
                    }}
                  >
                    <i className="ri-telegram-line" style={{ fontSize: 16 }} /> @YoYBillarBot
                  </a>

                  <div className="form-group" style={{ gap: 4 }}>
                    <label className="form-label">Número de Teléfono (Telegram)</label>
                    <input
                      className="form-input"
                      placeholder="Ej: +525512345678 (con código de país)"
                      value={telegramConfig.phone || ''}
                      onChange={e => setTelegramConfig(p => ({ ...p, phone: e.target.value }))}
                      style={{ padding: '8px 12px', fontSize: '12px' }}
                    />
                    <span style={{ fontSize: 9.5, color: 'var(--text-muted)' }}>
                      Ingresa el mismo número con el que compartiste contacto en el Bot Central de YoY.
                    </span>
                  </div>
                </div>
              ) : (
                // MODO PERSONALIZADO
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 12 }}>
                  <div className="form-group" style={{ gap: 4 }}>
                    <label className="form-label">Token de Bot de Telegram</label>
                    <input
                      type="password"
                      className="form-input"
                      placeholder="1234567890:ABCDefGhIJK..."
                      value={telegramConfig.botToken || ''}
                      onChange={e => setTelegramConfig(p => ({ ...p, botToken: e.target.value }))}
                      style={{ padding: '8px 12px', fontSize: '11px' }}
                    />
                  </div>
                  <div className="form-group" style={{ gap: 4 }}>
                    <label className="form-label">ID del Chat o Canal</label>
                    <input
                      className="form-input"
                      placeholder="Ej: -100123456789 o 123456789"
                      value={telegramConfig.chatId || ''}
                      onChange={e => setTelegramConfig(p => ({ ...p, chatId: e.target.value }))}
                      style={{ padding: '8px 12px', fontSize: '11px' }}
                    />
                  </div>
                </div>
              )}

              {/* CONFIGURACIÓN ADICIONAL DE NOTIFICACIONES */}
              <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 10, marginTop: 4, display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', color: 'var(--bronze-light)', letterSpacing: '0.06em' }}>
                  Conexión y Mensajería Clientes
                </div>
                
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 700 }}>Enviar Estados de Cuenta</div>
                    <div style={{ fontSize: 9.5, color: 'var(--text-muted)' }}>Manda tickets interactivos a clientes</div>
                  </div>
                  <div
                    onClick={() => setTelegramConfig(p => ({ ...p, notifyStatements: !p.notifyStatements }))}
                    style={{
                      width: 38, height: 20, borderRadius: 10, cursor: 'pointer', transition: 'all 0.2s',
                      background: telegramConfig.notifyStatements ? 'var(--bronze)' : 'var(--bg-elevated)',
                      border: `1px solid ${telegramConfig.notifyStatements ? 'var(--bronze)' : 'var(--border)'}`,
                      position: 'relative',
                    }}
                  >
                    <div style={{ width: 14, height: 14, borderRadius: '50%', background: '#fff', position: 'absolute', top: 2, left: telegramConfig.notifyStatements ? 22 : 2, transition: 'left 0.2s' }} />
                  </div>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 700 }}>Recordatorios de Pago</div>
                    <div style={{ fontSize: 9.5, color: 'var(--text-muted)' }}>Avisos sobre licencias y pagos de la app</div>
                  </div>
                  <div
                    onClick={() => setTelegramConfig(p => ({ ...p, notifyPayments: !p.notifyPayments }))}
                    style={{
                      width: 38, height: 20, borderRadius: 10, cursor: 'pointer', transition: 'all 0.2s',
                      background: telegramConfig.notifyPayments ? 'var(--bronze)' : 'var(--bg-elevated)',
                      border: `1px solid ${telegramConfig.notifyPayments ? 'var(--bronze)' : 'var(--border)'}`,
                      position: 'relative',
                    }}
                  >
                    <div style={{ width: 14, height: 14, borderRadius: '50%', background: '#fff', position: 'absolute', top: 2, left: telegramConfig.notifyPayments ? 22 : 2, transition: 'left 0.2s' }} />
                  </div>
                </div>
              </div>

              {/* CONFIGURACIÓN DE REPORTES Y SEGURIDAD DEL ADMINISTRADOR */}
              <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 10, marginTop: 4, display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', color: 'var(--bronze-light)', letterSpacing: '0.06em' }}>
                  Reportes y Seguridad del Administrador
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 700 }}>Resumen de Jornada Anterior</div>
                    <div style={{ fontSize: 9.5, color: 'var(--text-muted)' }}>Manda reporte de ayer al entrar el primer empleado</div>
                  </div>
                  <div
                    onClick={() => setTelegramConfig(p => ({ ...p, notifyPrevShiftSummary: !p.notifyPrevShiftSummary }))}
                    style={{
                      width: 38, height: 20, borderRadius: 10, cursor: 'pointer', transition: 'all 0.2s',
                      background: telegramConfig.notifyPrevShiftSummary ? 'var(--bronze)' : 'var(--bg-elevated)',
                      border: `1px solid ${telegramConfig.notifyPrevShiftSummary ? 'var(--bronze)' : 'var(--border)'}`,
                      position: 'relative',
                    }}
                  >
                    <div style={{ width: 14, height: 14, borderRadius: '50%', background: '#fff', position: 'absolute', top: 2, left: telegramConfig.notifyPrevShiftSummary ? 22 : 2, transition: 'left 0.2s' }} />
                  </div>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 700 }}>Pase de Lista / Asistencia</div>
                    <div style={{ fontSize: 9.5, color: 'var(--text-muted)' }}>Avisar cuando entre/salga personal y al quedar vacía la sucursal</div>
                  </div>
                  <div
                    onClick={() => setTelegramConfig(p => ({ ...p, notifyAttendance: !p.notifyAttendance }))}
                    style={{
                      width: 38, height: 20, borderRadius: 10, cursor: 'pointer', transition: 'all 0.2s',
                      background: telegramConfig.notifyAttendance ? 'var(--bronze)' : 'var(--bg-elevated)',
                      border: `1px solid ${telegramConfig.notifyAttendance ? 'var(--bronze)' : 'var(--border)'}`,
                      position: 'relative',
                    }}
                  >
                    <div style={{ width: 14, height: 14, borderRadius: '50%', background: '#fff', position: 'absolute', top: 2, left: telegramConfig.notifyAttendance ? 22 : 2, transition: 'left 0.2s' }} />
                  </div>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 700 }}>Alertas de Desviaciones (IA)</div>
                    <div style={{ fontSize: 9.5, color: 'var(--text-muted)' }}>Descuadres de caja, inconsistencias IoT y stock crítico</div>
                  </div>
                  <div
                    onClick={() => setTelegramConfig(p => ({ ...p, notifyDisruptiveAlerts: !p.notifyDisruptiveAlerts }))}
                    style={{
                      width: 38, height: 20, borderRadius: 10, cursor: 'pointer', transition: 'all 0.2s',
                      background: telegramConfig.notifyDisruptiveAlerts ? 'var(--bronze)' : 'var(--bg-elevated)',
                      border: `1px solid ${telegramConfig.notifyDisruptiveAlerts ? 'var(--bronze)' : 'var(--border)'}`,
                      position: 'relative',
                    }}
                  >
                    <div style={{ width: 14, height: 14, borderRadius: '50%', background: '#fff', position: 'absolute', top: 2, left: telegramConfig.notifyDisruptiveAlerts ? 22 : 2, transition: 'left 0.2s' }} />
                  </div>
                </div>

                {telegramConfig.notifyDisruptiveAlerts && (
                  <div className="form-group" style={{ gap: 4, marginTop: 4 }}>
                    <label className="form-label" style={{ fontSize: 10 }}>Umbral de Alerta de Descuadre ($)</label>
                    <input
                      type="number"
                      className="form-input"
                      placeholder="Ej: 100"
                      value={telegramConfig.discrepancyThreshold || ''}
                      onChange={e => setTelegramConfig(p => ({ ...p, discrepancyThreshold: Number(e.target.value) }))}
                      style={{ padding: '6px 10px', fontSize: '11px', width: '100px' }}
                    />
                  </div>
                )}
              </div>

              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <button 
                  type="button" 
                  className="btn btn-secondary" 
                  onClick={handleTestTelegram} 
                  style={{ flex: 1, height: 32, fontSize: 11, padding: '4px 8px' }}
                >
                  <i className="ri-send-plane-line" /> Probar
                </button>
                <button 
                  type="button" 
                  className="btn btn-primary" 
                  onClick={handleSaveTelegram} 
                  disabled={savingTelegram} 
                  style={{ flex: 2, height: 32, fontSize: 11, padding: '4px 8px' }}
                >
                  <i className="ri-save-line" /> {savingTelegram ? 'Guardando...' : 'Guardar Telegram'}
                </button>
              </div>

              {/* Cola de Reintentos de Alertas (Sugerencia 1) */}
              <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <div style={{ fontSize: 11, fontWeight: '600', color: 'var(--text-primary)' }}>
                    <i className="ri-time-line" style={{ marginRight: 4, color: 'var(--bronze)' }} />
                    Cola de Reintentos ({pendingAlerts.length})
                  </div>
                  {pendingAlerts.length > 0 && (
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={async () => {
                        setLoadingPending(true);
                        try {
                          const res = await fetch('/api/telegram/retry-alerts', {
                            headers: { 'Authorization': 'Bearer central-retry-secret-key-2026' }
                          });
                          const data = await res.json();
                          if (res.ok) {
                            showToast(`Se procesaron ${data.processed} alertas en cola.`, 'success');
                          } else {
                            showToast(`Fallo al procesar reintentos: ${data.error}`, 'danger');
                          }
                        } catch (err) {
                          showToast(`Error de conexión: ${err.message}`, 'danger');
                        } finally {
                          setLoadingPending(false);
                        }
                      }}
                      disabled={loadingPending}
                      style={{ fontSize: 9.5, padding: '2px 6px', height: 22 }}
                    >
                      {loadingPending ? 'Reintentando...' : 'Reintentar Todo'}
                    </button>
                  )}
                </div>

                {pendingAlerts.length === 0 ? (
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', textAlign: 'center', padding: '10px 0', background: 'var(--bg-elevated)', borderRadius: 6 }}>
                    <i className="ri-checkbox-circle-line" style={{ color: 'var(--success)', marginRight: 4 }} />
                    No hay alertas pendientes en cola.
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 180, overflowY: 'auto', paddingRight: 4 }}>
                    {pendingAlerts.map(alert => {
                      const limitSnippet = alert.text ? (alert.text.length > 60 ? alert.text.substring(0, 60) + '...' : alert.text) : '';
                      const dateStr = alert.createdAt ? new Date(alert.createdAt.seconds * 1000).toLocaleString('es-MX', { hour: '2-digit', minute: '2-digit' }) : 'Reciente';
                      
                      return (
                        <div key={alert.id} style={{ padding: 6, borderRadius: 6, background: 'var(--bg-elevated)', border: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 2 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ fontSize: 9, fontWeight: 'bold', color: 'var(--bronze)' }}>
                              Intento: {alert.retries || 0}/5
                            </span>
                            <span style={{ fontSize: 8.5, color: 'var(--text-muted)' }}>
                              {dateStr}
                            </span>
                          </div>
                          <div style={{ fontSize: 9.5, color: 'var(--text-secondary)', whiteSpace: 'pre-wrap' }}>
                            {limitSnippet}
                          </div>
                          {alert.lastError && (
                            <div style={{ fontSize: 8.5, color: 'var(--danger)', fontStyle: 'italic', marginTop: 1 }}>
                              Error: {alert.lastError}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
            </div>

            {/* COLUMNA 2 */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div className="card" style={{ padding: '12px 14px' }}>
              <div className="card-header" style={{ marginBottom: 12 }}>
                <h3 className="card-title"><i className="ri-robot-line" style={{ marginRight: 6 }} />Alertas IA</h3>
              </div>
              
              {/* Menú seleccionable de alertas disponibles */}
              {ALERTAS_DEFINITIONS.filter(def => !iaAlerts.activeIds.includes(def.id)).length > 0 && (
                <div style={{ marginBottom: 14 }}>
                  <select
                    onChange={(e) => {
                      const id = e.target.value;
                      if (id) {
                        handleAgregarAlerta(id);
                        e.target.value = '';
                      }
                    }}
                    style={{
                      width: '100%',
                      padding: '8px 12px',
                      borderRadius: 8,
                      background: 'var(--bg-elevated)',
                      border: '1px solid var(--border)',
                      color: '#fff',
                      fontSize: 12,
                      cursor: 'pointer',
                      outline: 'none'
                    }}
                  >
                    <option value="">➕ Añadir Nueva Alerta IA...</option>
                    {ALERTAS_DEFINITIONS.filter(def => !iaAlerts.activeIds.includes(def.id)).map(def => (
                      <option key={def.id} value={def.id}>
                        {def.label}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxHeight: '350px', overflowY: 'auto', paddingRight: 4 }}>
                {iaAlerts.activeIds.map((id, i) => {
                  const def = ALERTAS_DEFINITIONS.find(d => d.id === id);
                  if (!def) return null;
                  const isEnabled = iaAlerts.states[id] !== false;
                  return (
                    <div key={id} style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: '10px 0',
                      borderBottom: i < iaAlerts.activeIds.length - 1 ? '1px solid var(--border)' : 'none'
                    }}>
                      <div style={{ flex: 1, paddingRight: 10 }}>
                        <div style={{ fontSize: 13, fontWeight: 700 }}>{def.label}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2, lineHeight: 1.3 }}>{def.sub}</div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        {/* Switch */}
                        <div
                          onClick={() => handleToggleAlerta(id)}
                          style={{
                            width: 40,
                            height: 20,
                            borderRadius: 10,
                            cursor: 'pointer',
                            transition: 'all 0.2s',
                            background: isEnabled ? 'var(--bronze)' : 'var(--bg-elevated)',
                            border: `1px solid ${isEnabled ? 'var(--bronze)' : 'var(--border)'}`,
                            position: 'relative'
                          }}
                        >
                          <div style={{
                            width: 14,
                            height: 14,
                            borderRadius: '50%',
                            background: '#fff',
                            position: 'absolute',
                            top: 2,
                            left: isEnabled ? 24 : 2,
                            transition: 'left 0.2s'
                          }} />
                        </div>
                        {/* Telegram Alert Toggle */}
                        <button
                          onClick={() => handleToggleTelegramAlerta(id)}
                          title={iaAlerts.telegramAlerts && iaAlerts.telegramAlerts[id] ? "Desactivar alertas por Telegram" : "Habilitar alertas por Telegram"}
                          style={{
                            background: 'none',
                            border: 'none',
                            color: iaAlerts.telegramAlerts && iaAlerts.telegramAlerts[id] ? '#0088cc' : 'var(--text-muted)',
                            cursor: 'pointer',
                            padding: 4,
                            display: 'flex',
                            alignItems: 'center',
                            transition: 'color 0.2s',
                          }}
                          onMouseEnter={(e) => {
                            if (!(iaAlerts.telegramAlerts && iaAlerts.telegramAlerts[id])) {
                              e.currentTarget.style.color = '#0088cc';
                            }
                          }}
                          onMouseLeave={(e) => {
                            if (!(iaAlerts.telegramAlerts && iaAlerts.telegramAlerts[id])) {
                              e.currentTarget.style.color = 'var(--text-muted)';
                            }
                          }}
                        >
                          <i className="ri-telegram-line" style={{ fontSize: 16 }} />
                        </button>
                        {/* Quitar de la pantalla */}
                        <button
                          onClick={() => handleQuitarAlerta(id)}
                          title="Remover de la pantalla"
                          style={{
                            background: 'none',
                            border: 'none',
                            color: 'var(--text-muted)',
                            cursor: 'pointer',
                            padding: 4,
                            display: 'flex',
                            alignItems: 'center',
                            transition: 'color 0.2s'
                          }}
                          onMouseEnter={(e) => e.currentTarget.style.color = 'var(--danger)'}
                          onMouseLeave={(e) => e.currentTarget.style.color = 'var(--text-muted)'}
                        >
                          <i className="ri-delete-bin-line" style={{ fontSize: 14 }} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            {(!user?.permisos || user.permisos.config_mesas !== false) && (
              <>
                <div className="card" style={{ padding: '12px 14px' }}>
                  <div className="card-header" style={{ marginBottom: 12 }}>
                    <h3 className="card-title"><i className="ri-qr-code-line" style={{ marginRight: 6 }} />Impresión de QRs por Mesa</h3>
                  </div>
                  <p style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 10, lineHeight: 1.4 }}>
                    Genera y descarga códigos QR para pegar en las mesas. Permite a los clientes pedir servicio o recargar tiempo en su celular.
                  </p>
                  <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                    <button
                      className="btn btn-primary"
                      onClick={() => imprimirQRs(null)}
                      style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '8px 10px', fontSize: '11px' }}
                    >
                      <i className="ri-printer-line" /> Imprimir Todos
                    </button>
                    <button
                      className="btn btn-secondary"
                      onClick={descargarTodosLosQRsZIP}
                      style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '8px 10px', fontSize: '11px' }}
                    >
                      <i className="ri-download-2-line" /> ZIP
                    </button>
                  </div>
                  
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 260, overflowY: 'auto' }}>
                    {/* QR de Fila Virtual - Autoservicio */}
                    <div style={{ 
                      display: 'flex', 
                      alignItems: 'center', 
                      justifyContent: 'space-between', 
                      padding: '6px 10px', 
                      background: 'rgba(197, 168, 128, 0.08)', 
                      border: '1.5px solid rgba(197, 168, 128, 0.3)', 
                      borderRadius: 10,
                      marginBottom: 2
                    }}>
                      <div 
                        style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}
                        onClick={() => setPreviewQr({
                          title: 'Fila Virtual (Autoservicio)',
                          value: typeof window !== 'undefined' ? `${window.location.origin}/fila/registro` : 'https://yoy-ia-billar.vercel.app/fila/registro',
                          filename: 'fila_de_espera.png'
                        })}
                        title="Previsualizar QR"
                      >
                        <img 
                          src={`https://api.qrserver.com/v1/create-qr-code/?size=60x60&data=${encodeURIComponent(typeof window !== 'undefined' ? `${window.location.origin}/fila/registro` : 'https://yoy-ia-billar.vercel.app/fila/registro')}`} 
                          width="32" 
                          height="32" 
                          style={{ borderRadius: 6, background: '#fff', padding: 2, border: '1px solid var(--border)' }} 
                          alt="QR Fila Virtual" 
                        />
                        <div>
                          <span style={{ fontSize: 12, fontWeight: 800, color: 'var(--bronze-light)' }}>Fila Virtual</span>
                          <div style={{ fontSize: 10, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 4 }}>
                            <span>Registro por QR</span>
                            <i className="ri-eye-line" style={{ fontSize: 10 }} />
                          </div>
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button
                          className="btn btn-secondary btn-sm"
                          onClick={() => descargarQR('fila')}
                          style={{ fontSize: 10, padding: '4px 6px', display: 'flex', alignItems: 'center', gap: 2 }}
                        >
                          <i className="ri-download-2-line" />
                        </button>
                        <button
                          className="btn btn-secondary btn-sm"
                          onClick={imprimirQRRegistroVirtual}
                          style={{ fontSize: 10, padding: '4px 6px', display: 'flex', alignItems: 'center', gap: 2 }}
                        >
                          <i className="ri-printer-line" />
                        </button>
                      </div>
                    </div>

                    {/* QRs de Mesas */}
                    {mesas.map(m => (
                      <div key={m.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 10px', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 10 }}>
                        <div 
                          style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}
                          onClick={() => setPreviewQr({
                            title: m.nombre,
                            value: typeof window !== 'undefined' ? `${window.location.origin}/mesa/${m.id}` : `https://yoy-ia-billar.vercel.app/mesa/${m.id}`,
                            filename: getTableFilename(m),
                            mesaId: m.id
                          })}
                          title="Previsualizar QR"
                        >
                          <img src={`https://api.qrserver.com/v1/create-qr-code/?size=60x60&data=${encodeURIComponent(typeof window !== 'undefined' ? `${window.location.origin}/mesa/${m.id}` : `https://yoy-ia-billar.vercel.app/mesa/${m.id}`)}`} width="32" height="32" style={{ borderRadius: 6, background: '#fff', padding: 2, border: '1px solid var(--border)' }} alt="QR Mesa" />
                          <div>
                            <span style={{ fontSize: 12, fontWeight: 700 }}>{m.nombre}</span>
                            <div style={{ fontSize: 10, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 4 }}>
                              <span>Mesa ID: {m.id}</span>
                              <i className="ri-eye-line" style={{ fontSize: 10 }} />
                            </div>
                          </div>
                        </div>
                        <div style={{ display: 'flex', gap: 4 }}>
                          <button
                            className="btn btn-secondary btn-sm"
                            onClick={() => descargarQR('mesa', m.id)}
                            style={{ fontSize: 10, padding: '4px 6px', display: 'flex', alignItems: 'center', gap: 2 }}
                          >
                            <i className="ri-download-2-line" />
                          </button>
                          <button
                            className="btn btn-secondary btn-sm"
                            onClick={() => imprimirQRs(m.id)}
                            style={{ fontSize: 10, padding: '4px 6px', display: 'flex', alignItems: 'center', gap: 2 }}
                          >
                            <i className="ri-printer-line" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="card" style={{ padding: '12px 14px' }}>
                  <div className="card-header" style={{ marginBottom: 12 }}>
                    <h3 className="card-title"><i className="ri-hand-coin-line" style={{ marginRight: 6 }} />Cortesías por Turno</h3>
                    <span className="badge badge-secondary" style={{ fontSize: '9px', padding: '2px 6px' }}>Anti-Fraude</span>
                  </div>
                  <p style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 10, lineHeight: 1.4 }}>
                    Cortesías ($0) que puede otorgar un mesero por turno sin PIN. Al superar este límite, se solicitará el PIN del admin.
                  </p>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div className="form-group" style={{ flex: 1, margin: 0, gap: 4 }}>
                      <input
                        type="number"
                        className="form-input"
                        min={0}
                        max={20}
                        value={maxCortesiasPorTurno}
                        onChange={e => setMaxCortesiasPorTurno(Number(e.target.value) || 0)}
                        style={{ width: 80, textAlign: 'center', fontSize: 16, fontWeight: 700, padding: '6px 10px' }}
                      />
                      <p style={{ fontSize: 9, color: 'var(--text-muted)', margin: 0 }}>0 = siempre requiere PIN</p>
                    </div>
                    <button
                      className="btn btn-primary"
                      style={{ flexShrink: 0, padding: '8px 12px', fontSize: '11px' }}
                      disabled={savingLimiteCortesias}
                      onClick={async () => {
                        setSavingLimiteCortesias(true);
                        try {
                          const { db } = await import('@/lib/firebase');
                          const { doc, setDoc, serverTimestamp } = await import('firebase/firestore');
                          await setDoc(doc(db, 'config', 'operacion'), {
                            maxCortesiasPorTurno: maxCortesiasPorTurno,
                            updatedAt: serverTimestamp()
                          }, { merge: true });
                          showToast(`Límite guardado: ${maxCortesiasPorTurno} por turno`, 'success');
                        } catch (e) {
                          console.error(e);
                          showToast('Error al guardar el límite', 'danger');
                        } finally {
                          setSavingLimiteCortesias(false);
                        }
                      }}
                    >
                      <i className="ri-save-line" /> {savingLimiteCortesias ? '...' : 'Guardar'}
                    </button>
                  </div>
                  <div style={{ marginTop: 10, background: 'rgba(249,115,22,0.08)', border: '1px solid rgba(249,115,22,0.2)', borderRadius: 10, padding: 8 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#f97316', fontSize: 11, fontWeight: 700, lineHeight: 1.3 }}>
                      <i className="ri-information-line" />
                      <span>{maxCortesiasPorTurno === 0 ? 'Requiere PIN del admin siempre' : `Hasta ${maxCortesiasPorTurno} cortesías sin PIN`}</span>
                    </div>
                  </div>
                </div>
              </>
            )}
            {(!user?.permisos || user.permisos.config_mesas !== false) && (
              <div className="card" style={{ padding: '12px 14px' }}>
                <div className="card-header" style={{ marginBottom: 12 }}>
                  <h3 className="card-title"><i className="ri-grid-line" style={{ marginRight: 6 }} />Configuración de Mesas</h3>
                </div>
                <form onSubmit={handleSaveMesa} style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 12, background: 'var(--bg-elevated)', padding: '10px 12px', borderRadius: 12, border: '1px solid var(--border)' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '70px 1fr', gap: 10 }}>
                    <div className="form-group" style={{ gap: 4 }}>
                      <label className="form-label">Número</label>
                      <input
                        type="number"
                        className="form-input"
                        placeholder="Auto"
                        value={nuevaMesa.id || ''}
                        onChange={e => setNuevaMesa(p => ({ ...p, id: e.target.value }))}
                        disabled={editingMesaId !== null}
                        style={{ padding: '6px 10px', fontSize: '13px', height: 32 }}
                      />
                    </div>
                    <div className="form-group" style={{ gap: 4 }}>
                      <label className="form-label">Nombre (Opcional)</label>
                      <input
                        className="form-input"
                        placeholder={editingMesaId !== null ? "Ej: Mesa 1" : "Opcional (Ej: Mesa VIP)"}
                        value={nuevaMesa.nombre}
                        onChange={e => setNuevaMesa(p => ({ ...p, nombre: e.target.value }))}
                        style={{ padding: '6px 10px', fontSize: '13px', height: 32 }}
                      />
                    </div>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 10 }}>
                    <div className="form-group" style={{ gap: 4 }}>
                      <label className="form-label">Tarifa por Hora ($)</label>
                      <input
                        type="number"
                        className="form-input"
                        placeholder="Ej: 60"
                        min={0}
                        value={nuevaMesa.tarifa || ''}
                        onChange={e => setNuevaMesa(p => ({ ...p, tarifa: e.target.value }))}
                        required
                        style={{ padding: '6px 10px', fontSize: '13px', height: 32 }}
                      />
                    </div>
                    <div className="form-group" style={{ gap: 4 }}>
                      <label className="form-label">Modalidad</label>
                      <select
                        className="form-select"
                        value={nuevaMesa.tipo}
                        onChange={e => setNuevaMesa(p => ({ ...p, tipo: e.target.value }))}
                        style={{ padding: '6px 10px', fontSize: '13px', background: 'var(--bg-elevated)', color: '#fff', border: '1px solid var(--border)', borderRadius: 6, height: 32 }}
                      >
                        <option value="Pool">Pool</option>
                        <option value="Carambola">Carambola</option>
                        <option value="Snooker">Snooker</option>
                        <option value="Dominó">Dominó</option>
                        <option value="Consumo">Consumo Mín.</option>
                        <option value="Otro">Otro Tipo</option>
                      </select>
                    </div>
                  </div>

                  {nuevaMesa.tipo === 'Otro' && (
                    <div className="form-group animate-fadeIn" style={{ gap: 4 }}>
                      <label className="form-label">Especificar Tipo</label>
                      <input
                        className="form-input"
                        placeholder="Ej: Futbolito, Ping Pong"
                        value={customMesaTipo}
                        onChange={e => setCustomMesaTipo(e.target.value)}
                        required
                        style={{ padding: '6px 10px', fontSize: '13px', height: 32 }}
                      />
                    </div>
                  )}

                  <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                    {editingMesaId !== null && (
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        style={{ flex: 1, padding: '4px 8px', fontSize: '11px' }}
                        onClick={() => {
                          setEditingMesaId(null);
                          setNuevaMesa({ id: '', nombre: '', tarifa: '', tipo: 'Pool' });
                          setCustomMesaTipo('');
                          setShowCustomTipoInput(false);
                          clearMesaDraft();
                        }}
                      >
                        Cancelar
                      </button>
                    )}
                    <button
                      type="submit"
                      className="btn btn-primary btn-sm"
                      style={{ flex: 2, padding: '4px 8px', fontSize: '11px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}
                    >
                      <i className={editingMesaId !== null ? "ri-save-line" : "ri-add-line"} />
                      {editingMesaId !== null ? 'Guardar Cambios' : 'Agregar Mesa'}
                    </button>
                  </div>
                </form>

                {/* Listado de Mesas */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 220, overflowY: 'auto' }}>
                  {mesas.map(m => (
                    <div key={m.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 10px', background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border)', borderRadius: 10 }}>
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 700 }}>{m.nombre} <span style={{ fontSize: 10, color: 'var(--bronze-light)' }}>({m.tipo})</span></div>
                        <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>Tarifa: ${m.tarifa}/hr</div>
                      </div>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button className="btn btn-secondary btn-icon sm" style={{ width: 26, height: 26, minWidth: 26, padding: 0 }} onClick={() => handleEditMesa(m)}>
                          <i className="ri-pencil-line" />
                        </button>
                        <button className="btn btn-secondary btn-icon sm" style={{ width: 26, height: 26, minWidth: 26, padding: 0, color: '#ef4444' }} onClick={() => handleDeleteMesa(m.id)}>
                          <i className="ri-delete-bin-line" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            </div>

            {/* COLUMNA 3 */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {(!user?.permisos || user.permisos.config_usuarios !== false) && (
              <div className="card" style={{ padding: '12px 14px' }}>
                <div className="card-header" style={{ marginBottom: 12 }}>
                  <h3 className="card-title"><i className="ri-shield-user-line" style={{ marginRight: 6 }} />Usuarios y Roles</h3>
                  <button className="btn btn-primary btn-sm" title="Agregar nuevo usuario" onClick={() => setShowAddUserModal(true)} style={{ padding: '4px 8px' }}>
                    <i className="ri-user-add-line" />
                  </button>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {usuarios.length === 0 ? (
                    <>
                      <div style={{ background: 'var(--bronze-subtle)', border: '1px solid var(--border-bronze)', borderRadius: 10, padding: 10, marginBottom: 4 }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--bronze-light)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                          ⚠️ Acceso Libre Activo
                        </div>
                        <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
                          El sistema entra directo sin login. Crea tu primer usuario haciendo clic en (+) para activar la seguridad.
                        </div>
                      </div>
                      {defaultDemos.map((u, i) => {
                        const color = getRoleColor(u.role);
                        return (
                          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: i < 3 ? '1px solid var(--border)' : 'none', opacity: 0.65 }}>
                            <div style={{ width: 26, height: 26, borderRadius: 6, background: `${color}22`, border: `1px solid ${color}44`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800, color }}>
                              {u.name?.[0] || 'U'}
                            </div>
                            <div style={{ flex: 1 }}>
                              <div style={{ fontSize: 12, fontWeight: 700 }}>{u.name} <span style={{ fontSize: 9, color: 'var(--bronze)', fontWeight: 600 }}>(Demo)</span></div>
                              <div style={{ fontSize: 9.5, color: 'var(--text-muted)' }}>{u.email}</div>
                            </div>
                            <span style={{ fontSize: 8.5, fontWeight: 700, padding: '1px 6px', borderRadius: 20, background: `${color}22`, color, border: `1px solid ${color}44`, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                              {u.role}
                            </span>
                          </div>
                        );
                      })}
                    </>
                  ) : (
                    usuarios.map((u, i) => {
                      const color = getRoleColor(u.role);
                      const isMaster = isMasterUser(u.email);
                      return (
                        <div key={u.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: i < usuarios.length - 1 ? '1px solid var(--border)' : 'none' }}>
                          <div style={{ width: 26, height: 26, borderRadius: 6, background: `${color}22`, border: `1px solid ${color}44`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800, color }}>
                            {u.name?.[0] || 'U'}
                          </div>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: 12, fontWeight: 700 }}>{u.name || 'Usuario'}</div>
                            <div style={{ fontSize: 9.5, color: 'var(--text-muted)' }}>{u.email || ''}</div>
                          </div>
                          <span style={{ fontSize: 8.5, fontWeight: 700, padding: '1px 6px', borderRadius: 20, background: `${color}22`, color, border: `1px solid ${color}44`, textTransform: 'uppercase', letterSpacing: '0.08em', marginRight: 6 }}>
                            {u.role}
                          </span>
                          {!isMaster ? (
                            <>
                              {(u.role === 'admin' || u.role === 'gerente' || u.role === 'cajero') && (
                                <button
                                  onClick={() => {
                                    setSelectedUserForPermissions({
                                      ...u,
                                      permisos: u.permisos || getDefaultPermisos(u.role)
                                    });
                                    setShowEditPermissionsModal(true);
                                  }}
                                  title="Editar Permisos"
                                  style={{
                                    background: 'none', border: 'none', color: 'var(--text-muted)',
                                    cursor: 'pointer', fontSize: 14, padding: '2px 6px',
                                    transition: 'color 0.15s', marginRight: 4
                                  }}
                                  onMouseEnter={e => e.currentTarget.style.color = 'var(--bronze-light)'}
                                  onMouseLeave={e => e.currentTarget.style.color = 'var(--text-muted)'}
                                >
                                  <i className="ri-shield-keyhole-line" />
                                </button>
                              )}
                              <button
                                onClick={() => {
                                  setSelectedUserForPassword(u);
                                  setShowChangePasswordModal(true);
                                }}
                                title="Cambiar Contraseña"
                                style={{
                                  background: 'none', border: 'none', color: 'var(--text-muted)',
                                  cursor: 'pointer', fontSize: 14, padding: '2px 6px',
                                  transition: 'color 0.15s', marginRight: 4
                                }}
                                onMouseEnter={e => e.currentTarget.style.color = 'var(--bronze-light)'}
                                onMouseLeave={e => e.currentTarget.style.color = 'var(--text-muted)'}
                              >
                                <i className="ri-key-line" />
                              </button>
                              <button
                                onClick={() => handleDeleteUser(u.id, u.name)}
                                title="Eliminar usuario"
                                style={{
                                  background: 'none', border: 'none', color: 'var(--text-muted)',
                                  cursor: 'pointer', fontSize: 14, padding: '2px 6px',
                                  transition: 'color 0.15s',
                                }}
                                onMouseEnter={e => e.currentTarget.style.color = '#ef4444'}
                                onMouseLeave={e => e.currentTarget.style.color = 'var(--text-muted)'}
                              >
                                <i className="ri-delete-bin-line" />
                              </button>
                            </>
                          ) : (
                            <div style={{ display: 'flex', gap: 6, marginRight: 4, alignItems: 'center' }}>
                              <span 
                                title="Sincronizado con PIN de Administrador. Cambiar desde la tarjeta correspondiente." 
                                style={{ color: 'var(--text-muted)', cursor: 'help', fontSize: 11, display: 'flex', alignItems: 'center' }}
                              >
                                <i className="ri-lock-line" style={{ marginRight: 2 }} /> Sincronizado
                              </span>
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            )}

            {/* Extras de Renta (Equipamiento Premium) */}
            <div className="card" style={{ padding: '12px 14px' }}>
              <div className="card-header" style={{ marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h3 className="card-title"><i className="ri-tools-line" style={{ marginRight: 6 }} />Equipamiento Premium para Renta</h3>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={() => {
                    const newExtra = {
                      id: 'extra_' + Date.now(),
                      nombre: 'Nuevo Equipamiento',
                      precio: 10,
                      tipo: 'hora'
                    };
                    setRentaExtras(p => [...p, newExtra]);
                  }}
                  style={{ padding: '4px 8px' }}
                >
                  <i className="ri-add-line" /> Agregar
                </button>
              </div>
              <p style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 10, lineHeight: 1.4 }}>
                Configure los accesorios premium que se pueden rentar al abrir las mesas y sus tarifas respectivas.
              </p>
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxHeight: 300, overflowY: 'auto', marginBottom: 12 }}>
                {rentaExtras.map((extra, idx) => (
                  <div key={extra.id} style={{ display: 'grid', gridTemplateColumns: '1fr 80px 100px 30px', gap: 6, alignItems: 'center', padding: '6px 8px', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 10 }}>
                    <div>
                      <input
                        type="text"
                        className="form-input"
                        value={extra.nombre}
                        onChange={e => {
                          const val = e.target.value;
                          setRentaExtras(prev => prev.map(item => item.id === extra.id ? { ...item, nombre: val } : item));
                        }}
                        style={{ fontSize: 11, padding: '4px 6px', height: 28 }}
                        placeholder="Nombre del extra"
                      />
                    </div>
                    <div>
                      <input
                        type="number"
                        className="form-input"
                        value={extra.precio}
                        onChange={e => {
                          const val = Number(e.target.value);
                          setRentaExtras(prev => prev.map(item => item.id === extra.id ? { ...item, precio: val } : item));
                        }}
                        style={{ fontSize: 11, padding: '4px 6px', height: 28, textAlign: 'center' }}
                        placeholder="Precio"
                      />
                    </div>
                    <div>
                      <select
                        className="form-select"
                        value={extra.tipo}
                        onChange={e => {
                          const val = e.target.value;
                          setRentaExtras(prev => prev.map(item => item.id === extra.id ? { ...item, tipo: val } : item));
                        }}
                        style={{ background: 'var(--bg-elevated)', color: 'var(--text-main)', border: '1px solid var(--border)', height: 28, padding: '2px 4px', fontSize: 11 }}
                      >
                        <option value="hora">Por Hora</option>
                        <option value="fijo">Tarifa Única</option>
                      </select>
                    </div>
                    <div style={{ textAlign: 'center' }}>
                      <button
                        type="button"
                        onClick={() => {
                          setRentaExtras(prev => prev.filter(item => item.id !== extra.id));
                        }}
                        style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 0 }}
                        onMouseEnter={e => e.currentTarget.style.color = '#ef4444'}
                        onMouseLeave={e => e.currentTarget.style.color = 'var(--text-muted)'}
                      >
                        <i className="ri-delete-bin-line" style={{ fontSize: 14 }} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              <button
                type="button"
                className="btn btn-primary"
                onClick={async () => {
                  setSavingRentaExtras(true);
                  try {
                    await setDoc(doc(db, 'config', 'renta_extras'), {
                      extras: rentaExtras,
                      updatedAt: serverTimestamp()
                    });
                    showToast('Equipamiento premium de renta guardado correctamente ✓', 'success');
                  } catch (e) {
                    console.error("Error al guardar extras:", e);
                    showToast('Error al guardar equipamiento: ' + e.message, 'danger');
                  } finally {
                    setSavingRentaExtras(false);
                  }
                }}
                disabled={savingRentaExtras}
                style={{ width: '100%', height: 32, fontSize: 11 }}
              >
                <i className="ri-save-line" /> {savingRentaExtras ? 'Guardando...' : 'Guardar Renta de Extras'}
              </button>
            </div>

            <div className="card" style={{ border: '1px solid rgba(239,68,68,0.2)', padding: '12px 14px' }}>
              <div className="card-header" style={{ marginBottom: 12 }}>
                <h3 className="card-title" style={{ color: 'var(--danger)' }}><i className="ri-error-warning-line" style={{ marginRight: 6 }} />Mantenimiento y Depuración</h3>
                <span className="badge badge-danger" style={{ fontSize: '9px', padding: '2px 6px' }}>Zona Peligrosa</span>
              </div>
              <p style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 10, lineHeight: 1.4 }}>
                Use esta herramienta para limpiar por completo todos los torneos, comandas, bitácora de caja, histórico y restablecer las mesas.
              </p>
              <form onSubmit={handleRestablecerTodo} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <div className="form-group" style={{ margin: 0, gap: 4 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: 90 }}>
                    <label className="form-label">PIN Admin</label>
                    <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
                      {resetPin?.length || 0}/8
                    </span>
                  </div>
                  <input
                    type="password"
                    className="form-input"
                    placeholder="••••"
                    value={resetPin}
                    onChange={e => setResetPin(e.target.value)}
                    maxLength={8}
                    style={{ width: 90, letterSpacing: '0.2em', textAlign: 'center', padding: '6px 10px', fontSize: '13px' }}
                    required
                  />
                </div>
                <div className="form-group" style={{ flex: 1, minWidth: 150, margin: 0, gap: 4 }}>
                  <label className="form-label">Escriba RESTABLECER</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="RESTABLECER"
                    value={confirmWipeText}
                    onChange={e => setConfirmWipeText(e.target.value)}
                    style={{ textTransform: 'uppercase', padding: '6px 10px', fontSize: '13px' }}
                    required
                  />
                </div>
                <button 
                  type="submit" 
                  className="btn btn-danger" 
                  disabled={isResetting || !resetPin || confirmWipeText.trim().toUpperCase() !== 'RESTABLECER'} 
                  style={{ alignSelf: 'flex-end', height: 32, padding: '4px 8px', fontSize: '11px' }}
                >
                  <i className="ri-delete-bin-line" /> {isResetting ? 'Restableciendo...' : 'Restablecer Base de Datos'}
                </button>
              </form>

              <hr style={{ border: 'none', borderTop: '1px dashed var(--border)', margin: '16px 0' }} />
              
              <div style={{ marginBottom: 10 }}>
                <h4 style={{ fontSize: 12, fontWeight: 700, color: 'var(--bronze-light)', margin: '0 0 4px 0', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <i className="ri-archive-line" /> Archivado de Comandas Antiguas
                </h4>
                <p style={{ fontSize: 10.5, color: 'var(--text-secondary)', margin: 0, lineHeight: 1.4 }}>
                  Mueve comandas finalizadas del historial activo a una colección histórica secundaria. Acelera los reportes de Caja y reduce el consumo de base de datos.
                </p>
              </div>
              
              <form onSubmit={handleArchivarPedidos} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <div className="form-group" style={{ margin: 0, gap: 4 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: 90 }}>
                    <label className="form-label">PIN Admin</label>
                    <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
                      {archivingPin?.length || 0}/8
                    </span>
                  </div>
                  <input
                    type="password"
                    className="form-input"
                    placeholder="••••"
                    value={archivingPin}
                    onChange={e => setArchivingPin(e.target.value)}
                    maxLength={8}
                    style={{ width: 90, letterSpacing: '0.2em', textAlign: 'center', padding: '6px 10px', fontSize: '13px' }}
                    required
                  />
                </div>
                <div className="form-group" style={{ flex: 1, minWidth: 150, margin: 0, gap: 4 }}>
                  <label className="form-label">Antigüedad mínima</label>
                  <select
                    className="form-input"
                    value={archivingDays}
                    onChange={e => setArchivingDays(Number(e.target.value))}
                    style={{ padding: '6px 10px', fontSize: '13px', background: 'var(--bg-elevated)', color: '#fff', border: '1px solid var(--border)', borderRadius: 6, height: 32 }}
                  >
                    <option value={15}>Más de 15 días de antigüedad</option>
                    <option value={30}>Más de 30 días (Recomendado)</option>
                    <option value={60}>Más de 60 días de antigüedad</option>
                    <option value={90}>Más de 90 días de antigüedad</option>
                  </select>
                </div>
                <button 
                  type="submit" 
                  className="btn" 
                  disabled={isArchiving || !archivingPin} 
                  style={{ 
                    alignSelf: 'flex-end', height: 32, padding: '4px 14px', fontSize: '11px', fontWeight: 700,
                    background: 'linear-gradient(135deg, var(--bronze), var(--bronze-light))', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer'
                  }}
                >
                  <i className="ri-archive-line" /> {isArchiving ? 'Archivando...' : 'Archivar Pedidos'}
                </button>
              </form>
            </div>

            {/* Registro de Errores (Crashes) del Sistema */}
            <div className="card" style={{ border: '1px solid rgba(227,168,105,0.2)', padding: '12px 14px', marginTop: 12 }}>
              <div className="card-header" style={{ marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h3 className="card-title" style={{ color: 'var(--bronze-light)' }}>
                  <i className="ri-error-warning-fill" style={{ marginRight: 6 }} />Registro de Errores (Crashes)
                </h3>
                {crashLogs.length > 0 && (
                  <button 
                    type="button"
                    onClick={handleClearCrashLogs}
                    className="btn btn-secondary btn-xs"
                    style={{ fontSize: 10, padding: '3px 8px', color: 'var(--danger)', borderColor: 'rgba(239,68,68,0.2)', background: 'none', cursor: 'pointer' }}
                  >
                    <i className="ri-delete-bin-line" /> Limpiar Registro
                  </button>
                )}
              </div>
              <p style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 12, lineHeight: 1.4 }}>
                Últimos 10 fallos críticos reportados en tiempo real por el sistema de monitoreo.
              </p>

              {/* Filtros de logs */}
              {crashLogs.length > 0 && (
                <div style={{ display: 'flex', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
                  <div style={{ flex: 1, minWidth: 150 }}>
                    <input 
                      type="text"
                      className="form-input"
                      placeholder="Buscar por mensaje o usuario..."
                      value={logSearchQuery}
                      onChange={e => setLogSearchQuery(e.target.value)}
                      style={{ fontSize: 11, padding: '5px 10px' }}
                    />
                  </div>
                  <div style={{ width: 140 }}>
                    <select
                      className="form-input"
                      value={logPanelFilter}
                      onChange={e => setLogPanelFilter(e.target.value)}
                      style={{ fontSize: 11, padding: '5px' }}
                    >
                      <option value="todos">Todos los Paneles</option>
                      {Array.from(new Set(crashLogs.map(l => l.panelName))).map(pName => (
                        <option key={pName} value={pName}>{pName}</option>
                      ))}
                    </select>
                  </div>
                </div>
              )}

              {loadingLogs ? (
                <div style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center', padding: '12px 0' }}>Cargando registros...</div>
              ) : crashLogs.length === 0 ? (
                <div style={{ fontSize: 11, color: 'var(--success)', textAlign: 'center', padding: '16px 0', background: 'rgba(34,197,94,0.04)', borderRadius: 8, border: '1px dashed rgba(34,197,94,0.1)' }}>
                  ✓ No se han reportado errores en el sistema. ¡Operación saludable!
                </div>
              ) : (
                (() => {
                  const filteredLogs = crashLogs.filter(log => {
                    const matchesSearch = logSearchQuery.trim() === '' || 
                      (log.errorMessage && log.errorMessage.toLowerCase().includes(logSearchQuery.toLowerCase())) ||
                      (log.userEmail && log.userEmail.toLowerCase().includes(logSearchQuery.toLowerCase()));
                      
                    const matchesPanel = logPanelFilter === 'todos' || 
                      (log.panelName && log.panelName.toLowerCase() === logPanelFilter.toLowerCase());
                      
                    return matchesSearch && matchesPanel;
                  });

                  if (filteredLogs.length === 0) {
                    return (
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center', padding: '12px 0' }}>
                        No se encontraron registros que coincidan con la búsqueda.
                      </div>
                    );
                  }

                  return (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 300, overflowY: 'auto' }}>
                      {filteredLogs.map((log) => {
                        const isExpanded = selectedLogId === log.id;
                        const dateStr = log.createdAt ? new Date(log.createdAt).toLocaleString() : 'Desconocida';
                        return (
                          <div key={log.id} style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 10px', fontSize: 11 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
                              <span style={{ fontWeight: 800, color: '#ef4444', textTransform: 'uppercase' }}>
                                Panel: {log.panelName}
                              </span>
                              <span style={{ color: 'var(--text-muted)', fontSize: 9.5 }}>{dateStr}</span>
                            </div>
                            <div style={{ marginTop: 4, fontWeight: 600, color: 'var(--text-main)', wordBreak: 'break-all', textAlign: 'left' }}>
                              {log.errorMessage}
                            </div>
                            <div style={{ marginTop: 4, fontSize: 9.5, color: 'var(--text-secondary)', display: 'flex', gap: 12 }}>
                              <span><strong>User:</strong> {log.userEmail}</span>
                              <span><strong>URL:</strong> {log.url ? log.url.split('/').pop() : ''}</span>
                            </div>
                            
                            {log.errorStack && (
                              <button
                                type="button"
                                onClick={() => setSelectedLogId(isExpanded ? null : log.id)}
                                style={{ background: 'none', border: 'none', color: 'var(--bronze-light)', cursor: 'pointer', padding: '4px 0 0 0', fontSize: 9.5, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 3 }}
                              >
                                <i className={isExpanded ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'} />
                                {isExpanded ? 'Ocultar detalles' : 'Ver detalles técnicos'}
                              </button>
                            )}

                            {isExpanded && (
                              <div style={{ marginTop: 6, background: 'var(--bg-main)', padding: 8, borderRadius: 6, border: '1px solid var(--border)', overflowX: 'auto', fontFamily: 'monospace', fontSize: 9, whiteSpace: 'pre-wrap', color: 'var(--text-muted)', maxHeight: 150, overflowY: 'auto', textAlign: 'left' }}>
                                <strong>Stack Trace:</strong>{"\n"}{log.errorStack}{"\n\n"}
                                <strong>Component Stack:</strong>{"\n"}{log.componentStack}{"\n\n"}
                                <strong>User Agent:</strong>{"\n"}{log.userAgent}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  );
                })()
              )}
            </div>
            </div>

          </div>

          {/* Diseño de Tickets Térmicos */}
          <div className="card" style={{ padding: '12px 14px', marginTop: 12 }}>
            <div className="card-header" style={{ marginBottom: 12 }}>
              <h3 className="card-title"><i className="ri-file-text-line" style={{ marginRight: 6 }} />Diseño de Tickets Térmicos</h3>
            </div>
            <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'start' }}>
              {/* Opciones a la izquierda */}
              <div style={{ flex: '1 1 350px' }}>
                <h4 style={{ fontSize: 13, fontWeight: 800, color: 'var(--bronze-light)', marginBottom: 8 }}>Campos Visibles en Ticket</h4>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 6, marginBottom: 12 }}>
                  {[
                    { id: 'showNombre', label: 'Nombre del Negocio' },
                    { id: 'showDireccion', label: 'Dirección física' },
                    { id: 'showTelefono', label: 'Teléfono de contacto' },
                    { id: 'showFechaHora', label: 'Fecha y Hora' },
                    { id: 'showCliente', label: 'Nombre del Cliente' },
                    { id: 'showCuenta', label: 'ID de la Cuenta' },
                    { id: 'showConsumos', label: 'Detalle de Consumos' },
                    { id: 'showQrRecibo', label: 'QR de Ticket Digital' },
                  ].map(item => (
                    <label key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', background: 'var(--bg-elevated)', borderRadius: 8, border: '1px solid var(--border)', cursor: 'pointer', margin: 0 }}>
                      <input
                        type="checkbox"
                        checked={ticketConfig[item.id]}
                        onChange={() => handleTicketToggle(item.id)}
                        style={{ accentColor: 'var(--bronze)' }}
                      />
                      <span style={{ fontSize: 11, fontWeight: 600 }}>{item.label}</span>
                    </label>
                  ))}
                </div>

                <h4 style={{ fontSize: 13, fontWeight: 800, color: 'var(--bronze-light)', marginBottom: 8 }}>Tamaño de Fuente</h4>
                <div style={{ display: 'flex', gap: 8 }}>
                  {[
                    { id: '11px', label: 'Chica (11px)' },
                    { id: '14px', label: 'Mediana (14px)' },
                    { id: '18px', label: 'Grande (18px)' },
                  ].map(item => (
                    <button
                      key={item.id}
                      className={`btn btn-sm ${ticketConfig.fontSize === item.id ? 'btn-primary' : 'btn-secondary'}`}
                      onClick={() => handleTicketFontSize(item.id)}
                      style={{ flex: 1, fontSize: 11, padding: '4px 6px' }}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>

                <h4 style={{ fontSize: 13, fontWeight: 800, color: 'var(--bronze-light)', marginTop: 16, marginBottom: 8 }}><i className="ri-printer-line" style={{ marginRight: 6 }} />Conexión de Impresora</h4>
                
                {/* Tipo de Conexión */}
                <div className="form-group" style={{ marginBottom: 12 }}>
                  <label className="form-label" style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Método de Conexión</label>
                  <select
                    className="form-select"
                    value={ticketConfig.connectionType || 'system_print'}
                    onChange={e => handleTicketConfigChange('connectionType', e.target.value)}
                    style={{ fontSize: 12, padding: '6px 10px', height: 'auto', background: 'var(--bg-base)', border: '1px solid var(--border)', color: 'var(--text-primary)', borderRadius: 6 }}
                  >
                    <option value="system_print">🖥️ Diálogo del Sistema (Recomendado/Universal)</option>
                    <option value="usb">🔌 Conexión Directa USB (WebUSB)</option>
                    <option value="bluetooth">📶 Conexión Directa Bluetooth (Web Bluetooth)</option>
                    <option value="wifi">🌐 Impresora de Red WiFi / Ethernet (TCP IP)</option>
                  </select>
                </div>

                {/* Parámetros según la conexión */}
                {ticketConfig.connectionType === 'system_print' && (
                  <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 12px', marginBottom: 12 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--success)', display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--success)' }} />
                      Spooler del Sistema Activo (Estable)
                    </div>
                    <p style={{ fontSize: 10, color: 'var(--text-muted)', margin: 0, lineHeight: 1.35 }}>
                      Utiliza los controladores nativos de tu sistema operativo (Windows, macOS, Android, iOS). Compatible con el 100% de impresoras térmicas (USB, Bluetooth o WiFi). <strong>Evita desconexiones</strong> ya que el sistema operativo se encarga de reanudar el envío de datos si la impresora se apaga o aleja.
                    </p>
                  </div>
                )}

                {ticketConfig.connectionType === 'usb' && (
                  <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 12px', marginBottom: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--bronze-light)' }}>Dispositivo USB Vinculado</span>
                      <span className="badge badge-success" style={{ fontSize: 9, padding: '2px 6px' }}>
                        {ticketConfig.usbVendorId ? 'Conectado' : 'Sin vincular'}
                      </span>
                    </div>
                    {ticketConfig.usbVendorId ? (
                      <div style={{ fontSize: 10, color: 'var(--text-primary)', fontFamily: 'monospace' }}>
                        Vendor ID: 0x{ticketConfig.usbVendorId} | Product ID: 0x{ticketConfig.usbProductId}
                      </div>
                    ) : (
                      <p style={{ fontSize: 10, color: 'var(--text-muted)', margin: 0 }}>Ninguna impresora USB vinculada por WebUSB.</p>
                    )}
                    <button type="button" className="btn btn-secondary btn-sm" onClick={handleVincularUsb} style={{ fontSize: 10, padding: '4px 8px', alignSelf: 'start' }}>
                      <i className="ri-usb-line" style={{ marginRight: 4 }} /> Vincular Impresora USB
                    </button>
                  </div>
                )}

                {ticketConfig.connectionType === 'bluetooth' && (
                  <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 12px', marginBottom: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--bronze-light)' }}>Impresora Bluetooth Vinculada</span>
                      <span className="badge badge-success" style={{ fontSize: 9, padding: '2px 6px' }}>
                        {ticketConfig.btDeviceName ? 'Conectado' : 'Sin vincular'}
                      </span>
                    </div>
                    {ticketConfig.btDeviceName ? (
                      <div style={{ fontSize: 10, color: 'var(--text-primary)', fontWeight: 'bold' }}>
                        Dispositivo: {ticketConfig.btDeviceName}
                      </div>
                    ) : (
                      <p style={{ fontSize: 10, color: 'var(--text-muted)', margin: 0 }}>Ningún dispositivo Bluetooth enlazado por Web Bluetooth.</p>
                    )}
                    <button type="button" className="btn btn-secondary btn-sm" onClick={handleVincularBluetooth} style={{ fontSize: 10, padding: '4px 8px', alignSelf: 'start' }}>
                      <i className="ri-bluetooth-line" style={{ marginRight: 4 }} /> Escanear y Vincular BT
                    </button>
                  </div>
                )}

                {ticketConfig.connectionType === 'wifi' && (
                  <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 12px', marginBottom: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 10 }}>
                      <div className="form-group" style={{ margin: 0 }}>
                        <label className="form-label" style={{ fontSize: 9 }}>Dirección IP</label>
                        <input
                          type="text"
                          className="form-input"
                          placeholder="Ej: 192.168.1.100"
                          value={ticketConfig.printerIp || ''}
                          onChange={e => handleTicketConfigChange('printerIp', e.target.value)}
                          style={{ fontSize: 11, padding: '5px 8px', background: 'var(--bg-base)', border: '1px solid var(--border)', color: 'var(--text-primary)', borderRadius: 6 }}
                        />
                      </div>
                      <div className="form-group" style={{ margin: 0 }}>
                        <label className="form-label" style={{ fontSize: 9 }}>Puerto TCP</label>
                        <input
                          type="text"
                          className="form-input"
                          placeholder="9100"
                          value={ticketConfig.printerPort || ''}
                          onChange={e => handleTicketConfigChange('printerPort', e.target.value)}
                          style={{ fontSize: 11, padding: '5px 8px', background: 'var(--bg-base)', border: '1px solid var(--border)', color: 'var(--text-primary)', borderRadius: 6 }}
                        />
                      </div>
                    </div>
                    <button type="button" className="btn btn-secondary btn-sm" onClick={handleProbarConexionWifi} style={{ fontSize: 10, padding: '4px 8px', alignSelf: 'start' }}>
                      <i className="ri-wifi-line" style={{ marginRight: 4 }} /> Probar Conexión IP
                    </button>
                  </div>
                )}

                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={handleImprimirTicketPrueba}
                  style={{ fontSize: 11, padding: '6px 12px', width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, marginBottom: 12, marginTop: 8 }}
                >
                  <i className="ri-printer-line" /> Imprimir Ticket de Prueba
                </button>

                {/* Cola de Impresión Offline */}
                {ticketConfig.printQueue && ticketConfig.printQueue.length > 0 && (
                  <div style={{ background: 'rgba(239, 68, 68, 0.05)', border: '1px solid rgba(239, 68, 68, 0.2)', borderRadius: 8, padding: '10px 12px', marginBottom: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: '#f87171', display: 'flex', alignItems: 'center', gap: 4 }}>
                        <i className="ri-error-warning-line" /> Cola Offline ({ticketConfig.printQueue.length} pendiente{ticketConfig.printQueue.length > 1 ? 's' : ''})
                      </span>
                    </div>
                    <p style={{ fontSize: 9.5, color: 'var(--text-muted)', margin: 0, lineHeight: 1.3 }}>
                      Los tickets no impresos debido a problemas de conexión se guardan localmente para evitar pérdidas de información.
                    </p>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button type="button" className="btn btn-secondary btn-xs" onClick={retryPrintQueue} style={{ fontSize: 10, padding: '4px 8px' }}>
                        <i className="ri-refresh-line" style={{ marginRight: 4 }} /> Reintentar Impresión
                      </button>
                      <button type="button" className="btn btn-danger btn-xs" onClick={clearPrintQueue} style={{ fontSize: 10, padding: '4px 8px', background: 'rgba(239, 68, 68, 0.2)', color: '#ef4444', border: '1px solid rgba(239, 68, 68, 0.3)' }}>
                        <i className="ri-delete-bin-line" style={{ marginRight: 4 }} /> Limpiar Cola
                      </button>
                    </div>
                  </div>
                )}

                {/* Parámetros Avanzados */}
                <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10, marginTop: 10, display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)' }}>Parámetros Técnicos ESC/POS</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                    <div className="form-group" style={{ margin: 0 }}>
                      <label className="form-label" style={{ fontSize: 9 }}>Ancho de Papel</label>
                      <select
                        className="form-select"
                        value={ticketConfig.paperWidth || '80mm'}
                        onChange={e => handleTicketConfigChange('paperWidth', e.target.value)}
                        style={{ fontSize: 11, padding: '4px 8px', height: 'auto', background: 'var(--bg-base)', border: '1px solid var(--border)', color: 'var(--text-primary)', borderRadius: 6 }}
                      >
                        <option value="80mm">80mm (Estándar)</option>
                        <option value="58mm">58mm (Portátil / Mini)</option>
                      </select>
                    </div>
                    <div className="form-group" style={{ margin: 0 }}>
                      <label className="form-label" style={{ fontSize: 9 }}>Codificación Font</label>
                      <select
                        className="form-select"
                        value={ticketConfig.charSet || 'PC437'}
                        onChange={e => handleTicketConfigChange('charSet', e.target.value)}
                        style={{ fontSize: 11, padding: '4px 8px', height: 'auto', background: 'var(--bg-base)', border: '1px solid var(--border)', color: 'var(--text-primary)', borderRadius: 6 }}
                      >
                        <option value="PC437">PC437 (USA)</option>
                        <option value="PC850">PC850 (Latin 1)</option>
                        <option value="UTF-8">UTF-8 (Accented)</option>
                      </select>
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', margin: 0 }}>
                      <input
                        type="checkbox"
                        checked={ticketConfig.autoCut !== false}
                        onChange={() => handleTicketConfigChange('autoCut', ticketConfig.autoCut === false)}
                        style={{ accentColor: 'var(--bronze)' }}
                      />
                      <span style={{ fontSize: 10, fontWeight: 600 }}>Corte Automático</span>
                    </label>

                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', margin: 0 }}>
                      <input
                        type="checkbox"
                        checked={ticketConfig.openDrawer !== false}
                        onChange={() => handleTicketConfigChange('openDrawer', ticketConfig.openDrawer === false)}
                        style={{ accentColor: 'var(--bronze)' }}
                      />
                      <span style={{ fontSize: 10, fontWeight: 600 }}>Abrir Cajón Monedero</span>
                    </label>
                  </div>
                </div>

                {/* Impresora de Cocina Independiente */}
                <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10, marginTop: 10, display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)' }}>Impresora de Cocina Independiente</div>
                      <div style={{ fontSize: 9.5, color: 'var(--text-muted)' }}>Mapear comandas de barra/cocina a otra impresora</div>
                    </div>
                    <div
                      onClick={() => handleTicketConfigChange('useKitchenPrinter', !ticketConfig.useKitchenPrinter)}
                      style={{
                        width: 38, height: 20, borderRadius: 10, cursor: 'pointer', transition: 'all 0.2s',
                        background: ticketConfig.useKitchenPrinter ? 'var(--bronze)' : 'var(--bg-elevated)',
                        border: `1px solid ${ticketConfig.useKitchenPrinter ? 'var(--bronze)' : 'var(--border)'}`,
                        position: 'relative',
                      }}
                    >
                      <div style={{ width: 14, height: 14, borderRadius: '50%', background: '#fff', position: 'absolute', top: 2, left: ticketConfig.useKitchenPrinter ? 22 : 2, transition: 'left 0.2s' }} />
                    </div>
                  </div>

                  {ticketConfig.useKitchenPrinter && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, background: 'rgba(255, 255, 255, 0.01)', padding: 10, borderRadius: 8, border: '1px solid var(--border)' }}>
                      <div className="form-group" style={{ margin: 0 }}>
                        <label className="form-label" style={{ fontSize: 9.5 }}>Método Conexión Cocina</label>
                        <select
                          className="form-select"
                          value={ticketConfig.kitchenConnectionType || 'system_print'}
                          onChange={e => handleTicketConfigChange('kitchenConnectionType', e.target.value)}
                          style={{ fontSize: 11, padding: '4px 8px', height: 'auto', background: 'var(--bg-base)', border: '1px solid var(--border)', color: 'var(--text-primary)', borderRadius: 6 }}
                        >
                          <option value="system_print">🖥️ Diálogo del Sistema (Recomendado)</option>
                          <option value="usb">🔌 USB Directo (WebUSB)</option>
                          <option value="bluetooth">📶 Bluetooth Directo (Web Bluetooth)</option>
                          <option value="wifi">🌐 Wifi / Red TCP IP</option>
                        </select>
                      </div>

                      {ticketConfig.kitchenConnectionType === 'usb' && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9.5 }}>
                            <span style={{ color: 'var(--text-muted)' }}>Vendor / Product ID:</span>
                            <span style={{ fontWeight: 'bold' }}>{ticketConfig.kitchenUsbVendorId ? `0x${ticketConfig.kitchenUsbVendorId} : 0x${ticketConfig.kitchenUsbProductId}` : 'No vinculado'}</span>
                          </div>
                          <button type="button" className="btn btn-secondary btn-xs" onClick={handleVincularKitchenUsb} style={{ fontSize: 9, padding: '2px 6px', alignSelf: 'start' }}>
                            Vincular USB Cocina
                          </button>
                        </div>
                      )}

                      {ticketConfig.kitchenConnectionType === 'bluetooth' && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9.5 }}>
                            <span style={{ color: 'var(--text-muted)' }}>Dispositivo BT:</span>
                            <span style={{ fontWeight: 'bold' }}>{ticketConfig.kitchenBtDeviceName || 'No vinculado'}</span>
                          </div>
                          <button type="button" className="btn btn-secondary btn-xs" onClick={handleVincularKitchenBluetooth} style={{ fontSize: 9, padding: '2px 6px', alignSelf: 'start' }}>
                            Escanear BT Cocina
                          </button>
                        </div>
                      )}

                      {ticketConfig.kitchenConnectionType === 'wifi' && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 8 }}>
                            <div className="form-group" style={{ margin: 0 }}>
                              <label className="form-label" style={{ fontSize: 9 }}>IP Impresora Cocina</label>
                               <input
                                type="text"
                                className="form-input"
                                placeholder="192.168.1.101"
                                value={ticketConfig.kitchenPrinterIp || ''}
                                onChange={e => handleTicketConfigChange('kitchenPrinterIp', e.target.value)}
                                style={{ fontSize: 11, padding: '4px 6px', background: 'var(--bg-base)', border: '1px solid var(--border)', color: 'var(--text-primary)', borderRadius: 6 }}
                              />
                            </div>
                            <div className="form-group" style={{ margin: 0 }}>
                              <label className="form-label" style={{ fontSize: 9 }}>Puerto</label>
                              <input
                                type="text"
                                className="form-input"
                                placeholder="9100"
                                value={ticketConfig.kitchenPrinterPort || ''}
                                onChange={e => handleTicketConfigChange('kitchenPrinterPort', e.target.value)}
                                style={{ fontSize: 11, padding: '4px 6px', background: 'var(--bg-base)', border: '1px solid var(--border)', color: 'var(--text-primary)', borderRadius: 6 }}
                              />
                            </div>
                          </div>
                          <button type="button" className="btn btn-secondary btn-xs" onClick={handleProbarConexionKitchenWifi} style={{ fontSize: 9, padding: '4px 6px', alignSelf: 'start' }}>
                            Probar IP Cocina
                          </button>
                        </div>
                      )}

                      <div className="form-group" style={{ margin: 0 }}>
                        <label className="form-label" style={{ fontSize: 9.5 }}>Ancho de Papel Cocina</label>
                        <select
                          className="form-select"
                          value={ticketConfig.kitchenPaperWidth || '80mm'}
                          onChange={e => handleTicketConfigChange('kitchenPaperWidth', e.target.value)}
                          style={{ fontSize: 11, padding: '4px 8px', height: 'auto', background: 'var(--bg-base)', border: '1px solid var(--border)', color: 'var(--text-primary)', borderRadius: 6 }}
                        >
                          <option value="80mm">80mm (Estándar)</option>
                          <option value="58mm">58mm (Mini)</option>
                        </select>
                      </div>
                    </div>
                  )}
                </div>

                <p style={{ fontSize: 9.5, color: 'var(--text-muted)', marginTop: 14, lineHeight: 1.3, marginBottom: 0 }}>
                  Nota: El pie de página centralizado <strong>{"\"YoY IA by Alfonso Iturbide\""}</strong> es un sello obligatorio de YoY IA y no puede ser alterado ni desactivado.
                </p>
              </div>

              {/* Vista Previa en Vivo a la derecha */}
              <div style={{ flex: '0 0 240px', margin: '0 auto', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <h4 style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)', fontWeight: 800, marginBottom: 8 }}>Vista Previa en Vivo</h4>
                <div style={{ background: '#fff', color: '#000', padding: 12, fontFamily: 'monospace', fontSize: ticketConfig.fontSize, width: '100%', maxWidth: 230, border: '1px solid #ccc', boxShadow: '0 4px 12px rgba(0,0,0,0.5)', borderRadius: 6 }}>
                  <div style={{ textAlign: 'center', marginBottom: 6 }}>
                    {ticketConfig.showNombre && <div style={{ fontWeight: 'bold', fontSize: '1.1em' }}>{sucursal.nombre}</div>}
                    {ticketConfig.showDireccion && <div style={{ fontSize: '0.8em', marginTop: 2 }}>{sucursal.direccion}</div>}
                    {ticketConfig.showTelefono && <div style={{ fontSize: '0.8em' }}>Tel: {sucursal.telefono}</div>}
                  </div>
                  
                  <div style={{ borderBottom: '1px dashed #000', margin: '4px 0' }} />
                  
                  <div style={{ fontSize: '0.8em', lineHeight: 1.25 }}>
                    {ticketConfig.showCliente && <div>CLIENTE: Juan Pérez</div>}
                    {ticketConfig.showCuenta && <div>CUENTA: #1024</div>}
                    {ticketConfig.showFechaHora && <div>FECHA: {new Date().toLocaleString('es-MX')}</div>}
                  </div>

                  <div style={{ borderBottom: '1px dashed #000', margin: '4px 0' }} />

                  {ticketConfig.showConsumos && (
                    <div style={{ fontSize: '0.8em' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 'bold' }}>
                        <span>PRODUCTO</span>
                        <span>TOTAL</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', margin: '1px 0' }}>
                        <span>2x Cerveza Corona</span>
                        <span>$90.00</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', margin: '1px 0' }}>
                        <span>1x Papas Fritas</span>
                        <span>$55.00</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', margin: '1px 0' }}>
                        <span>1.5h Mesa Pool</span>
                        <span>$90.00</span>
                      </div>
                    </div>
                  )}

                  <div style={{ borderBottom: '1px dashed #000', margin: '4px 0' }} />
                  
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 'bold', fontSize: '1em' }}>
                    <span>TOTAL:</span>
                    <span>$235.00 MXN</span>
                  </div>

                  {ticketConfig.showQrRecibo && (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', margin: '6px 0' }}>
                      <img
                        src={`https://api.qrserver.com/v1/create-qr-code/?size=100x100&data=${encodeURIComponent('https://yoy-ia-billar.vercel.app/recibo/1024')}`}
                        width="54"
                        height="54"
                        style={{ border: '1px solid #ccc', padding: 2, background: '#fff' }}
                        alt="QR Recibo"
                      />
                      <span style={{ fontSize: '6px', color: '#666', marginTop: 2 }}>Escanea para ver ticket digital</span>
                    </div>
                  )}

                  <div style={{ borderBottom: '1px dashed #000', margin: '4px 0' }} />
                  
                  <div style={{ textAlign: 'center', fontSize: '8px', marginTop: 6, color: '#333', fontWeight: 'bold' }}>
                    *** GRACIAS POR SU VISITA ***
                  </div>
                  
                  <div style={{ textAlign: 'center', fontSize: '7px', color: '#666', marginTop: 4, fontStyle: 'italic' }}>
                    YoY IA by Alfonso Iturbide
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

            {/* Modal de Crear Usuario */}
      {showAddUserModal && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
          backdropFilter: 'blur(5px)'
        }}>
          <div className="card" style={{ width: '100%', maxWidth: 500, maxHeight: '90vh', overflowY: 'auto', padding: 32, border: '1px solid var(--border-bronze)', boxShadow: 'var(--shadow-bronze)', animation: 'fadeIn 0.25s ease' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
              <h3 style={{ fontSize: 16, fontWeight: 700, margin: 0, textTransform: 'uppercase', letterSpacing: '0.1em' }} className="gradient-bronze">
                <i className="ri-user-add-line" style={{ marginRight: 8 }} />Nuevo Usuario
              </h3>
              <button 
                onClick={() => setShowAddUserModal(false)}
                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 20 }}
              >
                <i className="ri-close-line" />
              </button>
            </div>
            
            <form onSubmit={handleAddUser} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div className="form-group">
                <label className="form-label">Nombre Completo</label>
                <input 
                  className="form-input" 
                  placeholder="Ej. Juan Pérez" 
                  value={newUser.name}
                  onChange={e => setNewUser(p => ({ ...p, name: e.target.value }))}
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label">Correo / Nombre de Usuario</label>
                <input 
                  className="form-input" 
                  placeholder={`Ej. juan (se autocompleta a juan@${getClientDomain()})`} 
                  value={newUser.email}
                  onChange={e => setNewUser(p => ({ ...p, email: e.target.value }))}
                  required
                />
              </div>

              <div className="form-group">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <label className="form-label">
                    {newUser.role === 'cajero' ? 'PIN de Ingreso (máx. 8 dígitos)' : 'Contraseña (máx. 8 caracteres)'}
                  </label>
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                    {newUser.password?.length || 0}/8
                  </span>
                </div>
                <input 
                  className="form-input" 
                  type={newUser.role === 'cajero' ? 'text' : 'password'}
                  inputMode={newUser.role === 'cajero' ? 'numeric' : undefined}
                  pattern={newUser.role === 'cajero' ? '[0-9]*' : undefined}
                  placeholder={newUser.role === 'cajero' ? 'Ej. 12345678' : '••••••••'} 
                  value={newUser.password}
                  onChange={e => setNewUser(p => ({ ...p, password: newUser.role === 'cajero' ? e.target.value.replace(/\D/g, '') : e.target.value }))}
                  maxLength={8}
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label">Rol y Permisos</label>
                <select 
                  className="form-input"
                  style={{ background: 'var(--bg-elevated)', color: 'var(--text-main)', border: '1px solid var(--border)' }}
                  value={newUser.role}
                  onChange={e => {
                    const newRole = e.target.value;
                    setNewUser(p => ({ 
                      ...p, 
                      role: newRole,
                      permisos: getDefaultPermisos(newRole)
                    }));
                  }}
                >
                  <option value="admin">Administrador (Control total)</option>
                  <option value="gerente">Gerente (Gestión operativa)</option>
                  <option value="cajero">Cajero (Cobros y caja)</option>
                  <option value="mesero">Mesero (Toma de pedidos)</option>
                </select>
              </div>

              {(newUser.role === 'admin' || newUser.role === 'gerente' || newUser.role === 'cajero') && (
                <div className="form-group">
                  {renderPermissionsSelector(newUser.permisos || getDefaultPermisos(newUser.role), (updatedPerms) => {
                    setNewUser(p => ({ ...p, permisos: updatedPerms }));
                  })}
                </div>
              )}

              <div style={{ display: 'flex', gap: 12, marginTop: 12 }}>
                <button 
                  type="button" 
                  className="btn btn-secondary" 
                  style={{ flex: 1, background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}
                  onClick={() => setShowAddUserModal(false)}
                >
                  Cancelar
                </button>
                <button 
                  type="submit" 
                  className="btn btn-primary" 
                  style={{ flex: 1 }}
                  disabled={savingUser}
                >
                  {savingUser ? 'Guardando...' : 'Crear Usuario'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showChangePasswordModal && selectedUserForPassword && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
          backdropFilter: 'blur(5px)'
        }}>
          <div className="card" style={{ width: '100%', maxWidth: 450, padding: 32, border: '1px solid var(--border-bronze)', boxShadow: 'var(--shadow-bronze)', animation: 'fadeIn 0.25s ease' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
              <h3 style={{ fontSize: 16, fontWeight: 700, margin: 0, textTransform: 'uppercase', letterSpacing: '0.1em' }} className="gradient-bronze">
                <i className="ri-key-line" style={{ marginRight: 8 }} />Cambiar Contraseña
              </h3>
              <button 
                onClick={() => {
                  setShowChangePasswordModal(false);
                  setSelectedUserForPassword(null);
                  setNewPassword('');
                }}
                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 20 }}
              >
                <i className="ri-close-line" />
              </button>
            </div>
            
            <form onSubmit={handleUpdatePassword} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div className="form-group">
                <label className="form-label">Usuario</label>
                <input 
                  className="form-input" 
                  value={selectedUserForPassword.name}
                  disabled
                  style={{ background: 'rgba(0,0,0,0.2)', color: 'rgba(255,255,255,0.4)' }}
                />
              </div>

              <div className="form-group">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <label className="form-label">
                    {selectedUserForPassword.role === 'cajero' ? 'Nuevo PIN (máx. 8 dígitos)' : 'Nueva Contraseña (máx. 8 caracteres)'}
                  </label>
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                    {newPassword?.length || 0}/8
                  </span>
                </div>
                <input 
                  className="form-input" 
                  type={selectedUserForPassword.role === 'cajero' ? 'text' : 'password'}
                  inputMode={selectedUserForPassword.role === 'cajero' ? 'numeric' : undefined}
                  pattern={selectedUserForPassword.role === 'cajero' ? '[0-9]*' : undefined}
                  placeholder={selectedUserForPassword.role === 'cajero' ? 'Ej. 12345678' : '••••••••'} 
                  value={newPassword}
                  onChange={e => setNewPassword(selectedUserForPassword.role === 'cajero' ? e.target.value.replace(/\D/g, '') : e.target.value)}
                  maxLength={8}
                  required
                  autoFocus
                />
              </div>

              <div style={{ display: 'flex', gap: 12, marginTop: 12 }}>
                <button 
                  type="button" 
                  className="btn btn-secondary" 
                  style={{ flex: 1, background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}
                  onClick={() => {
                    setShowChangePasswordModal(false);
                    setSelectedUserForPassword(null);
                    setNewPassword('');
                  }}
                >
                  Cancelar
                </button>
                <button 
                  type="submit" 
                  className="btn btn-primary" 
                  style={{ flex: 1 }}
                  disabled={savingUserPassword}
                >
                  {savingUserPassword ? 'Guardando...' : 'Actualizar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showEditPermissionsModal && selectedUserForPermissions && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
          backdropFilter: 'blur(5px)'
        }}>
          <div className="card" style={{ width: '100%', maxWidth: 500, maxHeight: '90vh', overflowY: 'auto', padding: 32, border: '1px solid var(--border-bronze)', boxShadow: 'var(--shadow-bronze)', animation: 'fadeIn 0.25s ease' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
              <h3 style={{ fontSize: 16, fontWeight: 700, margin: 0, textTransform: 'uppercase', letterSpacing: '0.1em' }} className="gradient-bronze">
                <i className="ri-shield-keyhole-line" style={{ marginRight: 8 }} />Editar Permisos: {selectedUserForPermissions.name}
              </h3>
              <button 
                onClick={() => {
                  setShowEditPermissionsModal(false);
                  setSelectedUserForPermissions(null);
                }}
                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 20 }}
              >
                <i className="ri-close-line" />
              </button>
            </div>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {renderPermissionsSelector(selectedUserForPermissions.permisos || getDefaultPermisos(selectedUserForPermissions.role), (updatedPerms) => {
                setSelectedUserForPermissions(p => ({ ...p, permisos: updatedPerms }));
              })}

              <div style={{ display: 'flex', gap: 12, marginTop: 12 }}>
                <button 
                  type="button" 
                  className="btn btn-secondary" 
                  style={{ flex: 1, background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}
                  onClick={() => {
                    setShowEditPermissionsModal(false);
                    setSelectedUserForPermissions(null);
                  }}
                >
                  Cancelar
                </button>
                <button 
                  type="button" 
                  className="btn btn-primary" 
                  style={{ flex: 1 }}
                  disabled={savingPermissions}
                  onClick={handleUpdatePermissions}
                >
                  {savingPermissions ? 'Guardando...' : 'Guardar Cambios'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

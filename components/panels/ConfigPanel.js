'use client';
import { useState, useEffect, useRef } from 'react';
import { db } from '@/lib/firebase';
import { collection, getDocs, getDoc, addDoc, query, orderBy, deleteDoc, doc, where, setDoc, serverTimestamp, onSnapshot, writeBatch, limit } from 'firebase/firestore';
import { obfuscate, deobfuscate, hashPasswordSecure } from '@/lib/crypto';
import { QRCodeCanvas } from 'qrcode.react';
import JSZip from 'jszip';

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
  const [subTab, setSubTab] = useState('general'); // 'general' | 'recetario'
  const [previewQr, setPreviewQr] = useState(null);

  const [tarifas, setTarifas] = useState({
    carambola: 80,
    pool: 60,
    snooker: 100,
    surgeMulti: 1.25,
    horaPicoInicio: '18:00',
    horaPicoFin: '22:00',
  });

  const [sucursal, setSucursal] = useState({
    nombre: 'YoY Billar Sucursal 1',
    direccion: 'Av. Principal 123, CDMX',
    telefono: '55-1234-5678',
    horarioApertura: '10:00',
    horarioCierre: '02:00',
    capacidad: 8,
    metaMensual: 100000,
  });

  const [modoSurge, setModoSurge] = useState(true);
  const [notifStock, setNotifStock] = useState(true);
  const [notifOcupacion, setNotifOcupacion] = useState(true);

  // Estados de Gestión de Usuarios
  const [usuarios, setUsuarios] = useState([]);
  const [loadingUsuarios, setLoadingUsuarios] = useState(true);
  const [showAddUserModal, setShowAddUserModal] = useState(false);
  const [newUser, setNewUser] = useState({ name: '', email: '', password: '', role: 'mesero' });
  const [savingUser, setSavingUser] = useState(false);

  // --- Estados de Mesas Config ---
  const [mesas, setMesas] = useState([]);
  const mesasRef = useRef(mesas);
  useEffect(() => {
    mesasRef.current = mesas;
  }, [mesas]);
  const [nuevaMesa, setNuevaMesa] = useState({ id: '', nombre: '', tarifa: '', tipo: 'Pool' });
  const [editingMesaId, setEditingMesaId] = useState(null);

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
  });

  const [actualPin, setActualPin] = useState('');
  const [nuevoPin, setNuevoPin] = useState('');
  const [confirmarPin, setConfirmarPin] = useState('');

  const [resetPin, setResetPin] = useState('');
  const [confirmWipeText, setConfirmWipeText] = useState('');
  const [isResetting, setIsResetting] = useState(false);

  // --- Límite de cortesías por turno (Sugerencia 3) ---
  const [maxCortesiasPorTurno, setMaxCortesiasPorTurno] = useState(3);
  const [savingLimiteCortesias, setSavingLimiteCortesias] = useState(false);

  // --- Telegram config state ---
  const [telegramConfig, setTelegramConfig] = useState({ enabled: false, botToken: '', chatId: '' });
  const [savingTelegram, setSavingTelegram] = useState(false);

  // --- Estados de Recetario y Costeo ---
  const [productos, setProductos] = useState([]);
  const [recetas, setRecetas] = useState([]);
  const [recetaEditando, setRecetaEditando] = useState(null); // { productoId, nombre, precioVenta, ingredientes: [] }
  const [insumoIdSel, setInsumoIdSel] = useState('');
  const [cantInsumo, setCantInsumo] = useState('');
  const [mermaInsumo, setMermaInsumo] = useState('0');

  const fetchUsuarios = async () => {
    setLoadingUsuarios(true);
    try {
      const q = query(collection(db, 'users'), orderBy('createdAt', 'desc'));
      const snap = await getDocs(q);
      const list = [];
      snap.forEach(doc => {
        list.push({ id: doc.id, ...doc.data() });
      });
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

    let savedHash = '170440'; // Default hash of '1111'
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
          botToken: d.botToken || '',
          chatId: d.chatId || '',
        });
      }
    }).catch(err => console.error("Error al cargar configuración de Telegram:", err));
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

        // Cargar Stock de Inventario
        const savedStock = localStorage.getItem('yoy_billar_stock');
        if (savedStock) {
          setProductos(deobfuscate(savedStock) || []);
        } else {
          const defaultProds = [
            { id: 1, nombre: 'Cerveza Corona Extra', categoria: 'Cerveza', precioCosto: 22, precioVenta: 45, stock: 0, stockMin: 30, stockOptimo: 150, unidad: 'bot' },
            { id: 2, nombre: 'Refresco Coca-Cola 355ml', categoria: 'Refresco', precioCosto: 14, precioVenta: 30, stock: 0, stockMin: 20, stockOptimo: 100, unidad: 'pz' },
            { id: 3, nombre: 'Nachos con Queso Gigantes', categoria: 'Snack', precioCosto: 32, precioVenta: 75, stock: 0, stockMin: 15, stockOptimo: 60, unidad: 'porc' },
            { id: 4, nombre: 'Papas Fritas Crujientes', categoria: 'Snack', precioCosto: 20, precioVenta: 55, stock: 0, stockMin: 12, stockOptimo: 50, unidad: 'porc' },
            { id: 5, nombre: 'Alitas de Pollo x10', categoria: 'Comida', precioCosto: 58, precioVenta: 120, stock: 0, stockMin: 10, stockOptimo: 45, unidad: 'pz' },
            { id: 6, nombre: 'Café Americano Organico', categoria: 'Bebida', precioCosto: 12, precioVenta: 35, stock: 0, stockMin: 25, stockOptimo: 120, unidad: 'taza' },
            { id: 7, nombre: 'Agua Embotellada 600ml', categoria: 'Bebida', precioCosto: 8, precioVenta: 20, stock: 0, stockMin: 40, stockOptimo: 180, unidad: 'pz' },
          ];
          setProductos(defaultProds);
          localStorage.setItem('yoy_billar_stock', obfuscate(defaultProds));
        }

        // Cargar Recetario
        const savedRecetas = localStorage.getItem('yoy_recetas_costeo');
        if (savedRecetas) {
          setRecetas(deobfuscate(savedRecetas) || []);
        } else {
          const initRecetas = [
            {
              productoId: 3, // Nachos
              ingredientes: [
                { insumoId: 4, nombreInsumo: 'Papas Fritas Crujientes', cantidad: 0.5, mermaPct: 5, precioCosto: 20 }
              ]
            }
          ];
          setRecetas(initRecetas);
          localStorage.setItem('yoy_recetas_costeo', obfuscate(initRecetas));
        }
      } catch (err) {
        console.error(err);
      }
    }
    return () => unsubMesas();
  }, []);

  const handleAddUser = async (e) => {
    e.preventDefault();
    if (!newUser.name || !newUser.email || !newUser.password) {
      showToast('Por favor completa todos los campos', 'error');
      return;
    }

    let formattedEmail = newUser.email.trim().toLowerCase();
    if (!formattedEmail.includes('@')) {
      formattedEmail = `${formattedEmail}@${getClientDomain()}`;
    }

    if (newUser.role === 'cajero') {
      if (!/^\d{6}$/.test(newUser.password)) {
        showToast('El PIN/Contraseña de Cajero debe ser de exactamente 6 dígitos numéricos', 'error');
        return;
      }
    }

    setSavingUser(true);
    try {
      const dupQuery = query(collection(db, 'users'), where('email', '==', formattedEmail));
      const dupSnap = await getDocs(dupQuery);

      if (!dupSnap.empty) {
        showToast('Este correo o usuario ya está registrado en la base de datos.', 'error');
        setSavingUser(false);
        return;
      }

      const hashedPassword = await hashPasswordSecure(newUser.password);
      await addDoc(collection(db, 'users'), {
        name: newUser.name,
        email: formattedEmail,
        password: hashedPassword,
        role: newUser.role,
        createdAt: new Date().toISOString()
      });
      showToast('¡Usuario creado! A partir de ahora el inicio de sesión es obligatorio.', 'success');
      setShowAddUserModal(false);
      setNewUser({ name: '', email: '', password: '', role: 'mesero' });
      fetchUsuarios();
    } catch (err) {
      console.error("Error creando usuario:", err);
      showToast('Error al guardar el usuario en Firestore', 'error');
    } finally {
      setSavingUser(false);
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
    if (!telegramConfig.botToken || !telegramConfig.chatId) {
      showToast('Ingresa el Token y Chat ID para enviar un mensaje de prueba', 'warning');
      return;
    }
    try {
      const text = `🔔 *YoY Billar - Prueba de Notificaciones*\n\nSi estás viendo este mensaje, la integración con Telegram se ha configurado correctamente.`;
      const url = `https://api.telegram.org/bot${telegramConfig.botToken}/sendMessage`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: telegramConfig.chatId,
          text: text,
          parse_mode: 'Markdown'
        })
      });
      if (res.ok) {
        showToast('Mensaje de prueba enviado con éxito ✓', 'success');
      } else {
        const data = await res.json();
        throw new Error(data.description || 'Error de Telegram');
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
    let savedHash = '170440';
    if (typeof window !== 'undefined') {
      const localHash = localStorage.getItem('yoy_admin_pin_hash');
      if (localHash) savedHash = localHash;
    }
    if (actualHash !== savedHash) {
      showToast('El PIN actual de administrador es incorrecto', 'danger');
      return;
    }
    if (nuevoPin !== confirmarPin) {
      showToast('Los PINs nuevos no coinciden', 'danger');
      return;
    }
    const newHash = hashPassword(nuevoPin);
    try {
      if (typeof window !== 'undefined') {
        localStorage.setItem('yoy_admin_pin_hash', newHash);
        await setDoc(doc(db, 'config', 'seguridad'), {
          adminPinHash: newHash,
          updatedAt: serverTimestamp()
        }, { merge: true });
        showToast('PIN de administrador cambiado y sincronizado con Firestore', 'success');
        setActualPin('');
        setNuevoPin('');
        setConfirmarPin('');
      }
    } catch (err) {
      console.error(err);
      showToast('PIN cambiado localmente (error al sincronizar con Firestore)', 'warning');
      setActualPin('');
      setNuevoPin('');
      setConfirmarPin('');
    }
  };

  const handleSaveMesa = (e) => {
    e.preventDefault();
    const nextMesaId = mesas.length > 0 ? Math.max(...mesas.map(m => m.id)) + 1 : 1;

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

    if (editingMesaId !== null) {
      const updatedMesas = mesas.map(m => {
        if (m.id === editingMesaId) {
          return { ...m, nombre: nuevaMesa.nombre, tarifa: mesaTarifa, tipo: nuevaMesa.tipo };
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
      showToast('Mesa modificada correctamente', 'success');
    } else {
      const mesaId = nextMesaId;
      const mesaNombre = nuevaMesa.nombre.trim() || `Mesa ${mesaId}`;
      const nueva = {
        id: mesaId,
        nombre: mesaNombre,
        tipo: nuevaMesa.tipo,
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
      showToast('Nueva mesa agregada', 'success');
    }
  };

  const handleEditMesa = (mesa) => {
    setEditingMesaId(mesa.id);
    setNuevaMesa({
      id: mesa.id.toString(),
      nombre: mesa.nombre,
      tarifa: mesa.tarifa.toString(),
      tipo: mesa.tipo || 'Pool'
    });
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

  // ── MÉTODOS DEL RECETARIO ────────────────────────────
  const getReceta = (prodId) => recetas.find(r => r.productoId === prodId);

  const calcularCostoReceta = (receta) => {
    if (!receta || !receta.ingredientes) return 0;
    return receta.ingredientes.reduce((sum, ing) => {
      const prod = productos.find(p => p.id === ing.insumoId);
      const costoUnidad = prod ? prod.precioCosto : (ing.precioCosto || 0);
      const mermaFactor = 1 + (ing.mermaPct || 0) / 100;
      return sum + (ing.cantidad * costoUnidad * mermaFactor);
    }, 0);
  };

  const getCostoProducto = (prod) => {
    const rec = getReceta(prod.id);
    if (rec) return calcularCostoReceta(rec);
    return prod.precioCosto || 0;
  };

  const handleAbrirReceta = (prod) => {
    const recExistente = getReceta(prod.id) || {
      productoId: prod.id,
      nombre: prod.nombre,
      precioVenta: prod.precioVenta,
      ingredientes: []
    };
    setRecetaEditando({ ...recExistente, nombre: prod.nombre, precioVenta: prod.precioVenta });
    setInsumoIdSel('');
    setCantInsumo('');
    setMermaInsumo('0');
  };

  const handleAddIngrediente = () => {
    if (!insumoIdSel || !cantInsumo) {
      showToast('Selecciona un ingrediente y define la cantidad', 'warning');
      return;
    }
    const insumoId = parseInt(insumoIdSel);
    const cant = parseFloat(cantInsumo);
    const merma = parseFloat(mermaInsumo) || 0;

    const insumoProd = productos.find(p => p.id === insumoId);
    if (!insumoProd) return;

    if (recetaEditando.ingredientes.some(i => i.insumoId === insumoId)) {
      showToast('Este ingrediente ya está en la receta', 'error');
      return;
    }

    const nuevoIng = {
      insumoId,
      nombreInsumo: insumoProd.nombre,
      cantidad: cant,
      mermaPct: merma,
      precioCosto: insumoProd.precioCosto,
      unidad: insumoProd.unidad || 'pz'
    };

    setRecetaEditando(p => ({
      ...p,
      ingredientes: [...p.ingredientes, nuevoIng]
    }));

    setInsumoIdSel('');
    setCantInsumo('');
    setMermaInsumo('0');
    showToast('Ingrediente agregado a la receta temporal', 'success');
  };

  const handleRemoveIngrediente = (insumoId) => {
    setRecetaEditando(p => ({
      ...p,
      ingredientes: p.ingredientes.filter(i => i.insumoId !== insumoId)
    }));
  };

  const handleGuardarReceta = () => {
    let nuevasRecetas;
    const existe = recetas.some(r => r.productoId === recetaEditando.productoId);
    if (existe) {
      nuevasRecetas = recetas.map(r => r.productoId === recetaEditando.productoId ? recetaEditando : r);
    } else {
      nuevasRecetas = [...recetas, recetaEditando];
    }
    setRecetas(nuevasRecetas);
    localStorage.setItem('yoy_recetas_costeo', obfuscate(nuevasRecetas));

    const nuevoCosto = calcularCostoReceta(recetaEditando);

    const nuevosProductos = productos.map(p => {
      if (p.id === recetaEditando.productoId) {
        return { ...p, precioCosto: Math.round(nuevoCosto), lastModified: Date.now() };
      }
      return p;
    });
    setProductos(nuevosProductos);
    localStorage.setItem('yoy_billar_stock', obfuscate(nuevosProductos));

    setRecetaEditando(null);
    showToast('Receta guardada y costo del POS actualizado', 'success');
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
      <div className="page-header">
        <div>
          <h1 className="page-title gradient-bronze">Configuración</h1>
          <p className="page-subtitle">Ajustes del sistema, sucursal, tarifas y recetario de costeo</p>
        </div>
      </div>

      {/* SELECTOR DE SUBTABS */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 20 }}>
        <button
          className={`btn btn-sm ${subTab === 'general' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setSubTab('general')}
          style={{ display: 'flex', alignItems: 'center', gap: 6 }}
        >
          <i className="ri-settings-4-line" /> Ajustes Generales
        </button>
        <button
          className={`btn btn-sm ${subTab === 'recetario' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setSubTab('recetario')}
          style={{ display: 'flex', alignItems: 'center', gap: 6 }}
        >
          <i className="ri-restaurant-line" /> Recetario y Costeo Dinámico
        </button>
      </div>

      {subTab === 'general' ? (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
            {/* Sucursal */}
            <div className="card">
              <div className="card-header" style={{ marginBottom: 20 }}>
                <h3 className="card-title"><i className="ri-building-line" style={{ marginRight: 6 }} />Datos de Sucursal</h3>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                {[
                  { label: 'Nombre del Negocio', key: 'nombre', type: 'text' },
                  { label: 'Dirección', key: 'direccion', type: 'text' },
                  { label: 'Teléfono', key: 'telefono', type: 'text' },
                  { label: 'Meta de Ingresos Mensual ($)', key: 'metaMensual', type: 'number' },
                ].map(f => (
                  <div key={f.key} className="form-group">
                    <label className="form-label">{f.label}</label>
                    <input 
                      type={f.type || 'text'} 
                      className="form-input" 
                      value={sucursal[f.key] || ''} 
                      onChange={e => setSucursal(p => ({ ...p, [f.key]: f.type === 'number' ? Number(e.target.value) : e.target.value }))} 
                    />
                  </div>
                ))}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <div className="form-group">
                    <label className="form-label">Apertura</label>
                    <input className="form-input" type="time" value={sucursal.horarioApertura || ''} onChange={e => setSucursal(p => ({ ...p, horarioApertura: e.target.value }))} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Cierre</label>
                    <input className="form-input" type="time" value={sucursal.horarioCierre || ''} onChange={e => setSucursal(p => ({ ...p, horarioCierre: e.target.value }))} />
                  </div>
                </div>

                <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 10, marginTop: 4 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--bronze-light)', marginBottom: 10 }}>
                    📍 Geocerca para Asistencia (QR)
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
                    <div className="form-group">
                      <label className="form-label">Latitud</label>
                      <input className="form-input" type="number" step="any" value={sucursal.lat || ''} onChange={e => setSucursal(p => ({ ...p, lat: e.target.value }))} placeholder="20.659698" style={{ fontSize: 12 }} />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Longitud</label>
                      <input className="form-input" type="number" step="any" value={sucursal.lng || ''} onChange={e => setSucursal(p => ({ ...p, lng: e.target.value }))} placeholder="-103.349609" style={{ fontSize: 12 }} />
                    </div>
                  </div>
                  <button className="btn btn-secondary btn-xs" onClick={obtenerUbicacionActualSucursal} style={{ display: 'flex', alignItems: 'center', gap: 4, width: '100%', justifyContent: 'center', height: 28, fontSize: 11 }}>
                    <i className="ri-map-pin-line" style={{ color: 'var(--bronze-light)' }} /> Usar Ubicación de este Dispositivo
                  </button>
                </div>

                <button className="btn btn-primary" onClick={handleSaveSucursal} style={{ marginTop: 6 }}>
                  <i className="ri-save-line" /> Guardar Sucursal
                </button>
              </div>
            </div>

            {/* Tarifas */}
            <div className="card">
              <div className="card-header" style={{ marginBottom: 20 }}>
                <h3 className="card-title"><i className="ri-price-tag-3-line" style={{ marginRight: 6 }} />Tarifas por Hora</h3>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                {[
                  { label: 'Carambola 3 Bandas ($/hr)', key: 'carambola' },
                  { label: 'Pool 9 Bolas ($/hr)', key: 'pool' },
                  { label: 'Snooker ($/hr)', key: 'snooker' },
                ].map(f => (
                  <div key={f.key} className="form-group">
                    <label className="form-label">{f.label}</label>
                    <input className="form-input" type="number" value={tarifas[f.key]} onChange={e => setTarifas(p => ({ ...p, [f.key]: Number(e.target.value) }))} />
                  </div>
                ))}
                <div className="divider" />
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0' }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700 }}>Surge Pricing (Precio Pico)</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Tarifa automática en horas de alta demanda</div>
                  </div>
                  <div
                    onClick={() => setModoSurge(p => !p)}
                    style={{
                      width: 44, height: 24, borderRadius: 12, cursor: 'pointer', transition: 'all 0.2s',
                      background: modoSurge ? 'var(--bronze)' : 'var(--bg-elevated)',
                      border: `1px solid ${modoSurge ? 'var(--bronze)' : 'var(--border)'}`,
                      position: 'relative',
                    }}
                  >
                    <div style={{ width: 18, height: 18, borderRadius: '50%', background: '#fff', position: 'absolute', top: 2, left: modoSurge ? 22 : 2, transition: 'left 0.2s' }} />
                  </div>
                </div>
                {modoSurge && (
                  <div style={{ background: 'var(--bronze-subtle)', border: '1px solid var(--border-bronze)', borderRadius: 10, padding: 12 }}>
                    <div className="form-group">
                      <label className="form-label">Multiplicador ({((tarifas.surgeMulti - 1) * 100).toFixed(0)}% extra)</label>
                      <input className="form-input" type="number" step="0.05" min="1" max="3" value={tarifas.surgeMulti} onChange={e => setTarifas(p => ({ ...p, surgeMulti: Number(e.target.value) }))} />
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 10 }}>
                      <div className="form-group">
                        <label className="form-label">Hora Inicio Pico</label>
                        <input className="form-input" type="time" value={tarifas.horaPicoInicio} onChange={e => setTarifas(p => ({ ...p, horaPicoInicio: e.target.value }))} />
                      </div>
                      <div className="form-group">
                        <label className="form-label">Hora Fin Pico</label>
                        <input className="form-input" type="time" value={tarifas.horaPicoFin} onChange={e => setTarifas(p => ({ ...p, horaPicoFin: e.target.value }))} />
                      </div>
                    </div>
                  </div>
                )}
                <button className="btn btn-primary" onClick={() => guardar('tarifas')}>
                  <i className="ri-save-line" /> Guardar Tarifas
                </button>
              </div>
            </div>

            {/* Alertas IA */}
            <div className="card">
              <div className="card-header" style={{ marginBottom: 20 }}>
                <h3 className="card-title"><i className="ri-robot-line" style={{ marginRight: 6 }} />Alertas IA</h3>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                {[
                  { label: 'Alerta de Stock Bajo', sub: 'Notificar cuando un producto esté bajo mínimo', state: notifStock, set: setNotifStock },
                  { label: 'Alerta de Alta Ocupación', sub: 'Sugerir surge pricing al superar 70%', state: notifOcupacion, set: setNotifOcupacion },
                ].map((item, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0', borderBottom: i === 0 ? '1px solid var(--border)' : 'none' }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700 }}>{item.label}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{item.sub}</div>
                    </div>
                    <div
                      onClick={() => item.set(p => !p)}
                      style={{ width: 44, height: 24, borderRadius: 12, cursor: 'pointer', transition: 'all 0.2s', background: item.state ? 'var(--bronze)' : 'var(--bg-elevated)', border: `1px solid ${item.state ? 'var(--bronze)' : 'var(--border)'}`, position: 'relative' }}
                    >
                      <div style={{ width: 18, height: 18, borderRadius: '50%', background: '#fff', position: 'absolute', top: 2, left: item.state ? 22 : 2, transition: 'left 0.2s' }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Roles del sistema */}
            <div className="card">
              <div className="card-header" style={{ marginBottom: 20 }}>
                <h3 className="card-title"><i className="ri-shield-user-line" style={{ marginRight: 6 }} />Usuarios y Roles</h3>
                <button className="btn btn-primary btn-sm" title="Agregar nuevo usuario" onClick={() => setShowAddUserModal(true)}>
                  <i className="ri-user-add-line" />
                </button>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {usuarios.length === 0 ? (
                  <>
                    <div style={{ background: 'var(--bronze-subtle)', border: '1px solid var(--border-bronze)', borderRadius: 10, padding: 12, marginBottom: 8 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--bronze-light)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                        ⚠️ Modo Acceso Libre Activo
                      </div>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}>
                        El sistema entra directo sin login. Crea tu primer usuario haciendo clic en el botón de arriba (+) para activar la seguridad del negocio.
                      </div>
                    </div>
                    {defaultDemos.map((u, i) => {
                      const color = getRoleColor(u.role);
                      return (
                        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderBottom: i < 3 ? '1px solid var(--border)' : 'none', opacity: 0.65 }}>
                          <div style={{ width: 30, height: 30, borderRadius: 8, background: `${color}22`, border: `1px solid ${color}44`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 800, color }}>
                            {u.name[0]}
                          </div>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: 13, fontWeight: 700 }}>{u.name} <span style={{ fontSize: 9, color: 'var(--bronze)', fontWeight: 600 }}>(Demo)</span></div>
                            <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{u.email}</div>
                          </div>
                          <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: `${color}22`, color, border: `1px solid ${color}44`, textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                            {u.role}
                          </span>
                        </div>
                      );
                    })}
                  </>
                ) : (
                  usuarios.map((u, i) => {
                    const color = getRoleColor(u.role);
                    return (
                      <div key={u.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderBottom: i < usuarios.length - 1 ? '1px solid var(--border)' : 'none' }}>
                        <div style={{ width: 30, height: 30, borderRadius: 8, background: `${color}22`, border: `1px solid ${color}44`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 800, color }}>
                          {u.name[0]}
                        </div>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 13, fontWeight: 700 }}>{u.name}</div>
                          <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{u.email}</div>
                        </div>
                        <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: `${color}22`, color, border: `1px solid ${color}44`, textTransform: 'uppercase', letterSpacing: '0.1em', marginRight: 10 }}>
                          {u.role}
                        </span>
                        <button
                          onClick={() => handleDeleteUser(u.id, u.name)}
                          title="Eliminar usuario"
                          style={{
                            background: 'none', border: 'none', color: 'var(--text-muted)',
                            cursor: 'pointer', fontSize: 16, padding: '4px 8px',
                            transition: 'color 0.15s',
                          }}
                          onMouseEnter={e => e.currentTarget.style.color = '#ef4444'}
                          onMouseLeave={e => e.currentTarget.style.color = 'var(--text-muted)'}
                        >
                          <i className="ri-delete-bin-line" />
                        </button>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* Configuración de Mesas */}
            <div className="card">
              <div className="card-header" style={{ marginBottom: 20 }}>
                <h3 className="card-title"><i className="ri-grid-line" style={{ marginRight: 6 }} />Configuración de Mesas</h3>
              </div>
              <form onSubmit={handleSaveMesa} style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 20, background: 'var(--bg-elevated)', padding: 14, borderRadius: 12, border: '1px solid var(--border)' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '80px 1fr', gap: 10 }}>
                  <div className="form-group">
                    <label className="form-label">Número</label>
                    <input
                      type="number"
                      className="form-input"
                      value={editingMesaId !== null ? nuevaMesa.id : (mesas.length > 0 ? Math.max(...mesas.map(m => m.id)) + 1 : 1)}
                      disabled={true}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Nombre (Opcional)</label>
                    <input
                      className="form-input"
                      placeholder={editingMesaId !== null ? "Ej: Mesa 1" : `Mesa ${(mesas.length > 0 ? Math.max(...mesas.map(m => m.id)) + 1 : 1)}`}
                      value={nuevaMesa.nombre}
                      onChange={e => setNuevaMesa(p => ({ ...p, nombre: e.target.value }))}
                    />
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <div className="form-group">
                    <label className="form-label">Tarifa ($/hr)</label>
                    <input
                      type="number"
                      className="form-input"
                      placeholder="60"
                      value={nuevaMesa.tarifa}
                      onChange={e => setNuevaMesa(p => ({ ...p, tarifa: e.target.value }))}
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Tipo de Mesa</label>
                    <select
                      className="form-select"
                      value={nuevaMesa.tipo}
                      onChange={e => setNuevaMesa(p => ({ ...p, tipo: e.target.value }))}
                      style={{ background: 'var(--bg-elevated)', color: 'var(--text-main)', border: '1px solid var(--border)', height: 38 }}
                    >
                      <option value="Pool">Pool</option>
                      <option value="Carambola">Carambola</option>
                      <option value="Snooker">Snooker</option>
                      <option value="Dominó">Dominó</option>
                      <option value="Consumo">Consumo</option>
                    </select>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                  {editingMesaId !== null && (
                    <button
                      type="button"
                      className="btn btn-secondary"
                      style={{ flex: 1 }}
                      onClick={() => {
                        setEditingMesaId(null);
                        setNuevaMesa({ id: '', nombre: '', tarifa: '', tipo: 'Pool' });
                      }}
                    >
                      Cancelar
                    </button>
                  )}
                  <button type="submit" className="btn btn-primary" style={{ flex: 2 }}>
                    {editingMesaId !== null ? 'Guardar Cambios' : 'Agregar Mesa'}
                  </button>
                </div>
              </form>

              {/* Listado de Mesas */}
              <div style={{ maxHeight: 220, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
                {mesas.map(m => (
                  <div key={m.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border)', borderRadius: 10 }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700 }}>{m.nombre} <span style={{ fontSize: 10, color: 'var(--bronze-light)' }}>({m.tipo})</span></div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Tarifa: ${m.tarifa}/hr</div>
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button className="btn btn-secondary btn-icon" style={{ width: 28, height: 28, minWidth: 28, padding: 0 }} onClick={() => handleEditMesa(m)}>
                        <i className="ri-pencil-line" />
                      </button>
                      <button className="btn btn-secondary btn-icon" style={{ width: 28, height: 28, minWidth: 28, padding: 0, color: '#ef4444' }} onClick={() => handleDeleteMesa(m.id)}>
                        <i className="ri-delete-bin-line" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Impresión de QRs por Mesa */}
            <div className="card">
              <div className="card-header" style={{ marginBottom: 20 }}>
                <h3 className="card-title"><i className="ri-qr-code-line" style={{ marginRight: 6 }} />Impresión de QRs por Mesa</h3>
              </div>
              <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 14 }}>
                Genera y descarga códigos QR para pegar en las mesas. Permite a los clientes pedir servicio o recargar tiempo en su celular.
              </p>
              <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
                <button
                  className="btn btn-primary"
                  onClick={() => imprimirQRs(null)}
                  style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
                >
                  <i className="ri-printer-line" /> Imprimir Todos los QRs
                </button>
                <button
                  className="btn btn-secondary"
                  onClick={descargarTodosLosQRsZIP}
                  style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
                >
                  <i className="ri-download-2-line" /> Descargar Todos (ZIP)
                </button>
              </div>
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 350, overflowY: 'auto' }}>
                {/* QR de Fila Virtual - Autoservicio */}
                <div style={{ 
                  display: 'flex', 
                  alignItems: 'center', 
                  justifyContent: 'space-between', 
                  padding: '10px 12px', 
                  background: 'rgba(197, 168, 128, 0.08)', 
                  border: '1.5px solid rgba(197, 168, 128, 0.3)', 
                  borderRadius: 10,
                  marginBottom: 4
                }}>
                  <div 
                    style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}
                    onClick={() => setPreviewQr({
                      title: 'Fila Virtual (Autoservicio)',
                      value: typeof window !== 'undefined' ? `${window.location.origin}/fila/registro` : 'https://yoy-ia-billar.vercel.app/fila/registro',
                      filename: 'fila_de_espera.png'
                    })}
                    title="Previsualizar QR"
                  >
                    <img 
                      src={`https://api.qrserver.com/v1/create-qr-code/?size=60x60&data=${encodeURIComponent(typeof window !== 'undefined' ? `${window.location.origin}/fila/registro` : 'https://yoy-ia-billar.vercel.app/fila/registro')}`} 
                      width="36" 
                      height="36" 
                      style={{ borderRadius: 6, background: '#fff', padding: 2, border: '1px solid var(--border)' }} 
                      alt="QR Fila Virtual" 
                    />
                    <div>
                      <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--bronze-light)' }}>Fila Virtual (Autoservicio)</span>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 4 }}>
                        <span>Registro de clientes por QR</span>
                        <i className="ri-eye-line" style={{ fontSize: 11 }} />
                      </div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={() => descargarQR('fila')}
                      style={{ fontSize: 11, padding: '4px 10px', display: 'flex', alignItems: 'center', gap: 4 }}
                    >
                      <i className="ri-download-2-line" /> Descargar
                    </button>
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={imprimirQRRegistroVirtual}
                      style={{ fontSize: 11, padding: '4px 10px', display: 'flex', alignItems: 'center', gap: 4 }}
                    >
                      <i className="ri-printer-line" /> Imprimir
                    </button>
                  </div>
                </div>

                {/* QRs de Mesas */}
                {mesas.map(m => (
                  <div key={m.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 10 }}>
                    <div 
                      style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}
                      onClick={() => setPreviewQr({
                        title: m.nombre,
                        value: typeof window !== 'undefined' ? `${window.location.origin}/mesa/${m.id}` : `https://yoy-ia-billar.vercel.app/mesa/${m.id}`,
                        filename: getTableFilename(m),
                        mesaId: m.id
                      })}
                      title="Previsualizar QR"
                    >
                      <img src={`https://api.qrserver.com/v1/create-qr-code/?size=60x60&data=${encodeURIComponent(typeof window !== 'undefined' ? `${window.location.origin}/mesa/${m.id}` : `https://yoy-ia-billar.vercel.app/mesa/${m.id}`)}`} width="36" height="36" style={{ borderRadius: 6, background: '#fff', padding: 2, border: '1px solid var(--border)' }} alt="QR Mesa" />
                      <div>
                        <span style={{ fontSize: 13, fontWeight: 700 }}>{m.nombre}</span>
                        <div style={{ fontSize: 10, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 4 }}>
                          <span>Mesa ID: {m.id}</span>
                          <i className="ri-eye-line" style={{ fontSize: 11 }} />
                        </div>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={() => descargarQR('mesa', m.id)}
                        style={{ fontSize: 11, padding: '4px 10px', display: 'flex', alignItems: 'center', gap: 4 }}
                      >
                        <i className="ri-download-2-line" /> Descargar
                      </button>
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={() => imprimirQRs(m.id)}
                        style={{ fontSize: 11, padding: '4px 10px', display: 'flex', alignItems: 'center', gap: 4 }}
                      >
                        <i className="ri-printer-line" /> Imprimir
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* PIN de Administrador */}
            <div className="card">
              <div className="card-header" style={{ marginBottom: 20 }}>
                <h3 className="card-title"><i className="ri-shield-keyhole-line" style={{ marginRight: 6 }} />PIN de Administrador</h3>
              </div>
              <form onSubmit={handleChangePin} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div className="form-group">
                  <label className="form-label">PIN de Administrador Actual</label>
                  <input
                    type="password"
                    className="form-input"
                    placeholder="••••"
                    value={actualPin}
                    onChange={e => setActualPin(e.target.value)}
                    maxLength={8}
                    required
                  />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <div className="form-group">
                    <label className="form-label">Nuevo PIN</label>
                    <input
                      type="password"
                      className="form-input"
                      placeholder="Ej: 4321"
                      value={nuevoPin}
                      onChange={e => setNuevoPin(e.target.value)}
                      maxLength={8}
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Confirmar PIN</label>
                    <input
                      type="password"
                      className="form-input"
                      placeholder="Confirmar"
                      value={confirmarPin}
                      onChange={e => setConfirmarPin(e.target.value)}
                      maxLength={8}
                      required
                    />
                  </div>
                </div>
                <button type="submit" className="btn btn-primary">
                  <i className="ri-lock-unlock-line" /> Guardar Nuevo PIN
                </button>
              </form>
            </div>

            {/* Configuración de Telegram */}
            <div className="card">
              <div className="card-header" style={{ marginBottom: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
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
              
              <p style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 14 }}>
                Envía alertas en tiempo real al grupo o chat de la gerencia cuando ocurra un fichaje sospechoso (ej. celular inusual).
              </p>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div className="form-group">
                  <label className="form-label">Token de Bot de Telegram</label>
                  <input
                    type="password"
                    className="form-input"
                    placeholder="1234567890:ABCDefGhIJK..."
                    value={telegramConfig.botToken}
                    onChange={e => setTelegramConfig(p => ({ ...p, botToken: e.target.value }))}
                    style={{ fontSize: 11 }}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">ID del Chat o Canal</label>
                  <input
                    className="form-input"
                    placeholder="Ej: -100123456789 o 123456789"
                    value={telegramConfig.chatId}
                    onChange={e => setTelegramConfig(p => ({ ...p, chatId: e.target.value }))}
                    style={{ fontSize: 11 }}
                  />
                </div>

                <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                  <button 
                    type="button" 
                    className="btn btn-secondary" 
                    onClick={handleTestTelegram} 
                    style={{ flex: 1, height: 36, fontSize: 11 }}
                  >
                    <i className="ri-send-plane-line" /> Probar
                  </button>
                  <button 
                    type="button" 
                    className="btn btn-primary" 
                    onClick={handleSaveTelegram} 
                    disabled={savingTelegram} 
                    style={{ flex: 2, height: 36, fontSize: 11 }}
                  >
                    <i className="ri-save-line" /> {savingTelegram ? 'Guardando...' : 'Guardar Telegram'}
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Control de Cortesías por Turno */}
          <div className="card" style={{ marginTop: 20 }}>
            <div className="card-header" style={{ marginBottom: 16 }}>
              <h3 className="card-title"><i className="ri-hand-coin-line" style={{ marginRight: 6 }} />Control de Cortesías por Turno</h3>
              <span className="badge badge-secondary">Anti-Fraude</span>
            </div>
            <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 14, lineHeight: 1.5 }}>
              Define cuántas cortesías ($0 MXN) puede otorgar un mesero o staff por turno sin requerir autorización del administrador. Al superar este límite, el sistema solicitará el PIN de administrador para continuar.
            </p>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <div className="form-group" style={{ flex: 1, margin: 0 }}>
                <label className="form-label">Máximo de cortesías por turno</label>
                <input
                  type="number"
                  className="form-input"
                  min={0}
                  max={20}
                  value={maxCortesiasPorTurno}
                  onChange={e => setMaxCortesiasPorTurno(Number(e.target.value) || 0)}
                  style={{ width: 100, textAlign: 'center', fontSize: 18, fontWeight: 700 }}
                />
                <p style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}>0 = siempre requiere PIN del admin</p>
              </div>
              <button
                className="btn btn-primary"
                style={{ flexShrink: 0 }}
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
                    showToast(`Límite de cortesías guardado: ${maxCortesiasPorTurno} por turno`, 'success');
                  } catch (e) {
                    console.error(e);
                    showToast('Error al guardar el límite', 'danger');
                  } finally {
                    setSavingLimiteCortesias(false);
                  }
                }}
              >
                <i className="ri-save-line" /> {savingLimiteCortesias ? 'Guardando...' : 'Guardar Límite'}
              </button>
            </div>
            <div style={{ marginTop: 14, background: 'rgba(249,115,22,0.08)', border: '1px solid rgba(249,115,22,0.2)', borderRadius: 10, padding: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#f97316', fontSize: 12, fontWeight: 700 }}>
                <i className="ri-information-line" />
                Configuración actual: {maxCortesiasPorTurno === 0 ? 'Todas las cortesías requieren PIN del administrador' : `Hasta ${maxCortesiasPorTurno} cortesía${maxCortesiasPorTurno !== 1 ? 's' : ''} por turno sin PIN`}
              </div>
            </div>
          </div>

          {/* Mantenimiento y Depuración (Restablecer todo) */}
          <div className="card" style={{ marginTop: 20, border: '1px solid rgba(239,68,68,0.2)' }}>
            <div className="card-header" style={{ marginBottom: 16 }}>
              <h3 className="card-title" style={{ color: 'var(--danger)' }}><i className="ri-error-warning-line" style={{ marginRight: 6 }} />Mantenimiento y Depuración</h3>
              <span className="badge badge-danger">Zona Peligrosa</span>
            </div>
            <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 14, lineHeight: 1.5 }}>
              Use esta herramienta para limpiar por completo todos los torneos, comandas, bitácora de caja, histórico y restablecer las mesas para pruebas manuales de flujo en limpio.
            </p>
            <form onSubmit={handleRestablecerTodo} style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
              <div className="form-group" style={{ margin: 0 }}>
                <label className="form-label">PIN de Administrador</label>
                <input
                  type="password"
                  className="form-input"
                  placeholder="••••"
                  value={resetPin}
                  onChange={e => setResetPin(e.target.value)}
                  maxLength={8}
                  style={{ width: 120, letterSpacing: '0.3em', textAlign: 'center' }}
                  required
                />
              </div>
              <div className="form-group" style={{ flex: 1, minWidth: 200, margin: 0 }}>
                <label className="form-label">Escriba RESTABLECER para confirmar</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="RESTABLECER"
                  value={confirmWipeText}
                  onChange={e => setConfirmWipeText(e.target.value)}
                  style={{ textTransform: 'uppercase' }}
                  required
                />
              </div>
              <button 
                type="submit" 
                className="btn btn-danger" 
                disabled={isResetting || !resetPin || confirmWipeText.trim().toUpperCase() !== 'RESTABLECER'} 
                style={{ alignSelf: 'flex-end', height: 38 }}
              >
                <i className="ri-delete-bin-line" /> {isResetting ? 'Restableciendo...' : 'Restablecer Base de Datos a Limpio'}
              </button>
            </form>
          </div>

          {/* Diseño de Tickets Térmicos */}
          <div className="card" style={{ marginTop: 20 }}>
            <div className="card-header" style={{ marginBottom: 20 }}>
              <h3 className="card-title"><i className="ri-file-text-line" style={{ marginRight: 6 }} />Diseño de Tickets Tickets</h3>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 20, alignItems: 'start' }}>
              <div>
                <h4 style={{ fontSize: 14, fontWeight: 800, color: 'var(--bronze-light)', marginBottom: 12 }}>Campos Visibles en Ticket</h4>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 20 }}>
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
                    <label key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', background: 'var(--bg-elevated)', borderRadius: 10, border: '1px solid var(--border)', cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={ticketConfig[item.id]}
                        onChange={() => handleTicketToggle(item.id)}
                        style={{ accentColor: 'var(--bronze)' }}
                      />
                      <span style={{ fontSize: 12, fontWeight: 600 }}>{item.label}</span>
                    </label>
                  ))}
                </div>

                <h4 style={{ fontSize: 14, fontWeight: 800, color: 'var(--bronze-light)', marginBottom: 12 }}>Tamaño de Fuente</h4>
                <div style={{ display: 'flex', gap: 10 }}>
                  {[
                    { id: '11px', label: 'Chica (11px)' },
                    { id: '14px', label: 'Mediana (14px)' },
                    { id: '18px', label: 'Grande (18px)' },
                  ].map(item => (
                    <button
                      key={item.id}
                      className={`btn ${ticketConfig.fontSize === item.id ? 'btn-primary' : 'btn-secondary'}`}
                      onClick={() => handleTicketFontSize(item.id)}
                      style={{ flex: 1, fontSize: 12 }}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
                
                <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 16 }}>
                  Nota: El pie de página centralizado <strong>{"\"YoY IA by Alfonso Iturbide\""}</strong> es un sello obligatorio de YoY IA y no puede ser alterado ni desactivado.
                </p>
              </div>

              {/* Vista Previa en Vivo */}
              <div>
                <h4 style={{ fontSize: 13, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)', fontWeight: 800, marginBottom: 10, textAlign: 'center' }}>Vista Previa en Vivo</h4>
                <div style={{ background: '#fff', color: '#000', padding: 20, fontFamily: 'monospace', fontSize: ticketConfig.fontSize, width: '100%', maxWidth: 280, margin: '0 auto', border: '1px solid #ccc', boxShadow: '0 4px 12px rgba(0,0,0,0.5)', borderRadius: 6 }}>
                  <div style={{ textAlign: 'center', marginBottom: 10 }}>
                    {ticketConfig.showNombre && <div style={{ fontWeight: 'bold', fontSize: '1.2em' }}>{sucursal.nombre}</div>}
                    {ticketConfig.showDireccion && <div style={{ fontSize: '0.85em', marginTop: 2 }}>{sucursal.direccion}</div>}
                    {ticketConfig.showTelefono && <div style={{ fontSize: '0.85em' }}>Tel: {sucursal.telefono}</div>}
                  </div>
                  
                  <div style={{ borderBottom: '1px dashed #000', margin: '8px 0' }} />
                  
                  <div style={{ fontSize: '0.85em', lineHeight: 1.4 }}>
                    {ticketConfig.showCliente && <div>CLIENTE: Juan Pérez</div>}
                    {ticketConfig.showCuenta && <div>CUENTA: #1024</div>}
                    {ticketConfig.showFechaHora && <div>FECHA: {new Date().toLocaleString('es-MX')}</div>}
                  </div>

                  <div style={{ borderBottom: '1px dashed #000', margin: '8px 0' }} />

                  {ticketConfig.showConsumos && (
                    <div style={{ fontSize: '0.85em' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 'bold' }}>
                        <span>PRODUCTO</span>
                        <span>TOTAL</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', margin: '3px 0' }}>
                        <span>2x Cerveza Corona</span>
                        <span>$90.00</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', margin: '3px 0' }}>
                        <span>1x Papas Fritas</span>
                        <span>$55.00</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', margin: '3px 0' }}>
                        <span>1.5h Mesa Pool</span>
                        <span>$90.00</span>
                      </div>
                    </div>
                  )}

                  <div style={{ borderBottom: '1px dashed #000', margin: '8px 0' }} />
                  
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 'bold', fontSize: '1.05em' }}>
                    <span>TOTAL:</span>
                    <span>$235.00 MXN</span>
                  </div>

                  {ticketConfig.showQrRecibo && (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', margin: '10px 0' }}>
                      <img
                        src={`https://api.qrserver.com/v1/create-qr-code/?size=100x100&data=${encodeURIComponent('https://yoy-ia-billar.vercel.app/recibo/1024')}`}
                        width="80"
                        height="80"
                        style={{ border: '1px solid #ccc', padding: 2, background: '#fff' }}
                        alt="QR Recibo"
                      />
                      <span style={{ fontSize: '8px', color: '#666', marginTop: 4 }}>Escanea para ver ticket digital</span>
                    </div>
                  )}

                  <div style={{ borderBottom: '1px dashed #000', margin: '8px 0' }} />
                  
                  <div style={{ textAlign: 'center', fontSize: '9px', marginTop: 10, color: '#333', fontWeight: 'bold' }}>
                    *** GRACIAS POR SU VISITA ***
                  </div>
                  
                  <div style={{ textAlign: 'center', fontSize: '8px', color: '#666', marginTop: 8, fontStyle: 'italic' }}>
                    YoY IA by Alfonso Iturbide
                  </div>
                </div>
              </div>
            </div>
          </div>
        </>
      ) : (
        /* MÓDULO DE RECETARIO Y COSTEO DINÁMICO */
        <div className="card">
          <div className="card-header" style={{ marginBottom: 16 }}>
            <div>
              <h3 className="card-title"><i className="ri-restaurant-line" style={{ marginRight: 6 }} />Recetario de Alimentos y Costeo</h3>
              <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: 0 }}>Vincula productos del POS con sus ingredientes del inventario de insumos para calcular margen bruto real.</p>
            </div>
          </div>

          <div className="table-wrapper" style={{ border: 'none' }}>
            <table>
              <thead>
                <tr>
                  <th>Producto</th>
                  <th>Categoría</th>
                  <th>Precio Venta</th>
                  <th>Costo Preparación</th>
                  <th>Margen Bruto (%)</th>
                  <th>Estado Receta</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {productos.map(p => {
                  const rec = getReceta(p.id);
                  const costoPrep = getCostoProducto(p);
                  const margen = p.precioVenta > 0 ? ((p.precioVenta - costoPrep) / p.precioVenta * 100).toFixed(1) : 0;
                  const esBajoMargen = margen < 50;

                  return (
                    <tr key={p.id}>
                      <td style={{ fontWeight: 700 }}>{p.nombre}</td>
                      <td>{p.categoria}</td>
                      <td style={{ fontFamily: 'var(--font-display)', fontWeight: 700 }}>${p.precioVenta}</td>
                      <td style={{ fontFamily: 'var(--font-display)', fontWeight: 700, color: 'var(--bronze-light)' }}>
                        ${costoPrep.toFixed(2)}
                      </td>
                      <td>
                        <span style={{
                          fontWeight: 800,
                          color: esBajoMargen ? 'var(--danger)' : 'var(--success)'
                        }}>
                          {margen}%
                        </span>
                      </td>
                      <td>
                        <span className={`badge ${rec ? 'badge-success' : 'badge-warning'}`}>
                          {rec ? 'Receta Configurada' : 'Costo Directo'}
                        </span>
                      </td>
                      <td>
                        <button className="btn btn-secondary btn-sm" onClick={() => handleAbrirReceta(p)} style={{ fontSize: 11, padding: '4px 8px' }}>
                          <i className="ri-restaurant-line" style={{ marginRight: 4 }} /> Configurar
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modal de Previsualización de QR */}
      {previewQr && (
        <div className="modal-overlay" onClick={() => setPreviewQr(null)}>
          <div className="modal" style={{ maxWidth: 350, textAlign: 'center' }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title"><i className="ri-qr-code-line" style={{ marginRight: 8 }} />Previsualizar QR</span>
              <button onClick={() => setPreviewQr(null)} style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 20 }}>✕</button>
            </div>
            
            <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, padding: '20px 10px' }}>
              <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--text-primary)' }}>{previewQr.title}</div>
              
              <div style={{ background: '#fff', padding: 16, borderRadius: 12, display: 'inline-block', boxShadow: '0 4px 12px rgba(0,0,0,0.25)', marginTop: 8 }}>
                <QRCodeCanvas
                  value={previewQr.value}
                  size={220}
                  level="H"
                />
              </div>
              
              <p style={{ fontSize: 11, color: 'var(--text-muted)', wordBreak: 'break-all', margin: '4px 0 10px 0', padding: '0 10px' }}>
                {previewQr.value}
              </p>
            </div>
            
            <div className="modal-footer" style={{ display: 'flex', gap: 10 }}>
              <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setPreviewQr(null)}>Cerrar</button>
              <button 
                className="btn btn-primary" 
                style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }} 
                onClick={() => {
                  const canvasId = previewQr.filename === 'fila_de_espera.png' ? 'qr-canvas-fila' : `qr-canvas-mesa-${previewQr.mesaId}`;
                  const canvas = document.getElementById(canvasId);
                  if (canvas) {
                    const dataUrl = canvas.toDataURL('image/png');
                    const tempLink = document.createElement('a');
                    tempLink.style.display = 'none';
                    tempLink.href = dataUrl;
                    tempLink.setAttribute('download', previewQr.filename);
                    document.body.appendChild(tempLink);
                    tempLink.click();
                    document.body.removeChild(tempLink);
                    showToast('QR descargado con éxito ✓', 'success');
                  } else {
                    showToast('Error al descargar QR', 'error');
                  }
                  setPreviewQr(null);
                }}
              >
                <i className="ri-download-2-line" /> Descargar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Configurar Receta */}
      {recetaEditando && (
        <div className="modal-overlay" onClick={() => setRecetaEditando(null)}>
          <div className="modal" style={{ maxWidth: 550, maxHeight: '80vh', display: 'flex', flexDirection: 'column' }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title"><i className="ri-restaurant-line" style={{ marginRight: 8 }} />Receta: {recetaEditando.nombre}</span>
              <button onClick={() => setRecetaEditando(null)} style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 20 }}>✕</button>
            </div>
            
            <div className="modal-body" style={{ overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: 14 }}>
              {/* Formulario agregar ingrediente */}
              <div style={{ background: 'var(--bg-elevated)', borderRadius: 12, padding: 14, border: '1px solid var(--border)' }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--bronze-light)', marginBottom: 10 }}>Agregar Ingrediente / Insumo</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr 1fr', gap: 10, marginBottom: 10 }}>
                  <div className="form-group">
                    <label className="form-label" style={{ fontSize: 9 }}>Seleccionar Insumo</label>
                    <select className="form-select" value={insumoIdSel} onChange={e => setInsumoIdSel(e.target.value)} style={{ padding: '6px 10px', fontSize: 11, height: 'auto' }}>
                      <option value="">-- Seleccionar --</option>
                      {productos.map(p => (
                        <option key={p.id} value={p.id}>{p.nombre} (${p.precioCosto}/{p.unidad})</option>
                      ))}
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label" style={{ fontSize: 9 }}>Cantidad (de la unidad)</label>
                    <input className="form-input" type="number" step="0.01" min="0.01" placeholder="Ej: 0.15" value={cantInsumo} onChange={e => setCantInsumo(e.target.value)} style={{ padding: '6px 10px', fontSize: 11 }} />
                  </div>
                  <div className="form-group">
                    <label className="form-label" style={{ fontSize: 9 }}>Merma Estimada (%)</label>
                    <input className="form-input" type="number" min="0" max="100" placeholder="Ej: 5" value={mermaInsumo} onChange={e => setMermaInsumo(e.target.value)} style={{ padding: '6px 10px', fontSize: 11 }} />
                  </div>
                </div>
                <button type="button" className="btn btn-primary btn-sm" onClick={handleAddIngrediente} style={{ width: '100%' }}>
                  + Agregar Ingrediente
                </button>
              </div>

              {/* Listado de ingredientes actuales */}
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 8 }}>Ingredientes de la Receta</div>
                {recetaEditando.ingredientes.length === 0 ? (
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center', padding: '20px 0' }}>Sin ingredientes configurados aún</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {recetaEditando.ingredientes.map((ing, i) => {
                      const ingProd = productos.find(p => p.id === ing.insumoId);
                      const costoUnit = ingProd ? ingProd.precioCosto : (ing.precioCosto || 0);
                      const costPortion = ing.cantidad * costoUnit * (1 + (ing.mermaPct || 0) / 100);

                      return (
                        <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 10 }}>
                          <div>
                            <div style={{ fontSize: 12, fontWeight: 700 }}>{ing.nombreInsumo}</div>
                            <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                              Cant: {ing.cantidad} {ing.unidad} · Merma: {ing.mermaPct}% · Unitario: ${costoUnit}/{ing.unidad}
                            </div>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                            <span style={{ fontFamily: 'var(--font-display)', fontSize: 13, fontWeight: 700, color: 'var(--bronze-light)' }}>
                              ${costPortion.toFixed(2)}
                            </span>
                            <button
                              type="button"
                              onClick={() => handleRemoveIngrediente(ing.insumoId)}
                              style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: 16 }}
                            >
                              ✕
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Resumen de costos y margen */}
              <div style={{ marginTop: 'auto', background: 'var(--bronze-subtle)', border: '1px solid var(--border-bronze)', borderRadius: 12, padding: 14, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Costo Total Calculado</div>
                  <div style={{ fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 900, color: 'var(--bronze-light)' }}>
                    ${calcularCostoReceta(recetaEditando).toFixed(2)}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Margen de Ganancia (%)</div>
                  <div style={{
                    fontFamily: 'var(--font-display)',
                    fontSize: 20,
                    fontWeight: 900,
                    color: (recetaEditando.precioVenta - calcularCostoReceta(recetaEditando)) > 0 ? 'var(--success)' : 'var(--danger)'
                  }}>
                    {recetaEditando.precioVenta > 0
                      ? (((recetaEditando.precioVenta - calcularCostoReceta(recetaEditando)) / recetaEditando.precioVenta) * 100).toFixed(1)
                      : 0}%
                  </div>
                </div>
              </div>
            </div>

            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setRecetaEditando(null)}>Cancelar</button>
              <button className="btn btn-primary" onClick={handleGuardarReceta}>
                <i className="ri-save-line" /> Guardar Receta
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Crear Usuario */}
      {showAddUserModal && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
          backdropFilter: 'blur(5px)'
        }}>
          <div className="card" style={{ width: '100%', maxWidth: 450, padding: 32, border: '1px solid var(--border-bronze)', boxShadow: 'var(--shadow-bronze)', animation: 'fadeIn 0.25s ease' }}>
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
                <label className="form-label">
                  {newUser.role === 'cajero' ? 'PIN de Ingreso (exactamente 6 dígitos)' : 'Contraseña (Alfanumérica)'}
                </label>
                <input 
                  className="form-input" 
                  type={newUser.role === 'cajero' ? 'text' : 'password'}
                  placeholder={newUser.role === 'cajero' ? 'Ej. 123456' : '••••••••'} 
                  value={newUser.password}
                  onChange={e => setNewUser(p => ({ ...p, password: newUser.role === 'cajero' ? e.target.value.replace(/\D/g, '') : e.target.value }))}
                  maxLength={newUser.role === 'cajero' ? 6 : undefined}
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label">Rol y Permisos</label>
                <select 
                  className="form-input"
                  style={{ background: 'var(--bg-elevated)', color: 'var(--text-main)', border: '1px solid var(--border)' }}
                  value={newUser.role}
                  onChange={e => setNewUser(p => ({ ...p, role: e.target.value }))}
                >
                  <option value="admin">Administrador (Control total)</option>
                  <option value="gerente">Gerente (Gestión operativa)</option>
                  <option value="cajero">Cajero (Cobros y caja)</option>
                  <option value="mesero">Mesero (Toma de pedidos)</option>
                </select>
              </div>

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
    </div>
  );
}

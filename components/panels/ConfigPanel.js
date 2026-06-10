'use client';
import { useState, useEffect } from 'react';
import { db } from '@/lib/firebase';
import { collection, getDocs, addDoc, query, orderBy, deleteDoc, doc, where, setDoc, serverTimestamp } from 'firebase/firestore';
import { obfuscate, deobfuscate } from '@/lib/crypto';

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

  useEffect(() => {
    fetchUsuarios();
    if (typeof window !== 'undefined') {
      try {
        const savedMesas = localStorage.getItem('yoy_billar_mesas');
        if (savedMesas) {
          setMesas(deobfuscate(savedMesas) || []);
        } else {
          const defaultMesas = [
            { id: 1, nombre: 'Mesa 1', tipo: 'Carambola', estado: 'libre', cliente: null, inicio: null, tarifa: 80, socios: false },
            { id: 2, nombre: 'Mesa 2', tipo: 'Carambola', estado: 'libre', cliente: null, inicio: null, tarifa: 80, socios: false },
            { id: 3, nombre: 'Mesa 3', tipo: 'Pool', estado: 'libre', cliente: null, inicio: null, tarifa: 60, socios: false },
            { id: 4, nombre: 'Mesa 4', tipo: 'Pool', estado: 'libre', cliente: null, inicio: null, tarifa: 60, socios: false },
            { id: 5, nombre: 'Mesa 5', tipo: 'Snooker', estado: 'libre', cliente: null, inicio: null, tarifa: 100, socios: false },
          ];
          setMesas(defaultMesas);
          localStorage.setItem('yoy_billar_mesas', obfuscate(defaultMesas));
        }

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
            { id: 1, nombre: 'Cerveza Corona Extra', categoria: 'Cerveza', precioCosto: 22, precioVenta: 45, stock: 120, stockMin: 30, stockOptimo: 150, unidad: 'bot' },
            { id: 2, nombre: 'Refresco Coca-Cola 355ml', categoria: 'Refresco', precioCosto: 14, precioVenta: 30, stock: 80, stockMin: 20, stockOptimo: 100, unidad: 'pz' },
            { id: 3, nombre: 'Nachos con Queso Gigantes', categoria: 'Snack', precioCosto: 32, precioVenta: 75, stock: 50, stockMin: 15, stockOptimo: 60, unidad: 'porc' },
            { id: 4, nombre: 'Papas Fritas Crujientes', categoria: 'Snack', precioCosto: 20, precioVenta: 55, stock: 40, stockMin: 12, stockOptimo: 50, unidad: 'porc' },
            { id: 5, nombre: 'Alitas de Pollo x10', categoria: 'Comida', precioCosto: 58, precioVenta: 120, stock: 35, stockMin: 10, stockOptimo: 45, unidad: 'pz' },
            { id: 6, nombre: 'Café Americano Organico', categoria: 'Bebida', precioCosto: 12, precioVenta: 35, stock: 100, stockMin: 25, stockOptimo: 120, unidad: 'taza' },
            { id: 7, nombre: 'Agua Embotellada 600ml', categoria: 'Bebida', precioCosto: 8, precioVenta: 20, stock: 150, stockMin: 40, stockOptimo: 180, unidad: 'pz' },
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
  }, []);

  const handleAddUser = async (e) => {
    e.preventDefault();
    if (!newUser.name || !newUser.email || !newUser.password) {
      showToast('Por favor completa todos los campos', 'error');
      return;
    }

    let formattedEmail = newUser.email.trim().toLowerCase();
    if (!formattedEmail.includes('@')) {
      formattedEmail = `${formattedEmail}@yoybillar.mx`;
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

      await addDoc(collection(db, 'users'), {
        name: newUser.name,
        email: formattedEmail,
        password: newUser.password,
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

  const defaultDemos = [
    { name: 'Administrador', email: 'admin@yoybillar.mx', role: 'admin' },
    { name: 'Gerente Turno', email: 'gerente@yoybillar.mx', role: 'gerente' },
    { name: 'Cajero Principal', email: 'cajero@yoybillar.mx', role: 'cajero' },
    { name: 'Mesero #1', email: 'mesero@yoybillar.mx', role: 'mesero' },
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
    if (!nuevaMesa.id || !nuevaMesa.nombre || !nuevaMesa.tarifa) {
      showToast('Completa todos los campos para guardar la mesa', 'warning');
      return;
    }

    const mesaId = parseInt(nuevaMesa.id);
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
      setEditingMesaId(null);
      setNuevaMesa({ id: '', nombre: '', tarifa: '', tipo: 'Pool' });
      showToast('Mesa modificada correctamente', 'success');
    } else {
      if (mesas.some(m => m.id === mesaId)) {
        showToast('Ya existe una mesa con ese número / ID', 'danger');
        return;
      }
      const nueva = {
        id: mesaId,
        nombre: nuevaMesa.nombre,
        tipo: nuevaMesa.tipo,
        estado: 'libre',
        cliente: null,
        inicio: null,
        tarifa: mesaTarifa,
        socios: false
      };
      const updated = [...mesas, nueva].sort((a, b) => a.id - b.id);
      setMesas(updated);
      localStorage.setItem('yoy_billar_mesas', obfuscate(updated));
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

  const imprimirQRs = (mesaId) => {
    showToast(mesaId ? `Imprimiendo código QR para Mesa ${mesaId}...` : 'Enviando todos los códigos QR a la cola de impresión...', 'success');
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
                  { label: 'Nombre del Negocio', key: 'nombre' },
                  { label: 'Dirección', key: 'direccion' },
                  { label: 'Teléfono', key: 'telefono' },
                ].map(f => (
                  <div key={f.key} className="form-group">
                    <label className="form-label">{f.label}</label>
                    <input className="form-input" value={sucursal[f.key]} onChange={e => setSucursal(p => ({ ...p, [f.key]: e.target.value }))} />
                  </div>
                ))}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <div className="form-group">
                    <label className="form-label">Apertura</label>
                    <input className="form-input" type="time" value={sucursal.horarioApertura} onChange={e => setSucursal(p => ({ ...p, horarioApertura: e.target.value }))} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Cierre</label>
                    <input className="form-input" type="time" value={sucursal.horarioCierre} onChange={e => setSucursal(p => ({ ...p, horarioCierre: e.target.value }))} />
                  </div>
                </div>
                <button className="btn btn-primary" onClick={() => guardar('sucursal')}>
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
                      placeholder="Num"
                      value={nuevaMesa.id}
                      onChange={e => setNuevaMesa(p => ({ ...p, id: e.target.value }))}
                      disabled={editingMesaId !== null}
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Nombre</label>
                    <input
                      className="form-input"
                      placeholder="Ej: Mesa 1"
                      value={nuevaMesa.nombre}
                      onChange={e => setNuevaMesa(p => ({ ...p, nombre: e.target.value }))}
                      required
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
              <div style={{ maxHeight: 220, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
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
              <button
                className="btn btn-primary"
                onClick={() => imprimirQRs(null)}
                style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, marginBottom: 16 }}
              >
                <i className="ri-printer-line" /> Imprimir Todos los QRs
              </button>
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 310, overflowY: 'auto' }}>
                {mesas.map(m => (
                  <div key={m.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 10 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <img src={`https://api.qrserver.com/v1/create-qr-code/?size=60x60&data=${encodeURIComponent('https://yoy-ia-billar.vercel.app/mesa/' + m.id)}`} width="36" height="36" style={{ borderRadius: 6, background: '#fff', padding: 2 }} />
                      <div>
                        <span style={{ fontSize: 13, fontWeight: 700 }}>{m.nombre}</span>
                        <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>Mesa ID: {m.id}</div>
                      </div>
                    </div>
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={() => imprimirQRs(m.id)}
                      style={{ fontSize: 11, padding: '4px 10px' }}
                    >
                      <i className="ri-printer-line" /> Imprimir
                    </button>
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
                  Nota: El pie de página centralizado <strong>"YoY IA by Alfonso Iturbide"</strong> es un sello obligatorio de YoY IA y no puede ser alterado ni desactivado.
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
                  placeholder="Ej. juan (se autocompleta a juan@yoybillar.mx)" 
                  value={newUser.email}
                  onChange={e => setNewUser(p => ({ ...p, email: e.target.value }))}
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label">Contraseña / PIN de Ingreso</label>
                <input 
                  className="form-input" 
                  type="password"
                  placeholder="••••••••" 
                  value={newUser.password}
                  onChange={e => setNewUser(p => ({ ...p, password: e.target.value }))}
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

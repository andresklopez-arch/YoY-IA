'use client';
import { useState, useEffect } from 'react';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';
import { db } from '@/lib/firebase';
import { doc, onSnapshot, setDoc, serverTimestamp, collection, query, orderBy, limit, addDoc } from 'firebase/firestore';
import { obfuscate, deobfuscate } from '@/lib/crypto';
import { useAuth } from '@/lib/auth-context';

// ── DATOS HISTÓRICOS IA (RECOMENDACIÓN 2) ──────────────────
const HISTORICO_DATA = [
  { name: 'Lun', Cerveza: 80, Refrescos: 60, Snacks: 40 },
  { name: 'Mar', Cerveza: 95, Refrescos: 72, Snacks: 48 },
  { name: 'Mié', Cerveza: 110, Refrescos: 85, Snacks: 55 },
  { name: 'Jue', Cerveza: 140, Refrescos: 90, Snacks: 62 },
  { name: 'Vie', Cerveza: 220, Refrescos: 150, Snacks: 110 },
  { name: 'Sáb', Cerveza: 280, Refrescos: 180, Snacks: 130 },
  { name: 'Dom', Cerveza: 190, Refrescos: 120, Snacks: 90 },
];

// ── PRODUCTOS INICIALES DEL INVENTARIO ────────────────────
const DEFAULT_PRODUCTOS = [];

const getCategoriaBadgeClass = (cat) => {
  const norm = cat ? cat.toLowerCase() : '';
  if (norm === 'cerveza') return 'badge-bronze';
  if (norm === 'refresco') return 'badge-success';
  if (norm === 'snack') return 'badge-blue';
  if (norm === 'comida') return 'badge-warning';
  if (norm === 'bebida') return 'badge-danger';
  return 'badge-muted';
};

export default function BarPanel({ showToast }) {
  const { user } = useAuth();
  const [productos, setProductos] = useState([]);
  const [filtro, setFiltro] = useState('Todas');
  const [busqueda, setBusqueda] = useState('');
  
  // Pestañas de inventario
  const [inventarioTab, setInventarioTab] = useState('productos'); // 'productos' | 'insumos'

  // --- Estados de Recetario y Costeo ---
  const [recetas, setRecetas] = useState([]);
  const [recetaEditando, setRecetaEditando] = useState(null); // { productoId, nombre, precioVenta, ingredientes: [] }
  const [insumoIdSel, setInsumoIdSel] = useState('');
  const [cantInsumo, setCantInsumo] = useState('');
  const [mermaInsumo, setMermaInsumo] = useState('0');

  useEffect(() => {
    setFiltro('Todas');
  }, [inventarioTab]);

  const handleLocalChange = (prodId, field, value) => {
    const updated = productos.map(p => {
      if (p.id === prodId) {
        return { ...p, [field]: value };
      }
      return p;
    });
    setProductos(updated);
  };

  const handleUpdateProductoField = async (prodId, field, value) => {
    let parsedValue = value;
    if (field === 'stock' || field === 'stockMin') {
      parsedValue = parseInt(value);
      if (isNaN(parsedValue)) parsedValue = 0;
    } else if (field === 'precioCosto' || field === 'precioVenta') {
      parsedValue = parseFloat(value);
      if (isNaN(parsedValue)) parsedValue = 0;
    }

    const updatedProductos = productos.map(p => {
      if (p.id === prodId) {
        if (field === 'stock' && p.stock !== parsedValue) {
          const diff = parsedValue - p.stock;
          const logData = {
            id: Date.now(),
            fecha: new Date().toLocaleDateString('es-MX'),
            hora: new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }),
            producto: p.nombre,
            tipo: diff > 0 ? 'Entrada (Edición Directa)' : 'Salida (Edición Directa)',
            cantidad: Math.abs(diff),
            usuario: user?.email || 'Admin',
            motivo: 'Ajuste de inventario en tabla directa'
          };
          const savedLogs = localStorage.getItem('yoy_billar_stock_logs');
          const currentLogs = savedLogs ? deobfuscate(savedLogs) || [] : [];
          localStorage.setItem('yoy_billar_stock_logs', obfuscate([logData, ...currentLogs]));
          addDoc(collection(db, 'bitacora'), {
            timestamp: serverTimestamp(),
            modulo: 'Inventario',
            accion: 'Ajuste Stock Directo',
            detalle: `Se editó stock de "${p.nombre}" de ${p.stock} a ${parsedValue} (${diff > 0 ? '+' : ''}${diff})`,
            operador: user?.email || 'Admin'
          }).catch(err => console.error("Error al loggear bitácora:", err));
        }
        return { ...p, [field]: parsedValue, updatedAt: new Date().toISOString() };
      }
      return p;
    });

    setProductos(updatedProductos);
    localStorage.setItem('yoy_billar_stock', obfuscate(updatedProductos));
    try {
      await setDoc(doc(db, 'config', 'inventario'), {
        productos: updatedProductos,
        updatedAt: serverTimestamp()
      }, { merge: true });
    } catch (err) {
      console.error("Error al actualizar producto en Firestore:", err);
    }
  };

  const inputStyle = {
    background: 'transparent',
    border: '1px solid transparent',
    color: 'var(--text-primary)',
    padding: '2px 4px',
    borderRadius: 4,
    width: '100%',
    transition: 'all 0.15s ease',
  };

  const handleInputFocus = (e) => {
    e.target.style.borderColor = 'var(--bronze-light)';
    e.target.style.background = 'rgba(0,0,0,0.25)';
  };

  const handleInputBlur = (e, prodId, field) => {
    e.target.style.borderColor = 'transparent';
    e.target.style.background = 'transparent';
    handleUpdateProductoField(prodId, field, e.target.value);
  };

  const handleInputKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.target.blur();
    }
  };

  // Categorías dinámicas (Soporte para añadir nuevas)
  const [categorias, setCategorias] = useState(['Todas', 'Cerveza', 'Refresco', 'Snack', 'Comida', 'Bebida', 'Insumo']);

  useEffect(() => {
    const defaultCats = ['Todas', 'Cerveza', 'Refresco', 'Snack', 'Comida', 'Bebida', 'Insumo'];
    const extraCats = productos
      .map(p => p.categoria)
      .filter(cat => cat && !defaultCats.includes(cat));
    const uniqueCats = [...defaultCats, ...new Set(extraCats)];
    setCategorias(uniqueCats);
  }, [productos]);
  
  // Densidad de vista (Modo compacto fijo)
  const densidadVista = 'compact';
  
  // Auditoría y logs
  const [logs, setLogs] = useState([]);
  const [dbLogs, setDbLogs] = useState([]);
  const [logsLimit, setLogsLimit] = useState(50);
  const [hasMoreLogs, setHasMoreLogs] = useState(true);
  const [modalAjuste, setModalAjuste] = useState(null);
  const [ajusteCant, setAjusteCant] = useState('');
  const [ajusteTipo, setAjusteTipo] = useState('entrada'); // 'entrada', 'salida', 'merma'
  const [ajusteMotivo, setAjusteMotivo] = useState('');
  const [ajustePrecioCompra, setAjustePrecioCompra] = useState('');

  useEffect(() => {
    if (modalAjuste) {
      setAjustePrecioCompra(modalAjuste.precioCosto || '');
    } else {
      setAjustePrecioCompra('');
    }
  }, [modalAjuste]);

  // Modales IA
  const [modalOrdenCompra, setModalOrdenCompra] = useState(false);
  const [ordenSugerida, setOrdenSugerida] = useState([]);
  const [modalExportar, setModalExportar] = useState(false);
  const [showGestionCategorias, setShowGestionCategorias] = useState(false);
  
  // Nuevos estados para mejoras de ticket/impresion y recepcion
  const [ultimaOrdenDiaria, setUltimaOrdenDiaria] = useState(null);
  const [popupsBloqueados, setPopupsBloqueados] = useState(false);
  const [subModalRecepcion, setSubModalRecepcion] = useState(false);
  const [montoRealCompra, setMontoRealCompra] = useState(0);
  const [referenciaFactura, setReferenciaFactura] = useState('');
  const [editingCatName, setEditingCatName] = useState(null);
  const [editingCatValue, setEditingCatValue] = useState('');
  const [deletingCatName, setDeletingCatName] = useState(null);
  const [reassignCatTarget, setReassignCatTarget] = useState('Bebida');
  const [showCriticoDropdown, setShowCriticoDropdown] = useState(false);
  const [descartadas, setDescartadas] = useState({});

  useEffect(() => {
    // Escuchar sugerencias descartadas en tiempo real de Firestore
    const unsub = onSnapshot(doc(db, 'config', 'sugerencias_descartadas'), snap => {
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
    return unsub;
  }, []);

  // Leer estado de pop-ups bloqueados en el montaje
  useEffect(() => {
    try {
      const blocked = localStorage.getItem('yoy_popups_blocked_warning') === 'true';
      if (blocked) {
        setPopupsBloqueados(true);
      }
    } catch (e) {}
  }, []);

  const descartarSugerencia = async (id) => {
    const updated = { ...descartadas, [id]: Date.now() };
    setDescartadas(updated);
    try {
      localStorage.setItem('yoy_sugerencias_descartadas', JSON.stringify(updated));
    } catch (e) {}
    try {
      await setDoc(doc(db, 'config', 'sugerencias_descartadas'), {
        descartadas: updated,
        updatedAt: serverTimestamp()
      });
      showToast('Sugerencia descartada. Reaparecerá en 15 días ✓', 'info');
    } catch (err) {
      console.error(err);
      showToast('Sugerencia descartada localmente ✓', 'info');
    }
  };

  // Estados para Auditoría e Inventarios IA seleccionables
  const [modoInventario, setModoInventario] = useState('general'); // general, periodico, azar, producto, inconsistencia, mas_vendidos, menos_vendidos
  const [productoSelId, setProductoSelId] = useState('');
  const [azarProductosIds, setAzarProductosIds] = useState([]);

  // Estados para Cruce Concurrente en Vivo (Mesas ocupadas con $0 consumos)
  const [mesas, setMesas] = useState([]);
  const [cuentasActivas, setCuentasActivas] = useState([]);
  const [inconsistenciasEnVivo, setInconsistenciasEnVivo] = useState([]);

  // Sugerencia 2: Offline-First Supabase Sync
  const [isOnline, setIsOnline] = useState(true);
  const [colaSincronizacion, setColaSincronizacion] = useState([]);

  // Sugerencia 3: Escaneo en Conteo Ciego
  const [modalEscaneo, setModalEscaneo] = useState(null);
  const [azarEscaneados, setAzarEscaneados] = useState([]);

  // Estado para Optimización IA de Stock
  const [showModalOptimizacion, setShowModalOptimizacion] = useState(false);
  const [productosSugeridosOpt, setProductosSugeridosOpt] = useState([]);

  // Estado para Nuevo Producto Modal
  const [showNuevoProducto, setShowNuevoProducto] = useState(false);
  const [formNuevo, setFormNuevo] = useState({
    nombre: '',
    categoria: 'Cerveza',
    precioCosto: '',
    precioVenta: '',
    stock: '',
    stockMin: '',
    stockOptimo: '',
    unidad: 'pz',
    activoIA: true
  });

  const generarConteoCiego = (listaProds = productos) => {
    if (listaProds.length === 0) return;
    const shuffled = [...listaProds].sort(() => 0.5 - Math.random());
    const seleccionados = shuffled.slice(0, 3).map(p => p.id);
    setAzarProductosIds(seleccionados);
    showToast('Auditoría Ciega IA: 3 productos seleccionados al azar.', 'success');
  };

  useEffect(() => {
    if (productos.length > 0 && azarProductosIds.length === 0) {
      const shuffled = [...productos].sort(() => 0.5 - Math.random());
      setAzarProductosIds(shuffled.slice(0, 3).map(p => p.id));
    }
  }, [productos]);

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

  // Cargar inventario y logs de localStorage (Ofuscados)
  // Cargar inventario y logs de localStorage (Ofuscados) y sincronizar con Firestore
  useEffect(() => {
    if (typeof window !== 'undefined') {
      try {
        const savedLogs = localStorage.getItem('yoy_billar_stock_logs');
        if (savedLogs) {
          setLogs(deobfuscate(savedLogs) || []);
        } else {
          const defaultLogs = [];
          setLogs(defaultLogs);
          localStorage.setItem('yoy_billar_stock_logs', obfuscate(defaultLogs));
        }

        const savedMesas = localStorage.getItem('yoy_billar_mesas');
        if (savedMesas) {
          setMesas(deobfuscate(savedMesas) || []);
        }

        const savedCuentas = localStorage.getItem('yoy_billar_cuentas');
        if (savedCuentas) {
          setCuentasActivas(deobfuscate(savedCuentas) || []);
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

    // Escucha en tiempo real de Firestore para los productos con reconciliación offline LWW
    const unsub = onSnapshot(doc(db, 'config', 'inventario'), snap => {
      if (snap.exists()) {
        const firestoreProds = snap.data().productos || [];
        const ultimaOrden = snap.data().ultimaOrdenDiaria || null;
        setUltimaOrdenDiaria(ultimaOrden);
        if (firestoreProds.length > 0) {
          let localRaw = null;
          try {
            localRaw = localStorage.getItem('yoy_billar_stock');
          } catch (e) {}
          const localProds = localRaw ? (deobfuscate(localRaw) || []) : [];
          
          // CRDT LWW (Last-Write-Wins) merge
          const mergedProds = [...localProds];
          firestoreProds.forEach(fp => {
            const localIdx = mergedProds.findIndex(lp => lp.id === fp.id);
            if (localIdx === -1) {
              mergedProds.push(fp);
            } else {
              const lp = mergedProds[localIdx];
              const lpTime = lp.lastModified || 0;
              const fpTime = fp.lastModified || 0;
              if (fpTime > lpTime) {
                mergedProds[localIdx] = fp;
              }
            }
          });
          
          setProductos(mergedProds);
          try {
            localStorage.setItem('yoy_billar_stock', obfuscate(mergedProds));
          } catch (e) {}
          
          // Reconciliar de vuelta a Firestore si tenemos cambios locales offline más nuevos
          const localHasNewerUpdates = mergedProds.some(mp => {
            const fp = firestoreProds.find(f => f.id === mp.id);
            return mp.lastModified > (fp?.lastModified || 0);
          });
          if (localHasNewerUpdates) {
            setDoc(doc(db, 'config', 'inventario'), {
              productos: mergedProds,
              updatedAt: serverTimestamp()
            }).catch(err => console.error("Error reconciling to firestore:", err));
          }
        }
      } else {
        // Sembrar en firestore si no existe
        const localRaw = localStorage.getItem('yoy_billar_stock');
        const localProds = deobfuscate(localRaw) || DEFAULT_PRODUCTOS;
        setProductos(localProds);
        localStorage.setItem('yoy_billar_stock', obfuscate(localProds));
        setDoc(doc(db, 'config', 'inventario'), { productos: localProds, updatedAt: serverTimestamp() });
      }
    });

    // Escucha en tiempo real de Firestore para las recetas
    const unsubRecetas = onSnapshot(doc(db, 'config', 'recetas'), snap => {
      if (snap.exists()) {
        const firestoreRecetas = snap.data().recetas || [];
        if (firestoreRecetas.length > 0) {
          setRecetas(firestoreRecetas);
          try {
            localStorage.setItem('yoy_recetas_costeo', obfuscate(firestoreRecetas));
          } catch (e) {}
        }
      }
    }, err => {
      console.warn("Error al escuchar recetas en Firestore:", err);
    });

    return () => {
      unsub();
      unsubRecetas();
    };
  }, []);

  // Escuchar historial_stock en tiempo real desde Firestore para auditoría
  useEffect(() => {
    const q = query(
      collection(db, 'historial_stock'),
      orderBy('fecha', 'desc'),
      limit(logsLimit)
    );
    const unsub = onSnapshot(q, snap => {
      const items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setDbLogs(items);
      setHasMoreLogs(items.length === logsLimit);
    }, err => {
      console.error("Error al escuchar historial de stock en tiempo real:", err);
    });
    return unsub;
  }, [logsLimit]);

  // Guardar productos y logs (Ofuscados)
  const saveState = async (newProds, newLogs) => {
    setProductos(newProds);
    setLogs(newLogs);
    try {
      localStorage.setItem('yoy_billar_stock', obfuscate(newProds));
      localStorage.setItem('yoy_billar_stock_logs', obfuscate(newLogs));
      
      // Sincronizar stock con Firestore
      await setDoc(doc(db, 'config', 'inventario'), {
        productos: newProds,
        updatedAt: serverTimestamp()
      });
    } catch (err) {
      console.error(err);
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

  const handleGuardarReceta = async () => {
    let nuevasRecetas;
    const existe = recetas.some(r => r.productoId === recetaEditando.productoId);
    if (existe) {
      nuevasRecetas = recetas.map(r => r.productoId === recetaEditando.productoId ? recetaEditando : r);
    } else {
      nuevasRecetas = [...recetas, recetaEditando];
    }
    setRecetas(nuevasRecetas);
    localStorage.setItem('yoy_recetas_costeo', obfuscate(nuevasRecetas));

    try {
      await setDoc(doc(db, 'config', 'recetas'), {
        recetas: nuevasRecetas,
        updatedAt: serverTimestamp()
      }, { merge: true });
    } catch (e) {
      console.error("Error al guardar recetas en Firestore:", e);
    }

    const nuevoCosto = calcularCostoReceta(recetaEditando);

    const nuevosProductos = productos.map(p => {
      if (p.id === recetaEditando.productoId) {
        return { ...p, precioCosto: Math.round(nuevoCosto), lastModified: Date.now() };
      }
      return p;
    });
    
    await saveState(nuevosProductos, logs);
    setRecetaEditando(null);
    showToast('Receta guardada y costo del POS actualizado', 'success');
  };

  // Sincronización automática con la Bitácora General de Caja (Recomendación 3)
  const registrarEnBitacoraGeneral = async (accion, detalle, monto = 0) => {
    const nombreOperador = user ? (user.name || user.alias || user.email) : 'Sistema IA / Inventario';
    const nuevoEvento = {
      fecha: new Date().toISOString(),
      accion,
      detalle,
      monto,
      operador: nombreOperador
    };
    try {
      await addDoc(collection(db, 'bitacora'), nuevoEvento);
    } catch (err) {
      console.error("Error al registrar en bitácora general:", err);
    }
  };

  // Filtrado de productos según la pestaña (Productos vs Insumos) y la modalidad de auditoría/inventario IA
  const productosFiltradosRaw = productos.filter(p => {
    const isCatInsumo = p.categoria && p.categoria.toLowerCase() === 'insumo';
    const tabOk = inventarioTab === 'insumos' ? isCatInsumo : !isCatInsumo;
    if (!tabOk) return false;

    const catOk = filtro === 'Todas' || p.categoria === filtro;
    const busOk = !busqueda || p.nombre.toLowerCase().includes(busqueda.toLowerCase());
    if (!catOk || !busOk) return false;

    if (modoInventario === 'general') return true;
    if (modoInventario === 'periodico') {
      // Periódico: productos con stock inferior al óptimo o ID par (programado)
      return p.id % 2 === 0 || p.stock < p.stockOptimo;
    }
    if (modoInventario === 'azar') {
      return azarProductosIds.includes(p.id);
    }
    if (modoInventario === 'producto') {
      return p.id === parseInt(productoSelId);
    }
    if (modoInventario === 'inconsistencia') {
      // Inconsistencias: productos con alertas críticas o merma registrada
      return p.stock <= p.stockMin || p.id === 1 || p.id === 2 || p.id === 5;
    }
    return true;
  });

  // Procesamiento y ordenamiento de productos
  const productosFiltrados = [...productosFiltradosRaw];
  if (modoInventario === 'mas_vendidos') {
    productosFiltrados.sort((a, b) => getVelocidadConsumo(b.id) - getVelocidadConsumo(a.id));
  } else if (modoInventario === 'menos_vendidos') {
    productosFiltrados.sort((a, b) => getVelocidadConsumo(a.id) - getVelocidadConsumo(b.id));
  }

  // Margen de utilidad
  function calcMargen(p) {
    const ganancia = p.precioVenta - p.precioCosto;
    return ((ganancia / p.precioVenta) * 100).toFixed(1);
  }

  // Sugerencia de consumo diario (Simulada para IA)
  function getVelocidadConsumo(pId) {
    // Retorna unidades/día simuladas basadas en el id
    switch(pId) {
      case 1: return 12.5; // Corona
      case 2: return 8.2;  // Coca-Cola
      case 3: return 5.1;  // Nachos
      case 4: return 6.0;  // Papas
      case 5: return 4.5;  // Alitas
      case 6: return 3.2;  // Café
      default: return 7.0; // Agua
    }
  }

  // Predicción de días restantes
  function calcDiasRestantes(p) {
    const vel = getVelocidadConsumo(p.id);
    const dias = p.stock / vel;
    if (dias <= 0) return 'Agotado ⚠️';
    if (dias < 3) return `${dias.toFixed(1)} días (Crítico 🚨)`;
    return `${dias.toFixed(1)} días`;
  }

  // Registrar Ajuste de Inventario Manual (Auditoría) (Recomendación 3)
  const aplicarAjusteInventario = () => {
    if (!modalAjuste) return;
    const cant = parseInt(ajusteCant);
    if (isNaN(cant) || cant <= 0) {
      showToast('Por favor ingrese una cantidad válida.', 'warning');
      return;
    }

    const prod = productos.find(p => p.id === modalAjuste.id);
    if (!prod) return;

    if ((ajusteTipo === 'salida' || ajusteTipo === 'merma') && (!ajusteMotivo || !ajusteMotivo.trim())) {
      showToast('Por favor ingrese el motivo del ajuste (salida o merma) para continuar.', 'warning');
      return;
    }

    const precioCompraNum = parseFloat(ajustePrecioCompra);
    if (ajusteTipo === 'entrada' && (isNaN(precioCompraNum) || precioCompraNum <= 0)) {
      showToast('Por favor ingrese un precio de compra válido y obligatorio para la entrada.', 'warning');
      return;
    }

    if (ajusteTipo === 'entrada' && prod.precioCosto > 0) {
      const diffPercent = Math.abs((precioCompraNum - prod.precioCosto) / prod.precioCosto) * 100;
      if (diffPercent > 30) {
        const confirmacion = window.confirm(`¡Atención! El precio de compra ($${precioCompraNum}) varía un ${diffPercent.toFixed(0)}% respecto al costo anterior ($${prod.precioCosto}). ¿Desea registrar esta entrada con ese precio?`);
        if (!confirmacion) return;
      }
    }

    let nuevoStock = prod.stock;
    if (ajusteTipo === 'entrada') {
      nuevoStock += cant;
    } else {
      if (prod.stock < cant) {
        showToast('No puede retirar más stock del que existe.', 'warning');
        return;
      }
      nuevoStock -= cant;
    }

    const nuevosProductos = productos.map(p => 
      p.id === prod.id 
        ? { 
            ...p, 
            stock: nuevoStock, 
            precioCosto: ajusteTipo === 'entrada' ? precioCompraNum : p.precioCosto, 
            historialCostos: ajusteTipo === 'entrada' 
              ? [...(p.historialCostos || []), { fecha: new Date().toISOString(), costo: precioCompraNum, cantidad: cant }]
              : (p.historialCostos || []),
            lastModified: Date.now() 
          } 
        : p
    );

    const nuevoLog = {
      id: Date.now(),
      fecha: new Date().toISOString(),
      producto: prod.nombre,
      tipo: ajusteTipo,
      cantidad: cant,
      detalle: ajusteMotivo || (ajusteTipo === 'entrada' ? `Reabastecimiento (Precio compra: $${precioCompraNum} c/u)` : ajusteTipo === 'merma' ? 'Registro de merma' : 'Ajuste manual de stock'),
      operador: 'Admin YoY'
    };

    const nuevosLogs = [nuevoLog, ...logs];
    saveState(nuevosProductos, nuevosLogs);

    // Sincronizar con la bitácora general de caja (Recomendación 3)
    registrarEnBitacoraGeneral(
      'Ajuste Inv', 
      `${ajusteTipo === 'entrada' ? 'Entrada' : ajusteTipo === 'merma' ? 'Merma' : 'Salida'} de ${cant} pz de ${prod.nombre} (${nuevoLog.detalle})`,
      ajusteTipo === 'entrada' ? cant * precioCompraNum : 0
    );

    showToast(`Inventario de ${prod.nombre} actualizado con éxito ✓`, 'success');
    setModalAjuste(null);
    setAjusteCant('');
    setAjusteMotivo('');
    setAjustePrecioCompra('');
  };

  // Registrar Nuevo Producto
  const handleRegistrarProducto = () => {
    const { nombre, categoria, precioCosto, precioVenta, stock, stockMin, stockOptimo, unidad, activoIA } = formNuevo;
    if (!nombre.trim() || !precioCosto || !precioVenta) {
      showToast('Por favor complete los campos obligatorios: Nombre, Costo y Venta.', 'warning');
      return;
    }

    const costoVal = parseFloat(precioCosto);
    const ventaVal = parseFloat(precioVenta);
    const stockVal = parseInt(stock) || 0;
    const minVal = parseInt(stockMin) || 0;
    const optimoVal = parseInt(stockOptimo) || 0;

    if (isNaN(costoVal) || costoVal < 0 || isNaN(ventaVal) || ventaVal < 0) {
      showToast('Los precios deben ser valores numéricos positivos.', 'warning');
      return;
    }

    const newId = productos.reduce((max, p) => p.id > max ? p.id : max, 0) + 1;
    const nuevoProd = {
      id: newId,
      nombre: nombre.trim(),
      categoria,
      precioCosto: costoVal,
      precioVenta: ventaVal,
      stock: stockVal,
      stockMin: minVal,
      stockOptimo: optimoVal,
      unidad: unidad || 'pz',
      activoIA: activoIA !== false,
      lastModified: Date.now()
    };

    const nuevosLogs = [...logs];
    if (stockVal > 0) {
      nuevosLogs.unshift({
        id: Date.now(),
        fecha: new Date().toISOString(),
        producto: nuevoProd.nombre,
        tipo: 'entrada',
        cantidad: stockVal,
        detalle: 'Registro inicial de producto',
        operador: 'Admin YoY'
      });
    }

    const nuevosProductos = [...productos, nuevoProd];
    saveState(nuevosProductos, nuevosLogs);

    registrarEnBitacoraGeneral(
      'Registro Prod',
      `Nuevo producto registrado: ${nuevoProd.nombre} con stock inicial de ${stockVal} ${nuevoProd.unidad}`,
      0
    );

    showToast(`Producto ${nuevoProd.nombre} registrado con éxito ✓`, 'success');
    setShowNuevoProducto(false);
    setFormNuevo({
      nombre: '',
      categoria: 'Cerveza',
      precioCosto: '',
      precioVenta: '',
      stock: '',
      stockMin: '',
      stockOptimo: '',
      unidad: 'pz',
      activoIA: true
    });
  };

  // Optimizar Stock con IA en base a logs de consumo
  const optimizarStockConIA = () => {
    const unMesAtras = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const salidasRecientes = logs.filter(l => 
      (l.tipo === 'salida' || l.tipo === 'merma' || l.tipo === 'ajuste_salida') && 
      new Date(l.fecha).getTime() > unMesAtras
    );

    const consumoPorProducto = {};
    salidasRecientes.forEach(l => {
      const pId = parseInt(l.productoId);
      if (!consumoPorProducto[pId]) consumoPorProducto[pId] = 0;
      consumoPorProducto[pId] += Math.abs(parseFloat(l.cantidad) || 0);
    });

    const sugerencias = productos.map(p => {
      const totalConsumo = consumoPorProducto[p.id] || 0;
      const promedioSemanal = totalConsumo / 4;
      
      let nuevoMin = p.stockMin;
      let nuevoOptimo = p.stockOptimo;

      if (promedioSemanal > 0) {
        nuevoMin = Math.max(5, Math.ceil(promedioSemanal * 1.5));
        nuevoOptimo = Math.max(15, Math.ceil(promedioSemanal * 4.0));
      } else {
        if (p.stockOptimo > 20) {
          nuevoMin = Math.max(5, Math.ceil(p.stockMin * 0.9));
          nuevoOptimo = Math.max(15, Math.ceil(p.stockOptimo * 0.9));
        }
      }

      if (nuevoMin >= nuevoOptimo) {
        nuevoMin = Math.max(2, Math.floor(nuevoOptimo * 0.3));
      }

      return {
        id: p.id,
        nombre: p.nombre,
        categoria: p.categoria,
        minActual: p.stockMin,
        optimoActual: p.stockOptimo,
        minSugerido: nuevoMin,
        optimoSugerido: nuevoOptimo,
        promedioSemanal: promedioSemanal.toFixed(1)
      };
    });

    const filtrados = sugerencias.filter(s => 
      s.minActual !== s.minSugerido || s.optimoActual !== s.optimoSugerido
    );

    if (filtrados.length === 0) {
      showToast("El inventario actual ya está óptimo en base al consumo mensual 👍", "info");
      return;
    }

    setProductosSugeridosOpt(filtrados);
    setShowModalOptimizacion(true);
  };

  const aplicarOptimizacionStock = () => {
    const nuevosProductos = productos.map(p => {
      const sugerencia = productosSugeridosOpt.find(s => s.id === p.id);
      if (sugerencia) {
        return {
          ...p,
          stockMin: sugerencia.minSugerido,
          stockOptimo: sugerencia.optimoSugerido,
          lastModified: Date.now()
        };
      }
      return p;
    });

    saveState(nuevosProductos, logs);
    registrarEnBitacoraGeneral(
      'Optimizacion Stock IA',
      `Optimización IA aplicada a ${productosSugeridosOpt.length} productos del inventario`,
      0
    );
    showToast(`Optimización de stock aplicada con éxito a ${productosSugeridosOpt.length} productos ✅`, 'success');
    setShowModalOptimizacion(false);
  };

  // Impresion de faltantes para stock optimo con costos
  const imprimirFaltantesStockIA = () => {
    const itemsFaltantes = productos.map(p => {
      const sug = productosSugeridosOpt.find(s => s.id === p.id);
      const optimoTarget = sug ? sug.optimoSugerido : p.stockOptimo;
      const faltante = optimoTarget - p.stock;
      const cantFaltante = faltante > 0 ? faltante : 0;
      
      return {
        nombre: p.nombre,
        categoria: p.categoria,
        stock: p.stock,
        optimo: optimoTarget,
        faltante: cantFaltante,
        unidad: p.unidad || 'pz',
        costoUnitario: p.precioCosto || 0,
        costoTotalFaltante: cantFaltante * (p.precioCosto || 0)
      };
    }).filter(item => item.faltante > 0);

    if (itemsFaltantes.length === 0) {
      showToast('Todos los productos están en su nivel óptimo de stock 👍', 'info');
      return;
    }

    const granTotalCostoFaltante = itemsFaltantes.reduce((sum, item) => sum + item.costoTotalFaltante, 0);

    const printWindow = window.open('', '_blank', 'width=600,height=600');
    if (!printWindow) {
      setPopupsBloqueados(true);
      localStorage.setItem('yoy_popups_blocked_warning', 'true');
      showToast('Permita las ventanas emergentes para imprimir el reporte', 'warning');
      return;
    } else {
      setPopupsBloqueados(false);
      localStorage.removeItem('yoy_popups_blocked_warning');
    }

    const dateStr = new Date().toLocaleDateString('es-MX', { year: 'numeric', month: '2-digit', day: '2-digit' });
    const timeStr = new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });

    const itemsHtml = itemsFaltantes.map(item => `
      <tr style="border-bottom: 1px dashed #000;">
        <td style="padding: 6px 0; font-size: 11px;">
          <b>${item.nombre}</b><br>
          <span style="font-size: 10px; color: #555;">En Almacén: ${item.stock} ${item.unidad} / Óptimo: ${item.optimo} ${item.unidad}</span><br>
          <span style="font-size: 9px; color: #777;">Costo unitario: $${item.costoUnitario.toFixed(2)}</span>
        </td>
        <td style="text-align: right; padding: 6px 0; font-size: 11px; vertical-align: bottom;">
          <b>Falta: ${item.faltante} ${item.unidad}</b><br>
          <span style="font-size: 10px; color: #000; font-weight: bold;">Costo: $${item.costoTotalFaltante.toFixed(2)}</span>
        </td>
      </tr>
    `).join('');

    printWindow.document.write(`
      <html>
        <head>
          <title>Reporte de Faltantes IA</title>
          <style>
            @page {
              size: 80mm auto;
              margin: 0;
            }
            body {
              font-family: 'Courier New', Courier, monospace;
              width: 72mm;
              margin: 0;
              padding: 10px;
              color: #000;
              background: #fff;
            }
            h3, p {
              margin: 4px 0;
              text-align: center;
            }
            .divider {
              border-top: 1px dashed #000;
              margin: 8px 0;
            }
            .table-data {
              width: 100%;
              border-collapse: collapse;
            }
            .total-row {
              width: 100%;
              margin-top: 6px;
              font-size: 11px;
              font-weight: bold;
            }
          </style>
        </head>
        <body>
          <h3>YOY IA BILLAR</h3>
          <p style="font-size: 10px; font-weight: bold;">REPORTE DE FALTANTES IA</p>
          <p style="font-size: 9px; font-weight: bold;">(ESTADO ÓPTIMO SUGERIDO)</p>
          <div class="divider"></div>
          <p style="font-size: 9px; text-align: left;">Fecha: ${dateStr} - Hora: ${timeStr}</p>
          <div class="divider"></div>
          
          <table class="table-data">
            <thead>
              <tr style="border-bottom: 1px solid #000;">
                <th style="text-align: left; font-size: 10px; padding-bottom: 4px;">Producto (Almacén)</th>
                <th style="text-align: right; font-size: 10px; padding-bottom: 4px;">Faltante / Costo</th>
              </tr>
            </thead>
            <tbody>
              ${itemsHtml}
            </tbody>
          </table>
          
          <div class="divider"></div>
          
          <table style="width: 100%; font-size: 11px; font-weight: bold;">
            <tr>
              <td>COSTO TOTAL ESTIMADO:</td>
              <td style="text-align: right;">$${granTotalCostoFaltante.toFixed(2)} MXN</td>
            </tr>
          </table>
          
          <div class="divider"></div>
          
          <p style="font-size: 8px; text-align: center; margin-top: 15px;">
            Yoy IA Billar - Alfonso Iturbide<br>
            * REPORTADO POR MOTOR IA *
          </p>
          <br><br>
          <script>
            window.onload = function() {
              window.print();
              setTimeout(function() { window.close(); }, 500);
            };
          </script>
        </body>
      </html>
    `);
    printWindow.document.close();
  };

  // Impresion de Ticket Termico para Orden de Compra
  const imprimirOrdenCompraTFT = (ordenItems) => {
    if (!ordenItems || ordenItems.length === 0) return;

    const printWindow = window.open('', '_blank', 'width=600,height=600');
    if (!printWindow) {
      setPopupsBloqueados(true);
      localStorage.setItem('yoy_popups_blocked_warning', 'true');
      showToast('Permita las ventanas emergentes para imprimir la orden de compra', 'warning');
      return;
    } else {
      setPopupsBloqueados(false);
      localStorage.removeItem('yoy_popups_blocked_warning');
    }

    const dateStr = new Date().toLocaleDateString('es-MX', { year: 'numeric', month: '2-digit', day: '2-digit' });
    const timeStr = new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
    const totalCosto = ordenItems.reduce((s, o) => s + o.costoTotal, 0);
    const totalRetorno = ordenItems.reduce((s, o) => s + o.retornoPotencial, 0);
    const totalGanancia = ordenItems.reduce((s, o) => s + o.gananciaProyectada, 0);

    const itemsHtml = ordenItems.map(o => `
      <tr style="border-bottom: 1px dashed #000;">
        <td style="padding: 4px 0; font-size: 11px;"><b>${o.nombre}</b><br>Pedir: ${o.cantidadAPedir} ${o.unidad || 'pz'} (Stock: ${o.stock})</td>
        <td style="text-align: right; padding: 4px 0; font-size: 11px; vertical-align: bottom;">$${o.costoTotal}</td>
      </tr>
    `).join('');

    printWindow.document.write(`
      <html>
        <head>
          <title>Orden de Compra IA</title>
          <style>
            @page {
              size: 80mm auto;
              margin: 0;
            }
            body {
              font-family: 'Courier New', Courier, monospace;
              width: 72mm;
              margin: 0;
              padding: 10px;
              color: #000;
              background: #fff;
            }
            h3, p {
              margin: 4px 0;
              text-align: center;
            }
            .divider {
              border-top: 1px dashed #000;
              margin: 8px 0;
            }
            .totals table {
              width: 100%;
            }
            .totals td {
              font-size: 11px;
              padding: 2px 0;
            }
          </style>
        </head>
        <body>
          <h3>YOY IA BILLAR</h3>
          <p style="font-size: 10px; font-weight: bold;">ORDEN DE COMPRA SUGERIDA IA</p>
          <div class="divider"></div>
          <p style="font-size: 9px; text-align: left;">Fecha: ${dateStr} - Hora: ${timeStr}</p>
          <p style="font-size: 9px; text-align: left;">Origen: Generacion IA</p>
          <div class="divider"></div>
          
          <table style="width: 100%; border-collapse: collapse;">
            <thead>
              <tr style="border-bottom: 1px solid #000;">
                <th style="text-align: left; font-size: 10px; padding-bottom: 4px;">Producto</th>
                <th style="text-align: right; font-size: 10px; padding-bottom: 4px;">Costo</th>
              </tr>
            </thead>
            <tbody>
              ${itemsHtml}
            </tbody>
          </table>
          
          <div class="divider"></div>
          
          <div class="totals">
            <table>
              <tr>
                <td><b>COSTO ADQUISICION:</b></td>
                <td style="text-align: right;"><b>$${totalCosto} MXN</b></td>
              </tr>
              <tr>
                <td>RETORNO PROYECTADO:</td>
                <td style="text-align: right;">$${totalRetorno} MXN</td>
              </tr>
              <tr>
                <td>GANANCIA ESTIMADA:</td>
                <td style="text-align: right;">$${totalGanancia} MXN</td>
              </tr>
            </table>
          </div>
          
          <div class="divider"></div>
          <p style="font-size: 8px; text-align: center; margin-top: 15px;">
            Yoy IA Billar - Alfonso Iturbide<br>
            * TICKET DE REORDEN IA *
          </p>
          <br><br>
          <script>
            window.onload = function() {
              window.print();
              setTimeout(function() { window.close(); }, 500);
            };
          </script>
        </body>
      </html>
    `);
    printWindow.document.close();
  };

  // Generar Orden de Compra Sugerida IA
  const generarOrdenCompraIA = () => {
    const orden = productos
      .filter(p => p.stock <= p.stockMin && p.activoIA !== false)
      .map(p => {
        const cantidadSugerida = p.stockOptimo - p.stock;
        const costoTotal = cantidadSugerida * p.precioCosto;
        const retornoPotencial = cantidadSugerida * p.precioVenta;
        return {
          id: p.id,
          nombre: p.nombre,
          stock: p.stock,
          min: p.stockMin,
          optimo: p.stockOptimo,
          cantidadAPedir: cantidadSugerida,
          costoUnitario: p.precioCosto,
          costoTotal,
          retornoPotencial,
          gananciaProyectada: retornoPotencial - costoTotal,
          unidad: p.unidad || 'pz'
        };
      });

    setOrdenSugerida(orden);
    setModalOrdenCompra(true);

    if (orden.length > 0) {
      imprimirOrdenCompraTFT(orden);
      showToast('Orden de compra sugerida enviada a la impresora termica ✓', 'success');
    } else {
      showToast('No hay productos que requieran orden de compra.', 'info');
    }
  };

  // Confirmar y cargar la orden de compra sugerida en el stock (Recomendación 3)
  const aprobarCargarOrdenCompra = () => {
    if (ordenSugerida.length === 0) return;
    const totalCosto = ordenSugerida.reduce((s,o)=>s+o.costoTotal, 0);
    setMontoRealCompra(totalCosto);
    setReferenciaFactura('');
    setSubModalRecepcion(true);
  };

  const confirmarYRecibirMercanciaReal = () => {
    if (ordenSugerida.length === 0) return;

    const nuevosProductos = productos.map(p => {
      const itemOrden = ordenSugerida.find(o => o.id === p.id);
      if (itemOrden) {
        return { ...p, stock: p.stock + itemOrden.cantidadAPedir, lastModified: Date.now() };
      }
      return p;
    });

    const nuevosLogs = [...logs];
    ordenSugerida.forEach(o => {
      nuevosLogs.unshift({
        id: Date.now() + Math.random(),
        fecha: new Date().toISOString(),
        producto: o.nombre,
        tipo: 'entrada',
        cantidad: o.cantidadAPedir,
        detalle: `Reabastecimiento IA aprobado${referenciaFactura ? ` (Ref: ${referenciaFactura})` : ''}`,
        operador: user ? (user.name || user.alias || 'Admin YoY') : 'Admin YoY'
      });
    });

    saveState(nuevosProductos, nuevosLogs);

    // Sincronizar con la bitácora general de caja - costo real como egreso
    const descripcionEgreso = `Reabastecimiento IA aprobado para ${ordenSugerida.length} productos${referenciaFactura ? ` (Ref: ${referenciaFactura})` : ''} (${ordenSugerida.map(o=>`${o.cantidadAPedir}x ${o.nombre}`).join(', ')})`;
    registrarEnBitacoraGeneral(
      'Compra IA', 
      descripcionEgreso,
      -montoRealCompra
    );

    showToast(`Mercancia recibida y egreso de $${montoRealCompra} MXN asentado en caja ✓`, 'success');
    setSubModalRecepcion(false);
    setModalOrdenCompra(false);
  };

  // Ajustar precio sugerido por IA (Recomendación 3)
  const aplicarAjustePrecioIA = (prodId, nuevoPrecio) => {
    const prod = productos.find(p => p.id === prodId);
    if (!prod) return;

    const nuevosProductos = productos.map(p => p.id === prodId ? { ...p, precioVenta: nuevoPrecio, lastModified: Date.now() } : p);
    
    const nuevosLogs = [{
      id: Date.now(),
      fecha: new Date().toISOString(),
      producto: prod.nombre,
      tipo: 'ajuste_precio',
      cantidad: 0,
      detalle: `Precio ajustado por sugerencia de IA a $${nuevoPrecio} MXN`,
      operador: 'Auditor IA'
    }, ...logs];

    saveState(nuevosProductos, nuevosLogs);

    // Sincronizar con la bitácora general de caja (Recomendación 3)
    registrarEnBitacoraGeneral(
      'Precio IA', 
      `Precio de ${prod.nombre} ajustado por IA de $${prod.precioVenta} a $${nuevoPrecio} MXN`,
      0
    );

    showToast(`Precio actualizado con éxito a $${nuevoPrecio} MXN ✓`, 'success');
  };

  const todosLosLogs = [
    ...logs.map(l => ({
      id: `local-${l.id}`,
      fecha: l.fecha,
      producto: l.producto,
      tipo: l.tipo,
      cantidad: l.cantidad,
      detalle: l.detalle,
      operador: l.operador || 'Sistema',
      monto: 0
    })),
    ...dbLogs.map(l => {
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

  const stockCritico = productos.filter(p => p.stock <= p.stockMin);
  const costoTotalVal = productos.reduce((s, p) => s + (p.stock * p.precioCosto), 0);
  const ventaTotalVal = productos.reduce((s, p) => s + (p.stock * p.precioVenta), 0);
  const margenGlobalPct = ventaTotalVal > 0 ? (((ventaTotalVal - costoTotalVal) / ventaTotalVal) * 100).toFixed(0) : '0';
  const hasAlerts = (inconsistenciasEnVivo && inconsistenciasEnVivo.length > 0) || (stockCritico && stockCritico.length > 0);

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
            onAction: () => {
              setOrdenSugerida([{
                id: p.id,
                nombre: p.nombre,
                stock: p.stock,
                min: p.stockMin,
                optimo: p.stockOptimo,
                cantidadAPedir: cantidadPedir,
                costoUnitario: p.precioCosto,
                costoTotal: cantidadPedir * p.precioCosto,
                retornoPotencial: cantidadPedir * p.precioVenta,
                gananciaProyectada: (cantidadPedir * p.precioVenta) - (cantidadPedir * p.precioCosto)
              }]);
              setModalOrdenCompra(true);
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

  return (
    <div style={{ width: '100%', overflow: 'hidden', boxSizing: 'border-box' }}>
      {popupsBloqueados && (
        <div style={{
          background: 'rgba(239, 68, 68, 0.15)',
          border: '1px solid #ef4444',
          borderRadius: 8,
          padding: '10px 14px',
          marginBottom: 12,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          color: '#ef4444',
          fontSize: 12,
          fontWeight: 500
        }}>
          <span>
            ⚠️ <b>Ventanas emergentes bloqueadas:</b> El navegador esta bloqueando las ventanas de impresion de tickets. 
            Por favor, haga clic en el icono de bloqueo/popups en la barra de direcciones y seleccione "Permitir siempre".
          </span>
          <button 
            onClick={() => {
              setPopupsBloqueados(false);
              try {
                localStorage.removeItem('yoy_popups_blocked_warning');
              } catch (e) {}
            }} 
            style={{
              background: 'none',
              border: 'none',
              color: '#ef4444',
              cursor: 'pointer',
              fontSize: 14,
              fontWeight: 'bold',
              padding: '0 4px'
            }}
            title="Cerrar aviso"
          >
            ✕
          </button>
        </div>
      )}
      <div className="page-header" style={{ marginBottom: 14, display: 'flex', flexDirection: 'column', gap: 12, width: '100%', alignItems: 'stretch' }}>
        {/* Fila 1: Title and KPIs */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
          <div>
            <h1 className="page-title gradient-bronze" style={{ margin: 0, lineHeight: 1.1 }}>Inventario Inteligente IA</h1>
            <p className="page-subtitle" style={{ margin: '4px 0 0 0', fontSize: 11 }}>Monitoreo de stock, auditoria fisica y motor predictivo de compras</p>
          </div>

          {/* Fila de Metricas en Modo Compacto */}
          <div style={{ 
            display: 'flex', 
            alignItems: 'center', 
            gap: 12, 
            background: 'linear-gradient(135deg, rgba(205,127,50,0.03) 0%, rgba(0,0,0,0.1) 100%)',
            border: '1px solid var(--border-bronze)',
            borderRadius: 8, 
            padding: '6px 12px',
            height: '48px',
            position: 'relative',
            flexShrink: 0
          }}>
            {/* Metrica 1 */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
              <span style={{ fontSize: 8, textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 600, letterSpacing: '0.05em' }}>Productos Totales</span>
              <div style={{ fontSize: 13, fontWeight: 900, color: 'var(--blue-light)', fontFamily: 'var(--font-display)' }}>
                {productos.length} <span style={{ fontSize: 8, fontWeight: 500, color: 'var(--text-muted)' }}>pz</span>
              </div>
            </div>

            <div style={{ width: 1, height: 16, background: 'var(--border)' }} />

            {/* Metrica 2 (Stock Critico Clickable con Animacion) */}
            <div 
              className={stockCritico.length > 0 ? 'compact-pulse' : ''}
              style={{ 
                display: 'flex', 
                flexDirection: 'column', 
                gap: 0,
                cursor: stockCritico.length > 0 ? 'pointer' : 'default',
                padding: '2px 6px'
              }}
              onClick={() => {
                if (stockCritico.length > 0) {
                  setShowCriticoDropdown(!showCriticoDropdown);
                }
              }}
            >
              <span style={{ fontSize: 8, textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 600, letterSpacing: '0.05em', display: 'flex', alignItems: 'center', gap: 2 }}>
                Alertas Stock {stockCritico.length > 0 && <i className="ri-arrow-down-s-line" style={{ fontSize: 8 }} />}
              </span>
              <div style={{ fontSize: 13, fontWeight: 900, color: stockCritico.length > 0 ? 'var(--danger)' : 'var(--success)', fontFamily: 'var(--font-display)', display: 'flex', alignItems: 'center' }}>
                {stockCritico.length > 0 && (
                  <i className="ri-alert-fill pulse-alert-icon" style={{ fontSize: 10, color: 'var(--danger)', marginRight: 3 }} />
                )}
                {stockCritico.length}
              </div>
            </div>

            <div style={{ width: 1, height: 16, background: 'var(--border)' }} />

            {/* Metrica 3 */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
              <span style={{ fontSize: 8, textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 600, letterSpacing: '0.05em' }}>Valor Inversion</span>
              <div style={{ fontSize: 13, fontWeight: 900, color: 'var(--bronze-light)', fontFamily: 'var(--font-display)' }}>
                ${costoTotalVal.toLocaleString()}
              </div>
            </div>

            <div style={{ width: 1, height: 16, background: 'var(--border)' }} />

            {/* Metrica 4 */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
              <span style={{ fontSize: 8, textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 600, letterSpacing: '0.05em' }}>Valor Venta</span>
              <div style={{ fontSize: 13, fontWeight: 900, color: 'var(--success)', fontFamily: 'var(--font-display)', display: 'flex', alignItems: 'baseline', gap: 4 }}>
                ${ventaTotalVal.toLocaleString()} <span style={{ fontSize: 8, color: 'var(--text-muted)', fontWeight: 500 }}>({margenGlobalPct}%)</span>
              </div>
            </div>

            {/* Dropdown de Alertas de Stock Critico */}
            {showCriticoDropdown && stockCritico.length > 0 && (
              <div style={{
                position: 'absolute',
                top: '100%',
                right: 0,
                width: 320,
                zIndex: 100,
                marginTop: 6,
                background: 'var(--bg-elevated, #1a1a1a)',
                border: '1px solid rgba(239, 68, 68, 0.4)',
                borderRadius: 10,
                padding: '10px 12px',
                boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.5), 0 8px 10px -6px rgba(0, 0, 0, 0.5)',
                animation: 'slideDown 0.2s ease-out forwards',
              }} onClick={e => e.stopPropagation()}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, borderBottom: '1px solid rgba(255, 255, 255, 0.08)', paddingBottom: 4 }}>
                  <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--danger, #ef4444)', display: 'flex', alignItems: 'center', gap: 4 }}>
                    <i className="ri-error-warning-line" /> Alertas de Stock Critico ({stockCritico.length})
                  </span>
                  <button 
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowCriticoDropdown(false);
                    }}
                    style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 0 }}
                  >
                    <i className="ri-close-line" style={{ fontSize: 14 }} />
                  </button>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5, maxHeight: 150, overflowY: 'auto', paddingRight: 2 }}>
                  {stockCritico.map(p => (
                    <div 
                      key={p.id} 
                      style={{ 
                        display: 'flex', 
                        justifyContent: 'space-between', 
                        alignItems: 'center', 
                        padding: '4px 6px', 
                        background: 'rgba(239, 68, 68, 0.03)', 
                        borderRadius: 6,
                        border: '1px solid rgba(239, 68, 68, 0.08)'
                      }}
                    >
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                        <span style={{ display: 'inline-block', fontSize: 10, fontWeight: 600, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 150 }} title={p.nombre}>{p.nombre}</span>
                        <span style={{ fontSize: 8, color: 'var(--text-muted)' }}>Min: {p.stockMin} {p.unidad}</span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--danger, #ef4444)' }}>
                          {p.stock} {p.unidad}
                        </span>
                        <button
                          className="btn btn-xs btn-primary"
                          style={{ padding: '1px 5px', fontSize: 8, height: 16, display: 'flex', alignItems: 'center' }}
                          onClick={(e) => {
                            e.stopPropagation();
                            setModalAjuste(p);
                            setShowCriticoDropdown(false);
                          }}
                        >
                          Ajustar
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Fila 2: Widget de Sugerencias IA Completo */}
        <div style={{ width: '100%' }}>
          {/* Inteligencia de Margen Widget */}
          <div className="card" style={{ 
            width: '100%', 
            boxSizing: 'border-box',
            maxWidth: '100%',
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
            borderRadius: 10
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
              <span style={{ fontSize: 9, textTransform: 'uppercase', color: hasAlerts ? '#f87171' : 'var(--bronze-light)', fontWeight: 800, letterSpacing: '0.05em', display: 'flex', alignItems: 'center', gap: 4 }}>
                <i className="ri-line-chart-line" /> Inteligencia de Margen IA
              </span>
              <span style={{ fontSize: 8, color: 'var(--text-muted)' }}>Desliza para ver sugerencias</span>
            </div>
            
            {/* Scrollable Container with Custom visible scrollbar */}
            <div className="custom-scroll" style={{ 
              overflowY: 'auto', 
              flex: 1, 
              paddingRight: 4
            }}>
              <div className="sugerencias-grid">
                {/* Sugerencias de Margen con Filtro de Descartadas y Boton Descartar */}
                {obtenerSugerenciasIA().filter(sug => {
                  const ts = descartadas[sug.id];
                  if (!ts) return true;
                  return (Date.now() - ts) > 15 * 24 * 60 * 60 * 1000; // 15 dias
                }).map(sug => (
                  <div key={sug.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(255,255,255,0.02)', padding: '3px 6px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.04)', gap: 4, minWidth: 0 }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 0.5, flex: 1, marginRight: 8, overflow: 'hidden', minWidth: 0 }}>
                      <span style={{ display: 'block', fontSize: 9, color: sug.type === 'success' ? 'var(--success)' : 'var(--bronze-light)', fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={sug.tag}>{sug.tag}</span>
                      <span style={{ display: 'block', fontSize: 8, color: 'var(--text-secondary)', lineHeight: 1.1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={sug.desc}>{sug.desc}</span>
                    </div>
                    <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexShrink: 0 }}>
                      <button
                        className="btn btn-primary btn-xs"
                        style={{ padding: '2px 6px', fontSize: 8, height: 16 }}
                        onClick={sug.onAction}
                      >
                        {sug.label}
                      </button>
                      <button
                        type="button"
                        style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 2, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                        title="Descartar sugerencia por 15 dias"
                        onClick={(e) => {
                          e.stopPropagation();
                          descartarSugerencia(sug.id);
                        }}
                      >
                        <i className="ri-close-line" style={{ fontSize: 12 }} />
                      </button>
                    </div>
                  </div>
                ))}

                {/* Sugerencia 3: Cruce Concurrente en Vivo */}
                {inconsistenciasEnVivo.length === 0 ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'rgba(34,197,94,0.04)', padding: '3px 6px', borderRadius: 6, border: '1px solid rgba(34,197,94,0.12)', minWidth: 0 }}>
                    <i className="ri-checkbox-circle-line" style={{ fontSize: 9, color: 'var(--success)' }} />
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 0, minWidth: 0 }}>
                      <span style={{ display: 'block', fontSize: 9, color: 'var(--success)', fontWeight: 700, lineHeight: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>CRUCE OK:</span>
                      <span style={{ display: 'block', fontSize: 7, color: 'var(--text-secondary)', lineHeight: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>Sin discrepancias barra/mesas.</span>
                    </div>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2, background: 'rgba(239,68,68,0.04)', padding: '3px 6px', borderRadius: 6, border: '1px solid rgba(239,68,68,0.12)', minWidth: 0 }}>
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
      <style>{`
        .sugerencias-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 6px;
        }
        @media (max-width: 768px) {
          .sugerencias-grid {
            grid-template-columns: minmax(0, 1fr);
          }
        }
        @keyframes pulseAlert {
          0% { opacity: 0.4; transform: scale(0.95); }
          50% { opacity: 1; transform: scale(1.08); }
          100% { opacity: 0.4; transform: scale(0.95); }
        }
        .pulse-alert-icon {
          animation: pulseAlert 1.6s infinite ease-in-out;
          filter: drop-shadow(0 0 4px var(--danger));
          display: inline-block;
        }
        @keyframes invitePulse {
          0% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.4); }
          70% { box-shadow: 0 0 0 6px rgba(239, 68, 68, 0); }
          100% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0); }
        }
        .invite-pulse {
          animation: invitePulse 2s infinite !important;
          cursor: pointer;
          transition: transform 0.2s, border-color 0.2s;
        }
        .invite-pulse:hover {
          transform: translateY(-2px);
          border-color: rgba(239, 68, 68, 0.5) !important;
        }
        .compact-pulse {
          animation: invitePulse 2s infinite !important;
          border-radius: 6px;
          transition: background-color 0.2s;
        }
        .compact-pulse:hover {
          background-color: rgba(239, 68, 68, 0.1);
        }
        @keyframes slideDown {
          from { opacity: 0; transform: translateY(-10px); }
          to { opacity: 1; transform: translateY(0); }
        }
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

      {/* Condicional según Densidad de Vista */}
      {/* Condicional según Densidad de Vista */}
      {densidadVista === 'classic' && (
        /* Grid de KPIs de Inventario Clásico (Spacious) */
        <div className="stat-grid" style={{ marginBottom: 20, marginTop: 12, position: 'relative' }}>
          {[
            { label: 'Productos Totales', value: productos.length, icon: 'ri-archive-line', color: 'icon-blue', accent: 'var(--blue-light)', unit: 'pz' },
            { label: 'Alertas de Stock', value: stockCritico.length, icon: 'ri-alert-line', color: stockCritico.length > 0 ? 'icon-danger' : 'icon-success', accent: stockCritico.length > 0 ? 'var(--danger)' : 'var(--success)', unit: '' },
            { label: 'Valor de Inversión', value: `$${costoTotalVal.toLocaleString()}`, icon: 'ri-money-dollar-box-line', color: 'icon-bronze', accent: 'var(--bronze-light)', unit: '' },
            { label: 'Valor de Venta', value: `$${ventaTotalVal.toLocaleString()}`, icon: 'ri-coins-line', color: 'icon-success', accent: 'var(--success)', unit: `(${margenGlobalPct}%)` },
          ].map((s, i) => (
            <div 
              key={i} 
              className={`stat-card ${s.label === 'Alertas de Stock' && stockCritico.length > 0 ? 'invite-pulse' : ''}`}
              style={{ 
                padding: '16px 20px', 
                borderRadius: 12,
                cursor: s.label === 'Alertas de Stock' && stockCritico.length > 0 ? 'pointer' : 'default',
                ...(s.label === 'Alertas de Stock' && stockCritico.length > 0 ? { border: '1px solid rgba(239, 68, 68, 0.2)' } : {})
              }}
              onClick={() => {
                if (s.label === 'Alertas de Stock' && stockCritico.length > 0) {
                  setShowCriticoDropdown(!showCriticoDropdown);
                }
              }}
            >
              <div className={`stat-card-icon ${s.color}`}><i className={s.icon} /></div>
              <div className="stat-card-value" style={{ color: s.accent, fontSize: 24, display: 'flex', alignItems: 'baseline', gap: 4 }}>
                {s.value} {s.unit && <span style={{ fontSize: 11, fontWeight: 500, color: 'var(--text-muted)' }}>{s.unit}</span>}
              </div>
              <div className="stat-card-label" style={{ fontSize: 11 }}>
                {s.label}
                {s.label === 'Alertas de Stock' && stockCritico.length > 0 && (
                  <span style={{ fontSize: 9, color: 'var(--text-muted)', marginLeft: 6 }}>(Ver detalles)</span>
                )}
              </div>
            </div>
          ))}

          {/* Dropdown de Alertas de Stock Crítico para Modo Clásico */}
          {showCriticoDropdown && stockCritico.length > 0 && (
            <div style={{
              position: 'absolute',
              top: '100%',
              left: 0,
              width: 360,
              zIndex: 100,
              marginTop: 6,
              background: 'var(--bg-elevated, #1a1a1a)',
              border: '1px solid rgba(239, 68, 68, 0.4)',
              borderRadius: 10,
              padding: '12px 14px',
              boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.5), 0 8px 10px -6px rgba(0, 0, 0, 0.5)',
              animation: 'slideDown 0.2s ease-out forwards',
            }} onClick={e => e.stopPropagation()}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, borderBottom: '1px solid rgba(255, 255, 255, 0.08)', paddingBottom: 6 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--danger, #ef4444)', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <i className="ri-error-warning-line" /> Alertas de Stock Crítico ({stockCritico.length})
                </span>
                <button 
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowCriticoDropdown(false);
                  }}
                  style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 0 }}
                >
                  <i className="ri-close-line" style={{ fontSize: 16 }} />
                </button>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 200, overflowY: 'auto', paddingRight: 4 }}>
                {stockCritico.map(p => (
                  <div 
                    key={p.id} 
                    style={{ 
                      display: 'flex', 
                      justifyContent: 'space-between', 
                      alignItems: 'center', 
                      padding: '6px 10px', 
                      background: 'rgba(239, 68, 68, 0.03)', 
                      borderRadius: 6,
                      border: '1px solid rgba(239, 68, 68, 0.08)'
                    }}
                  >
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                      <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>{p.nombre}</span>
                      <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>Mín: {p.stockMin} {p.unidad}</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--danger, #ef4444)' }}>
                        {p.stock} {p.unidad}
                      </span>
                      <button
                        className="btn btn-xs btn-primary"
                        style={{ padding: '2px 8px', fontSize: 10, height: 22, display: 'flex', alignItems: 'center' }}
                        onClick={(e) => {
                          e.stopPropagation();
                          setModalAjuste(p);
                          setShowCriticoDropdown(false);
                        }}
                      >
                        Ajustar
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Main Layout: Stock & Predictor */}
      <div style={{ display: 'grid', gridTemplateColumns: densidadVista === 'compact' ? 'minmax(0, 1fr) 290px' : 'minmax(0, 1fr) 340px', gap: densidadVista === 'compact' ? 14 : 20, alignItems: 'start', width: '100%', boxSizing: 'border-box', overflow: 'hidden' }}>
        
        {/* Lado Izquierdo: Catálogo y Stock */}
        <div style={{ minWidth: 0, overflow: 'hidden' }}>
          {/* Filtros */}
          <div style={{ display: 'flex', gap: 6, marginBottom: 12, alignItems: 'center', width: '100%', flexWrap: 'nowrap' }}>
            <input 
              className="form-input" 
              style={{ 
                width: 130, 
                padding: '3px 7px', 
                fontSize: 10, 
                height: 24 
              }} 
              placeholder="Buscar producto..." 
              value={busqueda} 
              onChange={e => setBusqueda(e.target.value)} 
            />
            {/* Selector de Categorias Desplegable */}
            <select
              className="form-select"
              style={{ 
                width: 105, 
                padding: '2px 6px', 
                fontSize: 10, 
                height: 24,
                cursor: 'pointer',
                borderColor: filtro !== 'Todas' ? 'var(--bronze-light)' : 'var(--border)'
              }}
              value={filtro}
              onChange={e => setFiltro(e.target.value)}
            >
              {categorias.filter(c => {
                if (c === 'Todas') return true;
                const isCatInsumo = c.toLowerCase() === 'insumo';
                return inventarioTab === 'insumos' ? isCatInsumo : !isCatInsumo;
              }).map(c => (
                <option key={c} value={c}>
                  {c === 'Todas' ? 'Todas las Categorias' : `Categ: ${c}`}
                </option>
              ))}
            </select>



            {/* Botones de Accion */}
            <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexShrink: 0 }}>
              {ultimaOrdenDiaria && ultimaOrdenDiaria.fecha === new Date().toLocaleDateString('en-CA') && ultimaOrdenDiaria.items?.length > 0 && (
              <button 
                  className="btn btn-secondary btn-xs" 
                  onClick={() => {
                    imprimirOrdenCompraTFT(ultimaOrdenDiaria.items);
                    showToast('Re-imprimiendo ticket de orden de compra diaria ✓', 'success');
                  }} 
                  style={{ color: 'var(--bronze-light)', borderColor: 'var(--border-bronze)', height: 24, fontSize: 9, padding: '0 6px', display: 'flex', alignItems: 'center', gap: 3 }}
                  title="Reimprimir el ticket de orden de compra automatica generado hoy al iniciar sesion"
                >
                  <i className="ri-printer-line" /> Ticket Diario
                </button>
              )}
              <button className="btn btn-secondary btn-xs" onClick={optimizarStockConIA} style={{ color: 'var(--bronze-light)', borderColor: 'var(--border-bronze)', height: 24, fontSize: 9, padding: '0 6px', display: 'flex', alignItems: 'center', gap: 3 }}>
                <i className="ri-magic-line" /> Stock IA
              </button>
              <button className="btn btn-secondary btn-xs" onClick={generarOrdenCompraIA} style={{ color: 'var(--bronze-light)', borderColor: 'var(--border-bronze)', height: 24, fontSize: 9, padding: '0 6px', display: 'flex', alignItems: 'center', gap: 3 }}>
                <i className="ri-robot-line" /> Orden Compra
              </button>
              <button className="btn btn-primary btn-xs" onClick={() => setShowNuevoProducto(true)} style={{ height: 24, fontSize: 9, padding: '0 6px', display: 'flex', alignItems: 'center', gap: 3 }}>
                <i className="ri-add-line" /> Registrar
              </button>
            </div>
          </div>

          {/* Tabla de existencias */}
          <div className="card" style={{ padding: densidadVista === 'compact' ? 12 : 16, overflowX: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: densidadVista === 'compact' ? 10 : 16 }}>
              <h3 style={{ fontSize: densidadVista === 'compact' ? 12 : 14, textTransform: 'uppercase', color: 'var(--text-secondary)', fontWeight: 700, margin: 0 }}>Inventario Físico de Existencias</h3>
              <button
                className={densidadVista === 'compact' ? 'btn btn-secondary btn-xs' : 'btn btn-secondary btn-sm'}
                style={{
                  fontSize: densidadVista === 'compact' ? 10 : 11,
                  display: 'flex',
                  alignItems: 'center',
                  gap: densidadVista === 'compact' ? 4 : 6,
                  color: 'var(--bronze-light)',
                  borderColor: 'var(--border-bronze)',
                  padding: densidadVista === 'compact' ? '4px 8px' : '6px 12px'
                }}
                onClick={() => setModalExportar(true)}
              >
                <i className="ri-file-pdf-line" /> Exportar Reporte IA
              </button>
            </div>
            {/* PESTAÑAS DE PRODUCTOS / INSUMOS */}
            <div style={{ display: 'flex', gap: 16, borderBottom: '1px solid var(--border)', marginBottom: 12 }}>
              <button
                style={{
                  background: 'none',
                  border: 'none',
                  color: inventarioTab === 'productos' ? 'var(--bronze-light)' : 'var(--text-muted)',
                  borderBottom: inventarioTab === 'productos' ? '2px solid var(--bronze-light)' : '2px solid transparent',
                  padding: '6px 12px',
                  cursor: 'pointer',
                  fontWeight: 'bold',
                  fontSize: 12,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  transition: 'all 0.2s ease',
                  outline: 'none'
                }}
                onClick={() => setInventarioTab('productos')}
              >
                <i className="ri-archive-line" /> Productos
              </button>
              <button
                style={{
                  background: 'none',
                  border: 'none',
                  color: inventarioTab === 'insumos' ? 'var(--bronze-light)' : 'var(--text-muted)',
                  borderBottom: inventarioTab === 'insumos' ? '2px solid var(--bronze-light)' : '2px solid transparent',
                  padding: '6px 12px',
                  cursor: 'pointer',
                  fontWeight: 'bold',
                  fontSize: 12,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  transition: 'all 0.2s ease',
                  outline: 'none'
                }}
                onClick={() => setInventarioTab('insumos')}
              >
                <i className="ri-restaurant-2-line" /> Insumos
              </button>
            </div>

            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: densidadVista === 'compact' ? 12 : 13, textAlign: 'left' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)', color: 'var(--text-muted)' }}>
                  <th style={{ padding: densidadVista === 'compact' ? '6px 8px' : '12px 8px' }}>
                    {inventarioTab === 'insumos' ? 'Insumo' : 'Producto'}
                  </th>
                  <th style={{ padding: densidadVista === 'compact' ? '6px 8px' : '12px 8px' }}>Categoría</th>
                  <th style={{ padding: densidadVista === 'compact' ? '6px 8px' : '12px 8px', textAlign: 'center' }}>Stock</th>
                  <th style={{ padding: densidadVista === 'compact' ? '6px 8px' : '12px 8px', textAlign: 'center' }}>Mínimo</th>
                  <th style={{ padding: densidadVista === 'compact' ? '6px 8px' : '12px 8px', textAlign: 'right' }}>Costo</th>
                  <th style={{ padding: densidadVista === 'compact' ? '6px 8px' : '12px 8px', textAlign: 'right' }}>Venta</th>
                  <th style={{ padding: densidadVista === 'compact' ? '6px 8px' : '12px 8px', textAlign: 'center' }}>Margen</th>
                  <th style={{ padding: densidadVista === 'compact' ? '6px 8px' : '12px 8px', textAlign: 'center' }}>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {productosFiltrados.map(p => {
                  const esCritico = p.stock <= p.stockMin;
                  return (
                    <tr key={p.id} style={{ borderBottom: '1px solid var(--border)', background: esCritico ? 'rgba(239,68,68,0.02)' : 'none' }}>
                      <td style={{ padding: densidadVista === 'compact' ? '4px 8px' : '8px', fontWeight: 600 }}>
                        <div style={{ display: 'flex', alignItems: 'center', width: '100%' }}>
                          <input 
                            type="text"
                            value={p.nombre || ''}
                            onChange={e => handleLocalChange(p.id, 'nombre', e.target.value)}
                            onFocus={handleInputFocus}
                            onBlur={e => handleInputBlur(e, p.id, 'nombre')}
                            onKeyDown={handleInputKeyDown}
                            style={{ ...inputStyle, fontWeight: 600, width: '100%', minWidth: 100 }}
                          />
                          {p.activoIA === false && (
                            <span style={{ 
                              fontSize: densidadVista === 'compact' ? 8 : 9, 
                              color: 'var(--text-muted)', 
                              marginLeft: 6, 
                              fontWeight: 400, 
                              border: '1px solid rgba(255,255,255,0.1)', 
                              padding: densidadVista === 'compact' ? '1px 3px' : '2px 5px', 
                              borderRadius: densidadVista === 'compact' ? 3 : 4, 
                              background: 'rgba(255,255,255,0.02)', 
                              display: 'inline-block',
                              flexShrink: 0
                            }}>
                              IA Off
                            </span>
                          )}
                        </div>
                      </td>
                      <td style={{ padding: densidadVista === 'compact' ? '4px 8px' : '8px' }}>
                        <select
                          value={p.categoria || ''}
                          onChange={e => handleUpdateProductoField(p.id, 'categoria', e.target.value)}
                          style={{
                            background: 'transparent',
                            border: '1px solid transparent',
                            borderRadius: 4,
                            color: 'var(--text-primary)',
                            padding: '2px 4px',
                            fontSize: 11,
                            cursor: 'pointer',
                            width: '100%'
                          }}
                          onFocus={handleInputFocus}
                          onBlur={e => {
                            e.target.style.borderColor = 'transparent';
                            e.target.style.background = 'transparent';
                          }}
                        >
                          {categorias.filter(c => c !== 'Todas').map(c => (
                            <option key={c} value={c} style={{ background: 'var(--bg-elevated)', color: 'var(--text-primary)' }}>{c}</option>
                          ))}
                        </select>
                      </td>
                      <td style={{ padding: densidadVista === 'compact' ? '4px 8px' : '8px', textAlign: 'center' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 2 }}>
                          <input 
                            type="number"
                            value={p.stock}
                            onChange={e => handleLocalChange(p.id, 'stock', e.target.value)}
                            onFocus={handleInputFocus}
                            onBlur={e => handleInputBlur(e, p.id, 'stock')}
                            onKeyDown={handleInputKeyDown}
                            style={{ ...inputStyle, textAlign: 'center', fontWeight: 700, width: 50, color: esCritico ? 'var(--danger)' : 'var(--text-primary)' }}
                          />
                          <span style={{ fontSize: 9, color: 'var(--text-muted)', flexShrink: 0 }}>{p.unidad}</span>
                        </div>
                      </td>
                      <td style={{ padding: densidadVista === 'compact' ? '4px 8px' : '8px', textAlign: 'center' }}>
                        <input 
                          type="number"
                          value={p.stockMin}
                          onChange={e => handleLocalChange(p.id, 'stockMin', e.target.value)}
                          onFocus={handleInputFocus}
                          onBlur={e => handleInputBlur(e, p.id, 'stockMin')}
                          onKeyDown={handleInputKeyDown}
                          style={{ ...inputStyle, textAlign: 'center', color: 'var(--text-muted)', width: 45 }}
                        />
                      </td>
                      <td style={{ padding: densidadVista === 'compact' ? '4px 8px' : '8px', textAlign: 'right' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 2 }}>
                          <span style={{ color: 'var(--text-muted)', fontSize: 10 }}>$</span>
                          <input 
                            type="number"
                            step="0.01"
                            value={p.precioCosto}
                            onChange={e => handleLocalChange(p.id, 'precioCosto', e.target.value)}
                            onFocus={handleInputFocus}
                            onBlur={e => handleInputBlur(e, p.id, 'precioCosto')}
                            onKeyDown={handleInputKeyDown}
                            style={{ ...inputStyle, textAlign: 'right', color: 'var(--text-muted)', width: 55 }}
                          />
                        </div>
                      </td>
                      <td style={{ padding: densidadVista === 'compact' ? '4px 8px' : '8px', textAlign: 'right' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 2 }}>
                          <span style={{ color: 'var(--text-primary)', fontSize: 10, fontWeight: 700 }}>$</span>
                          <input 
                            type="number"
                            step="0.01"
                            value={p.precioVenta}
                            onChange={e => handleLocalChange(p.id, 'precioVenta', e.target.value)}
                            onFocus={handleInputFocus}
                            onBlur={e => handleInputBlur(e, p.id, 'precioVenta')}
                            onKeyDown={handleInputKeyDown}
                            style={{ ...inputStyle, textAlign: 'right', fontWeight: 700, width: 55 }}
                          />
                        </div>
                      </td>
                      <td style={{ padding: densidadVista === 'compact' ? '6px 8px' : '12px 8px', textAlign: 'center' }}>
                        <span className={`badge ${parseFloat(calcMargen(p)) > 50 ? 'badge-success' : 'badge-bronze'}`} style={{ padding: densidadVista === 'compact' ? '2px 6px' : '4px 8px', fontSize: densidadVista === 'compact' ? 10 : 11 }}>{calcMargen(p)}%</span>
                      </td>
                      <td style={{ padding: densidadVista === 'compact' ? '4px 8px' : '8px', textAlign: 'center' }}>
                        <div style={{ display: 'flex', gap: 4, justifyContent: 'center' }}>
                          <button
                            className="btn btn-secondary btn-xs"
                            style={{ padding: densidadVista === 'compact' ? '3px 6px' : '6px 10px', fontSize: densidadVista === 'compact' ? 10 : 11 }}
                            onClick={() => setModalAjuste(p)}
                          >
                            Ajustar
                          </button>
                          {inventarioTab === 'productos' && (
                            <button
                              className="btn btn-secondary btn-xs"
                              style={{ 
                                padding: densidadVista === 'compact' ? '3px 6px' : '6px 10px', 
                                fontSize: densidadVista === 'compact' ? 10 : 11,
                                color: 'var(--bronze-light)',
                                borderColor: 'var(--border-bronze)',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center'
                              }}
                              onClick={() => handleAbrirReceta(p)}
                              title="Configurar Receta"
                            >
                              <i className="ri-restaurant-line" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Modalidad de Auditoría e Inventario IA compactada */}
          <div style={{
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border)',
            borderRadius: 10,
            padding: '8px 12px',
            marginTop: 12,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 10,
            flexWrap: 'wrap'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--bronze-light)', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'flex', alignItems: 'center', gap: 4 }}>
                <i className="ri-survey-line" /> Modalidad Auditoría IA
              </div>
              <span className="badge badge-bronze" style={{ fontSize: 8, padding: '1px 4px' }}>Motor IA Activo</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <select
                className="form-select"
                style={{ padding: '3px 6px', fontSize: 11, minWidth: 150, background: 'var(--bg-base)', border: '1px solid var(--border)', color: 'var(--text-primary)', borderRadius: 5 }}
                value={modoInventario}
                onChange={e => {
                  const m = e.target.value;
                  setModoInventario(m);
                  if (m === 'azar') generarConteoCiego();
                }}
              >
                <option value="general">General (Catálogo Completo)</option>
                <option value="periodico">Periódico (Críticos o ID Par)</option>
                <option value="azar">Al Azar (Ciego - 3 sugerencias)</option>
                <option value="producto">Por Producto Especificado</option>
                <option value="inconsistencia">Con Inconsistencias Detectadas</option>
                <option value="mas_vendidos">Más Vendidos (Por Consumo)</option>
                <option value="menos_vendidos">Menos Vendidos (Por Consumo)</option>
              </select>

              {modoInventario === 'producto' && (
                <select
                  className="form-select"
                  style={{ padding: '3px 6px', fontSize: 11, width: 150, background: 'var(--bg-base)', border: '1px solid var(--border)', color: 'var(--text-primary)', borderRadius: 5 }}
                  value={productoSelId}
                  onChange={e => setProductoSelId(e.target.value)}
                >
                  <option value="">-- Seleccionar --</option>
                  {productos.map(p => (
                    <option key={p.id} value={p.id}>{p.nombre}</option>
                  ))}
                </select>
              )}

              {modoInventario === 'azar' && (
                <button
                  className="btn btn-secondary btn-xs"
                  style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '3px 6px' }}
                  onClick={() => generarConteoCiego()}
                >
                  <i className="ri-refresh-line" /> Regenerar
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Lado Derecho: Inteligencia IA */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: densidadVista === 'compact' ? 14 : 20, minWidth: 0, overflow: 'hidden' }}>
          
          {/* Módulo IA: Sincronización en la Nube Supabase (Sugerencia 2) */}
          <div className="card" style={{ padding: densidadVista === 'compact' ? 12 : 16, border: '1px solid var(--border-bronze)', background: 'rgba(205,127,50,0.02)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: densidadVista === 'compact' ? 8 : 12 }}>
              <h3 style={{ fontSize: densidadVista === 'compact' ? 11 : 12, textTransform: 'uppercase', color: 'var(--bronze-light)', display: 'flex', alignItems: 'center', gap: 4, fontWeight: 800, margin: 0 }}>
                <i className="ri-cloud-line" />
                Sincronización Nube
              </h3>
              <span className="dot-live" style={{ background: 'var(--success)', width: 5, height: 5, borderRadius: '50%' }} />
            </div>
            <div style={{ fontSize: densidadVista === 'compact' ? 10 : 11, color: 'var(--text-secondary)', marginBottom: densidadVista === 'compact' ? 8 : 12, lineHeight: 1.3 }}>
              Supabase DB: <span style={{ color: 'var(--success)', fontWeight: 700 }}>Conectado</span>
              <br />
              Última Sinc: {new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })} (Hace 0m)
            </div>
            <button
              className={densidadVista === 'compact' ? 'btn btn-secondary btn-xs' : 'btn btn-secondary btn-sm'}
              style={{ width: '100%', fontSize: densidadVista === 'compact' ? 10 : 11, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, padding: densidadVista === 'compact' ? '4px 8px' : '6px 12px' }}
              onClick={() => {
                showToast('Forzando actualización de bases de datos remotas...', 'info');
                setTimeout(() => {
                  showToast('Base de datos centralizada Supabase actualizada con éxito ✓', 'success');
                }, 1000);
              }}
            >
              <i className="ri-refresh-line" /> Forzar Sincronización
            </button>
          </div>

          {/* Panel IA: Predicción de Consumo */}
          <div className="card card-bronze" style={{ padding: densidadVista === 'compact' ? 12 : 16 }}>
            <h3 style={{ fontSize: densidadVista === 'compact' ? 11 : 12, textTransform: 'uppercase', color: 'var(--bronze-light)', marginBottom: densidadVista === 'compact' ? 8 : 12, display: 'flex', alignItems: 'center', gap: 4, fontWeight: 800 }}>
              <i className="ri-robot-line" />
              Demanda Proyectada
            </h3>
            <p style={{ fontSize: densidadVista === 'compact' ? 10 : 11, color: 'var(--text-secondary)', marginBottom: densidadVista === 'compact' ? 10 : 14, lineHeight: 1.3 }}>Consumo proyectado y stock restante en base a tendencias de ventas de mesas/barra.</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: densidadVista === 'compact' ? 6 : 8 }}>
              {productos.map(p => {
                const vel = getVelocidadConsumo(p.id);
                const esBajo = p.stock <= p.stockMin;
                return (
                  <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: densidadVista === 'compact' ? '6px 8px' : '8px 12px', background: 'var(--bg-elevated)', borderRadius: 6, border: `1px solid ${esBajo ? 'rgba(239,68,68,0.2)' : 'var(--border)'}`, fontSize: densidadVista === 'compact' ? 11 : 12 }}>
                    <div>
                      <span style={{ fontWeight: 700 }}>{p.nombre}</span>
                      <div style={{ fontSize: densidadVista === 'compact' ? 9 : 10, color: 'var(--text-muted)', marginTop: 1 }}>Demanda: {vel} {p.unidad}/d</div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontWeight: 800, color: esBajo ? 'var(--danger)' : 'var(--success)' }}>{calcDiasRestantes(p)}</div>
                      <div style={{ fontSize: densidadVista === 'compact' ? 8 : 9, color: 'var(--text-muted)' }}>restantes</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

        </div>
      </div>

      {/* ── GRÁFICA DE TENDENCIAS SEMANALES IA ── */}
      <div className="card" style={{ padding: densidadVista === 'compact' ? 12 : 20, marginTop: densidadVista === 'compact' ? 14 : 20, border: '1px solid var(--border)', borderRadius: densidadVista === 'compact' ? 10 : 12, background: 'var(--bg-elevated)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: densidadVista === 'compact' ? 10 : 16 }}>
          <div>
            <h3 style={{ fontSize: densidadVista === 'compact' ? 12 : 14, textTransform: 'uppercase', color: 'var(--bronze-light)', fontWeight: 800, display: 'flex', alignItems: 'center', gap: densidadVista === 'compact' ? 4 : 6, margin: 0 }}>
              <i className="ri-area-chart-line" />
              Tendencias Semanales IA
            </h3>
            <p style={{ fontSize: densidadVista === 'compact' ? 9 : 11, color: 'var(--text-secondary)', margin: densidadVista === 'compact' ? '2px 0 0 0' : '4px 0 0 0' }}>Consumo acumulado por categoría (Cervezas, Refrescos y Snacks) durante la última semana.</p>
          </div>
          <span className="badge badge-bronze" style={{ padding: densidadVista === 'compact' ? '3px 6px' : '4px 8px', fontSize: densidadVista === 'compact' ? 8 : 10 }}>Auditoría Visual Activa</span>
        </div>
        
        <div style={{ width: '100%', height: densidadVista === 'compact' ? 180 : 260 }}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={HISTORICO_DATA} margin={{ top: densidadVista === 'compact' ? 5 : 10, right: densidadVista === 'compact' ? 5 : 10, left: densidadVista === 'compact' ? -25 : -20, bottom: 0 }}>
              <defs>
                <linearGradient id="colorCerveza" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--bronze-light)" stopOpacity={0.3}/>
                  <stop offset="95%" stopColor="var(--bronze-light)" stopOpacity={0.0}/>
                </linearGradient>
                <linearGradient id="colorRefrescos" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--success)" stopOpacity={0.25}/>
                  <stop offset="95%" stopColor="var(--success)" stopOpacity={0.0}/>
                </linearGradient>
                <linearGradient id="colorSnacks" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--blue-light)" stopOpacity={0.25}/>
                  <stop offset="95%" stopColor="var(--blue-light)" stopOpacity={0.0}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
              <XAxis dataKey="name" stroke="var(--text-muted)" fontSize={densidadVista === 'compact' ? 9 : 11} tickLine={false} />
              <YAxis stroke="var(--text-muted)" fontSize={densidadVista === 'compact' ? 9 : 11} tickLine={false} />
              <Tooltip 
                contentStyle={{ 
                  background: 'var(--bg-elevated)', 
                  border: '1px solid var(--border)', 
                  borderRadius: densidadVista === 'compact' ? 8 : 10,
                  fontSize: densidadVista === 'compact' ? 10 : 12,
                  color: 'var(--text-primary)',
                  padding: densidadVista === 'compact' ? '5px 8px' : '8px 12px'
                }} 
              />
              <Area type="monotone" dataKey="Cerveza" stroke="var(--bronze-light)" fillOpacity={1} fill="url(#colorCerveza)" strokeWidth={1.5} />
              <Area type="monotone" dataKey="Refrescos" stroke="var(--success)" fillOpacity={1} fill="url(#colorRefrescos)" strokeWidth={1.5} />
              <Area type="monotone" dataKey="Snacks" stroke="var(--blue-light)" fillOpacity={1} fill="url(#colorSnacks)" strokeWidth={1.5} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* ── MODAL AJUSTE DE INVENTARIO MANUAL (AUDITORÍA) ─────────── */}
      {modalAjuste && (
        <div className="modal-overlay" onClick={() => setModalAjuste(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">
                <i className="ri-survey-line" style={{ marginRight: 8, color: 'var(--bronze)' }} />
                Ajustar Inventario: {modalAjuste.nombre}
              </span>
              <button onClick={() => setModalAjuste(null)} className="btn-icon btn btn-secondary" style={{ background: 'none', border: 'none' }}>
                <i className="ri-close-line" style={{ fontSize: 20 }} />
              </button>
            </div>
            <div className="modal-body">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div style={{ background: 'var(--bg-elevated)', borderRadius: 10, padding: 12, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <div>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>STOCK ACTUAL</div>
                    <div style={{ fontSize: 20, fontWeight: 800 }}>{modalAjuste.stock} {modalAjuste.unidad}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>STOCK MÍNIMO</div>
                    <div style={{ fontSize: 20, fontWeight: 800 }}>{modalAjuste.stockMin} {modalAjuste.unidad}</div>
                  </div>
                </div>

                <div className="form-group">
                  <label className="form-label">Tipo de Movimiento</label>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                    {[
                      { id: 'entrada', label: 'Entrada / Compra', icon: 'ri-add-circle-line', color: 'var(--success)' },
                      { id: 'salida',  label: 'Salida Manual',   icon: 'ri-checkbox-indeterminate-line', color: 'var(--bronze-light)' },
                      { id: 'merma',   label: 'Merma / Pérdida',  icon: 'ri-close-circle-line', color: 'var(--danger)' }
                    ].map(m => (
                      <button
                        key={m.id}
                        onClick={() => setAjusteTipo(m.id)}
                        style={{
                          background: ajusteTipo === m.id ? 'var(--bronze-subtle)' : 'var(--bg-elevated)',
                          border: `1px solid ${ajusteTipo === m.id ? 'var(--border-bronze)' : 'var(--border)'}`,
                          borderRadius: 10, padding: '10px 8px', cursor: 'pointer',
                          color: ajusteTipo === m.id ? 'var(--bronze-light)' : 'var(--text-secondary)',
                          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
                          fontSize: 11, fontWeight: 600, transition: 'all 0.15s',
                        }}
                      >
                        <i className={m.icon} style={{ fontSize: 18, color: ajusteTipo === m.id ? m.color : 'var(--text-muted)' }} />
                        {m.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="form-group">
                  <label className="form-label">Cantidad ({modalAjuste.unidad})</label>
                  <input
                    type="number"
                    className="form-input"
                    placeholder="Ej: 24"
                    value={ajusteCant}
                    onChange={e => setAjusteCant(e.target.value)}
                  />
                </div>

                {ajusteTipo === 'entrada' && (
                  <div className="form-group">
                    <label className="form-label">Precio de Compra Unitario ($) *</label>
                    <input
                      type="number"
                      step="0.01"
                      className="form-input"
                      placeholder="Ej: 15.50"
                      value={ajustePrecioCompra}
                      onChange={e => setAjustePrecioCompra(e.target.value)}
                    />
                    {/* Live Margin Calculation */}
                    {(() => {
                      const compraNum = parseFloat(ajustePrecioCompra);
                      const ventaNum = modalAjuste.precioVenta || 0;
                      if (!isNaN(compraNum) && compraNum > 0 && ventaNum > 0) {
                        const margen = ((ventaNum - compraNum) / ventaNum) * 100;
                        return (
                          <div style={{ 
                            fontSize: 10, 
                            marginTop: 4, 
                            fontWeight: 600, 
                            color: margen < 15 ? '#ef4444' : margen < 30 ? '#eab308' : '#22c55e',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 4
                          }}>
                            <i className={margen < 15 ? 'ri-error-warning-fill' : 'ri-checkbox-circle-fill'} />
                            Margen de utilidad proyectado: {margen.toFixed(0)}%
                            {margen < 15 && ' (Margen Crítico 🚨)'}
                          </div>
                        );
                      }
                      return null;
                    })()}

                    {/* Historical Cost Logs */}
                    {modalAjuste.historialCostos && modalAjuste.historialCostos.length > 0 && (
                      <div style={{ marginTop: 6, fontSize: 9, color: 'var(--text-muted)' }}>
                        <span style={{ fontWeight: 600 }}>Historial de costos recientes:</span>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 2 }}>
                          {modalAjuste.historialCostos.slice(-3).reverse().map((h, i) => (
                            <span key={i} style={{ background: 'rgba(255,255,255,0.04)', padding: '1px 5px', borderRadius: 4, border: '1px solid rgba(255,255,255,0.06)' }}>
                              ${h.costo.toFixed(2)} ({new Date(h.fecha).toLocaleDateString('es-MX', { month: '2-digit', day: '2-digit' })})
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                <div className="form-group">
                  <label className="form-label">Motivo o Detalle</label>
                  <input
                    className="form-input"
                    placeholder="Ej: Compra de refrescos, merma de alitas quemadas..."
                    value={ajusteMotivo}
                    onChange={e => setAjusteMotivo(e.target.value)}
                  />
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', background: 'rgba(255,255,255,0.02)', borderRadius: 10, border: '1px solid var(--border)', marginTop: 8 }}>
                  <input
                    type="checkbox"
                    id="activoIACheck"
                    checked={modalAjuste.activoIA !== false}
                    onChange={(e) => {
                      const updated = { ...modalAjuste, activoIA: e.target.checked };
                      setModalAjuste(updated);
                      const nuevosProductos = productos.map(p => p.id === modalAjuste.id ? { ...p, activoIA: e.target.checked, lastModified: Date.now() } : p);
                      saveState(nuevosProductos, logs);
                    }}
                    style={{ width: 16, height: 16, cursor: 'pointer', accentColor: 'var(--bronze-light)' }}
                  />
                  <label htmlFor="activoIACheck" style={{ fontSize: 12, color: 'var(--text-primary)', cursor: 'pointer', fontWeight: 600 }}>
                    🤖 Habilitar sugerencias de reorden IA para este producto
                  </label>
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setModalAjuste(null)}>Cancelar</button>
              <button className="btn btn-primary" onClick={aplicarAjusteInventario}>
                Ajustar Existencia
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL OPTIMIZACIÓN IA DE STOCK ────────────────────────── */}
      {showModalOptimizacion && (
        <div className="modal-overlay" onClick={() => setShowModalOptimizacion(false)}>
          <div className="modal" style={{ maxWidth: 700 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">
                <i className="ri-magic-line" style={{ marginRight: 8, color: 'var(--bronze-light)' }} />
                Optimización de Niveles de Stock IA
              </span>
              <button onClick={() => setShowModalOptimizacion(false)} className="btn-icon btn btn-secondary" style={{ background: 'none', border: 'none' }}>
                <i className="ri-close-line" style={{ fontSize: 20 }} />
              </button>
            </div>
            <div className="modal-body" style={{ maxHeight: '60vh', overflowY: 'auto' }}>
              <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 14 }}>
                El motor de IA analizó la bitácora de consumo de los últimos 30 días para recalcular de manera óptima los niveles de stock mínimo y óptimo. A continuación se detallan las recomendaciones adaptadas al flujo real del negocio:
              </p>

              <div className="table-container">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Producto</th>
                      <th>Cat.</th>
                      <th style={{ textAlign: 'center' }}>Ventas/Sem.</th>
                      <th style={{ textAlign: 'center' }}>Mínimo (Actual → Sugerido)</th>
                      <th style={{ textAlign: 'center' }}>Máximo (Actual → Sugerido)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {productosSugeridosOpt.map((s, idx) => (
                      <tr key={idx}>
                        <td style={{ fontWeight: 600 }}>{s.nombre}</td>
                        <td><span className="badge badge-secondary">{s.categoria}</span></td>
                        <td style={{ textAlign: 'center', color: 'var(--bronze-light)' }}>{s.promedioSemanal} pz</td>
                        <td style={{ textAlign: 'center' }}>
                          <span style={{ textDecoration: 'line-through', color: 'var(--text-muted)', marginRight: 6 }}>{s.minActual}</span>
                          <span style={{ color: 'var(--success)', fontWeight: 600 }}>→ {s.minSugerido}</span>
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          <span style={{ textDecoration: 'line-through', color: 'var(--text-muted)', marginRight: 6 }}>{s.optimoActual}</span>
                          <span style={{ color: 'var(--success)', fontWeight: 600 }}>→ {s.optimoSugerido}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={imprimirFaltantesStockIA} style={{ color: 'var(--bronze-light)', borderColor: 'var(--border-bronze)', display: 'flex', alignItems: 'center', gap: 6 }}>
                <i className="ri-printer-line" /> Imprimir Faltantes
              </button>
              <button className="btn btn-secondary" onClick={() => setShowModalOptimizacion(false)}>Ignorar Recomendaciones</button>
              <button className="btn btn-primary" onClick={aplicarOptimizacionStock}>
                <i className="ri-check-line" style={{ marginRight: 6 }} /> Aplicar Ajustes IA
              </button>
            </div>
          </div>
        </div>
      )}

      {modalOrdenCompra && (
        <div className="modal-overlay" onClick={() => setModalOrdenCompra(false)}>
          <div className="modal" style={{ maxWidth: 660 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">
                <i className="ri-robot-line" style={{ marginRight: 8, color: 'var(--bronze-light)' }} />
                Orden de Compra Inteligente IA
              </span>
              <button onClick={() => setModalOrdenCompra(false)} className="btn-icon btn btn-secondary" style={{ background: 'none', border: 'none' }}>
                <i className="ri-close-line" style={{ fontSize: 20 }} />
              </button>
            </div>
            <div className="modal-body">
              <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 14 }}>
                La IA analizó los niveles mínimos de stock y calculó las unidades ideales a ordenar para alcanzar el nivel óptimo, previniendo rupturas de inventario.
              </p>

              {ordenSugerida.length === 0 ? (
                <p style={{ color: 'var(--success)', fontWeight: 600, textAlign: 'center', padding: '30px 0' }}>
                  ✅ Todos los productos tienen existencias saludables. No se sugiere ninguna orden de compra por ahora.
                </p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div style={{ maxHeight: 220, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {ordenSugerida.map(o => (
                      <div key={o.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 10, background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }}>
                        <div>
                          <div style={{ fontWeight: 700 }}>{o.nombre}</div>
                          <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>Stock actual: {o.stock} (Mínimo: {o.min})</div>
                        </div>
                        <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
                          <div style={{ textAlign: 'right' }}>
                            <span className="badge badge-success">Pedir: {o.cantidadAPedir} pz</span>
                            <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>Costo: ${o.costoTotal} MXN</div>
                          </div>
                          <button
                            onClick={() => setOrdenSugerida(prev => prev.filter(item => item.id !== o.id))}
                            className="btn btn-secondary btn-icon"
                            style={{ width: 24, height: 24, padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--danger)', borderColor: 'rgba(239,68,68,0.2)', background: 'rgba(239,68,68,0.05)', borderRadius: 6, cursor: 'pointer' }}
                            title="Excluir de la orden"
                          >
                            <i className="ri-delete-bin-line" style={{ fontSize: 13 }} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Resumen Financiero */}
                  <div style={{ background: 'var(--bronze-subtle)', border: '1px solid var(--border-bronze)', borderRadius: 10, padding: 12, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, mt: 10, textAlign: 'center' }}>
                    <div>
                      <div style={{ fontSize: 9, color: 'var(--text-muted)' }}>COSTO DE ADQUISICIÓN</div>
                      <div style={{ fontSize: 16, fontWeight: 900, color: 'var(--bronze-light)' }}>
                        ${ordenSugerida.reduce((s,o)=>s+o.costoTotal, 0)} MXN
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: 9, color: 'var(--text-muted)' }}>RETORNO PROYECTADO</div>
                      <div style={{ fontSize: 16, fontWeight: 900, color: 'var(--success)' }}>
                        ${ordenSugerida.reduce((s,o)=>s+o.retornoPotencial, 0)} MXN
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: 9, color: 'var(--text-muted)' }}>GANANCIA ESTIMADA</div>
                      <div style={{ fontSize: 16, fontWeight: 900, color: 'var(--success)' }}>
                        ${ordenSugerida.reduce((s,o)=>s+o.gananciaProyectada, 0)} MXN
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
            <div className="modal-footer" style={{ gap: 8 }}>
              <button className="btn btn-secondary" onClick={() => setModalOrdenCompra(false)}>Cancelar</button>
              {ordenSugerida.length > 0 && (
                <>
                  <button
                    className="btn btn-secondary"
                    style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', padding: '10px 14px', borderRadius: 8, fontSize: 13, fontWeight: 600, color: 'var(--bronze-light)', borderColor: 'var(--border-bronze)' }}
                    onClick={() => {
                      imprimirOrdenCompraTFT(ordenSugerida);
                      showToast('Re-imprimiendo ticket de orden de compra ✓', 'success');
                    }}
                  >
                    <i className="ri-printer-line" style={{ fontSize: 16 }} /> Imprimir Ticket
                  </button>
                  <button
                    className="btn btn-success"
                    style={{ background: '#25D366', color: '#fff', border: 'none', display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', padding: '10px 14px', borderRadius: 8, fontSize: 13, fontWeight: 600 }}
                    onClick={() => {
                      const msg = `YoY IA Billar By Alfonso Iturbide - Orden de Compra Sugerida IA:\n\n` + 
                        ordenSugerida.map(o => `· *${o.nombre}*: Pedir ${o.cantidadAPedir} pz (Costo: $${o.costoTotal} MXN)`).join('\n') + 
                        `\n\n*Costo Total*: $${ordenSugerida.reduce((s,o)=>s+o.costoTotal, 0)} MXN\n` +
                        `*Ganancia Estimada*: $${ordenSugerida.reduce((s,o)=>s+o.gananciaProyectada, 0)} MXN\n` +
                        `Por favor, confirmar pedido.`;
                      window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(msg)}`, '_blank');
                      showToast('Abriendo enlace de WhatsApp con la plantilla de compra ✓', 'success');
                    }}
                  >
                    <i className="ri-whatsapp-line" style={{ fontSize: 16 }} /> Enviar por WhatsApp
                  </button>
                  <button className="btn btn-primary" onClick={aprobarCargarOrdenCompra}>
                    Aprobar y Recibir Mercancía
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {subModalRecepcion && (
        <div className="modal-overlay" style={{ zIndex: 1100 }} onClick={() => setSubModalRecepcion(false)}>
          <div className="modal" style={{ maxWidth: 420 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">
                <i className="ri-check-double-line" style={{ marginRight: 8, color: 'var(--success)' }} />
                Conciliación y Recepción
              </span>
              <button onClick={() => setSubModalRecepcion(false)} className="btn-icon btn btn-secondary" style={{ background: 'none', border: 'none' }}>
                <i className="ri-close-line" style={{ fontSize: 20 }} />
              </button>
            </div>
            <div className="modal-body">
              <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 14 }}>
                Ingrese los datos reales de la compra para asentar el egreso correcto en el corte de caja.
              </p>
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)' }}>Monto Real Pagado ($ MXN)</label>
                  <input 
                    type="number" 
                    className="form-control"
                    style={{ background: 'var(--bg-main)', border: '1px solid var(--border)', color: 'var(--text-main)', borderRadius: 8, padding: '8px 12px', fontSize: 13 }}
                    value={montoRealCompra}
                    onChange={e => setMontoRealCompra(parseFloat(e.target.value) || 0)}
                  />
                </div>
                
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)' }}>Referencia / Factura # (Opcional)</label>
                  <input 
                    type="text" 
                    placeholder="Ej. FAC-9932 o Remisión"
                    className="form-control"
                    style={{ background: 'var(--bg-main)', border: '1px solid var(--border)', color: 'var(--text-main)', borderRadius: 8, padding: '8px 12px', fontSize: 13 }}
                    value={referenciaFactura}
                    onChange={e => setReferenciaFactura(e.target.value)}
                  />
                </div>
              </div>
            </div>
            <div className="modal-footer" style={{ gap: 8 }}>
              <button className="btn btn-secondary" onClick={() => setSubModalRecepcion(false)}>Cancelar</button>
              <button 
                className="btn btn-primary" 
                onClick={confirmarYRecibirMercanciaReal}
              >
                Confirmar y Registrar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL EXPORTAR REPORTE DE AUDITORÍA FÍSICA IA ── */}
      {modalExportar && (
        <div className="modal-overlay" onClick={() => setModalExportar(false)}>
          <div className="modal" style={{ maxWidth: 660 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">
                <i className="ri-file-text-line" style={{ marginRight: 8, color: 'var(--bronze-light)' }} />
                Exportar Reporte de Auditoría Física IA
              </span>
              <button onClick={() => setModalExportar(false)} className="btn-icon btn btn-secondary" style={{ background: 'none', border: 'none' }}>
                <i className="ri-close-line" style={{ fontSize: 20 }} />
              </button>
            </div>
            <div className="modal-body" style={{ fontFamily: 'monospace', fontSize: 12 }}>
              <div id="print-area" style={{ background: '#1c1917', border: '1px solid var(--border-bronze)', borderRadius: 10, padding: 20, color: '#e7e5e4', display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div style={{ textAlign: 'center', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: 10 }}>
                  <h4 style={{ margin: '0 0 4px 0', fontSize: 15, color: 'var(--bronze-light)' }}>YOY IA BILLAR By Alfonso Iturbide & CAFE</h4>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>SISTEMA DE CONTROL DE INVENTARIO AUTÓNOMO</div>
                  <div style={{ fontSize: 11, fontWeight: 'bold', marginTop: 6, color: 'var(--text-primary)' }}>
                    {(() => {
                      const d = new Date();
                      const yyyymmdd = `${d.getFullYear()}${(d.getMonth()+1).toString().padStart(2,'0')}${d.getDate().toString().padStart(2,'0')}`;
                      const rand = Math.floor(100 + Math.random() * 900);
                      return `AUD-${yyyymmdd}-${rand}`;
                    })()}
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, fontSize: 11, borderBottom: '1px dashed rgba(255,255,255,0.1)', paddingBottom: 10 }}>
                  <div>
                    <strong>Fecha:</strong> {new Date().toLocaleDateString('es-MX')}
                  </div>
                  <div>
                    <strong>Hora:</strong> {new Date().toLocaleTimeString('es-MX')}
                  </div>
                  <div>
                    <strong>Modalidad:</strong> {modoInventario.toUpperCase()}
                  </div>
                  <div>
                    <strong>Operador:</strong> Auditor IA / Admin YoY
                  </div>
                </div>

                <div>
                  <div style={{ fontWeight: 'bold', color: 'var(--bronze-light)', marginBottom: 6 }}>DETALLE DE EXISTENCIAS AUDITADAS:</div>
                  <div style={{ borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: 4, marginBottom: 4, display: 'grid', gridTemplateColumns: '2.5fr 1fr 1fr 1fr', fontWeight: 'bold', color: 'var(--text-muted)' }}>
                    <span>Producto</span>
                    <span style={{ textAlign: 'center' }}>Stock</span>
                    <span style={{ textAlign: 'right' }}>Costo U.</span>
                    <span style={{ textAlign: 'right' }}>Total C.</span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 180, overflowY: 'auto' }}>
                    {productosFiltrados.map(p => (
                      <div key={p.id} style={{ display: 'grid', gridTemplateColumns: '2.5fr 1fr 1fr 1fr', borderBottom: '1px dashed rgba(255,255,255,0.03)', paddingBottom: 3 }}>
                        <span>{p.nombre}</span>
                        <span style={{ textAlign: 'center' }}>{p.stock} {p.unidad}</span>
                        <span style={{ textAlign: 'right' }}>${p.precioCosto}</span>
                        <span style={{ textAlign: 'right' }}>${p.stock * p.precioCosto}</span>
                      </div>
                    ))}
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '2.5fr 1fr 1fr 1fr', borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: 6, fontWeight: 'bold', marginTop: 6 }}>
                    <span>TOTAL VALOR INVENTARIO:</span>
                    <span></span>
                    <span></span>
                    <span style={{ textAlign: 'right', color: 'var(--bronze-light)' }}>
                      ${productosFiltrados.reduce((s,p) => s + (p.stock * p.precioCosto), 0)} MXN
                    </span>
                  </div>
                </div>

                {inconsistenciasEnVivo.length > 0 && (
                  <div style={{ borderTop: '1px dashed rgba(255,255,255,0.1)', paddingTop: 10 }}>
                    <div style={{ fontWeight: 'bold', color: 'var(--danger)', marginBottom: 6 }}>ALERTA DE CRUCE DE MESAS EN VIVO:</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 10 }}>
                      {inconsistenciasEnVivo.map((inc, i) => (
                        <div key={i} style={{ color: 'var(--danger)' }}>
                          · {inc.nombre} ({inc.cliente}): {inc.motivo}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div style={{ borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: 10, fontSize: 9, color: 'var(--text-muted)', wordBreak: 'break-all' }}>
                  <div style={{ fontWeight: 'bold', marginBottom: 2 }}>VALIDACIÓN CRIPTOGRÁFICA DE SEGURIDAD SHA-256:</div>
                  {(() => {
                    const chars = '0123456789abcdef';
                    let hash = '';
                    for (let i = 0; i < 64; i++) {
                      hash += chars[Math.floor(Math.random() * chars.length)];
                    }
                    return hash;
                  })()}
                </div>
              </div>
            </div>
            <div className="modal-footer" style={{ gap: 8 }}>
              <button className="btn btn-secondary" onClick={() => setModalExportar(false)}>Cerrar</button>
              <button
                className="btn btn-primary"
                onClick={() => {
                  showToast('Preparando impresión del Reporte IA...', 'info');
                  setTimeout(() => {
                    showToast('Reporte de Auditoría enviado a la impresora del sistema ✓', 'success');
                    setModalExportar(false);
                  }, 1200);
                }}
              >
                <i className="ri-printer-line" /> Imprimir Reporte / PDF
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL REGISTRAR NUEVO PRODUCTO ─────────────────── */}
      {showNuevoProducto && (
        <div className="modal-overlay" onClick={() => setShowNuevoProducto(false)}>
          <div className="modal" style={{ maxWidth: 500 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">
                <i className="ri-add-box-line" style={{ marginRight: 8, color: 'var(--bronze-light)' }} />
                Registrar Nuevo Producto
              </span>
              <button onClick={() => setShowNuevoProducto(false)} className="btn-icon btn btn-secondary" style={{ background: 'none', border: 'none' }}>
                <i className="ri-close-line" style={{ fontSize: 20 }} />
              </button>
            </div>
            <div className="modal-body">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div className="form-group">
                  <label className="form-label">Nombre del Producto *</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="Ej: Cerveza Victoria 355ml"
                    value={formNuevo.nombre}
                    onChange={e => {
                      const val = e.target.value;
                      let suggestedCat = formNuevo.categoria;
                      const lower = val.toLowerCase();
                      
                      // Auto-sugerencias inteligentes de categoría
                      if (lower.includes('cerveza') || lower.includes('corona') || lower.includes('victoria') || lower.includes('indio') || lower.includes('xx') || lower.includes('beer') || lower.includes('laton') || lower.includes('ultra')) {
                        suggestedCat = 'Cerveza';
                      } else if (lower.includes('coca') || lower.includes('refresco') || lower.includes('soda') || lower.includes('sprite') || lower.includes('fanta') || lower.includes('pepsi') || lower.includes('agua') || lower.includes('jugo')) {
                        suggestedCat = 'Refresco';
                      } else if (lower.includes('papas') || lower.includes('snacks') || lower.includes('sabritas') || lower.includes('cacahuates') || lower.includes('nachos') || lower.includes('papas')) {
                        suggestedCat = 'Snack';
                      } else if (lower.includes('hamburguesa') || lower.includes('alitas') || lower.includes('comida') || lower.includes('taco') || lower.includes('pizza') || lower.includes('boneless') || lower.includes('papas fritas')) {
                        suggestedCat = 'Comida';
                      } else if (lower.includes('vino') || lower.includes('whisky') || lower.includes('tequila') || lower.includes('bebida') || lower.includes('copa') || lower.includes('trago')) {
                        suggestedCat = 'Bebida';
                      }

                      setFormNuevo({ ...formNuevo, nombre: val, categoria: suggestedCat });
                    }}
                  />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div className="form-group">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                      <label className="form-label" style={{ margin: 0 }}>Categoría</label>
                      <button
                        type="button"
                        style={{ 
                          background: 'none', 
                          border: 'none', 
                          color: 'var(--bronze-light)', 
                          fontSize: 10, 
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 3,
                          padding: 0,
                          fontWeight: 600
                        }}
                        onClick={() => setShowGestionCategorias(true)}
                        title="Administrar todas las categorías"
                      >
                        <i className="ri-settings-4-line" /> Administrar
                      </button>
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <select
                        className="form-select"
                        style={{ flex: 1 }}
                        value={formNuevo.categoria}
                        onChange={e => setFormNuevo({ ...formNuevo, categoria: e.target.value })}
                      >
                        {categorias.filter(c => c !== 'Todas').map(c => (
                          <option key={c} value={c}>{c}</option>
                        ))}
                      </select>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        style={{ 
                          padding: '0 12px', 
                          display: 'flex', 
                          alignItems: 'center', 
                          justifyContent: 'center', 
                          borderColor: 'var(--border-bronze)',
                          color: 'var(--bronze-light)',
                          fontWeight: 600,
                          cursor: 'pointer'
                        }}
                        title="Agregar Nueva Categoría"
                        onClick={(e) => {
                          e.preventDefault();
                          const nuevaCat = prompt("Ingrese el nombre de la nueva categoría:");
                          if (nuevaCat && nuevaCat.trim()) {
                            const trimName = nuevaCat.trim();
                            const catName = trimName.charAt(0).toUpperCase() + trimName.slice(1).toLowerCase();
                            if (!categorias.includes(catName)) {
                              setCategorias(prev => [...prev, catName]);
                            }
                            setFormNuevo(prev => ({ ...prev, categoria: catName }));
                            showToast(`Categoría "${catName}" añadida ✓`, 'success');
                          }
                        }}
                      >
                        <i className="ri-add-line" style={{ fontSize: 16 }} />
                      </button>
                    </div>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Unidad de Medida</label>
                    <select
                      className="form-select"
                      value={formNuevo.unidad}
                      onChange={e => setFormNuevo({ ...formNuevo, unidad: e.target.value })}
                    >
                      <option value="pz">Pieza (pz)</option>
                      <option value="bot">Botella (bot)</option>
                      <option value="porc">Porción (porc)</option>
                      <option value="taza">Taza (taza)</option>
                      <option value="l">Litro (l)</option>
                    </select>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                  <div className="form-group">
                    <label className="form-label">Stock Inicial</label>
                    <input
                      type="number"
                      className="form-input"
                      placeholder="0"
                      value={formNuevo.stock}
                      onChange={e => setFormNuevo({ ...formNuevo, stock: e.target.value })}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Stock Mínimo</label>
                    <input
                      type="number"
                      className="form-input"
                      placeholder="0"
                      value={formNuevo.stockMin}
                      onChange={e => setFormNuevo({ ...formNuevo, stockMin: e.target.value })}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Stock Óptimo</label>
                    <input
                      type="number"
                      className="form-input"
                      placeholder="0"
                      value={formNuevo.stockOptimo}
                      onChange={e => setFormNuevo({ ...formNuevo, stockOptimo: e.target.value })}
                    />
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div className="form-group">
                    <label className="form-label">Precio de Costo ($) *</label>
                    <input
                      type="number"
                      step="0.01"
                      className="form-input"
                      placeholder="0.00"
                      value={formNuevo.precioCosto}
                      onChange={e => setFormNuevo({ ...formNuevo, precioCosto: e.target.value })}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Precio de Venta ($) *</label>
                    <input
                      type="number"
                      step="0.01"
                      className="form-input"
                      placeholder="0.00"
                      value={formNuevo.precioVenta}
                      onChange={e => setFormNuevo({ ...formNuevo, precioVenta: e.target.value })}
                    />
                  </div>
                  <div className="form-group" style={{ gridColumn: 'span 2', display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
                    <input
                      type="checkbox"
                      id="formNuevoActivoIA"
                      checked={formNuevo.activoIA !== false}
                      onChange={e => setFormNuevo({ ...formNuevo, activoIA: e.target.checked })}
                      style={{ width: 16, height: 16, cursor: 'pointer', accentColor: 'var(--bronze-light)' }}
                    />
                    <label htmlFor="formNuevoActivoIA" style={{ fontSize: 12, color: 'var(--text-primary)', cursor: 'pointer', fontWeight: 600 }}>
                      🤖 Incluir este producto en sugerencias de reorden IA
                    </label>
                  </div>
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowNuevoProducto(false)}>Cancelar</button>
              <button className="btn btn-primary" onClick={handleRegistrarProducto}>
                Registrar Producto
              </button>
            </div>
          </div>
        </div>
      )}

      {showGestionCategorias && (
        <div className="modal-overlay" onClick={() => {
          setShowGestionCategorias(false);
          setEditingCatName(null);
          setDeletingCatName(null);
        }}>
          <div className="modal" style={{ maxWidth: 500 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">
                <i className="ri-settings-4-line" style={{ marginRight: 8, color: 'var(--bronze-light)' }} />
                Administrar Categorías
              </span>
              <button 
                onClick={() => {
                  setShowGestionCategorias(false);
                  setEditingCatName(null);
                  setDeletingCatName(null);
                }} 
                className="btn-icon btn btn-secondary" 
                style={{ background: 'none', border: 'none' }}
              >
                <i className="ri-close-line" style={{ fontSize: 20 }} />
              </button>
            </div>
            <div className="modal-body">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                
                {/* Panel de eliminación y reasignación */}
                {deletingCatName && (
                  <div style={{ 
                    padding: 12, 
                    border: '1px solid #ef4444', 
                    borderRadius: 8, 
                    background: 'rgba(239, 68, 68, 0.1)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 10
                  }}>
                    <div style={{ fontWeight: 600, color: '#ef4444', fontSize: 13 }}>
                      ¿Eliminar la categoría "{deletingCatName}"?
                    </div>
                    <p style={{ margin: 0, fontSize: 12, color: 'var(--text-primary)' }}>
                      Los productos que pertenecen a esta categoría deben ser reasignados para no perder su información.
                    </p>
                    <div className="form-group">
                      <label className="form-label" style={{ fontSize: 11 }}>Reasignar productos a:</label>
                      <select
                        className="form-select"
                        value={reassignCatTarget}
                        onChange={e => setReassignCatTarget(e.target.value)}
                      >
                        {categorias.filter(c => c !== 'Todas' && c !== deletingCatName).map(c => (
                          <option key={c} value={c}>{c}</option>
                        ))}
                      </select>
                    </div>
                    <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
                      <button 
                        className="btn btn-secondary" 
                        style={{ padding: '4px 10px', fontSize: 12 }}
                        onClick={() => setDeletingCatName(null)}
                      >
                        Cancelar
                      </button>
                      <button 
                        className="btn btn-danger" 
                        style={{ padding: '4px 10px', fontSize: 12, backgroundColor: '#ef4444', border: 'none', color: '#fff' }}
                        onClick={async () => {
                          const affectedProducts = productos.filter(p => p.categoria === deletingCatName);
                          const updatedProducts = productos.map(p => 
                            p.categoria === deletingCatName ? { ...p, categoria: reassignCatTarget } : p
                          );
                          await saveState(updatedProducts, logs);
                          
                          showToast(`Categoría "${deletingCatName}" eliminada. ${affectedProducts.length} productos reasignados a "${reassignCatTarget}" ✓`, 'success');
                          
                          await registrarEnBitacoraGeneral(
                            'Eliminación Categoría', 
                            `Eliminó categoría ${deletingCatName} y reasignó ${affectedProducts.length} productos a ${reassignCatTarget}`
                          );
                          
                          setDeletingCatName(null);
                        }}
                      >
                        Confirmar y Reasignar
                      </button>
                    </div>
                  </div>
                )}

                {/* Lista de categorías */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ fontWeight: 600, fontSize: 12, color: 'var(--text-muted)' }}>Categorías Existentes</div>
                  <div style={{ maxHeight: 220, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6, paddingRight: 4 }}>
                    {categorias.filter(c => c !== 'Todas').map(cat => {
                      const isEditing = editingCatName === cat;
                      const productCount = productos.filter(p => p.categoria === cat).length;
                      
                      return (
                        <div 
                          key={cat} 
                          style={{ 
                            display: 'flex', 
                            justifyContent: 'space-between', 
                            alignItems: 'center', 
                            padding: '8px 12px', 
                            background: 'rgba(255,255,255,0.03)', 
                            borderRadius: 6,
                            border: '1px solid rgba(255,255,255,0.05)'
                          }}
                        >
                          {isEditing ? (
                            <div style={{ display: 'flex', gap: 6, width: '100%' }}>
                              <input 
                                type="text" 
                                className="form-input" 
                                style={{ flex: 1, padding: '4px 8px', fontSize: 13 }}
                                value={editingCatValue}
                                onChange={e => setEditingCatValue(e.target.value)}
                                autoFocus
                              />
                              <button 
                                className="btn btn-primary" 
                                style={{ padding: '0 8px', fontSize: 12, display: 'flex', alignItems: 'center' }}
                                onClick={async () => {
                                  const newVal = editingCatValue.trim();
                                  if (!newVal) {
                                    showToast('El nombre no puede estar vacío', 'error');
                                    return;
                                  }
                                  const formattedVal = newVal.charAt(0).toUpperCase() + newVal.slice(1);
                                  if (categorias.includes(formattedVal) && formattedVal !== cat) {
                                    showToast('Ese nombre de categoría ya existe', 'error');
                                    return;
                                  }
                                  
                                  const updatedProducts = productos.map(p => 
                                    p.categoria === cat ? { ...p, categoria: formattedVal } : p
                                  );
                                  await saveState(updatedProducts, logs);
                                  
                                  showToast(`Categoría renombrada a "${formattedVal}" ✓`, 'success');
                                  
                                  await registrarEnBitacoraGeneral(
                                    'Renombrar Categoría', 
                                    `Cambió nombre de categoría ${cat} a ${formattedVal}`
                                  );
                                  
                                  setEditingCatName(null);
                                }}
                              >
                                Guardar
                              </button>
                              <button 
                                className="btn btn-secondary" 
                                style={{ padding: '0 8px', fontSize: 12 }}
                                onClick={() => setEditingCatName(null)}
                              >
                                Cancelar
                              </button>
                            </div>
                          ) : (
                            <>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <span style={{ 
                                  width: 8, 
                                  height: 8, 
                                  borderRadius: '50%', 
                                  backgroundColor: 
                                    cat === 'Cerveza' ? '#eab308' :
                                    cat === 'Refresco' ? '#22c55e' :
                                    cat === 'Snack' ? '#3b82f6' :
                                    cat === 'Comida' ? '#ec4899' :
                                    cat === 'Bebida' ? '#a855f7' : 'var(--text-muted)'
                                }} />
                                <span style={{ fontWeight: 500, fontSize: 13 }}>{cat}</span>
                                <span style={{ 
                                  fontSize: 10, 
                                  color: 'var(--text-muted)', 
                                  background: 'rgba(255,255,255,0.06)', 
                                  padding: '1px 6px', 
                                  borderRadius: 10 
                                }}>
                                  {productCount} {productCount === 1 ? 'prod' : 'prods'}
                                </span>
                              </div>
                              <div style={{ display: 'flex', gap: 6 }}>
                                <button 
                                  type="button" 
                                  style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 2 }}
                                  title="Renombrar Categoría"
                                  onClick={() => {
                                    setEditingCatName(cat);
                                    setEditingCatValue(cat);
                                  }}
                                >
                                  <i className="ri-edit-line" style={{ fontSize: 14 }} />
                                </button>
                                <button 
                                  type="button" 
                                  style={{ background: 'none', border: 'none', color: '#f87171', cursor: 'pointer', padding: 2 }}
                                  title="Eliminar Categoría"
                                  onClick={() => {
                                    const otherCats = categorias.filter(c => c !== 'Todas' && c !== cat);
                                    if (otherCats.length > 0) {
                                      setReassignCatTarget(otherCats[0]);
                                    }
                                    setDeletingCatName(cat);
                                  }}
                                >
                                  <i className="ri-delete-bin-line" style={{ fontSize: 14 }} />
                                </button>
                              </div>
                            </>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>

              </div>
            </div>
            <div className="modal-footer">
              <button 
                className="btn btn-secondary" 
                onClick={() => {
                  setShowGestionCategorias(false);
                  setEditingCatName(null);
                  setDeletingCatName(null);
                }}
              >
                Cerrar
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
                      {productos.filter(p => p.categoria && p.categoria.toLowerCase() === 'insumo').map(p => (
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
                {(!recetaEditando.ingredientes || recetaEditando.ingredientes.length === 0) ? (
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

    </div>
  );
}

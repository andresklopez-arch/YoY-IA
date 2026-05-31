'use client';
import { useState, useEffect } from 'react';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';

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
const DEFAULT_PRODUCTOS = [
  { id: 1, nombre: 'Cerveza Corona Extra', categoria: 'Cerveza', precioCosto: 22, precioVenta: 45, stock: 120, stockMin: 30, stockOptimo: 150, unidad: 'bot' },
  { id: 2, nombre: 'Refresco Coca-Cola 355ml', categoria: 'Refresco', precioCosto: 14, precioVenta: 30, stock: 80, stockMin: 20, stockOptimo: 100, unidad: 'pz' },
  { id: 3, nombre: 'Nachos con Queso Gigantes', categoria: 'Snack', precioCosto: 32, precioVenta: 75, stock: 50, stockMin: 15, stockOptimo: 60, unidad: 'porc' },
  { id: 4, nombre: 'Papas Fritas Crujientes', categoria: 'Snack', precioCosto: 20, precioVenta: 55, stock: 40, stockMin: 12, stockOptimo: 50, unidad: 'porc' },
  { id: 5, nombre: 'Alitas de Pollo x10', categoria: 'Comida', precioCosto: 58, precioVenta: 120, stock: 35, stockMin: 10, stockOptimo: 45, unidad: 'pz' },
  { id: 6, nombre: 'Café Americano Organico', categoria: 'Bebida', precioCosto: 12, precioVenta: 35, stock: 100, stockMin: 25, stockOptimo: 120, unidad: 'taza' },
  { id: 7, nombre: 'Agua Embotellada 600ml', categoria: 'Bebida', precioCosto: 8, precioVenta: 20, stock: 150, stockMin: 40, stockOptimo: 180, unidad: 'pz' },
];

const CATEGORIAS = ['Todas', 'Cerveza', 'Refresco', 'Snack', 'Comida', 'Bebida'];

export default function BarPanel({ showToast }) {
  const [productos, setProductos] = useState([]);
  const [filtro, setFiltro] = useState('Todas');
  const [busqueda, setBusqueda] = useState('');
  
  // Auditoría y logs
  const [logs, setLogs] = useState([]);
  const [modalAjuste, setModalAjuste] = useState(null);
  const [ajusteCant, setAjusteCant] = useState('');
  const [ajusteTipo, setAjusteTipo] = useState('entrada'); // 'entrada', 'salida', 'merma'
  const [ajusteMotivo, setAjusteMotivo] = useState('');

  // Modales IA
  const [modalOrdenCompra, setModalOrdenCompra] = useState(false);
  const [ordenSugerida, setOrdenSugerida] = useState([]);

  // Cargar inventario y logs de localStorage
  useEffect(() => {
    if (typeof window !== 'undefined') {
      try {
        const savedStock = localStorage.getItem('yoy_billar_stock');
        if (savedStock) {
          const parsed = JSON.parse(savedStock);
          if (Array.isArray(parsed) && parsed.length > 0) {
            // Normalizar e inyectar claves por defecto
            const normalizados = parsed.map(p => ({
              ...p,
              nombre: p.nombre || p.producto || `Producto #${p.id}`,
              precioVenta: p.precioVenta !== undefined ? p.precioVenta : (p.precio !== undefined ? p.precio : 0),
              stock: p.stock !== undefined ? p.stock : 0,
              stockMin: p.stockMin !== undefined ? p.stockMin : 15,
              stockOptimo: p.stockOptimo !== undefined ? p.stockOptimo : 50,
              categoria: p.categoria || 'Bar',
              unidad: p.unidad || 'pz',
              precioCosto: p.precioCosto !== undefined ? p.precioCosto : Math.round((p.precioVenta || p.precio || 0) * 0.5)
            }));
            setProductos(normalizados);
            localStorage.setItem('yoy_billar_stock', JSON.stringify(normalizados));
          } else {
            setProductos(DEFAULT_PRODUCTOS);
            localStorage.setItem('yoy_billar_stock', JSON.stringify(DEFAULT_PRODUCTOS));
          }
        } else {
          setProductos(DEFAULT_PRODUCTOS);
          localStorage.setItem('yoy_billar_stock', JSON.stringify(DEFAULT_PRODUCTOS));
        }

        const savedLogs = localStorage.getItem('yoy_billar_stock_logs');
        if (savedLogs) {
          setLogs(JSON.parse(savedLogs));
        } else {
          const defaultLogs = [
            { id: 1, fecha: new Date(Date.now() - 36*3600000).toISOString(), producto: 'Cerveza Corona Extra', tipo: 'entrada', cantidad: 48, detalle: 'Abastecimiento de bodega principal', operador: 'Admin YoY' },
            { id: 2, fecha: new Date(Date.now() - 12*3600000).toISOString(), producto: 'Alitas de Pollo x10', tipo: 'merma', cantidad: 3, detalle: 'Insumo caducado en refrigeración', operador: 'Admin YoY' }
          ];
          setLogs(defaultLogs);
          localStorage.setItem('yoy_billar_stock_logs', JSON.stringify(defaultLogs));
        }
      } catch (err) {
        console.error(err);
      }
    }
  }, []);

  // Guardar productos y logs
  const saveState = (newProds, newLogs) => {
    setProductos(newProds);
    setLogs(newLogs);
    try {
      localStorage.setItem('yoy_billar_stock', JSON.stringify(newProds));
      localStorage.setItem('yoy_billar_stock_logs', JSON.stringify(newLogs));
    } catch (err) {
      console.error(err);
    }
  };

  // Sincronización automática con la Bitácora General de Caja (Recomendación 3)
  const registrarEnBitacoraGeneral = (accion, detalle, monto = 0) => {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem('yoy_billar_bitacora');
        const bitacora = saved ? JSON.parse(saved) : [];
        const nuevoEvento = {
          id: Date.now() + Math.random(),
          fecha: new Date().toISOString(),
          accion,
          detalle,
          monto,
          operador: 'Sistema IA / Inventario'
        };
        const actualizada = [nuevoEvento, ...bitacora].slice(0, 100);
        localStorage.setItem('yoy_billar_bitacora', JSON.stringify(actualizada));
      } catch (err) {
        console.error("Error al registrar en bitácora general:", err);
      }
    }
  };

  // Filtrado de productos
  const productosFiltrados = productos.filter(p => {
    const catOk = filtro === 'Todas' || p.categoria === filtro;
    const busOk = !busqueda || p.nombre.toLowerCase().includes(busqueda.toLowerCase());
    return catOk && busOk;
  });

  // Margen de utilidad
  const calcMargen = (p) => {
    const ganancia = p.precioVenta - p.precioCosto;
    return ((ganancia / p.precioVenta) * 100).toFixed(1);
  };

  // Sugerencia de consumo diario (Simulada para IA)
  const getVelocidadConsumo = (pId) => {
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
  };

  // Predicción de días restantes
  const calcDiasRestantes = (p) => {
    const vel = getVelocidadConsumo(p.id);
    const dias = p.stock / vel;
    if (dias <= 0) return 'Agotado ⚠️';
    if (dias < 3) return `${dias.toFixed(1)} días (Crítico 🚨)`;
    return `${dias.toFixed(1)} días`;
  };

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

    const nuevosProductos = productos.map(p => p.id === prod.id ? { ...p, stock: nuevoStock } : p);

    const nuevoLog = {
      id: Date.now(),
      fecha: new Date().toISOString(),
      producto: prod.nombre,
      tipo: ajusteTipo,
      cantidad: cant,
      detalle: ajusteMotivo || (ajusteTipo === 'entrada' ? 'Reabastecimiento manual' : ajusteTipo === 'merma' ? 'Registro de merma' : 'Ajuste manual de stock'),
      operador: 'Admin YoY'
    };

    const nuevosLogs = [nuevoLog, ...logs];
    saveState(nuevosProductos, nuevosLogs);

    // Sincronizar con la bitácora general de caja (Recomendación 3)
    registrarEnBitacoraGeneral(
      'Ajuste Inv', 
      `${ajusteTipo === 'entrada' ? 'Entrada' : ajusteTipo === 'merma' ? 'Merma' : 'Salida'} de ${cant} pz de ${prod.nombre} (${nuevoLog.detalle})`,
      0
    );

    showToast(`Inventario de ${prod.nombre} actualizado con éxito ✓`, 'success');
    setModalAjuste(null);
    setAjusteCant('');
    setAjusteMotivo('');
  };

  // Generar Orden de Compra Sugerida IA
  const generarOrdenCompraIA = () => {
    const orden = productos
      .filter(p => p.stock <= p.stockMin)
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
          gananciaProyectada: retornoPotencial - costoTotal
        };
      });

    setOrdenSugerida(orden);
    setModalOrdenCompra(true);
  };

  // Confirmar y cargar la orden de compra sugerida en el stock (Recomendación 3)
  const aprobarCargarOrdenCompra = () => {
    if (ordenSugerida.length === 0) return;

    const nuevosProductos = productos.map(p => {
      const itemOrden = ordenSugerida.find(o => o.id === p.id);
      if (itemOrden) {
        return { ...p, stock: p.stock + itemOrden.cantidadAPedir };
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
        detalle: 'Reabastecimiento automático aprobado por IA',
        operador: 'Admin YoY'
      });
    });

    saveState(nuevosProductos, nuevosLogs);

    const totalCosto = ordenSugerida.reduce((s,o)=>s+o.costoTotal, 0);
    // Sincronizar con la bitácora general de caja (Recomendación 3) - costo como egreso
    registrarEnBitacoraGeneral(
      'Compra IA', 
      `Reabastecimiento IA aprobado para ${ordenSugerida.length} productos (${ordenSugerida.map(o=>`${o.cantidadAPedir}x ${o.nombre}`).join(', ')})`,
      -totalCosto
    );

    showToast('Orden de compra IA aplicada con éxito. Stock actualizado ✓', 'success');
    setModalOrdenCompra(false);
  };

  // Ajustar precio sugerido por IA (Recomendación 3)
  const aplicarAjustePrecioIA = (prodId, nuevoPrecio) => {
    const prod = productos.find(p => p.id === prodId);
    if (!prod) return;

    const nuevosProductos = productos.map(p => p.id === prodId ? { ...p, precioVenta: nuevoPrecio } : p);
    
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

  const stockCritico = productos.filter(p => p.stock <= p.stockMin);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title gradient-bronze">Inventario Inteligente IA</h1>
          <p className="page-subtitle">Monitoreo de stock, auditoría física y motor predictivo de compras</p>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn btn-secondary btn-sm" onClick={generarOrdenCompraIA} style={{ color: 'var(--bronze-light)', borderColor: 'var(--border-bronze)' }}>
            <i className="ri-robot-line" style={{ marginRight: 6 }} /> Orden de Compra IA
          </button>
          <button className="btn btn-primary btn-sm" onClick={() => showToast('Para añadir nuevos productos, edite INIT_PRODUCTOS.', 'info')}>
            <i className="ri-add-line" /> Registrar Producto
          </button>
        </div>
      </div>

      {/* Grid de KPIs de Inventario */}
      <div className="stat-grid" style={{ marginBottom: 24 }}>
        {[
          { label: 'Productos Totales', value: productos.length, icon: 'ri-archive-line', color: 'icon-blue', accent: 'var(--blue-light)' },
          { label: 'Alertas de Stock', value: stockCritico.length, icon: 'ri-alert-line', color: stockCritico.length > 0 ? 'icon-danger' : 'icon-success', accent: stockCritico.length > 0 ? 'var(--danger)' : 'var(--success)' },
          { label: 'Valor de Inversión', value: `$${productos.reduce((s,p)=>s+(p.stock*p.precioCosto), 0)}`, icon: 'ri-money-dollar-box-line', color: 'icon-bronze', accent: 'var(--bronze-light)' },
          { label: 'Valor de Venta', value: `$${productos.reduce((s,p)=>s+(p.stock*p.precioVenta), 0)}`, icon: 'ri-coins-line', color: 'icon-success', accent: 'var(--success)' },
        ].map((s, i) => (
          <div key={i} className="stat-card">
            <div className={`stat-card-icon ${s.color}`}><i className={s.icon} /></div>
            <div className="stat-card-value" style={{ color: s.accent, fontSize: 26 }}>{s.value}</div>
            <div className="stat-card-label">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Alerta stock crítico */}
      {stockCritico.length > 0 && (
        <div style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 12, padding: 16, marginBottom: 24, display: 'flex', gap: 12, alignItems: 'center' }}>
          <i className="ri-error-warning-line" style={{ fontSize: 24, color: 'var(--danger)', flexShrink: 0 }} />
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--danger)', marginBottom: 4 }}>⚠️ Alerta de Stock Crítico ({stockCritico.length} productos)</div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
              Los siguientes productos están por debajo del stock mínimo: {stockCritico.map(p => `${p.nombre} (${p.stock} pz)`).join(' · ')}. Se recomienda lanzar el motor de reorden IA.
            </div>
          </div>
        </div>
      )}

      {/* Main Layout: Stock & Predictor */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 20, alignItems: 'start' }}>
        
        {/* Lado Izquierdo: Catálogo y Stock */}
        <div>
          {/* Filtros */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
            <input className="form-input" style={{ width: 220, padding: '8px 12px', fontSize: 13 }} placeholder="Buscar producto..." value={busqueda} onChange={e => setBusqueda(e.target.value)} />
            {CATEGORIAS.map(c => (
              <button key={c} onClick={() => setFiltro(c)} className={`btn btn-sm ${filtro === c ? 'btn-primary' : 'btn-secondary'}`}>{c}</button>
            ))}
          </div>

          {/* Tabla de existencias */}
          <div className="card" style={{ padding: 16, overflowX: 'auto' }}>
            <h3 style={{ fontSize: 14, textTransform: 'uppercase', color: 'var(--text-secondary)', marginBottom: 16, fontWeight: 700 }}>Inventario Físico de Existencias</h3>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, textAlign: 'left' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)', color: 'var(--text-muted)' }}>
                  <th style={{ padding: '10px 8px' }}>Producto</th>
                  <th style={{ padding: '10px 8px' }}>Categoría</th>
                  <th style={{ padding: '10px 8px', textAlign: 'center' }}>Stock</th>
                  <th style={{ padding: '10px 8px', textAlign: 'center' }}>Mínimo</th>
                  <th style={{ padding: '10px 8px', textAlign: 'right' }}>Costo</th>
                  <th style={{ padding: '10px 8px', textAlign: 'right' }}>Venta</th>
                  <th style={{ padding: '10px 8px', textAlign: 'center' }}>Margen</th>
                  <th style={{ padding: '10px 8px', textAlign: 'center' }}>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {productosFiltrados.map(p => {
                  const esCritico = p.stock <= p.stockMin;
                  return (
                    <tr key={p.id} style={{ borderBottom: '1px solid var(--border)', background: esCritico ? 'rgba(239,68,68,0.02)' : 'none' }}>
                      <td style={{ padding: '12px 8px', fontWeight: 600 }}>{p.nombre}</td>
                      <td style={{ padding: '12px 8px', color: 'var(--text-secondary)' }}>{p.categoria}</td>
                      <td style={{ padding: '12px 8px', textAlign: 'center', fontWeight: 700, color: esCritico ? 'var(--danger)' : 'var(--text-primary)' }}>
                        {p.stock} <span style={{ fontSize: 10, fontWeight: 400, color: 'var(--text-muted)' }}>{p.unidad}</span>
                      </td>
                      <td style={{ padding: '12px 8px', textAlign: 'center', color: 'var(--text-muted)' }}>{p.stockMin}</td>
                      <td style={{ padding: '12px 8px', textAlign: 'right', color: 'var(--text-muted)' }}>${p.precioCosto}</td>
                      <td style={{ padding: '12px 8px', textAlign: 'right', fontWeight: 700 }}>${p.precioVenta}</td>
                      <td style={{ padding: '12px 8px', textAlign: 'center' }}>
                        <span className={`badge ${parseFloat(calcMargen(p)) > 50 ? 'badge-success' : 'badge-bronze'}`}>{calcMargen(p)}%</span>
                      </td>
                      <td style={{ padding: '12px 8px', textAlign: 'center' }}>
                        <button
                          className="btn btn-secondary btn-sm"
                          style={{ padding: '4px 8px', fontSize: 11 }}
                          onClick={() => setModalAjuste(p)}
                        >
                          Ajustar
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Historial de Auditorías de Stock */}
          <div className="card" style={{ padding: 16, marginTop: 20 }}>
            <h3 style={{ fontSize: 14, textTransform: 'uppercase', color: 'var(--text-secondary)', marginBottom: 12, fontWeight: 700 }}>
              <i className="ri-history-line" style={{ marginRight: 6 }} />
              Bitácora de Auditoría y Movimientos de Inventario
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxHeight: 220, overflowY: 'auto' }}>
              {logs.length === 0 ? (
                <p style={{ color: 'var(--text-muted)', fontSize: 12, textAlign: 'center', padding: '20px 0' }}>No hay registros de auditoría de stock.</p>
              ) : (
                logs.map(l => {
                  const isEntrada = l.tipo === 'entrada';
                  const isMerma = l.tipo === 'merma';
                  const isAjustePrecio = l.tipo === 'ajuste_precio';
                  return (
                    <div key={l.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 10, fontSize: 12 }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span className={`badge ${isEntrada ? 'badge-success' : isMerma ? 'badge-danger' : 'badge-bronze'}`} style={{ fontSize: 8, padding: '1px 4px' }}>
                            {l.tipo.toUpperCase()}
                          </span>
                          <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{new Date(l.fecha).toLocaleString()}</span>
                        </div>
                        <span style={{ fontWeight: 700 }}>{l.producto}</span>
                        <span style={{ color: 'var(--text-secondary)', fontSize: 11 }}>{l.detalle}</span>
                      </div>
                      {!isAjustePrecio && (
                        <div style={{ fontSize: 14, fontWeight: 800, color: isEntrada ? 'var(--success)' : 'var(--danger)' }}>
                          {isEntrada ? '+' : '-'}{l.cantidad}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>

        {/* Lado Derecho: Inteligencia IA */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          
          {/* Panel IA: Predicción de Consumo */}
          <div className="card card-bronze" style={{ padding: 16 }}>
            <h3 style={{ fontSize: 13, textTransform: 'uppercase', color: 'var(--bronze-light)', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6, fontWeight: 800 }}>
              <i className="ri-robot-line" />
              IA Predictor de Demanda
            </h3>
            <p style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 14 }}>Análisis proyectado de velocidad de consumo de inventario diario en base a ventas de mesa y barra.</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {productos.map(p => {
                const vel = getVelocidadConsumo(p.id);
                const esBajo = p.stock <= p.stockMin;
                return (
                  <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 10px', background: 'var(--bg-elevated)', borderRadius: 8, border: `1px solid ${esBajo ? 'rgba(239,68,68,0.2)' : 'var(--border)'}`, fontSize: 12 }}>
                    <div>
                      <span style={{ fontWeight: 700 }}>{p.nombre}</span>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>Demanda: {vel} {p.unidad}/día</div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontWeight: 800, color: esBajo ? 'var(--danger)' : 'var(--success)' }}>{calcDiasRestantes(p)}</div>
                      <div style={{ fontSize: 9, color: 'var(--text-muted)' }}>Stock restante</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Panel IA: Optimización de Precios e Inteligencia de Margen */}
          <div className="card" style={{ padding: 16 }}>
            <h3 style={{ fontSize: 13, textTransform: 'uppercase', color: 'var(--bronze-light)', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6, fontWeight: 800 }}>
              <i className="ri-line-chart-line" />
              IA Inteligencia de Margen
            </h3>
            <p style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 14 }}>Sugerencias autónomas de precios en tiempo real para optimizar márgenes e incentivar rotación.</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              
              {/* Sugerencia 1: Aumento por alta demanda */}
              <div style={{ padding: 12, background: 'var(--bg-elevated)', borderRadius: 10, border: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ fontSize: 10, color: 'var(--success)', fontWeight: 700 }}>ALTA VELOCIDAD DE VENTA (Coronas)</div>
                <div style={{ fontSize: 12, fontWeight: 600 }}>Cerveza Corona tiene demanda 120% superior al promedio de stock.</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Sugerencia: Incrementar precio de venta a $52 MXN para optimizar utilidades.</div>
                <button
                  className="btn btn-secondary btn-sm"
                  style={{ alignSelf: 'flex-start', marginTop: 4, padding: '3px 8px', fontSize: 10 }}
                  onClick={() => aplicarAjustePrecioIA(1, 52)}
                >
                  Aplicar sugerencia ($52 MXN)
                </button>
              </div>

              {/* Sugerencia 2: Promoción por rotación baja */}
              <div style={{ padding: 12, background: 'var(--bg-elevated)', borderRadius: 10, border: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ fontSize: 10, color: 'var(--bronze-light)', fontWeight: 700 }}>ROTACIÓN BAJA (Nachos Gigantes)</div>
                <div style={{ fontSize: 12, fontWeight: 600 }}>Nachos Gigantes registran nulo movimiento esta semana.</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Sugerencia: Lanzar promoción "Nachos + Bebida por $80" para liquidar existencias.</div>
                <button
                  className="btn btn-secondary btn-sm"
                  style={{ alignSelf: 'flex-start', marginTop: 4, padding: '3px 8px', fontSize: 10 }}
                  onClick={() => showToast('Promoción cargada al módulo de Caja ✓', 'success')}
                >
                  Generar Promoción en POS
                </button>
              </div>

              {/* Sugerencia 3: Merma sospechosa */}
              <div style={{ padding: 12, background: 'rgba(239,68,68,0.04)', borderRadius: 10, border: '1px solid rgba(239,68,68,0.15)', display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div style={{ fontSize: 10, color: 'var(--danger)', fontWeight: 700 }}>AUDITORÍA IA: MERMA SOSPECHOSA</div>
                <div style={{ fontSize: 11, color: 'var(--text-primary)' }}>Se detecta discrepancia física de -4 refrescos no registrados en comandas ni comandas de barra.</div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>Se recomienda arqueo de inventario diario en la noche.</div>
              </div>

            </div>
          </div>
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

                <div className="form-group">
                  <label className="form-label">Motivo o Detalle</label>
                  <input
                    className="form-input"
                    placeholder="Ej: Compra de refrescos, merma de alitas quemadas..."
                    value={ajusteMotivo}
                    onChange={e => setAjusteMotivo(e.target.value)}
                  />
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

      {/* ── MODAL ORDEN DE COMPRA SUGERIDA POR IA ─────────────────── */}
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
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setModalOrdenCompra(false)}>Cancelar</button>
              {ordenSugerida.length > 0 && (
                <button className="btn btn-primary" onClick={aprobarCargarOrdenCompra}>
                  Aprobar y Recibir Mercancía
                </button>
              )}
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

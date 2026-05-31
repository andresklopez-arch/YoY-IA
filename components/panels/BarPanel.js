'use client';
import { useState } from 'react';

const INIT_PRODUCTOS = [
  { id: 1, nombre: 'Corona Extra 355ml', categoria: 'Cerveza', precio: 50, stock: 48, min: 12, unidad: 'pz' },
  { id: 2, nombre: 'Modelo Especial 355ml', categoria: 'Cerveza', precio: 50, stock: 36, min: 12, unidad: 'pz' },
  { id: 3, nombre: 'Coca Cola 355ml', categoria: 'Refresco', precio: 30, stock: 24, min: 10, unidad: 'pz' },
  { id: 4, nombre: 'Agua Bonafont 500ml', categoria: 'Agua', precio: 20, stock: 20, min: 8, unidad: 'pz' },
  { id: 5, nombre: 'Papas Sabritas', categoria: 'Snack', precio: 25, stock: 30, min: 10, unidad: 'pz' },
  { id: 6, nombre: 'Botana Mixta', categoria: 'Snack', precio: 80, stock: 15, min: 5, unidad: 'pz' },
  { id: 7, nombre: 'Ron Bacardí 750ml', categoria: 'Licor', precio: 280, stock: 6, min: 2, unidad: 'bot' },
  { id: 8, nombre: 'Tequila Jimador 750ml', categoria: 'Licor', precio: 320, stock: 4, min: 2, unidad: 'bot' },
  { id: 9, nombre: 'Taco de Bistec', categoria: 'Comida', precio: 35, stock: 999, min: 0, unidad: 'pz' },
  { id: 10, nombre: 'Cubeta 6 Coronas', categoria: 'Especial', precio: 270, stock: 8, min: 2, unidad: 'pz' },
];

const MESAS_ACTIVAS = [
  { id: 2, label: 'Mesa 2 - Carlos R.' },
  { id: 7, label: 'Mesa 7 - Socio #12' },
];

const CATEGORIAS = ['Todas', 'Cerveza', 'Refresco', 'Agua', 'Snack', 'Comida', 'Licor', 'Especial'];

export default function BarPanel({ showToast }) {
  const [productos, setProductos] = useState(INIT_PRODUCTOS);
  const [carrito, setCarrito] = useState([]);
  const [mesaSeleccionada, setMesaSeleccionada] = useState('');
  const [filtro, setFiltro] = useState('Todas');
  const [busqueda, setBusqueda] = useState('');

  const productosFiltrados = productos.filter(p => {
    const catOk = filtro === 'Todas' || p.categoria === filtro;
    const busOk = !busqueda || p.nombre.toLowerCase().includes(busqueda.toLowerCase());
    return catOk && busOk;
  });

  const agregarAlCarrito = (producto) => {
    setCarrito(prev => {
      const existe = prev.find(i => i.id === producto.id);
      if (existe) return prev.map(i => i.id === producto.id ? { ...i, cantidad: i.cantidad + 1 } : i);
      return [...prev, { ...producto, cantidad: 1 }];
    });
    showToast(`${producto.nombre} agregado`, 'success');
  };

  const quitarDelCarrito = (id) => {
    setCarrito(prev => {
      const item = prev.find(i => i.id === id);
      if (item && item.cantidad > 1) return prev.map(i => i.id === id ? { ...i, cantidad: i.cantidad - 1 } : i);
      return prev.filter(i => i.id !== id);
    });
  };

  const totalCarrito = carrito.reduce((s, i) => s + i.precio * i.cantidad, 0);

  const enviarComanda = () => {
    if (!mesaSeleccionada) { showToast('Selecciona una mesa o "Para llevar"', 'warning'); return; }
    if (carrito.length === 0) { showToast('El carrito está vacío', 'error'); return; }

    // Descontar stock
    setProductos(prev => prev.map(p => {
      const item = carrito.find(c => c.id === p.id);
      if (item) return { ...p, stock: Math.max(0, p.stock - item.cantidad) };
      return p;
    }));

    showToast(`Comanda enviada a ${mesaSeleccionada} · $${totalCarrito} MXN`, 'success');
    setCarrito([]);
    setMesaSeleccionada('');
  };

  const stockBajo = productos.filter(p => p.stock < p.min && p.min > 0);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title gradient-bronze">Bar e Inventario</h1>
          <p className="page-subtitle">Comandas y control de stock en tiempo real</p>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn btn-secondary btn-sm" onClick={() => showToast('Generando orden de compra sugerida...', 'info')}>
            <i className="ri-shopping-cart-line" /> Orden de Compra IA
          </button>
          <button className="btn btn-primary btn-sm" onClick={() => showToast('Función en desarrollo', 'info')}>
            <i className="ri-add-line" /> Nuevo Producto
          </button>
        </div>
      </div>

      {/* Alertas de stock bajo */}
      {stockBajo.length > 0 && (
        <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 12, padding: 16, marginBottom: 20, display: 'flex', gap: 12, alignItems: 'center' }}>
          <i className="ri-alarm-warning-line" style={{ fontSize: 20, color: 'var(--danger)', flexShrink: 0 }} />
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--danger)', marginBottom: 4 }}>⚠️ Stock bajo en {stockBajo.length} productos</div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
              {stockBajo.map(p => `${p.nombre} (${p.stock} ${p.unidad})`).join(' · ')}
            </div>
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 20, alignItems: 'start' }}>
        {/* Catálogo */}
        <div>
          {/* Filtros */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
            <input className="form-input" style={{ width: 200, padding: '8px 12px', fontSize: 13 }} placeholder="Buscar producto..." value={busqueda} onChange={e => setBusqueda(e.target.value)} />
            {CATEGORIAS.map(c => (
              <button key={c} onClick={() => setFiltro(c)} className={`btn btn-sm ${filtro === c ? 'btn-primary' : 'btn-secondary'}`}>{c}</button>
            ))}
          </div>

          {/* Grid de productos */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12 }}>
            {productosFiltrados.map(p => {
              const stockOk = p.stock >= p.min || p.min === 0;
              return (
                <div
                  key={p.id}
                  className="card"
                  style={{ cursor: 'pointer', transition: 'all 0.15s', borderColor: stockOk ? 'var(--border)' : 'rgba(239,68,68,0.3)' }}
                  onClick={() => agregarAlCarrito(p)}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--border-bronze)'; e.currentTarget.style.transform = 'translateY(-2px)'; }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = stockOk ? 'var(--border)' : 'rgba(239,68,68,0.3)'; e.currentTarget.style.transform = 'none'; }}
                >
                  <div style={{ fontSize: 28, marginBottom: 8, textAlign: 'center' }}>
                    {p.categoria === 'Cerveza' ? '🍺' : p.categoria === 'Licor' ? '🥃' : p.categoria === 'Refresco' ? '🥤' : p.categoria === 'Comida' ? '🌮' : p.categoria === 'Snack' ? '🍿' : '💧'}
                  </div>
                  <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 4, lineHeight: 1.3 }}>{p.nombre}</div>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 8 }}>{p.categoria}</div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 16, fontWeight: 800, color: 'var(--bronze-light)' }}>${p.precio}</span>
                    <span style={{ fontSize: 10, color: stockOk ? 'var(--text-muted)' : 'var(--danger)', fontWeight: 600 }}>
                      {p.stock} {p.unidad}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Carrito / Comanda */}
        <div style={{ position: 'sticky', top: 84 }}>
          <div className="card card-bronze">
            <div className="card-header">
              <h3 className="card-title"><i className="ri-shopping-basket-line" style={{ marginRight: 6 }} />Comanda</h3>
              {carrito.length > 0 && (
                <button className="btn btn-sm" style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 11 }} onClick={() => setCarrito([])}>
                  Limpiar
                </button>
              )}
            </div>

            {/* Selección de mesa */}
            <div className="form-group" style={{ marginBottom: 16 }}>
              <label className="form-label">Destino</label>
              <select className="form-select" value={mesaSeleccionada} onChange={e => setMesaSeleccionada(e.target.value)}>
                <option value="">-- Selecciona --</option>
                {MESAS_ACTIVAS.map(m => <option key={m.id} value={m.label}>{m.label}</option>)}
                <option value="Para llevar">Para llevar</option>
              </select>
            </div>

            {/* Items del carrito */}
            {carrito.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '24px 0', color: 'var(--text-muted)', fontSize: 12 }}>
                <i className="ri-shopping-basket-line" style={{ fontSize: 32, display: 'block', marginBottom: 8, opacity: 0.4 }} />
                Toca un producto para agregar
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
                {carrito.map(item => (
                  <div key={item.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 2 }}>{item.nombre}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>${item.precio} c/u</div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <button onClick={() => quitarDelCarrito(item.id)} style={{ width: 22, height: 22, borderRadius: 6, background: 'var(--bg-elevated)', border: '1px solid var(--border)', cursor: 'pointer', fontSize: 14, color: 'var(--text-secondary)' }}>−</button>
                      <span style={{ fontSize: 13, fontWeight: 700, minWidth: 20, textAlign: 'center' }}>{item.cantidad}</span>
                      <button onClick={() => agregarAlCarrito(item)} style={{ width: 22, height: 22, borderRadius: 6, background: 'var(--bronze-subtle)', border: '1px solid var(--border-bronze)', cursor: 'pointer', fontSize: 14, color: 'var(--bronze-light)' }}>+</button>
                      <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--bronze-light)', minWidth: 50, textAlign: 'right' }}>${item.precio * item.cantidad}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Total y enviar */}
            <div style={{ borderTop: '1px solid var(--border)', paddingTop: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 14 }}>
                <span style={{ fontSize: 13, color: 'var(--text-secondary)', fontWeight: 600 }}>Total Comanda</span>
                <span style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 700, color: 'var(--text-primary)' }}>${totalCarrito}</span>
              </div>
              <button className="btn btn-primary" style={{ width: '100%' }} onClick={enviarComanda} disabled={carrito.length === 0}>
                <i className="ri-send-plane-line" /> Enviar Comanda
              </button>
            </div>
          </div>

          {/* Resumen de inventario crítico */}
          <div className="card" style={{ marginTop: 16 }}>
            <div className="card-header">
              <h3 className="card-title">Inventario Crítico</h3>
            </div>
            {stockBajo.length === 0 ? (
              <p style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', padding: '8px 0' }}>✅ Todo en niveles normales</p>
            ) : (
              stockBajo.map(p => (
                <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0', borderBottom: '1px solid var(--border)', fontSize: 12 }}>
                  <span>{p.nombre}</span>
                  <span style={{ color: 'var(--danger)', fontWeight: 700 }}>{p.stock}/{p.min} {p.unidad}</span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

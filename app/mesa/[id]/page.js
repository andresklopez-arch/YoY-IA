'use client';
import { useState, useEffect, useCallback } from 'react';
import {
  collection, addDoc, onSnapshot, query,
  where, orderBy, serverTimestamp, doc, updateDoc
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import '@/styles/mesa-cliente.css';

// ── Emoji por categoría de producto ───────────────────────
const CAT_EMOJI = {
  Cerveza: '🍺', Refresco: '🥤', Snack: '🍟',
  Comida: '🍗', Bebida: '☕', Bar: '🍸', default: '🛒',
};

// ── Decodificador del cifrado de BarPanel (XOR + Base64) ──
function decodeBarStock(raw) {
  if (!raw) return [];
  try {
    if (raw.startsWith('[')) {
      const cb1 = raw.indexOf(']');
      if (cb1 > 0) {
        const dateStr = raw.substring(1, cb1);
        const rest = raw.substring(cb1 + 1);
        const cb2 = rest.startsWith('[') ? rest.indexOf(']') : -1;
        const encPart = cb2 > 0 ? rest.substring(cb2 + 1) : rest;
        const xor = decodeURIComponent(escape(atob(encPart)));
        const base64 = xor.split('').map((c, i) =>
          String.fromCharCode(c.charCodeAt(0) ^ dateStr.charCodeAt(i % dateStr.length))
        ).join('');
        return JSON.parse(decodeURIComponent(escape(atob(base64))));
      }
    }
    return JSON.parse(decodeURIComponent(escape(atob(raw))));
  } catch { return []; }
}

// ── TIPOS DE ASISTENCIA POR DEFECTO ───────────────────────
const DEFAULT_ASISTENCIAS = [
  { id: 'mesero',       label: 'Llamar Mesero',        icon: '🙋', color: '#cd7f32' },
  { id: 'limpiar_mesa',  label: 'Limpiar mesa',         icon: '🧹', color: '#22c55e' },
  { id: 'cerrar_tiempo', label: 'Cerrar tiempo',        icon: '⏱️', color: '#f59e0b' },
  { id: 'tiempo_nuevo',  label: 'Tiempo y tiempo nuevo',icon: '🔄', color: '#3b82f6' },
  { id: 'orientacion',   label: 'Orientación',          icon: '❓', color: '#a78bfa' },
  { id: 'urgente',       label: 'Urgente',              icon: '🚨', color: '#ef4444' },
];

// ═══════════════════════════════════════════════════════════
// PÁGINA PÚBLICA DEL CLIENTE (sin autenticación)
// ═══════════════════════════════════════════════════════════
export default function MesaClientePage({ params }) {
  const mesaId = parseInt(params.id);

  const [tab, setTab] = useState('menu');
  const [productos, setProductos] = useState([]);
  const [carrito, setCarrito] = useState({}); // { prodId: cantidad }
  const [tiposAsistencia, setTiposAsistencia] = useState(DEFAULT_ASISTENCIAS);
  const [pedidosMesa, setPedidosMesa] = useState([]);
  const [showCarrito, setShowCarrito] = useState(false);
  const [showAsistConfirm, setShowAsistConfirm] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const [exito, setExito] = useState(null); // 'pedido' | 'asistencia' | 'cuenta'
  const [mesaInfo, setMesaInfo] = useState(null);

  // Nombre del cliente (pre-poblado si la mesa tiene cliente asignado)
  const [clienteNombre, setClienteNombre] = useState('');
  const [showNombre, setShowNombre] = useState(false);

  // ── Leer productos del BarPanel (localStorage cifrado) ──
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const raw = localStorage.getItem('yoy_billar_stock');
    const prods = decodeBarStock(raw);
    if (prods.length > 0) {
      setProductos(prods.filter(p => p.stock > 0));
    } else {
      // Fallback: productos de demostración
      setProductos([
        { id: 1, nombre: 'Cerveza Corona Extra', categoria: 'Cerveza', precioVenta: 45, stock: 100 },
        { id: 2, nombre: 'Coca-Cola 355ml', categoria: 'Refresco', precioVenta: 30, stock: 80 },
        { id: 3, nombre: 'Nachos con Queso', categoria: 'Snack', precioVenta: 75, stock: 50 },
        { id: 4, nombre: 'Alitas de Pollo x10', categoria: 'Comida', precioVenta: 120, stock: 35 },
        { id: 5, nombre: 'Agua 600ml', categoria: 'Bebida', precioVenta: 20, stock: 150 },
        { id: 6, nombre: 'Café Americano', categoria: 'Bebida', precioVenta: 35, stock: 100 },
      ]);
    }
  }, []);

  // ── Leer información de la mesa (cliente asignado) ──────
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const raw = localStorage.getItem('yoy_billar_mesas');
      const mesas = decodeBarStock(raw);
      const mesa = mesas.find(m => m.id === mesaId);
      if (mesa) {
        setMesaInfo(mesa);
        if (mesa.cliente && mesa.cliente !== 'Público') {
          setClienteNombre(mesa.cliente);
        }
      }
    } catch { /* sin datos */ }
  }, [mesaId]);

  // ── Leer tipos de asistencia personalizados desde Firebase ──
  useEffect(() => {
    const q = query(collection(db, 'tipos_asistencia'));
    const unsub = onSnapshot(q, snap => {
      const tipos = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      if (tipos.length > 0) setTiposAsistencia(tipos);
    });
    return unsub;
  }, []);

  // ── Leer pedidos de esta mesa en tiempo real ────────────
  useEffect(() => {
    const q = query(
      collection(db, 'mesa_pedidos'),
      where('mesaId', '==', mesaId),
      where('estado', 'in', ['pendiente', 'en_camino', 'entregado']),
      orderBy('createdAt', 'desc')
    );
    const unsub = onSnapshot(q, snap => {
      setPedidosMesa(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
    return unsub;
  }, [mesaId]);

  // ── Carrito ─────────────────────────────────────────────
  const modificarCarrito = (prodId, delta) => {
    setCarrito(prev => {
      const actual = prev[prodId] || 0;
      const nuevo = Math.max(0, actual + delta);
      if (nuevo === 0) { const { [prodId]: _, ...rest } = prev; return rest; }
      return { ...prev, [prodId]: nuevo };
    });
  };

  const totalCarrito = Object.entries(carrito).reduce((sum, [id, cant]) => {
    const prod = productos.find(p => p.id === parseInt(id));
    return sum + (prod?.precioVenta || 0) * cant;
  }, 0);

  const itemsCarrito = Object.values(carrito).reduce((s, c) => s + c, 0);

  // ── Enviar pedido ───────────────────────────────────────
  const enviarPedido = async () => {
    if (itemsCarrito === 0) return;
    setEnviando(true);
    try {
      const items = Object.entries(carrito).map(([id, cant]) => {
        const prod = productos.find(p => p.id === parseInt(id));
        return { productoId: parseInt(id), nombre: prod?.nombre, precio: prod?.precioVenta, cantidad: cant, subtotal: (prod?.precioVenta || 0) * cant };
      });
      await addDoc(collection(db, 'mesa_pedidos'), {
        mesaId,
        cliente: clienteNombre || `Mesa ${mesaId}`,
        items,
        total: totalCarrito,
        estado: 'pendiente',
        tipo: 'pedido',
        createdAt: serverTimestamp(),
      });
      setCarrito({});
      setShowCarrito(false);
      setExito('pedido');
      setTimeout(() => setExito(null), 3000);
    } catch (e) { alert('Error al enviar: ' + e.message); }
    setEnviando(false);
  };

  // ── Solicitar asistencia ────────────────────────────────
  const solicitarAsistencia = async (tipo) => {
    setEnviando(true);
    try {
      await addDoc(collection(db, 'mesa_pedidos'), {
        mesaId,
        cliente: clienteNombre || `Mesa ${mesaId}`,
        tipo: 'asistencia',
        tipoAsistencia: tipo.id || tipo,
        etiqueta: tipo.label || tipo,
        icono: tipo.icon || '🔔',
        estado: 'pendiente',
        createdAt: serverTimestamp(),
      });
      setShowAsistConfirm(null);
      setExito('asistencia');
      setTimeout(() => setExito(null), 3000);
    } catch (e) { alert('Error: ' + e.message); }
    setEnviando(false);
  };

  // ── Solicitar la cuenta ─────────────────────────────────
  const solicitarCuenta = async () => {
    setEnviando(true);
    try {
      await addDoc(collection(db, 'mesa_pedidos'), {
        mesaId,
        cliente: clienteNombre || `Mesa ${mesaId}`,
        tipo: 'cuenta',
        etiqueta: 'Solicitud de Cuenta',
        icono: '💳',
        estado: 'pendiente',
        totalAcumulado,
        createdAt: serverTimestamp(),
      });
      setExito('cuenta');
      setTimeout(() => setExito(null), 4000);
    } catch (e) { alert('Error: ' + e.message); }
    setEnviando(false);
  };

  // ── Calcular total acumulado ─────────────────────────────
  const totalAcumulado = pedidosMesa
    .filter(p => p.tipo === 'pedido')
    .reduce((s, p) => s + (p.total || 0), 0);

  const pendientesEntrega = pedidosMesa.filter(p => p.tipo === 'pedido' && p.estado === 'pendiente').length;

  // ── TABS ────────────────────────────────────────────────
  const TABS = [
    { id: 'menu',       label: 'Menú',       icon: 'ri-restaurant-line' },
    { id: 'asistencia', label: 'Asistencia', icon: 'ri-customer-service-2-line' },
    { id: 'cuenta',     label: 'Mi Cuenta',  icon: 'ri-receipt-line',    badge: pendientesEntrega },
    { id: 'pagar',      label: 'Pagar',      icon: 'ri-secure-payment-line' },
  ];

  return (
    <>
      {/* LINK a Google Fonts Inter */}
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800;900&display=swap');`}</style>

      {/* HEADER */}
      <header className="mc-header">
        <div className="mc-header-logo">
          <div className="mc-header-logo-icon">🎱</div>
          <div>
            <div className="mc-header-title">YoY IA BILLAR <span style={{ fontSize: 9, color: 'var(--cl-bronze-light)', fontWeight: 800, display: 'block', marginTop: 1 }}>By Alfonso Iturbide</span></div>
            <div className="mc-header-sub">
              <span className="mc-live-dot" style={{ marginRight: 4 }} />
              {mesaInfo?.estado === 'ocupada' ? `${mesaInfo.cliente || 'Cliente'}` : 'Bienvenido'}
            </div>
          </div>
        </div>
        <div className="mc-mesa-badge">Mesa {mesaId}</div>
      </header>

      {/* TABS */}
      <nav className="mc-tabs">
        {TABS.map(t => (
          <button key={t.id} className={`mc-tab${tab === t.id ? ' active' : ''}`} onClick={() => setTab(t.id)}>
            <i className={t.icon} />
            {t.label}
            {t.badge > 0 && <span className="mc-tab-badge">{t.badge}</span>}
          </button>
        ))}
      </nav>

      {/* CUERPO */}
      <main className="mc-body">

        {/* ── ÉXITO TOAST ─────────────────────────────────── */}
        {exito && (
          <div style={{ background: exito === 'cuenta' ? 'rgba(59,130,246,0.1)' : 'rgba(34,197,94,0.1)', border: `1px solid ${exito === 'cuenta' ? 'rgba(59,130,246,0.4)' : 'rgba(34,197,94,0.4)'}`, borderRadius: 14, padding: 16, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 12, animation: 'slideUp 0.3s ease' }}>
            <span style={{ fontSize: 28 }}>{exito === 'pedido' ? '✅' : exito === 'asistencia' ? '🔔' : '💳'}</span>
            <div>
              <div style={{ fontSize: 14, fontWeight: 800 }}>
                {exito === 'pedido' ? '¡Pedido enviado!' : exito === 'asistencia' ? '¡Asistencia solicitada!' : '¡Cuenta solicitada!'}
              </div>
              <div style={{ fontSize: 12, color: 'var(--cl-muted)', marginTop: 2 }}>
                {exito === 'pedido' ? 'Tu mesero está en camino.' : exito === 'asistencia' ? 'El personal fue notificado.' : 'El mesero traerá tu cuenta.'}
              </div>
            </div>
          </div>
        )}

        {/* ════════════════════════ TAB: MENÚ ════════════════════════ */}
        {tab === 'menu' && (
          <>
            {/* Nombre del cliente */}
            <div style={{ background: 'var(--cl-card)', border: '1px solid var(--cl-border)', borderRadius: 14, padding: '12px 16px', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
              <i className="ri-user-line" style={{ color: 'var(--cl-bronze-light)', fontSize: 18 }} />
              {clienteNombre ? (
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 11, color: 'var(--cl-muted)' }}>Hola,</div>
                  <div style={{ fontSize: 14, fontWeight: 700 }}>{clienteNombre}</div>
                </div>
              ) : (
                <button onClick={() => setShowNombre(true)} style={{ flex: 1, background: 'none', border: 'none', color: 'var(--cl-muted)', fontSize: 13, textAlign: 'left', cursor: 'pointer' }}>
                  ¿Cómo te llamas? (opcional)
                </button>
              )}
            </div>

            {/* Grilla de productos */}
            <div className="mc-menu-grid">
              {productos.map(prod => {
                const emoji = CAT_EMOJI[prod.categoria] || CAT_EMOJI.default;
                const cant = carrito[prod.id] || 0;
                return (
                  <div key={prod.id} className={`mc-producto-card${prod.stock <= 0 ? ' agotado' : ''}`}>
                    <span className="mc-badge-cat">{prod.categoria}</span>
                    <div className="mc-producto-emoji">{emoji}</div>
                    <div className="mc-producto-nombre">{prod.nombre}</div>
                    <div className="mc-producto-precio">${prod.precioVenta}</div>
                    <div className="mc-producto-controls">
                      <button className="mc-qty-btn" onClick={() => modificarCarrito(prod.id, -1)}>−</button>
                      <span className="mc-qty-val">{cant}</span>
                      <button className="mc-qty-btn" onClick={() => modificarCarrito(prod.id, 1)}>+</button>
                    </div>
                  </div>
                );
              })}
            </div>

            {productos.length === 0 && (
              <div className="mc-empty">
                <i className="ri-restaurant-line" />
                <p>El menú se carga en un momento...</p>
              </div>
            )}
          </>
        )}

        {/* ════════════════════════ TAB: ASISTENCIA ════════════════════════ */}
        {tab === 'asistencia' && (
          <>
            <p style={{ fontSize: 13, color: 'var(--cl-muted)', marginBottom: 20, lineHeight: 1.6 }}>
              Toca el tipo de ayuda que necesitas. El personal será notificado de inmediato.
            </p>
            <div className="mc-asist-grid">
              {tiposAsistencia.map(tipo => (
                <button
                  key={tipo.id || tipo.label}
                  className="mc-asist-btn"
                  onClick={() => setShowAsistConfirm(tipo)}
                  style={{ borderColor: `${tipo.color}40` }}
                >
                  <div className="mc-asist-icon">{tipo.icon}</div>
                  <div className="mc-asist-label" style={{ color: tipo.color }}>{tipo.label}</div>
                </button>
              ))}
            </div>
          </>
        )}

        {/* ════════════════════════ TAB: MI CUENTA ════════════════════════ */}
        {tab === 'cuenta' && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
              <span className="mc-live-dot" />
              <span style={{ fontSize: 12, color: 'var(--cl-muted)' }}>Actualizando en tiempo real</span>
            </div>

            {pedidosMesa.filter(p => p.tipo === 'pedido').length === 0 ? (
              <div className="mc-empty">
                <i className="ri-receipt-line" />
                <p>Aún no tienes pedidos. ¡Ordena algo del menú!</p>
              </div>
            ) : (
              <>
                {pedidosMesa.filter(p => p.tipo === 'pedido').map(pedido => (
                  <div key={pedido.id} style={{ background: 'var(--cl-card)', border: '1px solid var(--cl-border)', borderRadius: 14, padding: '14px 16px', marginBottom: 10 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                      <span style={{ fontSize: 11, color: 'var(--cl-muted)' }}>
                        {pedido.createdAt?.toDate ? pedido.createdAt.toDate().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }) : '—'}
                      </span>
                      <span style={{
                        fontSize: 10, fontWeight: 800, padding: '2px 8px', borderRadius: 999,
                        background: pedido.estado === 'entregado' ? 'rgba(34,197,94,0.15)' : pedido.estado === 'en_camino' ? 'rgba(245,158,11,0.15)' : 'rgba(59,130,246,0.15)',
                        color: pedido.estado === 'entregado' ? '#22c55e' : pedido.estado === 'en_camino' ? '#f59e0b' : '#3b82f6',
                      }}>
                        {pedido.estado === 'entregado' ? '✅ Entregado' : pedido.estado === 'en_camino' ? '🚀 En camino' : '⏳ Pendiente'}
                      </span>
                    </div>
                    {pedido.items?.map((item, i) => (
                      <div key={i} className="mc-cuenta-item" style={{ paddingTop: i === 0 ? 0 : 8 }}>
                        <span style={{ fontSize: 13 }}>{item.cantidad}× {item.nombre}</span>
                        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--cl-bronze-light)' }}>${item.subtotal}</span>
                      </div>
                    ))}
                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--cl-border)' }}>
                      <span style={{ fontSize: 14, fontWeight: 800, color: 'var(--cl-bronze-light)' }}>Total: ${pedido.total}</span>
                    </div>
                  </div>
                ))}

                <div className="mc-total-box">
                  <div style={{ fontSize: 11, color: 'var(--cl-bronze-light)', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 700, marginBottom: 6 }}>Total Acumulado</div>
                  <div style={{ fontSize: 36, fontWeight: 900, color: 'var(--cl-bronze-light)', fontVariantNumeric: 'tabular-nums' }}>${totalAcumulado}</div>
                  <div style={{ fontSize: 11, color: 'var(--cl-muted)', marginTop: 4 }}>MXN · Mesa {mesaId}</div>
                </div>
              </>
            )}
          </>
        )}

        {/* ════════════════════════ TAB: PAGAR ════════════════════════ */}
        {tab === 'pagar' && (
          <>
            <div style={{ textAlign: 'center', padding: '32px 0 24px' }}>
              <div style={{ fontSize: 64, marginBottom: 16 }}>💳</div>
              <div style={{ fontSize: 20, fontWeight: 800, marginBottom: 8 }}>Solicitar la Cuenta</div>
              <div style={{ fontSize: 14, color: 'var(--cl-muted)', lineHeight: 1.6, marginBottom: 24 }}>
                El mesero traerá tu cuenta impresa. El pago se realiza en caja.
              </div>
              {totalAcumulado > 0 && (
                <div className="mc-total-box" style={{ marginBottom: 24 }}>
                  <div style={{ fontSize: 11, color: 'var(--cl-muted)', marginBottom: 4 }}>Total estimado</div>
                  <div style={{ fontSize: 32, fontWeight: 900, color: 'var(--cl-bronze-light)' }}>${totalAcumulado}</div>
                </div>
              )}
            </div>
            <button
              className="mc-btn-primary"
              onClick={solicitarCuenta}
              disabled={enviando}
            >
              {enviando ? <><i className="ri-loader-4-line" /> Enviando...</> : <><i className="ri-secure-payment-line" /> Solicitar mi Cuenta</>}
            </button>
            <button className="mc-btn-secondary" onClick={() => setTab('cuenta')}>
              Ver mi consumo detallado
            </button>
          </>
        )}
      </main>

      {/* ── FAB CARRITO ─────────────────────────────────── */}
      {itemsCarrito > 0 && tab === 'menu' && (
        <button className="mc-carrito-fab" onClick={() => setShowCarrito(true)}>
          <i className="ri-shopping-cart-2-line" />
          {itemsCarrito} {itemsCarrito === 1 ? 'ítem' : 'ítems'} · ${totalCarrito}
        </button>
      )}

      {/* ── SHEET: CONFIRMAR PEDIDO ─────────────────────── */}
      {showCarrito && (
        <div className="mc-overlay" onClick={e => e.target.classList.contains('mc-overlay') && setShowCarrito(false)}>
          <div className="mc-sheet">
            <div className="mc-sheet-handle" />
            <div style={{ fontWeight: 800, fontSize: 17, marginBottom: 20 }}>🛒 Tu pedido</div>
            {Object.entries(carrito).map(([id, cant]) => {
              const prod = productos.find(p => p.id === parseInt(id));
              if (!prod) return null;
              return (
                <div key={id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: 12, marginBottom: 12, borderBottom: '1px solid var(--cl-border)' }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 700 }}>{cant}× {prod.nombre}</div>
                    <div style={{ fontSize: 12, color: 'var(--cl-muted)' }}>${prod.precioVenta} c/u</div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <button className="mc-qty-btn" onClick={() => modificarCarrito(prod.id, -1)}>−</button>
                    <span className="mc-qty-val">{cant}</span>
                    <button className="mc-qty-btn" onClick={() => modificarCarrito(prod.id, 1)}>+</button>
                  </div>
                </div>
              );
            })}
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 0 20px', fontSize: 16, fontWeight: 800 }}>
              <span>Total</span>
              <span style={{ color: 'var(--cl-bronze-light)' }}>${totalCarrito}</span>
            </div>
            <button className="mc-btn-primary" onClick={enviarPedido} disabled={enviando}>
              {enviando ? <><i className="ri-loader-4-line" /> Enviando...</> : <><i className="ri-send-plane-line" /> Enviar Pedido</>}
            </button>
            <button className="mc-btn-secondary" onClick={() => setShowCarrito(false)}>Seguir ordenando</button>
          </div>
        </div>
      )}

      {/* ── SHEET: CONFIRMAR ASISTENCIA ─────────────────── */}
      {showAsistConfirm && (
        <div className="mc-overlay" onClick={e => e.target.classList.contains('mc-overlay') && setShowAsistConfirm(null)}>
          <div className="mc-sheet">
            <div className="mc-sheet-handle" />
            <div style={{ textAlign: 'center', padding: '8px 0 24px' }}>
              <div style={{ fontSize: 56, marginBottom: 12 }}>{showAsistConfirm.icon}</div>
              <div style={{ fontSize: 20, fontWeight: 800, marginBottom: 6 }}>{showAsistConfirm.label}</div>
              <div style={{ fontSize: 14, color: 'var(--cl-muted)' }}>El personal recibirá una notificación inmediata.</div>
            </div>
            <button className="mc-btn-primary" style={{ background: showAsistConfirm.color || 'var(--cl-bronze)' }} onClick={() => solicitarAsistencia(showAsistConfirm)} disabled={enviando}>
              {enviando ? 'Enviando...' : `Solicitar ${showAsistConfirm.label}`}
            </button>
            <button className="mc-btn-secondary" onClick={() => setShowAsistConfirm(null)}>Cancelar</button>
          </div>
        </div>
      )}

      {/* ── SHEET: INGRESAR NOMBRE ─────────────────────── */}
      {showNombre && (
        <div className="mc-overlay" onClick={e => e.target.classList.contains('mc-overlay') && setShowNombre(false)}>
          <div className="mc-sheet">
            <div className="mc-sheet-handle" />
            <div style={{ fontWeight: 800, fontSize: 17, marginBottom: 16 }}>👋 ¿Cómo te llamas?</div>
            <p style={{ fontSize: 13, color: 'var(--cl-muted)', marginBottom: 20 }}>Opcional — para personalizar tu servicio.</p>
            <input
              type="text"
              placeholder="Tu nombre..."
              value={clienteNombre}
              onChange={e => setClienteNombre(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && setShowNombre(false)}
              autoFocus
              style={{ width: '100%', padding: '14px 16px', background: 'var(--cl-surface)', border: '1px solid var(--cl-border-bronze)', borderRadius: 12, color: 'var(--cl-text)', fontSize: 16, marginBottom: 16, outline: 'none' }}
            />
            <button className="mc-btn-primary" onClick={() => setShowNombre(false)}>Listo ✓</button>
          </div>
        </div>
      )}
    </>
  );
}

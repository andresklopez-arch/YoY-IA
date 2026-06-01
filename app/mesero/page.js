'use client';
import { useState, useEffect } from 'react';
import {
  collection, onSnapshot, query, where,
  orderBy, updateDoc, doc, serverTimestamp, addDoc
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/lib/auth-context';
import { AuthProvider } from '@/lib/auth-context';

// ═══════════════════════════════════════════════════════════
// VISTA MESERO — Dashboard de pedidos y asistencias en tiempo real
// ═══════════════════════════════════════════════════════════
function MeseroContent() {
  const [pedidos, setPedidos] = useState([]);
  const [filtro, setFiltro] = useState('todos'); // todos | pedido | asistencia | cuenta
  const [sonido, setSonido] = useState(true);
  const [ultimoCount, setUltimoCount] = useState(0);
  const { user } = useAuth();

  // ── Tiempo transcurrido desde creación ──────────────────
  const tiempoTranscurrido = (fecha) => {
    if (!fecha?.toDate) return '—';
    const seg = Math.floor((Date.now() - fecha.toDate().getTime()) / 1000);
    if (seg < 60) return `${seg}s`;
    if (seg < 3600) return `${Math.floor(seg / 60)}min`;
    return `${Math.floor(seg / 3600)}h`;
  };

  // ── Suscripción en tiempo real ───────────────────────────
  useEffect(() => {
    const q = query(
      collection(db, 'mesa_pedidos'),
      where('estado', 'in', ['pendiente', 'en_camino']),
      orderBy('createdAt', 'desc')
    );
    const unsub = onSnapshot(q, snap => {
      const items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setPedidos(items);

      // Sonido de alerta en nuevos pedidos
      if (sonido && items.length > ultimoCount && ultimoCount > 0) {
        try {
          const ctx = new (window.AudioContext || window.webkitAudioContext)();
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.connect(gain); gain.connect(ctx.destination);
          osc.frequency.value = 880; gain.gain.value = 0.3;
          osc.start(); osc.stop(ctx.currentTime + 0.2);
          setTimeout(() => { osc.frequency.value = 1100; osc.start(ctx.currentTime + 0.25); osc.stop(ctx.currentTime + 0.45); }, 250);
        } catch { /* sin audio */ }
      }
      setUltimoCount(items.length);
    });
    return unsub;
  }, [sonido, ultimoCount]);

  // ── Acciones ─────────────────────────────────────────────
  const marcarEnCamino = async (id) => {
    await updateDoc(doc(db, 'mesa_pedidos', id), {
      estado: 'en_camino',
      meseroId: user?.uid || 'mesero',
      updatedAt: serverTimestamp(),
    });
  };

  const marcarEntregado = async (id) => {
    await updateDoc(doc(db, 'mesa_pedidos', id), {
      estado: 'entregado',
      entregadoAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  };

  // ── Filtrado ─────────────────────────────────────────────
  const pedidosFiltrados = pedidos.filter(p =>
    filtro === 'todos' || p.tipo === filtro
  );

  const counts = {
    todos:     pedidos.length,
    pedido:    pedidos.filter(p => p.tipo === 'pedido').length,
    asistencia:pedidos.filter(p => p.tipo === 'asistencia').length,
    cuenta:    pedidos.filter(p => p.tipo === 'cuenta').length,
  };

  // ── Color/ícono según tipo ────────────────────────────────
  const tipoConfig = {
    pedido:     { label: 'Pedido',     icon: '🍺', color: '#cd7f32', bg: 'rgba(205,127,50,0.08)' },
    asistencia: { label: 'Asistencia', icon: '🔔', color: '#3b82f6', bg: 'rgba(59,130,246,0.08)' },
    cuenta:     { label: 'Cuenta',     icon: '💳', color: '#22c55e', bg: 'rgba(34,197,94,0.08)' },
  };

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-primary)', padding: '0 0 40px' }}>

      {/* ── HEADER ─────────────────────────────────── */}
      <div style={{ background: 'var(--bg-card)', borderBottom: '1px solid var(--border-bronze)', padding: '16px 20px', position: 'sticky', top: 0, zIndex: 10 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', maxWidth: 900, margin: '0 auto' }}>
          <div>
            <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--bronze-light)', lineHeight: 1 }}>
              🎱 Vista Mesero
            </h1>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
              {pedidos.length > 0
                ? <><span style={{ color: 'var(--danger)', fontWeight: 700 }}>{pedidos.length} pendiente(s)</span> · Activo</>
                : <><span style={{ color: 'var(--success)' }}>✓</span> Sin pedidos pendientes</>
              }
            </p>
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            {/* Toggle sonido */}
            <button
              onClick={() => setSonido(!sonido)}
              title={sonido ? 'Silenciar alertas' : 'Activar alertas de sonido'}
              style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 10, padding: '8px 12px', cursor: 'pointer', color: sonido ? 'var(--bronze-light)' : 'var(--text-muted)', fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}
            >
              <i className={sonido ? 'ri-volume-up-line' : 'ri-volume-mute-line'} />
              {sonido ? 'Sonido ON' : 'Silencio'}
            </button>
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 900, margin: '0 auto', padding: '20px 16px' }}>

        {/* ── STATS ───────────────────────────────────── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 24 }}>
          {[
            { key: 'todos',      label: 'Total',      icon: 'ri-list-check-2',            color: 'var(--text-primary)' },
            { key: 'pedido',     label: 'Pedidos',    icon: 'ri-restaurant-line',          color: 'var(--bronze-light)' },
            { key: 'asistencia', label: 'Asistencia', icon: 'ri-customer-service-2-line',  color: 'var(--info)' },
            { key: 'cuenta',     label: 'Cuentas',    icon: 'ri-secure-payment-line',      color: 'var(--success)' },
          ].map(s => (
            <div key={s.key} className="stat-card" style={{ cursor: 'pointer', border: filtro === s.key ? '1px solid var(--border-bronze)' : '1px solid var(--border)' }} onClick={() => setFiltro(s.key)}>
              <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 4 }}>{s.label}</div>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 800, color: s.color }}>{counts[s.key]}</div>
            </div>
          ))}
        </div>

        {/* ── LISTA DE PEDIDOS ─────────────────────────── */}
        {pedidosFiltrados.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--text-muted)' }}>
            <i className="ri-checkbox-circle-line" style={{ fontSize: 56, display: 'block', marginBottom: 16, color: 'var(--success)' }} />
            <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>¡Todo al día!</div>
            <div style={{ fontSize: 14 }}>No hay pedidos pendientes en este momento.</div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {pedidosFiltrados.map(pedido => {
              const cfg = tipoConfig[pedido.tipo] || tipoConfig.pedido;
              const urgente = pedido.createdAt?.toDate && (Date.now() - pedido.createdAt.toDate().getTime()) > 5 * 60 * 1000;

              return (
                <div key={pedido.id} style={{
                  background: cfg.bg,
                  border: `1px solid ${cfg.color}30`,
                  borderLeft: `4px solid ${cfg.color}`,
                  borderRadius: 16,
                  padding: 18,
                  animation: 'slideUp 0.25s ease',
                  boxShadow: urgente ? `0 0 20px ${cfg.color}20` : 'none',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <div style={{ fontSize: 28 }}>{pedido.icono || cfg.icon}</div>
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 800, color: cfg.color }}>
                            Mesa {pedido.mesaId}
                          </span>
                          {urgente && <span style={{ fontSize: 9, background: 'var(--danger)', color: '#fff', padding: '2px 6px', borderRadius: 999, fontWeight: 800 }}>URGENTE</span>}
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                          {pedido.cliente} · {tiempoTranscurrido(pedido.createdAt)} · {cfg.label}
                        </div>
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      {pedido.tipo === 'pedido' && (
                        <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--bronze-light)' }}>${pedido.total}</div>
                      )}
                      <div style={{
                        fontSize: 10, fontWeight: 800, marginTop: 4, padding: '3px 8px', borderRadius: 999,
                        background: pedido.estado === 'en_camino' ? 'rgba(245,158,11,0.15)' : 'rgba(59,130,246,0.15)',
                        color: pedido.estado === 'en_camino' ? 'var(--warning)' : 'var(--info)',
                      }}>
                        {pedido.estado === 'en_camino' ? '🚀 En camino' : '⏳ Pendiente'}
                      </div>
                    </div>
                  </div>

                  {/* Items del pedido */}
                  {pedido.tipo === 'pedido' && pedido.items && (
                    <div style={{ background: 'rgba(0,0,0,0.2)', borderRadius: 10, padding: '10px 12px', marginBottom: 14 }}>
                      {pedido.items.map((item, i) => (
                        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '3px 0', borderBottom: i < pedido.items.length - 1 ? '1px solid rgba(255,255,255,0.05)' : 'none' }}>
                          <span>{item.cantidad}× {item.nombre}</span>
                          <span style={{ color: 'var(--bronze-light)', fontWeight: 600 }}>${item.subtotal}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Asistencia tipo */}
                  {pedido.tipo === 'asistencia' && (
                    <div style={{ background: 'rgba(0,0,0,0.2)', borderRadius: 10, padding: '10px 14px', marginBottom: 14, fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>
                      {pedido.etiqueta}
                    </div>
                  )}

                  {/* Cuenta solicitada */}
                  {pedido.tipo === 'cuenta' && (
                    <div style={{ background: 'rgba(0,0,0,0.2)', borderRadius: 10, padding: '10px 14px', marginBottom: 14 }}>
                      <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Total a cobrar:</div>
                      <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--success)' }}>${pedido.totalAcumulado || '—'}</div>
                    </div>
                  )}

                  {/* Acciones */}
                  <div style={{ display: 'flex', gap: 8 }}>
                    {pedido.estado === 'pendiente' && (
                      <button
                        onClick={() => marcarEnCamino(pedido.id)}
                        style={{ flex: 1, padding: '10px 14px', background: `${cfg.color}15`, border: `1px solid ${cfg.color}40`, borderRadius: 10, color: cfg.color, fontWeight: 700, fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
                      >
                        <i className="ri-run-line" /> En camino
                      </button>
                    )}
                    <button
                      onClick={() => marcarEntregado(pedido.id)}
                      style={{ flex: 1, padding: '10px 14px', background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.3)', borderRadius: 10, color: 'var(--success)', fontWeight: 700, fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
                    >
                      <i className="ri-check-double-line" /> Completado ✓
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export default function MeseroPage() {
  return (
    <AuthProvider>
      <MeseroContent />
    </AuthProvider>
  );
}

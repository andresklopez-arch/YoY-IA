'use client';
import { useState, useEffect } from 'react';
import { db } from '@/lib/firebase';
import { doc, onSnapshot, query, collection, orderBy, limit, getDocs, startAfter, writeBatch } from 'firebase/firestore';
import { deobfuscate, obfuscate } from '@/lib/crypto';
import { useAuth } from '@/lib/auth-context';

const TRANSACCIONES = [];

const METODO_ICONS = {
  efectivo: 'ri-money-dollar-circle-line',
  spei:     'ri-qr-code-line',
  tarjeta:  'ri-bank-card-line',
};

const hashPassword = (pwd) => {
  if (!pwd) return '';
  let hash = 0;
  for (let i = 0; i < pwd.length; i++) {
    hash = (hash << 5) - hash + pwd.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(16);
};

export default function CajaPanel({ showToast }) {
  const { user } = useAuth();
  const [cobros, setCobros] = useState([]);
  const [mostrarCorte, setMostrarCorte] = useState(false);
  const [cantidades, setCantidades] = useState({
    1000: '', 500: '', 200: '', 100: '', 50: '', 20: '', 10: '', 5: '', 2: '', 1: '', 0.5: ''
  });

  // Estados de Bitácora con cursor de paginación (startAfter)
  const [bitacora, setBitacora] = useState([]);
  const [mostrarBitacora, setMostrarBitacora] = useState(false);
  const [limiteBitacora, setLimiteBitacora] = useState(50);
  const [hasMoreBitacora, setHasMoreBitacora] = useState(true);
  const [lastBitacoraDoc, setLastBitacoraDoc] = useState(null);
  const [loadingMoreBitacora, setLoadingMoreBitacora] = useState(false);

  // Cola de impresión térmica
  const [colaImpresion, setColaImpresion] = useState([]);

  // Pestaña activa para la sección inferior de movimientos
  const [tabActivo, setTabActivo] = useState('caja'); // 'caja' | 'inventario'

  // Estados para Auditoría y Movimientos de Inventario relocalizados
  const [inventarioLogs, setInventarioLogs] = useState([]);
  const [inventarioDbLogs, setInventarioDbLogs] = useState([]);
  const [lastInventarioDoc, setLastInventarioDoc] = useState(null);
  const [inventarioHasMoreLogs, setInventarioHasMoreLogs] = useState(true);
  const [loadingMoreInventario, setLoadingMoreInventario] = useState(false);



  // Sincronizar transacciones y bitácora en tiempo real entre pestañas
  useEffect(() => {
    const handleStorage = (e) => {
      if (e.key === 'yoy_caja_cobros' && e.newValue) {
        try {
          setCobros(JSON.parse(e.newValue));
        } catch (err) {
          console.error("Error al sincronizar cobros:", err);
        }
      }
      if (e.key === 'yoy_billar_bitacora' && e.newValue) {
        try {
          setBitacora(deobfuscate(e.newValue) || []);
        } catch (err) {
          console.error("Error al sincronizar bitácora:", err);
        }
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  // Cerrar ventanas emergentes al presionar la tecla Escape con control de cooldown, desenfoque y confirmación
  useEffect(() => {
    let lastBlurTime = 0;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        const now = Date.now();
        if (document.activeElement && 
            (document.activeElement.tagName === 'INPUT' || 
             document.activeElement.tagName === 'SELECT' || 
             document.activeElement.tagName === 'TEXTAREA')) {
          const activeEl = document.activeElement;
          activeEl.blur();
          
          // Efecto visual: resplandor dorado momentáneo
          const originalTransition = activeEl.style.transition;
          const originalBoxShadow = activeEl.style.boxShadow;
          activeEl.style.transition = 'box-shadow 0.2s ease';
          activeEl.style.boxShadow = '0 0 10px var(--bronze-light, #c5a880)';
          setTimeout(() => {
            activeEl.style.boxShadow = originalBoxShadow;
            setTimeout(() => {
              activeEl.style.transition = originalTransition;
            }, 200);
          }, 300);
          
          lastBlurTime = now;
          return;
        }

        if (now - lastBlurTime < 300) {
          return;
        }

        if (mostrarCorte) {
          const hasInputs = Object.values(cantidades).some(v => v !== '');
          if (hasInputs) {
            if (!window.confirm('¿Deseas salir del corte de caja? Perderás las cantidades ingresadas.')) {
              return;
            }
          }
          setMostrarCorte(false);
          return;
        }

        if (mostrarBitacora) {
          setMostrarBitacora(false);
          return;
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [mostrarCorte, cantidades, mostrarBitacora]);

  // Cargar borrador de corte de caja en mount y cobros desde LocalStorage
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const draft = localStorage.getItem('yoy_caja_corte_draft');
      if (draft) {
        try {
          setCantidades(JSON.parse(draft));
        } catch (e) {
          console.error(e);
        }
      }

      try {
        const saved = localStorage.getItem('yoy_caja_cobros');
        if (saved) {
          setCobros(JSON.parse(saved));
        } else {
          setCobros(TRANSACCIONES);
          localStorage.setItem('yoy_caja_cobros', JSON.stringify(TRANSACCIONES));
        }
      } catch (err) {
        console.error(err);
        setCobros(TRANSACCIONES);
      }
    }
  }, []);

  // Sincronizar cobros en localStorage al cambiar
  useEffect(() => {
    if (typeof window !== 'undefined' && cobros.length > 0) {
      localStorage.setItem('yoy_caja_cobros', JSON.stringify(cobros));
    }
  }, [cobros]);

  // Escuchar bitácora de Firestore: primera página con onSnapshot (50 docs)
  useEffect(() => {
    const q = query(collection(db, 'bitacora'), orderBy('fecha', 'desc'), limit(50));
    const unsub = onSnapshot(q, snap => {
      const items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setBitacora(items);
      setLastBitacoraDoc(snap.docs[snap.docs.length - 1] || null);
      setHasMoreBitacora(snap.docs.length === 50);
      try {
        localStorage.setItem('yoy_billar_bitacora', obfuscate(items));
      } catch (err) {
        console.error(err);
      }
    }, err => {
      console.error("Error al escuchar bitácora en CajaPanel:", err);
      try {
        const saved = localStorage.getItem('yoy_billar_bitacora');
        if (saved) setBitacora(deobfuscate(saved) || []);
      } catch (e) {
        console.error(e);
      }
    });
    return unsub;
  }, []);

  // Cargar logs locales de inventario
  useEffect(() => {
    if (typeof window !== 'undefined') {
      try {
        const savedLogs = localStorage.getItem('yoy_billar_stock_logs');
        if (savedLogs) {
          setInventarioLogs(deobfuscate(savedLogs) || []);
        }
      } catch (err) {
        console.error(err);
      }
    }
  }, []);

  // Escuchar historial_stock en Firestore para movimientos de inventario (Primera página en vivo)
  useEffect(() => {
    const q = query(
      collection(db, 'historial_stock'),
      orderBy('fecha', 'desc'),
      limit(50)
    );
    const unsub = onSnapshot(q, snap => {
      const items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setInventarioDbLogs(items);
      setLastInventarioDoc(snap.docs[snap.docs.length - 1] || null);
      setInventarioHasMoreLogs(snap.docs.length === 50);
    }, err => {
      console.error("Error al escuchar historial de stock en tiempo real en Caja:", err);
    });
    return unsub;
  }, []);

  const cargarMasInventarioLogs = async () => {
    if (!lastInventarioDoc || loadingMoreInventario) return;
    setLoadingMoreInventario(true);
    try {
      const q = query(
        collection(db, 'historial_stock'),
        orderBy('fecha', 'desc'),
        startAfter(lastInventarioDoc),
        limit(50)
      );
      const snap = await getDocs(q);
      if (!snap.empty) {
        const newItems = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        setInventarioDbLogs(prev => {
          const ids = new Set(prev.map(item => item.id));
          const filteredNew = newItems.filter(item => !ids.has(item.id));
          return [...prev, ...filteredNew];
        });
        setLastInventarioDoc(snap.docs[snap.docs.length - 1] || null);
        setInventarioHasMoreLogs(snap.docs.length === 50);
      } else {
        setInventarioHasMoreLogs(false);
      }
    } catch (err) {
      console.error("Error al cargar más historial de stock:", err);
      showToast("Error al cargar más registros de inventario", "danger");
    } finally {
      setLoadingMoreInventario(false);
    }
  };

  const todosLosInventarioLogs = [
    ...inventarioLogs.map(l => ({
      id: `local-${l.id}`,
      fecha: l.fecha,
      producto: l.producto,
      tipo: l.tipo,
      cantidad: l.cantidad,
      detalle: l.detalle,
      operador: l.operador || 'Sistema',
      monto: 0
    })),
    ...inventarioDbLogs.map(l => {
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

  const limpiarBitacora = async () => {
    setBitacora([]);
    try {
      localStorage.removeItem('yoy_billar_bitacora');
      const q = query(collection(db, 'bitacora'), limit(100));
      const snap = await getDocs(q);
      if (!snap.empty) {
        const batch = writeBatch(db);
        snap.docs.forEach(d => batch.delete(d.ref));
        await batch.commit();
      }
    } catch (err) {
      console.error("Error al limpiar bitácora en la nube:", err);
    }
    showToast('Bitácora limpiada correctamente.', 'info');
  };

  const handleCantidadChange = (den, val) => {
    const updated = { ...cantidades, [den]: val };
    setCantidades(updated);
    localStorage.setItem('yoy_caja_corte_draft', JSON.stringify(updated));
  };

  const totalHoy = cobros.filter(t => t.monto > 0).reduce((s, t) => s + t.monto, 0);
  const totalGastos = Math.abs(cobros.filter(t => t.monto < 0).reduce((s, t) => s + t.monto, 0));
  const utilidad = totalHoy - totalGastos;

  const totalEfectivoEsperado = cobros.filter(t => t.metodo === 'efectivo').reduce((s, t) => s + t.monto, 0);
  const sumaContada = Object.keys(cantidades).reduce((acc, val) => {
    const qty = parseInt(cantidades[val]) || 0;
    return acc + (parseFloat(val) * qty);
  }, 0);
  const diferencia = sumaContada - totalEfectivoEsperado;

  const cortesiasHoy = bitacora.filter(b => {
    const esHoy = b.fecha && (new Date(b.fecha).toDateString() === new Date().toDateString());
    if (!esHoy) return false;
    const esCierre = b.accion === 'Cierre Directo' || b.accion === 'Liquidar Cuenta' || b.accion === 'Cobro Manual';
    const esMontoCero = b.monto === 0 || (b.detalle && (b.detalle.includes('Socio sin cargo') || b.detalle.includes('$0 MXN') || b.detalle.includes('cerrada (Socio sin cargo')));
    return esCierre && esMontoCero;
  });




  const guardarCorteCaja = () => {
    const nombreOperador = user ? (user.name || user.alias || user.email) : 'Administrador';
    setCobros(prev => [{
      id: Date.now(),
      tipo: 'corte',
      descripcion: `Corte de Caja (Contado: $${sumaContada.toLocaleString()} - Esperado: $${totalEfectivoEsperado.toLocaleString()})`,
      cliente: nombreOperador,
      monto: diferencia,
      metodo: 'efectivo',
      hora: new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }),
      color: diferencia >= 0 ? 'var(--success)' : 'var(--danger)',
    }, ...prev]);

    showToast(`Corte registrado. Diferencia: $${diferencia.toLocaleString()}`, diferencia >= 0 ? 'success' : 'danger');
    triggerSimulatedPrint('caja', `Reporte de Corte de Caja - Diferencia: $${diferencia}`);
    setMostrarCorte(false);
    localStorage.removeItem('yoy_caja_corte_draft');
    setCantidades({
      1000: '', 500: '', 200: '', 100: '', 50: '', 20: '', 10: '', 5: '', 2: '', 1: '', 0.5: ''
    });
  };


  const triggerSimulatedPrint = (tipo, detalle) => {
    const nuevoPrint = {
      id: Date.now(),
      hora: new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }),
      tipo,
      detalle,
      estado: 'Enviando...'
    };
    setColaImpresion(prev => [nuevoPrint, ...prev]);

    setTimeout(() => {
      setColaImpresion(prev => prev.map(p => p.id === nuevoPrint.id ? { ...p, estado: 'Impreso ✓' } : p));
      showToast(`Ticket impreso correctamente en impresora ${tipo.toUpperCase()}`, 'success');
    }, 1200);
  };

  return (
    <div>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 className="page-title gradient-bronze">Caja y POS</h1>
          <p className="page-subtitle">Corte del día · Turno actual · Modo Estándar</p>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <button className="btn btn-secondary btn-sm" onClick={() => setMostrarBitacora(true)}>
            <i className="ri-history-line" /> Bitácora
          </button>
          <button className="btn btn-secondary btn-sm" onClick={() => setMostrarCorte(true)}>
            <i className="ri-file-list-3-line" /> Corte de Caja
          </button>
        </div>
      </div>

      {/* Resumen financiero */}
      <div className="stat-grid" style={{ marginBottom: 24 }}>
        {[
          { label: 'Ingresos Hoy', value: `$${totalHoy.toLocaleString()}`, icon: 'ri-arrow-up-circle-line', color: 'icon-success', accent: 'var(--success)' },
          { label: 'Gastos Hoy', value: `$${totalGastos.toLocaleString()}`, icon: 'ri-arrow-down-circle-line', color: 'icon-danger', accent: 'var(--danger)' },
          { label: 'Utilidad', value: `$${utilidad.toLocaleString()}`, icon: 'ri-funds-line', color: 'icon-blue', accent: utilidad > 0 ? 'var(--success)' : 'var(--danger)' },
          { label: 'Transacciones', value: cobros.length, icon: 'ri-receipt-line', color: 'icon-bronze', accent: 'var(--bronze-light)' },
        ].map((s, i) => (
          <div key={i} className="stat-card">
            <div className={`stat-card-icon ${s.color}`}><i className={s.icon} /></div>
            <div className="stat-card-value" style={{ fontSize: 24, color: s.accent }}>{s.value}</div>
            <div className="stat-card-label">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Métodos de pago breakdown */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 24 }}>
        {[
          { label: 'Efectivo', icon: 'ri-money-dollar-circle-line', metodo: 'efectivo', color: 'var(--success)' },
          { label: 'SPEI / QR', icon: 'ri-qr-code-line', metodo: 'spei', color: 'var(--blue-light)' },
          { label: 'Tarjeta', icon: 'ri-bank-card-line', metodo: 'tarjeta', color: 'var(--bronze-light)' },
        ].map(m => {
          const subtotal = cobros.filter(t => m.metodo === 'efectivo' ? (t.metodo === m.metodo && t.tipo !== 'corte') : (t.metodo === m.metodo)).reduce((s, t) => s + t.monto, 0);
          return (
            <div key={m.metodo} className="card" style={{ padding: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <i className={m.icon} style={{ fontSize: 18, color: m.color }} />
                <span style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-muted)', fontWeight: 600 }}>{m.label}</span>
              </div>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 700, color: m.color }}>${subtotal.toLocaleString()}</div>
            </div>
          );
        })}
      </div>

          {/* Cola de Impresión Térmica */}
          <div className="card" style={{ marginBottom: 24 }}>
            <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <div>
                <h3 className="card-title"><i className="ri-printer-line" style={{ marginRight: 6 }} />Historial de Colas de Impresión (Red/USB)</h3>
                <p style={{ fontSize: 10, color: 'var(--text-muted)', margin: 0 }}>Simulador de envío de tickets directos a comandas de cocina y barra</p>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button className="btn btn-secondary btn-xs" onClick={() => triggerSimulatedPrint('caja', 'Ticket de Prueba - Impresora Caja')}>Test Caja</button>
                <button className="btn btn-secondary btn-xs" onClick={() => triggerSimulatedPrint('cocina', 'Comanda de Prueba - Impresora Cocina')}>Test Cocina</button>
                <button className="btn btn-secondary btn-xs" onClick={() => triggerSimulatedPrint('barra', 'Comanda de Prueba - Impresora Barra')}>Test Barra</button>
              </div>
            </div>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 150, overflowY: 'auto' }}>
              {colaImpresion.map(p => (
                <div key={p.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', background: 'rgba(255,255,255,0.01)', border: '1px solid var(--border)', borderRadius: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ width: 26, height: 26, borderRadius: 6, background: 'var(--bg-elevated)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, color: 'var(--bronze-light)' }}>
                      <i className="ri-printer-line" />
                    </div>
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 700 }}>{p.detalle}</div>
                      <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>Tipo: {p.tipo.toUpperCase()} · {p.hora}</span>
                    </div>
                  </div>
                  <span className={`badge ${p.estado.includes('Impreso') ? 'badge-success' : 'badge-warning'}`} style={{ fontSize: 9 }}>
                    {p.estado}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Panel de Movimientos y Auditorías Tabuladas */}
          <div className="card">
            <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border)', paddingBottom: 10, marginBottom: 14 }}>
              <div style={{ display: 'flex', gap: 12 }}>
                <button
                  onClick={() => setTabActivo('caja')}
                  style={{
                    background: 'none',
                    border: 'none',
                    fontSize: 13,
                    fontWeight: 700,
                    color: tabActivo === 'caja' ? 'var(--bronze-light)' : 'var(--text-muted)',
                    borderBottom: tabActivo === 'caja' ? '2px solid var(--bronze-light)' : 'none',
                    paddingBottom: 4,
                    cursor: 'pointer',
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em'
                  }}
                >
                  <i className="ri-receipt-line" style={{ marginRight: 6 }} />
                  Transacciones de Caja
                </button>
                <button
                  onClick={() => setTabActivo('inventario')}
                  style={{
                    background: 'none',
                    border: 'none',
                    fontSize: 13,
                    fontWeight: 700,
                    color: tabActivo === 'inventario' ? 'var(--bronze-light)' : 'var(--text-muted)',
                    borderBottom: tabActivo === 'inventario' ? '2px solid var(--bronze-light)' : 'none',
                    paddingBottom: 4,
                    cursor: 'pointer',
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em'
                  }}
                >
                  <i className="ri-history-line" style={{ marginRight: 6 }} />
                  Movimientos de Inventario
                </button>
              </div>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => {
                  if (tabActivo === 'caja') {
                    showToast('Exportando transacciones...', 'info');
                  } else {
                    showToast('Exportando bitácora de inventario...', 'info');
                  }
                }}
              >
                <i className="ri-download-line" /> Exportar
              </button>
            </div>

            {tabActivo === 'caja' ? (
              <div className="table-wrapper" style={{ border: 'none' }}>
                <table>
                  <thead>
                    <tr>
                      <th>Hora</th>
                      <th>Descripción</th>
                      <th>Cliente / Destino</th>
                      <th>Método</th>
                      <th style={{ textAlign: 'right' }}>Monto</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cobros.map(t => (
                      <tr key={t.id} style={{ background: t.tipo === 'corte' ? 'rgba(205,127,50,0.05)' : 'none' }}>
                        <td style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-display)', fontSize: 12 }}>{t.hora}</td>
                        <td style={{ fontWeight: 600 }}>
                          {t.tipo === 'corte' ? '📋 ' : ''}{t.descripcion}
                        </td>
                        <td style={{ color: 'var(--text-secondary)' }}>{t.cliente}</td>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <i className={METODO_ICONS[t.metodo] || 'ri-cash-line'} style={{ fontSize: 14, color: 'var(--text-muted)' }} />
                            <span style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'capitalize' }}>{t.metodo}</span>
                          </div>
                        </td>
                        <td style={{ textAlign: 'right', fontFamily: 'var(--font-display)', fontSize: 15, fontWeight: 700, color: t.color }}>
                          {t.monto > 0 ? '+' : ''}${t.monto.toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxHeight: 300, overflowY: 'auto' }}>
                {todosLosInventarioLogs.length === 0 ? (
                  <p style={{ color: 'var(--text-muted)', fontSize: 12, textAlign: 'center', padding: '20px 0' }}>No hay registros de auditoría de stock.</p>
                ) : (
                  todosLosInventarioLogs.map(l => {
                    const isEntrada = l.tipo === 'entrada';
                    const isMerma = l.tipo === 'merma';
                    const isVentaQr = l.tipo === 'venta_qr';
                    const isCierre = l.tipo === 'cierre';
                    const isAjustePrecio = l.tipo === 'ajuste_precio';
                    return (
                      <div key={l.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 10, fontSize: 12 }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span className={`badge ${isEntrada ? 'badge-success' : isMerma ? 'badge-danger' : isVentaQr ? 'badge-info' : isCierre ? 'badge-success' : 'badge-bronze'}`} style={{ fontSize: 8, padding: '1px 4px' }}>
                              {l.tipo.toUpperCase()}
                            </span>
                            <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{new Date(l.fecha).toLocaleString()}</span>
                          </div>
                          <span style={{ fontWeight: 700 }}>{l.producto}</span>
                          <span style={{ color: 'var(--text-secondary)', fontSize: 11 }}>{l.detalle}</span>
                        </div>
                        {!isAjustePrecio && (
                          <div style={{ fontSize: 14, fontWeight: 800, color: isEntrada ? 'var(--success)' : isCierre ? 'var(--success)' : isVentaQr ? 'var(--info)' : 'var(--danger)' }}>
                            {isEntrada ? '+' : isCierre ? '+$' : '-'}{isCierre ? l.monto : l.cantidad}
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
                {inventarioHasMoreLogs && (
                  <button 
                    onClick={cargarMasInventarioLogs}
                    disabled={loadingMoreInventario}
                    className="btn btn-secondary btn-sm" 
                    style={{ 
                      marginTop: 12, 
                      width: '100%', 
                      display: 'flex', 
                      alignItems: 'center', 
                      justifyContent: 'center', 
                      gap: 6,
                      color: 'var(--bronze-light)',
                      borderColor: 'var(--border-bronze)',
                      background: 'var(--bg-elevated)',
                      opacity: loadingMoreInventario ? 0.7 : 1,
                      cursor: loadingMoreInventario ? 'not-allowed' : 'pointer'
                    }}
                  >
                    {loadingMoreInventario ? (
                      <>⧗ Cargando...</>
                    ) : (
                      <>
                        <i className="ri-arrow-down-double-line" />
                        Cargar más registros de inventario
                      </>
                    )}
                  </button>
                )}
              </div>
            )}
          </div>


      {/* Modal Corte de Caja por Denominaciones */}
      {mostrarCorte && (
        <div className="modal-overlay" onClick={() => setMostrarCorte(false)}>
          <div className="modal" style={{ maxWidth: 500 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">📋 Corte de Caja interactivo</span>
              <button onClick={() => setMostrarCorte(false)} style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 20 }}>✕</button>
            </div>
            <div className="modal-body" style={{ maxHeight: '70vh', overflowY: 'auto' }}>
              {/* Alerta de Cuentas Sospechosas o Cortesías en $0 MXN de Hoy */}
              {cortesiasHoy.length > 0 && (
                <div style={{
                  background: 'rgba(239, 68, 68, 0.1)',
                  border: '1px solid rgba(239, 68, 68, 0.3)',
                  borderRadius: 12,
                  padding: 14,
                  marginBottom: 20,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#ef4444', fontWeight: 800, fontSize: 13 }}>
                    <i className="ri-error-warning-line" style={{ fontSize: 16 }} />
                    <span>⚠️ AUDITORÍA: Cortesías / Cierres $0 MXN hoy</span>
                  </div>
                  <p style={{ fontSize: 11, color: 'var(--text-secondary)', margin: 0, lineHeight: 1.4 }}>
                    Se detectaron {cortesiasHoy.length} mesas o cuentas cerradas sin cargo o cortesías hoy. Por favor, verifícalas antes de proceder:
                  </p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4, maxHeight: 120, overflowY: 'auto', paddingRight: 4 }}>
                    {cortesiasHoy.map(b => {
                      const esMesero = b.rolOperador && b.rolOperador !== 'admin';
                      return (
                        <div key={b.id} style={{
                          background: esMesero ? 'rgba(249,115,22,0.1)' : 'rgba(0,0,0,0.2)',
                          border: esMesero ? '1px solid rgba(249,115,22,0.35)' : '1px solid rgba(255,255,255,0.05)',
                          borderRadius: 8, padding: '8px 10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10
                        }}>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <span style={{ fontSize: 10, fontWeight: 700, color: '#fff' }}>{b.detalle}</span>
                              {esMesero && (
                                <span style={{ fontSize: 8, background: 'rgba(249,115,22,0.2)', color: '#f97316', padding: '1px 5px', borderRadius: 4, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap' }}>
                                  ⚠ {b.rolOperador || 'staff'}
                                </span>
                              )}
                            </div>
                            <span style={{ fontSize: 9, color: esMesero ? '#f97316' : 'var(--text-muted)' }}>
                              Operador: {b.operador}
                            </span>
                          </div>
                          <span style={{ fontSize: 9, color: 'var(--text-muted)', fontFamily: 'var(--font-display)', whiteSpace: 'nowrap' }}>
                            {new Date(b.fecha).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
                {/* Billetes */}
                <div>
                  <h4 style={{ fontSize: 13, color: 'var(--bronze-light)', marginBottom: 10, textTransform: 'uppercase', fontWeight: 800 }}>Billetes</h4>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {[1000, 500, 200, 100, 50, 20].map(den => (
                      <div key={den} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'rgba(255,255,255,0.02)', padding: '6px 12px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.04)' }}>
                        <span style={{ fontSize: 13, fontWeight: 700 }}>${den}</span>
                        <input
                          type="number"
                          className="form-input"
                          style={{ width: 80, padding: '4px 8px', fontSize: 12, textAlign: 'right' }}
                          placeholder="0"
                          value={cantidades[den]}
                          onChange={e => handleCantidadChange(den, e.target.value)}
                        />
                      </div>
                    ))}
                  </div>
                </div>

                {/* Monedas */}
                <div>
                  <h4 style={{ fontSize: 13, color: 'var(--bronze-light)', marginBottom: 10, textTransform: 'uppercase', fontWeight: 800 }}>Monedas</h4>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {[10, 5, 2, 1, 0.5].map(den => (
                      <div key={den} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'rgba(255,255,255,0.02)', padding: '6px 12px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.04)' }}>
                        <span style={{ fontSize: 13, fontWeight: 700 }}>${den.toFixed(2)}</span>
                        <input
                          type="number"
                          className="form-input"
                          style={{ width: 80, padding: '4px 8px', fontSize: 12, textAlign: 'right' }}
                          placeholder="0"
                          value={cantidades[den]}
                          onChange={e => handleCantidadChange(den, e.target.value)}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 12, padding: 14, marginTop: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: 13 }}>
                  <span style={{ color: 'var(--text-secondary)' }}>Efectivo Esperado:</span>
                  <strong style={{ color: '#fff' }}>${totalEfectivoEsperado.toLocaleString()}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: 13 }}>
                  <span style={{ color: 'var(--text-secondary)' }}>Efectivo Real Contado:</span>
                  <strong style={{ color: 'var(--bronze-light)' }}>${sumaContada.toLocaleString()}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: 6, fontSize: 14 }}>
                  <span style={{ fontWeight: 800, color: 'var(--text-main)' }}>Diferencia:</span>
                  <strong style={{ color: diferencia === 0 ? 'var(--success)' : diferencia > 0 ? 'var(--warning)' : 'var(--danger)' }}>
                    {diferencia >= 0 ? '+' : ''}${diferencia.toLocaleString()}
                  </strong>
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setMostrarCorte(false)}>Cancelar</button>
              <button className="btn btn-primary" onClick={guardarCorteCaja}>Guardar y Cerrar Corte</button>
            </div>
          </div>
        </div>
      )}
      {mostrarBitacora && (
        <ModalBitacora
          bitacora={bitacora}
          onClear={limpiarBitacora}
          onClose={() => {
            setMostrarBitacora(false);
            setLimiteBitacora(50);
            setLastBitacoraDoc(null);
            setLoadingMoreBitacora(false);
          }}
          onLoadMore={async () => {
            if (!lastBitacoraDoc || loadingMoreBitacora) return;
            setLoadingMoreBitacora(true);
            try {
              const q = query(collection(db, 'bitacora'), orderBy('fecha', 'desc'), startAfter(lastBitacoraDoc), limit(50));
              const snap = await getDocs(q);
              const newItems = snap.docs.map(d => ({ id: d.id, ...d.data() }));
              setBitacora(prev => [...prev, ...newItems]);
              setLastBitacoraDoc(snap.docs[snap.docs.length - 1] || null);
              setHasMoreBitacora(snap.docs.length === 50);
            } catch (e) {
              console.error('Error al cargar más bitácora:', e);
            } finally {
              setLoadingMoreBitacora(false);
            }
          }}
          hasMore={hasMoreBitacora}
          loadingMore={loadingMoreBitacora}
        />
      )}
    </div>
  );
}

// ── MODAL BITÁCORA ───────────────────────────────────────
function ModalBitacora({ bitacora, onClear, onClose, onLoadMore, hasMore, loadingMore }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 600 }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">
            <i className="ri-history-line" style={{ marginRight: 8, color: 'var(--bronze-light)' }} />
            Bitácora de Auditoría y Transacciones
          </span>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            {bitacora.length > 0 && (
              <button className="btn btn-sm btn-secondary" onClick={onClear} style={{ color: 'var(--danger)', fontSize: 11, padding: '4px 8px' }}>
                Limpiar
              </button>
            )}
            <button onClick={onClose} className="btn-icon btn btn-secondary" style={{ background: 'none', border: 'none' }}>
              <i className="ri-close-line" style={{ fontSize: 20 }} />
            </button>
          </div>
        </div>
        <div className="modal-body">
          <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>Movimientos de mesas, consumos y caja del negocio.</p>
          {bitacora.length === 0 ? (
            <p style={{ color: 'var(--text-muted)', fontSize: 13, textAlign: 'center', padding: '60px 0' }}>No hay registros disponibles en la bitácora.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxHeight: 380, overflowY: 'auto', paddingRight: 4 }}>
              {bitacora.map(b => {
                const isPositive = b.monto > 0;
                return (
                  <div key={b.id} style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 10, padding: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span className="badge badge-bronze" style={{ fontSize: 9, padding: '2px 6px' }}>{b.accion}</span>
                        <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                          {new Date(b.fecha).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })} · {new Date(b.fecha).toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit' })}
                        </span>
                      </div>
                      <span style={{ fontSize: 12, color: 'var(--text-primary)', fontWeight: 600 }}>{b.detalle}</span>
                      <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>Operador: {b.operador}</span>
                    </div>
                    {isPositive && (
                      <div style={{ fontSize: 15, fontWeight: 900, color: 'var(--success)' }}>
                        +${b.monto} MXN
                      </div>
                    )}
                  </div>
                );
              })}
              {hasMore && (
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={onLoadMore}
                  disabled={loadingMore}
                  style={{ width: '100%', marginTop: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, opacity: loadingMore ? 0.7 : 1, cursor: loadingMore ? 'not-allowed' : 'pointer' }}
                >
                  {loadingMore ? (
                    <>⧗ Cargando...</>
                  ) : (
                    <><i className="ri-arrow-down-s-line" /> Cargar más registros...</>
                  )}
                </button>
              )}
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn btn-primary" onClick={onClose}>
            Cerrar Bitácora
          </button>
        </div>
      </div>
    </div>
  );
}


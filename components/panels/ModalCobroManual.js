import React, { useState, useEffect } from 'react';

export default function ModalCobroManual({
  nuevoMonto,
  setNuevoMonto,
  nuevaDesc,
  setNuevaDesc,
  nuevoMetodo,
  setNuevoMetodo,
  cuentaAsociada, // Cuenta activa asociada si la hay
  onClose,
  onConfirm
}) {
  const [isClosing, setIsClosing] = useState(false);
  const [pagaCon, setPagaCon] = useState('');

  const handleClose = () => {
    setIsClosing(true);
    setTimeout(onClose, 150);
  };

  const montoVal = parseFloat(nuevoMonto) || 0;
  const pagaConVal = parseFloat(pagaCon) || 0;
  const cambio = pagaConVal >= montoVal ? pagaConVal - montoVal : 0;

  // Si hay cuenta asociada, bloquear monto y descripción para evitar errores
  const esCheckoutCuenta = !!cuentaAsociada;

  useEffect(() => {
    if (esCheckoutCuenta) {
      // Pre-poblar descripción y monto si viene de cuenta activa
      const clienteNombre = cuentaAsociada.cliente || 'Cliente';
      const mesaTexto = cuentaAsociada.mesaId ? ` - Mesa ${cuentaAsociada.mesaId}` : '';
      setNuevaDesc(`Cobro Cuenta Directa - ${clienteNombre}${mesaTexto}`);
      
      // Calcular total de consumos
      const totalConsumos = (cuentaAsociada.consumos || []).reduce(
        (sum, item) => sum + (parseFloat(item.precio || item.precioVenta || 0) * (item.cantidad || 0)), 
        0
      );
      setNuevoMonto(String(totalConsumos));
    }
  }, [cuentaAsociada, esCheckoutCuenta, setNuevaDesc, setNuevoMonto]);

  useEffect(() => {
    const draft = sessionStorage.getItem('yoy_draft_cobro_manual');
    if (draft && !esCheckoutCuenta) {
      try {
        const parsed = JSON.parse(draft);
        if (parsed.nuevoMonto || parsed.nuevaDesc) {
          if (!nuevoMonto && !nuevaDesc) {
            setNuevoMonto(parsed.nuevoMonto);
            setNuevaDesc(parsed.nuevaDesc);
          }
        }
        sessionStorage.removeItem('yoy_draft_cobro_manual');
      } catch (e) {}
    }
  }, [esCheckoutCuenta]);

  const handleConfirm = () => {
    // Pasar pagaCon y cambio a onConfirm
    onConfirm(pagaConVal, cambio);
  };

  // Botones rápidos de pago
  const quickBills = [
    montoVal,
    100, 200, 500, 1000
  ]
    .filter((value, index, self) => self.indexOf(value) === index) // Únicos
    .filter(b => b >= montoVal && b > 0)
    .sort((a, b) => a - b);

  return (
    <div className={`modal-overlay ${isClosing ? 'modal-closing' : ''}`} onClick={handleClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 460 }}>
        <div className="modal-header">
          <span className="modal-title">
            <i className="ri-money-dollar-box-line" style={{ marginRight: 8, color: 'var(--bronze-light)' }} />
            {esCheckoutCuenta ? 'Liquidar Cuenta Directa' : 'Registrar Cobro Manual'}
          </span>
          <button onClick={handleClose} className="btn-icon btn btn-secondary" style={{ background: 'none', border: 'none' }}>
            <i className="ri-close-line" style={{ fontSize: 20 }} />
          </button>
        </div>
        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          
          {/* Resumen de Consumos (si viene de una cuenta activa) */}
          {esCheckoutCuenta && (
            <div style={{
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border)',
              borderRadius: 10,
              padding: 10,
              display: 'flex',
              flexDirection: 'column',
              gap: 6
            }}>
              <div style={{ fontSize: 9.5, fontWeight: 700, color: 'var(--bronze-light)', borderBottom: '1px solid var(--border)', paddingBottom: 4 }}>
                <i className="ri-receipt-line" style={{ marginRight: 4 }} />
                DETALLE DE CONSUMOS
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 150, overflowY: 'auto' }}>
                {(cuentaAsociada.consumos || []).map((item, idx) => (
                  <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10.5, color: 'var(--text-secondary)' }}>
                    <span>{item.cantidad}x {item.producto}</span>
                    <span style={{ fontWeight: 600 }}>${Math.round(item.precio * item.cantidad).toLocaleString('es-MX')} MXN</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="form-group" style={{ gap: 4 }}>
            <label className="form-label" style={{ fontSize: 10 }}>Descripción del Concepto</label>
            <input 
              className="form-input" 
              placeholder="Ej: Torneo especial, Renta privada..." 
              value={nuevaDesc} 
              onChange={e => setNuevaDesc(e.target.value)} 
              disabled={esCheckoutCuenta}
              style={{ opacity: esCheckoutCuenta ? 0.75 : 1 }}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 14 }}>
            <div className="form-group" style={{ gap: 4 }}>
              <label className="form-label" style={{ fontSize: 10 }}>Total a Cobrar</label>
              <div style={{ display: 'flex', alignItems: 'center', position: 'relative' }}>
                <span style={{ position: 'absolute', left: 10, fontSize: 16, fontWeight: 'bold', color: 'var(--bronze-light)' }}>$</span>
                <input 
                  className="form-input" 
                  type="number" 
                  placeholder="0" 
                  value={nuevoMonto} 
                  onChange={e => setNuevoMonto(e.target.value)} 
                  disabled={esCheckoutCuenta}
                  style={{ paddingLeft: 22, fontSize: 18, fontWeight: 'bold', color: '#39ff14', opacity: esCheckoutCuenta ? 0.85 : 1 }}
                />
              </div>
            </div>
          </div>

          {/* Selector de Método de Pago con Botones */}
          <div className="form-group" style={{ gap: 4 }}>
            <label className="form-label" style={{ fontSize: 10 }}>Método de Pago</label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
              {[
                { id: 'efectivo', label: 'Efectivo', icon: 'ri-money-dollar-circle-line' },
                { id: 'transferencia', label: 'Transf.', icon: 'ri-bank-line' },
                { id: 'qr', label: 'Pago QR', icon: 'ri-qr-code-line' },
                { id: 'tarjeta', label: 'Tarjeta', icon: 'ri-bank-card-line' },
              ].map(m => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setNuevoMetodo(m.id)}
                  style={{
                    background: nuevoMetodo === m.id ? 'rgba(57, 255, 20, 0.08)' : 'var(--bg-elevated)',
                    border: `1px solid ${nuevoMetodo === m.id ? '#39ff14' : 'var(--border)'}`,
                    borderRadius: 8, 
                    padding: '8px 4px', 
                    cursor: 'pointer',
                    color: nuevoMetodo === m.id ? '#39ff14' : 'var(--text-secondary)',
                    display: 'flex', 
                    flexDirection: 'column', 
                    alignItems: 'center', 
                    gap: 3,
                    fontSize: 9.5, 
                    fontWeight: 600, 
                    transition: 'all 0.15s',
                    boxShadow: nuevoMetodo === m.id ? '0 0 10px rgba(57, 255, 20, 0.2)' : 'none',
                    transform: nuevoMetodo === m.id ? 'scale(1.04)' : 'none',
                  }}
                >
                  <i className={m.icon} style={{ fontSize: 14 }} />
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          {/* Panel de Cálculo de Cambio */}
          {nuevoMetodo === 'efectivo' && montoVal > 0 && (
            <div style={{
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border)',
              borderRadius: 10,
              padding: 10,
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
              animation: 'fadeIn 0.2s ease'
            }}>
              <div style={{ fontSize: 9.5, fontWeight: 700, color: 'var(--bronze-light)' }}>
                <i className="ri-coins-line" style={{ marginRight: 4 }} />
                CÁLCULO DE CAMBIO
              </div>
              <div className="form-group" style={{ gap: 2 }}>
                <label className="form-label" style={{ fontSize: 8.5 }}>Monto Recibido</label>
                <input
                  type="number"
                  className="form-input"
                  style={{
                    padding: '6px 10px',
                    fontSize: 13,
                    borderColor: pagaConVal >= montoVal ? '#39ff14' : 'var(--border)',
                    boxShadow: pagaConVal >= montoVal ? '0 0 8px rgba(57, 255, 20, 0.25)' : 'none',
                    transition: 'all 0.2s ease-in-out'
                  }}
                  placeholder="0.00"
                  value={pagaCon}
                  onChange={e => setPagaCon(e.target.value)}
                />
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 4 }}>
                  {quickBills.map((b, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => setPagaCon(b.toFixed(0))}
                      style={{
                        background: parseFloat(pagaCon) === b ? 'var(--bronze-subtle)' : 'var(--bg-hover)',
                        border: `1px solid ${parseFloat(pagaCon) === b ? 'var(--bronze)' : 'var(--border)'}`,
                        borderRadius: 6, 
                        padding: '3px 6px', 
                        fontSize: 9,
                        color: parseFloat(pagaCon) === b ? 'var(--bronze-light)' : 'var(--text-secondary)',
                        cursor: 'pointer'
                      }}
                    >
                      {b === montoVal ? `Exacto ($${Math.round(b).toLocaleString('es-MX')})` : `$${Math.round(b).toLocaleString('es-MX')}`}
                    </button>
                  ))}
                </div>
              </div>
              {pagaConVal > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid var(--border)', paddingTop: 6, marginTop: 4 }}>
                  <span style={{ fontSize: 10.5, color: 'var(--text-secondary)' }}>Cambio a Entregar:</span>
                  <span style={{
                    fontFamily: 'var(--font-display)',
                    fontSize: 18,
                    fontWeight: 950,
                    color: pagaConVal >= montoVal ? '#39ff14' : 'var(--danger)',
                    textShadow: pagaConVal >= montoVal ? '0 0 10px rgba(57, 255, 20, 0.35)' : 'none',
                    letterSpacing: '0.02em'
                  }}>
                    {pagaConVal >= montoVal ? `$${Math.round(cambio).toLocaleString('es-MX')} MXN` : 'Monto insuficiente'}
                  </span>
                </div>
              )}
            </div>
          )}

        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={handleClose}>Cancelar</button>
          <button 
            className="btn btn-primary" 
            onClick={handleConfirm}
            disabled={nuevoMetodo === 'efectivo' && pagaConVal < montoVal && montoVal > 0}
            style={{
              background: nuevoMetodo === 'efectivo' && pagaConVal < montoVal && montoVal > 0 
                ? 'var(--bg-elevated)' 
                : 'linear-gradient(135deg, var(--success), #2ed573)',
              color: nuevoMetodo === 'efectivo' && pagaConVal < montoVal && montoVal > 0 ? 'var(--text-muted)' : '#000',
              fontWeight: 'bold'
            }}
          >
            {esCheckoutCuenta ? 'Cobrar y Cerrar' : 'Registrar'}
          </button>
        </div>
      </div>
    </div>
  );
}

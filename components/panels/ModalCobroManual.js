import React, { useState, useEffect } from 'react';

export default function ModalCobroManual({ nuevoMonto, setNuevoMonto, nuevaDesc, setNuevaDesc, nuevoMetodo, setNuevoMetodo, onClose, onConfirm }) {
  const [isClosing, setIsClosing] = useState(false);

  const handleClose = () => {
    setIsClosing(true);
    setTimeout(onClose, 150);
  };

  useEffect(() => {
    const draft = sessionStorage.getItem('yoy_draft_cobro_manual');
    if (draft) {
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
  }, []);

  useEffect(() => {
    let lastBlurTime = 0;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        const now = Date.now();
        if (document.activeElement && 
            (document.activeElement.tagName === 'INPUT' || 
             document.activeElement.tagName === 'SELECT' || 
             document.activeElement.tagName === 'TEXTAREA')) {
          e.preventDefault();
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

        if (nuevoMonto || nuevaDesc) {
          if (!window.confirm('¿Deseas salir? Perderás los datos ingresados en el cobro manual.')) {
            return;
          }
        }
        handleClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [nuevoMonto, nuevaDesc, onClose]);

  return (
    <div className={`modal-overlay ${isClosing ? 'modal-closing' : ''}`} onClick={handleClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">
            <i className="ri-add-circle-line" style={{ marginRight: 8, color: 'var(--bronze-light)' }} />
            Registrar Cobro Manual
          </span>
          <button onClick={handleClose} className="btn-icon btn btn-secondary" style={{ background: 'none', border: 'none' }}>
            <i className="ri-close-line" style={{ fontSize: 20 }} />
          </button>
        </div>
        <div className="modal-body">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div className="form-group">
              <label className="form-label">Descripción</label>
              <input className="form-input" placeholder="Ej: Torneo especial, Renta privada..." value={nuevaDesc} onChange={e => setNuevaDesc(e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">Monto (negativo = gasto)</label>
              <input className="form-input" type="number" placeholder="Ej: 500 o -200" value={nuevoMonto} onChange={e => setNuevoMonto(e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">Método de Pago</label>
              <select className="form-select" value={nuevoMetodo} onChange={e => setNuevoMetodo(e.target.value)}>
                <option value="efectivo">💵 Efectivo</option>
                <option value="spei">📱 SPEI / QR CoDi</option>
                <option value="tarjeta">💳 Tarjeta</option>
              </select>
            </div>
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={handleClose}>Cancelar</button>
          <button className="btn btn-primary" onClick={onConfirm}>Registrar</button>
        </div>
      </div>
    </div>
  );
}

'use client';
import { useState, useEffect, useRef, useMemo } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { obfuscate, deobfuscate } from '@/lib/crypto';
import { db } from '@/lib/firebase';
import { doc, onSnapshot, setDoc, getDoc, serverTimestamp, collection, query, where, getDocs, writeBatch, updateDoc, runTransaction, addDoc } from 'firebase/firestore';

// ── DATOS INICIALES DE MESAS ───────────────────────────────
const INIT_MESAS = [
  { id: 1, nombre: 'Mesa 1', tipo: 'Carambola 3B', estado: 'libre',    cliente: null, inicio: null, tarifa: 80, socios: false, clienteUid: '' },
  { id: 2, nombre: 'Mesa 2', tipo: 'Carambola 3B', estado: 'ocupada',  cliente: 'Carlos R.', inicio: Date.now() - 45*60000, tarifa: 80, socios: false, clienteUid: '' },
  { id: 3, nombre: 'Mesa 3', tipo: 'Pool 9B',      estado: 'reservada', cliente: 'Pedro M.', inicio: null, tarifa: 60, socios: false, clienteUid: '' },
  { id: 4, nombre: 'Mesa 4', tipo: 'Carambola 3B', estado: 'libre',    cliente: null, inicio: null, tarifa: 80, socios: false, clienteUid: '' },
  { id: 5, nombre: 'Mesa 5', tipo: 'Snooker',      estado: 'manten',   cliente: null, inicio: null, tarifa: 100, socios: false, clienteUid: '' },
  { id: 6, nombre: 'Mesa 6', tipo: 'Pool 9B',      estado: 'libre',    cliente: null, inicio: null, tarifa: 60, socios: false, clienteUid: '' },
  { id: 7, nombre: 'Mesa 7', tipo: 'Carambola 3B', estado: 'ocupada',  cliente: 'Socio #12', inicio: Date.now() - 1.5*60*60000, tarifa: 0, socios: true, clienteUid: '' },
  { id: 8, nombre: 'Mesa 8', tipo: 'Pool 9B',      estado: 'libre',    cliente: null, inicio: null, tarifa: 60, socios: false, clienteUid: '' },
];

const ESTADO_CONFIG = {
  libre:     { label: 'Libre',     color: 'var(--mesa-libre)',     icon: 'ri-checkbox-blank-circle-line' },
  ocupada:   { label: 'Ocupada',   color: 'var(--mesa-ocupada)',   icon: 'ri-record-circle-line' },
  reservada: { label: 'Reservada', color: 'var(--mesa-reservada)', icon: 'ri-bookmark-fill' },
  manten:    { label: 'Mantenimiento', color: 'var(--mesa-manten)', icon: 'ri-tools-line' },
};

function formatTime(ms) {
  if (!ms) return '00:00:00';
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600).toString().padStart(2, '0');
  const m = Math.floor((s % 3600) / 60).toString().padStart(2, '0');
  const sc = (s % 60).toString().padStart(2, '0');
  return `${h}:${m}:${sc}`;
}

function calcCosto(mesa) {
  if (!mesa.inicio) return 0;
  const hrs = (Date.now() - mesa.inicio) / 3600000;
  let baseCosto = mesa.socios ? 0 : Math.ceil(hrs * mesa.tarifa);
  let premiumCosto = 0;
  if (mesa.rentarTaco) premiumCosto += Math.ceil(hrs * 25);
  if (mesa.rentarBolas) premiumCosto += Math.ceil(hrs * 35);
  if (mesa.rentarTiza) premiumCosto += 10;
  return baseCosto + premiumCosto;
}

// ── MANEJADOR DE CÁMARA (QR Y COMPROBANTE) ────────────────
function CameraHandler({ mode, onCapture }) {
  const [stream, setStream] = useState(null);
  const [error, setError] = useState('');
  const [capturedImg, setCapturedImg] = useState('');
  const videoRef = useRef(null);
  const canvasRef = useRef(null);

  useEffect(() => {
    let activeStream = null;
    const startCam = async () => {
      try {
        const constraints = { video: { facingMode: 'environment' } };
        const mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
        activeStream = mediaStream;
        setStream(mediaStream);
        if (videoRef.current) {
          videoRef.current.srcObject = mediaStream;
        }
      } catch (err) {
        console.error("Camera access error:", err);
        setError('No se pudo acceder a la cámara. Verifique permisos.');
      }
    };

    startCam();

    let simTimeout = null;
    if (mode === 'qr') {
      simTimeout = setTimeout(() => {
        simulateQRScan();
      }, 3500);
    }

    return () => {
      if (activeStream) {
        activeStream.getTracks().forEach(track => track.stop());
      }
      if (simTimeout) clearTimeout(simTimeout);
    };
  }, [mode]);

  const simulateQRScan = () => {
    playBeepSound();
    const randomRef = `QR_STP_${Math.floor(100000 + Math.random() * 900000)}`;
    onCapture({ reference: randomRef });
  };

  const takePhoto = () => {
    if (videoRef.current && canvasRef.current) {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      canvas.width = video.videoWidth || 640;
      canvas.height = video.videoHeight || 480;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL('image/jpeg');
      setCapturedImg(dataUrl);
      playBeepSound();
    }
  };

  const playBeepSound = () => {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        const ctx = new AudioCtx();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.type = 'sine';
        osc.frequency.value = 1200;
        gain.gain.setValueAtTime(0.1, ctx.currentTime);
        osc.start();
        osc.stop(ctx.currentTime + 0.15);
      }
    } catch (e) {
      console.warn("AudioContext beep failed", e);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'center', marginTop: 10 }}>
      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes scanLaser {
          0% { top: 0%; }
          50% { top: 100%; }
          100% { top: 0%; }
        }
      `}} />
      {error ? (
        <div style={{ color: 'var(--danger)', fontSize: 11, textAlign: 'center', background: 'rgba(239,68,68,0.1)', padding: 8, borderRadius: 8, width: '100%' }}>
          <i className="ri-error-warning-line" style={{ marginRight: 4 }} />
          {error}
          <div style={{ marginTop: 8 }}>
            <button 
              type="button"
              className="btn btn-secondary btn-sm" 
              onClick={simulateQRScan}
              style={{ width: '100%', textTransform: 'none' }}
            >
              {mode === 'qr' ? 'Simular Lectura de QR' : 'Simular Captura de Foto'}
            </button>
          </div>
        </div>
      ) : (
        <div style={{ position: 'relative', width: '100%', maxWidth: 280, height: 180, borderRadius: 12, overflow: 'hidden', border: '2px solid var(--border-bronze)', background: '#000' }}>
          {!capturedImg ? (
            <>
              <video 
                ref={videoRef} 
                autoPlay 
                playsInline 
                muted 
                style={{ width: '100%', height: '100%', objectFit: 'cover' }} 
              />
              {mode === 'qr' ? (
                <>
                  <div style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: '2px',
                    background: 'var(--bronze-light)',
                    boxShadow: '0 0 8px var(--bronze)',
                    animation: 'scanLaser 2s linear infinite'
                  }} />
                  <div style={{
                    position: 'absolute',
                    inset: 20,
                    border: '2px dashed rgba(255,255,255,0.4)',
                    borderRadius: 8,
                    pointerEvents: 'none'
                  }} />
                  <div style={{
                    position: 'absolute',
                    bottom: 8,
                    left: 0,
                    right: 0,
                    textAlign: 'center',
                    fontSize: 9,
                    color: '#fff',
                    textShadow: '1px 1px 2px #000'
                  }}>
                    Alinee el código QR
                  </div>
                </>
              ) : (
                <div style={{
                  position: 'absolute',
                  bottom: 8,
                  left: 0,
                  right: 0,
                  textAlign: 'center',
                  fontSize: 9,
                  color: '#fff',
                  textShadow: '1px 1px 2px #000'
                }}>
                  Enfoque el comprobante
                </div>
              )}
            </>
          ) : (
            <img src={capturedImg} style={{ width: '100%', height: '100%', objectFit: 'cover' }} alt="Captura" />
          )}
        </div>
      )}

      {!error && (
        <div style={{ display: 'flex', gap: 6, width: '100%' }}>
          {mode === 'qr' ? (
            <button 
              type="button"
              className="btn btn-secondary btn-sm" 
              onClick={simulateQRScan} 
              style={{ flex: 1, textTransform: 'none', fontSize: 10 }}
            >
              <i className="ri-qr-scan-line" /> Simular Escaneo
            </button>
          ) : (
            <>
              {!capturedImg ? (
                <button 
                  type="button"
                  className="btn btn-primary btn-sm" 
                  onClick={takePhoto} 
                  style={{ flex: 1, textTransform: 'none', fontSize: 10 }}
                >
                  <i className="ri-camera-lens-line" /> Capturar Foto
                </button>
              ) : (
                <>
                  <button 
                    type="button"
                    className="btn btn-secondary btn-sm" 
                    onClick={() => setCapturedImg('')} 
                    style={{ flex: 1, textTransform: 'none', fontSize: 10 }}
                  >
                    Repetir
                  </button>
                  <button 
                    type="button"
                    className="btn btn-primary btn-sm" 
                    onClick={() => onCapture({ photo: capturedImg })} 
                    style={{ flex: 1, textTransform: 'none', fontSize: 10 }}
                  >
                    Confirmar Foto
                  </button>
                </>
              )}
            </>
          )}
        </div>
      )}

      <canvas ref={canvasRef} style={{ display: 'none' }} />
    </div>
  );
}

// ── MODAL ABRIR MESA ──────────────────────────────────────
function ModalAbrirMesa({ mesa, onClose, onConfirm }) {
  const [cliente, setCliente] = useState(mesa.cliente || '');
  const [esSocio, setEsSocio] = useState(mesa.esSocio || false);
  const [rentarTaco, setRentarTaco] = useState(false);
  const [rentarBolas, setRentarBolas] = useState(false);
  const [rentarTiza, setRentarTiza] = useState(false);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title"><i className="ri-play-circle-line" style={{ marginRight: 8 }} />{mesa.nombre}</span>
          <button onClick={onClose} className="btn-icon btn btn-secondary" style={{ background: 'none', border: 'none' }}>
            <i className="ri-close-line" style={{ fontSize: 20 }} />
          </button>
        </div>
        <div className="modal-body">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ padding: 16, background: 'var(--bronze-subtle)', border: '1px solid var(--border-bronze)', borderRadius: 12 }}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 4 }}>Tipo de mesa</div>
              <div style={{ fontSize: 16, fontWeight: 700 }}>{mesa.tipo}</div>
              <div style={{ fontSize: 13, color: 'var(--bronze-light)', marginTop: 4 }}>${mesa.tarifa}/hr (público) · Socios: sin cargo</div>
            </div>

            <div className="form-group">
              <label className="form-label">Nombre del cliente (opcional)</label>
              <input className="form-input" placeholder="Ej: Carlos Rodríguez" value={cliente} onChange={e => setCliente(e.target.value)} />
            </div>

            <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', padding: '10px 14px', background: 'var(--bg-elevated)', borderRadius: 10, border: '1px solid var(--border)' }}>
              <input type="checkbox" checked={esSocio} onChange={e => setEsSocio(e.target.checked)} style={{ width: 16, height: 16, accentColor: 'var(--bronze)' }} />
              <span style={{ fontSize: 13, fontWeight: 600 }}>Es miembro / socio mensual</span>
              <span className="badge badge-bronze" style={{ marginLeft: 'auto' }}>Sin cargo</span>
            </label>

            <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--bronze-light)', marginBottom: 8 }}>Equipamiento Premium (Opcional)</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
                  <input type="checkbox" checked={rentarTaco} onChange={e => setRentarTaco(e.target.checked)} style={{ width: 16, height: 16, accentColor: 'var(--bronze)' }} />
                  <span style={{ fontSize: 12 }}>Taco de Fibra de Carbono (+$25/hr)</span>
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
                  <input type="checkbox" checked={rentarBolas} onChange={e => setRentarBolas(e.target.checked)} style={{ width: 16, height: 16, accentColor: 'var(--bronze)' }} />
                  <span style={{ fontSize: 12 }}>Bolas Profesionales Aramith (+$35/hr)</span>
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
                  <input type="checkbox" checked={rentarTiza} onChange={e => setRentarTiza(e.target.checked)} style={{ width: 16, height: 16, accentColor: 'var(--bronze)' }} />
                  <span style={{ fontSize: 12 }}>Tiza Kamui Especial (+$10 tarifa única)</span>
                </label>
              </div>
            </div>
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary" onClick={() => onConfirm({ cliente: cliente || 'Público', esSocio, rentarTaco, rentarBolas, rentarTiza })}>
            <i className="ri-play-circle-line" /> Iniciar Mesa
          </button>
        </div>
      </div>
    </div>
  );
}

// ── MODAL CERRAR MESA ────────────────────────────────────
// ── MODAL CERRAR MESA ────────────────────────────────────
function ModalCerrarMesa({ mesa, cuentasActivas, onClose, onCerrar, onAgregarACuenta }) {
  const [elapsed, setElapsed] = useState(Date.now() - (mesa.inicio || Date.now()));
  const [metodo, setMetodo] = useState('efectivo');
  const [tipoCierre, setTipoCierre] = useState('liquidar'); // 'liquidar' o 'cuenta'
  const [cuentaSeleccionada, setCuentaSeleccionada] = useState('');
  const [nuevoCliente, setNuevoCliente] = useState(mesa.cliente || '');

  // Nuevos estados para cálculo de cambio, QR y transferencia con foto
  const [pagaCon, setPagaCon] = useState('');
  const [referencia, setReferencia] = useState('');
  const [fotoComprobante, setFotoComprobante] = useState('');
  const [camaraActiva, setCamaraActiva] = useState(false);

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

        if (camaraActiva) {
          setCamaraActiva(false);
          return;
        }
        if (pagaCon || referencia || fotoComprobante) {
          if (!window.confirm('¿Deseas cancelar el cierre? Se perderán los datos del pago.')) {
            return;
          }
        }
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [camaraActiva, pagaCon, referencia, fotoComprobante, onClose]);

  useEffect(() => {
    const t = setInterval(() => setElapsed(Date.now() - (mesa.inicio || Date.now())), 1000);
    return () => clearInterval(t);
  }, [mesa.inicio]);

  // Limpiar campos al cambiar de método
  useEffect(() => {
    setPagaCon('');
    setReferencia('');
    setFotoComprobante('');
    setCamaraActiva(false);
  }, [metodo]);

  const cuentaAsociada = cuentasActivas.find(c => 
    c.cliente && (
      (mesa.cliente && c.cliente.toLowerCase() === mesa.cliente.toLowerCase()) || 
      c.cliente.toLowerCase() === `mesa ${mesa.id}`
    )
  );
  const consumosTotal = cuentaAsociada 
    ? cuentaAsociada.consumos.reduce((sum, item) => sum + item.precio * item.cantidad, 0)
    : 0;

  const costoTiempo = calcCosto({ ...mesa, inicio: mesa.inicio });
  const costo = mesa.socios ? consumosTotal : (costoTiempo + consumosTotal);
  const hrs = (elapsed / 3600000).toFixed(2);

  // Lógica de cálculo de efectivo
  const pagaConVal = parseFloat(pagaCon) || 0;
  const cambio = pagaConVal >= costo ? pagaConVal - costo : 0;
  
  const billetes = [50, 100, 200, 500, 1000];
  const quickBills = Array.from(new Set([costo, ...billetes.filter(b => b > costo)])).slice(0, 5);

  // Validación de cierre
  const isCerrarDisabled = tipoCierre === 'liquidar' && !mesa.socios && costo > 0 && (
    (metodo === 'efectivo' && pagaConVal < costo) ||
    (metodo === 'transferencia' && !referencia.trim()) ||
    (metodo === 'qr' && !referencia.trim())
  );

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 400, maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}>
        <div className="modal-header" style={{ padding: '8px 14px' }}>
          <span className="modal-title" style={{ fontSize: 12 }}><i className="ri-stop-circle-line" style={{ marginRight: 6, color: 'var(--danger)' }} />Cerrar {mesa.nombre}</span>
          <button onClick={onClose} className="btn btn-secondary" style={{ background: 'none', border: 'none', padding: 2 }}>
            <i className="ri-close-line" style={{ fontSize: 18 }} />
          </button>
        </div>
        <div className="modal-body" style={{ padding: '8px 14px', overflowY: 'auto', flex: 1 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {/* Resumen */}
            <div style={{ background: 'var(--bg-elevated)', borderRadius: 10, padding: '8px 12px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
              <div>
                <div style={{ fontSize: 8, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 1 }}>Tiempo</div>
                <div style={{ fontFamily: 'var(--font-display)', fontSize: 15, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--bronze-light)' }}>{formatTime(elapsed)}</div>
                <div style={{ fontSize: 9, color: 'var(--text-muted)' }}>{hrs} hrs · ${mesa.tarifa}/hr</div>
              </div>
              <div>
                <div style={{ fontSize: 8, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 1 }}>Total de Mesa</div>
                <div style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 900, color: mesa.socios && costo === 0 ? 'var(--success)' : 'var(--text-primary)', lineHeight: 1.2 }}>
                  {mesa.socios && costo === 0 ? 'SOCIO' : `$${costo}`}
                </div>
                {(!mesa.socios || costo > 0) && <div style={{ fontSize: 9, color: 'var(--text-muted)', lineHeight: 1 }}>MXN</div>}
              </div>
            </div>

            {/* Breakdown de consumos if any */}
            {consumosTotal > 0 && (
              <div style={{ background: 'var(--bg-elevated)', borderRadius: 10, padding: '8px 12px', fontSize: 10, border: '1px solid var(--border)' }}>
                <div style={{ fontWeight: 'bold', color: 'var(--bronze-light)', marginBottom: 4 }}>Detalle de Consumos:</div>
                <ul style={{ margin: 0, paddingLeft: 14, color: 'var(--text-muted)' }}>
                  {!mesa.socios && <li>Tiempo de juego: ${costoTiempo}</li>}
                  {cuentaAsociada.consumos.map((item, idx) => (
                    <li key={idx}>{item.cantidad}x {item.producto} (${item.precio * item.cantidad})</li>
                  ))}
                </ul>
              </div>
            )}

            {(mesa.rentarTaco || mesa.rentarBolas || mesa.rentarTiza) && (
              <div style={{ fontSize: 10, color: 'var(--bronze-light)', padding: '6px 10px', background: 'var(--bg-elevated)', borderRadius: 8, border: '1px solid var(--border)' }}>
                <strong>Equipamiento Rentado:</strong>
                <ul style={{ margin: '4px 0 0 14px', padding: 0, fontSize: 9, color: 'var(--text-muted)' }}>
                  {mesa.rentarTaco && <li>Taco de Carbono (+$25/hr)</li>}
                  {mesa.rentarBolas && <li>Bolas Aramith (+$35/hr)</li>}
                  {mesa.rentarTiza && <li>Tiza Kamui (+$10 única)</li>}
                </ul>
              </div>
            )}

            {/* Opciones de Cierre */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
              <button
                className={`btn btn-sm ${tipoCierre === 'liquidar' ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setTipoCierre('liquidar')}
                style={{ flex: 1, padding: '4px 8px', fontSize: 10 }}
              >
                Liquidar Ahora
              </button>
              <button
                className={`btn btn-sm ${tipoCierre === 'cuenta' ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setTipoCierre('cuenta')}
                style={{ flex: 1, padding: '4px 8px', fontSize: 10 }}
              >
                Agregar a Cuenta
              </button>
            </div>

            {/* Panel de Liquidación */}
            {tipoCierre === 'liquidar' ? (
              <>
                <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                  <i className="ri-user-line" style={{ marginRight: 4 }} />
                  {mesa.cliente || 'Público General'}
                </div>

                {!mesa.socios && (
                  <div className="form-group" style={{ gap: 2 }}>
                    <label className="form-label" style={{ fontSize: 9, marginBottom: 2 }}>Método de Pago</label>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 4 }}>
                      {[
                        { id: 'efectivo', label: 'Efectivo', icon: 'ri-money-dollar-circle-line' },
                        { id: 'transferencia', label: 'Transf.', icon: 'ri-bank-line' },
                        { id: 'qr', label: 'Pago QR', icon: 'ri-qr-code-line' },
                        { id: 'tarjeta', label: 'Tarjeta', icon: 'ri-bank-card-line' },
                      ].map(m => (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() => setMetodo(m.id)}
                          style={{
                            background: metodo === m.id ? 'var(--bronze-subtle)' : 'var(--bg-elevated)',
                            border: `1px solid ${metodo === m.id ? 'var(--border-bronze)' : 'var(--border)'}`,
                            borderRadius: 8, padding: '6px 2px', cursor: 'pointer',
                            color: metodo === m.id ? 'var(--bronze-light)' : 'var(--text-secondary)',
                            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
                            fontSize: 8, fontWeight: 600, transition: 'all 0.15s',
                          }}
                        >
                          <i className={m.icon} style={{ fontSize: 12 }} />
                          {m.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Sub-Paneles Condicionales de Liquidación */}
                {!mesa.socios && metodo === 'efectivo' && costo > 0 && (
                  <div style={{
                    background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 10, padding: 10, display: 'flex', flexDirection: 'column', gap: 6, animation: 'fadeIn 0.2s ease'
                  }}>
                    <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--bronze-light)' }}><i className="ri-coins-line" style={{ marginRight: 4 }} />CÁLCULO DE CAMBIO</div>
                    <div className="form-group" style={{ gap: 2 }}>
                      <label className="form-label" style={{ fontSize: 8 }}>Monto Recibido</label>
                      <input
                        type="number"
                        className="form-input"
                        style={{ padding: '6px 10px', fontSize: 12 }}
                        placeholder="0.00"
                        value={pagaCon}
                        onChange={e => setPagaCon(e.target.value)}
                      />
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 2 }}>
                        {quickBills.map((b, i) => (
                          <button
                            key={i}
                            type="button"
                            onClick={() => setPagaCon(b.toFixed(0))}
                            style={{
                              background: parseFloat(pagaCon) === b ? 'var(--bronze-subtle)' : 'var(--bg-hover)',
                              border: `1px solid ${parseFloat(pagaCon) === b ? 'var(--bronze)' : 'var(--border)'}`,
                              borderRadius: 4, padding: '2px 4px', fontSize: 8,
                              color: parseFloat(pagaCon) === b ? 'var(--bronze-light)' : 'var(--text-secondary)',
                              cursor: 'pointer'
                            }}
                          >
                            {b === costo ? 'Exacto' : `$${b}`}
                          </button>
                        ))}
                      </div>
                    </div>
                    {pagaConVal > 0 && (
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid var(--border)', paddingTop: 6, marginTop: 2 }}>
                        <span style={{ fontSize: 10, color: 'var(--text-secondary)' }}>Cambio a Entregar:</span>
                        <span style={{ fontFamily: 'var(--font-display)', fontSize: 14, fontWeight: 900, color: pagaConVal >= costo ? 'var(--success)' : 'var(--danger)' }}>
                          {pagaConVal >= costo ? `$${cambio.toFixed(2)} MXN` : 'Monto insuficiente'}
                        </span>
                      </div>
                    )}
                  </div>
                )}

                {!mesa.socios && metodo === 'transferencia' && costo > 0 && (
                  <div style={{
                    background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 10, padding: 10, display: 'flex', flexDirection: 'column', gap: 6, animation: 'fadeIn 0.2s ease'
                  }}>
                    <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--bronze-light)', display: 'flex', justifyContent: 'space-between' }}>
                      <span><i className="ri-bank-line" style={{ marginRight: 4 }} />DATOS BANCARIOS (SPEI)</span>
                    </div>
                    <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px dashed var(--border-bronze)', borderRadius: 6, padding: '4px 8px', fontSize: 9, color: 'var(--text-secondary)', lineHeight: 1.3 }}>
                      <div><strong>Banco:</strong> STP / YoY Billar Club</div>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span><strong>CLABE:</strong> 123456789012345678</span>
                        <span onClick={() => { navigator.clipboard.writeText('123456789012345678'); showToast('CLABE copiada ✓', 'success'); }} style={{ color: 'var(--bronze-light)', cursor: 'pointer' }}><i className="ri-file-copy-line" /></span>
                      </div>
                    </div>
                    <div className="form-group" style={{ gap: 2 }}>
                      <label className="form-label" style={{ fontSize: 8 }}>Referencia de Transferencia</label>
                      <input
                        type="text"
                        className="form-input"
                        style={{ padding: '6px 10px', fontSize: 11 }}
                        placeholder="Ingrese ref / clave de rastreo"
                        value={referencia}
                        onChange={e => setReferencia(e.target.value)}
                      />
                    </div>
                    <div style={{ borderTop: '1px solid var(--border)', paddingTop: 6, marginTop: 2 }}>
                      <label className="form-label" style={{ fontSize: 8, marginBottom: 4, display: 'block' }}>Comprobante de Pago (Foto)</label>
                      {fotoComprobante ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(34,197,94,0.08)', padding: 4, borderRadius: 6, border: '1px solid rgba(34,197,94,0.2)' }}>
                          <div style={{ width: 32, height: 32, borderRadius: 4, overflow: 'hidden', border: '1px solid var(--border)', background: '#000' }}>
                            <img src={fotoComprobante} style={{ width: '100%', height: '100%', objectFit: 'cover' }} alt="Comp" />
                          </div>
                          <span style={{ fontSize: 9, color: 'var(--success)', fontWeight: 700, flex: 1 }}>Foto Cargada ✓</span>
                          <span onClick={() => setFotoComprobante('')} style={{ color: 'var(--danger)', cursor: 'pointer', padding: 4 }}><i className="ri-close-fill" /></span>
                        </div>
                      ) : (
                        <>
                          {camaraActiva ? (
                            <CameraHandler
                              mode="photo"
                              onCapture={({ photo }) => {
                                setFotoComprobante(photo);
                                setCamaraActiva(false);
                              }}
                            />
                          ) : (
                            <button
                              type="button"
                              onClick={() => setCamaraActiva(true)}
                              className="btn btn-secondary btn-sm"
                              style={{ width: '100%', fontSize: 9, textTransform: 'none', display: 'flex', justifyContent: 'center', gap: 4, padding: '4px 8px' }}
                            >
                              <i className="ri-camera-line" /> Tomar Foto del Comprobante
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                )}

                {!mesa.socios && metodo === 'qr' && costo > 0 && (
                  <div style={{
                    background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 10, padding: 10, display: 'flex', flexDirection: 'column', gap: 6, animation: 'fadeIn 0.2s ease'
                  }}>
                    <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--bronze-light)' }}><i className="ri-qr-code-line" style={{ marginRight: 4 }} />ESCANEO DE QR DE PAGO</div>
                    {referencia ? (
                      <div style={{ background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.2)', borderRadius: 6, padding: 6, textAlign: 'center' }}>
                        <div style={{ color: 'var(--success)', fontWeight: 800, fontSize: 10 }}>QR Escaneado ✓</div>
                        <div style={{ fontSize: 9, color: 'var(--text-secondary)', marginTop: 2 }}>ID Transacción: {referencia}</div>
                        <span onClick={() => setReferencia('')} style={{ fontSize: 8, color: 'var(--bronze-light)', cursor: 'pointer', textDecoration: 'underline', marginTop: 4, display: 'block' }}>Volver a Escanear</span>
                      </div>
                    ) : (
                      <CameraHandler
                        mode="qr"
                        onCapture={({ reference }) => {
                          setReferencia(reference);
                          showToast('Código QR leído ✓', 'success');
                        }}
                      />
                    )}
                  </div>
                )}
              </>
            ) : (
              /* Panel de Agregar a Cuenta */
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div className="form-group" style={{ gap: 2 }}>
                  <label className="form-label" style={{ fontSize: 9 }}>Seleccionar Cuenta Activa</label>
                  <select
                    className="form-select"
                    style={{ padding: '6px 10px', fontSize: 11, height: 'auto' }}
                    value={cuentaSeleccionada}
                    onChange={e => {
                      setCuentaSeleccionada(e.target.value);
                      if (e.target.value !== '') setNuevoCliente('');
                    }}
                  >
                    <option value="">-- Crear nueva cuenta temporal --</option>
                    {cuentasActivas.map(c => (
                      <option key={c.id} value={c.id}>{c.cliente} (Acumulado: ${c.tiempoJuego + c.consumos.reduce((s,i)=>s+i.precio*i.cantidad,0)} MXN)</option>
                    ))}
                  </select>
                </div>

                {cuentaSeleccionada === '' && (
                  <div className="form-group" style={{ gap: 2 }}>
                    <label className="form-label" style={{ fontSize: 9 }}>Nombre del Nuevo Cliente Temporal</label>
                    <input
                      className="form-input"
                      style={{ padding: '6px 10px', fontSize: 11 }}
                      placeholder="Ej: Pedro Domínguez"
                      value={nuevoCliente}
                      onChange={e => setNuevoCliente(e.target.value)}
                    />
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
        <div className="modal-footer" style={{ padding: '8px 14px' }}>
          <button className="btn btn-secondary" style={{ padding: '6px 12px', fontSize: 11 }} onClick={onClose}>Cancelar</button>
          {tipoCierre === 'liquidar' ? (
            <button
              className="btn btn-primary"
              onClick={() => onCerrar({ 
                costo, 
                metodo, 
                tiempo: elapsed,
                referencia,
                pagaCon: pagaConVal,
                cambio,
                fotoAdjunta: !!fotoComprobante
              })}
              disabled={isCerrarDisabled}
              style={{ 
                background: isCerrarDisabled ? 'var(--bg-hover)' : 'linear-gradient(135deg, var(--danger), #ff6b6b)', 
                padding: '6px 12px', 
                fontSize: 11,
                cursor: isCerrarDisabled ? 'not-allowed' : 'pointer'
              }}
            >
              <i className="ri-stop-circle-line" /> Cerrar y Cobrar
            </button>
          ) : (
            <button
              className="btn btn-primary"
              onClick={() => onAgregarACuenta({
                costo: costoTiempo,
                cuentaId: cuentaSeleccionada,
                nombreNuevo: nuevoCliente || 'Cliente Temporal'
              })}
              style={{ background: 'linear-gradient(135deg, var(--bronze), var(--bronze-light))', padding: '6px 12px', fontSize: 11 }}
            >
              <i className="ri-folder-add-line" /> Guardar en Cuenta
            </button>
          )}
        </div>
      </div>
    </div>
  );
}


// ── TIMER HOOK ────────────────────────────────────────────
function useLiveTick() {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick(p => p + 1), 1000);
    return () => clearInterval(t);
  }, []);
  return tick;
}

// ── PANEL PRINCIPAL DE MESAS ──────────────────────────────
export default function MesasPanel({ showToast }) {
  const [mesas, setMesas] = useState(INIT_MESAS);
  const [filtro, setFiltro] = useState('todas');
  const [modalAbrir, setModalAbrir] = useState(null);
  const [modalCerrar, setModalCerrar] = useState(null);
  const [modalNuevaMesa, setModalNuevaMesa] = useState(false);
  const [modalFila, setModalFila] = useState(false);
  const [modalCuentas, setModalCuentas] = useState(false);
  const [modalAbrirCuenta, setModalAbrirCuenta] = useState(false);
  const [modalCambiarMesa, setModalCambiarMesa] = useState(null);
  const [modalVincular, setModalVincular] = useState(null);
  const [modalBitacora, setModalBitacora] = useState(false);
  const [bitacora, setBitacora] = useState([]);
  const [modalComanda, setModalComanda] = useState(false);
  const [productosBajos, setProductosBajos] = useState([]);
  const [modalQR, setModalQR] = useState(null); // mesa para mostrar QR

  const [isFullscreen, setIsFullscreen] = useState(false);
  const [mostrarCobroManual, setMostrarCobroManual] = useState(false);
  const [nuevoMonto, setNuevoMonto] = useState('');
  const [nuevaDesc, setNuevaDesc] = useState('');
  const [nuevoMetodo, setNuevoMetodo] = useState('efectivo');
  const [pinAutorizacion, setPinAutorizacion] = useState('');
  const [adminPinHash, setAdminPinHash] = useState('170440'); // Hash of '1111'
  const [alertasMesas, setAlertasMesas] = useState({});
  const knownAlertsRef = useRef(new Set());
  const isInitialLoadRef = useRef(true);

  // Marcar una solicitud de cliente como atendida en Firestore (Caja/Admin)
  const marcarAlertaAtendida = async (alertaId, e) => {
    if (e) e.stopPropagation(); // Evitar abrir el modal de la mesa
    try {
      const docRef = doc(db, 'mesa_pedidos', alertaId);
      const snap = await getDoc(docRef);
      if (snap.exists()) {
        const data = snap.data();
        const updateData = {
          atendidoAdmin: true,
          updatedAt: serverTimestamp()
        };
        // Solo archivar si no es un pedido (ya que el pedido debe seguir en cocina/entrega)
        if (data.tipo !== 'pedido') {
          if (data.atendidoMesero === true) {
            updateData.estado = 'atendido';
            updateData.atendidoAt = serverTimestamp();
          }
        }
        await updateDoc(docRef, updateData);
        showToast('Solicitud marcada como atendida ✓', 'success');
      }
    } catch (err) {
      console.error("Error al marcar alerta como atendida:", err);
      showToast('Error al atender solicitud.', 'error');
    }
  };

  // Cargar un pedido enviado por el cliente directamente a su cuenta de mesa y descontar inventario
  const cargarPedidoACuenta = async (mesaId, pedidoDoc, isAuto = false) => {
    if (pedidoDoc.cargadoACuenta) return;
    const targetMesa = mesaId ? mesas.find(m => m.id === mesaId) : null;
    if (mesaId && !targetMesa) return;

    const orderItems = pedidoDoc.items || [];
    const totalPedido = pedidoDoc.total || 0;

    // 1. Obtener y verificar stock de Firestore primero
    let stockActualizado = null;
    try {
      const snap = await getDoc(doc(db, 'config', 'inventario'));
      if (snap.exists()) {
        const parsed = snap.data().productos || [];
        const conflictos = [];
        orderItems.forEach(item => {
          const p = parsed.find(prod => prod.id === item.productoId);
          if (p && p.stock < item.cantidad) {
            conflictos.push(`${item.nombre} (Disponibles: ${p.stock}, Solicitados: ${item.cantidad})`);
          }
        });

        if (conflictos.length > 0) {
          if (!isAuto) {
            const confirmar = window.confirm(
              `⚠️ ¡Conflicto de Stock!\n` +
              `Los siguientes productos no tienen inventario suficiente:\n` +
              `- ${conflictos.join('\n- ')}\n\n` +
              `¿Desea forzar la carga de la comanda? El stock de estos productos se ajustará a 0.`
            );
            if (!confirmar) {
              showToast('Carga de pedido cancelada por falta de stock', 'warning');
              return;
            }
          }
        }

        stockActualizado = parsed.map(p => {
          const enCart = orderItems.find(item => item.productoId === p.id);
          if (enCart) {
            return { ...p, stock: Math.max(0, p.stock - enCart.cantidad), lastModified: Date.now() };
          }
          return p;
        });
      }
    } catch (err) {
      console.error("Error al verificar stock en Firestore:", err);
      if (!isAuto) {
        const continuarSinStock = window.confirm(
          "No se pudo verificar el stock en tiempo real con el servidor.\n" +
          "¿Desea continuar con la carga del pedido?"
        );
        if (!continuarSinStock) return;
      }
    }

    // 2. Si la mesa está libre, la abrimos automáticamente (si aplica mesaId)
    let clienteName = (targetMesa ? targetMesa.cliente : null) || pedidoDoc.cliente || `Cliente`;
    let updatedMesas = mesas;
    if (targetMesa && targetMesa.estado !== 'ocupada') {
      updatedMesas = mesas.map(m => m.id === mesaId
        ? { ...m, estado: 'ocupada', cliente: clienteName, inicio: Date.now(), clienteUid: pedidoDoc.clienteUid || '' }
        : m
      );
      setMesas(updatedMesas);
      localStorage.setItem('yoy_billar_mesas', obfuscate(updatedMesas));
      registrarEvento('Apertura Auto', `Mesa ${mesaId} abierta automáticamente por pedido de cliente (${clienteName})`);
    }

    // 3. Buscar la cuenta activa o crear una nueva
    const cuentaExistente = cuentasActivas.find(c => c.cliente && c.cliente.toLowerCase() === clienteName.toLowerCase());
    
    let nuevasCuentas = [...cuentasActivas];
    if (cuentaExistente) {
      nuevasCuentas = cuentasActivas.map(c => {
        if (c.id === cuentaExistente.id) {
          const nuevosConsumos = [...c.consumos];
          orderItems.forEach(cartItem => {
            const existeItem = nuevosConsumos.find(i => i.producto === cartItem.nombre);
            if (existeItem) {
              existeItem.cantidad += cartItem.cantidad;
            } else {
              nuevosConsumos.push({
                id: Date.now() + Math.random(),
                producto: cartItem.nombre,
                precio: cartItem.precio,
                cantidad: cartItem.cantidad
              });
            }
          });
          return { ...c, consumos: nuevosConsumos };
        }
        return c;
      });
    } else {
      const nuevaCuenta = {
        id: Date.now(),
        cliente: clienteName,
        tiempoJuego: 0,
        consumos: orderItems.map(item => ({
          id: Date.now() + Math.random(),
          producto: item.nombre,
          precio: item.precio,
          cantidad: item.cantidad
        })),
        inicio: Date.now()
      };
      nuevasCuentas.push(nuevaCuenta);
    }

    setCuentasActivas(nuevasCuentas);
    localStorage.setItem('yoy_billar_cuentas', obfuscate(nuevasCuentas));

    // 4. Guardar inventario actualizado en Firestore, registrar auditoría y marcar como entregado de forma atómica
    try {
      await runTransaction(db, async (transaction) => {
        const invRef = doc(db, 'config', 'inventario');
        const invSnap = await transaction.get(invRef);
        if (!invSnap.exists()) throw new Error("No existe el documento de inventario central");

        const parsed = invSnap.data().productos || [];
        const stockTransaccion = parsed.map(p => {
          const enCart = orderItems.find(item => item.productoId === p.id);
          if (enCart) {
            return { ...p, stock: Math.max(0, p.stock - enCart.cantidad), lastModified: Date.now() };
          }
          return p;
        });

        // Escribir el inventario actualizado
        transaction.update(invRef, {
          productos: stockTransaccion,
          updatedAt: serverTimestamp()
        });

        // Registrar en historial_stock para auditoría
        const auditRef = doc(collection(db, 'historial_stock'));
        transaction.set(auditRef, {
          fecha: serverTimestamp(),
          mesaId,
          cliente: clienteName,
          items: orderItems,
          total: totalPedido,
          tipo: 'descuento_qr',
          pedidoId: pedidoDoc.id
        });

        // Marcar el pedido como cargado (Caja)
        const pedidoRef = doc(db, 'mesa_pedidos', pedidoDoc.id);
        const updateData = {
          atendidoAdmin: true,
          cargadoACuenta: true,
          updatedAt: serverTimestamp()
        };
        transaction.update(pedidoRef, updateData);

        // Actualizar el caché de stock local después de confirmarse la transacción
        localStorage.setItem('yoy_billar_stock', obfuscate(stockTransaccion));
      });

      showToast(`Pedido de ${mesaId ? `Mesa ${mesaId}` : clienteName} cargado a la cuenta ✓`, 'success');
      registrarEvento('Pedido a Cuenta', `Pedido de ${orderItems.map(i=>`${i.cantidad}x ${i.nombre}`).join(', ')} cargado a la cuenta de ${clienteName}`, totalPedido);
    } catch (err) {
      console.error("Error al procesar la transacción de descuento de stock:", err);
      showToast('Error de red al actualizar stock atómicamente', 'error');
    }
  };

  // Escuchar alertas de mesas activas desde Firestore
  useEffect(() => {
    const q = query(
      collection(db, 'mesa_pedidos'),
      where('estado', 'in', ['pendiente', 'listo', 'en_camino', 'entregado'])
    );
    const unsub = onSnapshot(q, snap => {
      const alertsMap = {};
      let hasNewAlert = false;
      const currentAlerts = new Set();

      snap.docs.forEach(doc => {
        const data = doc.data();
        const mesaId = data.mesaId;
        const id = doc.id;
        currentAlerts.add(id);

        // Auto-cargar pedidos a la cuenta de forma reactiva si es un pedido o si fue atendido por mesero o admin o si ya está listo/en camino/entregados
        const debCargar = data.tipo === 'pedido' || data.atendidoMesero || data.atendidoAdmin || ['listo', 'en_camino', 'entregado'].includes(data.estado);
        if (data.tipo === 'pedido' && !data.cargadoACuenta && debCargar) {
          cargarPedidoACuenta(mesaId || 0, { id, ...data }, true);
        }

        // Solo incluir alertas que no hayan sido atendidas por el admin
        if (mesaId && !data.atendidoAdmin) {
          if (!alertsMap[mesaId]) {
            alertsMap[mesaId] = [];
          }
          alertsMap[mesaId].push({ id, ...data });
        }

        // Si no es la carga inicial y detectamos un id que no estaba en knownAlerts
        if (!isInitialLoadRef.current && !knownAlertsRef.current.has(id)) {
          hasNewAlert = true;
        }
      });

      knownAlertsRef.current = currentAlerts;
      isInitialLoadRef.current = false;
      setAlertasMesas(alertsMap);

      if (hasNewAlert) {
        // Reproducir sonido sutil de chime (high double chime) y vibración
        try {
          const ctx = new (window.AudioContext || window.webkitAudioContext)();
          const osc1 = ctx.createOscillator();
          const gain1 = ctx.createGain();
          osc1.connect(gain1); gain1.connect(ctx.destination);
          osc1.frequency.value = 587.33; // D5
          gain1.gain.value = 0.08;
          osc1.start(); osc1.stop(ctx.currentTime + 0.12);
          
          setTimeout(() => {
            const osc2 = ctx.createOscillator();
            const gain2 = ctx.createGain();
            osc2.connect(gain2); gain2.connect(ctx.destination);
            osc2.frequency.value = 698.46; // F5
            gain2.gain.value = 0.08;
            osc2.start(); osc2.stop(ctx.currentTime + 0.22);
          }, 120);

          if (typeof navigator !== 'undefined' && navigator.vibrate) {
            navigator.vibrate([100, 50, 100]); // Vibración doble
          }
        } catch (e) {
          console.warn("Chime playback failed", e);
        }
      }
    }, err => {
      console.error("Error al escuchar alertas de mesas:", err);
    });
    return unsub;
  }, []);

  const hashPassword = (pwd) => {
    if (!pwd) return '';
    let hash = 0;
    for (let i = 0; i < pwd.length; i++) {
      hash = (hash << 5) - hash + pwd.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash).toString(16);
  };

  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'config', 'seguridad'), snap => {
      if (snap.exists() && snap.data().adminPinHash) {
        const hash = snap.data().adminPinHash;
        setAdminPinHash(hash);
        localStorage.setItem('yoy_admin_pin_hash', obfuscate(hash));
      } else {
        if (typeof window !== 'undefined') {
          const localHash = localStorage.getItem('yoy_admin_pin_hash');
          if (localHash) setAdminPinHash(deobfuscate(localHash) || '170440');
        }
      }
    }, err => {
      console.warn("Firestore seguridad sync error (offline fallback):", err);
      if (typeof window !== 'undefined') {
        const localHash = localStorage.getItem('yoy_admin_pin_hash');
        if (localHash) setAdminPinHash(deobfuscate(localHash) || '170440');
      }
    });
    return unsub;
  }, []);

  // Escuchar cambios de pantalla completa nativos
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
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

        if (modalComanda || 
            modalNuevaMesa || 
            modalFila || 
            modalCuentas || 
            modalAbrirCuenta || 
            modalCerrar || 
            mostrarCobroManual ||
            modalVincular) {
          return;
        }

        setModalAbrir(null);
        setModalCambiarMesa(null);
        setModalVincular(null);
        setModalBitacora(false);
        setModalQR(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [modalComanda, modalNuevaMesa, modalFila, modalCuentas, modalAbrirCuenta, modalCerrar, mostrarCobroManual, modalVincular]);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().then(() => {
        setIsFullscreen(true);
      }).catch((err) => {
        showToast('Error al activar modo kiosco', 'error');
      });
    } else {
      document.exitFullscreen();
      setIsFullscreen(false);
    }
  };

  const registrarCobroManual = () => {
    if (!nuevoMonto || !nuevaDesc) {
      showToast('Completa todos los campos', 'warning');
      return;
    }
    if (hashPassword(pinAutorizacion) !== adminPinHash) {
      showToast('PIN de autorización incorrecto', 'danger');
      return;
    }
    const monto = parseFloat(nuevoMonto);

    let currentCobros = [];
    try {
      const saved = localStorage.getItem('yoy_caja_cobros');
      if (saved) {
        currentCobros = JSON.parse(saved);
      } else {
        currentCobros = [
          { id: 1, tipo: 'mesa', descripcion: 'Mesa 2 - 1.5h', cliente: 'Carlos R.', monto: 120, metodo: 'efectivo', hora: '14:30', color: 'var(--success)' },
          { id: 2, tipo: 'bar',  descripcion: 'Comanda - 4 Coronas + Botana', cliente: 'Mesa 7', monto: 280, metodo: 'efectivo', hora: '13:15', color: 'var(--success)' },
          { id: 3, tipo: 'mesa', descripcion: 'Mesa 3 - 2h', cliente: 'Pedro M.', monto: 160, metodo: 'spei', hora: '12:00', color: 'var(--success)' },
          { id: 4, tipo: 'gasto',descripcion: 'Compra de bebidas', cliente: 'Proveedor ABC', monto: -650, metodo: 'efectivo', hora: '11:00', color: 'var(--danger)' },
          { id: 5, tipo: 'mesa', descripcion: 'Mesa 1 - 3h', cliente: 'Torneo Local', monto: 240, metodo: 'efectivo', hora: '09:30', color: 'var(--success)' },
        ];
      }
    } catch (err) {
      console.error(err);
    }

    const nuevoCobro = {
      id: Date.now(),
      tipo: 'manual',
      descripcion: nuevaDesc,
      cliente: 'Manual (Autorizado)',
      monto: monto,
      metodo: nuevoMetodo,
      hora: new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }),
      color: monto > 0 ? 'var(--success)' : 'var(--danger)',
    };

    const updatedCobros = [nuevoCobro, ...currentCobros];
    localStorage.setItem('yoy_caja_cobros', JSON.stringify(updatedCobros));
    
    registrarEvento('Cobro Manual', `Cobro manual de $${monto} registrado (${nuevaDesc}) por ${nuevoMetodo}`, monto);
    showToast(`Cobro manual de $${monto} registrado`, 'success');

    setMostrarCobroManual(false);
    setNuevoMonto('');
    setNuevaDesc('');
    setPinAutorizacion('');
  };

  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'config', 'inventario'), snap => {
      if (snap.exists()) {
        const list = snap.data().productos || [];
        const bajos = list.filter(p => p.stock <= (p.stockMin !== undefined ? p.stockMin : 15));
        setProductosBajos(bajos);
      }
    }, err => {
      console.error("Error al escuchar inventario para stock bajo:", err);
    });
    return unsub;
  }, []);

  const [cuentasActivas, setCuentasActivas] = useState([
    { id: 101, cliente: 'Juan Pérez', tiempoJuego: 160, consumos: [{ id: 1, producto: 'Cerveza Corona', precio: 45, cantidad: 2 }, { id: 2, producto: 'Refresco Coca-Cola', precio: 30, cantidad: 1 }], inicio: Date.now() - 1.5*3600000 },
    { id: 102, cliente: 'Marta S.', tiempoJuego: 0, consumos: [{ id: 3, producto: 'Nachos con Queso', precio: 75, cantidad: 1 }], inicio: Date.now() - 40*60000 }
  ]);
  const [fila, setFila] = useState([
    { id: 1, cliente: 'Roberto G.', contacto: '55-1234-5678', tipo: 'Pool 9B', personas: 4, registro: Date.now() - 20*60000 },
    { id: 2, cliente: 'Diana L.', contacto: '55-8765-4321', tipo: 'Snooker', personas: 2, registro: Date.now() - 5*60000 },
  ]);
  const tick = useLiveTick();

  // ── Memorización de Consumos por Mesa (Sugerencia 1) ──
  const consumosPorMesa = useMemo(() => {
    const map = {};
    mesas.forEach(m => {
      const cuentaAsociada = cuentasActivas.find(c => 
        c.cliente && (
          (m.cliente && c.cliente.toLowerCase() === m.cliente.toLowerCase()) || 
          c.cliente.toLowerCase() === `mesa ${m.id}`
        )
      );
      map[m.id] = cuentaAsociada 
        ? cuentaAsociada.consumos.reduce((s, item) => s + item.precio * item.cantidad, 0)
        : 0;
    });
    return map;
  }, [mesas, cuentasActivas]);

  // ── Helper para setDoc con reintentos y exponencial backoff ──
  const setDocWithRetry = async (docRef, data, retries = 5, delay = 500) => {
    for (let i = 0; i < retries; i++) {
      try {
        await setDoc(docRef, data);
        return;
      } catch (err) {
        console.warn(`Intento ${i + 1} de setDoc fallido. Reintentando en ${delay}ms...`, err);
        if (i === retries - 1) throw err;
        await new Promise(res => setTimeout(res, delay));
        delay *= 2;
      }
    }
  };

  // ── PERSISTENCIA LOCAL DE ESTADO OFUSCADA (SUGERENCIA 1) ─────────────────
  useEffect(() => {
    if (typeof window !== 'undefined') {
      try {
        const savedMesas = localStorage.getItem('yoy_billar_mesas');
        if (savedMesas) setMesas(deobfuscate(savedMesas) || INIT_MESAS);

        const savedCuentas = localStorage.getItem('yoy_billar_cuentas');
        if (savedCuentas) setCuentasActivas(deobfuscate(savedCuentas) || []);

        const savedFila = localStorage.getItem('yoy_billar_fila');
        if (savedFila) setFila(deobfuscate(savedFila) || []);

        const savedBitacora = localStorage.getItem('yoy_billar_bitacora');
        if (savedBitacora) setBitacora(deobfuscate(savedBitacora) || []);
      } catch (err) {
        console.error("Error al cargar datos desde localStorage:", err);
      }
    }
  }, []);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem('yoy_billar_mesas', obfuscate(mesas));
        // Sincronizar estado general de mesas con Firestore para clientes con reintentos
        setDocWithRetry(doc(db, 'config', 'mesas_estado'), {
          mesas: mesas,
          updatedAt: serverTimestamp()
        }).catch(err => console.error("Error definitivo al sincronizar mesas con Firestore:", err));
      } catch (err) {
        console.error("Error al guardar mesas:", err);
      }
    }
  }, [mesas]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem('yoy_billar_cuentas', obfuscate(cuentasActivas));
        setDocWithRetry(doc(db, 'config', 'cuentas_estado'), {
          cuentas: cuentasActivas,
          updatedAt: serverTimestamp()
        }).catch(err => console.error("Error al sincronizar cuentas con Firestore:", err));
      } catch (err) {
        console.error("Error al guardar cuentas:", err);
      }
    }
  }, [cuentasActivas]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem('yoy_billar_fila', obfuscate(fila));
      } catch (err) {
        console.error("Error al guardar fila:", err);
      }
    }
  }, [fila]);

  // ── REGISTRO DE AUDITORÍA Y BITÁCORA OFUSCADA (SUGERENCIA 1 Y 2) ──────────
  const registrarEvento = (accion, detalle, monto = 0) => {
    const nuevoEvento = {
      id: Date.now(),
      fecha: new Date().toISOString(),
      accion,
      detalle,
      monto,
      operador: 'Cajero Principal'
    };
    setBitacora(prev => {
      const act = [nuevoEvento, ...prev].slice(0, 100);
      try {
        localStorage.setItem('yoy_billar_bitacora', obfuscate(act));
      } catch (err) {
        console.error("Error al guardar bitácora:", err);
      }
      return act;
    });
  };

  const limpiarBitacora = () => {
    setBitacora([]);
    try {
      localStorage.removeItem('yoy_billar_bitacora');
    } catch (err) {
      console.error(err);
    }
    showToast('Bitácora limpiada correctamente.', 'info');
  };

  const totales = {
    libres:    mesas.filter(m => m.estado === 'libre').length,
    ocupadas:  mesas.filter(m => m.estado === 'ocupada').length,
    reservadas:mesas.filter(m => m.estado === 'reservada').length,
    manten:    mesas.filter(m => m.estado === 'manten').length,
  };

  const mesasFiltradas = filtro === 'todas' ? mesas : mesas.filter(m => m.estado === filtro);

  const abrirMesa = (mesa) => {
    if (mesa.estado === 'ocupada') { setModalCerrar(mesa); return; }
    if (mesa.estado === 'manten') { showToast('Mesa en mantenimiento, no disponible.', 'warning'); return; }
    setModalAbrir(mesa);
  };

  const confirmarAbrirMesa = (mesaId, { cliente, esSocio, rentarTaco, rentarBolas, rentarTiza }) => {
    setMesas(prev => prev.map(m => m.id === mesaId
      ? { ...m, estado: 'ocupada', cliente, inicio: Date.now(), socios: esSocio, rentarTaco, rentarBolas, rentarTiza, clienteUid: '' }
      : m
    ));
    
    if (modalAbrir && modalAbrir.filaId) {
      setFila(prev => prev.filter(f => f.id !== modalAbrir.filaId));
    }
    
    setModalAbrir(null);
    showToast(`Mesa ${mesaId} iniciada para ${cliente}`, 'success');
    registrarEvento('Apertura', `Mesa ${mesaId} abierta para ${cliente}${esSocio ? ' (Socio)' : ''} ${rentarTaco ? '[Taco Premium] ' : ''}${rentarBolas ? '[Bolas Aramith] ' : ''}${rentarTiza ? '[Tiza Kamui]' : ''}`);
  };

  const registrarNuevaMesa = (nueva) => {
    const mesaId = parseInt(nueva.id);
    if (mesas.some(m => m.id === mesaId)) {
      showToast(`La mesa ${mesaId} ya está registrada.`, 'warning');
      return;
    }
    setMesas(prev => [
      ...prev,
      {
        id: mesaId,
        nombre: `Mesa ${mesaId}`,
        tipo: nueva.tipo,
        estado: 'libre',
        cliente: null,
        inicio: null,
        tarifa: parseFloat(nueva.tarifa),
        socios: false,
        clienteUid: ''
      }
    ]);
    setModalNuevaMesa(false);
    showToast(`Mesa ${mesaId} registrada con éxito.`, 'success');
    registrarEvento('Nueva Mesa', `Mesa ${mesaId} (${nueva.tipo}) registrada en el catálogo con tarifa $${nueva.tarifa}/hr`);
  };

  const asignarClienteDeFila = (clienteEspera) => {
    let table = mesas.find(m => m.estado === 'libre' && m.tipo === clienteEspera.tipo);
    if (!table) {
      table = mesas.find(m => m.estado === 'libre');
    }
    
    if (table) {
      setModalFila(false);
      setModalAbrir({
        ...table,
        cliente: clienteEspera.cliente,
        esSocio: false,
        filaId: clienteEspera.id
      });
    } else {
      showToast('No hay mesas libres disponibles.', 'warning');
    }
  };

  const confirmarCambioMesa = (origenId, destinoId) => {
    const mesaOrigen = mesas.find(m => m.id === origenId);
    const mesaDestino = mesas.find(m => m.id === destinoId);

    if (!mesaOrigen || !mesaDestino) {
      showToast('Error en la transferencia de mesas.', 'danger');
      return;
    }

    setMesas(prev => prev.map(m => {
      if (m.id === destinoId) {
        return {
          ...m,
          estado: 'ocupada',
          cliente: mesaOrigen.cliente,
          inicio: mesaOrigen.inicio,
          socios: mesaOrigen.socios,
          filaId: mesaOrigen.filaId,
          clienteUid: mesaOrigen.clienteUid || ''
        };
      }
      if (m.id === origenId) {
        return {
          ...m,
          estado: 'libre',
          cliente: null,
          inicio: null,
          socios: false,
          filaId: null,
          clienteUid: ''
        };
      }
      return m;
    }));

    setModalCambiarMesa(null);
    showToast(`Sesión de juego transferida con éxito de Mesa ${origenId} a Mesa ${destinoId} ✓`, 'success');
    registrarEvento('Transferencia', `Sesión de juego transferida de Mesa ${origenId} a Mesa ${destinoId} (Cliente: ${mesaOrigen.cliente})`);
  };

  const confirmarVincularCliente = (mesaId, nuevoNombre) => {
    const mesa = mesas.find(m => m.id === mesaId);
    const ant = mesa ? mesa.cliente : 'Ninguno';
    setMesas(prev => prev.map(m => m.id === mesaId
      ? { ...m, cliente: nuevoNombre }
      : m
    ));
    setModalVincular(null);
    showToast(`Cliente de Mesa ${mesaId} actualizado a ${nuevoNombre} ✓`, 'success');
    registrarEvento('Vincular Cliente', `Cliente en Mesa ${mesaId} cambiado de "${ant}" a "${nuevoNombre}"`);
  };

  const agregarSesionACuenta = ({ costo, cuentaId, nombreNuevo }) => {
    if (cuentaId) {
      setCuentasActivas(prev => prev.map(c => c.id === parseInt(cuentaId)
        ? { ...c, tiempoJuego: c.tiempoJuego + costo }
        : c
      ));
      const targetCuenta = cuentasActivas.find(c => c.id === parseInt(cuentaId));
      const clientName = targetCuenta ? targetCuenta.cliente : cuentaId;
      showToast(`Mesa cerrada. Costo de $${costo} MXN agregado a la cuenta del cliente.`, 'success');
      registrarEvento('Mesa a Cuenta', `Mesa ${modalCerrar.nombre} agregada a la cuenta de ${clientName}`, costo);
    } else {
      const nueva = {
        id: Date.now(),
        cliente: nombreNuevo,
        tiempoJuego: costo,
        consumos: [],
        inicio: Date.now()
      };
      setCuentasActivas(prev => [...prev, nueva]);
      showToast(`Mesa cerrada. Cuenta abierta para ${nombreNuevo} con $${costo} MXN de tiempo.`, 'success');
      registrarEvento('Mesa a Cuenta Nueva', `Mesa ${modalCerrar.nombre} agregada a una cuenta nueva para ${nombreNuevo}`, costo);
    }

    setMesas(prev => prev.map(m => m.id === modalCerrar.id
      ? { ...m, estado: 'libre', cliente: null, inicio: null, socios: false, clienteUid: '' }
      : m
    ));

    if (modalCerrar && modalCerrar.filaId) {
      setFila(prev => prev.filter(f => f.id !== modalCerrar.filaId));
    }

    setModalCerrar(null);
  };

  const imprimirTodosLosQRs = () => {
    const w = window.open('', '_blank');
    let htmlContent = `
      <html><head><title>Códigos QR - YoY IA Billar</title>
      <style>
        body { margin: 0; font-family: sans-serif; background: #fff; }
        .page {
          page-break-after: always;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          min-height: 100vh;
          padding: 40px;
          box-sizing: border-box;
          text-align: center;
        }
        .page:last-child { page-break-after: avoid; }
        h2 { color: #cd7f32; margin: 20px 0 8px; font-size: 26px; font-weight: 800; }
        p { color: #666; font-size: 14px; margin: 4px 0; }
        .qr-container {
          padding: 24px;
          border: 1px solid #eee;
          border-radius: 20px;
          background: #fff;
          display: inline-block;
          box-shadow: 0 4px 12px rgba(0,0,0,0.05);
        }
        .qr-placeholder { width: 200px; height: 200px; }
      </style>
      </head>
      <body>
    `;

    mesas.forEach(mesa => {
      htmlContent += `
        <div class="page">
          <div class="qr-container">
            <div id="qr-${mesa.id}" class="qr-placeholder"></div>
          </div>
          <h2>${mesa.nombre || `Mesa ${mesa.id}`}</h2>
          <p>Escanea para ordenar y pedir asistencia</p>
          <p style="font-size: 11px; color: #999; margin-top: 10px;">yoy-ia-billar.vercel.app/mesa/${mesa.id}</p>
        </div>
      `;
    });

    htmlContent += `
      <script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script>
      <script>
        window.onload = () => {
          const mesasData = ${JSON.stringify(mesas.map(m => ({ id: m.id, url: `https://yoy-ia-billar.vercel.app/mesa/${m.id}` })))};
          mesasData.forEach(m => {
            new QRCode(document.getElementById('qr-' + m.id), {
              text: m.url,
              width: 200,
              height: 200,
              colorDark: "#0a0a0f",
              colorLight: "#ffffff",
              correctLevel: QRCode.CorrectLevel.H
            });
          });
          setTimeout(() => {
            window.print();
          }, 500);
        };
      </script>
      </body></html>
    `;
    w.document.write(htmlContent);
    w.document.close();
  };

  const confirmarCerrarMesa = (mesaId, { costo, metodo, tiempo, referencia, pagaCon, cambio, fotoAdjunta }) => {
    const mesa = mesas.find(m => m.id === mesaId);
    const clientName = mesa ? mesa.cliente : 'Público';

    // Buscar la cuenta asociada para auditar el detalle de consumos al cerrar (Sugerencia 2)
    const cuentaAsociada = cuentasActivas.find(c => 
      c.cliente && (
        (mesa && mesa.cliente && c.cliente.toLowerCase() === mesa.cliente.toLowerCase()) || 
        c.cliente.toLowerCase() === `mesa ${mesaId}`
      )
    );

    if (cuentaAsociada && cuentaAsociada.consumos && cuentaAsociada.consumos.length > 0) {
      addDoc(collection(db, 'historial_stock'), {
        fecha: serverTimestamp(),
        mesaId: mesaId,
        cliente: clientName,
        items: cuentaAsociada.consumos.map(item => ({
          productoId: item.id || 0,
          nombre: item.producto,
          precio: item.precio,
          cantidad: item.cantidad,
          subtotal: item.precio * item.cantidad
        })),
        total: costo,
        tipo: 'cierre_mesa_liquidada',
        tiempoJuego: tiempo ? (tiempo / 3600000).toFixed(2) + ' hrs' : '0 hrs'
      }).catch(err => console.error("Error al registrar auditoría de cierre de mesa:", err));
    }

    // Eliminar la cuenta asociada de cuentasActivas ya que ha sido liquidada
    setCuentasActivas(prev => prev.filter(c => 
      !(c.cliente && (
        (mesa && mesa.cliente && c.cliente.toLowerCase() === mesa.cliente.toLowerCase()) || 
        c.cliente.toLowerCase() === `mesa ${mesaId}`
      ))
    ));

    // Desactivar/atender/finalizar todas las alertas y consumos de la mesa en Firestore en lote (batch)
    const qAlerts = query(
      collection(db, 'mesa_pedidos'),
      where('mesaId', '==', mesaId),
      where('estado', 'in', ['pendiente', 'listo', 'en_camino', 'entregado'])
    );
    getDocs(qAlerts).then(snap => {
      if (!snap.empty) {
        const batch = writeBatch(db);
        snap.docs.forEach(d => {
          const docData = d.data();
          const nuevoEstado = docData.estado === 'entregado' ? 'finalizado' : 'atendido';
          batch.update(doc(db, 'mesa_pedidos', d.id), {
            estado: nuevoEstado,
            atendidoAt: serverTimestamp(),
            updatedAt: serverTimestamp()
          });
        });
        batch.commit().catch(err => console.error("Error al confirmar lote de alertas atendidas/finalizadas:", err));
      }
    }).catch(err => console.error("Error al buscar alertas y pedidos de mesa:", err));

    setMesas(prev => prev.map(m => m.id === mesaId
      ? { ...m, estado: 'libre', cliente: null, inicio: null, socios: false, clienteUid: '' }
      : m
    ));
    setModalCerrar(null);
    if (costo > 0) {
      let metodoLabel = metodo;
      let detalleExtra = '';
      if (metodo === 'efectivo') {
        metodoLabel = 'Efectivo';
        detalleExtra = ` | Pagó con: $${pagaCon} | Cambio: $${cambio}`;
      } else if (metodo === 'transferencia') {
        metodoLabel = 'Transferencia';
        detalleExtra = ` | Ref: ${referencia}${fotoAdjunta ? ' (Con foto comprobante)' : ' (Sin foto)'}`;
      } else if (metodo === 'qr') {
        metodoLabel = 'Código QR';
        detalleExtra = ` | Ref QR: ${referencia}`;
      } else if (metodo === 'tarjeta') {
        metodoLabel = 'Tarjeta';
      }
      showToast(`Cobrado $${costo} MXN por ${metodoLabel} ✓`, 'success');
      registrarEvento('Cierre Directo', `Mesa ${mesaId} liquidada y cerrada por ${clientName} ($${costo} MXN por ${metodoLabel}${detalleExtra})`, costo);
    } else {
      showToast(`Mesa cerrada (Socio sin cargo)`, 'info');
      registrarEvento('Cierre Directo', `Mesa ${mesaId} cerrada (Socio sin cargo: ${clientName})`);
    }
  };

  const ingresosActivos = mesas
    .filter(m => m.estado === 'ocupada')
    .reduce((sum, m) => {
      const consumosTotal = consumosPorMesa[m.id] || 0;
      const costoTiempo = m.socios ? 0 : calcCosto(m);
      return sum + costoTiempo + consumosTotal;
    }, 0);

  return (
    <div style={{ minHeight: isFullscreen ? '100vh' : 'auto', padding: isFullscreen ? '20px' : '0', background: isFullscreen ? 'var(--bg-main)' : 'transparent' }}>
      <div className="page-header">
        <div>
          <h1 className="page-title gradient-bronze">Control de Mesas</h1>
          <p className="page-subtitle">Gestión en tiempo real · {mesas.length} mesas registradas · {isFullscreen ? 'Modo Kiosco Activo' : 'Modo Estándar'}</p>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          {/* Botón de Modo Kiosco */}
          <button className="btn btn-secondary btn-sm" onClick={toggleFullscreen} title="Activar Modo Kiosco">
            <i className={isFullscreen ? 'ri-fullscreen-exit-fill' : 'ri-fullscreen-fill'} style={{ marginRight: 4 }} />
            {isFullscreen ? 'Salir Kiosco' : 'Modo Kiosco'}
          </button>
          <button className="btn btn-primary btn-sm" onClick={() => setMostrarCobroManual(true)}>
            <i className="ri-add-circle-line" /> Cobro Manual
          </button>
          <button className="btn btn-secondary btn-sm" onClick={() => setModalFila(true)}>
            <i className="ri-qr-code-line" /> Fila Virtual
            {fila.length > 0 && (
              <span className="badge badge-bronze" style={{ marginLeft: 6, padding: '2px 6px', fontSize: 9 }}>
                {fila.length}
              </span>
            )}
          </button>
          <button className="btn btn-secondary btn-sm" style={{ color: 'var(--bronze-light)', borderColor: 'var(--border-bronze)' }} onClick={() => setModalComanda(true)}>
            <i className="ri-cup-line" /> Comanda
          </button>
          <button className="btn btn-secondary btn-sm" style={{ color: 'var(--bronze-light)', borderColor: 'var(--border-bronze)' }} onClick={() => setModalAbrirCuenta(true)}>
            <i className="ri-folder-add-line" /> Abrir Cuenta
          </button>
          <button className="btn btn-primary btn-sm" onClick={() => setModalNuevaMesa(true)}>
            <i className="ri-add-line" /> Nueva Mesa
          </button>
        </div>
      </div>

      {/* Stats rápidas */}
      <div className="stat-grid" style={{ marginBottom: 24 }}>
        {[
          { label: 'Libres', value: totales.libres, icon: 'ri-checkbox-blank-circle-line', color: 'icon-success', accent: 'var(--success)' },
          { label: 'Ocupadas', value: totales.ocupadas, icon: 'ri-record-circle-line', color: 'icon-danger', accent: 'var(--danger)' },
          { label: 'Reservadas', value: totales.reservadas, icon: 'ri-bookmark-fill', color: 'icon-bronze', accent: 'var(--bronze-light)' },
          { label: 'Cuentas Activas', value: `${cuentasActivas.length} cls`, icon: 'ri-folder-open-line', color: 'icon-bronze', accent: 'var(--bronze-light)', onClick: () => setModalCuentas(true) },
          { label: 'Ingresos en curso', value: `$${ingresosActivos}`, icon: 'ri-coins-line', color: 'icon-blue', accent: 'var(--blue-light)' },
        ].map((s, i) => (
          <div key={i} className="stat-card" style={{ cursor: s.onClick ? 'pointer' : 'default' }} onClick={s.onClick}>
            <div className={`stat-card-icon ${s.color}`}><i className={s.icon} /></div>
            <div className="stat-card-value" style={{ color: s.accent, fontSize: 26 }}>{s.value}</div>
            <div className="stat-card-label">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Alerta de Inventario Crítico IA (Sugerencia 2) */}
      {productosBajos.length > 0 && (
        <div style={{
          background: 'rgba(205,127,50,0.06)',
          border: '1px solid rgba(205,127,50,0.25)',
          borderRadius: 12,
          padding: '12px 16px',
          marginBottom: 20,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 12,
          animation: 'slideUp 0.3s ease'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <i className="ri-robot-line" style={{ fontSize: 18, color: 'var(--bronze-light)' }} />
            <div style={{ fontSize: 12 }}>
              <span style={{ fontWeight: 700, color: 'var(--bronze-light)' }}>Asistente IA de Stock:</span>{' '}
              Se requiere reorden en {productosBajos.length} productos ({productosBajos.map(p=>p.nombre || p.producto).join(', ')}).
            </div>
          </div>
          <button
            className="btn btn-secondary btn-sm"
            style={{ fontSize: 10, padding: '4px 10px', color: 'var(--bronze-light)', borderColor: 'var(--border-bronze)' }}
            onClick={() => showToast('Diríjase al panel de Inventario IA para lanzar la orden de compra.', 'info')}
          >
            Lanzar Reorden IA
          </button>
        </div>
      )}

      {/* Filtros */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {[
            { id: 'todas', label: 'Todas' },
            { id: 'libre', label: 'Libres' },
            { id: 'ocupada', label: 'Ocupadas' },
            { id: 'reservada', label: 'Reservadas' },
            { id: 'manten', label: 'Mantenimiento' },
          ].map(f => (
            <button
              key={f.id}
              onClick={() => setFiltro(f.id)}
              className={`btn btn-sm ${filtro === f.id ? 'btn-primary' : 'btn-secondary'}`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <button
          onClick={imprimirTodosLosQRs}
          className="btn btn-secondary btn-sm"
          style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--bronze-light)', borderColor: 'var(--border-bronze)' }}
        >
          <i className="ri-qr-code-line" /> Imprimir todos los QRs
        </button>
      </div>

      {/* Grid de mesas */}
      <div className="mesa-grid">
        {mesasFiltradas.map(mesa => {
          const elapsed = mesa.inicio ? Date.now() - mesa.inicio : 0;
          const costo = calcCosto(mesa);
          const consumosTotal = consumosPorMesa[mesa.id] || 0;
          const totalMesa = costo + consumosTotal;
          const cfg = ESTADO_CONFIG[mesa.estado];
          const alertsForMesa = alertasMesas[mesa.id] || [];
          const hasAlert = alertsForMesa.length > 0;

          return (
              <div
                key={mesa.id}
                className={`mesa-card ${mesa.estado}`}
                onClick={() => abrirMesa(mesa)}
                style={hasAlert ? {
                  boxShadow: '0 0 16px rgba(239, 68, 68, 0.3)',
                  border: '1px solid rgba(239, 68, 68, 0.4)',
                  animation: 'pulseBorder 2.5s infinite ease-in-out'
                } : {}}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                  <div className="mesa-number">{mesa.id}</div>
                  <span className={`mesa-status-badge ${mesa.estado}`}>
                    <span className={mesa.estado === 'ocupada' ? 'dot-live' : ''} style={{ width: 6, height: 6, borderRadius: '50%', background: cfg.color, flexShrink: 0 }} />
                    {cfg.label}
                  </span>
                </div>

                <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6 }}>
                  {mesa.tipo}
                </div>

                {mesa.estado === 'ocupada' && (
                  <>
                    <div className="mesa-timer">{formatTime(elapsed)}</div>
                    <div className="mesa-client">
                      <i className="ri-user-line" style={{ fontSize: 10, marginRight: 4 }} />
                      {mesa.cliente}
                      {mesa.socios && <span className="badge badge-bronze" style={{ marginLeft: 6, fontSize: 8 }}>Socio</span>}
                    </div>
                    <div className="mesa-rate" style={{ marginTop: 6, fontSize: 13, fontWeight: 700, color: 'var(--bronze-light)' }}>
                      {mesa.socios && consumosTotal === 0 ? 'Sin cargo' : `$${mesa.socios ? consumosTotal : totalMesa} MXN`}
                      {consumosTotal > 0 && (
                        <span style={{ fontSize: 9, color: 'var(--text-muted)', display: 'block', fontWeight: 'normal', marginTop: 2 }}>
                          (Tiempo: ${costo} + Consumo: ${consumosTotal})
                        </span>
                      )}
                    </div>
                  </>
                )}

                {mesa.estado === 'reservada' && (
                  <div className="mesa-client" style={{ marginTop: 6 }}>
                    <i className="ri-bookmark-line" style={{ fontSize: 10, marginRight: 4 }} />
                    {mesa.cliente}
                  </div>
                )}

                {mesa.estado === 'manten' && (
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6, display: 'flex', alignItems: 'center', gap: 4 }}>
                    <i className="ri-tools-line" /> En reparación
                  </div>
                )}

                {/* Contenedor de Alertas de Cliente */}
                {alertsForMesa.length > 0 && (
                  <div style={{
                    marginTop: 10,
                    marginBottom: 8,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 6,
                    background: 'rgba(239,68,68,0.06)',
                    border: '1px solid rgba(239,68,68,0.15)',
                    borderRadius: 10,
                    padding: '8px 10px',
                    animation: 'fadeIn 0.2s ease-in-out'
                  }} onClick={e => e.stopPropagation()}>
                    {alertsForMesa.map(alerta => {
                      let icon = '🔔';
                      let label = alerta.etiqueta || 'Asistencia';
                      let badgeColor = 'var(--warning)';
                      if (alerta.tipo === 'cuenta') {
                        icon = '💳';
                        label = `Cuenta: $${alerta.totalAcumulado || ''}`;
                        badgeColor = 'var(--success)';
                      } else if (alerta.tipo === 'asistencia') {
                        icon = alerta.icono || '🙋';
                        badgeColor = 'var(--danger)';
                      } else if (alerta.tipo === 'pedido') {
                        icon = '🥤';
                        label = `Pedido (${alerta.items?.reduce((s,i)=>s+i.cantidad,0) || 0} pz)`;
                        badgeColor = 'var(--info)';
                      }

                      return (
                        <div key={alerta.id} style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          fontSize: 11,
                          color: '#fff',
                          fontWeight: 600,
                          gap: 6
                        }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            <span style={{ fontSize: 13, animation: alerta.tipo !== 'pedido' ? 'pulse 1.2s infinite' : 'none' }}>{icon}</span>
                            <span style={{ color: badgeColor }}>{label}</span>
                          </div>
                          {alerta.tipo === 'pedido' ? (
                            <button
                              onClick={(e) => { e.stopPropagation(); cargarPedidoACuenta(mesa.id, alerta); }}
                              title="Cargar a la cuenta de la mesa y descontar inventario"
                              style={{
                                background: 'rgba(59,130,246,0.15)',
                                border: '1px solid rgba(59,130,246,0.35)',
                                color: 'var(--info)',
                                borderRadius: 4,
                                padding: '2px 6px',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                cursor: 'pointer',
                                fontSize: 10,
                                fontWeight: 700,
                                transition: 'all 0.15s'
                              }}
                              onMouseEnter={e => { e.currentTarget.style.background = 'rgba(59,130,246,0.25)'; }}
                              onMouseLeave={e => { e.currentTarget.style.background = 'rgba(59,130,246,0.15)'; }}
                            >
                              Cargar
                            </button>
                          ) : (
                            <button
                              onClick={(e) => marcarAlertaAtendida(alerta.id, e)}
                              title="Marcar como atendido"
                              style={{
                                background: 'rgba(34,197,94,0.12)',
                                border: '1px solid rgba(34,197,94,0.3)',
                                color: 'var(--success)',
                                borderRadius: 4,
                                width: 20,
                                height: 20,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                cursor: 'pointer',
                                fontSize: 10,
                                transition: 'all 0.15s'
                              }}
                              onMouseEnter={e => { e.currentTarget.style.background = 'rgba(34,197,94,0.25)'; }}
                              onMouseLeave={e => { e.currentTarget.style.background = 'rgba(34,197,94,0.12)'; }}
                            >
                              ✓
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

              <div className="mesa-actions" onClick={e => e.stopPropagation()}>
                {mesa.estado === 'libre' && (
                  <button className="btn btn-success btn-sm" style={{ flex: 1 }} onClick={() => abrirMesa(mesa)}>
                    <i className="ri-play-fill" /> Abrir
                  </button>
                )}
                {mesa.estado === 'ocupada' && (
                  <>
                    <button className="btn btn-danger btn-sm" style={{ flex: 2 }} onClick={() => setModalCerrar(mesa)}>
                      <i className="ri-stop-fill" /> Cerrar
                    </button>
                    <button
                      className="btn btn-secondary btn-sm btn-icon"
                      title="Cambiar de Mesa"
                      onClick={() => setModalCambiarMesa(mesa)}
                      style={{ color: 'var(--bronze-light)' }}
                    >
                      <i className="ri-swap-line" />
                    </button>
                    <button
                      className="btn btn-secondary btn-sm btn-icon"
                      title="Vincular Cuenta / Agregar Cliente"
                      onClick={() => setModalVincular(mesa)}
                    >
                      <i className="ri-user-add-line" />
                    </button>
                  </>
                )}
                {mesa.estado === 'reservada' && (
                  <button className="btn btn-primary btn-sm" style={{ flex: 1 }} onClick={() => abrirMesa(mesa)}>
                    <i className="ri-play-fill" /> Activar
                  </button>
                )}
                {mesa.estado !== 'ocupada' && (
                  <button
                    className="btn btn-secondary btn-sm btn-icon"
                    title="Ver QR de Mesa"
                    onClick={() => {
                      if (!mesa.id || isNaN(parseInt(mesa.id)) || parseInt(mesa.id) <= 0) {
                        showToast("Error: La mesa no tiene un identificador numérico válido mayor a 0. Configura el ID primero.", "danger");
                        return;
                      }
                      setModalQR(mesa);
                    }}
                    style={{ color: 'var(--bronze-light)' }}
                  >
                    <i className="ri-qr-code-line" />
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Modales */}

      {/* ── MODAL QR DE MESA ─────────────────────────── */}
      {modalQR && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setModalQR(null)}>
          <div className="modal" style={{ maxWidth: 380, textAlign: 'center' }}>
            <div className="modal-header">
              <span className="modal-title"><i className="ri-qr-code-line" style={{ marginRight: 8 }} />QR — {modalQR.nombre}</span>
              <button onClick={() => setModalQR(null)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 20, cursor: 'pointer' }}><i className="ri-close-line" /></button>
            </div>
            <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20 }}>
              {/* QR Code */}
              <div id={`qr-mesa-${modalQR.id}`} style={{ background: '#fff', padding: 20, borderRadius: 16, display: 'inline-block' }}>
                <QRCodeSVG
                  value={`https://yoy-ia-billar.vercel.app/mesa/${modalQR.id}`}
                  size={200}
                  bgColor="#ffffff"
                  fgColor="#0a0a0f"
                  level="H"
                  includeMargin={false}
                />
              </div>
              {/* Info */}
              <div>
                <div style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 800, color: 'var(--bronze-light)', marginBottom: 4 }}>{modalQR.nombre}</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', wordBreak: 'break-all' }}>yoy-ia-billar.vercel.app/mesa/{modalQR.id}</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>{modalQR.tipo} · Tarifa: ${modalQR.tarifa}/hr</div>
              </div>
              {/* Instrucciones */}
              <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 12, padding: 14, textAlign: 'left', width: '100%' }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--bronze-light)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                  <i className="ri-information-line" /> Instrucciones para el cliente
                </div>
                {['Escanea el código QR con tu celular', 'Ordena bebidas y alimentos desde tu mesa', 'Pide asistencia con un solo toque', 'Revisa tu cuenta en tiempo real'].map((txt, i) => (
                  <div key={i} style={{ fontSize: 12, color: 'var(--text-secondary)', padding: '3px 0', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ color: 'var(--bronze)', fontSize: 14 }}>›</span> {txt}
                  </div>
                ))}
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setModalQR(null)}>Cerrar</button>
              <button
                className="btn btn-primary"
                onClick={() => {
                  const qrEl = document.getElementById(`qr-mesa-${modalQR.id}`);
                  const w = window.open('', '_blank');
                  w.document.write(`
                    <html><head><title>QR Mesa ${modalQR.id}</title>
                    <style>body{margin:0;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;background:#fff;font-family:sans-serif;padding:20px;}
                    h2{color:#cd7f32;margin:16px 0 4px;font-size:22px;}
                    p{color:#666;font-size:13px;margin:2px 0;}
                    .qr-box{padding:20px;background:#fff;border:2px dashed #cd7f32;border-radius:12px;margin-bottom:12px;}
                    </style></head><body>
                    <div class="qr-box">${qrEl.innerHTML}</div>
                    <h2>${modalQR.nombre}</h2>
                    <p>Escanea para ordenar y pedir asistencia</p>
                    <p style="font-size:11px;color:#aaa;margin-top:8px">yoy-ia-billar.vercel.app/mesa/${modalQR.id}</p>
                    <script>window.onload=()=>window.print()</script>
                    </body></html>
                  `);
                  w.document.close();
                }}
              >
                <i className="ri-printer-line" /> Imprimir QR
              </button>
            </div>
          </div>
        </div>
      )}
      {modalAbrir && (
        <ModalAbrirMesa
          mesa={modalAbrir}
          onClose={() => setModalAbrir(null)}
          onConfirm={(data) => confirmarAbrirMesa(modalAbrir.id, data)}
        />
      )}
      {modalCerrar && (
        <ModalCerrarMesa
          mesa={modalCerrar}
          cuentasActivas={cuentasActivas}
          onClose={() => setModalCerrar(null)}
          onCerrar={(data) => confirmarCerrarMesa(modalCerrar.id, data)}
          onAgregarACuenta={agregarSesionACuenta}
        />
      )}
      {modalNuevaMesa && (
        <ModalNuevaMesa
          mesas={mesas}
          onClose={() => setModalNuevaMesa(false)}
          onConfirm={registrarNuevaMesa}
        />
      )}
      {modalFila && (
        <ModalFilaVirtual
          fila={fila}
          setFila={setFila}
          mesas={mesas}
          onAssign={asignarClienteDeFila}
          onClose={() => setModalFila(false)}
          showToast={showToast}
        />
      )}
      {modalCuentas && (
        <ModalCuentasActivas
          cuentas={cuentasActivas}
          setCuentas={setCuentasActivas}
          onClose={() => setModalCuentas(false)}
          showToast={showToast}
          registrarEvento={registrarEvento}
        />
      )}
      {modalAbrirCuenta && (
        <ModalAbrirCuentaDirecta
          cuentas={cuentasActivas}
          setCuentas={setCuentasActivas}
          onClose={() => setModalAbrirCuenta(false)}
          showToast={showToast}
          registrarEvento={registrarEvento}
        />
      )}
      {modalCambiarMesa && (
        <ModalCambiarMesa
          mesa={modalCambiarMesa}
          mesas={mesas}
          onClose={() => setModalCambiarMesa(null)}
          onConfirm={confirmarCambioMesa}
        />
      )}
      {modalVincular && (
        <ModalVincularCliente
          mesa={modalVincular}
          onClose={() => setModalVincular(null)}
          onConfirm={(nombre) => confirmarVincularCliente(modalVincular.id, nombre)}
        />
      )}
      {modalBitacora && (
        <ModalBitacora
          bitacora={bitacora}
          onClear={limpiarBitacora}
          onClose={() => setModalBitacora(false)}
        />
      )}
      {modalComanda && (
        <ModalRegistrarComanda
          mesas={mesas}
          setMesas={setMesas}
          cuentasActivas={cuentasActivas}
          setCuentasActivas={setCuentasActivas}
          onClose={() => setModalComanda(false)}
          showToast={showToast}
          registrarEvento={registrarEvento}
        />
      )}
      {mostrarCobroManual && (
        <ModalCobroManual
          nuevoMonto={nuevoMonto}
          setNuevoMonto={setNuevoMonto}
          nuevaDesc={nuevaDesc}
          setNuevaDesc={setNuevaDesc}
          nuevoMetodo={nuevoMetodo}
          setNuevoMetodo={setNuevoMetodo}
          pinAutorizacion={pinAutorizacion}
          setPinAutorizacion={setPinAutorizacion}
          onClose={() => {
            if (nuevoMonto || nuevaDesc) {
              sessionStorage.setItem('yoy_draft_cobro_manual', JSON.stringify({ nuevoMonto, nuevaDesc }));
            }
            setMostrarCobroManual(false);
            setNuevoMonto('');
            setNuevaDesc('');
            setPinAutorizacion('');
          }}
          onConfirm={registrarCobroManual}
        />
      )}
    </div>
  );
}

// ── MODAL NUEVA MESA ─────────────────────────────────────
function ModalNuevaMesa({ mesas, onClose, onConfirm }) {
  const defaultId = mesas.length > 0 ? Math.max(...mesas.map(m => m.id)) + 1 : 1;
  const [id, setId] = useState(defaultId);
  const [tipo, setTipo] = useState('Carambola 3B');
  const [tarifa, setTarifa] = useState(80);

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

        if (id !== defaultId || tipo !== 'Carambola 3B' || parseFloat(tarifa) !== 80) {
          if (!window.confirm('¿Deseas salir? Perderás los datos ingresados para la nueva mesa.')) {
            return;
          }
        }
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [id, defaultId, tipo, tarifa, onClose]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title"><i className="ri-add-line" style={{ marginRight: 8 }} />Registrar Nueva Mesa</span>
          <button onClick={onClose} className="btn-icon btn btn-secondary" style={{ background: 'none', border: 'none' }}>
            <i className="ri-close-line" style={{ fontSize: 20 }} />
          </button>
        </div>
        <div className="modal-body">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div className="form-group">
              <label className="form-label">Número de Mesa</label>
              <input type="number" className="form-input" value={id} onChange={e => setId(e.target.value)} />
            </div>

            <div className="form-group">
              <label className="form-label">Tipo de Mesa</label>
              <select className="form-select" value={tipo} onChange={e => setTipo(e.target.value)}>
                <option value="Carambola 3B">Carambola 3B</option>
                <option value="Pool 9B">Pool 9B</option>
                <option value="Snooker">Snooker</option>
              </select>
            </div>

            <div className="form-group">
              <label className="form-label">Tarifa por Hora (MXN)</label>
              <input type="number" className="form-input" value={tarifa} onChange={e => setTarifa(e.target.value)} />
            </div>
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary" onClick={() => onConfirm({ id, tipo, tarifa })}>
            Registrar Mesa
          </button>
        </div>
      </div>
    </div>
  );
}

// ── MODAL FILA VIRTUAL ───────────────────────────────────
function ModalFilaVirtual({ fila, setFila, mesas, onAssign, onClose, showToast }) {
  const [cliente, setCliente] = useState('');
  const [contacto, setContacto] = useState('');
  const [tipo, setTipo] = useState('Carambola 3B');
  const [personas, setPersonas] = useState(2);

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

        if (cliente || contacto) {
          if (!window.confirm('¿Deseas salir? Perderás los datos ingresados en la fila virtual.')) {
            return;
          }
        }
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [cliente, contacto, onClose]);

  const agregarFila = () => {
    if (!cliente) {
      showToast('Por favor ingrese el nombre del cliente.', 'warning');
      return;
    }
    const nuevo = {
      id: Date.now(),
      cliente,
      contacto: contacto || 'N/A',
      tipo,
      personas: parseInt(personas),
      registro: Date.now(),
    };
    setFila(prev => [...prev, nuevo]);
    setCliente('');
    setContacto('');
    showToast(`${cliente} agregado a la lista de espera.`, 'success');
  };

  const quitarFila = (id) => {
    setFila(prev => prev.filter(f => f.id !== id));
    showToast('Cliente retirado de la lista.', 'info');
  };

  const libres = mesas.filter(m => m.estado === 'libre');

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 620 }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">
            <i className="ri-qr-code-line" style={{ marginRight: 8, color: 'var(--bronze)' }} />
            Fila Virtual / Lista de Espera
          </span>
          <button onClick={onClose} className="btn-icon btn btn-secondary" style={{ background: 'none', border: 'none' }}>
            <i className="ri-close-line" style={{ fontSize: 20 }} />
          </button>
        </div>
        <div className="modal-body" style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 20 }}>
          {/* Panel Izquierdo: Lista */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <h4 style={{ fontSize: 12, textTransform: 'uppercase', color: 'var(--text-secondary)', letterSpacing: '0.05em' }}>Clientes en Espera ({fila.length})</h4>
            {fila.length === 0 ? (
              <p style={{ color: 'var(--text-muted)', fontSize: 13, textAlign: 'center', padding: '40px 0' }}>No hay clientes en espera.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxHeight: 320, overflowY: 'auto', paddingRight: 4 }}>
                {fila.map(f => {
                  const waitTime = Math.floor((Date.now() - f.registro) / 60000);
                  return (
                    <div key={f.id} style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 10, padding: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontWeight: 700, fontSize: 13, color: 'var(--text-primary)' }}>{f.cliente}</span>
                        <span style={{ fontSize: 10, color: 'var(--bronze-light)', fontWeight: 600 }}>Hace {waitTime} min</span>
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                        Mesa: <span style={{ color: 'var(--bronze-light)', fontWeight: 700 }}>{f.tipo}</span> · {f.personas} pers.
                      </div>
                      {f.contacto !== 'N/A' && (
                        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                          <i className="ri-phone-line" style={{ marginRight: 4 }} />{f.contacto}
                        </div>
                      )}
                      <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                        <button 
                          className="btn btn-success btn-sm" 
                          style={{ flex: 1, padding: '4px 8px', fontSize: 10 }}
                          onClick={() => {
                            if (libres.length === 0) {
                              showToast('No hay mesas disponibles en este momento.', 'warning');
                              return;
                            }
                            onAssign(f);
                          }}
                        >
                          Asignar Mesa
                        </button>
                        <button 
                          className="btn btn-danger btn-sm btn-icon sm" 
                          title="Quitar"
                          onClick={() => quitarFila(f.id)}
                        >
                          <i className="ri-delete-bin-line" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Panel Derecho: Formulario */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, borderLeft: '1px solid var(--border)', paddingLeft: 20 }}>
            <h4 style={{ fontSize: 12, textTransform: 'uppercase', color: 'var(--text-secondary)', letterSpacing: '0.05em' }}>Registrar en Espera</h4>
            <div className="form-group">
              <label className="form-label">Nombre del Cliente</label>
              <input className="form-input" placeholder="Nombre completo" value={cliente} onChange={e => setCliente(e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">Teléfono (opcional)</label>
              <input className="form-input" placeholder="Ej: 55-1234-5678" value={contacto} onChange={e => setContacto(e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">Tipo de Mesa</label>
              <select className="form-select" value={tipo} onChange={e => setTipo(e.target.value)}>
                <option value="Carambola 3B">Carambola 3B</option>
                <option value="Pool 9B">Pool 9B</option>
                <option value="Snooker">Snooker</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Personas</label>
              <input type="number" className="form-input" value={personas} onChange={e => setPersonas(e.target.value)} />
            </div>
            <button className="btn btn-primary" style={{ marginTop: 8 }} onClick={agregarFila}>
              Añadir a la Fila
            </button>
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cerrar</button>
        </div>
      </div>
    </div>
  );
}

// ── MODAL CUENTAS ACTIVAS ────────────────────────────────
function ModalCuentasActivas({ cuentas, setCuentas, onClose, showToast, registrarEvento }) {
  const [cuentaSel, setCuentaSel] = useState(null);
  const [prodSel, setProdSel] = useState('Corona');
  const [cantSel, setCantSel] = useState(1);
  const [metodoPago, setMetodoPago] = useState('efectivo');
  const [showCheckout, setShowCheckout] = useState(false);

  // Estados de cálculo de cambio, escáner QR y comprobante con foto
  const [pagaCon, setPagaCon] = useState('');
  const [referencia, setReferencia] = useState('');
  const [fotoComprobante, setFotoComprobante] = useState('');
  const [camaraActiva, setCamaraActiva] = useState(false);

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

        if (camaraActiva) {
          setCamaraActiva(false);
          return;
        }
        if (showCheckout) {
          if (pagaCon || referencia || fotoComprobante) {
            if (!window.confirm('¿Deseas cancelar el pago? Se perderán los datos ingresados.')) {
              return;
            }
          }
          setShowCheckout(false);
          return;
        }
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [camaraActiva, showCheckout, pagaCon, referencia, fotoComprobante, onClose]);

  // Limpiar campos al cambiar de método o cuenta
  useEffect(() => {
    setPagaCon('');
    setReferencia('');
    setFotoComprobante('');
    setCamaraActiva(false);
  }, [metodoPago, cuentaSel]);

  const PRODUCTOS = [
    { producto: 'Cerveza Corona', precio: 45 },
    { producto: 'Refresco Coca-Cola', precio: 30 },
    { producto: 'Nachos con Queso', precio: 75 },
    { producto: 'Papas Fritas', precio: 55 },
    { producto: 'Alitas de Pollo x10', precio: 120 },
    { producto: 'Café Americano', precio: 35 },
    { producto: 'Agua Embotellada', precio: 20 },
  ];

  const agregarConsumo = () => {
    if (!cuentaSel) return;
    const pInfo = PRODUCTOS.find(p => p.producto.includes(prodSel)) || PRODUCTOS[0];
    const nuevoConsumo = {
      id: Date.now(),
      producto: pInfo.producto,
      precio: pInfo.precio,
      cantidad: parseInt(cantSel)
    };

    setCuentas(prev => prev.map(c => {
      if (c.id === cuentaSel.id) {
        const actualizadas = {
          ...c,
          consumos: [...c.consumos, nuevoConsumo]
        };
        setCuentaSel(actualizadas);
        return actualizadas;
      }
      return c;
    }));

    showToast(`Agregado ${cantSel}x ${pInfo.producto} ✓`, 'success');
    if (registrarEvento) {
      registrarEvento('Agregar Consumo', `Agregado ${cantSel}x ${pInfo.producto} a la cuenta de ${cuentaSel.cliente} (Precio: $${pInfo.precio} c/u)`);
    }
  };

  const eliminarConsumo = (cId, itemId) => {
    const item = cuentaSel.consumos.find(i => i.id === itemId);
    const prodName = item ? item.producto : 'Producto';
    const cant = item ? item.cantidad : 1;
    setCuentas(prev => prev.map(c => {
      if (c.id === cId) {
        const actualizadas = {
          ...c,
          consumos: c.consumos.filter(i => i.id !== itemId)
        };
        setCuentaSel(actualizadas);
        return actualizadas;
      }
      return c;
    }));
    showToast('Consumo retirado de la cuenta.', 'info');
    if (registrarEvento) {
      registrarEvento('Eliminar Consumo', `Retirado ${cant}x ${prodName} de la cuenta de ${cuentaSel.cliente}`);
    }
  };

  const totalNeto = calcTotal(cuentaSel);
  const totalPagaCon = parseFloat(pagaCon) || 0;
  const cambio = totalPagaCon >= totalNeto ? totalPagaCon - totalNeto : 0;

  const liquidarCuentaDefinitiva = () => {
    if (!cuentaSel) return;
    const total = calcTotal(cuentaSel);
    setCuentas(prev => prev.filter(c => c.id !== cuentaSel.id));
    
    let metodoLabel = metodoPago;
    let detalleExtra = '';
    if (metodoPago === 'efectivo') {
      metodoLabel = 'Efectivo';
      detalleExtra = ` | Pagó con: $${totalPagaCon} | Cambio: $${cambio}`;
    } else if (metodoPago === 'transferencia') {
      metodoLabel = 'Transferencia';
      detalleExtra = ` | Ref: ${referencia}${fotoComprobante ? ' (Con foto comprobante)' : ' (Sin foto)'}`;
    } else if (metodoPago === 'qr') {
      metodoLabel = 'Código QR';
      detalleExtra = ` | Ref QR: ${referencia}`;
    } else if (metodoPago === 'tarjeta') {
      metodoLabel = 'Tarjeta';
    }

    showToast(`Cuenta de ${cuentaSel.cliente} liquidada con éxito por $${total} MXN ✓`, 'success');
    if (registrarEvento) {
      registrarEvento('Liquidar Cuenta', `Cuenta de ${cuentaSel.cliente} cobrada por completo ($${total} MXN por ${metodoLabel}${detalleExtra})`, total);
    }
    setCuentaSel(null);
    setShowCheckout(false);
  };

  const calcTotal = (c) => {
    if (!c) return 0;
    const tConsumos = c.consumos.reduce((s, i) => s + (i.precio * i.cantidad), 0);
    return c.tiempoJuego + tConsumos;
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: cuentaSel ? 760 : 500 }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">
            <i className="ri-folder-open-line" style={{ marginRight: 8, color: 'var(--bronze-light)' }} />
            Cuentas Activas de Clientes
          </span>
          <button onClick={onClose} className="btn-icon btn btn-secondary" style={{ background: 'none', border: 'none' }}>
            <i className="ri-close-line" style={{ fontSize: 20 }} />
          </button>
        </div>
        <div className="modal-body" style={{ display: 'grid', gridTemplateColumns: cuentaSel ? '1.1fr 1.3fr' : '1fr', gap: 20 }}>
          {/* Panel Izquierdo: Lista de cuentas abiertas */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <h4 style={{ fontSize: 12, textTransform: 'uppercase', color: 'var(--text-secondary)' }}>Cuentas Abiertas</h4>
            {cuentas.length === 0 ? (
              <p style={{ color: 'var(--text-muted)', fontSize: 13, textAlign: 'center', padding: '40px 0' }}>No hay cuentas pendientes.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 380, overflowY: 'auto' }}>
                {cuentas.map(c => (
                  <div
                    key={c.id}
                    onClick={() => { setCuentaSel(c); setShowCheckout(false); }}
                    style={{
                      background: cuentaSel?.id === c.id ? 'var(--bronze-subtle)' : 'var(--bg-elevated)',
                      border: `1px solid ${cuentaSel?.id === c.id ? 'var(--border-bronze)' : 'var(--border)'}`,
                      borderRadius: 10, padding: 12, cursor: 'pointer', transition: 'all 0.15s'
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: 13 }}>
                      <span>{c.cliente}</span>
                      <span style={{ color: 'var(--bronze-light)' }}>${calcTotal(c)} MXN</span>
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 4, display: 'flex', justifyContent: 'space-between' }}>
                      <span>Juego: ${c.tiempoJuego} MXN</span>
                      <span>{c.consumos.length} consumos</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Panel Derecho: Detalle de la cuenta seleccionada */}
          {cuentaSel && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14, borderLeft: '1px solid var(--border)', paddingLeft: 20 }}>
              {!showCheckout ? (
                <>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <h3 style={{ fontSize: 16, fontWeight: 800, color: 'var(--text-primary)' }}>Detalle de {cuentaSel.cliente}</h3>
                    <span className="badge badge-bronze">Cuenta Activa</span>
                  </div>

                  {/* Consumos */}
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 220, overflowY: 'auto' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-muted)', borderBottom: '1px solid var(--border)', pb: 4 }}>
                      <span>TIEMPO DE JUEGO ACUMULADO</span>
                      <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>${cuentaSel.tiempoJuego} MXN</span>
                    </div>

                    {cuentaSel.consumos.length === 0 ? (
                      <p style={{ color: 'var(--text-muted)', fontSize: 12, padding: '10px 0' }}>Sin consumos extras.</p>
                    ) : (
                      cuentaSel.consumos.map(item => (
                        <div key={item.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12 }}>
                          <span style={{ flex: 1 }}>{item.cantidad}x {item.producto} <span style={{ color: 'var(--text-muted)' }}>(${item.precio})</span></span>
                          <span style={{ fontWeight: 700, marginRight: 10 }}>${item.precio * item.cantidad} MXN</span>
                          <button
                            className="btn btn-secondary btn-icon sm"
                            onClick={() => eliminarConsumo(cuentaSel.id, item.id)}
                            style={{ padding: 4, height: 24, width: 24, border: 'none', background: 'none', color: 'var(--danger)' }}
                            title="Quitar"
                          >
                            <i className="ri-close-fill" />
                          </button>
                        </div>
                      ))
                    )}
                  </div>

                  {/* Agregar Consumo */}
                  <div style={{ background: 'var(--bg-elevated)', borderRadius: 10, padding: 10, display: 'grid', gridTemplateColumns: '2fr 1fr auto', gap: 6, alignItems: 'end' }}>
                    <div className="form-group" style={{ gap: 4 }}>
                      <label className="form-label" style={{ fontSize: 9 }}>Producto</label>
                      <select className="form-select" style={{ padding: '6px 8px', fontSize: 12 }} value={prodSel} onChange={e => setProdSel(e.target.value)}>
                        {PRODUCTOS.map((p, i) => <option key={i} value={p.producto}>{p.producto} (${p.precio})</option>)}
                      </select>
                    </div>
                    <div className="form-group" style={{ gap: 4 }}>
                      <label className="form-label" style={{ fontSize: 9 }}>Cant.</label>
                      <input type="number" className="form-input" style={{ padding: '6px 8px', fontSize: 12 }} value={cantSel} onChange={e => setCantSel(e.target.value)} min={1} />
                    </div>
                    <button className="btn btn-primary btn-sm" style={{ padding: '8px 12px' }} onClick={agregarConsumo}>
                      Agregar
                    </button>
                  </div>

                  {/* Footer detalle */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid var(--border)', pt: 10 }}>
                    <div>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>GRAN TOTAL ACUMULADO</div>
                      <div style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 900, color: 'var(--bronze-light)' }}>${calcTotal(cuentaSel)} MXN</div>
                    </div>
                    <button className="btn btn-primary" onClick={() => setShowCheckout(true)} style={{ background: 'linear-gradient(135deg, var(--success), #2ed573)', color: '#0d0d0f' }}>
                      <i className="ri-money-dollar-box-line" /> Cobrar Cuenta
                    </button>
                  </div>
                </>
              ) : (
                /* Detalle Checkout */
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <button className="btn btn-secondary btn-icon sm" onClick={() => setShowCheckout(false)} style={{ border: 'none', background: 'none' }}>
                      <i className="ri-arrow-left-line" style={{ fontSize: 18 }} />
                    </button>
                    <h3 style={{ fontSize: 16, fontWeight: 800 }}>Liquidar Cuenta: {cuentaSel.cliente}</h3>
                  </div>

                  <div style={{ background: 'var(--bg-elevated)', padding: 10, borderRadius: 10 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border)', pb: 4, fontSize: 11 }}>
                      <span>Tiempo de Juego</span>
                      <span>${cuentaSel.tiempoJuego} MXN</span>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 4, borderBottom: '1px solid var(--border)', pb: 4 }}>
                      {cuentaSel.consumos.map(item => (
                        <div key={item.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text-secondary)' }}>
                          <span>{item.cantidad}x {item.producto}</span>
                          <span>${item.precio * item.cantidad} MXN</span>
                        </div>
                      ))}
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', mt: 6, fontWeight: 900, fontSize: 14 }}>
                      <span>Total Neto</span>
                      <span style={{ color: 'var(--bronze-light)' }}>${totalNeto} MXN</span>
                    </div>
                  </div>

                  {/* Método */}
                  <div className="form-group" style={{ gap: 2 }}>
                    <label className="form-label" style={{ fontSize: 9 }}>Método de Pago</label>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 4 }}>
                      {[
                        { id: 'efectivo', label: 'Efectivo', icon: 'ri-money-dollar-circle-line' },
                        { id: 'transferencia', label: 'Transf.', icon: 'ri-bank-line' },
                        { id: 'qr', label: 'Pago QR', icon: 'ri-qr-code-line' },
                        { id: 'tarjeta', label: 'Tarjeta', icon: 'ri-bank-card-line' },
                      ].map(m => (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() => setMetodoPago(m.id)}
                          style={{
                            background: metodoPago === m.id ? 'var(--bronze-subtle)' : 'var(--bg-elevated)',
                            border: `1px solid ${metodoPago === m.id ? 'var(--border-bronze)' : 'var(--border)'}`,
                            borderRadius: 8, padding: '6px 2px', cursor: 'pointer',
                            color: metodoPago === m.id ? 'var(--bronze-light)' : 'var(--text-secondary)',
                            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
                            fontSize: 8, fontWeight: 600, transition: 'all 0.15s',
                          }}
                        >
                          <i className={m.icon} style={{ fontSize: 12 }} />
                          {m.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Sub-Paneles Condicionales de Liquidación en Cuenta */}
                  {metodoPago === 'efectivo' && totalNeto > 0 && (
                    <div style={{
                      background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 10, padding: 10, display: 'flex', flexDirection: 'column', gap: 6, animation: 'fadeIn 0.2s ease'
                    }}>
                      <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--bronze-light)' }}><i className="ri-coins-line" style={{ marginRight: 4 }} />CÁLCULO DE CAMBIO</div>
                      <div className="form-group" style={{ gap: 2 }}>
                        <label className="form-label" style={{ fontSize: 8 }}>Monto Recibido</label>
                        <input
                          type="number"
                          className="form-input"
                          style={{ padding: '6px 10px', fontSize: 12 }}
                          placeholder="0.00"
                          value={pagaCon}
                          onChange={e => setPagaCon(e.target.value)}
                        />
                        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 2 }}>
                          {quickBills.map((b, i) => (
                            <button
                              key={i}
                              type="button"
                              onClick={() => setPagaCon(b.toFixed(0))}
                              style={{
                                background: parseFloat(pagaCon) === b ? 'var(--bronze-subtle)' : 'var(--bg-hover)',
                                border: `1px solid ${parseFloat(pagaCon) === b ? 'var(--bronze)' : 'var(--border)'}`,
                                borderRadius: 4, padding: '2px 4px', fontSize: 8,
                                color: parseFloat(pagaCon) === b ? 'var(--bronze-light)' : 'var(--text-secondary)',
                                cursor: 'pointer'
                              }}
                            >
                              Exacto (${b})
                            </button>
                          ))}
                        </div>
                      </div>
                      {totalPagaCon > 0 && (
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid var(--border)', paddingTop: 6, marginTop: 2 }}>
                          <span style={{ fontSize: 10, color: 'var(--text-secondary)' }}>Cambio a Entregar:</span>
                          <span style={{ fontFamily: 'var(--font-display)', fontSize: 14, fontWeight: 900, color: totalPagaCon >= totalNeto ? 'var(--success)' : 'var(--danger)' }}>
                            {totalPagaCon >= totalNeto ? `$${cambio.toFixed(2)} MXN` : 'Monto insuficiente'}
                          </span>
                        </div>
                      )}
                    </div>
                  )}

                  {metodoPago === 'transferencia' && totalNeto > 0 && (
                    <div style={{
                      background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 10, padding: 10, display: 'flex', flexDirection: 'column', gap: 6, animation: 'fadeIn 0.2s ease'
                    }}>
                      <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--bronze-light)' }}><i className="ri-bank-line" style={{ marginRight: 4 }} />DATOS BANCARIOS (SPEI)</div>
                      <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px dashed var(--border-bronze)', borderRadius: 6, padding: '4px 8px', fontSize: 9, color: 'var(--text-secondary)', lineHeight: 1.3 }}>
                        <div><strong>Banco:</strong> STP / YoY Billar Club</div>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span><strong>CLABE:</strong> 123456789012345678</span>
                          <span onClick={() => { navigator.clipboard.writeText('123456789012345678'); showToast('CLABE copiada ✓', 'success'); }} style={{ color: 'var(--bronze-light)', cursor: 'pointer' }}><i className="ri-file-copy-line" /></span>
                        </div>
                      </div>
                      <div className="form-group" style={{ gap: 2 }}>
                        <label className="form-label" style={{ fontSize: 8 }}>Referencia de Transferencia</label>
                        <input
                          type="text"
                          className="form-input"
                          style={{ padding: '6px 10px', fontSize: 11 }}
                          placeholder="Ingrese ref / clave de rastreo"
                          value={referencia}
                          onChange={e => setReferencia(e.target.value)}
                        />
                      </div>
                      <div style={{ borderTop: '1px solid var(--border)', paddingTop: 6, marginTop: 2 }}>
                        <label className="form-label" style={{ fontSize: 8, marginBottom: 4, display: 'block' }}>Comprobante de Pago (Foto)</label>
                        {fotoComprobante ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(34,197,94,0.08)', padding: 4, borderRadius: 6, border: '1px solid rgba(34,197,94,0.2)' }}>
                            <div style={{ width: 32, height: 32, borderRadius: 4, overflow: 'hidden', border: '1px solid var(--border)', background: '#000' }}>
                              <img src={fotoComprobante} style={{ width: '100%', height: '100%', objectFit: 'cover' }} alt="Comp" />
                            </div>
                            <span style={{ fontSize: 9, color: 'var(--success)', fontWeight: 700, flex: 1 }}>Foto Cargada ✓</span>
                            <span onClick={() => setFotoComprobante('')} style={{ color: 'var(--danger)', cursor: 'pointer', padding: 4 }}><i className="ri-close-fill" /></span>
                          </div>
                        ) : (
                          <>
                            {camaraActiva ? (
                              <CameraHandler
                                mode="photo"
                                onCapture={({ photo }) => {
                                  setFotoComprobante(photo);
                                  setCamaraActiva(false);
                                }}
                              />
                            ) : (
                              <button
                                type="button"
                                onClick={() => setCamaraActiva(true)}
                                className="btn btn-secondary btn-sm"
                                style={{ width: '100%', fontSize: 9, textTransform: 'none', display: 'flex', justifyContent: 'center', gap: 4, padding: '4px 8px' }}
                              >
                                <i className="ri-camera-line" /> Tomar Foto del Comprobante
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  )}

                  {metodoPago === 'qr' && totalNeto > 0 && (
                    <div style={{
                      background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 10, padding: 10, display: 'flex', flexDirection: 'column', gap: 6, animation: 'fadeIn 0.2s ease'
                    }}>
                      <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--bronze-light)' }}><i className="ri-qr-code-line" style={{ marginRight: 4 }} />ESCANEO DE QR DE PAGO</div>
                      {referencia ? (
                        <div style={{ background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.2)', borderRadius: 6, padding: 6, textAlign: 'center' }}>
                          <div style={{ color: 'var(--success)', fontWeight: 800, fontSize: 10 }}>QR Escaneado ✓</div>
                          <div style={{ fontSize: 9, color: 'var(--text-secondary)', marginTop: 2 }}>ID Transacción: {referencia}</div>
                          <span onClick={() => setReferencia('')} style={{ fontSize: 8, color: 'var(--bronze-light)', cursor: 'pointer', textDecoration: 'underline', marginTop: 4, display: 'block' }}>Volver a Escanear</span>
                        </div>
                      ) : (
                        <CameraHandler
                          mode="qr"
                          onCapture={({ reference }) => {
                            setReferencia(reference);
                            showToast('Código QR leído ✓', 'success');
                          }}
                        />
                      )}
                    </div>
                  )}

                  <button 
                    className="btn btn-primary btn-lg" 
                    onClick={liquidarCuentaDefinitiva} 
                    disabled={isCheckoutDisabled}
                    style={{ 
                      background: isCheckoutDisabled ? 'var(--bg-hover)' : 'linear-gradient(135deg, var(--success), #2ed573)', 
                      color: isCheckoutDisabled ? 'var(--text-muted)' : '#0d0d0f', 
                      width: '100%', 
                      mt: 6,
                      cursor: isCheckoutDisabled ? 'not-allowed' : 'pointer'
                    }}
                  >
                    <i className="ri-checkbox-circle-line" /> Confirmar Cobro e Impresión
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cerrar</button>
        </div>
      </div>
    </div>
  );
}

// ── MODAL ABRIR CUENTA DIRECTA ───────────────────────────
function ModalAbrirCuentaDirecta({ cuentas, setCuentas, onClose, showToast, registrarEvento }) {
  const [cliente, setCliente] = useState('');

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

        if (cliente) {
          if (!window.confirm('¿Deseas salir? Perderás el nombre ingresado.')) {
            return;
          }
        }
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [cliente, onClose]);

  const handleCrear = () => {
    if (!cliente) {
      showToast('Por favor ingrese el nombre del cliente.', 'warning');
      return;
    }
    const nueva = {
      id: Date.now(),
      cliente,
      tiempoJuego: 0,
      consumos: [],
      inicio: Date.now()
    };
    setCuentas(prev => [...prev, nueva]);
    showToast(`Cuenta creada para ${cliente} ✓`, 'success');
    if (registrarEvento) {
      registrarEvento('Crear Cuenta', `Cuenta abierta manualmente para ${cliente}`);
    }
    onClose();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title"><i className="ri-folder-add-line" style={{ marginRight: 8 }} />Abrir Cuenta Activa</span>
          <button onClick={onClose} className="btn-icon btn btn-secondary" style={{ background: 'none', border: 'none' }}>
            <i className="ri-close-line" style={{ fontSize: 20 }} />
          </button>
        </div>
        <div className="modal-body">
          <div className="form-group">
            <label className="form-label">Nombre del Cliente</label>
            <input className="form-input" placeholder="Ej: Juan Pérez" value={cliente} onChange={e => setCliente(e.target.value)} />
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary" onClick={handleCrear}>
            Abrir Cuenta
          </button>
        </div>
      </div>
    </div>
  );
}

// ── MODAL CAMBIAR MESA ───────────────────────────────────
function ModalCambiarMesa({ mesa, mesas, onClose, onConfirm }) {
  const [destino, setDestino] = useState('');
  const libres = mesas.filter(m => m.estado === 'libre');

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title"><i className="ri-swap-line" style={{ marginRight: 8 }} />Cambiar Mesa de Sesión</span>
          <button onClick={onClose} className="btn-icon btn btn-secondary" style={{ background: 'none', border: 'none' }}>
            <i className="ri-close-line" style={{ fontSize: 20 }} />
          </button>
        </div>
        <div className="modal-body">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ padding: 12, background: 'var(--bg-elevated)', borderRadius: 10, border: '1px solid var(--border)' }}>
              <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>MESA DE ORIGEN SELECCIONADA</div>
              <div style={{ fontWeight: 700, fontSize: 14 }}>{mesa.nombre} (Ocupada por {mesa.cliente})</div>
            </div>

            <div className="form-group">
              <label className="form-label">Seleccionar Mesa Destino Disponible</label>
              {libres.length === 0 ? (
                <p style={{ color: 'var(--danger)', fontSize: 13, fontWeight: 600 }}>No hay mesas libres disponibles en este momento.</p>
              ) : (
                <select className="form-select" value={destino} onChange={e => setDestino(e.target.value)}>
                  <option value="">-- Seleccionar Mesa Libre --</option>
                  {libres.map(m => (
                    <option key={m.id} value={m.id}>{m.nombre} ({m.tipo} · ${m.tarifa}/hr)</option>
                  ))}
                </select>
              )}
            </div>
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cancelar</button>
          <button 
            className="btn btn-primary" 
            onClick={() => onConfirm(mesa.id, parseInt(destino))}
            disabled={!destino}
          >
            Confirmar Cambio
          </button>
        </div>
      </div>
    </div>
  );
}

// ── MODAL VINCULAR CLIENTE ───────────────────────────────
function ModalVincularCliente({ mesa, onClose, onConfirm }) {
  const [nombre, setNombre] = useState(mesa.cliente || '');
  const [isClosing, setIsClosing] = useState(false);

  const handleClose = () => {
    setIsClosing(true);
    setTimeout(onClose, 150);
  };

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

        if (nombre !== (mesa.cliente || '')) {
          if (!window.confirm('¿Deseas salir sin guardar los cambios del cliente?')) {
            return;
          }
        }
        handleClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [nombre, mesa.cliente, onClose]);

  return (
    <div className={`modal-overlay ${isClosing ? 'modal-closing' : ''}`} onClick={handleClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title"><i className="ri-user-add-line" style={{ marginRight: 8 }} />Asignar Cliente / Editar Nombre</span>
          <button onClick={handleClose} className="btn-icon btn btn-secondary" style={{ background: 'none', border: 'none' }}>
            <i className="ri-close-line" style={{ fontSize: 20 }} />
          </button>
        </div>
        <div className="modal-body">
          <div className="form-group">
            <label className="form-label">Nombre del Cliente de Mesa {mesa.id}</label>
            <input className="form-input" placeholder="Nombre completo" value={nombre} onChange={e => setNombre(e.target.value)} />
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={handleClose}>Cancelar</button>
          <button className="btn btn-primary" onClick={() => onConfirm(nombre)}>
            Guardar Cliente
          </button>
        </div>
      </div>
    </div>
  );
}

// ── MODAL BITÁCORA (SUGERENCIA 2) ────────────────────────
function ModalBitacora({ bitacora, onClear, onClose }) {
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
          <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>Últimos 100 movimientos de mesas, consumos y caja en este dispositivo.</p>
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

// ── MODAL REGISTRAR COMANDA (NUEVO) ──────────────────────
function ModalRegistrarComanda({ mesas, setMesas, cuentasActivas, setCuentasActivas, onClose, showToast, registrarEvento }) {
  const [destinoTipo, setDestinoTipo] = useState('mesa'); // 'mesa', 'cuenta', 'llevar'
  const [destinoId, setDestinoId] = useState('');
  const [carrito, setCarrito] = useState([]);
  const [productos, setProductos] = useState([]);
  const [isClosing, setIsClosing] = useState(false);

  const handleClose = () => {
    if (carrito.length > 0) {
      sessionStorage.setItem('yoy_draft_comanda_carrito', JSON.stringify(carrito));
    }
    setIsClosing(true);
    setTimeout(onClose, 150);
  };

  useEffect(() => {
    const draft = sessionStorage.getItem('yoy_draft_comanda_carrito');
    if (draft) {
      try {
        const parsed = JSON.parse(draft);
        if (parsed && parsed.length > 0) {
          setCarrito(parsed);
        }
        sessionStorage.removeItem('yoy_draft_comanda_carrito');
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

        if (carrito.length > 0) {
          if (!window.confirm('¿Deseas salir? Perderás los artículos agregados a la comanda.')) {
            return;
          }
        }
        handleClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [carrito, onClose]);

  // Cargar productos con stock desde Firestore en tiempo real
  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'config', 'inventario'), snap => {
      if (snap.exists()) {
        const parsed = snap.data().productos || [];
        if (Array.isArray(parsed) && parsed.length > 0) {
          // Normalizar las claves viejas/nuevas para asegurar consistencia
          const normalizados = parsed.map(p => ({
            ...p,
            nombre: p.nombre || p.producto || `Producto #${p.id}`,
            precioVenta: p.precioVenta !== undefined ? p.precioVenta : (p.precio !== undefined ? p.precio : 0),
            stock: p.stock !== undefined ? p.stock : 0,
            stockMin: p.stockMin !== undefined ? p.stockMin : 15,
            stockOptimo: p.stockOptimo !== undefined ? p.stockOptimo : 50,
            categoria: p.categoria || 'Bar',
            unidad: p.unidad || 'pz'
          }));
          setProductos(normalizados);
          // Sincronizar en localStorage para compatibilidad
          localStorage.setItem('yoy_billar_stock', obfuscate(normalizados));
        }
      }
    }, err => {
      console.error("Error al suscribirse al inventario en comanda:", err);
    });
    return unsub;
  }, []);

  const mesasOcupadas = mesas.filter(m => m.estado === 'ocupada');

  const agregarAlCarrito = (prod) => {
    if (prod.stock <= 0) return; // Recomendación 1: bloqueo
    const enCarrito = carrito.find(item => item.id === prod.id);
    const cantEnCarrito = enCarrito ? enCarrito.cantidad : 0;

    if (prod.stock <= cantEnCarrito) {
      showToast(`No hay suficiente stock de ${prod.nombre}`, 'warning');
      return;
    }

    setCarrito(prev => {
      const existe = prev.find(item => item.id === prod.id);
      if (existe) {
        return prev.map(item => item.id === prod.id ? { ...item, cantidad: item.cantidad + 1 } : item);
      }
      return [...prev, { ...prod, cantidad: 1 }];
    });
  };

  const quitarDelCarrito = (id) => {
    setCarrito(prev => {
      const existe = prev.find(item => item.id === id);
      if (existe && existe.cantidad > 1) {
        return prev.map(item => item.id === id ? { ...item, cantidad: item.cantidad - 1 } : item);
      }
      return prev.filter(item => item.id !== id);
    });
  };

  const total = carrito.reduce((sum, item) => sum + (item.precioVenta * item.cantidad), 0);

  const enviarComanda = () => {
    if (carrito.length === 0) {
      showToast('El carrito de comanda está vacío.', 'warning');
      return;
    }

    if (destinoTipo !== 'llevar' && !destinoId) {
      showToast('Por favor seleccione el destino de la comanda.', 'warning');
      return;
    }

    // ── VALIDACIÓN CONCURRENTE DE STOCK FRESCO (SUGERENCIA 1) ─────
    let stockFresco = [];
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem('yoy_billar_stock');
        if (saved) stockFresco = deobfuscate(saved) || [];
      } catch (err) {
        console.error(err);
      }
    }

    if (stockFresco.length > 0) {
      for (let item of carrito) {
        const frescoItem = stockFresco.find(p => p.id === item.id);
        if (!frescoItem || frescoItem.stock < item.cantidad) {
          showToast(`⚠️ Conflicto de Inventario: El stock de "${item.nombre}" acaba de cambiar. Solo quedan ${frescoItem ? frescoItem.stock : 0} unidades. Por favor rehaga su comanda.`, 'error');
          setProductos(stockFresco);
          return;
        }
      }
    }

    // Descontar del stock fresco validado
    const stockActualizado = (stockFresco.length > 0 ? stockFresco : productos).map(p => {
      const enCart = carrito.find(item => item.id === p.id);
      if (enCart) {
        return { ...p, stock: Math.max(0, p.stock - enCart.cantidad), lastModified: Date.now() };
      }
      return p;
    });

    localStorage.setItem('yoy_billar_stock', obfuscate(stockActualizado));
    setDoc(doc(db, 'config', 'inventario'), {
      productos: stockActualizado,
      updatedAt: serverTimestamp()
    }).catch(err => console.error("Error al actualizar inventario en comanda:", err));

    // Agregar comanda al destino
    if (destinoTipo === 'mesa') {
      const targetMesa = mesas.find(m => m.id === parseInt(destinoId));
      if (!targetMesa) return;

      const cuentaExistente = cuentasActivas.find(c => c.cliente.toLowerCase() === targetMesa.cliente.toLowerCase());

      if (cuentaExistente) {
        setCuentasActivas(prev => prev.map(c => {
          if (c.id === cuentaExistente.id) {
            const nuevosConsumos = [...c.consumos];
            carrito.forEach(cartItem => {
              const existeItem = nuevosConsumos.find(i => i.producto === cartItem.nombre);
              if (existeItem) {
                existeItem.cantidad += cartItem.cantidad;
              } else {
                nuevosConsumos.push({
                  id: Date.now() + Math.random(),
                  producto: cartItem.nombre,
                  precio: cartItem.precioVenta,
                  cantidad: cartItem.cantidad
                });
              }
            });
            return { ...c, consumos: nuevosConsumos };
          }
          return c;
        }));
        showToast(`Comanda enviada a la cuenta de ${targetMesa.cliente} (Mesa ${targetMesa.id}) ✓`, 'success');
        registrarEvento('Comanda a Cuenta', `Comanda de ${carrito.map(i=>`${i.cantidad}x ${i.nombre}`).join(', ')} enviada a la cuenta de ${targetMesa.cliente} (Mesa ${targetMesa.id})`, total);
      } else {
        const nuevaCuenta = {
          id: Date.now(),
          cliente: targetMesa.cliente,
          tiempoJuego: 0,
          consumos: carrito.map(item => ({
            id: Date.now() + Math.random(),
            producto: item.nombre,
            precio: item.precioVenta,
            cantidad: item.cantidad
          })),
          inicio: Date.now()
        };
        setCuentasActivas(prev => [...prev, nuevaCuenta]);
        showToast(`Comanda cargada a la cuenta de ${targetMesa.cliente} (Mesa ${targetMesa.id}) ✓`, 'success');
        registrarEvento('Comanda a Mesa', `Comanda de ${carrito.map(i=>`${i.cantidad}x ${i.nombre}`).join(', ')} cargada a la cuenta activa de ${targetMesa.cliente} (Mesa ${targetMesa.id})`, total);
      }
    } else if (destinoTipo === 'cuenta') {
      const targetCuenta = cuentasActivas.find(c => c.id === parseInt(destinoId));
      if (!targetCuenta) return;

      setCuentasActivas(prev => prev.map(c => {
        if (c.id === targetCuenta.id) {
          const nuevosConsumos = [...c.consumos];
          carrito.forEach(cartItem => {
            const existeItem = nuevosConsumos.find(i => i.producto === cartItem.nombre);
            if (existeItem) {
              existeItem.cantidad += cartItem.cantidad;
            } else {
              nuevosConsumos.push({
                id: Date.now() + Math.random(),
                producto: cartItem.nombre,
                precio: cartItem.precioVenta,
                cantidad: cartItem.cantidad
              });
            }
          });
          return { ...c, consumos: nuevosConsumos };
        }
        return c;
      }));
      showToast(`Comanda agregada a la cuenta de ${targetCuenta.cliente} ✓`, 'success');
      registrarEvento('Comanda a Cuenta', `Comanda de ${carrito.map(i=>`${i.cantidad}x ${i.nombre}`).join(', ')} agregada a la cuenta de ${targetCuenta.cliente}`, total);
    } else if (destinoTipo === 'llevar') {
      showToast(`Comanda registrada Para Llevar. Total: $${total} MXN ✓`, 'success');
      registrarEvento('Venta Barra', `Comanda Para Llevar: ${carrito.map(i=>`${i.cantidad}x ${i.nombre}`).join(', ')} liquidada al momento`, total);
    }

    setCarrito([]);
    onClose();
  };

  return (
    <div className={`modal-overlay ${isClosing ? 'modal-closing' : ''}`} onClick={handleClose}>
      <div className="modal" style={{ maxWidth: 740 }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">
            <i className="ri-cup-line" style={{ marginRight: 8, color: 'var(--bronze-light)' }} />
            Registrar Comanda de Consumo
          </span>
          <button onClick={handleClose} className="btn-icon btn btn-secondary" style={{ background: 'none', border: 'none' }}>
            <i className="ri-close-line" style={{ fontSize: 20 }} />
          </button>
        </div>
        <div className="modal-body" style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 20 }}>
          {/* Panel Izquierdo: Productos */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <h4 style={{ fontSize: 12, textTransform: 'uppercase', color: 'var(--text-secondary)' }}>Productos Disponibles</h4>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, maxHeight: 360, overflowY: 'auto', paddingRight: 4 }}>
              {productos.map(p => {
                const agotado = p.stock <= 0;
                return (
                  <div
                    key={p.id}
                    onClick={() => !agotado && agregarAlCarrito(p)}
                    style={{
                      background: 'var(--bg-elevated)',
                      border: `1px solid ${agotado ? 'rgba(239,68,68,0.2)' : 'var(--border)'}`,
                      borderRadius: 10, padding: 10, cursor: agotado ? 'not-allowed' : 'pointer',
                      transition: 'all 0.15s',
                      opacity: agotado ? 0.4 : 1,
                      position: 'relative'
                    }}
                    onMouseEnter={e => { if (!agotado) e.currentTarget.style.borderColor = 'var(--border-bronze)'; }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor = agotado ? 'rgba(239,68,68,0.2)' : 'var(--border)'; }}
                  >
                    <div style={{ fontWeight: 700, fontSize: 12, paddingRight: agotado ? 48 : 0 }}>{p.nombre}</div>
                    
                    {agotado && (
                      <span className="badge badge-danger" style={{ position: 'absolute', top: 8, right: 8, fontSize: 8, padding: '1px 4px' }}>
                        AGOTADO
                      </span>
                    )}

                    <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, alignItems: 'center' }}>
                      <span style={{ fontSize: 13, color: 'var(--bronze-light)', fontWeight: 800 }}>${p.precioVenta}</span>
                      <span style={{ fontSize: 10, color: p.stock < 10 && !agotado ? 'var(--danger)' : 'var(--text-muted)' }}>
                        {agotado ? 'Sin stock' : `Stock: ${p.stock}`}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Panel Derecho: Carrito y Destino */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, borderLeft: '1px solid var(--border)', paddingLeft: 20 }}>
            <h4 style={{ fontSize: 12, textTransform: 'uppercase', color: 'var(--text-secondary)' }}>Detalle de Comanda</h4>
            
            {/* Destino de la comanda */}
            <div className="form-group">
              <label className="form-label" style={{ fontSize: 10 }}>Destino</label>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6, marginBottom: 8 }}>
                {[
                  { id: 'mesa', label: 'Mesa', icon: 'ri-play-circle-line' },
                  { id: 'cuenta', label: 'Cuenta Cl.', icon: 'ri-folder-open-line' },
                  { id: 'llevar', label: 'Llevar', icon: 'ri-shopping-bag-line' }
                ].map(d => (
                  <button
                    key={d.id}
                    onClick={() => { setDestinoTipo(d.id); setDestinoId(''); }}
                    style={{
                      background: destinoTipo === d.id ? 'var(--bronze-subtle)' : 'var(--bg-elevated)',
                      border: `1px solid ${destinoTipo === d.id ? 'var(--border-bronze)' : 'var(--border)'}`,
                      borderRadius: 8, padding: '6px 4px', fontSize: 10, fontWeight: 600, cursor: 'pointer',
                      color: destinoTipo === d.id ? 'var(--bronze-light)' : 'var(--text-secondary)',
                      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4
                    }}
                  >
                    <i className={d.icon} />
                    {d.label}
                  </button>
                ))}
              </div>

              {destinoTipo === 'mesa' && (
                <select className="form-select" style={{ fontSize: 12, padding: 6 }} value={destinoId} onChange={e=>setDestinoId(e.target.value)}>
                  <option value="">-- Seleccionar Mesa Ocupada --</option>
                  {mesasOcupadas.map(m => (
                    <option key={m.id} value={m.id}>{m.nombre} - {m.cliente}</option>
                  ))}
                </select>
              )}

              {destinoTipo === 'cuenta' && (
                <select className="form-select" style={{ fontSize: 12, padding: 6 }} value={destinoId} onChange={e=>setDestinoId(e.target.value)}>
                  <option value="">-- Seleccionar Cuenta Activa --</option>
                  {cuentasActivas.map(c => (
                    <option key={c.id} value={c.id}>{c.cliente} (Juego: ${c.tiempoJuego})</option>
                  ))}
                </select>
              )}
            </div>

            {/* Artículos */}
            <div style={{ flex: 1, maxHeight: 180, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
              {carrito.length === 0 ? (
                <p style={{ color: 'var(--text-muted)', fontSize: 11, textAlign: 'center', padding: '20px 0' }}>Agregue productos tocando las tarjetas.</p>
              ) : (
                carrito.map(item => (
                  <div key={item.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11 }}>
                    <span style={{ flex: 1 }}>{item.nombre}</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <button onClick={() => quitarDelCarrito(item.id)} style={{ width: 18, height: 18, borderRadius: 4, background: 'var(--bg-elevated)', border: '1px solid var(--border)', cursor: 'pointer', color: 'var(--text-secondary)' }}>-</button>
                      <span style={{ fontWeight: 700 }}>{item.cantidad}</span>
                      <button onClick={() => agregarAlCarrito(item)} style={{ width: 18, height: 18, borderRadius: 4, background: 'var(--bronze-subtle)', border: '1px solid var(--border-bronze)', cursor: 'pointer', color: 'var(--bronze-light)' }}>+</button>
                    </div>
                    <span style={{ fontWeight: 700, minWidth: 50, textAlign: 'right', color: 'var(--bronze-light)' }}>${item.precioVenta * item.cantidad}</span>
                  </div>
                ))
              )}
            </div>

            {/* Total y Enviar */}
            <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10, fontSize: 12 }}>
                <span>Total Comanda:</span>
                <span style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>${total} MXN</span>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-secondary" style={{ flex: 1, padding: '8px' }} onClick={handleClose}>Cancelar</button>
                <button
                  className="btn btn-primary"
                  style={{ flex: 2, padding: '8px' }}
                  onClick={enviarComanda}
                  disabled={carrito.length === 0 || (destinoTipo !== 'llevar' && !destinoId)}
                >
                  <i className="ri-send-plane-line" /> Confirmar y Enviar
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── MODAL COBRO MANUAL ───────────────────────────────────
function ModalCobroManual({ nuevoMonto, setNuevoMonto, nuevaDesc, setNuevaDesc, nuevoMetodo, setNuevoMetodo, pinAutorizacion, setPinAutorizacion, onClose, onConfirm }) {
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

        if (nuevoMonto || nuevaDesc || pinAutorizacion) {
          if (!window.confirm('¿Deseas salir? Perderás los datos ingresados en el cobro manual.')) {
            return;
          }
        }
        handleClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [nuevoMonto, nuevaDesc, pinAutorizacion, onClose]);

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
            <div className="form-group" style={{ borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: 12 }}>
              <label className="form-label" style={{ color: 'var(--bronze-light)', display: 'flex', alignItems: 'center', gap: 6 }}>
                <i className="ri-shield-user-line" /> Contraseña de Autorización Admin
              </label>
              <input
                className="form-input"
                type="password"
                placeholder="Ingrese PIN (1111)"
                value={pinAutorizacion}
                onChange={e => setPinAutorizacion(e.target.value)}
                style={{ borderColor: 'var(--border-bronze)' }}
              />
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

'use client';
import { useState, useEffect, useRef, useMemo, Component } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';
import { obfuscate, deobfuscate, hashNip, obfuscateStatic } from '@/lib/crypto';
import { db } from '@/lib/firebase';
import { useAuth } from '@/lib/auth-context';
import { getBusinessDate } from '@/lib/date-utils';
import { doc, onSnapshot, setDoc, getDoc, serverTimestamp, collection, query, where, getDocs, writeBatch, updateDoc, runTransaction, addDoc, orderBy, limit, getActiveSalonId } from '@/lib/firestore-tenant';
import ModalCobroManual from './ModalCobroManual';

function areMesasEqual(arr1, arr2) {
  if (!arr1 || !arr2) return arr1 === arr2;
  if (arr1.length !== arr2.length) return false;
  for (let i = 0; i < arr1.length; i++) {
    const m1 = arr1[i];
    const m2 = arr2[i];
    if (m1.id !== m2.id ||
        m1.estado !== m2.estado ||
        m1.cliente !== m2.cliente ||
        m1.inicio !== m2.inicio ||
        m1.tarifa !== m2.tarifa ||
        m1.tipo !== m2.tipo ||
        m1.socios !== m2.socios ||
        m1.clienteUid !== m2.clienteUid ||
        m1.preTicketImpreso !== m2.preTicketImpreso ||
        m1.filaId !== m2.filaId) {
      return false;
    }
  }
  return true;
}

const sanitizarYValidarMesas = (arr) => {
  if (!Array.isArray(arr) || arr.length === 0) return null;
  const ids = new Set();
  const estadosValidos = ['libre', 'ocupada', 'reservada', 'manten', 'fuera'];
  const cleanArr = [];

  for (const m of arr) {
    if (!m || typeof m !== 'object') return null;
    if (typeof m.id !== 'number' || m.id <= 0 || !Number.isInteger(m.id)) return null;
    if (typeof m.tarifa !== 'number' || m.tarifa < 0) return null;
    if (typeof m.estado !== 'string' || !estadosValidos.includes(m.estado)) return null;
    if (m.nombre !== undefined && typeof m.nombre !== 'string') return null;

    if (ids.has(m.id)) return null;
    ids.add(m.id);

    const mesaClonada = { ...m };

    // Sanitización semántica y lógica para mesas libres
    if (mesaClonada.estado === 'libre') {
      if (mesaClonada.cliente !== null || mesaClonada.inicio !== null || mesaClonada.clienteUid !== '') {
        mesaClonada.cliente = null;
        mesaClonada.inicio = null;
        mesaClonada.clienteUid = '';
        mesaClonada.socios = false;
      }
    }
    cleanArr.push(mesaClonada);
  }
  return cleanArr;
};


const normalizeText = (str) => {
  if (!str) return '';
  return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
};

const VOCABULARIO_FRASES = {
  cuenta: [
    '¡Oye, cuenta!',
    '¡Cobro de mesa!',
    '¡Una cuenta por aquí!',
    '¡Listo para cuenta!'
  ],
  barra: [
    '¡Cobro en barra!',
    '¡Ten, cobro!',
    '¡Barra lista!',
    '¡Cuenta directa!'
  ],
  pedido: [
    '¡Un pedido!',
    '¡Pedido entrante!',
    '¡Mira, pedido!',
    '¡Nuevo pedido!'
  ],
  asistencia: [
    '¡Oye, ayuda!',
    '¡Te llaman!',
    '¡Oye, mira!',
    '¡Mira por aquí!'
  ],
  recordatorio: [
    '¡Oye!',
    '¡Atención!',
    '¡Caja!',
    '¡Pendientes!'
  ]
};

const getCuentaAsociadaSafe = (mesa, cuentasActivas) => {
  const defaultObject = {
    id: null,
    mesaId: mesa ? mesa.id : null,
    cliente: mesa ? (mesa.cliente || 'Público') : 'Público',
    consumos: [],
    tiempoJuego: 0,
    subtotal: 0,
    total: 0,
    isDefaultNullObject: true
  };

  if (!mesa || !cuentasActivas) return defaultObject;

  const mesaId = mesa.id;
  const mesaClienteNormalized = normalizeText(mesa.cliente);

  const found = cuentasActivas.find(c => {
    if (c.mesaId === mesaId) return true;
    if (!c.cliente) return false;
    const cClienteNormalized = normalizeText(c.cliente);
    if (mesaClienteNormalized && !['público', 'publico'].includes(mesaClienteNormalized) && cClienteNormalized === mesaClienteNormalized) return true;
    if (cClienteNormalized === `mesa ${mesaId}`) return true;
    return false;
  });

  if (found) {
    return {
      ...found,
      consumos: found.consumos || []
    };
  }

  return defaultObject;
};

class ModalErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error(`[ModalErrorBoundary] Crash in modal [${this.props.name || 'desconocido'}]:`, error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="modal-overlay" style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.7)',
          backdropFilter: 'blur(4px)',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          zIndex: 2000,
          padding: 16
        }}>
          <div className="modal-content card" style={{
            maxWidth: 450,
            width: '100%',
            backgroundColor: '#1c1c1e',
            color: '#fff',
            borderRadius: 12,
            border: '1px solid var(--danger)',
            boxShadow: '0 8px 32px rgba(255, 0, 0, 0.2)',
            overflow: 'hidden'
          }}>
            <div className="modal-header" style={{
              padding: '16px 20px',
              borderBottom: '1px solid #2c2c2e',
              display: 'flex',
              alignItems: 'center',
              gap: 10
            }}>
              <i className="ri-error-warning-fill" style={{ color: 'var(--danger)', fontSize: 20 }} />
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>Error al Cargar Modal</h3>
            </div>
            <div className="modal-body" style={{ padding: '20px 24px', fontSize: 13, lineHeight: '1.5' }}>
              <p>Ocurrió un error inesperado al renderizar el modal <strong>{this.props.name || ''}</strong>.</p>
              <div style={{
                backgroundColor: '#0c0c0e',
                padding: 12,
                borderRadius: 6,
                fontFamily: 'monospace',
                fontSize: 11,
                color: '#ff6b6b',
                maxHeight: 150,
                overflowY: 'auto',
                border: '1px solid #2c2c2e',
                marginTop: 10,
                wordBreak: 'break-all',
                whiteSpace: 'pre-wrap'
              }}>
                {this.state.error && this.state.error.toString()}
              </div>
            </div>
            <div className="modal-footer" style={{
              padding: '12px 20px',
              borderTop: '1px solid #2c2c2e',
              display: 'flex',
              justifyContent: 'flex-end',
              gap: 10,
              backgroundColor: '#151517'
            }}>
              <button 
                className="btn btn-secondary" 
                onClick={() => {
                  this.setState({ hasError: false, error: null });
                  if (this.props.onClose) this.props.onClose();
                }}
                style={{ fontSize: 12, padding: '6px 16px' }}
              >
                Cerrar Modal
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}



const isRealName = (name) => {
  const normalized = (name || '').trim().toLowerCase();
  
  // 1. Debe tener al menos 3 caracteres
  if (normalized.length < 3) return false;
  
  // 2. Nombres genéricos prohibidos
  const genericList = [
    'publico', 'público', 'publico general', 'público general', 
    'cliente temporal', 'cliente', 'sin nombre', 'anonimo', 
    'anónimo', 'desconocido', 'nadie', 'ninguno', 'x', 'xx', 'xxx'
  ];
  if (genericList.includes(normalized)) return false;
  
  // 3. No debe empezar con términos de sesión genérica
  if (normalized.startsWith('mesa ') || 
      normalized.startsWith('cuenta ') || 
      normalized.startsWith('pedido ') || 
      normalized === 'mesa' || 
      normalized === 'cuenta') {
    return false;
  }
  
  // 4. Debe contener al menos una letra (no ser solo números o símbolos especiales)
  if (!/[a-zA-ZáéíóúÁÉÍÓÚñÑ]/.test(normalized)) return false;
  
  // 5. Detectar repeticiones de caracteres y mocks de teclado comunes
  if (/^(.)\1+$/.test(normalized)) return false; // p. ej. "aaa", "---", "..."
  if (['asd', 'asdf', 'qwer', 'zxcv', '1234', '12345'].includes(normalized)) return false;
  
  return true;
};

const capitalizeName = (name) => {
  if (!name) return '';
  return name
    .trim()
    .split(/\s+/)
    .map(word => {
      if (!word) return '';
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(' ');
};

const getCleanClientName = (name) => {
  if (!name) return '';
  return name.replace(/\s*\(Mesa[s]?\s+\d+.*?\)/gi, '').trim();
};

const playSuccessSound = () => {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const ctx = new AudioContext();
    
    // Play a short double beep (success tone)
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
    gain1.gain.setValueAtTime(0.08, ctx.currentTime);
    gain1.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12);
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start();
    osc1.stop(ctx.currentTime + 0.12);
    
    setTimeout(() => {
      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(880.00, ctx.currentTime); // A5
      gain2.gain.setValueAtTime(0.08, ctx.currentTime);
      gain2.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2);
      osc2.connect(gain2);
      gain2.connect(ctx.destination);
      osc2.start();
      osc2.stop(ctx.currentTime + 0.2);
    }, 100);
  } catch (e) {
    console.error("No se pudo reproducir el tono de éxito:", e);
  }
};

const playErrorSound = () => {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const ctx = new AudioContext();
    
    // Play a low error buzzer tone
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth'; // Sawtooth waveform gives a buzz sound
    osc.frequency.setValueAtTime(120.00, ctx.currentTime); // Low pitch
    gain.gain.setValueAtTime(0.08, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.25);
  } catch (e) {
    console.error("No se pudo reproducir el tono de error:", e);
  }
};

const matchesTableType = (waitlistType, tableType) => {
  if (!waitlistType || !tableType) return false;
  const wt = waitlistType.toLowerCase();
  const tt = tableType.toLowerCase();
  if (wt === 'cualquiera' || wt === 'any') return true;
  if (wt.includes('pool') && tt.includes('pool')) return true;
  if (wt.includes('carambola') && tt.includes('carambola')) return true;
  if (wt.includes('snooker') && tt.includes('snooker')) return true;
  if (wt.includes('dominó') || wt.includes('domino') && (tt.includes('domino') || tt.includes('dominó'))) return true;
  return wt === tt;
};

// ── DATOS INICIALES DE MESAS ───────────────────────────────
const INIT_MESAS = [
  { id: 1, nombre: 'Mesa 1', tipo: 'Carambola 3B', estado: 'libre',    cliente: null, inicio: null, tarifa: 80, socios: false, clienteUid: '' },
  { id: 2, nombre: 'Mesa 2', tipo: 'Carambola 3B', estado: 'libre',    cliente: null, inicio: null, tarifa: 80, socios: false, clienteUid: '' },
  { id: 3, nombre: 'Mesa 3', tipo: 'Pool 9B',      estado: 'libre',    cliente: null, inicio: null, tarifa: 60, socios: false, clienteUid: '' },
  { id: 4, nombre: 'Mesa 4', tipo: 'Carambola 3B', estado: 'libre',    cliente: null, inicio: null, tarifa: 80, socios: false, clienteUid: '' },
  { id: 5, nombre: 'Mesa 5', tipo: 'Snooker',      estado: 'libre',    cliente: null, inicio: null, tarifa: 100, socios: false, clienteUid: '' },
  { id: 6, nombre: 'Mesa 6', tipo: 'Pool 9B',      estado: 'libre',    cliente: null, inicio: null, tarifa: 60, socios: false, clienteUid: '' },
  { id: 7, nombre: 'Mesa 7', tipo: 'Carambola 3B', estado: 'libre',    cliente: null, inicio: null, tarifa: 80, socios: false, clienteUid: '' },
  { id: 8, nombre: 'Mesa 8', tipo: 'Pool 9B',      estado: 'libre',    cliente: null, inicio: null, tarifa: 60, socios: false, clienteUid: '' },
];

const ESTADO_CONFIG = {
  libre:     { label: 'Libre',     color: '#22c55e',               icon: 'ri-checkbox-blank-circle-line' },
  ocupada:   { label: 'Ocupada',   color: '#ffffff',               icon: 'ri-record-circle-line' },
  reservada: { label: 'Reservada', color: 'var(--bronze-light)',   icon: 'ri-bookmark-fill' },
  manten:    { label: 'Mantenimiento', color: '#ef4444',            icon: 'ri-tools-line' },
  fuera:     { label: 'Fuera de Servicio', color: '#ef4444',       icon: 'ri-close-circle-line' },
};

const CATEGORIAS_GASTO = [
  { id: 'mesas',      label: 'Mantenimiento Mesas',  icon: '🎱', color: '#cd7f32' },
  { id: 'accesorios', label: 'Accesorios',            icon: '🎯', color: '#e3a869' },
  { id: 'bar',        label: 'Bar e Insumos',         icon: '🍺', color: '#3b82f6' },
  { id: 'servicios',  label: 'Servicios',             icon: '💡', color: '#f59e0b' },
  { id: 'limpieza',   label: 'Limpieza',              icon: '🧹', color: '#22c55e' },
  { id: 'reparacion', label: 'Reparaciones',          icon: '🛠️', color: '#ef4444' },
  { id: 'admin',      label: 'Administrativos',       icon: '📋', color: '#b0b8c8' },
  { id: 'nomina',     label: 'Pago de Nómina',        icon: '💸', color: '#10b981' },
  { id: 'otro',       label: 'Otro / Personalizado',  icon: '➕', color: '#6b7280' },
];

function formatTime(ms) {
  if (!ms) return '00:00:00';
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600).toString().padStart(2, '0');
  const m = Math.floor((s % 3600) / 60).toString().padStart(2, '0');
  const sc = (s % 60).toString().padStart(2, '0');
  return `${h}:${m}:${sc}`;
}

function calcCosto(mesa, elapsedMs) {
  if (!mesa.inicio) return 0;
  const ms = elapsedMs !== undefined ? elapsedMs : (Date.now() - mesa.inicio);
  const hrs = ms / 3600000;
  let baseCosto = mesa.socios ? 0 : Math.ceil(hrs * mesa.tarifa);
  let premiumCosto = 0;

  if (globalRentaExtras && Array.isArray(globalRentaExtras)) {
    globalRentaExtras.forEach(extra => {
      const propKey = `rentar_${extra.id}`;
      const isRented = mesa[propKey] || 
                       (extra.id === 'taco' && mesa.rentarTaco) ||
                       (extra.id === 'bolas' && mesa.rentarBolas) ||
                       (extra.id === 'tiza' && mesa.rentarTiza);
                       
      if (isRented) {
        if (extra.tipo === 'hora') {
          premiumCosto += Math.ceil(hrs * (extra.precio || 0));
        } else {
          premiumCosto += (extra.precio || 0);
        }
      }
    });
  } else {
    if (mesa.rentarTaco) premiumCosto += Math.ceil(hrs * 25);
    if (mesa.rentarBolas) premiumCosto += Math.ceil(hrs * 35);
    if (mesa.rentarTiza) premiumCosto += 10;
  }

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

  function simulateQRScan() {
    playBeepSound();
    const randomRef = `QR_STP_${Math.floor(100000 + Math.random() * 900000)}`;
    onCapture({ reference: randomRef });
  }

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
function ModalAbrirMesa({ mesa, adminPinHash, hashPassword, onClose, onConfirm }) {
  const [cliente, setCliente] = useState(mesa.cliente || '');
  const [esSocio, setEsSocio] = useState(mesa.esSocio || false);
  const [rentarTaco, setRentarTaco] = useState(false);
  const [rentarBolas, setRentarBolas] = useState(false);
  const [rentarTiza, setRentarTiza] = useState(false);

  const tacoExtra = (globalRentaExtras && globalRentaExtras.find(e => e.id === 'taco')) || { nombre: 'Taco de Fibra de Carbono', precio: 25, tipo: 'hora' };
  const bolasExtra = (globalRentaExtras && globalRentaExtras.find(e => e.id === 'bolas')) || { nombre: 'Bolas Profesionales Aramith', precio: 35, tipo: 'hora' };
  const tizaExtra = (globalRentaExtras && globalRentaExtras.find(e => e.id === 'tiza')) || { nombre: 'Tiza Kamui Especial', precio: 10, tipo: 'fijo' };

  const [isBypassed, setIsBypassed] = useState(false);
  const [showPinPrompt, setShowPinPrompt] = useState(false);
  const [pinInput, setPinInput] = useState('');
  const [pinError, setPinError] = useState('');

  const handleVerifyBypass = () => {
    setPinError('');
    if (hashPassword(pinInput) === adminPinHash) {
      setIsBypassed(true);
      setShowPinPrompt(false);
      setPinInput('');
      setCliente(''); // Permitir ingresar otro nombre
    } else {
      playErrorSound();
      setPinError('PIN de Administrador incorrecto');
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ display: 'flex', flexDirection: 'column', maxHeight: '90vh', overflow: 'hidden' }}>
        <div className="modal-header">
          <span className="modal-title"><i className="ri-play-circle-line" style={{ marginRight: 8 }} />{mesa.nombre}</span>
          <button onClick={onClose} className="btn-icon btn btn-secondary" style={{ background: 'none', border: 'none' }}>
            <i className="ri-close-line" style={{ fontSize: 20 }} />
          </button>
        </div>
        <div className="modal-body" style={{ overflowY: 'auto', flex: 1 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ padding: 16, background: 'var(--bronze-subtle)', border: '1px solid var(--border-bronze)', borderRadius: 12 }}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 4 }}>Tipo de mesa</div>
              <div style={{ fontSize: 16, fontWeight: 700 }}>{mesa.tipo}</div>
              <div style={{ fontSize: 13, color: 'var(--bronze-light)', marginTop: 4 }}>${mesa.tarifa}/hr (público) · Socios: sin cargo</div>
            </div>

            <div className="form-group">
              {(mesa.isLockedToQueue && !isBypassed) ? (
                <div style={{ background: 'rgba(197, 168, 128, 0.08)', border: '1px solid rgba(197, 168, 128, 0.25)', borderRadius: 12, padding: '12px 14px', marginBottom: 14, fontSize: 12 }}>
                  <div style={{ fontWeight: 700, color: 'var(--bronze-light)', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <i className="ri-lock-line" /> Fila de Espera Activa
                  </div>
                  <div style={{ color: 'rgba(255,255,255,0.7)', marginTop: 4 }}>
                    Esta mesa está reservada para el cliente: <strong>{cliente}</strong>.
                  </div>
                  {!showPinPrompt ? (
                    <button 
                      type="button" 
                      className="btn btn-secondary btn-xs" 
                      style={{ marginTop: 8, fontSize: 10, background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.3)', color: '#ef4444' }}
                      onClick={() => setShowPinPrompt(true)}
                    >
                      <i className="ri-shield-keyhole-line" /> Saltar Fila (PIN Admin)
                    </button>
                  ) : (
                    <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6, borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: 10 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', fontWeight: 600 }}>AUTORIZAR BYPASS (PIN)</span>
                        <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
                          {pinInput?.length || 0}/8
                        </span>
                      </div>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <input 
                          type="password" 
                          className="form-input" 
                          placeholder="PIN de Admin" 
                          value={pinInput} 
                          onChange={e => setPinInput(e.target.value)}
                          maxLength={8}
                          style={{
                            padding: '6px 10px',
                            fontSize: 12,
                            flex: 1,
                            borderColor: pinInput ? '#f97316' : 'var(--border)',
                            boxShadow: pinInput ? '0 0 10px rgba(249, 115, 22, 0.35)' : 'none',
                            transition: 'all 0.25s ease-in-out'
                          }}
                          onKeyDown={e => { if (e.key === 'Enter') handleVerifyBypass(); }}
                        />
                        <button type="button" className="btn btn-primary btn-xs" onClick={handleVerifyBypass} style={{ padding: '0 10px' }}>
                          Autorizar
                        </button>
                        <button type="button" className="btn btn-secondary btn-xs" onClick={() => { setShowPinPrompt(false); setPinInput(''); setPinError(''); }} style={{ padding: '0 10px' }}>
                          Cancelar
                        </button>
                      </div>
                      {pinError && <span style={{ color: '#ef4444', fontSize: 10, textAlign: 'left' }}>{pinError}</span>}
                    </div>
                  )}
                </div>
              ) : null}

              <label className="form-label">
                {(mesa.isLockedToQueue && !isBypassed) ? 'Nombre del cliente (Asignado por Fila Virtual)' : 'Nombre del cliente (opcional)'}
              </label>
              <input 
                className="form-input" 
                placeholder="Ej: Carlos Rodríguez" 
                value={cliente} 
                onChange={e => setCliente(e.target.value)}
                disabled={mesa.isLockedToQueue && !isBypassed}
                style={(mesa.isLockedToQueue && !isBypassed) ? { background: 'rgba(255,255,255,0.03)', color: 'var(--text-secondary)', cursor: 'not-allowed', borderColor: 'rgba(197,168,128,0.3)' } : {}}
              />
              {(mesa.isLockedToQueue && !isBypassed) && (
                <div style={{ fontSize: 11, color: 'var(--bronze-light)', marginTop: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                  <i className="ri-information-line" />
                  Mesa reservada para el siguiente cliente en la fila de espera.
                </div>
              )}
            </div>

            <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: (mesa.isLockedToQueue && !isBypassed) ? 'not-allowed' : 'pointer', padding: '10px 14px', background: 'var(--bg-elevated)', borderRadius: 10, border: '1px solid var(--border)', opacity: (mesa.isLockedToQueue && !isBypassed) ? 0.6 : 1 }}>
              <input 
                type="checkbox" 
                checked={esSocio} 
                onChange={e => setEsSocio(e.target.checked)} 
                disabled={mesa.isLockedToQueue && !isBypassed}
                style={{ width: 16, height: 16, accentColor: 'var(--bronze)', cursor: (mesa.isLockedToQueue && !isBypassed) ? 'not-allowed' : 'pointer' }} 
              />
              <span style={{ fontSize: 13, fontWeight: 600 }}>Es miembro / socio mensual</span>
              <span className="badge badge-bronze" style={{ marginLeft: 'auto' }}>Sin cargo</span>
            </label>

            <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--bronze-light)', marginBottom: 8 }}>Equipamiento Premium (Opcional)</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
                  <input type="checkbox" checked={rentarTaco} onChange={e => setRentarTaco(e.target.checked)} style={{ width: 16, height: 16, accentColor: 'var(--bronze)' }} />
                  <span style={{ fontSize: 12 }}>{tacoExtra.nombre} (+${tacoExtra.precio}/{tacoExtra.tipo === 'hora' ? 'hr' : 'tarifa única'})</span>
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
                  <input type="checkbox" checked={rentarBolas} onChange={e => setRentarBolas(e.target.checked)} style={{ width: 16, height: 16, accentColor: 'var(--bronze)' }} />
                  <span style={{ fontSize: 12 }}>{bolasExtra.nombre} (+${bolasExtra.precio}/{bolasExtra.tipo === 'hora' ? 'hr' : 'tarifa única'})</span>
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
                  <input type="checkbox" checked={rentarTiza} onChange={e => setRentarTiza(e.target.checked)} style={{ width: 16, height: 16, accentColor: 'var(--bronze)' }} />
                  <span style={{ fontSize: 12 }}>{tizaExtra.nombre} (+${tizaExtra.precio}/{tizaExtra.tipo === 'hora' ? 'hr' : 'tarifa única'})</span>
                </label>
              </div>
            </div>
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary" onClick={() => onConfirm({ cliente: cliente.trim() || `Mesa ${mesa.id}`, esSocio, rentarTaco, rentarBolas, rentarTiza, bypassedFilaId: isBypassed ? mesa.filaId : null })}>
            <i className="ri-play-circle-line" /> Iniciar Mesa
          </button>
        </div>
      </div>
    </div>
  );
}

// ── MODAL CERRAR MESA ────────────────────────────────────
function ModalCerrarMesa({ mesa, cuentasActivas, clientesRegistrados = [], registrarNuevoClienteDirectorio, mesas = [], unloadedConsumos, onClose, onCerrar, onAgregarACuenta, imprimirPreTicket, onImprimirPreTicket, procesandoCierre }) {
  const cuentaAsociada = getCuentaAsociadaSafe(mesa, cuentasActivas);
  const [preTicketFlash, setPreTicketFlash] = useState(false);
  const inputNuevoClienteRef = useRef(null);

  const handleClose = () => {
    setNuevoCliente('');
    setCuentaSeleccionada('');
    setPagaCon('');
    setReferencia('');
    onClose();
  };

  const [elapsed, setElapsed] = useState(Date.now() - (mesa.inicio || Date.now()));
  const [metodo, setMetodo] = useState('efectivo');
  const [tipoCierre, setTipoCierre] = useState('liquidar'); // 'liquidar' o 'cuenta'
  const [cuentaSeleccionada, setCuentaSeleccionada] = useState('');
  const [nuevoCliente, setNuevoCliente] = useState(() => {
    const name = mesa.cliente || '';
    return isRealName(name) ? name : '';
  });

  const selectedCuentaObj = cuentasActivas.find(c => String(c.id) === String(cuentaSeleccionada));
  const isSelectedGeneric = selectedCuentaObj ? !isRealName(selectedCuentaObj.cliente) : false;

  const getFilteredClientes = (queryText) => {
    const term = (queryText || '').trim().toLowerCase();
    if (!term) return clientesRegistrados.slice(0, 15);
    return clientesRegistrados
      .filter(c => c.nombre && c.nombre.toLowerCase().includes(term))
      .slice(0, 15);
  };

  const getMatchingActiveAccounts = (query) => {
    const term = normalizeText(query);
    if (!term || term.length < 2) return [];
    return cuentasActivas.filter(c => {
      const cleanClient = getCleanClientName(c.cliente);
      const normalizedClient = normalizeText(cleanClient);
      
      // Match 1: Coincidencia por nombre normalizado (acentos ignorados)
      if (normalizedClient.includes(term)) return true;
      
      // Match 2: Coincidencia por teléfono del cliente registrado
      const registeredClient = clientesRegistrados.find(
        rc => normalizeText(rc.nombre) === normalizedClient
      );
      if (registeredClient && registeredClient.telefono) {
        const cleanPhone = registeredClient.telefono.replace(/\D/g, '');
        const cleanTerm = term.replace(/\D/g, '');
        if (cleanTerm && cleanPhone.includes(cleanTerm)) return true;
      }
      
      return false;
    });
  };

  const getRecientesActiveAccounts = () => {
    return cuentasActivas
      .filter(c => c.cliente && isRealName(getCleanClientName(c.cliente)))
      .sort((a, b) => b.id - a.id)
      .slice(0, 2);
  };

  // Pre-seleccionar la cuenta asociada de la mesa si existe
  useEffect(() => {
    if (cuentaAsociada && !cuentaAsociada.isDefaultNullObject) {
      setCuentaSeleccionada(cuentaAsociada.id);
      const isGeneric = !isRealName(cuentaAsociada.cliente);
      if (isGeneric) {
        const name = mesa.cliente || '';
        setNuevoCliente(isRealName(name) ? name : '');
      } else {
        setNuevoCliente('');
      }
    } else {
      setCuentaSeleccionada('');
      const name = mesa.cliente || '';
      setNuevoCliente(isRealName(name) ? name : '');
    }
  }, [cuentaAsociada?.id, cuentaAsociada?.cliente, mesa.id, mesa.cliente]);

  useEffect(() => {
    if (tipoCierre === 'cuenta' && inputNuevoClienteRef.current) {
      setTimeout(() => inputNuevoClienteRef.current?.focus(), 50);
    }
  }, [tipoCierre]);

  // Nuevos estados para cálculo de cambio, QR y transferencia con foto
  const [pagaCon, setPagaCon] = useState('');
  const [referencia, setReferencia] = useState('');
  const [fotoComprobante, setFotoComprobante] = useState('');
  const [camaraActiva, setCamaraActiva] = useState(false);

  // ── Motivo obligatorio para cortesías ($0 MXN) ──
  const [showMotivoCortesia, setShowMotivoCortesia] = useState(false);
  const [motivoCortesia, setMotivoCortesia] = useState('');
  const MOTIVOS_CORTESIA = [
    'Cliente frecuente / socio',
    'Cumpleaños / celebración especial',
    'Compensación por error del negocio',
    'Invitado del dueño / autorizado',
    'Promoción vigente del negocio',
    'Error de sistema / prueba',
  ];

  // Estado para la confirmación de nombre al mover a pendientes
  const [showPromptMoverPendiente, setShowPromptMoverPendiente] = useState(false);
  const [nombrePagador, setNombrePagador] = useState('');
  const [cuentaMoverId, setCuentaMoverId] = useState(null);
  const [limiteCoincidencias, setLimiteCoincidencias] = useState(3);
  const [limiteCoincidenciasMover, setLimiteCoincidenciasMover] = useState(3);

  const handleImprimirPreTicket = () => {
    imprimirPreTicket(mesa);
    onImprimirPreTicket();
    setPreTicketFlash(true);
    setTimeout(() => setPreTicketFlash(false), 800);
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

        if (showPromptMoverPendiente) {
          setShowPromptMoverPendiente(false);
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
  }, [camaraActiva, pagaCon, referencia, fotoComprobante, showPromptMoverPendiente, onClose]);

  // Limpiar campos al cambiar de método
  useEffect(() => {
    setPagaCon('');
    setReferencia('');
    setFotoComprobante('');
    setCamaraActiva(false);
  }, [metodo]);

  const consumosTotal = (cuentaAsociada 
    ? (cuentaAsociada.consumos || []).reduce((sum, item) => sum + item.precio * item.cantidad, 0)
    : 0) + (unloadedConsumos ? (unloadedConsumos[mesa.id] || 0) : 0);

  const costoTiempo = calcCosto({ ...mesa, inicio: mesa.inicio }, elapsed);
  const costo = mesa.socios ? consumosTotal : (costoTiempo + consumosTotal);
  const hrs = (elapsed / 3600000).toFixed(2);

  // Lógica de cálculo de efectivo
  const pagaConVal = parseFloat(pagaCon) || 0;
  const cambio = pagaConVal >= costo ? pagaConVal - costo : 0;
  
  const billetes = [50, 100, 200, 500, 1000];
  const quickBills = Array.from(new Set([costo, ...billetes.filter(b => b > costo)])).slice(0, 5);

  // Validación de cierre
  const isCerrarDisabled = procesandoCierre || (tipoCierre === 'liquidar' && !mesa.socios && costo > 0 && (
    (metodo === 'efectivo' && pagaConVal < costo) ||
    (metodo === 'transferencia' && !referencia.trim()) ||
    (metodo === 'qr' && !referencia.trim())
  ));

  return (
    <div className="modal-overlay" onClick={handleClose}>
      <style>{`
        @keyframes fadeInScale {
          from {
            opacity: 0;
            transform: scale(0.96) translateY(4px);
          }
          to {
            opacity: 1;
            transform: scale(1) translateY(0);
          }
        }
      `}</style>
      <div className="modal" onClick={e => e.stopPropagation()} style={{
        position: 'relative',
        maxWidth: 400,
        maxHeight: '96vh',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        border: preTicketFlash ? '2px solid #39ff14' : '1px solid var(--border)',
        boxShadow: preTicketFlash ? '0 0 25px rgba(57, 255, 20, 0.45)' : 'none',
        transition: 'all 0.25s ease-in-out',
        animation: 'fadeInScale 0.25s cubic-bezier(0.16, 1, 0.3, 1)'
      }}>
        {procesandoCierre && (
          <div style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(13,13,15,0.7)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 10000,
            borderRadius: 'inherit'
          }}>
            <div className="ri-loader-4-line ri-spin" style={{ fontSize: 32, color: 'var(--danger)', marginBottom: 12 }} />
            <div style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>Procesando Cobro...</div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}>Por favor espere un momento</div>
          </div>
        )}
        <div className="modal-header" style={{ padding: '6px 12px' }}>
          <span className="modal-title" style={{ fontSize: 11 }}><i className="ri-stop-circle-line" style={{ marginRight: 6, color: 'var(--danger)' }} />Cerrar {mesa.nombre}</span>
          <button onClick={handleClose} className="btn btn-secondary" style={{ background: 'none', border: 'none', padding: 2 }}>
            <i className="ri-close-line" style={{ fontSize: 18 }} />
          </button>
        </div>
        <div className="modal-body" style={{ padding: '6px 12px', overflowY: 'auto', flex: 1 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {/* Resumen */}
            <div
              onMouseEnter={e => {
                e.currentTarget.style.borderColor = 'rgba(57, 255, 20, 0.35)';
                e.currentTarget.style.boxShadow = '0 0 15px rgba(57, 255, 20, 0.15)';
              }}
              onMouseLeave={e => {
                e.currentTarget.style.borderColor = 'transparent';
                e.currentTarget.style.boxShadow = 'none';
              }}
              style={{
                background: 'var(--bg-elevated)',
                borderRadius: 10,
                padding: '6px 10px',
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: 4,
                border: '1px solid transparent',
                transition: 'all 0.25s ease-in-out'
              }}
            >
              <div>
                <div style={{ fontSize: 8, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 1 }}>Tiempo</div>
                <div style={{ fontFamily: 'var(--font-display)', fontSize: 14, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--bronze-light)' }}>{formatTime(elapsed)}</div>
                <div style={{ fontSize: 8, color: 'var(--text-muted)' }}>{hrs} hrs · ${Math.round(mesa.tarifa).toLocaleString('es-MX')}/hr</div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                <div style={{ fontSize: 8, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 2 }}>Total de Mesa</div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 3, lineHeight: 1 }}>
                  <span style={{
                    fontFamily: 'var(--font-display)',
                    fontSize: 'clamp(20px, 4.5vw, 28px)',
                    fontWeight: 950,
                    color: mesa.socios && costo === 0 ? 'var(--success)' : '#39ff14',
                    textShadow: mesa.socios && costo === 0 ? 'none' : '0 0 10px rgba(57, 255, 20, 0.35)'
                  }}>
                    {mesa.socios && costo === 0 ? 'SOCIO' : `$${Math.round(costo).toLocaleString('es-MX')}`}
                  </span>
                  {(!mesa.socios || costo > 0) && <span style={{ fontSize: 9, color: 'var(--text-muted)', fontWeight: 700, textShadow: 'none' }}>MXN</span>}
                </div>
              </div>
            </div>

            {/* Breakdown de consumos if any */}
            {consumosTotal > 0 && (
              <div style={{ background: 'var(--bg-elevated)', borderRadius: 10, padding: '6px 10px', fontSize: 9.5, border: '1px solid var(--border)' }}>
                <div style={{ fontWeight: 'bold', color: 'var(--bronze-light)', marginBottom: 4 }}>Detalle de Consumos:</div>
                <ul style={{ margin: 0, paddingLeft: 14, color: 'var(--text-muted)' }}>
                  {!mesa.socios && <li>Tiempo de juego: ${Math.round(costoTiempo).toLocaleString('es-MX')}</li>}
                  {(cuentaAsociada?.consumos || []).map((item, idx) => (
                    <li key={idx}>{item.cantidad}x {item.producto} (${Math.round(item.precio * item.cantidad).toLocaleString('es-MX')})</li>
                  ))}
                </ul>
              </div>
            )}

            {(mesa.rentarTaco || mesa.rentarBolas || mesa.rentarTiza) && (
              <div style={{ fontSize: 9, color: 'var(--bronze-light)', padding: '4px 8px', background: 'var(--bg-elevated)', borderRadius: 8, border: '1px solid var(--border)' }}>
                <strong>Equipamiento Rentado:</strong>
                <ul style={{ margin: '4px 0 0 14px', padding: 0, fontSize: 8, color: 'var(--text-muted)' }}>
                  {mesa.rentarTaco && (
                    <li>
                      {(globalRentaExtras && globalRentaExtras.find(e => e.id === 'taco')?.nombre) || 'Taco de Carbono'}{' '}
                      (+${(globalRentaExtras && globalRentaExtras.find(e => e.id === 'taco')?.precio) || 25}
                      /{(globalRentaExtras && globalRentaExtras.find(e => e.id === 'taco')?.tipo) === 'hora' ? 'hr' : 'única'})
                    </li>
                  )}
                  {mesa.rentarBolas && (
                    <li>
                      {(globalRentaExtras && globalRentaExtras.find(e => e.id === 'bolas')?.nombre) || 'Bolas Aramith'}{' '}
                      (+${(globalRentaExtras && globalRentaExtras.find(e => e.id === 'bolas')?.precio) || 35}
                      /{(globalRentaExtras && globalRentaExtras.find(e => e.id === 'bolas')?.tipo) === 'hora' ? 'hr' : 'única'})
                    </li>
                  )}
                  {mesa.rentarTiza && (
                    <li>
                      {(globalRentaExtras && globalRentaExtras.find(e => e.id === 'tiza')?.nombre) || 'Tiza Kamui'}{' '}
                      (+${(globalRentaExtras && globalRentaExtras.find(e => e.id === 'tiza')?.precio) || 10}
                      /{(globalRentaExtras && globalRentaExtras.find(e => e.id === 'tiza')?.tipo) === 'hora' ? 'hr' : 'única'})
                    </li>
                  )}
                </ul>
              </div>
            )}

            {/* Opciones de Cierre */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
              <button
                className={`btn btn-sm ${tipoCierre === 'liquidar' ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setTipoCierre('liquidar')}
                style={{ flex: 1, padding: '3px 6px', fontSize: 9.5 }}
              >
                Liquidar Ahora
              </button>
              <button
                className={`btn btn-sm ${tipoCierre === 'cuenta' ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setTipoCierre('cuenta')}
                style={{ flex: 1, padding: '3px 6px', fontSize: 9.5 }}
              >
                Agregar a Cuenta
              </button>
            </div>

            {/* Panel de Liquidación */}
            {tipoCierre === 'liquidar' ? (
              <>
                <div style={{ fontSize: 10, color: 'var(--text-secondary)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '2px 0' }}>
                  <span>
                    <i className="ri-user-line" style={{ marginRight: 4 }} />
                    {mesa.cliente || 'Público General'}
                  </span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    {mesa.preTicketImpreso && (
                      <span style={{ fontSize: 8.5, color: 'var(--success)', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: 1 }}>
                        <i className="ri-checkbox-circle-line" /> Impreso
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={handleImprimirPreTicket}
                      onMouseEnter={e => {
                        e.currentTarget.style.borderColor = 'var(--border-bronze)';
                        e.currentTarget.style.color = 'var(--bronze-light)';
                        e.currentTarget.style.boxShadow = '0 0 8px rgba(197, 168, 128, 0.2)';
                      }}
                      onMouseLeave={e => {
                        e.currentTarget.style.borderColor = 'var(--border)';
                        e.currentTarget.style.color = 'var(--text-secondary)';
                        e.currentTarget.style.boxShadow = 'none';
                      }}
                      className="btn btn-secondary btn-sm"
                      style={{
                        padding: '3px 6px',
                        fontSize: 8.5,
                        background: preTicketFlash ? 'rgba(57, 255, 20, 0.1)' : 'var(--bg-hover)',
                        border: preTicketFlash ? '1px solid #39ff14' : '1px solid var(--border)',
                        color: preTicketFlash ? '#39ff14' : 'var(--text-secondary)',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 2,
                        transition: 'all 0.2s ease-in-out',
                        borderRadius: 6,
                        boxShadow: preTicketFlash ? '0 0 12px rgba(57, 255, 20, 0.5)' : 'none',
                        transform: preTicketFlash ? 'scale(1.02)' : 'none'
                      }}
                      title="Imprimir Pre-Ticket"
                    >
                      <i className="ri-printer-line" style={{ fontSize: 9.5 }} /> {mesa.preTicketImpreso ? 'Reimprimir' : 'Pre-Ticket'}
                    </button>
                  </div>
                </div>

                {!mesa.socios && (
                  <div className="form-group" style={{ gap: 2 }}>
                    <label className="form-label" style={{ fontSize: 8.5, marginBottom: 1 }}>Método de Pago</label>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 3 }}>
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
                            background: metodo === m.id ? 'rgba(57, 255, 20, 0.08)' : 'var(--bg-elevated)',
                            border: `1px solid ${metodo === m.id ? '#39ff14' : 'var(--border)'}`,
                            borderRadius: 6, padding: '4px 2px', cursor: 'pointer',
                            color: metodo === m.id ? '#39ff14' : 'var(--text-secondary)',
                            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1,
                            fontSize: 7.5, fontWeight: 600, transition: 'all 0.15s',
                            boxShadow: metodo === m.id ? '0 0 10px rgba(57, 255, 20, 0.2)' : 'none',
                            transform: metodo === m.id ? 'scale(1.04)' : 'none',
                          }}
                        >
                          <i className={m.icon} style={{ fontSize: 11 }} />
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
                            style={{
                              padding: '6px 10px',
                              fontSize: 12,
                              borderColor: pagaConVal >= costo ? (pagaConVal > costo * 10 ? '#f97316' : '#39ff14') : 'var(--border)',
                              boxShadow: pagaConVal >= costo ? (pagaConVal > costo * 10 ? '0 0 8px rgba(249, 115, 22, 0.25)' : '0 0 8px rgba(57, 255, 20, 0.25)') : 'none',
                              transition: 'all 0.2s ease-in-out'
                            }}
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
                                {b === costo ? `Exacto ($${Math.round(b).toLocaleString('es-MX')})` : `$${Math.round(b).toLocaleString('es-MX')}`}
                              </button>
                            ))}
                          </div>
                        </div>
                        {pagaConVal > 0 && (
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid var(--border)', paddingTop: 6, marginTop: 2 }}>
                            <span style={{ fontSize: 10, color: 'var(--text-secondary)' }}>Cambio a Entregar:</span>
                            <span style={{
                              fontFamily: 'var(--font-display)',
                              fontSize: 19,
                              fontWeight: 950,
                              color: pagaConVal >= costo ? '#39ff14' : 'var(--danger)',
                              textShadow: pagaConVal >= costo ? '0 0 10px rgba(57, 255, 20, 0.35)' : 'none',
                              letterSpacing: '0.02em'
                            }}>
                              {pagaConVal >= costo ? `$${Math.round(cambio).toLocaleString('es-MX')} MXN` : 'Monto insuficiente'}
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
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <label className="form-label" style={{ fontSize: 9, marginBottom: 0 }}>Seleccionar Cuenta Activa</label>
                    {cuentaAsociada && !cuentaAsociada.isDefaultNullObject && (
                      <span style={{ fontSize: 8, color: 'var(--success)', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: 2 }}>
                        <i className="ri-checkbox-circle-fill" /> Cuenta detectada ✓
                      </span>
                    )}
                  </div>
                  <select
                    className="form-select"
                    style={{ padding: '6px 10px', fontSize: 11, height: 'auto' }}
                    value={cuentaSeleccionada}
                    onChange={e => {
                      const val = e.target.value;
                      setCuentaSeleccionada(val);
                      if (val !== '') {
                        const targetObj = cuentasActivas.find(c => String(c.id) === String(val));
                        const isGeneric = targetObj ? !isRealName(targetObj.cliente) : false;
                        if (!isGeneric) {
                          setNuevoCliente('');
                        } else {
                          const name = mesa.cliente || '';
                          setNuevoCliente(isRealName(name) ? name : '');
                        }
                      } else {
                        const name = mesa.cliente || '';
                        setNuevoCliente(isRealName(name) ? name : '');
                      }
                    }}
                  >
                    <option value="">-- Crear nueva cuenta temporal --</option>
                    {cuentasActivas.map(c => (
                      <option key={c.id} value={c.id}>{c.cliente} (Acumulado: ${c.tiempoJuego + c.consumos.reduce((s,i)=>s+i.precio*i.cantidad,0)} MXN)</option>
                    ))}
                  </select>
                </div>

                {(cuentaSeleccionada === '' || isSelectedGeneric) && (
                  <>
                    <div className="form-group" style={{ gap: 2 }}>
                      <label className="form-label" style={{ fontSize: 9 }}>
                        {cuentaSeleccionada === '' 
                          ? 'Nombre del Nuevo Cliente Temporal' 
                          : 'Asignar Nombre Real al Cliente de la Cuenta'}
                      </label>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <input
                          ref={inputNuevoClienteRef}
                          className="form-input"
                          style={{ padding: '6px 10px', fontSize: 11, flex: 1 }}
                          placeholder="Ej: Pedro Domínguez"
                          value={nuevoCliente}
                          onChange={e => { setNuevoCliente(e.target.value); setLimiteCoincidencias(3); }}
                          list="clientes-nuevo-list"
                          onKeyDown={e => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              if (!((cuentaSeleccionada === '' || isSelectedGeneric) && !nuevoCliente.trim())) {
                                const btn = document.getElementById('btn-guardar-cuenta-mesa');
                                btn?.click();
                              }
                            }
                          }}
                        />
                        <button
                          type="button"
                          className="btn btn-secondary"
                          style={{ padding: '4px 8px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                          title="Registrar en catálogo de clientes"
                          onClick={() => {
                            const nameClean = capitalizeName(nuevoCliente);
                            if (!isRealName(nameClean)) {
                              showToast('Debe ingresar un nombre real y no genérico.', 'warning');
                              return;
                            }
                            const existe = clientesRegistrados.some(c => c.nombre.toLowerCase() === nameClean.toLowerCase());
                            if (existe) {
                              showToast(`"${nameClean}" ya está en el catálogo.`, 'info');
                            } else {
                              registrarNuevoClienteDirectorio(nameClean);
                            }
                          }}
                        >
                          <i className="ri-user-add-line" style={{ fontSize: 12 }} />
                        </button>
                      </div>
                      {/* Coincidencias rápidas del catálogo */}
                      {nuevoCliente.trim().length >= 1 && getFilteredClientes(nuevoCliente).length > 0 && (
                        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 2 }}>
                          <span style={{ fontSize: 8, color: 'var(--text-muted)', alignSelf: 'center' }}>Catálogo:</span>
                          {getFilteredClientes(nuevoCliente).slice(0, 3).map((cli, idx) => (
                            <button
                              key={idx}
                              type="button"
                              onClick={() => {
                                setNuevoCliente(cli.nombre);
                                showToast(`Cliente "${cli.nombre}" seleccionado ✓`, 'info');
                              }}
                              style={{
                                background: 'var(--bg-hover)',
                                border: '1px solid var(--border)',
                                borderRadius: 4,
                                padding: '2px 6px',
                                fontSize: 8.5,
                                color: 'var(--bronze-light)',
                                cursor: 'pointer',
                                transition: 'all 0.15s'
                              }}
                              onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--bronze-light)'}
                              onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border)'}
                            >
                              {cli.nombre}
                            </button>
                          ))}
                        </div>
                      )}
                      {nuevoCliente.trim().length >= 2 ? (
                        getMatchingActiveAccounts(nuevoCliente).length > 0 && (
                          <div style={{
                            background: 'rgba(205,127,50,0.08)',
                            border: '1px solid rgba(205,127,50,0.3)',
                            borderRadius: 8,
                            padding: '8px 10px',
                            marginTop: 6,
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 4
                          }}>
                            <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--bronze-light)', marginBottom: 2 }}>
                              📌 ANEXAR A CUENTA ACTIVA EXISTENTE:
                            </div>
                            {getMatchingActiveAccounts(nuevoCliente).slice(0, limiteCoincidencias).map(c => {
                              const totalConsumos = c.consumos.reduce((sumItem, i) => sumItem + i.precio * i.cantidad, 0);
                              return (
                                <button
                                  key={c.id}
                                  type="button"
                                  onClick={() => {
                                    setCuentaSeleccionada(c.id);
                                    setNuevoCliente('');
                                    showToast(`Cuenta de ${getCleanClientName(c.cliente)} seleccionada ✓`, 'info');
                                  }}
                                  style={{
                                    background: 'linear-gradient(135deg, rgba(205,127,50,0.12), rgba(15,13,12,0.95))',
                                    border: '1px solid var(--border-bronze, rgba(205,127,50,0.5))',
                                    borderRadius: 8,
                                    padding: '6px 10px',
                                    fontSize: 11,
                                    textAlign: 'left',
                                    cursor: 'pointer',
                                    color: '#fff',
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    alignItems: 'center',
                                    transition: 'all 0.2s ease',
                                    boxShadow: '0 2px 8px rgba(0,0,0,0.2)'
                                  }}
                                  onMouseEnter={e => {
                                    e.currentTarget.style.borderColor = 'var(--bronze-light)';
                                    e.currentTarget.style.transform = 'translateY(-1px)';
                                    e.currentTarget.style.boxShadow = '0 4px 12px rgba(205,127,50,0.2)';
                                  }}
                                  onMouseLeave={e => {
                                    e.currentTarget.style.borderColor = 'rgba(205,127,50,0.5)';
                                    e.currentTarget.style.transform = 'none';
                                    e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.2)';
                                  }}
                                >
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                                    <span style={{ fontWeight: 700 }}>👤 {c.cliente}</span>
                                    <span style={{ fontSize: 8, color: 'var(--text-muted)' }}>
                                      Juego: ${c.tiempoJuego} | Consumo: ${totalConsumos}
                                    </span>
                                  </div>
                                  <span style={{ fontSize: 9, color: 'var(--bronze-light)', fontWeight: 'bold' }}>
                                    ${c.tiempoJuego + totalConsumos} MXN
                                  </span>
                                </button>
                              );
                            })}
                            {getMatchingActiveAccounts(nuevoCliente).length > limiteCoincidencias && (
                              <button
                                type="button"
                                onClick={() => setLimiteCoincidencias(999)}
                                style={{
                                  background: 'none',
                                  border: 'none',
                                  color: 'var(--bronze-light)',
                                  fontSize: 10,
                                  fontWeight: 700,
                                  cursor: 'pointer',
                                  padding: '4px 0',
                                  textAlign: 'center',
                                  textDecoration: 'underline'
                                }}
                              >
                                Ver más (+{getMatchingActiveAccounts(nuevoCliente).length - limiteCoincidencias})
                              </button>
                            )}
                          </div>
                        )
                      ) : (
                        getRecientesActiveAccounts().length > 0 && (
                          <div style={{
                            background: 'rgba(255,255,255,0.02)',
                            border: '1px dashed var(--border)',
                            borderRadius: 8,
                            padding: '8px 10px',
                            marginTop: 6,
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 4
                          }}>
                            <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 2 }}>
                              🕒 CUENTAS CERRADAS RECIENTEMENTE:
                            </div>
                            {getRecientesActiveAccounts().map(c => {
                              const totalConsumos = c.consumos.reduce((sumItem, i) => sumItem + i.precio * i.cantidad, 0);
                              return (
                                <button
                                  key={c.id}
                                  type="button"
                                  onClick={() => {
                                    setCuentaSeleccionada(c.id);
                                    setNuevoCliente('');
                                    showToast(`Cuenta de ${getCleanClientName(c.cliente)} seleccionada ✓`, 'info');
                                  }}
                                  style={{
                                    background: 'var(--bg-elevated)',
                                    border: '1px solid var(--border)',
                                    borderRadius: 6,
                                    padding: '6px 10px',
                                    fontSize: 11,
                                    textAlign: 'left',
                                    cursor: 'pointer',
                                    color: '#fff',
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    alignItems: 'center',
                                    transition: 'all 0.15s ease'
                                  }}
                                  onMouseEnter={e => {
                                    e.currentTarget.style.borderColor = 'var(--bronze-light)';
                                  }}
                                  onMouseLeave={e => {
                                    e.currentTarget.style.borderColor = 'var(--border)';
                                  }}
                                >
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                                    <span style={{ fontWeight: 700 }}>👤 {c.cliente}</span>
                                    <span style={{ fontSize: 8, color: 'var(--text-muted)' }}>
                                      Juego: ${c.tiempoJuego} | Consumo: ${totalConsumos}
                                    </span>
                                  </div>
                                  <span style={{ fontSize: 9, color: 'var(--bronze-light)', fontWeight: 'bold' }}>
                                    ${c.tiempoJuego + totalConsumos} MXN
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        )
                      )}
                      <datalist id="clientes-nuevo-list">
                        {getFilteredClientes(nuevoCliente).map((c, idx) => (
                          <option key={idx} value={c.nombre} />
                        ))}
                      </datalist>
                    </div>
                    {!isRealName(nuevoCliente) && (
                      <div style={{ color: 'var(--danger)', fontSize: 9, marginTop: 2 }}>
                        <i className="ri-error-warning-line" style={{ marginRight: 2 }} />
                        Debe ingresar un nombre real y no genérico para evitar cuentas huérfanas.
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        </div>
        <div className="modal-footer" style={{ padding: '8px 12px' }}>
          <button className="btn btn-secondary" style={{ padding: '4px 8px', fontSize: 9.5 }} onClick={handleClose}>Cancelar</button>
          {tipoCierre === 'liquidar' ? (
            <div style={{ display: 'flex', gap: 6, flex: 1 }}>
                <button
                  className="btn btn-secondary"
                  onClick={() => {
                    const isGeneric = !mesa.cliente || ['público', 'publico', 'público general', 'publico general'].includes(mesa.cliente.toLowerCase()) || mesa.cliente.toLowerCase() === `mesa ${mesa.id}`;
                    setNombrePagador(isGeneric ? '' : mesa.cliente);
                    setShowPromptMoverPendiente(true);
                  }}
                  onMouseEnter={e => {
                    e.currentTarget.style.boxShadow = '0 0 15px rgba(249, 115, 22, 0.4)';
                    e.currentTarget.style.borderColor = '#f97316';
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.boxShadow = 'none';
                    e.currentTarget.style.borderColor = 'transparent';
                  }}
                  style={{
                    background: 'linear-gradient(135deg, var(--bronze-light), var(--bronze))',
                    color: '#fff',
                    padding: '4px 8px',
                    fontSize: 9.5,
                    flex: 1,
                    border: '1px solid transparent',
                    transition: 'all 0.3s ease-in-out'
                  }}
                >
                  <i className="ri-folder-shared-line" /> Mover a Pendiente
                </button>
                <button
                  className="btn btn-primary"
                  onClick={() => {
                    if (costo === 0 && !mesa.socios) {
                      // Requiere motivo para cortesía
                      setShowMotivoCortesia(true);
                    } else {
                      onCerrar({ costo, metodo, tiempo: elapsed, referencia, pagaCon: pagaConVal, cambio, fotoAdjunta: !!fotoComprobante, motivo: '' });
                    }
                  }}
                  disabled={isCerrarDisabled}
                  style={{ 
                    background: isCerrarDisabled ? 'var(--bg-hover)' : costo === 0 ? 'linear-gradient(135deg, #f97316, #fb923c)' : 'linear-gradient(135deg, var(--danger), #ff6b6b)', 
                    padding: '4px 8px', 
                    fontSize: 9.5,
                    cursor: isCerrarDisabled ? 'not-allowed' : 'pointer',
                    flex: 1,
                    boxShadow: !isCerrarDisabled && (metodo !== 'efectivo' || pagaConVal >= costo) ? '0 0 15px rgba(57, 255, 20, 0.45)' : 'none',
                    border: !isCerrarDisabled && (metodo !== 'efectivo' || pagaConVal >= costo) ? '1px solid #39ff14' : '1px solid transparent',
                    transition: 'all 0.3s ease-in-out'
                  }}
                >
                  <i className={procesandoCierre ? "ri-loader-4-line ri-spin" : "ri-stop-circle-line"} /> {procesandoCierre ? 'Procesando...' : (costo === 0 ? 'Registrar Cortesía' : 'Cerrar y Cobrar')}
                </button>

                {/* Modal de Motivo para Cortesía $0 */}
                {showMotivoCortesia && (
                  <div className="modal-overlay" style={{ zIndex: 2100 }} onClick={() => setShowMotivoCortesia(false)}>
                    <div className="modal" style={{ maxWidth: 380 }} onClick={e => e.stopPropagation()}>
                      <div className="modal-header">
                        <span className="modal-title" style={{ color: '#f97316', display: 'flex', alignItems: 'center', gap: 8 }}>
                          <i className="ri-file-text-line" /> Motivo de Cortesía
                        </span>
                      </div>
                      <div className="modal-body">
                        <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 12 }}>
                          Esta mesa se cerrará en <strong style={{ color: '#f97316' }}>$0 MXN</strong>. Selecciona o escribe el motivo para el registro de auditoría:
                        </p>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
                          {MOTIVOS_CORTESIA.map(m => (
                            <button
                              key={m}
                              className="btn btn-secondary"
                              style={{
                                textAlign: 'left', fontSize: 9.5, padding: '5px 10px',
                                background: motivoCortesia === m ? 'rgba(249,115,22,0.15)' : undefined,
                                border: motivoCortesia === m ? '1px solid rgba(249,115,22,0.5)' : undefined,
                                color: motivoCortesia === m ? '#f97316' : undefined,
                              }}
                              onClick={() => setMotivoCortesia(m)}
                            >
                              {motivoCortesia === m ? '✓ ' : ''}{m}
                            </button>
                          ))}
                        </div>
                        <textarea
                          className="form-input"
                          placeholder="O escribe un motivo personalizado..."
                          style={{ width: '100%', minHeight: 60, fontSize: 11, resize: 'vertical' }}
                          value={MOTIVOS_CORTESIA.includes(motivoCortesia) ? '' : motivoCortesia}
                          onChange={e => setMotivoCortesia(e.target.value)}
                        />
                      </div>
                      <div className="modal-footer" style={{ padding: '8px 12px' }}>
                        <button className="btn btn-secondary" style={{ padding: '4px 8px', fontSize: 9.5 }} onClick={() => setShowMotivoCortesia(false)} disabled={procesandoCierre}>Cancelar</button>
                        <button
                          className="btn btn-primary"
                          style={{ background: 'linear-gradient(135deg, #f97316, #fb923c)', padding: '4px 8px', fontSize: 9.5 }}
                          disabled={!motivoCortesia.trim() || procesandoCierre}
                          onClick={() => {
                            setShowMotivoCortesia(false);
                            onCerrar({ costo: 0, metodo: 'cortesia', tiempo: elapsed, referencia: motivoCortesia.trim(), pagaCon: 0, cambio: 0, fotoAdjunta: false, motivo: motivoCortesia.trim() });
                          }}
                        >
                          <i className={procesandoCierre ? "ri-loader-4-line ri-spin" : "ri-check-line"} /> {procesandoCierre ? 'Procesando...' : 'Confirmar Cortesía'}
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* Modal/Prompt para Nombre de Pago al Mover a Pendiente */}
                {showPromptMoverPendiente && (
                  <div className="modal-overlay" style={{ zIndex: 2100 }} onClick={() => { setShowPromptMoverPendiente(false); setCuentaMoverId(null); }}>
                    <div className="modal" style={{ maxWidth: 380, animation: 'scaleUpAlert 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)' }} onClick={e => e.stopPropagation()}>
                      <div className="modal-header">
                        <span className="modal-title" style={{ color: 'var(--bronze-light)', display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, fontWeight: 900 }}>
                          <i className="ri-user-shared-line" /> Mover a Pendientes
                        </span>
                        <button onClick={() => { setShowPromptMoverPendiente(false); setCuentaMoverId(null); }} className="btn btn-secondary" style={{ background: 'none', border: 'none', padding: 2 }}>
                          <i className="ri-close-line" style={{ fontSize: 18 }} />
                        </button>
                      </div>
                      <div className="modal-body" style={{ padding: '12px 0' }}>
                        <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 12, lineHeight: 1.4 }}>
                          Para mover la cuenta de la <strong style={{ color: 'var(--bronze-light)' }}>Mesa {mesa.id}</strong> a pendientes, es obligatorio ingresar el nombre de la persona que pagará:
                        </p>
                        <div className="form-group" style={{ gap: 2 }}>
                          <label className="form-label" style={{ fontSize: 10 }}>Nombre del Pagador</label>
                          <div style={{ display: 'flex', gap: 4 }}>
                             <input
                              type="text"
                              className="form-input"
                              style={{ padding: '8px 12px', fontSize: 13, flex: 1 }}
                              placeholder="Ej: Carlos Rodríguez / Amigo de Juan"
                              value={nombrePagador}
                              onChange={e => { setNombrePagador(e.target.value); setCuentaMoverId(null); setLimiteCoincidenciasMover(3); }}
                              list="clientes-pagador-list"
                              autoFocus
                            />
                            <button
                              type="button"
                              className="btn btn-secondary"
                              style={{ padding: '8px 12px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                              title="Registrar en catálogo de clientes"
                              onClick={() => {
                                const nameClean = capitalizeName(nombrePagador);
                                if (!isRealName(nameClean)) {
                                  showToast('Debe ingresar un nombre real y no genérico.', 'warning');
                                  return;
                                }
                                const existe = clientesRegistrados.some(c => c.nombre.toLowerCase() === nameClean.toLowerCase());
                                if (existe) {
                                  showToast(`"${nameClean}" ya está en el catálogo.`, 'info');
                                } else {
                                  registrarNuevoClienteDirectorio(nameClean);
                                }
                              }}
                            >
                              <i className="ri-user-add-line" style={{ fontSize: 14 }} />
                            </button>
                          </div>
                          {nombrePagador.trim().length >= 2 ? (
                            getMatchingActiveAccounts(nombrePagador).length > 0 && (
                              <div style={{
                                background: 'rgba(205,127,50,0.08)',
                                border: '1px solid rgba(205,127,50,0.3)',
                                borderRadius: 8,
                                padding: '8px 10px',
                                marginTop: 6,
                                display: 'flex',
                                flexDirection: 'column',
                                gap: 4
                              }}>
                                <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--bronze-light)', marginBottom: 2 }}>
                                  📌 ANEXAR A CUENTA ACTIVA EXISTENTE (Click para anexar):
                                </div>
                                {getMatchingActiveAccounts(nombrePagador).slice(0, limiteCoincidenciasMover).map(c => {
                                  const totalConsumos = c.consumos.reduce((sumItem, i) => sumItem + i.precio * i.cantidad, 0);
                                  return (
                                    <button
                                      key={c.id}
                                      type="button"
                                      onClick={() => {
                                        setNombrePagador(getCleanClientName(c.cliente));
                                        setCuentaMoverId(c.id);
                                        showToast(`Vinculado a la cuenta existente de ${getCleanClientName(c.cliente)} ✓`, 'info');
                                      }}
                                      style={{
                                        background: 'linear-gradient(135deg, rgba(205,127,50,0.12), rgba(15,13,12,0.95))',
                                        border: '1px solid var(--border-bronze, rgba(205,127,50,0.5))',
                                        borderRadius: 8,
                                        padding: '6px 10px',
                                        fontSize: 11,
                                        textAlign: 'left',
                                        cursor: 'pointer',
                                        color: '#fff',
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        alignItems: 'center',
                                        transition: 'all 0.2s ease',
                                        boxShadow: '0 2px 8px rgba(0,0,0,0.2)'
                                      }}
                                      onMouseEnter={e => {
                                        e.currentTarget.style.borderColor = 'var(--bronze-light)';
                                        e.currentTarget.style.transform = 'translateY(-1px)';
                                        e.currentTarget.style.boxShadow = '0 4px 12px rgba(205,127,50,0.2)';
                                      }}
                                      onMouseLeave={e => {
                                        e.currentTarget.style.borderColor = 'rgba(205,127,50,0.5)';
                                        e.currentTarget.style.transform = 'none';
                                        e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.2)';
                                      }}
                                    >
                                      <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                                        <span style={{ fontWeight: 700 }}>👤 {c.cliente}</span>
                                        <span style={{ fontSize: 8, color: 'var(--text-muted)' }}>
                                          Juego: ${c.tiempoJuego} | Consumo: ${totalConsumos}
                                        </span>
                                      </div>
                                      <span style={{ fontSize: 9, color: 'var(--bronze-light)', fontWeight: 'bold' }}>
                                        ${c.tiempoJuego + totalConsumos} MXN
                                      </span>
                                    </button>
                                  );
                                })}
                                {getMatchingActiveAccounts(nombrePagador).length > limiteCoincidenciasMover && (
                                  <button
                                    type="button"
                                    onClick={() => setLimiteCoincidenciasMover(999)}
                                    style={{
                                      background: 'none',
                                      border: 'none',
                                      color: 'var(--bronze-light)',
                                      fontSize: 10,
                                      fontWeight: 700,
                                      cursor: 'pointer',
                                      padding: '4px 0',
                                      textAlign: 'center',
                                      textDecoration: 'underline'
                                    }}
                                  >
                                    Ver más (+{getMatchingActiveAccounts(nombrePagador).length - limiteCoincidenciasMover})
                                  </button>
                                )}
                              </div>
                            )
                          ) : (
                            getRecientesActiveAccounts().length > 0 && (
                              <div style={{
                                background: 'rgba(255,255,255,0.02)',
                                border: '1px dashed var(--border)',
                                borderRadius: 8,
                                padding: '8px 10px',
                                marginTop: 6,
                                display: 'flex',
                                flexDirection: 'column',
                                gap: 4
                              }}>
                                <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 2 }}>
                                  🕒 CUENTAS CERRADAS RECIENTEMENTE:
                                </div>
                                {getRecientesActiveAccounts().map(c => {
                                  const totalConsumos = c.consumos.reduce((sumItem, i) => sumItem + i.precio * i.cantidad, 0);
                                  return (
                                    <button
                                      key={c.id}
                                      type="button"
                                      onClick={() => {
                                        setNombrePagador(getCleanClientName(c.cliente));
                                        setCuentaMoverId(c.id);
                                        showToast(`Vinculado a la cuenta existente de ${getCleanClientName(c.cliente)} ✓`, 'info');
                                      }}
                                      style={{
                                        background: 'var(--bg-elevated)',
                                        border: '1px solid var(--border)',
                                        borderRadius: 6,
                                        padding: '6px 10px',
                                        fontSize: 11,
                                        textAlign: 'left',
                                        cursor: 'pointer',
                                        color: '#fff',
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        alignItems: 'center',
                                        transition: 'all 0.15s ease'
                                      }}
                                      onMouseEnter={e => {
                                        e.currentTarget.style.borderColor = 'var(--bronze-light)';
                                      }}
                                      onMouseLeave={e => {
                                        e.currentTarget.style.borderColor = 'var(--border)';
                                      }}
                                    >
                                      <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                                        <span style={{ fontWeight: 700 }}>👤 {c.cliente}</span>
                                        <span style={{ fontSize: 8, color: 'var(--text-muted)' }}>
                                          Juego: ${c.tiempoJuego} | Consumo: ${totalConsumos}
                                        </span>
                                      </div>
                                      <span style={{ fontSize: 9, color: 'var(--bronze-light)', fontWeight: 'bold' }}>
                                        ${c.tiempoJuego + totalConsumos} MXN
                                      </span>
                                    </button>
                                  );
                                })}
                              </div>
                            )
                          )}
                          <datalist id="clientes-pagador-list">
                            {getFilteredClientes(nombrePagador).map((c, idx) => (
                              <option key={idx} value={c.nombre} />
                            ))}
                          </datalist>
                        </div>
                        {!isRealName(nombrePagador) && (
                          <div style={{ color: 'var(--danger)', fontSize: 9, marginTop: 4 }}>
                            <i className="ri-error-warning-line" style={{ marginRight: 2 }} />
                            Debe ingresar un nombre real y no genérico.
                          </div>
                        )}
                      </div>
                      <div className="modal-footer" style={{ display: 'flex', gap: 6, padding: '8px 12px' }}>
                        <button className="btn btn-secondary" onClick={() => { setShowPromptMoverPendiente(false); setCuentaMoverId(null); }} style={{ flex: 1, padding: '4px 8px', fontSize: 9.5 }}>Cancelar</button>
                        <button
                          className="btn btn-primary"
                          disabled={!nombrePagador.trim()}
                          onClick={() => {
                            const pagadorClean = capitalizeName(nombrePagador);
                            if (!isRealName(pagadorClean)) {
                              showToast('Debe ingresar un nombre real y no genérico para la cuenta.', 'warning');
                              registrarEvento('Intento Cuenta Genérica', `Intento de mover mesa ${mesa.id} a pendientes con pagador inválido: "${pagadorClean}"`);
                              return;
                            }
                            const existente = cuentasActivas.find(c => c.cliente && getCleanClientName(c.cliente).toLowerCase() === getCleanClientName(pagadorClean).toLowerCase());
                            if (existente) {
                              const existingMesaId = existente.mesaId;
                              if (existingMesaId && existingMesaId !== mesa.id) {
                                const associatedTable = mesas.find(m => m.id === existingMesaId && m.estado === 'ocupada');
                                if (associatedTable) {
                                  const ok = window.confirm(`El cliente "${getCleanClientName(existente.cliente)}" ya tiene la Mesa ${existingMesaId} activa. ¿Deseas acumular esta sesión a su cuenta existente?`);
                                  if (!ok) return;
                                }
                              }
                            }
                            registrarNuevoClienteDirectorio(pagadorClean);
                            onAgregarACuenta({
                              costo: costoTiempo,
                              cuentaId: cuentaMoverId || (existente ? existente.id : (cuentaAsociada ? cuentaAsociada.id : null)),
                              nombreNuevo: `${pagadorClean} (Mesa ${mesa.id} - Pendiente)`
                            });
                            setShowPromptMoverPendiente(false);
                          }}
                          style={{
                            background: !nombrePagador.trim() ? 'var(--bg-hover)' : 'linear-gradient(135deg, var(--bronze-light), var(--bronze))',
                            color: '#fff',
                            cursor: !nombrePagador.trim() ? 'not-allowed' : 'pointer',
                            flex: 1,
                            padding: '4px 8px',
                            fontSize: 9.5
                          }}
                        >
                          <i className="ri-check-line" /> Confirmar y Mover
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
          ) : (
            <button
              id="btn-guardar-cuenta-mesa"
              className="btn btn-primary"
              disabled={(cuentaSeleccionada === '' || isSelectedGeneric) && !nuevoCliente.trim()}
              onClick={() => {
                if (cuentaSeleccionada === '' || isSelectedGeneric) {
                  const nameClean = capitalizeName(nuevoCliente);
                  if (!isRealName(nameClean)) {
                    showToast('Debe ingresar un nombre real y no genérico para la cuenta.', 'warning');
                    registrarEvento('Intento Cuenta Genérica', `Intento de guardar mesa ${mesa.id} en cuenta con nombre inválido: "${nameClean}"`);
                    return;
                  }
                  const existente = cuentasActivas.find(c => c.cliente && getCleanClientName(c.cliente).toLowerCase() === getCleanClientName(nameClean).toLowerCase());
                  if (existente) {
                    const existingMesaId = existente.mesaId;
                    if (existingMesaId && existingMesaId !== mesa.id) {
                      const associatedTable = mesas.find(m => m.id === existingMesaId && m.estado === 'ocupada');
                      if (associatedTable) {
                        const ok = window.confirm(`El cliente "${getCleanClientName(existente.cliente)}" ya tiene la Mesa ${existingMesaId} activa. ¿Deseas acumular esta sesión a su cuenta existente?`);
                        if (!ok) return;
                      }
                    }
                  }
                  registrarNuevoClienteDirectorio(nameClean);
                  onAgregarACuenta({
                    costo: costoTiempo,
                    cuentaId: existente ? existente.id : cuentaSeleccionada,
                    nombreNuevo: `${nameClean} (Mesa ${mesa.id} - Pendiente)`
                  });
                } else {
                  const targetCuentaObj = cuentasActivas.find(c => String(c.id) === String(cuentaSeleccionada));
                  if (targetCuentaObj) {
                    const existingMesaId = targetCuentaObj.mesaId;
                    if (existingMesaId && existingMesaId !== mesa.id) {
                      const associatedTable = mesas.find(m => m.id === existingMesaId && m.estado === 'ocupada');
                      if (associatedTable) {
                        const ok = window.confirm(`El cliente "${getCleanClientName(targetCuentaObj.cliente)}" ya tiene la Mesa ${existingMesaId} activa. ¿Confirmas que deseas acumular el consumo de la Mesa ${mesa.id} a su cuenta?`);
                        if (!ok) return;
                      }
                    }
                  }
                  onAgregarACuenta({
                    costo: costoTiempo,
                    cuentaId: cuentaSeleccionada,
                    nombreNuevo: ''
                  });
                }
              }}
              style={{
                background: ((cuentaSeleccionada === '' || isSelectedGeneric) && !nuevoCliente.trim())
                  ? 'var(--bg-hover)'
                  : 'linear-gradient(135deg, var(--bronze), var(--bronze-light))',
                padding: '4px 8px',
                fontSize: 9.5,
                flex: 1,
                cursor: ((cuentaSeleccionada === '' || isSelectedGeneric) && !nuevoCliente.trim())
                  ? 'not-allowed'
                  : 'pointer'
              }}
            >
              <i className="ri-folder-add-line" /> Guardar en Cuenta
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── MODAL COBRO EXITOSO ──────────────────────────────────
function ModalCobroExito({ data, onClose, imprimirTicketFinal }) {
  return (
    <div className="modal-overlay" onClick={onClose} style={{ zIndex: 3000 }}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 360, textAlign: 'center', padding: '24px 20px', borderRadius: 16 }}>
        <div style={{
          width: 56,
          height: 56,
          borderRadius: '50%',
          background: 'rgba(46, 213, 115, 0.1)',
          border: '2px solid var(--success)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          margin: '0 auto 16px',
          color: 'var(--success)',
          fontSize: 28
        }}>
          <i className="ri-checkbox-circle-fill" />
        </div>
        
        <h3 style={{ fontSize: 16, fontWeight: 800, color: '#fff', marginBottom: 6 }}>¡Mesa Cobrada con Éxito!</h3>
        <p style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 20 }}>
          La mesa ha sido liberada y el cobro se registró correctamente.
        </p>

        <div style={{
          background: 'var(--bg-elevated)',
          borderRadius: 12,
          padding: '12px 16px',
          marginBottom: 20,
          textAlign: 'left',
          display: 'flex',
          flexDirection: 'column',
          gap: 8
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
            <span style={{ color: 'var(--text-secondary)' }}>Mesa:</span>
            <strong style={{ color: '#fff' }}>{data.mesaNombre}</strong>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
            <span style={{ color: 'var(--text-secondary)' }}>Cliente:</span>
            <strong style={{ color: '#fff' }}>{data.cliente}</strong>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
            <span style={{ color: 'var(--text-secondary)' }}>Método de Pago:</span>
            <strong style={{ color: 'var(--bronze-light)' }}>{data.metodoPago}</strong>
          </div>
          <div style={{ height: '1px', background: 'var(--border)', margin: '4px 0' }} />
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, fontWeight: 900 }}>
            <span style={{ color: '#fff' }}>Total Cobrado:</span>
            <span style={{ color: 'var(--success)' }}>${data.total} MXN</span>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10 }}>
          <button
            className="btn btn-secondary"
            style={{ flex: 1, padding: '10px 14px', fontSize: 11, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, cursor: 'pointer' }}
            onClick={() => {
              try {
                imprimirTicketFinal(data.ticketData);
              } catch (err) {
                console.error("Error al reimprimir:", err);
              }
            }}
          >
            <i className="ri-printer-line" /> Reimprimir Ticket
          </button>
          <button
            className="btn btn-primary"
            style={{ flex: 1, padding: '10px 14px', fontSize: 11, background: 'linear-gradient(135deg, var(--success), #2ed573)', color: '#0d0d0f', fontWeight: 800, cursor: 'pointer' }}
            onClick={onClose}
          >
            Aceptar
          </button>
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

// Helper para obtener el icono visual del juego según el tipo de mesa
function getGameIcon(tipo, size = 18) {
  const t = (tipo || '').toLowerCase();
  if (t.includes('pool')) {
    return (
      <svg className="mesa-game-icon" viewBox="0 0 24 22" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ width: size, height: size, marginRight: 6, opacity: 0.85, flexShrink: 0 }}>
        <polygon points="12,1 23,20 1,20" stroke="var(--bronze-light, #c5a880)" strokeWidth="1.8" strokeLinejoin="round" fill="rgba(197,168,128,0.05)" />
        <circle cx="12" cy="7.5" r="2.2" fill="#eab308" />
        <circle cx="9.5" cy="12" r="2.2" fill="#3b82f6" />
        <circle cx="14.5" cy="12" r="2.2" fill="#ef4444" />
        <circle cx="7" cy="16.5" r="2.2" fill="#8b5cf6" />
        <circle cx="12" cy="16.5" r="2.2" fill="#f97316" />
        <circle cx="17" cy="16.5" r="2.2" fill="#22c55e" />
      </svg>
    );
  }
  if (t.includes('carambola')) {
    return (
      <svg className="mesa-game-icon" viewBox="0 0 24 22" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ width: size, height: size, marginRight: 6, opacity: 0.9, flexShrink: 0 }}>
        <defs>
          <radialGradient id="redBall" cx="30%" cy="30%" r="70%">
            <stop offset="0%" stopColor="#ff8888" />
            <stop offset="65%" stopColor="#dc2626" />
            <stop offset="100%" stopColor="#7f1d1d" />
          </radialGradient>
          <radialGradient id="yellowBall" cx="30%" cy="30%" r="70%">
            <stop offset="0%" stopColor="#fef08a" />
            <stop offset="65%" stopColor="#ca8a04" />
            <stop offset="100%" stopColor="#713f12" />
          </radialGradient>
          <radialGradient id="whiteBall" cx="30%" cy="30%" r="70%">
            <stop offset="0%" stopColor="#ffffff" />
            <stop offset="65%" stopColor="#cbd5e1" />
            <stop offset="100%" stopColor="#475569" />
          </radialGradient>
        </defs>
        <circle cx="12" cy="15" r="4.8" fill="url(#redBall)" />
        <circle cx="8.2" cy="9" r="4.8" fill="url(#yellowBall)" />
        <circle cx="15.8" cy="10" r="4.8" fill="url(#whiteBall)" />
        <circle cx="15.3" cy="9.5" r="0.7" fill="#ef4444" opacity="0.8" />
      </svg>
    );
  }
  if (t.includes('snooker')) {
    return (
      <svg className="mesa-game-icon" viewBox="0 0 24 22" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ width: size, height: size, marginRight: 6, opacity: 0.85, flexShrink: 0 }}>
        <polygon points="12,1 23,20 1,20" stroke="var(--bronze-light, #c5a880)" strokeWidth="1.2" strokeLinejoin="round" strokeDasharray="2 1.5" fill="rgba(197,168,128,0.03)" />
        <circle cx="12" cy="5.5" r="1.6" fill="#ef4444" />
        <circle cx="10" cy="9" r="1.6" fill="#ef4444" />
        <circle cx="14" cy="9" r="1.6" fill="#ef4444" />
        <circle cx="8" cy="12.5" r="1.6" fill="#ef4444" />
        <circle cx="12" cy="12.5" r="1.6" fill="#d97706" />
        <circle cx="16" cy="12.5" r="1.6" fill="#ef4444" />
        <circle cx="6" cy="16" r="1.6" fill="#ef4444" />
        <circle cx="10" cy="16" r="1.6" fill="#ef4444" />
        <circle cx="14" cy="16" r="1.6" fill="#ef4444" />
        <circle cx="18" cy="16" r="1.6" fill="#ef4444" />
      </svg>
    );
  }
  if (t.includes('domino') || t.includes('dominó')) {
    return (
      <svg className="mesa-game-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ width: size, height: size, marginRight: 6, opacity: 0.85, flexShrink: 0 }}>
        <rect x="3" y="6" width="18" height="12" rx="2" stroke="var(--bronze-light, #c5a880)" strokeWidth="1.5" fill="rgba(255,255,255,0.05)" />
        <line x1="12" y1="6" x2="12" y2="18" stroke="var(--bronze-light, #c5a880)" strokeWidth="1.5" />
        <circle cx="6.5" cy="9" r="1" fill="var(--bronze-light, #c5a880)" />
        <circle cx="8.5" cy="12" r="1" fill="var(--bronze-light, #c5a880)" />
        <circle cx="15.5" cy="9" r="1" fill="var(--bronze-light, #c5a880)" />
        <circle cx="15.5" cy="15" r="1" fill="var(--bronze-light, #c5a880)" />
        <circle cx="17.5" cy="9" r="1" fill="var(--bronze-light, #c5a880)" />
        <circle cx="17.5" cy="15" r="1" fill="var(--bronze-light, #c5a880)" />
      </svg>
    );
  }
  // Fallback: Tacos cruzados
  return (
    <svg className="mesa-game-icon" viewBox="0 0 24 22" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ width: size, height: size, marginRight: 6, opacity: 0.7, flexShrink: 0 }}>
      <line x1="2" y1="20" x2="22" y2="2" stroke="var(--bronze-light, #c5a880)" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="2" y1="2" x2="22" y2="20" stroke="var(--bronze-light, #c5a880)" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="12" cy="11" r="3" fill="#fff" />
    </svg>
  );
}

// ── EQUIPAMIENTO PREMIUM PARA RENTA MESA GLOBAL ──
let globalRentaExtras = [
  { id: 'taco', nombre: 'Taco de Fibra de Carbono', precio: 25, tipo: 'hora' },
  { id: 'bolas', nombre: 'Bolas Profesionales Aramith', precio: 35, tipo: 'hora' },
  { id: 'tiza', nombre: 'Tiza Kamui Especial', precio: 10, tipo: 'fijo' }
];

// ── PANEL PRINCIPAL DE MESAS ──────────────────────────────
export default function MesasPanel({ showToast }) {
  const { user } = useAuth();
  const [mesas, setMesas] = useState([]);
  const [procesandoCierre, setProcesandoCierre] = useState(false);
  const [cobroExito, setCobroExito] = useState(null);

  const getEncodedSalonId = () => {
    return encodeURIComponent(obfuscateStatic(getActiveSalonId()));
  };
  const [rentaExtras, setRentaExtras] = useState(globalRentaExtras);

  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'config', 'renta_extras'), snap => {
      if (snap.exists()) {
        const d = snap.data();
        if (d.extras) {
          setRentaExtras(d.extras);
          globalRentaExtras = d.extras;
        }
      }
    }, err => console.error("Error al escuchar extras de renta en MesasPanel:", err));
    return () => unsub();
  }, []);
  const isIncomingUpdateRef = useRef(false);
  const hasLoadedFromFirestoreRef = useRef(false);
  const mesasRef = useRef(mesas);
  const pendingLoadsRef = useRef([]);
  useEffect(() => {
    mesasRef.current = mesas;
  }, [mesas]);

  const enviarAlertaMesero = async (mesaId, cliente, etiqueta, tipo = 'asistencia', icono = '🔔') => {
    try {
      await addDoc(collection(db, 'mesa_pedidos'), {
        mesaId: String(mesaId),
        cliente: cliente || 'Cliente',
        etiqueta: etiqueta,
        tipo: tipo,
        icono: icono,
        estado: 'pendiente',
        atendidoMesero: false,
        createdAt: serverTimestamp()
      });
    } catch (err) {
      console.error("Error al enviar alerta a meseros:", err);
    }
  };

  const [meserosPresentes, setMeserosPresentes] = useState([]);
  const [empleadosTodos, setEmpleadosTodos] = useState([]);
  const [dropdownOpenMesa, setDropdownOpenMesa] = useState(null);

  useEffect(() => {
    let unsubAsist = null;
    const qEmp = query(collection(db, 'nomina_empleados'), where('estado', '==', 'activo'));
    const unsubEmp = onSnapshot(qEmp, snapEmp => {
      const activeEmployees = snapEmp.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setEmpleadosTodos(activeEmployees);
      
      if (unsubAsist) unsubAsist();
      
      const fechaHoy = getBusinessDate();
      const qAsist = query(collection(db, 'nomina_asistencia'), where('fecha', '==', fechaHoy));
      unsubAsist = onSnapshot(qAsist, snapAsist => {
        const presentIds = snapAsist.docs
          .map(doc => doc.data())
          .filter(a => a.estado === 'presente' || a.estado === 'tardanza')
          .map(a => a.empleadoId);

        const presentWaiters = activeEmployees.filter(emp => 
          presentIds.includes(emp.id) &&
          ((emp.rol || emp.role || '').toLowerCase().includes('mesero') || (emp.rol || emp.role || '').toLowerCase().includes('staff') || !(emp.rol || emp.role))
        );
        setMeserosPresentes(presentWaiters);
      }, err => console.warn("Error loading attendance:", err));
    }, err => console.warn("Error loading employees:", err));

    return () => {
      unsubEmp();
      if (unsubAsist) unsubAsist();
    };
  }, []);

  const handleToggleMeseroMesa = async (mesaId, meseroId, meseroNombre) => {
    const mesa = mesasRef.current.find(m => m.id === mesaId);
    if (!mesa) return;

    let currentIds = mesa.meseroIds || [];
    let currentNombres = mesa.meseroNombres || [];

    if (mesa.meseroId && !currentIds.includes(mesa.meseroId)) {
      currentIds = [mesa.meseroId, ...currentIds];
      currentNombres = [mesa.meseroNombre || 'Mesero', ...currentNombres];
    }

    let updatedIds;
    let updatedNombres;

    if (currentIds.includes(meseroId)) {
      updatedIds = currentIds.filter(id => id !== meseroId);
      updatedNombres = currentNombres.filter((_, idx) => currentIds[idx] !== meseroId);
    } else {
      updatedIds = [...currentIds, meseroId];
      updatedNombres = [...currentNombres, meseroNombre];
    }

    const firstId = updatedIds[0] || null;
    const firstNombre = updatedNombres[0] || null;

    const updatedMesas = mesasRef.current.map(m => m.id === mesaId
      ? { 
          ...m, 
          meseroIds: updatedIds, 
          meseroNombres: updatedNombres,
          meseroId: firstId,
          meseroNombre: firstNombre
        }
      : m
    );

    setMesas(updatedMesas);
    localStorage.setItem('yoy_billar_mesas', obfuscate(updatedMesas));

    try {
      await setDoc(doc(db, 'config', 'mesas_estado'), {
        mesas: updatedMesas,
        updatedAt: serverTimestamp()
      }, { merge: true });
      showToast(`Mesa ${mesaId} actualizada`, 'success');
    } catch (err) {
      console.error("Error al asignar meseros:", err);
      showToast("Error al guardar asignación", "danger");
    }
  };

  const handleAsignarMeseroMesa = async (mesaId, meseroId) => {
    const meseroObj = meserosPresentes.find(m => m.id === meseroId);
    const meseroNombre = meseroObj ? meseroObj.nombre : null;

    const updatedMesas = mesasRef.current.map(m => m.id === mesaId
      ? { 
          ...m, 
          meseroId: meseroId || null, 
          meseroNombre: meseroNombre || null,
          meseroIds: meseroId ? [meseroId] : [],
          meseroNombres: meseroNombre ? [meseroNombre] : []
        }
      : m
    );
    setMesas(updatedMesas);
    localStorage.setItem('yoy_billar_mesas', obfuscate(updatedMesas));

    try {
      await setDoc(doc(db, 'config', 'mesas_estado'), {
        mesas: updatedMesas,
        updatedAt: serverTimestamp()
      }, { merge: true });
      
      if (meseroNombre) {
        showToast(`Mesa ${mesaId} asignada a ${meseroNombre}`, 'success');
        registrarEvento('Asignación Mesero', `Mesa ${mesaId} asignada a mesero ${meseroNombre}.`);
      } else {
        showToast(`Mesa ${mesaId} sin mesero asignado`, 'info');
        registrarEvento('Desasignación Mesero', `Se removió mesero asignado de la Mesa ${mesaId}.`);
      }
    } catch (err) {
      console.error("Error al guardar mesero asignado:", err);
      showToast("Error al guardar la asignación.", "danger");
    }
  };

  const [filtro, setFiltro] = useState('todas');
  const [ordenamiento, setOrdenamiento] = useState('numero'); // numero | carambola_primero | pool_primero | snooker_primero
  const animacionesActivas = true;
  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.removeItem('yoy_billar_animaciones_activas');
    }
  }, []);
  const [modalAbrir, setModalAbrir] = useState(null);
  const [modalCerrar, setModalCerrar] = useState(null);
  const [modalNuevaMesa, setModalNuevaMesa] = useState(false);
  const [modalFila, setModalFila] = useState(false);
  const [modalCuentas, setModalCuentas] = useState(false);
  const [modalAbrirCuenta, setModalAbrirCuenta] = useState(false);
  const [modalCuentasSolicitadas, setModalCuentasSolicitadas] = useState(false);
  const [alertaCobroAsociadaId, setAlertaCobroAsociadaId] = useState(null);
  const [alertaClienteAsoc, setAlertaClienteAsoc] = useState('');
  const [alertaMesaIdAsoc, setAlertaMesaIdAsoc] = useState(null);
  const [lastCheckedTime, setLastCheckedTime] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('yoy_last_checked_solicitudes');
      return saved ? Number(saved) : 0;
    }
    return 0;
  });
  const [showCuentasPopover, setShowCuentasPopover] = useState(false);
  const [clientesRegistrados, setClientesRegistrados] = useState([]);
  const [shakeCuentasButton, setShakeCuentasButton] = useState(false);
  const [silenciadoCuentasHasta, setSilenciadoCuentasHasta] = useState(0);
  const [modalCambiarMesa, setModalCambiarMesa] = useState(null);
  const [modalVincular, setModalVincular] = useState(null);
  const [modalBitacora, setModalBitacora] = useState(false);
  const [bitacora, setBitacora] = useState([]);
  async function registrarEvento(accion, detalle, monto = 0) {
    const nombreOperador = user ? (user.name || user.alias || user.email) : 'Cajero Principal';
    const rolOperador = user ? (user.role || 'staff') : 'staff';
    const nuevoEvento = {
      fecha: new Date().toISOString(),
      accion,
      detalle,
      monto,
      operador: nombreOperador,
      rolOperador: rolOperador
    };
    try {
      await addDoc(collection(db, 'bitacora'), nuevoEvento);
    } catch (err) {
      console.error("Error al registrar evento en Firestore:", err);
      // Fallback local instantáneo si está offline
      setBitacora(prev => [{ id: Date.now(), ...nuevoEvento }, ...prev].slice(0, 100));
    }
  }
  const [limiteBitacora, setLimiteBitacora] = useState(50);
  const [hasMoreBitacora, setHasMoreBitacora] = useState(true);
  const [modalComanda, setModalComanda] = useState(false);
  const [productosBajos, setProductosBajos] = useState([]);
  const [modalQR, setModalQR] = useState(null); // mesa para mostrar QR
  const [modalStatusCambio, setModalStatusCambio] = useState(null); // { mesa, nuevoEstado }
  const [modalHistorial, setModalHistorial] = useState(null); // mesa
  const [modalReservasCentral, setModalReservasCentral] = useState(false);
  const [modalAvisar, setModalAvisar] = useState(null); // mesa
  const [modalGasto, setModalGasto] = useState(false);

  const [isOnline, setIsOnline] = useState(true);
  const [cantAlertasOffline, setCantAlertasOffline] = useState(0);

  const [isFullscreen, setIsFullscreen] = useState(false);
  const [mostrarCobroManual, setMostrarCobroManual] = useState(false);
  const [nuevoMonto, setNuevoMonto] = useState('');
  const [nuevaDesc, setNuevaDesc] = useState('');
  const [nuevoMetodo, setNuevoMetodo] = useState('efectivo');
  const [pinAutorizacion, setPinAutorizacion] = useState('');
  const [adminPinHash, setAdminPinHash] = useState('56760663'); // Hash of '123456'
  const [alertasMesas, setAlertasMesas] = useState({});
  const [unloadedConsumos, setUnloadedConsumos] = useState({});
  const knownAlertsRef = useRef(new Set());
  const isInitialLoadRef = useRef(true);
  const prevMesasStateRef = useRef([]);
  const backupTimeoutRef = useRef(null);
  const processingOrdersRef = useRef(new Set());
  useEffect(() => {
    if (modalCuentasSolicitadas) {
      const ahora = Date.now();
      setLastCheckedTime(ahora);
      localStorage.setItem('yoy_last_checked_solicitudes', String(ahora));
      // Sincronizar con la nube para otras computadoras
      setDoc(doc(db, 'config', 'last_checked_cuentas'), { timestamp: ahora }, { merge: true })
        .catch(err => console.warn("Error al sincronizar lectura de cuentas en Firestore:", err));
    }
  }, [modalCuentasSolicitadas]);

  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'config', 'last_checked_cuentas'), snap => {
      if (snap.exists()) {
        const val = snap.data().timestamp;
        if (val && val > lastCheckedTime) {
          setLastCheckedTime(val);
          localStorage.setItem('yoy_last_checked_solicitudes', String(val));
        }
      }
    }, err => {
      console.warn("Error al escuchar sincronizacion de lectura de cuentas:", err);
    });
    return unsub;
  }, [lastCheckedTime]);

  // Cambiar el estado de la mesa rápidamente
  const cambiarEstadoRapido = (mesa, nuevoEstado) => {
    if (mesa.estado === 'ocupada' && nuevoEstado !== 'ocupada') {
      showToast("No puede cambiar el estado de una mesa ocupada directamente. Debe cerrar la cuenta primero.", "warning");
      return;
    }

    if (nuevoEstado === 'libre') {
      setMesas(prev => prev.map(m => m.id === mesa.id ? { 
        ...m, 
        estado: 'libre', 
        cliente: null, 
        telefono: '',
        inicio: null, 
        socios: false, 
        clienteUid: '', 
        preTicketImpreso: false,
        reservadaAt: null,
        limiteReservaMs: null,
        motivo: ''
      } : m));
      registrarEvento('Cambio Estado', `Mesa ${mesa.id} cambiada a Disponible (Libre).`);
      showToast(`Mesa ${mesa.id} cambiada a Disponible (Libre).`, "info");
    } else {
      setModalStatusCambio({ mesa, nuevoEstado });
    }
  };

  // Imprimir comprobante de gasto en formato ticket
  const imprimirTicketGasto = (gastoData) => {
    const w = window.open('', '_blank');
    if (!w) {
      showToast("El navegador bloqueó la ventana emergente. Por favor, habilite los pop-ups para imprimir.", "danger");
      return;
    }
    const cat = CATEGORIAS_GASTO.find(c => c.id === gastoData.categoria);
    const htmlContent = `
      <html><head><title>Comprobante de Gasto</title>
      <style>
        body { margin: 0; padding: 20px; font-family: 'Courier New', Courier, monospace; background: #fff; color: #000; font-size: 13px; line-height: 1.4; max-width: 280px; }
        .text-center { text-align: center; }
        .divider { border-top: 1px dashed #000; margin: 10px 0; }
        .header { margin-bottom: 12px; }
        .header h3 { margin: 0; font-size: 15px; font-weight: bold; }
        .header p { margin: 2px 0; font-size: 11px; }
        .monto { font-size: 18px; font-weight: bold; margin: 10px 0; text-align: center; }
        .sign-area { margin-top: 30px; text-align: center; }
        .sign-line { border-top: 1px solid #000; width: 180px; margin: 30px auto 5px; }
        .footer { margin-top: 20px; font-size: 10px; text-align: center; color: #555; }
      </style>
      </head>
      <body>
        <div class="header text-center">
          <h3>YoY IA Billar Club</h3>
          <p>COMPROBANTE DE EGRESO (GASTO)</p>
          <p>Fecha Gasto: ${gastoData.fecha}</p>
          <p>Impreso: ${new Date().toLocaleString()}</p>
        </div>
        
        <div class="divider"></div>
        
        <div>
          <strong>Categoría:</strong> ${cat?.icon || ''} ${cat?.label || gastoData.categoria}<br/>
          <strong>Concepto:</strong> ${gastoData.descripcion}<br/>
          <strong>Proveedor:</strong> ${gastoData.proveedor || 'N/A'}<br/>
          <strong>Notas:</strong> ${gastoData.notas || 'Ninguna'}
        </div>
        
        <div class="divider"></div>
        
        <div class="monto">
          TOTAL: $${Number(gastoData.monto).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} MXN
        </div>
        
        <div class="divider"></div>
        
        <div class="sign-area">
          <div class="sign-line"></div>
          <div style="font-size: 11px; font-weight: bold;">Firma del Cajero</div>
          
          <div class="sign-line"></div>
          <div style="font-size: 11px; font-weight: bold;">
            ${gastoData.categoria === 'nomina' && gastoData.empleadoNombre ? `Recibe y firma: ${gastoData.empleadoNombre}` : 'Firma de Autorización'}
          </div>
        </div>
        
        <div class="footer">
          <p>Conserve este comprobante para el corte de caja del turno.</p>
        </div>
        
        <script>
          window.onload = () => {
            window.print();
            setTimeout(() => { window.close(); }, 500);
          };
        </script>
      </body>
      </html>
    `;
    w.document.write(htmlContent);
    w.document.close();
  };

  const enviarNotificacionTelegramGasto = async (gastoData) => {
    try {
      const tgSnap = await getDoc(doc(db, 'config', 'telegram'));
      if (tgSnap.exists()) {
        const tgData = tgSnap.data();
        const isSimplified = tgData.mode === 'simplified' || (!tgData.botToken && tgData.chatId);
        const hasCustom = tgData.mode === 'custom' && tgData.botToken && tgData.chatId;

        if (tgData.enabled && (isSimplified || hasCustom)) {
          let tipoText = '';
          if (gastoData.conceptoNomina === 'adelanto_nomina') tipoText = 'Adelanto de Nómina';
          else if (gastoData.conceptoNomina === 'prestamo') tipoText = 'Préstamo';
          else if (gastoData.conceptoNomina === 'faltante') tipoText = 'Faltante';

          const text = 
            `💸 *Nuevo Gasto de Nómina en Caja*\n\n` +
            `*Empleado:* ${gastoData.empleadoNombre}\n` +
            `*Concepto:* ${tipoText}\n` +
            `*Monto:* $${Number(gastoData.monto).toFixed(2)} MXN\n` +
            `*Fecha:* ${gastoData.fecha}\n` +
            (gastoData.notas ? `*Notas:* ${gastoData.notas}\n` : '') +
            `*Registrado por:* Caja / POS`;

          const sucSnap = await getDoc(doc(db, 'config', 'sucursal'));
          const sucursalName = sucSnap.exists() ? (sucSnap.data().nombre || 'Sucursal') : 'Sucursal';

          await fetch('/api/telegram/send-alert', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              mode: tgData.mode || 'simplified',
              token: tgData.botToken,
              chatId: tgData.chatId,
              phone: tgData.phone || '',
              sucursalName: sucursalName,
              text: text
            })
          });
        }
      }
    } catch (err) {
      console.error("Error al enviar notificación de gasto a Telegram:", err);
    }
  };

  // Registro rápido de gasto de caja
  const confirmarRegistroGasto = async (gastoData) => {
    try {
      await addDoc(collection(db, 'gastos'), {
        categoria: gastoData.categoria,
        descripcion: gastoData.descripcion,
        monto: Number(gastoData.monto),
        fecha: gastoData.fecha,
        proveedor: gastoData.proveedor || '',
        notas: gastoData.notas || '',
        empleadoId: gastoData.empleadoId || null,
        empleadoNombre: gastoData.empleadoNombre || null,
        conceptoNomina: gastoData.conceptoNomina || null,
        createdAt: serverTimestamp()
      });
      showToast('Gasto registrado exitosamente 💸', 'success');
      setModalGasto(false);
      
      // Imprimir ticket de egreso automáticamente
      imprimirTicketGasto(gastoData);

      // Enviar notificación a Telegram si es de nómina
      if (gastoData.categoria === 'nomina') {
        enviarNotificacionTelegramGasto(gastoData);
      }
    } catch (err) {
      showToast('Error al registrar el gasto: ' + err.message, 'error');
    }
  };

  // Confirmación del cambio de estado desde el modal interactivo
  const confirmarStatusCambio = (valor, limiteMinutos, telefono = '') => {
    if (!modalStatusCambio) return;
    const { mesa, nuevoEstado } = modalStatusCambio;

    if (nuevoEstado === 'reservada') {
      const clienteName = valor.trim();
      const limiteMs = (limiteMinutos || 30) * 60 * 1000;
      setMesas(prev => prev.map(m => m.id === mesa.id ? { 
        ...m, 
        estado: 'reservada', 
        cliente: clienteName, 
        telefono: telefono.trim(),
        inicio: null, 
        socios: false, 
        clienteUid: '', 
        preTicketImpreso: false,
        reservadaAt: Date.now(),
        limiteReservaMs: limiteMs
      } : m));
      registrarEvento('Reservación Mesa', `Mesa ${mesa.id} reservada a nombre de ${clienteName} (${telefono.trim() || 'Sin tel'}) por ${limiteMinutos} minutos.`);
      showToast(`Mesa ${mesa.id} reservada a nombre de ${clienteName} (${limiteMinutos} min).`, "success");
      enviarAlertaMesero(mesa.id, clienteName, 'Mesa Reservada', 'asistencia', '📅');
    } else {
      const motivo = valor.trim();
      const logEntrada = {
        fecha: new Date().toISOString(),
        estado: nuevoEstado,
        motivo: motivo || 'Sin motivo especificado'
      };

      setMesas(prev => prev.map(m => m.id === mesa.id ? { 
        ...m, 
        estado: nuevoEstado, 
        cliente: null, 
        telefono: '',
        inicio: null, 
        socios: false, 
        clienteUid: '', 
        preTicketImpreso: false,
        reservadaAt: null,
        limiteReservaMs: null,
        motivo: motivo,
        historialManten: [logEntrada, ...(m.historialManten || [])].slice(0, 10)
      } : m));
      
      const estadoLabels = {
        manten: 'Mantenimiento',
        fuera: 'Fuera de Servicio'
      };
      
      const detalleLog = motivo ? `Motivo: ${motivo}` : 'Sin motivo especificado';
      registrarEvento('Cambio Estado', `Mesa ${mesa.id} cambiada a ${estadoLabels[nuevoEstado] || nuevoEstado}. ${detalleLog}`);
      showToast(`Mesa ${mesa.id} cambiada a ${estadoLabels[nuevoEstado] || nuevoEstado}.`, "info");
    }

    setModalStatusCambio(null);
  };

  // Marcar una solicitud de cliente como atendida en Firestore (Caja/Admin)
  const marcarAlertaAtendida = async (alertaId, tipo, e) => {
    // Si e es de tipo evento, detenemos propagación
    if (e && e.stopPropagation) e.stopPropagation(); 
    // Si e no se pasó pero tipo es el evento (caso anterior)
    let finalTipo = tipo;
    let finalEvent = e;
    if (tipo && typeof tipo !== 'string' && tipo.stopPropagation) {
      finalEvent = tipo;
      finalTipo = 'asistencia'; // Valor seguro por defecto si no se conoce
    }

    if (finalEvent) finalEvent.stopPropagation(); // Evitar abrir el modal de la mesa
    try {
      const docRef = doc(db, 'mesa_pedidos', alertaId);
      
      // Intentar calcular el tiempo de espera y liquidar cuenta si es de tipo cuenta
      let tiempoEsperaSegundos = null;
      try {
        const snap = await getDoc(docRef);
        if (snap.exists()) {
          const alertData = snap.data();
          
          if (alertData.createdAt) {
            const startMs = alertData.createdAt.toDate ? alertData.createdAt.toDate().getTime() : alertData.createdAt.seconds * 1000;
            const diffMs = Date.now() - startMs;
            tiempoEsperaSegundos = Math.max(0, Math.floor(diffMs / 1000));
          }

          if (alertData.tipo === 'cuenta') {
            const alertMesaId = alertData.mesaId;
            const alertCliente = alertData.cliente || '';
            
            // Liquidar la cuenta activa en Firestore
            await actualizarCuentasFirestore(prev => prev.filter(c => {
              const tieneMesa = alertMesaId && alertMesaId !== 0 && alertMesaId !== '0';
              if (tieneMesa) {
                return String(c.mesaId) !== String(alertMesaId);
              } else {
                const cName = (c.cliente || '').trim().toLowerCase();
                const aName = alertCliente.trim().toLowerCase();
                return cName !== aName;
              }
            }));

            // Si es una mesa física, liberarla
            const tieneMesaFisica = alertMesaId && alertMesaId !== 0 && alertMesaId !== '0';
            if (tieneMesaFisica) {
              setMesas(prev => prev.map(m => {
                if (String(m.id) === String(alertMesaId)) {
                  return { ...m, estado: 'libre', cliente: null, inicio: null, socios: false, clienteUid: '', preTicketImpreso: false, reservadaAt: null, limiteReservaMs: null, telefono: '', filaId: null };
                }
                return m;
              }));
            }
          }
        }
      } catch (err) {
        console.error("Error al obtener documento para calcular tiempo de espera y liquidar:", err);
      }

      const updateData = {
        atendidoAdmin: true,
        updatedAt: serverTimestamp()
      };
      if (tiempoEsperaSegundos !== null) {
        updateData.tiempoEsperaSegundos = tiempoEsperaSegundos;
      }
      // Solo archivar si no es un pedido (ya que el pedido debe seguir en cocina/entrega)
      if (finalTipo !== 'pedido') {
        updateData.estado = 'atendido';
        updateData.atendidoAt = serverTimestamp();
      }
      await updateDoc(docRef, updateData);
      
      if (finalTipo === 'cuenta' && tiempoEsperaSegundos !== null) {
        const mins = Math.floor(tiempoEsperaSegundos / 60);
        const secs = tiempoEsperaSegundos % 60;
        const descTiempo = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
        registrarEvento('Cuenta Atendida', `Solicitud de cuenta de la Mesa ${alertaId} atendida. Tiempo de espera del cobro: ${descTiempo}.`);
      } else {
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
    const targetMesa = mesaId ? mesasRef.current.find(m => String(m.id) === String(mesaId)) : null;
    if (mesaId && !targetMesa) {
      if (mesasRef.current.length === 0) {
        // Si las mesas aún están cargando de Firestore, encolar el pedido para procesarlo después
        if (!pendingLoadsRef.current.some(item => item.pedidoDoc.id === pedidoDoc.id)) {
          pendingLoadsRef.current.push({ mesaId, pedidoDoc, isAuto });
        }
      }
      return;
    }

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
              processingOrdersRef.current.delete(pedidoDoc.id);
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
        if (!continuarSinStock) {
          processingOrdersRef.current.delete(pedidoDoc.id);
          return;
        }
      }
    }

    // 2. Si la mesa está libre, la abrimos automáticamente (si aplica mesaId)
    let orderClient = (pedidoDoc.cliente || '').trim();
    if (!orderClient || ['público', 'publico', 'público general', 'publico general'].includes(orderClient.toLowerCase())) {
      orderClient = `Mesa ${mesaId}`;
    } else if (orderClient.toLowerCase().startsWith('mesa ') && orderClient.toLowerCase() !== `mesa ${mesaId}`) {
      orderClient = `Mesa ${mesaId}`;
    }
    let clienteName = (targetMesa ? targetMesa.cliente : null) || orderClient || `Mesa ${mesaId}`;
    let updatedMesas = mesasRef.current;
    if (targetMesa && targetMesa.estado !== 'ocupada') {
      updatedMesas = mesasRef.current.map(m => String(m.id) === String(mesaId)
        ? { ...m, estado: 'ocupada', cliente: clienteName, inicio: Date.now(), clienteUid: pedidoDoc.clienteUid || '' }
        : m
      );
      setMesas(updatedMesas);
      localStorage.setItem('yoy_billar_mesas', obfuscate(updatedMesas));
      
      try {
        await setDoc(doc(db, 'config', 'mesas_estado'), {
          mesas: updatedMesas,
          updatedAt: serverTimestamp()
        }, { merge: true });
      } catch (err) {
        console.error("Error al guardar mesas_estado en apertura automática:", err);
      }

      registrarEvento('Apertura Auto', `Mesa ${mesaId} abierta automáticamente por pedido de cliente (${clienteName})`);
      enviarAlertaMesero(mesaId, clienteName, 'Mesa Abierta (Pedido)', 'asistencia', '🎮');
    }

    // 3. Guardar inventario y cuentas actualizado en Firestore, registrar auditoría y marcar como entregado de forma atómica
    try {
      await runTransaction(db, async (transaction) => {
        const invRef = doc(db, 'config', 'inventario');
        const invSnap = await transaction.get(invRef);
        if (!invSnap.exists()) throw new Error("No existe el documento de inventario central");

        const cuentasRef = doc(db, 'config', 'cuentas_estado');
        const cuentasSnap = await transaction.get(cuentasRef);
        let currentCuentas = [];
        if (cuentasSnap.exists()) {
          currentCuentas = cuentasSnap.data().cuentas || [];
        }

        // Si la mesa estaba libre y se abre por pedido, purgamos cualquier cuenta leftover de esta mesa
        let filteredCuentas = currentCuentas;
        if (targetMesa && targetMesa.estado !== 'ocupada') {
          filteredCuentas = currentCuentas.filter(c => 
            !(c.mesaId === mesaId || (c.cliente && c.cliente.toLowerCase() === `mesa ${mesaId}`))
          );
        }

        // Buscar o crear la cuenta activa en la transacción usando las cuentas filtradas
        const cuentaExistente = filteredCuentas.find(c => 
          c.mesaId === mesaId || 
          (c.cliente && 
           !['público', 'publico'].includes(clienteName.toLowerCase()) && 
           c.cliente.toLowerCase() === clienteName.toLowerCase())
        );
        let nuevasCuentas = [...filteredCuentas];
        if (cuentaExistente) {
          nuevasCuentas = filteredCuentas.map(c => {
            if (c.id === cuentaExistente.id) {
              const nuevosConsumos = [...c.consumos];
              orderItems.forEach(cartItem => {
                const existeItem = nuevosConsumos.find(i => 
                  (cartItem.productoId && i.productoId === cartItem.productoId) || 
                  i.producto.toLowerCase() === cartItem.nombre.toLowerCase()
                );
                if (existeItem) {
                  existeItem.cantidad += cartItem.cantidad;
                  if (cartItem.productoId) existeItem.productoId = cartItem.productoId;
                } else {
                  nuevosConsumos.push({
                    id: Date.now() + Math.random(),
                    productoId: cartItem.productoId || null,
                    producto: cartItem.nombre,
                    precio: cartItem.precio,
                    cantidad: cartItem.cantidad
                  });
                }
              });
              return { 
                ...c, 
                consumos: nuevosConsumos,
                meseroId: c.meseroId || pedidoDoc.meseroId || null,
                meseroNombre: c.meseroNombre || pedidoDoc.meseroNombre || null
              };
            }
            return c;
          });
        } else {
          const nuevaCuenta = {
            id: Date.now(),
            mesaId: mesaId,
            cliente: clienteName,
            tiempoJuego: 0,
            consumos: orderItems.map(item => ({
              id: Date.now() + Math.random(),
              productoId: item.productoId || null,
              producto: item.nombre,
              precio: item.precio,
              cantidad: item.cantidad
            })),
            inicio: Date.now(),
            meseroId: pedidoDoc.meseroId || null,
            meseroNombre: pedidoDoc.meseroNombre || null
          };
          nuevasCuentas.push(nuevaCuenta);
        }

        // Escribir las cuentas actualizadas
        transaction.set(cuentasRef, {
          cuentas: nuevasCuentas,
          updatedAt: serverTimestamp()
        });

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
          cargadoACuenta: true,
          updatedAt: serverTimestamp()
        };
        transaction.update(pedidoRef, updateData);

        // Actualizar el caché de stock y cuentas local después de confirmarse la transacción
        localStorage.setItem('yoy_billar_stock', obfuscate(stockTransaccion));
        localStorage.setItem('yoy_billar_cuentas', obfuscate(nuevasCuentas));
      });

      showToast(`Pedido de ${mesaId ? `Mesa ${mesaId}` : clienteName} cargado a la cuenta ✓`, 'success');
      registrarEvento('Pedido a Cuenta', `Pedido de ${orderItems.map(i=>`${i.cantidad}x ${i.nombre}`).join(', ')} cargado a la cuenta de ${clienteName}`, totalPedido);
    } catch (err) {
      console.error("Error al procesar la transacción de descuento de stock y cuentas:", err);
      showToast('Error de red al actualizar stock/cuentas atómicamente', 'error');
      processingOrdersRef.current.delete(pedidoDoc.id);
    }
  };

  // Escuchar alertas de mesas activas desde Firestore
  useEffect(() => {
    const q = query(collection(db, 'mesa_pedidos'));
    const unsub = onSnapshot(q, snap => {
      const alertsMap = {};
      const unloadedMap = {};
      let hasNewAlert = false;
      let newAlertType = null;
      let newAlertIsDirect = false;
      const currentAlerts = new Set();
 
      snap.docs.forEach(doc => {
        const data = doc.data();
        if (!['pendiente', 'listo', 'en_camino', 'entregado', 'atendido'].includes(data.estado)) return;
        const mesaId = data.mesaId;
        const id = doc.id;
        currentAlerts.add(id);
 
        // Auto-cargar pedidos a la cuenta de forma reactiva si es un pedido o si fue atendido por mesero o admin o si ya está listo/en camino/entregados
        const debCargar = data.tipo === 'pedido' || data.atendidoMesero || data.atendidoAdmin || ['listo', 'en_camino', 'entregado'].includes(data.estado);
        if (data.tipo === 'pedido' && !data.cargadoACuenta && debCargar) {
          if (!processingOrdersRef.current.has(id)) {
            processingOrdersRef.current.add(id);
            cargarPedidoACuenta(mesaId || 0, { id, ...data }, true);
          }
        }
 
        // Calcular consumos de pedidos no cargados a la cuenta para mostrarlos en tiempo real
        if ((mesaId || mesaId === 0 || mesaId === '0') && data.tipo === 'pedido' && !data.cargadoACuenta) {
          const mIdNum = parseInt(mesaId);
          if (!unloadedMap[mIdNum]) {
            unloadedMap[mIdNum] = 0;
          }
          unloadedMap[mIdNum] += data.total || 0;
        }
 
        // Solo incluir alertas que no hayan sido atendidas por el admin
        if ((mesaId || mesaId === 0 || mesaId === '0') && !data.atendidoAdmin) {
          if (!alertsMap[mesaId]) {
            alertsMap[mesaId] = [];
          }
          alertsMap[mesaId].push({ id, ...data });
        }
 
        // Si no es la carga inicial y detectamos un id que no estaba en knownAlerts
        if (!isInitialLoadRef.current && !knownAlertsRef.current.has(id)) {
          hasNewAlert = true;
          if (!newAlertType || data.tipo === 'cuenta' || (data.tipo === 'pedido' && newAlertType !== 'cuenta')) {
            newAlertType = data.tipo || 'asistencia';
            newAlertIsDirect = data.tipo === 'cuenta' && (!mesaId || mesaId === 0 || mesaId === '0');
          }
        }
      });
 
      setUnloadedConsumos(unloadedMap);
      knownAlertsRef.current = currentAlerts;
      isInitialLoadRef.current = false;
      setAlertasMesas(alertsMap);
 
      if (hasNewAlert && newAlertType) {
        try {
          if (newAlertType === 'cuenta') {
            setShakeCuentasButton(true);
            setTimeout(() => setShakeCuentasButton(false), 1000);
            if (newAlertIsDirect) {
              decirFraseAleatoria('barra');
            } else {
              decirFraseAleatoria('cuenta');
            }
          } else if (newAlertType === 'pedido') {
            decirFraseAleatoria('pedido');
          } else {
            decirFraseAleatoria('asistencia');
          }
 
          if (typeof navigator !== 'undefined' && navigator.vibrate) {
            navigator.vibrate([100, 50, 100]); // Vibración doble
          }
        } catch (e) {
          console.warn("Speech synthesis alert failed", e);
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
          if (localHash) setAdminPinHash(deobfuscate(localHash) || '56760663');
        }
      }
    }, err => {
      console.warn("Firestore seguridad sync error (offline fallback):", err);
      if (typeof window !== 'undefined') {
        const localHash = localStorage.getItem('yoy_admin_pin_hash');
        if (localHash) setAdminPinHash(deobfuscate(localHash) || '56760663');
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

  // Atajos de teclado para filtrar la cuadrícula de mesas (Alt + Shift + T/L/O/R/M)
  useEffect(() => {
    const handleFilterShortcuts = (e) => {
      const activeEl = document.activeElement;
      if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.isContentEditable)) {
        return;
      }

      if (e.altKey && e.shiftKey) {
        const key = e.key.toLowerCase();
        if (key === 't') {
          e.preventDefault();
          setFiltro('todas');
          showToast("Filtro: Todas las mesas", "info");
        } else if (key === 'l') {
          e.preventDefault();
          setFiltro('libre');
          showToast("Filtro: Mesas Libres", "success");
        } else if (key === 'o') {
          e.preventDefault();
          setFiltro('ocupada');
          showToast("Filtro: Mesas Ocupadas", "danger");
        } else if (key === 'r') {
          e.preventDefault();
          setFiltro('reservada');
          showToast("Filtro: Mesas Reservadas", "warning");
        } else if (key === 'm') {
          e.preventDefault();
          setFiltro('manten');
          showToast("Filtro: Mesas en Mantenimiento", "secondary");
        }
      }
    };

    window.addEventListener('keydown', handleFilterShortcuts);
    return () => window.removeEventListener('keydown', handleFilterShortcuts);
  }, [setFiltro, showToast]);

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

  const registrarCobroManual = (pagaConParam = 0, cambioParam = 0) => {
    if (!nuevoMonto || !nuevaDesc) {
      showToast('Completa todos los campos', 'warning');
      return;
    }
    const monto = parseFloat(nuevoMonto);
    const pagaConVal = parseFloat(pagaConParam) || 0;
    const cambioVal = parseFloat(cambioParam) || 0;

    let currentCobros = [];
    try {
      const saved = localStorage.getItem('yoy_caja_cobros');
      if (saved) {
        currentCobros = JSON.parse(saved);
      } else {
        currentCobros = [];
      }
    } catch (err) {
      console.error(err);
    }

    let metodoPagoTexto = nuevoMetodo === 'efectivo' ? 'Efectivo' : (nuevoMetodo === 'spei' ? 'Transferencia' : 'Tarjeta');

    const nuevoCobro = {
      id: Date.now(),
      tipo: 'manual',
      descripcion: nuevaDesc,
      cliente: 'Manual (Autorizado)',
      monto: monto,
      metodo: metodoPagoTexto,
      hora: new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }),
      color: monto > 0 ? 'var(--success)' : 'var(--danger)',
    };

    const updatedCobros = [nuevoCobro, ...currentCobros];
    localStorage.setItem('yoy_caja_cobros', JSON.stringify(updatedCobros));
    
    // Disparar evento storage local para sincronizar otros paneles (por ejemplo, CajaPanel)
    window.dispatchEvent(new Event('storage'));

    registrarEvento('Cobro Manual', `Cobro manual de $${monto} registrado (${nuevaDesc}) por ${nuevoMetodo}`, monto);
    showToast(`Cobro manual de $${monto} registrado`, 'success');

    // ── IMPRESIÓN OBLIGATORIA DEL COMPROBANTE ──
    if (monto > 0) {
      // Intentar buscar la cuenta activa asociada para el ticket detallado
      let consumosTicket = [
        {
          id: Date.now(),
          producto: nuevaDesc,
          precio: monto,
          cantidad: 1
        }
      ];
      let clienteTicket = 'Cobro Manual Directo';

      if (cuentaAsociadaManual) {
        consumosTicket = cuentaAsociadaManual.consumos || consumosTicket;
        clienteTicket = cuentaAsociadaManual.cliente || clienteTicket;
      }

      try {
        imprimirTicketFinal({
          cliente: clienteTicket,
          isMesa: false,
          mesaNombre: cuentaAsociadaManual && cuentaAsociadaManual.mesaId ? `Mesa ${cuentaAsociadaManual.mesaId}` : '',
          inicio: null,
          tiempoJuegoCosto: 0,
          durationStr: '',
          consumos: consumosTicket,
          total: monto,
          metodoPago: metodoPagoTexto,
          pagaCon: pagaConVal > 0 ? pagaConVal : monto,
          cambio: cambioVal,
          referenciaPago: '',
          operador: user ? (user.displayName || user.email || 'Cajero Principal') : 'Cajero Principal'
        });
      } catch (printErr) {
        console.error("Error al imprimir ticket de cobro manual:", printErr);
      }
    } else {
      try {
        imprimirTicketGasto({
          fecha: new Date().toLocaleDateString('es-MX'),
          categoria: 'General',
          descripcion: nuevaDesc,
          proveedor: 'N/A',
          notas: 'Registrado vía cobro/gasto manual en caja',
          monto: Math.abs(monto)
        });
      } catch (printErr) {
        console.error("Error al imprimir ticket de gasto manual:", printErr);
      }
    }

    if (alertaCobroAsociadaId) {
      marcarAlertaAtendida(alertaCobroAsociadaId, 'cuenta');
      setAlertaCobroAsociadaId(null);
      setAlertaClienteAsoc('');
      setAlertaMesaIdAsoc(null);
    }

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

  const cuentaAsociadaManual = useMemo(() => {
    if (!alertaCobroAsociadaId) return null;
    return cuentasActivas.find(c => {
      const tieneMesa = alertaMesaIdAsoc && alertaMesaIdAsoc !== 0 && alertaMesaIdAsoc !== '0';
      if (tieneMesa) {
        return String(c.mesaId) === String(alertaMesaIdAsoc);
      } else {
        return c.cliente && c.cliente.toLowerCase() === alertaClienteAsoc.toLowerCase();
      }
    });
  }, [alertaCobroAsociadaId, alertaMesaIdAsoc, alertaClienteAsoc, cuentasActivas]);

  useEffect(() => {
    const docRef = doc(db, 'config', 'cuentas_estado');
    const unsub = onSnapshot(docRef, snap => {
      if (snap.exists()) {
        const data = snap.data();
        if (data && Array.isArray(data.cuentas)) {
          setCuentasActivas(data.cuentas);
        }
      } else {
        const savedCuentas = localStorage.getItem('yoy_billar_cuentas');
        const initialCuentas = savedCuentas ? (deobfuscate(savedCuentas) || []) : [];
        setDoc(docRef, {
          cuentas: initialCuentas,
          updatedAt: serverTimestamp()
        }).catch(err => console.error("Error al inicializar cuentas en Firestore:", err));
      }
    }, err => {
      console.error("Error al escuchar cuentas en tiempo real:", err);
    });
    return unsub;
  }, []);
  const [fila, setFila] = useState([]);
  const tick = useLiveTick();

  // Escuchar Fila de Espera en tiempo real desde Firestore
  useEffect(() => {
    const q = query(
      collection(db, 'fila_espera'),
      where('estado', '==', 'espera')
    );
    const unsub = onSnapshot(q, snap => {
      const items = snap.docs.map(d => {
        const val = d.data();
        return {
          ...val,
          id: isNaN(d.id) ? d.id : Number(d.id)
        };
      });
      // Ordenar por timestamp de registro ascendente (FIFO)
      items.sort((a, b) => (a.registro || 0) - (b.registro || 0));
      setFila(items);
      try {
        localStorage.setItem('yoy_billar_fila', obfuscate(items));
      } catch (err) {
        console.error("Error al respaldar fila en localStorage:", err);
      }
    }, err => {
      console.error("Error al escuchar fila_espera en tiempo real:", err);
    });
    return unsub;
  }, []);

  const decirPalabra = (texto) => {
    try {
      if (typeof window !== 'undefined' && window.speechSynthesis) {
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(texto);
        utterance.lang = 'es-MX';
        utterance.rate = 1.1; // Velocidad enérgica y natural
        utterance.pitch = 1.28; // Tono más alto que emula entusiasmo y felicidad
        window.speechSynthesis.speak(utterance);
      }
    } catch (e) {
      console.warn("Speech synthesis failed", e);
    }
  };

  const decirFraseAleatoria = (categoria) => {
    const lista = VOCABULARIO_FRASES[categoria] || [categoria];
    const indice = Math.floor(Math.random() * lista.length);
    decirPalabra(lista[indice]);
  };

  const playCashierNotificationSound = () => {
    decirFraseAleatoria('recordatorio');
  };

  const [assignedFila, setAssignedFila] = useState([]);
  const pendingAssignmentsRef = useRef({}); // { [nombreMesa]: { clientId, timestamp } }

  // Escuchar Fila de Espera Asignada en tiempo real
  useEffect(() => {
    const q = query(
      collection(db, 'fila_espera'),
      where('estado', '==', 'asignada')
    );
    const unsub = onSnapshot(q, snap => {
      const items = snap.docs.map(d => {
        const val = d.data();
        return {
          ...val,
          id: isNaN(d.id) ? d.id : Number(d.id),
          assignedAt: val.assignedAt ? (val.assignedAt.toMillis ? val.assignedAt.toMillis() : val.assignedAt) : Date.now()
        };
      });

      // Limpiar asignaciones pendientes locales cuya sincronización con Firestore ya se completó
      items.forEach(item => {
        if (item.mesaAsignada) {
          const key = item.mesaAsignada.toLowerCase();
          const pending = pendingAssignmentsRef.current[key];
          if (pending && pending.clientId === item.id) {
            delete pendingAssignmentsRef.current[key];
          }
        }
      });

      setAssignedFila(items);
    }, err => {
      console.error("Error al escuchar fila_espera asignada:", err);
    });
    return unsub;
  }, []);

  // Alerta sonora reactiva y recordatorio periódico para el cajero
  const prevAssignedCountRef = useRef(0);
  useEffect(() => {
    if (assignedFila.length > prevAssignedCountRef.current) {
      playCashierNotificationSound();
    }
    prevAssignedCountRef.current = assignedFila.length;

    let chimeInterval = null;
    if (assignedFila.length > 0) {
      chimeInterval = setInterval(() => {
        playCashierNotificationSound();
      }, 15000); // Recordatorio cada 15 segundos
    }

    return () => {
      if (chimeInterval) clearInterval(chimeInterval);
    };
  }, [assignedFila]);

  // Auto-cancelador de asignaciones vencidas en Fila Virtual (5 minutos de tolerancia)
  useEffect(() => {
    const ahora = Date.now();
    const GRACE_PERIOD = 5 * 60 * 1000; // 5 minutos en milisegundos

    assignedFila.forEach(async (f) => {
      if (f.assignedAt && (ahora - f.assignedAt > GRACE_PERIOD)) {
        try {
          // Cambiar estado a 'retirado' por inasistencia (timeout)
          await updateDoc(doc(db, 'fila_espera', String(f.id)), {
            estado: 'retirado',
            removedAt: serverTimestamp(),
            motivoRetiro: 'timeout'
          });
          registrarEvento('Fila Expirada', `El turno de ${f.cliente} expiró por inasistencia (Tolerancia 5 min).`);
          showToast(`Turno de ${f.cliente} cancelado por inasistencia.`, 'warning');
        } catch (err) {
          console.error("Error al auto-cancelar fila por timeout:", err);
        }
      }
    });
  }, [tick, assignedFila]);

  // Motor de Asignación Automática y Control de Fila Virtual
  useEffect(() => {
    // 1. Limpiar asignaciones inválidas (mesas que dejaron de estar libres o cambiaron)
    let invalidUpdates = [];
    assignedFila.forEach((f) => {
      if (!f.mesaAsignada) return;
      const targetTable = mesas.find(m => (m.nombre || `Mesa ${m.id}`).toLowerCase() === f.mesaAsignada.toLowerCase());
      
      // Si la mesa de destino ya no está libre (ej: ocupada por bypass, mantenimiento, etc.)
      if (!targetTable || targetTable.estado !== 'libre') {
        // Si la mesa está ocupada pero fue abierta/iniciada para este cliente de la fila virtual, no es inválido
        if (targetTable && targetTable.estado === 'ocupada' && targetTable.filaId === f.id) {
          return;
        }
        invalidUpdates.push(f);
      }
    });

    if (invalidUpdates.length > 0) {
      const batch = writeBatch(db);
      invalidUpdates.forEach(f => {
        batch.update(doc(db, 'fila_espera', String(f.id)), {
          estado: 'espera',
          mesaAsignada: '',
          assignedAt: null
        });
      });
      batch.commit().then(() => {
        invalidUpdates.forEach(f => {
          registrarEvento('Reencauzamiento Fila', `El cliente ${f.cliente} fue devuelto a la fila de espera porque la ${f.mesaAsignada} ya no está disponible.`);
        });
      }).catch(err => {
        console.error("Error al devolver clientes a fila (batch):", err);
      });
    }

    // 2. Asignar mesas libres a clientes en espera
    // Limpiar asignaciones pendientes locales con más de 15 segundos de antigüedad (evitar fugas o bloqueos persistentes)
    const ahoraMs = Date.now();
    Object.keys(pendingAssignmentsRef.current).forEach(key => {
      if (ahoraMs - pendingAssignmentsRef.current[key].timestamp > 15000) {
        delete pendingAssignmentsRef.current[key];
      }
    });

    const mesasDisponibles = mesas.filter(m => {
      if (m.estado !== 'libre') return false;
      const mesaNombreStr = m.nombre || `Mesa ${m.id}`;
      // Verificar si la mesa ya está asignada en Firestore o en nuestra cola de pendientes local
      const isAlreadyAssigned = assignedFila.some(f => f.mesaAsignada && f.mesaAsignada.toLowerCase() === mesaNombreStr.toLowerCase())
        || !!pendingAssignmentsRef.current[mesaNombreStr.toLowerCase()];
      return !isAlreadyAssigned;
    });

    // Excluir de la fila clientes que tienen una asignación pendiente en memoria
    const pendingClientIds = Object.values(pendingAssignmentsRef.current).map(p => p.clientId);
    const availableFila = fila.filter(f => !pendingClientIds.includes(f.id));

    if (mesasDisponibles.length === 0 || availableFila.length === 0) return;

    // Hacemos una copia local de la fila para ir consumiendo a los clientes asignados en esta tanda
    let localFila = [...availableFila];
    let updates = [];

    mesasDisponibles.forEach((m) => {
      const idx = localFila.findIndex(f => f.estado === 'espera' && matchesTableType(f.tipo, m.tipo));
      
      if (idx !== -1) {
        const elegible = localFila[idx];
        // Remove from local list so the next table in this loop cannot choose this client
        localFila.splice(idx, 1);
        
        const mesaNombreStr = m.nombre || `Mesa ${m.id}`;
        updates.push({
          id: elegible.id,
          cliente: elegible.cliente,
          mesaId: m.id,
          mesaTipo: m.tipo,
          mesaNombreStr: mesaNombreStr
        });
      }
    });

    if (updates.length > 0) {
      // Registrar asignaciones en la caché local para evitar condiciones de carrera por desfases de sincronización
      updates.forEach(up => {
        pendingAssignmentsRef.current[up.mesaNombreStr.toLowerCase()] = {
          clientId: up.id,
          timestamp: Date.now()
        };
      });

      // Actualizar el estado local fila para evitar parpadeos
      setFila([...localFila]);
      
      runTransaction(db, async (transaction) => {
        const mesasDocRef = doc(db, 'config', 'mesas_estado');
        const mesasSnap = await transaction.get(mesasDocRef);
        if (!mesasSnap.exists()) {
          throw new Error("Mesas configuration document does not exist in Firestore.");
        }
        
        const currentMesas = mesasSnap.data().mesas || [];
        const updatedMesas = [...currentMesas];
        const docsData = [];

        for (const up of updates) {
          const docRef = doc(db, 'fila_espera', String(up.id));
          const docSnap = await transaction.get(docRef);
          if (!docSnap.exists) {
            throw new Error(`Waitlist entry ${up.id} does not exist.`);
          }
          if (docSnap.data().estado !== 'espera') {
            throw new Error(`Waitlist entry ${up.id} is no longer in wait state.`);
          }

          const mesaIdx = updatedMesas.findIndex(m => m.id === up.mesaId);
          if (mesaIdx === -1) {
            throw new Error(`Mesa ${up.mesaId} not found in configuration.`);
          }

          const targetMesa = updatedMesas[mesaIdx];

          // Si la mesa ya tiene asignada una filaId localmente en la base de datos
          if (targetMesa.filaId) {
            const otherDocRef = doc(db, 'fila_espera', String(targetMesa.filaId));
            const otherDocSnap = await transaction.get(otherDocRef);
            if (otherDocSnap.exists() && otherDocSnap.data().estado === 'asignada') {
              throw new Error(`Mesa ${up.mesaNombreStr} is already assigned to active client ${targetMesa.filaId}.`);
            }
          }

          // Asignar el nuevo cliente a la mesa en el array de mesas
          updatedMesas[mesaIdx] = {
            ...targetMesa,
            filaId: up.id
          };

          docsData.push({ docRef, up });
        }

        docsData.forEach(({ docRef, up }) => {
          transaction.update(docRef, {
            estado: 'asignada',
            mesaAsignada: up.mesaNombreStr,
            assignedAt: serverTimestamp()
          });
        });

        transaction.set(mesasDocRef, {
          mesas: updatedMesas,
          updatedAt: serverTimestamp()
        }, { merge: true });

      }).then(() => {
        updates.forEach(up => {
          playCashierNotificationSound();
          registrarEvento('Asignación Automática', `Mesa ${up.mesaId} (${up.mesaTipo}) asignada automáticamente a ${up.cliente} (Fila Virtual).`);
          showToast(`Mesa ${up.mesaId} asignada automáticamente a ${up.cliente}`, 'success');
          enviarAlertaMesero(up.mesaId, up.cliente, 'Mesa Asignada (Fila)', 'asistencia', '⏳');
        });
      }).catch(err => {
        console.error("Error en transacción de asignación automática de fila:", err);
        // Si hay error en la escritura, remover de la caché local de pendientes para reintentar
        updates.forEach(up => {
          delete pendingAssignmentsRef.current[up.mesaNombreStr.toLowerCase()];
        });
      });
    }
  }, [mesas, fila, assignedFila]);

  // Auto-liberador de reservaciones expiradas (tiempo configurable)
  useEffect(() => {
    const ahora = Date.now();
    let huboCambios = false;

    const nuevasMesas = mesas.map(m => {
      const limiteMs = m.limiteReservaMs || (30 * 60 * 1000); // 30 min por defecto
      if (m.estado === 'reservada' && m.reservadaAt && (ahora - m.reservadaAt > limiteMs)) {
        huboCambios = true;
        registrarEvento('Reserva Expirada', `Reservación de la Mesa ${m.id} (${m.cliente || ''}) expiró.`);
        return {
          ...m,
          estado: 'libre',
          cliente: null,
          inicio: null,
          socios: false,
          clienteUid: '',
          preTicketImpreso: false,
          reservadaAt: null,
          limiteReservaMs: null
        };
      }
      return m;
    });

    if (huboCambios) {
      setMesas(nuevasMesas);
      showToast("Una o más reservaciones expiraron y las mesas fueron liberadas.", "info");
    }
  }, [tick]);

  // Procesar pedidos encolados una vez que las mesas se hayan cargado de Firestore
  useEffect(() => {
    if (mesas.length > 0 && pendingLoadsRef.current.length > 0) {
      const queue = [...pendingLoadsRef.current];
      pendingLoadsRef.current = [];
      queue.forEach(item => {
        cargarPedidoACuenta(item.mesaId, item.pedidoDoc, item.isAuto);
      });
    }
  }, [mesas]);

  // ── Memorización de Consumos por Mesa (Sugerencia 1) ──
  const consumosPorMesa = useMemo(() => {
    const map = {};
    mesas.forEach(m => {
      const cuentaAsociada = getCuentaAsociadaSafe(m, cuentasActivas);
      const loaded = cuentaAsociada.consumos.reduce((s, item) => s + item.precio * item.cantidad, 0);
      const unloaded = unloadedConsumos[m.id] || 0;
      map[m.id] = loaded + unloaded;
    });
    return map;
  }, [mesas, cuentasActivas, unloadedConsumos]);

  // ── Memorización de Cuentas Pendientes Solicitadas ──
  const infoCuentasSolicitadas = useMemo(() => {
    if (!alertasMesas) return { total: 0, tieneDirectas: false, antiguedadMaxMs: 0 };
    const list = Object.values(alertasMesas)
      .flat()
      .filter(a => a && a.tipo === 'cuenta' && !a.atendidoAdmin);
    
    let oldestTime = Date.now();
    let hasTime = false;
    list.forEach(a => {
      if (a.createdAt) {
        const t = a.createdAt.toDate ? a.createdAt.toDate().getTime() : a.createdAt.seconds * 1000;
        if (t < oldestTime) {
          oldestTime = t;
          hasTime = true;
        }
      }
    });

    const maxAge = hasTime ? Date.now() - oldestTime : 0;
    const tieneDirectas = list.some(a => !a.mesaId || a.mesaId === 0 || a.mesaId === '0');
    return { total: list.length, tieneDirectas, antiguedadMaxMs: maxAge };
  }, [alertasMesas]);

  // Recordatorio sonoro periódico para Cuentas Solicitadas demoradas (> 3 minutos)
  useEffect(() => {
    if (infoCuentasSolicitadas.total === 0 || infoCuentasSolicitadas.antiguedadMaxMs < 3 * 60 * 1000 || Date.now() < silenciadoCuentasHasta) {
      return;
    }

    const sonarRecordatorio = () => {
      try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        
        osc.type = 'sine';
        osc.frequency.setValueAtTime(380, ctx.currentTime);
        gain.gain.setValueAtTime(0, ctx.currentTime);
        gain.gain.linearRampToValueAtTime(0.04, ctx.currentTime + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
        
        osc.start();
        osc.stop(ctx.currentTime + 0.3);
      } catch (e) {}
    };

    // Suena inmediatamente al cumplirse la condición
    sonarRecordatorio();

    const interval = setInterval(sonarRecordatorio, 45000); // Recordatorio cada 45 segundos
    return () => clearInterval(interval);
  }, [infoCuentasSolicitadas.total, infoCuentasSolicitadas.antiguedadMaxMs > 3 * 60 * 1000, silenciadoCuentasHasta]);

  // ── Memorización de Cuentas Nuevas desde la Última Consulta ──
  const totalNuevasCuentas = useMemo(() => {
    if (modalCuentasSolicitadas) return 0;
    if (!alertasMesas) return 0;
    const alertas = Object.values(alertasMesas)
      .flat()
      .filter(a => a && a.tipo === 'cuenta' && !a.atendidoAdmin);
    
    const nuevas = alertas.filter(a => {
      const creationTime = a.createdAt 
        ? (a.createdAt.toDate ? a.createdAt.toDate().getTime() : a.createdAt.seconds * 1000)
        : Date.now();
      return creationTime > lastCheckedTime;
    });
    return nuevas.length;
  }, [alertasMesas, lastCheckedTime, modalCuentasSolicitadas]);

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

  const actualizarCuentasFirestore = async (updaterFn) => {
    if (procesandoCierre) return;
    setProcesandoCierre(true);
    const docRef = doc(db, 'config', 'cuentas_estado');
    try {
      let updatedCuentas = [];
      await runTransaction(db, async (transaction) => {
        const sfDoc = await transaction.get(docRef);
        let currentCuentas = [];
        if (sfDoc.exists()) {
          currentCuentas = sfDoc.data().cuentas || [];
        }
        updatedCuentas = updaterFn(currentCuentas);
        transaction.set(docRef, {
          cuentas: updatedCuentas,
          updatedAt: serverTimestamp()
        });
      });
      if (typeof window !== 'undefined') {
        localStorage.setItem('yoy_billar_cuentas', obfuscate(updatedCuentas));
      }
      setCuentasActivas(updatedCuentas);
      return updatedCuentas;
    } catch (e) {
      console.error("Error al actualizar cuentas de forma transaccional:", e);
      showToast("Error al guardar en base de datos. Intente de nuevo.", "danger");
      throw e;
    } finally {
      setProcesandoCierre(false);
    }
  };
  const registrarNuevoClienteDirectorio = (nombre) => {
    if (!nombre) return;
    const clean = capitalizeName(nombre.trim());
    if (!isRealName(clean)) return;
    const existe = clientesRegistrados.some(c => c.nombre.toLowerCase() === clean.toLowerCase());
    if (!existe) {
      const nuevoClienteItem = {
        id: Date.now(),
        nombre: clean,
        telefono: '',
        tipo: 'Público',
        fechaRegistro: new Date().toISOString().split('T')[0]
      };
      const updatedClientes = [...clientesRegistrados, nuevoClienteItem];
      setClientesRegistrados(updatedClientes);
      if (typeof window !== 'undefined') {
        localStorage.setItem('yoy_billar_clientes', obfuscate(updatedClientes));
      }
      showToast(`Cliente "${clean}" registrado en el directorio ✓`, 'info');
    }
  };

  // ── PERSISTENCIA LOCAL DE ESTADO OFUSCADA (SUGERENCIA 1) ─────────────────
  useEffect(() => {
    if (typeof window !== 'undefined') {
      try {
        const savedCuentas = localStorage.getItem('yoy_billar_cuentas');
        if (savedCuentas) setCuentasActivas(deobfuscate(savedCuentas) || []);

        const savedFila = localStorage.getItem('yoy_billar_fila');
        if (savedFila) setFila(deobfuscate(savedFila) || []);

        const savedBitacora = localStorage.getItem('yoy_billar_bitacora');
        if (savedBitacora) setBitacora(deobfuscate(savedBitacora) || []);

        const savedClientes = localStorage.getItem('yoy_billar_clientes');
        if (savedClientes) {
          const cData = deobfuscate(savedClientes);
          if (cData && Array.isArray(cData)) {
            setClientesRegistrados(cData);
          }
        }
      } catch (err) {
        console.error("Error al cargar datos desde localStorage:", err);
      }
    }
  }, []);

  // Limpieza automática de clientes anónimos con más de 30 días de antigüedad
  useEffect(() => {
    const limpiarClientesAnonimosViejos = async () => {
      if (typeof window !== 'undefined' && !navigator.onLine) return;
      try {
        const limiteTiempo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        const q = query(
          collection(db, 'clientes_anonimos'),
          where('updatedAt', '<', limiteTiempo),
          limit(400)
        );
        const snap = await getDocs(q);
        if (!snap.empty) {
          const batch = writeBatch(db);
          snap.docs.forEach(doc => {
            batch.delete(doc.ref);
          });
          await batch.commit();
          console.log(`[Seguridad] Se eliminaron ${snap.size} registros obsoletos de clientes_anonimos.`);
        }
      } catch (err) {
        console.warn("Error al limpiar clientes anónimos obsoletos:", err);
      }
    };
    limpiarClientesAnonimosViejos();
  }, []);

  // Limpieza automática de pedidos huérfanos de mesas libres (Sugerencia 2)
  useEffect(() => {
    const limpiarPedidosHuerfanosViejos = async () => {
      if (typeof window !== 'undefined' && !navigator.onLine) return;
      try {
        const q = query(
          collection(db, 'mesa_pedidos'),
          where('estado', 'in', ['pendiente', 'listo', 'en_camino', 'entregado']),
          limit(200)
        );
        const snap = await getDocs(q);
        if (!snap.empty) {
          const currentMesas = mesasRef.current;
          const batch = writeBatch(db);
          let count = 0;
          snap.docs.forEach(d => {
            const data = d.data();
            const mesaId = data.mesaId;
            const createdTime = data.createdAt?.toDate ? data.createdAt.toDate().getTime() : 0;
            const targetMesa = currentMesas.find(m => m.id === mesaId);
            // Si la mesa está libre y el pedido lleva más de 2 horas (para evitar colisiones), lo archivamos
            if (targetMesa && targetMesa.estado === 'libre' && Date.now() - createdTime > 2 * 60 * 60 * 1000) {
              const nuevoEstado = data.estado === 'entregado' ? 'finalizado' : 'atendido';
              batch.update(d.ref, {
                estado: nuevoEstado,
                atendidoAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
                atendidoAdmin: true
              });
              count++;
            }
          });
          if (count > 0) {
            await batch.commit();
            console.log(`[Limpieza] Se archivaron ${count} pedidos huérfanos de mesas libres.`);
          }
        }
      } catch (err) {
        console.warn("Error al limpiar pedidos huérfanos obsoletos:", err);
      }
    };
    // Esperar 10 segundos tras el montaje para asegurar que las mesas ya cargaron
    const timer = setTimeout(() => {
      limpiarPedidosHuerfanosViejos();
    }, 10000);
    return () => clearTimeout(timer);
  }, [mesas]);

  // Escuchar mesas de Firestore en tiempo real como fuente única de verdad
  useEffect(() => {
    const docRef = doc(db, 'config', 'mesas_estado');
    const backupsDocRef = doc(db, 'config', 'mesas_estado_backups');

    const enviarAlertaTelegramCritica = async (mensaje) => {
      const alertaItem = {
        id: Date.now(),
        mensaje,
        intentos: 0
      };

      const encolarAlertaOffline = (item) => {
        try {
          const guardadas = localStorage.getItem('yoy_alertas_offline');
          const cola = guardadas ? JSON.parse(guardadas) : [];
          if (!cola.some(c => c.mensaje === item.mensaje)) {
            cola.push(item);
            localStorage.setItem('yoy_alertas_offline', JSON.stringify(cola));
            console.log("[Telegram] Alerta encolada localmente por falta de red/offline.");
          }
        } catch (err) {
          console.error("Error al encolar alerta offline:", err);
        }
      };

      const intentarEnvio = async (item) => {
        try {
          const tgSnap = await getDoc(doc(db, 'config', 'telegram'));
          if (tgSnap.exists()) {
            const tgData = tgSnap.data();
            const isSimplified = tgData.mode === 'simplified' || (!tgData.botToken && tgData.chatId);
            const hasCustom = tgData.mode === 'custom' && tgData.botToken && tgData.chatId;

            if (tgData.enabled && (isSimplified || hasCustom)) {
              const sucSnap = await getDoc(doc(db, 'config', 'sucursal'));
              const sucursalName = sucSnap.exists() ? (sucSnap.data().nombre || 'Sucursal') : 'Sucursal';

              const res = await fetch('/api/telegram/send-alert', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  mode: tgData.mode || 'simplified',
                  token: tgData.botToken,
                  chatId: tgData.chatId,
                  phone: tgData.phone || '',
                  sucursalName: sucursalName,
                  text: `⚠️ *ALERTA DE SISTEMA - AUTO-RECUPERACIÓN*\n\n${item.mensaje}`
                })
              });
              if (!res.ok) throw new Error("Respuesta no satisfactoria de la API");
              console.log("[Telegram] Alerta de sistema despachada con éxito.");
              return true;
            }
          }
          return true;
        } catch (err) {
          console.warn("[Telegram] Error al intentar enviar alerta. Reintentando offline.", err);
          return false;
        }
      };

      if (typeof window !== 'undefined' && !navigator.onLine) {
        encolarAlertaOffline(alertaItem);
        return;
      }

      const enviado = await intentarEnvio(alertaItem);
      if (!enviado) {
        encolarAlertaOffline(alertaItem);
      }
    };

    const restaurarConCascada = async (razon) => {
      console.warn(`[Restauración] Iniciando recuperación de mesas. Razón: ${razon}`);
      try {
        // 1. Intentar restaurar desde el histórico redundante Cloud Backups (Firestore) con validación y sanitización semántica
        const backupsSnap = await getDoc(backupsDocRef);
        if (backupsSnap.exists()) {
          const backupsData = backupsSnap.data();
          const listaBackups = backupsData.backups || [];
          for (let i = 0; i < listaBackups.length; i++) {
            const b = listaBackups[i];
            
            // Decodificar catálogo de mesas del backup redundante (soporta legacy sin ofuscar y ofuscado)
            let mesasDecoded = [];
            if (b) {
              if (b.mesasObfuscated) {
                mesasDecoded = deobfuscate(b.mesasObfuscated);
              } else {
                mesasDecoded = b.mesas;
              }
            }

            const mesasSanitizadas = sanitizarYValidarMesas(mesasDecoded);
            if (mesasSanitizadas) {
              console.log(`[Restauración] Recuperación exitosa desde Cloud Backup (Posición #${i + 1}).`);
              setMesas(mesasSanitizadas);
              
              // Curar el documento principal en Firestore
              await setDoc(docRef, {
                mesas: mesasSanitizadas,
                updatedAt: serverTimestamp()
              });

              registrarEvento(
                'Auto-Recuperación',
                `Catálogo de mesas restaurado automáticamente desde Cloud Backup redundante (Copia #${i + 1}) (Motivo: ${razon}).`
              );

              enviarAlertaTelegramCritica(
                `El catálogo de mesas de juego ha sido auto-restaurado desde la copia de seguridad redundante Cloud (Backup #${i + 1}).\n\n*Razón:* ${razon}`
              );
              return;
            }
          }
        }
      } catch (backupErr) {
        console.error("Error al intentar recuperar desde Cloud Backup:", backupErr);
      }

      try {
        // 2. Intentar restaurar desde LocalStorage con validación y sanitización semántica
        const savedMesas = localStorage.getItem('yoy_billar_mesas');
        if (savedMesas) {
          const localData = deobfuscate(savedMesas);
          const mesasSanitizadas = sanitizarYValidarMesas(localData);
          if (mesasSanitizadas) {
            console.log("[Restauración] Recuperación exitosa desde LocalStorage.");
            setMesas(mesasSanitizadas);

            // Curar el documento principal en Firestore
            await setDoc(docRef, {
              mesas: mesasSanitizadas,
              updatedAt: serverTimestamp()
            });

            registrarEvento(
              'Auto-Recuperación',
              `Catálogo de mesas restaurado desde caché de almacenamiento local (LocalStorage) (Motivo: ${razon}).`
            );

            enviarAlertaTelegramCritica(
              `El catálogo de mesas de juego ha sido auto-restaurado desde la caché de almacenamiento local del navegador (LocalStorage).\n\n*Razón de la alerta:* ${razon}`
            );
            return;
          }
        }
      } catch (localErr) {
        console.error("Error al intentar recuperar desde LocalStorage:", localErr);
      }

      // 3. Fallback final: INIT_MESAS (Catálogo por defecto sanitizado)
      console.log("[Restauración] Recuperación final usando catálogo inicial INIT_MESAS.");
      const defaultMesasSanitizadas = sanitizarYValidarMesas(INIT_MESAS) || INIT_MESAS;
      setMesas(defaultMesasSanitizadas);

      try {
        await setDoc(docRef, {
          mesas: defaultMesasSanitizadas,
          updatedAt: serverTimestamp()
        });

        registrarEvento(
          'Auto-Recuperación',
          `Catálogo de mesas restaurado usando los valores por defecto del sistema (Motivo: ${razon}).`
        );

        enviarAlertaTelegramCritica(
          `⚠️ *ATENCIÓN CRÍTICA*: No se encontró un backup válido en la nube ni localmente. Las mesas de juego se han inicializado con el catálogo por defecto del sistema (INIT_MESAS).\n\n*Razón de la alerta:* ${razon}`
        );
      } catch (err) {
        console.error("Error al curar Firestore con catálogo inicial:", err);
      }
    };

    const unsub = onSnapshot(docRef, snap => {
      if (snap.exists()) {
        const data = snap.data();
        const mesasSanitizadas = data ? sanitizarYValidarMesas(data.mesas) : null;
        if (mesasSanitizadas) {
          hasLoadedFromFirestoreRef.current = true;
          const isDifferent = !areMesasEqual(mesasSanitizadas, mesasRef.current);
          if (isDifferent) {
            isIncomingUpdateRef.current = true;
            setMesas(mesasSanitizadas);
          }
        } else {
          // Si el documento existe pero el catálogo de mesas está vacío o corrupto
          hasLoadedFromFirestoreRef.current = true;
          restaurarConCascada("El documento config/mesas_estado existe pero su array de mesas está vacío o no supera la validación del esquema.");
        }
      } else {
        // Si el documento principal no existe en Firestore
        hasLoadedFromFirestoreRef.current = true;
        restaurarConCascada("El documento config/mesas_estado no existe en Firestore.");
      }
    }, err => {
      console.error("Error al escuchar mesas en tiempo real:", err);
    });
    return unsub;
  }, []);

  // Procesador y despachador de alertas de Telegram encoladas offline
  const procesarAlertasOffline = async () => {
    if (typeof window === 'undefined' || !navigator.onLine) return;
    try {
      const guardadas = localStorage.getItem('yoy_alertas_offline');
      if (!guardadas) return;

      let cola = JSON.parse(guardadas);
      if (cola.length === 0) return;

      console.log(`[Telegram] Procesando ${cola.length} alertas offline encoladas...`);
      const nuevasAlertas = [];

      for (const item of cola) {
        let exito = false;
        try {
          const tgSnap = await getDoc(doc(db, 'config', 'telegram'));
          if (tgSnap.exists()) {
            const tgData = tgSnap.data();
            const isSimplified = tgData.mode === 'simplified' || (!tgData.botToken && tgData.chatId);
            const hasCustom = tgData.mode === 'custom' && tgData.botToken && tgData.chatId;

            if (tgData.enabled && (isSimplified || hasCustom)) {
              const sucSnap = await getDoc(doc(db, 'config', 'sucursal'));
              const sucursalName = sucSnap.exists() ? (sucSnap.data().nombre || 'Sucursal') : 'Sucursal';

              const res = await fetch('/api/telegram/send-alert', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  mode: tgData.mode || 'simplified',
                  token: tgData.botToken,
                  chatId: tgData.chatId,
                  phone: tgData.phone || '',
                  sucursalName: sucursalName,
                  text: `⚠️ *ALERTA DE SISTEMA - AUTO-RECUPERACIÓN* (Reenvío Offline)\n\n${item.mensaje}`
                })
              });
              if (res.ok) exito = true;
            } else {
              exito = true;
            }
          }
        } catch (e) {
          console.error(e);
        }

        if (!exito) {
          item.intentos += 1;
          if (item.intentos < 5) {
            nuevasAlertas.push(item);
          }
        }
      }

      if (nuevasAlertas.length > 0) {
        localStorage.setItem('yoy_alertas_offline', JSON.stringify(nuevasAlertas));
      } else {
        localStorage.removeItem('yoy_alertas_offline');
      }
    } catch (err) {
      console.error("Error al procesar alertas offline:", err);
    }
  };

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setIsOnline(navigator.onLine);
      
      const actualizarColaOffline = () => {
        try {
          const guardadas = localStorage.getItem('yoy_alertas_offline');
          const cola = guardadas ? JSON.parse(guardadas) : [];
          setCantAlertasOffline(cola.length);
        } catch (e) {
          console.error(e);
        }
      };

      actualizarColaOffline();

      const handleOnline = () => {
        setIsOnline(true);
        procesarAlertasOffline().then(actualizarColaOffline);
      };

      const handleOffline = () => {
        setIsOnline(false);
      };

      window.addEventListener('online', handleOnline);
      window.addEventListener('offline', handleOffline);

      const interval = setInterval(() => {
        procesarAlertasOffline().then(actualizarColaOffline);
      }, 60000);

      return () => {
        window.removeEventListener('online', handleOnline);
        window.removeEventListener('offline', handleOffline);
        clearInterval(interval);
      };
    }
  }, []);

  // Escuchar bitácora de Firestore en tiempo real para mantener sincronizado a todo el staff
  useEffect(() => {
    const q = query(collection(db, 'bitacora'), orderBy('fecha', 'desc'), limit(limiteBitacora));
    const unsub = onSnapshot(q, snap => {
      const items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setBitacora(items);
      setHasMoreBitacora(items.length === limiteBitacora);
      try {
        localStorage.setItem('yoy_billar_bitacora', obfuscate(items));
      } catch (err) {
        console.error("Error al respaldar bitácora en localStorage:", err);
      }
    }, err => {
      console.error("Error al escuchar bitácora en tiempo real:", err);
      try {
        const saved = localStorage.getItem('yoy_billar_bitacora');
        if (saved) setBitacora(deobfuscate(saved) || []);
      } catch (e) {
        console.error(e);
      }
    });
    return unsub;
  }, [limiteBitacora]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      try {
        // Anti-Vanish Firewall Check: Evitar sobrescribir Firestore o el localStorage si el array local "mesas" está vacío.
        // Esto previene que una inicialización tardía, un error de react o un render vacío destruya el catálogo en producción.
        if (!mesas || mesas.length === 0) {
          console.warn("[Firewall] Se bloqueó intento de guardado local/remoto de un catálogo de mesas vacío.");
          return;
        }

        localStorage.setItem('yoy_billar_mesas', obfuscate(mesas));
        
        // Evitar sobrescribir Firestore con el estado inicial local en el montaje
        if (!hasLoadedFromFirestoreRef.current) {
          return;
        }

        if (isIncomingUpdateRef.current) {
          isIncomingUpdateRef.current = false;
          return;
        }

        // Sincronizar estado general de mesas con Firestore para clientes con reintentos
        setDocWithRetry(doc(db, 'config', 'mesas_estado'), {
          mesas: mesas,
          updatedAt: serverTimestamp()
        }).then(() => {
          // Cloud Backup con Debounce de 5 segundos y rotación de 3 backups en Firestore
          if (backupTimeoutRef.current) {
            clearTimeout(backupTimeoutRef.current);
          }
          backupTimeoutRef.current = setTimeout(async () => {
            try {
              const backupsDocRef = doc(db, 'config', 'mesas_estado_backups');
              const backupsSnap = await getDoc(backupsDocRef);
              let listaBackups = [];
              if (backupsSnap.exists()) {
                listaBackups = backupsSnap.data().backups || [];
              }

              // Ofuscar y comprimir el catálogo de mesas en la copia redundante (Sugerencia 1)
              const nuevoBackup = {
                mesasObfuscated: obfuscate(mesas),
                updatedAt: Date.now(),
                operador: user ? (user.name || user.alias || user.email) : 'Cajero Principal'
              };

              // Mantener los últimos 3 backups en rotación circular
              listaBackups = [nuevoBackup, ...listaBackups].slice(0, 3);

              await setDoc(backupsDocRef, {
                backups: listaBackups,
                updatedAt: serverTimestamp()
              });
              console.log("[Backup] Copias de seguridad rotativas (ofuscadas) actualizadas en Firestore.");
            } catch (backupErr) {
              console.error("Error al guardar backup rotativo en Firestore:", backupErr);
            }
          }, 5000);
        }).catch(err => console.error("Error definitivo al sincronizar mesas con Firestore:", err));

        // Registrar historial de ocupación en Firestore para futuros reportes
        const prevMesas = prevMesasStateRef.current;
        let huboCambio = false;

        if (prevMesas.length === 0) {
          prevMesasStateRef.current = mesas.map(m => ({ id: m.id, estado: m.estado }));
        } else {
          for (const m of mesas) {
            const prevM = prevMesas.find(pm => pm.id === m.id);
            if (!prevM || prevM.estado !== m.estado) {
              huboCambio = true;
              break;
            }
          }
        }

        if (huboCambio) {
          prevMesasStateRef.current = mesas.map(m => ({ id: m.id, estado: m.estado }));
          const totalMesas = mesas.length || 1;
          const ocupadas = mesas.filter(m => m.estado === 'ocupada').length;
          const libres = mesas.filter(m => m.estado === 'libre').length;
          const reservadas = mesas.filter(m => m.estado === 'reservada').length;
          const manten = mesas.filter(m => m.estado === 'manten').length;
          const pct = Math.round((ocupadas / totalMesas) * 100);

          const docData = {
            fecha: new Date().toISOString(),
            timestamp: serverTimestamp(),
            pctOcupacion: pct,
            totalMesas,
            ocupadas,
            libres,
            reservadas,
            manten,
            detallesMesas: mesas.map(m => ({
              id: m.id,
              nombre: m.nombre || `Mesa ${m.id}`,
              estado: m.estado,
              cliente: m.cliente || ''
            }))
          };

          addDoc(collection(db, 'historial_ocupacion'), docData)
            .then(() => console.log("Historial de ocupación registrado exitosamente en Firestore"))
            .catch(err => console.error("Error al registrar historial de ocupación:", err));
        }
      } catch (err) {
        console.error("Error al guardar mesas u ocupar historial:", err);
      }
    }
  }, [mesas]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem('yoy_billar_cuentas', obfuscate(cuentasActivas));
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

  const totales = {
    libres:    mesas.filter(m => m.estado === 'libre').length,
    ocupadas:  mesas.filter(m => m.estado === 'ocupada').length,
    reservadas:mesas.filter(m => m.estado === 'reservada').length,
    manten:    mesas.filter(m => m.estado === 'manten').length,
  };

  const getOrderedMesas = () => {
    const base = filtro === 'todas' ? mesas : mesas.filter(m => m.estado === filtro);
    if (ordenamiento === 'numero') {
      return [...base].sort((a, b) => Number(a.id) - Number(b.id));
    }
    return [...base].sort((a, b) => {
      const getSortPriority = (tipo, ord) => {
        const t = (tipo || '').toLowerCase();
        if (ord === 'carambola_primero') {
          return t.includes('carambola') ? 0 : t.includes('pool') ? 1 : t.includes('snooker') ? 2 : 3;
        }
        if (ord === 'pool_primero') {
          return t.includes('pool') ? 0 : t.includes('carambola') ? 1 : t.includes('snooker') ? 2 : 3;
        }
        if (ord === 'snooker_primero') {
          return t.includes('snooker') ? 0 : t.includes('pool') ? 1 : t.includes('carambola') ? 2 : 3;
        }
        return 0;
      };
      const pA = getSortPriority(a.tipo, ordenamiento);
      const pB = getSortPriority(b.tipo, ordenamiento);
      if (pA !== pB) return pA - pB;
      return Number(a.id) - Number(b.id);
    });
  };
  const mesasFiltradas = getOrderedMesas();

  const abrirMesa = (mesa) => {
    if (mesa.estado === 'ocupada') { setModalCerrar(mesa); return; }
    if (mesa.estado === 'manten') { showToast('Mesa en mantenimiento, no disponible.', 'warning'); return; }
    
    // 1. Verificar si esta mesa específica ya fue asignada/alertada a un cliente en la fila
    const assignedToThisMesa = assignedFila.find(f => {
      const mesaNombreStr = mesa.nombre || `Mesa ${mesa.id}`;
      return f.mesaAsignada && (f.mesaAsignada.toLowerCase() === mesaNombreStr.toLowerCase());
    });

    if (assignedToThisMesa) {
      setModalAbrir({
        ...mesa,
        cliente: assignedToThisMesa.cliente,
        filaId: assignedToThisMesa.id,
        isLockedToQueue: true
      });
      showToast(`Mesa asignada a ${assignedToThisMesa.cliente} (Fila Virtual)`, 'info');
      return;
    }

    // 2. Si no, verificar si hay alguien en fila de espera general para este tipo de mesa
    const matchingWaiting = fila.filter(f => f.estado === 'espera' && matchesTableType(f.tipo, mesa.tipo));
    if (matchingWaiting.length > 0) {
      const nextInLine = matchingWaiting[0];
      setModalAbrir({
        ...mesa,
        cliente: nextInLine.cliente,
        filaId: nextInLine.id,
        isLockedToQueue: true
      });
      showToast(`Fila de Espera Activa: Mesa bloqueada para ${nextInLine.cliente}`, 'info');
    } else {
      setModalAbrir(mesa);
    }
  };

  const confirmarAbrirMesa = (mesaId, { cliente, esSocio, rentarTaco, rentarBolas, rentarTiza, bypassedFilaId }) => {
    let finalCliente = (cliente || '').trim();
    if (!finalCliente || ['público', 'publico', 'público general', 'publico general'].includes(finalCliente.toLowerCase())) {
      finalCliente = `Mesa ${mesaId}`;
    }
    setMesas(prev => prev.map(m => m.id === mesaId
      ? { ...m, estado: 'ocupada', cliente: finalCliente, inicio: Date.now(), socios: esSocio, rentarTaco, rentarBolas, rentarTiza, clienteUid: '', preTicketImpreso: false, reservadaAt: null, limiteReservaMs: null, telefono: '', filaId: bypassedFilaId ? null : ((modalAbrir && modalAbrir.filaId) ? modalAbrir.filaId : null) }
      : m
    ));

    // Limpiar cualquier cuenta leftover de esta mesa para asegurar que inicia en $0
    actualizarCuentasFirestore(prev => prev.filter(c => 
      !(c.mesaId === mesaId || (c.cliente && c.cliente.toLowerCase() === `mesa ${mesaId}`))
    )).catch(err => console.error("Error al limpiar cuenta vieja al abrir mesa:", err));
    
    if (bypassedFilaId) {
      // Registrar bypass en la bitácora
      registrarEvento('Bypass Fila Virtual', `Se realizó bypass de Fila Virtual para abrir la Mesa ${mesaId} a nombre de ${finalCliente}. El cliente en espera original conservará su posición.`);
      showToast(`Bypass autorizado para Mesa ${mesaId}`, 'warning');
    } else if (modalAbrir && modalAbrir.filaId) {
      const docId = String(modalAbrir.filaId);
      updateDoc(doc(db, 'fila_espera', docId), {
        estado: 'completado',
        mesaAsignada: `Mesa ${mesaId}`,
        assignedAt: serverTimestamp()
      }).catch(err => console.error("Error al actualizar estado en fila_espera:", err));

      setFila(prev => prev.filter(f => f.id !== modalAbrir.filaId));
    }
    
    setModalAbrir(null);
    showToast(`Mesa ${mesaId} iniciada para ${finalCliente}`, 'success');
    registrarEvento('Apertura', `Mesa ${mesaId} abierta para ${finalCliente}${esSocio ? ' (Socio)' : ''} ${rentarTaco ? '[Taco Premium] ' : ''}${rentarBolas ? '[Bolas Aramith] ' : ''}${rentarTiza ? '[Tiza Kamui]' : ''}`);
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
    let table = mesas.find(m => m.estado === 'libre' && matchesTableType(clienteEspera.tipo, m.tipo));
    if (!table) {
      table = mesas.find(m => m.estado === 'libre');
    }
    
    if (table) {
      setModalFila(false);
      setModalAbrir({
        ...table,
        cliente: clienteEspera.cliente,
        esSocio: false,
        filaId: clienteEspera.id,
        isLockedToQueue: true
      });
    } else {
      showToast('No hay mesas libres disponibles.', 'warning');
    }
  };

  const verificarFilaYRecordar = (mesaId, mesaTipo, excluirFilaId = null) => {
    // La asignación ahora es automática, no se requiere popup.
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
          telefono: '',
          inicio: null,
          socios: false,
          filaId: null,
          clienteUid: '',
          reservadaAt: null,
          limiteReservaMs: null
        };
      }
      return m;
    }));

    setModalCambiarMesa(null);
    showToast(`Sesión de juego transferida con éxito de Mesa ${origenId} a Mesa ${destinoId} ✓`, 'success');
    registrarEvento('Transferencia', `Sesión de juego transferida de Mesa ${origenId} a Mesa ${destinoId} (Cliente: ${mesaOrigen.cliente})`);
  };

  const confirmarVincularCliente = (mesaId, nuevoNombre) => {
    let cleanNombre = (nuevoNombre || '').trim();
    if (!cleanNombre || ['público', 'publico', 'público general', 'publico general'].includes(cleanNombre.toLowerCase())) {
      cleanNombre = `Mesa ${mesaId}`;
    }
    const mesa = mesas.find(m => m.id === mesaId);
    const ant = mesa ? mesa.cliente : 'Ninguno';
    setMesas(prev => prev.map(m => m.id === mesaId
      ? { ...m, cliente: cleanNombre }
      : m
    ));
    setModalVincular(null);
    showToast(`Cliente de Mesa ${mesaId} actualizado a ${cleanNombre} ✓`, 'success');
    registrarEvento('Vincular Cliente', `Cliente en Mesa ${mesaId} cambiado de "${ant}" a "${cleanNombre}"`);
  };

  const agregarSesionACuenta = async ({ costo, cuentaId, nombreNuevo }) => {
    let targetId = cuentaId;
    const mesaId = modalCerrar.id;

    // ── RECONCILIACIÓN EN CALIENTE DE CONSUMOS (Sugerencia 3) ──
    const qPending = query(
      collection(db, 'mesa_pedidos'),
      where('mesaId', '==', mesaId),
      where('estado', 'in', ['pendiente', 'listo', 'en_camino', 'entregado'])
    );
    const pendingSnap = await getDocs(qPending);
    
    const pendingItems = [];
    const pendingDocsToUpdate = [];
    
    pendingSnap.docs.forEach(docSnap => {
      const docData = docSnap.data();
      pendingDocsToUpdate.push({ id: docSnap.id, data: docData });
      if (!docData.cargadoACuenta) {
        const items = docData.items || [];
        items.forEach(item => {
          pendingItems.push({
            id: item.productoId || item.id || Date.now() + Math.random(),
            producto: item.nombre || item.producto,
            precio: item.precio,
            cantidad: item.cantidad
          });
        });
      }
    });

    // Descontar inventario de los items pendientes en Firestore
    if (pendingItems.length > 0) {
      try {
        await runTransaction(db, async (transaction) => {
          const invRef = doc(db, 'config', 'inventario');
          const invSnap = await transaction.get(invRef);
          if (invSnap.exists()) {
            const parsed = invSnap.data().productos || [];
            const updatedStock = parsed.map(p => {
              let totalQtyToDiscount = 0;
              pendingItems.forEach(item => {
                if (item.id === p.id) {
                  totalQtyToDiscount += item.cantidad;
                }
              });
              if (totalQtyToDiscount > 0) {
                return { ...p, stock: Math.max(0, p.stock - totalQtyToDiscount), lastModified: Date.now() };
              }
              return p;
            });
            transaction.update(invRef, {
              productos: updatedStock,
              updatedAt: serverTimestamp()
            });
            localStorage.setItem('yoy_billar_stock', obfuscate(updatedStock));
          }
        });
      } catch (stockErr) {
        console.error("Error al actualizar inventario para consumos pendientes:", stockErr);
      }
    }

    // Fail-safe: si no viene cuentaId pero ya existe una cuenta activa para esta mesa o este cliente, asociarla
    if (!targetId && nombreNuevo) {
      const existente = cuentasActivas.find(c => 
        (c.mesaId === modalCerrar.id) ||
        (c.cliente && 
         !['público', 'publico'].includes(nombreNuevo.toLowerCase()) && 
         c.cliente.toLowerCase() === nombreNuevo.toLowerCase())
      );
      if (existente) {
        targetId = existente.id;
      }
    }

    if (targetId) {
      await actualizarCuentasFirestore(prev => {
        const cuentaMesaActual = prev.find(c => c.mesaId === modalCerrar.id);
        
        let tempCuentas = prev.map(c => {
          if (String(c.id) === String(targetId)) {
            const nuevosConsumos = (c.consumos || []).map(i => ({ ...i }));
            
            // 1. Fusionar consumos de la mesa actual si es una cuenta diferente
            let consumosMesa = [];
            if (cuentaMesaActual && String(cuentaMesaActual.id) !== String(targetId)) {
              consumosMesa = cuentaMesaActual.consumos || [];
            }
            
            // 2. Unir consumos de mesa y pendientes
            const itemsUnir = [...consumosMesa, ...pendingItems];
            
            itemsUnir.forEach(itemItem => {
              const existeItem = nuevosConsumos.find(i => 
                (itemItem.id && i.id === itemItem.id) || 
                i.producto.toLowerCase() === itemItem.producto.toLowerCase()
              );
              if (existeItem) {
                existeItem.cantidad += itemItem.cantidad;
              } else {
                nuevosConsumos.push({ ...itemItem });
              }
            });

            return { 
              ...c, 
              mesaId: null,
              tiempoJuego: c.tiempoJuego + costo,
              cliente: nombreNuevo && nombreNuevo.includes('Pendiente')
                ? nombreNuevo
                : (c.cliente.toLowerCase() === `mesa ${modalCerrar.id}`.toLowerCase()
                    ? `Mesa ${modalCerrar.id} - Pendiente`
                    : `${getCleanClientName(c.cliente)} (Mesa ${modalCerrar.id} - Pendiente)`),
              consumos: nuevosConsumos
            };
          }
          return c;
        });

        if (cuentaMesaActual && String(cuentaMesaActual.id) !== String(targetId)) {
          tempCuentas = tempCuentas.filter(c => String(c.id) !== String(cuentaMesaActual.id));
        }

        return tempCuentas;
      });
      const targetCuenta = cuentasActivas.find(c => String(c.id) === String(targetId));
      const clientName = targetCuenta ? targetCuenta.cliente : targetId;
      showToast(`Mesa cerrada. Costo de $${costo} MXN agregado a la cuenta del cliente.`, 'success');
      registrarEvento('Mesa a Cuenta', `Mesa ${modalCerrar.nombre} agregada a la cuenta de ${clientName}`, costo);
    } else {
      const cuentaMesaActual = cuentasActivas.find(c => c.mesaId === modalCerrar.id);
      const consumosMesa = cuentaMesaActual ? (cuentaMesaActual.consumos || []) : [];
      
      const nuevosConsumos = [...consumosMesa];
      pendingItems.forEach(pendingItem => {
        const existeItem = nuevosConsumos.find(i => 
          (pendingItem.id && i.id === pendingItem.id) || 
          i.producto.toLowerCase() === pendingItem.producto.toLowerCase()
        );
        if (existeItem) {
          existeItem.cantidad += pendingItem.cantidad;
        } else {
          nuevosConsumos.push({ ...pendingItem });
        }
      });

      const nueva = {
        id: Date.now(),
        cliente: nombreNuevo,
        tiempoJuego: costo,
        consumos: nuevosConsumos,
        inicio: Date.now()
      };
      
      await actualizarCuentasFirestore(prev => {
        let filtered = prev;
        if (cuentaMesaActual) {
          filtered = prev.filter(c => String(c.id) !== String(cuentaMesaActual.id));
        }
        return [...filtered, nueva];
      });
      showToast(`Mesa cerrada. Cuenta abierta para ${nombreNuevo} con $${costo} MXN de tiempo.`, 'success');
      registrarEvento('Mesa a Cuenta Nueva', `Mesa ${modalCerrar.nombre} agregada a una cuenta nueva para ${nombreNuevo}`, costo);
    }

    // Desactivar/atender/finalizar todas las alertas y consumos de la mesa en Firestore en lote (batch)
    if (pendingDocsToUpdate.length > 0) {
      const batch = writeBatch(db);
      pendingDocsToUpdate.forEach(item => {
        const nuevoEstado = item.data.estado === 'entregado' ? 'finalizado' : 'atendido';
        batch.update(doc(db, 'mesa_pedidos', item.id), {
          estado: nuevoEstado,
          cargadoACuenta: true,
          atendidoAdmin: true,
          atendidoAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        });
      });
      await batch.commit();
    }

    setMesas(prev => prev.map(m => m.id === modalCerrar.id
      ? { ...m, estado: 'libre', cliente: null, telefono: '', inicio: null, socios: false, clienteUid: '', preTicketImpreso: false, reservadaAt: null, limiteReservaMs: null, filaId: null }
      : m
    ));

    if (modalCerrar && modalCerrar.filaId) {
      setFila(prev => prev.filter(f => f.id !== modalCerrar.filaId));
    }

    const mesaIdParaRecordar = modalCerrar.id;
    const mesaTipoParaRecordar = modalCerrar.tipo;
    const filaIdParaExcluir = modalCerrar.filaId;

    setModalCerrar(null);
    verificarFilaYRecordar(mesaIdParaRecordar, mesaTipoParaRecordar, filaIdParaExcluir);
  };

  const imprimirTodosLosQRs = () => {
    const w = window.open('', '_blank');
    if (!w) {
      showToast("El navegador bloqueó la ventana emergente. Por favor, habilite los pop-ups para imprimir.", "danger");
      return;
    }
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
          <p style="font-size: 11px; color: #999; margin-top: 10px;">yoy-ia-billar.vercel.app/mesa/${mesa.id}?s=${getEncodedSalonId()}</p>
        </div>
      `;
    });

    htmlContent += `
      <script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script>
      <script>
        window.onload = () => {
          const mesasData = ${JSON.stringify(mesas.map(m => ({ id: m.id, url: `https://yoy-ia-billar.vercel.app/mesa/${m.id}?s=${getEncodedSalonId()}` })))};
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

  const registrarPreTicketMesa = (mesaId) => {
    setMesas(prev => prev.map(m => m.id === mesaId ? { ...m, preTicketImpreso: true, preTicketImpresoAt: Date.now() } : m));
    showToast(`Pre-ticket registrado para Mesa ${mesaId} ✓`, 'success');
    registrarEvento('Impresión Pre-Ticket', `Pre-ticket impreso y registrado para Mesa ${mesaId}`);
  };

  const imprimirPreTicket = (mesa) => {
    const cuentaAsociada = getCuentaAsociadaSafe(mesa, cuentasActivas);
    const consumos = cuentaAsociada.consumos;
    const costoTiempo = calcCosto({ ...mesa, inicio: mesa.inicio });
    const consumosTotal = consumos.reduce((sum, item) => sum + item.precio * item.cantidad, 0);
    const total = mesa.socios ? consumosTotal : (costoTiempo + consumosTotal);

    const w = window.open('', '_blank');
    if (!w) {
      showToast("El navegador bloqueó la ventana emergente. Por favor, habilite los pop-ups para imprimir.", "danger");
      return;
    }
    let htmlContent = `
      <html><head><title>Pre-Ticket - Mesa ${mesa.id}</title>
      <style>
        body { margin: 0; padding: 20px; font-family: 'Courier New', Courier, monospace; background: #fff; color: #000; font-size: 13px; line-height: 1.4; max-width: 280px; }
        .text-center { text-align: center; }
        .text-right { text-align: right; }
        .divider { border-top: 1px dashed #000; margin: 10px 0; }
        .header { margin-bottom: 12px; }
        .header h3 { margin: 0; font-size: 16px; font-weight: bold; }
        .header p { margin: 2px 0; font-size: 11px; }
        .details-table { width: 100%; border-collapse: collapse; }
        .details-table td { padding: 3px 0; vertical-align: top; font-size: 12px; }
        .footer { margin-top: 20px; font-size: 10px; text-align: center; color: #555; }
      </style>
      </head>
      <body>
        <div class="header text-center">
          <h3>YoY IA Billar Club</h3>
          <p>Pre-Ticket de Cuenta</p>
          <p>Fecha: ${new Date().toLocaleString()}</p>
        </div>
        
        <div class="divider"></div>
        
        <div>
          <strong>Mesa:</strong> ${mesa.nombre || `Mesa ${mesa.id}`}<br/>
          <strong>Cliente:</strong> ${mesa.cliente || 'Público General'}<br/>
          <strong>Inicio:</strong> ${mesa.inicio ? new Date(mesa.inicio).toLocaleTimeString() : ''}<br/>
          <strong>Tiempo:</strong> ${formatTime(Date.now() - (mesa.inicio || Date.now()))}<br/>
          ${mesa.socios ? '<strong>Socio:</strong> Sí (Sin cargo por tiempo)' : ''}
        </div>
        
        <div class="divider"></div>
        
        <table class="details-table">
          <thead>
            <tr style="border-bottom: 1px solid #000;">
              <th align="left" style="font-size: 11px;">Prod / Concepto</th>
              <th align="right" style="font-size: 11px;">Total</th>
            </tr>
          </thead>
          <tbody>
    `;

    if (!mesa.socios) {
      htmlContent += `
        <tr>
          <td>Tiempo de Juego (${((Date.now() - mesa.inicio) / 3600000).toFixed(2)} hrs)</td>
          <td align="right">$${costoTiempo}</td>
        </tr>
      `;
    }

    consumos.forEach(item => {
      htmlContent += `
        <tr>
          <td>${item.cantidad}x ${item.producto}</td>
          <td align="right">$${item.precio * item.cantidad}</td>
        </tr>
      `;
    });

    if (mesa.rentarTaco || mesa.rentarBolas || mesa.rentarTiza) {
      htmlContent += `
        <tr style="border-top: 1px dashed #ccc;">
          <td colspan="2" style="font-size: 11px; padding-top: 4px;"><strong>Equipamiento rentado:</strong></td>
        </tr>
      `;
      if (mesa.rentarTaco) {
        const tacoName = (globalRentaExtras && globalRentaExtras.find(e => e.id === 'taco')?.nombre) || 'Taco de Fibra Carbono';
        htmlContent += `<tr><td style="padding-left: 8px; font-size: 11px;">- ${tacoName}</td><td align="right" style="font-size: 11px;">Incluido</td></tr>`;
      }
      if (mesa.rentarBolas) {
        const bolasName = (globalRentaExtras && globalRentaExtras.find(e => e.id === 'bolas')?.nombre) || 'Bolas Aramith';
        htmlContent += `<tr><td style="padding-left: 8px; font-size: 11px;">- ${bolasName}</td><td align="right" style="font-size: 11px;">Incluido</td></tr>`;
      }
      if (mesa.rentarTiza) {
        const tizaName = (globalRentaExtras && globalRentaExtras.find(e => e.id === 'tiza')?.nombre) || 'Tiza Kamui';
        htmlContent += `<tr><td style="padding-left: 8px; font-size: 11px;">- ${tizaName}</td><td align="right" style="font-size: 11px;">Incluido</td></tr>`;
      }
    }

    htmlContent += `
          </tbody>
        </table>
        
        <div class="divider"></div>
        
        <table style="width: 100%; font-size: 15px; font-weight: bold;">
          <tr>
            <td>TOTAL:</td>
            <td align="right">$${total} MXN</td>
          </tr>
        </table>
        
        <div class="footer">
          <p>*** PRE-TICKET / CUENTA ***</p>
          <p>Este ticket no es un comprobante de pago final.</p>
          <p>Por favor pague en caja.</p>
        </div>
        
        <script>
          window.onload = () => {
            window.print();
            setTimeout(() => { window.close(); }, 500);
          };
        </script>
      </body>
      </html>
    `;

    w.document.write(htmlContent);
    w.document.close();
  };

  const imprimirComprobanteEspera = (filaEntry) => {
    const host = typeof window !== 'undefined' ? window.location.origin : 'https://yoy-ia-billar.vercel.app';
    const queueUrl = `${host}/fila/${filaEntry.id}`;

    let htmlContent = `
      <html><head><title>Comprobante de Fila - YoY IA Billar Club</title>
      <style>
        body { margin: 0; padding: 10px; font-family: 'Courier New', Courier, monospace; background: #fff; color: #000; font-size: 13px; line-height: 1.4; max-width: 280px; text-align: center; }
        .text-center { text-align: center; }
        .divider { border-top: 1px dashed #000; margin: 10px 0; }
        .header h3 { margin: 0; font-size: 16px; font-weight: bold; }
        .header p { margin: 2px 0; font-size: 11px; }
        .qr-container { margin: 15px auto; width: 150px; height: 150px; display: flex; justify-content: center; align-items: center; }
        .footer { margin-top: 15px; font-size: 10px; color: #555; }
      </style>
      </head>
      <body>
        <div class="header">
          <h3>YoY IA Billar Club</h3>
          <p>COMPROBANTE DE TURNO</p>
          <p>Fecha: ${new Date().toLocaleString()}</p>
        </div>
        
        <div class="divider"></div>
        
        <div style="text-align: left; font-size: 12px;">
          <strong>Turno / ID:</strong> ${filaEntry.id}<br/>
          <strong>Cliente:</strong> ${filaEntry.cliente}<br/>
          <strong>Mesa Solicitada:</strong> ${filaEntry.tipo}<br/>
          <strong>Personas:</strong> ${filaEntry.personas}<br/>
        </div>
        
        <div class="divider"></div>
        
        <p style="font-size: 11px; font-weight: bold; margin-bottom: 5px;">Escanea este QR con tu celular:</p>
        <div id="qrcode-container" class="qr-container" style="margin: 0 auto;"></div>
        <p style="font-size: 10px; color: #666; margin-top: 6px; padding: 0 10px;">Para recibir alerta sonora y vibración en tu dispositivo cuando tu mesa esté lista.</p>
        
        <div class="divider"></div>
        
        <div class="footer">
          <p>¡Gracias por su paciencia!</p>
          <p>YoY IA Billar Club</p>
        </div>
        
        <script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script>
        <script>
          window.onload = () => {
            new QRCode(document.getElementById('qrcode-container'), {
              text: "${queueUrl}",
              width: 150,
              height: 150,
              colorDark: "#000000",
              colorLight: "#ffffff",
              correctLevel: QRCode.CorrectLevel.H
            });
            setTimeout(() => {
              window.print();
            }, 600);
          };
        </script>
      </body>
      </html>
    `;

    try {
      const iframe = document.createElement('iframe');
      iframe.style.position = 'fixed';
      iframe.style.right = '0';
      iframe.style.bottom = '0';
      iframe.style.width = '0';
      iframe.style.height = '0';
      iframe.style.border = '0';
      document.body.appendChild(iframe);

      const doc = iframe.contentWindow.document || iframe.contentDocument;
      doc.open();
      doc.write(htmlContent);
      doc.close();

      iframe.contentWindow.focus();
      setTimeout(() => {
        iframe.contentWindow.print();
        setTimeout(() => {
          document.body.removeChild(iframe);
        }, 1500);
      }, 300);
    } catch (err) {
      console.error("Error al inyectar iframe de fila:", err);
    }
  };

  const imprimirQRRegistroVirtual = () => {
    const host = typeof window !== 'undefined' ? window.location.origin : 'https://yoy-ia-billar.vercel.app';
    const registroUrl = `${host}/fila/registro?s=${getEncodedSalonId()}`;

    const htmlContent = `
      <html><head><title>Fila Virtual - YoY IA Billar Club</title>
      <style>
        body { margin: 0; padding: 20px; font-family: 'Courier New', Courier, monospace; background: #fff; color: #000; font-size: 13px; line-height: 1.4; max-width: 280px; text-align: center; }
        .text-center { text-align: center; }
        .divider { border-top: 1px dashed #000; margin: 10px 0; }
        .header h2 { margin: 0; font-size: 18px; font-weight: bold; }
        .header p { margin: 2px 0; font-size: 11px; }
        .qr-container { margin: 15px auto; width: 180px; height: 180px; display: flex; justify-content: center; align-items: center; }
        .footer { margin-top: 15px; font-size: 10px; color: #555; }
      </style>
      </head>
      <body>
        <div class="header">
          <h2>YoY IA Billar Club</h2>
          <p>FILA VIRTUAL AUTOSERVICIO</p>
        </div>
        
        <div class="divider"></div>
        
        <p style="font-size: 11px; font-weight: bold; margin-bottom: 5px;">ESCANEA PARA REGISTRARTE:</p>
        <div id="qrcode-container" class="qr-container" style="margin: 0 auto;"></div>
        
        <p style="font-size: 11px; font-weight: bold; margin-top: 10px;">INSTRUCCIONES:</p>
        <div style="text-align: left; font-size: 11px; padding: 0 5px;">
          1. Escanea el código QR con tu celular.<br/>
          2. Elige tu tipo de mesa y nombre.<br/>
          3. Recibe tu turno en la fila.<br/>
          4. Te notificaremos cuando tu mesa esté lista.
        </div>
        
        <div class="divider"></div>
        
        <div class="footer">
          <p>YoY IA Billar Club</p>
        </div>
        
        <script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script>
        <script>
          window.onload = () => {
            new QRCode(document.getElementById('qrcode-container'), {
              text: "${registroUrl}",
              width: 180,
              height: 180,
              colorDark: "#000000",
              colorLight: "#ffffff",
              correctLevel: QRCode.CorrectLevel.H
            });
            setTimeout(() => {
              window.print();
            }, 600);
          };
        </script>
      </body>
      </html>
    `;

    try {
      const iframe = document.createElement('iframe');
      iframe.style.position = 'fixed';
      iframe.style.right = '0';
      iframe.style.bottom = '0';
      iframe.style.width = '0';
      iframe.style.height = '0';
      iframe.style.border = '0';
      document.body.appendChild(iframe);

      const doc = iframe.contentWindow.document || iframe.contentDocument;
      doc.open();
      doc.write(htmlContent);
      doc.close();

      iframe.contentWindow.focus();
      setTimeout(() => {
        iframe.contentWindow.print();
        setTimeout(() => {
          document.body.removeChild(iframe);
        }, 1500);
      }, 300);
    } catch (err) {
      console.error("Error al imprimir QR de fila virtual:", err);
    }
  };

  const imprimirComprobanteReserva = (mesa) => {
    const host = typeof window !== 'undefined' ? window.location.origin : 'https://yoy-ia-billar.vercel.app';
    const mesaUrl = `${host}/mesa/${mesa.id}?s=${getEncodedSalonId()}`;

    let htmlContent = `
      <html><head><title>Comprobante de Reserva - YoY IA Billar Club</title>
      <style>
        body { margin: 0; padding: 10px; font-family: 'Courier New', Courier, monospace; background: #fff; color: #000; font-size: 13px; line-height: 1.4; max-width: 280px; text-align: center; }
        .text-center { text-align: center; }
        .divider { border-top: 1px dashed #000; margin: 10px 0; }
        .header h3 { margin: 0; font-size: 16px; font-weight: bold; }
        .header p { margin: 2px 0; font-size: 11px; }
        .qr-container { margin: 15px auto; width: 150px; height: 150px; display: flex; justify-content: center; align-items: center; }
        .footer { margin-top: 15px; font-size: 10px; color: #555; }
      </style>
      </head>
      <body>
        <div class="header">
          <h3>YoY IA Billar Club</h3>
          <p>TICKET DE RESERVACIÓN</p>
          <p>Fecha: ${new Date().toLocaleString()}</p>
        </div>
        
        <div class="divider"></div>
        
        <div style="text-align: left; font-size: 12px;">
          <strong>Mesa:</strong> ${mesa.nombre || `Mesa ${mesa.id}`}<br/>
          <strong>Cliente:</strong> ${mesa.cliente}<br/>
          <strong>Teléfono:</strong> ${mesa.telefono || 'Sin registrar'}<br/>
          <strong>Límite Tolerancia:</strong> ${mesa.limiteReservaMs ? Math.round(mesa.limiteReservaMs / 60000) : 30} minutos<br/>
        </div>
        
        <div class="divider"></div>
        
        <p style="font-size: 11px; font-weight: bold; margin-bottom: 5px;">Escanea este QR con tu celular:</p>
        <div id="qrcode-container" class="qr-container" style="margin: 0 auto;"></div>
        <p style="font-size: 10px; color: #666; margin-top: 6px; padding: 0 10px;">Para recibir alerta sonora y vibración en tu dispositivo cuando tu mesa sea activada.</p>
        
        <div class="divider"></div>
        
        <div class="footer">
          <p>¡Gracias por reservar con nosotros!</p>
          <p>YoY IA Billar Club</p>
        </div>
        
        <script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script>
        <script>
          window.onload = () => {
            new QRCode(document.getElementById('qrcode-container'), {
              text: "${mesaUrl}",
              width: 150,
              height: 150,
              colorDark: "#000000",
              colorLight: "#ffffff",
              correctLevel: QRCode.CorrectLevel.H
            });
            setTimeout(() => {
              window.print();
            }, 600);
          };
        </script>
      </body>
      </html>
    `;

    try {
      const iframe = document.createElement('iframe');
      iframe.style.position = 'fixed';
      iframe.style.right = '0';
      iframe.style.bottom = '0';
      iframe.style.width = '0';
      iframe.style.height = '0';
      iframe.style.border = '0';
      document.body.appendChild(iframe);

      const doc = iframe.contentWindow.document || iframe.contentDocument;
      doc.open();
      doc.write(htmlContent);
      doc.close();

      iframe.contentWindow.focus();
      setTimeout(() => {
        iframe.contentWindow.print();
        setTimeout(() => {
          document.body.removeChild(iframe);
        }, 1500);
      }, 300);
    } catch (err) {
      console.error("Error al inyectar iframe de reserva:", err);
    }
  };

  const imprimirTicketFinal = ({
    cliente,
    isMesa,
    mesaNombre,
    inicio,
    tiempoJuegoCosto,
    durationStr,
    consumos,
    total,
    metodoPago,
    pagaCon,
    cambio,
    referenciaPago,
    operador
  }) => {
    let htmlContent = `
      <html><head><title>Comprobante de Pago - YoY IA Billar Club</title>
      <style>
        body { margin: 0; padding: 10px; font-family: 'Courier New', Courier, monospace; background: #fff; color: #000; font-size: 13px; line-height: 1.4; max-width: 280px; }
        .text-center { text-align: center; }
        .text-right { text-align: right; }
        .divider { border-top: 1px dashed #000; margin: 10px 0; }
        .header { margin-bottom: 12px; }
        .header h3 { margin: 0; font-size: 16px; font-weight: bold; }
        .header p { margin: 2px 0; font-size: 11px; }
        .details-table { width: 100%; border-collapse: collapse; }
        .details-table td { padding: 3px 0; vertical-align: top; font-size: 12px; }
        .footer { margin-top: 20px; font-size: 10px; text-align: center; color: #555; }
      </style>
      </head>
      <body>
        <div class="header text-center">
          <h3>YoY IA Billar Club</h3>
          <p>Comprobante de Pago (VENTA)</p>
          <p>Fecha: ${new Date().toLocaleString()}</p>
        </div>
        
        <div class="divider"></div>
        
        <div>
          ${isMesa ? `<strong>Mesa:</strong> ${mesaNombre}<br/>` : ''}
          <strong>Cliente:</strong> ${cliente || 'Público General'}<br/>
          ${isMesa && inicio ? `<strong>Inicio:</strong> ${new Date(inicio).toLocaleTimeString()}<br/>` : ''}
          ${isMesa && durationStr ? `<strong>Tiempo Jugado:</strong> ${durationStr}<br/>` : ''}
          <strong>Cajero:</strong> ${operador || 'Cajero Principal'}<br/>
        </div>
        
        <div class="divider"></div>
        
        <table class="details-table">
          <thead>
            <tr style="border-bottom: 1px solid #000;">
              <th align="left" style="font-size: 11px;">Prod / Concepto</th>
              <th align="right" style="font-size: 11px;">Total</th>
            </tr>
          </thead>
          <tbody>
    `;

    if (tiempoJuegoCosto > 0) {
      htmlContent += `
        <tr>
          <td>Tiempo de Juego</td>
          <td align="right">$${tiempoJuegoCosto} MXN</td>
        </tr>
      `;
    }

    consumos.forEach(item => {
      htmlContent += `
        <tr>
          <td>${item.cantidad}x ${item.producto}</td>
          <td align="right">$${item.precio * item.cantidad} MXN</td>
        </tr>
      `;
    });

    htmlContent += `
          </tbody>
        </table>
        
        <div class="divider"></div>
        
        <table style="width: 100%; font-size: 13px;">
          <tr>
            <td><strong>TOTAL:</strong></td>
            <td align="right"><strong>$${total} MXN</strong></td>
          </tr>
          <tr>
            <td>Método Pago:</td>
            <td align="right">${metodoPago}</td>
          </tr>
    `;

    if (metodoPago.toLowerCase().includes('efectivo')) {
      htmlContent += `
        <tr>
          <td>Recibido:</td>
          <td align="right">$${pagaCon} MXN</td>
        </tr>
        <tr>
          <td>Cambio:</td>
          <td align="right">$${cambio} MXN</td>
        </tr>
      `;
    }

    if (referenciaPago) {
      htmlContent += `
        <tr>
          <td>Ref/Trans:</td>
          <td align="right">${referenciaPago}</td>
        </tr>
      `;
    }

    htmlContent += `
        </table>
        
        <div class="divider"></div>
        
        <div class="footer">
          <p>¡Gracias por su visita y preferencia!</p>
          <p>YoY IA Billar Club</p>
        </div>
      </body>
      </html>
    `;

    try {
      const iframe = document.createElement('iframe');
      iframe.style.position = 'fixed';
      iframe.style.right = '0';
      iframe.style.bottom = '0';
      iframe.style.width = '0';
      iframe.style.height = '0';
      iframe.style.border = '0';
      document.body.appendChild(iframe);

      const doc = iframe.contentWindow.document || iframe.contentDocument;
      doc.open();
      doc.write(htmlContent);
      doc.close();

      iframe.contentWindow.focus();
      setTimeout(() => {
        iframe.contentWindow.print();
        setTimeout(() => {
          document.body.removeChild(iframe);
        }, 1500);
      }, 300);
    } catch (err) {
      console.error("Error al inyectar iframe e imprimir:", err);
      showToast("Error de impresión local. Intente de nuevo.", "danger");
    }
  };

  const confirmarCerrarMesa = async (mesaId, { costo, metodo, tiempo, referencia, pagaCon, cambio, fotoAdjunta, motivo }) => {
    if (procesandoCierre) return;
    setProcesandoCierre(true);
    try {
      const mesa = mesas.find(m => m.id === mesaId);
      const clientName = mesa ? mesa.cliente : 'Público';

      // Buscar la cuenta asociada para auditar el detalle de consumos al cerrar
      const cuentaAsociada = getCuentaAsociadaSafe(mesa, cuentasActivas);

      // ── RECONCILIACIÓN EN CALIENTE DE CONSUMOS (Sugerencia 3) ──
      // Obtener todos los pedidos no cargados de esta mesa
      const qPendingOrders = query(
        collection(db, 'mesa_pedidos'),
        where('mesaId', '==', mesaId),
        where('estado', 'in', ['pendiente', 'listo', 'en_camino', 'entregado'])
      );
      const pendingSnap = await getDocs(qPendingOrders);
      
      const pendingItems = [];
      const pendingDocsToUpdate = [];
      
      pendingSnap.docs.forEach(docSnap => {
        const docData = docSnap.data();
        pendingDocsToUpdate.push({ id: docSnap.id, data: docData });
        if (!docData.cargadoACuenta) {
          const items = docData.items || [];
          items.forEach(item => {
            pendingItems.push({
              id: item.productoId || item.id || Date.now() + Math.random(),
              producto: item.nombre || item.producto,
              precio: item.precio,
              cantidad: item.cantidad
            });
          });
        }
      });

      // Consolidar consumos cargados y descargados
      const consumosConsolidados = [...cuentaAsociada.consumos];
      pendingItems.forEach(pendingItem => {
        const existe = consumosConsolidados.find(i => 
          (pendingItem.id && i.id === pendingItem.id) || 
          i.producto.toLowerCase() === pendingItem.producto.toLowerCase()
        );
        if (existe) {
          existe.cantidad += pendingItem.cantidad;
        } else {
          consumosConsolidados.push(pendingItem);
        }
      });

      // Registrar SIEMPRE el cierre en historial_stock para auditoría en la nube (evitando pérdida de información)
      const itemsAuditoria = consumosConsolidados.map(item => ({
        productoId: item.id || 0,
        nombre: item.producto,
        precio: item.precio,
        cantidad: item.cantidad,
        subtotal: item.precio * item.cantidad
      }));

      // Ejecutar la liquidación de la cuenta y el registro de auditoría en una transacción atómica
      const stockRef = doc(db, 'historial_stock', "cierre_mesa_" + mesaId + "_" + (mesa ? mesa.inicio : 0));
      const cuentasRef = doc(db, 'config', 'cuentas_estado');
      let updatedCuentas = [];

      await runTransaction(db, async (transaction) => {
        const sfDoc = await transaction.get(cuentasRef);
        let currentCuentas = [];
        if (sfDoc.exists()) {
          currentCuentas = sfDoc.data().cuentas || [];
        }

        updatedCuentas = currentCuentas.filter(c => 
          !(c.mesaId === mesaId || (c.cliente && (
            (mesa && mesa.cliente && !['público', 'publico'].includes(mesa.cliente.toLowerCase()) && c.cliente.toLowerCase() === mesa.cliente.toLowerCase()) || 
            c.cliente.toLowerCase() === `mesa ${mesaId}`
          )))
        );

        // Descontar inventario central de los items pendientes reconciliados si aplica
        const invRef = doc(db, 'config', 'inventario');
        const invSnap = await transaction.get(invRef);
        let updatedStock = null;
        if (invSnap.exists() && pendingItems.length > 0) {
          const parsed = invSnap.data().productos || [];
          updatedStock = parsed.map(p => {
            let totalQtyToDiscount = 0;
            pendingItems.forEach(item => {
              if (item.id === p.id) {
                totalQtyToDiscount += item.cantidad;
              }
            });
            if (totalQtyToDiscount > 0) {
              return { ...p, stock: Math.max(0, p.stock - totalQtyToDiscount), lastModified: Date.now() };
            }
            return p;
          });
        }

        // Actualizar inventario si hubo cambios
        if (updatedStock) {
          transaction.update(invRef, {
            productos: updatedStock,
            updatedAt: serverTimestamp()
          });
          if (typeof window !== 'undefined') {
            localStorage.setItem('yoy_billar_stock', obfuscate(updatedStock));
          }
        }

        // Actualizar cuentas estado
        transaction.set(cuentasRef, {
          cuentas: updatedCuentas,
          updatedAt: serverTimestamp()
        });

        // Registrar en historial_stock
        transaction.set(stockRef, {
          fecha: serverTimestamp(),
          mesaId: mesaId,
          cliente: clientName,
          items: itemsAuditoria,
          total: costo,
          tipo: costo === 0 ? 'cierre_cortesia' : 'cierre_mesa_liquidada',
          tiempoJuego: tiempo ? (tiempo / 3600000).toFixed(2) + ' hrs' : '0 hrs',
          metodoPago: metodo || 'efectivo',
          referenciaPago: referencia || '',
          pagaCon: pagaCon || 0,
          cambio: cambio || 0,
          fotoAdjunta: fotoAdjunta || false,
          motivoCortesia: motivo || '',
          operador: user ? (user.displayName || user.email || 'Cajero Principal') : 'Cajero Principal',
          rolOperador: user ? (user.role || 'staff') : 'staff',
        });
      });

      // Mandar a imprimir el ticket final de cobro
      try {
        const consumosFinal = consumosConsolidados;
        let metodoPagoImprimir = metodo || 'efectivo';
        if (metodoPagoImprimir === 'efectivo') metodoPagoImprimir = 'Efectivo';
        else if (metodoPagoImprimir === 'transferencia') metodoPagoImprimir = 'Transferencia';
        else if (metodoPagoImprimir === 'qr') metodoPagoImprimir = 'Código QR';
        else if (metodoPagoImprimir === 'tarjeta') metodoPagoImprimir = 'Tarjeta';
        else if (metodoPagoImprimir === 'cortesia') metodoPagoImprimir = 'Cortesía';

        imprimirTicketFinal({
          cliente: clientName || 'Público General',
          isMesa: true,
          mesaNombre: mesa ? (mesa.nombre || `Mesa ${mesaId}`) : `Mesa ${mesaId}`,
          inicio: mesa ? mesa.inicio : null,
          tiempoJuegoCosto: mesa ? (mesa.socios ? 0 : calcCosto(mesa, tiempo)) : 0,
          durationStr: tiempo ? formatTime(tiempo) : (mesa && mesa.inicio ? formatTime(Date.now() - mesa.inicio) : '00:00:00'),
          consumos: consumosFinal,
          total: costo,
          metodoPago: metodoPagoImprimir,
          pagaCon: parseFloat(pagaCon) || 0,
          cambio: parseFloat(cambio) || 0,
          referenciaPago: referencia || '',
          operador: user ? (user.displayName || user.email || 'Cajero Principal') : 'Cajero Principal'
        });
      } catch (printErr) {
        console.error("Error al imprimir ticket de cobro:", printErr);
      }

      // Actualizar caché local y estado
      if (typeof window !== 'undefined') {
        localStorage.setItem('yoy_billar_cuentas', obfuscate(updatedCuentas));
      }
      setCuentasActivas(updatedCuentas);

      // ── REGISTRAR EN COBROS DE LA CAJA DIARIA (Cuentas del Día) ──
      try {
        const savedCobros = localStorage.getItem('yoy_caja_cobros');
        let currentCobros = savedCobros ? JSON.parse(savedCobros) : [];

        let metodoPagoCobro = metodo || 'efectivo';
        if (metodoPagoCobro === 'efectivo') metodoPagoCobro = 'Efectivo';
        else if (metodoPagoCobro === 'transferencia') metodoPagoCobro = 'Transferencia';
        else if (metodoPagoCobro === 'qr') metodoPagoCobro = 'Código QR';
        else if (metodoPagoCobro === 'tarjeta') metodoPagoCobro = 'Tarjeta';
        else if (metodoPagoCobro === 'cortesia') metodoPagoCobro = 'Cortesía';

        const nuevoCobro = {
          id: Date.now(),
          tipo: 'cierre_mesa',
          descripcion: `Cierre ${mesa ? (mesa.nombre || `Mesa ${mesaId}`) : `Mesa ${mesaId}`} - ${clientName || 'Público General'}`,
          cliente: clientName || 'Público General',
          monto: Number(costo),
          metodo: metodoPagoCobro,
          hora: new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }),
          color: 'var(--success)'
        };

        const updatedCobros = [nuevoCobro, ...currentCobros];
        localStorage.setItem('yoy_caja_cobros', JSON.stringify(updatedCobros));

        // Sincronizar otros paneles (por ejemplo, CajaPanel)
        window.dispatchEvent(new Event('storage'));
      } catch (err) {
        console.error("Error al registrar cierre de mesa en cobros de caja:", err);
      }

      // CALCULO DE COMISIONES PARA MESEROS ASIGNADOS A LA MESA
      if (mesa) {
        const costoMesa = mesa.socios ? 0 : calcCosto(mesa, tiempo);
        const consumosFinal = consumosConsolidados;
        const costoBar = consumosFinal.reduce((sum, item) => sum + ((item.precio || item.precioVenta || 0) * (item.cantidad || 0)), 0);
        
        const waiterIds = mesa.meseroIds && Array.isArray(mesa.meseroIds) && mesa.meseroIds.length > 0 
          ? mesa.meseroIds 
          : (mesa.meseroId ? [mesa.meseroId] : []);

        if (waiterIds.length > 0) {
          for (const wId of waiterIds) {
            const emp = empleadosTodos.find(e => e.id === wId);
            if (emp) {
              let comisionMesa = 0;
              if (emp.comisionMesas > 0) {
                const val = emp.comisionMesasTipo === 'porcentaje'
                  ? (costoMesa * Number(emp.comisionMesas)) / 100
                  : Number(emp.comisionMesas);
                comisionMesa = val / waiterIds.length;
              }
              
              let comisionBar = 0;
              if (emp.comisionBar > 0) {
                const val = emp.comisionBarTipo === 'porcentaje'
                  ? (costoBar * Number(emp.comisionBar)) / 100
                  : Number(emp.comisionBar);
                comisionBar = val / waiterIds.length;
              }

              if (comisionMesa > 0 || comisionBar > 0) {
                try {
                  await addDoc(collection(db, 'nomina_comisiones'), {
                    empleadoId: emp.id,
                    empleadoNombre: `${emp.nombre} ${emp.apellido || ''}`.trim(),
                    fecha: new Date().toISOString().slice(0, 10),
                    mesaId: mesaId,
                    montoMesa: costoMesa,
                    montoBar: costoBar,
                    comisionMesa: Number(comisionMesa.toFixed(2)),
                    comisionBar: Number(comisionBar.toFixed(2)),
                    comisionTotal: Number((comisionMesa + comisionBar).toFixed(2)),
                    createdAt: serverTimestamp()
                  });
                } catch (commErr) {
                  console.error("Error al registrar comisión para empleado:", emp.id, commErr);
                }
              }
            }
          }
        }
      }

      // Desactivar/atender/finalizar todas las alertas y consumos de la mesa en Firestore en lote (batch)
      if (pendingDocsToUpdate.length > 0) {
        const batch = writeBatch(db);
        pendingDocsToUpdate.forEach(item => {
          const nuevoEstado = item.data.estado === 'entregado' ? 'finalizado' : 'atendido';
          batch.update(doc(db, 'mesa_pedidos', item.id), {
            estado: nuevoEstado,
            cargadoACuenta: true,
            atendidoAdmin: true,
            atendidoAt: serverTimestamp(),
            updatedAt: serverTimestamp()
          });
        });
        await batch.commit();
      }

      setMesas(prev => prev.map(m => m.id === mesaId
        ? { ...m, estado: 'libre', cliente: null, telefono: '', inicio: null, socios: false, clienteUid: '', preTicketImpreso: false, reservadaAt: null, limiteReservaMs: null, filaId: null }
        : m
      ));
      setModalCerrar(null);

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

      if (costo > 0) {
        showToast(`Cobrado $${costo} MXN por ${metodoLabel} ✓`, 'success');
        registrarEvento('Cierre Directo', `Mesa ${mesaId} liquidada y cerrada por ${clientName} ($${costo} MXN por ${metodoLabel}${detalleExtra})`, costo);
      } else if (mesa && mesa.socios) {
        showToast(`Mesa cerrada (Socio sin cargo)`, 'info');
        registrarEvento('Cierre Directo', `Mesa ${mesaId} cerrada (Socio sin cargo: ${clientName})`);
      } else {
        // Cortesía registrada con motivo
        const motivoTexto = motivo ? ` — Motivo: ${motivo}` : '';
        showToast(`Cortesía registrada para ${clientName}${motivoTexto}`, 'warning');
        registrarEvento('Cortesía $0', `Mesa ${mesaId} cerrada en $0 por ${clientName}${motivoTexto}`);
      }

      setCobroExito({
        mesaNombre: mesa ? (mesa.nombre || `Mesa ${mesaId}`) : `Mesa ${mesaId}`,
        cliente: clientName || 'Público General',
        metodoPago: metodoLabel,
        total: costo,
        ticketData: {
          cliente: clientName || 'Público General',
          isMesa: true,
          mesaNombre: mesa ? (mesa.nombre || `Mesa ${mesaId}`) : `Mesa ${mesaId}`,
          inicio: mesa ? mesa.inicio : null,
          tiempoJuegoCosto: mesa ? (mesa.socios ? 0 : calcCosto(mesa, tiempo)) : 0,
          durationStr: tiempo ? formatTime(tiempo) : (mesa && mesa.inicio ? formatTime(Date.now() - mesa.inicio) : '00:00:00'),
          consumos: consumosConsolidados,
          total: costo,
          metodoPago: metodoLabel,
          pagaCon: parseFloat(pagaCon) || 0,
          cambio: parseFloat(cambio) || 0,
          referenciaPago: referencia || '',
          operador: user ? (user.displayName || user.email || 'Cajero Principal') : 'Cajero Principal'
        }
      });

      verificarFilaYRecordar(mesaId, mesa ? mesa.tipo : 'Carambola 3B', mesa ? mesa.filaId : null);
    } catch (err) {
      console.error("Error crítico al procesar el cierre/cobro de la mesa:", err);
      showToast("Error de base de datos al registrar el cobro. Verifique conexión.", "danger");
    } finally {
      setProcesandoCierre(false);
    }
  };

  const ingresosActivos = mesas
    .filter(m => m.estado === 'ocupada')
    .reduce((sum, m) => {
      const consumosTotal = consumosPorMesa[m.id] || 0;
      const costoTiempo = m.socios ? 0 : calcCosto(m);
      return sum + costoTiempo + consumosTotal;
    }, 0);

  const totalMesasCount = mesas.length || 1;
  const pctOcupacion = Math.round((totales.ocupadas / totalMesasCount) * 100);

  return (
    <div style={{ minHeight: isFullscreen ? '100vh' : 'auto', padding: isFullscreen ? '20px' : '0', background: isFullscreen ? 'var(--bg-main)' : 'transparent' }}>
      <style>{`
        @keyframes pulseBorderGold {
          0% { border-color: rgba(197, 168, 128, 0.4); box-shadow: 0 0 5px rgba(197, 168, 128, 0.15); }
          50% { border-color: rgba(197, 168, 128, 0.8); box-shadow: 0 0 15px rgba(197, 168, 128, 0.35); }
          100% { border-color: rgba(197, 168, 128, 0.4); box-shadow: 0 0 5px rgba(197, 168, 128, 0.15); }
        }
        @keyframes pulseGlowAlert {
          0% { box-shadow: 0 4px 15px rgba(197, 168, 128, 0.15); border-color: rgba(197, 168, 128, 0.4); }
          50% { box-shadow: 0 4px 25px rgba(197, 168, 128, 0.3); border-color: rgba(197, 168, 128, 0.7); }
          100% { box-shadow: 0 4px 15px rgba(197, 168, 128, 0.15); border-color: rgba(197, 168, 128, 0.4); }
        }
        @keyframes shakeCuentas {
          0%, 100% { transform: scale(1) translateX(0); }
          10%, 30%, 50%, 70%, 90% { transform: scale(1.05) translateX(-4px); }
          20%, 40%, 60%, 80% { transform: scale(1.05) translateX(4px); }
        }
        .shake-animation {
          animation: shakeCuentas 0.6s ease-in-out;
        }
        @keyframes pulseAlertSolicitada {
          0% { border-color: rgba(239, 68, 68, 0.4); box-shadow: 0 0 5px rgba(239, 68, 68, 0.15); }
          50% { border-color: rgba(239, 68, 68, 0.95); box-shadow: 0 0 15px rgba(239, 68, 68, 0.45); background: rgba(239, 68, 68, 0.08); }
          100% { border-color: rgba(239, 68, 68, 0.4); box-shadow: 0 0 5px rgba(239, 68, 68, 0.15); }
        }
        @keyframes pulseAlertSolicitadaDirecta {
          0% { border-color: rgba(245, 158, 11, 0.4); box-shadow: 0 0 5px rgba(245, 158, 11, 0.15); }
          50% { border-color: rgba(245, 158, 11, 0.95); box-shadow: 0 0 15px rgba(245, 158, 11, 0.45); background: rgba(245, 158, 11, 0.08); }
          100% { border-color: rgba(245, 158, 11, 0.4); box-shadow: 0 0 5px rgba(245, 158, 11, 0.15); }
        }
        @keyframes ringBell {
          0% { transform: rotate(0); }
          15% { transform: rotate(15deg); }
          30% { transform: rotate(-15deg); }
          45% { transform: rotate(10deg); }
          60% { transform: rotate(-10deg); }
          75% { transform: rotate(4deg); }
          85% { transform: rotate(-4deg); }
          100% { transform: rotate(0); }
        }
        .mesa-card:hover svg {
          transform: scale(1.18) rotate(4deg);
          filter: drop-shadow(0 0 6px var(--bronze-light, #c5a880));
        }
        .mesa-card svg {
          transition: all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);
        }
        @keyframes filterPulse {
          0% { transform: scale(1); }
          50% { transform: scale(1.05); }
          100% { transform: scale(1); }
        }
        .filter-active-pill {
          animation: filterPulse 0.25s cubic-bezier(0.175, 0.885, 0.32, 1.275);
        }
      `}</style>

      {/* Banner de Fila Virtual Activa (Visual Alert para el Cajero) */}
      {assignedFila.length > 0 && (
        <div style={{ 
          background: 'rgba(197, 168, 128, 0.08)', 
          border: '1.5px solid rgba(197, 168, 128, 0.4)', 
          borderRadius: 14, 
          padding: '12px 18px', 
          marginBottom: 16, 
          boxShadow: '0 4px 15px rgba(197, 168, 128, 0.15)',
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          animation: 'pulseGlowAlert 3s infinite ease-in-out'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 18, animation: 'ringBell 1.5s infinite ease' }}>🚨</span>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--bronze-light)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Fila Virtual: Asignaciones de Mesa Activas
              </span>
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                Los clientes han sido notificados en sus dispositivos móviles y tienen 5 minutos de tolerancia para presentarse.
              </span>
            </div>
          </div>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
            {assignedFila.map(f => {
              const timeRemaining = Math.max(0, 5 * 60 - Math.floor((Date.now() - (f.assignedAt || Date.now())) / 1000));
              const minutes = Math.floor(timeRemaining / 60);
              const seconds = timeRemaining % 60;
              const timeStr = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
              
              return (
                <div key={f.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: 8, padding: '8px 12px', fontSize: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <i className="ri-user-shared-line" style={{ color: 'var(--bronze-light)' }} />
                    <strong>{f.cliente}</strong> (Turno: #{String(f.id).slice(-4)}) ➔ <span style={{ color: '#22c55e', fontWeight: 700 }}>{f.mesaAsignada}</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ color: 'var(--text-secondary)' }}>Tiempo restante:</span>
                    <strong style={{ color: timeRemaining < 60 ? '#ef4444' : 'var(--bronze-light)', fontSize: 13, fontFamily: 'monospace' }}>
                      {timeStr}
                    </strong>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

        <div className="page-header" style={{
          position: 'sticky',
          top: '0px',
          zIndex: 100,
          background: 'var(--bg-elevated)',
          backdropFilter: 'blur(8px)',
          marginBottom: 16,
          border: '1px solid var(--border-bronze)',
          borderRadius: 12,
          padding: '10px 14px',
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: 8,
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.5), var(--shadow-sm)'
        }}>
        {/* Cuentas Activas (Protagonista verde brillante con animación de pulso al inicio) */}
        <button
          className="btn btn-pulse-green btn-sm"
          style={{
            padding: '6px 14px',
            fontSize: 11,
            fontWeight: 800,
            letterSpacing: '0.05em',
            display: 'flex',
            alignItems: 'center',
            gap: 6
          }}
          onClick={() => setModalCuentas(true)}
        >
          <i className="ri-folder-open-line" style={{ fontSize: 13 }} />
          <span>ACTIVAS: <strong style={{ fontSize: 12 }}>{cuentasActivas.length} CLS</strong></span>
        </button>

        {/* Cápsula Segmentada Unificada (Sin espacios intermedios y con ligeros códigos de color) */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          background: 'var(--bg-elevated)',
          border: '1px solid var(--border-bronze)',
          borderRadius: 8,
          overflow: 'hidden',
          boxShadow: 'var(--shadow-sm)'
        }}>
          {/* Todas / Ocupación */}
          <button
            onClick={() => setFiltro('todas')}
            className={filtro === 'todas' ? 'filter-active-pill' : ''}
            title="Ver Todas las Mesas [Alt + Shift + T]"
            style={{
              padding: '6px 12px',
              fontSize: 10,
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              height: 28,
              border: 'none',
              borderRight: '1px solid var(--border-bronze)',
              background: filtro === 'todas' ? 'rgba(245, 158, 11, 0.15)' : 'rgba(245, 158, 11, 0.02)',
              color: '#f59e0b',
              cursor: 'pointer',
              transition: 'all 0.15s',
              whiteSpace: 'nowrap',
              boxShadow: filtro === 'todas' ? 'inset 0 -3px 0 #f59e0b, 0 0 8px rgba(245, 158, 11, 0.2)' : 'none'
            }}
            onMouseEnter={e => {
              if (filtro !== 'todas') e.currentTarget.style.background = 'rgba(245, 158, 11, 0.08)';
            }}
            onMouseLeave={e => {
              if (filtro !== 'todas') e.currentTarget.style.background = 'rgba(245, 158, 11, 0.02)';
            }}
          >
            <div style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: pctOcupacion > 70 ? 'var(--danger)' : (pctOcupacion > 30 ? '#f59e0b' : 'var(--success)'),
              boxShadow: `0 0 6px ${pctOcupacion > 70 ? 'var(--danger)' : (pctOcupacion > 30 ? '#f59e0b' : 'var(--success)')}`,
              transform: filtro === 'todas' ? 'scale(1.3)' : 'scale(1)',
              transition: 'transform 0.2s ease'
            }} />
            <span style={{ color: 'var(--text-secondary)' }}>TODAS: <strong style={{ color: '#f59e0b' }}>{pctOcupacion}% OCUPACIÓN</strong></span>
          </button>

          {/* Libres */}
          <button
            onClick={() => setFiltro('libre')}
            className={filtro === 'libre' ? 'filter-active-pill' : ''}
            title="Ver Mesas Libres [Alt + Shift + L]"
            style={{
              padding: '6px 12px',
              fontSize: 10,
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              height: 28,
              border: 'none',
              borderRight: '1px solid var(--border-bronze)',
              background: filtro === 'libre' ? 'rgba(34, 197, 94, 0.15)' : 'rgba(34, 197, 94, 0.02)',
              color: 'var(--success)',
              cursor: 'pointer',
              transition: 'all 0.15s',
              whiteSpace: 'nowrap',
              boxShadow: filtro === 'libre' ? 'inset 0 -3px 0 var(--success), 0 0 8px rgba(34, 197, 94, 0.2)' : 'none'
            }}
            onMouseEnter={e => {
              if (filtro !== 'libre') e.currentTarget.style.background = 'rgba(34, 197, 94, 0.08)';
            }}
            onMouseLeave={e => {
              if (filtro !== 'libre') e.currentTarget.style.background = 'rgba(34, 197, 94, 0.02)';
            }}
          >
            <i className="ri-checkbox-blank-circle-line" style={{ 
              color: 'var(--success)', 
              fontSize: 11,
              transform: filtro === 'libre' ? 'scale(1.2)' : 'scale(1)',
              display: 'inline-block',
              transition: 'transform 0.2s ease'
            }} />
            <span style={{ color: 'var(--text-secondary)' }}>LIBRES: <strong style={{ color: 'var(--success)' }}>{totales.libres}</strong></span>
          </button>

          {/* Ocupadas */}
          <button
            onClick={() => setFiltro('ocupada')}
            className={filtro === 'ocupada' ? 'filter-active-pill' : ''}
            title="Ver Mesas Ocupadas [Alt + Shift + O]"
            style={{
              padding: '6px 12px',
              fontSize: 10,
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              height: 28,
              border: 'none',
              borderRight: '1px solid var(--border-bronze)',
              background: filtro === 'ocupada' ? 'rgba(255, 255, 255, 0.15)' : 'rgba(255, 255, 255, 0.02)',
              color: '#ffffff',
              cursor: 'pointer',
              transition: 'all 0.15s',
              whiteSpace: 'nowrap',
              boxShadow: filtro === 'ocupada' ? 'inset 0 -3px 0 #ffffff, 0 0 8px rgba(255, 255, 255, 0.2)' : 'none'
            }}
            onMouseEnter={e => {
              if (filtro !== 'ocupada') e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)';
            }}
            onMouseLeave={e => {
              if (filtro !== 'ocupada') e.currentTarget.style.background = 'rgba(255, 255, 255, 0.02)';
            }}
          >
            <i className="ri-record-circle-line" style={{ 
              color: '#ffffff', 
              fontSize: 11,
              transform: filtro === 'ocupada' ? 'scale(1.2)' : 'scale(1)',
              display: 'inline-block',
              transition: 'transform 0.2s ease'
            }} />
            <span style={{ color: 'var(--text-secondary)' }}>OCUPADAS: <strong style={{ color: '#ffffff' }}>{totales.ocupadas}</strong></span>
          </button>

          {/* Reservadas */}
          <div
            onClick={() => setFiltro('reservada')}
            className={filtro === 'reservada' ? 'filter-active-pill' : ''}
            title="Ver Mesas Reservadas [Alt + Shift + R]"
            style={{
              padding: '6px 12px',
              fontSize: 10,
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              height: 28,
              borderRight: '1px solid var(--border-bronze)',
              background: filtro === 'reservada' ? 'rgba(227, 168, 105, 0.15)' : 'rgba(227, 168, 105, 0.02)',
              color: 'var(--bronze-light)',
              cursor: 'pointer',
              transition: 'all 0.15s',
              whiteSpace: 'nowrap',
              boxShadow: filtro === 'reservada' ? 'inset 0 -3px 0 var(--bronze-light), 0 0 8px rgba(227, 168, 105, 0.2)' : 'none'
            }}
            onMouseEnter={e => {
              if (filtro !== 'reservada') e.currentTarget.style.background = 'rgba(227, 168, 105, 0.08)';
            }}
            onMouseLeave={e => {
              if (filtro !== 'reservada') e.currentTarget.style.background = 'rgba(227, 168, 105, 0.02)';
            }}
          >
            <i className="ri-bookmark-fill" style={{ 
              color: 'var(--bronze-light)', 
              fontSize: 11,
              transform: filtro === 'reservada' ? 'scale(1.2)' : 'scale(1)',
              display: 'inline-block',
              transition: 'transform 0.2s ease'
            }} />
            <span style={{ color: 'var(--text-secondary)', marginRight: 6 }}>RESERVADAS: <strong style={{ color: 'var(--bronze-light)' }}>{totales.reservadas}</strong></span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setModalReservasCentral(true);
              }}
              style={{
                background: 'rgba(255,255,255,0.05)',
                border: '1px solid rgba(227, 168, 105, 0.3)',
                color: 'var(--bronze-light)',
                borderRadius: 4,
                padding: '1px 5px',
                fontSize: 8,
                fontWeight: 800,
                cursor: 'pointer',
                transition: 'all 0.15s',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
              onMouseEnter={e => {
                e.currentTarget.style.background = 'var(--bronze-light)';
                e.currentTarget.style.color = '#000';
              }}
              onMouseLeave={e => {
                e.currentTarget.style.background = 'rgba(255,255,255,0.05)';
                e.currentTarget.style.color = 'var(--bronze-light)';
              }}
              title="Administrar Reservas"
            >
              GESTIONAR
            </button>
          </div>

          {/* Mantenimiento */}
          <button
            onClick={() => setFiltro('manten')}
            className={filtro === 'manten' ? 'filter-active-pill' : ''}
            title="Ver Mesas en Mantenimiento [Alt + Shift + M]"
            style={{
              padding: '6px 12px',
              fontSize: 10,
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              height: 28,
              border: 'none',
              background: filtro === 'manten' ? 'rgba(239, 68, 68, 0.15)' : 'rgba(239, 68, 68, 0.02)',
              color: '#ef4444',
              cursor: 'pointer',
              transition: 'all 0.15s',
              whiteSpace: 'nowrap',
              boxShadow: filtro === 'manten' ? 'inset 0 -3px 0 #ef4444, 0 0 8px rgba(239, 68, 68, 0.2)' : 'none'
            }}
            onMouseEnter={e => {
              if (filtro !== 'manten') e.currentTarget.style.background = 'rgba(239, 68, 68, 0.08)';
            }}
            onMouseLeave={e => {
              if (filtro !== 'manten') e.currentTarget.style.background = 'rgba(239, 68, 68, 0.02)';
            }}
          >
            <i className="ri-tools-line" style={{ 
              color: '#ef4444', 
              fontSize: 11,
              transform: filtro === 'manten' ? 'scale(1.2)' : 'scale(1)',
              display: 'inline-block',
              transition: 'transform 0.2s ease'
            }} />
            <span style={{ color: 'var(--text-secondary)' }}>MANTENIMIENTO: <strong style={{ color: '#ef4444' }}>{totales.manten}</strong></span>
          </button>
        </div>

        {/* Acomodo / Ordenar */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          background: 'var(--bg-elevated)',
          border: '1px solid var(--border-bronze)',
          borderRadius: 8,
          padding: '0 10px',
          height: 28,
          boxShadow: 'var(--shadow-sm)'
        }}>
          <i className="ri-sort-asc" style={{ color: 'var(--bronze-light)', fontSize: 13 }} />
          <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Acomodo:</span>
          <select
            value={ordenamiento}
            onChange={e => setOrdenamiento(e.target.value)}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--bronze-light)',
              fontSize: 10,
              fontWeight: 700,
              outline: 'none',
              cursor: 'pointer',
              padding: '0 4px',
              fontFamily: 'var(--font-main)'
            }}
          >
            <option value="numero" style={{ background: '#141418', color: '#f0f0f4' }}>🔢 Núm. Mesa</option>
            <option value="carambola_primero" style={{ background: '#141418', color: '#f0f0f4' }}>🏆 Carambola primero</option>
            <option value="pool_primero" style={{ background: '#141418', color: '#f0f0f4' }}>🎱 Pool primero</option>
            <option value="snooker_primero" style={{ background: '#141418', color: '#f0f0f4' }}>🟢 Snooker primero</option>
          </select>
        </div>

        {/* Separador vertical */}
        <div style={{ width: 1, height: 18, background: 'var(--border-bronze)', opacity: 0.3, margin: '0 4px' }} />

        {/* Botones de Acción */}
        <div 
          style={{ position: 'relative', display: 'inline-block' }}
          onMouseEnter={() => setShowCuentasPopover(true)}
          onMouseLeave={() => setShowCuentasPopover(false)}
        >
          <button
            className={`btn btn-secondary btn-sm ${shakeCuentasButton ? 'shake-animation' : ''}`}
            onClick={() => setModalCuentasSolicitadas(true)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              color: infoCuentasSolicitadas.total > 0 ? (infoCuentasSolicitadas.tieneDirectas ? '#f59e0b' : '#ef4444') : 'var(--bronze-light)',
              borderColor: infoCuentasSolicitadas.total > 0 ? (infoCuentasSolicitadas.tieneDirectas ? 'rgba(245, 158, 11, 0.5)' : 'rgba(239, 68, 68, 0.5)') : 'var(--border-bronze)',
              boxShadow: infoCuentasSolicitadas.total > 0 ? (infoCuentasSolicitadas.tieneDirectas ? '0 0 10px rgba(245, 158, 11, 0.25)' : '0 0 8px rgba(239, 68, 68, 0.2)') : 'none',
              animation: infoCuentasSolicitadas.total > 0
                ? (infoCuentasSolicitadas.tieneDirectas
                    ? `pulseAlertSolicitadaDirecta ${infoCuentasSolicitadas.antiguedadMaxMs > 5 * 60 * 1000 ? '0.8s' : (infoCuentasSolicitadas.antiguedadMaxMs > 2 * 60 * 1000 ? '1.2s' : '1.8s')} infinite ease-in-out`
                    : `pulseAlertSolicitada ${infoCuentasSolicitadas.antiguedadMaxMs > 5 * 60 * 1000 ? '0.8s' : (infoCuentasSolicitadas.antiguedadMaxMs > 2 * 60 * 1000 ? '1.2s' : '1.8s')} infinite ease-in-out`)
                : 'none',
              transition: 'all 0.2s ease',
              height: '100%'
            }}
            title={infoCuentasSolicitadas.total > 0 ? `Tienes ${infoCuentasSolicitadas.total} cuentas pendientes` : "Sin cobros pendientes"}
          >
            <i className="ri-wallet-3-line" style={{ animation: infoCuentasSolicitadas.total > 0 ? 'pulse 1.2s infinite' : 'none' }} />
            <span>Cuentas Solicitadas</span>
            {infoCuentasSolicitadas.total > 0 && (
              <span className="badge" style={{
                background: infoCuentasSolicitadas.tieneDirectas ? '#f59e0b' : '#ef4444',
                color: '#fff',
                marginLeft: 4,
                padding: '2px 6px',
                fontSize: 9,
                borderRadius: '50%',
                fontWeight: 'bold',
                boxShadow: '0 0 5px rgba(255,255,255,0.2)'
              }}>
                {infoCuentasSolicitadas.total}
              </span>
            )}
          </button>

          {showCuentasPopover && (
            <div style={{
              position: 'absolute',
              top: 'calc(100% + 6px)',
              left: 0,
              width: 260,
              background: 'rgba(20, 20, 24, 0.96)',
              backdropFilter: 'blur(8px)',
              border: '1px solid var(--border-bronze)',
              borderRadius: 8,
              boxShadow: '0 10px 25px rgba(0, 0, 0, 0.5)',
              zIndex: 99999,
              padding: '10px 12px',
              color: '#fff',
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              pointerEvents: 'auto'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: 6 }}>
                <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--bronze-light)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                  Resumen de Cuentas
                </span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  {infoCuentasSolicitadas.total > 0 && infoCuentasSolicitadas.antiguedadMaxMs >= 3 * 60 * 1000 && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        const silenciadoVal = Date.now() < silenciadoCuentasHasta;
                        const targetTime = silenciadoVal ? 0 : Date.now() + 15 * 60 * 1000;
                        setSilenciadoCuentasHasta(targetTime);
                        if (!silenciadoVal) {
                          try {
                            const count = Number(localStorage.getItem('yoy_silence_count') || '0') + 1;
                            localStorage.setItem('yoy_silence_count', String(count));
                            registrarEvento('Silencio Cuentas', `Cajero silenció recordatorio de cobros por 15 minutos (Total silencios local: ${count})`);
                          } catch (err) {
                            console.error(err);
                          }
                        }
                        showToast(silenciadoVal ? "Sonido reactivado 🔔" : "Recordatorio silenciado por 15 min 🔕", "info");
                      }}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: Date.now() < silenciadoCuentasHasta ? '#ef4444' : 'var(--text-muted)',
                        cursor: 'pointer',
                        fontSize: 12,
                        padding: '0 4px',
                        display: 'flex',
                        alignItems: 'center',
                        transition: 'color 0.2s'
                      }}
                      title={Date.now() < silenciadoCuentasHasta ? "Haga clic para reactivar sonido" : "Silenciar sonido por 15 minutos"}
                    >
                      <i className={Date.now() < silenciadoCuentasHasta ? "ri-volume-mute-fill" : "ri-volume-up-line"} />
                    </button>
                  )}
                  <span style={{ fontSize: 9, background: 'rgba(255,255,255,0.06)', padding: '2px 6px', borderRadius: 4, color: 'var(--text-muted)' }}>
                    {infoCuentasSolicitadas.total} pendientes
                  </span>
                </div>
              </div>

              <div style={{ maxHeight: 150, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
                {(() => {
                  if (!alertasMesas) return null;
                  const pendientes = Object.values(alertasMesas)
                    .flat()
                    .filter(a => a && a.tipo === 'cuenta' && !a.atendidoAdmin);

                  if (pendientes.length === 0) {
                    return (
                      <div style={{ textAlign: 'center', padding: '12px 0', color: 'var(--text-muted)', fontSize: 10 }}>
                        ✓ Sin cobros pendientes
                      </div>
                    );
                  }

                  pendientes.sort((a, b) => {
                    const tA = a.createdAt?.seconds || 0;
                    const tB = b.createdAt?.seconds || 0;
                    return tB - tA;
                  });

                  return pendientes.slice(0, 5).map(p => {
                    const tieneMesa = p.mesaId && p.mesaId !== 0 && p.mesaId !== '0';
                    return (
                      <div 
                        key={p.id} 
                        style={{ 
                          display: 'flex', 
                          justifyContent: 'space-between', 
                          alignItems: 'center', 
                          padding: '6px 8px', 
                          background: 'rgba(255,255,255,0.02)', 
                          border: '1px solid rgba(255,255,255,0.03)', 
                          borderRadius: 6
                        }}
                      >
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                          <span style={{ fontSize: 10, fontWeight: 700, color: tieneMesa ? 'var(--bronze-light)' : 'var(--text-muted)' }}>
                            {tieneMesa ? `Mesa ${p.mesaId}` : 'Sin Mesa'}
                          </span>
                          <span style={{ fontSize: 9, color: 'var(--text-muted)', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {p.cliente || 'Cliente'}
                          </span>
                        </div>
                        <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-main)' }}>
                          ${(p.totalAcumulado || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </span>
                      </div>
                    );
                  });
                })()}
              </div>
              
              <div style={{ 
                fontSize: 9, 
                color: 'var(--bronze-light)', 
                textAlign: 'center', 
                paddingTop: 4, 
                borderTop: '1px solid rgba(255,255,255,0.05)',
                fontWeight: 600
              }}>
                Pasa al modal para ver todas o cobrar
              </div>
            </div>
          )}
        </div>

        <button className="btn btn-secondary btn-sm" onClick={toggleFullscreen} title="Activar Modo Kiosco">
          <i className={isFullscreen ? 'ri-fullscreen-exit-fill' : 'ri-fullscreen-fill'} style={{ marginRight: 4 }} />
          {isFullscreen ? 'Salir' : 'Kiosco'}
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

        <button className="btn btn-secondary btn-sm" onClick={() => setModalComanda(true)}>
          <i className="ri-cup-line" /> Comanda
        </button>

        <button className="btn btn-secondary btn-sm" onClick={() => setModalAbrirCuenta(true)}>
          <i className="ri-folder-add-line" /> Abrir Cuenta
        </button>

        <button className="btn btn-danger btn-sm" onClick={() => setModalGasto(true)}>
          <i className="ri-wallet-3-line" style={{ marginRight: 4 }} /> Gasto
        </button>





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
          const alertsForMesa = mesa.estado === 'ocupada' ? (alertasMesas[mesa.id] || []) : [];
          const hasAlert = alertsForMesa.length > 0;

          const isPorCobrar = mesa.estado === 'ocupada' && mesa.preTicketImpreso;
          const badgeStyle = isPorCobrar 
            ? { background: 'rgba(245, 158, 11, 0.1)', color: '#f59e0b', border: '1px solid rgba(245, 158, 11, 0.2)' }
            : {};
          const badgeText = isPorCobrar ? '⏳ Por Cobrar' : cfg.label;
          const badgeDotColor = isPorCobrar ? '#f59e0b' : cfg.color;

          let cometDuration = '4s';
          if (mesa.estado === 'ocupada') {
            if (totalMesa > 600 || elapsed > 3 * 3600 * 1000) {
              cometDuration = '1.8s'; // Muy rápido (Alto consumo o mucho tiempo)
            } else if (totalMesa > 300 || elapsed > 1.5 * 3600 * 1000) {
              cometDuration = '2.8s'; // Moderadamente rápido
            }
          }

          const baseStyle = {
            '--comet-duration': cometDuration
          };

          const mesaNombreStr = mesa.nombre || `Mesa ${mesa.id}`;
          const isAssignedToQueue = mesa.estado === 'libre' && assignedFila.some(f => f.mesaAsignada && f.mesaAsignada.toLowerCase() === mesaNombreStr.toLowerCase());

          const dynamicStyle = hasAlert ? {
            boxShadow: '0 0 12px rgba(245, 158, 11, 0.25)',
            border: '1.5px solid rgba(245, 158, 11, 0.5)'
          } : isPorCobrar ? {
            border: '1.5px dashed #f59e0b',
            boxShadow: '0 0 12px rgba(245, 158, 11, 0.15)',
          } : isAssignedToQueue ? {
            border: '1px solid rgba(197, 168, 128, 0.5)',
            boxShadow: '0 0 10px rgba(197, 168, 128, 0.25)',
            background: 'rgba(197, 168, 128, 0.03)',
            animation: 'pulseBorderGold 3s infinite ease-in-out'
          } : {};

          const mergedStyle = { ...baseStyle, ...dynamicStyle };

          return (
            <div
              key={mesa.id}
              className={`mesa-card ${mesa.estado} ${isPorCobrar ? 'por-cobrar' : ''} ${hasAlert ? 'has-alert' : ''} ${!animacionesActivas ? 'sin-animaciones' : ''}`}
              onClick={() => abrirMesa(mesa)}
              style={mergedStyle}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div className="mesa-number" style={{ lineHeight: 1.1, marginBottom: 0 }}>{mesa.id}</div>
                    {getGameIcon(mesa.tipo, 24)}
                  </div>
                  {mesa.nombre && mesa.nombre.trim().toLowerCase() !== `mesa ${mesa.id}`.toLowerCase() && mesa.nombre.trim().toLowerCase() !== `mesa${mesa.id}`.toLowerCase() && (
                    <div style={{ fontSize: 11, fontWeight: 500, color: 'var(--bronze-light)', marginTop: 2, maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={mesa.nombre}>
                      {mesa.nombre}
                    </div>
                  )}
                </div>
                <span 
                  className={`mesa-status-badge ${mesa.estado}`}
                  style={badgeStyle}
                >
                  <span 
                    className={mesa.estado === 'ocupada' && !isPorCobrar ? 'dot-live' : ''} 
                    style={{ width: 6, height: 6, borderRadius: '50%', background: badgeDotColor, flexShrink: 0 }} 
                  />
                  {badgeText}
                </span>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6, minHeight: 18 }}>
                <span>{mesa.tipo}</span>
                <span style={{ fontWeight: '600', color: 'var(--bronze-light)' }}>${mesa.tarifa}/h</span>
              </div>


                {mesa.estado === 'libre' && (
                  (() => {
                    const mNombreStr = mesa.nombre || `Mesa ${mesa.id}`;
                    const assignment = assignedFila.find(f => f.mesaAsignada && f.mesaAsignada.toLowerCase() === mNombreStr.toLowerCase());
                    if (assignment) {
                      const timeRemaining = Math.max(0, 5 * 60 - Math.floor((Date.now() - (assignment.assignedAt || Date.now())) / 1000));
                      const minutes = Math.floor(timeRemaining / 60);
                      const seconds = timeRemaining % 60;
                      const timeStr = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
                      return (
                        <div style={{ marginTop: 4, display: 'flex', flexDirection: 'column', gap: 4, background: 'rgba(197, 168, 128, 0.08)', border: '1px solid rgba(197, 168, 128, 0.2)', borderRadius: 8, padding: '6px 8px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 700, color: 'var(--bronze-light)' }}>
                            <i className="ri-alarm-warning-line animate-pulse" />
                            <span>Fila: {assignment.cliente}</span>
                          </div>
                          <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.6)' }}>
                            Expiración: <strong style={{ color: '#ef4444' }}>{timeStr}</strong>
                          </div>
                        </div>
                      );
                    }
                    return null;
                  })()
                )}

                {mesa.estado === 'ocupada' && (
                  <>
                    <div className="mesa-timer">{formatTime(elapsed)}</div>
                    <div className="mesa-client">
                      <i className="ri-user-line" style={{ fontSize: 10, marginRight: 4 }} />
                      {mesa.cliente}
                      {mesa.socios && <span className="badge badge-bronze" style={{ marginLeft: 6, fontSize: 8 }}>Socio</span>}
                    </div>
                    <div className="mesa-rate" style={{ marginTop: 4, fontSize: 13, fontWeight: 700, color: 'var(--bronze-light)' }}>
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
                  <div className="mesa-client" style={{ marginTop: 4, display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <div style={{ display: 'flex', alignItems: 'center' }}>
                      <i className="ri-bookmark-line" style={{ fontSize: 10, marginRight: 4 }} />
                      {mesa.cliente}
                    </div>
                    {mesa.telefono && (
                      <div style={{ fontSize: 10, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 4 }}>
                        <i className="ri-phone-line" style={{ fontSize: 10 }} />
                        {mesa.telefono}
                      </div>
                    )}
                  </div>
                )}

                {mesa.estado === 'manten' && (
                  <div 
                    style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4, display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}
                    title={mesa.motivo ? `Detalle: ${mesa.motivo}` : 'En mantenimiento'}
                  >
                    <i className="ri-tools-line" />
                    <span style={{ textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap', maxWidth: '80%' }}>
                      En reparación {mesa.motivo ? `(${mesa.motivo})` : ''}
                    </span>
                    {mesa.historialManten && mesa.historialManten.length > 0 && (
                      <button 
                        onClick={(e) => { e.stopPropagation(); setModalHistorial(mesa); }} 
                        style={{ background: 'none', border: 'none', color: 'var(--bronze-light)', fontSize: 9, cursor: 'pointer', display: 'inline-flex', padding: 0 }}
                        title="Ver historial de incidencias"
                      >
                        [Historial]
                      </button>
                    )}
                  </div>
                )}

                {mesa.estado === 'fuera' && (
                  <div 
                    style={{ fontSize: 11, color: '#f87171', marginTop: 4, display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}
                    title={mesa.motivo ? `Detalle: ${mesa.motivo}` : 'Fuera de servicio'}
                  >
                    <i className="ri-close-circle-line" />
                    <span style={{ textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap', maxWidth: '80%' }}>
                      Fuera de servicio {mesa.motivo ? `(${mesa.motivo})` : ''}
                    </span>
                    {mesa.historialManten && mesa.historialManten.length > 0 && (
                      <button 
                        onClick={(e) => { e.stopPropagation(); setModalHistorial(mesa); }} 
                        style={{ background: 'none', border: 'none', color: 'var(--bronze-light)', fontSize: 9, cursor: 'pointer', display: 'inline-flex', padding: 0 }}
                        title="Ver historial de incidencias"
                      >
                        [Historial]
                      </button>
                    )}
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
                    background: 'transparent',
                    border: 'none',
                    borderRadius: 0,
                    padding: 0,
                    animation: 'fadeIn 0.2s ease-in-out'
                  }} onClick={e => e.stopPropagation()}>
                    {alertsForMesa.map(alerta => {
                      let icon = '🔔';
                      let label = alerta.etiqueta || 'Asistencia';
                      let badgeColor = 'var(--warning)';
                      let alertBg = 'rgba(245, 158, 11, 0.08)';
                      let alertBorder = 'rgba(245, 158, 11, 0.25)';
                      let textColor = '#f59e0b';
                      
                      if (alerta.tipo === 'cuenta') {
                        icon = '💳';
                        label = `Pedir Cuenta: $${alerta.totalAcumulado || ''}`;
                        badgeColor = 'var(--success)';
                        alertBg = 'rgba(34, 197, 94, 0.1)';
                        alertBorder = 'rgba(34, 197, 94, 0.3)';
                        textColor = '#4ade80';
                      } else if (alerta.tipo === 'asistencia') {
                        icon = alerta.icono || '🙋';
                        badgeColor = 'var(--danger)';
                        alertBg = 'rgba(239, 68, 68, 0.1)';
                        alertBorder = 'rgba(239, 68, 68, 0.3)';
                        textColor = '#f87171';
                      } else if (alerta.tipo === 'pedido') {
                        icon = '🥤';
                        label = `Pedido (${alerta.items?.reduce((s,i)=>s+i.cantidad,0) || 0} pz)`;
                        badgeColor = 'var(--info)';
                        alertBg = 'rgba(59, 130, 246, 0.1)';
                        alertBorder = 'rgba(59, 130, 246, 0.3)';
                        textColor = '#60a5fa';
                      }

                      return (
                        <div key={alerta.id} style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          fontSize: 11,
                          color: textColor,
                          fontWeight: 600,
                          gap: 6,
                          background: alertBg,
                          border: `1px solid ${alertBorder}`,
                          borderRadius: 8,
                          padding: '6px 8px',
                          width: '100%',
                          boxShadow: '0 2px 4px rgba(0,0,0,0.15)'
                        }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            <span style={{ fontSize: 13, animation: alerta.tipo !== 'pedido' ? 'pulse 1.2s infinite' : 'none' }}>{icon}</span>
                            <span>{label}</span>
                          </div>
                          {alerta.tipo === 'pedido' ? (
                            <button
                              onClick={(e) => { e.stopPropagation(); cargarPedidoACuenta(mesa.id, alerta); }}
                              title="Cargar a la cuenta de la mesa y descontar inventario"
                              style={{
                                background: 'rgba(59,130,246,0.15)',
                                border: '1px solid rgba(59,130,246,0.35)',
                                color: '#60a5fa',
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
                              onClick={(e) => marcarAlertaAtendida(alerta.id, alerta.tipo, e)}
                              title="Marcar como atendido"
                              style={{
                                background: 'rgba(34,197,94,0.12)',
                                border: '1px solid rgba(34,197,94,0.3)',
                                color: '#4ade80',
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

                {/* Selector de Mesero Asignado */}
                {mesa.estado !== 'manten' && mesa.estado !== 'fuera' && (
                  <div 
                    style={{ 
                      marginTop: 8, 
                      marginBottom: 8,
                      display: 'flex', 
                      flexDirection: 'column',
                      gap: 4, 
                      width: '100%', 
                      background: 'rgba(255, 255, 255, 0.03)', 
                      border: '1px solid rgba(255, 255, 255, 0.05)', 
                      borderRadius: 8, 
                      padding: '6px 8px',
                      boxSizing: 'border-box',
                      position: 'relative'
                    }}
                    onClick={e => e.stopPropagation()}
                  >
                    <div 
                      style={{ 
                        display: 'flex', 
                        alignItems: 'center', 
                        justifyContent: 'space-between', 
                        cursor: 'pointer',
                        width: '100%'
                      }} 
                      onClick={() => setDropdownOpenMesa(dropdownOpenMesa === mesa.id ? null : mesa.id)}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', width: '90%' }}>
                        <i className="ri-user-star-line" style={{ fontSize: 12, color: 'var(--bronze-light)' }} />
                        <span style={{ fontSize: 11, fontWeight: 600, color: (mesa.meseroIds && mesa.meseroIds.length > 0) || mesa.meseroId ? '#fff' : 'var(--text-muted)' }}>
                          {(mesa.meseroIds && mesa.meseroIds.length > 0) 
                            ? mesa.meseroNombres.join(', ') 
                            : (mesa.meseroNombre || '— Sin Mesero —')}
                        </span>
                      </div>
                      <i className={dropdownOpenMesa === mesa.id ? "ri-arrow-up-s-line" : "ri-arrow-down-s-line"} style={{ fontSize: 12, color: 'var(--text-muted)' }} />
                    </div>

                    {dropdownOpenMesa === mesa.id && (
                      <div style={{
                        position: 'absolute',
                        bottom: '100%',
                        left: 0,
                        right: 0,
                        background: 'var(--bg-card)',
                        border: '1px solid var(--border-bronze)',
                        borderRadius: 8,
                        boxShadow: '0 8px 16px rgba(0,0,0,0.6)',
                        zIndex: 100,
                        maxHeight: 150,
                        overflowY: 'auto',
                        padding: 6,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 4
                      }}>
                        {meserosPresentes.map(m => {
                          const isAssigned = (mesa.meseroIds || []).includes(m.id) || mesa.meseroId === m.id;
                          return (
                            <label 
                              key={m.id} 
                              style={{ 
                                display: 'flex', 
                                alignItems: 'center', 
                                gap: 6, 
                                fontSize: 11, 
                                color: '#fff', 
                                cursor: 'pointer', 
                                padding: '4px 6px', 
                                borderRadius: 4, 
                                background: isAssigned ? 'rgba(197, 168, 128, 0.15)' : 'transparent',
                                margin: 0
                              }}
                            >
                              <input 
                                type="checkbox" 
                                checked={isAssigned} 
                                onChange={() => handleToggleMeseroMesa(mesa.id, m.id, m.nombre)}
                                style={{ accentColor: 'var(--bronze-light)', cursor: 'pointer' }}
                                onClick={e => e.stopPropagation()}
                              />
                              {m.nombre}
                            </label>
                          );
                        })}
                        {meserosPresentes.length === 0 && (
                          <span style={{ fontSize: 10, color: 'var(--text-muted)', textAlign: 'center', padding: '6px 0' }}>No hay meseros activos</span>
                        )}
                      </div>
                    )}
                  </div>
                )}

              <div className="mesa-actions" onClick={e => e.stopPropagation()}>
                {mesa.estado === 'libre' && (
                  <div style={{ display: 'flex', gap: 6, width: '100%' }}>
                    <button className="btn btn-success btn-sm btn-pulse-success" style={{ flex: 1 }} onClick={() => abrirMesa(mesa)}>
                      <i className="ri-play-fill" /> Abrir
                    </button>
                    <button 
                      className="btn btn-secondary btn-sm btn-icon" 
                      title="Avisar Cliente (Mesa Disponible)" 
                      onClick={() => setModalAvisar(mesa)}
                      style={{ color: 'var(--bronze-light)' }}
                    >
                      <i className="ri-notification-3-line" />
                    </button>
                  </div>
                )}
                {mesa.estado === 'ocupada' && (
                  <>
                    <button 
                      className="btn btn-sm btn-pulse-white" 
                      style={{ flex: 2, background: '#ffffff', color: '#0d0d0f', fontWeight: 600, boxShadow: '0 0 15px rgba(255, 255, 255, 0.3)' }} 
                      onClick={() => setModalCerrar(mesa)}
                    >
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
                  <button 
                    className="btn btn-primary btn-sm btn-pulse-bronze" 
                    style={{ flex: 1 }} 
                    onClick={() => abrirMesa(mesa)}
                  >
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

              {/* Barra inteligente de cambio de estado rápido */}
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginTop: 8,
                paddingTop: 6,
                borderTop: '1px solid rgba(255,255,255,0.05)',
                gap: 4
              }} onClick={e => e.stopPropagation()}>
                <span style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>Estado:</span>
                <div style={{ display: 'flex', gap: 4 }}>
                  {[
                    { estado: 'libre', icon: 'ri-checkbox-blank-circle-line', color: '#22c55e', title: 'Disponible' },
                    { estado: 'reservada', icon: 'ri-bookmark-fill', color: 'var(--bronze-light)', title: 'Reservar' },
                    { estado: 'manten', icon: 'ri-tools-line', color: '#ef4444', title: 'Mantenimiento' },
                    { estado: 'fuera', icon: 'ri-close-circle-line', color: '#ef4444', title: 'Fuera de Servicio' }
                  ].map(item => {
                    const isActive = mesa.estado === item.estado;
                    const isDisabled = mesa.estado === 'ocupada';
                    return (
                      <button
                        key={item.estado}
                        onClick={(e) => { e.stopPropagation(); cambiarEstadoRapido(mesa, item.estado); }}
                        disabled={isDisabled || isActive}
                        title={isActive ? `Mesa ya está en estado ${item.title}` : isDisabled ? 'No se puede cambiar estado de mesa ocupada' : `Cambiar a ${item.title}`}
                        style={{
                          background: isActive ? `${item.color}20` : 'rgba(255,255,255,0.03)',
                          border: isActive ? `1px solid ${item.color}` : '1px solid rgba(255,255,255,0.05)',
                          color: isActive ? item.color : 'var(--text-muted)',
                          borderRadius: 6,
                          width: 24,
                          height: 24,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          cursor: isDisabled || isActive ? 'not-allowed' : 'pointer',
                          opacity: isDisabled ? 0.3 : 1,
                          transition: 'all 0.15s'
                        }}
                        onMouseEnter={e => {
                          if (!isDisabled && !isActive) {
                            e.currentTarget.style.color = '#fff';
                            e.currentTarget.style.background = 'rgba(255,255,255,0.1)';
                            e.currentTarget.style.borderColor = 'rgba(255,255,255,0.2)';
                          }
                        }}
                        onMouseLeave={e => {
                          if (!isDisabled && !isActive) {
                            e.currentTarget.style.color = 'var(--text-muted)';
                            e.currentTarget.style.background = 'rgba(255,255,255,0.03)';
                            e.currentTarget.style.borderColor = 'rgba(255,255,255,0.05)';
                          }
                        }}
                      >
                        <i className={item.icon} style={{ fontSize: 12 }} />
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Modales */}
      
      {/* ── MODAL CAMBIO DE ESTADO ────────────────────────── */}
      {modalStatusCambio && (
        <ModalStatusCambio
          mesa={modalStatusCambio.mesa}
          nuevoEstado={modalStatusCambio.nuevoEstado}
          onClose={() => setModalStatusCambio(null)}
          onConfirm={confirmarStatusCambio}
        />
      )}

      {/* ── MODAL HISTORIAL MANTENIMIENTO ─────────────────── */}
      {modalHistorial && (
        <ModalHistorial
          mesa={modalHistorial}
          onClose={() => setModalHistorial(null)}
        />
      )}

      {/* ── MODAL RESERVAS CENTRAL ────────────────────────── */}
      {modalReservasCentral && (
        <ModalReservasCentral
          mesas={mesas}
          setMesas={setMesas}
          onClose={() => setModalReservasCentral(false)}
          registrarEvento={registrarEvento}
          showToast={showToast}
          abrirMesa={abrirMesa}
          imprimirComprobanteReserva={imprimirComprobanteReserva}
          enviarAlertaMesero={enviarAlertaMesero}
        />
      )}

      {/* ── MODAL REGISTRO DE GASTO ────────────────────────── */}
      {modalGasto && (
        <ModalGasto
          onClose={() => setModalGasto(false)}
          onConfirm={confirmarRegistroGasto}
          CATEGORIAS_GASTO={CATEGORIAS_GASTO}
        />
      )}

      {/* ── MODAL AVISAR CLIENTE ─────────────────────────── */}
      {modalAvisar && (
        <ModalAvisarCliente
          mesa={modalAvisar}
          fila={fila}
          onClose={() => setModalAvisar(null)}
          registrarEvento={registrarEvento}
          showToast={showToast}
          enviarAlertaMesero={enviarAlertaMesero}
        />
      )}

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
                  value={`https://yoy-ia-billar.vercel.app/mesa/${modalQR.id}?s=${getEncodedSalonId()}`}
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
                <div style={{ fontSize: 12, color: 'var(--text-muted)', wordBreak: 'break-all' }}>yoy-ia-billar.vercel.app/mesa/{modalQR.id}?s={getEncodedSalonId()}</div>
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
                    <p style="font-size:11px;color:#aaa;margin-top:8px">yoy-ia-billar.vercel.app/mesa/${modalQR.id}?s=${getEncodedSalonId()}</p>
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
        <ModalErrorBoundary name="Abrir Mesa" onClose={() => setModalAbrir(null)}>
          <ModalAbrirMesa
            mesa={modalAbrir}
            adminPinHash={adminPinHash}
            hashPassword={hashPassword}
            onClose={() => setModalAbrir(null)}
            onConfirm={(data) => confirmarAbrirMesa(modalAbrir.id, data)}
          />
        </ModalErrorBoundary>
      )}
      {modalCerrar && (
        <ModalErrorBoundary name="Cerrar Mesa" onClose={() => setModalCerrar(null)}>
          <ModalCerrarMesa
            mesa={mesas.find(m => m.id === modalCerrar.id) || modalCerrar}
            cuentasActivas={cuentasActivas}
            clientesRegistrados={clientesRegistrados}
            registrarNuevoClienteDirectorio={registrarNuevoClienteDirectorio}
            mesas={mesas}
            unloadedConsumos={unloadedConsumos}
            onClose={() => setModalCerrar(null)}
            onCerrar={(data) => confirmarCerrarMesa(modalCerrar.id, data)}
            onAgregarACuenta={agregarSesionACuenta}
            imprimirPreTicket={imprimirPreTicket}
            onImprimirPreTicket={() => registrarPreTicketMesa(modalCerrar.id)}
            procesandoCierre={procesandoCierre}
          />
        </ModalErrorBoundary>
      )}
      {modalNuevaMesa && (
        <ModalErrorBoundary name="Nueva Mesa" onClose={() => setModalNuevaMesa(false)}>
          <ModalNuevaMesa
            mesas={mesas}
            onClose={() => setModalNuevaMesa(false)}
            onConfirm={registrarNuevaMesa}
          />
        </ModalErrorBoundary>
      )}
      {modalFila && (
        <ModalErrorBoundary name="Fila Virtual" onClose={() => setModalFila(false)}>
          <ModalFilaVirtual
            fila={fila}
            setFila={setFila}
            mesas={mesas}
            onAssign={asignarClienteDeFila}
            onClose={() => setModalFila(false)}
            showToast={showToast}
            imprimirComprobanteEspera={imprimirComprobanteEspera}
            imprimirQRRegistroVirtual={imprimirQRRegistroVirtual}
          />
        </ModalErrorBoundary>
      )}
      {modalCuentasSolicitadas && (
        <ModalErrorBoundary name="Cuentas Solicitadas" onClose={() => setModalCuentasSolicitadas(false)}>
          <ModalCuentasSolicitadas
            onClose={() => setModalCuentasSolicitadas(false)}
            showToast={showToast}
            setMostrarCobroManual={setMostrarCobroManual}
            setNuevoMonto={setNuevoMonto}
            setNuevaDesc={setNuevaDesc}
            setAlertaCobroAsociadaId={setAlertaCobroAsociadaId}
            actualizarCuentasFirestore={actualizarCuentasFirestore}
            setMesas={setMesas}
            registrarEvento={registrarEvento}
            setAlertaClienteAsoc={setAlertaClienteAsoc}
            setAlertaMesaIdAsoc={setAlertaMesaIdAsoc}
          />
        </ModalErrorBoundary>
      )}
      {modalCuentas && (
        <ModalErrorBoundary name="Cuentas Activas" onClose={() => setModalCuentas(false)}>
          <ModalCuentasActivas
            cuentas={cuentasActivas}
            setCuentas={actualizarCuentasFirestore}
            mesas={mesas}
            setMesas={setMesas}
            imprimirPreTicket={imprimirPreTicket}
            confirmarCerrarMesa={confirmarCerrarMesa}
            adminPinHash={adminPinHash}
            hashPassword={hashPassword}
            onClose={() => setModalCuentas(false)}
            showToast={showToast}
            registrarEvento={registrarEvento}
            meserosPresentes={meserosPresentes}
            procesandoCierre={procesandoCierre}
            setCobroExito={setCobroExito}
            user={user}
            imprimirTicketFinal={imprimirTicketFinal}
          />
        </ModalErrorBoundary>
      )}
      {cobroExito && (
        <ModalErrorBoundary name="Cobro Exitoso" onClose={() => setCobroExito(null)}>
          <ModalCobroExito
            data={cobroExito}
            onClose={() => setCobroExito(null)}
            imprimirTicketFinal={imprimirTicketFinal}
          />
        </ModalErrorBoundary>
      )}
      {modalAbrirCuenta && (
        <ModalErrorBoundary name="Abrir Cuenta Directa" onClose={() => setModalAbrirCuenta(false)}>
          <ModalAbrirCuentaDirecta
            cuentas={cuentasActivas}
            setCuentas={actualizarCuentasFirestore}
            clientesRegistrados={clientesRegistrados}
            registrarNuevoClienteDirectorio={registrarNuevoClienteDirectorio}
            onClose={() => setModalAbrirCuenta(false)}
            showToast={showToast}
            registrarEvento={registrarEvento}
            meserosPresentes={meserosPresentes}
          />
        </ModalErrorBoundary>
      )}
      {modalCambiarMesa && (
        <ModalErrorBoundary name="Cambiar Mesa" onClose={() => setModalCambiarMesa(null)}>
          <ModalCambiarMesa
            mesa={modalCambiarMesa}
            mesas={mesas}
            onClose={() => setModalCambiarMesa(null)}
            onConfirm={confirmarCambioMesa}
          />
        </ModalErrorBoundary>
      )}
      {modalVincular && (
        <ModalErrorBoundary name="Vincular Cliente" onClose={() => setModalVincular(null)}>
          <ModalVincularCliente
            mesa={modalVincular}
            onClose={() => setModalVincular(null)}
            onConfirm={(nombre) => confirmarVincularCliente(modalVincular.id, nombre)}
          />
        </ModalErrorBoundary>
      )}
      {modalBitacora && (
        <ModalErrorBoundary name="Bitácora" onClose={() => { setModalBitacora(false); setLimiteBitacora(50); }}>
          <ModalBitacora
            bitacora={bitacora}
            onClear={limpiarBitacora}
            onClose={() => {
              setModalBitacora(false);
              setLimiteBitacora(50);
            }}
            onLoadMore={() => setLimiteBitacora(prev => prev + 50)}
            hasMore={hasMoreBitacora}
          />
        </ModalErrorBoundary>
      )}
      {modalComanda && (
        <ModalErrorBoundary name="Registrar Comanda" onClose={() => setModalComanda(false)}>
          <ModalRegistrarComanda
            mesas={mesas}
            setMesas={setMesas}
            cuentasActivas={cuentasActivas}
            actualizarCuentasFirestore={actualizarCuentasFirestore}
            onClose={() => setModalComanda(false)}
            showToast={showToast}
            registrarEvento={registrarEvento}
            meserosPresentes={meserosPresentes}
          />
        </ModalErrorBoundary>
      )}
      {mostrarCobroManual && (
        <ModalErrorBoundary name="Cobro Manual" onClose={() => {
          if (nuevoMonto || nuevaDesc) {
            sessionStorage.setItem('yoy_draft_cobro_manual', JSON.stringify({ nuevoMonto, nuevaDesc }));
          }
          setMostrarCobroManual(false);
          setNuevoMonto('');
          setNuevaDesc('');
          setPinAutorizacion('');
        }}>
          <ModalCobroManual
            nuevoMonto={nuevoMonto}
            setNuevoMonto={setNuevoMonto}
            nuevaDesc={nuevaDesc}
            setNuevaDesc={setNuevaDesc}
            nuevoMetodo={nuevoMetodo}
            setNuevoMetodo={setNuevoMetodo}
            cuentaAsociada={cuentaAsociadaManual}
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
        </ModalErrorBoundary>
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
function ModalFilaVirtual({ fila, setFila, mesas, onAssign, onClose, showToast, imprimirComprobanteEspera, imprimirQRRegistroVirtual }) {
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

  const agregarFila = async () => {
    const cleanCliente = capitalizeName(cliente);
    if (!isRealName(cleanCliente)) {
      showToast('Por favor ingrese un nombre real y no genérico.', 'warning');
      return;
    }

    // Validar duplicados en la fila
    const yaEnFila = fila.some(f => f.cliente.toLowerCase() === cleanCliente.toLowerCase());
    if (yaEnFila) {
      showToast(`El cliente "${cleanCliente}" ya se encuentra en la lista de espera.`, 'warning');
      return;
    }

    // Validar duplicados en mesas activas
    const yaEnMesa = mesas.some(m => m.estado === 'ocupada' && m.cliente && m.cliente.toLowerCase() === cleanCliente.toLowerCase());
    if (yaEnMesa) {
      showToast(`El cliente "${cleanCliente}" ya tiene una mesa asignada y activa.`, 'warning');
      return;
    }

    const entryId = Date.now();
    const nuevo = {
      id: entryId,
      cliente: cleanCliente,
      contacto: contacto || 'N/A',
      tipo,
      personas: parseInt(personas),
      registro: Date.now(),
      estado: 'espera',
      mesaAsignada: ''
    };

    // Registrar en Firestore
    try {
      await setDoc(doc(db, 'fila_espera', String(entryId)), {
        ...nuevo,
        createdAt: serverTimestamp()
      });
    } catch (err) {
      console.error("Error al registrar en fila_espera Firestore:", err);
    }

    setFila(prev => [...prev, nuevo]);
    setCliente('');
    setContacto('');
    showToast(`${cliente} agregado a la lista de espera.`, 'success');

    // No imprimir comprobante automático al añadir manualmente
    // El cliente puede ver su turno escaneando el QR principal del local
  };

  const quitarFila = async (id) => {
    // Retirar de Firestore
    try {
      await updateDoc(doc(db, 'fila_espera', String(id)), {
        estado: 'retirado',
        removedAt: serverTimestamp()
      });
    } catch (err) {
      console.error("Error al retirar de fila_espera en Firestore:", err);
    }

    setFila(prev => prev.filter(f => f.id !== id));
    showToast('Cliente retirado de la lista.', 'info');
  };

  const libres = mesas.filter(m => m.estado === 'libre');

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 880 }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">
            <i className="ri-qr-code-line" style={{ marginRight: 8, color: 'var(--bronze)' }} />
            Fila Virtual / Lista de Espera
          </span>
          <button onClick={onClose} className="btn-icon btn btn-secondary" style={{ background: 'none', border: 'none' }}>
            <i className="ri-close-line" style={{ fontSize: 20 }} />
          </button>
        </div>
        <div className="modal-body" style={{ display: 'grid', gridTemplateColumns: '1.1fr 1fr 1fr', gap: 20 }}>
          {/* Panel Izquierdo: Lista */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <h4 style={{ fontSize: 12, textTransform: 'uppercase', color: 'var(--text-secondary)', letterSpacing: '0.05em' }}>Clientes en Espera ({fila.length})</h4>
            {fila.length === 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px 10px', textAlign: 'center', border: '1px dashed var(--border)', borderRadius: 10, background: 'rgba(255,255,255,0.01)', margin: '10px 0' }}>
                <i className="ri-group-line" style={{ fontSize: 32, color: 'var(--text-muted)', marginBottom: 10 }} />
                <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-secondary)' }}>Fila Virtual Vacía</span>
                <p style={{ color: 'var(--text-muted)', fontSize: 11, margin: '4px 0 12px 0', maxWidth: 220, lineHeight: 1.4 }}>
                  No hay ningún cliente esperando mesa en este momento.
                </p>
                <button 
                  className="btn btn-secondary btn-xs" 
                  onClick={() => {
                    const inp = document.getElementById('waitlist-client-input');
                    if (inp) inp.focus();
                  }}
                  style={{ display: 'flex', alignItems: 'center', gap: 4 }}
                >
                  <i className="ri-user-add-line" /> Registrar Cliente
                </button>
              </div>
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

          {/* Panel Central: Formulario */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, borderLeft: '1px solid var(--border)', paddingLeft: 20 }}>
            <h4 style={{ fontSize: 12, textTransform: 'uppercase', color: 'var(--text-secondary)', letterSpacing: '0.05em' }}>Registrar en Espera</h4>
            <div className="form-group">
              <label className="form-label">Nombre del Cliente</label>
              <input id="waitlist-client-input" className="form-input" placeholder="Nombre completo" value={cliente} onChange={e => setCliente(e.target.value)} />
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

          {/* Panel Derecho: QR Autoservicio */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, textAlign: 'center', borderLeft: '1px solid var(--border)', paddingLeft: 20 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--bronze-light)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Registro Autoservicio (QR)</span>
            <div style={{ background: '#fff', padding: 8, borderRadius: 10, display: 'inline-block', boxShadow: '0 4px 12px rgba(0,0,0,0.15)', marginTop: 8 }}>
              <img 
                src={`https://api.qrserver.com/v1/create-qr-code/?size=130x130&data=${encodeURIComponent(typeof window !== 'undefined' ? `${window.location.origin}/fila/registro?s=${getEncodedSalonId()}` : `https://yoy-ia-billar.vercel.app/fila/registro?s=${getEncodedSalonId()}`)}`} 
                alt="QR Registro"
                style={{ width: 130, height: 130, display: 'block' }}
              />
            </div>
            <p style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.3, margin: '8px 0', maxWidth: 180 }}>
              Los clientes pueden escanear este código QR para anotarse solos en la lista de espera desde su celular.
            </p>
            <button 
              className="btn btn-secondary btn-sm" 
              onClick={imprimirQRRegistroVirtual}
              style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, fontSize: 11, marginTop: 4 }}
            >
              <i className="ri-printer-line" /> Imprimir QR de Fila
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
function ModalCuentasActivas({ 
  cuentas, 
  setCuentas, 
  mesas, 
  setMesas, 
  imprimirPreTicket, 
  confirmarCerrarMesa, 
  adminPinHash, 
  hashPassword, 
  onClose, 
  showToast, 
  registrarEvento,
  meserosPresentes,
  procesandoCierre,
  setCobroExito,
  user,
  imprimirTicketFinal
}) {
  const [activeTab, setActiveTab] = useState('cuentas'); // 'cuentas' o 'mesas'
  const [cuentaSel, setCuentaSel] = useState(null);
  const [mesaSel, setMesaSel] = useState(null);
  
  const [prodSel, setProdSel] = useState('Cerveza Corona');
  const [cantSel, setCantSel] = useState(1);
  const [metodoPago, setMetodoPago] = useState('efectivo');
  const [showCheckout, setShowCheckout] = useState(false);

  // Estados de cálculo de cambio, escáner QR y comprobante con foto
  const [pagaCon, setPagaCon] = useState('');
  const [referencia, setReferencia] = useState('');
  const [fotoComprobante, setFotoComprobante] = useState('');
  const [camaraActiva, setCamaraActiva] = useState(false);

  // Estados para autorización de eliminación de consumos
  const [pinEliminar, setPinEliminar] = useState('');
  const [itemAEliminar, setItemAEliminar] = useState(null); // { cId, itemId, prodName, cant }

  const [tick, setTick] = useState(0);

  // Estado para la transferencia de consumos de cuenta huérfana (Sugerencia 2)
  const [targetMesaTransfer, setTargetMesaTransfer] = useState('');

  const getMesaIdOfCuenta = (c) => {
    if (!c) return null;
    if (c.mesaId) return c.mesaId;
    if (c.cliente) {
      const match = c.cliente.match(/\(?[Mm]esa\s+(\d+)/);
      if (match) {
        return parseInt(match[1]);
      }
    }
    return null;
  };

  const isCuentaHuerfana = (c) => {
    if (!c) return false;
    if (c.cliente && isRealName(getCleanClientName(c.cliente))) {
      return false;
    }
    const mId = getMesaIdOfCuenta(c);
    if (mId) {
      const m = mesas.find(tbl => tbl.id === mId);
      if (!m || m.estado !== 'ocupada') return true;
    }
    return false;
  };

  const getMesaEstadoHuerfana = (c) => {
    if (!c) return null;
    const mId = getMesaIdOfCuenta(c);
    if (mId) {
      const m = mesas.find(tbl => tbl.id === mId);
      if (m) return m.estado;
    }
    return null;
  };

  const handleTransferirConsumos = async () => {
    if (!targetMesaTransfer || !cuentaSel) return;
    const destMesaId = parseInt(targetMesaTransfer);
    const destMesa = mesas.find(m => m.id === destMesaId);
    if (!destMesa || destMesa.estado !== 'ocupada') {
      showToast('La mesa de destino debe estar ocupada.', 'warning');
      return;
    }

    // Buscar la cuenta activa de la mesa destino
    const destCuenta = getCuentaAsociadaSafe(destMesa, cuentas);

    if (!destCuenta || destCuenta.isDefaultNullObject) {
      showToast('No se encontró una cuenta activa para la mesa de destino.', 'warning');
      return;
    }

    const confirmacion = window.confirm(`¿Seguro que deseas transferir los consumos de "${cuentaSel.cliente}" a la cuenta de "${destCuenta.cliente}" (Mesa ${destMesaId})?`);
    if (!confirmacion) return;

    const consumosATransferir = cuentaSel.consumos || [];

    await setCuentas(prev => {
      // 1. Agregar los consumos a la cuenta destino
      let updated = prev.map(c => {
        if (c.id === destCuenta.id) {
          const nuevosConsumos = [...c.consumos];
          consumosATransferir.forEach(itemTransfer => {
            const existeItem = nuevosConsumos.find(i => 
              (itemTransfer.productoId && i.productoId === itemTransfer.productoId) || 
              i.producto.toLowerCase() === itemTransfer.producto.toLowerCase()
            );
            if (existeItem) {
              existeItem.cantidad += itemTransfer.cantidad;
            } else {
              nuevosConsumos.push({
                ...itemTransfer,
                id: Date.now() + Math.random()
              });
            }
          });
          return { ...c, consumos: nuevosConsumos };
        }
        return c;
      });

      // 2. Eliminar la cuenta de origen (huérfana)
      updated = updated.filter(c => c.id !== cuentaSel.id);
      return updated;
    });

    showToast(`Consumos transferidos con éxito a la Mesa ${destMesaId} ✓`, 'success');
    if (registrarEvento) {
      registrarEvento('Transferir Consumos', `Consumos de cuenta huérfana "${cuentaSel.cliente}" transferidos a Mesa ${destMesaId} (${destCuenta.cliente})`);
    }

    setCuentaSel(null);
    setTargetMesaTransfer('');
  };

  const calcTotal = (c) => {
    if (!c) return 0;
    const tConsumos = (c.consumos || []).reduce((s, i) => s + (i.precio * i.cantidad), 0);
    return (c.tiempoJuego || 0) + tConsumos;
  };

  // Intervalo de tiempo para actualización en tiempo real
  useEffect(() => {
    const interval = setInterval(() => {
      setTick(t => t + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  // Limpiar campos al cambiar de método, cuenta o mesa
  useEffect(() => {
    setPagaCon('');
    setReferencia('');
    setFotoComprobante('');
    setCamaraActiva(false);
  }, [metodoPago, cuentaSel, mesaSel]);

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

  const PRODUCTOS = [
    { producto: 'Cerveza Corona', precio: 45 },
    { producto: 'Refresco Coca-Cola', precio: 30 },
    { producto: 'Nachos con Queso', precio: 75 },
    { producto: 'Papas Fritas', precio: 55 },
    { producto: 'Alitas de Pollo x10', precio: 120 },
    { producto: 'Café Americano', precio: 35 },
    { producto: 'Agua Embotellada', precio: 20 },
  ];

  // Dynamic bindings based on active tab and selection
  const isMesaTab = activeTab === 'mesas';
  const selectedEntity = isMesaTab ? mesaSel : cuentaSel;
  
  let clientName = '';
  let tiempoJuegoCosto = 0;
  let consumosList = [];
  let grandTotal = 0;
  let durationStr = '00:00:00';
  let cuentaAsociadaMesa = null;

  if (isMesaTab && mesaSel) {
    clientName = mesaSel.cliente || `Mesa ${mesaSel.id}`;
    tiempoJuegoCosto = mesaSel.socios ? 0 : calcCosto(mesaSel);
    cuentaAsociadaMesa = getCuentaAsociadaSafe(mesaSel, cuentas);
    consumosList = cuentaAsociadaMesa.consumos;
    grandTotal = tiempoJuegoCosto + consumosList.reduce((s, i) => s + (i.precio * i.cantidad), 0);
    durationStr = formatTime(Date.now() - mesaSel.inicio);
  } else if (!isMesaTab && cuentaSel) {
    clientName = cuentaSel.cliente;
    tiempoJuegoCosto = cuentaSel.tiempoJuego || 0;
    consumosList = cuentaSel.consumos || [];
    grandTotal = tiempoJuegoCosto + consumosList.reduce((s, i) => s + (i.precio * i.cantidad), 0);
  }

  const totalNeto = grandTotal;
  const totalPagaCon = parseFloat(pagaCon) || 0;
  const cambio = totalPagaCon >= totalNeto ? totalPagaCon - totalNeto : 0;
  const billetes = [50, 100, 200, 500, 1000];
  const quickBills = Array.from(new Set([totalNeto, ...billetes.filter(b => b > totalNeto)])).slice(0, 5);

  const isCheckoutDisabled = procesandoCierre || (totalNeto > 0 && (
    (metodoPago === 'efectivo' && totalPagaCon < totalNeto) ||
    ((metodoPago === 'transferencia' || metodoPago === 'qr') && !referencia.trim())
  ));

  const handleAgregarConsumo = () => {
    if (!selectedEntity) return;
    const pInfo = PRODUCTOS.find(p => p.producto.includes(prodSel)) || PRODUCTOS[0];
    const nuevoConsumo = {
      id: Date.now(),
      producto: pInfo.producto,
      precio: pInfo.precio,
      cantidad: parseInt(cantSel)
    };

    if (isMesaTab) {
      setCuentas(prev => {
        const matchingIdx = prev.findIndex(c => 
          c.mesaId === mesaSel.id ||
          (c.cliente && (
            (mesaSel.cliente && normalizeText(c.cliente) === normalizeText(mesaSel.cliente)) || 
            normalizeText(c.cliente) === `mesa ${mesaSel.id}`
          ))
        );
        if (matchingIdx >= 0) {
          return prev.map((c, idx) => idx === matchingIdx ? { ...c, consumos: [...c.consumos, nuevoConsumo] } : c);
        } else {
          const nuevaCuenta = {
            id: Date.now(),
            mesaId: mesaSel.id,
            cliente: mesaSel.cliente || `Mesa ${mesaSel.id}`,
            tiempoJuego: 0,
            consumos: [nuevoConsumo],
            inicio: mesaSel.inicio
          };
          return [...prev, nuevaCuenta];
        }
      });
    } else {
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
    }

    showToast(`Agregado ${cantSel}x ${pInfo.producto} ✓`, 'success');
    if (registrarEvento) {
      registrarEvento('Agregar Consumo', `Agregado ${cantSel}x ${pInfo.producto} a la cuenta de ${clientName} (Precio: $${pInfo.precio} c/u)`);
    }
  };

  const handleConfirmarEliminarConPin = () => {
    if (!itemAEliminar) return;
    if (hashPassword(pinEliminar) !== adminPinHash) {
      playErrorSound();
      showToast('PIN de autorización incorrecto', 'danger');
      return;
    }
    playSuccessSound();
    
    const { cId, itemId, prodName, cant } = itemAEliminar;

    if (isMesaTab) {
      setCuentas(prev => prev.map(c => {
        if (c.cliente && (
          (mesaSel.cliente && normalizeText(c.cliente) === normalizeText(mesaSel.cliente)) || 
          normalizeText(c.cliente) === `mesa ${mesaSel.id}`
        )) {
          return {
            ...c,
            consumos: c.consumos.filter(i => i.id !== itemId)
          };
        }
        return c;
      }));
    } else {
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
    }

    showToast('Consumo retirado de la cuenta.', 'info');
    if (registrarEvento) {
      registrarEvento('Eliminar Consumo', `Retirado ${cant}x ${prodName} de la cuenta de ${clientName}`);
    }

    setItemAEliminar(null);
    setPinEliminar('');
  };

  const handleImprimirPreTicketMesa = () => {
    if (!mesaSel) return;
    imprimirPreTicket(mesaSel);
    setMesas(prev => prev.map(m => m.id === mesaSel.id ? { ...m, preTicketImpreso: true, preTicketImpresoAt: Date.now() } : m));
    showToast(`Pre-ticket registrado para Mesa ${mesaSel.id} ✓`, 'success');
    if (registrarEvento) {
      registrarEvento('Impresión Pre-Ticket', `Pre-ticket impreso y registrado para Mesa ${mesaSel.id}`);
    }
  };

  const handleConfirmarCobro = async () => {
    if (!selectedEntity) return;

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

    if (isMesaTab) {
      await confirmarCerrarMesa(mesaSel.id, {
        costo: grandTotal,
        metodo: metodoPago,
        tiempo: Date.now() - mesaSel.inicio,
        referencia,
        pagaCon: totalPagaCon.toString(),
        cambio,
        fotoAdjunta: fotoComprobante
      });
      setMesaSel(null);
    } else {
      const ticketParams = {
        cliente: clientName || 'Público General',
        isMesa: false,
        mesaNombre: '',
        inicio: null,
        tiempoJuegoCosto: tiempoJuegoCosto,
        durationStr: '',
        consumos: consumosList,
        total: grandTotal,
        metodoPago: metodoLabel,
        pagaCon: totalPagaCon,
        cambio: cambio,
        referenciaPago: referencia || '',
        operador: user ? (user.displayName || user.email || 'Cajero Principal') : 'Cajero Principal'
      };

      // Mandar a imprimir el ticket final de cobro de cuenta de cliente
      try {
        imprimirTicketFinal(ticketParams);
      } catch (printErr) {
        console.error("Error al imprimir ticket de cuenta:", printErr);
      }

      setCuentas(prev => prev.filter(c => c.id !== cuentaSel.id));
      showToast(`Cuenta de ${cuentaSel.cliente} liquidada con éxito por $${grandTotal} MXN ✓`, 'success');
      if (registrarEvento) {
        registrarEvento('Liquidar Cuenta', `Cuenta de ${cuentaSel.cliente} cobrada por completo ($${grandTotal} MXN por ${metodoLabel}${detalleExtra})`, grandTotal);
      }

      setCobroExito({
        mesaNombre: 'Cuenta Directa',
        cliente: clientName || 'Público General',
        metodoPago: metodoLabel,
        total: grandTotal,
        ticketData: ticketParams
      });

      setCuentaSel(null);
    }

    setShowCheckout(false);
  };

  const mesasActivas = mesas.filter(m => m.estado === 'ocupada');

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ position: 'relative', maxWidth: selectedEntity ? 760 : 500, maxHeight: '90vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }} onClick={e => e.stopPropagation()}>
        {procesandoCierre && (
          <div style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(13,13,15,0.7)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 10000,
            borderRadius: 'inherit'
          }}>
            <div className="ri-loader-4-line ri-spin" style={{ fontSize: 32, color: 'var(--danger)', marginBottom: 12 }} />
            <div style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>Procesando Cobro...</div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}>Por favor espere un momento</div>
          </div>
        )}
        <div className="modal-header">
          <span className="modal-title">
            <i className="ri-folder-open-line" style={{ marginRight: 8, color: 'var(--bronze-light)' }} />
            Centro de Cuentas Activas
          </span>
          <button onClick={onClose} className="btn-icon btn btn-secondary" style={{ background: 'none', border: 'none' }}>
            <i className="ri-close-line" style={{ fontSize: 20 }} />
          </button>
        </div>
        <div className="modal-body" style={{ display: 'grid', gridTemplateColumns: selectedEntity ? '1.1fr 1.3fr' : '1fr', gap: 20, overflowY: 'auto', flex: 1 }}>
          {/* Panel Izquierdo */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {/* Tabs */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <button
                type="button"
                onClick={() => { setActiveTab('cuentas'); setCuentaSel(null); setMesaSel(null); setShowCheckout(false); }}
                style={{
                  background: activeTab === 'cuentas' ? 'var(--bronze-subtle)' : 'var(--bg-elevated)',
                  border: `1px solid ${activeTab === 'cuentas' ? 'var(--border-bronze)' : 'var(--border)'}`,
                  borderRadius: 10,
                  padding: '10px 14px',
                  cursor: 'pointer',
                  color: activeTab === 'cuentas' ? 'var(--bronze-light)' : 'var(--text-secondary)',
                  fontWeight: 700,
                  fontSize: 12,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                  transition: 'all 0.15s ease'
                }}
              >
                <i className="ri-folder-open-line" style={{ fontSize: 14 }} />
                Cuentas ({cuentas.length})
              </button>
              <button
                type="button"
                onClick={() => { setActiveTab('mesas'); setCuentaSel(null); setMesaSel(null); setShowCheckout(false); }}
                style={{
                  background: activeTab === 'mesas' ? 'var(--bronze-subtle)' : 'var(--bg-elevated)',
                  border: `1px solid ${activeTab === 'mesas' ? 'var(--border-bronze)' : 'var(--border)'}`,
                  borderRadius: 10,
                  padding: '10px 14px',
                  cursor: 'pointer',
                  color: activeTab === 'mesas' ? 'var(--bronze-light)' : 'var(--text-secondary)',
                  fontWeight: 700,
                  fontSize: 12,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                  transition: 'all 0.15s ease'
                }}
              >
                <i className="ri-billiards-line" style={{ fontSize: 14 }} />
                Mesas ({mesasActivas.length})
              </button>
            </div>

            {/* Listado */}
            {isMesaTab ? (
              <>
                <h4 style={{ fontSize: 11, textTransform: 'uppercase', color: 'var(--text-secondary)', margin: '4px 0 0 0' }}>Mesas en Juego</h4>
                {mesasActivas.length === 0 ? (
                  <p style={{ color: 'var(--text-muted)', fontSize: 13, textAlign: 'center', padding: '40px 0' }}>No hay mesas activas ocupadas.</p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 380, overflowY: 'auto' }}>
                    {mesasActivas.map(m => {
                      const cAsoc = getCuentaAsociadaSafe(m, cuentas);
                      const cTotal = cAsoc.consumos.reduce((s, i) => s + (i.precio * i.cantidad), 0);
                      const tCosto = m.socios ? 0 : calcCosto(m);
                      const totalMesa = tCosto + cTotal;
                      const tTrans = Date.now() - m.inicio;

                      return (
                        <div
                          key={m.id}
                          onClick={() => { setMesaSel(m); setShowCheckout(false); }}
                          style={{
                            background: mesaSel?.id === m.id ? 'var(--bronze-subtle)' : 'var(--bg-elevated)',
                            border: `1px solid ${mesaSel?.id === m.id ? 'var(--border-bronze)' : 'var(--border)'}`,
                            borderRadius: 10, padding: 12, cursor: 'pointer', transition: 'all 0.15s'
                          }}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: 13 }}>
                            <span>Mesa {m.id} {m.cliente ? `(${m.cliente})` : ''}</span>
                            <span style={{ color: 'var(--bronze-light)' }}>${totalMesa} MXN</span>
                          </div>
                          <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 4, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span>Tiempo: {formatTime(tTrans)}</span>
                            <div style={{ display: 'flex', gap: 6 }}>
                              {m.preTicketImpreso && (
                                <span style={{ color: 'var(--success)', fontSize: 10, display: 'flex', alignItems: 'center', gap: 2 }}>
                                  <i className="ri-printer-line" /> Impreso
                                </span>
                              )}
                              <span>{cAsoc?.consumos.length || 0} consumos</span>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            ) : (
              <>
                <h4 style={{ fontSize: 11, textTransform: 'uppercase', color: 'var(--text-secondary)', margin: '4px 0 0 0' }}>Cuentas Abiertas</h4>
                {cuentas.length === 0 ? (
                  <p style={{ color: 'var(--text-muted)', fontSize: 13, textAlign: 'center', padding: '40px 0' }}>No hay cuentas pendientes.</p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 380, overflowY: 'auto' }}>
                    {cuentas.map(c => {
                      const isHuerfana = isCuentaHuerfana(c);
                      const estadoMesa = getMesaEstadoHuerfana(c);
                      return (
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
                            <span style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 4 }}>
                              {c.cliente}
                              {estadoMesa === 'manten' ? (
                                <span style={{ background: '#d97706', color: '#fff', fontSize: 9, padding: '2px 6px', borderRadius: 4, fontWeight: 800 }} title="La mesa está en mantenimiento">
                                  ⚠️ Mantenimiento
                                </span>
                              ) : isHuerfana ? (
                                <span style={{ background: '#ef4444', color: '#fff', fontSize: 9, padding: '2px 6px', borderRadius: 4, fontWeight: 800 }} title="La mesa asociada no está en juego u ocupada">
                                  ⚠️ Huérfana
                                </span>
                              ) : null}
                            </span>
                            <span style={{ color: 'var(--bronze-light)' }}>${calcTotal(c)} MXN</span>
                          </div>
                          <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 4, display: 'flex', justifyContent: 'space-between' }}>
                            <span>Juego: ${c.tiempoJuego} MXN {c.meseroNombre ? `· Mesero: ${c.meseroNombre}` : ''}</span>
                            <span>{c.consumos.length} consumos</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            )}
          </div>

          {/* Panel Derecho */}
          {selectedEntity && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14, borderLeft: '1px solid var(--border)', paddingLeft: 20 }}>
              {!showCheckout ? (
                <>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <h3 style={{ fontSize: 15, fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>Detalle de {clientName}</h3>
                      {isMesaTab && (
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                          Mesa Ocupada · Tiempo: <span style={{ color: 'var(--bronze-light)', fontWeight: 700 }}>{durationStr}</span>
                        </div>
                      )}
                    </div>
                    {isMesaTab && (
                      <button 
                        className="btn btn-secondary btn-sm"
                        onClick={handleImprimirPreTicketMesa}
                        style={{ padding: '4px 8px', fontSize: 11, display: 'flex', alignItems: 'center', gap: 4 }}
                        title="Imprimir Pre-Ticket de la Mesa"
                      >
                        <i className="ri-printer-line" /> Pre-Ticket
                      </button>
                    )}
                  </div>

                  {!isMesaTab && cuentaSel && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--bg-elevated)', padding: '6px 10px', borderRadius: 8, border: '1px solid var(--border)', marginTop: 2 }}>
                      <label style={{ fontSize: 11, color: 'var(--text-secondary)', margin: 0, whiteSpace: 'nowrap' }}>
                        <i className="ri-user-follow-line" style={{ marginRight: 4 }} /> Mesero Asignado:
                      </label>
                      <select 
                        value={cuentaSel.meseroId || ''} 
                        onChange={async (e) => {
                          const mId = e.target.value;
                          const targetWaiter = (meserosPresentes || []).find(w => w.id === mId);
                          
                          await setCuentas((prev) => prev.map(c => {
                            if (c.id === cuentaSel.id) {
                              return { 
                                ...c, 
                                meseroId: mId || null, 
                                meseroNombre: targetWaiter ? targetWaiter.nombre : null 
                              };
                            }
                            return c;
                          }));
                          
                          setCuentaSel(prev => ({ 
                            ...prev, 
                            meseroId: mId || null, 
                            meseroNombre: targetWaiter ? targetWaiter.nombre : null 
                          }));
                          showToast('Mesero asignado a la cuenta.', 'success');
                        }}
                        className="form-select"
                        style={{ padding: '2px 8px', fontSize: 11, background: 'none', border: 'none', flex: 1, color: 'var(--bronze-light)', cursor: 'pointer' }}
                      >
                        <option value="">-- Sin Mesero --</option>
                        {(meserosPresentes || []).map(m => (
                          <option key={m.id} value={m.id}>{m.nombre}</option>
                        ))}
                      </select>
                    </div>
                  )}

                  {/* Consumos */}
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 220, overflowY: 'auto' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-muted)', borderBottom: '1px solid var(--border)', paddingBottom: 4 }}>
                      <span>TIEMPO DE JUEGO ACUMULADO</span>
                      <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>${tiempoJuegoCosto} MXN</span>
                    </div>

                    {consumosList.length === 0 ? (
                      <p style={{ color: 'var(--text-muted)', fontSize: 12, padding: '10px 0' }}>Sin consumos extras.</p>
                    ) : (
                      consumosList.map(item => (
                        <div key={item.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12 }}>
                          <span style={{ flex: 1 }}>{item.cantidad}x {item.producto} <span style={{ color: 'var(--text-muted)' }}>(${item.precio})</span></span>
                          <span style={{ fontWeight: 700, marginRight: 10 }}>${item.precio * item.cantidad} MXN</span>
                          <button
                            className="btn btn-secondary btn-icon sm"
                            onClick={() => setItemAEliminar({ 
                              cId: isMesaTab ? (cuentaAsociadaMesa ? cuentaAsociadaMesa.id : null) : cuentaSel.id, 
                              itemId: item.id, 
                              prodName: item.producto, 
                              cant: item.cantidad 
                            })}
                            style={{ padding: 4, height: 24, width: 24, border: 'none', background: 'none', color: 'var(--danger)' }}
                            title="Quitar con PIN de Admin"
                          >
                            <i className="ri-close-fill" />
                          </button>
                        </div>
                      ))
                    )}
                  </div>

                  {/* Prompt de Autorización PIN */}
                  {itemAEliminar && (
                    <div style={{
                      background: 'rgba(249, 115, 22, 0.06)',
                      border: '1px solid #f97316',
                      borderRadius: 10,
                      padding: 10,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 6,
                      animation: 'fadeIn 0.2s ease',
                      boxShadow: '0 0 12px rgba(249, 115, 22, 0.25)'
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div style={{ fontSize: 9, fontWeight: 700, color: '#f97316' }}>
                          <i className="ri-shield-keyhole-line" style={{ marginRight: 4 }} />
                          SE REQUIERE AUTORIZACIÓN DE ADMINISTRADOR
                        </div>
                        <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
                          {pinEliminar?.length || 0}/8
                        </span>
                      </div>
                      <div style={{ fontSize: 10, color: 'var(--text-secondary)' }}>
                        Confirmar eliminación de {itemAEliminar.cant}x {itemAEliminar.prodName}:
                      </div>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <input
                          type="password"
                          placeholder="PIN de Admin"
                          className="form-input"
                          style={{ padding: '4px 8px', fontSize: 12, flex: 1 }}
                          value={pinEliminar}
                          onChange={e => setPinEliminar(e.target.value)}
                          maxLength={8}
                          onKeyDown={e => {
                            if (e.key === 'Enter') handleConfirmarEliminarConPin();
                          }}
                        />
                        <button className="btn btn-sm btn-primary" style={{ background: 'var(--danger)', padding: '4px 8px', fontSize: 11 }} onClick={handleConfirmarEliminarConPin}>
                          Confirmar
                        </button>
                        <button className="btn btn-sm btn-secondary" style={{ padding: '4px 8px', fontSize: 11 }} onClick={() => { setItemAEliminar(null); setPinEliminar(''); }}>
                          Cancelar
                        </button>
                      </div>
                    </div>
                  )}

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
                    <button className="btn btn-primary btn-sm" style={{ padding: '8px 12px' }} onClick={handleAgregarConsumo}>
                      Agregar
                    </button>
                  </div>

                  {/* Transferir consumos si la cuenta es huérfana (Sugerencia 2) */}
                  {!isMesaTab && cuentaSel && isCuentaHuerfana(cuentaSel) && (cuentaSel.consumos || []).length > 0 && (
                    <div style={{ 
                      background: 'rgba(217, 83, 79, 0.05)', 
                      border: '1px dashed var(--danger)', 
                      borderRadius: 10, 
                      padding: 10, 
                      display: 'flex', 
                      flexDirection: 'column', 
                      gap: 8, 
                      marginTop: 4 
                    }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--bronze-light)', display: 'flex', alignItems: 'center', gap: 4 }}>
                        <i className="ri-swap-box-line" />
                        TRANSFERIR CONSUMOS A MESA ACTIVA
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1.5fr auto', gap: 6, alignItems: 'center' }}>
                        <select 
                          className="form-select" 
                          style={{ padding: '6px 8px', fontSize: 12 }} 
                          value={targetMesaTransfer} 
                          onChange={e => setTargetMesaTransfer(e.target.value)}
                        >
                          <option value="">Seleccionar mesa activa...</option>
                          {mesas.filter(m => m.estado === 'ocupada' && String(m.id) !== String(getMesaIdOfCuenta(cuentaSel))).map(m => (
                            <option key={m.id} value={m.id}>Mesa {m.id} ({m.cliente})</option>
                          ))}
                        </select>
                        <button 
                          className="btn btn-secondary btn-sm" 
                          style={{ padding: '6px 12px', fontSize: 11, border: 'none', background: 'var(--bronze-light)', color: '#0d0d0f', fontWeight: 700 }}
                          disabled={!targetMesaTransfer}
                          onClick={handleTransferirConsumos}
                        >
                          Transferir
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Footer detalle */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid var(--border)', paddingTop: 10 }}>
                    <div>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>GRAN TOTAL ACUMULADO</div>
                      <div style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 900, color: 'var(--bronze-light)' }}>${grandTotal} MXN</div>
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
                    <h3 style={{ fontSize: 15, fontWeight: 800 }}>Liquidar Cuenta: {clientName}</h3>
                  </div>

                  <div style={{ background: 'var(--bg-elevated)', padding: 10, borderRadius: 10 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border)', paddingBottom: 4, fontSize: 11 }}>
                      <span>Tiempo de Juego</span>
                      <span>${tiempoJuegoCosto} MXN</span>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 4, borderBottom: '1px solid var(--border)', paddingBottom: 4 }}>
                      {consumosList.map(item => (
                        <div key={item.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text-secondary)' }}>
                          <span>{item.cantidad}x {item.producto}</span>
                          <span>${Math.round(item.precio * item.cantidad).toLocaleString('es-MX')} MXN</span>
                        </div>
                      ))}
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, fontWeight: 900, fontSize: 14 }}>
                      <span>Total Neto</span>
                      <span style={{ color: 'var(--bronze-light)' }}>${Math.round(totalNeto).toLocaleString('es-MX')} MXN</span>
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
                            background: metodoPago === m.id ? 'rgba(57, 255, 20, 0.08)' : 'var(--bg-elevated)',
                            border: `1px solid ${metodoPago === m.id ? '#39ff14' : 'var(--border)'}`,
                            borderRadius: 8, padding: '6px 2px', cursor: 'pointer',
                            color: metodoPago === m.id ? '#39ff14' : 'var(--text-secondary)',
                            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
                            fontSize: 8, fontWeight: 600, transition: 'all 0.15s',
                            boxShadow: metodoPago === m.id ? '0 0 10px rgba(57, 255, 20, 0.2)' : 'none',
                            transform: metodoPago === m.id ? 'scale(1.04)' : 'none',
                          }}
                        >
                          <i className={m.icon} style={{ fontSize: 12 }} />
                          {m.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Sub-Paneles Condicionales */}
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
                          style={{
                            padding: '6px 10px',
                            fontSize: 12,
                            borderColor: totalPagaCon >= totalNeto ? (totalPagaCon > totalNeto * 10 ? '#f97316' : '#39ff14') : 'var(--border)',
                            boxShadow: totalPagaCon >= totalNeto ? (totalPagaCon > totalNeto * 10 ? '0 0 8px rgba(249, 115, 22, 0.25)' : '0 0 8px rgba(57, 255, 20, 0.25)') : 'none',
                            transition: 'all 0.2s ease-in-out'
                          }}
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
                              {b === totalNeto ? `Exacto ($${Math.round(b).toLocaleString('es-MX')})` : `$${Math.round(b).toLocaleString('es-MX')}`}
                            </button>
                          ))}
                        </div>
                      </div>
                      {totalPagaCon > 0 && (
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid var(--border)', paddingTop: 6, marginTop: 2 }}>
                          <span style={{ fontSize: 10, color: 'var(--text-secondary)' }}>Cambio a Entregar:</span>
                          <span style={{
                            fontFamily: 'var(--font-display)',
                            fontSize: 19,
                            fontWeight: 950,
                            color: totalPagaCon >= totalNeto ? '#39ff14' : 'var(--danger)',
                            textShadow: totalPagaCon >= totalNeto ? '0 0 10px rgba(57, 255, 20, 0.35)' : 'none',
                            letterSpacing: '0.02em'
                          }}>
                            {totalPagaCon >= totalNeto ? `$${Math.round(cambio).toLocaleString('es-MX')} MXN` : 'Monto insuficiente'}
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
                    onClick={handleConfirmarCobro} 
                    disabled={isCheckoutDisabled}
                    style={{ 
                      background: isCheckoutDisabled ? 'var(--bg-hover)' : 'linear-gradient(135deg, var(--success), #2ed573)', 
                      color: isCheckoutDisabled ? 'var(--text-muted)' : '#0d0d0f', 
                      width: '100%', 
                      marginTop: 6,
                      cursor: isCheckoutDisabled ? 'not-allowed' : 'pointer',
                      boxShadow: !isCheckoutDisabled ? '0 0 15px rgba(57, 255, 20, 0.45)' : 'none',
                      border: !isCheckoutDisabled ? '1px solid #39ff14' : '1px solid transparent',
                      transition: 'all 0.3s ease-in-out'
                    }}
                  >
                    <i className={procesandoCierre ? "ri-loader-4-line ri-spin" : "ri-checkbox-circle-line"} /> {procesandoCierre ? 'Procesando...' : 'Confirmar Cobro e Impresión'}
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
function ModalAbrirCuentaDirecta({ cuentas, setCuentas, clientesRegistrados = [], registrarNuevoClienteDirectorio, onClose, showToast, registrarEvento, meserosPresentes }) {
  const [cliente, setCliente] = useState('');
  const [meseroId, setMeseroId] = useState('');

  const getFilteredClientes = (queryText) => {
    const term = (queryText || '').trim().toLowerCase();
    if (!term) return clientesRegistrados.slice(0, 15);
    return clientesRegistrados
      .filter(c => c.nombre && c.nombre.toLowerCase().includes(term))
      .slice(0, 15);
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

  const isClienteGeneric = !cliente.trim() || !isRealName(cliente);

  const handleCrear = () => {
    const cleanCliente = capitalizeName(cliente);
    if (!isRealName(cleanCliente)) {
      showToast('Debe ingresar un nombre real y no genérico para la cuenta.', 'warning');
      registrarEvento('Intento Cuenta Genérica', `Intento de abrir cuenta directa con nombre inválido: "${cleanCliente}"`);
      return;
    }
    registrarNuevoClienteDirectorio(cleanCliente);
    const targetMesero = (meserosPresentes || []).find(m => m.id === meseroId);
    const nueva = {
      id: Date.now(),
      cliente: cleanCliente,
      tiempoJuego: 0,
      consumos: [],
      inicio: Date.now(),
      meseroId: meseroId || null,
      meseroNombre: targetMesero ? targetMesero.nombre : null
    };
    setCuentas(prev => [...prev, nueva]);
    showToast(`Cuenta creada para ${cleanCliente} ✓`, 'success');
    if (registrarEvento) {
      registrarEvento('Crear Cuenta', `Cuenta abierta manualmente para ${cleanCliente}${targetMesero ? ` (Mesero: ${targetMesero.nombre})` : ''}`);
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
            <div style={{ display: 'flex', gap: 4 }}>
              <input 
                className="form-input" 
                placeholder="Ej: Juan Pérez" 
                value={cliente} 
                onChange={e => setCliente(e.target.value)} 
                list="clientes-directo-list"
                style={{ flex: 1 }}
              />
              <button
                type="button"
                className="btn btn-secondary"
                style={{ padding: '8px 12px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                title="Registrar en catálogo de clientes"
                onClick={() => {
                  const nameClean = capitalizeName(cliente);
                  if (!isRealName(nameClean)) {
                    showToast('Debe ingresar un nombre real y no genérico.', 'warning');
                    return;
                  }
                  const existe = clientesRegistrados.some(c => c.nombre.toLowerCase() === nameClean.toLowerCase());
                  if (existe) {
                    showToast(`"${nameClean}" ya está en el catálogo.`, 'info');
                  } else {
                    registrarNuevoClienteDirectorio(nameClean);
                  }
                }}
              >
                <i className="ri-user-add-line" style={{ fontSize: 14 }} />
              </button>
            </div>
            <datalist id="clientes-directo-list">
              {getFilteredClientes(cliente).map((c, idx) => (
                <option key={idx} value={c.nombre} />
              ))}
            </datalist>
            {isClienteGeneric && (
              <div style={{ color: 'var(--danger)', fontSize: 9, marginTop: 4 }}>
                <i className="ri-error-warning-line" style={{ marginRight: 2 }} />
                Debe ingresar un nombre real y no genérico.
              </div>
            )}
          </div>

          <div className="form-group" style={{ marginTop: 12 }}>
            <label className="form-label" style={{ fontSize: 11, fontWeight: 600 }}>Mesero Asignado (Opcional)</label>
            <select 
              className="form-select" 
              value={meseroId} 
              onChange={e => setMeseroId(e.target.value)}
              style={{ width: '100%', padding: '6px 10px', borderRadius: 8, background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-primary)', fontSize: 12 }}
            >
              <option value="">-- Sin mesero asignado --</option>
              {(meserosPresentes || []).map(m => (
                <option key={m.id} value={m.id}>{m.nombre}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cancelar</button>
          <button 
            className="btn btn-primary" 
            onClick={handleCrear}
            disabled={!cliente.trim()}
            style={{
              background: !cliente.trim() ? 'var(--bg-hover)' : undefined,
              cursor: !cliente.trim() ? 'not-allowed' : 'pointer'
            }}
          >
            Abrir Cuenta
          </button>
        </div>
      </div>
      <datalist id="clientes-registrados-list">
        {(clientesRegistrados || []).map((c, idx) => (
          <option key={idx} value={c.nombre} />
        ))}
      </datalist>
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
function ModalBitacora({ bitacora, onClear, onClose, onLoadMore, hasMore }) {
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
                <button className="btn btn-secondary btn-sm" onClick={onLoadMore} style={{ width: '100%', marginTop: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                  <i className="ri-arrow-down-s-line" /> Cargar más registros...
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

// ── MODAL REGISTRAR COMANDA (NUEVO) ──────────────────────
function ModalRegistrarComanda({ mesas, setMesas, cuentasActivas, actualizarCuentasFirestore, onClose, showToast, registrarEvento, meserosPresentes }) {
  const [destinoTipo, setDestinoTipo] = useState('mesa'); // 'mesa', 'cuenta', 'llevar'
  const [destinoId, setDestinoId] = useState('');
  const [carrito, setCarrito] = useState([]);
  const [productos, setProductos] = useState([]);
  const [isClosing, setIsClosing] = useState(false);
  const [meseroId, setMeseroId] = useState('');

  useEffect(() => {
    if (destinoTipo === 'mesa' && destinoId) {
      const targetMesa = mesas.find(m => m.id === parseInt(destinoId));
      if (targetMesa && targetMesa.meseroId) {
        setMeseroId(targetMesa.meseroId);
      } else {
        setMeseroId('');
      }
    } else {
      setMeseroId('');
    }
  }, [destinoId, destinoTipo, mesas]);

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

    // Si es para llevar (venta barra instantánea), descontar inventario en caliente en Firestore
    if (destinoTipo === 'llevar') {
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
      }, { merge: true }).catch(err => console.error("Error al actualizar inventario en comanda de barra:", err));
    }

    const targetMesa = destinoTipo === 'mesa' ? mesas.find(m => m.id === parseInt(destinoId)) : null;
    const targetCuenta = destinoTipo === 'cuenta' ? cuentasActivas.find(c => String(c.id) === String(destinoId)) : null;

    let finalCliente = 'Para Llevar';
    if (destinoTipo === 'mesa') {
      finalCliente = targetMesa ? targetMesa.cliente : `Mesa ${destinoId}`;
    } else if (destinoTipo === 'cuenta') {
      finalCliente = targetCuenta ? targetCuenta.cliente : 'Cliente';
    }

    const comandaData = {
      mesaId: destinoTipo === 'mesa' ? parseInt(destinoId) : 0,
      cliente: finalCliente,
      items: carrito.map(item => ({
        productoId: item.id,
        nombre: item.nombre,
        precio: item.precioVenta,
        cantidad: item.cantidad
      })),
      total: total,
      estado: 'pendiente',
      tipo: 'pedido',
      origen: 'caja_captura',
      atendidoAdmin: false,
      atendidoMesero: false,
      cargadoACuenta: destinoTipo === 'llevar', // Si es 'llevar', se marca como ya cargada para que no intente sumarse a ninguna mesa
      meseroId: meseroId || null,
      meseroNombre: meseroId ? ((meserosPresentes || []).find(m => m.id === meseroId)?.nombre || null) : null,
      createdAt: serverTimestamp()
    };

    addDoc(collection(db, 'mesa_pedidos'), comandaData)
      .then(() => {
        if (destinoTipo === 'llevar') {
          showToast(`Comanda registrada Para Llevar. Total: $${total} MXN ✓`, 'success');
          registrarEvento('Venta Barra', `Comanda Para Llevar: ${carrito.map(i=>`${i.cantidad}x ${i.nombre}`).join(', ')} liquidada al momento`, total);
          
          if (meseroId) {
            const emp = empleadosTodos.find(e => e.id === meseroId);
            if (emp && emp.comisionBar > 0) {
              const comisionBar = emp.comisionBarTipo === 'porcentaje'
                ? (total * Number(emp.comisionBar)) / 100
                : Number(emp.comisionBar);

              addDoc(collection(db, 'nomina_comisiones'), {
                empleadoId: emp.id,
                empleadoNombre: `${emp.nombre} ${emp.apellido || ''}`.trim(),
                fecha: new Date().toISOString().slice(0, 10),
                mesaId: 0,
                montoMesa: 0,
                montoBar: total,
                comisionMesa: 0,
                comisionBar: Number(comisionBar.toFixed(2)),
                comisionTotal: Number(comisionBar.toFixed(2)),
                createdAt: serverTimestamp()
              }).catch(errComm => console.error("Error al registrar comision bar para llevar:", errComm));
            }
          }
        } else {
          showToast(`Comanda de ${finalCliente} registrada y enviada a cocina/mesero ✓`, 'success');
          registrarEvento('Comanda Registrada', `Comanda de ${carrito.map(i=>`${i.cantidad}x ${i.nombre}`).join(', ')} enviada para ${finalCliente}`, total);
        }
        
        setCarrito([]);
        onClose();
      })
      .catch(err => {
        console.error("Error al registrar comanda en Firestore:", err);
        showToast("Error al enviar la comanda.", "danger");
      });
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

            {/* Selector de Mesero Asignado para la comanda */}
            {(destinoTipo === 'mesa' || destinoTipo === 'cuenta') && (
              <div className="form-group" style={{ marginBottom: 12 }}>
                <label className="form-label" style={{ fontSize: 10 }}>Mesero Asignado</label>
                <select 
                  className="form-select" 
                  style={{ fontSize: 12, padding: 6 }} 
                  value={meseroId} 
                  onChange={e=>setMeseroId(e.target.value)}
                >
                  <option value="">-- Sin Mesero / Ninguno --</option>
                  {(meserosPresentes || []).map(m => (
                    <option key={m.id} value={m.id}>{m.nombre}</option>
                  ))}
                </select>
              </div>
            )}

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


function ModalStatusCambio({ mesa, nuevoEstado, onClose, onConfirm }) {
  const [valor, setValor] = useState('');
  const [limiteReserva, setLimiteReserva] = useState(30);
  const [telefono, setTelefono] = useState('');
  const [isClosing, setIsClosing] = useState(false);

  const handleClose = () => {
    setIsClosing(true);
    setTimeout(onClose, 200);
  };

  const handleConfirm = () => {
    onConfirm(valor, parseInt(limiteReserva), telefono);
  };

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') handleClose();
      if (e.key === 'Enter') {
        if (nuevoEstado !== 'reservada' || valor.trim()) {
          handleConfirm();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [valor, limiteReserva, telefono]);

  const isReserva = nuevoEstado === 'reservada';
  const title = isReserva ? `Reservar ${mesa.nombre}` : `Poner ${mesa.nombre} en ${nuevoEstado === 'manten' ? 'Mantenimiento' : 'Fuera de Servicio'}`;
  const label = isReserva ? 'Nombre del Cliente' : 'Motivo / Detalle del Estado';
  const placeholder = isReserva ? 'Ej: Juan Pérez, Reserva 8:00 PM...' : 'Ej: Cambio de paño, Falla luz superior (opcional)...';

  return (
    <div className={`modal-overlay ${isClosing ? 'modal-closing' : ''}`} onClick={handleClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 400 }}>
        <div className="modal-header">
          <span className="modal-title">
            <i className={isReserva ? "ri-bookmark-fill" : "ri-tools-line"} style={{ marginRight: 8, color: 'var(--bronze-light)' }} />
            {title}
          </span>
          <button onClick={handleClose} className="btn-icon btn btn-secondary" style={{ background: 'none', border: 'none' }}>
            <i className="ri-close-line" style={{ fontSize: 20 }} />
          </button>
        </div>
        <div className="modal-body">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div className="form-group">
              <label className="form-label">{label}</label>
              <input 
                className="form-input" 
                placeholder={placeholder} 
                value={valor} 
                onChange={e => setValor(e.target.value)} 
                autoFocus 
              />
            </div>

            {isReserva && (
              <>
                <div className="form-group">
                  <label className="form-label">Número Telefónico (Opcional)</label>
                  <input 
                    className="form-input" 
                    placeholder="Ej: 5512345678" 
                    value={telefono} 
                    onChange={e => setTelefono(e.target.value)} 
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Tiempo límite de reservación</label>
                  <select 
                    className="form-select" 
                    value={limiteReserva} 
                    onChange={e => setLimiteReserva(parseInt(e.target.value))}
                  >
                    <option value={15}>15 minutos</option>
                    <option value={30}>30 minutos (Recomendado)</option>
                    <option value={45}>45 minutos</option>
                    <option value={60}>1 hora</option>
                  </select>
                  <span style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 4, display: 'block' }}>
                    Transcurrido este tiempo, la mesa volverá a estar disponible automáticamente.
                  </span>
                </div>
              </>
            )}
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={handleClose}>Cancelar</button>
          <button 
            className="btn btn-primary" 
            onClick={handleConfirm}
            disabled={isReserva && !valor.trim()}
          >
            Confirmar
          </button>
        </div>
      </div>
    </div>
  );
}

function ModalHistorial({ mesa, onClose }) {
  const [isClosing, setIsClosing] = useState(false);
  const handleClose = () => {
    setIsClosing(true);
    setTimeout(onClose, 200);
  };

  const formatearFecha = (iso) => {
    try {
      const d = new Date(iso);
      return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch {
      return iso;
    }
  };

  return (
    <div className={`modal-overlay ${isClosing ? 'modal-closing' : ''}`} onClick={handleClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 450 }}>
        <div className="modal-header">
          <span className="modal-title">
            <i className="ri-history-line" style={{ marginRight: 8, color: 'var(--bronze-light)' }} />
            Historial de Incidencias — {mesa.nombre}
          </span>
          <button onClick={handleClose} className="btn-icon btn btn-secondary" style={{ background: 'none', border: 'none' }}>
            <i className="ri-close-line" style={{ fontSize: 20 }} />
          </button>
        </div>
        <div className="modal-body" style={{ maxHeight: '60vh', overflowY: 'auto' }}>
          {(!mesa.historialManten || mesa.historialManten.length === 0) ? (
            <div style={{ padding: '20px 0', textAlign: 'center', color: 'var(--text-muted)' }}>
              No hay incidencias registradas en el historial de esta mesa.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {mesa.historialManten.map((item, idx) => (
                <div 
                  key={idx} 
                  style={{
                    background: 'var(--bg-elevated)',
                    border: '1px solid var(--border)',
                    borderRadius: 10,
                    padding: 12,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 6
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 10 }}>
                    <span style={{ 
                      color: item.estado === 'manten' ? 'var(--mesa-manten)' : '#ef4444',
                      fontWeight: 700,
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em'
                    }}>
                      {item.estado === 'manten' ? '🔧 Mantenimiento' : '🚫 Fuera de Servicio'}
                    </span>
                    <span style={{ color: 'var(--text-muted)' }}>{formatearFecha(item.fecha)}</span>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-primary)', fontWeight: 500, wordBreak: 'break-word' }}>
                    {item.motivo}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={handleClose}>Cerrar</button>
        </div>
      </div>
    </div>
  );
}

function ModalReservasCentral({ mesas, setMesas, onClose, registrarEvento, showToast, abrirMesa, imprimirComprobanteReserva, enviarAlertaMesero }) {
  const [cliente, setCliente] = useState('');
  const [telefono, setTelefono] = useState('');
  const [limiteMinutos, setLimiteMinutos] = useState(30);
  const [mesasSeleccionadas, setMesasSeleccionadas] = useState([]); // Array of IDs
  const [isClosing, setIsClosing] = useState(false);

  const handleClose = () => {
    setIsClosing(true);
    setTimeout(onClose, 200);
  };

  const activeReservations = mesas.filter(m => m.estado === 'reservada');
  const availableTables = mesas.filter(m => m.estado === 'libre');

  const handleToggleMesaSelection = (id) => {
    setMesasSeleccionadas(prev => 
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  const handleSaveReservation = () => {
    if (!cliente.trim()) {
      showToast("Ingresa el nombre del cliente.", "warning");
      return;
    }
    if (mesasSeleccionadas.length === 0) {
      showToast("Selecciona al menos una mesa.", "warning");
      return;
    }

    const limiteMs = (limiteMinutos || 30) * 60 * 1000;
    
    // Generar e imprimir un comprobante para cada mesa reservada
    mesasSeleccionadas.forEach(id => {
      const mesaObj = mesas.find(m => m.id === id);
      try {
        imprimirComprobanteReserva({
          id,
          nombre: mesaObj ? (mesaObj.nombre || `Mesa ${id}`) : `Mesa ${id}`,
          cliente: cliente.trim(),
          telefono: telefono.trim(),
          limiteReservaMs: limiteMs
        });
      } catch (printErr) {
        console.error("Error al imprimir comprobante de reserva:", printErr);
      }
    });

    setMesas(prev => prev.map(m => {
      if (mesasSeleccionadas.includes(m.id)) {
        return {
          ...m,
          estado: 'reservada',
          cliente: cliente.trim(),
          telefono: telefono.trim(),
          inicio: null,
          socios: false,
          clienteUid: '',
          preTicketImpreso: false,
          reservadaAt: Date.now(),
          limiteReservaMs: limiteMs
        };
      }
      return m;
    }));

    const mesasNombres = mesasSeleccionadas.map(id => `Mesa ${id}`).join(', ');
    registrarEvento('Reservación Múltiple', `Reservación de ${mesasNombres} para ${cliente.trim()} (${telefono.trim() || 'Sin tel'}) por ${limiteMinutos} min.`);
    showToast(`Mesa(s) ${mesasNombres} reservada(s) con éxito.`, "success");

    if (enviarAlertaMesero) {
      mesasSeleccionadas.forEach(id => {
        enviarAlertaMesero(id, cliente.trim(), 'Mesa Reservada', 'asistencia', '📅');
      });
    }

    // Reset form
    setCliente('');
    setTelefono('');
    setMesasSeleccionadas([]);
  };

  const handleLiberarMesa = (mesa) => {
    setMesas(prev => prev.map(m => m.id === mesa.id ? {
      ...m,
      estado: 'libre',
      cliente: null,
      telefono: '',
      inicio: null,
      socios: false,
      clienteUid: '',
      preTicketImpreso: false,
      reservadaAt: null,
      limiteReservaMs: null
    } : m));
    registrarEvento('Libera Reserva', `Reserva de Mesa ${mesa.id} (${mesa.cliente}) cancelada.`);
    showToast(`Mesa ${mesa.id} liberada.`, "info");
    verificarFilaYRecordar(mesa.id, mesa.tipo, mesa.filaId);
  };

  const handleActivarMesa = (mesa) => {
    handleClose();
    setTimeout(() => abrirMesa(mesa), 220);
  };

  return (
    <div className={`modal-overlay ${isClosing ? 'modal-closing' : ''}`} onClick={handleClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 650, width: '95%' }}>
        <div className="modal-header">
          <span className="modal-title">
            <i className="ri-bookmark-fill" style={{ marginRight: 8, color: 'var(--bronze-light)' }} />
            Libro Central de Reservaciones
          </span>
          <button onClick={handleClose} className="btn-icon btn btn-secondary" style={{ background: 'none', border: 'none' }}>
            <i className="ri-close-line" style={{ fontSize: 20 }} />
          </button>
        </div>
        <div className="modal-body" style={{ maxHeight: '70vh', overflowY: 'auto', display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 20 }}>
          
          {/* Columna Izquierda: Reservas Activas */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <h4 style={{ fontSize: 13, textTransform: 'uppercase', color: 'var(--bronze-light)', borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: 6, margin: 0 }}>
              Reservas Activas ({activeReservations.length})
            </h4>
            
            {activeReservations.length === 0 ? (
              <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>
                No hay mesas reservadas en este momento.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, overflowY: 'auto', maxHeight: '45vh' }}>
                {activeReservations.map(m => {
                  const transcurrido = Date.now() - (m.reservadaAt || Date.now());
                  const limiteMs = m.limiteReservaMs || (30 * 60 * 1000);
                  const restanteMin = Math.max(0, Math.ceil((limiteMs - transcurrido) / 60000));
                  return (
                    <div 
                      key={m.id} 
                      style={{
                        background: 'var(--bg-elevated)',
                        border: '1px solid var(--border)',
                        borderRadius: 10,
                        padding: 10,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 6
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <strong style={{ fontSize: 12, color: 'var(--bronze-light)' }}>{m.nombre}</strong>
                        <span style={{ fontSize: 10, background: 'rgba(245, 158, 11, 0.12)', color: 'var(--mesa-reservada)', padding: '1px 5px', borderRadius: 4 }}>
                          {restanteMin} min rest
                        </span>
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-primary)' }}>
                        👤 {m.cliente}
                      </div>
                      {m.telefono && (
                        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                          📞 {m.telefono}
                        </div>
                      )}
                      <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                        <button 
                          className="btn btn-success btn-xs" 
                          style={{ flex: 1, padding: '4px 6px', fontSize: 10 }}
                          onClick={() => handleActivarMesa(m)}
                        >
                          Activar
                        </button>
                        <button 
                          className="btn btn-secondary btn-xs" 
                          style={{ flex: 1, padding: '4px 6px', fontSize: 10 }}
                          onClick={() => handleLiberarMesa(m)}
                        >
                          Liberar
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Columna Derecha: Nueva Reserva */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, borderLeft: '1px solid rgba(255,255,255,0.05)', paddingLeft: 20 }}>
            <h4 style={{ fontSize: 13, textTransform: 'uppercase', color: 'var(--bronze-light)', borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: 6, margin: 0 }}>
              Nueva Reserva
            </h4>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div className="form-group">
                <label className="form-label">Nombre del Cliente</label>
                <input 
                  className="form-input" 
                  placeholder="Ej: Juan Pérez" 
                  value={cliente} 
                  onChange={e => setCliente(e.target.value)} 
                />
              </div>

              <div className="form-group">
                <label className="form-label">Número Telefónico</label>
                <input 
                  className="form-input" 
                  placeholder="Ej: 5512345678" 
                  value={telefono} 
                  onChange={e => setTelefono(e.target.value)} 
                />
              </div>

              <div className="form-group">
                <label className="form-label">Límite de Tiempo</label>
                <select 
                  className="form-select" 
                  value={limiteMinutos} 
                  onChange={e => setLimiteMinutos(parseInt(e.target.value))}
                >
                  <option value={15}>15 minutos</option>
                  <option value={30}>30 minutos (Recomendado)</option>
                  <option value={45}>45 minutos</option>
                  <option value={60}>1 hora</option>
                </select>
              </div>

              <div className="form-group">
                <label className="form-label">Seleccionar Mesa(s) Disponibles</label>
                {availableTables.length === 0 ? (
                  <div style={{ fontSize: 11, color: '#ef4444', marginTop: 4 }}>
                    No hay mesas disponibles para reservar en este momento.
                  </div>
                ) : (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, maxHeight: '18vh', overflowY: 'auto', padding: 4, background: 'rgba(0,0,0,0.2)', borderRadius: 8 }}>
                    {availableTables.map(m => (
                      <label 
                        key={m.id} 
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 6,
                          fontSize: 11,
                          cursor: 'pointer',
                          padding: '4px 6px',
                          borderRadius: 6,
                          background: mesasSeleccionadas.includes(m.id) ? 'rgba(205,127,50,0.15)' : 'transparent',
                          border: mesasSeleccionadas.includes(m.id) ? '1px solid rgba(205,127,50,0.3)' : '1px solid transparent'
                        }}
                      >
                        <input 
                          type="checkbox" 
                          checked={mesasSeleccionadas.includes(m.id)}
                          onChange={() => handleToggleMesaSelection(m.id)}
                          style={{ accentColor: 'var(--bronze-light)' }}
                        />
                        <span>{m.nombre}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>

              <button 
                className="btn btn-primary" 
                style={{ width: '100%', marginTop: 8 }}
                onClick={handleSaveReservation}
                disabled={!cliente.trim() || mesasSeleccionadas.length === 0}
              >
                Reservar Mesa(s)
              </button>
            </div>
          </div>

        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={handleClose}>Cerrar</button>
        </div>
      </div>
    </div>
  );
}

function ModalAvisarCliente({ mesa, fila, onClose, registrarEvento, showToast, enviarAlertaMesero }) {
  const [selectedFilaId, setSelectedFilaId] = useState('');
  const [cliente, setCliente] = useState('');
  const [isClosing, setIsClosing] = useState(false);

  const handleClose = () => {
    setIsClosing(true);
    setTimeout(onClose, 200);
  };

  const handleSendAlert = async () => {
    if (!selectedFilaId) {
      showToast("Seleccione un cliente en espera para avisar.", "warning");
      return;
    }

    try {
      const docId = String(selectedFilaId);
      await updateDoc(doc(db, 'fila_espera', docId), {
        estado: 'asignada',
        mesaAsignada: mesa.nombre || `Mesa ${mesa.id}`,
        assignedAt: serverTimestamp()
      });

      registrarEvento('Aviso Disponibilidad', `Alerta digital enviada a ${cliente || 'Cliente'} para ocupar ${mesa.nombre || `Mesa ${mesa.id}`}`);
      showToast(`Alerta digital enviada al celular del cliente ✓`, "success");
      if (enviarAlertaMesero) {
        await enviarAlertaMesero(mesa.id, cliente, 'Mesa Asignada (Fila)', 'asistencia', '⏳');
      }
      handleClose();
    } catch (err) {
      console.error("Error al enviar alerta digital:", err);
      showToast("Error al enviar la alerta digital. Verifique conexión.", "danger");
    }
  };

  return (
    <div className={`modal-overlay ${isClosing ? 'modal-closing' : ''}`} onClick={handleClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 400 }}>
        <div className="modal-header">
          <span className="modal-title">
            <i className="ri-notification-3-line" style={{ marginRight: 8, color: 'var(--bronze-light)' }} />
            Avisar Disponibilidad — {mesa.nombre || `Mesa ${mesa.id}`}
          </span>
          <button onClick={handleClose} className="btn-icon btn btn-secondary" style={{ background: 'none', border: 'none' }}>
            <i className="ri-close-line" style={{ fontSize: 20 }} />
          </button>
        </div>
        <div className="modal-body">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            
            <p style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
              Selecciona el cliente de la lista de espera al cual le asignarás esta mesa. Al enviar la alerta, sonará y vibrará su dispositivo móvil si escaneó su código QR.
            </p>

            {fila && fila.length > 0 ? (
              <div className="form-group">
                <label className="form-label" style={{ fontSize: 10, color: 'var(--bronze-light)' }}>
                  Clientes en Fila de Espera
                </label>
                <select 
                  className="form-select"
                  value={selectedFilaId}
                  onChange={(e) => {
                    const id = e.target.value;
                    setSelectedFilaId(id);
                    const item = fila.find(f => f.id === parseInt(id));
                    if (item) {
                      setCliente(item.cliente || '');
                    } else {
                      setCliente('');
                    }
                  }}
                >
                  <option value="">-- Seleccionar cliente en espera --</option>
                  {fila.map(f => (
                    <option key={f.id} value={f.id}>
                      {f.cliente} - {f.tipo} ({f.personas} personas)
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <div style={{ padding: '20px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>
                No hay clientes registrados en la fila de espera actualmente.
              </div>
            )}

            {selectedFilaId && (
              <div style={{ background: 'rgba(197, 168, 128, 0.05)', border: '1px solid rgba(197, 168, 128, 0.15)', borderRadius: 10, padding: 12, fontSize: 12 }}>
                <strong>Cliente a Notificar:</strong> {cliente}<br/>
                <strong>Mesa Disponible:</strong> {mesa.nombre || `Mesa ${mesa.id}`}
              </div>
            )}

            <button 
              className="btn btn-primary"
              style={{ width: '100%', marginTop: 8 }}
              onClick={handleSendAlert}
              disabled={!selectedFilaId}
            >
              <i className="ri-send-plane-fill" style={{ marginRight: 6 }} /> Enviar Alerta Digital
            </button>

          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={handleClose}>Cerrar</button>
        </div>
      </div>
    </div>
  );
}

const SUGERENCIAS_POR_CATEGORIA = {
  mesas: ["Fieltro mesa", "Tacos repuesto", "Bolas repuesto", "Mantenimiento general", "Nivelación mesa"],
  accesorios: ["Tizas Kamui", "Taquera pared", "Triángulos plástico", "Puntas de tacos"],
  bar: ["Compra refrescos", "Insumos cerveza", "Compra botanas", "Hielo en bolsas", "Vasos desechables"],
  servicios: ["Pago de Luz (CFE)", "Pago de Internet", "Pago de Agua", "Renta local"],
  limpieza: ["Jabón y cloro", "Papel higiénico", "Detergente pisos", "Escobas y trapeadores"],
  reparacion: ["Reparación luces", "Pintura fachada", "Reparación clima (A/C)", "Plomería baños"],
  admin: ["Papel para ticketera", "Artículos oficina", "Publicidad redes", "Comisiones bancarias"],
  otro: ["Gasto imprevisto", "Taxi mensajería", "Propina extraordinaria"]
};

function ModalGasto({ onClose, onConfirm, CATEGORIAS_GASTO }) {
  const [empleados, setEmpleados] = useState([]);
  const [form, setForm] = useState({
    categoria: 'mesas',
    descripcion: '',
    monto: '',
    fecha: new Date().toISOString().slice(0, 10),
    proveedor: '',
    notas: '',
    empleadoId: '',
    empleadoNombre: '',
    conceptoNomina: 'adelanto_nomina'
  });
  const [nip, setNip] = useState('');
  const [nipError, setNipError] = useState('');
  const [liveEarnings, setLiveEarnings] = useState(null);
  const [loadingEarnings, setLoadingEarnings] = useState(false);

  useBodyScrollLock(true);

  useEffect(() => {
    const fetchEmpleados = async () => {
      try {
        const q = query(collection(db, 'nomina_empleados'), where('estado', '==', 'activo'));
        const snap = await getDocs(q);
        setEmpleados(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
      } catch (err) {
        console.error("Error al cargar empleados en ModalGasto:", err);
      }
    };
    fetchEmpleados();
  }, []);

  useEffect(() => {
    if (form.categoria === 'nomina') {
      const emp = empleados.find(e => e.id === form.empleadoId);
      const empNombre = emp ? `${emp.nombre} ${emp.apellido || ''}`.trim() : '';
      let conceptLabel = '';
      if (form.conceptoNomina === 'adelanto_nomina') conceptLabel = 'Adelanto de nómina';
      else if (form.conceptoNomina === 'prestamo') conceptLabel = 'Préstamo';
      else if (form.conceptoNomina === 'faltante') conceptLabel = 'Faltante';
      
      if (empNombre && conceptLabel) {
        setForm(p => ({ ...p, descripcion: `${conceptLabel} - ${empNombre}` }));
      } else {
        setForm(p => ({ ...p, descripcion: '' }));
      }
    }
  }, [form.categoria, form.empleadoId, form.conceptoNomina, empleados]);

  // Helper para obtener el periodo quincenal actual para una fecha
  const getPeriodForDate = (dateStr) => {
    if (!dateStr) return { start: '', end: '' };
    const d = new Date(dateStr + 'T12:00:00');
    const year = d.getFullYear();
    const month = d.getMonth();
    const day = d.getDate();
    
    let startStr, endStr;
    if (day <= 15) {
      const start = new Date(year, month, 1);
      const end = new Date(year, month, 15);
      startStr = start.toISOString().slice(0, 10);
      endStr = end.toISOString().slice(0, 10);
    } else {
      const start = new Date(year, month, 16);
      const end = new Date(year, month + 1, 0);
      startStr = start.toISOString().slice(0, 10);
      endStr = end.toISOString().slice(0, 10);
    }
    return { start: startStr, end: endStr };
  };

  // Cargar ingresos acumulados netos en tiempo real
  useEffect(() => {
    if (form.categoria !== 'nomina' || !form.empleadoId) {
      setLiveEarnings(null);
      return;
    }

    const loadLiveEarnings = async () => {
      setLoadingEarnings(true);
      try {
        const emp = empleados.find(e => e.id === form.empleadoId);
        if (!emp) return;

        const { start, end } = getPeriodForDate(form.fecha);
        const startD = new Date(start + 'T00:00:00');
        const endD = new Date(end + 'T00:00:00');
        const dias = Math.max(1, Math.round((endD - startD) / 86400000) + 1);

        // Fetch Asistencias
        const qAsist = query(collection(db, 'nomina_asistencia'), where('empleadoId', '==', form.empleadoId));
        const snapAsist = await getDocs(qAsist);
        const asistEmp = snapAsist.docs.map(doc => doc.data()).filter(a => a.fecha >= start && a.fecha <= end);
        const diasTrabajados = asistEmp.filter(a => a.estado === 'presente').length;
        const tardanzas = asistEmp.filter(a => a.estado === 'tardanza').length;

        // Fetch Existing Expenses
        const qGastos = query(collection(db, 'gastos'), where('empleadoId', '==', form.empleadoId), where('categoria', '==', 'nomina'));
        const snapGastos = await getDocs(qGastos);
        const empGastos = snapGastos.docs.map(doc => doc.data()).filter(g => g.fecha >= start && g.fecha <= end);
        const adelanto = empGastos.filter(g => g.conceptoNomina === 'adelanto_nomina').reduce((s, g) => s + (Number(g.monto) || 0), 0);
        const prestamo = empGastos.filter(g => g.conceptoNomina === 'prestamo').reduce((s, g) => s + (Number(g.monto) || 0), 0);
        const faltante = empGastos.filter(g => g.conceptoNomina === 'faltante').reduce((s, g) => s + (Number(g.monto) || 0), 0);

        // Fetch Bitacora Sales
        const qBit = query(collection(db, 'bitacora'), orderBy('fecha', 'desc'));
        const snapBit = await getDocs(qBit);
        const eventos = snapBit.docs.map(doc => doc.data());
        const fi = new Date(start + 'T00:00:00');
        const ff = new Date(end + 'T23:59:59');
        const eventosPeriodo = eventos.filter(e => {
          const fe = new Date(e.fecha);
          return fe >= fi && fe <= ff;
        });
        const totalMesas = eventosPeriodo
          .filter(e => e.accion === 'Cierre Directo' || e.accion === 'Mesa a Cuenta')
          .reduce((s, e) => s + Math.abs(Number(e.monto) || 0), 0);

        // Calculate ventasBar from stock estimate
        const rawStock = localStorage.getItem('yoy_billar_stock');
        let totalBar = 0;
        if (rawStock) {
          try {
            let productos = [];
            if (rawStock.startsWith('[')) {
              const cb1 = rawStock.indexOf(']');
              const dateStr2 = rawStock.substring(1, cb1);
              const rest2 = rawStock.substring(cb1 + 1);
              const cb2 = rest2.startsWith('[') ? rest2.indexOf(']') : -1;
              const encPart2 = cb2 > 0 ? rest2.substring(cb2 + 1) : rest2;
              const xor2 = decodeURIComponent(escape(window.atob(encPart2)));
              const base64_2 = xor2.split('').map((c, i) => String.fromCharCode(c.charCodeAt(0) ^ dateStr2.charCodeAt(i % dateStr2.length))).join('');
              productos = JSON.parse(decodeURIComponent(escape(window.atob(base64_2))));
            } else {
              productos = JSON.parse(decodeURIComponent(escape(window.atob(rawStock))));
            }
            totalBar = productos.reduce((s, p) => {
              const vendidos = Math.max(0, (p.stockOptimo || 50) - (p.stock || 0));
              return s + vendidos * (p.precioVenta || 0);
            }, 0);
          } catch { totalBar = 0; }
        }

        // Fetch Nomina Pagos
        const qPagos = query(collection(db, 'nomina_pagos'), where('empleadoId', '==', form.empleadoId));
        const snapPagos = await getDocs(qPagos);
        const pagado = snapPagos.docs.map(doc => doc.data())
          .filter(p => p.fechaInicio === start && p.fechaFin === end)
          .reduce((s, p) => s + (p.total || 0), 0);

        // Calculate sueldo, comisiones, etc
        const sueldoBase = Number(emp.sueldoBase) || 0;
        const sueldoProp = sueldoBase > 0 ? (sueldoBase / dias) * diasTrabajados : 0;
        const deduccionesBase = tardanzas * (sueldoBase / dias / 2);

        let comisionMesas = 0;
        if (emp.comisionMesas > 0 && totalMesas > 0) {
          comisionMesas = emp.comisionMesasTipo === 'porcentaje'
            ? (totalMesas * Number(emp.comisionMesas)) / 100
            : Number(emp.comisionMesas) * diasTrabajados;
        }
        let comisionBar = 0;
        if (emp.comisionBar > 0 && totalBar > 0) {
          comisionBar = emp.comisionBarTipo === 'porcentaje'
            ? (totalBar * Number(emp.comisionBar)) / 100
            : Number(emp.comisionBar) * diasTrabajados;
        }

        const bonoTurno = (Number(emp.bonoTurno) || 0) * diasTrabajados;
        const deduccionesNomina = deduccionesBase + prestamo + faltante;
        const total = Math.max(0, sueldoProp + comisionMesas + comisionBar + bonoTurno - deduccionesNomina);
        const pagadoPeriodo = pagado + adelanto;
        const pendiente = Math.max(0, total - pagadoPeriodo);

        setLiveEarnings({
          total,
          adelanto,
          prestamo,
          faltante,
          pendiente,
          periodo: `${start.split('-').reverse().slice(0,2).reverse().join('/')} al ${end.split('-').reverse().slice(0,2).reverse().join('/')}`
        });
      } catch (err) {
        console.error("Error calculating live earnings:", err);
      } finally {
        setLoadingEarnings(false);
      }
    };

    loadLiveEarnings();
  }, [form.categoria, form.empleadoId, form.fecha, empleados]);

  const sugerencias = SUGERENCIAS_POR_CATEGORIA[form.categoria] || [];

  const handleSubmit = async (e) => {
    e.preventDefault();
    setNipError('');

    if (form.categoria === 'nomina') {
      const emp = empleados.find(x => x.id === form.empleadoId);
      if (!emp) {
        setNipError('Debe seleccionar un empleado');
        return;
      }

      if (!emp.nip) {
        setNipError('El empleado seleccionado no tiene un NIP configurado en el sistema.');
        return;
      }

      if (!nip) {
        setNipError('El NIP es obligatorio para autorizar gastos de nómina.');
        return;
      }

      const hashed = await hashNip(nip);
      if (hashed !== emp.nip) {
        setNipError('NIP incorrecto. Autorización denegada.');
        return;
      }

      // Si el concepto es adelanto de nómina, limitar por los ingresos acumulados netos
      if (form.conceptoNomina === 'adelanto_nomina' && liveEarnings) {
        const montoIngresado = Number(form.monto);
        if (montoIngresado > liveEarnings.pendiente) {
          setNipError(`El adelanto solicitado ($${montoIngresado.toFixed(2)}) supera el límite acumulado disponible ($${liveEarnings.pendiente.toFixed(2)}).`);
          return;
        }
      }
    }

    onConfirm(form);
  };

  const handleClose = () => {
    onClose();
  };

  return (
    <div className="modal-overlay animate-fadeIn" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: 9999, backdropFilter: 'blur(3px)', overflowY: 'auto', padding: '40px 16px' }} onClick={handleClose}>
      <div className="modal-content animate-slideUp" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-bronze)', borderRadius: 16, width: '90%', maxWidth: 420, padding: 24, boxShadow: 'var(--shadow-xl)', margin: 'auto 0' }} onClick={e => e.stopPropagation()}>
        <div className="modal-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h3 className="modal-title gradient-bronze" style={{ margin: 0, fontSize: 18, fontWeight: 700 }}><i className="ri-wallet-3-line" style={{ marginRight: 6 }} /> Registrar Gasto Caja</h3>
          <button className="btn-close" onClick={handleClose} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 18, cursor: 'pointer' }}><i className="ri-close-line" /></button>
        </div>
        
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="form-group">
            <label className="form-label">Categoría de Gasto</label>
            <select 
              className="form-select" 
              value={form.categoria} 
              onChange={e => setForm(p => ({ ...p, categoria: e.target.value, empleadoId: '', empleadoNombre: '', conceptoNomina: 'adelanto_nomina', descripcion: '' }))}
              style={{ width: '100%', padding: '10px 12px', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 10, color: 'var(--text-main)', outline: 'none' }}
            >
              {CATEGORIAS_GASTO.map(c => (
                <option key={c.id} value={c.id} style={{ background: 'var(--bg-card)' }}>
                  {c.icon} {c.label}
                </option>
              ))}
            </select>
          </div>

          {form.categoria === 'nomina' && (
            <>
              <div className="form-group">
                <label className="form-label">Empleado</label>
                <select 
                  className="form-select" 
                  value={form.empleadoId} 
                  onChange={e => {
                    const empId = e.target.value;
                    const emp = empleados.find(x => x.id === empId);
                    const nombreCompleto = emp ? `${emp.nombre} ${emp.apellido || ''}`.trim() : '';
                    setForm(p => ({ ...p, empleadoId: empId, empleadoNombre: nombreCompleto }));
                  }}
                  required
                  style={{ width: '100%', padding: '10px 12px', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 10, color: 'var(--text-main)', outline: 'none' }}
                >
                  <option value="">-- Seleccionar Empleado --</option>
                  {empleados.map(e => (
                    <option key={e.id} value={e.id} style={{ background: 'var(--bg-card)' }}>
                      {e.nombre} {e.apellido || ''} ({e.rol})
                    </option>
                  ))}
                </select>
              </div>
              
              <div className="form-group">
                <label className="form-label">Concepto de Nómina</label>
                <select 
                  className="form-select" 
                  value={form.conceptoNomina} 
                  onChange={e => setForm(p => ({ ...p, conceptoNomina: e.target.value }))}
                  required
                  style={{ width: '100%', padding: '10px 12px', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 10, color: 'var(--text-main)', outline: 'none' }}
                >
                  <option value="adelanto_nomina" style={{ background: 'var(--bg-card)' }}>Adelanto de Nómina</option>
                  <option value="prestamo" style={{ background: 'var(--bg-card)' }}>Préstamo</option>
                  <option value="faltante" style={{ background: 'var(--bg-card)' }}>Faltante</option>
                </select>
              </div>

              {loadingEarnings && (
                <div style={{ color: 'var(--text-muted)', fontSize: 12, display: 'flex', alignItems: 'center', gap: 6, padding: '4px 0' }}>
                  <i className="ri-loader-4-line animate-spin" /> Calculando ingresos acumulados en tiempo real...
                </div>
              )}

              {!loadingEarnings && liveEarnings && (
                <div className="animate-fadeIn" style={{
                  background: 'rgba(16,185,129,0.05)',
                  border: '1px solid rgba(16,185,129,0.2)',
                  borderRadius: 12,
                  padding: 14,
                  fontSize: 12,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                  boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.05)'
                }}>
                  <div style={{ color: 'var(--text-muted)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>
                    Resumen Periodo ({liveEarnings.periodo})
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                    <div>
                      <span style={{ color: 'var(--text-muted)' }}>Ganado Neto:</span>{' '}
                      <strong style={{ color: 'var(--text-main)' }}>${liveEarnings.total.toFixed(2)}</strong>
                    </div>
                    <div>
                      <span style={{ color: 'var(--text-muted)' }}>Adelantos:</span>{' '}
                      <strong style={{ color: 'var(--text-main)' }}>${liveEarnings.adelanto.toFixed(2)}</strong>
                    </div>
                  </div>
                  <div style={{ borderTop: '1px dashed rgba(255,255,255,0.1)', paddingTop: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ color: 'var(--text-muted)' }}>Límite Disponible:</span>
                    <strong style={{ color: '#10b981', fontSize: 14 }}>
                      ${liveEarnings.pendiente.toFixed(2)}
                    </strong>
                  </div>
                </div>
              )}
            </>
          )}

          <div className="form-group">
            <label className="form-label">Descripción / Concepto</label>
            <input 
              type="text" 
              className="form-input" 
              placeholder="Ej. Compra de tizas, Repuestos de tacos" 
              value={form.descripcion} 
              onChange={e => setForm(p => ({ ...p, descripcion: e.target.value }))} 
              required 
              disabled={form.categoria === 'nomina'}
            />
            {form.categoria !== 'nomina' && sugerencias.length > 0 && (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
                {sugerencias.map((sug, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setForm(p => ({ ...p, descripcion: sug }))}
                    style={{
                      background: 'rgba(255,255,255,0.03)',
                      border: '1px solid var(--border)',
                      borderRadius: 12,
                      padding: '3px 8px',
                      fontSize: 10,
                      color: 'var(--text-muted)',
                      cursor: 'pointer',
                      transition: 'all 0.15s'
                    }}
                    onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--bronze-light)'; e.currentTarget.style.color = 'var(--bronze-light)'; }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-muted)'; }}
                  >
                    {sug}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div className="form-group">
              <label className="form-label">Monto (MXN)</label>
              <input 
                type="number" 
                min="0.01" 
                step="0.01" 
                className="form-input" 
                placeholder="0.00" 
                value={form.monto} 
                onChange={e => setForm(p => ({ ...p, monto: e.target.value }))} 
                required 
              />
            </div>
            <div className="form-group">
              <label className="form-label">Fecha</label>
              <input 
                type="date" 
                className="form-input" 
                value={form.fecha} 
                onChange={e => setForm(p => ({ ...p, fecha: e.target.value }))} 
                required 
              />
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Proveedor (Opcional)</label>
            <input 
              type="text" 
              className="form-input" 
              placeholder="Ej. Distribuidora Billares" 
              value={form.proveedor} 
              onChange={e => setForm(p => ({ ...p, proveedor: e.target.value }))} 
            />
          </div>

          <div className="form-group">
            <label className="form-label">Notas (Opcional)</label>
            <textarea 
              className="form-input" 
              rows={2} 
              placeholder="Detalles adicionales..." 
              value={form.notes || form.notas || ''} 
              onChange={e => setForm(p => ({ ...p, notas: e.target.value }))}
              style={{ resize: 'none', padding: '10px 12px' }}
            />
          </div>

          {form.categoria === 'nomina' && form.empleadoId && (
            <div className="form-group animate-fadeIn" style={{
              background: 'rgba(212,163,89,0.03)',
              border: '1px solid rgba(212,163,89,0.15)',
              borderRadius: 12,
              padding: 16,
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              boxShadow: '0 4px 12px rgba(0,0,0,0.1)'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: 6, margin: 0, fontSize: 13, color: 'var(--text-main)', fontWeight: 600 }}>
                  <i className="ri-key-2-line" style={{ color: 'var(--bronze-light)' }} />
                  NIP de Autorización del Empleado
                </label>
                <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                  {nip?.length || 0}/8
                </span>
              </div>
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                El trabajador debe ingresar su NIP personal para confirmar que recibe el dinero.
              </span>
              <input 
                type="password" 
                maxLength={8}
                inputMode="numeric"
                pattern="[0-9]*"
                className="form-input" 
                placeholder="••••" 
                value={nip} 
                onChange={e => {
                  setNip(e.target.value.replace(/\D/g, ''));
                  setNipError('');
                }} 
                required 
                style={{
                  textAlign: 'center',
                  letterSpacing: '0.5em',
                  fontSize: 22,
                  fontWeight: 'bold',
                  background: 'var(--bg-elevated)',
                  border: '1px solid var(--border)',
                  borderRadius: 10,
                  color: 'var(--text-main)',
                  padding: '10px'
                }}
              />
              {nipError && (
                <span style={{ color: '#ef4444', fontSize: 11, marginTop: 4, display: 'block', textAlign: 'center', fontWeight: '500' }}>
                  ⚠️ {nipError}
                </span>
              )}
            </div>
          )}

          <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
            <button type="button" className="btn btn-secondary" style={{ flex: 1 }} onClick={handleClose}>Cancelar</button>
            <button type="submit" className="btn btn-primary" style={{ flex: 1 }}>Registrar Gasto</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ModalCuentasSolicitadas({ onClose, showToast, setMostrarCobroManual, setNuevoMonto, setNuevaDesc, setAlertaCobroAsociadaId, actualizarCuentasFirestore, setMesas, registrarEvento, setAlertaClienteAsoc, setAlertaMesaIdAsoc }) {
  const [loading, setLoading] = useState(true);
  const [solicitudes, setSolicitudes] = useState([]);
  const [filtroTab, setFiltroTab] = useState('todas'); // 'todas', 'pendientes', 'atendidas'
  const [subFiltroMesa, setSubFiltroMesa] = useState('todos'); // 'todos', 'con_mesa', 'sin_mesa'
  const [busqueda, setBusqueda] = useState('');

  const cargarSolicitudes = async () => {
    setLoading(true);
    try {
      const q = query(
        collection(db, 'mesa_pedidos'),
        where('tipo', '==', 'cuenta'),
        limit(100)
      );
      const snap = await getDocs(q);
      const items = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      
      items.sort((a, b) => {
        const timeA = a.createdAt?.seconds || 0;
        const timeB = b.createdAt?.seconds || 0;
        return timeB - timeA;
      });

      // Calcular inicio del día comercial actual (5:00 AM)
      const businessDateStr = getBusinessDate();
      const [year, month, day] = businessDateStr.split('-').map(Number);
      const businessStart = new Date(year, month - 1, day, 5, 0, 0);

      // Filtrar para mostrar solo las del día comercial de hoy
      const filtradosPorFecha = items.filter(item => {
        if (!item.createdAt) return true; // Si es temporal/offline, se muestra
        const itemDate = item.createdAt.toDate ? item.createdAt.toDate() : new Date(item.createdAt.seconds * 1000);
        return itemDate >= businessStart;
      });

      setSolicitudes(filtradosPorFecha);
    } catch (err) {
      console.error("Error al cargar solicitudes de cuenta:", err);
      showToast("Error al cargar el historial de solicitudes", "danger");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    cargarSolicitudes();
  }, []);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const marcarComoAtendida = async (id) => {
    try {
      const docRef = doc(db, 'mesa_pedidos', id);
      const snap = await getDoc(docRef);
      if (snap.exists()) {
        const alertData = snap.data();
        const alertMesaId = alertData.mesaId;
        const alertCliente = alertData.cliente || '';
        
        // Liquidar la cuenta activa en Firestore
        await actualizarCuentasFirestore(prev => prev.filter(c => {
          const tieneMesa = alertMesaId && alertMesaId !== 0 && alertMesaId !== '0';
          if (tieneMesa) {
            return String(c.mesaId) !== String(alertMesaId);
          } else {
            const cName = (c.cliente || '').trim().toLowerCase();
            const aName = alertCliente.trim().toLowerCase();
            return cName !== aName;
          }
        }));

        // Si es una mesa física, liberarla
        const tieneMesaFisica = alertMesaId && alertMesaId !== 0 && alertMesaId !== '0';
        if (tieneMesaFisica) {
          setMesas(prev => prev.map(m => {
            if (String(m.id) === String(alertMesaId)) {
              return { ...m, estado: 'libre', cliente: null, inicio: null, socios: false, clienteUid: '', preTicketImpreso: false, reservadaAt: null, limiteReservaMs: null, telefono: '', filaId: null };
            }
            return m;
          }));
        }

        // Registrar evento
        registrarEvento('Cuenta Atendida', `Cuenta de ${alertCliente} liquidada automáticamente desde el panel de solicitudes.`);
      }

      await updateDoc(docRef, {
        atendidoAdmin: true,
        atendidoMesero: true,
        estado: 'entregado',
        atendidoAt: serverTimestamp()
      });
      showToast("Solicitud atendida y cuenta liquidada ✓", "success");
      setSolicitudes(prev => prev.map(s => s.id === id ? { ...s, atendidoAdmin: true, atendidoMesero: true } : s));
    } catch (err) {
      console.error("Error al atender solicitud:", err);
      showToast("No se pudo actualizar la solicitud", "danger");
    }
  };

  const iniciarCobroRapido = (solicitud) => {
    if (setNuevoMonto) setNuevoMonto(String(solicitud.totalAcumulado || 0));
    if (setNuevaDesc) setNuevaDesc(`Cobro Cuenta Directa - ${solicitud.cliente || `Mesa ${solicitud.mesaId}`}`);
    if (setAlertaCobroAsociadaId) setAlertaCobroAsociadaId(solicitud.id);
    if (setAlertaClienteAsoc) setAlertaClienteAsoc(solicitud.cliente || '');
    if (setAlertaMesaIdAsoc) setAlertaMesaIdAsoc(solicitud.mesaId || null);
    onClose();
    if (setMostrarCobroManual) setMostrarCobroManual(true);
    showToast("Cobro manual directo cargado ✓", "info");
  };

  const determinarSolicitante = (alerta) => {
    const etiqueta = (alerta.etiqueta || '').toLowerCase();
    if (etiqueta.includes('caja') || etiqueta.includes('mesero') || alerta.atendidoMesero) {
      return { tipo: 'Mesero', icon: '👤', badgeClass: 'badge-bronze', color: 'var(--bronze-light)' };
    }
    if (etiqueta.includes('solicitud') || alerta.icono === '💳') {
      return { tipo: 'Cliente (QR)', icon: '📱', badgeClass: 'badge-success', color: 'var(--success)' };
    }
    return { tipo: 'Cliente (QR)', icon: '📱', badgeClass: 'badge-success', color: 'var(--success)' };
  };

  const filtradas = solicitudes.filter(s => {
    // Filtro por tab
    if (filtroTab === 'pendientes' && s.atendidoAdmin) return false;
    if (filtroTab === 'atendidas' && !s.atendidoAdmin) return false;

    // Filtro por sub-clasificación (Con Mesa / Sin Mesa)
    const tieneMesaFisica = s.mesaId && s.mesaId !== 0 && s.mesaId !== '0';
    if (subFiltroMesa === 'con_mesa' && !tieneMesaFisica) return false;
    if (subFiltroMesa === 'sin_mesa' && tieneMesaFisica) return false;

    // Filtro por búsqueda
    if (busqueda.trim() !== '') {
      const term = busqueda.toLowerCase();
      const matchCliente = (s.cliente || '').toLowerCase().includes(term);
      const matchMesa = String(s.mesaId || '').includes(term);
      const matchEtiqueta = (s.etiqueta || '').toLowerCase().includes(term);
      return matchCliente || matchMesa || matchEtiqueta;
    }

    return true;
  });

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 750, width: '90%' }} onClick={e => e.stopPropagation()}>
        <div className="modal-header" style={{ borderBottom: '1px solid var(--border-bronze)' }}>
          <span className="modal-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <i className="ri-wallet-3-line" style={{ color: 'var(--bronze-light)', fontSize: 18 }} />
            Cuentas Solicitadas
          </span>
          <button onClick={onClose} className="btn-icon btn btn-secondary" style={{ background: 'none', border: 'none' }}>
            <i className="ri-close-line" style={{ fontSize: 20 }} />
          </button>
        </div>

        <div className="modal-body" style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Fila superior: Filtros de estado y buscador */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                className={`btn btn-xs ${filtroTab === 'todas' ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setFiltroTab('todas')}
              >
                Todas ({solicitudes.length})
              </button>
              <button
                className={`btn btn-xs ${filtroTab === 'pendientes' ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setFiltroTab('pendientes')}
                style={{
                  borderColor: filtroTab !== 'pendientes' ? 'rgba(239, 68, 68, 0.3)' : '',
                  color: filtroTab !== 'pendientes' ? '#ef4444' : ''
                }}
              >
                Pendientes ({solicitudes.filter(s => !s.atendidoAdmin).length})
              </button>
              <button
                className={`btn btn-xs ${filtroTab === 'atendidas' ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setFiltroTab('atendidas')}
              >
                Atendidas ({solicitudes.filter(s => s.atendidoAdmin).length})
              </button>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, maxWidth: 300 }}>
              <input
                type="text"
                placeholder="Buscar por cliente o mesa..."
                value={busqueda}
                onChange={e => setBusqueda(e.target.value)}
                className="form-control"
                style={{ height: 26, fontSize: 11, padding: '4px 8px' }}
              />
              {busqueda && (
                <button className="btn btn-secondary btn-xs" onClick={() => setBusqueda('')} style={{ height: 26 }}>
                  Limpiar
                </button>
              )}
            </div>
          </div>

          {/* Sub-filtros para clasificar Con Mesa vs Sin Mesa */}
          <div style={{
            display: 'flex',
            gap: 6,
            background: 'rgba(255, 255, 255, 0.02)',
            border: '1px solid rgba(255, 255, 255, 0.05)',
            borderRadius: 6,
            padding: '4px 8px',
            alignSelf: 'flex-start',
            alignItems: 'center'
          }}>
            <span style={{ fontSize: 10, color: 'var(--text-muted)', marginRight: 4, fontWeight: 600 }}>Filtro de mesa:</span>
            <button
              className={`btn btn-xs ${subFiltroMesa === 'todos' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setSubFiltroMesa('todos')}
              style={{ fontSize: 9, padding: '2px 8px', height: 20 }}
            >
              Todas las Cuentas
            </button>
            <button
              className={`btn btn-xs ${subFiltroMesa === 'con_mesa' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setSubFiltroMesa('con_mesa')}
              style={{ fontSize: 9, padding: '2px 8px', height: 20 }}
            >
              🎱 Con Mesa Física
            </button>
            <button
              className={`btn btn-xs ${subFiltroMesa === 'sin_mesa' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setSubFiltroMesa('sin_mesa')}
              style={{ fontSize: 9, padding: '2px 8px', height: 20 }}
            >
              👤 Sin Mesa (Directa/Barra)
            </button>
          </div>

          {loading ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: '40px 0', color: 'var(--text-muted)' }}>
              <i className="ri-loader-4-line ri-spin" style={{ fontSize: 24, marginRight: 8 }} />
              Cargando historial de solicitudes...
            </div>
          ) : filtradas.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '30px 10px', border: '1px dashed var(--border)', borderRadius: 8, color: 'var(--text-muted)' }}>
              <i className="ri-inbox-line" style={{ fontSize: 28, marginBottom: 8, display: 'block' }} />
              <span>No se encontraron solicitudes de cuenta con el filtro aplicado.</span>
            </div>
          ) : (
            <div style={{ maxHeight: 350, overflowY: 'auto', border: '1px solid var(--border-bronze)', borderRadius: 8 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, textAlign: 'left' }}>
                <thead>
                  <tr style={{ background: 'rgba(255,255,255,0.02)', borderBottom: '1px solid var(--border-bronze)' }}>
                    <th style={{ padding: '10px 12px', color: 'var(--text-muted)', fontWeight: 600 }}>Mesa</th>
                    <th style={{ padding: '10px 12px', color: 'var(--text-muted)', fontWeight: 600 }}>Cliente</th>
                    <th style={{ padding: '10px 12px', color: 'var(--text-muted)', fontWeight: 600 }}>Solicitado Por</th>
                    <th style={{ padding: '10px 12px', color: 'var(--text-muted)', fontWeight: 600 }}>Hora</th>
                    <th style={{ padding: '10px 12px', color: 'var(--text-muted)', fontWeight: 600, textAlign: 'right' }}>Total Estimado</th>
                    <th style={{ padding: '10px 12px', color: 'var(--text-muted)', fontWeight: 600, textAlign: 'center' }}>Estado / Acción</th>
                  </tr>
                </thead>
                <tbody>
                  {filtradas.map(s => {
                    const solicitante = determinarSolicitante(s);
                    let horaStr = 'N/A';
                    if (s.createdAt) {
                      const t = s.createdAt.toDate ? s.createdAt.toDate() : new Date(s.createdAt.seconds * 1000);
                      horaStr = t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                    }
                    
                    return (
                      <tr key={s.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.03)', transition: 'background 0.15s' }}>
                        <td style={{ padding: '8px 12px', fontWeight: 'bold' }}>
                          {s.mesaId && s.mesaId !== 0 && s.mesaId !== '0' ? (
                            <span style={{ color: 'var(--bronze-light)' }}>Mesa {s.mesaId}</span>
                          ) : (
                            <span style={{ color: 'var(--text-muted)', fontStyle: 'italic', fontWeight: '500' }}>Sin Mesa</span>
                          )}
                        </td>
                        <td style={{ padding: '8px 12px' }}>{s.cliente || 'Mesa ' + s.mesaId}</td>
                        <td style={{ padding: '8px 12px' }}>
                          <span className={`badge ${solicitante.badgeClass}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 6px', fontSize: 9 }}>
                            {solicitante.icon} {solicitante.tipo}
                          </span>
                        </td>
                        <td style={{ padding: '8px 12px', color: 'var(--text-muted)' }}>{horaStr}</td>
                        <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 600 }}>
                          ${(s.totalAcumulado || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </td>
                        <td style={{ padding: '8px 12px', textAlign: 'center' }}>
                          {s.atendidoAdmin ? (
                            <span style={{ color: 'var(--success)', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 3 }}>
                              <i className="ri-checkbox-circle-fill" /> Atendida
                            </span>
                          ) : (
                            <div style={{ display: 'flex', gap: 6, justifyContent: 'center' }}>
                              <button
                                onClick={() => iniciarCobroRapido(s)}
                                className="btn btn-primary btn-xs"
                                style={{
                                  padding: '2px 6px',
                                  fontSize: 9,
                                  background: '#22c55e',
                                  borderColor: '#22c55e',
                                  color: '#000',
                                  fontWeight: 'bold',
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: 3
                                }}
                                title="Cobrar cuenta en caja"
                              >
                                <i className="ri-money-dollar-circle-line" /> Cobrar
                              </button>
                              <button
                                onClick={() => marcarComoAtendida(s.id)}
                                className="btn btn-danger btn-xs"
                                style={{ padding: '2px 6px', fontSize: 9 }}
                              >
                                <i className="ri-check-line" /> Atender
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
        
        <div className="modal-footer" style={{ borderTop: '1px solid var(--border-bronze)', display: 'flex', justifyContent: 'space-between', padding: '12px 20px' }}>
          <span style={{ fontSize: 10, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 4 }}>
            <i className="ri-information-line" /> Muestra las solicitudes de hoy para control de caja.
          </span>
          <button className="btn btn-secondary btn-sm" onClick={cargarSolicitudes}>
            <i className="ri-refresh-line" /> Actualizar
          </button>
        </div>
      </div>
    </div>
  );
}

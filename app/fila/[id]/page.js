'use client';

import { useEffect, useState, useRef } from 'react';
import { useParams } from 'next/navigation';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase';

export default function FilaEsperaCliente() {
  const params = useParams();
  const id = params?.id;
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [alerting, setAlerting] = useState(false);
  const audioCtxRef = useRef(null);
  const beepIntervalRef = useRef(null);

  useEffect(() => {
    if (!id) return;

    const unsub = onSnapshot(doc(db, 'fila_espera', String(id)), (docSnap) => {
      setLoading(false);
      if (docSnap.exists()) {
        const docData = docSnap.data();
        setData(docData);
        if (docData.estado === 'asignada') {
          setAlerting(true);
        }
      } else {
        setData(null);
      }
    });

    return () => unsub();
  }, [id]);

  // Alerta sonora y de vibración
  useEffect(() => {
    if (alerting) {
      if (typeof window !== 'undefined' && window.navigator && window.navigator.vibrate) {
        window.navigator.vibrate([300, 200, 300, 200, 500]);
        const vibrateInterval = setInterval(() => {
          window.navigator.vibrate([300, 200, 300, 200, 500]);
        }, 2000);
        return () => clearInterval(vibrateInterval);
      }
    }
  }, [alerting]);

  useEffect(() => {
    if (alerting) {
      try {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (AudioContext) {
          const ctx = new AudioContext();
          audioCtxRef.current = ctx;

          const playBeep = () => {
            if (ctx.state === 'suspended') {
              ctx.resume();
            }
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(880, ctx.currentTime); // A5 note
            gain.gain.setValueAtTime(0, ctx.currentTime);
            gain.gain.linearRampToValueAtTime(0.5, ctx.currentTime + 0.05);
            gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.4);
            
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start();
            osc.stop(ctx.currentTime + 0.4);
          };

          playBeep();
          beepIntervalRef.current = setInterval(playBeep, 1000);
        }
      } catch (err) {
        console.error("Error al iniciar Web Audio API:", err);
      }
    } else {
      if (beepIntervalRef.current) {
        clearInterval(beepIntervalRef.current);
        beepIntervalRef.current = null;
      }
      if (audioCtxRef.current) {
        audioCtxRef.current.close();
        audioCtxRef.current = null;
      }
    }

    return () => {
      if (beepIntervalRef.current) clearInterval(beepIntervalRef.current);
      if (audioCtxRef.current) audioCtxRef.current.close();
    };
  }, [alerting]);

  const handleStopAlert = () => {
    setAlerting(false);
    if (typeof window !== 'undefined' && window.navigator && window.navigator.vibrate) {
      window.navigator.vibrate(0);
    }
  };

  if (loading) {
    return (
      <div className="client-container" style={containerStyle}>
        <div style={{ fontSize: 32, marginBottom: 16, animation: 'spin 1.8s linear infinite' }}>🔄</div>
        <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)' }}>Cargando estado de tu turno...</div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="client-container" style={containerStyle}>
        <div style={{ fontSize: 64, marginBottom: 20 }}>⚠️</div>
        <h2 style={titleStyle}>Turno No Encontrado</h2>
        <p style={textStyle}>
          El turno solicitado no existe o ya fue retirado de la lista de espera. Por favor solicita tu registro nuevamente en caja.
        </p>
      </div>
    );
  }

  return (
    <div className="client-container" style={containerStyle}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600;800&display=swap');
        @keyframes pulse {
          0% { transform: scale(1); box-shadow: 0 0 0 0 rgba(197, 168, 128, 0.4); }
          70% { transform: scale(1.05); box-shadow: 0 0 0 15px rgba(197, 168, 128, 0); }
          100% { transform: scale(1); box-shadow: 0 0 0 0 rgba(197, 168, 128, 0); }
        }
        @keyframes pulseAlert {
          0% { transform: scale(1); box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.5); }
          70% { transform: scale(1.08); box-shadow: 0 0 0 20px rgba(239, 68, 68, 0); }
          100% { transform: scale(1); box-shadow: 0 0 0 0 rgba(239, 68, 68, 0); }
        }
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>

      {data.estado === 'asignada' ? (
        <div style={alertCardStyle}>
          <div style={{ fontSize: 72, marginBottom: 16, animation: 'pulseAlert 1.5s infinite' }}>🔔</div>
          <h1 style={{ ...titleStyle, color: '#ef4444', fontSize: 28, fontWeight: 800 }}>¡TU MESA ESTÁ LISTA!</h1>
          
          <div style={mesaBadgeStyle}>
            {data.mesaAsignada || 'Mesa Listada'}
          </div>

          <p style={{ ...textStyle, fontSize: 16, color: '#fff', fontWeight: 600, marginBottom: 24 }}>
            ¡Hola, {data.cliente}! Dirígete a la recepción o habla con el personal para tomar tu mesa asignada.
          </p>

          <button onClick={handleStopAlert} style={alertButtonStyle}>
            Detener Alerta
          </button>
        </div>
      ) : data.estado === 'retirado' ? (
        <div style={cardStyle}>
          <div style={{ fontSize: 64, marginBottom: 20 }}>🚶‍♂️</div>
          <h2 style={{ ...titleStyle, color: '#718096' }}>Turno Retirado</h2>
          <p style={textStyle}>
            Tu turno en la fila virtual ha sido retirado por el personal. Si necesitas una mesa, por favor solicita un nuevo turno en la caja.
          </p>
        </div>
      ) : (
        <div style={cardStyle}>
          <div style={{ fontSize: 64, marginBottom: 20, animation: 'pulse 2s infinite', borderRadius: '50%', background: 'rgba(197, 168, 128, 0.1)', padding: 12, display: 'inline-block' }}>⏳</div>
          <h2 style={titleStyle}>Estás en Fila de Espera</h2>
          <div style={positionBadgeStyle}>
            Turno: #{data.id ? String(data.id).slice(-4) : 'Espera'}
          </div>
          
          <div style={detailsContainerStyle}>
            <div style={detailRowStyle}>
              <span style={detailLabelStyle}>Cliente:</span>
              <span style={detailValueStyle}>{data.cliente}</span>
            </div>
            <div style={detailRowStyle}>
              <span style={detailLabelStyle}>Mesa:</span>
              <span style={detailValueStyle}>{data.tipo}</span>
            </div>
            <div style={detailRowStyle}>
              <span style={detailLabelStyle}>Personas:</span>
              <span style={detailValueStyle}>{data.personas}</span>
            </div>
          </div>

          <p style={{ ...textStyle, marginTop: 16, fontSize: 13 }}>
            Mantén esta página abierta. Te llegará una notificación de sonido y vibración cuando tu mesa esté lista.
          </p>
        </div>
      )}
    </div>
  );
}

const containerStyle = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  minHeight: '100dvh',
  padding: 24,
  background: '#0a0a0f',
  color: '#fff',
  fontFamily: "'Outfit', 'Inter', sans-serif"
};

const cardStyle = {
  background: 'rgba(20, 20, 28, 0.65)',
  border: '1px solid rgba(197, 168, 128, 0.15)',
  borderRadius: 24,
  padding: '32px 24px',
  width: '100%',
  maxWidth: 380,
  textAlign: 'center',
  backdropFilter: 'blur(10px)',
  boxShadow: '0 8px 32px 0 rgba(0, 0, 0, 0.37)'
};

const alertCardStyle = {
  background: 'rgba(30, 10, 10, 0.85)',
  border: '2px solid #ef4444',
  borderRadius: 28,
  padding: '40px 24px',
  width: '100%',
  maxWidth: 380,
  textAlign: 'center',
  backdropFilter: 'blur(16px)',
  boxShadow: '0 0 30px rgba(239, 68, 68, 0.25)'
};

const titleStyle = {
  fontSize: 22,
  fontWeight: 800,
  color: '#c5a880',
  marginBottom: 16,
  letterSpacing: '0.02em'
};

const textStyle = {
  fontSize: 14,
  color: 'rgba(255, 255, 255, 0.7)',
  lineHeight: 1.6,
  margin: '12px 0'
};

const positionBadgeStyle = {
  display: 'inline-block',
  background: 'linear-gradient(135deg, #c5a880, #967a57)',
  color: '#0a0a0f',
  padding: '6px 16px',
  borderRadius: 20,
  fontWeight: 800,
  fontSize: 14,
  marginBottom: 20,
  letterSpacing: '0.05em'
};

const mesaBadgeStyle = {
  display: 'inline-block',
  background: '#ef4444',
  color: '#fff',
  padding: '8px 24px',
  borderRadius: 12,
  fontWeight: 900,
  fontSize: 22,
  marginBottom: 20,
  boxShadow: '0 4px 12px rgba(239, 68, 68, 0.3)'
};

const detailsContainerStyle = {
  background: 'rgba(255, 255, 255, 0.03)',
  border: '1px solid rgba(255, 255, 255, 0.05)',
  borderRadius: 16,
  padding: '16px 20px',
  width: '100%',
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  textAlign: 'left'
};

const detailRowStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  fontSize: 13
};

const detailLabelStyle = {
  color: 'rgba(255, 255, 255, 0.4)'
};

const detailValueStyle = {
  color: '#fff',
  fontWeight: 600
};

const alertButtonStyle = {
  background: '#ef4444',
  color: '#fff',
  border: 'none',
  padding: '12px 24px',
  borderRadius: 16,
  fontWeight: 800,
  fontSize: 14,
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  width: '100%',
  transition: 'all 0.2s ease',
  boxShadow: '0 4px 12px rgba(239, 68, 68, 0.2)'
};

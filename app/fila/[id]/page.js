'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { doc, onSnapshot, collection, addDoc, serverTimestamp, query, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';

export default function FilaEsperaCliente() {
  const params = useParams();
  const id = params?.id;
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [alerting, setAlerting] = useState(false);
  const [posicionGeneral, setPosicionGeneral] = useState(null);
  const [posicionTipo, setPosicionTipo] = useState(null);
  const audioCtxRef = useRef(null);
  const beepIntervalRef = useRef(null);

  const [notificationPermission, setNotificationPermission] = useState('default');
  const swRegistrationRef = useRef(null);
  const [isSupported, setIsSupported] = useState(true);
  const beepCountRef = useRef(0);

  const [alertFrequency, setAlertFrequency] = useState(880);
  const alertStartedAtRef = useRef(null);

  const guardarLogAlerta = useCallback(async (tipo) => {
    if (!alertStartedAtRef.current) return;
    const duracion = Math.round((Date.now() - alertStartedAtRef.current) / 1000);
    alertStartedAtRef.current = null; // reset
    try {
      await addDoc(collection(db, 'alertas_digitales_log'), {
        tipo,
        filaId: id || '',
        mesaId: data?.mesaAsignada || '',
        cliente: data?.cliente || 'Cliente',
        duracionSegundos: duracion,
        createdAt: serverTimestamp()
      });
      console.log("Log de alerta guardado con éxito. Duración:", duracion);
    } catch (e) {
      console.error("Error al guardar log de alerta:", e);
    }
  }, [id, data]);

  const probarAlerta = () => {
    if (typeof window !== 'undefined' && window.navigator && window.navigator.vibrate) {
      window.navigator.vibrate(100);
    }
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (AudioContext) {
        const ctx = new AudioContext();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(alertFrequency, ctx.currentTime);
        gain.gain.setValueAtTime(0, ctx.currentTime);
        gain.gain.linearRampToValueAtTime(0.3, ctx.currentTime + 0.05);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.2);
        
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.2);
        
        setTimeout(() => ctx.close(), 500);
      }
    } catch (e) {
      console.warn("Error al probar sonido:", e);
    }
  };

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const supported = ('Notification' in window) && ('serviceWorker' in navigator);
      setIsSupported(supported);
    }

    if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js')
        .then((reg) => {
          swRegistrationRef.current = reg;
          console.log("Service Worker registrado con éxito:", reg.scope);
        })
        .catch((err) => {
          console.error("Error al registrar el Service Worker:", err);
        });
    }

    if (typeof window !== 'undefined' && 'Notification' in window) {
      setNotificationPermission(Notification.permission);
    }
  }, []);

  const requestNotificationPermission = () => {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      Notification.requestPermission().then((permission) => {
        setNotificationPermission(permission);
        if (permission === 'granted') {
          if (swRegistrationRef.current) {
            swRegistrationRef.current.showNotification("Notificaciones Activas 🔔", {
              body: "Recibirás una alerta en este dispositivo cuando tu mesa esté lista.",
              icon: "/icon.png",
              tag: "test-notification"
            });
          }
        }
      });
    }
  };

  // Disparar notificación del sistema cuando se activa la alerta de forma periódica para sonido/vibración constante en segundo plano
  useEffect(() => {
    let systemAlertInterval = null;
    if (alerting) {
      const triggerNotification = () => {
        if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
          if (swRegistrationRef.current) {
            const assignedTime = data?.assignedAt ? (data.assignedAt.toMillis ? data.assignedAt.toMillis() : data.assignedAt) : Date.now();
            const elapsedSeconds = Math.floor((Date.now() - assignedTime) / 1000);
            const isCritical = elapsedSeconds > 120; // Más de 2 minutos sin reclamar la mesa

            const titleText = isCritical ? "⚠️ ¡MESA POR EXPIRAR! 🔔" : "¡TU MESA ESTÁ LISTA! 🔔";
            const bodyText = isCritical
              ? `¡URGENTE! Hola, ${data?.cliente || 'Cliente'}. Tu mesa asignada es la ${data?.mesaAsignada || ''}. Dirígete a recepción ya o se liberará.`
              : `Hola, ${data?.cliente || 'Cliente'}. Tu mesa asignada es la ${data?.mesaAsignada || ''}. Dirígete al personal.`;

            const vibratePattern = isCritical
              ? [1000, 100, 1000, 100, 1000, 100, 1000, 100, 1000] // Vibración larga y urgente
              : [500, 200, 500, 200, 800]; // Vibración normal

            swRegistrationRef.current.showNotification(titleText, {
              body: bodyText,
              icon: "/icon.png",
              vibrate: vibratePattern,
              tag: "mesa-lista",
              renotify: true,
              requireInteraction: true,
              actions: [
                { action: 'silenciar', title: '🔇 Silenciar Alarma' }
              ]
            });
          }
        }
      };

      triggerNotification();

      // Repetir cada 8 segundos para emular una alarma constante
      systemAlertInterval = setInterval(triggerNotification, 8000);
    }

    return () => {
      if (systemAlertInterval) {
        clearInterval(systemAlertInterval);
      }
    };
  }, [alerting, data]);

  // Escuchar mensajes del Service Worker para silenciar la alarma
  useEffect(() => {
    if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
      const handleSWMessage = (event) => {
        if (event.data && event.data.type === 'SILENCE_ALERT') {
          console.log("Alarma silenciada desde la notificación de sistema.");
          guardarLogAlerta('fila_espera_asignada');
          setAlerting(false);
          beepCountRef.current = 0;
          if (typeof window !== 'undefined' && window.navigator && window.navigator.vibrate) {
            window.navigator.vibrate(0);
          }
        }
      };

      navigator.serviceWorker.addEventListener('message', handleSWMessage);
      return () => {
        navigator.serviceWorker.removeEventListener('message', handleSWMessage);
      };
    }
  }, [guardarLogAlerta]);

  useEffect(() => {
    if (!id) return;

    const unsub = onSnapshot(
      doc(db, 'fila_espera', String(id)),
      (docSnap) => {
        setLoading(false);
        if (docSnap.exists()) {
          const docData = docSnap.data();
          setData(docData);
          if (docData.estado === 'asignada') {
            if (!alerting) {
              alertStartedAtRef.current = Date.now();
            }
            setAlerting(true);
          }
        } else {
          setData(null);
        }
      },
      (error) => {
        console.error("Error al escuchar fila_espera:", error);
        setLoading(false);
        setData(null);
      }
    );

    return () => unsub();
  }, [id]);

  // Escuchar toda la fila en espera para calcular la posición en tiempo real
  useEffect(() => {
    if (!id || !data || data.estado !== 'espera') {
      setPosicionGeneral(null);
      setPosicionTipo(null);
      return;
    }

    const q = query(
      collection(db, 'fila_espera'),
      where('estado', '==', 'espera')
    );

    const unsub = onSnapshot(q, (snap) => {
      const items = snap.docs.map(d => {
        const val = d.data();
        return {
          ...val,
          id: d.id
        };
      });

      // Ordenar por registro (FIFO)
      items.sort((a, b) => (a.registro || 0) - (b.registro || 0));

      // 1. Posición General
      const idxGeneral = items.findIndex(item => String(item.id) === String(id));
      if (idxGeneral !== -1) {
        setPosicionGeneral(idxGeneral + 1);

        // 2. Posición por Tipo (filtrando por el tipo de mesa de este cliente)
        const tipoCliente = data.tipo;
        const itemsMismoTipo = items.filter(item => item.tipo === tipoCliente);
        const idxTipo = itemsMismoTipo.findIndex(item => String(item.id) === String(id));
        setPosicionTipo(idxTipo !== -1 ? idxTipo + 1 : null);
      } else {
        setPosicionGeneral(null);
        setPosicionTipo(null);
      }
    }, (error) => {
      console.error("Error al escuchar la fila general:", error);
    });

    return () => unsub();
  }, [id, data]);

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
          beepCountRef.current = 0;

          const playBeep = () => {
            if (ctx.state === 'suspended') {
              ctx.resume();
            }
            beepCountRef.current += 1;
            const targetVol = Math.min(0.5, 0.1 + (beepCountRef.current - 1) * 0.1);

            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(alertFrequency, ctx.currentTime);
            gain.gain.setValueAtTime(0, ctx.currentTime);
            gain.gain.linearRampToValueAtTime(targetVol, ctx.currentTime + 0.05);
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
  }, [alerting, alertFrequency]);

  const handleStopAlert = () => {
    guardarLogAlerta('fila_espera_asignada');
    setAlerting(false);
    beepCountRef.current = 0;
    if (typeof window !== 'undefined' && window.navigator && window.navigator.vibrate) {
      window.navigator.vibrate(0);
    }
    if (swRegistrationRef.current && swRegistrationRef.current.getNotifications) {
      swRegistrationRef.current.getNotifications().then((notifications) => {
        notifications.forEach((n) => n.close());
      }).catch((err) => console.warn(err));
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
            {data.motivoRetiro === 'timeout' 
              ? 'Tu turno en la fila virtual ha sido retirado automáticamente por inasistencia (tolerancia de 5 min agotada).'
              : 'Tu turno en la fila virtual ha sido retirado por el personal. Si necesitas una mesa, por favor solicita un nuevo turno en la caja.'
            }
          </p>
        </div>
      ) : data.estado === 'completado' || data.estado === 'jugando' ? (
        <div style={cardStyle}>
          <div style={{ fontSize: 64, marginBottom: 20 }}>🎮</div>
          <h2 style={{ ...titleStyle, color: '#22c55e' }}>¡A Jugar!</h2>
          <p style={textStyle}>
            ¡Tu turno ha sido asignado con éxito! Tu mesa asignada es la <strong>{data.mesaAsignada}</strong>. ¡Que disfrutes tu juego!
          </p>
        </div>
      ) : (
        <div style={cardStyle}>
          {isSupported && notificationPermission === 'default' && (
            <div style={permissionBannerStyle}>
              <span style={{ fontSize: 22 }}>🔔</span>
              <div style={{ flex: 1, textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 2 }}>
                <div style={{ fontWeight: 800, fontSize: 13, color: '#fff' }}>Notificaciones Activas</div>
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)', lineHeight: 1.3 }}>Permite recibir alertas cuando tu mesa esté lista, incluso si bloqueas tu celular.</div>
              </div>
              <button onClick={requestNotificationPermission} style={permissionButtonStyle}>
                Activar
              </button>
            </div>
          )}
          {!isSupported && (
            <div style={{
              background: 'rgba(255, 255, 255, 0.02)',
              border: '1px solid rgba(255, 255, 255, 0.05)',
              borderRadius: 14,
              padding: '10px 14px',
              fontSize: 11,
              color: 'rgba(255, 255, 255, 0.4)',
              marginBottom: 20,
              textAlign: 'left'
            }}>
              ℹ️ Abre este enlace directamente en <strong>Safari</strong> o <strong>Chrome</strong> si deseas recibir notificaciones en segundo plano y pantalla bloqueada.
            </div>
          )}
          <div style={{ fontSize: 64, marginBottom: 20, animation: 'pulse 2s infinite', borderRadius: '50%', background: 'rgba(197, 168, 128, 0.1)', padding: 12, display: 'inline-block' }}>⏳</div>
          <h2 style={titleStyle}>Estás en Fila de Espera</h2>
          <div style={positionBadgeStyle}>
            Turno: #{data.id ? String(data.id).slice(-4) : 'Espera'}
          </div>

          {posicionGeneral !== null && (
            <div style={{
              background: posicionGeneral === 1 ? 'rgba(34, 197, 94, 0.08)' : 'rgba(197, 168, 128, 0.08)',
              border: posicionGeneral === 1 ? '1.5px solid rgba(34, 197, 94, 0.3)' : '1.5px solid rgba(197, 168, 128, 0.3)',
              borderRadius: 20,
              padding: '16px 24px',
              marginBottom: 20,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 4,
              boxShadow: '0 4px 20px rgba(0,0,0,0.2)'
            }}>
              <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 600 }}>Posición en Fila</span>
              <span style={{ fontSize: 44, fontWeight: 800, color: posicionGeneral === 1 ? '#22c55e' : '#c5a880', lineHeight: 1 }}>#{posicionGeneral}</span>
              {posicionGeneral === 1 ? (
                <span style={{ fontSize: 11, color: '#22c55e', marginTop: 4, fontWeight: 700 }}>¡Eres el siguiente! Prepárate.</span>
              ) : posicionTipo !== null && posicionTipo !== posicionGeneral ? (
                <span style={{ fontSize: 11, color: 'rgba(197, 168, 128, 0.8)', marginTop: 4, fontWeight: 500 }}>
                  (#{posicionTipo} para mesa tipo {data.tipo})
                </span>
              ) : null}
            </div>
          )}

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

          <div style={controlsContainerStyle}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
              <button onClick={probarAlerta} style={testButtonStyle}>
                🔊 Probar Alerta
              </button>
              <select 
                value={alertFrequency} 
                onChange={(e) => setAlertFrequency(parseInt(e.target.value))}
                style={selectStyle}
              >
                <option value={440}>Tono Grave 🔉</option>
                <option value={880}>Tono Normal 🔔</option>
                <option value={1200}>Tono Agudo 🔊</option>
              </select>
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

const permissionBannerStyle = {
  background: 'rgba(197, 168, 128, 0.12)',
  border: '1px solid rgba(197, 168, 128, 0.3)',
  borderRadius: 16,
  padding: '12px 14px',
  marginBottom: 20,
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  textAlign: 'left'
};

const permissionButtonStyle = {
  background: '#c5a880',
  color: '#0a0a0f',
  border: 'none',
  padding: '8px 16px',
  borderRadius: 10,
  fontWeight: 800,
  fontSize: 12,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
  boxShadow: '0 2px 8px rgba(197, 168, 128, 0.2)'
};

const controlsContainerStyle = {
  background: 'rgba(255, 255, 255, 0.02)',
  border: '1px solid rgba(255, 255, 255, 0.05)',
  borderRadius: 14,
  padding: '10px 14px',
  marginTop: 14,
  width: '100%'
};

const testButtonStyle = {
  background: 'rgba(197, 168, 128, 0.1)',
  border: '1px solid rgba(197, 168, 128, 0.25)',
  color: '#c5a880',
  padding: '6px 12px',
  borderRadius: 8,
  fontWeight: 600,
  fontSize: 12,
  cursor: 'pointer',
  flex: 1
};

const selectStyle = {
  background: '#14141c',
  border: '1px solid rgba(255, 255, 255, 0.08)',
  color: '#fff',
  padding: '6px 10px',
  borderRadius: 8,
  fontSize: 12,
  cursor: 'pointer',
  outline: 'none',
  flex: 1
};

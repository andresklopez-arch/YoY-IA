'use client';
import { useState, useEffect, useRef } from 'react';
import { useAuth } from '@/lib/auth-context';
import { db } from '@/lib/firebase';
import { collection, getDocs, query, orderBy, addDoc } from 'firebase/firestore';
import { getClientDomain, getAmbassadorName, getAppLogoPath } from '@/lib/tenant';
import { obfuscateStatic, deobfuscateStatic } from '@/lib/crypto';
import { getActiveSalonId } from '@/lib/firestore-tenant';



export default function LoginScreen({ showToast }) {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPass, setShowPass] = useState(false);
  const [loginMethod, setLoginMethod] = useState('correo'); // 'correo' o 'nip'
  const [nip, setNip] = useState('');
  const [usersList, setUsersList] = useState([]);
  const [selectedEmail, setSelectedEmail] = useState('');
  const [manualEmail, setManualEmail] = useState(false);
  const [redirectReason, setRedirectReason] = useState(null);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      try {
        const reason = sessionStorage.getItem('yoy_auth_redirect_reason');
        if (reason) {
          setRedirectReason(reason);
          sessionStorage.removeItem('yoy_auth_redirect_reason');
        }
      } catch (e) {}
    }
  }, []);

  // Lockout States
  const [intentosRestantes, setIntentosRestantes] = useState(3);
  const [bloqueado, setBloqueado] = useState(false);
  const [segundosBloqueo, setSegundosBloqueo] = useState(0);
  const [modalError, setModalError] = useState(null); // { titulo, mensaje, intentos }
  const passwordRef = useRef(null);
  const nipRef = useRef(null);

  const cerrarModalError = () => {
    setModalError(null);
    setTimeout(() => {
      if (loginMethod === 'nip') {
        nipRef.current?.focus();
        nipRef.current?.select();
      } else {
        passwordRef.current?.focus();
        passwordRef.current?.select();
      }
    }, 50);
  };

  // Check for active lockout in localStorage on mount
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const lockoutUntil = localStorage.getItem('yoy_lockout_until');
      if (lockoutUntil) {
        const remainingMs = parseInt(lockoutUntil, 10) - Date.now();
        if (remainingMs > 0) {
          const secs = Math.ceil(remainingMs / 1000);
          setBloqueado(true);
          setSegundosBloqueo(secs);
          setIntentosRestantes(0);
          setModalError({
            titulo: 'Acceso Bloqueado',
            mensaje: `El acceso a esta terminal sigue bloqueado temporalmente por seguridad.`,
            intentos: 0
          });
        } else {
          localStorage.removeItem('yoy_lockout_until');
        }
      }
    }
  }, []);

  useEffect(() => {
    const fetchUsers = async () => {
      const activeSalonId = getActiveSalonId();
      let list = [{
        id: 'masteradmin_default',
        name: 'Administrador Maestro',
        email: 'masteradmin@yoybillar.mx',
        role: 'admin',
        alias: 'MasterAdmin',
        salonId: activeSalonId
      }];

      try {
        const res = await fetch('/api/auth/list-users', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ salonId: activeSalonId })
        });
        const data = await res.json();
        if (res.ok && data.success && Array.isArray(data.users)) {
          const apiUsers = data.users.filter(u => u.email !== 'masteradmin@yoybillar.mx' && !u.email.startsWith('masteradmin@'));
          list = [...list, ...apiUsers];
        } else {
          console.warn("Fallo al cargar usuarios desde API del servidor:", data.error);
        }
      } catch (err) {
        console.error("Error fetching users for login screen:", err);
      }

      setUsersList(list);

      if (typeof window !== 'undefined') {
        const lastEmailEnc = localStorage.getItem('yoy_last_selected_email');
        const lastEmail = lastEmailEnc ? deobfuscateStatic(lastEmailEnc) : null;
        if (lastEmail && list.some(u => u.email === lastEmail)) {
          setSelectedEmail(lastEmail);
        } else {
          setSelectedEmail(list[0].email);
        }
      } else {
        setSelectedEmail(list[0].email);
      }
    };
    fetchUsers();
  }, []);

  // Web Audio API warning buzzer
  const playBuzzerSound = () => {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(120, ctx.currentTime);
      
      gain.gain.setValueAtTime(0.18, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.8);
      
      osc.connect(gain);
      gain.connect(ctx.destination);
      
      osc.start();
      osc.stop(ctx.currentTime + 0.8);
    } catch (err) {
      console.error("Fallo al reproducir zumbador de alerta:", err);
    }
  };

  // Log to Firestore audit log
  const logAccessAttempt = async (userEmail, method, exito, statusDetail) => {
    try {
      const clientDomain = getClientDomain();
      await addDoc(collection(db, 'auditoria_accesos'), {
        fecha: new Date(),
        usuario: userEmail || 'Desconocido',
        metodo: method,
        exito: exito,
        detalle: statusDetail,
        dominio: clientDomain,
        userAgent: typeof window !== 'undefined' ? window.navigator.userAgent : 'Server'
      });
    } catch (err) {
      console.error("Error al registrar auditoria de acceso:", err);
    }
  };

  // Countdown Timer Effect for Lockout
  useEffect(() => {
    if (segundosBloqueo > 0) {
      const timer = setInterval(() => {
        setSegundosBloqueo(prev => {
          if (prev <= 1) {
            clearInterval(timer);
            setBloqueado(false);
            setIntentosRestantes(3);
            if (typeof window !== 'undefined') {
              localStorage.removeItem('yoy_lockout_until');
            }
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
      return () => clearInterval(timer);
    }
  }, [segundosBloqueo]);

  // Interceptar teclas cuando el modal de error está activo para cerrarlo y re-enfocar
  useEffect(() => {
    if (!modalError) return;
    const handleKeyDown = (e) => {
      if (e.key === 'Enter' || e.key === 'Escape' || e.key === ' ') {
        e.preventDefault();
        cerrarModalError();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [modalError, loginMethod]);

  const handleLogin = async (e) => {
    e.preventDefault();
    if (modalError) {
      cerrarModalError();
      return;
    }
    if (bloqueado) {
      showToast(`Acceso bloqueado. Inténtalo de nuevo en ${segundosBloqueo} segundos.`, 'error');
      return;
    }
    setLoading(true);
    const targetEmail = loginMethod === 'nip' ? `NIP-${nip}` : (usersList.length > 0 && !manualEmail ? selectedEmail : email);
    
    try {
      if (loginMethod === 'nip') {
        if (!nip) {
          setLoading(false);
          return;
        }
        await login(nip, '');
      } else {
        if (!targetEmail || !password) {
          setLoading(false);
          return;
        }
        await login(targetEmail, password);
      }
      
      // Clear penalties on successful login
      if (typeof window !== 'undefined') {
        localStorage.removeItem('yoy_lockout_penalties');
        localStorage.removeItem('yoy_lockout_until');
        localStorage.setItem('yoy_last_selected_email', obfuscateStatic(targetEmail));
      }
      setIntentosRestantes(3);
      await logAccessAttempt(targetEmail, loginMethod, true, 'success');
      
    } catch (err) {
      if (loginMethod === 'nip') {
        setNip('');
      } else {
        setPassword('');
      }
      setIntentosRestantes(prev => {
        const nuevosIntentos = prev - 1;
        
        // Log access failure in firestore
        logAccessAttempt(targetEmail, loginMethod, false, nuevosIntentos <= 0 ? 'lockout' : 'incorrect_credentials');

        if (nuevosIntentos <= 0) {
          // Play sound
          playBuzzerSound();

          // Calculate exponential backoff duration
          let penalties = 0;
          if (typeof window !== 'undefined') {
            penalties = parseInt(localStorage.getItem('yoy_lockout_penalties') || '0', 10) + 1;
            localStorage.setItem('yoy_lockout_penalties', penalties.toString());
          } else {
            penalties = 1;
          }

          let durationSecs = 30; // default 1st
          if (penalties === 2) {
            durationSecs = 300; // 5 min
          } else if (penalties >= 3) {
            durationSecs = 900; // 15 min
          }

          const lockoutUntil = Date.now() + durationSecs * 1000;
          if (typeof window !== 'undefined') {
            localStorage.setItem('yoy_lockout_until', lockoutUntil.toString());
          }

          setBloqueado(true);
          setSegundosBloqueo(durationSecs);
          
          setModalError({
            titulo: 'Acceso Bloqueado',
            mensaje: `Has superado el límite de intentos permitidos. El acceso a esta terminal ha sido bloqueado temporalmente por ${durationSecs >= 60 ? (durationSecs / 60) + ' minutos' : durationSecs + ' segundos'}.`,
            intentos: 0
          });
          return 0;
        } else {
          setModalError({
            titulo: 'Credenciales Incorrectas',
            mensaje: 'El usuario o contraseña ingresados no son correctos. Por favor, verifica tus datos.',
            intentos: nuevosIntentos
          });
          return nuevosIntentos;
        }
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      minHeight: '100vh',
      background: 'radial-gradient(ellipse at 20% 50%, rgba(205,127,50,0.08) 0%, transparent 60%), radial-gradient(ellipse at 80% 20%, rgba(37,99,235,0.06) 0%, transparent 50%), var(--bg-base)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '24px',
      position: 'relative',
      overflow: 'hidden',
    }}>
      {/* Decorative grid background */}
      <div style={{
        position: 'absolute', inset: 0, opacity: 0.03,
        backgroundImage: 'linear-gradient(var(--bronze) 1px, transparent 1px), linear-gradient(90deg, var(--bronze) 1px, transparent 1px)',
        backgroundSize: '60px 60px',
        pointerEvents: 'none',
      }} />

      <div style={{ width: '100%', maxWidth: 400, position: 'relative', zIndex: 1 }}>
        {/* Login Card */}
        <div style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--border-bronze)',
          borderRadius: 20,
          padding: 32,
          boxShadow: 'var(--shadow-lg), 0 0 40px rgba(205,127,50,0.08)',
        }}>
          {/* Logotipo y Titulo de Sucursal */}
          <div style={{ textAlign: 'center', marginBottom: 24 }}>
            <img 
              src={getAppLogoPath()} 
              alt={"Logo " + getAmbassadorName()}
              style={{ 
                width: 90, 
                height: 90, 
                objectFit: 'contain', 
                borderRadius: '50%',
                margin: '0 auto 12px',
                display: 'block',
                boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
                border: '2px solid var(--border-bronze)'
              }}
            />
            <h2 style={{ fontSize: 20, fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 4px 0' }}>
              YoY IA Billar
            </h2>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0, fontWeight: 600 }}>
              By {getAmbassadorName()}
            </p>
          </div>

          <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {redirectReason && (
              <div style={{
                background: 'rgba(239, 68, 68, 0.1)',
                border: '1px solid rgba(239, 68, 68, 0.3)',
                padding: '10px 14px',
                borderRadius: 10,
                fontSize: 13,
                color: 'rgb(248, 113, 113)',
                textAlign: 'center',
                lineHeight: '1.4'
              }}>
                ⚠️ {redirectReason}
              </div>
            )}
            {usersList.length > 0 && !manualEmail ? (
              <div className="form-group">
                <label className="form-label">Selecciona tu Usuario</label>
                <select
                  className="form-select"
                  value={selectedEmail}
                  onChange={e => setSelectedEmail(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '12px 16px',
                    background: 'var(--bg-elevated)',
                    border: '1px solid var(--border-bronze)',
                    borderRadius: 10,
                    color: 'var(--text-main)',
                    fontSize: 14,
                    boxSizing: 'border-box',
                    outline: 'none',
                    cursor: 'pointer',
                    height: 46
                  }}
                >
                  {usersList.map(u => (
                    <option key={u.id} value={u.email} style={{ background: 'var(--bg-card)', color: 'var(--text-main)' }}>
                      {u.name} ({u.role ? u.role.toUpperCase() : 'PERSONAL'})
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <div className="form-group">
                <label className="form-label">Correo Electrónico</label>
                <input
                  className="form-input"
                  type="text"
                  placeholder={`usuario@${getClientDomain()}`}
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  required
                />
              </div>
            )}

            {usersList.length > 0 && (
              <button
                type="button"
                onClick={() => setManualEmail(p => !p)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--text-muted)',
                  cursor: 'pointer',
                  fontSize: 11,
                  alignSelf: 'flex-start',
                  padding: '0 4px',
                  marginTop: -8,
                  textDecoration: 'underline',
                  outline: 'none'
                }}
              >
                {manualEmail ? 'Seleccionar desde la lista' : 'Ingresar correo manualmente'}
              </button>
            )}

            <div className="form-group">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <label className="form-label">Contraseña</label>
                <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                  {password?.length || 0}/8
                </span>
              </div>
              <div style={{ position: 'relative' }}>
                <input
                  ref={passwordRef}
                  className="form-input"
                  type={showPass ? 'text' : 'password'}
                  placeholder="••••••••"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  maxLength={8}
                  style={{ paddingRight: 44 }}
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPass(p => !p)}
                  style={{
                    position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)',
                    background: 'none', border: 'none', color: 'var(--text-muted)',
                    cursor: 'pointer', fontSize: 16, padding: 4,
                  }}
                >
                  <i className={`ri-eye${showPass ? '-off' : ''}-line`} />
                </button>
              </div>
            </div>

            <button
              type="submit"
              className="btn btn-primary btn-lg"
              disabled={loading || bloqueado}
              style={{
                marginTop: 8,
                width: '100%',
                background: bloqueado ? 'rgba(239, 68, 68, 0.2)' : undefined,
                borderColor: bloqueado ? 'rgba(239, 68, 68, 0.3)' : undefined,
                color: bloqueado ? '#f87171' : undefined
              }}
            >
              {bloqueado ? (
                <><i className="ri-time-line" /> Bloqueado ({segundosBloqueo}s)</>
              ) : loading ? (
                <><i className="ri-loader-4-line animate-spin" /> Ingresando...</>
              ) : (
                <><i className="ri-login-circle-line" /> Ingresar al Sistema</>
              )}
            </button>
          </form>
        </div>

        <p style={{ textAlign: 'center', fontSize: 10, color: 'var(--text-muted)', marginTop: 20, letterSpacing: '0.1em' }}>
          YoY IA BILLAR By {getAmbassadorName()} v1.0 · Powered by IA
        </p>
      </div>

      {/* Modal de Error de Credenciales */}
      {modalError && (
        <div className="modal-overlay" style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999,
          backdropFilter: 'blur(4px)'
        }} onClick={cerrarModalError}>
          <div style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--border-bronze)',
            borderRadius: 16,
            width: '90%',
            maxWidth: 360,
            padding: 24,
            textAlign: 'center',
            boxShadow: 'var(--shadow-xl), 0 0 30px rgba(239, 68, 68, 0.15)',
            animation: 'fadeIn 0.2s ease-in-out'
          }} onClick={e => e.stopPropagation()}>
            <div style={{
              width: 50, height: 50, borderRadius: '50%',
              background: modalError.intentos === 0 ? 'rgba(239, 68, 68, 0.12)' : 'rgba(245, 158, 11, 0.12)',
              color: modalError.intentos === 0 ? '#ef4444' : '#f59e0b',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              margin: '0 auto 16px', fontSize: 24
            }}>
              <i className={modalError.intentos === 0 ? "ri-error-warning-line" : "ri-lock-password-line"} />
            </div>
            
            <h3 style={{
              margin: '0 0 10px', fontSize: 18, fontWeight: 700,
              color: modalError.intentos === 0 ? '#ef4444' : 'var(--bronze-light)'
            }}>
              {modalError.titulo}
            </h3>
            
            <p style={{
              margin: '0 0 20px', fontSize: 13, color: 'var(--text-secondary)',
              lineHeight: '1.5'
            }}>
              {modalError.mensaje}
            </p>
            
            {modalError.intentos > 0 ? (
              <div style={{
                background: 'rgba(255,255,255,0.03)',
                border: '1px solid var(--border)',
                borderRadius: 10,
                padding: '10px 14px',
                marginBottom: 20,
                fontSize: 12,
                color: 'var(--text-muted)'
              }}>
                Intentos restantes: <strong style={{ color: '#ef4444', fontSize: 14 }}>{modalError.intentos}</strong>
              </div>
            ) : (
              <div style={{
                background: 'rgba(239,68,68,0.05)',
                border: '1px solid rgba(239,68,68,0.2)',
                borderRadius: 10,
                padding: '10px 14px',
                marginBottom: 20,
                fontSize: 12,
                color: '#f87171',
                fontWeight: 600
              }}>
                Acceso bloqueado por 30 segundos.
              </div>
            )}
            
            <button
              className="btn btn-primary"
              style={{ width: '100%', padding: '10px 0' }}
              onClick={cerrarModalError}
            >
              Entendido
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

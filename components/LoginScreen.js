'use client';
import { useState, useEffect } from 'react';
import { useAuth } from '@/lib/auth-context';
import { db } from '@/lib/firebase';
import { collection, getDocs, query, orderBy } from 'firebase/firestore';
import { getClientDomain } from '@/lib/tenant';

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

  // Lockout States
  const [intentosRestantes, setIntentosRestantes] = useState(3);
  const [bloqueado, setBloqueado] = useState(false);
  const [segundosBloqueo, setSegundosBloqueo] = useState(0);
  const [modalError, setModalError] = useState(null); // { titulo, mensaje, intentos }

  useEffect(() => {
    const fetchUsers = async () => {
      try {
        const q = query(collection(db, 'users'), orderBy('name', 'asc'));
        const snap = await getDocs(q);
        const list = [];
        snap.forEach(doc => {
          list.push({ id: doc.id, ...doc.data() });
        });
        setUsersList(list);
        if (list.length > 0) {
          setSelectedEmail(list[0].email);
        }
      } catch (err) {
        console.error("Error fetching users for login screen:", err);
      }
    };
    fetchUsers();
  }, []);

  // Countdown Timer Effect for Lockout
  useEffect(() => {
    if (segundosBloqueo > 0) {
      const timer = setInterval(() => {
        setSegundosBloqueo(prev => {
          if (prev <= 1) {
            clearInterval(timer);
            setBloqueado(false);
            setIntentosRestantes(3);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
      return () => clearInterval(timer);
    }
  }, [segundosBloqueo]);

  const handleLogin = async (e) => {
    e.preventDefault();
    if (bloqueado) {
      showToast(`Acceso bloqueado. Inténtalo de nuevo en ${segundosBloqueo} segundos.`, 'error');
      return;
    }
    setLoading(true);
    try {
      if (loginMethod === 'nip') {
        if (!nip) {
          setLoading(false);
          return;
        }
        await login(nip, '');
      } else {
        const targetEmail = usersList.length > 0 ? selectedEmail : email;
        if (!targetEmail || !password) {
          setLoading(false);
          return;
        }
        await login(targetEmail, password);
      }
      setIntentosRestantes(3);
    } catch (err) {
      setIntentosRestantes(prev => {
        const nuevosIntentos = prev - 1;
        if (nuevosIntentos <= 0) {
          setBloqueado(true);
          setSegundosBloqueo(30);
          setModalError({
            titulo: 'Acceso Bloqueado',
            mensaje: 'Has superado el límite de intentos permitidos. El acceso ha sido bloqueado temporalmente por 30 segundos.',
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

  const quickLogin = async (role) => {
    if (bloqueado) return;
    const clientDomain = getClientDomain();
    const creds = {
      admin:   { e: `admin@${clientDomain}`, p: '1234' },
      gerente: { e: `gerente@${clientDomain}`, p: '1234' },
      cajero:  { e: `cajero@${clientDomain}`, p: '1234' },
      mesero:  { e: `mesero@${clientDomain}`, p: '1234' },
    };
    setLoading(true);
    try {
      await login(creds[role].e, creds[role].p);
    } catch(e) {
      showToast(e.message, 'error');
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
          <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', marginBottom: 20 }}>
            <button
              type="button"
              onClick={() => setLoginMethod('correo')}
              style={{
                flex: 1, padding: '10px 0', background: 'none', border: 'none',
                borderBottom: loginMethod === 'correo' ? '2px solid var(--bronze-light)' : 'none',
                color: loginMethod === 'correo' ? 'var(--bronze-light)' : 'var(--text-muted)',
                fontWeight: 700, fontSize: 12, cursor: 'pointer', textTransform: 'uppercase', letterSpacing: '0.05em'
              }}
            >
              Correo Electrónico
            </button>
            <button
              type="button"
              onClick={() => setLoginMethod('nip')}
              style={{
                flex: 1, padding: '10px 0', background: 'none', border: 'none',
                borderBottom: loginMethod === 'nip' ? '2px solid var(--bronze-light)' : 'none',
                color: loginMethod === 'nip' ? 'var(--bronze-light)' : 'var(--text-muted)',
                fontWeight: 700, fontSize: 12, cursor: 'pointer', textTransform: 'uppercase', letterSpacing: '0.05em'
              }}
            >
              Ingreso por NIP
            </button>
          </div>

          <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {loginMethod === 'nip' ? (
              <div className="form-group">
                <label className="form-label">NIP del Empleado</label>
                <input
                  className="form-input"
                  type="password"
                  maxLength={6}
                  placeholder="••••"
                  value={nip}
                  onChange={e => setNip(e.target.value.replace(/\D/g, ''))}
                  style={{ textAlign: 'center', fontSize: 20, letterSpacing: '0.3em' }}
                  required
                />
              </div>
            ) : (
              <>
                {usersList.length > 0 ? (
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
                      type="email"
                      placeholder={`usuario@${getClientDomain()}`}
                      value={email}
                      onChange={e => setEmail(e.target.value)}
                      required
                    />
                  </div>
                )}

                <div className="form-group">
                  <label className="form-label">Contraseña</label>
                  <div style={{ position: 'relative' }}>
                    <input
                      className="form-input"
                      type={showPass ? 'text' : 'password'}
                      placeholder="••••••••"
                      value={password}
                      onChange={e => setPassword(e.target.value)}
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
              </>
            )}

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

          {/* Quick Access (dev mode) */}
          <div style={{ marginTop: 24, paddingTop: 20, borderTop: '1px solid var(--border)' }}>
            <p style={{ fontSize: 10, color: 'var(--text-muted)', letterSpacing: '0.15em', textTransform: 'uppercase', marginBottom: 12, textAlign: 'center' }}>
              Acceso rápido (Demo)
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {[
                { role: 'admin',   label: 'Admin',   icon: 'ri-shield-star-line',    color: 'var(--bronze-light)' },
                { role: 'gerente', label: 'Gerente', icon: 'ri-user-star-line',       color: 'var(--silver)' },
                { role: 'cajero',  label: 'Cajero',  icon: 'ri-money-dollar-circle-line', color: 'var(--success)' },
                { role: 'mesero',  label: 'Mesero',  icon: 'ri-restaurant-line',      color: 'var(--blue-light)' },
              ].map(({ role, label, icon, color }) => (
                <button
                  key={role}
                  onClick={() => quickLogin(role)}
                  disabled={loading || bloqueado}
                  style={{
                    background: 'var(--bg-elevated)', border: '1px solid var(--border)',
                    borderRadius: 10, padding: '8px 12px', cursor: 'pointer',
                    display: 'flex', alignItems: 'center', gap: 7,
                    fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)',
                    transition: 'all 0.15s',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = color; e.currentTarget.style.color = color; }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-secondary)'; }}
                >
                  <i className={icon} style={{ fontSize: 14, color }} />
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <p style={{ textAlign: 'center', fontSize: 10, color: 'var(--text-muted)', marginTop: 20, letterSpacing: '0.1em' }}>
          YoY IA BILLAR By Alfonso Iturbide v1.0 · Powered by IA
        </p>
      </div>

      {/* Modal de Error de Credenciales */}
      {modalError && (
        <div className="modal-overlay" style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999,
          backdropFilter: 'blur(4px)'
        }} onClick={() => setModalError(null)}>
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
              onClick={() => setModalError(null)}
            >
              Entendido
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

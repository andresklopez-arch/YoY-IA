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

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (loginMethod === 'nip') {
        if (!nip) return;
        await login(nip, '');
      } else {
        const targetEmail = usersList.length > 0 ? selectedEmail : email;
        if (!targetEmail || !password) return;
        await login(targetEmail, password);
      }
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  const quickLogin = async (role) => {
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
              disabled={loading}
              style={{ marginTop: 8, width: '100%' }}
            >
              {loading
                ? <><i className="ri-loader-4-line animate-spin" /> Ingresando...</>
                : <><i className="ri-login-circle-line" /> Ingresar al Sistema</>
              }
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
                  disabled={loading}
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
    </div>
  );
}

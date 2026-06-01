'use client';
import { useState } from 'react';
import { useAuth } from '@/lib/auth-context';

export default function LoginScreen({ showToast }) {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPass, setShowPass] = useState(false);

  const handleLogin = async (e) => {
    e.preventDefault();
    if (!email || !password) return;
    setLoading(true);
    try {
      await login(email, password);
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  const quickLogin = async (role) => {
    const creds = {
      admin:   { e: 'admin@yoybillar.mx', p: '1234' },
      gerente: { e: 'gerente@yoybillar.mx', p: '1234' },
      cajero:  { e: 'cajero@yoybillar.mx', p: '1234' },
      mesero:  { e: 'mesero@yoybillar.mx', p: '1234' },
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
        {/* Logo & Brand con Logo Largo */}
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <img 
            src="/logo-largo.png" 
            alt="YoY IA Billar By Alfonso Iturbide" 
            fetchpriority="high"
            loading="eager"
            style={{
              maxWidth: '100%',
              width: 320,
              height: 'auto',
              objectFit: 'contain',
              margin: '0 auto 10px',
              display: 'block',
              filter: 'drop-shadow(0 0 15px rgba(205,127,50,0.2))'
            }}
          />
          <p style={{ fontSize: 10, color: 'var(--text-muted)', letterSpacing: '0.2em', textTransform: 'uppercase', marginTop: 10 }}>
            Sistema de Gestión Inteligente · By Alfonso Iturbide
          </p>
        </div>

        {/* Login Card */}
        <div style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--border-bronze)',
          borderRadius: 20,
          padding: 32,
          boxShadow: 'var(--shadow-lg), 0 0 40px rgba(205,127,50,0.08)',
        }}>
          <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 24, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
            Iniciar Sesión
          </h2>

          <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div className="form-group">
              <label className="form-label">Correo Electrónico</label>
              <input
                className="form-input"
                type="email"
                placeholder="usuario@yoybillar.mx"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
              />
            </div>

            <div className="form-group">
              <label className="form-label">Contraseña / PIN</label>
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

'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { doc, setDoc, serverTimestamp } from '@/lib/firestore-tenant';
import { db } from '@/lib/firebase';

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

export default function FilaRegistroAutoservicio() {
  const router = useRouter();
  const [cliente, setCliente] = useState('');
  const [contacto, setContacto] = useState('');
  const [tipo, setTipo] = useState('Pool 9B');
  const [personas, setPersonas] = useState(2);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    const cleanCliente = capitalizeName(cliente);
    if (!isRealName(cleanCliente)) {
      setError('Por favor ingrese un nombre real y no genérico (mínimo 3 letras).');
      return;
    }

    if (personas < 1) {
      setError('El número de personas debe ser al menos 1.');
      return;
    }

    setLoading(true);
    const entryId = Date.now();
    const nuevo = {
      id: entryId,
      cliente: cleanCliente,
      contacto: contacto.trim() || 'N/A',
      tipo,
      personas: parseInt(personas),
      registro: Date.now(),
      estado: 'espera',
      mesaAsignada: ''
    };

    try {
      await setDoc(doc(db, 'fila_espera', String(entryId)), {
        ...nuevo,
        createdAt: serverTimestamp()
      });
      // Redirect to the dynamic position tracking page
      router.push(`/fila/${entryId}`);
    } catch (err) {
      console.error("Error al registrar cliente en fila_espera:", err);
      setError('Ocurrió un error al registrarse. Intente de nuevo.');
      setLoading(false);
    }
  };

  return (
    <div className="client-container" style={containerStyle}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600;800&display=swap');
        @keyframes pulseGlow {
          0% { box-shadow: 0 0 5px rgba(197, 168, 128, 0.2); }
          50% { box-shadow: 0 0 20px rgba(197, 168, 128, 0.4); }
          100% { box-shadow: 0 0 5px rgba(197, 168, 128, 0.2); }
        }
      `}</style>

      <div style={cardStyle}>
        <div style={{ fontSize: 48, marginBottom: 12, display: 'inline-block' }}>🎱</div>
        <h1 style={titleStyle}>YoY Billar Club</h1>
        <h2 style={subtitleStyle}>Registro de Fila Virtual</h2>
        <p style={descStyle}>
          Regístrate para asegurar tu lugar en la lista de espera. Te notificaremos cuando tu mesa esté lista.
        </p>

        {error && (
          <div style={errorStyle}>
            ⚠️ {error}
          </div>
        )}

        <form onSubmit={handleSubmit} style={formStyle}>
          <div style={formGroupStyle}>
            <label style={labelStyle}>Tu Nombre</label>
            <input
              type="text"
              required
              placeholder="Ej: Carlos Rodríguez"
              value={cliente}
              onChange={(e) => setCliente(e.target.value)}
              style={inputStyle}
              disabled={loading}
            />
          </div>

          <div style={formGroupStyle}>
            <label style={labelStyle}>Teléfono de Contacto (Opcional)</label>
            <input
              type="tel"
              placeholder="Ej: 55-1234-5678"
              value={contacto}
              onChange={(e) => setContacto(e.target.value)}
              style={inputStyle}
              disabled={loading}
            />
          </div>

          <div style={formGroupStyle}>
            <label style={labelStyle}>¿Qué mesa buscas?</label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 4, marginBottom: 12 }}>
              {[
                { value: 'Pool 9B', label: 'Pool (9 Bolas)', icon: 'pool' },
                { value: 'Carambola 3B', label: 'Carambola (3B)', icon: 'carambola' },
                { value: 'Snooker', label: 'Snooker', icon: 'snooker' },
                { value: 'Dominó', label: 'Dominó', icon: 'domino' },
              ].map(opt => {
                const isActive = tipo === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setTipo(opt.value)}
                    style={{
                      background: isActive ? 'rgba(197, 168, 128, 0.12)' : 'rgba(255,255,255,0.02)',
                      border: isActive ? '1.5px solid var(--bronze-light, #c5a880)' : '1px solid rgba(255,255,255,0.06)',
                      borderRadius: 12,
                      padding: '10px 6px',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 6,
                      cursor: 'pointer',
                      transition: 'all 0.2s',
                      color: isActive ? '#fff' : 'rgba(255,255,255,0.5)',
                      boxShadow: isActive ? '0 0 10px rgba(197, 168, 128, 0.15)' : 'none'
                    }}
                    disabled={loading}
                  >
                    {opt.icon === 'pool' && (
                      <svg width="18" height="18" viewBox="0 0 24 22" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <polygon points="12,1 23,20 1,20" stroke="var(--bronze-light, #c5a880)" strokeWidth="1.8" strokeLinejoin="round" fill="rgba(197,168,128,0.05)" />
                        <circle cx="12" cy="7.5" r="2.2" fill="#eab308" />
                        <circle cx="9.5" cy="12" r="2.2" fill="#3b82f6" />
                        <circle cx="14.5" cy="12" r="2.2" fill="#ef4444" />
                        <circle cx="7" cy="16.5" r="2.2" fill="#8b5cf6" />
                        <circle cx="12" cy="16.5" r="2.2" fill="#f97316" />
                        <circle cx="17" cy="16.5" r="2.2" fill="#22c55e" />
                      </svg>
                    )}
                    {opt.icon === 'carambola' && (
                      <svg width="18" height="18" viewBox="0 0 24 22" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <defs>
                          <radialGradient id="regRedBall" cx="30%" cy="30%" r="70%">
                            <stop offset="0%" stopColor="#ff8888" />
                            <stop offset="65%" stopColor="#dc2626" />
                            <stop offset="100%" stopColor="#7f1d1d" />
                          </radialGradient>
                          <radialGradient id="regYellowBall" cx="30%" cy="30%" r="70%">
                            <stop offset="0%" stopColor="#fef08a" />
                            <stop offset="65%" stopColor="#ca8a04" />
                            <stop offset="100%" stopColor="#713f12" />
                          </radialGradient>
                          <radialGradient id="regWhiteBall" cx="30%" cy="30%" r="70%">
                            <stop offset="0%" stopColor="#ffffff" />
                            <stop offset="65%" stopColor="#cbd5e1" />
                            <stop offset="100%" stopColor="#475569" />
                          </radialGradient>
                        </defs>
                        <circle cx="12" cy="15" r="4.8" fill="url(#regRedBall)" />
                        <circle cx="8.2" cy="9" r="4.8" fill="url(#regYellowBall)" />
                        <circle cx="15.8" cy="10" r="4.8" fill="url(#regWhiteBall)" />
                        <circle cx="15.3" cy="9.5" r="0.7" fill="#ef4444" opacity="0.8" />
                      </svg>
                    )}
                    {opt.icon === 'snooker' && (
                      <svg width="18" height="18" viewBox="0 0 24 22" fill="none" xmlns="http://www.w3.org/2000/svg">
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
                    )}
                    {opt.icon === 'domino' && (
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <rect x="3" y="6" width="18" height="12" rx="2" stroke="var(--bronze-light, #c5a880)" strokeWidth="1.5" fill="rgba(255,255,255,0.05)" />
                        <line x1="12" y1="6" x2="12" y2="18" stroke="var(--bronze-light, #c5a880)" strokeWidth="1.5" />
                        <circle cx="6.5" cy="9" r="1" fill="var(--bronze-light, #c5a880)" />
                        <circle cx="8.5" cy="12" r="1" fill="var(--bronze-light, #c5a880)" />
                        <circle cx="15.5" cy="9" r="1" fill="var(--bronze-light, #c5a880)" />
                        <circle cx="15.5" cy="15" r="1" fill="var(--bronze-light, #c5a880)" />
                        <circle cx="17.5" cy="9" r="1" fill="var(--bronze-light, #c5a880)" />
                        <circle cx="17.5" cy="15" r="1" fill="var(--bronze-light, #c5a880)" />
                      </svg>
                    )}
                    <span style={{ fontSize: 11, fontWeight: 700 }}>{opt.label}</span>
                  </button>
                );
              })}
              <button
                type="button"
                onClick={() => setTipo('Cualquiera')}
                style={{
                  gridColumn: 'span 2',
                  background: tipo === 'Cualquiera' ? 'rgba(197, 168, 128, 0.12)' : 'rgba(255,255,255,0.02)',
                  border: tipo === 'Cualquiera' ? '1.5px solid var(--bronze-light, #c5a880)' : '1px solid rgba(255,255,255,0.06)',
                  borderRadius: 12,
                  padding: '10px 8px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                  color: tipo === 'Cualquiera' ? '#fff' : 'rgba(255,255,255,0.5)',
                  boxShadow: tipo === 'Cualquiera' ? '0 0 10px rgba(197, 168, 128, 0.15)' : 'none'
                }}
                disabled={loading}
              >
                <svg width="16" height="16" viewBox="0 0 24 22" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ opacity: 0.7 }}>
                  <line x1="2" y1="20" x2="22" y2="2" stroke="var(--bronze-light, #c5a880)" strokeWidth="1.5" strokeLinecap="round" />
                  <line x1="2" y1="2" x2="22" y2="20" stroke="var(--bronze-light, #c5a880)" strokeWidth="1.5" strokeLinecap="round" />
                  <circle cx="12" cy="11" r="3" fill="#fff" />
                </svg>
                <span style={{ fontSize: 11, fontWeight: 700 }}>Cualquiera disponible</span>
              </button>
            </div>
          </div>

          <div style={formGroupStyle}>
            <label style={labelStyle}>Número de Jugadores (Personas)</label>
            <input
              type="number"
              min="1"
              max="20"
              value={personas}
              onChange={(e) => setPersonas(e.target.value)}
              style={inputStyle}
              disabled={loading}
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            style={loading ? { ...buttonStyle, opacity: 0.7, cursor: 'not-allowed' } : buttonStyle}
          >
            {loading ? 'Registrando...' : 'Unirse a la Fila ➔'}
          </button>
        </form>
      </div>
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
  padding: '36px 28px',
  width: '100%',
  maxWidth: 400,
  textAlign: 'center',
  backdropFilter: 'blur(10px)',
  boxShadow: '0 8px 32px 0 rgba(0, 0, 0, 0.37)',
  animation: 'pulseGlow 4s infinite ease-in-out'
};

const titleStyle = {
  fontSize: 26,
  fontWeight: 800,
  color: '#fff',
  marginBottom: 4,
  letterSpacing: '0.02em'
};

const subtitleStyle = {
  fontSize: 16,
  fontWeight: 600,
  color: '#c5a880',
  marginBottom: 12,
  textTransform: 'uppercase',
  letterSpacing: '0.05em'
};

const descStyle = {
  fontSize: 13,
  color: 'rgba(255, 255, 255, 0.55)',
  lineHeight: 1.5,
  marginBottom: 24
};

const errorStyle = {
  background: 'rgba(239, 68, 68, 0.12)',
  border: '1px solid #ef4444',
  borderRadius: 12,
  padding: '12px 14px',
  fontSize: 12,
  color: '#ef4444',
  textAlign: 'left',
  marginBottom: 20,
  lineHeight: 1.4
};

const formStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: 16,
  textAlign: 'left'
};

const formGroupStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6
};

const labelStyle = {
  fontSize: 11,
  fontWeight: 600,
  color: 'rgba(255, 255, 255, 0.5)',
  textTransform: 'uppercase',
  letterSpacing: '0.05em'
};

const inputStyle = {
  background: '#14141c',
  border: '1px solid rgba(255, 255, 255, 0.08)',
  borderRadius: 12,
  padding: '12px 16px',
  color: '#fff',
  fontSize: 14,
  outline: 'none',
  transition: 'border-color 0.2s ease',
  width: '100%',
  boxSizing: 'border-color'
};

const selectStyle = {
  background: '#14141c',
  border: '1px solid rgba(255, 255, 255, 0.08)',
  borderRadius: 12,
  padding: '12px 16px',
  color: '#fff',
  fontSize: 14,
  outline: 'none',
  width: '100%',
  cursor: 'pointer'
};

const buttonStyle = {
  background: 'linear-gradient(135deg, #c5a880, #967a57)',
  color: '#0a0a0f',
  border: 'none',
  borderRadius: 16,
  padding: '14px 24px',
  fontSize: 15,
  fontWeight: 800,
  cursor: 'pointer',
  marginTop: 8,
  transition: 'all 0.2s ease',
  boxShadow: '0 4px 15px rgba(197, 168, 128, 0.25)'
};

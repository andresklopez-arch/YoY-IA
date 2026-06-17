'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
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

          <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 0.8fr', gap: 12 }}>
            <div style={formGroupStyle}>
              <label style={labelStyle}>¿Qué mesa buscas?</label>
              <select
                value={tipo}
                onChange={(e) => setTipo(e.target.value)}
                style={selectStyle}
                disabled={loading}
              >
                <option value="Pool 9B">Pool (9 Bolas)</option>
                <option value="Carambola 3B">Carambola (3 Bandas)</option>
                <option value="Snooker">Snooker</option>
                <option value="Dominó">Dominó</option>
                <option value="Cualquiera">Cualquiera disponible</option>
              </select>
            </div>

            <div style={formGroupStyle}>
              <label style={labelStyle}>Jugadores</label>
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

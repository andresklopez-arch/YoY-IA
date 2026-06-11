'use client';
import { useState } from 'react';

export default function Loading() {
  const [imageError, setImageError] = useState(false);

  return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'center', minHeight:'100vh', background:'var(--bg-base)' }}>
      <div style={{ textAlign:'center', padding: '24px' }}>
        {!imageError ? (
          <img 
            src="/logo-largo.png" 
            alt="YoY IA Billar By Alfonso Iturbide" 
            onError={() => setImageError(true)}
            style={{ 
              width: 260, 
              height: 'auto', 
              objectFit: 'contain',
              animation: 'heartbeat 2.4s infinite ease-in-out', 
              margin: '0 auto 24px',
              display: 'block',
              filter: 'drop-shadow(0 0 15px rgba(205,127,50,0.25))'
            }} 
          />
        ) : (
          <div style={{ animation: 'heartbeat 2.4s infinite ease-in-out', display: 'flex', flexDirection: 'column', alignItems: 'center', margin: '0 auto 24px' }}>
            <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="var(--bronze-light)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ filter: 'drop-shadow(0 0 8px var(--bronze-light))' }}>
              <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" fill="var(--bronze-subtle)" />
            </svg>
            <span style={{ color: 'var(--bronze-light)', fontSize: 14, fontWeight: 700, marginTop: 8, letterSpacing: '0.1em' }}>YoY IA Billar</span>
          </div>
        )}
        <p style={{ color:'var(--text-secondary)', fontSize: 10, letterSpacing:'0.2em', textTransform:'uppercase', fontWeight: 600 }}>Iniciando sistema...</p>
      </div>

      <style>{`
        @keyframes heartbeat {
          0% { transform: scale(1); }
          14% { transform: scale(1.12); }
          28% { transform: scale(1); }
          42% { transform: scale(1.2); }
          70% { transform: scale(1); }
        }
        img, div {
          will-change: transform;
        }
      `}</style>
    </div>
  );
}


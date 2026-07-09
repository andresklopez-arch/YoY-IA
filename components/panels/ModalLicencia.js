'use client';
import { useState } from 'react';

export default function ModalLicencia({ 
  licencia, 
  diasRestantes, 
  onClose
}) {
  const [copiado, setCopiado] = useState(false);

  const handleCopiarClave = () => {
    if (licencia?.numeroLicencia) {
      navigator.clipboard.writeText(licencia.numeroLicencia);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    }
  };

  // Determinar color de vigencia
  let vigenciaColor = 'var(--success)';
  if (diasRestantes <= 7) vigenciaColor = 'var(--danger)';
  else if (diasRestantes <= 30) vigenciaColor = 'var(--warning)';

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      width: '100vw',
      height: '100vh',
      backgroundColor: 'rgba(0, 0, 0, 0.85)',
      backdropFilter: 'blur(8px)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 9999,
      animation: 'fadeIn 0.3s ease-out'
    }}>
      <div style={{
        width: '100%',
        maxWidth: 480,
        maxHeight: '90vh',
        overflowY: 'auto',
        background: 'linear-gradient(135deg, rgba(30, 30, 30, 0.95), rgba(15, 15, 15, 0.95))',
        border: '1px solid rgba(255, 255, 255, 0.08)',
        borderRadius: 16,
        boxShadow: '0 20px 40px rgba(0, 0, 0, 0.6), inset 0 1px 0 rgba(255, 255, 255, 0.05)',
        padding: 24,
        color: '#fff',
        position: 'relative',
        fontFamily: 'system-ui, sans-serif'
      }}>
        {/* Encabezado */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ 
              background: 'linear-gradient(135deg, #c29b38, #8a6515)',
              color: '#000',
              padding: '6px 12px',
              borderRadius: 8,
              fontSize: 12,
              fontWeight: 900,
              letterSpacing: '0.05em'
            }}>
              ALR SaaS
            </span>
            <h3 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: 'var(--bronze-light)' }}>
              Licencia del Sistema
            </h3>
          </div>
          <button 
            onClick={onClose}
            style={{
              background: 'rgba(255, 255, 255, 0.05)',
              border: 'none',
              borderRadius: '50%',
              width: 32,
              height: 32,
              color: '#aaa',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 16
            }}
          >
            ✕
          </button>
        </div>

        {/* Info Tarjeta de Licencia */}
        {licencia ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* Clave de Licencia */}
            <div style={{ 
              background: 'rgba(255, 255, 255, 0.02)',
              border: '1px solid rgba(255, 255, 255, 0.05)',
              borderRadius: 12,
              padding: 14,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center'
            }}>
              <div>
                <span style={{ fontSize: 10, textTransform: 'uppercase', color: '#888', fontWeight: 700, letterSpacing: '0.05em' }}>
                  Número de Licencia Activa
                </span>
                <div style={{ fontSize: 15, fontWeight: 700, fontFamily: 'monospace', color: '#eee', marginTop: 2 }}>
                  {licencia.numeroLicencia ? `${licencia.numeroLicencia.substring(0, 13)}••••` : 'Sin Licencia'}
                </div>
              </div>
              <button
                onClick={handleCopiarClave}
                style={{
                  background: copiado ? 'rgba(34, 197, 94, 0.15)' : 'rgba(194, 155, 56, 0.12)',
                  border: `1px solid ${copiado ? 'rgba(34, 197, 94, 0.3)' : 'rgba(194, 155, 56, 0.3)'}`,
                  color: copiado ? '#22c55e' : 'var(--bronze-light)',
                  padding: '6px 12px',
                  borderRadius: 8,
                  fontSize: 11,
                  fontWeight: 700,
                  cursor: 'pointer',
                  transition: 'all 0.2s'
                }}
              >
                {copiado ? 'Copiado ✓' : 'Copiar'}
              </button>
            </div>

            {/* Vigencia */}
            <div style={{ 
              background: 'rgba(255, 255, 255, 0.02)',
              border: '1px solid rgba(255, 255, 255, 0.05)',
              borderRadius: 12,
              padding: 14
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{ fontSize: 10, textTransform: 'uppercase', color: '#888', fontWeight: 700, letterSpacing: '0.05em' }}>
                  Vigencia de Servicio
                </span>
                <span style={{ fontSize: 11, fontWeight: 700, color: vigenciaColor }}>
                  {diasRestantes > 0 ? `${diasRestantes} días restantes` : 'Expirada'}
                </span>
              </div>
              
              {/* Barra de progreso */}
              <div style={{ width: '100%', height: 6, background: 'rgba(255, 255, 255, 0.08)', borderRadius: 3, overflow: 'hidden' }}>
                <div style={{ 
                  width: `${Math.max(0, Math.min(100, (diasRestantes / 365) * 100))}%`, 
                  height: '100%', 
                  background: vigenciaColor,
                  borderRadius: 3
                }} />
              </div>
              
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10.5, color: '#aaa', marginTop: 8 }}>
                <span>Inició: {licencia.fechaCreacion ? new Date(licencia.fechaCreacion).toLocaleDateString() : '—'}</span>
                <span>Expira: {licencia.fechaVencimiento ? new Date(licencia.fechaVencimiento).toLocaleDateString() : '—'}</span>
              </div>
            </div>
          </div>
        ) : (
          <div style={{ textAlign: 'center', padding: 20 }}>
            <span className="spinner-border text-warning" role="status"></span>
            <p style={{ marginTop: 10, fontSize: 13, color: '#aaa' }}>Cargando datos de licenciamiento...</p>
          </div>
        )}
      </div>
    </div>
  );
}

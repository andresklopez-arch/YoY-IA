'use client';
import { useState } from 'react';
import { doc, updateDoc, setDoc, getActiveSalonId } from '@/lib/firestore-tenant';
import { db } from '@/lib/firebase';

export default function ModalLicencia({ 
  user, 
  licencia, 
  diasRestantes, 
  diasOffline, 
  onClose, 
  refrescarLicencia, 
  isCheckingOnline 
}) {
  const [copiado, setCopiado] = useState(false);
   const [adminOpen, setAdminOpen] = useState(false);
  const [mostrarContactoRenovacion, setMostrarContactoRenovacion] = useState(false);
  
  // States para controles administrativos
  const [nuevaFecha, setNuevaFecha] = useState('');
  const [nuevoStatus, setNuevoStatus] = useState(licencia?.status || 'activa');
  const [guardandoAdmin, setGuardandoAdmin] = useState(false);

  // Acceso restringido exclusivamente al desarrollador de ALR SaaS
  const isMasterAdmin = user?.email === 'masteradmin@yoybillar.mx';

  const salonId = getActiveSalonId();

  const handleCopiarClave = () => {
    if (licencia?.numeroLicencia) {
      navigator.clipboard.writeText(licencia.numeroLicencia);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    }
  };

  const handleGuardarCambiosAdmin = async () => {
    if (!salonId || !licencia) return;
    setGuardandoAdmin(true);
    try {
      const docRef = doc(db, 'licencias_saas', salonId);
      const updates = {
        status: nuevoStatus,
        updatedAt: new Date().toISOString()
      };
      if (nuevaFecha) {
        updates.fechaVencimiento = new Date(nuevaFecha).toISOString();
      }
      await updateDoc(docRef, updates);
      alert("Cambios guardados con éxito en la licencia ALR SaaS.");
      await refrescarLicencia(true);
    } catch (e) {
      console.error(e);
      alert("Error al actualizar la licencia en Firebase.");
    } finally {
      setGuardandoAdmin(false);
    }
  };

  const handleRenovarUnAno = async () => {
    if (!salonId || !licencia) return;
    if (!confirm("¿Confirmas la renovación de la licencia por 1 año a partir de hoy?")) return;
    setGuardandoAdmin(true);
    try {
      const docRef = doc(db, 'licencias_saas', salonId);
      const nuevaFechaVencimiento = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
      await updateDoc(docRef, {
        fechaVencimiento: nuevaFechaVencimiento,
        status: 'activa',
        ultimaSincronizacion: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
      alert("Licencia renovada por 1 año exitosamente.");
      await refrescarLicencia(true);
    } catch (e) {
      console.error(e);
      alert("Error al renovar la licencia.");
    } finally {
      setGuardandoAdmin(false);
    }
  };

  const handleRegenerarClave = async () => {
    if (!salonId || !licencia) return;
    if (!confirm("¿Deseas regenerar el número de licencia? Esto cambiará la clave activa del cliente.")) return;
    setGuardandoAdmin(true);
    try {
      const docRef = doc(db, 'licencias_saas', salonId);
      const randKey1 = Math.random().toString(36).substring(2, 6).toUpperCase();
      const randKey2 = Math.random().toString(36).substring(2, 6).toUpperCase();
      const nuevaClave = `ALR-2026-${randKey1}-${randKey2}`;
      
      await updateDoc(docRef, {
        numeroLicencia: nuevaClave,
        updatedAt: new Date().toISOString()
      });
      alert(`Nueva licencia generada con éxito: ${nuevaClave}`);
      await refrescarLicencia(true);
    } catch (e) {
      console.error(e);
      alert("Error al regenerar la clave.");
    } finally {
      setGuardandoAdmin(false);
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

            {/* Estado Offline */}
            <div style={{ 
              background: 'rgba(255, 255, 255, 0.02)',
              border: '1px solid rgba(255, 255, 255, 0.05)',
              borderRadius: 12,
              padding: 14
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{ fontSize: 10, textTransform: 'uppercase', color: '#888', fontWeight: 700, letterSpacing: '0.05em' }}>
                  Operación Fuera de Línea (Offline)
                </span>
                <span style={{ fontSize: 11, fontWeight: 700, color: diasOffline >= 10 ? 'var(--danger)' : '#aaa' }}>
                  {diasOffline} / 15 días
                </span>
              </div>
              
              <div style={{ width: '100%', height: 6, background: 'rgba(255, 255, 255, 0.08)', borderRadius: 3, overflow: 'hidden' }}>
                <div style={{ 
                  width: `${Math.max(0, Math.min(100, (diasOffline / 15) * 100))}%`, 
                  height: '100%', 
                  background: diasOffline >= 10 ? 'var(--danger)' : 'var(--bronze-light)',
                  borderRadius: 3
                }} />
              </div>
              
            </div>

            {/* Sincronizar en caliente */}
            <button
              onClick={() => refrescarLicencia(true)}
              disabled={isCheckingOnline}
              style={{
                width: '100%',
                background: 'linear-gradient(135deg, rgba(255,255,255,0.08), rgba(255,255,255,0.03))',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                borderRadius: 12,
                color: '#fff',
                padding: '10px 16px',
                fontSize: 12,
                fontWeight: 700,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                transition: 'all 0.2s'
              }}
            >
              {isCheckingOnline ? (
                <>
                  <span className="spinner-border spinner-border-sm" role="status" aria-hidden="true" style={{ width: 14, height: 14 }}></span>
                  Validando con ALR SaaS...
                </>
              ) : (
                <>
                  🔄 Validar y Sincronizar Licencia
                </>
              )}
            </button>

            {/* Botón de Renovación para administradores locales */}
            {!isMasterAdmin && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <button
                  onClick={() => setMostrarContactoRenovacion(!mostrarContactoRenovacion)}
                  style={{
                    width: '100%',
                    background: 'linear-gradient(135deg, #c29b38, #8a6515)',
                    border: 'none',
                    borderRadius: 12,
                    color: '#000',
                    padding: '10px 16px',
                    fontSize: 12,
                    fontWeight: 800,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 8,
                    transition: 'all 0.2s',
                    boxShadow: '0 4px 12px rgba(194, 155, 56, 0.2)'
                  }}
                >
                  🔑 Renovar Licencia
                </button>

                {mostrarContactoRenovacion && (
                  <div style={{
                    background: 'rgba(194, 155, 56, 0.05)',
                    border: '1px solid rgba(194, 155, 56, 0.15)',
                    borderRadius: 12,
                    padding: 14,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                    animation: 'slideDown 0.2s ease-out'
                  }}>
                    <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--bronze-light)', textTransform: 'uppercase' }}>
                      Datos de Contacto para Renovación
                    </div>
                    <div style={{ fontSize: 12, color: '#ddd', lineHeight: 1.4 }}>
                      Para renovar el servicio anual de su sucursal, comuníquese con el desarrollador de <strong>ALR SaaS</strong>:
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4 }}>
                      <div style={{ fontSize: 12, color: '#eee', display: 'flex', gap: 6 }}>
                        <span>📞</span> <strong>WhatsApp/Tel:</strong> <span>+52 (449) 462-8226</span>
                      </div>
                      <div style={{ fontSize: 12, color: '#eee', display: 'flex', gap: 6 }}>
                        <span>✉️</span> <strong>Email:</strong> <span>soporte@alrsaas.mx</span>
                      </div>
                    </div>
                    <div style={{ fontSize: 10, color: '#888', fontStyle: 'italic', marginTop: 4 }}>
                      * Proporcione su número de licencia activa al contactar al desarrollador.
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Panel Administrativo Exclusivo de ALR SaaS */}
            {isMasterAdmin && (
              <div style={{ 
                borderTop: '1px solid rgba(255, 255, 255, 0.1)',
                paddingTop: 16,
                marginTop: 8
              }}>
                <button
                  onClick={() => setAdminOpen(!adminOpen)}
                  style={{
                    width: '100%',
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--bronze-light)',
                    fontSize: 12,
                    fontWeight: 800,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '4px 0'
                  }}
                >
                  <span>🛠️ CONTROL ALR SaaS (ADMIN)</span>
                  <span>{adminOpen ? '▲' : '▼'}</span>
                </button>

                {adminOpen && (
                  <div style={{ 
                    display: 'flex', 
                    flexDirection: 'column', 
                    gap: 12, 
                    marginTop: 12,
                    padding: 12,
                    background: 'rgba(194, 155, 56, 0.05)',
                    borderRadius: 10,
                    border: '1px dashed rgba(194, 155, 56, 0.2)'
                  }}>
                    {/* Status */}
                    <div className="form-group" style={{ gap: 4 }}>
                      <label style={{ fontSize: 10, fontWeight: 700, color: '#aaa', textTransform: 'uppercase' }}>Estado de Licencia</label>
                      <select 
                        value={nuevoStatus}
                        onChange={e => setNuevoStatus(e.target.value)}
                        style={{
                          background: '#151515',
                          border: '1px solid rgba(255,255,255,0.15)',
                          color: '#fff',
                          padding: '6px 10px',
                          borderRadius: 6,
                          fontSize: 12
                        }}
                      >
                        <option value="activa">Activa (Operación normal)</option>
                        <option value="suspendida">Suspendida (Bloqueo temp)</option>
                        <option value="bloqueada">Bloqueada (Bloqueo permanente)</option>
                      </select>
                    </div>

                    {/* Extender Vencimiento */}
                    <div className="form-group" style={{ gap: 4 }}>
                      <label style={{ fontSize: 10, fontWeight: 700, color: '#aaa', textTransform: 'uppercase' }}>Extender Vencimiento</label>
                      <input 
                        type="date"
                        value={nuevaFecha}
                        onChange={e => setNuevaFecha(e.target.value)}
                        style={{
                          background: '#151515',
                          border: '1px solid rgba(255,255,255,0.15)',
                          color: '#fff',
                          padding: '6px 10px',
                          borderRadius: 6,
                          fontSize: 12
                        }}
                      />
                    </div>

                    {/* Botones de acción */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 4 }}>
                      <button
                        onClick={handleGuardarCambiosAdmin}
                        disabled={guardandoAdmin}
                        style={{
                          background: 'var(--bronze-light)',
                          color: '#000',
                          border: 'none',
                          borderRadius: 6,
                          padding: '8px 12px',
                          fontSize: 11,
                          fontWeight: 700,
                          cursor: 'pointer'
                        }}
                      >
                        {guardandoAdmin ? 'Guardando...' : 'Aplicar Modifs'}
                      </button>
                      <button
                        onClick={handleRenovarUnAno}
                        disabled={guardandoAdmin}
                        style={{
                          background: '#22c55e',
                          color: '#000',
                          border: 'none',
                          borderRadius: 6,
                          padding: '8px 12px',
                          fontSize: 11,
                          fontWeight: 700,
                          cursor: 'pointer'
                        }}
                      >
                        Renovar 1 Año
                      </button>
                    </div>

                    <button
                      onClick={handleRegenerarClave}
                      disabled={guardandoAdmin}
                      style={{
                        width: '100%',
                        background: 'rgba(239, 68, 68, 0.15)',
                        border: '1px solid rgba(239, 68, 68, 0.3)',
                        color: '#ef4444',
                        borderRadius: 6,
                        padding: '6px 12px',
                        fontSize: 10.5,
                        fontWeight: 700,
                        cursor: 'pointer',
                        marginTop: 4
                      }}
                    >
                      Regenerar Clave de Licencia
                    </button>
                  </div>
                )}
              </div>
            )}
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

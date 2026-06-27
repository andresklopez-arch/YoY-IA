'use client';
import { useEffect } from 'react';
import { db } from '@/lib/firebase';
import { collection, addDoc, serverTimestamp } from '@/lib/firestore-tenant';
import '@/styles/mesa-cliente.css';

export default function MesaInvalidaPage() {
  useEffect(() => {
    const registrarFalloQR = async () => {
      try {
        await addDoc(collection(db, 'intentos_fallidos_qr'), {
          ruta: typeof window !== 'undefined' ? window.location.pathname + window.location.search : 'desconocido',
          userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'desconocido',
          fecha: serverTimestamp(),
          tipo: 'id_invalido_middleware'
        });
        console.log("Log de fallo QR guardado en Firestore.");
      } catch (err) {
        console.warn("No se pudo registrar log de fallo QR en la nube:", err);
      }
    };
    registrarFalloQR();
  }, []);

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '100dvh',
      padding: 20,
      textAlign: 'center',
      background: 'var(--cl-bg)',
      color: 'var(--cl-text)',
      fontFamily: "'Inter', sans-serif"
    }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800;900&display=swap');`}</style>
      <div style={{ fontSize: 64, marginBottom: 20 }}>⚠️</div>
      <h2 style={{ fontSize: 20, fontWeight: 800, marginBottom: 10, color: 'var(--cl-bronze-light)' }}>Mesa no identificada</h2>
      <p style={{ color: 'var(--cl-muted)', maxWidth: 320, fontSize: 14, lineHeight: 1.6 }}>
        El código QR o enlace escaneado no contiene un número de mesa válido. Por favor, escanea nuevamente el código QR ubicado en tu mesa física.
      </p>
    </div>
  );
}

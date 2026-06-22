'use client';
import { useState, useEffect } from 'react';
import { auth, db } from '../../lib/firebase';
import { createUserWithEmailAndPassword } from 'firebase/auth';
import { doc, setDoc, collection, getDocs } from 'firebase/firestore';
import { getClientDomain } from '../../lib/tenant';
import { hashPasswordSecure } from '../../lib/crypto';

export default function SeedPage() {
  const [status, setStatus] = useState('Esperando para verificar estado...');
  const [customPassword, setCustomPassword] = useState('123456');
  const [isAlreadySeeded, setIsAlreadySeeded] = useState(false);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    const checkSeeded = async () => {
      try {
        const usersSnap = await getDocs(collection(db, 'users'));
        if (!usersSnap.empty) {
          setIsAlreadySeeded(true);
          setStatus('El sistema ya está inicializado. No es posible sembrar de nuevo.');
        } else {
          setStatus('Base de datos limpia. Lista para el sembrado inicial.');
        }
      } catch (e) {
        console.error("Error al comprobar sembrado:", e);
        setStatus(`Error de conexión al verificar base de datos: ${e.message}`);
      } finally {
        setChecking(false);
      }
    };
    checkSeeded();
  }, []);

  const handleSeed = async () => {
    if (isAlreadySeeded) {
      setStatus('Operación denegada: Ya existen usuarios en el sistema.');
      return;
    }
    if (customPassword.length < 6) {
      setStatus('Error: La contraseña debe tener al menos 6 caracteres.');
      return;
    }

    setStatus('Iniciando proceso...');
    try {
      const clientDomain = getClientDomain();
      // 1. Crear el usuario masteradmin
      setStatus(`Creando usuario masteradmin@${clientDomain}...`);
      const email = `masteradmin@${clientDomain}`;
      
      const userCredential = await createUserWithEmailAndPassword(auth, email, customPassword);
      const user = userCredential.user;

      // 2. Crear su documento en la colección 'users'
      setStatus('Creando documento de usuario en Firestore...');
      const hashedPassword = await hashPasswordSecure(customPassword);
      await setDoc(doc(db, 'users', user.uid), {
        uid: user.uid,
        email: email,
        password: hashedPassword,
        name: 'Administrador Maestro',
        alias: 'MasterAdmin',
        role: 'admin',
        sucursal: 'all',
        avatar: 'M',
        createdAt: new Date().toISOString()
      });

      // 3. Inicializando base de datos en limpio
      setStatus('Inicializando base de datos en limpio...');

      setIsAlreadySeeded(true);
      setStatus(`¡Sembrado completado exitosamente! Ya puedes iniciar sesión con admin1111@${clientDomain} y la contraseña que ingresaste.`);
    } catch (error) {
      console.error(error);
      if (error.code === 'auth/email-already-in-use') {
        setStatus('Error: El usuario ya existe en Firebase Auth con ese correo.');
      } else {
        setStatus(`Error: ${error.message}`);
      }
    }
  };

  return (
    <div style={{
      minHeight: '100vh',
      background: 'radial-gradient(ellipse at 50% 50%, rgba(205,127,50,0.08) 0%, transparent 80%), var(--bg-base, #0b0f19)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '24px',
      color: '#fff',
      fontFamily: 'system-ui, sans-serif'
    }}>
      <div style={{
        width: '100%',
        maxWidth: 500,
        background: 'rgba(25, 33, 51, 0.65)',
        backdropFilter: 'blur(20px)',
        border: '1px solid rgba(205, 127, 50, 0.25)',
        borderRadius: 24,
        padding: 32,
        boxShadow: '0 20px 40px rgba(0, 0, 0, 0.4), 0 0 50px rgba(205, 127, 50, 0.05)'
      }}>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <img 
            src="/logo-largo.png" 
            alt="YoY IA Billar By Alfonso Iturbide" 
            style={{
              width: 280,
              height: 'auto',
              objectFit: 'contain',
              margin: '0 auto 16px',
              display: 'block',
              filter: 'drop-shadow(0 0 15px rgba(205,127,50,0.15))'
            }}
          />
          <h1 style={{ fontSize: 20, fontWeight: 800, margin: '0 0 8px 0', color: 'var(--bronze-light, #cd7f32)' }}>
            Inicialización de Base de Datos
          </h1>
          <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', margin: 0 }}>
            Configuración inicial de seguridad, colecciones y credenciales administrativas.
          </p>
        </div>

        {isAlreadySeeded && !checking && (
          <div style={{
            background: 'rgba(239, 68, 68, 0.15)',
            border: '1px solid rgba(239, 68, 68, 0.3)',
            borderRadius: 12,
            padding: 16,
            marginBottom: 20,
            fontSize: 13,
            color: '#fca5a5',
            lineHeight: 1.5
          }}>
            ⚠️ <strong>Acceso Restringido:</strong> La base de datos ya contiene usuarios registrados. El sembrado ha sido bloqueado automáticamente para proteger la integridad y seguridad de la información.
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'rgba(255,255,255,0.7)' }}>
              Usuario de Administrador
            </label>
            <input 
              type="text"
              value={`masteradmin@${getClientDomain()}`}
              disabled
              style={{
                width: '100%',
                padding: '12px 16px',
                background: 'rgba(0,0,0,0.2)',
                border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: 10,
                color: 'rgba(255,255,255,0.4)',
                fontSize: 14,
                boxSizing: 'border-box'
              }}
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'rgba(255,255,255,0.7)' }}>
              Contraseña Personalizada (Mínimo 6 caracteres)
            </label>
            <input 
              type="password"
              placeholder="Ingresa la contraseña para masteradmin"
              value={customPassword}
              onChange={e => setCustomPassword(e.target.value)}
              disabled={isAlreadySeeded || checking}
              style={{
                width: '100%',
                padding: '12px 16px',
                background: 'rgba(0,0,0,0.3)',
                border: '1px solid rgba(205,127,50,0.3)',
                borderRadius: 10,
                color: '#fff',
                fontSize: 14,
                boxSizing: 'border-box',
                outline: 'none',
                transition: 'border-color 0.2s'
              }}
            />
          </div>

          <button 
            onClick={handleSeed}
            disabled={isAlreadySeeded || checking || customPassword.length < 6}
            style={{
              width: '100%',
              padding: '14px',
              background: 'linear-gradient(135deg, #cd7f32 0%, #a0522d 100%)',
              border: 'none',
              borderRadius: 12,
              color: '#fff',
              fontSize: 14,
              fontWeight: 700,
              cursor: 'pointer',
              boxShadow: '0 4px 15px rgba(205,127,50,0.3)',
              transition: 'all 0.2s',
              opacity: (isAlreadySeeded || checking || customPassword.length < 6) ? 0.4 : 1,
              pointerEvents: (isAlreadySeeded || checking || customPassword.length < 6) ? 'none' : 'auto'
            }}
          >
            {checking ? 'Verificando...' : 'Ejecutar Sembrado Inicial'}
          </button>
        </div>

        <div style={{
          marginTop: 24,
          padding: 16,
          background: 'rgba(0, 0, 0, 0.25)',
          border: '1px solid rgba(255, 255, 255, 0.05)',
          borderRadius: 12,
          fontSize: 12,
          fontFamily: 'monospace',
          color: '#34d399',
          wordBreak: 'break-word',
          lineHeight: 1.4
        }}>
          {status}
        </div>
      </div>
    </div>
  );
}

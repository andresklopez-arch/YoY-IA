'use client';
import { useState } from 'react';
import { auth, db } from '../../lib/firebase';
import { createUserWithEmailAndPassword } from 'firebase/auth';
import { doc, setDoc } from 'firebase/firestore';

export default function SeedPage() {
  const [status, setStatus] = useState('Esperando para inicializar...');

  const handleSeed = async () => {
    console.log("API KEY IS:", process.env.NEXT_PUBLIC_FIREBASE_API_KEY);
    setStatus('Iniciando proceso...');
    try {
      // 1. Crear el usuario admin1111
      setStatus('Creando usuario admin1111...');
      const email = 'admin1111@yoybillar.mx';
      const password = 'admin1111';
      
      const userCredential = await createUserWithEmailAndPassword(auth, email, password);
      const user = userCredential.user;

      // 2. Crear su documento en la colección 'users'
      setStatus('Creando documento de usuario...');
      await setDoc(doc(db, 'users', user.uid), {
        uid: user.uid,
        email: email,
        name: 'Administrador Maestro',
        alias: 'Admin',
        role: 'admin',
        sucursal: 'all',
        avatar: 'A'
      });

      // 3. Crear documentos vacíos en colecciones base para inicializarlas (Firestore crea la colección cuando hay un documento)
      setStatus('Inicializando colecciones (mesas, productos, torneos, tickets)...');
      
      // Colección 'mesas' - Creando mesa de ejemplo
      await setDoc(doc(db, 'mesas', 'mesa-01'), {
        id: 'mesa-01',
        numero: '1',
        tipo: 'pool',
        estado: 'libre',
        tiempoInicio: null,
        tiempoTranscurrido: 0,
        consumoTotal: 0
      });

      // Colección 'productos' - Creando producto de ejemplo
      await setDoc(doc(db, 'productos', 'prod-01'), {
        id: 'prod-01',
        nombre: 'Cerveza Modelo',
        categoria: 'bebidas',
        precio: 45,
        stock: 100
      });

      // Colección 'torneos' - Creando torneo de ejemplo
      await setDoc(doc(db, 'torneos', 'torneo-01'), {
        id: 'torneo-01',
        nombre: 'Torneo Relámpago',
        estado: 'inscripcion',
        participantes: []
      });

      // Colección 'tickets' - Creando ticket de ejemplo
      await setDoc(doc(db, 'tickets', 'ticket-01'), {
        id: 'ticket-01',
        mesaId: 'mesa-01',
        estado: 'abierto',
        items: [],
        total: 0
      });

      setStatus('¡Sembrado completado exitosamente! Ya puedes ir a / y hacer login con admin1111 y pass admin1111.');
    } catch (error) {
      console.error(error);
      if (error.code === 'auth/email-already-in-use') {
        setStatus('Error: El usuario admin1111 ya existe con esa contraseña.');
      } else {
        setStatus(`Error: ${error.message}`);
      }
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gray-900 text-white p-4">
      <h1 className="text-2xl font-bold mb-4">Inicialización de Base de Datos Firebase</h1>
      <p className="mb-8 text-gray-400">Este script creará el usuario admin1111 y las colecciones iniciales.</p>
      
      <button 
        onClick={handleSeed}
        className="px-6 py-3 bg-blue-600 hover:bg-blue-700 rounded-lg font-bold mb-4"
      >
        Ejecutar Sembrado (Seed)
      </button>

      <div className="p-4 bg-black/50 rounded text-sm font-mono text-green-400 w-full max-w-lg">
        {status}
      </div>
    </div>
  );
}

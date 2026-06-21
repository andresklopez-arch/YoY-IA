'use client';
import { createContext, useContext, useState, useEffect } from 'react';
import { auth, db } from './firebase';
import { signInWithEmailAndPassword, signOut, onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc, collection, getDocs, limit, query, where, addDoc, serverTimestamp } from 'firebase/firestore';
import { hashNip, hashPasswordSecure } from './crypto';
import { getBusinessDate } from './date-utils';


const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const logSessionEvent = async (userSession, tipo) => {
    if (!userSession || userSession.uid === 'bypass-admin') return;
    try {
      const fechaHoy = getBusinessDate();
      const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
      let dispositivo = 'PC/Terminal';
      if (/Mobi|Android|iPhone/i.test(ua)) dispositivo = 'Móvil';
      else if (/Tablet|iPad/i.test(ua)) dispositivo = 'Tablet';

      let geoData = { lat: null, lng: null, precision: null, status: 'No requerido' };

      await addDoc(collection(db, 'nomina_asistencia_log'), {
        empleadoId: userSession.uid,
        nombre: userSession.name || userSession.nombre || 'Empleado',
        rol: userSession.role || userSession.rol || 'Mesero',
        fecha: fechaHoy,
        tipo, // 'login' o 'logout'
        dispositivo,
        coordenadas: geoData,
        createdAt: serverTimestamp()
      });
    } catch (error) {
      console.error("Error logging session event:", error);
    }
  };

  const registrarAsistenciaDia = async (empleadoId) => {
    try {
      const fechaHoy = getBusinessDate();
      const hour = new Date().getHours();
      let turnoActual = 'noche';
      if (hour >= 6 && hour < 14) turnoActual = 'manana';
      else if (hour >= 14 && hour < 22) turnoActual = 'tarde';

      const q = query(
        collection(db, 'nomina_asistencia'),
        where('empleadoId', '==', empleadoId),
        where('fecha', '==', fechaHoy),
        where('turno', '==', turnoActual)
      );
      const snap = await getDocs(q);
      if (snap.empty) {
        await addDoc(collection(db, 'nomina_asistencia'), {
          empleadoId,
          fecha: fechaHoy,
          turno: turnoActual,
          estado: 'presente',
          createdAt: serverTimestamp()
        });
      }
    } catch (err) {
      console.error("Error registering daily attendance:", err);
    }
  };

  useEffect(() => {
    let unsubscribeAuth = () => {};

    const checkUsersAndSession = async () => {
      try {
        // 1. Consultar si existen usuarios registrados en Firestore
        const usersQuery = query(collection(db, 'users'), limit(1));
        const usersSnap = await getDocs(usersQuery);

        if (usersSnap.empty) {
          // Si no hay ningún usuario registrado, activamos ACCESO LIBRE
          setUser({
            uid: 'bypass-admin',
            email: 'admin@yoybillar.mx',
            name: 'Administrador (Acceso Libre)',
            role: 'admin',
            alias: 'Admin',
            isFreeAccess: true
          });
          setLoading(false);
          return;
        }

        // 2. Si sí hay usuarios, verificar si hay sesión guardada localmente
        const localUser = localStorage.getItem('yoy_ia_session');
        if (localUser) {
          setUser(JSON.parse(localUser));
          setLoading(false);
          return;
        }

        // 3. Fallback a Firebase Auth si no hay localUser pero sí usuarios en Firestore
        unsubscribeAuth = onAuthStateChanged(auth, async (firebaseUser) => {
          if (firebaseUser) {
            try {
              const userDoc = await getDoc(doc(db, 'users', firebaseUser.uid));
              if (userDoc.exists()) {
                const userData = { uid: firebaseUser.uid, email: firebaseUser.email, ...userDoc.data() };
                setUser(userData);
                localStorage.setItem('yoy_ia_session', JSON.stringify(userData));
              } else {
                const userData = {
                  uid: firebaseUser.uid,
                  email: firebaseUser.email,
                  name: 'Usuario',
                  role: 'usuario',
                  alias: firebaseUser.email.split('@')[0]
                };
                setUser(userData);
                localStorage.setItem('yoy_ia_session', JSON.stringify(userData));
              }
            } catch (err) {
              console.error("Error fetching user data:", err);
              setUser({ uid: firebaseUser.uid, email: firebaseUser.email });
            }
          } else {
            setUser(null);
          }
          setLoading(false);
        });

      } catch (error) {
        console.error("Error en inicialización de sesión. Habilitando bypass de seguridad:", error);
        // Bypass preventivo ante fallos de conexión iniciales
        setUser({
          uid: 'bypass-admin',
          email: 'admin@yoybillar.mx',
          name: 'Administrador (Acceso Libre)',
          role: 'admin',
          alias: 'Admin',
          isFreeAccess: true
        });
        setLoading(false);
      }
    };

    checkUsersAndSession();

    return () => unsubscribeAuth();
  }, []);

  const login = async (emailOrNip, password) => {
    const trimmedInput = emailOrNip.trim();
    const isNip = /^\d{4,6}$/.test(trimmedInput);

    try {
      if (isNip) {
        const hashedNip = await hashNip(trimmedInput);
        const qEmp = query(collection(db, 'nomina_empleados'), where('nip', '==', hashedNip));
        const snapEmp = await getDocs(qEmp);
        if (!snapEmp.empty) {
          const empDoc = snapEmp.docs[0];
          const empData = empDoc.data();
          const userSession = {
            uid: empDoc.id,
            email: empData.email || `${empData.nombre.toLowerCase()}@yoybillar.mx`,
            name: `${empData.nombre} ${empData.apellido || ''}`.trim(),
            role: empData.rol || 'mesero',
            alias: empData.nombre,
            permisos: empData.permisos || {},
            avatar: (empData.nombre?.[0] || 'E') + (empData.apellido?.[0] || '')
          };
          await logSessionEvent(userSession, 'login');
          await registrarAsistenciaDia(userSession.uid);
          setUser(userSession);
          localStorage.setItem('yoy_ia_session', JSON.stringify(userSession));
          return userSession;
        } else {
          throw new Error('NIP no registrado o inválido');
        }
      }

      let formattedEmail = trimmedInput.toLowerCase();
      if (!formattedEmail.includes('@')) {
        formattedEmail = `${formattedEmail}@yoybillar.mx`;
      }
      // 1. Validar primero contra usuarios locales registrados en Firestore
      const usersQuery = query(collection(db, 'users'), where('email', '==', formattedEmail));
      const usersSnap = await getDocs(usersQuery);

      if (!usersSnap.empty) {
        const userDoc = usersSnap.docs[0];
        const userData = userDoc.data();
        const hashedPassword = await hashPasswordSecure(password);
        if (userData.password === hashedPassword || userData.password === password) {
          const userSession = {
            uid: userDoc.id,
            email: formattedEmail,
            name: userData.name || userData.nombre || 'Usuario',
            role: userData.role || userData.rol || 'usuario',
            alias: userData.alias || formattedEmail.split('@')[0],
            ...userData
          };
          await logSessionEvent(userSession, 'login');
          await registrarAsistenciaDia(userSession.uid);
          setUser(userSession);
          localStorage.setItem('yoy_ia_session', JSON.stringify(userSession));
          return userSession;
        }
      }

      // 2. Fallback a Firebase Auth clásico si no hay coincidencia directa en Firestore
      const userCredential = await signInWithEmailAndPassword(auth, formattedEmail, password);
      const firebaseUser = userCredential.user;
      
      const userDoc = await getDoc(doc(db, 'users', firebaseUser.uid));
      let userData = {};
      if (userDoc.exists()) {
        userData = { uid: firebaseUser.uid, email: firebaseUser.email, ...userDoc.data() };
      } else {
        userData = {
          uid: firebaseUser.uid,
          email: firebaseUser.email,
          name: 'Usuario',
          role: 'usuario',
          alias: firebaseUser.email.split('@')[0]
        };
      }
      await logSessionEvent(userData, 'login');
      await registrarAsistenciaDia(userData.uid);
      setUser(userData);
      localStorage.setItem('yoy_ia_session', JSON.stringify(userData));
      return userData;
    } catch (error) {
      console.error("Login error:", error);
      throw new Error('Credenciales incorrectas o usuario no encontrado');
    }
  };

  const loginWithEmpleadoId = async (empleadoId) => {
    try {
      const empDoc = await getDoc(doc(db, 'nomina_empleados', empleadoId));
      if (empDoc.exists()) {
        const empData = empDoc.data();
        const userSession = {
          uid: empDoc.id,
          email: empData.email || `${empData.nombre.toLowerCase()}@yoybillar.mx`,
          name: `${empData.nombre} ${empData.apellido || ''}`.trim(),
          role: empData.rol || 'mesero',
          alias: empData.nombre,
          permisos: empData.permisos || {},
          avatar: (empData.nombre?.[0] || 'E') + (empData.apellido?.[0] || '')
        };
        setUser(userSession);
        localStorage.setItem('yoy_ia_session', JSON.stringify(userSession));
        return userSession;
      } else {
        throw new Error('Empleado no encontrado');
      }
    } catch (error) {
      console.error("Login with QR error:", error);
      throw error;
    }
  };

  const logout = async () => {
    try {
      if (user) {
        await logSessionEvent(user, 'logout');
      }
      localStorage.removeItem('yoy_ia_session');
      if (auth.currentUser) {
        await signOut(auth);
      }
      setUser(null);
    } catch (error) {
      console.error("Logout error:", error);
    }
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, loginWithEmpleadoId }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}

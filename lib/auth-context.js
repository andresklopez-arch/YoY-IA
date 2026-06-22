'use client';
import { createContext, useContext, useState, useEffect } from 'react';
import { auth, db } from './firebase';
import { signInWithEmailAndPassword, signOut, onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc, collection, getDocs, limit, query, where, addDoc, serverTimestamp, onSnapshot } from 'firebase/firestore';
import { hashNip, hashPasswordSecure } from './crypto';
import { getBusinessDate } from './date-utils';

if (typeof window !== 'undefined' && !window.__storage_intercepted__) {
  window.__storage_intercepted__ = true;
  const originalGetItem = Storage.prototype.getItem;
  const originalSetItem = Storage.prototype.setItem;
  const originalRemoveItem = Storage.prototype.removeItem;

  window.__original_getItem__ = originalGetItem;
  window.__original_setItem__ = originalSetItem;
  window.__original_removeItem__ = originalRemoveItem;

  const getSalonPrefix = () => {
    try {
      const session = originalGetItem.call(window.localStorage, 'yoy_ia_session');
      if (session) {
        const parsed = JSON.parse(session);
        return parsed.salonId ? `${parsed.salonId}_` : '';
      }
    } catch (e) {}
    return '';
  };

  Storage.prototype.getItem = function(key) {
    if (key === 'yoy_ia_session' || key.startsWith('yoy_lockout_')) {
      return originalGetItem.call(this, key);
    }
    const prefix = getSalonPrefix();
    return originalGetItem.call(this, prefix + key);
  };

  Storage.prototype.setItem = function(key, value) {
    if (key === 'yoy_ia_session' || key.startsWith('yoy_lockout_')) {
      return originalSetItem.call(this, key, value);
    }
    const prefix = getSalonPrefix();
    return originalSetItem.call(this, prefix + key, value);
  };

  Storage.prototype.removeItem = function(key) {
    if (key === 'yoy_ia_session' || key.startsWith('yoy_lockout_')) {
      return originalRemoveItem.call(this, key);
    }
    const prefix = getSalonPrefix();
    return originalRemoveItem.call(this, prefix + key);
  };
}

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isSuspended, setIsSuspended] = useState(false);

  const clearSalonStorage = (salonId) => {
    if (!salonId || typeof window === 'undefined') return;
    try {
      const prefix = `${salonId}_`;
      const keysToRemove = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith(prefix)) {
          keysToRemove.push(key);
        }
      }
      keysToRemove.forEach(key => {
        if (window.__original_removeItem__) {
          window.__original_removeItem__.call(localStorage, key);
        } else {
          localStorage.removeItem(key);
        }
      });
      console.log(`[LocalStorage] Autoclean completado: removidas ${keysToRemove.length} llaves de cache para el salon "${salonId}".`);
    } catch (e) {
      console.error("Error clearing salon localStorage:", e);
    }
  };

  const syncCustomClaims = (uid, salonId, onSuspendedUpdate) => {
    fetch('/api/auth/set-claims', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uid, salonId })
    })
    .then(res => res.json())
    .then(data => {
      if (data && data.isSuspended !== undefined) {
        if (onSuspendedUpdate) onSuspendedUpdate(data.isSuspended);
        const local = localStorage.getItem('yoy_ia_session');
        if (local) {
          const parsed = JSON.parse(local);
          parsed.isSuspended = data.isSuspended;
          localStorage.setItem('yoy_ia_session', JSON.stringify(parsed));
        }
      }
    })
    .catch(err => console.warn("Error al sincronizar custom claims:", err));
  };

  const checkSalonStatus = async (salonId) => {
    if (!salonId) {
      setIsSuspended(false);
      return;
    }
    try {
      // 1. Intentar validar mediante Custom Claims del token JWT de Firebase Auth
      if (auth.currentUser) {
        const tokenResult = await auth.currentUser.getIdTokenResult(true);
        if (tokenResult.claims && tokenResult.claims.isSuspended !== undefined) {
          setIsSuspended(!!tokenResult.claims.isSuspended);
          return;
        }
      }
      
      // 2. Si no es Firebase Auth (sino local/nómina), verificar en el objeto user de la sesión
      if (user && user.isSuspended !== undefined) {
        setIsSuspended(!!user.isSuspended);
        return;
      }

      // 3. Fallback de lectura preventiva si no está en claims ni local
      const salonDoc = await getDoc(doc(db, 'salones', salonId));
      if (salonDoc.exists() && salonDoc.data().status === 'suspendido') {
        setIsSuspended(true);
      } else {
        setIsSuspended(false);
      }
    } catch (e) {
      console.error("Error checking salon status:", e);
      setIsSuspended(false);
    }
  };

  useEffect(() => {
    if (!user || !user.salonId) {
      setIsSuspended(false);
      return;
    }

    // 1. Consulta rápida inicial pasiva
    checkSalonStatus(user.salonId);

    // 2. Escucha reactiva en tiempo real sobre el documento del salón
    const salonRef = doc(db, 'salones', user.salonId);
    const unsubscribe = onSnapshot(salonRef, (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        const suspended = data.status === 'suspendido';
        setIsSuspended(suspended);

        // Sincronizar en localStorage
        const local = localStorage.getItem('yoy_ia_session');
        if (local) {
          const parsed = JSON.parse(local);
          if (parsed.isSuspended !== suspended) {
            parsed.isSuspended = suspended;
            localStorage.setItem('yoy_ia_session', JSON.stringify(parsed));
          }
        }

        // Si fue suspendido, limpiar de inmediato la caché del localStorage
        if (suspended) {
          clearSalonStorage(user.salonId);
        }
      }
    }, (err) => {
      console.warn("Real-time listener on salon status failed (possibly due to security rules):", err);
    });

    return () => unsubscribe();
  }, [user]);

  const logSessionEvent = async (userSession, tipo) => {
    if (!userSession || userSession.uid === 'bypass-admin') return;

    // Evitar registrar logs de sesión para el Administrador Maestro
    const nameLower = (userSession.name || userSession.nombre || '').toLowerCase();
    const emailLower = (userSession.email || '').toLowerCase();
    if (nameLower.includes('administrador maestro') || nameLower.includes('admin maestro') || emailLower.includes('admin@yoybillar.mx')) {
      return;
    }

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

  const registrarAsistenciaDia = async (empleadoId, nombre = '', email = '') => {
    // Evitar registrar asistencia para el Administrador Maestro
    const nameLower = nombre.toLowerCase();
    const emailLower = email.toLowerCase();
    if (nameLower.includes('administrador maestro') || nameLower.includes('admin maestro') || emailLower.includes('admin@yoybillar.mx')) {
      return;
    }

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
            avatar: (empData.nombre?.[0] || 'E') + (empData.apellido?.[0] || ''),
            salonId: empData.salonId || 'default_salon'
          };
          await logSessionEvent(userSession, 'login');
          await registrarAsistenciaDia(userSession.uid, userSession.name, userSession.email);
          syncCustomClaims(userSession.uid, userSession.salonId, setIsSuspended);
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
            salonId: userData.salonId || 'default_salon',
            ...userData
          };
          await logSessionEvent(userSession, 'login');
          await registrarAsistenciaDia(userSession.uid, userSession.name, userSession.email);
          syncCustomClaims(userSession.uid, userSession.salonId, setIsSuspended);
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
        const uData = userDoc.data();
        userData = { 
          uid: firebaseUser.uid, 
          email: firebaseUser.email, 
          salonId: uData.salonId || 'default_salon',
          ...uData 
        };
      } else {
        userData = {
          uid: firebaseUser.uid,
          email: firebaseUser.email,
          name: 'Usuario',
          role: 'usuario',
          alias: firebaseUser.email.split('@')[0],
          salonId: 'default_salon'
        };
      }
      await logSessionEvent(userData, 'login');
      await registrarAsistenciaDia(userData.uid, userData.name || userData.nombre, userData.email);
      syncCustomClaims(userData.uid, userData.salonId, setIsSuspended);
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
          avatar: (empData.nombre?.[0] || 'E') + (empData.apellido?.[0] || ''),
          salonId: empData.salonId || 'default_salon'
        };
        syncCustomClaims(userSession.uid, userSession.salonId, setIsSuspended);
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
        if (user.salonId) {
          clearSalonStorage(user.salonId);
        }
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
    <AuthContext.Provider value={{ user, loading, login, logout, loginWithEmpleadoId, isSuspended }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}

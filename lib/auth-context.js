'use client';
import { createContext, useContext, useState, useEffect } from 'react';
import { auth, db } from './firebase';
import { signInWithEmailAndPassword, signOut, onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc, collection, getDocs, limit, query, where, addDoc, serverTimestamp, onSnapshot } from 'firebase/firestore';
import { hashNip, hashPasswordSecure } from './crypto';
import { getBusinessDate } from './date-utils';

const getActiveSalonId = () => {
  if (typeof window === 'undefined') return 'default_salon';
  try {
    const getFn = window.__original_getItem__ || (typeof Storage !== 'undefined' && Storage.prototype.getItem) || localStorage.getItem;
    const session = getFn.call(window.localStorage, 'yoy_ia_session');
    if (session) {
      const parsed = JSON.parse(session);
      if (parsed.salonId) return parsed.salonId;
    }
    const saved = getFn.call(window.localStorage, 'yoy_terminal_salon_id');
    if (saved) return saved;
  } catch (e) {}
  return 'default_salon';
};

const generateChecksum = (obj, salt) => {
  try {
    const str = JSON.stringify(obj);
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = (hash << 5) - hash + str.charCodeAt(i);
      hash |= 0;
    }
    return (hash >>> 0).toString(36);
  } catch (e) {
    return '';
  }
};

const rc4 = (str, key) => {
  let s = [], j = 0, x, res = '';
  for (let i = 0; i < 256; i++) {
    s[i] = i;
  }
  for (let i = 0; i < 256; i++) {
    j = (j + s[i] + key.charCodeAt(i % key.length)) % 256;
    x = s[i]; s[i] = s[j]; s[j] = x;
  }
  let i = 0;
  j = 0;
  for (let y = 0; y < str.length; y++) {
    i = (i + 1) % 256;
    j = (j + s[i]) % 256;
    x = s[i]; s[i] = s[j]; s[j] = x;
    res += String.fromCharCode(str.charCodeAt(y) ^ s[(s[i] + s[j]) % 256]);
  }
  return res;
};

const encryptValue = (val, key) => {
  if (!val) return val;
  try {
    const str = typeof val === 'string' ? val : JSON.stringify(val);
    const encrypted = rc4(str, key);
    return btoa(unescape(encodeURIComponent(encrypted)));
  } catch (e) {
    return val;
  }
};

const decryptValue = (encryptedStr, key) => {
  if (!encryptedStr) return encryptedStr;
  try {
    const decoded = decodeURIComponent(escape(atob(encryptedStr)));
    return rc4(decoded, key);
  } catch (e) {
    return null;
  }
};

const getSecureKey = () => {
  if (typeof window === 'undefined') return 'default_sec_key';
  try {
    const getFn = window.__original_getItem__ || (typeof Storage !== 'undefined' && Storage.prototype.getItem) || localStorage.getItem;
    const session = getFn.call(window.localStorage, 'yoy_ia_session');
    if (session) {
      const parsed = JSON.parse(session);
      // Validar integridad de sesión
      const { integrity, ...sessionData } = parsed;
      const expectedIntegrity = generateChecksum(sessionData, 'yoy_integrity_salt');
      if (integrity !== expectedIntegrity) {
        console.error("[Session Integrity] Tampering detected in local storage session! Kicking out.");
        const removeFn = window.__original_removeItem__ || (typeof Storage !== 'undefined' && Storage.prototype.removeItem) || localStorage.removeItem;
        removeFn.call(window.localStorage, 'yoy_ia_session');
        window.location.reload();
        return 'invalid';
      }
      const saltPart = parsed.sessionSalt ? `${parsed.sessionSalt}_` : '';
      return parsed.uid ? `${parsed.uid}_${saltPart}yoy_secure_salt` : 'default_sec_key';
    }
  } catch (e) {}
  return 'default_sec_key';
};

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
    const rawVal = originalGetItem.call(this, prefix + key);
    if (!rawVal) return rawVal;

    const secKey = getSecureKey();
    if (secKey && secKey !== 'default_sec_key' && secKey !== 'invalid') {
      const decrypted = decryptValue(rawVal, secKey);
      if (decrypted !== null) return decrypted;
    }
    return rawVal;
  };

  Storage.prototype.setItem = function(key, value) {
    if (key === 'yoy_ia_session') {
      try {
        const parsed = JSON.parse(value);
        if (parsed.salonId) {
          originalSetItem.call(this, 'yoy_terminal_salon_id', parsed.salonId);
        }
        let modified = false;
        
        // Read existing session to check for salt preservation
        const existingSessionStr = originalGetItem.call(this, 'yoy_ia_session');
        let existingSession = null;
        if (existingSessionStr) {
          try {
            existingSession = JSON.parse(existingSessionStr);
          } catch (e) {}
        }
        
        if (!parsed.sessionSalt) {
          if (existingSession && existingSession.uid === parsed.uid) {
            if (existingSession.sessionSalt) {
              parsed.sessionSalt = existingSession.sessionSalt;
              modified = true;
            }
          } else {
            parsed.sessionSalt = Math.random().toString(36).substring(2) + Math.random().toString(36).substring(2);
            modified = true;
          }
        }
        if (!parsed.integrity) {
          const { integrity, ...sessionData } = parsed;
          parsed.integrity = generateChecksum(sessionData, 'yoy_integrity_salt');
          modified = true;
        } else if (modified) {
          const { integrity, ...sessionData } = parsed;
          parsed.integrity = generateChecksum(sessionData, 'yoy_integrity_salt');
        }
        if (modified) {
          value = JSON.stringify(parsed);
        }
      } catch (e) {}
      return originalSetItem.call(this, key, value);
    }
    if (key.startsWith('yoy_lockout_') || key === 'yoy_billar_secure_key') {
      return originalSetItem.call(this, key, value);
    }
    const prefix = getSalonPrefix();
    const secKey = getSecureKey();
    if (secKey && secKey !== 'default_sec_key' && secKey !== 'invalid' && value) {
      const encrypted = encryptValue(value, secKey);
      return originalSetItem.call(this, prefix + key, encrypted);
    }
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
  const [isOffline, setIsOffline] = useState(false);
  const [offlineLockout, setOfflineLockout] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleOnline = () => setIsOffline(false);
    const handleOffline = () => setIsOffline(true);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    setIsOffline(!navigator.onLine);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

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

  const logOfflineUnlock = (supervisorName, supervisorId) => {
    try {
      const getFn = window.__original_getItem__ || localStorage.getItem;
      const setFn = window.__original_setItem__ || localStorage.setItem;
      
      const secKey = getSecureKey();
      const existingLogsRaw = getFn.call(localStorage, 'yoy_offline_audit_log');
      let logs = [];
      if (existingLogsRaw) {
        try {
          if (secKey && secKey !== 'default_sec_key' && secKey !== 'invalid') {
            const decrypted = decryptValue(existingLogsRaw, secKey);
            logs = decrypted ? JSON.parse(decrypted) : [];
          } else {
            logs = JSON.parse(existingLogsRaw);
          }
        } catch (decErr) {
          console.warn("Fallo al descifrar logs de auditoría locales, intentando lectura cruda:", decErr);
          try {
            logs = JSON.parse(existingLogsRaw);
          } catch(e) {
            logs = [];
          }
        }
      }
      
      const newLog = {
        id: Date.now().toString() + '_' + Math.random().toString(36).substring(2, 7),
        fecha: new Date().toISOString(),
        usuario: supervisorName,
        supervisorId: supervisorId,
        metodo: 'offline_unlock',
        exito: true,
        detalle: 'Desbloqueo de terminal en modo offline por supervisor',
        dominio: typeof window !== 'undefined' ? window.location.hostname : 'localhost',
        userAgent: typeof window !== 'undefined' ? window.navigator.userAgent : 'Server'
      };
      
      logs.push(newLog);
      
      // Limitar capacidad local (Sugerencia 3): mantener max 200 logs
      if (logs.length > 200) {
        logs = logs.slice(logs.length - 200);
      }
      
      const serialized = JSON.stringify(logs);
      if (secKey && secKey !== 'default_sec_key' && secKey !== 'invalid') {
        const encrypted = encryptValue(serialized, secKey);
        setFn.call(localStorage, 'yoy_offline_audit_log', encrypted);
      } else {
        setFn.call(localStorage, 'yoy_offline_audit_log', serialized);
      }
      console.log(`[Offline Audit] Desbloqueo registrado localmente y cifrado para ${supervisorName}.`);
    } catch (err) {
      console.error("Error logging offline unlock:", err);
    }
  };

  const uploadOfflineLogs = async () => {
    if (typeof window === 'undefined' || !navigator.onLine) return;
    
    try {
      const getFn = window.__original_getItem__ || localStorage.getItem;
      const setFn = window.__original_setItem__ || localStorage.setItem;
      
      const logsRaw = getFn.call(localStorage, 'yoy_offline_audit_log');
      if (!logsRaw) return;
      
      const secKey = getSecureKey();
      let logs = [];
      try {
        if (secKey && secKey !== 'default_sec_key' && secKey !== 'invalid') {
          const decrypted = decryptValue(logsRaw, secKey);
          logs = decrypted ? JSON.parse(decrypted) : [];
        } else {
          logs = JSON.parse(logsRaw);
        }
      } catch (decErr) {
        console.warn("Fallo al descifrar logs offline para subida, intentando lectura cruda:", decErr);
        try {
          logs = JSON.parse(logsRaw);
        } catch(e) {
          return;
        }
      }
      
      if (logs.length === 0) return;
      
      console.log(`[Offline Audit Sync] Subiendo ${logs.length} logs de auditoría offline...`);
      
      for (const log of logs) {
        const { id, fecha, ...logData } = log;
        await addDoc(collection(db, 'auditoria_accesos'), {
          ...logData,
          fecha: new Date(fecha)
        });
      }
      
      setFn.call(localStorage, 'yoy_offline_audit_log', '');
      console.log("[Offline Audit Sync] Sincronización de logs completada con éxito.");
    } catch (err) {
      console.error("Error uploading offline audit logs:", err);
    }
  };

  const unlockOffline = async (nip) => {
    try {
      const activeSalonId = getActiveSalonId();
      const doubleSaltedHash = await hashNip(nip.trim(), activeSalonId);
      const qEmp = query(
        collection(db, 'nomina_empleados'),
        where('salonId', '==', activeSalonId),
        where('nip', '==', doubleSaltedHash)
      );
      const snapEmp = await getDocs(qEmp);
      
      let empDoc = null;
      let empData = null;
      
      if (!snapEmp.empty) {
        empDoc = snapEmp.docs[0];
        empData = empDoc.data();
      } else {
        const classicHash = await hashNip(nip.trim());
        const qEmpClassic = query(
          collection(db, 'nomina_empleados'),
          where('salonId', '==', activeSalonId),
          where('nip', '==', classicHash)
        );
        const snapEmpClassic = await getDocs(qEmpClassic);
        if (!snapEmpClassic.empty) {
          empDoc = snapEmpClassic.docs[0];
          empData = empDoc.data();
          
          try {
            const empRef = doc(db, 'nomina_empleados', empDoc.id);
            await updateDoc(empRef, { nip: doubleSaltedHash });
            console.log(`[Offline Hot Migration] NIP migration queued for ${empData.nombre}.`);
          } catch (migrationErr) {
            console.error("[Offline Hot Migration] Failed to queue NIP migration:", migrationErr);
          }
        }
      }
      
      if (empDoc && empData) {
        const role = (empData.rol || empData.role || 'mesero').toLowerCase();
        if (role === 'admin' || role === 'gerente') {
          window.__last_successful_sync__ = Date.now();
          setOfflineLockout(false);
          console.log(`[Offline Lockout] Desbloqueo exitoso por supervisor "${empData.nombre}".`);
          logOfflineUnlock(empData.nombre, empDoc.id);
          return { success: true, name: empData.nombre };
        } else {
          return { success: false, error: 'Acceso denegado. Rol insuficiente (se requiere Cajero/Gerente/Admin).' };
        }
      } else {
        return { success: false, error: 'NIP de supervisor incorrecto.' };
      }
    } catch (e) {
      console.error("Error during offline unlock:", e);
      return { success: false, error: 'Error de verificación.' };
    }
  };

  const syncCustomClaims = async (uid, salonId, onSuspendedUpdate) => {
    let headers = { 'Content-Type': 'application/json' };
    try {
      if (auth.currentUser) {
        const token = await auth.currentUser.getIdToken();
        headers['Authorization'] = `Bearer ${token}`;
      }
    } catch (e) {
      console.warn("No se pudo obtener el ID token de Firebase Auth para la firma de claims:", e);
    }

    fetch('/api/auth/set-claims', {
      method: 'POST',
      headers,
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
      setOfflineLockout(false);
      return;
    }

    // Registrar la última sincronización exitosa como el momento actual
    window.__last_successful_sync__ = Date.now();

    // 1. Consulta rápida inicial pasiva
    checkSalonStatus(user.salonId);

    // 2. Escucha reactiva en tiempo real sobre el documento del salón
    const salonRef = doc(db, 'salones', user.salonId);
    const unsubscribe = onSnapshot(salonRef, (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        const suspended = data.status === 'suspendido';
        setIsSuspended(suspended);

        // Si la lectura proviene del servidor (no caché), actualizamos el latido
        if (!docSnap.metadata.fromCache) {
          window.__last_successful_sync__ = Date.now();
          setOfflineLockout(false);
          uploadOfflineLogs();
        }

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

    // 3. Monitoreo de latido (Heartbeat check) para detectar desconexión prolongada
    const heartbeatInterval = setInterval(() => {
      const lastSync = window.__last_successful_sync__ || Date.now();
      const diffMinutes = (Date.now() - lastSync) / 60000;
      // Si pasan más de 15 minutos sin conexión exitosa, activar bloqueo offline preventivo
      if (diffMinutes > 15) {
        setOfflineLockout(true);
      } else {
        setOfflineLockout(false);
      }
    }, 30000); // Evaluar cada 30 segundos

    return () => {
      unsubscribe();
      clearInterval(heartbeatInterval);
    };
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
        const activeSalonId = getActiveSalonId();
        const doubleSaltedHash = await hashNip(trimmedInput, activeSalonId);
        
        let qEmp = query(
          collection(db, 'nomina_empleados'),
          where('salonId', '==', activeSalonId),
          where('nip', '==', doubleSaltedHash)
        );
        let snapEmp = await getDocs(qEmp);
        
        let empDoc = null;
        let empData = null;
        
        if (!snapEmp.empty) {
          empDoc = snapEmp.docs[0];
          empData = empDoc.data();
        } else {
          const classicHash = await hashNip(trimmedInput);
          const qEmpClassic = query(
            collection(db, 'nomina_empleados'),
            where('salonId', '==', activeSalonId),
            where('nip', '==', classicHash)
          );
          const snapEmpClassic = await getDocs(qEmpClassic);
          if (!snapEmpClassic.empty) {
            empDoc = snapEmpClassic.docs[0];
            empData = empDoc.data();
            
            try {
              const empRef = doc(db, 'nomina_empleados', empDoc.id);
              await updateDoc(empRef, { nip: doubleSaltedHash });
              console.log(`[Hot Migration] NIP migrated successfully to double-salted hash for ${empData.nombre}.`);
            } catch (migrationErr) {
              console.error("[Hot Migration] Failed to migrate NIP to double-salted hash:", migrationErr);
            }
          }
        }
        
        if (empDoc && empData) {
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
    <AuthContext.Provider value={{ user, loading, login, logout, loginWithEmpleadoId, isSuspended, isOffline, offlineLockout, unlockOffline }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}

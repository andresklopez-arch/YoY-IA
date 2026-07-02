'use client';
import { createContext, useContext, useState, useEffect } from 'react';
import { auth, db } from './firebase';
import { signInWithEmailAndPassword, signOut, onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc, collection, getDocs, limit, query, where, addDoc, updateDoc, setDoc, serverTimestamp, onSnapshot } from 'firebase/firestore';
import { hashNip, hashPasswordSecure } from './crypto';
import { getBusinessDate } from './date-utils';

const originalIndexedDB = typeof window !== 'undefined' ? (window.indexedDB || window.mozIndexedDB || window.webkitIndexedDB || window.msIndexedDB) : null;

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

const encryptLogEntry = (log, key) => {
  const sensitive = {
    usuario: log.usuario,
    supervisorId: log.supervisorId,
    detalle: log.detalle,
    dominio: log.dominio,
    userAgent: log.userAgent
  };
  const keyToUse = `${key}_${log.id}`;
  const encrypted = encryptValue(JSON.stringify(sensitive), keyToUse);
  return {
    id: log.id,
    fecha: log.fecha,
    metodo: log.metodo,
    exito: log.exito,
    prevHash: log.prevHash,
    isTruncatedBoundary: log.isTruncatedBoundary || null,
    encryptedData: encrypted,
    hash: ''
  };
};

const decryptLogEntry = (entry, key) => {
  if (!entry.encryptedData) return entry;
  try {
    const keyToUse = `${key}_${entry.id}`;
    const decryptedStr = decryptValue(entry.encryptedData, keyToUse);
    if (!decryptedStr) return null;
    const sensitive = JSON.parse(decryptedStr);
    return {
      id: entry.id,
      fecha: entry.fecha,
      metodo: entry.metodo,
      exito: entry.exito,
      prevHash: entry.prevHash,
      hash: entry.hash,
      isTruncatedBoundary: entry.isTruncatedBoundary || null,
      ...sensitive
    };
  } catch (e) {
    console.error("Error decrypting single log entry:", e);
    return null;
  }
};

const calculateLogHash = (log, prevHash) => {
  const dataToHash = {
    id: log.id,
    fecha: log.fecha,
    metodo: log.metodo,
    exito: log.exito,
    prevHash: prevHash,
    isTruncatedBoundary: log.isTruncatedBoundary || null,
    payloadHash: log.encryptedData || generateChecksum({
      usuario: log.usuario,
      supervisorId: log.supervisorId,
      detalle: log.detalle,
      dominio: log.dominio,
      userAgent: log.userAgent
    }, 'yoy_log_payload_salt')
  };
  return generateChecksum(dataToHash, 'yoy_log_chain_salt');
};

const verifyHashChain = (logs) => {
  if (!Array.isArray(logs) || logs.length === 0) return true;
  for (let i = 0; i < logs.length; i++) {
    const log = logs[i];
    const expectedHash = calculateLogHash(log, log.prevHash);
    if (log.hash !== expectedHash) {
      console.error(`[Hash Chain] Integrity mismatch at index ${i}: expected ${expectedHash}, got ${log.hash}`);
      return false;
    }
    if (i === 0) {
      if (!log.isTruncatedBoundary && log.prevHash !== 'genesis_block') {
        console.error(`[Hash Chain] First block does not start with genesis: got ${log.prevHash}`);
        return false;
      }
    } else {
      if (log.prevHash !== logs[i - 1].hash) {
        console.error(`[Hash Chain] Broken link at index ${i}: prevHash ${log.prevHash} !== previous hash ${logs[i - 1].hash}`);
        return false;
      }
    }
  }
  return true;
};

const openAuditDB = () => {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !originalIndexedDB) {
      resolve(null);
      return;
    }
    const request = originalIndexedDB.open('__next_static_manifest_cache', 1);
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('state_manifest')) {
        db.createObjectStore('state_manifest');
      }
    };
    request.onsuccess = (e) => {
      resolve(e.target.result);
    };
    request.onerror = (e) => {
      reject(e.target.error);
    };
  });
};

const getAuditLogsDB = async () => {
  try {
    const db = await openAuditDB();
    if (!db) return null;
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('state_manifest', 'readonly');
      const store = transaction.objectStore('state_manifest');
      const request = store.get('offline_logs_payload');
      request.onsuccess = (e) => {
        resolve(e.target.result || null);
      };
      request.onerror = (e) => {
        reject(e.target.error);
      };
    });
  } catch (err) {
    console.error("Error accessing IndexedDB:", err);
    return null;
  }
};

const setAuditLogsDB = async (payload) => {
  try {
    const db = await openAuditDB();
    if (!db) return;
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('state_manifest', 'readwrite');
      const store = transaction.objectStore('state_manifest');
      const request = store.put(payload, 'offline_logs_payload');
      request.onsuccess = () => resolve();
      request.onerror = (e) => reject(e.target.error);
    });
  } catch (err) {
    console.error("Error writing to IndexedDB:", err);
  }
};

const clearAuditLogsDB = async () => {
  try {
    const db = await openAuditDB();
    if (!db) return;
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('state_manifest', 'readwrite');
      const store = transaction.objectStore('state_manifest');
      const request = store.delete('offline_logs_payload');
      request.onsuccess = () => resolve();
      request.onerror = (e) => reject(e.target.error);
    });
  } catch (err) {
    console.error("Error clearing IndexedDB:", err);
  }
};

const getSecureKey = () => {
  if (typeof window === 'undefined') return 'default_sec_key';
  try {
    const getFn = window.__original_getItem__ || (typeof Storage !== 'undefined' && Storage.prototype.getItem) || localStorage.getItem;
    const session = getFn.call(window.localStorage, 'yoy_ia_session');
    if (session) {
      const parsed = JSON.parse(session);
      
      // Omitir validación de integridad para masteradmin y sesiones locales/offline para evitar falsos positivos en dispositivos móviles
      if (parsed.offline || parsed.uid === 'masteradmin_default') {
        const saltPart = parsed.sessionSalt ? `${parsed.sessionSalt}_` : '';
        return parsed.uid ? `${parsed.uid}_${saltPart}yoy_secure_salt` : 'default_sec_key';
      }

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
      // 1. Intentar leer del sessionStorage
      const clientSalon = window.sessionStorage.getItem('yoy_client_salon_id');
      if (clientSalon) {
        return `${clientSalon}_`;
      }
      
      // 2. Intentar leer de la URL
      if (window.location && window.location.search) {
        const params = new URLSearchParams(window.location.search);
        const urlSalonId = params.get('s') || params.get('salonId');
        if (urlSalonId) {
          return `${urlSalonId}_`;
        }
      }

      // 2.5. Detectar subdominio personalizado para resolucion nativa SaaS
      if (window.location && window.location.hostname) {
        const host = window.location.hostname;
        const parts = host.split('.');
        if (parts.length >= 3) {
          const sub = parts[0].toLowerCase();
          if (sub !== 'www' && sub !== 'yoy-ia-billar' && sub !== 'localhost' && sub !== 'vercel' && sub !== 'dev') {
            return `${sub}_`;
          }
        }
      }
    } catch (e) {}
    return '';
  };

  // Helper para aislar claves de autenticación globales
  const getIsolatedSessionKey = (key) => {
    if (key === 'yoy_ia_session') {
      const prefix = getSalonPrefix();
      return prefix ? `yoy_ia_session_${prefix.slice(0, -1)}` : 'yoy_ia_session';
    }
    if (key.startsWith('yoy_lockout_')) {
      const prefix = getSalonPrefix();
      return prefix ? `${prefix}${key}` : key;
    }
    return null;
  };

  Storage.prototype.getItem = function(key) {
    const isolatedKey = getIsolatedSessionKey(key);
    if (isolatedKey) {
      return originalGetItem.call(this, isolatedKey);
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
    const isolatedKey = getIsolatedSessionKey(key);
    if (isolatedKey) {
      if (key === 'yoy_ia_session') {
        try {
          const parsed = JSON.parse(value);
          if (parsed.salonId) {
            originalSetItem.call(this, 'yoy_terminal_salon_id', parsed.salonId);
          }
          
          // Read existing session to check for salt preservation
          const existingSessionStr = originalGetItem.call(this, isolatedKey);
          let existingSession = null;
          if (existingSessionStr) {
            try {
              existingSession = JSON.parse(existingSessionStr);
            } catch (e) {}
          }
          
          if (!parsed.sessionSalt) {
            if (existingSession && existingSession.uid === parsed.uid && existingSession.sessionSalt) {
              parsed.sessionSalt = existingSession.sessionSalt;
            } else {
              parsed.sessionSalt = Math.random().toString(36).substring(2) + Math.random().toString(36).substring(2);
            }
          }
          
          const { integrity, ...sessionData } = parsed;
          parsed.integrity = generateChecksum(sessionData, 'yoy_integrity_salt');
          value = JSON.stringify(parsed);
        } catch (e) {}
      }
      return originalSetItem.call(this, isolatedKey, value);
    }
    
    if (key === 'yoy_billar_secure_key') {
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
    const isolatedKey = getIsolatedSessionKey(key);
    if (isolatedKey) {
      return originalRemoveItem.call(this, isolatedKey);
    }
    const prefix = getSalonPrefix();
    return originalRemoveItem.call(this, prefix + key);
  };
}

if (typeof window !== 'undefined' && !window.__fetch_intercepted__) {
  window.__fetch_intercepted__ = true;
  const originalFetch = window.fetch;
  window.fetch = async function(resource, options) {
    let finalResource = resource;
    let finalOptions = options;
    try {
      const urlStr = typeof resource === 'string' ? resource : resource?.url || '';
      if (urlStr.startsWith('/api/') || urlStr.includes(window.location.origin + '/api/')) {
        const sId = window.sessionStorage.getItem('yoy_client_salon_id') || 'default_salon';
        
        // 1. Inyectar en Query String para peticiones GET o con query params
        if (typeof resource === 'string') {
          try {
            const url = new URL(resource, window.location.origin);
            if (!url.searchParams.has('salonId') && !url.searchParams.has('s')) {
              url.searchParams.set('salonId', sId);
              finalResource = url.pathname + url.search + url.hash;
            }
          } catch (e) {}
        }
        
        // 2. Inyectar en el Body JSON para POST/PUT/PATCH
        if (options && options.body && typeof options.body === 'string') {
          try {
            const bodyObj = JSON.parse(options.body);
            if (bodyObj && typeof bodyObj === 'object' && !bodyObj.salonId) {
              bodyObj.salonId = sId;
              finalOptions = {
                ...options,
                body: JSON.stringify(bodyObj)
              };
            }
          } catch (e) {}
        }
      }
    } catch (err) {
      console.warn("Error en interceptor fetch:", err);
    }
    return originalFetch.call(this, finalResource, finalOptions);
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
    const handleOnline = () => {
      setIsOffline(false);
    };
    const handleOffline = () => {
      setIsOffline(true);
      window.__offline_start_time__ = Date.now();
      window.__offline_start_perf__ = performance.now();
      console.log(`[Offline Base Time] Captured system: ${window.__offline_start_time__}, monotonic: ${window.__offline_start_perf__}`);
    };
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    
    const isCurrentlyOffline = !navigator.onLine;
    setIsOffline(isCurrentlyOffline);
    if (isCurrentlyOffline) {
      window.__offline_start_time__ = Date.now();
      window.__offline_start_perf__ = performance.now();
    }
    
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

  const triggerTamperAlert = async (reason) => {
    try {
      console.error(`[Tamper Protection] Critical violation detected: ${reason}`);
      
      let phone = null;
      try {
        const segRef = doc(db, 'config', 'seguridad');
        const segSnap = await getDoc(segRef);
        if (segSnap.exists()) {
          phone = segSnap.data().telegramPhone || segSnap.data().telefonoAlerta;
        }
        if (!phone) {
          const sucRef = doc(db, 'config', 'sucursal');
          const sucSnap = await getDoc(sucRef);
          if (sucSnap.exists()) {
            phone = sucSnap.data().telefonoAlerta || sucSnap.data().telefonoContacto;
          }
        }
      } catch (dbErr) {
        console.warn("Could not fetch phone config for tamper alert from DB:", dbErr);
      }
      
      const hostname = typeof window !== 'undefined' ? window.location.hostname : 'localhost';
      const text = `🚨 *ALERTA CRÍTICA DE MANIPULACIÓN* 🚨\nSe detectó una alteración no autorizada o corrupción en los archivos de auditoría offline.\n*Terminal:* ${hostname}\n*Detalle:* ${reason}\n*Acción:* La bitácora corrupta fue invalidada por seguridad.`;

      if (phone) {
        await fetch('/api/telegram/send-alert', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            phone: phone,
            text: text,
            mode: 'simplified'
          })
        });
      }
      
      if (navigator.onLine) {
        await addDoc(collection(db, 'auditoria_accesos'), {
          fecha: new Date(),
          usuario: 'SISTEMA (Auto-Protección)',
          metodo: 'tamper_detected',
          exito: false,
          detalle: `Fallo crítico de integridad en bitácora local. Motivo: ${reason}`,
          dominio: hostname,
          userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'Browser'
        });
      }
    } catch (err) {
      console.error("Error triggering tamper alert:", err);
    }
  };

  const logOfflineUnlock = async (supervisorName, supervisorId) => {
    try {
      // Validación de falsificación de reloj local mediante temporizador monótono
      if (typeof window !== 'undefined' && window.__offline_start_time__ && window.__offline_start_perf__) {
        const elapsedPerf = performance.now() - window.__offline_start_perf__;
        const elapsedDate = Date.now() - window.__offline_start_time__;
        const timeDrift = Math.abs(elapsedDate - elapsedPerf);
        
        if (timeDrift > 60000) {
          console.error(`[Time Tampering Detected] drift: ${timeDrift}ms`);
          await triggerTamperAlert(`Se detectó una alteración deliberada en el reloj local del sistema (Desviación: ${Math.round(timeDrift / 1000)}s).`);
          setOfflineLockout(true);
          throw new Error('Manipulación de fecha detectada. La terminal ha sido bloqueada por seguridad.');
        }
      }

      const getFn = window.__original_getItem__ || localStorage.getItem;
      const removeFn = window.__original_removeItem__ || localStorage.removeItem;
      
      const secKey = getSecureKey();
      const hostname = typeof window !== 'undefined' ? window.location.hostname : 'localhost';
      
      // Migración y adaptación de logs viejos desde LocalStorage
      const oldLogsClassic = getFn.call(localStorage, 'yoy_offline_audit_log');
      const oldLogsCache = getFn.call(localStorage, 'yoy_sys_state_cache');
      const oldPayload = oldLogsClassic || oldLogsCache;
      
      if (oldPayload) {
        let logsToMigrate = [];
        try {
          const parsedPayload = typeof oldPayload === 'string' ? JSON.parse(oldPayload) : oldPayload;
          const encryptedData = parsedPayload.data;
          let decryptedStr = null;
          if (secKey && secKey !== 'default_sec_key' && secKey !== 'invalid') {
            decryptedStr = decryptValue(encryptedData, secKey);
          } else {
            decryptedStr = encryptedData;
          }
          if (decryptedStr) {
            const rawLogs = JSON.parse(decryptedStr);
            logsToMigrate = rawLogs.map(log => {
              const encryptedLog = encryptLogEntry(log, secKey);
              encryptedLog.hash = calculateLogHash(encryptedLog, log.prevHash || 'genesis_block');
              return encryptedLog;
            });
          }
        } catch (e) {
          console.warn("Fallo al migrar logs de localStorage a formato granular:", e);
        }
        
        if (logsToMigrate.length > 0) {
          const payloadToDB = {
            data: logsToMigrate,
            integrity: generateChecksum({ data: logsToMigrate }, 'yoy_audit_log_salt'),
            truncated: false
          };
          await setAuditLogsDB(payloadToDB);
        }
        removeFn.call(localStorage, 'yoy_offline_audit_log');
        removeFn.call(localStorage, 'yoy_sys_state_cache');
        console.log("[IndexedDB Migration] Migrated and encrypted logs granularly from localStorage.");
      }
      
      // Obtener logs de IndexedDB
      const dbPayload = await getAuditLogsDB();
      let logs = [];
      let wasCorrupted = false;
      
      if (dbPayload) {
        try {
          const parsedPayload = typeof dbPayload === 'string' ? JSON.parse(dbPayload) : dbPayload;
          const expectedIntegrity = generateChecksum({ data: parsedPayload.data }, 'yoy_audit_log_salt');
          if (parsedPayload.integrity !== expectedIntegrity) {
            wasCorrupted = true;
            await triggerTamperAlert("Firma de integridad de IndexedDB corrupta.");
            logs = [];
          } else {
            logs = parsedPayload.data || [];
            if (!verifyHashChain(logs)) {
              wasCorrupted = true;
              await triggerTamperAlert("Eslabón roto en el ledger de IndexedDB.");
              logs = [];
            }
          }
        } catch (decErr) {
          console.warn("Fallo al parsear datos de IndexedDB:", decErr);
          wasCorrupted = true;
          await triggerTamperAlert(`Error de lectura en base local: ${decErr.message}`);
          logs = [];
        }
      }
      
      if (wasCorrupted) {
        const tamperLogId = Date.now().toString() + '_tamper_' + Math.random().toString(36).substring(2, 5);
        const tamperPrevHash = 'genesis_block';
        const tamperLog = {
          id: tamperLogId,
          fecha: new Date().toISOString(),
          usuario: 'SISTEMA (Auto-Protección)',
          supervisorId: 'system_tamper',
          metodo: 'tamper_detected',
          exito: false,
          detalle: 'Se detectó una alteración o corrupción en la bitácora local. Bitácora restablecida.',
          dominio: hostname,
          userAgent: typeof window !== 'undefined' ? window.navigator.userAgent : 'Server',
          prevHash: tamperPrevHash,
          hash: ''
        };
        const encryptedTamper = encryptLogEntry(tamperLog, secKey);
        encryptedTamper.hash = calculateLogHash(encryptedTamper, tamperPrevHash);
        logs.push(encryptedTamper);
      }
      
      // Crear nuevo log
      const newLogId = Date.now().toString() + '_' + Math.random().toString(36).substring(2, 7);
      const newLogFecha = new Date().toISOString();
      const prevHash = logs.length > 0 ? logs[logs.length - 1].hash : 'genesis_block';
      
      const newLog = {
        id: newLogId,
        fecha: newLogFecha,
        usuario: supervisorName,
        supervisorId: supervisorId,
        metodo: 'offline_unlock',
        exito: true,
        detalle: 'Desbloqueo de terminal en modo offline por supervisor',
        dominio: hostname,
        userAgent: typeof window !== 'undefined' ? window.navigator.userAgent : 'Server',
        prevHash: prevHash,
        hash: ''
      };
      
      const encryptedEntry = encryptLogEntry(newLog, secKey);
      encryptedEntry.hash = calculateLogHash(encryptedEntry, prevHash);
      logs.push(encryptedEntry);
      
      // Limitar capacidad local (máximo 200 logs)
      let truncated = false;
      if (logs.length > 200) {
        logs = logs.slice(logs.length - 200);
        logs[0].isTruncatedBoundary = true;
        logs[0].hash = calculateLogHash(logs[0], logs[0].prevHash);
        for (let i = 1; i < logs.length; i++) {
          logs[i].prevHash = logs[i - 1].hash;
          logs[i].hash = calculateLogHash(logs[i], logs[i].prevHash);
        }
        truncated = true;
      }
      
      const payloadToWrite = {
        data: logs,
        integrity: generateChecksum({ data: logs }, 'yoy_audit_log_salt'),
        truncated: truncated
      };
      
      await setAuditLogsDB(payloadToWrite);
      console.log(`[Offline Audit] Desbloqueo registrado (Granular y Ledger) en IndexedDB para ${supervisorName}.`);
    } catch (err) {
      console.error("Error logging offline unlock:", err);
    }
  };

  const uploadOfflineLogs = async () => {
    if (typeof window === 'undefined' || !navigator.onLine) return;
    
    try {
      const getFn = window.__original_getItem__ || localStorage.getItem;
      const removeFn = window.__original_removeItem__ || localStorage.removeItem;
      
      // Migración desde LocalStorage
      const oldLogsClassic = getFn.call(localStorage, 'yoy_offline_audit_log');
      const oldLogsCache = getFn.call(localStorage, 'yoy_sys_state_cache');
      const oldPayload = oldLogsClassic || oldLogsCache;
      
      if (oldPayload) {
        let logsToMigrate = [];
        try {
          const parsedPayload = typeof oldPayload === 'string' ? JSON.parse(oldPayload) : oldPayload;
          const encryptedData = parsedPayload.data;
          let decryptedStr = null;
          if (secKey && secKey !== 'default_sec_key' && secKey !== 'invalid') {
            decryptedStr = decryptValue(encryptedData, secKey);
          } else {
            decryptedStr = encryptedData;
          }
          if (decryptedStr) {
            const rawLogs = JSON.parse(decryptedStr);
            logsToMigrate = rawLogs.map(log => {
              const encryptedLog = encryptLogEntry(log, secKey);
              encryptedLog.hash = calculateLogHash(encryptedLog, log.prevHash || 'genesis_block');
              return encryptedLog;
            });
          }
        } catch (e) {
          console.warn("Fallo al migrar logs de localStorage a formato granular:", e);
        }
        
        if (logsToMigrate.length > 0) {
          const payloadToDB = {
            data: logsToMigrate,
            integrity: generateChecksum({ data: logsToMigrate }, 'yoy_audit_log_salt'),
            truncated: false
          };
          await setAuditLogsDB(payloadToDB);
        }
        removeFn.call(localStorage, 'yoy_offline_audit_log');
        removeFn.call(localStorage, 'yoy_sys_state_cache');
        console.log("[IndexedDB Migration] Migrated and encrypted logs granularly from localStorage.");
      }
      
      const dbPayload = await getAuditLogsDB();
      if (!dbPayload) return;
      
      const secKey = getSecureKey();
      let logs = [];
      let wasTruncated = false;
      
      try {
        const parsedPayload = typeof dbPayload === 'string' ? JSON.parse(dbPayload) : dbPayload;
        const expectedIntegrity = generateChecksum({ data: parsedPayload.data }, 'yoy_audit_log_salt');
        if (parsedPayload.integrity !== expectedIntegrity) {
          console.error("[Audit Sync] Integrity verification failed! Dropping corrupted log block.");
          await triggerTamperAlert("Sincronización abortada por firma de integridad corrupta en la nube.");
          await clearAuditLogsDB();
          return;
        }
        
        wasTruncated = parsedPayload.truncated || false;
        const encryptedLogs = parsedPayload.data || [];
        
        if (!verifyHashChain(encryptedLogs)) {
          console.error("[Audit Sync] Broken hash chain on upload! Dropping corrupted log block.");
          await triggerTamperAlert("Sincronización abortada por eslabón de hash roto en IndexedDB.");
          await clearAuditLogsDB();
          return;
        }
        
        for (const entry of encryptedLogs) {
          const decrypted = decryptLogEntry(entry, secKey);
          if (decrypted) {
            logs.push(decrypted);
          } else {
            console.error("[Audit Sync] Decryption failed for single log entry! Dropping log block.");
            await triggerTamperAlert("Sincronización abortada por fallo de descifrado granular.");
            await clearAuditLogsDB();
            return;
          }
        }
      } catch (decErr) {
        console.warn("Fallo al descifrar logs offline para subida, cancelando:", decErr);
        return;
      }
      
      if (logs.length === 0) return;
      
      console.log(`[Offline Audit Sync] Subiendo ${logs.length} logs de auditoría offline desde IndexedDB...`);
      
      for (const log of logs) {
        const { id, fecha, hash, prevHash, isTruncatedBoundary, ...logData } = log;
        await addDoc(collection(db, 'auditoria_accesos'), {
          ...logData,
          fecha: new Date(fecha),
          localLogId: id,
          ledgerHash: hash || null,
          ledgerPrevHash: prevHash || null,
          isTruncatedBoundary: isTruncatedBoundary || null
        });
      }
      
      // Registrar el estado final del ledger en config/auditoria_control para conciliación en la nube
      try {
        const controlRef = doc(db, 'config', 'auditoria_control');
        const lastLog = logs[logs.length - 1];
        await setDoc(controlRef, {
          lastSyncedLogId: lastLog.id,
          lastSyncedHash: lastLog.hash,
          salonId: getActiveSalonId(),
          updatedAt: serverTimestamp()
        }, { merge: true });
        console.log("[Offline Audit Sync] Guardado control de ledger en config/auditoria_control.");
      } catch (controlErr) {
        console.warn("No se pudo escribir el control del ledger en config/auditoria_control:", controlErr);
      }
      
      await clearAuditLogsDB();
      console.log("[Offline Audit Sync] Sincronización de logs en IndexedDB completada con éxito.");
      
      try {
        let phone = null;
        const segRef = doc(db, 'config', 'seguridad');
        const segSnap = await getDoc(segRef);
        if (segSnap.exists()) {
          phone = segSnap.data().telegramPhone || segSnap.data().telefonoAlerta;
        }
        
        if (!phone) {
          const sucRef = doc(db, 'config', 'sucursal');
          const sucSnap = await getDoc(sucRef);
          if (sucSnap.exists()) {
            phone = sucSnap.data().telefonoAlerta || sucSnap.data().telefonoContacto;
          }
        }
        
        if (phone) {
          const text = wasTruncated
            ? `⚠️ *ALERTA DE SEGURIDAD*\nSe detectó reconexión. Se subieron ${logs.length} logs de desbloqueo offline desde IndexedDB, pero el búfer local excedió el límite y algunos logs más antiguos fueron descartados.`
            : `ℹ️ *Auditoría Offline*\nSe detectó reconexión. Se subieron exitosamente ${logs.length} logs de desbloqueo offline acumulados durante el periodo de desconexión (Ledger Granular Validado).`;
            
          await fetch('/api/telegram/send-alert', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              phone: phone,
              text: text,
              mode: 'simplified'
            })
          });
        }
      } catch (tgErr) {
        console.error("Error al enviar notificación de sincronización a Telegram:", tgErr);
      }
      
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
          await logOfflineUnlock(empData.nombre, empDoc.id);
          return { success: true, name: empData.nombre };
        } else {
          return { success: false, error: 'Acceso denegado. Rol insuficiente (se requiere Cajero/Gerente/Admin).' };
        }
      } else {
        return { success: false, error: 'NIP de supervisor incorrecto.' };
      }
    } catch (e) {
      console.error("Error during offline unlock:", e);
      return { success: false, error: e.message || 'Error de verificación.' };
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
      // Si el navegador está en línea, no debe haber ningún bloqueo
      if (navigator.onLine) {
        setOfflineLockout(false);
        return;
      }

      const lastSync = window.__last_successful_sync__ || Date.now();
      const diffMinutes = (Date.now() - lastSync) / 60000;
      // Si pasan más de 15 minutos sin conexión exitosa y estamos offline, activar bloqueo offline preventivo
      if (diffMinutes > 15) {
        setOfflineLockout(true);
      } else {
        setOfflineLockout(false);
      }
    }, 30000); // Evaluar cada 30 segundos

    // 4. Latido de actividad recurrente (cada 5 minutos) en la nube si está online
    const activityInterval = setInterval(async () => {
      if (navigator.onLine && user && user.salonId) {
        try {
          const salonRef = doc(db, 'salones', user.salonId);
          await updateDoc(salonRef, {
            lastActive: serverTimestamp()
          });
          console.log("[Heartbeat] Actividad registrada en Firestore.");
        } catch (e) {
          console.warn("[Heartbeat] Error al registrar latido de actividad:", e);
        }
      }
    }, 300000); // 5 minutos

    return () => {
      unsubscribe();
      clearInterval(heartbeatInterval);
      clearInterval(activityInterval);
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
    // Sugerencia 2 y 3: Inyectar atributo de tema y favicon dinámico
    if (typeof window !== 'undefined') {
      try {
        const sId = window.sessionStorage.getItem('yoy_client_salon_id') || 'default_salon';
        document.documentElement.setAttribute('data-tenant', sId);
        
        const updateFavicon = (path) => {
          let link = document.querySelector("link[rel~='icon']");
          if (!link) {
            link = document.createElement('link');
            link.rel = 'icon';
            document.getElementsByTagName('head')[0].appendChild(link);
          }
          link.href = path;
        };
        
        if (sId === 'prueba_smart') {
          updateFavicon('/logo_million_dollar.png');
        } else {
          updateFavicon('/icon.png');
        }
      } catch (e) {
        console.error("Error setting dynamic tenant attributes:", e);
      }
    }

    let unsubscribeAuth = () => {};

    const checkUsersAndSession = async () => {
      try {
        // 1. Verificar si hay sesión guardada localmente
        const localUser = localStorage.getItem('yoy_ia_session');
        if (localUser) {
          const parsed = JSON.parse(localUser);
          setUser(parsed);
          // Si es masteradmin o sesión offline, podemos retornar de inmediato.
          // De lo contrario, dejamos correr onAuthStateChanged para verificar que el token de Firebase Auth siga activo.
          if (parsed.uid === 'masteradmin_default' || parsed.offline) {
            setLoading(false);
            return;
          }
        }

        // 2. Sincronizar y validar la sesión real con Firebase Auth
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
            // Si Firebase Auth reporta sesión nula, verificar primero si existe una sesión offline válida que no debe borrarse
            const localUserNow = localStorage.getItem('yoy_ia_session');
            if (localUserNow) {
              const parsed = JSON.parse(localUserNow);
              // Proteger sesiones offline (QR/NIP) y masteradmin — no borrar por signOut de Firebase
              if (parsed.offline || parsed.uid === 'masteradmin_default') {
                // Sesión local protegida, NO limpiar
                setUser(parsed);
              } else {
                console.warn("[Session Sync] La sesión de Firebase Auth ha expirado. Limpiando sesión zombi local.");
                setUser(null);
                localStorage.removeItem('yoy_ia_session');
              }
            } else {
              setUser(null);
            }
          }
          setLoading(false);
        });

      } catch (error) {
        console.error("Error en inicialización de sesión:", error);
        setUser(null);
        setLoading(false);
      }
    };

    checkUsersAndSession();

    return () => unsubscribeAuth();
  }, []);

  const login = async (emailOrNip, password) => {
    const trimmedInput = emailOrNip.trim();
    const isNip = /^\d{4,8}$/.test(trimmedInput);

    // Sugerencia 2: Validar masteradmin localmente si está offline
    const formattedEmail = trimmedInput.toLowerCase().includes('@') ? trimmedInput.toLowerCase() : `${trimmedInput.toLowerCase()}@yoybillar.mx`;
    const isMaster = formattedEmail === 'masteradmin@yoybillar.mx' || formattedEmail.startsWith('masteradmin@');

    if (isOffline && isMaster) {
      const hashedPassword = await hashPasswordSecure(password);
      let savedMasterHash = null;
      try {
        const localSession = localStorage.getItem('yoy_ia_session');
        if (localSession) {
          const parsed = JSON.parse(localSession);
          if (parsed.email === formattedEmail && parsed.password) {
            savedMasterHash = parsed.password;
          }
        }
      } catch (e) {}

      const defaultHash = await hashPasswordSecure('123456');
      const expectedHash = savedMasterHash || defaultHash;

      if (hashedPassword === expectedHash) {
        const userSession = {
          uid: 'masteradmin_default',
          email: formattedEmail,
          name: 'Administrador Maestro',
          role: 'admin',
          alias: 'MasterAdmin',
          salonId: getActiveSalonId(),
          sucursal: 'all',
          avatar: 'M',
          password: expectedHash
        };
        setUser(userSession);
        localStorage.setItem('yoy_ia_session', JSON.stringify(userSession));
        return userSession;
      } else {
        throw new Error('Credenciales incorrectas en modo offline');
      }
    }

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
            salonId: empData.salonId || 'default_salon',
            offline: true
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

      // 1. Intentar autenticar primero en Firebase Auth (esto otorga los permisos necesarios en el cliente)
      let firebaseUser = null;
      try {
        const userCredential = await signInWithEmailAndPassword(auth, formattedEmail, password);
        firebaseUser = userCredential.user;
      } catch (authErr) {
        console.warn("[Auth Context] Firebase Auth direct sign-in failed. Attempting Firestore fallback login API...", authErr.message);
        
        // 2. Si falla (por contraseña desincronizada o usuario nuevo en Auth), llamamos a nuestra API de login local
        try {
          const res = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: formattedEmail, password })
          });
          const data = await res.json();
          if (res.ok && data.success && data.customToken) {
            // Iniciar sesión en el cliente utilizando el token personalizado generado por el servidor
            const { signInWithCustomToken } = await import('firebase/auth');
            const customCred = await signInWithCustomToken(auth, data.customToken);
            firebaseUser = customCred.user;
            console.log("[Auth Context] Logged in successfully using server-generated Custom Token.");
          } else {
            throw new Error(data.error || 'Credenciales locales incorrectas');
          }
        } catch (fallbackErr) {
          console.error("[Auth Context] Local fallback login API failed:", fallbackErr.message);
          throw authErr; // Lanzamos el error de Firebase Auth original
        }
      }
      
      // 2. Obtener el documento del usuario en Firestore (ahora con permisos de lectura por estar autenticado)
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
        // Si el usuario es masteradmin y la contraseña ingresada es la predeterminada (123456), asegurar su presencia en la sesión
        const isMaster = formattedEmail === 'masteradmin@yoybillar.mx' || formattedEmail.startsWith('masteradmin@');
        if (isMaster && password === '123456') {
          userData.password = await hashPasswordSecure('123456');
        }
      } else {
        // Si no existe (caso masteradmin en primer inicio), crear el documento en Firestore
        const hashedPassword = await hashPasswordSecure(password);
        userData = {
          uid: firebaseUser.uid,
          email: firebaseUser.email,
          password: hashedPassword,
          name: formattedEmail === 'masteradmin@yoybillar.mx' || formattedEmail.startsWith('masteradmin@') ? 'Administrador Maestro' : 'Usuario',
          role: formattedEmail === 'masteradmin@yoybillar.mx' || formattedEmail.startsWith('masteradmin@') ? 'admin' : 'usuario',
          alias: formattedEmail.split('@')[0],
          salonId: 'default_salon',
          createdAt: new Date().toISOString()
        };
        await setDoc(doc(db, 'users', firebaseUser.uid), userData);
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

  const loginWithEmpleadoId = async (empleadoOrData) => {
    try {
      let empData;
      let empId;
      if (typeof empleadoOrData === 'object' && empleadoOrData !== null) {
        empData = empleadoOrData;
        empId = empleadoOrData.id;
      } else {
        empId = empleadoOrData;
        const empDoc = await getDoc(doc(db, 'nomina_empleados', empId));
        if (empDoc.exists()) {
          empData = empDoc.data();
        } else {
          throw new Error('Empleado no encontrado');
        }
      }

      const userSession = {
        uid: empId,
        email: empData.email || `${empData.nombre.toLowerCase()}@yoybillar.mx`,
        name: `${empData.nombre} ${empData.apellido || ''}`.trim(),
        role: empData.rol || 'mesero',
        alias: empData.nombre,
        permisos: empData.permisos || {},
        avatar: (empData.nombre?.[0] || 'E') + (empData.apellido?.[0] || ''),
        salonId: empData.salonId || 'default_salon',
        offline: true
      };
      syncCustomClaims(userSession.uid, userSession.salonId, setIsSuspended);
      setUser(userSession);
      localStorage.setItem('yoy_ia_session', JSON.stringify(userSession));
      return userSession;
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

  const updateUserSession = (updates) => {
    if (!user) return;
    const updatedUser = { ...user, ...updates };
    setUser(updatedUser);
    localStorage.setItem('yoy_ia_session', JSON.stringify(updatedUser));
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, loginWithEmpleadoId, isSuspended, isOffline, offlineLockout, unlockOffline, updateUserSession }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}

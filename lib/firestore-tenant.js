import { deobfuscateStatic } from './crypto';
import {
  doc as firestoreDoc,
  collection as firestoreCollection,
  query as firestoreQuery,
  where as firestoreWhere,
  addDoc as firestoreAddDoc,
  setDoc as firestoreSetDoc,
  onSnapshot as firestoreOnSnapshot,
  getDocs as firestoreGetDocs,
  writeBatch as firestoreWriteBatch,
  runTransaction as firestoreRunTransaction,
  getDoc,
  serverTimestamp,
  updateDoc,
  orderBy,
  limit,
  startAfter,
  deleteDoc
} from 'firebase/firestore';

// Helper to get active salonId from URL or localStorage safely
const getActiveSalonId = () => {
  if (typeof window === 'undefined') return 'default_salon';
  try {
    // 1. Verificar si existe s o salonId en la URL
    if (window.location && window.location.search) {
      const params = new URLSearchParams(window.location.search);
      const urlSalonId = params.get('s') || params.get('salonId');
      if (urlSalonId) {
        const finalSalonId = urlSalonId.startsWith('[RC4-STATIC]') ? deobfuscateStatic(urlSalonId) : urlSalonId;
        localStorage.setItem('yoy_client_salon_id', finalSalonId);
        return finalSalonId;
      }
    }

    // 2. Verificar sesión de administrador / cajero
    const session = localStorage.getItem('yoy_ia_session');
    if (session) {
      const parsed = JSON.parse(session);
      if (parsed.salonId) return parsed.salonId;
    }

    // 3. Verificar si el cliente tiene un salonId guardado
    const clientSalon = localStorage.getItem('yoy_client_salon_id');
    if (clientSalon) {
      const finalSalonId = clientSalon.startsWith('[RC4-STATIC]') ? deobfuscateStatic(clientSalon) : clientSalon;
      return finalSalonId;
    }
  } catch (e) {
    console.error("Error reading salonId:", e);
  }
  return 'default_salon';
};

// Global list of collections that should NOT be isolated per salon (system-wide configs)
const GLOBAL_COLLECTIONS = [
  'config',
  'tipos_asistencia',
  'used_qr_tokens',
  'intentos_fallidos_qr',
  'intentos_fallidos_conexion',
  'salones'
];

// Helper to check if a collection path needs a salonId filter
const needsSalonFilter = (ref) => {
  if (!ref || !ref.path) return false;
  const colName = ref.path.split('/')[0];
  return !GLOBAL_COLLECTIONS.includes(colName);
};

// Wrapped doc: handles config document isolation per salon
const doc = (db, col, ...paths) => {
  const salonId = getActiveSalonId();
  if (col === 'config' && paths.length > 0) {
    const docId = paths[0];
    const isolatedConfigs = [
      'mesas_estado',
      'mesas_estado_backups',
      'cuentas_estado',
      'renta_extras',
      'seguridad',
      'inventario',
      'recetas',
      'sugerencias_descartadas',
      'last_checked_cuentas',
      'sucursal',
      'telegram'
    ];
    if (isolatedConfigs.includes(docId)) {
      return firestoreDoc(db, col, `${docId}_${salonId}`, ...paths.slice(1));
    }
  }
  return firestoreDoc(db, col, ...paths);
};

// Wrapped collection: returns the collection reference as-is
const collection = (db, colName, ...paths) => {
  return firestoreCollection(db, colName, ...paths);
};

// Wrapped query: automatically prepends a where('salonId', '==', salonId) clause
const query = (collRef, ...queryConstraints) => {
  const salonId = getActiveSalonId();
  if (needsSalonFilter(collRef)) {
    return firestoreQuery(collRef, firestoreWhere('salonId', '==', salonId), ...queryConstraints);
  }
  return firestoreQuery(collRef, ...queryConstraints);
};

// Wrapped addDoc: injects salonId into the document data
const addDoc = (collRef, data) => {
  const salonId = getActiveSalonId();
  if (needsSalonFilter(collRef)) {
    return firestoreAddDoc(collRef, { ...data, salonId });
  }
  return firestoreAddDoc(collRef, data);
};

// Wrapped setDoc: injects salonId into the document data
const setDoc = (docRef, data, options) => {
  const salonId = getActiveSalonId();
  if (needsSalonFilter(docRef)) {
    const merged = { ...data, salonId };
    return options ? firestoreSetDoc(docRef, merged, options) : firestoreSetDoc(docRef, merged);
  }
  return options ? firestoreSetDoc(docRef, data, options) : firestoreSetDoc(docRef, data);
};

// Wrapped onSnapshot: automatically wraps naked collections in a multi-tenant query
const onSnapshot = (ref, ...args) => {
  const salonId = getActiveSalonId();
  let finalRef = ref;
  
  if (ref && ref.type === 'collection' && needsSalonFilter(ref)) {
    finalRef = firestoreQuery(ref, firestoreWhere('salonId', '==', salonId));
  }
  return firestoreOnSnapshot(finalRef, ...args);
};

// Wrapped getDocs: automatically wraps naked collections in a multi-tenant query
const getDocs = (ref) => {
  const salonId = getActiveSalonId();
  let finalRef = ref;
  
  if (ref && ref.type === 'collection' && needsSalonFilter(ref)) {
    finalRef = firestoreQuery(ref, firestoreWhere('salonId', '==', salonId));
  }
  return firestoreGetDocs(finalRef);
};

// Wrapped writeBatch: intercepts set operations to inject salonId
const writeBatch = (db) => {
  const batch = firestoreWriteBatch(db);
  const salonId = getActiveSalonId();
  return {
    set: (docRef, data, options) => {
      if (needsSalonFilter(docRef)) {
        return options ? batch.set(docRef, { ...data, salonId }, options) : batch.set(docRef, { ...data, salonId });
      }
      return options ? batch.set(docRef, data, options) : batch.set(docRef, data);
    },
    update: (docRef, data) => {
      return batch.update(docRef, data);
    },
    delete: (docRef) => {
      return batch.delete(docRef);
    },
    commit: () => {
      return batch.commit();
    }
  };
};

// Wrapped runTransaction: intercepts set operations inside transactions to inject salonId
const runTransaction = (db, updateFunction) => {
  const salonId = getActiveSalonId();
  return firestoreRunTransaction(db, async (transaction) => {
    const wrappedTransaction = {
      get: (docRef) => transaction.get(docRef),
      set: (docRef, data, options) => {
        if (needsSalonFilter(docRef)) {
          return options ? transaction.set(docRef, { ...data, salonId }, options) : transaction.set(docRef, { ...data, salonId });
        }
        return options ? transaction.set(docRef, data, options) : transaction.set(docRef, data);
      },
      update: (docRef, data) => transaction.update(docRef, data),
      delete: (docRef) => transaction.delete(docRef)
    };
    return updateFunction(wrappedTransaction);
  });
};

export {
  doc,
  collection,
  query,
  addDoc,
  setDoc,
  onSnapshot,
  getDocs,
  writeBatch,
  runTransaction,
  firestoreWhere as where,
  getDoc,
  serverTimestamp,
  updateDoc,
  orderBy,
  limit,
  startAfter,
  deleteDoc,
  getActiveSalonId
};

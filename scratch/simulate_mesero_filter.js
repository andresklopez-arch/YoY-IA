const { initializeApp } = require('firebase/app');
const { getFirestore, doc, getDoc } = require('firebase/firestore');
const fs = require('fs');

const envContent = fs.readFileSync('.env.local', 'utf8');
const env = {};
envContent.split('\n').forEach(line => {
  const parts = line.split('=');
  if (parts.length === 2) env[parts[0].trim()] = parts[1].trim();
});

const firebaseConfig = {
  apiKey: env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: env.NEXT_PUBLIC_FIREBASE_PROJECT_ID
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const normalizeText = (str) => {
  if (!str) return '';
  return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
};

const startsWithBoundary = (fullStr, subStr) => {
  if (!fullStr || !subStr) return false;
  if (!fullStr.startsWith(subStr)) return false;
  if (fullStr.length === subStr.length) return true;
  const nextChar = fullStr.charAt(subStr.length);
  return !/[a-zA-Z0-9]/.test(nextChar);
};

async function run() {
  const mesasSnap = await getDoc(doc(db, 'config', 'mesas_estado'));
  const cuentasSnap = await getDoc(doc(db, 'config', 'cuentas_estado'));
  
  const mesas = mesasSnap.data().mesas || [];
  const cuentas = cuentasSnap.data().cuentas || [];
  
  const findMesaAsociada = (c) => {
    return mesas.find(m => 
      (c.mesaId && String(m.id) === String(c.mesaId)) ||
      (c.cliente && (
        (m.cliente && !['publico'].includes(normalizeText(m.cliente)) && startsWithBoundary(normalizeText(c.cliente), normalizeText(m.cliente))) ||
        normalizeText(c.cliente) === `mesa ${m.id}` ||
        normalizeText(c.cliente) === `mesa ${m.id} - pendiente` ||
        normalizeText(c.cliente).startsWith(`mesa ${m.id} `)
      ))
    );
  };
  
  const getCuentasActivasUnificadas = () => {
    const cuentasFiltradas = cuentas.filter(c => {
      if (c.mesaId) {
        const m = mesas.find(tbl => String(tbl.id) === String(c.mesaId));
        if (m && m.estado === 'manten') return false;
      }
      const mesaAsoc = findMesaAsociada(c);
      if (mesaAsoc && mesaAsoc.estado === 'manten') return false;
      return true;
    });

    const unificadas = [...cuentasFiltradas];
    mesas.forEach(m => {
      if (m.estado === 'ocupada') {
        const tieneCuenta = cuentasFiltradas.some(c => 
          (c.mesaId && String(c.mesaId) === String(m.id)) ||
          (c.cliente && (
            (m.cliente && !['publico'].includes(normalizeText(m.cliente)) && startsWithBoundary(normalizeText(c.cliente), normalizeText(m.cliente))) ||
            normalizeText(c.cliente) === `mesa ${m.id}` ||
            normalizeText(c.cliente) === `mesa ${m.id} - pendiente` ||
            normalizeText(c.cliente).startsWith(`mesa ${m.id} `)
          ))
        );
        if (!tieneCuenta) {
          unificadas.push({
            id: `mesa_${m.id}`,
            mesaId: m.id,
            cliente: (m.cliente && !['publico'].includes(normalizeText(m.cliente))) ? m.cliente : `Mesa ${m.id}`,
            consumos: [],
            tiempoJuego: 0
          });
        }
      }
    });
    return unificadas;
  };
  
  console.log("--- START SIMULATION ---");
  const unificadas = getCuentasActivasUnificadas();
  console.log("Unificadas count:", unificadas.length);
  
  const user = { uid: 'xNC7hVHZnFBum0vN428d', rol: 'Mesero' }; // Dulce
  
  let list = unificadas.filter(c => c.mesaId || findMesaAsociada(c));
  
  const rolLower = (user?.role || user?.rol || '').toLowerCase();
  const esMesero = rolLower.includes('mesero');
  
  if ((esMesero) && user?.uid) {
    list = list.filter(c => {
      const mesaAsociada = findMesaAsociada(c);
      const matched = mesaAsociada && (
        mesaAsociada.meseroId === user.uid || 
        (mesaAsociada.meseroIds && Array.isArray(mesaAsociada.meseroIds) && mesaAsociada.meseroIds.includes(user.uid))
      );
      return matched;
    });
  }
  
  console.log("Filtered list for Dulce:", list.map(c => `mesaId=${c.mesaId} cliente=${c.cliente}`));
}

run();

const { initializeApp } = require('firebase/app');
const { getFirestore, doc, getDoc, runTransaction, collection } = require('firebase/firestore');
const fs = require('fs');

const envContent = fs.readFileSync('.env.local', 'utf8');
const env = {};
envContent.split('\n').forEach(line => {
  const parts = line.split('=');
  if (parts.length === 2) {
    env[parts[0].trim()] = parts[1].trim();
  }
});

const firebaseConfig = {
  apiKey: env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: env.NEXT_PUBLIC_FIREBASE_APP_ID,
  measurementId: env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function run() {
  const orderId = 'xqHoyY7cpTRU605p6iaU';
  const orderSnap = await getDoc(doc(db, 'mesa_pedidos', orderId));
  if (!orderSnap.exists()) {
    console.error("No existe el pedido");
    process.exit(1);
  }
  const orderData = orderSnap.data();
  console.log("Pedido cargado:", orderData);

  const mesasSnap = await getDoc(doc(db, 'config', 'mesas_estado'));
  const mesas = mesasSnap.data().mesas || [];
  const targetMesa = mesas.find(m => m.id === orderData.mesaId);
  console.log("Mesa objetivo:", targetMesa);

  if (!targetMesa) {
    console.error("Mesa objetivo no encontrada en el catálogo");
    process.exit(1);
  }

  const orderItems = orderData.items || [];
  const totalPedido = orderData.total || 0;
  const clienteName = targetMesa.cliente || orderData.cliente || `Mesa ${orderData.mesaId}`;

  try {
    await runTransaction(db, async (transaction) => {
      const invRef = doc(db, 'config', 'inventario');
      const invSnap = await transaction.get(invRef);
      if (!invSnap.exists()) throw new Error("No existe el documento de inventario central");

      const cuentasRef = doc(db, 'config', 'cuentas_estado');
      const cuentasSnap = await transaction.get(cuentasRef);
      let currentCuentas = [];
      if (cuentasSnap.exists()) {
        currentCuentas = cuentasSnap.data().cuentas || [];
      }

      // Buscar o crear la cuenta activa
      const cuentaExistente = currentCuentas.find(c => 
        c.mesaId === orderData.mesaId || 
        (c.cliente && c.cliente.toLowerCase() === clienteName.toLowerCase())
      );

      console.log("Cuenta existente encontrada:", cuentaExistente);

      let nuevasCuentas = [...currentCuentas];
      if (cuentaExistente) {
        nuevasCuentas = currentCuentas.map(c => {
          if (c.id === cuentaExistente.id) {
            const nuevosConsumos = [...c.consumos];
            orderItems.forEach(cartItem => {
              const existeItem = nuevosConsumos.find(i => 
                (cartItem.productoId && i.productoId === cartItem.productoId) || 
                (i.producto && i.producto.toLowerCase() === cartItem.nombre.toLowerCase())
              );
              if (existeItem) {
                existeItem.cantidad += cartItem.cantidad;
                if (cartItem.productoId) existeItem.productoId = cartItem.productoId;
              } else {
                nuevosConsumos.push({
                  id: Date.now() + Math.random(),
                  productoId: cartItem.productoId || null,
                  producto: cartItem.nombre,
                  precio: cartItem.precio,
                  cantidad: cartItem.cantidad
                });
              }
            });
            return { ...c, consumos: nuevosConsumos };
          }
          return c;
        });
      } else {
        const nuevaCuenta = {
          id: Date.now(),
          mesaId: orderData.mesaId,
          cliente: clienteName,
          tiempoJuego: 0,
          consumos: orderItems.map(item => ({
            id: Date.now() + Math.random(),
            productoId: item.productoId || null,
            producto: item.nombre,
            precio: item.precio,
            cantidad: item.cantidad
          })),
          inicio: Date.now()
        };
        nuevasCuentas.push(nuevaCuenta);
      }

      console.log("Nuevas cuentas calculadas:", nuevasCuentas);

      const parsed = invSnap.data().productos || [];
      const stockTransaccion = parsed.map(p => {
        const enCart = orderItems.find(item => item.productoId === p.id);
        if (enCart) {
          return { ...p, stock: Math.max(0, p.stock - enCart.cantidad), lastModified: Date.now() };
        }
        return p;
      });

      // Escribir las cuentas actualizadas
      transaction.set(cuentasRef, {
        cuentas: nuevasCuentas,
        updatedAt: new Date()
      });

      // Escribir el inventario actualizado
      transaction.update(invRef, {
        productos: stockTransaccion,
        updatedAt: new Date()
      });

      // Registrar en historial_stock para auditoría
      const auditRef = doc(collection(db, 'historial_stock'));
      transaction.set(auditRef, {
        fecha: new Date(),
        mesaId: orderData.mesaId,
        cliente: clienteName,
        items: orderItems,
        total: totalPedido,
        tipo: 'descuento_qr',
        pedidoId: orderId
      });

      // Marcar el pedido como cargado (Caja)
      const pedidoRef = doc(db, 'mesa_pedidos', orderId);
      transaction.update(pedidoRef, {
        atendidoAdmin: true,
        cargadoACuenta: true,
        updatedAt: new Date()
      });
    });

    console.log("¡Transacción completada exitosamente!");
  } catch (err) {
    console.error("Transacción fallida:", err);
  }
  process.exit(0);
}

run().catch(console.error);

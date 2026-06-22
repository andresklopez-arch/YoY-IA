import { NextResponse } from 'next/server';
import { db } from '@/lib/firebase';
import { collection, query, where, getDocs, writeBatch, doc, limit, Timestamp } from 'firebase/firestore';

const hashPassword = (pwd) => {
  if (!pwd) return '';
  let hash = 0;
  for (let i = 0; i < pwd.length; i++) {
    hash = (hash << 5) - hash + pwd.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(16);
};

const ADMIN_PIN_HASH = '56760663'; // Hash del PIN '123456'

export async function POST(request) {
  try {
    const { pin, dias = 30 } = await request.json();

    // 1. Validar autorización por PIN de Administrador
    if (hashPassword(pin) !== ADMIN_PIN_HASH) {
      return NextResponse.json({ success: false, error: 'Código PIN no válido. No autorizado.' }, { status: 401 });
    }

    // 2. Calcular fecha límite (hace X días)
    const milisegundosEnDia = 24 * 60 * 60 * 1000;
    const limiteFecha = new Date(Date.now() - Number(dias) * milisegundosEnDia);
    const limiteTimestamp = Timestamp.fromDate(limiteFecha);

    // 3. Buscar comandas en la colección mesa_pedidos
    // Limitado a 400 para respetar la restricción de 500 operaciones en writeBatch de Firestore
    const q = query(
      collection(db, 'mesa_pedidos'),
      where('createdAt', '<', limiteTimestamp),
      limit(400)
    );

    const snap = await getDocs(q);
    if (snap.empty) {
      return NextResponse.json({
        success: true,
        archivedCount: 0,
        hasMore: false,
        message: 'No hay pedidos antiguos pendientes de archivado.'
      });
    }

    const batch = writeBatch(db);
    let count = 0;

    snap.docs.forEach((d) => {
      const data = d.data();
      
      // Copiar a la colección de historial histórico
      const historicoRef = doc(db, 'mesa_pedidos_historico', d.id);
      batch.set(historicoRef, {
        ...data,
        archivedAt: Timestamp.now()
      });

      // Eliminar de la colección activa mesa_pedidos
      const originalRef = doc(db, 'mesa_pedidos', d.id);
      batch.delete(originalRef);
      count++;
    });

    // Ejecutar el lote de transacciones
    await batch.commit();

    // Determinar si quedan más elementos por archivar
    const hasMore = snap.docs.length === 400;

    return NextResponse.json({
      success: true,
      archivedCount: count,
      hasMore,
      message: `Se archivaron con éxito ${count} pedidos de hace más de ${dias} días.`
    });
  } catch (error) {
    console.error('Error en API de archivado de pedidos:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

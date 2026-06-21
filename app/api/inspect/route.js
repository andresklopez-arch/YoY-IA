import { db } from '@/lib/firebase';
import { collection, getDocs, query, where } from 'firebase/firestore';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const q = query(
      collection(db, 'mesa_pedidos'),
      where('tipo', '==', 'cuenta'),
      where('atendidoAdmin', '==', false)
    );
    const snap = await getDocs(q);
    const results = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    return Response.json({ status: 'ok', size: results.length, data: results });
  } catch (err) {
    return Response.json({ status: 'error', error: err.message }, { status: 500 });
  }
}

import { db } from '@/lib/firebase';
import { doc, getDoc } from 'firebase/firestore';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const docRef = doc(db, 'config', 'mesas_estado');
    const snap = await getDoc(docRef);
    if (snap.exists()) {
      return Response.json({ status: 'ok', exists: true, data: snap.data() });
    } else {
      return Response.json({ status: 'ok', exists: false });
    }
  } catch (err) {
    return Response.json({ status: 'error', error: err.message }, { status: 500 });
  }
}

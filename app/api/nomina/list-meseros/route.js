import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { db } from '@/lib/firebase';
import { collection, query, where, getDocs } from 'firebase/firestore';

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const salonId = searchParams.get('salonId') || 'default_salon';

    let meseros = [];

    if (adminDb) {
      const snap = await adminDb.collection('nomina_empleados')
        .where('salonId', '==', salonId)
        .where('estado', '==', 'activo')
        .get();
      
      snap.forEach(doc => {
        const data = doc.data();
        const rol = (data.rol || '').toLowerCase();
        if (rol.includes('mesero') || rol.includes('mesera')) {
          meseros.push({ id: doc.id, ...data });
        }
      });
    } else {
      const q = query(
        collection(db, 'nomina_empleados'),
        where('salonId', '==', salonId),
        where('estado', '==', 'activo')
      );
      const snap = await getDocs(q);
      snap.forEach(doc => {
        const data = doc.data();
        const rol = (data.rol || '').toLowerCase();
        if (rol.includes('mesero') || rol.includes('mesera')) {
          meseros.push({ id: doc.id, ...data });
        }
      });
    }

    return NextResponse.json({ success: true, meseros });
  } catch (error) {
    console.error("Error listing meseros:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

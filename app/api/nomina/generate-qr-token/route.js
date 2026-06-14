import { NextResponse } from 'next/server';
import { db } from '@/lib/firebase';
import { doc, updateDoc } from 'firebase/firestore';
import crypto from 'crypto';

const SECRET = process.env.QR_SECRET || 'yoy_billar_secret_key_2026_io';

export async function POST(request) {
  try {
    const { empleadoId } = await request.json();
    if (!empleadoId) {
      return NextResponse.json({ success: false, error: 'empleadoId es requerido' }, { status: 400 });
    }

    const expires = Date.now() + 5 * 60 * 1000; // 5 minutos
    const token = crypto
      .createHmac('sha256', SECRET)
      .update(`${empleadoId}:${expires}`)
      .digest('hex');

    // También actualizar en Firestore para compatibilidad con código cliente heredado
    const docRef = doc(db, 'nomina_empleados', empleadoId);
    await updateDoc(docRef, {
      qrToken: token,
      qrTokenExpires: expires
    });

    return NextResponse.json({ success: true, token, expires });
  } catch (error) {
    console.error('Error in generate-qr-token route:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

import { NextResponse } from 'next/server';
import { db } from '@/lib/firebase';
import { doc, getDoc, getDocs, addDoc, setDoc, collection, query, where, serverTimestamp } from 'firebase/firestore';
import crypto from 'crypto';

const SECRET = process.env.QR_SECRET || 'yoy_billar_secret_key_2026_io';

const getDistanceInMeters = (lat1, lon1, lat2, lon2) => {
  const R = 6371e3; // Radio de la Tierra en metros
  const φ1 = lat1 * Math.PI / 180;
  const φ2 = lat2 * Math.PI / 180;
  const Δφ = (lat2 - lat1) * Math.PI / 180;
  const Δλ = (lon2 - lon1) * Math.PI / 180;

  const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
            Math.cos(φ1) * Math.cos(φ2) *
            Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
};

export async function POST(request) {
  try {
    const { empleadoId, token, expires, coordenadas, dispositivo } = await request.json();

    if (!empleadoId || !token || !expires) {
      return NextResponse.json({ success: false, error: 'Parámetros incompletos' }, { status: 400 });
    }

    // 1. Validar firma criptográfica
    const expectedToken = crypto
      .createHmac('sha256', SECRET)
      .update(`${empleadoId}:${expires}`)
      .digest('hex');

    if (token !== expectedToken) {
      return NextResponse.json({ success: false, error: 'Código QR no válido o manipulado' }, { status: 401 });
    }

    // 2. Validar expiración (5 minutos)
    if (Date.now() > Number(expires)) {
      return NextResponse.json({ success: false, error: 'El código QR ha expirado' }, { status: 401 });
    }

    // 3. Protección Anti-Replay: Verificar si el token ya fue consumido
    const tokenRef = doc(db, 'used_qr_tokens', token);
    const tokenSnap = await getDoc(tokenRef);
    if (tokenSnap.exists()) {
      return NextResponse.json({ success: false, error: 'Este código QR ya ha sido utilizado para registrar asistencia.' }, { status: 401 });
    }

    // 4. Obtener datos del empleado
    const empRef = doc(db, 'nomina_empleados', empleadoId);
    const empSnap = await getDoc(empRef);
    if (!empSnap.exists()) {
      return NextResponse.json({ success: false, error: 'Empleado no encontrado' }, { status: 404 });
    }
    const emp = { id: empSnap.id, ...empSnap.data() };
    const fechaHoy = new Date().toISOString().slice(0, 10);

    // 5. Validar geolocalización activa
    if (!coordenadas || coordenadas.status !== 'Obtenido') {
      await addDoc(collection(db, 'nomina_asistencia_log'), {
        empleadoId: emp.id,
        nombre: `${emp.nombre} ${emp.apellido || ''}`.trim(),
        rol: emp.rol || 'Mesero',
        fecha: fechaHoy,
        tipo: 'intento_fallido_gps',
        coordenadas: coordenadas || { status: 'No disponible' },
        dispositivo: dispositivo || 'Móvil',
        createdAt: serverTimestamp()
      });
      return NextResponse.json({ success: false, error: 'Geolocalización requerida. Por favor, activa el GPS y otorga permisos de ubicación.' }, { status: 400 });
    }

    // 6. Validar precisión del GPS (Evita simulaciones de GPS y mala calidad de señal)
    const precision = coordenadas.precision;
    if (precision !== null && precision !== undefined) {
      if (precision > 50) {
        return NextResponse.json({ success: false, error: `Precisión de GPS insuficiente (${Math.round(precision)}m). Intenta salir a una zona más abierta.` }, { status: 400 });
      }
      if (precision === 0) {
        return NextResponse.json({ success: false, error: 'Señal de ubicación inválida detectada. Favor de no usar simuladores de GPS.' }, { status: 400 });
      }
    }

    // 7. Validar geocerca (200 metros)
    let sucursalCoords = { lat: 20.659698, lng: -103.349609 }; // Guadalajara por defecto
    try {
      const sucSnap = await getDoc(doc(db, 'config', 'sucursal'));
      if (sucSnap.exists() && sucSnap.data().lat && sucSnap.data().lng) {
        sucursalCoords.lat = Number(sucSnap.data().lat);
        sucursalCoords.lng = Number(sucSnap.data().lng);
      }
    } catch (err) {
      console.warn('Error loading sucursal coordinates, using defaults:', err);
    }

    const distancia = getDistanceInMeters(coordenadas.lat, coordenadas.lng, sucursalCoords.lat, sucursalCoords.lng);
    if (distancia > 200) {
      await addDoc(collection(db, 'nomina_asistencia_log'), {
        empleadoId: emp.id,
        nombre: `${emp.nombre} ${emp.apellido || ''}`.trim(),
        rol: emp.rol || 'Mesero',
        fecha: fechaHoy,
        tipo: 'intento_fallido_geocerca',
        coordenadas: {
          ...coordenadas,
          distanciaCalculada: Math.round(distancia),
          sucursalLat: sucursalCoords.lat,
          sucursalLng: sucursalCoords.lng
        },
        dispositivo: dispositivo || 'Móvil',
        createdAt: serverTimestamp()
      });
      return NextResponse.json({ success: false, error: `Estás fuera del rango permitido del establecimiento (Distancia: ${Math.round(distancia)}m). Debes estar a menos de 200m.` }, { status: 400 });
    }

    // 8. Determinar tipo de registro (Entrada o Salida)
    const qLogs = query(
      collection(db, 'nomina_asistencia_log'),
      where('empleadoId', '==', emp.id),
      where('fecha', '==', fechaHoy)
    );
    const logsSnap = await getDocs(qLogs);
    let tipoRegistro = 'entrada';
    if (!logsSnap.empty) {
      const logsList = logsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      logsList.sort((a, b) => {
        const tA = a.createdAt?.toDate ? a.createdAt.toDate().getTime() : (a.createdAt || 0);
        const tB = b.createdAt?.toDate ? b.createdAt.toDate().getTime() : (b.createdAt || 0);
        return tB - tA;
      });
      const lastLog = logsList[0];
      tipoRegistro = lastLog.tipo === 'entrada' ? 'salida' : 'entrada';
    }

    // 9. Registrar token como consumido para evitar re-uso
    await setDoc(tokenRef, {
      empleadoId,
      usedAt: serverTimestamp(),
      expiresAt: Number(expires)
    });

    // 10. Registrar log de asistencia en Firestore
    await addDoc(collection(db, 'nomina_asistencia_log'), {
      empleadoId: emp.id,
      nombre: `${emp.nombre} ${emp.apellido || ''}`.trim(),
      rol: emp.rol || 'Mesero',
      fecha: fechaHoy,
      tipo: tipoRegistro,
      coordenadas,
      dispositivo: dispositivo || 'Móvil',
      createdAt: serverTimestamp()
    });

    // 11. Registrar asistencia diaria legacy (solo Entrada)
    if (tipoRegistro === 'entrada') {
      const hour = new Date().getHours();
      let turnoActual = 'noche';
      if (hour >= 6 && hour < 14) turnoActual = 'manana';
      else if (hour >= 14 && hour < 22) turnoActual = 'tarde';

      const qAsist = query(
        collection(db, 'nomina_asistencia'),
        where('empleadoId', '==', emp.id),
        where('fecha', '==', fechaHoy),
        where('turno', '==', turnoActual)
      );
      const snapAsist = await getDocs(qAsist);
      if (snapAsist.empty) {
        await addDoc(collection(db, 'nomina_asistencia'), {
          empleadoId: emp.id,
          fecha: fechaHoy,
          turno: turnoActual,
          estado: 'presente',
          coordenadas,
          createdAt: serverTimestamp()
        });
      }
    }

    // 12. Registrar bitácora general de actividades
    await addDoc(collection(db, 'bitacora'), {
      fecha: new Date().toISOString(),
      accion: `Fichaje QR ${tipoRegistro === 'entrada' ? 'Entrada' : 'Salida'}`,
      detalle: `Fichaje QR: ${emp.nombre} (${emp.rol || 'Mesero'}) marcó ${tipoRegistro === 'entrada' ? 'entrada' : 'salida'} desde ${dispositivo || 'Móvil'}. Ubicación: Obtenido (Servidor)`,
      monto: 0,
      operador: emp.nombre,
      rolOperador: (emp.rol || 'mesero').toLowerCase()
    });

    return NextResponse.json({
      success: true,
      tipoRegistro,
      emp
    });
  } catch (error) {
    console.error('Error in verify-attendance route:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

import { useState, useEffect, useMemo, useRef } from 'react';
import { collection, onSnapshot, query, where } from '@/lib/firestore-tenant';
import { db } from '@/lib/firebase';

export function useAlertasNomina() {
  const [empleados, setEmpleados] = useState([]);
  const [asistencias, setAsistencias] = useState([]);

  useEffect(() => {
    // Escuchar empleados para saber quiénes están activos
    const unsubEmp = onSnapshot(collection(db, 'nomina_empleados'), snap => {
      setEmpleados(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }, err => console.error("Error al obtener empleados para alertas:", err));

    // Escuchar asistencias limitando al mes actual para optimizar lecturas
    const primerDiaMes = new Date().toISOString().slice(0, 7) + '-01';
    const q = query(
      collection(db, 'nomina_asistencia'),
      where('fecha', '>=', primerDiaMes)
    );
    const unsubAsist = onSnapshot(q, snap => {
      setAsistencias(snap.docs.map(d => d.data()));
    }, err => console.error("Error al obtener asistencias para alertas:", err));

    return () => {
      unsubEmp();
      unsubAsist();
    };
  }, []);

  const alertas = useMemo(() => {
    const mesActual = new Date().toISOString().slice(0, 7);
    const activosIds = new Set(empleados.filter(e => e?.estado === 'activo').map(e => e.id));
    const nuevas = [];

    const porEmpleado = {};
    asistencias
      .filter(a => a?.fecha?.startsWith(mesActual) && a?.empleadoId && activosIds.has(a.empleadoId))
      .forEach(a => {
        if (!porEmpleado[a.empleadoId]) porEmpleado[a.empleadoId] = [];
        porEmpleado[a.empleadoId].push(a);
      });

    Object.entries(porEmpleado).forEach(([empId, registros]) => {
      const ausencias = registros.filter(r => r.estado === 'ausente').length;
      if (ausencias >= 3) {
        const emp = empleados.find(e => e.id === empId);
        const nombre = emp ? `${emp.nombre || ''} ${emp.apellido || ''}`.trim() : 'Empleado';
        nuevas.push({
          tipo: 'ausencia',
          empId,
          ausencias,
          mensaje: `${nombre || 'Empleado'}: ${ausencias} ausencias este mes`
        });
      }
    });

    return nuevas;
  }, [empleados, asistencias]);

  // Reproducir un sonido de alerta si hay alertas nuevas de alta prioridad
  const prevAlertasCount = useRef(0);
  useEffect(() => {
    if (alertas.length > prevAlertasCount.current) {
      try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (AudioCtx) {
          const ctx = new AudioCtx();
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.connect(gain);
          gain.connect(ctx.destination);
          
          osc.frequency.setValueAtTime(523.25, ctx.currentTime); // C5
          osc.frequency.setValueAtTime(659.25, ctx.currentTime + 0.15); // E5
          gain.gain.setValueAtTime(0.08, ctx.currentTime);
          gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.4);
          
          osc.start(ctx.currentTime);
          osc.stop(ctx.currentTime + 0.4);
        }
      } catch (e) {
        console.warn("Audio Context no está permitido o no es soportado aún:", e);
      }
    }
    prevAlertasCount.current = alertas.length;
  }, [alertas]);

  return alertas;
}

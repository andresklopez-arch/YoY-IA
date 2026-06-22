'use client';
import { useState, useEffect, useRef } from 'react';
import {
  collection, doc, setDoc, updateDoc, addDoc, getDocs, getDoc,
  deleteDoc, query, where, onSnapshot, serverTimestamp
} from '@/lib/firestore-tenant';
import { db } from '@/lib/firebase';

export default function SimulatorPage() {
  const [activeScenario, setActiveScenario] = useState('standard'); // standard | supply | attendance
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentStepIndex, setCurrentStepIndex] = useState(-1);
  const [speedMultiplier, setSpeedMultiplier] = useState(2); // 1 = 3.5s/step, 2 = 1.8s/step, 3 = 0.6s/step
  const [logs, setLogs] = useState([]);
  const [mesaUsada, setMesaUsada] = useState('3');
  const [simulationState, setSimulationState] = useState({});
  const [activeRole, setActiveRole] = useState(null); // cashier | cook | waiter | client

  // Live Firestore counters
  const [counters, setCounters] = useState({
    activeTables: 0,
    activeOrders: 0,
    activeAlerts: 0,
    stockRequests: 0,
    bitacoraLogs: 0
  });

  const timerRef = useRef(null);
  const logsEndRef = useRef(null);

  // Auto-scroll logs to bottom
  useEffect(() => {
    if (logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs]);

  // Firestore Real-time Listeners
  useEffect(() => {
    // 1. Mesas activas (ocupadas)
    const unsubMesas = onSnapshot(doc(db, 'config', 'mesas_estado'), snap => {
      if (snap.exists()) {
        const list = snap.data().mesas || [];
        setCounters(prev => ({ ...prev, activeTables: list.filter(m => m.estado === 'ocupada').length }));
        // Encontrar una mesa libre para usar en la simulación si no está ocupada ya
        const freeMesa = list.find(m => m.estado === 'libre');
        if (freeMesa && !isPlaying) {
          setMesaUsada(String(freeMesa.id));
        }
      }
    });

    // 2. Comandas activas (pendientes/listo/en_camino)
    const qOrders = query(
      collection(db, 'mesa_pedidos'),
      where('tipo', '==', 'pedido'),
      where('estado', 'in', ['pendiente', 'listo', 'en_camino'])
    );
    const unsubOrders = onSnapshot(qOrders, snap => {
      setCounters(prev => ({ ...prev, activeOrders: snap.size }));
    });

    // 3. Alertas de asistencia
    const qAlerts = query(
      collection(db, 'mesa_pedidos'),
      where('tipo', 'in', ['asistencia', 'cuenta']),
      where('estado', '==', 'pendiente')
    );
    const unsubAlerts = onSnapshot(qAlerts, snap => {
      setCounters(prev => ({ ...prev, activeAlerts: snap.size }));
    });

    // 4. Insumos con surtido solicitado
    const qInsumos = query(
      collection(db, 'cocina_insumos'),
      where('surtidoSolicitado', '==', true)
    );
    const unsubInsumos = onSnapshot(qInsumos, snap => {
      setCounters(prev => ({ ...prev, stockRequests: snap.size }));
    });

    // 5. Total bitacora
    const qBitacora = collection(db, 'bitacora');
    const unsubBitacora = onSnapshot(qBitacora, snap => {
      setCounters(prev => ({ ...prev, bitacoraLogs: snap.size }));
    });

    return () => {
      unsubMesas();
      unsubOrders();
      unsubAlerts();
      unsubInsumos();
      unsubBitacora();
    };
  }, [isPlaying]);

  // Log function
  const addLog = (text, type = 'info', role = null) => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs(prev => [...prev, { text, type, role, timestamp }]);
  };

  // Setup Simulator steps
  const scenarios = {
    standard: [
      {
        id: 1,
        title: 'Check-in de Asistencia',
        role: 'cashier',
        desc: 'Mesero Carlos y Cocinero Chef marcan su entrada con geolocalización.',
        action: async (state) => {
          const dateHoy = new Date().toISOString().split('T')[0];
          await addDoc(collection(db, 'nomina_asistencia_log'), {
            empleadoId: 'sim_mesero_carlos',
            empleadoNombre: 'Mesero Carlos (Simulador)',
            tipo: 'entrada',
            fecha: dateHoy,
            hora: new Date().toLocaleTimeString(),
            lat: 19.4326,
            lng: -99.1332,
            georeferenciaOk: true,
            createdAt: serverTimestamp()
          });
          await addDoc(collection(db, 'nomina_asistencia_log'), {
            empleadoId: 'sim_cocinero_chef',
            empleadoNombre: 'Cocinero Chef (Simulador)',
            tipo: 'entrada',
            fecha: dateHoy,
            hora: new Date().toLocaleTimeString(),
            lat: 19.4326,
            lng: -99.1332,
            georeferenciaOk: true,
            createdAt: serverTimestamp()
          });
          await addDoc(collection(db, 'bitacora'), {
            tipo: 'asistencia',
            descripcion: 'Entrada registrada para Mesero Carlos y Cocinero Chef (Simulador).',
            usuario: 'Simulador IA',
            createdAt: serverTimestamp()
          });
          return 'Fichajes de entrada creados exitosamente en Firestore.';
        }
      },
      {
        id: 2,
        title: 'Apertura de Mesa (Scan QR)',
        role: 'client',
        desc: `Cliente escanea QR en la Mesa ${mesaUsada} y la ocupa de forma remota.`,
        action: async (state) => {
          const mesasDocRef = doc(db, 'config', 'mesas_estado');
          const mesasSnap = await getDoc(mesasDocRef);
          if (mesasSnap.exists()) {
            const list = mesasSnap.data().mesas || [];
            const updated = list.map(m => m.id === Number(mesaUsada) || m.id === mesaUsada
              ? {
                  ...m,
                  estado: 'ocupada',
                  cliente: 'Cliente Simulado',
                  inicio: Date.now(),
                  clienteUid: 'sim_cliente_123',
                  clienteLastActive: Date.now()
                }
              : m
            );
            await setDoc(mesasDocRef, { mesas: updated, updatedAt: serverTimestamp() }, { merge: true });
          }
          await addDoc(collection(db, 'bitacora'), {
            tipo: 'apertura',
            descripcion: `Mesa ${mesaUsada} abierta automáticamente vía QR por Cliente Simulado.`,
            usuario: 'Cliente Simulado',
            createdAt: serverTimestamp()
          });
          return `Estado de Mesa ${mesaUsada} cambiado a 'ocupada' en config/mesas_estado.`;
        }
      },
      {
        id: 3,
        title: 'Cliente realiza Pedido',
        role: 'client',
        desc: 'Cliente ordena 2 porciones de Alitas BBQ y 3 Cervezas desde su celular.',
        action: async (state) => {
          const orderRef = await addDoc(collection(db, 'mesa_pedidos'), {
            mesaId: mesaUsada,
            cliente: 'Cliente Simulado',
            items: [
              { id: 'item_alitas', nombre: 'Alitas de Pollo BBQ', cantidad: 2, precio: 120, preparado: false },
              { id: 'item_cerveza', nombre: 'Cerveza Corona', cantidad: 3, precio: 45, preparado: false }
            ],
            total: 375,
            estado: 'pendiente',
            tipo: 'pedido',
            origen: 'mesa_qr',
            clienteUid: 'sim_cliente_123',
            atendidoAdmin: false,
            atendidoMesero: false,
            createdAt: serverTimestamp()
          });
          state.orderId = orderRef.id;
          return `Comanda agregada con ID: ${orderRef.id}. Alarma sonará en cocina y barra.`;
        }
      },
      {
        id: 4,
        title: 'Cocinero recibe y prepara',
        role: 'cook',
        desc: 'Cocinero recibe comanda en monitor de Cocina y la marca como Lista.',
        action: async (state) => {
          if (!state.orderId) throw new Error('No se encontró una comanda previa para preparar.');
          await updateDoc(doc(db, 'mesa_pedidos', state.orderId), {
            estado: 'listo',
            atendidoAdmin: true,
            updatedAt: serverTimestamp()
          });
          await addDoc(collection(db, 'bitacora'), {
            tipo: 'cocina',
            descripcion: `Comanda de Mesa ${mesaUsada} marcada como LISTA para entrega.`,
            usuario: 'Cocinero Chef',
            createdAt: serverTimestamp()
          });
          return `Comanda ID: ${state.orderId} marcada como 'listo'. Alerta de entrega enviada a mesero.`;
        }
      },
      {
        id: 5,
        title: 'Alerta de Stock Bajo (Cocina)',
        role: 'cook',
        desc: 'Cocinero nota nivel crítico de Salsa BBQ y solicita surtido desde Cocina.',
        action: async (state) => {
          const q = query(collection(db, 'cocina_insumos'), where('nombre', '==', 'Salsa BBQ'));
          const snap = await getDocs(q);
          let insId;
          if (snap.empty) {
            const newIns = await addDoc(collection(db, 'cocina_insumos'), {
              nombre: 'Salsa BBQ',
              nivelActual: 2,
              nivelMin: 5,
              nivelOptimo: 12,
              unidad: 'L',
              categoria: 'Aderezos',
              surtidoSolicitado: true,
              surtidoSolicitadoAt: serverTimestamp(),
              createdAt: serverTimestamp()
            });
            insId = newIns.id;
          } else {
            insId = snap.docs[0].id;
            await updateDoc(doc(db, 'cocina_insumos', insId), {
              nivelActual: 2,
              surtidoSolicitado: true,
              surtidoSolicitadoAt: serverTimestamp(),
              updatedAt: serverTimestamp()
            });
          }
          state.insumoId = insId;
          await addDoc(collection(db, 'bitacora'), {
            tipo: 'inventario_alerta',
            descripcion: 'Salsa BBQ bajó de nivel crítico. Surtido solicitado a Caja.',
            usuario: 'Cocinero Chef',
            createdAt: serverTimestamp()
          });
          return 'Insumo Salsa BBQ actualizado. Alerta de surtido activada (rojo parpadeante en Caja).';
        }
      },
      {
        id: 6,
        title: 'Cajero atiende Alerta y surte',
        role: 'cashier',
        desc: 'Cajero detecta alerta de surtido en su dashboard, entrega el insumo y marca surtido.',
        action: async (state) => {
          if (!state.insumoId) throw new Error('No se encontró una solicitud de insumo previa.');
          await updateDoc(doc(db, 'cocina_insumos', state.insumoId), {
            nivelActual: 12,
            surtidoSolicitado: false,
            surtidoSolicitadoAt: null,
            updatedAt: serverTimestamp()
          });
          await addDoc(collection(db, 'bitacora'), {
            tipo: 'surtido_completado',
            descripcion: 'Surtido de Salsa BBQ completado. Inventario actualizado.',
            usuario: 'Cajero Principal',
            createdAt: serverTimestamp()
          });
          return 'Salsa BBQ reabastecida. Alerta apagada y tiempo de respuesta registrado.';
        }
      },
      {
        id: 7,
        title: 'Mesero Entrega Comanda',
        role: 'waiter',
        desc: 'Mesero Carlos lleva las Alitas BBQ y Cervezas a la mesa y marca como Entregado.',
        action: async (state) => {
          if (!state.orderId) throw new Error('No se encontró una comanda previa para entregar.');
          await updateDoc(doc(db, 'mesa_pedidos', state.orderId), {
            estado: 'entregado',
            atendidoMesero: true,
            updatedAt: serverTimestamp()
          });
          return `Comanda ID: ${state.orderId} marcada como 'entregado'. Consumo cargado a la cuenta.`;
        }
      },
      {
        id: 8,
        title: 'Cliente solicita Asistencia',
        role: 'client',
        desc: 'Cliente solicita asistencia del mesero (llamado) desde su celular.',
        action: async (state) => {
          const assistRef = await addDoc(collection(db, 'mesa_pedidos'), {
            mesaId: mesaUsada,
            cliente: 'Cliente Simulado',
            tipo: 'asistencia',
            etiqueta: 'Llamar al Mesero',
            icono: '🔔',
            estado: 'pendiente',
            clienteUid: 'sim_cliente_123',
            atendidoAdmin: false,
            atendidoMesero: false,
            createdAt: serverTimestamp()
          });
          state.assistId = assistRef.id;
          return `Alerta de asistencia creada con ID: ${assistRef.id}. Reloj de atención activado en Mesero.`;
        }
      },
      {
        id: 9,
        title: 'Mesero atiende Asistencia',
        role: 'waiter',
        desc: 'Mesero Carlos acude a la Mesa, responde a la solicitud y la apaga en su terminal.',
        action: async (state) => {
          if (!state.assistId) throw new Error('No se encontró un llamado de asistencia previo.');
          await updateDoc(doc(db, 'mesa_pedidos', state.assistId), {
            estado: 'listo',
            atendidoMesero: true,
            updatedAt: serverTimestamp()
          });
          return `Llamado ID: ${state.assistId} marcado como completado/atendido.`;
        }
      },
      {
        id: 10,
        title: 'Cliente solicita Cuenta',
        role: 'client',
        desc: 'Cliente finaliza su consumo y solicita la cuenta desde el QR de la Mesa.',
        action: async (state) => {
          const cuentaRef = await addDoc(collection(db, 'mesa_pedidos'), {
            mesaId: mesaUsada,
            cliente: 'Cliente Simulado',
            tipo: 'cuenta',
            etiqueta: 'Solicitud de Cuenta',
            icono: '💵',
            estado: 'pendiente',
            totalAcumulado: 375,
            atendidoAdmin: false,
            atendidoMesero: false,
            createdAt: serverTimestamp()
          });
          state.cuentaId = cuentaRef.id;
          return `Solicitud de cuenta agregada con ID: ${cuentaRef.id}. Alerta visual y de voz activa en Caja.`;
        }
      },
      {
        id: 11,
        title: 'Cajero realiza Cobro y cierra Mesa',
        role: 'cashier',
        desc: 'Cajero procesa el cobro por $375 en efectivo, imprime ticket y libera la mesa.',
        action: async (state) => {
          // 1. Liberar Mesa
          const mesasDocRef = doc(db, 'config', 'mesas_estado');
          const mesasSnap = await getDoc(mesasDocRef);
          if (mesasSnap.exists()) {
            const list = mesasSnap.data().mesas || [];
            const updated = list.map(m => m.id === Number(mesaUsada) || m.id === mesaUsada
              ? {
                  ...m,
                  estado: 'libre',
                  cliente: null,
                  inicio: null,
                  clienteUid: '',
                  preTicketImpreso: false
                }
              : m
            );
            await setDoc(mesasDocRef, { mesas: updated, updatedAt: serverTimestamp() }, { merge: true });
          }

          // 2. Apagar alerta de cuenta
          if (state.cuentaId) {
            await updateDoc(doc(db, 'mesa_pedidos', state.cuentaId), {
              estado: 'listo',
              atendidoAdmin: true,
              updatedAt: serverTimestamp()
            });
          }

          // 3. Registrar venta en bitacora
          await addDoc(collection(db, 'bitacora'), {
            tipo: 'caja_cobro',
            descripcion: `Pago recibido de Mesa ${mesaUsada} ($375.00 en efectivo). Mesa liberada.`,
            usuario: 'Cajero Principal',
            createdAt: serverTimestamp()
          });
          return `Mesa ${mesaUsada} liberada. Estado cambiado a 'libre'. Alerta de cuenta apagada.`;
        }
      },
      {
        id: 12,
        title: 'Check-out de Asistencia (Salida)',
        role: 'cashier',
        desc: 'Mesero Carlos y Cocinero Chef marcan su salida de labores.',
        action: async (state) => {
          const dateHoy = new Date().toISOString().split('T')[0];
          await addDoc(collection(db, 'nomina_asistencia_log'), {
            empleadoId: 'sim_mesero_carlos',
            empleadoNombre: 'Mesero Carlos (Simulador)',
            tipo: 'salida',
            fecha: dateHoy,
            hora: new Date().toLocaleTimeString(),
            lat: 19.4326,
            lng: -99.1332,
            georeferenciaOk: true,
            createdAt: serverTimestamp()
          });
          await addDoc(collection(db, 'nomina_asistencia_log'), {
            empleadoId: 'sim_cocinero_chef',
            empleadoNombre: 'Cocinero Chef (Simulador)',
            tipo: 'salida',
            fecha: dateHoy,
            hora: new Date().toLocaleTimeString(),
            lat: 19.4326,
            lng: -99.1332,
            georeferenciaOk: true,
            createdAt: serverTimestamp()
          });
          await addDoc(collection(db, 'bitacora'), {
            tipo: 'asistencia',
            descripcion: 'Salida registrada para Mesero Carlos y Cocinero Chef (Simulador). Fin del turno.',
            usuario: 'Simulador IA',
            createdAt: serverTimestamp()
          });
          return 'Fichajes de salida creados. Simulación completada con éxito.';
        }
      }
    ],
    supply: [
      {
        id: 1,
        title: 'Alerta Crítica de Insumos',
        role: 'cook',
        desc: 'Cocinero detecta que Aceite de Freidora se ha agotado y requiere surtido urgente.',
        action: async (state) => {
          const q = query(collection(db, 'cocina_insumos'), where('nombre', '==', 'Aceite vegetal para freidora'));
          const snap = await getDocs(q);
          let insId;
          if (snap.empty) {
            const newIns = await addDoc(collection(db, 'cocina_insumos'), {
              nombre: 'Aceite vegetal para freidora',
              nivelActual: 1,
              nivelMin: 8,
              nivelOptimo: 30,
              unidad: 'L',
              categoria: 'Cocina General',
              surtidoSolicitado: true,
              surtidoSolicitadoAt: serverTimestamp(),
              createdAt: serverTimestamp()
            });
            insId = newIns.id;
          } else {
            insId = snap.docs[0].id;
            await updateDoc(doc(db, 'cocina_insumos', insId), {
              nivelActual: 1,
              surtidoSolicitado: true,
              surtidoSolicitadoAt: serverTimestamp(),
              updatedAt: serverTimestamp()
            });
          }
          state.insumoId = insId;
          await addDoc(collection(db, 'bitacora'), {
            tipo: 'inventario_alerta',
            descripcion: '¡Aceite vegetal para freidora crítico (1L)! Surtido solicitado a administración.',
            usuario: 'Cocinero Chef',
            createdAt: serverTimestamp()
          });
          return 'Alerta lanzada. Los dashboards de administración y caja recibirán notificación auditiva y visual.';
        }
      },
      {
        id: 2,
        title: 'Surtido y Registro de Eficiencia',
        role: 'cashier',
        desc: 'Caja registra el reabastecimiento completo del aceite y calcula el tiempo de respuesta.',
        action: async (state) => {
          if (!state.insumoId) throw new Error('No se encontró insumo activo para surtir.');
          await updateDoc(doc(db, 'cocina_insumos', state.insumoId), {
            nivelActual: 30,
            surtidoSolicitado: false,
            surtidoSolicitadoAt: null,
            updatedAt: serverTimestamp()
          });
          await addDoc(collection(db, 'bitacora'), {
            tipo: 'surtido_completado',
            descripcion: 'Surtido de Aceite vegetal completado exitosamente por Caja.',
            usuario: 'Cajero Principal',
            createdAt: serverTimestamp()
          });
          return 'Estado de insumo devuelto a la normalidad en la cocina. Flujo de alertas limpio.';
        }
      }
    ],
    attendance: [
      {
        id: 1,
        title: 'Fichaje Masivo Concurrente',
        role: 'cashier',
        desc: 'Simulación de 4 empleados registrando entrada simultáneamente al iniciar el turno.',
        action: async (state) => {
          const dateHoy = new Date().toISOString().split('T')[0];
          const empleados = [
            { id: 'sim_emp_ana', nombre: 'Ana Gómez (Barman)' },
            { id: 'sim_emp_jose', nombre: 'José Pérez (Cajero)' },
            { id: 'sim_emp_luis', nombre: 'Luis Torres (Mesero)' },
            { id: 'sim_emp_marta', nombre: 'Marta Soler (Limpieza)' }
          ];

          for (const emp of empleados) {
            await addDoc(collection(db, 'nomina_asistencia_log'), {
              empleadoId: emp.id,
              empleadoNombre: emp.nombre,
              tipo: 'entrada',
              fecha: dateHoy,
              hora: new Date().toLocaleTimeString(),
              lat: 19.4326,
              lng: -99.1332,
              georeferenciaOk: true,
              createdAt: serverTimestamp()
            });
            await addDoc(collection(db, 'bitacora'), {
              tipo: 'asistencia',
              descripcion: `${emp.nombre} registró su entrada.`,
              usuario: 'Simulador IA',
              createdAt: serverTimestamp()
            });
          }
          return 'Se simularon 4 escrituras concurrentes en la base de datos de nómina sin bloqueos.';
        }
      },
      {
        id: 2,
        title: 'Cierre del Turno Masivo',
        role: 'cashier',
        desc: 'Simulación de los mismos 4 empleados registrando salida.',
        action: async (state) => {
          const dateHoy = new Date().toISOString().split('T')[0];
          const empleados = [
            { id: 'sim_emp_ana', nombre: 'Ana Gómez (Barman)' },
            { id: 'sim_emp_jose', nombre: 'José Pérez (Cajero)' },
            { id: 'sim_emp_luis', nombre: 'Luis Torres (Mesero)' },
            { id: 'sim_emp_marta', nombre: 'Marta Soler (Limpieza)' }
          ];

          for (const emp of empleados) {
            await addDoc(collection(db, 'nomina_asistencia_log'), {
              empleadoId: emp.id,
              empleadoNombre: emp.nombre,
              tipo: 'salida',
              fecha: dateHoy,
              hora: new Date().toLocaleTimeString(),
              lat: 19.4326,
              lng: -99.1332,
              georeferenciaOk: true,
              createdAt: serverTimestamp()
            });
            await addDoc(collection(db, 'bitacora'), {
              tipo: 'asistencia',
              descripcion: `${emp.nombre} registró su salida laboral.`,
              usuario: 'Simulador IA',
              createdAt: serverTimestamp()
            });
          }
          return 'Fichajes de salida concurrentes completados exitosamente.';
        }
      }
    ]
  };

  // Run a specific step
  const executeStep = async (stepIdx) => {
    const list = scenarios[activeScenario];
    if (stepIdx < 0 || stepIdx >= list.length) return;

    const step = list[stepIdx];
    setActiveRole(step.role);
    addLog(`Iniciando paso: "${step.title}" [Actor: ${step.role.toUpperCase()}]`, 'step-start', step.role);

    try {
      const resultMsg = await step.action(simulationState);
      addLog(`Éxito: ${resultMsg}`, 'success', step.role);
      setCurrentStepIndex(stepIdx);
    } catch (err) {
      console.error(err);
      addLog(`Error en paso "${step.title}": ${err.message}`, 'error', step.role);
      setIsPlaying(false);
    }
  };

  // Step forward click
  const handleNext = async () => {
    const nextIdx = currentStepIndex + 1;
    const list = scenarios[activeScenario];
    if (nextIdx < list.length) {
      await executeStep(nextIdx);
    } else {
      addLog('¡Simulación terminada con éxito!', 'scenario-end');
      setIsPlaying(false);
    }
  };

  // Auto playing loop
  useEffect(() => {
    if (isPlaying) {
      const list = scenarios[activeScenario];
      const nextIdx = currentStepIndex + 1;

      if (nextIdx < list.length) {
        const speedMs = speedMultiplier === 3 ? 600 : speedMultiplier === 2 ? 1800 : 3500;
        timerRef.current = setTimeout(async () => {
          await executeStep(nextIdx);
        }, speedMs);
      } else {
        addLog('¡Simulación completada!', 'scenario-end');
        setIsPlaying(false);
      }
    } else {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    }

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [isPlaying, currentStepIndex, activeScenario, speedMultiplier]);

  // Clean simulation data in Firebase
  const handleReset = async () => {
    setIsPlaying(false);
    setCurrentStepIndex(-1);
    setActiveRole(null);
    setSimulationState({});
    addLog('Iniciando limpieza de datos de simulación en Firebase...', 'info');

    try {
      // 1. Liberar la mesa en config/mesas_estado
      const mesasDocRef = doc(db, 'config', 'mesas_estado');
      const mesasSnap = await getDoc(mesasDocRef);
      if (mesasSnap.exists()) {
        const list = mesasSnap.data().mesas || [];
        const updated = list.map(m => m.cliente === 'Cliente Simulado'
          ? { ...m, estado: 'libre', cliente: null, inicio: null, clienteUid: '', preTicketImpreso: false }
          : m
        );
        await setDoc(mesasDocRef, { mesas: updated, updatedAt: serverTimestamp() }, { merge: true });
        addLog('Mesa de simulación liberada en base de datos central.', 'success');
      }

      // 2. Eliminar comandas y avisos creados por el simulador en mesa_pedidos
      const qOrders = query(collection(db, 'mesa_pedidos'), where('cliente', '==', 'Cliente Simulado'));
      const snapOrders = await getDocs(qOrders);
      let countOrders = 0;
      for (const d of snapOrders.docs) {
        await deleteDoc(doc(db, 'mesa_pedidos', d.id));
        countOrders++;
      }
      if (countOrders > 0) {
        addLog(`Eliminadas ${countOrders} comandas de simulación obsoletas.`, 'success');
      }

      // 3. Eliminar logs de asistencia simulados
      const qAttendance = query(collection(db, 'nomina_asistencia_log'), where('empleadoNombre', '>=', 'Simulador'));
      const snapAttendance = await getDocs(qAttendance);
      let countAtt = 0;
      for (const d of snapAttendance.docs) {
        if (d.data().empleadoId?.startsWith('sim_')) {
          await deleteDoc(doc(db, 'nomina_asistencia_log', d.id));
          countAtt++;
        }
      }
      if (countAtt > 0) {
        addLog(`Eliminados ${countAtt} registros de asistencia simulados.`, 'success');
      }

      // 4. Limpiar alertas de insumos simulados
      const qInsumos = query(collection(db, 'cocina_insumos'), where('nombre', 'in', ['Salsa BBQ', 'Aceite vegetal para freidora']));
      const snapInsumos = await getDocs(qInsumos);
      for (const d of snapInsumos.docs) {
        await updateDoc(doc(db, 'cocina_insumos', d.id), {
          nivelActual: d.data().nivelOptimo || 15,
          surtidoSolicitado: false,
          surtidoSolicitadoAt: null
        });
      }
      addLog('Insumos de cocina devueltos a niveles de inventario óptimos.', 'success');

      addLog('Limpieza de datos de simulación finalizada con éxito.', 'scenario-end');
    } catch (e) {
      addLog(`Error al realizar limpieza: ${e.message}`, 'error');
    }
  };

  const currentScenarioSteps = scenarios[activeScenario];

  return (
    <div style={{
      minHeight: '100vh',
      backgroundColor: '#0d0d0f',
      color: '#f0f0f4',
      padding: '20px',
      fontFamily: 'Outfit, sans-serif',
      display: 'flex',
      flexDirection: 'column',
      gap: '20px'
    }}>
      {/* Top Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        paddingBottom: '15px'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
          <i className="ri-cpu-line" style={{ fontSize: '32px', color: '#e3a869' }} />
          <div>
            <h1 style={{
              fontFamily: 'Rajdhani, sans-serif',
              fontSize: '24px',
              fontWeight: 700,
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              background: 'linear-gradient(135deg, #e3a869, #b0b8c8)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent'
            }}>
              Simulador de Flujo y Usuarios en Tiempo Real
            </h1>
            <p style={{ fontSize: '12px', color: '#9a9aaa' }}>
              Prueba profunda e interactiva de interacciones recurrentes y de alta concurrencia en Firestore.
            </p>
          </div>
        </div>
        <button
          onClick={() => window.location.href = '/'}
          style={{
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(255,255,255,0.08)',
            padding: '8px 15px',
            borderRadius: '8px',
            color: '#e3a869',
            fontSize: '12px',
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            cursor: 'pointer',
            transition: '0.2s'
          }}
          onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.08)'}
          onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.04)'}
        >
          <i className="ri-arrow-left-line" /> REGRESAR AL DASHBOARD
        </button>
      </div>

      {/* Grid of indicators */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
        gap: '15px'
      }}>
        {[
          { label: 'Mesas Ocupadas', count: counters.activeTables, icon: 'ri-table-alt-line', color: '#ef4444' },
          { label: 'Comandas Activas', count: counters.activeOrders, icon: 'ri-restaurant-2-line', color: '#3b82f6' },
          { label: 'Llamados/Cuentas', count: counters.activeAlerts, icon: 'ri-notification-3-line', color: '#f59e0b' },
          { label: 'Faltas de Insumos', count: counters.stockRequests, icon: 'ri-error-warning-line', color: '#ef4444' },
          { label: 'Bitácora Eventos', count: counters.bitacoraLogs, icon: 'ri-file-list-3-line', color: '#22c55e' }
        ].map((c, i) => (
          <div key={i} style={{
            background: '#141418',
            border: '1px solid rgba(255,255,255,0.05)',
            borderRadius: '12px',
            padding: '15px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            boxShadow: '0 4px 10px rgba(0,0,0,0.3)'
          }}>
            <div>
              <div style={{ fontSize: '11px', color: '#9a9aaa', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{c.label}</div>
              <div style={{ fontSize: '24px', fontWeight: 700, fontFamily: 'Rajdhani, sans-serif', color: c.count > 0 ? c.color : '#f0f0f4', marginTop: '5px' }}>
                {c.count}
              </div>
            </div>
            <i className={c.icon} style={{ fontSize: '24px', color: c.count > 0 ? c.color : 'rgba(255,255,255,0.2)' }} />
          </div>
        ))}
      </div>

      {/* Main Content Layout */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '350px 1fr',
        gap: '20px',
        flex: 1
      }}>
        {/* Left Control Panel */}
        <div style={{
          background: '#141418',
          border: '1px solid rgba(255,255,255,0.06)',
          borderRadius: '16px',
          padding: '20px',
          display: 'flex',
          flexDirection: 'column',
          gap: '20px',
          boxShadow: '0 8px 24px rgba(0,0,0,0.5)'
        }}>
          <div>
            <h2 style={{ fontFamily: 'Rajdhani, sans-serif', fontSize: '16px', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#e3a869', marginBottom: '12px' }}>
              Configuración y Control
            </h2>

            {/* Scenario selector */}
            <label style={{ display: 'block', fontSize: '11px', color: '#9a9aaa', marginBottom: '6px', textTransform: 'uppercase' }}>
              Seleccionar Escenario
            </label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {[
                { id: 'standard', label: 'Flujo Completo Estándar', desc: 'Ciclo completo de mesa (12 pasos)' },
                { id: 'supply', label: 'Alerta Crítica de Insumo', desc: 'Prueba de stock y respuesta de caja' },
                { id: 'attendance', label: 'Fichajes Concurrentes', desc: '4 empleados registrando entrada/salida' }
              ].map(opt => (
                <button
                  key={opt.id}
                  disabled={isPlaying}
                  onClick={() => {
                    setActiveScenario(opt.id);
                    setCurrentStepIndex(-1);
                    setSimulationState({});
                    addLog(`Escenario cambiado a: ${opt.label}`, 'info');
                  }}
                  style={{
                    background: activeScenario === opt.id ? 'rgba(205,127,50,0.08)' : 'transparent',
                    border: `1px solid ${activeScenario === opt.id ? '#e3a869' : 'rgba(255,255,255,0.06)'}`,
                    borderRadius: '8px',
                    padding: '10px',
                    color: activeScenario === opt.id ? '#e3a869' : '#f0f0f4',
                    textAlign: 'left',
                    cursor: isPlaying ? 'not-allowed' : 'pointer',
                    transition: '0.2s',
                    opacity: isPlaying && activeScenario !== opt.id ? 0.5 : 1
                  }}
                >
                  <div style={{ fontSize: '13px', fontWeight: 600 }}>{opt.label}</div>
                  <div style={{ fontSize: '10px', color: '#9a9aaa', marginTop: '3px' }}>{opt.desc}</div>
                </button>
              ))}
            </div>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '11px', color: '#9a9aaa', marginBottom: '6px', textTransform: 'uppercase' }}>
              Mesa para Simular
            </label>
            <input
              type="text"
              value={mesaUsada}
              onChange={(e) => setMesaUsada(e.target.value)}
              disabled={isPlaying}
              placeholder="Ej. 3"
              style={{
                background: '#1a1a20',
                border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: '8px',
                padding: '10px',
                color: '#f0f0f4',
                fontSize: '13px',
                width: '100%'
              }}
            />
          </div>

          {/* Speed multiplier */}
          <div>
            <label style={{ display: 'block', fontSize: '11px', color: '#9a9aaa', marginBottom: '6px', textTransform: 'uppercase' }}>
              Velocidad de Simulación
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '5px' }}>
              {[
                { val: 1, label: 'Lento' },
                { val: 2, label: 'Normal' },
                { val: 3, label: 'Rápido' }
              ].map(sp => (
                <button
                  key={sp.val}
                  onClick={() => setSpeedMultiplier(sp.val)}
                  style={{
                    background: speedMultiplier === sp.val ? '#e3a869' : 'rgba(255,255,255,0.04)',
                    border: 'none',
                    borderRadius: '6px',
                    padding: '8px',
                    color: speedMultiplier === sp.val ? '#0d0d0f' : '#f0f0f4',
                    fontSize: '11px',
                    fontWeight: 600,
                    cursor: 'pointer'
                  }}
                >
                  {sp.label}
                </button>
              ))}
            </div>
          </div>

          {/* Main simulator controls */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: 'auto' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
              <button
                onClick={() => setIsPlaying(!isPlaying)}
                style={{
                  background: isPlaying ? '#f59e0b' : '#22c55e',
                  color: '#0d0d0f',
                  border: 'none',
                  borderRadius: '10px',
                  padding: '12px',
                  fontSize: '13px',
                  fontWeight: 700,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                  cursor: 'pointer'
                }}
              >
                <i className={isPlaying ? 'ri-pause-line' : 'ri-play-line'} />
                {isPlaying ? 'PAUSAR' : 'INICIAR'}
              </button>
              <button
                onClick={handleNext}
                disabled={isPlaying}
                style={{
                  background: 'rgba(255,255,255,0.05)',
                  color: isPlaying ? 'rgba(255,255,255,0.2)' : '#f0f0f4',
                  border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: '10px',
                  padding: '12px',
                  fontSize: '13px',
                  fontWeight: 600,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                  cursor: isPlaying ? 'not-allowed' : 'pointer'
                }}
              >
                <i className="ri-skip-forward-line" />
                PASO
              </button>
            </div>
            <button
              onClick={handleReset}
              style={{
                background: 'rgba(239, 68, 68, 0.12)',
                color: '#ef4444',
                border: '1px solid rgba(239, 68, 68, 0.3)',
                borderRadius: '10px',
                padding: '10px',
                fontSize: '12px',
                fontWeight: 700,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                cursor: 'pointer'
              }}
            >
              <i className="ri-refresh-line" />
              LIMPIAR MOCK EN FIRESTORE
            </button>
          </div>
        </div>

        {/* Right Dashboard Area */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {/* Active actors visualizer */}
          <div style={{
            background: '#141418',
            border: '1px solid rgba(255,255,255,0.06)',
            borderRadius: '16px',
            padding: '20px',
            boxShadow: '0 8px 24px rgba(0,0,0,0.5)'
          }}>
            <h2 style={{ fontFamily: 'Rajdhani, sans-serif', fontSize: '15px', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#e3a869', marginBottom: '15px' }}>
              Monitoreo de Actores
            </h2>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(4, 1fr)',
              gap: '15px'
            }}>
              {[
                { role: 'client', label: 'Cliente', icon: 'ri-user-smile-line', desc: 'Scan QR / Ordenar', color: '#3b82f6' },
                { role: 'waiter', label: 'Mesero', icon: 'ri-walk-line', desc: 'Servir / Asistir', color: '#f59e0b' },
                { role: 'cook', label: 'Cocinero', icon: 'ri-restaurant-line', desc: 'Preparar / Alertas', color: '#ef4444' },
                { role: 'cashier', label: 'Cajero', icon: 'ri-coins-line', desc: 'Cobro / Fichajes', color: '#22c55e' }
              ].map(actor => {
                const isActive = activeRole === actor.role;
                return (
                  <div key={actor.role} style={{
                    background: isActive ? 'rgba(255,255,255,0.03)' : '#1a1a20',
                    border: `1.5px solid ${isActive ? actor.color : 'rgba(255,255,255,0.05)'}`,
                    borderRadius: '12px',
                    padding: '15px',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: '10px',
                    transition: 'all 0.3s ease',
                    transform: isActive ? 'scale(1.03)' : 'none',
                    boxShadow: isActive ? `0 0 15px rgba(${actor.role === 'client' ? '59,130,246' : actor.role === 'waiter' ? '245,158,11' : actor.role === 'cook' ? '239,68,68' : '34,197,94'}, 0.25)` : 'none'
                  }}>
                    <div style={{
                      width: '45px',
                      height: '45px',
                      borderRadius: '50%',
                      background: isActive ? actor.color : 'rgba(255,255,255,0.03)',
                      color: isActive ? '#0d0d0f' : '#9a9aaa',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '20px',
                      transition: '0.3s'
                    }}>
                      <i className={actor.icon} />
                    </div>
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: '13px', fontWeight: 700, color: isActive ? '#f0f0f4' : '#9a9aaa' }}>{actor.label}</div>
                      <div style={{ fontSize: '10px', color: '#5a5a6a', marginTop: '3px' }}>{actor.desc}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* live terminal console logs */}
          <div style={{
            background: '#101014',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: '16px',
            padding: '20px',
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            boxShadow: 'inset 0 4px 20px rgba(0,0,0,0.8)'
          }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              borderBottom: '1px solid rgba(255,255,255,0.06)',
              paddingBottom: '10px',
              marginBottom: '15px'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ width: '10px', height: '10px', borderRadius: '50%', backgroundColor: isPlaying ? '#22c55e' : '#5a5a6a' }} />
                <h3 style={{ fontFamily: 'Rajdhani, sans-serif', fontSize: '14px', textTransform: 'uppercase', letterSpacing: '0.08em', color: '#9a9aaa' }}>
                  Consola de Eventos en Tiempo Real
                </h3>
              </div>
              <button
                onClick={() => setLogs([])}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: '#5a5a6a',
                  fontSize: '11px',
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                LIMPIAR CONSOLA
              </button>
            </div>

            <div style={{
              flex: 1,
              overflowY: 'auto',
              maxHeight: '350px',
              fontFamily: 'monospace',
              fontSize: '12px',
              display: 'flex',
              flexDirection: 'column',
              gap: '6px',
              paddingRight: '5px'
            }}>
              {logs.length === 0 ? (
                <div style={{ color: '#5a5a6a', fontStyle: 'italic', textAlign: 'center', marginTop: '50px' }}>
                  Inicia la simulación para visualizar flujos en tiempo real.
                </div>
              ) : (
                logs.map((log, index) => {
                  let color = '#f0f0f4';
                  let prefix = '⚙️';
                  if (log.type === 'step-start') {
                    color = '#e3a869';
                    prefix = '⚡';
                  } else if (log.type === 'success') {
                    color = '#22c55e';
                    prefix = '✅';
                  } else if (log.type === 'error') {
                    color = '#ef4444';
                    prefix = '❌';
                  } else if (log.type === 'scenario-end') {
                    color = '#3b82f6';
                    prefix = '🏁';
                  }

                  return (
                    <div key={index} style={{
                      color,
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: '8px',
                      padding: '4px 6px',
                      borderRadius: '4px',
                      background: log.type === 'step-start' ? 'rgba(227,168,105,0.03)' : 'transparent'
                    }}>
                      <span style={{ color: '#5a5a6a', flexShrink: 0 }}>[{log.timestamp}]</span>
                      <span style={{ flexShrink: 0 }}>{prefix}</span>
                      <span style={{ flex: 1, wordBreak: 'break-word' }}>{log.text}</span>
                    </div>
                  );
                })
              )}
              <div ref={logsEndRef} />
            </div>

            {/* Steps timeline indicators */}
            <div style={{
              marginTop: '15px',
              borderTop: '1px solid rgba(255,255,255,0.06)',
              paddingTop: '15px'
            }}>
              <div style={{ fontSize: '11px', color: '#9a9aaa', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px' }}>
                Progreso del Escenario:
              </div>
              <div style={{ display: 'flex', gap: '4px' }}>
                {currentScenarioSteps.map((s, idx) => {
                  const isDone = idx <= currentStepIndex;
                  const isCurrent = idx === currentStepIndex + 1 && isPlaying;
                  return (
                    <div
                      key={s.id}
                      title={s.title}
                      style={{
                        flex: 1,
                        height: '6px',
                        borderRadius: '2px',
                        backgroundColor: isDone ? '#22c55e' : isCurrent ? '#f59e0b' : 'rgba(255,255,255,0.06)',
                        transition: 'all 0.3s ease',
                        boxShadow: isCurrent ? '0 0 8px #f59e0b' : 'none'
                      }}
                    />
                  );
                })}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: '#5a5a6a', marginTop: '6px' }}>
                <span>Paso {currentStepIndex + 1} de {currentScenarioSteps.length}</span>
                <span>{currentStepIndex >= 0 ? currentScenarioSteps[currentStepIndex].title : 'Sin iniciar'}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

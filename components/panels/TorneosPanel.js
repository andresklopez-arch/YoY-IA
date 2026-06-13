'use client';
import { useState, useEffect } from 'react';
import { obfuscate, deobfuscate } from '@/lib/crypto';
import { db } from '@/lib/firebase';
import { doc, setDoc, onSnapshot, serverTimestamp } from 'firebase/firestore';



const INIT_TORNEOS = [
  {
    id: 1, nombre: 'Liga Mensual Mayo', modalidad: 'Round Robin', estado: 'activo',
    jugadores: 4, max: 16, premio: '$3,000', inscripcion: '$150', fechaInicio: '2026-05-01',
    partidas: [
      { id: 1, j1: 'Carlos R.', j2: 'Pedro M.', resultado: '3-1', fecha: '2026-05-15', ganador: 'Carlos R.' },
      { id: 2, j1: 'Ana G.',    j2: 'Luis H.',  resultado: '3-0', fecha: '2026-05-16', ganador: 'Ana G.' },
      { id: 3, j1: 'Socio #12', j2: 'Carlos R.', resultado: '2-3', fecha: '2026-05-17', ganador: 'Carlos R.' },
    ],
    ranking: [
      { pos: 1, nombre: 'Carlos R.', pj: 5, pg: 4, pp: 1, pts: 12, elo: 1650 },
      { pos: 2, nombre: 'Ana G.',    pj: 5, pg: 4, pp: 1, pts: 12, elo: 1680 },
      { pos: 3, nombre: 'Socio #12', pj: 4, pg: 2, pp: 2, pts: 6, elo: 1540 },
      { pos: 4, nombre: 'Pedro M.',  pj: 4, pg: 1, pp: 3, pts: 3, elo: 1410 },
    ],
  },
  {
    id: 2, nombre: 'Torneo Rápido Sábado', modalidad: 'Eliminación Directa', estado: 'inscripcion',
    jugadores: 4, max: 8, premio: '$800', inscripcion: '$80', fechaInicio: '2026-06-01',
    partidas: [],
    ranking: [
      { pos: 1, nombre: 'Carlos R.', pj: 0, pg: 0, pp: 0, pts: 0, elo: 1500 },
      { pos: 2, nombre: 'Ana G.',    pj: 0, pg: 0, pp: 0, pts: 0, elo: 1500 },
      { pos: 3, nombre: 'Pedro M.',  pj: 0, pg: 0, pp: 0, pts: 0, elo: 1500 },
      { pos: 4, nombre: 'Luis H.',   pj: 0, pg: 0, pp: 0, pts: 0, elo: 1500 },
    ],
  },
];

export default function TorneosPanel({ showToast }) {
  const [torneos, setTorneos] = useState([]);
  const [torneoActivo, setTorneoActivo] = useState(null);
  const [vista, setVista] = useState('ranking');

  // Modales
  const [showCrearTorneo, setShowCrearTorneo] = useState(false);
  const [showRegistrarPartida, setShowRegistrarPartida] = useState(false);
  const [showRegistrarJugador, setShowRegistrarJugador] = useState(false);

  // Formulario Crear Torneo
  const [nuevoNombre, setNuevoNombre] = useState('');
  const [nuevaModalidad, setNuevaModalidad] = useState('Round Robin');
  const [nuevoMax, setNuevoMax] = useState('16');
  const [nuevoPremio, setNuevoPremio] = useState('$1,500');
  const [nuevaInscripcion, setNuevaInscripcion] = useState('$100');
  const [nuevaFecha, setNuevaFecha] = useState('');
  const [nuevosJugadoresText, setNuevosJugadoresText] = useState('Carlos R., Pedro M., Ana G., Luis H.');

  // Formulario Registrar Partida
  const [partidaJ1, setPartidaJ1] = useState('');
  const [partidaJ2, setPartidaJ2] = useState('');
  const [scoreJ1, setScoreJ1] = useState('0');
  const [scoreJ2, setScoreJ2] = useState('0');
  const [tipoPartida, setTipoPartida] = useState('regular');

  // Formulario Registrar Jugador
  const [nuevoJugadorNombre, setNuevoJugadorNombre] = useState('');

  // Captura avanzada de torneos
  const [mesas, setMesas] = useState([]);
  const [listaNuevosJugadores, setListaNuevosJugadores] = useState([]);
  const [nombreTmpJugador, setNombreTmpJugador] = useState('');
  const [ptsTmpJugador, setPtsTmpJugador] = useState(0);
  const [categoriaTmpJugador, setCategoriaTmpJugador] = useState('3ra');
  const [mesasSeleccionadas, setMesasSeleccionadas] = useState([]);
  const [partidaAEditar, setPartidaAEditar] = useState(null);
  const [nuevoJugadorPts, setNuevoJugadorPts] = useState(0);

  // Estados del Ranking Global y Modos
  const [vistaPrincipal, setVistaPrincipal] = useState('torneos');
  const [modalityTab, setModalityTab] = useState('pool');
  const [rankingHistorico, setRankingHistorico] = useState({ pool: [], carambola: [], snooker: [] });
  const [nuevoJuegoTipo, setNuevoJuegoTipo] = useState('Pool');

  useEffect(() => {
    // Escucha en tiempo real de Firestore para los torneos con reconciliación offline LWW
    const unsub = onSnapshot(doc(db, 'config', 'torneos'), snap => {
      if (snap.exists()) {
        const firestoreTorneos = snap.data().torneos || [];
        if (firestoreTorneos.length > 0) {
          let localRaw = null;
          try {
            localRaw = localStorage.getItem('yoy_billar_torneos');
          } catch (e) {}
          const localTorneos = localRaw ? (deobfuscate(localRaw) || []) : [];
          
          // CRDT LWW merge
          const mergedTorneos = [...localTorneos];
          firestoreTorneos.forEach(ft => {
            const localIdx = mergedTorneos.findIndex(lt => lt.id === ft.id);
            if (localIdx === -1) {
              mergedTorneos.push(ft);
            } else {
              const lt = mergedTorneos[localIdx];
              const ltTime = lt.lastModified || 0;
              const ftTime = ft.lastModified || 0;
              if (ftTime > ltTime) {
                mergedTorneos[localIdx] = ft;
              }
            }
          });
          
          setTorneos(mergedTorneos);
          try {
            localStorage.setItem('yoy_billar_torneos', obfuscate(mergedTorneos));
          } catch (e) {}
          
          const localHasNewerUpdates = mergedTorneos.some(mt => {
            const ft = firestoreTorneos.find(f => f.id === mt.id);
            return (mt.lastModified || 0) > (ft?.lastModified || 0);
          });
          
          if (localHasNewerUpdates) {
            setDoc(doc(db, 'config', 'torneos'), {
              torneos: mergedTorneos,
              updatedAt: serverTimestamp()
            }).catch(err => console.error("Error reconciling torneos:", err));
          }
          
          setTorneoActivo(prev => {
            if (!prev) return mergedTorneos[0];
            const act = mergedTorneos.find(t => t.id === prev.id);
            return act || mergedTorneos[0];
          });
        }
      } else {
        let localRaw = null;
        try {
          localRaw = localStorage.getItem('yoy_billar_torneos');
        } catch (e) {}
        const localTorneos = localRaw ? (deobfuscate(localRaw) || []) : INIT_TORNEOS;
        const mappedTorneos = localTorneos.map(t => ({ ...t, lastModified: t.lastModified || Date.now() }));
        setTorneos(mappedTorneos);
        try {
          localStorage.setItem('yoy_billar_torneos', obfuscate(mappedTorneos));
        } catch (e) {}
        setDoc(doc(db, 'config', 'torneos'), { torneos: mappedTorneos, updatedAt: serverTimestamp() });
      }
    });

    // Cargar mesas
    const savedMesas = localStorage.getItem('yoy_billar_mesas');
    if (savedMesas) {
      setMesas(deobfuscate(savedMesas) || []);
    } else {
      const defaultMesas = [
        { id: 1, nombre: 'Mesa 1', tipo: 'Carambola 3B', estado: 'libre',    cliente: null, inicio: null, tarifa: 80, socios: false },
        { id: 2, nombre: 'Mesa 2', tipo: 'Carambola 3B', estado: 'libre',  cliente: null, inicio: null, tarifa: 80, socios: false },
        { id: 3, nombre: 'Mesa 3', tipo: 'Pool 9B',      estado: 'libre', cliente: null, inicio: null, tarifa: 60, socios: false },
        { id: 4, nombre: 'Mesa 4', tipo: 'Carambola 3B', estado: 'libre',    cliente: null, inicio: null, tarifa: 80, socios: false },
        { id: 5, nombre: 'Mesa 5', tipo: 'Snooker',      estado: 'libre',   cliente: null, inicio: null, tarifa: 100, socios: false },
        { id: 6, nombre: 'Mesa 6', tipo: 'Pool 9B',      estado: 'libre',    cliente: null, inicio: null, tarifa: 60, socios: false },
        { id: 7, nombre: 'Mesa 7', tipo: 'Carambola 3B', estado: 'libre',  cliente: null, inicio: null, tarifa: 0, socios: true },
        { id: 8, nombre: 'Mesa 8', tipo: 'Pool 9B',      estado: 'libre',    cliente: null, inicio: null, tarifa: 60, socios: false },
      ];
      setMesas(defaultMesas);
      localStorage.setItem('yoy_billar_mesas', obfuscate(defaultMesas));
    }

    return () => unsub();
  }, []);

  const saveTorneos = async (newTorneos) => {
    const updatedWithTime = newTorneos.map(t => ({ ...t, lastModified: Date.now() }));
    setTorneos(updatedWithTime);
    try {
      localStorage.setItem('yoy_billar_torneos', obfuscate(updatedWithTime));
      await setDoc(doc(db, 'config', 'torneos'), {
        torneos: updatedWithTime,
        updatedAt: serverTimestamp()
      });
    } catch (err) {
      console.error("Error saving torneos:", err);
    }
    if (torneoActivo) {
      const updatedAct = updatedWithTime.find(t => t.id === torneoActivo.id);
      if (updatedAct) {
        setTorneoActivo(updatedAct);
      }
    }
  };

  const asignarMesasAPartidas = (partidasList, mesasAsignadasIds) => {
    const savedMesas = localStorage.getItem('yoy_billar_mesas');
    let currentMesas = savedMesas ? (deobfuscate(savedMesas) || []) : [];

    let updatedPartidas = [...partidasList];

    updatedPartidas = updatedPartidas.map(partida => {
      if (partida.estado === 'esperando_mesa') {
        const mesaLibreIndex = currentMesas.findIndex(m => 
          mesasAsignadasIds.includes(m.id) && m.estado === 'libre'
        );

        if (mesaLibreIndex !== -1) {
          const mesa = currentMesas[mesaLibreIndex];
          currentMesas[mesaLibreIndex] = {
            ...mesa,
            estado: 'ocupada',
            cliente: `Torneo: ${partida.j1} vs ${partida.j2}`,
            inicio: Date.now()
          };
          return {
            ...partida,
            mesaId: mesa.id,
            estado: 'activo'
          };
        }
      }
      return partida;
    });

    localStorage.setItem('yoy_billar_mesas', obfuscate(currentMesas));
    setMesas(currentMesas);
    return updatedPartidas;
  };

  const handleCrearTorneo = (e) => {
    e.preventDefault();
    if (!nuevoNombre || !nuevaFecha) {
      showToast('Por favor llena los campos obligatorios', 'error');
      return;
    }

    if (listaNuevosJugadores.length < 2) {
      showToast('Por favor agrega al menos 2 jugadores.', 'warning');
      return;
    }

    if (mesasSeleccionadas.length === 0) {
      showToast('Por favor selecciona al menos una mesa para el torneo.', 'warning');
      return;
    }

    const nuevo = {
      id: Date.now(),
      nombre: nuevoNombre,
      modalidad: nuevaModalidad,
      estado: 'inscripcion',
      jugadores: listaNuevosJugadores.length,
      max: parseInt(nuevoMax) || 16,
      premio: nuevoPremio,
      inscripcion: nuevaInscripcion,
      fechaInicio: nuevaFecha,
      partidas: [],
      mesasAsignadas: mesasSeleccionadas,
      rondaActual: 1,
      ranking: listaNuevosJugadores.map((j, idx) => ({
        pos: idx + 1,
        nombre: j.nombre,
        puntosInicio: j.puntosInicio,
        pj: 0,
        pg: 0,
        pp: 0,
        pts: j.puntosInicio,
        elo: 1500
      }))
    };

    const updated = [...torneos, nuevo];
    saveTorneos(updated);
    setTorneoActivo(nuevo);
    setShowCrearTorneo(false);
    showToast('Torneo creado en fase de inscripción', 'success');

    // Reset fields
    setNuevoNombre('');
    setNuevaModalidad('Round Robin');
    setNuevoMax('16');
    setNuevoPremio('$1,500');
    setNuevaInscripcion('$100');
    setNuevaFecha('');
    setListaNuevosJugadores([
      { nombre: 'Carlos R.', puntosInicio: 0 },
      { nombre: 'Pedro M.', puntosInicio: 5 },
      { nombre: 'Ana G.', puntosInicio: 0 },
      { nombre: 'Luis H.', puntosInicio: 5 },
    ]);
    setMesasSeleccionadas([]);
  };

  const handleRegistrarJugador = (e) => {
    e.preventDefault();
    if (!nuevoJugadorNombre.trim()) {
      showToast('Nombre de jugador inválido', 'error');
      return;
    }

    const pts = parseInt(nuevoJugadorPts) || 0;

    if (torneoActivo.ranking.some(r => r.nombre.toLowerCase() === nuevoJugadorNombre.trim().toLowerCase())) {
      showToast('El jugador ya está registrado en este torneo', 'error');
      return;
    }

    if (torneoActivo.ranking.length >= torneoActivo.max) {
      showToast('Capacidad máxima del torneo alcanzada', 'warning');
      return;
    }

    const updatedRanking = [
      ...torneoActivo.ranking,
      {
        pos: torneoActivo.ranking.length + 1,
        nombre: nuevoJugadorNombre.trim(),
        puntosInicio: pts,
        pj: 0,
        pg: 0,
        pp: 0,
        pts: pts,
        elo: 1500
      }
    ];

    const updatedTorneos = torneos.map(t => {
      if (t.id === torneoActivo.id) {
        return {
          ...t,
          jugadores: updatedRanking.length,
          ranking: updatedRanking
        };
      }
      return t;
    });

    saveTorneos(updatedTorneos);
    setShowRegistrarJugador(false);
    setNuevoJugadorNombre('');
    setNuevoJugadorPts(0);
    showToast('Jugador agregado correctamente', 'success');
  };

  const handleIniciarTorneo = () => {
    if (torneoActivo.ranking.length < 2) {
      showToast('Se necesitan al menos 2 jugadores para iniciar el torneo', 'error');
      return;
    }

    // Mezclar jugadores
    const shuffled = [...torneoActivo.ranking].sort(() => 0.5 - Math.random());
    const partidasRonda = [];
    let matchId = 1;
    for (let i = 0; i < shuffled.length; i += 2) {
      if (i + 1 < shuffled.length) {
        partidasRonda.push({
          id: matchId++,
          j1: shuffled[i].nombre,
          j2: shuffled[i + 1].nombre,
          resultado: null,
          ganador: null,
          ronda: 1,
          mesaId: null,
          estado: 'esperando_mesa'
        });
      } else {
        partidasRonda.push({
          id: matchId++,
          j1: shuffled[i].nombre,
          j2: 'BYE',
          resultado: 'BYE',
          ganador: shuffled[i].nombre,
          ronda: 1,
          mesaId: null,
          estado: 'completado'
        });
      }
    }

    const mesasAsignadasIds = torneoActivo.mesasAsignadas || [];
    const partidasConMesa = asignarMesasAPartidas(partidasRonda, mesasAsignadasIds);

    const updatedTorneos = torneos.map(t => {
      if (t.id === torneoActivo.id) {
        return {
          ...t,
          estado: 'activo',
          rondaActual: 1,
          partidas: partidasConMesa
        };
      }
      return t;
    });

    saveTorneos(updatedTorneos);
    showToast('Torneo iniciado. Partidas generadas y mesas asignadas.', 'success');
  };

  const handleCompletarTorneo = () => {
    const updatedTorneos = torneos.map(t => {
      if (t.id === torneoActivo.id) {
        return { ...t, estado: 'completado' };
      }
      return t;
    });

    saveTorneos(updatedTorneos);
    showToast('Torneo marcado como completado', 'success');
  };

  const handleRegistrarPartida = (e) => {
    e.preventDefault();
    if (!partidaJ1 || !partidaJ2) {
      showToast('Selecciona ambos jugadores', 'error');
      return;
    }

    const s1 = parseInt(scoreJ1) || 0;
    const s2 = parseInt(scoreJ2) || 0;

    let ganadorName = 'Empate';
    let outcome = 'Empate';
    if (s1 > s2) {
      ganadorName = partidaJ1;
      outcome = 'A';
    } else if (s2 > s1) {
      ganadorName = partidaJ2;
      outcome = 'B';
    }

    const p1 = torneoActivo.ranking.find(r => r.nombre === partidaJ1);
    const p2 = torneoActivo.ranking.find(r => r.nombre === partidaJ2);

    const elo1 = p1 ? p1.elo : 1500;
    const elo2 = p2 ? p2.elo : 1500;

    const getKFactor = (playerStats, matchType) => {
      let baseK = 32;
      if (playerStats && playerStats.pj >= 20) {
        baseK = 16;
      }
      if (matchType === 'amistoso') {
        return Math.max(8, Math.round(baseK * 0.5));
      } else if (matchType === 'final') {
        return Math.round(baseK * 1.5);
      }
      return baseK;
    };

    const K1 = getKFactor(p1, tipoPartida);
    const K2 = getKFactor(p2, tipoPartida);

    const expected1 = 1 / (1 + Math.pow(10, (elo2 - elo1) / 400));
    const expected2 = 1 / (1 + Math.pow(10, (elo1 - elo2) / 400));

    let valOutcome1 = 0.5;
    let valOutcome2 = 0.5;
    if (outcome === 'A') {
      valOutcome1 = 1;
      valOutcome2 = 0;
    } else if (outcome === 'B') {
      valOutcome1 = 0;
      valOutcome2 = 1;
    }

    const newElo1 = Math.round(elo1 + K1 * (valOutcome1 - expected1));
    const newElo2 = Math.round(elo2 + K2 * (valOutcome2 - expected2));

    const updatedRanking = torneoActivo.ranking.map(r => {
      if (r.nombre === partidaJ1) {
        return {
          ...r,
          pj: r.pj + 1,
          pg: outcome === 'A' ? r.pg + 1 : r.pg,
          pp: outcome === 'B' ? r.pp + 1 : r.pp,
          pts: outcome === 'A' ? r.pts + 3 : outcome === 'Empate' ? r.pts + 1 : r.pts,
          elo: newElo1
        };
      }
      if (r.nombre === partidaJ2) {
        return {
          ...r,
          pj: r.pj + 1,
          pg: outcome === 'B' ? r.pg + 1 : r.pg,
          pp: outcome === 'A' ? r.pp + 1 : r.pp,
          pts: outcome === 'B' ? r.pts + 3 : outcome === 'Empate' ? r.pts + 1 : r.pts,
          elo: newElo2
        };
      }
      return r;
    });

    updatedRanking.sort((a, b) => {
      if (b.pts !== a.pts) return b.pts - a.pts;
      if (b.elo !== a.elo) return b.elo - a.elo;
      return b.pg - a.pg;
    });

    updatedRanking.forEach((r, idx) => {
      r.pos = idx + 1;
    });

    if (partidaAEditar && partidaAEditar.mesaId) {
      const savedMesas = localStorage.getItem('yoy_billar_mesas');
      let currentMesas = savedMesas ? (deobfuscate(savedMesas) || []) : [];
      const mesaIdx = currentMesas.findIndex(m => m.id === partidaAEditar.mesaId);
      if (mesaIdx !== -1) {
        currentMesas[mesaIdx] = {
          ...currentMesas[mesaIdx],
          estado: 'libre',
          cliente: null,
          inicio: null
        };
        localStorage.setItem('yoy_billar_mesas', obfuscate(currentMesas));
        setMesas(currentMesas);
      }
    }

    let updatedPartidas = [];
    if (partidaAEditar) {
      updatedPartidas = torneoActivo.partidas.map(p => 
        p.id === partidaAEditar.id ? { ...p, resultado: `${s1}-${s2}`, ganador: ganadorName, estado: 'completado' } : p
      );
    } else {
      const nuevaPartida = {
        id: Date.now(),
        j1: partidaJ1,
        j2: partidaJ2,
        resultado: `${s1}-${s2}`,
        fecha: new Date().toISOString().split('T')[0],
        ganador: ganadorName,
        ronda: torneoActivo.rondaActual || 1,
        estado: 'completado'
      };
      updatedPartidas = [nuevaPartida, ...torneoActivo.partidas];
    }

    updatedPartidas = asignarMesasAPartidas(updatedPartidas, torneoActivo.mesasAsignadas || []);

    let nextRondaNum = torneoActivo.rondaActual || 1;
    let finalizado = false;
    let campeon = torneoActivo.campeon || null;

    if (torneoActivo.estado === 'activo') {
      const partidasRondaActual = updatedPartidas.filter(p => p.ronda === torneoActivo.rondaActual);
      const todasCompletas = partidasRondaActual.every(p => p.estado === 'completado');

      if (todasCompletas) {
        const ganadores = partidasRondaActual.map(p => p.ganador).filter(g => g && g !== 'BYE');
        if (ganadores.length === 1) {
          finalizado = true;
          campeon = ganadores[0];
        } else if (ganadores.length > 1) {
          const ganadoresShuffled = [...ganadores].sort(() => 0.5 - Math.random());
          nextRondaNum = (torneoActivo.rondaActual || 1) + 1;
          const nuevasPartidasSiguienteRonda = [];
          let nextMatchId = updatedPartidas.length + 1;
          for (let i = 0; i < ganadoresShuffled.length; i += 2) {
            if (i + 1 < ganadoresShuffled.length) {
              nuevasPartidasSiguienteRonda.push({
                id: nextMatchId++,
                j1: ganadoresShuffled[i],
                j2: ganadoresShuffled[i + 1],
                ronda: nextRondaNum,
                resultado: null,
                ganador: null,
                mesaId: null,
                estado: 'esperando_mesa'
              });
            } else {
              nuevasPartidasSiguienteRonda.push({
                id: nextMatchId++,
                j1: ganadoresShuffled[i],
                j2: 'BYE',
                resultado: 'BYE',
                ganador: ganadoresShuffled[i],
                ronda: nextRondaNum,
                mesaId: null,
                estado: 'completado'
              });
            }
          }
          updatedPartidas = [...updatedPartidas, ...nuevasPartidasSiguienteRonda];
          updatedPartidas = asignarMesasAPartidas(updatedPartidas, torneoActivo.mesasAsignadas || []);
        }
      }
    }

    const updatedTorneos = torneos.map(t => {
      if (t.id === torneoActivo.id) {
        return {
          ...t,
          partidas: updatedPartidas,
          ranking: updatedRanking,
          rondaActual: nextRondaNum,
          estado: finalizado ? 'completado' : t.estado,
          campeon: campeon
        };
      }
      return t;
    });

    saveTorneos(updatedTorneos);
    setShowRegistrarPartida(false);

    setPartidaJ1('');
    setPartidaJ2('');
    setScoreJ1('0');
    setScoreJ2('0');
    setTipoPartida('regular');
    setPartidaAEditar(null);

    if (finalizado) {
      showToast(`🏆 ¡El torneo ha finalizado! Campeón: ${campeon}`, 'success');
    } else if (nextRondaNum > (torneoActivo.rondaActual || 1)) {
      showToast(`¡Ronda ${torneoActivo.rondaActual} concluida! Iniciando Ronda ${nextRondaNum}.`, 'success');
    } else {
      showToast(`Partida registrada. ELOs actualizados.`, 'success');
    }
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title gradient-bronze">Torneos y Ligas</h1>
          <p className="page-subtitle">Gestión debrackets, ranking ELO y estadísticas de juego</p>
        </div>
        <button className="btn btn-primary btn-sm" onClick={() => setShowCrearTorneo(true)}>
          <i className="ri-add-line" /> Crear Torneo
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: 20, alignItems: 'start' }}>
        {/* Lista de torneos */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {torneos.map(t => (
            <div
              key={t.id}
              className="card"
              style={{
                cursor: 'pointer',
                borderColor: torneoActivo?.id === t.id ? 'var(--border-bronze)' : 'var(--border)',
                background: torneoActivo?.id === t.id ? 'linear-gradient(135deg, var(--bg-card), rgba(205,127,50,0.05))' : 'var(--bg-card)',
              }}
              onClick={() => {
                setTorneoActivo(t);
                setVista('ranking');
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                <h3 style={{ fontSize: 13, fontWeight: 700 }}>{t.nombre}</h3>
                <span className={`badge ${t.estado === 'activo' ? 'badge-success' : t.estado === 'completado' ? 'badge-info' : 'badge-warning'}`}>
                  {t.estado === 'activo' ? 'Activo' : t.estado === 'completado' ? 'Completado' : 'Inscripción'}
                </span>
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8 }}>{t.modalidad}</div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
                <span style={{ color: 'var(--text-secondary)' }}>
                  <i className="ri-group-line" style={{ marginRight: 4 }} />{t.ranking.length}/{t.max}
                </span>
                <span style={{ color: 'var(--bronze-light)', fontWeight: 700 }}>{t.premio}</span>
              </div>
            </div>
          ))}
        </div>

        {/* Detalle del torneo */}
        {torneoActivo ? (
          <div>
            {/* Header del torneo */}
            <div className="card card-bronze" style={{ marginBottom: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 700, marginBottom: 4 }}>{torneoActivo.nombre}</h2>
                  <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>{torneoActivo.modalidad} · Inició: {torneoActivo.fechaInicio}</p>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 900, color: 'var(--bronze-light)' }}>{torneoActivo.premio}</div>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Premio Total</div>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 12, marginTop: 16 }}>
                <div style={{ background: 'var(--bg-elevated)', borderRadius: 10, padding: '10px 16px', flex: 1, textAlign: 'center' }}>
                  <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--text-primary)' }}>{torneoActivo.ranking.length}/{torneoActivo.max}</div>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em', marginTop: 2 }}>Jugadores</div>
                </div>
                <div style={{ background: 'var(--bg-elevated)', borderRadius: 10, padding: '10px 16px', flex: 1, textAlign: 'center' }}>
                  <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--text-primary)' }}>{torneoActivo.partidas.length}</div>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em', marginTop: 2 }}>Partidas</div>
                </div>
                <div style={{ background: 'var(--bg-elevated)', borderRadius: 10, padding: '10px 16px', flex: 1, textAlign: 'center' }}>
                  <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--bronze-light)' }}>{torneoActivo.inscripcion}</div>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em', marginTop: 2 }}>Inscripción</div>
                </div>
              </div>

              {/* Botones de acción del Torneo */}
              <div style={{ marginTop: 16, display: 'flex', gap: 10 }}>
                {torneoActivo.estado === 'inscripcion' && (
                  <>
                    <button className="btn btn-primary btn-xs" onClick={() => setShowRegistrarJugador(true)}>
                      <i className="ri-user-add-line" /> Inscribir Jugador
                    </button>
                    <button className="btn btn-success btn-xs" onClick={handleIniciarTorneo}>
                      <i className="ri-play-circle-line" /> Iniciar Torneo
                    </button>
                  </>
                )}
                {torneoActivo.estado === 'activo' && (
                  <button className="btn btn-warning btn-xs" onClick={handleCompletarTorneo}>
                    <i className="ri-check-double-line" /> Finalizar Torneo
                  </button>
                )}
              </div>
            </div>

            {/* Tabs */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
              {[
                { id: 'ranking', label: 'Ranking ELO', icon: 'ri-bar-chart-line' },
                { id: 'partidas', label: 'Partidas y Resultados', icon: 'ri-sword-line' },
              ].map(tab => (
                <button key={tab.id} onClick={() => setVista(tab.id)} className={`btn btn-sm ${vista === tab.id ? 'btn-primary' : 'btn-secondary'}`}>
                  <i className={tab.icon} /> {tab.label}
                </button>
              ))}
            </div>

            {/* Ranking */}
            {vista === 'ranking' && (
              torneoActivo.ranking.length === 0 ? (
                <div className="card" style={{ textAlign: 'center', padding: 32 }}>
                  <i className="ri-group-line" style={{ fontSize: 36, color: 'var(--text-muted)', display: 'block', marginBottom: 8 }} />
                  <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>No hay jugadores registrados en este torneo.</p>
                </div>
              ) : (
                <div className="card" style={{ padding: 0 }}>
                  <div className="table-wrapper" style={{ border: 'none' }}>
                    <table>
                      <thead>
                        <tr>
                          <th>#</th>
                          <th>Jugador</th>
                          <th>PJ</th>
                          <th>PG</th>
                          <th>PP</th>
                          <th>Pts</th>
                          <th>ELO</th>
                        </tr>
                      </thead>
                      <tbody>
                        {torneoActivo.ranking.map(r => (
                          <tr key={r.nombre}>
                            <td>
                              <span style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 900, color: r.pos === 1 ? '#ffd700' : r.pos === 2 ? 'var(--silver)' : r.pos === 3 ? 'var(--bronze)' : 'var(--text-muted)' }}>
                                {r.pos === 1 ? '🥇' : r.pos === 2 ? '🥈' : r.pos === 3 ? '🥉' : r.pos}
                              </span>
                            </td>
                            <td style={{ fontWeight: 700 }}>{r.nombre}</td>
                            <td>{r.pj}</td>
                            <td style={{ color: 'var(--success)', fontWeight: 700 }}>{r.pg}</td>
                            <td style={{ color: 'var(--danger)' }}>{r.pp}</td>
                            <td style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 700, color: 'var(--bronze-light)' }}>{r.pts}</td>
                            <td>
                              <span style={{ background: 'var(--blue-glow)', color: 'var(--blue-light)', padding: '2px 8px', borderRadius: 6, fontSize: 11, fontWeight: 700, border: '1px solid rgba(37,99,235,0.3)' }}>
                                {r.elo}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )
            )}

            {/* Partidas */}
            {vista === 'partidas' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <h3 style={{ fontSize: 14, fontWeight: 700 }}>
                    {torneoActivo.estado === 'activo' ? `Partidas - Ronda ${torneoActivo.rondaActual || 1}` : 'Historial de Partidas'}
                  </h3>
                </div>

                {torneoActivo.partidas.length === 0 ? (
                  <div className="card" style={{ textAlign: 'center', padding: 32 }}>
                    <i className="ri-sword-line" style={{ fontSize: 36, color: 'var(--text-muted)', display: 'block', marginBottom: 8 }} />
                    <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>No hay partidas registradas aún</p>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {torneoActivo.partidas
                      .filter(p => torneoActivo.estado !== 'activo' || p.ronda === torneoActivo.rondaActual)
                      .map(p => {
                        const esActivo = p.estado === 'activo';
                        return (
                          <div key={p.id} className="card" style={{ display: 'flex', alignItems: 'center', gap: 16, padding: 16, border: esActivo ? '1px solid var(--border-bronze)' : '1px solid var(--border)' }}>
                            <div style={{ flex: 1, textAlign: 'right' }}>
                              <span style={{ fontWeight: p.ganador === p.j1 ? 800 : 500, color: p.ganador === p.j1 ? 'var(--success)' : 'var(--text-secondary)', fontSize: 14 }}>{p.j1}</span>
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 100 }}>
                              {p.resultado ? (
                                <div style={{ background: 'var(--bg-elevated)', borderRadius: 10, padding: '8px 16px', fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 700, letterSpacing: '0.1em', textAlign: 'center', border: '1px solid var(--border)' }}>
                                  {p.resultado}
                                </div>
                              ) : esActivo ? (
                                <button
                                  className="btn btn-primary btn-sm"
                                  style={{ padding: '6px 12px', fontSize: 11 }}
                                  onClick={() => {
                                    setPartidaAEditar(p);
                                    setPartidaJ1(p.j1);
                                    setPartidaJ2(p.j2);
                                    setScoreJ1('0');
                                    setScoreJ2('0');
                                    setShowRegistrarPartida(true);
                                  }}
                                >
                                  Cargar Marcador
                                </button>
                              ) : (
                                <span className="badge badge-warning" style={{ fontSize: 10 }}>Esperando Mesa</span>
                              )}
                              {p.mesaId && (
                                <span style={{ fontSize: 9, color: 'var(--bronze-light)', marginTop: 4 }}>
                                  Mesa {p.mesaId}
                                </span>
                              )}
                            </div>
                            <div style={{ flex: 1 }}>
                              <span style={{ fontWeight: p.ganador === p.j2 ? 800 : 500, color: p.ganador === p.j2 ? 'var(--success)' : 'var(--text-secondary)', fontSize: 14 }}>{p.j2}</span>
                            </div>
                          </div>
                        );
                      })}

                    {torneoActivo.estado === 'activo' && torneoActivo.partidas.some(p => p.ronda < torneoActivo.rondaActual) && (
                      <div style={{ marginTop: 20 }}>
                        <h4 style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8, textTransform: 'uppercase' }}>Partidas de Rondas Anteriores</h4>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                          {torneoActivo.partidas
                            .filter(p => p.ronda < torneoActivo.rondaActual)
                            .map(p => (
                              <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 12px', background: 'var(--bg-elevated)', borderRadius: 8, fontSize: 12, border: '1px solid var(--border)' }}>
                                <span>Ronda {p.ronda} · <strong>{p.j1}</strong> vs <strong>{p.j2}</strong></span>
                                <span style={{ color: 'var(--bronze-light)', fontWeight: 700 }}>Ganador: {p.ganador} ({p.resultado})</span>
                              </div>
                            ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="card" style={{ textAlign: 'center', padding: 40 }}>
            <p style={{ color: 'var(--text-muted)' }}>Cargando torneos...</p>
          </div>
        )}
      </div>

      {/* Modal Crear Torneo */}
      {showCrearTorneo && (
        <div className="modal-overlay" onClick={() => setShowCrearTorneo(false)}>
          <div className="modal" style={{ maxWidth: 500 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">Crear Nuevo Torneo</span>
              <button type="button" onClick={() => setShowCrearTorneo(false)} style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 20 }}>✕</button>
            </div>
            <form onSubmit={handleCrearTorneo}>
              <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div className="form-group">
                  <label className="form-label">Nombre del Torneo *</label>
                  <input className="form-input" required placeholder="Ej: Torneo Relámpago Junio" value={nuevoNombre} onChange={e => setNuevoNombre(e.target.value)} />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div className="form-group">
                    <label className="form-label">Modalidad</label>
                    <select className="form-select" value={nuevaModalidad} onChange={e => setNuevaModalidad(e.target.value)}>
                      <option value="Round Robin">Round Robin</option>
                      <option value="Eliminación Directa">Eliminación Directa</option>
                      <option value="Liga">Liga</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Cupo Máximo</label>
                    <input className="form-input" type="number" value={nuevoMax} onChange={e => setNuevoMax(e.target.value)} />
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div className="form-group">
                    <label className="form-label">Premio Total</label>
                    <input className="form-input" placeholder="Ej: $1,500" value={nuevoPremio} onChange={e => setNuevoPremio(e.target.value)} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Costo Inscripción</label>
                    <input className="form-input" placeholder="Ej: $100" value={nuevaInscripcion} onChange={e => setNuevaInscripcion(e.target.value)} />
                  </div>
                </div>
                <div className="form-group">
                  <label className="form-label">Fecha de Inicio *</label>
                  <input className="form-input" type="date" required value={nuevaFecha} onChange={e => setNuevaFecha(e.target.value)} />
                </div>

                <div className="form-group" style={{ borderTop: '1px solid var(--border)', paddingTop: 10 }}>
                  <label className="form-label" style={{ color: 'var(--bronze-light)' }}>Captura de Jugadores y Hándicaps</label>
                  <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                    <input
                      type="text"
                      className="form-input"
                      style={{ flex: 2 }}
                      placeholder="Nombre del jugador"
                      value={nombreTmpJugador}
                      onChange={e => setNombreTmpJugador(e.target.value)}
                    />
                    <input
                      type="number"
                      className="form-input"
                      style={{ flex: 1 }}
                      placeholder="Pts"
                      value={ptsTmpJugador}
                      onChange={e => setPtsTmpJugador(parseInt(e.target.value) || 0)}
                    />
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => {
                        if (!nombreTmpJugador.trim()) {
                          showToast('Ingrese un nombre válido', 'warning');
                          return;
                        }
                        if (listaNuevosJugadores.some(j => j.nombre.toLowerCase() === nombreTmpJugador.trim().toLowerCase())) {
                          showToast('El jugador ya está en la lista', 'warning');
                          return;
                        }
                        setListaNuevosJugadores([...listaNuevosJugadores, { nombre: nombreTmpJugador.trim(), puntosInicio: ptsTmpJugador }]);
                        setNombreTmpJugador('');
                        setPtsTmpJugador(0);
                      }}
                    >
                      Añadir
                    </button>
                  </div>

                  <div style={{ maxHeight: 100, overflowY: 'auto', background: 'var(--bg-elevated)', borderRadius: 8, padding: 8, border: '1px solid var(--border)' }}>
                    {listaNuevosJugadores.length === 0 ? (
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center' }}>No hay jugadores agregados.</div>
                    ) : (
                      listaNuevosJugadores.map((j, i) => (
                        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0', borderBottom: '1px solid rgba(255,255,255,0.03)', fontSize: 12 }}>
                          <span>{j.nombre} <span style={{ color: 'var(--bronze-light)' }}>({j.puntosInicio} pts inic.)</span></span>
                          <button
                            type="button"
                            style={{ background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer', fontSize: 14 }}
                            onClick={() => setListaNuevosJugadores(listaNuevosJugadores.filter((_, idx) => idx !== i))}
                          >
                            ✕
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                <div className="form-group" style={{ borderTop: '1px solid var(--border)', paddingTop: 10 }}>
                  <label className="form-label" style={{ color: 'var(--bronze-light)' }}>Seleccionar Mesas para el Torneo *</label>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, maxHeight: 100, overflowY: 'auto', background: 'var(--bg-elevated)', borderRadius: 8, padding: 8, border: '1px solid var(--border)' }}>
                    {mesas.map(m => (
                      <label key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={mesasSeleccionadas.includes(m.id)}
                          onChange={e => {
                            if (e.target.checked) {
                              setMesasSeleccionadas([...mesasSeleccionadas, m.id]);
                            } else {
                              setMesasSeleccionadas(mesasSeleccionadas.filter(id => id !== m.id));
                            }
                          }}
                          style={{ accentColor: 'var(--bronze)' }}
                        />
                        <span>{m.nombre} ({m.tipo})</span>
                      </label>
                    ))}
                  </div>
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setShowCrearTorneo(false)}>Cancelar</button>
                <button type="submit" className="btn btn-primary">Crear Torneo</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Registrar Jugador */}
      {showRegistrarJugador && (
        <div className="modal-overlay" onClick={() => setShowRegistrarJugador(false)}>
          <div className="modal" style={{ maxWidth: 400 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">Inscribir Jugador</span>
              <button type="button" onClick={() => setShowRegistrarJugador(false)} style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 20 }}>✕</button>
            </div>
            <form onSubmit={handleRegistrarJugador}>
              <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div className="form-group">
                  <label className="form-label">Nombre del Jugador</label>
                  <input className="form-input" required placeholder="Ej: Roberto Gomez" value={nuevoJugadorNombre} onChange={e => setNuevoJugadorNombre(e.target.value)} />
                </div>
                <div className="form-group">
                  <label className="form-label">Puntos Iniciales (Hándicap)</label>
                  <input className="form-input" type="number" min={0} value={nuevoJugadorPts} onChange={e => setNuevoJugadorPts(parseInt(e.target.value) || 0)} />
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setShowRegistrarJugador(false)}>Cancelar</button>
                <button type="submit" className="btn btn-primary">Inscribir</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Registrar Partida */}
      {showRegistrarPartida && (
        <div className="modal-overlay" onClick={() => setShowRegistrarPartida(false)}>
          <div className="modal" style={{ maxWidth: 450 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">{partidaAEditar ? 'Cargar Marcador' : 'Registrar Partida'}</span>
              <button type="button" onClick={() => setShowRegistrarPartida(false)} style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 20 }}>✕</button>
            </div>
            <form onSubmit={handleRegistrarPartida}>
              <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                {partidaAEditar ? (
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--bg-elevated)', borderRadius: 10, padding: 12, border: '1px solid var(--border)' }}>
                    <div style={{ textAlign: 'center', flex: 1 }}>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>JUGADOR 1</div>
                      <div style={{ fontSize: 14, fontWeight: 700 }}>{partidaJ1}</div>
                    </div>
                    <div style={{ fontSize: 14, fontWeight: 900, color: 'var(--bronze-light)' }}>VS</div>
                    <div style={{ textAlign: 'center', flex: 1 }}>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>JUGADOR 2</div>
                      <div style={{ fontSize: 14, fontWeight: 700 }}>{partidaJ2}</div>
                    </div>
                  </div>
                ) : (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                    <div className="form-group">
                      <label className="form-label">Jugador 1</label>
                      <select className="form-select" value={partidaJ1} onChange={e => setPartidaJ1(e.target.value)}>
                        <option value="">-- Seleccionar --</option>
                        {torneoActivo.ranking.map(r => (
                          <option key={r.nombre} value={r.nombre}>{r.nombre} (ELO: {r.elo})</option>
                        ))}
                      </select>
                    </div>
                    <div className="form-group">
                      <label className="form-label">Jugador 2</label>
                      <select className="form-select" value={partidaJ2} onChange={e => setPartidaJ2(e.target.value)}>
                        <option value="">-- Seleccionar --</option>
                        {torneoActivo.ranking.map(r => (
                          <option key={r.nombre} value={r.nombre}>{r.nombre} (ELO: {r.elo})</option>
                        ))}
                      </select>
                    </div>
                  </div>
                )}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                  <div className="form-group">
                    <label className="form-label">Marcador J1</label>
                    <input className="form-input" type="number" min={0} value={scoreJ1} onChange={e => setScoreJ1(e.target.value)} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Marcador J2</label>
                    <input className="form-input" type="number" min={0} value={scoreJ2} onChange={e => setScoreJ2(e.target.value)} />
                  </div>
                </div>
                <div className="form-group">
                  <label className="form-label">Tipo de Partida (Factor K ELO)</label>
                  <select className="form-select" value={tipoPartida} onChange={e => setTipoPartida(e.target.value)}>
                    <option value="amistoso">Amistoso (K = 16)</option>
                    <option value="regular">Regular / Liga (K = 32)</option>
                    <option value="final">Final / Torneo Principal (K = 48)</option>
                  </select>
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setShowRegistrarPartida(false)}>Cancelar</button>
                <button type="submit" className="btn btn-primary">Guardar Partida</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

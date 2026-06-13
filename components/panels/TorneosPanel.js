'use client';
import { useState, useEffect } from 'react';
import { obfuscate, deobfuscate } from '@/lib/crypto';
import { db } from '@/lib/firebase';
import { doc, setDoc, onSnapshot, serverTimestamp, collection, addDoc } from 'firebase/firestore';



const INIT_TORNEOS = [];

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

    // Escucha en tiempo real del Ranking Global
    const unsubRanking = onSnapshot(doc(db, 'config', 'ranking_historico'), snap => {
      if (snap.exists()) {
        const data = snap.data();
        if (data && data.rankings) {
          setRankingHistorico(data.rankings);
          try {
            localStorage.setItem('yoy_ranking_historico', obfuscate(data.rankings));
          } catch (e) {}
        }
      } else {
        const initialRank = { pool: [], carambola: [], snooker: [] };
        setRankingHistorico(initialRank);
        try {
          localStorage.setItem('yoy_ranking_historico', obfuscate(initialRank));
        } catch (e) {}
        setDoc(doc(db, 'config', 'ranking_historico'), { rankings: initialRank, updatedAt: serverTimestamp() });
      }
    }, err => {
      console.warn("Error al escuchar ranking_historico:", err);
      try {
        const savedRank = localStorage.getItem('yoy_ranking_historico');
        if (savedRank) setRankingHistorico(deobfuscate(savedRank) || { pool: [], carambola: [], snooker: [] });
      } catch (e) {}
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

    return () => {
      unsub();
      unsubRanking();
    };
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

  const handleEliminarTorneo = async (torneoId) => {
    if (!window.confirm('¿Estás seguro de que deseas eliminar este torneo? Esta acción no se puede deshacer.')) {
      return;
    }

    const updatedTorneos = torneos.filter(t => t.id !== torneoId);
    await saveTorneos(updatedTorneos);

    if (torneoActivo?.id === torneoId) {
      setTorneoActivo(updatedTorneos.length > 0 ? updatedTorneos[0] : null);
    }

    showToast('Torneo eliminado correctamente.', 'success');

    try {
      await addDoc(collection(db, 'bitacora'), {
        fecha: new Date().toISOString(),
        accion: 'Torneo Eliminado',
        detalle: `Se eliminó el torneo ID: ${torneoId}. El ranking global no fue afectado.`,
        monto: 0,
        operador: 'Operador YoY'
      });
    } catch (e) {
      console.error("Error al registrar eliminación en bitácora:", e);
    }
  };

  const handleCambiarCategoriaGlobal = async (jugadorNombre, nuevaCategoria, juegoTipo) => {
    const key = (juegoTipo || 'Pool').toLowerCase();
    
    // Load current rankings
    let rankingData = { pool: [], carambola: [], snooker: [] };
    const saved = localStorage.getItem('yoy_ranking_historico');
    if (saved) {
      try {
        rankingData = deobfuscate(saved) || { pool: [], carambola: [], snooker: [] };
      } catch (e) {}
    }

    if (!rankingData[key]) rankingData[key] = [];

    const idx = rankingData[key].findIndex(r => r.nombre.toLowerCase() === jugadorNombre.toLowerCase());
    if (idx !== -1) {
      rankingData[key][idx] = {
        ...rankingData[key][idx],
        categoria: nuevaCategoria,
        rachaV: 0,
        rachaD: 0
      };

      setRankingHistorico(rankingData);
      try {
        localStorage.setItem('yoy_ranking_historico', obfuscate(rankingData));
        await setDoc(doc(db, 'config', 'ranking_historico'), {
          rankings: rankingData,
          updatedAt: serverTimestamp()
        });
        showToast(`Categoría de ${jugadorNombre} actualizada a ${nuevaCategoria}.`, 'success');

        await addDoc(collection(db, 'bitacora'), {
          fecha: new Date().toISOString(),
          accion: 'Manual Category Update',
          detalle: `Categoría de ${jugadorNombre} cambiada a ${nuevaCategoria} por operador.`,
          monto: 0,
          operador: 'Operador YoY'
        });
      } catch (err) {
        console.error("Error al guardar ranking histórico:", err);
      }
    }
  };

  const inicializarJugadoresEnRankingGlobal = async (jugadores, juegoTipo) => {
    const key = (juegoTipo || 'Pool').toLowerCase();
    
    // Load current rankings
    let rankingData = { pool: [], carambola: [], snooker: [] };
    const saved = localStorage.getItem('yoy_ranking_historico');
    if (saved) {
      try {
        rankingData = deobfuscate(saved) || { pool: [], carambola: [], snooker: [] };
      } catch (e) {}
    }

    if (!rankingData[key]) rankingData[key] = [];

    let huboCambios = false;
    jugadores.forEach(j => {
      const exists = rankingData[key].some(r => r.nombre.toLowerCase() === j.nombre.toLowerCase());
      if (!exists) {
        rankingData[key].push({
          nombre: j.nombre,
          elo: 1500,
          pj: 0,
          pg: 0,
          pp: 0,
          categoria: j.categoria || '3ra',
          rachaV: 0,
          rachaD: 0
        });
        huboCambios = true;
      }
    });

    if (huboCambios) {
      rankingData[key].sort((a, b) => b.elo - a.elo);
      setRankingHistorico(rankingData);
      try {
        localStorage.setItem('yoy_ranking_historico', obfuscate(rankingData));
        await setDoc(doc(db, 'config', 'ranking_historico'), {
          rankings: rankingData,
          updatedAt: serverTimestamp()
        });
      } catch (err) {
        console.error("Error al inicializar jugadores en ranking global:", err);
      }
    }
  };

  const saveRankingHistorico = async (ganador, perdedor, juegoTipo) => {
    const key = (juegoTipo || 'Pool').toLowerCase();
    const CATEGORIES_ORDER = ['4ta', '3ra', '2da', '1ra', 'Mtro'];

    // Load current rankings
    let rankingData = { pool: [], carambola: [], snooker: [] };
    const saved = localStorage.getItem('yoy_ranking_historico');
    if (saved) {
      try {
        rankingData = deobfuscate(saved) || { pool: [], carambola: [], snooker: [] };
      } catch (e) {}
    }

    if (!rankingData[key]) rankingData[key] = [];

    // Find or create players
    let p1Index = rankingData[key].findIndex(r => r.nombre.toLowerCase() === ganador.toLowerCase());
    let p2Index = rankingData[key].findIndex(r => r.nombre.toLowerCase() === perdedor.toLowerCase());

    let p1 = p1Index !== -1 ? rankingData[key][p1Index] : { nombre: ganador, elo: 1500, pj: 0, pg: 0, pp: 0, categoria: '3ra', rachaV: 0, rachaD: 0 };
    let p2 = p2Index !== -1 ? rankingData[key][p2Index] : { nombre: perdedor, elo: 1500, pj: 0, pg: 0, pp: 0, categoria: '3ra', rachaV: 0, rachaD: 0 };

    // Update ELO
    const expected1 = 1 / (1 + Math.pow(10, (p2.elo - p1.elo) / 400));
    const expected2 = 1 / (1 + Math.pow(10, (p1.elo - p2.elo) / 400));
    const K = 32;

    p1.elo = Math.round(p1.elo + K * (1 - expected1));
    p2.elo = Math.round(p2.elo + K * (0 - expected2));

    p1.pj += 1;
    p1.pg += 1;
    p1.rachaV = (p1.rachaV || 0) + 1;
    p1.rachaD = 0;

    p2.pj += 1;
    p2.pp += 1;
    p2.rachaD = (p2.rachaD || 0) + 1;
    p2.rachaV = 0;

    // AI Motor auto-categorization
    let msgIA = '';
    const idx1 = CATEGORIES_ORDER.indexOf(p1.categoria || '3ra');
    const idx2 = CATEGORIES_ORDER.indexOf(p2.categoria || '3ra');
    if (idx1 < CATEGORIES_ORDER.length - 1) {
      if (p1.rachaV >= 4 || (idx2 - idx1 >= 1)) {
        p1.categoria = CATEGORIES_ORDER[idx1 + 1];
        p1.rachaV = 0; // reset
        msgIA = `🎉 IA Motor: ¡${p1.nombre} ha sido promovido a ${p1.categoria} debido a su gran rendimiento!`;
      }
    }

    if (idx2 > 0) {
      if (p2.rachaD >= 5) {
        p2.categoria = CATEGORIES_ORDER[idx2 - 1];
        p2.rachaD = 0; // reset
        msgIA = `📉 IA Motor: ${p2.nombre} ha bajado a categoría ${p2.categoria} tras rachas difíciles.`;
      }
    }

    if (p1Index !== -1) rankingData[key][p1Index] = p1;
    else rankingData[key].push(p1);

    if (p2Index !== -1) rankingData[key][p2Index] = p2;
    else rankingData[key].push(p2);

    // Sort by ELO
    rankingData[key].sort((a, b) => b.elo - a.elo);

    // Save
    setRankingHistorico(rankingData);
    try {
      localStorage.setItem('yoy_ranking_historico', obfuscate(rankingData));
      await setDoc(doc(db, 'config', 'ranking_historico'), {
        rankings: rankingData,
        updatedAt: serverTimestamp()
      });
      
      // Log to general bitacora
      await addDoc(collection(db, 'bitacora'), {
        fecha: new Date().toISOString(),
        accion: 'Ranking IA Update',
        detalle: `Actualización ELO: ${ganador} (${p1.elo}) vs ${perdedor} (${p2.elo}). ${msgIA}`,
        monto: 0,
        operador: 'Motor IA YoY'
      });
    } catch (err) {
      console.error("Error al guardar ranking histórico:", err);
    }

    if (msgIA) {
      showToast(msgIA, 'info');
    }
  };

  const imprimirTicketTorneo = (torneo) => {
    if (!torneo) return;
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      showToast("El navegador bloqueó la ventana emergente. Por favor, habilite los pop-ups para imprimir.", "danger");
      return;
    }
    
    // Filter matches for current round
    const roundPartidas = torneo.partidas.filter(p => p.ronda === torneo.rondaActual);
    
    let htmlContent = `
      <html><head><title>Bracket Torneo - ${torneo.nombre}</title>
      <style>
        body { margin: 0; padding: 10px; font-family: 'Courier New', Courier, monospace; background: #fff; color: #000; font-size: 13px; line-height: 1.4; max-width: 280px; }
        .text-center { text-align: center; }
        .divider { border-top: 1px dashed #000; margin: 10px 0; }
        .header { margin-bottom: 12px; }
        .header h3 { margin: 0; font-size: 15px; font-weight: bold; text-transform: uppercase; }
        .header p { margin: 2px 0; font-size: 11px; }
        .match-row { margin-bottom: 10px; font-size: 12px; }
        .match-number { font-weight: bold; text-decoration: underline; margin-bottom: 2px; }
        .footer { margin-top: 20px; font-size: 10px; text-align: center; color: #555; }
      </style>
      </head>
      <body>
        <div class="header text-center">
          <h3>YoY IA Billar Club</h3>
          <p>Control de Torneos</p>
          <p><strong>Torneo:</strong> ${torneo.nombre}</p>
          <p><strong>Ronda:</strong> ${torneo.rondaActual}</p>
          <p>Fecha: ${new Date().toLocaleString()}</p>
        </div>
        
        <div class="divider"></div>
        
        <div class="text-center" style="font-weight: bold; margin-bottom: 8px;">EMPAREJAMIENTOS DE LA RONDA</div>
        
        <div class="divider"></div>
    `;

    roundPartidas.forEach((p, idx) => {
      const p1 = torneo.ranking.find(r => r.nombre === p.j1);
      const p2 = torneo.ranking.find(r => r.nombre === p.j2);
      const handicap1 = p1 ? (p1.puntosInicio || 0) : 0;
      const handicap2 = p2 ? (p2.puntosInicio || 0) : 0;
      const cat1 = p1 ? (p1.categoria || '3ra') : '3ra';
      const cat2 = p2 ? (p2.categoria || '3ra') : '3ra';
      
      const p1Str = `${p.j1} (${cat1})` + (handicap1 > 0 ? ` (+${handicap1} pts)` : '');
      const p2Str = `${p.j2} (${cat2})` + (handicap2 > 0 ? ` (+${handicap2} pts)` : '');
      
      htmlContent += `
        <div class="match-row">
          <div class="match-number">Partido #${idx + 1}</div>
          <div style="padding-left: 10px;">
            ${p1Str}<br/>
            <span style="font-style: italic; color: #555;">vs</span><br/>
            ${p2Str}
          </div>
        </div>
        <div class="divider"></div>
      `;
    });

    htmlContent += `
        <div class="footer">
          <p>¡Que gane el mejor!</p>
          <p>YoY IA Billar By Alfonso Iturbide</p>
        </div>
        <script>
          window.onload = function() {
            window.print();
            setTimeout(function() { window.close(); }, 500);
          }
        </script>
      </body>
      </html>
    `;

    printWindow.document.write(htmlContent);
    printWindow.document.close();
  };

  const handleAsignarMesaManual = (partidaId, mesaId) => {
    if (!torneoActivo) return;

    // Load current tables from localStorage
    const savedMesas = localStorage.getItem('yoy_billar_mesas');
    let currentMesas = savedMesas ? (deobfuscate(savedMesas) || []) : [];

    const mesaIndex = currentMesas.findIndex(m => m.id === mesaId);
    if (mesaIndex === -1) {
      showToast('Mesa no encontrada', 'error');
      return;
    }

    const mesa = currentMesas[mesaIndex];
    if (mesa.estado !== 'libre') {
      showToast('La mesa seleccionada no está libre', 'warning');
      return;
    }

    const partidaIndex = torneoActivo.partidas.findIndex(p => p.id === partidaId);
    if (partidaIndex === -1) return;
    
    const partida = torneoActivo.partidas[partidaIndex];

    // Mark mesa as occupied
    currentMesas[mesaIndex] = {
      ...mesa,
      estado: 'ocupada',
      cliente: `Torneo: ${partida.j1} vs ${partida.j2}`,
      inicio: Date.now()
    };

    localStorage.setItem('yoy_billar_mesas', obfuscate(currentMesas));
    setMesas(currentMesas);

    // Update matches in torneo
    const updatedPartidas = torneoActivo.partidas.map(p => {
      if (p.id === partidaId) {
        return {
          ...p,
          mesaId: mesa.id,
          estado: 'activo'
        };
      }
      return p;
    });

    const updatedTorneos = torneos.map(t => {
      if (t.id === torneoActivo.id) {
        return {
          ...t,
          partidas: updatedPartidas
        };
      }
      return t;
    });

    saveTorneos(updatedTorneos);
    showToast(`Mesa ${mesa.nombre} asignada al partido.`, 'success');
  };

  const handleDefinirGanadorDirecto = (partidaId, ganadorName) => {
    if (!torneoActivo) return;

    const partidaIndex = torneoActivo.partidas.findIndex(p => p.id === partidaId);
    if (partidaIndex === -1) return;

    const partida = torneoActivo.partidas[partidaIndex];
    const score1 = ganadorName === partida.j1 ? 1 : 0;
    const score2 = ganadorName === partida.j2 ? 1 : 0;

    // Free table if one was assigned
    if (partida.mesaId) {
      const savedMesas = localStorage.getItem('yoy_billar_mesas');
      let currentMesas = savedMesas ? (deobfuscate(savedMesas) || []) : [];
      const mesaIdx = currentMesas.findIndex(m => m.id === partida.mesaId);
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

    // Update matches list
    let updatedPartidas = torneoActivo.partidas.map(p => {
      if (p.id === partidaId) {
        return {
          ...p,
          resultado: `${score1}-${score2}`,
          ganador: ganadorName,
          estado: 'completado'
        };
      }
      return p;
    });

    // Update player ranking/stats in the tournament
    const p1 = torneoActivo.ranking.find(r => r.nombre === partida.j1);
    const p2 = torneoActivo.ranking.find(r => r.nombre === partida.j2);

    const elo1 = p1 ? p1.elo : 1500;
    const elo2 = p2 ? p2.elo : 1500;

    const expected1 = 1 / (1 + Math.pow(10, (elo2 - elo1) / 400));
    const expected2 = 1 / (1 + Math.pow(10, (elo1 - elo2) / 400));

    const valOutcome1 = ganadorName === partida.j1 ? 1 : 0;
    const valOutcome2 = ganadorName === partida.j2 ? 1 : 0;

    const K = 32;
    const newElo1 = Math.round(elo1 + K * (valOutcome1 - expected1));
    const newElo2 = Math.round(elo2 + K * (valOutcome2 - expected2));

    const updatedRanking = torneoActivo.ranking.map(r => {
      if (r.nombre === partida.j1) {
        return {
          ...r,
          pj: r.pj + 1,
          pg: ganadorName === partida.j1 ? r.pg + 1 : r.pg,
          pp: ganadorName === partida.j2 ? r.pp + 1 : r.pp,
          pts: ganadorName === partida.j1 ? r.pts + 3 : r.pts,
          elo: newElo1
        };
      }
      if (r.nombre === partida.j2) {
        return {
          ...r,
          pj: r.pj + 1,
          pg: ganadorName === partida.j2 ? r.pg + 1 : r.pg,
          pp: ganadorName === partida.j1 ? r.pp + 1 : r.pp,
          pts: ganadorName === partida.j2 ? r.pts + 3 : r.pts,
          elo: newElo2
        };
      }
      return r;
    });

    updatedRanking.sort((a, b) => b.pts - a.pts || b.elo - a.elo);
    updatedRanking.forEach((r, idx) => { r.pos = idx + 1; });

    // Check if all games in current round are complete
    const partidasRondaActual = updatedPartidas.filter(p => p.ronda === torneoActivo.rondaActual);
    const todasCompletas = partidasRondaActual.every(p => p.estado === 'completado');

    let nextRondaNum = torneoActivo.rondaActual;
    let finalizado = false;
    let campeon = torneoActivo.campeon || null;

    if (todasCompletas) {
      const ganadores = partidasRondaActual.map(p => p.ganador).filter(g => g && g !== 'BYE');
      if (ganadores.length === 1) {
        finalizado = true;
        campeon = ganadores[0];
      } else if (ganadores.length > 1) {
        // Shuffle and pair winners randomly for the next round
        const ganadoresShuffled = [...ganadores].sort(() => 0.5 - Math.random());
        nextRondaNum = torneoActivo.rondaActual + 1;
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

    // Save ELO to global historical ELO rankings
    saveRankingHistorico(ganadorName, ganadorName === partida.j1 ? partida.j2 : partida.j1, torneoActivo.juegoTipo || 'Pool');

    if (finalizado) {
      showToast(`🏆 ¡El torneo ha finalizado! Campeón: ${campeon}`, 'success');
    } else if (nextRondaNum > torneoActivo.rondaActual) {
      showToast(`¡Ronda ${torneoActivo.rondaActual} concluida! Iniciando Ronda ${nextRondaNum}.`, 'success');
      // Auto print ticket for new round pairings!
      setTimeout(() => {
        const updatedTorneo = updatedTorneos.find(t => t.id === torneoActivo.id);
        if (updatedTorneo) imprimirTicketTorneo(updatedTorneo);
      }, 500);
    } else {
      showToast(`Ganador registrado: ${ganadorName}`, 'success');
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

    // Shuffling and pairing players immediately
    const shuffled = [...listaNuevosJugadores].sort(() => 0.5 - Math.random());
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
          estado: 'esperando_mesa' // Manual assignment
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

    const nuevo = {
      id: Date.now(),
      nombre: nuevoNombre,
      modalidad: nuevaModalidad,
      juegoTipo: nuevoJuegoTipo, // e.g. "Pool", "Carambola", "Snooker"
      estado: 'activo', // Start active immediately
      jugadores: listaNuevosJugadores.length,
      max: parseInt(nuevoMax) || 16,
      premio: nuevoPremio,
      inscripcion: nuevaInscripcion,
      fechaInicio: nuevaFecha,
      partidas: partidasRonda,
      mesasAsignadas: [],
      rondaActual: 1,
      ranking: listaNuevosJugadores.map((j, idx) => ({
        pos: idx + 1,
        nombre: j.nombre,
        puntosInicio: j.puntosInicio,
        categoria: j.categoria || '3ra',
        pj: 0,
        pg: 0,
        pp: 0,
        pts: j.puntosInicio,
        elo: 1500
      }))
    };

    const updated = [...torneos, nuevo];
    saveTorneos(updated);
    inicializarJugadoresEnRankingGlobal(listaNuevosJugadores, nuevoJuegoTipo);
    setTorneoActivo(nuevo);
    setShowCrearTorneo(false);
    
    // Auto print bracket pairings
    setTimeout(() => {
      imprimirTicketTorneo(nuevo);
    }, 500);

    showToast('Torneo creado e iniciado. Partidas generadas aleatoriamente.', 'success');

    // Reset fields
    setNuevoNombre('');
    setNuevaModalidad('Eliminación Directa');
    setNuevoMax('16');
    setNuevoPremio('$1,500');
    setNuevaInscripcion('$100');
    setNuevaFecha('');
    setListaNuevosJugadores([]);
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

  const renderRankingGlobal = () => {
    const players = rankingHistorico[modalityTab] || [];
    const top20Players = players.slice(0, 20);
    return (
      <div className="card" style={{ padding: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, flexWrap: 'wrap', gap: 10 }}>
          <div>
            <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 700, margin: 0 }}>Ranking Global ELO - Top 20</h2>
            <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '2px 0 0 0' }}>Los 20 mejores jugadores de pool, carambola o snooker</p>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            {[
              { id: 'pool', label: 'Pool' },
              { id: 'carambola', label: 'Carambola' },
              { id: 'snooker', label: 'Snooker' }
            ].map(tab => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setModalityTab(tab.id)}
                className={`btn btn-xs ${modalityTab === tab.id ? 'btn-primary' : 'btn-secondary'}`}
                style={{ padding: '4px 10px', fontSize: 11 }}
              >
                {tab.label.toUpperCase()}
              </button>
            ))}
          </div>
        </div>

        {top20Players.length === 0 ? (
          <div className="card" style={{ textAlign: 'center', padding: 40, borderStyle: 'dashed' }}>
            <i className="ri-medal-line" style={{ fontSize: 32, color: 'var(--text-muted)', display: 'block', marginBottom: 8 }} />
            <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: 0 }}>No hay jugadores registrados en el ranking de {modalityTab} aún.</p>
          </div>
        ) : (
          <div className="table-wrapper" style={{ border: 'none' }}>
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Jugador</th>
                  <th>Categoría</th>
                  <th>PJ</th>
                  <th>PG</th>
                  <th>PP</th>
                  <th>Racha</th>
                  <th>ELO</th>
                </tr>
              </thead>
              <tbody>
                {top20Players.map((r, idx) => (
                  <tr key={r.nombre}>
                    <td>
                      <span style={{ fontFamily: 'var(--font-display)', fontSize: 15, fontWeight: 900, color: idx === 0 ? '#ffd700' : idx === 1 ? 'var(--silver)' : idx === 2 ? 'var(--bronze)' : 'var(--text-muted)' }}>
                        {idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : idx + 1}
                      </span>
                    </td>
                    <td style={{ fontWeight: 700 }}>{r.nombre}</td>
                    <td>
                      <select
                        className="form-select"
                        style={{ width: '110px', padding: '2px 8px', fontSize: '12px', height: '28px', background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}
                        value={r.categoria || '3ra'}
                        onChange={(e) => handleCambiarCategoriaGlobal(r.nombre, e.target.value, modalityTab)}
                      >
                        <option value="Mtro">Mtro</option>
                        <option value="1ra">1ra</option>
                        <option value="2da">2da</option>
                        <option value="3ra">3ra</option>
                        <option value="4ta">4ta</option>
                      </select>
                    </td>
                    <td>{r.pj || 0}</td>
                    <td style={{ color: 'var(--success)', fontWeight: 700 }}>{r.pg || 0}</td>
                    <td style={{ color: 'var(--danger)' }}>{r.pp || 0}</td>
                    <td>
                      {r.rachaV > 0 && <span style={{ color: 'var(--success)', fontSize: 11, fontWeight: 600 }}>🔥 V{r.rachaV}</span>}
                      {r.rachaD > 0 && <span style={{ color: 'var(--danger)', fontSize: 11, fontWeight: 600 }}>❄️ D{r.rachaD}</span>}
                      {!(r.rachaV > 0) && !(r.rachaD > 0) && <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>-</span>}
                    </td>
                    <td>
                      <span style={{ background: 'var(--blue-glow)', color: 'var(--blue-light)', padding: '2px 8px', borderRadius: 6, fontSize: 11, fontWeight: 700, border: '1px solid rgba(37,99,235,0.3)' }}>
                        {r.elo || 1500}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title gradient-bronze">Torneos y Ligas</h1>
          <p className="page-subtitle">Gestión de brackets, ranking ELO y estadísticas de juego</p>
        </div>
        <button className="btn btn-primary btn-sm" onClick={() => setShowCrearTorneo(true)}>
          <i className="ri-add-line" /> Crear Torneo
        </button>
      </div>

      {/* Main Tab Selector */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 20, borderBottom: '1px solid var(--border)', paddingBottom: 10 }}>
        <button 
          className={`btn ${vistaPrincipal === 'torneos' ? 'btn-primary' : 'btn-secondary'}`}
          type="button"
          onClick={() => setVistaPrincipal('torneos')}
          style={{ display: 'flex', alignItems: 'center', gap: 6 }}
        >
          <i className="ri-trophy-line" /> Torneos Activos
        </button>
        <button 
          className={`btn ${vistaPrincipal === 'ranking_global' ? 'btn-primary' : 'btn-secondary'}`}
          type="button"
          onClick={() => setVistaPrincipal('ranking_global')}
          style={{ display: 'flex', alignItems: 'center', gap: 6 }}
        >
          <i className="ri-bar-chart-box-line" /> Ranking ELO Global (Top 20)
        </button>
      </div>

      {vistaPrincipal === 'torneos' && (

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
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <h3 style={{ fontSize: 14, fontWeight: 700, margin: 0 }}>
                    {torneoActivo.estado === 'activo' ? `Partidas - Ronda ${torneoActivo.rondaActual || 1}` : 'Historial de Partidas'}
                  </h3>
                  {torneoActivo.estado === 'activo' && (
                    <button 
                      type="button"
                      className="btn btn-secondary btn-xs"
                      onClick={() => imprimirTicketTorneo(torneoActivo)}
                      style={{ display: 'flex', alignItems: 'center', gap: 4 }}
                    >
                      <i className="ri-printer-line" /> Imprimir Bracket
                    </button>
                  )}
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
                          <div key={p.id} className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 16, border: esActivo ? '1px solid var(--border-bronze)' : '1px solid var(--border)' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
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
                              </div>
                              <div style={{ flex: 1 }}>
                                <span style={{ fontWeight: p.ganador === p.j2 ? 800 : 500, color: p.ganador === p.j2 ? 'var(--success)' : 'var(--text-secondary)', fontSize: 14 }}>{p.j2}</span>
                              </div>
                            </div>

                            {/* Acciones adicionales y estado de mesa si no se ha completado la partida */}
                            {!p.resultado && p.j2 !== 'BYE' && (
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, borderTop: '1px dashed var(--border)', paddingTop: 10, marginTop: 4 }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
                                  {/* Estado / Asignación de Mesa */}
                                  <div>
                                    {p.mesaId ? (
                                      <span style={{ fontSize: 11, color: 'var(--bronze-light)', fontWeight: 600 }}>
                                        📍 Jugando en Mesa {p.mesaId}
                                      </span>
                                    ) : (
                                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Asignar Mesa:</span>
                                        <select
                                          className="form-select"
                                          style={{ width: '120px', padding: '2px 6px', fontSize: 11, height: '26px', background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}
                                          defaultValue=""
                                          onChange={(e) => {
                                            if (e.target.value) {
                                              handleAsignarMesaManual(p.id, parseInt(e.target.value));
                                            }
                                          }}
                                        >
                                          <option value="">-- Seleccionar --</option>
                                          {mesas.filter(m => m.estado === 'libre').map(m => (
                                            <option key={m.id} value={m.id}>{m.nombre} ({m.tipo})</option>
                                          ))}
                                        </select>
                                      </div>
                                    )}
                                  </div>

                                  {/* Botón rápido de definir ganador directo */}
                                  <div style={{ display: 'flex', gap: 6 }}>
                                    <button
                                      type="button"
                                      className="btn btn-success btn-xs"
                                      style={{ padding: '4px 8px', fontSize: 10 }}
                                      onClick={() => handleDefinirGanadorDirecto(p.id, p.j1)}
                                    >
                                      🏆 Ganó {p.j1}
                                    </button>
                                    <button
                                      type="button"
                                      className="btn btn-success btn-xs"
                                      style={{ padding: '4px 8px', fontSize: 10 }}
                                      onClick={() => handleDefinirGanadorDirecto(p.id, p.j2)}
                                    >
                                      🏆 Ganó {p.j2}
                                    </button>
                                  </div>
                                </div>
                              </div>
                            )}
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
      )}

      {vistaPrincipal === 'ranking_global' && renderRankingGlobal()}

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
                    <label className="form-label">Formato</label>
                    <select className="form-select" value={nuevaModalidad} onChange={e => setNuevaModalidad(e.target.value)}>
                      <option value="Eliminación Directa">Eliminación Directa</option>
                      <option value="Round Robin">Round Robin</option>
                      <option value="Liga">Liga</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Tipo de Juego (Modalidad ELO)</label>
                    <select className="form-select" value={nuevoJuegoTipo} onChange={e => setNuevoJuegoTipo(e.target.value)}>
                      <option value="Pool">Pool</option>
                      <option value="Carambola">Carambola</option>
                      <option value="Snooker">Snooker</option>
                    </select>
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                  <div className="form-group">
                    <label className="form-label">Cupo Máximo</label>
                    <input className="form-input" type="number" value={nuevoMax} onChange={e => setNuevoMax(e.target.value)} />
                  </div>
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
                  <label className="form-label" style={{ color: 'var(--bronze-light)' }}>Captura de Jugadores, Hándicaps y Categoría</label>
                  <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexDirection: 'column' }}>
                    <div style={{ display: 'flex', gap: 6 }}>
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
                        style={{ width: 80 }}
                        placeholder="Adv Pts"
                        value={ptsTmpJugador || ''}
                        onChange={e => setPtsTmpJugador(parseInt(e.target.value) || 0)}
                      />
                    </div>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <select
                        className="form-select"
                        style={{ flex: 1 }}
                        value={categoriaTmpJugador}
                        onChange={e => setCategoriaTmpJugador(e.target.value)}
                      >
                        <option value="Mtro">Mtro (Maestro)</option>
                        <option value="1ra">1ra Categoría</option>
                        <option value="2da">2da Categoría</option>
                        <option value="3ra">3ra Categoría</option>
                        <option value="4ta">4ta Categoría</option>
                      </select>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        style={{ height: 38, padding: '0 16px' }}
                        onClick={() => {
                          if (!nombreTmpJugador.trim()) {
                            showToast('Ingrese un nombre válido', 'warning');
                            return;
                          }
                          if (listaNuevosJugadores.some(j => j.nombre.toLowerCase() === nombreTmpJugador.trim().toLowerCase())) {
                            showToast('El jugador ya está en la lista', 'warning');
                            return;
                          }
                          setListaNuevosJugadores([...listaNuevosJugadores, { 
                            nombre: nombreTmpJugador.trim(), 
                            puntosInicio: ptsTmpJugador, 
                            categoria: categoriaTmpJugador 
                          }]);
                          setNombreTmpJugador('');
                          setPtsTmpJugador(0);
                        }}
                      >
                        Añadir
                      </button>
                    </div>
                  </div>
 
                  <div style={{ maxHeight: 120, overflowY: 'auto', background: 'var(--bg-elevated)', borderRadius: 8, padding: 8, border: '1px solid var(--border)' }}>
                    {listaNuevosJugadores.length === 0 ? (
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center' }}>No hay jugadores agregados.</div>
                    ) : (
                      listaNuevosJugadores.map((j, i) => (
                        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0', borderBottom: '1px solid rgba(255,255,255,0.03)', fontSize: 12 }}>
                          <span>{j.nombre} <span style={{ color: 'var(--text-muted)' }}>({j.categoria})</span> <span style={{ color: 'var(--bronze-light)' }}>({j.puntosInicio} pts inic.)</span></span>
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

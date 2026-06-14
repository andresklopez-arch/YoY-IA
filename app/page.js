'use client';
import { useState, useEffect, Component } from 'react';
import Sidebar from '@/components/Sidebar';
import Topbar from '@/components/Topbar';
import ToastContainer from '@/components/ToastContainer';
import MesasPanel from '@/components/panels/MesasPanel';
import CajaPanel from '@/components/panels/CajaPanel';
import BarPanel from '@/components/panels/BarPanel';
import ClientesPanel from '@/components/panels/ClientesPanel';
import TorneosPanel from '@/components/panels/TorneosPanel';
import ReportesPanel from '@/components/panels/ReportesPanel';
import DashboardPanel from '@/components/panels/DashboardPanel';
import ConfigPanel from '@/components/panels/ConfigPanel';
import NominaPanel from '@/components/panels/NominaPanel';
import LoginScreen from '@/components/LoginScreen';
import { AuthProvider, useAuth } from '@/lib/auth-context';
import { collection, query, where, orderBy, limit, onSnapshot, doc, updateDoc, serverTimestamp, getDoc, addDoc, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase';

// ── ERROR BOUNDARY: captura crashes en paneles sin matar la app ──
class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  componentDidCatch(error, info) {
    console.error('[YoY ErrorBoundary] Panel crash:', error, info);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'var(--bg-base)', padding: 24
        }}>
          <div style={{
            background: 'var(--bg-elevated)', border: '1px solid rgba(239,68,68,0.3)',
            borderRadius: 16, padding: 32, maxWidth: 480, textAlign: 'center'
          }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>⚠️</div>
            <h2 style={{ fontSize: 18, fontWeight: 800, color: '#ef4444', marginBottom: 8 }}>Error en el panel</h2>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 20, lineHeight: 1.6 }}>
              Se produjo un error inesperado. Haz clic en Recargar para volver al sistema.
              Si el problema persiste, limpia el caché del navegador con <strong>Ctrl+Shift+R</strong>.
            </p>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', background: 'var(--bg-main)', padding: '8px 12px', borderRadius: 8, marginBottom: 20, textAlign: 'left', fontFamily: 'monospace', wordBreak: 'break-all' }}>
              {this.state.error?.message || 'Error desconocido'}
            </div>
            <button
              onClick={() => { this.setState({ hasError: false, error: null }); window.location.reload(); }}
              style={{
                background: 'linear-gradient(135deg, var(--bronze), var(--bronze-light))',
                color: '#fff', border: 'none', borderRadius: 10, padding: '10px 24px',
                fontWeight: 700, fontSize: 13, cursor: 'pointer'
              }}
            >
              🔄 Recargar Sistema
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function AppContent() {
  const { user, loading, loginWithEmpleadoId, logout } = useAuth();
  const [minLoadingDone, setMinLoadingDone] = useState(false);
  const [imageError, setImageError] = useState(false);
  const [activePanel, setActivePanel] = useState('mesas');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [toasts, setToasts] = useState([]);
  const [isProcessingQR, setIsProcessingQR] = useState(() => {
    if (typeof window !== 'undefined') {
      return !!new URLSearchParams(window.location.search).get('scanId');
    }
    return false;
  });

  const [fichajeSoporteExitoso, setFichajeSoporteExitoso] = useState(null);

  // Autocierre de confirmación de asistencia para personal de soporte
  useEffect(() => {
    if (fichajeSoporteExitoso) {
      const timer = setTimeout(() => {
        setFichajeSoporteExitoso(null);
      }, 10000);
      return () => clearTimeout(timer);
    }
  }, [fichajeSoporteExitoso]);

  // Medir y establecer el ancho de la barra de desplazamiento como una variable CSS
  useEffect(() => {
    const calculateScrollbarWidth = () => {
      const width = window.innerWidth - document.documentElement.clientWidth;
      document.documentElement.style.setProperty('--scrollbar-width', `${width}px`);
    };
    calculateScrollbarWidth();
    window.addEventListener('resize', calculateScrollbarWidth);
    return () => window.removeEventListener('resize', calculateScrollbarWidth);
  }, []);

  // Limpiar Service Workers obsoletos (previene "This page couldn't load" en Chrome PWA)
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistrations().then(regs => {
        regs.forEach(reg => reg.unregister());
      }).catch(() => {});
    }
  }, []);

  // Asegura que la animación de carga se muestre al menos durante 5 segundos
  useEffect(() => {
    const timer = setTimeout(() => {
      setMinLoadingDone(true);
    }, 5000);
    return () => clearTimeout(timer);
  }, []);

  // Alerta de captura de mesero (3 segundos)
  const [capturaAlert, setCapturaAlert] = useState(null); // { mesaId, total }
  
  // Alertas de asistencia pendientes para popup principal
  const [alertasAsistencia, setAlertasAsistencia] = useState([]);
  const [sonidoAdmin, setSonidoAdmin] = useState(true);

  // Redirigir si no tiene permisos para el panel activo
  useEffect(() => {
    if (isProcessingQR) return;
    if (user && user.permisos) {
      if (user.permisos[activePanel] !== true) {
        const primerPermitido = ['dashboard', 'mesas', 'caja', 'bar', 'clientes', 'torneos', 'nomina', 'reportes', 'config']
          .find(key => user.permisos[key] === true);
        if (primerPermitido) {
          setActivePanel(primerPermitido);
        }
      }
    }
  }, [user, activePanel, isProcessingQR]);

  // Auto-redireccionar si el usuario es mesero, cocina o bartender y accede al panel principal (Sugerencia 3)
  useEffect(() => {
    if (isProcessingQR) return;
    if (user) {
      const rolLower = (user.role || '').toLowerCase();
      if (rolLower.includes('mesero')) {
        window.location.href = '/mesero';
      } else if (
        rolLower.includes('cocina') ||
        rolLower.includes('bartender') ||
        rolLower.includes('barman') ||
        rolLower.includes('cocinero')
      ) {
        window.location.href = '/cocina';
      }
    }
  }, [user, isProcessingQR]);

  // Escuchar si se abre la app escaneando un código QR con ?scanId=xxx (Para iniciar sesión en el dispositivo del empleado)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const urlParams = new URLSearchParams(window.location.search);
    const scanId = urlParams.get('scanId');
    const token = urlParams.get('token'); // Sugerencia 2: Leer token temporal de la URL
    
    if (!scanId) {
      setIsProcessingQR(false);
      return;
    }

    // Sugerencia 1: Limpieza explícita inmediata de la sesión previa en localStorage, Firebase y Contexto
    logout().catch(() => {});

    // Limpiar el parámetro de la URL inmediatamente para evitar ejecuciones repetidas al recargar
    const newUrl = window.location.pathname;
    window.history.replaceState({}, document.title, newUrl);

    const procesarLoginQR = async () => {
      try {
        // 1. Obtener geolocalización para registrar coordenadas en la asistencia
        let geoData = { lat: null, lng: null, precision: null, status: 'No disponible' };
        if (typeof navigator !== 'undefined' && navigator.geolocation) {
          try {
            const getCoords = () => new Promise((resolve) => {
              navigator.geolocation.getCurrentPosition(
                (pos) => resolve({
                  lat: pos.coords.latitude,
                  lng: pos.coords.longitude,
                  precision: pos.coords.accuracy,
                  status: 'Obtenido'
                }),
                (err) => resolve({
                  lat: null,
                  lng: null,
                  precision: null,
                  status: `Error: ${err.message}`
                }),
                { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 }
              );
            });
            geoData = await getCoords();
          } catch (geoErr) {
            console.warn("Error obteniendo geolocalización:", geoErr);
          }
        }

        // Obtener el tipo de dispositivo que escanea
        const ua = navigator.userAgent;
        let dispositivo = 'PC/Terminal';
        if (/Mobi|Android|iPhone/i.test(ua)) dispositivo = 'Móvil';
        else if (/Tablet|iPad/i.test(ua)) dispositivo = 'Tablet';

        // 2. Llamar a la API del servidor para validar de forma segura
        const res = await fetch('/api/nomina/verify-attendance', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            empleadoId: scanId,
            token,
            expires: new URLSearchParams(window.location.search).get('expires') || Date.now(),
            coordenadas: geoData,
            dispositivo
          })
        });

        const data = await res.json();
        if (!res.ok || !data.success) {
          showToast(data.error || 'Error al procesar asistencia', 'error');
          setIsProcessingQR(false);
          return;
        }

        const { tipoRegistro, emp } = data;

        // 3. Determinar comportamiento según el rol (Mesero/Cocina loguea, Soporte solo ficha)
        const rolLower = (emp.rol || '').toLowerCase();
        const esMeseroOKitchen = rolLower.includes('mesero') ||
                                 rolLower.includes('cocina') ||
                                 rolLower.includes('bartender') ||
                                 rolLower.includes('barman') ||
                                 rolLower.includes('cocinero');

        if (esMeseroOKitchen) {
          // Loguear al empleado en el dispositivo escaneador
          await loginWithEmpleadoId(emp.id);
          showToast(`Sesión iniciada como ${emp.nombre} ✓`, 'success');

          // Redireccionar de inmediato a su área de trabajo
          if (rolLower.includes('mesero')) {
            window.location.href = '/mesero';
          } else {
            window.location.href = '/cocina';
          }
        } else {
          // Personal de soporte: no inician sesión. Mostrar pantalla visual de éxito
          setFichajeSoporteExitoso({
            nombre: `${emp.nombre} ${emp.apellido || ''}`.trim(),
            rol: emp.rol || 'Soporte',
            tipo: tipoRegistro
          });
          setIsProcessingQR(false);
          showToast(`Asistencia de ${emp.nombre} registrada ✅`, 'success');
        }
      } catch (err) {
        console.error(err);
        showToast('Error al iniciar sesión con QR: ' + err.message, 'error');
        setIsProcessingQR(false);
      }
    };

    procesarLoginQR();
  }, [loginWithEmpleadoId, logout]);

  // 1. Escuchar capturas de venta del mesero
  useEffect(() => {
    if (!user) return;
    const q = query(
      collection(db, 'mesa_pedidos'),
      where('origen', '==', 'mesero_captura')
    );
    const unsub = onSnapshot(q, snap => {
      if (snap.empty) return;
      const items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      items.sort((a, b) => {
        const tA = a.createdAt?.toDate ? a.createdAt.toDate().getTime() : (a.createdAt || 0);
        const tB = b.createdAt?.toDate ? b.createdAt.toDate().getTime() : (b.createdAt || 0);
        return tB - tA;
      });
      const dData = items[0];
      const creado = dData.createdAt?.toDate ? dData.createdAt.toDate().getTime() : Date.now();
      
      // Si fue creado en los últimos 10 segundos, disparar el popup de 3 segundos
      if (Date.now() - creado < 10000) {
        setCapturaAlert({ mesaId: dData.mesaId, total: dData.total });
        const timer = setTimeout(() => {
          setCapturaAlert(null);
        }, 3000);
        return () => clearTimeout(timer);
      }
    });
    return unsub;
  }, [user]);

  // 2. Escuchar asistencias pendientes para alerta emergente admin
  useEffect(() => {
    if (!user) return;
    const q = query(
      collection(db, 'mesa_pedidos'),
      where('tipo', 'in', ['asistencia', 'cuenta', 'pedido']),
      where('estado', 'in', ['pendiente', 'listo', 'en_camino', 'entregado'])
    );
    const unsub = onSnapshot(q, snap => {
      const items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      // Filtrar sólo las que no han sido atendidas por el administrador
      const filtered = items.filter(alerta => !alerta.atendidoAdmin);
      setAlertasAsistencia(filtered);
    });
    return unsub;
  }, [user]);

  // 3. Alarma sonora sutil para el administrador
  useEffect(() => {
    if (!user || !sonidoAdmin || alertasAsistencia.length === 0) return;
    
    const sonarChime = () => {
      try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain); gain.connect(ctx.destination);
        osc.frequency.value = 523.25; // C5
        gain.gain.value = 0.15;
        osc.start(); osc.stop(ctx.currentTime + 0.15);
        
        setTimeout(() => {
          const osc2 = ctx.createOscillator();
          const gain2 = ctx.createGain();
          osc2.connect(gain2); gain2.connect(ctx.destination);
          osc2.frequency.value = 659.25; // E5
          gain2.gain.value = 0.15;
          osc2.start(); osc2.stop(ctx.currentTime + 0.3);
        }, 150);

        if (typeof navigator !== 'undefined' && navigator.vibrate) {
          navigator.vibrate([150, 100, 150]); // Vibración rítmica
        }
      } catch { /* sin audio */ }
    };

    sonarChime();
    const t = setInterval(sonarChime, 5000);
    return () => clearInterval(t);
  }, [user, sonidoAdmin, alertasAsistencia.length]);

  const marcarAtendidoAdmin = async (id) => {
    try {
      const docRef = doc(db, 'mesa_pedidos', id);
      const snap = await getDoc(docRef);
      if (snap.exists()) {
        const data = snap.data();
        const updateData = {
          atendidoAdmin: true,
          updatedAt: serverTimestamp()
        };
        // Solo archivar si no es un pedido
        if (data.tipo !== 'pedido') {
          if (data.atendidoMesero === true || data.estado === 'entregado') {
            updateData.estado = 'atendido';
            updateData.atendidoAt = serverTimestamp();
          }
        }
        await updateDoc(docRef, updateData);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const imprimirOrdenCompraTFT = (ordenItems) => {
    if (!ordenItems || ordenItems.length === 0) return;

    const printWindow = window.open('', '_blank', 'width=600,height=600');
    if (!printWindow) {
      localStorage.setItem('yoy_popups_blocked_warning', 'true');
      showToast('Permita las ventanas emergentes para imprimir la orden de compra', 'warning');
      return;
    } else {
      localStorage.removeItem('yoy_popups_blocked_warning');
    }

    const dateStr = new Date().toLocaleDateString('es-MX', { year: 'numeric', month: '2-digit', day: '2-digit' });
    const timeStr = new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
    const totalCosto = ordenItems.reduce((s, o) => s + o.costoTotal, 0);
    const totalRetorno = ordenItems.reduce((s, o) => s + o.retornoPotencial, 0);
    const totalGanancia = ordenItems.reduce((s, o) => s + o.gananciaProyectada, 0);

    const itemsHtml = ordenItems.map(o => `
      <tr style="border-bottom: 1px dashed #000;">
        <td style="padding: 4px 0; font-size: 11px;"><b>${o.nombre}</b><br>Pedir: ${o.cantidadAPedir} ${o.unidad || 'pz'} (Stock: ${o.stock})</td>
        <td style="text-align: right; padding: 4px 0; font-size: 11px; vertical-align: bottom;">$${o.costoTotal}</td>
      </tr>
    `).join('');

    printWindow.document.write(`
      <html>
        <head>
          <title>Orden de Compra IA</title>
          <style>
            @page {
              size: 80mm auto;
              margin: 0;
            }
            body {
              font-family: 'Courier New', Courier, monospace;
              width: 72mm;
              margin: 0;
              padding: 10px;
              color: #000;
              background: #fff;
            }
            h3, p {
              margin: 4px 0;
              text-align: center;
            }
            .divider {
              border-top: 1px dashed #000;
              margin: 8px 0;
            }
            .totals table {
              width: 100%;
            }
            .totals td {
              font-size: 11px;
              padding: 2px 0;
            }
          </style>
        </head>
        <body>
          <h3>YOY IA BILLAR</h3>
          <p style="font-size: 10px; font-weight: bold;">ORDEN DE COMPRA SUGERIDA IA</p>
          <div class="divider"></div>
          <p style="font-size: 9px; text-align: left;">Fecha: ${dateStr} - Hora: ${timeStr}</p>
          <p style="font-size: 9px; text-align: left;">Origen: Generacion Automatica IA</p>
          <div class="divider"></div>
          
          <table style="width: 100%; border-collapse: collapse;">
            <thead>
              <tr style="border-bottom: 1px solid #000;">
                <th style="text-align: left; font-size: 10px; padding-bottom: 4px;">Producto</th>
                <th style="text-align: right; font-size: 10px; padding-bottom: 4px;">Costo</th>
              </tr>
            </thead>
            <tbody>
              ${itemsHtml}
            </tbody>
          </table>
          
          <div class="divider"></div>
          
          <div class="totals">
            <table>
              <tr>
                <td><b>COSTO ADQUISICION:</b></td>
                <td style="text-align: right;"><b>$${totalCosto} MXN</b></td>
              </tr>
              <tr>
                <td>RETORNO PROYECTADO:</td>
                <td style="text-align: right;">$${totalRetorno} MXN</td>
              </tr>
              <tr>
                <td>GANANCIA ESTIMADA:</td>
                <td style="text-align: right;">$${totalGanancia} MXN</td>
              </tr>
            </table>
          </div>
          
          <div class="divider"></div>
          <p style="font-size: 8px; text-align: center; margin-top: 15px;">
            Yoy IA Billar - Alfonso Iturbide<br>
            * TICKET DE REORDEN AUTOMATICO *
          </p>
          <br><br>
          <script>
            window.onload = function() {
              window.print();
              setTimeout(function() { window.close(); }, 500);
            };
          </script>
        </body>
      </html>
    `);
    printWindow.document.close();
  };

  // Autocheck y reorden diario automatico al iniciar sesion
  useEffect(() => {
    if (!user) return;

    // Solo permitir auto-impresion a roles autorizados que operan la consola y ticketera termica
    const rolesAutorizados = ['admin', 'cajero', 'gerente'];
    if (!rolesAutorizados.includes(user.role)) return;

    const hoy = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD
    const lastAutoPrint = localStorage.getItem('yoy_last_auto_print_purchase_order');

    if (lastAutoPrint !== hoy) {
      const docRef = doc(db, 'config', 'inventario');
      getDoc(docRef).then(snap => {
        if (snap.exists()) {
          const productos = snap.data().productos || [];
          const itemsReorden = [];
          
          productos.forEach(p => {
            if (p.stock <= p.stockMin && p.activoIA !== false) {
              const cantidadPedir = p.stockOptimo - p.stock;
              if (cantidadPedir > 0) {
                itemsReorden.push({
                  id: p.id,
                  nombre: p.nombre,
                  stock: p.stock,
                  min: p.stockMin,
                  optimo: p.stockOptimo,
                  cantidadAPedir: cantidadPedir,
                  costoUnitario: p.precioCosto,
                  costoTotal: cantidadPedir * p.precioCosto,
                  retornoPotencial: cantidadPedir * p.precioVenta,
                  gananciaProyectada: (cantidadPedir * p.precioVenta) - (cantidadPedir * p.precioCosto),
                  unidad: p.unidad || 'pz'
                });
              }
            }
          });

          if (itemsReorden.length > 0) {
            const totalCosto = itemsReorden.reduce((s, o) => s + o.costoTotal, 0);
            const totalRetorno = itemsReorden.reduce((s, o) => s + o.retornoPotencial, 0);
            const totalGanancia = itemsReorden.reduce((s, o) => s + o.gananciaProyectada, 0);

            const ultimaOrden = {
              fecha: hoy,
              items: itemsReorden,
              totalCosto,
              totalRetorno,
              totalGanancia,
              impresoAt: new Date().toISOString()
            };

            updateDoc(docRef, { ultimaOrdenDiaria: ultimaOrden })
              .then(() => {
                localStorage.setItem('yoy_last_auto_print_purchase_order', hoy);
                setTimeout(() => {
                  imprimirOrdenCompraTFT(itemsReorden);
                  showToast('Impresion de Orden de Compra IA diaria enviada ✓', 'success');
                }, 3000);
              })
              .catch(err => {
                console.error("Error al guardar ultimaOrdenDiaria en Firestore:", err);
                // Fallback: marcar localmente de todas formas para no ciclar
                localStorage.setItem('yoy_last_auto_print_purchase_order', hoy);
                setTimeout(() => {
                  imprimirOrdenCompraTFT(itemsReorden);
                }, 3000);
              });
          } else {
            // Guardar orden vacia en Firestore indicando que hoy se reviso pero no hubo faltantes
            updateDoc(docRef, { 
              ultimaOrdenDiaria: {
                fecha: hoy,
                items: [],
                totalCosto: 0,
                totalRetorno: 0,
                totalGanancia: 0,
                impresoAt: new Date().toISOString()
              }
            }).finally(() => {
              localStorage.setItem('yoy_last_auto_print_purchase_order', hoy);
            });
          }
        }
      }).catch(err => {
        console.warn("Auto-check de compra diario fallido:", err);
      });
    }
  }, [user]);

  const showToast = (message, type = 'info') => {
    const id = Date.now();
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4000);
  };

  if (loading || !minLoadingDone || isProcessingQR) {
    return (
      <div style={{ display:'flex', alignItems:'center', justifyContent:'center', minHeight:'100vh', background:'var(--bg-base)' }}>
        <div style={{ textAlign:'center', padding: '24px' }}>
          {!imageError ? (
            <img 
              src="/logo-largo.png" 
              alt="YoY IA Billar By Alfonso Iturbide" 
              fetchpriority="high"
              loading="eager"
              onError={() => setImageError(true)}
              className="animate-heartbeat"
              style={{ 
                width: 260, 
                height: 'auto', 
                objectFit: 'contain',
                margin: '0 auto 24px',
                display: 'block'
               }} 
            />
          ) : (
            <div className="animate-heartbeat" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', margin: '0 auto 24px' }}>
              <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="var(--bronze-light)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ filter: 'drop-shadow(0 0 8px var(--bronze-light))' }}>
                <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" fill="var(--bronze-subtle)" />
              </svg>
              <span style={{ color: 'var(--bronze-light)', fontSize: 14, fontWeight: 700, marginTop: 8, letterSpacing: '0.1em' }}>YoY IA Billar</span>
            </div>
          )}
          <p style={{ color:'var(--text-secondary)', fontSize: 10, letterSpacing:'0.2em', textTransform:'uppercase', fontWeight: 600 }}>
            {isProcessingQR ? 'Procesando código de acceso...' : 'Iniciando sistema...'}
          </p>
        </div>
        
        <style>{`
          @keyframes heartbeat {
            0% { transform: scale(1); }
            14% { transform: scale(1.12); }
            28% { transform: scale(1); }
            42% { transform: scale(1.2); }
            70% { transform: scale(1); }
          }
          .animate-heartbeat {
            animation: heartbeat 2.4s infinite ease-in-out;
            will-change: transform;
            filter: drop-shadow(0 0 15px rgba(205,127,50,0.25));
          }
        `}</style>
      </div>
    );
  }

  if (fichajeSoporteExitoso) {
    return (
      <div style={{
        minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'var(--bg-base)', padding: 24
      }}>
        <div style={{
          background: 'var(--bg-elevated)', border: '2px solid var(--bronze-light)',
          borderRadius: 20, padding: 40, maxWidth: 450, width: '100%', textAlign: 'center',
          boxShadow: '0 10px 40px rgba(0,0,0,0.5), var(--shadow-bronze)'
        }}>
          <div style={{ fontSize: 64, marginBottom: 20 }}>
            {fichajeSoporteExitoso.tipo === 'entrada' ? '🌅' : '🌙'}
          </div>
          <h2 style={{ fontSize: 22, fontWeight: 900, color: '#fff', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            {fichajeSoporteExitoso.tipo === 'entrada' ? 'Entrada Registrada' : 'Salida Registrada'}
          </h2>
          <p style={{ fontSize: 16, color: 'var(--bronze-light)', fontWeight: 700, marginBottom: 4 }}>
            {fichajeSoporteExitoso.nombre}
          </p>
          <p style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 24 }}>
            {fichajeSoporteExitoso.rol}
          </p>
          
          <div style={{
            background: 'var(--bg-card)', border: '1px solid var(--border)',
            borderRadius: 12, padding: '16px 20px', marginBottom: 32, fontSize: 13,
            color: 'var(--text-secondary)', lineHeight: 1.6
          }}>
            {fichajeSoporteExitoso.tipo === 'entrada' 
              ? '¡Tu hora de entrada ha sido guardada! Que tengas una excelente jornada laboral.' 
              : '¡Tu hora de salida ha sido guardada! Gracias por tu trabajo y que tengas un excelente descanso.'}
          </div>

          <button
            onClick={() => setFichajeSoporteExitoso(null)}
            style={{
              background: 'linear-gradient(135deg, var(--bronze), var(--bronze-light))',
              color: '#fff', border: 'none', borderRadius: 12, padding: '12px 32px',
              fontWeight: 800, fontSize: 13, cursor: 'pointer', width: '100%',
              textTransform: 'uppercase', letterSpacing: '0.05em', transition: 'transform 0.15s'
            }}
            onMouseEnter={e => { e.currentTarget.style.transform = 'scale(1.02)'; }}
            onMouseLeave={e => { e.currentTarget.style.transform = 'none'; }}
          >
            Aceptar
          </button>
        </div>
      </div>
    );
  }

  if (!user) return <LoginScreen showToast={showToast} />;

  const panels = {
    dashboard: <DashboardPanel showToast={showToast} onNavigate={setActivePanel} />,
    mesas:     <MesasPanel showToast={showToast} />,
    caja:      <CajaPanel showToast={showToast} />,
    bar:       <BarPanel showToast={showToast} />,
    clientes:  <ClientesPanel showToast={showToast} />,
    torneos:   <TorneosPanel showToast={showToast} />,
    nomina:    <NominaPanel showToast={showToast} />,
    reportes:  <ReportesPanel showToast={showToast} />,
    config:    <ConfigPanel showToast={showToast} />,
  };

  return (
    <div className="app-wrapper">
      {/* Sensor de hover invisible en el borde izquierdo */}
      <div 
        onMouseEnter={() => setSidebarOpen(true)}
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          bottom: 0,
          width: 12,
          zIndex: 1050,
          background: 'transparent',
          cursor: 'pointer'
        }}
      />

      <Sidebar
        activePanel={activePanel}
        onNavigate={(panel) => {
          setActivePanel(panel);
          setSidebarOpen(false);
        }}
        open={sidebarOpen}
        onMouseEnter={() => setSidebarOpen(true)}
        onMouseLeave={() => setSidebarOpen(false)}
        user={user}
      />
      <div className="main-content">
        <Topbar
          user={user}
          activePanel={activePanel}
          onToggleSidebar={() => setSidebarOpen(p => !p)}
          showToast={showToast}
          onNavigate={(panel) => {
            setActivePanel(panel);
            setSidebarOpen(false);
          }}
        />
        <div className="page-content">
          {user && user.permisos && user.permisos[activePanel] !== true ? (
            <div className="card" style={{ padding: 40, textAlign: 'center', border: '1px solid var(--border-bronze)', maxWidth: 500, margin: '40px auto' }}>
              <i className="ri-shield-keyhole-line" style={{ fontSize: 48, color: 'var(--bronze-light)', marginBottom: 16, display: 'block' }} />
              <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Acceso Restringido</h3>
              <p style={{ color: 'var(--text-secondary)', fontSize: 13 }}>No tienes los permisos requeridos para visualizar este panel. Consulta al administrador.</p>
            </div>
          ) : (
            panels[activePanel] || panels.dashboard
          )}
        </div>
      </div>
      <ToastContainer toasts={toasts} />

      {/* ── STYLE TAG FOR CUSTOM ANIMATIONS ── */}
      <style>{`
        @keyframes shrinkWidth {
          from { width: 100%; }
          to { width: 0%; }
        }
        @keyframes slideDownAlert {
          from { transform: translate(-50%, -40px); opacity: 0; }
          to { transform: translate(-50%, 0); opacity: 1; }
        }
        @keyframes scaleUpAlert {
          from { transform: scale(0.95); opacity: 0; }
          to { transform: scale(1); opacity: 1; }
        }
      `}</style>

      {/* ── ALERTA TEMPORAL 3 SEG: CAPTURA DE VENTA POR MESERO ── */}
      {capturaAlert && (
        <div style={{
          position: 'fixed', top: 24, left: '50%', transform: 'translateX(-50%)',
          background: 'linear-gradient(135deg, #1e1b18, #0f0d0c)',
          border: '2px solid var(--bronze-light)',
          boxShadow: '0 10px 30px rgba(205,127,50,0.3), var(--shadow-bronze)',
          borderRadius: 16, padding: '16px 24px', zIndex: 2000,
          display: 'flex', alignItems: 'center', gap: 14,
          animation: 'slideDownAlert 0.35s cubic-bezier(0.175, 0.885, 0.32, 1.275)'
        }}>
          <div style={{ fontSize: 24, background: 'var(--bronze-subtle)', width: 44, height: 44, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--bronze-light)' }}>
            🛍️
          </div>
          <div style={{ textAlign: 'left' }}>
            <div style={{ fontSize: 11, color: 'var(--bronze-light)', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.12em' }}>Venta Capturada Directa</div>
            <div style={{ fontSize: 15, fontWeight: 800, color: '#fff', marginTop: 2 }}>Mesa {capturaAlert.mesaId} · <span style={{ color: 'var(--success)' }}>${capturaAlert.total}</span></div>
          </div>
          
          {/* Barra de progreso de 3 segundos */}
          <div style={{
            position: 'absolute', bottom: 0, left: 0, height: 3, background: 'var(--bronze-light)',
            width: '100%', animation: 'shrinkWidth 3s linear forwards', borderBottomLeftRadius: 16, borderBottomRightRadius: 16
          }} />
        </div>
      )}

      {/* ── VENTANA EMERGENTE ADMIN: ALERTA DE SERVICIO PENDIENTE ── */}
      {alertasAsistencia.length > 0 && (
        <div className="modal-overlay" style={{ zIndex: 1999, background: 'rgba(13,13,15,0.8)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'fixed', top: 0, left: 0, right: 0, bottom: 0 }}>
          <div className="modal" style={{ maxWidth: 440, border: '2px solid var(--danger)', boxShadow: '0 0 30px rgba(239,68,68,0.25)', animation: 'scaleUpAlert 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)' }}>
            <div className="modal-header" style={{ borderBottom: '1px solid rgba(239,68,68,0.15)', paddingBottom: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span className="modal-title" style={{ color: 'var(--danger)', display: 'flex', alignItems: 'center', gap: 8, fontSize: 16, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                🚨 Alerta de Servicio (Cliente)
              </span>
              <span style={{ fontSize: 10, background: 'rgba(239,68,68,0.12)', color: 'var(--danger)', padding: '1px 6px', borderRadius: 999, fontWeight: 800 }}>
                {alertasAsistencia.length} PENDIENTE
              </span>
            </div>
            <div className="modal-body" style={{ maxHeight: 300, overflowY: 'auto', padding: '12px 0' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {alertasAsistencia.map((alerta) => (
                  <div key={alerta.id} style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: 12, padding: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ fontSize: 26 }}>{alerta.icono || '🙋'}</span>
                      <div style={{ textAlign: 'left' }}>
                        <div style={{ fontSize: 14, fontWeight: 800, color: '#fff' }}>Mesa {alerta.mesaId}</div>
                        <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
                          {alerta.etiqueta} {alerta.tipo === 'cuenta' && alerta.totalAcumulado ? `($${alerta.totalAcumulado} MXN)` : alerta.tipo === 'pedido' && alerta.total ? `($${alerta.total} MXN)` : ''}
                        </div>
                        <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}>{alerta.cliente}</div>
                      </div>
                    </div>
                    <button
                      onClick={() => marcarAtendidoAdmin(alerta.id)}
                      style={{
                        background: 'rgba(34,197,94,0.12)',
                        border: '1px solid rgba(34,197,94,0.3)',
                        color: 'var(--success)',
                        padding: '6px 12px',
                        borderRadius: 8,
                        fontWeight: 700,
                        fontSize: 12,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4,
                        transition: 'all 0.15s',
                        flexShrink: 0
                      }}
                      onMouseEnter={e => { e.currentTarget.style.background = 'rgba(34,197,94,0.2)'; }}
                      onMouseLeave={e => { e.currentTarget.style.background = 'rgba(34,197,94,0.12)'; }}
                    >
                      <i className="ri-check-line" /> Atendido
                    </button>
                  </div>
                ))}
              </div>
            </div>
            <div className="modal-footer" style={{ borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <button
                onClick={() => setSonidoAdmin(!sonidoAdmin)}
                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 11, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}
              >
                <i className={sonidoAdmin ? 'ri-volume-up-line' : 'ri-volume-mute-line'} />
                {sonidoAdmin ? 'Chime ON' : 'Silencio'}
              </button>
              <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>YoY IA Billar By Alfonso Iturbide</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function Home() {
  return (
    <AuthProvider>
      <ErrorBoundary>
        <AppContent />
      </ErrorBoundary>
    </AuthProvider>
  );
}

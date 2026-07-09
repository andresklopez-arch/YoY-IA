import { useState, useEffect, useCallback } from 'react';
import { doc, getDoc, setDoc, getActiveSalonId, collection, query, where, getDocs } from '@/lib/firestore-tenant';
import { db } from '@/lib/firebase';
import { obfuscate, deobfuscate } from '@/lib/crypto';

const obtenerFingerprint = () => {
  if (typeof window === 'undefined') return '';
  const ua = navigator.userAgent || '';
  const lang = navigator.language || '';
  const screenSpec = typeof screen !== 'undefined' ? `${screen.width}x${screen.height}_${screen.colorDepth}` : '';
  return `${ua}_${lang}_${screenSpec}`;
};

export function useLicenciaSaaS() {
  const [licencia, setLicencia] = useState(null);
  const [loading, setLoading] = useState(true);
  const [diasRestantes, setDiasRestantes] = useState(365);
  const [diasOffline, setDiasOffline] = useState(0);
  const [isBloqueada, setIsBloqueada] = useState(false);
  const [motivoBloqueo, setMotivoBloqueo] = useState('');
  const [isCheckingOnline, setIsCheckingOnline] = useState(false);

  const salonId = getActiveSalonId();

  const notificarTelegram = useCallback(async (msg, numLic) => {
    if (!salonId) return;
    // Evitar spammear en exceso usando un flag diario en localStorage
    const hoy = new Date().toLocaleDateString();
    const storageKey = `yoy_licencia_notif_${salonId}_${numLic}`;
    if (localStorage.getItem(storageKey) === hoy) return; 

    try {
      await fetch('/api/telegram/send-alert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: msg,
          salonId: salonId
        })
      });
      localStorage.setItem(storageKey, hoy);
      console.log("Notificación de licenciamiento enviada por Telegram.");
    } catch (e) {
      console.error("Error al enviar alerta de licenciamiento por Telegram:", e);
    }
  }, [salonId]);

  const procesarLicenciaData = useCallback((data, lastOnlineIso) => {
    if (!data) return;

    const ahora = new Date();
    const vencimiento = new Date(data.fechaVencimiento);
    const diffTime = vencimiento.getTime() - ahora.getTime();
    const rest = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    setDiasRestantes(rest);

    // Calcular días offline
    let offDays = 0;
    if (lastOnlineIso) {
      const lastOnlineDate = new Date(lastOnlineIso);
      const diffOffline = ahora.getTime() - lastOnlineDate.getTime();
      offDays = Math.max(0, Math.floor(diffOffline / (1000 * 60 * 60 * 24)));
      setDiasOffline(offDays);
    }

    // Evaluar bloqueos
    let bloqueada = false;
    let motivo = '';

    if (data.status === 'suspendida') {
      bloqueada = true;
      motivo = 'LICENCIA SUSPENDIDA: Tu suscripción de servicio ha sido suspendida. Por favor, contacta a soporte de ALR SaaS.';
      // Autodestrucción del caché local para evitar evasión offline
      if (typeof window !== 'undefined') {
        localStorage.removeItem('yoy_licencia_cache');
        localStorage.removeItem('yoy_licencia_last_online');
      }
    } else if (data.status === 'bloqueada') {
      bloqueada = true;
      motivo = 'SISTEMA BLOQUEADO: Este software ha sido bloqueado por el administrador del sistema a través de ALR SaaS.';
      // Autodestrucción del caché local para evitar evasión offline
      if (typeof window !== 'undefined') {
        localStorage.removeItem('yoy_licencia_cache');
        localStorage.removeItem('yoy_licencia_last_online');
      }
    } else if (rest <= 0) {
      bloqueada = true;
      motivo = 'LICENCIA VENCIDA: Tu período de licencia anual ha expirado. Por favor, realiza la renovación a través de ALR SaaS.';
    } else if (offDays >= 15) {
      bloqueada = true;
      motivo = 'SISTEMA BLOQUEADO POR SEGURIDAD: El sistema ha operado fuera de línea por más de 15 días consecutivos. Se requiere conexión a internet estable para re-sincronizar y validar la licencia con ALR SaaS.';
    }

    setIsBloqueada(bloqueada);
    setMotivoBloqueo(motivo);

    // ── Alertas Automáticas en Telegram (Sugerencia 1) ──
    if (rest <= 5 || offDays >= 10) {
      const msgText = `🚨 [ALR SaaS Alert]\n` +
                      `• Sucursal: ${salonId}\n` +
                      `• Licencia: ${data.numeroLicencia}\n` +
                      `• Estado: ${data.status}\n` +
                      `• Días Restantes: ${rest} días\n` +
                      `• Días Offline: ${offDays} días\n` +
                      `• Motivo: ${bloqueada ? 'SISTEMA BLOQUEADO' : 'Cercano al vencimiento / Fuera de línea'}`;
      notificarTelegram(msgText, data.numeroLicencia);
    }
  }, [salonId, notificarTelegram]);

  const refrescarLicencia = useCallback(async (forzarLoading = false) => {
    if (!salonId) {
      setLoading(false);
      return;
    }

    // ── Cifrado Anti-Manipulación de Reloj (Sugerencia 2) ──
    const ahora = new Date();
    const cachedLastTime = localStorage.getItem('yoy_licencia_last_time');
    if (cachedLastTime) {
      try {
        const lastTimeDec = deobfuscate(cachedLastTime);
        if (lastTimeDec) {
          const lastTimeDate = new Date(lastTimeDec);
          if (ahora.getTime() < lastTimeDate.getTime()) {
            // El usuario retrasó la hora de la computadora para intentar engañar la expiración
            setIsBloqueada(true);
            setMotivoBloqueo('ERROR DE INTEGRIDAD DETECTADO: Se detectó una manipulación o retraso no autorizado en el reloj de la computadora local. Por favor, restablezca la hora correcta en su sistema operativo y re-inicie la aplicación para re-habilitar el acceso.');
            setLoading(false);
            setIsCheckingOnline(false);
            return;
          }
        }
      } catch (e) {
        console.error("Error al validar integridad de reloj:", e);
      }
    }
    // Si la hora es válida y normal, persistimos la nueva marca de tiempo cifrada
    localStorage.setItem('yoy_licencia_last_time', obfuscate(ahora.toISOString()));

    if (forzarLoading) setLoading(true);
    setIsCheckingOnline(true);

    try {
      const docRef = doc(db, 'licencias_saas', salonId);
      const docSnap = await getDoc(docRef);

      let licenciaData = null;

      if (docSnap.exists()) {
        licenciaData = docSnap.data();
      } else {
        // Generar licencia inicial de 1 año para sistemas recién clonados o nuevos
        const randKey1 = Math.random().toString(36).substring(2, 6).toUpperCase();
        const randKey2 = Math.random().toString(36).substring(2, 6).toUpperCase();
        const numLic = `ALR-2026-${randKey1}-${randKey2}`;

        const ahoraIso = new Date().toISOString();
        const vencimientoIso = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(); // 1 año

        licenciaData = {
          numeroLicencia: numLic,
          fechaCreacion: ahoraIso,
          fechaVencimiento: vencimientoIso,
          status: 'activa',
          diasOfflineMaximo: 15,
          salonId: salonId,
          ultimaSincronizacion: ahoraIso,
          dispositivoFirma: obtenerFingerprint()
        };

        await setDoc(docRef, licenciaData);
      }

      // Validar si la licencia está duplicada en otro salón (antipiratería)
      const qDup = query(
        collection(db, 'licencias_saas'),
        where('numeroLicencia', '==', licenciaData.numeroLicencia)
      );
      const snapDup = await getDocs(qDup);
      let duplicada = false;
      snapDup.forEach(docSnap => {
        if (docSnap.id !== salonId) {
          duplicada = true;
        }
      });

      if (duplicada) {
        setIsBloqueada(true);
        setMotivoBloqueo('ERROR DE LICENCIA DUPLICADA: Se detectó que este número de licencia está siendo utilizado simultáneamente por otra sucursal activa. El acceso ha sido restringido por ALR SaaS por motivos de seguridad.');
        setLoading(false);
        setIsCheckingOnline(false);
        
        // Alerta urgente a Telegram
        const msgText = `🚨 [ALR SaaS PIRATERÍA DETECTADA]\n` +
                        `• Intento de clonación de licencia detectado.\n` +
                        `• Licencia: ${licenciaData.numeroLicencia}\n` +
                        `• Salón Intruso: ${salonId}\n` +
                        `• Estado: ACCESO BLOQUEADO`;
        notificarTelegram(msgText, licenciaData.numeroLicencia);
        return;
      }

      // Validar cambio de huella de dispositivo/navegador (Auditoría)
      const firmaActual = obtenerFingerprint();
      if (licenciaData.dispositivoFirma && licenciaData.dispositivoFirma !== firmaActual) {
        const msgText = `⚠️ [ALR SaaS AUDITORÍA DISPOSITIVO]\n` +
                        `• Cambio de dispositivo/navegador en "${salonId}".\n` +
                        `• Licencia: ${licenciaData.numeroLicencia}\n` +
                        `• Firma Original: ${licenciaData.dispositivoFirma.substring(0, 45)}...\n` +
                        `• Firma Actual: ${firmaActual.substring(0, 45)}...`;
        notificarTelegram(msgText, licenciaData.numeroLicencia);
      }

      const ahoraIso = new Date().toISOString();
      // Guardar en local encriptado
      localStorage.setItem('yoy_licencia_cache', obfuscate(JSON.stringify(licenciaData)));
      localStorage.setItem('yoy_licencia_last_online', obfuscate(ahoraIso));

      setLicencia(licenciaData);
      procesarLicenciaData(licenciaData, ahoraIso);
    } catch (error) {
      console.warn("Fallo validación en línea de licencia SaaS. Usando caché local:", error);
      
      // Cargar desde caché local encriptado
      const cached = localStorage.getItem('yoy_licencia_cache');
      const cachedOnline = localStorage.getItem('yoy_licencia_last_online');

      if (cached) {
        try {
          const dec = deobfuscate(cached);
          const decOnline = deobfuscate(cachedOnline);
          
          if (dec) {
            const data = JSON.parse(dec);
            setLicencia(data);
            procesarLicenciaData(data, decOnline);
          }
        } catch (e) {
          console.error("Error al desencriptar licencia caché:", e);
        }
      } else {
        // Si no hay caché y no hay internet, crear un estado de bloqueo preventivo por falta de registro
        setIsBloqueada(true);
        setMotivoBloqueo('ERROR DE REGISTRO: El sistema no cuenta con una firma de licencia local. Conéctese a internet para validar el sistema con ALR SaaS por primera vez.');
      }
    } finally {
      setLoading(false);
      setIsCheckingOnline(false);
    }
  }, [salonId, procesarLicenciaData, notificarTelegram]);

  useEffect(() => {
    refrescarLicencia();
  }, [refrescarLicencia]);

  return {
    licencia,
    loading,
    diasRestantes,
    diasOffline,
    isBloqueada,
    motivoBloqueo,
    isCheckingOnline,
    refrescarLicencia
  };
}

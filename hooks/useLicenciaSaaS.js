import { useState, useEffect, useCallback } from 'react';
import { doc, getDoc, setDoc, getActiveSalonId } from '@/lib/firestore-tenant';
import { db } from '@/lib/firebase';
import { obfuscate, deobfuscate } from '@/lib/crypto';

export function useLicenciaSaaS() {
  const [licencia, setLicencia] = useState(null);
  const [loading, setLoading] = useState(true);
  const [diasRestantes, setDiasRestantes] = useState(365);
  const [diasOffline, setDiasOffline] = useState(0);
  const [isBloqueada, setIsBloqueada] = useState(false);
  const [motivoBloqueo, setMotivoBloqueo] = useState('');
  const [isCheckingOnline, setIsCheckingOnline] = useState(false);

  const salonId = getActiveSalonId();

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
    } else if (data.status === 'bloqueada') {
      bloqueada = true;
      motivo = 'SISTEMA BLOQUEADO: Este software ha sido bloqueado por el administrador del sistema a través de ALR SaaS.';
    } else if (rest <= 0) {
      bloqueada = true;
      motivo = 'LICENCIA VENCIDA: Tu período de licencia anual ha expirado. Por favor, realiza la renovación a través de ALR SaaS.';
    } else if (offDays >= 15) {
      bloqueada = true;
      motivo = 'SISTEMA BLOQUEADO POR SEGURIDAD: El sistema ha operado fuera de línea por más de 15 días consecutivos. Se requiere conexión a internet estable para re-sincronizar y validar la licencia con ALR SaaS.';
    }

    setIsBloqueada(bloqueada);
    setMotivoBloqueo(motivo);
  }, []);

  const refrescarLicencia = useCallback(async (forzarLoading = false) => {
    if (!salonId) {
      setLoading(false);
      return;
    }

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
          ultimaSincronizacion: ahoraIso
        };

        await setDoc(docRef, licenciaData);
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
  }, [salonId, procesarLicenciaData]);

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

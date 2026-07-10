import { NextResponse } from 'next/server';
import { getApps, initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import fs from 'fs';
import path from 'path';

let isAdminConfigured = false;
try {
  if (!getApps().length) {
    let serviceAccount = null;
    const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT;
    const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'yoy-ia-billar';

    if (serviceAccountJson) {
      let cleanJson = serviceAccountJson.replace(/\r?\n/g, '').trim();
      if (!cleanJson.startsWith('{')) {
        cleanJson = '{' + cleanJson;
      }
      if (!cleanJson.endsWith('}')) {
        cleanJson = cleanJson + '}';
      }
      serviceAccount = JSON.parse(cleanJson);
    } else {
      const localKeyPath = path.join(process.cwd(), 'serviceAccountKey.json');
      if (fs.existsSync(localKeyPath)) {
        serviceAccount = JSON.parse(fs.readFileSync(localKeyPath, 'utf8'));
      }
    }

    if (serviceAccount) {
      initializeApp({
        credential: cert(serviceAccount),
        projectId
      });
      isAdminConfigured = true;
    } else {
      initializeApp({ projectId });
      isAdminConfigured = true;
    }
  } else {
    isAdminConfigured = true;
  }
} catch (e) {
  console.warn("Firebase Admin SDK no se pudo inicializar en cron-licencias:", e.message);
}

export async function GET(request) {
  try {
    if (!isAdminConfigured) {
      return NextResponse.json({ error: 'Firebase Admin SDK no configurado en el servidor' }, { status: 500 });
    }

    const { searchParams } = new URL(request.url);
    const key = searchParams.get('key');
    const expectedKey = process.env.CRON_SECRET || 'yoy_billar_cron_secure_key_12345';
    if (key !== expectedKey) {
      return NextResponse.json({ error: 'No autorizado. Clave cron inválida.' }, { status: 401 });
    }

    const db = getFirestore();
    const ahora = new Date();
    const ahoraIso = ahora.toISOString();

    // 1. Obtener todas las licencias de la colección saas_licencias
    const snap = await db.collection('saas_licencias').get();
    const results = {
      totalProcesadas: 0,
      expiradasNuevas: []
    };

    const batch = db.batch();
    let hasChanges = false;

    for (const docSnap of snap.docs) {
      const lic = docSnap.data();
      results.totalProcesadas++;

      if (lic.fechaVencimiento) {
        const vencimiento = new Date(lic.fechaVencimiento);
        // Si ya expiró y no está bloqueada
        if (vencimiento < ahora && !lic.bloqueada) {
          const docRef = db.collection('saas_licencias').doc(docSnap.id);
          batch.update(docRef, {
            bloqueada: true,
            active: false,
            motivoBloqueo: 'Licencia SaaS expirada',
            lastVerified: ahoraIso
          });

          // Registrar en logs de aprovisionamiento
          const provLogsRef = db.collection('provisioning_logs').doc();
          batch.set(provLogsRef, {
            salonId: lic.salonId,
            nombre: lic.salonId,
            embajador: 'Alfonso Iturbide',
            numeroLicencia: lic.numeroLicencia || '',
            fechaVencimiento: lic.fechaVencimiento,
            creadoPor: 'sistema-cron-licencias',
            fecha: ahoraIso,
            status: 'expirada'
          });

          // Enviar alerta a Telegram de la directiva (Sugerencia 2)
          try {
            const masterTgDoc = await db.collection('config').doc('telegram').get();
            if (masterTgDoc.exists) {
              const tgData = masterTgDoc.data();
              if (tgData.enabled && tgData.botToken && tgData.chatId) {
                const messageText = `⚠️ *[ALR SaaS] Licencia Expirada*\n\n` +
                                    `• *ID:* \`${lic.salonId}\`\n` +
                                    `• *Licencia:* \`${lic.numeroLicencia || 'N/A'}\`\n` +
                                    `• *Vencimiento:* ${lic.fechaVencimiento.split('T')[0]}\n` +
                                    `• *Estatus:* El salón ha sido bloqueado automáticamente.`;
                
                await fetch(`https://api.telegram.org/bot${tgData.botToken}/sendMessage`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    chat_id: tgData.chatId,
                    text: messageText,
                    parse_mode: 'Markdown'
                  })
                });
              }
            }
          } catch (tgErr) {
            console.warn("Fallo al enviar alerta de expiración a Telegram:", tgErr.message);
          }

          results.expiradasNuevas.push(lic.salonId);
          hasChanges = true;
        } else {
          // Si expira pronto (menos de 7 días, pero aún no expiró)
          const diasParaVencer = Math.ceil((vencimiento - ahora) / (1000 * 60 * 60 * 24));
          if (diasParaVencer > 0 && diasParaVencer <= 7 && !lic.bloqueada) {
            // Evitar spam diario: notificar solo a los 7, 3 y 1 días restantes
            if (diasParaVencer === 7 || diasParaVencer === 3 || diasParaVencer === 1) {
              try {
                const masterTgDoc = await db.collection('config').doc('telegram').get();
                if (masterTgDoc.exists) {
                  const tgData = masterTgDoc.data();
                  if (tgData.enabled && tgData.botToken && tgData.chatId) {
                    const messageText = `⏳ *[ALR SaaS] Licencia Próxima a Vencer*\n\n` +
                                        `• *ID:* \`${lic.salonId}\`\n` +
                                        `• *Licencia:* \`${lic.numeroLicencia || 'N/A'}\`\n` +
                                        `• *Vence en:* *${diasParaVencer} día(s)* (${lic.fechaVencimiento.split('T')[0]})\n` +
                                        `• *Acción:* Se recomienda renovar la licencia desde ALR SaaS para evitar la interrupción del servicio.`;
                    
                    await fetch(`https://api.telegram.org/bot${tgData.botToken}/sendMessage`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        chat_id: tgData.chatId,
                        text: messageText,
                        parse_mode: 'Markdown'
                      })
                    });
                  }
                }
              } catch (tgErr) {
                console.warn("Fallo al enviar alerta preventiva de expiración a Telegram:", tgErr.message);
              }
            }
          }
        }
      }
    }

    if (hasChanges) {
      await batch.commit();
    }

    return NextResponse.json({
      success: true,
      data: results
    });
  } catch (err) {
    console.error("Error en cron-licencias:", err);
    return NextResponse.json({ error: 'Error interno de servidor', detalle: err.message }, { status: 500 });
  }
}

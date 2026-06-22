import { db } from './firebase';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';

/**
 * Registra una acción administrativa crítica en el log de auditoría del sistema.
 * @param {Object} user - Objeto de usuario activo en sesión.
 * @param {string} accion - Identificador corto de la acción (ej. 'ticket_cancelar', 'inventario_merma').
 * @param {Object|string} detalles - Descripción u objeto con detalles del cambio.
 */
export const logAuditoria = async (user, accion, detalles) => {
  if (!user) return;
  try {
    const detailsStr = typeof detalles === 'object' ? JSON.stringify(detalles) : detalles;
    await addDoc(collection(db, 'auditoria_sistema'), {
      salonId: user.salonId || 'default_salon',
      usuarioId: user.uid || user.id || 'desconocido',
      nombreUsuario: user.name || user.nombre || user.email || 'Usuario',
      rol: user.role || user.rol || 'personal',
      accion,
      detalles: detailsStr,
      createdAt: serverTimestamp()
    });
  } catch (error) {
    console.error("Error al guardar log de auditoría:", error);
  }
};

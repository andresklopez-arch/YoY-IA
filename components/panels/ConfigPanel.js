'use client';
import { useState, useEffect } from 'react';
import { db } from '@/lib/firebase';
import { collection, getDocs, addDoc, query, orderBy, deleteDoc, doc, where } from 'firebase/firestore';

export default function ConfigPanel({ showToast }) {
  const [tarifas, setTarifas] = useState({
    carambola: 80,
    pool: 60,
    snooker: 100,
    surgeMulti: 1.25,
    horaPicoInicio: '18:00',
    horaPicoFin: '22:00',
  });

  const [sucursal, setSucursal] = useState({
    nombre: 'YoY Billar Sucursal 1',
    direccion: 'Av. Principal 123, CDMX',
    telefono: '55-1234-5678',
    horarioApertura: '10:00',
    horarioCierre: '02:00',
    capacidad: 8,
  });

  const [modoSurge, setModoSurge] = useState(true);
  const [notifStock, setNotifStock] = useState(true);
  const [notifOcupacion, setNotifOcupacion] = useState(true);

  // Estados de Gestión de Usuarios
  const [usuarios, setUsuarios] = useState([]);
  const [loadingUsuarios, setLoadingUsuarios] = useState(true);
  const [showAddUserModal, setShowAddUserModal] = useState(false);
  const [newUser, setNewUser] = useState({ name: '', email: '', password: '', role: 'mesero' });
  const [savingUser, setSavingUser] = useState(false);

  const fetchUsuarios = async () => {
    setLoadingUsuarios(true);
    try {
      const q = query(collection(db, 'users'), orderBy('createdAt', 'desc'));
      const snap = await getDocs(q);
      const list = [];
      snap.forEach(doc => {
        list.push({ id: doc.id, ...doc.data() });
      });
      setUsuarios(list);
    } catch (err) {
      console.error("Error cargando usuarios de Firestore:", err);
      setUsuarios([]);
    } finally {
      setLoadingUsuarios(false);
    }
  };

  useEffect(() => {
    fetchUsuarios();
  }, []);

  const handleAddUser = async (e) => {
    e.preventDefault();
    if (!newUser.name || !newUser.email || !newUser.password) {
      showToast('Por favor completa todos los campos', 'error');
      return;
    }

    let formattedEmail = newUser.email.trim().toLowerCase();
    if (!formattedEmail.includes('@')) {
      formattedEmail = `${formattedEmail}@yoybillar.mx`;
    }

    setSavingUser(true);
    try {
      // Validar si el usuario/correo ya existe en Firestore para evitar duplicidades
      const dupQuery = query(collection(db, 'users'), where('email', '==', formattedEmail));
      const dupSnap = await getDocs(dupQuery);

      if (!dupSnap.empty) {
        showToast('Este correo o usuario ya está registrado en la base de datos.', 'error');
        setSavingUser(false);
        return;
      }

      await addDoc(collection(db, 'users'), {
        name: newUser.name,
        email: formattedEmail,
        password: newUser.password,
        role: newUser.role,
        createdAt: new Date().toISOString()
      });
      showToast('¡Usuario creado! A partir de ahora el inicio de sesión es obligatorio.', 'success');
      setShowAddUserModal(false);
      setNewUser({ name: '', email: '', password: '', role: 'mesero' });
      fetchUsuarios();
    } catch (err) {
      console.error("Error creando usuario:", err);
      showToast('Error al guardar el usuario en Firestore', 'error');
    } finally {
      setSavingUser(false);
    }
  };

  const handleDeleteUser = async (userId, userName) => {
    if (!window.confirm(`¿Estás seguro de que deseas eliminar al usuario "${userName}"?`)) {
      return;
    }

    try {
      await deleteDoc(doc(db, 'users', userId));
      showToast(`Usuario "${userName}" eliminado correctamente`, 'success');
      fetchUsuarios();
    } catch (err) {
      console.error("Error al eliminar usuario:", err);
      showToast('Error al eliminar el usuario de Firestore', 'error');
    }
  };

  const guardar = (seccion) => {
    showToast(`Configuración de ${seccion} guardada ✓`, 'success');
  };

  const getRoleColor = (role) => {
    const colors = {
      admin: 'var(--bronze-light)',
      gerente: 'var(--silver)',
      cajero: 'var(--success)',
      mesero: 'var(--blue-light)',
    };
    return colors[role] || 'var(--text-muted)';
  };

  // Usuarios por defecto demostrativos
  const defaultDemos = [
    { name: 'Administrador', email: 'admin@yoybillar.mx', role: 'admin' },
    { name: 'Gerente Turno', email: 'gerente@yoybillar.mx', role: 'gerente' },
    { name: 'Cajero Principal', email: 'cajero@yoybillar.mx', role: 'cajero' },
    { name: 'Mesero #1', email: 'mesero@yoybillar.mx', role: 'mesero' },
  ];

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title gradient-bronze">Configuración</h1>
          <p className="page-subtitle">Ajustes del sistema, sucursal y tarifas</p>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
        {/* Sucursal */}
        <div className="card">
          <div className="card-header" style={{ marginBottom: 20 }}>
            <h3 className="card-title"><i className="ri-building-line" style={{ marginRight: 6 }} />Datos de Sucursal</h3>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {[
              { label: 'Nombre del Negocio', key: 'nombre' },
              { label: 'Dirección', key: 'direccion' },
              { label: 'Teléfono', key: 'telefono' },
            ].map(f => (
              <div key={f.key} className="form-group">
                <label className="form-label">{f.label}</label>
                <input className="form-input" value={sucursal[f.key]} onChange={e => setSucursal(p => ({ ...p, [f.key]: e.target.value }))} />
              </div>
            ))}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div className="form-group">
                <label className="form-label">Apertura</label>
                <input className="form-input" type="time" value={sucursal.horarioApertura} onChange={e => setSucursal(p => ({ ...p, horarioApertura: e.target.value }))} />
              </div>
              <div className="form-group">
                <label className="form-label">Cierre</label>
                <input className="form-input" type="time" value={sucursal.horarioCierre} onChange={e => setSucursal(p => ({ ...p, horarioCierre: e.target.value }))} />
              </div>
            </div>
            <button className="btn btn-primary" onClick={() => guardar('sucursal')}>
              <i className="ri-save-line" /> Guardar Sucursal
            </button>
          </div>
        </div>

        {/* Tarifas */}
        <div className="card">
          <div className="card-header" style={{ marginBottom: 20 }}>
            <h3 className="card-title"><i className="ri-price-tag-3-line" style={{ marginRight: 6 }} />Tarifas por Hora</h3>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {[
              { label: 'Carambola 3 Bandas ($/hr)', key: 'carambola' },
              { label: 'Pool 9 Bolas ($/hr)', key: 'pool' },
              { label: 'Snooker ($/hr)', key: 'snooker' },
            ].map(f => (
              <div key={f.key} className="form-group">
                <label className="form-label">{f.label}</label>
                <input className="form-input" type="number" value={tarifas[f.key]} onChange={e => setTarifas(p => ({ ...p, [f.key]: Number(e.target.value) }))} />
              </div>
            ))}
            <div className="divider" />
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0' }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700 }}>Surge Pricing (Precio Pico)</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Tarifa automática en horas de alta demanda</div>
              </div>
              <div
                onClick={() => setModoSurge(p => !p)}
                style={{
                  width: 44, height: 24, borderRadius: 12, cursor: 'pointer', transition: 'all 0.2s',
                  background: modoSurge ? 'var(--bronze)' : 'var(--bg-elevated)',
                  border: `1px solid ${modoSurge ? 'var(--bronze)' : 'var(--border)'}`,
                  position: 'relative',
                }}
              >
                <div style={{ width: 18, height: 18, borderRadius: '50%', background: '#fff', position: 'absolute', top: 2, left: modoSurge ? 22 : 2, transition: 'left 0.2s' }} />
              </div>
            </div>
            {modoSurge && (
              <div style={{ background: 'var(--bronze-subtle)', border: '1px solid var(--border-bronze)', borderRadius: 10, padding: 12 }}>
                <div className="form-group">
                  <label className="form-label">Multiplicador ({((tarifas.surgeMulti - 1) * 100).toFixed(0)}% extra)</label>
                  <input className="form-input" type="number" step="0.05" min="1" max="3" value={tarifas.surgeMulti} onChange={e => setTarifas(p => ({ ...p, surgeMulti: Number(e.target.value) }))} />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 10 }}>
                  <div className="form-group">
                    <label className="form-label">Hora Inicio Pico</label>
                    <input className="form-input" type="time" value={tarifas.horaPicoInicio} onChange={e => setTarifas(p => ({ ...p, horaPicoInicio: e.target.value }))} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Hora Fin Pico</label>
                    <input className="form-input" type="time" value={tarifas.horaPicoFin} onChange={e => setTarifas(p => ({ ...p, horaPicoFin: e.target.value }))} />
                  </div>
                </div>
              </div>
            )}
            <button className="btn btn-primary" onClick={() => guardar('tarifas')}>
              <i className="ri-save-line" /> Guardar Tarifas
            </button>
          </div>
        </div>

        {/* Alertas IA */}
        <div className="card">
          <div className="card-header" style={{ marginBottom: 20 }}>
            <h3 className="card-title"><i className="ri-robot-line" style={{ marginRight: 6 }} />Alertas IA</h3>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {[
              { label: 'Alerta de Stock Bajo', sub: 'Notificar cuando un producto esté bajo mínimo', state: notifStock, set: setNotifStock },
              { label: 'Alerta de Alta Ocupación', sub: 'Sugerir surge pricing al superar 70%', state: notifOcupacion, set: setNotifOcupacion },
            ].map((item, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0', borderBottom: i === 0 ? '1px solid var(--border)' : 'none' }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700 }}>{item.label}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{item.sub}</div>
                </div>
                <div
                  onClick={() => item.set(p => !p)}
                  style={{ width: 44, height: 24, borderRadius: 12, cursor: 'pointer', transition: 'all 0.2s', background: item.state ? 'var(--bronze)' : 'var(--bg-elevated)', border: `1px solid ${item.state ? 'var(--bronze)' : 'var(--border)'}`, position: 'relative' }}
                >
                  <div style={{ width: 18, height: 18, borderRadius: '50%', background: '#fff', position: 'absolute', top: 2, left: item.state ? 22 : 2, transition: 'left 0.2s' }} />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Roles del sistema */}
        <div className="card">
          <div className="card-header" style={{ marginBottom: 20 }}>
            <h3 className="card-title"><i className="ri-shield-user-line" style={{ marginRight: 6 }} />Usuarios y Roles</h3>
            <button className="btn btn-primary btn-sm" title="Agregar nuevo usuario" onClick={() => setShowAddUserModal(true)}>
              <i className="ri-user-add-line" />
            </button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {usuarios.length === 0 ? (
              <>
                <div style={{ background: 'var(--bronze-subtle)', border: '1px solid var(--border-bronze)', borderRadius: 10, padding: 12, marginBottom: 8 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--bronze-light)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    ⚠️ Modo Acceso Libre Activo
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}>
                    El sistema entra directo sin login. Crea tu primer usuario haciendo clic en el botón de arriba (+) para activar la seguridad del negocio.
                  </div>
                </div>
                {defaultDemos.map((u, i) => {
                  const color = getRoleColor(u.role);
                  return (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderBottom: i < 3 ? '1px solid var(--border)' : 'none', opacity: 0.65 }}>
                      <div style={{ width: 30, height: 30, borderRadius: 8, background: `${color}22`, border: `1px solid ${color}44`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 800, color }}>
                        {u.name[0]}
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 13, fontWeight: 700 }}>{u.name} <span style={{ fontSize: 9, color: 'var(--bronze)', fontWeight: 600 }}>(Demo)</span></div>
                        <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{u.email}</div>
                      </div>
                      <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: `${color}22`, color, border: `1px solid ${color}44`, textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                        {u.role}
                      </span>
                    </div>
                  );
                })}
              </>
            ) : (
              usuarios.map((u, i) => {
                const color = getRoleColor(u.role);
                return (
                  <div key={u.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderBottom: i < usuarios.length - 1 ? '1px solid var(--border)' : 'none' }}>
                    <div style={{ width: 30, height: 30, borderRadius: 8, background: `${color}22`, border: `1px solid ${color}44`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 800, color }}>
                      {u.name[0]}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 700 }}>{u.name}</div>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{u.email}</div>
                    </div>
                    <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: `${color}22`, color, border: `1px solid ${color}44`, textTransform: 'uppercase', letterSpacing: '0.1em', marginRight: 10 }}>
                      {u.role}
                    </span>
                    <button
                      onClick={() => handleDeleteUser(u.id, u.name)}
                      title="Eliminar usuario"
                      style={{
                        background: 'none', border: 'none', color: 'var(--text-muted)',
                        cursor: 'pointer', fontSize: 16, padding: '4px 8px',
                        transition: 'color 0.15s',
                      }}
                      onMouseEnter={e => e.currentTarget.style.color = '#ef4444'}
                      onMouseLeave={e => e.currentTarget.style.color = 'var(--text-muted)'}
                    >
                      <i className="ri-delete-bin-line" />
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* Modal de Crear Usuario */}
      {showAddUserModal && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
          backdropFilter: 'blur(5px)'
        }}>
          <div className="card" style={{ width: '100%', maxWidth: 450, padding: 32, border: '1px solid var(--border-bronze)', boxShadow: 'var(--shadow-bronze)', animation: 'fadeIn 0.25s ease' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
              <h3 style={{ fontSize: 16, fontWeight: 700, margin: 0, textTransform: 'uppercase', letterSpacing: '0.1em' }} className="gradient-bronze">
                <i className="ri-user-add-line" style={{ marginRight: 8 }} />Nuevo Usuario
              </h3>
              <button 
                onClick={() => setShowAddUserModal(false)}
                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 20 }}
              >
                <i className="ri-close-line" />
              </button>
            </div>
            
            <form onSubmit={handleAddUser} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div className="form-group">
                <label className="form-label">Nombre Completo</label>
                <input 
                  className="form-input" 
                  placeholder="Ej. Juan Pérez" 
                  value={newUser.name}
                  onChange={e => setNewUser(p => ({ ...p, name: e.target.value }))}
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label">Correo / Nombre de Usuario</label>
                <input 
                  className="form-input" 
                  placeholder="Ej. juan (se autocompleta a juan@yoybillar.mx)" 
                  value={newUser.email}
                  onChange={e => setNewUser(p => ({ ...p, email: e.target.value }))}
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label">Contraseña / PIN de Ingreso</label>
                <input 
                  className="form-input" 
                  type="password"
                  placeholder="••••••••" 
                  value={newUser.password}
                  onChange={e => setNewUser(p => ({ ...p, password: e.target.value }))}
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label">Rol y Permisos</label>
                <select 
                  className="form-input"
                  style={{ background: 'var(--bg-elevated)', color: 'var(--text-main)', border: '1px solid var(--border)' }}
                  value={newUser.role}
                  onChange={e => setNewUser(p => ({ ...p, role: e.target.value }))}
                >
                  <option value="admin">Administrador (Control total)</option>
                  <option value="gerente">Gerente (Gestión operativa)</option>
                  <option value="cajero">Cajero (Cobros y caja)</option>
                  <option value="mesero">Mesero (Toma de pedidos)</option>
                </select>
              </div>

              <div style={{ display: 'flex', gap: 12, marginTop: 12 }}>
                <button 
                  type="button" 
                  className="btn btn-secondary" 
                  style={{ flex: 1, background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}
                  onClick={() => setShowAddUserModal(false)}
                >
                  Cancelar
                </button>
                <button 
                  type="submit" 
                  className="btn btn-primary" 
                  style={{ flex: 1 }}
                  disabled={savingUser}
                >
                  {savingUser ? 'Guardando...' : 'Crear Usuario'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

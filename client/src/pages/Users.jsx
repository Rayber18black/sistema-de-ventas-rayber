import React, { useEffect, useState } from 'react'
import { api } from '../api.js'
import { useToast } from '../toast.jsx'
import { useAuth } from '../auth.jsx'
import { UserIcon, KeyIcon, PencilIcon, TrashIcon, CheckIcon } from '@heroicons/react/24/outline'

const PERMS = [
  ['dashboard.view', 'Ver dashboard'],
  ['products.view', 'Ver productos'],
  ['products.create', 'Crear productos'],
  ['products.edit', 'Editar productos'],
  ['products.delete', 'Eliminar productos'],
  ['categories.manage', 'Gestionar categorías'],
  ['stock.manage', 'Gestionar stock'],
  ['sales.do', 'Realizar ventas'],
  ['sales.view_all', 'Ver todas las ventas'],
  ['refund.do', 'Hacer devoluciones'],
  ['customers.manage', 'Gestionar clientes'],
  ['suppliers.manage', 'Gestionar proveedores'],
  ['purchases.do', 'Registrar compras'],
  ['cash.open', 'Abrir/cerrar caja'],
  ['cash.movements', 'Movimientos de caja'],
  ['users.manage', 'Gestionar usuarios'],
  ['roles.manage', 'Gestionar roles'],
  ['settings.manage', 'Configuración del sistema'],
  ['telegram.manage', 'Configuración de bots de Telegram'],
  ['reports.view', 'Ver reportes'],
  ['reports.export', 'Exportar reportes'],
  ['costs.view', 'Ver costos'],
  ['audit.view', 'Ver auditoría']
]

export default function Users() {
  const toast = useToast()
  const { user } = useAuth()
  const [users, setUsers] = useState([])
  const [roles, setRoles] = useState([])
  const [tab, setTab] = useState('usuarios')
  const [form, setForm] = useState(null)
  const [editing, setEditing] = useState(null)
  const [roleForm, setRoleForm] = useState(null)

  const load = () => { api('/users').then(setUsers).catch(() => {}); api('/roles').then(setRoles).catch(() => {}) }
  useEffect(load, [])

  async function saveUser() {
    if (!form.username || !form.password) return toast.error('Usuario y contraseña requeridos')
    try {
      if (editing) { const b = { ...form }; if (!b.password) delete b.password; await api(`/users/${editing.id}`, { method: 'PUT', body: b }) }
      else await api('/users', { method: 'POST', body: form })
      toast.success(editing ? 'Usuario actualizado' : 'Usuario creado'); setForm(null); load()
    } catch (e) { toast.error(e.message) }
  }

  async function saveRole() {
    if (!roleForm.name) return toast.error('Nombre requerido')
    try {
      if (roleForm.id) await api(`/roles/${roleForm.id}`, { method: 'PUT', body: roleForm })
      else await api('/roles', { method: 'POST', body: roleForm })
      toast.success('Rol guardado'); setRoleForm(null); load()
    } catch (e) { toast.error(e.message) }
  }

  function togglePerm(role, perm) {
    const has = role.permissions.includes(perm)
    setRoleForm({ ...role, permissions: has ? role.permissions.filter(p => p !== perm) : [...role.permissions, perm] })
  }

  return (
    <>
      <div className="page-head">
        <div><h1>Usuarios, roles y permisos</h1><div className="sub">El ROOT puede crear roles y asignar permisos</div></div>
        {user?.permissions?.includes('users.manage') && <button className="btn" onClick={() => { setEditing(null); setForm({ username: '', password: '', full_name: '', role_id: '', active: true }) }}>+ Nuevo usuario</button>}
      </div>

      <div className="flex mb12 wrap">
        <button className={`method-tab ${tab === 'usuarios' ? 'on' : ''}`} onClick={() => setTab('usuarios')}><UserIcon style={{ width: 16, height: 16 }} /> Usuarios</button>
        <button className={`method-tab ${tab === 'roles' ? 'on' : ''}`} onClick={() => setTab('roles')}><KeyIcon style={{ width: 16, height: 16 }} /> Roles y permisos</button>
      </div>

      {tab === 'usuarios' && (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Usuario</th><th>Nombre</th><th>Rol</th><th>Estado</th><th></th></tr></thead>
            <tbody>
              {users.map(u => (
                <tr key={u.id}>
                  <td><strong>{u.username}</strong></td>
                  <td>{u.full_name}</td>
                  <td><span className="muted">{u.role_name || 'Sin rol'}</span></td>
                  <td>{u.active ? <span className="badge success">Activo</span> : <span className="badge neutral">Inactivo</span>}</td>
                  <td>
                    <div className="flex">
                      <button className="btn secondary sm" onClick={() => { setEditing(u); setForm({ username: u.username, full_name: u.full_name, role_id: u.role_id ?? '', active: !!u.active, password: '' }) }}><PencilIcon style={{ width: 16, height: 16 }} /></button>
                      {u.username !== 'root' && <button className="btn danger sm" onClick={async () => { if (confirm(`Eliminar a ${u.username}?`)) { try { await api(`/users/${u.id}`, { method: 'DELETE' }); toast.success('Eliminado'); load() } catch (e) { toast.error(e.message) } } }}><TrashIcon style={{ width: 16, height: 16 }} /></button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'roles' && (
        <div className="grid g3">
          {roles.map(r => (
            <div className="card" key={r.id}>
              <div className="row-between"><h3>{r.name}</h3>
                {r.system ? <span className="badge info">Sistema</span> : <button className="btn secondary sm" onClick={() => setRoleForm({ ...r })}><PencilIcon style={{ width: 16, height: 16 }} /></button>}
              </div>
              <div className="muted">{r.permissions.length} permisos</div>
              <div className="badge neutral mt8">{r.permissions.length} de {PERMS.length}</div>
            </div>
          ))}
          {user?.permissions?.includes('roles.manage') && (
            <button className="card" style={{ borderStyle: 'dashed', justifyContent: 'center', display: 'flex', alignItems: 'center', color: 'var(--primary)', fontWeight: 700, borderColor: 'var(--primary)', cursor: 'pointer' }}
              onClick={() => setRoleForm({ name: '', permissions: [] })}>+ Nuevo rol</button>
          )}
        </div>
      )}

      {form && (
        <div className="modal-back" onClick={() => setForm(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2>{editing ? `Editar ${editing.username}` : 'Nuevo usuario'}</h2>
            <div className="field"><label>Usuario</label><input className="input" value={form.username} onChange={e => setForm({ ...form, username: e.target.value })} /></div>
            <div className="field"><label>Nombre completo</label><input className="input" value={form.full_name} onChange={e => setForm({ ...form, full_name: e.target.value })} /></div>
            <div className="field"><label>Rol</label>
              <select className="select" value={form.role_id} onChange={e => setForm({ ...form, role_id: e.target.value })}>
                <option value="">Sin rol</option>
                {roles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </div>
            <div className="field"><label>{editing ? 'Nueva contraseña (vacío = no cambiar)' : 'Contraseña'}</label><input className="input" type="password" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} /></div>
            <label className="flex"><input type="checkbox" checked={form.active} onChange={e => setForm({ ...form, active: e.target.checked })} /> Activo</label>
            <div className="modal-footer">
              <button className="btn" onClick={saveUser}><CheckIcon style={{ width: 16, height: 16 }} /> Guardar</button>
              <button className="btn secondary" onClick={() => setForm(null)}>Cancelar</button>
            </div>
          </div>
        </div>
      )}

      {roleForm && (
        <div className="modal-back" onClick={() => setRoleForm(null)}>
          <div className="modal" style={{ maxWidth: 620 }} onClick={e => e.stopPropagation()}>
            <h2>{roleForm.id ? 'Editar rol' : 'Nuevo rol'}</h2>
            <div className="field"><label>Nombre del rol</label><input className="input" value={roleForm.name} onChange={e => setRoleForm({ ...roleForm, name: e.target.value })} /></div>
            <label><strong>Permisos</strong></label>
            <div className="grid g2 mt8">
              {PERMS.map(([key, label]) => (
                <label key={key} className="flex" style={{ cursor: 'pointer' }}>
                  <input type="checkbox" checked={roleForm.permissions.includes(key)} onChange={() => togglePerm(roleForm, key)} /> {label}
                </label>
              ))}
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={saveRole}><CheckIcon style={{ width: 16, height: 16 }} /> Guardar</button>
              <button className="btn secondary" onClick={() => setRoleForm(null)}>Cancelar</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

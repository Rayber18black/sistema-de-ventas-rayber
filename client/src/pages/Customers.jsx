import React, { useEffect, useState } from 'react'
import { api } from '../api.js'
import { fmt, fmtDate } from '../fmt.js'
import { useToast } from '../toast.jsx'
import { branchId } from '../branch.js'
import { UsersIcon, TruckIcon, MagnifyingGlassIcon, BanknotesIcon, PencilIcon, TrashIcon, ArrowDownTrayIcon } from '@heroicons/react/24/outline'

const empty = { name: '', ci: '', rif: '', phone: '', email: '', address: '', credit_limit: 0 }

export default function Customers() {
  const toast = useToast()
  const [customers, setCustomers] = useState([])
  const [suppliers, setSuppliers] = useState([])
  const [search, setSearch] = useState('')
  const [tab, setTab] = useState('clientes')
  const [form, setForm] = useState(null)
  const [editing, setEditing] = useState(null)
  const [detail, setDetail] = useState(null)
  const [payModal, setPayModal] = useState(null)
  const [methods, setMethods] = useState([])

  const load = () => { api('/customers').then(setCustomers).catch(() => {}); api('/suppliers').then(setSuppliers).catch(() => {}) }
  useEffect(load, [])
  useEffect(() => { api('/settings/public').then(s => setMethods(s.paymentMethods || [])).catch(() => {}) }, [])

  const shown = customers.filter(c => !search.trim() || c.name.toLowerCase().includes(search.toLowerCase()) || c.phone?.includes(search) || c.ci?.includes(search) || c.rif?.includes(search))

  async function save() {
    if (!form.name) return toast.error('Nombre requerido')
    try {
      if (editing) await api(`/customers/${editing.id}`, { method: 'PUT', body: form })
      else await api('/customers', { method: 'POST', body: form })
      toast.success('Guardado'); setForm(null); load()
    } catch (e) { toast.error(e.message) }
  }

  function openDetail(c) { api(`/customers/${c.id}`).then(r => setDetail(r)).catch(() => {}) }

  async function doPay() {
    if (!payModal.amount || Number(payModal.amount) <= 0) return toast.error('Indica el monto')
    try {
      await api(`/customers/${payModal.customer.id}/pay`, {
        method: 'POST',
        body: { amount: Number(payModal.amount), method: payModal.method, note: payModal.note, branch_id: branchId() || undefined }
      })
      toast.success('Abono registrado'); setPayModal(null); load()
    } catch (e) { toast.error(e.message) }
  }

  return (
    <>
      <div className="page-head">
        <div><h1>Clientes y proveedores</h1><div className="sub">Fichas con crédito, saldo e historial</div></div>
        <button className="btn" onClick={() => { setEditing(null); setForm({ ...empty }) }}>+ Nuevo</button>
      </div>

      <div className="flex mb12 wrap">
        <button className={`method-tab ${tab === 'clientes' ? 'on' : ''}`} onClick={() => setTab('clientes')}><UsersIcon style={{ width: 16, height: 16 }} /> Clientes ({customers.length})</button>
        <button className={`method-tab ${tab === 'proveedores' ? 'on' : ''}`} onClick={() => setTab('proveedores')}><TruckIcon style={{ width: 16, height: 16 }} /> Proveedores ({suppliers.length})</button>
        <input className="input" style={{ maxWidth: 260, marginLeft: 'auto' }} placeholder="Buscar…" value={search} onChange={e => setSearch(e.target.value)} />
      </div>

      {tab === 'clientes' && (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Cliente</th><th>C.I. / RIF</th><th>Teléfono</th><th>Límite de crédito</th><th>Saldo</th><th></th></tr></thead>
            <tbody>
              {shown.map(c => (
                <tr key={c.id}>
                  <td><strong>{c.name}</strong></td>
                  <td className="muted">{c.ci || c.rif || '—'}</td>
                  <td className="muted">{c.phone}</td>
                  <td>{fmt(c.credit_limit)}</td>
                  <td><span className={c.balance > 0 ? 'badge warning' : 'badge success'}>{fmt(c.balance)}</span></td>
                  <td><div className="flex">
                    <button className="btn secondary sm" onClick={() => openDetail(c)}>Detalle</button>
                    <button className="btn sm" style={{ marginLeft: 4 }} disabled={!(c.balance > 0)} onClick={() => setPayModal({ customer: c, amount: '', method: 'efectivo', note: '' })}><BanknotesIcon style={{ width: 16, height: 16 }} /> Cobrar</button>
                    <button className="btn secondary sm" onClick={() => { setEditing(c); setForm({ name: c.name, phone: c.phone, ci: c.ci || '', rif: c.rif || '', email: c.email, address: c.address, credit_limit: c.credit_limit }) }}><PencilIcon style={{ width: 16, height: 16 }} /></button>
                  </div></td>
                </tr>
              ))}
            </tbody>
          </table>
          {shown.length === 0 && <div className="empty">Sin clientes</div>}
        </div>
      )}

      {tab === 'proveedores' && (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Proveedor</th><th>Contacto</th><th>Teléfono</th><th>Correo</th><th></th></tr></thead>
            <tbody>
              {suppliers.map(s => (
                <tr key={s.id}>
                  <td><strong>{s.name}</strong></td>
                  <td className="muted">{s.contact}</td>
                  <td>{s.phone}</td>
                  <td className="muted">{s.email}</td>
                  <td><button className="btn danger sm" onClick={async () => { if (confirm(`Eliminar ${s.name}?`)) { await api(`/suppliers/${s.id}`, { method: 'DELETE' }); load() } }}><TrashIcon style={{ width: 16, height: 16 }} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
          {suppliers.length === 0 && <div className="empty">Sin proveedores</div>}
          <div style={{ padding: 16 }}>
            <button className="btn secondary" onClick={() => { const name = prompt('Nombre del proveedor:'); if (name) api('/suppliers', { method: 'POST', body: { name } }).then(() => { toast.success('Agregado'); load() }).catch(e => toast.error(e.message)) }}>+ Agregar proveedor</button>
          </div>
        </div>
      )}

      {form && (
        <div className="modal-back" onClick={() => setForm(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2>{editing ? 'Editar cliente' : 'Nuevo cliente'}</h2>
            <div className="field"><label>Nombre *</label><input className="input" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></div>
            <div className="form-grid">
              <div className="field"><label>Cédula (C.I.)</label><input className="input" value={form.ci} onChange={e => setForm({ ...form, ci: e.target.value })} placeholder="V-12345678" /></div>
              <div className="field"><label>RIF (empresa)</label><input className="input" value={form.rif} onChange={e => setForm({ ...form, rif: e.target.value })} placeholder="J-12345678-9" /></div>
              <div className="field"><label>Teléfono</label><input className="input" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} /></div>
              <div className="field"><label>Correo</label><input className="input" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} /></div>
            </div>
            <div className="field"><label>Dirección</label><input className="input" value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} /></div>
            <div className="field"><label>Límite de crédito</label><input className="input" type="number" value={form.credit_limit} onChange={e => setForm({ ...form, credit_limit: e.target.value })} /></div>
            <div className="modal-footer">
              <button className="btn" onClick={save}><ArrowDownTrayIcon style={{ width: 16, height: 16 }} /> Guardar</button>
              <button className="btn secondary" onClick={() => setForm(null)}>Cancelar</button>
            </div>
          </div>
        </div>
      )}

      {detail && (
        <div className="modal-back" onClick={() => setDetail(null)}>
          <div className="modal" style={{ maxWidth: 620 }} onClick={e => e.stopPropagation()}>
            <div className="row-between">
              <h2>{detail.name}</h2>
              <button className="btn sm" disabled={!(detail.balance > 0)} onClick={() => setPayModal({ customer: detail, amount: '', method: 'efectivo', note: '' })}><BanknotesIcon style={{ width: 16, height: 16 }} /> Cobrar</button>
            </div>
            <div className="muted">{(detail.ci || detail.rif) && <>{detail.ci || detail.rif}</>} {detail.phone && <>· {detail.phone}</>} {detail.email && <>· {detail.email}</>}</div>
            <div className="flex mt8 wrap">
              <span className="badge info">Límite: {fmt(detail.credit_limit)}</span>
              <span className={`badge ${detail.balance > 0 ? 'warning' : 'success'}`}>Saldo: {fmt(detail.balance)}</span>
            </div>
            <h4 className="mt">Historial de ventas</h4>
            <table>
              <thead><tr><th>Folio</th><th>Fecha</th><th>Total</th><th>Estado</th></tr></thead>
              <tbody>
                {detail.sales.map(s => (
                  <tr key={s.id}>
                    <td><strong>{s.folio}</strong></td>
                    <td className="muted">{fmtDate(s.created_at)}</td>
                    <td>{fmt(s.total)}</td>
                    <td><span className="badge success">{s.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {detail.sales.length === 0 && <div className="empty">Sin compras registradas</div>}
            <h4 className="mt">Abonos recibidos</h4>
            <table>
              <thead><tr><th>Fecha</th><th>Método</th><th>Nota</th><th>Cobró</th><th>Monto</th></tr></thead>
              <tbody>
                {detail.payments.map(p => (
                  <tr key={p.id}>
                    <td className="muted">{fmtDate(p.created_at)}</td>
                    <td>{p.method}</td>
                    <td className="muted">{p.note || '—'}</td>
                    <td>{p.seller}</td>
                    <td><strong>-{fmt(p.amount)}</strong></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {detail.payments.length === 0 && <div className="empty">Sin abonos todavía</div>}
            <div className="modal-footer"><button className="btn secondary" onClick={() => setDetail(null)}>Cerrar</button></div>
          </div>
        </div>
      )}

      {payModal && (
        <div className="modal-back" onClick={() => setPayModal(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2><BanknotesIcon style={{ width: 16, height: 16 }} /> Cobrar a {payModal.customer.name}</h2>
            <div className="stat"><span className="label">Saldo actual</span><span className="value">{fmt(payModal.customer.balance)}</span></div>
            <div className="form-grid">
              <div className="field"><label>Monto del abono</label><input className="input" type="number" value={payModal.amount} onChange={e => setPayModal({ ...payModal, amount: e.target.value })} /></div>
              <div className="field"><label>Método</label>
                <select className="select" value={payModal.method} onChange={e => setPayModal({ ...payModal, method: e.target.value })}>
                  {methods.map(m => <option key={m.code} value={m.code}>{m.name}</option>)}
                </select>
              </div>
            </div>
            <div className="field"><label>Nota</label><input className="input" value={payModal.note} onChange={e => setPayModal({ ...payModal, note: e.target.value })} placeholder="Ej: abono parcial, saldo en efectivo…" /></div>
            <div className="modal-footer">
              <button className="btn" onClick={doPay}>Registrar abono</button>
              <button className="btn secondary" onClick={() => setPayModal(null)}>Cancelar</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

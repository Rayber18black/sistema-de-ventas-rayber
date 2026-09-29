import React, { useEffect, useState } from 'react'
import { api } from '../api.js'
import { fmt, fmtDate } from '../fmt.js'
import { useToast } from '../toast.jsx'
import { branchId } from '../branch.js'
import { TrashIcon } from '@heroicons/react/24/outline'

export default function Expenses() {
  const toast = useToast()
  const [data, setData] = useState({ items: [], total: 0 })
  const [cats, setCats] = useState([])
  const [branches, setBranches] = useState([])
  const [filter, setFilter] = useState({ from: '', to: '', type: '', branch_id: '' })
  const [form, setForm] = useState({ type: 'GASTO', amount: '', category: 'General', note: '' })

  const load = () => api('/expenses', { query: filter }).then(setData).catch(() => {})
  useEffect(() => {
    load()
    api('/settings').then(s => {
      try { setCats(String((s.finance || {}).expensesCategories || '').split(',').map(c => c.trim()).filter(Boolean)) } catch (e) {}
    }).catch(() => {})
    api('/branches').then(setBranches).catch(() => {})
  }, [])

  async function add() {
    if (!form.amount || Number(form.amount) <= 0) return toast.error('Indica el monto')
    try {
      await api('/expenses', { method: 'POST', body: { ...form, amount: Number(form.amount), branch_id: branchId() || undefined } })
      toast.success('Registrado'); setForm({ type: 'GASTO', amount: '', category: cats[0] || 'General', note: '' }); load()
    } catch (e) { toast.error(e.message) }
  }

  return (
    <>
      <div className="page-head"><div><h1>Gastos y caja chica</h1><div className="sub">Registra salidas de dinero y su categoría</div></div>
        <div className="stat"><span className="label">Total filtrado</span><span className="value small">{fmt(data.total)}</span></div>
      </div>

      <div className="grid g2">
        <div className="card">
          <h3>Registrar</h3>
          <div className="flex mb12">
            <button className={`method-tab ${form.type === 'GASTO' ? 'on' : ''}`} onClick={() => setForm({ ...form, type: 'GASTO' })}>Gasto</button>
            <button className={`method-tab ${form.type === 'CAJA_CHICA' ? 'on' : ''}`} onClick={() => setForm({ ...form, type: 'CAJA_CHICA' })}>Caja chica</button>
          </div>
          <div className="form-grid">
            <div className="field"><label>Monto</label><input className="input" type="number" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} /></div>
            <div className="field"><label>Categoría</label>
              <select className="select" value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}>
                {cats.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>
          <div className="field"><label>Nota</label><input className="input" placeholder="Ej: pago de luz del local" value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} /></div>
          <button className="btn" onClick={add}>Registrar {fmt(Number(form.amount) || 0)}</button>
        </div>

        <div className="card">
          <h3>Resumen</h3>
          <div className="stat"><span className="label">Total gastos hoy</span><span className="value">{fmt(data.total)}</span></div>
          <div className="flex mt12 wrap">
            <div className="field" style={{ margin: 0 }}><label>Desde</label><input className="input" type="date" value={filter.from} onChange={e => setFilter({ ...filter, from: e.target.value })} /></div>
            <div className="field" style={{ margin: 0 }}><label>Hasta</label><input className="input" type="date" value={filter.to} onChange={e => setFilter({ ...filter, to: e.target.value })} /></div>
            <div className="field" style={{ margin: 0 }}><label>Tipo</label>
              <select className="select" value={filter.type} onChange={e => setFilter({ ...filter, type: e.target.value })}>
                <option value="">Todos</option><option value="GASTO">Gastos</option><option value="CAJA_CHICA">Caja chica</option>
              </select>
            </div>
            <div className="field" style={{ margin: 0 }}><label>Sucursal</label>
              <select className="select" value={filter.branch_id} onChange={e => setFilter({ ...filter, branch_id: e.target.value })}>
                <option value="">Todas</option>
                {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
            <div className="field" style={{ margin: 0 }}><label>&nbsp;</label><button className="btn" onClick={load}>Filtrar</button></div>
          </div>
        </div>
      </div>

      <div className="table-wrap mt12">
        <table>
<thead><tr><th>Fecha</th><th>Tipo</th><th>Categoría</th><th>Nota</th><th>Sucursal</th><th>Registró</th><th>Monto</th><th></th></tr></thead>
            <tbody>
              {data.items.map(e => (
                <tr key={e.id}>
                  <td className="muted">{fmtDate(e.created_at)}</td>
                  <td><span className={`badge ${e.type === 'CAJA_CHICA' ? 'info' : 'warning'}`}>{e.type === 'CAJA_CHICA' ? 'Caja chica' : 'Gasto'}</span></td>
                  <td>{e.category}</td>
                  <td className="muted">{e.note || '—'}</td>
                  <td className="muted">{e.branch_name || '—'}</td>
                  <td>{e.seller}</td>
                <td><strong>-{fmt(e.amount)}</strong></td>
                <td><button className="btn danger sm" onClick={async () => { if (confirm('Eliminar este registro?')) { await api(`/expenses/${e.id}`, { method: 'DELETE' }); toast.success('Eliminado'); load() } }}><TrashIcon style={{ width: 16, height: 16 }} /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
        {data.items.length === 0 && <div className="empty">Sin registros</div>}
      </div>
    </>
  )
}

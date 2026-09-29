import React, { useEffect, useState } from 'react'
import { api } from '../api.js'
import { fmt, fmtDate } from '../fmt.js'
import { useToast } from '../toast.jsx'
import { useAuth } from '../auth.jsx'
import { branchId } from '../branch.js'
import { TruckIcon, CubeIcon, XMarkIcon, CheckIcon } from '@heroicons/react/24/outline'

export default function Purchases() {
  const { user } = useAuth()
  const toast = useToast()
  const [tab, setTab] = useState('ordenes')
  const [list, setList] = useState([])
  const [replenish, setReplenish] = useState([])
  const [form, setForm] = useState(null)
  const [suppliers, setSuppliers] = useState([])
  const [products, setProducts] = useState([])
  const [detail, setDetail] = useState(null)

  const loadOrders = () => api('/purchase-orders').then(setList).catch(() => {})
  const loadRep = () => api('/replenish').then(setReplenish).catch(() => setReplenish([]))
  useEffect(() => { loadOrders(); loadRep() }, [])

  async function openForm(itemsHint) {
    const [s, p] = await Promise.all([
      api('/suppliers').catch(() => []),
      api('/products').catch(() => [])
    ])
    setSuppliers(s); setProducts(p)
    setForm({
      supplier_id: '', expected_date: '', note: '',
      items: itemsHint || []
    })
  }
  function addFromSuggestion() {
    const hint = replenish
      .filter(r => (form.items.find(i => i.product_id === r.id) ? 0 : 1))
      .map(r => ({ product_id: r.id, name: r.name, qty: r.suggested_qty, cost: r.cost }))
    if (!hint.length) return toast.error('El pedido ya incluye todos los sugeridos')
    setForm(f => ({ ...f, items: [...f.items, ...hint] }))
  }

  async function create() {
    if (!form.items.length) return toast.error('Agrega productos')
    try {
      await api('/purchase-orders', { method: 'POST', body: { ...form, supplier_id: form.supplier_id ? Number(form.supplier_id) : null, branch_id: branchId() || undefined } })
      toast.success('Orden creada'); setForm(null); loadOrders(); loadRep()
    } catch (e) { toast.error(e.message) }
  }
  const totalItems = (form?.items || []).reduce((a, i) => a + i.cost * i.qty, 0)

  return (
    <>
      <div className="page-head">
        <div><h1>Compras</h1><div className="sub">Sugerencia de reabastecimiento y órdenes de compra</div></div>
        <div className="tabs">
          <button className={`btn${tab === 'ordenes' ? ' active' : ' secondary'}`} onClick={() => setTab('ordenes')}><TruckIcon style={{ width: 16, height: 16 }} /> Órdenes</button>
          <button className={`btn${tab === 'sugerencia' ? ' active' : ' secondary'}`} onClick={() => setTab('sugerencia')}><CubeIcon style={{ width: 16, height: 16 }} /> Sugerencia</button>
        </div>
      </div>

      {tab === 'ordenes' && (
        <>
          <div className="flex mb12">
            <button className="btn" onClick={() => openForm([])}>+ Nueva orden de compra</button>
          </div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Código</th><th>Fecha</th><th>Proveedor</th><th>Sucursal</th><th>Productos</th><th>Total</th><th>Estado</th><th></th></tr></thead>
              <tbody>
                {list.map(o => (
                  <tr key={o.id}>
                    <td><strong>{o.code}</strong></td>
                    <td className="muted">{fmtDate(o.created_at)}</td>
                    <td>{o.supplier_name || '—'}</td>
                    <td className="muted">{o.branch_name || '—'}</td>
                    <td>{o.status === 'RECIBIDA' ? <span className="muted">{o.received_at}</span> : <button className="btn secondary sm" onClick={async () => { try { setDetail(await api(`/purchase-orders/${o.id}`)) } catch (e) { toast.error(e.message) } }}>Ver</button>}</td>
                    <td><strong>{fmt(o.total)}</strong></td>
                    <td><span className={`badge ${o.status === 'RECIBIDA' ? 'success' : o.status === 'CANCELADA' ? 'neutral' : 'info'}`}>{o.status}</span></td>
                    <td>
                      <div className="flex">
                        {o.status === 'PENDIENTE' && (
                          <>
                            <button className="btn success sm" onClick={async () => { if (confirm(`Recibir ${o.code}? (entra al stock)`)) { try { await api(`/purchase-orders/${o.id}/status`, { method: 'POST', body: { action: 'RECIBIR' } }); toast.success('Stock actualizado'); loadOrders(); loadRep() } catch (e) { toast.error(e.message) } } }}>Recibir</button>
                            <button className="btn danger sm" onClick={async () => { if (confirm(`Cancelar ${o.code}?`)) { try { await api(`/purchase-orders/${o.id}/status`, { method: 'POST', body: { action: 'CANCELAR' } }); loadOrders() } catch (e) { toast.error(e.message) } } }}><XMarkIcon style={{ width: 16, height: 16 }} /></button>
                          </>
                        )}
                        <button className="btn secondary sm" onClick={async () => { try { setDetail(await api(`/purchase-orders/${o.id}`)) } catch (e) { toast.error(e.message) } }}></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {list.length === 0 && <div className="empty">Sin órdenes de compra</div>}
          </div>
        </>
      )}

      {tab === 'sugerencia' && (
        <div className="card">
          <div className="row-between">
            <h3><CubeIcon style={{ width: 16, height: 16 }} /> Productos por reabastecer</h3>
            {replenish.length > 0 && <button className="btn sm" onClick={() => openForm(replenish.map(r => ({ product_id: r.id, name: r.name, qty: r.suggested_qty, cost: r.cost })))}>Crear orden con sugerencia</button>}
          </div>
          {replenish.length === 0 ? (
            <div className="empty">Todos los productos están por encima de su stock mínimo</div>
          ) : (
            <table>
              <thead><tr><th>Producto</th><th>Stock</th><th>Mín / Máx</th><th>Sugerido</th><th>Costo unit</th><th>Inversión</th></tr></thead>
              <tbody>
                {replenish.map(r => (
                  <tr key={r.id}>
                    <td><strong>{r.name}</strong></td>
                    <td className="muted">{r.stock}</td>
                    <td className="muted">{r.stock_min} / {r.stock_max}</td>
                    <td><span className="badge warning">{r.suggested_qty}</span></td>
                    <td>{fmt(r.cost)}</td>
                    <td><strong>{fmt(r.est_cost)}</strong></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {form && (
        <div className="modal-back" onClick={() => setForm(null)}>
          <div className="modal" style={{ maxWidth: 640 }} onClick={e => e.stopPropagation()}>
            <h2>Orden de compra</h2>
            <div className="grid g2">
              <div className="field"><label>Proveedor</label>
                <select className="select" value={form.supplier_id} onChange={e => setForm(f => ({ ...f, supplier_id: e.target.value }))}>
                  <option value="">Sin proveedor</option>
                  {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <div className="field"><label>Fecha esperada</label><input className="input" type="date" value={form.expected_date} onChange={e => setForm(f => ({ ...f, expected_date: e.target.value }))} /></div>
            </div>
            <div className="field"><label>Nota</label><input className="input" value={form.note} onChange={e => setForm(f => ({ ...f, note: e.target.value }))} /></div>
            <div className="field"><label>Agregar producto</label>
              <select className="select" value="" onChange={e => {
                const p = products.find(x => x.id === Number(e.target.value))
                if (!p) return
                const ex = form.items.find(i => i.product_id === p.id)
                const items = ex ? form.items.map(i => i.product_id === p.id ? { ...i, qty: i.qty + 1 } : i) : [...form.items, { product_id: p.id, name: p.name, qty: 1, cost: p.cost }]
                setForm(f => ({ ...f, items }))
              }}>
                <option value="">Selecciona…</option>
                {products.map(p => <option key={p.id} value={p.id}>{p.name} — costo {fmt(p.cost)}</option>)}
              </select>
            </div>
            {tab === 'sugerencia' && replenish.length > 0 && <button className="btn secondary sm mb12" onClick={addFromSuggestion}>+ Añadir todos los sugeridos</button>}
            {form.items.map(it => (
              <div className="cart-item" key={it.product_id}>
                <div className="nm">{it.name}</div>
                <input type="number" style={{ width: 70 }} value={it.qty} onChange={e => setForm(f => ({ ...f, items: f.items.map(i => i.product_id === it.product_id ? { ...i, qty: Math.max(1, Number(e.target.value) || 1) } : i) }))} />
                <input type="number" style={{ width: 80 }} value={it.cost} title="Costo" onChange={e => setForm(f => ({ ...f, items: f.items.map(i => i.product_id === it.product_id ? { ...i, cost: Number(e.target.value) || 0 } : i) }))} />
                <div style={{ minWidth: 90, textAlign: 'right' }}><strong>{fmt(it.cost * it.qty)}</strong></div>
                <button className="btn danger sm" onClick={() => setForm(f => ({ ...f, items: f.items.filter(i => i.product_id !== it.product_id) }))}><XMarkIcon style={{ width: 16, height: 16 }} /></button>
              </div>
            ))}
            <div className="cart-totals"><div className="row total"><span>Total estimado</span><span>{fmt(totalItems)}</span></div></div>
            <div className="modal-footer">
              <button className="btn" onClick={create}><CheckIcon style={{ width: 16, height: 16 }} /> Crear orden</button>
              <button className="btn secondary" onClick={() => setForm(null)}>Cancelar</button>
            </div>
          </div>
        </div>
      )}

      {detail && (
        <div className="modal-back" onClick={() => setDetail(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2>{detail.code} <span className={`badge ${detail.status === 'RECIBIDA' ? 'success' : detail.status === 'CANCELADA' ? 'neutral' : 'info'}`}>{detail.status}</span></h2>
            <div className="muted">{fmtDate(detail.created_at)} · {detail.supplier_name || 'Sin proveedor'}</div>
            <table>
              <thead><tr><th>Producto</th><th>Cant</th><th>Costo</th><th>Total</th></tr></thead>
              <tbody>{detail.items.map(it => <tr key={it.id}><td>{it.product_name}</td><td>{it.qty}</td><td>{fmt(it.cost)}</td><td>{fmt(it.total)}</td></tr>)}</tbody>
            </table>
            <div className="cart-totals"><div className="row total"><span>Total</span><span>{fmt(detail.total)}</span></div></div>
            <div className="modal-footer"><button className="btn secondary" onClick={() => setDetail(null)}>Cerrar</button></div>
          </div>
        </div>
      )}
    </>
  )
}

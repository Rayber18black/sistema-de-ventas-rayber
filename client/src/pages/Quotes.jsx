import React, { useEffect, useState } from 'react'
import { api } from '../api.js'
import { fmt, fmtDate } from '../fmt.js'
import { useToast } from '../toast.jsx'
import { useAuth } from '../auth.jsx'
import { PrinterIcon, XMarkIcon, CheckIcon } from '@heroicons/react/24/outline'

export default function Quotes() {
  const { user } = useAuth()
  const toast = useToast()
  const [status, setStatus] = useState('')
  const [list, setList] = useState([])
  const [detail, setDetail] = useState(null)
  const [form, setForm] = useState(null)
  const [products, setProducts] = useState([])
  const [customers, setCustomers] = useState([])
  const [busy, setBusy] = useState(false)

  const load = () => api('/quotes', { query: { status } }).then(setList).catch(() => {})
  useEffect(load, [status])

  async function openForm() {
    const [ps, cs] = await Promise.all([
      api('/products?activeOnly=1').catch(() => []),
      api('/customers').catch(() => [])
    ])
    setProducts(ps); setCustomers(cs)
    setForm({ items: [], discount: 0, valid_days: 7, note: '', customer_id: '' })
  }

  async function create() {
    if (!form.items.length) return toast.error('Agrega al menos un producto')
    try {
      await api('/quotes', { method: 'POST', body: { ...form, customer_id: form.customer_id ? Number(form.customer_id) : null } })
      toast.success('Cotización creada'); setForm(null); load()
    } catch (e) { toast.error(e.message) }
  }

  const subtotal = form?.items.reduce((a, c) => a + c.price * c.qty, 0) || 0
  const total = subtotal - (form?.discount || 0)

  return (
    <>
      <div className="page-head"><div><h1>Cotizaciones</h1><div className="sub">Presupuestos para clientes · conviértelas en venta</div></div>
        <button className="btn" onClick={openForm}>+ Nueva cotización</button>
      </div>

      <div className="flex mb12">
        {[['', 'Todas'], ['ABIERTA', 'Abiertas'], ['CONVERTIDA', 'Convertidas'], ['CANCELADA', 'Canceladas']].map(([v, l]) => (
          <button key={v} className={`btn ${status === v ? 'active' : 'secondary'} sm`} onClick={() => setStatus(v)}>{l}</button>
        ))}
      </div>

      <div className="table-wrap">
        <table>
          <thead><tr><th>Código</th><th>Fecha</th><th>Cliente</th><th>Vendedor</th><th>Total</th><th>Estado</th><th></th></tr></thead>
          <tbody>
            {list.map(q => (
              <tr key={q.id}>
                <td><strong>{q.code}</strong></td>
                <td className="muted">{fmtDate(q.created_at)}</td>
                <td>{q.customer_name || 'Consumidor final'}</td>
                <td>{q.seller}</td>
                <td><strong>{fmt(q.total)}</strong></td>
                <td><span className={`badge ${q.status === 'ABIERTA' ? 'info' : q.status === 'CONVERTIDA' ? 'success' : 'neutral'}`}>{q.status}</span></td>
                <td>
                  <div className="flex">
                    <button className="btn secondary sm" onClick={async () => { try { setDetail(await api(`/quotes/${q.id}`)) } catch (e) { toast.error(e.message) } }}>Ver</button>
                    {q.status === 'ABIERTA' && user?.permissions?.includes('sales.do') && (
                      <>
                        <button className="btn sm" onClick={async () => { if (confirm(`Convertir ${q.code} en venta?`)) { try { await api(`/quotes/${q.id}/status`, { method: 'POST', body: { action: 'CONVERTIR' } }); toast.success('Vendida ✓'); load() } catch (e) { toast.error(e.message) } } }}>Vender</button>
                        <button className="btn danger sm" onClick={async () => { if (confirm(`Cancelar ${q.code}?`)) { try { await api(`/quotes/${q.id}/status`, { method: 'POST', body: { action: 'CANCELAR' } }); load() } catch (e) { toast.error(e.message) } } }}><XMarkIcon style={{ width: 16, height: 16 }} /></button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {list.length === 0 && <div className="empty">Sin cotizaciones</div>}
      </div>

      {form && (
        <div className="modal-back" onClick={() => setForm(null)}>
          <div className="modal" style={{ maxWidth: 640 }} onClick={e => e.stopPropagation()}>
            <h2>Nueva cotización</h2>
            <div className="field"><label>Buscar producto</label>
              <select className="select" value="" onChange={e => {
                const p = products.find(x => x.id === Number(e.target.value))
                if (!p) return
                const ex = form.items.find(i => i.product_id === p.id)
                const items = ex ? form.items.map(i => i.product_id === p.id ? { ...i, qty: i.qty + 1 } : i) : [...form.items, { product_id: p.id, name: p.name, price: p.price_minor, qty: 1, tax_rate: p.tax_rate, unit: p.unit }]
                setForm(f => ({ ...f, items }))
              }}>
                <option value="">Selecciona (minorista)…</option>
                {products.map(p => <option key={p.id} value={p.id}>{p.name} — {fmt(p.price_minor)}</option>)}
              </select>
            </div>
            {form.items.map(it => (
              <div className="cart-item" key={it.product_id}>
                <div className="nm">{it.name}</div>
                <div className="qty">
                  <button className="btn secondary sm" onClick={() => setForm(f => ({ ...f, items: f.items.map(i => i.product_id === it.product_id ? { ...i, qty: Math.max(1, i.qty - 1) } : i) }))}>−</button>
                  <input type="number" style={{ width: 50 }} value={it.qty} onChange={e => setForm(f => ({ ...f, items: f.items.map(i => i.product_id === it.product_id ? { ...i, qty: Math.max(1, Number(e.target.value) || 1) } : i) }))} />
                  <button className="btn secondary sm" onClick={() => setForm(f => ({ ...f, items: f.items.map(i => i.product_id === it.product_id ? { ...i, qty: i.qty + 1 } : i) }))}>+</button>
                </div>
                <div style={{ minWidth: 90, textAlign: 'right' }}><strong>{fmt(it.price * it.qty)}</strong></div>
                <button className="btn danger sm" onClick={() => setForm(f => ({ ...f, items: f.items.filter(i => i.product_id !== it.product_id) }))}><XMarkIcon style={{ width: 16, height: 16 }} /></button>
              </div>
            ))}
            {form.items.length === 0 && <div className="empty">Agrega productos</div>}
            <hr className="divider" />
            <div className="grid g2">
              <div className="field"><label>Descuento ({fmt(0)}?)</label><input className="input" type="number" value={form.discount} onChange={e => setForm(f => ({ ...f, discount: Math.max(0, Number(e.target.value) || 0) }))} /></div>
              <div className="field"><label>Válido por (días)</label><input className="input" type="number" value={form.valid_days} onChange={e => setForm(f => ({ ...f, valid_days: Number(e.target.value) || 7 }))} /></div>
              <div className="field"><label>Cliente</label>
                <select className="select" value={form.customer_id} onChange={e => setForm(f => ({ ...f, customer_id: e.target.value }))}>
                  <option value="">Consumidor final</option>
                  {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div className="field"><label>Nota</label><input className="input" value={form.note} onChange={e => setForm(f => ({ ...f, note: e.target.value }))} /></div>
            </div>
            <div className="cart-totals"><div className="row total"><span>TOTAL</span><span>{fmt(total)}</span></div></div>
            <div className="modal-footer">
              <button className="btn" disabled={busy} onClick={async () => { setBusy(true); try { await create() } finally { setBusy(false) } }}><CheckIcon style={{ width: 16, height: 16 }} /> Guardar cotización</button>
              <button className="btn secondary" onClick={() => setForm(null)}>Cancelar</button>
            </div>
          </div>
        </div>
      )}

      {detail && (
        <div className="modal-back" onClick={() => setDetail(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2>Cotización {detail.code} <span className={`badge ${detail.status === 'ABIERTA' ? 'info' : detail.status === 'CONVERTIDA' ? 'success' : 'neutral'}`}>{detail.status}</span></h2>
            <div className="muted">{fmtDate(detail.created_at)} · {detail.customer?.name || 'Consumidor final'} · Válida {detail.valid_days} días</div>
            {detail.note && <div className="mt8 muted">{detail.note}</div>}
            <hr className="divider" />
            <table>
              <thead><tr><th>Producto</th><th>Cant</th><th>Precio</th><th>Total</th></tr></thead>
              <tbody>{detail.items.map(it => <tr key={it.id}><td>{it.product_name}</td><td>{it.qty}</td><td>{fmt(it.price)}</td><td>{fmt(it.total)}</td></tr>)}</tbody>
            </table>
            <div className="cart-totals">
              <div className="row"><span>Subtotal</span><span>{fmt(detail.sub_total + detail.discount)}</span></div>
              {detail.discount > 0 && <div className="row"><span>Descuento</span><span>-{fmt(detail.discount)}</span></div>}
              {detail.tax_total > 0 && <div className="row"><span>Impuestos</span><span>{fmt(detail.tax_total)}</span></div>}
              <div className="row total"><span>Total</span><span>{fmt(detail.total)}</span></div>
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => window.print()}><PrinterIcon style={{ width: 16, height: 16 }} /> Imprimir</button>
              <button className="btn secondary" onClick={() => setDetail(null)}>Cerrar</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

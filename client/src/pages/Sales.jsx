import React, { useEffect, useState } from 'react'
import { api } from '../api.js'
import { fmt, fmtDate } from '../fmt.js'
import { useAuth } from '../auth.jsx'
import { printTicket, buildTicketData } from '../printer.js'
import { ArrowUturnLeftIcon, XMarkIcon, CheckIcon, PrinterIcon } from '@heroicons/react/24/outline'

export default function Sales() {
  const { user } = useAuth()
  const can = p => user?.permissions?.includes(p)
  const [tab, setTab] = useState('ventas')
  const [sales, setSales] = useState([])
  const [refunds, setRefunds] = useState([])
  const [detail, setDetail] = useState(null)
  const [refundModal, setRefundModal] = useState(null)
  const [filter, setFilter] = useState({ from: '', to: '', search: '', branch_id: '' })
  const [branches, setBranches] = useState([])

  const loadSales = () => api('/sales', { query: filter }).then(setSales).catch(() => {})
  const loadRefunds = () => api('/refunds').then(setRefunds).catch(() => {})
  useEffect(() => { api('/branches').then(setBranches).catch(() => {}) }, [])

  useEffect(() => { loadSales(); loadRefunds() }, [])
  // refresco de estados (aprobados/rechazados desde el bot del dueño)
  useEffect(() => {
    const iv = setInterval(() => { if (tab === 'devoluciones') loadRefunds() }, 12000)
    return () => clearInterval(iv)
  }, [tab])

  async function openDetail(id) {
    try { setDetail(await api(`/sales/${id}`)) } catch (e) { alert(e.message) }
  }

  async function doReprint() {
    try {
      const s = await api('/settings/public')
      printTicket(buildTicketData(detail, s.businessName || '', s.posTitle || ''))
      alert('Ticket enviado a la impresora térmica')
    } catch (e) { alert(e.message) }
  }

  async function createRefund() {
    if (!refundModal.qty || refundModal.qty <= 0) return alert('Indica la cantidad a devolver')
    try {
      await api('/refunds', { method: 'POST', body: refundModal })
      setRefundModal(null); loadRefunds(); loadSales()
    } catch (e) { alert(e.message) }
  }

  async function resolveRefund(r, status) {
    if (!confirm(`¿${status === 'APROBADO' ? 'Aprobar' : 'Rechazar'} la devolución ${r.code} ${r.product_name} x${r.qty}?`)) return
    try {
      await api(`/refunds/${r.id}/status`, { method: 'POST', body: { status } })
      loadRefunds()
    } catch (e) { alert(e.message) }
  }

  const statusBadge = st => (
    <span className={`badge ${st === 'APROBADO' ? 'success' : st === 'RECHAZADO' ? 'danger' : 'info'}`}>{st}</span>
  )

  return (
    <>
      <div className="page-head"><div><h1>Ventas</h1><div className="sub">Historial y devoluciones (aprobadas por el dueño)</div></div>
        <div className="tabs">
          <button className={`btn${tab === 'ventas' ? ' active' : ' secondary'}`} onClick={() => setTab('ventas')}>Ventas</button>
          <button className={`btn${tab === 'devoluciones' ? ' active' : ' secondary'}`} onClick={() => setTab('devoluciones')}><ArrowUturnLeftIcon style={{ width: 16, height: 16 }} /> Devoluciones</button>
        </div>
      </div>

      {tab === 'ventas' && (
        <>
          <div className="flex mb12 wrap">
            <div className="field" style={{ margin: 0 }}><label>Desde</label><input className="input" type="date" value={filter.from} onChange={e => setFilter({ ...filter, from: e.target.value })} /></div>
            <div className="field" style={{ margin: 0 }}><label>Hasta</label><input className="input" type="date" value={filter.to} onChange={e => setFilter({ ...filter, to: e.target.value })} /></div>
            <div className="field" style={{ margin: 0, flex: 1, minWidth: 160 }}><label>Buscar</label><input className="input" placeholder="Folio o nota…" value={filter.search} onChange={e => setFilter({ ...filter, search: e.target.value })} /></div>
            <div className="field" style={{ margin: 0 }}><label>Sucursal</label>
              <select className="select" value={filter.branch_id} onChange={e => setFilter({ ...filter, branch_id: e.target.value })}>
                <option value="">Todas</option>
                {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
            <div className="field" style={{ margin: 0 }}><label>&nbsp;</label><button className="btn" onClick={loadSales}>Filtrar</button></div>
          </div>

          <div className="table-wrap">
            <table>
              <thead><tr><th>Folio</th><th>Fecha</th><th>Vendedor</th><th>Cliente</th><th>Métodos</th><th>Total</th><th>Estado</th><th></th></tr></thead>
              <tbody>
                {sales.map(s => (
                  <tr key={s.id}>
                    <td><strong>{s.folio}</strong></td>
                    <td className="muted">{fmtDate(s.created_at)}</td>
                    <td>{s.seller}</td>
                    <td className="muted">{s.customer_name || 'Consumidor final'}</td>
                    <td>
                      <div className="flex wrap">
                        {(s.payments || []).map(p => <span key={p.id} className="badge info">{p.method} {fmt(p.amount)}</span>)}
                      </div>
                    </td>
                    <td><strong>{fmt(s.total)}</strong></td>
                    <td><span className="badge success">{s.status}</span></td>
                    <td>
                      <div className="flex">
                        <button className="btn secondary sm" onClick={() => openDetail(s.id)}>Ver</button>
                        {can('refund.do') && <button className="btn sm" style={{ marginLeft: 6 }} onClick={() => setRefundModal({ sale_id: s.id, product_id: null, qty: 1, reason: '' })}><ArrowUturnLeftIcon style={{ width: 16, height: 16 }} /> Devolver</button>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {sales.length === 0 && <div className="empty">Sin ventas para el filtro</div>}
          </div>
        </>
      )}

      {tab === 'devoluciones' && (
        <div className="card">
          <div className="muted mb12">Solicitadas por el cajero y aprobadas/rechazadas por el dueño (desde el bot de Telegram o aquí mismo si tienes permiso). Al aprobarse, el stock se repone automáticamente y queda registro de nota de crédito.</div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Nº</th><th>Fecha</th><th>Venta</th><th>Producto</th><th>Cant</th><th>Importe</th><th>Motivo</th><th>Solicitó</th><th>Estado</th><th></th></tr></thead>
              <tbody>
                {refunds.map(r => (
                  <tr key={r.id}>
                    <td><strong>{r.code}</strong></td>
                    <td className="muted">{fmtDate(r.created_at)}</td>
                    <td>{r.sale_folio}</td>
                    <td>{r.product_name}</td>
                    <td>{r.qty}</td>
                    <td><strong>{fmt(r.amount)}</strong></td>
                    <td className="muted">{r.reason || '—'}</td>
                    <td>{r.seller}</td>
                    <td>{statusBadge(r.status)}</td>
                    <td>{r.status === 'PENDIENTE' && can('refunds.approve')
                      ? <div className="flex">
                          <button className="btn sm" onClick={() => resolveRefund(r, 'APROBADO')}><CheckIcon style={{ width: 16, height: 16 }} /> Aprobar</button>
                          <button className="btn danger sm" style={{ marginLeft: 6 }} onClick={() => resolveRefund(r, 'RECHAZADO')}><XMarkIcon style={{ width: 16, height: 16 }} /> Rechazar</button>
                        </div>
                      : r.status === 'PENDIENTE' ? <span className="muted">Esperando al dueño…</span> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {refunds.length === 0 && <div className="empty">Sin devoluciones</div>}
          </div>
        </div>
      )}

      {detail && (
        <div className="modal-back" onClick={() => setDetail(null)}>
          <div className="modal" style={{ maxWidth: 520 }} onClick={e => e.stopPropagation()}>
            <h2>Venta {detail.folio}</h2>
            <div className="muted">{fmtDate(detail.created_at)} · {detail.seller} · {detail.customer_name || 'Consumidor final'}</div>
            <hr className="divider" />
            <h4>Productos</h4>
            <table>
              <thead><tr><th>Producto</th><th>Cant</th><th>Precio</th><th>Total</th></tr></thead>
              <tbody>
                {detail.items.map(it => (
                  <tr key={it.id}>
                    <td>{it.product_name}</td><td>{it.qty}</td><td>{fmt(it.price)}</td><td>{fmt(it.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="cart-totals">
              <div className="row"><span>Subtotal</span><span>{fmt(detail.sub_total + detail.discount)}</span></div>
              {detail.discount > 0 && <div className="row"><span>Descuento</span><span>-{fmt(detail.discount)}</span></div>}
              {detail.tax_total > 0 && <div className="row"><span>Impuestos</span><span>{fmt(detail.tax_total)}</span></div>}
              <div className="row total"><span>Total</span><span>{fmt(detail.total)}</span></div>
            </div>
            <h4 className="mt">Pagos</h4>
            {detail.payments.map(p => <div key={p.id} className="row-between"><span className="muted">{p.method}</span><strong>{fmt(p.amount)}</strong></div>)}
            <div className="modal-footer">
              <button className="btn" onClick={doReprint}><PrinterIcon style={{ width: 16, height: 16 }} /> Térmica</button>
              <button className="btn" style={{ marginLeft: 6 }} onClick={() => window.print()}>Imprimir</button>
              <button className="btn secondary" onClick={() => setDetail(null)}>Cerrar</button>
            </div>
          </div>
        </div>
      )}

      {refundModal && (
        <div className="modal-back" onClick={() => setRefundModal(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2><ArrowUturnLeftIcon style={{ width: 16, height: 16 }} /> Devolución</h2>
            <RefundForm modal={refundModal} onChange={setRefundModal} onCreate={createRefund} onClose={() => setRefundModal(null)} sale={detail} />
          </div>
        </div>
      )}
    </>
  )
}

function RefundForm({ modal, onChange, onCreate, onClose }) {
  const [sale, setSale] = useState(null)
  const [items, setItems] = useState([])
  useEffect(() => {
    api(`/sales/${modal.sale_id}`).then(d => {
      setSale(d)
      setItems(d.items || [])
      if ((d.items || []).length === 1) onChange({ ...modal, product_id: d.items[0].product_id, qty: 1, unit_price: d.items[0].price })
    }).catch(() => {})
  }, [])
  const item = items.find(i => i.product_id === Number(modal.product_id))
  return (
    <>
      {sale && <div className="muted mb12">Venta {sale.folio} — Total {fmt(sale.total)}</div>}
      <div className="field">
        <label>Producto de la venta</label>
        <select className="select" value={modal.product_id || ''} onChange={e => {
          const it = items.find(i => i.product_id === Number(e.target.value))
          onChange({ ...modal, product_id: Number(e.target.value), qty: 1, unit_price: it ? it.price : 0 })
        }}>
          <option value="">Selecciona…</option>
          {items.map(i => <option key={i.id} value={i.product_id}>{i.product_name} — vendió {i.qty}</option>)}
        </select>
      </div>
      {item && <div className="field"><label>Total a devolver {fmt(item.qty * item.price)}</label></div>}
      <div className="field"><label>Cantidad a devolver (máx {item?.qty || 0})</label>
        <input className="input" type="number" min="1" max={item?.qty || 1} value={modal.qty} onChange={e => onChange({ ...modal, qty: Number(e.target.value) })} />
      </div>
      <div className="field"><label>Motivo</label>
        <textarea className="input" rows="2" value={modal.reason} onChange={e => onChange({ ...modal, reason: e.target.value })} placeholder="Ej: cliente devolvió el producto, estaba dañado…" />
      </div>
      <div className="modal-footer">
        <button className="btn" disabled={!modal.product_id} onClick={onCreate}>Solicitar devolución</button>
        <button className="btn secondary" onClick={onClose}>Cancelar</button>
      </div>
    </>
  )
}

import React, { useEffect, useMemo, useState, useRef } from 'react'
import { api } from '../api.js'
import { fmt, fmtDate } from '../fmt.js'
import { useToast } from '../toast.jsx'
import { useAuth } from '../auth.jsx'
import { branchId, branchName } from '../branch.js'
import { printThermalEnabled, printTicket, buildTicketData } from '../printer.js'
import Cash from './Cash.jsx'
import { BanknotesIcon, XMarkIcon, MinusIcon, PlusIcon, CreditCardIcon } from '@heroicons/react/24/outline'

export default function Pos() {
  const toast = useToast()
  const { user } = useAuth()
  const [products, setProducts] = useState([])
  const [categories, setCategories] = useState([])
  const [search, setSearch] = useState('')
  const [cat, setCat] = useState('')
  const [cart, setCart] = useState([])
  const [priceList, setPriceList] = useState('minor')
  const [discount, setDiscount] = useState(0)
  const [customerId, setCustomerId] = useState('')
  const [customers, setCustomers] = useState([])
  const [payments, setPayments] = useState([{ method: 'efectivo', amount: '' }])
  const [methods, setMethods] = useState([])
  const [extraCurrencies, setExtraCurrencies] = useState([])
  const [biz, setBiz] = useState({ businessName: 'Mi Negocio', posTitle: 'PUNTO DE VENTA' })
  const [busy, setBusy] = useState(false)
  const [payOpen, setPayOpen] = useState(false)
  const [cashOpen, setCashOpen] = useState(false)
  const [ticketSale, setTicketSale] = useState(null)
  const [newClient, setNewClient] = useState(null)
const [sel, setSel] = useState(0)
const searchRef = useRef(null)
  const gridRef = useRef(null)

  const can = p => user?.permissions?.includes(p)

  const load = () => api('/products?activeOnly=1').then(setProducts).catch(() => {})
  useEffect(() => {
    load()
    api('/categories').then(setCategories).catch(() => {})
    if (can('customers.manage')) api('/customers').then(setCustomers).catch(() => {})
    api('/settings/public').then(s => { setMethods(s.paymentMethods || []); setExtraCurrencies(s.extraCurrencies || []); setBiz({ businessName: s.businessName, posTitle: s.posTitle }) }).catch(() => {})
  }, [])

  const shown = useMemo(() => {
    let list = products
    if (cat) list = list.filter(p => p.category_id === Number(cat))
    if (search.trim()) {
      const s = search.trim().toLowerCase()
      list = list.filter(p => p.name.toLowerCase().includes(s) || p.code.toLowerCase().includes(s) || (p.barcode || '').toLowerCase().includes(s))
    }
    return list
  }, [products, search, cat])

  useEffect(() => {
    setSel(s => (shown.length ? Math.min(s, shown.length - 1) : 0))
  }, [shown.length])

  useEffect(() => {
    gridRef.current?.querySelector?.('[data-sel="1"]')?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  }, [sel])

  const subtotal = cart.reduce((a, c) => a + c.price * c.qty, 0)
  const tax = cart.reduce((a, c) => a + c.price * c.qty * (c.tax_rate / 100), 0)
  const ratio = subtotal > 0 ? 1 - discount / subtotal : 1
  const total = subtotal - discount + tax * ratio
  const paid = payments.reduce((a, p) => a + (Number(p.amount) || 0), 0)
  const change = paid - total

  function priceOf(p) {
    return priceList === 'major' ? p.price_major : priceList === 'special' ? p.price_special : p.price_minor
  }

  function addToCart(p) {
    if (p.stock <= 0) return toast.error(`Sin stock de ${p.name}`)
    setCart(c => {
      const ex = c.find(x => x.product_id === p.id)
      if (ex) return c.map(x => x.product_id === p.id ? { ...x, qty: x.qty + 1 } : x)
      return [...c, { product_id: p.id, name: p.name, image: p.image, price: priceOf(p), tax_rate: p.tax_rate, stock: p.stock, qty: 1 }]
    })
  }

  function setQty(product_id, qty) {
    setCart(c => c.map(x => x.product_id === product_id ? { ...x, qty: Math.max(1, Number(qty) || 1) } : x))
  }
  function removeItem(product_id) { setCart(c => c.filter(x => x.product_id !== product_id)) }

  function clearCart() {
    setCart([]); setDiscount(0); setCustomerId(''); setPayments([{ method: 'efectivo', amount: '' }])
  }

  function setMethodAmount(method, amount) {
    setPayments(ps => {
      const ex = ps.find(p => p.method === method)
      const next = ex
        ? ps.map(p => p.method === method ? { ...p, amount } : p)
        : [...ps, { method, amount }]
      const paid = next.reduce((a, p) => a + (Number(p.amount) || 0), 0)
      const resto = total - paid
      if (resto > 0.005) {
        const candidates = ex
          ? next.filter(p => p.method !== method && !(Number(p.amount) || 0))
          : next.filter(p => !(Number(p.amount) || 0))
        if (candidates.length) {
          const target = candidates[candidates.length - 1]
          return next.map(p => p.method === target.method ? { ...p, amount: String(Math.round(resto * 100) / 100) } : p)
        }
      }
      return next
    })
  }
  function removeMethodPayment(method) { setPayments(ps => ps.filter(p => p.method !== method)) }
  function autoFill(amount) {
    setPayments(ps => {
      if (!ps.length) return [{ method: 'efectivo', amount: String(amount) }]
      return ps.map(p => ({ ...p, amount: p.method === 'efectivo' ? String(amount) : '' }))
    })
  }

  function openPay() {
    if (!cart.length) return toast.error('Agrega productos a la venta')
    setPayOpen(true)
  }

  async function createClient() {
    if (!newClient.name) return toast.error('Nombre requerido')
    if (!newClient.phone && !newClient.ci && !newClient.rif) return toast.error('Indica teléfono o C.I./RIF para poder identificarlo')
    setBusy(true)
    try {
      const q = {}
      if (newClient.phone) q.search = newClient.phone
      const found = (await api('/customers', { query: q }).catch(() => [])).find(c => (c.phone && c.phone === newClient.phone))
      if (found) { setCustomerId(String(found.id)); toast.success(`Cliente ya existía: ${found.name}`); setNewClient(null); return }
      const info = await api('/customers', { method: 'POST', body: newClient })
      const list = await api('/customers').catch(() => [])
      setCustomers(list)
      setCustomerId(String(info.id))
      toast.success('Cliente creado y vinculado a la venta')
      setNewClient(null)
    } catch (e) { toast.error(e.message) } finally { setBusy(false) }
  }

  function move(delta) {
    if (!shown.length) return
    setSel(s => Math.max(0, Math.min(shown.length - 1, s + delta)))
  }

  function onKey(e) {
    const t = e.target
    const inNum = t?.tagName === 'INPUT' && t.type === 'number'
    const isSearch = t === searchRef.current
    if ((newClient || ticketSale) && e.key !== 'Escape') return
    if (e.key === 'Escape') {
      e.preventDefault()
      if (cashOpen) { setCashOpen(false); return }
      if (payOpen) { setPayOpen(false); return }
      setSearch(''); setCat(''); setSel(0); searchRef.current?.focus(); return
    }
    if (cashOpen || payOpen) return
    if (e.key === 'F4') { e.preventDefault(); openPay(); return }
    if (inNum) return
    const cols = () => gridRef.current ? Math.max(1, Math.floor(gridRef.current.clientWidth / 92)) : 1
    if (e.key === 'ArrowDown') { e.preventDefault(); move(cols()); return }
    if (e.key === 'ArrowUp') { e.preventDefault(); move(-cols()); return }
    if (!isSearch && e.key === 'ArrowRight') { e.preventDefault(); move(1); return }
    if (!isSearch && e.key === 'ArrowLeft') { e.preventDefault(); move(-1); return }
    if (e.key === 'Enter' || e.key === '+') {
      if (isSearch && e.key === '+') return
      const tag = t?.tagName
      if (tag === 'BUTTON' || tag === 'A' || tag === 'SELECT') return
      e.preventDefault()
      const p = shown[sel]
      if (p) addToCart(p)
    }
  }

  async function complete() {
    if (!cart.length) return toast.error('Agrega productos a la venta')
    if (paid < total - 0.001) return toast.error('El monto pagado no cubre el total')
    setBusy(true)
    try {
      const body = {
        items: cart.map(c => ({ product_id: c.product_id, qty: c.qty })),
        priceList,
        discount: Number(discount) || 0,
        customer_id: customerId ? Number(customerId) : null,
        branch_id: branchId() || undefined,
        payments: payments.filter(p => (Number(p.amount) || 0) > 0).map(p => ({ method: p.method, amount: Number(p.amount) }))
      }
      const sale = await api('/sales', { method: 'POST', body })
      const full = await api(`/sales/${sale.id}`)
      setTicketSale(full)
      setPayOpen(false)
      clearCart()
      setSel(0)
      load()
      try {
        if (await printThermalEnabled()) {
          await printTicket(buildTicketData({ ...full, branch_name: branchName() }, biz.businessName, biz.posTitle))
          toast.success('Ticket impreso')
        }
      } catch (e) { toast.error(e.message, 6000) }
    } catch (err) { toast.error(err.message) } finally { setBusy(false) }
  }

  return (
    <div className="pos-root" tabIndex={-1} onKeyDown={onKey}>
      <div className="pos-head">
        <h1>Punto de venta</h1>
        <span className="pos-hints">↑↓←→ mover · Enter añadir · + sumar · F4 pagar · Esc limpiar</span>
        {can('cash.open') && (
          <button className="btn secondary lg" style={{ marginLeft: 'auto' }} onClick={() => setCashOpen(true)}>
            <BanknotesIcon style={{ width: 16, height: 16 }} /> Caja
          </button>
        )}
      </div>

      <div className="pos-layout">
        <div className="pos-col">
          <div className="pos-searchbar">
            <input className="input" ref={searchRef} placeholder="Buscar: nombre, código o código de barras"
              value={search} onChange={e => setSearch(e.target.value)} autoFocus />
            <select className="select" value={cat} onChange={e => setCat(e.target.value)} style={{ maxWidth: 150 }}>
              <option value="">Todas</option>
              {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div className="pos-products" ref={gridRef} onWheel={e => e.preventDefault()}>
            {shown.map((p, i) => (
              <div key={p.id} className={`pos-prod ${p.stock <= 0 ? 'out' : p.stock <= p.stock_min ? 'low' : ''} ${i === sel ? 'sel' : ''}`}
                data-sel={i === sel ? '1' : '0'} tabIndex={-1}
                onClick={() => addToCart(p)}>
                <div className="code">{p.code}</div>
                <div className="name">{p.name}</div>
                <div className="price">{fmt(priceOf(p))}</div>
                {p.stock <= p.stock_min && <div className="stock">{p.stock <= 0 ? 'Sin stock' : `Quedan ${p.stock}`}</div>}
              </div>
            ))}
            {shown.length === 0 && <div className="empty">Sin resultados</div>}
          </div>
        </div>

        <aside className="pos-cart">
          <div className="pos-cart-head">
            <h3>Venta actual</h3>
            {cart.length > 0 && <button className="btn-link danger sm" onClick={clearCart}>Vaciar</button>}
          </div>
          <div className="flex mb12 price-tabs">
            {[['minor', 'Minorista'], ['major', 'Mayorista'], ['special', 'Especial']].map(([v, l]) => (
              <button key={v} className={`method-tab ${priceList === v ? 'on' : ''}`} onClick={() => setPriceList(v)}>{l}</button>
            ))}
          </div>

          <div className="pos-cart-items">
            {cart.length === 0 && <div className="empty">Carrito vacío</div>}
            {cart.map(c => (
              <div className="cart-item" key={c.product_id}>
                <div className="nm">{c.name}</div>
                <div className="qty">
                  <button className="btn secondary sm" onClick={() => setQty(c.product_id, c.qty - 1)}><MinusIcon style={{ width: 16, height: 16 }} /></button>
                  <input type="number" value={c.qty} onChange={e => setQty(c.product_id, e.target.value)} tabIndex={-1} />
                  <button className="btn secondary sm" onClick={() => setQty(c.product_id, c.qty + 1)}><PlusIcon style={{ width: 16, height: 16 }} /></button>
                </div>
                <div className="line-total">{fmt(c.price * c.qty)}</div>
                <button className="btn-link warn sm" onClick={() => removeItem(c.product_id)} tabIndex={-1} aria-label="Quitar"><XMarkIcon style={{ width: 16, height: 16 }} /></button>
              </div>
            ))}
          </div>

          <div className="pos-cart-foot">
            <div className="cart-totals">
              <div className="row"><span>Subtotal</span><span>{fmt(subtotal)}</span></div>
              {discount > 0 && <div className="row"><span>Descuento</span><span>-{fmt(discount)}</span></div>}
              {tax > 0 && <div className="row"><span>Impuestos</span><span>{fmt(tax * ratio)}</span></div>}
              <div className="row total"><span>TOTAL</span><span>{fmt(total)}</span></div>
            </div>
            <button className="btn big pay-cta" onClick={openPay} disabled={cart.length === 0}>
              {cart.length ? `Pagar ${fmt(total)}` : 'Agrega productos'}
            </button>
          </div>
        </aside>
      </div>

      {payOpen && (
        <div className="modal-back" onClick={() => setPayOpen(false)}>
          <div className="modal pay-modal" onClick={e => e.stopPropagation()}>
            <div className="row-between pay-head">
              <h2>Cobrar la venta</h2>
              <button className="btn secondary sm" onClick={() => setPayOpen(false)}><XMarkIcon style={{ width: 16, height: 16 }} /> Cerrar</button>
            </div>

            <div className="pay-summary">
              <div className="row-between muted" style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '.04em' }}>
                <span>{cart.length} {cart.length === 1 ? 'producto' : 'productos'}</span>
                <span>{priceList === 'major' ? 'Mayorista' : priceList === 'special' ? 'Especial' : 'Minorista'}</span>
              </div>
              {cart.map(c => (
                <div className="cart-item" key={c.product_id}>
                  <div className="nm">{c.name} <span className="muted">×{c.qty}</span></div>
                  <div className="line-total">{fmt(c.price * c.qty)}</div>
                </div>
              ))}
            </div>

            <div className="form-grid">
              <div className="field"><label>Descuento</label>
                <input className="input" type="number" value={discount}
                  onChange={e => setDiscount(Math.max(0, Number(e.target.value) || 0))} />
              </div>
              {can('customers.manage') && (
                <div className="field">
                  <label>Cliente</label>
                  <div className="flex">
                    <select className="select" value={customerId} onChange={e => setCustomerId(e.target.value)}>
                      <option value="">Consumidor final</option>
                      {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                    <button className="btn secondary sm" onClick={() => setNewClient({ name: '', ci: '', rif: '', phone: '' })} title="Cliente nuevo"><PlusIcon style={{ width: 16, height: 16 }} /></button>
                  </div>
                </div>
              )}
            </div>

            <div className="cart-totals">
              <div className="row"><span>Subtotal</span><span>{fmt(subtotal)}</span></div>
              {discount > 0 && <div className="row"><span>Descuento</span><span>-{fmt(discount)}</span></div>}
              {tax > 0 && <div className="row"><span>Impuestos</span><span>{fmt(tax * ratio)}</span></div>}
              <div className="row total"><span>TOTAL</span><span>{fmt(total)}</span></div>
              {extraCurrencies.length > 0 && <div className="row muted" style={{ fontSize: 12 }}>
                <span>Aprox.</span><span>{extraCurrencies.map(c => `${c.symbol}${(c.rate > 0 ? total / c.rate : 0).toLocaleString('es', { maximumFractionDigits: 2 })} ${c.code}`).join('  ·  ')}</span>
              </div>}
            </div>

            <div className="pay-methods">
              <h4><CreditCardIcon style={{ width: 16, height: 16 }} /> Pagos</h4>
              <div className="method-tabs">
                {methods.map(m => (
                  <button key={m.code} className={`method-tab ${payments.some(p => p.method === m.code) ? 'on' : ''}`}
                    onClick={() => payments.some(p => p.method === m.code) ? removeMethodPayment(m.code) : setMethodAmount(m.code, '')}>
                    {m.name}
                  </button>
                ))}
              </div>
              {payments.map(p => (
                <div key={p.method} className="flex mt8">
                  <span style={{ minWidth: 90, textTransform: 'capitalize' }}>{p.method}</span>
                  <input className="input" type="number" placeholder="Monto" value={p.amount}
                    onChange={e => setMethodAmount(p.method, e.target.value)} />
                  {Number(p.amount) > 0 && <button className="btn-link warn" onClick={() => setMethodAmount(p.method, '')}><XMarkIcon style={{ width: 16, height: 16 }} /></button>}
                </div>
              ))}
              <div className="flex mt8">
                <button className="btn secondary sm" onClick={() => autoFill(total > 0 ? total : 0)}>Pagar exacto</button>
                <div className="flex" style={{ marginLeft: 'auto' }}>
                  {change > 0 && <span className="muted">Vuelto: <strong>{fmt(change)}</strong></span>}
                  {paid > 0 && paid < total - 0.001 && <span className="badge warning">Faltan {fmt(total - paid)}</span>}
                </div>
              </div>
            </div>

            <button className="btn big success pay-confirm" onClick={complete} disabled={busy}>
              {busy ? 'Procesando…' : `Cobrar ${fmt(total)}`}
            </button>
          </div>
        </div>
      )}

      {cashOpen && (
        <div className="modal-back" onClick={() => setCashOpen(false)}>
          <div className="modal" style={{ maxWidth: 980, maxHeight: '88vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
            <div className="row-between pay-head">
              <h2><BanknotesIcon style={{ width: 16, height: 16 }} /> Caja</h2>
              <button className="btn secondary sm" onClick={() => setCashOpen(false)}><XMarkIcon style={{ width: 16, height: 16 }} /> Cerrar</button>
            </div>
            <Cash />
          </div>
        </div>
      )}

      {newClient && (
        <div className="modal-back" onClick={() => setNewClient(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2>Cliente nuevo</h2>
            <div className="field"><label>Nombre *</label><input className="input" value={newClient.name} onChange={e => setNewClient({ ...newClient, name: e.target.value })} autoFocus /></div>
            <div className="form-grid">
              <div className="field"><label>Cédula (C.I.)</label><input className="input" value={newClient.ci} onChange={e => setNewClient({ ...newClient, ci: e.target.value })} placeholder="V-12345678" /></div>
              <div className="field"><label>RIF (empresa)</label><input className="input" value={newClient.rif} onChange={e => setNewClient({ ...newClient, rif: e.target.value })} placeholder="J-12345678-9" /></div>
              <div className="field"><label>Teléfono</label><input className="input" value={newClient.phone} onChange={e => setNewClient({ ...newClient, phone: e.target.value })} placeholder="Ej: 04141234567" /></div>
            </div>
            <div className="hint muted mb12">Si el teléfono ya pertenece a un cliente, se lo vinculará automáticamente.</div>
            <div className="modal-footer">
              <button className="btn" onClick={createClient} disabled={busy}>{busy ? 'Guardando…' : 'Guardar y usar'}</button>
              <button className="btn secondary" onClick={() => setNewClient(null)}>Cancelar</button>
            </div>
          </div>
        </div>
      )}

      {ticketSale && <TicketModal sale={ticketSale} biz={biz} onClose={() => setTicketSale(null)} />}
    </div>
  )
}

function TicketModal({ sale, biz, onClose }) {
  const toast = useToast()
  async function thermal() {
    try {
      await printTicket(buildTicketData({ ...sale, branch_name: branchName() }, biz.businessName, biz.posTitle))
      toast.success('Ticket impreso en la térmica')
    } catch (e) { toast.error(e.message) }
  }
  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 380 }} onClick={e => e.stopPropagation()}>
        <h2>Ticket #{sale.folio}</h2>
        <div className="ticket" id="ticket-print">
          <div className="center"><strong>{biz.businessName}</strong><br />Venta exitosa</div>
          <hr />
          <div>{fmtDate(sale.created_at)}</div>
          {sale.customer_name && <div>Cliente: {sale.customer_name}</div>}
          <div>Vendedor: {sale.seller}</div>
          <hr />
          {sale.items.map(it => (
            <div className="line" key={it.id}>
              <span>{it.product_name} ×{it.qty}<br /><small className="muted">{fmt(it.price)} c/u</small></span>
              <span>{fmt(it.total)}</span>
            </div>
          ))}
          <hr className="divider" />
          <div className="line"><span>Subtotal</span><span>{fmt(sale.sub_total + sale.discount)}</span></div>
          {sale.discount > 0 && <div className="line"><span>Descuento</span><span>-{fmt(sale.discount)}</span></div>}
          {sale.tax_total > 0 && <div className="line"><span>Impuestos</span><span>{fmt(sale.tax_total)}</span></div>}
          <div className="total"><span>TOTAL</span><span>{fmt(sale.total)}</span></div>
          {sale.payments.map(p => <div className="line" key={p.id}><span>{p.method}</span><span>{fmt(p.amount)}</span></div>)}
          <div className="center muted mt8">¡Gracias por su compra!</div>
        </div>
        <div className="modal-footer">
          <button className="btn" onClick={thermal}>Térmica</button>
          <button className="btn secondary" onClick={() => window.print()}>Papel</button>
          <button className="btn secondary" onClick={onClose}>Cerrar</button>
        </div>
      </div>
    </div>
  )
}

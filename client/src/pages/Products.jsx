import React, { useEffect, useMemo, useState } from 'react'
import { api } from '../api.js'
import { fmt } from '../fmt.js'
import { useToast } from '../toast.jsx'
import { useAuth } from '../auth.jsx'
import { ClipboardDocumentListIcon, FolderIcon, ChartBarIcon, MagnifyingGlassIcon, ArrowDownTrayIcon, ArrowUpTrayIcon, ArrowsRightLeftIcon, DocumentTextIcon, PencilIcon, TrashIcon } from '@heroicons/react/24/outline'

const empty = { code: '', barcode: '', name: '', description: '', category_id: '', unit: 'Unidad', cost: 0, price_minor: 0, price_major: 0, price_special: 0, tax_rate: 0, stock_min: 0, stock_max: 0, attributes: '', active: true, entry_ccy: '', tasa: '', gain: '', ivy: false }

export default function Products() {
  const toast = useToast()
  const { user } = useAuth()
  const can = p => user?.permissions?.includes(p)
  const [tab, setTab] = useState('lista')
  const [products, setProducts] = useState([])
  const [categories, setCategories] = useState([])
  const [search, setSearch] = useState('')
  const [lowOnly, setLowOnly] = useState(false)
  const [cat, setCat] = useState('')
  const [form, setForm] = useState(null)      // modal producto
  const [editing, setEditing] = useState(null)
  const [stockForm, setStockForm] = useState(null) // {product, qty, type, note}
  const [kardex, setKardex] = useState(null)  // {product, rows}
  const [catForm, setCatForm] = useState(false)
  const [pub, setPub] = useState({ currency: 'USD', currencySymbol: '$', defaultTax: 16, extraCurrencies: [] })

  const load = () => api('/products').then(setProducts).catch(() => {})
  useEffect(() => { load(); api('/categories').then(setCategories).catch(() => {}); api('/settings/public').then(setPub).catch(() => {}) }, [])

  const shown = useMemo(() => {
    let l = products
    if (lowOnly) l = l.filter(p => p.stock <= p.stock_min)
    if (cat) l = l.filter(p => p.category_id === Number(cat))
    if (search.trim()) { const s = search.trim().toLowerCase(); l = l.filter(p => p.name.toLowerCase().includes(s) || p.code.toLowerCase().includes(s)) }
    return l
  }, [products, search, lowOnly, cat])

  const invValue = products.reduce((a, p) => a + (p.cost || 0) * p.stock, 0)
  const potProfit = products.reduce((a, p) => a + ((p.price_minor || 0) - (p.cost || 0)) * (p.stock || 0), 0)

  const baseCcy = pub.currency || 'USD'
  const baseSym = pub.currencySymbol || '$'
  const exCurrencies = pub.extraCurrencies || []
  const ccyOptions = [{ code: baseCcy, symbol: baseSym }, ...exCurrencies]
  const entrySymbol = (ccyOptions.find(c => c.code === form?.entry_ccy) || {}).symbol || (form?.entry_ccy || '')
  const tasa = form?.entry_ccy && form.entry_ccy !== baseCcy
    ? (Number((exCurrencies.find(c => c.code === form.entry_ccy) || {}).rate) > 0 ? Number((exCurrencies.find(c => c.code === form.entry_ccy) || {}).rate) : 1)
    : 1
  const toBase = v => Math.round((Number(v) || 0) * tasa * 100) / 100
  const autoMinor = (Number(form?.gain) || 0) > 0 && (Number(form?.gain) || 0) < 100 && (Number(form?.cost) || 0) > 0
    ? Math.round((Number(form.cost) / (1 - Number(form.gain) / 100)) * 100) / 100
    : null

  function parseCsv(text) {
    const lines = text.split(/\r?\n/).filter(l => l.trim())
    if (!lines.length) return []
    const head = lines[0].split(',').map(h => h.replace(/^"|"$/g, '').trim().toLowerCase())
    const splitLine = line => {
      const out = []; let cur = '', inQ = false
      for (let i = 0; i < line.length; i++) {
        const ch = line[i]
        if (inQ) {
          if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++ } else inQ = false }
          else cur += ch
        } else if (ch === '"') inQ = true
        else if (ch === ',') { out.push(cur); cur = '' }
        else cur += ch
      }
      out.push(cur)
      return out
    }
    const rows = []
    for (let i = 1; i < lines.length; i++) {
      const cells = splitLine(lines[i])
      const row = {}
      head.forEach((h, idx) => row[h] = (cells[idx] || '').trim())
      if (row.code || row.name) rows.push(row)
    }
    return rows
  }

  async function importCsv(ev) {
    const file = ev.target.files?.[0]
    ev.target.value = ''
    if (!file) return
    try {
      const text = await file.text()
      const rows = parseCsv(text)
      if (!rows.length) return toast.error('Archivo vacío o formato incorrecto (encabezado: code,name,category,unit,cost,price_minor,price_major,price_special,tax_rate,stock,stock_min,stock_max)')
      if (!confirm(`Importar ${rows.length} filas? (se crean o actualizan por código)`)) return
      const res = await api('/products/import', { method: 'POST', body: { rows } })
      toast.success(`${res.created} creados, ${res.updated} actualizados, ${res.skipped} omitidos`)
      load()
    } catch (e) { toast.error(e.message) }
  }

  async function exportCsv() {
    try {
      const blob = await (await fetch('/api/products/export', { headers: { Authorization: 'Bearer ' + localStorage.getItem('posv_token') } })).blob()
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = 'productos.csv'
      a.click()
    } catch (e) { toast.error('No se pudo exportar') }
  }

  function openEdit(p) {
    if (!can('products.edit')) return toast.error('Sin permiso')
    setEditing(p)
    const entry = exCurrencies.some(c => c.code === 'USD') ? 'USD' : baseCcy
    const rt = entry === baseCcy ? 1 : (Number((exCurrencies.find(c => c.code === 'USD') || {}).rate) || 1)
    const div = v => rt ? Math.round((Number(v) || 0) / rt * 100) / 100 : 0
    setForm({
      ...empty, ...p,
      category_id: p.category_id || '',
      attributes: (p.attributes || []).map(a => `${a.name}:${a.value}`).join(', '),
      entry_ccy: entry, gain: '', ivy: Number(p.tax_rate) > 0,
      cost: div(p.cost),
      price_minor: div(p.price_minor),
      price_major: div(p.price_major),
      price_special: div(p.price_special),
    })
  }
  function openNew() {
    if (!can('products.create')) return toast.error('Sin permiso'); setEditing(null)
    const entry = exCurrencies.some(c => c.code === 'USD') ? 'USD' : baseCcy
    setForm({ ...empty, entry_ccy: entry, gain: '', ivy: false })
  }

  function setGain(v) {
    const g = Number(v) || 0
    let patch = { ...form, gain: v }
    if (g > 0 && g < 100 && (Number(form.cost) || 0) > 0) patch.price_minor = String(Math.round((Number(form.cost) / (1 - g / 100)) * 100) / 100)
    else if (!g) patch.price_minor = ''
    setForm(patch)
  }
  function toggleIvy(checked) {
    setForm(f => ({ ...f, ivy: checked, tax_rate: checked ? Number(pub.defaultTax) || 0 : 0 }))
  }

  async function save() {
    if (!form.code || !form.name) return toast.error('Código y nombre son obligatorios')
    const priceMinor = autoMinor !== null ? autoMinor : (Number(form.price_minor) || 0)
    const body = {
      ...form,
      category_id: form.category_id ? Number(form.category_id) : null,
      cost: toBase(form.cost), price_minor: toBase(priceMinor),
      price_major: toBase(form.price_major), price_special: toBase(form.price_special),
      tax_rate: Number(form.tax_rate) || 0, stock_min: Number(form.stock_min) || 0, stock_max: Number(form.stock_max) || 0,
      attributes: form.attributes ? form.attributes.split(',').map(x => x.trim()).filter(Boolean).map(x => { const [name, value] = x.split(':'); return { name: name?.trim(), value: (value || '').trim() } }) : []
    }
    try {
      if (editing) { await api(`/products/${editing.id}`, { method: 'PUT', body }); toast.success('Producto actualizado') }
      else { await api('/products', { method: 'POST', body }); toast.success('Producto creado') }
      setForm(null); load()
    } catch (e) { toast.error(e.message) }
  }

  async function del(p) {
    if (!confirm(`¿Eliminar "${p.name}"?`)) return
    try { await api(`/products/${p.id}`, { method: 'DELETE' }); toast.success('Eliminado'); load() } catch (e) { toast.error(e.message) }
  }

  async function saveStock() {
    const { product, qty, type } = stockForm
    const delta = type === 'OUT' ? -Number(qty) : Number(qty)
    if (!delta) return toast.error('Cantidad inválida')
    try {
      await api(`/products/${product.id}/stock`, { method: 'POST', body: { qty: delta, type: type === 'SALE' ? 'ADJ' : type, note: stockForm.note } })
      toast.success('Stock actualizado'); setStockForm(null); load()
    } catch (e) { toast.error(e.message) }
  }

  async function openKardex(p) {
    try { const rows = await api(`/products/${p.id}/movements`); setKardex({ product: p, rows }) } catch (e) { toast.error(e.message) }
  }

  async function addCategory() {
    const name = prompt('Nueva categoría:')
    if (!name) return
    try { await api('/categories', { method: 'POST', body: { name } }); api('/categories').then(setCategories); toast.success('Categoría creada') } catch (e) { toast.error(e.message) }
  }

  async function readImage(file) {
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => setForm(f => ({ ...f, image: reader.result }))
    reader.readAsDataURL(file)
  }

  return (
    <>
      <div className="page-head">
        <div><h1>Inventario</h1><div className="sub">Stock: {products.length} productos · Valor en costo: <strong>{fmt(invValue)}</strong></div></div>
        <div className="flex">
          {can('products.create') && (
            <>
              <button className="btn secondary sm" onClick={() => document.getElementById('file-csv').click()}><ArrowDownTrayIcon style={{ width: 16, height: 16 }} /> Importar CSV</button>
              <input id="file-csv" type="file" accept=".csv" style={{ display: 'none' }} onChange={importCsv} />
              <button className="btn secondary sm" onClick={exportCsv}><ArrowUpTrayIcon style={{ width: 16, height: 16 }} /> Exportar</button>
            </>
          )}
          <button className="btn" onClick={openNew}>+ Nuevo producto</button>
        </div>
      </div>

      <div className="flex mb12 wrap">
        <button className={`method-tab ${tab === 'lista' ? 'on' : ''}`} onClick={() => setTab('lista')}><ClipboardDocumentListIcon style={{ width: 16, height: 16 }} /> Lista</button>
        <button className={`method-tab ${tab === 'categorias' ? 'on' : ''}`} onClick={() => setTab('categorias')}><FolderIcon style={{ width: 16, height: 16 }} /> Categorías</button>
        <button className={`method-tab ${tab === 'stock' ? 'on' : ''}`} onClick={() => setTab('stock')}><ChartBarIcon style={{ width: 16, height: 16 }} /> Resumen</button>
      </div>

      {tab === 'lista' && (
        <>
          <div className="flex mb12 wrap">
            <input className="input" placeholder="Buscar…" value={search} onChange={e => setSearch(e.target.value)} style={{ maxWidth: 280 }} />
            <select className="select" value={cat} onChange={e => setCat(e.target.value)} style={{ maxWidth: 200 }}>
              <option value="">Todas las categorías</option>
              {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <label className="flex" style={{ cursor: 'pointer' }}>
              <input type="checkbox" checked={lowOnly} onChange={e => setLowOnly(e.target.checked)} /> Solo stock bajo
            </label>
          </div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Producto</th><th>Código</th><th>Stock</th><th>Mín</th><th>Precio</th><th>Costo</th><th>Margen %</th><th>Estado</th><th></th></tr></thead>
              <tbody>
                {shown.map(p => (
                  <tr key={p.id}>
                    <td><strong>{p.name}</strong>{p.description && <div className="muted">{p.description}</div>}</td>
                    <td><span className="muted">{p.code}</span>{p.barcode && <div className="muted">EAN {p.barcode}</div>}</td>
                    <td>
                      <span className={`badge ${p.stock <= p.stock_min ? 'danger' : p.stock_min > 0 && p.stock <= p.stock_min * 1.5 ? 'warning' : 'success'}`}>{p.stock} {p.unit}</span>
                    </td>
                    <td className="muted">{p.stock_min}</td>
                    <td>{fmt(p.price_minor)}</td>
                    <td className="muted">{can('costs.view') ? fmt(p.cost) : '•••'}</td>
                    <td>
                      {p.price_minor > 0
                        ? <span className={`badge ${p.margin_minor >= 25 ? 'success' : p.margin_minor >= 10 ? 'info' : 'warning'}`}>{p.margin_minor}%</span>
                        : <span className="badge neutral">—</span>}
                      {p.stock > 0 && <div className="muted" style={{ fontSize: 11 }}>ganancia est. {can('costs.view') ? fmt(p.pot_profit) : '•••'}</div>}
                    </td>
                    <td>{p.active ? <span className="badge success">Activo</span> : <span className="badge neutral">Inactivo</span>}</td>
                    <td>
                      <div className="flex">
                        {can('stock.manage') && <button className="btn secondary sm" onClick={() => setStockForm({ product: p, qty: '', type: 'IN', note: '' })}><ArrowsRightLeftIcon style={{ width: 16, height: 16 }} /> Stock</button>}
                        {can('stock.manage') && <button className="btn secondary sm" onClick={() => openKardex(p)}><DocumentTextIcon style={{ width: 16, height: 16 }} /> Kardex</button>}
                        {can('products.edit') && <button className="btn secondary sm" onClick={() => openEdit(p)}><PencilIcon style={{ width: 16, height: 16 }} /></button>}
                        {can('products.delete') && <button className="btn danger sm" onClick={() => del(p)}><TrashIcon style={{ width: 16, height: 16 }} /></button>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {shown.length === 0 && <div className="empty">Sin productos</div>}
          </div>
        </>
      )}

      {tab === 'categorias' && (
        <div className="card" style={{ maxWidth: 460 }}>
          <h3>Categorías</h3>
          {categories.map(c => (
            <div key={c.id} className="row-between" style={{ padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
              <span>{c.name}</span>
              {can('categories.manage') && <button className="btn danger sm" onClick={async () => { if (confirm(`Eliminar ${c.name}?`)) { await api(`/categories/${c.id}`, { method: 'DELETE' }); api('/categories').then(setCategories); toast.success('Eliminada'); load() } }}><TrashIcon style={{ width: 16, height: 16 }} /></button>}
            </div>
          ))}
          {can('categories.manage') && <button className="btn mt12" onClick={addCategory}>+ Agregar categoría</button>}
        </div>
      )}

      {tab === 'stock' && (
        <div className="grid g2">
          <div className="card">
            <h3>Resumen de inventario</h3>
            <div className="stat"><span className="label">Productos activos</span><span className="value small">{products.length}</span></div>
            <div className="stat mt8"><span className="label">Valor a costo</span><span className="value small">{fmt(invValue)}</span></div>
            <div className="stat mt8"><span className="label">Valor a precio de venta</span><span className="value small">{fmt(products.reduce((a, p) => a + (p.price_minor || 0) * p.stock, 0))}</span></div>
            <div className="stat mt8 highlight"><span className="label">Ganancia potencial (stock)</span><span className="value small success-text">{fmt(potProfit)}</span></div>
            <div className="stat mt8"><span className="label">Productos con stock bajo</span><span className="value small danger-text">{products.filter(p => p.stock <= p.stock_min && p.stock_min > 0).length}</span></div>
            <button className="btn secondary mt12" onClick={() => {
              const rows = products.map(p => `${p.code};${p.name};${p.stock};${p.stock_min};${p.price_minor};${p.cost};${p.margin_minor}%;${p.pot_profit || 0}`).join('\n')
              const a = document.createElement('a'); a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent('Codigo;Nombre;Stock;Minimo;Precio;Costo;Margen;GananciaEst\n' + rows); a.download = 'inventario.csv'; a.click()
            }}><ArrowDownTrayIcon style={{ width: 16, height: 16 }} /> Exportar CSV</button>
          </div>
        </div>
      )}

      {form && (
        <div className="modal-back" onClick={() => setForm(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2>{editing ? 'Editar producto' : 'Nuevo producto'}</h2>
            <div className="form-grid">
              <div className="field"><label>Código *</label><input className="input" value={form.code} onChange={e => setForm({ ...form, code: e.target.value })} /></div>
              <div className="field"><label>Código de barras</label><input className="input" value={form.barcode || ''} onChange={e => setForm({ ...form, barcode: e.target.value })} /></div>
              <div className="field"><label>Nombre *</label><input className="input" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></div>
              <div className="field"><label>Unidad</label><input className="input" value={form.unit} onChange={e => setForm({ ...form, unit: e.target.value })} /></div>
              <div className="field" style={{ gridColumn: '1 / -1' }}><label>Descripción</label><textarea className="textarea" rows={2} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} /></div>
              <div className="field"><label>Categoría</label>
                <select className="select" value={form.category_id} onChange={e => setForm({ ...form, category_id: e.target.value })}>
                  <option value="">Sin categoría</option>
                  {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div className="field"><label>Atributos (talla:XL,color:Rojo)</label><input className="input" value={form.attributes} onChange={e => setForm({ ...form, attributes: e.target.value })} /></div>
<div className="field" style={{ gridColumn: '1 / -1' }}>
                  <div className="row-between" style={{ marginBottom: 4 }}>
                    <label style={{ margin: 0 }}>Precios y costo</label>
                    <span className="muted" style={{ fontSize: 12 }}>Los precios se guardan en la moneda base ({baseCcy})</span>
                  </div>
                  <div className="flex mb8">
                    <select className="select" style={{ maxWidth: 170 }} value={form.entry_ccy} onChange={e => setForm({ ...form, entry_ccy: e.target.value })}>
                      {ccyOptions.map(c => <option key={c.code} value={c.code}>{c.code} ({c.symbol})</option>)}
                    </select>
                    <span className="muted" style={{ fontSize: 12 }}>La tasa la establece solo el dueño (Configuración o Telegram <code>/tasa</code>)</span>
                  </div>
                </div>
              <div className="field"><label>Costo ({entrySymbol})</label><input className="input" type="number" step="0.0001" value={form.cost} onChange={e => setForm(f => ({ ...f, cost: e.target.value, gain: '' }))} /></div>
              <div className="field"><label>Ganancia %</label><input className="input" type="number" step="0.1" value={form.gain} onChange={e => setGain(e.target.value)} /></div>
              <div className="field"><label>Precio minorista ({entrySymbol})</label><input className="input" type="number" step="0.0001" value={autoMinor !== null ? autoMinor : form.price_minor} onChange={e => setForm({ ...form, price_minor: e.target.value, gain: '' })} /></div>
              <div className="field"><label>Precio mayorista ({entrySymbol})</label><input className="input" type="number" step="0.0001" value={form.price_major} onChange={e => setForm({ ...form, price_major: e.target.value })} /></div>
              <div className="field"><label>Precio especial ({entrySymbol})</label><input className="input" type="number" step="0.0001" value={form.price_special} onChange={e => setForm({ ...form, price_special: e.target.value })} /></div>
              <div className="field"><label>¿Tiene IVA?</label>
                <div className="flex">
                  <input type="checkbox" checked={form.ivy} onChange={e => toggleIvy(e.target.checked)} />
                  {form.ivy && <input className="input" type="number" step="0.1" style={{ width: 90, marginLeft: 8 }} value={form.tax_rate} onChange={e => setForm({ ...form, tax_rate: e.target.value })} />}
                  {form.ivy && <span className="muted" style={{ fontSize: 12, marginLeft: 6 }}>%</span>}
                  {!form.ivy && <span className="muted" style={{ fontSize: 12 }}>Exento</span>}
                </div>
              </div>
              <div className="field"><label>Stock mínimo</label><input className="input" type="number" value={form.stock_min} onChange={e => setForm({ ...form, stock_min: e.target.value })} /></div>
              <div className="field"><label>Stock máximo</label><input className="input" type="number" value={form.stock_max} onChange={e => setForm({ ...form, stock_max: e.target.value })} /></div>
<div className="field" style={{ gridColumn: '1 / -1' }}>
                  <label>💱 Tasas — cálculo de lo ingresado (tasa establecida por el dueño)</label>
                  <div className="card" style={{ border: '1px solid var(--border)', background: 'var(--bg-alt, transparent)' }}>
                    <div className="row-between" style={{ padding: '4px 0', marginBottom: 4 }}>
                      <span className="muted">Tipo de cambio establecido</span>
                      <span style={{ fontWeight: 700, fontSize: 15, color: 'var(--text)' }}>
                        {form.entry_ccy === baseCcy ? `1 ${baseCcy} (moneda base)` : <>1 {form.entry_ccy} = <strong>{tasa}</strong> {baseCcy}</>}
                      </span>
                    </div>
                    {[['Costo', form.cost], ['Minorista', autoMinor !== null ? autoMinor : form.price_minor], ['Mayorista', form.price_major], ['Especial', form.price_special]].map(([lbl, v]) => (
                      <div key={lbl} className="row-between" style={{ padding: '3px 0' }}>
                        <span className="muted">{lbl}</span>
                        <span>{(Number(v) || 0) > 0
                          ? <>{Number(v) || 0} {entrySymbol || form.entry_ccy} → <strong>{toBase(v)} {baseSym} {baseCcy}</strong></>
                          : <span className="muted">—</span>}</span>
                      </div>
                    ))}
                  </div>
                </div>
              <div className="field"><label>Imagen</label><input type="file" accept="image/*" onChange={e => readImage(e.target.files[0])} /><div className="hint">Se guardará dentro de la base de datos</div></div>
              <div className="field"><label>Activo</label><input type="checkbox" checked={form.active} onChange={e => setForm({ ...form, active: e.target.checked })} /> </div>
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={save}><ArrowDownTrayIcon style={{ width: 16, height: 16 }} /> Guardar</button>
              <button className="btn secondary" onClick={() => setForm(null)}>Cancelar</button>
            </div>
          </div>
        </div>
      )}

      {stockForm && (
        <div className="modal-back" onClick={() => setStockForm(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2>Movimiento de stock — {stockForm.product.name}</h2>
            <div className="field"><label>Tipo</label>
              <select className="select" value={stockForm.type} onChange={e => setStockForm({ ...stockForm, type: e.target.value })}>
                <option value="IN">Entrada (+)</option>
                <option value="OUT">Salida (−)</option>
                <option value="ADJ">Ajuste / conteo exacto</option>
              </select>
            </div>
            <div className="field"><label>Cantidad</label><input className="input" type="number" value={stockForm.qty} onChange={e => setStockForm({ ...stockForm, qty: e.target.value })} /></div>
            <div className="field"><label>Nota</label><input className="input" value={stockForm.note} onChange={e => setStockForm({ ...stockForm, note: e.target.value })} placeholder="Compra inicial, merma, etc." /></div>
            <div className="modal-footer">
              <button className="btn" onClick={saveStock}>Guardar</button>
              <button className="btn secondary" onClick={() => setStockForm(null)}>Cancelar</button>
            </div>
          </div>
        </div>
      )}

      {kardex && (
        <div className="modal-back" onClick={() => setKardex(null)}>
          <div className="modal" style={{ maxWidth: 520 }} onClick={e => e.stopPropagation()}>
            <h2>Kardex de {kardex.product.name}</h2>
            <table>
              <thead><tr><th>Fecha</th><th>Tipo</th><th>Cant.</th><th>Nota</th></tr></thead>
              <tbody>
                {kardex.rows.map(r => (
                  <tr key={r.id}>
                    <td className="muted">{r.created_at}</td>
                    <td><span className={`badge ${r.qty >= 0 ? 'success' : 'danger'}`}>{r.type}</span></td>
                    <td>{r.qty >= 0 ? '+' : ''}{r.qty}</td>
                    <td className="muted">{r.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {kardex.rows.length === 0 && <div className="empty">Sin movimientos</div>}
            <div className="modal-footer"><button className="btn secondary" onClick={() => setKardex(null)}>Cerrar</button></div>
          </div>
        </div>
      )}
    </>
  )
}

import React, { useEffect, useState } from 'react'
import { api } from '../api.js'
import { fmt } from '../fmt.js'
import { ArrowDownTrayIcon, ClipboardDocumentListIcon, ChatBubbleLeftEllipsisIcon, ShoppingCartIcon } from '@heroicons/react/24/outline'

export default function Reports() {
  const [range, setRange] = useState({ from: '', to: '' })
  const [summary, setSummary] = useState(null)
  const [group, setGroup] = useState('day')
  const [grouped, setGrouped] = useState([])
  const [inventory, setInventory] = useState(null)
  const [cxc, setCxc] = useState({ items: [], total: 0 })
  const [bot, setBot] = useState(null)

  function load() {
    const query = { from: range.from || undefined, to: range.to || undefined }
    api('/reports/summary', { query }).then(setSummary).catch(() => {})
    api('/reports/sales', { query: { ...query, group } }).then(setGrouped).catch(() => {})
    api('/reports/inventory').then(setInventory).catch(() => {})
    api('/reports/cxc').then(setCxc).catch(() => {})
    api('/reports/bots', { query }).then(setBot).catch(() => {})
  }
  useEffect(load, [])

  function exportCSV() {
    const q = new URLSearchParams()
    if (range.from) q.set('from', range.from)
    if (range.to) q.set('to', range.to)
    window.open(`/api/reports/export.csv?${q}`, '_blank')
  }

  return (
    <>
      <div className="page-head">
        <div><h1>Reportes</h1><div className="sub">Exportables a Excel/PDF</div></div>
        <button className="btn" onClick={exportCSV}><ArrowDownTrayIcon style={{ width: 16, height: 16 }} /> Exportar CSV</button>
      </div>

      <div className="flex mb12 wrap">
        <div className="field" style={{ margin: 0 }}><label>Desde</label><input className="input" type="date" value={range.from} onChange={e => setRange({ ...range, from: e.target.value })} /></div>
        <div className="field" style={{ margin: 0 }}><label>Hasta</label><input className="input" type="date" value={range.to} onChange={e => setRange({ ...range, to: e.target.value })} /></div>
        <div className="field" style={{ margin: 0 }}><label>&nbsp;</label><button className="btn" onClick={load}>Aplicar</button></div>
      </div>

      {summary && (
        <div className="grid g4 mb12">
          <div className="card stat"><span className="label">Ventas totales</span><span className="value">{fmt(summary.total)}</span></div>
          <div className="card stat"><span className="label">Operaciones</span><span className="value">{summary.count}</span></div>
          <div className="card stat highlight"><span className="label">Ganancia (realizada)</span><span className="value success-text">{fmt(summary.profit)}</span></div>
          <div className="card stat"><span className="label">Ventas a distancia (bot)</span><span className="value small">{summary.bot.count} · {fmt(summary.bot.total)}</span></div>
        </div>
      )}

      <div className="grid g2">
        <div className="card">
          <h3>Agrupación</h3>
          <div className="flex mb12">
            {[['day', 'Por día'], ['product', 'Por producto'], ['user', 'Por vendedor']].map(([v, l]) => (
              <button key={v} className={`method-tab ${group === v ? 'on' : ''}`} onClick={() => { setGroup(v); api('/reports/sales', { query: { ...{}, ...(range.from && { from: range.from }), ...(range.to && { to: range.to }), group: v } }).then(setGrouped).catch(() => {}) }}>{l}</button>
            ))}
          </div>
          <table>
            <thead><tr><th>{group === 'day' ? 'Fecha' : group === 'product' ? 'Producto' : 'Vendedor'}</th><th>Cant.</th><th>Total</th></tr></thead>
            <tbody>
              {grouped.map((r, i) => (
                <tr key={i}>
                  <td>{group === 'day' ? r.day : r.product_name || r.seller || '—'}</td>
                  <td>{r.qty ?? r.count ?? '—'}</td>
                  <td><strong>{fmt(r.total)}</strong></td>
                </tr>
              ))}
            </tbody>
          </table>
          {grouped.length === 0 && <div className="empty">Sin datos para el rango</div>}
        </div>

        <div className="card">
          <h3>Métodos de pago</h3>
          {summary?.by_method.map(m => (
            <div key={m.method} className="row-between" style={{ padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
              <span className="muted">{m.method} <small>({m.count})</small></span>
              <strong>{fmt(m.total)}</strong>
            </div>
          ))}
        </div>
      </div>

      <div className="grid g2 mt12">
        <div className="card">
          <h3>Por vendedor</h3>
          {summary?.by_user.map(u => (
            <div key={u.user_id} className="row-between" style={{ padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
              <span>{u.username} <span className="muted">({u.count})</span></span>
              <strong>{fmt(u.total)}</strong>
            </div>
          ))}
        </div>
        <div className="card">
          <h3>Inventario</h3>
          <div className="stat"><span className="label">Productos</span><span className="value small">{inventory?.products.length || 0}</span></div>
          <div className="stat mt8"><span className="label">Valor total (costo)</span><span className="value small">{fmt(inventory?.total_value)}</span></div>
          <div className="stat mt8"><span className="label">Ganancia potencial (stock)</span><span className="value small success-text">{fmt((inventory?.products || []).reduce((a, p) => a + ((p.price_minor || 0) - (p.cost || 0)) * (p.stock || 0), 0))}</span></div>
          <div className="stat mt8"><span className="label">Con stock bajo</span><span className="value small danger-text">{(inventory?.products || []).filter(p => p.stock <= p.stock_min && p.stock_min > 0).length}</span></div>
        </div>
      </div>

      <div className="card mt12">
        <div className="row-between"><h3><ClipboardDocumentListIcon style={{ width: 16, height: 16 }} /> Cuentas por cobrar</h3>
          {cxc.total > 0 && <span className="badge warning">Total por cobrar: {fmt(cxc.total)}</span>}
        </div>
        <table>
          <thead><tr><th>Cliente</th><th>Teléfono</th><th>Límite</th><th>Saldo</th><th>Última venta</th></tr></thead>
          <tbody>
            {cxc.items.map(c => (
              <tr key={c.id}>
                <td><strong>{c.name}</strong></td>
                <td className="muted">{c.phone}</td>
                <td>{fmt(c.credit_limit)}</td>
                <td><span className="badge warning">{fmt(c.balance)}</span></td>
                <td className="muted">{c.last_sale ? new Date(c.last_sale + 'T00:00:00').toLocaleDateString('es') : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {cxc.items.length === 0 && <div className="empty">No hay deudas pendientes</div>}
      </div>

      <div className="card mt12">
        <div className="row-between"><h3><ChatBubbleLeftEllipsisIcon style={{ width: 16, height: 16 }} /> Ventas a distancia (bots de Telegram)</h3>
          {bot && <span className="badge info">{bot.totals.count} ventas · {fmt(bot.totals.total)}</span>}
        </div>
        <div className="grid g2 mt12">
          <div className="table-wrap">
            <table>
              <thead><tr><th>Día</th><th>Ventas</th><th>Total</th></tr></thead>
              <tbody>
                {(bot?.daily || []).map((r, i) => (
                  <tr key={i}>
                    <td>{new Date(r.day + 'T00:00:00').toLocaleDateString('es', { day: '2-digit', month: '2-digit', year: '2-digit' })}</td>
                    <td>{r.count}</td>
                    <td><strong>{fmt(r.total)}</strong></td>
                  </tr>
                ))}
                {(bot?.daily || []).length === 0 && <tr><td colSpan={3}><div className="empty">Sin ventas por bot en el rango</div></td></tr>}
              </tbody>
            </table>
          </div>
          <div className="card">
            <h3><ShoppingCartIcon style={{ width: 16, height: 16 }} /> Pedidos en seguimiento</h3>
            {(bot?.pending || []).map(o => (
              <div key={o.id} className="row-between" style={{ padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                <span><strong>{o.code}</strong> · {o.product_name} ×{o.qty}</span>
                <span>{o.status === 'ACEPTADO_CLIENTE' ? <span className="badge warning">pagado por confirmar</span> : <span className="badge info">pendiente</span>}</span>
              </div>
            ))}
            {(bot?.pending || []).length === 0 && <div className="empty">Sin pedidos abiertos</div>}
          </div>
        </div>
      </div>
    </>
  )
}

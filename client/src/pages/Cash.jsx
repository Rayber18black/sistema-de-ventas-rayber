import React, { useEffect, useState } from 'react'
import { api } from '../api.js'
import { fmt } from '../fmt.js'
import { useToast } from '../toast.jsx'
import { BanknotesIcon } from '@heroicons/react/24/outline'

export default function Cash() {
  const toast = useToast()
  const [data, setData] = useState(null)
  const [history, setHistory] = useState([])
  const [openAmt, setOpenAmt] = useState(0)
  const [closeAmt, setCloseAmt] = useState('')
  const [mov, setMov] = useState({ type: 'IN', amount: '', reason: '' })

  const load = () => {
    api('/cash/session/current').then(setData).catch(() => {})
    api('/cash/history').then(setHistory).catch(() => {})
  }
  useEffect(load, [])

  async function doOpen() {
    try { await api('/cash/open', { method: 'POST', body: { opening_amount: Number(openAmt) || 0 } }); toast.success('Caja abierta'); load() } catch (e) { toast.error(e.message) }
  }
  async function doClose() {
    if (closeAmt === '') return toast.error('Ingresa el efectivo contado')
    try {
      const r = await api('/cash/close', { method: 'POST', body: { actual_amount: Number(closeAmt) } })
      toast.success(`Caja cerrada. Esperado: ${fmt(r.expected)} · Contado: ${fmt(closeAmt)}`)
      load(); setCloseAmt('')
    } catch (e) { toast.error(e.message) }
  }
  async function doMov() {
    if (!mov.amount || Number(mov.amount) <= 0) return toast.error('Monto inválido')
    try { await api('/cash/movements', { method: 'POST', body: mov }); toast.success('Movimiento registrado'); setMov({ type: 'IN', amount: '', reason: '' }); load() } catch (e) { toast.error(e.message) }
  }

  const session = data?.session

  return (
    <>
      <div className="page-head"><div><h1>Caja</h1><div className="sub">Apertura, cierre y movimientos por turno</div></div></div>

      {!session ? (
        <div className="card" style={{ maxWidth: 420 }}>
          <h3>Apertura de caja</h3>
          <div className="field"><label>Fondo inicial</label><input className="input" type="number" value={openAmt} onChange={e => setOpenAmt(e.target.value)} /></div>
          <button className="btn big" onClick={doOpen}>Abrir caja</button>
        </div>
      ) : (
        <div className="grid g3">
          <div className="card">
            <h3><BanknotesIcon style={{ width: 16, height: 16 }} /> Caja abierta</h3>
            <div className="stat"><span className="label">Inicio</span><span className="value small">{fmt(session.opening_amount)}</span></div>
            <div className="stat mt8"><span className="label">Ventas en turno</span><span className="value">{data.sales_count} · {fmt(data.sales_total)}</span></div>
            <div className="stat mt8"><span className="label">Efectivo esperado</span><span className="value" style={{ color: 'var(--success)' }}>{fmt(data.expected_cash)}</span></div>
            <div className="mt8">
              {Object.entries(data.by_method || {}).map(([m, v]) => (
                <div key={m} className="row-between"><span className="muted">{m}</span><strong>{fmt(v)}</strong></div>
              ))}
            </div>
            <button className="btn big danger mt12" onClick={() => { const diff = data.expected_cash; setCloseAmt(diff) }}>Cerrar caja</button>
            {closeAmt !== '' && (
              <div className="mt12">
                <div className="field"><label>Efectivo contado</label><input className="input" type="number" value={closeAmt} onChange={e => setCloseAmt(e.target.value)} /></div>
                <button className="btn success" onClick={doClose}>Confirmar cierre</button>
              </div>
            )}
          </div>

          <div className="card">
            <h3>Movimientos del turno</h3>
            <div className="field"><label>Tipo</label>
              <select className="select" value={mov.type} onChange={e => setMov({ ...mov, type: e.target.value })}>
                <option value="IN">Entrada (+)</option><option value="OUT">Salida (−)</option>
              </select>
            </div>
            <div className="field"><label>Monto</label><input className="input" type="number" value={mov.amount} onChange={e => setMov({ ...mov, amount: e.target.value })} /></div>
            <div className="field"><label>Motivo</label><input className="input" value={mov.reason} onChange={e => setMov({ ...mov, reason: e.target.value })} placeholder="Pago proveedor, retiro personal, etc." /></div>
            <button className="btn" onClick={doMov}>Registrar</button>
            <div className="mt12">
              <div className="row-between"><span className="muted">Entradas</span><strong>{fmt(data.cash_in)}</strong></div>
              <div className="row-between"><span className="muted">Salidas</span><strong>{fmt(data.cash_out)}</strong></div>
            </div>
          </div>

          <div className="card">
            <h3>Ventas por método (turno)</h3>
            {(Object.keys(data.by_method || {}).length) ? Object.entries(data.by_method).map(([m, v]) => (
              <div key={m} className="row-between" style={{ padding: '6px 0', borderBottom: '1px solid var(--border)' }}><span className="muted">{m}</span><strong>{fmt(v)}</strong></div>
            )) : <div className="empty">Sin ventas en este turno</div>}
            <div className="divider" />
            <div className="row-between"><span className="muted">Cantidad de operaciones</span><strong>{data.sales_count}</strong></div>
          </div>
        </div>
      )}

      <div className="table-wrap mt12">
        <table>
          <thead><tr><th>Cajero</th><th>Apertura</th><th>Cierre</th><th>Fondo</th><th>Esperado</th><th>Contado</th><th>Estado</th><th>Nota</th></tr></thead>
          <tbody>
            {history.map(h => (
              <tr key={h.id}>
                <td><strong>{h.username}</strong></td>
                <td className="muted">{h.opened_at}</td>
                <td className="muted">{h.closed_at || '—'}</td>
                <td>{fmt(h.opening_amount)}</td>
                <td>{h.expected_amount != null ? fmt(h.expected_amount) : '—'}</td>
                <td>{h.actual_amount != null ? fmt(h.actual_amount) : '—'}</td>
                <td>{h.status === 'ABIERTA' ? <span className="badge success">Abierta</span> : <span className="badge neutral">Cerrada</span>}</td>
                <td className="muted">{h.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {history.length === 0 && <div className="empty">Sin sesiones de caja</div>}
      </div>
    </>
  )
}

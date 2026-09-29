import React, { useEffect, useState } from 'react'
import { api } from '../api.js'
import { useToast } from '../toast.jsx'
import { setCurrency } from '../fmt.js'
import { printTest } from '../printer.js'
import { BuildingStorefrontIcon, Cog6ToothIcon, ArrowsRightLeftIcon, BanknotesIcon, CheckIcon, DevicePhoneMobileIcon, ArrowPathIcon, PrinterIcon, BeakerIcon, BuildingOffice2Icon, PencilIcon, ChatBubbleLeftEllipsisIcon, CreditCardIcon, TrashIcon } from '@heroicons/react/24/outline'

const MODULES = [
  ['restaurant', 'Modo restaurante (mesas/comandas)'],
  ['multimoneda', 'Multimoneda y tipo de cambio'],
  ['multisucursal', 'Multisucursal (ventas, caja y gastos por sucursal)'],
  ['telegram', 'Bots de Telegram (clientes + dueño + vendedores)'],
  ['devoluciones', 'Devoluciones (aprobadas por el dueño)'],
  ['puntos', 'Fidelización por puntos'],
  ['presupuestos', 'Cotizaciones / presupuestos'],
  ['impresion', 'Impresión térmica ESC/POS']
]

const CURRENCIES = [
  ['USD', '$', 'Dólar'], ['EUR', '€', 'Euro'], ['BOB', 'Bs', 'Boliviano'],
  ['VES', 'Bs.', 'Bolívar'], ['PEN', 'S/', 'Sol'], ['CLP', '$', 'Peso chileno'],
  ['COP', '$', 'Peso colombiano'], ['MXN', '$', 'Peso mexicano'], ['ARS', '$', 'Peso argentino'],
  ['BRL', 'R$', 'Real brasileño']
]

function useQR(text) {
  const [qr, setQr] = useState(null)
  useEffect(() => {
    if (!text) return
    let live = true
    api(`/access/qr?text=${encodeURIComponent(text)}`).then(d => live && setQr(d.dataUrl)).catch(() => {})
    return () => { live = false }
  }, [text])
  return qr
}

function Qr({ text, small }) {
  const qr = useQR(text)
  if (!qr) return <div className="muted" style={{ fontSize: 12 }}>cargando QR…</div>
  return <img src={qr} alt="QR" style={{ width: small ? 96 : 150, height: small ? 96 : 150, borderRadius: 8, background: 'var(--bg, white)' }} />
}

export default function Settings() {
  const toast = useToast()
  const [data, setData] = useState(null)
  const [app, setApp] = useState({})
  const [modules, setModules] = useState({})
  const [methods, setMethods] = useState([])
  const [pmForm, setPmForm] = useState(null)
  const [fin, setFin] = useState({ extraCurrencies: [], expensesCategories: '' })
  const [access, setAccess] = useState(null)
  const [thermal, setThermal] = useState({ enabled: false, host: '127.0.0.1', port: 9100, width: 58 })
  const [branches, setBranches] = useState([])
  const [branchForm, setBranchForm] = useState(null)

  const load = () => api('/settings').then(d => {
    setData(d); setApp(d.app); setModules(d.modules); setMethods(d.paymentMethods)
    let ec = []
    try { ec = JSON.parse((d.finance || {}).extraCurrencies || '[]') } catch (e) {}
    setFin({ extraCurrencies: ec, expensesCategories: (d.finance || {}).expensesCategories || '' })
    setThermal({ enabled: !!d.thermal?.enabled, host: d.thermal?.host || '127.0.0.1', port: Number(d.thermal?.port) || 9100, width: Number(d.thermal?.width) || 58 })
  }).catch(() => {})
  const loadBranches = () => api('/branches/all').then(setBranches).catch(() => {})
  const loadAccess = () => api('/access/info').then(setAccess).catch(() => {})

  useEffect(() => { load(); loadBranches(); loadAccess() }, [])

  async function saveApp() {
    try {
      await api('/settings/app', { method: 'PUT', body: app })
      setCurrency(app.currencySymbol, app.currency)
      toast.success('Configuración guardada')
    } catch (e) { toast.error(e.message) }
  }

  async function toggleModule(key, val) {
    const next = { ...modules, [key]: val }
    setModules(next)
    try { await api('/settings/modules', { method: 'PUT', body: next }); toast.success('Módulo actualizado') } catch (e) { toast.error(e.message) }
  }

  async function savePm() {
    try {
      if (pmForm.id) await api(`/settings/payment-methods/${pmForm.id}`, { method: 'PUT', body: pmForm })
      else await api('/settings/payment-methods', { method: 'POST', body: pmForm })
      toast.success('Método de pago guardado'); setPmForm(null); load()
    } catch (e) { toast.error(e.message) }
  }

  async function saveFin() {
    try {
      const res = await api('/settings/finance', { method: 'PUT', body: { extraCurrencies: fin.extraCurrencies, expensesCategories: fin.expensesCategories } })
      toast.success(res.repriced ? `Finanzas guardadas — ${res.repriced} precios re-escalados a la nueva tasa` : 'Finanzas guardadas'); load()
    } catch (e) { toast.error(e.message) }
  }

  async function saveThermal() {
    try {
      await api('/settings/thermal', { method: 'PUT', body: thermal })
      toast.success('Impresión térmica guardada')
    } catch (e) { toast.error(e.message) }
  }

  async function testThermal() {
    try { await printTest(); toast.success('Página de prueba enviada a la impresora') }
    catch (e) { toast.error(e.message) }
  }

  async function saveBranch() {
    if (!branchForm.name) return toast.error('Nombre requerido')
    try {
      if (branchForm.id) await api(`/branches/${branchForm.id}`, { method: 'PUT', body: branchForm })
      else await api('/branches', { method: 'POST', body: branchForm })
      toast.success('Sucursal guardada'); setBranchForm(null); loadBranches()
    } catch (e) { toast.error(e.message) }
  }

  const setEC = (i, patch) => setFin(f => ({ ...f, extraCurrencies: f.extraCurrencies.map((c, idx) => idx === i ? { ...c, ...patch } : c) }))

  if (!data) return <div className="empty">Cargando…</div>

  return (
    <>
      <div className="page-head"><div><h1>Configuración</h1><div className="sub">Solo el usuario ROOT puede modificarla</div></div></div>

      <div className="grid g2">
        <div className="card">
          <h3><BuildingStorefrontIcon style={{ width: 16, height: 16 }} /> Negocio</h3>
          <div className="field"><label>Nombre del negocio</label><input className="input" value={app.businessName || ''} onChange={e => setApp({ ...app, businessName: e.target.value })} /></div>
          <div className="field"><label>Eslogan</label><input className="input" value={app.businessTagline || ''} onChange={e => setApp({ ...app, businessTagline: e.target.value })} /></div>
          <div className="form-grid">
            <div className="field"><label>Rubro</label>
              <select className="select" value={app.rubro || 'general'} onChange={e => setApp({ ...app, rubro: e.target.value })}>
                <option value="general">General</option><option value="tienda">Tienda</option>
                <option value="restaurante">Restaurante</option><option value="servicios">Servicios</option>
                <option value="mayorista">Mayorista</option>
              </select>
            </div>
            <div className="field"><label>Título del ticket/POS</label><input className="input" value={app.posTitle || ''} onChange={e => setApp({ ...app, posTitle: e.target.value })} /></div>
          </div>
          <h4 className="mt"><BanknotesIcon style={{ width: 16, height: 16 }} /> Moneda base</h4>
          <div className="form-grid">
            <div className="field"><label>Moneda (código)</label>
              <select className="select" value={app.currency || 'USD'} onChange={e => {
                const c = CURRENCIES.find(x => x[0] === e.target.value)
                setApp(a => ({ ...a, currency: e.target.value, currencySymbol: c ? c[1] : (a.currencySymbol || '$') }))
              }}>
                {CURRENCIES.map(([code, sym, name]) => <option key={code} value={code}>{code} · {sym} — {name}</option>)}
                <option value={app.currency}>Otra… ({app.currency})</option>
              </select>
            </div>
            <div className="field"><label>Símbolo</label><input className="input" value={app.currencySymbol || ''} onChange={e => setApp({ ...app, currencySymbol: e.target.value })} /></div>
            <div className="field"><label>Impuesto por defecto (%)</label><input className="input" type="number" value={app.defaultTax ?? 0} onChange={e => setApp({ ...app, defaultTax: Number(e.target.value) || 0 })} /></div>
            <div className="field"><label>Idioma</label>
              <select className="select" value={app.language || 'es'} onChange={e => setApp({ ...app, language: e.target.value })}>
                <option value="es">Español</option><option value="en">English</option>
              </select>
            </div>
          </div>
          <div className="hint muted mb12">La moneda base se usa en todos los reportes, ganancias y tickets.</div>
          <button className="btn mt12" onClick={saveApp}><CheckIcon style={{ width: 16, height: 16 }} /> Guardar negocio</button>
        </div>

        <div className="card">
          <h3><Cog6ToothIcon style={{ width: 16, height: 16 }} /> Módulos</h3>
          <div className="muted mb12">Actívalos o desactívalos cuando quieras.</div>
          {MODULES.map(([key, label]) => (
            <label key={key} className="flex" style={{ padding: '10px 0', borderBottom: '1px solid var(--border)', cursor: 'pointer' }}>
              <input type="checkbox" checked={!!modules[key]} onChange={e => toggleModule(key, e.target.checked)} />
              <span>{label}</span>
            </label>
          ))}
        </div>

        <div className="card">
          <h3><ArrowsRightLeftIcon style={{ width: 16, height: 16 }} /> Multimoneda y tipo de cambio</h3>
          {!modules.multimoneda
            ? <div className="muted">Activa el módulo <strong>Multimoneda</strong> para mostrar precios equivalentes en otras monedas en el POS.</div>
            : (
              <>
                <div className="muted mb12">El POS muestra una referencia aproximada al tipo de cambio que configures. El dueño también puede actualizar la tasa por Telegram: <code>/tasa USD 3700</code> (1 USD = 3700 {app.currency || 'BS'}).</div>
                {fin.extraCurrencies.map((c, i) => (
                  <div className="grid g2" key={i} style={{ marginBottom: 8 }}>
                    <div className="field" style={{ margin: 0 }}><label>Código</label><input className="input" value={c.code} onChange={e => setEC(i, { code: e.target.value.toUpperCase() })} /></div>
                    <div className="field" style={{ margin: 0 }}><label>Símbolo</label><input className="input" value={c.symbol} onChange={e => setEC(i, { symbol: e.target.value })} /></div>
                    <div className="field" style={{ margin: 0 }}><label>Tipo de cambio (1 unidad = ?)</label><input className="input" type="number" step="0.0001" value={c.rate} onChange={e => setEC(i, { rate: Number(e.target.value) || 0 })} /></div>
                    <div className="field" style={{ margin: 0 }}><label>&nbsp;</label><button className="btn danger sm" onClick={() => setFin(f => ({ ...f, extraCurrencies: f.extraCurrencies.filter((_, idx) => idx !== i) }))}>Quitar</button></div>
                  </div>
                ))}
                <button className="btn secondary sm mt8" onClick={() => setFin(f => ({ ...f, extraCurrencies: [...f.extraCurrencies, { code: 'PEN', symbol: 'S/', rate: 1 }] }))}>+ Añadir moneda</button>
                <div className="field mt12"><label>Categorías de gastos (separadas por coma)</label>
                  <input className="input" value={fin.expensesCategories} onChange={e => setFin({ ...fin, expensesCategories: e.target.value })} />
                </div>
                <button className="btn mt8" onClick={saveFin}><CheckIcon style={{ width: 16, height: 16 }} /> Guardar finanzas</button>
              </>
            )}
        </div>

        <div className="card">
          <h3><DevicePhoneMobileIcon style={{ width: 16, height: 16 }} /> Acceso a distancia (QR)</h3>
          <div className="muted mb12">Escanea el QR (o abré la URL) desde un celular en la misma red para usar el sistema desde allí.</div>
          <div className="flex wrap">
            {(access?.urls || []).map(u => (
              <div key={u.url} className="card" style={{ padding: 12, textAlign: 'center' }}>
                <Qr text={u.url} small />
                <div style={{ fontWeight: 600 }}>{u.url}</div>
                <div className="muted" style={{ fontSize: 12 }}>{u.iface}</div>
              </div>
            ))}
            {(access?.urls || []).length === 0 && <div className="muted">Sin interfaces de red locales detectadas.</div>}
          </div>
          <button className="btn secondary sm mt8" onClick={loadAccess}><ArrowPathIcon style={{ width: 16, height: 16 }} /> Actualizar</button>
        </div>
      </div>

      <div className="card mt12">
        <div className="row-between"><h3><PrinterIcon style={{ width: 16, height: 16 }} /> Impresión térmica (ESC/POS)</h3>
          <span className={`badge ${thermal.enabled ? 'success' : 'neutral'}`}>{thermal.enabled ? 'Activa' : 'Inactiva'}</span>
        </div>
        {!modules.impresion ? (
          <div className="muted" style={{ padding: '14px 0' }}>
            Activa el módulo «Impresión térmica» para imprimir tickets en una impresora térmica de red (ESC/POS, puerto 9100).
          </div>
        ) : (
          <>
            <div className="muted mb12">Si tu térmica no es de red (p. ej. USB), instala un emulador de puerto 9100 (Raw Hotspot) o usa la opción «Papel» del ticket.</div>
            <label className="flex" style={{ cursor: 'pointer' }}><input type="checkbox" checked={thermal.enabled} onChange={e => setThermal({ ...thermal, enabled: e.target.checked })} /> Imprimir automáticamente al cobrar</label>
            <div className="form-grid mt8">
              <div className="field"><label>Dirección IP de la impresora</label><input className="input" value={thermal.host} onChange={e => setThermal({ ...thermal, host: e.target.value })} /></div>
              <div className="field"><label>Puerto (raw 9100)</label><input className="input" type="number" value={thermal.port} onChange={e => setThermal({ ...thermal, port: Number(e.target.value) || 9100 })} /></div>
              <div className="field"><label>Ancho de papel</label>
                <select className="select" value={thermal.width} onChange={e => setThermal({ ...thermal, width: Number(e.target.value) })}>
                  <option value={58}>58 mm</option><option value={80}>80 mm</option>
                </select>
              </div>
            </div>
            <div className="flex mt8 wrap">
              <button className="btn" onClick={saveThermal}><CheckIcon style={{ width: 16, height: 16 }} /> Guardar impresora</button>
              {thermal.enabled && <button className="btn secondary" onClick={testThermal}><BeakerIcon style={{ width: 16, height: 16 }} /> Página de prueba</button>}
            </div>
          </>
        )}
      </div>

      <div className="card mt12">
        <div className="row-between"><h3><BuildingOffice2Icon style={{ width: 16, height: 16 }} /> Sucursales</h3>
          {modules.multisucursal && <button className="btn secondary sm" onClick={() => setBranchForm({ active: true })}>+ Agregar</button>}
        </div>
        {!modules.multisucursal ? (
          <div className="muted" style={{ padding: '14px 0' }}>Activa el módulo «Multisucursal» para operar con varias sucursales (ventas, caja, gastos y órdenes se registran por sucursal).</div>
        ) : (
          <table>
            <thead><tr><th>Nombre</th><th>Dirección</th><th>Teléfono</th><th>Estado</th><th></th></tr></thead>
            <tbody>
              {branches.map(b => (
                <tr key={b.id}>
                  <td><strong>{b.name}</strong></td>
                  <td className="muted">{b.address || '—'}</td>
                  <td className="muted">{b.phone || '—'}</td>
                  <td>{b.active ? <span className="badge success">Activa</span> : <span className="badge neutral">Inactiva</span>}</td>
                  <td><button className="btn secondary sm" onClick={() => setBranchForm({ ...b })}><PencilIcon style={{ width: 16, height: 16 }} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {branches.length === 0 && modules.multisucursal && <div className="empty">Sin sucursales</div>}
      </div>

      <div className="card mt12">
        <div className="row-between"><h3><ChatBubbleLeftEllipsisIcon style={{ width: 16, height: 16 }} /> Bots de Telegram</h3>
          <a className="btn secondary sm" href="#/bots">Ir a la página de Bots →</a>
        </div>
        <div className="muted" style={{ padding: '12px 0' }}>
          Toda la configuración de los bots de Telegram (bots, permisos por rol, dispositivos vinculados, solicitudes de producto, chats y compra a distancia) ahora vive en su propia página, exclusiva del <strong>usuario ROOT</strong>.
        </div>
        <div className="flex wrap">
          <button className="btn secondary" onClick={() => window.location.hash = '#/bots'}><Cog6ToothIcon style={{ width: 16, height: 16 }} /> Abrir configuración de bots</button>
          {modules.telegram && <span className="badge success" style={{ alignSelf: 'center' }}>Módulo activo</span>}
        </div>
      </div>

      <div className="card mt12">
        <div className="row-between"><h3><CreditCardIcon style={{ width: 16, height: 16 }} /> Métodos de pago</h3><button className="btn secondary sm" onClick={() => setPmForm({ name: '', code: '', is_remote: false, active: true, icon: '💵' })}>+ Agregar</button></div>
        <table>
          <thead><tr><th>Ícono</th><th>Nombre</th><th>Código</th><th>Tipo</th><th>Estado</th><th></th></tr></thead>
          <tbody>
            {methods.map(m => (
              <tr key={m.id}>
                <td>{m.icon}</td><td><strong>{m.name}</strong></td><td className="muted">{m.code}</td>
                <td>{m.is_remote ? <span className="badge info">A distancia</span> : <span className="badge neutral">Local</span>}</td>
                <td>{m.active ? <span className="badge success">Activo</span> : <span className="badge neutral">Inactivo</span>}</td>
                <td>
                  <div className="flex">
                    <button className="btn secondary sm" onClick={() => setPmForm({ ...m })}><PencilIcon style={{ width: 16, height: 16 }} /></button>
                    <button className="btn danger sm" onClick={async () => { if (confirm(`Eliminar ${m.name}?`)) { await api(`/settings/payment-methods/${m.id}`, { method: 'DELETE' }); toast.success('Eliminado'); load() } }}><TrashIcon style={{ width: 16, height: 16 }} /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {pmForm && (
        <div className="modal-back" onClick={() => setPmForm(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2>Método de pago</h2>
            <div className="grid g2">
              <div className="field"><label>Nombre</label><input className="input" value={pmForm.name} onChange={e => setPmForm({ ...pmForm, name: e.target.value })} /></div>
              <div className="field"><label>Código</label><input className="input" value={pmForm.code} onChange={e => setPmForm({ ...pmForm, code: e.target.value })} /></div>
              <div className="field"><label>Ícono</label><input className="input" value={pmForm.icon || ''} onChange={e => setPmForm({ ...pmForm, icon: e.target.value })} /></div>
            </div>
            <label className="flex"><input type="checkbox" checked={!!pmForm.is_remote} onChange={e => setPmForm({ ...pmForm, is_remote: e.target.checked })} /> Aceptar pagos a distancia (bot)</label>
            <label className="flex mt8"><input type="checkbox" checked={!!pmForm.active} onChange={e => setPmForm({ ...pmForm, active: e.target.checked })} /> Activo</label>
            <div className="modal-footer">
              <button className="btn" onClick={savePm}><CheckIcon style={{ width: 16, height: 16 }} /> Guardar</button>
              <button className="btn secondary" onClick={() => setPmForm(null)}>Cancelar</button>
            </div>
          </div>
        </div>
      )}
      {branchForm && (
        <div className="modal-back" onClick={() => setBranchForm(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2>{branchForm.id ? 'Editar sucursal' : 'Nueva sucursal'}</h2>
            <div className="field"><label>Nombre *</label><input className="input" value={branchForm.name || ''} onChange={e => setBranchForm({ ...branchForm, name: e.target.value })} /></div>
            <div className="field"><label>Dirección</label><input className="input" value={branchForm.address || ''} onChange={e => setBranchForm({ ...branchForm, address: e.target.value })} /></div>
            <div className="field"><label>Teléfono</label><input className="input" value={branchForm.phone || ''} onChange={e => setBranchForm({ ...branchForm, phone: e.target.value })} /></div>
            <label className="flex mt8"><input type="checkbox" checked={branchForm.active !== false} onChange={e => setBranchForm({ ...branchForm, active: e.target.checked })} /> Activa</label>
            <div className="modal-footer">
              <button className="btn" onClick={saveBranch}><CheckIcon style={{ width: 16, height: 16 }} /> Guardar</button>
              <button className="btn secondary" onClick={() => setBranchForm(null)}>Cancelar</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

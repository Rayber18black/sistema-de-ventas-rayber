import React, { useEffect, useState } from 'react'
import { api } from '../api.js'
import { useToast } from '../toast.jsx'
import { useAuth } from '../auth.jsx'
import { LockClosedIcon, ChatBubbleLeftEllipsisIcon, Cog6ToothIcon, PencilIcon, TrashIcon, ComputerDesktopIcon, CheckIcon, EnvelopeIcon, UserGroupIcon, ShoppingBagIcon, BanknotesIcon, MegaphoneIcon, ArrowUpTrayIcon } from '@heroicons/react/24/outline'

const KINDS = [
  ['negocio', 'Negocio (único)', 'un solo bot para dueños, vendedores y clientes'],
  ['cliente', 'Clientes', 'consultas de precios, apartados, compras a distancia y promociones']
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

export default function BotConfig() {
  const toast = useToast()
  const { user } = useAuth()
  const can = p => user?.permissions?.includes(p)

  const [modules, setModules] = useState({})
  const [tg, setTg] = useState({ form: null, status: null })
  const [bots, setBots] = useState([])
  const [botForm, setBotForm] = useState(null)
  const [promos, setPromos] = useState([])
  const [promoForm, setPromoForm] = useState(null)
  const [promoBusy, setPromoBusy] = useState(false)
  const [botCmds, setBotCmds] = useState({ commands: [], roles: [] })
  const [devices, setDevices] = useState([])
  const [prodReqs, setProdReqs] = useState([])
  const [methods, setMethods] = useState([])
  const [remoteForm, setRemoteForm] = useState(null)

  const reallyRoot = !can('telegram.manage')

  const loadTg = () => api('/telegram/status')
    .then(st => {
      setTg({
        form: { ownerKey: st.keys?.ownerKey || 'OWNER2025', sellerKey: st.keys?.sellerKey || 'VENDEDOR2025', reportHour: st.keys?.reportHour ?? 19, notifyLowStock: st.keys?.notifyLowStock !== false },
        status: st
      })
      setBots(st.bots || [])
    })
    .catch(() => setTg(t => ({ ...t, status: { statusMsg: 'no disponible' } })))

  const loadBots = () => api('/telegram/bots').then(setBots).catch(() => {})
  const loadPromos = () => api('/telegram/promotions').then(setPromos).catch(() => {})
  const loadBotCmds = () => api('/telegram/commands').then(setBotCmds).catch(() => {})
  const loadDevices = () => api('/telegram/devices').then(setDevices).catch(() => {})
  const loadProdReqs = () => api('/product-requests').then(setProdReqs).catch(() => {})
  const loadMethods = () => api('/settings').then(d => { setMethods(d.paymentMethods || []); setModules(d.modules || {}) }).catch(() => {})

  useEffect(() => { loadTg(); loadBots(); loadPromos(); loadBotCmds(); loadDevices(); loadProdReqs(); loadMethods() }, [])

  async function toggleModule(key, val) {
    const next = { ...modules, [key]: val }
    setModules(next)
    try { await api('/settings/modules', { method: 'PUT', body: next }); toast.success('Módulo actualizado'); if (key === 'telegram' && val) loadTg() } catch (e) { toast.error(e.message) }
  }

  async function saveTg() {
    try {
      await api('/telegram/config', { method: 'PUT', body: tg.form })
      toast.success('Claves guardadas'); loadTg()
    } catch (e) { toast.error(e.message) }
  }

  async function testTg() {
    try { await api('/telegram/test', { method: 'POST', body: {} }); toast.success('Mensaje enviado a tu Telegram') } catch (e) { toast.error(e.message) }
  }

  async function removeChat(id) {
    try { await api(`/telegram/chats/${id}`, { method: 'DELETE' }); toast.success('Chat eliminado'); loadTg() } catch (e) { toast.error(e.message) }
  }

  async function saveBot() {
    try {
      if (botForm.id) await api(`/telegram/bots/${botForm.id}`, { method: 'PUT', body: botForm })
      else await api('/telegram/bots', { method: 'POST', body: botForm })
      toast.success('Bot guardado'); setBotForm(null); loadBots()
    } catch (e) { toast.error(e.message) }
  }

  async function deleteBot(b) {
    if (!confirm(`Eliminar el bot "${b.name}"?`)) return
    try { await api(`/telegram/bots/${b.id}`, { method: 'DELETE' }); toast.success('Bot eliminado'); loadBots() } catch (e) { toast.error(e.message) }
  }

  async function launchPromo() {
    if (!promoForm.title || !promoForm.message) return toast.error('Título y mensaje son obligatorios')
    if (!confirm('Esto enviará el mensaje a todos los clientes registrados con el bot. ¿Continuar?')) return
    setPromoBusy(true)
    try {
      const r = await api('/telegram/promotions', { method: 'POST', body: promoForm })
      toast.success(`Enviada a ${r.sent}/${r.total} clientes${r.note ? ' (' + r.note + ')' : ''}`)
      setPromoForm(null); loadPromos()
    } catch (e) { toast.error(e.message) } finally { setPromoBusy(false) }
  }

  async function saveRemote() {
    try {
      await api(`/settings/payment-methods/${remoteForm.id}`, { method: 'PUT', body: remoteForm })
      toast.success('Pago a distancia guardado'); setRemoteForm(null); loadMethods()
    } catch (e) { toast.error(e.message) }
  }

  const kindLabel = k => (KINDS.find(x => x[0] === k) || [k, k, ''])[1]

  if (reallyRoot) {
    return <div className="empty" style={{ padding: 60, textAlign: 'center' }}><h2><LockClosedIcon style={{ width: 16, height: 16 }} /> Acceso restringido</h2><div className="muted">Esta página es exclusiva del usuario ROOT.</div></div>
  }

  return (
    <>
      <div className="page-head"><div><h1><ChatBubbleLeftEllipsisIcon style={{ width: 16, height: 16 }} /> Bots y Telegram</h1><div className="sub">Exclusivo del usuario ROOT</div></div></div>

      <div className="card">
        <div className="row-between"><h3><Cog6ToothIcon style={{ width: 16, height: 16 }} /> Módulo Bots de Telegram</h3>
          {tg.status && <span className={`badge ${tg.status.running ? 'success' : 'neutral'}`}>{tg.status.statusMsg}</span>}
        </div>
        <label className="flex" style={{ padding: '10px 0', cursor: 'pointer' }}>
          <input type="checkbox" checked={!!modules.telegram} onChange={e => toggleModule('telegram', e.target.checked)} />
          <span>Activar los bots de Telegram (clientes + personal)</span>
        </label>
        {!modules.telegram ? (
          <div className="muted" style={{ padding: '8px 0' }}>Activa el módulo para administrar los bots. Cada bot puede tener un papel distinto: clientes (precios, pedidos y promociones), dueño (reportes, aprobaciones) y vendedores (avisos).</div>
        ) : null}
      </div>

      {modules.telegram && (
        <>
          <div className="muted mb12">Crea cada bot con <strong>@BotFather</strong> en Telegram y pega su token (formato <code>123456:AAB...-x</code>). Para un solo bot elige el tipo <strong>Negocio (único)</strong>: atiende a dueños, vendedores y clientes. El personal vincula su dispositivo con su usuario del sistema en este chat del negocio.</div>

          <div className="card">
            <div className="row-between"><h3><ChatBubbleLeftEllipsisIcon style={{ width: 16, height: 16 }} /> Bots configurados</h3><button className="btn secondary sm" onClick={() => setBotForm({ name: '', kind: 'negocio', token: '', active: true })}>+ Agregar bot</button></div>
            <table>
              <thead><tr><th>Bot</th><th>Tipo / acciones</th><th>Enlace</th><th>Estado</th><th></th></tr></thead>
              <tbody>
                {bots.map(b => (
                  <tr key={b.id}>
                    <td><strong>{b.name}</strong><div className="muted">…{String(b.token).slice(-8)}</div></td>
                    <td>
                      <span className="badge info">{kindLabel(b.kind)}</span>
                      <div className="muted" style={{ maxWidth: 260, fontSize: 11 }}>{(KINDS.find(k => k[0] === b.kind) || [])[2]}</div>
                    </td>
                    <td>
                      {b.username
                        ? <div className="flex" style={{ gap: 8 }}>
                            <a href={`https://t.me/${b.username}`} target="_blank" rel="noreferrer">@ {b.username}</a>
                            <span title={`https://t.me/${b.username}`}><Qr text={`https://t.me/${b.username}`} small /></span>
                          </div>
                        : <div className="flex" style={{ gap: 8 }}>
                            <span className="muted">sin nombre aún</span>
                            <span title="QR del token (difícil de compartir)"><Qr text="https://t.me/" small /></span>
                          </div>}
                    </td>
                    <td>{b.active ? <span className="badge success">{b.running ? 'Activo' : 'Detenido'}</span> : <span className="badge neutral">Inactivo</span>}
                      {!b.active && b.running && <span className="badge warning">deteniendo…</span>}
                      {b.lastError && <div className="muted danger-text" style={{ fontSize: 11 }}>{b.lastError}</div>}
                    </td>
                    <td>
                      <div className="flex">
                        <button className="btn secondary sm" onClick={() => setBotForm({ ...b, token: '' })}><PencilIcon style={{ width: 16, height: 16 }} /></button>
                        <button className="btn danger sm" onClick={() => deleteBot(b)}><TrashIcon style={{ width: 16, height: 16 }} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
                {bots.length === 0 && <tr><td colSpan={5}><div className="empty">Sin bots configurados</div></td></tr>}
              </tbody>
            </table>
          </div>

          <div className="card mt12">
            <h3><ComputerDesktopIcon style={{ width: 16, height: 16 }} /> Reportes y avisos del bot</h3>
            <div className="form-grid">
              <div className="field"><label>Hora del reporte diario</label><input className="input" type="number" min="0" max="23" value={tg.form?.reportHour ?? 19} onChange={e => setTg(t => ({ ...t, form: { ...t.form, reportHour: Number(e.target.value) || 0 } }))} /></div>
              <div className="field"><label>&nbsp;</label><div className="flex wrap">
                <button className="btn" onClick={saveTg}><CheckIcon style={{ width: 16, height: 16 }} /> Guardar</button>
                <button className="btn secondary" onClick={testTg}><EnvelopeIcon style={{ width: 16, height: 16 }} /> Mensaje de prueba</button>
              </div></div>
            </div>
            <label className="flex" style={{ cursor: 'pointer' }}><input type="checkbox" checked={!!tg.form?.notifyLowStock} onChange={e => setTg(t => ({ ...t, form: { ...t.form, notifyLowStock: e.target.checked } }))} /> Avisar por Telegram cuando un producto baje de su stock mínimo</label>
          </div>

          <div className="card mt12">
            <h3><LockClosedIcon style={{ width: 16, height: 16 }} /> Permisos de comandos por rol</h3>
            <div className="muted mb12">El Root decide qué puede <strong>solicitar</strong> cada rol con el bot. Marca los comandos que cada rol puede usar en este chat del negocio. El vínculo sigue siendo por usuario + contraseña + rol.</div>
            {botCmds.roles.length === 0 ? (
              <div className="muted">Carga los roles…</div>
            ) : (
              <div className="form-grid" style={{ gridTemplateColumns: '1fr' }}>
                {botCmds.roles.map(r => (
                  <div key={r.id} className="card" style={{ padding: 12 }}>
                    <div className="row-between">
                      <strong>{r.name}</strong>
                      <span className="muted" style={{ fontSize: 11 }}>{r.botCommands?.length || 0} comandos</span>
                    </div>
                    <div className="flex wrap mt8" style={{ gap: 6 }}>
                      {botCmds.commands.filter(cmd => cmd.cmd !== '/vincular' && cmd.cmd !== '/ayuda').map(cmd => {
                        const on = (r.botCommands || []).includes(cmd.cmd)
                        return (
                          <label key={cmd.cmd} className="flex" style={{ gap: 4, cursor: 'pointer', alignItems: 'center', fontSize: 12 }}>
                            <input type="checkbox" checked={on} onChange={async e => {
                              const list = (r.botCommands || []).includes(cmd.cmd)
                                ? (r.botCommands || []).filter(x => x !== cmd.cmd)
                                : [...(r.botCommands || []), cmd.cmd]
                              try {
                                const res = await api(`/telegram/roles/${r.id}/permissions`, { method: 'PUT', body: { commands: list } })
                                toast.success('Permisos guardados')
                                setBotCmds(b => ({ ...b, roles: b.roles.map(ro => ro.id === r.id ? { ...ro, botCommands: res.commands } : ro) }))
                              } catch (err) { toast.error(err.message) }
                            }} />
                            <span title={cmd.label}>{cmd.cmd}</span>
                          </label>
                        )
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="card mt12">
            <h3><ComputerDesktopIcon style={{ width: 16, height: 16 }} /> Dispositivos vinculados</h3>
            <div className="muted mb12">Cada empleado vincula su dispositivo con <code>/vincular USUARIO CONTRASEÑA ROL</code>. Aquí ves el usuario del sistema, rol, IP, MAC y chat.</div>
            {devices.length === 0 ? (
              <div className="muted">Aún no hay dispositivos vinculados.</div>
            ) : (
              <table>
                <thead><tr><th>Usuario</th><th>Rol</th><th>Nombre</th><th>IP</th><th>MAC</th><th>Chat ID</th><th></th></tr></thead>
                <tbody>
                  {devices.map(d => (
                    <tr key={d.id}>
                      <td><strong>{d.username || '—'}</strong></td>
                      <td><span className="badge info">{d.role_name || '—'}</span></td>
                      <td>{d.display_name || d.user_name || '—'}</td>
                      <td className="muted">{d.ip || '—'}</td>
                      <td className="muted">{d.mac || '—'}</td>
                      <td className="muted">{d.chat_id}</td>
                      <td>{d.verified ? <span className="badge success">✓</span> : <span className="badge warning">pendiente</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="card mt12">
            <h3><ShoppingBagIcon style={{ width: 16, height: 16 }} /> Solicitudes de producto (bot de ventas)</h3>
            <div className="muted mb12">Clientes que solicitaron un producto que no tienen o quieren que la empresa consiga. Márcalas como atendidas cuando las resuelvas.</div>
            {prodReqs.length === 0 ? (
              <div className="muted">Aún no hay solicitudes de producto.</div>
            ) : (
              <table>
                <thead><tr><th>Código</th><th>Producto / Marca</th><th>Contacto</th><th>Estado</th><th></th></tr></thead>
                <tbody>
                  {prodReqs.map(r => (
                    <tr key={r.id}>
                      <td className="muted">{r.code}</td>
                      <td><strong>{r.product_name}</strong>{r.brand ? <div className="muted">{r.brand}</div> : null}</td>
                      <td>{r.contact_name || '—'} <span className="muted">{r.contact_phone}</span></td>
                      <td>
                        <span className={`badge ${r.status === 'PENDIENTE' ? 'warning' : r.status === 'ATENDIDA' ? 'success' : 'neutral'}`}>{r.status}</span>
                      </td>
                      <td>
                        <div className="flex">
                          {r.status !== 'ATENDIDA' && <button className="btn sm" onClick={async () => { await api(`/product-requests/${r.id}/status`, { method: 'PUT', body: { status: 'ATENDIDA' } }); loadProdReqs() }}>✓</button>}
                          {r.status !== 'CANCELADA' && <button className="btn danger sm" onClick={async () => { await api(`/product-requests/${r.id}/status`, { method: 'PUT', body: { status: 'CANCELADA' } }); loadProdReqs() }}>✕</button>}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="card mt12">
            <h3><UserGroupIcon style={{ width: 16, height: 16 }} /> Chats registrados</h3>
            {[].concat(tg.status?.owners || [], tg.status?.sellers || []).length === 0 && !tg.status?.clientChats
              ? <div className="muted">Aún no hay chats registrados. Escríbele a tu bot y usa /registrar con las claves.</div>
              : <table>
                  <thead><tr><th>Rol</th><th>Nombre</th><th>Teléfono</th><th>Chat ID</th><th></th></tr></thead>
                  <tbody>
                    {[...(tg.status?.owners || []), ...(tg.status?.sellers || [])].map(c => (
                      <tr key={c.id}>
                        <td><span className={`badge ${c.role === 'owner' ? 'success' : 'info'}`}>{c.role === 'owner' ? 'Dueño' : 'Vendedor'}</span></td>
                        <td>{c.display_name}</td><td>{c.phone}</td><td className="muted">{c.chat_id}</td>
                        <td><button className="btn danger sm" onClick={() => removeChat(c.id)}><TrashIcon style={{ width: 16, height: 16 }} /></button></td>
                      </tr>
                    ))}
                    {tg.status?.clientChats > 0 && <tr><td><span className="badge neutral">Cliente</span></td><td colSpan={3} className="muted">+{tg.status.clientChats} clientes enlazados (reciben promociones)</td><td></td></tr>}
                  </tbody>
                </table>}
          </div>

          <div className="card mt12">
            <div className="row-between"><h3><BanknotesIcon style={{ width: 16, height: 16 }} /> Compra a distancia</h3></div>
            <div className="muted mb12">Los clientes ven estos datos al comprar desde el bot de ventas. Configura el pago móvil / número de cuenta de cada método remoto.</div>
            {methods.filter(m => m.is_remote).length === 0 ? (
              <div className="muted">Sin métodos de pago remotos. Actívalos como «A distancia» desde Configuración → Métodos de pago.</div>
            ) : (
              <table>
                <thead><tr><th></th><th>Método</th><th>Banco / titular</th><th>Pago móvil</th><th>Cuenta</th><th></th></tr></thead>
                <tbody>
                  {methods.filter(m => m.is_remote).map(m => (
                    <tr key={m.id}>
                      <td>{m.icon}</td>
                      <td><strong>{m.name}</strong></td>
                      <td className="muted">{(m.bank || '—') + (m.account_holder ? ' · ' + m.account_holder : '')}</td>
                      <td className="muted">{m.phone || '—'}</td>
                      <td className="muted">{m.account_number || '—'}</td>
                      <td><button className="btn secondary sm" onClick={() => setRemoteForm({ ...m })}><PencilIcon style={{ width: 16, height: 16 }} /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {can('marketing.promos') && (
            <div className="card mt12">
              <div className="row-between"><h3><MegaphoneIcon style={{ width: 16, height: 16 }} /> Promociones (solo Root)</h3>
                <button className="btn secondary sm" onClick={() => setPromoForm({ title: '', message: '' })}>+ Crear promoción</button>
              </div>
              <div className="muted mb12">El mensaje se envía a todos los clientes que hayan interactuado con el bot (enlazados por teléfono). Puedes personalizarlo con <code>{'{nombre}'}</code>.</div>
              <table>
                <thead><tr><th>Promoción</th><th>Enviado</th><th>Clientes</th><th>Alcanzados</th><th>Por</th><th></th></tr></thead>
                <tbody>
                  {promos.map(p => (
                    <tr key={p.id}>
                      <td><strong>{p.title}</strong><div className="muted" style={{ maxWidth: 280, whiteSpace: 'normal' }}>{p.message}</div></td>
                      <td>{p.sent_at ? new Date(p.sent_at + (p.sent_at.includes('T') ? '' : 'T00:00:00')).toLocaleString('es', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'}</td>
                      <td>{p.total_clients}</td>
                      <td><span className="badge success">{p.sent_count}</span></td>
                      <td className="muted">{p.by_username || '—'}</td>
                      <td><button className="btn danger sm" onClick={async () => { if (confirm('Eliminar este registro?')) { await api(`/telegram/promotions/${p.id}`, { method: 'DELETE' }); loadPromos() } }}><TrashIcon style={{ width: 16, height: 16 }} /></button></td>
                    </tr>
                  ))}
                  {promos.length === 0 && <tr><td colSpan={6}><div className="empty">Sin promociones enviadas</div></td></tr>}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {botForm && (
        <div className="modal-back" onClick={() => setBotForm(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2>{botForm.id ? 'Editar bot' : 'Nuevo bot de Telegram'}</h2>
            <div className="field"><label>Nombre</label><input className="input" value={botForm.name || ''} onChange={e => setBotForm({ ...botForm, name: e.target.value })} placeholder="Ej: Bot de clientes" /></div>
            <div className="field"><label>Tipo de bot</label>
              <select className="select" value={botForm.kind} onChange={e => setBotForm({ ...botForm, kind: e.target.value })}>
                {KINDS.map(([k, l, d]) => <option key={k} value={k}>{l} — {d}</option>)}
              </select>
            </div>
            <div className="field">
              <label>Token de @BotFather {botForm.id && <span className="hint">(déjalo vacío para no cambiarlo)</span>}</label>
              <input className="input" value={botForm.token || ''} onChange={e => setBotForm({ ...botForm, token: e.target.value })} placeholder="123456:AAB..." />
            </div>
            {!botForm.id && <div className="hint muted mb12">Al guardar se comprueba el token con Telegram y se guarda el nombre público (@...) para el QR.</div>}
            <label className="flex"><input type="checkbox" checked={!!botForm.active} onChange={e => setBotForm({ ...botForm, active: e.target.checked })} /> Bot activo (responder comandos)</label>
            <div className="modal-footer">
              <button className="btn" onClick={saveBot}><CheckIcon style={{ width: 16, height: 16 }} /> Guardar bot</button>
              <button className="btn secondary" onClick={() => setBotForm(null)}>Cancelar</button>
            </div>
          </div>
        </div>
      )}

      {promoForm && (
        <div className="modal-back" onClick={() => setPromoForm(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2><MegaphoneIcon style={{ width: 16, height: 16 }} /> Nueva promoción</h2>
            <div className="field"><label>Título *</label><input className="input" value={promoForm.title} onChange={e => setPromoForm({ ...promoForm, title: e.target.value })} placeholder="Ej: Oferta de fin de semana" /></div>
            <div className="field"><label>Mensaje *</label><textarea className="textarea" rows={4} value={promoForm.message} onChange={e => setPromoForm({ ...promoForm, message: e.target.value })} placeholder="¡Todo a mitad de precio! Usa {nombre} para saludar al cliente." /></div>
            <div className="hint muted mb12">Se enviará a los clientes que hayan interactuado con un bot y tengan teléfono registrado. Coloca <code>{'{nombre}'}</code> para personalizar.</div>
            <div className="modal-footer">
              <button className="btn" onClick={launchPromo} disabled={promoBusy}>{promoBusy ? 'Enviando…' : <><ArrowUpTrayIcon style={{ width: 16, height: 16 }} /> Enviar a clientes</>}</button>
              <button className="btn secondary" onClick={() => setPromoForm(null)}>Cancelar</button>
            </div>
          </div>
        </div>
      )}

      {remoteForm && (
        <div className="modal-back" onClick={() => setRemoteForm(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2><BanknotesIcon style={{ width: 16, height: 16 }} /> Datos de pago a distancia — {remoteForm.name}</h2>
            <div className="field"><label>Banco</label><input className="input" value={remoteForm.bank || ''} onChange={e => setRemoteForm({ ...remoteForm, bank: e.target.value })} placeholder="Ej: Banco de Venezuela" /></div>
            <div className="field"><label>Titular</label><input className="input" value={remoteForm.account_holder || ''} onChange={e => setRemoteForm({ ...remoteForm, account_holder: e.target.value })} placeholder="Nombre del titular" /></div>
            <div className="grid g2">
              <div className="field"><label>Pago móvil (teléfono)</label><input className="input" value={remoteForm.phone || ''} onChange={e => setRemoteForm({ ...remoteForm, phone: e.target.value })} placeholder="0414-000-0000" /></div>
              <div className="field"><label>Número de cuenta</label><input className="input" value={remoteForm.account_number || ''} onChange={e => setRemoteForm({ ...remoteForm, account_number: e.target.value })} /></div>
            </div>
            <div className="field"><label>Instrucciones / referencia</label><textarea className="textarea" rows={3} value={remoteForm.instructions || ''} onChange={e => setRemoteForm({ ...remoteForm, instructions: e.target.value })} placeholder="Ej: Envía el comprobante por el chat después de pagar." /></div>
            <div className="modal-footer">
              <button className="btn" onClick={saveRemote}><CheckIcon style={{ width: 16, height: 16 }} /> Guardar</button>
              <button className="btn secondary" onClick={() => setRemoteForm(null)}>Cancelar</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

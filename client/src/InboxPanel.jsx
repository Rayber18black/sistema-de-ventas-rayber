import React, { useEffect, useState } from 'react'
import { api } from './api.js'
import { useToast } from './toast.jsx'
import { UsersIcon, MegaphoneIcon, ShoppingBagIcon, ChatBubbleLeftIcon, XMarkIcon } from '@heroicons/react/24/outline'

const TABS = [
  ['clientes', <><UsersIcon style={{ width: 16, height: 16 }} /> Clientes</>],
  ['comunicados', <><MegaphoneIcon style={{ width: 16, height: 16 }} /> Comunicados</>],
  ['ordenes', <><ShoppingBagIcon style={{ width: 16, height: 16 }} /> Órdenes</>]
]

export default function InboxPanel({ onUnreadChange }) {
  const toast = useToast()
  const [tab, setTab] = useState('clientes')
  const [data, setData] = useState({ clientes: [], comunicados: [], ordenes: [] })
  const [openChat, setOpenChat] = useState(null)
  const [thread, setThread] = useState([])
  const [replyText, setReplyText] = useState('')
  const [sending, setSending] = useState(false)

  const load = () => {
    api('/telegram/inbox').then(d => {
      setData(d)
      const total = (d.clientes || []).reduce((a, c) => a + (c.unread || 0), 0)
        + (d.comunicados || []).reduce((a, c) => a + (c.unread || 0), 0)
        + (d.ordenes || []).reduce((a, c) => a + (c.unread || 0), 0)
      if (onUnreadChange) onUnreadChange(total)
    }).catch(() => {})
  }

  useEffect(() => { load() }, [])

  async function openThread(chatId) {
    setOpenChat(chatId)
    setReplyText('')
    try { await api(`/telegram/inbox/${chatId}/read`, { method: 'POST' }) } catch (e) {}
    try { setThread(await api(`/telegram/inbox/${chatId}`)) } catch (e) {}
    load()
  }

  async function replyClient() {
    const text = replyText.trim()
    if (!openChat || !text) return toast.error('Escribe una respuesta')
    setSending(true)
    try {
      await api(`/telegram/inbox/${openChat}/reply`, { method: 'POST', body: { text } })
      setReplyText('')
      setThread(await api(`/telegram/inbox/${openChat}`))
      toast.success('Respuesta enviada')
      load()
    } catch (e) { toast.error(e.message) } finally { setSending(false) }
  }

  const current = tab === 'comunicados' ? data.comunicados : tab === 'ordenes' ? data.ordenes : data.clientes
  const isReadOnly = tab !== 'clientes'

  const renderItem = (c) => (
    <button key={c.chat_id} className="inbox-row" onClick={() => openThread(c.chat_id)}>
      <div className="inbox-row-main">
        <strong>{c.icon ? c.icon + ' ' : ''}{c.name}</strong>
        {c.phone ? <span className="muted"> · {c.phone}</span> : null}
      </div>
      {c.unread > 0 && <span className="msg-badge inbox-unread">{c.unread}</span>}
      <div className="inbox-row-last">{c.last ? (c.last.direction === 'out' ? '→ ' : '← ') + (c.last.text || '') : ''}</div>
    </button>
  )

  return (
    <div className="inbox-panel inbox-panel-drawer">
      <div className="inbox-panel-head">
        <strong><ChatBubbleLeftIcon style={{ width: 16, height: 16 }} /> Bandeja de entrada</strong>
        <span className="flex" style={{ gap: 6 }}>
          {openChat !== null && <button className="btn secondary sm" onClick={() => setOpenChat(null)}>← Volver</button>}
          <button className="btn secondary sm" title="Cerrar" onClick={() => onClose()}><XMarkIcon style={{ width: 16, height: 16 }} /></button>
        </span>
      </div>

      <div className="inbox-tabs">
        {TABS.map(([key, label]) => {
          const list = key === 'comunicados' ? data.comunicados : key === 'ordenes' ? data.ordenes : data.clientes
          const n = (list || []).reduce((a, c) => a + (c.unread || 0), 0)
          return (
            <button key={key} className={`inbox-tab ${tab === key ? 'active' : ''}`} onClick={() => { setTab(key); setOpenChat(null) }}>
              {label}
              {n > 0 && <span className="msg-badge inbox-unread">{n}</span>}
            </button>
          )
        })}
      </div>

      <div className="inbox-body">
        {openChat === null ? (
          current.length === 0
            ? <div className="muted" style={{ padding: 16 }}>{tab === 'clientes' ? 'Aún no hay mensajes de clientes.' : 'Nada por aquí.'}</div>
            : <div className="inbox-list">{current.map(renderItem)}</div>
        ) : (
          <div>
            <div className="thread-box">
              {thread.length === 0 && <div className="muted">Sin mensajes.</div>}
              {thread.map(m => (
                <div key={m.id} className={`thread-msg ${m.direction === 'out' ? 'out' : 'in'}`}>
                  <div className="thread-bubble" dangerouslySetInnerHTML={{ __html: m.text || '' }} />
                  <div className="thread-meta">{m.direction === 'out' ? (isReadOnly ? 'Sistema' : 'Negocio') : m.sender_name} · {m.created_at}</div>
                </div>
              ))}
            </div>
            {!isReadOnly && (
              <div className="flex" style={{ gap: 8, marginTop: 12 }}>
                <input className="input" style={{ flex: 1 }} placeholder="Escribe tu respuesta…" value={replyText}
                  onChange={e => setReplyText(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') replyClient() }} />
                <button className="btn primary" disabled={sending || !replyText.trim()} onClick={replyClient}>{sending ? 'Enviando…' : 'Enviar'}</button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

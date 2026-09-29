import React, { useEffect, useState } from 'react'
import { api } from './api.js'
import { SignalIcon, CpuChipIcon, XMarkIcon } from '@heroicons/react/24/outline'

function QrImg({ text }) {
  const [img, setImg] = useState('')
  useEffect(() => {
    if (!text) return
    let live = true
    api(`/access/qr-public?text=${encodeURIComponent(text)}`).then(d => live && setImg(d.dataUrl)).catch(() => {})
    return () => { live = false }
  }, [text])
  if (!img) return <div className="muted" style={{ fontSize: 12 }}>cargando QR…</div>
  return <img src={img} alt="QR" style={{ width: 150, height: 150, borderRadius: 8, background: '#fff' }} />
}

export default function QrModal({ title, icon, onClose }) {
  const [items, setItems] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    const path = title === 'access' ? '/access/info-public' : '/telegram/qr-links'
    api(path).then(d => {
      setItems(title === 'access' ? (d.urls || []) : d)
    }).catch(e => setError(e.message))
  }, [title])

  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 520 }}>
        <h2>{title === 'access' ? <SignalIcon style={{ width: 16, height: 16 }} /> : <CpuChipIcon style={{ width: 16, height: 16 }} />} {title === 'access' ? 'Acceso a distancia' : 'QR de los bots'} <button className="btn secondary sm" onClick={onClose}><XMarkIcon style={{ width: 16, height: 16 }} /></button></h2>

        {error && <div className="muted" style={{ color: 'var(--danger)', margin: '10px 0' }}>{error}</div>}

        {title === 'access' ? (
          <>
            <div className="muted mb12">Escanea un QR (o abre la URL) desde un celular en la misma red para usar el sistema desde allí.</div>
            {!items && !error && <div className="muted">Cargando…</div>}
            <div className="flex wrap" style={{ gap: 12 }}>
              {(items || []).map(u => (
                <div key={u.url} className="card" style={{ padding: 12, textAlign: 'center', flex: '1 1 140px' }}>
                  <QrImg text={u.url} />
                  <div style={{ fontWeight: 600, wordBreak: 'break-all' }}>{u.url}</div>
                  <div className="muted" style={{ fontSize: 12 }}>{u.iface}</div>
                </div>
              ))}
            </div>
            {items && items.length === 0 && <div className="muted">Sin interfaces de red locales detectadas.</div>}
          </>
        ) : (
          <>
            <div className="muted mb12">Escanea el QR de un bot para abrirlo en Telegram y empezar a chatear.</div>
            {!items && !error && <div className="muted">Cargando…</div>}
            {items && items.length === 0 && <div className="muted">No hay bots activos con nombre configurado.</div>}
            <div className="flex wrap" style={{ gap: 12 }}>
              {(items || []).map(b => (
                <div key={b.id} className="card" style={{ padding: 12, textAlign: 'center', flex: '1 1 150px' }}>
                  <QrImg text={b.link} />
                  <div style={{ fontWeight: 600 }}>{b.name}</div>
                  <a href={b.link} target="_blank" rel="noreferrer">@ {b.username}</a>
                </div>
              ))}
            </div>
          </>
        )}

        <div className="modal-footer">
          <button className="btn secondary" onClick={onClose}>Cerrar</button>
        </div>
      </div>
    </div>
  )
}

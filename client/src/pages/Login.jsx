import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../auth.jsx'
import { useToast } from '../toast.jsx'
import { useTheme } from '../theme.jsx'
import { api } from '../api.js'
import { ShoppingCartIcon, SunIcon, MoonIcon } from '@heroicons/react/24/outline'
import QrModal from '../QrModal.jsx'

export default function Login() {
  const { login } = useAuth()
  const toast = useToast()
  const { theme, toggleTheme } = useTheme()
  const nav = useNavigate()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [name, setName] = useState('Sistema de Ventas')
  const [qrModal, setQrModal] = useState(null)

  useEffect(() => { api('/settings/public').then(s => setName(s.businessName)).catch(() => {}) }, [])

  async function submit(e) {
    e.preventDefault()
    setBusy(true)
    try {
      const user = await login(username, password)
      toast.success(`Bienvenido, ${user.username}`)
      nav('/pos')
    } catch (err) {
      toast.error(err.message)
    } finally { setBusy(false) }
  }

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={submit}>
        <button type="button" className="login-theme-toggle" onClick={toggleTheme}
          title={theme === 'dark' ? 'Modo claro' : 'Modo oscuro'}>
          {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
        </button>

        <div className="login-logo">
          <ShoppingCartIcon />
        </div>
        <h1>{name}</h1>
        <p className="subtitle">Inicia sesión para continuar</p>

        <div className="field">
          <label>Usuario</label>
          <input className="input" value={username} onChange={e => setUsername(e.target.value)} autoFocus
            placeholder="Ingresa tu usuario" />
        </div>
        <div className="field">
          <label>Contraseña</label>
          <input className="input" type="password" value={password} onChange={e => setPassword(e.target.value)}
            placeholder="Ingresa tu contraseña" />
        </div>
        <button className="btn big" disabled={busy || !username || !password}>
          {busy ? 'Ingresando…' : 'Ingresar'}
        </button>

        <div className="flex wrap" style={{ marginTop: 20, gap: 8, justifyContent: 'center' }}>
          <button className="btn secondary" type="button" onClick={() => setQrModal('access')}>
            QR Acceso
          </button>
          <button className="btn secondary" type="button" onClick={() => setQrModal('telegram')}>
            QR Bots
          </button>
        </div>

        {qrModal && <QrModal title={qrModal} onClose={() => setQrModal(null)} />}
      </form>
    </div>
  )
}

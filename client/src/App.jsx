import React, { useEffect, useState, lazy, Suspense } from 'react'
import { Routes, Route, Navigate, NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from './auth.jsx'
import { api } from './api.js'
import { setCurrency } from './fmt.js'
import { getBranch, setBranch } from './branch.js'
import { useTheme } from './theme.jsx'
import {
  ShoppingCartIcon, ChartBarIcon, CubeIcon, ReceiptPercentIcon,
  UsersIcon, DocumentDuplicateIcon, TruckIcon, BanknotesIcon,
  PresentationChartLineIcon, UserGroupIcon, CogIcon, ChatBubbleLeftEllipsisIcon,
  SunIcon, MoonIcon, ChevronLeftIcon, ChevronRightIcon,
  QrCodeIcon, ArrowRightOnRectangleIcon, Bars3Icon,
  BellIcon, WifiIcon, Cog6ToothIcon
} from '@heroicons/react/24/outline'
import Login from './pages/Login.jsx'
import Dashboard from './pages/Dashboard.jsx'
import Pos from './pages/Pos.jsx'
import QrModal from './QrModal.jsx'
import InboxPanel from './InboxPanel.jsx'
import ErrorBoundary from './ErrorBoundary.jsx'
import { I18nProvider } from './i18n.jsx'

// Code-splitting: páginas secundarias se cargan bajo demanda
const Lazy = p => lazy(() => import(`./pages/${p}.jsx`))
const Products = Lazy('Products')
const Users = Lazy('Users')
const Reports = Lazy('Reports')
const Settings = Lazy('Settings')
const BotConfig = Lazy('BotConfig')
const Customers = Lazy('Customers')
const Sales = Lazy('Sales')
const Quotes = Lazy('Quotes')
const Expenses = Lazy('Expenses')
const Purchases = Lazy('Purchases')

const NAV_ICONS = {
  '/pos': ShoppingCartIcon,
  '/dashboard': ChartBarIcon,
  '/inventory': CubeIcon,
  '/sales': ReceiptPercentIcon,
  '/customers': UsersIcon,
  '/quotes': DocumentDuplicateIcon,
  '/purchases': TruckIcon,
  '/expenses': BanknotesIcon,
  '/reports': PresentationChartLineIcon,
  '/users': UserGroupIcon,
  '/settings': CogIcon,
  '/bots': ChatBubbleLeftEllipsisIcon,
}

function Layout({ children }) {
  const { user, logout } = useAuth()
  const { theme, toggleTheme } = useTheme()
  const nav = useNavigate()
  const [collapsed, setCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [cash, setCash] = useState(null)
  const [settings, setSettings] = useState({ businessName: 'Mi Negocio' })
  const [branches, setBranches] = useState([])
  const [branch, setBranchState] = useState(getBranch())
  const [qrModal, setQrModal] = useState(null)
  const [unread, setUnread] = useState(0)
  const [inboxOpen, setInboxOpen] = useState(false)

  const can = p => user?.permissions?.includes(p)

  const refreshUnread = () => {
    if (!can('telegram.manage')) return
    api('/telegram/inbox-unread').then(d => setUnread(d.unread || 0)).catch(() => {})
  }

  useEffect(() => {
    if (!can('telegram.manage')) return
    refreshUnread()
    const t = setInterval(refreshUnread, 15000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    const block = e => {
      if (e.target && e.target.tagName === 'INPUT' && e.target.type === 'number') e.preventDefault()
    }
    window.addEventListener('wheel', block, { passive: false })
    return () => window.removeEventListener('wheel', block)
  }, [])

  const loadCash = () => api('/cash/session/current').then(d => setCash(d.session)).catch(() => {})

  useEffect(() => {
    api('/settings/public').then(s => { setSettings(s); setCurrency(s.currencySymbol, s.currency) }).catch(() => {})
    api('/branches').then(list => {
      setBranches(list)
      if (list.length && !getBranch()) setBranchState(list[0])
    }).catch(() => {})
    if (can('cash.open')) loadCash()
  }, [])

  const changeBranch = b => {
    setBranch(b)
    setBranchState(b)
    if (can('cash.open')) loadCash()
  }

  const links = [
    { to: '/pos', label: 'Punto de venta', perm: 'sales.do' },
    { to: '/dashboard', label: 'Dashboard' },
    null,
    { to: '/inventory', label: 'Inventario', perm: 'products.view' },
    { to: '/sales', label: 'Ventas', perm: 'sales.do' },
    { to: '/customers', label: 'Clientes', perm: 'customers.manage' },
    { to: '/quotes', label: 'Cotizaciones', perm: 'quotes.manage' },
    { to: '/purchases', label: 'Compras', perm: 'purchases.do' },
    null,
    { to: '/expenses', label: 'Gastos', perm: 'expenses.manage' },
    { to: '/reports', label: 'Reportes', perm: 'reports.view' },
    { to: '/users', label: 'Usuarios y roles', perm: 'users.manage' },
    { to: '/settings', label: 'Configuración', perm: 'settings.manage' },
    { to: '/bots', label: 'Bots y Telegram', perm: 'telegram.manage' }
  ].filter(l => !l || !l.perm || can(l.perm))

  return (
    <div className="layout">
      <div className={`backdrop ${mobileOpen ? 'show' : ''}`} onClick={() => setMobileOpen(false)} />
      <aside className={`sidebar ${collapsed ? 'collapsed' : ''} ${mobileOpen ? 'open' : ''}`}>
        <div className="sidebar-header">
          <h2>{settings.businessName || 'Sistema'}</h2>
          <small>{settings.posTitle || 'PUNTO DE VENTA'}</small>
        </div>
        <nav className="nav">
          {links.map((l, i) => {
            if (!l) return <div key={'s' + i} className="nav-sep" />
            const Icon = NAV_ICONS[l.to] || CubeIcon
            return (
              <NavLink key={l.to} to={l.to} onClick={() => setMobileOpen(false)}
                className={({ isActive }) => isActive ? 'active' : ''}>
                <Icon className="nav-icon" />
                <span className="nav-label">{l.label}</span>
              </NavLink>
            )
          })}
        </nav>
        <div className="sidebar-footer">
          <div className="sidebar-footer-avatar">
            {(user?.full_name || user?.username || '?')[0].toUpperCase()}
          </div>
          <div className="sidebar-footer-text">
            <strong>{user?.full_name || user?.username}</strong>
            <span>{user?.role}</span>
          </div>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <button className="hamburger" onClick={() => setMobileOpen(true)}>
            <Bars3Icon style={{ width: 20, height: 20 }} />
          </button>
          <button className="topbar-toggle" title={collapsed ? 'Expandir menú' : 'Colapsar menú'}
            onClick={() => setCollapsed(c => !c)}>
            {collapsed ? <ChevronRightIcon /> : <ChevronLeftIcon />}
          </button>

          <span className={`cash-chip ${cash ? '' : 'closed'}`}>
            {cash ? `Caja abierta · ${cash.opening_amount}` : 'Caja cerrada'}
          </span>

          {settings.modules?.multisucursal && branches.length > 0 && (
            <select className="select" style={{ maxWidth: 190 }}
              value={branch?.id || ''}
              onChange={e => changeBranch(branches.find(b => b.id === Number(e.target.value)))}>
              {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          )}

          <div className="spacer" />

          <button className="topbar-icon" title="QR de acceso a distancia"
            onClick={() => setQrModal('access')}>
            <WifiIcon />
          </button>
          <button className="topbar-icon" title="QR de los bots de Telegram"
            onClick={() => setQrModal('telegram')}>
            <QrCodeIcon />
          </button>

          {can('telegram.manage') && (
            <span className="msg-bell-wrap">
              <button className={`topbar-icon ${inboxOpen ? 'active' : ''}`}
                title="Mensajes de los bots"
                onClick={() => { setInboxOpen(o => !o); if (!inboxOpen) refreshUnread() }}>
                <BellIcon />
              </button>
              {unread > 0 && !inboxOpen && <span className="msg-badge">{unread > 99 ? '99+' : unread}</span>}
            </span>
          )}

          <button className="topbar-icon" onClick={() => toggleTheme()} title={theme === 'dark' ? 'Modo claro' : 'Modo oscuro'}>
            {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
          </button>

          <button className="topbar-icon" onClick={() => nav('/settings')} hidden={!can('settings.manage')}>
            <Cog6ToothIcon />
          </button>

          <button className="btn danger sm" onClick={() => { logout(); nav('/') }}
            style={{ gap: 4 }}>
            <ArrowRightOnRectangleIcon style={{ width: 14, height: 14 }} />
            Salir
          </button>
        </header>

        {inboxOpen && can('telegram.manage') && (
          <div className="inbox-overlay" onClick={() => setInboxOpen(false)} />
        )}
        {can('telegram.manage') && (
          <div className={`inbox-drawer ${inboxOpen ? 'open' : ''}`}>
            {inboxOpen && <InboxPanel onUnreadChange={setUnread} onClose={() => setInboxOpen(false)} />}
          </div>
        )}

        <div className="content">{children}</div>
        {qrModal && <QrModal title={qrModal} onClose={() => setQrModal(null)} />}
      </div>
    </div>
  )
}

function Guard({ children }) {
  const { user, ready } = useAuth()
  if (!ready) return <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>Cargando…</div>
  if (!user) return <Navigate to="/" replace />
  return <Layout>{children}</Layout>
}

export default function App() {
  const { user } = useAuth()
  return (
    <ErrorBoundary>
      <I18nProvider>
      <Suspense fallback={<div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>Cargando…</div>}>
      <Routes>
        <Route path="/" element={user ? <Navigate to="/pos" replace /> : <Login />} />
        <Route path="/pos" element={<Guard><Pos /></Guard>} />
        <Route path="/dashboard" element={<Guard><Dashboard /></Guard>} />
        <Route path="/inventory" element={<Guard><Products /></Guard>} />
        <Route path="/products" element={<Navigate to="/inventory" replace />} />
        <Route path="/sales" element={<Guard><Sales /></Guard>} />
        <Route path="/customers" element={<Guard><Customers /></Guard>} />
        <Route path="/quotes" element={<Guard><Quotes /></Guard>} />
        <Route path="/purchases" element={<Guard><Purchases /></Guard>} />
        <Route path="/expenses" element={<Guard><Expenses /></Guard>} />
        <Route path="/users" element={<Guard><Users /></Guard>} />
        <Route path="/cash" element={<Navigate to="/pos" replace />} />
        <Route path="/reports" element={<Guard><Reports /></Guard>} />
        <Route path="/settings" element={<Guard><Settings /></Guard>} />
        <Route path="/bots" element={<Guard><BotConfig /></Guard>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      </Suspense>
      </I18nProvider>
    </ErrorBoundary>
  )
}

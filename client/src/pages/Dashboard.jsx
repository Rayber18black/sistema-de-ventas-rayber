import React, { useEffect, useState, useMemo, useCallback, useRef } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { api } from '../api.js'
import { fmt } from '../fmt.js'
import { branchId } from '../branch.js'
import { useTheme } from '../theme.jsx'
import { useI18n } from '../i18n.jsx'
import { TimeSelector } from '../CalendarPicker.jsx'
import {
  Chart as ChartJS, CategoryScale, LinearScale, PointElement,
  LineElement, BarElement, ArcElement, Tooltip, Filler, Legend,
  RadialLinearScale, DoughnutController
} from 'chart.js'
import { Line, Doughnut, Bar } from 'react-chartjs-2'
import {
  CurrencyDollarIcon, ShoppingCartIcon, ArrowTrendingUpIcon,
  CubeIcon, UserGroupIcon, BanknotesIcon, ChartBarIcon,
  BoltIcon, FireIcon, ArrowUpRightIcon, ArrowDownTrayIcon,
  EyeIcon, EyeSlashIcon, CalendarIcon, AdjustmentsHorizontalIcon,
  ClockIcon, CheckCircleIcon, XCircleIcon, ScaleIcon,
  ArrowPathIcon, DocumentArrowDownIcon, ViewColumnsIcon
} from '@heroicons/react/24/outline'

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, ArcElement, Tooltip, Filler, Legend, RadialLinearScale, DoughnutController)

const WEEKDAYS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']

function relativeTime(dateStr) {
  if (!dateStr) return ''
  const diff = (Date.now() - new Date(dateStr.replace(' ', 'T')).getTime()) / 1000
  if (diff < 60) return `hace ${Math.floor(diff)}s`
  if (diff < 3600) return `hace ${Math.floor(diff / 60)}m`
  if (diff < 86400) return `hace ${Math.floor(diff / 3600)}h`
  return `hace ${Math.floor(diff / 86400)}d`
}

// ===== Persistencia de widgets visibles por usuario =====
function loadWidgets() { try { return JSON.parse(localStorage.getItem('posv_dash_widgets') || 'null') } catch { return null } }

// ===== Notificación de venta importante (toast) =====
function useBigSaleAlerts(d) {
  const lastFolio = useRef(null)
  useEffect(() => {
    if (!d?.recent?.length) return
    const top = d.recent[0]
    if (top.folio !== lastFolio.current) {
      lastFolio.current = top.folio
      if (Number(top.total) > 100) {
        const ticker = document.createElement('div')
        ticker.style.cssText = 'position:fixed;top:18px;left:50%;transform:translateX(-50%);z-index:9999;background:rgba(204,255,0,0.12);border:1px solid var(--primary);color:var(--primary);padding:10px 20px;border-radius:12px;font-weight:700;box-shadow:0 10px 40px rgba(0,0,0,0.4);pointer-events:none;animation:livePulse 0.4s'
        ticker.textContent = `Nueva venta ${top.folio}: ${fmt(top.total)}`
        document.body.appendChild(ticker)
        setTimeout(() => ticker.remove(), 3500)
      }
    }
  }, [d])
}

export default function Dashboard() {
  const navigate = useNavigate()
  const location = useLocation()
  const { theme } = useTheme()
  const { lang, setLang, t } = useI18n()
  const [d, setD] = useState(null)
  const [time, setTime] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('posv_dash_time') || 'null')
      if (saved && (saved.mode === 'day' || saved.mode === 'range')) return saved
    } catch (e) {}
    return { mode: 'today' }
  })
  const [widgets, setWidgets] = useState(() => loadWidgets() || {})
  const [masked, setMasked] = useState(() => localStorage.getItem('posv_dash_mask') === '1')
  const [cashier, setCashier] = useState(() => localStorage.getItem('posv_cashier') === '1')
  const [focus, setFocus] = useState(false)
  const [compareAB, setCompareAB] = useState(() => {
    try { const s = JSON.parse(localStorage.getItem('posv_compareAB') || 'null'); return s?.a?.from && s?.b?.from ? s : null } catch { return null }
  })
  const [abD, setAbD] = useState(() => {
    try { const s = JSON.parse(localStorage.getItem('posv_compare_abD') || 'null'); return s } catch { return null }
  })
  const saveAB = useCallback((c) => { setCompareAB(c); if (c?.a?.from && c?.b?.from) localStorage.setItem('posv_compareAB', JSON.stringify(c)); else localStorage.removeItem('posv_compareAB') }, [])
  const [lastUpdate, setLastUpdate] = useState(null)
  const [drill, setDrill] = useState(null)
  const [bigFont, setBigFont] = useState(localStorage.getItem('posv_bigfont') === '1')

  const isDark = theme === 'dark'
  const accentColor = isDark ? '#CCFF00' : '#0F2444'
  const accentAlpha = isDark ? 'rgba(204,255,0,' : 'rgba(15,36,68,'
  const gridColor = isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)'
  const textColor = isDark ? '#64748B' : '#6B7280'

  const load = useCallback(async (t) => {
    const q = {}
    if (t.from) q.from = t.from
    if (t.to) q.to = t.to
    if (branchId()) q.branch_id = branchId()
    const data = await api('/dashboard', { query: q })
    setD(data); setLastUpdate(new Date())
  }, [])

  const commit = useCallback((t) => {
    setTime(t)
    if (t.mode === 'day' || t.mode === 'range') localStorage.setItem('posv_dash_time', JSON.stringify(t))
    else localStorage.removeItem('posv_dash_time')
    load(t)
  }, [load])

  useEffect(() => {
    load(time)
    if (time.mode === 'live') {
      const iv = setInterval(() => load(time), 15000)
      return () => clearInterval(iv)
    }
  }, [time, load])

  useBigSaleAlerts(d)

  // auto logout por inactividad (15 min)
  useEffect(() => {
    let timer
    const reset = () => { clearTimeout(timer); timer = setTimeout(() => { localStorage.clear(); navigate('/') }, 15 * 60 * 1000) }
    const evts = ['mousemove', 'keydown', 'click']
    evts.forEach(e => window.addEventListener(e, reset))
    reset()
    return () => { evts.forEach(e => window.removeEventListener(e, reset)); clearTimeout(timer) }
  }, [navigate])

  // CSR
  function exportCSV() {
    if (!d) return
    const rows = [
      ['Métrica', 'Valor'],
      ['Ingresos', d.today_sales],
      ['Ventas', d.today_count],
      ['Margen bruto %', d.gross_margin],
      ['Ticket promedio', d.avg_ticket],
      ['Utilidad', d.today_profit],
      ['Devoluciones', d.refunds_total],
      ['Gastos', d.expenses_total],
      ['Neto', d.net_total],
    ]
    if (d.by_seller?.length) { rows.push([]); rows.push(['Vendedor', 'Ventas', 'Total']); d.by_seller.forEach(s => rows.push([s.seller, s.count, s.total])) }
    if (d.top_products?.length) { rows.push([]); rows.push(['Producto', 'Cantidad', 'Total']); d.top_products.forEach(p => rows.push([p.product_name, p.qty, p.total])) }
    const csv = rows.map(r => r.map(c => `"${c}"`).join(',')).join('\n')
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `dashboard_${(time.from || time.to || 'reporte')}.csv`
    a.click(); URL.revokeObjectURL(url)
  }

  if (!d) return <div className="empty">Cargando dashboard…</div>

  const today = new Date().toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long' })
  const isLive = time.mode === 'live'
  const isToday = time.mode === 'today'
  const isRange = time.mode === 'range' || time.mode === 'day'

  const avgTicket = d.today_count > 0 ? d.today_sales / d.today_count : 0
  const metaProgress = Math.min(100, d.meta_progress || 0)
  const forecastPct = d.forecast?.projected ? d.forecast.projected : 0

  const sparkD = (d.week_sales || []).map(w => Number(w.total) || 0)
  const sparkC = (d.week_sales || []).map(w => Number(w.count) || 0)
  const sparkRecent = (d.recent || []).slice(0, 8).map(r => Number(r.total) || 0)

  const delta = d.compare?.delta_total_pct

  const kpis1 = [
    { key: 'ingresos', label: t('ingresos').toUpperCase(), value: fmt(d.today_sales), delta, deltaLabel: isRange ? 'vs período previo' : 'vs período previo', icon: CurrencyDollarIcon, iconColor: 'var(--primary)', spark: sparkD, highlight: true, tip: 'Total de ventas brutas en el período seleccionado (sin descontar devoluciones ni gastos).' },
    { key: 'ventas', label: t('transacciones').toUpperCase(), value: d.today_count, delta, deltaLabel: 'tickets emitidos', icon: ShoppingCartIcon, iconColor: 'var(--info)', spark: sparkC, tip: 'Número de tickets de venta generados en el período.' },
    { key: 'ticket', label: t('ticket').toUpperCase(), value: fmt(avgTicket), deltaLabel: 'por transacción', icon: BanknotesIcon, iconColor: 'var(--accent)', spark: sparkRecent, tip: 'Importe medio por cada venta (ingresos ÷ transacciones). Útil para detectar si el cliente compra más o menos.' },
    { key: 'utilidad', label: t('utilidad').toUpperCase(), value: fmt(d.today_profit), deltaLabel: `${d.gross_margin || 0}% de margen`, icon: ChartBarIcon, iconColor: d.gross_margin > 0 ? 'var(--success)' : 'var(--muted)', spark: sparkD, tip: 'Diferencia entre precio de venta y costo de los productos vendidos. El margen % indica la rentabilidad de cada venta.' },
  ]
  const kpis2 = [
    { key: 'meta', label: t('metaDelDia').toUpperCase(), value: `${metaProgress.toFixed(0)}%`, deltaLabel: `${fmt(d.meta_diaria)} de meta`, icon: ChartBarIcon, iconColor: metaProgress >= 70 ? 'var(--success)' : 'var(--warning)', highlight: metaProgress >= 70,
      gauge: true, pct: metaProgress, tip: 'Porcentaje de la meta diaria de ventas que ya se cumplió. La meta se toma de la configuración o se estima según el ritmo del día.' },
    { key: 'forecast', label: t('forecastFinDia').toUpperCase(), value: fmt(forecastPct), deltaLabel: d.forecast?.elapsed_scale ? `${(d.forecast.elapsed_scale * 100).toFixed(0)}% del día transcurrido` : 'fin de día estimado', icon: ClockIcon, iconColor: 'var(--accent)', tip: 'Cuánto se estima vender al cierre del día según el ritmo actual (lo vendido ÷ fracción de día transcurrida).' },
    { key: 'neto', label: t('neto').toUpperCase(), value: fmt(d.net_total), deltaLabel: `- ${fmt(d.refunds_total)} devoluciones / - ${fmt(d.expenses_total)} gastos`, icon: ScaleIcon, iconColor: d.net_total >= 0 ? 'var(--success)' : 'var(--danger)', highlight: d.net_total > 0, tip: 'Ingresos menos devoluciones y gastos del período. Muestra la rentabilidad real neta del negocio.' },
    { key: 'retencion', label: t('retencion').toUpperCase(), value: `${d.retention?.pct || 0}%`, deltaLabel: `${d.retention?.repeat || 0} de ${d.retention?.total || 0} recompran`, icon: UserGroupIcon, iconColor: 'var(--info)', tip: 'Porcentaje de clientes que hicieron al menos una compra en los 30 días posteriores a su primera compra. Mide la fidelización.' },
  ]

  // Gráfico flujo: usa by_day o series
  const flowLabels = (d.by_day || []).map(x => x.day.slice(5))
  const flowData = {
    labels: flowLabels,
    datasets: [{
      label: 'Ventas',
      data: (d.by_day || []).map(x => Number(x.total) || 0),
      borderColor: accentColor, borderWidth: 2.5, fill: true, tension: 0.4,
      pointRadius: 3, pointHoverRadius: 6, pointBackgroundColor: accentColor,
      pointBorderColor: isDark ? '#14191F' : '#FFFFFF', pointBorderWidth: 2,
      backgroundColor: (ctx) => {
        if (!ctx.chart.chartArea) return `${accentAlpha}0.1)`
        const { top, bottom } = ctx.chart.chartArea
        const g = ctx.chart.ctx.createLinearGradient(0, top, 0, bottom)
        g.addColorStop(0, `${accentAlpha}0.25)`); g.addColorStop(1, `${accentAlpha}0.0)`)
        return g
      },
      onClick: (evt, el) => { if (el.length && (d.by_day || []).length) { const idx = el[0].index; setDrill({ label: (d.by_day)[idx]?.day, total: (d.by_day)[idx]?.total }) } }
    }]
  }

  const areaOpts = {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { display: false },
      tooltip: { backgroundColor: isDark ? '#1E232A' : '#FFF', titleColor: isDark ? '#FFF' : '#111', bodyColor: isDark ? '#94A3B8' : '#6B72', borderColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)', borderWidth: 1, padding: 12, cornerRadius: 10, displayColors: false, callbacks: { label: c => `${c.label}: ${fmt(c.parsed.y)}` } } },
    scales: { x: { grid: { display: false }, ticks: { color: textColor, font: { size: 11 } }, border: { display: false } }, y: { grid: { color: gridColor }, ticks: { color: textColor, font: { size: 11 }, callback: v => fmt(v) }, border: { display: false } } }
  }

  // Barras por hora
  const hourLabels = (d.by_hour || []).map(h => `${String(h.hour).padStart(2, '0')}:00`)
  const hourData = {
    labels: hourLabels,
    datasets: [{
      label: 'Ventas/hora', data: (d.by_hour || []).map(h => Number(h.total) || 0),
      backgroundColor: isDark ? 'rgba(204,255,0,0.55)' : 'rgba(15,36,68,0.6)',
      hoverBackgroundColor: accentColor, borderRadius: 8, maxBarThickness: 42
    }]
  }
  const hourOpts = { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => `${c.label}: ${fmt(c.parsed.y)}` } } }, scales: { x: { grid: { display: false }, ticks: { color: textColor, font: { size: 10 } }, border: { display: false } }, y: { grid: { color: gridColor }, ticks: { color: textColor, font: { size: 10 } }, border: { display: false } } } }

  // Donut categorías
  const donutCat = {
    labels: (d.by_category || []).length ? d.by_category.map(c => c.name) : ['Sin datos'],
    datasets: [{
      data: (d.by_category || []).length ? d.by_category.map(c => Number(c.total) || 0) : [1],
      backgroundColor: isDark ? ['#CCFF00', '#22D3EE', '#A3E635', '#F472B6', '#C084FC', '#FBBF24', '#FB7185'] : ['#0F2444', '#0EA5E9', '#059669', '#D97706', '#DC2626', '#7C3AED', '#EC4899'],
      borderWidth: 0, hoverOffset: 6
    }]
  }
  const donutOpts = { responsive: true, maintainAspectRatio: false, cutout: '70%', plugins: { legend: { position: 'bottom', labels: { color: textColor, padding: 10, usePointStyle: true, pointStyle: 'circle', font: { size: 11 } } }, tooltip: { backgroundColor: isDark ? '#1E232A' : '#FFF', callbacks: { label: c => ` ${c.label}: ${fmt(c.parsed)}` } } } }

  // donut métodos de pago
  const donutPay = {
    labels: (d.by_method || []).map(m => m.method),
    datasets: [{
      data: (d.by_method || []).map(m => Number(m.total) || 0),
      backgroundColor: isDark ? ['#CCFF00', '#22D3EE', '#F472B6', '#34D399', '#A78BFA', '#FBBF24'] : ['#0F2444', '#0EA5E9', '#EC4899', '#059669', '#7C3AED', '#D97706'],
      borderWidth: 0
    }]
  }

  // Top productos (barras horizontales)
  const topProducts = (d.top_products || []).slice(0, 8)
  const prodBar = {
    labels: topProducts.map(p => p.product_name),
    datasets: [{
      data: topProducts.map(p => Number(p.total) || 0),
      backgroundColor: isDark ? 'rgba(204,255,0,0.6)' : 'rgba(15,36,68,0.7)',
      hoverBackgroundColor: accentColor, borderRadius: 100, borderSkipped: false, maxBarThickness: 30
    }]
  }
  const prodOpts = { indexAxis: 'y', responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => `${c.label}: ${fmt(c.parsed.x)}` } } }, scales: { x: { grid: { color: gridColor }, ticks: { color: textColor, font: { size: 10 }, callback: v => fmt(v) }, border: { display: false } }, y: { grid: { display: false }, ticks: { color: textColor, font: { size: 11 } }, border: { display: false } } } }

  // Heatmap 7x24
  const heat = d.heatmap || []
  const heatMap = []
  for (let dow = 0; dow < 7; dow++) {
    for (let h = 0; h < 24; h++) {
      const cell = heat.find(x => x.dow === dow && x.hour === h)
      heatMap.push({ dow, h, count: cell?.count || 0, total: cell?.total || 0 })
    }
  }
  const maxH = Math.max(...heatMap.map(x => x.total), 1)
  const heatColors = heatMap.map(x => {
    const i = x.total / maxH
    return i === 0 ? (isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.03)') : `rgba(204,255,0,${(0.25 + i * 0.75).toFixed(2)})`
  })
  const heatData = {
    labels: Array.from({ length: 24 }, (_, i) => `${i}h`),
    datasets: [{
      data: heatMap.map(x => x.total || 0),
      backgroundColor: heatColors, borderRadius: 3
    }]
  }
  const heatOpts = { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { title: items => { const c = heatMap[items[0].dataIndex]; return `${WEEKDAYS[c.dow]} ${c.h}:00` }, label: c => `${fmt(c.parsed.y)} · ${heatMap[c.dataIndex].count} ventas` } } }, scales: { x: { grid: { display: false }, ticks: { color: textColor, font: { size: 9 }, maxRotation: 0, autoSkip: true, maxTicksLimit: 12 }, border: { display: false } }, y: { grid: { display: false }, ticks: { color: textColor, font: { size: 10 }, callback: v => WEEKDAYS[v] }, border: { display: false } } } }

  const isFocus = focus === true

  const widgetKeys = [
    { key: 'flow', label: t('flujoDeVentas'), comp: (
      <div className="card" style={{ gridColumn: 'span 2' }}>
        <h3>{t('flujoDeVentas')} · {isRange ? `${time.from} → ${time.to}` : isLive ? t('enVivo') : t('hoy')}</h3>
        <div style={{ height: 250 }}>{flowLabels.length ? <Line data={flowData} options={areaOpts} /> : <div className="empty">Sin datos en este período</div>}</div>
      </div>
    )},
    { key: 'metaGauge', label: t('meta'), comp: (
      <div className="card">
        <h3>{t('meta')}</h3>
        <div style={{ textAlign: 'center' }}>
          <div style={{ position: 'relative', width: 150, height: 150, margin: '0 auto' }}>
            <DonutGauge pct={metaProgress} color={accentColor} />
            <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
              <span style={{ fontSize: 28, fontWeight: 800, color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>{metaProgress.toFixed(0)}%</span>
              <span style={{ fontSize: 11, color: 'var(--muted)' }}>{fmt(d.today_sales)}</span>
            </div>
          </div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8 }}>Meta {fmt(d.meta_diaria)}</div>
        </div>
      </div>
    )},
    { key: 'hour', label: t('porHora'), comp: (
      <div className="card">
        <h3>{t('porHora')}</h3>
        <div style={{ height: 160 }}>{hourLabels.length ? <Bar data={hourData} options={hourOpts} /> : <div className="empty">Sin datos</div>}</div>
      </div>
    )},
    { key: 'cat', label: t('porCategoria'), comp: (
      <div className="card">
        <h3>{t('porCategoria')}</h3>
        <div style={{ height: 230 }}>{(d.by_category || []).length ? <Doughnut data={donutCat} options={donutOpts} /> : <div className="empty">Sin datos</div>}</div>
      </div>
    )},
    { key: 'pay', label: t('metodosDePago'), comp: (
      <div className="card">
        <h3>{t('metodosDePago')}</h3>
        <div style={{ height: 200 }}>{(d.by_method || []).length ? <Doughnut data={donutPay} options={{ ...donutOpts, cutout: '68%' }} /> : <div className="empty">Sin pagos</div>}</div>
      </div>
    )},
    { key: 'html', label: 'Actividad por hora/día', comp: (
      <div className="card">
        <h3>{t('heatmap')}</h3>
        <div style={{ height: 170 }}><Bar data={heatData} options={heatOpts} /></div>
      </div>
    )},
    { key: 'products', label: 'Top productos', comp: (
      <div className="card">
        <h3 style={{ display: 'flex', justifyContent: 'space-between' }}><span>{t('topProductos')}</span><button className="btn sm ghost" onClick={() => navigate('/inventory')}>{t('verInventario')}</button></h3>
        <div style={{ height: 240 }}>{topProducts.length ? <Bar data={prodBar} options={prodOpts} /> : <div className="empty">Sin ventas</div>}</div>
      </div>
    )},
    { key: 'treemap', label: t('treemapProductos'), comp: (
      <div className="card">
        <h3>{t('treemapProductos')}</h3>
        {(d.top_products || []).length ? <Treemap items={d.top_products} max={d.today_sales || 1} /> : <div className="empty">Sin ventas</div>}
      </div>
    )},
    { key: 'funnel', label: t('embudoConversion'), comp: (
      <div className="card">
        <h3>{t('embudoConversion')}</h3>
        <Funnel clients={d.clients} customers={d.retention?.total || 0} sales={d.today_count} avgTicket={d.avg_ticket} />
      </div>
    )},
    { key: 'sellers', label: t('vendedores'), comp: (
      <div className="card">
        <h3>{t('vendedores')}</h3>
        {(d.by_seller || []).length ? (
          <div>
            {(d.by_seller || []).map(s => {
              const pct = d.today_sales > 0 ? (s.total / d.today_sales) * 100 : 0
              return (
                <div key={s.seller} style={{ marginBottom: 12 }}>
                  <div className="row-between" style={{ marginBottom: 4 }}><strong style={{ fontSize: 13 }}>{s.seller}</strong><span style={{ fontSize: 12, fontVariantNumeric: 'tabular-nums' }}>{fmt(s.total)} · {s.count} ventas</span></div>
                  <div style={{ height: 6, borderRadius: 99, background: 'var(--bg)' }}>
                    <div style={{ height: 6, borderRadius: 99, width: `${pct}%`, background: accentColor }} />
                  </div>
                </div>
              )
            })}
          </div>
        ) : <div className="empty">Sin ventas</div>}
      </div>
    )},
    { key: 'clients', label: t('topClientes'), comp: (
      <div className="card">
        <h3>{t('topClientes')}</h3>
        {(d.top_clients || []).length ? (
          <table><thead><tr><th>Cliente</th><th>Ventas</th><th>Total</th></tr></thead><tbody>
            {(d.top_clients || []).slice(0, 5).map(c => <tr key={c.name}><td>{c.name}</td><td>{c.count}</td><td style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--success)' }}>{fet(c.total)}</td></tr>)}
          </tbody></table>
        ) : <div className="empty">Sin clientes</div>}
      </div>
    )},
    { key: 'compare', label: 'Comparativa A/B', comp: (
      <div className="card" style={{ gridColumn: 'span 2' }}>
        <h3 style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
          <span>{t('comparativa')}</span>
          {abD && <span className={`badge ${abD.delta_pct >= 0 ? 'success' : 'danger'}`} style={{ fontVariantNumeric: 'tabular-nums' }}>{abD.a.total > 0 ? 'A vs B: ' : ''}{abD.delta_pct >= 0 ? '+' : ''}{abD.delta_pct}%</span>}
        </h3>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
          <ComparePicker label="Período A" value={compareAB?.a} onChange={a => saveAB(c => ({ ...c, a }))} accent={accentColor} />
          <ComparePicker label="Período B" value={compareAB?.b} onChange={b => saveAB(c => ({ ...c, b }))} accent={isDark ? '#22D3EE' : '#0EA5E9'} />
          <button className="btn sm" onClick={async () => {
            if (!compareAB?.a?.from || !compareAB?.a?.to || !compareAB?.b?.from || !compareAB?.b?.to) return
            try { const r = await api('/dashboard/compare', { query: { a_from: compareAB.a.from, a_to: compareAB.a.to, b_from: compareAB.b.from, b_to: compareAB.b.to } }); setAbD(prev => { localStorage.setItem('posv_compare_abD', JSON.stringify(r)); return r }) } catch (e) { setAbD(null); localStorage.removeItem('posv_compare_abD') }
          }}>{t('comparar')}</button>
        </div>
        {abD && abD.a.total > 0 && (
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <div className="stat" style={{ flex: 1, minWidth: 120 }}><span className="label">A · {abD.a.count} ventas</span><span className="value small" style={{ color: accentColor, fontVariantNumeric: 'tabular-nums' }}>{fmt(abD.a.total)}</span></div>
            <div className="stat" style={{ flex: 1, minWidth: 120 }}><span className="label">B · {abD.b.count} ventas</span><span className="value small" style={{ color: isDark ? '#22D3EE' : '#0EA5E9', fontVariantNumeric: 'tabular-nums' }}>{fmt(abD.b.total)}</span></div>
            <div className="stat" style={{ flex: 1, minWidth: 120 }}><span className="label">Ticket A</span><span className="value small" style={{ fontVariantNumeric: 'tabular-nums' }}>{fmt(abD.a.avg)}</span></div>
            <div className="stat" style={{ flex: 1, minWidth: 120 }}><span className="label">Ticket B</span><span className="value small" style={{ fontVariantNumeric: 'tabular-nums' }}>{fmt(abD.b.avg)}</span></div>
          </div>
        )}
        {abD && <div style={{ height: 200, marginTop: 10 }}><ComparativaChart a={abD.a.daily} b={abD.b.daily} accentA={accentColor} accentB={isDark ? '#22D3EE' : '#0EA5E9'} textColor={textColor} gridColor={gridColor} /></div>}
      </div>
    )},
    { key: 'inactive', label: t('clientesInactivos'), comp: (
      <div className="card">
        <h3>{t('clientesInactivos')}</h3>
        {(d.inactive_clients || []).length ? (
          (d.inactive_clients || []).slice(0, 5).map(c => (
            <div key={c.name} className="row-between" style={{ padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
              <span style={{ fontSize: 13 }}>{c.name}</span>
              <span style={{ fontSize: 12, color: 'var(--warning)' }}>sin compra {c.days} días</span>
            </div>
          ))
        ) : <div className="empty">Todos activos</div>}
      </div>
    )},
    { key: 'stock', label: t('stockCritico'), comp: (
      <div className="card">
        <h3>{t('stockCritico')}</h3>
        {(d.low_stock_list || []).length ? (
          (d.low_stock_list || []).slice(0, 5).map(p => (
            <div key={p.name} className="row-between" style={{ padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
              <span style={{ fontSize: 13 }}>{p.name}</span>
              <span className="badge danger">{p.stock} {p.unit} (mín {p.stock_min})</span>
            </div>
          ))
        ) : <div className="empty">Sin productos críticos</div>}
      </div>
    )},
    { key: 'feed', label: t('feedEnVivo'), comp: (
      <div className="card" style={{ gridColumn: 'span 2' }}>
        <h3 style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}><BoltIcon style={{ width: 16, height: 16, color: 'var(--primary)' }} />Transacciones Recientes</span>
          <span style={{ fontSize: 11, color: 'var(--muted)' }}>{(d.recent || []).length} operaciones</span>
        </h3>
        <div style={{ maxHeight: 320, overflowY: 'auto' }}>
          {(d.recent || []).length ? d.recent.slice(0, 10).map(tx => <TxRow key={tx.id} tx={tx} mask={masked} />) : <div className="empty">Sin transacciones</div>}
        </div>
      </div>
    )},
  ]

  const visibleWidgets = widgetKeys.filter(w => widgets[w.key] !== false)

  const maskedVal = masked ? '••••••' : null

  return (
    <>
      <style>{`
        @keyframes livePulse { 0%,100%{transform:scale(1);opacity:.4} 50%{transform:scale(1.8);opacity:0} }
        .pulse-dot-active { position:relative; display:inline-flex; width:8px; height:8px; border-radius:50%; background:var(--success) }
        .pulse-dot-active::after { content:''; position:absolute; inset:0; border-radius:50%; background:var(--success); animation:livePulse 2s infinite }
        ${bigFont ? 'body{font-size:1.06em}' : ''}
      `}</style>

      <div style={{ marginBottom: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {/* Header */}
        <div className="card" style={{ padding: '16px 20px', margin: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              {isLive && <span className="pulse-dot-active" />}
              <div>
                <h1 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>
                  {t('panelDeVentas')}{isLive ? ' · ' + t('enVivo') : ''}
                </h1>
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                  {today}
                  {isLive && lastUpdate && ` · Actualizado ${relativeTime(lastUpdate.toISOString())}`}
                  {isRange && ` · ${time.from} → ${time.to}`}
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <TimeSelector value={time} onChange={setTime} onCommit={commit} />
              <button onClick={() => setFocus(f => !f)} title="Modo foco (ocultar sidebar)" className={`btn sm ghost ${isFocus ? 'active' : ''}`}>
                {isFocus ? <EyeSlashIcon style={{ width: 15, height: 15 }} /> : <EyeIcon style={{ width: 15, height: 15 }} />}
              </button>
              <button onClick={exportCSV} title="Exportar CSV" className="btn sm ghost"><ArrowDownTrayIcon style={{ width: 15, height: 15 }} /></button>
              <button onClick={() => { setMasked(m => !m); localStorage.setItem('posv_dash_mask', masked ? '0' : '1') }} title="Enmascarar montos" className="btn sm ghost">
                {masked ? <EyeSlashIcon style={{ width: 15, height: 15 }} /> : <EyeIcon style={{ width: 15, height: 15 }} />}
              </button>
              <button onClick={() => setBigFont(b => { localStorage.setItem('posv_bigfont', b ? '0' : '1'); return !b })} title="Fuente grande" className={`btn sm ghost ${bigFont ? 'active' : ''}`} style={bigFont ? { color: 'var(--primary)', borderColor: 'var(--primary)' } : {}}>A<sup>+</sup></button>
              <button onClick={() => setCashier(c => { localStorage.setItem('posv_cashier', c ? '0' : '1'); return !c })} title={cashier ? 'Modo cajero activo (oculta costos/márgenes)' : 'Activar modo cajero'} className={`btn sm ghost ${cashier ? 'active' : ''}`} style={cashier ? { color: 'var(--info)', borderColor: 'var(--info)' } : {}}>
                {cashier ? <CheckCircleIcon style={{ width: 15, height: 15 }} /> : <ShoppingCartIcon style={{ width: 15, height: 15 }} />} <span style={{ fontSize: 11 }}>{t('cajero')}</span>
              </button>
              <button onClick={() => setLang(lang === 'es' ? 'en' : 'es')} title="Idioma / Language" className="btn sm ghost" style={{ minWidth: 34 }}>{lang === 'es' ? 'EN' : 'ES'}</button>
              <WidgetConfig onChange={w => { setWidgets(w); localStorage.setItem('posv_dash_widgets', JSON.stringify(w)) }} hidden={widgets} />
            </div>
          </div>
        </div>

        {/* KPI fila 1 */}
        <div className="grid g4">
          {kpis1.map(k => (widgets[k.key] === false || (cashier && k.key === 'utilidad')) ? null : (
            <div key={k.key} className="card stat" style={{ ...(k.highlight ? { borderColor: 'var(--primary)', background: 'linear-gradient(135deg,var(--card),var(--card-hover))' } : {}) }}>
              <div className="row-between">
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span className="label">{k.label}</span>
                  {k.tip && <KpiTip text={k.tip} />}
                </span>
                <k.icon style={{ width: 18, height: 18, color: k.iconColor, opacity: .8 }} />
              </div>
              <div className="row-between" style={{ alignItems: 'flex-end' }}>
                <span className={`value ${k.highlight ? 'success-text' : ''}`} style={{ fontVariantNumeric: 'tabular-nums' }}>{masked ? maskedVal : k.value}</span>
                {k.spark?.length > 1 && <Sparkline data={k.spark} color={k.iconColor || 'var(--primary)'} />}
              </div>
              {k.delta !== undefined && (
                <span className={`delta ${k.delta >= 0 ? 'up' : 'down'}`}>
                  {k.delta >= 0 ? <ArrowUpRightIcon style={{ width: 12, height: 12 }} /> : <ArrowTrendingUpIcon style={{ width: 12, height: 12, transform: 'rotate(180deg)' }} />}
                  {Math.abs(k.delta)}%
                </span>
              )}
              <div className="muted" style={{ fontSize: 11 }}>{k.deltaLabel}</div>
            </div>
          ))}
        </div>

        {/* KPI fila 2 */}
        <div className="grid g4">
          {kpis2.map(k => widgets[k.key] === false ? null : (
            <div key={k.key} className={`card stat ${k.highlight ? 'highlight-glow' : ''}`}>
              <div className="row-between">
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span className="label">{k.label}</span>
                  {k.tip && <KpiTip text={k.tip} />}
                </span>
                <k.icon style={{ width: 18, height: 18, color: k.iconColor, opacity: .8 }} />
              </div>
              <span className="value" style={{ fontVariantNumeric: 'tabular-nums', color: k.highlight ? 'var(--success)' : undefined }}>{masked ? maskedVal : k.value}</span>
              <div className="muted" style={{ fontSize: 11 }}>{k.deltaLabel}</div>
            </div>
          ))}
        </div>

        {/* Widgets principales */}
        <div className="grid" style={{ gridTemplateColumns: 'repeat(4,1fr)', alignItems: 'start' }}>
          {visibleWidgets.map(w => <div key={w.key} style={{ display: 'contents' }}>{w.comp}</div>)}
        </div>

        {/* Drill-down modal */}
        {drill && (
          <div style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setDrill(null)}>
            <div className="card" style={{ width: 340 }} onClick={e => e.stopPropagation()}>
              <h3>Detalle · {drill.label}</h3>
              <div style={{ padding: 12, textAlign: 'center' }}>
                <div className="muted" style={{ marginBottom: 6 }}>Ventas del día</div>
                <div style={{ fontSize: 28, fontWeight: 800, color: 'var(--success)', fontVariantNumeric: 'tabular-nums' }}>{fmt(drill.total)}</div>
                <button className="btn sm mt12" onClick={() => { navigate('/sales'); setDrill(null) }}>Ver ventas</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  )
}

function ComparePicker({ label, value, onChange, accent }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, background: 'var(--bg)', padding: '4px 10px', borderRadius: 10, border: `1px solid ${accent}` }}>
      <span style={{ fontWeight: 700, color: accent }}>{label}</span>
      <input type="date" value={value?.from || ''} onChange={e => onChange({ ...(value || {}), from: e.target.value })} style={{ background: 'transparent', border: 'none', color: 'var(--text)', fontSize: 12, outline: 'none' }} />
      <span className="muted">→</span>
      <input type="date" value={value?.to || ''} onChange={e => onChange({ ...(value || {}), to: e.target.value })} style={{ background: 'transparent', border: 'none', color: 'var(--text)', fontSize: 12, outline: 'none' }} />
    </label>
  )
}

function ComparativaChart({ a, b, accentA, accentB, textColor, gridColor }) {
  const allLabels = [...new Set([...(a || []).map(x => x.day), ...(b || []).map(x => x.day)])].sort()
  const aMap = Object.fromEntries((a || []).map(x => [x.day, x.total]))
  const bMap = Object.fromEntries((b || []).map(x => [x.day, x.total]))
  const aMax = allLabels.length ? Math.max(...allLabels.map(l => aMap[l] || 0)) : 0
  const bMax = allLabels.length ? Math.max(...allLabels.map(l => bMap[l] || 0)) : 0
  const max = Math.max(aMax, bMax, 1)
  const w = 100
  return (
    <svg viewBox={`-10 -8 ${w + 20} 108`} style={{ width: '100%', height: '100%' }} preserveAspectRatio="none">
      {[0.25, 0.5, 0.75].map(f => <line key={f} x1="0" y1={f * 100} x2={w} y2={f * 100} stroke={gridColor} strokeDasharray="3 3" />)}
      {allLabels.map((day, i) => {
        const x = allLabels.length > 1 ? (i / (allLabels.length - 1)) * w : w / 2
        return (
          <g key={day}>
            <line x1={x} y1="0" x2={x} y2="100" stroke={gridColor} strokeDasharray="2 2" />
            {allLabels.length < 12 && <text x={x} y="104" textAnchor="middle" fontSize="3" fill={textColor}>{day}</text>}
            <circle cx={x} cy={100 - ((aMap[day] || 0) / max) * 100} r="1.4" fill={accentA} />
            <circle cx={x} cy={100 - ((bMap[day] || 0) / max) * 100} r="1.4" fill={accentB} />
          </g>
        )
      })}
      <polyline points={allLabels.map((day, i) => `${allLabels.length > 1 ? (i / (allLabels.length - 1)) * w : w / 2},${100 - ((aMap[day] || 0) / max) * 100}`).join(' ')} fill="none" stroke={accentA} strokeWidth="2" strokeLinejoin="round" />
      <polyline points={allLabels.map((day, i) => `${allLabels.length > 1 ? (i / (allLabels.length - 1)) * w : w / 2},${100 - ((bMap[day] || 0) / max) * 100}`).join(' ')} fill="none" stroke={accentB} strokeWidth="2" strokeLinejoin="round" />
      <text x="98" y="4" textAnchor="end" fontSize="4" fill={accentA} fontWeight="bold">A</text>
      <text x="98" y="12" textAnchor="end" fontSize="4" fill={accentB} fontWeight="bold">B</text>
    </svg>
  )
}

// Treemap simple (squarified-lite) en SVG puro
function Treemap({ items, max }) {
  const data = items.map(x => ({ label: x.product_name, value: Number(x.total) || 0 })).filter(x => x.value > 0)
  if (!data.length) return <div className="empty">Sin ventas</div>
  const total = data.reduce((a, x) => a + x.value, 0)
  const W = 320, H = 160
  const area = W * H
  let cursor = 0
  let y = 0
  const cells = []
  let rowX = 0
  let rowY = 0
  let rowW = W
  let rowH = H
  const remaining = [...data]
  // simple strip layout
  while (remaining.length) {
    const item = remaining.shift()
    const frac = total > 0 ? item.value / total : 0
    const w = rowW * frac
    const h = rowH
    cells.push({ ...item, x: rowX, y: rowY, w, h, frac })
    rowX += w
    if (rowX >= W - 0.5) { rowY += 0; rowX = 0 }
  }
  // simpler: horizontal strips proportional to frac
  const strips = []
  let acc = 0
  for (const it of data) {
    const frac = total > 0 ? it.value / total : 0
    strips.push({ ...it, x: acc / total * W, w: frac * W, frac })
    acc += it.value
  }
  return (
    <div>
      <svg viewBox={`-2 -2 ${W + 4} ${H + 4}`} style={{ width: '100%', height: '100%', maxHeight: 180 }} preserveAspectRatio="none">
        {strips.map((s, i) => (
          <g key={s.label + i}>
            <rect x={s.x} y={0} width={Math.max(s.w - 2, 4)} height={H - 6} rx="4" fill={`rgba(204,255,0,${(0.2 + s.frac * 0.8).toFixed(2)})`} stroke="var(--card)" strokeWidth="1" />
            <text x={s.x + 6} y={14} fontSize="9" fontWeight="bold" fill={s.frac > 0.2 ? '#0B0E11' : '#fff'}>{s.label}</text>
            <text x={s.x + 6} y={26} fontSize="8" fill={s.frac > 0.2 ? '#0B0E11' : '#ddd'}>{fmt(s.value)}</text>
          </g>
        ))}
      </svg>
      <div className="muted" style={{ fontSize: 10, marginTop: 4 }}>Ancho ∝ ventas de cada producto · total {fmt(total)}</div>
    </div>
  )
}

// Embudo de conversión (SVG)
function Funnel({ clients, customers, sales, avgTicket }) {
  const stages = [
    { label: 'Clientes registrados', value: clients || 0 },
    { label: 'Compraron en el período', value: customers || 0 },
    { label: 'Tickets emitidos', value: sales || 0 },
  ]
  const maxVal = Math.max(...stages.map(s => s.value), 1)
  return (
    <div>
      {stages.map((s, i) => {
        const w = 100 - i * 24
        const pct = ((s.value / maxVal) * 100).toFixed(0)
        return (
          <div key={s.label} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: 6 }}>
            <div style={{
              width: `${w}%`, background: `linear-gradient(90deg, var(--primary), ${i === 0 ? 'rgba(204,255,0,0.2)' : i === 1 ? 'rgba(204,255,0,0.35)' : 'rgba(204,255,0,0.5)'})`,
              color: '#0B0E11', fontWeight: 700, textAlign: 'center', padding: '6px 0', borderRadius: 6,
              fontSize: 12, fontVariantNumeric: 'tabular-nums'
            }}>
              {s.value} <span style={{ fontWeight: 400, opacity: 0.7 }}>({pct}%)</span>
            </div>
            <span className="muted" style={{ fontSize: 10, marginTop: 2 }}>{s.label}</span>
          </div>
        )
      })}
      <div className="muted" style={{ fontSize: 10, textAlign: 'center', marginTop: 4 }}>Ticket promedio: <strong style={{ color: 'var(--success)' }}>{fmt(avgTicket)}</strong></div>
    </div>
  )
}

function KpiTip({ text }) {
  const [show, setShow] = useState(false)
  return (
    <span style={{ position: 'relative', display: 'inline-flex', cursor: 'help' }}
      onMouseEnter={() => setShow(true)} onMouseLeave={() => setShow(false)}>
      <svg width="13" height="13" viewBox="0 0 20 20" fill="currentColor" style={{ color: 'var(--muted)' }}>
        <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-8-3a1 1 0 10.002-2A1 1 0 0010 7zm1 8a1 1 0 11-2 0v-4a1 1 0 112 0v4z" clipRule="evenodd" />
      </svg>
      {show && (
        <span style={{ position: 'absolute', bottom: 'calc(100% + 6px)', left: 0, zIndex: 300, width: 220, background: 'var(--card-hover)', border: '1px solid var(--border-strong)', borderRadius: 10, padding: 8, fontSize: 11, lineHeight: 1.4, color: 'var(--text-secondary)', fontWeight: 400, letterSpacing: 0, textTransform: 'none' }}>
          {text}
        </span>
      )}
    </span>
  )
}

function WidgetConfig({ hidden, onChange }) {
  const [open, setOpen] = useState(false)
  const { t } = useI18n()
  const L = {
    flow: t('flujoDeVentas'), metaGauge: t('meta'), hour: t('porHora'), cat: t('porCategoria'),
    pay: t('metodosDePago'), html: t('heatmap'), products: t('topProductos'), treemap: t('treemapProductos'), funnel: t('embudoConversion'), sellers: t('vendedores'),
    clients: t('topClientes'), compare: 'Comparativa A/B', inactive: t('clientesInactivos'), stock: t('stockCritico'), feed: t('feedEnVivo'),
    ingresos: 'KPI ' + t('ingresos'), ventas: 'KPI ' + t('transacciones'), ticket: 'KPI ' + t('ticket'), utilidad: 'KPI ' + t('utilidad'),
    meta: 'KPI ' + t('meta'), forecast: 'KPI ' + t('forecastFinDia'), neto: 'KPI ' + t('neto'), retencion: 'KPI ' + t('retencion'),
  }
  const items = Object.keys(L).map(k => [k, L[k]])
  return (
    <div style={{ position: 'relative' }}>
      <button onClick={() => setOpen(o => !o)} title="Configurar widgets" className="btn sm ghost"><AdjustmentsHorizontalIcon style={{ width: 15, height: 15 }} /></button>
      {open && (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 90 }} onClick={() => setOpen(false)} />
          <div style={{ position: 'absolute', right: 0, top: 'calc(100% + 8px)', zIndex: 100, width: 240, background: 'var(--card-hover)', border: '1px solid var(--border-strong)', borderRadius: 14, padding: 12, boxShadow: '0 20px 50px rgba(0,0,0,0.5)', maxHeight: 380, overflowY: 'auto' }}>
            <div className="muted" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>Mostrar widgets</div>
            {items.map(([k, label]) => (
              <label key={k} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', fontSize: 13, cursor: 'pointer' }}>
                <input type="checkbox" checked={hidden[k] !== false} onChange={e => onChange({ ...hidden, [k]: e.target.checked ? undefined : false })} />
                {label}
              </label>
            ))}
            <button className="btn sm full" style={{ marginTop: 8 }} onClick={() => { onChange({}); setOpen(false) }}>Restablecer todo</button>
          </div>
        </>
      )}
    </div>
  )
}

function DonutGauge({ pct, color }) {
  const r = 60, c = 2 * Math.PI * r
  const spent = (pct / 100) * c
  return (
    <svg width="150" height="150" viewBox="0 0 150 150">
      <circle cx="75" cy="75" r={r} fill="none" stroke="var(--bg)" strokeWidth="14" />
      <circle cx="75" cy="75" r={r} fill="none" stroke={color} strokeWidth="14" strokeLinecap="round"
        strokeDasharray={`${spent} ${c - spent}`} transform="rotate(-90 75 75)" opacity="0.9"
        style={{ transition: 'stroke-dasharray 0.6s ease' }} />
    </svg>
  )
}

function Sparkline({ data, color = 'var(--primary)', height = 30, width = 70 }) {
  if (!data || data.length < 2) return null
  const max = Math.max(...data, 1), min = Math.min(...data, 0)
  const range = max - min || 1
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * width},${height - 4 - ((v - min) / range) * (height - 6)}`).join(' ')
  return <svg width={width} height={height} style={{ display: 'block' }}><polyline points={pts} fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
}

function TxRow({ tx, mask }) {
  const initial = (tx.seller || 'U')[0].toUpperCase()
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
      <div style={{ width: 36, height: 36, borderRadius: 10, background: 'var(--primary-dim)', color: 'var(--primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, flexShrink: 0 }}>{initial}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>{tx.folio}{tx.source === 'BOT' && <span className="badge info" style={{ marginLeft: 6, fontSize: 10 }}>bot</span>}</div>
        <div className="muted" style={{ fontSize: 12 }}>{tx.seller} · {relativeTime(tx.created_at)}</div>
      </div>
      <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--success)', fontVariantNumeric: 'tabular-nums' }}>{mask ? '••••' : `+${fmt(tx.total)}`}</div>
    </div>
  )
}

// helper para $ en tabla
function fet(n) { const s = localStorage.getItem('posv_symbol') || '$'; return s + (Number(n) || 0).toLocaleString('es', { minimumFractionDigits: 2 }) }

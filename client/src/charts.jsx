import React, { useState } from 'react'

// Barras SVG interactivas: clic en una barra invoca onSelect(dato)
export function Bars({ data, xKey = 'day', yKey = 'total', format = n => n, height = 180, onClick }) {
  const [sel, setSel] = useState(null)
  const values = (data || []).map(d => Number(d[yKey]) || 0)
  const max = Math.max(...values, 1)
  const W = 620, H = height, pad = 26
  const bw = data?.length ? Math.min(56, (W - pad * 2) / data.length) : 0
  const labelX = xKey === 'day' ? d => { const [, m, dd] = String(d).split('-'); return `${dd}/${m}` } : d => String(d).slice(0, 10)

  return (
    <div className="chart">
      {data?.length === 0 && <div className="empty">Sin datos</div>}
      <svg viewBox={`0 0 ${W} ${H + 40}`} style={{ width: '100%', display: 'block' }}>
        {data?.map((d, i) => {
          const v = Number(d[yKey]) || 0
          const h = (v / max) * (H - pad)
          const x = pad + i * bw + bw * 0.12
          const isSel = sel === i
          const cx = x + bw * 0.38
          return (
            <g key={i} className="ch-bar" opacity={isSel ? 1 : 0.9}
              onMouseEnter={() => setSel(i)} onMouseLeave={() => setSel(null)}
              onClick={() => { setSel(i); onClick?.(d) }} style={{ cursor: onClick ? 'pointer' : 'default' }}>
              <rect x={x} y={H - h} width={bw * 0.76} height={h} rx={4} />
              {sel === i && (
                <>
                  <rect x={cx - 55} y={H - h - 26} width={110} height={22} rx={4} className="ch-tip" />
                  <text x={cx} y={H - h - 10} textAnchor="middle" className="ch-tip-t">{format(v)}</text>
                </>
              )}
              <text x={cx} y={H + 16} textAnchor="middle" className="ch-axis">{labelX(d[xKey])}</text>
            </g>
          )
        })}
        <line x1={pad} y1={H - 2} x2={W - 6} y2={H - 2} className="ch-axis-line" />
      </svg>
    </div>
  )
}

// Donut SVG con leyenda
export function Donut({ items = [], format = n => n, size = 150 }) {
  const total = items.reduce((a, i) => a + (Number(i.value) || 0), 0)
  const palette = ['#2563eb', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899', '#64748b']
  const r = 62, c = 2 * Math.PI * r
  let acc = 0
  const segs = items.map((it, i) => {
    const frac = total > 0 ? (Number(it.value) || 0) / total : 0
    const dash = frac * c
    const off = acc * c
    acc += frac
    return { ...it, i, color: palette[i % palette.length], dash, off, frac: Math.round(frac * 1000) / 10 }
  })

  if (!total) return <div className="empty" style={{ padding: '20px' }}>Sin datos</div>

  return (
    <div className="flex" style={{ alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
      <svg width={size} height={size} viewBox="0 0 150 150">
        <circle cx={75} cy={75} r={r} fill="none" stroke="var(--border)" strokeWidth={16} />
        {segs.map(s => (
          <circle key={s.i} cx={75} cy={75} r={r} fill="none" stroke={s.color} strokeWidth={16}
            strokeDasharray={`${Math.max(0, s.dash - 1.5)} ${c - s.dash + 1.5}`}
            strokeDashoffset={-s.off} transform="rotate(-90 75 75)" strokeLinecap="round" />
        ))}
        <text x={75} y={72} textAnchor="middle" className="ch-center">{total.toLocaleString('es')}</text>
        <text x={75} y={90} textAnchor="middle" className="ch-center-l">{format(total)}</text>
      </svg>
      <div style={{ display: 'grid', gap: 6 }}>
        {segs.map(s => (
          <div key={s.i} className="row-between" style={{ gap: 10, minWidth: 130 }}>
            <span className="flex" style={{ gap: 6 }}>
              <span style={{ width: 10, height: 10, borderRadius: 3, background: s.color, display: 'inline-block' }} />
              <span className="muted" style={{ textTransform: 'capitalize' }}>{s.label}</span>
            </span>
            <strong>{s.frac}%</strong>
          </div>
        ))}
      </div>
    </div>
  )
}
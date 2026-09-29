import React, { useMemo, useState, useEffect } from 'react'
import { api } from './api.js'
import { fmt } from './fmt.js'
import { branchId } from './branch.js'
import { useI18n } from './i18n.jsx'
import { ChevronLeftIcon, ChevronRightIcon } from '@heroicons/react/24/outline'

const MONTHS_ES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']
const MONTHS_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const DAYS_ES = ['L', 'M', 'X', 'J', 'V', 'S', 'D']
const DAYS_EN = ['M', 'T', 'W', 'T', 'F', 'S', 'S']
const M_INIT_ES = ['E', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D']
const M_INIT_EN = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D']

// Escala de intensidad -> color (verde lima con alfa creciente)
function dayColor(intensity) {
  if (intensity <= 0) return 'transparent'
  const a = 0.15 + intensity * 0.75
  return `rgba(204, 255, 0, ${Math.min(a, 0.95).toFixed(2)})`
}

// Selector de tiempo combinado: pills en vivo + calendario mensual con intensidad + rango
export function TimeSelector({ value, onChange, onCommit }) {
  // value: { mode:'live'|'today'|'day'|'range', from, to }
  const mode = value?.mode || 'today'
  const { t, lang } = useI18n()
  const MONTHS = lang === 'en' ? MONTHS_EN : MONTHS_ES
  const DAYS = lang === 'en' ? DAYS_EN : DAYS_ES
  const M_INIT = lang === 'en' ? M_INIT_EN : M_INIT_ES
  const [open, setOpen] = useState(false)
  const [viewMonth, setViewMonth] = useState(() => {
    const now = new Date()
    return now.getFullYear() * 12 + now.getMonth()
  })
  const [yearData, setYearData] = useState(null)
  const [rangeSel, setRangeSel] = useState([]) // [startISO, endISO]
  const [metric, setMetric] = useState('total') // 'total' (monto $) o 'count' (nº ventas)
  const [selDay, setSelDay] = useState(null) // día seleccionado para anotar
  const [notes, setNotes] = useState(() => {
    try { return JSON.parse(localStorage.getItem('posv_calendar_notes') || '{}') } catch { return {} }
  })
  const [noteText, setNoteText] = useState('')
  const [noteHoliday, setNoteHoliday] = useState(false)

  const saveNotes = (n) => { setNotes(n); localStorage.setItem('posv_calendar_notes', JSON.stringify(n)) }

  const todayISO = new Date().toISOString().slice(0, 10)

  useEffect(() => {
    if (!open) return
    const year = Math.floor(viewMonth / 12)
    const bid = branchId()
    api(`/dashboard/calendar?year=${year}${bid ? `&branch_id=${bid}` : ''}`).then(setYearData).catch(() => setYearData({ days: [], months: [] }))
  }, [open, viewMonth])

  const intensityMap = useMemo(() => {
    const m = {}
    if (!yearData?.days) return m
    const val = d => metric === 'count' ? (Number(d.count) || 0) : (Number(d.total) || 0)
    const totals = yearData.days.filter(d => val(d) > 0)
    const maxTotal = Math.max(...totals.map(d => val(d)), 1)
    for (const d of yearData.days) {
      if (val(d) > 0) m[d.day] = val(d) / maxTotal
    }
    return m
  }, [yearData, metric])

  const monthMax = useMemo(() => {
    if (!yearData?.months) return 1
    const val = x => metric === 'count' ? (Number(x.count) || 0) : (Number(x.total) || 0)
    return Math.max(...yearData.months.map(x => val(x)), 1)
  }, [yearData, metric])

  // Navigate view: month/year base = viewMonth
  const y = Math.floor(viewMonth / 12)
  const mIdx = viewMonth % 12
  const daysInMonth = new Date(y, mIdx + 1, 0).getDate()
  const firstDow = new Date(y, mIdx, 1).getDay() // 0=Dom
  const startOffset = (firstDow + 6) % 7 // semana lunes-domingo

  const cells = []
  for (let i = 0; i < startOffset; i++) cells.push({ blank: true, key: `b${i}` })
  for (let d = 1; d <= daysInMonth; d++) {
    const iso = `${y}-${String(mIdx + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    cells.push({ day: d, iso, key: iso })
  }

  const isInRange = iso => rangeSel.length === 2 && iso >= rangeSel[0] && iso <= rangeSel[1]
  const isSelDay = iso => mode === 'day' && value?.from === iso

  function handlePick(iso) {
    setSelDay(iso)
    const n = notes[iso] || {}
    setNoteText(n.note || '')
    setNoteHoliday(!!n.holiday)
    if (rangeSel.length === 0) { setRangeSel([iso]); return }
    if (rangeSel.length === 1) {
      const ordered = iso < rangeSel[0] ? [iso, rangeSel[0]] : [rangeSel[0], iso]
      setRangeSel(ordered)
      onChange?.({ mode: 'range', from: ordered[0], to: ordered[1] })
      onCommit?.({ mode: 'range', from: ordered[0], to: ordered[1] })
    } else {
      setRangeSel([iso])
    }
  }

  function saveNote() {
    if (!selDay) return
    const next = { ...notes, [selDay]: { note: noteText.trim(), holiday: noteHoliday } }
    if (!noteText.trim() && !noteHoliday) delete next[selDay]
    saveNotes(next)
  }

  function removeNote() {
    if (!selDay) return
    const next = { ...notes }; delete next[selDay]; saveNotes(next)
    setNoteText(''); setNoteHoliday(false)
  }

  function pickDay(iso) {
    setRangeSel([])
    onChange?.({ mode: 'day', from: iso, to: iso })
    onCommit?.({ mode: 'day', from: iso, to: iso })
    setOpen(false)
  }

  function selectRange() {
    if (rangeSel.length === 2) {
      onChange?.({ mode: 'range', from: rangeSel[0], to: rangeSel[1] })
      onCommit?.({ mode: 'range', from: rangeSel[0], to: rangeSel[1] })
      setOpen(false)
    }
  }

  // apply predefined mode
  function setMode(m) {
    setRangeSel([])
    if (m === 'live') { onChange?.({ mode: 'live' }); onCommit?.({ mode: 'live' }); setOpen(false); return }
    if (m === 'today') { onChange?.({ mode: 'today' }); onCommit?.({ mode: 'today' }); setOpen(false); return }
  }

  const label = mode === 'live' ? t('enVivo')
    : mode === 'today' ? t('hoy')
    : mode === 'day' ? value.from
    : mode === 'range' ? `${value.from} → ${value.to}`
    : t('mes')

  return (
    <div style={{ position: 'relative' }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 4,
        background: 'var(--bg)', padding: 3, borderRadius: 999,
        border: '1px solid var(--border)'
      }}>
        <button onClick={() => setMode('live')} style={pillStyle(mode === 'live')}>
          {mode === 'live' && <span className="pulse-dot-active" />}
          {t('enVivo')}
        </button>
        <button onClick={() => setMode('today')} style={pillStyle(mode === 'today')}>{t('hoy')}</button>
        <button onClick={() => setMode('week')} style={pillStyle(false)}>7D</button>
        <button onClick={() => setMode('month')} style={pillStyle(false)}>{t('mes')}</button>
        <button onClick={() => { setOpen(o => !o); setViewMonth(new Date().getFullYear() * 12 + new Date().getMonth()) }}
          style={{ ...pillStyle(false), color: mode === 'day' || mode === 'range' ? 'var(--primary)' : 'var(--text)' }}
          title={t('seleccionarDiaRango')}>
          {label} <span style={{ opacity: 0.6 }}>▾</span>
        </button>
      </div>

      {open && (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 90 }} onClick={() => setOpen(false)} />
          <div style={{
            position: 'absolute', right: 0, top: 'calc(100% + 8px)', zIndex: 100,
            width: 320, background: 'var(--card-hover)', border: '1px solid var(--border-strong)',
            borderRadius: 16, padding: 14, boxShadow: '0 20px 50px rgba(0,0,0,0.5)'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
              <button style={navBtn} onClick={() => setViewMonth(vm => vm - 1)}><ChevronLeftIcon style={{ width: 18, height: 18 }} /></button>
              <strong style={{ fontSize: 13, textTransform: 'capitalize', flex: 1, textAlign: 'center' }}>{MONTHS[mIdx]} {y}</strong>
              <button style={navBtn} onClick={() => setViewMonth(vm => vm + 1)}><ChevronRightIcon style={{ width: 18, height: 18 }} /></button>
              <span style={{ display: 'inline-flex', background: 'var(--bg)', borderRadius: 999, border: '1px solid var(--border)', padding: 2, marginLeft: 2 }}>
                {['total', 'count'].map(m => (
                  <button key={m} onClick={() => setMetric(m)}
                    style={{ border: 'none', background: metric === m ? 'var(--primary)' : 'transparent', color: metric === m ? '#0B0E11' : 'var(--muted)', borderRadius: 999, padding: '2px 8px', fontSize: 10, fontWeight: 700, cursor: 'pointer' }}>
                    {m === 'total' ? '$' : '#'}
                  </button>
                ))}
              </span>
            </div>

            {/* Barra de intensidad de meses del año */}
            <div style={{ display: 'flex', gap: 3, marginBottom: 10 }}>
              {MONTHS.map((mn, i) => {
                const m = String(i + 1).padStart(2, '0')
                const mt = yearData?.months?.find(x => x.month === m)
                const val = metric === 'count' ? (Number(mt?.count) || 0) : (Number(mt?.total) || 0)
                const inten = val > 0 ? (val / Math.max(monthMax, 1)) : 0
                const active = i === mIdx
                const disp = metric === 'count' ? `${val} ${t('hayVentas')}` : fmt(val)
                return (
                  <button key={mn} onClick={() => setViewMonth(y * 12 + i)} title={`${mn}: ${disp}`}
                    style={{
                      flex: 1, height: 22, borderRadius: 4, border: '1px solid var(--border)', cursor: 'pointer',
                      background: inten > 0 ? dayColor(inten) : 'var(--bg)',
                      outline: active ? '1.5px solid var(--info)' : 'none', outlineOffset: -1,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 9, fontWeight: active ? 700 : 500,
                      color: inten > 0.5 ? '#0B0E11' : 'var(--muted)'
                    }}>
                    {M_INIT[i]}
                  </button>
                )
              })}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 2, marginBottom: 4 }}>
              {DAYS.map(d => <div key={d} style={{ textAlign: 'center', fontSize: 10, color: 'var(--muted)', fontWeight: 600 }}>{d}</div>)}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 2 }}>
              {cells.map(c => {
                if (c.blank) return <div key={c.key} style={{ height: 34 }} />
                const inten = intensityMap[c.iso] || 0
                const inRange = isInRange(c.iso)
                const sel = isSelDay(c.iso)
                const isToday = c.iso === todayISO
                return (
                  <button key={c.key} onClick={() => handlePick(c.iso)} onDoubleClick={() => pickDay(c.iso)}
                    title={`${c.iso}${inten > 0 ? (metric === 'count' ? ` · ${yearData.days.find(d => d.day === c.iso)?.count} ${t('hayVentas')}` : ` · ${fmt(yearData.days.find(d => d.day === c.iso)?.total)}`) : ` · ${t('sinVentas')}`}`}
                    style={{
                      height: 34, borderRadius: 8, border: 'none', cursor: 'pointer',
                      fontSize: 12, fontWeight: 600, position: 'relative',
                      background: sel ? 'var(--primary)' : dayColor(inten),
                      color: sel ? '#0B0E11' : inten > 0.5 ? '#0B0E11' : 'var(--text)',
                      outline: inRange ? '1.5px solid var(--info)' : isToday ? '1.5px dashed var(--primary)' : '1.5px solid transparent',
                      outlineOffset: -1
                    }}>
                    {c.day}
                    {(notes[c.iso]?.holiday || notes[c.iso]?.note) && (
                      <span style={{ position: 'absolute', bottom: 3, right: 3, width: 6, height: 6, borderRadius: '50%', background: notes[c.iso]?.holiday ? 'var(--danger)' : 'var(--info)', boxShadow: '0 0 0 1px var(--card-hover)' }} />
                    )}
                  </button>
                )
              })}
            </div>

            {rangeSel.length > 0 && (
              <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <span style={{ fontSize: 11, color: 'var(--muted)' }}>
                  {rangeSel.length === 1 ? `${t('desde')} ${rangeSel[0]}` : `${rangeSel[0]} → ${rangeSel[1]}`}
                </span>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button className="btn sm" onClick={selectRange} disabled={rangeSel.length < 2}>{t('aplicarRango')}</button>
                  <button className="btn sm" onClick={() => setRangeSel([])}>✕</button>
                </div>
              </div>
            )}

            {selDay && (
              <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border)' }}>
                <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--muted)', marginBottom: 6 }}>✏️ {selDay}</div>
                <input value={noteText} onChange={e => setNoteText(e.target.value)} placeholder={t('notaFestivo')}
                  style={{ width: '100%', boxSizing: 'border-box', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, padding: '6px 8px', fontSize: 12, color: 'var(--text)', marginBottom: 6 }} />
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer' }}>
                    <input type="checkbox" checked={noteHoliday} onChange={e => setNoteHoliday(e.target.checked)} /> {t('festivo')}
                  </label>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button className="btn sm" onClick={saveNote}>{t('guardar')}</button>
                    {(notes[selDay]?.note || notes[selDay]?.holiday) && <button className="btn sm ghost" title={t('eliminarNota')} onClick={removeNote}>✕</button>}
                  </div>
                </div>
              </div>
            )}

            <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border)', fontSize: 10, color: 'var(--muted)' }}>
              <span style={{ display: 'inline-block', width: 12, height: 12, background: dayColor(0.2), borderRadius: 3, verticalAlign: 'middle', marginRight: 4 }} />
              {t('pocaActividad')} · <span style={{ display: 'inline-block', width: 12, height: 12, background: dayColor(0.9), borderRadius: 3, verticalAlign: 'middle', marginRight: 4 }} />
              {t('muchoMovimiento')} · {t('dobleClickDia')}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function pillStyle(active) {
  return {
    display: 'inline-flex', alignItems: 'center', gap: 5,
    padding: '6px 12px', borderRadius: 999, border: 'none',
    fontSize: 12, fontWeight: 600, cursor: 'pointer', transition: 'all 0.15s',
    ...(active ? { background: 'var(--primary)', color: '#0B0E11' } : { background: 'transparent', color: 'var(--muted)' })
  }
}
const navBtn = {
  width: 26, height: 26, borderRadius: 8, border: '1px solid var(--border)',
  background: 'var(--card)', color: 'var(--text)', cursor: 'pointer',
  display: 'flex', alignItems: 'center', justifyContent: 'center'
}

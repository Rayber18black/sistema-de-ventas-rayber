export function setCurrency(sym, cur) {
  localStorage.setItem('posv_symbol', sym || '$')
  localStorage.setItem('posv_currency', cur || 'USD')
}

export function fmt(n) {
  const symbol = localStorage.getItem('posv_symbol') || '$'
  const num = Number(n) || 0
  return symbol + num.toLocaleString('es', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function fmtDate(d) {
  if (!d) return ''
  return new Date(d + (d.includes('T') ? '' : 'T00:00:00')).toLocaleString('es', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })
}
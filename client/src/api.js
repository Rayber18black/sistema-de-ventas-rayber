const BASE = '/api'

let token = localStorage.getItem('posv_token') || null
let cachedUser = null

export function setToken(t) {
  token = t
  if (t) localStorage.setItem('posv_token', t)
  else localStorage.removeItem('posv_token')
}

export function getToken() { return token }

export function setUser(u) { cachedUser = u }
export function getUser() {
  if (cachedUser) return cachedUser
  const s = localStorage.getItem('posv_user')
  if (!s) return null
  try { return JSON.parse(s) } catch (e) {
    localStorage.removeItem('posv_user')
    return null
  }
}

export async function api(path, { method = 'GET', body, query } = {}) {
  let url = BASE + path
  if (query) {
    const qs = new URLSearchParams()
    for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null && v !== '') qs.set(k, v)
    const s = qs.toString()
    if (s) url += '?' + s
  }
  const res = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: body !== undefined ? JSON.stringify(body) : undefined
  })
  if (res.status === 401 && path !== '/auth/login') {
    setToken(null)
    cachedUser = null
    localStorage.removeItem('posv_user')
    window.location.href = '/'
    throw new Error('Sesión expirada')
  }
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || 'Error de servidor')
  return data
}
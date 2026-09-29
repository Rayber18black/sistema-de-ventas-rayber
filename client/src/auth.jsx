import React, { createContext, useContext, useEffect, useState } from 'react'
import { api, setToken, setUser, getUser } from './api.js'

const Ctx = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUserState] = useState(getUser())
  const [ready, setReady] = useState(false)

  useEffect(() => {
    (async () => {
      const saved = localStorage.getItem('posv_token')
      if (saved) {
        setToken(saved)
        try {
          const me = await api('/auth/me')
          setUser(me.user)
          setUserState(me.user)
        } catch { /* sin sesión */ }
      }
      setReady(true)
    })()
  }, [])

  async function login(username, password) {
    const data = await api('/auth/login', { method: 'POST', body: { username, password } })
    setToken(data.token)
    setUser(data.user)
    setUserState(data.user)
    localStorage.setItem('posv_user', JSON.stringify(data.user))
    return data.user
  }

  function logout() {
    setToken(null)
    setUser(null)
    localStorage.removeItem('posv_user')
    setUserState(null)
  }

  return <Ctx.Provider value={{ user, ready, login, logout }}>{children}</Ctx.Provider>
}

export function useAuth() { return useContext(Ctx) }
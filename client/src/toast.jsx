import React, { createContext, useContext, useState } from 'react'

const Ctx = createContext(() => {})

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])
  function push(type, msg) {
    const id = Date.now() + Math.random()
    setToasts(t => [...t, { id, type, msg }])
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 4200)
  }
  const toast = (msg, type = 'info') => push(type, msg)
  toast.success = msg => push('success', msg)
  toast.error = msg => push('error', msg)
  return (
    <Ctx.Provider value={toast}>
      {children}
      <div className="toast-wrap">
        {toasts.map(t => (
          <div key={t.id} className={`toast ${t.type}`}>{t.msg}</div>
        ))}
      </div>
    </Ctx.Provider>
  )
}

export function useToast() { return useContext(Ctx) }
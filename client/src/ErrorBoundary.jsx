import React from 'react'

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error('[ErrorBoundary]', error, info)
  }

  render() {
    if (this.state.error) {
      return (
        <div className="empty" style={{ padding: 60, textAlign: 'center' }}>
          <div style={{ fontSize: 40, marginBottom: 8 }}>⚠️</div>
          <h2>Algo salió mal al mostrar esta sección</h2>
          <div className="muted" style={{ marginBottom: 16 }}>{String(this.state.error.message || this.state.error)}</div>
          <button className="btn primary" onClick={() => window.location.reload()}>Recargar página</button>
        </div>
      )
    }
    return this.props.children
  }
}
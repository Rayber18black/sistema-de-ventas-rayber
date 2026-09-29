import React, { createContext, useContext, useState, useEffect } from 'react'

const dict = {
  es: {
    // Header
    panelDeVentas: 'Panel de Ventas',
    enVivo: 'En Vivo',
    hoy: 'Hoy',
    mes: 'Mes',
    seleccionarDiaRango: 'Seleccionar día o rango con calendario',
    // KPIs
    ingresos: 'Ingresos',
    transacciones: 'Transacciones',
    ticket: 'Ticket prom.',
    utilidad: 'Utilidad',
    metaDelDia: 'Meta del día',
    forecastFinDia: 'Proyección fin de día',
    neto: 'Neto (sin devol.)',
    retencion: 'Retención',
    // Widgets
    flujoDeVentas: 'Flujo de ventas',
    meta: 'Meta',
    porHora: 'Ventas por hora',
    porCategoria: 'Por categoría',
    metodosDePago: 'Métodos de pago',
    heatmap: 'Heatmap 7×24',
    topProductos: 'Top productos',
    treemapProductos: 'Treemap productos',
    embudoConversion: 'Embudo de conversión',
    vendedores: 'Vendedores',
    topClientes: 'Top clientes',
    clientesInactivos: 'Clientes inactivos',
    stockCritico: 'Stock crítico',
    feedEnVivo: 'Feed en vivo',
    comparativa: 'Comparativa de Períodos (A vs B)',
    comparar: 'Comparar',
    verInventario: 'Ver inventario',
    // Estados
    noHayDatos: 'Sin datos en el período',
    cargando: 'Cargando…',
    hayVentas: 'ventas',
    // Calendario
    aplicarRango: 'Aplicar rango',
    sinVentas: 'sin ventas',
    festivo: 'Festivo',
    guardar: 'Guardar',
    notaFestivo: 'Nota / festivo',
    eliminarNota: 'Quitar nota',
    desde: 'Desde',
    pocaActividad: 'Poca actividad',
    muchoMovimiento: 'Mucho movimiento',
    dobleClickDia: 'doble click en un día = seleccionar',
    // Acciones
    cajero: 'Cajero',
    cerrarSesion: 'Salir',
  },
  en: {
    panelDeVentas: 'Sales Dashboard',
    enVivo: 'Live',
    hoy: 'Today',
    mes: 'Month',
    seleccionarDiaRango: 'Pick a day or range with the calendar',
    // KPIs
    ingresos: 'Revenue',
    transacciones: 'Transactions',
    ticket: 'Avg. ticket',
    utilidad: 'Gross profit',
    metaDelDia: 'Daily target',
    forecastFinDia: 'End-of-day forecast',
    neto: 'Net (excl. refunds)',
    retencion: 'Retention',
    // Widgets
    flujoDeVentas: 'Sales flow',
    meta: 'Target',
    porHora: 'Sales by hour',
    porCategoria: 'By category',
    metodosDePago: 'Payment methods',
    heatmap: '7×24 Heatmap',
    topProductos: 'Top products',
    treemapProductos: 'Products treemap',
    embudoConversion: 'Conversion funnel',
    vendedores: 'Sellers',
    topClientes: 'Top customers',
    clientesInactivos: 'Inactive customers',
    stockCritico: 'Low stock',
    feedEnVivo: 'Live feed',
    comparativa: 'Period comparison (A vs B)',
    comparar: 'Compare',
    verInventario: 'View inventory',
    // Estados
    noHayDatos: 'No data for the period',
    cargando: 'Loading…',
    hayVentas: 'sales',
    // Calendario
    aplicarRango: 'Apply range',
    sinVentas: 'no sales',
    festivo: 'Holiday',
    guardar: 'Save',
    notaFestivo: 'Note / holiday',
    eliminarNota: 'Remove note',
    desde: 'From',
    pocaActividad: 'Low activity',
    muchoMovimiento: 'High activity',
    dobleClickDia: 'double click a day = select',
    // Acciones
    cajero: 'Cashier',
    cerrarSesion: 'Log out',
  }
}

const I18nCtx = createContext(null)

export function I18nProvider({ children }) {
  const [lang, setLang] = useState(() => localStorage.getItem('posv_lang') || 'es')
  useEffect(() => { localStorage.setItem('posv_lang', lang) }, [lang])
  const t = (k, fallback) => (dict[lang] && dict[lang][k]) ?? fallback ?? k
  return <I18nCtx.Provider value={{ lang, setLang, t }}>{children}</I18nCtx.Provider>
}

export function useI18n() {
  const ctx = useContext(I18nCtx)
  if (!ctx) return { lang: 'es', setLang: () => {}, t: (k, f) => f ?? k }
  return ctx
}

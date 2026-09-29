import { api } from './api.js'

export async function printThermalEnabled() {
  try { return (await api('/print/thermal')).enabled } catch (e) { return false }
}

// sale: objeto completo de venta (GET /sales/:id)
export function buildTicketData(sale, businessName = 'Mi Negocio', posTitle = 'PUNTO DE VENTA', symbol = undefined) {
  const sym = symbol || localStorage.getItem('posv_symbol') || '$'
  return {
    businessName,
    posTitle,
    folio: sale.folio,
    date: new Date((sale.created_at || '').replace(' ', 'T') || Date.now()).toLocaleString('es'),
    seller: sale.seller || '',
    customer: sale.customer_name || '',
    branch: sale.branch_name || '',
    items: (sale.items || []).map(i => ({
      name: i.product_name,
      qty: i.qty,
      price: sym + Number(i.price || 0).toFixed(2),
      total: sym + Number(i.total || 0).toFixed(2)
    })),
    subtotal: sym + Number((sale.sub_total || 0) + (sale.discount || 0)).toFixed(2),
    discount: Number(sale.discount || 0),
    tax: Number(sale.tax_total || 0),
    total: sym + Number(sale.total || 0).toFixed(2),
    payments: (sale.payments || []).map(p => ({ method: p.method, amount: sym + Number(p.amount || 0).toFixed(2) })),
    note: sale.note || ''
  }
}

export async function printTicket(data) {
  return api('/print/ticket', { method: 'POST', body: data })
}

export async function printTest() {
  return api('/print/test', { method: 'POST', body: {} })
}
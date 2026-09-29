const { db } = require('./db');
const { audit, nextFolio, runInTransaction, now, resolveBranch } = require('./utils');

function round2(n) { return Math.round(n * 100) / 100; }

// user: objeto { id, username, permissions } ; body: { items, priceList, discount, customer_id, payments, note }
function createSale(user, b, opts = {}) {
  const items = Array.isArray(b.items) ? b.items : [];
  if (!items.length) return { err: 'La venta no tiene productos' };
  const priceList = b.priceList || 'minor';
  const discount = Math.max(0, Number(b.discount) || 0);
  const customerId = b.customer_id || null;
  const silent = !!opts.silent; // desde bot/remoto no devuelve error de contexto web

  const sale = runInTransaction(() => {
    let subTotal = 0;
    let taxTotal = 0;
    const rows = [];

    for (const it of items) {
      const qty = Number(it.qty);
      if (!qty || qty <= 0) return { err: 'Cantidad inválida en un producto' };
      const p = db.prepare('SELECT * FROM products WHERE id = ? AND active = 1').get(Number(it.product_id));
      if (!p) return { err: 'Producto no encontrado' };
      const price = Number(priceList === 'major' ? p.price_major : priceList === 'special' ? p.price_special : p.price_minor);
      if (qty > p.stock) return { err: `Stock insuficiente de "${p.name}" (disponible: ${p.stock})` };
      const lineTotal = price * qty;
      subTotal += lineTotal;
      taxTotal += lineTotal * (Number(p.tax_rate) || 0) / 100;
      rows.push({ p, qty, price, taxRate: Number(p.tax_rate) || 0 });
    }

    if (discount > subTotal) return { err: 'El descuento no puede superar el subtotal' };

    const ratio = subTotal > 0 ? (1 - discount / subTotal) : 1;
    const finalSubTotal = subTotal - discount;
    const finalTax = taxTotal * ratio;
    const total = round2(finalSubTotal + finalTax);

    let paidTotal = 0;
    for (const pay of (b.payments || [])) paidTotal += Number(pay.amount) || 0;
    if (paidTotal < total - 0.001) {
      if (!opts.skipPaymentCheck) return { err: `El monto pagado (${round2(paidTotal)}) no cubre el total (${total})` };
    }

    let folio = nextFolio();
    let guard = 0;
    while (db.prepare('SELECT id FROM sales WHERE folio = ?').get(folio)) {
      folio = nextFolio();
      if (++guard > 1000) return { err: 'No se pudo generar folio' };
    }

    const info = db.prepare(`
      INSERT INTO sales (folio, customer_id, user_id, sub_total, tax_total, discount, total, status, note, branch_id, source)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'COMPLETADA', ?, ?, ?)
    `).run(folio, customerId, user.id, round2(finalSubTotal), round2(finalTax), discount, total, b.note || '', resolveBranch(b.branch_id), b.source === 'BOT' ? 'BOT' : 'POS');
    const saleId = info.lastInsertRowid;

    const insItem = db.prepare(`
      INSERT INTO sale_items (sale_id, product_id, product_name, qty, price, tax_rate, tax_total, total, cost)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const updStock = db.prepare('UPDATE products SET stock = stock - ?, low_stock_alerted = 0, updated_at = ? WHERE id = ?');
    const insMove = db.prepare(`
      INSERT INTO stock_movements (product_id, type, qty, ref_id, user_id, note)
      VALUES (?, 'SALE', ?, ?, ?, ?)
    `);

    for (const r of rows) {
      const taxItem = round2(r.price * r.qty * r.taxRate / 100 * ratio);
      const itemTotal = round2(r.price * r.qty - r.price * r.qty * (discount / subTotal));
      insItem.run(saleId, r.p.id, r.p.name, r.qty, r.price, r.taxRate, taxItem, itemTotal, r.p.cost);
      updStock.run(r.qty, now(), r.p.id);
      insMove.run(r.p.id, -r.qty, saleId, user.id, `Venta ${folio}`);
    }

    const insPay = db.prepare('INSERT INTO sale_payments (sale_id, method, amount) VALUES (?, ?, ?)');
    let creditAmount = 0;
    for (const pay of (b.payments || [])) {
      const method = String(pay.method || 'efectivo').trim();
      const amount = Number(pay.amount) || 0;
      if (amount <= 0) continue;
      insPay.run(saleId, method, round2(amount));
      if (method === 'credito') creditAmount += amount;
    }

    if (creditAmount > 0) {
      const cust = db.prepare('SELECT * FROM customers WHERE id = ?').get(customerId);
      if (!cust) return { err: 'Selecciona un cliente para el pago a crédito' };
      if ((cust.balance + creditAmount) > cust.credit_limit) {
        return { err: `El cliente supera su límite de crédito (${cust.credit_limit})` };
      }
      db.prepare('UPDATE customers SET balance = balance + ? WHERE id = ?').run(creditAmount, customerId);
    }

    return { id: saleId, folio, total, subTotal: finalSubTotal, taxTotal: finalTax, paidTotal };
  });

  if (sale.err) return sale;
  audit(user, 'VENTA', `Folio ${sale.folio} Total ${sale.total}`);

  // Alertas de stock bajo vía bot (si está activo)
  if (!silent) {
    try {
      const tg = require('./telegram');
      for (const it of items) {
        const p = db.prepare('SELECT * FROM products WHERE id = ?').get(Number(it.product_id));
        if (p && p.stock_min > 0 && p.stock <= p.stock_min) tg.queueLowStock(p);
      }
    } catch (e) { /* bot opcional */ }
  }
  return sale;
}

module.exports = { createSale };
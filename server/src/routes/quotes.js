const express = require('express');
const { db } = require('../db');
const { requireAuth, requirePerm } = require('../middleware/auth');
const { audit, now } = require('../utils');

const router = express.Router();
router.use(requireAuth);

let qtSeq = 0;

function nextQuoteCode() {
  let code, guard = 0, n = qtSeq;
  do { n++; code = `QT-${String(n).padStart(6, '0')}`; } while (db.prepare('SELECT id FROM quotes WHERE code = ?').get(code) && ++guard < 10000);
  qtSeq = n;
  return code;
}

function r2(n) { return Math.round((Number(n) + 0.000001) * 100) / 100; }

// ---------- LISTAR ----------
router.get('/quotes', requirePerm('quotes.manage'), (req, res) => {
  const { status } = req.query;
  const where = [];
  const params = [];
  if (status) { where.push('q.status = ?'); params.push(status); }
  if (!req.user.permissions.includes('sales.view_all')) { where.push('q.user_id = ?'); params.push(req.user.id); }
  const rows = db.prepare(`
    SELECT q.*, u.username AS seller, c.name AS customer_name
    FROM quotes q
    LEFT JOIN users u ON u.id = q.user_id
    LEFT JOIN customers c ON c.id = q.customer_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY q.id DESC LIMIT 300
  `).all(...params);
  res.json(rows);
});

router.get('/quotes/:id', requirePerm('quotes.manage'), (req, res) => {
  const q = db.prepare('SELECT * FROM quotes WHERE id = ?').get(Number(req.params.id));
  if (!q) return res.status(404).json({ error: 'Cotización no encontrada' });
  const items = db.prepare('SELECT * FROM quote_items WHERE quote_id = ?').all(q.id);
  const customer = q.customer_id ? db.prepare('SELECT * FROM customers WHERE id = ?').get(q.customer_id) : null;
  res.json({ ...q, items, customer });
});

// ---------- CREAR ----------
router.post('/quotes', requirePerm('quotes.manage'), (req, res) => {
  const b = req.body || {};
  const items = Array.isArray(b.items) ? b.items : [];
  if (!items.length) return res.status(400).json({ error: 'La cotización no tiene productos' });
  const discount = Math.max(0, Number(b.discount) || 0);
  let subTotal = 0, taxTotal = 0, priceList = b.priceList || 'minor';
  const rows = [];

  for (const it of items) {
    const qty = Number(it.qty);
    if (!qty || qty <= 0) return res.status(400).json({ error: 'Cantidad inválida' });
    const p = db.prepare('SELECT * FROM products WHERE id = ?').get(Number(it.product_id));
    if (!p) return res.status(400).json({ error: 'Producto no encontrado' });
    const price = Number(priceList === 'major' ? p.price_major : priceList === 'special' ? p.price_special : p.price_minor);
    subTotal += price * qty;
    taxTotal += price * qty * (Number(p.tax_rate) || 0) / 100;
    rows.push({ p, qty, price });
  }

  const ratio = subTotal > 0 ? (1 - discount / subTotal) : 1;
  const total = r2((subTotal - discount) + taxTotal * ratio);

  const code = nextQuoteCode();
  const info = db.prepare(`
    INSERT INTO quotes (code, customer_id, user_id, sub_total, discount, tax_total, total, status, valid_days, note)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'ABIERTA', ?, ?)
  `).run(code, b.customer_id || null, req.user.id, r2(subTotal - discount), discount, r2(taxTotal * ratio), total, Number(b.valid_days) || 7, b.note || '');

  const ins = db.prepare('INSERT INTO quote_items (quote_id, product_id, product_name, qty, price, tax_rate, total) VALUES (?, ?, ?, ?, ?, ?, ?)');
  for (const r of rows) {
    ins.run(info.lastInsertRowid, r.p.id, r.p.name, r.qty, r.price, Number(r.p.tax_rate) || 0, r2(r.price * r.qty));
  }
  audit(req.user, 'COTIZACION', `${code} Total ${total}`);
  res.status(201).json(db.prepare('SELECT * FROM quotes WHERE id = ?').get(info.lastInsertRowid));
});

// ---------- CONVERTIR A VENTA / CANCELAR ----------
router.post('/quotes/:id/status', requirePerm('quotes.manage'), (req, res) => {
  const qid = Number(req.params.id);
  const action = String((req.body || {}).action || '').toUpperCase();
  const q = db.prepare('SELECT * FROM quotes WHERE id = ?').get(qid);
  if (!q) return res.status(404).json({ error: 'Cotización no encontrada' });

  if (action === 'CANCELAR') {
    if (q.status === 'CONVERTIDA') return res.status(400).json({ error: 'Ya fue convertida en venta' });
    db.prepare('UPDATE quotes SET status = ? WHERE id = ?').run('CANCELADA', qid);
    audit(req.user, 'COTIZACION', `${q.code} CANCELADA`);
    return res.json(db.prepare('SELECT * FROM quotes WHERE id = ?').get(qid));
  }

  if (action === 'CONVERTIR') {
    if (q.status === 'CONVERTIDA') return res.status(400).json({ error: 'Ya fue convertida' });
    const items = db.prepare('SELECT * FROM quote_items WHERE quote_id = ?').all(qid);
    const saleSvc = require('../sales-service');
    const res2 = saleSvc.createSale(req.user, {
      items: items.map(i => ({ product_id: i.product_id, qty: i.qty })),
      priceList: 'minor',
      discount: q.discount,
      customer_id: q.customer_id || undefined,
      note: `Cotización ${q.code}`
    }, { silent: true, skipPaymentCheck: true });
    if (res2.err) return res.status(400).json({ error: res2.err });
    db.prepare('UPDATE quotes SET status = ?, converted_sale_id = ? WHERE id = ?').run('CONVERTIDA', res2.id, qid);
    audit(req.user, 'COTIZACION', `${q.code} → VENTA ${res2.folio}`);
    return res.json(res2);
  }

  res.status(400).json({ error: 'Acción inválida' });
});

module.exports = router;
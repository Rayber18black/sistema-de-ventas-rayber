const express = require('express');
const { db } = require('../db');
const { requireAuth, requirePerm } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth, requirePerm('reports.view'));

function dd(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function dateRange(from, to) {
  const f = from || dd(-30);
  const t = to || dd(0);
  return { f, t };
}

router.get('/summary', (req, res) => {
  const { f, t } = dateRange(req.query.from, req.query.to);
  const s = db.prepare(`
    SELECT
      COALESCE(SUM(total),0) AS total,
      COUNT(*) AS count,
      COALESCE(SUM(sub_total),0) AS sub_total,
      COALESCE(SUM(tax_total),0) AS tax_total,
      COALESCE(SUM(discount),0) AS discount
    FROM sales WHERE status='COMPLETADA' AND date(created_at) BETWEEN date(?) AND date(?)
  `).get(f, t);
  const by_method = db.prepare(`
    SELECT p.method, SUM(p.amount) AS total, COUNT(*) AS count
    FROM sale_payments p JOIN sales s ON s.id = p.sale_id
    WHERE s.status='COMPLETADA' AND date(s.created_at) BETWEEN date(?) AND date(?)
    GROUP BY p.method
  `).all(f, t);
  const by_user = db.prepare(`
    SELECT s.user_id, u.username, COUNT(*) AS count, SUM(s.total) AS total
    FROM sales s LEFT JOIN users u ON u.id = s.user_id
    WHERE s.status='COMPLETADA' AND date(s.created_at) BETWEEN date(?) AND date(?)
    GROUP BY s.user_id ORDER BY total DESC
  `).all(f, t);
  const profit = db.prepare(`
    SELECT COALESCE(SUM(si.qty * (si.price - COALESCE(si.cost,0))),0) AS t
    FROM sale_items si JOIN sales s ON s.id = si.sale_id
    WHERE s.status='COMPLETADA' AND date(s.created_at) BETWEEN date(?) AND date(?)
  `).get(f, t).t;
  const bot = db.prepare(`
    SELECT COUNT(*) AS count, COALESCE(SUM(total),0) AS total FROM sales
    WHERE status='COMPLETADA' AND source='BOT' AND date(created_at) BETWEEN date(?) AND date(?)
  `).get(f, t);
  res.json({
    total: Math.round(s.total * 100) / 100,
    count: s.count,
    sub_total: Math.round(s.sub_total * 100) / 100,
    tax_total: Math.round(s.tax_total * 100) / 100,
    discount: Math.round(s.discount * 100) / 100,
    profit: Math.round(profit * 100) / 100,
    bot: { count: bot.count, total: Math.round(bot.total * 100) / 100 },
    by_method, by_user
  });
});

router.get('/sales', (req, res) => {
  const { f, t } = dateRange(req.query.from, req.query.to);
  const group = req.query.group || 'day';
  let g;
  if (group === 'product') g = 'product_name';
  else if (group === 'user') g = 'seller';
  else g = 'day';

  let q, params;
  if (group === 'day') {
    q = `
      SELECT date(s.created_at) AS day, SUM(s.total) AS total, COUNT(*) AS count
      FROM sales s
      WHERE s.status='COMPLETADA' AND date(s.created_at) BETWEEN date(?) AND date(?)
      GROUP BY day ORDER BY day
    `;
    params = [f, t];
    res.json(db.prepare(q).all(...params));
  } else if (group === 'user') {
    q = `
      SELECT COALESCE(u.username,'—') AS seller, COUNT(*) AS count, SUM(s.total) AS total
      FROM sales s LEFT JOIN users u ON u.id = s.user_id
      WHERE s.status='COMPLETADA' AND date(s.created_at) BETWEEN date(?) AND date(?)
      GROUP BY s.user_id ORDER BY total DESC
    `;
    params = [f, t];
    res.json(db.prepare(q).all(...params));
  } else {
    q = `
      SELECT i.product_name, SUM(i.qty) AS qty, SUM(i.total) AS total
      FROM sale_items i JOIN sales s ON s.id = i.sale_id
      WHERE s.status='COMPLETADA' AND date(s.created_at) BETWEEN date(?) AND date(?)
      GROUP BY i.product_id ORDER BY total DESC LIMIT 100
    `;
    params = [f, t];
    res.json(db.prepare(q).all(...params));
  }
});

// ---------- CUENTAS POR COBRAR ----------
router.get('/cxc', (req, res) => {
  const rows = db.prepare(`
    SELECT c.id, c.name, c.phone, c.credit_limit, c.balance,
           (SELECT MAX(created_at) FROM sales s WHERE s.customer_id = c.id) AS last_sale
    FROM customers c
    WHERE c.active = 1 AND c.balance > 0.005
    ORDER BY c.balance DESC
  `).all();
  res.json({ items: rows, total: Math.round(rows.reduce((a, r) => a + r.balance, 0) * 100) / 100 });
});

// Estadística de ventas a distancia (bots de Telegram)
router.get('/bots', (req, res) => {
  const { f, t } = dateRange(req.query.from, req.query.to);
  const daily = db.prepare(`
    SELECT date(s.created_at) AS day, COUNT(*) AS count, SUM(s.total) AS total
    FROM sales s WHERE s.source='BOT' AND date(s.created_at) BETWEEN date(?) AND date(?)
    GROUP BY day ORDER BY day
  `).all(f, t);
  const totals = db.prepare(`
    SELECT COUNT(*) AS count, COALESCE(SUM(total),0) AS total FROM sales
    WHERE source='BOT' AND date(created_at) BETWEEN date(?) AND date(?)
  `).get(f, t);
  const orders = db.prepare(`
    SELECT status, COUNT(*) AS count FROM remote_orders
    WHERE date(created_at) BETWEEN date(?) AND date(?)
    GROUP BY status
  `).all(f, t);
  const pending = db.prepare(`
    SELECT o.*, p.name AS product_name FROM remote_orders o
    LEFT JOIN products p ON p.id = o.product_id
    WHERE o.status IN ('PENDIENTE','ACEPTADO_CLIENTE')
    ORDER BY o.id DESC LIMIT 20
  `).all();
  res.json({ daily, totals, orders, pending });
});

router.get('/inventory', (req, res) => {
  const products = db.prepare(`
    SELECT name, code, stock, stock_min, cost, price_minor,
           (cost * stock) AS stock_value, (price_minor * stock) AS sale_value
    FROM products WHERE active=1 ORDER BY name
  `).all();
  const total = products.reduce((a, p) => a + (p.stock_value || 0), 0);
  res.json({ products, total_value: Math.round(total * 100) / 100 });
});

router.get('/export.csv', (req, res) => {
  const { f, t } = dateRange(req.query.from, req.query.to);
  const rows = db.prepare(`
    SELECT s.folio, s.created_at, COALESCE(c.name,'') AS customer, u.username AS seller,
           s.sub_total, s.tax_total, s.discount, s.total,
           GROUP_CONCAT(p.method || ':' || p.amount) AS payments
    FROM sales s
    LEFT JOIN customers c ON c.id = s.customer_id
    LEFT JOIN users u ON u.id = s.user_id
    LEFT JOIN sale_payments p ON p.sale_id = s.id
    WHERE date(s.created_at) BETWEEN date(?) AND date(?)
    GROUP BY s.id ORDER BY s.id
  `).all(f, t);
  const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = rows.map(r => [r.folio, r.created_at, r.customer, r.seller, r.sub_total, r.tax_total, r.discount, r.total, r.payments].map(esc).join(','));
  const csv = 'Folio,Fecha,Cliente,Vendedor,Subtotal,Impuesto,Descuento,Total,Pagos\n' + lines.join('\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename=ventas.csv');
  res.send('\uFEFF' + csv);
});

module.exports = router;
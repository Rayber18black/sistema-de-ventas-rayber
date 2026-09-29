const express = require('express');
const { db } = require('../db');
const { requireAuth, requirePerm } = require('../middleware/auth');
const { audit, nextFolio, runInTransaction, now } = require('../utils');

const router = express.Router();
router.use(requireAuth);

// ---------- LISTA DE VENTAS ----------
router.get('/sales', requirePerm('sales.do'), (req, res) => {
  const { from, to, search, branch_id } = req.query;
  const where = [];
  const params = [];
  if (!req.user.permissions.includes('sales.view_all')) {
    where.push('s.user_id = ?');
    params.push(req.user.id);
  }
  if (from) { where.push('date(s.created_at) >= date(?)'); params.push(from); }
  if (to) { where.push('date(s.created_at) <= date(?)'); params.push(to); }
  if (search) { where.push('(s.folio LIKE ? OR s.note LIKE ?)'); params.push(`%${search}%`, `%${search}%`); }
  if (branch_id) { where.push('s.branch_id = ?'); params.push(Number(branch_id)); }
  const q = `
    SELECT s.*, u.username AS seller, c.name AS customer_name
    FROM sales s
    LEFT JOIN users u ON u.id = s.user_id
    LEFT JOIN customers c ON c.id = s.customer_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY s.id DESC LIMIT 500
  `;
  const sales = db.prepare(q).all(...params);
  res.json(sales.map(s => {
    const payments = db.prepare('SELECT * FROM sale_payments WHERE sale_id = ?').all(s.id);
    return { ...s, payments };
  }));
});

router.get('/sales/:id', requirePerm('sales.do'), (req, res) => {
  const sale = db.prepare(`
    SELECT s.*, u.username AS seller, c.name AS customer_name
    FROM sales s
    LEFT JOIN users u ON u.id = s.user_id
    LEFT JOIN customers c ON c.id = s.customer_id
    WHERE s.id = ?
  `).get(Number(req.params.id));
  if (!sale) return res.status(404).json({ error: 'Venta no encontrada' });
  if (!req.user.permissions.includes('sales.view_all') && sale.user_id !== req.user.id) {
    return res.status(403).json({ error: 'No tienes acceso a esta venta' });
  }
  const items = db.prepare('SELECT * FROM sale_items WHERE sale_id = ?').all(sale.id);
  const payments = db.prepare('SELECT * FROM sale_payments WHERE sale_id = ?').all(sale.id);
  res.json({ ...sale, items, payments });
});

// ---------- CREAR VENTA ----------
router.post('/sales', requirePerm('sales.do'), (req, res) => {
  const sale = require('../sales-service').createSale(req.user, req.body || {});
  if (sale.err) return res.status(400).json({ error: sale.err });
  res.json(sale);
});

module.exports = router;
const express = require('express');
const { db } = require('../db');
const { requireAuth, requirePerm } = require('../middleware/auth');
const { audit, resolveBranch } = require('../utils');

const router = express.Router();
router.use(requireAuth);

// ---------- GASTOS ----------
router.get('/expenses', requirePerm('expenses.manage'), (req, res) => {
  const { from, to, type, branch_id } = req.query;
  const where = [];
  const params = [];
  if (from) { where.push('date(e.created_at) >= date(?)'); params.push(from); }
  if (to) { where.push('date(e.created_at) <= date(?)'); params.push(to); }
  if (type) { where.push('e.type = ?'); params.push(type); }
  if (branch_id) { where.push('e.branch_id = ?'); params.push(Number(branch_id)); }
  const rows = db.prepare(`
    SELECT e.*, u.username AS seller, b.name AS branch_name FROM expenses e
    LEFT JOIN users u ON u.id = e.user_id
    LEFT JOIN branches b ON b.id = e.branch_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY e.id DESC LIMIT 500
  `).all(...params);
  const total = db.prepare(`
    SELECT COALESCE(SUM(amount),0) t FROM expenses e
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
  `).get(...params).t;
  res.json({ items: rows, total });
});

router.post('/expenses', requirePerm('expenses.manage'), (req, res) => {
  const b = req.body || {};
  const amount = Number(b.amount);
  if (!amount || amount <= 0) return res.status(400).json({ error: 'Monto inválido' });
  const type = String(b.type || 'GASTO').toUpperCase();
  if (!['GASTO', 'CAJA_CHICA'].includes(type)) return res.status(400).json({ error: 'Tipo inválido' });
  const info = db.prepare(`
    INSERT INTO expenses (type, amount, category, note, user_id, branch_id)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(type, amount, String(b.category || 'General').trim(), String(b.note || '').trim(), req.user.id, resolveBranch(b.branch_id));
  audit(req.user, 'GASTO', `${type} ${amount} ${b.category || ''}`);
  res.status(201).json(db.prepare('SELECT * FROM expenses WHERE id = ?').get(info.lastInsertRowid));
});

router.delete('/expenses/:id', requirePerm('expenses.manage'), (req, res) => {
  db.prepare('DELETE FROM expenses WHERE id = ?').run(Number(req.params.id));
  audit(req.user, 'GASTO', `Eliminado id ${req.params.id}`);
  res.json({ ok: true });
});

module.exports = router;
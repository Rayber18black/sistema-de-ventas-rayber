const express = require('express');
const { db } = require('../db');
const { requireAuth, requirePerm } = require('../middleware/auth');
const { audit, now, runInTransaction, resolveBranch } = require('../utils');

const router = express.Router();
router.use(requireAuth);

function sessionSales(session) {
  return db.prepare(`
    SELECT s.* FROM sales s
    WHERE s.user_id = ? AND s.branch_id = ?
      AND s.created_at >= ? AND (s.created_at <= ? OR ? IS NULL)
    ORDER BY s.id
  `).all(session.user_id, session.branch_id, session.opened_at, session.closed_at, session.closed_at);
}

function branchOf(req) { return resolveBranch(req.query.branch_id ?? req.body?.branch_id); }

function openSessionFor(req) {
  const bid = branchOf(req);
  return db.prepare("SELECT * FROM cash_sessions WHERE user_id = ? AND branch_id = ? AND status = 'ABIERTA' ORDER BY id DESC LIMIT 1")
    .get(req.user.id, bid);
}

router.get('/session/current', requirePerm('cash.open'), (req, res) => {
  const session = openSessionFor(req);
  if (!session) return res.json({ session: null });
  const sales = sessionSales(session);
  const cashIn = db.prepare("SELECT COALESCE(SUM(amount),0) AS t FROM cash_movements WHERE session_id = ? AND type = 'IN'").get(session.id).t;
  const cashOut = db.prepare("SELECT COALESCE(SUM(amount),0) AS t FROM cash_movements WHERE session_id = ? AND type = 'OUT'").get(session.id).t;
  const byMethod = {};
  for (const s of sales) {
    const pays = db.prepare('SELECT method, amount FROM sale_payments WHERE sale_id = ?').all(s.id);
    for (const p of pays) byMethod[p.method] = (byMethod[p.method] || 0) + p.amount;
  }
  const expected = (byMethod['efectivo'] || 0) + session.opening_amount + cashIn - cashOut;
  res.json({
    session,
    expected_cash: Math.round(expected * 100) / 100,
    sales_count: sales.length,
    sales_total: Math.round(sales.reduce((a, s) => a + s.total, 0) * 100) / 100,
    by_method: byMethod,
    cash_in: cashIn,
    cash_out: cashOut
  });
});

router.post('/open', requirePerm('cash.open'), (req, res) => {
  const bid = branchOf(req);
  const existing = db.prepare("SELECT id FROM cash_sessions WHERE user_id = ? AND branch_id = ? AND status = 'ABIERTA'").get(req.user.id, bid);
  if (existing) return res.status(400).json({ error: 'Ya tienes una caja abierta en esta sucursal' });
  const opening = Number(req.body.opening_amount) || 0;
  const info = db.prepare(`
    INSERT INTO cash_sessions (user_id, opening_amount, status, branch_id)
    VALUES (?, ?, 'ABIERTA', ?)
  `).run(req.user.id, opening, bid);
  audit(req.user, 'ABRIR_CAJA', `Fondo ${opening}`);
  res.json({ id: info.lastInsertRowid, status: 'ABIERTA', opening_amount: opening });
});

router.post('/close', requirePerm('cash.close'), (req, res) => {
  const session = openSessionFor(req);
  if (!session) return res.status(400).json({ error: 'No tienes una caja abierta en esta sucursal' });

  const result = runInTransaction(() => {
    const sales = sessionSales(session);
    const byMethod = {};
    for (const s of sales) {
      const pays = db.prepare('SELECT method, amount FROM sale_payments WHERE sale_id = ?').all(s.id);
      for (const p of pays) byMethod[p.method] = (byMethod[p.method] || 0) + p.amount;
    }
    const cashIn = db.prepare("SELECT COALESCE(SUM(amount),0) AS t FROM cash_movements WHERE session_id = ? AND type = 'IN'").get(session.id).t;
    const cashOut = db.prepare("SELECT COALESCE(SUM(amount),0) AS t FROM cash_movements WHERE session_id = ? AND type = 'OUT'").get(session.id).t;
    const expected = Math.round(((byMethod['efectivo'] || 0) + session.opening_amount + cashIn - cashOut) * 100) / 100;
    const actual = Number(req.body.actual_amount);
    db.prepare(`
      UPDATE cash_sessions SET closed_at = ?, expected_amount = ?, actual_amount = ?, status = 'CERRADA', note = ?
      WHERE id = ?
    `).run(now(), expected, Number.isFinite(actual) ? Math.round(actual * 100) / 100 : null, req.body.note || '', session.id);
    return { expected, byMethod, salesCount: sales.length, salesTotal: Math.round(sales.reduce((a, s) => a + s.total, 0) * 100) / 100 };
  });
  audit(req.user, 'CERRAR_CAJA', `Esperado ${result.expected}`);
  res.json(result);
});

router.post('/movements', requirePerm('cash.movements'), (req, res) => {
  const session = openSessionFor(req);
  if (!session) return res.status(400).json({ error: 'Abre la caja primero' });
  const { type, amount, reason } = req.body || {};
  const t = type === 'OUT' ? 'OUT' : 'IN';
  const amt = Number(amount);
  if (!amt || amt <= 0) return res.status(400).json({ error: 'Monto inválido' });
  db.prepare('INSERT INTO cash_movements (session_id, user_id, type, amount, reason) VALUES (?, ?, ?, ?, ?)')
    .run(session.id, req.user.id, t, amt, reason || '');
  audit(req.user, 'MOVIMIENTO_CAJA', `${t} ${amt} ${reason || ''}`);
  res.json({ ok: true });
});

router.get('/history', requirePerm('cash.open'), (req, res) => {
  const where = [];
  const params = [];
  if (req.query.branch_id) { where.push('cs.branch_id = ?'); params.push(Number(req.query.branch_id)); }
  const q = `
    SELECT cs.*, u.username, b.name AS branch_name FROM cash_sessions cs
    LEFT JOIN users u ON u.id = cs.user_id
    LEFT JOIN branches b ON b.id = cs.branch_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY cs.id DESC LIMIT 100
  `;
  res.json(db.prepare(q).all(...params));
});

module.exports = router;
const express = require('express');
const { db } = require('../db');
const { requireAuth, requirePerm } = require('../middleware/auth');
const { audit, now, resolveBranch } = require('../utils');

const router = express.Router();
router.use(requireAuth);

let ocSeq = 0;
function r2(n) { return Math.round((Number(n) + 0.000001) * 100) / 100; }

function nextPOCode() {
  let code, guard = 0, n = ocSeq;
  do { n++; code = `OC-${String(n).padStart(6, '0')}`; } while (db.prepare('SELECT id FROM purchase_orders WHERE code = ?').get(code) && ++guard < 10000);
  ocSeq = n;
  return code;
}

// ---------- LISTAR ----------
router.get('/purchase-orders', requirePerm('purchases.do'), (req, res) => {
  const { status, branch_id } = req.query;
  const where = [];
  const params = [];
  if (status) { where.push('po.status = ?'); params.push(status); }
  if (branch_id) { where.push('po.branch_id = ?'); params.push(Number(branch_id)); }
  const rows = db.prepare(`
    SELECT po.*, u.username AS created_by, s.name AS supplier_name, b.name AS branch_name
    FROM purchase_orders po
    LEFT JOIN users u ON u.id = po.user_id
    LEFT JOIN suppliers s ON s.id = po.supplier_id
    LEFT JOIN branches b ON b.id = po.branch_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY po.id DESC LIMIT 300
  `).all(...params);
  res.json(rows);
});

router.get('/purchase-orders/:id', requirePerm('purchases.do'), (req, res) => {
  const po = db.prepare('SELECT * FROM purchase_orders WHERE id = ?').get(Number(req.params.id));
  if (!po) return res.status(404).json({ error: 'Orden no encontrada' });
  const items = db.prepare('SELECT * FROM purchase_order_items WHERE purchase_order_id = ?').all(po.id);
  res.json({ ...po, items });
});

// ---------- SUGERENCIA DE REABASTECIMIENTO ----------
router.get('/replenish', requirePerm('purchases.do'), (req, res) => {
  const rows = db.prepare(`
    SELECT id, code, name, unit, stock, stock_min, stock_max, cost
    FROM products WHERE active = 1 AND stock_min > 0 AND stock <= stock_min
    ORDER BY (stock - stock_min) ASC
  `).all();
  const res2 = rows.map(p => {
    const sugg = Math.max(p.stock_max - p.stock, 1);
    return { ...p, suggested_qty: sugg, est_cost: r2(p.cost * sugg) };
  });
  res.json(res2);
});

// ---------- CREAR ----------
router.post('/purchase-orders', requirePerm('purchases.do'), (req, res) => {
  const b = req.body || {};
  const items = Array.isArray(b.items) ? b.items : [];
  if (!items.length) return res.status(400).json({ error: 'La orden no tiene productos' });
  const rows = [];
  let total = 0;
  for (const it of items) {
    const qty = Number(it.qty);
    const cost = Number(it.cost);
    if (!qty || qty <= 0) return res.status(400).json({ error: 'Cantidad inválida' });
    const p = db.prepare('SELECT * FROM products WHERE id = ?').get(Number(it.product_id));
    if (!p) return res.status(400).json({ error: 'Producto no encontrado' });
    rows.push({ p, qty, cost: cost || p.cost });
    total += (cost || p.cost) * qty;
  }
  if (b.supplier_id) {
    const s = db.prepare('SELECT * FROM suppliers WHERE id = ?').get(Number(b.supplier_id));
    if (!s) return res.status(400).json({ error: 'Proveedor no encontrado' });
  }

  const code = nextPOCode();
  const info = db.prepare(`
    INSERT INTO purchase_orders (code, supplier_id, user_id, status, expected_date, note, total, branch_id)
    VALUES (?, ?, ?, 'PENDIENTE', ?, ?, ?, ?)
  `).run(code, b.supplier_id || null, req.user.id, b.expected_date || null, b.note || '', r2(total), resolveBranch(b.branch_id));

  const ins = db.prepare(`
    INSERT INTO purchase_order_items (purchase_order_id, product_id, product_name, qty, cost, total)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  for (const r of rows) {
    ins.run(info.lastInsertRowid, r.p.id, r.p.name, r.qty, r.cost, r2(r.cost * r.qty));
  }
  audit(req.user, 'COMPRA', `${code} Total ${r2(total)}`);
  res.status(201).json(db.prepare('SELECT * FROM purchase_orders WHERE id = ?').get(info.lastInsertRowid));
});

// ---------- RECIBIR (entrada de stock) / CANCELAR ----------
router.post('/purchase-orders/:id/status', requirePerm('purchases.do'), (req, res) => {
  const po = db.prepare('SELECT * FROM purchase_orders WHERE id = ?').get(Number(req.params.id));
  if (!po) return res.status(404).json({ error: 'Orden no encontrada' });
  const action = String((req.body || {}).action || '').toUpperCase();

  if (action === 'CANCELAR') {
    if (po.status === 'RECIBIDA') return res.status(400).json({ error: 'Ya fue recibida' });
    db.prepare('UPDATE purchase_orders SET status = ? WHERE id = ?').run('CANCELADA', po.id);
    audit(req.user, 'COMPRA', `${po.code} CANCELADA`);
    return res.json(db.prepare('SELECT * FROM purchase_orders WHERE id = ?').get(po.id));
  }

  if (action === 'RECIBIR') {
    if (po.status === 'RECIBIDA') return res.status(400).json({ error: 'Ya fue recibida' });
    const items = db.prepare('SELECT * FROM purchase_order_items WHERE purchase_order_id = ?').all(po.id);
    const upd = db.prepare('UPDATE products SET cost = ?, stock = stock + ?, updated_at = ? WHERE id = ?');
    const mv = db.prepare(`
      INSERT INTO stock_movements (product_id, type, qty, ref_id, user_id, note)
      VALUES (?, 'PURCHASE', ?, ?, ?, ?)
    `);
    for (const it of items) {
      upd.run(it.cost, it.qty, now(), it.product_id);
      mv.run(it.product_id, it.qty, po.id, req.user.id, `Compra ${po.code}`);
    }
    db.prepare('UPDATE purchase_orders SET status = ?, received_at = ? WHERE id = ?').run('RECIBIDA', now(), po.id);
    audit(req.user, 'COMPRA', `${po.code} RECIBIDA (${items.length} productos)`);
    return res.json(db.prepare('SELECT * FROM purchase_orders WHERE id = ?').get(po.id));
  }

  res.status(400).json({ error: 'Acción inválida' });
});

router.delete('/purchase-orders/:id', requirePerm('purchases.do'), (req, res) => {
  db.prepare('DELETE FROM purchase_order_items WHERE purchase_order_id = ?').run(Number(req.params.id));
  db.prepare('DELETE FROM purchase_orders WHERE id = ?').run(Number(req.params.id));
  res.json({ ok: true });
});

module.exports = router;
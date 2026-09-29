const express = require('express');
const { db } = require('../db');
const { requireAuth, requirePerm } = require('../middleware/auth');
const { audit, runInTransaction, resolveBranch } = require('../utils');

const router = express.Router();
router.use(requireAuth);

router.get('/customers', requirePerm('customers.manage'), (req, res) => {
  const { search } = req.query;
  let q = 'SELECT * FROM customers WHERE active = 1';
  const params = [];
  if (search) {
    q += ' AND (name LIKE ? OR phone LIKE ? OR ci LIKE ? OR rif LIKE ?)';
    const s = `%${search}%`;
    params.push(s, s, s, s);
  }
  q += ' ORDER BY name LIMIT 500';
  res.json(db.prepare(q).all(...params));
});

router.get('/customers/:id', requirePerm('customers.manage'), (req, res) => {
  const c = db.prepare('SELECT * FROM customers WHERE id = ?').get(Number(req.params.id));
  if (!c) return res.status(404).json({ error: 'Cliente no encontrado' });
  const sales = db.prepare(`
    SELECT s.id, s.folio, s.total, s.status, s.created_at FROM sales s WHERE s.customer_id = ? ORDER BY s.id DESC LIMIT 100
  `).all(c.id);
  const payments = db.prepare(`
    SELECT p.*, u.username AS seller FROM customer_payments p
    LEFT JOIN users u ON u.id = p.user_id
    WHERE p.customer_id = ? ORDER BY p.id DESC LIMIT 100
  `).all(c.id);
  res.json({ ...c, sales, payments });
});

// ---------- ESTADO DE CUENTA (créditos y cobranza) ----------
router.get('/customers/:id/statement', requirePerm('customers.manage'), (req, res) => {
  const c = db.prepare('SELECT * FROM customers WHERE id = ?').get(Number(req.params.id));
  if (!c) return res.status(404).json({ error: 'Cliente no encontrado' });
  // créditos nacidos de ventas pagadas con método "credito"
  const creditSales = db.prepare(`
    SELECT s.id, s.folio, s.total, s.created_at,
           (SELECT COALESCE(SUM(amount),0) FROM sale_payments WHERE sale_id = s.id AND method = 'credito') AS credit_portion
    FROM sales s WHERE s.customer_id = ? ORDER BY s.id ASC
  `).all(c.id);
  const pays = db.prepare('SELECT * FROM customer_payments WHERE customer_id = ? ORDER BY id ASC').all(c.id);

  const events = [];
  for (const s of creditSales) {
    if (s.credit_portion > 0) events.push({ type: 'VENTA', ref: s.folio, date: s.created_at, amount: s.credit_portion });
  }
  for (const p of pays) {
    events.push({ type: 'PAGO', ref: `Pago`, date: p.created_at, amount: -p.amount, note: p.method + (p.note ? ' · ' + p.note : '') });
  }
  events.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  let balance = 0;
  const items = events.map(e => {
    balance = Math.round((balance + e.amount) * 100) / 100;
    return { ...e, balance_after: balance };
  });
  res.json({ id: c.id, name: c.name, phone: c.phone, balance: Math.round(c.balance * 100) / 100, credit_limit: c.credit_limit, items });
});

// ---------- COBRANZA: registrar pago de un cliente ----------
router.post('/customers/:id/pay', requirePerm('customers.manage'), (req, res) => {
  const id = Number(req.params.id);
  const b = req.body || {};
  const amount = Number(b.amount);
  if (!amount || amount <= 0) return res.status(400).json({ error: 'Monto inválido' });
  const c = db.prepare('SELECT * FROM customers WHERE id = ?').get(id);
  if (!c) return res.status(404).json({ error: 'Cliente no encontrado' });
  if (amount > c.balance + 0.005) {
    return res.status(400).json({ error: `El saldo del cliente es ${Math.round(c.balance * 100) / 100} (menor al abono)` });
  }

  const result = runInTransaction(() => {
    const info = db.prepare(`
      INSERT INTO customer_payments (customer_id, amount, method, note, user_id, branch_id)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, Math.round(amount * 100) / 100, String(b.method || 'efectivo').trim(), String(b.note || '').trim(), req.user.id, resolveBranch(b.branch_id));
    db.prepare('UPDATE customers SET balance = balance - ? WHERE id = ?').run(amount, id);
    return info.lastInsertRowid;
  });
  audit(req.user, 'COBRANZA', `${c.name} ${amount}`);
  res.status(201).json({ id: result });
});

router.post('/customers', requirePerm('customers.manage'), (req, res) => {
  const b = req.body || {};
  if (!b.name) return res.status(400).json({ error: 'Nombre requerido' });
  const info = db.prepare(`
    INSERT INTO customers (name, phone, ci, rif, email, address, credit_limit, active)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(String(b.name).trim(), b.phone || '', b.ci || '', b.rif || '', b.email || '', b.address || '', Number(b.credit_limit) || 0, b.active === false ? 0 : 1);
  audit(req.user, 'CREAR_CLIENTE', b.name);
  res.json({ id: info.lastInsertRowid });
});

router.put('/customers/:id', requirePerm('customers.manage'), (req, res) => {
  const id = Number(req.params.id);
  const c = db.prepare('SELECT * FROM customers WHERE id = ?').get(id);
  if (!c) return res.status(404).json({ error: 'Cliente no encontrado' });
  const b = req.body || {};
  db.prepare(`
    UPDATE customers SET name=?, phone=?, ci=?, rif=?, email=?, address=?, credit_limit=?, active=? WHERE id=?
  `).run(String(b.name).trim(), b.phone ?? c.phone, b.ci ?? c.ci, b.rif ?? c.rif, b.email ?? c.email, b.address ?? c.address, Number(b.credit_limit) || c.credit_limit, b.active === false ? 0 : 1, id);
  audit(req.user, 'EDITAR_CLIENTE', b.name);
  res.json({ ok: true });
});

router.delete('/customers/:id', requirePerm('customers.manage'), (req, res) => {
  db.prepare('UPDATE customers SET active = 0 WHERE id = ?').run(Number(req.params.id));
  res.json({ ok: true });
});

// ---------- PROVEEDORES ----------
router.get('/suppliers', requirePerm('suppliers.manage'), (req, res) => {
  res.json(db.prepare('SELECT * FROM suppliers WHERE active = 1 ORDER BY name').all());
});

router.post('/suppliers', requirePerm('suppliers.manage'), (req, res) => {
  const b = req.body || {};
  if (!b.name) return res.status(400).json({ error: 'Nombre requerido' });
  const info = db.prepare(`
    INSERT INTO suppliers (name, contact, phone, email, address) VALUES (?, ?, ?, ?, ?)
  `).run(String(b.name).trim(), b.contact || '', b.phone || '', b.email || '', b.address || '');
  res.json({ id: info.lastInsertRowid });
});

router.put('/suppliers/:id', requirePerm('suppliers.manage'), (req, res) => {
  const b = req.body || {};
  db.prepare('UPDATE suppliers SET name=?, contact=?, phone=?, email=?, address=? WHERE id=?')
    .run(b.name, b.contact || '', b.phone || '', b.email || '', b.address || '', Number(req.params.id));
  res.json({ ok: true });
});

router.delete('/suppliers/:id', requirePerm('suppliers.manage'), (req, res) => {
  db.prepare('UPDATE suppliers SET active = 0 WHERE id = ?').run(Number(req.params.id));
  res.json({ ok: true });
});

module.exports = router;
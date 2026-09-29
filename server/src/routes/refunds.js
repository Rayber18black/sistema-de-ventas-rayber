const express = require('express');
const { db } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { requirePerm } = require('../middleware/auth');
const { audit, now } = require('../utils');

const router = express.Router();
router.use(requireAuth);

// ---------- LISTAR DEVOLUCIONES ----------
router.get('/refunds', requirePerm('refund.do'), (req, res) => {
  const where = [];
  const params = [];
  if (!req.user.permissions.includes('sales.view_all')) {
    where.push('r.seller_id = ?');
    params.push(req.user.id);
  }
  const q = `
    SELECT r.*, u.username AS seller, s.folio AS sale_folio
    FROM refunds r
    LEFT JOIN users u ON u.id = r.seller_id
    LEFT JOIN sales s ON s.id = r.sale_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY r.id DESC LIMIT 300
  `;
  res.json(db.prepare(q).all(...params));
});

// ---------- CREAR DEVOLUCIÓN ----------
router.post('/refunds', requirePerm('refund.do'), (req, res) => {
  const b = req.body || {};
  const saleId = Number(b.sale_id);
  const productId = Number(b.product_id);
  const qty = Number(b.qty) || 0;
  const reason = String(b.reason || '').trim();

  if (!saleId || !productId || qty <= 0) {
    return res.status(400).json({ error: 'Venta, producto y cantidad requeridos' });
  }

  const sale = db.prepare('SELECT * FROM sales WHERE id = ?').get(saleId);
  if (!sale) return res.status(404).json({ error: 'Venta no encontrada' });
  if (sale.status !== 'COMPLETADA') return res.status(400).json({ error: 'La venta no está completada' });
  if (!req.user.permissions.includes('sales.view_all') && sale.user_id !== req.user.id) {
    return res.status(403).json({ error: 'No tienes acceso a esta venta' });
  }

  const item = db.prepare('SELECT * FROM sale_items WHERE sale_id = ? AND product_id = ?').get(saleId, productId);
  if (!item) return res.status(400).json({ error: 'El producto no pertenece a la venta' });

  const already = db.prepare(`
    SELECT COALESCE(SUM(qty), 0) q FROM refunds WHERE sale_id = ? AND product_id = ? AND status IN ('PENDIENTE','APROBADO')
  `).get(saleId, productId).q;
  if (already + qty > item.qty) {
    return res.status(400).json({ error: `Solo se puede devolver ${item.qty - already} más de este producto` });
  }

  // código DE-000001
  let code = '';
  let guard = 0;
  do {
    const n = String(++refundSeq).padStart(6, '0');
    code = `DEV-${n}`;
  } while (db.prepare('SELECT id FROM refunds WHERE code = ?').get(code) && ++guard < 10000);

  const amount = Math.round(item.price * qty * 100) / 100;
  const info = db.prepare(`
    INSERT INTO refunds (code, sale_id, product_id, product_name, qty, unit_price, amount, reason, status, seller_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PENDIENTE', ?)
  `).run(code, saleId, productId, item.product_name, qty, item.price, amount, reason, req.user.id);

  audit(req.user, 'DEVOLUCION', `Solicitud ${code} venta ${sale.folio} ${item.product_name} x${qty}`);

  // Avisar al dueño por Telegram (si el bot está activo)
  try {
    const tg = require('../telegram');
    if (tg.getStatus().hasToken) {
      tg.requestRefundNotify({ id: info.lastInsertRowid });
    }
  } catch (e) { /* bot opcional */ }

  res.status(201).json(db.prepare('SELECT * FROM refunds WHERE id = ?').get(info.lastInsertRowid));
});

// ---------- RESOLVER (aprobar/rechazar) desde la app ----------
router.post('/refunds/:id/status', requirePerm('refunds.approve'), (req, res) => {
  const status = String((req.body || {}).status || '').toUpperCase();
  if (!['APROBADO', 'RECHAZADO'].includes(status)) {
    return res.status(400).json({ error: 'Estado inválido' });
  }
  const r = db.prepare('SELECT * FROM refunds WHERE id = ?').get(Number(req.params.id));
  if (!r) return res.status(404).json({ error: 'Devolución no encontrada' });
  if (r.status !== 'PENDIENTE') {
    return res.status(400).json({ error: `La devolución ya fue ${r.status === 'APROBADO' ? 'aprobada' : 'resuelta'}` });
  }

  const note = String((req.body || {}).note || '');
  const tg = require('../telegram');
  const err = tg.resolveRefund(Number(req.params.id), status, req.user.username, note);
  if (err) return res.status(400).json({ error: err });

  res.json(db.prepare('SELECT * FROM refunds WHERE id = ?').get(Number(req.params.id)));
});

let refundSeq = (() => { const m = db.prepare('SELECT MAX(CAST(SUBSTR(code,5) AS INTEGER)) m FROM refunds').get(); return Number(m && m.m) || 0; })();

// ---------- PEDIDOS REMOTOS (apartados / ventas a distancia) ----------
router.get('/remote-orders', requirePerm('sales.do'), (req, res) => {
  const rows = db.prepare(`
    SELECT ro.*, s.folio AS sale_folio FROM remote_orders ro
    LEFT JOIN sales s ON s.id = ro.sale_id
    ORDER BY ro.id DESC LIMIT 200
  `).all();
  res.json(rows);
});

router.post('/remote-orders/:id/status', requirePerm('refunds.approve'), (req, res) => {
  const status = String((req.body || {}).status || '').toUpperCase();
  if (!['APARTADO', 'PENDIENTE', 'ACEPTADO_CLIENTE', 'PAGADO', 'CANCELADO'].includes(status)) {
    return res.status(400).json({ error: 'Estado inválido' });
  }
  const o = db.prepare('SELECT * FROM remote_orders WHERE id = ?').get(Number(req.params.id));
  if (!o) return res.status(404).json({ error: 'Pedido no encontrado' });
  if (status === 'CANCELADO' && o.status !== 'PAGADO') {
    db.prepare('UPDATE remote_orders SET status = ? WHERE id = ?').run(status, o.id);
    return res.json(db.prepare('SELECT * FROM remote_orders WHERE id = ?').get(o.id));
  }
  return res.status(400).json({ error: 'No se puede cambiar a ese estado desde la app' });
});

// ---------- SOLICITUDES DE PRODUCTO (clientes desde el bot de ventas) ----------
router.get('/product-requests', requirePerm('telegram.manage'), (req, res) => {
  const rows = db.prepare('SELECT * FROM product_requests ORDER BY id DESC LIMIT 200').all();
  res.json(rows);
});

router.put('/product-requests/:id/status', requirePerm('telegram.manage'), (req, res) => {
  const status = String((req.body || {}).status || '').toUpperCase();
  if (!['PENDIENTE', 'ATENDIDA', 'CANCELADA'].includes(status)) {
    return res.status(400).json({ error: 'Estado inválido' });
  }
  const r = db.prepare('SELECT * FROM product_requests WHERE id = ?').get(Number(req.params.id));
  if (!r) return res.status(404).json({ error: 'Solicitud no encontrada' });
  db.prepare('UPDATE product_requests SET status = ?, resolved_at = ? WHERE id = ?')
    .run(status, status === 'PENDIENTE' ? null : now(), r.id);
  audit(req.user, 'PROD_SOLICITUD', `${r.code} → ${status}`);
  res.json(db.prepare('SELECT * FROM product_requests WHERE id = ?').get(r.id));
});

module.exports = router;
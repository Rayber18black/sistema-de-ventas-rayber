const express = require('express');
const { db } = require('../db');
const { requireAuth, requirePerm } = require('../middleware/auth');
const { getSetting, setSetting } = require('../seed');
const { audit } = require('../utils');
const { applyRateChange } = require('../reprice');

const router = express.Router();

router.get('/public', (req, res) => {
  const app = getSetting('app') || {};
  const modules = getSetting('modules') || {};
  let extraCurrencies = [];
  try { extraCurrencies = JSON.parse((getSetting('finance') || {}).extraCurrencies || '[]'); } catch (e) {}
  res.json({
    businessName: app.businessName || 'Mi Negocio',
    businessTagline: app.businessTagline || '',
    currency: app.currency || 'USD',
    currencySymbol: app.currencySymbol || '$',
    defaultTax: Number(app.defaultTax) || 0,
    language: app.language || 'es',
    posTitle: app.posTitle || 'PUNTO DE VENTA',
    paymentMethods: db.prepare('SELECT id, name, code, is_remote FROM payment_methods WHERE active = 1').all(),
    modules,
    extraCurrencies: modules.multimoneda ? extraCurrencies : []
  });
});

router.use(requireAuth, requirePerm('settings.manage'));

router.get('/', (req, res) => {
  res.json({
    app: getSetting('app'),
    modules: getSetting('modules'),
    finance: getSetting('finance'),
    thermal: getSetting('thermal'),
    paymentMethods: db.prepare('SELECT * FROM payment_methods ORDER BY id').all()
  });
});

router.put('/thermal', (req, res) => {
  const b = req.body || {};
  const current = getSetting('thermal') || {};
  setSetting('thermal', {
    enabled: !!b.enabled,
    host: String(b.host ?? current.host ?? '127.0.0.1'),
    port: Number(b.port) || Number(current.port) || 9100,
    width: Number(b.width) || Number(current.width) || 58
  });
  audit(req.user, 'CONFIG_IMPRESION', `host ${b.host} port ${b.port}`);
  res.json({ ok: true });
});

router.put('/finance', (req, res) => {
  const current = getSetting('finance') || {};
  const b = req.body || {};
  let oldEC = []; try { oldEC = JSON.parse(current.extraCurrencies || '[]'); } catch (e) {}
  let newEC = b.extraCurrencies;
  if (!Array.isArray(newEC)) { try { newEC = JSON.parse(current.extraCurrencies || '[]'); } catch (e) { newEC = []; } }
  const next = {
    extraCurrencies: JSON.stringify(newEC),
    expensesCategories: String(b.expensesCategories ?? current.expensesCategories ?? 'General,Alquiler,Servicios,Salarios,Impuestos,Publicidad,Oficina,Otros')
  };
  setSetting('finance', next);
  let repriced = 0;
  const oldUsd = Number((oldEC.find(c => c.code === 'USD') || {}).rate);
  const newUsd = Number((newEC.find(c => c.code === 'USD') || {}).rate);
  if (oldUsd > 0 && newUsd > 0 && Math.abs(newUsd - oldUsd) > 1e-9) {
    repriced = applyRateChange(oldUsd, newUsd) || 0;
  }
  audit(req.user, 'CONFIG_FINANZAS', `multimoneda y gastos${repriced ? ` (${repriced} precios re-escalados)` : ''}`);
  res.json({ ok: true, repriced });
});

router.put('/app', (req, res) => {
  const current = getSetting('app') || {};
  setSetting('app', { ...current, ...(req.body || {}) });
  audit(req.user, 'CONFIG_APP', JSON.stringify(req.body));
  res.json({ ok: true });
});

router.put('/modules', (req, res) => {
  const current = getSetting('modules') || {};
  const body = { ...(req.body || {}) };
  delete body.modules; // evitar anidamiento accidental
  setSetting('modules', { ...current, ...body });
  audit(req.user, 'CONFIG_MODULOS', JSON.stringify(body));
  res.json({ ok: true });
});

router.post('/payment-methods', (req, res) => {
  const b = req.body || {};
  if (!b.name || !b.code) return res.status(400).json({ error: 'Nombre y código requeridos' });
  const info = db.prepare(`
    INSERT INTO payment_methods (name, code, active, is_remote, icon, account_holder, bank, account_number, phone, instructions)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(String(b.name).trim(), String(b.code).trim().toLowerCase().replace(/\s+/g, '_'), b.active === false ? 0 : 1, b.is_remote ? 1 : 0, b.icon || '💵',
    String(b.account_holder || ''), String(b.bank || ''), String(b.account_number || ''), String(b.phone || ''), String(b.instructions || ''));
  audit(req.user, 'CREAR_METODO_PAGO', b.name);
  res.json({ id: info.lastInsertRowid });
});

router.put('/payment-methods/:id', (req, res) => {
  const b = req.body || {};
  db.prepare('UPDATE payment_methods SET name=?, code=?, active=?, is_remote=?, icon=?, account_holder=?, bank=?, account_number=?, phone=?, instructions=? WHERE id=?')
    .run(b.name, b.code, b.active === false ? 0 : 1, b.is_remote ? 1 : 0, b.icon || '💵',
      String(b.account_holder || ''), String(b.bank || ''), String(b.account_number || ''), String(b.phone || ''), String(b.instructions || ''),
      Number(req.params.id));
  res.json({ ok: true });
});

router.delete('/payment-methods/:id', (req, res) => {
  db.prepare('DELETE FROM payment_methods WHERE id = ?').run(Number(req.params.id));
  audit(req.user, 'ELIMINAR_METODO_PAGO', String(req.params.id));
  res.json({ ok: true });
});

module.exports = router;
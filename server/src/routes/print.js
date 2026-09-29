const express = require('express');
const { requireAuth, requirePerm } = require('../middleware/auth');
const { printTicket, testPage, thermalConfig } = require('../thermal');

const router = express.Router();
router.use(requireAuth);

router.get('/thermal', requirePerm('print.ticket'), (req, res) => {
  res.json(thermalConfig());
});

router.post('/ticket', requirePerm('print.ticket'), async (req, res) => {
  const cfg = thermalConfig();
  if (!cfg.enabled) return res.status(400).json({ error: 'Impresión térmica desactivada en Configuración' });
  try {
    await printTicket(req.body || {});
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.post('/test', requirePerm('print.ticket'), async (req, res) => {
  const cfg = thermalConfig();
  if (!cfg.enabled) return res.status(400).json({ error: 'Impresión térmica desactivada en Configuración' });
  try {
    await testPage();
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

module.exports = router;
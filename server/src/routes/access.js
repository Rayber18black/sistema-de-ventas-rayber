const express = require('express');
const os = require('os');
const QRCode = require('qrcode');
const { requireAuth, requirePerm } = require('../middleware/auth');
const { getSetting } = require('../seed');

const router = express.Router();

// Acceso a la red local (público): direcciones IP y puerto.
// Sirve para mostrar el QR de acceso a distancia en el POS o antes de ingresar.
router.get('/access/info-public', (req, res) => {
  const port = Number(process.env.PORT) || 3000;
  const biz = (getSetting('app') || {}).businessName || 'Mi negocio';
  const ips = [];
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const i of ifaces[name] || []) {
      if (!i.internal && i.family === 'IPv4') ips.push({ iface: name, ip: i.address });
    }
  }
  const urls = ips.map(x => ({ ...x, url: `http://${x.ip}:${port}` }));
  res.json({ business: biz, port, urls });
});

// Información de acceso a la red local: direcciones IP y puerto
router.get('/access/info', requireAuth, requirePerm('settings.manage'), (req, res) => {
  const port = Number(process.env.PORT) || 3000;
  const biz = (getSetting('app') || {}).businessName || 'Mi negocio';
  const ips = [];
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const i of ifaces[name] || []) {
      if (!i.internal && i.family === 'IPv4') ips.push({ iface: name, ip: i.address });
    }
  }
  const urls = ips.map(x => ({ ...x, url: `http://${x.ip}:${port}` }));
  res.json({ business: biz, port, urls });
});

// Genera un QR (texto libre: URL de acceso o enlace de un bot)
router.get('/access/qr-public', async (req, res) => {
  const text = String(req.query.text || '').trim();
  if (!text) return res.status(400).json({ error: 'Falta el texto para el QR' });
  try {
    const dataUrl = await QRCode.toDataURL(text, { margin: 1, width: 512, errorCorrectionLevel: 'M' });
    res.json({ dataUrl, text });
  } catch (e) {
    res.status(400).json({ error: 'No se pudo generar el QR: ' + e.message });
  }
});

// Genera un QR (texto libre: URL de acceso o enlace de un bot)
router.get('/access/qr', requireAuth, requirePerm('settings.manage'), async (req, res) => {
  const text = String(req.query.text || '').trim();
  if (!text) return res.status(400).json({ error: 'Falta el texto para el QR' });
  try {
    const dataUrl = await QRCode.toDataURL(text, { margin: 1, width: 512, errorCorrectionLevel: 'M' });
    res.json({ dataUrl, text });
  } catch (e) {
    res.status(400).json({ error: 'No se pudo generar el QR: ' + e.message });
  }
});

module.exports = router;
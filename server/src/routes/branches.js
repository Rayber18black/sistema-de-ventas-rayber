const express = require('express');
const { db } = require('../db');
const { requireAuth, requirePerm } = require('../middleware/auth');
const { audit } = require('../utils');

const router = express.Router();
router.use(requireAuth);

// Lista de sucursales activas (para el selector de cualquier usuario logueado)
router.get('/branches', (req, res) => {
  res.json(db.prepare('SELECT * FROM branches WHERE active = 1 ORDER BY id').all());
});

// ---------- ADMINISTRACIÓN (root) ----------
router.get('/branches/all', requirePerm('branches.manage'), (req, res) => {
  res.json(db.prepare('SELECT * FROM branches ORDER BY id').all());
});

router.post('/branches', requirePerm('branches.manage'), (req, res) => {
  const b = req.body || {};
  if (!b.name) return res.status(400).json({ error: 'Nombre requerido' });
  const info = db.prepare('INSERT INTO branches (name, address, phone, active) VALUES (?, ?, ?, ?)')
    .run(String(b.name).trim(), b.address || '', b.phone || '', b.active === false ? 0 : 1);
  audit(req.user, 'CREAR_SUCURSAL', b.name);
  res.json({ id: info.lastInsertRowid });
});

router.put('/branches/:id', requirePerm('branches.manage'), (req, res) => {
  const id = Number(req.params.id);
  const b = db.prepare('SELECT * FROM branches WHERE id = ?').get(id);
  if (!b) return res.status(404).json({ error: 'Sucursal no encontrada' });
  const body = req.body || {};
  db.prepare('UPDATE branches SET name=?, address=?, phone=?, active=? WHERE id=?')
    .run(String(body.name).trim(), body.address ?? b.address, body.phone ?? b.phone, body.active === false ? 0 : 1, id);
  audit(req.user, 'EDITAR_SUCURSAL', body.name);
  res.json({ ok: true });
});

module.exports = router;
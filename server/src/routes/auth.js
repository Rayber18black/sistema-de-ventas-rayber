const express = require('express');
const bcrypt = require('bcryptjs');
const { db } = require('../db');
const { signToken, requireAuth } = require('../middleware/auth');
const { audit } = require('../utils');

const router = express.Router();

router.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Ingresa usuario y contraseña' });

  const user = db.prepare(`
    SELECT u.id, u.username, u.password_hash, u.full_name, u.active, r.name AS role_name, r.permissions
    FROM users u LEFT JOIN roles r ON r.id = u.role_id
    WHERE u.username = ?
  `).get(String(username).trim());

  if (!user || !bcrypt.compareSync(String(password), user.password_hash)) {
    return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
  }
  if (!user.active) return res.status(403).json({ error: 'Usuario desactivado' });

  audit(user, 'LOGIN', 'Inicio de sesión');
  res.json({
    token: signToken(user),
    user: { id: user.id, username: user.username, full_name: user.full_name, role: user.role_name, permissions: JSON.parse(user.permissions || '[]') }
  });
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: { id: req.user.id, username: req.user.username, full_name: req.user.full_name, role: req.user.role_name, permissions: req.user.permissions } });
});

router.post('/change-password', requireAuth, (req, res) => {
  const { current, next } = req.body || {};
  const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
  if (!row || !bcrypt.compareSync(String(current || ''), row.password_hash)) {
    return res.status(400).json({ error: 'Contraseña actual incorrecta' });
  }
  if (!next || String(next).length < 4) return res.status(400).json({ error: 'La nueva contraseña debe tener al menos 4 caracteres' });
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(String(next), 10), req.user.id);
  audit(req.user, 'CAMBIO_PASSWORD', 'Cambio de contraseña propio');
  res.json({ ok: true });
});

module.exports = router;
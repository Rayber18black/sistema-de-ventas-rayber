const express = require('express');
const bcrypt = require('bcryptjs');
const { db } = require('../db');
const { requireAuth, requirePerm } = require('../middleware/auth');
const { audit } = require('../utils');

const router = express.Router();

router.use(requireAuth);

// ---------- USUARIOS ----------
router.get('/users', requirePerm('users.manage'), (req, res) => {
  const users = db.prepare(`
    SELECT u.id, u.username, u.full_name, u.active, u.created_at, r.name AS role_name, r.permissions AS role_permissions
    FROM users u LEFT JOIN roles r ON r.id = u.role_id
    ORDER BY u.id
  `).all();
  res.json(users.map(u => ({ ...u, permissions: JSON.parse(u.role_permissions || '[]') })));
});

router.post('/users', requirePerm('users.manage'), (req, res) => {
  const { username, password, full_name, role_id, active } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Usuario y contraseña requeridos' });
  const exists = db.prepare('SELECT id FROM users WHERE username = ?').get(String(username).trim());
  if (exists) return res.status(400).json({ error: 'El nombre de usuario ya existe' });
  const info = db.prepare(`
    INSERT INTO users (username, password_hash, full_name, role_id, active)
    VALUES (?, ?, ?, ?, ?)
  `).run(String(username).trim(), bcrypt.hashSync(String(password), 10), full_name || '', role_id || null, active === false ? 0 : 1);
  audit(req.user, 'CREAR_USUARIO', username);
  const created = db.prepare(`
    SELECT u.id, u.username, u.full_name, u.active, r.name AS role_name
    FROM users u LEFT JOIN roles r ON r.id = u.role_id WHERE u.id = ?
  `).get(info.lastInsertRowid);
  res.json(created);
});

router.put('/users/:id', requirePerm('users.manage'), (req, res) => {
  const id = Number(req.params.id);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
  const { username, full_name, role_id, active, password } = req.body || {};
  let sql = 'UPDATE users SET username = ?, full_name = ?, role_id = ?, active = ?';
  const params = [username || user.username, full_name ?? user.full_name, role_id ?? user.role_id, active === undefined ? user.active : (active ? 1 : 0)];
  if (password) { sql += ', password_hash = ?'; params.push(bcrypt.hashSync(String(password), 10)); }
  sql += ' WHERE id = ?';
  params.push(id);
  db.prepare(sql).run(...params);
  audit(req.user, 'EDITAR_USUARIO', username);
  res.json({ ok: true });
});

router.delete('/users/:id', requirePerm('users.manage'), (req, res) => {
  const id = Number(req.params.id);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
  if (user.username === 'root') return res.status(400).json({ error: 'No se puede eliminar al usuario ROOT' });
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
  audit(req.user, 'ELIMINAR_USUARIO', user.username);
  res.json({ ok: true });
});

// ---------- ROLES ----------
router.get('/roles', requirePerm('users.manage'), (req, res) => {
  const roles = db.prepare('SELECT * FROM roles ORDER BY id').all();
  res.json(roles.map(r => ({ ...r, permissions: JSON.parse(r.permissions) })));
});

router.post('/roles', requirePerm('roles.manage'), (req, res) => {
  const { name, permissions } = req.body || {};
  if (!name) return res.status(400).json({ error: 'Nombre requerido' });
  if (!Array.isArray(permissions)) return res.status(400).json({ error: 'Permisos inválidos' });
  const info = db.prepare('INSERT INTO roles (name, permissions, system) VALUES (?, ?, 0)').run(String(name).trim(), JSON.stringify(permissions));
  res.json({ id: info.lastInsertRowid, name, permissions, system: 0 });
});

router.put('/roles/:id', requirePerm('roles.manage'), (req, res) => {
  const id = Number(req.params.id);
  const role = db.prepare('SELECT * FROM roles WHERE id = ?').get(id);
  if (!role) return res.status(404).json({ error: 'Rol no encontrado' });
  if (role.system) return res.status(400).json({ error: 'No se puede editar un rol de sistema' });
  const { name, permissions } = req.body || {};
  db.prepare('UPDATE roles SET name = ?, permissions = ? WHERE id = ?')
    .run(name || role.name, JSON.stringify(permissions || JSON.parse(role.permissions)), id);
  res.json({ ok: true });
});

router.delete('/roles/:id', requirePerm('roles.manage'), (req, res) => {
  const id = Number(req.params.id);
  const role = db.prepare('SELECT * FROM roles WHERE id = ?').get(id);
  if (!role) return res.status(404).json({ error: 'Rol no encontrado' });
  if (role.system) return res.status(400).json({ error: 'No se puede eliminar un rol de sistema' });
  db.prepare('DELETE FROM roles WHERE id = ?').run(id);
  res.json({ ok: true });
});

module.exports = router;
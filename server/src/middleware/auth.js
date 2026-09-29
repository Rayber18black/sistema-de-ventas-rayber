const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const { db, DATA_DIR } = require('../db');

const SECRET_FILE = path.join(DATA_DIR, 'secret.key');
let SECRET = process.env.JWT_SECRET;
if (!SECRET) {
  if (!fs.existsSync(SECRET_FILE)) {
    SECRET = require('crypto').randomBytes(32).toString('hex');
    fs.writeFileSync(SECRET_FILE, SECRET, { mode: 0o600 });
  } else {
    SECRET = fs.readFileSync(SECRET_FILE, 'utf8').trim();
  }
}

function signToken(user) {
  return jwt.sign(
    { id: user.id, username: user.username, role: user.role_name },
    SECRET,
    { expiresIn: '12h' }
  );
}

function getPermissions(userId) {
  const row = db.prepare(`
    SELECT r.permissions FROM users u
    JOIN roles r ON r.id = u.role_id
    WHERE u.id = ? AND u.active = 1
  `).get(userId);
  return row ? JSON.parse(row.permissions) : [];
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'No autorizado' });
  try {
    const payload = jwt.verify(token, SECRET);
    const user = db.prepare(`
      SELECT u.id, u.username, u.full_name, u.active, r.name AS role_name, r.permissions
      FROM users u JOIN roles r ON r.id = u.role_id
      WHERE u.id = ?
    `).get(payload.id);
    if (!user || !user.active) return res.status(401).json({ error: 'Usuario inactivo' });
    user.permissions = JSON.parse(user.permissions || '[]');
    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Sesión expirada' });
  }
}

function requirePerm(perm) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'No autorizado' });
    if (!req.user.permissions.includes(perm)) {
      return res.status(403).json({ error: 'No tienes permiso para esta acción' });
    }
    next();
  };
}

module.exports = { signToken, requireAuth, requirePerm, getPermissions };
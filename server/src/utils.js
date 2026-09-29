const { db } = require('./db');

function audit(user, action, detail = '') {
  db.prepare(`
    INSERT INTO audits (user_id, username, action, detail)
    VALUES (?, ?, ?, ?)
  `).run(user ? user.id : null, user ? user.username : 'system', action, String(detail).slice(0, 500));
}

function now() {
  const row = db.prepare("SELECT datetime('now','localtime') AS t").get();
  return row.t;
}

function nextFolio(prefix = 'F') {
  const row = db.prepare('SELECT folio FROM sales ORDER BY id DESC LIMIT 1').get();
  let n = 1;
  if (row && row.folio) {
    const m = row.folio.match(/(\d+)$/);
    if (m) n = parseInt(m[1], 10) + 1;
  }
  return `${prefix}-${String(n).padStart(6, '0')}`;
}

function runInTransaction(fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

function resolveBranch(id) {
  if (id) {
    const b = db.prepare('SELECT id FROM branches WHERE id = ? AND active = 1').get(Number(id));
    if (b) return b.id;
  }
  const def = db.prepare('SELECT id FROM branches WHERE active = 1 ORDER BY id LIMIT 1').get();
  return def ? def.id : null;
}

module.exports = { audit, now, nextFolio, runInTransaction, resolveBranch };
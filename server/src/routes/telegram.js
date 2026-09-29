const express = require('express');
const { db } = require('../db');
const { requireAuth, requirePerm } = require('../middleware/auth');
const { getSetting, setSetting } = require('../seed');
const { audit } = require('../utils');
const telegram = require('../telegram');
const bc = require('../bot-commands');

const router = express.Router();

// Express 4 no captura errores de handlers async; si uno lanza (p. ej. un
// fallo de BD), Node 24 derriba el proceso. Este wrapper los convierte en
// respuestas 500 en vez de tumbar el servidor.
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// Público (antes de auth): enlaces de los bots de Telegram para mostrar sus QRs
// en el POS o antes de ingresar. Solo expone @usuario, nunca tokens ni claves.
router.get('/qr-links', (req, res) => {
  const bots = db.prepare('SELECT id, name, kind, username FROM telegram_bots WHERE active = 1').all()
    .filter(b => b.username)
    .map(b => ({ id: b.id, name: b.name, kind: b.kind, link: `https://t.me/${b.username}`, username: b.username }));
  res.json(bots);
});

router.use(requireAuth, requirePerm('telegram.manage'));

// Catálogo de comandos y configuración de permisos por rol (para que el Root
// decida qué puede solicitar cada rol con el bot)
router.get('/commands', (req, res) => {
  const roles = db.prepare('SELECT * FROM roles ORDER BY id').all().map(r => ({
    id: r.id, name: r.name, system: r.system,
    permissions: JSON.parse(r.permissions || '[]'),
    botCommands: bc.savedCommands(r) || (bc.ROLE_DEFAULTS[r.name] || [])
  }));
  res.json({ commands: bc.COMMANDS, roles });
});

router.put('/roles/:id/permissions', (req, res) => {
  const role = db.prepare('SELECT * FROM roles WHERE id = ?').get(Number(req.params.id));
  if (!role) return res.status(404).json({ error: 'Rol no encontrado' });
  const commands = Array.isArray(req.body.commands) ? req.body.commands : [];
  const saved = bc.saveCommands(role.id, commands);
  audit(req.user, 'BOT_PERMISOS', `rol ${role.name}: ${saved.length} comandos`);
  res.json({ ok: true, commands: saved });
});

// Supervisión de dispositivos vinculados
router.get('/devices', (req, res) => {
  const rows = db.prepare(`
    SELECT cm.id, cm.chat_id, cm.display_name, cm.phone, cm.ip, cm.mac, cm.verified,
           cm.created_at, u.username, u.full_name AS user_name, r.name AS role_name
    FROM chat_members cm
    LEFT JOIN users u ON u.id = cm.user_id
    LEFT JOIN roles r ON r.id = u.role_id
    WHERE cm.role != 'cliente'
    ORDER BY cm.id DESC
  `).all();
  res.json(rows);
});

// Estado del bot y chats registrados
router.get('/status', (req, res) => {
  res.json(telegram.getStatus());
});

// Bandeja de entrada: conversaciones con clientes (Root)
router.get('/inbox', (req, res) => {
  res.json(telegram.getInbox());
});

// Nº de mensajes sin leer (para el indicador de la barra superior)
router.get('/inbox-unread', (req, res) => {
  res.json({ unread: telegram.countUnreadInbox() });
});

// Hilo de una conversación
router.get('/inbox/:chatId', (req, res) => {
  const chatId = Number(req.params.chatId);
  if (!chatId) return res.status(400).json({ error: 'chat_id inválido' });
  res.json(telegram.getInboxThread(chatId));
});

// Marcar como leídos los mensajes entrantes de una conversación
router.post('/inbox/:chatId/read', (req, res) => {
  db.prepare("UPDATE bot_inbox SET read_flag = 1 WHERE chat_id = ? AND direction = 'in' AND from_root = 0").run(Number(req.params.chatId));
  res.json({ ok: true, unread: telegram.countUnreadInbox() });
});

// Responder al cliente desde el sistema
router.post('/inbox/:chatId/reply', wrap(async (req, res) => {
  const chatId = Number(req.params.chatId);
  const text = String((req.body || {}).text || '').trim();
  if (!chatId) return res.status(400).json({ error: 'chat_id inválido' });
  if (!text) return res.status(400).json({ error: 'El mensaje está vacío' });
  const ok = await telegram.sendReply(chatId, text);
  if (!ok) return res.status(400).json({ error: 'No se pudo enviar. Revisa que el cliente tenga el bot enlazado y los tokens.' });
  audit(req.user, 'BOT_RESPUESTA', `respondió a chat ${chatId}: ${text.slice(0, 60)}`);
  res.json({ ok: true, unread: telegram.countUnreadInbox() });
}));

// Guardar configuración de claves/reporte (los bots se administran por separado)
router.put('/config', (req, res) => {
  const b = req.body || {};
  const current = getSetting('telegram') || {};
  const next = {
    ...current,
    ownerKey: String(b.ownerKey ?? current.ownerKey ?? 'OWNER2025').trim().toUpperCase() || 'OWNER2025',
    sellerKey: String(b.sellerKey ?? current.sellerKey ?? 'VENDEDOR2025').trim().toUpperCase() || 'VENDEDOR2025',
    reportHour: Math.min(23, Math.max(0, Number(b.reportHour ?? current.reportHour ?? 19))),
    notifyLowStock: b.notifyLowStock !== undefined ? !!b.notifyLowStock : (current.notifyLowStock !== false)
  };
  setSetting('telegram', next);
  audit(req.user, 'CONFIG_TELEGRAM', JSON.stringify({ ...next }));
  res.json({ ok: true });
});

// ---- múltiples bots ----
router.get('/bots', (req, res) => {
  res.json(db.prepare('SELECT * FROM telegram_bots ORDER BY id').all());
});

router.post('/bots', wrap(async (req, res) => {
  const { token, name, kind } = req.body || {};
  const t = String(token || '').trim();
  if (!/^\d{6,}:[A-Za-z0-9_-]{20,}$/.test(t)) return res.status(400).json({ error: 'Token de bot inválido (debe ser el que da @BotFather en Telegram)' });
  if (!['cliente', 'negocio'].includes(kind)) return res.status(400).json({ error: 'Tipo de bot inválido. Usa cliente o negocio.' });
  const dup = db.prepare('SELECT * FROM telegram_bots WHERE token = ?').get(t);
  if (dup) return res.status(400).json({ error: `Ese token ya está en el bot "${dup.name}". Cada bot debe tener su propio token.` });
  const v = await telegram.verifyToken(t);
  if (!v.ok) return res.status(400).json({ error: `Token rechazado por Telegram: ${v.err}` });
  const info = db.prepare('INSERT INTO telegram_bots (name, kind, token, username, active) VALUES (?, ?, ?, ?, 1)')
    .run(String(name || '').trim() || 'Bot', kind, t, v.username || '');
  audit(req.user, 'TELEGRAM_BOT', `añadió ${kind} ${name}`);
  telegram.refreshBots();
  res.json({ ok: true, id: info.lastInsertRowid, username: v.username });
}));

router.put('/bots/:id', wrap(async (req, res) => {
  const id = Number(req.params.id);
  const b = db.prepare('SELECT * FROM telegram_bots WHERE id = ?').get(id);
  if (!b) return res.status(404).json({ error: 'Bot no encontrado' });
  const fields = {};
  if (req.body.name !== undefined) fields.name = String(req.body.name).trim() || b.name;
  if (req.body.kind !== undefined && ['cliente', 'negocio'].includes(req.body.kind)) fields.kind = req.body.kind;
  if (req.body.active !== undefined) fields.active = !!req.body.active ? 1 : 0;
  if (req.body.token !== undefined && String(req.body.token).trim() !== b.token) {
    const t = String(req.body.token).trim();
    if (!/^\d{6,}:[A-Za-z0-9_-]{20,}$/.test(t)) return res.status(400).json({ error: 'Token inválido' });
    if (db.prepare('SELECT * FROM telegram_bots WHERE token = ? AND id != ?').get(t, id)) return res.status(400).json({ error: 'Token ya usado por otro bot' });
    const v = await telegram.verifyToken(t);
    if (!v.ok) return res.status(400).json({ error: `Token rechazado: ${v.err}` });
    fields.token = t;
    fields.username = v.username || '';
  }
  const sets = Object.keys(fields).map(k => `${k} = ?`).join(', ');
  if (sets) db.prepare(`UPDATE telegram_bots SET ${sets} WHERE id = ?`).run(...Object.values(fields), id);
  audit(req.user, 'TELEGRAM_BOT', `actualizó bot #${id}`);
  telegram.refreshBots();
  res.json({ ok: true });
}));

router.delete('/bots/:id', (req, res) => {
  const id = Number(req.params.id);
  const b = db.prepare('SELECT * FROM telegram_bots WHERE id = ?').get(id);
  if (!b) return res.status(404).json({ error: 'Bot no encontrado' });
  db.prepare('DELETE FROM telegram_bots WHERE id = ?').run(id);
  audit(req.user, 'TELEGRAM_BOT', `eliminó bot #${id}`);
  telegram.refreshBots();
  res.json({ ok: true });
});

// ---- promociones (solo Root / marketing.promos) ----
router.get('/promotions', (req, res) => {
  const list = db.prepare(`
    SELECT p.*, u.username AS by_username FROM promotions p
    LEFT JOIN users u ON u.id = p.created_by
    ORDER BY p.id DESC LIMIT 50
  `).all();
  res.json(list);
});

router.post('/promotions', wrap(async (req, res) => {
  if (!(req.user.permissions || []).includes('marketing.promos')) return res.status(403).json({ error: 'Solo el Root puede lanzar promociones.' });
  const { title, message } = req.body || {};
  if (!String(title || '').trim() || !String(message || '').trim()) return res.status(400).json({ error: 'Título y mensaje son obligatorios' });
  const result = await telegram.sendPromotion(String(title).trim(), String(message).trim(), req.user);
  audit(req.user, 'PROMOCION', `"${title}" a ${result.sent}/${result.total} clientes`);
  res.json({ ok: true, ...result, note: result.sent < result.total ? 'Algunos clientes no tenían chat de bot enlazado.' : '' });
}));

router.delete('/promotions/:id', (req, res) => {
  if (!(req.user.permissions || []).includes('marketing.promos')) return res.status(403).json({ error: 'Solo el Root puede eliminar promociones.' });
  db.prepare('DELETE FROM promotions WHERE id = ?').run(Number(req.params.id));
  res.json({ ok: true });
});

// Enviar mensaje de prueba a un chat registrado
router.post('/test', wrap(async (req, res) => {
  const chat = db.prepare("SELECT * FROM chat_members WHERE role = 'owner' AND active = 1").get();
  if (!chat) return res.status(400).json({ error: 'Primero vincula tu dispositivo desde Telegram con /vincular USUARIO CONTRASEÑA ROL' });
  const ok = await telegram.sendText(chat.chat_id, `✅ Bot conectado. Hora ${new Date().toLocaleString()}`);
  if (!ok) return res.status(400).json({ error: 'No se pudo enviar. Revisa los tokens y la conexión.' });
  res.json({ ok: true });
}));

// Quitar un chat registrado
router.delete('/chats/:id', (req, res) => {
  db.prepare('DELETE FROM chat_members WHERE id = ?').run(Number(req.params.id));
  res.json({ ok: true });
});

module.exports = router;
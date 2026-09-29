const { db } = require('./db');
const bcrypt = require('bcryptjs');
const { getSetting, setSetting } = require('./seed');
const { audit, now } = require('./utils');
const { applyRateChange } = require('./reprice');
const bc = require('./bot-commands');

// ---------- estado interno ----------
let running = false;
let pollTimers = new Map(); // token -> { running, offset, status, lastPing, lastError, username }
let schedTimer = null;
let lowStockTimer = null;
let dailySentDay = '';
let prefixCount = { RO: 0, DEV: 0 };
const buyFlow = new Map(); // chatId -> { step, product, qty, pickup, phone }
let editCtx = null; // { chatId, messageId } para editar el mensaje del botón (evita duplicar)

// Chat_id "virtuales" para el buzón (bandeja del Root): no son chats reales de Telegram,
// se usan como categorías agregadas dentro de la bandeja de entrada.
const COMUNICADOS_CHAT = -1; // comunicados que envía el Root
const ORDENES_CHAT = -2;     // órdenes pagadas a distancia

function isVirtual(chatId) { return chatId === COMUNICADOS_CHAT || chatId === ORDENES_CHAT; }

function r2(n) { return Math.round((Number(n) + 0.000001) * 100) / 100; }

// ---------- utilidades de negocio ----------
function currency() { return (getSetting('app') || {}).currencySymbol || '$'; }
function fmt(n) { return `${currency()}${r2(n)}`; }

function productByRef(ref) {
  const code = String(ref || '').trim().toUpperCase();
  if (!code) return null;
  if (/^\d+$/.test(code)) {
    let p = db.prepare('SELECT * FROM products WHERE id = ?').get(Number(code));
    if (p) return p;
  }
  let p = db.prepare('SELECT * FROM products WHERE UPPER(code) = ?').get(code);
  if (p) return p;
  p = db.prepare('SELECT * FROM products WHERE barcode = ?').get(String(ref).trim());
  if (p) return p;
  return db.prepare('SELECT * FROM products WHERE UPPER(name) LIKE ? ORDER BY active DESC LIMIT 1').get(`%${code}%`);
}

function remoteMethods() {
  return db.prepare('SELECT * FROM payment_methods WHERE active = 1 AND is_remote = 1').all();
}

function orderByRef(ref) {
  const code = String(ref || '').trim().toUpperCase();
  if (/^\d+$/.test(code)) return db.prepare('SELECT * FROM remote_orders WHERE id = ?').get(Number(code));
  return db.prepare('SELECT * FROM remote_orders WHERE UPPER(code) = ?').get(code);
}

function activeBots() { return db.prepare('SELECT * FROM telegram_bots WHERE active = 1 ORDER BY id').all(); }

function keys() {
  return { ...{ ownerKey: 'OWNER2025', sellerKey: 'VENDEDOR2025', reportHour: 19, notifyLowStock: true }, ...(getSetting('telegram') || {}) };
}

// ---------- tasas de cambio ----------
function extraCurrencies() {
  try { return JSON.parse((getSetting('finance') || {}).extraCurrencies || '[]'); } catch (e) { return []; }
}
function saveCurrencies(list) {
  const cur = getSetting('finance') || {};
  setSetting('finance', { ...cur, extraCurrencies: JSON.stringify(list) });
}
function tasasText() {
  const base = (getSetting('app') || {}).currency || 'BS';
  const sym = (getSetting('app') || {}).currencySymbol || '';
  const list = extraCurrencies();
  if (!list.length) return `Solo está configurada la moneda base (${base}).`;
  return `💱 <b>Tasas establecidas</b> (1 moneda = ? ${base}${sym ? ` <i>${sym}</i>` : ''}):\n` +
    list.map(c => `  • 1 ${c.code} = <b>${c.rate}</b> ${base}`).join('\n');
}

// ---------- API de Telegram ----------
async function tg(method, token, params) {
  if (!token) throw new Error('Bot sin token');
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params || {})
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.description || 'Error de Telegram');
  return data.result;
}

async function verifyToken(token) {
  try {
    const me = await tg('getMe', String(token).trim(), {});
    return { ok: true, username: me.username || '', name: me.first_name || '' };
  } catch (e) {
    return { ok: false, err: e.message };
  }
}

// Envía el mensaje usando el primer bot activo que acepte (los chat_id de
// chats privados son ids globales de Telegram, válidos para cualquier bot).
// Si hay un `editCtx` pendiente para este chat (viene de un botón inline), el
// primer envío EDITA el mensaje del botón en lugar de crear uno nuevo. Esto
// evita que cada toque de botón acumule mensajes duplicados.
async function sendText(chatId, text, opts = {}) {
  if (!text && !opts.buttons) return;
  const payload = { chat_id: chatId, text: String(text || ''), parse_mode: 'HTML' };
  if (opts.buttons && opts.buttons.length) {
    payload.reply_markup = { inline_keyboard: opts.buttons.map(row => row.map(b => ({
      text: b.text,
      ...(b.url ? { url: b.url } : { callback_data: (b.data || b.text) })
    }))) };
  }
  const ed = editCtx && editCtx.chatId === chatId ? editCtx : null;
  if (ed && !opts.noMenu && (!opts.buttons || !opts.buttons.some(r => r.some(b => b.data === 'menu:show')))) {
    const rows = opts.buttons || [];
    rows.push([{ text: '🏠 Inicio', data: 'menu:show' }]);
    payload.reply_markup = { inline_keyboard: rows.map(row => row.map(b => ({
      text: b.text,
      ...(b.url ? { url: b.url } : { callback_data: (b.data || b.text) })
    }))) };
  }
  for (const b of activeBots()) {
    try {
      if (ed) {
        await tg('editMessageText', b.token, { ...payload, message_id: ed.messageId });
        editCtx = null;
      } else {
        await tg('sendMessage', b.token, payload);
      }
      return true;
    } catch (e) { /* probar siguiente bot */ }
  }
  return false;
}

function owners() { return db.prepare("SELECT * FROM chat_members WHERE role = 'owner' AND active = 1").all(); }
function sellers() { return db.prepare("SELECT * FROM chat_members WHERE role = 'vendedor' AND active = 1").all(); }

async function notifyOwners(text, opts = {}) { for (const o of owners()) await sendText(o.chat_id, text, opts); }
async function notifySellers(text, opts = {}) { for (const s of sellers()) await sendText(s.chat_id, text, opts); }

// ---------- botones / menú ----------
function labelFor(cmd) {
  const x = bc.COMMANDS.find(c => c.cmd === cmd);
  return x ? (x.label || cmd) : cmd;
}

// Devuelve las filas de botones del menú principal según el chat (cliente o vinculado)
function menuButtons(chatId, bot) {
  const isClientBot = bot && (bot.kind === 'cliente' || bot.kind === 'negocio');
  const u = linkedUser(chatId);
  const clientCmds = ['/productos', '/precio', '/solicitar', '/comprar', '/consultar', '/promos'];
  let cmds;
  if (u) {
    const role = db.prepare('SELECT * FROM roles WHERE id = ?').get(u.role_id);
    cmds = bc.availableCommands(role).filter(x => x !== '/vincular' && x !== '/ayuda' && x !== '/menu' && x !== '/cierre');
  } else if (isClientBot) {
    cmds = bot && bot.kind === 'negocio' ? [...clientCmds, '/vincular'] : clientCmds;
  } else {
    cmds = ['/vincular'];
  }
  // agrupar en filas de 2 para que quepan bien
  const rows = [];
  for (let i = 0; i < cmds.length; i += 2) {
    rows.push(
      cmds.slice(i, i + 2).map(cmd => ({ text: labelFor(cmd), data: cmd }))
    );
  }
  return rows;
}

// ---------- números ----------
function nextCode(prefix, table) {
  if (prefixCount[prefix] === undefined) prefixCount[prefix] = 0;
  let guard = 0;
  while (true) {
    const n = String(++prefixCount[prefix]).padStart(6, '0');
    const code = `${prefix}-${n}`;
    if (!db.prepare(`SELECT id FROM ${table} WHERE code = ?`).get(code)) return code;
    if (++guard > 10000) return `${prefix}-${Date.now()}`;
  }
}

function isOwner(chatId) { return !!db.prepare("SELECT * FROM chat_members WHERE chat_id = ? AND role = 'owner' AND active = 1").get(chatId); }
function isSeller(chatId) { return !!db.prepare("SELECT * FROM chat_members WHERE chat_id = ? AND role = 'vendedor' AND active = 1").get(chatId); }

// Usuario del sistema vinculado a un chat (vía /vincular)
function linkedUser(chatId) {
  const cm = db.prepare('SELECT * FROM chat_members WHERE chat_id = ?').get(chatId);
  if (!cm || !cm.user_id) return null;
  const row = db.prepare(`
    SELECT u.id, u.username, u.full_name, u.active, r.name AS role_name, r.permissions
    FROM users u LEFT JOIN roles r ON r.id = u.role_id
    WHERE u.id = ?
  `).get(cm.user_id);
  if (!row || !row.active) return null;
  row.permissions = JSON.parse(row.permissions || '[]');
  return row;
}

// El chat puede usar este comando (si tiene vínculo de usuario y su rol lo permite)
function chatCan(chatId, cmd) {
  const u = linkedUser(chatId);
  if (!u) return null; // sin vínculo
  return { allowed: bc.cmdAllowedForRole(cmd, u), user: u };
}

// Registra/actualiza enlace de un chat (dueño, vendedor o cliente con teléfono)
function linkChat(chatId, role, name, phone) {
  const ex = db.prepare('SELECT * FROM chat_members WHERE chat_id = ?').get(chatId);
  const vals = { role, display_name: name || '', phone: phone || '' };
  if (ex) {
    db.prepare('UPDATE chat_members SET role = ?, display_name = ?, phone = ?, active = 1 WHERE id = ?')
      .run(vals.role, vals.display_name || ex.display_name, vals.phone || ex.phone, ex.id);
  } else {
    db.prepare('INSERT INTO chat_members (chat_id, role, display_name, phone, active) VALUES (?, ?, ?, ?, 1)')
      .run(chatId, vals.role, vals.display_name, vals.phone);
  }
}

// ---------- devoluciones ----------
function resolveRefund(id, status, by, note) {
  const r = db.prepare('SELECT * FROM refunds WHERE id = ?').get(Number(id));
  if (!r) return 'La devolución no existe';
  if (r.status !== 'PENDIENTE') return `La devolución ya fue ${r.status === 'APROBADO' ? 'aprobada' : 'resuelta'}`;

  if (status === 'APROBADO') {
    const p = db.prepare('SELECT * FROM products WHERE id = ?').get(r.product_id);
    if (p) {
      db.prepare('UPDATE products SET stock = stock + ?, low_stock_alerted = 0, updated_at = ? WHERE id = ?')
        .run(r.qty, now(), p.id);
      db.prepare(`
        INSERT INTO stock_movements (product_id, type, qty, ref_id, user_id, note)
        VALUES (?, 'RETURN', ?, ?, ?, ?)
      `).run(p.id, r.qty, r.sale_id, r.seller_id, `Devolución ${r.code} aprobada`);
    }
    const credits = db.prepare(`
      SELECT sp.method FROM sale_payments sp WHERE sp.sale_id = ? AND sp.method = 'credito'
    `).all(r.sale_id);
    if (credits.length && r.sale_id) {
      const sale = db.prepare('SELECT customer_id FROM sales WHERE id = ?').get(r.sale_id);
      if (sale && sale.customer_id) {
        db.prepare('UPDATE customers SET balance = balance - ? WHERE id = ?').run(Math.min(r.amount, credits.reduce((a, c) => a + 0, 0) || r.amount), sale.customer_id);
      }
    }
  }

  db.prepare('UPDATE refunds SET status = ?, note = ?, resolved_at = ? WHERE id = ?')
    .run(status, note || '', now(), r.id);
  const byUser = db.prepare('SELECT username FROM users WHERE id = ?').get(r.seller_id);
  const actor = byUser ? byUser.username : (by || 'bot');
  audit(
    { id: r.seller_id || 0, username: actor, permissions: [] },
    'DEVOLUCION', `${r.code} ${status} ${note || ''}`
  );
  return null;
}

// ---------- comandos ----------
const CLIENT_HELP = `Comandos disponibles:
• <code>/productos</code> — ver todos los productos disponibles y su precio
• <code>/precio NOMBRE</code> — consulta precio/stock de un producto
• <code>/solicitar NOMBRE MARCA</code> — solicita un producto (nombre y marca)
• <code>/comprar CODIGO CANTIDAD NombreRetira Telefono</code> — compra y pago a distancia
• <code>/pague RO-000001</code> — confirma que ya hiciste el pago
• <code>/promos</code> — ver promociones vigentes`;

const OWNER_HELP = `Comandos del negocio:
• <code>/pagar RO-000001</code> — verifica el pago y crea la venta
• <code>/cancelar RO-000001</code> — cancela el pedido
• <code>/aprobar ID</code> / <code>/rechazar ID</code> — resuelve devoluciones
• <code>/reporte</code> — resumen del día
• <code>/stock</code> — productos con stock bajo
• <code>/comunicado TEXTO</code> — aviso a vendedores
• <code>/tasa</code> — ver tasas · <code>/tasa USD 3700</code> — actualizar (1 USD = 3700 BS)
• <code>/chats</code> — dispositivos vinculados
• <code>/vincular USUARIO CONTRASEÑA ROL</code> — vincula este dispositivo (usuario del sistema)`;

async function showMenu(chatId, bot) {
  const isClientBot = (bot && (bot.kind === 'cliente' || bot.kind === 'negocio'));
  if (isClientBot && !linkedUser(chatId) && !isOwner(chatId) && !isSeller(chatId)) {
    return sendText(chatId, `<b>🏪 ${(getSetting('app') || {}).businessName || 'Mi Negocio'}</b>\n\n${CLIENT_HELP}\n\n👇 Toca un botón para comenzar:`, { buttons: menuButtons(chatId, bot) });
  }
  const u = linkedUser(chatId);
  const role = u ? db.prepare('SELECT * FROM roles WHERE id = ?').get(
    db.prepare('SELECT role_id FROM users WHERE id = ?').get(u.id).role_id
  ) : null;
  const cmds = (role ? bc.availableCommands(role) : []).filter(x => x !== '/ayuda' && x !== '/vincular');
  const help = u
    ? `👤 <b>${u.full_name || u.username}</b> · ${u.role_name}\n\n👇 Elige una opción:`
    : `📋 Comunícate con este bot del negocio.\n\nPara trabajar tendrás que vincular tu dispositivo:\n<code>/vincular USUARIO CONTRASEÑA ROL</code>\n\n👇 O elige una opción:`;
  return sendText(chatId, `<b>🏪 ${(getSetting('app') || {}).businessName || 'Mi Negocio'}</b>\n\n${help}`, { buttons: menuButtons(chatId, bot) });
}

async function handleCommand(cmd, chatId, from, bot) {
  const cfg = keys();
  const parts = cmd.trim().split(/\s+/);
  const c = (parts[0] || '').toLowerCase();
  const isClientBot = (bot && (bot.kind === 'cliente' || bot.kind === 'negocio'));

  if (c === '/start' || c === '/ayuda' || c === '/help' || c === 'hola' || c === '/menu') {
    return showMenu(chatId, bot);
  }

  // ---- vínculo de dispositivo: /vincular usuario contraseña rol [telefono ip mac] ----
  if (c === '/vincular' || c === '/registrar') {
    const username = (parts[1] || '').trim();
    const password = (parts[2] || '').trim();
    const desiredRole = (parts[3] || '').trim().toLowerCase();
    const phone = (parts[4] || '').trim();
    const ip = (parts[5] || '').trim();
    const mac = (parts[6] || '').trim();
    if (!username || !password || !desiredRole) {
      return sendText(chatId, '🖥️ <b>Vincular dispositivo</b>\n\nPara conectar intenta:\n<code>/vincular USUARIO CONTRASEÑA ROL</code>\n\nEl rol debe coincidir con el que tienes en el sistema: <i>vendedor, inventario, gerente, administrador o root</i>.\nOpcional: <code>/vincular USUARIO CONTRASEÑA ROL TELEFONO IP MAC</code>');
    }
    const user = db.prepare(`
      SELECT u.*, r.name AS role_name FROM users u LEFT JOIN roles r ON r.id = u.role_id WHERE u.username = ?
    `).get(username);
    if (!user || !bcrypt.compareSync(password, user.password_hash)) {
      audit({ id: 0, username: `bot(chat ${chatId})`, permissions: [] }, 'BOT_VINCULO', `login fallido ${username}`);
      return sendText(chatId, '❌ Usuario o contraseña incorrectos.');
    }
    if (!user.active) return sendText(chatId, '❌ Tu usuario está desactivado.');
    const realRole = (user.role_name || '').toLowerCase();
    const roleAlias = { 'inventario/almacén': 'inventario', 'inventario/almacen': 'inventario', 'vendedor/cajero': 'vendedor' };
    const norm = r => roleAlias[r] || r;
    if (norm(desiredRole) !== norm(realRole)) {
      audit({ id: 0, username: user.username, permissions: [] }, 'BOT_VINCULO', `rol no coincide ${desiredRole}!=${realRole} chat=${chatId}`);
      return sendText(chatId, `❌ El rol indicado (<b>${desiredRole}</b>) no coincide con tu rol real en el sistema (<b>${user.role_name}</b>). Registro cancelado.`);
    }
    const isOwnerRole = norm(realRole) === 'root' || norm(realRole) === 'administrador';
    const roleType = isOwnerRole ? 'owner' : 'vendedor';
    const ex = db.prepare('SELECT * FROM chat_members WHERE chat_id = ?').get(chatId);
    if (ex) {
      db.prepare('UPDATE chat_members SET user_id = ?, role = ?, display_name = ?, phone = ?, ip = ?, mac = ?, verified = 1, active = 1 WHERE id = ?')
        .run(user.id, roleType, user.full_name || user.username, phone, ip, mac, ex.id);
    } else {
      db.prepare('INSERT INTO chat_members (chat_id, role, display_name, phone, ip, mac, user_id, verified, active) VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1)')
        .run(chatId, roleType, user.full_name || user.username, phone, ip, mac, user.id);
    }
    audit({ id: user.id, username: user.username, permissions: [] }, 'BOT_VINCULO', `vinculó chat=${chatId} rol=${roleType} ip=${ip} mac=${mac}`);
    const role = db.prepare('SELECT * FROM roles WHERE id = ?').get(user.role_id);
    const cmds = bc.availableCommands(role).filter(x => x !== '/vincular');
    sendText(chatId, `✅ <b>Dispositivo vinculado</b>\n👤 ${user.full_name || user.username}\n🎖️ Rol: <strong>${user.role_name}</strong>\n${ip ? `IP: ${ip}\n` : ''}${mac ? `MAC: ${mac}\n` : ''}${phone ? `Tel: ${phone}\n` : ''}`);
    if (cmds.length) sendText(chatId, '🧭 <b>Tus comandos autorizados:</b>\n' + cmds.map(x => `<code>${x}</code>`).join(' '));
    return;
  }

  // ---- cliente: /precio ----
  if (c === '/precio' || c === '/consulta') {
    if (!isClientBot) return sendText(chatId, 'Este comando está disponible en el bot de clientes.');
    const p = productByRef(parts.slice(1).join(' '));
    if (!p) return sendText(chatId, '❌ Producto no encontrado. Prueba con el código, id o nombre exacto.');
    const tmp = [
      `📦 <b>${p.name}</b> (${p.code})`,
      `Precio detalle: <b>${fmt(p.price_minor)}</b>`,
      p.price_major ? `Precio mayorista: ${fmt(p.price_major)}` : null,
      p.price_special ? `Precio especial: ${fmt(p.price_special)}` : null,
      `Stock: <b>${p.stock}</b>`,
      p.stock <= 0 || p.stock <= p.stock_min
        ? `\n<i>Sin stock. Puedes apartarlo:</i> /apartar ${p.code} cant. Nombre Tel.`
        : `<i>Disponible. Compra:</i> /comprar ${p.code} 1 NombreRetira Tel.`
    ].filter(Boolean).join('\n');
    return sendText(chatId, tmp);
  }

  // ---- cliente: /consultar (envía una consulta al negocio) ----
  if (c === '/consultar' || c === '/mensaje') {
    if (!isClientBot) return sendText(chatId, 'Este comando está disponible en el bot de clientes.');
    const text = parts.slice(1).join(' ').trim();
    if (text) {
      storeInbox({ chat_id: chatId, kind: 'message', direction: 'in', sender_name: resolveSenderName(chatId, from), sender_phone: resolveSenderPhone(chatId), type: 'text', text, from_root: 0, read_flag: 0 });
      return sendText(chatId, `📩 <b>Consulta recibida</b>\n\n"${text}"\n\nGracias, nos pondremos en contacto contigo muy pronto.`, { noMenu: true });
    }
    return sendText(chatId, '📩 <b>Enviar consulta</b>\n\nEscribe aquí tu consulta o mensaje y el negocio te responderá (ej: ¿tienen el producto X? ¿hacen entregas?).', { buttons: [ [{ text: '❌ Cancelar', data: 'menu:show' }] ] });
  }

  // ---- cliente: /productos (catálogo completo, paginado) ----
  if (c === '/productos' || c === '/catalogo' || c === '/menu_productos') {
    if (!isClientBot) return sendText(chatId, 'Este comando está disponible en el bot de clientes.');
    const all = db.prepare('SELECT name, price_minor FROM products WHERE active = 1 AND stock > 0 ORDER BY name').all();
    if (!all.length) return sendText(chatId, 'Por ahora no hay productos disponibles. Puedes solicitarnos uno con: /solicitar NOMBRE MARCA');
    const lines = all.map(p => `📦 <b>${p.name}</b> — BS ${r2(p.price_minor)}`);
    // Telegram limita ~4000 caracteres/mensaje; dividimos en bloques de 25 productos
    const PER = 25;
    const total = lines.length;
    const blocks = [];
    for (let i = 0; i < lines.length; i += PER) blocks.push(lines.slice(i, i + PER));
    sendText(chatId, `🛍️ <b>Productos disponibles</b> (${total})\n${blocks[0].join('\n')}`);
    for (let i = 1; i < blocks.length; i++) {
      sendText(chatId, `${blocks[i].join('\n')}`);
    }
    sendText(chatId, `¿Quieres comprar alguno? Escríbenos el nombre con /precio NOMBRE, o /comprar NOMBRE 1 TuNombre TuTelefono`);
    return;
  }

  // ---- cliente: /solicitar NOMBRE [MARCA] ----
  if (c === '/solicitar' || c === '/pedir') {
    if (!isClientBot) return sendText(chatId, 'Este comando está disponible en el bot de ventas.');
    const rest = parts.slice(1).join(' ').trim();
    if (!rest) return sendText(chatId, '🛍️ <b>Solicitar producto</b>\n\nEscríbenos el producto que quieres. Ejemplos:\n• <code>/solicitar Mermelada de Fresa</code>\n• <code>/solicitar Mermelada Fresa Alba</code> (con marca)\n\nSi no lo tenemos, lo tomamos en cuenta para la empresa.');
    const all = db.prepare('SELECT name FROM products WHERE active = 1').all().map(p => p.name.toLowerCase());
    const inCatalog = all.some(n => rest.toLowerCase().includes(n) || n.includes(rest.toLowerCase().split(' ')[0]));
    const code = nextCode('SOL', 'product_requests');
    const qty = 1;
    const contact = `${from.first_name || ''} ${from.last_name || ''}`.trim() || `${from.username || ''}`.trim();
    db.prepare(`
      INSERT INTO product_requests (code, product_name, brand, qty, contact_name, contact_phone, notes, status, source)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDIENTE', 'BOT')
    `).run(code, rest, '', qty, contact, '', `Cliente Telegram: ${chatId}`);
    notifyOwners(`🛍️ <b>Solicitud de producto</b> <code>${code}</code>\nProducto: <b>${rest}</b>\n${inCatalog ? '· Ya existe en el catálogo (revisar stock/reposición)' : '· Producto nuevo, valorar su compra'}\nContacto: ${contact} (chat ${chatId})\n\nGestiónalo en el sistema.`);
    notifySellers(`🛍️ Solicitud ${code}: producto "${rest}"${inCatalog ? ' (existe, ver stock)' : ' (nuevo)'}`);
    return sendText(chatId, inCatalog
      ? `✅ <b>Solicitud registrada</b> <code>${code}</code>\n\nTomamos nota de <b>"${rest}"</b>. Te avisaremos cuando esté disponible la reposición.`
      : `✅ <b>Solicitud registrada</b> <code>${code}</code>\n\nNo tenemos <b>"${rest}"</b> por ahora, pero lo tomamos en cuenta para la empresa. Te contactaremos si lo conseguimos.`);
  }

  // ---- cliente: /apartar ----
  if (c === '/apartar') {
    if (!isClientBot) return sendText(chatId, 'Este comando está disponible en el bot de clientes.');
    const ref = parts[1] || '';
    const qty = Number(parts[2]) || 0;
    const name = (parts[3] || '').trim();
    const phone = (parts[4] || '').trim();
    if (phone) linkChat(chatId, 'cliente', name || from.first_name || '', phone);
    const p = productByRef(ref);
    if (!p) return sendText(chatId, '❌ Producto no encontrado.');
    if (qty <= 0) return sendText(chatId, 'Uso: /apartar CODIGO CANTIDAD NOMBRE TELEFONO');
    const code = nextCode('RO', 'remote_orders');
    db.prepare(`
      INSERT INTO remote_orders (code, product_id, product_name, qty, price, total, client_name, client_phone, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'APARTADO')
    `).run(code, p.id, p.name, qty, p.price_minor, r2(p.price_minor * qty), name || `${from.username || from.first_name || ''}`.trim(), phone);
    const lacks = p.stock <= 0;
    sendText(chatId, `🗒️ <b>Apartado</b>\n${p.name} x${qty} — ${fmt(r2(p.price_minor * qty))}\nCódigo: <code>${code}</code>\n${lacks ? '\n⚠️ Te avisaremos cuando haya stock.' : '\n📞 Te contactarán para el pago y entrega.'}`);
    notifyOwners(`🗒️ Apartado solicitado (${lacks ? 'SIN STOCK' : 'hay stock'}):\n${p.name} x${qty} — ${fmt(r2(p.price_minor * qty))}\nCódigo: <code>${code}</code>\nContacto: ${name} ${phone}`);
    notifySellers(`🗒️ Nuevo apartado ${code}: ${p.name} x${qty} — Contacto: ${name} ${phone}`);
    return;
  }

  // ---- cliente: /comprar (pago a distancia) ----
  if (c === '/comprar') {
    if (!isClientBot) return sendText(chatId, 'Este comando está disponible en el bot de clientes.');
    const ref = parts[1] || '';
    if (!ref) {
      // Sin argumentos: mostrar catálogo para agregar al carrito
      const list = db.prepare('SELECT * FROM products WHERE active = 1 ORDER BY name LIMIT 20').all();
      if (!list.length) return sendText(chatId, 'Por ahora no hay productos disponibles.');
      const st = buyFlow.get(chatId);
      const summary = st && st.items.length ? `\n\n🛒 En tu carrito: <b>${fmt(cartTotal(st.items))}</b>` : '';
      return sendText(chatId,
`🛍️ <b>Compra a distancia</b>
Selecciona un producto para agregarlo a tu pedido (puedes elegir varios):${summary}

${list.map(p => `${p.name} — <b>${fmt(r2(p.price_minor))}</b>${p.stock <= 0 ? ' <i>(sin stock)</i>' : ''}`).join('\n')}`,
      { buttons: catalogButtons() });
    }
    const qty = Number(parts[2]) || 0;
    const pickup = (parts[3] || '').trim();
    const phone = (parts[4] || '').trim();
    const p = productByRef(ref);
    if (!p) return sendText(chatId, '❌ Producto no encontrado.');
    if (qty <= 0 || !pickup) return sendText(chatId, 'Uso: /comprar CODIGO CANTIDAD NOMBRERETIRA TELEFONO');
    if (qty > p.stock) return sendText(chatId, `⚠️ Solo hay ${p.stock} de "${p.name}". Apártalo con: /apartar ${p.code} ${qty} ${pickup} ${phone}`);
    return createRemoteOrder(chatId, [{ product: p, qty }], pickup, phone, from);
  }

  // ---- cliente: /pague <code> ----
  if (c === '/pague') {
    const code = parts[1] || '';
    const meth = parts.slice(2).join(' ') || '';
    const o = orderByRef(code);
    if (!o) return sendText(chatId, '❌ Pedido no encontrado.');
    if (o.status === 'PAGADO') return sendText(chatId, 'Este pedido ya fue confirmado y transformado en venta.');

    let method = meth;
    const remotes = remoteMethods();
    if (!method) method = (remotes[0] || {}).name || '';
    db.prepare('UPDATE remote_orders SET method = ?, status = ? WHERE id = ?').run(method, 'ACEPTADO_CLIENTE', o.id);
    sendText(chatId, `✅ Confirmado. Tu pedido <code>${o.code}</code> está en proceso de validación. Retira cuando el negocio confirme.`);
    notifyOwners(`💳 Cliente confirmó pago de <code>${o.code}</code> (${fmt(o.total)}) por <b>${method}</b>.\nRetira: ${o.pickup_name} ${o.client_phone}`, {
      buttons: [ [{ text: '✅ Verificar y crear venta', data: `/pagar ${o.code}` }, { text: '🚫 Cancelar', data: `/cancelar ${o.code}` }] ]
    });
    notifySellers(`💳 Cliente pagó ${o.code} (${fmt(o.total)}) por <b>${method}</b>. Entrega a: ${o.pickup_name} ${o.client_phone}`);
    return;
  }

  // ---- cliente: /promos ----
  if (c === '/promos' || c === '/promociones') {
    if (!isClientBot) return sendText(chatId, 'Este comando está disponible en el bot de clientes.');
    const rows = db.prepare(`SELECT title, message, sent_at FROM promotions WHERE sent_at IS NOT NULL ORDER BY id DESC LIMIT 5`).all();
    if (!rows.length) return sendText(chatId, 'Por ahora no hay promociones vigentes, ¡pero síguenos! 🛍️');
    return sendText(chatId, '📢 <b>Promociones del negocio</b>\n\n' + rows.map(p => `• <b>${p.title}</b>\n  ${p.message}`).join('\n\n'));
  }

  // ---- /pagar <code> ----
  if (c === '/pagar') {
    const cap = chatCan(chatId, '/pagar');
    if (!cap || !cap.allowed) return sendText(chatId, 'No tienes permiso para confirmar pagos. Si eres personal, vincúlalo con tu usuario o pide acceso a este comando al Root.');
    const o = orderByRef(parts[1] || '');
    if (!o) return sendText(chatId, '❌ Pedido no encontrado.');
    if (o.status === 'PAGADO') return sendText(chatId, 'Ya fue convertido en venta.');
    // Ítems del pedido (soporta varios productos por pedido)
    let items = db.prepare('SELECT * FROM remote_order_items WHERE order_id = ?').all(o.id);
    if (!items.length) items = [{ product_id: o.product_id, qty: o.qty }];
    for (const it of items) {
      const p = db.prepare('SELECT * FROM products WHERE id = ? AND active = 1').get(it.product_id);
      if (!p) return sendText(chatId, `❌ Un producto del pedido fue eliminado.`);
      if (it.qty > p.stock) return sendText(chatId, `⚠️ Stock insuficiente para ${it.qty} de "${p.name}" (hay ${p.stock}). /cancelar ${o.code}`);
    }

    const actor = cap.user;
    const saleSvc = require('./sales-service');
    const res = saleSvc.createSale({ id: actor.id, username: actor.username, permissions: actor.permissions }, {
      items: items.map(it => ({ product_id: it.product_id, qty: it.qty })),
      priceList: 'minor',
      discount: 0,
      source: 'BOT',
      payments: [{ method: (o.method || '').toLowerCase().replace(/[^a-z\s]/g, '').trim().replace(/\s+/g, '_') || 'transferencia', amount: o.total }]
    }, { silent: true });

    if (res.err) return sendText(chatId, `❌ ${res.err}`);
    db.prepare('UPDATE remote_orders SET status = ?, sale_id = ?, paid_at = ?, taken_by = ? WHERE id = ?')
      .run('PAGADO', res.id, now(), actor.username, o.id);
    sendText(chatId, `✅ Venta creada: <code>${res.folio}</code> — ${fmt(res.total)}\nPedido: ${o.code}`);
    if (o.client_phone) {
      sendText(chatId, `📍 Entrega a: ${o.pickup_name} — ${o.client_phone}`);
    }
    try {
      storeInbox({
        chat_id: ORDENES_CHAT, kind: 'orden', direction: 'in', type: 'text', from_root: 0, read_flag: 0,
        sender_name: o.pickup_name || o.client_name || 'Cliente', sender_phone: o.client_phone || '',
        text: `✅ <code>${o.code}</code> PAGADO → venta <code>${res.folio}</code> — ${fmt(res.total)}\nEntrega a: ${o.pickup_name} ${o.client_phone}`
      });
    } catch (e) {}
    notifySellers(`✅ <code>${o.code}</code> PAGADO → venta ${res.folio}. Entrega a: ${o.pickup_name} ${o.client_phone}`);
    return;
  }

  // ---- /cancelar <code> ----
  if (c === '/cancelar') {
    const cap = chatCan(chatId, '/cancelar');
    if (!cap || !cap.allowed) return sendText(chatId, 'No tienes permiso para cancelar pedidos.');
    const o = orderByRef(parts[1] || '');
    if (!o) return sendText(chatId, '❌ Pedido no encontrado.');
    if (o.status === 'PAGADO') return sendText(chatId, 'El pedido ya fue vendido.');
    db.prepare('UPDATE remote_orders SET status = ? WHERE id = ?').run('CANCELADO', o.id);
    sendText(chatId, `🚫 Pedido ${o.code} cancelado.`);
    if (o.client_phone) sendText(chatId, 'El pedido fue cancelado. Te informamos desde el negocio.');
    return;
  }

  // ---- aprobar / rechazar devolución ----
  if (c === '/aprobar' || c === '/rechazar') {
    const cap = chatCan(chatId, '/aprobar');
    if (!cap || !cap.allowed) return sendText(chatId, 'No tienes permiso para resolver devoluciones.');
    const refId = Number((parts[1] || '').replace(/\D/g, ''));
    if (!refId) return sendText(chatId, `Uso: ${c} ID`);
    const status = c === '/aprobar' ? 'APROBADO' : 'RECHAZADO';
    const err = resolveRefund(refId, status, `bot (${cap.user.username})`, '');
    if (err) return sendText(chatId, err);
    const r = db.prepare('SELECT * FROM refunds WHERE id = ?').get(refId);
    sendText(chatId, `✅ Devolución ${r.code} ${status === 'APROBADO' ? 'APROBADA' : 'RECHAZADA'}.\n${status === 'APROBADO' ? `Stock repuesto: +${r.qty} de ${r.product_name}\nNota de crédito en el sistema.` : ''}`);
    if (r.seller_id) {
      const mex = status === 'APROBADO'
        ? `✅ <b>Devolución ${r.code} APROBADA</b> por el dueño.\n${r.product_name} x${r.qty} — ${fmt(r.amount)}\nStock repuesto y nota de crédito generada.`
        : `❌ <b>Devolución ${r.code} RECHAZADA</b> por el dueño.`;
      for (const s of sellers()) { if (s.chat_id !== chatId) sendText(s.chat_id, mex); }
    }
    return;
  }

  // ---- /reporte ----
  if (c === '/reporte') {
    const cap = chatCan(chatId, '/reporte');
    if (!cap || !cap.allowed) return sendText(chatId, 'No tienes permiso para ver reportes.');
    const day = now().slice(0, 10);
    const s = db.prepare(`SELECT COUNT(*) c, COALESCE(SUM(total),0) t FROM sales WHERE date(created_at) = date('now','localtime')`).get();
    const byPay = db.prepare(`SELECT sp.method, SUM(sp.amount) amt FROM sale_payments sp JOIN sales s ON s.id = sp.sale_id WHERE date(s.created_at) = date('now','localtime') GROUP BY sp.method`).all();
    const low = db.prepare('SELECT name, stock, stock_min FROM products WHERE stock_min > 0 AND stock <= stock_min ORDER BY (stock - stock_min) LIMIT 10').all();
    const open = db.prepare('SELECT COUNT(*) c FROM cash_sessions WHERE status = \'ABIERTA\'').get().c;
    const bot = db.prepare(`SELECT COUNT(*) c, COALESCE(SUM(total),0) t FROM sales WHERE source='BOT' AND date(created_at) = date('now','localtime')`).get();
    sendText(chatId,
`📊 <b>Reporte ${day}</b>
Ventas: <b>${s.c} ventas</b> — <b>${fmt(s.t)}</b>
${byPay.map(m => `  ${m.method}: ${fmt(m.amt)}`).join('\n')}
🤖 Ventas a distancia: ${bot.c} — ${fmt(bot.t)}
Cajas abiertas: ${open}
${low.length ? `\n⚠️ <b>Stock bajo:</b>\n` + low.map(p => `  ${p.name}: ${p.stock} (mín ${p.stock_min})`).join('\n') : '\nStock normal.'}`);
    return;
  }

  // ---- /stock ----
  if (c === '/stock') {
    const cap = chatCan(chatId, '/stock');
    if (!cap || !cap.allowed) return sendText(chatId, 'No tienes permiso para consultar stock.');
    const low = db.prepare('SELECT name, stock, stock_min FROM products WHERE stock_min > 0 AND stock <= stock_min ORDER BY (stock - stock_min) LIMIT 15').all();
    if (!low.length) return sendText(chatId, '✅ Stock de todos los productos dentro del mínimo.');
    sendText(chatId, '⚠️ <b>Productos con stock bajo:</b>\n' + low.map(p => `${p.name}: ${p.stock} (mín ${p.stock_min})`).join('\n'));
    return;
  }

  // ---- /comunicado ----
  if (c === '/comunicado') {
    const cap = chatCan(chatId, '/comunicado');
    if (!cap || !cap.allowed) return sendText(chatId, 'Solo el Root puede enviar comunicados.');
    const txt = cmd.replace(/^\/comunicado\s+/i, '');
    if (!txt) return sendText(chatId, 'Uso: /comunicado TEXTO');
    const sent = [];
    for (const s of sellers()) { if (await sendText(s.chat_id, `📢 ${txt}\n— ${cap.user.username}`)) sent.push(s.display_name || s.chat_id); }
    try {
      storeInbox({ chat_id: COMUNICADOS_CHAT, kind: 'comunicado', direction: 'out', sender_name: cap.user.username, type: 'text', text: txt, from_root: 1, read_flag: 0 });
    } catch (e) {}
    sendText(chatId, `📢 Comunicado enviado a ${sent.length} vendedor(es).`);
    return;
  }

  // ---- /tasa ----
  if (c === '/tasa') {
    const cap = chatCan(chatId, '/tasa');
    if (!cap || !cap.allowed) return sendText(chatId, `No tienes permiso para ver o cambiar las tasas.\n\n${tasasText()}`);
    const base = (getSetting('app') || {}).currency || 'BS';
    const code = (parts[1] || '').trim().toUpperCase();
    if (!code) {
      return sendText(chatId, `${tasasText()}\n\n✏️ <b>Actualizar:</b> <code>/tasa USD 3700</code>  →  1 USD = 3700 ${base}`);
    }
    const rate = Math.round(Number(parts[2]) * 10000) / 10000;
    if (Number.isNaN(rate)) return sendText(chatId, `Uso correcto: <code>/tasa ${code} VALOR</code>  (ej: <code>/tasa ${code} 3700</code>)`);
    let list = extraCurrencies();
    const oldUsd = Number((list.find(x => x.code === 'USD') || {}).rate);
    if (rate > 0) {
      const ex = list.find(x => x.code === code);
      if (ex) ex.rate = rate;
      else list.push({ code, symbol: '$', rate });
    } else {
      list = list.filter(x => x.code !== code);
    }
    saveCurrencies(list);
    let repriced = 0;
    if (oldUsd > 0 && rate > 0 && Math.abs(rate - oldUsd) > 1e-9) {
      repriced = applyRateChange(oldUsd, rate) || 0;
    }
    audit({ id: 0, username: `bot (chat ${chatId})`, permissions: [] }, 'BOT_TASA', `${code}=${rate} ${base}${repriced ? ` (${repriced} precios re-escalados)` : ''}`);
    sendText(chatId, rate > 0
      ? `✅ <b>Tasa actualizada:</b> 1 ${code} = <b>${rate}</b> ${base}\n${repriced ? `♻️ ${repriced} productos actualizados automáticamente.` : ''}\nEl POS y el ingreso de productos ya usan esta tasa.`
      : `🗑️ Se eliminó la moneda ${code} de las tasas.`);
    return;
  }

  // ---- /aviso ----
  if (c === '/aviso' || c === '/avisos') {
    const cap = chatCan(chatId, '/aviso');
    if (!cap || !cap.allowed) return sendText(chatId, 'No tienes permiso para enviar avisos.');
    const txt = cmd.replace(/^\/avis?o(s)?\s+/i, '').trim();
    if (!txt) return sendText(chatId, 'Uso: /aviso TEXTO');
    const user = cap.user;
    await notifyOwners(`📢 <b>Aviso</b> de ${user.full_name || user.username} (${user.role_name}):\n${txt}`);
    sendText(chatId, `✅ Aviso enviado al Root.`);
    return;
  }

  // ---- /devolucion ----
  if (c === '/devolucion' || c === '/devolver') {
    const cap = chatCan(chatId, '/devolucion');
    if (!cap || !cap.allowed) return sendText(chatId, 'No tienes permiso para solicitar devoluciones.');
    const ref = (parts[1] || '').trim();
    const qty = Number(parts[2]) || 0;
    const reason = parts.slice(3).join(' ') || 'sin motivo';
    if (!ref || qty <= 0) return sendText(chatId, 'Uso: /devolucion CODIGO CANTIDAD MOTIVO');
    const p = productByRef(ref);
    if (!p) return sendText(chatId, '❌ Producto no encontrado.');
    const user = cap.user;
    const code = nextCode('DF', 'refunds');
    db.prepare(`
      INSERT INTO refunds (code, sale_id, product_id, product_name, qty, amount, reason, status, seller_id, requested_by)
      VALUES (?, NULL, ?, ?, ?, ?, ?, 'PENDIENTE', ?, 'BOT')
    `).run(code, p.id, p.name, qty, r2(p.price_minor * qty), reason, user.id);
    const r = db.prepare('SELECT * FROM refunds WHERE code = ?').get(code);
    await notifyOwners(`🧾 <b>Devolución solicitada</b> <code>${code}</code>\n${p.name} x${qty} — ${fmt(r2(p.price_minor * qty))}\nMotivo: ${reason}\nPor: ${user.full_name || user.username}\n\n<b>Aprobar:</b> /aprobar ${r.id}\n<b>Rechazar:</b> /rechazar ${r.id}`);
    sendText(chatId, `✅ Devolución <code>${code}</code> solicitada al Root. Te notificaremos su aprobación.`);
    return;
  }

  // ---- /caja ----
  if (c === '/caja') {
    const cap = chatCan(chatId, '/caja');
    if (!cap || !cap.allowed) return sendText(chatId, 'No tienes permiso para consultar la caja.');
    const ses = db.prepare(`SELECT cs.*, u.username FROM cash_sessions cs LEFT JOIN users u ON u.id = cs.opened_by WHERE cs.status = 'ABIERTA'`).all();
    if (!ses.length) return sendText(chatId, 'No hay caja abierta en este momento.');
    const msg = [];
    for (const s of ses) {
      const tot = db.prepare(`SELECT COUNT(*) c, COALESCE(SUM(total),0) t FROM sales WHERE date(created_at) = date('now','localtime') AND session_id = ?`).get(s.id);
      msg.push(`💰 <b>Caja ${s.name || s.id}</b>\nAbierta por: ${s.username || '—'} — ${s.opened_at}\nVentas de hoy: ${tot.c} — ${fmt(tot.t)}`);
    }
    return sendText(chatId, msg.join('\n\n'));
  }

  // ---- /cierre ----
  if (c === '/cierre') {
    const cap = chatCan(chatId, '/cierre');
    if (!cap || !cap.allowed) return sendText(chatId, 'No tienes permiso para solicitar cierre de caja.');
    const link = linkedUser(chatId);
    const ses = db.prepare(`SELECT cs.*, u.username FROM cash_sessions cs LEFT JOIN users u ON u.id = cs.opened_by WHERE cs.status = 'ABIERTA'`).all();
    await notifyOwners(`🔒 <b>Solicitud de cierre de caja</b>\nPor: ${link.user.full_name || link.user.username} (${link.user.role_name})\nCajas abiertas actualmente: ${ses.length}\nRevisa en el sistema la caja y procede al cierre.`);
    sendText(chatId, '✅ Solicitud de cierre enviada al Root. Revisará la caja en el sistema.');
    return;
  }

  if (c === '/chats') {
    const cap = chatCan(chatId, '/chats');
    if (!cap || !cap.allowed) return sendText(chatId, 'Solo el Root puede listar los chat vinculados.');
    const list = db.prepare(`SELECT cm.chat_id, cm.role, cm.display_name, cm.phone, cm.ip, cm.mac, cm.active, u.username FROM chat_members cm LEFT JOIN users u ON u.id = cm.user_id`).all();
    sendText(chatId, list.length ? '👥 <b>Dispositivos vinculados:</b>\n' + list.map(l => `${(l.username || l.role)}: ${l.display_name} (${l.chat_id})${l.ip ? ' · ' + l.ip : ''}${l.active ? '' : ' 🔕'}`).join('\n') : 'Sin chats vinculados.');
    return;
  }

  return sendText(chatId, 'Comando no reconocido. Usa /ayuda');
}

// ---------- alertas ----------
async function queueLowStock(p) {
  const cfg = keys();
  if (!cfg.notifyLowStock) return;
  const row = db.prepare('SELECT low_stock_alerted FROM products WHERE id = ?').get(p.id);
  if (!row || row.low_stock_alerted) return;
  db.prepare('UPDATE products SET low_stock_alerted = 1 WHERE id = ?').run(p.id);
  await notifyOwners(`⚠️ <b>Stock bajo:</b> ${p.name} — quedan ${p.stock} (mín ${p.stock_min || 0})`);
}

function scanLowStock() {
  const cfg = keys();
  if (!cfg.notifyLowStock) return;
  const rows = db.prepare('SELECT * FROM products WHERE stock_min > 0 AND stock <= stock_min AND low_stock_alerted = 0 LIMIT 20').all();
  for (const p of rows) { db.prepare('UPDATE products SET low_stock_alerted = 1 WHERE id = ?').run(p.id); }
  if (rows.length) {
    notifyOwners('⚠️ <b>Stock bajo:</b>\n' + rows.map(p => `  ${p.name}: ${p.stock} (mín ${p.stock_min})`).join('\n'));
  }
}

// ---------- solicitar devolución desde la app (notifica bot) ----------
async function requestRefundNotify(refund) {
  const r = db.prepare('SELECT * FROM refunds WHERE id = ?').get(refund.id);
  const seller = db.prepare('SELECT username FROM users WHERE id = ?').get(r.seller_id);
  await notifyOwners(
`🧾 <b>Devolución solicitada</b> <code>${r.code}</code>
Venta ${r.sale_id} — ${r.product_name} x${r.qty} (${fmt(r.amount)})
Motivo: ${r.reason || 'sin motivo'}
Solicitada por: ${seller ? seller.username : 'app'}

<b>Aprobar:</b> /aprobar ${r.id}
<b>Rechazar:</b> /rechazar ${r.id}`
  );
  await notifySellers(`🧾 Nueva devolución ${r.code} en espera de aprobación del dueño.`);
}

// ---------- reporte diario programado ----------
function checkDaily() {
  const cfg = keys();
  if (!cfg.reportHour && cfg.reportHour !== 0) return;
  const d = new Date();
  if (d.getHours() !== Number(cfg.reportHour)) return;
  const key = now().slice(0, 10);
  if (dailySentDay === key) return;
  dailySentDay = key;
  const s = db.prepare(`SELECT COUNT(*) c, COALESCE(SUM(total),0) t FROM sales WHERE date(created_at) = date('now','localtime')`).get();
  const byPay = db.prepare(`SELECT sp.method, SUM(sp.amount) amt FROM sale_payments sp JOIN sales s ON s.id = sp.sale_id WHERE date(s.created_at) = date('now','localtime') GROUP BY sp.method`).all();
  const bot = db.prepare(`SELECT COUNT(*) c, COALESCE(SUM(total),0) t FROM sales WHERE source='BOT' AND date(created_at) = date('now','localtime')`).get();
  notifyOwners(
`📊 <b>Resumen del día</b> (${key})
Ventas: ${s.c} — <b>${fmt(s.t)}</b>
🤖 Ventas a distancia: ${bot.c} — ${fmt(bot.t)}
${byPay.map(m => `  ${m.method}: ${fmt(m.amt)}`).join('\n')}`
  );
}

// ---------- promociones ----------
// Nota: requiere permiso marketing.promos (solo Root) por la ruta; aquí solo el envío.
async function sendPromotion(title, message, byUser) {
  // Clientes del negocio con teléfono que hayan interactuado con algún bot
  const clients = db.prepare(`
    SELECT c.id, c.name, c.phone, cm.chat_id
    FROM customers c
    JOIN chat_members cm ON cm.phone = c.phone AND cm.role = 'cliente' AND cm.active = 1
    WHERE c.active = 1 AND c.phone != ''
    GROUP BY cm.chat_id
  `).all();
  let sent = 0;
  for (const cl of clients) {
    const text = `📢 <b>${title}</b>\n\n${String(message).replace(/\{nombre\}/gi, cl.name || 'amigo')}\n\n— ${(getSetting('app') || {}).businessName || 'Mi Negocio'}\n<i>Contesten "no" a este mensaje si no quieren recibir avisos.</i>`;
    try {
      // Enviar preferiblemente por un bot tipo "cliente"
      const clientBots = activeBots().filter(b => b.kind === 'cliente');
      const pool = clientBots.length ? clientBots : activeBots();
      for (const b of pool) {
        if (await tg('sendMessage', b.token, { chat_id: cl.chat_id, text, parse_mode: 'HTML' })) { sent++; break; }
      }
    } catch (e) { /* cliente inalcanzable */ }
  }
  db.prepare(`
    INSERT INTO promotions (title, message, created_by, sent_at, sent_count, total_clients)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(String(title).trim(), String(message).trim(), byUser ? byUser.id : null, now(), sent, clients.length);
  return { sent, total: clients.length };
}

// ---------- compra guiada / pago a distancia (carrito multi-producto) ----------
function cartTotal(cart) {
  return r2(cart.reduce((s, it) => s + it.product.price_minor * it.qty, 0));
}

function cartLine(it) {
  return `• ${it.product.name} x${it.qty} — <b>${fmt(r2(it.product.price_minor * it.qty))}</b>`;
}

// Botones de acciones del carrito (agregar más, finalizar, vaciar, cancelar).
function cartMenuButtons() {
  return [
    [{ text: '➕ Agregar otro producto', data: 'buy_cart_more' }],
    [{ text: '✅ Finalizar pedido', data: 'buy_cart_done' }],
    [{ text: '🗑️ Vaciar carrito', data: 'buy_cart_clear' }, { text: '❌ Cancelar', data: 'buy_cancel' }]
  ];
}

// Reúne la lista de productos con su botón de agregar al carrito.
function catalogButtons() {
  const list = db.prepare('SELECT * FROM products WHERE active = 1 ORDER BY name LIMIT 20').all();
  return list.map(p => ([{ text: `🛒 ${p.name} — ${fmt(r2(p.price_minor))}${p.stock <= 0 ? ' (sin stock)' : ''}`, data: `buy:${p.id}` }]));
}

// Crea el pedido remoto (cabecera + ítems) y envía medios de pago y notificaciones.
async function createRemoteOrder(chatId, cart, pickup, phone, from) {
  const methods = remoteMethods();
  if (!methods.length) return sendText(chatId, '⚠️ Pago a distancia desactivado. Contáctanos para comprar.');
  if (!cart.length) return sendText(chatId, 'Tu carrito está vacío.');
  if (phone) linkChat(chatId, 'cliente', `${from.username || from.first_name || ''}`.trim(), phone);

  const code = nextCode('RO', 'remote_orders');
  const total = cartTotal(cart);
  const first = cart[0];
  const clientName = `${from.username || from.first_name || ''}`.trim();
  const ins = db.prepare(`
    INSERT INTO remote_orders (code, product_id, product_name, qty, price, total, client_name, client_phone, pickup_name, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDIENTE')
  `).run(code, first.product.id, first.product.name, first.qty, first.product.price_minor, total, clientName, phone, pickup);
  const orderId = ins.lastInsertRowid;
  const iItem = db.prepare('INSERT INTO remote_order_items (order_id, product_id, product_name, qty, price, total) VALUES (?, ?, ?, ?, ?, ?)');
  for (const it of cart) iItem.run(orderId, it.product.id, it.product.name, it.qty, it.product.price_minor, r2(it.product.price_minor * it.qty));

  sendText(chatId,
`🛒 <b>Pedido</b> ${code}
${cart.map(cartLine).join('\n')}
<b>Total: ${fmt(total)}</b>
Retira: ${pickup} - ${phone}

Realiza el pago por uno de estos medios:
${methods.map(m => {
  const lines = [`• ${m.icon} <b>${m.name}</b>`];
  if (m.bank) lines.push(`   🏦 ${m.bank}`);
  if (m.account_holder) lines.push(`   👤 ${m.account_holder}`);
  if (m.phone) lines.push(`   📱 Pago móvil: ${m.phone}`);
  if (m.account_number) lines.push(`   💳 ${m.account_number}`);
  if (m.instructions) lines.push(`   ℹ️ ${m.instructions}`);
  return lines.join('\n');
}).join('\n\n')}

Cuando pagues envía:
<code>/pague ${code}</code>`);
  notifyOwners(`🛒 Nuevo pedido ${code}\n${cart.map(it => `${it.product.name} x${it.qty} — ${fmt(r2(it.product.price_minor * it.qty))}`).join('\n')}\n<b>Total: ${fmt(total)}</b>\nRetira: ${pickup} ${phone}`, {
    buttons: [ [{ text: '✅ Confirmar pago', data: `/pagar ${code}` }, { text: '🚫 Cancelar', data: `/cancelar ${code}` }] ]
  });
  notifySellers(`🛒 Pedido ${code}: ${cart.map(it => `${it.product.name} x${it.qty}`).join(', ')} — ${fmt(total)}\nRetira: ${pickup} ${phone}`);
  return true;
}

// Inicia la compra guiada al tocar un producto del catálogo (botón "buy:<id>").
function getCart(chatId) {
  let st = buyFlow.get(chatId);
  if (!st) { st = { step: 'cantidad', items: [], pending: null, pickup: '', phone: '' }; buyFlow.set(chatId, st); }
  return st;
}

async function startBuyFlow(chatId, productId, from, bot) {
  const p = db.prepare('SELECT * FROM products WHERE id = ? AND active = 1').get(Number(productId));
  if (!p) return sendText(chatId, '❌ Producto no encontrado.');
  if (p.stock <= 0) return sendText(chatId, `⚠️ "${p.name}" no tiene stock disponible ahorita.`);
  const st = getCart(chatId);
  st.pending = p;
  st.step = 'cantidad';
  sendText(chatId,
`🛒 <b>${p.name}</b> — ${fmt(r2(p.price_minor))}
Stock: ${p.stock}

Escribe cuántas unidades quieres agregar`,
  { buttons: [ [{ text: '❌ Cancelar', data: 'buy_cancel' }, { text: '🗑️ Vaciar', data: 'buy_cart_clear' }] ] });
}

// Muestra el resumen del carrito con sus acciones.
async function showCart(chatId, st, bot) {
  if (!st.items.length) return sendText(chatId, 'Tu carrito está vacío. Elige un producto para empezar.', { buttons: [ [{ text: '🛍️ Ver productos', data: 'buy_cart_more' }] ] });
  const body = `🛒 <b>Tu pedido</b>\n\n${st.items.map(cartLine).join('\n')}\n\n<b>Total: ${fmt(cartTotal(st.items))}</b>`;
  sendText(chatId, body, { buttons: cartMenuButtons() });
}

// Avanza el flujo guiado con cada respuesta de texto o botón del cliente.
async function stepBuyFlow(chatId, text, from, bot) {
  const st = buyFlow.get(chatId);
  if (!st) return;

  if (st.step === 'cantidad') {
    if (!st.pending) return sendText(chatId, 'Elige un producto del catálogo primero.', { buttons: [ [{ text: '🛍️ Ver productos', data: 'buy_cart_more' }] ] });
    const qty = Math.floor(Number(text.replace(',', '.')));
    if (!qty || qty <= 0) return sendText(chatId, 'Escribe una cantidad válida (número).');
    if (qty > st.pending.stock) return sendText(chatId, `⚠️ Solo hay ${st.pending.stock} de "${st.pending.name}". Escribe una cantidad menor.`);
    const ex = st.items.find(i => i.product.id === st.pending.id);
    if (ex) ex.qty += qty; else st.items.push({ product: st.pending, qty });
    st.pending = null;
    return showCart(chatId, st, bot);
  }

  if (st.step === 'pickup') {
    st.pickup = text.trim();
    st.step = 'phone';
    return sendText(chatId, '¿Tu número de teléfono? (para coordinarte el pago y la entrega)', { buttons: [ [{ text: '❌ Cancelar', data: 'buy_cancel' }] ] });
  }

  if (st.step === 'phone') {
    const phone = text.trim();
    if (!phone) return sendText(chatId, 'Escribe un teléfono válido.');
    st.phone = phone;
    const ok = await createRemoteOrder(chatId, st.items, st.pickup, phone, from);
    buyFlow.delete(chatId);
    if (ok) sendText(chatId, '👇 Puedes seguir viendo más opciones:', { buttons: menuButtons(chatId, bot) });
  }
}

// Acciones de botón específicas del carrito.
async function cartCallback(chatId, data, from, bot) {
  const st = buyFlow.get(chatId);
  if (data === 'buy_cart_more') {
    const list = db.prepare('SELECT * FROM products WHERE active = 1 ORDER BY name LIMIT 20').all();
    if (!list.length) return sendText(chatId, 'Por ahora no hay productos disponibles.');
    const summary = st && st.items.length ? `\n\n🛒 En tu carrito: <b>${fmt(cartTotal(st.items))}</b>` : '';
    return sendText(chatId, `🛍️ <b>Elige un producto</b>${summary}`, { buttons: catalogButtons() });
  }
  if (data === 'buy_cart_clear') {
    if (st) st.items = [];
    return sendText(chatId, '🗑️ Carrito vaciado. Puedes elegir productos de nuevo.', { buttons: [ [{ text: '🛍️ Ver productos', data: 'buy_cart_more' }] ] });
  }
  if (data === 'buy_cart_done') {
    if (!st || !st.items.length) return sendText(chatId, 'Tu carrito está vacío. Agrega productos primero.', { buttons: [ [{ text: '🛍️ Ver productos', data: 'buy_cart_more' }] ] });
    st.step = 'pickup';
    return sendText(chatId, `✅ <b>Confirmar pedido</b>\n\n${st.items.map(cartLine).join('\n')}\n\n<b>Total: ${fmt(cartTotal(st.items))}</b>\n\n¿Nombre de quien retira el pedido?`, { buttons: [ [{ text: '↩️ Volver al carrito', data: 'buy_cart_show' }, { text: '❌ Cancelar', data: 'buy_cancel' }] ] });
  }
  if (data === 'buy_cart_show') {
    if (!st) return sendText(chatId, 'No hay un pedido en curso.', { buttons: [ [{ text: '🛍️ Ver productos', data: 'buy_cart_more' }] ] });
    return showCart(chatId, st, bot);
  }
}

// ---------- bandeja de entrada ----------
function resolveSenderPhone(chatId) {
  const cm = db.prepare("SELECT * FROM chat_members WHERE chat_id = ?").get(chatId);
  return cm ? (cm.phone || '') : '';
}

function resolveSenderName(chatId, from) {
  const cm = db.prepare("SELECT * FROM chat_members WHERE chat_id = ?").get(chatId);
  if (cm && cm.display_name) return cm.display_name;
  return from.first_name || from.username || `chat ${chatId}`;
}

function storeInbox(d) {
  db.prepare(`
    INSERT INTO bot_inbox (chat_id, kind, direction, sender_name, sender_phone, type, text, file_id, from_root, read_flag)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    d.chat_id, d.kind || 'message', d.direction || 'in',
    d.sender_name || '', d.sender_phone || '',
    d.type || 'text', d.text || '', d.file_id || '',
    d.from_root || 0, d.read_flag || 0
  );
}

// Envía una respuesta del negocio al chat del cliente y la guarda en la bandeja.
async function sendReply(chatId, text, opts = {}) {
  const ok = await sendText(chatId, text, { noMenu: true, ...opts });
  if (ok) {
    try {
      storeInbox({
        chat_id: chatId, kind: 'message', direction: 'out', type: 'text',
        text: String(text || ''), from_root: 1, read_flag: 1
      });
    } catch (e) { /* el envío prevalece aunque falle el registro */ }
  }
  return ok;
}

// Cuenta los mensajes recibidos sin leer (para el indicador de la barra superior).
// Incluye mensajes de clientes, comunicados del Root y órdenes pagadas a distancia.
function countUnreadInbox() {
  const c = db.prepare("SELECT COUNT(*) c FROM bot_inbox WHERE direction = 'in' AND read_flag = 0").get().c;
  return c;
}

// Convierte una fila de bot_inbox en el ítem que verá la bandeja (agrupando las categorías).
function inboxItem(chatId, opts = {}) {
  const group = db.prepare(`
    SELECT chat_id, MAX(id) AS last_id,
      SUM(CASE WHEN direction='in' AND read_flag=0 THEN 1 ELSE 0 END) AS unread
    FROM bot_inbox WHERE chat_id = ? ORDER BY last_id DESC
  `).get(chatId);
  const last = group ? db.prepare('SELECT * FROM bot_inbox WHERE id = ?').get(group.last_id) : null;
  const cm = !isVirtual(chatId) ? db.prepare('SELECT * FROM chat_members WHERE chat_id = ?').get(chatId) : null;
  return {
    chat_id: chatId,
    name: opts.name || (cm && cm.display_name) || (last ? last.sender_name : 'Cliente'),
    phone: (cm && cm.phone) || (last ? last.sender_phone : ''),
    role: cm ? cm.role : 'cliente',
    unread: (group && group.unread) || 0,
    kind: opts.kind || (last ? last.kind : 'message'),
    icon: opts.icon || '',
    last: last ? { text: last.text, direction: last.direction, type: last.type, created_at: last.created_at } : null
  };
}

// Bandeja del Root, dividida en categorías: clientes, comunicados y órdenes pagadas.
// Devuelve { clientes:[], comunicados:[], ordenes:[] }
function getInbox() {
  const real = db.prepare(`
    SELECT chat_id FROM bot_inbox WHERE chat_id > 0
    GROUP BY chat_id ORDER BY MAX(id) DESC
  `).all();
  const comunicado = db.prepare("SELECT COUNT(*) c FROM bot_inbox WHERE chat_id = ?").get(COMUNICADOS_CHAT).c;
  const orden = db.prepare("SELECT COUNT(*) c FROM bot_inbox WHERE chat_id = ?").get(ORDENES_CHAT).c;
  return {
    clientes: real.map(r => inboxItem(r.chat_id)).filter(x => x.last),
    comunicados: comunicado > 0
      ? [inboxItem(COMUNICADOS_CHAT, { name: 'Comunicados del Root', kind: 'comunicado', icon: '📢' })]
      : [],
    ordenes: orden > 0
      ? [inboxItem(ORDENES_CHAT, { name: 'Órdenes pagadas a distancia', kind: 'orden', icon: '🛍️' })]
      : []
  };
}

// Mensajes de una conversación concreta (cliente <-> negocio, o categoría virtual).
function getInboxThread(chatId) {
  return db.prepare(`SELECT * FROM bot_inbox WHERE chat_id = ? ORDER BY id ASC`).all(chatId);
}

// ---------- bucle de polling (por bot) ----------
async function processUpdate(u, bot) {
  // Botones inline: ejecuta la acción y EDITA el mensaje del botón para no duplicar
  if (u.callback_query) {
    const cq = u.callback_query;
    const cid = cq.message?.chat?.id;
    if (!cid || !cq.data || cq.data.startsWith('_')) return;
    const from = cq.from || {};
    try {
      await tg('answerCallbackQuery', bot.token, { callback_query_id: cq.id });
      if (cq.data === 'menu:show') { editCtx = { chatId: cid, messageId: cq.message.message_id }; await showMenu(cid, bot); return; }
      if (String(cq.data).startsWith('buy_cart_')) { editCtx = { chatId: cid, messageId: cq.message.message_id }; await cartCallback(cid, cq.data, from, bot); return; }
      if (String(cq.data).startsWith('buy:')) { editCtx = { chatId: cid, messageId: cq.message.message_id }; await startBuyFlow(cid, String(cq.data).slice(4), from, bot); return; }
      if (cq.data === 'buy_cancel') { buyFlow.delete(cid); editCtx = { chatId: cid, messageId: cq.message.message_id }; await sendText(cid, '🚫 Compra cancelada.', { noMenu: true }); return; }
      editCtx = { chatId: cid, messageId: cq.message.message_id };
      await handleCommand(String(cq.data).trim(), cid, from, bot);
    } catch (e) { lastErr(bot, e.message); }
    finally { editCtx = null; }
    return;
  }

  const msg = u.message || u.channel_post || u.edited_message;
  if (!msg || !msg.chat) return;
  const chatId = msg.chat.id;
  const from = msg.from || {};
  const text = String(msg.text || '').trim();

  // ---- almacenar mensajes entrantes (texto / foto / video / documento) ----
  try {
    const type = msg.photo ? 'photo' : msg.video ? 'video' : msg.document ? 'document' : 'text';
    let fileId = '';
    if (msg.photo && msg.photo.length) fileId = msg.photo[msg.photo.length - 1].file_id;
    else if (msg.video) fileId = msg.video.file_id;
    else if (msg.document) fileId = msg.document.file_id;
    if (type !== 'text' || text) {
      storeInbox({
        chat_id: chatId, kind: 'message', direction: 'in',
        sender_name: resolveSenderName(chatId, from),
        sender_phone: resolveSenderPhone(chatId),
        type, text: text || String(msg.caption || '').trim(), file_id: fileId, from_root: 0, read_flag: 0
      });
    }
  } catch (e) { lastErr(bot, 'inbox: ' + e.message); }

  if (!text) return;
  if (buyFlow.has(chatId) && !text.startsWith('/')) {
    try { await stepBuyFlow(chatId, text, from, bot); } catch (e) { lastErr(bot, e.message); }
    return;
  }
  // Texto libre de un cliente (bot de cliente): se guardó arriba en la bandeja;
  // se confirma la consulta sin interpretarla como comando.
  if (!text.startsWith('/') && text.toLowerCase() !== 'hola') {
    const cbot = (bot && (bot.kind === 'cliente' || bot.kind === 'negocio'));
    if (cbot && !linkedUser(chatId)) {
      return sendText(chatId, `📩 <b>Consulta recibida</b>\n\n"${text}"\n\nGracias, en breve nos pondremos en contacto contigo.`, { noMenu: true });
    }
    return;
  }
  try { await handleCommand(text, chatId, from, bot); } catch (e) { lastErr(bot, e.message); }
}

function lastErr(bot, msg) { const st = pollTimers.get(bot.token); if (st) st.lastError = msg; }

async function pollLoop(bot, st) {
  while (st.running) {
    try {
      if (!bot.active) { st.status = 'BOT INACTIVO'; break; }
      const res = await tg('getUpdates', bot.token, { timeout: 30, offset: st.offset, allowed_updates: ['message', 'edited_message', 'channel_post', 'callback_query'] });
      st.status = 'BOT CONECTADO';
      st.lastPing = Date.now();
      if (res && Array.isArray(res)) {
        for (const u of res) {
          await processUpdate(u, bot);
          st.offset = u.update_id + 1;
          if (!st.running) break;
        }
      }
    } catch (e) {
      st.lastError = e.message;
      st.status = 'BOT CON ERROR (revisa el token y la conexión)';
    }
    await sleep(1500);
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function startLoop(b) {
  if (pollTimers.has(b.token)) return; // ya corriendo ese bot
  const st = { running: true, offset: 0, status: 'BOT CONECTANDO...', lastPing: null, lastError: '', username: b.username || '' };
  pollTimers.set(b.token, st);
  st.running = true;
  pollLoop(b, st);
  return st;
}

function stopLoop(token) {
  const st = pollTimers.get(token);
  if (st) { st.running = false; pollTimers.delete(token); }
}

// ---------- arranque / parada ----------
function startBot() {
  const modules = getSetting('modules') || {};
  if (!modules.telegram) { return; }
  const rows = activeBots();
  if (!rows.length) return;
  running = true;
  for (const b of rows) startLoop(b);
  if (!schedTimer) schedTimer = setInterval(checkDaily, 60 * 1000);
  if (!lowStockTimer) lowStockTimer = setInterval(scanLowStock, 30 * 60 * 1000);
}

function stopBot() {
  running = false;
  for (const [token] of pollTimers) stopLoop(token);
  if (schedTimer) { clearInterval(schedTimer); schedTimer = null; }
  if (lowStockTimer) { clearInterval(lowStockTimer); lowStockTimer = null; }
}

function refreshBots() {
  // reinicia todos los bucles según el estado actual de la tabla
  const rows = activeBots();
  for (const [token, st] of pollTimers) {
    if (!rows.some(b => b.token === token && b.active)) stopLoop(token);
  }
  for (const b of rows) {
    const st = startLoop(b);
    if (b.username) { /* reservado */ }
  }
}

function getStatus() {
  const cfg = keys();
  const bots = db.prepare('SELECT * FROM telegram_bots ORDER BY id').all().map(b => {
    const st = pollTimers.get(b.token);
    return {
      id: b.id, name: b.name, kind: b.kind, token: b.token, username: b.username || '',
      active: !!b.active,
      running: !!st && st.running,
      status: st ? st.status : (b.active ? 'DETENIDO' : 'INACTIVO'),
      lastPing: st ? st.lastPing : null,
      lastError: st ? st.lastError : ''
    };
  });
  return {
    enabled: !!(getSetting('modules') || {}).telegram,
    keys: { ownerKey: cfg.ownerKey, sellerKey: cfg.sellerKey, reportHour: cfg.reportHour, notifyLowStock: cfg.notifyLowStock },
    running,
    statusMsg: bots.some(b => b.running) ? 'BOTS CONECTADOS' : (bots.length ? 'BOTS DETENIDOS' : 'SIN BOTS'),
    bots,
    owners: owners(), sellers: sellers(),
    clientChats: db.prepare("SELECT COUNT(*) c FROM chat_members WHERE role='cliente' AND active=1").get().c,
    pendingRefunds: db.prepare("SELECT COUNT(*) c FROM refunds WHERE status='PENDIENTE'").get().c,
    pendingOrders: db.prepare("SELECT COUNT(*) c FROM remote_orders WHERE status IN ('PENDIENTE','ACEPTADO_CLIENTE')").get().c
  };
}

module.exports = {
  startBot, stopBot, refreshBots, getStatus,
  sendText, notifyOwners, notifySellers,
  verifyToken, sendPromotion,
  queueLowStock, scanLowStock, requestRefundNotify, resolveRefund,
  productByRef, remoteMethods, nextCode, r2, fmt,
  storeInbox, sendReply, countUnreadInbox, getInbox, getInboxThread
};
const bcrypt = require('bcryptjs');
const { db } = require('./db');
const { ROLE_DEFAULTS } = require('./bot-commands');

const ALL_PERMISSIONS = [
  'dashboard.view',
  'products.view', 'products.create', 'products.edit', 'products.delete',
  'categories.manage',
  'stock.manage',
  'sales.do', 'sales.view_all', 'refund.do', 'refunds.approve',
  'customers.manage',
  'suppliers.manage', 'purchases.do',
  'cash.open', 'cash.close', 'cash.movements',
  'users.manage', 'roles.manage',
  'settings.manage',
  'telegram.manage',
  'reports.view', 'reports.export',
  'quotes.manage',
  'expenses.manage',
  'costs.view',
  'audit.view',
  'branches.manage',
  'print.ticket',
  'marketing.promos'
];

const ROLE_TEMPLATES = {
  root: { name: 'Root', permissions: ALL_PERMISSIONS, system: 1 },
  administrador: {
    name: 'Administrador',
    system: 1,
    permissions: ALL_PERMISSIONS.filter(p => p !== 'users.manage' && p !== 'roles.manage' && p !== 'settings.manage' && p !== 'telegram.manage')
  },
  gerente: {
    name: 'Gerente',
    system: 1,
    permissions: [
      'dashboard.view', 'products.view', 'products.create', 'products.edit',
      'sales.do', 'sales.view_all', 'refund.do', 'refunds.approve', 'customers.manage',
      'cash.open', 'cash.close', 'cash.movements',
      'reports.view', 'reports.export', 'costs.view', 'audit.view', 'stock.manage',
      'quotes.manage', 'expenses.manage', 'branches.manage', 'print.ticket'
    ]
  },
  vendedor: {
    name: 'Vendedor/Cajero',
    system: 1,
    permissions: [
      'dashboard.view', 'products.view', 'sales.do', 'refund.do', 'customers.manage',
      'cash.open', 'cash.close', 'cash.movements', 'print.ticket'
    ]
  },
  inventario: {
    name: 'Inventario/Almacén',
    system: 1,
    permissions: [
      'dashboard.view', 'products.view', 'products.create', 'products.edit',
      'categories.manage', 'stock.manage', 'suppliers.manage', 'purchases.do'
    ]
  }
};

function getSetting(key, def = null) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  if (!row) return def;
  return JSON.parse(row.value);
}

function setSetting(key, value) {
  db.prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, JSON.stringify(value));
}

function seed() {
  const count = db.prepare('SELECT COUNT(*) AS c FROM roles').get();
  if (!count || count.c === 0) {
    const ins = db.prepare('INSERT INTO roles (name, system, permissions) VALUES (?, ?, ?)');
    for (const r of Object.values(ROLE_TEMPLATES)) {
      ins.run(r.name, r.system, JSON.stringify(r.permissions));
    }
  }

  const roleRoot = db.prepare('SELECT id FROM roles WHERE name = ?').get('Root');
  const userCount = db.prepare('SELECT COUNT(*) AS c FROM users').get();
  if (!userCount || userCount.c === 0) {
    const hash = bcrypt.hashSync('root123', 10);
    db.prepare(`
      INSERT INTO users (username, password_hash, full_name, role_id)
      VALUES ('root', ?, 'Administrador del sistema', ?)
    `).run(hash, roleRoot.id);
    console.log('[seed] Usuario ROOT creado. Usuario: root / Contraseña: root123 (cámbiala).');
  }

  // Permisos de bot por rol (si el rol no tiene config, se asigna la por defecto)
  const allRoles = db.prepare('SELECT * FROM roles').all();
  for (const r of allRoles) {
    const ex = db.prepare('SELECT id FROM bot_permissions WHERE role_id = ?').get(r.id);
    if (!ex) {
      const def = ROLE_DEFAULTS[r.name] || [];
      db.prepare('INSERT INTO bot_permissions (role_id, commands) VALUES (?, ?)').run(r.id, JSON.stringify(def));
    }
  }

  if (!getSetting('app')) {
    setSetting('app', {
      businessName: 'Mi Negocio',
      businessTagline: 'Sistema de ventas',
      rubro: 'general',
      language: 'es',
      currency: 'USD',
      currencySymbol: '$',
      defaultTax: 0,
      posTitle: 'PUNTO DE VENTA'
    });
  }

  if (!getSetting('modules')) {
    setSetting('modules', {
      restaurant: false,
      multimoneda: false,
      telegram: false,
      devoluciones: true,
      puntos: false,
      presupuestos: true,
      multisucursal: true,
      impresion: false
    });
  } else if (getSetting('modules').modules) {
    const m = { ...getSetting('modules') };
    delete m.modules;
    setSetting('modules', m);
  } else {
    // migración: claves nuevas en instalaciones existentes
    const m = { ...getSetting('modules') };
    if (m.multisucursal === undefined) m.multisucursal = true;
    if (m.impresion === undefined) m.impresion = false;
    setSetting('modules', m);
  }

  if (!getSetting('telegram')) {
    setSetting('telegram', {
      botToken: '',
      ownerKey: 'OWNER2025',
      sellerKey: 'VENDEDOR2025',
      reportHour: 19,
      notifyLowStock: true
    });
  }

  // Fase 5: migrar el bot único de la configuración antigua a la tabla de bots
  const botCount = db.prepare('SELECT COUNT(*) AS c FROM telegram_bots').get().c;
  if (botCount === 0) {
    const legacy = ((getSetting('telegram') || {}).botToken || '').trim();
    if (legacy) {
      db.prepare('INSERT INTO telegram_bots (name, kind, token, active) VALUES (?, ?, ?, 1)')
        .run('Bot principal', 'negocio', legacy);
      console.log('[seed] Bot único migrado a la tabla de bots (tipo negocio).');
    }
  }

  if (!getSetting('finance')) {
    setSetting('finance', {
      extraCurrencies: JSON.stringify([]),
      expensesCategories: 'General,Alquiler,Servicios,Salarios,Impuestos,Publicidad,Oficina,Otros'
    });
  }

  if (!getSetting('thermal')) {
    setSetting('thermal', { enabled: false, host: '127.0.0.1', port: 9100, width: 58 });
  }

  const branchCount = db.prepare('SELECT COUNT(*) AS c FROM branches').get();
  if (!branchCount || branchCount.c === 0) {
    db.prepare('INSERT INTO branches (name, address, active) VALUES (?, ?, 1)').run('Sucursal principal', '');
    console.log('[seed] Sucursal principal creada.');
  }

  const prodCount = db.prepare('SELECT COUNT(*) AS c FROM products').get();
  if (!prodCount || prodCount.c === 0) {
    const insCat = db.prepare('INSERT INTO categories (name) VALUES (?)');
    insCat.run('Abarrotes');
    insCat.run('Bebidas');
    const catA = db.prepare("SELECT id FROM categories WHERE name = 'Abarrotes'").get().id;
    const catB = db.prepare("SELECT id FROM categories WHERE name = 'Bebidas'").get().id;
    const insProd = db.prepare(`
      INSERT INTO products (code, barcode, name, category_id, unit, cost, price_minor, price_major, tax_rate, stock, stock_min, stock_max)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    insProd.run('P001', '7500012345601', 'Arroz 5kg', catA, 'Saco', 22, 28, 25, 3, 100, 10, 500);
    insProd.run('P002', '7500012345618', 'Aceite 1L', catA, 'Botella', 8, 12, 10, 3, 60, 5, 200);
    insProd.run('P003', '7500012345625', 'Gaseosa 1.5L', catB, 'Botella', 3.5, 5, 4.5, 0, 120, 20, 300);
    insProd.run('P004', '7500012345632', 'Azúcar 1kg', catA, 'Paquete', 4, 6, 5, 3, 80, 10, 250);
    insProd.run('P005', '7500012345649', 'Leche 1L', catB, 'Caja', 3, 4.5, 4, 0, 15, 12, 150);
    console.log('[seed] Productos de ejemplo creados (puedes eliminarlos).');
  }

  const pmCount = db.prepare('SELECT COUNT(*) AS c FROM payment_methods').get();
  if (!pmCount || pmCount.c === 0) {
    const ins = db.prepare(`
      INSERT INTO payment_methods (name, code, active, is_remote, icon)
      VALUES (?, ?, ?, ?, ?)
    `);
    ins.run('Efectivo', 'efectivo', 1, 0, '💰');
    ins.run('Tarjeta', 'tarjeta', 1, 0, '💳');
    ins.run('Transferencia', 'transferencia', 1, 1, '🏦');
    ins.run('Billetera / QR', 'qr', 1, 1, '📱');
    ins.run('Crédito (cuenta)', 'credito', 1, 0, '📒');
  }

  // Migración de permisos en instalaciones existentes
  const withPerms = (roleName, perms) => {
    const role = db.prepare('SELECT * FROM roles WHERE name = ?').get(roleName);
    if (!role) return;
    const cur = JSON.parse(role.permissions || '[]');
    const merged = [...new Set([...cur, ...perms])];
    db.prepare('UPDATE roles SET permissions = ? WHERE id = ?').run(JSON.stringify(merged), role.id);
  };
  withPerms('Root', ['refund.do', 'refunds.approve', 'quotes.manage', 'expenses.manage', 'branches.manage', 'print.ticket', 'marketing.promos']);
  withPerms('Administrador', ['refund.do', 'refunds.approve', 'quotes.manage', 'expenses.manage', 'branches.manage', 'print.ticket']);
  withPerms('Gerente', ['refund.do', 'refunds.approve', 'quotes.manage', 'expenses.manage', 'branches.manage', 'print.ticket']);
  withPerms('Vendedor/Cajero', ['refund.do', 'print.ticket']);
  // roles a medida que venden también pueden imprimir tickets
  const roles = db.prepare('SELECT * FROM roles').all();
  for (const r of roles) {
    const cur = JSON.parse(r.permissions || '[]');
    if (cur.includes('sales.do') && !cur.includes('print.ticket')) {
      db.prepare('UPDATE roles SET permissions = ? WHERE id = ?').run(JSON.stringify([...cur, 'print.ticket']), r.id);
    }
  }
}

module.exports = { seed, getSetting, setSetting, ALL_PERMISSIONS, ROLE_TEMPLATES };
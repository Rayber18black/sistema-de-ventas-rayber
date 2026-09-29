const path = require('path');
const fs = require('fs');
const os = require('os');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = process.env.POSV_DATA ||
  (process.env.APPDATA ? path.join(process.env.APPDATA, 'POSVentas') : path.join(__dirname, '..', 'data'));
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'posv.db');
const db = new DatabaseSync(DB_PATH);

db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS roles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  system INTEGER NOT NULL DEFAULT 0,
  permissions TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  full_name TEXT NOT NULL DEFAULT '',
  role_id INTEGER,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (role_id) REFERENCES roles(id)
);

CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  parent_id INTEGER,
  active INTEGER NOT NULL DEFAULT 1,
  FOREIGN KEY (parent_id) REFERENCES categories(id)
);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  barcode TEXT,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  category_id INTEGER,
  unit TEXT NOT NULL DEFAULT 'Unidad',
  cost REAL NOT NULL DEFAULT 0,
  price_minor REAL NOT NULL DEFAULT 0,
  price_major REAL NOT NULL DEFAULT 0,
  price_special REAL NOT NULL DEFAULT 0,
  tax_rate REAL NOT NULL DEFAULT 0,
  stock REAL NOT NULL DEFAULT 0,
  stock_min REAL NOT NULL DEFAULT 0,
  stock_max REAL NOT NULL DEFAULT 0,
  image TEXT,
  attributes TEXT NOT NULL DEFAULT '[]',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (category_id) REFERENCES categories(id)
);

CREATE TABLE IF NOT EXISTS lots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL,
  lot TEXT,
  expiry_date TEXT,
  qty REAL NOT NULL DEFAULT 0,
  FOREIGN KEY (product_id) REFERENCES products(id)
);

CREATE TABLE IF NOT EXISTS stock_movements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL,
  type TEXT NOT NULL,
  qty REAL NOT NULL,
  ref_id INTEGER,
  note TEXT DEFAULT '',
  user_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (product_id) REFERENCES products(id)
);

CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT DEFAULT '',
  email TEXT DEFAULT '',
  address TEXT DEFAULT '',
  credit_limit REAL NOT NULL DEFAULT 0,
  balance REAL NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS suppliers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  contact TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  email TEXT DEFAULT '',
  address TEXT DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS sales (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  folio TEXT NOT NULL UNIQUE,
  customer_id INTEGER,
  user_id INTEGER,
  sub_total REAL NOT NULL DEFAULT 0,
  tax_total REAL NOT NULL DEFAULT 0,
  discount REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'COMPLETADA',
  note TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (customer_id) REFERENCES customers(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS sale_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id INTEGER NOT NULL,
  product_id INTEGER,
  product_name TEXT NOT NULL,
  qty REAL NOT NULL,
  price REAL NOT NULL,
  tax_rate REAL NOT NULL DEFAULT 0,
  tax_total REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL,
  cost REAL NOT NULL DEFAULT 0,
  FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS sale_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id INTEGER NOT NULL,
  method TEXT NOT NULL,
  amount REAL NOT NULL,
  FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS cash_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  opened_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  closed_at TEXT,
  opening_amount REAL NOT NULL DEFAULT 0,
  expected_amount REAL NOT NULL DEFAULT 0,
  actual_amount REAL,
  status TEXT NOT NULL DEFAULT 'ABIERTA',
  note TEXT DEFAULT '',
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS cash_movements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  type TEXT NOT NULL,
  amount REAL NOT NULL,
  reason TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (session_id) REFERENCES cash_sessions(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS audits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  username TEXT DEFAULT '',
  action TEXT NOT NULL,
  detail TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS licenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  serial TEXT NOT NULL UNIQUE,
  machine_id TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'PENDIENTE',
  activated_at TEXT
);

CREATE TABLE IF NOT EXISTS payment_methods (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  code TEXT NOT NULL UNIQUE,
  active INTEGER NOT NULL DEFAULT 1,
  is_remote INTEGER NOT NULL DEFAULT 0,
  icon TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS chat_members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id INTEGER NOT NULL UNIQUE,
  role TEXT NOT NULL DEFAULT 'cliente',
  display_name TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS refunds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  sale_id INTEGER,
  product_id INTEGER,
  product_name TEXT NOT NULL,
  qty REAL NOT NULL,
  unit_price REAL NOT NULL DEFAULT 0,
  amount REAL NOT NULL DEFAULT 0,
  reason TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'PENDIENTE',
  seller_id INTEGER,
  stock_restored INTEGER NOT NULL DEFAULT 0,
  note TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  resolved_at TEXT,
  FOREIGN KEY (sale_id) REFERENCES sales(id)
);

CREATE TABLE IF NOT EXISTS remote_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  product_id INTEGER,
  product_name TEXT NOT NULL,
  qty REAL NOT NULL,
  price REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL DEFAULT 0,
  client_name TEXT DEFAULT '',
  client_phone TEXT DEFAULT '',
  pickup_name TEXT DEFAULT '',
  method TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'APARTADO',
  sale_id INTEGER,
  paid_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  taken_by TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS remote_order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL,
  product_id INTEGER,
  product_name TEXT NOT NULL,
  qty REAL NOT NULL,
  price REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS product_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  product_name TEXT NOT NULL,
  brand TEXT DEFAULT '',
  qty REAL NOT NULL DEFAULT 0,
  contact_name TEXT DEFAULT '',
  contact_phone TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'PENDIENTE',
  source TEXT DEFAULT 'BOT',
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  resolved_at TEXT
);

CREATE TABLE IF NOT EXISTS quotes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  customer_id INTEGER,
  user_id INTEGER,
  sub_total REAL NOT NULL DEFAULT 0,
  discount REAL NOT NULL DEFAULT 0,
  tax_total REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'ABIERTA',
  valid_days INTEGER NOT NULL DEFAULT 7,
  note TEXT DEFAULT '',
  converted_sale_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS quote_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  quote_id INTEGER NOT NULL,
  product_id INTEGER,
  product_name TEXT NOT NULL,
  qty REAL NOT NULL,
  price REAL NOT NULL,
  tax_rate REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL DEFAULT 0,
  FOREIGN KEY (quote_id) REFERENCES quotes(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS expenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL DEFAULT 'GASTO',
  amount REAL NOT NULL,
  category TEXT DEFAULT 'General',
  note TEXT DEFAULT '',
  user_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS purchase_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  supplier_id INTEGER,
  user_id INTEGER,
  status TEXT NOT NULL DEFAULT 'PENDIENTE',
  expected_date TEXT,
  note TEXT DEFAULT '',
  total REAL NOT NULL DEFAULT 0,
  received_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS purchase_order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  purchase_order_id INTEGER NOT NULL,
  product_id INTEGER NOT NULL,
  product_name TEXT NOT NULL,
  qty REAL NOT NULL,
  cost REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL DEFAULT 0,
  FOREIGN KEY (purchase_order_id) REFERENCES purchase_orders(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS branches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  address TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS customer_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL,
  amount REAL NOT NULL,
  method TEXT NOT NULL DEFAULT 'efectivo',
  note TEXT DEFAULT '',
  user_id INTEGER,
  branch_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (customer_id) REFERENCES customers(id)
);

CREATE INDEX IF NOT EXISTS idx_quotes_status ON quotes(status);
CREATE INDEX IF NOT EXISTS idx_purchase_status ON purchase_orders(status);
CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(created_at);
`);

// Migraciones ligeras
const prodCols = db.prepare('PRAGMA table_info(products)').all().map(c => c.name);
if (!prodCols.includes('low_stock_alerted')) {
  db.exec("ALTER TABLE products ADD COLUMN low_stock_alerted INTEGER NOT NULL DEFAULT 0");
}

const addCol = (table, col, ddl) => {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
  if (!cols.includes(col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${ddl}`);
};
addCol('sales', 'branch_id', 'INTEGER');
addCol('sales', 'source', "TEXT NOT NULL DEFAULT 'POS'");
addCol('cash_sessions', 'branch_id', 'INTEGER');
addCol('expenses', 'branch_id', 'INTEGER');
addCol('purchase_orders', 'branch_id', 'INTEGER');
addCol('customers', 'ci', "TEXT DEFAULT ''");
addCol('customers', 'rif', "TEXT DEFAULT ''");

// Fase 5: múltiples bots de Telegram y promociones
db.exec(`
CREATE TABLE IF NOT EXISTS telegram_bots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL DEFAULT 'Bot',
  kind TEXT NOT NULL DEFAULT 'cliente',
  token TEXT NOT NULL,
  username TEXT DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS promotions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  created_by INTEGER,
  sent_at TEXT,
  sent_count INTEGER NOT NULL DEFAULT 0,
  total_clients INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
`);

// Fase 6: supervisión de dispositivos y permisos de bot por rol
addCol('chat_members', 'user_id', "INTEGER");
addCol('chat_members', 'ip', "TEXT DEFAULT ''");
addCol('chat_members', 'mac', "TEXT DEFAULT ''");
addCol('chat_members', 'verified', "INTEGER NOT NULL DEFAULT 0");
addCol('refunds', 'requested_by', "TEXT DEFAULT ''");

// Migración: permitir refunds sin venta asociada (solicitudes desde el bot)
(function relaxRefundSaleId() {
  const t = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='refunds'").get();
  if (!t || !/sale_id\s+INTEGER\s+NOT\s+NULL/i.test(t.sql)) return;
  db.exec(`
    PRAGMA foreign_keys=OFF;
    BEGIN;
    ALTER TABLE refunds RENAME TO refunds_old;
    CREATE TABLE refunds (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      sale_id INTEGER,
      product_id INTEGER,
      product_name TEXT NOT NULL,
      qty REAL NOT NULL,
      unit_price REAL NOT NULL DEFAULT 0,
      amount REAL NOT NULL DEFAULT 0,
      reason TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'PENDIENTE',
      seller_id INTEGER,
      stock_restored INTEGER NOT NULL DEFAULT 0,
      note TEXT DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      resolved_at TEXT,
      requested_by TEXT DEFAULT ''
    );
    INSERT INTO refunds (id, code, sale_id, product_id, product_name, qty, unit_price, amount, reason, status, seller_id, stock_restored, note, created_at, resolved_at)
      SELECT id, code, sale_id, product_id, product_name, qty, unit_price, amount, reason, status, seller_id, stock_restored, note, created_at, resolved_at FROM refunds_old;
    DROP TABLE refunds_old;
    COMMIT;
    PRAGMA foreign_keys=ON;
  `);
})();
db.exec(`
CREATE TABLE IF NOT EXISTS bot_permissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  role_id INTEGER NOT NULL,
  commands TEXT NOT NULL DEFAULT '[]',
  UNIQUE (role_id)
);
`);

// Fase 7: datos de "compra a distancia" (pago móvil / cuenta) por método remoto
addCol('payment_methods', 'account_holder', "TEXT DEFAULT ''");
addCol('payment_methods', 'bank', "TEXT DEFAULT ''");
addCol('payment_methods', 'account_number', "TEXT DEFAULT ''");
addCol('payment_methods', 'phone', "TEXT DEFAULT ''");
addCol('payment_methods', 'instructions', "TEXT DEFAULT ''");

// Fase 8: buzón de mensajes de los bots (WhatsApp-style) y comunicados del Root
db.exec(`
CREATE TABLE IF NOT EXISTS bot_inbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id INTEGER NOT NULL,
  kind TEXT NOT NULL DEFAULT 'message',       -- message | comunicado
  direction TEXT NOT NULL DEFAULT 'in',        -- in (recibido) | out (respondido)
  sender_name TEXT DEFAULT '',
  sender_phone TEXT DEFAULT '',
  type TEXT NOT NULL DEFAULT 'text',           -- text | photo | video | document
  text TEXT DEFAULT '',
  file_id TEXT DEFAULT '',
  from_root INTEGER NOT NULL DEFAULT 0,
  read_flag INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
`);

// Fase 7: otorgar el permiso exclusivo telegram.manage al rol Root en BD existentes
(function grantRootTelegramManage() {
  const row = db.prepare("SELECT id FROM roles WHERE name = 'Root'").get();
  if (!row) return;
  const r = db.prepare('SELECT permissions FROM roles WHERE id = ?').get(row.id);
  let perms = [];
  try { perms = JSON.parse(r.permissions) } catch (e) {}
  if (Array.isArray(perms) && !perms.includes('telegram.manage')) {
    perms.push('telegram.manage');
    db.prepare('UPDATE roles SET permissions = ? WHERE id = ?').run(JSON.stringify(perms), row.id);
  }
})();

module.exports = { db, DB_PATH, DATA_DIR };
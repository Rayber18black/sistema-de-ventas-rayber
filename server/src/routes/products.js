const express = require('express');
const { db } = require('../db');
const { requireAuth, requirePerm } = require('../middleware/auth');
const { audit, now } = require('../utils');

const router = express.Router();
router.use(requireAuth);

function productFields(u) {
  let img = u.image;
  if (img && img.length > 400000) img = img.slice(0, 400000);
  const cost = Number(u.cost) || 0;
  const margin = price => (Number(price) > 0 ? Math.round(((Number(price) - cost) / Number(price)) * 1000) / 10 : 0);
  return {
    id: u.id, code: u.code, barcode: u.barcode, name: u.name, description: u.description,
    category_id: u.category_id, category_name: u.category_name, unit: u.unit,
    cost: u.cost, price_minor: u.price_minor, price_major: u.price_major, price_special: u.price_special,
    margin_minor: margin(u.price_minor), margin_major: margin(u.price_major), margin_special: margin(u.price_special),
    pot_profit: ((Number(u.price_minor) || 0) - cost) * (Number(u.stock) || 0),
    tax_rate: u.tax_rate, stock: u.stock, stock_min: u.stock_min, stock_max: u.stock_max,
    image: img, attributes: JSON.parse(u.attributes || '[]'), active: u.active,
    created_at: u.created_at, updated_at: u.updated_at
  };
}

// ---------- PRODUCTOS ----------
router.get('/products', requirePerm('products.view'), (req, res) => {
  const { search, category_id, low, activeOnly } = req.query;
  const where = [];
  const params = [];
  if (search) {
    where.push('(p.name LIKE ? OR p.code LIKE ? OR p.barcode LIKE ?)');
    const s = `%${search}%`;
    params.push(s, s, s);
  }
  if (category_id) { where.push('p.category_id = ?'); params.push(Number(category_id)); }
  if (low === '1') { where.push('p.stock <= p.stock_min'); }
  if (activeOnly !== '0') { where.push('p.active = 1'); }
  const q = `
    SELECT p.*, c.name AS category_name
    FROM products p LEFT JOIN categories c ON c.id = p.category_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY p.name LIMIT 500
  `;
  res.json(db.prepare(q).all(...params).map(productFields));
});

// ---------- EXPORTAR PRODUCTOS --------
router.get('/products/export', requirePerm('products.view'), (req, res) => {
  const rows = db.prepare(`
    SELECT p.code, p.barcode, p.name, COALESCE(c.name,'') AS category, p.unit, p.cost,
           p.price_minor, p.price_major, p.price_special, p.tax_rate, p.stock, p.stock_min, p.stock_max, p.active
    FROM products p LEFT JOIN categories c ON c.id = p.category_id ORDER BY p.name
  `).all();
  const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const head = ['code','barcode','name','category','unit','cost','price_minor','price_major','price_special','tax_rate','stock','stock_min','stock_max','active'];
  const csv = [head.join(','), ...rows.map(r => head.map(k => esc(r[k])).join(','))].join('\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="productos.csv"');
  res.send('\uFEFF' + csv);
});

router.get('/products/:id', requirePerm('products.view'), (req, res) => {
  const p = db.prepare(`
    SELECT p.*, c.name AS category_name FROM products p
    LEFT JOIN categories c ON c.id = p.category_id WHERE p.id = ?
  `).get(Number(req.params.id));
  if (!p) return res.status(404).json({ error: 'Producto no encontrado' });
  const lots = db.prepare('SELECT * FROM lots WHERE product_id = ? ORDER BY expiry_date').all(p.id);
  res.json({ ...productFields(p), lots });
});

router.post('/products', requirePerm('products.create'), (req, res) => {
  const b = req.body || {};
  const { code, barcode, name, description, category_id, unit, cost, price_minor, price_major, price_special, tax_rate, stock_min, stock_max, image, attributes, active } = b;
  if (!code || !name) return res.status(400).json({ error: 'Código y nombre son requeridos' });
  const exists = db.prepare('SELECT id FROM products WHERE code = ?').get(String(code).trim());
  if (exists) return res.status(400).json({ error: 'Ya existe un producto con ese código' });

  const info = db.prepare(`
    INSERT INTO products (code, barcode, name, description, category_id, unit, cost, price_minor, price_major, price_special, tax_rate, stock_min, stock_max, image, attributes, active)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    String(code).trim(), barcode || null, String(name).trim(), description || '',
    category_id || null, unit || 'Unidad', Number(cost) || 0, Number(price_minor) || 0,
    Number(price_major) || 0, Number(price_special) || 0, Number(tax_rate) || 0,
    Number(stock_min) || 0, Number(stock_max) || 0, image || null,
    JSON.stringify(attributes || []), active === false ? 0 : 1
  );
  audit(req.user, 'CREAR_PRODUCTO', name);
  res.json({ id: info.lastInsertRowid });
});

router.put('/products/:id', requirePerm('products.edit'), (req, res) => {
  const id = Number(req.params.id);
  const p = db.prepare('SELECT * FROM products WHERE id = ?').get(id);
  if (!p) return res.status(404).json({ error: 'Producto no encontrado' });
  const b = req.body || {};
  const codeExists = db.prepare('SELECT id FROM products WHERE code = ? AND id != ?').get(String(b.code).trim(), id);
  if (codeExists) return res.status(400).json({ error: 'Ya existe un producto con ese código' });

  db.prepare(`
    UPDATE products SET code=?, barcode=?, name=?, description=?, category_id=?, unit=?, cost=?, price_minor=?, price_major=?, price_special=?, tax_rate=?, stock_min=?, stock_max=?, image=?, attributes=?, active=?, updated_at=?
    WHERE id=?
  `).run(
    String(b.code).trim(), b.barcode ?? null, String(b.name).trim(), b.description ?? '',
    b.category_id ?? null, b.unit || 'Unidad', Number(b.cost) || 0, Number(b.price_minor) || 0,
    Number(b.price_major) || 0, Number(b.price_special) || 0, Number(b.tax_rate) || 0,
    Number(b.stock_min) || 0, Number(b.stock_max) || 0, b.image ?? p.image,
    JSON.stringify(b.attributes || []), b.active === false ? 0 : 1, now(), id
  );
  audit(req.user, 'EDITAR_PRODUCTO', b.name);
  res.json({ ok: true });
});

router.delete('/products/:id', requirePerm('products.delete'), (req, res) => {
  const id = Number(req.params.id);
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare('DELETE FROM lots WHERE product_id = ?').run(id);
    db.prepare('DELETE FROM stock_movements WHERE product_id = ?').run(id);
    db.prepare('DELETE FROM products WHERE id = ?').run(id);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    return res.status(400).json({ error: `No se pudo eliminar el producto: ${e.message || e}` });
  }
  audit(req.user, 'ELIMINAR_PRODUCTO', String(id));
  res.json({ ok: true });
});

// ---------- STOCK (entradas/salidas/ajustes) ----------
router.post('/products/:id/stock', requirePerm('stock.manage'), (req, res) => {
  const id = Number(req.params.id);
  const p = db.prepare('SELECT * FROM products WHERE id = ?').get(id);
  if (!p) return res.status(404).json({ error: 'Producto no encontrado' });
  const { qty, type, note } = req.body || {};
  const delta = Number(qty);
  if (!delta) return res.status(400).json({ error: 'Cantidad inválida' });
  const finalStock = p.stock + delta;
  if (finalStock < 0) return res.status(400).json({ error: 'Stock insuficiente' });

  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare('UPDATE products SET stock = ?, updated_at = ? WHERE id = ?').run(finalStock, now(), id);
    db.prepare(`
      INSERT INTO stock_movements (product_id, type, qty, user_id, note)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, type || (delta >= 0 ? 'IN' : 'ADJ'), delta, req.user.id, note || '');
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  audit(req.user, 'AJUSTE_STOCK', `${p.code} ${delta > 0 ? '+' : ''}${delta}`);
  res.json({ ok: true, stock: finalStock });
});

router.get('/products/:id/movements', requirePerm('stock.manage'), (req, res) => {
  const id = Number(req.params.id);
  const rows = db.prepare(`
    SELECT m.*, u.username FROM stock_movements m
    LEFT JOIN users u ON u.id = m.user_id
    WHERE m.product_id = ? ORDER BY m.id DESC LIMIT 200
  `).all(id);
  res.json(rows);
});

// ---------- CATEGORÍAS ----------
router.get('/categories', (req, res) => {
  res.json(db.prepare('SELECT * FROM categories ORDER BY name').all());
});

router.post('/categories', requirePerm('categories.manage'), (req, res) => {
  const { name, parent_id } = req.body || {};
  if (!name) return res.status(400).json({ error: 'Nombre requerido' });
  const info = db.prepare('INSERT INTO categories (name, parent_id) VALUES (?, ?)').run(String(name).trim(), parent_id || null);
  res.json({ id: info.lastInsertRowid, name, parent_id: parent_id || null });
});

router.put('/categories/:id', requirePerm('categories.manage'), (req, res) => {
  const { name, parent_id } = req.body || {};
  db.prepare('UPDATE categories SET name = ?, parent_id = ? WHERE id = ?').run(name, parent_id || null, Number(req.params.id));
  res.json({ ok: true });
});

router.delete('/categories/:id', requirePerm('categories.manage'), (req, res) => {
  db.prepare('DELETE FROM categories WHERE id = ?').run(Number(req.params.id));
  db.prepare('UPDATE products SET category_id = NULL WHERE category_id = ?').run(Number(req.params.id));
  res.json({ ok: true });
});

// ---------- IMPORTAR / EXPORTAR PRODUCTOS ----------
router.post('/products/import', requirePerm('products.create'), (req, res) => {
  const rows = Array.isArray((req.body || {}).rows) ? req.body.rows : [];
  if (!rows.length) return res.status(400).json({ error: 'No hay filas para importar' });
  let created = 0, updated = 0, skipped = 0;
  const upsertCat = (name) => {
    if (!name) return null;
    const cat = db.prepare('SELECT id FROM categories WHERE name = ?').get(String(name).trim());
    if (cat) return cat.id;
    const info = db.prepare('INSERT INTO categories (name) VALUES (?)').run(String(name).trim());
    return info.lastInsertRowid;
  };
  for (const r of rows) {
    const code = String(r.code || '').trim();
    const name = String(r.name || '').trim();
    if (!code || !name) { skipped++; continue; }
    const catId = upsertCat(r.category);
    const existing = db.prepare('SELECT id FROM products WHERE code = ?').get(code);
    const num = v => (v == null || v === '') ? 0 : Number(v);
    const vals = {
      barcode: r.barcode || null, name,
      category_id: catId, unit: r.unit || 'Unidad',
      cost: num(r.cost), price_minor: num(r.price_minor),
      price_major: num(r.price_major), price_special: num(r.price_special),
      tax_rate: num(r.tax_rate), stock: num(r.stock),
      stock_min: num(r.stock_min), stock_max: num(r.stock_max),
      active: 1, description: r.description || ''
    };
    if (existing) {
      const old = db.prepare('SELECT * FROM products WHERE id = ?').get(existing.id);
      const delta = vals.stock - old.stock;
      db.prepare(`
        UPDATE products SET barcode=?, name=?, category_id=?, unit=?, cost=?, price_minor=?, price_major=?, price_special=?, tax_rate=?, stock=?, stock_min=?, stock_max=?, description=?, active=1, updated_at=?
        WHERE id=?
      `).run(vals.barcode, vals.name, vals.category_id, vals.unit, vals.cost, vals.price_minor, vals.price_major, vals.price_special, vals.tax_rate, vals.stock, vals.stock_min, vals.stock_max, vals.description, now(), existing.id);
      if (delta !== 0) {
        db.prepare(`INSERT INTO stock_movements (product_id, type, qty, user_id, note) VALUES (?, 'ADJ', ?, ?, 'Importación masiva')`)
          .run(existing.id, delta, req.user.id);
      }
      updated++;
    } else {
      db.prepare(`
        INSERT INTO products (code, barcode, name, description, category_id, unit, cost, price_minor, price_major, price_special, tax_rate, stock, stock_min, stock_max, active)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
      `).run(code, vals.barcode, vals.name, vals.description, vals.category_id, vals.unit, vals.cost, vals.price_minor, vals.price_major, vals.price_special, vals.tax_rate, vals.stock, vals.stock_min, vals.stock_max);
      created++;
    }
  }
  audit(req.user, 'IMPORTAR_PRODUCTOS', `${created} nuevos, ${updated} actualizados, ${skipped} omitidos`);
  res.json({ created, updated, skipped });
});

module.exports = router;
const { db } = require('./db');
const { now } = require('./utils');

// Re-escala los precios/costos en moneda base (BS) de todos los productos
// cuando cambia la tasa (1 USD = ? BS), preservando el valor en USD:
// nuevo_BS = viejo_BS * (nueva_tasa / vieja_tasa)
function applyRateChange(oldRate, newRate) {
  oldRate = Number(oldRate);
  newRate = Number(newRate);
  if (!(oldRate > 0) || !(newRate > 0) || Math.abs(newRate - oldRate) < 1e-9) return 0;
  const f = newRate / oldRate;
  const info = db.prepare(`
    UPDATE products SET
      cost = ROUND(cost * ?, 2),
      price_minor = ROUND(price_minor * ?, 2),
      price_major = ROUND(price_major * ?, 2),
      price_special = ROUND(price_special * ?, 2),
      updated_at = ?
  `).run(f, f, f, f, now());
  return info.changes;
}

module.exports = { applyRateChange };
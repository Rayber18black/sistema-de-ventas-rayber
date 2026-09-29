const express = require('express');
const { db } = require('../db');
const { requireAuth, requirePerm } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth, requirePerm('dashboard.view'));

const M = v => Math.round((Number(v) || 0) * 100) / 100;

function rangeFilter(from, to) {
  if (from && to) return `date(created_at) >= '${from}' AND date(created_at) <= '${to}'`;
  if (from) return `date(created_at) >= '${from}'`;
  if (to) return `date(created_at) <= '${to}'`;
  return `date(created_at) = date('now','localtime')`;
}

// Califica el created_at con alias en queries con JOIN (replace global)
function aliasRange(rangeSql, alias) {
  return rangeSql.split('created_at').join(`${alias}.created_at`);
}

// Serie de ventas diarias para un rango de fechas
function dailySalesRange(from, to, cond) {
  const c = cond ? ` AND ${cond}` : '';
  return db.prepare(`
    SELECT date(created_at) AS day, COUNT(*) AS count, COALESCE(SUM(total),0) AS total,
           COALESCE(SUM(sub_total - discount),0) AS net
    FROM sales
    WHERE status='COMPLETADA'${c} AND date(created_at) >= '${from}' AND date(created_at) <= '${to}'
    GROUP BY date(created_at) ORDER BY day
  `).all();
}

// Multiplicador de agresividad del forecast realista (hora del dÃ­a)
const FORECAST_SCALE = [
  0.0, 0.0, 0.0, 0.0, 0.0, 0.02, 0.05, 0.09, 0.14, 0.19, 0.25,
  0.33, 0.42, 0.52, 0.62, 0.72, 0.8, 0.87, 0.92, 0.96, 0.985, 0.995, 1.0, 1.0
];

// Devuelve los dados mÃ­nimos del rango para la comparaciÃ³n con perÃ­odo previo
function compareRange(from, to, cond) {
  const condSql = cond ? ` AND ${cond}` : '';
  const prevLen = (Date.parse(to) - Date.parse(from)) / 86400000 + 1;
  const prevTo = new Date(Date.parse(from) - 86400000);
  const prevFrom = new Date(Date.parse(prevTo) - (prevLen - 1) * 86400000);
  const fmt = d => d.toISOString().slice(0, 10);
  const cur = db.prepare(
    `SELECT COALESCE(SUM(total),0) t, COUNT(*) c FROM sales WHERE status='COMPLETADA'${condSql} AND date(created_at) >= ? AND date(created_at) <= ?`
  ).get(from, to);
  const prev = db.prepare(
    `SELECT COALESCE(SUM(total),0) t, COUNT(*) c FROM sales WHERE status='COMPLETADA'${condSql} AND date(created_at) >= ? AND date(created_at) <= ?`
  ).get(fmt(prevFrom), fmt(prevTo));
  const curAvg = cur.c > 0 ? cur.t / cur.c : 0;
  const prevAvg = prev.c > 0 ? prev.t / prev.c : 0;
  return {
    current: { total: M(cur.t), count: cur.c, avg: M(curAvg) },
    previous: { total: M(prev.t), count: prev.c, avg: M(prevAvg) },
    delta_total_pct: prev.t > 0 ? Math.round((cur.t - prev.t) / prev.t * 100) : (cur.t > 0 ? 100 : 0)
  };
}

// Obtener la meta diaria configurada en settings (si existe)
function getMetaDiaria() {
  try {
    const r = db.prepare(`SELECT value FROM settings WHERE key='meta_diaria'`).get();
    return r ? parseFloat(r.value) || 0 : 0;
  } catch (e) { return 0; }
}

router.get('/', (req, res) => {
  const from = req.query.from || null;
  const to = req.query.to || null;
  const rangeSql = rangeFilter(from, to);
  const today = "date('now','localtime')";
  // Filtro por sucursal opcional (coincide con el selector global de la app)
  const bq = req.query.branch_id ? Number(req.query.branch_id) : null;
  const sCond = bq ? ` AND s.branch_id = ${bq}` : '';
  const bc = bq ? ` AND branch_id = ${bq}` : '';

  // ---- KPI core (respetando rango) ----
  const totalSales = db.prepare(`SELECT COALESCE(SUM(total),0) t, COUNT(*) c FROM sales WHERE status='COMPLETADA'${bc} AND ${rangeSql}`).get();
  const totalGross = db.prepare(`
    SELECT COALESCE(SUM(si.qty * (si.price - COALESCE(si.cost,0))),0) AS t, COUNT(*) AS c, SUM(si.qty) AS units
    FROM sale_items si JOIN sales s ON s.id = si.sale_id WHERE s.status='COMPLETADA'${sCond} AND ${aliasRange(rangeSql, 's')}
  `).get();
  const totalRefunds = db.prepare(`SELECT COALESCE(SUM(amount),0) t FROM refunds WHERE status IN ('APROBADA','COMPLETADA','RESUELTA') AND ${rangeSql.replace('created_at','created_at')}`).get().t;
  const totalExpenses = db.prepare(`SELECT COALESCE(SUM(amount),0) t FROM expenses WHERE ${rangeSql}`).get().t;
  const botSales = db.prepare(`SELECT COUNT(*) c, COALESCE(SUM(total),0) t FROM sales WHERE ${rangeSql}${bc} AND source='BOT'`).get();
  const remoteCount = db.prepare(`SELECT COUNT(*) c, COALESCE(SUM(total),0) t FROM remote_orders WHERE ${rangeSql.replace('created_at','created_at')} AND status NOT IN ('CANCELADO','CANCELADA')`).get();

  const avgTicket = totalSales.c > 0 ? totalSales.t / totalSales.c : 0;
  const metaDiaria = getMetaDiaria() || (totalSales.t / Math.max(FORECAST_SCALE[new Date().getHours()], 0.1));

  // forecast de cierre del dÃ­a (por hora del dÃ­a, en rango "hoy")
  let forecast = null;
  if (!from || !to) {
    const dayStart = "date('now','localtime')";
    const h = new Date().getHours();
    const scale = FORECAST_SCALE[h] || 0;
    const doneToday = db.prepare(`SELECT COALESCE(SUM(total),0) t FROM sales WHERE status='COMPLETADA'${bc} AND date(created_at)=${dayStart}`).get().t;
    forecast = { done: M(doneToday), elapsed_scale: M(scale), projected: M(scale > 0 ? doneToday / scale : 0) };
  }

  // ---- Top vendedores ----
  const bySeller = db.prepare(`
    SELECT COALESCE(u.username,'sistema') AS seller, COUNT(s.id) AS count, COALESCE(SUM(s.total),0) AS total
    FROM sales s LEFT JOIN users u ON u.id = s.user_id WHERE s.status='COMPLETADA'${sCond} AND ${aliasRange(rangeSql,'s')}
    GROUP BY COALESCE(u.username,'sistema') ORDER BY total DESC
  `).all();

  // ---- Heatmap 7x24 (dÃ­a de semana vs hora) ----
  const heatmap = db.prepare(`
    SELECT CAST(strftime('%w', created_at) AS INTEGER) AS dow,
           CAST(strftime('%H', created_at) AS INTEGER) AS hour,
           COUNT(*) AS count, COALESCE(SUM(total),0) AS total
    FROM sales WHERE status='COMPLETADA'${bc} AND ${rangeSql}
    GROUP BY dow, hour
  `).all();

  // ---- Top clientes por valor ----
  const topClients = db.prepare(`
    SELECT COALESCE(c.name, 'Mostrador') AS name, COUNT(s.id) AS count, COALESCE(SUM(s.total),0) AS total
    FROM sales s LEFT JOIN customers c ON c.id = s.customer_id
    WHERE s.status='COMPLETADA'${sCond} AND ${aliasRange(rangeSql,'s')}
    GROUP BY COALESCE(c.name,'Mostrador') ORDER BY total DESC LIMIT 8
  `).all();

  // ---- Clientes inactivos ----
  const inactiveClients = db.prepare(`
    SELECT name, last_purchase, days
    FROM (
      SELECT c.id, c.name,
             (SELECT MAX(date(created_at)) FROM sales s WHERE s.customer_id=c.id AND s.status='COMPLETADA'${sCond}) AS last_purchase,
             CAST(julianday('now') - julianday((
                SELECT MAX(date(created_at)) FROM sales s WHERE s.customer_id=c.id AND s.status='COMPLETADA'${sCond})) AS INTEGER) AS days
      FROM customers c WHERE c.active=1
    ) WHERE last_purchase IS NOT NULL ORDER BY days DESC LIMIT 8
  `).all();

  // ---- RetenciÃ³n de clientes (recomprÃ³ dentro de 30 dÃ­as previos) ----
  const retention = db.prepare(`
    SELECT
      COUNT(DISTINCT s.customer_id) AS total_customers,
      COUNT(DISTINCT CASE WHEN EXISTS (
        SELECT 1 FROM sales s2 WHERE s2.customer_id = s.customer_id AND s2.id < s.id
        AND julianday(s2.created_at) >= julianday(s.created_at) - 30
        AND s2.status='COMPLETADA'
      ) THEN s.customer_id END) AS repeat_customers
    FROM sales s
    WHERE s.customer_id IS NOT NULL AND s.status='COMPLETADA'${sCond} AND ${aliasRange(rangeSql,'s')}
  `).get();

  // ---- DSO (DÃ­as de cobro) ----
  const cxc = db.prepare(`SELECT COALESCE(SUM(balance),0) t FROM customers WHERE active=1`).get().t;
  const dso = totalSales.t > 0 ? (Number(cxc) / totalSales.t) * 30 : 0;

  // ---- DistribuciÃ³n por hora (para el grÃ¡fico de flujo) ----
  const byHour = db.prepare(`
    SELECT CAST(strftime('%H', created_at) AS INTEGER) AS hour, COUNT(*) AS count, COALESCE(SUM(total),0) AS total
    FROM sales WHERE status='COMPLETADA'${bc} AND ${rangeSql}
    GROUP BY hour ORDER BY hour
  `).all();

  // ---- Ventas por categorÃ­a (donut) ----
  const byCategory = db.prepare(`
    SELECT COALESCE(ca.name,'Sin categorÃ­a') AS name, COALESCE(SUM(si.total),0) AS total
    FROM sale_items si
    JOIN sales s ON s.id = si.sale_id
    LEFT JOIN products p ON p.id = si.product_id
    LEFT JOIN categories ca ON ca.id = p.category_id
    WHERE s.status='COMPLETADA'${sCond} AND ${aliasRange(rangeSql, 's')}
    GROUP BY COALESCE(ca.name,'Sin categorÃ­a') ORDER BY total DESC
  `).all();

  // ---- Series diarias para grÃ¡fico principal ----
  const byDay = rangeFilter(from, to) === `date(created_at) = date('now','localtime')`
    ? dailySalesRange(new Date().toISOString().slice(0,10), new Date().toISOString().slice(0,10), bq ? `branch_id = ${bq}` : null)
    : (from && to ? dailySalesRange(from, to, bq ? `branch_id = ${bq}` : null) : []);

  // ---- Series semanales (Ãºltimos 14 dÃ­as) para sparkline/comparativa ----
  const weekSales = db.prepare(`
    SELECT date(created_at) AS day, COUNT(*) AS count, COALESCE(SUM(total),0) AS total
    FROM sales WHERE status='COMPLETADA'${bc} AND date(created_at) >= date('now','localtime','-13 days')
    GROUP BY date(created_at) ORDER BY day
  `).all();

  // ---- Comparativa con perÃ­odo previo ----
  const compare = (from && to) ? compareRange(from, to, bq ? `branch_id = ${bq}` : null) : compareRange(
    new Date().toISOString().slice(0,10), new Date().toISOString().slice(0,10), bq ? `branch_id = ${bq}` : null
  );

  const recent = db.prepare(`
    SELECT s.id, s.folio, s.total, s.source, s.created_at, COALESCE(u.username,'sistema') AS seller
    FROM sales s LEFT JOIN users u ON u.id = s.user_id
    WHERE 1=1${sCond}
    ORDER BY s.id DESC LIMIT 12
  `).all();

  const topProducts = db.prepare(`
    SELECT product_name, SUM(si.qty) AS qty, COALESCE(SUM(si.total),0) AS total
    FROM sale_items si JOIN sales s ON s.id=si.sale_id
    WHERE s.status='COMPLETADA'${sCond} AND ${aliasRange(rangeSql, 's')}
    GROUP BY product_name ORDER BY total DESC LIMIT 10
  `).all();

  const byMethod = db.prepare(`
    SELECT COALESCE(p.method,'OTRO') AS method, COALESCE(SUM(p.amount),0) AS total
    FROM sale_payments p JOIN sales s ON s.id = p.sale_id
    WHERE s.status='COMPLETADA'${sCond} AND ${aliasRange(rangeSql, 's')}
    GROUP BY p.method ORDER BY total DESC
  `).all();

  const invProfit = db.prepare(`SELECT COALESCE(SUM((price_minor - COALESCE(cost,0)) * stock),0) AS t FROM products WHERE active=1`).get().t;

  const lowStockList = db.prepare(`
    SELECT p.name, p.stock, p.stock_min, p.unit FROM products p
    WHERE p.active=1 AND p.stock_min > 0 AND p.stock <= p.stock_min ORDER BY (p.stock - p.stock_min) ASC LIMIT 10
  `).all();

  const openSessions = db.prepare(`SELECT COUNT(*) AS c FROM cash_sessions WHERE status='ABIERTA'`).get().c;

  const invTurnover = db.prepare(`
    SELECT COALESCE(SUM(qty),0) qty FROM sale_items si JOIN sales s ON s.id=si.sale_id
    WHERE s.status='COMPLETADA'${sCond} AND ${aliasRange(rangeSql, 's')}
  `).get().qty;

  res.json({
    // nÃºcleo
    today_sales: M(totalSales.t),
    today_count: totalSales.c,
    today_profit: M(totalGross.t),
    gross_margin: totalSales.t > 0 ? M((totalGross.t / totalSales.t) * 100) : 0,
    units_sold: totalGross.units || 0,
    avg_ticket: M(avgTicket),
    meta_diaria: M(metaDiaria),
    meta_progress: metaDiaria > 0 ? M((totalSales.t / metaDiaria) * 100) : 0,
    net_total: M(totalSales.t - totalRefunds - totalExpenses),
    forecast,
    inv_profit: M(invProfit),
    low_stock: lowStockList.length,
    low_stock_list: lowStockList,
    products: db.prepare('SELECT COUNT(*) AS c FROM products WHERE active=1').get().c,
    clients: db.prepare('SELECT COUNT(*) AS c FROM customers WHERE active=1').get().c,
    open_sessions: openSessions,
    cxc_total: M(cxc),
    dso: M(dso),
    refunds_total: M(totalRefunds),
    refunds_count: (db.prepare(`SELECT COUNT(*) c FROM refunds WHERE ${rangeSql}`).get().c) || 0,
    expenses_total: M(totalExpenses),
    bot_today: { count: botSales.c, total: M(botSales.t) },
    remote_orders: { count: remoteCount.c, total: M(remoteCount.t) },
    inv_turnover: M(invTurnover),
    // rankings
    top_products: topProducts,
    by_method: byMethod,
    by_category: byCategory,
    by_seller: bySeller,
    top_clients: topClients,
    inactive_clients: inactiveClients,
    retention: { total: retention.total_customers || 0, repeat: retention.repeat_customers || 0, pct: retention.total_customers ? M((retention.repeat_customers / retention.total_customers) * 100) : 0 },
    // series
    by_day: byDay,
    week_sales: weekSales,
    by_hour: byHour,
    heatmap: heatmap,
    // comparativa
    compare,
    recent
  });
});

// ---- Endpoint calendario: intensidad de dÃ­as del aÃ±o ----
router.get('/calendar', (req, res) => {
  const year = parseInt(req.query.year, 10) || new Date().getFullYear();
  const bq = req.query.branch_id ? Number(req.query.branch_id) : null;
  const bCond = bq ? ` AND branch_id = ${bq}` : '';
  const days = db.prepare(`
    SELECT date(created_at) AS day, COUNT(*) AS count, COALESCE(SUM(total),0) AS total
    FROM sales WHERE status='COMPLETADA'${bCond}
      AND strftime('%Y', created_at) = '${year}'
    GROUP BY day ORDER BY day
  `).all();
  const months = db.prepare(`
    SELECT strftime('%m', created_at) AS month, COUNT(*) AS count, COALESCE(SUM(total),0) AS total
    FROM sales WHERE status='COMPLETADA'${bCond} AND strftime('%Y', created_at) = '${year}'
    GROUP BY month ORDER BY month
  `).all();
  res.json({ year, days, months });
});

// ---- Endpoint serie de un rango especÃ­fico (para drill-down calendario) ----
router.get('/series', (req, res) => {
  const { from, to, granularity = 'day' } = req.query;
  if (!from || !to) return res.status(400).json({ error: 'from/to required' });
  const bq = req.query.branch_id ? Number(req.query.branch_id) : null;
  const bCond = bq ? ` AND branch_id = ${bq}` : '';
  const g = granularity === 'hour' ? '%Y-%m-%d %H' : '%Y-%m-%d';
  const rows = db.prepare(`
    SELECT strftime('${g}', created_at) AS bucket, COUNT(*) AS count, COALESCE(SUM(total),0) AS total
    FROM sales WHERE status='COMPLETADA'${bCond} AND date(created_at) >= '${from}' AND date(created_at) <= '${to}'
    GROUP BY bucket ORDER BY bucket
  `).all();
  res.json({ from, to, granularity, rows });
});

// ---- Comparación A/B de dos períodos arbitrarios (para drill-down de comparativa) ----
router.get('/compare', (req, res) => {
  const { a_from, a_to, b_from, b_to } = req.query;
  if (!a_from || !a_to || !b_from || !b_to) return res.status(400).json({ error: 'a_from,a_to,b_from,b_to required' });
  const safe = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v || '') ? v : null;
  if (![a_from, a_to, b_from, b_to].every(safe)) return res.status(400).json({ error: 'fechas inválidas (YYYY-MM-DD)' });
  function agg(f, t) {
    const s = db.prepare(`SELECT COALESCE(SUM(total),0) t, COUNT(*) c FROM sales WHERE status='COMPLETADA' AND date(created_at) >= ? AND date(created_at) <= ?`).get(f, t);
    const byDay = db.prepare(`SELECT date(created_at) AS day, COALESCE(SUM(total),0) AS total FROM sales WHERE status='COMPLETADA' AND date(created_at) >= ? AND date(created_at) <= ? GROUP BY date(created_at) ORDER BY day`).all(f, t);
    const avgTicket = s.c > 0 ? s.t / s.c : 0;
    return { total: M(s.t), count: s.c, avg: M(avgTicket), daily: byDay.map(x => ({ day: x.day.slice(5), total: M(x.total) })) };
  }
  const a = agg(a_from, a_to), b = agg(b_from, b_to);
  const delta = b.total > 0 ? Math.round(((a.total - b.total) / b.total) * 100) : (a.total > 0 ? 100 : 0);
  res.json({ a: { ...a, from: a_from, to: a_to }, b: { ...b, from: b_from, to: b_to }, delta_pct: delta });
});

module.exports = router;


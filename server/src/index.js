const path = require('path');
const fs = require('fs');
const express = require('express');
const cors = require('cors');
const { db } = require('./db');
const { seed } = require('./seed');
const telegram = require('./telegram');

// Blindaje: nunca dejar morir el proceso por errores no manejados.
// En Node moderno, una promise rechazada o una excepción no capturada
// derriban el proceso; aquí se registran y se continúa sirviendo.
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason && reason.stack ? reason.stack : String(reason));
});
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err && err.stack ? err.stack : String(err));
});

seed();

const app = express();
app.use(cors());
app.use(express.json({ limit: '8mb' }));

app.get('/api/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

app.use('/api/auth', require('./routes/auth'));
app.use('/api/settings', require('./routes/settings'));
// Rutas públicas montadas antes que los routers con auth global (esos enrutan
// todo /api/* y bloquearían los endpoints públicos).
app.use('/api', require('./routes/access'));
app.use('/api/telegram', require('./routes/telegram'));
app.use('/api', require('./routes/users'));
app.use('/api', require('./routes/products'));
app.use('/api', require('./routes/customers'));
app.use('/api', require('./routes/sales'));
app.use('/api/cash', require('./routes/cash'));
app.use('/api/dashboard', require('./routes/dashboard'));
app.use('/api/reports', require('./routes/reports'));
app.use('/api', require('./routes/refunds'));
app.use('/api', require('./routes/quotes'));
app.use('/api', require('./routes/expenses'));
app.use('/api', require('./routes/purchases'));
app.use('/api', require('./routes/branches'));
app.use('/api/print', require('./routes/print'));

const clientCandidates = [
  path.join(path.dirname(process.execPath), 'www'),
  path.join(__dirname, '..', '..', 'client', 'dist'),
  path.join(__dirname, '..', '..', 'dist')
];
const clientDist = clientCandidates.find(dir => fs.existsSync(path.join(dir, 'index.html')));
if (clientDist) {
  app.use(express.static(clientDist));
  app.get(/^(?!\/api).*/, (req, res) => res.sendFile(path.join(clientDist, 'index.html')));
}

app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: 'Error interno del servidor', detail: String(err.message || err) });
});

const PORT = Number(process.env.PORT) || 3000;
app.listen(PORT, () => {
  console.log(`✅ Sistema de ventas activo en http://localhost:${PORT}`);
  console.log(`   BD: ${require('./db').DB_PATH}`);
  try { telegram.startBot(); } catch (e) { console.error('Bot:', e.message); }
});
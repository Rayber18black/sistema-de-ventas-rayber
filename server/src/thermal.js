const net = require('net');
const { getSetting } = require('./seed');

const ESC = '\x1b';

function be(...bytes) { return Buffer.from(bytes); }

function mode(bold, dh, dw) {
  let m = 0;
  if (bold) m |= 0x08;
  if (dh) m |= 0x10;
  if (dw) m |= 0x20;
  return be(0x1b, 0x21, m);
}

function align(a) {
  const m = a === 'center' ? 1 : a === 'right' ? 2 : 0;
  return be(0x1b, 0x61, m);
}

function textLine(str) {
  return Buffer.from((String(str || '') + '\n').replace(/\n\n/g, '\n'), 'ascii');
}

function cut() {
  return Buffer.concat([be(0x1b, 0x6d) /* partial cut (ESC m) */, be(0x1a, 0x14)]);
}

// ---------- formato de texto ----------
function wrapText(t, w) {
  const s = String(t || '');
  const out = [];
  let cur = '';
  for (const ch of s) {
    cur += ch;
    if (cur.length >= w) { out.push(cur); cur = ''; }
  }
  if (cur) out.push(cur);
  return out.length ? out : [''];
}

function fmtLines(business, data, w) {
  const lines = [];
  lines.push({ text: business || 'Mi Negocio', align: 'center', bold: true, dh: true });
  if (data.posTitle) lines.push({ text: data.posTitle, align: 'center', bold: true });
  if (data.tagline) lines.push({ text: data.tagline, align: 'center' });
  lines.push({ text: '-'.repeat(w), align: 'left' });
  lines.push({ text: `Folio: ${data.folio}`, align: 'left', bold: true });
  lines.push({ text: `Fecha: ${data.date}`, align: 'left' });
  if (data.seller) lines.push({ text: `Atendió: ${data.seller}`, align: 'left' });
  if (data.customer) lines.push({ text: `Cliente: ${data.customer}`, align: 'left' });
  if (data.branch) lines.push({ text: `Sucursal: ${data.branch}`, align: 'left' });
  lines.push({ text: '-'.repeat(w), align: 'left' });

  for (const it of data.items || []) {
    const nameLines = wrapText(it.name, w - 10);
    nameLines.forEach((n, i) => lines.push({ text: (i === 0 ? n : `  ${n}`), align: 'left', bold: i === 0 }));
    lines.push({ text: pad2(`${it.qty} × ${it.price}`, it.total, w), align: 'left' });
  }

  lines.push({ text: '-'.repeat(w), align: 'left' });
  lines.push({ text: pad2('Subtotal', data.subtotal, w), align: 'left' });
  if (data.discount > 0) lines.push({ text: pad2('Descuento', '-' + data.discount, w), align: 'left' });
  if (data.tax > 0) lines.push({ text: pad2('Impuestos', data.tax, w), align: 'left' });
  lines.push({ text: pad2('TOTAL', data.total, w), align: 'left', bold: true, dh: true });
  for (const p of data.payments || []) lines.push({ text: pad2(p.method, p.amount, w), align: 'left' });
  if (data.note) lines.push({ text: `Nota: ${data.note}`, align: 'left' });
  lines.push({ text: '-'.repeat(w), align: 'left' });
  lines.push({ text: '¡Gracias por su compra!', align: 'center' });
  lines.push({ text: '', align: 'left' });
  return lines;
}

function pad2(label, value, w) {
  const l = String(label || '');
  const v = String(value == null ? '' : value);
  const room = Math.max(w - l.length - v.length, 1);
  return l + (room > 0 ? '.'.repeat(room) : ' ') + v;
}

function buildBuffer(lines, w) {
  const parts = [];
  parts.push(be(0x1b, 0x40)); // init
  for (const l of lines) {
    const wrapped = wrapText(l.text || '', w);
    for (const seg of wrapped) {
      let line = be();
      line = Buffer.concat([line, align(l.align), mode(l.bold, l.dh, l.dw), textLine(l.align === 'center' ? seg : seg.slice(0, w))]);
      parts.push(line);
    }
  }
  parts.push(cut());
  parts.push(be(0x0c)); // form feed
  return Buffer.concat(parts);
}

function thermalConfig() {
  const t = getSetting('thermal') || {};
  return {
    enabled: !!t.enabled,
    host: t.host || '127.0.0.1',
    port: Number(t.port) || 9100,
    width: Number(t.width) || 58
  };
}

function sendRaw(buffer, cfg) {
  return new Promise((resolve, reject) => {
    const sock = new net.Socket();
    let done = false;
    const finish = (err) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      sock.destroy();
      err ? reject(err) : resolve();
    };
    const timer = setTimeout(() => finish(new Error('La impresora no respondió (timeout)')), 6000);
    sock.once('error', e => finish(new Error(`No se pudo conectar a ${cfg.host}:${cfg.port} (${e.code || e.message})`)));
    sock.connect(cfg.port, cfg.host, () => {
      sock.write(buffer);
      // esperamos pequeño flush; protocolos de red (Raw/9100) aceptan cierre inmediato
      setTimeout(() => finish(), 250);
    });
  });
}

function printTicket(data) {
  const cfg = thermalConfig();
  const lines = fmtLines((data.businessName || 'Mi Negocio'), data, cfg.width);
  return sendRaw(buildBuffer(lines, cfg.width), cfg);
}

function printBlock(lines) {
  const cfg = thermalConfig();
  return sendRaw(buildBuffer(lines.map(t => ({ text: t, align: 'left' })), cfg.width), cfg);
}

function testPage() {
  const cfg = thermalConfig();
  const lines = [
    { text: '=== TEST DE IMPRESIÓN ===', align: 'center', bold: true, dh: true },
    { text: `Host: ${cfg.host} : ${cfg.port}`, align: 'center' },
    { text: `Ancho: ${cfg.width}mm`, align: 'center' },
    { text: '', align: 'left' },
    { text: 'Si ves este texto, la impresora térmica funciona.', align: 'left' },
    { text: 'Línea 2 de verificación', align: 'left' },
    { text: '', align: 'left' }
  ];
  return sendRaw(buildBuffer(lines, cfg.width), cfg);
}

module.exports = { printTicket, printBlock, testPage, thermalConfig };
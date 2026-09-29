const MODE = process.argv[2] || 'valid';

const CDP_PORT = 9222;
let seq = 0;
const pending = new Map();

function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.onopen = () => resolve(ws);
    ws.onerror = e => reject(e);
  });
}

function send(ws, method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function main() {
  const loginRes = await fetch('http://localhost:9130/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'root', password: 'root123' })
  });
  const login = await loginRes.json();
  const TOKEN = login.token;
  const userObj = login.user;
  // Obtener la URL del primer target (about:blank arrancado por chrome)
  let targets = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json`)).json();
  let target = targets.find(t => t.type === 'page');
  if (!target) throw new Error('sin target page');
  const ws = await connect(target.webSocketDebuggerUrl);
  ws.onmessage = ev => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
    } else if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails;
      console.log('EXCEPTION_THROWN:', JSON.stringify({
        text: d.text,
        exception: d.exception ? d.exception.description : null,
        url: d.url,
        line: d.lineNumber,
        col: d.columnNumber,
        stack: d.stackTrace ? d.stackTrace.callFrames.map(f => `${f.functionName||'<anon>'}:${f.url}:${f.lineNumber}:${f.columnNumber}`).slice(0,10) : []
      }));
    } else if (msg.method === 'Runtime.consoleAPICalled') {
      const type = msg.params.type;
      if (type === 'error' || type === 'warning') {
        const args = msg.params.args.map(a => a.value !== undefined ? a.value : (a.description || a.type)).join(' ');
        console.log(`CONSOLE_${type.toUpperCase()}:`, args);
      }
    } else if (msg.method === 'Log.entryAdded') {
      const e = msg.params.entry;
      if (e.level === 'error' || e.level === 'warning') console.log(`LOG_${e.level.toUpperCase()}:`, e.text);
    }
  };
  await send(ws, 'Runtime.enable');
  await send(ws, 'Log.enable');
  await send(ws, 'Page.enable');

  // 1) Cargar el origen para poder escribir localStorage
  await send(ws, 'Page.navigate', { url: 'http://localhost:9130/?v=' + Date.now() });
  await new Promise(r => setTimeout(r, 3000));

  let userValue;
  if (MODE === 'corrupt') userValue = '{"id":1,"username":CORRUPT,';      // JSON deliberadamente invalido
  else userValue = JSON.stringify(userObj);                               // igual que localStorage.setItem del login
  const expr = `
    localStorage.setItem('posv_token', ${JSON.stringify(TOKEN)});
    localStorage.setItem('posv_user', ${JSON.stringify(userValue)});
    'ok: ' + localStorage.getItem('posv_token').slice(0, 20)
  `;
  console.log('SETLOCAL:', JSON.stringify(await send(ws, 'Runtime.evaluate', { expression: expr, returnByValue: true })));
  const diag = await send(ws, 'Runtime.evaluate', {
    expression: `(() => { const v = localStorage.getItem('posv_user'); let r = 'n/a'; try { r = typeof JSON.parse(v) } catch (e) { r = 'ERR' } const n = localStorage.getItem('posv_token'); return 'user-parse:' + r + '  token:' + (n ? n.slice(0,10) : 'null') + '  user-start:' + (v||'').slice(0,40) })()`,
    returnByValue: true
  });
  console.log('DIAG:', diag.result && diag.result.value);

  const pages = ['/pos','/dashboard','/inventory','/sales','/customers','/quotes','/purchases','/expenses','/reports','/users','/settings','/bots'];
  for (const p of pages) {
    await send(ws, 'Page.navigate', { url: 'http://localhost:9130' + p + '?v=' + Date.now() });
    await new Promise(r => setTimeout(r, 2500));
    const dom = await send(ws, 'Runtime.evaluate', {
      expression: `document.body ? document.body.innerText.slice(0, 300) : '(sin body)'`,
      returnByValue: true
    });
    const text = dom.result && dom.result.value ? String(dom.result.value).replace(/\s+/g, ' ').slice(0, 120) : '(vacío)';
    const hasLogin = String(dom.result && dom.result.value || '').toLowerCase().includes('usuario');
    console.log(`PAGE ${p} => ${text}  ${hasLogin ? '[LOGIN]' : ''}`);
  }
  await new Promise(r => setTimeout(r, 1000));
  ws.close();
}

main().catch(e => { console.error('SCRIPT_ERR', e); process.exit(1); });
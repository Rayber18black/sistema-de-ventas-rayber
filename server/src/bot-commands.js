const { db } = require('./db');

// Catálogo de comandos disponibles del bot, agrupados por área. El orden de
// definición define el orden en la UI de configuración.
const COMMANDS = [
  { cmd: '/menu', label: '🏠 Menú principal (botones)', area: 'General' },
  { cmd: '/ayuda', label: 'Ayuda', area: 'General' },
  { cmd: '/vincular', label: 'Vincular dispositivo (usuario + contraseña + rol)', area: 'General' },
  { cmd: '/precio', label: 'Consultar precio/stock de un producto', area: 'Ventas' },
  { cmd: '/productos', label: 'Ver todos los productos disponibles', area: 'Ventas' },
  { cmd: '/consultar', label: 'Enviar consulta al negocio', area: 'Ventas' },
  { cmd: '/solicitar', label: 'Solicitar un producto que quieres (nombre y marca)', area: 'Ventas' },
  { cmd: '/comprar', label: 'Compra a distancia (cliente)', area: 'Ventas' },
  { cmd: '/apartar', label: 'Apartar producto (cliente)', area: 'Ventas' },
  { cmd: '/pague', label: 'Confirmar pago de pedido (cliente)', area: 'Ventas' },
  { cmd: '/promos', label: 'Ver promociones (cliente)', area: 'Ventas' },
  { cmd: '/stock', label: 'Productos con stock bajo (inventario)', area: 'Inventario' },
  { cmd: '/pagar', label: 'Confirmar pago remoto y crear venta', area: 'Ventas' },
  { cmd: '/cancelar', label: 'Cancelar pedido remoto', area: 'Ventas' },
  { cmd: '/aprobar', label: 'Aprobar devolución', area: 'Devoluciones' },
  { cmd: '/rechazar', label: 'Rechazar devolución', area: 'Devoluciones' },
  { cmd: '/devolucion', label: 'Solicitar devolución (vendedor)', area: 'Devoluciones' },
  { cmd: '/comunicado', label: 'Enviar comunicado a vendedores (root)', area: 'Comunicación' },
  { cmd: '/aviso', label: 'Enviar aviso/pedido urgente al Root', area: 'Comunicación' },
  { cmd: '/chats', label: 'Ver chats/dispositivos vinculados (root)', area: 'Supervisión' },
  { cmd: '/reporte', label: 'Reporte de ventas del día', area: 'Reportes' },
  { cmd: '/caja', label: 'Reporte de caja abierta', area: 'Caja' },
  { cmd: '/cierre', label: 'Solicitar cierre de caja', area: 'Caja' },
  { cmd: '/tasa', label: 'Ver / actualizar tasa de cambio (root)', area: 'Configuración' }
];

// Permisos del sistema que habilitan cada comando (si el rol NO tiene el
// permiso, el comando no debería usarse sin importar la config).
const CMD_REQUIRES = {
  '/menu': [],
  '/stock': ['products.view'],
  '/precio': ['products.view'],
  '/productos': ['products.view'],
  '/solicitar': [],
  '/comprar': ['products.view'],
  '/apartar': ['products.view'],
  '/pague': ['products.view'],
  '/promos': [],
  '/pagar': ['sales.view_all', 'refunds.approve'],
  '/cancelar': ['sales.view_all'],
  '/aprobar': ['refunds.approve'],
  '/rechazar': ['refunds.approve'],
  '/devolucion': ['refund.do'],
  '/comunicado': ['marketing.promos'],
  '/aviso': [],
  '/chats': ['users.manage'],
  '/reporte': ['reports.view'],
  '/caja': ['cash.open'],
  '/cierre': ['cash.close'],
  '/tasa': ['settings.manage'],
  '/ayuda': [],
  '/vincular': []
};

// Comandos que el propio usuario (cliente) puede ejecutar sin vínculo de
// dispositivo: no requieren usuario del sistema.
const CLIENT_COMMANDS = ['/precio', '/productos', '/solicitar', '/comprar', '/apartar', '/pague', '/promos', '/consultar'];

const ROLE_DEFAULTS = {
  'Root': ['/ayuda', '/vincular', '/stock', '/precio', '/pagar', '/cancelar', '/aprobar', '/rechazar', '/comunicado', '/aviso', '/chats', '/reporte', '/caja', '/cierre', '/tasa'],
  'Administrador': ['/ayuda', '/vincular', '/stock', '/precio', '/pagar', '/cancelar', '/aprobar', '/rechazar', '/reporte', '/caja', '/cierre'],
  'Gerente': ['/ayuda', '/vincular', '/stock', '/precio', '/pagar', '/cancelar', '/aprobar', '/rechazar', '/reporte', '/caja', '/cierre'],
  'Vendedor/Cajero': ['/ayuda', '/vincular', '/precio', '/devolucion', '/aviso', '/caja'],
  'Inventario/Almacén': ['/ayuda', '/vincular', '/stock', '/devolucion', '/aviso']
};

function cmdAllowedForRole(cmd, role) {
  if (cmd === '/menu') return true; // todos pueden ver el menú con botones
  const requires = CMD_REQUIRES[cmd] || [];
  if (requires.some(p => !role.permissions.includes(p))) return false;
  const saved = savedCommands(role);
  if (!saved) return (ROLE_DEFAULTS[role.name] || []).includes(cmd);
  return saved.includes(cmd);
}

function savedCommands(role) {
  const row = db.prepare('SELECT commands FROM bot_permissions WHERE role_id = ?').get(role.id);
  if (!row) return null;
  try { return JSON.parse(row.commands); } catch (e) { return []; }
}

function saveCommands(roleId, commands) {
  // filtramos solo comandos conocidos
  const known = COMMANDS.map(c => c.cmd);
  const clean = commands.filter(c => known.includes(c));
  db.prepare(`
    INSERT INTO bot_permissions (role_id, commands) VALUES (?, ?)
    ON CONFLICT(role_id) DO UPDATE SET commands = excluded.commands
  `).run(roleId, JSON.stringify(clean));
  return clean;
}

function availableCommands(role) {
  // comandos que el rol PODRIA usar (por permiso + config por rol)
  return COMMANDS.map(c => c.cmd).filter(cmd => cmdAllowedForRole(cmd, role));
}

module.exports = { COMMANDS, ROLE_DEFAULTS, CLIENT_COMMANDS, CMD_REQUIRES, cmdAllowedForRole, availableCommands, saveCommands, savedCommands };

# Sistema de Ventas Comercial (POS)

Sistema de **punto de venta** multi-dispositivo para cualquier establecimiento, con
instalador `.exe` para Windows. Funciona en **red local** y **sin internet**: los datos
se guardan en una base **SQLite** local.

- **Backend:** Node.js + Express + SQLite (API REST)
- **Frontend:** React 18 + Vite
- **Acceso:** PC, tablet y móvil por navegador en la misma red local

> Documento de requisitos funcionales completo: [ESPECIFICACION.md](./ESPECIFICACION.md)
> Seguimiento de mejoras: [MEJORAS.md](./MEJORAS.md)

---

## 1. Requisitos

### Obligatorios

| Requisito | Versión | Detalle |
| --- | --- | --- |
| **Node.js** | **24 o superior** | Obligatorio. El sistema usa el módulo nativo `node:sqlite`, que solo está estable desde Node 24. Con Node 22 o inferior el servidor no arranca. |
| **npm** | 10 o superior | Viene incluido con Node.js. |
| **Windows** | 10 / 11 | Diseñado y probado en Windows. Funciona también en Linux/macOS para desarrollo. |
| Espacio en disco | ~500 MB | Incluye dependencias de `node_modules`. |

Verifica tu versión con:

```bash
node -v     # debe mostrar v24.x.x o superior
npm -v
```

### Opcionales

| Requisito | Para qué |
| --- | --- |
| **Inno Setup 6** | Solo para generar el instalador `setup.exe`. Descarga: https://jrsoftware.org/isdl.php |
| Impresora térmica de red | Para tickets ESC/POS por IP (puerto 9100). Sin ella se imprime el ticket en PDF/papel. |
| Impresora de etiquetas | Para generar etiquetas de precios con código de barras. |
| Código de barras (lector) | Acelera el POS. También se puede buscar el producto por nombre. |
| Conexión a internet | **Solo** para los bots de Telegram. La venta local funciona sin internet. |

### No se requiere base de datos externa

SQLite va **incorporado en Node.js**. No hay que instalar MySQL, PostgreSQL ni ningún
servidor de base de datos.

---

## 2. Puesta en marcha

### Opción A — Modo desarrollo (2 terminales)

Necesitas abrir dos terminales.

```bash
# Terminal 1 — Servidor (puerto 3000)
cd server
npm install
npm start

# Terminal 2 — Frontend (puerto 5173, con recarga automática)
cd client
npm install
npm run dev
```

Abre **http://localhost:5173**

El frontend de desarrollo redirige las llamadas a la API hacia
`http://localhost:3000` (configurado en `client/vite.config.js`).

### Opción B — Modo producción (un solo comando)

Compilas el frontend una vez y el servidor lo sirve todo en el mismo puerto:

```bash
# 1) Compilar el frontend
cd client
npm install
npm run build

# 2) Arrancar el servidor (sirve la API + la web compilada)
cd ../server
npm install
npm start
```

Abre **http://localhost:3000**

### Opción C — Aplicación portable `.exe`

```bash
cd instalador
npm install
npm run build
```

En `instalador/dist/` obtendras:

- `POSVentas.exe` — ejecutable único (Node + servidor empaquetados, tecnología SEA).
- `www/` — la interfaz web, debe ir junto al `.exe`.
- `INICIAR.bat` — abre el sistema con doble clic.

### Opción D — Instalador `setup.exe` (para entregar a clientes)

1. Instala **Inno Setup 6** (https://jrsoftware.org/isdl.php).
2. Compila `instalador/plantilla-instalador.iss` desde la carpeta `instalador/dist/`.
3. Entrega `POSVentas-Setup.exe`: instala, crea acceso directo y agrega desinstalador.

---

## 3. Credenciales de acceso

| Usuario | Contrasena | Rol | Notas |
| --- | --- | --- | --- |
| `root` | `root123` | Root (administrador total) | Se crea automaticamente en la primera ejecucion. |

**Cambia esta contrasena despues del primer ingreso** en el menu de usuario.

> Esta contrasena es temporal y publica en este repositorio. En una instalacion real
> cambiala de inmediato: anyone con acceso al codigo puede verla.

Los demas usuarios se crean en **Usuarios**. Cada usuario tiene un rol, y cada rol
tiene sus permisos. Roles incluidos por defecto:

| Rol | Descripcion |
| --- | --- |
| **Root** | Acceso total, incluidos usuarios, roles y configuracion critica |
| **Administrador** | Todo excepto administrar usuarios, roles y ajustes criticos |
| **Gerente** | Operacion completa del negocio, sin tocar configuracion sensible |
| **Vendedor** | Punto de venta, sus ventas y consulta de productos |
| **Inventario** | Productos, compras, kardex y stock |

Tambien puedes crear **roles a medida** con permisos personalizados.

---

## 4. Librerias necesarias

Todas se instalan solas con `npm install`. No hay que configurar nada.

### Backend (`server/package.json`)

| Libreria | Version | Para que se usa |
| --- | --- | --- |
| `express` | ^4.19.2 | Servidor web y rutas de la API REST |
| `bcryptjs` | ^2.4.3 | Encriptar contrasenas de usuarios |
| `jsonwebtoken` | ^9.0.2 | Tokens de sesion (JWT) |
| `cors` | ^2.8.5 | Permitir peticiones desde otros equipos de la red local |
| `qrcode` | ^1.5.4 | Generar los codigos QR de acceso y de los bots |
| `node:sqlite` | **incluido en Node 24** | Base de datos SQLite (no se instala) |

### Frontend (`client/package.json`)

| Libreria | Version | Para que se usa |
| --- | --- | --- |
| `react` | ^18.3.1 | Interfaz de usuario |
| `react-dom` | ^18.3.1 | Montaje de React en el navegador |
| `react-router-dom` | ^6.26.2 | Navegacion entre paginas |
| `chart.js` | ^4.5.1 | Graficas |
| `react-chartjs-2` | ^5.3.1 | Envoltorio de Chart.js para React |
| `@heroicons/react` | ^2.2.0 | Iconos de la interfaz |

Herramientas de desarrollo:

| Libreria | Version | Para que se usa |
| --- | --- | --- |
| `vite` | ^5.4.8 | Empaquetador y servidor de desarrollo |
| `@vitejs/plugin-react` | ^4.3.1 | Soporte de JSX en Vite |

### Empaquetado del `.exe` (`instalador/package.json`)

| Libreria | Version | Para que se usa |
| --- | --- | --- |
| `esbuild` | ^0.24.2 | Empaquetar el servidor en un unico `.exe` |
| `postject` | ^1.0.0-alpha.6 | Inyectar el binario de Node dentro del ejecutable |

> **Nota sobre `client/dist`:** esta carpeta (el frontend compilado) no se sube al
> repositorio. Se genera con `npm run build`. En el modo produccion el servidor la
> sirve automaticamente.

---

## 5. Donde se guardan los datos

Todo se guarda en un unico archivo de base de datos:

```
Windows:  %APPDATA%\POSVentas\posv.db
Linux/Mac:  ~/.POSVentas/posv.db   (si no existe APPDATA)
```

La primera vez que arranca, el sistema crea la base de datos, los roles, los permisos
y algunos productos de demostracion (como *Arroz 5kg*), que puedes eliminar.

En esa misma carpeta se genera `secret.key`, la clave de firma de los tokens de sesion.
**No la compartas ni la subas a internet.**

### Variables de entorno (opcionales)

| Variable | Por defecto | Para que sirve |
| --- | --- | --- |
| `PORT` | `3000` | Puerto del servidor. Ej.: `PORT=8080 npm start` |
| `POSV_DATA` | `%APPDATA%\POSVentas` | Carpeta donde guardar la base de datos |
| `DB_PATH` | `<POSV_DATA>\posv.db` | Ruta exacta del archivo de base de datos |
| `JWT_SECRET` | se genera solo | Clave de firma de tokens |

En Windows (PowerShell):

```powershell
$env:PORT='8080'; npm start
```

---

## 6. Estructura del proyecto

```
sistema-de-ventas-rayber/
├── server/                  API REST (Express) + SQLite + JWT
│   ├── src/
│   │   ├── index.js         Arranque del servidor y middlewares
│   │   ├── db.js            Conexion y esquema de la base de datos
│   │   ├── seed.js          Datos iniciales: roles, permisos, usuario root
│   │   ├── auth.js          Firmado y verificacion de tokens
│   │   ├── middleware/      Middleware de autenticacion/permisos
│   │   ├── routes/          Rutas de la API
│   │   │   ├── auth.js          Inicio de sesion y perfil
│   │   │   ├── users.js         Usuarios
│   │   │   ├── access.js        Roles y permisos
│   │   │   ├── products.js      Productos, stock y kardex
│   │   │   ├── sales.js         Ventas (punto de venta)
│   │   │   ├── customers.js     Clientes, creditos y cobranza
│   │   │   ├── cash.js          Apertura, cierre y arqueo de caja
│   │   │   ├── expenses.js      Gastos y caja chica
│   │   │   ├── purchases.js     Compras, proveedores y ordenes
│   │   │   ├── quotes.js        Cotizaciones
│   │   │   ├── refunds.js       Devoluciones
│   │   │   ├── reports.js       Reportes y exportaciones
│   │   │   ├── dashboard.js     Dashboard, calendario y series
│   │   │   ├── branches.js      Sucursales
│   │   │   ├── settings.js      Configuracion del negocio
│   │   │   ├── print.js         Tickets e impresion
│   │   │   └── telegram.js      Bots de Telegram
│   │   ├── sales-service.js  Logica compartida de ventas
│   │   ├── thermal.js        Impresion ESC/POS
│   │   ├── reprice.js        Recalculo de precios
│   │   ├── telegram.js       Cliente de Telegram
│   │   ├── bot-commands.js   Comandos y permisos de los bots
│   │   └── utils.js          Utilidades
│   └── package.json
│
├── client/                  Frontend React (Vite)
│   ├── src/
│   │   ├── main.jsx             Punto de entrada
│   │   ├── App.jsx              Rutas y carga diferida de paginas
│   │   ├── api.js               Cliente HTTP y manejo del token
│   │   ├── auth.jsx             Contexto de sesion y permisos
│   │   ├── i18n.jsx             Multi-idioma ES/EN
│   │   ├── theme.jsx            Tema claro/oscuro
│   │   ├── branch.js            Sucursal activa
│   │   ├── toast.jsx            Notificaciones
│   │   ├── fmt.js               Formato de moneda y fechas
│   │   ├── printer.js           Impresion de tickets
│   │   ├── CalendarPicker.jsx   Selector de fecha tipo calendario
│   │   ├── ErrorBoundary.jsx    Manejo de errores
│   │   ├── QrModal.jsx          Visor de codigos QR
│   │   ├── InboxPanel.jsx       Panel de bandeja de entrada
│   │   ├── styles.css           Estilos globales
│   │   └── pages/               Paginas
│   │       ├── Login.jsx           Inicio de sesion
│   │       ├── Pos.jsx             Punto de venta
│   │       ├── Dashboard.jsx       Dashboard con KPIs
│   │       ├── Sales.jsx           Historial de ventas y devoluciones
│   │       ├── Products.jsx        Productos e inventario
│   │       ├── Customers.jsx       Clientes, creditos y cobranza
│   │       ├── Cash.jsx            Caja (apertura, cierre, arqueo)
│   │       ├── Expenses.jsx        Gastos
│   │       ├── Purchases.jsx       Compras y proveedores
│   │       ├── Quotes.jsx          Cotizaciones
│   │       ├── Reports.jsx         Reportes
│   │       ├── Users.jsx           Usuarios
│   │       ├── Settings.jsx        Configuracion
│   │       └── BotConfig.jsx       Bots de Telegram
│   ├── vite.config.js
│   └── package.json
│
├── instalador/              Empaquetado del .exe (esbuild + SEA + postject)
│   ├── build-exe.ps1
│   ├── plantilla-instalador.iss
│   └── sea-config.json
│
├── ESPECIFICACION.md        Requisitos funcionales
└── MEJORAS.md               Seguimiento de mejoras
```

---

## 7. Funciones del sistema

### Punto de venta
- Venta con **multiples metodos de pago simultaneos** (efectivo, tarjeta, credito, transferencia, mixto).
- Busqueda por **codigo de barras** o por nombre, con cliente opcional.
- **Descuento** por venta y precios por lista (minorista, mayorista, especial).
- **Folio automatico** de venta y **ticket imprimible** (papel o ESC/POS).
- Alta rapida de cliente desde el propio POS, con C.I./RIF.
- Validacion de stock al cobrar y control de credito del cliente.

### Productos e inventario
- Catalogo con codigo de barras, imagen, categorias, impuestos y margins.
- Precios por lista, stock minimo/maximo y alerta de stock bajo.
- Movimientos de inventario (entradas, salidas, ajustes, devoluciones) y **kardex** completo.
- **Importar y exportar CSV** del catalogo.
- Control de ganancia: margen por producto y ganancia realizada.

### Clientes y creditos
- Ficha con historial de compras, saldo, abonos y **estado de cuenta**.
- **Cobranza**: registrar abonos y ver cuentas por cobrar.
- Segmentacion, busqueda rapida y exportacion.

### Caja
- Apertura y cierre por turno, movimientos de efectivo y **arqueo**.
- Control por sucursal y metodo de pago.
- Gastos y caja chica con categorias.

### Compras y proveedores
- Sugerencia de **reabastecimiento** segun stock minimo/maximo.
- Ordenes de compra con proveedores, recepcion de mercancía y actualizacion de costos.
- Historial de precio de compra por producto.

### Reportes y dashboard
- Dashboard con KPIs, tendency, ventas por hora, top de productos/clientes, metodos de pago.
- **Selector de tiempo tipo calendario** con intensidad por dia, rango de fechas y anotaciones.
- Filtro por sucursal en todo el analisis.
- Reportes por periodo, producto, vendedor, metodo de pago, inventario, ganancias, cuentas por cobrar.
- **Exportacion a CSV** de la mayoria de los reportes.
- Modo **Cajero** (vista simplificada sin costos ni ganancias).

### Otros modulos
- **Cotizaciones**: presupuestos con estado y conversion a venta.
- **Devoluciones**: quedan pendientes hasta que el dueno las aprueba.
- **Multimoneda**: moneda base y monedas secundarias con tipo de cambio.
- **Multisucursal**: ventas, caja, gastos y ordenes por sucursal.
- **Bots de Telegram** para clientes, dueno y vendedores (ver seccion 8).
- **QR de acceso** para abrir el sistema desde el celular en la red local.
- Tema claro/oscuro y multi-idioma ES/EN.

---

## 8. Bots de Telegram (opcional)

En **Configuracion → Bots de Telegram** se administran varios bots con acciones
separadas segun su tipo:

| Tipo | Acciones |
| --- | --- |
| **Cliente** | Consulta de precios, apartados, compras a distancia, confirmar pago, promociones |
| **Dueno** | Aprobar/cancelar pedidos, resolver devoluciones, reportes diarios, stock bajo, comunicados |
| **Vendedor** | Avisos de pedidos y entregas, comunicados del dueno |

**Puesta en marcha:**

1. Crea cada bot con [@BotFather](https://t.me/BotFather) en Telegram y pega su **token**
   en *Configuracion → Bots de Telegram*. Al guardar se verifica con Telegram y se
   captura el `@usuario` para generar el **QR**.
2. Registra a los usuarios del equipo:
   `/registrar CODIGO TuNombre TuTelefono`
   (el codigo es una clave de *Dueno* o *Vendedor* segun corresponda).
3. Cada bot muestra su **QR** (`t.me/<usuario>`) para compartirlo.

**Comandos para clientes** (no necesitan registrarse):

| Comando | Que hace |
| --- | --- |
| `/precio P001` | Precio y stock de un producto |
| `/apartar P001 2 Nombre Telefono` | Apartar mercaderia (avisa al dueno) |
| `/comprar P001 1 Retira Telefono` | Pedido con pago a distancia |
| `/pague RO-000001` | Confirma que ya pago |
| `/promos` | Promociones vigentes |

**Comandos del dueno:**

| Comando | Que hace |
| --- | --- |
| `/pagar RO-000001` | Verifica el pago y crea la venta |
| `/cancelar RO-000001` | Cancela el pedido |
| `/aprobar ID` · `/rechazar ID` | Resuelve una devolucion |
| `/reporte` · `/stock` · `/comunicado Texto` · `/chats` | Reportes y comunicados |

Las ventas creadas desde el bot quedan marcadas como `BOT` y se distinguen en el
dashboard y los reportes. Las devoluciones las aprueba el dueno (desde el bot o desde
la app con permiso) y al aprobarse se repone el inventario.

> Requiere salida a internet (solo el envio a `api.telegram.org`). La venta local
> sigue funcionando sin internet.

---

## 9. Seguridad

- Contrasenas encriptadas con **bcrypt**.
- Sesiones con **JWT**; la clave se genera en el primer arranque y se guarda en
  `secret.key` con permisos restringidos.
- **Permisos por rol** validados en el servidor (no solo en la interfaz).
- Todas las operaciones de escritura quedan auditadas con usuario, fecha y accion.

**Antes de exponerlo a internet:**

1. Cambia la contrasena del `root`.
2. No expongas el puerto del servidor directamente a internet.
3. Sirve el sistema por **HTTPS** (por ejemplo, con un proxy inverso como Nginx o Caddy).
4. Haz copias de seguridad periodicas del archivo `posv.db`.
5. No subas `posv.db` ni `secret.key` a ningun repositorio.

---

## 10. Problemas frecuentes

| Sintoma | Causa y solucion |
| --- | --- |
| `Cannot find module 'node:sqlite'` | Node.js muy antiguo. Instala **Node 24 o superior**. |
| `better-sqlite3` / error de compilacion al instalar | No aplica: se usa el SQLite nativo de Node. Si ves esto, estas ejecutando otra version del proyecto. |
| El frontend no carga datos en desarrollo | El servidor no esta corriendo en el puerto 3000, o el proxy de `client/vite.config.js` no coincide con el puerto del servidor. |
| "Faltan permisos" | Tu usuario no tiene ese permiso. Un `root` o Administrador debe otorgarlo en **Usuarios → Roles**. |
| La impresora termica no imprime | Verifica la IP y el puerto 9100 en *Configuracion → Impresion termica*, y que la impresora este en la misma red. Usa la opcion *Papel* como alternativa. |
| Se borro la base de datos | Se guarda en `%APPDATA%\POSVentas`. No borres esa carpeta. |
| Cambie el puerto y no responde | Recuerda: `PORT=8080` cambia el puerto del servidor; actualiza tambien el proxy de `client/vite.config.js` en desarrollo. |

---

## 11. Compilar y publicar

```bash
# Compilar el frontend
cd client && npm run build

# Inicializar el repositorio
git init -b main
git add -A
git commit -m "mi mensaje"
git remote add origin https://github.com/Rayber18black/sistema-de-ventas-rayber.git
git push -u origin main
```

Lo que **nunca** se sube al repositorio (ya esta en `.gitignore`):

- `node_modules/`
- `server/data/` y cualquier `*.db` (los datos reales del negocio)
- `secret.key`, `.env`
- `client/dist/` e `instalador/dist/` (se regeneran al compilar)

---

## 12. Licencia

Uso interno. Modificalo libremente segun necesites.

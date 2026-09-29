# Sistema de Ventas Comercial (POS) — Fase 5

Sistema de **punto de venta** genérico para cualquier establecimiento, con instalador `.exe`.
Web local (Node.js + React), base de datos **SQLite**, funcional **offline** y multi-dispositivo
(PC, tablet y móvil por navegador en la red local).

> Vé también: [ESPECIFICACION.md](./ESPECIFICACION.md) con los requisitos completos.

---

## ▶️ Ejecutar en desarrollo

Necesitas **Node.js 24** o superior.

```bash
# 1) Servidor (puerto 3000)
cd server
npm install
npm start

# 2) Frontend (puerto 5173)
cd client
npm install
npm run dev
```

- Abre http://localhost:5173
- **Credenciales por defecto:** usuario `root` / contraseña `root123`
  (cámbiala después del primer ingreso en el menú de usuario).

> Si solo ejecutas el servidor (npm start), se sirve también la app compilada
> (`client/dist`) en http://localhost:3000.

## 🔨 Generar el `.exe` (portable, un solo archivo)

```bash
cd instalador
npm install
npm run build
```

Resultado en `instalador/dist/`:
- `POSVentas.exe` — binario único (Node empaquetado con el servidor, tecnología SEA).
- `www/` — interfaz web que debe estar junto al .exe.
- `INICIAR.bat` — abre el sistema.

La base de datos se guarda en `%APPDATA%\POSVentas`.

## 📦 Generar el INSTALADOR (setup.exe)

1. Instala **Inno Setup 6** (https://jrsoftware.org/isdl.php).
2. Compila `instalador/plantilla-instalador.iss` desde la carpeta `instalador/dist/`.
3. Entrega `POSVentas-Setup.exe` a tus clientes; instala servicio, acceso directo
   y desinstalador.

## 🧱 Estructura

```
server/       API REST (Express) + SQLite + JWT
  src/        db, seed, rutas (auth, users, products, sales, cash, settings, dashboard, reports,
              customers, expenses, purchases, quotes, branches, print, refunds, telegram)
client/       Frontend React (Vite) — POS, dashboard, productos, caja, clientes, reportes, etc.
instalador/   Empaquetado .exe (esbuild + SEA + postject) y plantilla Inno Setup
```

## 🤖 Bots de Telegram (Fase 2, ampliada en Fase 5)

En **Configuración → Bots de Telegram** (activando el módulo *Bots de Telegram*) se administran
**varios bots con acciones separadas según su tipo**:

| Tipo | Acciones |
| --- | --- |
| **Cliente** | consultas de precio, apartados, compras a distancia, confirmación de pago, promociones |
| **Dueño** | aprobar/cancelar pedidos, resolver devoluciones, reportes diarios, stock bajo, comunicados |
| **Vendedor** | avisos de pedidos/entregas, comunicados del dueño y notificaciones |

1. Crea cada bot con **@BotFather** en Telegram y pega su **token** en *Configuración → Bots de Telegram*
   (al guardar se comprueba con Telegram y se captura el `@usuario` para el **QR**).
2. Desde tu Telegram, escribe a tu bot y regístrate:
   `/registrar CODIGO TuNombre TuTelefono` (clave de *Dueño* o de *Vendedor* según corresponda).
3. Cada bot muestra su **QR** (enlace directo `t.me/<usuario>`) para que los clientes lo escaneen.

**Clientes** pueden usar el bot tipo *cliente* sin registrarse:
- `/precio P001` — precio y stock por código, id o nombre.
- `/apartar P001 2 Nombre Telefono` — apartado (aviso al dueño/vendedores).
- `/comprar P001 1 Retira Telefono` — pedido con pago a distancia.
- `/pague RO-000001` — el cliente confirma que ya pagó.
- `/promos` — promociones vigentes.

**Dueño:**
- `/pagar RO-000001` — verifica el pago y crea la venta (se marca como *venta a distancia*).
- `/cancelar RO-000001` — cancela el pedido.
- `/aprobar ID` y `/rechazar ID` — aprueba/rechaza devoluciones.
- `/reporte` (incluye ventas de bot), `/stock`, `/comunicado Texto`, `/chats`.
- Reporte diario a la hora configurada y **alertas de stock bajo**.

**Promociones (solo Root)** — *Configuración → Promociones*: envío masivo a los clientes que hayan
interactuado con un bot y tengan **teléfono** registrado (se enlaza automáticamente al usar
`/comprar`, `/apartar` o `/pague`). El mensaje admite `{nombre}` para personalizar.

**Devoluciones**: el cajero inicia la devolución en *Ventas → Devoluciones*; queda **PENDIENTE** hasta que el dueño la aprueba (desde el bot o desde la app con permiso). Al aprobarse se repone el inventario y queda registro de nota de crédito.

## ✅ Funciones

- Login por usuario y **permisos por rol** (Root, Administrador, Gerente, Vendedor, Inventario + roles a medida).
- Productos con código de barras, imagen, categorías, precios (minorista/mayorista/especial), impuestos, stock mín/máx.
- Inventario con movimientos (entradas/salidas/ajustes/devoluciones) y **kardex**.
- **Venta en el POS** con múltiples métodos de pago simultáneos, descuento, clientes, folio automático y ticket imprimible.
- **Caja**: apertura/cierre por turno, movimientos de efectivo y arqueo.
- **Reportes** por periodo/producto/vendedor, métodos de pago e inventario; exportación CSV.
- **Bot de Telegram** para clientes (consulta, apartados, pedidos remotos) y para el dueño (aprobación de devoluciones, reportes, alertas, comunicación con vendedores).
- Configuración del negocio, moneda base (USD, BOB, VES, PEN…), módulos on/off y métodos de pago (solo root).
- **Multisucursal**: ventas/caja/gastos/órdenes por sucursal (stock compartido).
- **Créditos y cobranza**: saldo por cliente, abonos, estado de cuenta y reporte CxC.
- **Impresión térmica** ESC/POS por red (auto-ticket al cobrar, reimpresión y página de prueba).
- **Ganancia**: % de margen por producto y ganancia potencial del inventario, ganancia realizada del día en el Dashboard y por periodo en Reportes.
- **Variarios bots de Telegram** con acciones separadas (clientes/dueño/vendedores), **QR** por bot y **promociones** masivas al teléfono de los clientes (solo Root).
- **QR de acceso a la red local** (IP+puerto) para abrir el sistema desde el celular.
- **Cédula/RIF** en clientes y **alta rápida de cliente desde el POS**.
- Estadísticas interactivas (barras/donut), toasts a la izquierda y sin scroll accidental de la rueda en números.

## 🧾 Fase 3 (cotizaciones, compras, gastos y multimoneda)

- **Cotizaciones** (`Ventas → Cotizaciones` o menú *Cotizaciones*): presupuestos para clientes con
  estado (PENDIENTE → CONVERTIDA/CANCELADA) y botón **Convertir en venta**.
- **Compras** (*Compras*): *Sugerencia de reabastecimiento* calculada con stock mínimo/máximo,
  órdenes de compra con proveedores, y **Recibir** que entra el stock y actualiza el costo.
- **Gastos** (*Gastos*): caja chica y gastos con categorías, filtros por fecha/tipo y total del periodo.
- **Importar/Exportar CSV** en *Productos*: sube tu listado (crea o actualiza por código) o descárgalo.
- **Multimoneda** (*Configuración → Multimoneda*): activa el módulo y configura monedas secundarias
  (código, símbolo, tipo de cambio); el POS muestra el equivalente aproximado bajo el total.

## 🏬 Fase 4 (multisucursal, créditos y cobranza, impresión térmica)

- **Multisucursal** (*Configuración → Sucursales*): crea/edita/desactiva sucursales. Un selector en la
  barra superior fija la sucursal activa; las **ventas, caja, gastos y órdenes de compra** quedan
  registrados por sucursal y cada lista/filtro permite ver por sucursal. El stock (bodega) es único
  para toda la instalación, según la especificación.
- **Créditos y cobranza (CxC)**: al vender con método *crédito* se registra saldo a favor del negocio
  por cliente. En *Clientes* hay botón **Cobrar** (abono por monto/método/nota) y un detalle con
  historial y **estado de cuenta** (monto y saldo acumulado). El *Dashboard* muestra el total por cobrar
  y *Reportes* incluye la sección **Cuentas por cobrar** (deudores con teléfono, saldo, límite y última venta).
- **Impresión térmica ESC/POS** (*Configuración → Impresión térmica*): activa el módulo y configura la
  dirección IP-puerto raw (9100) y el ancho de papel (58/80 mm). Tras cobrar en el POS el ticket se
  imprime automáticamente; también hay botón **Térmica** en el historial de ventas, y una **página de
  prueba** en la configuración. Si la impresora no es de red, usa la opción *Papel* del ticket o un
  emulador de puerto 9100.

## ✨ Fase 5 (bot múltiple, ganancias, QR, interfaz minimalista)

- **Bot de Telegram múltiple** (*Configuración → Bots de Telegram*): varios bots con papeles
  separados (*cliente*, *owner*, *seller*), cada uno con su token, estado en vivo y **QR** de enlace
  (`t.me/<usuario>`). El bot de la Fase 2 se migra automáticamente como bot *cliente*.
- **Acciones separadas**: los comandos de clientes (`/precio`, `/apartar`, `/comprar`, `/pague`,
  `/promos`) solo responden en bots de tipo cliente; los de dueño/vendedores están restringidos a
  chats autenticados con sus claves, evitando confusiones entre botas.
- **Promociones (solo Root)**: permiso nuevo `marketing.promos`. *Configuración → Promociones*
  envía un mensaje a todos los clientes enlazados por **teléfono** con un bot; guarda historial
  (título, fecha, alcanzados). Mensaje personalizable con `{nombre}`.
- **Ganancias**: margen `(precio−costo)/precio` por producto y por lista de precio en *Productos*;
  ganancia potencial por producto y total del inventario; **ganancia realizada** (ventas) en
  *Dashboard* (día) y *Reportes* (periodo).
- **Ventas a distancia**: cada venta creada desde el bot queda marcada `source=BOT`; el *Dashboard*
  y *Reportes* muestran conteo/total, y *Reportes* incluye pedidos en seguimiento.
- **QR de acceso**: *Configuración → Acceso a distancia* lista las IPs locales y genera el QR de
  `http://IP:puerto` para abrir el sistema desde el móvil en la misma red.
- **Clientes con C.I./RIF** y **alta rápida de cliente en el POS** (botón **+** junto al selector);
  si el teléfono ya existe, se vincula sin duplicar.
- **Moneda base configurable** (*Configuración → Negocio*): selector con monedas comunes
  (USD, EUR, BOB, VES, PEN…) para símbolo y código.
- **Interfaz minimalista**: gráficas SVG propias e interactivas (barras con detalle por clic, donut
  de métodos de pago), toasts abajo a la izquierda, rueda del ratón bloqueada sobre campos
  numéricos, scrollbars finos y tarjetas destacadas para ganancias.

## 🔮 Siguientes fases

- **Fase 6:** (definir según la especificación — ej. bodegas por sucursal, fidelización activa o comercio electrónico).

## ⚠️ Notas

- Para el bot es necesario que este equipo tenga salida a Internet (solo el polling hacia `api.telegram.org`; la venta local sigue siendo offline).
- Los datos de demostración (producto "Arroz 5kg", etc.) se crean automáticamente en la primera ejecución y se pueden eliminar.
- La base de datos se guarda en `%APPDATA%\POSVentas`.
- El nodo backend NO debe exponerse a internet sin protegerse (cambia la contraseña del root y usa solo la red local).
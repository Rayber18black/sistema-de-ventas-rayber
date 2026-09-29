# ESPECIFICACIÓN DEL SISTEMA DE VENTAS COMERCIAL

> Documento de requisitos completo. Todo módulo/función marcado como "configurable"
> podrá ser **activado, desactivado y configurado por el usuario ROOT (dueño)**.

---

## 1. Resumen general

Sistema de **punto de venta (POS) comercial genérico**, aplicable a cualquier tipo de
establecimiento (tienda, restaurante, servicios, mayorista, minorista, etc.).
Se distribuye con un **instalador Windows (.exe)** y funciona en **PC, tablet y móvil**
desde una misma instalación local.

- **Tipo de software:** web local (servidor Node.js + frontend React) accesible por navegador.
- **Base de datos:** SQLite (archivo local, sin servidor extra). Opcional futuro: MySQL/PostgreSQL.
- **Conexión:** funcional **offline**; sincroniza cuando se restablece internet.
- **Licencia:** instalación protegida por **serial/llave de licencia**.
- **Idiomas:** multiidioma (español, inglés, etc.).
- **Moneda:** multimoneda con **tipo de cambio automático**, configurable por root.

---

## 2. Usuarios, roles y permisos

- Usuario **ROOT (dueño)**: configura todo el sistema (rubro, roles, permisos, módulos on/off).
- Roles base: **Vendedor/Cajero**, **Administrador**, **Inventario/Almacén**, **Gerente/Reportes**.
- El root puede **crear roles a medida**.
- **Permisos por rol** (algunos solo ven, otros editan).
- Escalable: de 1 a 15+ usuarios simultáneos, varias cajas en el mismo local.

### Seguridad
- Login por usuario y contraseña (configurable: activación por defecto y bloqueo por inactividad).
- **Bitácora de auditoría** (quién hizo qué y cuándo).
- **Ocultar costos/ganancias por rol** (solo gerente/root).
- **Reimpresión de tickets/comprobantes** (permitida o limitada por el root).
- Respaldos **cifrados** automáticos (local y/o nube, configurable).

---

## 3. Configuración del establecimiento (al instalar / por root)

- **Rubro del negocio** seleccionable por instalación (adaptable vía plantillas).
- **Multiestablecimiento a futuro** y **multisucursal a futuro** (opcional).
- **Multiidioma** y **moneda(s)** con tipo de cambio.
- **Impuestos configurables por país** (IVA, IGV, etc.) y por producto.
- **Métodos de pago** editables por el root (agregar/quitar).
- **Métodos de pago a distancia** para el bot (configurables on/off).

---

## 4. Productos e inventario

### Datos del producto
- Código de barras (con soporte de **escáner**) + código interno **SKU**.
- **Atributos/variantes** configurables (talla, color, sabor, etc.).
- Imagen/foto, categorías y subcategorías, unidad de medida.
- Stock mínimo/máximo, **lotes y vencimientos**.
- Impuesto por producto, listas de precios y costos.

### Precios y descuentos
- **Listas de precios múltiples**: minorista, mayorista, por grupo de cliente, por fecha/promoción.
- Descuentos configurables: por producto, por ticket, promociones, con **tope por cajero**.

### Inventario
- **Descuento automático de stock** en cada venta.
- **Alertas de stock bajo** (pantalla + bot de Telegram).
- **Kardex por producto** (historial de entradas/salidas).
- **Valorización de inventario** configurable (promedio, FIFO).
- **Reabastecimiento sugerido** automático según stock mínimo.
- **Impresión de etiquetas de precios**.
- Una bodega por instalación (varias bodegas a futuro).

---

## 5. Ventas y caja

### Tipos de venta
- Minorista y mayorista; **contado y crédito/cuenta corriente**.
- **Apartados con anticipo** (productos escasos).
- **Venta rápida sin cliente** (Consumidor final).
- **Pago combinado** (efectivo + tarjeta + transferencia + crédito en una misma venta).
- **Ventas suspendidas** (pueden retomarse) — opcional.

### Caja
- **Apertura/cierre de caja por turno** (fondo inicial, cierre por cajero).
- **Movimientos de efectivo** (retiros/ingresos) durante la jornada.
- Cierre de caja en horario configurable por el root con **envío de reporte al bot**.

### Comprobantes
- **Ticket** simple e **impresora térmica** (ESC/POS).
- **Factura/boleta y comprobantes formales configurables por país**.
- **Detalle de venta numerada**: productos vendidos, precios y métodos de pago usados.
- **Cotizaciones/presupuestos** convertibles en venta.
- **Devoluciones y notas de crédito** 📌 (ver flujo especial).

### 📌 Flujo especial de DEVOLUCIONES
1. El cajero inicia la devolución/cambio.
2. Se envía **alerta al bot del dueño**.
3. El dueño **aprueba o rechaza** desde Telegram.
4. Solo tras la aprobación se procesa: **nota de crédito** y **reingreso de stock**.

---

## 6. Clientes y cuentas por cobrar

- **Ficha completa de cliente**: datos, historial, límite de crédito, saldo, estado de cuenta.
- **Venta a crédito** con control de saldos y cuentas por cobrar.
- **Importación de clientes desde Excel** (plantilla).
- Grupos de clientes con precios especiales — opcional.
- Fidelización/puntos — opcional.

---

## 7. Compras y proveedores

- Registro de compras, proveedores y notas de crédito.
- Ingreso de stock desde compras.
- **Órdenes de compra aprobables por el dueño**.
- **Reabastecimiento sugerido**.

---

## 8. Bot de Telegram (configurable on/off por root)

### Para CLIENTES
- **Consulta de precio y disponibilidad** de productos.
- Si **no hay stock** → generar **apartado de pedido**.
- Si **hay stock** → **pago a distancia** (métodos remotos configurados por el root).
- Al venderse vía bot, se envía **alerta al vendedor**: producto vendido, **nombre de quien retira** y su **número de contacto**.

### Para el DUEÑO
- **Alertas de stock bajo**.
- **Envío de ventas/cierre de caja en horario configurable**.
- **Aprobación de devoluciones/cambios**.
- **Comunicación con empleados**.
- Validación de pagos remotos antes de despachar.

---

## 9. Reportes y dashboard

### Dashboard (panel principal)
- Gráficos: ventas del día, productos top, alarmas, **comparativa de periodos**.

### Reportes (exportables a **Excel/PDF**)
- Ventas por periodo, por producto, por cajero.
- Ganancias.
- Inventario y kardex.
- Cuentas por cobrar.
- Impuestos/IVA.
- **Gastos y caja chica** (egresos registrados).

---

## 10. Instalador y distribución

- **Instalador Windows (.exe)** que instala el servidor local, la base de datos y el frontend.
- Asistente de **configuración inicial** (rubro, idioma, moneda, impuestos, root).
- **Activación por serial/licencia**.
- Respaldo automático configurable: **local y/o nube**, cifrado.

---

## 11. Módulos opcionales (todos activables/desactivables por root)

- Modo restaurante (mesas/comandas).
- Multimoneda y tipo de cambio automático.
- Ocultar costos por rol.
- Bloqueo por inactividad.
- Ventas suspendidas.
- Fidelización/puntos.
- Grupos de clientes con precios especiales.
- Varias bodegas y multisucursal a futuro.

---

## 12. Plan de implementación por fases

- **Fase 1 – Núcleo:** estructura del proyecto, base de datos SQLite, usuarios/roles/permisos,
  productos/inventario, ventas y caja, comprobantes, dashboard básico, instalador .exe, licencia/serial.
- **Fase 2 – Bot e integraciones:** bot de Telegram (clientes + dueño), flujo de devoluciones
  con aprobación, pagos a distancia, apartados, alertas.
- **Fase 3 – Gestión avanzada:** cotizaciones/presupuestos, gastos y caja chica, reabastecimiento
  sugerido, órdenes de compra aprobables, importación Excel, multimoneda/tipo de cambio,
  módulos opcionales restantes, multisucursal a futuro.

---

*Documento generado a partir de la encuesta de requisitos. Revisable y ampliable antes de cada fase.*
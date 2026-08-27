# Pagos — Servicios del Hogar (alquiler de conserjes)

Cierra el ciclo del portal de clientes: **ingresar → alquilar → hacer seguimiento
→ calificar → pagar**, más la **administración y parametrización** de los cobros.

Antes de este módulo el portal (`apps/web/app/portal`) ya permitía agendar,
seguir y calificar un servicio, pero no existía nada de dinero: ni cuenta de
cobro, ni forma de pago, ni cartera. Eso es lo que se agregó.

## Base de datos

`supabase/migrations/20260827000000_pagos_servicios_hogar.sql` (idempotente).

| Tabla | Para qué |
|---|---|
| `parametros_pago_hogar` | Fila única: IVA, anticipo, plazo de vencimiento, mora, prefijo/consecutivo, canales de aviso, URL del portal y los textos que ve el cliente. |
| `metodos_pago_hogar` | Catálogo de formas de pago (transferencia, Nequi, Daviplata, efectivo, link de pasarela) con instrucciones, datos de la cuenta y si exigen referencia/comprobante. |
| `cobros_servicio_hogar` | La cuenta de cobro que le llega al cliente. Estados: `BORRADOR → EMITIDO → PARCIAL → PAGADO`, más `ANULADO`. |
| `cobro_items_hogar` | Líneas del cobro (`total` es columna generada). |
| `pagos_hogar` | Pagos aplicados. El cliente los **reporta** (`REPORTADO`), el personal los **verifica** (`VERIFICADO`) o los **rechaza**. |
| `notificaciones_cliente` | Bandeja del portal: así le "llega" el cobro al cliente. |

Automatismos en la base (no en la app):

- `siguiente_numero_cobro()` — consecutivo con el prefijo parametrizado.
- `recalc_cobro_hogar()` — al insertar/actualizar/borrar un pago recalcula
  `pagado`, `saldo` y el estado del cobro. **El saldo nunca se escribe a mano.**
- `avisar_cobro_hogar()` — al pasar el cobro a `EMITIDO` crea el aviso en el
  portal y, si `notificar_email` está activo, encola el correo en
  `correo_saliente` (mismo buzón SMTP del resto del sistema).
- `avisar_pago_hogar()` — avisa al cliente cuando su pago se verifica o rechaza.

El aviso del portal guarda el enlace **relativo** (`/portal/pagos/<id>`) porque
lo navega el router; el del correo lo guarda **absoluto** anteponiendo
`url_portal`, porque el buzón `correo_saliente` tiene como base la app interna.
`lib/email/procesar.ts` respeta los enlaces que ya vienen absolutos.

RLS: el cliente sólo ve **sus** cobros (nunca los borradores), sólo puede
**insertar** pagos con estado `REPORTADO` sobre cobros suyos que estén
`EMITIDO`/`PARCIAL`, y no puede editarlos después. El personal
(`SUPER_ADMIN`, `ADMIN`, `SUPERVISOR`, `COORDINADOR_COMPRAS`) gestiona todo.

Storage: bucket **privado** `comprobantes-pago`, un directorio por cliente
(`<auth.uid>/<cobro_id>/…`). Los comprobantes se abren con URL firmada de 5
minutos, tanto en el portal como en la administración.

Permisos de rol nuevos: `ver_pagos_hogar`, `gestionar_pagos_hogar`,
`parametrizar_pagos_hogar`.

### Estado

**Aplicada** en la base de datos (26/08/2026). Es idempotente, así que puede
re-ejecutarse sin efectos.

### Aplicar la migración

```bash
node scripts/apply-migrations.mjs supabase/migrations/20260827000000_pagos_servicios_hogar.sql
```

## Portal del cliente (`apps/web`)

| Ruta | Qué hace |
|---|---|
| `/portal` | Ahora muestra el saldo pendiente y un acceso directo a *Mis pagos*. |
| `/portal/pagos` | Lista de cuentas de cobro: saldo total, vencidas, por pagar / historial. |
| `/portal/pagos/[id]` | Detalle: ítems, subtotal/IVA/total, formas de pago con sus instrucciones y datos copiables, botón de pago en línea si hay link de pasarela, reporte del pago con comprobante y el historial de pagos. |
| `/portal/notificaciones` | Bandeja de avisos (cobro emitido, pago verificado, pago rechazado). |
| `/portal/servicios` | Cada servicio enlaza su cuenta de cobro y muestra el saldo. |

La barra lateral muestra badges con las cuentas por pagar y los avisos sin leer.

`POST /api/portal/pagos` valida en el servidor (service role) que el cobro sea
del cliente, esté cobrable, el valor no supere el saldo, y que se cumplan las
exigencias del método (referencia / comprobante) antes de insertar el pago.

## Administración (`apps/inventario`)

| Ruta | Qué hace |
|---|---|
| `/servicios-hogar` | El resumen incluye ahora *Cartera y pagos*: por cobrar, vencidas, por verificar y recaudado. |
| `/servicios-hogar/pagos` | Tres pestañas: **Cuentas de cobro** (filtro por estado y búsqueda, emitir, anular, registrar pago manual, guardar link de pasarela), **Por verificar** (aprobar/rechazar los pagos reportados, con el comprobante a la vista) y **Servicios sin cobrar** (solicitudes confirmadas/completadas sin cuenta, con un clic para cobrarlas con los datos y el precio ya precargados). |
| `/servicios-hogar/parametros-pago` | Política de cobro (impuestos, plazos, anticipos, numeración, avisos, textos) y CRUD de formas de pago. |

Todos los totales se calculan en el servidor (`pagos-actions.ts`) a partir de la
parametrización; el navegador nunca decide el IVA ni el vencimiento.

## Pendiente / siguientes pasos

- **Pasarela real.** Hoy el pago en línea es un *link* que se pega en la cuenta
  de cobro (o en la forma de pago tipo `PASARELA`). Integrar una pasarela con
  webhook implica: crear el pago con `origen = 'PASARELA'` y estado
  `VERIFICADO` desde el webhook, y guardar la referencia de la transacción.
  El resto (saldo, estados, avisos) ya funciona solo.
- **Anticipo automático.** `requiere_anticipo` / `anticipo_porcentaje` están
  parametrizados y visibles, pero la generación automática del cobro de anticipo
  al confirmar una solicitud todavía se hace a mano desde *Servicios sin cobrar*.
- **Recargo por mora.** El porcentaje está parametrizado; falta el proceso que
  genere el cobro `ADICIONAL` sobre las cuentas vencidas.

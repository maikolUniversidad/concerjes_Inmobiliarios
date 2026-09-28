# Módulo de Compras — bases

Estado: **propuesta** (2026-09-27). Nada de esto está migrado todavía.

## 1. Qué existe hoy

| Pieza | Dónde | Qué hace | Qué le falta |
|---|---|---|---|
| Órdenes de compra | `ordenes_compra`, `oc_items`, `oc_eventos` · `/ordenes-compra` | OC por proveedor, estados BORRADOR → APROBADA → ENVIADA → PARCIAL/COMPLETA, recepción suma stock con `registrar_movimiento('ENTRADA')` | Sin sede/contrato/bodega, sin IVA ni descuentos; la recepción pisa un acumulado (no hay registro por entrega); no llena `movimientos.oc_id`; un mismo permiso crea, aprueba y recibe |
| Proveedores | `proveedores` · `/proveedores` | CRUD básico | Sin condiciones de pago, datos bancarios, categorías ni calificación |
| Comparador de precios | `precios_proveedor` · `/comparador-precios` | Precio vigente por producto × proveedor; crea una OC de 1 ítem | Sin histórico de precios ni cotizaciones |
| Recomendación de compra | `v_recomendacion_compra`, `v_stock_proyectado` · `/aprovisionamiento` | `recomendado = mínimo + comprometido (órdenes de insumo en curso) − stock − OC pendiente` | No elige proveedor; no convierte recomendaciones en OC en bloque; la tabla vieja `aprovisionamiento` está fija en 2026-06 |

Conclusión: la **OC y la recepción ya funcionan**; lo que falta es lo de antes (de dónde nace la compra y quién la autoriza) y lo de después (qué llegó, cuándo y contra qué factura).

## 2. Flujo propuesto

```
Necesidad ──► Solicitud de compra ──► Cotización(es) ──► Orden de compra ──► Recepción(es) ──► Factura proveedor
 (faltantes,    (qué, cuánto, para     (opcional: 1..n     (aprobación por     (por entrega,        (cruce OC ×
  mínimos,       qué sede/contrato)     proveedores)         monto)              parcial o total)     recepción × factura)
  manual)
```

### Fuentes de la necesidad
1. **Recomendación automática** (`v_recomendacion_compra`) — ya existe.
2. **Faltantes de despacho**: lo que queda en las **órdenes pendientes** (ver `ordenes_insumo.orden_origen_id`) cuando la causa es falta de stock. Es la conexión natural entre despacho y compras.
3. **Manual** (compras puntuales, activos, servicios).

## 3. Modelo de datos (nuevo)

| Tabla | Para qué | Campos clave |
|---|---|---|
| `solicitudes_compra` | Requisición: nace la necesidad | numero `SC-YYYYMM-NNN`, origen (`RECOMENDACION` / `PENDIENTE_DESPACHO` / `MANUAL`), sede_id, contrato_id, prioridad, estado, solicitado_por |
| `solicitud_compra_items` | Qué se pide | producto_id, cantidad, orden_insumo_id (si viene de un pendiente), justificación |
| `cotizaciones` + `cotizacion_items` | Precio ofrecido por cada proveedor para una solicitud | proveedor_id, vigencia, precio_unit, plazo_entrega_dias, adjunto |
| `oc_recepciones` + `oc_recepcion_items` | **Cada entrega** del proveedor (reemplaza el acumulado) | fecha, remisión del proveedor, bodega_id/ubicacion_id, recibido_por, cantidad, cantidad_rechazada, motivo |
| `facturas_proveedor` + items | Cuentas por pagar y cruce a tres vías | proveedor_id, numero, fecha, vence, subtotal, iva, total, estado (`RADICADA` / `CONCILIADA` / `PAGADA`) |
| `precios_proveedor_historial` | Histórico de precios (trigger al cambiar `precios_proveedor`) | producto, proveedor, precio, desde, hasta |
| `compras_niveles_aprobacion` | Quién aprueba según el monto | monto_desde, monto_hasta, permiso requerido |

Cambios a lo existente:
- `ordenes_compra`: + `solicitud_id`, `cotizacion_id`, `sede_id`, `contrato_id`, `bodega_destino_id`, `iva`, `descuento`, `condicion_pago`.
- `oc_items`: + `iva_pct`, `descuento_pct`; `cantidad_rec` pasa a ser **calculada** desde `oc_recepcion_items`.
- `proveedores`: + `direccion`, `condicion_pago_dias`, `banco`, `cuenta`, `categorias`, `calificacion`.
- La recepción debe llenar `movimientos.oc_id` y `p_ubicacion`.

## 4. Permisos (separación de funciones)

Hoy `crear_ordenes_compra` lo hace todo. Propuesta, en `/roles` (única fuente de verdad):

| Permiso | Quién típicamente |
|---|---|
| `solicitar_compras` | Coordinadores, bodega |
| `cotizar_compras` / `crear_ordenes_compra` | Compras |
| `aprobar_ordenes_compra` (+ tope por nivel de monto) | Jefatura / Gerencia |
| `recibir_ordenes_compra` | Bodega |
| `registrar_facturas_proveedor` | Contabilidad |

Regla: quien crea una OC no puede aprobarla.

## 5. Fases

1. **Recepciones por entrega** (`oc_recepciones`), `movimientos.oc_id`, y separación de permisos crear/aprobar/recibir. *Arregla lo que hoy ya se usa.*
2. **Solicitud de compra** + botón «Generar solicitud» desde Aprovisionamiento y desde las órdenes pendientes por falta de stock; conversión de solicitud → OC agrupando por proveedor con el precio del comparador.
3. **Cotizaciones** y aprobación por niveles de monto; histórico de precios.
4. **Facturas de proveedor** y cruce OC × recepción × factura; indicadores de proveedor (cumplimiento de plazo y de cantidad).
5. Presupuesto por contrato/sede (requiere que el módulo de contratos llene `contrato_id`).

## 6. Decisiones abiertas

- ¿Toda compra pasa por solicitud, o compras puede crear la OC directo (como hoy)?
- Topes de aprobación por monto: ¿cuáles y quién?
- ¿Se manejan varias bodegas de destino o todo entra a la central?
- ¿Las facturas se registran aquí o viven en el sistema contable?

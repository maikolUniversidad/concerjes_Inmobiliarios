# Módulo de Compras — bases

Estado: **propuesta** (2026-09-27, decisiones medidas contra datos reales el 2026-10-18). Nada de esto está migrado todavía: las cuatro decisiones de la sección 7 esperan respuesta del usuario.

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

## 6. Qué dicen los datos (medición del 2026-10-18)

Antes de decidir, lo que hay hoy en la base de datos. Los valores en pesos son aproximados: se calculan multiplicando las entradas de inventario por el precio de lista del producto, porque las compras reales no están registradas con su valor.

| Medición | Dato |
|---|---|
| Bodegas / ubicaciones registradas | **1 bodega** (Central) y **1 ubicación** (una estantería), para 702 productos |
| Sedes activas a las que se despacha | **194** (197 creadas) |
| Contratos cargados | 1 |
| Órdenes de compra en todo el sistema | **1** (de julio, 2,3 millones, y la creó y aprobó la misma persona) |
| Entradas de mercancía al inventario | **768 líneas**, de las cuales **0 tienen orden de compra asociada** |
| Ritmo de entradas | 250 líneas al mes, repartidas en 11 a 23 días del mes |
| Valor que entra por mes | ago. 287 M · sep. 508 M · oct. 350 M → del orden de **350 a 400 millones al mes** |
| Compras reales (agrupando las entradas por día y proveedor) | **159 en 3 meses ≈ 53 al mes** |
| Proveedores registrados / con compras reales | 32 registrados, pero solo **9 a 11 activos por mes**; los **2 primeros concentran el 57%** del gasto y los 5 primeros el 90% |
| Órdenes de insumo (despacho a sedes) | **495 en 4 meses ≈ 124 al mes**; 447 salen de la Central |
| Faltantes de despacho | 136 de 10.169 ítems quedaron incompletos (**1,3%**); 70 ítems pasaron a orden pendiente |
| Órdenes pendientes creadas | 3 en septiembre, **29 en octubre** (la función es nueva y está despegando) |
| Lo que el sistema recomienda comprar hoy | 109 productos, 68.263 unidades, **264 millones**, de 10 proveedores |
| Quién puede tocar una orden de compra hoy | **4 personas**: 2 Coordinador de Compras + 2 Super Administrador |
| Roles creados pero **sin ningún usuario asignado** | Gerencia, Administrador, Supervisor de Conserjería |
| Bodeguero (4 usuarios) | registra las entradas, pero tiene `ver_ordenes_compra` en **false**: ingresa mercancía sin poder ver contra qué orden |
| Cobertura del comparador de precios | 256 productos × **3 proveedores** (de 498 productos activos) |
| Facturas de proveedor en la base | **ninguna tabla**; las de facturación que existen son del portal de clientes |

### Tamaño de las compras (159 compras de los últimos 3 meses)

| Rango | Compras | % del total |
|---|---|---|
| Menos de 1 millón | 82 | 52% |
| 1 a 5 millones | 43 | 27% |
| 5 a 20 millones | 24 | 15% |
| 20 a 50 millones | 7 | 4% |
| Más de 50 millones | 3 | 2% |

Mediana 930 mil · tres de cada cuatro por debajo de 4,2 millones · nueve de cada diez por debajo de 15,7 millones.

**La conclusión que atraviesa las cuatro decisiones:** el módulo de compras hoy no se usa. Entran 350 a 400 millones al mes a la bodega y ninguna de esas entradas tiene una orden de compra detrás. El problema de hoy no es que falte control antes de comprar, es que **la compra no queda registrada en ninguna parte**. Eso cambia el orden de lo que conviene hacer.

Nota aparte: la pantalla de `/aprovisionamiento` todavía muestra el período «JUNIO 2026» fijo en el código; la vista en vivo (`v_recomendacion_compra`) sí está al día y es la que da los 264 millones recomendados. Vale corregirlo junto con la fase 1.

## 7. Decisiones

Cada una lleva la recomendación y en qué se apoya. **La decisión es del usuario**: lo marcado con ⏳ sigue esperando respuesta y nada se construye hasta entonces.

### 7.1 ¿Toda compra pasa por solicitud, o compras puede crear la orden directo?

**Recomendación: que compras siga creando la orden directo, y que lo obligatorio sea otra cosa — que ninguna mercancía entre a la bodega sin orden de compra.**

Por qué. Hoy entran 250 líneas de mercancía al mes y ninguna tiene orden detrás. Si el primer paso que pedimos es uno nuevo (la solicitud) antes de uno que todavía nadie usa (la orden), lo más probable es que compras y bodega sigan trabajando por WhatsApp y Excel, y el sistema termine con peores datos que hoy. Primero hay que cerrar la puerta de atrás; el control previo viene después, cuando el hábito ya exista.

Qué pasa con cada opción:

- **Solicitud obligatoria desde ya**: se gana saber quién pidió cada cosa, pero se le pide a un equipo de 2 personas de compras que llene dos documentos para cada una de las 53 compras del mes. El riesgo no es que se queje: es que deje de usar el sistema y nadie se dé cuenta, porque nadie reporta que no está usando una pantalla.
- **Orden directo, solicitud opcional (recomendada)**: se pierde por un tiempo la trazabilidad de «quién pidió esto», que es justo lo que la solicitud resuelve. Pero el campo que la une a la orden se deja vacío y permitido, y el día que se quiera volver obligatoria es cambiar un parámetro, no rehacer el módulo.

Qué cuesta equivocarse: poco de un lado, mucho del otro. Volver la solicitud obligatoria más adelante cuesta un interruptor. Recuperar a un equipo que ya abandonó el sistema cuesta meses.

Lo reversible: todo. El campo de solicitud nace opcional y se endurece cuando se quiera.

**Excepción que sí conviene dejar automática:** las órdenes pendientes por falta de stock (29 solo en octubre) deberían generar su solicitud de compra solas. Ahí el sistema ya sabe qué producto, cuánto, para qué sede y quién lo pidió — no hay nada que escribir, así que no hay fricción. Es la única puerta donde la solicitud sale gratis.

⏳ **Pendiente de responder:** ¿se acepta que en la fase 1 la orden siga naciendo directo y que lo obligatorio sea la orden antes de la entrada?

### 7.2 Topes de aprobación por monto: ¿cuáles y quién aprueba?

**Recomendación: dos niveles, no tres. Hasta 5 millones aprueba Coordinador de Compras; por encima de 5 millones aprueba Gerencia. Y una regla sin excepción: quien crea la orden no la aprueba.**

Por qué ese corte. Con las 159 compras medidas, el tope de 5 millones deja el 79% de las compras (125 de 159) resolviéndose dentro de compras, y manda a Gerencia 34 compras en 3 meses — unas **11 al mes** — que son las que concentran cerca del 90% de la plata. Es un volumen que una gerencia puede revisar de verdad.

Qué pasa si se mueve el corte:

- **Tope bajo (1 millón)**: Gerencia tendría que aprobar 77 compras en 3 meses, 26 al mes. A ese ritmo la aprobación se vuelve un sello de caucho: se firma sin mirar y el control deja de existir, con el costo de que todos creen que existe.
- **Tope alto (50 millones)**: solo 3 compras en 3 meses pasarían por Gerencia. Se podrían comprar 7 órdenes de entre 20 y 50 millones sin que nadie por fuera de compras las mire.
- **Tres niveles** (por ejemplo 5 / 20 / 50 millones): el nivel más alto tendría 3 casos en 3 meses. No vale la complejidad de un escalón que se usa una vez al mes.

**Advertencia importante antes de activar esto:** hoy solo 4 personas pueden tocar una orden de compra, y el rol **Gerencia está creado pero vacío — no tiene ningún usuario**. Si se activan los topes tal cual, toda compra de más de 5 millones se queda trabada sin nadie que pueda aprobarla. Hay que asignarle ese rol a alguien antes, o el tope es una puerta sin llave.

La regla de «quien crea no aprueba» vale cerrarla ya, aparte del monto: la única orden que existe en el sistema la creó y la aprobó la misma persona. Con 2 personas en compras, en la práctica significa que una crea y la otra aprueba, lo cual funciona siempre que no se vayan las dos al mismo tiempo — por eso conviene que Gerencia también pueda aprobar los montos bajos como respaldo, no solo los altos.

Qué cuesta equivocarse: poco. Los topes viven en una tabla de parámetros y se editan desde la pantalla, sin migración. Lo único difícil de deshacer es haber acostumbrado a la gente a un control que no se ejercía.

⏳ **Pendiente de responder:** (a) ¿se acepta el corte en 5 millones? (b) ¿quién queda con el rol Gerencia, y debería poder aprobar también los montos bajos cuando compras esté incompleta?

### 7.3 ¿Varias bodegas de destino o todo entra a la central?

**Recomendación: todo entra a la Central. No construir bodegas múltiples, pero sí dejar el campo puesto y pedir la ubicación en la recepción.**

Por qué. Hay **una sola bodega** registrada y 447 de las 495 órdenes de insumo salen de ella. El flujo real es claro: la compra llega a la Central y de ahí se reparte a las 194 sedes. Construir multi-bodega hoy es trabajo que nadie va a usar.

Lo que sí vale la pena y es un hueco real: esa bodega única tiene **una sola ubicación registrada para 702 productos**. El problema no es de bodegas, es de ubicaciones. Si la recepción pregunta a qué estantería entró lo que llegó, el arqueo y la búsqueda física mejoran de inmediato, sin tocar nada del modelo de bodegas.

Qué pasa con cada opción:

- **Multi-bodega ahora**: semanas de trabajo en pantallas de traslado entre bodegas, stock por bodega y reservas por bodega, para una sola bodega real. Además complica las reservas de stock, que hoy funcionan sobre un stock único.
- **Solo Central, con el campo puesto (recomendada)**: una columna con la Central por defecto. Si mañana se abre una segunda bodega, se llena el campo en las órdenes nuevas y las viejas ya tienen su valor correcto. Si no se deja el campo, abrir la segunda bodega obliga a corregir a mano todo el historial de compras — y ese es el momento en que más duele.

Qué cuesta equivocarse: dejar el campo cuesta una columna. No dejarlo cuesta una migración sobre datos históricos de compras.

⏳ **Pendiente de responder:** en las observaciones de las entradas aparecen «ingresa desde producción», «de la bodega de maquinaria» y «de lo que se reembasó». ¿Esos son sitios físicos distintos de la Central? Si lo son, conviene registrarlos como bodegas aunque las compras sigan entrando a la Central — no para repartir stock, sino para que lo que viene de producción o de reembasado no se confunda con una compra a proveedor. Hoy ambas cosas son la misma «entrada» y eso distorsiona cualquier medición de gasto.

### 7.4 ¿Las facturas se registran aquí o viven en el sistema contable?

**Recomendación: la factura vive en el contable. Aquí solo se guardan número, fecha, valor y el PDF, para poder cruzar lo facturado contra lo recibido. No construir cuentas por pagar.**

Por qué. Lo único que el inventario necesita saber de una factura es si **lo que facturaron es lo que llegó**. Para eso bastan cuatro datos. Lo que no necesita —estados de pago, vencimientos, retenciones, causación— es contabilidad, y duplicarla crea dos verdades sobre la misma plata: el día que contabilidad corrija o anule una factura, este sistema queda mintiendo y nadie sabe cuál de los dos creer.

Qué pasa con cada opción:

- **Cuentas por pagar completas aquí**: es la pieza más cara de toda la propuesta y la que más rápido se desincroniza. Y no se deshace barato, porque en cuanto la gente empieza a consultar el saldo de proveedores en esta pantalla, quitarla es quitarle una herramienta.
- **Solo el cruce (recomendada)**: con 9 a 11 proveedores activos y 53 compras al mes es un registro liviano, y resuelve el caso que de verdad cuesta dinero: «me facturaron 100 y recibí 95». Eso solo requiere el valor facturado contra las recepciones.

Qué cuesta equivocarse: empezar liviano y crecer después es fácil, se agregan columnas. Empezar completo y tener que decirle a contabilidad «ignore lo que dice el sistema» es un problema de confianza que no se arregla con código.

Nota: para que el cruce sirva hay que registrar las recepciones por entrega (fase 1). Hoy la recepción pisa un acumulado, así que no hay con qué comparar la factura.

⏳ **Pendiente de responder:** ¿cuál es el sistema contable y permite consultar o exportar las facturas de proveedor? Si lo permite, lo mejor es traer el número de factura de allá en vez de escribirlo dos veces. Si no, se digita a mano aquí y es un dato más por compra.

## 8. Lo que estas decisiones cambian del plan

Si se aceptan las recomendaciones, el orden de las fases de la sección 5 se mantiene, pero con un énfasis distinto: **la fase 1 deja de ser solo «arreglar la recepción» y pasa a ser «hacer que toda entrada tenga orden de compra detrás»**, que es lo que la medición muestra como el hueco real. Las tablas de solicitud, cotización y factura de la sección 3 siguen siendo las mismas; lo que cambia es que `solicitud_id` nace opcional, `bodega_destino_id` nace con la Central por defecto, y la tabla de facturas de proveedor se reduce a los datos del cruce.

El plan detallado de la fase 1 se escribe cuando las cuatro decisiones estén respondidas.

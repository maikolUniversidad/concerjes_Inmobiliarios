# Módulo de Compras — bases

Estado: **fase 1 construida y aplicada el 2026-10-18**; decisiones cerradas ese mismo día sobre la propuesta del 2026-09-27. Las cuatro decisiones de la sección 7 están aceptadas, el plan de la fase 1 está en la sección 9 y lo que quedó construido está en la 10. Quedan tres preguntas de detalle y un paso previo (ver 9.0); las fases 2 a 5 siguen sin empezar.

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

Las cuatro quedaron **aceptadas el 2026-10-18**. Cada una conserva la recomendación y en qué se apoya; lo marcado con ⏳ son las preguntas de detalle que siguen esperando respuesta, recogidas en la sección 9.0.

### 7.1 ¿Toda compra pasa por solicitud, o compras puede crear la orden directo?

**Recomendación: que compras siga creando la orden directo, y que lo obligatorio sea otra cosa — que ninguna mercancía entre a la bodega sin orden de compra.**

Por qué. Hoy entran 250 líneas de mercancía al mes y ninguna tiene orden detrás. Si el primer paso que pedimos es uno nuevo (la solicitud) antes de uno que todavía nadie usa (la orden), lo más probable es que compras y bodega sigan trabajando por WhatsApp y Excel, y el sistema termine con peores datos que hoy. Primero hay que cerrar la puerta de atrás; el control previo viene después, cuando el hábito ya exista.

Qué pasa con cada opción:

- **Solicitud obligatoria desde ya**: se gana saber quién pidió cada cosa, pero se le pide a un equipo de 2 personas de compras que llene dos documentos para cada una de las 53 compras del mes. El riesgo no es que se queje: es que deje de usar el sistema y nadie se dé cuenta, porque nadie reporta que no está usando una pantalla.
- **Orden directo, solicitud opcional (recomendada)**: se pierde por un tiempo la trazabilidad de «quién pidió esto», que es justo lo que la solicitud resuelve. Pero el campo que la une a la orden se deja vacío y permitido, y el día que se quiera volver obligatoria es cambiar un parámetro, no rehacer el módulo.

Qué cuesta equivocarse: poco de un lado, mucho del otro. Volver la solicitud obligatoria más adelante cuesta un interruptor. Recuperar a un equipo que ya abandonó el sistema cuesta meses.

Lo reversible: todo. El campo de solicitud nace opcional y se endurece cuando se quiera.

**Excepción que sí conviene dejar automática:** las órdenes pendientes por falta de stock (29 solo en octubre) deberían generar su solicitud de compra solas. Ahí el sistema ya sabe qué producto, cuánto, para qué sede y quién lo pidió — no hay nada que escribir, así que no hay fricción. Es la única puerta donde la solicitud sale gratis.

✅ **Aceptada el 2026-10-18.** En la fase 1 la orden sigue naciendo directo, y lo obligatorio pasa a ser la orden antes de la entrada. La solicitud nace opcional, y automática solo para las órdenes pendientes por falta de stock.

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

✅ **Aceptada el 2026-10-18** en cuanto al corte: dos niveles, con el límite en 5 millones.

⏳ **Pendiente de responder:** quién queda con el rol Gerencia (hoy está vacío), y si debería poder aprobar también los montos bajos como respaldo cuando compras esté incompleta. Hasta que ese rol tenga un usuario, los topes quedan construidos pero apagados.

### 7.3 ¿Varias bodegas de destino o todo entra a la central?

**Recomendación: todo entra a la Central. No construir bodegas múltiples, pero sí dejar el campo puesto y pedir la ubicación en la recepción.**

Por qué. Hay **una sola bodega** registrada y 447 de las 495 órdenes de insumo salen de ella. El flujo real es claro: la compra llega a la Central y de ahí se reparte a las 194 sedes. Construir multi-bodega hoy es trabajo que nadie va a usar.

Lo que sí vale la pena y es un hueco real: esa bodega única tiene **una sola ubicación registrada para 702 productos**. El problema no es de bodegas, es de ubicaciones. Si la recepción pregunta a qué estantería entró lo que llegó, el arqueo y la búsqueda física mejoran de inmediato, sin tocar nada del modelo de bodegas.

Qué pasa con cada opción:

- **Multi-bodega ahora**: semanas de trabajo en pantallas de traslado entre bodegas, stock por bodega y reservas por bodega, para una sola bodega real. Además complica las reservas de stock, que hoy funcionan sobre un stock único.
- **Solo Central, con el campo puesto (recomendada)**: una columna con la Central por defecto. Si mañana se abre una segunda bodega, se llena el campo en las órdenes nuevas y las viejas ya tienen su valor correcto. Si no se deja el campo, abrir la segunda bodega obliga a corregir a mano todo el historial de compras — y ese es el momento en que más duele.

✅ **Aceptada el 2026-10-18.** Todo entra a la Central; no se construye multi-bodega, pero el campo de bodega de destino queda puesto con la Central por defecto y la recepción pide la ubicación.

⏳ **Pendiente de responder:** en las observaciones de las entradas aparecen «ingresa desde producción», «de la bodega de maquinaria» y «de lo que se reembasó». ¿Esos son sitios físicos distintos de la Central? Si lo son, conviene registrarlos como bodegas aunque las compras sigan entrando a la Central — no para repartir stock, sino para que lo que viene de producción o de reembasado no se confunda con una compra a proveedor. Hoy ambas cosas son la misma «entrada», eso distorsiona cualquier medición de gasto, y es justo la distinción que la fase 1 necesita para poder exigir la orden de compra.

### 7.4 ¿Las facturas se registran aquí o viven en el sistema contable?

**Recomendación: la factura vive en el contable. Aquí solo se guardan número, fecha, valor y el PDF, para poder cruzar lo facturado contra lo recibido. No construir cuentas por pagar.**

Por qué. Lo único que el inventario necesita saber de una factura es si **lo que facturaron es lo que llegó**. Para eso bastan cuatro datos. Lo que no necesita —estados de pago, vencimientos, retenciones, causación— es contabilidad, y duplicarla crea dos verdades sobre la misma plata: el día que contabilidad corrija o anule una factura, este sistema queda mintiendo y nadie sabe cuál de los dos creer.

Qué pasa con cada opción:

- **Cuentas por pagar completas aquí**: es la pieza más cara de toda la propuesta y la que más rápido se desincroniza. Y no se deshace barato, porque en cuanto la gente empieza a consultar el saldo de proveedores en esta pantalla, quitarla es quitarle una herramienta.
- **Solo el cruce (recomendada)**: con 9 a 11 proveedores activos y 53 compras al mes es un registro liviano, y resuelve el caso que de verdad cuesta dinero: «me facturaron 100 y recibí 95». Eso solo requiere el valor facturado contra las recepciones.

✅ **Aceptada el 2026-10-18.** La factura vive en el contable; aquí solo número, fecha, valor y el PDF, para el cruce. No se construyen cuentas por pagar.

⏳ **Pendiente de responder:** ¿cuál es el sistema contable y permite consultar o exportar las facturas de proveedor? Si lo permite, lo mejor es traer el número de factura de allá en vez de escribirlo dos veces. Si no, se digita a mano aquí y es un dato más por compra. Esto es de la fase 4, no bloquea la fase 1.

Nota: para que el cruce sirva hay que registrar las recepciones por entrega (fase 1). Hoy la recepción pisa un acumulado, así que no hay con qué comparar la factura.

## 8. Lo que estas decisiones cambian del plan

Si se aceptan las recomendaciones, el orden de las fases de la sección 5 se mantiene, pero con un énfasis distinto: **la fase 1 deja de ser solo «arreglar la recepción» y pasa a ser «hacer que toda entrada tenga orden de compra detrás»**, que es lo que la medición muestra como el hueco real. Las tablas de solicitud, cotización y factura de la sección 3 siguen siendo las mismas; lo que cambia es que `solicitud_id` nace opcional, `bodega_destino_id` nace con la Central por defecto, y la tabla de facturas de proveedor se reduce a los datos del cruce.

El plan detallado de la fase 1 se escribe cuando las cuatro decisiones estén respondidas.

## 9. Plan de la fase 1 (decisiones aceptadas el 2026-10-18)

Las cuatro recomendaciones de la sección 7 quedaron aceptadas. Con eso, la fase 1 ya no es «arreglar la recepción»: es **cerrar la puerta de atrás**, que es donde están los 350–400 millones al mes que hoy entran sin orden de compra.

Nada de esto está construido todavía. Este es el plan, en el orden en que conviene hacerlo.

### 9.0 Lo que hay que resolver antes de empezar

Dos cosas no son de código y bloquean parte de la fase:

1. **Asignarle el rol Gerencia a alguien.** Hoy está creado y vacío. Los topes de aprobación se construyen igual, pero se dejan apagados hasta que exista ese usuario; si se activan antes, toda compra de más de 5 millones queda trabada.
2. **Decir si «producción», «reembasado» y «bodega de maquinaria» son sitios distintos de la Central.** No para repartir stock —eso ya quedó decidido: todo entra a la Central— sino porque la fase 1 necesita distinguir *una compra a proveedor* de *algo que vino de producción*. Si no se distinguen, no se puede exigir orden de compra sin bloquear las entradas internas. Hay una salida razonable sin respuesta (ver 9.2), pero con respuesta queda mejor.

Y una de coordinación: hay otra sesión trabajando en la base en paralelo, así que la migración se aplica cuando esa termine, no antes.

### 9.1 Recepciones por entrega

**El problema hoy.** `registrarRecepcionOC` escribe `oc_items.cantidad_rec` como un acumulado: si llegan 50 y después 30, el campo queda en 80 y no queda rastro de que fueron dos entregas en dos fechas. Sin eso no se puede medir si el proveedor cumple el plazo, ni cruzar una factura contra lo que llegó.

**Qué se construye.**

- `oc_recepciones`: una fila por entrega. Consecutivo dentro de la orden, fecha, número de remisión del proveedor, bodega (Central por defecto), ubicación, quién recibió, observación.
- `oc_recepcion_items`: qué llegó en esa entrega. Ítem de la orden, cantidad recibida, cantidad rechazada y motivo del rechazo.
- `oc_items.cantidad_rec` **se queda** (la usan la pantalla y los reportes) pero deja de escribirse a mano: pasa a mantenerla un trigger que suma las entregas. Así no puede volver a desincronizarse del stock.
- Backfill: si alguna orden traía cantidades recibidas, se le reconstruye una entrega histórica con esos valores. Al aplicarlo resultó que la única orden del sistema tiene 0 recibido, así que no había nada que reconstruir; el paso queda igual porque es idempotente y protege cualquier recepción que se registre antes de desplegar.

**Por qué importa el rechazo.** Es el campo que hoy no existe y que explica la mitad de los descuadres: si llegan 100 y 5 vienen malos, hoy la única opción es registrar 100 (y el stock queda inflado) o registrar 95 (y la orden queda eternamente parcial).

### 9.2 Que la entrada quede amarrada a la orden

**El problema hoy.** 768 entradas, ninguna con orden. Son dos huecos distintos:

- La recepción desde la orden llama a `registrar_movimiento` **sin pasar la orden**. Mirando la función en la base, resulta que `registrar_movimiento(p_producto, p_tipo, p_cantidad, p_sede, p_observacion, p_ubicacion)` **no tiene parámetro para la orden de compra**. Por eso `movimientos.oc_id` nunca se llenó: no es que se olvidara, es que no había por dónde.
- La mayoría de las entradas no pasa por la orden en absoluto: se registran en `/movimientos/nuevo`, la pantalla de carga por lotes de bodega.

**Qué se construye.**

1. **Un RPC nuevo, `oc_registrar_recepcion`**, que hace todo en una sola transacción: crea la entrega, sus ítems, los movimientos de entrada **con `oc_id` y con ubicación**, actualiza el stock, recalcula lo recibido y mueve el estado de la orden a PARCIAL o COMPLETA. Hoy eso son varias idas y vueltas desde el servidor que pueden quedar a medias (el código ya tiene un comentario reconociéndolo). Con un RPC, o pasa todo o no pasa nada.

   No se le agrega un parámetro a `registrar_movimiento`: cambiarle la firma crearía una función sobrecargada y la llamada por nombre quedaría ambigua. Mejor una función propia para este caso, que además puede validar que la orden esté aprobada.

2. **Un campo de origen en las entradas.** Esta es la pieza que permite exigir la orden sin romper nada: `movimientos.origen` con los valores `COMPRA`, `PRODUCCION`, `REEMBASADO`, `TRASLADO_INTERNO`, `AJUSTE` y `OTRO`. La regla es una sola: **si el origen es COMPRA, tiene que haber orden de compra**. Lo demás entra como hoy.

   - Las 768 entradas históricas se marcan `OTRO`, no `COMPRA`. Importante: así ninguna queda contada como compra sin orden, que sería mentir en la otra dirección.
   - La regla se aplica con una restricción **no validada hacia atrás**, para que el histórico quede quieto y solo lo nuevo tenga que cumplir.

3. **En `/movimientos/nuevo`**, las filas de tipo Entrada piden el origen, y si es COMPRA aparece un selector de orden de compra (aprobada, enviada o parcial). La pantalla ya tiene un selector de órdenes de insumo con ese mismo patrón, así que es el mismo molde.

**Cómo se enciende, que es lo delicado.** Primero avisa, después exige:

- Semana 1: el campo existe, la pantalla lo pide, pero si una entrada de compra viene sin orden solo muestra una advertencia y deja guardar.
- Cuando se vea que bodega lo está llenando (se mide con una consulta: qué porcentaje de las entradas nuevas trae orden), se pasa a bloquear.

Hacerlo al revés —bloquear desde el día uno— es el camino más corto a que bodega deje de registrar las entradas en el sistema, y entonces el problema pasa de «no sé contra qué orden entró» a «no sé que entró». Eso sería peor que hoy.

### 9.3 Separar quién crea, quién aprueba y quién recibe

**El problema hoy.** Un solo permiso, `crear_ordenes_compra`, autoriza crear, editar, aprobar, marcar como comprada, recibir y anular. Y `Bodeguero` —los 4 usuarios que de verdad reciben la mercancía— tiene `ver_ordenes_compra` en **false**: ingresa mercancía sin poder ver contra qué orden la está ingresando.

**Qué se construye.**

- Dos permisos nuevos en el catálogo (`apps/inventario/lib/permisos.ts`) y en `/roles`: `aprobar_ordenes_compra` y `recibir_ordenes_compra`. `crear_ordenes_compra` se queda con crear, editar, enviar y anular, y su etiqueta deja de decir «Crear / aprobar OC».
- Reparto sugerido: Coordinador de Compras → crear y aprobar; Gerencia → aprobar; Bodeguero → recibir, **más `ver_ordenes_compra` en true**, que es el arreglo que más se va a notar en el día a día.
- Las políticas de RLS se parten en consecuencia: hoy `ordenes_compra` y `oc_items` tienen una sola política para todo (`ALL`) contra `crear_ordenes_compra`. Pasan a distinguir el cambio de estado (aprobar) de la edición, y las tablas de entrega nuevas quedan contra `recibir_ordenes_compra`.

**La regla «quien crea no aprueba» va en la base, no en la pantalla.** El guardián de permisos de la app (`lib/permisos-server.ts`) le da paso libre a los roles Super Administrador y Administrador, así que una regla escrita solo en el server action no los cubriría — y los 2 Super Admin son justo quienes más probable es que hagan las dos cosas. Un trigger en `ordenes_compra` que rechace pasar a APROBADA cuando quien aprueba es quien creó la orden aplica para todo el mundo, sin excepción. Hoy la única orden del sistema la creó y aprobó la misma persona, así que esto no es hipotético.

### 9.4 Topes de aprobación

- `compras_niveles_aprobacion` con el corte acordado: hasta 5.000.000 basta `aprobar_ordenes_compra`; por encima se exige el permiso de Gerencia.
- La verificación va en el mismo trigger de aprobación, contra `valor_total`.
- **Queda apagado hasta que el rol Gerencia tenga un usuario** (ver 9.0). Mientras no lo tenga, el nivel alto apunta al mismo permiso que el bajo: así la tabla y la pantalla ya existen, los montos ya se pueden editar, y encender el control real es cambiar una fila.
- Los topes se editan desde la pantalla de parametrización, no con migraciones, porque van a cambiar con la inflación y con el tamaño de la operación.

### 9.5 Pantallas

- **`/ordenes-compra/[id]`**: la casilla de recepción pasa a ser «Registrar entrega» (fecha, remisión, ubicación, y por ítem lo recibido y lo rechazado con motivo), más el historial de entregas anteriores con quién recibió cada una. Los botones de aprobar y recibir se habilitan por los permisos nuevos.
- **`/movimientos/nuevo`**: columna de origen en las filas de entrada y selector de orden cuando el origen es compra.
- **`/aprovisionamiento`**: quitar el `const periodo = 'JUNIO 2026'` y el filtro fijo a `2026-06-01`. La pantalla lleva cuatro meses mostrando junio mientras la vista en vivo que tiene al lado está al día. Es de una línea y es la corrección con mejor relación esfuerzo/beneficio de toda la fase.

### 9.6 Qué queda fuera de la fase 1, a propósito

Solicitudes de compra, cotizaciones, facturas de proveedor, histórico de precios y presupuesto por contrato. Todo eso sigue en las fases 2 a 5 y no se toca aquí. La fase 1 no agrega ni un paso nuevo al trabajo de compras: solo hace que lo que ya hacen quede registrado.

### 9.7 Cómo se sabe que la fase 1 sirvió

Tres números medibles contra lo de hoy:

| Indicador | Hoy | Meta |
|---|---|---|
| Entradas de compra con orden asociada | 0 de 768 | más del 80% de las entradas nuevas |
| Órdenes aprobadas por quien no las creó | 0 de 1 | todas |
| Entregas registradas con fecha y remisión propias | no existe el dato | todas las recepciones nuevas |

Vale dejar la consulta que mide la primera fila guardada en `scripts/`, para poder revisarla cada semana sin volver a armarla.

### 9.8 Orden de trabajo

1. Migración: tablas de entrega, trigger de `cantidad_rec`, campo de origen con el backfill a `OTRO`, permisos nuevos, trigger de «quien crea no aprueba», tabla de topes. Una sola migración, idempotente, aplicada con la rutina de siempre cuando la otra sesión libere la base.
2. RPC `oc_registrar_recepcion` y ajuste de las políticas de RLS.
3. Server actions de `/ordenes-compra` partidos por permiso.
4. Pantalla de entrega y pantalla de movimientos.
5. El arreglo del período de `/aprovisionamiento`.
6. Verificación: los dos scripts de permisos que ya existen, más una revisión de las pantallas con sesión en el banco de pruebas.

La migración y el RPC son el bloque que hay que hacer bien; las pantallas son mecánicas. Los pasos 3 a 5 se pueden repartir, el 1 y el 2 no.

## 10. Fase 1 construida (2026-10-18)

La migración `supabase/migrations/20261018000000_compras_fase1.sql` **ya está aplicada** en la base. Esto es lo que quedó y lo que cambió respecto del plan.

### Lo que quedó

| Pieza | Dónde |
|---|---|
| Entregas con fecha, remisión, ubicación, quién recibió, cantidad rechazada y motivo | `oc_recepciones` + `oc_recepcion_items` |
| `oc_items.cantidad_rec` mantenido por trigger (ya nadie lo escribe a mano) | `tr_oc_recepcion_items_sync` |
| Una entrega completa en una sola transacción | `oc_registrar_recepcion()` |
| Entradas que pueden declarar origen y orden de compra | `registrar_entrada()` |
| Origen de la entrada, con la regla «si es compra, tiene orden» | `movimientos.origen` + restricción `movimientos_compra_exige_oc` (NOT VALID) |
| Origen deducido para lo que entra por otras funciones | `tr_movimientos_origen` |
| «Quien crea no aprueba» + tope por monto | `tr_oc_aprobacion` |
| Topes editables | `compras_niveles_aprobacion` |
| Indicador de cobertura | vista `v_compras_cobertura_oc` y `scripts/verificar-compras-fase1.mjs` |
| Permisos separados | `aprobar_ordenes_compra`, `aprobar_ordenes_compra_sin_tope`, `recibir_ordenes_compra` |

Pantallas: la orden de compra pasó de «Registrar recepción» a «Registrar entrega» con historial; `/movimientos/nuevo` pide el origen de cada entrada y la orden cuando es una compra; `/aprovisionamiento` ya no muestra junio fijo.

### Tres cosas que los datos o el código cambiaron sobre la marcha

1. **La causa raíz no era un olvido.** `registrar_movimiento` nunca tuvo parámetro para la orden de compra, así que `movimientos.oc_id` no se podía llenar. No se le cambió la firma —`ejecutar_reembasado` y las devoluciones de órdenes de insumo la llaman por posición y se habrían roto—, se agregó `registrar_entrada` al lado.
2. **La orden que existe tiene 0 recibido**, así que no hubo ninguna entrega histórica que reconstruir (ver 9.1).
3. **La tarjeta de móvil escondía el rechazo.** La tabla estándar oculta en tarjetas las columnas sin valor, y el motivo del rechazo empieza vacío: en el celular era imposible registrar un rechazo. La entrega lleva tarjeta propia. Se encontró probando, no leyendo.

### Verificación hecha

- 11 comportamientos probados contra la base real dentro de una transacción revertida: autoaprobación bloqueada, aprobación sin permiso bloqueada, aprobación válida, entrada de compra sin orden bloqueada, recepción sin permiso bloqueada, entrega registrada con su movimiento y su ubicación, stock que sube lo recibido y no lo rechazado, exceso sobre lo pedido bloqueado, rechazo sin motivo bloqueado, segunda entrega que cierra la orden, y la vista de cobertura.
- `tsc --noEmit` limpio.
- `scripts/verificar-permisos.mjs`: «la base de datos concede exactamente lo que dice /roles».
- Las dos pantallas montadas con datos reales en el banco de pruebas: validaciones y el contenido exacto de lo que se envía al servidor.

### Línea base (al aplicar)

0 de 768 entradas con orden · 1 orden aprobada por quien la creó (de antes del trigger) · 0 entregas registradas. `node --use-system-ca scripts/verificar-compras-fase1.mjs` vuelve a medirlo cuando se quiera.

### Lo que falta para que la fase 1 sirva de verdad

1. **Asignarle el rol Gerencia a alguien** y después encender el tope alto (el script lo recuerda y trae el `UPDATE`).
2. **Decidir si producción, reembasado y maquinaria son bodegas aparte** (pregunta abierta de 7.3).
3. **Pasar de avisar a bloquear** en `/movimientos/nuevo` cuando se vea que bodega está marcando el origen. Hoy una entrada sin origen se guarda igual, a propósito.

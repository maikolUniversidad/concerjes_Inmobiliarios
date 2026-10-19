# Módulo de Compras — bases

Estado: **fase 1 construida y aplicada el 2026-10-18** (sección 10) y **fase 2 —la solicitud de compra— construida y aplicada el 2026-10-19** (sección 11). Las cuatro decisiones de la sección 7 están aceptadas; quedan tres preguntas de detalle y un paso previo (ver 9.0). Las fases 3 a 5 (cotizaciones, facturas de proveedor, presupuesto por contrato) siguen sin empezar.

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
2. **Solicitud de compra** + botón «Generar solicitud» desde Aprovisionamiento y desde las órdenes pendientes por falta de stock; conversión de solicitud → OC agrupando por proveedor con el precio del comparador. ✅ *Construida el 2026-10-19 (sección 11).*
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

Las cuatro quedaron **aceptadas el 2026-10-18**, y la pregunta de detalle de 7.3 se respondió el 2026-10-19. Cada una conserva la recomendación y en qué se apoya; lo marcado con ⏳ son las preguntas que siguen esperando respuesta, recogidas en la sección 9.0.

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

✅ **Respondida el 2026-10-19.** Sí son sitios físicos distintos. Producción, Reembasado y Maquinaria quedaron registradas como bodegas (migración `20261019000001_bodegas_internas.sql`), marcadas como **internas**: no despachan a sedes y no reparten stock — el stock sigue siendo uno solo por producto, en la Central. Cada una declara qué origen de entrada representa (`bodegas.origen_movimiento`), que es lo que conecta este registro con el `movimientos.origen` de la fase 1. Detalle en la sección 11.

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

## 11. Fase 2 construida (2026-10-19)

La migración `supabase/migrations/20261019000000_compras_fase2_solicitudes.sql` **ya está aplicada** en la base. Esto es lo que quedó, y lo que los datos o el código cambiaron sobre la marcha.

La decisión que manda sobre toda la fase sigue siendo la 7.1: **la solicitud no es obligatoria**. `ordenes_compra.solicitud_id` nace nullable y ningún camino la exige; compras sigue pudiendo crear la orden directo. Lo que la fase agrega es la vía opcional, y la automática donde sale gratis.

### Lo que quedó

| Pieza | Dónde |
|---|---|
| Requisición con origen, prioridad, sede y quién la pidió | `solicitudes_compra` (numeración `SC-YYYYMM-NNN`) |
| Qué se pide, con el enlace a la orden pendiente que lo originó | `solicitud_compra_items` (`orden_insumo_id`, `justificacion`) |
| La orden de compra puede venir de una solicitud — o no | `ordenes_compra.solicitud_id`, **nullable** |
| De dónde sale el proveedor y el precio, en un solo sitio | `compras_precio_sugerido()` |
| La recomendación, ya con proveedor y precio | vista `v_recomendacion_compra_proveedor` |
| Qué órdenes pendientes siguen sin pedirse | vista `v_sc_pendientes_sin_solicitud` |
| Generar desde la recomendación, una solicitud por proveedor | `sc_generar_desde_recomendacion()` |
| Generar desde una orden pendiente, sin duplicar | `sc_generar_desde_pendiente()` |
| Convertir en **una orden de compra por proveedor** | `sc_convertir_a_oc()` |
| Enviar, rechazar y anular | `sc_cambiar_estado()` |
| Permiso nuevo | `solicitar_compras` (Coordinador, Coordinador de Compras, Bodeguero) |

Pantallas: `/solicitudes-compra` (listado con filtros, KPIs y el panel de órdenes pendientes sin solicitud) y `/solicitudes-compra/[id]` (detalle con los ítems, las órdenes generadas y los botones de estado); `/aprovisionamiento` gana «Generar solicitud de compra» sobre la recomendación en vivo, agrupada por proveedor; y el detalle de una orden pendiente de `/ordenes-insumo` gana su botón y el enlace a la solicitud que ya tenga.

Las dos tablas nacen cerradas por `auth_permiso` y **sin política de escritura a propósito**: la única vía son los RPC `sc_*`, que son SECURITY DEFINER y validan el permiso. Es el mismo criterio de las tablas de entrega de la fase 1.

### Cinco cosas que los datos o el código cambiaron sobre la marcha

1. **`v_recomendacion_compra` no tiene proveedor.** La sección 1 ya decía que «no elige proveedor», pero el plan de la fase 2 daba por hecho que se podía agrupar por él. Hubo que deducirlo: precio vigente más barato del comparador y, si no hay, el proveedor de la ficha del producto. Esa regla vive en `compras_precio_sugerido()` y la usan la pantalla *y* la conversión, para que la solicitud no prometa un precio que la orden no vaya a usar.

2. **Un tercio de lo que el sistema recomienda comprar no tiene proveedor.** De los 109 productos recomendados, 55 tienen precio en el comparador y 43 tienen proveedor en su ficha; combinando las dos fuentes quedan **73 con proveedor y 36 sin ninguno**, y esos 36 son **83 de los 264 millones**. La conversión **no les inventa proveedor**: los deja en la solicitud, los cuenta en el resultado y la solicitud queda en `PARCIAL`. Es la diferencia entre un dato que falta y un dato inventado.

3. **Valorar la compra al precio que de verdad se paga la sube 37%.** La recomendación valorada a `precio_lista` da 264 millones; valorada con el precio del comparador cuando existe, **362,5 millones**. De los 54 productos que tienen los dos precios, en **36 el comparador está por encima** del precio de lista y en 12 por debajo. La pantalla de `/aprovisionamiento` pasó a mostrar el segundo número, que es el que se va a pagar. El primero venía siendo optimista en cien millones.

4. **«Pendiente» no quiere decir «falta comprar».** Hay 32 órdenes pendientes por falta de stock, pero 5 ya se despacharon (apareció el stock) y 3 están anuladas. Solo tiene sentido comprar para las que **todavía no salieron de la bodega**: quedan **23 órdenes, 54 ítems, 1.560 unidades, unos 6,9 millones**. La vista y la función comparten esa lista de estados, y el filtro de «ya tiene solicitud» va **por producto y no por orden**: si fuera por orden, una solicitud parcial escondería la orden y el resto de sus productos no se pediría nunca.

5. **La tarjeta de móvil volvió a esconder un dato.** Es la misma trampa de la fase 1: la tabla estándar oculta en tarjetas las columnas cuyo valor sale vacío, así que la solicitud *sin proveedor* —justo la que hay que mirar— no mostraba la fila del proveedor en el celular y parecía un dato perdido. Se arregló haciendo que «Por definir» sea un **valor** y no solo un texto de la celda. Se encontró probando, no leyendo.

### Cómo se decidió agrupar

- **Desde la recomendación: una solicitud por proveedor.** Así cada una se convierte después en exactamente una orden, que es lo que compras necesita. Los 36 sin proveedor van en una solicitud aparte, marcada, para que se vean.
- **Desde una orden pendiente: una sola solicitud, aunque toque varios proveedores.** Lo que une esos ítems es la sede que se quedó sin su insumo, no el proveedor; y la conversión ya sabe partirlos. En la prueba real, una pendiente de 3 productos salió en 2 órdenes (dos productos de un proveedor, uno de otro).
- **Prioridad.** La recomendación nace en `NORMAL`; una pendiente nace en `ALTA`, y en `URGENTE` si la orden de insumo venía marcada urgente. Una sede sin su insumo no es una compra de rutina.

### Verificación hecha

- **36 comportamientos probados contra la base real dentro de una transacción revertida** (`node --use-system-ca scripts/probar-compras-fase2.mjs`): quién puede solicitar y quién no, la RLS de lectura, la generación por proveedor, la solicitud aparte de los productos sin proveedor, la numeración `SC-YYYYMM-NNN` sin huecos ni repetidos **y que tras borrar la 003 la siguiente sea la 009** (máximo del período, no conteo), que una cantidad mayor que la recomendada se recorte, la generación desde una pendiente con su sede y su prioridad, que no se duplique, que una pendiente ya despachada no genere nada, que bodega no pueda convertir, la orden por proveedor en BORRADOR con `solicitud_id`, que el precio salga del comparador y si no de la lista, el `valor_total` contra los subtotales generados, la mezcla con y sin proveedor que deja la solicitud en `PARCIAL`, que no se convierta dos veces, los estados (enviar, rechazar, anular con motivo) y **que una orden de compra siga pudiendo nacer sin solicitud**.
- `tsc --noEmit` limpio.
- `scripts/verificar-permisos.mjs`: «la base de datos concede exactamente lo que dice /roles». `scripts/auditar-permisos.mjs` no reporta ninguna incoherencia nueva: `solicitar_compras` queda en el catálogo, en la app, en la RLS y en la base.
- Las tres pantallas montadas con datos reales en el banco de pruebas, en tabla y en tarjetas y a 375 px de ancho: los ocho grupos de proveedor con sus totales, el recorte al deseleccionar, el detalle con sus dos órdenes generadas y lo que exactamente se le envía al servidor en cada botón.

### Línea base (al aplicar)

0 solicitudes de compra · 23 órdenes pendientes esperando que alguien las pida · 109 productos recomendados por 362,5 millones, repartidos en 7 proveedores más 36 productos sin proveedor.

### Atacar el hueco: el filtro «Sin proveedor» del comparador (2026-10-19)

La fase 2 dejó claro que 36 productos recomendados no se pueden convertir en orden. Al medir el catálogo completo resultó que **el hueco no son 36 sino 178** (la sección de proveedores duplicados habla de 273 productos sin proveedor: ese es el conteo de los que no lo tienen **en la ficha**; los 178 son los que no lo tienen **por ninguna vía**, que son los que de verdad bloquean la conversión a orden), y que nada permite deducir el proveedor: `movimientos` no tiene columna de proveedor, hay una sola orden de compra en todo el sistema, y ninguno de esos productos tiene fila en `precios_proveedor` — ni siquiera apagada. **24 de los 36 sí tienen entradas registradas**, así que se compran de verdad; el sistema nunca guardó a quién. Llenarlo es trabajo de alguien que sepa a quién se le compra; lo que puede hacer el sistema es poner la lista enfrente, ordenada por lo que pesa.

| Familia | Sin proveedor | De esos, se movieron en 6 meses |
|---|---|---|
| ASEO | 76 | 37 |
| MAQUINARIA | 38 | 19 |
| OTROS | 27 | 15 |
| CAFETERIA | 18 | 14 |
| EPP | 13 | 8 |
| LIQUIDOS + JARDINERÍA | 6 | 4 |
| **Total** | **178** | **97** |

Los 81 restantes llevan medio año quietos: pueden esperar, o es señal de que sobran en el catálogo. Los 16 productos de EPP del sistema **no tienen proveedor ninguno**, y de los 43 de MAQUINARIA solo 5 lo tienen — pero buena parte de eso son activos (greca, hidrolavadora, escaleras, balanza), no compra de rutina.

**Qué se construyó.** La vista `v_productos_sin_proveedor` (migración `20261019000003_productos_sin_proveedor.sql`, aplicada) y, sobre ella, un filtro **«Sin proveedor»** en `/comparador-precios` con su KPI. La lista va ordenada por lo que la recomendación pide hoy y después por lo que las sedes pidieron en 6 meses, no alfabéticamente: arriba quedan los que desbloquean plata. Cada fila lleva un botón «Asignar» que abre directo el formulario de proveedor y precio.

Se asigna **en el comparador y no en la ficha del producto** por una razón concreta: 21 de los 36 recomendados tampoco tienen precio de lista, así que llenar solo `productos.proveedor_id` deja la orden de compra en $ 0. El comparador resuelve proveedor y precio de una.

**Lo que apareció al probarlo, y es lo más importante de todo esto:** en la base había **32 proveedores activos para 12 nombres distintos**. Cada proveedor real estaba repetido hasta cuatro veces, y solo uno de los duplicados tenía los datos: de los cuatro «MONTERREY», uno con 226 precios y tres vacíos; igual con BEAUTE (235), SCOPA, DETALGRAF, CAJA MENOR y SUMICORP. Elegir el proveedor en una lista con cuatro entradas idénticas es una moneda al aire, y el precio queda colgado de un registro que nadie consulta. **Eso se arregló aparte, en la sección de proveedores duplicados.**

El selector igual quedó **ordenando los proveedores por cuántos productos usan ya y mostrando ese número en cada opción**, con un aviso que solo sale si vuelve a haber nombres repetidos. Con la base limpia el aviso no aparece, y el orden por uso sigue sirviendo para encontrar rápido al proveedor de siempre.

Nota aparte: el botón «Sincronizar N de fichas» que ya existía en esa pantalla tiene hoy **182 precios por pasar** de las fichas de producto al comparador. Eso no toca a los 178 (que no tienen ni ficha), pero es trabajo hecho que no está rindiendo.

### Un proveedor desactivado ya no se sugiere (migración `20261019000004`)

Al revisar juntas esta sección y la fusión de proveedores duplicados apareció que **nada filtraba por `proveedores.activo`**: `compras_precio_sugerido()` tomaba el precio vigente más barato fuera de quien fuera, y `v_productos_sin_proveedor` daba por resuelto un producto cuyo único proveedor estuviera desactivado. Hasta ese día daba igual, porque los 32 proveedores estaban activos.

Dejó de dar igual con la fusión: ahora hay 20 desactivados, y «eliminar» un proveedor en `/proveedores` **no borra, pone `activo = false`**. El día que alguien elimine uno que todavía tiene sus precios en el comparador, el sistema seguiría proponiéndolo y `sc_convertir_a_oc()` armaría la orden contra un proveedor que para el usuario ya no existe.

La migración lo corrige en los dos sitios a la vez, que es el punto: si solo se arreglara uno, la pantalla y la conversión dirían cosas distintas del mismo producto. No cambió ni un dato al aplicarla —hoy no hay una sola referencia a un proveedor desactivado—, es para que siga siendo verdad.

**Lo encontró la prueba, no la lectura:** la primera versión agregaba el `LEFT JOIN proveedores … AND pr.activo` pero seguía devolviendo `productos.proveedor_id` en vez de `pr.id`, así que el join no filtraba nada y la función seguía sugiriendo al desactivado mientras la vista ya lo daba por huérfano — justo la incoherencia que venía a quitar. `node --use-system-ca scripts/probar-proveedor-activo.mjs` lo comprueba desactivando de verdad un proveedor dentro de una transacción que revierte.

### Lo que falta para que la fase 2 sirva de verdad

1. ~~Limpiar los proveedores duplicados~~ — **hecho**, en la sección de proveedores duplicados: la base pasó de 32 activos para 12 nombres a 12 sin repetidos, con un índice único que impide que vuelva a pasar. Era lo primero porque asignar proveedores sobre una lista con cuatro «BEAUTE» ensucia más de lo que arregla.
2. **Asignar proveedor y precio a los 97 productos que se mueven**, desde el filtro «Sin proveedor» de `/comparador-precios`. Los 36 que la recomendación pide hoy están de primeros.
3. **Decidir si la solicitud se vuelve obligatoria alguna vez.** Hoy no lo es, a propósito. El interruptor es poner `ordenes_compra.solicitud_id` en NOT NULL; conviene mirar antes cuántas órdenes están naciendo con solicitud.
4. De la fase 1 sigue abierto el rol **Gerencia sin usuarios**, que mantiene apagado el tope alto de aprobación. Lo de producción, reembasado y maquinaria ya quedó resuelto en la sección 12.

## 12. Bodegas internas (2026-10-19)

La última pregunta abierta de la decisión 7.3 quedó respondida: producción, reembasado y maquinaria **sí** son sitios físicos distintos de la Central. Migración `20261019000001_bodegas_internas.sql`, ya aplicada.

### Qué cambió y qué no

Se registraron tres bodegas —**Producción**, **Reembasado** y **Maquinaria**— junto a la Central que ya existía. Lo que **no** cambió: las compras siguen entrando a la Central y **el stock sigue siendo uno solo por producto**. Esto no reparte inventario por bodega; pone en el sistema unos sitios que ya existían en la vida real y hasta ahora solo aparecían como texto suelto en las observaciones de los movimientos («INGRESA DESDE PRODUCCION», «DE LA BODEGA DE MAQUINARIA», «LO QUE SE REEMBASO»).

Dos columnas nuevas en `bodegas`:

| Columna | Para qué |
|---|---|
| `despacha_a_sedes` | Si de ahí salen órdenes de insumo. Solo la Central. |
| `origen_movimiento` | Qué origen de entrada representa esa bodega. Es el puente con el `movimientos.origen` de la fase 1. |

### Lo que había que arreglar al mismo tiempo

Agregar bodegas no es gratis: `/ordenes-insumo/nuevo` tenía un selector que ofrecía **todas** las bodegas, así que de un día para otro habría permitido crear una orden de despacho «desde Producción», algo que no ocurre nunca. El selector ahora solo trae las que despachan a sedes, y la lista de `/bodegas` marca las internas con una etiqueta para que se distingan de un vistazo.

Por lo mismo, `compras_bodega_central()` dejó de resolver el respaldo como «la bodega más antigua» y pasa a «la más antigua **que despacha**»: una bodega interna nunca debe quedar como destino de una compra.

### Lo que a propósito no se hizo

- **No se crearon ubicaciones dentro de las bodegas nuevas.** Las crea quien conozca cada sitio, desde `/bodegas`.
- **No se tocó `movimientos.ubicacion_id` del histórico.** Esa columna dice dónde **quedó** la mercancía —la Central—, no de dónde vino; lo segundo ya lo dice `origen`, y rellenarla sería inventar una ubicación que nadie registró.

### Verificación

`compras_bodega_central()` sigue devolviendo la Central y la orden de compra existente conserva su destino; el selector de despacho ofrece 1 bodega y no 4; la vista nueva `v_entradas_por_origen` cruza origen y sitio (ya muestra la entrada de reembasado de septiembre en su bodega); las tres bodegas nuevas quedaron con 0 ubicaciones, sin filas inventadas; `tsc --noEmit` limpio.

La etiqueta «Interna» de `/bodegas` no se verificó en el navegador: esa pantalla es un componente de servidor y el banco de pruebas monta componentes de cliente. El cambio es un `span` condicional sobre un campo ya comprobado en la base.


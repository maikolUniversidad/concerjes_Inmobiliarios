# F7 — Planes preventivos y órdenes de trabajo: nota de cambios

Séptima fase del módulo de Puntos QR, y la única que **toca un módulo que ya
estaba en producción**: `/mantenimiento`. Entrega el plan preventivo (por
calendario o por medidor) y la orden de trabajo sobre un activo del cliente, con
su ejecución en sitio, sus materiales —que mueven inventario de verdad— y la
aprobación del cliente.

Fuentes: [02-complemento-2-integracion.md](docs/puntos-qr-whatsapp/02-complemento-2-integracion.md)
§4.2 (los nombres de las tablas y las columnas), §2.3 (los diez estados), §2.4
(indicadores) y §6 (el primer entregable de F7 es el acuerdo sobre los estados,
no el SQL); [03-nomenclatura.md](docs/puntos-qr-whatsapp/03-nomenclatura.md);
y la propuesta que el usuario aprobó,
[F7-propuesta-estados.md](docs/puntos-qr-whatsapp/F7-propuesta-estados.md).

Migraciones, **aplicadas y verificadas contra la base el 2026-10-28**:

| Archivo | Qué lleva |
|---|---|
| [20261028001000_puntos_qr_f7_estados.sql](supabase/migrations/20261028001000_puntos_qr_f7_estados.sql) | **solo** los cuatro `ALTER TYPE … ADD VALUE` |
| [20261028001010_puntos_qr_f7_ot.sql](supabase/migrations/20261028001010_puntos_qr_f7_ot.sql) | todo lo demás |

---

## 0. Las seis decisiones, y la que se desvió

El usuario aprobó las seis recomendaciones del §8 de la propuesta. Cinco
entraron tal cual; **la quinta se desvió, y a propósito**:

| # | Decisión | Cómo quedó |
|---|---|---|
| 1 | Aprobación con firma (`ronda_firmas`, `quien = 'CLIENTE'`) cuando hay visita; nombre + cargo + fecha cuando no | tal cual. El cliente no tiene cuenta en esta entrega |
| 2 | Aprobación obligatoria para cerrar **solo** en las OT de activos de cliente, con aprobación tácita por plazo | tal cual |
| 3 | `ACEPTADO` / `EN_CAMINO` / `EN_SITIO` opcionales, SLA de respuesta cortado por el primero que exista | tal cual, con una columna generada |
| 4 | `EN_SITIO` lo escribe el escaneo; la salida por QR ilegible va marcada como apertura manual | tal cual |
| 5 | `grupo_id` nace `NOT NULL` | **NO. Nace nullable** → §1 |
| 6 | El alcance por contrato en la lectura de tickets entra en F7 | tal cual |

### Por qué `grupo_id` nace nullable

La decisión 5 llevaba una condición que puse yo mismo en la propuesta y que
nadie había verificado: que existiera **un contrato interno de la empresa** al
que colgar los tickets de maquinaria propia. Lo comprobé en la base antes de
escribir el `NOT NULL`, y **no existe**:

- Los siete `grupos_contrato` son todos de cliente: Administraciones /
  Copropiedades, Asecolbas, Corferias / Bibliotecas / Colegios / Amazonia, Fondo
  Colombia en Paz, Comerbas / Santorini / Fuerza Aérea, Ministerios / Alcaldías
  / Entidades Estado y UNAD — Nacional.
- Y `maquinaria` no cuelga de un contrato: cuelga de `ubicacion_sede_id`, que es
  **nullable**, y 49 de los 119 equipos activos no tienen ni sede. Un equipo
  propio puede estar en bodega, que no es de nadie.

Sembrar una fila de contrato ficticia para que el `NOT NULL` cuadre dejaría un
contrato inventado en producción, saliendo en los selectores de contrato de
`/rondas/contratos`, de los puntos y de los informes de todas las fases. Eso es
peor que una columna nullable. Así que:

```sql
grupo_id UUID REFERENCES grupos_contrato(id)   -- nullable
```

Y la política de lectura lleva la condición doble:

```sql
(SELECT public.mant_puede_participar())
AND (grupo_id IS NULL OR grupo_id IN (SELECT public.auth_grupos()))
```

El costo de esto se paga para siempre: cada consulta nueva sobre tickets tiene
que recordar el caso nulo. **Si algún día se decide crear el contrato interno,
el camino es rellenar `grupo_id` en los tickets de maquinaria y recién entonces
poner el `NOT NULL`** — pero es una decisión de negocio, no de esquema, y no era
mía.

---

## 1. Lo que entra

| Tabla | Alcance | Para qué |
|---|---|---|
| `mant_planes` | `grupo_id` **nullable** (NULL = todos los contratos) | la regla: cada cuánto le toca |
| `mant_plan_tareas` | hereda del plan | las tareas, que son plantillas de F4 |
| `mant_plan_materiales` | hereda del plan | materiales esperados (NO mueven stock) |
| `mant_materiales` | hereda del ticket | el consumo real, con su movimiento de salida |

Y treinta y tres columnas nuevas en `mantenimiento_tickets`, que es donde vive
la orden de trabajo: no se creó una segunda tabla.

**Un plan apunta a uno de tres objetos**, y de ahí sale a qué se aplica:
`activo_tipo_id` (todos los activos de ese tipo: con una fila queda cubierta la
recarga anual de todos los extintores), `activo_id` (ese activo y nada más) o
`maquinaria_id` (un equipo propio). El `CHECK mant_planes_objeto` exige
exactamente uno: ni cero, que no se sabría a qué aplicar, ni dos.

**La frecuencia es de calendario o de medidor.** `DIAS` / `SEMANAS` / `MESES`
cuentan desde el último preventivo resuelto; `MEDIDOR` dispara cuando el
contador del activo pasa el salto, leyendo el `valor_actual` que F6 ya mantiene
con un trigger. Un plan por medidor sin medidor no se puede calcular, y el
`CHECK mant_planes_medidor` lo impide.

Pantallas: **`/mantenimiento/planes`** (nueva: la lista de planes y el bloque
«lo que toca»), y cambios en `/mantenimiento`, `/mantenimiento/<id>`,
`/equipo`, `/equipo/<ref>` y `/rondas/activos/<id>`.

**No se crearon claves de permiso nuevas.** Los planes se ven con
`ver_mantenimiento` y se editan con `gestionar_mantenimiento`, que en `/roles`
ya se llama literalmente «asignar, cancelar y programar preventivos (jefe)». Lo
que sí se agregó a los roles Técnico y Jefe de Mantenimiento son dos claves que
ya existían: `ver_activos_ronda` (de F6) y `ejecutar_rondas` → §6.

---

## 2. Los once estados

El enum quedó en orden de ciclo de vida, no con los nuevos pegados al final:

```
ABIERTO · RECIBIDO · ACEPTADO · EN_CAMINO · EN_SITIO · EN_PROCESO ·
EN_ESPERA · RESUELTO · APROBADO_CLIENTE · CERRADO · CANCELADO
```

No es cosmético: el índice `idx_mant_tickets_estado(estado, prioridad)` ordena
por el enum, y un `ORDER BY estado` futuro daría un resultado absurdo con
`ACEPTADO` después de `CANCELADO`. Insertar en medio era gratis hoy (nada en el
repositorio ordena por `estado`); reordenar después no existe en Postgres.

**La regla de oro: los cuatro estados nuevos son opcionales.** El camino corto
de siempre —`ABIERTO → RECIBIDO → EN_PROCESO → RESUELTO → CERRADO`— sigue
existiendo tal cual para el correctivo de maquinaria propia, y ninguna
transición que funcionaba dejó de funcionar.

`mant_transicion` pasa de ocho acciones a once: se suman `ACEPTAR`, `SALIR` y
`APROBAR_CLIENTE`. **`EN_SITIO` NO es una acción**: no hay forma de ponerlo con
`mant_transicion` (lo probé: responde «Acción desconocida»). Lo escribe
`mant_abrir_visita`, que primero abre la visita de verdad.

---

## 3. Dos migraciones, y por qué no puede ser una

PostgreSQL 17 permite `ALTER TYPE … ADD VALUE` dentro de una transacción pero
**prohíbe usar el valor nuevo en esa misma transacción**, y
`scripts/apply-migrations.mjs` envuelve cada archivo en un `BEGIN … COMMIT`
único. Si los `ADD VALUE` compartieran archivo con cualquier cosa que los
mencione como dato —una fila sembrada, un `CHECK`, una vista con
`WHERE estado = 'EN_SITIO'`— la migración fallaría con *«unsafe use of new value
of enum type»*.

Detalle del primer archivo: `EN_CAMINO` y `EN_SITIO` se anclan los dos
`BEFORE 'EN_PROCESO'`, no uno detrás del otro. Anclar contra un valor añadido en
la misma transacción sería *usarlo*, que es justo lo prohibido. Como se aplican
en orden, `EN_SITIO` cae entre `EN_CAMINO` y `EN_PROCESO`, que es donde va.

**Esto vale para cualquier fase que amplíe un enum**, no solo para F7.

---

## 4. Lo que estaba roto y no fallaba con un error claro

Cuatro sitios en SQL daban por hecho que `maquinaria_id` nunca es nulo. Ninguno
avisaba bien:

| Dónde | Qué pasaba con una OT de activo | Cómo quedó |
|---|---|---|
| `mant_transicion` | llamaba `maq_evento(m.id, …)` con `m.id` nulo y reventaba por el `NOT NULL` de `maquinaria_eventos` **a mitad de la transición** | la parte del equipo va dentro de un `IF`, y el envoltorio `mant_evento_objeto()` lo resuelve en un sitio en vez de catorce |
| `mant_notificar` | su `JOIN maquinaria` era **INNER**: no devolvía filas, el payload quedaba nulo y la notificación salía vacía **en silencio** (la función se traga las excepciones a propósito) | dos `LEFT JOIN` y el objeto se nombra con el que exista; si el ticket no existe, avisa con un `WARNING` en vez de emitir vacío |
| `mant_reportar` | exigía `p_maquinaria` y moría con «Equipo no encontrado» | acepta `p_maquinaria` **o** `p_activo`, exactamente uno |
| `mantenimiento_actividades` | `maquinaria_id NOT NULL`: la actividad de una OT no tenía dónde guardarse | **no se tocó**. La bitácora de la OT vive en el motor de F4, que es más completo; el botón «Registrar actividad» solo sale con equipo propio |

Y uno en TypeScript: `TicketClient.tsx` tipaba `maquinaria` como **no nullable**
y leía `t.maquinaria.estado` sin guarda, así que la ficha de una orden de activo
devolvía un **500**. Ahora las dos (`maquinaria` y `activo`) son nullable y
exactamente una existe.

### Las dos firmas que hubo que BORRAR antes de recrear

`mant_reportar` y `mant_transicion` cambiaron de parámetros. `CREATE OR REPLACE`
con parámetros nuevos **no reemplaza: crea una sobrecarga**, y conviviría con la
versión vieja. Supabase llama las RPC por nombre, así que con dos candidatas
falla con *«could not choose the best candidate function»*. Las dos llevan su
`DROP FUNCTION` con la firma antigua completa antes del `CREATE`.

---

## 5. El cambio más delicado: el alcance por contrato

`mant_puede_participar()` es `auth_permiso_any({ver_mantenimiento,
reportar_falla_maquinaria, atender_mantenimiento, gestionar_mantenimiento})`
**y nada más** — no tiene ningún alcance por sede ni por contrato. De ella
cuelgan la lectura de tickets, la de mensajes, la de actividades y las cuatro
políticas de storage.

Mientras todo fuera maquinaria propia eso era defendible. En el momento en que
existe una OT de un cliente, cualquiera con `ver_mantenimiento` —hoy Auditor,
Supervisor de Conserjería y Coordinador— leería las órdenes, el chat y las fotos
de **todos** los clientes: el agujero que §4.2 evitó separando `activos` de
`maquinaria`, abierto por la otra puerta.

**`mant_puede_participar()` no se tocó**: el módulo de maquinaria sigue
exactamente como estaba. Lo que se añadió es una condición por fila que solo
muerde cuando el ticket es de un cliente, con el modismo de F1
(`grupo_id IN (SELECT auth_grupos())`, subconsulta **no correlacionada**, así
que se evalúa una vez por consulta y no una por fila).

Tres sitios más que cerraban el mismo agujero por los lados:

- **El chat** (`mantenimiento_mensajes`): se apoya en la política del ticket con
  un `EXISTS`, así que hereda el alcance sin duplicar la regla.
- **Las fotos** (`storage.objects`, bucket `mantenimiento`): las de una OT van
  bajo la carpeta del activo. La nueva `mant_archivo_puede_ver(name)` mira si la
  primera carpeta de la ruta es un activo y, si lo es, exige que esté en el
  alcance; para una ruta de maquinaria se comporta igual que antes.
- **`mant_transicion` y las RPC de materiales** validan el alcance además de la
  RLS: una RPC `SECURITY DEFINER` se salta las políticas, así que la
  comprobación tiene que estar escrita dentro.

`scripts/generar-rls-envuelta.mjs` sigue reportando **0 policies por corregir**
sobre 517.

---

## 6. Dos cosas que solo se descubren probando

**1. Abrir la visita exige `ejecutar_rondas`.** La RPC de F7 deja pasar a
cualquiera con `atender_mantenimiento`, pero tres funciones más adentro
`ronda_actor()` (de F4) exige `ejecutar_rondas` **o**
`gestionar_visitas_rondas`. Sin esa clave, un Técnico de Mantenimiento no puede
poner su orden `EN_SITIO` ni firmar en el sitio. Por eso la migración agrega
`ejecutar_rondas` y `ver_activos_ronda` a los roles Técnico y Jefe de
Mantenimiento. Esto no se ve leyendo el código de F7: se ve al ejecutarlo.

**2. La cuenta tiene que estar vinculada a una persona.** `ronda_actor()`
también exige que exista una fila de `personas` con `usuario_id` = la cuenta:
*«Esta cuenta no está vinculada a una persona: la visita necesita saber QUIÉN la
hizo»*. Es correcto —una visita sin responsable no sirve de evidencia— pero
significa que **un técnico cuya cuenta no esté vinculada a su persona no puede
ejecutar órdenes en sitio**. Es una condición de operación, no un defecto.

**3. Una plantilla publicada no acepta pasos.** F3 tiene un trigger
(`ronda_paso_congelar`) que impide tocar los pasos de una plantilla que ya no es
`BORRADOR`, porque una plantilla corregida no puede cambiar lo que vio quien ya
ejecutó con la versión vieja. La plantilla genérica `MANT-OT` que siembra F7
nace en `BORRADOR`, recibe sus cinco pasos y **después** se publica. Sembrarla
publicada de una vez falla, y el ensayo en `BEGIN … ROLLBACK` lo cazó antes de
aplicar nada.

---

## 7. El inventario va por el camino que ya existe

Los materiales de una orden mueven stock de verdad, y lo hacen llamando a
`registrar_movimiento()` como el resto de las salidas de bodega. **No se escribe
`stock` directamente**: en este repositorio `cantidad_disp = cantidad_real −
reservado` lo mantiene un trigger de `stock`, y escribir la columna a mano se
perdería en el siguiente recálculo.

- `mant_material_registrar()` valida existencias contra **`cantidad_real`** (el
  físico), igual que `ejecutar_reembasado`: lo reservado son las órdenes de
  insumo aprobadas, y un técnico que tiene el repuesto en la mano no está
  pidiendo una reserva. Sin costo explícito toma `productos.precio_lista`.
- `mant_material_quitar()` **no borra el movimiento de salida**: registra una
  `DEVOLUCION`. El inventario es un libro y no se tacha.
- `mant_materiales.movimiento_id` es la prueba de que el consumo pasó por ahí.
  Si alguna fila lo tiene nulo, la pantalla lo dice («⚠ sin movimiento de
  inventario») en vez de esconderlo.
- `mant_materiales` **no tiene política de escritura**: solo las RPC
  (`SECURITY DEFINER`) la escriben. Un `UPDATE` directo dejaría el movimiento de
  inventario sin contrapartida.

`costo` sigue siendo el total que ya leían las pantallas, y ahora es la suma de
`costo_mano_obra` + `costo_materiales`, mantenida por un trigger.

---

## 8. Las siete listas de estados escritas a mano

Había siete copias de la lista de estados en el código, y un estado nuevo tenía
que agregarse a las siete. **El peor modo de falla era silencioso**: un ticket
en un estado que no estaba en ninguna lista de pestañas no aparecía en ninguna
pestaña del tablero, sin error y sin rastro.

Ahora hay **una sola fuente**, en
[lib/mantenimiento.ts](apps/inventario/lib/mantenimiento.ts): `ESTADOS_TICKET`
(los once, en el orden del enum), `FASES_TICKET` (a qué pestaña va cada uno) y
`faseTicket(estado)`.

Y lo importante: **`faseTicket()` es total**. Siempre devuelve una fase; un
estado que alguien agregue al enum mañana y olvide clasificar cae en
`FASE_SI_NO_SE_CONOCE` = `'curso'`, que es una pestaña visible y accionable, en
vez de esfumarse. No es que hoy esté bien: es que ya **no puede** estar mal.

Las dos consultas que filtraban por estado ahora filtran en **negativo** (lo que
no es final), por lo mismo: un filtro positivo se olvidaría de un estado nuevo.

`tests/inventario/mantenimiento-estados.test.ts` lo fija con 17 pruebas, entre
ellas que la lista del frontend coincide con el enum de la base y que un estado
inventado cae en una pestaña visible.

| Dónde estaba | Cómo quedó |
|---|---|
| `lib/mantenimiento.ts:11` `ESTADO_TICKET_META` | los once, con etiqueta en español y color |
| `lib/mantenimiento.ts:20` `ESTADOS_TICKET_ACTIVOS` | derivada de `ESTADOS_TICKET` menos los finales |
| `mantenimiento/page.tsx:37` el `.in('estado', …)` de los KPI | **se fue**: los KPI salen de `vw_mant_backlog`, contados en SQL |
| `TableroClient.tsx:34-39` las pestañas y `ACTIVOS` | las pestañas salen de `faseTicket()` |
| `TicketClient.tsx:27,62-80` `Accion` y los botones | once acciones; `EN_SITIO` no es botón |
| `equipo/EquipoBuscar.tsx:19` | usa `ESTADOS_TICKET_EN_CURSO` |
| `equipo/[ref]/EquipoCampoClient.tsx:54` | usa `ESTADOS_TICKET_ACTIVOS` |
| `lib/types/database.ts:836` `EstadoTicketMant` | los once, más las columnas nuevas y cuatro interfaces |

---

## 9. Los indicadores se calculan, no se guardan

Cuatro vistas, todas con `security_invoker = true` para que hereden la RLS del
ticket:

- **`vw_mant_backlog`** — el trabajo pendiente en **una fila**, contado en SQL.
  Antes la página traía todas las filas pendientes para contarlas en JavaScript,
  y Supabase corta a los 8 s: el backlog de un año no cabe.
- **`vw_mant_indicadores`** — MTTR, % preventivo, cumplimiento de los dos SLA,
  reaperturas, aprobaciones tácitas, aperturas manuales y costos, por mes y
  contrato.
- **`vw_mant_plan_objetivos`** — un plan y UN objeto concreto al que aplica
  (expande los planes por tipo).
- **`vw_mant_plan_proximos`** — cuándo le toca a cada objeto y si ya tiene orden
  abierta. De aquí sale `mant_generar_preventivos`.

El cumplimiento del SLA son **columnas generadas**
(`sla_respuesta_cumplido`, `sla_solucion_cumplido`, `respondido_at`), no
columnas que alguien escriba: así no pueden quedar desfasadas de las marcas de
tiempo de las que salen. `respondido_at` usa `LEAST`, que ignora los nulos, que
es exactamente lo que hace falta con tres estados intermedios opcionales: corta
el primero que exista.

Los plazos salen de `grupo_sla` con `mant_vence_sla()`, que salta fines de
semana y festivos usando el calendario que ya tiene PQRS
(`pqrs_dias_no_habiles`): no se creó un segundo calendario. La jornada se toma
de **8 horas**, y es un supuesto que está en una constante con nombre para que
se discuta en un sitio.

---

## 10. `mant_generar_preventivos` sigue siendo un botón

No entró al cron de cinco minutos, a propósito: §10.2 ya avisa que ese cron «no
es una cola» y que tendría que mover además envíos masivos e informes. Es
idempotente —no duplica el preventivo de un objeto que ya tiene una orden
abierta de ese plan— así que pulsarla dos veces no hace daño, que es más seguro
que una cola que no existe.

La función hace dos pasadas: primero los `mant_planes` (calendario o medidor) y
después **`maquinaria.proximo_mant`, que se conservó intacto**. Hay 119 equipos
con esa ficha y nadie tiene por qué reescribir su frecuencia como un
`mant_planes` para que siga andando.

El mismo botón del tablero llama ahora también a `mant_aprobar_tacitos()`, que
es la otra mitad de la decisión 2: sin ella, una OT cuyo cliente no contesta se
queda en `RESUELTO` para siempre, el backlog crece con trabajo ya hecho y el SLA
de solución no se corta nunca. El plazo se configura por contrato en
`grupo_sla.aprobacion_dias_habiles` (columna nueva, con default de 3 días
hábiles).

---

## 11. Lo que quedó pendiente, y por qué

**1. Un activo sin punto de control no puede ejecutarse en sitio.**
`ronda_visitas.punto_id` es `NOT NULL` y `activos.punto_id` es nullable. La
propuesta ofrecía dos salidas y recomendaba hacer `punto_id` nullable en
`ronda_visitas` con un `CHECK` de punto **o** activo, como hizo F6 con
`ronda_qr`. **No se hizo**: es una tabla de F4, con filas vivas, y cambiar un
`NOT NULL` ahí es una decisión de esa fase, no de esta. Lo que F7 hace es
decirlo con claridad —en la ficha del activo y al intentar abrir la visita— en
vez de fallar con un error de restricción. La otra salida (obligar a que todo
activo con plan tenga punto) queda abierta.

**2. El proveedor externo no tiene sesión.** `proveedor_id` en el ticket
significa **quién ejecuta**, distinto del `activos.proveedor_id`, que significa
quién lo instaló o lo garantiza. La OT se le asigna como dato y un usuario
interno registra lo que hizo. Darle sesión es el papel `PROVEEDOR` de
`usuario_grupos`, que es el pendiente 8 de §10.1.

**3. El cliente tampoco tiene cuenta.** La aprobación la registra quien está en
el sitio, con la firma de la visita o con nombre y cargo. Un portal donde el
cliente apruebe desde su casa es otra entrega.

**4. `mant_planes` se edita con ids pegados a mano** para el caso «un activo» y
«un equipo propio» y para el medidor. El caso normal —plan por tipo de activo—
tiene su selector. Buscadores para los otros tres es trabajo de interfaz, no de
modelo, y el caso que de verdad se usa está cubierto.

**5. `reabierto_de` existe y no se usa todavía.** §4.2 la pide para el
indicador de reaperturas y está creada, pero reabrir en el mismo ticket y
además dejar el enlace es redundante: lo que cuenta el indicador es
`reaperturas`, un contador que `REABRIR` sube. La columna queda para el día en
que una reapertura abra un ticket nuevo.

**6. Los correos de los eventos siguen sin salir.** `MANTENIMIENTO_ESTADO`
aprendió las acciones nuevas y sus variables, pero el motor de notificaciones
necesita la cuenta de correo conectada; sin ella los pasos quedan omitidos. No
es de F7.

---

## 12. Cómo se verificó

**Esquema y comportamiento, contra la base real**, con el flujo completo dentro
de `BEGIN … ROLLBACK` (ni una fila quedó: 0 tickets, 0 planes, 0 materiales, 0
activos, 0 visitas, 0 puntos al terminar):

- El enum en el orden exacto; `maquinaria_id` nullable; las cuatro tablas; las
  33 columnas nuevas; las tres generadas; los cuatro `CHECK`; las cuatro vistas
  con `security_invoker`; las siete RPC; **una sola firma** de `mant_transicion`
  y de `mant_reportar`; `mant_puede_participar()` sin tocar; la policy de
  lectura filtrando por contrato; `mant_notificar` con `LEFT JOIN`.
- `mant_vence_sla`: 4 h de tiempo corrido son 4 h; 24 h hábiles desde un viernes
  a las 9:00 caen el martes siguiente a las 17:00, saltando el fin de semana; 8
  h no salen del mismo día; sin horas pactadas no hay plazo.
- Un plan por tipo expandiéndose a su activo, generando **una** orden, y
  volviendo a generar sin duplicarla.
- El autómata entero de la OT: `ASIGNAR → ACEPTAR → SALIR →` (visita) `EN_SITIO
  → INICIAR → RESOLVER → APROBAR_CLIENTE → CERRAR`, con las marcas de tiempo y
  los dos SLA calculándose solos.
- Que `mant_transicion(…, 'EN_SITIO')` responde «Acción desconocida»: el estado
  solo lo escribe el escaneo.
- Que la apertura manual sin motivo se rechaza, y que con motivo deja
  `en_sitio_modo = 'MANUAL'` y la visita atada al ticket.
- Materiales: el stock bajó de verdad (26.026 → 26.024), el movimiento es una
  `SALIDA`, `costo_materiales` lo mantiene la base, consumir más de lo que hay
  se rechaza **contra `cantidad_real`**, y devolver repuso el stock exacto.
- Que una OT de cliente **no se cierra** sin aprobación, que la firma de la
  visita se adjunta sola, y que la aprobación tácita por plazo vencido funciona
  y queda marcada como tácita.
- Que el ticket de maquinaria propia **no cambió de reglas**: sigue sin contrato
  y sin plazos, iniciar sigue mandando el equipo a `MANTENIMIENTO`, el camino
  corto sigue cerrando sin aprobación, y su hoja de vida sigue recibiendo
  eventos (7) mientras la OT de activo no escribe ninguno — que es lo que antes
  reventaba.
- Los dos `CHECK` de objeto: reportar sin objeto y reportar con los dos se
  rechazan.

**Las dos migraciones son idempotentes**: se aplicaron dos veces seguidas sin
error.

Todo esto quedó en `scripts/probar-puntos-qr-f7.mjs`, que se puede volver a
correr: `NODE_OPTIONS=--use-system-ca node scripts/probar-puntos-qr-f7.mjs`.

`npx turbo run typecheck --force --filter=inventario` limpio (forzado, porque la
caché de turbo puede dar un verde heredado). `npm test`: **571 pruebas en
verde**, 35 archivos. `scripts/generar-rls-envuelta.mjs`: **0 policies por
corregir** de 517. `scripts/auditar-permisos.mjs` sin incoherencias nuevas, y
`scripts/verificar-permisos.mjs`: *«la base de datos concede exactamente lo que
dice /roles»*, sin discrepancias.

### Lo que NO se pudo verificar, y por qué

Para no dar por probado lo que no lo está:

- **Que los correos salgan.** `MANTENIMIENTO_ESTADO` emite el evento con las
  variables nuevas, y eso se ve; que llegue un correo depende de la cuenta de
  correo conectada, que no lo está.
- **El rendimiento con datos encima.** Los planes de las tres vistas se midieron
  (`vw_mant_backlog` 2,6 ms, `vw_mant_plan_proximos` 4,2 ms,
  `vw_mant_indicadores` 0,1 ms) pero con las tablas vacías, así que las cifras
  no significan nada todavía. Lo que sí vale es la forma del plan: los dos
  `LATERAL` de `vw_mant_plan_proximos` usan **índice** (los parciales de
  `plan_id`), que es la parte que crece con el número de órdenes. Lo que recorre
  tabla entera es la expansión de los planes a sus objetos, y eso es inherente a
  lo que la vista hace.

---

## 13. Lo que la fase siguiente necesita saber

**Para F12 (informes).** Las marcas de tiempo nuevas del ticket:
`aceptado_at`, `en_camino_at`, `en_sitio_at`, `aprobado_cliente_at`, y las
generadas `respondido_at`, `sla_respuesta_cumplido`, `sla_solucion_cumplido`.
**No asumas que las tres intermedias están**: son opcionales, y el SLA de
respuesta se corta con la primera que exista. Dos banderas que importan para no
mentir en un informe: `aprobado_tacito` (se aprobó por silencio, no por firma) y
`en_sitio_modo = 'MANUAL'` (nadie escaneó la placa). Y `vw_mant_indicadores` ya
trae lo de §2.4 agrupado por mes y contrato.

**Para cualquier fase que cuelgue algo de `mant_puede_participar()`.** Esa
función **no tiene alcance por contrato** y no se cambió. Si una fase nueva la
usa para una tabla con datos de cliente, tiene que añadir su propia condición
por fila, como hizo F7.

**Para cualquier fase que amplíe un enum.** Los `ADD VALUE` van en un archivo
propio y lo que los use como dato en el siguiente (§3).

**Para quien decida el contrato interno.** Si algún día existe, el orden es:
crear el contrato, rellenar `grupo_id` en los tickets de maquinaria, y recién
entonces `SET NOT NULL`. Mientras no exista, la condición doble de la RLS tiene
que quedarse.

---

## 14. Lo que se arregló después, y lo que enseña

F7 se unió a `master` y se desplegó antes de que volviera la verificación
visual. La verificación encontró dos errores de fondo, y los dos los había
dejado yo. El arreglo está en
[20261028001020_puntos_qr_f7_escaneo_y_backlog.sql](supabase/migrations/20261028001020_puntos_qr_f7_escaneo_y_backlog.sql)
— archivo nuevo, porque la `001010` ya estaba aplicada y viva.

**1. El escaneo de la placa no funcionaba, y fallaba justo al revés de lo que
F7 quería.** La pantalla le pasaba a la base la **URL entera** de la placa
(`https://…/q/<token>`) porque reutilizaba `extraerReferenciaEquipo`, que es el
extractor de la placa de un **equipo propio** (`/equipo/<ref>`) y no reconoce el
segmento `/q/`. Y `ronda_qr` se busca por token exacto. El técnico escaneaba una
placa buena, recibía «esa placa no está registrada» y quedaba empujado a la
apertura manual — que es exactamente la distinción que el estado `EN_SITIO`
existe para proteger.

Qué se hizo:

- `clasificarEscaneoOT()` en [lib/mantenimiento.ts](apps/inventario/lib/mantenimiento.ts)
  decide cuál de las dos clases de placa se escaneó, **reutilizando**
  `codigoDeEscaneo` y `clasificarEntrada` de `packages/ronda-core` (la pieza que
  comparten esta app y la móvil). No se escribió un segundo extractor: el que
  hacía falta ya existía, y el error fue no buscarlo.
- La **RPC** recibe ahora el código (`p_codigo`) y resuelve ella misma el token
  de 21 o el código manual de 8 contra `ronda_qr`. Se hace en la base porque los
  dos códigos están impresos en la misma placa pero viven en columnas distintas,
  y resolverlo en el navegador serían dos caminos donde equivocarse.
- Escanear la placa de un equipo propio sobre una orden de cliente ahora dice
  **cuál** se escaneó, en vez de un «no está registrada» que haría pensar que la
  placa está mala.

**Y un tercer error que salió al arreglar el segundo:** mi primera versión de la
RPC marcaba `en_sitio_modo = 'QR'` cuando el código resolvía, **incluido el
código manual**. Un código manual lo teclea una persona, que puede hacerlo desde
su casa; solo el token leído por la cámara es prueba de presencia. Eso habría
vaciado de contenido la garantía entera sin que nadie lo notara. Ahora la RPC
recuerda por cuál de las dos columnas coincidió y el modo sale de ahí.

**2. El KPI «en curso» podía divergir de su pestaña.**
`vw_mant_backlog.en_curso` enumeraba los seis estados **en positivo** — el mismo
modo de falla silencioso que esta misma fase presume de haber cerrado en el
frontend. Medido en el banco de pruebas: el KPI decía 6 y la pestaña 7. Ahora
cuenta en negativo, como ya hacían `criticos` y `mios`.

**Tres menores, del mismo informe.** «Todos los extintor» pasa a «Cada
extintor» (los nombres de `activo_tipos` están en singular y con géneros
mezclados, así que cualquier artículo fijo se equivoca en la mitad, y «cada»
además dice lo que un plan por tipo hace); `textoFrecuencia` recibe por fin la
unidad del medidor, que existía como parámetro y ninguna llamada pasaba, de modo
que la tabla decía «cada 500 unidades» mientras «Lo que toca» decía «1.200 de
1.500 horas»; una tarea de plan fijada por `plantilla_codigo` y no por id ya no
se dibuja como un guion; y se quitó un punto doble.

### Qué enseña esto

Las dos cosas de fondo tienen el mismo origen: **reutilicé una pieza por su
nombre y no por lo que hace**. `extraerReferenciaEquipo` suena a «saca la
referencia de lo que escaneaste» y hace algo más estrecho. Y `en_curso` se
escribió copiando la lista de estados que ya tenía a mano, en el mismo archivo
donde el comentario de al lado explica por qué eso está mal.

Y las dos **solo se ven ejecutando la pantalla**. Mi script de SQL probaba la
RPC pasándole un `p_qr` ya resuelto, así que nunca ejercitó el camino que el
navegador recorre de verdad. Las pruebas que ahora cubren esto son de los dos
tipos: las cuatro formas del código en
[tests/inventario/mantenimiento-estados.test.ts](tests/inventario/mantenimiento-estados.test.ts)
y, en `scripts/probar-puntos-qr-f7.mjs`, una placa emitida de verdad con la que
se comprueba que el token abre en modo `QR`, que el código manual abre pero
**no** cuenta como escaneo, que la URL entera se rechaza y que la placa de otro
punto no sirve.

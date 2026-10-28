# F7 — Planes preventivos y órdenes de trabajo: propuesta de estados

Este documento es el **primer entregable de F7**, el que §6 del
[complemento 2](docs/puntos-qr-whatsapp/02-complemento-2-integracion.md) exige
antes del SQL: *«F7 toca un módulo en producción (`/mantenimiento`): su primer
entregable es el acuerdo sobre los estados nuevos, no el SQL»*. No hay migración
escrita, no se tocó el enum y no se cambió ninguna pantalla. Lo que sigue es la
propuesta, lo que se rompe si se decide al revés, y las seis preguntas que
necesito que respondas para empezar.

---

## 0. Lo primero: un dato que cambia el tamaño del riesgo

Consulté la base antes de proponer nada. **Hoy hay cero tickets de
mantenimiento.**

| Qué conté | Cuánto hay |
|---|---|
| `mantenimiento_tickets` | **0** filas |
| `mantenimiento_actividades` | **0** filas |
| `maquinaria` activa y no dada de baja | **119** equipos |
| `maquinaria` con `proximo_mant` puesto | **0** |
| `activos` (los de F6) | **0** |

El módulo está **en producción como código** —la pantalla existe, los permisos
existen, dos roles los tienen— pero **todavía no tiene datos**. Eso cambia dónde
está el peligro:

- **No hay riesgo de migración de datos.** No hay ninguna fila que haya que
  reinterpretar, ningún histórico que se pueda quedar en un estado que la
  pantalla nueva no sepa dibujar. El párrafo de §10.2 («tocar `/mantenimiento`
  en producción puede romper el tablero de maquinaria») sigue valiendo, pero por
  el código, no por los datos.
- **El riesgo real son las pantallas y el alcance por contrato.** Hay cinco
  sitios en el código con la lista de estados escrita a mano; un estado nuevo que
  no esté en esas listas no rompe nada con un error: hace que el ticket
  **desaparezca del tablero sin avisar**, que es peor. Y `mantenimiento_tickets`
  no tiene **ningún** alcance por contrato en su RLS: el día que exista la
  primera orden de trabajo de un cliente, cualquiera con `ver_mantenimiento` la
  lee, de cualquier cliente.
- **Y hay una ventana que no se va a repetir.** Con cero filas, los cambios que
  normalmente serían delicados —`maquinaria_id` nullable, `grupo_id` NOT NULL,
  reescribir `mant_generar_preventivos`— se pueden hacer ahora casi sin costo. Si
  esperamos a que el módulo se llene, `grupo_id NOT NULL` deja de ser posible sin
  un rellenado a mano.

Por eso mi recomendación es más ambiciosa de lo que sería con datos encima: hacer
el cambio **completo** ahora, incluido el alcance por contrato, en vez de dejarlo
«para después» como sugería §2.4 («`grupo_id` se agrega, nullable al principio»).
La pregunta 5 lo pone a tu decisión.

---

## 1. Qué hay hoy, exactamente

### El enum

[`20260914000000_mantenimiento_maquinaria.sql:68`](supabase/migrations/20260914000000_mantenimiento_maquinaria.sql) —
siete valores, en este orden:

```
ABIERTO · RECIBIDO · EN_PROCESO · EN_ESPERA · RESUELTO · CERRADO · CANCELADO
```

### Quién los cambia

Una sola función: **`mant_transicion(p_ticket, p_accion, …)`**
([`:364`](supabase/migrations/20260914000000_mantenimiento_maquinaria.sql)), con
ocho acciones. Ninguna pantalla hace `UPDATE` sobre `estado` — todo pasa por la
RPC, que vuelve a validar permisos. Eso es una ventaja grande: **el autómata está
en un solo sitio**.

| Acción | Desde | A | Quién puede |
|---|---|---|---|
| `RECIBIR` | `ABIERTO` | `RECIBIDO` | técnico o jefe |
| `ASIGNAR` | cualquiera menos cerrado | no cambia (o `ABIERTO`→`RECIBIDO`) | jefe; el técnico solo a sí mismo |
| `INICIAR` | `ABIERTO`, `RECIBIDO`, `EN_ESPERA` | `EN_PROCESO` | técnico o jefe |
| `ESPERA` | `EN_PROCESO` | `EN_ESPERA` | técnico o jefe; exige nota |
| `RESOLVER` | `RECIBIDO`, `EN_PROCESO`, `EN_ESPERA` | `RESUELTO` | técnico o jefe; exige solución |
| `CERRAR` | `RESUELTO` | `CERRADO` | técnico, personal de sede o quien reportó |
| `REABRIR` | `RESUELTO` | `EN_PROCESO` | igual que cerrar; exige nota |
| `CANCELAR` | cualquiera menos `RESUELTO`/cerrado | `CANCELADO` | jefe, o quien reportó si está `ABIERTO` |

Además de mover el estado, cada acción **toca la ficha del equipo**: `INICIAR`
pone la máquina en `MANTENIMIENTO`, `RESOLVER` la devuelve a `OPERATIVA` y le
pone `ultimo_mant_at`, `CANCELAR` la libera si no quedan otros tickets abiertos.
Eso es exactamente lo que no se puede hacer con un activo del cliente, y es el
nudo del que cuelga medio documento (§5).

### Las cinco listas de estados escritas a mano

| Dónde | Línea | Qué lista |
|---|---|---|
| [`lib/mantenimiento.ts`](apps/inventario/lib/mantenimiento.ts:11) | 11 | `ESTADO_TICKET_META`: etiqueta y color de cada estado |
| [`lib/mantenimiento.ts`](apps/inventario/lib/mantenimiento.ts:20) | 20 | `ESTADOS_TICKET_ACTIVOS` |
| [`mantenimiento/page.tsx`](apps/inventario/app/(dashboard)/mantenimiento/page.tsx:37) | 37 | `.in('estado', [...])` — de aquí salen los cinco KPI del backlog |
| [`TableroClient.tsx`](apps/inventario/app/(dashboard)/mantenimiento/TableroClient.tsx:34) | 34–39 | las cuatro pestañas del tablero y `ACTIVOS` |
| [`equipo/EquipoBuscar.tsx`](apps/inventario/app/(dashboard)/equipo/EquipoBuscar.tsx:19) | 19 | contador de «tickets abiertos» del buscador de campo |
| [`equipo/[ref]/EquipoCampoClient.tsx`](apps/inventario/app/(dashboard)/equipo/[ref]/EquipoCampoClient.tsx:54) | 54 | `ACTIVOS` de la ficha de campo |
| [`lib/types/database.ts`](apps/inventario/lib/types/database.ts:836) | 836 | `EstadoTicketMant`, el tipo de TypeScript |

Las de `TableroClient` son las que importan: **las pestañas no tienen un "otros"**.
Un ticket cuyo estado no esté en ninguna de las cuatro listas no aparece en
ninguna pestaña. No da error: se esfuma.

---

## 2. Los estados nuevos que propongo

§4.2 propone cuatro valores nuevos y yo los mantengo tal cual. El mapeo completo
de los diez estados de §2.3 del complemento 1 queda así:

| §2.3 dice | Valor del enum | ¿Nuevo? | Quién lo pone | Solo para OT |
|---|---|---|---|---|
| creada | `ABIERTO` | existe | quien reporta o el plan | no |
| asignada | `RECIBIDO` | existe | jefe o el propio técnico | no |
| **aceptada** | **`ACEPTADO`** | **nuevo** | el técnico asignado, nadie más | sí |
| **en camino** | **`EN_CAMINO`** | **nuevo** | el técnico asignado | sí |
| **en sitio** | **`EN_SITIO`** | **nuevo** | lo pone el **escaneo del QR**, no un botón | sí |
| en ejecución | `EN_PROCESO` | existe | el técnico | no |
| pausada | `EN_ESPERA` | existe | el técnico, con motivo | no |
| terminada | `RESUELTO` | existe | el técnico, con solución | no |
| **aprobada por el cliente** | **`APROBADO_CLIENTE`** | **nuevo** | el cliente, con firma | sí |
| cerrada | `CERRADO` | existe | ver pregunta 2 | no |
| *(no está en §2.3)* | `CANCELADO` | existe | jefe | no |

Once valores en total. Tres cosas que vale la pena decir de este cuadro:

**`EN_SITIO` no es un botón, es una consecuencia.** La diferencia entre «digo que
llegué» y «llegué» es el QR. F4 ya resuelve eso: abrir la visita exige escanear
la placa y validar la geocerca. Así que `EN_SITIO` lo escribe la RPC que abre la
visita de la orden, no una acción que el técnico pueda pulsar desde su casa. Es
el único estado de los cuatro que trae una garantía real; los otros tres son
declarativos y valen lo que vale la palabra del técnico, que ya es bastante para
medir el SLA de respuesta.

**`APROBADO_CLIENTE` va entre `RESUELTO` y `CERRADO`, no en lugar de `CERRADO`.**
«Terminada» la declara el técnico; «aprobada» la declara el cliente; «cerrada» es
el acto administrativo de la empresa, que es el que corta el SLA de solución y
congela los costos. Son tres hechos distintos con tres responsables distintos y
no conviene fundirlos.

**El orden del enum.** `ALTER TYPE … ADD VALUE` permite `BEFORE` / `AFTER`, y
propongo usarlo para que el enum quede en orden de ciclo de vida:

```
ABIERTO · RECIBIDO · ACEPTADO · EN_CAMINO · EN_SITIO · EN_PROCESO ·
EN_ESPERA · RESUELTO · APROBADO_CLIENTE · CERRADO · CANCELADO
```

No es cosmético: el índice `idx_mant_tickets_estado(estado, prioridad)` ordena por
el enum, y un `ORDER BY estado` futuro o un `BETWEEN` sobre el enum daría un
resultado absurdo si los cuatro valores nuevos quedaran pegados al final después
de `CANCELADO`. Hoy nada del repositorio ordena por `estado` (el tablero ordena en
JavaScript), así que el orden se puede elegir sin romper nada — pero solo ahora,
porque añadir en medio es gratis y reordenar después no existe.

### La trampa que obliga a dos migraciones

PostgreSQL 17 (la base corre 17.6) **permite** `ALTER TYPE … ADD VALUE` dentro de
una transacción, pero **prohíbe usar el valor nuevo en esa misma transacción**.
Y `scripts/apply-migrations.mjs` envuelve cada archivo en un `BEGIN … COMMIT`
único.

Consecuencia: si los valores nuevos y cualquier cosa que los mencione *como
dato* —una fila sembrada, un `CHECK`, una vista con `WHERE estado = 'ACEPTADO'`—
van en el mismo archivo, la migración falla con *«unsafe use of new value of enum
type»*. Así que F7 necesita **dos archivos**, en este orden:

| Archivo | Qué lleva |
|---|---|
| `20261028001000_puntos_qr_f7_estados.sql` | **solo** los cuatro `ADD VALUE … AFTER …` |
| `20261028001010_puntos_qr_f7_ot.sql` | todo el resto: tablas, columnas, `mant_transicion`, RLS, vistas, permisos |

El cuerpo de una función es texto que no se evalúa al crearla, así que la
`mant_transicion` reescrita sí puede nombrar los valores nuevos; el problema son
los literales que Postgres castea al aplicar. Separar los archivos cuesta nada y
no separarlos cuesta una migración a medias.

---

## 3. Las transiciones válidas

La regla de oro es **una sola**, y de ella sale todo lo demás:

> Los estados nuevos son **opcionales**. Ninguna transición que hoy funciona deja
> de funcionar, y el camino corto de siempre (`ABIERTO → RECIBIDO → EN_PROCESO →
> RESUELTO → CERRADO`) sigue existiendo tal cual para el ticket correctivo de
> maquinaria.

Con eso, el autómata propuesto:

```
                    ┌───────── CANCELADO (jefe, mientras no esté RESUELTO)
                    │
ABIERTO ──RECIBIR──► RECIBIDO ──ACEPTAR──► ACEPTADO ──SALIR──► EN_CAMINO
   │                    │                     │                    │
   │                    │                     │              (escanea el QR)
   │                    └──────INICIAR────────┴────────┐           │
   │                                                   ▼           ▼
   └──────────────INICIAR──────────────────────────► EN_PROCESO ◄─ EN_SITIO
                                                       │  ▲         │
                                                  ESPERA  INICIAR   │
                                                       ▼  │      INICIAR
                                                    EN_ESPERA        │
                                                       │             │
                                                  RESOLVER ◄─────────┘
                                                       ▼
                                                   RESUELTO
                                                    │     │
                                      APROBAR_CLIENTE   REABRIR ──► EN_PROCESO
                                                    ▼
                                            APROBADO_CLIENTE
                                                    │
                                                 CERRAR
                                                    ▼
                                                 CERRADO
```

Acciones nuevas de `mant_transicion`, con sus guardas:

| Acción | Desde | A | Quién | Guarda |
|---|---|---|---|---|
| `ACEPTAR` | `RECIBIDO` | `ACEPTADO` | **solo `asignado_a`** | que haya alguien asignado; marca `aceptado_at` (corta el SLA de respuesta) |
| `SALIR` | `ACEPTADO` | `EN_CAMINO` | solo `asignado_a` | marca `en_camino_at` |
| *(sin acción)* | `ACEPTADO`, `EN_CAMINO`, `RECIBIDO` | `EN_SITIO` | lo escribe la RPC de apertura de visita | que el QR verifique y la geocerca valide; marca `en_sitio_at` |
| `APROBAR_CLIENTE` | `RESUELTO` | `APROBADO_CLIENTE` | ver pregunta 1 | exige firma o nombre; marca `aprobado_cliente_at` |

Y los tres cambios a las transiciones existentes:

1. **`INICIAR` acepta tres estados más** (`ACEPTADO`, `EN_CAMINO`, `EN_SITIO`)
   además de los de hoy. Es el «camino corto»: el técnico que no quiere pulsar
   cuatro botones pasa de `RECIBIDO` a `EN_PROCESO` como siempre.
2. **`RESOLVER` acepta `EN_SITIO`** (una inspección que se resuelve sin «ejecutar»
   nada), además de los tres de hoy.
3. **`CERRAR`** es la que cambia según la pregunta 2. Si la aprobación es
   obligatoria, solo acepta `APROBADO_CLIENTE` para una OT y sigue aceptando
   `RESUELTO` para un correctivo de maquinaria. Si es opcional, acepta los dos
   siempre.

**`CANCELAR` y `REABRIR` no cambian**: cancelar sigue valiendo desde cualquier
estado no resuelto (ahora también desde los tres nuevos), y reabrir sigue
volviendo a `EN_PROCESO`. Lo único que agrego a `REABRIR` es escribir
`reabierto_de` —la columna que §4.2 pide para el indicador de reaperturas—,
aunque reabrir en el mismo ticket y además dejar el enlace es redundante; lo
anoto como detalle de implementación, no como decisión.

---

## 4. Qué pasa con los tickets que ya existen

Hoy, nada: son cero. Pero la respuesta de diseño tiene que valer igual para los
que entren entre esta propuesta y la migración, así que:

**Ninguna fila se mueve de estado.** No hay `UPDATE` de datos en F7. `ADD VALUE`
es aditivo: los siete valores de hoy conservan su nombre, su significado y su
posición relativa. Un ticket en `EN_PROCESO` sigue en `EN_PROCESO`.

**Los cuatro estados nuevos son inalcanzables para un ticket de maquinaria** a
menos que alguien use las acciones nuevas a propósito. No propongo prohibirlo
—que un técnico marque «en camino» a reparar una hidrolavadora es razonable y no
estorba— pero el tablero no lo va a pedir nunca para un correctivo.

**Lo que sí hay que rellenar, y hoy es gratis:**

| Columna | Hoy | Propuesta | Por qué ahora |
|---|---|---|---|
| `maquinaria_id` | `NOT NULL` | nullable + `CHECK (maquinaria_id IS NOT NULL OR activo_id IS NOT NULL)` | con cero filas el `CHECK` entra sin validar nada |
| `grupo_id` | no existe | **`NOT NULL`**, no nullable (ver pregunta 5) | con cero filas se puede exigir; con mil, no |
| `activo_id`, `plan_id`, `origen`, SLA, firmas, costos | no existen | se agregan con `DEFAULT` | ninguna es obligatoria para un correctivo |

**Y hay cuatro sitios en SQL que hoy dan por hecho que `maquinaria_id` nunca es
nulo.** Esto es lo más fácil de pasar por alto, porque ninguno falla con un error
claro:

| Dónde | Línea | Qué pasa con una OT de activo |
|---|---|---|
| `mant_transicion` | [`:392`](supabase/migrations/20260914000000_mantenimiento_maquinaria.sql) | `SELECT * INTO m FROM maquinaria WHERE id = t.maquinaria_id` no encuentra nada, y al final llama `maq_evento(m.id, …)` con `m.id` nulo. **`maquinaria_eventos.maquinaria_id` es `NOT NULL`** (lo verifiqué en la base), así que la transición **falla con un error de restricción** a mitad de camino. Hay que partir la función: la parte del equipo solo corre si hay equipo. |
| `mant_notificar` | [`:275`](supabase/migrations/20260914000000_mantenimiento_maquinaria.sql) | `JOIN maquinaria` es un **INNER** join: no devuelve filas, `v` queda nulo y se emite una notificación con payload vacío. No lanza excepción (y aunque lo hiciera, la función se la traga a propósito). Falla **en silencio**. Pasa a `LEFT JOIN`, con los datos del activo por el otro lado. |
| `mant_reportar` | [`:287`](supabase/migrations/20260914000000_mantenimiento_maquinaria.sql) | recibe `p_maquinaria` obligatorio y falla con «Equipo no encontrado». Necesita una variante para activo, o un parámetro más. |
| `mantenimiento_actividades` | [`:186`](supabase/migrations/20260914000000_mantenimiento_maquinaria.sql) | `maquinaria_id NOT NULL`: la actividad de una OT sobre un activo **no tiene dónde guardarse**. Mi propuesta es no tocar esta tabla y que la bitácora de la OT viva en el motor de F4 (`ronda_visitas` + `ronda_respuestas` + `ronda_evidencias`), que es más completo. |

Y uno en TypeScript: [`TicketClient.tsx:24`](apps/inventario/app/(dashboard)/mantenimiento/[id]/TicketClient.tsx)
declara `maquinaria` **no nullable** y [`:53`](apps/inventario/app/(dashboard)/mantenimiento/[id]/TicketClient.tsx)
lee `t.maquinaria.estado` sin guarda — la ficha de un ticket de activo lanza
`TypeError` en el servidor y devuelve un 500. El tablero sí está bien: ya lo tipa
nullable y usa `?.` en todas partes.

---

## 5. Cómo conviven la orden de trabajo y el ticket de hoy

**Una sola tabla, un solo autómata, un solo chat.** `mantenimiento_tickets` es la
orden de trabajo; la OT no es una tabla nueva. Eso es lo que dice §4.2 («no se
construye un segundo flujo de ejecución») y lo sostengo: el chat, los adjuntos,
las notificaciones, la bitácora y el tablero ya existen y funcionan, y duplicarlos
sería duplicar también cada arreglo futuro.

Lo que distingue una OT de un ticket de maquinaria es **de qué cuelga**, y se lee
de las columnas, sin bandera nueva:

| | Ticket de maquinaria (hoy) | Orden de trabajo (F7) |
|---|---|---|
| objeto | `maquinaria_id` | `activo_id` |
| dueño | la empresa | el cliente |
| contrato | `grupo_id` nulo | `grupo_id` del activo |
| de dónde sale | reporte de una persona | `origen`: `PLAN`/`VISITA`/`PQRS`/`CLIENTE`/`BOT`/`IOT` |
| estados que usa | los siete de siempre | los once |
| ejecución | registrar actividad en la ficha | **visita** del motor de F4 |
| cierre | el reportante confirma | el cliente aprueba y firma |
| efecto lateral | mueve `maquinaria.estado` | mueve `activos.estado` |

Donde «la OT es una visita» se complica, y conviene saberlo antes de prometerlo:

- **`ronda_visitas.punto_id` es `NOT NULL`**, y **`activos.punto_id` es nullable**.
  Un activo que no esté asociado a un punto de control **no puede tener visita**,
  así que su OT no puede ejecutarse con el motor de F4. Son dos salidas: o el
  punto pasa a nullable en `ronda_visitas` con un `CHECK` de punto **o** activo
  (simétrico al de `ronda_qr` que hizo F6), o la pantalla obliga a que todo activo
  con plan tenga punto. Recomiendo la primera: es el mismo patrón que ya aceptamos
  dos veces y no le pone deberes al usuario.
- **`ronda_visitas.plantilla_id` es `NOT NULL`**. La OT necesita una plantilla; de
  ahí que `mant_plan_tareas` apunte a `ronda_plantillas` y que un plan sin tareas
  no se pueda ejecutar. Para la OT correctiva sin plan hace falta una plantilla
  genérica («atención de falla») sembrada con `grupo_id IS NULL`.
- **`ronda_firmas.visita_id` es `NOT NULL`**. La firma del cliente solo existe
  colgada de una visita. Si una OT se puede cerrar sin visita (un proveedor
  externo que manda su acta en PDF, por ejemplo), entonces `firma_cliente_id` no
  sirve para ese caso y la aprobación tiene que poder ser solo
  `aprobado_cliente_nombre` + `aprobado_cliente_at`, como §4.2 ya prevé al listar
  las dos cosas por separado. Es la pregunta 1.

**El proveedor externo.** F6 dejó la decisión abierta y aquí la cierro así:
`proveedor_id` en el ticket significa **quién ejecuta**, distinto del
`activos.proveedor_id`, que significa quién lo instaló o lo garantiza. Un
proveedor externo **no tiene sesión** en el sistema en esta entrega: la OT se le
asigna como dato (`proveedor_id` + nota), y un usuario interno registra lo que el
proveedor hizo. Darle sesión es el papel `PROVEEDOR` de `usuario_grupos`, que es
el pendiente 8 de §10.1 y no propongo abrirlo en F7.

**El alcance por contrato: el punto que de verdad me preocupa.**
`mant_puede_participar()`
([`:233`](supabase/migrations/20260914000000_mantenimiento_maquinaria.sql)) es
`auth_permiso_any({ver_mantenimiento, reportar_falla_maquinaria,
atender_mantenimiento, gestionar_mantenimiento})` y **nada más**. De ella cuelga
la política de lectura de tickets
([`:653`](supabase/migrations/20260914000000_mantenimiento_maquinaria.sql)), la de
mensajes, la de actividades y las cuatro de storage. Hoy los roles Auditor,
Supervisor de Conserjería y Coordinador tienen `ver_mantenimiento`.

Mientras todos los tickets sean de maquinaria propia, eso es defendible. En el
momento en que exista una OT de un cliente, **cualquiera de esos roles lee las
órdenes, el chat y las fotos de todos los clientes**. Es el mismo razonamiento por
el que §4.2 decidió no meter los activos en `maquinaria`; si F7 cuelga la OT de
`mant_puede_participar()` sin cambiarla, el agujero que F6 evitó se abre por la
otra puerta.

Mi propuesta es **no tocar `mant_puede_participar()`** —el módulo de maquinaria
sigue como está— y añadir a la política de lectura una condición por fila que
solo muerde cuando el ticket es de un cliente:

```
mant_puede_participar()
AND (grupo_id IS NULL OR auth_ve_grupo(grupo_id))
```

Un ticket de maquinaria (`grupo_id IS NULL`) se comporta exactamente como hoy; una
OT exige contrato al alcance. Y envuelto en `(select …)`, como exige el
repositorio, para que se evalúe una vez por consulta y no una por fila —
`scripts/generar-rls-envuelta.mjs` reporta 0 pendientes y tiene que seguir en 0.
Si `grupo_id` es `NOT NULL` desde el principio (pregunta 5), la condición se
simplifica a solo `auth_ve_grupo(grupo_id)` y el ticket de maquinaria lleva el
contrato interno de la empresa.

---

## 6. Qué pantallas hay que tocar

| Archivo | Qué cambia | Si no se toca |
|---|---|---|
| [`lib/mantenimiento.ts:11`](apps/inventario/lib/mantenimiento.ts) | cuatro entradas en `ESTADO_TICKET_META` | la insignia sale gris con el nombre crudo del enum (`EN_CAMINO`). Ya hay `?? t.estado`, así que es lo único que **no** se cae |
| [`lib/mantenimiento.ts:20`](apps/inventario/lib/mantenimiento.ts) | `ESTADOS_TICKET_ACTIVOS` + los cuatro | — |
| [`mantenimiento/page.tsx:37`](apps/inventario/app/(dashboard)/mantenimiento/page.tsx) | `.in('estado', …)` + los cuatro; y el conteo en SQL, no trayendo filas (el tope de 8 s) | los cinco KPI del backlog **no cuentan** las OT en curso |
| [`TableroClient.tsx:34-39`](apps/inventario/app/(dashboard)/mantenimiento/TableroClient.tsx) | las cuatro pestañas y `ACTIVOS` | una OT en `ACEPTADO`/`EN_CAMINO`/`EN_SITIO`/`APROBADO_CLIENTE` **no aparece en ninguna pestaña**. Es el peor de todos: sin error y sin rastro |
| [`TicketClient.tsx:24,27,53,62-80`](apps/inventario/app/(dashboard)/mantenimiento/[id]/TicketClient.tsx) | `maquinaria` nullable, `Accion` + las cuatro nuevas, botones por estado, bloque de activo | la ficha de una OT de activo da **500** en `t.maquinaria.estado` |
| [`equipo/EquipoBuscar.tsx:19`](apps/inventario/app/(dashboard)/equipo/EquipoBuscar.tsx) · [`EquipoCampoClient.tsx:54`](apps/inventario/app/(dashboard)/equipo/[ref]/EquipoCampoClient.tsx) | las dos listas `ACTIVOS` | el contador de «tickets abiertos» del equipo queda corto |
| [`lib/types/database.ts:836`](apps/inventario/lib/types/database.ts) | `EstadoTicketMant` + las columnas nuevas | `npm run typecheck` protesta |
| **nuevas** | `/mantenimiento/planes` (planes y tareas) y el bloque de materiales + firma en la ficha | — |
| [`rondas/activos`](apps/inventario/app/(dashboard)/rondas/activos) | «reportar falla de este equipo» y las OT del activo en su ficha | el activo no tiene por dónde entrar al mantenimiento |

Las dos rutas nuevas pasan por la lista de la skill `nuevo-modulo` (permiso en
`/roles`, RLS con `auth_permiso()` también en lectura, entrada de menú, paginado,
verificación en el navegador).

**Un detalle operativo de hoy que conviene no perder:**
`mant_generar_preventivos` **no la llama ningún cron** — es un botón del tablero
([`TableroClient.tsx:146`](apps/inventario/app/(dashboard)/mantenimiento/TableroClient.tsx)),
disparado a mano por el jefe de mantenimiento. Al reescribirla para que lea
`mant_planes` hay que decidir si sigue siendo un botón o pasa al cron de cinco
minutos. Recomiendo **dejarla como botón en F7** y no meterla al cron: §10.2 ya
avisa que ese cron «no es una cola» y que ahora tendría que mover envíos masivos,
informes y preventivos. Un botón que se puede pulsar dos veces sin daño (la
función ya evita duplicar el preventivo abierto del mismo objeto) es más seguro
que una cola que no existe.

---

## 7. Qué se rompe si la decisión se toma al revés

**Si la OT va en su propia tabla con su propio enum.** Es la alternativa
razonable y la descarto por lo que cuesta, no porque no funcione: dos bandejas de
entrada en vez de una, dos chats que hay que mantener en paralelo, la novedad de
F4 (`ronda_novedades.ticket_id`) tendría que elegir a cuál de las dos apunta, los
indicadores de §2.4 (MTTR, backlog, SLA) saldrían de un `UNION` de dos tablas con
semánticas distintas, y F12 heredaría ese `UNION` para siempre. Y el usuario
tendría dos sitios donde buscar «el mantenimiento del ascensor». Lo único que se
gana es no tocar producción — y con cero tickets, no tocar producción vale mucho
menos de lo que parecía.

**Si en vez de agregar valores se renombran o se reinterpretan los de hoy.**
Postgres no tiene forma segura de renombrar un valor de enum con datos encima
(`ALTER TYPE … RENAME VALUE` existe, pero deja todas las cadenas literales del
código apuntando a un nombre que ya no está), y reinterpretar `EN_ESPERA` como
«en camino» rompe el significado del histórico sin dejar rastro. Con cero filas
sería técnicamente posible y sigue siendo mala idea: el enum es el vocabulario que
la empresa va a leer en los informes durante años.

**Si los tres estados intermedios son obligatorios para una OT.** Es decir, si
`INICIAR` deja de aceptar `RECIBIDO` cuando el ticket es una orden. El resultado
práctico: el técnico que llega al sitio y arranca a trabajar tiene que pulsar
`ACEPTAR`, `SALIR`, esperar a que el QR lo ponga `EN_SITIO` y luego `INICIAR`.
En campo, con una mano ocupada, eso se traduce en que **nadie los marca y los
tiempos de SLA salen todos pegados al mismo instante**, lo que es peor que no
medirlos: un indicador que miente es un indicador que se usa. Propongo
opcionales, y que el SLA de respuesta se corte con el **primero** de
`aceptado_at`, `en_sitio_at` o `iniciado_at` que exista.

**Si `APROBADO_CLIENTE` es obligatorio para cerrar.** El riesgo es el inverso del
anterior: las OT se quedan **atascadas en `RESUELTO` para siempre** cuando el
cliente no contesta, el backlog crece con trabajo que ya se hizo, el SLA de
solución nunca se corta y a los tres meses alguien pide «un botón para cerrar sin
el cliente», que es exactamente la excepción que haría inútil la regla. Si la
aprobación va a ser obligatoria tiene que venir con **aprobación tácita**: un
plazo por contrato (`grupo_sla` ya tiene `respuesta_horas`, `solucion_horas` y
`horas_habiles`, y PQRS ya resolvió el calendario de días hábiles) tras el cual
la OT se da por aprobada y queda registrado que fue por silencio, no por firma.
Es la pregunta 2 y es la que más me importa de las seis.

**Si los `ADD VALUE` van en el mismo archivo que el resto.** La migración falla
con *«unsafe use of new value of enum type»* y, como el script hace `ROLLBACK`, no
queda nada aplicado — es el caso menos malo, porque falla ruidosamente. Pero si
el archivo logra colarse por tener los literales solo dentro de cuerpos de
función, lo que queda es un enum ampliado sin la mitad del módulo, y la segunda
pasada se encuentra un estado intermedio raro.

**Si `maquinaria_id` se queda `NOT NULL`** (es decir, si la OT de un activo se
cuelga de un `maquinaria` falso o se queda sin ticket). La primera salida obliga a
inventar una fila de maquinaria por cada activo del cliente y a que
`maquinaria.estado` —que tiene `BAJA` y semántica patrimonial— signifique dos
cosas; la segunda deja la OT sin chat, sin notificaciones y sin tablero. Las dos
reabren precisamente la decisión que §4.2 razonó al separar `activos` de
`maquinaria`.

**Si `grupo_id` nace nullable «para después».** Es lo que §2.4 propuso, y con
datos encima sería lo correcto. Hoy, con cero filas, nullable significa que la
política de RLS tiene que llevar para siempre el `grupo_id IS NULL OR …`, que
cada consulta nueva tiene que recordar el caso nulo, y que el día que se quiera
exigir habrá que rellenar a mano. La ventana para pedirlo `NOT NULL` está abierta
exactamente ahora.

---

## 8. Lo que necesito que decidas

Seis preguntas. Para cada una digo qué haría yo, y con un «sigue con tu
recomendación» arranco.

1. **¿Quién aprueba la OT por el cliente, y cómo?** Es el pendiente 7 de §10.1.
   *Recomiendo:* firma en el sitio (`ronda_firmas` con `quien = 'CLIENTE'`, que ya
   existe) cuando hay visita, y nombre + cargo + fecha (`aprobado_cliente_nombre`)
   cuando no la hay, por ejemplo con un proveedor externo. Sin usuario con sesión
   para el cliente en esta entrega.
2. **¿La aprobación del cliente es obligatoria para cerrar?** *Recomiendo:*
   **sí para las OT de activos de cliente, no para los tickets de maquinaria
   propia, y con aprobación tácita por plazo de contrato.** Si prefieres
   obligatoria sin plazo, lo hago, pero cuento con que en seis meses haya órdenes
   viejas en `RESUELTO` y el indicador de SLA no sirva.
3. **¿Los tres estados intermedios (`ACEPTADO`, `EN_CAMINO`, `EN_SITIO`) son
   opcionales?** *Recomiendo:* opcionales, con el SLA de respuesta cortado por el
   primero que exista.
4. **¿`EN_SITIO` solo lo escribe el escaneo del QR?** *Recomiendo:* sí, y sin
   botón manual. Si quieres un botón para el caso del QR ilegible, que escriba
   `EN_SITIO` con `apertura_manual = true` como ya hace F4 con el código impreso,
   para que se distingan en el informe.
5. **¿`mantenimiento_tickets.grupo_id` nace `NOT NULL` o nullable?**
   *Recomiendo:* `NOT NULL`, aprovechando que hay cero filas, con el contrato
   interno de la empresa para los tickets de maquinaria propia. Si no existe ese
   contrato interno, entonces nullable con la condición doble en la RLS.
6. **¿El alcance por contrato en la lectura de tickets entra en F7 o después?**
   Es el pendiente 1 de §10.1, el que el documento llama «el cambio más delicado
   de todo el complemento». *Recomiendo:* **en F7**, con la condición por fila que
   describí en §5 y sin tocar `mant_puede_participar()`. Entrar después significa
   que entre F7 y ese momento las órdenes de todos los clientes son legibles por
   todos los roles con `ver_mantenimiento`.

Con las respuestas, el segundo tiempo es: `mant_planes`, `mant_plan_tareas`,
`mant_materiales` con su movimiento de inventario por el camino que ya existe
(`cantidad_disp = cantidad_real − reservado` por triggers), las columnas y los
estados nuevos, el SLA, la firma y el proveedor, en los dos archivos de migración
del bloque reservado `20261028001000`–`20261028001099`.

---

## Anexo — lo que verifiqué para escribir esto

- Los conteos de la tabla de §0, con una consulta de solo lectura contra la base
  real por `DIRECT_URL`. También la versión (PostgreSQL 17.6) y que
  `maquinaria_eventos.maquinaria_id` es `NOT NULL`.
- El enum, las ocho acciones de `mant_transicion` y las cuatro funciones que dan
  por hecho `maquinaria_id`, leídas en
  [`20260914000000_mantenimiento_maquinaria.sql`](supabase/migrations/20260914000000_mantenimiento_maquinaria.sql).
- Las siete listas de estados escritas a mano en el código, buscadas una por una.
- Que `mant_generar_preventivos` no la llama ningún cron: su único invocador es
  el botón de `TableroClient`.
- Que `ronda_visitas` **no** tiene todavía `ticket_id` (F7 lo agrega), que su
  `punto_id` y su `plantilla_id` son `NOT NULL`, y que `ronda_firmas.visita_id`
  es `NOT NULL`.
- `activo_en_alcance()`, `activo_tipos.obligatorio_normativo`,
  `activo_medidores.valor_actual`/`valor_alerta` y
  `vw_activos_medidor_vencido`, en la migración de F6 y en su nota de cambios.
- Que `scripts/apply-migrations.mjs` envuelve cada archivo en una sola
  transacción, de donde sale la necesidad de dos migraciones.

No apliqué nada, no creé datos de muestra y no modifiqué ninguna pantalla.

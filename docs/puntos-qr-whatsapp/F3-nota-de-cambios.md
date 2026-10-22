# F3 — Catálogo parametrizable de trabajo y asignaciones

Tercera fase del módulo de Puntos QR, Tareas y Bot de WhatsApp. Se construyó en
paralelo con F2 (zonas, puntos y QR), en una rama cortada de la de F1.

Lo que esta fase contesta es **qué trabajo hay que hacer**: qué clases de
actividad existen, cómo se hace cada una paso a paso, con qué material se
explica, y en qué punto, cada cuánto, en qué horario y quién responde. Ejecutar
el trabajo es F4; aquí no se ejecuta nada.

Fuentes: §2.3 y el ADR-C de
[00-exploracion-y-plan.md](docs/puntos-qr-whatsapp/00-exploracion-y-plan.md),
§2.4, §4.1 y §4.5 de
[02-complemento-2-integracion.md](docs/puntos-qr-whatsapp/02-complemento-2-integracion.md),
y [03-nomenclatura.md](docs/puntos-qr-whatsapp/03-nomenclatura.md), que manda en
los nombres. Ninguno de esos documentos se tocó: son de otras sesiones.

---

## 1. La migración `20261019000030_puntos_qr_f3_catalogo.sql`

**Verificada en transacción, SIN aplicar.** Cinco tablas, con `grupo_id` según
la §2.4: **nullable en los tres catálogos** (donde `NULL` significa «aplica a
todos los contratos») y **`NOT NULL` en las asignaciones**, que además llevan
`sede_id NOT NULL`.

| Tabla | `grupo_id` | Qué guarda |
|---|---|---|
| `ronda_tipos_actividad` | nullable | qué clases de actividad existen, con icono, color y categoría |
| `ronda_instructivos` | nullable | el material que explica cómo se hace, versionado |
| `ronda_plantillas` | nullable | la actividad **versionada**: cada versión es una fila |
| `ronda_plantilla_pasos` | — | los pasos ordenados; hereda el alcance de la plantilla |
| `ronda_asignaciones` | NOT NULL | qué plantilla, en qué punto, cuándo y quién |

RLS en las cinco **y también en las lecturas**, con `auth_permiso*()` como exige
el repositorio. El alcance de los catálogos es «el contrato está en
`auth_grupos()` **o** `grupo_id IS NULL`»; el de las asignaciones, `auth_grupos()`
a secas. Cuatro funciones de acceso al estilo de las de F1
(`ronda_catalogo_acceso()`, `ronda_catalogo_gestiona()`,
`ronda_asignaciones_acceso()`, `ronda_asignaciones_gestiona()`) para que las
políticas no repitan la lista de claves.

### 1.1 Los tipos de actividad son una tabla sembrada, no un enum

Se siembran las ocho que nombró el usuario, todas en el catálogo general:
`ASEO` (limpieza), `DESINFECCION`, `RONDA_SEGURIDAD`, `REVISION_EXTINTOR`,
`LECTURA_MEDIDOR`, `RECOLECCION_BASURAS`, `INSPECCION_BANO` y `NOVEDAD`. Las que
pida el cliente se agregan **desde la consola**, sin migración, que es el
criterio de `pqrs_plazos` y `turno_patrones`.

Dos desvíos de los nombres de ejemplo del documento 00, dichos aquí para que no
sorprendan: `RONDA_SEGURIDAD` en vez de `RONDA_VIGILANCIA` (porque `SEGURIDAD`
es el nombre del servicio en `grupo_servicios`) y `LECTURA_MEDIDOR` en vez de
`LECTURA_CONTADOR` (porque la nomenclatura ya reserva `activo_medidores`).
`APERTURA`, que el documento 00 también daba como ejemplo, **no** se siembra: no
estaba en la lista del usuario y crear tipos es justo lo que la pantalla permite.

`categoria` usa el **mismo vocabulario que `grupo_servicios.servicio`**
(`ASEO`/`CONSERJERIA`/`MANTENIMIENTO`/`SEGURIDAD`) más `HSEQ`,
`ADMINISTRATIVA` y `OTRA`. Así la consola puede ocultar los tipos de un servicio
que el contrato no compró.

### 1.2 El versionado, que es lo crítico

El requisito era que **publicar la versión 2 no cambie ninguna respuesta ya
guardada con la versión 1**. Está resuelto en la base, no en la interfaz, con
dos triggers:

- `ronda_plantilla_congelar()` — cuando la plantilla deja de ser `BORRADOR`,
  lo único que se admite es `PUBLICADA → ARCHIVADA`. Ni un cambio de contenido,
  ni un borrado.
- `ronda_paso_congelar()` — no se agregan, cambian ni borran pasos de una
  plantilla que ya no es `BORRADOR`.

Con eso, las filas de la v1 son inmutables, y las respuestas de F4 —que
guardarán `plantilla_id` y `paso_id`— siguen apuntando a la pregunta que se hizo.
Publicar la v2 solo archiva la v1: **lo probado es que de la v1 no cambia ni un
byte de sus pasos, y de su fila solo el `estado`**.

Los dos triggers dejan pasar la **cascada** del borrado del contrato (cuando la
fila padre ya no existe): si no, un contrato con catálogo propio publicado sería
imposible de eliminar, y eso no es lo que el congelado protege. Está probado.

Publicar y versionar van **por RPC `SECURITY DEFINER`**, como manda el ADR-E,
porque son una máquina de estados con validación que la RLS no puede expresar:

- `ronda_plantilla_publicar(p_plantilla)` — exige el permiso y el alcance, que
  haya al menos un paso y que **ningún paso condicional dependa de un paso
  posterior**; archiva la versión anterior del mismo código y dueño y sella
  quién publicó y cuándo. Todo en una transacción.
- `ronda_plantilla_nueva_version(p_plantilla, p_grupo)` — clona la plantilla y
  sus pasos en una versión nueva en `BORRADOR` **rehaciendo las referencias de
  los pasos condicionales dentro de la copia**, que es exactamente lo que un
  copiar‑pegar desde la interfaz haría mal. Con `p_grupo`, la copia es el ajuste
  de ese contrato sobre la plantilla general.

**Un desvío del documento 00, a propósito:** proponía `UNIQUE (codigo, version)`
a secas, pero eso fue antes de que el complemento 2 le pusiera `grupo_id` a la
tabla. Con la clave global, el contrato A que saca su versión 2 de `ASEO_BANOS`
le bloquearía la versión 2 al contrato B. La unicidad quedó **por dueño**
(índices parciales para el caso `NULL`), y la de «una sola `PUBLICADA`»,
igual: una por código **y** dueño. Es lo que hace posible la herencia de §4.1.

`ronda_plantilla_vigente(codigo, grupo)` resuelve cuál manda: el ajuste
publicado del contrato si existe, si no la general.

### 1.3 Los pasos y su `config`

Nueve tipos: `CASILLA`, `FOTO`, `VIDEO`, `TEXTO`, `NOTA_VOZ`, `NUMERO`,
`SELECCION`, `ESCANEO`, `FIRMA`. Lo específico de cada uno va en `config JSONB`
validado por un `CHECK` contra `ronda_paso_config_valida(tipo, config)`, que es
`IMMUTABLE` y no mira ninguna tabla. Cubre el mínimo y el máximo de fotos, la
cámara en vivo, **que el QR del punto salga en el encuadre**, la duración máxima
del video y de la nota de voz, el rango y la unidad del número, las opciones de
la selección, qué se escanea y quién firma.

Dos detalles que valían un comentario en el SQL: un `CHECK` que se evalúa a
`NULL` **pasa**, así que la función termina en `COALESCE(..., false)`; y
`jsonb_typeof(o->'valor')` de una clave ausente también da `NULL`, que colaba
opciones sin valor — de ahí los `COALESCE` de dentro.

El **paso condicional** es `condicion_paso_id` + `condicion_valor`, con un
`CHECK` de «o los dos o ninguno», un trigger que obliga a que el paso del que
depende sea **de la misma plantilla y sin ciclos**, y la regla de «orden menor»
verificada **al publicar** (en borrador se reordena libremente, y exigirla antes
estorbaría).

El contrato de `config` está espejado en
[lib/ronda/pasos.ts](apps/inventario/lib/ronda/pasos.ts), lógica pura y
testeable, para que la consola avise antes de mandar la fila. Si cambia una,
cambia la otra — igual que ya se hizo en F1 con `grupo_vigente()`.

### 1.4 Instructivos y el bucket (ADR-C)

Versionados por la misma razón que las plantillas: un instructivo que se corrige
no puede cambiar lo que vio quien ya ejecutó con la versión vieja. Llevan tipo
(`FOTO`/`VIDEO`/`PDF`/`AUDIO`), **idioma**, **duración**, `texto` (transcripción,
que sirve para buscar, para el bot y para accesibilidad) y `momento`
(`ANTES`/`DURANTE`). Se asocian **a una actividad** (`tipo_actividad_id`) o **a
un paso** (`ronda_plantilla_pasos.instructivo_id` + `instructivo_momento`); las
dos formas hacían falta.

Bucket **`rondas`**, privado, 50 MB, como manda el ADR-C, con rutas
`instructivos/{instructivo_id}/{archivo}` y lectura **siempre con
`createSignedUrl` de 300 segundos**. Nunca URL pública.

Las políticas de `storage.objects` se llaman y se **acotan por carpeta**
(`ronda_instructivos_storage_*`, solo `instructivos/…`) a propósito: ese bucket
lo van a compartir la evidencia de las visitas (F4), las fotos de los puntos
(F2) y los reportes, y políticas con nombre genérico se pisarían entre ramas.
Así cada fase trae las suyas y se suman. El `INSERT` del bucket es
`ON CONFLICT DO UPDATE`, así que no importa si F2 lo declara también ni cuál se
aplique primero.

### 1.5 Las asignaciones: se reutiliza el criterio del repo

Antes de inventar la frecuencia y la ventana se miró cómo lo resolvieron
programación de personal y mantenimiento preventivo, y **se reutiliza su
criterio**:

- **`dias SMALLINT[]`** con 1 = lunes … 7 = domingo y `CHECK (dias <@ 1..7)`,
  igual que `puestos.dias_cobertura` y `turno_patrones.dias`
  ([20261018000005](supabase/migrations/20261018000005_programacion_fase1.sql)).
  Un array, no siete booleanos ni una tabla hija.
- **`ventana_desde` / `ventana_hasta TIME`** con la regla «o están las dos o
  ninguna» de `turno_patrones`, y **`cruza_medianoche` CALCULADA**, que es
  exactamente la trampa que esa migración dejó resuelta: una ventana que acaba a
  una hora menor o igual que la de inicio pasa de medianoche, y olvidarlo
  descuadra cualquier conteo nocturno.
- **`CADA_N_HORAS` + `cada_horas`** es el criterio de `maquinaria`
  (`frecuencia_mant_dias`,
  [20260914000000](supabase/migrations/20260914000000_mantenimiento_maquinaria.sql)):
  el periodo como número, no como expresión cron, para poder sumarlo y
  compararlo en SQL.

**Dónde me aparté, y por qué:** no se cuelga de `turno_patrones` ni de
`puestos`. Un punto de control no es un puesto —hay varios puntos dentro de un
puesto— y una tarea de tres minutos no es un turno de ocho horas. Lo que se
comparte es el **vocabulario**, no la tabla.

Las frecuencias son `CADA_N_HORAS / POR_TURNO / DIARIA / SEMANAL / MENSUAL /
POR_EVENTO`. Frente al documento 00 se agregan las dos que pidió el usuario
(«cada N horas» y «por evento») y `A_DEMANDA` se escribe `POR_EVENTO`, que es la
palabra del usuario y además obliga a decir **qué** la dispara (columna
`evento`, sin `CHECK`: el catálogo de eventos lo cierra F4, igual que
`grupo_entregables.tipo_informe` en F1).

El resto: `veces_por_periodo`, `tolerancia_min`, responsable por **rol, cargo o
persona** (con un `CHECK` de «al menos uno»), `prioridad` con el vocabulario de
`pqrs.prioridad`, `sla_min`, `vigente_desde`/`vigente_hasta` y `activo`. Un
índice único impide asignar dos veces la misma plantilla en la misma ventana del
mismo punto, pero sí deja dos ventanas distintas (una ronda en la mañana y otra
en la tarde).

**Una ventana `NULL` significa «todo el día».** La herencia de la ventana del
`puesto` de la zona que menciona §2.3 del documento 00 queda para cuando exista
`ronda_zonas` (F2); está dicho en el comentario de la columna.

### 1.6 `ronda_tareas_aplicables()` — «qué aplica aquí y ahora»

Es función de base de datos, no lógica en la interfaz, porque la van a llamar la
PWA de F4, el bot de F9 y la cola offline: si cada canal la escribiera, cada
canal contestaría distinto, y el que contesta distinto es el que deja una tarea
sin hacer.

```sql
SELECT * FROM ronda_tareas_aplicables(punto_id, NOW(), true);
```

Resuelve lo que es fácil equivocar fuera de la base:

- **el día y la hora en `America/Bogota`**, no en UTC: a las 21:00 de Bogotá en
  UTC ya es el día siguiente, así que filtrar por `EXTRACT(ISODOW FROM now())`
  daría el día equivocado todas las noches;
- **las ventanas que cruzan medianoche**: una ronda de 22:00 a 06:00 que empezó
  ayer sigue aplicando a la 01:00 de hoy, y el día que hay que mirar en `dias`
  es el de **ayer** — por eso se evalúan dos fechas base;
- **la tolerancia**, que estira el final de la ventana (`en_ventana` y
  `en_tolerancia` vienen por separado);
- **la vigencia del contrato** con `grupo_vigente()` de F1: contrato vencido, no
  hay tareas. Es la misma regla de §2.5 que apaga los QR, preguntando y no con
  un `UPDATE` masivo;
- **qué versión mostrar**, con el ajuste del contrato por delante de la general,
  y el número de pasos y el tiempo estándar de esa versión.

Es `SECURITY DEFINER` **con el alcance adentro** (`auth_ve_grupo()`): la llama
un conserje que no tiene `ver_catalogo_rondas` porque no entra a la consola, y
aun así no puede ver las tareas de un contrato que no es suyo. **No se concede a
`anon`**: la ruta pública del QR es de F2 y decide ella qué muestra sin sesión.

Una asignación cuyo código no tiene versión publicada para ese contrato **no se
ofrece**: mostrarla sería ofrecer trabajo que la PWA no puede abrir.

---

## 2. La migración `20261019000031_puntos_qr_f3_fk_puntos.sql`

`ronda_asignaciones.punto_id` apunta a `ronda_puntos`, que es de **F2 y vive en
otra rama**. La columna y su índice nacen en la migración de F3; **la llave
foránea va en este archivo aparte**, que se aplica después de las dos. Si
`ronda_puntos` todavía no está, no falla: avisa con un `NOTICE` y se vuelve a
correr cuando F2 esté. Es idempotente.

**Orden de aplicación:** F1 → (F2 y F3, en cualquier orden) → `…000031`.

Lo que esa migración **no** hace: comprobar que `grupo_id` y `sede_id` de la
asignación coincidan con los del punto. Son columnas desnormalizadas por
decisión de §2.4 y cuadrarlas pide una llave foránea compuesta contra un índice
único de `ronda_puntos(id, grupo_id, sede_id)` que no se puede dar por hecho
desde aquí. **Queda anotado para F4**, que es quien lee las dos cosas a la vez
al abrir una visita.

---

## 3. Permisos

Cuatro claves nuevas, planas y en `snake_case`, al final del grupo **Operación
Conserjería** de [lib/permisos.ts](apps/inventario/lib/permisos.ts), sin
reordenar ni reformatear nada de lo que ya había:

| Clave | Para qué |
|---|---|
| `ver_catalogo_rondas` | ver actividades, plantillas, pasos e instructivos |
| `gestionar_catalogo_rondas` | crear, editar, publicar y versionar el catálogo |
| `ver_asignaciones_rondas` | ver qué tareas aplican en cada punto |
| `gestionar_asignaciones_rondas` | asignar tareas a puntos |

Siguiendo el aviso que dejó F1 sobre las parejas que se parecen entre módulos
distintos, queda escrito en el SQL y en `permisos.ts`:
`gestionar_tipos_servicio` es de **Servicios del Hogar** y `gestionar_rutas` es
de **Logística**; ninguna de las dos sirve aquí. El sufijo `_rondas` es el que
las separa.

El rol **Auditor** recibe las dos claves de lectura en la migración, con el
mismo criterio de PQRS: mirar sin tocar.

---

## 4. Pantallas

Cuatro, bajo `/rondas/`, en el menú de Operación Conserjería. Listados paginados
con `traerTodo` y **orden estable** (siempre con `id` al final, porque pagina con
`OFFSET`), como el resto del repositorio.

| Ruta | Qué hace |
|---|---|
| `/rondas/catalogo` | las actividades: código, nombre, categoría, icono, color, orden y ámbito |
| `/rondas/plantillas` | todas las versiones, con su estado y su número de pasos |
| `/rondas/plantillas/[id]` | **el editor**: datos de la tarea, los pasos con la configuración propia de cada tipo, el paso condicional, publicar y sacar versión nueva |
| `/rondas/instructivos` | alta, **subida del archivo**, enlace firmado para verlo, publicar, versionar |
| `/rondas/asignaciones` | qué tarea en qué punto, frecuencia, días, ventana, tolerancia, responsable, prioridad y ANS |

Detalles que valen la pena:

- El editor **calcula en el cliente los mismos problemas que la RPC** y deshabilita
  «Publicar» mientras haya alguno, con la lista de qué arreglar. El desplegable
  del paso del que depende una condición ofrece **solo los pasos anteriores y de
  respuesta discreta** (casilla o selección): de una foto o una firma no se
  puede colgar una condición.
- Una plantilla publicada se muestra **en modo lectura, con el candado y la
  explicación**; el único camino para cambiarla es la versión nueva.
- La pantalla de instructivos trabaja con el **cliente de navegador** y no con
  server actions, a diferencia del resto: el archivo se sube **directo al
  bucket** (por un route handler propio pasaría todo el binario y el límite de
  cuerpo es de 4,5 MB) y la URL firmada caduca en 300 segundos, así que se pide
  en el momento de abrirla. Es el patrón de `/gestion-humana/plantillas`.
- **Los puntos de control son de F2.** Mientras su tabla no exista, la pantalla
  de asignaciones lo detecta (la consulta falla y se resuelve con `null`), avisa
  en un recuadro y pide el identificador del punto a mano. Cuando F2 entre, el
  desplegable de puntos aparece **sin tocar nada**.
- La persona responsable se indica **por número de documento**, no con un
  desplegable: hay 6.564 personas en nómina y además así la pantalla no muestra
  nombres a quien no los necesita.

---

## 5. El hueco que NO se rellenó

**El reto aleatorio durante la ejecución (C1§3) no existe en esta fase.** No hay
tipo de paso `RETO`, no hay columna de resultado y no hay nada en `config` para
eso. El complemento 1 no ha llegado y la §7 del complemento 2 explica por qué no
se nombra: fijar ahora un formato obligaría a adivinar uno que C1 puede
contradecir. Está dicho en la cabecera de la migración, en el comentario de
`ronda_paso_config_valida()` y en `lib/ronda/pasos.ts`, y hay dos pruebas que
comprueban que **ninguna columna del módulo nombra el reto** y que un tipo de
paso inventado se rechaza.

---

## 6. Verificación

### En transacción, con `ROLLBACK`

[scripts/probar-puntos-qr-f3.mjs](scripts/probar-puntos-qr-f3.mjs), modelado
sobre el de F1: **92 pruebas, 0 fallas**.

```bash
node --use-system-ca scripts/probar-puntos-qr-f3.mjs
```

Qué comprueba, en diez bloques:

1. **Idempotencia de verdad**: corre F1 y F3 completos, **los archivos enteros
   dos veces** en la misma transacción, y la de costura dos veces también
   (comprobando que sin `ronda_puntos` no deja la llave foránea).
2. **Estructura**: las cinco tablas con RLS, el `grupo_id` nullable de los
   catálogos y `NOT NULL` + `sede_id NOT NULL` de las asignaciones, que
   `ronda_plantilla_pasos` **no** lleva `grupo_id`, que las cinco políticas de
   lectura exigen `auth_permiso` y que **no hay nada del reto aleatorio**.
3. **La validación de `config`** de los nueve tipos, con los casos que importan:
   `max < min`, un `"min": "dos"`, una selección sin opciones, una opción sin
   `valor`, un `ESCANEO` sin `entidad`, una `FIRMA` sin `quien`.
4. **Una plantilla con seis pasos de tipos distintos y un instructivo en video**:
   casilla con motivo, foto con cámara en vivo y QR en el encuadre, número con
   unidad, selección múltiple **condicional al «No» del paso 1**, nota de voz
   opcional y firma del cliente. Más: un instructivo `PUBLICADO` sin archivo se
   rechaza, un paso no se puede condicionar a otra plantilla y una condición sin
   valor tampoco entra.
5. **Publicar**: sin pasos no publica; con un paso condicional que depende de
   uno posterior, tampoco; quien solo tiene `ver_catalogo_rondas` no puede; y la
   v1 queda sellada con quién y cuándo.
6. **El versionado**, que es lo que había que probar: la v1 publicada no se
   puede modificar, ni borrar, ni se le puede agregar un paso, ni renombrar la
   plantilla. Se saca la v2, se le cambia el nombre, se le edita un paso y se le
   borra otro, se publica… y **los seis pasos de la v1 siguen byte a byte
   iguales**, con el `estado` como único cambio de su fila. La base impide dos
   `PUBLICADA` del mismo código. El clon rehace sus condiciones **dentro del
   clon** y ninguna apunta a la v1.
7. **El catálogo heredable**: el ajuste del contrato A es el vigente para A, el
   contrato B sigue con la general, y el ajuste arranca en la versión 1 de su
   propia serie.
8. **El alcance por contrato**: A **no lee la plantilla privada de B** ni sus
   pasos, **sí lee las del catálogo general**, los tipos de actividad generales y
   el instructivo general; B lee la suya y no el ajuste de A; quien solo tiene
   `ver_*` no cambia el catálogo; **quien no tiene la clave no lee nada, ni lo
   general**; el ADMIN ve todo.
9. **`ronda_tareas_aplicables()`**: las validaciones de la tabla (sin
   responsable, `CADA_N_HORAS` sin horas, `POR_EVENTO` sin evento, media ventana,
   días fuera de rango), que a las 07:00 aparecen las del día y no las de otro
   día, que lo crítico sale primero, que **a las 08:10 la ventana de 06:00–08:00
   sigue viva por la tolerancia de 15 minutos y a las 08:30 ya no**, que **a la
   01:00 la ronda de 22:00–06:00 sigue en ventana con el día de ayer**, que un
   **contrato vencido no tiene tareas**, que se resuelve el ajuste del contrato
   con su número de pasos y su tiempo estándar, que una asignación sin versión
   publicada no se ofrece, y que **un usuario del contrato B no ve las tareas de
   un punto del contrato A**.
10. **La cascada**: se puede borrar un contrato que tiene una plantilla
    publicada; el congelado no traba el borrado.

Al final, `ROLLBACK`: **la base queda igual y la migración sigue sin aplicar**.

### Lo demás

- `npx tsc --noEmit -p .` en `apps/inventario`: **limpio**.
- `npx next build`: **compila**, con las cuatro rutas nuevas en la lista
  (`/rondas/catalogo`, `/rondas/plantillas`, `/rondas/plantillas/[id]`,
  `/rondas/instructivos`, `/rondas/asignaciones`), todas dinámicas.
- `verificar-permisos.mjs`: **«Sin discrepancias: la base de datos concede
  exactamente lo que dice /roles»**.
- `verificar-lecturas.mjs`: la matriz sale igual que antes. Cubre las tablas que
  se cerraron en su momento, y esta fase no toca ninguna.
- `auditar-permisos.mjs`: pasa de 14 a **18 claves con incoherencias**, y las 4
  nuevas son las de esta fase, todas con el mismo texto: **«ningún rol la tiene
  activa»**. Es lo que tiene que decir mientras la migración no esté aplicada —
  ningún rol las tiene porque el `UPDATE` del Auditor está dentro de la
  migración—, y después de aplicarla las dos de lectura se van solas. Las dos de
  `gestionar_*` seguirán ahí hasta que alguien las marque en `/roles`, igual que
  le pasa hoy a `gestionar_soporte`. **No es una incoherencia de diseño, pero sí
  son cuatro filas nuevas en ese informe, y conviene saberlo antes de leerlo.**
- **Sin revisión visual de las pantallas**, igual que en F1 y por el mismo
  motivo: leen tablas que solo existen cuando la migración se aplique. En cuanto
  se aplique, vale la pena pasarlas por la skill `banco-pruebas`.

**Queda pendiente que el usuario decida cuándo aplicarlas:**

```bash
NODE_OPTIONS=--use-system-ca node scripts/apply-migrations.mjs supabase/migrations/20261019000030_puntos_qr_f3_catalogo.sql
```

y, **después de que F2 esté aplicada**:

```bash
NODE_OPTIONS=--use-system-ca node scripts/apply-migrations.mjs supabase/migrations/20261019000031_puntos_qr_f3_fk_puntos.sql
```

---

## 7. Pendientes que esta fase deja anotados

1. **La llave foránea `punto_id → ronda_puntos`** vive en
   `20261019000031_puntos_qr_f3_fk_puntos.sql` y hay que aplicarla **después** de
   F2 y F3. Mientras no esté, nada falla: la columna existe y la pantalla de
   asignaciones pide el identificador a mano.
2. **La coherencia entre el `grupo_id`/`sede_id` de la asignación y los del
   punto** no está forzada por la base (ver §2). Es trabajo de F4.
3. **La herencia de la ventana horaria del `puesto` de la zona** (§2.3 del
   documento 00) no se implementó: `ronda_zonas` es de F2. Hoy una ventana
   `NULL` es «todo el día».
4. **El catálogo de eventos de `POR_EVENTO`** queda `VARCHAR(40)` sin `CHECK`,
   con el motivo en el comentario de la columna: lo cierra F4.
5. **El reto aleatorio (C1§3)** sigue sin nombrar, a propósito. Ver §5.
6. **La pantalla de asignaciones no muestra todavía un calendario ni una vista
   «qué toca hoy en esta sede»**: la función que lo resuelve ya existe
   (`ronda_tareas_aplicables()`), pero quien la va a usar de verdad es la PWA de
   F4, y pintarla ahora sería adivinar su forma.
7. **`ronda_instructivos.texto` no se llena automáticamente.** La transcripción
   por IA (`/api/ia/transcribe`, que el documento 00 cita para las notas de voz)
   serviría también aquí; hoy el campo se escribe a mano.

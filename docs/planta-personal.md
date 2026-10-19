# Planta de personal

Trae a la plataforma los dos informes de nómina que vivían en Excel y los deja
conectados con contratación, selección y la disponibilidad para programar.

| Informe | Filas | Qué aporta |
|---|---|---|
| `ExportExcel activos conserjes.xlsx` | 863 | quién está hoy en planta, con cargo, ciudad, centro de costos, tipo de nómina y salario |
| `ExportExcel Retirados Conserjes.xlsx` | 6.172 | quién salió, cuándo entró y cuándo salió, tipo de contrato, dirección y teléfono |

**471 documentos aparecen en los dos**: gente que se retiró y volvió a entrar.
Por eso el modelo tiene historial y no una sola fila por persona.

Resultado del cargue: **6.564 personas** (863 activas, 5.701 retiradas) y
**7.035 vinculaciones**, sobre 92 centros de costo y 31 cargos.

---

## Modelo

```
personas ──1:N──> persona_vinculaciones ──N:1──> centros_costo ──> obras / empresas_usuarias
   │                        │                                          (contratación)
   │                        └──> cargos, contratos       (los llena el ATS al contratar)
   ├──1:1──> usuarios (auth)          cuenta de plataforma
   └──1:1──> candidatos               hoja del Registro de Vacantes
```

* **`personas`** es el maestro único, con `documento` como llave. Ya existía
  para Gestión Humana; el cargue le agregó los campos de nómina
  (`codigo_empleado`, `centro_costo_id`, `ciudad`, `departamento`,
  `tipo_nomina`, `salario`, `tipo_contrato`, `fecha_retiro`,
  `elegible_recontratacion`, `origen`, `nombre_completo`, `nombre_confianza`).
* **`persona_vinculaciones`** es el historial: una fila por cada paso por la
  empresa. `clave_origen` (`ACT:<doc>` / `RET:<doc>:<fecha>`) hace el cargue
  repetible sin duplicar. Un índice único parcial garantiza **una sola
  vinculación `ACTIVA` por persona**.
* **`centros_costo`** normaliza el texto de nómina (`TRANSMILENIO 2026-BOGOTA` →
  nombre + ciudad) y es el puente hacia contratación: tiene `obra_id`,
  `cliente_id` y `grupo_id` para amarrarlo al contrato de servicio que lo
  origina. **Esos tres campos están vacíos y se llenan a mano**: la nómina no
  sabe de obras.

### Vistas

| Vista | Para qué |
|---|---|
| `vw_planta_personal` | la foto completa: ficha + centro de costos + cuenta + nº de vinculaciones |
| `vw_personal_disponible` | activos, con `disponible` = tiene vinculación vigente y no está amarrado a un contrato |
| `vw_personal_recontratable` | retirados elegibles, con `dias_desde_retiro` |
| `vw_planta_inconsistencias` | lo que hay que revisar a mano antes de dar la planta por buena |

Permisos: `ver_planta_personal` y `gestionar_planta_personal`.

Funciones: `historial_laboral(documento)` (hoja de vida laboral, la usa el ATS)
y `planta_resumen()` (los cinco números de la cabecera).

---

## Enganche con contratación y selección

* Dos triggers cruzan `candidatos` ↔ `personas` **por documento**, en los dos
  sentidos. Un aspirante que ya trabajó con nosotros queda enlazado solo.
* El drawer de `/gestion-humana/postulaciones` muestra la sección **«Ya trabajó
  con nosotros»** con todas sus vinculaciones, y avisa en amarillo si la persona
  figura **vinculada hoy**.
* `cargos` quedó como catálogo único compartido (se le quitaron los duplicados y
  se le puso índice único por nombre): las vacantes del ATS y los cargos de
  nómina ahora hablan el mismo idioma.
* `persona_vinculaciones` tiene `contrato_id` y `obra_id` listos para que, cuando
  el ATS genere un contrato, la vinculación nazca de ahí en vez de un Excel.

## Dónde se ve

| Pantalla | Qué muestra |
|---|---|
| **Gestión Humana → Planta de personal** (`/gestion-humana/planta`) | resumen, filtros por ciudad y centro de costos, fichas por revisar, historial laboral por persona |
| **Gestión Humana → Personas** (`/gestion-humana/personas`) | el CRUD de siempre, ahora con **tabla como vista base** y tarjetas de opción |
| **Gestión Humana → Postulaciones** → abrir un candidato | sección «Ya trabajó con nosotros» con su historial |
| `/login` | acepta cédula además de correo |
| `/carnet` | donde aterriza un empleado al entrar |
| `/roles` | los dos permisos nuevos, en el grupo Gestión Humana |

**Las dos pantallas usan `TablaEstandar`** (`components/ui/tabla`), la misma
tabla de Productos: buscador, filtro por columna, orden, selección tipo hoja de
cálculo, copiar, Excel y el par Tabla/Tarjetas.

**Personas mostraba «1000 de 1000».** Pedía todas las fichas en una sola
consulta, y **PostgREST corta toda respuesta en 1.000 filas sin error y sin
aviso**: con 79 personas nadie lo notaba; con 6.639, las otras 5.639 no existían
para quien usaba la pantalla. Ahora las dos pantallas traen el maestro completo
con `traerTodo` (`lib/supabase/paginado.ts`) y la tabla se encarga de filtrar y
paginar. Son 598 KB comprimidos en Personas y 423 KB en Planta — se midió antes
de decidirlo.

## Programación de personal

**El módulo de programación no existe todavía.** Lo que queda listo es su
insumo: `vw_personal_disponible` responde «con quién cuento hoy, dónde está y en
qué está». Hoy hay **16 personas** en el centro `DISPONIBLE-BOGOTA`, que es como
nómina marca al personal sin asignar.

---

## Cómo se corre

```bash
node scripts/apply-migrations.mjs supabase/migrations/20260910000000_planta_personal.sql supabase/migrations/20260910000001_planta_personal_privacidad.sql
node scripts/importar-planta-personal.mjs --dry-run
node scripts/importar-planta-personal.mjs
node scripts/crear-usuarios-empleados.mjs --dry-run
node scripts/crear-usuarios-empleados.mjs
```

Los dos scripts son idempotentes. El cargue **no pisa lo digitado a mano**
(nombres, correo, teléfono, dirección): solo rellena lo que esté vacío. Sí manda
en lo que es de nómina: cargo, centro de costos, salario y estado.

Con `--activos <ruta> --retirados <ruta>` se apunta a exportes nuevos.

---

## Cuentas de los colaboradores

859 cuentas creadas, 0 errores.

* **Usuario**: `<cédula>@conserje.local` (o su correo de contacto si lo hay).
  Es la misma convención de `app/api/gestion-humana/personas/route.ts`.
* **Contraseña**: la cédula.
* **Rol**: «Empleado», `rol_base = AUDITOR`, permisos `{}`.
* En `/login` basta escribir la cédula: `app/api/auth/resolver-acceso` traduce.

### Por qué el rol es AUDITOR y no «Conserje»

`sync_usuario_rol` copia `roles.rol_base` a `usuarios.rol`, que es lo que mira el
bypass de ADMIN en TODA la RLS. El rol «Conserje» es `OPERADOR_SEDE`, y eso
permite insertar en `movimientos` (altera el stock vía `registrar_movimiento`),
`FOR ALL` en `pedidos_sede` y contar en arqueos. Darle ese rol a 863 cuentas
cuya contraseña es la cédula sería una escalada de privilegios.

---

## ⚠️ Lo que falta decidir

*(1 ya está resuelto; quedan 2, 3, 4 y 5.)*

### 1. La contraseña temporal ~~es la cédula~~ ya se cambia de entrada — HECHO

La cédula aparece en la nómina, en los informes y en el carnet, así que sirve
para el primer ingreso y no como clave. Ahora **`/cambiar-clave` es obligatoria**:

* Toda cuenta que nace con una contraseña que otro conoce lleva
  `debe_cambiar_password: true` — las 859 de nómina, las que crea el formulario
  de Gestión Humana, las del cargue masivo, y también cuando un administrador
  **repone** la contraseña de alguien.
* El bloqueo vive en `proxy.ts`, no en cada página: con la marca puesta,
  **ninguna ruta** se abre hasta cambiarla. Solo quedan libres el sitio público,
  `/login` y las APIs.
* La pantalla exige 8 caracteres, letra y número, y **prohíbe que la nueva sea
  el documento, el usuario o puro dígito** — que es justo de lo que se trata.
* El cambio y el apagado de la marca van en **un solo llamado**
  (`updateUser({ password, data })`): separarlos dejaría a alguien girando para
  siempre en esa pantalla si el segundo fallara.
* `/cambiar-clave` también queda disponible a voluntad, con enlace desde
  **Mi Perfil**.

Verificado de punta a punta con una cuenta desechable: con la marca, `/dashboard`,
`/carnet` y `/gestion-humana/planta` redirigen a la pantalla; después del cambio
la contraseña vieja deja de servir, la marca queda en `false` sin perder el resto
de la metadata, y la navegación se abre.

### 2. Las lecturas con `USING (true)` — CERRADO

La plataforma se diseñó cuando «autenticado» eran 27 personas de confianza, y
por eso casi todo se leía sin filtro. Con las 859 cuentas de nómina, «autenticado»
pasó a ser casi toda la empresa: **83 políticas de lectura abierta**, de las
cuales 59 solo para cuentas internas. Una cuenta del rol Empleado (cero permisos,
853 cuentas) leía los 702 productos con su `precio_lista`, el stock, 7.752
movimientos, 495 órdenes de insumo, 462 precios de proveedor, las 13.458 filas de
`historial_cambios` (con el antes y el después de cualquier tabla, salarios
incluidos), el GPS de los conductores y las firmas de quien recibe en sede.

Primero se cerraron `personas` y `documentos_persona`. Después, en tres
migraciones (`20261018000000` a `20261018000002`), las **59 restantes**, agrupadas
por sensibilidad: personas y rastreo, plata y precios, y operación interna. Cada
tabla exige ahora la lista de permisos de /roles de las pantallas que la leen,
vía `auth_permiso_any`. Quedan abiertas 25 políticas: las **24 públicas por
diseño** (portal de aspirantes y cotizador de clientes, con rol `anon`) y
`presentaciones` (litro, galón, unidad), por decisión consciente.

Tres cosas que había que respetar y quedaron resueltas:

* **`roles` no se podía cerrar sin más.** `lib/permisos-server.ts` resuelve los
  permisos con el cliente del usuario (`usuarios.select('rol, permisos,
  roles(permisos)')`) y ese embebido pasa por RLS: sin la cláusula del rol
  propio, todo usuario no-admin se quedaba sin permisos en la UI.
* **`/carnet` y `/perfil` no exigen permiso** (son personales): `sedes`,
  `grupos_contrato`, `roles` y `empresas_usuarias` llevan cláusula de lo propio.
* Las **tablas de dimensión** (`sedes`, `productos`) se leen desde casi todos los
  módulos, y los embebidos de PostgREST también pasan por RLS. Por eso sus listas
  de permisos son largas: recortarlas rompía al Técnico de Mantenimiento (5
  permisos, necesita `sedes` en `/equipo`) y al Conductor (necesita `productos`
  en `/logistica/mis-rutas`).

De paso se corrigió `gps_act_write`, que era `ALL ... USING (true OR …)`: dejaba
leer, actualizar y borrar la posición de cualquier conductor a cualquier cuenta,
por detrás de la política de SELECT.

Qué ve ahora cada rol se mide con el script nuevo; los otros dos siguen siendo la
auditoría estática y la de escrituras:

```bash
node scripts/verificar-lecturas.mjs
node scripts/auditar-permisos.mjs
node scripts/verificar-permisos.mjs
```

Pendientes que esto dejó a la vista, para decidir aparte:

* `productos.precio_lista` sigue visible para quien vea el catálogo; separarlo
  pide seguridad por columna.
* `pruebas` (el banco de pruebas del ATS) lo lee `anon` desde el portal de
  aspirantes.
* `importaciones` acepta `INSERT` de cualquier cuenta autenticada
  (`auth_insert_importaciones` con `WITH CHECK true`).

### 3. Fichas por revisar (`vw_planta_inconsistencias`) — 275 (eran 459)

| Motivo | Cuántas | Antes | Qué pasa |
|---|---|---|---|
| `NOMBRE_DUDOSO` | 240 | 350 | los informes traen «Apellidos y Nombres» en un solo campo y sin separador |
| `DOCUMENTO_SOSPECHOSO` | 0 | 74 | fichas viejas cargadas a mano con un celular en el campo del documento (no vienen de este cargue) |
| `SIN_CIUDAD` | 35 | 35 | el informe no trae ciudad para esas filas |
| `ACTIVO_CON_RETIRO_RECIENTE` | 0 | 0 | retiro a menos de 15 días del corte del informe (posible desfase entre los dos exportes) |

La limpieza se hizo con tres guiones, cada uno en **simulación por defecto** y con
`--aplicar` para escribir: `scripts/limpiar-planta-documentos.mjs`,
`scripts/limpiar-planta-nombres.mjs` y `scripts/limpiar-planta-ciudad.mjs`. Lo
aplicado y lo que quedó pendiente está más abajo, en «Lo que se limpió».

Sobre el **corte del nombre**: no se adivina por el número de palabras
(«GAMEZ BLANCA INES» es 1 apellido + 2 nombres, «RIVERA PACHECO EDUARDO» es 2 + 1).
Se aprende del propio archivo: la última palabra de un nombre completo siempre es
un nombre de pila y la primera siempre es un apellido, así que la frecuencia de
cada palabra en esas dos posiciones dice de qué lado cae. El cargue dejó **ALTA
6.214, MEDIA 248, BAJA 102**; después de la limpieza va en **ALTA 6.324, MEDIA
240, BAJA 0**. `personas.nombre_completo` guarda siempre el dato original, así que
ningún corte pierde información.

**Sobre `ACTIVO_CON_RETIRO_RECIENTE` (revisado):** la primera versión de la regla
usaba una ventana de 60 días contra la fecha de hoy y marcaba 14 fichas. Ninguna
tenía nada de malo:

* **13 eran el cierre y la renovación del contrato `POLICIA-SAN ANDRES`** el
  2026-07-31. Doce de ellas comparten ingreso (2025-12-05) y retiro exactos, y
  ese centro tiene 17 personas activas hoy: el equipo siguió trabajando ahí.
* La 14ª es un caso individual en `CORFERIAS 2025-BOGOTA`.

Reciclar así al equipo es **lo normal con «Labor Contratada»**: se liquida al
cerrar la obra y se vuelve a vincular con la renovación. Pasa en toda la nómina —
`TRANSMILENIO 2026` liquidó y revinculó a 181 personas el 2026-06-12, y
`UNAD 2026` a 140 el 2026-04-30 en 47 ciudades. La regla estaba midiendo el ciclo
del negocio, no un error.

Además, **ningún activo tiene retiro en agosto** y el informe de retiros corta el
2026-08-22: si el exporte de activos fuera anterior, habría gente retirada en
agosto figurando todavía en planta. No la hay, así que los dos informes están
alineados.

La regla se cambió a **15 días contra el corte del informe** (no contra la fecha
de hoy), que es la única ventana donde el desfase entre los dos exportes puede
producir un activo falso. Hoy da **0 casos**, y sigue sirviendo para cargues
futuros.

### 4. Fecha de ingreso de los activos

El informe de activos **no trae fecha de ingreso**. Para quien solo está en ese
informe queda en blanco; para los 471 reingresos, la fecha del informe de retiros
pertenece al paso ANTERIOR y por eso no se copia a la vinculación vigente. Si se
necesita antigüedad real, hay que pedirle a nómina un exporte con esa columna.

### 5. Centros de costo sin obra

`centros_costo` tiene **624 filas: 92 activas y 532 históricas**, y ninguna apunta
todavía a una `obra` ni a un cliente (`obras` está vacía). Hasta que se llenen,
«personal por contrato» se responde por el código del centro de costos, no por el
contrato de servicio.

Lo que hay que saber antes de ponerse a llenarlos:

* **Un centro no es un contrato.** El `codigo` es `<contrato>-<CIUDAD>`, así que
  las 92 activas se reducen a **37 contratos distintos** (`UNAD 2026` son 50
  centros, uno por ciudad; `FISCALIA` 7) y las 532 históricas a 152. Llenar por
  contrato y no por centro reduce el trabajo 2,5 veces: una `obra` por contrato y
  los centros de sus ciudades apuntando a ella.
* **Primero el maestro de clientes.** `obras` exige `cliente_id` NOT NULL hacia
  `empresas_usuarias`, que hoy tiene **una sola fila** («vigias de colombia», que
  es el empleador, no un cliente), más `codigo_contrato_servicio` y
  `descripcion_detallada` NOT NULL. Sin clientes no se puede crear ninguna obra.
* **Cuatro centros activos no son contratos** y nunca deberían pedir obra:
  `DISPONIBLE-BOGOTA` (`es_disponibilidad`), `OPERATIVO ADM-BOGOTA` y
  `OPERACIONES-BOGOTA` (`es_administrativo`), y `ADMINISTRATIVO-BOGOTA`, **que no
  tiene la marca puesta** aunque tiene 4 personas. Esa marca hay que corregirla.

Hacen falta las dos cosas, y en este orden:

1. **Un cargue** para el catálogo viejo: una planilla de 37 filas (contrato,
   cliente, NIT, código del contrato de servicio, fechas) que llene
   `empresas_usuarias` + `obras` y amarre los centros por `nombre`. Los datos no
   están en la nómina —los informes no saben de contratos—, así que los tiene que
   dictar el área administrativa; el guion no se los puede inventar.
2. **Una pantalla**, porque esto no se arregla una sola vez: cada cargue de
   nómina crea centros nuevos y llegan sin obra. Lo mínimo es una columna
   «obra / cliente» con selector en la lista de centros de
   `/gestion-humana/planta`, dejando fuera del pendiente los centros marcados
   como disponibilidad o administrativos.

### 6. Lo que se limpió y lo que quedó pendiente

**Tanda 1 · `DOCUMENTO_SOSPECHOSO`, 74 → 0.** Las 74 eran un solo cargue
(2026-08-11): una ficha por responsable de sede con el celular en el campo del
documento, `origen = MANUAL`, `telefono = documento`. Ninguna tenía cuenta de
auth, vinculaciones, `clave_origen`, candidato del ATS ni documentos adjuntos, así
que las 859 cuentas `<cédula>@conserje.local` nunca estuvieron en juego — y
`crear-usuarios-empleados.mjs` exige vinculación ACTIVA, que estas fichas no
tienen, así que tampoco les va a inventar un login más adelante.

Lo que **sí** estaba en juego: `sedes.responsable_id` apunta a esas fichas y **no
tiene llave foránea**, así que borrar una sin reapuntar la sede dejaba un
responsable fantasma. Se aplicó:

* **5 fusionadas.** Eran la misma persona que una ficha de nómina (mismo nombre y
  apellido, coincidencia única, y la ficha de nómina con ese mismo celular). La
  sede pasó a apuntar a la ficha de nómina, que recibió la sede y el teléfono, y
  la ficha manual se borró. Quedan **0 sedes con responsable fantasma**.
* **69 marcadas** como «sin cédula»: `documento` pasó a `SIN-CC-<el mismo
  celular>` y el celular se quedó en `telefono`, donde siempre debió estar. No es
  arreglar la cédula: es dejar escrito que falta, de forma única y reversible. Se
  usó el propio número y no el código de la sede porque `codigo_interno` **no es
  único** (las 74 sedes comparten `CMM-2026-000029`).

**Pendiente:** las 69 siguen sin cédula real; hay que pedírsela a cada
responsable de sede. Y 6 de los 11 gemelos se dejaron sin fusionar a propósito —
1 porque la ficha de nómina no tiene teléfono con que confirmar y 5 porque tiene
otro teléfono, donde puede tratarse de un tocayo. Para esos 6:
`--fusionar-dudosos`, pero mirándolos uno por uno.

**Tanda 2 · `NOMBRE_DUDOSO`, 350 → 240.** El hallazgo que cambia la lectura: no
eran 350 nombres mal cortados, eran **350 fichas donde el algoritmo no tenía con
qué decidir**. De las 248 de tres o más palabras, **220 tienen la segunda palabra
con cero apariciones** en posición inequívoca (primera o última) en todo el corpus
de 6.564 nombres; el suavizado de Laplace le daba 0,5 a una palabra nunca vista y
eso pasaba el umbral de MEDIA. La marca dice «no sé», no «está mal». Y las 248
están guardadas **todas** con dos apellidos, que es el default: rellenarlas con
«la convención colombiana de dos apellidos» no añadiría ninguna información, es
exactamente lo que ya hay y lo que la vista está pidiendo que alguien confirme con
un documento en la mano.

La regla nueva solo acepta tres clases de evidencia, y resolvió 110 de 350:

| Regla | Cuántas | Qué dice |
|---|---|---|
| 1 · convención de la columna | 102 | con dos palabras no hay nada que decidir: la 1ª es el apellido y la 2ª el nombre. Las 102 ya estaban así y la evidencia las confirma todas, sin contradecir ninguna |
| 3 · par de apellidos compartido | 7 | las dos primeras palabras encabezan la ficha de ≥2 personas distintas: es un par de apellidos de familia |
| 2 · evidencia de la palabra | 1 | ≥10 apariciones y ≥90 % de un lado (`JOSE`: 0 veces de primera, 34 de última → un solo apellido) |

Solo **1 ficha cambió de corte**; las otras 109 se confirmaron y pasaron a ALTA.

**Pendiente: 240**, dejadas fuera a propósito — 235 porque la palabra que decide
se ve muy poco en la nómina y 5 porque se usa de los dos lados. Esas se cierran
con el documento de identidad a la vista, no con más estadística. Se midieron y se
descartaron los atajos: bajar el umbral de 20 a 3 apariciones solo sube de 1 a 2
casos resueltos; contar las posiciones intermedias es circular, porque son justo
las que se asignaron por default; y `candidatos` del ATS, como segunda fuente,
tiene 3 filas y ninguna cruza con las 350.

**Tanda 3 · `SIN_CIUDAD`, 35 → 35. No se puede deducir del centro de costo**, y
la razón es estructural: las 35 están RETIRADAS y vienen solo del informe de
retiros, que **no trae columna de centro de costos** (encabezado: CentroTrabajo,
Apellidos y Nombres, Identificacion, Codigo Empleado, Direccion, Telefono, Fecha
de Ingreso, Periodo Prueba, Fecha Fin Contrato, Fecha de Retiro, Tipo de
Contrato). 0 de 35 tiene centro de costo, ni en la ficha ni en la vinculación.

La ciudad de ese informe va en el encabezado de grupo `CentroTrabajo` («Ciudad: X
Depto: Y»), que solo se imprime cuando cambia. Las 35 caen en el primer bloque del
archivo (filas 5–51) y esa celda **está vacía en el origen**: no es que el cargue
perdiera el encabezado, es que nómina no lo imprimió. El primer «Ciudad:» aparece
en la fila 52.

Hay indicios de que el bloque es San Andrés, y ninguno alcanza: de las 47 personas
del bloque, 12 también salen en el informe de activos y las 12 están en
`POLICIA-SAN ANDRES`; 2 de las 35 direcciones nombran sectores de la isla; y en
todo el archivo no hay ningún otro retiro entre 2026-07-31 y 2026-08-22. Pero el
bloque se agrupa por «sin centro de trabajo» —los retiros recién procesados, a los
que ya les quitaron el centro—, no por ciudad, así que puede mezclar varias. Por
eso no se escribió nada.

**Pendiente: las 35.** Lo que de verdad las cierra es un reexporte del informe de
retiros con el centro de trabajo impreso en todas las filas. Mientras tanto,
`limpiar-planta-ciudad.mjs --plantilla <archivo.csv>` saca la planilla de los 35
documentos para llenar la ciudad a mano y `--mapa <archivo.csv>` la aplica. La
bandera `--hipotesis-san-andres` rellena el bloque entero con `SAN ANDRES
PROVIDENCIA`, pero hay que pedirla a propósito porque es una inferencia.

**De paso, dos cosas chicas que aparecieron y no se tocaron:** `POLICIA-SAN
ANDRES` tiene la ciudad escrita de dos formas (`SAN ANDRES PROVIDENCIA` en 16
fichas y `SAN ANDRÉS` en 1), y 2 fichas de nómina tienen `apellidos + nombres` que
no reconstruye su `nombre_completo` —las dos de cuatro palabras, sin reingresos—,
seguramente por cómo quedó el cargue inicial.

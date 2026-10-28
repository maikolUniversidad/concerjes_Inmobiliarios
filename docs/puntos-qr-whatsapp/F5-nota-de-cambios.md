# F5 — PQRS por el mismo QR

Quinta fase del módulo de Puntos QR, Tareas y Bot de WhatsApp. **Depende solo de
F2** (el punto y su placa), no de F4: la PQRS pública necesita la ruta pública y
el punto, no el motor de ejecución. Es la pieza que se puede entregar antes para
que el cliente vea algo funcionando, que es justo lo que dice §6 del
complemento 2.

Lo que esta fase contesta: **un residente escanea la placa de un punto con su
celular, no tiene cuenta, y avisa que el baño del piso 3 está sin aseo.** Eso
tiene que caer en el módulo de PQRS que ya está en producción, atado al punto y
al contrato correctos, y seguir la misma vida que cualquier otra PQRS: plazo en
días hábiles, bitácora inmutable, responsable, respuesta y cierre.

Fuentes: §4.6, §2.4 y §6 de
[02-complemento-2-integracion.md](docs/puntos-qr-whatsapp/02-complemento-2-integracion.md),
y [03-nomenclatura.md](docs/puntos-qr-whatsapp/03-nomenclatura.md), que manda en
los nombres (la ruta pública es `/q/<token>`, no `/p/`). Ninguno de esos
documentos se tocó: son de otras sesiones.

---

## 0. La decisión que define la fase: no se crea un módulo nuevo

El módulo de PQRS ([20261018000004_pqrs.sql](supabase/migrations/20261018000004_pqrs.sql))
ya resuelve lo difícil: estados, plazos en días hábiles con `pqrs_sumar_habiles()`,
bitácora con adjuntos y realtime, bucket privado, alcance por rol, escrituras por
RPC y eventos de notificación. Su `canal` ya admitía `WHATSAPP` y `PORTAL`, y
`anonima` ya existía.

Así que F5 **le agrega a ese módulo lo que le falta para recibir del QR**, y nada
más. No hay tabla de «reportes públicos», ni estados nuevos, ni un segundo
listado: la PQRS que entra por una placa aparece en `/pqrs` junto a las demás, y
coordinación la atiende con las mismas RPC.

---

## 1. La migración `20261028000500_puntos_qr_f5_pqrs.sql`

**Escrita, aplicada y verificada contra la base.** Es idempotente (corre dos
veces sin daño, y así lo prueba el script).

### 1.1 `pqrs_categorias`: el catálogo parametrizable por contrato

Las seis de §6.2 vienen sembradas como catálogo **general** (`grupo_id IS NULL`
= aplica a todos los contratos, el mismo patrón de `ronda_instructivos` y de la
§2.4): `LIMPIEZA`, `INSUMOS`, `OLORES`, `BASURAS`, `DANO`, `OTRO`.

Cada categoría dice con qué **tipo** y con qué **prioridad** nace la PQRS que se
radique en ella (`tipo_sugerido`, `prioridad_sugerida`). Es una sugerencia, no
una camisa de fuerza: coordinación la cambia como en cualquier PQRS. Es lo que
hace que «Basuras» entre como `QUEJA` con prioridad `ALTA` y «Daño o avería»
como `RECLAMO`, sin que el residente tenga que saber qué es un reclamo.

**Cómo un contrato ajusta el catálogo sin tocar el de los demás:** crea una
categoría con el **mismo código**. `pqrs_categorias_de(grupo)` devuelve las
propias más las generales *que no haya reemplazado por código*, así que la del
contrato gana y la general desaparece solo para él. Y para quitar una, se apaga
(`activo = false`): **no se borra**, porque borrarla dejaría sin categoría las
PQRS ya radicadas (la llave foránea es `ON DELETE SET NULL` por lo mismo).

Dos índices únicos **parciales** en vez de un `UNIQUE (grupo_id, codigo)`: en un
único normal dos `NULL` no chocan, y se podrían sembrar dos «LIMPIEZA»
generales.

### 1.2 Lo que se le agrega a `pqrs`

`punto_id`, `zona_id`, `qr_id`, `categoria_id`, `ip_hash`, `satisfaccion` +
`satisfaccion_at`, y el valor `QR` en el `CHECK` de `canal`. Nada de `grupo_id`
ni `sede_id`: la tabla ya los tiene y su trigger los deriva de la sede (§2.4).

Más dos columnas que el complemento no nombra y que hacen falta: **`punto_nombre`
y `categoria_nombre`, desnormalizados**. La razón es la misma por la que ya
existe `persona_nombre`: quien atiende la PQRS desde `/pqrs` puede no tener
`ver_puntos_ronda`, y la RLS de `ronda_puntos` no le dejaría leer el nombre del
punto. Los llena un trigger **propio** (`tr_pqrs_denormalizar_f5`) y no el que ya
existía: si alguna vez se vuelve a correr la migración de PQRS, su
`CREATE OR REPLACE` no se lleva por delante lo de F5.

Un `CHECK` nuevo amarra el canal con el punto: `canal = 'QR'` exige `punto_id`.
Al revés no: una PQRS de la consola puede llevar punto sin que nadie haya
escaneado nada.

### 1.3 Lo que se le agrega a `pqrs_bitacora`

`canal` (`PLATAFORMA/CORREO/WHATSAPP/QR`) y `direccion` (`ENTRADA/SALIDA`), para
que el hilo por correo o por WhatsApp entre al **mismo** caso (§4.6). Hoy todo lo
que escribe la consola es `PLATAFORMA/SALIDA` —que son los valores por defecto,
así que nada de lo ya escrito cambia— y lo que entra por el QR queda como
`QR/ENTRADA`.

### 1.4 `pqrs_radicar_publica()`: la única puerta de escritura pública

La escritura va por RPC y **no** por una política `anon` de `INSERT`, porque una
política no puede validar el token del QR, ni la vigencia del contrato, ni el
límite por hora (§4.6 lo dice explícitamente).

Valida, en este orden —el mismo criterio de `app/q/decidir.ts`: primero lo que no
revela nada—: que el código exista; que el QR esté `ACTIVO`; que el contrato esté
vigente (`ronda_qr_vigente()`, la **misma** función de §2.5 que usa `/q/<token>`);
que el punto no esté `RETIRADO`; que el contrato tenga `grupo_reglas.pqrs_publico`
encendido; que la categoría aplique a ese contrato; que el texto alcance; y que no
se haya pasado del límite por hora. Solo entonces escribe.

**Lo que NO valida, y por qué:** la **firma** del token. No puede: la llave vive
en variables de entorno del servidor (ADR-B) y nunca en la base. La firma la
verifica `resolverCodigo()` antes de llegar aquí. Lo que la función garantiza es
que, aunque ese paso se saltara, no se escribe nada sobre un QR revocado, un
contrato vencido, un punto retirado, un contrato que no recibe PQRS pública o por
encima del tope.

**A `anon` no se le concede, y a `authenticated` tampoco.** La llama el servidor
con la llave de servicio, igual que `/q/<token>` resuelve el punto con
`getAdmin()`. Dos razones: el `ip_hash` lo tiene que calcular el servidor con su
sal (si lo mandara el navegador, saltarse el límite sería editar un campo del
formulario), y la firma ya se verifica del lado del servidor.

> **Trampa que la prueba descubrió:** quitarle el permiso a `PUBLIC` **no
> alcanza**. Supabase concede `EXECUTE` explícitamente a `anon` y a
> `authenticated` sobre las funciones nuevas del esquema `public`
> (`ALTER DEFAULT PRIVILEGES`), y un `GRANT` explícito sobrevive al `REVOKE` de
> `PUBLIC`. Sin revocarles a los dos por nombre, cualquiera con sesión podía
> llamar la RPC con el `ip_hash` que quisiera. Está revocado y hay una prueba que
> lo vigila.

### 1.5 El antispam

Dos topes por hora, porque frenan cosas distintas:

- **por origen (`ip_hash`): 5.** Un script radicando desde una máquina.
- **por punto: 10.** Diez personas reportando el mismo baño en una hora no es un
  ataque, pero tampoco son diez PQRS que haya que responder una por una. Al
  llegar al tope se le dice que el equipo ya está en eso.

Los cuenta `pqrs_publica_cupo()` con el índice `(ip_hash, created_at DESC)`, el
mismo criterio de
[20260906000000_empresas_cotizacion_rate_limit.sql](supabase/migrations/20260906000000_empresas_cotizacion_rate_limit.sql).
Los números son constantes con nombre dentro de la función y no una tabla: hoy no
hay pantalla que los cambie, y una tabla de parámetros que nadie edita es peor que
un número con nombre.

**El `ip_hash` admite NULL a propósito.** Se guarda `SHA-256(sal|ip)` y **nunca**
la IP, que es dato personal (Ley 1581 de 2012). La sal sale de `PQRS_IP_SALT` y,
si no está, de la llave con la que se firman los QR. Si no hay ninguna, se radica
igual con `ip_hash` NULL y el que protege es el tope por punto, que no necesita
conocer el origen. Lo que no se hace nunca es guardar la IP en claro ni usar una
sal fija escrita en el repositorio: con el espacio de IPv4 sería reversible en un
rato.

### 1.6 `pqrs_estado_publico()`: el radicado sirve para algo

Quien radicó sin cuenta se lleva un número y tiene derecho a saber en qué va. La
función responde **solo** por PQRS del canal `QR` —así no sirve para pescar PQRS
internas por número— y devuelve solo lo que esa persona ya sabe, más el estado y
la respuesta: nada de la bitácora interna, ni responsable, ni quién atiende.

El número no es una credencial (se puede adivinar), y por eso la función no
devuelve datos personales de nadie. Si algún día se quiere mostrar más, hace
falta un enlace firmado de corta duración (el mecanismo del ADR-A), no un
formulario con el número.

---

## 2. Las pantallas

### 2.1 `/q/<token>` — el punto de bifurcación que dejó F2

Cambio **aditivo**: si el contrato tiene `pqrs_publico` encendido (se pregunta
con `pqrs_publica_activa()`), aparecen dos botones —«Reportar una novedad» y
«Consultar un reporte que ya hice»—; si no, la página queda exactamente como
estaba. El bloque «Lo que sigue» sigue ahí, con F5 marcada como hecha y F4/F9
intactas para quien venga después.

### 2.2 `/q/<token>/pqrs` — el formulario

Lo llena alguien de pie, con una mano, en el pasillo de su edificio, y eso manda
en la forma: campos y botones grandes, la categoría se elige tocando una tarjeta
(no en un `select`), **anónimo por defecto** —pedir el nombre antes de que haya
escrito el problema es la forma más segura de que nadie reporte nada—, un solo
botón de enviar, y al terminar la pantalla se convierte en el **número de
radicado**, que es lo único que el residente se lleva.

Resuelve el código con la **misma** `resolverCodigo()` de F2 (forma, existencia,
firma, estado del QR, vigencia del contrato, estado del punto, y el evento de
auditoría de cada rechazo). No se reimplementó nada: si la firma del QR cambia,
cambia en un solo sitio.

Hasta **dos fotos**, comprimidas en el celular a 1.280 px antes de salir (el
cuerpo de una función de Vercel está limitado a 4,5 MB y las dos viajan juntas).
Suben por el servidor con la llave de servicio, porque sin `auth.uid()` ninguna
política del bucket `pqrs` deja subir nada — el mismo camino de
`/api/campo/medios`. **No se tocó ninguna política de storage.**

### 2.3 `/q/estado` — consultar un reporte

Un `GET` y nada de JavaScript: es la pantalla más simple del módulo y tiene que
abrir en cualquier celular. `/q/estado` es un segmento estático, así que en el
App Router gana sobre `/q/[token]` y no choca con la ruta de la placa.

### 2.4 `/pqrs` y `/pqrs/[id]` — lo que ve quien atiende

Columna nueva **«Punto / categoría»** en el listado y dos datos nuevos en la
ficha («Punto de control» y «De qué se trata»), los dos leídos de las columnas
desnormalizadas de la propia fila. El canal se lee «QR del punto».

La columna nueva va en prioridad 2 con ancho mínimo. Se intentó prioridad 3 para
que la tabla cupiera en un portátil de 1440 px y **fue peor**: en
`TablaEstandar` la prioridad 3 significa «solo en `lg`» (≥1024 px), así que la
columna desaparecía entre 640 y 1023 px sin ganar un píxel a 1440, y sin ancho
mínimo el nombre del punto se partía en tres renglones. Queda como estaba y el
desborde se anota abajo: **la tabla de PQRS ya se desplazaba a lo ancho a 1440
antes de F5** (medido: 1.779 px de tabla contra 1.390 de contenedor, de los
cuales ~190 son esta columna), y el arreglo de verdad es recortar «Asunto» o
«Sede», que es del módulo y no de esta fase.

En la bitácora, un mensaje que **no** entró por la consola lleva una etiqueta que
dice por dónde entró («Por el QR del punto · entrada»). Sin eso, `canal` y
`direccion` serían dos columnas que se guardan y nadie ve, y el hilo del correo
de §4.6 llegaría sin marca cuando se conecte el buzón.

`QR` **no** se ofrece al radicar desde la consola (`CANALES_PQRS_CONSOLA`): ese
canal lo pone la RPC pública cuando alguien escanea una placa, y la base exige
que una PQRS con canal `QR` lleve punto.

### 2.5 `/pqrs/categorias` — parametrizar lo que ve el residente

Dentro de `/pqrs` y **no en el menú lateral**: es la parametrización de un módulo
que ya está en el menú, como los plazos. Se entra desde el listado, con la clave
nueva. Permite crear, editar, reordenar y **apagar** categorías (nunca borrar),
y elegir si una es general o de un contrato.

Su tabla va en `overflow-x-auto` con ancho mínimo: con el `overflow-hidden` que
tenía al principio, en un celular los botones de editar y apagar quedaban fuera
del recorte y **no había manera de llegar a ellos**. Lo encontró la verificación
midiendo a 390 px.

---

## 3. Permisos

Una clave nueva en el grupo *Operación Conserjería* de
[lib/permisos.ts](apps/inventario/lib/permisos.ts):

| Clave | Qué abre |
|---|---|
| `parametrizar_pqrs` | el catálogo de categorías del QR público |

Va aparte de `gestionar_pqrs` porque cambiar el catálogo es cambiar **lo que ve
un residente en la calle**, y eso no es lo mismo que atender una PQRS. La
migración se la siembra a los roles que ya gestionan PQRS con `rol_base`
`ADMIN`/`SUPER_ADMIN`, para que nadie se quede sin poder tocarlo.

La RLS de `pqrs_categorias` usa `auth_permiso()` **también en la lectura**, como
exige el repositorio: la lee quien tiene acceso al módulo (la necesita para
radicar), y la escribe solo quien tiene la clave nueva.

---

## 4. Verificación

### 4.1 `scripts/probar-puntos-qr-f5.mjs` — 75 comprobaciones, en transacción

Contra la base **real**, dentro de `BEGIN … ROLLBACK`, importando los módulos de
la aplicación tal cual (`lib/pqrs/ip-hash.ts`, `lib/puntos-qr-firma.ts`), así que
si el hash o la firma cambian en la app, la prueba lo nota. Comprueba la
idempotencia del archivo completo dos veces, la estructura, el catálogo efectivo
por contrato, la radicación de punta a punta, los ocho rechazos, los dos topes
del antispam, que ninguna fila guarde algo con forma de IP, que la PQRS entre al
módulo con la RLS que ya estaba (y que el conserje de otra sede no la vea), que
el catálogo solo lo cambie quien tiene la clave, y que la RPC pública no esté al
alcance de un usuario con sesión.

### 4.2 En el navegador, de punta a punta

Con un punto de prueba y su placa firmada, en viewport de celular (375×812):

1. `/q/<token>` → la página del punto muestra «Reportar una novedad».
2. El formulario → categoría «Basuras», descripción, nombre y teléfono →
   **PQ-00048**, con «se responde a más tardar el 18 de noviembre de 2026».
3. `/q/estado?numero=PQ-00048` → estado «Radicada», categoría, punto y fecha.
4. Lo mismo con el **código tecleado** de la placa (`/q/7PP6-WNGB/pqrs`),
   anónimo → **PQ-00049**, que queda marcada como apertura manual.
5. Con `pqrs_publico = false`: el botón desaparece de la página del punto y la
   ruta directa explica que esa sede no recibe reportes por el QR.

En la base, la fila quedó con `canal = QR`, su punto, su zona, su placa, su
contrato, `ip_hash` de 64 hex, plazo de 15 días hábiles, `radicada_por` NULL y
`radicada_nombre = 'QR del punto'`; la bitácora, con el mensaje de sistema en
`QR/ENTRADA`; y `ronda_eventos`, con `PQRS_RADICADA` de actor `ANONIMO` por canal
`PUBLICO`.

### 4.3 Lo demás

- `npx tsc --noEmit` limpio.
- `npx vitest run`: **374 pruebas en verde** (hubo que declarar `PQRS_IP_SALT` en
  `.env.example` y en `turbo.json`, que es lo que exige `tests/proyecto/entorno.test.ts`).
- `scripts/auditar-permisos.mjs`: sin incoherencias nuevas. Aparece
  `app/api/pqrs/publica/route.ts` en «acciones que escriben sin verificar
  permiso», igual que las rutas de `/api/campo`: es una ruta **pública** a
  propósito, y lo que la autoriza es la firma del QR más la RPC.
- `scripts/verificar-permisos.mjs`: la base concede exactamente lo que dice
  `/roles`.

---

## 5. Lo que esta fase NO hizo

- **El desafío tipo captcha de §6.2.** No hay ninguno en el repositorio y elegir
  cuál es una decisión del usuario (§10.1). El freno de hoy es el doble tope por
  hora más la firma del QR, que es lo que impide fabricar un punto para radicar
  en masa.
- **La conversión a tarea o a OT de §6.3.** Necesita el camino inverso de
  `ronda_novedades` y tocar `mantenimiento_tickets`, que es de F7 y es un módulo
  en producción. La columna `pqrs_id` del ticket se decide allá.
- **La encuesta de satisfacción.** Las columnas (`satisfaccion`,
  `satisfaccion_at`) quedan listas, pero nadie las escribe todavía: preguntar
  «¿quedaste conforme?» exige que la respuesta le llegue a quien radicó, y eso
  depende de la cuenta de correo, que sigue sin conectar.
- **El hilo por correo dentro del caso.** `pqrs_bitacora.canal/direccion` ya
  están para eso; falta `imapflow` apuntando a un buzón dedicado, que es el
  pendiente conocido de §4.7.

---

## 6. Pendientes que esta fase deja anotados

1. **Encender `pqrs_publico` por contrato.** Nace apagado a propósito: recibir
   reportes de residentes es una decisión del cliente, no el estado natural. Hoy
   se enciende con un `UPDATE` en `grupo_reglas`; la pantalla de contratos de F1
   es el sitio donde debería estar el interruptor.
2. **`PQRS_IP_SALT` en Vercel.** Sin ella se usa la llave del QR, y sin ninguna
   de las dos el `ip_hash` queda NULL y solo protege el tope por punto.
3. **Decidir el captcha** (§10.1 del complemento 2).
4. **El corte de 8 s de Supabase ya no responde 500 en lo público.** La página
   de F5, su route handler y la página del punto (F2) atrapan el fallo y
   muestran «hubo un problema de conexión, vuelve a intentarlo». Se arregló
   también la de F2 —aunque es de otra fase— porque es el camino de entrada de
   F5: si esa revienta, el botón de reportar no existe. Apareció de verdad
   mientras se probaba: varias sesiones trabajando a la vez en la misma base se
   bloquean entre sí.
5. **El `package-lock.json` no tiene el enlace de `packages/ronda-core`**, que
   agregó F4: cualquier `npm install` lo deja como cambio sin comitear. No es de
   esta fase, pero conviene que alguien lo cierre.
6. **La tabla de `/pqrs` se desplaza a lo ancho en un portátil de 1440 px** y
   «Plazo de respuesta» queda fuera de la primera pantalla. Viene de antes de
   F5; esta fase le suma una columna. Se arregla recortando «Asunto» o «Sede»,
   o llevando «Quién radica» a prioridad 3.
7. Tres cosas cosméticas del módulo de PQRS que la verificación encontró de
   paso y que **no** son de F5: la cabecera de la ficha repite la fecha
   («18/11/2026 · 21 d · límite 18/11/2026»), la columna «Canal» parte «QR del
   punto» en dos renglones, y el placeholder del cajón de seguimiento se corta
   en la segunda línea.

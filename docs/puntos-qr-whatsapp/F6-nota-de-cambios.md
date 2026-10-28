# F6 — Activos del cliente: nota de cambios

Sexta fase del módulo de Puntos QR. Entrega el activo fijo del cliente —el
extintor, el ascensor, la bomba, la luminaria, la grifería, la puerta
automática— con su ficha, sus documentos, sus medidores y su propio código QR.

Fuentes: [02-complemento-2-integracion.md](docs/puntos-qr-whatsapp/02-complemento-2-integracion.md)
§4.2 (por qué `activos` se crea y no se mete en `maquinaria`), §2.4 (qué columna
de alcance lleva cada tabla), §5 (resumen del modelo) y §6 (F6 depende de F1 y
F2); [03-nomenclatura.md](docs/puntos-qr-whatsapp/03-nomenclatura.md), que manda
sobre los cuatro documentos.

Migración: [20261028000600_puntos_qr_f6_activos.sql](supabase/migrations/20261028000600_puntos_qr_f6_activos.sql).
Aplicada y verificada contra la base el 2026-10-28.

---

## 1. Lo que entra

| Tabla | Alcance (§2.4) | Para qué |
|---|---|---|
| `activo_tipos` | `grupo_id` **nullable** (NULL = todos los contratos) | catálogo de clases de activo |
| `activos` | `grupo_id` + `sede_id` **NOT NULL** | la instalación del cliente |
| `activo_documentos` | hereda del activo (sin `grupo_id`) | ficha técnica, manual, garantía, certificados |
| `activo_medidores` | `grupo_id` + `sede_id` **NOT NULL** | HORAS / CICLOS / LECTURA |
| `activo_lecturas` | `grupo_id` + `sede_id` **NOT NULL** | append: de aquí sale `valor_actual` |

Más `ronda_qr.activo_id` y el `CHECK` ampliado a "exactamente uno de
`punto_id` / `activo_id`", que es lo que deja al QR del activo usar el motor de
F2 tal cual, sin una segunda tabla de códigos.

Pantallas: `/rondas/activos` (lista en árbol padre/hijo + catálogo de tipos) y
`/rondas/activos/<id>` (ficha: datos, placa, documentos, medidores y lecturas).

Permisos nuevos, en el grupo **Operación Conserjería** de
[lib/permisos.ts](apps/inventario/lib/permisos.ts):

- `ver_activos_ronda` — entra y lee lo de su alcance de contratos.
- `gestionar_activos_ronda` — da de alta tipos y activos, sube documentos,
  define medidores y borra una lectura mal tomada.
- `registrar_lecturas_activos` — registra lecturas **y nada más**. Va aparte
  porque es lo que hace el técnico en sitio, que no tiene por qué poder editar
  la ficha del activo.

El QR del activo **no trae permiso nuevo**: reutiliza `gestionar_qr_ronda`, que
es la clave de "mandar a imprimir una placa", y da igual si la placa va en una
pared o en el costado de un ascensor.

---

## 2. Cómo conviven los dos QR de equipo

En el repositorio ya había un QR de equipo funcionando por otro camino. **No se
tocó.** Son dos cosas distintas y se dejan distintas:

| | El que ya existía | El de F6 |
|---|---|---|
| Ruta | `/equipo/<ref>` | `/q/<token>` |
| Qué identifica | `maquinaria`: equipo **propio y móvil de la empresa** | `activos`: instalación **fija del cliente** |
| Contenido del código | el `codigo` (o el id) en claro, **sin firma** | token firmado con HMAC-SHA256 (ADR-B) |
| Quién puede abrirlo | exige **sesión** y permiso de mantenimiento | **público**, y deja evento en `ronda_eventos` |
| Semántica | patrimonial (`valor`, `fecha_adquisicion`, estado `BAJA`) | operativa (se mantiene mientras dure el contrato; se `RETIRA`, no se da de baja) |

No comparten tabla, ni ruta, ni espacio de nombres, así que un QR de
`maquinaria` nunca resuelve a un activo ni al contrario. Un equipo propio de la
empresa que esté en la sede del cliente se sigue registrando en `maquinaria`.

El motivo de fondo para no meter los activos en `maquinaria` es de seguridad y
está en §4.2: `mant_puede_participar()` **no tiene ningún alcance por sede ni
por contrato** —es solo `auth_permiso_any('{ver_mantenimiento,…}')`— y de ella
cuelgan las políticas de lectura de tickets y actividades. Con los activos de
los clientes ahí dentro, cualquiera con `ver_mantenimiento` leería los activos
de todos los clientes.

---

## 3. Decisiones que tomó esta fase

1. **La lectura no se edita: se borra y se vuelve a tomar.** `activo_lecturas`
   no tiene política de `UPDATE`. Sí tiene de `DELETE` (con
   `gestionar_activos_ronda`), y al borrar, el trigger recalcula
   `valor_actual`. Sin ese `DELETE`, una digitación de más —999999 en vez de
   9999— bloquearía un contador acumulativo para siempre.
2. **`valor_actual` es caché, no fuente de verdad.** La fuente es
   `activo_lecturas`; un trigger recalcula la columna en cada `INSERT` y cada
   `DELETE`. Se guarda porque F7 la va a consultar para los planes por medidor
   y una subconsulta por activo en cada cálculo de plan no se paga.
3. **`created_at` de las lecturas usa `clock_timestamp()`, no `NOW()`.** `NOW()`
   es la hora de la transacción y vale lo mismo para todas sus filas: dos
   lecturas del mismo medidor empatarían y el desempate caería en el UUID, que
   es aleatorio, así que "la última lectura" saldría al azar.
4. **Un contador no baja.** Si el medidor es `acumulativo`, una lectura menor
   que la mayor registrada se rechaza en la base. Un contador reemplazado se
   registra creando un medidor nuevo, no bajando el valor del anterior.
5. **El código del activo sale de una `SEQUENCE`** (`AC-000001`), como manda §4
   de la nomenclatura, y es único **por contrato**.
6. **La clave pública es inmutable** y el generador mira ahora `ronda_puntos`
   **y** `activos`, para que una placa de punto y una de activo nunca muestren
   la misma clave.
7. **Un activo con QR emitido no se borra, se `RETIRA`.** La placa ya existe en
   el mundo físico.
8. **`ronda_qr_por_token()` de F2 conserva su forma.** F6 necesita dos columnas
   más (`tipo_objeto` y `activo_id`) y las trae en una función propia,
   `ronda_qr_objeto_por_token()`. Cambiarle el tipo de fila a la de F2 exigiría
   soltarla, y como F2 la declara con `CREATE OR REPLACE`, volver a aplicar la
   migración de F2 fallaría. Una fase no puede dejar a la anterior sin poder
   re-aplicarse.

### Trampa de orden que conviene no perder

F6 redefine dos funciones de F2 (`ronda_qr_derivar()`, que aprende el caso
`ACTIVO`, y `ronda_clave_punto_libre()`, que pasa a mirar también `activos`).
Son `CREATE OR REPLACE` con la misma firma, así que **volver a aplicar la
migración de F2 sobre una base que ya tiene F6 revierte esas dos funciones a la
versión de F2** y el QR de activo dejaría de derivar su contrato. La regla de
siempre basta: las migraciones se aplican **en orden de nombre de archivo**. Si
hay que re-aplicar F2, se re-aplica F6 después.

---

## 4. Lo que F7 necesita saber

F7 (planes preventivos y órdenes de trabajo) depende de F6. Los nombres
definitivos:

**A qué se ata un activo en un ticket de mantenimiento**

- `activos.id` → es lo que apunta `mantenimiento_tickets.activo_id`, que **lo
  agrega F7**, nullable, con el `CHECK` de que esté `maquinaria_id` **o**
  `activo_id` (§4.2). F6 **no tocó `mantenimiento_tickets` ni el enum
  `estado_ticket_mant`**, a propósito: §6 dice que el primer entregable de F7 es
  el acuerdo sobre los estados nuevos, no el SQL.
- `activos.grupo_id` → lo que F7 copia a `mantenimiento_tickets.grupo_id` para
  darle al ticket el alcance por contrato.
- `activos.sede_id`, `activos.zona_id`, `activos.punto_id` → dónde hay que ir.
- `public.activo_en_alcance(p_activo UUID) RETURNS BOOLEAN` → la función con la
  que F7 puede filtrar por contrato la orden de trabajo de un activo **sin
  tocar `mant_puede_participar()`**, que no tiene alcance y del que cuelga el
  módulo que ya está en producción. Está concedida a `authenticated`.

**Para los planes preventivos**

- Plan **por tipo**: `activo_tipos.id`. El tipo ya trae
  `obligatorio_normativo BOOLEAN` y `normativa VARCHAR(120)` (de ahí sale el
  plan normativo de §2.2, la recarga anual del extintor, sin volver a
  escribirlo) y `vida_util_meses SMALLINT`.
- Plan **por medidor**: `activo_medidores.id`, `.tipo`
  (`HORAS`/`CICLOS`/`LECTURA`), `.unidad`, `.valor_actual DECIMAL(14,3)`,
  `.leido_at TIMESTAMPTZ`, `.acumulativo` y `.valor_alerta`. `valor_actual` y
  `leido_at` están siempre al día: los recalcula el trigger
  `activo_lecturas_refrescar` y **no se escriben a mano**.
- Vista `vw_activos_medidor_vencido` (`security_invoker = true`, así que hereda
  la RLS): medidores que llegaron o pasaron su `valor_alerta`, con el activo,
  la sede y `excedido_en` ya resueltos. Para no recalcularlo en cada tablero.
- `activo_tipos.exige_medidor` dice si ese tipo suele llevar medidor; la ficha
  del activo ya avisa cuando el tipo lo pide y el activo no lo tiene.

**Para la ejecución en campo de la orden de trabajo**

- `activo_lecturas.visita_id → ronda_visitas(id)` ya existe: la lectura que
  toma el técnico durante una visita queda atada a esa visita. `persona_id`,
  `usuario_id` y `origen` (`CONSOLA/APP/WHATSAPP/IOT/SISTEMA`) también.
- El QR del activo ya resuelve en `/q/<token>`; la página pública de un activo
  deja dicho en un solo sitio dónde entra "reportar una falla de este equipo",
  que es de F7.

**Archivos**

- Bucket privado `rondas`, carpeta `activos/<activo_id>/`. Funciones
  `activo_de_ruta(TEXT)`, `activo_archivo_puede_subir(TEXT)` y
  `activo_archivo_puede_ver(TEXT)`; las políticas de `storage.objects` se
  llaman `activos_storage_*` y están acotadas a esa carpeta, así que F7 puede
  traer las suyas sin pisarlas.

---

## 5. Qué se probó y cómo

- **`scripts/probar-puntos-qr-f6.mjs`** — 88 comprobaciones contra la base real
  dentro de `BEGIN … ROLLBACK`: idempotencia de la migración (dos pasadas
  completas), estructura y nulabilidad de §2.4, derivación de `grupo_id` desde
  la sede (se manda mal a propósito), coherencia de zona, punto, tipo y padre,
  ciclos de la jerarquía, inmutabilidad de la clave pública, reglas del medidor
  (un contador no baja, una lectura del futuro se rechaza, `valor_actual` se
  recalcula al borrar), el QR del activo firmado sobre el UUID del **activo**,
  una sola placa activa por activo, la vigencia efectiva del contrato, la
  decisión REAL de `app/q/decidir.ts` para los dos tipos de placa, y el alcance
  por contrato de la RLS con los tres permisos.
- **`scripts/probar-puntos-qr-f1/f2/f3.mjs` y `probar-placas-qr-f2.mjs`** —
  28 + 98 + 92 + 47 comprobaciones, todas en verde: F6 no rompió lo anterior.
- **Navegador, con el servidor de verdad** — `/q/<token>` de un activo abre su
  ficha con la firma verificada; el código manual impreso bajo el QR abre el
  mismo activo marcado como apertura manual; `/q/<token>` de un punto sigue
  abriendo el punto y ahora lista los equipos que están en él (§2.1).
- **Navegador, banco de pruebas** (los dos componentes reales con datos reales):
  alta de tipo (con la unidad del medidor siguiendo a la clase), alta de activo
  (con zonas y puntos acotados a la sede elegida y la criticidad que propone el
  tipo), subida de documento (la ruta cae en `activos/<id>/`, que es la que la
  política de storage acepta), registro de una lectura, y la placa: PDF armado
  con el generador de F2 e impresión registrada.
- `npx tsc --noEmit` limpio, `npx vitest run` 374/374, `auditar-permisos.mjs`
  sin incoherencias nuevas y `verificar-permisos.mjs` sin discrepancias.

Los datos de muestra que se usaron para probar en el navegador **se borraron**:
la base vuelve a tener cero activos. Lo único que queda sembrado es el catálogo
general de ocho tipos (`grupo_id IS NULL`), que es catálogo, no muestra.

---

## 6. Lo que queda pendiente o pide una decisión

1. **Los tres permisos nuevos no los tiene ningún rol todavía.** Están en el
   catálogo de `/roles` y las políticas los exigen, así que hasta que alguien
   los marque, solo `ADMIN` y `SUPER_ADMIN` ven la pantalla. Es lo mismo que
   pasó con F2 y F3, y se resuelve en `/roles`. El rol Auditor sí recibió
   `ver_activos_ronda` en la migración, como ya tenía el catálogo de F3.
2. **La llave HMAC tiene que estar en Vercel** (`RONDA_HMAC_LLAVE_ACTUAL` y el
   secreto de esa llave). Sin ella, la ficha del activo muestra el aviso y no
   deja emitir placas — a propósito: una placa que nadie puede verificar es
   peor que no tenerla. Es el mismo pendiente que dejó F2.
3. **Impresión de placas de activo, de a una.** La ficha imprime la placa del
   activo que se está viendo; no hay lote de activos como el de
   `/rondas/qr` para puntos. Si hace falta mandar a imprimir cincuenta
   extintores de una sede, es una pantalla de lote y conviene hacerla junto con
   la de puntos, no aparte.
4. **Las fotos del activo (`activos.fotos`) quedan declaradas y sin pantalla.**
   La columna existe y la carpeta del bucket admite imágenes; subirlas desde la
   ficha es media hora más y no estaba en la fila F6.
5. **Decisión del usuario, cuando quiera tomarla:** si un activo del cliente
   puede quedar atendido por un proveedor externo (hoy solo se guarda
   `proveedor_id` como quién lo instaló o lo garantiza). Eso lo define F7 con
   `mantenimiento_tickets.proveedor_id`, y conviene decidirlo allá.

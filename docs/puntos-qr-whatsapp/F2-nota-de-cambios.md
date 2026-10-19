# F2 — Estructura, puntos de control y código QR

Segunda fase del módulo de Puntos QR, Tareas y Bot de WhatsApp. F1 dejó el
contrato como eje; F2 cuelga de él lo que se pega a una pared: la zona, el punto
de control y el QR con su ciclo de vida, la ruta pública que lo abre y las
pantallas para levantar puntos e imprimir placas.

> **La migración NO está aplicada en la base de datos.** Está escrita y
> verificada dentro de `BEGIN … ROLLBACK`, corriendo primero F1 y después F2, el
> archivo completo dos veces cada uno. En la base no existe ninguna de estas
> tablas todavía: la aplica el usuario cuando decida.

---

## Qué quedó

### Migración `20261019000020_puntos_qr_f2_puntos.sql`

Cinco tablas, todas con RLS **también en las lecturas** y con el alcance por
contrato de F1 (`grupo_id IN (SELECT auth_grupos())`):

| Tabla | Qué es | `grupo_id` | `sede_id` |
|---|---|---|---|
| `ronda_zonas` | piso, torre o área de la sede | NOT NULL | NOT NULL |
| `ronda_puntos` | el punto físico que lleva el QR | NOT NULL | NOT NULL |
| `ronda_qr_lotes` | tanda de impresión, consecutivo `LQ-000001` | NOT NULL | NOT NULL |
| `ronda_qr` | una fila por **versión** del código | NOT NULL | NOT NULL |
| `ronda_eventos` | auditoría append-only, encadenada por entidad | nullable | nullable |

Lo que conviene saber de cada una:

- **`grupo_id` se deriva de la sede en un trigger, nunca se recibe.** Es la
  columna por la que filtra la RLS: si la pantalla pudiera elegirla, un error de
  formulario metería un punto de un contrato dentro de otro. Los triggers
  `BEFORE` corren antes del `WITH CHECK` de la política, así que el valor
  derivado también se verifica contra el alcance del usuario (está probado).
- **`ronda_puntos`** guarda nombre, código corto único por sede, descripción de
  cómo llegar, `lat`/`lng`, la **precisión del GPS con la que se capturó**,
  `geocerca_metros` (30 por defecto, CHECK 5–2000), `exige_geocerca` para los
  sótanos sin señal, piso, horario (`horario_dias` 1=lunes…7=domingo, más
  `desde`/`hasta`) y estado `BORRADOR/ACTIVO/SUSPENDIDO/RETIRADO`.
- **`ronda_puntos.clave_publica`** es nueva y no estaba en el documento 00: 8
  caracteres de base32 sin ambigüedades, únicos y **inmutables**, que son los que
  viajan dentro del token. Hacía falta porque el `<punto_b32>` del ADR-B no puede
  ser el UUID (no cabe en una etiqueta legible) ni el `codigo` (que la operación
  puede renombrar, y renombrar no puede matar las placas ya pegadas).
- **`ronda_qr` lleva `tipo_objeto`** desde ya (`PUNTO` / `ACTIVO`), porque luego
  habrá QR de activos. Mientras `activos` no exista, el CHECK solo deja insertar
  `PUNTO`; esa fase agrega `activo_id` y amplía el CHECK.
- **Un solo QR activo por punto**, garantizado por el índice único parcial
  `ux_ronda_qr_activo`, no por la aplicación: dos activos son dos placas válidas
  en la misma pared, y eso no puede depender de que no haya una carrera entre dos
  pestañas.
- **`ronda_eventos` es append-only de verdad**: no tiene política de `UPDATE` ni
  de `DELETE`, así que esos comandos quedan prohibidos para `authenticated`. El
  encadenado SHA-256 es **por entidad**, con un candado de aviso por entidad para
  que dos inserciones simultáneas del mismo punto no lean el mismo
  `hash_anterior`.

Funciones nuevas: `ronda_qr_vigente(qr, fecha)`, `ronda_qr_por_token(token)`,
`ronda_qr_siguiente_version(punto)`, `ronda_qr_revocar(qr, motivo, estado)`,
`ronda_qr_registrar_impresion(qr, formato, lote)`, `ronda_acceso()`,
`ronda_gestiona_puntos()`, `ronda_gestiona_qr()` y los generadores de códigos.

**La vigencia es calculada, no un estado que se actualice** (§2.5 del
complemento 2): `ronda_qr_vigente()` es `estado = 'ACTIVO' AND
grupo_vigente(grupo_id)`, colgando de la función de F1. No hay ningún `UPDATE`
masivo al vencer un contrato, y está probado que al renovar los QR vuelven a
servir **sin que ninguna fila cambie de estado**.

### El token firmado (ADR-B)

`apps/inventario/lib/puntos-qr.ts` (puro, sin dependencias) y
`lib/puntos-qr-firma.ts` (`node:crypto`, solo servidor). El token mide 21
caracteres:

```
<v><clave_publica><version><firma>      1 + 8 + 2 + 10
"1"  "K7M4QX9T"      "01"  "A9F3C1B7E2"
```

y la firma son los 10 primeros caracteres en base32 sin ambigüedades de
`HMAC-SHA256(llave_cliente_vN, "<v>|<punto_id>|<version>")`. La llave **no está
en la base**: vive en variables de entorno (`RONDA_HMAC_LLAVE_ACTUAL` y
`RONDA_HMAC_<ID>`, declaradas en `turbo.json` y en `.env.example`), y en
`ronda_qr.firma_llave_id` solo queda cuál se usó. Si no hay llave configurada, la
pantalla **no deja emitir** y lo dice: un QR sin firma verificable es una placa
que nunca va a abrir.

El **código manual** son 8 caracteres sin `I`, `L`, `O`, `U`, `0` ni `1`, se
imprime bajo el QR y abre el mismo flujo marcando `aperturaModo = 'MANUAL'`.

### Ruta pública `/q/<token>`

Con `/q/`, no `/p/` (nomenclatura §3). `app/q/decidir.ts` tiene la decisión y
`app/q/puerta-supabase.ts` el acceso a datos; van separados para poder probar la
decisión contra la base de verdad sin montar Next. El orden de las
comprobaciones importa y está probado una por una:

forma → existencia → **firma** → estado del QR → vigencia del contrato → estado
del punto.

Cada rechazo deja un evento `APERTURA_RECHAZADA` en `ronda_eventos` con su
motivo, incluso cuando no se sabe de qué contrato era (por eso `grupo_id` es
nullable ahí). Esos rechazos son la señal de fraude más barata del módulo y hoy
no se registran en ningún otro lado.

La página muestra el nombre del punto y el lugar, y **deja marcado el punto de
bifurcación sin construirlo**: ejecutar la ronda es F4, la PQRS pública es F5 y
WhatsApp es F9. Está en un solo sitio del archivo, con un comentario que dice qué
entra en cada fase.

`/q/` se agregó a las rutas públicas de `proxy.ts`. La página corre con la llave
de servicio porque **quien escanea puede no tener sesión**: la autoridad ahí es
la firma del token, no una cookie.

### Pantallas de consola

- **`/rondas/puntos`** — zonas y puntos. Listado paginado con `traerTodo` y orden
  estable (`sede_nombre, orden, codigo, id`), filtros por sede, estado y texto,
  y editor que **captura `lat`/`lng` con la precisión del GPS**
  (`enableHighAccuracy`, sin caché). Si la precisión es peor que el radio de la
  geocerca, la pantalla lo dice en vez de esconderlo: con ±80 m y una geocerca de
  30 m, la geocerca no distingue nada. Un punto con QR emitidos no se borra —
  queda `RETIRADO`, porque borrarlo dejaría placas pegadas sin nada detrás.
- **`/rondas/qr`** — emisión, reemplazo, revocación e impresión por lotes.
  Reemplazar cierra la versión anterior como `REEMPLAZADO` (RPC) y emite la
  siguiente; revocar deja el punto sin código. Historial de versiones por punto.
- **PDF de placas** con `jspdf` + `qrcode`, que es lo que ya usa el carné: **no
  entra ninguna librería nueva**. Cuatro formatos — sticker 8×8 cm, placa A6,
  placa A5 y hoja A4 con 6 por página con marcas de corte —, vista previa en un
  iframe antes de imprimir, y el lote con su consecutivo se crea **al confirmar**,
  no al mirar la previa: mirar un PDF no es imprimir. Cada impresión suma al
  contador del QR y deja su evento con el formato y el lote.

### Permisos

Tres claves nuevas, planas y en `snake_case`, al final del grupo *Operación
Conserjería*, sin tocar nada de lo que ya había:

| Clave | Para qué |
|---|---|
| `ver_puntos_ronda` | entrar a `/rondas/puntos` y `/rondas/qr` y leer |
| `gestionar_puntos_ronda` | crear y editar zonas y puntos |
| `gestionar_qr_ronda` | generar, imprimir y revocar códigos |

`ver_puntos_ronda` no se confunde con `ver_puntos_hogar` (recompensas), ni
`ver_contratos`/`editar_contratos` (inventario) con las `*_conserjeria`.

---

## Decisiones que tomé y por qué

**El sticker de 8×8 cm no lleva sede ni logo.** Con un QR de 50 mm y la franja
del contrato, a un adhesivo de 80 mm le quedan unos 15 mm útiles: ahí caben el
nombre del punto y el código manual, y nada más. La primera versión los metía
igual y los imprimía **fuera del adhesivo**; lo detectó la prueba que mide dónde
quedó cada trazo. Ahora la placa se arma desde el borde inferior hacia arriba y
cada elemento entra solo si hay sitio, en este orden: código manual siempre,
luego el pie, luego el logo, y el nombre y la sede usan lo que sobre. El QR nunca
se achica.

**El código manual se agrupa 4-4 (`K7M4-QX9T`), no 3-4.** El ADR-B escribe
`K7M4QX9T` → `K7M-4QX9`, que se come un carácter de los ocho. Un código impreso
al que le falta una letra no abre nada.

**La llave foránea de `ronda_zonas.puesto_id` se agrega solo si `puestos`
existe.** Esa tabla la crea la migración de programación (20261018000005), que
tampoco está aplicada. Exigirla dejaría F2 sin poder correr; así, al aplicar
programación y volver a correr esta migración, la llave queda puesta.

**La verificación del token va en la aplicación, no en la base.** La llave HMAC
no puede estar en la base de datos (ADR-B), así que `ronda_qr_por_token()`
resuelve y dice si el QR sirve, pero **no** verifica la firma: eso lo hace el
único sitio que tiene la llave.

---

## Lo que NO hice, a propósito

- **No rellené los huecos del complemento 1** (§7 del documento 02). Quedan
  reservados y vacíos: `ronda_qr.foto_instalacion` (una ruta) y
  `ronda_puntos.fotos_referencia` (un arreglo). **No diseñé ninguna tabla de
  anclas 360°** y `grupo_reglas.nivel_antifraude` sigue `TEXT` sin `CHECK`.
- **No inventé niveles de rigor antifraude.** El punto solo lleva
  `exige_geocerca`, que es lo que §2.1 pide para los sótanos sin señal.
- **No construí la bifurcación de `/q/`**: ejecución (F4), PQRS pública (F5) y
  WhatsApp (F9) quedan marcadas y sin empezar.
- **No creé el bucket `rondas`** del ADR-C: la evidencia es de F4. Las dos
  columnas de fotos guardan rutas de ese bucket cuando exista.
- **No toqué** `00-exploracion-y-plan.md`, `02-complemento-2-integracion.md`,
  `03-nomenclatura.md` ni los dos ADR.

---

## Lo que queda pendiente y hay que decidir

1. **Aplicar la migración.** Requiere aplicar antes la de F1. Ninguna de las dos
   está en la base.
2. **Configurar `RONDA_HMAC_LLAVE_ACTUAL` y el secreto de la llave**, en local y
   en Vercel. Sin eso la pantalla no deja emitir ningún código (a propósito).
3. **Asignar las tres claves nuevas a los roles en `/roles`.** Hasta que alguien
   lo haga, solo `ADMIN` y `SUPER_ADMIN` entran a las pantallas. Las tres están
   en la lista `PENDIENTES` de `scripts/auditar-permisos.mjs` por eso; al
   aplicar la migración y asignarlas, se pueden sacar de ahí.
4. **HMAC contra Ed25519: el choque con el ADR-02 sigue abierto.** El ADR-02 pide
   Ed25519 para poder verificar el QR **sin conexión** sin meter el secreto en el
   APK; con HMAC, la verificación offline obligaría a repartir el secreto, así
   que un QR inventado solo se detecta al sincronizar. F2 implementó HMAC porque
   es lo que dice el ADR-B y es lo que se me pidió, pero **esto hay que cerrarlo
   antes de imprimir placas de verdad**: cambiar de esquema después obliga a
   reimprimir todo lo que esté pegado.
5. **`arte_logo_path` del contrato todavía no se puede resolver**: no hay bucket
   donde viva ese logo. Las placas llevan el color del contrato y el logo de la
   empresa que ya está en `/public`.
6. **El número de esta migración es `20261019000020`**, que queda fuera de la
   banda `...000010`–`...000019` que reservó la nomenclatura §5. Se numeró así
   porque F2 y F3 corren en paralelo y se pasó a numerar de diez en diez para que
   las ramas no choquen; la banda del módulo queda `20261019000010`–`...000099`,
   todavía por fuera del tramo de las otras ramas (que llega a `...000005`). Vale
   la pena corregir §5 del documento de nomenclatura, que es de otra sesión.

---

## Cómo se verificó

Dos scripts, ninguno de los dos aplica nada:

```bash
node --use-system-ca scripts/probar-puntos-qr-f2.mjs
node scripts/probar-placas-qr-f2.mjs
```

**`probar-puntos-qr-f2.mjs` — 98 pruebas, 0 fallas.** Corre dentro de
`BEGIN … ROLLBACK` contra la base real. Modelado sobre el de F1, con dos cosas
más: importa los módulos **reales** de la aplicación (Node 24 ejecuta TypeScript
quitando los tipos), así que lo que se prueba es el mismo código que corre en
producción y no una copia; y ejecuta la decisión de `/q/<token>` contra esta
misma transacción, con una puerta de datos sobre `pg` en vez de PostgREST.

Cubre: idempotencia (los dos archivos completos, dos veces en la misma
transacción), la estructura de §2.4, la derivación de `grupo_id`, la inmutabilidad
de la clave pública, la firma (llave buena, llave ajena, otro punto, otra
versión, un carácter cambiado), un solo QR activo por punto, revocar y la versión
siguiente, la vigencia efectiva sin tocar filas, el alcance por contrato en
lecturas y escrituras, el consecutivo del lote, el registro de cada impresión,
el append-only de `ronda_eventos` y los nueve caminos de rechazo de `/q/`.

**`probar-placas-qr-f2.mjs` — 47 pruebas, 0 fallas.** No toca la base. Comprueba
que el QR salga a 50 mm o más en los cuatro formatos y que cada módulo quede por
encima de 0,4 mm impresos (criterio de legibilidad, no opinión: con 33×33 módulos
a 50 mm quedan en 1,52 mm), que el código manual quede **impreso**, el número de
páginas y el tamaño de hoja, el peso del PDF, y — leyendo el flujo de contenido
del PDF — que **ningún texto ni imagen se salga de su placa**. Fue esta última la
que encontró el desbordamiento del sticker. Deja muestras en PDF para mirar.

Además: `npx tsc --noEmit -p .` limpio en `apps/inventario`, y los tres scripts
de permisos sin incoherencias nuevas (`auditar-permisos.mjs` vuelve a 14 claves
con incoherencias, las mismas de antes; 0 pantallas sin control de acceso sobre
95; 0 acciones que escriben sin verificar sobre 41; `verificar-permisos.mjs` sin
discrepancias; `verificar-lecturas.mjs` igual que antes).

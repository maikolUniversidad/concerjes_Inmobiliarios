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

**Personas pasó a paginación de servidor.** Antes pedía todas las fichas de una
y filtraba en memoria. Eso funcionaba con 79 personas; con 6.639 dejó de
funcionar en silencio, porque **PostgREST corta toda respuesta en 1.000 filas
sin error y sin aviso**: la pantalla decía «1000 de 1000 personas» y las otras
5.639 simplemente no existían para quien la usaba. Ahora la búsqueda, el filtro
por estado y la paginación son del servidor, el contador dice el total real, y
la vista (tabla o tarjetas) viaja en la URL como los demás filtros.

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

### 2. ~78 tablas se leen con `USING (true)`

La plataforma se diseñó cuando «autenticado» eran 27 personas de confianza, y
por eso casi todo se lee sin filtro. Ahora «autenticado» son casi novecientas
cuentas. Este trabajo cerró las dos tablas que no podían seguir abiertas —
`personas` y `documentos_persona`, que tienen salario, dirección, teléfono y
documentos de vinculación de 6.564 personas — atándolas a los permisos de
Gestión Humana, con la excepción de la ficha propia (es lo que alimenta el
carnet).

**Siguen abiertas a cualquier autenticado**, entre otras: `movimientos`,
`productos`, `ordenes_compra`, `oc_items`, `precios_proveedor`,
`conductor_ubicacion_actual` e `historial_cambios`. Hay que decidir de frente
qué ve un empleado raso y cerrar el resto con `auth_permiso_any`, o dejarlo por
escrito como decisión consciente. Se detecta con:

```bash
node scripts/auditar-permisos.mjs
node scripts/verificar-permisos.mjs
```

### 3. Fichas por revisar (`vw_planta_inconsistencias`) — 459

| Motivo | Cuántas | Qué pasa |
|---|---|---|
| `NOMBRE_DUDOSO` | 350 | los informes traen «Apellidos y Nombres» en un solo campo y sin separador |
| `DOCUMENTO_SOSPECHOSO` | 74 | fichas viejas cargadas a mano con un celular en el campo del documento (no vienen de este cargue) |
| `SIN_CIUDAD` | 35 | el informe no trae ciudad para esas filas |
| `ACTIVO_CON_RETIRO_RECIENTE` | 0 | retiro a menos de 15 días del corte del informe (posible desfase entre los dos exportes) |

Sobre el **corte del nombre**: no se adivina por el número de palabras
(«GAMEZ BLANCA INES» es 1 apellido + 2 nombres, «RIVERA PACHECO EDUARDO» es 2 + 1).
Se aprende del propio archivo: la última palabra de un nombre completo siempre es
un nombre de pila y la primera siempre es un apellido, así que la frecuencia de
cada palabra en esas dos posiciones dice de qué lado cae. Salió **ALTA 6.214,
MEDIA 248, BAJA 102** — las BAJA son casi todas nombres de dos palabras, donde el
informe mismo viene incompleto. `personas.nombre_completo` guarda siempre el dato
original, así que ningún corte pierde información.

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

Los 92 centros están creados pero ninguno apunta todavía a una `obra` ni a un
cliente (`obras` está vacía). Hasta que se llenen, «personal por contrato» se
responde por el código del centro de costos, no por el contrato de servicio.

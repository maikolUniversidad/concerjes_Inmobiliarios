# Programación de personal (turnos) — bases

Estado: **fase 1 en construcción** (2026-10-18). La **decisión 1 ya está tomada:
se crea el nivel «puesto»** (ver §8). El resto de la propuesta sigue sin migrar.

El módulo responde una sola pregunta, todos los días: **¿quién cubre cada puesto
mañana, y qué puesto se quedó sin nadie?** Hoy eso vive en WhatsApp y en Excel.

---

## 1. Qué existe hoy

Los insumos ya están en la plataforma, pero vienen de **dos mundos que no se
hablan**.

| Pieza | Tabla | Cuántos | Qué aporta | Qué le falta |
|---|---|---|---|---|
| **Sedes** (lado inventario) | `sedes` | **197** (194 activas) en 68 ciudades | el sitio físico del cliente: nombre, ciudad, grupo de contrato, y **responsable de sede** | no sabe de turnos ni de cuánta gente necesita; 123 de 197 no tienen responsable |
| **Centros de costo** (lado nómina) | `centros_costo` | **624**, de los cuales **92 tienen gente activa** | el contrato como lo ve nómina: `TRANSMILENIO 2026-BOGOTA` | `obra_id`, `cliente_id` y `grupo_id` están **vacíos en los 624**; no hay nada que lo amarre a una sede |
| **Personas** | `personas` | 6.639 fichas, **938 activas** | documento, cargo, ciudad, salario, centro de costo | nada sobre su horario ni su día de descanso |
| **Vinculaciones** | `persona_vinculaciones` | 7.036, **864 activas** | el historial laboral; una sola activa por persona | — |
| **Disponibles** | `vw_personal_disponible` | **16** | el banco de personal sin asignar (`DISPONIBLE-BOGOTA`), todos OPERARIO ASEO en Bogotá | es una foto de hoy: no sabe quién está libre *el jueves* |
| **Patrones de turno** | `vac_listas_opciones`, lista `TURNO` | **15 opciones** | el vocabulario ya existe: `8HD_LV`, `8HN_LD`, `6AM_2PM_LD`, `ROTATIVO_8H`… | son solo etiquetas: no tienen hora de inicio, ni horas, ni días |
| **Requisiciones** | `requisiciones.turnos[]` | 0 filas aún | al pedir personal ya se declara **qué turnos** se necesitan | nadie convierte eso en una programación |
| **Responsables de sede** | `sedes.responsable_id` → `personas` | **74** | quien está en el sitio y sabe quién faltó | son fichas manuales, sin centro de costo ni vinculación laboral |

### Lo no obvio: la operación está muy desbalanceada

| Centro de costo | Personas activas |
|---|---|
| TRANSMILENIO 2026-BOGOTA | **302** |
| CORFERIAS 2025-BOGOTA | 144 |
| CORFERIAS PUERTA DE ORO 2025-BARRANQUILLA | 64 |
| UT RED CULTURAL Y LA SCRD 567-2026-BOGOTA | 56 |
| UNAD 2026-BOGOTA | 31 |
| OPERATIVO ADM-BOGOTA | 23 |
| …los otros 86 centros | **1 a 17 cada uno** |

**620 de las 864 personas activas están en 6 centros de costo.** Los otros 86
tienen 8 o menos. Eso parte el módulo en dos problemas distintos:

* **Un contrato grande** (Transmileno, Corferias) necesita una malla de turnos
  rotativos sobre decenas de puntos físicos. En `sedes` TRANSMILENIO son **dos
  filas** («TRANSMILENIO» y «OFICINAS TRANSMILENIO») para 302 personas: el sitio
  físico real —la estación, el patio, el portal— **no existe en el modelo**.
* **Una sede chica** (una biblioteca, una sede de la UNAD) tiene 1 a 4 personas
  con horario fijo. Ahí «programar» es confirmar que el de siempre fue, y
  reemplazarlo cuando no va.

Por eso la propuesta mete un nivel nuevo —el **puesto**— y no cuelga el turno
directo de la sede.

### Y el cargo casi siempre es el mismo

De 938 activos: **715 OPERARIO ASEO**, 74 RESPONSABLE DE SEDE, 54 OPERARIO ASEO
Y CAFETERÍA, 13 INSPECTOR ASEO, 10 OPERARIO ALTURAS, 8 SUPERVISOR. Es decir: para
cubrir una ausencia, **el 80% del personal es intercambiable por cargo**, y el
filtro real al buscar reemplazo va a ser la ciudad, el curso de alturas y la
distancia, no el cargo.

### Tamaño del turno, con lo que dice la nómina

No hay datos de turnos todavía, pero la nómina deja ver la forma:

* **822 de 938 ganan entre 1,5 y 3 millones** → jornada completa.
* **12 personas** están en el tipo de nómina «Producción Salario Inferior al
  Mínimo» → son los de **medio tiempo** (los `4HD_*` del catálogo).
* El catálogo de turnos del ATS describe bloques de **8 horas diurnas, 8 nocturnas
  y 4 horas**, en tres coberturas: L-V, L-S y L-D; más «rotativos de 8 H» y
  «46 horas semana».
* La etiqueta **`46H_SEMANA` ya quedó vieja**: la jornada legal bajó por etapas
  con la Ley 2101 de 2021. El tope no se puede dejar escrito en el código.

**Conclusión:** la unidad es el **bloque de 8 horas** (4 en medio tiempo), sobre
una semana de lunes a domingo, con cobertura de 5, 6 o 7 días. Un contrato grande
programa tres bloques por puesto para cubrir 24 horas.

---

## 2. Cómo se arma un turno

```
Contrato (centro de costo)
   └── Sede (sitio del cliente)
         └── PUESTO ──── cobertura que el cliente compró
                         («portería norte, L-D, 24 horas, 1 operario»)
               └── TURNO  = puesto + fecha + bloque horario + persona
                              │
                              ├── vacío  → hueco por cubrir
                              ├── con persona → planeado / confirmado
                              └── con novedad → se cubre con el banco
```

### El puesto es lo que el cliente compró

Un **puesto** es una obligación de cobertura, no una persona: «el hall del
edificio tiene que estar atendido de lunes a domingo de 6 a 22». Vive colgado de
una **sede** y pertenece a un **centro de costo** (porque es el centro de costo
el que paga). Tiene el cargo que exige, cuántas personas simultáneas necesita, y
su ventana de cobertura.

Los puestos se crean una vez y casi no cambian. Para las 86 sedes chicas, un
puesto por sede. Para Transmilenio, decenas de puestos bajo la misma sede.

### El turno es puesto + fecha + bloque + persona

Un turno es **una fila por persona y por día**. No se modela «el horario de
Fulano» sino «el 21 de octubre, en el puesto Portal Norte, de 6:00 a 14:00, va
esta persona». Esto es más filas, pero es la única forma de que el cambio del
martes no reescriba la regla general.

El **bloque horario** sale de un patrón (`8HD`, `8HN`, `6AM_2PM`…) que trae hora
de inicio, hora de fin y si cruza la medianoche. El patrón es un atajo para
digitar; lo que queda guardado en el turno son las horas concretas, porque un
turno puntual puede salirse del patrón.

### Se programa por semana, copiando la anterior

Una **programación** es la semana de un contrato (o de una sede): se crea en
`BORRADOR`, se arma copiando la semana anterior —que es como se trabaja de
verdad: la malla cambia poco—, se corrigen los cambios, y se **publica**.
Publicada, la ven los responsables de sede y los colaboradores, y ya no se edita
sin dejar rastro.

La programación se **cierra** cuando pasó la semana, y ahí queda como el soporte
de lo que realmente ocurrió: quién fue, quién faltó, quién dobló.

---

## 3. Cómo se cubren las ausencias

El flujo arranca con una **novedad**, no con un hueco:

```
Novedad de la persona                     Hueco en el turno
(incapacidad, vacaciones,     ───────►    (el turno queda sin nadie
 permiso, calamidad, renuncia)             y se pinta en rojo)
                                                  │
                                                  ▼
                                      Candidatos para cubrir, en este orden:
                                      1. Banco de disponibles de la ciudad
                                         (vw_personal_disponible: hoy 16)
                                      2. Alguien del mismo contrato que esté
                                         en su día de descanso → DOBLADA
                                         (requiere autorización)
                                      3. Alguien de otro contrato → PRÉSTAMO
                                         (requiere autorización; afecta
                                          la facturación del contrato)
                                      4. No hay → el puesto queda DESCUBIERTO
                                         y eso se reporta, no se esconde
```

**Lo importante del orden**: hoy el banco de disponibles tiene **16 personas, todas
en Bogotá**. Fuera de Bogotá, cubrir una ausencia es *siempre* una doblada, un
préstamo o un hueco. El módulo tiene que decirlo de frente, porque es lo que
justifica una requisición de personal (y el ATS ya tiene `motivo = REEMPLAZO`).

**La ausencia la registra quien la ve.** Los 74 responsables de sede tienen ficha
y cuenta: son ellos los que marcan «hoy no llegó» desde el celular. Gestión
Humana es la que convierte eso en una novedad con soporte (la incapacidad, el
permiso firmado) y la que decide si es justificada.

**Un hueco sin cubrir es un dato, no un error.** El indicador que le interesa al
cliente y a la gerencia es el **porcentaje de cobertura por contrato**, y eso solo
existe si los huecos quedan registrados.

---

## 4. Qué tiene que validar el sistema

Esta es la razón de ser del módulo: hoy nadie valida nada, y los errores los paga
nómina en recargos o el cliente en incumplimientos.

### Duro (la base lo impide, no solo la pantalla)

| Regla | Por qué |
|---|---|
| **Una persona, un turno a la vez** | nadie puede estar en dos puestos en el mismo rango de horas. Es la validación que más se va a disparar al cubrir ausencias a la carrera. Se hace con un rango de tiempo y una restricción de exclusión en la base, **no** con una consulta previa: dos personas cubriendo el mismo hueco a la vez pasarían el chequeo y romperían la malla. |
| **Solo con vinculación activa** | no se programa a un retirado ni a una ficha suelta. `persona_vinculaciones.estado = 'ACTIVA'` ya lo garantiza, y ya existe el índice único de una sola activa por persona. |
| **Un turno no puede cruzar su propia medianoche sin decirlo** | el `8HN` de 22:00 a 6:00 pertenece al día que empieza, pero sus horas caen en dos fechas. Si esto no se resuelve en el modelo, el conteo de horas de la semana queda mal para todos los nocturnos. |

### Blando (advierte, y si se pasa, pide autorización y queda registrado)

| Regla | Valor propuesto | Por qué es parámetro y no constante |
|---|---|---|
| **Descanso mínimo entre turnos** | 12 horas | lo que la operación aguante; no es el mismo en un contrato 24/7 que en uno de oficina |
| **Tope de horas por semana** | la jornada legal vigente | **bajó por etapas con la Ley 2101 de 2021 y seguirá cambiando**: escribirla en el código obliga a una migración cada vez |
| **Día de descanso obligatorio** | 1 en 7, y el domingo cuando se pueda | el domingo en estos contratos se trabaja, con recargo |
| **Dobladas por persona y por semana** | máximo 2 | una doblada es legítima; tres seguidas son un problema de personal disfrazado de flexibilidad |
| **Ventana del recargo nocturno** | parámetro | cambió con la reforma laboral y los valores los confirma nómina |
| **Festivos** | calendario cargado por año | sin el calendario, el costo de la semana sale mal; y en estos contratos los festivos **sí se trabajan** |

### De negocio

* El turno tiene que caer **dentro de la ventana de cobertura del puesto** (no se
  programa a las 3 a.m. un puesto que se compró de 6 a 22).
* El **cargo de la persona** tiene que servir para el puesto, con la salvedad de
  que el 80% es OPERARIO ASEO y el filtro real es otro.
* **Certificaciones**: para un puesto de alturas, solo los 10 OPERARIO ALTURAS o
  quien tenga el curso vigente. El ATS ya guarda
  `requiere_curso_alturas` en la requisición.
* **Préstamo entre contratos**: cruzar a alguien de un centro de costo a otro
  cambia a quién se le factura esa hora. Tiene que ser explícito y autorizado.
* **No se puede publicar una semana con huecos sin que alguien lo acepte.**

---

## 5. La pantalla de la semana

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  Programación · TRANSMILENIO 2026 · Bogotá        ‹ Semana 20–26 oct ›       │
│  Cobertura 94% · 7 huecos · 3 dobladas · 2 novedades      [Copiar anterior]  │
│                                                            [Publicar semana] │
├──────────────┬──────┬──────┬──────┬──────┬──────┬──────┬──────┐  ┌──────────┐│
│ PUESTO       │ Lun  │ Mar  │ Mié  │ Jue  │ Vie  │ Sáb  │ Dom  │  │ BANCO    ││
│              │  20  │  21  │  22  │  23  │  24  │  25  │  26  │  │ 16 libres││
├──────────────┼──────┼──────┼──────┼──────┼──────┼──────┼──────┤  ├──────────┤│
│ ▾ Portal Norte                                                 │  │ Bogotá   ││
│   6–14       │ A-24 │ A-24 │ A-24 │ ░░░░ │ A-24 │ B-11 │ B-11 │  │ ░ ficha  ││
│   14–22      │ C-07 │ C-07 │ C-07 │ C-07 │ C-07 │ ──── │ ──── │  │ ░ ficha  ││
│   22–6  🌙   │ D-33 │ D-33 │ ⚠D-33│ D-33 │ D-33 │ E-02 │ E-02 │  │ ░ ficha  ││
│ ▾ Patio Sur                                                    │  │ …        ││
│   6–14       │ F-18 │ F-18 │ F-18 │ F-18 │ F-18 │ F-18 │ ──── │  │          ││
│   ...        │      │      │      │      │      │      │      │  │ Filtros: ││
└──────────────┴──────┴──────┴──────┴──────┴──────┴──────┴──────┘  └──────────┘│
   ░░░ hueco (rojo)   ──── sin cobertura comprada   ⚠ regla en riesgo           │
└──────────────────────────────────────────────────────────────────────────────┘
```

**Cómo se lee y cómo se usa:**

* **Filas = puestos agrupados por sede**, columnas = los 7 días. Es la vista que
  ya tiene el coordinador en su Excel, y la que reconoce sin que nadie le
  explique.
* **Arriba, el contrato y la semana.** Primero se escoge el contrato (o la sede),
  porque nadie programa 864 personas a la vez: se programa un contrato.
* **La celda** muestra a la persona y su estado por color: planeado, confirmado,
  hueco (rojo), doblada (ámbar), novedad (rayado). Click abre el detalle: horas
  exactas, quién lo asignó, por qué, y el historial del cambio.
* **El banco a la derecha** lista los disponibles de la ciudad para la fecha que
  se esté mirando —no «los 16 de hoy», sino quién está libre *ese día*— y se
  arrastra a la celda. Al soltar, el sistema valida y, si choca, dice contra qué
  regla y ofrece lo que sí se puede.
* **«Copiar semana anterior»** es el botón más usado del módulo.
* **«Publicar»** cierra el borrador: avisa a los responsables de sede y deja la
  semana visible para los colaboradores.
* **Contador de horas por persona** al pie o en el detalle, porque el tope
  semanal no se entiende si no se ve mientras se arma.

**En el celular** (el responsable de sede, los conserjes) no es una malla: es
**«mi día»** y **«mi sede hoy»**, con los botones de «no llegó» y «llegó tarde».
Encaja con el trabajo de offline-first que ya está en `packages/offline`: las
marcaciones se hacen sin señal y se suben después.

**Dos notas de ingeniería que condicionan la pantalla:**

1. La malla **no es una `TablaEstandar`**: es una cuadrícula. Las listas que la
   acompañan —turnos del periodo, novedades, puestos, coberturas— sí son
   `TablaEstandar`, con buscador, Excel y el par Tabla/Tarjetas.
2. **Una semana completa son unas 5.000 filas de turno** (864 personas × ~6
   turnos), y **PostgREST corta en 1.000 sin avisar**. La pantalla carga **un
   contrato a la vez** —el más grande son ~2.100 filas de Transmilenio— y lo
   trae con `traerTodo` (`lib/supabase/paginado.ts`). Programar «todos los
   contratos» en una sola malla no se va a ofrecer.

---

## 6. Modelo de datos propuesto

### Tablas nuevas

| Tabla | Para qué | Campos clave |
|---|---|---|
| `puestos` | la cobertura que el cliente compró | `sede_id`, `centro_costo_id`, `codigo`, `nombre`, `cargo_id`, `personas_simultaneas`, `dias_cobertura[]`, `hora_desde`, `hora_hasta`, `requiere_alturas`, `activo` |
| `turno_patrones` | el bloque horario con horas reales (promueve la lista `TURNO` del ATS a tabla) | `codigo` (`8HD_LV`…), `etiqueta`, `hora_inicio`, `hora_fin`, `cruza_medianoche`, `horas`, `dias[]`, `es_nocturno` |
| `programaciones` | la semana de un contrato | `centro_costo_id`, `sede_id`, `periodo_desde`, `periodo_hasta`, `estado` (`BORRADOR`/`PUBLICADA`/`CERRADA`), `publicada_por`, `publicada_at`, `huecos_aceptados` |
| `turnos` | **una fila por persona y por día** | `programacion_id`, `puesto_id`, `fecha`, `hora_inicio`, `hora_fin`, `rango` (generado, para la exclusión), `patron_id`, `cargo_id`, `persona_id` (nulo = hueco), `estado` (`PLANEADO`/`CONFIRMADO`/`CUMPLIDO`/`AUSENTE`/`DESCUBIERTO`/`ANULADO`), `es_doblada`, `es_prestamo`, `centro_costo_cobro_id`, `origen` (`COPIA`/`MANUAL`/`COBERTURA`), `asignado_por` |
| `novedades_personal` | por qué alguien no puede ir | `persona_id`, `tipo` (`INCAPACIDAD`/`VACACIONES`/`PERMISO`/`LICENCIA`/`CALAMIDAD`/`SUSPENSION`/`AUSENCIA_INJUSTIFICADA`), `desde`, `hasta`, `soporte_path`, `estado` (`REPORTADA`/`APROBADA`/`RECHAZADA`), `reportada_por` |
| `turno_coberturas` | la trazabilidad de cada reemplazo | `turno_id`, `persona_ausente_id`, `persona_cubre_id`, `tipo` (`REEMPLAZO`/`DOBLADA`/`PRESTAMO`/`HORA_EXTRA`), `novedad_id`, `autorizado_por`, `motivo` |
| `turno_marcaciones` | lo que de verdad pasó (fase 5) | `turno_id`, `tipo` (`ENTRADA`/`SALIDA`), `at`, `origen` (`QR`/`APP`/`MANUAL`), `lat`, `lng`, `registrado_por` |
| `programacion_reglas` | los topes, por contrato o globales | `centro_costo_id` (nulo = global), `horas_max_semana`, `descanso_min_horas`, `dobladas_max_semana`, `dias_descanso_min`, `nocturno_desde`, `nocturno_hasta` |
| `calendario_festivos` | festivos de Colombia por año | `fecha` (PK), `nombre`, `anio` |

### Llaves y restricciones que importan

* **`turnos`**: índice de exclusión sobre `(persona_id, rango)` — **esta es la
  pieza que impide físicamente que alguien esté en dos puestos a la vez**, incluso
  con dos usuarios asignando al mismo tiempo. El `rango` se genera desde
  `fecha + hora_inicio` / `hora_fin`, sumando un día cuando el turno cruza la
  medianoche.
* **`turnos`**: índices por `(programacion_id, fecha)`, `(puesto_id, fecha)` y
  `(persona_id, fecha)`. La malla y el conteo de horas pegan por ahí.
* **`turnos.persona_id` nulo es válido** y significa hueco. Nada de personas
  ficticias para rellenar.
* **`puestos`**: único por `(sede_id, codigo)`.
* **`novedades_personal`**: índice por `(persona_id, desde, hasta)` para cruzar
  rápido contra la semana.

### Cambios a lo existente

* **`centros_costo`**: llenar `obra_id`, `cliente_id` y `grupo_id` (hoy vacíos en
  los 624). Sin `grupo_id` no se puede cruzar con las sedes.
* **`sedes`**: + `centro_costo_id`. Es el puente que falta entre los dos mundos.
  La dirección correcta es **N sedes → 1 centro de costo** (el centro
  `UNAD 2026-BOGOTA` cubre varias sedes de la UNAD en Bogotá), no al revés.
  El cruce automático se midió contra los datos reales y da esto:

  | Resultado del cruce (194 sedes activas) | Sedes |
  |---|---|
  | **sugerencia de confianza plena** (todas las palabras del centro aparecen en el nombre de la sede, y la ciudad coincide) | **63** |
  | sugerencia parcial (coincide parte del nombre) | 5 |
  | hay centro con gente en esa ciudad, pero **ningún parecido de nombre** | 101 |
  | no hay ningún centro con gente activa en esa ciudad | 25 |

  Los 101 sin parecido son el caso de las bibliotecas y los colegios: el centro
  que los paga se llama `UT RED CULTURAL Y LA SCRD 567-2026-BOGOTA` y ninguna
  comparación de texto va a adivinarlo. **Un tercio se propone solo; los otros
  dos tercios los tiene que decir alguien de operaciones.**
* **`vac_listas_opciones`** lista `TURNO`: se queda como la lista que usa la
  requisición, y cada valor apunta a un `turno_patrones.codigo`. Mismo vocabulario
  en selección y en programación.
* **`requisiciones`**: cuando un puesto queda descubierto de forma sostenida, el
  botón «Generar requisición» nace del hueco, con `motivo = REEMPLAZO` y los
  `turnos[]` ya llenos.

### Vistas y funciones

| Objeto | Para qué |
|---|---|
| `vw_turnos_semana` | la malla aplanada: turno + puesto + sede + persona + estado |
| `vw_puestos_sin_cubrir` | los huecos, por contrato y por día |
| `vw_horas_persona_periodo` | horas, nocturnas, dominicales, festivas y dobladas por persona y semana — el insumo de nómina y la base del tope |
| `personal_disponible_fecha(fecha, ciudad)` | **la que no existe hoy**: disponibles menos novedades menos quien ya tiene turno ese día. `vw_personal_disponible` responde por hoy; esto responde por el jueves |
| `validar_turno(...)` | corre las reglas blandas y devuelve la lista de advertencias; la usa la pantalla al arrastrar |
| `copiar_programacion(origen, periodo_destino)` | el botón más usado |
| `programacion_resumen(centro_costo, periodo)` | los números de la cabecera en una sola ida a la base |

### Permisos nuevos (grupo **Gestión Humana** en `lib/permisos.ts`)

`/roles` es la única fuente de verdad y la RLS los lee con `auth_permiso()`.

| Permiso | Quién |
|---|---|
| `ver_programacion` | coordinadores, supervisores, gerencia |
| `gestionar_programacion` | quien arma la malla: coordinación operativa |
| `publicar_programacion` | jefatura de operaciones — **publicar no es editar** |
| `ver_mi_turno` | el colaborador, solo lo suyo (como `vinc_propia` en la planta) |
| `reportar_novedad_turno` | **los 74 responsables de sede**: marcan «no llegó» desde el celular, y nada más |
| `gestionar_novedades_personal` | Gestión Humana: aprueba la novedad con soporte |
| `autorizar_dobladas` | jefatura — es plata y es riesgo laboral |
| `parametrizar_programacion` | puestos, patrones, topes y festivos |

El patrón de RLS es el ya probado en la planta: lectura con
`auth_permiso_any([...])`, escritura con `auth_permiso('gestionar_...')`, y una
política extra para que **cada colaborador vea su propio turno y nada más**.

---

## 7. Fases de construcción

1. **Catálogo y puente.** `puestos`, `turno_patrones` (con horas reales),
   `programacion_reglas`, `calendario_festivos`, y `sedes.centro_costo_id` con la
   propuesta automática por nombre + pantalla para confirmarla a mano.
   *Sin esto no hay módulo: es el mapa de la operación.*
   → **Migración escrita y ensayada**: `supabase/migrations/20261018000000_programacion_fase1.sql`.
   Falta aplicarla y construir las dos pantallas (ver §9).
2. **Malla semanal.** `programaciones` + `turnos`, la pantalla de la semana,
   «copiar semana anterior», publicar, y la exclusión de solapes en la base.
   *Con esto ya se reemplaza el Excel.*
3. **Novedades y cobertura.** `novedades_personal`, `turno_coberturas`,
   `personal_disponible_fecha`, el banco arrastrable y la vista móvil del
   responsable de sede.
4. **Reglas y topes.** `validar_turno`, `vw_horas_persona_periodo`, dobladas con
   autorización, préstamos entre contratos, y el aviso al publicar con huecos.
5. **Cumplimiento.** `turno_marcaciones` con QR en sitio y la app offline;
   «planeado vs. cumplido», y la exportación de horas, recargos y dobladas para
   nómina.
6. **Indicadores y enganche.** Cobertura por contrato, ausentismo por sede y por
   persona, costo de dobladas; «Generar requisición» desde el hueco sostenido;
   alertas por los flujos de notificación que ya existen.

---

## 8. ⚠️ Decisiones que hay que tomar para arrancar la fase 1

Las cuatro primeras **bloquean**: sin ellas no se puede escribir la migración.

### 1. ¿El turno cuelga del puesto, o basta con la sede? — ✅ **RESUELTA: se crea `puestos`**

Se mete el nivel `puestos` porque Transmilenio son **302 personas en 2 sedes**:
sin un nivel más fino, la malla de ese contrato es una sola fila con 302 nombres.
La alternativa —turno colgado directo de la sede, y para Transmilenio crear 40
sedes nuevas— ensuciaba `sedes`, que es de inventario y se usa para despachar
insumos.

Queda el trabajo que esto implica: **crear los puestos es manual, contrato por
contrato**. La pantalla de parametrización se construye en la fase 1, pero
llenarla es de la operación.

### 2. ¿Quién amarra las sedes a los centros de costo, y cuándo? — **bloquea**

197 sedes y 92 centros de costo con personal, y **nada** los une hoy
(`obra_id`, `cliente_id` y `grupo_id` vacíos en los 624 centros).
`vw_sede_centro_sugerido` (fase 1) propone el cruce, pero solo resuelve **63 de
194 sedes** con confianza plena: las otras 131 las tiene que decir una persona
(ver la tabla de §6). **¿Lo hacemos en una pantalla de mapeo con la propuesta
precargada, o nos pasan un Excel ya cruzado?**

### 3. ¿Cuáles son los topes? — **bloquea**

Van a `programacion_reglas` como parámetros, pero necesito los valores de
arranque, confirmados por nómina:

* horas máximas por semana (la jornada legal vigente, que cambió por etapas),
* descanso mínimo entre turnos (propongo 12 horas),
* días de descanso mínimos en 7 (propongo 1),
* dobladas máximas por persona y semana (propongo 2),
* la ventana del recargo nocturno (cambió con la reforma laboral).

### 4. ¿Programación por semana de lunes a domingo? — **bloquea**

¿O por quincena, que es como paga la nómina? ¿Y quién publica, con cuánta
anticipación? (Lo usual: el coordinador arma el jueves y jefatura publica el
viernes para la semana siguiente.)

### 5. ¿Se permiten dobladas y préstamos entre contratos?

Fuera de Bogotá **no hay banco de disponibles** (los 16 están todos en Bogotá),
así que una ausencia en Mocoa o en San Andrés solo se cubre doblando a alguien o
dejando el hueco. Si la respuesta es «se dobla», necesito saber quién autoriza y
cuál es el tope duro. Y si se presta gente entre contratos, **¿a qué centro de
costo se le cobra esa hora?**

### 6. ¿Quién reporta la ausencia?

La propuesta es que el **responsable de sede** marque «no llegó» desde el celular
(hay 74, con ficha y cuenta) y que Gestión Humana la convierta en novedad con
soporte. Pero **123 de las 197 sedes no tienen responsable asignado**: en esas,
¿quién reporta?

### 7. ¿El colaborador ve su turno en la app?

Si sí, el turno publicado aparece en `/carnet` y en la app offline, y hay que
decidir si **puede confirmar** («enterado») o solo mirar. Confirmar sirve de
soporte cuando alguien dice que no sabía.

### 8. ¿El módulo le entrega horas a nómina?

Si el objetivo es solo operativo (que no falte nadie), la fase 5 sobra. Si el
objetivo es que de aquí salgan las horas extra, los recargos y las dobladas para
liquidar, entonces `turno_marcaciones` y la exportación son el centro del módulo
y no el final. **Esto cambia el orden de las fases.**

### 9. ¿Cargamos el calendario de festivos?

Son ~18 fechas por año y se pueden cargar de una. Sin eso, el costo de la semana
sale mal. **¿Confirmamos que en estos contratos los festivos se trabajan?**

### 10. Los 16 disponibles, ¿son todo el banco?

`DISPONIBLE-BOGOTA` es el único centro marcado como banco, con 16 personas. Si la
operación mueve gente que figura asignada a un contrato (porque el contrato tiene
holgura), el banco real es más grande y **`vw_personal_disponible` está contando
de menos**.

---

## 9. Estado de la fase 1

### Lo que ya está escrito y ensayado

`supabase/migrations/20261018000000_programacion_fase1.sql` — **ensayada contra
la base real dentro de una transacción que se revirtió**, dos veces seguidas para
comprobar que es idempotente. **No está aplicada todavía.**

| Pieza | Qué quedó |
|---|---|
| `sedes.centro_costo_id` | el puente entre inventario y nómina |
| `vw_sede_centro_sugerido` | la propuesta de cruce, con confianza ALTA / MEDIA / SIN_CANDIDATO |
| `puestos` + `vw_puestos` | el nivel nuevo, con cobertura, cargo, requisitos y `turnos_semana` calculado |
| `turno_patrones` | los 15 patrones del ATS con horas, días y `cruza_medianoche` calculado |
| `programacion_reglas` + `programacion_reglas_vigentes()` | los topes, con la fila global en `confirmado_por_nomina = false` |
| `calendario_festivos` + `festivos_colombia(año)` | 2026 y 2027 sembrados (18 festivos cada año) |
| `vw_programacion_pendientes` | la lista de lo que falta para poder programar |
| RLS + 8 permisos | en `lib/permisos.ts`, grupo Gestión Humana, y prendidos en los roles evidentes |
| `btree_gist` | habilitada; es lo que la fase 2 necesita para impedir el solape |

**Dos decisiones de implementación que vale la pena conocer:**

* **Los festivos se calculan, no se transcriben.** `festivos_colombia(año)` saca
  la Pascua con el algoritmo de Meeus y aplica el traslado al lunes de la Ley
  Emiliani. Sirve para cualquier año, así que nadie tiene que volver cada
  diciembre a teclear 18 fechas. Verificado contra el calendario de 2026.
* **El cruce de sedes se hace por palabras completas, no por parecido de
  texto.** Se probaron las dos alternativas y fallaron: la similitud por
  trigramas daba 0,28 a aciertos buenos de la UNAD y 0,30 a un error, y la
  comparación por subcadena proponía el centro `CAR-BOGOTA` para media Fiscalía
  porque «CAR» aparece dentro de «CARTAGENA» y «CARRERA».

### Lo que la fase 1 tiene pendiente

1. **Aplicar la migración** (`node scripts/apply-migrations.mjs …`).
2. **Pantalla de mapeo sede → centro de costo**, con la sugerencia precargada.
   Son 194 sedes: 63 vienen propuestas, 131 hay que decirlas (decisión 2).
3. **Pantalla de puestos** (CRUD con `TablaEstandar`) y su entrada en el menú de
   Gestión Humana.
4. **Pantalla de parámetros**: topes, patrones y festivos (decisión 3).

### El tamaño real del trabajo manual que queda

`vw_programacion_pendientes`, corrida sobre los datos de hoy:

| Pendiente | Cuántos |
|---|---|
| sedes activas sin centro de costo | **194** (todas) |
| sedes activas sin ningún puesto | **194** (todas) |
| sedes activas sin responsable | 120 |
| contratos con gente activa y sin ninguna sede apuntándoles | 91 |
| la regla global sin confirmar con nómina | 1 |

No es un defecto: es el inventario de lo que la operación tiene que llenar antes
de que se pueda programar la primera semana. Conviene empezar por **un solo
contrato** —Transmilenio o Corferias— y no por los 92.

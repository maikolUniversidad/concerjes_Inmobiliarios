# Complemento 2 — Integración al plan y al modelo de datos

Este documento integra el
[prompt complementario 2](docs/puntos-qr-whatsapp/prompt-complemento-2.md) al
plan de la Fase 0
([00-exploracion-y-plan.md](docs/puntos-qr-whatsapp/00-exploracion-y-plan.md)).
Sigue sin haber código ni migraciones.

El complemento cambia el eje del modelo: **el contrato, no la sede**. Eso obliga
a revisar la decisión 2.8 del documento 00, y a resolver que varios de los
nombres de tabla que propone la §7 **ya están ocupados en el repositorio por
otra cosa**. Las dos cosas se deciden aquí.

Documentos hermanos (de otras sesiones; aquí solo se referencian):
[adr-01-whatsapp.md](docs/puntos-qr-whatsapp/adr-01-whatsapp.md) y
[adr-02-antifraude-ia.md](docs/puntos-qr-whatsapp/adr-02-antifraude-ia.md).
Los cambios que habría que pedirles están en la sección 8.

---

## 1. Decisiones ya aprobadas por el usuario

Quedan cerradas y se reflejan en la Parte 4.2 del documento 00.

### 1.1 ADR-A: **las dos apps**, con el núcleo compartido

La PWA en `apps/inventario` es lo que se construye primero y es el camino
principal; el módulo en `apps/movil` es una fase posterior, para quien ya tenga
el APK instalado. El complemento 2 refuerza la decisión: el **seguimiento
continuo en segundo plano (§3.2) solo lo da la app nativa** (Android con
servicio en primer plano y notificación visible; iOS con permiso "Siempre"), así
que `apps/movil` deja de ser opcional y pasa a tener una función propia que la
PWA no puede cubrir.

Consecuencia que esto obliga a resolver: **la lógica de ejecución de visitas no
puede vivir en la PWA.** `apps/inventario` es React 19 y `apps/movil` es React
18 ([apps/movil/package.json](apps/movil/package.json)), así que cualquier cosa
escrita como componente se duplica. La lógica va a un **paquete nuevo del
workspace, `packages/ronda-core`**, sin dependencia de React:

| Qué va en `packages/ronda-core` | Por qué ahí |
|---|---|
| Contrato de `config` de cada tipo de paso y su validación (mínimos y máximos de foto, motivo obligatorio si "NO", rangos, pasos condicionales) | es la regla que el servidor valida y el cliente anticipa; debe ser la misma en las dos apps |
| Cálculo de geocerca (distancia punto–lectura contra radio) y de `desfase_reloj_seg` | aritmética pura, sin UI |
| Verificación del token del QR y del código manual (alfabeto sin ambigüedades) | se usa al escanear en las dos apps |
| Máquina de estados de la visita y el orden de los intents de la cola | tiene que ser idéntica o la cola se desordena entre apps |
| Armado del payload de cada RPC (`ronda_registrar_visita`, `ronda_responder_paso`, …) | un solo camino de escritura, como ya decide el ADR-E |

Lo que **no** va ahí: nada de React, ni de Next, ni de Capacitor. La cámara, el
mapa y los formularios son de cada app. `packages/offline`
([outbox.ts](packages/offline/src/outbox.ts)) se mantiene como el motor de cola
y gana la cola de medios del ADR-D; `ronda-core` lo usa, no lo reemplaza. Esto
es coherente con `packages/offline`, que ya es framework-agnóstico a propósito
(`Sb` es estructural, ver [types.ts](packages/offline/src/types.ts)).

### 1.2 Identidad: enlace de un uso + PIN

Confirmado como se propuso: para quien no tiene fila en `usuarios`, enlace de un
uso enviado al canal verificado en `persona_canales`, más PIN, que crea una
sesión acotada ligada a `persona_id`.

### 1.3 Retención de evidencia: 12 meses, como parámetro

No como constante en el código. Va en la tabla de reglas del contrato
(`grupo_reglas`, §5.1), con el valor por defecto 12 meses y la posibilidad de
subirlo o bajarlo por contrato — igual que `programacion_reglas` parametriza la
jornada en vez de escribirla en el código
([programacion_fase1.sql](supabase/migrations/20261018000005_programacion_fase1.sql)).
Aplica a `ronda_evidencias`, a `persona_ubicacion_historial` y a los medios
entrantes de WhatsApp.

---

## 2. La decisión central: contrato frente a sede

### 2.1 Qué encontré en el repositorio

Esto cambia la respuesta respecto a la decisión 2.8 del documento 00, porque hay
tres hallazgos que no había visto:

1. **La pantalla `/contratos` del repo ES `grupos_contrato` + `sedes`.** Su
   título literal es "Contratos / Sedes" y su `page.tsx` consulta
   `grupos_contrato` y `sedes`
   ([contratos/page.tsx](apps/inventario/app/(dashboard)/contratos/page.tsx)).
   En el vocabulario que la aplicación ya usa con el usuario, **un contrato es
   una fila de `grupos_contrato`**.
2. **`grupos_contrato.codigo` fue liberado del enum a propósito.** La migración
   [20260806000000_grupos_contrato_codigo_libre.sql](supabase/migrations/20260806000000_grupos_contrato_codigo_libre.sql)
   dice textualmente que el enum de 5 valores "no permitía crear más de 5
   contratos" y lo pasó a `varchar(20)` "para permitir dar de alta cualquier
   contrato desde la aplicación". Es decir: la tabla **ya está preparada para
   ser el registro de contratos de cliente**.
3. **`usuarios.grupo_id → grupos_contrato` ya existe**
   ([init.sql:234](supabase/migrations/20240101000000_init.sql)) y **ya se usa
   como alcance en RLS**
   ([rls_lectura_operacion_interna.sql:400](supabase/migrations/20261018000002_rls_lectura_operacion_interna.sql)).
   Y las claves de permiso **`ver_contratos_conserjeria` y
   `gestionar_contratos_conserjeria` ya están en el catálogo, sin usar**, con un
   comentario que dice que quedan "disponibles para configurar los roles; las
   pantallas se conectan a medida que se construyen (PQRS, No conformes,
   Contratos, Gerencia)"
   ([permisos.ts:162](apps/inventario/lib/permisos.ts)). El complemento 2 es
   justamente esa pantalla.

Y dos cosas que **no** son el contrato del complemento:

- **`contratos`** es el **contrato laboral** del candidato del ATS: `codigo`
  `CONS20260603-001`, `candidato_id`, `salario`, `periodo_prueba_dias`,
  `pdf_path`
  ([registro_vacantes.sql:355](supabase/migrations/20240114000000_registro_vacantes.sql)).
  Nada que ver.
- **`obras`** es el contrato de servicio **a efectos laborales**: `cliente_id`,
  `codigo_contrato_servicio`, y una `descripcion_detallada` con `CHECK` de 200
  caracteres mínimos por exigencia de la Ley 2466 de 2025
  ([registro_vacantes.sql:106](supabase/migrations/20240114000000_registro_vacantes.sql)).
  Existe para poder contratar gente, no para operar puntos; su granularidad es
  cliente + servicio, no la del contrato operativo.

### 2.2 Decisión

**Conviven, con papeles distintos y sin `tenant_id`.**

- **El contrato es el eje de autorización y de reglas.** Se reutiliza
  **`grupos_contrato`**, extendida con lo que pide §1.1 (vigencia, estado,
  servicios, reglas, arte, entregables). **No se crea una tabla `contrato`.**
- **La sede sigue siendo el eje de localización.** `sedes.grupo_id` es `NOT
  NULL`, así que toda sede ya pertenece a exactamente un contrato: el contrato
  es derivable de la sede, pero se **desnormaliza** en cada tabla del módulo
  para que la RLS no tenga que hacer el salto (es el mismo criterio con el que
  `pqrs` guarda `sede_id` **y** `grupo_id`, y con el que `ronda_puntos` guarda
  `sede_id` además de `zona_id`).
- **La columna se llama `grupo_id`**, no `contrato_id`. Es el nombre que el repo
  ya usa en `sedes`, `usuarios` y `pqrs`; introducir `contrato_id` apuntando a
  `grupos_contrato` dejaría dos nombres para la misma cosa y, peor, se leería
  como una referencia a la tabla `contratos` (contrato laboral). En la interfaz
  se sigue diciendo "contrato", como ya se dice hoy.
- **Sigue sin haber `tenant_id`.** El complemento no pide muchos operadores:
  pide muchos clientes de un operador, permisos por contrato y que un contrato
  vencido apague sus QR. Eso es alcance, no aislamiento multiinquilino, y se
  resuelve con `grupo_id` + vigencia. La conclusión de 2.8 se mantiene; lo que
  cambia es que el **eje del alcance pasa de la sede al contrato**, con la sede
  como segundo filtro.

### 2.3 Lo que falta para que el alcance por contrato funcione

1. **Un usuario puede estar en varios contratos** (§1.2), y hoy
   `usuarios.grupo_id` admite uno solo. Tabla puente nueva **`usuario_grupos`**
   (`usuario_id`, `grupo_id`, `papel` — `SUPERVISOR / COORDINADOR / TECNICO /
   CLIENTE / PROVEEDOR` —, `desde`, `hasta`, `activo`), siguiendo el estilo de
   `grupo_etiquetas` y `sede_etiquetas` que ya existen.
   `usuarios.grupo_id` se conserva como "contrato principal" para no romper lo
   que ya lo lee.
2. **Una función de alcance** `auth_grupos()` que devuelva el conjunto de
   contratos del usuario (`usuario_grupos` + `usuarios.grupo_id`, y todos si el
   rol es `ADMIN`/`SUPER_ADMIN`), `STABLE SECURITY DEFINER`, al estilo de
   `auth_permiso()`. Todas las políticas del módulo filtran con ella.
3. **Una persona puede estar en varios contratos.** Hoy
   `persona_vinculaciones` tiene `centro_costo_id`, `obra_id` y `contrato_id`
   (laboral), pero no `grupo_id`. Propuesta: agregar `grupo_id` a
   `persona_vinculaciones`. **Pendiente de aprobación**, porque toca una tabla
   de nómina ya cargada con 6.564 personas y la asignación correcta de cada una
   a su contrato no está resuelta (es el mismo hueco que
   `sedes.centro_costo_id`, hoy sin confirmar). Mientras no esté, el contrato de
   una visita se deriva **del punto**, que sí lo tiene, y eso alcanza para
   operar.

### 2.4 Qué columna lleva cada tabla del módulo

Regla: `grupo_id NOT NULL` en todo lo operativo; `sede_id NOT NULL` en lo que
tiene lugar físico; ambos desnormalizados aunque sean derivables. Los catálogos
generales llevan `grupo_id` **nullable**, donde `NULL` significa "aplica a todos
los contratos" — el mismo patrón de "NULL = aplica a todos" que ya usa
`ronda_instructivos` en el documento 00.

| Tabla | `grupo_id` | `sede_id` | Nota |
|---|---|---|---|
| `ronda_zonas` | NOT NULL | NOT NULL | |
| `ronda_puntos` | NOT NULL | NOT NULL | es la columna por la que filtra la RLS |
| `ronda_qr`, `ronda_qr_lotes` | NOT NULL | NOT NULL (lotes) | el QR hereda el contrato del punto |
| `ronda_tipos_actividad` | **nullable** | — | catálogo general; NULL = todos |
| `ronda_plantillas` | **nullable** | — | catálogo heredable y ajustable por contrato (§1.1) |
| `ronda_plantilla_pasos` | — | — | hereda de la plantilla |
| `ronda_instructivos` | **nullable** | — | ya era así en el doc 00 (`cliente_id`); pasa a `grupo_id` |
| `ronda_asignaciones` | NOT NULL | NOT NULL | |
| `ronda_visitas` | NOT NULL | NOT NULL | |
| `ronda_respuestas`, `ronda_evidencias`, `ronda_firmas`, `ronda_reportes` | — | — | heredan de la visita; se llega por `visita_id` |
| `ronda_novedades` | NOT NULL | NOT NULL | para poder filtrar sin pasar por la visita |
| `ronda_eventos` | nullable | nullable | auditoría: lo que se sepa en el momento |
| `ronda_rutas`, `ronda_ruta_paradas` | NOT NULL | NOT NULL | |
| `activos`, `activo_medidores`, `activo_lecturas` | NOT NULL | NOT NULL | el activo es del cliente, en su sede |
| `mant_planes`, `mant_plan_tareas` | **nullable** | — | plan por tipo de activo = catálogo; por activo = hereda |
| `mantenimiento_tickets` (existente) | **se agrega**, nullable al principio | ya tiene | ver §4.2 |
| `mant_materiales`, `mant_costos` | — | — | heredan del ticket |
| `persona_ubicacion_actual` / `_historial` | NOT NULL | nullable | el contrato del turno |
| `crm_conversaciones`, `crm_casos` | nullable | nullable | una conversación puede empezar sin contrato conocido |
| `crm_envios`, `crm_envio_destinos` | NOT NULL | — | la audiencia siempre es de un contrato |
| `crm_menu_opciones` | **nullable** | — | menú por contrato y rol (§4.2 del complemento) |
| `whatsapp_plantillas` | nullable | — | las plantillas se aprueban por número, no por contrato |
| `pqrs` (existente) | **ya tiene `grupo_id`** | ya tiene `sede_id NOT NULL` | nada que agregar en el eje |
| `grupo_servicios`, `grupo_sla`, `grupo_reglas`, `grupo_entregables` | PK incluye `grupo_id` | — | satélites del contrato |
| `informes_programados` | nullable | — | NULL = informe de empresa (§5.1 nivel Empresa) |

### 2.5 "Contrato vencido apaga sus QR" (§1.2)

No se implementa con un `UPDATE` masivo de estados, porque eso pierde el estado
real de cada QR y no se puede deshacer al renovar. Se implementa como **vigencia
efectiva**: `ronda_qr_vigente(qr_id)` devuelve verdadero solo si el QR está
`ACTIVO` **y** su contrato está vigente, y es esa función la que consultan la
ruta pública `/p/<token>`, la RPC de apertura de visita y el bot. Al renovar, los
QR vuelven a servir sin tocar ninguna fila, que es exactamente lo que pide
§1.2 ("al renovar se conservan histórico, QR y referencias 360°"). La consola
muestra el punto en gris, como dice §3.1.

---

## 3. Choques de nombres de la §7 y cómo se resuelven

La §7 propone nombres genéricos. Varios ya existen en el repositorio con otro
significado. Resolución explícita:

| §7 propone | Qué hay hoy en el repo | Resolución |
|---|---|---|
| `contrato` | **`contratos`** = contrato laboral del ATS; **`grupos_contrato`** = el contrato de cliente que muestra `/contratos` | **Reutilizar `grupos_contrato`.** No se crea `contrato`. Satélites con prefijo **`grupo_`**, siguiendo `grupo_etiquetas` que ya existe |
| `contrato_servicio` | — | **`grupo_servicios`** (aseo, conserjería, mantenimiento, seguridad; activable por separado) |
| `contrato_sla` | `pqrs_plazos` (plazos por tipo, en días hábiles) | **`grupo_sla`** nueva, por servicio y prioridad. Los plazos de PQRS **siguen** en `pqrs_plazos`; `grupo_sla` los puede sobreescribir por contrato |
| `contrato_regla` | `programacion_reglas` (topes de jornada, parametrizados) | **`grupo_reglas`** nueva, con el mismo criterio: valores en tabla, no en código |
| `contrato_entregable` | — | **`grupo_entregables`** |
| `contrato_destinatario` | **`directorio_listas` + `directorio_contactos`** ([20260923000000](supabase/migrations/20260923000000_directorio_correos.sql)) | **Reutilizar el directorio**: una lista por contrato. `grupo_entregables` apunta a la lista, no copia correos |
| `activo` | **`maquinaria`** = equipo propio móvil (aspiradora, brilladora, guadaña) con `valor`, `fecha_adquisicion`, `responsable` | **Crear `activos`** para el activo fijo del cliente. Razonado en §4.2 |
| `tipo_activo` | `maquinaria.tipo` es texto libre | **`activo_tipos`** como catálogo (al estilo de `ronda_tipos_actividad`) |
| `medidor_activo`, `lectura_medidor` | — | **`activo_medidores`**, **`activo_lecturas`** |
| `plan_mantenimiento` | `maquinaria.frecuencia_mant_dias` + `proximo_mant` + **`mant_generar_preventivos(p_dias)`** ([:620](supabase/migrations/20260914000000_mantenimiento_maquinaria.sql)) | **`mant_planes` + `mant_plan_tareas`** nuevas; `mant_generar_preventivos` se **reescribe** para leerlas (hoy solo mira `maquinaria.proximo_mant`) |
| `orden_trabajo` | **`mantenimiento_tickets`**: numero, tipo (`CORRECTIVO/PREVENTIVO/INSPECCION/SOPORTE_REMOTO`), prioridad, estado, `programado_para`, asignado, diagnóstico, solución, **`costo`** | **Extender `mantenimiento_tickets`.** No se crea `orden_trabajo`. La OT del complemento es este ticket con más estados y más campos |
| `ot_evento` | `mantenimiento_mensajes` (chat, con autor puesto por trigger) + `maquinaria_eventos` (bitácora, con `ticket_id`) | **Reutilizar las dos.** Los cambios de estado ya quedan como mensaje `SISTEMA` vía `mant_sistema()`. No hace falta `ot_evento` |
| `ot_material` | `productos` + `stock` + **`movimientos`** (`tipo_movimiento` ya incluye `SALIDA`) | **`mant_materiales`** nueva, que **registra un `movimientos` de salida** en la misma RPC. No se duplica el inventario |
| `ot_costo` | `mantenimiento_tickets.costo` (un solo número) | **Extender** el ticket con `costo_mano_obra` y `costo_materiales`; `costo` queda como total calculado |
| `proveedor` | **`proveedores`** (nombre, nit, contacto, logo) | **Reutilizar.** Se agrega `proveedor_id` al ticket y un acceso limitado a esa OT (§9 del complemento) |
| `ubicacion_persona` | **`conductor_ubicacion_actual` / `_historial`**, pero cuelgan de `conductores` (que es `usuario_id UNIQUE`), no de `personas` | **Crear `persona_ubicacion_actual` / `persona_ubicacion_historial`**, copiando la forma (`lat`, `lng`, `precision_metros`, realtime en la tabla "actual"). No se pueden colgar de `conductores` |
| `ruta_turno` | **`rutas_entrega` / `ruta_paradas`**, atadas a `ordenes_insumo` y a un conductor | **Crear `ronda_rutas` / `ronda_ruta_paradas`.** El patrón se copia; las tablas no se pueden reutilizar |
| `envio_masivo`, `envio_destinatario` | **`correo_saliente`** ([20240113000000](supabase/migrations/20240113000000_correo_alertas.sql)) procesada por `/api/cron/correo` | **`crm_envios` + `crm_envio_destinos`**, con la misma forma de buzón de salida y un cron propio |
| `plantilla_whatsapp` | `plantillas_correo` | **`whatsapp_plantillas`** nueva: lleva estado de aprobación en Meta, categoría e idioma, que una plantilla de correo no tiene |
| `menu_bot` | — | **`crm_menu_opciones`** |
| `pqrs` | **`pqrs` ya existe y está construido**, con `pqrs_bitacora`, `pqrs_plazos`, `pqrs_dias_no_habiles`, `pqrs_sumar_habiles()`, RPC `pqrs_radicar` / `pqrs_cambiar_estado`, bucket y eventos. Su `canal` **ya admite `WHATSAPP` y `PORTAL`**, y ya tiene `anonima` | **Extender `pqrs`.** Crear otra tabla sería el peor resultado posible del complemento |
| `pqrs_mensaje` | **`pqrs_bitacora`** (inmutable, con adjuntos y realtime) | **Reutilizar**, agregándole `canal` y `direccion` |
| `informe_programado` | `flujos_notificacion` + `flujo_pasos` + `flujo_ejecuciones` (disparo **por evento**) | **`informes_programados`** nueva: esto es disparo **por calendario**, que el motor de flujos no cubre |

---

## 4. Sección por sección: qué se reutiliza y qué se crea

### 4.1 El contrato como eje (§1)

**Se extiende `grupos_contrato`**, no se crea nada central. Columnas nuevas:
`cliente_id → empresas_usuarias`, `numero` (el número del contrato del cliente,
distinto de `codigo`), `vigencia_desde`, `vigencia_hasta`, `estado`
(`BORRADOR / VIGENTE / SUSPENDIDO / VENCIDO / TERMINADO`), `arte_logo_path`,
`arte_color`, `idioma_reportes`.

Satélites nuevos: `grupo_servicios` (qué servicios contratados están activos),
`grupo_sla` (por servicio y prioridad: frecuencia mínima, tiempo de respuesta,
tiempo de solución, % exigido, penalidad), `grupo_reglas` (una fila por
contrato con: nivel de rigor antifraude — **hueco C1§3.3** —, permite WhatsApp,
PQRS público activo, comparte seguimiento en vivo, ventana de mensajería,
retención de evidencia en meses, geocerca por defecto), `grupo_entregables`
(qué informe, cada cuánto, a qué `directorio_listas`).

Las prórrogas y el versionado de condiciones al renovar (§1.2) se resuelven con
`grupo_vigencias` (una fila por periodo: desde, hasta, motivo, condiciones
`JSONB`), de modo que renovar agregue una fila y no pise el histórico.

Pantalla: se conecta a las claves **ya existentes y hoy sin usar**
`ver_contratos_conserjeria` y `gestionar_contratos_conserjeria`
([permisos.ts:162](apps/inventario/lib/permisos.ts)). No hay que inventar
permisos para esto.

Riesgo a nombrar: la pantalla `/contratos` actual es de inventario (clasifica
sedes y etiquetas) y la usan `/movimientos` y `/ordenes-insumo` vía
[lib/clasificacion-server.ts](apps/inventario/lib/clasificacion-server.ts).
Agregar columnas es inocuo; **cambiar su interfaz no**. La pantalla nueva de
contratos de conserjería va aparte, en `/rondas/contratos`.

### 4.2 Mantenimiento (§2)

**Activos: se crea `activos`.** Razonado, porque es la decisión menos obvia del
complemento:

- `maquinaria` es el registro de **equipo propio móvil de la empresa**: su
  semántica es patrimonial (`valor`, `fecha_adquisicion`, `responsable`,
  `ubicacion_sede_id` como "dónde está hoy"), y su estado es un enum
  `estado_maquinaria` con `BAJA`.
- Los activos de §2.1 (extintor, ascensor, bomba, luminaria, grifería, puerta
  automática) son **instalaciones del cliente**, fijas en una zona de su sede,
  que no se dan de baja ni se valoran: se mantienen mientras dure el contrato,
  tienen activo padre/hijo, garantía, criticidad y medidores.
- El motivo decisivo es de seguridad: **`mant_puede_participar()` no tiene
  ningún alcance por sede ni por contrato** — es solo
  `auth_permiso_any('{ver_mantenimiento,…}')`
  ([:233](supabase/migrations/20260914000000_mantenimiento_maquinaria.sql)) —, y
  las políticas de lectura de tickets y actividades cuelgan de ella. Meter
  activos de clientes en `maquinaria` haría que cualquiera con
  `ver_mantenimiento` leyera los activos de todos los clientes. Separar la tabla
  permite darle a `activos` el alcance por `grupo_id` desde el primer día sin
  tener que reabrir la RLS del módulo existente.

`activos`: `id`, `grupo_id NOT NULL`, `sede_id NOT NULL`, `zona_id`, `punto_id`,
`activo_tipo_id`, `codigo` (único por contrato), `nombre`, `marca`, `modelo`,
`serial`, `fecha_instalacion`, `garantia_hasta`, `proveedor_id → proveedores`,
`criticidad` (`BAJA/MEDIA/ALTA/CRITICA`), `estado`
(`OPERATIVO/DEGRADADO/FUERA_SERVICIO/RETIRADO`), `padre_id → activos`,
`fotos TEXT[]`, `activo BOOLEAN`. Más `activo_documentos` (manuales y fichas
técnicas: se reutiliza el patrón de `documentos_persona`, archivo en bucket
privado), `activo_medidores` (`tipo`: `HORAS/CICLOS/LECTURA`, `unidad`,
`valor_actual`) y `activo_lecturas` (append: `valor`, `leido_at`, `visita_id`,
`persona_id`).

**QR del activo: se reutiliza el motor tal cual.** `ronda_qr` gana
`tipo_objeto` (`PUNTO / ACTIVO`) y `activo_id`, con un `CHECK` de que haya
exactamente uno de `punto_id` / `activo_id`. Así un punto puede tener su QR y
varios activos los suyos, y se puede asociar un activo a un QR de punto
existente (§2.1) sin tocar nada más. La ruta `/p/<token>` resuelve los dos
casos.

**Planes preventivos: se crean `mant_planes` y `mant_plan_tareas`**, y se
**reescribe `mant_generar_preventivos`**. Hoy esa función solo mira
`maquinaria.proximo_mant` y crea un ticket con un título fijo; el plan de §2.2
necesita frecuencia por calendario **o por medidor**, tolerancia, técnico o rol,
duración y materiales esperados, y tareas que son plantillas del mismo motor
(`ronda_plantillas`). `mant_planes` lleva `activo_tipo_id` **o** `activo_id`
(plan por tipo o por activo), `frecuencia_tipo` (`DIAS/SEMANAS/MESES/MEDIDOR`),
`frecuencia_valor`, `medidor_id`, `anticipacion_dias`, `obligatorio_normativo`
BOOLEAN (la recarga anual de extintores de §2.2) y `vence_alerta_dias`.

**Órdenes de trabajo: se extiende `mantenimiento_tickets`.** Columnas nuevas:
`grupo_id`, `activo_id`, `plan_id`, `origen` (`PLAN/VISITA/TICKET/PQRS/CLIENTE/
BOT/IOT`), `visita_id`, `pqrs_id`, `proveedor_id`, `sla_respuesta_vence_at`,
`sla_solucion_vence_at`, `aprobado_cliente_at`, `aprobado_cliente_nombre`,
`firma_tecnico_id`, `firma_cliente_id` (→ `ronda_firmas`), `costo_mano_obra`,
`costo_materiales`. `maquinaria_id` pasa de `NOT NULL` a nullable con un
`CHECK` de que esté `maquinaria_id` **o** `activo_id`.

Los estados de §2.3 (`creada → asignada → aceptada → en camino → en sitio → en
ejecución → pausada → terminada → aprobada por el cliente → cerrada`) no caben
en el enum actual (`ABIERTO, RECIBIDO, EN_PROCESO, EN_ESPERA, RESUELTO, CERRADO,
CANCELADO`). **Se agregan valores al enum `estado_ticket_mant`**
(`ACEPTADO`, `EN_CAMINO`, `EN_SITIO`, `APROBADO_CLIENTE`); `ALTER TYPE … ADD
VALUE` es aditivo y no rompe lo existente, y el mapeo es: `creada`=`ABIERTO`,
`asignada`=`RECIBIDO`, `en ejecución`=`EN_PROCESO`, `pausada`=`EN_ESPERA`,
`terminada`=`RESUELTO`. **Esto modifica un módulo ya en producción**: el tablero
de `/mantenimiento` tiene que aprender los estados nuevos, y eso hay que
aprobarlo antes (pendiente §9.2).

La ejecución en campo de la OT **reutiliza el motor de visitas completo**:
escanear QR, validar ubicación, pasos de plantilla, foto antes y después,
firma. No se construye un segundo flujo de ejecución: la OT es una visita cuya
asignación viene de un plan o de un ticket, y `ronda_visitas` gana `ticket_id`.

**Materiales:** `mant_materiales` (`ticket_id`, `producto_id`, `cantidad`,
`costo_unitario`, `movimiento_id`) y la RPC que la escribe **inserta también el
`movimientos` de salida**, para que el consumo descuente inventario de verdad.
Ojo con las reservas: el repo ya separa `stock.cantidad_real` de
`cantidad_disp` por triggers de reserva, así que el consumo de una OT tiene que
ir por el mismo camino que el resto de las salidas y no escribir `stock`
directamente.

**Indicadores (§2.4):** MTTR, MTBF, % preventivo, cumplimiento del plan,
backlog, SLA, reaperturas y costos **se calculan**, no se almacenan: vistas
`vw_mant_mttr`, `vw_mant_backlog`, etc. sobre las marcas de tiempo que el ticket
ya guarda (`created_at`, `recibido_at`, `iniciado_at`, `resuelto_at`,
`cerrado_at`). Reaperturas necesita una columna nueva: `reabierto_de →
mantenimiento_tickets`.

### 4.3 Mapa operativo (§3)

**Se reutiliza [MapaLeaflet.tsx](apps/inventario/components/logistica/MapaLeaflet.tsx)**,
que ya está hecho sobre OpenStreetMap sin capas de pago, ya dibuja marcadores
con estado y ya une paradas en orden, y ya documenta la trampa de cargarlo con
`next/dynamic` y `{ ssr: false }` porque Leaflet toca `window` al importarse.
Hay que **extenderlo**: más tipos de punto (hoy son `conductor | sede |
novedad`), capas que se prenden y apagan, polígonos de sede, planos por piso y
reproductor de línea de tiempo. Y `sedes` ya tiene `direccion`, `lat` y `lng`
([logistica_conexion.sql:12](supabase/migrations/20260729000000_logistica_conexion.sql)),
así que el mapa arranca con datos.

**Ubicación de personas: tablas nuevas**, calcadas de las del conductor:
`persona_ubicacion_actual` (una fila por persona, con realtime, para el "en
vivo") y `persona_ubicacion_historial` (append, para el recorrido del día). Las
dos con `lat`, `lng`, `precision_metros`, y además `fuente`
(`APP_VIVO / APP_NATIVA / WHATSAPP / ESCANEO / EVENTO`), `turno_id`,
`grupo_id` y `capturado_at`.

Los polígonos de sede y los planos por piso dependen del **levantamiento 2D/3D**
que §3.1 da por existente. **No existe en el repositorio**: no hay ninguna tabla
de planos ni de polígonos. Queda como pendiente (§9.1): o se carga el
levantamiento, o el mapa muestra la sede como un punto con radio, que es lo que
los datos actuales permiten.

#### Dos requisitos no negociables de §3.2

**R1 — Fuera del turno no se registra ni se muestra la ubicación de nadie.**
No es una regla de interfaz: se cumple en la base de datos.

- La RPC `ronda_registrar_ubicacion` **rechaza** la escritura si la persona no
  tiene turno abierto en ese momento (contra la programación y el turno del
  contrato), y no deja rastro parcial: no inserta nada.
- La función de lectura del mapa filtra por turno abierto; una posición cuyo
  turno ya cerró no se devuelve como posición de persona (sigue existiendo en el
  historial del turno, para el recorrido de ese día).
- `grupo_reglas` tiene que permitir el seguimiento en vivo para que la RPC
  acepte; si el contrato no lo permite, tampoco se registra.
- La retención de 12 meses (§1.3) se aplica también aquí, y la purga es un
  trabajo del cron, no una tarea manual.
- **Criterio de aceptación:** con el turno cerrado, un `POST` de ubicación es
  rechazado y el mapa no muestra a esa persona; con el turno abierto y el
  contrato sin seguimiento en vivo, también es rechazado.

**R2 — El mapa nunca muestra una posición vieja como si fuera actual.**

- Toda posición viaja con `capturado_at` y `fuente`, y la capa de datos devuelve
  además `antiguedad_seg` **calculada en el servidor** (el reloj del navegador
  no se usa para esto).
- La interfaz **siempre** rotula la antigüedad y la fuente junto al marcador,
  con el formato que pide §3.1: "hace 12 min · WhatsApp".
- Pasado un umbral (parámetro del contrato, propuesto 5 minutos), el marcador se
  dibuja en estilo "último registro" — distinto del de posición viva— y nunca
  con el estilo de en vivo. Sin ninguna posición del turno, la persona aparece
  en la lista como "sin ubicación", no en el mapa.
- **Criterio de aceptación:** una posición de 40 minutos se dibuja en estilo
  "último registro" con el texto "hace 40 min · WhatsApp"; no existe ningún
  estado de la interfaz en el que una posición sin antigüedad visible se
  presente como actual.

**Vista del conserje (§3.3):** se reutiliza la misma PWA y el mismo mapa, con
sus puntos del turno en orden de ruta (`ronda_rutas`).

### 4.4 WhatsApp: masivo individual, menú y próxima ubicación (§4)

**Lo que se reutiliza:** el patrón de buzón de salida + cron. `correo_saliente`
se procesa cada 5 minutos por `/api/cron/correo`, que exige
`Authorization: Bearer CRON_SECRET`
([cron/correo/route.ts](apps/inventario/app/api/cron/correo/route.ts)). El envío
masivo es el mismo patrón con otra tabla y otro cron. Y el motor de flujos puede
disparar WhatsApp agregando un valor al `tipo` de `flujo_pasos`, que hoy es
`EMAIL | APP | ESPERA | WEBHOOK`
([:176](supabase/migrations/20260829000000_notificaciones_workflow.sql)) — el
worker ([lib/notificaciones/worker.ts](apps/inventario/lib/notificaciones/worker.ts))
gana un caso más.

**Lo que se crea:** `crm_envios` (audiencia — contrato, sede, turno, rol, lista
o personas sueltas —, tipo, plantilla, programación, costo estimado, estado,
`es_emergencia`) y `crm_envio_destinos` (una fila **por persona**, con
`persona_id`, `canal_valor`, `estado`: `ENCOLADO/ENVIADO/ENTREGADO/LEIDO/
RESPONDIDO/FALLIDO`, `externo_id`, `costo`, `error`). Nunca un grupo: el
complemento lo exige y el modelo lo fuerza, porque el destinatario es una fila
por persona.
`whatsapp_plantillas` (nombre, categoría `UTILITY/AUTHENTICATION`, idioma,
estado de aprobación en Meta, variables) y `crm_menu_opciones` (contrato, rol,
orden, etiqueta, acción; máximo 10 por §4.2).

**Lo que NO se diseña aquí:** la ventana de 24 horas, los límites de envío y el
escalonado a ~20 mensajes por segundo, el formato de las plantillas y la
validación de la firma del webhook son del
[ADR-01](docs/puntos-qr-whatsapp/adr-01-whatsapp.md). Lo que este documento fija
es dónde viven los datos y que **el escalonado es obligatorio**: el cron de 5
minutos no puede mandar 50 mensajes de golpe, así que `crm_envio_destinos` lleva
`programado_para` y el cron toma un lote.

**Jornada:** el bloqueo fuera de la jornada (Ley 2191 de 2022, ya documentado en
el 00) se aplica **al encolar y al enviar**, no solo al encolar, porque un envío
programado puede caer fuera de jornada; salvo `es_emergencia = true`, que queda
registrado en la auditoría con quién lo marcó así.

**Opt-in:** es `persona_consentimientos` con tipo `WHATSAPP`, que ya estaba en
el documento 00. Sin esa fila, la persona no entra en ninguna audiencia.

**Próxima ubicación (§4.3):** necesita la foto de instalación del punto, que es
**C1§1 paso 3** — hueco (§7). Entre tanto, el bot usa `ronda_puntos.descripcion`
y `fotos_referencia`, y la consola marca el punto como incompleto, que es lo que
§4.3 ya prevé ("si falta la foto o la referencia, el bot usa lo que haya"). El
enlace a "Ver mi mapa" usa el mismo mecanismo de enlace firmado de corta
duración del ADR-A.

### 4.5 Informes de eficiencia (§5)

**Se reutiliza:** la infraestructura de `/reportes`
([reportes/page.tsx](apps/inventario/app/(dashboard)/reportes/page.tsx)),
`recharts` para los tableros, `exceljs` para los Excel (con el orden que exige
el repo: por ítem y luego alfabético), `pdf-lib` / `@react-pdf/renderer` para
los PDF con el arte del contrato, el directorio de correos para los
destinatarios, y `/api/ia/chat` para la narrativa.

**Se crea:** `informes_programados` (tipo, nivel — `INDIVIDUAL/EQUIPO/SEDE/
CONTRATO/CLIENTE/EMPRESA` —, filtros `JSONB`, periodicidad, `directorio_lista_id`,
formatos, próxima ejecución) y `informe_ejecuciones` para la trazabilidad, más
un cron `/api/cron/informes`. Los seis niveles de §5.1 son **agrupaciones de las
mismas vistas**, no seis informes distintos: una vista base de cumplimiento por
visita, agrupada por persona, turno, sede, contrato, cliente o empresa. Eso es
lo que hace que "los informes coincidan entre sí al sumar", que es el criterio
de aceptación de §10.

**Uso responsable (§5.4):** el acceso a informes individuales se restringe por
permiso (clave nueva `ver_informes_individuales`), y la vista individual
**siempre** devuelve el contexto (puntos asignados, novedades, permisos,
incapacidades) junto con el indicador, para que la interfaz no pueda mostrar el
número solo. Es la misma decisión que ya se tomó en
[planta_personal_privacidad](supabase/migrations/20260910000001_planta_personal_privacidad.sql).

**Narrativa por IA:** se marca como generada por IA y pasa por revisión antes de
salir al cliente, igual que la respuesta sugerida del CRM: nunca se envía sola.

### 4.6 PQRS por el mismo QR (§6)

**Se extiende `pqrs`. Esta es la reutilización más importante del complemento.**
El módulo ya está construido y resuelve lo difícil: estados
(`RADICADA → EN_TRAMITE ⇄ EN_ESPERA → RESPONDIDA → CERRADA / ANULADA`), plazos
en **días hábiles** con `pqrs_sumar_habiles()` y `pqrs_dias_no_habiles`,
bitácora inmutable con adjuntos y realtime, bucket privado, alcance por rol,
escrituras por RPC, eventos de notificación, y **`canal` que ya admite
`WHATSAPP` y `PORTAL`** y `anonima BOOLEAN` que ya existe
([20261018000004_pqrs.sql](supabase/migrations/20261018000004_pqrs.sql)). Los
estados que pide §6.3 (`radicada → en revisión → en atención → respondida →
cerrada`) mapean sobre los que ya hay sin agregar ninguno.

Lo que se le agrega: `punto_id`, `zona_id`, `qr_id`, `categoria_id`,
`ip_hash`, `satisfaccion` SMALLINT + `satisfaccion_at`, y `canal` gana el valor
`QR`. Tabla nueva `pqrs_categorias` (limpieza, insumos faltantes, malos olores,
basuras, daño, otro), parametrizable **por contrato** (`grupo_id` nullable =
aplica a todos). `pqrs_bitacora` gana `canal` (`PLATAFORMA/CORREO/WHATSAPP`) y
`direccion` (`ENTRADA/SALIDA`) para que el hilo por correo entre al mismo caso.

**La ruta pública:** `/p/<token>` ya es pública por el ADR-B. Decide qué mostrar
según la sesión, como pide §6.1: con sesión y permiso de ejecución, el flujo de
tareas; sin sesión y con PQRS activo en `grupo_reglas`, la página del punto con
el botón de reportar. **Hay precedente de acceso anónimo en el repo**: las
políticas `TO anon` de registro de vacantes
([registro_vacantes.sql:475](supabase/migrations/20240114000000_registro_vacantes.sql)).

**Antispam:** se reutiliza el mecanismo que el repo ya usó para el formulario
público de cotizaciones:
[20260906000000_empresas_cotizacion_rate_limit.sql](supabase/migrations/20260906000000_empresas_cotizacion_rate_limit.sql)
guarda un **`ip_hash`** (SHA-256 con sal, nunca la IP en claro, porque es dato
personal bajo la Ley 1581) con un índice `(ip_hash, created_at DESC)` para
contar envíos por hora. Mismo criterio, más límite por punto. El desafío tipo
captcha de §6.2 queda pendiente de decidir cuál (ninguno hay hoy en el repo).

**La escritura pública va por RPC, no por `INSERT` con política `anon`.** La RPC
`pqrs_radicar_publica` valida el token del QR, que el contrato tenga PQRS
activo, el límite por `ip_hash` y la categoría, y solo entonces llama a la
lógica existente. Una política `anon` de inserción directa no podría validar el
token.

**Conversión a tarea o a OT (§6.3):** se reutiliza `ronda_novedades` en sentido
inverso — la PQRS crea una asignación urgente o una OT, y el enlace queda en las
dos direcciones (`pqrs.ticket_id` ya no haría falta: lo lleva
`mantenimiento_tickets.pqrs_id`).

### 4.7 Integraciones (§8) y permisos (§9)

**Correo:** ya está entero (`nodemailer` + `imapflow`, plantillas, flujos,
`correo_saliente`, directorio). Lo único que falta es **conectar la cuenta**, que
es un pendiente ya conocido: sin ella los pasos de los flujos quedan omitidos.
La recepción de correo entrante para el hilo de PQRS por radicado necesita
`imapflow` apuntando a un buzón dedicado — hay que decidir cuál.

**Mapas:** OpenStreetMap vía Leaflet, ya en uso. No hace falta proveedor de pago.

**Inventario:** `productos` + `stock` + `movimientos`, como se dijo en §4.2.

**IoT, video analítica, matriz de riesgo y workflows por contrato (§8):** no
existen en el repositorio. `origen` de la OT ya deja el valor `IOT` previsto,
pero no hay nada que lo alimente. Queda fuera de alcance y anotado.

**Permisos (§9):** la tabla de roles del complemento se traduce a claves nuevas
en el grupo *Operación Conserjería* de
[lib/permisos.ts](apps/inventario/lib/permisos.ts), reutilizando
`ver_contratos_conserjeria` / `gestionar_contratos_conserjeria` y las de PQRS que
ya existen. Los dos papeles que el repo no modela hoy y hay que resolver:

- **Cliente**: ve solo su contrato. Hay precedente (portal de clientes), pero el
  acceso del cliente a este módulo exige `usuario_grupos` con papel `CLIENTE` y
  una política que además **oculte la ubicación de personas** salvo que
  `grupo_reglas` lo permita.
- **Proveedor externo**: ve solo las OT que se le asignan. Necesita papel
  `PROVEEDOR` en `usuario_grupos` y una política de `mantenimiento_tickets` por
  `proveedor_id` — que hoy no se puede escribir, porque la lectura de tickets no
  tiene ningún alcance (`mant_puede_participar()`, §4.2).

---

## 5. Resumen del modelo de datos añadido

Para no repetir: lo que ya estaba en el documento 00 sigue igual salvo lo que
aquí se corrige (§9). Lo que el complemento agrega:

**Contrato (satélites de `grupos_contrato`)**
`grupo_servicios` · `grupo_sla` · `grupo_reglas` · `grupo_entregables` ·
`grupo_vigencias` · `usuario_grupos` · función `auth_grupos()`

**Activos y mantenimiento**
`activo_tipos` · `activos` · `activo_documentos` · `activo_medidores` ·
`activo_lecturas` · `mant_planes` · `mant_plan_tareas` · `mant_materiales` ·
columnas nuevas en `mantenimiento_tickets` y valores nuevos en
`estado_ticket_mant` · `ronda_qr.tipo_objeto` + `activo_id` ·
`ronda_visitas.ticket_id`

**Ubicación y rutas**
`persona_ubicacion_actual` · `persona_ubicacion_historial` · `ronda_rutas` ·
`ronda_ruta_paradas`

**WhatsApp y CRM**
`crm_envios` · `crm_envio_destinos` · `whatsapp_plantillas` ·
`crm_menu_opciones` · valor `WHATSAPP` en `flujo_pasos.tipo`

**PQRS**
`pqrs_categorias` · columnas nuevas en `pqrs` y en `pqrs_bitacora`

**Informes**
`informes_programados` · `informe_ejecuciones` · vistas de indicadores

---

## 6. Corte de fases nuevo

Las cinco fases del documento 00 ya no alcanzan. El corte es por **lo que una
sesión de trabajo puede terminar y verificar**, con la dependencia de esquema
explícita. "Paralelo" significa que no comparten tablas y pueden ir en sesiones
distintas al mismo tiempo.

| # | Fase | Depende de | Paralelo con |
|---|---|---|---|
| **F1** | **Contrato**: extender `grupos_contrato`, satélites, `usuario_grupos`, `auth_grupos()`, vigencia efectiva | — | — |
| **F2** | **Estructura y QR**: `ronda_zonas`, `ronda_puntos`, `ronda_qr` (con `tipo_objeto`), lotes, arte, PDF, ruta `/p/<token>` que resuelve y verifica | F1 | F3 |
| **F3** | **Catálogo y asignaciones**: tipos, plantillas versionadas, pasos, instructivos, `ronda_asignaciones` | F1 | F2 |
| **F4** | **Ejecución**: `packages/ronda-core`, PWA, visitas, respuestas, evidencia, firma, reporte PDF, novedad → ticket, cola de medios en `packages/offline` | F2, F3 | F5 |
| **F5** | **PQRS por QR**: extender `pqrs`, `pqrs_categorias`, página pública del punto, `pqrs_radicar_publica`, `ip_hash` | F2 | F4 |
| **F6** | **Activos**: `activos`, tipos, documentos, medidores, lecturas, QR de activo | F1, F2 | F4, F5 |
| **F7** | **Planes preventivos y OT**: `mant_planes`, reescribir `mant_generar_preventivos`, extender `mantenimiento_tickets`, estados nuevos, SLA, materiales con movimiento de inventario, firma del cliente, proveedor externo | F4, F6 | F8 |
| **F8** | **Ubicación y mapa operativo**: `persona_ubicacion_*`, `ronda_rutas`, extender `MapaLeaflet`, capas, replay, R1 y R2 | F4 | F7 |
| **F9** | **Bot de WhatsApp** → [ADR-01](docs/puntos-qr-whatsapp/adr-01-whatsapp.md) | F1, F4 | F7, F8 |
| **F10** | **Mensajería masiva individual, menú y próxima ubicación** | F9, F8 | F11 |
| **F11** | **CRM con IA**: casos, etiquetas, asignación, SLA, bandeja | F9 | F10 |
| **F12** | **Informes de eficiencia** en seis niveles, programados, narrativa IA | F4, F5, F7, F8 | — |
| **F13** | **Endurecimiento** → [ADR-02](docs/puntos-qr-whatsapp/adr-02-antifraude-ia.md): facial con prueba de vida, recaptura, retos (C1§3), carga, documentación | F4, F12 | — |

**La Fase 1 mínima para arrancar es F1 + F2 + F3 + F4.** Con eso el módulo
existe de punta a punta: hay contratos con reglas, puntos con QR firmado,
catálogo de tareas y una PWA que ejecuta una visita con evidencia y deja un
reporte firmado. Todo lo demás se cuelga de ahí.

Notas de dependencia que conviene no perder:

- **F1 va primero y sola.** Cada tabla del módulo lleva `grupo_id`; si F1 no
  está, todas nacen sin eje y hay que migrarlas.
- **F5 depende solo de F2**, no de F4: la PQRS pública necesita el punto y la
  ruta pública, no el motor de ejecución. Es la pieza que se puede entregar
  antes para que el cliente vea algo funcionando.
- **F7 toca un módulo en producción** (`/mantenimiento`): su primer entregable
  es el acuerdo sobre los estados nuevos, no el SQL.
- **F12 va al final a propósito**: un informe que suma mal es peor que no
  tenerlo, y solo puede cuadrar cuando las fuentes ya están quietas.

---

## 7. Huecos del complemento 1

El complemento 1 ("Instalación del QR con referencia 360°") **no ha llegado**.
El complemento 2 se apoya en él en tres puntos y aquí **no se inventa** qué
dicen. Lo que haría falta saber:

**C1§1 paso 3 — foto de instalación del punto.** El bot la usa para "próxima
ubicación" (§4.3) y el mapa para la ficha del marcador (§3.1). Preguntas
abiertas: ¿es una sola foto o un conjunto 360°? ¿Qué se guarda — imagen plana,
panorámica equirectangular, varias tomas con rumbo? ¿Cuál es la referencia
escrita y quién la redacta? ¿Se versiona cuando el lugar cambia?
En el modelo, el espacio está reservado y **sin rellenar**:
`ronda_qr.foto_instalacion` (una ruta, ya en el documento 00) y
`ronda_puntos.fotos_referencia TEXT[]`. Si C1 define anclas 360° con rumbo y
"salud", eso es una tabla propia (`ronda_anclas`) que **no se diseña todavía**.

**C1§3 — reto aleatorio durante la ejecución.** §5.2 pide "resultado de retos
aleatorios" como indicador, así que el informe depende de un dato que no está
definido. Preguntas: ¿qué es un reto (foto de un detalle pedido al azar, lectura
de un código, pregunta sobre el lugar)? ¿Con qué probabilidad se dispara y quién
la fija? ¿Qué pasa si se falla — bloquea el cierre, baja el puntaje, abre
revisión? En el modelo queda el espacio: `ronda_visitas` tendrá un enlace a los
retos de la visita, y el campo de resultado **no se nombra todavía** para no
fijar un formato que C1 contradiga.

**C1§3.3 — niveles de rigor antifraude por contrato.** §1.1 lo lista como regla
del contrato, así que `grupo_reglas` necesita una columna para ese nivel. Lo que
falta saber: cuántos niveles hay, cómo se llaman y qué cambia cada uno (¿exige
geocerca? ¿sube el mínimo de fotos? ¿obliga facial? ¿cambia el umbral del
puntaje?). La columna queda prevista como `nivel_antifraude` **sin dominio
definido**; el `CHECK` se escribe cuando llegue C1.

Mientras C1 no llegue, nada de F4 queda bloqueado: la visita se ejecuta sin
reto y con el nivel de rigor por defecto. Lo que **sí** queda bloqueado es el
indicador de retos de F12 y la columna de nivel de `grupo_reglas` de F1 — esta
última se puede dejar `TEXT` sin `CHECK` y cerrarla después, y conviene decirlo
en la migración.

---

## 8. Cambios a pedir a los ADR hermanos

No toqué `adr-01-whatsapp.md` ni `adr-02-antifraude-ia.md`. **Los leí antes de
escribir esta lista**, así que lo que ya resuelven no se pide de nuevo.

### 8.0 Lo primero: los tres documentos usan tres nomenclaturas distintas

Esto hay que unificar **antes de abrir F1**, porque después cuesta una migración
de renombres. Hoy, para las mismas cosas:

| Cosa | Documento 00 (este plan) | ADR-01 | ADR-02 |
|---|---|---|---|
| Ruta pública del QR | `/p/<token>` | **`/q/{codigo}`** | — |
| Prefijo de tablas | `ronda_*` | `visitas_ubicaciones` | `qr_parametros`, `puntaje_detalle` |
| Claves de permiso | `gestionar_puntos` (plano, como todo el repo) | **`puntos_qr.crear`** (con punto) | — |
| Número del reporte | `RV-000001` desde `SEQUENCE` | `RV-2026-10-19-0147` | — |
| Eje de parametrización | contrato → sede → punto | — | **cliente** → sede → punto → paso |

Recomendación, con la razón:

1. **Prefijo `ronda_` para todo** (o el que se decida, pero uno solo). Es el
   pendiente abierto nº 1 del documento 00 y ahora afecta a tres documentos.
2. **Claves de permiso planas**, `snake_case`, sin punto: el catálogo de
   [lib/permisos.ts](apps/inventario/lib/permisos.ts) no tiene ni una clave con
   punto en 12 grupos, y `auth_permiso()` compara contra esas claves. Una clave
   `puntos_qr.crear` no existiría en `/roles` y no se podría asignar.
3. **Una sola ruta pública.** `/q/` o `/p/`, da igual cuál, pero una: el QR se
   imprime en una placa y no se puede cambiar después.
4. **Numeración desde `SEQUENCE`**, como `pqrs_numero_seq` y
   `mantenimiento_ticket_seq`: un número con fecha y contador del día colisiona
   en concurrencia, que es exactamente lo que el repo ya advirtió al crear
   `contrato_consecutivo_seq` ("NUNCA `COUNT(*)+1`").

### 8.1 Al ADR-01 (WhatsApp)

Ya resuelto por ellos y **no hay que pedirlo**: el caudal de ~20 mensajes por
segundo con cola de control (§1.3), los límites de listas (10 filas) y botones
(3), que ninguna plantilla sea *marketing*, el catálogo de plantillas con sus
textos en `es_CO`, la suscripción a `message_template_status_update`, la
idempotencia por `message_id`, la ubicación puntual con
`location_request_message` y la aclaración de que no hay ubicación en vivo por
WhatsApp, y las emergencias fuera de jornada autorizadas por una persona.

Lo que falta:

1. **Envío masivo a una audiencia** (§4.1 del complemento): seleccionar
   contrato, sede, turno, rol, lista o personas sueltas, y que salga **un
   mensaje por persona** con estado individual. Su cola ya da el caudal; lo que
   no existe es la audiencia ni el registro por destinatario
   (`crm_envios` / `crm_envio_destinos`, §4.4).
2. **Costo estimado del envío antes de confirmarlo** (§4.1): de dónde sale la
   tarifa por plantilla y categoría, y si se consulta o se configura a mano.
3. **Plantillas gestionadas desde la consola**: su catálogo está escrito, pero
   no dice si se crean por API o a mano en el Business Manager, ni cómo se
   refleja el estado de aprobación en una tabla (`whatsapp_plantillas`).
4. **Menú de hasta 10 opciones configurable por contrato y rol** (§4.2): ellos
   tienen comandos y listas, pero el menú parametrizable por contrato es nuevo
   (`crm_menu_opciones`).
5. **WhatsApp Flows**: §4.2 lo plantea para formularios largos; el ADR no lo
   menciona. ¿Lo soporta el transporte elegido?
6. **Encaje con el motor de notificaciones existente**: que el canal sea un
   valor nuevo de `flujo_pasos.tipo` (hoy `EMAIL | APP | ESPERA | WEBHOOK`) y un
   caso más en [worker.ts](apps/inventario/lib/notificaciones/worker.ts), no un
   motor aparte.
7. **El contrato como eje** (§2 de este documento): la ventana de mensajería,
   si se permite WhatsApp y la jornada son reglas **del contrato**
   (`grupo_reglas`), no globales. Su §7.2 determina la jornada; hay que
   decir de qué contrato.
8. **Nomenclatura** (§8.0): `/q/` vs `/p/`, `visitas_ubicaciones` vs
   `ronda_*`, y sobre todo **las claves de permiso con punto**, que no
   funcionarían con `auth_permiso()`.

### 8.2 Al ADR-02 (antifraude e IA)

Ya resuelto y **no hay que pedirlo**: el puntaje con sus nueve señales, pesos,
vetos y umbrales; que todo sea parametrizable con versión guardada
(`parametros_version`) y que cambiar un umbral no re-puntúe el pasado; el hash
perceptual, la recaptura, la cámara en vivo, el QR en la foto; que WhatsApp
borra el EXIF; que la cola offline no sirva para falsificar la hora; la
alternativa obligatoria a la biometría; y la retención.

Lo que falta:

1. **El eje de la cascada de parámetros es el contrato, no el cliente.** Su
   §2.10 resuelve `default → cliente → sede → punto → paso`; con la decisión de
   §2 de este documento debe ser `default → contrato (grupos_contrato) → sede →
   punto → paso`. Es un cambio chico (un valor más en `ambito`) y es importante:
   un cliente puede tener dos contratos con rigor distinto.
2. **Dependencia de C1§3 y C1§3.3** (§7 de este documento): el reto aleatorio y
   los niveles de rigor por contrato son insumo suyo y todavía no existen. Su
   parametrización ya puede alojarlos, pero el dominio de `nivel_antifraude`
   está vacío.
3. **El hash perceptual ahora cruza también evidencia de órdenes de trabajo**,
   no solo de visitas (§4.2).
4. **`mant_puede_participar()` no tiene alcance alguno** (§4.2): si el
   antifraude lee tickets de mantenimiento, hereda ese agujero.
5. **Dos usos de IA nuevos** que caen en su alcance y en su "regla de oro":
   clasificación y prioridad de PQRS sugeridas por IA (§6.3 del complemento) y
   narrativa automática de los informes (§5.3), las dos marcadas como generadas
   por IA y revisables antes de salir al cliente.
6. **Nomenclatura** (§8.0): `qr_parametros` y `puntaje_detalle` frente a
   `ronda_*`.

---

## 9. Correcciones al documento 00

Las aplico al documento 00 (es mío) y las dejo anotadas aquí:

1. **`lng`, no `lon`.** El repositorio usa `lng` en todas partes: `sedes.lng`
   ([logistica_conexion.sql:12](supabase/migrations/20260729000000_logistica_conexion.sql)),
   `conductor_ubicacion_actual.lng`, `novedades_entrega.lng`,
   `confirmaciones_entrega.lng`. El documento 00 proponía `lon`.
2. **`cliente_id` pasa a `grupo_id`** en `ronda_plantillas`,
   `ronda_instructivos` y `ronda_qr_lotes`: el eje es el contrato (§2).
3. **Toda tabla operativa gana `grupo_id NOT NULL`** (tabla de §2.4).
4. **`ronda_qr` gana `tipo_objeto` y `activo_id`** (§4.2).
5. **`ronda_visitas` gana `ticket_id`**: la OT se ejecuta con el motor de
   visitas (§4.2).
6. **El ADR-A cambia de "apps/movil no se toca" a "las dos apps, con
   `packages/ronda-core` compartido"** (§1.1).
7. **La decisión 2.8 se matiza**: sigue sin `tenant_id`, pero el eje de alcance
   es el contrato con la sede como segundo filtro (§2.2).
8. **Los pendientes 1, 7 y la identidad quedan cerrados** con las tres
   decisiones de §1.
9. **El pendiente de "rol de la consola"** se resuelve en parte: las claves
   `ver_contratos_conserjeria` y `gestionar_contratos_conserjeria` ya existen sin
   usar (§4.1).

---

## 10. Pendientes nuevos y riesgos

### 10.1 Pendientes de aprobación que agrega el complemento

0. **Unificar la nomenclatura entre los tres documentos** (§8.0): prefijo de
   tablas, ruta pública del QR, formato de las claves de permiso y numeración
   de los reportes. Es lo primero, porque la placa impresa y las claves de
   `/roles` no se pueden cambiar después sin costo.
1. **Modificar `/mantenimiento`, que está en producción**: valores nuevos en
   `estado_ticket_mant`, `maquinaria_id` nullable, y **alcance por contrato en
   la lectura de tickets**, que hoy no tiene ninguno. Es el cambio más
   delicado de todo el complemento.
2. **`grupo_id` en `persona_vinculaciones`** (§2.3): toca nómina con 6.564
   personas cargadas.
3. **Levantamiento 2D/3D**: §3.1 lo da por existente y no existe. ¿Se carga, o
   el mapa muestra la sede como punto con radio?
4. **Buzón de correo entrante** para el hilo de PQRS por radicado (§6.3): cuál.
5. **Qué desafío antispam** para el formulario público (§6.2): no hay ninguno en
   el repo y un captcha de terceros es una dependencia nueva.
6. **Umbral de "posición vieja"** para R2: propuesto 5 minutos, por contrato.
7. **Quién aprueba la OT por el cliente** y si su aprobación es obligatoria para
   cerrar.
8. **Papel `CLIENTE` y papel `PROVEEDOR`** en `usuario_grupos`: ¿se habilitan en
   la primera entrega o después?
9. **Presupuesto de materiales por contrato** (§1.1): ¿se controla contra el
   presupuesto o solo se reporta el consumo?
10. **Penalidades de ANS** (§5.2): ¿se calculan en la plataforma o solo se
    señala el incumplimiento?

### 10.2 Riesgos nuevos

| Riesgo | Mitigación |
|---|---|
| **El complemento multiplica el alcance** y la tentación es construir todo a medias | el corte de F1–F4 como Fase 1 mínima, y F5 como primera entrega visible |
| **Tocar `/mantenimiento` en producción** puede romper el tablero de maquinaria | los estados se agregan (nunca se renombran), y el cambio de RLS va con los tres scripts de verificación de permisos antes y después |
| **Ubicación de personas** es el dato más sensible del módulo | R1 y R2 como requisitos de base de datos, consentimiento aparte, retención de 12 meses parametrizada, purga por cron |
| **El cron de 5 minutos no es una cola** y ahora tiene que mover envíos masivos, informes y preventivos | lotes con `programado_para` y escalonado; si no alcanza, es un cambio de infraestructura que hay que decidir aparte |
| **Informes que no cuadran entre niveles** | una sola vista base agrupada de seis formas (§4.5), y el criterio de aceptación de §10 del complemento se prueba sumando |
| **`activos` y `maquinaria` separados** pueden confundir al usuario ("¿dónde registro el ascensor?") | la interfaz lo dice en una línea: maquinaria es equipo de la empresa, activos son instalaciones del cliente; y la búsqueda del QR resuelve los dos |
| **El complemento 1 no ha llegado** y tres piezas lo esperan | §7: espacios reservados sin rellenar, y nada de F1–F4 bloqueado |
| **Datos del cliente en un repo público** | sigue valiendo lo del documento 00; se agrega que el arte y los nombres de contrato no se escriben en el código ni en los documentos |

### 10.3 Lo legal, con lo que agrega el complemento

Se mantiene todo lo del documento 00 (Ley 1581 de 2012 con biometría aparte y
alternativa; Ley 2191 de 2022 para la jornada del bot), y se suma:

- **Ubicación de trabajadores**: §3.2 lo ata al criterio de proporcionalidad.
  Por eso R1 no es negociable: fuera del turno no se registra ni se muestra. El
  seguimiento continuo en segundo plano exige **consentimiento explícito aparte**
  y un **indicador visible** para el trabajador de que está compartiendo
  ubicación (lo pide §3.2 y lo exigen las reglas de Android e iOS).
- **Indicadores individuales** (§5.4): acceso restringido y contexto obligatorio.
  Es tratamiento de datos de desempeño, no un tablero público.
- **Formulario público de PQRS**: aviso de privacidad y autorización solo cuando
  deja contacto; anónima por defecto posible; **`ip_hash`, nunca la IP en
  claro**, con el mismo criterio que ya aplicó el repo.
- **Opt-in de WhatsApp** registrado por persona antes de cualquier envío.

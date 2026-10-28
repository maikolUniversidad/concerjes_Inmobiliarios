# F9 — El bot de WhatsApp

- **Depende de:** F1 (contrato) y F4 (ejecución de la visita).
- **De dónde sale:** [`adr-01-whatsapp.md`](adr-01-whatsapp.md), con los ajustes de
  la **§8.1** de [`02-complemento-2-integracion.md`](02-complemento-2-integracion.md)
  (que mandan sobre el ADR) y la nomenclatura de
  [`03-nomenclatura.md`](03-nomenclatura.md) (que manda sobre los dos).
- **Migración:** `supabase/migrations/20261028000900_puntos_qr_f9_whatsapp.sql`,
  **aplicada y verificada** contra la base.
- **Lo que NO está acá, a propósito:** `crm_envios`, `crm_envio_destinos` y
  `crm_menu_opciones` son de **F10**; los casos, etiquetas y SLA del CRM son de
  **F11**. No se tocó ninguna tabla de `pqrs_*`, `activo_*`, `mant_*`,
  `persona_ubicacion_*` ni `ronda_rutas`.

> **No hay credenciales de Meta, y el módulo está entero igual.** Es la regla de
> oro de la §10.3 del ADR-01, y se cumple: el webhook recibe (firmado
> localmente), la máquina de estados corre, la evidencia se guarda, el reporte
> se genera y el simulador deja ver cada mensaje tal como saldría. Lo único que
> no pasa es que un mensaje salga hacia un teléfono.

---

## 1. Los nombres, porque los tres documentos usaban tres

La §8.0 del complemento 2 pidió unificar antes de la primera migración, y la
nomenclatura lo cerró. Esta fase lo aplica:

| El ADR-01 decía | Acá se llama | Por qué |
|---|---|---|
| `wa_cuentas`, `wa_credenciales` | `whatsapp_cuentas`, `whatsapp_credenciales` | `whatsapp_` para lo que pertenece al canal de WhatsApp, siguiendo a `whatsapp_plantillas`, que el complemento ya había fijado |
| `wa_eventos`, `wa_medios`, `wa_descargas` | `whatsapp_eventos`, `whatsapp_medios` (la cola de descargas se fundió en `whatsapp_medios`) | — |
| `wa_mensajes_salida` | `crm_mensajes` con `direccion = 'SALIENTE'` | La §1 de la nomenclatura reserva `crm_` para «conversaciones y envíos»; y una conversación que se lee a medias no sirve para supervisar nada |
| `canal_contacto` | **`persona_canales`** (ya existe, la creó F4) | No se creó nada: F4 la dejó con `wa_id` y con `verificado`, que es justo lo que el ADR pedía |
| `consentimientos` | **`persona_consentimientos`** (ya existe, F4) | Ídem, y ya trae el tipo `WHATSAPP` |
| `visitas_ubicaciones`, `visitas_evidencias`, `visitas_eventos` | **`ronda_visitas`, `ronda_evidencias`, `ronda_eventos`** (F4 y F2) | No se duplica el motor: el bot escribe por las mismas RPC |
| `puntos_qr.crear` (clave con punto) | **`gestionar_qr_ronda`** (plana) | Una clave con punto no existe en el catálogo de `permisos.ts`, no aparece en `/roles` y `auth_permiso()` la rechazaría para todo el mundo menos ADMIN |
| `RV-2026-10-19-0147` | `RV-000001` desde `ronda_reporte_seq` | Lo decidió la nomenclatura §4; F4 ya lo implementó así |

---

## 2. Las tablas nuevas

| Tabla | Para qué |
|---|---|
| `whatsapp_cuentas` | El número conectado. `transporte` (`META` / `BSP` / `SIMULADOR`) es la decisión P-1 del ADR convertida en dato: se puede empezar por un BSP y pasar a Meta sin tocar el motor. Nace en `SIMULADOR`. |
| `whatsapp_credenciales` | Los tokens, cifrados con AES-256-GCM y una llave de entorno. **RLS activa y sin ninguna política**: `authenticated` no lee nada de acá. |
| `whatsapp_plantillas` | El catálogo de la §8 del ADR con su **estado de aprobación en Meta**, que era el hueco de la §8.1 punto 3. Las diez sembradas, en `PENDIENTE`. El CHECK sólo admite `UTILITY` y `AUTHENTICATION`: **ninguna puede ser marketing**. |
| `whatsapp_excepciones_jornada` | Quién queda fuera del bloqueo por jornada (Ley 2191, art. 3: dirección, confianza y manejo). Con motivo y con quién la autorizó. **Nace vacía: por defecto nadie está exceptuado.** |
| `whatsapp_eventos` | La cola de entrada, deduplicada por `dedup_clave` UNIQUE. |
| `whatsapp_eventos_rechazados` | Los golpes sin firma válida: IP, motivo y tamaño, **nunca el cuerpo**. |
| `crm_conversaciones` | Una por número (`cuenta_id` + `wa_id` UNIQUE), con el estado de la máquina. `grupo_id` y `sede_id` **nullable**: el primer mensaje de un número desconocido no tiene contrato, y es justo el momento en que hay que identificar a quien escribe. |
| `crm_mensajes` | Todo lo que entra y todo lo que sale. El buzón de salida es `direccion = 'SALIENTE'`. |
| `whatsapp_medios` | Fotos, audios, videos y documentos bajados a Storage propio (bucket `rondas`). |

Dos vistas, `whatsapp_resumen_cola` y `whatsapp_resumen_conversaciones`, porque
Supabase corta a los 8 segundos y un tablero que trae las filas para contarlas
en JavaScript es un tablero que un día deja de cargar.

---

## 3. Lo que decide qué sale: el portero

Es la §4.1 del ADR en una función, `whatsapp_portero()`, y se llama **dos veces
en la vida de cada mensaje**: al encolar y al enviar. La §4.4 del complemento lo
exige, y la razón es concreta: un mensaje programado para las 19:55 que sale a
las 20:05 ya está fuera de jornada.

Pregunta, en este orden, y el orden importa para el motivo que se registra:

1. **¿El número está bloqueado?** → `OMITIDO_BLOQUEADO`.
2. **¿La plantilla está `APPROVED`?** Una `PENDIENTE`, `REJECTED` o `PAUSED` se
   **salta y no se reintenta** → `OMITIDO_PLANTILLA`.
3. **¿Hay ventana de 24 horas?** Fuera de ella sólo sale una plantilla aprobada
   → `OMITIDO_VENTANA`.
4. **¿Estamos en la jornada de la persona?** Sólo frena lo que **inicia el bot**:
   si la persona escribió, el contacto lo inició ella → `OMITIDO_JORNADA`.
5. **¿Hay consentimiento vigente** para lo que se va a pedir? →
   `OMITIDO_CONSENTIMIENTO`.

**Un mensaje omitido no se borra**: queda con su motivo y con una fila en
`ronda_eventos`. Es lo que el supervisor recoge desde la consola.

`whatsapp_encolar()` es la **única puerta de salida**: la RLS no concede INSERT
en `crm_mensajes` a nadie, así que no hay forma de saltarse el portero.

### La jornada, y lo que le falta

`whatsapp_jornada()` resuelve en este orden, y **deja escrito cuál usó**:

1. Excepción vigente de `whatsapp_excepciones_jornada`.
2. Persona `RETIRADO` o `INACTIVO` → no hay jornada, ni la de respaldo.
3. `grupo_reglas.mensajeria_desde` / `_hasta` **del contrato** — lo exige la §8.1
   punto 7: la jornada de mensajería es una regla del contrato, no global.
4. La franja de respaldo (`WHATSAPP_JORNADA_FALLBACK`, 06:00–20:00).

**Lo que falta, y hay que decirlo:** la §7.2 del ADR pone como fuente preferida
el **turno programado** de la persona y, después, su **marcación real**. Hoy eso
no existe: `programacion_fase1` dejó los patrones de turno (`turno_patrones`) y
los puestos, pero **ninguna tabla dice qué turno le toca a qué persona qué día**,
ni hay marcaciones, ni hay tabla de vacaciones o incapacidad. Cuando existan se
agregan como fuente 3 y las demás bajan un puesto; por eso la respuesta trae
`fuente`, para que el día que cambie se vea en los eventos viejos qué regía.

Un turno de noche que cruza medianoche es **un intervalo**, no dos trozos:
22:00–06:00 es una jornada continua, y hay prueba de eso.

---

## 4. La máquina de estados

Vive en `apps/inventario/lib/whatsapp/maquina.ts` y es una **función pura**:
`(estado, evento, contexto) → (estado', acciones[])`. Sin red, sin base, sin
reloj propio. Eso no es elegancia: es lo que permite probar las transiciones, los
vencimientos y los estados de error en una tabla de casos, que es el corazón del
módulo y lo que más se rompe solo.

Los 18 estados de la §4.2 completos: los nueve del flujo feliz más los nueve de
espera y error. `motor.ts` traduce las acciones a RPC y guarda el estado.

### Las tres reglas que no se negocian

1. **El sistema nunca confirma en nombre de la persona.** Si el resumen vence
   dos veces, el reporte queda en **borrador** y lo confirma un supervisor desde
   la consola.
2. **Nunca se bloquea el trabajo.** Fuera de geocerca, sin foto o sin
   consentimiento, la visita **sigue** con su novedad anotada y el aviso al
   supervisor. Dejar a alguien atrapado a las dos de la mañana con un botón que
   no responde es lo que hace que la próxima ronda se haga en papel.
3. **El bot no escribe fuera de la jornada.** Al terminar el turno la visita pasa
   a `EN_ESPERA_FUERA_DE_JORNADA`, se genera el reporte como borrador y **el bot
   deja de escribir**: ni recordatorios, ni plantillas, ni «no olvides». A las 48
   horas se cierra sola con novedad, porque no se le vuelve a escribir a nadie
   por algo de hace dos días.

### Lo que la máquina aprendió en las pruebas

Cinco defectos que sólo se vieron al recorrer la conversación entera, y que
valen más escritos que callados:

- **El evento de ubicación no llegaba a la transición T2.** En
  `PUNTO_IDENTIFICADO` una ubicación caía en la rama de «esperando Sí, empezar».
  La T2 entera no funcionaba.
- **«Ya están todos los consentimientos» se leía como «falta el primero»**,
  porque la función devolvía un valor por defecto en vez de `null`. La
  conversación se quedaba pidiendo permisos para siempre.
- **La foto de cierre se archivaba como foto de tarea.** La persona mandaba la
  foto final, el bot contestaba «foto guardada» y la dejaba esperando.
- **El valor de la respuesta no correspondía al tipo del paso.** «Hecha» mandaba
  una casilla a un paso de `NUMERO`, y `ronda_responder_paso` lo rechazaba, con
  razón. Ahora «Hecha» sólo se **ofrece** donde puede contestar (casilla y
  texto), y en los demás el bot dice qué mandar. «No se pudo» en una casilla la
  contesta `NO` con su motivo, que es lo que significa y lo que el CHECK de F4
  pide.
- **El orden del lote de salida no estaba garantizado.** El `RETURNING` de un
  UPDATE no respeta el `ORDER BY` con el que se eligieron las filas, así que un
  aviso masivo podía salir antes que la respuesta a alguien que estaba parado en
  un punto. El lote ahora se ordena en el trabajador.
- **La evidencia se bajaba a Storage pero NO entraba al módulo.** El archivo
  quedaba en el bucket con su `sha256`, y `ronda_adjuntar_evidencia` fallaba con
  «hay que decir quién hace la visita»: se llamaba sin `p_persona`. El síntoma
  habría sido el peor posible — un reporte de visita **sin ninguna foto**, con
  los archivos ahí, en Storage, sin que nada los enlazara. Dos cosas más del
  mismo camino: `ronda_evidencias.tipo` sólo admite `FOTO`, `VIDEO` y `AUDIO`, y
  se le estaba mandando `ARCHIVO`; y el cliente simulado devolvía
  `application/octet-stream` como tipo de archivo, o sea que **el simulador
  probaba un camino que en real no ocurre**. Ahora no inventa un tipo que no
  conoce y manda el que declaró el mensaje entrante.

---

## 5. El enganche con el módulo de rondas

El bot **no tiene reglas de negocio propias**: escribe por las MISMAS RPC que
usa la PWA de F4.

| Lo que el bot hace | Por dónde |
|---|---|
| Abrir la visita | `ronda_registrar_visita` (con `canal = 'WHATSAPP'`, `identidad_metodo = 'BOT'`, y la plantilla que resuelve `ronda_tareas_punto`) |
| Evaluar la geocerca | `ronda_geocerca_evaluar` — la misma función que la app, para que el número de metros que se le responde sea el mismo en los tres canales |
| Contestar un paso | `ronda_responder_paso` |
| Adjuntar evidencia | `ronda_adjuntar_evidencia`, con el `sha256` calculado al bajar el archivo |
| Reportar novedad | `ronda_reportar_novedad` |
| Cerrar | `ronda_cerrar_visita` |
| Registrar consentimiento | `persona_consentimiento_registrar`, con la **versión y el hash del texto exacto** que la persona leyó |
| Auditar | `ronda_eventos`, con `actor_tipo = 'BOT'` y `canal = 'WHATSAPP'` |

F4 ya había dejado el espacio: `ronda_visitas.canal` admite `WHATSAPP`,
`identidad_metodo` admite `BOT`, y `ronda_eventos.actor_tipo` admite `BOT`.

**La ubicación validada se escribe también en la visita** (`lat`, `lng`,
`distancia_metros`, `dentro_geocerca`), porque de ahí la leen el reporte y el
resumen. La RPC de apertura no la pudo poner: en WhatsApp la visita se abre
**antes** de que llegue la ubicación, porque la solicitud es un mensaje aparte.
Cuando la visita queda marcada fuera de cerca, se escribe el motivo, que es lo
que el CHECK de F4 exige.

---

## 6. El webhook

`/api/whatsapp/webhook` es **el único extremo público del módulo**, y su
autenticación es la **firma de Meta**: no hay cookie, no hay token de sesión, no
hay IP de confianza, porque Meta no se puede autenticar de otra forma.

> **Hay que excluirlo del Firewall, de BotID y de la protección de despliegue de
> Vercel.** Si algo le pide una credencial a Meta, Meta no entrega nada y el
> síntoma es «no llegan mensajes», sin ningún error visible en ninguna parte.

El `POST` hace **tres cosas y responde**: verificar la firma, insertar en
`whatsapp_eventos`, devolver 200. Menos de 300 ms. Nada de llamadas a Meta, nada
de descargas, nada de IA, nada de PDF.

| Situación | Respuesta |
|---|---|
| Firma válida, `wamid` nuevo | insertar, **200** |
| Firma válida, `wamid` repetido | **200** sin procesar — es el reintento de Meta haciendo su trabajo |
| Sin firma, firma mala o sin app secret | **403**, se registra el rechazo sin el cuerpo, no se encola nada |
| La inserción falla | **500 a propósito**, para que Meta reintente. Nunca 200 sobre un evento que no quedó guardado: no hay API para recuperar un webhook viejo |

**Todo lo que llega por ahí es dato hostil, nunca instrucción.** La firma dice
que el cuerpo lo armó quien tiene el app secret; no dice que su contenido sea
verdad. Un comando se reconoce comparando contra una lista cerrada, y un id de
botón que el bot no reconoce **no se adivina**: se trata como «no entendí».

---

## 7. Los tres crons

En `vercel.json`, **cada minuto** y no cada cinco, porque los relojes de la §4
son de minutos y un conserje que espera cinco minutos una respuesta se va y hace
la ronda en papel. Misma convención que `/api/cron/correo`: `runtime = 'nodejs'`,
`maxDuration = 60` y `Authorization: Bearer ${CRON_SECRET}`.

| Ruta | Qué hace |
|---|---|
| `/api/cron/whatsapp-entrada` | Toma la cola de entrada, corre la máquina, baja los medios |
| `/api/cron/whatsapp-salida` | Manda el buzón de salida con control de caudal y vuelve a pasar cada fila por el portero |
| `/api/cron/whatsapp-vencimientos` | Los temporizadores de la §4 y el cierre de jornada de la §7 |

Presupuesto de **tiempo**, no de cantidad: a los 40–50 s salen ordenadamente y
dejan lo pendiente en la cola. Lo que quede lo recoge la próxima vuelta.

**El caudal.** El número en coexistencia tiene un tope **fijo de 20 mensajes por
segundo** que no se puede subir. Se trabaja a 15 para dejar margen. El `130429`
(rate limit) **no cuenta como fallo del mensaje**: se reencola en 10 segundos sin
gastar intento, porque el problema es el ritmo y no el contenido. El `190` (token
inválido) deja el mensaje `EN_ESPERA_CREDENCIAL`: **la cola se detiene y no se
descarta**, y en la consola sale el aviso de reconectar.

---

## 8. El simulador

`/api/whatsapp/simulador`, sólo con `WHATSAPP_SIMULADOR=1` (sin esa variable
responde **404**, no 403: una ruta de desarrollo no debería ni anunciar que
existe) y con el mismo `CRON_SECRET` de los crons.

Lo que se le pide **arma un payload real de webhook**, lo firma con el app secret
local y lo manda por HTTP a `/api/whatsapp/webhook`. Es decir: pasa por la
verificación de la firma, la deduplicación, la cola, la máquina, el portero y el
buzón de salida. **No hay atajo**, y eso es el punto: un simulador que entrara
por una puerta propia no probaría nada de eso.

Y el transporte es el simulado, con los **mismos límites** que la realidad: un
mensaje que no cabría en WhatsApp falla también simulado. Un simulador más
permisivo que la realidad no sirve.

### Lo que el simulador NO prueba

Hay que hacerlo a mano, una vez, con un número real:

- El flujo de **Embedded Signup en coexistencia** (hay una persona tocando
  botones en un teléfono).
- La **sincronización de contactos e historial**, que corre **una sola vez** y
  tiene una ventana de 24 horas desde el onboarding.
- El **eco `smb_message_echoes`** cuando alguien responde desde la app del
  teléfono (el código lo maneja: lo guarda en la conversación, **no** abre la
  ventana de 24 h y **no** mueve la máquina).

---

## 9. Permisos

Tres claves nuevas, planas y en `snake_case`, en el grupo **Operación
Conserjería** de `lib/permisos.ts`:

| Clave | Para qué |
|---|---|
| `ver_whatsapp` | Leer conversaciones, mensajes y plantillas |
| `gestionar_whatsapp` | Responder a mano, reencolar lo omitido, gestionar plantillas, autorizar un envío de emergencia fuera de jornada |
| `conectar_whatsapp` | Conectar o desconectar el número de la empresa |

`conectar_whatsapp` **va sola y no se reparte**: conectar el número desvincula
los dispositivos acompañantes de quien usaba WhatsApp Web y deja el canal de
toda la operación en manos de quien lo haga. Se enciende a mano, a una persona,
desde `/roles`.

Sembradas: `ver_whatsapp` + `gestionar_whatsapp` en Administrador, Gerencia y
Supervisor de Conserjería; `conectar_whatsapp` sólo en Administrador;
`ver_whatsapp` en Auditor, que lee y no toca (el mismo criterio de PQRS).

Las escrituras **no tienen política de RLS**: entran por funciones
`SECURITY DEFINER` llamadas desde un route handler con la llave de servicio,
igual que `/q/<token>` y `/api/campo/rpc`. Es lo que garantiza que el portero no
se pueda saltar. Las lecturas usan `auth_permiso()` **y** alcance por contrato
con `auth_ve_grupo()`; una conversación sin contrato conocido la ve sólo quien
gestiona, porque no hay alcance con el que filtrarla.

---

## 10. Pantalla

`/rondas/whatsapp`, con permiso `ver_whatsapp`. Cuatro pestañas: la cola y **lo
que no salió con su motivo**, las conversaciones, el estado de las plantillas
ante Meta y los golpes rechazados al webhook. Todo contado en SQL.

Dos decisiones de la pantalla:

- **El número de WhatsApp no se muestra completo.** Es dato personal (el ADR lo
  dice en su riesgo R-7) y quien mira el tablero no necesita el número para
  hacer su trabajo. El buscador **sí** filtra por el número completo, a
  propósito: un supervisor que lo tiene en la mano necesita encontrar la
  conversación. El texto del buscador lo dice, para que sea una decisión visible.
- **Lo primero que se ve es qué le falta al entorno** para poder mandar algo de
  verdad. Es más útil ahí que como un error en el momento de enviar.

### Lo que la verificación visual encontró

Se montó el componente real con datos reales y con un juego inventado (números
`5730000000NN`, nombres ficticios). Nueve cosas, todas corregidas:

1. El aviso de «falta configuración» escribía `</code>, <code>` **como texto**:
   en JSX el separador de `join` es una cadena literal y React lo escapa. Era el
   aviso más importante de la pantalla y se veía roto.
2. Buscar sin resultados decía «Todavía no hay conversaciones», o sea mentía
   sobre el estado del sistema. Ahora dice que el filtro no encontró nada.
3. **Los dos contadores de omitidos no medían lo mismo**: la tarjeta sumaba la
   vista agrupada (toda la tabla) y la pestaña contaba sobre los últimos 100
   mensajes. Con tráfico real mostraban dos cifras distintas del mismo dato a
   cinco centímetros de distancia. La pestaña usa ahora el total de SQL.
4. La lista de omitidos se cortaba en 15 en silencio. Ahora dice cuántos faltan.
5. El chip de motivo tenía el mismo fondo que el panel naranja y no se veía como
   pastilla.
6. `EN_ESPERA_FUERA_DE_JORNADA` se pintaba neutro, porque la condición era
   `startsWith('ESPERA')` y ese estado empieza por `EN_`. Justo el estado ligado
   a la Ley 2191 quedaba indistinguible de uno normal.
7. El nombre del punto y del contrato se traían de la base y **no se mostraban**:
   la tabla tenía códigos crípticos y el nombre viajaba al cliente para nada.
8. Sin ninguna cuenta registrada el bloque desaparecía sin decir nada, y un
   bloque ausente se lee como «está bien» y no como «no hay número conectado».
9. El texto del buscador no mencionaba que también filtra por nombre y por
   número.

---

## 11. El canal en el motor de notificaciones

La §8.1 punto 6 pedía que WhatsApp fuera **un valor más** de `flujo_pasos.tipo` y
un caso más en el worker, no un motor aparte. Así quedó: `tipo` admite
`WHATSAPP` (la columna es `VARCHAR(20)` sin CHECK, así que no hizo falta
migración) y `lib/notificaciones/worker.ts` gana `ejecutarWhatsapp()`.

Tres reglas propias que un correo no tiene:

- **Opt-in obligatorio**: sin `persona_consentimientos` de tipo `WHATSAPP` la
  persona **no entra**. Un correo de trabajo no necesita permiso; un WhatsApp al
  celular personal sí (§10.3 del complemento).
- **Plantilla**: un flujo se dispara por un evento, en cualquier momento, y es
  normal que la ventana esté cerrada. El nombre de la plantilla va en
  `paso.asunto`; sin ella el portero lo omite con su motivo, y eso está bien.
- **Jornada**: el portero lo bloquea fuera del turno.

---

## 12. Verificación

### La migración, contra la base

`scripts/verificar-whatsapp.mjs` — **65 comprobaciones, todas dentro de
`BEGIN … ROLLBACK`**, así que no deja ni una fila. Cubre la resolución del número
a la persona, la idempotencia del evento, la ventana de 24 h, la matriz completa
del portero (ventana × jornada × consentimiento × plantilla × bloqueo), el turno
nocturno que cruza medianoche, la excepción de la Ley 2191, el reclamo del lote,
los reintentos con sus códigos, el orden de los `statuses`, los CHECK que no
dejan pasar lo que no debe, y que **un usuario sin el permiso no ve nada** (ni
una conversación, ni una plantilla, ni un token).

```bash
NODE_OPTIONS=--use-system-ca node scripts/verificar-whatsapp.mjs
```

### La conversación completa, con el simulador

`scripts/simular-whatsapp.mjs` — monta un contrato, una sede, un punto, tres
tareas y una persona de prueba; recorre **23 pasos de conversación** y 9 bloques
de controles; **67 comprobaciones**; y **borra los datos de muestra al terminar**.
El número es inventado y está fuera de rangos reales.

```bash
# con el servidor de desarrollo arriba y WHATSAPP_SIMULADOR=1
NODE_OPTIONS=--use-system-ca node scripts/simular-whatsapp.mjs
NODE_OPTIONS=--use-system-ca node scripts/simular-whatsapp.mjs --limpiar
```

### Pruebas automáticas

`tests/inventario/whatsapp-{firma,maquina,mensajes,entrada}.test.ts` — 180
pruebas: la verificación de la firma (incluido el caso de la barra escapada, que
es donde se rompe re-serializar, y el de **sin secreto configurado**, que tiene
que rechazar y no aceptar), el reto de suscripción, la máquina de estados
completa con sus vencimientos, los límites de WhatsApp (sobre todo las **10 filas
EN TOTAL** de una lista, que es el límite que más se confunde), la normalización
de los payloads, la deduplicación y los comandos.

---

## 13. Lo que falta para producción

### Variables de entorno

Documentadas en `.env.example` y declaradas en `turbo.json`. Las que **no pueden
faltar**:

| Variable | Sin ella |
|---|---|
| `WHATSAPP_APP_SECRET` | El webhook **rechaza todo** (un despliegue incompleto no es un despliegue permisivo) |
| `WHATSAPP_WEBHOOK_VERIFY_TOKEN` | Meta no marca el endpoint como verificado y **no entrega nada** |
| `WHATSAPP_TOKEN_LLAVE` | No se pueden guardar ni leer los tokens (mínimo 32 caracteres) |
| `WHATSAPP_APP_ID` | No se puede canjear el código de Embedded Signup |

Las demás (`WHATSAPP_GRAPH_BASE_URL`, `WHATSAPP_API_VERSION`,
`WHATSAPP_THROUGHPUT_MPS`, `WHATSAPP_VENTANA_SEGURIDAD_HORAS`,
`WHATSAPP_JORNADA_FALLBACK`, `WHATSAPP_ZONA_HORARIA`,
`WHATSAPP_BUCKET_EVIDENCIA`, `WHATSAPP_EMBEDDED_SIGNUP_*`, `WHATSAPP_BSP_*`)
tienen valor por defecto razonable.

**Lo que NO es variable de entorno**: el `waba_id`, el `phone_number_id` y los
tokens de la empresa. Son por cliente, se obtienen en tiempo de ejecución cuando
termina Embedded Signup y viven en `whatsapp_cuentas` / `whatsapp_credenciales`.

### Pasos en Meta

1. **Decidir P-1**: directo con Meta (hay que ser Tech Provider y pasar App
   Review para `whatsapp_business_messaging` y `whatsapp_business_management`) o
   por un BSP (que ya tiene el acceso avanzado). Arranca en días en vez de
   semanas, a cambio de un costo por mensaje y una dependencia. No bloquea nada
   de lo construido.
2. **Verificar el portafolio de negocios.**
3. **Crear la app** y anotar App ID y App Secret.
4. **Configurar el webhook**: Callback URL `https://<dominio>/api/whatsapp/webhook`
   y Verify Token; suscribirse a `messages`, `message_template_status_update`,
   `smb_message_echoes`, `phone_number_quality_update` y `account_alerts`.
5. **Excluir esa ruta** del Firewall, de BotID y de la protección de despliegue.
6. **Crear las diez plantillas** en el Business Manager con los textos de la §8
   del ADR (están en `whatsapp_plantillas`), en `es_CO` y con un valor de ejemplo
   por variable, o las rechazan. La revisión puede tardar **24 horas**. Después
   hay que marcar `estado = 'APPROVED'` y su `meta_id`.
7. **Confirmar el `sessionInfoVersion` de Embedded Signup v4** (P-3): las v2 y v3
   quedaron obsoletas el 15 de octubre de 2026 y el ejemplo oficial de
   coexistencia todavía mostraba `"3"`.
8. **Correr Embedded Signup en modo Coexistencia** con el número de la empresa, y
   **avisar antes** a quien use WhatsApp Web: al conectar, los dispositivos
   acompañantes se desvinculan.
9. **Decidir P-4 antes del onboarding**: si se sincroniza el historial de 6
   meses. Trae conversaciones con clientes y terceros a nuestra base, se puede
   correr **una sola vez** y hay 24 horas para hacerlo.
10. **Registrar la cuenta** en `whatsapp_cuentas` con su `waba_id`,
    `phone_number_id` y `transporte = 'META'` o `'BSP'`, y guardar el token
    cifrado en `whatsapp_credenciales`.

---

## 14. Lo que F10 y F11 necesitan saber

### Dónde está qué

| Lo que busquen | Dónde está |
|---|---|
| La conversación de un número | `crm_conversaciones`, UNIQUE por (`cuenta_id`, `wa_id`) |
| Todo lo que se dijo | `crm_mensajes`, con `direccion` |
| El buzón de salida | `crm_mensajes` con `direccion = 'SALIENTE'` — **no hay otra tabla** |
| La cuenta y su caudal | `whatsapp_cuentas` (`throughput_mps`, `transporte`, `estado`) |
| Las plantillas y su estado en Meta | `whatsapp_plantillas` |
| Si se le puede escribir a alguien | `whatsapp_portero()`; el opt-in es `persona_consentimientos` tipo `WHATSAPP` |

### Cómo se manda un mensaje

**Siempre por `whatsapp_encolar()`.** No se inserta en `crm_mensajes` a mano: la
RLS no lo concede, y el camino directo se saltaría el portero.

```sql
SELECT * FROM whatsapp_encolar(
  p_conversacion => '<uuid>',
  p_tipo         => 'TEXTO',          -- o PLANTILLA, BOTONES, LISTA…
  p_texto        => 'lo que se lee en la consola',
  p_payload      => '{"tipo":"TEXTO","texto":"…"}'::jsonb,  -- el mensaje completo
  p_iniciado_por => 'BOT',            -- o RESPUESTA
  p_plantilla    => 'ronda_asignada_hoy',   -- obligatoria fuera de la ventana
  p_variables    => '["Ana","6","Sede","06:00"]'::jsonb,
  p_prioridad    => 7,                -- 1 urgente … 9 masivo
  p_programado   => now() + interval '10 minutes'
);
```

Devuelve la fila. Si nace `OMITIDO_*`, **no se mandó y hay que mirar
`omitido_motivo`**: es información, no un error que haya que reintentar.

**Para F10 (mensajería masiva):** `crm_envio_destinos` debe crear **una fila por
persona** y encolar **un `whatsapp_encolar` por persona**. Nunca un grupo: con
coexistencia los grupos no se sincronizan y las herramientas de negocio no están
soportadas. Usen **`prioridad` 7–9**, para que un envío a 800 personas no deje
esperando al conserje que está parado en un punto. Y `programado_para`, porque un
envío a 800 personas tarda alrededor de un minuto al caudal del número: **el
escalonado es obligatorio**, no una optimización.

Hay una función que ya les sirve: **`whatsapp_puntos_del_dia(persona, momento)`**
devuelve los puntos del día con su estado, resuelto en SQL y limitado a 10 filas
(lo que admite una lista de WhatsApp). Es la base de «próxima ubicación» de la
§4.3.

### Cómo se engancha una conversación entrante

El bot ya procesa todo lo que llega. Para que F11 reciba lo que no es de rondas,
el punto de enganche es **`avanzar()`** en `lib/whatsapp/maquina.ts`: devuelve un
estado y una lista de **acciones**, y `motor.ts` las ejecuta. Agregar un tipo de
acción (`ABRIR_CASO`, `ETIQUETAR`, `ASIGNAR`) es agregar un `case` en `ejecutar()`
de `motor.ts`. **No hace falta tocar el webhook ni la cola.**

Dos cosas que F11 va a querer cambiar, y están listas para eso:

- `DERIVAR_AGENTE` y `AVISAR_SUPERVISOR` hoy **escriben un evento** en
  `ronda_eventos` (`DERIVADO_A_AGENTE`, `AVISO_A_SUPERVISOR`), porque el CRM con
  casos es de F11. Cuando exista, esas dos acciones abren un caso.
- `crm_conversaciones.contexto` es un JSONB libre donde la máquina se guarda lo
  que necesita entre vueltas. F11 puede agregar sus llaves sin migración.

### Cómo se lee una conversación para mostrarla

`crm_mensajes` ordenado por `created_at`. El `payload` de un saliente **es el
mensaje completo** (tipo, cuerpo, botones, filas), así que la consola puede
pintarlo sin volver a armarlo. En el entrante, `payload` es el evento de Meta tal
cual llegó.

---

## 15. Pendientes y decisiones que esta fase deja anotadas

**Del ADR, sin resolver y sin bloquear nada de lo construido:** P-1 (directo o
BSP), P-2 (qué número se conecta), P-3 (`sessionInfoVersion` de v4), P-4
(¿se sincroniza el historial?), P-5 (quién aprueba los textos de consentimientos
y plantillas) y P-7 (radio de geocerca por defecto; F1 y F2 ya pusieron uno).

**Decisiones que tomé con el criterio de los documentos, para no quedarme
esperando:**

1. **`crm_mensajes` unifica entrada y salida**, en vez de las dos tablas del ADR.
   La nomenclatura reserva `crm_` para «conversaciones y envíos», y una
   conversación que sólo se puede leer a medias no sirve para supervisar.
2. **`whatsapp_` para lo que es del canal de WhatsApp**, siguiendo a
   `whatsapp_plantillas`, que el complemento ya había fijado. La nomenclatura no
   nombraba un prefijo para la cuenta y las credenciales.
3. **UNA plantilla por (nombre, idioma, cuenta)**, no por contrato: las plantillas
   se aprueban por número (§2.4 del complemento).
4. **`whatsapp_excepciones_jornada` cuelga sólo de `persona_id`**, no de un cargo.
   El ADR hablaba de `cargo_id`; la excepción de la Ley 2191 es una decisión
   laboral con nombre y apellido, y hacerla por cargo la convertiría en una
   política silenciosa. Si hace falta por cargo, se agrega la columna.
5. **«Hecha» sólo se ofrece donde puede contestar el paso.** El ADR lo ponía
   siempre; `ronda_responder_paso` valida por tipo, así que ofrecerlo en un paso
   de `NUMERO` sería un botón que no hace nada.
6. **Un paso de `FIRMA` no se puede hacer por WhatsApp** y el bot lo dice, en vez
   de fingir que sí.

**Lo que pide una decisión del usuario:**

1. **El comando `NOVEDAD` sin visita abierta no crea ticket.**
   `ronda_reportar_novedad` de F4 **cuelga de una visita**, y una novedad suelta
   (alguien ve algo roto en un pasillo, sin estar haciendo una ronda) no tiene
   una. Hoy queda el rastro en `ronda_eventos` con `NOVEDAD_SIN_VISITA`. Hay dos
   salidas y no es decisión mía: **(a)** una RPC nueva de novedad suelta, o
   **(b)** radicarla como PQRS por el canal `WHATSAPP`, que `pqrs` ya admite.
2. **`CREAR QR` queda a medias.** El comando reconoce y verifica el permiso
   (`gestionar_qr_ronda`), pero crear el punto por chat necesita tres pasos
   conversacionales (sede, nombre, ubicación) y emite un QR firmado que se
   imprime y se pega en una pared. **Crear por chat lo que se imprime en una
   placa merece una decisión explícita**, no un efecto secundario de esta fase.
3. **La sincronización de contactos e historial no tiene tabla.** El ADR proponía
   `wa_sincronizaciones`. No se creó porque no se puede construir ni probar sin
   credenciales, corre **una sola vez** y su forma depende de P-4.
4. **El clasificador de intención por IA no está conectado.** Los comandos y los
   botones funcionan sin él, que es la regla R-9 del ADR. Lo que no calza con un
   comando responde con la **ayuda contextual**, que es el comportamiento seguro
   que el propio ADR pide por debajo de 0,7 de confianza.
5. **La reconexión y el canje de Embedded Signup no tienen ruta.** Las tablas
   están y el cliente sabe leer el token cifrado, pero el canje del código no se
   puede escribir a ciegas: depende del `sessionInfoVersion` de la v4 (P-3). La
   cuenta se registra a mano mientras tanto.

**Un hueco que encontré y NO es de esta fase:** las cuatro claves de permiso de
**F4** (`ejecutar_rondas`, `ver_visitas_rondas`, `gestionar_visitas_rondas`,
`gestionar_accesos_campo`) están en su migración y en sus políticas de RLS, pero
**no están en el catálogo de `lib/permisos.ts`**. `node scripts/auditar-permisos.mjs`
lo reporta como «NO está en el catálogo → no se puede otorgar desde /roles». No
las agregué porque `permisos.ts` lo tocan varias sesiones a la vez y esas claves
son de F4, pero conviene resolverlo antes de que alguien use la PWA: hoy, quien
no sea ADMIN no puede ejecutar una ronda. El mismo informe aparece para claves de
F6 y F8, que están en curso.

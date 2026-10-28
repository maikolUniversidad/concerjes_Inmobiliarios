# F10 — Mensajería masiva individual, menú y próxima ubicación

Lo que esta fase agrega, por qué está hecho así y qué queda abierto. El alcance
es la §4.4 del [complemento 2](02-complemento-2-integracion.md): `crm_envios`,
`crm_envio_destinos`, `crm_menu_opciones`, el valor `WHATSAPP` en
`flujo_pasos.tipo` y la respuesta de «próxima ubicación» que lee lo de F8.

Migración: `supabase/migrations/20261028001100_puntos_qr_f10_masivo_menu.sql`,
**aplicada y verificada** contra la base.

---

## 1. La idea en una frase

**Un envío masivo es una lista de personas, no un mensaje a un grupo.** Todo lo
demás sale de ahí: una fila por persona (`crm_envio_destinos`), un
`whatsapp_encolar()` por persona, un estado por persona, una marca de emergencia
por persona, y una hora por persona —el escalonado— porque el número tiene un
tope fijo de 20 mensajes por segundo que no se puede subir.

---

## 2. Las tres tablas

| Tabla | Para qué | Eje (§2.4) |
|---|---|---|
| `crm_envios` | La audiencia (contrato, sede, turno, rol, lista o personas sueltas), qué se manda, cuándo, a qué ritmo, el costo estimado y el estado | `grupo_id` **NOT NULL**, sin `sede_id` |
| `crm_envio_destinos` | **Una fila por persona**, con su estado, su hora, su mensaje, su costo, su error y su marca de emergencia | `grupo_id` **NOT NULL**, sin `sede_id` |
| `crm_menu_opciones` | El menú del bot por contrato y por cargo, máximo 10 opciones | `grupo_id` **nullable** (NULL = todos) |

Más dos vistas: `crm_envios_resumen` (los destinos contados por estado, en SQL) y
`crm_cargos_audiencia` (qué cargos existen y **cuántas personas de cada uno son
alcanzables** por WhatsApp).

Las dos vistas llevan `security_invoker = true`. **No es un detalle**: sin eso
una vista se ejecuta con los permisos de su dueño y se salta la RLS de sus
tablas, así que cualquiera con permiso de lectura vería los envíos de todos los
contratos. Es la misma opción que ya usa `v_stock_flujo`.

---

## 3. El ritmo: no hay un segundo control de caudal

El que frena de verdad sigue siendo **`procesarSalida()` de F9**, que espera
entre mensaje y mensaje. F10 **no envía nada**: reparte la hora de cada destino
con el **mismo número de mensajes por segundo**, para que el buzón de salida no
reciba 800 filas con la misma marca de tiempo y la prioridad siga significando
algo (un aviso masivo va en 7–9; una respuesta a quien está parado en un punto,
en 1–4).

Ese número vive en un solo sitio, `apps/inventario/lib/envios/ritmo.ts` (la
aritmética pura) y `lib/whatsapp/caudal.ts` (la parte que lee el entorno). Lo
usan las tres piezas que lo necesitan: el buzón de salida de F9, el reparto de
horas de `crm_envio_aprobar()` y la pantalla, que dice cuánto va a tardar el
envío **antes** de confirmarlo. Si cada una calculara el suyo, un día quedarían
desalineadas y el reparto prometería un ritmo que el envío no puede sostener.

`procesarSalida()` se cambió sólo para leer de ahí: la lógica no se tocó.

### El escalonado, paso a paso

1. `crm_envio_resolver(envio)` escribe una fila por persona (PENDIENTE las que
   entran, EXCLUIDO con su motivo las que no). **Todo en una sentencia**: la
   audiencia de un contrato grande son miles de personas y Supabase corta a los
   8 segundos.
2. `crm_envio_aprobar(envio, desde, mps)` le da a cada destino su instante:
   `base + indice / mps` segundos. Es aritmética, sin bucles.
3. `/api/cron/crm-envios`, **cada minuto**, toma los destinos cuya hora venció y
   encola **un `whatsapp_encolar()` por persona**.
4. `/api/cron/whatsapp-salida` (F9) los manda, al caudal del número.

**El id del mensaje ES el id del destino.** `whatsapp_encolar` es idempotente
por `p_id`, así que un destino no puede generar dos mensajes ni aunque el cron se
solape consigo mismo.

---

## 4. La jornada (Ley 2191 de 2022)

Se aplica **dos veces**, como exige la §4.4:

1. **Antes de encolar**, en `crm_envio_tomar_lote()`: lo que cae fuera de la
   jornada del contrato se **APLAZA** a la siguiente apertura
   (`crm_envio_siguiente_ventana()`), con su motivo, su fuente y un evento en
   `ronda_eventos`. No nace omitido: un aviso de las 21:00 que tiene que llegar
   mañana a las 06:00 no es un error, es un aplazamiento.
2. **Al enviar**, en el portero de F9, que vuelve a mirar todo (bloqueo,
   plantilla aprobada, ventana de 24 h, jornada y consentimiento).

La **emergencia** salta el bloqueo, exige quién la autorizó
(`gestionar_whatsapp`) y por qué, y **cada destino queda marcado**: meses después
se puede ver a quién se le escribió fuera de su jornada y con qué autorización.

Tres cosas que conviene no re-derivar:

- Una franja **es un intervalo**: 22:00–06:00 cruza la medianoche y es UNA
  jornada continua, no dos trozos.
- Todo se mide **en hora de Bogotá**. Calcularlo en UTC daría el día anterior
  entre las 19:00 y la medianoche, que es justo el final del turno de la tarde.
- Un destino se aplaza **tres veces como máximo**; después se cierra con su
  motivo en vez de dar vueltas para siempre. Y una persona **sin jornada**
  (retirada o inactiva) no tiene ventana a la que aplazar: eso también se dice.

---

## 5. La audiencia

`audiencia_alcance` dice de dónde **sale** la lista (`CONTRATO`, `SEDES`,
`PERSONAS`, `LISTA`) y `audiencia_cargos` / `audiencia_turno` la **recortan**, en
cualquiera de los cuatro. Sin un alcance explícito, un envío que sólo nombra tres
personas sueltas no se distinguiría de un envío a todo el contrato con tres
personas anotadas al margen; con 6.000 personas en la nómina, esa confusión es un
envío masivo que nadie quería.

**De dónde sale el contrato de una persona:** de su sede
(`personas.sede_id → sedes.grupo_id`). La §2.3 lo dice: `persona_vinculaciones`
todavía no ata a cada persona con su contrato. Quien no tiene sede queda
`SIN_SEDE`, y quien tiene una sede de otro contrato, `FUERA_DEL_CONTRATO`: la
audiencia **siempre** es de un contrato.

**Quién queda fuera, y se guarda con su motivo** (no se descarta la fila: un
envío que llega a 40 de 50 tiene que decir qué pasó con los otros 10):
`SIN_CANAL`, `SIN_CONSENTIMIENTO`, `CANAL_BLOQUEADO`, `PERSONA_INACTIVA`,
`FUERA_DEL_CONTRATO`, `SIN_SEDE`.

**La lista del directorio** (`directorio_listas`) se cruza **por teléfono** con
`persona_canales` verificados: esa tabla guarda correos y teléfonos, no personas,
y el opt-in es de la persona. Un contacto que no corresponde a nadie con WhatsApp
verificado simplemente no produce destino.

---

## 6. El menú del bot (§4.2)

`crm_menu_opciones`, por contrato y por cargo. **Gana el conjunto más específico
que exista, completo**: (contrato + cargo) → (contrato) → (cargo) → el general.
No se mezclan filas de dos niveles, porque mezclarlas daría menús que nadie
configuró y de los que nadie podría explicar el orden.

- `etiqueta` 24 y `descripcion` 72 **no son redondeos**: es lo que admite una
  fila de lista de WhatsApp. El tope de 10 opciones es el de la lista entera, y
  lo cuida un trigger.
- `accion` es un **catálogo cerrado**. Un menú que pudiera ejecutar texto libre
  convertiría a quien lo configura en quien maneja el bot.
- `requiere_permiso` esconde la opción a quien no lo tiene. Una opción que
  aparece y después dice «no tenés permiso» es una opción mal configurada.
- Se siembra un menú general de seis opciones: sin él, escribir MENÚ no mostraría
  nada y el bot tendría una puerta que no abre.

En el bot: `MENU` es ahora un comando propio (antes «menú» y «opciones» caían en
AYUDA) y `PROXIMA_UBICACION` también. La máquina sólo pinta el menú y despacha la
opción tocada; ninguna opción escribe en una visita.

---

## 7. La próxima ubicación (§4.3)

Sale de **`ronda_proxima_parada()` de F8**: la regla de cuál es la siguiente
parada vive allí y no se reimplementa. El motor la consulta **sólo cuando el
mensaje la pide** (el comando o una fila del menú que apunte a esa acción): un
«hola» no tiene por qué pagar tres consultas de rutas.

Si falta la foto o la referencia del punto se usa lo que haya
(`ronda_puntos.descripcion`), que es lo que §4.3 prevé. **Sin ruta de hoy no se
inventa un punto**: el bot lo dice y ofrece MIS PUNTOS.

Los mismos datos entran en un envío masivo por los **marcadores**: `{nombre}`,
`{sede}`, `{cargo}`, `{contrato}`, `{hora}`, `{fecha}`, `{punto}` y
`{punto_nombre}`. Es una **lista cerrada** —el texto lo escribe quien arma el
envío, y un lenguaje con expresiones sería una vía para leer lo que no le toca—,
y la pantalla avisa cuando alguien escribe un marcador que no existe, antes de
mandarlo tal cual a 400 personas.

---

## 8. El canal en el motor de flujos

F9 ya había dejado `WHATSAPP` como valor de `flujo_pasos.tipo` y el caso en
`lib/notificaciones/worker.ts`. Lo que faltaba era que **la consola lo pudiera
elegir**: ahora `TipoPasoFlujo` lo incluye y el editor de flujos ofrece el paso,
con el nombre de la plantilla y el aviso de que sólo le llega a quien dio su
opt-in y dentro de su jornada.

---

## 9. Permisos

| Clave | Para qué |
|---|---|
| `ver_envios_whatsapp` | Ver los envíos y sus destinatarios |
| `gestionar_envios_whatsapp` | Crear, calcular, aprobar y cancelar un envío |
| `gestionar_menu_whatsapp` | Configurar el menú del bot |

La **emergencia no tiene clave propia**: la autoriza quien tiene
`gestionar_whatsapp`, que es lo que F9 ya definió para eso. Y el **menú general**
(sin contrato) exige además `gestionar_whatsapp`, porque cambia lo que ve toda la
operación de golpe.

Sembradas en Administrador, Gerencia y Supervisor de Conserjería; sólo
`ver_envios_whatsapp` en Auditor, que lee y no toca.

Las **escrituras no tienen política de RLS**: entran por funciones
`SECURITY DEFINER` que comprueban el permiso y el alcance de contratos por
dentro. Es lo que garantiza que no se pueda armar un envío saltándose las
comprobaciones ni encolar un mensaje sin pasar por el portero. Las lecturas van
con `auth_permiso()` **envuelto en `(select …)`**, para evaluarse una vez por
consulta y no una por fila (migración 20261028000001); en estas tablas importa
más que en ninguna, porque un envío son miles de filas.

---

## 10. La pantalla

`/rondas/envios`, con tres pestañas: los envíos con sus destinos contados en SQL,
el formulario de un envío nuevo y el menú del bot.

Lo que la pantalla tiene que dejar claro **antes** de confirmar, y deja:

- a cuántas personas le llega y a cuántas **no, y por qué**;
- **cuánto tarda** al caudal del número (800 personas son unos 54 s, no un
  instante);
- si la plantilla elegida **no está aprobada en Meta**, que fuera de la ventana
  de 24 h no va a salir;
- si la hora elegida cae **fuera de la jornada** del contrato, a cuándo se
  aplazaría;
- qué marcadores del texto **no son marcadores**.

El número de WhatsApp **no se muestra completo** (`57•••••233`): es dato personal
y quien mira el tablero no lo necesita para su trabajo. Es la misma decisión de
la pantalla del bot en F9.

---

## 11. Cómo se verifica

```bash
# El esquema y las reglas contra la base, en BEGIN … ROLLBACK (no deja filas)
NODE_OPTIONS=--use-system-ca node scripts/probar-puntos-qr-f10.mjs

# Las pruebas automáticas (ritmo, jornada, audiencia, menú, próxima parada)
npx vitest run --project inventario

# El envío de punta a punta con el simulador de F9, con el servidor arriba y
# WHATSAPP_SIMULADOR=1 (crea datos de muestra y los borra al terminar)
SIM_BASE_URL=http://localhost:3001 NODE_OPTIONS=--use-system-ca \
  node scripts/simular-envio-masivo.mjs
```

**Trampas que costaron un rato y conviene no repetir:**

- `select (f(...)).*` llama a la función **una vez por columna** del resultado:
  con una tabla de 38 columnas, crea 38 envíos. Se llama con
  `select * from f(...)`.
- Dentro de una transacción `NOW()` **no avanza**, así que el segundo destino de
  un escalonado nunca «vence». Las pruebas de la base adelantan la hora a mano.
- `(now())::time` sale en la hora del **servidor**, no en la de Bogotá: una
  jornada de prueba calculada así queda corrida cinco horas.
- En desarrollo, la primera llamada a una ruta de Next la **compila**, y eso
  tarda segundos que se comen el escalonado. El simulador calienta las rutas
  antes de medir.

---

## 12. Lo que queda abierto

**Decisiones del usuario:**

1. **La tarifa por mensaje no se consulta por API** (§8.1 punto 2 del
   complemento, que quedó abierto). `crm_envios.costo_unitario` se escribe a
   mano al armar el envío y de ahí sale el costo estimado. Si no se pone, el
   envío **no muestra costo** en vez de mostrar uno inventado. Hay que decidir si
   se configura por contrato, por plantilla o se deja así.
2. **Ninguna plantilla está aprobada en Meta.** Las diez de F9 y las dos que
   agrega F10 (`aviso_masivo_operacion` y `proxima_ubicacion_punto`) están
   `PENDIENTE`, y fuera de la ventana de 24 horas **sólo sale una APPROVED**. Es
   decir: hoy un envío masivo nace omitido con su motivo, que es el
   comportamiento correcto. Aprobarlas necesita credenciales de Meta (P-2/P-5 del
   ADR-01).
3. **«Ver mi mapa» y «Radicar una PQRS» quedan en el catálogo del menú pero sin
   canal.** El enlace al mapa necesita el enlace firmado de corta duración del
   ADR-A y la PQRS por chat necesita decidir cómo se radica desde una
   conversación (es el pendiente nº 1 de F9). El menú **lo dice** en vez de dejar
   un botón que no responde.
4. **«Hábil» es la jornada del contrato, no el día hábil del calendario.** Los
   festivos de `pqrs_dias_no_habiles` **no** se descuentan, porque la conserjería
   trabaja festivos: descontarlos aplazaría al martes el aviso del lunes festivo
   de quien ese lunes está trabajando. Si algún contrato necesita lo contrario,
   es una columna más en `grupo_reglas`.
5. **El «rol» de una audiencia es el cargo de la nómina**, y `personas.cargo` es
   **texto libre** en esta base (existe la tabla `cargos`, pero `personas` no la
   referencia). Se compara normalizado en mayúsculas. El día que `personas` gane
   `cargo_id`, `audiencia_cargos` y `crm_menu_opciones.cargo` se pueden convertir
   sin tocar el resto. Ojo: **no es** el rol de `/roles`, que es el de los
   permisos de la consola.

**Pendiente técnico:**

6. **El cron nuevo hay que agregarlo en Vercel**: `/api/cron/crm-envios`, cada
   minuto, ya está en `vercel.json` y en `apps/inventario/vercel.json`. No hace
   falta ninguna variable de entorno nueva: usa `CRON_SECRET` y las `WHATSAPP_*`
   que F9 ya documentó en `.env.example`.
7. **`crm_envio_crear` no deja crear un envío de emergencia sin sesión.** El
   servidor con la llave de servicio puede crear envíos normales (para un flujo
   automático), pero una emergencia la autoriza una persona con nombre, y eso se
   comprueba con `auth.uid()`.
8. **Las vistas de F9 (`whatsapp_resumen_cola`, `whatsapp_resumen_conversaciones`)
   no llevan `security_invoker`**, así que se ejecutan con los permisos de su
   dueño y se saltan la RLS de sus tablas. Son sólo agregados por cuenta y por
   estado, así que la fuga es menor, pero conviene agregárselo cuando alguien
   toque esa fase.

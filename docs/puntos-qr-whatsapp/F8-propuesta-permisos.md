# F8 · Propuesta de reparto por rol de `ver_recorrido_personas` y `gestionar_accesos_campo`

Estado, al 29 de octubre de 2026:

- La propuesta **fue aprobada**, y el hueco que se encontró al revisarla (punto
  6.1) **está arreglado y aplicado**:
  `20261028000811_puntos_qr_f8_recorrido_respeta_contrato.sql`.
- El reparto en sí,
  `20261028000810_puntos_qr_f8_roles_ubicacion.sql`, **está escrito y sin
  aplicar todavía**.

Las dos claves son las únicas del módulo que hoy **no las tiene ningún rol**, así
que las dos funciones que protegen son hoy solo-ADMIN. Comprobado contra la base
el 29 de octubre de 2026, rol por rol:

| clave | roles activos que la tienen hoy |
|---|---|
| `ver_mapa_operativo` | Coordinador, Supervisor de Conserjería |
| `ver_rutas_ronda` | Auditor, Conserje, Coordinador, Supervisor de Conserjería, Técnico de Mantenimiento |
| `gestionar_rutas_ronda` | Coordinador, Supervisor de Conserjería |
| `reportar_ubicacion_campo` | Conserje, Técnico de Mantenimiento |
| **`ver_recorrido_personas`** | **ninguno** |
| **`gestionar_accesos_campo`** | **ninguno** |

Dos datos de contexto que cambian el peso de la decisión:

- **Administrador, Gerencia y Super Administrador ya pueden hacer las dos cosas**,
  porque `auth_permiso()` les da paso por el rol base. Lo que se decide aquí es
  solo si alguien **sin** rol base de administración puede hacerlo.
- **Hoy no hay ni una fila en `grupo_reglas`**, y la lectura de ubicación exige
  `comparte_seguimiento_vivo = true` en el contrato, que por `COALESCE(..., false)`
  hoy es falso en todos. **Mientras eso no se encienda contrato por contrato no
  se graba ni se muestra la ubicación de nadie**, tenga quien tenga el permiso.
  Las cinco tablas de F8 están en cero filas. Es decir: esta decisión se puede
  tomar con calma, pero conviene tomarla antes de encender el primer contrato,
  no después.

---

## 1. Qué se graba, cada cuánto, con qué precisión y cuánto se conserva

Sin esto la decisión no se puede tomar. Todo son parámetros por contrato
(`grupo_reglas`), con estos valores por defecto:

| qué | valor por defecto | columna |
|---|---|---|
| un registro cada | **120 s** (2 min); uno que llegue antes se ignora sin insertar | `ubicacion_intervalo_seg` |
| tope por turno | **1.000** registros; a partir de ahí se ignora | `ubicacion_max_puntos_turno` |
| una posición deja de ser «en vivo» a los | **300 s** (5 min) | `ubicacion_frescura_seg` |
| el rastro se purga a los | **3 meses** (ajustable de 1 a 120) | `retencion_ubicacion_meses` |
| duración máxima de un turno | **12 h** | `turno_duracion_max_horas` |
| el contrato permite el seguimiento | **false** | `comparte_seguimiento_vivo` |

Cada registro guarda: latitud y longitud con 7 decimales (resolución de
centímetros, aunque el GPS de un celular rara vez baja de 5–20 m), la
**precisión que reporta el dispositivo tal cual** (no se redondea ni se difumina),
velocidad, rumbo, la fuente (`APP`, `WHATSAPP`, `APP_NATIVA`, `CONSOLA`), tres
relojes (cuándo lo capturó el dispositivo, cuándo quedó fijado en el servidor y
el desfase entre ambos) y, si el registro se hizo en un punto de control, el
punto y la visita.

Lo que **no** se graba, y está impedido en la base y no en la pantalla:

- **Fuera del turno, nada.** `ronda_registrar_ubicacion()` exige un turno
  ABIERTO y dentro de su ventana; si no, no inserta ni una fila y devuelve
  `RECHAZADA` con el motivo, que queda auditado.
- **Sin consentimiento, nada.** El consentimiento `SEGUIMIENTO` va aparte del
  `UBICACION` de F4 justamente porque el texto de F4 promete que no se rastrea
  entre visitas. Sin él la PWA no le pide el GPS al navegador ni una vez.
- **Sin el contrato encendido, nada**, por `comparte_seguimiento_vivo`.
- **Seguimiento en segundo plano, nada.** La PWA reporta mientras la pantalla
  está abierta. Cerrar la app deja de reportar.

---

## 2. Qué deja ver exactamente `ver_recorrido_personas`

No es «ver el mapa». El mapa en vivo es `ver_mapa_operativo` y es otra clave.
Esta es **la miga de pan**: reconstruir por dónde anduvo una persona, con horas.
Abre cuatro puertas:

1. **`ronda_recorrido(turno)`** — la lista ordenada de hasta 5.000 registros de
   un turno: coordenada, hora exacta, precisión, velocidad, metros desde el
   registro anterior, y el punto de control cuando lo hubo. Es el replay de la
   pantalla: una línea en el mapa que se reproduce con un control de tiempo.
2. **`ronda_turnos_recorribles(...)`** — el selector del replay: hasta 500
   turnos con **nombre y apellido de la persona**, contrato, sede, hora de
   entrada y de salida, número de registros, metros recorridos y el código de la
   ruta. **Acepta rango de fechas sin tope hacia atrás.**
3. **Lectura directa de `persona_ubicacion_historial`** por RLS, todas las
   columnas, de todos los turnos de su alcance. Esta puerta sí exige además
   `comparte_seguimiento_vivo` (las dos RPC, no: ver el punto 7).
4. **Lectura de `persona_ubicacion_actual`**, es decir **la posición en vivo**,
   porque `ronda_mapa_acceso()` es `ver_mapa_operativo` **o**
   `ver_recorrido_personas`. Dar la del recorrido da también la del momento.

Alcance: **por contrato** (`auth_grupos()`). No por sede, y **no por jerarquía**:
quien la tenga ve el recorrido de **cualquiera** del contrato, no solo de su
gente. Ventana hacia atrás: **toda la que la retención conserve** (3 meses por
defecto) y, hoy, **toda sin límite**, porque la purga está escrita pero no
enganchada al cron (ver punto 7).

Lo que **no** da:

- No da entrar a `/rondas/mapa`: la pantalla y el ítem del menú exigen
  `ver_mapa_operativo`. Dada sola, no se ve nada en el panel (pero sí se puede
  consultar desde el cliente de Supabase: la clave es capacidad real, no
  decorado).
- No da nada en la PWA de campo.
- **Lo propio no la necesita.** Toda persona ve su propio rastro sin ningún
  permiso, por la cláusula «lo propio siempre se ve» de las políticas (Ley 1581).

---

## 3. Qué habilita exactamente `gestionar_accesos_campo`

Esta es de F4 y es más grande de lo que su etiqueta sugiere («Enviar el enlace de
acceso y el PIN a quien no tiene cuenta»). **No tiene ni una pantalla ni un
`server action` que la exija**: toda su fuerza está en la base. Abre cinco
puertas:

1. **`ronda_acceso_solicitar()` como usuario autenticado** — emitir un enlace de
   un uso y un PIN **para cualquier persona activa de la nómina**, buscándola por
   número de documento, y dictarlo por teléfono (entrega `ASISTIDA`) incluso si
   la persona no tiene ningún canal verificado. **Sin alcance por contrato**: las
   933 personas activas de hoy, no las de su contrato.
2. **`ronda_consentimiento_registrar()` por cuenta de otra persona** — dejar
   registrado que alguien consintió, incluido el consentimiento `SEGUIMIENTO`,
   quedando como `registrado_por`.
3. **Lectura de `persona_canales`** (teléfonos y correos de toda la nómina) y de
   `persona_consentimientos`, **sin alcance por contrato**. Equivale a lo que ya
   da `ver_personas`.
4. **Escritura `FOR ALL` sobre `persona_canales`**, también **sin alcance por
   contrato**: crear, cambiar o borrar el canal de cualquier persona y marcarlo
   verificado.
5. **Lectura de `ronda_sesiones`** (estado de la entrega, destino enmascarado,
   hashes), esta sí acotada por contrato.

**Las puertas 1 y 4 juntas son suplantación.** Quien tenga esta clave puede
apuntar el WhatsApp de cualquier trabajador a un número propio, marcarlo
verificado y pedir un enlace de acceso que llegue ahí. Y desde que F9 está en
producción eso pesa más que cuando se escribió F4: **`persona_canales` es ahora
el mapa de identidad del bot** — `ronda_whatsapp_conversacion_abrir()` resuelve
«quién me está escribiendo» por el `wa_id` o el número verificado de esa tabla.
Reescribir una fila ahí no solo desvía un PIN: le cambia el nombre a quien
conversa con el bot.

---

## 4. El reparto que recomiendo

### `ver_recorrido_personas` → **Supervisor de Conserjería** y **Coordinador**

| rol | recorrido | por qué |
|---|---|---|
| **Supervisor de Conserjería** | **sí** | Es quien responde cuando el cliente dice «nadie pasó por el sótano a las 3». Ya tiene el mapa en vivo y arma las rutas; el replay es la misma tarea, un día después. |
| **Coordinador** | **sí** | El otro rol con el mapa en vivo y el dueño operativo del contrato. Y es decisivo en la práctica: **hoy no hay ningún usuario con el rol Supervisor de Conserjería y hay 8 Coordinadores**, así que darlo solo al Supervisor no cambiaría nada y la función seguiría siendo solo-ADMIN, que es justo lo que se quiere resolver. |
| Auditor | **no** | Aunque su oficio es mirar sin tocar, el rastro continuo no es lo que necesita para auditar: la **prueba** de que la ronda se hizo es la coordenada de apertura y cierre de la visita en `ronda_visitas`, que se conserva 12 meses y ya ve con `ver_visitas_rondas`. El rastro es un dato de desempeño, no una prueba de cumplimiento. |
| Jefe de Mantenimiento | **no** | Su gente ejecuta órdenes de trabajo, y una OT se verifica con su propia evidencia (fotos, firma, lecturas), no con la miga de pan del técnico. |
| Operador de Sede | **no** | Ve una sede; el mapa en vivo del día le bastaría, y ni ese tiene hoy. La clave es por contrato, no por sede: le abriría el recorrido de personas de sedes que no son la suya. |
| Conserje · Técnico de Mantenimiento | **no** | Son el sujeto del dato, no su destinatario. Y **su propio rastro ya lo ven sin permiso**. |
| Empleado · Bodeguero · Conductor · Coordinador de Compras | **no** | Nada en su oficio lo pide. `Empleado` son 853 cuentas: darlo ahí sería abrir el rastro de los compañeros a casi toda la nómina. |
| Administrador · Gerencia · Super Administrador | ya lo tienen | Por rol base. No se siembran. |

### `gestionar_accesos_campo` → **ningún rol todavía**

No es una evasiva: es que **darlo hoy cuesta alcance real y no compra nada
visible**. No hay pantalla que la use, así que ni el Supervisor ni el Coordinador
podrían dictar un PIN desde el panel aunque la tuvieran; y lo que sí
estrenarían es escritura sin alcance sobre la tabla de la que ahora depende la
identidad del bot de WhatsApp (punto 3).

| rol | accesos | por qué |
|---|---|---|
| Supervisor de Conserjería · Coordinador | **sí, pero después** | Son los dos candidatos correctos: ya tienen `ver_personas`, así que la clave no les abriría datos personales nuevos, y la entrega asistida es su tarea. Dárselo **cuando** exista la pantalla y el canal esté acotado (punto 7). |
| Operador de Sede | **no por ahora** | Es, en el papel, quien está físicamente al lado del trabajador sin teléfono — el caso de uso más real. Pero mientras la escritura de `persona_canales` no esté acotada por contrato, dárselo a un rol de sede abre las 6.634 filas de la nómina. Acotar primero, dar después. |
| Auditor | **no** | Un rol de solo lectura no debería poder emitir una credencial ni registrar un consentimiento por cuenta de otra persona. |
| Jefe de Mantenimiento · Técnico · Conserje · Empleado · Bodeguero · Conductor · Coordinador de Compras | **no** | Ninguno entrega accesos. |
| Administrador · Gerencia · Super Administrador | ya lo tienen | Por rol base. Hoy la entrega asistida es suya, y para el volumen actual alcanza. |

---

## 5. Qué se rompe si se decide al revés

**Si `ver_recorrido_personas` no se le da a nadie** (dejarlo como está): no se
rompe nada técnico. `/rondas/mapa` abre igual, el selector del replay llega
vacío (`getTurnosRecorribles` devuelve lista vacía) y el botón de reproducir no
aparece. El costo es operativo: ante una queja del cliente o un reclamo de un
trabajador, **la única forma de mirar el rastro es con una cuenta de
administración**, lo que en la práctica significa que lo mira alguien de sistemas
y no el responsable del contrato. Y lo mira sin que el reparto de /roles diga
nada al respecto, que es peor para rastrear quién vio qué.

**Si se le da a más roles de los que propongo** (por ejemplo a Empleado, o al
Conserje para que vea a sus compañeros): además del rastro histórico se abre
**la posición en vivo** (punto 2, puerta 4), sin alcance por sede y sin
jerarquía. Es el escenario que la Ley 1581 mira con lupa: tratamiento de un dato
sensible por quien no lo necesita para su función. Si se decide así, lo mínimo
sería acotar antes la clave a jerarquía o a sede, que hoy no existe.

**Si `gestionar_accesos_campo` se da ya a Supervisor y Coordinador**: no se
rompe nada visible —no hay pantalla— pero quedan 10 usuarios con escritura sin
alcance sobre la tabla de identidad del bot. Es asumible si se acepta que son
cargos de confianza, y se puede revertir en /roles en un clic; pero el punto 7
se vuelve urgente en vez de recomendable.

**Si se le da a Operador de Sede o al Auditor**: eso sí lo recomiendo no hacer
sin acotar primero, por lo mismo del punto 3.

---

## 6. Lo que conviene acotar en el código ANTES de dar el permiso

Tres cosas del recorrido, en orden de importancia. **La primera era un hueco
real, no una mejora, y ya está arreglada** (migración
`20261028000811_puntos_qr_f8_recorrido_respeta_contrato.sql`, aplicada el 29 de
octubre de 2026, antes del reparto).

1. ~~**Las dos RPC del recorrido no comprueban `comparte_seguimiento_vivo`.**~~
   **ARREGLADO.**
   La política RLS de `persona_ubicacion_historial` sí lo exige, pero
   `ronda_recorrido()` y `ronda_turnos_recorribles()` son `SECURITY DEFINER` y
   por tanto se saltan la RLS: solo comprueban el permiso y el alcance de
   contrato. Consecuencia: **un contrato que apague el seguimiento deja de
   mostrar el mapa en vivo pero su rastro pasado sigue reproduciéndose.** Eso
   contradice lo que la propia migración promete («revocar
   `comparte_seguimiento_vivo` apaga la lectura en el acto»). Son dos líneas:
   usar `ronda_ubicacion_puede_ver(grupo)` en lugar de
   `ronda_recorrido_acceso() AND auth_ve_grupo(grupo)`, cambiando además
   `ronda_mapa_acceso()` por la clave del recorrido donde haga falta.
2. **Enganchar la purga al cron.** `ronda_purgar_ubicacion()` y
   `ronda_turnos_cerrar_vencidos()` están escritas y probadas, pero ninguna ruta
   las llama. Mientras no se enganchen, la retención de 3 meses **no existe** y
   el rastro es perpetuo. **Hoy no urge** —cero registros de ubicación y el
   seguimiento apagado en todos los contratos, así que no hay nada que
   retener— pero **se vuelve obligatorio el día que se encienda el primer
   contrato**. Lo que haría falta, exactamente, está en el punto 9.
3. **Una ventana de días para el replay.** Hoy
   `ronda_turnos_recorribles(p_desde, p_hasta)` acepta cualquier rango hacia
   atrás. Un tope por contrato —del estilo `recorrido_ventana_dias`, 30 por
   defecto— haría que el uso normal (investigar lo de ayer o de la semana
   pasada) no cambie, y que pedir «todo el trimestre de una persona» sea una
   decisión aparte. Es la diferencia entre una herramienta de supervisión y una
   de vigilancia, y hoy no está puesta.

Dos de los accesos de campo:

4. **Acotar `persona_canales` por contrato**, en lectura y sobre todo en
   escritura (`persona_canales_write` es hoy `FOR ALL` con la clave y nada más),
   y lo mismo para la búsqueda por documento de `ronda_acceso_solicitar()`.
5. **Separar la escritura del canal de la entrega del PIN.** Dictar un PIN y
   reescribir el número de WhatsApp de una persona son dos oficios distintos; el
   segundo encaja mejor con `gestionar_personas`, que ya es quien mantiene la
   ficha. Mientras sean la misma clave, la entrega asistida no se puede dar sin
   dar también la suplantación.

Nada de esto es F8 tal como se entregó: son cambios que propongo y que **no he
hecho**, porque el reparto es la pregunta de esta tarea y porque el punto 1 toca
una función que ya está en producción.

---

## 7. Qué hace la migración que acompaña esta propuesta

`supabase/migrations/20261028000810_puntos_qr_f8_roles_ubicacion.sql`, **escrita y
sin aplicar**:

- Siembra `ver_recorrido_personas` en **Supervisor de Conserjería** y
  **Coordinador**, con el idioma `jsonb_build_object(...) || permisos` de F6:
  lo que ya esté puesto en el rol gana, así que re-aplicarla no revive un
  permiso que alguien haya apagado a mano en /roles.
- **No siembra `gestionar_accesos_campo` en ningún rol.** Deja el `UPDATE`
  listo y comentado, con los dos roles que recomiendo, para que darlo sea
  descomentar dos líneas si la decisión es otra.
- Cierra con un bloque `DO` de coherencia que falla si alguien queda con
  `ver_recorrido_personas` sin `ver_mapa_operativo` (la pantalla y el menú
  exigen la del mapa: el rol tendría la capacidad en la base y una pantalla
  cerrada en la cara) o con `gestionar_accesos_campo` sin `ver_personas`
  (escribiría el canal de una persona cuya ficha no puede abrir).

**Cómo se comprobó sin aplicarla:** corriéndola contra la base dentro de
`BEGIN … ROLLBACK`. Dentro de la transacción los dos roles quedan con la clave;
apagándola a mano y re-aplicando el archivo, **no revive** (el idioma
`defaults || permisos` hace lo que promete); las dos comprobaciones de
coherencia saltan cuando toca (`Auditor` con recorrido y sin mapa, `Operador de
Sede` con accesos y sin `ver_personas`); y tras el `ROLLBACK` quedan **cero**
roles con alguna de las dos claves, es decir la base está como estaba.

---

## 8. Dos cosas que encontré de paso, para quien reparta el resto

No son de esta tarea y no las toqué:

- **`gestionar_visitas_rondas` también está en cero roles activos.** Es la clave
  de F4 que anula una visita, corrige lo cerrado y purga evidencia vencida. Hoy
  eso es solo-ADMIN.
- **`ejecutar_rondas` la tienen Jefe de Mantenimiento y Técnico de
  Mantenimiento, pero no el Conserje.** Si el conserje es quien hace la ronda
  desde una cuenta de usuario (no desde la PWA con enlace y PIN), le falta.
  Con la PWA no estorba, porque ahí el actor es la sesión de campo.

---

## 9. Qué haría falta para enganchar la purga al cron

Escrito aquí para que la decisión se tome con el costo delante. **No está
hecho.** Son dos archivos y ningún secreto nuevo:

1. **Una ruta**, `apps/inventario/app/api/cron/rondas-ubicacion/route.ts`, con el
   mismo molde que las siete que ya existen (`/api/cron/whatsapp-vencimientos`
   es el más parecido): `runtime = 'nodejs'`, `maxDuration = 60`, comprobación
   `Bearer ${process.env.CRON_SECRET}` en la cabecera `authorization`, y un
   cliente de Supabase con `SUPABASE_SERVICE_ROLE_KEY`. **Basta con el
   `CRON_SECRET` que ya está puesto**: no hace falta ninguna variable nueva ni
   ninguna llave nueva.
2. **Una entrada en `apps/inventario/vercel.json`**, en el arreglo `crons` que
   ya tiene siete.

Dentro, las dos llamadas que ya existen y están probadas:

- `ronda_turnos_cerrar_vencidos(500)` — **esta conviene que corra seguido**, no
  una vez al día: el índice único de «un turno abierto por persona» mira el
  estado y no la hora, así que un turno vencido sin cerrar **impide abrir el
  siguiente**. Si alguien cierra mal su turno a las 6 de la mañana, con un cron
  diario no puede volver a abrir hasta el día siguiente.
- `ronda_purgar_ubicacion(5000)` — borra un lote y devuelve cuántas filas
  borró, para saber si hay que volver a llamar.

Por eso propongo **una sola ruta cada 15 minutos** (`*/15 * * * *`) que haga las
dos cosas en cada pasada, en vez de dos entradas con horarios distintos: cerrar
turnos necesita frecuencia, y purgar un lote de 5.000 cada 15 minutos son hasta
480.000 filas al día, muchísimo más de lo que esta tabla va a generar. Así no
hay que escribir lógica de «solo purga si son las 4 de la mañana», que es el
tipo de condición que un día falla en silencio.

Costo: 96 invocaciones al día de una función que, con la base vacía, hace dos
consultas que no devuelven nada.

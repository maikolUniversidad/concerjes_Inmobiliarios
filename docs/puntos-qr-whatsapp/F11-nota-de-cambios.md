# F11 — El CRM con IA

Los casos que salen de las conversaciones que dejó F9, con su agente, su reloj
y una IA que clasifica, resume y **sugiere** una respuesta que siempre aprueba
una persona.

Migración: `supabase/migrations/20261028001200_puntos_qr_f11_crm_ia.sql`,
**aplicada y verificada** contra la base (101 comprobaciones en
`scripts/verificar-crm-f11.mjs`, todas dentro de `BEGIN … ROLLBACK`).

---

## 1. La regla que no se negocia, y dónde está puesta

> **Una respuesta sugerida por la IA nunca se envía sola. Siempre la aprueba
> una persona.** (ADR-02 §4; criterio de aceptación de la Fase 4 del documento
> 00.)

No está implementada como una opción que se pueda apagar. Está en **tres capas
distintas**, y ninguna es un `if` en la pantalla:

| Capa | Qué la hace cumplir | Qué la vigila |
|---|---|---|
| **Estructural** | `lib/crm/ia.ts` —lo único que habla con el modelo— no importa nada con lo que se pueda enviar. No es que no lo llame: **no lo tiene**. No conoce Supabase, ni `whatsapp_encolar`, ni `lib/whatsapp/salida`. Entra texto, sale un objeto validado. | `tests/inventario/crm-sin-envio-automatico.test.ts` lee el archivo y falla si alguien agrega el import |
| **Lógica** | `lib/crm/aprobacion.ts` → `prepararEnvio()` es el único armador del payload de salida del CRM, y sin un usuario que apruebe devuelve error **sin payload**: el objeto de rechazo no trae nada que mandar, ni por descuido | `tests/inventario/crm-aprobacion.test.ts` (5 formas distintas de intentar que el envío no tenga dueño) |
| **Base de datos** | `crm_respuesta_aprobar()` EXIGE `p_aprobado_por` no nulo, que exista en `usuarios`, y —si hay sesión— que sea el propio usuario conectado. Es la **única** función de la migración que encola | `scripts/verificar-crm-f11.mjs` lo intenta con NULL y con un uuid que no es de nadie |

Y una cosa que conviene no perder de vista: **aprobar no se salta el portero de
F9**. El texto aprobado sigue saliendo por `whatsapp_encolar()`, así que fuera
de la ventana de 24 horas, fuera de la jornada o sin consentimiento nace
`OMITIDO_*` y no sale. Una persona puede aprobar un texto; no puede autorizar
escribirle a alguien a las once de la noche. La pantalla lo dice cuando pasa.

Cuando sí sale, sale con **`iniciado_por = 'AGENTE'`**, nunca `BOT`: es
literalmente lo que pide el criterio de aceptación de la Fase 4.

---

## 2. Lo que llega por WhatsApp es dato hostil, no instrucción

Un mensaje entrante va a pasar por un modelo de lenguaje, así que alguien va a
escribir ahí instrucciones para el modelo. Tarde o temprano una va a funcionar:
un prompt no es un muro. Por eso la defensa no es que el modelo resista, sino
que **acertar no sirva de nada**.

1. **El mensaje va dentro de un bloque delimitado y rotulado como datos**, y el
   delimitador se neutraliza si viene dentro del texto (`blindar()`). Es el
   único truco con el que se podría «cerrar» el bloque y escribir donde el
   modelo espera instrucciones. `blindar()` **no censura el contenido**: el
   mensaje llega íntegro al resumen, porque si alguien escribe «ignora todo lo
   anterior» eso es un dato del caso y quien lo atiende tiene que verlo.
2. **La salida es un esquema cerrado** (`json_schema` estricto con OpenAI, más
   validación con `zod` del lado nuestro aunque el modelo diga que fue
   estricto, como pide el ADR-02 §3.5). **No existe ningún campo con el que el
   modelo pueda pedir una acción** — ni `enviar`, ni `estado`, ni `cerrar`, ni
   `asignar`. No se pueden pedir porque no están. Lo que el modelo invente se
   descarta y queda registrado en `clasificacion_ia.descartado`.
3. **Lo que devuelve va a columnas `*_ia`, que son sugerencias.** El dominio de
   `tipo`, `prioridad` y `estado` es cerrado con CHECK, y
   `crm_caso_ia_guardar()` descarta en silencio lo que no sea del dominio en vez
   de romper. Mover el caso es `crm_caso_estado()`, otra RPC, con permiso y con
   usuario.

**Lo peor que logra una inyección perfecta** es que a un caso le quede sugerido
un tipo equivocado, que una persona ve marcado como «sugerido por IA» y corrige
con un clic.

Probado de las dos maneras: con `tests/inventario/crm-ia-hostil.test.ts` (20
pruebas) y **de verdad, contra un modelo**, en
`scripts/probar-ia-crm-f11.mjs`. El modelo detectó el intento, sugirió
`MANTENIMIENTO/ALTA`, y el caso siguió en `CONSULTA/MEDIA/NUEVO` sin que saliera
ningún mensaje.

---

## 3. Las tablas

| Tabla | Para qué |
|---|---|
| `crm_casos` | El caso, numerado `CS-00001` desde `crm_caso_seq`. `grupo_id` y `sede_id` **nullable** (§2.4 del complemento 2): una conversación puede empezar sin contrato conocido, y el caso hereda ese desconocimiento. Las columnas `*_ia` viven **siempre al lado** de las reales, nunca encima |
| `crm_etiquetas` | Catálogo. `grupo_id` nullable: NULL = aplica a todos los contratos. Siete sembradas |
| `crm_caso_etiquetas` | `origen` (`HUMANO` / `IA` / `REGLA`): una etiqueta que puso el modelo se ve distinta de una que puso una persona, y confirmarla la pasa a `HUMANO` |
| `crm_asignaciones` | Historial de a quién le toca, con el motivo de cada pase. `crm_casos.asignado_a` es el vigente, desnormalizado para que la bandeja no haga un LATERAL por fila |
| `crm_sla` | El reloj, con los minutos **congelados** con los que nació: cambiar un tope no re-calcula lo ya abierto |
| `crm_sla_reglas` | Los topes, parametrizables al estilo de `pqrs_plazos`, con cascada `default → tipo → contrato → contrato+tipo`. El eje es el **contrato**, no el cliente (§8.2 del complemento corrigiendo al ADR-02 §2.10) |

Dos vistas, porque **Supabase corta a los 8 segundos** y la bandeja es justo
donde eso muerde: `crm_resumen_bandeja` (los totales, agrupados) y `crm_bandeja`
(la fila ya resuelta, con el caso, su conversación, su reloj y sus etiquetas
agregadas en SQL — sin una consulta por fila).

**No se creó** `crm_envios`, `crm_envio_destinos` ni `crm_menu_opciones`: son de
F10. Hay una prueba que lo verifica contra el archivo de la migración.

---

## 4. El SLA en tiempo hábil, y cuándo se para el reloj

**El calendario de festivos no se duplicó.** Es `pqrs_dias_no_habiles`, el que
ya comparten PQRS y No conformes. `pqrs_sumar_habiles()` ya existía pero suma
días enteros, y un SLA de «4 horas hábiles» no se puede expresar en días: de ahí
`crm_sumar_habiles_min()` y `crm_minutos_habiles()`, que son la versión en
minutos **del mismo calendario**. Hay una prueba que quita un festivo y
comprueba que el plazo se adelanta.

### Cuándo se para el reloj — `pausado_min`

Esto es lo que más se presta a discusión, así que quedó escrito en el comentario
de la tabla y aplicado en la RPC, no en la pantalla:

- Se pausa cuando el caso pasa a **`EN_ESPERA`**, que significa una sola cosa:
  estamos esperando algo de la otra parte. Mientras eso no llegue, el tiempo no
  es imputable a la empresa.
- **No se puede pausar antes de la primera respuesta.** Para poder quedar
  esperando algo hay que haber escrito antes preguntándolo, y eso ya *es* la
  primera respuesta. Cierra la trampa de poner un caso «en espera» para que no
  venza: `crm_caso_estado()` lo rechaza.
- **Solo se pausa el reloj de resolución.** El de primera respuesta no se pausa
  nunca: contestar por primera vez no depende de nadie más.
- **Un reloj en pausa no puede quedar incumplido.** Si venciera igual, la pausa
  no serviría de nada. Lo respeta `crm_sla_barrer()`.
- Lo que estuvo parado se mide en **minutos hábiles**: un caso en espera del
  viernes a las 16:00 al lunes a las 9:00 estuvo parado **2 horas**, no 65.

El vencimiento es siempre `arranca_at + minutos_resolucion + pausado_min`, así
que reanudar no regala tiempo ni lo quita: lo corre.

### Dos implementaciones de la misma aritmética, y cómo no se separan

El reloj existe en SQL (porque la RPC calcula el plazo, y ese camino lo usa
también el bot con la llave de servicio) **y** en TypeScript (porque la bandeja
muestra «te quedan 3 horas hábiles» y no puede preguntarle a la base por cada
fila). Que haya dos es un riesgo real.

El seguro: **la tabla de casos vive en un solo archivo**,
`apps/inventario/lib/crm/casos-sla.json`. La prueba unitaria la corre contra
`lib/crm/sla.ts`; `scripts/verificar-crm-f11.mjs` corre **los mismos casos**
contra `crm_sumar_habiles_min()` y `crm_minutos_habiles()` en PostgreSQL. Si
alguien cambia una de las dos, el script de paridad lo dice.

---

## 5. El enganche con F9

El punto de enganche que dejó F9 era `avanzar()` en `lib/whatsapp/maquina.ts`.
Se usó exactamente como estaba previsto: las acciones **`DERIVAR_AGENTE`** y
**`AVISAR_SUPERVISOR`**, que antes solo escribían un evento en `ronda_eventos`,
ahora **abren un caso** llamando a `crm_caso_abrir()` desde `ejecutar()` en
`motor.ts`. No se tocó el webhook, ni la cola, ni la máquina.

Dos decisiones de ese enganche:

- **El evento de auditoría se sigue escribiendo igual.** `ronda_eventos` es la
  cadena de auditoría del módulo y no puede depender de que el CRM funcione: si
  `crm_caso_abrir` falla, el aviso no se pierde.
- **La prioridad la decide el motivo, no el modelo.** Avisar al supervisor nace
  `ALTA`; derivar porque la persona lo pidió nace `MEDIA`. Es determinista a
  propósito: la IA sugiere después, sobre el caso ya abierto.

`crm_caso_abrir()` es **idempotente y única por conversación**: si ya hay un
caso abierto sobre ese hilo, devuelve ese. Dos casos abiertos sobre la misma
conversación partirían el SLA en dos y nadie sabría cuál es el que vence.

La **primera respuesta** se marca con un trigger en `crm_mensajes`, no con un
`if` en la pantalla, porque la respuesta puede salir por tres caminos (la
consola, el bot, el envío de F10). Y un recordatorio automático del bot
(`iniciado_por = 'BOT'`) **no cuenta** como primera respuesta: avisar no es
atender, y si contara el SLA se cumpliría solo.

---

## 6. Permisos

Tres claves nuevas, planas, en el grupo **Operación Conserjería** de
`lib/permisos.ts`:

| Clave | Para qué |
|---|---|
| `ver_crm` | Leer la bandeja, los casos, su SLA y lo que sugirió la IA |
| `gestionar_crm` | Asignar, etiquetar, mover el estado y **aprobar** la respuesta |
| `parametrizar_crm` | Tocar las etiquetas y los topes de SLA |

`parametrizar_crm` va aparte porque cambiar un tope de SLA cambia el plazo de
todo lo que se abra después: es una decisión de contrato, no de la atención del
día.

Sembradas: `ver_crm` + `gestionar_crm` en Administrador, Gerencia y Supervisor
de Conserjería; `parametrizar_crm` en Administrador y Gerencia; `ver_crm` en
Auditor, que lee y no toca (el mismo criterio de PQRS y de WhatsApp).

**Las escrituras de casos, SLA y asignaciones no tienen política de RLS**:
entran por las funciones `SECURITY DEFINER`. Pero esas funciones, a diferencia
de las de F9, **sí se pueden llamar con la sesión del usuario**, y llevan un
guardián (`crm_exige_gestion()`) que exige el permiso **en la base** cuando hay
sesión. Sin sesión (el bot y el cron, con la llave de servicio) no frena, porque
ahí `auth.uid()` es NULL y `auth_permiso()` diría que no a todo; ese camino lo
guarda el route handler, igual que en F9.

Las lecturas usan `auth_permiso()` **y** alcance por contrato con
`auth_ve_grupo()`, con las llamadas envueltas en `(SELECT …)`:
`scripts/generar-rls-envuelta.mjs` sigue reportando **0 pendientes**.

---

## 7. Pantallas

- **`/rondas/crm`** — la bandeja. Cuatro pestañas: la cola, las sugerencias que
  esperan aprobación, las conversaciones sin caso y la parametrización
  (etiquetas y reglas de SLA). Todos los totales **contados en SQL**.
- **`/rondas/crm/[id]`** — el caso: la conversación, el reloj, lo que sugirió la
  IA y el botón que —y solo él— hace que una respuesta salga.

Tres decisiones de pantalla:

1. **El número de WhatsApp no se muestra completo**, igual que en F9. El
   buscador **sí** filtra por el número completo, a propósito, y el texto del
   buscador lo dice.
2. **Los dos valores conviven.** «Tipo: CONSULTA» con «sugerido:
   MANTENIMIENTO» debajo, nunca encima. Al confirmar, la marca pasa a
   «Confirmado por [persona] el [fecha]».
3. **Lo que la conversación dijo se lee tal cual**, incluso con las
   instrucciones dentro: eso es parte del caso. React escapa el contenido, así
   que no hay riesgo en la pantalla.

Realtime en `crm_casos` y `crm_mensajes`: un caso que abre el bot aparece sin
recargar.

---

## 8. Verificación

```bash
# El esquema y el comportamiento contra la base, en BEGIN…ROLLBACK (101 checks)
NODE_OPTIONS=--use-system-ca node scripts/verificar-crm-f11.mjs

# Las pruebas automáticas (102 de F11, 656 en todo el repo)
npx vitest run --project inventario

# Una conversación completa por el simulador de F9, que termina en un caso
NODE_OPTIONS=--use-system-ca node scripts/simular-crm-f11.mjs
NODE_OPTIONS=--use-system-ca node scripts/simular-crm-f11.mjs --limpiar

# La IA de verdad sobre ese caso (hace falta CRM_IA_ACTIVA=1 y una llave)
NODE_OPTIONS=--use-system-ca node scripts/probar-ia-crm-f11.mjs
NODE_OPTIONS=--use-system-ca node scripts/probar-ia-crm-f11.mjs --deepseek --no-aprobar
```

---

## 9. Decisiones que tomé con el criterio de los documentos

1. **Un caso abierto por conversación**, con índice único parcial. Dos casos
   abiertos sobre el mismo hilo partirían el SLA.
2. **El dominio de `tipo` es cerrado** (nueve valores). Es la primera defensa
   contra un mensaje con instrucciones: lo más que puede conseguir una inyección
   es un valor de esa lista en una columna de sugerencia.
3. **Las escrituras del catálogo (etiquetas y reglas) sí van por RLS**, con
   `parametrizar_crm`: es parametrización, no operación, y no hay máquina de
   estados que proteger.
4. **El cron del SLA va cada cinco minutos**, no cada minuto como los tres de
   F9. Los relojes de F9 son de minutos porque hay alguien parado en un punto
   esperando; un SLA que se marca incumplido cuatro minutos tarde no cambia nada
   para nadie.
5. **Una corrida nueva del modelo invalida la confirmación anterior**: lo que se
   había revisado ya no es lo que está guardado.
6. **Si entran mensajes después de que la IA redactó, aprobar el borrador tal
   cual se frena** y se desbloquea confirmando, no quitando el aviso. Mandarlo
   así sería contestar otra pregunta.
7. **Con DeepSeek la forma del JSON va en el prompt**, después del bloque de
   datos (nunca antes, para que un mensaje no pueda redefinirla). No admite
   `json_schema` estricto y además rechaza la petición con 400 si el prompt no
   menciona «json» — se descubrió probándolo.

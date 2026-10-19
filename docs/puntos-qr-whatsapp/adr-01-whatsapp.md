# ADR-01 — Conexión con WhatsApp para el módulo de Puntos QR

- **Estado:** propuesto (sin implementar). Fecha: 2026-10-19.
- **Alcance:** solo la **capa de transporte de WhatsApp**: cómo se conecta el número, cómo entran y salen los mensajes, y cómo se conversa una visita. El motor de ejecución de tareas, el modelo de datos de puntos/tareas/visitas y la pantalla web los define el plan general (`00-exploracion-y-plan.md`). La **validación de fotos, la detección de fraude y la transcripción de audio** las define `adr-02-antifraude-ia.md`; aquí solo se referencian.
- **Fuera de alcance:** cualquier línea de código, migración o cambio de esquema. Este documento es de decisión y diseño.
- **Versión de referencia de la API:** Graph API **v26.0** (publicada el 29 de julio de 2026, la más reciente según el [changelog de Graph API](https://developers.facebook.com/docs/graph-api/changelog)).

---

## 1. Decisión y alternativas descartadas

### 1.1 Decisión

1. **Única vía de WhatsApp: la API oficial de WhatsApp Business (Cloud API de Meta)**, consumida directamente contra `graph.facebook.com` o a través de un **proveedor oficial (BSP / Solution Partner)**. No se usa ningún otro mecanismo.
2. **La conexión del número se hace con Embedded Signup en modo Coexistencia** (`featureType: "whatsapp_business_app_onboarding"`). La empresa conecta el número que **ya usa en la app WhatsApp Business**: lo escribe en el flujo, confirma desde el teléfono y pega el **código de verificación** que la app le muestra. El número queda funcionando **a la vez** en la app y en la Cloud API, y lo que el personal responda desde el celular llega a la plataforma como eventos `smb_message_echoes` ([Onboard Business app users — Coexistence](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users)).
3. **El bot es una interfaz más sobre el mismo motor de ejecución** que usa la app móvil y la consola web. WhatsApp no tiene reglas de negocio propias: traduce mensajes a eventos del motor y respuestas del motor a mensajes.
4. **La evidencia se guarda siempre en infraestructura propia** (Supabase Storage). Lo que vive en Meta es temporal y se descarga de inmediato.

> **Precisión sobre “escanear un QR como WhatsApp Web”:** así lo describen los proveedores y así se vive en la práctica desde el teléfono, pero **la documentación oficial de Coexistencia describe un código de verificación**, no un QR: el flujo muestra un código, la empresa recibe un mensaje de la cuenta oficial de Facebook Business, toca **Conectar** → **Conectar a la Plataforma de Negocios**, confirma si comparte el historial y **pega el código** ([doc oficial](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users)). El diseño no debe depender de que la pantalla muestre un QR; debe depender de que el flujo lo abre Meta en una ventana y nos devuelve `waba_id`, `phone_number_id` y un código canjeable.

### 1.2 Alternativas descartadas

| Alternativa | Por qué se descarta | Consecuencia de descartarla |
|---|---|---|
| **Librerías no oficiales que emulan WhatsApp Web** (Baileys, whatsapp-web.js, venom, wppconnect y similares) | Automatizan el cliente de WhatsApp sin autorización de Meta. Los [Términos del Servicio de WhatsApp](https://www.whatsapp.com/legal/terms-of-service), en *Acceptable Use Of Our Services → Harm To WhatsApp Or Our Users*, prohíben acceder y usar el servicio “directly, indirectly, through automated or other means”, hacer ingeniería inversa y crear software o APIs “that function substantially the same as our Services”; y en *Availability And Termination Of Our Services* se reservan el derecho de “modify, suspend, or terminate your access to or use of our Services anytime for any reason”. La [Política de mensajes de WhatsApp Business](https://whatsappbusiness.com/es-la/policy/) añade que pueden limitar o eliminar el acceso y que “sancionamos las cuentas de WhatsApp Business que infringen la Política de mensajes”. En la práctica: Meta puede **bloquear el número y la cuenta**, sin aviso y sin apelación útil. Para una empresa que usa ese mismo número con clientes y con 6.000+ personas de nómina, perder el número es un incidente operativo mayor. Además no hay SLA, no hay webhooks firmados, no hay plantillas, y cada actualización de WhatsApp puede romper la integración. | Se pierde la tentación de “conectar gratis en 10 minutos”. Hay que pasar por verificación del portafolio de negocios, revisión de app y aprobación de plantillas. Se acepta ese costo. |
| **Un número nuevo dedicado al bot** (sin coexistencia) | Técnicamente es más simple y sube el throughput de 20 a 80 mps. Pero obliga a que cada conserje agregue otro contacto y a que la empresa mantenga dos números; y el número que la gente ya conoce seguiría sin verse en la plataforma. | Queda como **plan B documentado** (§10, riesgo R-3): si Coexistencia falla o se bloquea, se registra un número nuevo con el flujo normal de Embedded Signup y se pierde el eco de la app. |
| **Solo la app móvil propia (Capacitor), sin WhatsApp** | Es lo que ya existe en `apps/movil` y sigue siendo el canal principal. Pero obliga a instalar una app en el celular personal del conserje, a actualizarla y a que haya espacio y permisos. WhatsApp ya está instalado y es donde la gente escribe. | WhatsApp se diseña como canal **complementario y degradado**: siempre hay menos control que en la app propia (ver §1.3 y `adr-02`). La app propia sigue siendo la vía recomendada donde haya equipo. |
| **SMS / llamadas / IVR** | Sin fotos, sin audio, sin ubicación interactiva, sin listas. No sirve para evidencia. | — |
| **Telegram u otro mensajero** | Mejor API, pero no es donde está la gente en Colombia y no resuelve el requisito de “el número que ya usamos”. | — |

### 1.3 Consecuencias de la decisión (las que condicionan todo el diseño)

| Límite | Qué dice la fuente | Consecuencia de diseño |
|---|---|---|
| **Grupos** | Con Coexistencia los chats de grupo **no se sincronizan** y las herramientas de negocio (catálogo, pedidos, estado) **no están soportadas** ([Coexistence · Limitations](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users)) | **Todo es 1 a 1.** No hay “grupo del conjunto” ni “grupo de la ronda”. Un aviso a varias personas son N conversaciones individuales. Las listas de difusión quedan en solo lectura. |
| **Ubicación en tiempo real** | “Live location messages will be disabled for all individual (1:1) chats” (misma fuente) | **No hay rastreo continuo por WhatsApp.** La ubicación se pide **puntual**, una vez por hito (`location_request_message`), y se compara contra la geocerca en ese instante. El rastreo continuo, si se quiere, es de la app propia. |
| **Metadatos EXIF de las fotos** | Meta **no documenta** esto en su API. La evidencia es forense: enviar una foto en modo imagen reduce el archivo 40–80 % y pierde geolocalización, datos del dispositivo y software de edición; enviada *como documento* conserva los metadatos ([Soni, *Forensic Value of Exif Data*, Perspectives in Legal and Forensic Sciences](https://www.sciepublish.com/article/pii/567)) | **No se puede verificar hora ni GPS desde la foto.** La prueba de “cuándo” es el `timestamp` del webhook y el sello del servidor; la de “dónde” es el mensaje de ubicación aparte. Y WhatsApp **permite mandar una foto de la galería**: no existe un “solo cámara” como en la app propia. Esto es un hueco de antifraude real → lo trata `adr-02` (reto visual, marca de agua pedida en el instante, consistencia entre ubicación y foto). |
| **Rendimiento ~20 mensajes por segundo** | “Numbers used with both the WhatsApp Business app and Cloud API have a fixed throughput of 20 mps” ([Throughput](https://developers.facebook.com/documentation/business-messaging/whatsapp/throughput)); el default de Cloud API es 80 mps y hasta 1.000 mps en números elegibles, pero **ese camino no existe para un número en coexistencia** | Toda la salida pasa por una **cola con control de caudal** a 20 mps (se trabaja a ~15 mps para dejar margen). Un aviso masivo a 800 personas tarda ~1 minuto, no es instantáneo. El error a manejar es `130429` (rate limit). |
| **Ventana de 24 horas** | La ventana de atención “opens and resets with each user message”; los mensajes que no son plantilla “can only be used to respond - not reach out - to users” ([Non-template messages](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing/non-template-messages)). Y en coexistencia, **los mensajes enviados desde la app no abren ni afectan la ventana** ([Coexistence](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users)) | Todo mensaje del bot que no sea respuesta inmediata necesita **plantilla aprobada** (§8). Los temporizadores de la máquina de estados son **cortos** (minutos), para que la respuesta siempre caiga dentro de la ventana. |
| **Llamadas de voz y video** | No soportadas en coexistencia (misma fuente) | “Hablar con supervisor” no transfiere una llamada: abre un caso y notifica por los canales que ya existen. |
| **Dispositivos vinculados** | Hasta 4 dispositivos acompañantes; WhatsApp para Windows y WearOS no soportados; **todos los acompañantes se desvinculan al hacer el onboarding** (misma fuente) | Hay que avisarle a quien administre el número: después de conectar, tendrá que volver a vincular WhatsApp Web / Escritorio. |

---

## 2. Onboarding del número

### 2.1 Qué hace la empresa (paso a paso)

Precondiciones de Meta ([Coexistence · Eligibility](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users)):

- La app **WhatsApp Business** en el teléfono debe estar en versión **2.24.17 o superior**.
- Hay que ser **Solution Partner o Tech Provider** de Meta (o usar un BSP que ya lo sea).
- El webhook propio debe estar **arriba y procesando** antes de empezar.
- El flujo debe usar Embedded Signup **con session logging**.

Pasos:

1. En la consola (`/configuracion/whatsapp`, pantalla nueva) un usuario con el permiso `whatsapp.conectar` pulsa **Conectar WhatsApp**. Se abre la ventana de Embedded Signup de Meta (Facebook Login for Business + SDK de JS).
2. La persona autentica con sus credenciales de Meta Business y **acepta los términos** (Cloud API, WhatsApp Business, Meta, Marketing Messages Lite API y Meta Business Tool Terms).
3. Elige **conectar una cuenta de WhatsApp Business existente** (esta opción aparece en lugar de la selección de cuenta cuando el `featureType` es el de coexistencia; si no aparece, el `featureType` está mal puesto).
4. Escribe el número que ya usa en la app. Meta muestra un **código de verificación**.
5. En el teléfono: llega un mensaje de la cuenta oficial de Facebook Business → **Conectar** → **Conectar a la Plataforma de Negocios** → **Confirmar** si comparte el historial de chats.
6. Pega el código en la ventana. **La app debe quedarse abierta** mientras sincroniza.
7. Al terminar, el evento de sesión llega con `event = FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING` y la ventana devuelve `waba_id`, `phone_number_id` y un **código canjeable** (*exchangeable token code*).

Lo que el servidor hace enseguida (todo servidor a servidor):

1. **Canjea el código** por un *business token* (Business Integration System User token).
2. **NO registra el número.** La documentación es explícita: en coexistencia se **salta** el paso de registro porque el número ya está registrado.
3. **Suscribe la app a los webhooks** de la cuenta de mensajería (`waba_id`).
4. **Sincroniza contactos e historial** con la SMB App Data API (`sync_type` = `smb_app_state_sync` y `history`). Hay **24 horas** desde el onboarding para hacerlo y **cada sincronización se puede correr una sola vez**; si se pasa el tiempo, la empresa tiene que desconectar y repetir todo el flujo.
5. **Verifica el estado** pidiendo `is_on_biz_app` y `platform_type` sobre el `phone_number_id`: se espera `true` y `CLOUD_API`.

> Ojo con el calendario: **las versiones 2 y 3 de Embedded Signup quedan obsoletas el 15 de octubre de 2026** y hay que migrar a la **v4** ([Embedded Signup](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/overview)). El ejemplo oficial de coexistencia aún usa `sessionInfoVersion: "3"`, así que **al implementar hay que confirmar el valor vigente para v4** antes de fijarlo.

### 2.2 Permisos y revisión de app que pide Meta hoy

Según la página oficial de [Permisos](https://developers.facebook.com/documentation/business-messaging/whatsapp/permissions):

| Permiso | Para qué | ¿Nos hace falta? |
|---|---|---|
| `whatsapp_business_messaging` | Enviar mensajes de cualquier tipo y recibir los webhooks de mensajes y de estado | **Sí** |
| `whatsapp_business_management` | Metadatos de la cuenta de mensajería, gestión de plantillas, números de teléfono, analíticas y webhooks de cambios de cuenta | **Sí** |
| `business_management` | Acceso programático al portafolio de negocios | **No** (“rara vez necesario”, Meta Business Suite lo cubre). Solo lo exigen los Solution Partners para compartir línea de crédito |
| `whatsapp_business_manage_events`, `ads_read` | Eventos y métricas de conversión de la Marketing Messages API | **No** (no hay marketing en este módulo) |

Revisión de app:

- Si la app accede a datos de **cuentas que no son del propio negocio** (que es el caso de Coexistencia, porque la cuenta es de la empresa cliente y se comparte con nuestra app), hace falta **App Review con acceso avanzado para cada permiso**. Sin acceso avanzado, el permiso **no aparece como otorgable** en Embedded Signup y las llamadas devuelven el error `200`.
- En modo desarrollo los permisos solo se ven para usuarios con rol admin, developer o tester; en modo live solo aparecen los aprobados.
- Un *developer directo* que solo toca su propia cuenta **no necesita App Review**: le basta un token de usuario del sistema.

**Decisión práctica:** hay dos rutas y la escogencia no es técnica sino de tiempos.

- **Ruta A — directo con Meta:** hay que ser Tech Provider y pasar App Review para `whatsapp_business_messaging` y `whatsapp_business_management`. Más control, más trámite.
- **Ruta B — por un BSP** (p. ej. 360dialog, Infobip, Twilio, Gupshup): el BSP ya es Tech Provider y ya tiene el acceso avanzado; nosotros usamos su Embedded Signup y su proxy de API. Arranca en días en vez de semanas, a cambio de un costo por mensaje y una dependencia.
- **Recomendación:** empezar por **B** para la prueba piloto y dejar la capa de transporte detrás de una interfaz (`lib/whatsapp/cliente.ts`) con dos implementaciones, para poder pasar a **A** sin tocar el motor. El ADR no cierra esta decisión: queda en §10 como pendiente **P-1**.

### 2.3 Qué queda guardado

Nada de esto existe todavía en el esquema; lo crea la migración del módulo (no este ADR).

| Tabla | Para qué | Campos clave |
|---|---|---|
| `wa_cuentas` | Una fila por número conectado (hoy uno; el diseño admite varios) | `waba_id`, `phone_number_id`, `display_phone_number`, `nombre_visible`, `platform_type` (`CLOUD_API`), `is_on_biz_app` (bool), `coexistencia` (bool), `throughput_mps` (20), `conectado_en`, `conectado_por`, `estado` (`ACTIVA` / `SUSPENDIDA` / `DESCONECTADA`) |
| `wa_credenciales` | Los tokens, separados de la cuenta para poder rotarlos y auditarlos | `cuenta_id`, `tipo` (`BUSINESS_TOKEN` / `SYSTEM_USER`), `token_cifrado`, `scopes[]`, `expira_en` (nullable), `debug_token_revisado_en`, `estado` |
| `wa_sincronizaciones` | Rastro del `smb_app_state_sync` y del `history` (una sola vez cada uno) | `cuenta_id`, `tipo`, `pedida_en`, `terminada_en`, `mensajes_recibidos`, `error` |

**Los tokens no van en variables de entorno.** El *business token* es por cliente y se obtiene en tiempo de ejecución desde Embedded Signup: vive en `wa_credenciales`, cifrado, y solo lo lee el servidor con `SUPABASE_SERVICE_ROLE_KEY` (nunca desde el navegador, nunca en una tabla con RLS de lectura abierta). En el entorno viven únicamente los secretos de la **app de Meta**, que son los mismos para todos los clientes (§2.5).

### 2.4 Cómo se renuevan los tokens

Lo que dice la [documentación de tokens de acceso](https://developers.facebook.com/documentation/business-messaging/whatsapp/access-tokens):

- **Business Integration System User token** (el nuestro, por Embedded Signup): su ventaja declarada es que funciona sin intervención del usuario y **evita “requiring future re-authentication”**. Meta **no publica un período de expiración** en esa página y remite al ciclo de vida de Facebook Login for Business.
- **System user token** (si algún día se opera como developer directo): es de larga vida y al generarlo se **elige una preferencia de expiración**.
- **User access token**: “expire quickly, so you have to keep generating a new one every few hours”. **Prohibido** en producción; solo para la primera prueba manual.
- Los tokens deben guardarse como **cadenas opacas de longitud variable**: nada de validar formato ni de recortarlos.

Política que se adopta, sin suponer lo que Meta no dice:

1. **Chequeo diario** con `GET /debug_token` desde el cron (`/api/cron/whatsapp-salud`): se lee `expires_at`, `data_access_expires_at` y `scopes`, y se escriben en `wa_credenciales`.
2. **Alertas escalonadas:** a 30, 14 y 3 días de `expires_at` (si viene con valor) se abre un ticket de soporte y se avisa por el módulo de notificaciones por correo que ya existe. Si `expires_at` es `0`/ausente, se vigila que `scopes` siga trayendo los dos permisos y que las llamadas no devuelvan `190` (token inválido).
3. **Degradación limpia:** ante `190` o pérdida de permisos, la cuenta pasa a `SUSPENDIDA`; la cola de salida **se detiene y no se descarta** (los mensajes quedan `EN_ESPERA_CREDENCIAL`), el webhook **sigue recibiendo y guardando** (eso no necesita token, solo firma), y en la consola sale un aviso con el botón **Reconectar**.
4. **Reconexión:** se vuelve a correr Embedded Signup. Si la empresa había sido desconectada por un partner anterior, existe el flujo oficial de [reconexión de clientes de coexistencia desconectados](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/reconnect-offboarded-coexistence-clients).
5. **Nunca** se escribe un token en logs, en mensajes de error devueltos al cliente, ni en este repositorio (que es público).

### 2.5 Configuración, con valores de ejemplo

Variables de entorno de `apps/inventario` (todos los valores son **de ejemplo**):

```bash
# App de Meta (iguales para todos los clientes) ───────────────────────────────
WHATSAPP_APP_ID="1234567890123456"
WHATSAPP_APP_SECRET="00000000000000000000000000000000"      # firma X-Hub-Signature-256
WHATSAPP_WEBHOOK_VERIFY_TOKEN="cambie-esto-por-algo-aleatorio-de-48-chars"
WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID="987654321098765"        # configuración del flujo
WHATSAPP_EMBEDDED_SIGNUP_FEATURE_TYPE="whatsapp_business_app_onboarding"
WHATSAPP_GRAPH_BASE_URL="https://graph.facebook.com"
WHATSAPP_API_VERSION="v26.0"

# Transporte: "META" (directo) o "BSP" (proveedor oficial) ────────────────────
WHATSAPP_TRANSPORTE="BSP"
WHATSAPP_BSP_BASE_URL="https://ejemplo-bsp.invalid/v1"
WHATSAPP_BSP_API_KEY="bsp-llave-de-ejemplo"

# Operación ──────────────────────────────────────────────────────────────────
WHATSAPP_THROUGHPUT_MPS="15"                 # tope propio; el del número es 20
WHATSAPP_VENTANA_SEGURIDAD_HORAS="23"        # margen sobre la ventana de 24 h
WHATSAPP_JORNADA_FALLBACK="06:00-20:00"      # cuando no hay turno programado
WHATSAPP_ZONA_HORARIA="America/Bogota"
WHATSAPP_BUCKET_EVIDENCIA="puntos-qr-evidencia"
WHATSAPP_SIMULADOR="0"                       # 1 = no sale nada hacia Meta (§9)
CRON_SECRET="ya-existe-en-el-proyecto"
```

Lo que **no** es variable de entorno: `waba_id`, `phone_number_id` y los tokens de la empresa. Esos se guardan en `wa_cuentas` / `wa_credenciales` cuando termina Embedded Signup. Valores de ejemplo para la documentación y las pruebas: `waba_id = "102290129340398"`, `phone_number_id = "106540352242922"`, `display_phone_number = "+57 601 000 0000"`.

---

## 3. Webhook

### 3.1 Rutas propuestas

| Ruta | Método | Qué hace | `maxDuration` |
|---|---|---|---|
| `apps/inventario/app/api/whatsapp/webhook/route.ts` | `GET` | Reto de suscripción de Meta | 10 s |
| | `POST` | Verifica firma, guarda el evento, encola y responde `200`. **No procesa nada.** | 10 s |
| `apps/inventario/app/api/whatsapp/embedded-signup/intercambiar/route.ts` | `POST` | Canjea el código por el *business token*, crea `wa_cuentas`, suscribe webhooks, dispara las sincronizaciones | 60 s |
| `apps/inventario/app/api/cron/whatsapp-entrada/route.ts` | `GET` | Trabajador de la cola de entrada: baja medios, corre la máquina de estados | 60 s |
| `apps/inventario/app/api/cron/whatsapp-salida/route.ts` | `GET` | Trabajador de la cola de salida, con control de caudal a ≤20 mps | 60 s |
| `apps/inventario/app/api/cron/whatsapp-vencimientos/route.ts` | `GET` | Temporizadores de la máquina de estados (§4) y cierre de jornada (§7) | 60 s |
| `apps/inventario/app/api/cron/whatsapp-salud/route.ts` | `GET` | `debug_token`, `is_on_biz_app`, métricas | 60 s |

Los cuatro crons siguen la convención que ya usa el proyecto en `app/api/cron/correo/route.ts`: `runtime = 'nodejs'`, `maxDuration = 60` y exigencia de `Authorization: Bearer ${CRON_SECRET}`. Se registran en `vercel.json` junto a los dos que ya hay (`*/5 * * * *` hoy; para WhatsApp se pide **cada minuto**, `* * * * *`, porque los temporizadores son de minutos).

> El endpoint público es solo `/api/whatsapp/webhook`. Conviene además excluirlo del Firewall/BotID y de cualquier protección de despliegue, porque Meta no puede autenticarse: la autenticación es la firma.

### 3.2 Reto de suscripción (`GET`)

Meta manda un `GET` cada vez que se fija o edita la Callback URL o el Verify token en el App Dashboard, con ([Create a webhook endpoint](https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/create-webhook-endpoint)):

- `hub.mode=subscribe`
- `hub.challenge` — cadena aleatoria
- `hub.verify_token` — la cadena que nosotros elegimos

Regla: si `hub.mode === 'subscribe'` **y** `hub.verify_token === WHATSAPP_WEBHOOK_VERIFY_TOKEN` (comparación en tiempo constante), se responde **`200` con el `hub.challenge` crudo en el cuerpo, como texto plano**. Si no, `403`. Meta marca el endpoint como verificado **solo** cuando recibe un `200` con el reto, y **no manda ningún webhook hasta entonces**.

### 3.3 Verificación de la firma `X-Hub-Signature-256` (`POST`)

Meta manda `Content-Type: application/json`, `Content-Length` y `X-Hub-Signature-256: sha256=<hash>`. La verificación es HMAC-SHA256 del **cuerpo** con el **app secret** como llave, comparado con lo que va después de `sha256=` (misma fuente).

Reglas de implementación que importan:

1. **Sobre el cuerpo crudo, byte a byte.** En App Router: `const crudo = await req.text()` y recién después `JSON.parse(crudo)`. Nunca re-serializar: cualquier diferencia de escapes o de orden de llaves cambia el hash. La documentación no afirma explícitamente que sea sobre los bytes recibidos, pero como el hash tiene que coincidir con el que firmó Meta, hacerlo antes de parsear es lo único seguro.
2. **Comparación en tiempo constante** (`crypto.timingSafeEqual`) y con longitudes ya igualadas.
3. Sin header, con firma mala o sin `WHATSAPP_APP_SECRET` configurado → **`403`**, se registra en `wa_eventos_rechazados` (`ip`, `motivo`, `recibido_en`, sin el cuerpo completo) y **no se encola nada**.
4. El cuerpo puede pesar **hasta 3 MB** ([Set up webhooks](https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/overview)), cómodamente por debajo del tope de 4,5 MB de cuerpo de una función de Vercel ([Vercel Functions Limits](https://vercel.com/docs/functions/limitations)).

### 3.4 Idempotencia por `message_id`

Hace falta porque Meta lo dice de dos maneras:

- “If a POST fails, Meta retries immediately, then several more times over the next 7 days at decreasing frequency… your server should deduplicate events”.
- Los reintentos van **a todas las apps suscritas** a la cuenta de mensajería, así que pueden llegar duplicados.
- Un `POST` puede venir **agrupado con hasta 1.000 actualizaciones**, y el agrupamiento no está garantizado: hay que tratar cada `POST` por separado.
- **No hay API para consultar webhooks históricos**: lo que no guardemos, se pierde.

Diseño:

| Tabla | Campos |
|---|---|
| `wa_eventos` | `id`, `cuenta_id`, `wamid` (**UNIQUE**, el `messages[].id` tipo `wamid.HBgL…`), `tipo_campo` (`messages` / `smb_message_echoes` / `statuses` / `history` / …), `wa_id`, `timestamp_meta`, `payload jsonb`, `firma_ok`, `recibido_en`, `procesado_en`, `intentos`, `ultimo_error`, `estado` (`PENDIENTE` / `PROCESADO` / `DESCARTADO` / `ERROR`) |

- Inserción con `ON CONFLICT (wamid) DO NOTHING`. **Si choca, ya lo vimos: se responde `200` igual** y no se vuelve a procesar.
- Para los eventos sin `wamid` (p. ej. `statuses`, `account_update`) la llave de deduplicación es `sha256(tipo_campo || payload normalizado)`.
- Un `POST` agrupado se descompone en N filas en una sola transacción.
- Los `statuses` (`sent` / `delivered` / `read` / `failed`) actualizan `wa_mensajes_salida` por `wamid`, y son **idempotentes por diseño**: nunca se retrocede de `read` a `sent`.
- **Orden no garantizado.** Los reintentos pueden llegar desordenados, así que el motor ordena por `timestamp_meta` dentro de cada conversación y el trabajador toma **un `wa_id` a la vez** con `pg_try_advisory_xact_lock(hashtext(wa_id))`. Así dos invocaciones concurrentes del cron no pisan la misma visita.
- Un evento **más viejo que el estado actual de la visita** no retrocede la máquina: se guarda con `estado = DESCARTADO` y el motivo.

### 3.5 Descarga inmediata de los medios

El reloj corre y corre rápido ([Media](https://developers.facebook.com/documentation/business-messaging/whatsapp/business-phone-numbers/media)):

- Se pide `GET /{MEDIA_ID}` y la respuesta trae `url`. **Esa URL vale 5 minutos.** Después hay que volver a pedir el ID.
- Para bajar el archivo **hay que mandar el token en el header `Authorization`**: “If you omit your token, the request will fail”. Un `404` significa URL vencida → pedir una nueva; si vuelve a fallar, renovar el token.
- Los **IDs de medios que llegan por webhook expiran a los 7 días** (los que devuelve la API, a los 30).
- Tamaños: imagen 5 MB, audio 16 MB, video 16 MB, documento 100 MB; un entrante de más de 100 MB da `131052`.

Flujo:

1. El trabajador de entrada detecta `image` / `audio` / `video` / `document` y encola una tarea `wa_descargas` con `media_id`, `mime_type`, `sha256` (WhatsApp lo manda en el payload) y `visita_id`.
2. Pide la URL, baja el archivo con el `Authorization` y lo **sube en streaming** a Supabase Storage, bucket `puntos-qr-evidencia`, ruta `visita/{visita_id}/{hito}/{wamid}.{ext}` — por ejemplo `visita/8f21.../foto_inicio/wamid.HBgL….jpg`.
3. Verifica el `sha256` recibido contra el calculado; si no cuadra, queda `INTEGRIDAD_DUDOSA` y se avisa (lo consume `adr-02`).
4. Guarda en `wa_medios`: `wamid`, `media_id`, `bucket`, `path`, `mime_type`, `bytes`, `sha256`, `descargado_en`, `vence_el` (= `recibido_en + 7 días`, para saber cuándo ya no hay segunda oportunidad).
5. **La consola y el PDF nunca referencian la URL de Meta.** Sirven URLs firmadas de **120 segundos** (`createSignedUrl(path, 120)`), que es lo que ya se usa en `gestion-humana/documentos` y `plantillas`. Para el paquete PDF del reporte, 1800 s, como en `postulaciones/expediente`.
6. Reintentos de descarga: 3 intentos con espera 5 s / 30 s / 120 s, todos dentro de la ventana de 7 días del `media_id`. Si se agotan, la visita **no se bloquea**: queda la novedad `EVIDENCIA_NO_DESCARGADA` con el `wamid`, y el bot le pide la foto otra vez a la persona.

### 3.6 Cómo se evita que una función de Vercel se quede corta

Los números de la plataforma ([Vercel Functions Limits](https://vercel.com/docs/functions/limitations)): duración **por defecto 300 s**; máximo 300 s en Hobby, **800 s** en Pro/Enterprise y 1.800 s en beta extendida; al pasarse, `504 FUNCTION_INVOCATION_TIMEOUT`; cuerpo de petición y respuesta **4,5 MB**.

Aunque 300 s suena holgado, el webhook **no puede** gastarse eso: Meta reintenta si no recibe `200`, y un reintento mientras todavía procesamos el primero genera trabajo duplicado. La regla es dura:

> **El `POST` del webhook hace tres cosas y responde: verificar la firma, insertar en `wa_eventos`, responder `200`.** Objetivo: menos de 300 ms. Nada de llamadas a Meta, nada de descargas, nada de IA, nada de PDF.

Lo que se procesa de forma asíncrona:

| Trabajo | Dónde | Por qué no va en el webhook |
|---|---|---|
| Descarga de medios y subida a Storage | `cron/whatsapp-entrada` | Hasta 100 MB; 1–20 s por archivo |
| Transcripción de notas de voz | `cron/whatsapp-entrada` → `/api/ia/transcribe` (ya existe) | Segundos, y depende de un tercero |
| Validación de fotos / antifraude | `cron/whatsapp-entrada` → ver `adr-02` | Puede ser lento y puede fallar |
| Máquina de estados y respuesta del bot | `cron/whatsapp-entrada` → encola en `wa_mensajes_salida` | Debe poder reintentarse sin re-recibir el webhook |
| Envío a Meta con caudal ≤20 mps | `cron/whatsapp-salida` | Un lote grande no cabe en una invocación |
| Generación del reporte PDF y creación de tickets | `cron/whatsapp-entrada` (al cerrar) | Puede tardar |

Mecanismos concretos:

1. **Cola en la base de datos**, no en memoria: `wa_eventos` (entrada), `wa_mensajes_salida` (salida), `wa_descargas` (medios). Sobreviven a un reinicio, a un despliegue y a un `504`.
2. **Disparo inmediato sin bloquear la respuesta:** después de responder, se usa `after()` de Next.js (o `waitUntil` de `@vercel/functions`) para invocar el trabajador. Si ese disparo se pierde, **el cron de cada minuto lo recoge**: el camino lento es la garantía, el disparo inmediato es solo latencia.
3. **Lotes acotados por tiempo, no por cantidad:** cada trabajador corre con un presupuesto de 50 s (sobre `maxDuration = 60`) y, al agotarlo, sale ordenadamente dejando lo pendiente en la cola. Ese patrón ya está en `procesarCorreoSaliente(supabase, 50)`.
4. **Reclamo con bloqueo:** `UPDATE … SET estado='EN_PROCESO', tomado_en=now() WHERE id IN (SELECT … FOR UPDATE SKIP LOCKED LIMIT n)`. Nada se procesa dos veces en paralelo; lo que lleve más de 5 minutos en `EN_PROCESO` se considera huérfano y vuelve a `PENDIENTE`.
5. **Reintentos con retroceso** por fila (`intentos`, `proximo_intento_en`): 1 min, 5 min, 15 min, 1 h, 6 h; a los 5 fallos queda `ERROR` y abre ticket de soporte.
6. Si el volumen crece, la salida natural es **Vercel Queues** o Vercel Workflow (sin límite de duración) sin cambiar el motor: la interfaz es “encolar / tomar un lote”.

### 3.7 Qué hacer cuando Meta reintenta

| Situación | Respuesta |
|---|---|
| Firma válida y `wamid` nuevo | Insertar, `200` |
| Firma válida y `wamid` ya existe | **`200`** sin procesar. No es un error: es el reintento haciendo su trabajo |
| Firma inválida | `403`, registrar, **no** encolar. Meta reintentará y seguirá dando `403`; eso es lo correcto |
| Nuestra base caída o la inserción falla | **`500`** a propósito, para que Meta reintente (tiene 7 días). Nunca `200` sobre un evento que no quedó guardado |
| Lote de 1.000 actualizaciones | Descomponer e insertar en una transacción; si no cabe en el presupuesto de tiempo, `500` y que reintente |
| 7 días sin que podamos recibir | El evento se pierde para siempre y **no hay API para recuperarlo**. Por eso la caída del webhook es incidente P1 y hay alerta sobre `wa_eventos` sin filas nuevas por más de 30 minutos en jornada |

---

## 4. Máquina de estados de una visita por WhatsApp

### 4.1 Reglas transversales

- **Todo mensaje del bot pasa por el portero.** Antes de encolar se evalúa, en este orden: (1) ¿hay ventana de 24 h abierta? (2) ¿estamos en jornada? (3) ¿hay consentimiento vigente para lo que se va a pedir? Si alguna falla, el mensaje **no se manda** y queda registrado con el motivo (`OMITIDO_VENTANA`, `OMITIDO_JORNADA`, `OMITIDO_CONSENTIMIENTO`).
- **Ventana de 24 h:** se envía como mensaje libre solo si `now() - ultimo_entrante < WHATSAPP_VENTANA_SEGURIDAD_HORAS` (23 h, 1 h de margen). Fuera de eso hace falta **plantilla aprobada** (§8). Como los temporizadores de abajo son de minutos, en la práctica la ventana siempre está abierta durante una visita; el caso raro es un recordatorio que se dispara después de un silencio largo.
- **Ubicación:** siempre **puntual** (`location_request_message`). No hay tiempo real (§1.3). El webhook trae `location.latitude`, `location.longitude` y, si la persona quiso, `name` y `address`; además `context.id` trae el ID del mensaje de solicitud, así que la respuesta se puede casar con la pregunta ([Location request messages](https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/location-request-messages)).
- **Listas:** `interactive` tipo `list`, con **máximo 10 secciones y máximo 10 filas en total**; título de fila 24 caracteres, descripción 72, texto del botón 20, `id` de fila hasta 200 ([Interactive list messages](https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/interactive-list-messages)). Con más de 9 tareas se usa la fila 10 como **“Ver más tareas ▸”** con `id = pag:2`.
- **Botones:** `interactive` tipo `button`, **máximo 3**, título de 20 caracteres ([Reply buttons](https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/interactive-reply-buttons-messages)).
- **Todo queda registrado.** Cada transición escribe en `visitas_eventos`: `visita_id`, `estado_anterior`, `estado_nuevo`, `disparador` (`wamid` entrante, `boton`, `temporizador`, `comando`), `wamid_salida`, `payload jsonb`, `ocurrido_en` (hora del servidor, `America/Bogota` para mostrar), `canal = 'WHATSAPP'`.
- **Un caso por visita.** Al identificar el punto se abre un caso (el mismo tipo de caso de `/mantenimiento` y `/equipo`, con chat y actividades), para que supervisión vea la visita en curso desde la consola y pueda escribir ahí.
- **Reintentos de la persona:** cada estado de espera admite **2 reintentos** antes de pasar al estado de error correspondiente.

### 4.2 Estados

Los nueve del flujo feliz: `SIN_VISITA` → `PUNTO_IDENTIFICADO` → `UBICACION_VALIDADA` → `FOTO_INICIO_OK` → `EN_EJECUCION` → `FOTO_FIN_OK` → `RESUMEN` → `CONFIRMADA` → `CERRADA`.

Y los de espera y error, sin los cuales esto no se puede implementar:

| Estado | Cuándo |
|---|---|
| `ESPERA_IDENTIDAD` | El número no está en `canal_contacto` o no está verificado (§5) |
| `ESPERA_CONSENTIMIENTO` | Falta aceptar un consentimiento vigente (§5) |
| `ERROR_UBICACION` | Fuera de la geocerca, o 3 intentos sin ubicación válida |
| `ERROR_FOTO` | 3 intentos sin foto utilizable, o la descarga falló |
| `ESPERA_AGENTE` | Derivado a una persona (supervisor o gestión humana) |
| `EN_ESPERA_FUERA_DE_JORNADA` | Se cerró la jornada con la visita a medias (§7) |
| `EXPIRADA` | Venció un temporizador final sin respuesta |
| `CANCELADA` | La persona escribió `CANCELAR` |
| `CERRADA_CON_NOVEDAD` | Cerró pero quedó evidencia faltante o tareas sin hacer |

### 4.3 Transiciones

Formato de cada fila: **mensaje del bot** · **qué espera** · **cuánto espera** · **qué pasa al vencer** · **qué queda registrado**.

#### T1. `SIN_VISITA` → `PUNTO_IDENTIFICADO` — identificación del punto

Tres entradas válidas:

- **(a) Texto con el código:** `PUNTO K7M-4QX9` (también `punto k7m4qx9`, sin guion y sin mayúsculas; se normaliza quitando todo lo que no sea `[A-Z0-9]` y se valida contra `puntos.codigo`).
- **(b) Enlace del QR:** el QR impreso apunta a `https://<app>/q/K7M-4QX9`, y esa página ofrece el botón **“Reportar por WhatsApp”** que abre `https://wa.me/<numero>?text=PUNTO%20K7M-4QX9`. Así el QR sirve igual para la app propia (que lo abre nativo) y para WhatsApp, y el texto que llega al bot es el mismo del caso (a). *No* se usa un QR que apunte directo a `wa.me`, para que el punto pueda redirigir a la app si está instalada.
- **(c) Lista:** cualquier mensaje suelto (`hola`, `buenas`) en `SIN_VISITA` con identidad verificada responde con la lista de puntos asignados para hoy.

| | |
|---|---|
| **Mensaje del bot (a/b)** | “Punto **K7M-4QX9 — Portería principal, Torre 2**. Sede: *Conjunto Ejemplo*. ¿Empezamos la visita?” + botones `Sí, empezar` / `No es este punto` / `Ayuda` |
| **Mensaje del bot (c)** | Lista: header “Tus puntos de hoy”, body “Elegí el punto donde estás. Si no aparece, escribí el código del QR (por ejemplo PUNTO K7M-4QX9).”, botón `Ver puntos`, secciones por sede, hasta 9 filas + “Ver más tareas ▸” |
| **Qué espera** | `interactive.button_reply.id = punto:K7M-4QX9:si` o `interactive.list_reply.id = punto:K7M-4QX9` |
| **Cuánto espera** | 10 min |
| **Al vencer** | No se manda nada (ya hubo una interacción, no hay nada urgente). La visita no se crea; queda `SIN_VISITA` |
| **Queda registrado** | `visitas` nueva en `PUNTO_IDENTIFICADO` con `punto_id`, `persona_id`, `canal='WHATSAPP'`, `iniciada_en`, `wamid_inicio`, `origen` (`TEXTO` / `QR` / `LISTA`); apertura del **caso** vinculado; evento `PUNTO_IDENTIFICADO` |

Errores de esta transición: código inexistente → “No encontré el punto **K7M-4QX9**. Revisá el código del adhesivo (son 8 caracteres) o escribí **MIS PUNTOS**.”; punto que no le corresponde → “Ese punto está en *otra sede*. ¿Querés reportarlo igual como novedad?” + botones `Sí, novedad` / `Ver mis puntos`; visita ya abierta en otro punto → “Tenés la visita del punto **A1B-2C3D** sin cerrar. ¿Qué hacemos?” + botones `Seguir con esa` / `Cerrar y abrir nueva` / `Cancelar`.

#### T2. `PUNTO_IDENTIFICADO` → `UBICACION_VALIDADA` — ubicación y geocerca

| | |
|---|---|
| **Mensaje del bot** | `location_request_message`, body: “Para confirmar que estás en el punto, tocá **Enviar ubicación**. Es una sola vez, no es seguimiento.” |
| **Qué espera** | Un mensaje `type = location` |
| **Cuánto espera** | 5 min; recordatorio a los 2 min (“Te falta enviar la ubicación 👆”) |
| **Al vencer** | Intento 1 y 2: se repite la solicitud. Intento 3 → `ERROR_UBICACION` con motivo `SIN_RESPUESTA` |
| **Queda registrado** | `visitas_ubicaciones`: `lat`, `lon`, `name`, `address`, `distancia_m`, `radio_m`, `dentro` (bool), `wamid`, `context_wamid`, `recibido_en` |

Comparación con la geocerca: distancia **haversine** entre la ubicación recibida y `puntos.lat/lon`, contra `puntos.radio_m` (por defecto 75 m), y **se responde la diferencia en metros**:

- Dentro → “✅ Ubicación confirmada: estás a **18 m** del punto (tolerancia 75 m).” → `UBICACION_VALIDADA`.
- Fuera, pero a menos del doble del radio → “Estás a **142 m** del punto; la tolerancia es **75 m**, o sea **67 m de más**. ¿Reenviás la ubicación desde el punto?” + botones `Reenviar ubicación` / `Estoy en el punto` / `Reportar novedad`. `Estoy en el punto` **no valida**: pasa a `UBICACION_VALIDADA` con `override = true`, deja la novedad `UBICACION_FORZADA` y notifica al supervisor. Es decisión deliberada: no se bloquea el trabajo, se deja rastro.
- Fuera por más del doble → `ERROR_UBICACION` con motivo `FUERA_DE_GEOCERCA` y la distancia. Mensaje: “Estás a **1.240 m** del punto **K7M-4QX9**. No puedo abrir la visita desde ahí. Si el punto está mal ubicado en el sistema, escribí **NOVEDAD**.”

> **Limitación conocida:** el webhook de ubicación **no trae precisión del GPS** (solo `latitude`, `longitude`, `name`, `address`), así que no se puede distinguir una lectura de ±5 m de una de ±500 m, ni detectar un GPS falso. Eso es materia de `adr-02`.

#### T3. `UBICACION_VALIDADA` → `FOTO_INICIO_OK` — foto de inicio

| | |
|---|---|
| **Mensaje del bot** | “Mandame una **foto del punto como está ahora**, antes de empezar. Tomala con la cámara, no de la galería.” |
| **Qué espera** | Un mensaje `type = image` |
| **Cuánto espera** | 10 min; recordatorio a los 4 min |
| **Al vencer** | Intentos 1 y 2: se repite. Intento 3 → `ERROR_FOTO`, motivo `SIN_FOTO_INICIO`; se ofrece `Continuar sin foto` (deja novedad `SIN_EVIDENCIA_INICIO`) o `Cancelar` |
| **Queda registrado** | `wa_medios` con el archivo en Storage; `visitas_evidencias` con `hito='FOTO_INICIO'`, `wamid`, `path`, `sha256`, `recibido_en`; evento `FOTO_INICIO_OK` |

Notas: la petición de “cámara, no galería” es **un pedido, no un control** — WhatsApp no distingue el origen y el EXIF viene borrado (§1.3). Si llega `type = document` con un `image/*` (truco para conservar metadatos), se acepta y se marca `con_exif = true`, porque ahí sí hay metadatos útiles. Si llega otro tipo (sticker, texto), se responde “Eso no es una foto 🙂. Mandame una imagen del punto.” y no cuenta como intento.

#### T4. `FOTO_INICIO_OK` → `EN_EJECUCION` — lista de tareas con instructivo

| | |
|---|---|
| **Mensaje del bot** | Lista. Header “Tareas del punto” (≤60), body “Punto K7M-4QX9 — Portería principal. Elegí la tarea que vas a hacer. Te paso el instructivo.” (≤4096), footer “Al terminar todas, mandá la foto de cierre.” (≤60), botón `Ver tareas` (≤20). Filas: `id = tarea:{id}`, título ≤24 (“Revisar extintor”), descripción ≤72 (“Presión, sello y fecha de recarga”). Máximo 9 tareas + “Ver más tareas ▸” |
| **Qué espera** | `list_reply.id = tarea:{id}` |
| **Cuánto espera** | 15 min |
| **Al vencer** | Recordatorio una sola vez: “¿Seguís en el punto? Elegí una tarea o escribí **CANCELAR**.” A los 30 min más sin nada → `EXPIRADA` |
| **Queda registrado** | Evento `TAREAS_LISTADAS` con los ids ofrecidos y la tarea elegida; `visitas_tareas` en `EN_CURSO` |

Al elegir una tarea el bot manda su **instructivo**: título, pasos numerados (el texto de `tareas.instructivo`, recortado a 4.096 caracteres y partido en varios mensajes si hace falta), qué evidencia pide (`foto` / `medición` / `nota`) y botones `Hecha` / `No se pudo` / `Otra tarea`. Si el instructivo tiene imagen o PDF de apoyo, se manda como `image` o `document` desde Storage.

#### T5. `EN_EJECUCION` (se queda ahí) — ejecución con texto, voz, fotos y mediciones

Es el estado más largo y el más tolerante: **acepta cualquier cosa** y la archiva contra la tarea en curso.

| Lo que llega | Qué hace el bot | Qué queda registrado |
|---|---|---|
| `text` | Si parece una medición (`presión 12 bar`, `nivel 80%`, `3 extintores`), extrae número + unidad y confirma: “Anoté **12 bar** en *Revisar extintor*. ¿Correcto?” + botones `Sí` / `Corregir`. Si no, se guarda como nota | `visitas_tareas_notas` (`texto`, `wamid`); `visitas_mediciones` (`valor`, `unidad`, `confirmado`) |
| `audio` con `voice: true` (nota de voz) | “🎙️ Recibí tu nota de voz, la estoy pasando a texto.” → descarga → transcripción por `/api/ia/transcribe` → “Dice: *«…»*. ¿Está bien?” + botones `Sí` / `Corregir` / `Escuchar después` | `wa_medios` + `visitas_tareas_notas` con `texto_transcrito`, `confianza`, `fuente='AUDIO'`. **El audio original nunca se borra**: la transcripción es una conveniencia, la prueba es el archivo (`adr-02`) |
| `image` | “📷 Foto guardada en *Revisar extintor*.” | `visitas_evidencias` con `hito='TAREA'`, `tarea_id` |
| `location` | Se guarda como ubicación adicional del hito, sin volver a validar | `visitas_ubicaciones` con `hito='TAREA'` |
| `Hecha` | Marca la tarea `HECHA`, y si faltan tareas vuelve a mandar la lista; si no, pasa a pedir la foto de cierre | `visitas_tareas.estado='HECHA'`, `terminada_en` |
| `No se pudo` | Pide motivo con lista corta: `Falta material` / `Sin acceso` / `Equipo dañado` / `Otra` → la tarea queda `NO_REALIZADA` con motivo y **se marca para generar ticket al cerrar** | `visitas_tareas.estado='NO_REALIZADA'`, `motivo`, `genera_ticket=true` |
| `NOVEDAD` | Abre una novedad suelta (foto + descripción) sin interrumpir la tarea | `visitas_novedades` |

| | |
|---|---|
| **Cuánto espera** | `puntos.duracion_estimada_min × 2`, con piso de 45 min y techo de 180. Aviso a los dos tercios: “¿Vas bien con *Revisar extintor*? Si ya terminaste, tocá **Hecha**.” |
| **Al vencer** | → `EXPIRADA`. Mensaje (si hay ventana): “Cerré la visita del punto **K7M-4QX9** por inactividad. Lo hecho quedó guardado; un supervisor la va a revisar.” Se genera el reporte **como borrador**, el caso queda abierto con la etiqueta `REVISAR_INACTIVIDAD` y se notifica al supervisor |
| **Queda registrado** | Un evento por cada mensaje recibido, siempre con su `wamid` |

#### T6. `EN_EJECUCION` → `FOTO_FIN_OK` — foto de cierre

| | |
|---|---|
| **Disparador** | Todas las tareas en `HECHA` o `NO_REALIZADA`, o la persona escribe `SIGUIENTE` / toca `Terminar punto` |
| **Mensaje del bot** | “Última: mandame la **foto del punto ya terminado**.” |
| **Qué espera** | `type = image` |
| **Cuánto espera** | 10 min; recordatorio a los 4 min |
| **Al vencer** | Intentos 1–2: se repite. Intento 3 → se pasa a `RESUMEN` igual, con novedad `SIN_EVIDENCIA_CIERRE`, y el reporte lo dirá |
| **Queda registrado** | `visitas_evidencias` con `hito='FOTO_FIN'`; evento `FOTO_FIN_OK` |

#### T7. `FOTO_FIN_OK` → `RESUMEN` — resumen con Confirmar / Corregir

| | |
|---|---|
| **Mensaje del bot** | Texto (≤1024) + 2 botones. Ejemplo: “**Resumen — K7M-4QX9 Portería principal**\n🕒 08:14 a 08:52 (38 min)\n📍 A 18 m del punto\n✅ Hechas: Revisar extintor (12 bar), Barrer zona común, Revisar luminarias\n⚠️ No se pudo: Cambiar bombillo — *falta material*\n📷 4 fotos · 🎙️ 1 nota de voz\n\n¿Confirmás para cerrar?” + botones `Confirmar` (`id=resumen:confirmar`) y `Corregir` (`id=resumen:corregir`) |
| **Qué espera** | `button_reply.id` de esos dos |
| **Cuánto espera** | 15 min |
| **Al vencer (1ª vez)** | Se repite el resumen una sola vez, acortado: “¿Confirmás el cierre del punto **K7M-4QX9**?” + los mismos botones. Se reinicia el reloj por 45 min |
| **Al vencer (2ª vez)** | → `EXPIRADA`. El reporte se genera como **borrador sin confirmar**, el caso queda abierto con etiqueta `PENDIENTE_CONFIRMACION` y pasa a la bandeja del supervisor, que puede confirmarlo desde la consola. **El sistema nunca confirma solo en nombre de la persona.** |
| **Queda registrado** | Evento `RESUMEN_ENVIADO` con el texto exacto mostrado (es la prueba de lo que la persona vio antes de confirmar) |

`Corregir` manda una lista de qué corregir: `Una tarea` / `Una medición` / `Agregar foto` / `Agregar novedad` / `Todo de nuevo` → vuelve a `EN_EJECUCION` con la tarea correspondiente abierta y un evento `CORRECCION_SOLICITADA`.

#### T8. `RESUMEN` → `CONFIRMADA`

| | |
|---|---|
| **Disparador** | `button_reply.id = resumen:confirmar` |
| **Mensaje del bot** | “✅ Listo. Estoy armando el reporte, dame un momento.” |
| **Qué espera** | Nada de la persona |
| **Cuánto espera** | El cierre corre enseguida en el trabajador; tope 2 min |
| **Al vencer** | Si el cierre falla, reintento con retroceso (hasta 5 veces). La visita se queda en `CONFIRMADA` — **no se pierde la confirmación** — y se abre ticket de soporte |
| **Queda registrado** | `visitas.confirmada_en`, `wamid_confirmacion`, `texto_resumen_confirmado` |

#### T9. `CONFIRMADA` → `CERRADA` (o `CERRADA_CON_NOVEDAD`)

El cierre, en una sola transacción:

1. **Genera el reporte** (el mismo que produce la app propia) con hitos, horas, distancias en metros, tareas, mediciones, novedades y evidencia enlazada por `path` de Storage.
2. **Crea un ticket por cada novedad** que lo pida: tareas `NO_REALIZADA` con `genera_ticket`, novedades reportadas, `UBICACION_FORZADA`, `SIN_EVIDENCIA_*`. Usa las RPC de tickets que ya existen (las de `/mantenimiento` y `/equipo`), con `origen='WHATSAPP'` y el `visita_id`.
3. **Cierra el caso** de la visita con el resumen y el enlace al reporte.
4. **Anuncia el siguiente punto.**

| | |
|---|---|
| **Mensaje del bot** | “✅ **Punto K7M-4QX9 cerrado.** Reporte `RV-2026-10-19-0147`.\n🎫 Abrí 1 ticket: *Cambiar bombillo — falta material*.\n\n➡️ Siguiente: **A1B-2C3D — Parqueadero sótano 1** (a unos 7 min). ¿Vamos?” + botones `Sí, siguiente` / `Pausa` / `Terminé por hoy` |
| **Si no hay más puntos** | “✅ Punto cerrado. **Terminaste la ronda de hoy**: 6 de 6 puntos. ¡Gracias!” (sin botones) |
| **Qué espera** | Nada obligatorio |
| **Cuánto espera** | `Sí, siguiente` abre T1 del punto siguiente. `Pausa` → `SIN_VISITA` con recordatorio en 30 min (**solo si hay jornada y ventana**). `Terminé por hoy` → `SIN_VISITA` y no se manda nada más |
| **Queda registrado** | `visitas.cerrada_en`, `reporte_id`, `tickets_creados[]`, `estado` final; evento `CERRADA` o `CERRADA_CON_NOVEDAD` con la lista de novedades |

#### T10. Estados de espera y error

| Estado | Mensaje del bot | Qué espera | Cuánto | Al vencer | Registro |
|---|---|---|---|---|---|
| `ESPERA_IDENTIDAD` | Ver §5 | Documento o botón | 10 min, 2 reintentos | → `ESPERA_AGENTE` | `wa_identificaciones` |
| `ESPERA_CONSENTIMIENTO` | Ver §5 | `Acepto` / `No acepto` | 15 min | Nada más; la visita no arranca. Queda `consentimiento_pendiente` | `consentimientos` |
| `ERROR_UBICACION` | “No pude confirmar que estás en el punto (**1.240 m** de diferencia). Un supervisor lo va a revisar.” + botones `Reintentar` / `Reportar novedad` / `Hablar con supervisor` | Botón | 30 min | → `EXPIRADA`, visita en borrador, aviso al supervisor | `visitas_eventos` con distancia e intentos |
| `ERROR_FOTO` | “No me llegó la foto. ¿Seguimos sin ella?” + botones `Continuar sin foto` / `Reintentar` / `Cancelar` | Botón | 15 min | → `EXPIRADA` con novedad `SIN_EVIDENCIA` | ídem |
| `ESPERA_AGENTE` | “Le pasé tu caso a un supervisor. Te escribe desde este mismo número.” | Mensaje humano (llega como `smb_message_echoes` si responde desde la app) | 4 h hábiles | Escalamiento al siguiente nivel y ticket de soporte | `casos` + `wa_eventos` tipo `smb_message_echoes` |
| `EN_ESPERA_FUERA_DE_JORNADA` | Ver §7 | Nada (el bot **no insiste**) | Hasta el próximo turno | Plantilla `visita_pendiente_cierre` al reabrir jornada | `visitas_eventos` con `motivo='FIN_JORNADA'` |
| `EXPIRADA` | — (puede no haber mensaje si no hay ventana o jornada) | — | — | — | Reporte en borrador + caso abierto |
| `CANCELADA` | “Cancelé la visita del punto **K7M-4QX9**. Lo que mandaste quedó guardado.” | — | — | — | `visitas.cancelada_en`, `motivo` |

---

## 5. Identificación del trabajador y consentimientos

### 5.1 Identificación

`canal_contacto` **no existe todavía** en el esquema (se verificó: ninguna migración ni código la menciona). La define la migración del módulo; desde la óptica de WhatsApp necesita, por lo menos: `id`, `persona_id` (→ registro de personal), `canal` (`'WHATSAPP'`), `identificador` (el `wa_id` en E.164 sin `+`, p. ej. `573001112233`), `perfil_nombre` (el `contacts[].profile.name` que manda WhatsApp), `verificado_en`, `verificado_por`, `estado` (`ACTIVO` / `BLOQUEADO` / `PENDIENTE`), `ultimo_entrante_en`.

Al primer mensaje de un número:

1. **Buscar** `canal_contacto` por `identificador = messages[].from`.
2. **Existe y está verificado** → se resuelve `persona_id`, se actualiza `ultimo_entrante_en` y sigue el flujo normal.
3. **Existe pero sin verificar, o no existe** → `ESPERA_IDENTIDAD`. El bot: “Hola 👋 Soy el asistente de rondas. Para empezar necesito identificarte: mandame tu **número de documento** (solo los números).” Con el documento se valida contra el registro de personal:
   - **Coincide y la persona está activa** → se crea o actualiza `canal_contacto` con `verificado_en = now()`, y se avisa: “Listo, **J. P.** 👍 Quedó vinculado este número.” (nunca el nombre completo en el log; en el repositorio público, jamás un nombre real).
   - **Coincide pero hay otro número ya vinculado** → se exige un segundo factor: código de 6 dígitos por la plantilla `vinculacion_numero_codigo` (categoría *authentication*) al número viejo, o aprobación del supervisor desde la consola. Esto evita que alguien se adueñe de la cuenta de otro con solo el documento.
   - **No coincide o la persona está retirada** → `ESPERA_AGENTE`: “No encontré ese documento en el registro de personal. Le aviso a gestión humana para que te ayuden.” Se abre un caso de soporte con el `wa_id`, el documento tecleado y la hora. **Nunca** se le dice al número qué documentos sí existen.
4. **Dos reintentos** de documento. Al tercero → `ESPERA_AGENTE`.
5. El número queda **vinculado a una sola persona a la vez**. Un cambio de número es un trámite con rastro (`canal_contacto` histórico, no `UPDATE` destructivo).
6. Un número `BLOQUEADO` recibe una sola respuesta (“Este número está inhabilitado para el asistente. Comunicate con tu supervisor.”) y después se ignora, pero los eventos **se siguen guardando**.

Nota técnica: el `wa_id` del webhook **puede no ser igual** al número de teléfono tal cual se marca — la propia documentación de `smb_message_echoes` advierte que “the user's phone number and WhatsApp ID may not match, so don't assume they're interchangeable”. Por eso `canal_contacto.identificador` guarda el `wa_id` y, aparte, el teléfono del registro de personal normalizado; se cotejan, pero el que manda para enrutar es el `wa_id`.

### 5.2 Consentimientos versionados (Ley 1581 de 2012)

La [Ley 1581 de 2012](https://www.unidadvictimas.gov.co/wp-content/uploads/Documentos/ley/Ley_1581_2012.pdf) exige autorización **previa, expresa e informada** del titular (art. 4 lit. c y art. 9), y su **artículo 5 clasifica los datos biométricos como datos sensibles**, cuyo tratamiento el **artículo 6** prohíbe como regla general salvo, entre otras, **autorización explícita** del titular. De ahí dos decisiones:

1. **Cuatro consentimientos separados**, cada uno con su propia versión y su propia aceptación: `UBICACION`, `FOTOS`, `AUDIO` y —**aparte, nunca junto con los otros**— `BIOMETRIA`.
2. **El de biometría no se pide en el flujo de la visita.** La visita por WhatsApp no necesita biometría: funciona sin ella. Si algún día el reconocimiento facial llega a este canal, se pide en un momento propio, con explicación completa y con la opción real de decir no y seguir trabajando (alternativa: validación por supervisor).

Tabla `consentimientos`: `persona_id`, `tipo`, `version` (p. ej. `ubicacion.v1`), `texto_hash`, `aceptado_en`, `canal='WHATSAPP'`, `wamid`, `ip_o_metadato`, `revocado_en`. El texto íntegro de cada versión vive en `consentimientos_textos` (`tipo`, `version`, `texto`, `vigente_desde`), para poder mostrar años después **exactamente** lo que la persona aceptó.

Antes del primer uso de cada capacidad, el bot manda (una vez, no en cada visita):

> **Ubicación (`ubicacion.v1`)**
> “Antes de empezar: para confirmar que estás en el punto voy a pedirte tu **ubicación puntual** en algunos momentos de la visita. No hay seguimiento continuo ni se ve dónde estás fuera de la visita. Se guarda con la visita y la usa tu supervisor para verificar la ronda. Podés pedir que la borremos o retirar este permiso escribiendo **PRIVACIDAD**. ¿Aceptás?” + botones `Acepto` / `No acepto` / `Más información`

> **Fotos (`fotos.v1`)**
> “Durante la visita te voy a pedir **fotos del punto** (antes, durante y al terminar). Son evidencia del trabajo y quedan guardadas con la visita. No pidas ni mandes fotos de personas sin su permiso. ¿Aceptás?” + `Acepto` / `No acepto` / `Más información`

> **Audio (`audio.v1`)**
> “Podés mandarme **notas de voz** en vez de escribir. El audio se guarda con la visita y se pasa a texto automáticamente para armar el reporte. Si preferís no usar audio, escribí y listo. ¿Aceptás?” + `Acepto` / `No acepto` / `Más información`

> **Biometría (`biometria.v1`) — aparte**
> “Esto es distinto de lo anterior. Un dato **biométrico** (tu rostro) es un **dato sensible** según la Ley 1581 de 2012 y necesita tu autorización explícita y por separado. Se usaría solo para confirmar que quien hace la ronda sos vos, se guarda cifrado y **podés negarte sin ninguna consecuencia**: en ese caso la verificación la hace tu supervisor. ¿Autorizás el uso de tu dato biométrico?” + `Autorizo` / `No autorizo` / `Más información`

Reglas: `No acepto` en ubicación o fotos **no bloquea el trabajo** — se registra, se le dice qué implica (“sin ubicación no puedo confirmar que estás en el punto; la visita la va a tener que validar tu supervisor”) y la visita sigue con la novedad `SIN_CONSENTIMIENTO_*`. `Más información` manda el texto completo de la política como `document` desde Storage. **PRIVACIDAD** es un comando siempre disponible que muestra qué consentimientos están aceptados, con fecha, y permite revocar. Cuando sale una versión nueva (`ubicacion.v2`), se vuelve a pedir **solo** la que cambió, antes del siguiente uso.

---

## 6. Comandos y ayuda

Se reconocen **sin importar mayúsculas, tildes ni signos**, y también en su forma más natural (“ayuda”, “¿me ayudás?”). Siempre funcionan, en cualquier estado.

| Comando | Qué hace | Permiso |
|---|---|---|
| **AYUDA** | Lista de qué se puede hacer, según el estado actual y los permisos de la persona. Es la respuesta por defecto cuando no se entiende nada | — |
| **MIS PUNTOS** | Lista interactiva de los puntos asignados hoy, con estado (pendiente / en curso / cerrado) y la hora sugerida. Máximo 9 + “Ver más” | — |
| **SIGUIENTE** | Cierra el paso actual si se puede y anuncia el punto siguiente de la ronda. En `EN_EJECUCION` equivale a “terminar punto” (pide la foto de cierre) | — |
| **NOVEDAD** | Abre una novedad suelta: pide descripción, foto opcional y ubicación opcional; crea el ticket al confirmar. Funciona **sin** visita abierta | — |
| **CANCELAR** | Cancela la visita o el paso en curso, con confirmación (`Sí, cancelar` / `No, seguir`). Lo ya enviado **no se borra** | — |
| **CREAR QR** | Crea un punto nuevo y devuelve el QR como imagen + el enlace `/q/{codigo}`. Pide sede, nombre del punto y ubicación (`location_request_message`, que fija la geocerca con el radio por defecto). **Exige permiso**: si `auth_permiso('puntos_qr.crear')` es falso → “Ese comando necesita permiso de administración de puntos. Si lo necesitás, pedíselo a tu supervisor.” Todo queda auditado con `creado_por` y `canal='WHATSAPP'` | `puntos_qr.crear` |
| **HABLAR CON SUPERVISOR** | → `ESPERA_AGENTE`: abre o reutiliza el caso, lo asigna al supervisor de la sede y avisa por correo/notificación. Si es fuera de jornada, lo dice y deja el caso en cola. **No** transfiere llamadas (no soportadas en coexistencia) | — |
| **PRIVACIDAD** | Consentimientos aceptados, fechas y revocación (§5.2) | — |

**Lenguaje natural.** Lo que no calce con un comando ni con el estado esperado se manda a un **clasificador de intención** sobre la infraestructura de IA que ya existe (`/api/ia/chat`), con un prompt cerrado que solo puede devolver uno de los intentos de esta tabla más `TAREA_LIBRE`, `MEDICION`, `SALUDO` y `NO_ENTIENDO`, con una confianza. Reglas duras:

- **El modelo no ejecuta nada.** Devuelve un intento; el motor decide. No puede cerrar una visita, ni confirmar un resumen, ni crear un QR.
- Confianza < 0,7 → se responde con **AYUDA** contextual, nunca con una suposición.
- Toda acción que cambie el estado de la visita pasa por una **confirmación explícita** con botones.
- Si el proveedor de IA está caído, el bot sigue funcionando: los comandos y los botones no dependen de él.
- Ejemplos: “ya terminé con el extintor” → `TAREA_HECHA` (pide cuál si hay varias); “el bombillo está quemado” → `NOVEDAD`; “estoy en la portería” → `PUNTO_POR_NOMBRE` (busca por nombre y ofrece la lista); “no me funciona esto” → `AYUDA`.

---

## 7. Desconexión laboral (Ley 2191 de 2022)

La [Ley 2191 de 2022](https://www.unidadvictimas.gov.co/wp-content/uploads/Documentos/ley/Ley_2191_2022..pdf) reconoce (art. 3) el derecho de trabajadores y servidores públicos “a no tener contacto, por cualquier medio o herramienta, bien sea tecnológica o no, para cuestiones relacionadas con su ámbito o actividad laboral, en horarios por fuera de la jornada ordinaria o jornada máxima legal de trabajo o convenida, ni en sus vacaciones o descansos”, y obliga al empleador a abstenerse de girar órdenes o requerimientos fuera de la jornada ([copia oficial en Invima](https://normograma.invima.gov.co/normograma/docs/pdf/ley_2191_2022.pdf)).

Un bot que manda recordatorios es exactamente “contacto por medio tecnológico”. Por eso:

### 7.1 Regla

> **El bot nunca inicia una conversación fuera de la jornada de la persona.** Puede *responder* a lo que la persona escriba por su propia iniciativa, porque ahí el contacto lo inicia ella.

Se implementa en el mismo portero de §4.1: todo mensaje encolado lleva `iniciado_por` (`BOT` o `RESPUESTA`). Si `iniciado_por = 'BOT'` y estamos fuera de jornada, el mensaje **no se envía** y queda `OMITIDO_JORNADA` con la hora evaluada y el turno usado.

### 7.2 Cómo se determina la jornada

En este orden, y lo que se usó queda escrito en el evento:

1. **Turno programado** del módulo de programación de personal (`programacion_fase1`), para esa persona y ese día: `inicio`, `fin`, sede. Es la fuente preferida.
2. **Marcación real** de entrada/salida, si existe y difiere del turno: manda la real (si entró 20 minutos tarde, su jornada corre 20 minutos más tarde).
3. **Franja por defecto** `WHATSAPP_JORNADA_FALLBACK` (06:00–20:00) cuando no hay turno ni marcación. Es una red de seguridad, no una política: lo correcto es que haya turno.
4. **Siempre** en `America/Bogota` (`WHATSAPP_ZONA_HORARIA`), con la fecha calculada en esa zona y no en UTC — el mismo cuidado de zona horaria que ya se tomó en el módulo de soporte para no romper la hidratación.
5. **Vacaciones, incapacidad, permiso o descanso** marcados en el módulo de personal → **no hay jornada**, ni siquiera en la franja por defecto.
6. **Turno de noche** que cruza medianoche: la jornada es un intervalo, no un par de horas; `22:00–06:00` es una sola jornada continua.
7. **Excepciones**, en una tabla y no en el código (`whatsapp_excepciones_jornada`): la propia ley excluye a quienes desempeñan cargos de dirección, confianza y manejo. Cada excepción queda con `persona_id` o `cargo_id`, `motivo` y `autorizada_por`. **Por defecto nadie está exceptuado.**
8. Una **emergencia** (incidente de seguridad, por ejemplo) no la decide el bot: la dispara una persona con permiso desde la consola, el envío queda marcado `EMERGENCIA` con quién lo autorizó, y se le dice a quien lo recibe por qué le están escribiendo a esa hora.

### 7.3 Qué pasa con una visita a medias cuando se cierra la ventana

1. **10 minutos antes del fin del turno**, si hay una visita en `UBICACION_VALIDADA`, `FOTO_INICIO_OK`, `EN_EJECUCION`, `FOTO_FIN_OK` o `RESUMEN` (y hay ventana de 24 h abierta): “Tu turno termina en **10 minutos**. ¿Cerramos la visita del punto **K7M-4QX9** con lo que ya hiciste?” + botones `Cerrar ahora` / `Ya voy` / `Dejar para mañana`.
2. **Al fin del turno**, si sigue abierta:
   - La visita pasa a **`EN_ESPERA_FUERA_DE_JORNADA`** (no se cancela, no se pierde nada).
   - Se genera el reporte **como borrador**, con todo lo recibido y la marca explícita “cerrada por fin de jornada, sin confirmación del trabajador”.
   - **El bot deja de escribir.** Ni recordatorios, ni plantillas, ni “no olvides”. Nada.
   - El caso queda abierto en la bandeja del supervisor con la etiqueta `FIN_JORNADA`, y es **el supervisor** quien decide: validar el borrador, reasignar el punto o dejarlo para el turno siguiente.
3. **Si la persona escribe por su cuenta** después del turno, el bot responde y la deja continuar — pero avisa una vez, sin trabas: “Ya terminó tu turno, no tenés que seguir. Si querés cerrar el punto igual, seguimos.” La visita queda marcada `fuera_de_jornada = true` y eso **aparece en el reporte y en la liquidación de horas**, para que el trabajo extra se vea y se pague.
4. **Al reabrir la jornada siguiente**, si la visita sigue sin cerrar y ya no hay ventana de 24 h, se usa la plantilla **`visita_pendiente_cierre`** (§8) — que es un mensaje *utility*, dentro de la jornada, y con la opción de no retomar.
5. Si la visita quedó a medias por fin de jornada **más de 48 horas**, se cierra sola como `CERRADA_CON_NOVEDAD` y queda solo el ticket de revisión. No se le vuelve a escribir a la persona por algo de hace dos días.

---

## 8. Catálogo de plantillas por aprobar ante Meta

Reglas que condicionan los textos ([Templates overview](https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/overview) y [Components](https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/components)): solo las plantillas pueden salir **fuera** de la ventana de 24 h; cada una se clasifica como *authentication*, *marketing* o *utility* (en la API, en minúscula) y la categoría afecta el precio; **solo se puede enviar una plantilla en estado `APPROVED`** y la revisión **puede tardar hasta 24 horas**; hay que fijar código de idioma (aquí **`es_CO`**) y dar un valor de ejemplo por cada variable; límites: header 60 caracteres, body 1.024, footer 60, botón 25, hasta 10 botones; se pueden crear 100 plantillas por hora y el tope es 250 por cuenta (6.000 si el portafolio está verificado y hay un número con nombre visible aprobado); una plantilla sin usar 12 meses se archiva.

**Ninguna plantilla es de categoría *marketing*.** Todas son *utility* (o *authentication* la de código), porque todas responden a una transacción u operación concreta, y porque usar marketing para asuntos de trabajo sería, además de caro, un problema legal del lado de §7.

| Nombre | Categoría | Cuándo se usa | Texto propuesto (`es_CO`) |
|---|---|---|---|
| `visita_pendiente_cierre` | utility | Reabrir la conversación para terminar una visita que quedó a medias (siempre **dentro** de la jornada) | **Header:** `Visita sin cerrar` · **Body:** `Hola {{1}}. Quedó sin cerrar la visita del punto {{2}} — {{3}}, del {{4}}. ¿La retomamos para dejar el reporte completo?` · **Footer:** `Si ya no aplica, tocá No retomar.` · **Botones:** `Retomar visita`, `No retomar` · **Ejemplos:** `{{1}}=Ana`, `{{2}}=K7M-4QX9`, `{{3}}=Portería principal`, `{{4}}=18 de octubre` |
| `ronda_asignada_hoy` | utility | Avisar la ronda del día al empezar el turno | **Header:** `Tu ronda de hoy` · **Body:** `Hola {{1}}. Hoy tenés {{2}} puntos en {{3}}, desde las {{4}}. Escribí MIS PUNTOS para verlos, o escaneá el QR del punto donde estés.` · **Footer:** `Asistente de rondas` · **Botones:** `Ver mis puntos` · **Ejemplos:** `{{1}}=Ana`, `{{2}}=6`, `{{3}}=Conjunto Ejemplo`, `{{4}}=06:00` |
| `punto_asignado_nuevo` | utility | Se agregó o cambió un punto de su ronda | **Body:** `{{1}}, se agregó un punto a tu ronda de hoy: {{2}} — {{3}}. Sugerido para las {{4}}.` · **Botones:** `Ver mis puntos` · **Ejemplos:** `{{1}}=Ana`, `{{2}}=A1B-2C3D`, `{{3}}=Parqueadero sótano 1`, `{{4}}=10:30` |
| `visita_resumen_cierre` | utility | Mandar el reporte cuando ya se cerró la ventana | **Header:** `Reporte de tu visita` · **Body:** `Listo {{1}}: el punto {{2}} quedó cerrado con reporte {{3}}. Tareas hechas: {{4}}. Novedades: {{5}}.` · **Footer:** `Gracias por tu trabajo.` · **Botones:** `Ver reporte` (URL) · **Ejemplos:** `{{1}}=Ana`, `{{2}}=K7M-4QX9`, `{{3}}=RV-2026-10-19-0147`, `{{4}}=3 de 4`, `{{5}}=1` |
| `novedad_asignada_supervisor` | utility | Avisarle a un supervisor que le llegó una novedad | **Header:** `Novedad para revisar` · **Body:** `{{1}}, entró una novedad en {{2}} — {{3}}: {{4}}. Ticket {{5}}.` · **Botones:** `Abrir ticket` (URL) · **Ejemplos:** `{{1}}=Carlos`, `{{2}}=Conjunto Ejemplo`, `{{3}}=Portería principal`, `{{4}}=Bombillo quemado`, `{{5}}=TK-10452` |
| `novedad_respuesta_supervisor` | utility | Contarle al conserje que su novedad avanzó | **Body:** `{{1}}, tu novedad "{{2}}" del punto {{3}} pasó a {{4}}. {{5}}` · **Botones:** `Ver detalle` (URL) · **Ejemplos:** `{{1}}=Ana`, `{{2}}=Bombillo quemado`, `{{3}}=K7M-4QX9`, `{{4}}=En compras`, `{{5}}=Llega el material el lunes.` |
| `consentimiento_inicial` | utility | Primer contacto cuando no hay ventana abierta y hay que pedir permisos | **Header:** `Asistente de rondas` · **Body:** `Hola {{1}}. Soy el asistente de rondas de {{2}}. Para empezar necesito tu permiso para pedirte ubicación, fotos y notas de voz durante las visitas. Te explico cada uno antes de usarlo.` · **Footer:** `Podés revisar o retirar los permisos escribiendo PRIVACIDAD.` · **Botones:** `Empezar`, `Más información` · **Ejemplos:** `{{1}}=Ana`, `{{2}}=Conserjes Inmobiliarios` |
| `vinculacion_numero_codigo` | authentication | Segundo factor para vincular un número nuevo a una persona que ya tenía otro | **Body:** `{{1}} es tu código para vincular un número nuevo al asistente de rondas. Vence en 10 minutos. Si no lo pediste, avisale a tu supervisor.` · **Botones:** `Copiar código` · **Ejemplo:** `{{1}}=472913` |
| `agente_respuesta_pendiente` | utility | Retomar un caso derivado a una persona cuando ya se cerró la ventana | **Body:** `{{1}}, {{2}} te respondió sobre tu caso {{3}}. ¿Querés seguir la conversación por acá?` · **Botones:** `Sí, continuar`, `Después` · **Ejemplos:** `{{1}}=Ana`, `{{2}}=Tu supervisor`, `{{3}}=CS-2026-0088` |
| `recordatorio_punto_pendiente` | utility | Punto de la ronda sin visitar faltando poco para el fin del turno (**solo dentro de la jornada**) | **Body:** `{{1}}, te quedan {{2}} puntos de la ronda y tu turno termina a las {{3}}. ¿Seguimos con {{4}}?` · **Botones:** `Sí, seguir`, `No alcanzo` · **Ejemplos:** `{{1}}=Ana`, `{{2}}=2`, `{{3}}=14:00`, `{{4}}=A1B-2C3D` |

Notas de aprobación: los nombres de plantilla van en minúscula con guion bajo; cada variable necesita su valor de ejemplo al crearla o la rechazan; **todos los nombres propios de los ejemplos son ficticios** (este repositorio es público); hay que suscribirse a `message_template_status_update` para enterarse de aprobaciones, rechazos y pausas por calidad, y mostrar el estado de cada plantilla en la consola. Si una plantilla queda `PAUSED` por calidad, el portero debe **saltársela** y no reintentar.

---

## 9. Cómo se prueba sin un número real

### 9.1 Simulador de conversaciones

Una pantalla de desarrollo, `/_dev/whatsapp` (solo con `WHATSAPP_SIMULADOR=1` y solo para usuarios con permiso de administración), que:

- Muestra un chat de WhatsApp de mentiras, con dos paneles: el del conserje y el del bot.
- Cada cosa que se teclea, cada botón, cada foto, cada audio y cada ubicación que se simula **arma un payload real de webhook** (`messages`, `interactive.button_reply`, `interactive.list_reply`, `location`, `image`, `audio` con `voice: true`) y lo manda, **firmado con el `WHATSAPP_APP_SECRET` local**, a `/api/whatsapp/webhook`. Es decir: se prueba el camino completo, firma y cola incluidas, no una ruta paralela.
- Con `WHATSAPP_SIMULADOR=1` la capa de transporte **no sale a Meta**: `lib/whatsapp/cliente.ts` usa la implementación `Simulada`, que escribe en `wa_mensajes_salida` con `estado='SIMULADO'` y pinta el mensaje en el panel, respetando los **mismos límites** (10 filas de lista, 3 botones, 20/24/60/1024/4096 caracteres) para que un mensaje que no cabría en WhatsApp **falle también en el simulador**.
- Los medios se simulan con archivos locales: en vez de `GET /{MEDIA_ID}` se lee del bucket `puntos-qr-evidencia/_simulacion/`, con la misma ruta de subida y el mismo cálculo de `sha256`.
- Un panel de **viaje en el tiempo** para disparar los temporizadores de §4 sin esperar (adelantar el reloj de la visita 10 minutos, cerrar la jornada, cerrar la ventana de 24 h).

Esto permite recorrer la máquina de estados completa, con geocercas y horarios reales, sin un solo mensaje enviado ni un peso gastado.

### 9.2 Payloads de ejemplo de Meta

- El App Dashboard trae un enlace **Test** al lado del campo `messages` en **WhatsApp → Webhooks → Configuration**, que dispara un payload de prueba contra el endpoint; la guía oficial del [endpoint de prueba](https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/set-up-whatsapp-echo-bot) lo usa justamente para confirmar que la verificación y la recepción funcionan. La prueba de `messages` anda tanto en modo desarrollo como en live; otras sí dependen del modo.
- Las formas exactas de cada payload están en la [referencia de webhooks de mensajes](https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/messages), la de [mensajes interactivos](https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/messages/interactive) y la de [`smb_message_echoes`](https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/smb_message_echoes). De ahí se copian a `apps/inventario/__fixtures__/whatsapp/*.json` **tal cual**, con los valores de ejemplo de Meta (`id: "102290129340398"`, `phone_number_id: "106540352242922"`, `wamid.HBgLMTY1MDM4Nzk0MzkVAgASGBQzQTRBNjU5OUFFRTAzODEwMTQ0RgA=`), para no inventar formas.
- Además hay que fabricar fixtures de lo **raro**: lote con 50 actualizaciones en un solo `POST`, el mismo `wamid` dos veces, eventos desordenados por `timestamp`, `messages[].errors` con `type: unsupported`, `statuses` con `failed`, y un `media_id` vencido (`404` al bajar).

### 9.3 Pruebas automáticas que valen la pena

| Qué | Por qué vale |
|---|---|
| **Verificación de firma** — firma buena, firma mala, sin header, cuerpo con tildes y emojis, cuerpo con `\/` escapado | Es el único control de autenticidad del endpoint. Un bug aquí es un bot que cualquiera puede manejar |
| **Reto de suscripción** — token bueno (200 + challenge crudo), token malo (403), `hub.mode` raro | Si falla, Meta no entrega **nada** y el síntoma es “no llegan mensajes” |
| **Idempotencia** — el mismo payload 5 veces seguidas y 5 veces en paralelo deja un solo efecto | Meta reintenta durante 7 días y a todas las apps suscritas. Es el bug más probable del módulo |
| **Máquina de estados** — tabla de casos recorriendo las transiciones de §4, incluidos todos los vencimientos y los estados de error | Es el corazón. Se prueba como función pura: `(estado, evento) → (estado', mensajes[], registros[])`, sin red y sin base |
| **Geocerca** — haversine contra casos conocidos (0 m, justo en el borde, cruce de meridiano, hemisferio sur, lat/lon invertidas) y el **texto en metros** de la respuesta | El número que se le responde a la persona es el que va a discutir con el supervisor |
| **Portero de ventana, jornada y consentimiento** — matriz de 3 × 2 con reloj congelado, turno nocturno que cruza medianoche, vacaciones, DST (que en Colombia no hay, pero el código no debe asumirlo) | Es lo que evita una violación del art. 3 de la Ley 2191 |
| **Límites de WhatsApp** — un armador de mensajes que rechace >10 filas, >3 botones, >24 caracteres de título, >4.096 de body | Si no, Meta devuelve error en producción y el conserje se queda esperando |
| **Descarga de medios** — URL vencida (404 → pedir de nuevo), `sha256` que no cuadra, archivo de 100 MB, token inválido (190) | Es evidencia laboral: perderla es perder la prueba del trabajo |
| **Cola y presupuesto de tiempo** — un lote que no alcanza a terminar deja el resto `PENDIENTE` y no duplica | Es lo que evita el `504` y el trabajo doble |
| **Caudal de salida** — 200 mensajes encolados no superan 20 mps y manejan `130429` | El límite del número es fijo y no se puede subir |
| **Contrato con Meta**, contra fixtures grabados (no contra la red) | Las pruebas no deben romperse porque haya internet lento, pero sí deben romperse si cambia la forma del payload |

Lo que **no** se prueba automáticamente y hay que hacer a mano, una vez, con un número real: el flujo de Embedded Signup en coexistencia (hay una persona tocando botones en un teléfono), la sincronización de contactos e historial (que corre **una sola vez**) y el eco `smb_message_echoes` cuando alguien responde desde la app.

---

## 10. Pendientes y riesgos

### 10.1 Decisiones pendientes

| # | Pendiente | Quién decide | Bloquea |
|---|---|---|---|
| **P-1** | **Directo con Meta (Tech Provider + App Review) o por un BSP.** Cambia los tiempos, el costo por mensaje y quién es dueño de la relación con Meta (§2.2) | Dirección | El onboarding real. **No** bloquea construir el motor ni el simulador |
| **P-2** | Qué número se conecta: el que la empresa ya usa con clientes o uno de operación. Si es el de clientes, el bot convive con conversaciones de clientes en el mismo buzón y hay que enrutar por `wa_id` | Operación | El onboarding |
| **P-3** | Confirmar el `sessionInfoVersion` y los parámetros de coexistencia en **Embedded Signup v4** (las v2/v3 mueren el 15 de octubre de 2026 y el ejemplo oficial de coexistencia todavía muestra `"3"`) | Implementación | El onboarding |
| **P-4** | Si se sincroniza el historial de 6 meses. Trae conversaciones con clientes y terceros a nuestra base: hay que decidirlo con criterio de protección de datos, **antes** del onboarding (la sincronización se puede correr una sola vez y hay 24 horas) | Dirección + protección de datos | El onboarding |
| **P-5** | Quién aprueba los textos de los consentimientos y de las plantillas (§5.2 y §8) | Jurídico / gestión humana | El envío de plantillas |
| **P-6** | Si el reconocimiento facial llega o no a WhatsApp. Hoy el ADR dice **no** (§5.2) | Dirección + `adr-02` | Nada hoy |
| **P-7** | Radio de geocerca por defecto (75 m propuesto) y si es por punto o por sede | Operación | Nada; hay valor por defecto |

### 10.2 Riesgos

| # | Riesgo | Mitigación |
|---|---|---|
| **R-1** | **Fraude de evidencia.** WhatsApp borra el EXIF y permite mandar de la galería: una foto puede ser vieja o de otro lado, y no hay forma de saberlo desde la foto | La ubicación puntual separada, el `timestamp` del servidor, el reto visual y la correlación los define `adr-02`. **Se asume y se documenta** que la evidencia por WhatsApp es más débil que la de la app propia, y el reporte lo dice (`canal='WHATSAPP'`) |
| **R-2** | **Bloqueo o suspensión del número** por calidad o por reportes de usuarios | Nada de marketing; plantillas solo *utility*; vigilar `phone_number_quality_update` y `account_alerts`; respetar la desconexión laboral (un bot que escribe de noche se gana reportes); el plan B es un número de respaldo registrado y sin usar |
| **R-3** | **Coexistencia no se puede activar** (versión de la app, cuenta ya vinculada a otro partner, línea de crédito compartida antes) | Flujo oficial de [reconexión de clientes desconectados](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/reconnect-offboarded-coexistence-clients); si no, número nuevo sin coexistencia (se pierde el eco de la app, se gana throughput) |
| **R-4** | **20 mps** no alcanzan para un aviso masivo | La cola prioriza: primero las respuestas a personas (que están esperando), después los avisos. Un aviso a 800 personas se programa y se avisa que tarda ~1 minuto. No hay upgrade posible para un número en coexistencia |
| **R-5** | **Ventana de 24 h** cerrada en el momento en que había que avisar algo | Catálogo de plantillas (§8) aprobado **antes** del piloto. Lo que no tenga plantilla, no se manda: queda `OMITIDO_VENTANA` y lo recoge el supervisor desde la consola |
| **R-6** | **Caída del webhook más de 7 días** = eventos perdidos sin API de recuperación | Alerta si `wa_eventos` no recibe nada en 30 minutos de jornada; el endpoint solo depende de la firma y de un `INSERT` (nada de IA, nada de terceros); incidente P1 |
| **R-7** | **Dato personal en WhatsApp.** Las conversaciones incluyen documentos de identidad, ubicaciones y voz de trabajadores, en una plataforma de un tercero | Consentimientos versionados (§5.2); no pedir nunca más datos de los necesarios (el documento solo la primera vez y solo para cotejar); evidencia en Storage propio con URLs firmadas de 120 s; retención definida y borrado por solicitud; el `wa_id` se trata como dato personal |
| **R-8** | **Desvinculación de los dispositivos acompañantes** al hacer el onboarding: quien usaba WhatsApp Web se queda por fuera sin entender por qué | Avisarlo antes, por escrito, en el instructivo de conexión |
| **R-9** | **Dependencia del clasificador de IA** para el lenguaje natural | Los comandos y botones no pasan por IA; si el proveedor cae, el bot sigue; confianza <0,7 → AYUDA |
| **R-10** | **Obsolescencia de la API.** Las versiones de Graph API duran ~2 años (v26.0 está disponible desde el 29 de julio de 2026) y Embedded Signup v2/v3 muere el 15 de octubre de 2026 | `WHATSAPP_API_VERSION` es configuración, no una constante en el código; revisión trimestral del changelog; suscripción a `account_alerts` |

### 10.3 Todo lo que depende de credenciales o de un número, como configuración de ejemplo

Para que el módulo se pueda construir y probar **entero** antes de tener credenciales, nada que dependa de Meta está incrustado en el código:

| Depende de Meta | Dónde vive | Valor de ejemplo mientras no exista |
|---|---|---|
| App ID / App Secret | `WHATSAPP_APP_ID`, `WHATSAPP_APP_SECRET` | `1234567890123456` / 32 ceros (sirven para firmar en el simulador) |
| Verify token | `WHATSAPP_WEBHOOK_VERIFY_TOKEN` | cadena aleatoria local |
| Config ID de Embedded Signup | `WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID` | `987654321098765`; sin él la pantalla de conexión muestra “Sin configurar” en vez de romperse |
| `waba_id`, `phone_number_id` | `wa_cuentas` (base de datos) | `102290129340398` / `106540352242922` (los de los ejemplos de Meta) |
| Business token | `wa_credenciales`, cifrado | ninguno; con `WHATSAPP_SIMULADOR=1` el transporte es el simulado |
| Plantillas aprobadas | `wa_plantillas` (nombre, categoría, idioma, estado, variables) | todas en `PENDIENTE`; el portero las salta y registra `OMITIDO_PLANTILLA` |
| Nombre visible y verificación del portafolio | `wa_cuentas` | `display_phone_number = "+57 601 000 0000"` |
| Caudal real del número | `wa_cuentas.throughput_mps` | `20`, con tope propio de `15` |

Regla de oro del módulo: **si falta la configuración de Meta, todo funciona menos el envío real**. El webhook recibe (firmado localmente), la máquina de estados corre, la evidencia se guarda, el reporte se genera y el simulador deja ver cada mensaje tal como saldría. Lo único que no pasa es que un mensaje salga hacia un teléfono.

---

## Fuentes

Documentación oficial de Meta (consultada el 2026-10-19):

- [WhatsApp Business Platform — Embedded Signup, Overview](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/overview)
- [Onboard WhatsApp Business app users (Coexistence)](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users)
- [Reconnect offboarded coexistence clients](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/reconnect-offboarded-coexistence-clients)
- [Permissions](https://developers.facebook.com/documentation/business-messaging/whatsapp/permissions)
- [Access tokens](https://developers.facebook.com/documentation/business-messaging/whatsapp/access-tokens)
- [Webhooks — Overview / Set up](https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/overview)
- [Create a webhook endpoint](https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/create-webhook-endpoint)
- [Create a test webhook endpoint](https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/set-up-whatsapp-echo-bot)
- [Webhooks reference — messages](https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/messages)
- [Webhooks reference — interactive messages](https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/messages/interactive)
- [Webhooks reference — smb_message_echoes](https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/smb_message_echoes)
- [Webhooks reference — smb_app_state_sync](https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/smb_app_state_sync)
- [Media](https://developers.facebook.com/documentation/business-messaging/whatsapp/business-phone-numbers/media)
- [Interactive list messages](https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/interactive-list-messages)
- [Interactive reply buttons messages](https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/interactive-reply-buttons-messages)
- [Location request messages](https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/location-request-messages)
- [Message templates — Overview](https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/overview)
- [Template components](https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/components)
- [Throughput](https://developers.facebook.com/documentation/business-messaging/whatsapp/throughput)
- [Non-template messages (ventana de 24 h)](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing/non-template-messages)
- [Graph API Changelog (v26.0)](https://developers.facebook.com/docs/graph-api/changelog)
- [Términos del Servicio de WhatsApp](https://www.whatsapp.com/legal/terms-of-service) (*Acceptable Use Of Our Services*, *Availability And Termination Of Our Services*)
- [Política de mensajes de WhatsApp Business](https://whatsappbusiness.com/es-la/policy/)

Plataforma de despliegue:

- [Vercel Functions Limits](https://vercel.com/docs/functions/limitations)

Normativa colombiana:

- [Ley 1581 de 2012 — protección de datos personales](https://www.unidadvictimas.gov.co/wp-content/uploads/Documentos/ley/Ley_1581_2012.pdf) (art. 4, 5, 6 y 9)
- [Ley 2191 de 2022 — desconexión laboral](https://www.unidadvictimas.gov.co/wp-content/uploads/Documentos/ley/Ley_2191_2022..pdf) · [copia en el normograma del Invima](https://normograma.invima.gov.co/normograma/docs/pdf/ley_2191_2022.pdf)

Sobre el borrado de metadatos EXIF (Meta **no** lo documenta en su API; la afirmación viene de literatura forense):

- Nishchal Soni, [*Forensic Value of Exif Data: An Analytical Evaluation of Metadata Integrity across Image Transfer Methods*](https://www.sciepublish.com/article/pii/567), *Perspectives in Legal and Forensic Sciences*

# ADR-02 — Antifraude, visión por computador y voz

**Módulo:** Puntos QR, Tareas y Bot de WhatsApp
**Estado:** propuesto · **Fecha:** 2026-10-19
**Depende de:** `00-exploracion-y-plan.md` (modelo de datos, `evidencia_media`, formato del QR)
y `adr-01-whatsapp.md` (webhook y máquina de estados del bot). Este ADR **no** diseña esas
dos capas: las consume.

---

## 0. El problema en una frase

El riesgo del negocio no es que alguien haga mal una ronda: es que **reporte una ronda que
no hizo**. Todo lo que sigue existe para que falsificar una visita cueste más trabajo que
hacerla, y para que el honesto que trabaja en un sótano sin señal no pague por eso.

Dos principios que mandan sobre el resto del documento:

1. **El motor nunca rechaza una visita.** Como máximo la manda a revisión humana, con el
   motivo escrito y la prueba a la vista. El único que puede declarar "no se hizo" es una
   persona, y queda registrado quién fue.
2. **El puntaje no es una nota de desempeño.** No alimenta nómina, ni sanciones, ni
   rankings. Solo decide a qué visitas mira primero el supervisor. Si alguna vez se usa
   para otra cosa, este diseño deja de ser válido.

---

## 1. Qué ya existe en el repo (leído antes de proponer nada)

### `services/facial` — microservicio Python de rostro

Es un FastAPI sin estado (`services/facial/main.py`, 7 archivos, ~300 líneas) que ya resuelve
media infraestructura de visión que este módulo necesitaba:

| Lo que ya tiene | Detalle |
| --- | --- |
| Detección + 5 puntos | OpenCV **YuNet** (~230 KB), carga perezosa y cacheada entre invocaciones |
| Embedding | **ArcFace 512-d** (`w600k_mbf`), L2-normalizado |
| Pila | `onnxruntime` + `opencv-python-headless` + `numpy`, **sin torch ni insightface** (wheels manylinux → instalan sin compilar) |
| Despliegue dual | Proyecto Vercel aparte (`root = services/facial`, 3009 MB, 60 s) **y** `Dockerfile` con CUDA para on-premise |
| Autenticación | `Authorization: Bearer $FACIAL_SERVICE_TOKEN`, patrón ya consumido por la app |
| Sin estado | No persiste imágenes ni embeddings — exactamente lo que pide habeas data |
| Honestidad | `liveness_score: null` cuando no hay motor de anti-spoofing; **no miente** diciendo que verificó |

**Consecuencia para este ADR:** ya tenemos un servicio Python con OpenCV y numpy desplegado,
autenticado y con dos modos de despliegue. Todo el procesamiento de imagen de este módulo
(decodificar QR dentro de una foto, hash perceptual, detección de recaptura) es OpenCV +
numpy. **No se crea un servicio nuevo: se le agregan endpoints a este.** Ver §3.

### `packages/offline` — motor de cola y sincronización

~400 líneas, framework-agnóstico, con pruebas en `tests/offline`:

- `StorageAdapter` abstracto (`InMemoryStore` para pruebas, Dexie/IndexedDB en la app).
- `OutboxItem { id, kind, payload, ts, intentos }` y `encolar()` con escritura optimista.
- `PushRegistry`: la app registra cómo sube cada intent (`upsertHandler`, `rpcHandler`,
  `updateHandler`).
- `pushOutbox()` reproduce los intents; **si el servidor falla, el item se queda en la cola**
  para reintentar en vez de perderse.
- `pullTabla()` incremental por watermark (`updated_at` / `created_at`), paginado de 1000.

**Consecuencia:** la cola de visitas offline es `encolar(store, 'visita_qr', payload)` con un
`rpcHandler('qr_registrar_visita')`. No hay que escribir cola nueva. **Pero** el `ts` del
`OutboxItem` lo pone `new Date()` del dispositivo (ver `outbox.ts`), es decir **la hora de la
cola es falsificable**. §2.11 resuelve eso sin tocar el paquete: con campos adicionales
dentro del `payload`.

### Lo demás que se reutiliza y no hay que inventar

| Pieza existente | Uso aquí |
| --- | --- |
| `components/foto/CamaraFoto.tsx` | Captura con `getUserMedia`, revisión antes de usar, limpieza de tracks. Base de la captura en vivo. |
| `ordenes-insumo/[id]/VideoDespacho.tsx` | Las dos trampas de `MediaRecorder` ya aprendidas a golpes (abrir cámara y grabar son dos pasos; duración mínima obligatoria). El video corto de la visita las hereda. |
| `logistica/mis-rutas/MisRutasClient.tsx` | `watchPosition` con `enableHighAccuracy`, `timeout: 10000`. Patrón de GPS ya probado en campo. |
| `app/api/ia/transcribe/route.ts` | Transcripción con `whisper-1`, `language: 'es'`, tope de 25 MB. Punto de partida de §3.4. |
| `app/api/gestion-humana/analizar-doc/route.ts` | Visión + `response_format` JSON con el SDK `openai`. Patrón de §3.5. |
| `lib/registro/consentimientos.ts` | Textos versionados, `VERSION_CONSENTIMIENTOS`, `hashTexto()` SHA-256, y **el consentimiento biométrico separado ya redactado**. §5 lo extiende, no lo reescribe. |
| `maquinaria` + `MaquinariaQR.tsx` + `/equipo` | QR impreso que lleva a una ruta pública que resuelve un activo. El flujo del punto QR es el mismo patrón. |
| `mantenimiento_*` (migración 20260914) | Escrituras solo por RPC `SECURITY DEFINER`, nombres desnormalizados porque la RLS de `usuarios` no deja leer a terceros, fotos como rutas de bucket. Mismo molde. |
| `pg_trgm`, `zod ^3`, `vitest` | Corrección de vocabulario, validación de esquemas y las pruebas de §6. |

**Lo que NO existe y hay que construir:** hash perceptual, decodificación de QR dentro de una
imagen en servidor, detección de recaptura, prueba de vida real, y el motor de puntaje.

---

## 2. El puntaje de confianza

### 2.0 Requisito previo: el QR (no es puntaje)

Antes de que exista una visita, el QR tiene que ser válido:

- **Firma criptográfica válida.** El QR lleva una firma del servidor sobre
  `(punto_id, version)`. **Debe ser Ed25519, no HMAC**, por una razón concreta: la PWA y el
  APK necesitan verificar el QR **sin conexión**, y con HMAC eso obliga a meter el secreto en
  el dispositivo, donde cualquiera con el APK puede extraerlo y **fabricar QR válidos**. Con
  Ed25519 el dispositivo lleva solo la clave pública: verifica y no puede firmar.
  *(Si `00-exploracion-y-plan.md` ya cerró HMAC, entonces el dispositivo offline solo puede
  validar el formato y el `punto_id` contra su copia local, y la verificación real se hace al
  sincronizar — lo cual significa que una visita offline con QR inventado se detecta tarde.
  Dejarlo anotado como dependencia abierta.)*
- **Estado activo.** `qr_versiones` con `estado ∈ (ACTIVO, REEMPLAZADO, REVOCADO)`. Un QR
  reemplazado **se rechaza**, aunque la firma sea válida: así se maneja el adhesivo que
  alguien fotografió antes de que lo cambiaran.

Si el QR falla, no hay visita que puntuar: la app lo dice en el acto ("Este código ya no está
vigente, pide uno nuevo al supervisor") y queda un registro en `qr_intentos_rechazados`
(punto, dispositivo, hora, motivo) — que es, por cierto, una de las mejores fuentes de señal
de fraude, porque el que prueba con un QR viejo deja rastro.

### 2.1 Fórmula

Cada señal produce un valor **s ∈ [0, 1]** y tiene un **peso**. Cada señal está en uno de
cuatro estados:

| Estado | Significado | Entra al puntaje (denominador) | Cuenta como *medida* (numerador de cobertura) |
| --- | --- | --- | --- |
| `medida` | Se evaluó y dio un resultado | Sí | Sí |
| `no_concluyente` | Se evaluó pero el resultado no decide (foto oscura, GPS impreciso) | Sí, con el `s` que diga la señal | Sí |
| `no_aplica` | **Autorizada**: el punto no tiene GPS, el canal no lo permite, la sede no tiene cámaras, el paso permite pantallas | **No** | **No** |
| `no_medible` | Debería haberse podido medir y no se pudo (permiso denegado, servicio caído) | Sí, con `s = s_no_medible` | **No** — por eso baja la cobertura |

```
aplicables = señales con estado ≠ 'no_aplica'
medidas    = aplicables con estado ∈ ('medida', 'no_concluyente')

bruto      = 100 * Σ(peso_i · s_i) / Σ(peso_i)        sobre aplicables
cobertura  = Σ(peso_i) sobre medidas / Σ(peso_i) sobre aplicables

techos = [100]
  si vetos ≠ ∅                      → 40
  si cobertura < 0.60               → 70
  si canal = 'WHATSAPP'             → 85
  si sincronizó > ventana_offline
     después de la hora declarada   → 80

puntaje = round( min(bruto, min(techos)) )
```

Un matiz que importa: **`no_medible` no se descuenta del denominador.** Si se descontara,
negar el permiso de ubicación subiría el puntaje en vez de bajarlo, y todo el mundo lo
negaría a la semana. Por eso `no_medible` se queda con su peso completo y un
`s_no_medible = 0.30` (parametrizable): ni castiga como un cero, ni premia la ausencia.

La excepción: cuando la causa es **nuestra** (el worker de análisis se cayó, el servicio de
visión devolvió 500), la señal pasa a `no_aplica` y la visita se **vuelve a puntuar** cuando
el worker se recupera (`puntaje_version` se incrementa y queda auditoría del recálculo). Una
falla de infraestructura nuestra jamás baja el puntaje de un trabajador.

### 2.2 Pesos

| Señal | Peso | Peso alto/medio |
| --- | ---: | --- |
| `geocerca` | 22 | alto |
| `qr_en_foto` | 18 | alto |
| `foto_no_repetida` | 18 | alto |
| `cruce_video` | 15 | alto (solo si la sede tiene cámaras de la plataforma) |
| `no_recaptura` | 10 | medio |
| `camara_en_vivo` | 10 | medio |
| `tiempo_coherente` | 8 | medio |
| `ubicacion_no_simulada` | 8 | medio |
| `identidad` | 6 | medio |

Suman **100** sin video y **115** con video; la normalización de §2.1 se encarga. Los pesos
viven en la tabla de parámetros (§2.12), no en el código.

### 2.3 Vetos → revisión obligatoria

Un veto **no rechaza**: pone techo 40 y manda la visita a `REVISION` con el motivo escrito y
la prueba adjunta.

| Veto | Se dispara cuando | Prueba que se muestra al supervisor |
| --- | --- | --- |
| `qr_otro_punto` | En la foto se decodificó el QR de otro punto y ninguno del punto visitado | La foto con el recuadro del QR y el nombre del punto que decodificó |
| `foto_reenviada` | `sha256` idéntico a una foto ya recibida | Las dos visitas, lado a lado, con fechas |
| `foto_duplicada` | Hamming pHash ≤ `umbral_duplicado` contra una foto de **otra persona u otro punto** | Las dos fotos y la distancia |
| `ubicacion_simulada` | Android reporta `isFromMockProvider` | Marca del sistema operativo y modelo del equipo |
| `fuera_de_geocerca` | `d_eff > 3·r` con precisión buena (`a ≤ r`) | Mapa con el punto, el radio y la ubicación reportada |
| `recaptura_alta` | `p_recaptura ≥ 0.80` y el paso no tiene `permite_pantalla` | La foto y el mapa de energía del moiré |
| `salto_imposible` | Velocidad implícita entre dos eventos ubicados de la misma persona > 45 m/s | Las dos visitas, la distancia y el tiempo |
| `zona_vacia_en_video` | La sede tiene cámaras y no hubo persona en la zona durante toda la ventana | El clip de la ventana |
| `cadena_de_hora_rota` | La cadena de la cola offline no encadena, o el reloj se desvía > 30 min sin explicación | La cadena, con el eslabón que falla |
| `identidad_no_coincide` | Verificación facial con prueba de vida contra el vector enrolado → otra persona | La foto de la visita y la similitud (nunca el vector) |

### 2.4 Umbrales y estados de la visita

| Puntaje | Estado | Qué pasa |
| --- | --- | --- |
| **≥ 80** | `ACEPTADA` | Se cierra sola. Queda el detalle por si alguien pregunta. |
| **50 – 79** | `ACEPTADA_CON_OBSERVACION` | Se cierra, pero entra al muestreo del supervisor y se pinta en ámbar en el tablero. |
| **< 50** | `REVISION` | Un supervisor tiene que mirarla antes de que cuente. |
| cualquiera, con veto | `REVISION` | Igual, con el motivo del veto arriba. |
| cualquiera, `cobertura < 0.60` | `REVISION` | "Evidencia insuficiente", que no es lo mismo que "sospechosa". |
| ≥ 80 en punto `criticidad = ALTA` pero < 95 | `ACEPTADA_CON_OBSERVACION` | Los puntos críticos (cuarto de bombas, caja fuerte) tienen la vara más alta. |
| cualquiera | `REVISION` | **Muestreo aleatorio** de `p_muestreo = 5%`, para que ni el honesto ni el tramposo sepan cuándo los miran. |

Nada de esto cierra como `NO_REALIZADA`. Ese estado solo lo pone una persona, y la pantalla
la obliga a elegir un motivo del catálogo y escribir una nota. El conserje **ve la decisión,
ve el motivo y puede responder** (derecho de contradicción): esa respuesta queda en el
expediente de la visita.

### 2.5 La explicación es parte del producto

Toda visita guarda `puntaje_detalle jsonb`:

```jsonc
{
  "version_motor": "1.0.0",
  "parametros_version": "cliente:acme/2026-10",
  "bruto": 78, "techos": [40], "puntaje": 40,
  "cobertura": 0.92,
  "canal": "PWA",
  "senales": [
    { "clave": "geocerca", "estado": "medida", "s": 0.0, "peso": 22, "aporte": 0.0,
      "medido": { "d_m": 412, "precision_m": 12, "radio_m": 50 },
      "texto": "La ubicación quedó a 412 m del punto (el radio permitido es 50 m)." },
    { "clave": "qr_en_foto", "estado": "medida", "s": 1.0, "peso": 18, "aporte": 18.0,
      "medido": { "punto_decodificado": "PT-0481" },
      "texto": "El código del punto se ve en la foto de inicio." }
  ],
  "vetos": [
    { "clave": "fuera_de_geocerca",
      "texto": "La foto tiene el código del punto, pero el celular estaba a 412 m de allí.",
      "evidencia_id": "…" }
  ]
}
```

La regla: **si el texto no se puede leer en voz alta a un conserje y que lo entienda, la señal
está mal escrita.** Nada de "score 0.37 en el vector de confianza".

---

## 2.6 Señal por señal

Formato fijo: dónde se evalúa · fórmula · qué queda en `evidencia_media` · parámetros · qué
pasa si no se puede medir.

> `evidencia_media` es la tabla que define `00-exploracion-y-plan.md`. Lo que este ADR
> necesita que tenga: `id, visita_id, paso_id, tipo (FOTO|VIDEO|AUDIO|FIRMA), storage_path,
> mime, bytes, sha256, ancho, alto, luminancia_media, capturado_at_dispositivo,
> capturado_mono_ms, recibido_at, canal, origen_captura (CAMARA|GALERIA|WHATSAPP),
> nonce_captura, dhash int8, phash int8, qr_detectado text[], qr_coincide bool,
> recaptura_p numeric(4,3), exif jsonb NULL, analisis_at, analisis_version`.
> Bucket privado `qr-evidencia`, mismo patrón que `logistica-evidencia` y `mantenimiento`.

### 2.6.1 `geocerca` — peso 22 (alto)

**Dónde:** el dispositivo captura (`getCurrentPosition` con `enableHighAccuracy: true`,
`timeout: 10000`, `maximumAge: 0` — nada de posiciones cacheadas); **el servidor calcula**.
Jamás se confía en una distancia calculada por el cliente.

**Fórmula** — `d` = Haversine en metros, `a` = precisión reportada (radio al 68 %), `r` =
radio del punto (default 50 m):

```
d_eff = max(0, d − min(a, r))          // beneficio de la duda, acotado a un radio

si a > r y intentos < 2:
      → pedir reintento (hasta 2, 10 s cada uno, con la pantalla diciendo por qué)
si a > 2·r tras los reintentos:
      → estado 'no_concluyente', s = 0.5, marca "ubicación dudosa"   (NUNCA veto)
si r < a ≤ 2·r:
      → se puntúa con d_eff normal y se marca "precisión baja"
si no:
      d_eff ≤ r        → s = 1
      r < d_eff ≤ 3·r  → s = 1 − (d_eff − r) / (2·r)
      d_eff > 3·r      → s = 0 + VETO fuera_de_geocerca  (solo si a ≤ r)
```

Esto responde la pregunta directa: **cuando la precisión reportada es peor que el radio, se
reintenta; si tras dos reintentos sigue peor que el doble del radio, es "ubicación dudosa"
(s = 0.5) y nunca un veto.** Un GPS impreciso es un edificio con muros gruesos, no un ladrón.

**Prueba:** `visita_ubicaciones` (lat, lon, precision_m, fuente `NAVEGADOR|NATIVO|WHATSAPP`,
`capturado_at`, `mock` bool/null, `d_m` y `radio_m` calculados). No va en `evidencia_media`
(no es un archivo), pero se enlaza desde `puntaje_detalle`.

**Parámetros:** `radio_m` por punto (default por cliente, 50), `factor_veto` (3),
`reintentos` (2), `peso`.

**Si no se puede medir:**
- Punto marcado `sin_gps = true` por el supervisor (sótano, parqueadero, cuarto técnico):
  `no_aplica`. El punto además queda obligado a `exige_qr_en_foto = true` — se cambia una
  señal por otra, no se regala.
- Permiso de ubicación denegado: `no_medible` (s = 0.30). La app explica antes de pedirlo
  ("sin esto tu ronda va a quedar marcada para revisión") para que sea una decisión, no un
  accidente.
- **Canal WhatsApp:** se acepta la ubicación puntual, **pero con la mitad del peso**
  (`peso_whatsapp = 11`). Razón concreta: en WhatsApp el pin de "ubicación" se puede
  **arrastrar a cualquier parte del mapa** antes de enviarlo. No prueba dónde está el
  teléfono. Por eso en WhatsApp `qr_en_foto` es obligatorio y el techo de canal es 85.
  (La "ubicación en tiempo real" sí es del GPS, pero exige que el usuario la deje
  compartiendo; si llega, se usa con el peso completo.)

### 2.6.2 `qr_en_foto` — peso 18 (alto)

**Dónde:** pre-chequeo **en el dispositivo** (jsQR sobre el frame, instantáneo y offline, solo
para guiar: "acércate un poco al adhesivo"); **la decisión es del servidor**, en el worker
asíncrono, con el decodificador robusto de §3.1.

**Fórmula:** se decodifican todos los símbolos de las fotos del paso marcadas `con_qr`
(normalmente inicio y cierre).

```
coincide el QR del punto                      → s = 1
decodifica QR de OTRO punto y ninguno del punto → s = 0 + VETO qr_otro_punto
no decodifica ninguno:
    plantilla no exige QR en foto             → no_aplica
    luminancia_media < 40 ó resolución < 1 MP → s = 0.45  'no_concluyente'
    en otro caso                              → s = 0.30  'no_concluyente'
```

Nunca es veto el "no se leyó": un ángulo malo o un adhesivo rayado no son fraude. Si el paso
lo exige y no se lee a la primera, la app pide repetir la foto **antes** de dejar cerrar (eso
es una regla de plantilla, no de IA: funciona offline).

**Prueba:** `qr_detectado text[]` (los payloads crudos decodificados, útiles para auditoría),
`qr_coincide bool`, y el recuadro del símbolo en `analisis jsonb` para pintarlo en la UI.

**Parámetros:** `exige_qr_en_foto` por punto y por paso, `peso`.

**Ojo:** esta señal **no detecta la foto de una pantalla** — si alguien fotografía la pantalla
donde se ve el QR, el QR se decodifica igual de bien. Quien atrapa eso es `no_recaptura` +
`foto_no_repetida`. Decirlo explícito para que nadie la sobrevalore.

### 2.6.3 `foto_no_repetida` — peso 18 (alto)

**Dónde:** dHash **en el dispositivo** (barato, se compara contra el historial local de ese
mismo equipo y atrapa el reenvío descarado aun sin conexión); pHash + dHash **en el servidor**
contra el historial global, en el worker.

**Fórmula** (dos mecanismos distintos, no confundirlos):

```
1) sha256 idéntico a una foto ya recibida  → s = 0 + VETO foto_reenviada
   (certeza total, barato, un índice único basta)

2) hamming(phash) contra el historial del PUNTO (180 días) y de la PERSONA (90 días),
   confirmado con dhash:
      d ≤ umbral_duplicado (2)   → s = 0.00   → VETO foto_duplicada SOLO si el match
                                                es de otra persona u otro punto
      3 ≤ d ≤ umbral_sospecha(6) → s = 0.25
      7 ≤ d ≤ 12                 → s = 0.60
      d > 12                     → s = 1.00
```

**La trampa de esta señal, y cómo se resuelve.** Una puerta cerrada fotografiada todos los
días da hamming 0–3 **legítimamente**. Si se deja así, la señal grita fraude cada mañana y en
dos semanas el supervisor la ignora. Regla de diseño, entonces:

> **O la plantilla obliga a que la escena varíe, o la señal se apaga honestamente.**

Un paso puede declarar `escena_estatica = true`, y entonces `foto_no_repetida` pasa a
`no_aplica` y su peso se redistribuye. Para **no** tener que apagarla, la plantilla debe
forzar un elemento variable en el encuadre: el adhesivo del QR dentro de la foto (que además
alimenta §2.6.2), la mano enguantada del conserje, un tablero con la fecha, o el insumo que se
acaba de reponer. Esa decisión es del que arma la plantilla y la pantalla de plantillas se lo
advierte.

**Prueba:** `sha256`, `dhash int8`, `phash int8`, y en `analisis jsonb` el
`{ match_evidencia_id, distancia, alcance: 'punto'|'persona'|'global' }`.

**Búsqueda:** fuerza bruta acotada al punto/persona y la ventana de días — son cientos de
filas, con `bit_count((phash # $1)::bit(64))` en Postgres 14+ sobra. Solo si un punto pasa de
~50.000 fotos se parte el hash en 8 bandas de 8 bits indexadas (principio del palomar: un
match con d ≤ 7 comparte al menos una banda exacta).

**Parámetros:** `umbral_duplicado` (2), `umbral_sospecha` (6), `dias_historial_punto` (180),
`dias_historial_persona` (90), `escena_estatica` por paso.

**Si no se puede medir:** foto corrupta o worker caído → `no_aplica` + recálculo posterior.

### 2.6.4 `no_recaptura` — peso 10 (medio)

**Dónde:** servidor, worker asíncrono (§3.3). No se puede en el dispositivo: la FFT sobre una
imagen de 4 MP en un celular viejo es medio segundo que el conserje siente.

**Fórmula:** `s = 1 − p_recaptura`, con `p` ∈ [0,1] de la heurística de §3.3.
`p ≥ 0.80` y el paso **no** tiene `permite_pantalla` → **VETO `recaptura_alta`**.

El veto es necesario porque sin él la cuenta no da: 10 puntos de peso no alcanzan para bajar
de 80 una foto de pantalla con todo lo demás en verde. Y es aceptable que tenga falsos
positivos **precisamente porque un veto solo manda a revisión**: el costo de equivocarse es
que un supervisor mire una foto, no que a alguien le descuenten el día.

**Prueba:** `recaptura_p numeric(4,3)` y en `analisis jsonb` los sub-indicadores
(`energia_moire`, `borde_rectangular`, `gradiente_especular`, `relacion_aspecto`), para que el
supervisor entienda por qué saltó y para poder recalibrar con datos reales.

**Parámetros:** `umbral_veto` (0.80), `permite_pantalla` por paso (para los pasos que
legítimamente fotografían un display: un medidor digital, un tablero de control).

**Si no se puede medir:** `luminancia_media < 25` (turno de noche, luz muy pobre) → la
heurística no es fiable → `no_aplica`, sin castigo. También `no_aplica` si el paso permite
pantallas.

### 2.6.5 `camara_en_vivo` — peso 10 (medio)

**Dónde:** dispositivo (es un hecho de la captura), verificado en el servidor por el
`nonce_captura`.

**Cómo:** la PWA captura **solo** con `getUserMedia` (el componente `CamaraFoto` ya existente);
**no hay `<input type="file">` ni `capture` que abra la galería**. Antes de abrir la cámara, el
servidor (o el propio dispositivo, offline, con su cadena de §2.11) emite un `nonce_captura`
que viaja con el blob. Una foto sin `nonce` válido llegó por otra vía.

```
origen_captura = 'CAMARA' con nonce válido      → s = 1
origen_captura = 'GALERIA' y el paso la permite → no_aplica
origen_captura = 'GALERIA' y el paso NO la permite,
  o nonce ausente/vencido/reusado               → s = 0 + se registra como intento de API
canal = 'WHATSAPP'                              → no_aplica (el canal no lo permite saber)
```

**Prueba:** `origen_captura`, `nonce_captura`, `recibido_at − nonce_emitido_at`.

**Parámetros:** `permite_galeria` por paso (default false), `ttl_nonce_s` (300).

**Si no se puede medir:** WhatsApp → `no_aplica` + techo de canal 85. Es el precio del canal,
y es un precio explícito, no un castigo escondido.

### 2.6.6 `tiempo_coherente` — peso 8 (medio)

**Dónde:** dispositivo mide, servidor decide (con su propio reloj como referencia).

**Fórmula:** promedio de tres sub-puntajes:

```
t1  latencia de la foto = capturado_at − nonce_emitido_at
      ≤ 180 s → 1 ;  180–600 s → interpolado ;  > 600 s → 0
t2  duración de la tarea vs. mínimo de la plantilla
      ≥ minimo_s → 1 ;  < minimo_s → duracion / minimo_s
      y la visita completa ≥ 0.6 · Σ(mínimos de sus pasos)
t3  deriva del reloj = |t_dispositivo − t_estimado_servidor|   (ver §2.11)
      ≤ 120 s → 1 ;  2–30 min → interpolado ;  > 30 min → 0 + VETO cadena_de_hora_rota

s = (t1 + t2 + t3) / 3
```

El `minimo_s` por paso lo pone quien arma la plantilla y es **el mínimo físico razonable**, no
el tiempo esperado: limpiar un baño puede tomar 12 minutos, pero el mínimo con el que se
puede creer que se hizo son 3. Poner el mínimo igual al esperado convierte al motor en un
cronómetro de capataz, y eso no es antifraude.

**Prueba:** los tres timestamps de `evidencia_media` + `visita.iniciada_at/cerrada_at` + los
campos de la cadena de §2.11.

**Parámetros:** `ventana_foto_s` (180), `minimo_s` por paso, `deriva_max_s` (120).

**Si no se puede medir:** visita por WhatsApp sin `nonce` → t1 `no_aplica`, se promedian t2 y
t3.

### 2.6.7 `ubicacion_no_simulada` — peso 8 (medio)

**Dónde:** Android nativo, en el dispositivo (Capacitor: `Location.isFromMockProvider` /
`isMock` del `LocationManager`, más la marca de "opciones de desarrollador" activas);
**PWA y verificación cruzada, en el servidor.**

**Fórmula:**

```
Android nativo:
   isFromMockProvider = true  → s = 0 + VETO ubicacion_simulada
   false                      → s = 1
PWA (no hay API para detectarlo → se infiere por física):
   v = distancia / Δt entre eventos ubicados consecutivos de la MISMA persona
   v ≤ 30 m/s (108 km/h) → s = 1
   30 < v ≤ 45 m/s       → s = 0.4
   v > 45 m/s            → s = 0 + VETO salto_imposible
   además, dentro de la misma visita: dos lecturas a > 300 m en < 60 s → mismo veto
```

**Prueba:** `visita_ubicaciones.mock`, y en `puntaje_detalle` el par de eventos con su
distancia y su Δt.

**Parámetros:** `v_max_ms` (30), `v_veto_ms` (45), `salto_m` (300), `salto_s` (60).

**Si no se puede medir:** WhatsApp o primera visita del turno (no hay evento anterior con el
cual comparar) → `no_aplica`.

**Honestidad sobre el límite:** en la PWA de un navegador no hay forma de detectar un
simulador de GPS. La velocidad imposible atrapa al que falsifica **dos** sitios lejanos; no
atrapa al que se queda en su casa falsificando siempre el mismo punto. A ese lo atrapan
`qr_en_foto`, `foto_no_repetida` y `cruce_video`. Por eso ninguna señal manda sola.

### 2.6.8 `identidad` — peso 6 (medio)

**Dónde:** firma en el dispositivo (canvas); PIN contra el servidor; rostro en
`services/facial` (§5).

**Fórmula — mide que el paso de identidad se completó, NO con qué método:**

```
rostro con prueba de vida OK  → s = 1
firma manuscrita del momento  → s = 1
PIN correcto                  → s = 1
nada, y la plantilla lo exige → s = 0
la plantilla no lo exige      → no_aplica
```

Que la firma valga lo mismo que el rostro es **deliberado y es jurídico**: si quien no
autoriza el uso de su biometría saca menos puntaje, el consentimiento deja de ser libre y la
autorización del Art. 9 de la Ley 1581 queda viciada. El valor extra del rostro no entra por
el puntaje: entra por el **veto `identidad_no_coincide`**, que solo puede dispararse para quien
sí autorizó. Quien no autorizó no gana nada ni pierde nada.

**Prueba:** `evidencia_media` tipo `FIRMA` (PNG de trazo), o `identidad_verificaciones`
(metodo, resultado, similitud, liveness_score, modelo_version) — **nunca la foto del rostro
ni el vector** salvo lo que diga §5.

**Parámetros:** `exige_identidad` por punto/plantilla, `metodos_permitidos`.

**Si no se puede medir:** servicio facial caído → la app ofrece firma o PIN en el acto; si
tampoco, `no_aplica` + recálculo.

### 2.6.9 `cruce_video` — peso 15 (alto, condicional)

**Dónde:** trabajo asíncrono, minutos después de cerrar la visita. Nunca en línea: depende de
un sistema externo que puede tardar o no responder.

**Fórmula:** se consulta la cámara asociada a la zona del punto en la ventana
`[inicio − 5 min, cierre + 5 min]`:

```
hay persona y coincide con el conserje (si autorizó biometría) → s = 1
hay persona pero no se identifica                              → s = 0.7
zona vacía durante toda la ventana                             → s = 0 + VETO zona_vacia_en_video
la sede no tiene cámara en esa zona / cámara fuera de línea    → no_aplica
```

Que la zona vacía sea veto y no solo un cero es razonable: es la prueba más fuerte que
tenemos. Que sea veto **y no rechazo** también: una cámara mal apuntada, un corte de luz o un
reloj de NVR desfasado producen zonas "vacías" falsas todo el tiempo. El supervisor mira el
clip y decide en diez segundos.

**Prueba:** `storage_path` del clip recortado (si el cliente autoriza guardarlo) o, si no, el
`{ camara_id, ventana, resultado, detecciones_n }` — y la referencia para ir a buscarlo al
NVR mientras exista allá.

**Parámetros:** `cruce_video_activo` por cliente/sede, `camara_id` por punto,
`margen_ventana_min` (5), `guarda_clip` (bool, default false por privacidad de terceros).

**Si no se puede medir:** `no_aplica` — que es el caso normal en la mayoría de sedes.

---

## 2.7 Dónde se evalúa cada cosa — resumen

| Señal | Dispositivo | Servidor (en línea) | Worker asíncrono |
| --- | --- | --- | --- |
| QR firmado (requisito) | verifica Ed25519 offline | revalida firma + estado | — |
| `geocerca` | captura y guía | **calcula distancia y puntúa** | — |
| `qr_en_foto` | pre-chequeo jsQR (guía) | — | **decodifica y decide** |
| `foto_no_repetida` | dHash local vs. historial del equipo | sha256 (índice único) | **pHash global** |
| `no_recaptura` | — | — | **heurística OpenCV** |
| `camara_en_vivo` | origen de la captura | valida `nonce` | — |
| `tiempo_coherente` | mide monotónico | **calcula deriva y puntúa** | — |
| `ubicacion_no_simulada` | `isFromMockProvider` (nativo) | **velocidad entre eventos** | — |
| `identidad` | firma / PIN / captura | valida PIN | **rostro + liveness** |
| `cruce_video` | — | — | **consulta al NVR** |
| **Puntaje total** | preliminar, para avisar | **definitivo al recibir** | **re-puntúa** cuando llegan las señales lentas |

El puntaje se calcula **dos o tres veces** por visita (preliminar en el dispositivo, firme al
recibir, recalculado cuando terminan los workers), con `puntaje_version` incremental y
auditoría. El conserje ve el preliminar solo como advertencia ("esta foto quedó muy oscura,
¿la repites?"), nunca como veredicto.

---

## 2.8 Lo que condiciona todo (1): WhatsApp borra el EXIF

WhatsApp recomprime las imágenes y **elimina los metadatos EXIF**. Consecuencias que el diseño
asume desde el principio:

- **El EXIF nunca es una señal obligatoria.** Es, como mucho, un `bonus` informativo: si
  llega (canal PWA/app), se guarda en `evidencia_media.exif jsonb` y se usa para enriquecer la
  revisión humana. Si no llega, no pasa nada. **El EXIF no tiene peso en la fórmula.**
- No se puede confiar en el `DateTimeOriginal` ni aunque llegue: se edita con cualquier app.
  La hora la fija la cadena de §2.11, no el archivo.
- El `sha256` de una foto que pasó por WhatsApp **no es** el del archivo original del
  remitente. El veto `foto_reenviada` por sha256 funciona para detectar el reenvío **dentro de
  nuestro sistema** (la misma foto subida dos veces por el mismo canal), no para comparar
  entre canales. Entre canales, el que sirve es el pHash.
- La recompresión agresiva de WhatsApp **degrada la detección de moiré** y hace ruidoso el
  pHash. Por eso en canal WhatsApp: `umbral_sospecha` sube (+2 por defecto), el umbral de veto
  de recaptura sube a 0.85, y el techo de canal es 85.

### Qué se gana y qué se pierde por canal

| | PWA / App | WhatsApp |
| --- | --- | --- |
| Geocerca | GPS real, peso 22 | pin arrastrable, peso 11 |
| QR en la foto | sí | **obligatorio** |
| Cámara en vivo | sí, peso 10 | `no_aplica` |
| Ubicación simulada | sí | `no_aplica` |
| EXIF | a veces | nunca |
| Techo del canal | 100 | **85** |

---

## 2.9 Lo que condiciona todo (2): la PWA tiene que funcionar sin señal

### Qué se valida en el dispositivo, sin conexión

Todo lo que es **determinista y barato**, usando la copia local que ya baja `packages/offline`:

1. **Firma y estado del QR** contra la clave pública y la tabla `puntos` replicada.
2. **Distancia a la geocerca** (las coordenadas del punto están en el dispositivo).
3. **Captura en vivo obligatoria** (no hay otra forma de tomar la foto en la app).
4. **Reglas de completitud de la plantilla**: "faltan 2 fotos y la medición del paso 3". Esto
   es lo que impide cerrar una visita incompleta, y **funciona sin IA y sin red** (ver §3.5).
5. **dHash local** contra el historial de fotos de ese mismo equipo (atrapa el reenvío obvio).
6. **Duración mínima** de cada paso.
7. **Cadena de hora** (§2.11).

La app muestra el puntaje preliminar y los avisos **como ayuda**: "así como va, tu ronda va a
quedar marcada para revisión porque la ubicación no se pudo leer". Nunca bloquea el trabajo:
el conserje siempre puede cerrar y seguir.

### Qué se valida al sincronizar

pHash global, recaptura, decodificación robusta del QR, velocidad entre visitas, rostro,
cruce con video, extracción con modelo de lenguaje, y el **recálculo definitivo** del puntaje.

### Cómo se evita que la cola offline sirva para falsificar la hora

Este es el agujero real: `OutboxItem.ts` lo pone `new Date()` del dispositivo
(`packages/offline/src/outbox.ts`). Alguien que adelante el reloj del celular puede encolar
una ronda "de las 2 a. m." a las 7 a. m. La solución **no toca el paquete offline**: viaja
dentro del `payload` del intent.

**Tres relojes y una cadena.** Cada evento lleva:

| Campo | Qué es | ¿Falsificable? |
| --- | --- | --- |
| `t_dispositivo` | `Date.now()` del celular | sí, trivialmente |
| `mono_ms` | reloj monotónico desde el arranque (`performance.now()` en PWA, `elapsedRealtime()` en Android) | **no hacia atrás** sin reiniciar el equipo |
| `t_ancla` + `mono_ancla` | último par (hora del servidor, monotónico) que el dispositivo recibió **firmado** en su última conexión | no: viene firmado del servidor |
| `hash_anterior` | SHA-256 del evento anterior de la cola de ese dispositivo | no sin reescribir toda la cadena |

Al recibir, el servidor calcula:

```
t_estimado = t_ancla + (mono_ms − mono_ancla)
deriva     = | t_dispositivo − t_estimado |
```

- Se guarda **`t_estimado` como la hora oficial del evento**, no `t_dispositivo`.
- `deriva > 120 s` → baja `tiempo_coherente`. `deriva > 30 min` sin reinicio declarado →
  **VETO `cadena_de_hora_rota`**.
- Si hubo reinicio (el monotónico se reseteó), el dispositivo lo declara con un evento
  `REINICIO`; a partir de ahí, hasta la próxima conexión, los eventos se marcan
  `ancla_perdida = true` y la visita arrastra el techo de "sincronización tardía" (80). Es
  una pérdida honesta: después de reiniciar sin red, de verdad no sabemos qué hora era.
- La **cadena** (`hash_anterior`) impide reordenar, intercalar o borrar eventos en la cola: el
  servidor verifica la continuidad y guarda la cabeza de la cadena por dispositivo. Un hueco
  o un eslabón que no encadena es veto.
- **Ventana de sincronización:** una visita que llega más de `ventana_offline` (default 24 h)
  después de su hora declarada tiene techo 80, y si el punto es `criticidad = ALTA` va directo
  a revisión. No es un castigo: 24 horas sin señal es raro y merece una mirada.

Nada de esto hace imposible falsificar la hora (un equipo rooteado con el reloj manipulado y
sin reiniciar nunca sigue siendo un hueco). Lo que hace es **volverla cara y dejar rastro**,
que es todo lo que un sistema de este tipo puede prometer honestamente.

---

## 2.10 Parametrización por cliente

Una tabla `qr_parametros` con `{ ambito, ambito_id, clave, valor jsonb, vigente_desde }` y
resolución en cascada:

```
default global  →  cliente  →  sede  →  punto  →  paso de la plantilla
```

Se resuelve una sola vez al puntuar y se guarda la **versión de parámetros** usada
(`parametros_version`) en `puntaje_detalle`, para que una visita puntuada en octubre se pueda
volver a leer en marzo con los parámetros de octubre. Cambiar un umbral **no** re-puntúa el
pasado; solo aplica de ahí en adelante (y si alguien quiere re-puntuar, es una acción
explícita, auditada y en lote).

Lo parametrizable: los 9 pesos, `s_no_medible`, los tres umbrales de estado, `p_muestreo`,
todos los umbrales de cada señal, los techos por canal/cobertura/veto, y los interruptores
`cruce_video_activo`, `exige_identidad`, `permite_pantalla`, `escena_estatica`, `sin_gps`.

La pantalla de parámetros muestra, para cada cambio, una **simulación contra las últimas 1.000
visitas**: "con este umbral, 180 visitas de las últimas 1.000 habrían ido a revisión en vez de
40". Sin eso, nadie puede calibrar nada de forma responsable.

---

## 3. Herramientas: qué se escoge y contra qué

### 3.0 La decisión de arquitectura que ordena todo lo demás

**Las tres señales de imagen (QR en foto, hash perceptual, recaptura) se implementan como
endpoints nuevos de `services/facial`, no en Node ni en un servicio nuevo.**

Por qué: ese servicio **ya** tiene OpenCV, numpy, FastAPI, token Bearer, 3009 MB de memoria,
60 s de duración, despliegue en Vercel y `Dockerfile` con CUDA para on-premise. Las tres
operaciones son OpenCV + numpy de veinte líneas cada una. Montar una segunda pila en Node
(sharp + wasm + FFT en JS) sería reimplementar lo que ya está instalado, con otro lenguaje,
otro despliegue y otro token.

Se renombra conceptualmente a **"servicio de visión"** y se le agregan:

```
POST /imagen/analizar   { image, opciones: { qr: true, hash: true, recaptura: true } }
  -> { qr: { payloads[], cajas[] },
       hash: { dhash: "<hex16>", phash: "<hex16>" },
       recaptura: { p, indicadores: {...} },
       meta: { ancho, alto, luminancia_media, nitidez },
       version: "vision/1.0.0" }
```

Un solo request por foto: se decodifica el JPEG una vez y se reutiliza la matriz para las
tres cosas. Requiere agregar `opencv-contrib-python-headless` **solo si** se usara
`cv2.img_hash` — y no se va a usar (ver §3.2).

**Consecuencia a vigilar:** el servicio hoy descarga los modelos de GitHub en el primer
request (5–15 s). Para una ruta crítica de campo eso es inaceptable, así que hay que fijar
`FACIAL_URL_YUNET` / `FACIAL_URL_BUFFALO_S` a Vercel Blob, como ya sugiere su propio README.
Las tres señales de imagen de este módulo no necesitan modelos, así que arrancan frías en
~1 s.

### 3.1 Decodificar el QR dentro de una imagen, en el servidor

**Elegido: `cv2.wechat_qrcode.WeChatQRCodeDetector` con `cv2.QRCodeDetector` como respaldo**,
dentro de `services/facial`.

Pipeline, con presupuesto de 1,5 s por foto:

1. Escala a 1600 px de lado mayor (las fotos llegan a 3–12 MP y el detector se ahoga).
2. `WeChatQRCode.detectAndDecode` (usa dos modelos SSD pequeños, ~1 MB en total, maneja QR
   pequeños, inclinados y con poco contraste — que es exactamente el caso de un adhesivo en
   una pared a dos metros).
3. Si no encuentra: `QRCodeDetector.detectAndDecodeMulti` sobre la imagen en escala de grises
   con ecualización CLAHE.
4. Si no encuentra: tres recortes centrados al 60 % y cuatro rotaciones de 90°.
5. Devuelve **todos** los payloads (hay que saber si aparece el QR de otro punto).

| Alternativa | Por qué no |
| --- | --- |
| `jsQR` en una función de Vercel | Puro JS, cabe perfecto, **y se usa en el dispositivo** para el pre-chequeo. Pero no intenta perspectiva ni rotaciones y falla con QR pequeños o inclinados: en pruebas de campo típicas lee bien de frente y mal en ángulo. Como decisor generaría `no_concluyente` constantes. |
| `zxing-wasm` en Node | Buena opción real: WASM, sin binarios nativos, multi-símbolo. Se descarta solo porque obligaría a decodificar el JPEG en Node (otro `sharp`/`jpeg-js`) y a mantener una segunda pila de imagen, cuando la de Python ya está desplegada. **Si el servicio Python se cayera del mapa, este es el plan B y no hay que rediseñar nada.** |
| `pyzbar` (ZBar) | Rápido, pero necesita la librería del sistema `libzbar0` → no instala en el runtime Python de Vercel sin contenedor. |

**¿Cabe en una función de Vercel?** Sí: `services/facial` ya *es* una función de Vercel de
3009 MB. Decodificar un QR cuesta 150–400 ms. Pero se invoca **desde el worker asíncrono**, no
desde el request del conserje, por la razón de §3.6.

### 3.2 Hash perceptual

**Elegido: implementación propia de dHash-64 y pHash-64, especificada aquí, escrita dos veces
— en TypeScript para el dispositivo y en numpy para el servidor.**

Suena a reinventar la rueda y es deliberado: **el requisito duro es que el hash del
dispositivo y el del servidor den el mismo número**, porque el dHash local es lo que permite
detectar reenvíos sin conexión. Cualquier librería (`sharp-phash`, `imghash`,
`cv2.img_hash.pHash`, `blockhash-js`) tiene su propio redimensionado, su propio paso a grises
y su propia DCT, y dos librerías distintas **no coinciden**. Son unas 40 líneas por lado.

**Especificación exacta (las dos implementaciones deben coincidir bit a bit):**

```
GRIS(imagen):
    y = 0.299·R + 0.587·G + 0.114·B        (luma Rec.601, sin corrección gamma)

dHash-64(imagen):
    g = GRIS(imagen) redimensionado a 9x8, interpolación BILINEAL (área si se reduce >4x)
    bit[i*8 + j] = 1 si g[i][j] < g[i][j+1]   para i∈[0,8), j∈[0,8)
    resultado: 64 bits, el bit 0 es el más significativo

pHash-64(imagen):
    g = GRIS(imagen) redimensionado a 32x32, interpolación BILINEAL (área si se reduce >4x)
    D = DCT-II bidimensional ortonormal de g        (scipy.fft.dctn norm='ortho' / impl. propia en TS)
    B = D[0:8, 0:8] sin el término DC D[0][0]       → 63 coeficientes
    m = mediana de los 63
    bit[k] = 1 si B_k > m    (recorrido por filas, el DC se emite como 0)
    resultado: 64 bits
```

Se guardan como `int8` (bigint) reinterpretando los 64 bits; la comparación es
`bit_count((a # b)::bit(64))`. Hay que escribir una prueba de equivalencia TS↔Python sobre un
corpus fijo de 50 imágenes versionado en el repo — si alguna vez divergen, la señal miente en
silencio, que es lo peor que puede pasar.

| Alternativa | Por qué no |
| --- | --- |
| `sharp-phash` | Solo servidor, y arrastra `sharp`. No sirve para el pre-chequeo offline. |
| `cv2.img_hash.pHash` | Obliga a `opencv-contrib`, y su variante no coincide con ninguna implementación JS. |
| `blockhash-js` | Existe en ambos lenguajes, pero es menos robusto a la recompresión de WhatsApp que el pHash por DCT. |
| Embeddings (CLIP, DINOv2) y búsqueda por similitud | Mucho mejor para "¿es la misma escena?", y `pgvector` ya está en el proyecto por el facial. **Candidato real para la fase 2**, cuando haya datos para calibrar. Hoy es cañón para matar mosca: cuesta un modelo más, no corre offline, y el problema que resuelve (escena estática vs. foto reenviada) se resolvió por diseño de plantilla en §2.6.3. |

### 3.3 Detección de recaptura (foto de una pantalla)

**Elegido fase 1: heurística clásica en OpenCV**, cuatro indicadores combinados por una
logística con pesos calibrables:

```
1. energia_moire     FFT 2D de la luminancia; proporción de energía en el anillo de
                     frecuencias medias-altas (0.25–0.45 de Nyquist) respecto del total.
                     Las pantallas LCD/OLED producen un pico ahí por la rejilla de subpíxeles.
2. borde_rectangular Detección de líneas (Hough) + búsqueda del cuadrilátero dominante con
                     relación de aspecto cercana a 16:9, 4:3, 19.5:9, y luminancia muy
                     distinta dentro y fuera.
3. gradiente_especular  La retroiluminación da un gradiente suave, monótono y de baja
                     frecuencia sobre toda la imagen; se mide ajustando un plano a la
                     luminancia y midiendo el residuo.
4. rango_dinamico    Las fotos de pantalla tienen negros levantados: percentil 1 de
                     luminancia muy por encima de 0 y saturación de color comprimida.

p = sigmoide(w0 + Σ wi·xi)      con w calibrado sobre un corpus propio
```

**Calibración obligatoria antes de encender el veto:** 300 fotos reales de rondas + 300 fotos
de pantalla tomadas con los mismos modelos de celular que usa la operación. Hasta tener esa
calibración, la señal se despliega **en modo sombra**: se calcula y se guarda, pero con
peso 0 y sin veto. Encenderla a ciegas es la receta para que el supervisor desconfíe del
tablero en la primera semana.

| Alternativa | Por qué no (todavía) |
| --- | --- |
| CNN entrenada para *screen recapture* (p. ej. MiniFASNet adaptado, o un EfficientNet-B0 ajustado) | Claramente más preciso, sobre todo con pantallas de alta densidad donde no hay moiré visible. Necesita datos etiquetados que hoy no tenemos y, si se usa torch, no cabe en el Vercel de `services/facial` (el README del propio servicio ya chocó con eso). **Fase 2**, exportado a ONNX para que sí quepa — ese es el mismo camino pendiente para el liveness de §5, así que se resuelven juntos. |
| Servicios comerciales de detección de deepfake/recaptura | Caros por imagen, y mandan todas las fotos de las sedes a un tercero fuera del país. No compensa para una señal de peso medio. |

**Límite que hay que decir en voz alta:** con una pantalla de buena densidad, fotografiada de
frente, sin reflejos y recortada, esta heurística falla. Por eso pesa 10 y no 25, y por eso el
antifraude es por capas.

### 3.4 Transcripción de notas de voz en español

**Elegido: `faster-whisper` (CTranslate2) con `large-v3` en int8_float16, en el servicio
on-premise con GPU que ya contempla el `Dockerfile` de `services/facial`.** Endpoint nuevo
`POST /voz/transcribir`.

Por qué, en orden de importancia:

1. **Infraestructura propia.** Las notas de voz de una ronda mencionan residentes, incidentes
   y a veces datos de salud ("la señora del 702 se cayó"). Mandar eso a un tercero fuera del
   país obliga a declarar transferencia internacional (§5) y a ampliar el consentimiento. En
   casa no.
2. **Vocabulario del cliente.** `faster-whisper` acepta `initial_prompt`: se arma por cliente
   con los nombres de zonas, equipos e insumos tomados de la base (`ubicaciones.nombre`,
   `productos.nombre_estandar`, `maquinaria.nombre`), recortado a ~200 tokens por relevancia
   para el punto que se está visitando. Eso sube mucho el acierto en nombres propios, que es
   justo donde Whisper falla en Colombia ("Alsacia", "cuarto de bombas", "hipoclorito",
   "guadañadora").
3. **Corrección posterior contra el catálogo.** Tras la transcripción, cada término candidato
   se compara con el catálogo del cliente usando `pg_trgm` (`similarity > 0.6`) y se corrige,
   **registrando la corrección** (`texto_asr` y `texto_corregido` se guardan por separado).
4. Costo marginal cero si la caja GPU existe; ~20–30× tiempo real en una T4.

| Alternativa | Costo | Consecuencia |
| --- | --- | --- |
| **OpenAI `whisper-1`** (lo que ya usa `/api/ia/transcribe`) | ~US$0,006/min | Cero infraestructura, funciona hoy mismo. Los audios salen del país; `initial_prompt` existe pero es más limitado. **Es el plan de arranque mientras no haya caja GPU**, y hay que decirlo en el consentimiento. |
| `gpt-4o-transcribe` | ~2× `whisper-1` | Mejor en ruido y en español coloquial; mismo problema de transferencia. |
| Deepgram Nova (es) | más barato por minuto | Buen español, *keyword boosting* nativo; un proveedor más que auditar. |
| `whisper-tiny`/`base` en ONNX dentro de una función de Vercel | casi gratis | **Descartado.** Cabría (≈ 75 MB), pero la calidad en español colombiano con ruido de calle, eco de parqueadero y voz baja es mala, y una transcripción mala es peor que ninguna: la gente confirma sin leer. |

**¿Cabe en una función de Vercel?** `large-v3` no. Y aunque cupiera, no debe: un audio de 40 s
tarda 2–5 s de GPU o 30–60 s de CPU. Va a **trabajo asíncrono**, siempre.

### 3.5 Extracción estructurada con modelo de lenguaje

Lo que hace: toma el texto escrito, la transcripción y las fotos de una visita, y produce
(a) las respuestas de la plantilla en un JSON validado, (b) la asociación foto→paso, y (c) la
pregunta de lo que falte.

**Elegido:** el SDK `openai` que ya está en el repo, con `response_format: { type: 'json_schema', strict: true }`
y **validación con `zod` del lado nuestro aunque el modelo diga que es estricto** — el patrón
de `analizar-doc/route.ts` pero con esquema fuerte en vez de `json_object`. Modelo por defecto
el barato (`gpt-4o-mini` o equivalente vigente, vía `OPENAI_MODEL_EXTRACCION`), escalando al
grande **solo** para las visitas que ya van a revisión.

**La decisión más importante de esta sección no es qué modelo, es esta:**

> **"Te falta la foto del dispensador" NO lo genera el modelo de lenguaje.**

La completitud es una regla determinista de la plantilla (el paso 4 exige 1 foto tipo
`dispensador` y llegaron 0). Se evalúa **en el dispositivo, offline, en milisegundos**, y es
lo que bloquea el cierre. Si esa pregunta dependiera de un LLM, un conserje sin señal no
podría cerrar su ronda, y uno con señal esperaría 8 segundos por cada paso. El LLM entra
**después y por encima**: detecta lo que la regla no puede ver ("la foto del dispensador
existe, pero está tapada por una mano" / "dijiste que el extintor está vencido pero marcaste
'sin novedad'"), y puede **reabrir** la visita como `PENDIENTE_DE_COMPLETAR` con una pregunta
redactada, que llega por push o por WhatsApp.

Esquema de salida (resumido):

```jsonc
{
  "respuestas": [{ "paso_id": "…", "campo": "…", "valor": "…",
                   "confianza": 0.0, "origen": "texto|voz|foto",
                   "fragmento": "lo que lo sustenta" }],
  "fotos": [{ "evidencia_id": "…", "paso_id": "…", "confianza": 0.0,
              "descripcion": "…" }],
  "faltantes": [{ "paso_id": "…", "que_falta": "foto del dispensador",
                  "pregunta": "¿Nos mandas la foto del dispensador del piso 3?" }],
  "contradicciones": [{ "texto": "…", "pasos": ["…"] }]
}
```

| Alternativa | Consecuencia |
| --- | --- |
| Vercel AI Gateway con el AI SDK | Da reintentos, *fallback* entre proveedores y observabilidad sin escribirla. Recomendado si el equipo va a tocar varios modelos; hoy el repo usa el SDK `openai` directo en tres rutas y cambiar a mitad de módulo mezcla dos patrones. **Decisión: seguir con `openai` ahora, y migrar las cuatro rutas de IA juntas en otro momento, no aquí.** |
| Llama 3.1 8B / Qwen2.5 7B propios en la caja GPU | Viable para la parte de **texto** (respuestas y faltantes). La parte de **visión** (asociar foto→paso, ver que la foto muestra lo que debe) necesita un VLM decente, y los abiertos que caben en una T4 todavía quedan cortos para fotos de sótano mal iluminadas. **Partir en dos: texto local, visión en la nube.** Reduce el gasto y lo que sale del país. |
| Nada de LLM, solo reglas | Es el 80 % del valor y es lo que **ya** bloquea el cierre. El LLM es la capa de arriba, y el módulo tiene que funcionar si se apaga. Diseñarlo así, con un interruptor `ia_extraccion_activa` por cliente. |

**¿Cabe en una función de Vercel?** Sí, holgadamente (el límite es 300 s y el cuerpo 4,5 MB —
las fotos van por referencia a URL firmada, no en el cuerpo). Pero igual se ejecuta en el
worker: el conserje no debe esperar a un modelo para cerrar su ronda.

### 3.6 Qué va en función y qué va en trabajo asíncrono

| Trabajo | Dónde | Por qué |
| --- | --- | --- |
| Verificar QR, geocerca, nonce, cadena de hora, puntaje preliminar | **Función de Vercel** (RPC de Supabase, realmente) | Milisegundos, y el conserje necesita respuesta ya |
| Reglas de completitud de la plantilla | **Dispositivo** | Tiene que funcionar sin señal |
| QR-en-foto + pHash + recaptura | **Worker** → `services/facial` | 0,5–1,5 s por foto, 4 fotos por visita |
| Transcripción | **Worker** → servicio GPU (o `whisper-1` mientras tanto) | segundos a decenas de segundos |
| Extracción con LLM | **Worker** | segundos, y puede fallar y reintentarse |
| Cruce con video | **Worker** con retraso de minutos | depende de un sistema externo |
| Re-puntuación | **Worker**, al terminar los anteriores | consolida |

**El worker:** no hay cola gestionada en el proyecto hoy. Dos opciones honestas —
(a) `pg_cron` + una tabla `qr_trabajos` con `FOR UPDATE SKIP LOCKED`, que no agrega
infraestructura y el equipo ya sabe operar Postgres; (b) Vercel Queues, que da reintentos y
backoff gratis pero mete un producto nuevo. **Recomendación: (a)** para arrancar — el volumen
(≈ 4.000 trabajos/día) le queda chico a Postgres y evita un proveedor más. Queda anotado como
punto de revisión si el volumen se multiplica por diez.

### 3.7 Cuánto cuesta al mes

**Volumen de ejemplo** (el que hay que ajustar cuando se sepa el real): 40 sedes, 180 puntos,
220 conserjes, **1.000 visitas por día hábil → 26.000 visitas/mes**; 4 fotos por visita →
**104.000 fotos/mes**; 30 % con nota de voz de ~25 s → **7.800 audios ≈ 54 horas**.

| Concepto | Cálculo | US$/mes |
| --- | --- | ---: |
| Visión (QR + hash + recaptura) en `services/facial` sobre Vercel | ~0,4 s CPU activa × 104.000 = 11,6 CPU-h; + 3 GB provisionados ~15 h; + 104 k invocaciones | **3 – 8** |
| Transcripción — **caja GPU propia** | 54 h de audio a ~25× tiempo real ≈ 2,2 h de GPU; la caja ya existe para el liveness | **~0** (marginal) |
| Transcripción — **plan de arranque con `whisper-1`** | 3.250 min × US$0,006 | **≈ 20** |
| Extracción LLM, modelo barato | 26.000 × (≈5.000 tok entrada + 500 salida) = 130 M + 13 M tok | **25 – 35** |
| Escalamiento al modelo grande solo en el ~10 % que va a revisión | 2.600 visitas | **35 – 50** |
| Almacenamiento de evidencia | 104.000 fotos × 150 KB (comprimidas a 1280 px) = **15,6 GB/mes**; con 12 meses de retención → 187 GB en régimen | **4 – 10** y creciendo |
| Egreso al leer evidencia en revisiones | ~10 % de las fotos se abren | **2 – 5** |
| **Total** | con GPU propia | **≈ US$70 – 115** |
| **Total** | con transcripción en la nube | **≈ US$90 – 135** |

Dos observaciones que valen más que las cifras:

- **Son precios de lista de octubre de 2026 y hay que verificarlos antes de comprometerlos.**
  Lo que no cambia es el *modelo* de costo: la visión es despreciable, el LLM es el grueso, y
  **el almacenamiento es el que crece solo**. Si no se define retención (§5), en tres años la
  factura de almacenamiento supera a la de IA.
- **Comprimir la foto a 1280 px / calidad 80 antes de subir** (en el dispositivo) divide por
  cuatro el almacenamiento y el egreso, y **no degrada** ninguna de las tres señales de
  imagen: el QR a 1280 px se lee bien, el pHash trabaja a 32×32, y el moiré sobrevive a una
  recompresión moderada. Lo que sí hay que guardar sin tocar es el `sha256` del archivo tal
  como se sube.

---

## 4. La regla de oro de la IA

> **Toda salida de un modelo queda marcada como generada por IA, y una persona la confirma
> antes de que la visita se pueda cerrar. Nada se da por cierto sin confirmación.**

Cómo se implementa, no como eslogan:

1. **Dos columnas, siempre separadas.** `texto_ia` / `texto_final`, `valor_ia` / `valor_final`.
   Nunca se sobrescribe lo que dijo el modelo: se guarda al lado. Así se puede medir cuánto
   corrige la gente, que es la única métrica real de si el modelo sirve.
2. **Procedencia en cada fila.** `origen ∈ ('HUMANO','IA','REGLA')`, `modelo`, `modelo_version`,
   `confianza`, `prompt_version`.
3. **Confirmación explícita.** `confirmado_por uuid`, `confirmado_at`. Una visita **no puede
   pasar a `CERRADA`** mientras exista una fila `origen = 'IA' AND confirmado_at IS NULL`. Es
   una restricción en la RPC de cierre, no un `if` en la pantalla.
4. **Visible.** Cada campo rellenado por el modelo se muestra con una marca "Sugerido por IA
   — revisa y confirma", en un color distinto. Al confirmar, la marca se vuelve "Confirmado
   por [persona] el [fecha]". En el PDF del reporte sale igual: quien lo lea sabe qué escribió
   una persona y qué sugirió una máquina.
5. **Confirmar no es un botón "aceptar todo".** Se confirma por campo o por paso; si alguien
   confirma 14 campos en 3 segundos, queda registrado y el supervisor lo ve.
6. **La IA no toca el puntaje.** Las señales del puntaje son determinísticas (geometría,
   criptografía, hashes, heurísticas de visión con umbral). La extracción con LLM **interpreta
   y pregunta**; no suma ni resta confianza. Un modelo que alucina no puede, ni por error,
   mandar a nadie a revisión. Esta separación es a propósito y no debe romperse "solo por esta
   señal".
7. **Interruptor por cliente.** `ia_extraccion_activa`, `ia_transcripcion_activa`. Con ambos
   apagados el módulo funciona completo: reglas de plantilla, puntaje y evidencia. La IA es
   comodidad, no cimiento.

---

## 5. Verificación facial, prueba de vida y habeas data

### 5.1 Qué le falta a `services/facial` para servir aquí

| Hueco | Detalle | Qué hay que hacer |
| --- | --- | --- |
| **Prueba de vida** | En Vercel `LIVENESS_MODE=none` y `liveness_score` vuelve `null`, porque MiniFASNet necesita torch (~800 MB). Sin liveness, **una foto impresa pasa**. Para control de ronda eso es inaceptable: es justo el ataque que el módulo existe para evitar. | **Portar un MiniFASNet (o equivalente) a ONNX** y servirlo con el `onnxruntime` que el servicio ya tiene. Es el mismo trabajo que la CNN de recaptura de §3.3: hacerlos juntos. Mientras no exista, la verificación facial queda **apagada en este módulo** y la identidad se resuelve con firma o PIN. |
| **Verificación 1:1** | El servicio es 1:N por diseño: devuelve el embedding y la app compara contra `pgvector`. Aquí siempre sabemos quién dice ser la persona. | Añadir `POST /face/verify { image, embedding_ref }` → `{ similitud, liveness_score }`, o dejar la comparación en la app (ya existe). Es trivial; lo que no es trivial es el umbral. |
| **Umbral recalibrado** | `FACIAL_UMBRAL_MATCH=0.50` se calibró para registro en oficina, con buena luz y rostro de frente. Un turno de noche en un parqueadero es otro problema. | Calibrar aparte, con `FACIAL_UMBRAL_MATCH_CAMPO`, sobre fotos reales de ronda. Hasta tenerlo, **el facial no genera el veto `identidad_no_coincide`**. |
| **Arranque en frío** | Descarga los modelos de GitHub en el primer request (5–15 s). | Fijar `FACIAL_URL_*` a Vercel Blob (ya lo sugiere su README). |
| **Límite de uso y auditoría** | No hay rate limit ni registro de quién llamó. | Agregar límite por token y un log de invocaciones sin payload (nunca la imagen). |
| **Versionado de modelo** | `modelo_version` se devuelve en `enroll` pero cambiar de modelo invalida todos los vectores. | Guardar `modelo_version` junto a cada vector y re-enrolar en bloque si cambia. Ya está medio resuelto; hay que hacerlo explícito. |
| **Soberanía del dato** | Vercel no tiene región en Colombia → los rostros salen del país. El README ya lo advierte. | Para **este** módulo, el facial corre **on-premise**, no en Vercel. Es datos biométricos de empleados en operación diaria, no un registro puntual de candidato. |

Lo que **sí** sirve tal cual: el contrato de la API, el token Bearer, la pila sin torch, la
arquitectura sin estado (no persiste imágenes ni embeddings — eso es exactamente lo que
habeas data quiere), y la honestidad de devolver `null` en vez de mentir.

### 5.2 La alternativa obligatoria, y por qué no es opcional

La **Ley 1581 de 2012** clasifica los datos biométricos como **datos sensibles** (Art. 5) y
establece que **nadie está obligado a autorizar el tratamiento de datos sensibles** (Art. 6,
parágrafo) y que ninguna actividad puede condicionarse a esa autorización. En una relación
laboral esto pesa más, no menos: el desbalance de poder hace que un "sí" presionado no sea
consentimiento libre.

Por lo tanto:

1. **La autorización biométrica es separada**, con su propio texto, su propia casilla y su
   propia versión — tal como ya está hecho en `lib/registro/consentimientos.ts`
   (`CONSENTIMIENTO_BIOMETRICO` está aparte de `CONSENTIMIENTO_DATOS`). Para este módulo hay
   que **redactar una versión nueva** con esta finalidad concreta (verificación de identidad
   en rondas), porque la existente dice textualmente "NO se usará para control de asistencia,
   vigilancia" — y esto se le parece lo suficiente como para que el texto actual **no** lo
   cubra. Subir `VERSION_CONSENTIMIENTOS`.
2. **Las alternativas son `firma manuscrita` y `PIN`**, elegibles por la persona, disponibles
   en todo momento y **con el mismo puntaje** (§2.6.8). La pantalla no las presenta como "la
   opción degradada": son tres opciones al mismo nivel.
3. **Revocable en cualquier momento**, desde el perfil, sin pedir permiso a nadie y sin
   justificar. Al revocar: el vector se borra en el acto (no en el próximo barrido nocturno),
   la persona pasa a firma/PIN, y se registra el evento. **Revocar no puede cambiar el
   puntaje de visitas pasadas** ni generar ninguna alerta hacia el supervisor.
4. **Nunca se usa el rostro para nada que no sea verificar identidad en el paso que lo pide.**
   No para contar presencia, no para medir tiempos, no para buscar a alguien en el video.

### 5.3 Retención

| Dato | Retención | Al vencer |
| --- | --- | --- |
| **Fotos de evidencia** de la visita | `retencion_fotos_meses` por cliente, **default 12**, mínimo 6, máximo lo que exija el contrato del cliente | Se borra el archivo del bucket; sobreviven `sha256`, `phash`, `dhash` y el `puntaje_detalle` (no son la imagen y sirven para auditar el pasado) |
| **Video corto** de la visita | default **6 meses** (pesa mucho más) | Borrado |
| **Audios** (notas de voz) | default **6 meses** | Se borra el audio; **la transcripción confirmada queda** — es parte del reporte que el cliente contrató |
| **Clips del cruce con video** | solo si `guarda_clip = true`; default **30 días** | Borrado. Por defecto no se guardan: tienen caras de terceros que no son nuestros empleados |
| **Plantilla biométrica (vector ArcFace)** | mientras dure el vínculo laboral **+ 6 meses**; o 24 meses sin actividad, lo que ocurra primero | Supresión automática |
| **Foto cruda del rostro** | **no se guarda nunca** — el servicio es sin estado y solo devuelve el vector | — |
| **Comparaciones faciales** (`identidad_verificaciones`) | 12 meses | Se borra la similitud; queda solo "se verificó / no se verificó" |
| **Ubicaciones** (`visita_ubicaciones`) | 12 meses | Borradas; queda la distancia calculada en `puntaje_detalle` |
| **`puntaje_detalle`** | lo que dure la visita en el sistema (soporte de facturación al cliente) | — |

El borrado lo hace un `pg_cron` nocturno que registra cuántas filas y archivos borró. Si el
contrato con un cliente exige más, se sube el parámetro **de ese cliente** y queda anotado
quién lo autorizó.

### 5.4 Consulta y supresión

- **Canal:** el mismo que ya publica `consentimientos.ts`
  (`protecciondedatos@conserjesinmobiliarios.com`), más un botón **"Mis datos"** dentro de la
  app, que es donde el trabajador de verdad va a entrar.
- **Consulta (Art. 14):** 10 días hábiles, prorrogables 5. La app entrega en el acto un
  paquete descargable: las visitas de la persona, sus evidencias, su puntaje con la
  explicación de cada señal, el estado de sus consentimientos y la bitácora de verificaciones.
  Automatizarlo no es un lujo: es lo que hace que el plazo se cumpla solo.
- **Reclamo (Art. 15):** 15 días hábiles, prorrogables 8. Incluye el **reclamo contra una
  decisión de revisión**: si a alguien le marcaron una ronda como no realizada, puede pedir
  que se revise y adjuntar lo que quiera.
- **Supresión:** se suprime lo suprimible (vector biométrico, ubicaciones, audios). **No se
  suprime** la evidencia de visitas mientras exista obligación contractual con el cliente o
  laboral/probatoria con la empresa; en ese caso se responde por escrito **cuál es el deber
  legal o contractual concreto** que lo impide, y se suprime apenas venza. Responder "no se
  puede" sin decir por qué es incumplir.
- **SIC:** se informa en el aviso que puede quejarse ante la Superintendencia de Industria y
  Comercio.
- **Transferencia internacional:** si se usa `whisper-1` o un LLM de nube, el aviso debe
  decirlo con nombre y finalidad, y hay que subir `VERSION_CONSENTIMIENTOS`. El facial de este
  módulo **no** sale del país (§5.1).

---

## 6. Plan de pruebas del antifraude

### 6.1 Cómo se prueba

El motor se escribe como **una función pura**, sin red ni base de datos:

```ts
puntuarVisita(senales: SenalMedida[], parametros: Parametros): Resultado
// Resultado = { bruto, puntaje, cobertura, estado, techos, vetos, detalle }
```

Eso permite que todo §6.2 sean pruebas de `vitest` de milisegundos, en `tests/antifraude/`,
siguiendo el molde de `tests/offline` (que ya prueba el motor de sincronización contra un
doble, sin red). Las señales llegan ya medidas: **las pruebas del motor no prueban OpenCV**.

Hay una segunda suite, aparte y más lenta, `tests/vision/` con un corpus de imágenes
versionado (50 fotos: rondas reales anonimizadas, fotos de pantalla, duplicados, QR en ángulo,
fotos nocturnas), que prueba los extractores y la **equivalencia TS↔Python de los hashes**.

### 6.2 Los ataques, uno por uno

| # | Ataque | Montaje de la prueba | Lo que debe pasar |
| --- | --- | --- | --- |
| **A1** | **Foto de una foto** (le toma foto a la pantalla del computador) | `no_recaptura.s = 0.15` (p = 0.85), todo lo demás en 1, paso sin `permite_pantalla` | VETO `recaptura_alta` → techo 40 → `estado = REVISION`. **La prueba también afirma que `camara_en_vivo` vale 1**: la cámara *sí* estaba en vivo, y el motor no debe confundir las dos cosas |
| **A1b** | Igual, pero en un paso que **sí** permite pantallas (lee un medidor digital) | `permite_pantalla = true` | `no_recaptura` → `no_aplica`, sin veto, puntaje 100. Es la prueba de que no castigamos lo legítimo |
| **A2** | **Foto vieja reenviada** (manda el mismo archivo del mes pasado) | `sha256` repetido | VETO `foto_reenviada` → `REVISION`, y el detalle trae el `evidencia_id` de la visita original |
| **A2b** | Foto vieja **re-fotografiada** (distinto archivo, misma escena) | `phash` a hamming 1 de una foto de **otra persona** en el mismo punto | VETO `foto_duplicada`. Si el match fuera de **la misma persona en el mismo punto y paso**, NO hay veto (`s = 0`, sin techo): es la escena estática legítima |
| **A2c** | Escena estática declarada | `escena_estatica = true`, phash a hamming 0 | `foto_no_repetida` → `no_aplica`; el peso se redistribuye; puntaje ≥ 80. Prueba de que la señal se apaga en vez de mentir |
| **A3** | **GPS falso, Android** | `mock = true` | VETO `ubicacion_simulada` → `REVISION` |
| **A3b** | **GPS falso, PWA** (dos puntos a 40 km en 6 min → 111 m/s) | dos eventos ubicados consecutivos | VETO `salto_imposible` en la **segunda** visita; la primera no se toca retroactivamente salvo re-puntuación explícita |
| **A4** | **QR fotografiado y escaneado desde otro lugar** (se llevó la foto del adhesivo a su casa) | `qr_en_foto.s = 1` (¡el QR se ve perfecto!), `geocerca`: d = 4.200 m, r = 50, a = 15 | Sin el veto, el bruto sería **78 → aceptada**. La prueba afirma que `fuera_de_geocerca` dispara, el techo baja a 40 y el estado es `REVISION`. **Esta es la prueba que justifica que existan los techos**: con pesos solos, el ataque pasa |
| **A4b** | Igual, pero el punto está marcado `sin_gps` | `geocerca → no_aplica` | La prueba afirma que, en un punto `sin_gps`, `exige_qr_en_foto` **tiene que estar en true** (es una invariante de configuración, validada en la pantalla de puntos y en una prueba propia). Si no, el punto es indefendible |
| **A5** | **Dos personas con el mismo número** (se prestan la cuenta de WhatsApp o el usuario) | dos visitas de la misma persona, a 7 km, con 4 min de diferencia | VETO `salto_imposible` en ambas + marca `identidad_compartida`. Prueba complementaria: dos `dispositivo_id` distintos para la misma persona en el mismo turno → marca, revisión, sin veto (puede ser un cambio de celular legítimo) |
| **A6** | **Reloj adelantado + cola offline** | `t_dispositivo` 5 h adelante, `mono_ms` coherente con el ancla | La hora oficial es `t_estimado` (la correcta), `deriva = 5 h > 30 min` → VETO `cadena_de_hora_rota` |
| **A6b** | **Cola reordenada** (borra un evento del medio) | `hash_anterior` no encadena | VETO `cadena_de_hora_rota`, y el detalle señala el eslabón roto |
| **A7** | **Apagar señales para subir el puntaje** (niega GPS y cámara) | `geocerca` y `camara_en_vivo` en `no_medible` | Cada una entra con `s = 0.30` y **peso completo** → bruto = 6,6 + 3 + 68 = **77,6 → 78**; `cobertura = 68/100 = 0.68` (≥ 0,60, sin techo). La prueba afirma que **el puntaje BAJA**, nunca sube, al negar permisos. Con una tercera señal negada la cobertura cae por debajo de 0,60 y entra el techo 70 |
| **A8** | **Visita sincronizada 3 días después** | `ventana_offline = 24 h` | Techo 80 y, si `criticidad = ALTA`, `REVISION` |
| **A9** | **Zona vacía en el video** | sede con cámaras, 0 detecciones en la ventana | VETO `zona_vacia_en_video` |
| **A10** | **Suplantación con foto impresa** (facial sin liveness) | `liveness_disponible = false` | La prueba afirma que, con liveness no disponible, el motor **no** emite `identidad_no_coincide` ni otorga `s = 1` por rostro: cae a `no_medible` o a la alternativa. Es la traducción a código de la advertencia del README de `services/facial` |

### 6.3 Pruebas de que el motor no se dispara contra los honestos

Tan obligatorias como las anteriores, y se escriben primero:

| # | Caso | Lo que debe pasar |
| --- | --- | --- |
| **H1** | **Sótano sin GPS**, punto marcado `sin_gps`, todo lo demás perfecto | `geocerca → no_aplica`, cobertura 1.0, **puntaje 100** |
| **H2** | **Celular viejo**: foto de 0,9 MP, el QR no se decodifica | `qr_en_foto → 0.45 no_concluyente` (no 0), puntaje = 82 + 8,1 = **90** → `ACEPTADA` |
| **H3** | **Turno de noche**, `luminancia_media = 18` | `no_recaptura → no_aplica`, `foto_no_repetida` con umbrales relajados, puntaje ≥ 80 |
| **H4** | **GPS impreciso** (a = 85 m, r = 50 m, d = 30 m) tras dos reintentos | `s = 0.5` "ubicación dudosa", **sin veto**; puntaje ≈ 89 → `ACEPTADA` |
| **H5** | **El worker de visión se cayó** | Las tres señales de imagen → `no_aplica` (causa nuestra), sin techo de cobertura, y la visita queda marcada para **re-puntuación**. El puntaje no baja |
| **H6** | **Ronda por WhatsApp impecable** | Techo 85 → `ACEPTADA` (85 ≥ 80). La prueba afirma que un usuario de WhatsApp que hace todo bien **no** cae en `ACEPTADA_CON_OBSERVACION` |
| **H7** | **Persona que no autorizó biometría** | Firma manuscrita → `identidad.s = 1`. Puntaje **idéntico** al de quien usó rostro con liveness. Es una prueba jurídica, no técnica |
| **H8** | Invariantes del motor | Los pesos suman 100 sin video; `puntaje ∈ [0,100]`; `no_aplica` nunca sube el bruto por encima del mismo caso con la señal en 1; todo veto produce al menos un texto legible no vacío |

### 6.4 Lo que las pruebas unitarias no pueden cubrir

Un **ejercicio de equipo rojo** antes de salir a producción: dos personas con un celular, una
hora y permiso explícito para intentar falsificar diez rondas en una sede de prueba. Lo que
pasen, se vuelve una prueba unitaria nueva. Se repite cada seis meses, porque el que quiere
hacer trampa también aprende.

---

## 7. Pendientes, riesgos y falsos positivos

### 7.1 Lo que puede castigar a un trabajador honesto

| Situación | Qué le pasaría sin mitigación | Mitigación en este diseño | Qué queda sin resolver |
| --- | --- | --- | --- |
| **Sótano, parqueadero, cuarto de bombas: sin GPS** | Geocerca en 0 → veto → revisión todos los días | El **supervisor** marca el punto `sin_gps` → `no_aplica`, y el punto pasa a exigir QR en la foto | Que nadie marque el punto. Mitigación operativa: si un punto acumula 3 visitas con GPS imposible, el tablero **le sugiere al supervisor** marcarlo. Nunca lo marca solo, y nunca lo pide el conserje (sería el agujero obvio) |
| **Celular viejo o barato** | QR ilegible en la foto, pHash ruidoso, recaptura poco fiable | `no_concluyente = 0.45` en vez de 0; umbrales por resolución; la app guía ("acércate al adhesivo") | Un equipo de gama muy baja va a sacar sistemáticamente 5–8 puntos menos. **Se mide**: el tablero muestra puntaje promedio por modelo de equipo, y si la brecha pasa de 10 puntos, la empresa pone el equipo o se baja el peso. Es un problema de la empresa, no del trabajador |
| **Turno de noche, poca luz** | Fotos oscuras → todas las señales de imagen degradadas | Linterna automática en la captura; `no_recaptura → no_aplica` bajo cierta luminancia; umbrales nocturnos separados por franja horaria | Las fotos nocturnas son, de verdad, peor evidencia. El cruce con video gana peso en esos turnos donde existe |
| **Lluvia, guantes, manos ocupadas** | Reintentos de GPS y fotos repetidas alargan la ronda | Máximo 2 reintentos de GPS, de 10 s; la app nunca bloquea el cierre | — |
| **Sin señal durante todo el turno** | Sincroniza al otro día → techo | La ventana es de 24 h, no de 2 h | Una sede sin cobertura entera merece decisión comercial (repetidor, o rondas por WhatsApp con el techo 85), no un castigo diario |
| **Escena que de verdad no cambia** | pHash grita duplicado cada día | `escena_estatica` apaga la señal, o la plantilla fuerza un elemento variable | Quien arme mal la plantilla genera ruido. La pantalla de plantillas lo advierte; no hay forma de impedirlo |
| **Facial con piel oscura o poca luz** | Más falsos rechazos en un grupo específico | El facial **no da puntaje** (§2.6.8), solo veto, y el veto exige liveness calibrado que hoy no existe → está apagado | Cuando se encienda: calibrar por separado y **medir la tasa de error por tono de piel** antes de activarlo. Si la brecha es significativa, no se enciende |
| **Persona sin smartphone propio** | Queda fuera del canal bueno | Dispositivo compartido de la sede (`identidad` por PIN) o WhatsApp | Un dispositivo compartido debilita `identidad` e `identidad_compartida`; hay que registrarlo como tal para no alertar falsamente |
| **El que trabaja rápido y bien** | Duración por debajo del mínimo → penalización | El `minimo_s` es el **mínimo físico**, no el esperado (§2.6.6) | Si alguien pone los mínimos como metas de productividad, el motor se vuelve un capataz. Es un riesgo de gobierno, no de código: debe quedar escrito en el manual del módulo |

### 7.2 Riesgos del diseño

1. **El puntaje se usa para lo que no es.** El riesgo más grande de todo el ADR. Un número del
   0 al 100 al lado del nombre de una persona termina en una evaluación de desempeño tarde o
   temprano. Mitigaciones: el puntaje **no se muestra en el perfil de la persona**, solo en la
   visita; no hay ranking de conserjes por puntaje; y la pantalla dice, con todas las letras,
   para qué sirve y para qué no.
2. **Fatiga de alertas.** Si el 30 % de las visitas va a revisión, en un mes nadie revisa
   nada. **Meta operativa: menos del 5 % a revisión, y menos de 1 falso positivo por conserje
   por mes.** Se mide con lo que el supervisor decide: % de visitas enviadas a revisión que
   terminan confirmadas como fraude. Si baja del 20 %, hay que subir umbrales, no pedirle al
   supervisor que se esfuerce más.
3. **Calibración a ciegas.** Todos los umbrales de este documento son **puntos de partida
   razonados, no verdades**. Recaptura arranca en modo sombra; el facial arranca apagado; los
   demás se revisan al mes, a los tres meses y luego cada trimestre, con la simulación de
   §2.10.
4. **El almacenamiento, no la IA, es lo que crece.** Sin retención definida y aplicada, en tres
   años el bucket cuesta más que todos los modelos juntos. El `pg_cron` de borrado es parte
   del alcance, no un "después".
5. **Dependencia de un servicio externo en ruta crítica.** `services/facial` en Vercel con
   arranque en frío de 15 s. Mitigación: nada de lo que el conserje espera depende de él (todo
   va al worker) y los modelos se fijan en Blob.
6. **Fotos con terceros.** Las fotos de ronda capturan residentes, visitantes, placas. Eso es
   tratamiento de datos de terceros que no firmaron nada. Mitigación mínima: la plantilla
   indica encuadres que eviten personas, y el aviso de privacidad de la copropiedad (que el
   cliente debe tener) lo cubre. **Pendiente real:** evaluar difuminado automático de rostros
   en las fotos de ronda antes de archivarlas — técnicamente trivial con el YuNet que ya
   tenemos, pero destruye evidencia, así que es una decisión del cliente.

### 7.3 Pendientes abiertos (decisiones que no son de este ADR)

| # | Pendiente | De quién depende |
| --- | --- | --- |
| P1 | **Ed25519 vs. HMAC** en la firma del QR (§2.0). De esto depende si la verificación offline sirve de algo | `00-exploracion-y-plan.md` |
| P2 | Esquema definitivo de `evidencia_media` y nombres de columnas (§2.6) | `00-exploracion-y-plan.md` |
| P3 | Qué manda WhatsApp exactamente y qué se puede exigir en el bot (ubicación en tiempo real vs. puntual) | `adr-01-whatsapp.md` |
| P4 | **¿Existe la caja GPU on-premise?** De eso depende transcripción propia y liveness. Si no existe, hay que cotizarla o aceptar la nube con su trámite de habeas data | Decisión del negocio |
| P5 | Qué plataforma de video tienen las sedes y si expone una API para el cruce (§2.6.9). Hoy la señal de mayor peso después de la geocerca **no tiene integración** | Decisión del negocio |
| P6 | Corpus de calibración de recaptura (300 + 300 fotos) y quién lo arma | Operación |
| P7 | Texto nuevo del consentimiento biométrico para esta finalidad y revisión jurídica (§5.2) | Jurídica |
| P8 | Cola de trabajos: `pg_cron` + `SKIP LOCKED` (recomendado) o Vercel Queues (§3.6) | Equipo técnico, revisable |
| P9 | Difuminado de rostros de terceros en las fotos de ronda (§7.2.6) | Cliente + jurídica |
| P10 | Migrar las cuatro rutas de IA del repo al AI Gateway, todas juntas y no desde aquí (§3.5) | Otro momento |

---

## 8. Resumen de las decisiones

1. **El motor nunca rechaza.** Manda a revisión, siempre con motivo legible y prueba a la
   vista. Solo una persona declara "no se hizo", y el conserje puede responder.
2. **Puntaje = suma ponderada normalizada, con techos.** Nueve señales, pesos parametrizables,
   y techos por veto (40), cobertura baja (70), canal WhatsApp (85) y sincronización tardía
   (80). Los techos no son adorno: sin ellos, el ataque A4 (QR fotografiado) pasa con 78.
3. **`no_medible` baja el puntaje; `no_aplica` no.** Negar un permiso cuesta; una limitación
   autorizada del punto o del canal, no. Y una falla nuestra nunca cuesta: se re-puntúa.
4. **Las tres señales de imagen se montan sobre `services/facial`**, que ya tiene OpenCV,
   numpy, token y doble despliegue. No se crea un servicio nuevo ni una segunda pila en Node.
5. **Los hashes se escriben a mano, dos veces, con la especificación de §3.2**, porque el
   requisito duro es que el dispositivo offline y el servidor den el mismo número.
6. **La cola offline no puede falsificar la hora**: tres relojes (dispositivo, monotónico,
   ancla firmada del servidor) y una cadena de hashes. La hora oficial es la estimada por el
   servidor, no la del celular.
7. **La completitud ("te falta la foto del dispensador") es una regla, no un LLM**: funciona
   sin señal y en milisegundos. El LLM entra después, por encima, y puede apagarse entero.
8. **La IA no toca el puntaje.** Interpreta y pregunta; no decide quién es sospechoso.
9. **Todo lo que escribe un modelo se marca y se confirma** antes de cerrar la visita, con
   `texto_ia` y `texto_final` en columnas distintas.
10. **Firma, PIN y rostro valen lo mismo en el puntaje.** El valor del rostro entra por el
    veto, no por la nota — y hoy ese veto está apagado porque `services/facial` no tiene
    prueba de vida en serverless y una foto impresa pasaría.
11. **Costo estimado US$70–135 al mes** para 26.000 visitas; el grueso es el LLM y el que
    crece solo es el almacenamiento.
12. **Recaptura arranca en modo sombra y el facial arranca apagado.** Encender una señal sin
    calibrar es peor que no tenerla.

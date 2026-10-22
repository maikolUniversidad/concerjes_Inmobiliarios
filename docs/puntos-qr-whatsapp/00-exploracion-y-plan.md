# Puntos QR, Tareas y Bot de WhatsApp — Fase 0: exploración y plan

Documento de arranque. **No hay código ni migraciones todavía**: esto es el mapa
de lo que ya existe en el repositorio, el modelo de datos propuesto con las
convenciones reales que se encontraron, y el plan en cinco fases con las
decisiones que faltan por aprobar.

> **Léase junto con
> [02-complemento-2-integracion.md](docs/puntos-qr-whatsapp/02-complemento-2-integracion.md).**
> El prompt complementario 2 del usuario cambió el eje del modelo —**el
> contrato, no la sede**—, cerró tres decisiones que aquí quedaban abiertas y
> re-cortó las fases. Donde haya conflicto, manda ese documento. Las
> correcciones ya aplicadas a este archivo (`lng` en vez de `lon`, `grupo_id` en
> vez de `cliente_id`, el ADR-A con las dos apps) están marcadas en el texto.

Documentos hermanos de esta misma fase (los escriben otras sesiones; aquí solo
se referencian, no se duplican):

- `docs/puntos-qr-whatsapp/adr-01-whatsapp.md` — conexión con WhatsApp.
- `docs/puntos-qr-whatsapp/adr-02-antifraude-ia.md` — antifraude e IA.

---

## Parte 1 — Informe de exploración

### 1.1 Stack

| Capa | Qué se usa | Dónde se ve |
|---|---|---|
| Monorepo | npm workspaces (`apps/*`, `packages/*`) + Turborepo 2 | [package.json](package.json), [turbo.json](turbo.json) |
| Consola web | Next.js 16 App Router, React 19, TypeScript 5.7, Tailwind 3 + Radix, `@tanstack/react-table`, Recharts, framer-motion, sonner, zustand, zod + react-hook-form | [apps/inventario/package.json](apps/inventario/package.json), [apps/inventario/next.config.ts](apps/inventario/next.config.ts) |
| Base de datos | Supabase (PostgreSQL). **105 migraciones** SQL numeradas por fecha | [supabase/migrations](supabase/migrations) |
| Autenticación | Supabase Auth con `@supabase/ssr` (cliente server/browser propios) | [apps/inventario/lib/supabase](apps/inventario/lib/supabase) |
| Autorización | Permisos en JSONB (`roles.permisos` + `usuarios.permisos`) y RLS que los lee con `auth_permiso()` / `auth_permiso_any()` | [apps/inventario/lib/permisos.ts](apps/inventario/lib/permisos.ts), [apps/inventario/lib/permisos-server.ts](apps/inventario/lib/permisos-server.ts), [supabase/migrations/20260828000000_rls_permisos_dinamicos.sql](supabase/migrations/20260828000000_rls_permisos_dinamicos.sql) |
| Archivos / medios | Supabase Storage, **un bucket privado por módulo**: `avatares`, `gestion-humana`, `ordenes-insumo`, `registro-vacantes`, `logistica-evidencia`, `maquinaria`, `mantenimiento`, `soporte`, `pqrs`, `fotos-servicio`, `plantillas-documentos`… | p. ej. [supabase/migrations/20261018000004_pqrs.sql:623](supabase/migrations/20261018000004_pqrs.sql) |
| Colas / trabajos | **No hay cola de mensajes.** Hay *cron de Vercel* cada 5 minutos que dispara dos route handlers, y un *outbox* propio en el cliente offline | [vercel.json](vercel.json), [apps/inventario/app/api/cron/correo/route.ts](apps/inventario/app/api/cron/correo/route.ts), [apps/inventario/app/api/cron/flujos/route.ts](apps/inventario/app/api/cron/flujos/route.ts), [packages/offline/src/outbox.ts](packages/offline/src/outbox.ts) |
| Tiempo real | Supabase Realtime: `REPLICA IDENTITY FULL` + `ALTER PUBLICATION supabase_realtime ADD TABLE` (lo usan PQRS, Soporte y Mantenimiento para el chat) | [supabase/migrations/20261018000004_pqrs.sql](supabase/migrations/20261018000004_pqrs.sql) |
| IA | OpenAI y DeepSeek por variables de entorno (`OPENAI_MODEL_CHAT`, `OPENAI_MODEL_VISION`, `OPENAI_MODEL_TRANSCRIBE`, `DEEPSEEK_*`) | [turbo.json](turbo.json), [apps/inventario/app/api/ia/chat/route.ts](apps/inventario/app/api/ia/chat/route.ts), [apps/inventario/app/api/ia/transcribe/route.ts](apps/inventario/app/api/ia/transcribe/route.ts) |
| Facial | Microservicio Python aparte (ONNX Runtime + OpenCV YuNet + ArcFace 512-d), sin estado, con `Bearer` token | [services/facial/README.md](services/facial/README.md), [services/facial/api/index.py](services/facial/api/index.py) |
| App nativa | `apps/movil`: Vite + React 18 + Capacitor 6 (Android/iOS) + Electron, Dexie para el almacén local | [apps/movil/package.json](apps/movil/package.json) |
| QR / códigos | `qrcode` (generación en el cliente), `jsbarcode`, `@ericblade/quagga2` (lectura de códigos de barras) | [apps/inventario/package.json](apps/inventario/package.json) |
| PDF | `pdf-lib`, `@react-pdf/renderer` y `jspdf` (coexisten según el caso) | [apps/inventario/lib/documentos/paquete.ts](apps/inventario/lib/documentos/paquete.ts), [apps/inventario/app/(dashboard)/ordenes-insumo/[id]/DocumentosPDF.tsx](apps/inventario/app/(dashboard)/ordenes-insumo/[id]/DocumentosPDF.tsx) |
| Correo | `nodemailer` + `imapflow`, con motor de plantillas y flujos propio | [apps/inventario/lib/notificaciones](apps/inventario/lib/notificaciones) |
| Despliegue | Vercel (push a `master` despliega inventario). **Las migraciones se aplican a mano**, Vercel no las corre | [.claude/skills/aplicar-migracion/SKILL.md](.claude/skills/aplicar-migracion/SKILL.md) |

Idioma y zona: todo el texto de interfaz en español de Colombia; fechas en
`America/Bogota` (zona fija a propósito, para no romper la hidratación de Next).

### 1.2 Estructura del monorepo

```
apps/inventario/          consola web (Next.js App Router)
  app/
    (auth)/               login, cambiar-clave
    (dashboard)/          37 módulos con sesión y permisos  ← aquí va la consola
    (print)/              vistas de impresión sin chrome de la app
    registro-vacantes/    ruta PÚBLICA (sin sesión): wizard del candidato
    api/                  auth, cron, gestion-humana, ia, integraciones,
                          plantilla-pedido, registro, usuarios
  components/             ui, layout, firma, foto, escaner, documentos, soporte…
  lib/                    supabase/, permisos.ts, permisos-server.ts, ia/,
                          notificaciones/, documentos/, escaner/, pqrs/, soporte/…
apps/movil/               Capacitor + Electron (offline-first)
packages/offline/         motor offline (store Dexie, outbox, sync) sin framework
services/facial/          microservicio de reconocimiento facial (Python)
supabase/migrations/      105 migraciones, nombre `YYYYMMDD` + contador
scripts/                  aplicar migraciones, auditar permisos, cargues masivos
docs/                     diseño por módulo (p. ej. docs/programacion-personal.md)
```

Cada módulo de `app/(dashboard)/<ruta>/` sigue el mismo patrón:
`page.tsx` (server, hace el guard y trae los datos) + `<Modulo>Client.tsx`
(cliente, pinta y escribe) + opcionalmente `actions.ts` y `[id]/`.
Ejemplos de referencia, de más nuevo a más viejo:
[pqrs](apps/inventario/app/(dashboard)/pqrs),
[soporte](apps/inventario/app/(dashboard)/soporte),
[mantenimiento](apps/inventario/app/(dashboard)/mantenimiento),
[parametrizacion](apps/inventario/app/(dashboard)/parametrizacion).

### 1.3 Cómo se registra un módulo nuevo

**Sí hay checklist escrita en el repo**:
[.claude/skills/nuevo-modulo/SKILL.md](.claude/skills/nuevo-modulo/SKILL.md).
Resumen de lo que exige, con lo que se verificó en el código:

1. **Migración** (agente `supabase-migraciones`): tablas + RLS con
   `auth_permiso` / `auth_permiso_any`, funciones `SECURITY DEFINER` para las
   escrituras, permisos sembrados. Se aplica a mano con
   `NODE_OPTIONS=--use-system-ca node scripts/apply-migrations.mjs <archivo>`
   ([skill aplicar-migracion](.claude/skills/aplicar-migracion/SKILL.md)).
2. **Permisos**: la clave nueva va al catálogo de
   [apps/inventario/lib/permisos.ts](apps/inventario/lib/permisos.ts) en su
   grupo (`GRUPOS_PERMISOS`). El catálogo es estable; lo dinámico es la
   asignación por rol, que vive en la base. **`/roles` es la única fuente de
   verdad** de quién tiene qué.
3. **Menú**: ítem en
   [apps/inventario/components/layout/navigation.ts](apps/inventario/components/layout/navigation.ts)
   con su `permiso` y un icono lucide no repetido en el mismo grupo. La misma
   estructura alimenta el sidebar de escritorio y la barra inferior móvil.
4. **Página**: `app/(dashboard)/<ruta>/page.tsx` con
   `await requirePermiso('ver_x')`
   ([permisos-server.ts:52](apps/inventario/lib/permisos-server.ts)),
   `export const dynamic = 'force-dynamic'`, lectura con
   **`traerTodo`** y un `.order()` estable, y `numeric` → `Number`.
5. **Paginación**: obligatoria.
   [apps/inventario/lib/supabase/paginado.ts](apps/inventario/lib/supabase/paginado.ts)
   explica por qué: PostgREST corta toda respuesta en 1.000 filas sin avisar, y
   `.limit(5000)` no levanta el tope. `traerTodo` pide por páginas con
   `.range()`; por eso el `.order()` tiene que ser estable (columna + `id`).
6. **Escrituras**: dos patrones conviven y hay que elegir a conciencia.
   - *Módulos nuevos* (PQRS, Soporte, Mantenimiento): **todo por RPC**
     `SECURITY DEFINER` llamada desde el cliente
     (`sb.rpc('pqrs_radicar', …)`, `sb.rpc('mant_reportar', …)`). No tienen
     `actions.ts`.
   - *Módulos anteriores* (productos, órdenes, bodegas…): server actions en
     `actions.ts` con `'use server'`, guard `faltaPermiso`, `(supabase as any)`
     para escribir y `revalidatePath`.
7. **Lógica pura** en `lib/<modulo>.ts` (testeable con vitest; ver
   [docs/pruebas.md](docs/pruebas.md)).
8. **Verificación**: `npx tsc --noEmit -p .` en `apps/inventario`;
   `node scripts/auditar-permisos.mjs` y `scripts/verificar-permisos.mjs` /
   `scripts/verificar-lecturas.mjs` sin incoherencias nuevas; revisión visual
   con la skill [banco-pruebas](.claude/skills/banco-pruebas/SKILL.md).
9. **Repo público**: nada de nombres de personas reales ni datos personales.

**Convención de migraciones** (observada en las 105 existentes):

- Nombre `YYYYMMDD` + contador de 6 dígitos + slug:
  `20261018000004_pqrs.sql`. Cuando dos sesiones colisionan en la misma fecha se
  renumeran (commit `f0f7437`).
- Encabezado largo en comentarios que explica el flujo, los permisos y las
  trampas; `SET search_path TO public;`; **IDEMPOTENTE** de punta a punta
  (`CREATE TABLE IF NOT EXISTS`, `DROP POLICY IF EXISTS` antes de `CREATE POLICY`,
  `INSERT … ON CONFLICT DO NOTHING`).
- `UUID PRIMARY KEY DEFAULT gen_random_uuid()`, `VARCHAR(n)` con
  `CHECK (… IN ('MAYUSCULAS'))` en vez de enums nuevos, `created_at` /
  `updated_at TIMESTAMPTZ DEFAULT NOW()` con trigger `set_updated_at()`
  ([init:276](supabase/migrations/20240101000000_init.sql)).
- Columnas desnormalizadas `*_nombre` para los listados cuando el lector no
  tiene permiso de ver la entidad origen (p. ej. `pqrs.persona_nombre`, porque
  el Conserje no tiene `ver_personas`).
- Número legible desde `SEQUENCE` (`pqrs_numero_seq` → `PQ-00001`).
- Un patrón de funciones de alcance por módulo:
  `pqrs_acceso()`, `pqrs_ve_todo()`, `pqrs_mi_sede()`, `pqrs_coordina()`,
  `pqrs_ve_sede()`, `pqrs_puede_ver()` — todas
  `STABLE SECURITY DEFINER SET search_path = public` y con
  `GRANT EXECUTE … TO authenticated`. Las políticas las invocan como
  `(SELECT public.pqrs_ve_todo())` para que el planner las evalúe una vez.
- Storage: bucket privado por módulo con `file_size_limit`, ruta
  `{entidad_id}/{archivo}` y políticas que derivan la carpeta con una función
  (`pqrs_carpeta(name)`).
- Eventos de notificación sembrados en `eventos_notificacion`
  ([notificaciones_workflow.sql:133](supabase/migrations/20260829000000_notificaciones_workflow.sql)).

### 1.4 Qué se reutiliza y qué se extiende

| Módulo existente | Qué se REUTILIZA tal cual | Qué hay que EXTENDER |
|---|---|---|
| **/equipo + /mantenimiento** ([equipo/[ref]/page.tsx](apps/inventario/app/(dashboard)/equipo/[ref]/page.tsx), [20260914000000_mantenimiento_maquinaria.sql](supabase/migrations/20260914000000_mantenimiento_maquinaria.sql)) | El patrón completo "QR → ficha de campo → reportar": `/equipo/<codigo>` resuelve por código o UUID; tickets con chat (`mantenimiento_mensajes`), actividades con checklist y fotos (`mantenimiento_actividades`), transiciones por RPC (`mant_reportar`, `mant_transicion`, `mant_registrar_actividad`), bitácora de sistema (`mant_sistema`), generador de preventivos (`mant_generar_preventivos`) y el componente de QR imprimible ([MaquinariaQR.tsx](apps/inventario/app/(dashboard)/maquinaria/[id]/MaquinariaQR.tsx)). **La novedad de una visita debe crear un `mantenimiento_tickets`, no una tabla nueva de tickets.** | El QR de maquinaria es **sin firmar** y la ruta exige sesión. El punto de control necesita token HMAC, versión, revocación y una ruta pública corta. Las actividades de mantenimiento no tienen pasos versionados ni geocerca. |
| **/carnet** ([CarnetClient.tsx](apps/inventario/app/(dashboard)/carnet/CarnetClient.tsx)) | Generación de QR con `qrcode.toDataURL`, maquetación de la etiqueta, descarga PNG y arte con color institucional; el carné ya es "escanea para verificar identidad". | El arte de la etiqueta del punto (tamaño, troquel, lote, instrucciones) y la **impresión en PDF por lotes**, que hoy no existe (el carné imprime de a uno con `window.open`). |
| **/pqrs** ([20261018000004_pqrs.sql](supabase/migrations/20261018000004_pqrs.sql)) | Es el molde más limpio del repo: alcance por sede vía `rol_base`, escrituras solo por RPC, bitácora inmutable, plazos parametrizables en tabla, días hábiles (`pqrs_sumar_habiles`), realtime, bucket privado con función de carpeta. El canal `WHATSAPP` **ya está en el `CHECK` de `pqrs.canal`**. | Si una novedad del punto es una queja del cliente, debe poder radicarse como PQRS desde la visita (reusar `pqrs_radicar`). Falta cargar `pqrs_dias_no_habiles` — ahora hay `calendario_festivos` en programación, que debería alimentarla. |
| **/soporte** ([20261008000000_soporte_tickets.sql](supabase/migrations/20261008000000_soporte_tickets.sql)) | `soporte_tickets` + `soporte_mensajes` y el botón flotante de bug ([BotonSoporte.tsx](apps/inventario/components/soporte/BotonSoporte.tsx)) sirven igual en la PWA del trabajador. | Nada; solo habilitar el botón en la PWA y etiquetar el origen. |
| **/notificaciones** ([lib/notificaciones](apps/inventario/lib/notificaciones), [20260829000000_notificaciones_workflow.sql](supabase/migrations/20260829000000_notificaciones_workflow.sql)) | `eventos_notificacion` + plantillas + flujos + el worker que corre por cron cada 5 minutos. Basta **sembrar los eventos nuevos** (`PUNTO_VISITA_VENCIDA`, `PUNTO_NOVEDAD`, `PUNTO_REPORTE_FIRMADO`…) y el motor los entrega. | Hoy el motor solo sabe de correo: hay que agregarle **canal WhatsApp** como medio de salida (eso lo define `adr-01-whatsapp.md`). Y sin cuenta de correo conectada los pasos de los flujos quedan omitidos. |
| **/gestion-humana** ([20240106000000_gestion_humana.sql:24](supabase/migrations/20240106000000_gestion_humana.sql), [20260910000000_planta_personal.sql](supabase/migrations/20260910000000_planta_personal.sql)) | **La entidad de persona es la tabla `personas`** (PK `id`, `documento UNIQUE` como clave de deduplicación, `sede_id`, `cargo`, `estado`, `email`, `telefono`). El vínculo laboral vive aparte en **`persona_vinculaciones`** (centro de costo, cargo, contrato, obra, una sola `ACTIVA` por persona). Los usuarios de la app son `usuarios` (ligados a `auth.users`), que es **otra cosa**: hay 6.564 personas y ~859 cuentas. | El trabajador de campo entra con su celular personal y **puede no tener fila en `usuarios`**. Hay que resolver cómo se autentica una `persona` sin cuenta (ADR de identidad) y agregarle canal de WhatsApp verificado y consentimientos. |
| **Programación de personal** ([20261018000005_programacion_fase1.sql:138](supabase/migrations/20261018000005_programacion_fase1.sql), [docs/programacion-personal.md](docs/programacion-personal.md)) | **`puestos`** ya es el nivel físico dentro de la sede ("el hall, L-D, 6 a 22, un operario"), con `dias_cobertura SMALLINT[]`, `hora_desde/hora_hasta`, `cubre_24h` y `centro_costo_id`. **`turno_patrones`** y **`calendario_festivos` + `festivos_colombia(anio)`** ya existen. | El punto de control es más fino que el puesto (un puesto tiene varios puntos). La ventana horaria de una asignación debe poder heredar la del puesto en vez de redefinirla. |
| **/documentos** ([lib/documentos](apps/inventario/lib/documentos), [20260923000002_paquetes_documentos.sql](supabase/migrations/20260923000002_paquetes_documentos.sql)) | Plantillas HTML con variables, render, `sha256` del documento, firma electrónica con evidencia y **paquete de varios documentos en un solo PDF**; `PadFirma` ([components/firma/PadFirma.tsx](apps/inventario/components/firma/PadFirma.tsx)) y la firma uno tras otro ([FirmaSecuencial.tsx](apps/inventario/app/registro-vacantes/mi-proceso/FirmaSecuencial.tsx)). | El reporte de visita es una plantilla más: hay que definir su plantilla y su hoja de evidencias (fotos en rejilla, mapa del punto). |
| **/ia** ([api/ia/chat](apps/inventario/app/api/ia/chat/route.ts), [api/ia/transcribe](apps/inventario/app/api/ia/transcribe/route.ts)) | Chat con OpenAI/DeepSeek y **transcripción de audio en español ya montada** (Whisper, tope 25 MB) — es exactamente lo que necesita el paso "nota de voz transcrita". Y `OPENAI_MODEL_VISION` para leer evidencia. | El CRM operado por IA (clasificar, resumir, sugerir respuesta, detectar recaptura). Eso lo define `adr-02-antifraude-ia.md`. |
| **apps/movil + packages/offline** ([outbox.ts](packages/offline/src/outbox.ts), [types.ts](packages/offline/src/types.ts)) | El motor offline es **framework-agnóstico**: `Sb` es estructural, el outbox encola *intents* con escritura optimista y `PushRegistry` mapea cada intent a `upsertHandler` / `rpcHandler` / `updateHandler`; el sync trae por watermark (`incremental`, `append`, `full`). El APK de Android ya compila. | El motor no guarda **binarios** (fotos/video/audio) ni reintenta subidas a Storage: hay que agregarle una cola de medios. Y `apps/movil` es React 18 + Vite, separada de la consola (React 19 + Next): compartir pantallas entre las dos no es gratis. |
| **services/facial** ([README](services/facial/README.md)) | Contrato ya cerrado: `POST /face/identify` y `/face/enroll` devuelven embedding ArcFace 512-d + `quality` + `liveness_score`; umbrales por entorno (`FACIAL_UMBRAL_MATCH`, `FACIAL_UMBRAL_DUDA`, `FACIAL_LIVENESS_MIN`); no persiste imágenes. Se usa ya en [registro-vacantes/CapturaFacial.tsx](apps/inventario/app/registro-vacantes/CapturaFacial.tsx). | Hoy se despliega con `LIVENESS_MODE=none`: **no hay prueba de vida real**. Es trabajo de la fase 5 / `adr-02-antifraude-ia.md`. |
| **Logística / conductor** ([20260728000000_conductor_module.sql](supabase/migrations/20260728000000_conductor_module.sql)) | **Ya hay precedente de GPS en el repo**: `conductor_ubicacion_actual` / `_historial` con `lat DECIMAL(10,7)`, `lng`, `precision_metros DECIMAL(8,2)`; `novedades_entrega` y `confirmaciones_entrega` con lat/lng y evidencia en el bucket `logistica-evidencia`; mapas con `leaflet`. | No hay geocerca (radio + comparación): hay que calcularla. |
| **Otros reutilizables sueltos** | [components/foto/CamaraFoto.tsx](apps/inventario/components/foto/CamaraFoto.tsx) (cámara en vivo con guía y revisión, devuelve JPEG) · [lib/escaner](apps/inventario/lib/escaner) (endereza una hoja fotografiada) · [components/ui/tabla](docs/tablas-parametrizadas-portable.md) (tabla parametrizada con filtros, copiado y Excel) · `actividad_log` ([init:610](supabase/migrations/20240101000000_init.sql)) | `CamaraFoto` es vertical 3:4 con guía de rostro: hay que generalizarla a evidencia libre, exigir cámara en vivo (sin galería) y poder pedir el QR dentro del encuadre. `actividad_log` no es append-only ni encadenado. |

### 1.5 Qué NO existe todavía y hay que construir

1. **Zona y punto de control dentro de la sede.** El modelo llega a `sedes` →
   `puestos`; no hay piso/área ni punto físico con coordenadas, geocerca ni
   fotos de referencia.
2. **QR firmado y versionado.** Los QR del repo (`maquinaria`, `carnet`) llevan
   una URL con un código en claro y no se pueden revocar ni rotar.
3. **Ruta pública corta.** La única ruta sin sesión es `/registro-vacantes`.
   No hay `/p/<codigo>` ni verificación de firma.
4. **Catálogo de tareas parametrizable y versionado.** El checklist de
   mantenimiento es un `JSONB` libre dentro de la actividad; no hay plantilla
   con pasos tipados, mínimos y máximos de foto, pasos condicionales,
   ni material instructivo.
5. **Asignación de plantilla a punto** con frecuencia, ventana, tolerancia, SLA.
6. **Visita** con hora de servidor y de dispositivo, geocerca y puntaje de
   confianza; **evidencia con huella** (`sha256`, hash perceptual, EXIF,
   detección de recaptura, QR detectado en la imagen).
7. **Geocerca** (distancia punto–lectura contra radio en metros).
8. **PWA del trabajador.** `next-pwa` está en las dependencias pero
   **no se usa**: no hay `manifest`, ni service worker, ni `manifest.webmanifest`
   en `apps/inventario`. La cola offline existe solo en `apps/movil`.
9. **Cola de medios offline** (binarios con reintento).
10. **Canal WhatsApp**: no hay webhook, ni tabla de conversaciones, ni envío.
11. **CRM de conversaciones** (casos, etiquetas, asignación de agente, SLA).
12. **Auditoría append-only con hash encadenado.**
13. **Impresión por lotes en PDF** de etiquetas de QR.
14. **Consentimientos de una `persona`** (los `consentimientos` existentes
    cuelgan de `candidatos`, no de `personas`).
15. **Cola de trabajos real.** El cron de Vercel cada 5 minutos sirve para
    correo, pero no para responder un webhook de WhatsApp en segundos.

---

## Parte 2 — Modelo de datos propuesto

> **Tres cambios del complemento 2 que afectan a todas las tablas de abajo:**
> (1) toda tabla operativa lleva **`grupo_id NOT NULL`** (el contrato) además de
> `sede_id`, y los catálogos lo llevan nullable con `NULL` = "aplica a todos los
> contratos" — el reparto columna por columna está en la §2.4 del
> [complemento 2](docs/puntos-qr-whatsapp/02-complemento-2-integracion.md);
> (2) `ronda_qr` gana `tipo_objeto` (`PUNTO / ACTIVO`) y `activo_id`, para que
> el mismo motor de QR sirva a los activos de mantenimiento;
> (3) `ronda_visitas` gana `ticket_id`, porque la orden de trabajo se ejecuta
> con este mismo motor de visitas. Las coordenadas son **`lat` / `lng`**, como
> en el resto del repo.

### 2.0 Prefijo y nomenclatura

El repo nombra las tablas de un módulo con **prefijo = nombre del módulo**
(`pqrs_*`, `mantenimiento_*`, `soporte_*`, `vac_*`). Dos prefijos quedan
descartados:

- `puntos_*` ya está ocupado por el módulo de recompensas
  (`parametros_puntos`, `movimientos_puntos`).
- `control_*` se lee como "control de acceso" y confunde: `control_acceso()`
  sería un nombre de función ambiguo.

**Propuesta: prefijo `ronda_`** para el núcleo operativo (es la palabra que la
operación ya usa: *rondas de conserjería con puntos de control*), y `crm_` para
las conversaciones. Las entidades que extienden a la persona van con el prefijo
`persona_`, como ya hace `persona_vinculaciones`.

Convenciones que se respetan: `UUID` PK, `VARCHAR(n)` + `CHECK IN (…)` en
mayúsculas, `created_at`/`updated_at` con `set_updated_at()`, `*_nombre`
desnormalizado para listados, número legible desde `SEQUENCE`, `lat`/`lng`
`DECIMAL(10,7)` y `precision_metros DECIMAL(8,2)` como en el módulo conductor.

### 2.1 Estructura: de la sede al punto

```
grupos_contrato → sedes → puestos (existe) → ronda_zonas → ronda_puntos
```

**`ronda_zonas`** — piso o área dentro de la sede.

| Campo | Tipo | Notas |
|---|---|---|
| `id` | UUID PK | |
| `sede_id` | UUID NOT NULL → `sedes` | ON DELETE CASCADE |
| `puesto_id` | UUID → `puestos` | opcional: la zona puede colgar del puesto comprado |
| `codigo` | VARCHAR(40) NOT NULL | único por sede |
| `nombre` | VARCHAR(200) NOT NULL | "Torre A — piso 3" |
| `piso` | VARCHAR(20) | texto: hay "SÓTANO 2", "MEZZANINE" |
| `orden` | INT DEFAULT 0 | orden de recorrido |
| `activo` | BOOLEAN DEFAULT true | |

`UNIQUE (sede_id, codigo)`.

**`ronda_puntos`** — el punto de control físico.

| Campo | Tipo | Notas |
|---|---|---|
| `id` | UUID PK | |
| `sede_id` | UUID NOT NULL → `sedes` | redundante con la zona **a propósito**: es la columna por la que filtra la RLS |
| `zona_id` | UUID → `ronda_zonas` | ON DELETE SET NULL |
| `codigo` | VARCHAR(20) NOT NULL | código corto legible; `UNIQUE (sede_id, codigo)` |
| `nombre` | VARCHAR(200) NOT NULL | |
| `descripcion` | TEXT | cómo llegar |
| `piso` | VARCHAR(20) | |
| `lat`, `lng` | DECIMAL(10,7) | del momento de la instalación |
| `precision_metros` | DECIMAL(8,2) | precisión GPS **al crearlo** (si fue mala, la geocerca no es confiable) |
| `geocerca_metros` | SMALLINT NOT NULL DEFAULT 30 | `CHECK BETWEEN 5 AND 2000` |
| `exige_geocerca` | BOOLEAN NOT NULL DEFAULT true | hay sótanos sin señal |
| `fotos_referencia` | TEXT[] DEFAULT '{}' | rutas en el bucket `rondas` |
| `horario_dias` | SMALLINT[] DEFAULT '{1,2,3,4,5,6,7}' | 1=lunes … 7=domingo, igual que `puestos.dias_cobertura` |
| `horario_desde`, `horario_hasta` | TIME | NULL = aplica siempre |
| `estado` | VARCHAR(12) DEFAULT 'BORRADOR' | `BORRADOR / ACTIVO / SUSPENDIDO / RETIRADO` |
| `sede_nombre` | VARCHAR(400) | desnormalizado para listados |
| `created_by`, `created_at`, `updated_at` | | |

### 2.2 `ronda_qr` — el código y su ciclo de vida

Un punto tiene **muchas** filas de QR (una por versión); solo una `ACTIVO`.

| Campo | Tipo | Notas |
|---|---|---|
| `id` | UUID PK | |
| `punto_id` | UUID NOT NULL → `ronda_puntos` | |
| `version` | SMALLINT NOT NULL | `UNIQUE (punto_id, version)` |
| `token` | VARCHAR(64) NOT NULL UNIQUE | lo que viaja en el QR: el `payload` firmado (ver ADR-B) |
| `firma_llave_id` | VARCHAR(40) NOT NULL | **identificador** de la llave HMAC-SHA256 usada (nunca el secreto: el secreto vive en variables de entorno / KMS y rota) |
| `codigo_manual` | CHAR(8) NOT NULL UNIQUE | `K7M4QX9T`, se muestra como `K7M-4QX9` · alfabeto sin ambigüedades (sin `I`, `L`, `O`, `0`, `1`, `U`) |
| `estado` | VARCHAR(12) NOT NULL DEFAULT 'BORRADOR' | `BORRADOR / ACTIVO / REVOCADO / REEMPLAZADO` |
| `reemplaza_a` | UUID → `ronda_qr` | cadena de versiones |
| `motivo_cambio` | VARCHAR(200) | por qué se revocó o reemplazó |
| `instalado_at` | TIMESTAMPTZ | |
| `instalado_por` | UUID → `usuarios` | |
| `instalado_persona_id` | UUID → `personas` | quien lo pegó puede no tener cuenta |
| `instalado_canal` | VARCHAR(10) | `CONSOLA / APP / WHATSAPP` |
| `instalado_nombre` | VARCHAR(200) | desnormalizado |
| `foto_instalacion` | TEXT | ruta en el bucket |
| `lat`, `lng`, `precision_metros` | | ubicación capturada al instalar |
| `lote_id` | UUID → `ronda_qr_lotes` | |
| `impresiones` | SMALLINT NOT NULL DEFAULT 0 | cuántas veces se imprimió |
| `revocado_at`, `revocado_por` | | |

`UNIQUE INDEX` parcial: un solo QR activo por punto —
`CREATE UNIQUE INDEX ux_ronda_qr_activo ON ronda_qr(punto_id) WHERE estado = 'ACTIVO'`.

**`ronda_qr_lotes`** — tanda de impresión: `id`, `sede_id`, `nombre`,
`formato` (`ETIQUETA_50X50 / A4_12UP / …`), `grupo_id`
(→ `grupos_contrato`: el arte es del contrato — corregido por el complemento 2),
`pdf_path`, `cantidad`, `generado_por`, `generado_at`.

### 2.3 Catálogo parametrizable

**`ronda_tipos_actividad`** — catálogo plano y editable:
`id`, `codigo` (`ASEO`, `RONDA_VIGILANCIA`, `LECTURA_CONTADOR`, `APERTURA`…),
`nombre`, `descripcion`, `color`, `icono`, `orden`, `activo`.
Sigue el estilo de `pqrs_plazos` / `parametros_puntos`: tabla sembrada, no enum.

**`ronda_plantillas`** — plantilla de actividad **versionada**. Las versiones son
filas distintas porque una respuesta ya guardada tiene que seguir apuntando a la
versión con la que se contestó (igual que `documentos` guarda `html_render`).

| Campo | Notas |
|---|---|
| `id` UUID PK | |
| `codigo` VARCHAR(40) NOT NULL | estable entre versiones |
| `version` SMALLINT NOT NULL | `UNIQUE (codigo, version)` |
| `tipo_actividad_id` → `ronda_tipos_actividad` | |
| `nombre`, `descripcion` | |
| `estado` | `BORRADOR / PUBLICADA / ARCHIVADA` — solo una `PUBLICADA` por `codigo` (índice único parcial) |
| `duracion_estimada_min` SMALLINT | |
| `exige_firma` BOOLEAN | |
| `exige_geocerca` BOOLEAN | puede endurecer la del punto, no relajarla |
| `publicada_at`, `publicada_por`, `created_at`, `updated_at` | |

**`ronda_plantilla_pasos`** — pasos ordenados. Un `tipo` por paso y la
configuración específica en `config JSONB` validada por `CHECK`:

| Campo | Notas |
|---|---|
| `id` UUID PK · `plantilla_id` NOT NULL · `orden` SMALLINT NOT NULL | `UNIQUE (plantilla_id, orden)` |
| `tipo` VARCHAR(20) NOT NULL | `CASILLA / FOTO / VIDEO / TEXTO / NOTA_VOZ / NUMERO / SELECCION / ESCANEO / FIRMA` |
| `titulo` VARCHAR(200) · `ayuda` TEXT | |
| `obligatorio` BOOLEAN DEFAULT true | |
| `instructivo_id` → `ronda_instructivos` | el material que explica cómo hacerlo |
| `condicion_paso_id` → `ronda_plantilla_pasos` · `condicion_valor` VARCHAR(100) | **paso condicional**: solo aparece si ese paso respondió eso |
| `config` JSONB | ver abajo |

`config` por tipo (contrato documentado en `lib/ronda/pasos.ts`, lógica pura y
testeable):

- `CASILLA`: `{ "motivo_obligatorio_si_no": true }` — las opciones son
  **SÍ / NO / NO APLICA**; si es `NO`, el motivo es obligatorio (constraint en
  `ronda_respuestas`).
- `FOTO`: `{ "min": 1, "max": 4, "solo_camara_vivo": true, "exige_qr_en_encuadre": false, "lado": "ambiente|detalle" }`.
- `VIDEO`: `{ "segundos_max": 15 }`.
- `TEXTO`: `{ "min_caracteres": 0, "max_caracteres": 500 }`.
- `NOTA_VOZ`: `{ "segundos_max": 60, "transcribir": true }` → usa
  `/api/ia/transcribe`.
- `NUMERO`: `{ "min": 0, "max": 9999, "decimales": 2, "unidad": "L" }`.
- `SELECCION`: `{ "multiple": false, "opciones": [{"valor":"A","etiqueta":"…"}] }`.
- `ESCANEO`: `{ "entidad": "producto|maquinaria", "exige_existente": true }` →
  resuelve contra `productos` o `maquinaria`.
- `FIRMA`: `{ "quien": "trabajador|cliente", "permite_facial": true }`.

**`ronda_instructivos`** — material que explica el paso, versionado:
`id`, `codigo`, `version`, `titulo`, `tipo` (`FOTO / VIDEO / PDF / AUDIO`),
`archivo_path` (bucket `rondas`), `mime`, `tamano`, `duracion_seg`,
`texto` (transcripción o descripción, para búsqueda y para el bot),
`grupo_id` → `grupos_contrato` (NULL = aplica a todos los contratos; era
`cliente_id`, corregido por el complemento 2),
`estado`, `created_at`. `UNIQUE (codigo, version)`.

**`ronda_asignaciones`** — qué plantilla, en qué punto, cuándo y quién.

| Campo | Notas |
|---|---|
| `id` UUID PK | |
| `punto_id` NOT NULL → `ronda_puntos` · `sede_id` (desnormalizado para RLS) | |
| `plantilla_codigo` VARCHAR(40) NOT NULL | **apunta al código, no a la versión**: la asignación usa siempre la versión `PUBLICADA` |
| `frecuencia` VARCHAR(12) NOT NULL | `POR_TURNO / DIARIA / SEMANAL / MENSUAL / A_DEMANDA` |
| `veces_por_periodo` SMALLINT DEFAULT 1 | |
| `dias` SMALLINT[] DEFAULT '{1,…,7}' | mismo formato que `puestos.dias_cobertura` |
| `ventana_desde`, `ventana_hasta` TIME | NULL = hereda la del `puesto` de la zona |
| `tolerancia_min` SMALLINT DEFAULT 30 | cuánto puede llegar tarde sin marcar incumplimiento |
| `rol_id` → `roles` · `cargo_id` → `cargos` · `persona_id` → `personas` | asignación por rol, por cargo o nominal; al menos una, con `CHECK` |
| `prioridad` VARCHAR(10) DEFAULT 'MEDIA' | `BAJA / MEDIA / ALTA / CRITICA` (mismo vocabulario que `pqrs.prioridad`) |
| `sla_min` SMALLINT | tiempo máximo entre apertura y cierre de la visita |
| `vigente_desde`, `vigente_hasta` DATE · `activo` BOOLEAN | |

### 2.4 Ejecución

**`ronda_visitas`**

| Campo | Notas |
|---|---|
| `id` UUID PK · `numero` VARCHAR(30) UNIQUE | de `ronda_visita_numero_seq` → `RV-000001` |
| `punto_id`, `sede_id`, `zona_id`, `asignacion_id` | `sede_id` es la columna de alcance |
| `plantilla_id` NOT NULL → `ronda_plantillas` | **la versión exacta usada** |
| `persona_id` NOT NULL → `personas` · `usuario_id` → `usuarios` | la persona es el sujeto; el usuario puede ser NULL |
| `persona_nombre` VARCHAR(250) | desnormalizado (quien ve el tablero puede no tener `ver_personas`) |
| `canal` VARCHAR(10) NOT NULL | `APP / WHATSAPP / CONSOLA` |
| `qr_id` → `ronda_qr` · `apertura_modo` VARCHAR(10) | `QR / MANUAL / ASISTIDA` |
| `inicio_servidor`, `fin_servidor` TIMESTAMPTZ | **hora del servidor**, la que vale |
| `inicio_dispositivo`, `fin_dispositivo` TIMESTAMPTZ | la del celular; la diferencia es señal |
| `desfase_reloj_seg` INT | calculado, para el puntaje |
| `lat`, `lng`, `precision_metros` | de la apertura |
| `distancia_metros` DECIMAL(8,2) | al punto; NULL si no hubo GPS |
| `dentro_geocerca` BOOLEAN | |
| `estado` VARCHAR(12) NOT NULL DEFAULT 'ABIERTA' | `ABIERTA / EN_CURSO / COMPLETADA / INCOMPLETA / ANULADA / VENCIDA` |
| `puntaje_confianza` SMALLINT | 0–100, lo define `adr-02-antifraude-ia.md` |
| `motivo_fuera_geocerca` TEXT | obligatorio si `dentro_geocerca = false` |
| `offline` BOOLEAN DEFAULT false · `sincronizada_at` TIMESTAMPTZ | vino de la cola |
| `created_at`, `updated_at` | |

**`ronda_respuestas`** — una fila por paso contestado.
`id`, `visita_id` NOT NULL, `paso_id` NOT NULL → `ronda_plantilla_pasos`,
`plantilla_id` (redundante: deja explícita la versión con la que se contestó),
`orden`, `tipo`,
`valor_bool`, `valor_texto`, `valor_numero DECIMAL(14,4)`, `valor_opciones TEXT[]`,
`motivo` TEXT, `transcripcion` TEXT,
`entidad_tipo`/`entidad_id` (para `ESCANEO`),
`omitido` BOOLEAN + `omision_motivo`, `respondido_at`.
`UNIQUE (visita_id, paso_id)`.
Constraint: si `tipo='CASILLA'` y `valor_bool = false` entonces `motivo IS NOT NULL`.

**`ronda_evidencias`** — los medios, con su huella.
`id`, `visita_id` NOT NULL, `respuesta_id` → `ronda_respuestas`,
`tipo` (`FOTO / VIDEO / AUDIO`), `archivo_path` (bucket `rondas`), `mime`,
`tamano BIGINT`, `ancho`, `alto`, `duracion_seg`,
`sha256` CHAR(64) NOT NULL, `hash_perceptual` VARCHAR(32) (dHash/pHash, para
detectar la misma foto reusada), `exif JSONB`,
`origen` VARCHAR(12) (`CAMARA_VIVO / GALERIA / WHATSAPP / CONSOLA`),
`recaptura_resultado` VARCHAR(12) (`LIMPIA / SOSPECHOSA / PANTALLA / SIN_DATO`),
`recaptura_detalle JSONB`, `qr_detectado` VARCHAR(64) (el token leído dentro de
la imagen, si el paso lo exigía), `lat`, `lng`, `precision_metros`,
`capturado_dispositivo` TIMESTAMPTZ, `created_at`.
Índice por `sha256` y por `hash_perceptual` para cruzar repeticiones.

**`ronda_firmas`** — `id`, `visita_id` NOT NULL, `quien` (`TRABAJADOR / CLIENTE / SUPERVISOR`),
`metodo` (`TRAZO / FACIAL / OTP / NINGUNA`), `trazo_path` (PNG del
`PadFirma`), `facial_score DECIMAL(5,4)`, `facial_liveness DECIMAL(5,4)`,
`facial_modelo_version`, `alternativa_motivo` TEXT (**obligatorio si
`metodo <> 'FACIAL'` y la plantilla pedía facial**: el que no consiente
biometría firma con trazo y queda registrado por qué),
`nombre_firmante` VARCHAR(200), `documento_firmante` VARCHAR(30),
`sha256_firmado` CHAR(64), `ip` INET, `user_agent` TEXT, `firmado_at`.

**`ronda_reportes`** — el PDF cerrado de la visita.
`id`, `visita_id` UNIQUE NOT NULL, `numero`, `plantilla_doc_id` (plantilla HTML
de `/documentos`), `html_render` TEXT, `pdf_path`, `sha256` CHAR(64),
`generado_at`, `enviado_a` TEXT[], `enviado_at`.

**Novedades: no hay tabla nueva.** Lo que el trabajador reporta como novedad
crea un ticket en el módulo existente, y la visita solo guarda el puente:

**`ronda_novedades`** — `id`, `visita_id`, `respuesta_id`, `clase`
(`MANTENIMIENTO / PQRS / SOPORTE`), `ticket_id` (→ `mantenimiento_tickets.id`),
`pqrs_id` (→ `pqrs.id`), `soporte_id` (→ `soporte_tickets.id`), `descripcion`,
`created_at`. La RPC de cierre llama a `mant_reportar()` o a `pqrs_radicar()`
según la clase y guarda el id devuelto.

### 2.5 Personas y canales

Se reutiliza **`personas`** como entidad de persona (es la tabla, confirmado en
[20240106000000_gestion_humana.sql:24](supabase/migrations/20240106000000_gestion_humana.sql)),
con `persona_vinculaciones` para el vínculo laboral vigente.

**`persona_canales`** — el WhatsApp verificado (y futuros canales).
`id`, `persona_id` NOT NULL → `personas`, `canal` (`WHATSAPP / SMS / CORREO`),
`valor` VARCHAR(160) (E.164 para WhatsApp: `+57…`), `wa_id` VARCHAR(40),
`verificado` BOOLEAN DEFAULT false, `verificado_at`,
`verificacion_metodo` (`OTP / CONSOLA`), `principal` BOOLEAN,
`activo` BOOLEAN, `bloqueado_at` + `bloqueo_motivo`, `created_at`, `updated_at`.
`UNIQUE (canal, valor)` — un número pertenece a una sola persona.

**`persona_consentimientos`** — versionado, calcado de la tabla
`consentimientos` del ATS
([registro_vacantes.sql:288](supabase/migrations/20240114000000_registro_vacantes.sql))
pero colgando de `personas`:
`id`, `persona_id` NOT NULL, `tipo` (`UBICACION / FOTOS / AUDIO / BIOMETRIA /
WHATSAPP`), `otorgado` BOOLEAN NOT NULL, `texto_version` TEXT NOT NULL,
`texto_hash` TEXT NOT NULL, `canal` (`APP / WHATSAPP / CONSOLA / PAPEL`),
`ip` INET, `user_agent` TEXT, `created_at`, `revocado_at`.
**`BIOMETRIA` es un tipo aparte y revocable**: sin él, la firma facial no se
ofrece y se usa el trazo (ver Parte 4, Ley 1581 de 2012).

### 2.6 Conversaciones del CRM

**`crm_conversaciones`** — `id`, `canal` (`WHATSAPP / WEB`), `canal_id`
VARCHAR(64) (el `wa_id` del hilo), `persona_id` → `personas`,
`contacto_nombre`, `contacto_valor`, `sede_id`, `estado`
(`ABIERTA / EN_ESPERA / CERRADA`), `ultimo_mensaje_at`,
`ventana_24h_vence_at` TIMESTAMPTZ (regla de la plataforma; la define
`adr-01-whatsapp.md`), `no_molestar` BOOLEAN, `created_at`, `updated_at`.
`UNIQUE (canal, canal_id)`.

**`crm_mensajes`** — `id`, `conversacion_id` NOT NULL, `direccion`
(`ENTRADA / SALIDA`), `tipo` (`TEXTO / IMAGEN / AUDIO / VIDEO / DOCUMENTO /
UBICACION / PLANTILLA / BOTON`), `texto`, `archivo_path`, `mime`,
`transcripcion`, `externo_id` VARCHAR(80) UNIQUE (idempotencia del webhook),
`estado_envio` (`PENDIENTE / ENVIADO / ENTREGADO / LEIDO / FALLIDO`),
`error` TEXT, `autor_tipo` (`PERSONA / AGENTE / BOT / SISTEMA`),
`autor_usuario_id` → `usuarios`, `visita_id` → `ronda_visitas` (cuando el
mensaje es parte de una visita por WhatsApp), `created_at`.
Realtime, como `pqrs_bitacora`.

**`crm_casos`** — `id`, `numero` VARCHAR(30) UNIQUE (`CS-00001`),
`conversacion_id`, `tipo`, `estado` (`NUEVO / EN_TRAMITE / EN_ESPERA /
RESUELTO / CERRADO`), `prioridad`, `sede_id`, `asunto`, `resumen_ia` TEXT,
`clasificacion_ia` JSONB, `pqrs_id`, `ticket_id`, `abierto_at`, `cerrado_at`.

**`crm_etiquetas`** (`id`, `codigo` UNIQUE, `nombre`, `color`, `activo`) y
**`crm_caso_etiquetas`** (`caso_id`, `etiqueta_id`, PK compuesta).

**`crm_asignaciones`** — historial de a quién le toca:
`id`, `caso_id` NOT NULL, `usuario_id` → `usuarios`, `usuario_nombre`,
`asignado_por`, `motivo`, `desde`, `hasta`.

**`crm_sla`** — `id`, `caso_id` UNIQUE, `prioridad`, `minutos_primera_respuesta`,
`minutos_resolucion`, `vence_primera_at`, `vence_resolucion_at`,
`primera_respuesta_at`, `resuelto_at`, `incumplido` BOOLEAN,
`pausado_min` INT. Los topes por prioridad en **`crm_sla_reglas`**
(tabla parametrizable, al estilo de `pqrs_plazos`).

### 2.7 Auditoría

**`ronda_eventos`** — solo agregar, sin `UPDATE` ni `DELETE` (la RLS no concede
esos comandos y la tabla no tiene `updated_at`):
`id` BIGSERIAL, `entidad` VARCHAR(40), `entidad_id` UUID, `accion` VARCHAR(40),
`actor_tipo` (`USUARIO / PERSONA / BOT / SISTEMA`), `actor_usuario_id`,
`actor_persona_id`, `actor_nombre`, `canal`, `detalle` JSONB,
`ip` INET, `hash_anterior` CHAR(64), `hash` CHAR(64), `created_at`.

El **encadenado es opcional y por entidad**: `hash = sha256(hash_anterior ||
entidad || entidad_id || accion || detalle::text || created_at)`, calculado en
un trigger `BEFORE INSERT`. Si se decide no encadenar, las dos columnas quedan
NULL y la tabla sigue sirviendo. Esto complementa `actividad_log`, que seguirá
recibiendo lo de siempre pero no es append-only ni encadenado.

### 2.8 Decisión: jerarquía multi-cliente y `tenant_id`

> **Matizada por el complemento 2.** La conclusión de no agregar `tenant_id`
> **se mantiene**, pero el eje del alcance **pasa de la sede al contrato**
> (`grupos_contrato`), con la sede como segundo filtro, y toda tabla operativa
> lleva `grupo_id NOT NULL`. El razonamiento completo, con los tres hallazgos
> del repo que lo justifican, está en la §2 de
> [02-complemento-2-integracion.md](docs/puntos-qr-whatsapp/02-complemento-2-integracion.md).
> Lo que sigue es el razonamiento original, que explica por qué no hay
> `tenant_id`.

**Lo que el repo modela hoy**

- `grupos_contrato` → `sedes` (197 sedes) → `puestos` (cobertura comprada).
- El cliente vive en **`empresas_usuarias`** (gestión humana) y el contrato de
  servicio en **`obras`** (`codigo_contrato_servicio`, `cliente_id`); el
  contrato laboral es **`contratos`** (otra cosa).
- `centros_costo` es el eje de nómina; `sedes.centro_costo_id` es el puente que
  agregó programación fase 1, y hoy está **sin confirmar** en la mayoría.
- El **alcance de la RLS** se decide con `usuarios.rol` (sincronizado con
  `roles.rol_base`) y `usuarios.sede_id`: `OPERADOR_SEDE` ve su sede,
  `SUPERVISOR`/`ADMIN`/`SUPER_ADMIN` ven todo. No hay ninguna columna
  `tenant_id` en las 105 migraciones.

**Decisión: NO se agrega `tenant_id`.** Razones:

1. Hay **un solo operador** (la empresa). "Multi-cliente" aquí significa
   muchos clientes de un mismo operador, no muchos operadores sobre la misma
   base. `tenant_id` resolvería un problema que no existe y obligaría a tocar
   las 105 migraciones y toda la RLS ya auditada.
2. El alcance por sede **ya alcanza** para este módulo: cada punto pertenece a
   una sede, y el conserje solo debe ver la suya. Es exactamente el eje que
   `pqrs_ve_sede()` resuelve; se replica como `ronda_ve_sede()`.
3. Lo que **sí hace falta** es un nivel por encima de la sede para
   *parametrizar* (arte del QR, instructivos y plantillas propias). Eso se
   resuelve con una columna **`grupo_id → grupos_contrato`** **opcional** en
   `ronda_plantillas`, `ronda_instructivos` y `ronda_qr_lotes`, heredada de la
   sede cuando está vacía — el mismo patrón de "NULL = aplica a todos" que usa
   `sede_productos` en parametrización. (Aquí decía `cliente_id →
   empresas_usuarias`; el complemento 2 lo corrigió a `grupo_id`, porque el
   contrato, no el cliente, es el eje.)

La jerarquía queda entonces:

```
empresas_usuarias (cliente)   obras (contrato de servicio)
          ╲                        ╱
       grupos_contrato → sedes → puestos → ronda_zonas → ronda_puntos
                           │
                    centros_costo (nómina)
```

**Riesgo asumido y mitigación.** Si algún día la plataforma se vende a otro
operador, la salida es un esquema por operador en Postgres (o una base aparte),
no una columna. Y mientras no exista, el **secreto HMAC se segmenta por cliente
o por grupo de contrato** (`ronda_qr.firma_llave_id`), que es lo que la tarea
pedía como "llave por tenant": una llave por cliente, rotable, sin que el
modelo necesite un tenant.

---

## Parte 3 — Plan de implementación

> **Re-cortado por el complemento 2.** Las cinco fases de abajo siguen siendo
> válidas como descripción del trabajo y de sus criterios de aceptación, pero
> el corte vigente son **trece fases con dependencias explícitas**, en la §6 de
> [02-complemento-2-integracion.md](docs/puntos-qr-whatsapp/02-complemento-2-integracion.md).
> La **Fase 1 mínima para arrancar** es: contrato (F1) + estructura y QR (F2) +
> catálogo y asignaciones (F3) + ejecución (F4).

### Fase 1 — Núcleo y consola

**Alcance.** Migración con `ronda_zonas`, `ronda_puntos`, `ronda_qr`,
`ronda_qr_lotes`, `ronda_tipos_actividad`, `ronda_plantillas`,
`ronda_plantilla_pasos`, `ronda_instructivos`, `ronda_asignaciones`,
`ronda_eventos` y el bucket privado `rondas`. Pantallas de consola en
`app/(dashboard)/rondas/` (puntos, catálogo, asignaciones) + generación de QR
con arte e impresión por lotes en PDF. Permisos nuevos en `lib/permisos.ts`
(grupo propuesto: *Operación Conserjería*, donde ya está PQRS):
`ver_rondas`, `gestionar_puntos`, `gestionar_plantillas_ronda`,
`gestionar_asignaciones_ronda`, `ejecutar_ronda`, `ver_panel_rondas`.

**Criterios de aceptación.**
- La migración corre dos veces seguidas sin error (idempotente) y
  `scripts/auditar-permisos.mjs` + `verificar-permisos.mjs` no reportan
  incoherencias nuevas.
- Un `OPERADOR_SEDE` de la sede A **no** lee un punto de la sede B
  (probado con `set_config('request.jwt.claims', …)` dentro de
  `BEGIN … ROLLBACK`, como indica la skill `aplicar-migracion`).
- `/rondas/puntos` lista con `traerTodo` y `.order()` estable; crea un punto
  capturando lat/lng y precisión, con geocerca por defecto en 30 m.
- Publicar una plantilla v2 **no** cambia ninguna respuesta ya guardada con v1.
- Un lote de 24 etiquetas sale en un PDF con QR legible a 50×50 mm, código
  manual `K7M-4QX9` impreso y arte del cliente si lo tiene.
- Revocar un QR deja el anterior en `REVOCADO`, crea la versión siguiente y el
  índice único parcial impide dos activos.
- `npx tsc --noEmit -p .` limpio.

### Fase 2 — PWA del trabajador

**Alcance.** Ruta pública corta `/p/<token>` + app en
`app/(campo)/` con: escaneo de QR o código manual, verificación de firma,
geocerca, pasos con cámara en vivo, nota de voz transcrita, firma con
`PadFirma`, reporte en PDF, novedad → ticket existente, y cola offline.
Tablas `ronda_visitas`, `ronda_respuestas`, `ronda_evidencias`, `ronda_firmas`,
`ronda_reportes`, `ronda_novedades`, `persona_canales`,
`persona_consentimientos`.

**Criterios de aceptación.**
- Escanear el QR del punto abre la lista de tareas que aplican **a esa hora y
  ese día**, según `ronda_asignaciones` (y la ventana heredada del puesto).
- Un QR revocado o con firma inválida no abre nada y queda un `ronda_eventos`
  con `accion = 'QR_INVALIDO'`.
- A 120 m de un punto con geocerca de 30 m, la visita se abre marcada
  `dentro_geocerca = false` y **exige motivo**.
- Un paso de foto con `solo_camara_vivo` no acepta un archivo de la galería;
  con `exige_qr_en_encuadre`, se rechaza la foto sin QR detectado.
- Una casilla en `NO` sin motivo no se puede guardar (lo frena la BD, no solo
  la UI).
- Avión activado a mitad de visita: se completa, se firma y al volver la
  conexión sube sola, con `offline = true`, `sincronizada_at` e
  `inicio_dispositivo` conservado; **la hora que manda es la del servidor**.
- Cada evidencia guarda `sha256` y `hash_perceptual`; la misma foto repetida en
  dos visitas es detectable con una consulta.
- El reporte PDF trae punto, persona, horas, mapa/distancia, cada paso con su
  evidencia y la firma, y su `sha256` queda en `ronda_reportes`.
- Quien no otorgó `BIOMETRIA` firma con trazo y queda `alternativa_motivo`.

### Fase 3 — Bot de WhatsApp

**Alcance.** Webhook, envío, sesión conversacional, ejecución de una visita por
chat, `crm_conversaciones` y `crm_mensajes`.

**El diseño no se decide aquí**: lo define
[`adr-01-whatsapp.md`](docs/puntos-qr-whatsapp/adr-01-whatsapp.md)
(proveedor, verificación del webhook, ventana de 24 horas, plantillas
aprobadas, idempotencia por `externo_id`, medios entrantes, y cómo encaja el
canal en el motor de notificaciones existente).

**Criterios de aceptación** (los que esta fase hereda del núcleo, sin anticipar
el ADR): una visita hecha por WhatsApp produce exactamente las mismas filas que
una hecha por la PWA, con `canal = 'WHATSAPP'`; el mismo webhook entregado dos
veces no duplica mensajes; y el bot **no inicia** conversaciones fuera de la
jornada (Parte 4).

### Fase 4 — CRM con IA y paneles

**Alcance.** `crm_casos`, `crm_etiquetas`, `crm_caso_etiquetas`,
`crm_asignaciones`, `crm_sla`, `crm_sla_reglas`; bandeja de conversaciones con
realtime; clasificación, resumen y respuesta sugerida con la infraestructura de
`/api/ia/chat`; paneles de cumplimiento (puntos visitados vs. asignados, visitas
fuera de geocerca, SLA incumplidos) con `recharts`; eventos nuevos sembrados en
`eventos_notificacion` para que el motor de flujos avise.

**Criterios de aceptación.**
- La bandeja muestra un mensaje entrante sin recargar (realtime).
- Un caso sin primera respuesta pasado su tope queda `incumplido` y dispara el
  evento de notificación.
- La respuesta sugerida por IA **nunca se envía sola**: la confirma un agente
  (queda `autor_tipo = 'AGENTE'`, no `BOT`).
- Los paneles respetan el alcance: un supervisor de un grupo de contrato no ve
  indicadores de otro.
- Exportación a Excel con el orden del repo (por ítem y luego alfabético).

### Fase 5 — Endurecimiento

**Alcance.** Facial con prueba de vida, cruce con el video de despacho, prueba
de carga, documentación de operación.

**El diseño del antifraude y de la IA no se decide aquí**: lo define
[`adr-02-antifraude-ia.md`](docs/puntos-qr-whatsapp/adr-02-antifraude-ia.md)
(umbrales, prueba de vida sobre `services/facial` — que hoy va con
`LIVENESS_MODE=none` —, detección de recaptura, hash perceptual, puntaje de
confianza y cruce con video).

**Criterios de aceptación** del resto de la fase: 500 visitas simultáneas con
evidencia sin degradar la consola; runbook de rotación de llaves HMAC probado
(rotar no invalida los QR impresos hasta que se revocan); y
`docs/puntos-qr-whatsapp/` con el manual de operación y el de parametrización
por cliente.

---

### ADR-A — Identidad y sesión del trabajador en su celular personal

**Contexto.** El trabajador usa **su** celular, puede no tener cuenta en
`usuarios` (6.564 personas vs. ~859 cuentas) y el QR es una etiqueta pegada en
una pared: lo que abre es un navegador. `apps/movil` ya compila APK, pero es
otra app (Vite + React 18 + Capacitor) con sus propias pantallas, y su PIN
depende de `androidScheme`. `next-pwa` está instalado en `apps/inventario`
**pero sin usar**: no hay manifest ni service worker.

**Decisión (APROBADA, ampliada por el complemento 2): las dos apps, con el
núcleo compartido.** **PWA dentro de `apps/inventario`**, en un grupo de rutas
nuevo `app/(campo)/` con su propio layout, manifest y service worker: es lo que
se construye primero y el camino principal. **`apps/movil` queda como fase
posterior**, para quien ya tenga el APK instalado, y con una función que la PWA
no puede cubrir: el **seguimiento continuo de ubicación en segundo plano**
(§3.2 del complemento 2) solo lo da una app nativa.

Identidad: Supabase Auth, y para quien no tiene cuenta, **enlace de un uso +
PIN** (APROBADO) enviado al `persona_canales` verificado, que crea una sesión
acotada ligada a `persona_id`.

Como las dos apps tienen que ejecutar la misma visita y son React 19 y React 18,
**la lógica de ejecución no puede vivir en la PWA**: va a un paquete nuevo del
workspace, **`packages/ronda-core`**, sin dependencia de React (validación de
los pasos, geocerca, desfase de reloj, verificación del token del QR, máquina de
estados de la visita y armado del payload de cada RPC). `packages/offline` sigue
siendo el motor de cola y gana la cola de medios del ADR-D. El detalle está en
la §1.1 de
[02-complemento-2-integracion.md](docs/puntos-qr-whatsapp/02-complemento-2-integracion.md).

**Alternativas.** (a) Solo `apps/movil`: obliga a instalar un APK en el celular
personal de miles de personas, y la etiqueta en la pared abre un navegador, no
una app. (b) Solo PWA: renuncia al seguimiento en segundo plano, que el
complemento 2 pide por contrato. (c) App nativa nueva: el costo de distribución
mata la adopción. (d) Solo WhatsApp: no hay cámara en vivo ni control del
encuadre.

**Consecuencias.** Se gana reutilizar auth, RLS, permisos y componentes ya
probados, y "escanear y hacer" sin instalar nada. Se asume: habilitar PWA en
Next 16 (el `next-pwa` instalado es viejo; evaluar el service worker propio);
mantener `packages/ronda-core` disciplinado (si entra React, se rompe el
propósito); y que la identidad por enlace + PIN es **más débil** que una cuenta
— por eso queda registrada en `ronda_visitas.canal` y pesa en el puntaje de
confianza.

### ADR-B — Firma y contenido del QR, y su ruta pública corta

**Contexto.** Los QR del repo llevan el código en claro
(`/equipo/<codigo>`) y la ruta exige sesión. Aquí el QR es la prueba de que
alguien estuvo ahí: si se puede fabricar o fotocopiar sin control, el módulo no
sirve. Y tiene que haber un código manual tecleable para cuando la cámara falla.

**Decisión.** El QR codifica una **URL corta y absoluta**:

```
https://<host>/p/<token>
token = <v><punto_b32><ver><sig>     p. ej.  1K7M4QX9T02A9F3C1B7E
```

donde `sig` son los primeros 10 caracteres (base32 sin ambigüedades) de
`HMAC-SHA256(llave_cliente_vN, "<v>|<punto_id>|<version>")`. La llave **no está
en la base**: vive en variables de entorno (una por cliente, versionada), y en
`ronda_qr.firma_llave_id` solo queda cuál se usó. El **código manual** de 8
caracteres (`K7M-4QX9`) es independiente, con alfabeto sin `I L O U 0 1`, y abre
el mismo flujo pero marca `apertura_modo = 'MANUAL'`, que pesa menos en el
puntaje. `/p/<token>` es público: resuelve el punto, y si no hay sesión, manda
al enlace + PIN del ADR-A conservando el destino.

**Alternativas.** (a) Código en claro como maquinaria: trivial de fabricar.
(b) JWT firmado dentro del QR: el payload hace el QR denso y frágil en etiqueta
pequeña, y no aporta — el QR es estático, no caduca por sí mismo.
(c) QR dinámico en pantalla (TOTP): imposible en una pared.
(d) NFC: no todos los celulares lo tienen habilitado.

**Consecuencias.** La etiqueta es corta y el QR legible a 50×50 mm. La firma
impide fabricar un QR válido, pero **no** impide fotografiar uno real: contra eso
están la geocerca, `exige_qr_en_encuadre` y el antifraude (ADR-02). Rotar la
llave no invalida lo impreso (los `token` ya emitidos siguen verificando con su
`firma_llave_id`); invalidar exige revocar y reimprimir, y eso hay que decirlo
en el runbook.

### ADR-C — Almacenamiento de medios y URLs firmadas

**Contexto.** Una visita puede traer 10 fotos, un video corto y una nota de voz.
El repo ya resolvió esto once veces: bucket privado por módulo, ruta
`{entidad_id}/{archivo}`, políticas que derivan la carpeta con una función.

**Decisión.** Un bucket **`rondas`**, privado, `file_size_limit` 52.428.800
(50 MB, igual que `pqrs` y `soporte`), con rutas:

```
rondas/{visita_id}/{respuesta_id}/{uuid}.jpg     evidencia
rondas/puntos/{punto_id}/{uuid}.jpg              fotos de referencia e instalación
rondas/instructivos/{instructivo_id}/{archivo}   material
rondas/reportes/{visita_id}/{numero}.pdf         reporte firmado
```

Lectura siempre con **`createSignedUrl` de 300 segundos** (nunca URL pública,
nunca bucket público). Subida directa del cliente al bucket con las políticas de
`storage.objects` + una función `ronda_puede_subir(name)` al estilo de
`pqrs_puede_subir`.

**Alternativas.** (a) Bucket público: expone evidencia con datos de personas en
un repo público — descartado de plano. (b) Subir por un route handler propio:
todo el binario pasa por la función serverless (límite de cuerpo de 4,5 MB y
costo), peor que la subida directa. (c) Bucket aparte para video: no hace falta
todavía.

**Consecuencias.** Coherente con los otros once módulos y con el script de
permisos de storage
([20260901000000_permisos_storage.sql](supabase/migrations/20260901000000_permisos_storage.sql)).
La URL firmada corta implica **refrescarla** en pantallas largas (el visor de un
reporte abierto 10 minutos tiene que volver a pedirla). Y nada de evidencia se
sirve desde el PDF por URL: el PDF lleva la imagen embebida.

### ADR-D — Cola offline

**Contexto.** Hay sótanos sin señal. `packages/offline` ya resuelve el patrón
(store Dexie, outbox de *intents* con escritura optimista, `PushRegistry` con
`rpcHandler`, sync por watermark) y es **framework-agnóstico** (`Sb` es
estructural), pero está pensado para `apps/movil` y **no maneja binarios**.

**Decisión.** Reusar `packages/offline` desde la PWA, registrando los intents
del módulo contra las RPC (`rpcHandler('ronda_registrar_visita')`,
`rpcHandler('ronda_responder_paso')`, `rpcHandler('ronda_cerrar_visita')`), y
**agregarle al paquete una cola de medios**: los blobs quedan en IndexedDB con
su `sha256` y se suben al bucket con reintento y backoff antes de enviar el
intent que los referencia. La visita se cierra localmente, se le muestra al
trabajador que está pendiente de envío, y la hora de dispositivo viaja aparte de
la del servidor.

**Alternativas.** (a) Service worker con Background Sync solamente: no hay
soporte parejo en iOS. (b) Escribir una cola nueva en la PWA: duplicaría el
outbox que ya funciona. (c) No soportar offline: el sótano sin señal es el caso
real, no el borde.

**Consecuencias.** `packages/offline` gana una capacidad que también le sirve a
`apps/movil`. Se asume que el orden importa (la evidencia antes que el cierre) y
que puede haber visitas pendientes días; hay que mostrar la cola y poder
descartar con motivo. Y que el `inicio_dispositivo` es **dato, no verdad**: el
reloj del celular se puede cambiar, y por eso existe `desfase_reloj_seg`.

### ADR-E — RPC frente a server actions

**Contexto.** El repo tiene dos patrones. Los módulos nuevos (PQRS, Soporte,
Mantenimiento) escriben **todo por RPC `SECURITY DEFINER`** llamada desde el
cliente y no tienen `actions.ts`; los viejos usan server actions con
`faltaPermiso` + `(supabase as any)` + `revalidatePath`. La regla de fondo del
proyecto es que **las escrituras sensibles van por RPC**, porque la validación
tiene que estar donde la RLS no se puede saltar.

**Decisión.** Tres caminos, cada uno con su razón:

1. **RPC `SECURITY DEFINER`** para todo el núcleo que escribe evidencia:
   `ronda_registrar_visita`, `ronda_responder_paso`, `ronda_adjuntar_evidencia`,
   `ronda_firmar`, `ronda_cerrar_visita`, `ronda_reportar_novedad`,
   `ronda_emitir_qr`, `ronda_revocar_qr`. Son las mismas que llama la cola
   offline y las mismas que llamará el bot: **un solo camino de escritura para
   los tres canales**. Validan geocerca, mínimos de foto, motivo obligatorio y
   escriben `ronda_eventos`.
2. **Server actions** solo en la consola, para lo que no es escritura de
   evidencia y necesita el servidor: generar el PDF del lote de etiquetas,
   generar el reporte, importar puntos desde Excel, invalidar caché con
   `revalidatePath`.
3. **Route handlers** (`app/api/…`) para lo que entra de afuera: el webhook de
   WhatsApp y los trabajos por cron (vencimiento de visitas, SLA), con secreto
   compartido al estilo de `CRON_SECRET` en
   [api/cron](apps/inventario/app/api/cron/flujos/route.ts).

**Alternativas.** (a) Todo por server actions: el bot y la cola offline tendrían
que entrar por HTTP y se duplicaría la validación. (b) Todo por RPC incluida la
generación de PDF: Postgres no es el lugar para eso. (c) Tablas con `INSERT`
directo y RLS: la validación de "mínimo 2 fotos" o "motivo si NO" terminaría
repartida entre constraints y UI, y el canal de WhatsApp se la saltaría.

**Consecuencias.** La lógica de negocio queda en SQL, que es más incómodo de
probar — se mitiga con las pruebas en `BEGIN … ROLLBACK` que ya usa el proyecto
y con la lógica pura en `lib/ronda/` para lo que no toca la base. Y los
tres canales comparten de verdad el núcleo, que es el objetivo del módulo.

---

## Parte 4 — Pendientes, riesgos y marco legal

### 4.1 Configuración que no está en el repo (queda con valores de ejemplo)

Todo esto va a variables de entorno y hay que declararlo en la lista `env` de
[turbo.json](turbo.json) para que el build de Vercel las reciba:

```bash
# WhatsApp (lo define adr-01-whatsapp.md)
WHATSAPP_NUMERO_E164=+5760000000000        # número de la línea; NO existe aún
WHATSAPP_PHONE_NUMBER_ID=000000000000000
WHATSAPP_BUSINESS_ACCOUNT_ID=000000000000000
WHATSAPP_TOKEN=EAAG...ejemplo              # credencial de Meta: NO existe aún
WHATSAPP_VERIFY_TOKEN=cambiar-esto
WHATSAPP_APP_SECRET=cambiar-esto           # para validar la firma del webhook

# Firma de los QR: una llave por cliente, versionada
RONDA_HMAC_LLAVE_ACTUAL=cli-demo-v1
RONDA_HMAC_CLI_DEMO_V1=0000000000000000000000000000000000000000000000000000000000000000

# Ya existen en el proyecto y este módulo los usa
APP_BASE_URL=https://ejemplo.vercel.app
OPENAI_API_KEY= / OPENAI_MODEL_TRANSCRIBE=whisper-1
FACIAL_SERVICE_URL= / FACIAL_SERVICE_TOKEN= / FACIAL_UMBRAL_MATCH= / FACIAL_LIVENESS_MIN=
CRON_SECRET=
```

Y como **parámetros en base de datos** (no en código), al estilo de
`pqrs_plazos` y `programacion_reglas`: geocerca por defecto (30 m), tolerancia
por defecto, topes de SLA por prioridad, jornada del bot, tamaño máximo de
evidencia, y el arte de la etiqueta por cliente.

### 4.2 Pendientes de aprobación

**Cerrados por el usuario** (complemento 2, §1):

- ~~**PWA frente a `apps/movil`**~~ → **las dos**: la PWA primero y como camino
  principal, `apps/movil` en una fase posterior para el seguimiento en segundo
  plano, con la lógica compartida en `packages/ronda-core` (ADR-A actualizado).
- ~~**¿El trabajador tiene cuenta en `usuarios`?**~~ → **no hace falta**:
  identidad por **enlace de un uso + PIN** al canal verificado.
- ~~**Retención de evidencia**~~ → **12 meses**, y como **parámetro** del
  contrato (`grupo_reglas`), no como constante. Aplica también al historial de
  ubicación y a los medios entrantes de WhatsApp.

**Abiertos**:

1. **Prefijo `ronda_`** para las tablas. Si se prefiere otro, cambiarlo ahora
   cuesta nada; después cuesta una migración de renombres.
2. **Nivel `puestos` ↔ `ronda_zonas`**: ¿la zona cuelga siempre de un puesto o
   puede existir sin él? (Propuesto: opcional.)
3. **Confirmar `sedes.centro_costo_id`**: hoy casi todo sin cruzar; si el
   módulo va a reportar por centro de costo, ese cruce es prerrequisito.
4. **Encadenado de hash en `ronda_eventos`**: sí o no (propuesto: sí, por
   entidad).
5. **Quién firma el reporte del cliente** y si su firma es obligatoria.
6. **Arte de la etiqueta por contrato**: hace falta el material de cada uno.
7. **Festivos**: cargar `pqrs_dias_no_habiles` desde `calendario_festivos`
   para que los plazos de este módulo y los de PQRS cuenten igual.
8. **Cuenta de correo de notificaciones**: sin ella, los flujos del motor de
   notificaciones quedan omitidos (ya documentado para los otros módulos).
9. **Rol de la consola**: quién administra el catálogo (¿Gerencia? está
   pendiente también en compras). Resuelto en parte: las claves
   `ver_contratos_conserjeria` y `gestionar_contratos_conserjeria` ya existen en
   el catálogo sin usar.

**Los diez pendientes que agrega el complemento 2** (modificar
`/mantenimiento` en producción, `grupo_id` en `persona_vinculaciones`,
levantamiento 2D/3D, buzón de correo entrante, desafío antispam, umbral de
posición vieja, aprobación de la OT por el cliente, papeles `CLIENTE` y
`PROVEEDOR`, presupuesto de materiales y penalidades de ANS) están en la §10.1
de [02-complemento-2-integracion.md](docs/puntos-qr-whatsapp/02-complemento-2-integracion.md).

### 4.3 Riesgos

| Riesgo | Mitigación |
|---|---|
| **Foto del QR** (alguien fotografía la etiqueta y marca desde su casa) | geocerca + `exige_qr_en_encuadre` + hash perceptual + puntaje de confianza (ADR-02) |
| **GPS en sótanos y parqueaderos**: precisión de 500 m o sin señal | `exige_geocerca` por punto; motivo obligatorio fuera de cerca; `precision_metros` guardado y visible en el panel |
| **Reloj del dispositivo alterado** | la hora que manda es la del servidor; `desfase_reloj_seg` como señal |
| **Celular personal**: datos, batería, gama baja | evidencia comprimida en el cliente, video corto, cola offline, y WhatsApp como salida para quien no puede con la PWA |
| **Costo de Storage** con video por visita | tope de segundos por paso, compresión, política de retención de 12 meses, parametrizada por contrato |
| **El cron de Vercel cada 5 minutos no es una cola**: un pico de webhooks de WhatsApp no se atiende así | `adr-01-whatsapp.md` define el encolado; el webhook debe responder rápido y diferir |
| **Permisos**: un módulo nuevo es la ocasión clásica de abrir una lectura de más | `scripts/auditar-permisos.mjs`, `verificar-permisos.mjs` y `verificar-lecturas.mjs` en cada fase |
| **Repo público**: evidencia con rostros y nombres | nada de datos reales en código, docs ni fixtures; buckets privados; `personas` nunca se desnormaliza más allá de `*_nombre` necesario para listados |
| **Dos apps (React 18 / React 19)** si se mete el módulo en `apps/movil` | ADR-A lo evita |
| **Migraciones en paralelo**: varias sesiones numerando el mismo día | ya pasó (commit `f0f7437`); reservar el número al crear el archivo |

### 4.4 Marco legal a respetar

**Ley 1581 de 2012 (protección de datos personales) y su régimen de datos
sensibles.** Este módulo trata **ubicación, fotos, voz y, opcionalmente,
biometría** de trabajadores:

- **Autorización previa, expresa e informada**, por finalidad y **versionada**:
  es exactamente lo que guarda `persona_consentimientos` (`texto_version`,
  `texto_hash`, `canal`, `ip`, `user_agent`), copiando lo que el ATS ya hace.
- **La biometría es dato sensible** y va con **consentimiento aparte**, no
  dentro del paquete general. Debe ser **opcional y con alternativa real**: quien
  no consienta firma con trazo, y eso queda en `ronda_firmas.metodo = 'TRAZO'`
  con `alternativa_motivo`. Negarse **no puede** bloquear el trabajo.
- **Revocabilidad**: `revocado_at` en el consentimiento; revocar biometría
  apaga la firma facial hacia adelante.
- **Finalidad y minimización**: la ubicación se captura **en el momento de la
  visita**, no en continuo. El módulo **no es un rastreador**: no hay
  seguimiento de la persona fuera de la visita (distinto de
  `conductor_ubicacion_historial`, que es para rutas de entrega).
- **Seguridad**: buckets privados, URLs firmadas de 300 s, RLS por sede,
  auditoría append-only.
- Hay que actualizar la **política de tratamiento** y el aviso de privacidad con
  estas finalidades antes de salir a producción.

**Ley 2191 de 2022 (desconexión laboral).** El bot **no inicia** conversaciones
fuera de la jornada del trabajador: la ventana sale de la programación
(`puestos`, `turno_patrones`) y de un parámetro de jornada, y la regla se
implementa en la base, no en la UI. Si la persona escribe fuera de la jornada,
el bot puede responder con información, pero **no asigna ni exige tareas**. Las
notificaciones salientes se aplazan a la siguiente ventana hábil. `crm_sla`
tiene `pausado_min` precisamente para no contar SLA en horas no hábiles.

**Otras.** Festivos y días hábiles por la Ley 51 de 1983 (Emiliani), ya
calculados en `festivos_colombia(anio)`; jornada y recargos por la Ley 2101 de
2021, ya parametrizados en `programacion_reglas` — este módulo los **lee**, no
los redefine.

---

## Qué sigue

Antes de abrir la F1 (contrato) hacen falta: el prefijo de tablas, la
aprobación de los cambios a `/mantenimiento` (que está en producción), y el
**complemento 1**, que no ha llegado y del que dependen tres piezas —los huecos
están listados en la §7 de
[02-complemento-2-integracion.md](docs/puntos-qr-whatsapp/02-complemento-2-integracion.md).
Los dos ADR hermanos (`adr-01-whatsapp.md`, `adr-02-antifraude-ia.md`) cubren
las fases de WhatsApp y de endurecimiento; los cambios que habría que pedirles
tras el complemento 2 están en la §8 de ese mismo documento.

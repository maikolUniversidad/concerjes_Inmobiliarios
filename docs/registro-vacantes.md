# Módulo Registro de Vacantes (Contratación / ATS público)

Flujo público de registro de candidatos, accesible desde la landing
(`apps/web`), en **`/registro-vacantes`**. Fase 1 (FUNDACIÓN) implementada:
modelo de datos + formulario público + carga de documentos. La generación del
contrato (paquete de 18 PDFs) y el motor facial GPU quedan como fases siguientes,
ya con las costuras (seams) listas.

## Qué se construyó

### Base de datos (`supabase/migrations/`)
- `20240114000000_registro_vacantes.sql` — esquema completo + RLS + storage.
- `20240114000001_registro_vacantes_seed.sql` — catálogos (DANE, EPS/AFP/…,
  bancos, cargos, parámetros legales por año, tipos documentales en 2 olas).

Tablas nuevas: `candidatos` (8 secciones), `candidato_direcciones` (versionadas),
`beneficiarios`, `consentimientos`, `registros_faciales` (pgvector 512-d, HNSW),
`intentos_identificacion`, `vac_tipos_documentales`, `candidato_documentos`,
`obras`, `vacantes`, `cargos`, `postulaciones`, `contratos` (esqueleto),
`vac_auditoria`, y catálogos.

Notas de diseño:
- **No colisiona** con Gestión Humana: el tipo documental del módulo se llama
  `vac_tipos_documentales` (el árbol existente `tipos_documentales` no se toca).
- El **cliente** de la obra reutiliza `empresas_usuarias` (no se creó `clientes`).
- `contratos` conecta con los `contrato_id` reservados en `sede_productos` y
  `ordenes_insumo` cuando se construya la generación de contratos.

### RLS y sesión anónima
El candidato público usa **sesión anónima de Supabase** (persistida en
`localStorage`, storageKey `ci-registro-vacantes`). Su `auth.uid()` se guarda en
`candidatos.auth_uid`; la RLS lo deja ver/editar **solo su propio** registro.
Personal interno escribe vía `public.auth_rol()`.

> ⚠️ Requiere habilitar **Anonymous sign-ins** en Supabase
> (Authentication → Providers → Anonymous). Sin esto, el flujo no arranca.

### Aplicar las migraciones
No están aplicadas todavía. Con la conexión del proyecto (ver memoria
`supabase-connection`, workaround TLS `--use-system-ca`):
```
supabase db push            # o aplicar los .sql por orden de nombre
```

### Cuenta de plataforma + login (candidato)
Al terminar el registro, la **sesión anónima se convierte en cuenta permanente**
(`/api/registro/crear-cuenta`, service role `admin.updateUserById` — mismo
`auth.uid`, así toda la info queda ligada). El trigger `handle_new_user` ya había
creado su fila `usuarios` (rol AUDITOR); se le fija correo/nombre/contraseña.
Credenciales: usuario = correo de contacto o `<documento>@aspirante.conserjesinmobiliarios.com`;
contraseña = número de documento. Se muestran en la pantalla final.

Login en **`/ingresar`** (apps/web): documento (o correo) + contraseña
(`resolver-email` traduce documento→correo, luego `signInWithPassword`), **o**
reconocimiento facial (`/api/registro/facial/login`, env-gated: identify+liveness
→ 1:N → magic link → `verifyOtp`; sin microservicio cae al documento). Al ingresar
reanuda `/registro-vacantes` con sus datos.

> ⚠️ FIX de seguridad `20240115000000_registro_vacantes_fix_rls.sql`: como el
> trigger asigna rol AUDITOR a las sesiones anónimas, las políticas que usaban
> `auth_rol() IS NOT NULL` como "personal" se cambiaron a la lista explícita
> `('SUPER_ADMIN','ADMIN','SUPERVISOR')`. **Aplicar esta migración.**

### Entrada desde la landing
Link libre en el Hero: "¿Buscas empleo? **Trabaja con nosotros** · Ya me registré"
(→ `/registro-vacantes` y `/ingresar`). Sin botones grandes.

### Frontend (`apps/web`)
- `/registro-vacantes` — wizard de 6 pasos, mobile-first, español simple,
  **guardado parcial y reanudable** (autosave con rebote + reanudar por sesión).
  - Paso 0 · Consentimientos (datos = obligatorio; biométrico = separado y opcional).
  - Paso 1 · Identificación — **Ruta B (documento) siempre disponible**; 2º factor
    (últimos 4) para retomar un registro existente; Ruta A (facial) opcional y con
    caída automática a Ruta B.
  - Paso 2 · Formulario (8 secciones).
  - Paso 3 · Documentos multi-archivo por tipo (bucket privado, reglas condicionales por cargo).
  - Paso 4 · Revisión + declaraciones.
  - Paso 5 · Envío → estado `POSTULADO`.
- Env: copiar `apps/web/.env.local.example` → `.env.local`.

## Microservicio facial → `services/facial/` (implementado)
El motor ya está escrito: FastAPI + InsightFace `buffalo_l` (ArcFace 512-d) +
anti-spoofing MiniFASNet, con Dockerfile y README. **Falta desplegarlo en la GPU
on-premise y exponerlo a Vercel con un túnel** (ver `services/facial/README.md`),
y definir `FACIAL_SERVICE_URL` + `FACIAL_SERVICE_TOKEN` en Vercel. Mientras esa
env no exista, la app responde `disponible:false` y usa la Ruta B (documento).

## Contrato del microservicio facial

`FACIAL_SERVICE_URL` **env-gated**: si no está, las rutas responden
`{ disponible: false }` y la UI usa la Ruta B. FastAPI sobre GPU on-premise
(InsightFace `buffalo_l`, ArcFace 512-d):

```
POST {FACIAL_SERVICE_URL}/face/identify   body: { image: <base64 jpeg> }
  -> { embedding: number[512], quality: number, liveness_score: number }

POST {FACIAL_SERVICE_URL}/face/enroll      body: { image }
  -> { embedding: number[512], quality: number, liveness_score: number, modelo_version: string }
```

- Umbrales (env, calibrar con 200+ rostros): `FACIAL_UMBRAL_MATCH=0.50`,
  `FACIAL_UMBRAL_DUDA=0.38`, `FACIAL_LIVENESS_MIN=0.90`.
- La búsqueda 1:N usa el RPC `vac_buscar_rostro(embedding, limite)` (service role).
- Un MATCH **nunca** autentica solo: la UI pide 2º factor antes de mostrar datos.
- Falta la **captura de cámara** en el cliente (5 frames, encuadre/luz/liveness) y
  el enrolamiento al finalizar si autorizó el biométrico.

### Backoffice ATS (`apps/inventario`) — hecho
`/gestion-humana/postulaciones` (menú Gestión Humana). Bandeja de postulaciones
con filtro por estado + búsqueda, y drawer de detalle por candidato:
- Pipeline de estados (POSTULADO → … → CONTRATADO + estados de corte).
- Verificación de documentos (ver con signed URL, validar/rechazar con motivo).
- **OCR asistido** (visión LLM, reutiliza OpenAI de inventario): botón "Analizar IA"
  por documento → `POST /api/gestion-humana/postulaciones/ocr` extrae los campos
  (contrato §7.3, JSON forzado), los guarda en `candidato_documentos.ocr_resultado`
  y muestra **validación cruzada** contra lo digitado (documento/nombres/nacimiento;
  antecedentes: vigencia ≤ 30 días). Solo imágenes (no PDF aún).
- Asignación a vacante (obra/cliente).
- Lectura de datos + consentimientos versionados.
Permisos nuevos: `ver_postulaciones`, `gestionar_postulaciones` (grupo Gestión
Humana en `lib/permisos.ts`; ADMIN/SUPER_ADMIN bypass, otros roles se configuran
en `/roles`). Escrituras cliente `(supabase as any)` bajo RLS de staff; auditoría
vía `logActivity` (actividad_log).

## Pendiente / fases siguientes
- Generación del contrato + paquete de 18 documentos (DOCX + plantillas). Requiere
  la minuta `.docx` maestra y los datos legales verificados.
- Captura facial en cliente + enrolamiento (contra el microservicio GPU).
- Ola 2 de documentos (vinculación) por link privado con token al preseleccionado.
- Verificación por OTP de email/celular.
- Listado DANE completo de municipios (hoy sólo capitales + ciudades principales).

## ❗ VERIFICAR antes de producción
- **NIT**: el sitio publica `800093388-2`; la minuta imprime `800093388-3` /
  `800093388-324` (malformado). Confirmar el correcto (`lib/registro/consentimientos.ts`).
- Correo de PQRS de datos personales.
- Valores de `parametros_legales` (SMLV/auxilio/UVT), especialmente **2026 (provisional)**.

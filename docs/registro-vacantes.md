# Módulo Registro de Vacantes (Contratación / ATS público)

Flujo público de registro de candidatos, accesible desde la landing
(repo [Concerjes_Web](https://github.com/maikolUniversidad/Concerjes_Web)), en **`/registro-vacantes`**. Fase 1 (FUNDACIÓN) implementada:
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

Login en **`/ingresar`** (repo Concerjes_Web): documento (o correo) + contraseña
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

### Frontend (repo Concerjes_Web)
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
- Env: copiar `.env.local.example` → `.env.local` en el repo Concerjes_Web.

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

## Proceso completo de selección y contratación (2026-09-22)

Se comparó la plataforma con el proceso real de la empresa y se cerraron las
brechas. Fuentes analizadas: la especificación del ATS anterior
(conserjesats.com) con su mapa de flujo y su libro de catálogos, la minuta del
contrato, el formato de entrevista v4, la carta de conocimiento de funciones,
la requisición de personal C_1.1 v3, el informe de centros de costo, el exporte
de nómina WO y un **expediente físico completo de 40 folios** (lo que se firma y
se escanea al contratar). El archivo `DOCUMENTOS DE CONTRATACION_0001.pdf`
llegó vacío (0 bytes); se trabajó con el expediente de 40 folios.

### Migraciones (aplicadas el 2026-09-22)
| Archivo | Qué hace |
|---|---|
| `20260922000000_ats_estados_enum.sql` | Fases que faltaban: `EN_PRUEBAS`, `ENTREVISTA`, `SEGURIDAD` (aparte: un valor nuevo de enum no se puede usar en la misma transacción) |
| `20260922000001_ats_proceso_contratacion.sql` | Catálogos (cargos unificados con nómina + funciones, listas, IPS, códigos de nómina, municipio→WO, datos del empleador), bitácora, observaciones, evaluaciones, requisiciones, pruebas, plantillas versionadas, documentos generados, contrato completo y entrega a nómina |
| `20260922000002_ats_hoja_vida_firma.sql` | Estudios, experiencia y referencias del candidato; firma con IP; documentos ocultos al candidato; guardia antes de la bitácora; `sha256()` nativo en vez de `digest()` (pgcrypto vive en `extensions`) |
| `20260922000003_ats_correcciones.sql` | Fecha de fin del periodo de prueba (restaba entero a timestamp) |
| `20260922000004_ats_foto_perfil.sql` | El candidato puede ver su foto de perfil aunque la haya subido RRHH (solo esa ruta); `FOTO_CARNET` solo acepta imágenes |

Datos cargados con scripts: `importar-municipios-dane.mjs` (1.122 municipios
DIVIPOLA; antes 73), `importar-centros-costo-historicos.mjs` (catálogo completo
de nómina: 532 centros nuevos, inactivos; los 92 vigentes no se tocaron) y `sembrar-plantillas-documento.mjs`
(18 plantillas, versión 1; con `--nueva-version` publica las que cambiaron).

### Fases (`lib/ats/fases.ts`)
9 fases internas agrupadas en las 5 que ve el candidato:
Postulación (`POSTULADO`, `EN_PRUEBAS`, `EN_VERIFICACION`) → Evaluación
psicológica (`ENTREVISTA`) → Seguridad AAA (`SEGURIDAD`) → Exámenes
(`EXAMEN_MEDICO`, `APTO`) → Contratación (`PRESELECCIONADO` = seleccionado en
vinculación, `CONTRATADO`, `ACTIVO`). Cierres: `RECHAZADO`, `NO_APTO`,
`DESISTIO`, `BANCO_TALENTO`, `RETIRADO`, siempre con motivo tipificado (9).

Regla de documentos antes de mover (`documentosFaltantes`): desde la entrevista
exige los obligatorios del registro; `APTO` exige el concepto médico; `CONTRATADO`
exige los de vinculación. El mensaje dice **qué** falta por candidato y se puede
continuar con justificación (queda en la bitácora como `EXCEPCION_DOCUMENTAL`).

### Lo que se corrigió frente al ATS anterior
| Hallazgo | Cómo quedó |
|---|---|
| Documentos no se guardaban | Cada archivo se sube y se registra al instante; RRHH puede cargar por el candidato desde el expediente |
| Error "1 error(es)" sin decir qué falta | Lista exacta de faltantes por candidato y opción de justificar |
| Bitácora vacía | Trigger `vac_candidato_cambio_estado`: quién, cuándo, de qué fase a cuál y con qué motivo |
| Consulta de estado solo con cédula | "Mi proceso" exige iniciar sesión (documento + contraseña) |
| Requisiciones sin pantalla | `/gestion-humana/requisiciones` (formato C_1.1 v3, cupos cubiertos automáticos, fecha límite de 5 días hábiles) |
| Sin bandeja de descartados | Pestaña Descartados con motivo y botón Reactivar |
| Sin exportación | CSV/Excel de la tabla estándar y Excel para nómina (WO, 55 columnas) |
| Aceptación de política sin evidencia | Consentimientos con versión, hash, IP y navegador |
| Firma sin evidencia | Firma dibujada, hash SHA-256, fecha, IP, navegador y versión de la plantilla |
| "Candidato para Coordinador" fijo | Se muestra el cargo real |
| El candidato llenaba los formatos a mano | Los 18 formatos salen llenos; el candidato solo firma |

### Área administrativa (`apps/inventario`)
- **Postulaciones**: indicadores, 7 bandejas por fase con días en fase en semáforo,
  selección múltiple, mover de fase, descartar y Excel WO.
- **Expediente**: Personal (datos, ADRES, centro de costos, requisición y resumen
  de códigos para nómina), Documentos (validar, rechazar, IA, cargar por el
  candidato), Pruebas y evaluaciones (resultados con **Ver / PDF** de cada prueba,
  entrevista v4, seguridad AAA, antecedentes, verificación de referencias,
  observaciones), Exámenes médicos
  (remisión a IPS con correo, concepto de aptitud), Contratación (contrato,
  generación de formatos, firma en papel, entrega a nómina) e Historial.
- **Plantillas de documentos** (`/gestion-humana/plantillas`): editor HTML con
  catálogo de variables, vista previa con datos de ejemplo o de un candidato
  real, historial de versiones y archivo original descargable.
- Permisos nuevos: `ver_requisiciones`, `gestionar_requisiciones`,
  `ver_plantillas_documento`, `gestionar_plantillas_documento` (sembrados en
  Coordinador y Supervisor de Conserjería; Auditor solo ver). Los contratos
  laborales ahora dependen de `ver_/gestionar_postulaciones`; la clave
  `gestionar_contratos_conserjeria` queda para los contratos de servicio con
  clientes (módulo aún sin construir).

### Candidato (`/registro-vacantes`)
- Formulario: nombres en 4 partes, historial con la empresa obligatorio,
  estatura, cursos (alturas con vigencia, alimentos, grecas), estudios, empleos
  anteriores, referencias familiares y personales, perfil laboral, municipios
  completos; foto o archivo por separado en cada documento.
- `/registro-vacantes/pruebas`: aptitud (10 ítems A/B, sin tiempo, genera perfil)
  y conocimientos (6 preguntas, 10 minutos, firma con nombre y cédula). La clave
  nunca llega al navegador: califica `vac_finalizar_prueba`.
- `/registro-vacantes/mi-proceso`: fases, pruebas pendientes, documentos para
  firmar con el dedo, documentos por subir y documentos firmados.

### Foto de perfil (tipo carné)
- La toma el candidato en el paso de documentos o en "Mi proceso" (botón de la
  cámara sobre su foto), o RRHH desde el expediente (clic en la foto → cámara de
  la oficina o archivo; queda validada). `components/foto/CamaraFoto.tsx` muestra
  la guía del rostro y deja revisar antes de usarla; `lib/registro/foto.ts`
  recorta vertical 3:4 y la guarda en JPG de ~600×800 (también las que se suben
  desde el equipo). Queda como documento `FOTO_CARNET` y en `candidatos.foto_perfil_path`.
- En los formatos va donde esté el marcador `{{FOTO_CARNET}}`: hoja de vida,
  actualización de datos y los resultados de las pruebas. Al **generar**, la foto
  queda **incrustada** en el documento (`lib/documentos/foto-perfil.ts`): sale al
  imprimir sin depender de un enlace que vence y hace parte de lo que se firma.
  Documentos generados antes de tener foto la toman al mostrarlos.
- Para ponerla en otro formato: Plantillas de documentos → insertar el marcador
  `{{FOTO_CARNET}}` y publicar una versión nueva.
- Imprimir espera a que carguen las imágenes (logo, foto, firmas) antes de abrir
  el diálogo. Los formatos de hoja fija usan la clase `compacta` para caber en
  carta (actualización de datos v2: dos hojas exactas).

### Documentos generados
Motor propio sin dependencias (`lib/documentos/plantilla.ts`): `{{variable}}`,
filtros (`fecha`, `moneda`, `letras`, `mayusculas`, `igual:"CC" | x`…), `#if` y
`#each`. Catálogo de variables en `lib/documentos/variables.ts`; el contexto sale
de `lib/documentos/contexto.ts`. Marcadores que se resuelven al firmar o
mostrar: `{{FIRMA_TRABAJADOR}}`, `{{FECHA_FIRMA}}`, `{{HUELLA}}`, `{{FOTO_CARNET}}`…

Cada documento guarda la versión exacta de la plantilla con la que se generó.
Una plantilla editada no cambia los documentos ya generados. El formato de
entrevista es interno (el candidato no ve el concepto psicológico) y el pagaré
se firma en papel.

### ❗ VERIFICAR antes de producción
- **NIT**: el sitio publica `800093388-2`; la minuta imprime `800093388-3` /
  `800093388-324` (malformado). Los documentos usan el de `vac_empresa`.
- **Correo de habeas data**: la «Autorización información del personal» dirige
  los reclamos a `asistente.gerencia@vigiasdecolombia.com` (texto heredado);
  la otra autorización usa `vigicoladmon@hotmail.com`.
- **Carta de conocimiento**: el original hablaba de «vigilancia y seguridad
  privada» (texto de otra empresa); la plantilla quedó neutral.
- **Pagaré en blanco**: requiere carta de instrucciones (Art. 622 C. de Co.).
- **Solicitud de plazo**: «autorizo que me sea cancelado el contrato por justa
  causa» no crea una justa causa; revisar con jurídica.
- **Clave de la prueba de conocimientos**: deducida del contenido; confirmar.
- Correo de PQRS de datos personales y `parametros_legales` 2026 (provisional).
- Solo COMERBAS tiene correo de IPS cargado; completar las demás en `ips`.
- No hay cuenta de correo configurada: los eventos `ATS_*` quedan listos para
  flujos, pero no salen correos hasta configurar Notificaciones.
- El plan exequial (Los Olivos) es un formulario de un tercero: se escanea.

## Pendiente / fases siguientes
- Captura facial en cliente + enrolamiento (contra el microservicio GPU).
- Verificación por OTP de email/celular.
- PDF firmado en el servidor (hoy se imprime o guarda como PDF desde el navegador).
- Bancos de preguntas por cargo (hoy hay uno general: el de operario de aseo).

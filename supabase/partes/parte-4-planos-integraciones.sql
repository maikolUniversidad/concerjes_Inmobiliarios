-- Conserjes Inmobiliarios — PARTE 4 (idempotente)


-- >>>>>>>>>>>>>>>>>>>> 20240110000000_bodega_planos.sql >>>>>>>>>>>>>>>>>>>>

-- =============================================================================
-- Conserjes Inmobiliarios — Diseñador de planos de bodega (por pisos)
--
-- Cada bodega puede tener varios PISOS. Cada piso guarda sus dimensiones reales
-- (en metros), la escala del editor y el conjunto de ELEMENTOS dibujados
-- (estantes, zonas de almacenamiento, puertas, escaleras, paredes, etc.) como
-- JSONB. Los elementos usan coordenadas y medidas en metros; opcionalmente un
-- elemento puede enlazarse a una `ubicaciones` (ubicacion_id dentro del JSON).
--
-- IDEMPOTENTE.
-- =============================================================================

CREATE TABLE IF NOT EXISTS bodega_pisos (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bodega_id  UUID NOT NULL REFERENCES bodegas(id) ON DELETE CASCADE,
  numero     INTEGER NOT NULL DEFAULT 1,          -- 1 = planta baja, 2 = piso 2 …
  nombre     VARCHAR(120),                        -- "Planta baja", "Mezzanine"…
  ancho_m    NUMERIC(8,2) NOT NULL DEFAULT 20,    -- ancho real del plano (m)
  alto_m     NUMERIC(8,2) NOT NULL DEFAULT 15,    -- alto real del plano (m)
  escala     NUMERIC(6,2) NOT NULL DEFAULT 40,    -- px por metro en el editor
  fondo_url  TEXT,                                -- imagen de fondo opcional (plano escaneado)
  elementos  JSONB NOT NULL DEFAULT '[]',         -- [{ id,tipo,x,y,w,h,rot,etiqueta,color,ubicacion_id }]
  orden      INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (bodega_id, numero)
);

CREATE INDEX IF NOT EXISTS idx_bodega_pisos_bodega ON bodega_pisos(bodega_id, numero);

-- updated_at
DROP TRIGGER IF EXISTS tr_bodega_pisos_upd ON bodega_pisos;
CREATE TRIGGER tr_bodega_pisos_upd BEFORE UPDATE ON bodega_pisos
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Historial/versionado si existe la función
DO $$ BEGIN
  IF to_regproc('public.registrar_historial') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS tr_hist_bodega_pisos ON public.bodega_pisos;
    CREATE TRIGGER tr_hist_bodega_pisos AFTER INSERT OR UPDATE OR DELETE ON public.bodega_pisos
      FOR EACH ROW EXECUTE FUNCTION public.registrar_historial();
  END IF;
END $$;

-- =============================================================================
-- RLS — igual que bodegas: lectura autenticada, escritura roles de bodega
-- =============================================================================
ALTER TABLE bodega_pisos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS auth_read_bodega_pisos ON bodega_pisos;
CREATE POLICY auth_read_bodega_pisos ON bodega_pisos FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS write_bodega_pisos ON bodega_pisos;
CREATE POLICY write_bodega_pisos ON bodega_pisos FOR ALL TO authenticated
  USING (public.auth_rol() IN ('SUPER_ADMIN','ADMIN','BODEGUERO','SUPERVISOR'))
  WITH CHECK (public.auth_rol() IN ('SUPER_ADMIN','ADMIN','BODEGUERO','SUPERVISOR'));

-- =============================================================================
-- SEED: crea un piso 1 por cada bodega que aún no tenga pisos
-- =============================================================================
INSERT INTO bodega_pisos (bodega_id, numero, nombre)
SELECT b.id, 1, 'Planta baja'
FROM bodegas b
WHERE NOT EXISTS (SELECT 1 FROM bodega_pisos p WHERE p.bodega_id = b.id);


-- >>>>>>>>>>>>>>>>>>>> 20240110000000_updated_at_sync.sql >>>>>>>>>>>>>>>>>>>>

-- =============================================================================
-- Offline-first (Fase 1) — updated_at uniforme para sincronización incremental
-- Agrega updated_at + trigger set_updated_at a las tablas sincronizables que no
-- lo tenían, para poder hacer PULL por marca de tiempo (watermark). Aditivo e
-- idempotente. No afecta la app web.
-- =============================================================================

DO $$
DECLARE
  t TEXT;
  -- Tablas editables que se sincronizan al dispositivo y NO tenían updated_at
  tablas TEXT[] := ARRAY[
    'proveedores', 'sedes', 'grupos_contrato', 'usuarios',
    'pedidos_sede', 'rotacion', 'oc_items', 'arqueo_items'
  ];
BEGIN
  FOREACH t IN ARRAY tablas LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()', t);
      -- Backfill inicial: usa created_at si existe, si no NOW()
      IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=t AND column_name='created_at') THEN
        EXECUTE format('UPDATE public.%I SET updated_at = COALESCE(updated_at, created_at) WHERE updated_at IS NULL', t);
      END IF;
      -- Trigger que mantiene updated_at en cada UPDATE
      EXECUTE format('DROP TRIGGER IF EXISTS tr_%1$s_upd ON public.%1$s', t);
      EXECUTE format('CREATE TRIGGER tr_%1$s_upd BEFORE UPDATE ON public.%1$s FOR EACH ROW EXECUTE FUNCTION set_updated_at()', t);
    END IF;
  END LOOP;
END $$;

-- Índices para acelerar el PULL incremental (updated_at)
DO $$
DECLARE
  t TEXT;
  tablas TEXT[] := ARRAY[
    'productos','stock','proveedores','sedes','grupos_contrato','usuarios',
    'bodegas','ubicaciones','ordenes_compra','oc_items','aprovisionamiento',
    'rotacion','pedidos_sede','arqueos','arqueo_items','roles'
  ];
BEGIN
  FOREACH t IN ARRAY tablas LOOP
    IF to_regclass('public.' || t) IS NOT NULL
       AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=t AND column_name='updated_at') THEN
      EXECUTE format('CREATE INDEX IF NOT EXISTS idx_%1$s_updated ON public.%1$s(updated_at)', t);
    END IF;
  END LOOP;
END $$;


-- >>>>>>>>>>>>>>>>>>>> 20240111000000_personas_usuarios_conserjeria.sql >>>>>>>>>>>>>>>>>>>>

-- =============================================================================
-- CONECTAR PERSONAS (Gestión Humana) ↔ USUARIOS (cuentas de plataforma)
-- + ROLES DE CONSERJERÍA (Conserje, Coordinador, Gerencia, Supervisor de Conserjería)
-- =============================================================================
-- Objetivo:
--   1) Cada colaborador (persona) puede tener una cuenta de plataforma con rol.
--      La cuenta se crea desde Gestión Humana (formulario o cargue masivo).
--   2) Roles orientados a la operación de conserjería, no solo a inventario.
--      La plataforma crecerá hacia PQRS, No conformes, Contratos, Gerencia; los
--      permisos correspondientes ya quedan sembrados en cada rol (aunque las
--      pantallas se construyan después).
--
-- Nota de arquitectura: los permisos son DATOS (JSONB en `roles`) que la app
-- web, /usuarios y la app offline (Dexie) consumen igual. Sembrar bien los roles
-- deja "todo con lo mismo" sin tocar código de gating.
-- =============================================================================

-- ── 1) Enlace persona → cuenta de plataforma ─────────────────────────────────
ALTER TABLE public.personas
  ADD COLUMN IF NOT EXISTS usuario_id UUID REFERENCES public.usuarios(id) ON DELETE SET NULL;

-- Una cuenta de plataforma pertenece a lo sumo a una persona.
CREATE UNIQUE INDEX IF NOT EXISTS uidx_personas_usuario_id
  ON public.personas(usuario_id) WHERE usuario_id IS NOT NULL;

COMMENT ON COLUMN public.personas.usuario_id IS
  'Cuenta de plataforma (auth/usuarios) vinculada a este colaborador. NULL = sin acceso.';

-- Backfill: enlazar personas existentes con usuarios que compartan email.
UPDATE public.personas p
SET usuario_id = u.id
FROM public.usuarios u
WHERE p.usuario_id IS NULL
  AND p.email IS NOT NULL
  AND lower(trim(p.email)) = lower(trim(u.email))
  -- evita romper la unicidad si dos personas comparten el mismo email
  AND NOT EXISTS (SELECT 1 FROM public.personas p2 WHERE p2.usuario_id = u.id);

-- ── 2) Renombrar el Supervisor existente → orientado a conserjería ───────────
-- Idempotente y a prueba de re-ejecución: si "Supervisor de Conserjería" ya
-- existe (renombrado en una corrida previa) y perfil_roles_seed re-creó el
-- "Supervisor" base, elimina el duplicado (si nadie lo usa) en vez de renombrar.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.roles WHERE nombre = 'Supervisor de Conserjería') THEN
    DELETE FROM public.roles
    WHERE nombre = 'Supervisor'
      AND id NOT IN (SELECT rol_id FROM public.usuarios WHERE rol_id IS NOT NULL);
  ELSE
    UPDATE public.roles SET nombre = 'Supervisor de Conserjería' WHERE nombre = 'Supervisor';
  END IF;
END $$;

-- ── 3) Roles de conserjería (seed idempotente) ───────────────────────────────
-- Las claves de permisos coinciden con el catálogo de /roles (lib/permisos.ts),
-- incluidas las nuevas del grupo "Operación Conserjería".
-- Nota: se usan literales JSON (`'{...}'::jsonb`) en lugar de jsonb_build_object
-- porque Postgres limita las funciones a 100 argumentos (el rol Gerencia excede).
INSERT INTO public.roles (nombre, descripcion, permisos, activo) VALUES
  (
    'Conserje',
    'Personal en sede: consulta inventario, escanea, registra novedades y radica PQRS.',
    '{
      "ver_productos": true, "ver_stock": true, "usar_scanner": true,
      "ver_movimientos": true, "crear_movimientos": true,
      "ver_notificaciones": true,
      "ver_pqrs": true, "gestionar_pqrs": true,
      "ver_no_conformes": true, "gestionar_no_conformes": true,
      "ver_contratos_conserjeria": true,
      "usar_ia_asistente": true
    }'::jsonb,
    true
  ),
  (
    'Coordinador',
    'Coordina sedes y conserjes: personas, PQRS, no conformes, contratos y reportes.',
    '{
      "ver_productos": true, "ver_stock": true, "ver_movimientos": true, "usar_scanner": true,
      "ver_bodegas": true, "ver_arqueo": true,
      "ver_contratos": true, "ver_proveedores": true, "ver_ordenes_compra": true,
      "ver_reportes": true, "exportar_datos": true,
      "ver_personas": true, "gestionar_personas": true, "importar_personas": true,
      "ver_empresas_usuarias": true, "gestionar_empresas_usuarias": true,
      "ver_documentos_rrhh": true, "gestionar_documentos_rrhh": true,
      "ver_pqrs": true, "gestionar_pqrs": true,
      "ver_no_conformes": true, "gestionar_no_conformes": true,
      "ver_contratos_conserjeria": true, "gestionar_contratos_conserjeria": true,
      "ver_notificaciones": true, "gestionar_alertas": true,
      "ver_documentos": true, "usar_ia_asistente": true, "ver_ia_analisis": true
    }'::jsonb,
    true
  ),
  (
    'Gerencia',
    'Dirección: visibilidad total de la operación, indicadores y panel gerencial.',
    '{
      "ver_productos": true, "editar_productos": true, "ver_stock": true, "ajustar_stock": true,
      "ver_movimientos": true, "crear_movimientos": true, "usar_scanner": true,
      "ver_arqueo": true, "realizar_arqueo": true, "ver_bodegas": true, "gestionar_bodegas": true,
      "generar_codigos": true,
      "ver_aprovisionamiento": true, "editar_aprovisionamiento": true,
      "ver_contratos": true, "editar_contratos": true,
      "ver_proveedores": true, "editar_proveedores": true,
      "ver_ordenes_compra": true, "crear_ordenes_compra": true,
      "ver_reportes": true, "exportar_datos": true,
      "ver_documentos": true, "subir_documentos": true,
      "ver_usuarios": true, "gestionar_usuarios": true, "gestionar_roles": true,
      "importar_datos": true, "ver_actividad_log": true, "ver_historial": true,
      "ver_notificaciones": true, "gestionar_alertas": true,
      "ver_configuracion": true, "editar_configuracion": true,
      "ver_personas": true, "gestionar_personas": true, "importar_personas": true,
      "ver_empresas_usuarias": true, "gestionar_empresas_usuarias": true,
      "ver_documentos_rrhh": true, "gestionar_documentos_rrhh": true, "gestionar_tipos_documentales": true,
      "ver_pqrs": true, "gestionar_pqrs": true,
      "ver_no_conformes": true, "gestionar_no_conformes": true,
      "ver_contratos_conserjeria": true, "gestionar_contratos_conserjeria": true,
      "ver_panel_gerencia": true,
      "usar_ia_vision": true, "usar_ia_asistente": true, "ver_ia_analisis": true
    }'::jsonb,
    true
  )
ON CONFLICT (nombre) DO UPDATE
  SET descripcion = EXCLUDED.descripcion,
      permisos    = public.roles.permisos || EXCLUDED.permisos,  -- merge no destructivo
      updated_at  = NOW();

-- ── 4) Ampliar el Supervisor de Conserjería con permisos de conserjería ──────
UPDATE public.roles SET permisos = permisos || '{
  "ver_personas": true, "ver_empresas_usuarias": true, "ver_documentos_rrhh": true,
  "ver_pqrs": true, "gestionar_pqrs": true,
  "ver_no_conformes": true, "gestionar_no_conformes": true,
  "ver_contratos_conserjeria": true
}'::jsonb WHERE nombre = 'Supervisor de Conserjería';

-- ── 5) Mapear rol_base (enum RLS) de los roles nuevos ────────────────────────
-- Conserje → operación mínima en sede; Coordinador → supervisión; Gerencia → admin.
UPDATE public.roles SET rol_base = 'OPERADOR_SEDE' WHERE nombre = 'Conserje'   AND rol_base IS DISTINCT FROM 'OPERADOR_SEDE';
UPDATE public.roles SET rol_base = 'SUPERVISOR'    WHERE nombre = 'Coordinador' AND rol_base IS DISTINCT FROM 'SUPERVISOR';
UPDATE public.roles SET rol_base = 'ADMIN'         WHERE nombre = 'Gerencia'    AND rol_base IS DISTINCT FROM 'ADMIN';
UPDATE public.roles SET rol_base = 'SUPERVISOR'    WHERE nombre = 'Supervisor de Conserjería' AND rol_base IS NULL;


-- >>>>>>>>>>>>>>>>>>>> 20240112000000_integraciones_correo.sql >>>>>>>>>>>>>>>>>>>>

-- =============================================================================
-- Conserjes Inmobiliarios — Integraciones · Correo electrónico
--
-- Vincula una cuenta de correo (de CUALQUIER plataforma) por SMTP (envío) e
-- IMAP (recepción). Guarda credenciales, estado de la última prueba y toggles.
--
-- Seguridad: SOLO administradores pueden leer/escribir esta tabla (contiene
-- credenciales). RLS estricta. Idempotente.
-- =============================================================================

-- Asegura la función helper de rol (por si la migración inicial no se aplicó).
CREATE OR REPLACE FUNCTION public.auth_rol()
RETURNS rol_usuario
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT rol FROM public.usuarios WHERE id = (SELECT auth.uid()) $$;

CREATE TABLE IF NOT EXISTS integraciones_correo (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre         VARCHAR(120) DEFAULT 'Correo principal',
  from_nombre    VARCHAR(150),                 -- nombre visible del remitente
  from_email     VARCHAR(200),                 -- correo de la cuenta
  -- SMTP (envío) ---------------------------------------------------------------
  smtp_host      VARCHAR(200),
  smtp_port      INTEGER DEFAULT 587,
  smtp_secure    BOOLEAN DEFAULT false,        -- true = SSL directo (465)
  smtp_user      VARCHAR(200),
  smtp_pass      TEXT,                          -- contraseña / app password
  envio_activo   BOOLEAN DEFAULT true,
  -- IMAP (recepción) -----------------------------------------------------------
  imap_host      VARCHAR(200),
  imap_port      INTEGER DEFAULT 993,
  imap_secure    BOOLEAN DEFAULT true,
  imap_user      VARCHAR(200),
  imap_pass      TEXT,
  recepcion_activa BOOLEAN DEFAULT false,
  -- Estado ---------------------------------------------------------------------
  estado         VARCHAR(20) DEFAULT 'SIN_PROBAR', -- SIN_PROBAR | OK | ERROR
  ultimo_test    TIMESTAMPTZ,
  ultimo_error   TEXT,
  activo         BOOLEAN DEFAULT true,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW()
);

DROP TRIGGER IF EXISTS tr_integr_correo_upd ON integraciones_correo;
CREATE TRIGGER tr_integr_correo_upd BEFORE UPDATE ON integraciones_correo
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =============================================================================
-- RLS — solo administradores (la tabla guarda credenciales)
-- =============================================================================
ALTER TABLE integraciones_correo ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS admin_all_integr_correo ON integraciones_correo;
CREATE POLICY admin_all_integr_correo ON integraciones_correo FOR ALL TO authenticated
  USING (public.auth_rol() IN ('SUPER_ADMIN','ADMIN'))
  WITH CHECK (public.auth_rol() IN ('SUPER_ADMIN','ADMIN'));


-- >>>>>>>>>>>>>>>>>>>> 20240112000000_parametrizacion_sede.sql >>>>>>>>>>>>>>>>>>>>

-- =============================================================================
-- PARAMETRIZACIÓN POR SEDE
-- =============================================================================
-- Cada sede puede tener un catálogo específico de productos, cada uno con una
-- cantidad máxima (y mínima opcional para reposición). Es la base para el futuro
-- MÓDULO DE CONTRATO, que asignará estas parametrizaciones — por eso se reserva
-- la columna `contrato_id` (aún sin FK: la tabla `contratos` se creará después).
-- =============================================================================

CREATE TABLE IF NOT EXISTS sede_productos (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sede_id          UUID NOT NULL REFERENCES sedes(id) ON DELETE CASCADE,
  producto_id      UUID NOT NULL REFERENCES productos(id) ON DELETE CASCADE,
  cantidad_maxima  DECIMAL(10,2) NOT NULL DEFAULT 0,
  cantidad_minima  DECIMAL(10,2) DEFAULT 0,
  activo           BOOLEAN NOT NULL DEFAULT true,
  observacion      TEXT,
  -- Reservado para el futuro módulo de contratos (sin FK hasta que exista la tabla).
  contrato_id      UUID,
  created_by       UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (sede_id, producto_id)
);

CREATE INDEX IF NOT EXISTS idx_sede_productos_sede     ON sede_productos(sede_id);
CREATE INDEX IF NOT EXISTS idx_sede_productos_producto ON sede_productos(producto_id);
CREATE INDEX IF NOT EXISTS idx_sede_productos_contrato ON sede_productos(contrato_id);

COMMENT ON TABLE  sede_productos IS 'Parametrización por sede: catálogo de productos permitidos y su cantidad máxima/mínima. Base del futuro módulo de contratos.';
COMMENT ON COLUMN sede_productos.contrato_id IS 'Reservado: el módulo de contratos asignará estas parametrizaciones. Sin FK hasta que exista la tabla contratos.';

-- updated_at
DROP TRIGGER IF EXISTS tr_sede_productos_upd ON sede_productos;
CREATE TRIGGER tr_sede_productos_upd BEFORE UPDATE ON sede_productos
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =============================================================================
-- RLS
-- =============================================================================
ALTER TABLE sede_productos ENABLE ROW LEVEL SECURITY;

-- Lectura: cualquier usuario autenticado.
DROP POLICY IF EXISTS sp_read ON sede_productos;
CREATE POLICY sp_read ON sede_productos FOR SELECT TO authenticated USING (true);

-- Escritura: administración y coordinación.
DROP POLICY IF EXISTS sp_write ON sede_productos;
CREATE POLICY sp_write ON sede_productos FOR ALL TO authenticated
  USING (public.auth_rol() IN ('SUPER_ADMIN','ADMIN','SUPERVISOR','COORDINADOR_COMPRAS'))
  WITH CHECK (public.auth_rol() IN ('SUPER_ADMIN','ADMIN','SUPERVISOR','COORDINADOR_COMPRAS'));

-- =============================================================================
-- PERMISOS EN LOS ROLES (claves del catálogo lib/permisos.ts)
-- =============================================================================
-- Ver + gestionar: administración, compras, gerencia y coordinación.
UPDATE public.roles
SET permisos = permisos || '{"ver_parametrizacion": true, "gestionar_parametrizacion": true}'::jsonb
WHERE rol_base IN ('SUPER_ADMIN','ADMIN','COORDINADOR_COMPRAS')
   OR nombre IN ('Gerencia','Coordinador');

-- Solo ver: supervisión, auditoría y bodega.
UPDATE public.roles
SET permisos = permisos || '{"ver_parametrizacion": true}'::jsonb
WHERE rol_base IN ('SUPERVISOR','AUDITOR','BODEGUERO')
   OR nombre IN ('Supervisor de Conserjería');


-- >>>>>>>>>>>>>>>>>>>> 20240113000000_correo_alertas.sql >>>>>>>>>>>>>>>>>>>>

-- =============================================================================
-- Conserjes Inmobiliarios — Alertas por correo (buzón de salida)
--
-- Cuando una regla de alerta tiene canal_email = true, emitir_notificacion()
-- encola un correo por cada destinatario en `correo_saliente`. Un proceso
-- externo (cron / botón) los envía por SMTP con la integración de correo.
--
-- IDEMPOTENTE.
-- =============================================================================

-- Asegura la función helper de rol (por si la migración inicial no se aplicó).
CREATE OR REPLACE FUNCTION public.auth_rol()
RETURNS rol_usuario
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT rol FROM public.usuarios WHERE id = (SELECT auth.uid()) $$;

-- Buzón de salida -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS correo_saliente (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  para         VARCHAR(200) NOT NULL,
  asunto       VARCHAR(300),
  cuerpo_texto TEXT,
  enlace       VARCHAR(400),               -- ruta interna (se hace absoluta al enviar)
  estado       VARCHAR(20) DEFAULT 'PENDIENTE', -- PENDIENTE | ENVIADO | ERROR
  intentos     INTEGER DEFAULT 0,
  error        TEXT,
  origen       VARCHAR(80),                -- 'notificacion'
  ref_id       TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  enviado_at   TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_correo_saliente_estado ON correo_saliente(estado, created_at);

ALTER TABLE correo_saliente ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS admin_correo_saliente ON correo_saliente;
CREATE POLICY admin_correo_saliente ON correo_saliente FOR ALL TO authenticated
  USING (public.auth_rol() IN ('SUPER_ADMIN','ADMIN'))
  WITH CHECK (public.auth_rol() IN ('SUPER_ADMIN','ADMIN'));

-- =============================================================================
-- emitir_notificacion: ahora entrega por app (canal_app) Y/O encola email
-- (canal_email). SECURITY DEFINER → puede insertar en ambas tablas.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.emitir_notificacion(
  p_codigo      tipo_notificacion,
  p_titulo      TEXT,
  p_descripcion TEXT DEFAULT NULL,
  p_entidad     TEXT DEFAULT NULL,
  p_entidad_id  TEXT DEFAULT NULL,
  p_enlace      TEXT DEFAULT NULL,
  p_metadata    JSONB DEFAULT '{}'
) RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_regla reglas_alerta%ROWTYPE;
  v_count INTEGER := 0;
BEGIN
  SELECT * INTO v_regla FROM reglas_alerta WHERE codigo = p_codigo;
  IF NOT FOUND OR NOT v_regla.activa THEN
    RETURN 0;
  END IF;

  -- Canal app (bandeja en la plataforma)
  IF v_regla.canal_app THEN
    INSERT INTO notificaciones (usuario_id, tipo, severidad, titulo, descripcion, entidad, entidad_id, enlace, metadata, regla_codigo)
    SELECT u.id, v_regla.codigo, v_regla.severidad, p_titulo, p_descripcion, p_entidad, p_entidad_id, p_enlace, COALESCE(p_metadata, '{}'), v_regla.codigo
    FROM usuarios u
    LEFT JOIN notificaciones_preferencias pref ON pref.usuario_id = u.id
    WHERE u.activo
      AND u.rol = ANY (v_regla.roles_destino)
      AND (pref.tipos_silenciados IS NULL OR NOT (v_regla.codigo = ANY (pref.tipos_silenciados)));
    GET DIAGNOSTICS v_count = ROW_COUNT;
  END IF;

  -- Canal email (encola en el buzón de salida)
  IF v_regla.canal_email THEN
    INSERT INTO correo_saliente (para, asunto, cuerpo_texto, enlace, origen, ref_id)
    SELECT u.email, p_titulo, COALESCE(p_descripcion, ''), p_enlace, 'notificacion', p_entidad_id
    FROM usuarios u
    LEFT JOIN notificaciones_preferencias pref ON pref.usuario_id = u.id
    WHERE u.activo
      AND u.email IS NOT NULL
      AND u.rol = ANY (v_regla.roles_destino)
      AND (pref.tipos_silenciados IS NULL OR NOT (v_regla.codigo = ANY (pref.tipos_silenciados)));
  END IF;

  RETURN v_count;
EXCEPTION WHEN OTHERS THEN
  RETURN 0;
END $$;


-- >>>>>>>>>>>>>>>>>>>> 20240113000000_ordenes_insumo.sql >>>>>>>>>>>>>>>>>>>>

-- =============================================================================
-- ÓRDENES DE INSUMO (despacho a bodega + alistamiento + video de despacho)
-- =============================================================================
-- Flujo:
--   1) Se crea una orden POR SEDE tomando su parametrización (sede_productos):
--      productos permitidos + cantidad máxima (propuesta, editable hacia abajo).
--   2) Llega a la bodega como orden de despacho (estado PENDIENTE).
--   3) ALISTAMIENTO: se marca ítem por ítem lo que se va alistando y se asignan
--      responsables.
--   4) DESPACHO: se graba/sube un VIDEO que queda ligado a la orden y se registra
--      la SALIDA de stock (traslado de mercancía a la sede) vía registrar_movimiento.
--
-- `contrato_id` queda reservado para el futuro módulo de contratos.
-- =============================================================================

DO $$ BEGIN
  CREATE TYPE estado_orden_insumo AS ENUM
    ('PENDIENTE','EN_ALISTAMIENTO','ALISTADO','DESPACHADO','ANULADA');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ── Cabecera ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ordenes_insumo (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  numero                   VARCHAR(30) UNIQUE NOT NULL,
  sede_id                  UUID NOT NULL REFERENCES sedes(id),
  bodega_id                UUID REFERENCES bodegas(id) ON DELETE SET NULL,
  estado                   estado_orden_insumo NOT NULL DEFAULT 'PENDIENTE',
  periodo                  DATE,
  observacion              TEXT,
  contrato_id              UUID,  -- reservado para el módulo de contratos
  creado_por               UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  alistamiento_iniciado_at TIMESTAMPTZ,
  alistado_at              TIMESTAMPTZ,
  despachado_por           UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  despachado_at            TIMESTAMPTZ,
  video_path               TEXT,          -- ruta en el bucket privado ordenes-insumo
  video_mime               VARCHAR(60),
  created_at               TIMESTAMPTZ DEFAULT NOW(),
  updated_at               TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_oi_sede    ON ordenes_insumo(sede_id);
CREATE INDEX IF NOT EXISTS idx_oi_estado  ON ordenes_insumo(estado);
CREATE INDEX IF NOT EXISTS idx_oi_creada  ON ordenes_insumo(created_at DESC);

-- ── Ítems ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS orden_insumo_items (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  orden_id            UUID NOT NULL REFERENCES ordenes_insumo(id) ON DELETE CASCADE,
  producto_id         UUID NOT NULL REFERENCES productos(id),
  cantidad_solicitada DECIMAL(10,2) NOT NULL DEFAULT 0,
  cantidad_maxima_ref DECIMAL(10,2) DEFAULT 0,   -- máximo parametrizado al crear
  cantidad_alistada   DECIMAL(10,2) NOT NULL DEFAULT 0,
  alistado            BOOLEAN NOT NULL DEFAULT false,
  alistado_por        UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  alistado_at         TIMESTAMPTZ,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (orden_id, producto_id)
);

CREATE INDEX IF NOT EXISTS idx_oi_items_orden ON orden_insumo_items(orden_id);

-- ── Responsables del alistamiento ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS orden_insumo_responsables (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  orden_id   UUID NOT NULL REFERENCES ordenes_insumo(id) ON DELETE CASCADE,
  usuario_id UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (orden_id, usuario_id)
);

CREATE INDEX IF NOT EXISTS idx_oi_resp_orden ON orden_insumo_responsables(orden_id);

-- ── updated_at ───────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS tr_ordenes_insumo_upd ON ordenes_insumo;
CREATE TRIGGER tr_ordenes_insumo_upd BEFORE UPDATE ON ordenes_insumo
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =============================================================================
-- RLS
-- =============================================================================
ALTER TABLE ordenes_insumo            ENABLE ROW LEVEL SECURITY;
ALTER TABLE orden_insumo_items        ENABLE ROW LEVEL SECURITY;
ALTER TABLE orden_insumo_responsables ENABLE ROW LEVEL SECURITY;

-- Lectura: cualquier autenticado.
DROP POLICY IF EXISTS oi_read ON ordenes_insumo;
CREATE POLICY oi_read ON ordenes_insumo FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS oi_items_read ON orden_insumo_items;
CREATE POLICY oi_items_read ON orden_insumo_items FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS oi_resp_read ON orden_insumo_responsables;
CREATE POLICY oi_resp_read ON orden_insumo_responsables FOR SELECT TO authenticated USING (true);

-- Escritura: administración, supervisión, bodega y compras.
DROP POLICY IF EXISTS oi_write ON ordenes_insumo;
CREATE POLICY oi_write ON ordenes_insumo FOR ALL TO authenticated
  USING (public.auth_rol() IN ('SUPER_ADMIN','ADMIN','SUPERVISOR','BODEGUERO','COORDINADOR_COMPRAS'))
  WITH CHECK (public.auth_rol() IN ('SUPER_ADMIN','ADMIN','SUPERVISOR','BODEGUERO','COORDINADOR_COMPRAS'));
DROP POLICY IF EXISTS oi_items_write ON orden_insumo_items;
CREATE POLICY oi_items_write ON orden_insumo_items FOR ALL TO authenticated
  USING (public.auth_rol() IN ('SUPER_ADMIN','ADMIN','SUPERVISOR','BODEGUERO','COORDINADOR_COMPRAS'))
  WITH CHECK (public.auth_rol() IN ('SUPER_ADMIN','ADMIN','SUPERVISOR','BODEGUERO','COORDINADOR_COMPRAS'));
DROP POLICY IF EXISTS oi_resp_write ON orden_insumo_responsables;
CREATE POLICY oi_resp_write ON orden_insumo_responsables FOR ALL TO authenticated
  USING (public.auth_rol() IN ('SUPER_ADMIN','ADMIN','SUPERVISOR','BODEGUERO','COORDINADOR_COMPRAS'))
  WITH CHECK (public.auth_rol() IN ('SUPER_ADMIN','ADMIN','SUPERVISOR','BODEGUERO','COORDINADOR_COMPRAS'));

-- =============================================================================
-- STORAGE — bucket PRIVADO para los videos de despacho
-- =============================================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('ordenes-insumo', 'ordenes-insumo', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "oi_read_bucket"   ON storage.objects;
DROP POLICY IF EXISTS "oi_upload_bucket" ON storage.objects;
DROP POLICY IF EXISTS "oi_delete_bucket" ON storage.objects;
CREATE POLICY "oi_read_bucket" ON storage.objects
  FOR SELECT TO authenticated USING (bucket_id = 'ordenes-insumo');
CREATE POLICY "oi_upload_bucket" ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (bucket_id = 'ordenes-insumo');
CREATE POLICY "oi_delete_bucket" ON storage.objects
  FOR DELETE TO authenticated USING (bucket_id = 'ordenes-insumo');

-- =============================================================================
-- PERMISOS EN LOS ROLES (claves del catálogo lib/permisos.ts)
-- =============================================================================
-- Ver + crear + alistar: administración, gerencia, supervisión.
UPDATE public.roles
SET permisos = permisos || '{"ver_ordenes_insumo": true, "crear_ordenes_insumo": true, "alistar_ordenes_insumo": true}'::jsonb
WHERE rol_base IN ('SUPER_ADMIN','ADMIN','SUPERVISOR')
   OR nombre IN ('Gerencia','Coordinador');

-- Compras: ver + crear.
UPDATE public.roles
SET permisos = permisos || '{"ver_ordenes_insumo": true, "crear_ordenes_insumo": true}'::jsonb
WHERE rol_base = 'COORDINADOR_COMPRAS';

-- Bodega: ver + alistar (arma y despacha el pedido).
UPDATE public.roles
SET permisos = permisos || '{"ver_ordenes_insumo": true, "alistar_ordenes_insumo": true}'::jsonb
WHERE rol_base = 'BODEGUERO';

-- Auditor: solo ver.
UPDATE public.roles
SET permisos = permisos || '{"ver_ordenes_insumo": true}'::jsonb
WHERE rol_base = 'AUDITOR';

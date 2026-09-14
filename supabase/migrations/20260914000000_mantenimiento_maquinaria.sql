-- =============================================================================
-- MÓDULO: MANTENIMIENTO DE MAQUINARIA
-- =============================================================================
-- Se monta sobre `maquinaria` (código único + QR + bitácora `maquinaria_eventos`).
--
--   1) Plan preventivo y condición física del equipo en `maquinaria`.
--   2) `mantenimiento_tickets`: reportes de falla / preventivos / soporte remoto,
--      con flujo ABIERTO → RECIBIDO → EN_PROCESO ⇄ EN_ESPERA → RESUELTO → CERRADO.
--   3) `mantenimiento_mensajes`: chat del ticket (texto + archivos), en Realtime.
--   4) `mantenimiento_actividades`: lo que el personal de sede o el técnico hace
--      sobre el equipo (inspección, limpieza, prueba…), con checklist y fotos.
--   5) Toda acción deja rastro en `maquinaria_eventos` con `ticket_id`, así la
--      hoja de vida del equipo es UNA sola línea de tiempo.
--
-- Las escrituras de tickets y actividades van SOLO por RPC (SECURITY DEFINER):
-- el conserje reporta sin tener permiso de editar la maquinaria, y el cambio de
-- estado del equipo queda atado al ticket que lo provocó.
--
-- Permisos nuevos (catálogo en lib/permisos.ts):
--   ver_mantenimiento          tablero y tickets
--   reportar_falla_maquinaria  escanear equipo, reportar, actividades, chat
--   atender_mantenimiento      recibir, diagnosticar, resolver (técnico)
--   gestionar_mantenimiento    asignar, cancelar, programar preventivos (jefe)
--
-- IDEMPOTENTE.
-- =============================================================================

SET search_path TO public;

-- ── 1) Maquinaria: condición y plan preventivo ──────────────────────────────
ALTER TABLE maquinaria ADD COLUMN IF NOT EXISTS condicion VARCHAR(12) NOT NULL DEFAULT 'BUENA';
ALTER TABLE maquinaria ADD COLUMN IF NOT EXISTS frecuencia_mant_dias INTEGER;
ALTER TABLE maquinaria ADD COLUMN IF NOT EXISTS ultimo_mant_at TIMESTAMPTZ;
ALTER TABLE maquinaria ADD COLUMN IF NOT EXISTS proximo_mant DATE;

DO $$ BEGIN
  ALTER TABLE maquinaria ADD CONSTRAINT maquinaria_condicion_chk
    CHECK (condicion IN ('BUENA','REGULAR','MALA'));
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE maquinaria ADD CONSTRAINT maquinaria_frecuencia_chk
    CHECK (frecuencia_mant_dias IS NULL OR frecuencia_mant_dias > 0);
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE INDEX IF NOT EXISTS idx_maquinaria_proximo_mant ON maquinaria(proximo_mant) WHERE proximo_mant IS NOT NULL;

-- Próximo mantenimiento: se recalcula cuando cambia la frecuencia o el último.
CREATE OR REPLACE FUNCTION public.tr_maquinaria_proximo_mant()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.frecuencia_mant_dias IS NULL THEN
    NEW.proximo_mant := NULL;
  ELSIF TG_OP = 'INSERT'
     OR NEW.frecuencia_mant_dias IS DISTINCT FROM OLD.frecuencia_mant_dias
     OR NEW.ultimo_mant_at IS DISTINCT FROM OLD.ultimo_mant_at
     OR NEW.proximo_mant IS NULL THEN
    NEW.proximo_mant := (COALESCE(NEW.ultimo_mant_at::date, NEW.fecha_adquisicion, NEW.created_at::date, CURRENT_DATE)
                         + NEW.frecuencia_mant_dias);
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS tr_maquinaria_proximo_mant ON maquinaria;
CREATE TRIGGER tr_maquinaria_proximo_mant BEFORE INSERT OR UPDATE ON maquinaria
  FOR EACH ROW EXECUTE FUNCTION public.tr_maquinaria_proximo_mant();

-- ── 2) Tickets de mantenimiento ─────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE estado_ticket_mant AS ENUM
    ('ABIERTO','RECIBIDO','EN_PROCESO','EN_ESPERA','RESUELTO','CERRADO','CANCELADO');
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE SEQUENCE IF NOT EXISTS mantenimiento_ticket_seq;

CREATE TABLE IF NOT EXISTS mantenimiento_tickets (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  numero                  VARCHAR(30) NOT NULL UNIQUE,
  -- RESTRICT: un equipo con mantenimientos no se borra (se da de baja).
  maquinaria_id           UUID NOT NULL REFERENCES maquinaria(id) ON DELETE RESTRICT,
  sede_id                 UUID REFERENCES sedes(id) ON DELETE SET NULL,  -- dónde estaba al reportar
  tipo                    VARCHAR(20) NOT NULL DEFAULT 'CORRECTIVO'
                          CHECK (tipo IN ('CORRECTIVO','PREVENTIVO','INSPECCION','SOPORTE_REMOTO')),
  prioridad               VARCHAR(10) NOT NULL DEFAULT 'MEDIA'
                          CHECK (prioridad IN ('BAJA','MEDIA','ALTA','CRITICA')),
  estado                  estado_ticket_mant NOT NULL DEFAULT 'ABIERTO',
  titulo                  VARCHAR(200) NOT NULL,
  descripcion             TEXT,
  estado_equipo_reportado estado_maquinaria,
  fotos                   TEXT[] NOT NULL DEFAULT '{}',   -- rutas en el bucket `mantenimiento`
  programado_para         DATE,
  reportado_por           UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  reportado_nombre        VARCHAR(200),
  asignado_a              UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  recibido_por            UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  recibido_at             TIMESTAMPTZ,
  iniciado_at             TIMESTAMPTZ,
  resuelto_at             TIMESTAMPTZ,
  cerrado_at              TIMESTAMPTZ,
  diagnostico             TEXT,
  solucion                TEXT,
  costo                   NUMERIC(14,2),
  estado_equipo_final     estado_maquinaria,
  ultimo_mensaje_at       TIMESTAMPTZ,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_mant_tickets_maq      ON mantenimiento_tickets(maquinaria_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mant_tickets_estado   ON mantenimiento_tickets(estado, prioridad);
CREATE INDEX IF NOT EXISTS idx_mant_tickets_asignado ON mantenimiento_tickets(asignado_a) WHERE asignado_a IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_mant_tickets_reporta  ON mantenimiento_tickets(reportado_por);
CREATE INDEX IF NOT EXISTS idx_mant_tickets_sede     ON mantenimiento_tickets(sede_id);
CREATE INDEX IF NOT EXISTS idx_mant_tickets_recibido ON mantenimiento_tickets(recibido_por) WHERE recibido_por IS NOT NULL;

DROP TRIGGER IF EXISTS tr_mant_tickets_upd ON mantenimiento_tickets;
CREATE TRIGGER tr_mant_tickets_upd BEFORE UPDATE ON mantenimiento_tickets
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Nombres desnormalizados: la RLS de `usuarios` solo deja leer el propio
-- registro, así que el conserje no podría ver quién atiende su reporte.
ALTER TABLE mantenimiento_tickets ADD COLUMN IF NOT EXISTS asignado_nombre VARCHAR(200);
ALTER TABLE mantenimiento_tickets ADD COLUMN IF NOT EXISTS recibido_nombre VARCHAR(200);

CREATE OR REPLACE FUNCTION public.tr_mant_tickets_nombres()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.asignado_a IS DISTINCT FROM OLD.asignado_a THEN
    NEW.asignado_nombre := (SELECT nombre FROM usuarios WHERE id = NEW.asignado_a);
  END IF;
  IF TG_OP = 'INSERT' OR NEW.recibido_por IS DISTINCT FROM OLD.recibido_por THEN
    NEW.recibido_nombre := (SELECT nombre FROM usuarios WHERE id = NEW.recibido_por);
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS tr_mant_tickets_nombres ON mantenimiento_tickets;
CREATE TRIGGER tr_mant_tickets_nombres BEFORE INSERT OR UPDATE ON mantenimiento_tickets
  FOR EACH ROW EXECUTE FUNCTION public.tr_mant_tickets_nombres();

-- ── 3) Chat del ticket ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS mantenimiento_mensajes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id       UUID NOT NULL REFERENCES mantenimiento_tickets(id) ON DELETE CASCADE,
  usuario_id      UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  usuario_nombre  VARCHAR(200),
  tipo            VARCHAR(10) NOT NULL DEFAULT 'MENSAJE' CHECK (tipo IN ('MENSAJE','ADJUNTO','SISTEMA')),
  mensaje         TEXT,
  adjunto_path    TEXT,
  adjunto_nombre  VARCHAR(255),
  adjunto_mime    VARCHAR(120),
  adjunto_bytes   BIGINT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT mant_msj_contenido CHECK (NULLIF(btrim(mensaje), '') IS NOT NULL OR adjunto_path IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_mant_mensajes_ticket  ON mantenimiento_mensajes(ticket_id, created_at);
CREATE INDEX IF NOT EXISTS idx_mant_mensajes_usuario ON mantenimiento_mensajes(usuario_id);

-- El autor lo pone la base de datos, no el cliente.
CREATE OR REPLACE FUNCTION public.tr_mant_mensaje_autor()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.tipo <> 'SISTEMA' OR NEW.usuario_id IS NULL THEN
    NEW.usuario_id := COALESCE((SELECT auth.uid()), NEW.usuario_id);
  END IF;
  IF NEW.usuario_id IS NOT NULL THEN
    SELECT nombre INTO NEW.usuario_nombre FROM usuarios WHERE id = NEW.usuario_id;
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS tr_mant_mensaje_autor ON mantenimiento_mensajes;
CREATE TRIGGER tr_mant_mensaje_autor BEFORE INSERT ON mantenimiento_mensajes
  FOR EACH ROW EXECUTE FUNCTION public.tr_mant_mensaje_autor();

CREATE OR REPLACE FUNCTION public.tr_mant_mensaje_ultimo()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.tipo <> 'SISTEMA' THEN
    UPDATE mantenimiento_tickets SET ultimo_mensaje_at = NEW.created_at WHERE id = NEW.ticket_id;
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS tr_mant_mensaje_ultimo ON mantenimiento_mensajes;
CREATE TRIGGER tr_mant_mensaje_ultimo AFTER INSERT ON mantenimiento_mensajes
  FOR EACH ROW EXECUTE FUNCTION public.tr_mant_mensaje_ultimo();

-- ── 4) Actividades sobre el equipo ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS mantenimiento_actividades (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  maquinaria_id   UUID NOT NULL REFERENCES maquinaria(id) ON DELETE RESTRICT,
  ticket_id       UUID REFERENCES mantenimiento_tickets(id) ON DELETE SET NULL,
  sede_id         UUID REFERENCES sedes(id) ON DELETE SET NULL,
  tipo            VARCHAR(20) NOT NULL
                  CHECK (tipo IN ('INSPECCION','USO','LIMPIEZA','LUBRICACION','REVISION','REPARACION','PRUEBA','OTRO')),
  resultado       VARCHAR(10) NOT NULL DEFAULT 'OK' CHECK (resultado IN ('OK','NOVEDAD')),
  descripcion     TEXT,
  checklist       JSONB NOT NULL DEFAULT '[]',     -- [{"item": "Cable sin daños", "ok": true}]
  condicion       VARCHAR(12) CHECK (condicion IS NULL OR condicion IN ('BUENA','REGULAR','MALA')),
  fotos           TEXT[] NOT NULL DEFAULT '{}',
  usuario_id      UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  usuario_nombre  VARCHAR(200),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_mant_act_maq     ON mantenimiento_actividades(maquinaria_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mant_act_ticket  ON mantenimiento_actividades(ticket_id) WHERE ticket_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_mant_act_sede    ON mantenimiento_actividades(sede_id);
CREATE INDEX IF NOT EXISTS idx_mant_act_usuario ON mantenimiento_actividades(usuario_id);

-- ── 5) Trazabilidad: la bitácora del equipo sabe de qué ticket viene ─────────
ALTER TABLE maquinaria_eventos ADD COLUMN IF NOT EXISTS ticket_id UUID;
DO $$ BEGIN
  ALTER TABLE maquinaria_eventos ADD CONSTRAINT maquinaria_eventos_ticket_fk
    FOREIGN KEY (ticket_id) REFERENCES mantenimiento_tickets(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN null; END $$;
CREATE INDEX IF NOT EXISTS idx_maq_eventos_ticket ON maquinaria_eventos(ticket_id) WHERE ticket_id IS NOT NULL;

-- `maq_evento` (lo usa también el trigger de cambios de estado/ubicación) toma
-- el ticket en curso de la variable de transacción `app.mant_ticket`, que ponen
-- las RPC de este módulo. Así el "Estado: DANADA → MANTENIMIENTO" que dispara el
-- trigger queda enlazado al ticket sin tocar el trigger.
CREATE OR REPLACE FUNCTION public.maq_evento(
  p_maq UUID, p_tipo VARCHAR, p_estado_ant estado_maquinaria, p_estado_nue estado_maquinaria,
  p_ubic VARCHAR, p_desc TEXT, p_foto TEXT, p_detalle JSONB
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid UUID; v_email VARCHAR(200); v_nombre VARCHAR(200); v_ticket UUID;
BEGIN
  v_uid := (SELECT auth.uid());
  IF v_uid IS NOT NULL THEN SELECT email, nombre INTO v_email, v_nombre FROM usuarios WHERE id = v_uid; END IF;
  v_ticket := NULLIF(current_setting('app.mant_ticket', true), '')::uuid;
  INSERT INTO maquinaria_eventos (maquinaria_id, tipo, estado_anterior, estado_nuevo, ubicacion, descripcion, foto_path, detalle, usuario_id, usuario_email, usuario_nombre, ticket_id)
  VALUES (p_maq, p_tipo, p_estado_ant, p_estado_nue, p_ubic, p_desc, p_foto, p_detalle, v_uid, v_email, v_nombre, v_ticket);
END; $$;
GRANT EXECUTE ON FUNCTION public.maq_evento(UUID, VARCHAR, estado_maquinaria, estado_maquinaria, VARCHAR, TEXT, TEXT, JSONB) TO authenticated;

-- ── 6) RPC ──────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.mant_puede_participar()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.auth_permiso_any('{ver_mantenimiento,reportar_falla_maquinaria,atender_mantenimiento,gestionar_mantenimiento}'::text[])
$$;
GRANT EXECUTE ON FUNCTION public.mant_puede_participar() TO authenticated;

-- Personal de mantenimiento activo (para asignar tickets).
CREATE OR REPLACE FUNCTION public.mant_tecnicos()
RETURNS TABLE (id UUID, nombre VARCHAR, rol_nombre VARCHAR)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT u.id, u.nombre, r.nombre
    FROM usuarios u
    LEFT JOIN roles r ON r.id = u.rol_id
   WHERE public.mant_puede_participar()
     AND u.activo
     AND u.rol NOT IN ('SUPER_ADMIN','ADMIN')
     AND (COALESCE(u.permisos ->> 'atender_mantenimiento', r.permisos ->> 'atender_mantenimiento') = 'true'
       OR COALESCE(u.permisos ->> 'gestionar_mantenimiento', r.permisos ->> 'gestionar_mantenimiento') = 'true')
   ORDER BY u.nombre
$$;
GRANT EXECUTE ON FUNCTION public.mant_tecnicos() TO authenticated;

CREATE OR REPLACE FUNCTION public.mant_sistema(p_ticket UUID, p_texto TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO mantenimiento_mensajes (ticket_id, usuario_id, tipo, mensaje)
  VALUES (p_ticket, (SELECT auth.uid()), 'SISTEMA', p_texto);
END; $$;
REVOKE ALL ON FUNCTION public.mant_sistema(UUID, TEXT) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.mant_notificar(p_codigo TEXT, p_ticket UUID, p_extra JSONB DEFAULT '{}')
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v JSONB;
BEGIN
  SELECT jsonb_build_object(
           'ticket_id', t.id, 'numero', t.numero, 'titulo', t.titulo, 'tipo', t.tipo,
           'prioridad', t.prioridad, 'estado', t.estado, 'equipo_codigo', m.codigo,
           'equipo_nombre', m.nombre, 'sede', s.nombre, 'reportado_por', t.reportado_nombre,
           'asignado_a', ua.nombre, 'enlace', '/mantenimiento/' || t.id)
         || COALESCE(p_extra, '{}')
    INTO v
    FROM mantenimiento_tickets t
    JOIN maquinaria m ON m.id = t.maquinaria_id
    LEFT JOIN sedes s ON s.id = t.sede_id
    LEFT JOIN usuarios ua ON ua.id = t.asignado_a
   WHERE t.id = p_ticket;
  PERFORM public.emitir_evento(p_codigo, v, 'MantenimientoTicket', p_ticket::text);
EXCEPTION WHEN OTHERS THEN
  -- Notificar nunca debe tumbar la operación principal.
  RAISE WARNING 'mant_notificar(%): %', p_codigo, SQLERRM;
END; $$;
REVOKE ALL ON FUNCTION public.mant_notificar(TEXT, UUID, JSONB) FROM PUBLIC;

-- Reportar falla / crear ticket ----------------------------------------------
CREATE OR REPLACE FUNCTION public.mant_reportar(
  p_maquinaria    UUID,
  p_tipo          TEXT,
  p_prioridad     TEXT,
  p_titulo        TEXT,
  p_descripcion   TEXT DEFAULT NULL,
  p_estado_equipo estado_maquinaria DEFAULT NULL,
  p_fotos         TEXT[] DEFAULT '{}',
  p_programado    DATE DEFAULT NULL,
  p_asignado      UUID DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid UUID := (SELECT auth.uid());
  v_nombre VARCHAR(200);
  v_maq maquinaria%ROWTYPE;
  v_id UUID;
  v_numero VARCHAR(30);
  v_tipo TEXT := upper(COALESCE(p_tipo, 'CORRECTIVO'));
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Sesión requerida'; END IF;
  IF v_tipo IN ('PREVENTIVO','INSPECCION') OR p_asignado IS NOT NULL THEN
    IF NOT public.auth_permiso_any('{atender_mantenimiento,gestionar_mantenimiento}'::text[]) THEN
      RAISE EXCEPTION 'No tienes permiso para programar mantenimientos.';
    END IF;
  ELSIF NOT public.auth_permiso_any('{reportar_falla_maquinaria,atender_mantenimiento,gestionar_mantenimiento}'::text[]) THEN
    RAISE EXCEPTION 'No tienes permiso para reportar fallas de maquinaria.';
  END IF;
  IF NULLIF(btrim(p_titulo), '') IS NULL THEN RAISE EXCEPTION 'Describe brevemente la falla.'; END IF;

  SELECT * INTO v_maq FROM maquinaria WHERE id = p_maquinaria;
  IF NOT FOUND THEN RAISE EXCEPTION 'Equipo no encontrado.'; END IF;
  IF v_maq.estado = 'BAJA' OR v_maq.activo = false THEN
    RAISE EXCEPTION 'El equipo % está dado de baja.', v_maq.codigo;
  END IF;

  SELECT nombre INTO v_nombre FROM usuarios WHERE id = v_uid;
  v_numero := 'MT-' || to_char(NOW(), 'YYYYMM') || '-' || lpad(nextval('mantenimiento_ticket_seq')::text, 5, '0');

  INSERT INTO mantenimiento_tickets (
    numero, maquinaria_id, sede_id, tipo, prioridad, titulo, descripcion,
    estado_equipo_reportado, fotos, programado_para, reportado_por, reportado_nombre,
    asignado_a, estado)
  VALUES (
    v_numero, v_maq.id, v_maq.ubicacion_sede_id, v_tipo, upper(COALESCE(p_prioridad, 'MEDIA')),
    btrim(p_titulo), NULLIF(btrim(p_descripcion), ''), p_estado_equipo,
    COALESCE(p_fotos, '{}'), p_programado, v_uid, v_nombre,
    p_asignado, CASE WHEN p_asignado IS NULL THEN 'ABIERTO' ELSE 'RECIBIDO' END::estado_ticket_mant)
  RETURNING id INTO v_id;

  PERFORM set_config('app.mant_ticket', v_id::text, true);

  PERFORM maq_evento(v_maq.id, 'MANTENIMIENTO', NULL, NULL, NULL,
    CASE v_tipo
      WHEN 'CORRECTIVO'     THEN 'Falla reportada '
      WHEN 'SOPORTE_REMOTO' THEN 'Soporte remoto solicitado '
      WHEN 'PREVENTIVO'     THEN 'Preventivo programado '
      ELSE 'Inspección programada ' END
      || v_numero || ': ' || btrim(p_titulo),
    NULL,
    jsonb_build_object('numero', v_numero, 'prioridad', upper(COALESCE(p_prioridad, 'MEDIA')),
                       'fotos', to_jsonb(COALESCE(p_fotos, '{}'::text[])), 'descripcion', p_descripcion));

  -- Si quien reporta dice que el equipo no funciona, la ficha lo refleja ya.
  IF p_estado_equipo IS NOT NULL AND p_estado_equipo IS DISTINCT FROM v_maq.estado
     AND p_estado_equipo IN ('DANADA','MANTENIMIENTO') THEN
    UPDATE maquinaria SET estado = p_estado_equipo WHERE id = v_maq.id;
  END IF;

  PERFORM mant_sistema(v_id, 'Ticket ' || v_numero || ' creado por ' || COALESCE(v_nombre, 'usuario') || '.');
  PERFORM mant_notificar('MANTENIMIENTO_REPORTADO', v_id);

  RETURN jsonb_build_object('id', v_id, 'numero', v_numero);
END; $$;
GRANT EXECUTE ON FUNCTION public.mant_reportar(UUID, TEXT, TEXT, TEXT, TEXT, estado_maquinaria, TEXT[], DATE, UUID) TO authenticated;

-- Transiciones del ticket -----------------------------------------------------
CREATE OR REPLACE FUNCTION public.mant_transicion(
  p_ticket        UUID,
  p_accion        TEXT,
  p_nota          TEXT DEFAULT NULL,
  p_estado_equipo estado_maquinaria DEFAULT NULL,
  p_diagnostico   TEXT DEFAULT NULL,
  p_solucion      TEXT DEFAULT NULL,
  p_costo         NUMERIC DEFAULT NULL,
  p_asignado      UUID DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid UUID := (SELECT auth.uid());
  v_nombre VARCHAR(200);
  t mantenimiento_tickets%ROWTYPE;
  m maquinaria%ROWTYPE;
  v_accion TEXT := upper(p_accion);
  v_tecnico BOOLEAN := public.auth_permiso_any('{atender_mantenimiento,gestionar_mantenimiento}'::text[]);
  v_jefe    BOOLEAN := public.auth_permiso('gestionar_mantenimiento');
  v_sede    BOOLEAN := public.auth_permiso('reportar_falla_maquinaria');
  v_nuevo   estado_ticket_mant;
  v_texto   TEXT;
  v_equipo  estado_maquinaria;
  v_asig_nombre VARCHAR(200);
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Sesión requerida'; END IF;
  SELECT * INTO t FROM mantenimiento_tickets WHERE id = p_ticket FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ticket no encontrado.'; END IF;
  SELECT * INTO m FROM maquinaria WHERE id = t.maquinaria_id;
  SELECT nombre INTO v_nombre FROM usuarios WHERE id = v_uid;
  PERFORM set_config('app.mant_ticket', t.id::text, true);

  IF t.estado IN ('CERRADO','CANCELADO') THEN
    RAISE EXCEPTION 'El ticket % ya está %.', t.numero, lower(t.estado::text);
  END IF;

  CASE v_accion
  WHEN 'RECIBIR' THEN
    IF NOT v_tecnico THEN RAISE EXCEPTION 'Solo mantenimiento puede recibir tickets.'; END IF;
    IF t.estado <> 'ABIERTO' THEN RAISE EXCEPTION 'El ticket ya fue recibido.'; END IF;
    UPDATE mantenimiento_tickets
       SET estado = 'RECIBIDO', recibido_por = v_uid, recibido_at = NOW(),
           asignado_a = COALESCE(asignado_a, v_uid)
     WHERE id = t.id;
    v_nuevo := 'RECIBIDO';
    v_texto := 'Recibido por ' || COALESCE(v_nombre, 'mantenimiento');

  WHEN 'ASIGNAR' THEN
    IF p_asignado IS NULL THEN RAISE EXCEPTION 'Indica a quién se asigna.'; END IF;
    IF NOT (v_jefe OR (v_tecnico AND p_asignado = v_uid)) THEN
      RAISE EXCEPTION 'Solo el jefe de mantenimiento asigna tickets a otras personas.';
    END IF;
    SELECT nombre INTO v_asig_nombre FROM usuarios WHERE id = p_asignado;
    IF v_asig_nombre IS NULL THEN RAISE EXCEPTION 'Usuario no encontrado.'; END IF;
    UPDATE mantenimiento_tickets
       SET asignado_a = p_asignado,
           estado = CASE WHEN estado = 'ABIERTO' THEN 'RECIBIDO'::estado_ticket_mant ELSE estado END,
           recibido_por = COALESCE(recibido_por, v_uid),
           recibido_at  = COALESCE(recibido_at, NOW())
     WHERE id = t.id;
    v_nuevo := CASE WHEN t.estado = 'ABIERTO' THEN 'RECIBIDO'::estado_ticket_mant ELSE t.estado END;
    v_texto := 'Asignado a ' || v_asig_nombre;

  WHEN 'INICIAR' THEN
    IF NOT v_tecnico THEN RAISE EXCEPTION 'Solo mantenimiento puede iniciar el trabajo.'; END IF;
    IF t.estado NOT IN ('ABIERTO','RECIBIDO','EN_ESPERA') THEN
      RAISE EXCEPTION 'No se puede iniciar un ticket en estado %.', t.estado;
    END IF;
    UPDATE mantenimiento_tickets
       SET estado = 'EN_PROCESO', iniciado_at = COALESCE(iniciado_at, NOW()),
           recibido_por = COALESCE(recibido_por, v_uid), recibido_at = COALESCE(recibido_at, NOW()),
           asignado_a = COALESCE(asignado_a, v_uid),
           diagnostico = COALESCE(NULLIF(btrim(p_diagnostico), ''), diagnostico)
     WHERE id = t.id;
    v_nuevo := 'EN_PROCESO';
    v_texto := CASE WHEN t.estado = 'EN_ESPERA' THEN 'Trabajo reanudado' ELSE 'Trabajo iniciado' END;
    IF m.estado NOT IN ('MANTENIMIENTO','BAJA') THEN
      UPDATE maquinaria SET estado = 'MANTENIMIENTO' WHERE id = m.id;
    END IF;

  WHEN 'ESPERA' THEN
    IF NOT v_tecnico THEN RAISE EXCEPTION 'Solo mantenimiento puede pausar el ticket.'; END IF;
    IF t.estado <> 'EN_PROCESO' THEN RAISE EXCEPTION 'Solo un ticket en proceso pasa a espera.'; END IF;
    IF NULLIF(btrim(p_nota), '') IS NULL THEN RAISE EXCEPTION 'Indica qué se está esperando (repuesto, proveedor…).'; END IF;
    UPDATE mantenimiento_tickets SET estado = 'EN_ESPERA',
           diagnostico = COALESCE(NULLIF(btrim(p_diagnostico), ''), diagnostico)
     WHERE id = t.id;
    v_nuevo := 'EN_ESPERA';
    v_texto := 'En espera';

  WHEN 'RESOLVER' THEN
    IF NOT v_tecnico THEN RAISE EXCEPTION 'Solo mantenimiento puede resolver el ticket.'; END IF;
    IF t.estado NOT IN ('RECIBIDO','EN_PROCESO','EN_ESPERA') THEN
      RAISE EXCEPTION 'No se puede resolver un ticket en estado %.', t.estado;
    END IF;
    IF NULLIF(btrim(p_solucion), '') IS NULL THEN RAISE EXCEPTION 'Describe el trabajo realizado.'; END IF;
    v_equipo := COALESCE(p_estado_equipo, 'OPERATIVA');
    UPDATE mantenimiento_tickets
       SET estado = 'RESUELTO', resuelto_at = NOW(),
           iniciado_at = COALESCE(iniciado_at, NOW()),
           diagnostico = COALESCE(NULLIF(btrim(p_diagnostico), ''), diagnostico),
           solucion = btrim(p_solucion), costo = COALESCE(p_costo, costo),
           estado_equipo_final = v_equipo,
           asignado_a = COALESCE(asignado_a, v_uid)
     WHERE id = t.id;
    v_nuevo := 'RESUELTO';
    v_texto := 'Resuelto: ' || btrim(p_solucion);
    UPDATE maquinaria
       SET estado = CASE WHEN estado = 'BAJA' THEN estado ELSE v_equipo END,
           ultimo_mant_at = NOW(),
           condicion = CASE WHEN v_equipo = 'OPERATIVA' AND condicion = 'MALA' THEN 'REGULAR' ELSE condicion END
     WHERE id = m.id;

  WHEN 'CERRAR' THEN
    IF t.estado <> 'RESUELTO' THEN RAISE EXCEPTION 'Solo se cierra un ticket resuelto.'; END IF;
    IF NOT (v_tecnico OR v_sede OR t.reportado_por = v_uid) THEN
      RAISE EXCEPTION 'No tienes permiso para cerrar este ticket.';
    END IF;
    UPDATE mantenimiento_tickets SET estado = 'CERRADO', cerrado_at = NOW() WHERE id = t.id;
    v_nuevo := 'CERRADO';
    v_texto := 'Cerrado (equipo recibido a satisfacción)';

  WHEN 'REABRIR' THEN
    IF t.estado <> 'RESUELTO' THEN RAISE EXCEPTION 'Solo se reabre un ticket resuelto.'; END IF;
    IF NOT (v_tecnico OR v_sede OR t.reportado_por = v_uid) THEN
      RAISE EXCEPTION 'No tienes permiso para reabrir este ticket.';
    END IF;
    IF NULLIF(btrim(p_nota), '') IS NULL THEN RAISE EXCEPTION 'Explica por qué el equipo sigue con la falla.'; END IF;
    UPDATE mantenimiento_tickets SET estado = 'EN_PROCESO', resuelto_at = NULL WHERE id = t.id;
    v_nuevo := 'EN_PROCESO';
    v_texto := 'Reabierto';
    UPDATE maquinaria SET estado = COALESCE(p_estado_equipo, 'DANADA')
     WHERE id = m.id AND estado <> 'BAJA';

  WHEN 'CANCELAR' THEN
    IF NOT (v_jefe OR (t.reportado_por = v_uid AND t.estado = 'ABIERTO')) THEN
      RAISE EXCEPTION 'Solo el jefe de mantenimiento (o quien reportó, si nadie lo ha recibido) puede cancelar.';
    END IF;
    IF t.estado = 'RESUELTO' THEN RAISE EXCEPTION 'Un ticket resuelto se cierra o se reabre, no se cancela.'; END IF;
    IF NULLIF(btrim(p_nota), '') IS NULL THEN RAISE EXCEPTION 'Indica el motivo de la cancelación.'; END IF;
    UPDATE mantenimiento_tickets SET estado = 'CANCELADO', cerrado_at = NOW() WHERE id = t.id;
    v_nuevo := 'CANCELADO';
    v_texto := 'Cancelado';
    -- Si el equipo estaba en taller por este ticket y no hay otro abierto, vuelve a operar.
    IF m.estado = 'MANTENIMIENTO' AND NOT EXISTS (
         SELECT 1 FROM mantenimiento_tickets
          WHERE maquinaria_id = m.id AND id <> t.id
            AND estado IN ('RECIBIDO','EN_PROCESO','EN_ESPERA')) THEN
      UPDATE maquinaria SET estado = 'OPERATIVA' WHERE id = m.id;
    END IF;

  ELSE
    RAISE EXCEPTION 'Acción desconocida: %', p_accion;
  END CASE;

  IF NULLIF(btrim(p_nota), '') IS NOT NULL THEN
    v_texto := v_texto || ' — ' || btrim(p_nota);
  END IF;

  PERFORM maq_evento(m.id, 'MANTENIMIENTO', NULL, NULL, NULL,
    t.numero || ' · ' || v_texto, NULL,
    jsonb_build_object('numero', t.numero, 'accion', v_accion,
                       'estado_ticket_anterior', t.estado, 'estado_ticket', v_nuevo,
                       'costo', p_costo));
  PERFORM mant_sistema(t.id, v_texto || '.');
  PERFORM mant_notificar('MANTENIMIENTO_ESTADO', t.id, jsonb_build_object('accion', v_accion, 'detalle', v_texto));
END; $$;
GRANT EXECUTE ON FUNCTION public.mant_transicion(UUID, TEXT, TEXT, estado_maquinaria, TEXT, TEXT, NUMERIC, UUID) TO authenticated;

-- Registrar actividad sobre el equipo -----------------------------------------
CREATE OR REPLACE FUNCTION public.mant_registrar_actividad(
  p_maquinaria  UUID,
  p_tipo        TEXT,
  p_resultado   TEXT DEFAULT 'OK',
  p_descripcion TEXT DEFAULT NULL,
  p_checklist   JSONB DEFAULT '[]',
  p_fotos       TEXT[] DEFAULT '{}',
  p_condicion   TEXT DEFAULT NULL,
  p_ticket      UUID DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid UUID := (SELECT auth.uid());
  v_nombre VARCHAR(200);
  v_maq maquinaria%ROWTYPE;
  v_id UUID;
  v_res TEXT := upper(COALESCE(p_resultado, 'OK'));
  v_cond TEXT := NULLIF(upper(p_condicion), '');
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Sesión requerida'; END IF;
  IF NOT public.auth_permiso_any('{reportar_falla_maquinaria,atender_mantenimiento,gestionar_mantenimiento}'::text[]) THEN
    RAISE EXCEPTION 'No tienes permiso para registrar actividades sobre equipos.';
  END IF;
  SELECT * INTO v_maq FROM maquinaria WHERE id = p_maquinaria;
  IF NOT FOUND THEN RAISE EXCEPTION 'Equipo no encontrado.'; END IF;
  IF p_ticket IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM mantenimiento_tickets WHERE id = p_ticket AND maquinaria_id = p_maquinaria) THEN
    RAISE EXCEPTION 'El ticket no corresponde a este equipo.';
  END IF;
  SELECT nombre INTO v_nombre FROM usuarios WHERE id = v_uid;

  INSERT INTO mantenimiento_actividades (maquinaria_id, ticket_id, sede_id, tipo, resultado, descripcion,
                                         checklist, condicion, fotos, usuario_id, usuario_nombre)
  VALUES (v_maq.id, p_ticket, v_maq.ubicacion_sede_id, upper(p_tipo), v_res, NULLIF(btrim(p_descripcion), ''),
          COALESCE(p_checklist, '[]'), v_cond, COALESCE(p_fotos, '{}'), v_uid, v_nombre)
  RETURNING id INTO v_id;

  -- Siempre se fija (vacío si no hay ticket) para no heredar el de otra llamada
  -- en la misma transacción.
  PERFORM set_config('app.mant_ticket', COALESCE(p_ticket::text, ''), true);
  PERFORM maq_evento(v_maq.id, 'ACTIVIDAD', NULL, NULL, NULL,
    CASE upper(p_tipo)
      WHEN 'INSPECCION' THEN 'Inspección' WHEN 'USO' THEN 'Uso' WHEN 'LIMPIEZA' THEN 'Limpieza'
      WHEN 'LUBRICACION' THEN 'Lubricación' WHEN 'REVISION' THEN 'Revisión' WHEN 'REPARACION' THEN 'Reparación'
      WHEN 'PRUEBA' THEN 'Prueba' ELSE 'Actividad' END
      || CASE WHEN v_res = 'NOVEDAD' THEN ' con novedad' ELSE ' sin novedad' END
      || COALESCE(': ' || NULLIF(btrim(p_descripcion), ''), ''),
    NULL,
    jsonb_build_object('actividad_id', v_id, 'resultado', v_res, 'condicion', v_cond,
                       'checklist', COALESCE(p_checklist, '[]'), 'fotos', to_jsonb(COALESCE(p_fotos, '{}'::text[]))));

  IF v_cond IS NOT NULL AND v_cond IS DISTINCT FROM v_maq.condicion THEN
    UPDATE maquinaria SET condicion = v_cond WHERE id = v_maq.id;
    PERFORM maq_evento(v_maq.id, 'CONDICION', NULL, NULL, NULL,
      'Condición: ' || v_maq.condicion || ' → ' || v_cond, NULL, NULL);
  END IF;

  RETURN v_id;
END; $$;
GRANT EXECUTE ON FUNCTION public.mant_registrar_actividad(UUID, TEXT, TEXT, TEXT, JSONB, TEXT[], TEXT, UUID) TO authenticated;

-- Definir el estado del equipo (técnico, sin permiso de editar la ficha) -------
CREATE OR REPLACE FUNCTION public.mant_definir_estado_equipo(
  p_maquinaria UUID, p_estado estado_maquinaria, p_condicion TEXT DEFAULT NULL, p_nota TEXT DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_maq maquinaria%ROWTYPE; v_cond TEXT := NULLIF(upper(p_condicion), '');
BEGIN
  IF NOT public.auth_permiso_any('{atender_mantenimiento,gestionar_mantenimiento,gestionar_maquinaria}'::text[]) THEN
    RAISE EXCEPTION 'No tienes permiso para definir el estado del equipo.';
  END IF;
  SELECT * INTO v_maq FROM maquinaria WHERE id = p_maquinaria FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Equipo no encontrado.'; END IF;
  PERFORM set_config('app.mant_ticket', '', true);

  UPDATE maquinaria SET estado = p_estado, condicion = COALESCE(v_cond, condicion) WHERE id = v_maq.id;
  IF v_cond IS NOT NULL AND v_cond IS DISTINCT FROM v_maq.condicion THEN
    PERFORM maq_evento(v_maq.id, 'CONDICION', NULL, NULL, NULL,
      'Condición: ' || v_maq.condicion || ' → ' || v_cond || COALESCE(' — ' || NULLIF(btrim(p_nota), ''), ''), NULL, NULL);
  ELSIF NULLIF(btrim(p_nota), '') IS NOT NULL THEN
    PERFORM maq_evento(v_maq.id, 'COMENTARIO', NULL, NULL, NULL, btrim(p_nota), NULL, NULL);
  END IF;
END; $$;
GRANT EXECUTE ON FUNCTION public.mant_definir_estado_equipo(UUID, estado_maquinaria, TEXT, TEXT) TO authenticated;

-- Generar preventivos que vencen en los próximos N días -----------------------
CREATE OR REPLACE FUNCTION public.mant_generar_preventivos(p_dias INTEGER DEFAULT 7)
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r RECORD; n INTEGER := 0;
BEGIN
  IF NOT public.auth_permiso('gestionar_mantenimiento') THEN
    RAISE EXCEPTION 'No tienes permiso para programar preventivos.';
  END IF;
  FOR r IN
    SELECT m.id, m.codigo, m.proximo_mant
      FROM maquinaria m
     WHERE m.activo AND m.estado <> 'BAJA'
       AND m.proximo_mant IS NOT NULL
       AND m.proximo_mant <= CURRENT_DATE + GREATEST(COALESCE(p_dias, 7), 0)
       AND NOT EXISTS (SELECT 1 FROM mantenimiento_tickets t
                        WHERE t.maquinaria_id = m.id AND t.tipo = 'PREVENTIVO'
                          AND t.estado NOT IN ('CERRADO','CANCELADO'))
  LOOP
    PERFORM public.mant_reportar(r.id, 'PREVENTIVO', 'MEDIA',
      'Mantenimiento preventivo ' || r.codigo, 'Generado por el plan preventivo del equipo.',
      NULL, '{}', r.proximo_mant, NULL);
    n := n + 1;
  END LOOP;
  RETURN n;
END; $$;
GRANT EXECUTE ON FUNCTION public.mant_generar_preventivos(INTEGER) TO authenticated;

-- ── 7) RLS ──────────────────────────────────────────────────────────────────
ALTER TABLE mantenimiento_tickets     ENABLE ROW LEVEL SECURITY;
ALTER TABLE mantenimiento_mensajes    ENABLE ROW LEVEL SECURITY;
ALTER TABLE mantenimiento_actividades ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS mant_tickets_read ON mantenimiento_tickets;
CREATE POLICY mant_tickets_read ON mantenimiento_tickets FOR SELECT TO authenticated
  USING ((SELECT public.mant_puede_participar()));

DROP POLICY IF EXISTS mant_mensajes_read ON mantenimiento_mensajes;
CREATE POLICY mant_mensajes_read ON mantenimiento_mensajes FOR SELECT TO authenticated
  USING ((SELECT public.mant_puede_participar()));

DROP POLICY IF EXISTS mant_mensajes_insert ON mantenimiento_mensajes;
CREATE POLICY mant_mensajes_insert ON mantenimiento_mensajes FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT public.mant_puede_participar())
    AND tipo IN ('MENSAJE','ADJUNTO')
    AND EXISTS (SELECT 1 FROM mantenimiento_tickets t
                 WHERE t.id = ticket_id AND t.estado NOT IN ('CERRADO','CANCELADO'))
  );

DROP POLICY IF EXISTS mant_act_read ON mantenimiento_actividades;
CREATE POLICY mant_act_read ON mantenimiento_actividades FOR SELECT TO authenticated
  USING ((SELECT public.auth_permiso_any('{ver_maquinaria,ver_mantenimiento,reportar_falla_maquinaria,atender_mantenimiento,gestionar_mantenimiento}'::text[])));

-- ── 8) Realtime para el chat y el tablero ───────────────────────────────────
ALTER TABLE mantenimiento_mensajes REPLICA IDENTITY FULL;
ALTER TABLE mantenimiento_tickets  REPLICA IDENTITY FULL;
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE mantenimiento_mensajes;
EXCEPTION WHEN duplicate_object THEN null; WHEN undefined_object THEN null; END $$;
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE mantenimiento_tickets;
EXCEPTION WHEN duplicate_object THEN null; WHEN undefined_object THEN null; END $$;

-- ── 9) Storage: fotos de reportes y adjuntos del chat (privado) ──────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('mantenimiento', 'mantenimiento', false, 26214400)
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = EXCLUDED.file_size_limit;

DROP POLICY IF EXISTS mantenimiento_select_perm ON storage.objects;
DROP POLICY IF EXISTS mantenimiento_insert_perm ON storage.objects;
DROP POLICY IF EXISTS mantenimiento_update_perm ON storage.objects;
DROP POLICY IF EXISTS mantenimiento_delete_perm ON storage.objects;
CREATE POLICY mantenimiento_select_perm ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'mantenimiento' AND (SELECT public.mant_puede_participar()));
CREATE POLICY mantenimiento_insert_perm ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'mantenimiento'
              AND public.auth_permiso_any('{reportar_falla_maquinaria,atender_mantenimiento,gestionar_mantenimiento}'::text[]));
CREATE POLICY mantenimiento_update_perm ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'mantenimiento' AND public.auth_permiso('gestionar_mantenimiento'))
  WITH CHECK (bucket_id = 'mantenimiento' AND public.auth_permiso('gestionar_mantenimiento'));
CREATE POLICY mantenimiento_delete_perm ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'mantenimiento' AND public.auth_permiso('gestionar_mantenimiento'));

-- ── 10) Eventos para el motor de notificaciones ─────────────────────────────
INSERT INTO eventos_notificacion (codigo, nombre, descripcion, modulo, variables) VALUES
  ('MANTENIMIENTO_REPORTADO', 'Falla de equipo reportada',
   'Se reportó una falla o se programó un mantenimiento sobre una máquina.', 'Mantenimiento',
   '[{"clave":"numero","descripcion":"Número del ticket (MT-…)"},{"clave":"titulo","descripcion":"Resumen de la falla"},{"clave":"prioridad","descripcion":"BAJA / MEDIA / ALTA / CRITICA"},{"clave":"tipo","descripcion":"CORRECTIVO / PREVENTIVO / INSPECCION / SOPORTE_REMOTO"},{"clave":"equipo_codigo","descripcion":"Código del equipo"},{"clave":"equipo_nombre","descripcion":"Nombre del equipo"},{"clave":"sede","descripcion":"Sede donde está el equipo"},{"clave":"reportado_por","descripcion":"Quién reportó"},{"clave":"enlace","descripcion":"Ruta del ticket"}]'),
  ('MANTENIMIENTO_ESTADO', 'Cambio en ticket de mantenimiento',
   'Un ticket de mantenimiento fue recibido, asignado, iniciado, resuelto, cerrado, reabierto o cancelado.', 'Mantenimiento',
   '[{"clave":"numero","descripcion":"Número del ticket"},{"clave":"accion","descripcion":"RECIBIR / ASIGNAR / INICIAR / ESPERA / RESOLVER / CERRAR / REABRIR / CANCELAR"},{"clave":"estado","descripcion":"Estado nuevo del ticket"},{"clave":"detalle","descripcion":"Texto del cambio"},{"clave":"asignado_a","descripcion":"Técnico asignado"},{"clave":"equipo_codigo","descripcion":"Código del equipo"},{"clave":"sede","descripcion":"Sede"},{"clave":"enlace","descripcion":"Ruta del ticket"}]')
ON CONFLICT (codigo) DO NOTHING;

-- ── 11) Roles y permisos ────────────────────────────────────────────────────
INSERT INTO public.roles (nombre, descripcion, permisos, activo, rol_base) VALUES
  ('Técnico de Mantenimiento',
   'Recibe y atiende los reportes de falla de maquinaria, da soporte remoto por chat y deja la trazabilidad del equipo.',
   '{
     "ver_maquinaria": true, "ver_mantenimiento": true, "atender_mantenimiento": true,
     "reportar_falla_maquinaria": true, "ver_notificaciones": true
   }'::jsonb, true, 'OPERADOR_SEDE'),
  ('Jefe de Mantenimiento',
   'Coordina el área de mantenimiento: asigna tickets, programa preventivos y administra la hoja de vida de los equipos.',
   '{
     "ver_maquinaria": true, "gestionar_maquinaria": true, "ver_mantenimiento": true,
     "atender_mantenimiento": true, "gestionar_mantenimiento": true,
     "reportar_falla_maquinaria": true, "ver_notificaciones": true,
     "ver_reportes": true
   }'::jsonb, true, 'SUPERVISOR')
ON CONFLICT (nombre) DO NOTHING;

-- Personal de sede: reporta sobre los equipos que tiene a cargo.
UPDATE public.roles SET permisos = permisos || '{
  "ver_maquinaria": true, "reportar_falla_maquinaria": true
}'::jsonb WHERE nombre IN ('Conserje', 'Operador de Sede', 'Bodeguero');

-- Supervisión: además sigue los tickets de sus sedes.
UPDATE public.roles SET permisos = permisos || '{
  "ver_maquinaria": true, "reportar_falla_maquinaria": true, "ver_mantenimiento": true
}'::jsonb WHERE nombre IN ('Supervisor de Conserjería', 'Coordinador');

UPDATE public.roles SET permisos = permisos || '{"ver_mantenimiento": true}'::jsonb
WHERE nombre = 'Auditor';

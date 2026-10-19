-- =============================================================================
-- MÓDULO: PQRS (Peticiones, Quejas, Reclamos, Sugerencias y Felicitaciones)
-- =============================================================================
-- Una PQRS es algo que un residente, una administración, una empresa usuaria o
-- un colaborador pide, reclama o sugiere SOBRE UNA SEDE, y que la empresa tiene
-- que responder antes de una fecha.
--
-- Flujo: RADICADA → EN_TRAMITE ⇄ EN_ESPERA → RESPONDIDA → CERRADA (o ANULADA).
--   RESPONDIDA = ya se le contestó a quien radicó; queda esperando conformidad.
--   CERRADA    = conforme / sin más trámite.
--   ANULADA    = se radicó por error.
-- Cada cambio exige comentario en los pasos finales y queda como mensaje de
-- SISTEMA en `pqrs_bitacora`, que nadie puede editar ni borrar.
--
-- Alcance por rol, con los permisos YA sembrados en /roles (lib/permisos.ts):
--   ver_pqrs        entra al módulo y ve el listado.
--   gestionar_pqrs  radica, comenta y adjunta.
-- El ALCANCE lo da el `rol_base` del rol (mismo mecanismo que el resto de la
-- RLS), porque Conserje y Coordinador comparten las dos claves:
--   OPERADOR_SEDE (Conserje)             → solo las PQRS de SU sede; no asigna
--                                          responsable, no mueve el plazo, no cierra.
--   SUPERVISOR (Coordinador) y ADMIN     → todas las sedes; asignan responsable,
--   (Gerencia) / SUPER_ADMIN               cambian prioridad y plazo, responden y cierran.
--   ver_panel_gerencia                   → además, los indicadores del listado (solo UI).
--
-- Plazos: días HÁBILES por tipo en `pqrs_plazos` (parametrizable) y editables
-- caso a caso. `pqrs_sumar_habiles()` salta sábados, domingos y las fechas que
-- haya en `pqrs_dias_no_habiles` — OJO: esa tabla nace VACÍA, así que hasta que
-- se carguen los festivos el plazo solo descuenta fines de semana.
--
-- Escrituras SOLO por RPC (`pqrs_radicar`, `pqrs_cambiar_estado`); de la
-- bitácora sí se insertan mensajes directamente, como en Soporte.
--
-- IDEMPOTENTE.
-- =============================================================================

SET search_path TO public;

-- ── Parametrización: plazo de respuesta por tipo ────────────────────────────
CREATE TABLE IF NOT EXISTS pqrs_plazos (
  tipo          VARCHAR(14) PRIMARY KEY
                CHECK (tipo IN ('PETICION','QUEJA','RECLAMO','SUGERENCIA','FELICITACION')),
  dias_habiles  INT NOT NULL CHECK (dias_habiles BETWEEN 1 AND 180),
  descripcion   VARCHAR(200),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO pqrs_plazos (tipo, dias_habiles, descripcion) VALUES
  ('PETICION',     15, 'Petición de un servicio, una gestión o información.'),
  ('QUEJA',        15, 'Inconformidad con la atención o el comportamiento del servicio.'),
  ('RECLAMO',      15, 'Exigencia por un incumplimiento o un daño.'),
  ('SUGERENCIA',   30, 'Propuesta para mejorar el servicio.'),
  ('FELICITACION', 30, 'Reconocimiento al servicio o a quien lo prestó.')
ON CONFLICT (tipo) DO NOTHING;

-- Festivos y demás días que NO cuentan para el plazo. Nace vacía a propósito:
-- cargar aquí los festivos del año alarga automáticamente las fechas límite que
-- se calculen DESPUÉS (las ya radicadas conservan la suya).
CREATE TABLE IF NOT EXISTS pqrs_dias_no_habiles (
  fecha  DATE PRIMARY KEY,
  nombre VARCHAR(120)
);

CREATE OR REPLACE FUNCTION public.pqrs_sumar_habiles(p_desde DATE, p_dias INT)
RETURNS DATE LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE
  v_fecha  DATE := p_desde;
  v_quedan INT  := GREATEST(COALESCE(p_dias, 0), 0);
  v_tope   INT  := 0;
BEGIN
  WHILE v_quedan > 0 AND v_tope < 1000 LOOP
    v_fecha := v_fecha + 1;
    v_tope  := v_tope + 1;
    -- 1..5 = lunes a viernes (ISO).
    IF EXTRACT(ISODOW FROM v_fecha) <= 5
       AND NOT EXISTS (SELECT 1 FROM pqrs_dias_no_habiles d WHERE d.fecha = v_fecha) THEN
      v_quedan := v_quedan - 1;
    END IF;
  END LOOP;
  RETURN v_fecha;
END; $$;
COMMENT ON FUNCTION public.pqrs_sumar_habiles(DATE, INT) IS
  'Suma días hábiles saltando fines de semana y las fechas de pqrs_dias_no_habiles.';
GRANT EXECUTE ON FUNCTION public.pqrs_sumar_habiles(DATE, INT) TO authenticated;

-- ── La PQRS ─────────────────────────────────────────────────────────────────
CREATE SEQUENCE IF NOT EXISTS pqrs_numero_seq;

CREATE TABLE IF NOT EXISTS pqrs (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  numero               VARCHAR(30) NOT NULL UNIQUE,            -- PQ-00001
  tipo                 VARCHAR(14) NOT NULL
                       CHECK (tipo IN ('PETICION','QUEJA','RECLAMO','SUGERENCIA','FELICITACION')),
  canal                VARCHAR(10) NOT NULL DEFAULT 'SEDE'     -- por dónde llegó
                       CHECK (canal IN ('SEDE','TELEFONO','CORREO','WHATSAPP','PORTAL','OTRO')),
  estado               VARCHAR(12) NOT NULL DEFAULT 'RADICADA'
                       CHECK (estado IN ('RADICADA','EN_TRAMITE','EN_ESPERA','RESPONDIDA','CERRADA','ANULADA')),
  prioridad            VARCHAR(10) NOT NULL DEFAULT 'MEDIA'
                       CHECK (prioridad IN ('BAJA','MEDIA','ALTA','CRITICA')),

  -- Quién radica (puede ser anónima: entonces no se pide identificación)
  anonima              BOOLEAN NOT NULL DEFAULT false,
  solicitante_nombre   VARCHAR(200),
  solicitante_calidad  VARCHAR(16) NOT NULL DEFAULT 'RESIDENTE'
                       CHECK (solicitante_calidad IN ('RESIDENTE','PROPIETARIO','ADMINISTRACION',
                                                      'EMPRESA_USUARIA','COLABORADOR','PROVEEDOR','OTRO')),
  solicitante_doc      VARCHAR(30),
  solicitante_telefono VARCHAR(30),
  solicitante_email    VARCHAR(160),

  -- Dónde y sobre quién
  sede_id              UUID NOT NULL REFERENCES sedes(id) ON DELETE RESTRICT,
  sede_nombre          VARCHAR(400),   -- desnormalizado: listados, filtros y Excel
  grupo_id             UUID REFERENCES grupos_contrato(id),  -- grupo de contrato de la sede
  persona_id           UUID REFERENCES personas(id) ON DELETE SET NULL,  -- colaborador involucrado
  persona_nombre       VARCHAR(250),   -- desnormalizado: el Conserje no tiene `ver_personas`

  asunto               VARCHAR(200) NOT NULL,
  descripcion          TEXT NOT NULL,

  responsable_id       UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  responsable_nombre   VARCHAR(200),

  dias_plazo           INT  NOT NULL CHECK (dias_plazo BETWEEN 1 AND 180),
  fecha_limite         DATE NOT NULL,

  respuesta            TEXT,
  respondida_at        TIMESTAMPTZ,
  respondida_por       UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  respondida_nombre    VARCHAR(200),
  cerrada_at           TIMESTAMPTZ,

  radicada_por         UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  radicada_nombre      VARCHAR(200),
  ultimo_mensaje_at    TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Si no es anónima hay que saber a quién se le responde.
  CONSTRAINT pqrs_identifica_solicitante
    CHECK (anonima OR NULLIF(btrim(solicitante_nombre), '') IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_pqrs_estado      ON pqrs(estado, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pqrs_sede        ON pqrs(sede_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pqrs_grupo       ON pqrs(grupo_id);
CREATE INDEX IF NOT EXISTS idx_pqrs_responsable ON pqrs(responsable_id) WHERE responsable_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pqrs_radicada    ON pqrs(radicada_por, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pqrs_persona     ON pqrs(persona_id) WHERE persona_id IS NOT NULL;
-- Lo que de verdad se consulta: lo abierto que está por vencerse.
CREATE INDEX IF NOT EXISTS idx_pqrs_vence       ON pqrs(fecha_limite)
  WHERE estado IN ('RADICADA','EN_TRAMITE','EN_ESPERA');

DROP TRIGGER IF EXISTS tr_pqrs_upd ON pqrs;
CREATE TRIGGER tr_pqrs_upd BEFORE UPDATE ON pqrs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Nombres desnormalizados: la RLS de `usuarios` solo deja leer el registro
-- propio, y quien radicó tiene que ver quién le responde.
CREATE OR REPLACE FUNCTION public.tr_pqrs_denormalizar()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.sede_id IS DISTINCT FROM OLD.sede_id THEN
    SELECT s.nombre, s.grupo_id INTO NEW.sede_nombre, NEW.grupo_id
      FROM sedes s WHERE s.id = NEW.sede_id;
  END IF;
  IF TG_OP = 'INSERT' OR NEW.responsable_id IS DISTINCT FROM OLD.responsable_id THEN
    NEW.responsable_nombre := (SELECT nombre FROM usuarios WHERE id = NEW.responsable_id);
  END IF;
  IF TG_OP = 'INSERT' OR NEW.respondida_por IS DISTINCT FROM OLD.respondida_por THEN
    NEW.respondida_nombre := (SELECT nombre FROM usuarios WHERE id = NEW.respondida_por);
  END IF;
  IF TG_OP = 'INSERT' OR NEW.persona_id IS DISTINCT FROM OLD.persona_id THEN
    NEW.persona_nombre := (SELECT left(apellidos || ' ' || nombres, 250) FROM personas WHERE id = NEW.persona_id);
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS tr_pqrs_denormalizar ON pqrs;
CREATE TRIGGER tr_pqrs_denormalizar BEFORE INSERT OR UPDATE ON pqrs
  FOR EACH ROW EXECUTE FUNCTION public.tr_pqrs_denormalizar();

-- ── Bitácora / seguimiento (chat + trazabilidad) ────────────────────────────
CREATE TABLE IF NOT EXISTS pqrs_bitacora (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pqrs_id         UUID NOT NULL REFERENCES pqrs(id) ON DELETE CASCADE,
  usuario_id      UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  usuario_nombre  VARCHAR(200),
  tipo            VARCHAR(10) NOT NULL DEFAULT 'MENSAJE' CHECK (tipo IN ('MENSAJE','ADJUNTO','SISTEMA')),
  mensaje         TEXT,
  estado_anterior VARCHAR(12),
  estado_nuevo    VARCHAR(12),
  adjunto_path    TEXT,
  adjunto_nombre  VARCHAR(255),
  adjunto_mime    VARCHAR(120),
  adjunto_bytes   BIGINT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT pqrs_bitacora_contenido
    CHECK (NULLIF(btrim(mensaje), '') IS NOT NULL OR adjunto_path IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_pqrs_bitacora_pqrs    ON pqrs_bitacora(pqrs_id, created_at);
CREATE INDEX IF NOT EXISTS idx_pqrs_bitacora_usuario ON pqrs_bitacora(usuario_id);

-- El autor lo pone la base de datos, no el cliente.
CREATE OR REPLACE FUNCTION public.tr_pqrs_bitacora_autor()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  NEW.usuario_id := COALESCE((SELECT auth.uid()), NEW.usuario_id);
  IF NEW.usuario_id IS NOT NULL THEN
    SELECT nombre INTO NEW.usuario_nombre FROM usuarios WHERE id = NEW.usuario_id;
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS tr_pqrs_bitacora_autor ON pqrs_bitacora;
CREATE TRIGGER tr_pqrs_bitacora_autor BEFORE INSERT ON pqrs_bitacora
  FOR EACH ROW EXECUTE FUNCTION public.tr_pqrs_bitacora_autor();

CREATE OR REPLACE FUNCTION public.tr_pqrs_bitacora_ultimo()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.tipo <> 'SISTEMA' THEN
    UPDATE pqrs SET ultimo_mensaje_at = NEW.created_at WHERE id = NEW.pqrs_id;
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS tr_pqrs_bitacora_ultimo ON pqrs_bitacora;
CREATE TRIGGER tr_pqrs_bitacora_ultimo AFTER INSERT ON pqrs_bitacora
  FOR EACH ROW EXECUTE FUNCTION public.tr_pqrs_bitacora_ultimo();

-- ── Quién ve y quién puede qué ──────────────────────────────────────────────
-- `usuarios.rol` lo mantiene sincronizado con `roles.rol_base` el trigger de
-- 20240105000000_roles_dinamicos.sql, así que es el alcance "de base de datos".
CREATE OR REPLACE FUNCTION public.pqrs_mi_rol()
RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT rol::text FROM usuarios WHERE id = (SELECT auth.uid())
$$;
GRANT EXECUTE ON FUNCTION public.pqrs_mi_rol() TO authenticated;

CREATE OR REPLACE FUNCTION public.pqrs_mi_sede()
RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT sede_id FROM usuarios WHERE id = (SELECT auth.uid())
$$;
GRANT EXECUTE ON FUNCTION public.pqrs_mi_sede() TO authenticated;

/** Entra al módulo. */
CREATE OR REPLACE FUNCTION public.pqrs_acceso()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.auth_permiso_any('{ver_pqrs,gestionar_pqrs}'::text[])
$$;
GRANT EXECUTE ON FUNCTION public.pqrs_acceso() TO authenticated;

/** Ve todas las sedes. El personal de sede (OPERADOR_SEDE) solo ve la suya. */
CREATE OR REPLACE FUNCTION public.pqrs_ve_todo()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.pqrs_acceso() AND COALESCE(public.pqrs_mi_rol(), '') <> 'OPERADOR_SEDE'
$$;
GRANT EXECUTE ON FUNCTION public.pqrs_ve_todo() TO authenticated;

/** Coordinación: asigna responsable, mueve prioridad y plazo, responde y cierra. */
CREATE OR REPLACE FUNCTION public.pqrs_coordina()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.auth_permiso('gestionar_pqrs')
     AND COALESCE(public.pqrs_mi_rol(), '') IN ('SUPER_ADMIN','ADMIN','SUPERVISOR')
$$;
GRANT EXECUTE ON FUNCTION public.pqrs_coordina() TO authenticated;

/** ¿Puede ver esta sede? (para radicar y para el listado) */
CREATE OR REPLACE FUNCTION public.pqrs_ve_sede(p_sede UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.pqrs_ve_todo()
      OR (public.pqrs_acceso() AND p_sede IS NOT NULL AND p_sede = public.pqrs_mi_sede())
$$;
GRANT EXECUTE ON FUNCTION public.pqrs_ve_sede(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.pqrs_puede_ver(p_pqrs UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM pqrs p
     WHERE p.id = p_pqrs
       AND (public.pqrs_ve_sede(p.sede_id)
            OR p.radicada_por = (SELECT auth.uid())
            OR p.responsable_id = (SELECT auth.uid()))
  )
$$;
GRANT EXECUTE ON FUNCTION public.pqrs_puede_ver(UUID) TO authenticated;

/** Usuarios a los que se les puede asignar una PQRS. */
CREATE OR REPLACE FUNCTION public.pqrs_gestores()
RETURNS TABLE (id UUID, nombre VARCHAR, rol_nombre VARCHAR)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT u.id, u.nombre, r.nombre
    FROM usuarios u LEFT JOIN roles r ON r.id = u.rol_id
   WHERE public.pqrs_coordina()
     AND COALESCE(u.activo, true)
     AND (u.rol IN ('SUPER_ADMIN','ADMIN')
       OR COALESCE(u.permisos ->> 'gestionar_pqrs', r.permisos ->> 'gestionar_pqrs') = 'true')
   ORDER BY u.nombre
$$;
GRANT EXECUTE ON FUNCTION public.pqrs_gestores() TO authenticated;

/** Sedes que el usuario puede elegir al radicar. */
CREATE OR REPLACE FUNCTION public.pqrs_sedes()
RETURNS TABLE (id UUID, nombre VARCHAR, codigo_interno VARCHAR, zona VARCHAR, ciudad VARCHAR)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT s.id, s.nombre, s.codigo_interno, s.zona, s.ciudad
    FROM sedes s
   WHERE COALESCE(s.activo, true)
     AND public.pqrs_ve_sede(s.id)
   ORDER BY s.nombre, s.id
$$;
GRANT EXECUTE ON FUNCTION public.pqrs_sedes() TO authenticated;

/**
 * Colaboradores activos de una sede, para el campo "colaborador involucrado".
 * Va por RPC porque el Conserje NO tiene `ver_personas`: así elige de la planta
 * de SU sede sin que se le abra el resto de la nómina.
 */
CREATE OR REPLACE FUNCTION public.pqrs_personas_sede(p_sede UUID, p_busqueda TEXT DEFAULT NULL)
RETURNS TABLE (id UUID, nombre TEXT, cargo VARCHAR)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT pe.id, (pe.apellidos || ' ' || pe.nombres)::text, pe.cargo
    FROM personas pe
   WHERE public.pqrs_ve_sede(p_sede)
     AND pe.sede_id = p_sede
     AND pe.estado = 'ACTIVO'
     AND (NULLIF(btrim(p_busqueda), '') IS NULL
          OR pe.nombres   ILIKE '%' || btrim(p_busqueda) || '%'
          OR pe.apellidos ILIKE '%' || btrim(p_busqueda) || '%'
          OR pe.documento ILIKE btrim(p_busqueda) || '%')
   ORDER BY pe.apellidos, pe.nombres, pe.id
   LIMIT 200
$$;
GRANT EXECUTE ON FUNCTION public.pqrs_personas_sede(UUID, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.pqrs_notificar(p_codigo TEXT, p_pqrs UUID, p_extra JSONB DEFAULT '{}')
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v JSONB;
BEGIN
  SELECT jsonb_build_object(
           'pqrs_id', p.id, 'numero', p.numero, 'tipo', p.tipo, 'canal', p.canal,
           'estado', p.estado, 'prioridad', p.prioridad, 'asunto', p.asunto,
           'sede', p.sede_nombre, 'fecha_limite', p.fecha_limite,
           -- Una PQRS anónima no revela quién la puso, ni en el correo.
           'solicitante', CASE WHEN p.anonima THEN 'Anónima' ELSE p.solicitante_nombre END,
           'responsable', p.responsable_nombre, 'radicada_por', p.radicada_nombre,
           'enlace', '/pqrs/' || p.id)
         || COALESCE(p_extra, '{}')
    INTO v FROM pqrs p WHERE p.id = p_pqrs;
  PERFORM public.emitir_evento(p_codigo, v, 'Pqrs', p_pqrs::text);
EXCEPTION WHEN OTHERS THEN
  -- Notificar nunca debe tumbar la operación principal.
  RAISE WARNING 'pqrs_notificar(%): %', p_codigo, SQLERRM;
END; $$;
REVOKE ALL ON FUNCTION public.pqrs_notificar(TEXT, UUID, JSONB) FROM PUBLIC;

-- ── Radicar ─────────────────────────────────────────────────────────────────
-- `p_id` lo genera el cliente para poder subir la evidencia ANTES, a `pqrs/{id}/…`.
CREATE OR REPLACE FUNCTION public.pqrs_radicar(
  p_id          UUID,
  p_tipo        TEXT,
  p_canal       TEXT,
  p_sede        UUID,
  p_asunto      TEXT,
  p_descripcion TEXT,
  p_anonima     BOOLEAN DEFAULT false,
  p_solicitante JSONB   DEFAULT '{}',  -- {nombre, calidad, documento, telefono, email}
  p_persona     UUID    DEFAULT NULL,  -- colaborador involucrado
  p_prioridad   TEXT    DEFAULT 'MEDIA',
  p_dias_plazo  INT     DEFAULT NULL,  -- NULL = el de pqrs_plazos para el tipo
  p_adjuntos    JSONB   DEFAULT '[]'   -- [{path, nombre, mime, bytes}]
) RETURNS pqrs
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid     UUID := (SELECT auth.uid());
  v_nombre  VARCHAR(200);
  v_tipo    TEXT := upper(COALESCE(p_tipo, ''));
  v_canal   TEXT := upper(COALESCE(p_canal, 'SEDE'));
  v_prio    TEXT := upper(COALESCE(p_prioridad, 'MEDIA'));
  v_dias    INT;
  v_calidad TEXT := upper(COALESCE(NULLIF(btrim(p_solicitante ->> 'calidad'), ''), 'RESIDENTE'));
  v_sol_nom TEXT := NULLIF(btrim(p_solicitante ->> 'nombre'), '');
  p_row     pqrs;
  a         JSONB;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Debes iniciar sesión.'; END IF;
  IF NOT public.auth_permiso('gestionar_pqrs') THEN
    RAISE EXCEPTION 'No tienes permiso para radicar PQRS.';
  END IF;
  IF v_tipo NOT IN ('PETICION','QUEJA','RECLAMO','SUGERENCIA','FELICITACION') THEN
    RAISE EXCEPTION 'Tipo inválido: %', p_tipo;
  END IF;
  IF v_canal NOT IN ('SEDE','TELEFONO','CORREO','WHATSAPP','PORTAL','OTRO') THEN
    RAISE EXCEPTION 'Canal inválido: %', p_canal;
  END IF;
  IF v_prio NOT IN ('BAJA','MEDIA','ALTA','CRITICA') THEN
    RAISE EXCEPTION 'Prioridad inválida: %', p_prioridad;
  END IF;
  IF v_calidad NOT IN ('RESIDENTE','PROPIETARIO','ADMINISTRACION','EMPRESA_USUARIA','COLABORADOR','PROVEEDOR','OTRO') THEN
    RAISE EXCEPTION 'Calidad del solicitante inválida: %', v_calidad;
  END IF;
  IF p_sede IS NULL THEN RAISE EXCEPTION 'Elige la sede.'; END IF;
  IF NOT public.pqrs_ve_sede(p_sede) THEN
    RAISE EXCEPTION 'No puedes radicar PQRS de esa sede.';
  END IF;
  -- El colaborador involucrado tiene que ser de la sede de la PQRS.
  IF p_persona IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM personas WHERE id = p_persona AND sede_id = p_sede) THEN
    RAISE EXCEPTION 'El colaborador señalado no está asignado a esa sede.';
  END IF;
  IF NULLIF(btrim(p_asunto), '') IS NULL THEN RAISE EXCEPTION 'Escribe el asunto.'; END IF;
  IF NULLIF(btrim(p_descripcion), '') IS NULL THEN RAISE EXCEPTION 'Escribe la descripción.'; END IF;
  IF NOT COALESCE(p_anonima, false) AND v_sol_nom IS NULL THEN
    RAISE EXCEPTION 'Di quién radica, o márcala como anónima.';
  END IF;
  -- Solo coordinación mueve el plazo que trae el tipo.
  IF p_dias_plazo IS NOT NULL AND NOT public.pqrs_coordina() THEN
    RAISE EXCEPTION 'Solo coordinación puede cambiar el plazo de respuesta.';
  END IF;

  v_dias := COALESCE(p_dias_plazo, (SELECT dias_habiles FROM pqrs_plazos WHERE tipo = v_tipo), 15);
  IF v_dias < 1 OR v_dias > 180 THEN RAISE EXCEPTION 'El plazo debe estar entre 1 y 180 días hábiles.'; END IF;

  SELECT nombre INTO v_nombre FROM usuarios WHERE id = v_uid;

  INSERT INTO pqrs (
    id, numero, tipo, canal, prioridad, anonima,
    solicitante_nombre, solicitante_calidad, solicitante_doc, solicitante_telefono, solicitante_email,
    sede_id, persona_id, asunto, descripcion,
    dias_plazo, fecha_limite, radicada_por, radicada_nombre)
  VALUES (
    COALESCE(p_id, gen_random_uuid()),
    'PQ-' || lpad(nextval('pqrs_numero_seq')::text, 5, '0'),
    v_tipo, v_canal, v_prio, COALESCE(p_anonima, false),
    CASE WHEN COALESCE(p_anonima, false) THEN NULL ELSE left(v_sol_nom, 200) END,
    v_calidad,
    CASE WHEN COALESCE(p_anonima, false) THEN NULL ELSE left(NULLIF(btrim(p_solicitante ->> 'documento'), ''), 30) END,
    left(NULLIF(btrim(p_solicitante ->> 'telefono'), ''), 30),
    left(NULLIF(btrim(p_solicitante ->> 'email'), ''), 160),
    p_sede, p_persona, left(btrim(p_asunto), 200), btrim(p_descripcion),
    v_dias, public.pqrs_sumar_habiles(CURRENT_DATE, v_dias), v_uid, v_nombre)
  RETURNING * INTO p_row;

  INSERT INTO pqrs_bitacora (pqrs_id, tipo, mensaje, estado_nuevo)
  VALUES (p_row.id, 'SISTEMA',
          'PQRS radicada (' || p_row.tipo || ', prioridad ' || p_row.prioridad
          || ') · responder antes del ' || to_char(p_row.fecha_limite, 'DD/MM/YYYY')
          || ' (' || v_dias || ' días hábiles).', 'RADICADA');

  FOR a IN SELECT * FROM jsonb_array_elements(COALESCE(p_adjuntos, '[]')) LOOP
    IF (a ->> 'path') NOT LIKE p_row.id::text || '/%' THEN RAISE EXCEPTION 'Ruta de adjunto inválida.'; END IF;
    INSERT INTO pqrs_bitacora (pqrs_id, tipo, mensaje, adjunto_path, adjunto_nombre, adjunto_mime, adjunto_bytes)
    VALUES (p_row.id, 'ADJUNTO', 'Evidencia de la radicación', a ->> 'path',
            left(a ->> 'nombre', 255), left(a ->> 'mime', 120), (a ->> 'bytes')::bigint);
  END LOOP;

  PERFORM pqrs_notificar('PQRS_RADICADA', p_row.id);
  RETURN p_row;
END; $$;
GRANT EXECUTE ON FUNCTION public.pqrs_radicar(UUID, TEXT, TEXT, UUID, TEXT, TEXT, BOOLEAN, JSONB, UUID, TEXT, INT, JSONB) TO authenticated;

-- ── Cambiar estado / responder / cerrar ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.pqrs_cambiar_estado(
  p_pqrs        UUID,
  p_estado      TEXT,
  p_comentario  TEXT,
  p_adjuntos    JSONB DEFAULT '[]',
  p_responsable UUID  DEFAULT NULL,
  p_prioridad   TEXT  DEFAULT NULL,
  p_dias_plazo  INT   DEFAULT NULL
) RETURNS pqrs
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid     UUID    := (SELECT auth.uid());
  v_coord   BOOLEAN := public.pqrs_coordina();
  p_row     pqrs;
  v_ant     TEXT;
  v_estado  TEXT    := upper(COALESCE(p_estado, ''));
  v_coment  TEXT    := NULLIF(btrim(p_comentario), '');
  v_prio    TEXT    := upper(NULLIF(btrim(p_prioridad), ''));
  v_texto   TEXT;
  a         JSONB;
BEGIN
  SELECT * INTO p_row FROM pqrs WHERE id = p_pqrs FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PQRS no encontrada.'; END IF;
  IF NOT public.pqrs_puede_ver(p_pqrs) THEN
    RAISE EXCEPTION 'No tienes permiso sobre esta PQRS.';
  END IF;
  IF v_estado NOT IN ('RADICADA','EN_TRAMITE','EN_ESPERA','RESPONDIDA','CERRADA','ANULADA') THEN
    RAISE EXCEPTION 'Estado inválido: %', p_estado;
  END IF;

  v_ant := p_row.estado;

  IF NOT v_coord THEN
    -- Fuera de coordinación, lo único que se puede es anular lo que uno mismo
    -- radicó por error y que nadie ha tomado todavía.
    IF NOT (v_estado = 'ANULADA' AND v_ant = 'RADICADA' AND p_row.radicada_por = v_uid) THEN
      RAISE EXCEPTION 'Solo coordinación puede pasar la PQRS de % a %.', v_ant, v_estado;
    END IF;
    IF p_responsable IS NOT NULL OR v_prio IS NOT NULL OR p_dias_plazo IS NOT NULL THEN
      RAISE EXCEPTION 'Solo coordinación puede asignar responsable, prioridad o plazo.';
    END IF;
  END IF;

  IF v_estado = 'RESPONDIDA' AND v_ant <> 'RESPONDIDA' AND v_coment IS NULL THEN
    RAISE EXCEPTION 'Escribe la respuesta que se le dio a quien radicó.';
  END IF;
  IF v_estado IN ('CERRADA','ANULADA') AND v_estado <> v_ant AND v_coment IS NULL THEN
    RAISE EXCEPTION 'Para % la PQRS escribe el motivo.', lower(v_estado);
  END IF;
  IF v_estado IN ('RADICADA','EN_TRAMITE') AND v_ant IN ('RESPONDIDA','CERRADA') AND v_coment IS NULL THEN
    RAISE EXCEPTION 'Para reabrir explica por qué no quedó resuelta.';
  END IF;
  IF v_prio IS NOT NULL AND v_prio NOT IN ('BAJA','MEDIA','ALTA','CRITICA') THEN
    RAISE EXCEPTION 'Prioridad inválida: %', p_prioridad;
  END IF;
  IF p_dias_plazo IS NOT NULL AND (p_dias_plazo < 1 OR p_dias_plazo > 180) THEN
    RAISE EXCEPTION 'El plazo debe estar entre 1 y 180 días hábiles.';
  END IF;

  UPDATE pqrs SET
    estado            = v_estado,
    -- Quien atiende se queda con ella al ponerla en trámite.
    responsable_id    = COALESCE(p_responsable, responsable_id,
                                 CASE WHEN v_coord AND v_estado = 'EN_TRAMITE' THEN v_uid END),
    prioridad         = COALESCE(v_prio, prioridad),
    dias_plazo        = COALESCE(p_dias_plazo, dias_plazo),
    -- El plazo se recalcula desde la radicación, no desde hoy.
    fecha_limite      = CASE WHEN p_dias_plazo IS NOT NULL
                             THEN public.pqrs_sumar_habiles(created_at::date, p_dias_plazo)
                             ELSE fecha_limite END,
    respuesta         = CASE WHEN v_estado = 'RESPONDIDA' AND v_coment IS NOT NULL THEN v_coment ELSE respuesta END,
    respondida_at     = CASE WHEN v_estado = 'RESPONDIDA' THEN NOW()
                             WHEN v_estado IN ('RADICADA','EN_TRAMITE') THEN NULL ELSE respondida_at END,
    respondida_por    = CASE WHEN v_estado = 'RESPONDIDA' THEN v_uid
                             WHEN v_estado IN ('RADICADA','EN_TRAMITE') THEN NULL ELSE respondida_por END,
    cerrada_at        = CASE WHEN v_estado IN ('CERRADA','ANULADA') THEN NOW()
                             WHEN v_estado IN ('RADICADA','EN_TRAMITE') THEN NULL ELSE cerrada_at END
  WHERE id = p_pqrs
  RETURNING * INTO p_row;

  v_texto := CASE WHEN v_estado <> v_ant THEN 'Estado: ' || v_ant || ' → ' || v_estado ELSE 'Actualización' END;
  IF p_responsable IS NOT NULL THEN v_texto := v_texto || ' · responsable ' || COALESCE(p_row.responsable_nombre, '—'); END IF;
  IF v_prio IS NOT NULL THEN v_texto := v_texto || ' · prioridad ' || v_prio; END IF;
  IF p_dias_plazo IS NOT NULL THEN
    v_texto := v_texto || ' · plazo ' || p_dias_plazo || ' días hábiles (vence '
            || to_char(p_row.fecha_limite, 'DD/MM/YYYY') || ')';
  END IF;
  IF v_coment IS NOT NULL THEN v_texto := v_texto || E'\n' || v_coment; END IF;

  INSERT INTO pqrs_bitacora (pqrs_id, tipo, mensaje, estado_anterior, estado_nuevo)
  VALUES (p_row.id, 'SISTEMA', v_texto, v_ant, v_estado);

  FOR a IN SELECT * FROM jsonb_array_elements(COALESCE(p_adjuntos, '[]')) LOOP
    IF (a ->> 'path') NOT LIKE p_row.id::text || '/%' THEN RAISE EXCEPTION 'Ruta de adjunto inválida.'; END IF;
    INSERT INTO pqrs_bitacora (pqrs_id, tipo, mensaje, adjunto_path, adjunto_nombre, adjunto_mime, adjunto_bytes)
    VALUES (p_row.id, 'ADJUNTO', 'Evidencia (' || v_estado || ')', a ->> 'path',
            left(a ->> 'nombre', 255), left(a ->> 'mime', 120), (a ->> 'bytes')::bigint);
  END LOOP;

  PERFORM pqrs_notificar('PQRS_ESTADO', p_row.id,
    jsonb_build_object('estado_anterior', v_ant, 'comentario', v_coment));
  RETURN p_row;
END; $$;
GRANT EXECUTE ON FUNCTION public.pqrs_cambiar_estado(UUID, TEXT, TEXT, JSONB, UUID, TEXT, INT) TO authenticated;

-- ── RLS ─────────────────────────────────────────────────────────────────────
-- La PQRS se escribe SOLO por RPC; la bitácora sí admite mensajes directos.
ALTER TABLE pqrs                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE pqrs_bitacora        ENABLE ROW LEVEL SECURITY;
ALTER TABLE pqrs_plazos          ENABLE ROW LEVEL SECURITY;
ALTER TABLE pqrs_dias_no_habiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pqrs_read ON pqrs;
CREATE POLICY pqrs_read ON pqrs FOR SELECT TO authenticated
  USING ((SELECT public.pqrs_ve_todo())
         OR (sede_id IS NOT NULL AND sede_id = (SELECT public.pqrs_mi_sede()) AND (SELECT public.pqrs_acceso()))
         OR radicada_por = (SELECT auth.uid())
         OR responsable_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS pqrs_bitacora_read ON pqrs_bitacora;
CREATE POLICY pqrs_bitacora_read ON pqrs_bitacora FOR SELECT TO authenticated
  USING (public.pqrs_puede_ver(pqrs_id));

DROP POLICY IF EXISTS pqrs_bitacora_insert ON pqrs_bitacora;
CREATE POLICY pqrs_bitacora_insert ON pqrs_bitacora FOR INSERT TO authenticated
  WITH CHECK (
    tipo IN ('MENSAJE','ADJUNTO')
    AND estado_nuevo IS NULL AND estado_anterior IS NULL
    -- `ver_pqrs` solo mira (Auditoría); para escribir hace falta gestionar.
    AND public.auth_permiso('gestionar_pqrs')
    AND public.pqrs_puede_ver(pqrs_id)
    AND (adjunto_path IS NULL OR adjunto_path LIKE pqrs_id::text || '/%')
    AND EXISTS (SELECT 1 FROM pqrs p WHERE p.id = pqrs_id AND p.estado NOT IN ('CERRADA','ANULADA'))
  );

-- Parámetros: los lee cualquiera con acceso al módulo; los cambia coordinación.
DROP POLICY IF EXISTS pqrs_plazos_read ON pqrs_plazos;
CREATE POLICY pqrs_plazos_read ON pqrs_plazos FOR SELECT TO authenticated
  USING ((SELECT public.pqrs_acceso()));
DROP POLICY IF EXISTS pqrs_plazos_write ON pqrs_plazos;
CREATE POLICY pqrs_plazos_write ON pqrs_plazos FOR ALL TO authenticated
  USING ((SELECT public.pqrs_coordina())) WITH CHECK ((SELECT public.pqrs_coordina()));

DROP POLICY IF EXISTS pqrs_dnh_read ON pqrs_dias_no_habiles;
CREATE POLICY pqrs_dnh_read ON pqrs_dias_no_habiles FOR SELECT TO authenticated
  USING ((SELECT public.pqrs_acceso()));
DROP POLICY IF EXISTS pqrs_dnh_write ON pqrs_dias_no_habiles;
CREATE POLICY pqrs_dnh_write ON pqrs_dias_no_habiles FOR ALL TO authenticated
  USING ((SELECT public.pqrs_coordina())) WITH CHECK ((SELECT public.pqrs_coordina()));

-- ── Realtime (la bitácora se ve llegar sin recargar) ────────────────────────
ALTER TABLE pqrs_bitacora REPLICA IDENTITY FULL;
ALTER TABLE pqrs          REPLICA IDENTITY FULL;
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE pqrs_bitacora;
EXCEPTION WHEN duplicate_object THEN null; WHEN undefined_object THEN null; END $$;
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE pqrs;
EXCEPTION WHEN duplicate_object THEN null; WHEN undefined_object THEN null; END $$;

-- ── Storage: evidencia de la radicación y del trámite (privado) ─────────────
-- Ruta: {pqrs_id}/{archivo}.
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('pqrs', 'pqrs', false, 52428800)
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = EXCLUDED.file_size_limit;

CREATE OR REPLACE FUNCTION public.pqrs_carpeta(p_name TEXT)
RETURNS UUID LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  RETURN split_part(p_name, '/', 1)::uuid;
EXCEPTION WHEN OTHERS THEN RETURN NULL;
END; $$;

-- Subir: con permiso del módulo, a la carpeta de una PQRS que aún no existe
-- (la que se está radicando) o de una que ya puede ver.
CREATE OR REPLACE FUNCTION public.pqrs_puede_subir(p_name TEXT)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.pqrs_carpeta(p_name) IS NOT NULL
     AND public.auth_permiso('gestionar_pqrs')
     AND (NOT EXISTS (SELECT 1 FROM pqrs WHERE id = public.pqrs_carpeta(p_name))
          OR public.pqrs_puede_ver(public.pqrs_carpeta(p_name)))
$$;
GRANT EXECUTE ON FUNCTION public.pqrs_puede_subir(TEXT) TO authenticated;

DROP POLICY IF EXISTS pqrs_storage_select ON storage.objects;
DROP POLICY IF EXISTS pqrs_storage_insert ON storage.objects;
DROP POLICY IF EXISTS pqrs_storage_delete ON storage.objects;
CREATE POLICY pqrs_storage_select ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'pqrs'
         AND (owner = (SELECT auth.uid())
              OR public.pqrs_puede_ver(public.pqrs_carpeta(name))));
CREATE POLICY pqrs_storage_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'pqrs' AND public.pqrs_puede_subir(name));
CREATE POLICY pqrs_storage_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'pqrs' AND (SELECT public.pqrs_coordina()));

-- ── Eventos para el motor de notificaciones ─────────────────────────────────
INSERT INTO eventos_notificacion (codigo, nombre, descripcion, modulo, variables) VALUES
  ('PQRS_RADICADA', 'PQRS radicada',
   'Se radicó una petición, queja, reclamo, sugerencia o felicitación sobre una sede.', 'PQRS',
   '[{"clave":"numero","descripcion":"Número de radicado (PQ-…)"},{"clave":"tipo","descripcion":"PETICION / QUEJA / RECLAMO / SUGERENCIA / FELICITACION"},{"clave":"asunto","descripcion":"Asunto"},{"clave":"sede","descripcion":"Sede"},{"clave":"canal","descripcion":"Por dónde llegó"},{"clave":"prioridad","descripcion":"BAJA / MEDIA / ALTA / CRITICA"},{"clave":"solicitante","descripcion":"Quién radica (o \"Anónima\")"},{"clave":"fecha_limite","descripcion":"Fecha límite de respuesta"},{"clave":"enlace","descripcion":"Ruta de la PQRS"}]'),
  ('PQRS_ESTADO', 'Cambio en una PQRS',
   'Una PQRS cambió de estado, de responsable, de prioridad o de plazo.', 'PQRS',
   '[{"clave":"numero","descripcion":"Número de radicado"},{"clave":"estado","descripcion":"Estado nuevo"},{"clave":"estado_anterior","descripcion":"Estado anterior"},{"clave":"comentario","descripcion":"Comentario o respuesta del cambio"},{"clave":"responsable","descripcion":"Quién la atiende"},{"clave":"sede","descripcion":"Sede"},{"clave":"fecha_limite","descripcion":"Fecha límite de respuesta"},{"clave":"enlace","descripcion":"Ruta de la PQRS"}]')
ON CONFLICT (codigo) DO NOTHING;

-- ── Auditoría: mirar sin tocar ──────────────────────────────────────────────
UPDATE public.roles SET permisos = permisos || '{"ver_pqrs": true}'::jsonb
WHERE nombre = 'Auditor';

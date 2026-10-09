-- =============================================================================
-- MÓDULO: SOPORTE (botón de bug + control de tickets)
-- =============================================================================
-- Cualquier usuario con sesión reporta desde el botón 🐞 de la barra superior:
--   ERROR    algo falla
--   SOPORTE  necesito ayuda / no sé cómo hacer algo
--   MEJORA   propuesta de mejora
--
-- Al reportar se guarda en `contexto` (JSONB) todo lo que el navegador pudo
-- capturar: ruta y módulo, consola, errores, peticiones de red, clics,
-- navegador, pantalla… más una captura de pantalla en el bucket `soporte`.
-- El usuario lo completa la BD (no el cliente) para que sea confiable.
--
-- Seguimiento estilo chat (`soporte_mensajes`) con adjuntos (fotos, video) y
-- mensajes de SISTEMA por cada cambio de estado. El cierre exige comentario y
-- puede llevar evidencia.
--
-- Flujo: ABIERTO → EN_PROCESO ⇄ EN_ESPERA → RESUELTO → CERRADO (o CANCELADO).
--   Soporte (gestionar_soporte): cualquier cambio.
--   Quien reportó: cancelar si sigue ABIERTO, confirmar (CERRADO) o reabrir
--   cuando está RESUELTO, reabrir si está CERRADO.
--
-- Permisos nuevos (catálogo en lib/permisos.ts):
--   ver_tickets_soporte   ver los tickets de todos (sin él, solo los propios)
--   gestionar_soporte     atender: asignar, cambiar estado, cerrar con evidencia
--
-- IDEMPOTENTE.
-- =============================================================================

SET search_path TO public;

CREATE SEQUENCE IF NOT EXISTS soporte_ticket_seq;

CREATE TABLE IF NOT EXISTS soporte_tickets (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  numero            VARCHAR(30) NOT NULL UNIQUE,
  tipo              VARCHAR(10) NOT NULL DEFAULT 'ERROR' CHECK (tipo IN ('ERROR','SOPORTE','MEJORA')),
  prioridad         VARCHAR(10) NOT NULL DEFAULT 'MEDIA' CHECK (prioridad IN ('BAJA','MEDIA','ALTA','CRITICA')),
  estado            VARCHAR(12) NOT NULL DEFAULT 'ABIERTO'
                    CHECK (estado IN ('ABIERTO','EN_PROCESO','EN_ESPERA','RESUELTO','CERRADO','CANCELADO')),
  titulo            VARCHAR(200) NOT NULL,
  descripcion       TEXT,
  ruta              TEXT,                 -- URL/ruta donde se reportó
  modulo            VARCHAR(120),         -- módulo de la navegación (p. ej. "Inventario › Stock")
  contexto          JSONB NOT NULL DEFAULT '{}',
  captura_path      TEXT,                 -- captura de pantalla en el bucket `soporte`
  reportado_por     UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  reportado_nombre  VARCHAR(200),
  reportado_email   VARCHAR(200),
  asignado_a        UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  asignado_nombre   VARCHAR(200),
  solucion          TEXT,
  resuelto_at       TIMESTAMPTZ,
  cerrado_at        TIMESTAMPTZ,
  ultimo_mensaje_at TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_soporte_tickets_estado  ON soporte_tickets(estado, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_soporte_tickets_reporta ON soporte_tickets(reportado_por, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_soporte_tickets_asignado ON soporte_tickets(asignado_a) WHERE asignado_a IS NOT NULL;

DROP TRIGGER IF EXISTS tr_soporte_tickets_upd ON soporte_tickets;
CREATE TRIGGER tr_soporte_tickets_upd BEFORE UPDATE ON soporte_tickets
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Nombre del asignado desnormalizado: la RLS de `usuarios` solo deja leer el
-- propio registro, y quien reporta debe ver quién lo atiende.
CREATE OR REPLACE FUNCTION public.tr_soporte_tickets_nombres()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.asignado_a IS DISTINCT FROM OLD.asignado_a THEN
    NEW.asignado_nombre := (SELECT nombre FROM usuarios WHERE id = NEW.asignado_a);
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS tr_soporte_tickets_nombres ON soporte_tickets;
CREATE TRIGGER tr_soporte_tickets_nombres BEFORE INSERT OR UPDATE ON soporte_tickets
  FOR EACH ROW EXECUTE FUNCTION public.tr_soporte_tickets_nombres();

-- ── Chat / trazabilidad ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS soporte_mensajes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id       UUID NOT NULL REFERENCES soporte_tickets(id) ON DELETE CASCADE,
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
  CONSTRAINT soporte_msj_contenido CHECK (NULLIF(btrim(mensaje), '') IS NOT NULL OR adjunto_path IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_soporte_mensajes_ticket  ON soporte_mensajes(ticket_id, created_at);
CREATE INDEX IF NOT EXISTS idx_soporte_mensajes_usuario ON soporte_mensajes(usuario_id);

-- El autor lo pone la base de datos, no el cliente.
CREATE OR REPLACE FUNCTION public.tr_soporte_mensaje_autor()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  NEW.usuario_id := COALESCE((SELECT auth.uid()), NEW.usuario_id);
  IF NEW.usuario_id IS NOT NULL THEN
    SELECT nombre INTO NEW.usuario_nombre FROM usuarios WHERE id = NEW.usuario_id;
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS tr_soporte_mensaje_autor ON soporte_mensajes;
CREATE TRIGGER tr_soporte_mensaje_autor BEFORE INSERT ON soporte_mensajes
  FOR EACH ROW EXECUTE FUNCTION public.tr_soporte_mensaje_autor();

CREATE OR REPLACE FUNCTION public.tr_soporte_mensaje_ultimo()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.tipo <> 'SISTEMA' THEN
    UPDATE soporte_tickets SET ultimo_mensaje_at = NEW.created_at WHERE id = NEW.ticket_id;
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS tr_soporte_mensaje_ultimo ON soporte_mensajes;
CREATE TRIGGER tr_soporte_mensaje_ultimo AFTER INSERT ON soporte_mensajes
  FOR EACH ROW EXECUTE FUNCTION public.tr_soporte_mensaje_ultimo();

-- ── Quién ve qué ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.soporte_es_agente()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.auth_permiso_any('{ver_tickets_soporte,gestionar_soporte}'::text[])
$$;
GRANT EXECUTE ON FUNCTION public.soporte_es_agente() TO authenticated;

CREATE OR REPLACE FUNCTION public.soporte_puede_ver(p_ticket UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.soporte_es_agente()
      OR EXISTS (SELECT 1 FROM soporte_tickets t
                  WHERE t.id = p_ticket AND t.reportado_por = (SELECT auth.uid()))
$$;
GRANT EXECUTE ON FUNCTION public.soporte_puede_ver(UUID) TO authenticated;

-- Agentes de soporte (para asignar).
CREATE OR REPLACE FUNCTION public.soporte_agentes()
RETURNS TABLE (id UUID, nombre VARCHAR, rol_nombre VARCHAR)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT u.id, u.nombre, r.nombre
    FROM usuarios u LEFT JOIN roles r ON r.id = u.rol_id
   WHERE public.soporte_es_agente()
     AND COALESCE(u.activo, true)
     AND (u.rol IN ('SUPER_ADMIN','ADMIN')
       OR COALESCE(u.permisos ->> 'gestionar_soporte', r.permisos ->> 'gestionar_soporte') = 'true')
   ORDER BY u.nombre
$$;
GRANT EXECUTE ON FUNCTION public.soporte_agentes() TO authenticated;

CREATE OR REPLACE FUNCTION public.soporte_notificar(p_codigo TEXT, p_ticket UUID, p_extra JSONB DEFAULT '{}')
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v JSONB;
BEGIN
  SELECT jsonb_build_object(
           'ticket_id', t.id, 'numero', t.numero, 'titulo', t.titulo, 'tipo', t.tipo,
           'prioridad', t.prioridad, 'estado', t.estado, 'modulo', t.modulo,
           'reportado_por', t.reportado_nombre, 'asignado_a', t.asignado_nombre,
           'enlace', '/soporte/' || t.id)
         || COALESCE(p_extra, '{}')
    INTO v FROM soporte_tickets t WHERE t.id = p_ticket;
  PERFORM public.emitir_evento(p_codigo, v, 'SoporteTicket', p_ticket::text);
EXCEPTION WHEN OTHERS THEN
  -- Notificar nunca debe tumbar la operación principal.
  RAISE WARNING 'soporte_notificar(%): %', p_codigo, SQLERRM;
END; $$;
REVOKE ALL ON FUNCTION public.soporte_notificar(TEXT, UUID, JSONB) FROM PUBLIC;

-- ── Crear ticket ────────────────────────────────────────────────────────────
-- `p_id` lo genera el cliente: así la captura se sube ANTES a `soporte/{id}/…`.
CREATE OR REPLACE FUNCTION public.soporte_crear(
  p_id          UUID,
  p_tipo        TEXT,
  p_prioridad   TEXT,
  p_titulo      TEXT,
  p_descripcion TEXT,
  p_ruta        TEXT,
  p_modulo      TEXT,
  p_contexto    JSONB,
  p_captura     TEXT,
  p_adjuntos    JSONB DEFAULT '[]'   -- [{path, nombre, mime, bytes}]
) RETURNS soporte_tickets
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid UUID := (SELECT auth.uid());
  u     RECORD;
  t     soporte_tickets;
  a     JSONB;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Debes iniciar sesión para reportar.'; END IF;
  IF NULLIF(btrim(p_titulo), '') IS NULL THEN RAISE EXCEPTION 'Escribe un título.'; END IF;
  IF p_tipo NOT IN ('ERROR','SOPORTE','MEJORA') THEN RAISE EXCEPTION 'Tipo inválido: %', p_tipo; END IF;
  IF COALESCE(p_prioridad, 'MEDIA') NOT IN ('BAJA','MEDIA','ALTA','CRITICA') THEN RAISE EXCEPTION 'Prioridad inválida.'; END IF;
  -- Las rutas de archivos deben estar en la carpeta del propio ticket.
  IF p_captura IS NOT NULL AND p_captura NOT LIKE p_id::text || '/%' THEN RAISE EXCEPTION 'Ruta de captura inválida.'; END IF;

  SELECT us.id, us.nombre, us.email, us.rol::text AS rol, r.nombre AS rol_nombre, s.nombre AS sede
    INTO u
    FROM usuarios us
    LEFT JOIN roles r ON r.id = us.rol_id
    LEFT JOIN sedes s ON s.id = us.sede_id
   WHERE us.id = v_uid;

  INSERT INTO soporte_tickets (id, numero, tipo, prioridad, titulo, descripcion, ruta, modulo,
                               contexto, captura_path, reportado_por, reportado_nombre, reportado_email)
  VALUES (
    COALESCE(p_id, gen_random_uuid()),
    'SP-' || lpad(nextval('soporte_ticket_seq')::text, 5, '0'),
    p_tipo, COALESCE(p_prioridad, 'MEDIA'), left(btrim(p_titulo), 200), NULLIF(btrim(p_descripcion), ''),
    left(p_ruta, 2000), left(p_modulo, 120),
    -- El usuario lo pone la BD (lo del cliente se descarta).
    (COALESCE(p_contexto, '{}') - 'usuario') || jsonb_build_object('usuario', jsonb_build_object(
      'id', v_uid, 'nombre', u.nombre, 'email', u.email, 'rol', u.rol,
      'rol_nombre', u.rol_nombre, 'sede', u.sede)),
    p_captura, v_uid, u.nombre, u.email)
  RETURNING * INTO t;

  INSERT INTO soporte_mensajes (ticket_id, tipo, mensaje, estado_nuevo)
  VALUES (t.id, 'SISTEMA', 'Ticket creado (' || t.tipo || ', prioridad ' || t.prioridad || ').', 'ABIERTO');

  FOR a IN SELECT * FROM jsonb_array_elements(COALESCE(p_adjuntos, '[]')) LOOP
    IF (a ->> 'path') NOT LIKE t.id::text || '/%' THEN RAISE EXCEPTION 'Ruta de adjunto inválida.'; END IF;
    INSERT INTO soporte_mensajes (ticket_id, tipo, adjunto_path, adjunto_nombre, adjunto_mime, adjunto_bytes)
    VALUES (t.id, 'ADJUNTO', a ->> 'path', left(a ->> 'nombre', 255), left(a ->> 'mime', 120), (a ->> 'bytes')::bigint);
  END LOOP;

  PERFORM soporte_notificar('SOPORTE_TICKET_CREADO', t.id);
  RETURN t;
END; $$;
GRANT EXECUTE ON FUNCTION public.soporte_crear(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, TEXT, JSONB) TO authenticated;

-- ── Cambiar estado (con comentario y evidencia) ─────────────────────────────
CREATE OR REPLACE FUNCTION public.soporte_cambiar_estado(
  p_ticket     UUID,
  p_estado     TEXT,
  p_comentario TEXT,
  p_adjuntos   JSONB DEFAULT '[]',   -- evidencia: [{path, nombre, mime, bytes}]
  p_asignado   UUID DEFAULT NULL,
  p_prioridad  TEXT DEFAULT NULL
) RETURNS soporte_tickets
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid    UUID := (SELECT auth.uid());
  v_agente BOOLEAN := public.auth_permiso('gestionar_soporte');
  t        soporte_tickets;
  v_ant    TEXT;
  v_coment TEXT := NULLIF(btrim(p_comentario), '');
  v_texto  TEXT;
  a        JSONB;
BEGIN
  SELECT * INTO t FROM soporte_tickets WHERE id = p_ticket FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ticket no encontrado.'; END IF;
  IF NOT (v_agente OR t.reportado_por = v_uid) THEN
    RAISE EXCEPTION 'No tienes permiso para cambiar este ticket.';
  END IF;
  IF p_estado NOT IN ('ABIERTO','EN_PROCESO','EN_ESPERA','RESUELTO','CERRADO','CANCELADO') THEN
    RAISE EXCEPTION 'Estado inválido: %', p_estado;
  END IF;

  v_ant := t.estado;

  IF NOT v_agente THEN
    -- Quien reportó: cancelar lo que nadie ha tomado, confirmar o reabrir.
    IF NOT (
         (p_estado = 'CANCELADO' AND v_ant = 'ABIERTO')
      OR (p_estado = 'CERRADO'   AND v_ant = 'RESUELTO')
      OR (p_estado = 'ABIERTO'   AND v_ant IN ('RESUELTO','CERRADO'))
    ) THEN
      RAISE EXCEPTION 'Solo soporte puede pasar el ticket de % a %.', v_ant, p_estado;
    END IF;
    IF p_asignado IS NOT NULL OR p_prioridad IS NOT NULL THEN
      RAISE EXCEPTION 'Solo soporte puede asignar o cambiar la prioridad.';
    END IF;
  END IF;

  IF p_estado IN ('RESUELTO','CERRADO','CANCELADO') AND v_coment IS NULL AND p_estado <> v_ant THEN
    RAISE EXCEPTION 'Para % el ticket escribe un comentario con la solución o el motivo.', lower(p_estado);
  END IF;
  IF p_estado = 'ABIERTO' AND v_ant IN ('RESUELTO','CERRADO') AND v_coment IS NULL THEN
    RAISE EXCEPTION 'Para reabrir explica qué sigue fallando.';
  END IF;
  IF p_prioridad IS NOT NULL AND p_prioridad NOT IN ('BAJA','MEDIA','ALTA','CRITICA') THEN
    RAISE EXCEPTION 'Prioridad inválida.';
  END IF;

  UPDATE soporte_tickets SET
    estado      = p_estado,
    asignado_a  = COALESCE(p_asignado, asignado_a,
                           CASE WHEN v_agente AND p_estado = 'EN_PROCESO' THEN v_uid END),
    prioridad   = COALESCE(p_prioridad, prioridad),
    solucion    = CASE WHEN p_estado = 'RESUELTO' AND v_coment IS NOT NULL THEN v_coment ELSE solucion END,
    resuelto_at = CASE WHEN p_estado = 'RESUELTO' THEN NOW()
                       WHEN p_estado = 'ABIERTO' THEN NULL ELSE resuelto_at END,
    cerrado_at  = CASE WHEN p_estado IN ('CERRADO','CANCELADO') THEN NOW()
                       WHEN p_estado = 'ABIERTO' THEN NULL ELSE cerrado_at END
  WHERE id = p_ticket
  RETURNING * INTO t;

  v_texto := CASE WHEN p_estado <> v_ant THEN 'Estado: ' || v_ant || ' → ' || p_estado ELSE 'Actualización' END;
  IF p_asignado IS NOT NULL THEN v_texto := v_texto || ' · asignado a ' || COALESCE(t.asignado_nombre, '—'); END IF;
  IF p_prioridad IS NOT NULL THEN v_texto := v_texto || ' · prioridad ' || p_prioridad; END IF;
  IF v_coment IS NOT NULL THEN v_texto := v_texto || E'\n' || v_coment; END IF;

  INSERT INTO soporte_mensajes (ticket_id, tipo, mensaje, estado_anterior, estado_nuevo)
  VALUES (t.id, 'SISTEMA', v_texto, v_ant, p_estado);

  FOR a IN SELECT * FROM jsonb_array_elements(COALESCE(p_adjuntos, '[]')) LOOP
    IF (a ->> 'path') NOT LIKE t.id::text || '/%' THEN RAISE EXCEPTION 'Ruta de adjunto inválida.'; END IF;
    INSERT INTO soporte_mensajes (ticket_id, tipo, mensaje, adjunto_path, adjunto_nombre, adjunto_mime, adjunto_bytes)
    VALUES (t.id, 'ADJUNTO', 'Evidencia (' || p_estado || ')', a ->> 'path', left(a ->> 'nombre', 255),
            left(a ->> 'mime', 120), (a ->> 'bytes')::bigint);
  END LOOP;

  PERFORM soporte_notificar('SOPORTE_TICKET_ESTADO', t.id,
    jsonb_build_object('estado_anterior', v_ant, 'comentario', v_coment));
  RETURN t;
END; $$;
GRANT EXECUTE ON FUNCTION public.soporte_cambiar_estado(UUID, TEXT, TEXT, JSONB, UUID, TEXT) TO authenticated;

-- ── RLS ─────────────────────────────────────────────────────────────────────
-- Escrituras de tickets SOLO por RPC; los mensajes del chat sí por INSERT.
ALTER TABLE soporte_tickets  ENABLE ROW LEVEL SECURITY;
ALTER TABLE soporte_mensajes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS soporte_tickets_read ON soporte_tickets;
CREATE POLICY soporte_tickets_read ON soporte_tickets FOR SELECT TO authenticated
  USING (reportado_por = (SELECT auth.uid()) OR (SELECT public.soporte_es_agente()));

DROP POLICY IF EXISTS soporte_mensajes_read ON soporte_mensajes;
CREATE POLICY soporte_mensajes_read ON soporte_mensajes FOR SELECT TO authenticated
  USING (public.soporte_puede_ver(ticket_id));

DROP POLICY IF EXISTS soporte_mensajes_insert ON soporte_mensajes;
CREATE POLICY soporte_mensajes_insert ON soporte_mensajes FOR INSERT TO authenticated
  WITH CHECK (
    tipo IN ('MENSAJE','ADJUNTO')
    AND estado_nuevo IS NULL AND estado_anterior IS NULL
    AND public.soporte_puede_ver(ticket_id)
    AND (adjunto_path IS NULL OR adjunto_path LIKE ticket_id::text || '/%')
    AND EXISTS (SELECT 1 FROM soporte_tickets t
                 WHERE t.id = ticket_id AND t.estado NOT IN ('CERRADO','CANCELADO'))
  );

-- ── Realtime ────────────────────────────────────────────────────────────────
ALTER TABLE soporte_mensajes REPLICA IDENTITY FULL;
ALTER TABLE soporte_tickets  REPLICA IDENTITY FULL;
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE soporte_mensajes;
EXCEPTION WHEN duplicate_object THEN null; WHEN undefined_object THEN null; END $$;
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE soporte_tickets;
EXCEPTION WHEN duplicate_object THEN null; WHEN undefined_object THEN null; END $$;

-- ── Storage: capturas, adjuntos y evidencia (privado) ───────────────────────
-- Ruta: {ticket_id}/{archivo}. Subir: cualquiera con sesión, pero solo a la
-- carpeta de un ticket nuevo (aún no existe) o de uno que puede ver.
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('soporte', 'soporte', false, 52428800)
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = EXCLUDED.file_size_limit;

CREATE OR REPLACE FUNCTION public.soporte_carpeta_ticket(p_name TEXT)
RETURNS UUID LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  RETURN split_part(p_name, '/', 1)::uuid;
EXCEPTION WHEN OTHERS THEN RETURN NULL;
END; $$;

CREATE OR REPLACE FUNCTION public.soporte_puede_subir(p_name TEXT)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.soporte_carpeta_ticket(p_name) IS NOT NULL
     AND (NOT EXISTS (SELECT 1 FROM soporte_tickets WHERE id = public.soporte_carpeta_ticket(p_name))
          OR public.soporte_puede_ver(public.soporte_carpeta_ticket(p_name)))
$$;
GRANT EXECUTE ON FUNCTION public.soporte_puede_subir(TEXT) TO authenticated;

DROP POLICY IF EXISTS soporte_select ON storage.objects;
DROP POLICY IF EXISTS soporte_insert ON storage.objects;
DROP POLICY IF EXISTS soporte_delete ON storage.objects;
CREATE POLICY soporte_select ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'soporte'
         AND (owner = (SELECT auth.uid())
              OR public.soporte_puede_ver(public.soporte_carpeta_ticket(name))));
CREATE POLICY soporte_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'soporte' AND public.soporte_puede_subir(name));
CREATE POLICY soporte_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'soporte' AND public.auth_permiso('gestionar_soporte'));

-- ── Eventos para el motor de notificaciones ─────────────────────────────────
INSERT INTO eventos_notificacion (codigo, nombre, descripcion, modulo, variables) VALUES
  ('SOPORTE_TICKET_CREADO', 'Ticket de soporte creado',
   'Alguien reportó un error, pidió soporte o propuso una mejora desde el botón de bug.', 'Soporte',
   '[{"clave":"numero","descripcion":"Número del ticket (SP-…)"},{"clave":"titulo","descripcion":"Título"},{"clave":"tipo","descripcion":"ERROR / SOPORTE / MEJORA"},{"clave":"prioridad","descripcion":"BAJA / MEDIA / ALTA / CRITICA"},{"clave":"modulo","descripcion":"Módulo donde se reportó"},{"clave":"reportado_por","descripcion":"Quién reportó"},{"clave":"enlace","descripcion":"Ruta del ticket"}]'),
  ('SOPORTE_TICKET_ESTADO', 'Cambio en ticket de soporte',
   'Un ticket de soporte cambió de estado, de asignado o de prioridad.', 'Soporte',
   '[{"clave":"numero","descripcion":"Número del ticket"},{"clave":"estado","descripcion":"Estado nuevo"},{"clave":"estado_anterior","descripcion":"Estado anterior"},{"clave":"comentario","descripcion":"Comentario del cambio"},{"clave":"asignado_a","descripcion":"Quién lo atiende"},{"clave":"reportado_por","descripcion":"Quién reportó"},{"clave":"enlace","descripcion":"Ruta del ticket"}]')
ON CONFLICT (codigo) DO NOTHING;

-- ── Roles: soporte para administración; auditoría solo mira ─────────────────
UPDATE public.roles SET permisos = permisos || '{"ver_tickets_soporte": true}'::jsonb
WHERE nombre = 'Auditor';

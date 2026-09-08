-- =============================================================================
-- REPORTES DE SERVICIO, CALIFICACIÓN DE DOBLE VÍA, ENCUESTAS Y NO CONFORMIDADES
-- =============================================================================
-- Cierra el ciclo de un servicio del hogar:
--
-- · La conserje deja un **reporte** de lo que hizo, con fotos, y califica al
--   cliente. Lo llena desde una pantalla propia del sitio web, pensada para el
--   celular.
-- · El cliente **califica el servicio**, sube sus propias fotos y responde una
--   **encuesta** cuyas preguntas se editan desde el administrativo. La encuesta
--   no es obligatoria: se responde por puntos, no por obligación.
-- · Si algo salió mal, el cliente abre una **no conformidad** y queda un hilo
--   de conversación hasta cerrarla.
--
-- Todo queda ligado a la solicitud, así que el historial de un servicio incluye
-- lo que dijeron las dos partes.
--
-- Idempotente: se puede repetir sin efecto.
-- =============================================================================

-- ── Quién soy, como conserje ─────────────────────────────────────────────────
-- Las políticas de abajo la usan para dejar que una conserje vea y escriba solo
-- lo de los servicios que le asignaron.
CREATE OR REPLACE FUNCTION public.mi_concerje_id()
RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  SELECT id FROM concerjes_hogar WHERE usuario_id = (SELECT auth.uid()) AND activo LIMIT 1;
$fn$;

GRANT EXECUTE ON FUNCTION public.mi_concerje_id() TO authenticated, service_role;

-- =============================================================================
-- 1. REPORTE DE LA CONSERJE
-- =============================================================================
CREATE TABLE IF NOT EXISTS reportes_servicio (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  solicitud_id        UUID NOT NULL UNIQUE REFERENCES solicitudes_servicio_hogar(id) ON DELETE CASCADE,
  concerje_id         UUID REFERENCES concerjes_hogar(id) ON DELETE SET NULL,
  usuario_id          UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  estado              VARCHAR(20) NOT NULL DEFAULT 'BORRADOR',   -- BORRADOR | ENVIADO
  -- Qué pasó
  hora_llegada        TIMESTAMPTZ,
  hora_salida         TIMESTAMPTZ,
  resumen             TEXT,
  areas_atendidas     TEXT[] NOT NULL DEFAULT '{}',
  novedades           TEXT,
  insumos             TEXT,
  requiere_seguimiento BOOLEAN NOT NULL DEFAULT false,
  -- La conserje califica al cliente (la otra mitad de la doble vía)
  calificacion_cliente SMALLINT CHECK (calificacion_cliente BETWEEN 1 AND 5),
  comentario_cliente  TEXT,
  enviado_at          TIMESTAMPTZ,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW(),

  CONSTRAINT reporte_estado CHECK (estado IN ('BORRADOR','ENVIADO'))
);
CREATE INDEX IF NOT EXISTS idx_reportes_concerje ON reportes_servicio(concerje_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reportes_estado   ON reportes_servicio(estado, created_at DESC);

DROP TRIGGER IF EXISTS tr_reportes_upd ON reportes_servicio;
CREATE TRIGGER tr_reportes_upd BEFORE UPDATE ON reportes_servicio
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =============================================================================
-- 2. FOTOS
-- =============================================================================
-- Las suben las dos partes: la conserje muestra cómo entregó, el cliente
-- documenta lo que quiera dejar constancia (incluso dentro de una queja).
CREATE TABLE IF NOT EXISTS fotos_servicio (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  solicitud_id UUID REFERENCES solicitudes_servicio_hogar(id) ON DELETE CASCADE,
  reporte_id   UUID REFERENCES reportes_servicio(id) ON DELETE CASCADE,
  caso_id      UUID,   -- FK más abajo, cuando exista la tabla
  autor        VARCHAR(10) NOT NULL DEFAULT 'CLIENTE',   -- CLIENTE | CONCERJE | STAFF
  momento      VARCHAR(10) NOT NULL DEFAULT 'DESPUES',   -- ANTES | DESPUES | NOVEDAD | CASO
  path         TEXT NOT NULL,        -- ruta dentro del bucket 'fotos-servicio'
  descripcion  VARCHAR(200),
  subido_por   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ DEFAULT NOW(),

  CONSTRAINT foto_autor   CHECK (autor IN ('CLIENTE','CONCERJE','STAFF')),
  CONSTRAINT foto_momento CHECK (momento IN ('ANTES','DESPUES','NOVEDAD','CASO'))
);
CREATE INDEX IF NOT EXISTS idx_fotos_solicitud ON fotos_servicio(solicitud_id, created_at);
CREATE INDEX IF NOT EXISTS idx_fotos_caso      ON fotos_servicio(caso_id, created_at);

-- =============================================================================
-- 3. ENCUESTA PARAMETRIZABLE
-- =============================================================================
CREATE TABLE IF NOT EXISTS preguntas_encuesta (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo      VARCHAR(40) UNIQUE NOT NULL,
  texto       VARCHAR(250) NOT NULL,
  ayuda       VARCHAR(250),
  tipo        VARCHAR(20) NOT NULL DEFAULT 'ESTRELLAS',
  -- ESTRELLAS | SI_NO | ESCALA | TEXTO | OPCIONES
  opciones    TEXT[] NOT NULL DEFAULT '{}',
  dirigida_a  VARCHAR(10) NOT NULL DEFAULT 'CLIENTE',   -- CLIENTE | CONCERJE
  -- A propósito nunca obligatoria: la encuesta se responde por los puntos, no
  -- por bloquear al cliente. La columna existe por si algún día cambia.
  obligatoria BOOLEAN NOT NULL DEFAULT false,
  activo      BOOLEAN NOT NULL DEFAULT true,
  orden       SMALLINT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW(),

  CONSTRAINT pregunta_tipo   CHECK (tipo IN ('ESTRELLAS','SI_NO','ESCALA','TEXTO','OPCIONES')),
  CONSTRAINT pregunta_dirige CHECK (dirigida_a IN ('CLIENTE','CONCERJE'))
);
CREATE INDEX IF NOT EXISTS idx_preguntas_activas ON preguntas_encuesta(dirigida_a, activo, orden);

DROP TRIGGER IF EXISTS tr_preguntas_upd ON preguntas_encuesta;
CREATE TRIGGER tr_preguntas_upd BEFORE UPDATE ON preguntas_encuesta
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

INSERT INTO preguntas_encuesta (codigo, texto, ayuda, tipo, opciones, dirigida_a, orden) VALUES
  ('PUNTUALIDAD',   '¿Llegó a la hora acordada?',                     NULL, 'ESTRELLAS', '{}', 'CLIENTE', 1),
  ('CALIDAD',       '¿Qué tan bien quedó el trabajo?',                NULL, 'ESTRELLAS', '{}', 'CLIENTE', 2),
  ('TRATO',         '¿Cómo fue el trato de la conserje?',             NULL, 'ESTRELLAS', '{}', 'CLIENTE', 3),
  ('CUIDADO',       '¿Cuidó tus cosas y tu espacio?',                 NULL, 'ESTRELLAS', '{}', 'CLIENTE', 4),
  ('ZONAS',         '¿Qué zona quedó mejor?',                         'Nos sirve para saber en qué somos fuertes.', 'OPCIONES',
   ARRAY['Cocina','Baños','Habitaciones','Sala y comedor','Zona de ropa','Exteriores'], 'CLIENTE', 5),
  ('FALTO',         '¿Quedó algo por hacer?',                         'Si algo faltó, cuéntanos qué.', 'TEXTO', '{}', 'CLIENTE', 6),
  ('APP_FACILIDAD', '¿Qué tan fácil te resultó pedir el servicio en la app?', NULL, 'ESTRELLAS', '{}', 'CLIENTE', 7),
  ('APP_MEJORA',    '¿Qué le cambiarías a la app?',                   'Lo leemos todo.', 'TEXTO', '{}', 'CLIENTE', 8),
  ('RECOMENDARIA',  '¿Nos recomendarías a un amigo?',                 NULL, 'SI_NO', '{}', 'CLIENTE', 9),
  ('REPETIRIA',     '¿Volverías a pedir con la misma conserje?',      NULL, 'SI_NO', '{}', 'CLIENTE', 10),
  -- Lo que responde la conserje sobre el servicio y el cliente
  ('ACCESO',        '¿Cómo fue el acceso al lugar?',                  NULL, 'ESTRELLAS', '{}', 'CONCERJE', 1),
  ('ESTADO_INICIAL','¿Cómo encontraste el lugar al llegar?',          NULL, 'ESCALA', '{}', 'CONCERJE', 2),
  ('INSUMOS_OK',    '¿Había insumos suficientes?',                    NULL, 'SI_NO', '{}', 'CONCERJE', 3),
  ('TRATO_CLIENTE', '¿Cómo fue el trato del cliente?',                NULL, 'ESTRELLAS', '{}', 'CONCERJE', 4),
  ('TIEMPO_OK',     '¿El tiempo asignado alcanzó?',                   NULL, 'SI_NO', '{}', 'CONCERJE', 5),
  ('OBSERVACION',   '¿Algo que debamos saber para la próxima?',       NULL, 'TEXTO', '{}', 'CONCERJE', 6)
ON CONFLICT (codigo) DO NOTHING;

CREATE TABLE IF NOT EXISTS respuestas_encuesta (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  solicitud_id UUID NOT NULL REFERENCES solicitudes_servicio_hogar(id) ON DELETE CASCADE,
  pregunta_id  UUID NOT NULL REFERENCES preguntas_encuesta(id) ON DELETE CASCADE,
  dirigida_a   VARCHAR(10) NOT NULL DEFAULT 'CLIENTE',
  respondida_por UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  valor_num    NUMERIC(5,2),
  valor_texto  TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW(),

  CONSTRAINT respuesta_unica UNIQUE (solicitud_id, pregunta_id, dirigida_a)
);
CREATE INDEX IF NOT EXISTS idx_respuestas_solicitud ON respuestas_encuesta(solicitud_id, dirigida_a);

-- =============================================================================
-- 4. NO CONFORMIDADES Y REPORTES DEL CLIENTE
-- =============================================================================
CREATE TABLE IF NOT EXISTS casos_servicio (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  numero        VARCHAR(30) UNIQUE NOT NULL,
  solicitud_id  UUID REFERENCES solicitudes_servicio_hogar(id) ON DELETE SET NULL,
  cliente_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tipo          VARCHAR(20) NOT NULL DEFAULT 'NO_CONFORMIDAD',
  -- NO_CONFORMIDAD | QUEJA | RECLAMO | SUGERENCIA | FELICITACION
  categoria     VARCHAR(40),
  -- CALIDAD | PUNTUALIDAD | TRATO | DANO | FALTANTE | COBRO | APP | OTRO
  asunto        VARCHAR(200) NOT NULL,
  descripcion   TEXT NOT NULL,
  severidad     VARCHAR(10) NOT NULL DEFAULT 'MEDIA',   -- BAJA | MEDIA | ALTA
  estado        VARCHAR(20) NOT NULL DEFAULT 'ABIERTO',
  -- ABIERTO | EN_REVISION | RESUELTO | CERRADO | RECHAZADO
  asignado_a    UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  resuelto_por  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  resuelto_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW(),

  CONSTRAINT caso_tipo      CHECK (tipo IN ('NO_CONFORMIDAD','QUEJA','RECLAMO','SUGERENCIA','FELICITACION')),
  CONSTRAINT caso_severidad CHECK (severidad IN ('BAJA','MEDIA','ALTA')),
  CONSTRAINT caso_estado    CHECK (estado IN ('ABIERTO','EN_REVISION','RESUELTO','CERRADO','RECHAZADO'))
);
CREATE INDEX IF NOT EXISTS idx_casos_cliente ON casos_servicio(cliente_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_casos_estado  ON casos_servicio(estado, severidad, created_at DESC);

DROP TRIGGER IF EXISTS tr_casos_upd ON casos_servicio;
CREATE TRIGGER tr_casos_upd BEFORE UPDATE ON casos_servicio
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Hilo de conversación del caso: el cliente pregunta, la empresa responde.
CREATE TABLE IF NOT EXISTS caso_mensajes (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  caso_id    UUID NOT NULL REFERENCES casos_servicio(id) ON DELETE CASCADE,
  autor_id   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  autor_tipo VARCHAR(10) NOT NULL DEFAULT 'CLIENTE',   -- CLIENTE | STAFF
  mensaje    TEXT NOT NULL,
  interno    BOOLEAN NOT NULL DEFAULT false,   -- nota que el cliente no ve
  created_at TIMESTAMPTZ DEFAULT NOW(),

  CONSTRAINT mensaje_autor CHECK (autor_tipo IN ('CLIENTE','STAFF'))
);
CREATE INDEX IF NOT EXISTS idx_caso_mensajes ON caso_mensajes(caso_id, created_at);

-- Ahora que existe `casos_servicio`, la foto puede apuntarle.
ALTER TABLE fotos_servicio
  DROP CONSTRAINT IF EXISTS fotos_servicio_caso_id_fkey;
ALTER TABLE fotos_servicio
  ADD CONSTRAINT fotos_servicio_caso_id_fkey
  FOREIGN KEY (caso_id) REFERENCES casos_servicio(id) ON DELETE CASCADE;

CREATE OR REPLACE FUNCTION public.siguiente_numero_caso()
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE n INTEGER;
BEGIN
  SELECT COUNT(*) + 1 INTO n FROM casos_servicio WHERE created_at >= DATE_TRUNC('year', NOW());
  RETURN 'NC-' || TO_CHAR(NOW(), 'YYYY') || '-' || LPAD(n::TEXT, 5, '0');
END $fn$;

-- =============================================================================
-- 5. PUNTOS POR CALIFICAR Y POR LLENAR LA ENCUESTA
-- =============================================================================
ALTER TABLE parametros_puntos
  ADD COLUMN IF NOT EXISTS puntos_encuesta_completa INTEGER NOT NULL DEFAULT 30;

-- Ni la reseña ni la encuesta pueden pagar dos veces por el mismo servicio.
CREATE UNIQUE INDEX IF NOT EXISTS idx_mov_puntos_resena
  ON movimientos_puntos(solicitud_id) WHERE solicitud_id IS NOT NULL AND origen = 'RESENA';
CREATE UNIQUE INDEX IF NOT EXISTS idx_mov_puntos_encuesta
  ON movimientos_puntos(solicitud_id) WHERE solicitud_id IS NOT NULL AND origen = 'ENCUESTA';

-- Al calificar el servicio por primera vez, se otorgan los puntos de reseña y
-- se recalcula el promedio de la conserje.
CREATE OR REPLACE FUNCTION public.al_calificar_servicio()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE v_param RECORD;
BEGIN
  IF NEW.calificacion IS NULL OR OLD.calificacion IS NOT NULL THEN RETURN NEW; END IF;

  SELECT * INTO v_param FROM parametros_puntos WHERE codigo = 'DEFAULT';
  IF FOUND AND v_param.activo AND v_param.puntos_por_resena > 0 AND NEW.cliente_id IS NOT NULL THEN
    PERFORM public.otorgar_puntos(
      NEW.cliente_id, v_param.puntos_por_resena, 'RESENA',
      'Calificaste el servicio ' || NEW.numero, NEW.id, NULL
    );
  END IF;

  -- El promedio de la conserje sale de los servicios que ya se calificaron.
  IF NEW.concerje_id IS NOT NULL THEN
    UPDATE concerjes_hogar c SET
      calificacion_prom = COALESCE((
        SELECT ROUND(AVG(s.calificacion)::numeric, 2) FROM solicitudes_servicio_hogar s
         WHERE s.concerje_id = c.id AND s.calificacion IS NOT NULL), 0),
      servicios_count = (
        SELECT COUNT(*) FROM solicitudes_servicio_hogar s
         WHERE s.concerje_id = c.id AND s.estado = 'COMPLETADA')
    WHERE c.id = NEW.concerje_id;
  END IF;

  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS tr_al_calificar ON solicitudes_servicio_hogar;
CREATE TRIGGER tr_al_calificar
  AFTER UPDATE OF calificacion ON solicitudes_servicio_hogar
  FOR EACH ROW EXECUTE FUNCTION public.al_calificar_servicio();

-- Al responder, si ya no queda ninguna pregunta activa del cliente sin
-- responder, se otorgan los puntos de encuesta completa. Una sola vez.
CREATE OR REPLACE FUNCTION public.al_responder_encuesta()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_param    RECORD;
  v_faltan   INTEGER;
  v_cliente  UUID;
  v_numero   TEXT;
BEGIN
  IF NEW.dirigida_a <> 'CLIENTE' THEN RETURN NEW; END IF;

  SELECT * INTO v_param FROM parametros_puntos WHERE codigo = 'DEFAULT';
  IF NOT FOUND OR NOT v_param.activo OR v_param.puntos_encuesta_completa <= 0 THEN RETURN NEW; END IF;

  SELECT COUNT(*) INTO v_faltan
    FROM preguntas_encuesta p
   WHERE p.activo AND p.dirigida_a = 'CLIENTE'
     AND NOT EXISTS (
       SELECT 1 FROM respuestas_encuesta r
        WHERE r.pregunta_id = p.id AND r.solicitud_id = NEW.solicitud_id AND r.dirigida_a = 'CLIENTE'
          -- Una respuesta vacía no cuenta como respondida.
          AND (r.valor_num IS NOT NULL OR COALESCE(TRIM(r.valor_texto), '') <> '')
     );
  IF v_faltan > 0 THEN RETURN NEW; END IF;

  SELECT cliente_id, numero INTO v_cliente, v_numero
    FROM solicitudes_servicio_hogar WHERE id = NEW.solicitud_id;
  IF v_cliente IS NULL THEN RETURN NEW; END IF;

  PERFORM public.otorgar_puntos(
    v_cliente, v_param.puntos_encuesta_completa, 'ENCUESTA',
    'Respondiste toda la encuesta del servicio ' || COALESCE(v_numero, ''), NEW.solicitud_id, NULL
  );
  PERFORM public.avisar_cliente(
    v_cliente, 'SISTEMA', 'Gracias por responder',
    'Sumaste ' || v_param.puntos_encuesta_completa || ' puntos por contarnos cómo te fue.',
    '/portal/puntos'
  );
  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS tr_al_responder_encuesta ON respuestas_encuesta;
CREATE TRIGGER tr_al_responder_encuesta
  AFTER INSERT OR UPDATE ON respuestas_encuesta
  FOR EACH ROW EXECUTE FUNCTION public.al_responder_encuesta();

-- El reporte enviado califica al cliente: se refleja en calificaciones_cliente,
-- que ya tiene su propio trigger de promedio.
CREATE OR REPLACE FUNCTION public.al_enviar_reporte()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE v_cliente UUID;
BEGIN
  IF NEW.estado <> 'ENVIADO' OR COALESCE(OLD.estado, '') = 'ENVIADO' THEN RETURN NEW; END IF;
  IF NEW.calificacion_cliente IS NULL THEN RETURN NEW; END IF;

  SELECT cliente_id INTO v_cliente FROM solicitudes_servicio_hogar WHERE id = NEW.solicitud_id;
  IF v_cliente IS NULL THEN RETURN NEW; END IF;

  INSERT INTO calificaciones_cliente (cliente_id, concerje_id, solicitud_id, calificacion, comentario)
  VALUES (v_cliente, NEW.concerje_id, NEW.solicitud_id, NEW.calificacion_cliente, NEW.comentario_cliente)
  ON CONFLICT DO NOTHING;

  PERFORM public.avisar_cliente(
    v_cliente, 'SERVICIO', 'Ya está el reporte de tu servicio',
    'La conserje dejó el detalle de lo que hizo. Míralo y cuéntanos cómo te fue.',
    '/portal/servicios/' || NEW.solicitud_id::TEXT
  );
  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS tr_al_enviar_reporte ON reportes_servicio;
CREATE TRIGGER tr_al_enviar_reporte
  AFTER INSERT OR UPDATE OF estado ON reportes_servicio
  FOR EACH ROW EXECUTE FUNCTION public.al_enviar_reporte();

-- =============================================================================
-- STORAGE: fotos del servicio (privado)
-- =============================================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('fotos-servicio', 'fotos-servicio', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS fs_sube  ON storage.objects;
DROP POLICY IF EXISTS fs_lee   ON storage.objects;
DROP POLICY IF EXISTS fs_borra ON storage.objects;
-- Cada quien escribe dentro de su propia carpeta (el uid de quien sube).
CREATE POLICY fs_sube ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'fotos-servicio'
              AND (storage.foldername(name))[1] = (SELECT auth.uid())::text);
-- Para leer basta estar autenticado: qué foto se puede ver lo decide la fila de
-- `fotos_servicio`, que sí está filtrada por RLS, y la app pide URLs firmadas
-- solo de las filas que el usuario alcanza a ver.
CREATE POLICY fs_lee ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'fotos-servicio');
CREATE POLICY fs_borra ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'fotos-servicio'
         AND (storage.foldername(name))[1] = (SELECT auth.uid())::text);

-- =============================================================================
-- RLS
-- =============================================================================
ALTER TABLE reportes_servicio   ENABLE ROW LEVEL SECURITY;
ALTER TABLE fotos_servicio      ENABLE ROW LEVEL SECURITY;
ALTER TABLE preguntas_encuesta  ENABLE ROW LEVEL SECURITY;
ALTER TABLE respuestas_encuesta ENABLE ROW LEVEL SECURITY;
ALTER TABLE casos_servicio      ENABLE ROW LEVEL SECURITY;
ALTER TABLE caso_mensajes       ENABLE ROW LEVEL SECURITY;

-- ── Reportes ─────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS rep_concerje ON reportes_servicio;
DROP POLICY IF EXISTS rep_cliente  ON reportes_servicio;
DROP POLICY IF EXISTS rep_staff    ON reportes_servicio;
-- La conserje gestiona el reporte de los servicios que le asignaron.
CREATE POLICY rep_concerje ON reportes_servicio FOR ALL TO authenticated
  USING (concerje_id IS NOT NULL AND concerje_id = public.mi_concerje_id())
  WITH CHECK (concerje_id IS NOT NULL AND concerje_id = public.mi_concerje_id());
-- El cliente lo lee solo cuando ya se envió; un borrador no es para sus ojos.
CREATE POLICY rep_cliente ON reportes_servicio FOR SELECT TO authenticated
  USING (estado = 'ENVIADO' AND EXISTS (
    SELECT 1 FROM solicitudes_servicio_hogar s
     WHERE s.id = solicitud_id AND s.cliente_id = (SELECT auth.uid())));
CREATE POLICY rep_staff ON reportes_servicio FOR ALL TO authenticated
  USING (public.auth_permiso('gestionar_solicitudes_hogar'))
  WITH CHECK (public.auth_permiso('gestionar_solicitudes_hogar'));

-- ── Fotos ────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS fot_cliente     ON fotos_servicio;
DROP POLICY IF EXISTS fot_cliente_ins ON fotos_servicio;
DROP POLICY IF EXISTS fot_concerje    ON fotos_servicio;
DROP POLICY IF EXISTS fot_staff       ON fotos_servicio;
CREATE POLICY fot_cliente ON fotos_servicio FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM solicitudes_servicio_hogar s
                  WHERE s.id = solicitud_id AND s.cliente_id = (SELECT auth.uid()))
         OR EXISTS (SELECT 1 FROM casos_servicio c
                     WHERE c.id = caso_id AND c.cliente_id = (SELECT auth.uid())));
CREATE POLICY fot_cliente_ins ON fotos_servicio FOR INSERT TO authenticated
  WITH CHECK (subido_por = (SELECT auth.uid()) AND autor = 'CLIENTE'
              AND (EXISTS (SELECT 1 FROM solicitudes_servicio_hogar s
                            WHERE s.id = solicitud_id AND s.cliente_id = (SELECT auth.uid()))
                OR EXISTS (SELECT 1 FROM casos_servicio c
                            WHERE c.id = caso_id AND c.cliente_id = (SELECT auth.uid()))));
CREATE POLICY fot_concerje ON fotos_servicio FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM solicitudes_servicio_hogar s
                  WHERE s.id = solicitud_id AND s.concerje_id = public.mi_concerje_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM solicitudes_servicio_hogar s
                       WHERE s.id = solicitud_id AND s.concerje_id = public.mi_concerje_id()));
CREATE POLICY fot_staff ON fotos_servicio FOR ALL TO authenticated
  USING (public.auth_permiso('gestionar_solicitudes_hogar'))
  WITH CHECK (public.auth_permiso('gestionar_solicitudes_hogar'));

-- ── Preguntas ────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS preg_lee   ON preguntas_encuesta;
DROP POLICY IF EXISTS preg_admin ON preguntas_encuesta;
CREATE POLICY preg_lee ON preguntas_encuesta FOR SELECT USING (activo);
CREATE POLICY preg_admin ON preguntas_encuesta FOR ALL TO authenticated
  USING (public.auth_permiso('parametrizar_encuesta'))
  WITH CHECK (public.auth_permiso('parametrizar_encuesta'));

-- ── Respuestas ───────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS resp_cliente  ON respuestas_encuesta;
DROP POLICY IF EXISTS resp_concerje ON respuestas_encuesta;
DROP POLICY IF EXISTS resp_staff    ON respuestas_encuesta;
CREATE POLICY resp_cliente ON respuestas_encuesta FOR ALL TO authenticated
  USING (dirigida_a = 'CLIENTE' AND EXISTS (
    SELECT 1 FROM solicitudes_servicio_hogar s
     WHERE s.id = solicitud_id AND s.cliente_id = (SELECT auth.uid())))
  WITH CHECK (dirigida_a = 'CLIENTE' AND EXISTS (
    SELECT 1 FROM solicitudes_servicio_hogar s
     WHERE s.id = solicitud_id AND s.cliente_id = (SELECT auth.uid())));
CREATE POLICY resp_concerje ON respuestas_encuesta FOR ALL TO authenticated
  USING (dirigida_a = 'CONCERJE' AND EXISTS (
    SELECT 1 FROM solicitudes_servicio_hogar s
     WHERE s.id = solicitud_id AND s.concerje_id = public.mi_concerje_id()))
  WITH CHECK (dirigida_a = 'CONCERJE' AND EXISTS (
    SELECT 1 FROM solicitudes_servicio_hogar s
     WHERE s.id = solicitud_id AND s.concerje_id = public.mi_concerje_id()));
CREATE POLICY resp_staff ON respuestas_encuesta FOR SELECT TO authenticated
  USING (public.auth_permiso('gestionar_solicitudes_hogar'));

-- ── Casos ────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS caso_cliente     ON casos_servicio;
DROP POLICY IF EXISTS caso_cliente_ins ON casos_servicio;
DROP POLICY IF EXISTS caso_staff       ON casos_servicio;
CREATE POLICY caso_cliente ON casos_servicio FOR SELECT TO authenticated
  USING (cliente_id = (SELECT auth.uid()));
-- El cliente abre casos, pero no cambia su estado ni se los asigna a nadie.
CREATE POLICY caso_cliente_ins ON casos_servicio FOR INSERT TO authenticated
  WITH CHECK (cliente_id = (SELECT auth.uid()) AND estado = 'ABIERTO');
CREATE POLICY caso_staff ON casos_servicio FOR ALL TO authenticated
  USING (public.auth_permiso('gestionar_casos_hogar'))
  WITH CHECK (public.auth_permiso('gestionar_casos_hogar'));

DROP POLICY IF EXISTS msj_cliente     ON caso_mensajes;
DROP POLICY IF EXISTS msj_cliente_ins ON caso_mensajes;
DROP POLICY IF EXISTS msj_staff       ON caso_mensajes;
-- Las notas internas no las ve el cliente.
CREATE POLICY msj_cliente ON caso_mensajes FOR SELECT TO authenticated
  USING (NOT interno AND EXISTS (
    SELECT 1 FROM casos_servicio c WHERE c.id = caso_id AND c.cliente_id = (SELECT auth.uid())));
CREATE POLICY msj_cliente_ins ON caso_mensajes FOR INSERT TO authenticated
  WITH CHECK (autor_tipo = 'CLIENTE' AND NOT interno AND autor_id = (SELECT auth.uid())
              AND EXISTS (SELECT 1 FROM casos_servicio c
                           WHERE c.id = caso_id AND c.cliente_id = (SELECT auth.uid())));
CREATE POLICY msj_staff ON caso_mensajes FOR ALL TO authenticated
  USING (public.auth_permiso('gestionar_casos_hogar'))
  WITH CHECK (public.auth_permiso('gestionar_casos_hogar'));

-- =============================================================================
-- PERMISOS DE ROL
-- =============================================================================
UPDATE public.roles
SET permisos = permisos || '{
  "ver_casos_hogar": true,
  "gestionar_casos_hogar": true,
  "parametrizar_encuesta": true,
  "ver_reportes_servicio": true
}'::jsonb
WHERE rol_base IN ('SUPER_ADMIN','ADMIN','SUPERVISOR');

UPDATE public.roles
SET permisos = permisos || '{"ver_casos_hogar": true, "gestionar_casos_hogar": true, "ver_reportes_servicio": true}'::jsonb
WHERE rol_base = 'COORDINADOR_COMPRAS';

-- =============================================================================
-- Conserjes Inmobiliarios — Notificaciones: correo parametrizable, plantillas
-- y motor de eventos (workflow).
--
-- Qué agrega:
--   1) integraciones_correo → método de autenticación: contraseña (SMTP clásico)
--      u OAuth 2.0 (Google / Microsoft), con tokens y cuenta predeterminada.
--   2) plantillas_correo    → plantillas de correo (editor o archivo HTML subido)
--      con variables {{ }} y previsualización.
--   3) eventos_notificacion → catálogo de eventos del sistema, con descripción y
--      variables disponibles. Es la "lista de eventos" que se parametriza.
--   4) flujos_notificacion + flujo_pasos → workflows: cuando ocurre el evento X y
--      se cumplen las condiciones, ejecuta pasos en orden (correo con plantilla,
--      notificación en la app, espera, webhook). Cada paso puede tener demora y
--      una VERIFICACIÓN de estado ("si a las 24 h sigue PENDIENTE, escala").
--   5) flujo_ejecuciones + flujo_ejecucion_pasos → trazabilidad de cada disparo.
--   6) emitir_evento()      → punto de entrada del motor (triggers o código app).
--
-- El worker que ejecuta los pasos vencidos vive en /api/cron/flujos.
--
-- IDEMPOTENTE: puede correrse sobre BD nueva o re-aplicarse sin romper nada.
-- =============================================================================

SET search_path TO public;

-- Helpers de rol y permiso (por si alguna migración previa no se aplicó) -------
CREATE OR REPLACE FUNCTION public.auth_rol()
RETURNS rol_usuario
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT rol FROM public.usuarios WHERE id = (SELECT auth.uid()) $$;

CREATE OR REPLACE FUNCTION public.auth_permiso(p_key TEXT)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE((
    SELECT u.rol IN ('SUPER_ADMIN', 'ADMIN')
        OR COALESCE(u.permisos ->> p_key, r.permisos ->> p_key) = 'true'
    FROM public.usuarios u
    LEFT JOIN public.roles r ON r.id = u.rol_id
    WHERE u.id = (SELECT auth.uid())
  ), false)
$$;

CREATE OR REPLACE FUNCTION public.auth_permiso_any(p_keys TEXT[])
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE((
    SELECT u.rol IN ('SUPER_ADMIN', 'ADMIN')
        OR EXISTS (
             SELECT 1 FROM unnest(p_keys) AS k
             WHERE COALESCE(u.permisos ->> k, r.permisos ->> k) = 'true'
           )
    FROM public.usuarios u
    LEFT JOIN public.roles r ON r.id = u.rol_id
    WHERE u.id = (SELECT auth.uid())
  ), false)
$$;

GRANT EXECUTE ON FUNCTION public.auth_permiso(TEXT)       TO authenticated;
GRANT EXECUTE ON FUNCTION public.auth_permiso_any(TEXT[]) TO authenticated;

-- =============================================================================
-- 1) CORREO: método de autenticación (contraseña u OAuth)
-- =============================================================================
ALTER TABLE integraciones_correo
  ADD COLUMN IF NOT EXISTS auth_tipo           VARCHAR(20)  DEFAULT 'PASSWORD', -- PASSWORD | OAUTH2
  ADD COLUMN IF NOT EXISTS oauth_proveedor     VARCHAR(20),                     -- GOOGLE | MICROSOFT
  ADD COLUMN IF NOT EXISTS oauth_client_id     TEXT,
  ADD COLUMN IF NOT EXISTS oauth_client_secret TEXT,
  ADD COLUMN IF NOT EXISTS oauth_tenant        VARCHAR(120) DEFAULT 'common',   -- solo Microsoft
  ADD COLUMN IF NOT EXISTS oauth_refresh_token TEXT,
  ADD COLUMN IF NOT EXISTS oauth_access_token  TEXT,
  ADD COLUMN IF NOT EXISTS oauth_expira_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS oauth_scope         TEXT,
  ADD COLUMN IF NOT EXISTS oauth_cuenta        VARCHAR(200),                    -- correo devuelto por el proveedor
  ADD COLUMN IF NOT EXISTS predeterminada      BOOLEAN      DEFAULT true;       -- cuenta usada por defecto

COMMENT ON COLUMN integraciones_correo.auth_tipo IS
  'PASSWORD = usuario + contraseña de aplicación. OAUTH2 = autorización con Google/Microsoft (XOAUTH2).';

-- Una sola cuenta predeterminada: deja la más antigua y desmarca el resto antes
-- de crear el índice (si ya hubiera varias cuentas configuradas).
UPDATE integraciones_correo SET predeterminada = false
WHERE predeterminada IS DISTINCT FROM false
  AND id <> (SELECT id FROM integraciones_correo ORDER BY created_at, id LIMIT 1);

CREATE UNIQUE INDEX IF NOT EXISTS uq_integr_correo_predeterminada
  ON integraciones_correo (predeterminada) WHERE predeterminada;

-- =============================================================================
-- 2) BUZÓN DE SALIDA: cuerpo HTML, plantilla usada y trazabilidad del flujo
-- =============================================================================
ALTER TABLE correo_saliente
  ADD COLUMN IF NOT EXISTS cuerpo_html       TEXT,
  ADD COLUMN IF NOT EXISTS copia             TEXT,   -- CC separados por coma
  ADD COLUMN IF NOT EXISTS copia_oculta      TEXT,   -- BCC separados por coma
  ADD COLUMN IF NOT EXISTS plantilla_codigo  VARCHAR(80),
  ADD COLUMN IF NOT EXISTS cuenta_id         UUID,   -- integraciones_correo.id (NULL = predeterminada)
  ADD COLUMN IF NOT EXISTS ejecucion_paso_id UUID;

-- =============================================================================
-- 3) PLANTILLAS DE CORREO
-- =============================================================================
CREATE TABLE IF NOT EXISTS plantillas_correo (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo         VARCHAR(80) UNIQUE NOT NULL,      -- slug estable: 'bienvenida'
  nombre         VARCHAR(150) NOT NULL,
  descripcion    TEXT,
  categoria      VARCHAR(60) DEFAULT 'General',
  asunto         VARCHAR(300) NOT NULL,
  cuerpo_html    TEXT NOT NULL,
  cuerpo_texto   TEXT,                             -- alternativa en texto plano
  variables      JSONB NOT NULL DEFAULT '[]',      -- [{clave, descripcion, ejemplo}]
  origen         VARCHAR(20) NOT NULL DEFAULT 'EDITOR', -- EDITOR | ARCHIVO
  archivo_nombre VARCHAR(200),                     -- nombre del .html subido
  activa         BOOLEAN NOT NULL DEFAULT true,
  es_sistema     BOOLEAN NOT NULL DEFAULT false,   -- plantilla base: no se borra
  creado_por     UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_plantillas_correo_activa ON plantillas_correo(activa, categoria);

DROP TRIGGER IF EXISTS tr_plantillas_correo_upd ON plantillas_correo;
CREATE TRIGGER tr_plantillas_correo_upd BEFORE UPDATE ON plantillas_correo
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =============================================================================
-- 4) CATÁLOGO DE EVENTOS
-- =============================================================================
CREATE TABLE IF NOT EXISTS eventos_notificacion (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo          VARCHAR(80) UNIQUE NOT NULL,     -- 'ORDEN_INSUMO_APROBADA'
  nombre          VARCHAR(150) NOT NULL,
  descripcion     TEXT,
  modulo          VARCHAR(60) DEFAULT 'General',
  variables       JSONB NOT NULL DEFAULT '[]',     -- [{clave, descripcion}] del payload
  payload_ejemplo JSONB NOT NULL DEFAULT '{}',
  activo          BOOLEAN NOT NULL DEFAULT true,
  es_sistema      BOOLEAN NOT NULL DEFAULT true,   -- emitido por la plataforma
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_eventos_notif_modulo ON eventos_notificacion(modulo, activo);

DROP TRIGGER IF EXISTS tr_eventos_notif_upd ON eventos_notificacion;
CREATE TRIGGER tr_eventos_notif_upd BEFORE UPDATE ON eventos_notificacion
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =============================================================================
-- 5) FLUJOS (workflow) Y SUS PASOS
-- =============================================================================
CREATE TABLE IF NOT EXISTS flujos_notificacion (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo        VARCHAR(80) UNIQUE NOT NULL,
  nombre        VARCHAR(150) NOT NULL,
  descripcion   TEXT,
  evento_codigo VARCHAR(80) NOT NULL REFERENCES eventos_notificacion(codigo) ON UPDATE CASCADE ON DELETE CASCADE,
  -- Condiciones sobre el payload del evento:
  -- {"modo":"AND","reglas":[{"campo":"estado","operador":"=","valor":"PENDIENTE"}]}
  condiciones   JSONB NOT NULL DEFAULT '{"modo":"AND","reglas":[]}',
  activo        BOOLEAN NOT NULL DEFAULT true,
  prioridad     INTEGER NOT NULL DEFAULT 100,
  creado_por    UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_flujos_evento ON flujos_notificacion(evento_codigo, activo);

DROP TRIGGER IF EXISTS tr_flujos_notif_upd ON flujos_notificacion;
CREATE TRIGGER tr_flujos_notif_upd BEFORE UPDATE ON flujos_notificacion
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS flujo_pasos (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  flujo_id       UUID NOT NULL REFERENCES flujos_notificacion(id) ON DELETE CASCADE,
  orden          INTEGER NOT NULL DEFAULT 1,
  nombre         VARCHAR(150),
  tipo           VARCHAR(20) NOT NULL DEFAULT 'EMAIL',  -- EMAIL | APP | ESPERA | WEBHOOK
  demora_minutos INTEGER NOT NULL DEFAULT 0,            -- se ejecuta N minutos después del disparo
  -- Correo -------------------------------------------------------------------
  plantilla_id   UUID REFERENCES plantillas_correo(id) ON DELETE SET NULL,
  asunto         VARCHAR(300),                          -- reemplaza el de la plantilla
  mensaje        TEXT,                                  -- cuerpo libre si no hay plantilla
  -- Destinatarios:
  -- {"roles":["ADMIN"],"usuarios":["uuid"],"correos":["a@b.com"],"campos":["cliente_email"]}
  destinatarios  JSONB NOT NULL DEFAULT '{"roles":[],"usuarios":[],"correos":[],"campos":[]}',
  -- Notificación en la app ---------------------------------------------------
  severidad      severidad_notificacion NOT NULL DEFAULT 'INFO',
  enlace         VARCHAR(400),
  -- Webhook ------------------------------------------------------------------
  webhook_url    VARCHAR(400),
  -- "Si sigue pasando algo": antes de ejecutar el paso se relee el registro y
  -- solo continúa si la condición se cumple. Formato:
  -- {"tabla":"ordenes_insumo","columna_id":"id","campo_payload":"orden_id",
  --  "campo":"estado","operador":"=","valor":"PENDIENTE"}
  verificacion   JSONB NOT NULL DEFAULT '{}',
  detener_si_falla BOOLEAN NOT NULL DEFAULT true,       -- si la verificación falla, ¿cancela el resto?
  activo         BOOLEAN NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_flujo_pasos_flujo ON flujo_pasos(flujo_id, orden);

DROP TRIGGER IF EXISTS tr_flujo_pasos_upd ON flujo_pasos;
CREATE TRIGGER tr_flujo_pasos_upd BEFORE UPDATE ON flujo_pasos
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =============================================================================
-- 6) EJECUCIONES (trazabilidad)
-- =============================================================================
CREATE TABLE IF NOT EXISTS flujo_ejecuciones (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  flujo_id      UUID NOT NULL REFERENCES flujos_notificacion(id) ON DELETE CASCADE,
  evento_codigo VARCHAR(80) NOT NULL,
  payload       JSONB NOT NULL DEFAULT '{}',
  entidad       VARCHAR(80),
  entidad_id    TEXT,
  estado        VARCHAR(20) NOT NULL DEFAULT 'EN_CURSO', -- EN_CURSO | COMPLETADA | CANCELADA | ERROR
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_flujo_ejec_estado ON flujo_ejecuciones(estado, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_flujo_ejec_flujo  ON flujo_ejecuciones(flujo_id, created_at DESC);

DROP TRIGGER IF EXISTS tr_flujo_ejec_upd ON flujo_ejecuciones;
CREATE TRIGGER tr_flujo_ejec_upd BEFORE UPDATE ON flujo_ejecuciones
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS flujo_ejecucion_pasos (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ejecucion_id    UUID NOT NULL REFERENCES flujo_ejecuciones(id) ON DELETE CASCADE,
  paso_id         UUID REFERENCES flujo_pasos(id) ON DELETE SET NULL,
  orden           INTEGER NOT NULL DEFAULT 1,
  estado          VARCHAR(20) NOT NULL DEFAULT 'PROGRAMADO', -- PROGRAMADO | EJECUTADO | OMITIDO | ERROR
  programado_para TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ejecutado_at    TIMESTAMPTZ,
  intentos        INTEGER NOT NULL DEFAULT 0,
  resultado       TEXT,
  detalle         JSONB NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_flujo_ejec_pasos_pend
  ON flujo_ejecucion_pasos(estado, programado_para) WHERE estado = 'PROGRAMADO';
CREATE INDEX IF NOT EXISTS idx_flujo_ejec_pasos_ejec
  ON flujo_ejecucion_pasos(ejecucion_id, orden);

-- =============================================================================
-- 7) MOTOR: evaluación de condiciones y emisión de eventos
-- =============================================================================

-- Lee un campo del payload por ruta con puntos ('cliente.email').
CREATE OR REPLACE FUNCTION public.payload_valor(p_payload JSONB, p_campo TEXT)
RETURNS TEXT
LANGUAGE sql IMMUTABLE
AS $$ SELECT p_payload #>> string_to_array(COALESCE(p_campo, ''), '.') $$;

-- Compara dos valores con el operador indicado. Numérico si ambos lo son.
CREATE OR REPLACE FUNCTION public.comparar_valor(p_actual TEXT, p_operador TEXT, p_esperado TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql IMMUTABLE
AS $$
DECLARE
  a NUMERIC; b NUMERIC; numerico BOOLEAN := false;
BEGIN
  IF p_operador = 'existe' THEN RETURN p_actual IS NOT NULL AND p_actual <> ''; END IF;
  IF p_operador = 'vacio'  THEN RETURN p_actual IS NULL OR p_actual = '';      END IF;
  IF p_actual IS NULL THEN RETURN p_operador = '!='; END IF;

  BEGIN
    a := p_actual::NUMERIC; b := p_esperado::NUMERIC; numerico := true;
  EXCEPTION WHEN OTHERS THEN numerico := false;
  END;

  RETURN CASE p_operador
    WHEN '='           THEN CASE WHEN numerico THEN a =  b ELSE lower(p_actual) =  lower(COALESCE(p_esperado, '')) END
    WHEN '!='          THEN CASE WHEN numerico THEN a <> b ELSE lower(p_actual) <> lower(COALESCE(p_esperado, '')) END
    WHEN '>'           THEN numerico AND a >  b
    WHEN '>='          THEN numerico AND a >= b
    WHEN '<'           THEN numerico AND a <  b
    WHEN '<='          THEN numerico AND a <= b
    WHEN 'contiene'    THEN position(lower(COALESCE(p_esperado, '')) IN lower(p_actual)) > 0
    WHEN 'no_contiene' THEN position(lower(COALESCE(p_esperado, '')) IN lower(p_actual)) = 0
    WHEN 'en'          THEN lower(p_actual) = ANY (string_to_array(lower(COALESCE(p_esperado, '')), ','))
    ELSE false
  END;
END $$;

-- Evalúa {"modo":"AND|OR","reglas":[{campo,operador,valor}]} contra el payload.
-- Sin reglas → TRUE (el flujo aplica siempre que ocurra el evento).
CREATE OR REPLACE FUNCTION public.evaluar_condiciones(p_cond JSONB, p_payload JSONB)
RETURNS BOOLEAN
LANGUAGE plpgsql IMMUTABLE
AS $$
DECLARE
  r      JSONB;
  modo   TEXT    := upper(COALESCE(p_cond ->> 'modo', 'AND'));
  reglas JSONB   := COALESCE(p_cond -> 'reglas', '[]'::JSONB);
  ok     BOOLEAN;
  alguno BOOLEAN := false;
BEGIN
  IF jsonb_array_length(reglas) = 0 THEN RETURN true; END IF;

  FOR r IN SELECT * FROM jsonb_array_elements(reglas) LOOP
    ok := public.comparar_valor(
      public.payload_valor(p_payload, r ->> 'campo'),
      COALESCE(r ->> 'operador', '='),
      r ->> 'valor'
    );
    IF modo = 'OR' THEN
      alguno := alguno OR ok;
    ELSIF NOT ok THEN
      RETURN false;
    END IF;
  END LOOP;

  RETURN CASE WHEN modo = 'OR' THEN alguno ELSE true END;
EXCEPTION WHEN OTHERS THEN
  RETURN false;
END $$;

-- -----------------------------------------------------------------------------
-- emitir_evento: punto de entrada del motor.
-- Busca los flujos activos del evento, evalúa sus condiciones y programa los
-- pasos. El worker (/api/cron/flujos) ejecuta los pasos ya vencidos.
-- Nunca rompe la transacción del llamante.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.emitir_evento(
  p_codigo     TEXT,
  p_payload    JSONB DEFAULT '{}',
  p_entidad    TEXT DEFAULT NULL,
  p_entidad_id TEXT DEFAULT NULL
) RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_evento  eventos_notificacion%ROWTYPE;
  v_flujo   flujos_notificacion%ROWTYPE;
  v_ejec_id UUID;
  v_disp    INTEGER := 0;
BEGIN
  SELECT * INTO v_evento FROM eventos_notificacion WHERE codigo = p_codigo;
  IF NOT FOUND OR NOT v_evento.activo THEN RETURN 0; END IF;

  FOR v_flujo IN
    SELECT * FROM flujos_notificacion
    WHERE evento_codigo = p_codigo AND activo
    ORDER BY prioridad, created_at
  LOOP
    CONTINUE WHEN NOT public.evaluar_condiciones(v_flujo.condiciones, COALESCE(p_payload, '{}'::JSONB));

    INSERT INTO flujo_ejecuciones (flujo_id, evento_codigo, payload, entidad, entidad_id)
    VALUES (v_flujo.id, p_codigo, COALESCE(p_payload, '{}'::JSONB), p_entidad, p_entidad_id)
    RETURNING id INTO v_ejec_id;

    INSERT INTO flujo_ejecucion_pasos (ejecucion_id, paso_id, orden, programado_para)
    SELECT v_ejec_id, s.id, s.orden, NOW() + make_interval(mins => s.demora_minutos)
    FROM flujo_pasos s
    WHERE s.flujo_id = v_flujo.id AND s.activo;

    -- Flujo sin pasos: la ejecución queda cerrada de inmediato.
    UPDATE flujo_ejecuciones SET estado = 'COMPLETADA'
    WHERE id = v_ejec_id
      AND NOT EXISTS (SELECT 1 FROM flujo_ejecucion_pasos WHERE ejecucion_id = v_ejec_id);

    v_disp := v_disp + 1;
  END LOOP;

  RETURN v_disp;
EXCEPTION WHEN OTHERS THEN
  RETURN 0;
END $$;

COMMENT ON FUNCTION public.emitir_evento(TEXT, JSONB, TEXT, TEXT) IS
  'Dispara los flujos de notificación asociados a un evento del catálogo.';

-- -----------------------------------------------------------------------------
-- Puente: toda alerta existente (stock, OC, contactos, usuarios…) alimenta
-- también el motor de flujos, sin tocar los triggers ya escritos.
-- -----------------------------------------------------------------------------
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

  -- Motor de flujos: el mismo código de alerta es un evento del catálogo.
  PERFORM public.emitir_evento(
    p_codigo::TEXT,
    COALESCE(p_metadata, '{}'::JSONB) || jsonb_build_object(
      'titulo', p_titulo, 'descripcion', p_descripcion,
      'entidad', p_entidad, 'entidad_id', p_entidad_id, 'enlace', p_enlace
    ),
    p_entidad, p_entidad_id
  );

  RETURN v_count;
EXCEPTION WHEN OTHERS THEN
  RETURN 0;
END $$;

GRANT EXECUTE ON FUNCTION public.emitir_evento(TEXT, JSONB, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.evaluar_condiciones(JSONB, JSONB)      TO authenticated;
GRANT EXECUTE ON FUNCTION public.payload_valor(JSONB, TEXT)             TO authenticated;
GRANT EXECUTE ON FUNCTION public.comparar_valor(TEXT, TEXT, TEXT)       TO authenticated;

-- =============================================================================
-- 8) CATÁLOGO BASE DE EVENTOS
-- Los 9 primeros coinciden con `tipo_notificacion`: cualquier alerta que ya
-- emite la plataforma alimenta el motor sin trabajo adicional. El resto son
-- eventos de negocio que emite el código de la app con `emitirEvento()`.
-- =============================================================================
INSERT INTO eventos_notificacion (codigo, nombre, descripcion, modulo, variables) VALUES
  ('STOCK_BAJO', 'Stock bajo',
   'El stock de un producto cayó al mínimo definido o por debajo.', 'Inventario',
   '[{"clave":"titulo","descripcion":"Título de la alerta"},{"clave":"cantidad","descripcion":"Existencias actuales"},{"clave":"minimo","descripcion":"Stock mínimo definido"},{"clave":"entidad_id","descripcion":"ID del producto"}]'),
  ('STOCK_AGOTADO', 'Stock agotado',
   'Un producto quedó en cero existencias.', 'Inventario',
   '[{"clave":"titulo","descripcion":"Título de la alerta"},{"clave":"cantidad","descripcion":"Existencias actuales"},{"clave":"entidad_id","descripcion":"ID del producto"}]'),
  ('OC_CREADA', 'Orden de compra creada',
   'Se registró una nueva orden de compra.', 'Compras',
   '[{"clave":"numero_oc","descripcion":"Número de la OC"},{"clave":"estado","descripcion":"Estado de la OC"}]'),
  ('OC_RECIBIDA', 'Orden de compra recibida',
   'Una orden de compra se marcó como recibida (parcial o completa).', 'Compras',
   '[{"clave":"numero_oc","descripcion":"Número de la OC"},{"clave":"estado","descripcion":"Estado de la OC"}]'),
  ('OC_POR_VENCER', 'Orden de compra por vencer',
   'Una OC pendiente se acerca a su fecha de entrega.', 'Compras',
   '[{"clave":"numero_oc","descripcion":"Número de la OC"},{"clave":"dias","descripcion":"Días para el vencimiento"}]'),
  ('MOVIMIENTO', 'Movimiento de inventario',
   'Se registró un movimiento de stock.', 'Inventario',
   '[{"clave":"titulo","descripcion":"Título de la alerta"}]'),
  ('CONTACTO_WEB', 'Nuevo contacto web',
   'Alguien envió el formulario del sitio corporativo.', 'Comercial',
   '[{"clave":"email","descripcion":"Correo de quien escribe"},{"clave":"telefono","descripcion":"Teléfono de contacto"}]'),
  ('USUARIO_NUEVO', 'Nuevo usuario',
   'Se dio de alta un nuevo usuario en la plataforma.', 'Administración',
   '[{"clave":"email","descripcion":"Correo del usuario"},{"clave":"rol","descripcion":"Rol asignado"}]'),
  ('SISTEMA', 'Mensaje del sistema',
   'Anuncio manual o mensaje general del sistema.', 'Administración',
   '[{"clave":"titulo","descripcion":"Título del anuncio"},{"clave":"descripcion","descripcion":"Cuerpo del anuncio"}]'),
  ('ORDEN_INSUMO_CREADA', 'Orden de insumo creada',
   'Una sede registró una nueva orden de insumo.', 'Órdenes de insumo',
   '[{"clave":"orden_id","descripcion":"ID de la orden"},{"clave":"numero","descripcion":"Consecutivo"},{"clave":"sede","descripcion":"Nombre de la sede"},{"clave":"estado","descripcion":"Estado actual"}]'),
  ('ORDEN_INSUMO_APROBADA', 'Orden de insumo aprobada',
   'Una orden de insumo fue aprobada por la central.', 'Órdenes de insumo',
   '[{"clave":"orden_id","descripcion":"ID de la orden"},{"clave":"numero","descripcion":"Consecutivo"},{"clave":"sede","descripcion":"Nombre de la sede"}]'),
  ('ORDEN_INSUMO_DESPACHADA', 'Orden de insumo despachada',
   'La bodega despachó una orden de insumo.', 'Órdenes de insumo',
   '[{"clave":"orden_id","descripcion":"ID de la orden"},{"clave":"numero","descripcion":"Consecutivo"},{"clave":"fecha_despacho","descripcion":"Fecha de despacho"}]'),
  ('SOLICITUD_HOGAR_CREADA', 'Solicitud de servicio del hogar',
   'Un cliente solicitó un servicio del hogar desde el portal.', 'Servicios del Hogar',
   '[{"clave":"solicitud_id","descripcion":"ID de la solicitud"},{"clave":"cliente_email","descripcion":"Correo del cliente"},{"clave":"servicio","descripcion":"Tipo de servicio"},{"clave":"estado","descripcion":"Estado de la solicitud"}]'),
  ('PAGO_HOGAR_REGISTRADO', 'Pago registrado (Servicios del Hogar)',
   'Se registró un pago de un cobro del portal de clientes.', 'Servicios del Hogar',
   '[{"clave":"cobro_id","descripcion":"ID del cobro"},{"clave":"cliente_email","descripcion":"Correo del cliente"},{"clave":"valor","descripcion":"Valor pagado"}]'),
  ('POSTULACION_RECIBIDA', 'Postulación recibida',
   'Un aspirante completó el registro de vacantes.', 'Gestión Humana',
   '[{"clave":"candidato_id","descripcion":"ID del candidato"},{"clave":"candidato_email","descripcion":"Correo del aspirante"},{"clave":"vacante","descripcion":"Vacante a la que aplica"}]'),
  ('MANUAL', 'Disparo manual',
   'Evento genérico para lanzar un flujo a mano desde la plataforma (pruebas o campañas puntuales).', 'Administración',
   '[{"clave":"titulo","descripcion":"Título libre"},{"clave":"descripcion","descripcion":"Texto libre"}]')
ON CONFLICT (codigo) DO NOTHING;

-- =============================================================================
-- 9) PLANTILLAS BASE
-- =============================================================================
INSERT INTO plantillas_correo (codigo, nombre, descripcion, categoria, asunto, cuerpo_html, cuerpo_texto, variables, es_sistema) VALUES
  ('aviso_generico', 'Aviso genérico',
   'Plantilla base para cualquier alerta: título, mensaje y botón al registro.',
   'Sistema',
   '{{titulo}}',
   '<div style="font-family:Arial,Helvetica,sans-serif;color:#1f2937;max-width:600px;margin:0 auto">'
   '<div style="background:#2E7D32;color:#fff;padding:20px 24px;border-radius:12px 12px 0 0">'
   '<h1 style="margin:0;font-size:18px">Conserjes Inmobiliarios</h1></div>'
   '<div style="border:1px solid #e5e7eb;border-top:none;padding:24px;border-radius:0 0 12px 12px">'
   '<h2 style="margin:0 0 12px;font-size:17px;color:#111827">{{titulo}}</h2>'
   '<p style="margin:0 0 16px;line-height:1.6">{{descripcion}}</p>'
   '<p style="margin:0"><a href="{{enlace}}" style="background:#2E7D32;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;display:inline-block">Ver en la plataforma</a></p>'
   '<hr style="border:none;border-top:1px solid #eee;margin:20px 0">'
   '<p style="font-size:12px;color:#9ca3af;margin:0">Notificación automática · no responder a este correo.</p>'
   '</div></div>',
   '{{titulo}}' || E'\n\n' || '{{descripcion}}' || E'\n\n' || '{{enlace}}',
   '[{"clave":"titulo","descripcion":"Título del aviso","ejemplo":"Stock bajo: Jabón líquido"},{"clave":"descripcion","descripcion":"Cuerpo del mensaje","ejemplo":"Existencias en 3 (mínimo 10)."},{"clave":"enlace","descripcion":"Enlace al registro","ejemplo":"/productos"}]',
   true),
  ('escalamiento', 'Escalamiento / recordatorio',
   'Segundo aviso cuando una situación sigue sin resolverse.',
   'Sistema',
   'Recordatorio: {{titulo}}',
   '<div style="font-family:Arial,Helvetica,sans-serif;color:#1f2937;max-width:600px;margin:0 auto">'
   '<div style="background:#B45309;color:#fff;padding:20px 24px;border-radius:12px 12px 0 0">'
   '<h1 style="margin:0;font-size:18px">Pendiente por atender</h1></div>'
   '<div style="border:1px solid #e5e7eb;border-top:none;padding:24px;border-radius:0 0 12px 12px">'
   '<h2 style="margin:0 0 12px;font-size:17px;color:#111827">{{titulo}}</h2>'
   '<p style="margin:0 0 16px;line-height:1.6">Este asunto sigue sin resolverse. {{descripcion}}</p>'
   '<p style="margin:0"><a href="{{enlace}}" style="background:#B45309;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;display:inline-block">Atender ahora</a></p>'
   '</div></div>',
   'Recordatorio: {{titulo}}' || E'\n\n' || '{{descripcion}}' || E'\n\n' || '{{enlace}}',
   '[{"clave":"titulo","descripcion":"Título del aviso"},{"clave":"descripcion","descripcion":"Detalle"},{"clave":"enlace","descripcion":"Enlace al registro"}]',
   true)
ON CONFLICT (codigo) DO NOTHING;

-- =============================================================================
-- 10) RLS
--   · Lectura: quien pueda ver notificaciones/flujos.
--   · Escritura: permiso específico (o SUPER_ADMIN/ADMIN, implícito en el helper).
-- =============================================================================
ALTER TABLE plantillas_correo      ENABLE ROW LEVEL SECURITY;
ALTER TABLE eventos_notificacion   ENABLE ROW LEVEL SECURITY;
ALTER TABLE flujos_notificacion    ENABLE ROW LEVEL SECURITY;
ALTER TABLE flujo_pasos            ENABLE ROW LEVEL SECURITY;
ALTER TABLE flujo_ejecuciones      ENABLE ROW LEVEL SECURITY;
ALTER TABLE flujo_ejecucion_pasos  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS plantillas_read  ON plantillas_correo;
CREATE POLICY plantillas_read ON plantillas_correo FOR SELECT TO authenticated
  USING (public.auth_permiso_any(ARRAY['gestionar_plantillas_correo','ver_flujos_notificacion','gestionar_integraciones']));
DROP POLICY IF EXISTS plantillas_write ON plantillas_correo;
CREATE POLICY plantillas_write ON plantillas_correo FOR ALL TO authenticated
  USING (public.auth_permiso('gestionar_plantillas_correo'))
  WITH CHECK (public.auth_permiso('gestionar_plantillas_correo'));

DROP POLICY IF EXISTS eventos_notif_read  ON eventos_notificacion;
CREATE POLICY eventos_notif_read ON eventos_notificacion FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS eventos_notif_write ON eventos_notificacion;
CREATE POLICY eventos_notif_write ON eventos_notificacion FOR ALL TO authenticated
  USING (public.auth_permiso('gestionar_flujos_notificacion'))
  WITH CHECK (public.auth_permiso('gestionar_flujos_notificacion'));

DROP POLICY IF EXISTS flujos_read  ON flujos_notificacion;
CREATE POLICY flujos_read ON flujos_notificacion FOR SELECT TO authenticated
  USING (public.auth_permiso_any(ARRAY['ver_flujos_notificacion','gestionar_flujos_notificacion']));
DROP POLICY IF EXISTS flujos_write ON flujos_notificacion;
CREATE POLICY flujos_write ON flujos_notificacion FOR ALL TO authenticated
  USING (public.auth_permiso('gestionar_flujos_notificacion'))
  WITH CHECK (public.auth_permiso('gestionar_flujos_notificacion'));

DROP POLICY IF EXISTS flujo_pasos_read  ON flujo_pasos;
CREATE POLICY flujo_pasos_read ON flujo_pasos FOR SELECT TO authenticated
  USING (public.auth_permiso_any(ARRAY['ver_flujos_notificacion','gestionar_flujos_notificacion']));
DROP POLICY IF EXISTS flujo_pasos_write ON flujo_pasos;
CREATE POLICY flujo_pasos_write ON flujo_pasos FOR ALL TO authenticated
  USING (public.auth_permiso('gestionar_flujos_notificacion'))
  WITH CHECK (public.auth_permiso('gestionar_flujos_notificacion'));

DROP POLICY IF EXISTS flujo_ejec_read ON flujo_ejecuciones;
CREATE POLICY flujo_ejec_read ON flujo_ejecuciones FOR SELECT TO authenticated
  USING (public.auth_permiso_any(ARRAY['ver_flujos_notificacion','gestionar_flujos_notificacion']));
DROP POLICY IF EXISTS flujo_ejec_write ON flujo_ejecuciones;
CREATE POLICY flujo_ejec_write ON flujo_ejecuciones FOR ALL TO authenticated
  USING (public.auth_permiso('gestionar_flujos_notificacion'))
  WITH CHECK (public.auth_permiso('gestionar_flujos_notificacion'));

DROP POLICY IF EXISTS flujo_ejec_pasos_read ON flujo_ejecucion_pasos;
CREATE POLICY flujo_ejec_pasos_read ON flujo_ejecucion_pasos FOR SELECT TO authenticated
  USING (public.auth_permiso_any(ARRAY['ver_flujos_notificacion','gestionar_flujos_notificacion']));
DROP POLICY IF EXISTS flujo_ejec_pasos_write ON flujo_ejecucion_pasos;
CREATE POLICY flujo_ejec_pasos_write ON flujo_ejecucion_pasos FOR ALL TO authenticated
  USING (public.auth_permiso('gestionar_flujos_notificacion'))
  WITH CHECK (public.auth_permiso('gestionar_flujos_notificacion'));

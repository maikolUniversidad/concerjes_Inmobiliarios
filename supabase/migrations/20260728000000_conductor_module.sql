-- =============================================================================
-- MÓDULO CONDUCTOR — GPS en tiempo real, rutas, novedades, confirmación
-- =============================================================================
-- Flujo completo con el nuevo módulo:
--   DESPACHADO ──►  EN_RUTA (conductor toma la ruta)
--                       │ GPS activo
--                   ENTREGADO (conductor confirma con foto + firma + geoloc)
--                       │
--                   RECIBIDO (supervisor de sede cierra — flujo anterior)
-- =============================================================================

-- ── Nuevo rol CONDUCTOR en la columna rol de usuarios ───────────────────────
-- (Los ALTER TYPE de los enums están en 20260727000000_conductor_enums.sql
--  y deben correrse primero en su propia transacción)
-- El rol es VARCHAR en la tabla usuarios; solo actualizamos el CHECK constraint si existe
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'usuarios' AND constraint_name = 'usuarios_rol_check'
  ) THEN
    ALTER TABLE usuarios DROP CONSTRAINT usuarios_rol_check;
    ALTER TABLE usuarios ADD CONSTRAINT usuarios_rol_check CHECK (
      rol IN ('SUPER_ADMIN','ADMIN','SUPERVISOR','COORDINADOR_COMPRAS','BODEGUERO','AUDITOR','OPERADOR_SEDE','ASPIRANTE','CONDUCTOR')
    );
  END IF;
END $$;

-- ── Columnas de conductor en ordenes_insumo ──────────────────────────────────
ALTER TABLE ordenes_insumo ADD COLUMN IF NOT EXISTS conductor_id      UUID REFERENCES usuarios(id) ON DELETE SET NULL;
ALTER TABLE ordenes_insumo ADD COLUMN IF NOT EXISTS tomado_ruta_at    TIMESTAMPTZ;
ALTER TABLE ordenes_insumo ADD COLUMN IF NOT EXISTS ruta_parada_id    UUID;  -- FK después de crear tabla

CREATE INDEX IF NOT EXISTS idx_oi_conductor ON ordenes_insumo(conductor_id);

-- =============================================================================
-- CONDUCTORES (perfil extendido ligado a un usuario)
-- =============================================================================
CREATE TABLE IF NOT EXISTS conductores (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id        UUID NOT NULL UNIQUE REFERENCES usuarios(id) ON DELETE CASCADE,
  placa_vehiculo    VARCHAR(20),
  tipo_vehiculo     VARCHAR(50) DEFAULT 'CAMION',
  telefono_contacto VARCHAR(30),
  zona              VARCHAR(100),
  licencia_categoria VARCHAR(10),
  activo            BOOLEAN NOT NULL DEFAULT true,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_conductores_usuario ON conductores(usuario_id);
CREATE INDEX IF NOT EXISTS idx_conductores_activo  ON conductores(activo);

-- =============================================================================
-- HORARIOS DE ENTREGA POR SEDE (importados del Excel)
-- =============================================================================
CREATE TABLE IF NOT EXISTS sede_horario_entrega (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sede_id             UUID NOT NULL UNIQUE REFERENCES sedes(id) ON DELETE CASCADE,
  ventana_am_inicio   TIME,
  ventana_am_fin      TIME,
  ventana_pm_inicio   TIME,
  ventana_pm_fin      TIME,
  supervisor_nombre   VARCHAR(200),
  supervisor_contacto VARCHAR(50),
  notas               TEXT,
  activo              BOOLEAN NOT NULL DEFAULT true,
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================================================
-- RUTAS DE ENTREGA (admin crea 1 ruta por conductor por día)
-- =============================================================================
CREATE TABLE IF NOT EXISTS rutas_entrega (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo         VARCHAR(30) UNIQUE NOT NULL,
  conductor_id   UUID NOT NULL REFERENCES conductores(id),
  fecha          DATE NOT NULL,
  estado         VARCHAR(20) NOT NULL DEFAULT 'PENDIENTE',
  -- PENDIENTE | EN_CURSO | COMPLETADA | CANCELADA
  observaciones  TEXT,
  creado_por     UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  iniciado_at    TIMESTAMPTZ,
  finalizado_at  TIMESTAMPTZ,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_rutas_conductor ON rutas_entrega(conductor_id);
CREATE INDEX IF NOT EXISTS idx_rutas_fecha     ON rutas_entrega(fecha DESC);
CREATE INDEX IF NOT EXISTS idx_rutas_estado    ON rutas_entrega(estado);

-- =============================================================================
-- PARADAS DE LA RUTA (órdenes asignadas en orden de visita)
-- =============================================================================
CREATE TABLE IF NOT EXISTS ruta_paradas (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ruta_id                UUID NOT NULL REFERENCES rutas_entrega(id) ON DELETE CASCADE,
  orden_id               UUID NOT NULL REFERENCES ordenes_insumo(id),
  sede_id                UUID NOT NULL REFERENCES sedes(id),
  numero_parada          SMALLINT NOT NULL DEFAULT 1,
  estado                 VARCHAR(20) NOT NULL DEFAULT 'PENDIENTE',
  -- PENDIENTE | EN_RUTA | ENTREGADO | NOVEDAD | REPROGRAMADO
  hora_estimada_llegada  TIME,
  llegado_at             TIMESTAMPTZ,
  entregado_at           TIMESTAMPTZ,
  created_at             TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (ruta_id, orden_id)
);
CREATE INDEX IF NOT EXISTS idx_paradas_ruta  ON ruta_paradas(ruta_id);
CREATE INDEX IF NOT EXISTS idx_paradas_orden ON ruta_paradas(orden_id);

-- FK retroactivo desde ordenes_insumo → ruta_paradas (idempotente)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'ordenes_insumo' AND constraint_name = 'fk_oi_ruta_parada'
  ) THEN
    ALTER TABLE ordenes_insumo ADD CONSTRAINT fk_oi_ruta_parada
      FOREIGN KEY (ruta_parada_id) REFERENCES ruta_paradas(id) ON DELETE SET NULL
      NOT VALID;
  END IF;
END $$;

-- =============================================================================
-- UBICACIÓN ACTUAL DEL CONDUCTOR (1 fila por conductor — upsert en tiempo real)
-- =============================================================================
CREATE TABLE IF NOT EXISTS conductor_ubicacion_actual (
  conductor_id     UUID PRIMARY KEY REFERENCES conductores(id) ON DELETE CASCADE,
  ruta_id          UUID REFERENCES rutas_entrega(id) ON DELETE SET NULL,
  lat              DECIMAL(10,7) NOT NULL,
  lng              DECIMAL(10,7) NOT NULL,
  precision_metros DECIMAL(8,2),
  velocidad_kmh    DECIMAL(6,2),
  rumbo            DECIMAL(5,2),
  activo           BOOLEAN NOT NULL DEFAULT true,
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);

-- Habilitar Realtime para posición en vivo
ALTER PUBLICATION supabase_realtime ADD TABLE conductor_ubicacion_actual;

-- =============================================================================
-- HISTORIAL GPS (para replay de ruta y auditoría)
-- =============================================================================
CREATE TABLE IF NOT EXISTS conductor_ubicacion_historial (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conductor_id     UUID NOT NULL REFERENCES conductores(id),
  ruta_id          UUID REFERENCES rutas_entrega(id) ON DELETE SET NULL,
  lat              DECIMAL(10,7) NOT NULL,
  lng              DECIMAL(10,7) NOT NULL,
  precision_metros DECIMAL(8,2),
  velocidad_kmh    DECIMAL(6,2),
  created_at       TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_gps_hist ON conductor_ubicacion_historial(conductor_id, created_at DESC);

-- =============================================================================
-- NOVEDADES DURANTE LA ENTREGA
-- =============================================================================
CREATE TABLE IF NOT EXISTS novedades_entrega (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ruta_id      UUID NOT NULL REFERENCES rutas_entrega(id),
  parada_id    UUID REFERENCES ruta_paradas(id) ON DELETE SET NULL,
  orden_id     UUID REFERENCES ordenes_insumo(id) ON DELETE SET NULL,
  conductor_id UUID NOT NULL REFERENCES conductores(id),
  tipo         VARCHAR(30) NOT NULL,
  -- DEVOLUCION | FALTA_MERCANCIA | ACCIDENTE | SEDE_CERRADA | TIEMPO_EXCEDIDO | OTRO
  descripcion  TEXT NOT NULL,
  lat          DECIMAL(10,7),
  lng          DECIMAL(10,7),
  foto_url     TEXT,
  estado       VARCHAR(20) NOT NULL DEFAULT 'ABIERTA',
  -- ABIERTA | EN_GESTION | RESUELTA
  resuelto_por UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  resuelto_at  TIMESTAMPTZ,
  resolucion   TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_novedades_ruta      ON novedades_entrega(ruta_id);
CREATE INDEX IF NOT EXISTS idx_novedades_conductor ON novedades_entrega(conductor_id);
CREATE INDEX IF NOT EXISTS idx_novedades_estado    ON novedades_entrega(estado);

ALTER PUBLICATION supabase_realtime ADD TABLE novedades_entrega;

-- =============================================================================
-- CONFIRMACIONES DE ENTREGA (foto + firma + geoloc + receptor)
-- =============================================================================
CREATE TABLE IF NOT EXISTS confirmaciones_entrega (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ruta_id          UUID NOT NULL REFERENCES rutas_entrega(id),
  parada_id        UUID NOT NULL REFERENCES ruta_paradas(id) ON DELETE CASCADE,
  orden_id         UUID NOT NULL REFERENCES ordenes_insumo(id),
  conductor_id     UUID NOT NULL REFERENCES conductores(id),
  receptor_nombre  VARCHAR(200) NOT NULL,
  receptor_cedula  VARCHAR(30),
  receptor_cargo   VARCHAR(100),
  foto_entrega_url TEXT,
  firma_url        TEXT,
  lat              DECIMAL(10,7),
  lng              DECIMAL(10,7),
  items_recibidos  JSONB NOT NULL DEFAULT '[]',
  -- [{"producto_id":"...","nombre":"...","cantidad_confirmada":5}]
  observaciones    TEXT,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_conf_orden ON confirmaciones_entrega(orden_id);
CREATE INDEX IF NOT EXISTS idx_conf_ruta  ON confirmaciones_entrega(ruta_id);

-- =============================================================================
-- STORAGE — bucket para fotos y firmas de evidencia
-- =============================================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('logistica-evidencia', 'logistica-evidencia', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "logistica_read"   ON storage.objects;
DROP POLICY IF EXISTS "logistica_upload" ON storage.objects;
DROP POLICY IF EXISTS "logistica_delete" ON storage.objects;
CREATE POLICY "logistica_read"   ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'logistica-evidencia');
CREATE POLICY "logistica_upload" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'logistica-evidencia');
CREATE POLICY "logistica_delete" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'logistica-evidencia');

-- =============================================================================
-- RLS
-- =============================================================================
ALTER TABLE conductores                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE rutas_entrega                ENABLE ROW LEVEL SECURITY;
ALTER TABLE ruta_paradas                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE conductor_ubicacion_actual   ENABLE ROW LEVEL SECURITY;
ALTER TABLE conductor_ubicacion_historial ENABLE ROW LEVEL SECURITY;
ALTER TABLE novedades_entrega            ENABLE ROW LEVEL SECURITY;
ALTER TABLE confirmaciones_entrega       ENABLE ROW LEVEL SECURITY;
ALTER TABLE sede_horario_entrega         ENABLE ROW LEVEL SECURITY;

-- Lectura: cualquier autenticado
DROP POLICY IF EXISTS cond_read      ON conductores;
DROP POLICY IF EXISTS rutas_read     ON rutas_entrega;
DROP POLICY IF EXISTS paradas_read   ON ruta_paradas;
DROP POLICY IF EXISTS gps_act_read   ON conductor_ubicacion_actual;
DROP POLICY IF EXISTS gps_hist_read  ON conductor_ubicacion_historial;
DROP POLICY IF EXISTS novedades_read ON novedades_entrega;
DROP POLICY IF EXISTS conf_read      ON confirmaciones_entrega;
DROP POLICY IF EXISTS horarios_read  ON sede_horario_entrega;

CREATE POLICY cond_read      ON conductores                   FOR SELECT TO authenticated USING (true);
CREATE POLICY rutas_read     ON rutas_entrega                  FOR SELECT TO authenticated USING (true);
CREATE POLICY paradas_read   ON ruta_paradas                   FOR SELECT TO authenticated USING (true);
CREATE POLICY gps_act_read   ON conductor_ubicacion_actual     FOR SELECT TO authenticated USING (true);
CREATE POLICY gps_hist_read  ON conductor_ubicacion_historial  FOR SELECT TO authenticated USING (true);
CREATE POLICY novedades_read ON novedades_entrega              FOR SELECT TO authenticated USING (true);
CREATE POLICY conf_read      ON confirmaciones_entrega         FOR SELECT TO authenticated USING (true);
CREATE POLICY horarios_read  ON sede_horario_entrega           FOR SELECT TO authenticated USING (true);

-- Escritura conductores: solo admin/supervisor
DROP POLICY IF EXISTS cond_write ON conductores;
CREATE POLICY cond_write ON conductores FOR ALL TO authenticated
  USING    (public.auth_rol() IN ('SUPER_ADMIN','ADMIN','SUPERVISOR'))
  WITH CHECK (public.auth_rol() IN ('SUPER_ADMIN','ADMIN','SUPERVISOR'));

-- Escritura rutas: admin + bodeguero + compras
DROP POLICY IF EXISTS rutas_write ON rutas_entrega;
CREATE POLICY rutas_write ON rutas_entrega FOR ALL TO authenticated
  USING    (public.auth_rol() IN ('SUPER_ADMIN','ADMIN','SUPERVISOR','BODEGUERO','COORDINADOR_COMPRAS'))
  WITH CHECK (public.auth_rol() IN ('SUPER_ADMIN','ADMIN','SUPERVISOR','BODEGUERO','COORDINADOR_COMPRAS'));

-- Escritura paradas: admin + conductor
DROP POLICY IF EXISTS paradas_write ON ruta_paradas;
CREATE POLICY paradas_write ON ruta_paradas FOR ALL TO authenticated
  USING    (public.auth_rol() IN ('SUPER_ADMIN','ADMIN','SUPERVISOR','BODEGUERO','COORDINADOR_COMPRAS','CONDUCTOR'))
  WITH CHECK (public.auth_rol() IN ('SUPER_ADMIN','ADMIN','SUPERVISOR','BODEGUERO','COORDINADOR_COMPRAS','CONDUCTOR'));

-- GPS actual: el conductor solo actualiza su propia posición
DROP POLICY IF EXISTS gps_act_write ON conductor_ubicacion_actual;
CREATE POLICY gps_act_write ON conductor_ubicacion_actual FOR ALL TO authenticated
  USING (true)
  WITH CHECK (
    conductor_id IN (SELECT id FROM conductores WHERE usuario_id = auth.uid())
    OR public.auth_rol() IN ('SUPER_ADMIN','ADMIN')
  );

-- Historial GPS: solo insert por el propio conductor
DROP POLICY IF EXISTS gps_hist_insert ON conductor_ubicacion_historial;
CREATE POLICY gps_hist_insert ON conductor_ubicacion_historial FOR INSERT TO authenticated
  WITH CHECK (
    conductor_id IN (SELECT id FROM conductores WHERE usuario_id = auth.uid())
    OR public.auth_rol() IN ('SUPER_ADMIN','ADMIN')
  );

-- Novedades: conductor puede crear, admin puede resolver
DROP POLICY IF EXISTS novedades_write ON novedades_entrega;
CREATE POLICY novedades_write ON novedades_entrega FOR ALL TO authenticated
  USING    (public.auth_rol() IN ('SUPER_ADMIN','ADMIN','SUPERVISOR','BODEGUERO','COORDINADOR_COMPRAS','CONDUCTOR'))
  WITH CHECK (public.auth_rol() IN ('SUPER_ADMIN','ADMIN','SUPERVISOR','BODEGUERO','COORDINADOR_COMPRAS','CONDUCTOR'));

-- Confirmaciones: conductor crea, todos leen
DROP POLICY IF EXISTS conf_write ON confirmaciones_entrega;
CREATE POLICY conf_write ON confirmaciones_entrega FOR ALL TO authenticated
  USING    (public.auth_rol() IN ('SUPER_ADMIN','ADMIN','SUPERVISOR','BODEGUERO','COORDINADOR_COMPRAS','CONDUCTOR'))
  WITH CHECK (public.auth_rol() IN ('SUPER_ADMIN','ADMIN','SUPERVISOR','BODEGUERO','COORDINADOR_COMPRAS','CONDUCTOR'));

-- Horarios: admin edita
DROP POLICY IF EXISTS horarios_write ON sede_horario_entrega;
CREATE POLICY horarios_write ON sede_horario_entrega FOR ALL TO authenticated
  USING    (public.auth_rol() IN ('SUPER_ADMIN','ADMIN','SUPERVISOR','COORDINADOR_COMPRAS'))
  WITH CHECK (public.auth_rol() IN ('SUPER_ADMIN','ADMIN','SUPERVISOR','COORDINADOR_COMPRAS'));

-- =============================================================================
-- updated_at TRIGGERS
-- =============================================================================
DROP TRIGGER IF EXISTS tr_conductores_upd ON conductores;
CREATE TRIGGER tr_conductores_upd
  BEFORE UPDATE ON conductores FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS tr_rutas_upd ON rutas_entrega;
CREATE TRIGGER tr_rutas_upd
  BEFORE UPDATE ON rutas_entrega FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS tr_novedades_upd ON novedades_entrega;
CREATE TRIGGER tr_novedades_upd
  BEFORE UPDATE ON novedades_entrega FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =============================================================================
-- ROL CONDUCTOR — permisos en el sistema
-- =============================================================================
-- Admin y supervisores: ven y gestionan todo el módulo
UPDATE public.roles
SET permisos = permisos || '{
  "ver_logistica": true,
  "gestionar_rutas": true,
  "ver_ubicacion_conductores": true,
  "gestionar_horarios_entrega": true,
  "ver_novedades_entrega": true,
  "gestionar_novedades_entrega": true,
  "gestionar_conductores": true
}'::jsonb
WHERE rol_base IN ('SUPER_ADMIN','ADMIN','SUPERVISOR','COORDINADOR_COMPRAS')
   OR nombre IN ('Gerencia','Coordinador');

-- Bodeguero: ve y gestiona rutas (es quien despacha)
UPDATE public.roles
SET permisos = permisos || '{
  "ver_logistica": true,
  "gestionar_rutas": true,
  "ver_ubicacion_conductores": true,
  "ver_novedades_entrega": true
}'::jsonb
WHERE rol_base = 'BODEGUERO';

-- Seed del nuevo rol Conductor en la tabla roles
INSERT INTO public.roles (nombre, rol_base, descripcion, permisos)
VALUES (
  'Conductor',
  'CONDUCTOR',
  'Conductor propio: gestiona rutas de entrega, GPS en tiempo real, confirmaciones y novedades',
  '{
    "ver_logistica": true,
    "ver_rutas_conductor": true,
    "actualizar_gps_conductor": true,
    "confirmar_entrega_conductor": true,
    "reportar_novedad_conductor": true,
    "ver_ordenes_insumo": true
  }'::jsonb
)
ON CONFLICT (nombre) DO UPDATE
  SET descripcion = EXCLUDED.descripcion,
      permisos    = EXCLUDED.permisos;

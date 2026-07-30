-- =============================================================================
-- MÓDULO SERVICIOS DEL HOGAR
-- Permite a clientes externos contratar servicios domésticos (aseo, eventos,
-- cocina, jardín, etc.) atendidos por los concerjes de la empresa.
-- =============================================================================

-- ── Tipos de servicio ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tipos_servicio_hogar (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre      VARCHAR(100) NOT NULL,
  descripcion TEXT,
  icono       VARCHAR(10)  DEFAULT '🧹',
  color       VARCHAR(20)  DEFAULT 'green',
  incluye     TEXT[],          -- lista de lo que incluye el servicio
  activo      BOOLEAN NOT NULL DEFAULT true,
  orden       SMALLINT    DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ── Tarifas por tipo y duración ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tarifas_servicio_hogar (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo_id             UUID NOT NULL REFERENCES tipos_servicio_hogar(id) ON DELETE CASCADE,
  nombre              VARCHAR(100) NOT NULL,   -- "2 horas", "Medio día", "Día completo"
  duracion_horas      DECIMAL(4,1) NOT NULL,
  precio_unico        DECIMAL(10,2) NOT NULL,
  precio_semanal      DECIMAL(10,2),
  precio_quincenal    DECIMAL(10,2),
  precio_mensual      DECIMAL(10,2),
  personas_incluidas  SMALLINT NOT NULL DEFAULT 1,
  activo              BOOLEAN NOT NULL DEFAULT true,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_tarifas_tipo ON tarifas_servicio_hogar(tipo_id);

-- ── Solicitudes de servicio (desde web pública) ───────────────────────────────
CREATE TABLE IF NOT EXISTS solicitudes_servicio_hogar (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  numero                  VARCHAR(20) UNIQUE NOT NULL,
  -- cliente
  cliente_nombre          VARCHAR(200) NOT NULL,
  cliente_email           VARCHAR(200) NOT NULL,
  cliente_telefono        VARCHAR(30)  NOT NULL,
  cliente_direccion       TEXT         NOT NULL,
  cliente_ciudad          VARCHAR(100) DEFAULT 'Bogotá',
  cliente_barrio          VARCHAR(100),
  -- servicio
  tipo_id                 UUID REFERENCES tipos_servicio_hogar(id) ON DELETE SET NULL,
  tarifa_id               UUID REFERENCES tarifas_servicio_hogar(id) ON DELETE SET NULL,
  frecuencia              VARCHAR(20)  NOT NULL DEFAULT 'UNICA',
  -- UNICA | SEMANAL | QUINCENAL | MENSUAL
  fecha_deseada           DATE         NOT NULL,
  hora_inicio             TIME         NOT NULL,
  personas_requeridas     SMALLINT     NOT NULL DEFAULT 1,
  m2_aprox                DECIMAL(8,2),
  mascotas                BOOLEAN      DEFAULT false,
  notas                   TEXT,
  -- gestión interna
  estado                  VARCHAR(20)  NOT NULL DEFAULT 'PENDIENTE',
  -- PENDIENTE | CONFIRMADA | EN_SERVICIO | COMPLETADA | CANCELADA
  precio_cotizado         DECIMAL(10,2),
  asignado_a              UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  atendido_por            UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  confirmado_at           TIMESTAMPTZ,
  completado_at           TIMESTAMPTZ,
  motivo_cancelacion      TEXT,
  -- calificación post-servicio
  calificacion            SMALLINT CHECK (calificacion BETWEEN 1 AND 5),
  comentario_calificacion TEXT,
  created_at              TIMESTAMPTZ DEFAULT NOW(),
  updated_at              TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ssh_estado    ON solicitudes_servicio_hogar(estado);
CREATE INDEX IF NOT EXISTS idx_ssh_fecha     ON solicitudes_servicio_hogar(fecha_deseada DESC);
CREATE INDEX IF NOT EXISTS idx_ssh_email     ON solicitudes_servicio_hogar(cliente_email);

-- ── Agenda de servicios (sesiones programadas) ────────────────────────────────
CREATE TABLE IF NOT EXISTS agenda_servicio_hogar (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  solicitud_id   UUID NOT NULL REFERENCES solicitudes_servicio_hogar(id) ON DELETE CASCADE,
  fecha          DATE NOT NULL,
  hora_inicio    TIME NOT NULL,
  hora_fin       TIME NOT NULL,
  concierje_id   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  estado         VARCHAR(20) NOT NULL DEFAULT 'PROGRAMADO',
  -- PROGRAMADO | EN_CURSO | COMPLETADO | CANCELADO
  notas          TEXT,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_agenda_fecha ON agenda_servicio_hogar(fecha DESC);
CREATE INDEX IF NOT EXISTS idx_agenda_sol   ON agenda_servicio_hogar(solicitud_id);

-- ── Trigger updated_at ───────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS tr_tipos_sh_upd ON tipos_servicio_hogar;
CREATE TRIGGER tr_tipos_sh_upd
  BEFORE UPDATE ON tipos_servicio_hogar FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS tr_ssh_upd ON solicitudes_servicio_hogar;
CREATE TRIGGER tr_ssh_upd
  BEFORE UPDATE ON solicitudes_servicio_hogar FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── RLS ──────────────────────────────────────────────────────────────────────
ALTER TABLE tipos_servicio_hogar     ENABLE ROW LEVEL SECURITY;
ALTER TABLE tarifas_servicio_hogar   ENABLE ROW LEVEL SECURITY;
ALTER TABLE solicitudes_servicio_hogar ENABLE ROW LEVEL SECURITY;
ALTER TABLE agenda_servicio_hogar    ENABLE ROW LEVEL SECURITY;

-- Tipos y tarifas: lectura pública (web sin login)
DROP POLICY IF EXISTS tipos_sh_public  ON tipos_servicio_hogar;
DROP POLICY IF EXISTS tarifas_sh_public ON tarifas_servicio_hogar;
CREATE POLICY tipos_sh_public   ON tipos_servicio_hogar   FOR SELECT USING (true);
CREATE POLICY tarifas_sh_public ON tarifas_servicio_hogar FOR SELECT USING (true);

-- Tipos y tarifas: escritura solo admin/supervisor
DROP POLICY IF EXISTS tipos_sh_write   ON tipos_servicio_hogar;
DROP POLICY IF EXISTS tarifas_sh_write ON tarifas_servicio_hogar;
CREATE POLICY tipos_sh_write ON tipos_servicio_hogar FOR ALL TO authenticated
  USING (public.auth_rol() IN ('SUPER_ADMIN','ADMIN','SUPERVISOR'))
  WITH CHECK (public.auth_rol() IN ('SUPER_ADMIN','ADMIN','SUPERVISOR'));
CREATE POLICY tarifas_sh_write ON tarifas_servicio_hogar FOR ALL TO authenticated
  USING (public.auth_rol() IN ('SUPER_ADMIN','ADMIN','SUPERVISOR'))
  WITH CHECK (public.auth_rol() IN ('SUPER_ADMIN','ADMIN','SUPERVISOR'));

-- Solicitudes: INSERT público (desde web sin login), SELECT/UPDATE solo autenticados
DROP POLICY IF EXISTS ssh_insert_public ON solicitudes_servicio_hogar;
DROP POLICY IF EXISTS ssh_auth_read     ON solicitudes_servicio_hogar;
DROP POLICY IF EXISTS ssh_auth_write    ON solicitudes_servicio_hogar;
CREATE POLICY ssh_insert_public ON solicitudes_servicio_hogar FOR INSERT WITH CHECK (true);
CREATE POLICY ssh_auth_read     ON solicitudes_servicio_hogar FOR SELECT TO authenticated USING (true);
CREATE POLICY ssh_auth_write    ON solicitudes_servicio_hogar FOR UPDATE TO authenticated
  USING (public.auth_rol() IN ('SUPER_ADMIN','ADMIN','SUPERVISOR'));

-- Agenda: solo autenticados
DROP POLICY IF EXISTS agenda_sh_read  ON agenda_servicio_hogar;
DROP POLICY IF EXISTS agenda_sh_write ON agenda_servicio_hogar;
CREATE POLICY agenda_sh_read  ON agenda_servicio_hogar FOR SELECT TO authenticated USING (true);
CREATE POLICY agenda_sh_write ON agenda_servicio_hogar FOR ALL TO authenticated
  USING (public.auth_rol() IN ('SUPER_ADMIN','ADMIN','SUPERVISOR'))
  WITH CHECK (public.auth_rol() IN ('SUPER_ADMIN','ADMIN','SUPERVISOR'));

-- ── Permisos para roles existentes ───────────────────────────────────────────
UPDATE public.roles
SET permisos = permisos || '{
  "ver_servicios_hogar": true,
  "gestionar_solicitudes_hogar": true,
  "gestionar_agenda_hogar": true,
  "gestionar_tipos_servicio": true,
  "gestionar_precios_servicio": true
}'::jsonb
WHERE rol_base IN ('SUPER_ADMIN','ADMIN','SUPERVISOR');

UPDATE public.roles
SET permisos = permisos || '{
  "ver_servicios_hogar": true,
  "gestionar_solicitudes_hogar": true,
  "gestionar_agenda_hogar": true
}'::jsonb
WHERE rol_base IN ('COORDINADOR_COMPRAS','BODEGUERO');

-- ── Seed: tipos de servicio ──────────────────────────────────────────────────
INSERT INTO tipos_servicio_hogar (nombre, descripcion, icono, color, incluye, orden) VALUES
(
  'Aseo Regular',
  'Limpieza general del hogar: salas, habitaciones, baños y cocina. Ideal para mantenimiento semanal o quincenal.',
  '🧹', 'green',
  ARRAY['Barrido y trapeado de pisos','Limpieza de baños','Desempolvado de muebles','Limpieza de cocina','Organización general'],
  1
),
(
  'Limpieza Profunda',
  'Limpieza detallada con productos especializados. Incluye áreas de difícil acceso, electrodomésticos y muebles.',
  '✨', 'blue',
  ARRAY['Todo lo del aseo regular','Limpieza interior de electrodomésticos','Lavado de vidrios','Desinfección profunda','Limpieza detrás de muebles','Cajones y closets'],
  2
),
(
  'Limpieza Post-Obra',
  'Limpieza especializada después de remodelaciones o construcciones. Retiro de polvo fino, escombros leves y residuos.',
  '🏗️', 'orange',
  ARRAY['Retiro de polvo de obra','Limpieza de pisos nuevos','Lavado de ventanas','Limpieza de pintura en superficies','Aspirado de residuos'],
  3
),
(
  'Atención en Eventos',
  'Personal capacitado para atender sus invitados: servicio de mesa, copas, refrigerios y limpieza durante el evento.',
  '🎉', 'purple',
  ARRAY['Servicio de mesa y bebidas','Atención a invitados','Mantenimiento durante evento','Limpieza posterior al evento','Uniforme formal incluido'],
  4
),
(
  'Servicio de Cocina',
  'Preparación y servicio de alimentos para el hogar o pequeñas reuniones. Desayunos, almuerzos, cenas o onces.',
  '🍳', 'amber',
  ARRAY['Preparación de alimentos','Presentación de platos','Servicio a la mesa','Limpieza de cocina','Menú acordado previamente'],
  5
),
(
  'Jardín y Exteriores',
  'Cuidado de plantas, poda de jardines, limpieza de terrazas, balcones y áreas exteriores del hogar.',
  '🌿', 'emerald',
  ARRAY['Corte de césped','Poda de plantas','Limpieza de terrazas y balcones','Riego de jardín','Retiro de hojas y residuos'],
  6
)
ON CONFLICT DO NOTHING;

-- ── Seed: tarifas ────────────────────────────────────────────────────────────
DO $$
DECLARE
  t_regular  UUID;
  t_profunda UUID;
  t_eventos  UUID;
  t_cocina   UUID;
  t_jardin   UUID;
BEGIN
  SELECT id INTO t_regular  FROM tipos_servicio_hogar WHERE nombre = 'Aseo Regular'        LIMIT 1;
  SELECT id INTO t_profunda FROM tipos_servicio_hogar WHERE nombre = 'Limpieza Profunda'   LIMIT 1;
  SELECT id INTO t_eventos  FROM tipos_servicio_hogar WHERE nombre = 'Atención en Eventos' LIMIT 1;
  SELECT id INTO t_cocina   FROM tipos_servicio_hogar WHERE nombre = 'Servicio de Cocina'  LIMIT 1;
  SELECT id INTO t_jardin   FROM tipos_servicio_hogar WHERE nombre = 'Jardín y Exteriores' LIMIT 1;

  -- Aseo Regular
  IF t_regular IS NOT NULL THEN
    INSERT INTO tarifas_servicio_hogar (tipo_id, nombre, duracion_horas, precio_unico, precio_semanal, precio_quincenal, precio_mensual, personas_incluidas) VALUES
      (t_regular, '2 horas',     2,  55000,  48000,  50000,  52000, 1),
      (t_regular, 'Medio día',   4,  95000,  85000,  88000,  90000, 1),
      (t_regular, 'Día completo',8, 170000, 150000, 155000, 160000, 1)
    ON CONFLICT DO NOTHING;
  END IF;

  -- Limpieza Profunda
  IF t_profunda IS NOT NULL THEN
    INSERT INTO tarifas_servicio_hogar (tipo_id, nombre, duracion_horas, precio_unico, precio_semanal, precio_quincenal, precio_mensual, personas_incluidas) VALUES
      (t_profunda, 'Medio día',    4, 140000, 120000, 125000, 130000, 1),
      (t_profunda, 'Día completo', 8, 250000, 220000, 230000, 240000, 1),
      (t_profunda, '2 personas - Medio día', 4, 240000, 210000, 220000, 230000, 2)
    ON CONFLICT DO NOTHING;
  END IF;

  -- Atención en Eventos
  IF t_eventos IS NOT NULL THEN
    INSERT INTO tarifas_servicio_hogar (tipo_id, nombre, duracion_horas, precio_unico, personas_incluidas) VALUES
      (t_eventos, '4 horas - 1 persona',   4, 160000, 1),
      (t_eventos, '8 horas - 1 persona',   8, 280000, 1),
      (t_eventos, '8 horas - 2 personas',  8, 480000, 2),
      (t_eventos, '12 horas - 2 personas',12, 650000, 2)
    ON CONFLICT DO NOTHING;
  END IF;

  -- Servicio de Cocina
  IF t_cocina IS NOT NULL THEN
    INSERT INTO tarifas_servicio_hogar (tipo_id, nombre, duracion_horas, precio_unico, precio_semanal, precio_mensual, personas_incluidas) VALUES
      (t_cocina, 'Medio día',    4, 120000, 100000,  95000, 1),
      (t_cocina, 'Día completo', 8, 210000, 180000, 170000, 1)
    ON CONFLICT DO NOTHING;
  END IF;

  -- Jardín
  IF t_jardin IS NOT NULL THEN
    INSERT INTO tarifas_servicio_hogar (tipo_id, nombre, duracion_horas, precio_unico, precio_semanal, precio_mensual, personas_incluidas) VALUES
      (t_jardin, '2 horas',   2, 70000, 60000, 55000, 1),
      (t_jardin, 'Medio día', 4, 120000,100000, 90000, 1)
    ON CONFLICT DO NOTHING;
  END IF;
END $$;

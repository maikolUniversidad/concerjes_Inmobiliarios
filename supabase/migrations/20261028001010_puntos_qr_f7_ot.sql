-- =============================================================================
-- PUNTOS QR · F7 (2 de 2) · Planes preventivos y órdenes de trabajo
-- =============================================================================
-- Segunda mitad de F7. La primera (`20261028001000_puntos_qr_f7_estados.sql`)
-- solo amplía el enum `estado_ticket_mant`, y ya está aplicada: aquí sí se
-- pueden usar los cuatro valores nuevos como dato, porque son de otra
-- transacción.
--
-- ESTE ARCHIVO TOCA UN MÓDULO EN PRODUCCIÓN (`/mantenimiento`). Lo que se
-- decidió, en `docs/puntos-qr-whatsapp/F7-propuesta-estados.md` §8, y lo que el
-- usuario aprobó:
--
--   1. La aprobación del cliente se registra con `ronda_firmas`
--      (`quien = 'CLIENTE'`) cuando hay visita, y con nombre + cargo + fecha
--      cuando no la hay. El cliente NO tiene cuenta de sesión en esta entrega.
--   2. La aprobación es obligatoria para cerrar SOLO en las OT de activos de
--      cliente; los tickets de maquinaria propia cierran como siempre. Con
--      aprobación TÁCITA por plazo de contrato, para que una orden no se quede
--      atascada en `RESUELTO` porque el cliente no contesta.
--   3. `ACEPTADO`, `EN_CAMINO` y `EN_SITIO` son OPCIONALES. El SLA de respuesta
--      se corta con la PRIMERA marca que exista.
--   4. `EN_SITIO` lo escribe el escaneo, no un botón. La salida para el QR
--      ilegible va marcada como apertura manual (`en_sitio_modo = 'MANUAL'`),
--      igual que hace F4 con el código impreso, para que se distingan en el
--      informe.
--   5. `grupo_id` nace **NULLABLE**, no `NOT NULL`. Esto se desvía de la
--      recomendación a propósito y por un hallazgo: la decisión 5 dependía de
--      que existiera un contrato interno de la empresa para los tickets de
--      maquinaria propia, y **no existe**. Los siete `grupos_contrato` de la
--      base son todos de cliente, y `maquinaria` no cuelga de un contrato sino
--      de `ubicacion_sede_id` (nullable: 49 de los 119 equipos no tienen ni
--      sede). Inventar un contrato en producción para que un `NOT NULL` cuadre
--      sería peor que una columna nullable, así que el ticket de maquinaria
--      propia lleva `grupo_id` nulo y la RLS lleva la condición doble.
--   6. El alcance por contrato en la lectura de tickets entra AQUÍ, con la
--      condición por fila y **sin tocar `mant_puede_participar()`**, de la que
--      cuelga el módulo que ya está en producción.
--
-- LO QUE HABÍA QUE ARREGLAR Y NO FALLABA CON UN ERROR CLARO
-- Cuatro sitios en SQL daban por hecho que `maquinaria_id` nunca es nulo, y con
-- una OT de activo cada uno fallaba distinto:
--   · `mant_transicion`  → llamaba `maq_evento(m.id, …)` con `m.id` nulo y
--                          reventaba por el `NOT NULL` de `maquinaria_eventos`,
--                          a mitad de la transición.
--   · `mant_notificar`   → su `JOIN maquinaria` era INNER: no devolvía filas,
--                          el payload quedaba nulo y la notificación salía
--                          vacía **en silencio** (la función se traga las
--                          excepciones a propósito).
--   · `mant_reportar`    → exigía `p_maquinaria` y moría con «Equipo no
--                          encontrado».
--   · `mantenimiento_actividades` → `maquinaria_id NOT NULL`: la actividad de
--                          una OT no tenía dónde guardarse. No se toca esa
--                          tabla: la bitácora de la OT vive en el motor de F4
--                          (`ronda_visitas` + `ronda_respuestas` +
--                          `ronda_evidencias`), que es más completo.
--
-- EL INVENTARIO VA POR EL CAMINO QUE YA EXISTE
-- Los materiales de una OT mueven stock de verdad, y lo hacen llamando a
-- `registrar_movimiento()` como el resto de las salidas. No se escribe `stock`
-- directamente: en este repositorio `cantidad_disp = cantidad_real − reservado`
-- lo mantiene un trigger de `stock`, y escribir la columna a mano se perdería
-- en el siguiente recálculo. La validación de existencias se hace contra
-- `cantidad_real` (el físico), igual que `ejecutar_reembasado`.
-- =============================================================================

-- ── 1) Plazos: horas de SLA sobre el calendario de días hábiles ─────────────
-- `grupo_sla` guarda `respuesta_horas` / `solucion_horas` y un booleano
-- `horas_habiles`. Cuando es falso, el plazo es tiempo corrido. Cuando es
-- verdadero hay que saltar fines de semana y festivos, y para eso ya existe el
-- calendario compartido de PQRS (`pqrs_dias_no_habiles`, que alimenta
-- `pqrs_sumar_habiles`): no se crea un segundo calendario.
--
-- La jornada se toma de 8 horas. Es un supuesto, y está aquí en una constante
-- con nombre para que se pueda discutir en un sitio y no en catorce.
CREATE OR REPLACE FUNCTION public.mant_vence_sla(
  p_desde TIMESTAMPTZ, p_horas NUMERIC, p_habiles BOOLEAN DEFAULT true
) RETURNS TIMESTAMPTZ
LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE
  c_jornada CONSTANT NUMERIC := 8;          -- horas hábiles de un día
  v_quedan  NUMERIC;
  v_fecha   DATE;
  v_hora    TEXT;
  v_tope    INTEGER := 0;
BEGIN
  IF p_desde IS NULL OR p_horas IS NULL OR p_horas <= 0 THEN RETURN NULL; END IF;
  IF NOT COALESCE(p_habiles, true) THEN
    RETURN p_desde + make_interval(hours => floor(p_horas)::int,
                                   mins  => round((p_horas - floor(p_horas)) * 60)::int);
  END IF;

  v_quedan := p_horas;
  v_fecha  := (p_desde AT TIME ZONE 'America/Bogota')::date;
  v_hora   := to_char(p_desde AT TIME ZONE 'America/Bogota', 'HH24:MI:SS');

  -- Se consume una jornada por cada día hábil hasta que quede menos de una;
  -- el resto se suma como horas sobre el último día hábil alcanzado.
  WHILE v_quedan > c_jornada AND v_tope < 2000 LOOP
    v_fecha := v_fecha + 1;
    v_tope  := v_tope + 1;
    IF EXTRACT(ISODOW FROM v_fecha) <= 5
       AND NOT EXISTS (SELECT 1 FROM pqrs_dias_no_habiles d WHERE d.fecha = v_fecha) THEN
      v_quedan := v_quedan - c_jornada;
    END IF;
  END LOOP;

  RETURN ((v_fecha::text || ' ' || v_hora)::timestamp AT TIME ZONE 'America/Bogota')
         + make_interval(hours => floor(v_quedan)::int,
                         mins  => round((v_quedan - floor(v_quedan)) * 60)::int);
END; $$;
COMMENT ON FUNCTION public.mant_vence_sla(TIMESTAMPTZ, NUMERIC, BOOLEAN) IS
  'Cuándo vence un plazo de N horas desde una fecha. Si el contrato pide horas hábiles, salta fines de semana y los festivos de pqrs_dias_no_habiles (jornada de 8 h).';
GRANT EXECUTE ON FUNCTION public.mant_vence_sla(TIMESTAMPTZ, NUMERIC, BOOLEAN) TO authenticated;

-- Plazo de la aprobación tácita, por contrato. Columna nueva en la tabla de
-- ANS de F1: aditiva y con default, así que no cambia nada de lo que ya hay.
ALTER TABLE grupo_sla ADD COLUMN IF NOT EXISTS aprobacion_dias_habiles SMALLINT;
COMMENT ON COLUMN grupo_sla.aprobacion_dias_habiles IS
  'Días hábiles que tiene el cliente para aprobar una orden de trabajo resuelta antes de que se apruebe tácitamente. NULL = el default de mant_aprobar_tacitos (3).';

-- ── 2) Planes preventivos ───────────────────────────────────────────────────
-- Hoy el "plan" es una sola columna de la ficha del equipo
-- (`maquinaria.proximo_mant`, que un trigger mueve con `frecuencia_mant_dias`).
-- §2.2 pide más: frecuencia por calendario **o por medidor**, anticipación,
-- tolerancia, técnico o proveedor, duración, tareas que son plantillas del
-- motor de F4 y materiales esperados.
--
-- Un plan apunta a UNO de tres objetos, y de ahí sale a qué se aplica:
--   · `activo_tipo_id` → a todos los activos de ese tipo (el plan normativo:
--     la recarga anual del extintor se escribe una vez).
--   · `activo_id`      → a ese activo y nada más.
--   · `maquinaria_id`  → a un equipo propio de la empresa.
CREATE SEQUENCE IF NOT EXISTS mant_plan_seq;

CREATE TABLE IF NOT EXISTS mant_planes (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo                VARCHAR(30) NOT NULL UNIQUE
                        DEFAULT ('PM-' || lpad(nextval('mant_plan_seq')::text, 6, '0')),
  nombre                VARCHAR(200) NOT NULL,
  descripcion           TEXT,
  -- NULL = el plan vale para todos los contratos (el plan normativo general).
  grupo_id              UUID REFERENCES grupos_contrato(id) ON DELETE CASCADE,
  activo_tipo_id        UUID REFERENCES activo_tipos(id)    ON DELETE CASCADE,
  activo_id             UUID REFERENCES activos(id)         ON DELETE CASCADE,
  maquinaria_id         UUID REFERENCES maquinaria(id)      ON DELETE CASCADE,
  frecuencia_tipo       VARCHAR(10) NOT NULL
                        CHECK (frecuencia_tipo IN ('DIAS','SEMANAS','MESES','MEDIDOR')),
  frecuencia_valor      NUMERIC(12,2) NOT NULL CHECK (frecuencia_valor > 0),
  medidor_id            UUID REFERENCES activo_medidores(id) ON DELETE SET NULL,
  anticipacion_dias     SMALLINT NOT NULL DEFAULT 7  CHECK (anticipacion_dias  >= 0),
  tolerancia_dias       SMALLINT NOT NULL DEFAULT 0  CHECK (tolerancia_dias    >= 0),
  vence_alerta_dias     SMALLINT NOT NULL DEFAULT 3  CHECK (vence_alerta_dias  >= 0),
  obligatorio_normativo BOOLEAN NOT NULL DEFAULT false,
  normativa             VARCHAR(120),
  tipo_ticket           VARCHAR(20) NOT NULL DEFAULT 'PREVENTIVO'
                        CHECK (tipo_ticket IN ('PREVENTIVO','INSPECCION')),
  prioridad             VARCHAR(10) NOT NULL DEFAULT 'MEDIA'
                        CHECK (prioridad IN ('BAJA','MEDIA','ALTA','CRITICA')),
  duracion_estimada_min SMALLINT,
  asignado_a            UUID REFERENCES usuarios(id)    ON DELETE SET NULL,
  rol_id                UUID REFERENCES roles(id)       ON DELETE SET NULL,
  proveedor_id          UUID REFERENCES proveedores(id) ON DELETE SET NULL,
  activo                BOOLEAN NOT NULL DEFAULT true,
  created_by            UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Exactamente un objeto: ni cero (no se sabría a qué aplicar) ni dos.
  CONSTRAINT mant_planes_objeto
    CHECK (num_nonnulls(activo_tipo_id, activo_id, maquinaria_id) = 1),
  -- Un plan por medidor sin medidor no se puede calcular.
  CONSTRAINT mant_planes_medidor
    CHECK (frecuencia_tipo <> 'MEDIDOR' OR medidor_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_mant_planes_tipo   ON mant_planes(activo_tipo_id) WHERE activo_tipo_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_mant_planes_activo ON mant_planes(activo_id)      WHERE activo_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_mant_planes_maq    ON mant_planes(maquinaria_id)  WHERE maquinaria_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_mant_planes_grupo  ON mant_planes(grupo_id);

DROP TRIGGER IF EXISTS tr_mant_planes_upd ON mant_planes;
CREATE TRIGGER tr_mant_planes_upd BEFORE UPDATE ON mant_planes
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE mant_planes IS
  'Plan de mantenimiento preventivo. Apunta a un tipo de activo, a un activo o a un equipo propio, y su frecuencia es de calendario (DIAS/SEMANAS/MESES) o de medidor.';

-- Las tareas del plan SON plantillas del motor de F4: no se inventa un segundo
-- catálogo de pasos. Se puede fijar la plantilla por id, o por código para que
-- cada contrato use su versión publicada (el ajuste del contrato tapa a la
-- general, F3).
CREATE TABLE IF NOT EXISTS mant_plan_tareas (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id          UUID NOT NULL REFERENCES mant_planes(id) ON DELETE CASCADE,
  orden            SMALLINT NOT NULL DEFAULT 1,
  plantilla_id     UUID REFERENCES ronda_plantillas(id) ON DELETE RESTRICT,
  plantilla_codigo VARCHAR(30),
  descripcion      TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT mant_plan_tareas_que CHECK (plantilla_id IS NOT NULL OR plantilla_codigo IS NOT NULL),
  UNIQUE (plan_id, orden)
);
CREATE INDEX IF NOT EXISTS idx_mant_plan_tareas_plan ON mant_plan_tareas(plan_id, orden);

-- Materiales esperados del plan: sirven para alistar antes de salir. No mueven
-- stock (eso lo hace el consumo real de la OT, en `mant_materiales`).
CREATE TABLE IF NOT EXISTS mant_plan_materiales (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id     UUID NOT NULL REFERENCES mant_planes(id) ON DELETE CASCADE,
  producto_id UUID NOT NULL REFERENCES productos(id)   ON DELETE RESTRICT,
  cantidad    NUMERIC(12,2) NOT NULL CHECK (cantidad > 0),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (plan_id, producto_id)
);
CREATE INDEX IF NOT EXISTS idx_mant_plan_mat_plan ON mant_plan_materiales(plan_id);

-- ── 3) La orden de trabajo es el ticket que ya existe ───────────────────────
-- Una sola tabla, un solo autómata, un solo chat. Lo que distingue una OT de un
-- ticket de maquinaria es de qué cuelga (`activo_id` en vez de `maquinaria_id`),
-- no una bandera nueva.
ALTER TABLE mantenimiento_tickets
  ADD COLUMN IF NOT EXISTS activo_id               UUID REFERENCES activos(id)         ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS grupo_id                UUID REFERENCES grupos_contrato(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS plan_id                 UUID REFERENCES mant_planes(id)     ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS visita_id               UUID REFERENCES ronda_visitas(id)   ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS pqrs_id                 UUID REFERENCES pqrs(id)            ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS proveedor_id            UUID REFERENCES proveedores(id)     ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS origen                  VARCHAR(10) NOT NULL DEFAULT 'TICKET',
  ADD COLUMN IF NOT EXISTS activo_codigo           VARCHAR(30),
  ADD COLUMN IF NOT EXISTS activo_nombre           VARCHAR(200),
  ADD COLUMN IF NOT EXISTS estado_activo_reportado VARCHAR(14),
  ADD COLUMN IF NOT EXISTS estado_activo_final     VARCHAR(14),
  ADD COLUMN IF NOT EXISTS aceptado_at             TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS en_camino_at            TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS en_sitio_at             TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS en_sitio_modo           VARCHAR(10),
  ADD COLUMN IF NOT EXISTS sla_respuesta_vence_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS sla_solucion_vence_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS aprobado_cliente_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS aprobado_cliente_nombre VARCHAR(200),
  ADD COLUMN IF NOT EXISTS aprobado_cliente_cargo  VARCHAR(120),
  ADD COLUMN IF NOT EXISTS aprobado_tacito         BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS aprobacion_vence_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS firma_tecnico_id        UUID REFERENCES ronda_firmas(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS firma_cliente_id        UUID REFERENCES ronda_firmas(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS costo_mano_obra         NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS costo_materiales        NUMERIC(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reabierto_de            UUID REFERENCES mantenimiento_tickets(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reaperturas             SMALLINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS medidor_id              UUID REFERENCES activo_medidores(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS medidor_valor           NUMERIC(14,3);

-- `maquinaria_id` deja de ser obligatorio, y en su lugar manda el CHECK: una OT
-- cuelga de un activo del cliente y un ticket de siempre cuelga de un equipo
-- propio, pero nunca de los dos ni de ninguno. Con cero filas en la tabla el
-- CHECK entra sin validar nada; con mil, habría que rellenar a mano.
ALTER TABLE mantenimiento_tickets ALTER COLUMN maquinaria_id DROP NOT NULL;
DO $$ BEGIN
  ALTER TABLE mantenimiento_tickets ADD CONSTRAINT mant_tickets_objeto
    CHECK (num_nonnulls(maquinaria_id, activo_id) = 1);
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE mantenimiento_tickets ADD CONSTRAINT mant_tickets_origen
    CHECK (origen IN ('TICKET','PLAN','VISITA','PQRS','CLIENTE','BOT','IOT'));
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE mantenimiento_tickets ADD CONSTRAINT mant_tickets_en_sitio_modo
    CHECK (en_sitio_modo IS NULL OR en_sitio_modo IN ('QR','MANUAL'));
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE mantenimiento_tickets ADD CONSTRAINT mant_tickets_estado_activo
    CHECK ((estado_activo_reportado IS NULL OR estado_activo_reportado IN ('OPERATIVO','DEGRADADO','FUERA_SERVICIO','RETIRADO'))
       AND (estado_activo_final     IS NULL OR estado_activo_final     IN ('OPERATIVO','DEGRADADO','FUERA_SERVICIO','RETIRADO')));
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- El cumplimiento del SLA no se escribe: se calcula. Columnas generadas, para
-- que no puedan quedar desfasadas de las marcas de tiempo de las que salen.
-- `LEAST` ignora los nulos, que es exactamente lo que hace falta con tres
-- estados intermedios opcionales (decisión 3): corta el primero que exista.
DO $$ BEGIN
  ALTER TABLE mantenimiento_tickets ADD COLUMN respondido_at TIMESTAMPTZ
    GENERATED ALWAYS AS (LEAST(aceptado_at, en_camino_at, en_sitio_at, iniciado_at, recibido_at)) STORED;
EXCEPTION WHEN duplicate_column THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE mantenimiento_tickets ADD COLUMN sla_respuesta_cumplido BOOLEAN
    GENERATED ALWAYS AS (
      CASE WHEN sla_respuesta_vence_at IS NULL THEN NULL
           WHEN LEAST(aceptado_at, en_camino_at, en_sitio_at, iniciado_at, recibido_at) IS NULL THEN NULL
           ELSE LEAST(aceptado_at, en_camino_at, en_sitio_at, iniciado_at, recibido_at) <= sla_respuesta_vence_at
      END) STORED;
EXCEPTION WHEN duplicate_column THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE mantenimiento_tickets ADD COLUMN sla_solucion_cumplido BOOLEAN
    GENERATED ALWAYS AS (
      CASE WHEN sla_solucion_vence_at IS NULL THEN NULL
           WHEN resuelto_at IS NULL THEN NULL
           ELSE resuelto_at <= sla_solucion_vence_at
      END) STORED;
EXCEPTION WHEN duplicate_column THEN null; END $$;

CREATE INDEX IF NOT EXISTS idx_mant_tickets_activo  ON mantenimiento_tickets(activo_id, created_at DESC) WHERE activo_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_mant_tickets_grupo   ON mantenimiento_tickets(grupo_id)  WHERE grupo_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_mant_tickets_plan    ON mantenimiento_tickets(plan_id)   WHERE plan_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_mant_tickets_visita  ON mantenimiento_tickets(visita_id) WHERE visita_id IS NOT NULL;
-- Para `mant_aprobar_tacitos`: solo las resueltas con plazo vencido.
CREATE INDEX IF NOT EXISTS idx_mant_tickets_aprob   ON mantenimiento_tickets(aprobacion_vence_at)
  WHERE estado = 'RESUELTO' AND aprobacion_vence_at IS NOT NULL;

COMMENT ON COLUMN mantenimiento_tickets.grupo_id IS
  'Contrato de la orden de trabajo, copiado del activo. NULL en los tickets de maquinaria propia: la empresa no tiene un contrato interno en grupos_contrato y no se inventa uno. La RLS lleva la condición doble por eso.';
COMMENT ON COLUMN mantenimiento_tickets.en_sitio_modo IS
  'QR = lo escribió el escaneo de la placa (la garantía de que el técnico llegó). MANUAL = salida para el QR ilegible, se distingue en el informe.';
COMMENT ON COLUMN mantenimiento_tickets.aprobado_tacito IS
  'TRUE si la orden se aprobó por vencimiento del plazo del contrato y no por firma del cliente.';
COMMENT ON COLUMN mantenimiento_tickets.respondido_at IS
  'Primera señal de respuesta del técnico (aceptó / salió / llegó / inició / recibió). Columna generada: de aquí sale el SLA de respuesta, y por eso no asume que los tres estados intermedios existan.';

-- ── 4) Derivación y plazos del ticket ───────────────────────────────────────
-- Un solo trigger pone lo que se deduce del objeto: contrato, sede, nombres
-- desnormalizados (la RLS de `activos` no deja ver el activo de otro contrato,
-- igual que pasa con `usuarios`) y los dos plazos de SLA.
CREATE OR REPLACE FUNCTION public.tr_mant_tickets_derivar()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_a   RECORD;
  v_sla RECORD;
  v_base TIMESTAMPTZ;
BEGIN
  IF NEW.activo_id IS NOT NULL THEN
    SELECT a.grupo_id, a.sede_id, a.codigo, a.nombre
      INTO v_a FROM activos a WHERE a.id = NEW.activo_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'El activo del ticket no existe.'; END IF;
    NEW.grupo_id      := v_a.grupo_id;
    NEW.sede_id       := COALESCE(NEW.sede_id, v_a.sede_id);
    NEW.activo_codigo := v_a.codigo;
    NEW.activo_nombre := v_a.nombre;
  ELSE
    -- Maquinaria propia: sin contrato (ver la cabecera de este archivo).
    NEW.grupo_id      := NULL;
    NEW.activo_codigo := NULL;
    NEW.activo_nombre := NULL;
  END IF;

  -- Los plazos solo existen cuando hay contrato que los pacte.
  IF TG_OP = 'INSERT'
     OR NEW.prioridad IS DISTINCT FROM OLD.prioridad
     OR NEW.grupo_id  IS DISTINCT FROM OLD.grupo_id THEN
    IF NEW.grupo_id IS NULL THEN
      NEW.sla_respuesta_vence_at := NULL;
      NEW.sla_solucion_vence_at  := NULL;
    ELSE
      -- La fila de la prioridad exacta; si el contrato no la pactó, la de MEDIA.
      SELECT s.respuesta_horas, s.solucion_horas, s.horas_habiles INTO v_sla
        FROM grupo_sla s
       WHERE s.grupo_id = NEW.grupo_id AND s.servicio = 'MANTENIMIENTO'
         AND s.prioridad = NEW.prioridad;
      IF NOT FOUND THEN
        SELECT s.respuesta_horas, s.solucion_horas, s.horas_habiles INTO v_sla
          FROM grupo_sla s
         WHERE s.grupo_id = NEW.grupo_id AND s.servicio = 'MANTENIMIENTO'
           AND s.prioridad = 'MEDIA';
      END IF;
      v_base := COALESCE(NEW.created_at, NOW());
      NEW.sla_respuesta_vence_at := public.mant_vence_sla(v_base, v_sla.respuesta_horas, v_sla.horas_habiles);
      NEW.sla_solucion_vence_at  := public.mant_vence_sla(v_base, v_sla.solucion_horas,  v_sla.horas_habiles);
    END IF;
  END IF;

  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS tr_mant_tickets_derivar ON mantenimiento_tickets;
CREATE TRIGGER tr_mant_tickets_derivar BEFORE INSERT OR UPDATE ON mantenimiento_tickets
  FOR EACH ROW EXECUTE FUNCTION public.tr_mant_tickets_derivar();

-- `costo` sigue siendo el total, para no romper lo que ya lo lee; ahora es la
-- suma de mano de obra y materiales, mantenida por la base.
CREATE OR REPLACE FUNCTION public.tr_mant_tickets_costo()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.costo_mano_obra IS NOT NULL OR NEW.costo_materiales <> 0 THEN
    NEW.costo := COALESCE(NEW.costo_mano_obra, 0) + COALESCE(NEW.costo_materiales, 0);
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS tr_mant_tickets_costo ON mantenimiento_tickets;
CREATE TRIGGER tr_mant_tickets_costo BEFORE INSERT OR UPDATE ON mantenimiento_tickets
  FOR EACH ROW EXECUTE FUNCTION public.tr_mant_tickets_costo();

-- ── 5) Materiales de la orden: mueven stock de verdad ───────────────────────
CREATE TABLE IF NOT EXISTS mant_materiales (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id       UUID NOT NULL REFERENCES mantenimiento_tickets(id) ON DELETE CASCADE,
  producto_id     UUID NOT NULL REFERENCES productos(id) ON DELETE RESTRICT,
  producto_nombre VARCHAR(300),
  cantidad        NUMERIC(12,2) NOT NULL CHECK (cantidad > 0),
  costo_unitario  NUMERIC(14,2),
  costo_total     NUMERIC(16,2) GENERATED ALWAYS AS (cantidad * COALESCE(costo_unitario, 0)) STORED,
  -- El movimiento de salida que descontó el inventario. Es la prueba de que el
  -- consumo pasó por el camino de siempre y no por un UPDATE a `stock`.
  movimiento_id   UUID REFERENCES movimientos(id) ON DELETE SET NULL,
  usuario_id      UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  usuario_nombre  VARCHAR(200),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_mant_mat_ticket   ON mant_materiales(ticket_id, created_at);
CREATE INDEX IF NOT EXISTS idx_mant_mat_producto ON mant_materiales(producto_id);

COMMENT ON TABLE mant_materiales IS
  'Materiales consumidos por una orden de trabajo. Cada fila tiene su movimiento de SALIDA: el consumo descuenta inventario por registrar_movimiento(), no escribiendo stock.';

-- El costo de materiales del ticket lo mantiene la base, no la pantalla.
CREATE OR REPLACE FUNCTION public.tr_mant_materiales_costo()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_ticket UUID := COALESCE(NEW.ticket_id, OLD.ticket_id);
BEGIN
  UPDATE mantenimiento_tickets t
     SET costo_materiales = COALESCE((SELECT SUM(m.costo_total) FROM mant_materiales m WHERE m.ticket_id = v_ticket), 0)
   WHERE t.id = v_ticket;
  RETURN NULL;
END; $$;
DROP TRIGGER IF EXISTS tr_mant_materiales_costo ON mant_materiales;
CREATE TRIGGER tr_mant_materiales_costo AFTER INSERT OR UPDATE OR DELETE ON mant_materiales
  FOR EACH ROW EXECUTE FUNCTION public.tr_mant_materiales_costo();

-- ── 6) La visita de F4 sabe de qué orden viene ──────────────────────────────
ALTER TABLE ronda_visitas ADD COLUMN IF NOT EXISTS ticket_id UUID;
DO $$ BEGIN
  ALTER TABLE ronda_visitas ADD CONSTRAINT ronda_visitas_ticket_fk
    FOREIGN KEY (ticket_id) REFERENCES mantenimiento_tickets(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN null; END $$;
CREATE INDEX IF NOT EXISTS idx_ronda_visitas_ticket ON ronda_visitas(ticket_id) WHERE ticket_id IS NOT NULL;
COMMENT ON COLUMN ronda_visitas.ticket_id IS
  'Orden de trabajo que se ejecutó en esta visita (F7). La OT no construye un segundo flujo de ejecución: es una visita del motor de F4.';

-- ── 7) `mant_notificar`: deja de fallar en silencio con una OT ──────────────
-- El `JOIN maquinaria` era INNER. Con `maquinaria_id` nulo no devolvía filas,
-- `v` quedaba nulo y se emitía el evento con payload vacío sin que nadie se
-- enterara, porque la función se traga las excepciones a propósito (notificar
-- no debe tumbar la operación principal). Ahora son dos LEFT JOIN y el objeto
-- se nombra con el que exista.
CREATE OR REPLACE FUNCTION public.mant_notificar(p_codigo TEXT, p_ticket UUID, p_extra JSONB DEFAULT '{}')
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v JSONB;
BEGIN
  SELECT jsonb_build_object(
           'ticket_id', t.id, 'numero', t.numero, 'titulo', t.titulo, 'tipo', t.tipo,
           'prioridad', t.prioridad, 'estado', t.estado,
           'equipo_codigo', COALESCE(m.codigo, t.activo_codigo),
           'equipo_nombre', COALESCE(m.nombre, t.activo_nombre),
           'es_orden_trabajo', (t.activo_id IS NOT NULL),
           'contrato', g.codigo::text,
           'sede', COALESCE(s.nombre, t.activo_nombre),
           'reportado_por', t.reportado_nombre,
           'asignado_a', ua.nombre, 'enlace', '/mantenimiento/' || t.id)
         || COALESCE(p_extra, '{}')
    INTO v
    FROM mantenimiento_tickets t
    LEFT JOIN maquinaria m        ON m.id = t.maquinaria_id
    LEFT JOIN activos a           ON a.id = t.activo_id
    LEFT JOIN grupos_contrato g   ON g.id = t.grupo_id
    LEFT JOIN sedes s             ON s.id = t.sede_id
    LEFT JOIN usuarios ua         ON ua.id = t.asignado_a
   WHERE t.id = p_ticket;
  IF v IS NULL THEN
    RAISE WARNING 'mant_notificar(%): el ticket % no existe', p_codigo, p_ticket;
    RETURN;
  END IF;
  PERFORM public.emitir_evento(p_codigo, v, 'MantenimientoTicket', p_ticket::text);
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'mant_notificar(%): %', p_codigo, SQLERRM;
END; $$;
REVOKE ALL ON FUNCTION public.mant_notificar(TEXT, UUID, JSONB) FROM PUBLIC;

-- ── 8) Bitácora: el evento del equipo solo existe si hay equipo ─────────────
-- `maq_evento` escribe en `maquinaria_eventos`, cuyo `maquinaria_id` es
-- NOT NULL. Para la OT de un activo no hay dónde escribirlo, así que la
-- bitácora visible es el chat del ticket (`mant_sistema`, que ya se llama en
-- todas las transiciones) más la visita de F4. Este envoltorio evita repetir
-- el `IF` en cada rama del autómata.
CREATE OR REPLACE FUNCTION public.mant_evento_objeto(
  p_ticket UUID, p_texto TEXT, p_detalle JSONB DEFAULT NULL
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_maq UUID;
BEGIN
  SELECT maquinaria_id INTO v_maq FROM mantenimiento_tickets WHERE id = p_ticket;
  IF v_maq IS NULL THEN RETURN; END IF;   -- OT de activo: no hay hoja de vida de maquinaria
  PERFORM public.maq_evento(v_maq, 'MANTENIMIENTO', NULL, NULL, NULL, p_texto, NULL, p_detalle);
END; $$;
REVOKE ALL ON FUNCTION public.mant_evento_objeto(UUID, TEXT, JSONB) FROM PUBLIC;

-- ── 9) `mant_reportar`: acepta un activo del cliente ────────────────────────
-- Se BORRA la firma vieja antes de crear la nueva. Si se dejara, `CREATE OR
-- REPLACE` con parámetros nuevos crearía una SOBRECARGA y conviviría con la de
-- ocho argumentos: Supabase llama por nombre y fallaría con «could not choose
-- the best candidate function».
DROP FUNCTION IF EXISTS public.mant_reportar(UUID, TEXT, TEXT, TEXT, TEXT, estado_maquinaria, TEXT[], DATE, UUID);

CREATE OR REPLACE FUNCTION public.mant_reportar(
  p_tipo          TEXT,
  p_prioridad     TEXT,
  p_titulo        TEXT,
  p_maquinaria    UUID    DEFAULT NULL,
  p_activo        UUID    DEFAULT NULL,
  p_descripcion   TEXT    DEFAULT NULL,
  p_estado_equipo estado_maquinaria DEFAULT NULL,
  p_estado_activo TEXT    DEFAULT NULL,
  p_fotos         TEXT[]  DEFAULT '{}',
  p_programado    DATE    DEFAULT NULL,
  p_asignado      UUID    DEFAULT NULL,
  p_plan          UUID    DEFAULT NULL,
  p_origen        TEXT    DEFAULT 'TICKET',
  p_proveedor     UUID    DEFAULT NULL,
  p_pqrs          UUID    DEFAULT NULL,
  p_medidor       UUID    DEFAULT NULL,
  p_medidor_valor NUMERIC DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid     UUID := (SELECT auth.uid());
  v_nombre  VARCHAR(200);
  v_maq     maquinaria%ROWTYPE;
  v_act     activos%ROWTYPE;
  v_id      UUID;
  v_numero  VARCHAR(30);
  v_tipo    TEXT := upper(COALESCE(p_tipo, 'CORRECTIVO'));
  v_origen  TEXT := upper(COALESCE(p_origen, 'TICKET'));
  v_prio    TEXT := upper(COALESCE(p_prioridad, 'MEDIA'));
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Sesión requerida'; END IF;
  IF num_nonnulls(p_maquinaria, p_activo) <> 1 THEN
    RAISE EXCEPTION 'Un reporte es sobre un equipo propio o sobre un activo del cliente, no sobre los dos ni sobre ninguno.';
  END IF;
  IF NULLIF(btrim(p_titulo), '') IS NULL THEN RAISE EXCEPTION 'Describe brevemente la falla.'; END IF;

  -- Permisos. Programar (preventivo/inspección) o asignar siempre es de
  -- mantenimiento; reportar una falla lo puede hacer el personal de sede.
  IF v_tipo IN ('PREVENTIVO','INSPECCION') OR p_asignado IS NOT NULL THEN
    IF NOT public.auth_permiso_any('{atender_mantenimiento,gestionar_mantenimiento}'::text[]) THEN
      RAISE EXCEPTION 'No tienes permiso para programar mantenimientos.';
    END IF;
  ELSIF p_activo IS NOT NULL THEN
    -- Sobre un activo del cliente también entra quien ejecuta rondas o gestiona
    -- activos: es quien está en la sede y ve la falla.
    IF NOT public.auth_permiso_any('{reportar_falla_maquinaria,atender_mantenimiento,gestionar_mantenimiento,ejecutar_rondas,gestionar_activos_ronda}'::text[]) THEN
      RAISE EXCEPTION 'No tienes permiso para reportar fallas de los activos del cliente.';
    END IF;
  ELSIF NOT public.auth_permiso_any('{reportar_falla_maquinaria,atender_mantenimiento,gestionar_mantenimiento}'::text[]) THEN
    RAISE EXCEPTION 'No tienes permiso para reportar fallas de maquinaria.';
  END IF;

  IF p_maquinaria IS NOT NULL THEN
    SELECT * INTO v_maq FROM maquinaria WHERE id = p_maquinaria;
    IF NOT FOUND THEN RAISE EXCEPTION 'Equipo no encontrado.'; END IF;
    IF v_maq.estado = 'BAJA' OR v_maq.activo = false THEN
      RAISE EXCEPTION 'El equipo % está dado de baja.', v_maq.codigo;
    END IF;
  ELSE
    SELECT * INTO v_act FROM activos WHERE id = p_activo;
    IF NOT FOUND THEN RAISE EXCEPTION 'Activo no encontrado.'; END IF;
    IF v_act.estado = 'RETIRADO' OR v_act.activo = false THEN
      RAISE EXCEPTION 'El activo % está retirado.', v_act.codigo;
    END IF;
    -- El alcance por contrato, con la función que dejó F6 para esto.
    IF NOT public.activo_en_alcance(p_activo) THEN
      RAISE EXCEPTION 'Ese activo no está en tu alcance.';
    END IF;
    IF NOT public.grupo_vigente(v_act.grupo_id) THEN
      RAISE EXCEPTION 'El contrato de esa sede no está vigente.';
    END IF;
  END IF;

  SELECT nombre INTO v_nombre FROM usuarios WHERE id = v_uid;
  v_numero := 'MT-' || to_char(NOW(), 'YYYYMM') || '-' || lpad(nextval('mantenimiento_ticket_seq')::text, 5, '0');

  INSERT INTO mantenimiento_tickets (
    numero, maquinaria_id, activo_id, sede_id, tipo, prioridad, titulo, descripcion,
    estado_equipo_reportado, estado_activo_reportado, fotos, programado_para,
    reportado_por, reportado_nombre, asignado_a, estado,
    plan_id, origen, proveedor_id, pqrs_id, medidor_id, medidor_valor)
  VALUES (
    v_numero, p_maquinaria, p_activo,
    COALESCE(v_maq.ubicacion_sede_id, v_act.sede_id),
    v_tipo, v_prio, btrim(p_titulo), NULLIF(btrim(p_descripcion), ''),
    p_estado_equipo, NULLIF(upper(p_estado_activo), ''),
    COALESCE(p_fotos, '{}'), p_programado,
    v_uid, v_nombre, p_asignado,
    CASE WHEN p_asignado IS NULL THEN 'ABIERTO' ELSE 'RECIBIDO' END::estado_ticket_mant,
    p_plan, v_origen, p_proveedor, p_pqrs, p_medidor, p_medidor_valor)
  RETURNING id INTO v_id;

  PERFORM set_config('app.mant_ticket', v_id::text, true);

  PERFORM public.mant_evento_objeto(v_id,
    CASE v_tipo
      WHEN 'CORRECTIVO'     THEN 'Falla reportada '
      WHEN 'SOPORTE_REMOTO' THEN 'Soporte remoto solicitado '
      WHEN 'PREVENTIVO'     THEN 'Preventivo programado '
      ELSE 'Inspección programada ' END
      || v_numero || ': ' || btrim(p_titulo),
    jsonb_build_object('numero', v_numero, 'prioridad', v_prio, 'origen', v_origen,
                       'fotos', to_jsonb(COALESCE(p_fotos, '{}'::text[])), 'descripcion', p_descripcion));

  -- Si quien reporta dice que el objeto no funciona, su ficha lo refleja ya.
  IF p_maquinaria IS NOT NULL AND p_estado_equipo IS NOT NULL
     AND p_estado_equipo IS DISTINCT FROM v_maq.estado
     AND p_estado_equipo IN ('DANADA','MANTENIMIENTO') THEN
    UPDATE maquinaria SET estado = p_estado_equipo WHERE id = v_maq.id;
  END IF;
  IF p_activo IS NOT NULL AND NULLIF(upper(p_estado_activo), '') IS NOT NULL
     AND upper(p_estado_activo) IS DISTINCT FROM v_act.estado
     AND upper(p_estado_activo) IN ('DEGRADADO','FUERA_SERVICIO') THEN
    UPDATE activos SET estado = upper(p_estado_activo) WHERE id = v_act.id;
  END IF;

  PERFORM mant_sistema(v_id, 'Ticket ' || v_numero || ' creado por ' || COALESCE(v_nombre, 'usuario') || '.');
  PERFORM mant_notificar('MANTENIMIENTO_REPORTADO', v_id);

  RETURN jsonb_build_object('id', v_id, 'numero', v_numero);
END; $$;
COMMENT ON FUNCTION public.mant_reportar(TEXT, TEXT, TEXT, UUID, UUID, TEXT, estado_maquinaria, TEXT, TEXT[], DATE, UUID, UUID, TEXT, UUID, UUID, UUID, NUMERIC) IS
  'Crea un ticket de mantenimiento sobre un equipo propio (p_maquinaria) o una orden de trabajo sobre un activo del cliente (p_activo): exactamente uno de los dos. El activo valida alcance por contrato y vigencia.';
GRANT EXECUTE ON FUNCTION public.mant_reportar(TEXT, TEXT, TEXT, UUID, UUID, TEXT, estado_maquinaria, TEXT, TEXT[], DATE, UUID, UUID, TEXT, UUID, UUID, UUID, NUMERIC) TO authenticated;

-- ── 10) El autómata ────────────────────────────────────────────────────────
-- Once estados, once acciones, un solo sitio. Sigue siendo la única forma de
-- mover `estado`: ninguna pantalla hace UPDATE.
--
-- Lo que cambia respecto de la versión en producción:
--   · La parte de la ficha del equipo solo corre si hay equipo. Antes
--     `maq_evento(m.id, …)` con `m.id` nulo rompía la transición a mitad.
--   · `INICIAR` acepta además `ACEPTADO`, `EN_CAMINO` y `EN_SITIO` (el camino
--     corto sigue intacto: de `RECIBIDO` a `EN_PROCESO` como siempre).
--   · `RESOLVER` acepta además `EN_SITIO` (una inspección que se resuelve sin
--     "ejecutar" nada).
--   · `CERRAR` exige `APROBADO_CLIENTE` **solo** si es una OT de activo de
--     cliente; para maquinaria propia sigue bastando `RESUELTO`.
--   · `ACEPTAR`, `SALIR` y `APROBAR_CLIENTE` son nuevas.
--   · `REABRIR` ahora cuenta la reapertura (el indicador de §2.4).
DROP FUNCTION IF EXISTS public.mant_transicion(UUID, TEXT, TEXT, estado_maquinaria, TEXT, TEXT, NUMERIC, UUID);

CREATE OR REPLACE FUNCTION public.mant_transicion(
  p_ticket          UUID,
  p_accion          TEXT,
  p_nota            TEXT DEFAULT NULL,
  p_estado_equipo   estado_maquinaria DEFAULT NULL,
  p_diagnostico     TEXT DEFAULT NULL,
  p_solucion        TEXT DEFAULT NULL,
  p_costo           NUMERIC DEFAULT NULL,
  p_asignado        UUID DEFAULT NULL,
  p_estado_activo   TEXT DEFAULT NULL,
  p_aprobado_nombre TEXT DEFAULT NULL,
  p_aprobado_cargo  TEXT DEFAULT NULL,
  p_firma           UUID DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid     UUID := (SELECT auth.uid());
  v_nombre  VARCHAR(200);
  t         mantenimiento_tickets%ROWTYPE;
  m         maquinaria%ROWTYPE;
  v_accion  TEXT := upper(p_accion);
  v_tecnico BOOLEAN := public.auth_permiso_any('{atender_mantenimiento,gestionar_mantenimiento}'::text[]);
  v_jefe    BOOLEAN := public.auth_permiso('gestionar_mantenimiento');
  v_sede    BOOLEAN := public.auth_permiso_any('{reportar_falla_maquinaria,ejecutar_rondas}'::text[]);
  v_ot      BOOLEAN;
  v_nuevo   estado_ticket_mant;
  v_texto   TEXT;
  v_equipo  estado_maquinaria;
  v_act_est TEXT;
  v_asig_nombre VARCHAR(200);
  v_dias    SMALLINT;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Sesión requerida'; END IF;
  SELECT * INTO t FROM mantenimiento_tickets WHERE id = p_ticket FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ticket no encontrado.'; END IF;
  v_ot := t.activo_id IS NOT NULL;
  IF t.maquinaria_id IS NOT NULL THEN
    SELECT * INTO m FROM maquinaria WHERE id = t.maquinaria_id;
  END IF;
  -- Alcance por contrato: una OT solo la mueve quien ve ese contrato.
  IF t.grupo_id IS NOT NULL AND NOT public.auth_ve_grupo(t.grupo_id) THEN
    RAISE EXCEPTION 'Esa orden de trabajo no está en tu alcance.';
  END IF;
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

  -- NUEVA. Solo el técnico asignado acepta: aceptar por otro no mide nada.
  WHEN 'ACEPTAR' THEN
    IF t.asignado_a IS NULL THEN RAISE EXCEPTION 'El ticket no tiene técnico asignado todavía.'; END IF;
    IF t.asignado_a <> v_uid THEN
      RAISE EXCEPTION 'Solo el técnico asignado puede aceptar la orden.';
    END IF;
    IF t.estado <> 'RECIBIDO' THEN
      RAISE EXCEPTION 'Solo se acepta una orden asignada (está en %).', t.estado;
    END IF;
    UPDATE mantenimiento_tickets SET estado = 'ACEPTADO', aceptado_at = NOW() WHERE id = t.id;
    v_nuevo := 'ACEPTADO';
    v_texto := 'Aceptada por ' || COALESCE(v_nombre, 'el técnico');

  -- NUEVA. Declarativa: vale lo que vale la palabra del técnico, y para el SLA
  -- de respuesta ya es bastante.
  WHEN 'SALIR' THEN
    IF t.asignado_a IS DISTINCT FROM v_uid THEN
      RAISE EXCEPTION 'Solo el técnico asignado marca que va en camino.';
    END IF;
    IF t.estado NOT IN ('RECIBIDO','ACEPTADO') THEN
      RAISE EXCEPTION 'No se puede salir hacia una orden en estado %.', t.estado;
    END IF;
    UPDATE mantenimiento_tickets
       SET estado = 'EN_CAMINO', en_camino_at = NOW(), aceptado_at = COALESCE(aceptado_at, NOW())
     WHERE id = t.id;
    v_nuevo := 'EN_CAMINO';
    v_texto := 'En camino';

  WHEN 'INICIAR' THEN
    IF NOT v_tecnico THEN RAISE EXCEPTION 'Solo mantenimiento puede iniciar el trabajo.'; END IF;
    IF t.estado NOT IN ('ABIERTO','RECIBIDO','ACEPTADO','EN_CAMINO','EN_SITIO','EN_ESPERA') THEN
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
    -- El equipo propio se va al taller. Un activo del cliente no se mueve de
    -- sitio, así que su estado no cambia por empezar a trabajarlo.
    IF t.maquinaria_id IS NOT NULL AND m.estado NOT IN ('MANTENIMIENTO','BAJA') THEN
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
    IF t.estado NOT IN ('RECIBIDO','ACEPTADO','EN_CAMINO','EN_SITIO','EN_PROCESO','EN_ESPERA') THEN
      RAISE EXCEPTION 'No se puede resolver un ticket en estado %.', t.estado;
    END IF;
    IF NULLIF(btrim(p_solucion), '') IS NULL THEN RAISE EXCEPTION 'Describe el trabajo realizado.'; END IF;
    v_equipo  := COALESCE(p_estado_equipo, 'OPERATIVA');
    v_act_est := COALESCE(NULLIF(upper(p_estado_activo), ''), 'OPERATIVO');

    -- Plazo de la aprobación tácita (decisión 2): se fija al resolver, solo
    -- para las OT de cliente. Sin este plazo las órdenes se quedarían en
    -- RESUELTO para siempre cuando el cliente no contesta, y el SLA de
    -- solución no se cortaría nunca.
    IF v_ot THEN
      SELECT s.aprobacion_dias_habiles INTO v_dias
        FROM grupo_sla s
       WHERE s.grupo_id = t.grupo_id AND s.servicio = 'MANTENIMIENTO'
         AND s.prioridad = t.prioridad;
    END IF;

    UPDATE mantenimiento_tickets
       SET estado = 'RESUELTO', resuelto_at = NOW(),
           iniciado_at = COALESCE(iniciado_at, NOW()),
           diagnostico = COALESCE(NULLIF(btrim(p_diagnostico), ''), diagnostico),
           solucion = btrim(p_solucion),
           costo_mano_obra = COALESCE(p_costo, costo_mano_obra),
           estado_equipo_final = CASE WHEN t.maquinaria_id IS NOT NULL THEN v_equipo END,
           estado_activo_final = CASE WHEN v_ot THEN v_act_est END,
           asignado_a = COALESCE(asignado_a, v_uid),
           -- Fin del día hábil que vence: medianoche del siguiente.
           aprobacion_vence_at = CASE WHEN v_ot
             THEN ((public.pqrs_sumar_habiles(CURRENT_DATE, COALESCE(v_dias, 3)::int) + 1)::timestamp
                   AT TIME ZONE 'America/Bogota') END
     WHERE id = t.id;
    v_nuevo := 'RESUELTO';
    v_texto := 'Resuelto: ' || btrim(p_solucion);

    IF t.maquinaria_id IS NOT NULL THEN
      UPDATE maquinaria
         SET estado = CASE WHEN estado = 'BAJA' THEN estado ELSE v_equipo END,
             ultimo_mant_at = NOW(),
             condicion = CASE WHEN v_equipo = 'OPERATIVA' AND condicion = 'MALA' THEN 'REGULAR' ELSE condicion END
       WHERE id = m.id;
    ELSE
      UPDATE activos
         SET estado = CASE WHEN estado = 'RETIRADO' THEN estado ELSE v_act_est END
       WHERE id = t.activo_id;
    END IF;

  -- NUEVA. El cliente recibe a satisfacción. No tiene cuenta en esta entrega:
  -- lo registra quien está en el sitio, con la firma de la visita o con nombre
  -- y cargo.
  WHEN 'APROBAR_CLIENTE' THEN
    IF t.estado <> 'RESUELTO' THEN
      RAISE EXCEPTION 'Solo se aprueba una orden resuelta (está en %).', t.estado;
    END IF;
    IF NOT (v_tecnico OR v_sede OR t.reportado_por = v_uid) THEN
      RAISE EXCEPTION 'No tienes permiso para registrar la aprobación del cliente.';
    END IF;
    -- Si la orden se ejecutó en sitio y en esa visita ya firmó el cliente, la
    -- firma se toma de ahí: la pantalla no tiene por qué buscarla ni mandarla,
    -- y así la aprobación queda atada a la firma que de verdad existe.
    IF p_firma IS NULL AND t.visita_id IS NOT NULL THEN
      SELECT f.id INTO p_firma
        FROM ronda_firmas f
       WHERE f.visita_id = t.visita_id AND f.quien = 'CLIENTE'
       ORDER BY f.firmado_at DESC
       LIMIT 1;
    END IF;
    IF p_firma IS NULL AND NULLIF(btrim(p_aprobado_nombre), '') IS NULL THEN
      RAISE EXCEPTION 'La aprobación necesita la firma del cliente o, si no hubo visita, su nombre y cargo.';
    END IF;
    IF p_firma IS NOT NULL THEN
      IF NOT EXISTS (SELECT 1 FROM ronda_firmas f WHERE f.id = p_firma AND f.quien = 'CLIENTE') THEN
        RAISE EXCEPTION 'Esa firma no es una firma de cliente.';
      END IF;
      IF t.visita_id IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM ronda_firmas f WHERE f.id = p_firma AND f.visita_id = t.visita_id) THEN
        RAISE EXCEPTION 'Esa firma no es de la visita de esta orden.';
      END IF;
    END IF;
    UPDATE mantenimiento_tickets
       SET estado = 'APROBADO_CLIENTE', aprobado_cliente_at = NOW(),
           aprobado_cliente_nombre = COALESCE(
             NULLIF(btrim(p_aprobado_nombre), ''),
             (SELECT f.nombre_firmante FROM ronda_firmas f WHERE f.id = p_firma)),
           aprobado_cliente_cargo = NULLIF(btrim(p_aprobado_cargo), ''),
           firma_cliente_id = COALESCE(p_firma, firma_cliente_id),
           aprobado_tacito = false
     WHERE id = t.id;
    v_nuevo := 'APROBADO_CLIENTE';
    v_texto := 'Aprobada por el cliente'
               || COALESCE(': ' || NULLIF(btrim(p_aprobado_nombre), ''), '')
               || CASE WHEN p_firma IS NOT NULL THEN ' (con firma)' ELSE '' END;

  WHEN 'CERRAR' THEN
    -- Aquí está la diferencia de la decisión 2.
    IF v_ot THEN
      IF t.estado <> 'APROBADO_CLIENTE' THEN
        RAISE EXCEPTION 'Una orden de trabajo de un activo del cliente se cierra después de que el cliente la apruebe (está en %).', t.estado;
      END IF;
    ELSIF t.estado <> 'RESUELTO' THEN
      RAISE EXCEPTION 'Solo se cierra un ticket resuelto.';
    END IF;
    IF NOT (v_tecnico OR v_sede OR t.reportado_por = v_uid) THEN
      RAISE EXCEPTION 'No tienes permiso para cerrar este ticket.';
    END IF;
    UPDATE mantenimiento_tickets SET estado = 'CERRADO', cerrado_at = NOW() WHERE id = t.id;
    v_nuevo := 'CERRADO';
    v_texto := CASE WHEN v_ot THEN 'Cerrada' ELSE 'Cerrado (equipo recibido a satisfacción)' END;

  WHEN 'REABRIR' THEN
    IF t.estado NOT IN ('RESUELTO','APROBADO_CLIENTE') THEN
      RAISE EXCEPTION 'Solo se reabre un ticket resuelto o aprobado.';
    END IF;
    IF NOT (v_tecnico OR v_sede OR t.reportado_por = v_uid) THEN
      RAISE EXCEPTION 'No tienes permiso para reabrir este ticket.';
    END IF;
    IF NULLIF(btrim(p_nota), '') IS NULL THEN RAISE EXCEPTION 'Explica por qué el equipo sigue con la falla.'; END IF;
    UPDATE mantenimiento_tickets
       SET estado = 'EN_PROCESO', resuelto_at = NULL,
           aprobado_cliente_at = NULL, aprobado_cliente_nombre = NULL,
           aprobado_cliente_cargo = NULL, aprobado_tacito = false,
           aprobacion_vence_at = NULL,
           reaperturas = reaperturas + 1
     WHERE id = t.id;
    v_nuevo := 'EN_PROCESO';
    v_texto := 'Reabierto';
    IF t.maquinaria_id IS NOT NULL THEN
      UPDATE maquinaria SET estado = COALESCE(p_estado_equipo, 'DANADA')
       WHERE id = m.id AND estado <> 'BAJA';
    ELSE
      UPDATE activos SET estado = COALESCE(NULLIF(upper(p_estado_activo), ''), 'DEGRADADO')
       WHERE id = t.activo_id AND estado <> 'RETIRADO';
    END IF;

  WHEN 'CANCELAR' THEN
    IF NOT (v_jefe OR (t.reportado_por = v_uid AND t.estado = 'ABIERTO')) THEN
      RAISE EXCEPTION 'Solo el jefe de mantenimiento (o quien reportó, si nadie lo ha recibido) puede cancelar.';
    END IF;
    IF t.estado IN ('RESUELTO','APROBADO_CLIENTE') THEN
      RAISE EXCEPTION 'Un ticket resuelto se cierra o se reabre, no se cancela.';
    END IF;
    IF NULLIF(btrim(p_nota), '') IS NULL THEN RAISE EXCEPTION 'Indica el motivo de la cancelación.'; END IF;
    UPDATE mantenimiento_tickets SET estado = 'CANCELADO', cerrado_at = NOW() WHERE id = t.id;
    v_nuevo := 'CANCELADO';
    v_texto := 'Cancelado';
    -- Si el equipo estaba en taller por este ticket y no hay otro abierto, vuelve a operar.
    IF t.maquinaria_id IS NOT NULL AND m.estado = 'MANTENIMIENTO' AND NOT EXISTS (
         SELECT 1 FROM mantenimiento_tickets
          WHERE maquinaria_id = m.id AND id <> t.id
            AND estado IN ('RECIBIDO','ACEPTADO','EN_CAMINO','EN_SITIO','EN_PROCESO','EN_ESPERA')) THEN
      UPDATE maquinaria SET estado = 'OPERATIVA' WHERE id = m.id;
    END IF;

  ELSE
    RAISE EXCEPTION 'Acción desconocida: %', p_accion;
  END CASE;

  IF NULLIF(btrim(p_nota), '') IS NOT NULL THEN
    v_texto := v_texto || ' — ' || btrim(p_nota);
  END IF;

  PERFORM public.mant_evento_objeto(t.id, t.numero || ' · ' || v_texto,
    jsonb_build_object('numero', t.numero, 'accion', v_accion,
                       'estado_ticket_anterior', t.estado, 'estado_ticket', v_nuevo,
                       'costo', p_costo));
  PERFORM mant_sistema(t.id, v_texto || '.');
  PERFORM mant_notificar('MANTENIMIENTO_ESTADO', t.id, jsonb_build_object('accion', v_accion, 'detalle', v_texto));
END; $$;
COMMENT ON FUNCTION public.mant_transicion(UUID, TEXT, TEXT, estado_maquinaria, TEXT, TEXT, NUMERIC, UUID, TEXT, TEXT, TEXT, UUID) IS
  'Único sitio donde se mueve el estado de un ticket u orden de trabajo. Once acciones; los estados ACEPTADO/EN_CAMINO/EN_SITIO son opcionales y CERRAR exige APROBADO_CLIENTE solo en las OT de activos de cliente.';
GRANT EXECUTE ON FUNCTION public.mant_transicion(UUID, TEXT, TEXT, estado_maquinaria, TEXT, TEXT, NUMERIC, UUID, TEXT, TEXT, TEXT, UUID) TO authenticated;

-- ── 11) `EN_SITIO` lo escribe el escaneo, no un botón ──────────────────────
-- La diferencia entre «digo que llegué» y «llegué» es el QR, y F4 ya resuelve
-- eso: abrir la visita exige la placa y valida la geocerca. Así que `EN_SITIO`
-- no es una acción de `mant_transicion` que el técnico pueda pulsar desde su
-- casa: lo escribe esta función, que primero abre la visita de verdad.
--
-- Una sutileza del QR: `ronda_registrar_visita` exige que el QR sea DEL PUNTO,
-- y el QR de un activo (F6) tiene `activo_id` y no `punto_id`. Cuando el
-- técnico escanea la placa del activo se valida aquí (vigencia + que sea de
-- ese activo) y a la visita se le pasa `p_qr => NULL`; el modo de apertura
-- queda igual registrado en el ticket. Cuando escanea el QR del punto, se
-- pasa tal cual y la visita lo guarda.
CREATE OR REPLACE FUNCTION public.mant_abrir_visita(
  p_ticket             UUID,
  p_visita             UUID,
  p_qr                 UUID        DEFAULT NULL,
  p_lat                DECIMAL     DEFAULT NULL,
  p_lng                DECIMAL     DEFAULT NULL,
  p_precision          DECIMAL     DEFAULT NULL,
  p_motivo_fuera       TEXT        DEFAULT NULL,
  p_apertura_modo      TEXT        DEFAULT 'QR',
  p_plantilla_codigo   TEXT        DEFAULT NULL,
  p_inicio_dispositivo TIMESTAMPTZ DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  t         mantenimiento_tickets%ROWTYPE;
  v_act     activos%ROWTYPE;
  v_visita  ronda_visitas;
  v_plant   UUID;
  v_codigo  TEXT := NULLIF(upper(btrim(p_plantilla_codigo)), '');
  v_qr      UUID := p_qr;
  v_modo    TEXT := upper(COALESCE(p_apertura_modo, 'QR'));
  v_nombre  VARCHAR(200);
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN RAISE EXCEPTION 'Sesión requerida'; END IF;
  IF p_visita IS NULL THEN RAISE EXCEPTION 'La visita necesita un id (lo genera el dispositivo).'; END IF;

  SELECT * INTO t FROM mantenimiento_tickets WHERE id = p_ticket FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ticket no encontrado.'; END IF;
  IF t.activo_id IS NULL THEN
    RAISE EXCEPTION 'Solo una orden de trabajo sobre un activo del cliente se ejecuta como visita.';
  END IF;
  IF t.estado IN ('CERRADO','CANCELADO') THEN
    RAISE EXCEPTION 'La orden % ya está %.', t.numero, lower(t.estado::text);
  END IF;
  IF NOT public.auth_permiso_any('{atender_mantenimiento,gestionar_mantenimiento,ejecutar_rondas}'::text[]) THEN
    RAISE EXCEPTION 'No tienes permiso para ejecutar órdenes de trabajo.';
  END IF;
  IF t.asignado_a IS NOT NULL AND t.asignado_a <> (SELECT auth.uid())
     AND NOT public.auth_permiso('gestionar_mantenimiento') THEN
    RAISE EXCEPTION 'Esa orden está asignada a otra persona.';
  END IF;
  IF NOT public.activo_en_alcance(t.activo_id) THEN
    RAISE EXCEPTION 'Ese activo no está en tu alcance.';
  END IF;

  SELECT * INTO v_act FROM activos WHERE id = t.activo_id;
  -- `ronda_visitas.punto_id` es NOT NULL y `activos.punto_id` es nullable: un
  -- activo sin punto de control no puede tener visita hoy. Se dice con claridad
  -- en vez de fallar con un error de restricción.
  IF v_act.punto_id IS NULL THEN
    RAISE EXCEPTION 'El activo % no está asociado a un punto de control, y la visita se abre sobre un punto. Asócialo en su ficha para poder ejecutar la orden en sitio.', v_act.codigo;
  END IF;

  -- El QR: si es la placa del activo, se valida aquí y no se pasa a la visita.
  IF v_qr IS NOT NULL THEN
    IF NOT public.ronda_qr_vigente(v_qr) THEN
      RAISE EXCEPTION 'El código QR con el que se abrió ya no sirve.';
    END IF;
    IF EXISTS (SELECT 1 FROM ronda_qr q WHERE q.id = v_qr AND q.activo_id = t.activo_id) THEN
      v_qr := NULL;                      -- es del activo: la visita va sin QR de punto
      v_modo := 'QR';
    ELSIF NOT EXISTS (SELECT 1 FROM ronda_qr q WHERE q.id = v_qr AND q.punto_id = v_act.punto_id) THEN
      RAISE EXCEPTION 'Ese código QR no es de este activo ni de su punto de control.';
    END IF;
  ELSIF v_modo = 'QR' THEN
    -- Sin QR no se puede decir que fue por escaneo.
    v_modo := 'MANUAL';
  END IF;
  IF v_modo = 'MANUAL' AND NULLIF(btrim(p_motivo_fuera), '') IS NULL THEN
    RAISE EXCEPTION 'Si abres la orden sin escanear la placa, escribe por qué (QR ilegible, sin placa…): queda marcado como apertura manual en el informe.';
  END IF;

  -- La tarea: la del parámetro, la primera del plan, o la genérica MANT-OT.
  IF v_codigo IS NULL THEN
    SELECT tr.plantilla_id, upper(tr.plantilla_codigo) INTO v_plant, v_codigo
      FROM mant_plan_tareas tr
     WHERE tr.plan_id = t.plan_id
     ORDER BY tr.orden LIMIT 1;
  END IF;
  IF v_plant IS NULL THEN
    v_plant := public.ronda_plantilla_vigente(COALESCE(v_codigo, 'MANT-OT'), v_act.grupo_id);
  END IF;
  IF v_plant IS NULL THEN
    RAISE EXCEPTION 'No hay una plantilla de tarea publicada para ejecutar esta orden (se buscó %).', COALESCE(v_codigo, 'MANT-OT');
  END IF;

  v_visita := public.ronda_registrar_visita(
    p_visita, v_act.punto_id, v_plant, NULL, NULL, v_qr,
    CASE WHEN v_modo = 'QR' THEN 'QR' ELSE 'MANUAL' END,
    'APP', p_lat, p_lng, p_precision, p_inicio_dispositivo,
    NULLIF(btrim(p_motivo_fuera), ''), false, NULL, NULL);

  UPDATE ronda_visitas SET ticket_id = t.id WHERE id = v_visita.id;

  SELECT nombre INTO v_nombre FROM usuarios WHERE id = (SELECT auth.uid());
  PERFORM set_config('app.mant_ticket', t.id::text, true);

  UPDATE mantenimiento_tickets
     SET visita_id     = v_visita.id,
         en_sitio_at   = COALESCE(en_sitio_at, NOW()),
         en_sitio_modo = COALESCE(en_sitio_modo, v_modo),
         aceptado_at   = COALESCE(aceptado_at, NOW()),
         asignado_a    = COALESCE(asignado_a, (SELECT auth.uid())),
         recibido_por  = COALESCE(recibido_por, (SELECT auth.uid())),
         recibido_at   = COALESCE(recibido_at, NOW()),
         estado = CASE WHEN estado IN ('ABIERTO','RECIBIDO','ACEPTADO','EN_CAMINO')
                       THEN 'EN_SITIO'::estado_ticket_mant ELSE estado END
   WHERE id = t.id;

  PERFORM mant_sistema(t.id,
    'En sitio' || CASE WHEN v_modo = 'QR' THEN ' (placa escaneada)' ELSE ' (apertura manual: ' || btrim(p_motivo_fuera) || ')' END
    || ' · visita ' || v_visita.numero || ' por ' || COALESCE(v_nombre, 'el técnico') || '.');
  PERFORM mant_notificar('MANTENIMIENTO_ESTADO', t.id,
    jsonb_build_object('accion', 'EN_SITIO', 'detalle', 'En sitio', 'visita', v_visita.numero));

  RETURN jsonb_build_object('visita_id', v_visita.id, 'visita_numero', v_visita.numero,
                            'en_sitio_modo', v_modo, 'punto_id', v_act.punto_id,
                            'plantilla_id', v_plant);
END; $$;
COMMENT ON FUNCTION public.mant_abrir_visita(UUID, UUID, UUID, DECIMAL, DECIMAL, DECIMAL, TEXT, TEXT, TEXT, TIMESTAMPTZ) IS
  'Abre la visita de una orden de trabajo con el motor de F4 y deja el ticket EN_SITIO. El modo QR es la garantía de que el técnico llegó; la apertura manual exige motivo y se distingue en el informe.';
GRANT EXECUTE ON FUNCTION public.mant_abrir_visita(UUID, UUID, UUID, DECIMAL, DECIMAL, DECIMAL, TEXT, TEXT, TEXT, TIMESTAMPTZ) TO authenticated;

-- ── 12) Materiales: el consumo descuenta inventario de verdad ──────────────
-- Va por `registrar_movimiento()`, el mismo camino que el resto de las salidas
-- de bodega. Las existencias se validan contra `cantidad_real` (el físico), no
-- contra `cantidad_disp`: lo reservado son las órdenes de insumo aprobadas, y
-- un técnico que tiene el repuesto en la mano no está pidiendo una reserva.
CREATE OR REPLACE FUNCTION public.mant_material_registrar(
  p_ticket         UUID,
  p_producto       UUID,
  p_cantidad       NUMERIC,
  p_costo_unitario NUMERIC DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid    UUID := (SELECT auth.uid());
  t        mantenimiento_tickets%ROWTYPE;
  v_prod   RECORD;
  v_real   NUMERIC;
  v_mov    UUID;
  v_id     UUID;
  v_nombre VARCHAR(200);
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Sesión requerida'; END IF;
  IF NOT public.auth_permiso_any('{atender_mantenimiento,gestionar_mantenimiento}'::text[]) THEN
    RAISE EXCEPTION 'Solo mantenimiento registra los materiales de una orden.';
  END IF;
  IF COALESCE(p_cantidad, 0) <= 0 THEN RAISE EXCEPTION 'La cantidad debe ser mayor que cero.'; END IF;

  SELECT * INTO t FROM mantenimiento_tickets WHERE id = p_ticket FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ticket no encontrado.'; END IF;
  IF t.estado IN ('CERRADO','CANCELADO') THEN
    RAISE EXCEPTION 'El ticket % ya está %: no se le pueden cargar materiales.', t.numero, lower(t.estado::text);
  END IF;
  IF t.grupo_id IS NOT NULL AND NOT public.auth_ve_grupo(t.grupo_id) THEN
    RAISE EXCEPTION 'Esa orden de trabajo no está en tu alcance.';
  END IF;

  -- El producto se llama `nombre_estandar` y lleva su presentación aparte; el
  -- nombre que se guarda en la orden junta las dos, que es como lo lee la gente.
  SELECT p.id,
         btrim(p.nombre_estandar || COALESCE(' ' || p.presentacion, '')) AS nombre,
         p.precio_lista
    INTO v_prod
    FROM productos p WHERE p.id = p_producto;
  IF NOT FOUND THEN RAISE EXCEPTION 'Producto no encontrado.'; END IF;

  SELECT s.cantidad_real INTO v_real FROM stock s WHERE s.producto_id = p_producto;
  IF COALESCE(v_real, 0) < p_cantidad THEN
    RAISE EXCEPTION 'No hay existencias de %: hay % y se piden %.',
      v_prod.nombre, COALESCE(v_real, 0), p_cantidad;
  END IF;

  v_mov := public.registrar_movimiento(
    p_producto, 'SALIDA', p_cantidad, t.sede_id,
    'Mantenimiento ' || t.numero || ' · ' || v_prod.nombre, NULL);

  SELECT nombre INTO v_nombre FROM usuarios WHERE id = v_uid;
  INSERT INTO mant_materiales (ticket_id, producto_id, producto_nombre, cantidad,
                               costo_unitario, movimiento_id, usuario_id, usuario_nombre)
  VALUES (t.id, p_producto, v_prod.nombre, p_cantidad,
          COALESCE(p_costo_unitario, v_prod.precio_lista), v_mov, v_uid, v_nombre)
  RETURNING id INTO v_id;

  PERFORM mant_sistema(t.id, 'Material consumido: ' || p_cantidad || ' × ' || v_prod.nombre || '.');
  RETURN v_id;
END; $$;
COMMENT ON FUNCTION public.mant_material_registrar(UUID, UUID, NUMERIC, NUMERIC) IS
  'Carga un material a una orden de trabajo y descuenta inventario con registrar_movimiento(SALIDA). Valida existencias contra stock.cantidad_real (el físico). Sin costo explícito toma productos.precio_lista.';
GRANT EXECUTE ON FUNCTION public.mant_material_registrar(UUID, UUID, NUMERIC, NUMERIC) TO authenticated;

-- Quitar un material devuelve la mercancía con un movimiento de DEVOLUCION: no
-- se borra el movimiento de salida, porque el inventario es un libro y no se
-- tacha.
CREATE OR REPLACE FUNCTION public.mant_material_quitar(p_material UUID, p_motivo TEXT DEFAULT NULL)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid UUID := (SELECT auth.uid());
  mm    mant_materiales%ROWTYPE;
  t     mantenimiento_tickets%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Sesión requerida'; END IF;
  IF NOT public.auth_permiso_any('{atender_mantenimiento,gestionar_mantenimiento}'::text[]) THEN
    RAISE EXCEPTION 'Solo mantenimiento corrige los materiales de una orden.';
  END IF;
  SELECT * INTO mm FROM mant_materiales WHERE id = p_material;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ese material no está en la orden.'; END IF;
  SELECT * INTO t FROM mantenimiento_tickets WHERE id = mm.ticket_id FOR UPDATE;
  IF t.estado IN ('CERRADO','CANCELADO') THEN
    RAISE EXCEPTION 'El ticket % ya está cerrado.', t.numero;
  END IF;
  IF t.grupo_id IS NOT NULL AND NOT public.auth_ve_grupo(t.grupo_id) THEN
    RAISE EXCEPTION 'Esa orden de trabajo no está en tu alcance.';
  END IF;

  PERFORM public.registrar_movimiento(
    mm.producto_id, 'DEVOLUCION', mm.cantidad, t.sede_id,
    'Devolución de mantenimiento ' || t.numero || ' · ' || COALESCE(mm.producto_nombre, '')
    || COALESCE(' — ' || NULLIF(btrim(p_motivo), ''), ''), NULL);

  DELETE FROM mant_materiales WHERE id = p_material;
  PERFORM mant_sistema(t.id, 'Material devuelto: ' || mm.cantidad || ' × ' || COALESCE(mm.producto_nombre, 'producto')
    || COALESCE(' — ' || NULLIF(btrim(p_motivo), ''), '') || '.');
END; $$;
GRANT EXECUTE ON FUNCTION public.mant_material_quitar(UUID, TEXT) TO authenticated;

-- ── 13) Qué toca, según el plan ────────────────────────────────────────────
-- Un plan apunta a un tipo, a un activo o a un equipo; esta vista lo convierte
-- en «un plan y UN objeto concreto», que es lo que se puede programar.
-- `security_invoker = true`: hereda la RLS de `activos`, así que un plan por
-- tipo solo expande a los activos que el usuario puede ver.
DROP VIEW IF EXISTS vw_mant_plan_proximos;
DROP VIEW IF EXISTS vw_mant_plan_objetivos;

CREATE VIEW vw_mant_plan_objetivos WITH (security_invoker = true) AS
SELECT p.id AS plan_id, p.codigo AS plan_codigo, p.nombre AS plan_nombre,
       p.tipo_ticket, p.prioridad, p.anticipacion_dias, p.tolerancia_dias,
       p.frecuencia_tipo, p.frecuencia_valor, p.medidor_id AS plan_medidor_id,
       p.obligatorio_normativo, p.normativa, p.asignado_a, p.proveedor_id,
       p.duracion_estimada_min,
       a.id AS activo_id, NULL::uuid AS maquinaria_id,
       a.grupo_id, a.sede_id, a.codigo AS objeto_codigo, a.nombre AS objeto_nombre,
       COALESCE(a.fecha_instalacion::timestamptz, p.created_at) AS desde_at
  FROM mant_planes p
  JOIN activos a ON a.activo_tipo_id = p.activo_tipo_id
 WHERE p.activo AND p.activo_tipo_id IS NOT NULL
   AND a.activo AND a.estado <> 'RETIRADO'
   AND (p.grupo_id IS NULL OR a.grupo_id = p.grupo_id)
UNION ALL
SELECT p.id, p.codigo, p.nombre,
       p.tipo_ticket, p.prioridad, p.anticipacion_dias, p.tolerancia_dias,
       p.frecuencia_tipo, p.frecuencia_valor, p.medidor_id,
       p.obligatorio_normativo, p.normativa, p.asignado_a, p.proveedor_id,
       p.duracion_estimada_min,
       a.id, NULL::uuid,
       a.grupo_id, a.sede_id, a.codigo, a.nombre,
       COALESCE(a.fecha_instalacion::timestamptz, p.created_at)
  FROM mant_planes p
  JOIN activos a ON a.id = p.activo_id
 WHERE p.activo AND p.activo_id IS NOT NULL
   AND a.activo AND a.estado <> 'RETIRADO'
UNION ALL
SELECT p.id, p.codigo, p.nombre,
       p.tipo_ticket, p.prioridad, p.anticipacion_dias, p.tolerancia_dias,
       p.frecuencia_tipo, p.frecuencia_valor, p.medidor_id,
       p.obligatorio_normativo, p.normativa, p.asignado_a, p.proveedor_id,
       p.duracion_estimada_min,
       NULL::uuid, m.id,
       NULL::uuid, m.ubicacion_sede_id, m.codigo, m.nombre,
       COALESCE(m.ultimo_mant_at, m.fecha_adquisicion::timestamptz, p.created_at)
  FROM mant_planes p
  JOIN maquinaria m ON m.id = p.maquinaria_id
 WHERE p.activo AND p.maquinaria_id IS NOT NULL
   AND m.activo AND m.estado <> 'BAJA';

COMMENT ON VIEW vw_mant_plan_objetivos IS
  'Un plan preventivo y UN objeto concreto al que aplica. Expande los planes por tipo de activo.';

-- Cuándo toca: por calendario, o por medidor cuando el contador pasó el salto.
CREATE VIEW vw_mant_plan_proximos WITH (security_invoker = true) AS
SELECT o.*,
       ult.ultimo_at,
       ult.ultimo_medidor,
       med.valor_actual AS medidor_actual,
       med.unidad       AS medidor_unidad,
       CASE o.frecuencia_tipo
         WHEN 'DIAS'    THEN (COALESCE(ult.ultimo_at, o.desde_at))::date + (o.frecuencia_valor)::int
         WHEN 'SEMANAS' THEN (COALESCE(ult.ultimo_at, o.desde_at))::date + (o.frecuencia_valor * 7)::int
         WHEN 'MESES'   THEN ((COALESCE(ult.ultimo_at, o.desde_at)) + make_interval(months => o.frecuencia_valor::int))::date
       END AS proximo_el,
       CASE WHEN o.frecuencia_tipo = 'MEDIDOR'
            THEN COALESCE(ult.ultimo_medidor, 0) + o.frecuencia_valor END AS proximo_medidor,
       abierto.id AS ticket_abierto_id
  FROM vw_mant_plan_objetivos o
  LEFT JOIN LATERAL (
    SELECT t.resuelto_at AS ultimo_at, t.medidor_valor AS ultimo_medidor
      FROM mantenimiento_tickets t
     WHERE t.plan_id = o.plan_id
       AND t.activo_id     IS NOT DISTINCT FROM o.activo_id
       AND t.maquinaria_id IS NOT DISTINCT FROM o.maquinaria_id
       AND t.estado IN ('RESUELTO','APROBADO_CLIENTE','CERRADO')
     ORDER BY t.resuelto_at DESC NULLS LAST
     LIMIT 1) ult ON true
  LEFT JOIN LATERAL (
    SELECT t.id
      FROM mantenimiento_tickets t
     WHERE t.plan_id = o.plan_id
       AND t.activo_id     IS NOT DISTINCT FROM o.activo_id
       AND t.maquinaria_id IS NOT DISTINCT FROM o.maquinaria_id
       AND t.estado NOT IN ('CERRADO','CANCELADO')
     LIMIT 1) abierto ON true
  LEFT JOIN activo_medidores med ON med.id = o.plan_medidor_id;

COMMENT ON VIEW vw_mant_plan_proximos IS
  'Cuándo le toca el preventivo a cada objeto de cada plan, y si ya tiene una orden abierta. De aquí sale mant_generar_preventivos.';

GRANT SELECT ON vw_mant_plan_objetivos TO authenticated;
GRANT SELECT ON vw_mant_plan_proximos  TO authenticated;

-- ── 14) Generar los preventivos que vienen ─────────────────────────────────
-- Sigue siendo un BOTÓN, no una entrada del cron de cinco minutos: §10.2 ya
-- avisa que ese cron «no es una cola» y que tendría que mover también envíos
-- masivos e informes. Es idempotente: no duplica el preventivo de un objeto que
-- ya tiene una orden abierta de ese plan.
CREATE OR REPLACE FUNCTION public.mant_generar_preventivos(p_dias INTEGER DEFAULT 7)
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r RECORD; n INTEGER := 0; v_ventana INTEGER := GREATEST(COALESCE(p_dias, 7), 0);
BEGIN
  IF NOT public.auth_permiso('gestionar_mantenimiento') THEN
    RAISE EXCEPTION 'No tienes permiso para programar preventivos.';
  END IF;

  -- 1) Los planes de F7. La ventana es la mayor entre lo que pide el botón y la
  --    anticipación del plan: cualquiera de las dos razones lo dispara.
  FOR r IN
    SELECT * FROM vw_mant_plan_proximos
     WHERE ticket_abierto_id IS NULL
       AND ( (frecuencia_tipo <> 'MEDIDOR'
              AND proximo_el IS NOT NULL
              AND proximo_el <= CURRENT_DATE + GREATEST(v_ventana, anticipacion_dias))
          OR (frecuencia_tipo = 'MEDIDOR'
              AND medidor_actual IS NOT NULL AND proximo_medidor IS NOT NULL
              AND medidor_actual >= proximo_medidor) )
  LOOP
    PERFORM public.mant_reportar(
      p_tipo          => r.tipo_ticket,
      p_prioridad     => r.prioridad,
      p_titulo        => r.plan_nombre || ' · ' || r.objeto_codigo,
      p_maquinaria    => r.maquinaria_id,
      p_activo        => r.activo_id,
      p_descripcion   => 'Generado por el plan ' || r.plan_codigo || ' (' || r.plan_nombre || ').'
                         || CASE WHEN r.obligatorio_normativo
                                 THEN ' Obligatorio por normativa' || COALESCE(' ' || r.normativa, '') || '.'
                                 ELSE '' END
                         || CASE WHEN r.frecuencia_tipo = 'MEDIDOR'
                                 THEN ' Medidor en ' || r.medidor_actual || COALESCE(' ' || r.medidor_unidad, '') || '.'
                                 ELSE '' END,
      p_programado    => r.proximo_el,
      p_asignado      => r.asignado_a,
      p_plan          => r.plan_id,
      p_origen        => 'PLAN',
      p_proveedor     => r.proveedor_id,
      p_medidor       => r.plan_medidor_id,
      p_medidor_valor => r.medidor_actual);
    n := n + 1;
  END LOOP;

  -- 2) `maquinaria.proximo_mant`, el plan de una sola columna que ya existía.
  --    Se conserva: hay 119 equipos con esa ficha y nadie tiene por qué
  --    reescribir su frecuencia como un `mant_planes` para que siga andando.
  FOR r IN
    SELECT m.id, m.codigo, m.proximo_mant
      FROM maquinaria m
     WHERE m.activo AND m.estado <> 'BAJA'
       AND m.proximo_mant IS NOT NULL
       AND m.proximo_mant <= CURRENT_DATE + v_ventana
       AND NOT EXISTS (SELECT 1 FROM mantenimiento_tickets t
                        WHERE t.maquinaria_id = m.id AND t.tipo = 'PREVENTIVO'
                          AND t.estado NOT IN ('CERRADO','CANCELADO'))
  LOOP
    PERFORM public.mant_reportar(
      p_tipo => 'PREVENTIVO', p_prioridad => 'MEDIA',
      p_titulo => 'Mantenimiento preventivo ' || r.codigo,
      p_maquinaria => r.id,
      p_descripcion => 'Generado por el plan preventivo del equipo.',
      p_programado => r.proximo_mant);
    n := n + 1;
  END LOOP;

  RETURN n;
END; $$;
COMMENT ON FUNCTION public.mant_generar_preventivos(INTEGER) IS
  'Programa los preventivos que vencen: primero los de mant_planes (calendario o medidor), después los de maquinaria.proximo_mant. Idempotente y pensada como botón, no como cron.';
GRANT EXECUTE ON FUNCTION public.mant_generar_preventivos(INTEGER) TO authenticated;

-- ── 15) Aprobación tácita ──────────────────────────────────────────────────
-- La otra mitad de la decisión 2. Sin esto, una OT cuyo cliente no contesta se
-- queda en `RESUELTO` para siempre, el backlog crece con trabajo ya hecho y el
-- SLA de solución no se corta nunca.
CREATE OR REPLACE FUNCTION public.mant_aprobar_tacitos()
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r RECORD; n INTEGER := 0;
BEGIN
  IF NOT public.auth_permiso('gestionar_mantenimiento') THEN
    RAISE EXCEPTION 'No tienes permiso para cerrar aprobaciones vencidas.';
  END IF;
  FOR r IN
    SELECT t.id, t.numero, t.aprobacion_vence_at
      FROM mantenimiento_tickets t
     WHERE t.estado = 'RESUELTO'
       AND t.activo_id IS NOT NULL
       AND t.aprobacion_vence_at IS NOT NULL
       AND t.aprobacion_vence_at <= NOW()
       AND (t.grupo_id IS NULL OR t.grupo_id IN (SELECT public.auth_grupos()))
  LOOP
    UPDATE mantenimiento_tickets
       SET estado = 'APROBADO_CLIENTE', aprobado_cliente_at = NOW(), aprobado_tacito = true
     WHERE id = r.id;
    PERFORM mant_sistema(r.id,
      'Aprobada tácitamente: venció el plazo del contrato (' ||
      to_char(r.aprobacion_vence_at AT TIME ZONE 'America/Bogota', 'DD/MM/YYYY') ||
      ') sin respuesta del cliente.');
    PERFORM mant_notificar('MANTENIMIENTO_ESTADO', r.id,
      jsonb_build_object('accion', 'APROBAR_TACITO', 'detalle', 'Aprobada por vencimiento del plazo'));
    n := n + 1;
  END LOOP;
  RETURN n;
END; $$;
COMMENT ON FUNCTION public.mant_aprobar_tacitos() IS
  'Pasa a APROBADO_CLIENTE (aprobado_tacito = true) las órdenes resueltas cuyo plazo de aprobación del contrato venció sin respuesta del cliente.';
GRANT EXECUTE ON FUNCTION public.mant_aprobar_tacitos() TO authenticated;

-- ── 16) Indicadores: se calculan, no se guardan ────────────────────────────
-- Supabase corta a los 8 s, así que el tablero cuenta aquí y no trayendo filas.
DROP VIEW IF EXISTS vw_mant_backlog;
CREATE VIEW vw_mant_backlog WITH (security_invoker = true) AS
SELECT count(*) FILTER (WHERE estado = 'ABIERTO')                                        AS por_recibir,
       count(*) FILTER (WHERE estado IN ('RECIBIDO','ACEPTADO','EN_CAMINO','EN_SITIO','EN_PROCESO','EN_ESPERA')) AS en_curso,
       count(*) FILTER (WHERE estado NOT IN ('RESUELTO','APROBADO_CLIENTE')
                          AND prioridad IN ('ALTA','CRITICA'))                           AS criticos,
       count(*) FILTER (WHERE estado = 'RESUELTO')                                       AS por_aprobar,
       count(*) FILTER (WHERE estado = 'APROBADO_CLIENTE')                               AS por_cerrar,
       count(*) FILTER (WHERE estado = 'RESUELTO' AND aprobacion_vence_at IS NOT NULL
                          AND aprobacion_vence_at <= now())                              AS aprobacion_vencida,
       count(*) FILTER (WHERE asignado_a = (SELECT auth.uid())
                          AND estado NOT IN ('RESUELTO','APROBADO_CLIENTE'))             AS mios,
       count(*) FILTER (WHERE sla_respuesta_vence_at IS NOT NULL
                          AND respondido_at IS NULL
                          AND sla_respuesta_vence_at <= now())                           AS sla_respuesta_vencido,
       count(*) FILTER (WHERE sla_solucion_vence_at IS NOT NULL
                          AND resuelto_at IS NULL
                          AND sla_solucion_vence_at <= now())                            AS sla_solucion_vencido
  FROM mantenimiento_tickets
 WHERE estado NOT IN ('CERRADO','CANCELADO');
COMMENT ON VIEW vw_mant_backlog IS
  'El trabajo pendiente, contado en SQL. Una sola fila; hereda la RLS del ticket, así que cada usuario ve su alcance.';
GRANT SELECT ON vw_mant_backlog TO authenticated;

DROP VIEW IF EXISTS vw_mant_indicadores;
CREATE VIEW vw_mant_indicadores WITH (security_invoker = true) AS
SELECT date_trunc('month', created_at)::date AS mes,
       grupo_id,
       count(*)                                                                AS tickets,
       count(*) FILTER (WHERE tipo IN ('PREVENTIVO','INSPECCION'))             AS preventivos,
       count(*) FILTER (WHERE activo_id IS NOT NULL)                           AS ordenes_cliente,
       round(avg(EXTRACT(EPOCH FROM (respondido_at - created_at)) / 3600)::numeric, 2) AS horas_respuesta,
       round(avg(EXTRACT(EPOCH FROM (resuelto_at   - created_at)) / 3600)::numeric, 2) AS mttr_horas,
       count(*) FILTER (WHERE sla_respuesta_cumplido)                           AS sla_respuesta_ok,
       count(*) FILTER (WHERE sla_respuesta_cumplido IS NOT NULL)               AS sla_respuesta_medidos,
       count(*) FILTER (WHERE sla_solucion_cumplido)                            AS sla_solucion_ok,
       count(*) FILTER (WHERE sla_solucion_cumplido IS NOT NULL)                AS sla_solucion_medidos,
       count(*) FILTER (WHERE aprobado_tacito)                                  AS aprobadas_tacitas,
       count(*) FILTER (WHERE en_sitio_modo = 'MANUAL')                         AS en_sitio_manual,
       sum(reaperturas)                                                         AS reaperturas,
       sum(COALESCE(costo_mano_obra, 0))                                        AS costo_mano_obra,
       sum(COALESCE(costo_materiales, 0))                                       AS costo_materiales
  FROM mantenimiento_tickets
 GROUP BY 1, 2;
COMMENT ON VIEW vw_mant_indicadores IS
  'MTTR, % preventivo, cumplimiento de SLA, reaperturas y costos por mes y contrato. §2.4: los indicadores se calculan, no se almacenan.';
GRANT SELECT ON vw_mant_indicadores TO authenticated;

-- ── 17) RLS ────────────────────────────────────────────────────────────────
-- EL CAMBIO MÁS DELICADO DEL ARCHIVO (decisión 6).
-- `mant_puede_participar()` no tiene ningún alcance: es solo
-- `auth_permiso_any({ver_mantenimiento,…})`, y de ella cuelgan la lectura de
-- tickets, de mensajes, de actividades y las cuatro políticas de storage. Hoy
-- da igual porque todo es maquinaria propia; en cuanto exista una OT de un
-- cliente, cualquiera con `ver_mantenimiento` (Auditor, Supervisor de
-- Conserjería, Coordinador) leería las órdenes, el chat y las fotos de TODOS
-- los clientes — el agujero que §4.2 evitó separando `activos` de `maquinaria`,
-- abierto por la otra puerta.
--
-- NO se toca esa función: el módulo de maquinaria sigue exactamente como está.
-- Se añade una condición POR FILA que solo muerde cuando el ticket es de un
-- cliente. `grupo_id IN (SELECT auth_grupos())` es el modismo de F1: es una
-- subconsulta no correlacionada, así que se evalúa una vez por consulta y no
-- una por fila (lo que `scripts/generar-rls-envuelta.mjs` cuida, y que tiene
-- que seguir reportando 0 pendientes).
DROP POLICY IF EXISTS mant_tickets_read ON mantenimiento_tickets;
CREATE POLICY mant_tickets_read ON mantenimiento_tickets FOR SELECT TO authenticated
  USING (
    (SELECT public.mant_puede_participar())
    AND (grupo_id IS NULL OR grupo_id IN (SELECT public.auth_grupos()))
  );

-- El chat de una orden es tan sensible como la orden: fotos del sitio, nombres,
-- diagnósticos. Va con el mismo alcance, apoyándose en la policy del ticket.
DROP POLICY IF EXISTS mant_mensajes_read ON mantenimiento_mensajes;
CREATE POLICY mant_mensajes_read ON mantenimiento_mensajes FOR SELECT TO authenticated
  USING (
    (SELECT public.mant_puede_participar())
    AND EXISTS (SELECT 1 FROM mantenimiento_tickets t WHERE t.id = ticket_id)
  );

DROP POLICY IF EXISTS mant_mensajes_insert ON mantenimiento_mensajes;
CREATE POLICY mant_mensajes_insert ON mantenimiento_mensajes FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT public.mant_puede_participar())
    AND tipo IN ('MENSAJE','ADJUNTO')
    AND EXISTS (SELECT 1 FROM mantenimiento_tickets t
                 WHERE t.id = ticket_id AND t.estado NOT IN ('CERRADO','CANCELADO'))
  );

-- Planes: ver con el módulo, editar con `gestionar_mantenimiento` (que en
-- `/roles` ya se llama literalmente «asignar, cancelar y programar
-- preventivos»), y siempre dentro del contrato. No se inventan claves nuevas.
ALTER TABLE mant_planes          ENABLE ROW LEVEL SECURITY;
ALTER TABLE mant_plan_tareas     ENABLE ROW LEVEL SECURITY;
ALTER TABLE mant_plan_materiales ENABLE ROW LEVEL SECURITY;
ALTER TABLE mant_materiales      ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS mant_planes_read ON mant_planes;
CREATE POLICY mant_planes_read ON mant_planes FOR SELECT TO authenticated
  USING (
    (SELECT public.mant_puede_participar())
    AND (grupo_id IS NULL OR grupo_id IN (SELECT public.auth_grupos()))
  );
DROP POLICY IF EXISTS mant_planes_write ON mant_planes;
CREATE POLICY mant_planes_write ON mant_planes FOR ALL TO authenticated
  USING (
    (SELECT public.auth_permiso('gestionar_mantenimiento'))
    AND (grupo_id IS NULL OR grupo_id IN (SELECT public.auth_grupos()))
  )
  WITH CHECK (
    (SELECT public.auth_permiso('gestionar_mantenimiento'))
    AND (grupo_id IS NULL OR grupo_id IN (SELECT public.auth_grupos()))
  );

DROP POLICY IF EXISTS mant_plan_tareas_read ON mant_plan_tareas;
CREATE POLICY mant_plan_tareas_read ON mant_plan_tareas FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM mant_planes p WHERE p.id = plan_id));
DROP POLICY IF EXISTS mant_plan_tareas_write ON mant_plan_tareas;
CREATE POLICY mant_plan_tareas_write ON mant_plan_tareas FOR ALL TO authenticated
  USING ((SELECT public.auth_permiso('gestionar_mantenimiento'))
         AND EXISTS (SELECT 1 FROM mant_planes p WHERE p.id = plan_id))
  WITH CHECK ((SELECT public.auth_permiso('gestionar_mantenimiento'))
         AND EXISTS (SELECT 1 FROM mant_planes p WHERE p.id = plan_id));

DROP POLICY IF EXISTS mant_plan_mat_read ON mant_plan_materiales;
CREATE POLICY mant_plan_mat_read ON mant_plan_materiales FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM mant_planes p WHERE p.id = plan_id));
DROP POLICY IF EXISTS mant_plan_mat_write ON mant_plan_materiales;
CREATE POLICY mant_plan_mat_write ON mant_plan_materiales FOR ALL TO authenticated
  USING ((SELECT public.auth_permiso('gestionar_mantenimiento'))
         AND EXISTS (SELECT 1 FROM mant_planes p WHERE p.id = plan_id))
  WITH CHECK ((SELECT public.auth_permiso('gestionar_mantenimiento'))
         AND EXISTS (SELECT 1 FROM mant_planes p WHERE p.id = plan_id));

-- Los materiales se leen con la orden y se escriben SOLO por las RPC (que son
-- SECURITY DEFINER): por eso no hay política de escritura. Un UPDATE directo a
-- `mant_materiales` dejaría el movimiento de inventario sin su contrapartida.
DROP POLICY IF EXISTS mant_materiales_read ON mant_materiales;
CREATE POLICY mant_materiales_read ON mant_materiales FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM mantenimiento_tickets t WHERE t.id = ticket_id));

-- Storage: las fotos de una OT viven bajo la carpeta del activo, así que la
-- lectura del bucket tiene que mirar el contrato igual que la del ticket.
CREATE OR REPLACE FUNCTION public.mant_archivo_puede_ver(p_name TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id UUID;
BEGIN
  IF NOT public.mant_puede_participar() THEN RETURN false; END IF;
  BEGIN
    v_id := (split_part(p_name, '/', 1))::uuid;
  EXCEPTION WHEN others THEN
    RETURN true;     -- la carpeta no es un uuid: es una ruta de maquinaria vieja
  END;
  IF NOT EXISTS (SELECT 1 FROM activos a WHERE a.id = v_id) THEN
    RETURN true;     -- es un equipo propio: como antes
  END IF;
  RETURN public.activo_en_alcance(v_id);
END; $$;
COMMENT ON FUNCTION public.mant_archivo_puede_ver(TEXT) IS
  'Si la carpeta del archivo es un activo del cliente, exige que ese activo esté en el alcance del usuario. Para las rutas de maquinaria se comporta como antes.';
GRANT EXECUTE ON FUNCTION public.mant_archivo_puede_ver(TEXT) TO authenticated;

DROP POLICY IF EXISTS mantenimiento_select_perm ON storage.objects;
CREATE POLICY mantenimiento_select_perm ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'mantenimiento' AND (SELECT public.mant_archivo_puede_ver(name)));

-- ── 18) Realtime ───────────────────────────────────────────────────────────
ALTER TABLE mant_materiales REPLICA IDENTITY FULL;
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE mant_materiales;
EXCEPTION WHEN duplicate_object THEN null; WHEN undefined_object THEN null; END $$;

-- ── 19) El evento de notificación aprende las acciones nuevas ──────────────
UPDATE eventos_notificacion
   SET descripcion = 'Un ticket u orden de trabajo cambió de estado: recibido, asignado, aceptado, en camino, en sitio, iniciado, en espera, resuelto, aprobado por el cliente, cerrado, reabierto o cancelado.',
       variables = '[{"clave":"numero","descripcion":"Número del ticket"},{"clave":"accion","descripcion":"RECIBIR / ASIGNAR / ACEPTAR / SALIR / EN_SITIO / INICIAR / ESPERA / RESOLVER / APROBAR_CLIENTE / APROBAR_TACITO / CERRAR / REABRIR / CANCELAR"},{"clave":"estado","descripcion":"Estado nuevo del ticket"},{"clave":"detalle","descripcion":"Texto del cambio"},{"clave":"asignado_a","descripcion":"Técnico asignado"},{"clave":"equipo_codigo","descripcion":"Código del equipo o del activo"},{"clave":"equipo_nombre","descripcion":"Nombre del equipo o del activo"},{"clave":"es_orden_trabajo","descripcion":"true si es una orden sobre un activo del cliente"},{"clave":"contrato","descripcion":"Código del contrato (solo en órdenes de cliente)"},{"clave":"sede","descripcion":"Sede"},{"clave":"visita","descripcion":"Número de la visita, cuando se abrió en sitio"},{"clave":"enlace","descripcion":"Ruta del ticket"}]'::jsonb
 WHERE codigo = 'MANTENIMIENTO_ESTADO';

-- ── 20) Permisos ───────────────────────────────────────────────────────────
-- No se crean claves nuevas: los planes se ven con `ver_mantenimiento` y se
-- editan con `gestionar_mantenimiento`, que en `/roles` ya dice «asignar,
-- cancelar y programar preventivos (jefe)».
--
-- Faltan dos claves que ya existen y que el técnico necesita:
--   · `ver_activos_ronda`  → ver la ficha del activo del cliente sobre el que
--     va a trabajar (de F6).
--   · `ejecutar_rondas`    → ABRIR LA VISITA. La ejecución de la OT es una
--     visita del motor de F4, y `ronda_actor()` exige esa clave; sin ella el
--     técnico no puede poner la orden EN_SITIO ni firmar en el sitio. Esto se
--     descubrió probando, no leyendo: la RPC de F7 lo deja pasar y es F4 la
--     que corta, tres funciones más adentro.
UPDATE public.roles
   SET permisos = permisos || '{"ver_activos_ronda": true, "ejecutar_rondas": true}'::jsonb
WHERE nombre IN ('Técnico de Mantenimiento', 'Jefe de Mantenimiento');

-- ── 21) La plantilla genérica de la orden correctiva ───────────────────────
-- `ronda_visitas.plantilla_id` es NOT NULL: una OT sin plan necesita una tarea
-- publicada de la que colgar la ejecución. Se siembra con `grupo_id IS NULL`
-- (vale para todos los contratos) y cada contrato puede taparla con su versión,
-- como ya hace F3.
-- El tipo de actividad del catálogo de F3: no había uno de orden de trabajo
-- (hay categoría MANTENIMIENTO pero solo «Lectura de medidor»).
INSERT INTO ronda_tipos_actividad (grupo_id, codigo, nombre, descripcion, categoria, icono, color, orden) VALUES
  (NULL, 'ORDEN_TRABAJO', 'Orden de trabajo',
   'Ejecución en sitio de una orden de trabajo de mantenimiento: estado inicial, trabajo, estado final y firma.',
   'MANTENIMIENTO', 'Wrench', '#f97316', 45)
ON CONFLICT (codigo) WHERE grupo_id IS NULL DO NOTHING;

DO $$
DECLARE v_tipo UUID; v_plant UUID;
BEGIN
  SELECT id INTO v_tipo FROM ronda_tipos_actividad
   WHERE grupo_id IS NULL AND codigo = 'ORDEN_TRABAJO' LIMIT 1;
  IF v_tipo IS NULL THEN
    RAISE WARNING 'Sin tipo de actividad ORDEN_TRABAJO: no se sembró la plantilla MANT-OT.';
    RETURN;
  END IF;

  SELECT id INTO v_plant FROM ronda_plantillas
   WHERE grupo_id IS NULL AND codigo = 'MANT-OT' ORDER BY version DESC LIMIT 1;
  IF v_plant IS NULL THEN
    -- Nace en BORRADOR y se publica al final, a propósito: F3 tiene un trigger
    -- (`ronda_paso_congelar`) que impide tocar los pasos de una plantilla que
    -- ya no es BORRADOR, porque un instructivo corregido no puede cambiar lo
    -- que vio quien ya ejecutó. Sembrarla publicada de una vez falla.
    INSERT INTO ronda_plantillas (grupo_id, tipo_actividad_id, codigo, version, nombre,
                                  descripcion, estado, exige_firma, exige_geocerca,
                                  duracion_estimada_min)
    VALUES (NULL, v_tipo, 'MANT-OT', 1, 'Atención de orden de trabajo',
            'Tarea genérica para ejecutar en sitio una orden de trabajo de mantenimiento que no viene de un plan. Exige firma: de ella sale la aprobación del cliente.',
            'BORRADOR', true, true, 60)
    RETURNING id INTO v_plant;

    INSERT INTO ronda_plantilla_pasos (plantilla_id, orden, tipo, titulo, ayuda, obligatorio, config) VALUES
      (v_plant, 1, 'FOTO',  'Foto del estado inicial', 'Cómo está el equipo antes de intervenirlo.', true,
       '{"min":1,"max":5,"solo_camara_vivo":true,"exige_qr_en_encuadre":false}'::jsonb),
      (v_plant, 2, 'TEXTO', 'Trabajo realizado', 'Qué se hizo, repuestos cambiados, pruebas.', true,
       '{"min_caracteres":10,"max_caracteres":2000}'::jsonb),
      (v_plant, 3, 'FOTO',  'Foto del estado final', 'Cómo queda el equipo.', true,
       '{"min":1,"max":5,"solo_camara_vivo":true,"exige_qr_en_encuadre":false}'::jsonb),
      (v_plant, 4, 'SELECCION', '¿El equipo queda operativo?', NULL, true,
       '{"multiple":false,"opciones":[{"valor":"OPERATIVO","etiqueta":"Sí, operativo"},{"valor":"DEGRADADO","etiqueta":"Funciona con limitaciones"},{"valor":"FUERA_SERVICIO","etiqueta":"Fuera de servicio"}]}'::jsonb),
      (v_plant, 5, 'FIRMA', 'Firma de quien recibe por el cliente',
       'De esta firma sale la aprobación de la orden. Si no hay quien firme, se registra el nombre y el cargo en la orden.', false,
       '{"quien":"cliente","permite_facial":false}'::jsonb);

    UPDATE ronda_plantillas SET estado = 'PUBLICADA', publicada_at = NOW()
     WHERE id = v_plant;
  END IF;
END $$;

-- ── 22) Que PostgREST vea lo nuevo ─────────────────────────────────────────
-- Sin esto, las cuatro vistas y las columnas nuevas no existen para la API
-- hasta que el servidor recargue por su cuenta, y el tablero fallaría con
-- «Could not find the table 'public.vw_mant_backlog' in the schema cache».
NOTIFY pgrst, 'reload schema';

-- =============================================================================
-- MÓDULO COMPRAS — FASE 1: la entrada de mercancía queda amarrada a la orden
-- =============================================================================
-- Contexto medido el 2026-10-18 (ver docs/modulo-compras.md §6):
--   · 1 sola orden de compra en todo el sistema, creada y aprobada por la misma
--     persona.
--   · 768 entradas de mercancía al inventario, TODAS con `movimientos.oc_id` en
--     NULL: del orden de 350-400 millones al mes entrando sin orden detrás.
--   · La causa no fue un olvido: `registrar_movimiento(p_producto, p_tipo,
--     p_cantidad, p_sede, p_observacion, p_ubicacion)` no tiene parámetro para
--     la orden de compra, así que nunca hubo por dónde llenarlo.
--   · Un único permiso, `crear_ordenes_compra`, autoriza crear, aprobar, enviar,
--     recibir y anular. Y `Bodeguero` —quien de verdad recibe— tenía
--     `ver_ordenes_compra` en false.
--
-- Esta migración:
--   1. `oc_recepciones` + `oc_recepcion_items`: una fila por ENTREGA, con
--      cantidad rechazada y motivo. `oc_items.cantidad_rec` deja de escribirse a
--      mano y pasa a mantenerla un trigger.
--   2. `movimientos.origen`: distingue una compra a proveedor de lo que viene de
--      producción, reembasado o un traslado interno. Las 768 entradas históricas
--      quedan en 'OTRO' (no en 'COMPRA'): no se las cuenta como compras sin
--      orden, que sería mentir en la otra dirección.
--      Restricción NOT VALID: el histórico queda quieto, lo nuevo cumple.
--   3. `oc_registrar_recepcion()`: crea la entrega, sus ítems, los movimientos
--      CON orden y ubicación, actualiza el stock y mueve el estado, todo en una
--      transacción. Reemplaza la secuencia de llamadas del server action, que
--      podía quedar a medias.
--   4. Permisos nuevos: `aprobar_ordenes_compra`, `recibir_ordenes_compra` y
--      `aprobar_ordenes_compra_sin_tope`. RLS partida en consecuencia.
--   5. «Quien crea no aprueba», en un TRIGGER y no en el server action: el
--      guardián de la app (lib/permisos-server.ts) y los helpers `auth_permiso*`
--      le dan paso libre a los roles base SUPER_ADMIN y ADMIN, y son justo los
--      que más probable es que hagan las dos cosas. En el trigger no hay
--      excepción para nadie.
--   6. `compras_niveles_aprobacion`: topes por monto (corte en 5.000.000).
--      Nace APAGADO —los dos niveles apuntan al mismo permiso— porque el rol
--      Gerencia existe pero no tiene ningún usuario. Encenderlo es cambiar una
--      fila, no una migración. Ver §9.0 y §9.4 del documento.
--
-- Decidido con el usuario el 2026-10-18 (docs/modulo-compras.md §7 y §9).
-- NO incluye solicitudes, cotizaciones ni facturas: eso es fase 2 a 4.
--
-- IDEMPOTENTE.
-- =============================================================================

SET search_path TO public;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Bodega de destino en la orden
-- ─────────────────────────────────────────────────────────────────────────────
-- Decisión aceptada: todo entra a la Central y NO se construye multi-bodega.
-- El campo se deja puesto igual, porque abrir una segunda bodega después
-- obligaría a corregir a mano todo el historial de compras.

ALTER TABLE ordenes_compra
  ADD COLUMN IF NOT EXISTS bodega_destino_id UUID REFERENCES bodegas(id);

COMMENT ON COLUMN ordenes_compra.bodega_destino_id IS
  'Bodega donde se recibe la compra. Hoy siempre la Central; el campo existe para no migrar el histórico el día que haya una segunda.';

-- Bodega por defecto: la Central (código CENTRAL), o la única que haya.
CREATE OR REPLACE FUNCTION public.compras_bodega_central()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM bodegas
   WHERE activo
   ORDER BY (codigo = 'CENTRAL') DESC, created_at
   LIMIT 1
$$;

COMMENT ON FUNCTION public.compras_bodega_central() IS
  'Bodega de destino por defecto de las compras: la de código CENTRAL, o la más antigua activa.';

UPDATE ordenes_compra
   SET bodega_destino_id = public.compras_bodega_central()
 WHERE bodega_destino_id IS NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Recepciones por entrega
-- ─────────────────────────────────────────────────────────────────────────────
-- Antes la recepción pisaba `oc_items.cantidad_rec` como un acumulado: si
-- llegaban 50 y después 30, el campo quedaba en 80 sin rastro de que fueron dos
-- entregas en dos fechas. Sin eso no se puede medir si el proveedor cumple el
-- plazo ni cruzar una factura contra lo que llegó.

CREATE TABLE IF NOT EXISTS oc_recepciones (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  oc_id            UUID NOT NULL REFERENCES ordenes_compra(id) ON DELETE CASCADE,
  consecutivo      INT NOT NULL,                 -- 1, 2, 3… dentro de la orden
  fecha            DATE NOT NULL DEFAULT CURRENT_DATE,
  remision         VARCHAR(60),                  -- número de remisión del proveedor
  bodega_id        UUID REFERENCES bodegas(id),
  ubicacion_id     UUID REFERENCES ubicaciones(id),
  recibido_por     UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  recibido_nombre  VARCHAR(200),                 -- desnormalizado: la RLS de usuarios solo deja leer el propio registro
  observacion      TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (oc_id, consecutivo)
);
CREATE INDEX IF NOT EXISTS idx_oc_recepciones_oc    ON oc_recepciones(oc_id, consecutivo);
CREATE INDEX IF NOT EXISTS idx_oc_recepciones_fecha ON oc_recepciones(fecha DESC);

COMMENT ON TABLE oc_recepciones IS
  'Una fila por entrega del proveedor contra una orden de compra. Reemplaza el acumulado de oc_items.cantidad_rec.';

CREATE TABLE IF NOT EXISTS oc_recepcion_items (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recepcion_id        UUID NOT NULL REFERENCES oc_recepciones(id) ON DELETE CASCADE,
  oc_item_id          UUID NOT NULL REFERENCES oc_items(id) ON DELETE CASCADE,
  producto_id         UUID NOT NULL REFERENCES productos(id),
  cantidad            NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (cantidad >= 0),
  cantidad_rechazada  NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (cantidad_rechazada >= 0),
  motivo_rechazo      TEXT,
  movimiento_id       UUID REFERENCES movimientos(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Una línea sin nada recibido ni rechazado no tiene razón de existir.
  CONSTRAINT oc_recepcion_items_algo CHECK (cantidad > 0 OR cantidad_rechazada > 0),
  -- Si se rechaza, hay que decir por qué: es el dato que explica el descuadre.
  CONSTRAINT oc_recepcion_items_motivo
    CHECK (cantidad_rechazada = 0 OR NULLIF(TRIM(COALESCE(motivo_rechazo, '')), '') IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_oc_recepcion_items_rec  ON oc_recepcion_items(recepcion_id);
CREATE INDEX IF NOT EXISTS idx_oc_recepcion_items_item ON oc_recepcion_items(oc_item_id);

COMMENT ON TABLE oc_recepcion_items IS
  'Qué llegó en cada entrega. cantidad_rechazada + motivo es lo que antes no existía: si llegaban 100 y 5 venían malas, la única salida era inflar el stock o dejar la orden parcial para siempre.';

-- ── oc_items.cantidad_rec pasa a ser un agregado mantenido por trigger ───────
-- Se conserva la columna (la usan la pantalla de detalle y los reportes), pero
-- ya nadie la escribe a mano, así que no puede volver a desincronizarse.

CREATE OR REPLACE FUNCTION public.tr_oc_recepcion_items_sync()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item UUID;
BEGIN
  v_item := COALESCE(NEW.oc_item_id, OLD.oc_item_id);

  UPDATE oc_items i
     SET cantidad_rec = COALESCE((
           SELECT SUM(ri.cantidad)
             FROM oc_recepcion_items ri
            WHERE ri.oc_item_id = i.id
         ), 0)
   WHERE i.id = v_item;

  -- Si el ítem cambió de ítem (UPDATE que mueve la línea), recalcular el viejo.
  IF TG_OP = 'UPDATE' AND NEW.oc_item_id IS DISTINCT FROM OLD.oc_item_id THEN
    UPDATE oc_items i
       SET cantidad_rec = COALESCE((
             SELECT SUM(ri.cantidad)
               FROM oc_recepcion_items ri
              WHERE ri.oc_item_id = i.id
           ), 0)
     WHERE i.id = OLD.oc_item_id;
  END IF;

  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS tr_oc_recepcion_items_sync ON oc_recepcion_items;
CREATE TRIGGER tr_oc_recepcion_items_sync
  AFTER INSERT OR UPDATE OR DELETE ON oc_recepcion_items
  FOR EACH ROW EXECUTE FUNCTION public.tr_oc_recepcion_items_sync();

-- ── Backfill: la orden que ya existe tiene cantidades recibidas ──────────────
-- Se le crea una entrega histórica con esos valores para no perder el dato.
-- La fecha es `fecha_recepcion` si la hay; si no, la de creación de la orden.
DO $$
DECLARE
  v_oc      RECORD;
  v_rec     UUID;
BEGIN
  FOR v_oc IN
    SELECT o.id, o.numero_oc, o.fecha_recepcion, o.created_at, o.bodega_destino_id
      FROM ordenes_compra o
     WHERE EXISTS (SELECT 1 FROM oc_items i WHERE i.oc_id = o.id AND COALESCE(i.cantidad_rec, 0) > 0)
       AND NOT EXISTS (SELECT 1 FROM oc_recepciones r WHERE r.oc_id = o.id)
  LOOP
    INSERT INTO oc_recepciones (oc_id, consecutivo, fecha, bodega_id, observacion)
    VALUES (
      v_oc.id, 1,
      COALESCE(v_oc.fecha_recepcion::date, v_oc.created_at::date, CURRENT_DATE),
      v_oc.bodega_destino_id,
      'Entrega reconstruida al migrar: antes de la fase 1 la recepción solo guardaba un acumulado por ítem, sin fecha ni remisión propias.'
    )
    RETURNING id INTO v_rec;

    -- El trigger de sync recalcularía cantidad_rec a partir de estas líneas y
    -- daría exactamente el mismo valor que ya tiene, así que no se pierde nada.
    INSERT INTO oc_recepcion_items (recepcion_id, oc_item_id, producto_id, cantidad)
    SELECT v_rec, i.id, i.producto_id, i.cantidad_rec
      FROM oc_items i
     WHERE i.oc_id = v_oc.id AND COALESCE(i.cantidad_rec, 0) > 0;

    RAISE NOTICE 'Entrega histórica reconstruida para la orden %', v_oc.numero_oc;
  END LOOP;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Origen de la entrada
-- ─────────────────────────────────────────────────────────────────────────────
-- Esta es la pieza que permite exigir la orden sin bloquear nada: no toda
-- entrada es una compra. En las observaciones del histórico aparecen «ingresa
-- desde producción», «de la bodega de maquinaria» y «de lo que se reembasó».
-- La regla es una sola: si el origen es COMPRA, tiene que haber orden.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'origen_movimiento') THEN
    CREATE TYPE origen_movimiento AS ENUM (
      'COMPRA',            -- llegó de un proveedor contra una orden de compra
      'PRODUCCION',         -- lo produjo la empresa
      'REEMBASADO',         -- salió del proceso de reembasado
      'TRASLADO_INTERNO',   -- vino de otra bodega o área
      'DEVOLUCION_SEDE',    -- lo devolvió una sede
      'AJUSTE',             -- corrección de inventario
      'OTRO'
    );
  END IF;
END $$;

ALTER TABLE movimientos ADD COLUMN IF NOT EXISTS origen origen_movimiento;

COMMENT ON COLUMN movimientos.origen IS
  'De dónde viene la entrada. Solo COMPRA exige oc_id. Las entradas anteriores a la fase 1 quedaron en OTRO porque no se puede saber cuáles eran compras.';

CREATE INDEX IF NOT EXISTS idx_movimientos_origen
  ON movimientos(origen, created_at DESC) WHERE tipo = 'ENTRADA';

-- Backfill honesto: lo histórico no se marca como COMPRA. Donde la observación
-- lo dice sin ambigüedad sí se aprovecha.
UPDATE movimientos
   SET origen = CASE
         WHEN observacion ILIKE '%producci%'  THEN 'PRODUCCION'::origen_movimiento
         WHEN observacion ILIKE '%reembas%'   THEN 'REEMBASADO'::origen_movimiento
         WHEN observacion ILIKE '%maquinaria%' THEN 'TRASLADO_INTERNO'::origen_movimiento
         ELSE 'OTRO'::origen_movimiento
       END
 WHERE tipo = 'ENTRADA' AND origen IS NULL;

UPDATE movimientos SET origen = 'DEVOLUCION_SEDE' WHERE tipo = 'DEVOLUCION' AND origen IS NULL;
UPDATE movimientos SET origen = 'AJUSTE'          WHERE tipo = 'AJUSTE'     AND origen IS NULL;

-- NOT VALID a propósito: no revisa las 768 filas históricas, sí todo lo nuevo.
-- Solo atrapa la contradicción «digo que es compra pero no doy la orden»; no
-- obliga a que una entrada sea compra. El empujón para marcarlas va en la UI,
-- primero avisando y después bloqueando (ver §9.2 del documento).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'movimientos_compra_exige_oc' AND conrelid = 'movimientos'::regclass
  ) THEN
    ALTER TABLE movimientos
      ADD CONSTRAINT movimientos_compra_exige_oc
      CHECK (origen IS DISTINCT FROM 'COMPRA' OR oc_id IS NOT NULL) NOT VALID;
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Permisos nuevos
-- ─────────────────────────────────────────────────────────────────────────────
-- `crear_ordenes_compra` se queda con crear, editar, enviar y anular.
-- Catálogo de la UI: apps/inventario/lib/permisos.ts
--   aprobar_ordenes_compra            aprobar hasta el tope
--   aprobar_ordenes_compra_sin_tope   aprobar cualquier monto (Gerencia)
--   recibir_ordenes_compra            registrar las entregas

-- `defaults || permisos`: lo que ya esté puesto gana, así que re-aplicar la
-- migración no revive un permiso que un administrador haya apagado a mano.
UPDATE roles
   SET permisos = jsonb_build_object(
         'aprobar_ordenes_compra', true,
         'recibir_ordenes_compra', true
       ) || permisos
 WHERE rol_base = 'COORDINADOR_COMPRAS';

UPDATE roles
   SET permisos = jsonb_build_object(
         'aprobar_ordenes_compra', true,
         'aprobar_ordenes_compra_sin_tope', true,
         'recibir_ordenes_compra', true
       ) || permisos
 WHERE nombre IN ('Gerencia', 'Administrador');

-- Bodeguero: los 4 usuarios que de verdad reciben la mercancía. Aquí sí se
-- fuerza `ver_ordenes_compra`, que estaba explícitamente en false: estaban
-- ingresando mercancía sin poder ver contra qué orden la ingresaban. Es el
-- cambio que el usuario aprobó en §9.3.
UPDATE roles
   SET permisos = permisos || jsonb_build_object(
         'recibir_ordenes_compra', true,
         'ver_ordenes_compra', true
       )
 WHERE rol_base = 'BODEGUERO';

-- Auditor: solo lectura, ya ve las órdenes. No se le da nada nuevo.

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Topes de aprobación por monto
-- ─────────────────────────────────────────────────────────────────────────────
-- Corte acordado en 5.000.000, medido contra las 159 compras de los últimos 3
-- meses: deja el 79% resolviéndose dentro de compras y manda a Gerencia unas 11
-- al mes, que concentran cerca del 90% de la plata.

CREATE TABLE IF NOT EXISTS compras_niveles_aprobacion (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  monto_desde  NUMERIC(16,2) NOT NULL DEFAULT 0 CHECK (monto_desde >= 0),
  monto_hasta  NUMERIC(16,2),                       -- NULL = sin límite
  permiso      VARCHAR(80) NOT NULL,
  descripcion  VARCHAR(200),
  activo       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT compras_niveles_rango CHECK (monto_hasta IS NULL OR monto_hasta > monto_desde)
);

DROP TRIGGER IF EXISTS tr_compras_niveles_upd ON compras_niveles_aprobacion;
CREATE TRIGGER tr_compras_niveles_upd BEFORE UPDATE ON compras_niveles_aprobacion
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE compras_niveles_aprobacion IS
  'Qué permiso se exige para aprobar una orden según su valor total. Se edita desde la pantalla, no con migraciones: los montos cambian con la inflación.';

-- Semilla. OJO: nace APAGADO. El nivel alto apunta al MISMO permiso que el
-- bajo porque el rol Gerencia existe pero no tiene ningún usuario asignado; si
-- se encendiera ahora, toda compra de más de 5 millones quedaría trabada sin
-- nadie que pudiera aprobarla. Para encenderlo, una vez que Gerencia tenga
-- usuario:
--   UPDATE compras_niveles_aprobacion
--      SET permiso = 'aprobar_ordenes_compra_sin_tope'
--    WHERE monto_hasta IS NULL;
INSERT INTO compras_niveles_aprobacion (monto_desde, monto_hasta, permiso, descripcion)
SELECT 0, 5000000, 'aprobar_ordenes_compra', 'Hasta 5 millones: aprueba Coordinador de Compras'
 WHERE NOT EXISTS (SELECT 1 FROM compras_niveles_aprobacion WHERE monto_desde = 0);

INSERT INTO compras_niveles_aprobacion (monto_desde, monto_hasta, permiso, descripcion)
SELECT 5000000, NULL, 'aprobar_ordenes_compra',
       'Más de 5 millones: debería aprobar Gerencia. APAGADO hasta que ese rol tenga usuario.'
 WHERE NOT EXISTS (SELECT 1 FROM compras_niveles_aprobacion WHERE monto_hasta IS NULL);

-- Permiso exigido para un monto dado (el nivel activo que lo contiene).
CREATE OR REPLACE FUNCTION public.compras_permiso_para_monto(p_monto NUMERIC)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT permiso
    FROM compras_niveles_aprobacion
   WHERE activo
     AND COALESCE(p_monto, 0) >= monto_desde
     AND (monto_hasta IS NULL OR COALESCE(p_monto, 0) < monto_hasta)
   ORDER BY monto_desde DESC
   LIMIT 1
$$;

GRANT EXECUTE ON FUNCTION public.compras_permiso_para_monto(NUMERIC) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Trigger de aprobación: separación de funciones + tope por monto
-- ─────────────────────────────────────────────────────────────────────────────
-- Va en la base y no en el server action porque `lib/permisos-server.ts` y los
-- helpers `auth_permiso*` le dan paso libre a los roles base SUPER_ADMIN y
-- ADMIN. La regla «quien crea no aprueba» no admite excepción para nadie: hoy
-- la única orden del sistema la creó y la aprobó la misma persona.
--
-- El tope por monto SÍ usa `auth_permiso`, así que ahí los admin pasan. Son dos
-- controles distintos: uno evita el autocontrol, el otro ordena quién firma qué.

CREATE OR REPLACE FUNCTION public.tr_oc_aprobacion()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid     UUID := auth.uid();
  v_permiso TEXT;
BEGIN
  IF NEW.estado <> 'APROBADA' OR OLD.estado = 'APROBADA' THEN
    RETURN NEW;
  END IF;

  -- Quién aprueba: lo que venga en el UPDATE o, si no viene, el usuario actual.
  IF NEW.aprobado_por IS NULL THEN
    NEW.aprobado_por := v_uid;
  END IF;
  IF NEW.fecha_aprobacion IS NULL THEN
    NEW.fecha_aprobacion := NOW();
  END IF;

  -- Separación de funciones. Sin excepciones.
  IF NEW.aprobado_por IS NOT NULL AND NEW.aprobado_por = COALESCE(NEW.creado_por, OLD.creado_por) THEN
    RAISE EXCEPTION 'Quien crea una orden de compra no puede aprobarla. Pide la aprobación a otra persona de compras o a Gerencia.'
      USING ERRCODE = '42501';
  END IF;

  -- Tope por monto.
  v_permiso := public.compras_permiso_para_monto(NEW.valor_total);
  IF v_permiso IS NOT NULL AND NOT public.auth_permiso(v_permiso) THEN
    RAISE EXCEPTION 'Esta orden es de % y requiere el permiso "%" para aprobarla.',
      TO_CHAR(COALESCE(NEW.valor_total, 0), 'FM999,999,999,999'), v_permiso
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END $$;

-- Se llama `tr_oc_aprobacion` para que corra antes de `tr_oc_upd` (los triggers
-- de un mismo evento se ejecutan en orden alfabético).
DROP TRIGGER IF EXISTS tr_oc_aprobacion ON ordenes_compra;
CREATE TRIGGER tr_oc_aprobacion
  BEFORE UPDATE ON ordenes_compra
  FOR EACH ROW
  WHEN (NEW.estado IS DISTINCT FROM OLD.estado)
  EXECUTE FUNCTION public.tr_oc_aprobacion();

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. Recalcular el estado de la orden según lo recibido
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.oc_recalcular_estado(p_oc UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_estado   TEXT;
  v_algo     BOOLEAN;
  v_todo     BOOLEAN;
  v_nuevo    TEXT := NULL;
BEGIN
  SELECT estado::text INTO v_estado FROM ordenes_compra WHERE id = p_oc;
  IF v_estado IS NULL OR v_estado IN ('ANULADA', 'BORRADOR') THEN
    RETURN v_estado;
  END IF;

  SELECT COALESCE(BOOL_OR(COALESCE(cantidad_rec, 0) > 0), false),
         COALESCE(BOOL_AND(COALESCE(cantidad_rec, 0) >= cantidad_ped), false)
    INTO v_algo, v_todo
    FROM oc_items WHERE oc_id = p_oc;

  IF v_todo AND v_estado <> 'COMPLETA' THEN
    v_nuevo := 'COMPLETA';
  ELSIF v_algo AND NOT v_todo AND v_estado NOT IN ('PARCIAL', 'COMPLETA') THEN
    v_nuevo := 'PARCIAL';
  ELSIF NOT v_algo AND v_estado IN ('PARCIAL', 'COMPLETA') THEN
    -- Se borró o corrigió una entrega y ya no hay nada recibido.
    v_nuevo := 'ENVIADA';
  END IF;

  IF v_nuevo IS NOT NULL THEN
    UPDATE ordenes_compra
       SET estado = v_nuevo::estado_oc,
           fecha_recepcion = CASE
             WHEN v_nuevo = 'COMPLETA' THEN NOW()
             WHEN v_nuevo = 'ENVIADA'  THEN NULL     -- se corrigio la entrega y ya no hay nada recibido
             ELSE fecha_recepcion
           END
     WHERE id = p_oc;
    RETURN v_nuevo;
  END IF;

  RETURN v_estado;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. RPC: registrar una entrega completa en una sola transacción
-- ─────────────────────────────────────────────────────────────────────────────
-- Antes esto eran varias idas y vueltas desde el server action (leer ítems,
-- registrar movimiento, actualizar cantidad_rec, recalcular estado) y podía
-- quedar a medias; el código tenía un comentario reconociéndolo.
--
-- p_items: [{"oc_item_id": uuid, "cantidad": n, "cantidad_rechazada": n,
--            "motivo_rechazo": texto}]
--
-- No se le agrega un parámetro a `registrar_movimiento`: cambiarle la firma
-- crearía una función sobrecargada y la llamada por nombre desde PostgREST
-- quedaría ambigua.

CREATE OR REPLACE FUNCTION public.oc_registrar_recepcion(
  p_oc          UUID,
  p_items       JSONB,
  p_fecha       DATE    DEFAULT NULL,
  p_remision    TEXT    DEFAULT NULL,
  p_ubicacion   UUID    DEFAULT NULL,
  p_observacion TEXT    DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid       UUID := auth.uid();
  v_oc        RECORD;
  v_rec       UUID;
  v_cons      INT;
  v_it        JSONB;
  v_item      RECORD;
  v_cant      NUMERIC;
  v_rech      NUMERIC;
  v_motivo    TEXT;
  v_mov       UUID;
  v_lineas    INT := 0;
  v_nuevo     TEXT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Debes iniciar sesión.' USING ERRCODE = '42501';
  END IF;
  IF NOT public.auth_permiso('recibir_ordenes_compra') THEN
    RAISE EXCEPTION 'No tienes permiso para registrar entregas de órdenes de compra.' USING ERRCODE = '42501';
  END IF;

  -- Bloquea la orden: dos personas recibiendo la misma entrega a la vez no
  -- pueden pasarse del pedido ni repetir consecutivo.
  SELECT id, numero_oc, estado::text AS estado, bodega_destino_id
    INTO v_oc
    FROM ordenes_compra WHERE id = p_oc FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'La orden de compra no existe.';
  END IF;
  IF v_oc.estado NOT IN ('APROBADA', 'ENVIADA', 'PARCIAL') THEN
    RAISE EXCEPTION 'No se puede recibir una orden en estado %. Debe estar aprobada, enviada o parcial.', v_oc.estado;
  END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Indica al menos un ítem recibido.';
  END IF;

  SELECT COALESCE(MAX(consecutivo), 0) + 1 INTO v_cons FROM oc_recepciones WHERE oc_id = p_oc;

  INSERT INTO oc_recepciones (
    oc_id, consecutivo, fecha, remision, bodega_id, ubicacion_id,
    recibido_por, recibido_nombre, observacion
  ) VALUES (
    p_oc, v_cons, COALESCE(p_fecha, CURRENT_DATE), NULLIF(TRIM(COALESCE(p_remision, '')), ''),
    COALESCE(v_oc.bodega_destino_id, public.compras_bodega_central()), p_ubicacion,
    v_uid, (SELECT nombre FROM usuarios WHERE id = v_uid),
    NULLIF(TRIM(COALESCE(p_observacion, '')), '')
  ) RETURNING id INTO v_rec;

  FOR v_it IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_cant   := COALESCE((v_it ->> 'cantidad')::NUMERIC, 0);
    v_rech   := COALESCE((v_it ->> 'cantidad_rechazada')::NUMERIC, 0);
    v_motivo := NULLIF(TRIM(COALESCE(v_it ->> 'motivo_rechazo', '')), '');

    IF v_cant <= 0 AND v_rech <= 0 THEN
      CONTINUE;
    END IF;

    SELECT i.id, i.producto_id, i.cantidad_ped, COALESCE(i.cantidad_rec, 0) AS cantidad_rec
      INTO v_item
      FROM oc_items i
     WHERE i.id = (v_it ->> 'oc_item_id')::UUID AND i.oc_id = p_oc;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'El ítem % no pertenece a la orden %.', v_it ->> 'oc_item_id', v_oc.numero_oc;
    END IF;

    -- No se puede recibir más de lo pedido: antes esto se recortaba en
    -- silencio con un min(), y el descuadre aparecía después en el arqueo.
    IF v_item.cantidad_rec + v_cant > v_item.cantidad_ped THEN
      RAISE EXCEPTION 'En la orden % ya se habían recibido % de % de un producto; % más se pasa del pedido.',
        v_oc.numero_oc, v_item.cantidad_rec, v_item.cantidad_ped, v_cant;
    END IF;

    v_mov := NULL;
    IF v_cant > 0 THEN
      -- Entrada al inventario CON la orden y la ubicación. Esto es lo que las
      -- 768 entradas históricas no pudieron tener.
      INSERT INTO movimientos (
        tipo, producto_id, cantidad, ubicacion_id, oc_id, origen, observacion, usuario_id
      ) VALUES (
        'ENTRADA', v_item.producto_id, v_cant, p_ubicacion, p_oc, 'COMPRA',
        FORMAT('Recepción OC %s · entrega %s%s', v_oc.numero_oc, v_cons,
               CASE WHEN NULLIF(TRIM(COALESCE(p_remision, '')), '') IS NOT NULL
                    THEN ' · remisión ' || TRIM(p_remision) ELSE '' END),
        v_uid
      ) RETURNING id INTO v_mov;

      -- Stock: solo cantidad_real. `tr_stock_disponible` recalcula el
      -- disponible como real menos reservado, así que fijarlo aquí sería
      -- pisarle el trabajo.
      INSERT INTO stock (producto_id, cantidad_real) VALUES (v_item.producto_id, 0)
        ON CONFLICT (producto_id) DO NOTHING;
      UPDATE stock
         SET cantidad_real = cantidad_real + v_cant, updated_at = NOW()
       WHERE producto_id = v_item.producto_id;
    END IF;

    INSERT INTO oc_recepcion_items (
      recepcion_id, oc_item_id, producto_id, cantidad, cantidad_rechazada, motivo_rechazo, movimiento_id
    ) VALUES (v_rec, v_item.id, v_item.producto_id, v_cant, v_rech, v_motivo, v_mov);

    v_lineas := v_lineas + 1;
  END LOOP;

  IF v_lineas = 0 THEN
    RAISE EXCEPTION 'Ninguna línea traía cantidad recibida ni rechazada.';
  END IF;

  v_nuevo := public.oc_recalcular_estado(p_oc);

  INSERT INTO oc_eventos (oc_id, tipo, descripcion, detalle, usuario_id, usuario_email, usuario_nombre)
  SELECT p_oc, 'RECEPCION',
         FORMAT('Entrega %s registrada (%s %s).', v_cons, v_lineas,
                CASE WHEN v_lineas = 1 THEN 'producto' ELSE 'productos' END),
         jsonb_build_object('recepcion_id', v_rec, 'consecutivo', v_cons,
                            'remision', p_remision, 'estado', v_nuevo),
         v_uid, u.email, u.nombre
    FROM usuarios u WHERE u.id = v_uid;

  RETURN v_rec;
END $$;

GRANT EXECUTE ON FUNCTION public.oc_registrar_recepcion(UUID, JSONB, DATE, TEXT, UUID, TEXT) TO authenticated;

COMMENT ON FUNCTION public.oc_registrar_recepcion(UUID, JSONB, DATE, TEXT, UUID, TEXT) IS
  'Registra una entrega de proveedor: crea la recepción, sus ítems, los movimientos de entrada con oc_id y ubicación, suma el stock y recalcula el estado. Todo o nada.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. RLS
-- ─────────────────────────────────────────────────────────────────────────────
-- Las lecturas abiertas que ya existían (`auth_read_oc`, `auth_read_oc_items`)
-- no se tocan aquí: hay una revisión aparte de todas las políticas con
-- USING (true). Las tablas nuevas sí nacen cerradas por permiso.

ALTER TABLE oc_recepciones      ENABLE ROW LEVEL SECURITY;
ALTER TABLE oc_recepcion_items  ENABLE ROW LEVEL SECURITY;
ALTER TABLE compras_niveles_aprobacion ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS oc_recepciones_read ON oc_recepciones;
CREATE POLICY oc_recepciones_read ON oc_recepciones FOR SELECT TO authenticated
  USING (public.auth_permiso_any('{ver_ordenes_compra,crear_ordenes_compra,recibir_ordenes_compra}'::text[]));

DROP POLICY IF EXISTS oc_recepcion_items_read ON oc_recepcion_items;
CREATE POLICY oc_recepcion_items_read ON oc_recepcion_items FOR SELECT TO authenticated
  USING (public.auth_permiso_any('{ver_ordenes_compra,crear_ordenes_compra,recibir_ordenes_compra}'::text[]));

-- A propósito NO hay política de escritura en las dos tablas de entrega: la
-- única vía es `oc_registrar_recepcion()`, que es SECURITY DEFINER y valida el
-- permiso. Así no se puede registrar una entrega sin el movimiento de inventario
-- que la acompaña, que es exactamente el descuadre que esta fase viene a cerrar.

DROP POLICY IF EXISTS compras_niveles_read ON compras_niveles_aprobacion;
CREATE POLICY compras_niveles_read ON compras_niveles_aprobacion FOR SELECT TO authenticated
  USING (public.auth_permiso_any('{ver_ordenes_compra,crear_ordenes_compra,aprobar_ordenes_compra}'::text[]));

DROP POLICY IF EXISTS compras_niveles_write ON compras_niveles_aprobacion;
CREATE POLICY compras_niveles_write ON compras_niveles_aprobacion FOR ALL TO authenticated
  USING (public.auth_permiso_any('{gestionar_parametrizacion}'::text[]))
  WITH CHECK (public.auth_permiso_any('{gestionar_parametrizacion}'::text[]));

-- ── Órdenes de compra: se parte el permiso único ────────────────────────────
-- Antes: una sola política ALL contra `crear_ordenes_compra`, que por eso
-- mismo autorizaba crear, aprobar, recibir y anular con la misma llave.
DROP POLICY IF EXISTS write_oc ON ordenes_compra;

DROP POLICY IF EXISTS oc_insert ON ordenes_compra;
CREATE POLICY oc_insert ON ordenes_compra FOR INSERT TO authenticated
  WITH CHECK (public.auth_permiso('crear_ordenes_compra'));

-- UPDATE lo necesitan dos manos distintas: compras (editar, enviar, anular) y
-- quien aprueba. El trigger de arriba es el que decide si la aprobación vale.
DROP POLICY IF EXISTS oc_update ON ordenes_compra;
CREATE POLICY oc_update ON ordenes_compra FOR UPDATE TO authenticated
  USING (public.auth_permiso_any('{crear_ordenes_compra,aprobar_ordenes_compra,aprobar_ordenes_compra_sin_tope}'::text[]))
  WITH CHECK (public.auth_permiso_any('{crear_ordenes_compra,aprobar_ordenes_compra,aprobar_ordenes_compra_sin_tope}'::text[]));

DROP POLICY IF EXISTS oc_delete ON ordenes_compra;
CREATE POLICY oc_delete ON ordenes_compra FOR DELETE TO authenticated
  USING (public.auth_permiso('crear_ordenes_compra'));

-- Los ítems solo se editan en BORRADOR y eso lo valida el server action;
-- `cantidad_rec` ya no la escribe nadie a mano (la mantiene el trigger, que es
-- SECURITY DEFINER y no pasa por RLS).
DROP POLICY IF EXISTS write_oc_items ON oc_items;
DROP POLICY IF EXISTS oc_items_write ON oc_items;
CREATE POLICY oc_items_write ON oc_items FOR ALL TO authenticated
  USING (public.auth_permiso('crear_ordenes_compra'))
  WITH CHECK (public.auth_permiso('crear_ordenes_compra'));

-- Comentarios y eventos: también los deja escribir quien recibe o aprueba.
DROP POLICY IF EXISTS oc_eventos_write ON oc_eventos;
CREATE POLICY oc_eventos_write ON oc_eventos FOR INSERT TO authenticated
  WITH CHECK (public.auth_permiso_any('{crear_ordenes_compra,aprobar_ordenes_compra,aprobar_ordenes_compra_sin_tope,recibir_ordenes_compra}'::text[]));

-- ─────────────────────────────────────────────────────────────────────────────
-- 10. Vista para medir si la fase 1 sirvió
-- ─────────────────────────────────────────────────────────────────────────────
-- Indicador de §9.7: qué porcentaje de las entradas de compra trae orden.

CREATE OR REPLACE VIEW v_compras_cobertura_oc WITH (security_invoker = true) AS
SELECT
  TO_CHAR(m.created_at, 'YYYY-MM')                                      AS mes,
  COUNT(*)                                                               AS entradas,
  COUNT(*) FILTER (WHERE m.origen = 'COMPRA')                            AS marcadas_compra,
  COUNT(*) FILTER (WHERE m.oc_id IS NOT NULL)                            AS con_orden,
  ROUND(100.0 * COUNT(*) FILTER (WHERE m.oc_id IS NOT NULL)
        / NULLIF(COUNT(*) FILTER (WHERE m.origen = 'COMPRA'), 0), 1)     AS pct_compras_con_orden
FROM movimientos m
WHERE m.tipo = 'ENTRADA'
GROUP BY 1
ORDER BY 1 DESC;

COMMENT ON VIEW v_compras_cobertura_oc IS
  'Por mes: entradas al inventario, cuántas se declaran compra y cuántas traen orden. Arranca en 0 de 768; la meta de la fase 1 es más del 80% de las nuevas.';

GRANT SELECT ON v_compras_cobertura_oc TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 11. Entradas desde la pantalla de movimientos
-- ─────────────────────────────────────────────────────────────────────────────
-- Casi todas las entradas no pasan por la orden: se cargan por lotes en
-- /movimientos/nuevo. `registrar_movimiento` no puede llevar el origen ni la
-- orden, y NO se le cambia la firma: hay funciones de la base que la llaman por
-- posición (`ejecutar_reembasado`, las devoluciones de órdenes de insumo), así
-- que tocarla las rompería. Se agrega una función propia para las entradas.

CREATE OR REPLACE FUNCTION public.registrar_entrada(
  p_producto    UUID,
  p_cantidad    NUMERIC,
  p_origen      TEXT DEFAULT NULL,
  p_oc          UUID DEFAULT NULL,
  p_ubicacion   UUID DEFAULT NULL,
  p_sede        UUID DEFAULT NULL,
  p_observacion TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_id  UUID;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Debes iniciar sesión.' USING ERRCODE = '42501';
  END IF;
  IF NOT public.auth_permiso('crear_movimientos') THEN
    RAISE EXCEPTION 'No tienes permiso para registrar movimientos.' USING ERRCODE = '42501';
  END IF;
  IF p_cantidad IS NULL OR p_cantidad <= 0 THEN
    RAISE EXCEPTION 'La cantidad debe ser mayor que cero';
  END IF;
  IF p_origen = 'COMPRA' AND p_oc IS NULL THEN
    RAISE EXCEPTION 'Una entrada de compra necesita su orden de compra.';
  END IF;
  -- Al revés también: si se da una orden, la entrada es una compra.
  IF p_oc IS NOT NULL AND COALESCE(p_origen, 'COMPRA') <> 'COMPRA' THEN
    RAISE EXCEPTION 'No se puede ligar una orden de compra a una entrada de origen %.', p_origen;
  END IF;

  INSERT INTO movimientos (tipo, producto_id, cantidad, sede_id, ubicacion_id, oc_id, origen, observacion, usuario_id)
  VALUES ('ENTRADA', p_producto, p_cantidad, p_sede, p_ubicacion, p_oc,
          CASE WHEN p_oc IS NOT NULL THEN 'COMPRA'::origen_movimiento
               ELSE NULLIF(p_origen, '')::origen_movimiento END,
          NULLIF(TRIM(COALESCE(p_observacion, '')), ''), v_uid)
  RETURNING id INTO v_id;

  -- Igual que `registrar_movimiento`: solo cantidad_real; el disponible lo fija
  -- el trigger `tr_stock_disponible` como real menos reservado.
  INSERT INTO stock (producto_id, cantidad_real) VALUES (p_producto, 0)
    ON CONFLICT (producto_id) DO NOTHING;
  UPDATE stock SET cantidad_real = cantidad_real + p_cantidad, updated_at = NOW()
   WHERE producto_id = p_producto;

  RETURN v_id;
END $$;

GRANT EXECUTE ON FUNCTION public.registrar_entrada(UUID, NUMERIC, TEXT, UUID, UUID, UUID, TEXT) TO authenticated;

COMMENT ON FUNCTION public.registrar_entrada(UUID, NUMERIC, TEXT, UUID, UUID, UUID, TEXT) IS
  'Entrada de inventario que SÍ puede declarar su origen y su orden de compra. Para lo demás sigue sirviendo registrar_movimiento.';

-- ── Origen deducido para las entradas que entran por otras funciones ────────
-- `ejecutar_reembasado` y las devoluciones de órdenes de insumo llaman a
-- `registrar_movimiento`, que no conoce el origen. En vez de tocar esas
-- funciones (y arriesgarlas), se deduce lo deducible al insertar. Una entrada
-- común y corriente se queda SIN origen a propósito: es lo que la pantalla
-- señala para que alguien diga de dónde vino.
CREATE OR REPLACE FUNCTION public.tr_movimientos_origen()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.origen IS NOT NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.oc_id IS NOT NULL THEN
    NEW.origen := 'COMPRA';
  ELSIF NEW.tipo = 'DEVOLUCION' THEN
    NEW.origen := 'DEVOLUCION_SEDE';
  ELSIF NEW.tipo = 'AJUSTE' THEN
    NEW.origen := 'AJUSTE';
  ELSIF NEW.tipo = 'ENTRADA' THEN
    NEW.origen := CASE
      WHEN NEW.observacion ILIKE '%reembas%'    THEN 'REEMBASADO'::origen_movimiento
      WHEN NEW.observacion ILIKE '%producci%'   THEN 'PRODUCCION'::origen_movimiento
      WHEN NEW.observacion ILIKE '%maquinaria%' THEN 'TRASLADO_INTERNO'::origen_movimiento
      ELSE NULL   -- a proposito: que la pantalla pida decirlo
    END;
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS tr_movimientos_origen ON movimientos;
CREATE TRIGGER tr_movimientos_origen
  BEFORE INSERT ON movimientos
  FOR EACH ROW EXECUTE FUNCTION public.tr_movimientos_origen();

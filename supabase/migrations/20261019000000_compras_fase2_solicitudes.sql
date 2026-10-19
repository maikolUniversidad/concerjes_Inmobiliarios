-- =============================================================================
-- MÓDULO COMPRAS — FASE 2: la solicitud de compra
-- =============================================================================
-- Decisión de negocio que manda sobre esta fase (docs/modulo-compras.md §7.1,
-- aceptada el 2026-10-18): **la solicitud NO es obligatoria**. Compras sigue
-- creando la orden directo. `ordenes_compra.solicitud_id` nace NULLABLE y
-- ningún camino la exige.
--
-- El motivo es de adopción, no de modelo: hay 1 sola orden de compra en todo el
-- sistema frente a 768 entradas de mercancía sin orden. Meter un paso
-- obligatorio nuevo antes de uno que todavía nadie usa llevaría a que compras y
-- bodega trabajen por fuera del sistema.
--
-- La solicitud nace opcional y automática solo donde sale gratis:
--   · las órdenes pendientes por falta de stock (hay 23 abiertas, 54 ítems,
--     1.560 unidades): ahí el sistema ya sabe qué producto, cuánto, para qué
--     sede y quién lo pidió, así que no hay nada que escribir;
--   · la recomendación de compra en vivo (109 productos, 264 millones).
--
-- Lo que esta migración deja:
--   1. `solicitudes_compra` + `solicitud_compra_items` con numeración
--      SC-YYYYMM-NNN por máximo del período y reintento ante concurrencia
--      (el mismo patrón de `crearOC`, no un conteo: anular no repite número).
--   2. `ordenes_compra.solicitud_id` NULLABLE.
--   3. Permiso `solicitar_compras` (Coordinador, Coordinador de Compras,
--      Bodeguero) y RLS por `auth_permiso`.
--   4. `compras_precio_sugerido()`: de dónde sale el proveedor y el precio.
--      Una sola fuente de verdad para la pantalla y para la conversión.
--   5. Generación desde la recomendación y desde una orden pendiente.
--   6. `sc_convertir_a_oc()`: una orden de compra POR PROVEEDOR, con el precio
--      del comparador cuando lo hay y el de lista cuando no.
--
-- Medido en la base antes de escribir esto (2026-10-19, solo lectura):
--   · `v_recomendacion_compra` NO tiene columna de proveedor. Hay que deducirlo.
--   · De los 109 productos recomendados, 55 tienen precio en el comparador y 43
--     tienen `productos.proveedor_id`. Combinando las dos fuentes quedan 73 con
--     proveedor y **36 sin ninguno** (83 de los 264 millones). Esos 36 no pueden
--     convertirse en orden solos: la conversión los deja en la solicitud y los
--     reporta, en vez de inventarles un proveedor.
--   · `precios_proveedor` cubre 256 productos × 3 proveedores (de 498 activos).
--   · Las 23 órdenes pendientes abiertas tienen `contrato_id` en NULL las 23:
--     el módulo de contratos todavía no lo llena, así que el campo de la
--     solicitud nace nullable y se copia cuando exista.
--   · `oc_items.subtotal` es GENERATED ALWAYS (cantidad_ped * precio_unit): no
--     se inserta.
--
-- Fuera de alcance a propósito (fases 3 a 5): cotizaciones, facturas de
-- proveedor, histórico de precios y presupuesto por contrato.
--
-- IDEMPOTENTE.
-- =============================================================================

SET search_path TO public;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Tipos
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'origen_solicitud_compra') THEN
    CREATE TYPE origen_solicitud_compra AS ENUM ('RECOMENDACION', 'PENDIENTE_DESPACHO', 'MANUAL');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'estado_solicitud_compra') THEN
    -- PARCIAL = parte de los ítems ya pasaron a una orden de compra.
    CREATE TYPE estado_solicitud_compra AS ENUM
      ('BORRADOR', 'ENVIADA', 'PARCIAL', 'CONVERTIDA', 'RECHAZADA', 'ANULADA');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'prioridad_solicitud_compra') THEN
    CREATE TYPE prioridad_solicitud_compra AS ENUM ('BAJA', 'NORMAL', 'ALTA', 'URGENTE');
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Tablas
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS solicitudes_compra (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  numero                VARCHAR(20) NOT NULL UNIQUE,      -- SC-YYYYMM-NNN
  origen                origen_solicitud_compra NOT NULL DEFAULT 'MANUAL',
  estado                estado_solicitud_compra NOT NULL DEFAULT 'BORRADOR',
  prioridad             prioridad_solicitud_compra NOT NULL DEFAULT 'NORMAL',
  sede_id               UUID REFERENCES sedes(id),        -- NULL = para la bodega central
  contrato_id           UUID REFERENCES contratos(id),    -- nullable: contratos todavía no lo llena
  proveedor_sugerido_id UUID REFERENCES proveedores(id),  -- cuando la solicitud ya nace agrupada
  observacion           TEXT,
  motivo_cierre         TEXT,                             -- por qué se rechazó o se anuló
  solicitado_por        UUID NOT NULL REFERENCES usuarios(id),
  solicitado_nombre     VARCHAR(200),                     -- desnormalizado: la RLS de usuarios solo deja leer el propio registro
  enviada_at            TIMESTAMPTZ,
  cerrada_at            TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sc_estado    ON solicitudes_compra(estado, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sc_origen    ON solicitudes_compra(origen);
CREATE INDEX IF NOT EXISTS idx_sc_sede      ON solicitudes_compra(sede_id);
CREATE INDEX IF NOT EXISTS idx_sc_proveedor ON solicitudes_compra(proveedor_sugerido_id);

COMMENT ON TABLE solicitudes_compra IS
  'Requisición de compra: qué se necesita, cuánto y para qué sede. NO es obligatoria (decisión §7.1): compras puede crear la orden directo.';
COMMENT ON COLUMN solicitudes_compra.contrato_id IS
  'Nullable a propósito: el módulo de contratos todavía no lo llena. Se copia de la orden de insumo cuando la tenga.';
COMMENT ON COLUMN solicitudes_compra.proveedor_sugerido_id IS
  'Proveedor con el que nació agrupada (la recomendación agrupa por proveedor). Es una sugerencia: la conversión vuelve a resolverlo ítem por ítem.';

CREATE TABLE IF NOT EXISTS solicitud_compra_items (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  solicitud_id          UUID NOT NULL REFERENCES solicitudes_compra(id) ON DELETE CASCADE,
  producto_id           UUID NOT NULL REFERENCES productos(id),
  cantidad              NUMERIC(14,2) NOT NULL CHECK (cantidad > 0),
  cantidad_convertida   NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (cantidad_convertida >= 0),
  orden_insumo_id       UUID REFERENCES ordenes_insumo(id) ON DELETE SET NULL,
  proveedor_sugerido_id UUID REFERENCES proveedores(id),
  precio_ref            NUMERIC(14,2),      -- precio con el que se estimó el valor al generarla
  fuente_precio         VARCHAR(20),        -- COMPARADOR / LISTA / SIN_PRECIO
  justificacion         TEXT,
  oc_id                 UUID REFERENCES ordenes_compra(id) ON DELETE SET NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sci_solicitud ON solicitud_compra_items(solicitud_id);
CREATE INDEX IF NOT EXISTS idx_sci_producto  ON solicitud_compra_items(producto_id);
CREATE INDEX IF NOT EXISTS idx_sci_oi        ON solicitud_compra_items(orden_insumo_id) WHERE orden_insumo_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sci_oc        ON solicitud_compra_items(oc_id) WHERE oc_id IS NOT NULL;

COMMENT ON TABLE solicitud_compra_items IS
  'Qué se pide en una solicitud de compra. `orden_insumo_id` apunta a la orden pendiente por falta de stock que la originó.';
COMMENT ON COLUMN solicitud_compra_items.cantidad_convertida IS
  'Cuánto de este ítem ya pasó a una orden de compra. Permite convertir por partes (un proveedor hoy, otro mañana).';

DROP TRIGGER IF EXISTS tr_sc_upd ON solicitudes_compra;
CREATE TRIGGER tr_sc_upd BEFORE UPDATE ON solicitudes_compra
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. La orden de compra puede venir de una solicitud — o no
-- ─────────────────────────────────────────────────────────────────────────────
-- NULLABLE y sin restricción que la exija. Es la decisión §7.1: el día que se
-- quiera volver obligatoria es cambiar un parámetro, no rehacer el módulo.

ALTER TABLE ordenes_compra
  ADD COLUMN IF NOT EXISTS solicitud_id UUID REFERENCES solicitudes_compra(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_oc_solicitud ON ordenes_compra(solicitud_id) WHERE solicitud_id IS NOT NULL;

COMMENT ON COLUMN ordenes_compra.solicitud_id IS
  'Solicitud de la que salió la orden, si salió de una. NULLABLE a propósito (§7.1): compras sigue pudiendo crear la orden directo.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Permiso nuevo
-- ─────────────────────────────────────────────────────────────────────────────
-- Catálogo de la UI: apps/inventario/lib/permisos.ts
-- `defaults || permisos`: lo que ya esté puesto gana, así que re-aplicar la
-- migración no revive un permiso que un administrador haya apagado a mano.

UPDATE roles
   SET permisos = jsonb_build_object('solicitar_compras', true) || permisos
 WHERE rol_base IN ('COORDINADOR_COMPRAS', 'BODEGUERO')
    OR nombre = 'Coordinador';

-- Gerencia y Administrador no necesitan la siembra: `auth_permiso` le da paso
-- libre a los roles base SUPER_ADMIN y ADMIN.

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. De dónde sale el proveedor y el precio
-- ─────────────────────────────────────────────────────────────────────────────
-- Una sola fuente de verdad: la usa la pantalla (a través de la vista) y la usa
-- la conversión a orden. Si estuvieran escritas dos veces, la pantalla podría
-- prometer un precio y la orden salir con otro.
--
-- Orden de preferencia: precio vigente del comparador (el más barato) y su
-- proveedor; si no hay, el proveedor del producto con su precio de lista.
--
-- NO es SECURITY DEFINER: `precios_proveedor` y `productos` están cerrados por
-- permiso de lectura, y la vista de abajo es `security_invoker`, así que quien
-- no puede ver precios tampoco los ve por este camino. Dentro de las funciones
-- `sc_*` (que sí son DEFINER) corre con los privilegios del dueño, como debe.

CREATE OR REPLACE FUNCTION public.compras_precio_sugerido(
  p_producto  UUID,
  p_proveedor UUID DEFAULT NULL
)
RETURNS TABLE (proveedor_id UUID, precio NUMERIC, fuente TEXT)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH comparador AS (
    SELECT pp.proveedor_id, pp.precio
      FROM precios_proveedor pp
     WHERE pp.producto_id = p_producto
       AND COALESCE(pp.vigente, true)
       AND pp.precio > 0
       AND (p_proveedor IS NULL OR pp.proveedor_id = p_proveedor)
     ORDER BY pp.precio, pp.fecha_cotiz DESC NULLS LAST
     LIMIT 1
  ), lista AS (
    SELECT p.proveedor_id, p.precio_lista
      FROM productos p
     WHERE p.id = p_producto
  )
  SELECT COALESCE(c.proveedor_id, p_proveedor, l.proveedor_id),
         COALESCE(c.precio, l.precio_lista),
         CASE WHEN c.precio IS NOT NULL      THEN 'COMPARADOR'
              WHEN l.precio_lista IS NOT NULL THEN 'LISTA'
              ELSE 'SIN_PRECIO' END
    FROM lista l
    LEFT JOIN comparador c ON TRUE
$$;

COMMENT ON FUNCTION public.compras_precio_sugerido(UUID, UUID) IS
  'Proveedor y precio con que se valora un producto: comparador vigente más barato, o proveedor del producto con precio de lista.';

GRANT EXECUTE ON FUNCTION public.compras_precio_sugerido(UUID, UUID) TO authenticated;

-- La recomendación en vivo, ya con proveedor y precio. `v_recomendacion_compra`
-- no trae proveedor (comprobado en la base), y la pantalla necesita agrupar.
CREATE OR REPLACE VIEW v_recomendacion_compra_proveedor WITH (security_invoker = true) AS
SELECT r.producto_id,
       r.codigo,
       r.nombre_estandar,
       r.presentacion,
       r.cat_rotacion,
       r.precio_lista,
       r.stock_real,
       r.stock_minimo,
       r.comprometido,
       r.oc_pendiente,
       r.recomendado,
       s.proveedor_id          AS proveedor_sugerido_id,
       pr.nombre               AS proveedor_sugerido,
       s.precio                AS precio_sugerido,
       s.fuente                AS fuente_precio,
       ROUND(r.recomendado * COALESCE(s.precio, 0), 2) AS valor_estimado
  FROM v_recomendacion_compra r
  CROSS JOIN LATERAL public.compras_precio_sugerido(r.producto_id) s
  LEFT JOIN proveedores pr ON pr.id = s.proveedor_id;

COMMENT ON VIEW v_recomendacion_compra_proveedor IS
  'v_recomendacion_compra + proveedor y precio sugeridos, para poder agrupar la solicitud por proveedor.';

GRANT SELECT ON v_recomendacion_compra_proveedor TO authenticated;

-- Órdenes pendientes por falta de stock que todavía no tienen solicitud. Es el
-- panel de «generar solicitud» de /solicitudes-compra.
--
-- Dos cosas que se vieron en los datos al armarla:
--   · Hay 32 órdenes pendientes, pero solo tiene sentido comprar para las que
--     NO han salido de la bodega: una pendiente DESPACHADA se alcanzó a
--     despachar, así que el stock apareció y ya no hay nada que comprar. De ahí
--     la lista de estados (no un simple «distinto de anulada»): quedan 23.
--   · El filtro de «ya tiene solicitud» va por PRODUCTO, no por orden, igual
--     que `sc_generar_desde_pendiente`. Si fuera por orden, una solicitud
--     parcial escondería la orden y el resto de sus productos no se pediría
--     nunca. El JOIN interno saca de la lista las órdenes que ya no tienen
--     ningún producto por pedir.
CREATE OR REPLACE VIEW v_sc_pendientes_sin_solicitud WITH (security_invoker = true) AS
SELECT o.id            AS orden_insumo_id,
       o.numero,
       o.estado::text  AS estado,
       o.created_at,
       o.urgente,
       o.sede_id,
       se.nombre       AS sede,
       org.numero      AS orden_origen,
       COUNT(i.id)                             AS items,
       COALESCE(SUM(i.cantidad_solicitada), 0) AS unidades,
       ROUND(COALESCE(SUM(i.cantidad_solicitada * COALESCE(s.precio, 0)), 0), 2) AS valor_estimado
  FROM ordenes_insumo o
  JOIN orden_insumo_items i
    ON i.orden_id = o.id
   AND i.cantidad_solicitada > 0
   AND NOT EXISTS (
     SELECT 1
       FROM solicitud_compra_items si
       JOIN solicitudes_compra sc ON sc.id = si.solicitud_id
      WHERE si.orden_insumo_id = o.id
        AND si.producto_id = i.producto_id
        AND sc.estado <> 'ANULADA'
   )
  CROSS JOIN LATERAL public.compras_precio_sugerido(i.producto_id) s
  LEFT JOIN sedes se           ON se.id  = o.sede_id
  LEFT JOIN ordenes_insumo org ON org.id = o.orden_origen_id
 WHERE o.orden_origen_id IS NOT NULL
   AND o.estado IN ('BORRADOR', 'EN_REVISION', 'CAMBIOS_SOLICITADOS', 'APROBADA', 'PENDIENTE', 'EN_ALISTAMIENTO')
 GROUP BY o.id, o.numero, o.estado, o.created_at, o.urgente, o.sede_id, se.nombre, org.numero;

COMMENT ON VIEW v_sc_pendientes_sin_solicitud IS
  'Órdenes pendientes por falta de stock que aún no salieron de bodega y les falta pedir al menos un producto.';

GRANT SELECT ON v_sc_pendientes_sin_solicitud TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Numeración
-- ─────────────────────────────────────────────────────────────────────────────
-- MÁXIMO consecutivo del período, no conteo: anular o borrar una solicitud no
-- puede hacer que la siguiente repita número. Es el patrón de `crearOC`.

CREATE OR REPLACE FUNCTION public.sc_siguiente_consecutivo(p_prefijo TEXT)
RETURNS INT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(MAX((substring(numero FROM '([0-9]+)$'))::INT), 0) + 1
    FROM solicitudes_compra
   WHERE numero LIKE p_prefijo || '%'
$$;

CREATE OR REPLACE FUNCTION public.oc_siguiente_consecutivo(p_prefijo TEXT)
RETURNS INT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(MAX((substring(numero_oc FROM '([0-9]+)$'))::INT), 0) + 1
    FROM ordenes_compra
   WHERE numero_oc LIKE p_prefijo || '%'
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. Crear una solicitud
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.sc_crear(
  p_items       JSONB,                       -- [{producto_id, cantidad, proveedor_id?, precio_ref?, fuente_precio?, orden_insumo_id?, justificacion?}]
  p_origen      TEXT DEFAULT 'MANUAL',
  p_sede        UUID DEFAULT NULL,
  p_prioridad   TEXT DEFAULT 'NORMAL',
  p_observacion TEXT DEFAULT NULL,
  p_proveedor   UUID DEFAULT NULL,
  p_contrato    UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid     UUID := auth.uid();
  v_id      UUID;
  v_prefijo TEXT := 'SC-' || to_char(CURRENT_DATE, 'YYYYMM') || '-';
  v_cons    INT;
  v_it      JSONB;
  v_lineas  INT := 0;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Debes iniciar sesión.' USING ERRCODE = '42501';
  END IF;
  IF NOT public.auth_permiso('solicitar_compras') THEN
    RAISE EXCEPTION 'No tienes permiso para crear solicitudes de compra.' USING ERRCODE = '42501';
  END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Indica al menos un producto en la solicitud.';
  END IF;

  v_cons := public.sc_siguiente_consecutivo(v_prefijo);
  FOR i IN 1..15 LOOP
    BEGIN
      INSERT INTO solicitudes_compra (
        numero, origen, estado, prioridad, sede_id, contrato_id,
        proveedor_sugerido_id, observacion, solicitado_por, solicitado_nombre
      ) VALUES (
        v_prefijo || lpad(v_cons::TEXT, 3, '0'),
        p_origen::origen_solicitud_compra,
        'BORRADOR',
        COALESCE(p_prioridad, 'NORMAL')::prioridad_solicitud_compra,
        p_sede, p_contrato, p_proveedor,
        NULLIF(TRIM(COALESCE(p_observacion, '')), ''),
        v_uid, (SELECT nombre FROM usuarios WHERE id = v_uid)
      ) RETURNING id INTO v_id;
      EXIT;
    EXCEPTION WHEN unique_violation THEN
      -- Otra sesión tomó el número entre el cálculo y el insert.
      v_cons := GREATEST(v_cons + 1, public.sc_siguiente_consecutivo(v_prefijo));
    END;
  END LOOP;

  IF v_id IS NULL THEN
    RAISE EXCEPTION 'No se pudo asignar número de solicitud, intenta de nuevo.';
  END IF;

  FOR v_it IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    IF COALESCE((v_it ->> 'cantidad')::NUMERIC, 0) <= 0 THEN
      CONTINUE;
    END IF;
    INSERT INTO solicitud_compra_items (
      solicitud_id, producto_id, cantidad, orden_insumo_id,
      proveedor_sugerido_id, precio_ref, fuente_precio, justificacion
    ) VALUES (
      v_id,
      (v_it ->> 'producto_id')::UUID,
      (v_it ->> 'cantidad')::NUMERIC,
      NULLIF(v_it ->> 'orden_insumo_id', '')::UUID,
      COALESCE(NULLIF(v_it ->> 'proveedor_id', '')::UUID, p_proveedor),
      NULLIF(v_it ->> 'precio_ref', '')::NUMERIC,
      NULLIF(v_it ->> 'fuente_precio', ''),
      NULLIF(TRIM(COALESCE(v_it ->> 'justificacion', '')), '')
    );
    v_lineas := v_lineas + 1;
  END LOOP;

  IF v_lineas = 0 THEN
    RAISE EXCEPTION 'Ninguna línea tenía cantidad mayor que cero.';
  END IF;

  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION public.sc_crear(JSONB, TEXT, UUID, TEXT, TEXT, UUID, UUID) IS
  'Crea una solicitud de compra con sus ítems en una sola transacción. Numeración SC-YYYYMM-NNN con reintento.';

GRANT EXECUTE ON FUNCTION public.sc_crear(JSONB, TEXT, UUID, TEXT, TEXT, UUID, UUID) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. Generar desde la recomendación de compra, agrupando por proveedor
-- ─────────────────────────────────────────────────────────────────────────────
-- Una solicitud por proveedor: así cada una convierte a exactamente una orden.
-- El proveedor y el precio salen de la vista, no del cliente: la pantalla no
-- puede pedir un precio que la base no reconozca.
--
-- Los productos sin proveedor (36 de los 109 medidos) se agrupan en una
-- solicitud aparte con `proveedor_sugerido_id` en NULL. Quedan registrados y
-- visibles, que es el punto, pero no se convierten solos.

CREATE OR REPLACE FUNCTION public.sc_generar_desde_recomendacion(
  p_items     JSONB DEFAULT NULL,    -- [{producto_id, cantidad?}] · NULL = todo lo recomendado
  p_prioridad TEXT  DEFAULT 'NORMAL'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid    UUID := auth.uid();
  v_grupo  RECORD;
  v_id     UUID;
  v_out    JSONB := '[]'::JSONB;
  v_total  INT := 0;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Debes iniciar sesión.' USING ERRCODE = '42501';
  END IF;
  IF NOT public.auth_permiso('solicitar_compras') THEN
    RAISE EXCEPTION 'No tienes permiso para crear solicitudes de compra.' USING ERRCODE = '42501';
  END IF;

  FOR v_grupo IN
    WITH pedido AS (
      SELECT (e ->> 'producto_id')::UUID AS producto_id,
             NULLIF(e ->> 'cantidad', '')::NUMERIC AS cantidad
        FROM jsonb_array_elements(COALESCE(p_items, '[]'::JSONB)) e
    ), base AS (
      SELECT r.producto_id,
             -- La cantidad del cliente solo puede ser MENOR que la recomendada:
             -- la pantalla ajusta a la baja, no inventa demanda.
             LEAST(COALESCE(p.cantidad, r.recomendado), r.recomendado) AS cantidad,
             r.proveedor_sugerido_id,
             r.precio_sugerido,
             r.fuente_precio
        FROM v_recomendacion_compra_proveedor r
        LEFT JOIN pedido p ON p.producto_id = r.producto_id
       WHERE r.recomendado > 0
         AND (p_items IS NULL OR p.producto_id IS NOT NULL)
    )
    SELECT proveedor_sugerido_id,
           jsonb_agg(jsonb_build_object(
             'producto_id',   producto_id,
             'cantidad',      cantidad,
             'proveedor_id',  proveedor_sugerido_id,
             'precio_ref',    precio_sugerido,
             'fuente_precio', fuente_precio,
             'justificacion', 'Recomendación de compra: el stock y lo ya pedido en OC no cubren la demanda comprometida.'
           )) AS items,
           COUNT(*) AS productos
      FROM base
     WHERE cantidad > 0
     GROUP BY proveedor_sugerido_id
     ORDER BY proveedor_sugerido_id NULLS LAST
  LOOP
    v_id := public.sc_crear(
      p_items       => v_grupo.items,
      p_origen      => 'RECOMENDACION',
      p_sede        => NULL,
      p_prioridad   => COALESCE(p_prioridad, 'NORMAL'),
      p_observacion => CASE WHEN v_grupo.proveedor_sugerido_id IS NULL
                           THEN 'Generada desde la recomendación de compra. Estos productos no tienen proveedor en el comparador ni en su ficha: hay que elegirlo antes de convertirla en orden.'
                           ELSE 'Generada desde la recomendación de compra en vivo.' END,
      p_proveedor   => v_grupo.proveedor_sugerido_id
    );
    v_total := v_total + 1;
    v_out := v_out || jsonb_build_object(
      'solicitud_id', v_id,
      'numero',       (SELECT numero FROM solicitudes_compra WHERE id = v_id),
      'proveedor_id', v_grupo.proveedor_sugerido_id,
      'proveedor',    (SELECT nombre FROM proveedores WHERE id = v_grupo.proveedor_sugerido_id),
      'productos',    v_grupo.productos
    );
  END LOOP;

  IF v_total = 0 THEN
    RAISE EXCEPTION 'No hay nada recomendado para solicitar.';
  END IF;

  RETURN jsonb_build_object('solicitudes', v_out, 'total', v_total);
END;
$$;

COMMENT ON FUNCTION public.sc_generar_desde_recomendacion(JSONB, TEXT) IS
  'Crea una solicitud de compra por proveedor a partir de v_recomendacion_compra_proveedor. Los productos sin proveedor quedan en una solicitud aparte.';

GRANT EXECUTE ON FUNCTION public.sc_generar_desde_recomendacion(JSONB, TEXT) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. Generar desde una orden pendiente por falta de stock
-- ─────────────────────────────────────────────────────────────────────────────
-- Es la única puerta donde la solicitud sale gratis (§7.1): el sistema ya sabe
-- qué producto, cuánto, para qué sede y quién lo pidió.
--
-- Una sola solicitud por orden pendiente, aunque toque varios proveedores: lo
-- que une estos ítems es la sede que se quedó sin su insumo, y la conversión ya
-- sabe partirlos por proveedor.

CREATE OR REPLACE FUNCTION public.sc_generar_desde_pendiente(p_orden UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid   UUID := auth.uid();
  v_ord   RECORD;
  v_items JSONB;
  v_id    UUID;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Debes iniciar sesión.' USING ERRCODE = '42501';
  END IF;
  IF NOT public.auth_permiso('solicitar_compras') THEN
    RAISE EXCEPTION 'No tienes permiso para crear solicitudes de compra.' USING ERRCODE = '42501';
  END IF;

  SELECT o.id, o.numero, o.sede_id, o.contrato_id, o.urgente, o.estado::TEXT AS estado,
         o.orden_origen_id, org.numero AS origen_numero
    INTO v_ord
    FROM ordenes_insumo o
    LEFT JOIN ordenes_insumo org ON org.id = o.orden_origen_id
   WHERE o.id = p_orden
   FOR UPDATE OF o;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'La orden de insumo no existe.';
  END IF;
  IF v_ord.orden_origen_id IS NULL THEN
    RAISE EXCEPTION 'La orden % no es una orden pendiente por falta de stock.', v_ord.numero;
  END IF;
  -- Misma lista de estados que `v_sc_pendientes_sin_solicitud`: si la pendiente
  -- ya salió de la bodega, el stock apareció y no hay nada que comprar.
  IF v_ord.estado NOT IN ('BORRADOR', 'EN_REVISION', 'CAMBIOS_SOLICITADOS', 'APROBADA', 'PENDIENTE', 'EN_ALISTAMIENTO') THEN
    RAISE EXCEPTION 'La orden % está en estado %: ya no hay nada que comprar para ella.', v_ord.numero, v_ord.estado;
  END IF;

  -- Ítems de la orden pendiente que todavía no están en ninguna solicitud viva.
  SELECT jsonb_agg(jsonb_build_object(
           'producto_id',     i.producto_id,
           'cantidad',        i.cantidad_solicitada,
           'orden_insumo_id', p_orden,
           'proveedor_id',    s.proveedor_id,
           'precio_ref',      s.precio,
           'fuente_precio',   s.fuente,
           'justificacion',   'Faltó en el despacho de ' || COALESCE(v_ord.origen_numero, 'la orden de origen')
                              || ' y quedó en la orden pendiente ' || v_ord.numero || '.'
         ))
    INTO v_items
    FROM orden_insumo_items i
    CROSS JOIN LATERAL public.compras_precio_sugerido(i.producto_id) s
   WHERE i.orden_id = p_orden
     AND i.cantidad_solicitada > 0
     AND NOT EXISTS (
       SELECT 1
         FROM solicitud_compra_items si
         JOIN solicitudes_compra sc ON sc.id = si.solicitud_id
        WHERE si.orden_insumo_id = p_orden
          AND si.producto_id = i.producto_id
          AND sc.estado <> 'ANULADA'
     );

  IF v_items IS NULL THEN
    RAISE EXCEPTION 'La orden pendiente % ya tiene solicitud de compra para todos sus productos.', v_ord.numero;
  END IF;

  v_id := public.sc_crear(
    p_items       => v_items,
    p_origen      => 'PENDIENTE_DESPACHO',
    p_sede        => v_ord.sede_id,
    -- Una sede que se quedó sin su insumo no es una compra «normal». Si además
    -- la orden venía marcada urgente, sube a URGENTE.
    p_prioridad   => CASE WHEN v_ord.urgente THEN 'URGENTE' ELSE 'ALTA' END,
    p_observacion => 'Generada desde la orden pendiente ' || v_ord.numero
                     || ' (lo que no salió en el despacho de ' || COALESCE(v_ord.origen_numero, 'su orden de origen') || ').',
    p_proveedor   => NULL,
    p_contrato    => v_ord.contrato_id
  );

  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION public.sc_generar_desde_pendiente(UUID) IS
  'Crea la solicitud de compra de una orden pendiente por falta de stock. No repite los productos que ya estén en una solicitud viva.';

GRANT EXECUTE ON FUNCTION public.sc_generar_desde_pendiente(UUID) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 10. Estado de la solicitud según lo convertido
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.sc_recalcular_estado(p_solicitud UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total     INT;
  v_completos INT;
  v_algo      INT;
  v_nuevo     TEXT;
BEGIN
  SELECT COUNT(*),
         COUNT(*) FILTER (WHERE cantidad_convertida >= cantidad),
         COUNT(*) FILTER (WHERE cantidad_convertida > 0)
    INTO v_total, v_completos, v_algo
    FROM solicitud_compra_items
   WHERE solicitud_id = p_solicitud;

  v_nuevo := CASE
    WHEN v_total = 0        THEN NULL
    WHEN v_completos = v_total THEN 'CONVERTIDA'
    WHEN v_algo > 0         THEN 'PARCIAL'
    ELSE NULL
  END;

  IF v_nuevo IS NULL THEN
    RETURN NULL;
  END IF;

  UPDATE solicitudes_compra
     SET estado = v_nuevo::estado_solicitud_compra,
         cerrada_at = CASE WHEN v_nuevo = 'CONVERTIDA' THEN NOW() ELSE cerrada_at END
   WHERE id = p_solicitud
     AND estado NOT IN ('RECHAZADA', 'ANULADA');

  RETURN v_nuevo;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 11. Conversión solicitud → orden(es) de compra, una por proveedor
-- ─────────────────────────────────────────────────────────────────────────────
-- Crear la orden es trabajo de compras, así que esto pide
-- `crear_ordenes_compra`, no `solicitar_compras`. La orden nace en BORRADOR:
-- aprobarla sigue siendo otra mano (trigger `tr_oc_aprobacion` de la fase 1).
--
-- Precio: el del comparador cuando el proveedor tiene precio vigente para ese
-- producto; si no, el precio de lista. Un producto sin proveedor NO se
-- convierte: se queda en la solicitud y se devuelve en el resultado.

CREATE OR REPLACE FUNCTION public.sc_convertir_a_oc(p_solicitud UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid       UUID := auth.uid();
  v_sol       RECORD;
  v_grupo     RECORD;
  v_linea     RECORD;
  v_oc        UUID;
  v_numero    TEXT;
  v_prefijo   TEXT := 'OC-' || to_char(CURRENT_DATE, 'YYYYMM') || '-';
  v_cons      INT;
  v_valor     NUMERIC;
  v_out       JSONB := '[]'::JSONB;
  v_sin_prov  INT := 0;
  v_ordenes   INT := 0;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Debes iniciar sesión.' USING ERRCODE = '42501';
  END IF;
  IF NOT public.auth_permiso('crear_ordenes_compra') THEN
    RAISE EXCEPTION 'Convertir una solicitud en orden de compra requiere el permiso de crear órdenes de compra.' USING ERRCODE = '42501';
  END IF;

  SELECT id, numero, estado::TEXT AS estado, observacion
    INTO v_sol
    FROM solicitudes_compra
   WHERE id = p_solicitud
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'La solicitud de compra no existe.';
  END IF;
  IF v_sol.estado IN ('CONVERTIDA', 'RECHAZADA', 'ANULADA') THEN
    RAISE EXCEPTION 'La solicitud % está en estado % y ya no se puede convertir.', v_sol.numero, v_sol.estado;
  END IF;

  -- Productos pendientes sin proveedor: se informan y se dejan quietos.
  SELECT COUNT(*)
    INTO v_sin_prov
    FROM solicitud_compra_items si
    CROSS JOIN LATERAL public.compras_precio_sugerido(si.producto_id, si.proveedor_sugerido_id) s
   WHERE si.solicitud_id = p_solicitud
     AND si.cantidad_convertida < si.cantidad
     AND s.proveedor_id IS NULL;

  FOR v_grupo IN
    SELECT s.proveedor_id,
           SUM((si.cantidad - si.cantidad_convertida) * COALESCE(s.precio, 0)) AS valor
      FROM solicitud_compra_items si
      CROSS JOIN LATERAL public.compras_precio_sugerido(si.producto_id, si.proveedor_sugerido_id) s
     WHERE si.solicitud_id = p_solicitud
       AND si.cantidad_convertida < si.cantidad
       AND s.proveedor_id IS NOT NULL
     GROUP BY s.proveedor_id
  LOOP
    v_oc := NULL;
    v_cons := public.oc_siguiente_consecutivo(v_prefijo);
    FOR i IN 1..15 LOOP
      BEGIN
        v_numero := v_prefijo || lpad(v_cons::TEXT, 3, '0');
        INSERT INTO ordenes_compra (
          numero_oc, proveedor_id, periodo, estado, valor_total, observaciones,
          creado_por, solicitud_id, bodega_destino_id
        ) VALUES (
          v_numero, v_grupo.proveedor_id, date_trunc('month', CURRENT_DATE)::DATE,
          -- El valor ya viene calculado del agrupado: insertarlo de una evita un
          -- UPDATE que dispararía un evento de EDICIÓN falso en la trazabilidad.
          'BORRADOR', v_grupo.valor,
          'Generada desde la solicitud de compra ' || v_sol.numero || '.',
          v_uid, p_solicitud, public.compras_bodega_central()
        ) RETURNING id INTO v_oc;
        EXIT;
      EXCEPTION WHEN unique_violation THEN
        v_cons := GREATEST(v_cons + 1, public.oc_siguiente_consecutivo(v_prefijo));
      END;
    END LOOP;

    IF v_oc IS NULL THEN
      RAISE EXCEPTION 'No se pudo asignar número de orden de compra, intenta de nuevo.';
    END IF;

    v_valor := v_grupo.valor;
    FOR v_linea IN
      SELECT si.id,
             si.producto_id,
             (si.cantidad - si.cantidad_convertida) AS cantidad,
             COALESCE(s.precio, 0) AS precio
        FROM solicitud_compra_items si
        CROSS JOIN LATERAL public.compras_precio_sugerido(si.producto_id, si.proveedor_sugerido_id) s
       WHERE si.solicitud_id = p_solicitud
         AND si.cantidad_convertida < si.cantidad
         AND s.proveedor_id = v_grupo.proveedor_id
    LOOP
      -- `subtotal` es GENERATED ALWAYS: no se inserta.
      INSERT INTO oc_items (oc_id, producto_id, cantidad_ped, precio_unit)
      VALUES (v_oc, v_linea.producto_id, v_linea.cantidad, v_linea.precio);

      UPDATE solicitud_compra_items
         SET cantidad_convertida = cantidad,
             oc_id = v_oc,
             proveedor_sugerido_id = COALESCE(proveedor_sugerido_id, v_grupo.proveedor_id)
       WHERE id = v_linea.id;
    END LOOP;

    v_ordenes := v_ordenes + 1;
    v_out := v_out || jsonb_build_object(
      'oc_id',     v_oc,
      'numero',    v_numero,
      'proveedor', (SELECT nombre FROM proveedores WHERE id = v_grupo.proveedor_id),
      'valor',     v_valor
    );
  END LOOP;

  IF v_ordenes = 0 THEN
    IF v_sin_prov > 0 THEN
      RAISE EXCEPTION 'Ninguno de los % producto(s) pendientes tiene proveedor (ni en el comparador ni en su ficha). Asígnales uno antes de convertir la solicitud.', v_sin_prov;
    END IF;
    RAISE EXCEPTION 'La solicitud % no tiene nada pendiente por convertir.', v_sol.numero;
  END IF;

  PERFORM public.sc_recalcular_estado(p_solicitud);

  RETURN jsonb_build_object(
    'ordenes',      v_out,
    'total',        v_ordenes,
    'sin_proveedor', v_sin_prov
  );
END;
$$;

COMMENT ON FUNCTION public.sc_convertir_a_oc(UUID) IS
  'Convierte los ítems pendientes de una solicitud en una orden de compra POR PROVEEDOR, con el precio del comparador o el de lista.';

GRANT EXECUTE ON FUNCTION public.sc_convertir_a_oc(UUID) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 12. Cambios de estado
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.sc_cambiar_estado(
  p_solicitud UUID,
  p_estado    TEXT,
  p_motivo    TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_sol RECORD;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Debes iniciar sesión.' USING ERRCODE = '42501';
  END IF;

  SELECT id, numero, estado::TEXT AS estado, solicitado_por
    INTO v_sol
    FROM solicitudes_compra WHERE id = p_solicitud FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'La solicitud de compra no existe.';
  END IF;

  -- Enviar y anular es de quien solicita; rechazar es de compras.
  IF p_estado = 'RECHAZADA' THEN
    IF NOT public.auth_permiso('crear_ordenes_compra') THEN
      RAISE EXCEPTION 'Rechazar una solicitud requiere el permiso de crear órdenes de compra.' USING ERRCODE = '42501';
    END IF;
  ELSIF NOT public.auth_permiso('solicitar_compras') THEN
    RAISE EXCEPTION 'No tienes permiso para cambiar el estado de una solicitud de compra.' USING ERRCODE = '42501';
  END IF;

  IF p_estado = 'ENVIADA' AND v_sol.estado <> 'BORRADOR' THEN
    RAISE EXCEPTION 'Solo se puede enviar una solicitud en borrador (la % está en %).', v_sol.numero, v_sol.estado;
  END IF;
  IF p_estado IN ('RECHAZADA', 'ANULADA') AND v_sol.estado IN ('CONVERTIDA', 'RECHAZADA', 'ANULADA') THEN
    RAISE EXCEPTION 'La solicitud % está en estado % y ya no admite cambios.', v_sol.numero, v_sol.estado;
  END IF;
  IF p_estado NOT IN ('ENVIADA', 'RECHAZADA', 'ANULADA') THEN
    RAISE EXCEPTION 'Estado no admitido: %.', p_estado;
  END IF;
  IF p_estado IN ('RECHAZADA', 'ANULADA') AND NULLIF(TRIM(COALESCE(p_motivo, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Escribe el motivo.';
  END IF;

  UPDATE solicitudes_compra
     SET estado = p_estado::estado_solicitud_compra,
         motivo_cierre = COALESCE(NULLIF(TRIM(COALESCE(p_motivo, '')), ''), motivo_cierre),
         enviada_at = CASE WHEN p_estado = 'ENVIADA' THEN NOW() ELSE enviada_at END,
         cerrada_at = CASE WHEN p_estado IN ('RECHAZADA', 'ANULADA') THEN NOW() ELSE cerrada_at END
   WHERE id = p_solicitud;
END;
$$;

COMMENT ON FUNCTION public.sc_cambiar_estado(UUID, TEXT, TEXT) IS
  'Enviar, rechazar o anular una solicitud de compra. Rechazar es de compras; enviar y anular, de quien solicita.';

GRANT EXECUTE ON FUNCTION public.sc_cambiar_estado(UUID, TEXT, TEXT) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 13. RLS
-- ─────────────────────────────────────────────────────────────────────────────
-- Las dos tablas nacen cerradas por permiso. **No tienen política de escritura
-- a propósito**: la única vía son las funciones `sc_*`, que son SECURITY
-- DEFINER y validan el permiso. Es el mismo criterio de las tablas de entrega
-- de la fase 1.

ALTER TABLE solicitudes_compra     ENABLE ROW LEVEL SECURITY;
ALTER TABLE solicitud_compra_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sc_read ON solicitudes_compra;
CREATE POLICY sc_read ON solicitudes_compra FOR SELECT TO authenticated
  USING (public.auth_permiso_any('{solicitar_compras,ver_ordenes_compra,crear_ordenes_compra}'::TEXT[]));

DROP POLICY IF EXISTS sc_items_read ON solicitud_compra_items;
CREATE POLICY sc_items_read ON solicitud_compra_items FOR SELECT TO authenticated
  USING (public.auth_permiso_any('{solicitar_compras,ver_ordenes_compra,crear_ordenes_compra}'::TEXT[]));

-- =============================================================================
-- FIN
-- =============================================================================

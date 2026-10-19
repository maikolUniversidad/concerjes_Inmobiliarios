-- =============================================================================
-- BODEGAS INTERNAS: producción, reembasado y maquinaria
-- =============================================================================
-- Cierra la última pregunta abierta de la decisión 7.3 del módulo de compras
-- (docs/modulo-compras.md). El usuario confirmó el 2026-10-19 que producción,
-- reembasado y maquinaria son sitios físicos distintos de la Central.
--
-- Qué NO cambia: las compras siguen entrando a la Central y el stock sigue
-- siendo uno solo por producto. Esto no reparte inventario por bodega; registra
-- los sitios que ya existían en la vida real y solo aparecían como texto suelto
-- en las observaciones de los movimientos («INGRESA DESDE PRODUCCION», «DE LA
-- BODEGA DE MAQUINARIA», «LO QUE SE REEMBASO»).
--
-- Por qué importa: la fase 1 agregó `movimientos.origen` para distinguir una
-- compra a proveedor de lo que vuelve de producción o del reembasado. Hasta
-- ahora ese origen no tenía a qué sitio apuntar. Ahora sí.
--
-- Dos columnas nuevas en `bodegas`:
--   despacha_a_sedes   si de ahí salen órdenes de insumo hacia las sedes.
--                      Solo la Central. Sin esto, `/ordenes-insumo/nuevo`
--                      ofrecería despachar «desde Producción», que no pasa.
--   origen_movimiento  qué origen de entrada representa esta bodega. Es el
--                      puente entre los dos conceptos.
--
-- No se crean ubicaciones dentro de las bodegas nuevas: las crea quien conozca
-- cada sitio, desde /bodegas. Tampoco se toca `movimientos.ubicacion_id` del
-- histórico: esa columna dice dónde QUEDÓ la mercancía (la Central), no de
-- dónde vino, y eso ya lo dice `origen`.
--
-- IDEMPOTENTE.
-- =============================================================================

SET search_path TO public;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Para qué sirve cada bodega
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE bodegas
  ADD COLUMN IF NOT EXISTS despacha_a_sedes BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE bodegas
  ADD COLUMN IF NOT EXISTS origen_movimiento origen_movimiento;

COMMENT ON COLUMN bodegas.despacha_a_sedes IS
  'Si de esta bodega salen órdenes de insumo hacia las sedes. Hoy solo la Central: las internas (producción, reembasado, maquinaria) no despachan.';

COMMENT ON COLUMN bodegas.origen_movimiento IS
  'Qué origen de entrada representa esta bodega, para relacionar movimientos.origen con el sitio físico sin tener que reconocer el código a mano.';

-- La Central es la que despacha y la que recibe las compras.
UPDATE bodegas SET despacha_a_sedes = TRUE WHERE codigo = 'CENTRAL';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Las tres bodegas internas
-- ─────────────────────────────────────────────────────────────────────────────
-- Se insertan por código y solo si no existen, para poder re-aplicar la
-- migración sin pisar lo que alguien haya editado después desde /bodegas.

INSERT INTO bodegas (nombre, codigo, descripcion, despacha_a_sedes, origen_movimiento, activo)
SELECT 'Producción', 'PRODUCCION',
       'Área de producción propia. Lo que sale de aquí entra a la Central como ENTRADA con origen PRODUCCION; no es una compra a proveedor.',
       FALSE, 'PRODUCCION', TRUE
 WHERE NOT EXISTS (SELECT 1 FROM bodegas WHERE codigo = 'PRODUCCION');

INSERT INTO bodegas (nombre, codigo, descripcion, despacha_a_sedes, origen_movimiento, activo)
SELECT 'Reembasado', 'REEMBASADO',
       'Donde se reenvasa a presentaciones más pequeñas. Lo que sale entra a la Central con origen REEMBASADO. El consumo del producto de origen ya lo registra ejecutar_reembasado().',
       FALSE, 'REEMBASADO', TRUE
 WHERE NOT EXISTS (SELECT 1 FROM bodegas WHERE codigo = 'REEMBASADO');

INSERT INTO bodegas (nombre, codigo, descripcion, despacha_a_sedes, origen_movimiento, activo)
SELECT 'Maquinaria', 'MAQUINARIA',
       'Bodega de máquinas y sus repuestos. Lo que pasa de aquí a la Central entra con origen TRASLADO_INTERNO.',
       FALSE, 'TRASLADO_INTERNO', TRUE
 WHERE NOT EXISTS (SELECT 1 FROM bodegas WHERE codigo = 'MAQUINARIA');

-- Si ya existían con otro valor (o se re-aplica la migración), las tres
-- internas quedan marcadas como que no despachan. Las demás no se tocan.
UPDATE bodegas
   SET despacha_a_sedes = FALSE
 WHERE codigo IN ('PRODUCCION', 'REEMBASADO', 'MAQUINARIA')
   AND despacha_a_sedes IS DISTINCT FROM FALSE;

-- Un origen de entrada lo representa UNA sola bodega. Sin esto, dos bodegas
-- con el mismo origen hacen que `v_entradas_por_origen` cuente cada entrada
-- una vez por bodega: con dos sitios marcados PRODUCCION, 22 entradas reales
-- se reportaban como 44.
CREATE UNIQUE INDEX IF NOT EXISTS uq_bodegas_origen_movimiento
    ON bodegas (origen_movimiento)
 WHERE origen_movimiento IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. La bodega que recibe las compras sigue siendo la Central
-- ─────────────────────────────────────────────────────────────────────────────
-- Antes bastaba con el código porque había una sola bodega. Ahora hay cuatro,
-- así que el respaldo deja de ser «la más antigua» y pasa a ser «la más antigua
-- que despacha»: una bodega interna nunca debe quedar como destino de compra.

CREATE OR REPLACE FUNCTION public.compras_bodega_central()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM bodegas
   -- El filtro, no el orden, es lo que garantiza que una bodega interna nunca
   -- quede como destino de una compra: ordenando, bastaba con que no hubiera
   -- ninguna que despachara para que cayera en Producción. Si no hay ninguna,
   -- devuelve NULL y la orden queda sin destino (la columna lo admite), que es
   -- un problema visible en vez de stock entrando al sitio equivocado.
   WHERE activo AND despacha_a_sedes
   -- `NULLS LAST` no es decoración: el campo `codigo` es nullable y el
   -- formulario de /bodegas no lo exige, así que una bodega guardada sin
   -- código deja `(codigo = 'CENTRAL')` en NULL. Con el NULLS FIRST que
   -- Postgres aplica por defecto en DESC, esa bodega ganaba sobre la Central
   -- y se volvía el destino de TODAS las compras, sin aviso.
   ORDER BY (codigo = 'CENTRAL') DESC NULLS LAST, created_at
   LIMIT 1
$$;

COMMENT ON FUNCTION public.compras_bodega_central() IS
  'Bodega de destino por defecto de las compras: la activa de codigo CENTRAL; si no hay, la mas antigua que despacha a sedes. Nunca una interna: si ninguna despacha, devuelve NULL.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. De dónde viene lo que entra, por sitio
-- ─────────────────────────────────────────────────────────────────────────────
-- Usa `origen_movimiento` para no repetir los códigos en el código de la app.
-- Las entradas sin origen son las que la pantalla sigue pidiendo clasificar.

CREATE OR REPLACE VIEW v_entradas_por_origen WITH (security_invoker = true) AS
SELECT
  TO_CHAR(m.created_at, 'YYYY-MM')          AS mes,
  COALESCE(m.origen::text, 'SIN_CLASIFICAR') AS origen,
  b.nombre                                   AS bodega,
  COUNT(*)                                   AS entradas,
  SUM(m.cantidad)                            AS unidades
FROM movimientos m
LEFT JOIN bodegas b
       ON b.origen_movimiento = m.origen
      AND b.activo
WHERE m.tipo = 'ENTRADA'
GROUP BY 1, 2, 3
ORDER BY 1 DESC, 4 DESC;

COMMENT ON VIEW v_entradas_por_origen IS
  'Entradas al inventario por mes y origen, con el sitio físico cuando hay una bodega que lo representa. Las compras no tienen bodega de origen: vienen de un proveedor.';

GRANT SELECT ON v_entradas_por_origen TO authenticated;

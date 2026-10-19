-- Fusión de proveedores duplicados por nombre.
--
-- El problema medido el 2026-10-19: la tabla tenía 32 proveedores activos para
-- solo 12 nombres distintos. Cada proveedor real estaba repetido hasta cuatro
-- veces porque tres cargas masivas lo volvieron a insertar (29-jun 04:57,
-- 14-jul 21:24 y 14-jul 22:22), y en cada grupo solo UNO quedó con los datos.
-- En /comparador-precios la lista mostraba cuatro entradas idénticas y quien
-- asignaba un precio escogía al azar, así que el precio terminaba colgado de un
-- registro que nadie consulta y compras_precio_sugerido() podía armar la orden
-- contra un duplicado vacío.
--
-- Qué hace: elige el registro bueno de cada grupo, repunta hacia él las SIETE
-- columnas que referencian proveedores.id, y DESACTIVA (no borra) los
-- duplicados. Al final deja un índice único por nombre normalizado sobre los
-- activos para que ninguna carga masiva los vuelva a crear.
--
-- Es idempotente: en la segunda corrida ya no hay grupos con más de un activo,
-- así que no toca nada.

BEGIN;

-- ── 1. El registro bueno de cada grupo ────────────────────────────────────────
-- Criterio: el que tiene más referencias; a igualdad, el más antiguo (y el id
-- como último desempate para que el resultado sea determinista).
DROP TABLE IF EXISTS _prov_fusion;
CREATE TEMP TABLE _prov_fusion ON COMMIT DROP AS
WITH activos AS (
  SELECT pr.id,
         upper(btrim(pr.nombre)) AS clave,
         pr.created_at,
           (SELECT COUNT(*) FROM precios_proveedor      x WHERE x.proveedor_id          = pr.id)
         + (SELECT COUNT(*) FROM productos              x WHERE x.proveedor_id          = pr.id)
         + (SELECT COUNT(*) FROM productos              x WHERE x.proveedor2_id         = pr.id)
         + (SELECT COUNT(*) FROM ordenes_compra         x WHERE x.proveedor_id          = pr.id)
         + (SELECT COUNT(*) FROM aprovisionamiento      x WHERE x.proveedor_sug_id      = pr.id)
         + (SELECT COUNT(*) FROM solicitudes_compra     x WHERE x.proveedor_sugerido_id = pr.id)
         + (SELECT COUNT(*) FROM solicitud_compra_items x WHERE x.proveedor_sugerido_id = pr.id)
           AS referencias
    FROM proveedores pr
   WHERE pr.activo
), con_bueno AS (
  SELECT a.*,
         first_value(a.id) OVER (
           PARTITION BY a.clave
           ORDER BY a.referencias DESC, a.created_at ASC NULLS LAST, a.id
         ) AS bueno
    FROM activos a
)
SELECT id AS duplicado, bueno, clave
  FROM con_bueno
 WHERE id <> bueno;   -- solo las filas que hay que fusionar

-- ── 2. precios_proveedor: resolver las colisiones ANTES de repuntar ───────────
-- La tabla tiene UNIQUE (producto_id, proveedor_id). Si un producto tiene precio
-- tanto en el duplicado como en el bueno, repuntar reventaría la restricción.
-- Gana el vigente y, entre vigentes, el más reciente por fecha_cotiz (el id como
-- desempate estable, para que dos corridas den lo mismo). Los perdedores se
-- borran: repuntarlos no se puede, y dejarlos colgando de un inactivo los
-- escondería sin quitarlos del comparador.
WITH candidatos AS (
  -- el precio del bueno y los de sus duplicados, compitiendo por producto
  SELECT pp.id, pp.producto_id, pp.fecha_cotiz, pp.vigente,
         COALESCE(f.bueno, pp.proveedor_id) AS proveedor_destino
    FROM precios_proveedor pp
    LEFT JOIN _prov_fusion f ON f.duplicado = pp.proveedor_id
   WHERE pp.proveedor_id IN (SELECT duplicado FROM _prov_fusion)
      OR pp.proveedor_id IN (SELECT bueno     FROM _prov_fusion)
), ganador AS (
  SELECT DISTINCT ON (producto_id, proveedor_destino) id
    FROM candidatos
   ORDER BY producto_id, proveedor_destino,
            COALESCE(vigente, true) DESC, fecha_cotiz DESC NULLS LAST, id
)
DELETE FROM precios_proveedor
 WHERE id IN (SELECT id FROM candidatos)
   AND id NOT IN (SELECT id FROM ganador);

-- ── 3. Repuntar las siete columnas que referencian proveedores.id ─────────────
UPDATE precios_proveedor      x SET proveedor_id          = f.bueno FROM _prov_fusion f WHERE x.proveedor_id          = f.duplicado;
UPDATE productos              x SET proveedor_id          = f.bueno FROM _prov_fusion f WHERE x.proveedor_id          = f.duplicado;
UPDATE productos              x SET proveedor2_id         = f.bueno FROM _prov_fusion f WHERE x.proveedor2_id         = f.duplicado;
UPDATE ordenes_compra         x SET proveedor_id          = f.bueno FROM _prov_fusion f WHERE x.proveedor_id          = f.duplicado;
UPDATE aprovisionamiento      x SET proveedor_sug_id      = f.bueno FROM _prov_fusion f WHERE x.proveedor_sug_id      = f.duplicado;
UPDATE solicitudes_compra     x SET proveedor_sugerido_id = f.bueno FROM _prov_fusion f WHERE x.proveedor_sugerido_id = f.duplicado;
UPDATE solicitud_compra_items x SET proveedor_sugerido_id = f.bueno FROM _prov_fusion f WHERE x.proveedor_sugerido_id = f.duplicado;

-- Un producto no puede tener al mismo proveedor como principal y como segundo:
-- si la fusión los dejó iguales, el segundo sobra.
UPDATE productos SET proveedor2_id = NULL
 WHERE proveedor2_id IS NOT NULL AND proveedor2_id = proveedor_id;

-- ── 4. Heredar al bueno los datos que solo tenían los duplicados ────────────
-- Hoy los duplicados nacieron vacíos, pero si alguno trae contacto o teléfono se
-- rescata en vez de perderlo: campo por campo, el primer valor no nulo del
-- duplicado más antiguo que lo tenga.
UPDATE proveedores b
   SET contacto = COALESCE(b.contacto, d.contacto),
       telefono = COALESCE(b.telefono, d.telefono),
       email    = COALESCE(b.email,    d.email),
       logo_url = COALESCE(b.logo_url, d.logo_url),
       es_principal = COALESCE(b.es_principal, false) OR d.es_principal,
       updated_at = now()
  FROM (
    SELECT f.bueno,
           (array_agg(p.contacto ORDER BY p.created_at NULLS LAST, p.id) FILTER (WHERE p.contacto IS NOT NULL))[1] AS contacto,
           (array_agg(p.telefono ORDER BY p.created_at NULLS LAST, p.id) FILTER (WHERE p.telefono IS NOT NULL))[1] AS telefono,
           (array_agg(p.email    ORDER BY p.created_at NULLS LAST, p.id) FILTER (WHERE p.email    IS NOT NULL))[1] AS email,
           (array_agg(p.logo_url ORDER BY p.created_at NULLS LAST, p.id) FILTER (WHERE p.logo_url IS NOT NULL))[1] AS logo_url,
           bool_or(COALESCE(p.es_principal, false)) AS es_principal
      FROM _prov_fusion f
      JOIN proveedores p ON p.id = f.duplicado
     GROUP BY f.bueno
  ) d
 WHERE b.id = d.bueno;

-- El NIT va aparte porque proveedores_nit_key es UNIQUE sobre TODA la tabla,
-- activos e inactivos: hay que moverlo, no copiarlo, o la migración falla.
DROP TABLE IF EXISTS _prov_nit;
CREATE TEMP TABLE _prov_nit ON COMMIT DROP AS
SELECT DISTINCT ON (f.bueno) f.bueno, p.id AS desde, p.nit
  FROM _prov_fusion f
  JOIN proveedores p ON p.id = f.duplicado
  JOIN proveedores b ON b.id = f.bueno
 WHERE p.nit IS NOT NULL AND b.nit IS NULL
 ORDER BY f.bueno, p.created_at NULLS LAST, p.id;

UPDATE proveedores SET nit = NULL
 WHERE id IN (SELECT desde FROM _prov_nit);

UPDATE proveedores b SET nit = n.nit, updated_at = now()
  FROM _prov_nit n WHERE b.id = n.bueno;

-- ── 5. Desactivar los duplicados (no se borran: conservan su rastro) ─────────
UPDATE proveedores
   SET activo = false, updated_at = now()
 WHERE id IN (SELECT duplicado FROM _prov_fusion);

-- ── 6. Que no vuelva a pasar ─────────────────────────────────────────────────
-- Único por nombre normalizado, solo entre los activos: un proveedor retirado
-- puede quedarse con el nombre, y volver a crearlo con el mismo nombre falla.
CREATE UNIQUE INDEX IF NOT EXISTS proveedores_nombre_activo_key
    ON proveedores (upper(btrim(nombre)))
 WHERE activo;

COMMIT;

-- ════════════════════════════════════════════════════════════════════════════
-- Inventarios físicos: historial de conteos para comparar en el tiempo
--
-- Hasta ahora cada cruce de inventario físico (Excel ITEM | NOMBRE | PRESENTACION
-- | CANTIDADES) pisaba el stock y la etiqueta de `productos` y no quedaba foto
-- del conteo anterior. Desde aquí cada conteo queda guardado:
--
--   inventarios_fisicos        → una fila por periodo (ej. "SEPTIEMBRE 2026")
--   inventario_fisico_items    → la foto de ese conteo, producto por producto:
--       CONTADO       apareció en el archivo con cantidad
--       SIN_CANTIDAD  apareció en el archivo con la celda vacía (stock intacto)
--       NO_HALLADO    producto activo del catálogo que no vino en el archivo
--     con `stock_sistema` = lo que decía el sistema justo antes de aplicar,
--     y `precio_unitario` para valorizar faltantes y sobrantes.
--
--   aplicar_inventario_fisico() → hace el cruce completo en una transacción
--     (la usan el script de consola y la pantalla /inventario-fisico):
--       · producto existente (por codigo = ITEM) → stock = contado, activo,
--         AJUSTE en movimientos si cambia; nombre/presentación solo se
--         completan si estaban vacíos.
--       · ITEM sin producto → producto nuevo (OTROS, C, activo) + stock.
--       · producto que no vino → se conserva intacto y se etiqueta
--         inventario_encontrado = false (política desde AGOSTO 2025).
-- Idempotente.
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.inventarios_fisicos (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  periodo            VARCHAR(50) NOT NULL UNIQUE,
  fecha_corte        DATE NOT NULL,
  archivo_nombre     TEXT,
  observacion        TEXT,
  -- true = foto cargada después (no movió el stock al registrarse)
  historico          BOOLEAN NOT NULL DEFAULT false,
  total_items        INT NOT NULL DEFAULT 0,
  items_con_cantidad INT NOT NULL DEFAULT 0,
  items_en_cero      INT NOT NULL DEFAULT 0,
  total_unidades     DECIMAL(16,2) NOT NULL DEFAULT 0,
  items_nuevos       INT NOT NULL DEFAULT 0,
  items_ajustados    INT NOT NULL DEFAULT 0,
  items_no_hallados  INT NOT NULL DEFAULT 0,
  aplicado_por       UUID REFERENCES public.usuarios(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inventarios_fisicos_fecha ON public.inventarios_fisicos (fecha_corte DESC);

CREATE TABLE IF NOT EXISTS public.inventario_fisico_items (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inventario_id    UUID NOT NULL REFERENCES public.inventarios_fisicos(id) ON DELETE CASCADE,
  producto_id      UUID REFERENCES public.productos(id) ON DELETE SET NULL,
  codigo           INT,
  nombre           TEXT NOT NULL,
  presentacion     TEXT,
  estado           VARCHAR(12) NOT NULL CHECK (estado IN ('CONTADO', 'SIN_CANTIDAD', 'NO_HALLADO')),
  cantidad_contada DECIMAL(14,2),
  stock_sistema    DECIMAL(14,2),
  diferencia       DECIMAL(14,2) GENERATED ALWAYS AS (cantidad_contada - stock_sistema) STORED,
  precio_unitario  DECIMAL(16,2),
  producto_nuevo   BOOLEAN NOT NULL DEFAULT false,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (inventario_id, producto_id)
);

CREATE INDEX IF NOT EXISTS idx_inv_fisico_items_inventario ON public.inventario_fisico_items (inventario_id, estado);
CREATE INDEX IF NOT EXISTS idx_inv_fisico_items_producto   ON public.inventario_fisico_items (producto_id);

COMMENT ON TABLE public.inventarios_fisicos IS 'Cada conteo físico cruzado contra el catálogo (uno por periodo).';
COMMENT ON TABLE public.inventario_fisico_items IS 'Foto de un conteo físico: cantidad contada vs stock del sistema en ese momento.';

-- ── RLS: lectura por permiso; la escritura va solo por la función ───────────
ALTER TABLE public.inventarios_fisicos     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventario_fisico_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS inventarios_fisicos_select ON public.inventarios_fisicos;
CREATE POLICY inventarios_fisicos_select ON public.inventarios_fisicos FOR SELECT TO authenticated
  USING (public.auth_permiso_any('{ver_inventario_fisico,cargar_inventario_fisico}'::text[]));

DROP POLICY IF EXISTS inventario_fisico_items_select ON public.inventario_fisico_items;
CREATE POLICY inventario_fisico_items_select ON public.inventario_fisico_items FOR SELECT TO authenticated
  USING (public.auth_permiso_any('{ver_inventario_fisico,cargar_inventario_fisico}'::text[]));

-- ── Permisos: se otorgan a quien ya ve / hace arqueos ───────────────────────
UPDATE public.roles SET permisos = COALESCE(permisos, '{}'::jsonb) || '{"ver_inventario_fisico": true}'::jsonb
 WHERE (permisos->>'ver_arqueo')::boolean IS TRUE AND permisos->'ver_inventario_fisico' IS NULL;
UPDATE public.roles SET permisos = COALESCE(permisos, '{}'::jsonb) || '{"cargar_inventario_fisico": true}'::jsonb
 WHERE (permisos->>'realizar_arqueo')::boolean IS TRUE AND (permisos->>'ajustar_stock')::boolean IS TRUE
   AND permisos->'cargar_inventario_fisico' IS NULL;

-- ── Cruce completo de un conteo ─────────────────────────────────────────────
-- p_items: [{ "codigo": 1, "nombre": "...", "presentacion": "...", "cantidad": 10 | null }, ...]
-- p_usuario solo se usa cuando no hay sesión (script de consola con la
-- conexión directa); con sesión siempre manda auth.uid().
CREATE OR REPLACE FUNCTION public.aplicar_inventario_fisico(
  p_periodo     TEXT,
  p_fecha_corte DATE,
  p_archivo     TEXT,
  p_items       JSONB,
  p_observacion TEXT DEFAULT NULL,
  p_usuario     UUID DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user    UUID := COALESCE(auth.uid(), p_usuario);
  v_periodo TEXT := upper(regexp_replace(trim(COALESCE(p_periodo, '')), '\s+', ' ', 'g'));
  v_inv     UUID;
  v_obs     TEXT;
  r         RECORD;
  v_prod    RECORD;
  v_id      UUID;
  v_stock   DECIMAL(14,2);
  v_nuevo   BOOLEAN;
  v_vistos  UUID[] := '{}';
  v_nuevos  INT := 0;
  v_ajust   INT := 0;
  v_nohall  INT := 0;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.auth_permiso('cargar_inventario_fisico') THEN
    RAISE EXCEPTION 'No tienes permiso para cargar inventarios físicos';
  END IF;
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Falta el usuario que aplica el inventario';
  END IF;
  IF v_periodo = '' OR p_fecha_corte IS NULL THEN
    RAISE EXCEPTION 'Indica el periodo y la fecha de corte';
  END IF;
  IF jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'El archivo no trae productos';
  END IF;
  IF EXISTS (SELECT 1 FROM inventarios_fisicos WHERE periodo = v_periodo) THEN
    RAISE EXCEPTION 'Ya existe un inventario del periodo %', v_periodo;
  END IF;
  IF EXISTS (SELECT (x->>'codigo')::int FROM jsonb_array_elements(p_items) x
              GROUP BY 1 HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'El archivo trae ITEM repetidos: %', (
      SELECT string_agg(c::text, ', ') FROM (
        SELECT (x->>'codigo')::int c FROM jsonb_array_elements(p_items) x GROUP BY 1 HAVING count(*) > 1) d);
  END IF;

  v_obs := 'Inventario físico ' || v_periodo;

  INSERT INTO inventarios_fisicos (periodo, fecha_corte, archivo_nombre, observacion, aplicado_por)
  VALUES (v_periodo, p_fecha_corte, p_archivo, p_observacion, v_user)
  RETURNING id INTO v_inv;

  FOR r IN
    SELECT (x->>'codigo')::int AS codigo,
           NULLIF(trim(x->>'nombre'), '')       AS nombre,
           NULLIF(trim(x->>'presentacion'), '') AS presentacion,
           CASE WHEN x->>'cantidad' IS NULL OR trim(x->>'cantidad') = '' THEN NULL
                ELSE (x->>'cantidad')::numeric END AS cantidad
      FROM jsonb_array_elements(p_items) x
  LOOP
    IF r.codigo IS NULL OR r.nombre IS NULL THEN
      RAISE EXCEPTION 'Fila sin ITEM o sin nombre en el archivo';
    END IF;

    SELECT p.id, p.nombre_estandar, p.presentacion, p.precio_lista, COALESCE(s.cantidad_real, 0) AS stock
      INTO v_prod
      FROM productos p LEFT JOIN stock s ON s.producto_id = p.id
     WHERE p.codigo = r.codigo
     ORDER BY p.activo DESC, p.created_at
     LIMIT 1;

    v_nuevo := v_prod.id IS NULL;
    IF v_nuevo THEN
      INSERT INTO productos (codigo, nombre_estandar, presentacion, tipo_insumo, cat_rotacion, activo)
      VALUES (r.codigo, r.nombre, r.presentacion, 'OTROS', 'C', true)
      RETURNING id INTO v_id;
      v_stock := 0;
      v_nuevos := v_nuevos + 1;
    ELSE
      v_id := v_prod.id;
      v_stock := v_prod.stock;
      -- Lo curado en la BD manda: solo se completan campos vacíos
      UPDATE productos
         SET activo          = true,
             nombre_estandar = COALESCE(NULLIF(nombre_estandar, ''), r.nombre),
             presentacion    = COALESCE(NULLIF(presentacion, ''), r.presentacion),
             updated_at      = NOW()
       WHERE id = v_id;
    END IF;

    INSERT INTO inventario_fisico_items
      (inventario_id, producto_id, codigo, nombre, presentacion, estado,
       cantidad_contada, stock_sistema, precio_unitario, producto_nuevo)
    VALUES
      (v_inv, v_id, r.codigo,
       COALESCE(v_prod.nombre_estandar, r.nombre), COALESCE(v_prod.presentacion, r.presentacion),
       CASE WHEN r.cantidad IS NULL THEN 'SIN_CANTIDAD' ELSE 'CONTADO' END,
       r.cantidad, v_stock, v_prod.precio_lista, v_nuevo);

    IF r.cantidad IS NOT NULL THEN
      INSERT INTO stock (producto_id, cantidad_real, cantidad_disp)
      VALUES (v_id, r.cantidad, r.cantidad)
      ON CONFLICT (producto_id) DO UPDATE
        SET cantidad_real = EXCLUDED.cantidad_real,
            cantidad_disp = EXCLUDED.cantidad_disp,
            updated_at    = NOW();
      IF r.cantidad <> v_stock THEN
        -- Mismo criterio que el cierre de arqueo: el AJUSTE registra lo contado
        INSERT INTO movimientos (tipo, producto_id, cantidad, observacion, usuario_id, ia_origen)
        VALUES ('AJUSTE', v_id, r.cantidad, v_obs, v_user, false);
        v_ajust := v_ajust + 1;
      END IF;
    END IF;

    UPDATE productos
       SET inventario_periodo = v_periodo, inventario_encontrado = true, inventario_fecha = NOW()
     WHERE id = v_id;
    v_vistos := v_vistos || v_id;
  END LOOP;

  -- Activos del catálogo que no vinieron: quedan en la foto como NO_HALLADO
  INSERT INTO inventario_fisico_items
    (inventario_id, producto_id, codigo, nombre, presentacion, estado, stock_sistema, precio_unitario)
  SELECT v_inv, p.id, p.codigo, p.nombre_estandar, p.presentacion, 'NO_HALLADO',
         COALESCE(s.cantidad_real, 0), p.precio_lista
    FROM productos p LEFT JOIN stock s ON s.producto_id = p.id
   WHERE p.activo AND NOT (p.id = ANY (v_vistos));
  GET DIAGNOSTICS v_nohall = ROW_COUNT;

  -- Y todos los que no vinieron (activos o no) se etiquetan, sin tocar nada más
  UPDATE productos
     SET inventario_periodo = v_periodo, inventario_encontrado = false, inventario_fecha = NOW()
   WHERE NOT (id = ANY (v_vistos));

  UPDATE inventarios_fisicos f SET
    total_items        = t.total,
    items_con_cantidad = t.con_cant,
    items_en_cero      = t.en_cero,
    total_unidades     = t.unidades,
    items_nuevos       = v_nuevos,
    items_ajustados    = v_ajust,
    items_no_hallados  = v_nohall
  FROM (
    SELECT count(*) FILTER (WHERE estado <> 'NO_HALLADO')                 AS total,
           count(*) FILTER (WHERE estado = 'CONTADO')                     AS con_cant,
           count(*) FILTER (WHERE estado = 'CONTADO' AND cantidad_contada = 0) AS en_cero,
           COALESCE(sum(cantidad_contada), 0)                             AS unidades
      FROM inventario_fisico_items WHERE inventario_id = v_inv
  ) t
  WHERE f.id = v_inv;

  RETURN v_inv;
END;
$$;

REVOKE ALL ON FUNCTION public.aplicar_inventario_fisico(TEXT, DATE, TEXT, JSONB, TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.aplicar_inventario_fisico(TEXT, DATE, TEXT, JSONB, TEXT, UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';

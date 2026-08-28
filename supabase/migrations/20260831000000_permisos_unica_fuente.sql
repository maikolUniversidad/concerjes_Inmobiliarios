-- =============================================================================
-- /roles COMO ÚNICA FUENTE DE VERDAD
-- =============================================================================
-- La migración 20260828000000 abrió las políticas al permiso PERO conservó la
-- lista de roles enum heredada como alternativa:
--
--     USING ( auth_rol() = ANY (ARRAY['SUPER_ADMIN','ADMIN','SUPERVISOR']) OR
--             auth_permiso_any('{gestionar_personas}') )
--
-- Eso arregla el falso negativo (dar un permiso y que la BD lo rechace) pero
-- deja el falso positivo: QUITAR un permiso en /roles no lo quita, porque el
-- enum lo sigue concediendo. Auditando rol por rol aparecieron 61 accesos así
-- —p. ej. «Supervisor de Conserjería» editaba personas y parametrización de
-- sede sin tener esos permisos marcados—.
--
-- Esta migración:
--   1) Siembra en cada rol los permisos que hoy ejerce vía enum, para que nadie
--      pierda un acceso que ya usaba (se excluyen los que ampliarían de más).
--   2) Elimina la lista enum de TODAS las políticas. A partir de aquí lo que
--      marques en /roles es exactamente lo que puede hacer el usuario.
--
-- El acceso total de SUPER_ADMIN y ADMIN NO se pierde: vive dentro de
-- auth_permiso()/auth_permiso_any(), no en las listas de las políticas.
--
-- IDEMPOTENTE.
-- =============================================================================

SET search_path TO public;

-- ── 1) `presentaciones` también es cosa de compras ───────────────────────────
-- La lista enum incluía COORDINADOR_COMPRAS, pero el permiso mapeado era
-- editar_productos/editar_configuracion, que ese rol no tiene. Se agrega
-- editar_proveedores (el permiso de compras) en vez de darle editar_productos,
-- que le abriría todo el CRUD del catálogo.
DROP POLICY IF EXISTS pres_write ON public.presentaciones;
CREATE POLICY pres_write ON public.presentaciones
  FOR ALL TO authenticated
  USING (public.auth_permiso_any(ARRAY['editar_productos', 'editar_configuracion', 'editar_proveedores']))
  WITH CHECK (public.auth_permiso_any(ARRAY['editar_productos', 'editar_configuracion', 'editar_proveedores']));

-- ── 2) Sembrar lo que cada rol ya ejercía por su enum ───────────────────────
-- Solo se agregan permisos: ningún rol pierde nada en este paso.
UPDATE public.roles SET permisos = permisos || '{
  "editar_aprovisionamiento": true,
  "gestionar_contratos_conserjeria": true,
  "gestionar_documentos_rrhh": true,
  "gestionar_empresas_usuarias": true,
  "gestionar_parametrizacion": true,
  "gestionar_personas": true,
  "gestionar_postulaciones": true,
  "gestionar_reembasado": true,
  "gestionar_tipos_documentales": true,
  "ver_postulaciones": true
}'::jsonb WHERE nombre = 'Supervisor de Conserjería';

UPDATE public.roles SET permisos = permisos || '{
  "editar_aprovisionamiento": true,
  "gestionar_postulaciones": true,
  "gestionar_reembasado": true,
  "gestionar_tipos_documentales": true,
  "ver_postulaciones": true
}'::jsonb WHERE nombre = 'Coordinador';

UPDATE public.roles SET permisos = permisos || '{
  "editar_aprovisionamiento": true,
  "gestionar_reembasado": true,
  "ver_servicios_hogar": true
}'::jsonb WHERE nombre IN ('Conserje', 'Operador de Sede');

-- Compras NO recibe editar_productos (lo ejercía solo para `presentaciones`,
-- resuelto arriba con editar_proveedores).
UPDATE public.roles SET permisos = permisos || '{
  "crear_movimientos": true,
  "gestionar_reembasado": true
}'::jsonb WHERE nombre = 'Coordinador de Compras';

-- ── 3) Quitar la lista de roles enum de todas las políticas ─────────────────
-- Se reemplaza cada `auth_rol() = ANY (ARRAY[...])` por `false` conservando el
-- resto de la expresión (las condiciones por fila, tipo `cliente_id = auth.uid()`,
-- se mantienen intactas).
DO $migracion$
DECLARE
  p        RECORD;
  q        TEXT;
  wc       TEXT;
  stmt     TEXT;
  destinos TEXT;
  n        INT := 0;
BEGIN
  FOR p IN
    SELECT * FROM pg_policies
    WHERE schemaname = 'public'
      AND (COALESCE(qual, '') || COALESCE(with_check, '')) LIKE '%auth_rol()%'
    ORDER BY tablename, policyname
  LOOP
    q  := regexp_replace(p.qual,       '\(?auth_rol\(\) = ANY \(ARRAY\[[^\]]*\]\)\)?', 'false', 'g');
    wc := regexp_replace(p.with_check, '\(?auth_rol\(\) = ANY \(ARRAY\[[^\]]*\]\)\)?', 'false', 'g');
    q  := regexp_replace(q,  '\(?auth_rol\(\) = ''[A-Z_]+''::rol_usuario\)?', 'false', 'g');
    wc := regexp_replace(wc, '\(?auth_rol\(\) = ''[A-Z_]+''::rol_usuario\)?', 'false', 'g');

    -- Si tras quitar el enum la política quedaría en `false` puro nadie podría
    -- escribir: significa que no tiene permiso equivalente. Se deja como está y
    -- se avisa, en vez de romper el módulo en silencio.
    IF (q IS NOT NULL AND btrim(q) = 'false') OR (wc IS NOT NULL AND btrim(wc) = 'false') THEN
      RAISE WARNING 'Política sin permiso equivalente, se deja intacta: %.%', p.tablename, p.policyname;
      CONTINUE;
    END IF;

    destinos := (SELECT string_agg(quote_ident(x), ', ') FROM unnest(p.roles) AS x);
    stmt := format('CREATE POLICY %I ON public.%I AS %s FOR %s TO %s',
                   p.policyname, p.tablename, p.permissive, p.cmd, destinos);
    IF q  IS NOT NULL THEN stmt := stmt || format(' USING (%s)', q);       END IF;
    IF wc IS NOT NULL THEN stmt := stmt || format(' WITH CHECK (%s)', wc); END IF;

    EXECUTE format('DROP POLICY %I ON public.%I', p.policyname, p.tablename);
    EXECUTE stmt;
    n := n + 1;
  END LOOP;

  RAISE NOTICE 'Políticas que ya no dependen del rol enum: %', n;
END
$migracion$;

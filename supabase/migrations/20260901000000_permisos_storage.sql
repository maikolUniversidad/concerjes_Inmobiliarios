-- =============================================================================
-- PERMISOS EN STORAGE
-- =============================================================================
-- Última superficie sin auditar. Los buckets aceptaban escritura de CUALQUIER
-- usuario autenticado (`bucket_id = 'x'` a secas, o `auth.role() =
-- 'authenticated'`): un Auditor o un Conductor podía subir y BORRAR documentos
-- de SST, fotos de productos, evidencias de entrega o documentos de personal.
-- Los tres buckets que sí filtraban lo hacían con la lista de roles enum, que
-- ya no es la fuente de verdad.
--
-- Se alinea cada bucket con el permiso del módulo al que pertenece. La LECTURA
-- se deja como estaba (varios buckets son públicos por diseño: fotos de
-- producto, galería, adjuntos del portal).
--
-- IDEMPOTENTE.
-- =============================================================================

SET search_path TO public;

DO $storage$
DECLARE
  -- (bucket, permisos separados por coma)
  mapa TEXT[] := ARRAY[
    'documentos-sst',       'subir_documentos',
    'galeria-fotos',        'subir_documentos',
    'productos-fotos',      'editar_productos,importar_datos',
    'gestion-humana',       'gestionar_documentos_rrhh,gestionar_personas',
    'empresas',             'gestionar_empresas_usuarias,editar_configuracion',
    'maquinaria',           'gestionar_maquinaria',
    'ordenes-insumo',       'crear_ordenes_insumo,aprobar_ordenes_insumo,alistar_ordenes_insumo,recibir_ordenes_insumo',
    'logistica-evidencia',  'gestionar_rutas,gestionar_novedades_entrega,confirmar_entrega_conductor,reportar_novedad_conductor',
    'servicios-hogar',      'gestionar_solicitudes_hogar,gestionar_tipos_servicio,gestionar_agenda_hogar'
  ];
  bucket TEXT;
  claves TEXT;
  cond   TEXT;
  slug   TEXT;
BEGIN
  FOR i IN 1..(array_length(mapa, 1) / 2) LOOP
    bucket := mapa[(i - 1) * 2 + 1];
    claves := mapa[(i - 1) * 2 + 2];
    slug   := replace(bucket, '-', '_');
    cond   := format('bucket_id = %L AND public.auth_permiso_any(%L::text[])', bucket, '{' || claves || '}');

    -- Fuera las políticas de escritura anteriores de este bucket, cualquiera
    -- que sea su nombre (los nombres varían entre migraciones).
    EXECUTE (
      SELECT COALESCE(string_agg(format('DROP POLICY %I ON storage.objects;', policyname), ' '), '')
      FROM pg_policies
      WHERE schemaname = 'storage' AND tablename = 'objects' AND cmd <> 'SELECT'
        AND COALESCE(qual, '') || COALESCE(with_check, '') LIKE '%' || bucket || '%'
    );

    EXECUTE format('CREATE POLICY %I ON storage.objects FOR INSERT TO authenticated WITH CHECK (%s)',
                   slug || '_insert_perm', cond);
    EXECUTE format('CREATE POLICY %I ON storage.objects FOR UPDATE TO authenticated USING (%s) WITH CHECK (%s)',
                   slug || '_update_perm', cond, cond);
    EXECUTE format('CREATE POLICY %I ON storage.objects FOR DELETE TO authenticated USING (%s)',
                   slug || '_delete_perm', cond);
  END LOOP;
END
$storage$;

-- ── Buckets con reglas propias (no encajan en el mapa de arriba) ────────────

-- Comprobantes de pago: el cliente sube el suyo (carpeta = su uid); el personal
-- de cobros puede borrarlos.
DROP POLICY IF EXISTS cp_staff_delete ON storage.objects;
CREATE POLICY cp_staff_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'comprobantes-pago' AND public.auth_permiso('gestionar_pagos_hogar'));

-- Registro de vacantes: el aspirante sube sus documentos (bucket público de
-- escritura por diseño); borrar solo el dueño del archivo o quien gestiona
-- postulaciones.
DROP POLICY IF EXISTS rv_delete ON storage.objects;
CREATE POLICY rv_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'registro-vacantes'
    AND (owner = (SELECT auth.uid()) OR public.auth_permiso('gestionar_postulaciones'))
  );

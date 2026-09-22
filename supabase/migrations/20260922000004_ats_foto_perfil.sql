-- =============================================================================
-- Foto de perfil del candidato (tipo carné)
--
-- La foto la toma el candidato (formulario o "Mi proceso") o RRHH en la oficina
-- desde el expediente. Sale en la hoja de vida, la actualización de datos y los
-- resultados de las pruebas; al generar un formato queda incrustada en él.
-- =============================================================================

-- 1. El candidato puede ver SU foto de perfil aunque la haya subido RRHH (el
--    archivo queda a nombre de quien lo subió). Solo esa ruta, no la carpeta.
DROP POLICY IF EXISTS rv_select ON storage.objects;
CREATE POLICY rv_select ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'registro-vacantes' AND (
      owner = (SELECT auth.uid())
      OR public.auth_permiso_any(ARRAY['ver_postulaciones', 'gestionar_postulaciones'])
      OR EXISTS (
        SELECT 1 FROM public.candidatos c
         WHERE c.auth_uid = (SELECT auth.uid())
           AND c.foto_perfil_path = storage.objects.name
      )
    )
  );

-- 2. La foto debe ser una imagen que cualquier navegador muestre (sale en los
--    formatos impresos). La plataforma la recorta a 3:4 y la guarda en JPG.
UPDATE vac_tipos_documentales
   SET nombre = 'Foto de perfil (tipo carné)',
       descripcion = 'De frente, con buena luz y fondo claro, sin gorra ni gafas oscuras. Sale en tu hoja de vida y en tus formatos.',
       formatos_permitidos = ARRAY['jpg', 'jpeg', 'png', 'webp']
 WHERE codigo = 'FOTO_CARNET';

-- =============================================================================
-- LIMPIEZA DE CLAVES DE PERMISO OBSOLETAS
-- =============================================================================
-- `usar_scanner`, `usar_ia_vision` y `ver_ia_analisis` quedaron en el JSONB de
-- los roles pero sus pantallas ya no existen (de IA solo queda el asistente, y
-- el buscador vive en la barra superior filtrado por los permisos de cada
-- destino). Salieron del catálogo de la app; aquí se quitan de los roles para
-- que /roles no muestre interruptores que no hacen nada.
--
-- IDEMPOTENTE.
-- =============================================================================

UPDATE public.roles
SET permisos = permisos - 'usar_scanner' - 'usar_ia_vision' - 'ver_ia_analisis'
WHERE permisos ?| ARRAY['usar_scanner', 'usar_ia_vision', 'ver_ia_analisis'];

UPDATE public.usuarios
SET permisos = permisos - 'usar_scanner' - 'usar_ia_vision' - 'ver_ia_analisis'
WHERE permisos ?| ARRAY['usar_scanner', 'usar_ia_vision', 'ver_ia_analisis'];

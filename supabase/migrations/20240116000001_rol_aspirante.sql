-- =============================================================================
-- Rol "Aspirante" — cuenta del candidato del Registro de Vacantes
-- =============================================================================
-- ⚠️ POR QUÉ NO SE USA "Conserje" POR DEFECTO:
-- El trigger `sync_usuario_rol` copia `roles.rol_base` a `usuarios.rol`, y
-- `auth_rol()` (el que evalúan TODAS las políticas RLS) lee esa columna.
-- "Conserje" tiene rol_base = OPERADOR_SEDE, que en las RLS puede:
--    · INSERT en `movimientos`  → altera el stock vía registrar_movimiento
--    · FOR ALL en `pedidos_sede`
--    · registrar conteos en arqueos (contar_item)
-- Un candidato del formulario público NO está contratado ni verificado: darle
-- ese rol permitiría que cualquier desconocido escribiera en el inventario.
--
-- Por eso el candidato nace como "Aspirante" (rol_base = AUDITOR, sin permisos):
-- puede entrar a ver/actualizar SU hoja de vida (la RLS del módulo lo limita a
-- su propio registro por auth_uid) y nada más. Cuando RRHH lo contrata, le
-- cambia el rol a "Conserje" desde Gestión Humana → Postulaciones.
-- =============================================================================

INSERT INTO public.roles (nombre, descripcion, rol_base, permisos, activo)
SELECT
  'Aspirante',
  'Candidato del Registro de Vacantes. Solo puede ver y actualizar su propia hoja de vida. Sin acceso operativo.',
  'AUDITOR',
  '{}'::jsonb,
  true
WHERE NOT EXISTS (SELECT 1 FROM public.roles WHERE nombre = 'Aspirante');

-- Si ya existía, garantiza que sea de mínimo privilegio.
UPDATE public.roles
   SET rol_base = 'AUDITOR', permisos = '{}'::jsonb
 WHERE nombre = 'Aspirante'
   AND (rol_base IS DISTINCT FROM 'AUDITOR' OR permisos <> '{}'::jsonb);

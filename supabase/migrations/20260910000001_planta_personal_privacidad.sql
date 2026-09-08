-- =============================================================================
-- PRIVACIDAD DE LA PLANTA DE PERSONAL
-- =============================================================================
-- Al abrir cuenta a los 863 colaboradores activos cambia quién está adentro de
-- la plataforma: hasta ahora «autenticado» eran 27 personas de confianza, y por
-- eso muchas tablas se leen con `USING (true)`. Ahora «autenticado» son casi
-- novecientas cuentas cuya contraseña inicial es la cédula.
--
-- Dos tablas no pueden seguir abiertas con ese cambio, porque tienen datos
-- personales de 6.564 personas —salario, dirección, teléfono, documentos de
-- vinculación— y la ley 1581 obliga a limitar el acceso a quien lo necesita:
--
--   · `personas`
--   · `documentos_persona`
--
-- Quedan atadas a los permisos de Gestión Humana, con una excepción: cada quien
-- ve SU propia ficha y SUS propios documentos (es lo que alimenta el carnet).
--
-- ⚠️ Quedan otras ~78 tablas con lectura abierta a cualquier autenticado
-- (movimientos, productos, órdenes de compra, precios de proveedor, ubicación
-- de conductores…). Eso viene de antes y no se toca aquí: hay que decidir de
-- frente qué ve un empleado raso. Ver docs/planta-personal.md.
--
-- IDEMPOTENTE: se puede repetir sin efecto.
-- =============================================================================

SET search_path TO public;

-- ── Las vistas deben respetar la RLS de sus tablas base ──────────────────────
-- Sin `security_invoker`, una vista corre con los privilegios de su dueño
-- (postgres) y se salta la RLS: cerrar `personas` no serviría de nada si
-- `vw_planta_personal` la sigue leyendo por la puerta de atrás.
ALTER VIEW vw_planta_personal        SET (security_invoker = on);
ALTER VIEW vw_personal_disponible    SET (security_invoker = on);
ALTER VIEW vw_personal_recontratable SET (security_invoker = on);
ALTER VIEW vw_planta_inconsistencias SET (security_invoker = on);

-- ── personas ─────────────────────────────────────────────────────────────────
-- Antes: USING (true). Ahora, quien tenga permiso de Gestión Humana o de planta.
-- El bypass de ADMIN/SUPER_ADMIN va dentro de auth_permiso_any.
DROP POLICY IF EXISTS gh_read_personas ON personas;
CREATE POLICY gh_read_personas ON personas FOR SELECT TO authenticated
  USING (public.auth_permiso_any(ARRAY[
    'ver_personas', 'gestionar_personas', 'importar_personas',
    'ver_documentos_rrhh', 'ver_planta_personal', 'gestionar_planta_personal',
    'ver_postulaciones', 'gestionar_postulaciones'
  ]));

-- La política de la ficha propia se creó con la planta; se reafirma aquí para
-- que esta migración se pueda aplicar sola.
DROP POLICY IF EXISTS gh_persona_propia ON personas;
CREATE POLICY gh_persona_propia ON personas FOR SELECT TO authenticated
  USING (usuario_id = (SELECT auth.uid()));

-- ── documentos_persona ───────────────────────────────────────────────────────
DROP POLICY IF EXISTS gh_read_docs ON documentos_persona;
CREATE POLICY gh_read_docs ON documentos_persona FOR SELECT TO authenticated
  USING (public.auth_permiso_any(ARRAY[
    'ver_documentos_rrhh', 'gestionar_documentos_rrhh',
    'ver_personas', 'gestionar_personas',
    'ver_postulaciones', 'gestionar_postulaciones'
  ]));

DROP POLICY IF EXISTS gh_docs_propios ON documentos_persona;
CREATE POLICY gh_docs_propios ON documentos_persona FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM personas p
                  WHERE p.id = persona_id AND p.usuario_id = (SELECT auth.uid())));

-- =============================================================================
-- CONECTAR PERSONAS (Gestión Humana) ↔ USUARIOS (cuentas de plataforma)
-- + ROLES DE CONSERJERÍA (Conserje, Coordinador, Gerencia, Supervisor de Conserjería)
-- =============================================================================
-- Objetivo:
--   1) Cada colaborador (persona) puede tener una cuenta de plataforma con rol.
--      La cuenta se crea desde Gestión Humana (formulario o cargue masivo).
--   2) Roles orientados a la operación de conserjería, no solo a inventario.
--      La plataforma crecerá hacia PQRS, No conformes, Contratos, Gerencia; los
--      permisos correspondientes ya quedan sembrados en cada rol (aunque las
--      pantallas se construyan después).
--
-- Nota de arquitectura: los permisos son DATOS (JSONB en `roles`) que la app
-- web, /usuarios y la app offline (Dexie) consumen igual. Sembrar bien los roles
-- deja "todo con lo mismo" sin tocar código de gating.
-- =============================================================================

-- ── 1) Enlace persona → cuenta de plataforma ─────────────────────────────────
ALTER TABLE public.personas
  ADD COLUMN IF NOT EXISTS usuario_id UUID REFERENCES public.usuarios(id) ON DELETE SET NULL;

-- Una cuenta de plataforma pertenece a lo sumo a una persona.
CREATE UNIQUE INDEX IF NOT EXISTS uidx_personas_usuario_id
  ON public.personas(usuario_id) WHERE usuario_id IS NOT NULL;

COMMENT ON COLUMN public.personas.usuario_id IS
  'Cuenta de plataforma (auth/usuarios) vinculada a este colaborador. NULL = sin acceso.';

-- Backfill: enlazar personas existentes con usuarios que compartan email.
UPDATE public.personas p
SET usuario_id = u.id
FROM public.usuarios u
WHERE p.usuario_id IS NULL
  AND p.email IS NOT NULL
  AND lower(trim(p.email)) = lower(trim(u.email))
  -- evita romper la unicidad si dos personas comparten el mismo email
  AND NOT EXISTS (SELECT 1 FROM public.personas p2 WHERE p2.usuario_id = u.id);

-- ── 2) Renombrar el Supervisor existente → orientado a conserjería ───────────
-- Idempotente y a prueba de re-ejecución: si "Supervisor de Conserjería" ya
-- existe (renombrado en una corrida previa) y perfil_roles_seed re-creó el
-- "Supervisor" base, elimina el duplicado (si nadie lo usa) en vez de renombrar.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.roles WHERE nombre = 'Supervisor de Conserjería') THEN
    DELETE FROM public.roles
    WHERE nombre = 'Supervisor'
      AND id NOT IN (SELECT rol_id FROM public.usuarios WHERE rol_id IS NOT NULL);
  ELSE
    UPDATE public.roles SET nombre = 'Supervisor de Conserjería' WHERE nombre = 'Supervisor';
  END IF;
END $$;

-- ── 3) Roles de conserjería (seed idempotente) ───────────────────────────────
-- Las claves de permisos coinciden con el catálogo de /roles (lib/permisos.ts),
-- incluidas las nuevas del grupo "Operación Conserjería".
-- Nota: se usan literales JSON (`'{...}'::jsonb`) en lugar de jsonb_build_object
-- porque Postgres limita las funciones a 100 argumentos (el rol Gerencia excede).
INSERT INTO public.roles (nombre, descripcion, permisos, activo) VALUES
  (
    'Conserje',
    'Personal en sede: consulta inventario, escanea, registra novedades y radica PQRS.',
    '{
      "ver_productos": true, "ver_stock": true, "usar_scanner": true,
      "ver_movimientos": true, "crear_movimientos": true,
      "ver_notificaciones": true,
      "ver_pqrs": true, "gestionar_pqrs": true,
      "ver_no_conformes": true, "gestionar_no_conformes": true,
      "ver_contratos_conserjeria": true,
      "usar_ia_asistente": true
    }'::jsonb,
    true
  ),
  (
    'Coordinador',
    'Coordina sedes y conserjes: personas, PQRS, no conformes, contratos y reportes.',
    '{
      "ver_productos": true, "ver_stock": true, "ver_movimientos": true, "usar_scanner": true,
      "ver_bodegas": true, "ver_arqueo": true,
      "ver_contratos": true, "ver_proveedores": true, "ver_ordenes_compra": true,
      "ver_reportes": true, "exportar_datos": true,
      "ver_personas": true, "gestionar_personas": true, "importar_personas": true,
      "ver_empresas_usuarias": true, "gestionar_empresas_usuarias": true,
      "ver_documentos_rrhh": true, "gestionar_documentos_rrhh": true,
      "ver_pqrs": true, "gestionar_pqrs": true,
      "ver_no_conformes": true, "gestionar_no_conformes": true,
      "ver_contratos_conserjeria": true, "gestionar_contratos_conserjeria": true,
      "ver_notificaciones": true, "gestionar_alertas": true,
      "ver_documentos": true, "usar_ia_asistente": true, "ver_ia_analisis": true
    }'::jsonb,
    true
  ),
  (
    'Gerencia',
    'Dirección: visibilidad total de la operación, indicadores y panel gerencial.',
    '{
      "ver_productos": true, "editar_productos": true, "ver_stock": true, "ajustar_stock": true,
      "ver_movimientos": true, "crear_movimientos": true, "usar_scanner": true,
      "ver_arqueo": true, "realizar_arqueo": true, "ver_bodegas": true, "gestionar_bodegas": true,
      "generar_codigos": true,
      "ver_aprovisionamiento": true, "editar_aprovisionamiento": true,
      "ver_contratos": true, "editar_contratos": true,
      "ver_proveedores": true, "editar_proveedores": true,
      "ver_ordenes_compra": true, "crear_ordenes_compra": true,
      "ver_reportes": true, "exportar_datos": true,
      "ver_documentos": true, "subir_documentos": true,
      "ver_usuarios": true, "gestionar_usuarios": true, "gestionar_roles": true,
      "importar_datos": true, "ver_actividad_log": true, "ver_historial": true,
      "ver_notificaciones": true, "gestionar_alertas": true,
      "ver_configuracion": true, "editar_configuracion": true,
      "ver_personas": true, "gestionar_personas": true, "importar_personas": true,
      "ver_empresas_usuarias": true, "gestionar_empresas_usuarias": true,
      "ver_documentos_rrhh": true, "gestionar_documentos_rrhh": true, "gestionar_tipos_documentales": true,
      "ver_pqrs": true, "gestionar_pqrs": true,
      "ver_no_conformes": true, "gestionar_no_conformes": true,
      "ver_contratos_conserjeria": true, "gestionar_contratos_conserjeria": true,
      "ver_panel_gerencia": true,
      "usar_ia_vision": true, "usar_ia_asistente": true, "ver_ia_analisis": true
    }'::jsonb,
    true
  )
ON CONFLICT (nombre) DO UPDATE
  SET descripcion = EXCLUDED.descripcion,
      permisos    = public.roles.permisos || EXCLUDED.permisos,  -- merge no destructivo
      updated_at  = NOW();

-- ── 4) Ampliar el Supervisor de Conserjería con permisos de conserjería ──────
UPDATE public.roles SET permisos = permisos || '{
  "ver_personas": true, "ver_empresas_usuarias": true, "ver_documentos_rrhh": true,
  "ver_pqrs": true, "gestionar_pqrs": true,
  "ver_no_conformes": true, "gestionar_no_conformes": true,
  "ver_contratos_conserjeria": true
}'::jsonb WHERE nombre = 'Supervisor de Conserjería';

-- ── 5) Mapear rol_base (enum RLS) de los roles nuevos ────────────────────────
-- Conserje → operación mínima en sede; Coordinador → supervisión; Gerencia → admin.
UPDATE public.roles SET rol_base = 'OPERADOR_SEDE' WHERE nombre = 'Conserje'   AND rol_base IS DISTINCT FROM 'OPERADOR_SEDE';
UPDATE public.roles SET rol_base = 'SUPERVISOR'    WHERE nombre = 'Coordinador' AND rol_base IS DISTINCT FROM 'SUPERVISOR';
UPDATE public.roles SET rol_base = 'ADMIN'         WHERE nombre = 'Gerencia'    AND rol_base IS DISTINCT FROM 'ADMIN';
UPDATE public.roles SET rol_base = 'SUPERVISOR'    WHERE nombre = 'Supervisor de Conserjería' AND rol_base IS NULL;

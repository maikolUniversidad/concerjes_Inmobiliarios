-- =============================================================================
-- PERMISOS DINÁMICOS EN RLS
-- =============================================================================
-- Problema que resuelve: la app decide qué puede hacer un usuario con el JSONB
-- `roles.permisos` (+ overrides en `usuarios.permisos`), configurable desde
-- /roles. Pero las políticas RLS seguían decidiendo con el enum `usuarios.rol`
-- quemado en listas (`auth_rol() IN ('SUPER_ADMIN','ADMIN')`). Resultado: podías
-- marcar "Crear / editar productos" al rol Bodeguero y la base de datos igual
-- rechazaba la escritura ("row-level security"), porque el enum BODEGUERO no
-- estaba en la lista de `write_productos`.
--
-- Solución: `auth_permiso()` / `auth_permiso_any()` leen los permisos efectivos
-- (rol + overrides) y se agregan como alternativa a cada política. El cambio es
-- ADITIVO: quien ya podía escribir por su rol enum sigue pudiendo; ahora además
-- puede quien tenga el permiso otorgado en /roles.
--
-- Excepciones (ver bloque final): `roles`, `stock_cce` y `producto_fotos` tenían
-- políticas mal escritas y se reemplazan por completo.
--
-- Idempotente: las políticas ya migradas contienen `auth_permiso` y se omiten.
-- =============================================================================

SET search_path TO public;

-- ── 1) Helpers de permiso efectivo ───────────────────────────────────────────
-- Misma semántica que `lib/permisos-server.ts`:
--   · SUPER_ADMIN y ADMIN tienen acceso completo implícito.
--   · El override individual (`usuarios.permisos`) gana sobre el del rol,
--     incluso cuando lo pone en `false`.
CREATE OR REPLACE FUNCTION public.auth_permiso(p_key TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((
    SELECT u.rol IN ('SUPER_ADMIN', 'ADMIN')
        OR COALESCE(u.permisos ->> p_key, r.permisos ->> p_key) = 'true'
    FROM public.usuarios u
    LEFT JOIN public.roles r ON r.id = u.rol_id
    WHERE u.id = (SELECT auth.uid())
  ), false)
$$;

COMMENT ON FUNCTION public.auth_permiso(TEXT) IS
  'TRUE si el usuario autenticado tiene el permiso indicado (rol + overrides), o es SUPER_ADMIN/ADMIN.';

CREATE OR REPLACE FUNCTION public.auth_permiso_any(p_keys TEXT[])
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((
    SELECT u.rol IN ('SUPER_ADMIN', 'ADMIN')
        OR EXISTS (
             SELECT 1 FROM unnest(p_keys) AS k
             WHERE COALESCE(u.permisos ->> k, r.permisos ->> k) = 'true'
           )
    FROM public.usuarios u
    LEFT JOIN public.roles r ON r.id = u.rol_id
    WHERE u.id = (SELECT auth.uid())
  ), false)
$$;

COMMENT ON FUNCTION public.auth_permiso_any(TEXT[]) IS
  'TRUE si el usuario autenticado tiene AL MENOS UNO de los permisos indicados.';

GRANT EXECUTE ON FUNCTION public.auth_permiso(TEXT)       TO authenticated;
GRANT EXECUTE ON FUNCTION public.auth_permiso_any(TEXT[]) TO authenticated;

-- ── 2) Abrir las políticas existentes al permiso equivalente ─────────────────
-- Cada tripleta es (tabla, política, claves de permiso separadas por coma).
-- Se reescribe la política conservando su expresión original y agregando
-- `OR auth_permiso_any(...)`, sin tocar `cmd`, `roles` ni `permissive`.
DO $migracion$
DECLARE
  mapa TEXT[] := ARRAY[
    -- Inventario ------------------------------------------------------------
    'productos',                    'write_productos',              'editar_productos',
    'stock',                        'write_stock',                  'ajustar_stock',
    'movimientos',                  'write_movimientos',            'crear_movimientos',
    'proveedores',                  'write_proveedores',            'editar_proveedores',
    'precios_proveedor',            'write_precios',                'editar_proveedores',
    'presentaciones',               'pres_write',                   'editar_productos,editar_configuracion',
    'empresas_emisoras',            'ee_write',                     'editar_configuracion',
    'bodegas',                      'write_bodegas',                'gestionar_bodegas',
    'bodega_pisos',                 'write_bodega_pisos',           'gestionar_bodegas',
    'ubicaciones',                  'write_ubicaciones',            'gestionar_bodegas',
    'maquinaria',                   'maq_write',                    'gestionar_maquinaria',
    'maquinaria_eventos',           'maq_ev_write',                 'gestionar_maquinaria',
    'reembasados',                  'reembasados_write',            'gestionar_reembasado',
    'reembasado_items',             'reembasado_items_write',       'gestionar_reembasado',
    'reembasado_ejecuciones',       'reembasado_ejec_write',        'gestionar_reembasado',
    -- Compras y aprovisionamiento -------------------------------------------
    'rotacion',                     'write_rotacion',               'editar_aprovisionamiento',
    'aprovisionamiento',            'write_aprov',                  'editar_aprovisionamiento',
    'pedidos_sede',                 'write_pedidos',                'editar_aprovisionamiento',
    'ordenes_compra',               'write_oc',                     'crear_ordenes_compra',
    'oc_items',                     'write_oc_items',               'crear_ordenes_compra',
    'oc_eventos',                   'oc_eventos_write',             'crear_ordenes_compra',
    -- Contratos, sedes y parametrización ------------------------------------
    'sedes',                        'write_sedes',                  'editar_contratos',
    'grupos_contrato',              'write_grupos',                 'editar_contratos',
    'etiquetas',                    'etiquetas_write',              'editar_contratos',
    'etiqueta_categorias',          'etiqueta_categorias_write',    'editar_contratos',
    'grupo_etiquetas',              'grupo_etiquetas_write',        'editar_contratos',
    'sede_etiquetas',               'sede_etiquetas_write',         'editar_contratos',
    'sede_productos',               'sp_write',                     'gestionar_parametrizacion',
    'contratos',                    'contratos_staff',              'gestionar_contratos_conserjeria',
    -- Órdenes de insumo ------------------------------------------------------
    'ordenes_insumo',               'oi_write',                     'crear_ordenes_insumo,aprobar_ordenes_insumo,alistar_ordenes_insumo,recibir_ordenes_insumo',
    'orden_insumo_items',           'oi_items_write',               'crear_ordenes_insumo,aprobar_ordenes_insumo,alistar_ordenes_insumo,recibir_ordenes_insumo',
    'orden_insumo_responsables',    'oi_resp_write',                'crear_ordenes_insumo,aprobar_ordenes_insumo,alistar_ordenes_insumo',
    'orden_insumo_devoluciones',    'oi_dev_write',                 'alistar_ordenes_insumo,aprobar_ordenes_insumo',
    'orden_insumo_devolucion_items','oi_dev_items_write',           'alistar_ordenes_insumo,aprobar_ordenes_insumo',
    -- Administración ---------------------------------------------------------
    'usuarios',                     'admin_write_usuarios',         'gestionar_usuarios',
    'usuarios',                     'self_read_usuarios',           'ver_usuarios',
    'reglas_alerta',                'admin_write_reglas',           'gestionar_alertas',
    'integraciones_correo',         'admin_all_integr_correo',      'gestionar_integraciones',
    'correo_saliente',              'admin_correo_saliente',        'gestionar_integraciones',
    'contactos_web',                'admin_read_contactos',         'ver_configuracion',
    'contactos_web',                'admin_update_contactos',       'editar_configuracion',
    'actividad_log',                'admin_read_log',               'ver_actividad_log',
    -- Gestión humana ---------------------------------------------------------
    'personas',                     'gh_write_personas',            'gestionar_personas',
    'documentos_persona',           'gh_write_docs',                'gestionar_documentos_rrhh',
    'empresas_usuarias',            'gh_write_empresas',            'gestionar_empresas_usuarias',
    'tipos_documentales',           'gh_write_tipos',               'gestionar_tipos_documentales',
    'tipos_documentales_refs',      'gh_write_tiporefs',            'gestionar_tipos_documentales',
    'afp',                          'afp_write',                    'gestionar_personas',
    'arl',                          'arl_write',                    'gestionar_personas',
    'eps',                          'eps_write',                    'gestionar_personas',
    'cajas_compensacion',           'cajas_compensacion_write',     'gestionar_personas',
    'cesantias',                    'cesantias_write',              'gestionar_personas',
    'bancos',                       'bancos_write',                 'gestionar_personas',
    'cargos',                       'cargos_write',                 'gestionar_personas',
    'departamentos',                'departamentos_write',          'gestionar_personas',
    'municipios',                   'municipios_write',             'gestionar_personas',
    'obras',                        'obras_write',                  'gestionar_personas',
    'parametros_legales',           'parametros_legales_write',     'gestionar_personas',
    -- Registro de vacantes / postulaciones -----------------------------------
    'vacantes',                     'vacantes_write',               'gestionar_postulaciones',
    'vac_tipos_documentales',       'vac_tipos_documentales_write', 'gestionar_postulaciones',
    'vac_auditoria',                'auditoria_staff',              'ver_postulaciones',
    'candidatos',                   'candidatos_owner_sel',         'ver_postulaciones',
    'candidatos',                   'candidatos_owner_upd',         'gestionar_postulaciones',
    'candidatos',                   'candidatos_staff_del',         'gestionar_postulaciones',
    'candidato_direcciones',        'candidato_direcciones_owner',  'gestionar_postulaciones',
    'candidato_documentos',         'candidato_documentos_owner',   'gestionar_postulaciones',
    'beneficiarios',                'beneficiarios_owner',          'gestionar_postulaciones',
    'consentimientos',              'consentimientos_owner',        'gestionar_postulaciones',
    'postulaciones',                'postulaciones_owner',          'gestionar_postulaciones',
    'registros_faciales',           'faciales_staff',               'gestionar_postulaciones',
    'intentos_identificacion',      'intentos_staff',               'gestionar_postulaciones',
    -- Logística y conductores -------------------------------------------------
    'conductores',                  'cond_write',                   'gestionar_conductores',
    'rutas_entrega',                'rutas_write',                  'gestionar_rutas',
    'ruta_paradas',                 'paradas_write',                'gestionar_rutas,confirmar_entrega_conductor',
    'confirmaciones_entrega',       'conf_write',                   'gestionar_rutas,confirmar_entrega_conductor',
    'novedades_entrega',            'novedades_write',              'gestionar_novedades_entrega,reportar_novedad_conductor',
    'sede_horario_entrega',         'horarios_write',               'gestionar_horarios_entrega',
    'conductor_ubicacion_actual',   'gps_act_write',                'actualizar_gps_conductor',
    'conductor_ubicacion_historial','gps_hist_insert',              'actualizar_gps_conductor',
    -- Servicios del hogar y portal de clientes --------------------------------
    'tipos_servicio_hogar',         'tipos_sh_write',               'gestionar_tipos_servicio',
    'tarifas_servicio_hogar',       'tarifas_sh_write',             'gestionar_precios_servicio',
    'solicitudes_servicio_hogar',   'ssh_auth_read',                'ver_servicios_hogar',
    'solicitudes_servicio_hogar',   'ssh_auth_write',               'gestionar_solicitudes_hogar',
    'agenda_servicio_hogar',        'agenda_sh_read',               'ver_servicios_hogar',
    'agenda_servicio_hogar',        'agenda_sh_write',              'gestionar_agenda_hogar',
    'concerjes_hogar',              'concerjes_staff_all',          'gestionar_agenda_hogar',
    'concerje_servicio_hogar',      'csh_staff_all',                'gestionar_agenda_hogar',
    'galeria_servicio_hogar',       'galeria_staff_all',            'gestionar_solicitudes_hogar',
    'resenas_servicio_hogar',       'resenas_staff_all',            'gestionar_solicitudes_hogar',
    'clientes',                     'clientes_staff_read',          'ver_servicios_hogar',
    'direcciones_cliente',          'dir_staff_read',               'ver_servicios_hogar',
    'calificaciones_cliente',       'calif_cliente_staff',          'gestionar_solicitudes_hogar',
    'notificaciones_cliente',       'notif_cliente_staff',          'gestionar_solicitudes_hogar',
    'cobros_servicio_hogar',        'cobros_staff_all',             'gestionar_pagos_hogar',
    'cobro_items_hogar',            'cobro_items_staff',            'gestionar_pagos_hogar',
    'pagos_hogar',                  'pagos_staff_all',              'gestionar_pagos_hogar',
    'metodos_pago_hogar',           'metodos_pago_read',            'gestionar_pagos_hogar',
    'metodos_pago_hogar',           'metodos_pago_write',           'parametrizar_pagos_hogar',
    'parametros_pago_hogar',        'param_pago_write',             'parametrizar_pagos_hogar'
  ];
  tabla    TEXT;
  pol      TEXT;
  claves   TEXT;
  p        RECORD;
  cond     TEXT;
  stmt     TEXT;
  destinos TEXT;
  migradas INT := 0;
  omitidas INT := 0;
BEGIN
  FOR i IN 1..(array_length(mapa, 1) / 3) LOOP
    tabla  := mapa[(i - 1) * 3 + 1];
    pol    := mapa[(i - 1) * 3 + 2];
    claves := mapa[(i - 1) * 3 + 3];

    SELECT * INTO p
    FROM pg_policies
    WHERE schemaname = 'public' AND tablename = tabla AND policyname = pol;

    IF NOT FOUND THEN
      omitidas := omitidas + 1;
      CONTINUE;  -- la tabla/política no existe en este entorno
    END IF;

    IF COALESCE(p.qual, '') LIKE '%auth_permiso%'
       OR COALESCE(p.with_check, '') LIKE '%auth_permiso%' THEN
      omitidas := omitidas + 1;
      CONTINUE;  -- ya migrada
    END IF;

    cond     := format('public.auth_permiso_any(%L::text[])', '{' || claves || '}');
    destinos := (SELECT string_agg(quote_ident(x), ', ') FROM unnest(p.roles) AS x);

    stmt := format(
      'CREATE POLICY %I ON public.%I AS %s FOR %s TO %s',
      pol, tabla, p.permissive, p.cmd, destinos
    );
    IF p.qual IS NOT NULL THEN
      stmt := stmt || format(' USING ((%s) OR %s)', p.qual, cond);
    END IF;
    IF p.with_check IS NOT NULL THEN
      stmt := stmt || format(' WITH CHECK ((%s) OR %s)', p.with_check, cond);
    END IF;

    EXECUTE format('DROP POLICY %I ON public.%I', pol, tabla);
    EXECUTE stmt;
    migradas := migradas + 1;
  END LOOP;

  RAISE NOTICE 'Políticas migradas a permisos dinámicos: % (omitidas: %)', migradas, omitidas;
END
$migracion$;

-- ── 3) Políticas que estaban mal escritas: se reemplazan completas ───────────

-- 3.a) `roles`: tenía `FOR ALL TO authenticated USING (true) WITH CHECK (true)`,
--      es decir CUALQUIER usuario autenticado podía crear/editar/borrar roles y
--      auto-asignarse permisos. La lectura sí debe ser abierta (la app resuelve
--      los permisos del rol propio en cada request); la escritura exige
--      `gestionar_roles`.
DROP POLICY IF EXISTS roles_all_authenticated    ON public.roles;
DROP POLICY IF EXISTS roles_select_authenticated ON public.roles;
DROP POLICY IF EXISTS roles_read                 ON public.roles;
DROP POLICY IF EXISTS roles_write                ON public.roles;

CREATE POLICY roles_read ON public.roles
  FOR SELECT TO authenticated USING (true);

CREATE POLICY roles_write ON public.roles
  FOR ALL TO authenticated
  USING (public.auth_permiso('gestionar_roles'))
  WITH CHECK (public.auth_permiso('gestionar_roles'));

-- 3.b) `stock_cce`: la política comparaba `auth.jwt() ->> 'role'` contra
--      'admin'/'superadmin', pero ese claim siempre vale 'authenticated' en
--      Supabase → la condición nunca se cumplía y la tabla era de solo lectura
--      para todo el mundo (incl. admins). Se alinea con los permisos de stock.
DROP POLICY IF EXISTS stock_cce_write ON public.stock_cce;
CREATE POLICY stock_cce_write ON public.stock_cce
  FOR ALL TO authenticated
  USING (public.auth_permiso_any(ARRAY['ajustar_stock', 'editar_productos']))
  WITH CHECK (public.auth_permiso_any(ARRAY['ajustar_stock', 'editar_productos']));

-- 3.c) `producto_fotos`: escritura totalmente abierta (`USING (true)`).
--      Se limita a quien pueda editar productos o hacer cargas masivas.
DROP POLICY IF EXISTS fotos_insert ON public.producto_fotos;
DROP POLICY IF EXISTS fotos_update ON public.producto_fotos;
DROP POLICY IF EXISTS fotos_delete ON public.producto_fotos;

CREATE POLICY fotos_insert ON public.producto_fotos
  FOR INSERT TO authenticated
  WITH CHECK (public.auth_permiso_any(ARRAY['editar_productos', 'importar_datos']));

CREATE POLICY fotos_update ON public.producto_fotos
  FOR UPDATE TO authenticated
  USING (public.auth_permiso_any(ARRAY['editar_productos', 'importar_datos']))
  WITH CHECK (public.auth_permiso_any(ARRAY['editar_productos', 'importar_datos']));

CREATE POLICY fotos_delete ON public.producto_fotos
  FOR DELETE TO authenticated
  USING (public.auth_permiso_any(ARRAY['editar_productos', 'importar_datos']));

-- ── 4) Claves de permiso que existían en la BD pero no en el catálogo ────────
-- `gestionar_pagos_hogar` y `parametrizar_pagos_hogar` se sembraron en los roles
-- pero nunca se agregaron a `lib/permisos.ts`, así que no se podían activar ni
-- desactivar desde /roles. El catálogo ya las incluye; aquí solo se garantiza
-- que los roles administrativos las tengan.
UPDATE public.roles
SET permisos = permisos || jsonb_build_object('gestionar_pagos_hogar', true, 'parametrizar_pagos_hogar', true)
WHERE rol_base IN ('SUPER_ADMIN', 'ADMIN');

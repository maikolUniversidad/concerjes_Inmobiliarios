-- =============================================================================
-- FIX de seguridad — Registro de Vacantes: RLS de acceso de personal
-- =============================================================================
-- El trigger `handle_new_user` crea una fila `usuarios` con rol='AUDITOR' para
-- TODO auth.users nuevo, incluidas las SESIONES ANÓNIMAS de los candidatos.
-- Por eso `public.auth_rol()` NO es NULL para un candidato anónimo (es 'AUDITOR'),
-- y las políticas que usaban `auth_rol() IS NOT NULL` como sinónimo de "personal
-- interno" habrían permitido que un candidato anónimo leyera datos de OTROS
-- candidatos. Se reemplaza por la lista explícita de roles de personal.
-- =============================================================================

-- ── Candidatos: lectura del dueño o del personal (roles explícitos) ──────────
DROP POLICY IF EXISTS candidatos_owner_sel ON candidatos;
CREATE POLICY candidatos_owner_sel ON candidatos FOR SELECT TO authenticated
  USING (
    auth_uid = (SELECT auth.uid())
    OR public.auth_rol() IN ('SUPER_ADMIN','ADMIN','SUPERVISOR')
  );

-- ── Tablas hijas: dueño (por candidato) o personal ───────────────────────────
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'candidato_direcciones','beneficiarios','consentimientos','candidato_documentos','postulaciones'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I_owner ON %I', t, t);
    EXECUTE format($f$CREATE POLICY %I_owner ON %I FOR ALL TO authenticated
      USING (EXISTS (SELECT 1 FROM candidatos c WHERE c.id = %I.candidato_id
                     AND (c.auth_uid = (SELECT auth.uid())
                          OR public.auth_rol() IN ('SUPER_ADMIN','ADMIN','SUPERVISOR'))))
      WITH CHECK (EXISTS (SELECT 1 FROM candidatos c WHERE c.id = %I.candidato_id
                     AND (c.auth_uid = (SELECT auth.uid())
                          OR public.auth_rol() IN ('SUPER_ADMIN','ADMIN','SUPERVISOR'))))$f$,
      t, t, t, t);
  END LOOP;
END $$;

-- ── Storage: el candidato ve lo suyo (owner) o el personal (roles) ───────────
DROP POLICY IF EXISTS "rv_select" ON storage.objects;
CREATE POLICY "rv_select" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'registro-vacantes'
         AND (owner = (SELECT auth.uid())
              OR public.auth_rol() IN ('SUPER_ADMIN','ADMIN','SUPERVISOR')));

-- =============================================================================
-- FIX crítico — handle_new_user tolerante a SESIONES ANÓNIMAS
-- =============================================================================
-- `usuarios.email` y `usuarios.nombre` son NOT NULL (email además UNIQUE), pero
-- las SESIONES ANÓNIMAS de Supabase crean un auth.users con email = NULL. La
-- versión anterior del trigger insertaba NEW.email (NULL) → violaba NOT NULL →
-- el trigger AFTER INSERT fallaba → el INSERT en auth.users se revertía →
-- `signInAnonymously()` fallaba. Resultado: TODO el flujo público de Registro
-- de Vacantes (que se apoya en sesión anónima) no podía ni arrancar.
--
-- Se hace el trigger robusto: si no hay email/nombre (caso anónimo), usa
-- valores por defecto únicos y válidos. La cuenta queda con rol AUDITOR
-- (mínimo privilegio); al finalizar el registro, /api/registro/crear-cuenta
-- fija el correo/nombre reales (convierte la sesión en permanente).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.usuarios (id, nombre, email, rol)
  VALUES (
    NEW.id,
    COALESCE(
      NULLIF(NEW.raw_user_meta_data->>'nombre', ''),
      NULLIF(split_part(COALESCE(NEW.email, ''), '@', 1), ''),
      'Aspirante'
    ),
    COALESCE(NULLIF(NEW.email, ''), NEW.id::text || '@anon.local'),
    'AUDITOR'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END $$;

-- =============================================================================
-- FIX: el alta en auth.users no debe romperse por el perfil en public.usuarios
-- =============================================================================
-- Problema: handle_new_user() insertaba el perfil con `ON CONFLICT (id) DO NOTHING`,
-- que sólo cubre la PK. Si ya existía OTRA fila en public.usuarios con el mismo
-- email (restricción `usuarios_email_key UNIQUE(email)`), el INSERT lanzaba
-- unique_violation dentro del trigger AFTER INSERT sobre auth.users → se revertía
-- el alta del usuario y GoTrue respondía 500 con cuerpo vacío, que la app mostraba
-- como el error ininteligible "{}".
--
-- Solución: capturar la excepción. El perfil es secundario: si no se puede crear,
-- se registra un WARNING pero jamás se bloquea la creación de la cuenta.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
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
  EXCEPTION
    WHEN unique_violation THEN
      -- Ya hay un perfil con ese correo (p. ej. huérfano de un registro fallido).
      RAISE WARNING 'handle_new_user: perfil duplicado para % (%)', NEW.email, SQLERRM;
    WHEN OTHERS THEN
      RAISE WARNING 'handle_new_user: no se pudo crear el perfil de % (%)', NEW.id, SQLERRM;
  END;
  RETURN NEW;
END $function$;

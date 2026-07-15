import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// Cliente de navegador para el flujo público de Registro de Vacantes.
// Usa SESIÓN ANÓNIMA persistida (localStorage): así el candidato puede cerrar
// la pestaña / quedarse sin batería y REANUDAR su registro; y la RLS lo deja
// ver/editar SOLO su propio candidato (candidatos.auth_uid = auth.uid()).
let _client: SupabaseClient | null = null

export function getSupabase(): SupabaseClient {
  if (_client) return _client
  _client = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        storageKey: 'ci-registro-vacantes',
      },
    }
  )
  return _client
}

/** Garantiza una sesión anónima activa y devuelve el uid. */
export async function ensureAnonSession(): Promise<string> {
  const sb = getSupabase()
  const { data: s } = await sb.auth.getSession()
  if (s.session?.user) return s.session.user.id
  const { data, error } = await sb.auth.signInAnonymously()
  if (error || !data.user) {
    // Mensajes accionables: el 422 de /auth/v1/signup casi siempre es uno de estos
    // dos ajustes del proyecto Supabase (no es un problema de código).
    const detalle = `${error?.message ?? ''} ${(error as { code?: string } | null)?.code ?? ''}`
    if (/anonymous/i.test(detalle)) {
      throw new Error(
        'El registro anónimo está deshabilitado en Supabase. Actívalo en: Authentication → Sign In / Providers → Anonymous Sign-Ins.'
      )
    }
    if (/signup|not allowed/i.test(detalle)) {
      throw new Error(
        'Los registros nuevos están deshabilitados en Supabase. Activa "Allow new users to sign up" en: Authentication → Sign In / Providers.'
      )
    }
    throw new Error(
      error?.message
        ? `No se pudo iniciar la sesión: ${error.message}`
        : 'No se pudo iniciar la sesión. Verifica que el registro anónimo esté habilitado en Supabase.'
    )
  }
  return data.user.id
}

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// Cliente de navegador para el PANEL DE GESTIÓN (personal admin/supervisor) de
// Servicios del Hogar. Sesión propia, separada del portal de clientes.
let _client: SupabaseClient | null = null

export function getGestionSupabase(): SupabaseClient {
  if (_client) return _client
  _client = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        storageKey: 'ci-gestion-hogar',
      },
    }
  )
  return _client
}

export async function tokenGestion(): Promise<string | null> {
  const { data } = await getGestionSupabase().auth.getSession()
  return data.session?.access_token ?? null
}

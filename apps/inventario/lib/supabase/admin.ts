import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// Cliente de SERVICE ROLE — SOLO en el servidor (API routes). Bypassa RLS.
// Nunca importar desde componentes de cliente.
let _admin: SupabaseClient | null = null

export function getAdmin(): SupabaseClient {
  if (_admin) return _admin
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!key) throw new Error('Falta SUPABASE_SERVICE_ROLE_KEY')
  _admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  return _admin
}

/** Verifica el JWT anónimo del solicitante y devuelve su uid (o null). */
export async function uidDesdeToken(authHeader: string | null): Promise<string | null> {
  if (!authHeader?.startsWith('Bearer ')) return null
  const token = authHeader.slice(7)
  if (!token) return null
  const { data, error } = await getAdmin().auth.getUser(token)
  if (error || !data.user) return null
  return data.user.id
}

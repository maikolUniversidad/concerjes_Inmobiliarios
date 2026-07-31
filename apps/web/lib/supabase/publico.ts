import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// Cliente Supabase de SÓLO LECTURA pública (sin sesión). Se usa para mostrar
// datos con RLS pública (galería activa, reseñas aprobadas, tipos/tarifas) en
// las páginas de marketing, sin crear ni persistir ninguna sesión.
let _pub: SupabaseClient | null = null

export function getPublico(): SupabaseClient {
  if (_pub) return _pub
  _pub = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  )
  return _pub
}

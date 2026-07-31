import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// =============================================================================
// Cliente de navegador para el PORTAL DE CLIENTES (Servicios del Hogar).
// Sesión permanente propia (storageKey distinto al del registro de vacantes) y
// detectSessionInUrl=true para resolver el redirect de OAuth (Google/Apple) en
// la página de callback.
// =============================================================================
let _client: SupabaseClient | null = null

export function getPortalSupabase(): SupabaseClient {
  if (_client) return _client
  _client = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storageKey: 'ci-portal-clientes',
      },
    }
  )
  return _client
}

export type ProveedorOAuth = 'google' | 'apple'

function origen(): string {
  if (typeof window !== 'undefined') return window.location.origin
  return process.env.NEXT_PUBLIC_WEB_URL || process.env.NEXT_PUBLIC_APP_URL || ''
}

/** Inicia el flujo OAuth; Supabase redirige a /portal/auth/callback. */
export async function ingresarConOAuth(provider: ProveedorOAuth) {
  const sb = getPortalSupabase()
  return sb.auth.signInWithOAuth({
    provider,
    options: {
      redirectTo: `${origen()}/portal/auth/callback`,
      queryParams: provider === 'google' ? { access_type: 'offline', prompt: 'consent' } : undefined,
    },
  })
}

/** Devuelve el token de acceso actual (para llamar a las API routes del portal). */
export async function tokenActual(): Promise<string | null> {
  const { data } = await getPortalSupabase().auth.getSession()
  return data.session?.access_token ?? null
}

/**
 * Registra/actualiza el perfil de cliente en la BD tras iniciar sesión.
 * Idempotente: crea la fila en `clientes` si no existe. Llamar tras cada login.
 */
export async function asegurarCliente(extra?: { nombre?: string; telefono?: string }) {
  const token = await tokenActual()
  if (!token) return
  try {
    await fetch('/api/portal/registrar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(extra ?? {}),
    })
  } catch {
    // silencioso: el perfil se puede completar luego desde /portal/perfil
  }
}

export async function cerrarSesionPortal() {
  await getPortalSupabase().auth.signOut()
}

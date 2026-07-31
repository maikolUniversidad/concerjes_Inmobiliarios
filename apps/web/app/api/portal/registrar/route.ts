import { NextRequest, NextResponse } from 'next/server'
import { getAdmin, uidDesdeToken } from '@/lib/supabase/admin'

// Crea/actualiza el perfil de cliente (tabla `clientes`) para el usuario
// autenticado. Idempotente. Se llama tras cada inicio de sesión del portal.
export async function POST(req: NextRequest) {
  try {
    const uid = await uidDesdeToken(req.headers.get('authorization'))
    if (!uid) return NextResponse.json({ error: 'No autenticado.' }, { status: 401 })

    const body = await req.json().catch(() => ({}))
    const sb = getAdmin() as any

    // Datos del auth.user (email, metadata del proveedor OAuth).
    const { data: userData } = await sb.auth.admin.getUserById(uid)
    const u = userData?.user
    const meta = u?.user_metadata ?? {}
    const providers: string[] = u?.app_metadata?.providers ?? (u?.app_metadata?.provider ? [u.app_metadata.provider] : [])
    const proveedor = providers.includes('google') ? 'google'
      : providers.includes('apple') ? 'apple'
      : providers.includes('phone') || u?.phone ? 'phone'
      : 'email'

    const nombre = (body.nombre || meta.nombre || meta.full_name || meta.name || (u?.email ? u.email.split('@')[0] : null) || 'Cliente').toString().slice(0, 200)
    const email = u?.email ?? meta.email ?? null
    const telefono = (body.telefono || meta.phone || u?.phone || null)?.toString().slice(0, 30) ?? null
    const foto_url = meta.avatar_url || meta.picture || null

    // ¿Ya existe? — para no pisar datos que el cliente ya editó.
    const { data: existente } = await sb.from('clientes').select('id, nombre, telefono').eq('id', uid).maybeSingle()

    const payload: Record<string, unknown> = {
      id: uid,
      email,
      proveedor,
      foto_url,
      updated_at: new Date().toISOString(),
    }
    if (!existente?.nombre || existente.nombre === 'Cliente') payload.nombre = nombre
    if (!existente?.telefono && telefono) payload.telefono = telefono

    const { error } = await sb.from('clientes').upsert(payload, { onConflict: 'id' })
    if (error) {
      console.error('[portal/registrar]', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    return NextResponse.json({ ok: true })
  } catch (e: unknown) {
    console.error('[portal/registrar] unexpected:', e)
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Error interno.' }, { status: 500 })
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { getAdmin, uidDesdeToken } from '@/lib/supabase/admin'

const ROLES_GESTION = ['SUPER_ADMIN', 'ADMIN', 'SUPERVISOR']

// Devuelve el rol del usuario autenticado y si puede gestionar Servicios del Hogar.
export async function GET(req: NextRequest) {
  try {
    const uid = await uidDesdeToken(req.headers.get('authorization'))
    if (!uid) return NextResponse.json({ esStaff: false }, { status: 401 })

    const sb = getAdmin() as any
    const { data } = await sb.from('usuarios').select('nombre, rol').eq('id', uid).maybeSingle()
    const rol = data?.rol ?? null
    const esStaff = !!rol && ROLES_GESTION.includes(rol)
    return NextResponse.json({ esStaff, rol, nombre: data?.nombre ?? null })
  } catch (e: unknown) {
    console.error('[gestion-hogar/whoami]', e)
    return NextResponse.json({ esStaff: false, error: 'Error interno.' }, { status: 500 })
  }
}

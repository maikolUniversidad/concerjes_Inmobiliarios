import { NextRequest, NextResponse } from 'next/server'
import { getAdmin } from '@/lib/supabase/admin'

// Traduce una cédula al correo con el que se entra a la plataforma.
//
// Los 863 colaboradores de planta tienen cuenta con un correo sintético
// (`<cédula>@conserje.local`) porque nómina no guarda correo personal. Pedirles
// que lo escriban sería absurdo: escriben su cédula y aquí se resuelve.
//
// Solo devuelve el correo de login, nunca el correo personal ni ningún otro
// dato, y solo si existe una ficha con ese documento. Un documento que no
// existe responde `null` igual que uno que sí: no sirve para averiguar quién
// trabaja en la empresa.

function correoLogin(email: string | null | undefined, documento: string): string {
  const e = (email ?? '').trim().toLowerCase()
  if (e && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) return e
  return `${documento.replace(/[^a-z0-9]/gi, '')}@conserje.local`
}

export async function POST(req: NextRequest) {
  let entrada = ''
  try { entrada = String((await req.json()).documento ?? '').trim() } catch { /* cuerpo inválido */ }

  // Si ya es un correo, no hay nada que resolver.
  if (!entrada) return NextResponse.json({ email: null })
  if (entrada.includes('@')) return NextResponse.json({ email: entrada.toLowerCase() })

  const documento = entrada.replace(/[^a-z0-9]/gi, '')
  if (!documento) return NextResponse.json({ email: null })

  const { data } = await getAdmin()
    .from('personas')
    .select('documento, email, usuario_id')
    .eq('documento', documento)
    .not('usuario_id', 'is', null)
    .limit(1)
    .maybeSingle()

  if (!data) return NextResponse.json({ email: null })

  const p = data as { documento: string; email: string | null }
  return NextResponse.json({ email: correoLogin(p.email, p.documento) })
}

import { NextRequest, NextResponse } from 'next/server'
import { getAdmin } from '@/lib/supabase/admin'

// Resuelve el correo de login a partir del número de documento, para que el
// candidato pueda ingresar sin recordar el correo sintético. (Service role.)
function emailLogin(email: string | null | undefined, documento: string): string {
  const e = (email ?? '').trim().toLowerCase()
  if (e && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) return e
  return `${String(documento).trim().replace(/[^a-z0-9]/gi, '')}@aspirante.conserjesinmobiliarios.com`
}

export async function POST(req: NextRequest) {
  let documento = ''
  try { documento = String((await req.json()).documento ?? '').trim() } catch { /* noop */ }
  if (!documento) return NextResponse.json({ email: null })

  const { data } = await getAdmin()
    .from('candidatos')
    .select('numero_documento, email')
    .eq('numero_documento', documento)
    .maybeSingle()
  if (!data) return NextResponse.json({ email: null })

  return NextResponse.json({ email: emailLogin((data as { email: string | null }).email, documento) })
}

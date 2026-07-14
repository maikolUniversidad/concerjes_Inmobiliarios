import { NextRequest, NextResponse } from 'next/server'
import { getAdmin, uidDesdeToken } from '@/lib/supabase/admin'

// Convierte la SESIÓN ANÓNIMA del candidato en una CUENTA PERMANENTE de la
// plataforma (mismo auth.uid → toda la información que llenó queda ligada a su
// cuenta). A partir de aquí puede volver a ingresar con su documento/correo
// (y, cuando exista el microservicio, con reconocimiento facial).
//
// El trigger handle_new_user ya creó su fila `usuarios` (rol AUDITOR) al iniciar
// la sesión anónima; aquí solo se le fija correo/nombre/contraseña.

function emailLogin(email: string | null | undefined, documento: string): string {
  const e = (email ?? '').trim().toLowerCase()
  if (e && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) return e
  return `${String(documento).trim().replace(/[^a-z0-9]/gi, '')}@aspirante.conserjesinmobiliarios.com`
}
function passwordDe(documento: string): string {
  const d = String(documento).trim()
  return d.length >= 6 ? d : d.padStart(6, '0')
}

export async function POST(req: NextRequest) {
  const uid = await uidDesdeToken(req.headers.get('authorization'))
  if (!uid) return NextResponse.json({ error: 'Sesión no válida.' }, { status: 401 })

  const admin = getAdmin()
  const { data: cand } = await admin
    .from('candidatos')
    .select('id, auth_uid, numero_documento, nombres, apellidos, email, celular')
    .eq('auth_uid', uid)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!cand) return NextResponse.json({ error: 'No encontramos tu registro.' }, { status: 404 })

  const c = cand as {
    numero_documento: string; nombres: string | null; apellidos: string | null
    email: string | null; celular: string | null
  }
  const documento = c.numero_documento
  const nombre = `${c.nombres ?? ''} ${c.apellidos ?? ''}`.trim() || documento
  const password = passwordDe(documento)

  // 1) Intento con el correo de contacto; si está tomado, uno sintético.
  const emailPreferido = emailLogin(c.email, documento)
  const emailSintetico = emailLogin(null, documento)

  async function convertir(email: string) {
    return admin.auth.admin.updateUserById(uid!, {
      email,
      password,
      email_confirm: true,
      user_metadata: { nombre },
    })
  }

  let loginEmail = emailPreferido
  let { error } = await convertir(loginEmail)
  if (error) {
    const m = (error.message ?? '').toLowerCase()
    if ((m.includes('already') || m.includes('registered') || m.includes('exists')) && emailPreferido !== emailSintetico) {
      loginEmail = emailSintetico
      ;({ error } = await convertir(loginEmail))
    }
  }
  if (error) {
    const m = (error.message ?? '').toLowerCase()
    if (m.includes('already') || m.includes('registered') || m.includes('exists')) {
      return NextResponse.json(
        { yaExiste: true, error: 'Ya tienes una cuenta. Ingresa con tu documento.' },
        { status: 409 },
      )
    }
    return NextResponse.json({ error: 'No se pudo crear tu cuenta: ' + error.message }, { status: 500 })
  }

  // 2) Completa la fila usuarios (creada por el trigger) con datos de contacto.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (admin as any).from('usuarios').update({
    nombre, email: loginEmail, telefono: c.celular ?? null, activo: true,
  }).eq('id', uid)

  await admin.from('vac_auditoria').insert({
    actor: uid, actor_tipo: 'CANDIDATO', accion: 'CREAR_CUENTA',
    entidad: 'usuarios', entidad_id: uid, user_agent: req.headers.get('user-agent'),
  })

  return NextResponse.json({ login_email: loginEmail, password })
}

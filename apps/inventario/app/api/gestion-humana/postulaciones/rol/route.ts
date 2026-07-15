import { NextRequest, NextResponse } from 'next/server'
import { getAdmin } from '@/lib/supabase/admin'
import { getPermisosUsuario } from '@/lib/permisos-server'

// Cambia el rol de plataforma de la cuenta de un candidato desde el ATS.
// Va por service role porque la RLS de `usuarios` solo deja escribir a
// SUPER_ADMIN/ADMIN, y aquí queremos habilitarlo también a quien tenga el
// permiso `gestionar_postulaciones` (p. ej. un Supervisor de RRHH).
//
// El trigger `sync_usuario_rol` copia roles.rol_base → usuarios.rol, así que
// cambiar el rol aquí SÍ cambia lo que puede hacer en las RLS. Promover a
// "Conserje" (OPERADOR_SEDE) debe hacerse solo cuando la persona esté contratada.
export async function POST(req: NextRequest) {
  const permisos = await getPermisosUsuario()
  if (!permisos.puede('gestionar_postulaciones')) {
    return NextResponse.json({ error: 'No autorizado.' }, { status: 403 })
  }

  let body: { candidato_id?: string; rol_id?: string | null }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Solicitud inválida.' }, { status: 400 })
  }
  if (!body.candidato_id) {
    return NextResponse.json({ error: 'Falta el candidato.' }, { status: 400 })
  }

  const admin = getAdmin()
  const { data: cand } = await admin
    .from('candidatos')
    .select('id, auth_uid, nombres, apellidos')
    .eq('id', body.candidato_id)
    .maybeSingle()
  const c = cand as { auth_uid: string | null; nombres: string | null; apellidos: string | null } | null
  if (!c) return NextResponse.json({ error: 'Candidato no encontrado.' }, { status: 404 })
  if (!c.auth_uid) {
    return NextResponse.json(
      { error: 'El candidato aún no tiene cuenta de plataforma (no ha terminado su registro).' },
      { status: 409 },
    )
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (admin as any)
    .from('usuarios')
    .update({ rol_id: body.rol_id || null })
    .eq('id', c.auth_uid)
  if (error) {
    return NextResponse.json({ error: 'No se pudo cambiar el rol: ' + error.message }, { status: 500 })
  }

  // usuarios.rol quedó sincronizado por el trigger; lo devolvemos como evidencia.
  const { data: usr } = await admin
    .from('usuarios').select('rol, rol_id').eq('id', c.auth_uid).maybeSingle()

  await admin.from('vac_auditoria').insert({
    actor_tipo: 'RRHH',
    accion: 'CAMBIAR_ROL',
    entidad: 'usuarios',
    entidad_id: c.auth_uid,
    despues: usr ?? null,
    user_agent: req.headers.get('user-agent'),
  })

  return NextResponse.json({ ok: true, usuario: usr })
}

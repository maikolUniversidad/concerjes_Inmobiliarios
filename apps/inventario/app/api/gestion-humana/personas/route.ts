import { NextRequest, NextResponse } from 'next/server'
import { createClient as createAdminSb } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { getPermisosUsuario } from '@/lib/permisos-server'

// Cuenta de plataforma para colaboradores de Gestión Humana.
// Toda persona queda enlazada a un `usuarios` (auth). El login se crea aquí con
// service role; la persona referencia la cuenta vía personas.usuario_id.

const SELECT = `id, tipo_doc, documento, nombres, apellidos, cargo, empresa_usuaria_id, sede_id, fecha_ingreso, estado, email, telefono, direccion, eps, arl, usuario_id, created_at, empresas_usuarias(id, nombre), sedes(id, nombre), cuenta:usuarios(id, email, activo, rol_id, roles(id, nombre))`

function admin() {
  return createAdminSb(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )
}

/** Email de login: el de contacto si existe, si no uno sintético por documento. */
export function loginEmailFor(email: string | null | undefined, documento: string): string {
  const e = (email ?? '').trim().toLowerCase()
  if (e && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) return e
  return `${String(documento).trim().replace(/[^a-z0-9]/gi, '')}@conserje.local`
}

/** Contraseña temporal por defecto = documento (Auth exige mínimo 6). */
function defaultPassword(password: string | null | undefined, documento: string): string {
  const p = (password ?? '').trim()
  if (p) return p
  const doc = String(documento).trim()
  return doc.length >= 6 ? doc : doc.padStart(6, '0')
}

async function autorizar() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Debes iniciar sesión.', status: 401 as const }
  const perm = await getPermisosUsuario()
  if (!perm.puede('gestionar_personas')) {
    return { error: 'No tienes permiso para gestionar personas.', status: 403 as const }
  }
  return { user }
}

interface CrearCuentaArgs {
  nombre: string
  loginEmail: string
  password: string
  rol_id: string | null
  telefono: string | null
  sede_id: string | null
  activo: boolean
}

/** Crea auth user + fila usuarios (rol/nombre). Devuelve el id o un error. */
async function crearCuenta(a: CrearCuentaArgs): Promise<{ id: string } | { error: string }> {
  const sb = admin()
  const { data: authData, error: authErr } = await sb.auth.admin.createUser({
    email: a.loginEmail,
    password: a.password,
    email_confirm: true,
    user_metadata: { nombre: a.nombre },
  })
  if (authErr || !authData.user) {
    const m = (authErr?.message ?? '').toLowerCase()
    if (m.includes('already') || m.includes('registered') || m.includes('exists')) {
      return { error: `Ya existe una cuenta con el correo ${a.loginEmail}.` }
    }
    return { error: authErr?.message ?? 'No se pudo crear la cuenta de acceso.' }
  }
  const uid = authData.user.id
  // El trigger handle_new_user ya creó la fila usuarios; ajustamos rol/datos.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: upErr } = await (sb as any).from('usuarios').update({
    nombre: a.nombre,
    telefono: a.telefono,
    rol_id: a.rol_id,
    sede_id: a.sede_id,
    activo: a.activo,
  }).eq('id', uid)
  if (upErr) {
    await sb.auth.admin.deleteUser(uid)
    return { error: 'No se pudo asignar el rol a la cuenta: ' + upErr.message }
  }
  return { id: uid }
}

function personaPayload(b: Record<string, unknown>): Record<string, unknown> {
  return {
    tipo_doc: (b.tipo_doc as string) || 'CC',
    documento: String(b.documento ?? '').trim(),
    nombres: String(b.nombres ?? '').trim(),
    apellidos: String(b.apellidos ?? '').trim(),
    cargo: (b.cargo as string)?.trim() || null,
    empresa_usuaria_id: (b.empresa_usuaria_id as string) || null,
    sede_id: (b.sede_id as string) || null,
    fecha_ingreso: (b.fecha_ingreso as string) || null,
    estado: (b.estado as string) || 'ACTIVO',
    email: (b.email as string)?.trim() || null,
    telefono: (b.telefono as string)?.trim() || null,
    direccion: (b.direccion as string)?.trim() || null,
    eps: (b.eps as string)?.trim() || null,
    arl: (b.arl as string)?.trim() || null,
  }
}

// ── POST: crear persona nueva + su cuenta de acceso ──────────────────────────
export async function POST(req: NextRequest) {
  try {
    const auth = await autorizar()
    if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

    const b = await req.json()
    const payload = personaPayload(b)
    if (!payload.documento || !payload.nombres || !payload.apellidos) {
      return NextResponse.json({ error: 'Documento, nombres y apellidos son obligatorios.' }, { status: 400 })
    }
    if (!b.rol_id) {
      return NextResponse.json({ error: 'Debes asignar un rol para el acceso.' }, { status: 400 })
    }

    const documento = payload.documento as string
    const nombre = `${payload.nombres} ${payload.apellidos}`.trim()
    const loginEmail = loginEmailFor(payload.email as string | null, documento)
    const password = defaultPassword(b.password as string, documento)

    const cuenta = await crearCuenta({
      nombre,
      loginEmail,
      password,
      rol_id: (b.rol_id as string) || null,
      telefono: payload.telefono as string | null,
      sede_id: payload.sede_id as string | null,
      activo: b.activo === undefined ? true : !!b.activo,
    })
    if ('error' in cuenta) return NextResponse.json({ error: cuenta.error }, { status: 400 })

    const sb = admin()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: persona, error: pErr } = await (sb as any)
      .from('personas')
      .insert({ ...payload, usuario_id: cuenta.id, created_by: auth.user.id })
      .select(SELECT)
      .single()

    if (pErr || !persona) {
      // rollback de la cuenta para no dejar huérfanos
      await sb.auth.admin.deleteUser(cuenta.id)
      const dup = (pErr?.message ?? '').includes('duplicate')
      return NextResponse.json(
        { error: dup ? 'Ya existe una persona con ese documento.' : (pErr?.message ?? 'No se pudo crear la persona.') },
        { status: 400 },
      )
    }

    return NextResponse.json({ persona, acceso: { login_email: loginEmail, password } }, { status: 201 })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

// ── PUT: gestionar el acceso de una persona existente ────────────────────────
// - Sin cuenta → crea el acceso (rol + contraseña) y enlaza la persona.
// - Con cuenta → actualiza rol / contraseña / activo.
export async function PUT(req: NextRequest) {
  try {
    const auth = await autorizar()
    if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

    const b = await req.json()
    const personaId = String(b.persona_id ?? '')
    if (!personaId) return NextResponse.json({ error: 'persona_id requerido.' }, { status: 400 })

    const sb = admin()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: persona, error: getErr } = await (sb as any)
      .from('personas')
      .select('id, documento, nombres, apellidos, email, telefono, sede_id, usuario_id')
      .eq('id', personaId)
      .single()
    if (getErr || !persona) return NextResponse.json({ error: 'Persona no encontrada.' }, { status: 404 })

    const nombre = `${persona.nombres} ${persona.apellidos}`.trim()
    let acceso: { login_email: string; password: string } | null = null

    if (!persona.usuario_id) {
      // Crear acceso para una persona que aún no lo tiene.
      if (!b.rol_id) return NextResponse.json({ error: 'Debes asignar un rol.' }, { status: 400 })
      const loginEmail = loginEmailFor(persona.email, persona.documento)
      const password = defaultPassword(b.password as string, persona.documento)
      const cuenta = await crearCuenta({
        nombre,
        loginEmail,
        password,
        rol_id: (b.rol_id as string) || null,
        telefono: persona.telefono ?? null,
        sede_id: persona.sede_id ?? null,
        activo: b.activo === undefined ? true : !!b.activo,
      })
      if ('error' in cuenta) return NextResponse.json({ error: cuenta.error }, { status: 400 })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: linkErr } = await (sb as any).from('personas').update({ usuario_id: cuenta.id }).eq('id', personaId)
      if (linkErr) {
        await sb.auth.admin.deleteUser(cuenta.id)
        return NextResponse.json({ error: 'No se pudo enlazar la cuenta: ' + linkErr.message }, { status: 400 })
      }
      acceso = { login_email: loginEmail, password }
    } else {
      // Actualizar la cuenta existente.
      const uid = persona.usuario_id as string
      if (b.password && String(b.password).trim()) {
        const { error: pwErr } = await sb.auth.admin.updateUserById(uid, { password: String(b.password).trim() })
        if (pwErr) return NextResponse.json({ error: 'No se pudo cambiar la contraseña: ' + pwErr.message }, { status: 400 })
      }
      const patch: Record<string, unknown> = {}
      if (b.rol_id !== undefined) patch.rol_id = (b.rol_id as string) || null
      if (b.activo !== undefined) patch.activo = !!b.activo
      if (Object.keys(patch).length) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error: upErr } = await (sb as any).from('usuarios').update(patch).eq('id', uid)
        if (upErr) return NextResponse.json({ error: 'No se pudo actualizar la cuenta: ' + upErr.message }, { status: 400 })
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: actualizada } = await (sb as any).from('personas').select(SELECT).eq('id', personaId).single()
    return NextResponse.json({ persona: actualizada, acceso })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

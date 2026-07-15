import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { getPermisosUsuario } from '@/lib/permisos-server'

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

/**
 * Esta ruta usa la service role (puede crear cuentas y asignar cualquier rol),
 * así que DEBE exigir sesión y permiso. Sin esto, cualquiera podría hacer POST
 * y crearse un SUPER_ADMIN.
 */
async function autorizar() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Debes iniciar sesión.', status: 401 as const }
  const perm = await getPermisosUsuario()
  if (!perm.puede('gestionar_usuarios')) {
    return { error: 'No tienes permiso para gestionar usuarios.', status: 403 as const }
  }
  return { user }
}

/** Traduce los errores de Auth a algo entendible (GoTrue a veces responde "{}"). */
function mensajeAuth(err: { message?: string } | null): string {
  const m = err?.message?.trim()
  if (!m || m === '{}') {
    return 'Auth rechazó la creación de la cuenta. Suele pasar cuando el correo ya está registrado o ya existe un perfil con ese correo.'
  }
  if (/already.*registered|already exists/i.test(m)) return 'Ese correo ya tiene una cuenta registrada.'
  if (/password/i.test(m) && /short|least/i.test(m)) return 'La contraseña es demasiado corta (mínimo 6 caracteres).'
  return m
}

export async function POST(req: NextRequest) {
  try {
    const auth = await autorizar()
    if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

    const body = await req.json()
    const { nombre, email, password, telefono, rol_id, grupo_id, sede_id, activo } = body

    if (!nombre || !email || !password) {
      return NextResponse.json({ error: 'nombre, email y password son obligatorios.' }, { status: 400 })
    }
    const correo = String(email).trim()
    const admin = adminClient()

    // 0. El perfil (public.usuarios) tiene UNIQUE(email). Si ya hay uno con ese
    //    correo, el trigger on_auth_user_created falla y Auth devuelve un 500
    //    opaco. Se valida antes para dar un mensaje claro.
    const { data: yaExiste } = await admin.from('usuarios').select('id, email').ilike('email', correo).maybeSingle()
    if (yaExiste) {
      return NextResponse.json({ error: `Ya existe un usuario con el correo ${correo}.` }, { status: 400 })
    }

    // 1. Crear usuario en Supabase Auth.
    //    El trigger `on_auth_user_created` ya inserta el perfil base en usuarios.
    const { data: authData, error: authErr } = await admin.auth.admin.createUser({
      email: correo,
      password,
      email_confirm: true,
      user_metadata: { nombre },
    })
    if (authErr || !authData.user) {
      return NextResponse.json({ error: mensajeAuth(authErr) }, { status: 400 })
    }

    // 2. Completar el perfil creado por el trigger (upsert, no insert: la fila ya existe).
    const { data: usuario, error: dbErr } = await admin
      .from('usuarios')
      .upsert({
        id: authData.user.id,
        nombre: nombre.trim(),
        email: correo,
        telefono: telefono?.trim() || null,
        // El enum `rol` lo sincroniza el trigger a partir del rol asignado.
        rol_id: rol_id || null,
        grupo_id: grupo_id || null,
        sede_id: sede_id || null,
        activo: activo ?? true,
        avatar_url: null,
      }, { onConflict: 'id' })
      .select(`id, nombre, email, rol, rol_id, grupo_id, sede_id, activo, ultimo_acceso, created_at, avatar_url, telefono, permisos, grupos_contrato(id, codigo, nombre), roles(id, nombre, permisos)`)
      .single()

    if (dbErr || !usuario) {
      // Rollback: quitar el perfil (lo pudo crear el trigger) y el usuario de Auth.
      await admin.from('usuarios').delete().eq('id', authData.user.id)
      await admin.auth.admin.deleteUser(authData.user.id)
      return NextResponse.json({ error: dbErr?.message || 'Error al registrar usuario en BD.' }, { status: 400 })
    }

    return NextResponse.json({ usuario }, { status: 201 })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}

export async function PUT(req: NextRequest) {
  try {
    const auth = await autorizar()
    if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

    const body = await req.json()
    const { id, password, ...fields } = body

    if (!id) return NextResponse.json({ error: 'id requerido.' }, { status: 400 })

    // Actualizar contraseña en Auth si se provee
    if (password) {
      const { error: authErr } = await adminClient().auth.admin.updateUserById(id, { password })
      if (authErr) return NextResponse.json({ error: authErr.message }, { status: 400 })
    }

    // Actualizar datos en tabla usuarios
    const { data: usuario, error: dbErr } = await adminClient()
      .from('usuarios')
      .update(fields)
      .eq('id', id)
      .select(`id, nombre, email, rol, rol_id, grupo_id, sede_id, activo, ultimo_acceso, created_at, avatar_url, telefono, permisos, grupos_contrato(id, codigo, nombre), roles(id, nombre, permisos)`)
      .single()

    if (dbErr || !usuario) {
      return NextResponse.json({ error: dbErr?.message ?? 'Error al actualizar.' }, { status: 400 })
    }

    return NextResponse.json({ usuario })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

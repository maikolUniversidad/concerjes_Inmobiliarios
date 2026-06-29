import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { nombre, email, password, telefono, rol, grupo_id, sede_id, activo } = body

    if (!nombre || !email || !password) {
      return NextResponse.json({ error: 'nombre, email y password son obligatorios.' }, { status: 400 })
    }

    // 1. Crear usuario en Supabase Auth
    const { data: authData, error: authErr } = await adminClient().auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { nombre },
    })
    if (authErr || !authData.user) {
      return NextResponse.json({ error: authErr?.message ?? 'Error al crear usuario en Auth.' }, { status: 400 })
    }

    // 2. Insertar en tabla usuarios con el mismo UUID que Auth
    const { data: usuario, error: dbErr } = await adminClient()
      .from('usuarios')
      .insert({
        id: authData.user.id,
        nombre: nombre.trim(),
        email: email.trim(),
        telefono: telefono?.trim() || null,
        rol: rol ?? 'OPERADOR_SEDE',
        grupo_id: grupo_id || null,
        sede_id: sede_id || null,
        activo: activo ?? true,
        avatar_url: null,
      })
      .select(`id, nombre, email, rol, grupo_id, sede_id, activo, ultimo_acceso, created_at, avatar_url, telefono, permisos, grupos_contrato(id, codigo, nombre)`)
      .single()

    if (dbErr || !usuario) {
      // Si falla el insert, eliminar el auth user para no dejar huérfanos
      await adminClient().auth.admin.deleteUser(authData.user.id)
      return NextResponse.json({ error: dbErr?.message ?? 'Error al registrar usuario en BD.' }, { status: 400 })
    }

    return NextResponse.json({ usuario }, { status: 201 })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

export async function PUT(req: NextRequest) {
  try {
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
      .select(`id, nombre, email, rol, grupo_id, sede_id, activo, ultimo_acceso, created_at, avatar_url, telefono, permisos, grupos_contrato(id, codigo, nombre)`)
      .single()

    if (dbErr || !usuario) {
      return NextResponse.json({ error: dbErr?.message ?? 'Error al actualizar.' }, { status: 400 })
    }

    return NextResponse.json({ usuario })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

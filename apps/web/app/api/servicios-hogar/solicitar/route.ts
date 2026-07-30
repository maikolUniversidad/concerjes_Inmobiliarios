import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

function anonClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  )
}

function numero() {
  const d = new Date()
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  const rand = Math.random().toString(36).substring(2, 6).toUpperCase()
  return `SH-${yyyy}${mm}${dd}-${rand}`
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()

    const {
      servicio, duracion, frecuencia,
      fecha, hora, mascotas, m2, notas,
      nombre, email, telefono,
      direccion, ciudad, barrio,
    } = body

    if (!servicio || !fecha || !hora || !nombre || !email || !telefono || !direccion) {
      return NextResponse.json({ error: 'Faltan campos requeridos.' }, { status: 400 })
    }

    const sb = anonClient() as any

    // Buscar tipo_id por nombre
    const { data: tipo } = await sb
      .from('tipos_servicio_hogar')
      .select('id')
      .eq('nombre', servicio)
      .maybeSingle()

    // Buscar tarifa_id por nombre y tipo
    let tarifa_id: string | null = null
    if (tipo?.id && duracion) {
      const { data: tar } = await sb
        .from('tarifas_servicio_hogar')
        .select('id')
        .eq('tipo_id', tipo.id)
        .ilike('nombre', `%${duracion}%`)
        .maybeSingle()
      tarifa_id = tar?.id ?? null
    }

    const { error } = await sb
      .from('solicitudes_servicio_hogar')
      .insert({
        numero:            numero(),
        cliente_nombre:    nombre,
        cliente_email:     email,
        cliente_telefono:  telefono,
        cliente_direccion: direccion,
        cliente_ciudad:    ciudad ?? 'Bogotá',
        cliente_barrio:    barrio ?? null,
        tipo_id:           tipo?.id ?? null,
        tarifa_id,
        frecuencia:        frecuencia ?? 'UNICA',
        fecha_deseada:     fecha,
        hora_inicio:       hora + ':00',
        m2_aprox:          m2 ? parseFloat(m2) : null,
        mascotas:          mascotas ?? false,
        notas:             notas || null,
        estado:            'PENDIENTE',
      })

    if (error) {
      console.error('[servicios-hogar/solicitar]', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch (e: unknown) {
    console.error('[servicios-hogar/solicitar] unexpected:', e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Error interno.' },
      { status: 500 }
    )
  }
}

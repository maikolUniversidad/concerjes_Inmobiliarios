import { NextRequest, NextResponse } from 'next/server'
import { getAdmin, uidDesdeToken } from '@/lib/supabase/admin'

function numero() {
  const d = new Date()
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  const rand = Math.random().toString(36).substring(2, 6).toUpperCase()
  return `SH-${yyyy}${mm}${dd}-${rand}`
}

// Crea una solicitud de servicio ligada al CLIENTE autenticado (cliente_id).
export async function POST(req: NextRequest) {
  try {
    const uid = await uidDesdeToken(req.headers.get('authorization'))
    if (!uid) return NextResponse.json({ error: 'No autenticado.' }, { status: 401 })

    const body = await req.json()
    const {
      servicio, duracion, frecuencia,
      fecha, hora, mascotas, m2, notas,
      nombre, email, telefono,
      direccion, ciudad, barrio,
    } = body

    if (!servicio || !fecha || !hora || !nombre || !telefono || !direccion) {
      return NextResponse.json({ error: 'Faltan campos requeridos.' }, { status: 400 })
    }

    const sb = getAdmin() as any

    const { data: tipo } = await sb
      .from('tipos_servicio_hogar').select('id').eq('nombre', servicio).maybeSingle()

    let tarifa_id: string | null = null
    if (tipo?.id && duracion) {
      const { data: tar } = await sb
        .from('tarifas_servicio_hogar')
        .select('id').eq('tipo_id', tipo.id).ilike('nombre', `%${duracion}%`).maybeSingle()
      tarifa_id = tar?.id ?? null
    }

    const { data: inserted, error } = await sb
      .from('solicitudes_servicio_hogar')
      .insert({
        numero:            numero(),
        cliente_id:        uid,
        cliente_nombre:    nombre,
        cliente_email:     email || null,
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
      .select('id, numero')
      .single()

    if (error) {
      console.error('[portal/solicitar]', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ ok: true, id: inserted.id, numero: inserted.numero })
  } catch (e: unknown) {
    console.error('[portal/solicitar] unexpected:', e)
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Error interno.' }, { status: 500 })
  }
}

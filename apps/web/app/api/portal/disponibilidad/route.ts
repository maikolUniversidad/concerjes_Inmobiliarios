import { NextRequest, NextResponse } from 'next/server'
import { getAdmin } from '@/lib/supabase/admin'

// Disponibilidad agregada (sin datos personales). Devuelve, por día y franja
// horaria, cuántas sesiones/solicitudes ya están ocupadas frente a la capacidad
// diaria de concierges, para que el cliente escoja un horario libre.
const HORAS = ['07:00', '08:00', '09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00']
const CAPACIDAD_POR_FRANJA = 5   // concierges disponibles simultáneamente

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const desde = searchParams.get('desde') // YYYY-MM-DD
    const hasta = searchParams.get('hasta')
    if (!desde || !hasta) {
      return NextResponse.json({ error: 'Faltan parámetros desde/hasta.' }, { status: 400 })
    }

    const sb = getAdmin() as any

    // Solicitudes confirmadas/en servicio en el rango.
    const { data: sols } = await sb
      .from('solicitudes_servicio_hogar')
      .select('fecha_deseada, hora_inicio, estado')
      .gte('fecha_deseada', desde)
      .lte('fecha_deseada', hasta)
      .in('estado', ['CONFIRMADA', 'EN_SERVICIO'])

    // Sesiones ya agendadas en el rango.
    const { data: ses } = await sb
      .from('agenda_servicio_hogar')
      .select('fecha, hora_inicio, estado')
      .gte('fecha', desde)
      .lte('fecha', hasta)
      .in('estado', ['PROGRAMADO', 'EN_CURSO'])

    // Conteo por "YYYY-MM-DD HH:00".
    const ocupacion: Record<string, number> = {}
    const key = (f: string, h: string) => `${f} ${String(h).slice(0, 5)}`
    for (const s of sols ?? []) ocupacion[key(s.fecha_deseada, s.hora_inicio)] = (ocupacion[key(s.fecha_deseada, s.hora_inicio)] ?? 0) + 1
    for (const s of ses ?? [])  ocupacion[key(s.fecha, s.hora_inicio)] = (ocupacion[key(s.fecha, s.hora_inicio)] ?? 0) + 1

    // Construir días del rango.
    const dias: Array<{ fecha: string; franjas: Array<{ hora: string; libres: number; estado: string }> }> = []
    const d0 = new Date(desde + 'T12:00:00')
    const d1 = new Date(hasta + 'T12:00:00')
    for (let d = new Date(d0); d <= d1; d.setDate(d.getDate() + 1)) {
      const fecha = d.toISOString().slice(0, 10)
      const dow = d.getDay() // 0 dom … 6 sáb
      const franjas = HORAS.map((hora) => {
        // Domingo cerrado; sábado sólo mañana.
        const cerrado = dow === 0 || (dow === 6 && Number(hora.slice(0, 2)) >= 13)
        const ocupados = ocupacion[`${fecha} ${hora}`] ?? 0
        const libres = cerrado ? 0 : Math.max(0, CAPACIDAD_POR_FRANJA - ocupados)
        const estado = cerrado ? 'cerrado' : libres === 0 ? 'lleno' : libres <= 2 ? 'limitado' : 'disponible'
        return { hora, libres, estado }
      })
      dias.push({ fecha, franjas })
    }

    return NextResponse.json({ ok: true, capacidad: CAPACIDAD_POR_FRANJA, dias })
  } catch (e: unknown) {
    console.error('[portal/disponibilidad] unexpected:', e)
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Error interno.' }, { status: 500 })
  }
}

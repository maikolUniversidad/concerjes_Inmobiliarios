import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { z } from 'zod'

const contactSchema = z.object({
  nombre: z.string().min(3),
  empresa: z.string().optional(),
  telefono: z.string().min(7),
  email: z.string().email(),
  servicio: z.string().optional(),
  mensaje: z.string().min(20),
})

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const data = contactSchema.parse(body)

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    )

    const { error } = await supabase.from('contactos_web').insert({
      nombre: data.nombre,
      empresa: data.empresa ?? null,
      telefono: data.telefono,
      email: data.email,
      servicio: data.servicio ?? null,
      mensaje: data.mensaje,
    })

    if (error) {
      console.error('Error guardando contacto:', error.message)
      return NextResponse.json({ success: false, error: 'No se pudo registrar el contacto' }, { status: 500 })
    }

    // TODO: Notificar por email vía Resend (send-alert-email edge function)

    return NextResponse.json({ success: true })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ success: false, error: 'Datos inválidos' }, { status: 400 })
    }
    return NextResponse.json({ success: false, error: 'Error interno' }, { status: 500 })
  }
}

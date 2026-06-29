import { NextRequest, NextResponse } from 'next/server'
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

    // TODO: Save to Supabase table `contactos`
    // TODO: Send email via Resend

    console.log('Nuevo contacto:', data)

    return NextResponse.json({ success: true })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ success: false, error: 'Datos inválidos' }, { status: 400 })
    }
    return NextResponse.json({ success: false, error: 'Error interno' }, { status: 500 })
  }
}

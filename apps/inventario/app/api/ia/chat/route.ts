import { NextRequest, NextResponse } from 'next/server'
import OpenAI from 'openai'

export async function POST(req: NextRequest) {
  const deepseek = new OpenAI({
    apiKey: process.env.DEEPSEEK_API_KEY || 'placeholder',
    baseURL: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
  })

  try {
    const { mensaje, historial = [] } = await req.json()

    // TODO: Query Supabase for relevant inventory context based on the message
    const inventarioContext = {
      nota: 'Conectar Supabase para obtener contexto real del inventario',
    }

    const response = await deepseek.chat.completions.create({
      model: process.env.DEEPSEEK_MODEL_CHAT || 'deepseek-chat',
      messages: [
        {
          role: 'system',
          content: `Eres el asistente de inventarios de Conserjes Inmobiliarios Ltda (NIT 800093388-2),
          empresa colombiana de aseo, cafetería y mantenimiento con más de 1.069 colaboradores.
          Tienes acceso a los datos actuales del inventario de la empresa.
          Responde en español colombiano, de forma clara, concisa y práctica.
          Si no tienes datos reales del inventario en este momento, indícalo amablemente y sugiere
          cómo el usuario puede obtener la información.
          Contexto del sistema: ${JSON.stringify(inventarioContext)}`,
        },
        ...historial.slice(-10),
        { role: 'user', content: mensaje },
      ],
      max_tokens: 800,
    })

    return NextResponse.json({
      success: true,
      respuesta: response.choices[0].message.content,
    })
  } catch (error) {
    console.error('IA Chat error:', error)
    return NextResponse.json(
      { success: false, respuesta: 'Error al procesar la consulta. Por favor intente nuevamente.' },
      { status: 500 }
    )
  }
}

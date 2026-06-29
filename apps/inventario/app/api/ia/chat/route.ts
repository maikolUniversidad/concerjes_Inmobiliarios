import { NextRequest, NextResponse } from 'next/server'
import OpenAI from 'openai'
import { createClient } from '@/lib/supabase/server'

interface ProdCtx {
  nombre_estandar: string
  presentacion: string | null
  cat_rotacion: string
  stock_minimo_def: number
  precio_lista: number | null
  stock: { cantidad_real: number; cantidad_disp: number } | null
}

async function construirContexto() {
  try {
    const supabase = await createClient()
    const { data } = await supabase
      .from('productos')
      .select('nombre_estandar, presentacion, cat_rotacion, stock_minimo_def, precio_lista, stock ( cantidad_real, cantidad_disp )')
      .eq('activo', true)
    const productos = (data as unknown as ProdCtx[]) ?? []

    const criticos = productos
      .filter(p => p.stock_minimo_def > 0 && (p.stock?.cantidad_real ?? 0) <= p.stock_minimo_def)
      .map(p => ({ producto: p.nombre_estandar, presentacion: p.presentacion, disponible: p.stock?.cantidad_real ?? 0, minimo: p.stock_minimo_def }))

    const valorInventario = productos.reduce((a, p) => a + (p.stock?.cantidad_real ?? 0) * (p.precio_lista ?? 0), 0)

    return {
      total_productos: productos.length,
      valor_inventario_cop: Math.round(valorInventario),
      productos_criticos: criticos.slice(0, 25),
      total_criticos: criticos.length,
      muestra_inventario: productos.slice(0, 40).map(p => ({
        producto: p.nombre_estandar, presentacion: p.presentacion,
        disponible: p.stock?.cantidad_real ?? 0, categoria: p.cat_rotacion,
      })),
    }
  } catch {
    return { nota: 'No se pudo cargar el contexto del inventario en este momento.' }
  }
}

export async function POST(req: NextRequest) {
  const deepseek = new OpenAI({
    apiKey: process.env.DEEPSEEK_API_KEY || 'placeholder',
    baseURL: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
  })

  try {
    const { mensaje, historial = [] } = await req.json()

    const inventarioContext = await construirContexto()

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

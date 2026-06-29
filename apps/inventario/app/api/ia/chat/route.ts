import { NextRequest } from 'next/server'
import OpenAI from 'openai'
import { createClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'
export const maxDuration = 60

interface ProdCtx {
  nombre_estandar: string
  presentacion: string | null
  cat_rotacion: string
  stock_minimo_def: number
  precio_lista: number | null
  stock: { cantidad_real: number; cantidad_disp: number } | null
}

interface ChatMsg {
  role: 'user' | 'assistant' | 'system'
  content: string
}

const cop = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 })

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
      .map(p => ({
        producto: p.nombre_estandar, presentacion: p.presentacion,
        disponible: p.stock?.cantidad_real ?? 0, minimo: p.stock_minimo_def,
        categoria: p.cat_rotacion,
      }))

    const valorInventario = productos.reduce((a, p) => a + (p.stock?.cantidad_real ?? 0) * (p.precio_lista ?? 0), 0)

    // Valor e items por categoría (útil para gráficas)
    const porCategoria: Record<string, { items: number; unidades: number; valor: number }> = {}
    for (const p of productos) {
      const c = p.cat_rotacion || 'N/D'
      porCategoria[c] = porCategoria[c] ?? { items: 0, unidades: 0, valor: 0 }
      porCategoria[c].items += 1
      porCategoria[c].unidades += p.stock?.cantidad_real ?? 0
      porCategoria[c].valor += (p.stock?.cantidad_real ?? 0) * (p.precio_lista ?? 0)
    }

    return {
      total_productos: productos.length,
      valor_inventario_cop: Math.round(valorInventario),
      por_categoria: porCategoria,
      total_criticos: criticos.length,
      productos_criticos: criticos.slice(0, 40),
      muestra_inventario: productos.slice(0, 60).map(p => ({
        producto: p.nombre_estandar, presentacion: p.presentacion,
        disponible: p.stock?.cantidad_real ?? 0, minimo: p.stock_minimo_def,
        categoria: p.cat_rotacion, precio: p.precio_lista ?? 0,
      })),
    }
  } catch {
    return { nota: 'No se pudo cargar el contexto del inventario en este momento.' }
  }
}

function systemPrompt(ctx: unknown): string {
  return `Eres el Asistente de Inventarios de **Conserjes Inmobiliarios Ltda** (NIT 800093388-2),
empresa colombiana de aseo, cafetería y mantenimiento con más de 1.069 colaboradores.
Tienes acceso a los datos actuales del inventario que aparecen al final de este mensaje.

REGLAS DE RESPUESTA:
- Responde SIEMPRE en español colombiano, claro, práctico y conciso.
- Usa **Markdown** rico: encabezados, **negritas**, listas, y tablas Markdown cuando compares datos.
- Formatea los valores monetarios en pesos colombianos (ej. $1.250.000).
- Si no tienes el dato exacto, dilo con honestidad y sugiere cómo obtenerlo.

GRÁFICAS:
- Cuando una comparación numérica se entienda mejor visualmente, incluye UNA gráfica
  usando un bloque de código con el lenguaje "chart" y un JSON válido. Formato:
\`\`\`chart
{"type":"bar","title":"Stock por categoría","xKey":"categoria","unidad":"uds","data":[{"categoria":"A","disponible":120,"minimo":50}],"series":[{"key":"disponible","name":"Disponible","color":"#2E7D32"},{"key":"minimo","name":"Mínimo","color":"#F57C00"}]}
\`\`\`
  - type puede ser "bar", "line", "area" o "pie".
  - Para "pie" usa "nameKey" y "valueKey" en lugar de "series"/"xKey".
  - Usa SOLO datos reales del contexto. No inventes cifras. Máximo 12 filas.
  - Acompaña la gráfica con una breve explicación en texto.

CONTEXTO DEL INVENTARIO (datos reales):
${JSON.stringify(ctx)}`
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const modelo: string = body.modelo === 'openai' ? 'openai' : 'deepseek-chat'
    // Acepta historial completo (`mensajes`) o el formato legacy (`mensaje` + `historial`).
    let mensajes: ChatMsg[] = Array.isArray(body.mensajes) ? body.mensajes : []
    if (mensajes.length === 0 && body.mensaje) {
      mensajes = [...(body.historial ?? []), { role: 'user', content: body.mensaje }]
    }
    mensajes = mensajes
      .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
      .slice(-16)

    const ctx = await construirContexto()

    const usandoOpenAI = modelo === 'openai'
    const client = new OpenAI(
      usandoOpenAI
        ? { apiKey: process.env.OPENAI_API_KEY }
        : {
            apiKey: process.env.DEEPSEEK_API_KEY,
            baseURL: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
          }
    )
    const modelId = usandoOpenAI
      ? (process.env.OPENAI_MODEL_CHAT || 'gpt-4o-mini')
      : (process.env.DEEPSEEK_MODEL_CHAT || 'deepseek-chat')

    const stream = await client.chat.completions.create({
      model: modelId,
      stream: true,
      temperature: 0.4,
      max_tokens: 1400,
      messages: [
        { role: 'system', content: systemPrompt(ctx) },
        ...mensajes,
      ],
    })

    const encoder = new TextEncoder()
    const readable = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of stream) {
            const delta = chunk.choices[0]?.delta?.content
            if (delta) controller.enqueue(encoder.encode(delta))
          }
        } catch (err) {
          console.error('IA stream error:', err)
          controller.enqueue(encoder.encode('\n\n_Ocurrió un error generando la respuesta._'))
        } finally {
          controller.close()
        }
      },
    })

    return new Response(readable, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'X-Accel-Buffering': 'no',
      },
    })
  } catch (error) {
    console.error('IA Chat error:', error)
    return new Response(
      JSON.stringify({ error: 'Error al procesar la consulta. Por favor intente nuevamente.' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}

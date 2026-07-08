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

interface AttachmentIn {
  name: string
  kind: 'image' | 'text'
  mime?: string
  dataUrl?: string
  text?: string
}

interface ChatMsg {
  role: 'user' | 'assistant' | 'system'
  content: string
  attachments?: AttachmentIn[]
}

const cop = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 })

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any

async function construirContexto(personaId?: string) {
  try {
    const supabase = await createClient()
    const [prodRes, persRes, empRes, sedeRes, grupoRes, usrRes, tiposRes, docsCount] = await Promise.all([
      supabase.from('productos').select('nombre_estandar, presentacion, cat_rotacion, stock_minimo_def, precio_lista, stock ( cantidad_real, cantidad_disp )').eq('activo', true),
      supabase.from('personas').select('documento, nombres, apellidos, cargo, estado, empresas_usuarias(nombre), sedes(nombre)').order('apellidos'),
      supabase.from('empresas_usuarias').select('nombre, ciudad').order('nombre'),
      supabase.from('sedes').select('nombre'),
      supabase.from('grupos_contrato').select('codigo, nombre'),
      supabase.from('usuarios').select('rol'),
      supabase.from('tipos_documentales').select('id, nombre'),
      supabase.from('documentos_persona').select('id', { count: 'exact', head: true }),
    ])

    // ── Inventario ──
    const productos = (prodRes.data as unknown as ProdCtx[]) ?? []
    const criticos = productos
      .filter(p => p.stock_minimo_def > 0 && (p.stock?.cantidad_real ?? 0) <= p.stock_minimo_def)
      .map(p => ({ producto: p.nombre_estandar, presentacion: p.presentacion, disponible: p.stock?.cantidad_real ?? 0, minimo: p.stock_minimo_def, categoria: p.cat_rotacion }))
    const valorInventario = productos.reduce((a, p) => a + (p.stock?.cantidad_real ?? 0) * (p.precio_lista ?? 0), 0)
    const porCategoria: Record<string, { items: number; unidades: number; valor: number }> = {}
    for (const p of productos) {
      const c = p.cat_rotacion || 'N/D'
      porCategoria[c] = porCategoria[c] ?? { items: 0, unidades: 0, valor: 0 }
      porCategoria[c].items += 1
      porCategoria[c].unidades += p.stock?.cantidad_real ?? 0
      porCategoria[c].valor += (p.stock?.cantidad_real ?? 0) * (p.precio_lista ?? 0)
    }

    // ── Personal (Gestión Humana) ──
    const personas = (persRes.data as Row[]) ?? []
    const porEstado: Record<string, number> = {}
    const porEmpresa: Record<string, number> = {}
    for (const p of personas) {
      porEstado[p.estado] = (porEstado[p.estado] ?? 0) + 1
      const emp = p.empresas_usuarias?.nombre ?? 'Sin empresa'
      porEmpresa[emp] = (porEmpresa[emp] ?? 0) + 1
    }
    const directorio = personas.slice(0, 1000).map((p: Row) => ({
      doc: p.documento, nombre: `${p.nombres} ${p.apellidos}`, cargo: p.cargo ?? null,
      estado: p.estado, empresa: p.empresas_usuarias?.nombre ?? null, sede: p.sedes?.nombre ?? null,
    }))

    // ── Usuarios del sistema por rol ──
    const usuariosPorRol: Record<string, number> = {}
    for (const u of (usrRes.data as Row[]) ?? []) usuariosPorRol[u.rol] = (usuariosPorRol[u.rol] ?? 0) + 1

    const tipos = (tiposRes.data as Row[]) ?? []

    // ── Persona seleccionada (detalle + cumplimiento documental) ──
    let persona_seleccionada: Row = null
    if (personaId) {
      const [pRes, dRes] = await Promise.all([
        supabase.from('personas').select('*, empresas_usuarias(nombre), sedes(nombre)').eq('id', personaId).single(),
        supabase.from('documentos_persona').select('nombre_archivo, tipo_documental_id, created_at').eq('persona_id', personaId),
      ])
      const pd = pRes.data as Row
      const dd = dRes.data as Row[]
      if (pd) {
        const docs = (dd as Row[]) ?? []
        const tipoNombre = new Map(tipos.map((t: Row) => [t.id, t.nombre]))
        const presentes = new Set(docs.map((d: Row) => d.tipo_documental_id).filter(Boolean))
        const faltantes = tipos.filter((t: Row) => !presentes.has(t.id)).map((t: Row) => t.nombre)
        persona_seleccionada = {
          documento: `${pd.tipo_doc} ${pd.documento}`, nombre: `${pd.nombres} ${pd.apellidos}`,
          cargo: pd.cargo, estado: pd.estado, empresa_usuaria: pd.empresas_usuarias?.nombre ?? null,
          sede: pd.sedes?.nombre ?? null, fecha_ingreso: pd.fecha_ingreso, email: pd.email,
          telefono: pd.telefono, direccion: pd.direccion, eps: pd.eps, arl: pd.arl,
          documentos_cargados: docs.map((d: Row) => ({ archivo: d.nombre_archivo, tipo: d.tipo_documental_id ? (tipoNombre.get(d.tipo_documental_id) ?? 'Sin clasificar') : 'Sin clasificar' })),
          documentos_faltantes: faltantes,
          cumplimiento: `${tipos.length - faltantes.length}/${tipos.length} tipos documentales`,
        }
      }
    }

    return {
      inventario: {
        total_productos: productos.length,
        valor_inventario_cop: Math.round(valorInventario),
        por_categoria: porCategoria,
        total_criticos: criticos.length,
        productos_criticos: criticos.slice(0, 25),
        muestra_inventario: productos.slice(0, 40).map(p => ({ producto: p.nombre_estandar, disponible: p.stock?.cantidad_real ?? 0, minimo: p.stock_minimo_def, categoria: p.cat_rotacion })),
      },
      personal: {
        total_personas: personas.length,
        por_estado: porEstado,
        por_empresa_usuaria: porEmpresa,
        directorio_personas: directorio,
        directorio_truncado: personas.length > directorio.length,
      },
      empresas_usuarias: (empRes.data as Row[] ?? []).map((e: Row) => ({ nombre: e.nombre, ciudad: e.ciudad })),
      sedes: (sedeRes.data as Row[] ?? []).map((s: Row) => s.nombre).slice(0, 120),
      grupos_contrato: (grupoRes.data as Row[]) ?? [],
      usuarios_sistema: { total: (usrRes.data as Row[] ?? []).length, por_rol: usuariosPorRol },
      tipos_documentales: tipos.map((t: Row) => t.nombre),
      total_documentos_cargados: docsCount.count ?? 0,
      persona_seleccionada,
    }
  } catch {
    return { nota: 'No se pudo cargar el contexto de la plataforma en este momento.' }
  }
}

function systemPrompt(ctx: unknown): string {
  return `Eres el Asistente de la plataforma de **Conserjes Inmobiliarios Ltda** (NIT 800093388-2),
empresa colombiana de aseo, cafetería y mantenimiento con más de 1.069 colaboradores.
Tienes acceso a los datos actuales de TODA la plataforma que aparecen al final de este mensaje:
inventario, **personal (Gestión Humana)**, empresas usuarias, sedes, grupos de contrato,
usuarios del sistema y documentos por persona.

REGLAS DE RESPUESTA:
- Responde SIEMPRE en español colombiano, claro, práctico y conciso.
- Usa **Markdown** rico: encabezados, **negritas**, listas, y tablas Markdown cuando compares datos.
- Formatea los valores monetarios en pesos colombianos (ej. $1.250.000).
- Para preguntas de personal usa "personal.directorio_personas" (busca por nombre o documento).
  Si "personal.directorio_truncado" es true, hay más personas de las listadas: acláralo.
- Si el contexto trae "persona_seleccionada", el usuario está preguntando sobre ESA persona:
  úsala como foco (sus datos, documentos cargados y documentos faltantes).
- Si no tienes el dato exacto, dilo con honestidad y sugiere cómo obtenerlo.
- Si el usuario adjunta archivos (imágenes, CSV, Excel o texto), analízalos y úsalos como
  fuente principal para tu respuesta.

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

CONTEXTO DE LA PLATAFORMA (datos reales):
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

    const ctx = await construirContexto(typeof body.personaId === 'string' ? body.personaId : undefined)

    // ¿Hay imágenes adjuntas? Si las hay, se fuerza un modelo con visión (OpenAI).
    const hayImagenes = mensajes.some(m => (m.attachments ?? []).some(a => a.kind === 'image' && a.dataUrl))
    const usandoOpenAI = modelo === 'openai' || hayImagenes

    const client = new OpenAI(
      usandoOpenAI
        ? { apiKey: process.env.OPENAI_API_KEY }
        : {
            apiKey: process.env.DEEPSEEK_API_KEY,
            baseURL: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
          }
    )
    const modelId = hayImagenes
      ? (process.env.OPENAI_MODEL_VISION || 'gpt-4o')
      : usandoOpenAI
        ? (process.env.OPENAI_MODEL_CHAT || 'gpt-4o-mini')
        : (process.env.DEEPSEEK_MODEL_CHAT || 'deepseek-chat')

    // Transforma cada mensaje al formato del modelo, incrustando texto de
    // archivos e imágenes (visión) cuando corresponda.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const toModelMessage = (m: ChatMsg): any => {
      const adj = m.attachments ?? []
      const partesTexto: string[] = []
      if (m.content) partesTexto.push(m.content)
      for (const a of adj) {
        if (a.kind === 'text' && a.text) {
          partesTexto.push(`\n\n--- Archivo adjunto: ${a.name} ---\n${a.text}`)
        }
      }
      const imagenes = adj.filter(a => a.kind === 'image' && a.dataUrl)
      const texto = partesTexto.join('')

      if (imagenes.length === 0) return { role: m.role, content: texto }
      return {
        role: m.role,
        content: [
          { type: 'text', text: texto || 'Analiza la(s) imagen(es) adjunta(s) en el contexto del inventario.' },
          ...imagenes.map(a => ({ type: 'image_url', image_url: { url: a.dataUrl } })),
        ],
      }
    }

    const stream = await client.chat.completions.create({
      model: modelId,
      stream: true,
      temperature: 0.4,
      max_tokens: 1400,
      messages: [
        { role: 'system', content: systemPrompt(ctx) },
        ...mensajes.map(toModelMessage),
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

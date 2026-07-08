import { NextRequest, NextResponse } from 'next/server'
import OpenAI from 'openai'
import { createClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'
export const maxDuration = 60

interface TipoRow { id: string; parent_id: string | null; nombre: string; descripcion: string | null }

function rutaDe(id: string, map: Map<string, TipoRow>): string {
  const partes: string[] = []
  let cur = map.get(id)
  let guard = 0
  while (cur && guard++ < 20) {
    partes.unshift(cur.nombre)
    cur = cur.parent_id ? map.get(cur.parent_id) : undefined
  }
  return partes.join(' / ')
}

export async function POST(req: NextRequest) {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json({ error: 'IA de visión no configurada (falta OPENAI_API_KEY).' }, { status: 503 })
    }
    const { modo, imagen } = await req.json()
    if (!imagen || typeof imagen !== 'string') {
      return NextResponse.json({ error: 'Falta la imagen.' }, { status: 400 })
    }

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
    const model = process.env.OPENAI_MODEL_VISION || 'gpt-4o'

    // ── Modo OCR: solo extraer palabras clave del documento ──────────────────
    if (modo === 'ocr') {
      const r = await openai.chat.completions.create({
        model,
        temperature: 0,
        max_tokens: 400,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: 'Eres un lector de documentos (OCR). Extrae de la imagen los encabezados, entidades y palabras clave que identifican el TIPO de documento. Responde SOLO un JSON: {"texto":"<hasta 300 caracteres con las palabras clave y encabezados>"}.',
          },
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Extrae las palabras clave de este documento.' },
              { type: 'image_url', image_url: { url: imagen } },
            ],
          },
        ],
      })
      const json = JSON.parse(r.choices[0]?.message?.content || '{}')
      return NextResponse.json({ texto: String(json.texto ?? '').slice(0, 500) })
    }

    // ── Modo clasificar: identificar el tipo documental ──────────────────────
    const supabase = await createClient()
    const [{ data: tipos }, { data: refs }] = await Promise.all([
      supabase.from('tipos_documentales').select('id, parent_id, nombre, descripcion'),
      supabase.from('tipos_documentales_refs').select('tipo_id, texto').order('created_at', { ascending: false }).limit(400),
    ])
    const lista = (tipos ?? []) as TipoRow[]
    if (lista.length === 0) {
      return NextResponse.json({ tipoId: null, confianza: 0, texto: '', error: 'No hay tipos documentales.' })
    }
    const map = new Map(lista.map((t) => [t.id, t]))

    // Agregar hasta ~6 muestras de keywords por tipo
    const refsPorTipo = new Map<string, string[]>()
    for (const r of (refs ?? []) as { tipo_id: string; texto: string | null }[]) {
      if (!r.texto) continue
      const arr = refsPorTipo.get(r.tipo_id) ?? []
      if (arr.length < 6) { arr.push(r.texto.slice(0, 200)); refsPorTipo.set(r.tipo_id, arr) }
    }

    const catalogo = lista.map((t, i) => {
      const kw = (refsPorTipo.get(t.id) ?? []).join(' · ')
      return `${i + 1}) id=${t.id} | ${rutaDe(t.id, map)}${t.descripcion ? ` | desc: ${t.descripcion}` : ''}${kw ? ` | ejemplos: ${kw}` : ''}`
    }).join('\n')

    const r = await openai.chat.completions.create({
      model,
      temperature: 0,
      max_tokens: 500,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content:
            `Eres un clasificador de documentos de RRHH en Colombia. Se te da la imagen de UN documento y una lista de TIPOS posibles con su descripción y ejemplos de palabras clave. ` +
            `Identifica el tipo más probable según lo que leas en la imagen. ` +
            `Responde SOLO un JSON: {"tipoId": "<id exacto de la lista o null>", "confianza": <entero 0-100>, "texto": "<hasta 240 caracteres con las palabras clave/datos que leíste>"}. ` +
            `Si ningún tipo encaja con confianza razonable, usa tipoId=null.\n\nTIPOS:\n${catalogo}`,
        },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Clasifica este documento e indica su tipo.' },
            { type: 'image_url', image_url: { url: imagen } },
          ],
        },
      ],
    })
    const json = JSON.parse(r.choices[0]?.message?.content || '{}')
    const tipoId = json.tipoId && map.has(json.tipoId) ? json.tipoId : null
    return NextResponse.json({
      tipoId,
      confianza: Math.max(0, Math.min(100, Number(json.confianza) || 0)),
      texto: String(json.texto ?? '').slice(0, 400),
    })
  } catch (error) {
    console.error('analizar-doc error:', error)
    return NextResponse.json({ error: 'No se pudo analizar el documento.' }, { status: 500 })
  }
}

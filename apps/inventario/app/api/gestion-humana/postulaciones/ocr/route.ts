import { NextRequest, NextResponse } from 'next/server'
import OpenAI from 'openai'
import { createClient } from '@/lib/supabase/server'
import { getPermisosUsuario } from '@/lib/permisos-server'

export const runtime = 'nodejs'
export const maxDuration = 60

// OCR asistido de documentos del Registro de Vacantes (visión LLM, JSON forzado).
// Extrae los campos del documento y los persiste en candidato_documentos.ocr_resultado
// para la validación cruzada contra lo digitado por el candidato (§7.3).
export async function POST(req: NextRequest) {
  try {
    const permisos = await getPermisosUsuario()
    if (!permisos.puede('gestionar_postulaciones')) {
      return NextResponse.json({ error: 'No autorizado.' }, { status: 403 })
    }
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json({ error: 'IA de visión no configurada (falta OPENAI_API_KEY).' }, { status: 503 })
    }

    const { docId } = await req.json()
    if (!docId) return NextResponse.json({ error: 'Falta el documento.' }, { status: 400 })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = (await createClient()) as any
    const { data: doc } = await sb
      .from('candidato_documentos')
      .select('id, storage_path, mime')
      .eq('id', docId)
      .maybeSingle()
    if (!doc) return NextResponse.json({ error: 'Documento no encontrado.' }, { status: 404 })

    if (doc.mime && doc.mime.includes('pdf')) {
      return NextResponse.json({ error: 'El OCR por ahora solo procesa imágenes (JPG/PNG), no PDF.' }, { status: 415 })
    }

    // Signed URL de vida corta: OpenAI la descarga durante ese lapso.
    const { data: signed, error: sErr } = await sb.storage
      .from('registro-vacantes')
      .createSignedUrl(doc.storage_path, 120)
    if (sErr || !signed?.signedUrl) {
      return NextResponse.json({ error: 'No se pudo acceder al archivo.' }, { status: 500 })
    }

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
    const model = process.env.OPENAI_MODEL_VISION || 'gpt-4o'

    const r = await openai.chat.completions.create({
      model,
      temperature: 0,
      max_tokens: 700,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content:
            'Eres un lector experto de documentos de identidad y certificados colombianos ' +
            '(cédula amarilla, cédula digital, PPT, PEP, pasaporte, certificados de antecedentes). ' +
            'Extrae los datos legibles de la imagen. Devuelve SOLO un JSON con esta forma exacta:\n' +
            '{"tipo_detectado":"CEDULA_CIUDADANIA|CEDULA_DIGITAL|CEDULA_EXTRANJERIA|PPT|PEP|PASAPORTE|CERTIFICADO_ANTECEDENTES|OTRO",' +
            '"confianza_global":<0..1>,' +
            '"campos":{' +
            '"numero_documento":{"valor":"","confianza":0},' +
            '"nombres":{"valor":"","confianza":0},' +
            '"apellidos":{"valor":"","confianza":0},' +
            '"fecha_nacimiento":{"valor":"YYYY-MM-DD","confianza":0},' +
            '"fecha_expedicion":{"valor":"YYYY-MM-DD","confianza":0},' +
            '"lugar_expedicion":{"valor":"","confianza":0},' +
            '"rh":{"valor":"","confianza":0},' +
            '"sexo":{"valor":"M|F","confianza":0}},' +
            '"alertas":["texto corto"]}\n' +
            'Usa cadena vacía y confianza 0 en los campos que no apliquen o no puedas leer. ' +
            'Las fechas SIEMPRE en formato YYYY-MM-DD. No inventes datos.',
        },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Extrae los datos de este documento.' },
            { type: 'image_url', image_url: { url: signed.signedUrl } },
          ],
        },
      ],
    })

    let json: Record<string, unknown>
    try {
      json = JSON.parse(r.choices[0]?.message?.content || '{}')
    } catch {
      return NextResponse.json({ error: 'La IA no devolvió un resultado válido.' }, { status: 502 })
    }

    const confianza = Math.max(0, Math.min(1, Number(json.confianza_global) || 0))
    const fechaExp = (json as any)?.campos?.fecha_expedicion?.valor || null
    const fechaExpValida = typeof fechaExp === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(fechaExp) ? fechaExp : null

    await sb
      .from('candidato_documentos')
      .update({
        ocr_resultado: json,
        ocr_confianza: confianza,
        fecha_expedicion_detectada: fechaExpValida,
        estado: 'EN_VALIDACION',
      })
      .eq('id', docId)

    return NextResponse.json({ ocr: json, confianza })
  } catch (error) {
    console.error('postulaciones/ocr error:', error)
    return NextResponse.json({ error: 'No se pudo analizar el documento.' }, { status: 500 })
  }
}

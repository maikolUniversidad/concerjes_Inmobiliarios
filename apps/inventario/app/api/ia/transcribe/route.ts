import { NextRequest, NextResponse } from 'next/server'
import OpenAI from 'openai'

export const runtime = 'nodejs'
export const maxDuration = 60

export async function POST(req: NextRequest) {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json({ error: 'Transcripción no configurada (falta OPENAI_API_KEY).' }, { status: 503 })
    }

    const form = await req.formData()
    const file = form.get('audio')
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'No se recibió el archivo de audio.' }, { status: 400 })
    }
    // Límite defensivo (~25 MB, tope de Whisper)
    if (file.size > 25 * 1024 * 1024) {
      return NextResponse.json({ error: 'El audio supera el límite de 25 MB.' }, { status: 413 })
    }

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

    const result = await openai.audio.transcriptions.create({
      file,
      model: process.env.OPENAI_MODEL_TRANSCRIBE || 'whisper-1',
      language: 'es',
    })

    return NextResponse.json({ texto: result.text?.trim() ?? '' })
  } catch (error) {
    console.error('Transcripción error:', error)
    return NextResponse.json({ error: 'No se pudo transcribir el audio.' }, { status: 500 })
  }
}

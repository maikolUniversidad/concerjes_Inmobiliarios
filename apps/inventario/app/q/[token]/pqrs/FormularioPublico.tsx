'use client'

// Formulario que llena un residente en la calle, con una mano, desde el celular.
//
// Reglas de forma que vienen de ahí y no son capricho:
//   · los botones y los campos son grandes (h-12 o más): se usa de pie;
//   · la categoría se elige tocando una tarjeta, no en un `select`;
//   · anónimo es el valor por defecto: pedir nombre antes de que haya escrito
//     el problema es la forma más segura de que nadie reporte nada;
//   · un solo botón de enviar, y al terminar la pantalla cambia al NÚMERO DE
//     RADICADO, que es lo único que el residente se lleva.
//
// No hay sesión de Supabase: se manda todo a `/api/pqrs/publica`, que calcula
// el `ip_hash`, sube las fotos con la llave de servicio y llama a la RPC.

import { useState } from 'react'
import Link from 'next/link'
import { Camera, CheckCircle2, Loader2, Send, X } from 'lucide-react'
import {
  CALIDADES_PUBLICAS, MAX_BYTES_FOTO_PUBLICA, MAX_FOTOS_PUBLICAS,
  problemaDeFoto, type CalidadPublica, type CategoriaPublica,
} from '@/lib/pqrs/publico'

const CALIDAD_LABEL: Record<CalidadPublica, string> = {
  RESIDENTE: 'Residente',
  PROPIETARIO: 'Propietario',
  OTRO: 'Otro',
}

export function FormularioPublico({ codigo, modo, categorias, punto }: {
  codigo: string
  modo: 'QR' | 'MANUAL'
  categorias: CategoriaPublica[]
  punto: string
}) {
  const [categoria, setCategoria] = useState('')
  const [descripcion, setDescripcion] = useState('')
  const [anonima, setAnonima] = useState(true)
  const [nombre, setNombre] = useState('')
  const [calidad, setCalidad] = useState<CalidadPublica>('RESIDENTE')
  const [telefono, setTelefono] = useState('')
  const [email, setEmail] = useState('')
  const [fotos, setFotos] = useState<File[]>([])
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState('')
  const [radicado, setRadicado] = useState<{ numero: string; fechaLimite: string } | null>(null)

  async function elegirFotos(lista: FileList | null) {
    if (!lista) return
    const buenas: File[] = []
    for (const original of Array.from(lista)) {
      // Se comprime SIEMPRE: una foto de 4 MB por la red de un sótano no sube
      // nunca, y las dos fotos viajan en el mismo cuerpo, que en Vercel está
      // limitado a 4,5 MB.
      const f = await comprimir(original)
      const problema = problemaDeFoto(f.name, f.size, f.type)
      if (problema) { setError(problema); continue }
      buenas.push(f)
    }
    if (buenas.length > 0) setError('')
    setFotos((prev) => [...prev, ...buenas].slice(0, MAX_FOTOS_PUBLICAS))
  }

  async function enviar() {
    if (!categoria) { setError('Dinos de qué se trata.'); return }
    if (descripcion.trim().length < 10) { setError('Cuéntanos un poco más de lo que pasó.'); return }
    if (!anonima && !nombre.trim()) { setError('Escribe tu nombre, o déjalo anónimo.'); return }

    setEnviando(true)
    setError('')
    try {
      const cuerpo = new FormData()
      cuerpo.set('codigo', codigo)
      cuerpo.set('modo', modo)
      cuerpo.set('categoria', categoria)
      cuerpo.set('descripcion', descripcion.trim())
      cuerpo.set('anonima', anonima ? 'si' : 'no')
      if (!anonima) {
        cuerpo.set('nombre', nombre.trim())
        cuerpo.set('calidad', calidad)
      }
      if (telefono.trim()) cuerpo.set('telefono', telefono.trim())
      if (email.trim()) cuerpo.set('email', email.trim())
      fotos.forEach((f) => cuerpo.append('fotos', f))

      const res = await fetch('/api/pqrs/publica', { method: 'POST', body: cuerpo })
      const datos = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(datos?.error || 'No se pudo enviar el reporte.')
      setRadicado({ numero: datos.numero, fechaLimite: datos.fecha_limite })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo enviar el reporte.')
    } finally {
      setEnviando(false)
    }
  }

  if (radicado) {
    return (
      <div className="p-5 text-center">
        <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-500" />
        <h2 className="font-heading mt-3 text-lg font-bold text-gray-900">Reporte recibido</h2>
        <p className="font-body mt-1 text-sm text-gray-600">
          Guarda este número: con él puedes consultar en qué va.
        </p>
        <p className="font-heading mt-4 rounded-xl bg-gray-900 px-4 py-3 font-mono text-2xl font-bold text-white">
          {radicado.numero}
        </p>
        {radicado.fechaLimite && (
          <p className="font-body mt-3 text-sm text-gray-600">
            Se responde a más tardar el{' '}
            <strong>{fechaLegible(radicado.fechaLimite)}</strong>.
          </p>
        )}
        <Link
          href={`/q/estado?numero=${encodeURIComponent(radicado.numero)}`}
          className="font-body mt-5 inline-flex h-12 w-full items-center justify-center rounded-xl bg-brand-green font-semibold text-white"
        >
          Consultar el estado
        </Link>
      </div>
    )
  }

  return (
    <div className="space-y-5 p-5">
      {/* De qué se trata */}
      <div>
        <p className="font-heading text-sm font-semibold text-gray-900">¿De qué se trata?</p>
        <div className="mt-2 grid grid-cols-2 gap-2">
          {categorias.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setCategoria(c.id)}
              aria-pressed={categoria === c.id}
              className={`min-h-[64px] rounded-xl border px-3 py-2 text-left transition-colors ${
                categoria === c.id
                  ? 'border-brand-green bg-brand-green-bg/60 ring-1 ring-brand-green'
                  : 'border-gray-200 bg-white hover:bg-gray-50'
              }`}
            >
              <span className="font-body block text-sm font-semibold text-gray-900">{c.nombre}</span>
              {c.descripcion && (
                <span className="font-body mt-0.5 block text-[11px] leading-tight text-gray-500">
                  {c.descripcion}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Qué pasó */}
      <div>
        <label htmlFor="pqrs-descripcion" className="font-heading text-sm font-semibold text-gray-900">
          Cuéntanos qué pasó
        </label>
        <textarea
          id="pqrs-descripcion"
          value={descripcion}
          onChange={(e) => setDescripcion(e.target.value.slice(0, 2000))}
          rows={4}
          placeholder={`Por ejemplo: en ${punto} hay…`}
          className="font-body mt-1.5 w-full rounded-xl border border-gray-200 px-3 py-2.5 text-base outline-none focus:border-brand-green"
        />
      </div>

      {/* Fotos */}
      <div>
        <p className="font-heading text-sm font-semibold text-gray-900">
          Una foto ayuda <span className="font-body font-normal text-gray-400">(opcional)</span>
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {fotos.map((f, i) => (
            <span
              key={`${f.name}-${i}`}
              className="font-body inline-flex max-w-full items-center gap-1 rounded-lg bg-gray-100 px-2 py-1.5 text-xs text-gray-700"
            >
              <span className="truncate">{f.name}</span>
              <button
                type="button"
                aria-label={`Quitar ${f.name}`}
                onClick={() => setFotos((prev) => prev.filter((_, j) => j !== i))}
              >
                <X className="h-3.5 w-3.5 text-gray-500" />
              </button>
            </span>
          ))}
          {fotos.length < MAX_FOTOS_PUBLICAS && (
            <label className="font-body inline-flex h-12 cursor-pointer items-center gap-2 rounded-xl border border-gray-200 px-3 text-sm text-gray-600">
              <Camera className="h-5 w-5" /> Tomar o elegir foto
              <input
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={(e) => { elegirFotos(e.target.files); e.target.value = '' }}
              />
            </label>
          )}
        </div>
        <p className="font-body mt-1 text-[11px] text-gray-400">
          Hasta {MAX_FOTOS_PUBLICAS} fotos de {Math.round(MAX_BYTES_FOTO_PUBLICA / 1024 / 1024)} MB.
        </p>
      </div>

      {/* Quién reporta */}
      <div className="rounded-xl bg-gray-50 p-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="font-heading text-sm font-semibold text-gray-900">Reportar sin dar mi nombre</p>
            <p className="font-body text-[11px] text-gray-500">
              Si lo dejas anónimo no podremos contarte la respuesta.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={anonima}
            aria-label="Reportar sin dar mi nombre"
            onClick={() => setAnonima((v) => !v)}
            className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${
              anonima ? 'bg-brand-green' : 'bg-gray-300'
            }`}
          >
            <span
              className={`absolute top-1 h-5 w-5 rounded-full bg-white transition-all ${
                anonima ? 'left-6' : 'left-1'
              }`}
            />
          </button>
        </div>

        {!anonima && (
          <div className="mt-3 space-y-2">
            <input
              value={nombre}
              onChange={(e) => setNombre(e.target.value.slice(0, 200))}
              placeholder="Tu nombre"
              aria-label="Tu nombre"
              className="font-body h-12 w-full rounded-xl border border-gray-200 px-3 text-base outline-none focus:border-brand-green"
            />
            <div className="flex gap-1.5">
              {CALIDADES_PUBLICAS.map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setCalidad(k)}
                  aria-pressed={calidad === k}
                  className={`font-body flex-1 rounded-lg px-2 py-2 text-xs font-semibold ${
                    calidad === k ? 'bg-gray-900 text-white' : 'bg-white text-gray-600 ring-1 ring-gray-200'
                  }`}
                >
                  {CALIDAD_LABEL[k]}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="mt-2 grid gap-2">
          <input
            value={telefono}
            onChange={(e) => setTelefono(e.target.value.replace(/[^\d+ ]/g, '').slice(0, 30))}
            inputMode="tel"
            placeholder="Teléfono (opcional)"
            aria-label="Teléfono"
            className="font-body h-12 w-full rounded-xl border border-gray-200 px-3 text-base outline-none focus:border-brand-green"
          />
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value.slice(0, 160))}
            inputMode="email"
            placeholder="Correo (opcional)"
            aria-label="Correo"
            className="font-body h-12 w-full rounded-xl border border-gray-200 px-3 text-base outline-none focus:border-brand-green"
          />
        </div>
      </div>

      {error && (
        <p role="alert" className="font-body rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      <button
        type="button"
        onClick={enviar}
        disabled={enviando}
        className="font-body flex h-14 w-full items-center justify-center gap-2 rounded-xl bg-brand-green text-base font-bold text-white disabled:opacity-60"
      >
        {enviando ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
        {enviando ? 'Enviando…' : 'Enviar el reporte'}
      </button>

      <p className="font-body text-center text-[11px] leading-relaxed text-gray-400">
        Al enviar, autorizas el tratamiento de los datos que escribas para atender y responder este
        reporte. Nunca guardamos tu dirección IP.
      </p>
    </div>
  )
}

/**
 * Reduce la foto a 1.280 px de lado largo y la recodifica en JPEG, igual que
 * hace la PWA de campo antes de subir una evidencia. Si el navegador no puede
 * (canvas bloqueado, formato que no decodifica), devuelve la original: que la
 * foto pese es mejor que no poder reportar.
 */
async function comprimir(original: File): Promise<File> {
  const LADO = 1280
  try {
    const bitmap = await createImageBitmap(original)
    const escala = Math.min(1, LADO / Math.max(bitmap.width, bitmap.height || 1))
    const ancho = Math.max(1, Math.round(bitmap.width * escala))
    const alto = Math.max(1, Math.round(bitmap.height * escala))
    const lienzo = document.createElement('canvas')
    lienzo.width = ancho
    lienzo.height = alto
    const ctx = lienzo.getContext('2d')
    if (!ctx) return original
    ctx.drawImage(bitmap, 0, 0, ancho, alto)
    const blob = await new Promise<Blob | null>((r) => lienzo.toBlob(r, 'image/jpeg', 0.82))
    if (!blob) return original
    const nombre = original.name.replace(/\.[^.]+$/, '') || 'foto'
    return new File([blob], `${nombre}.jpg`, { type: 'image/jpeg' })
  } catch {
    return original
  }
}

/** "2026-11-18" → "18 de noviembre de 2026". Sin `new Date`, para no correr el
 *  día por zona horaria (el servidor va en UTC y el celular en Bogotá). */
function fechaLegible(fecha: string): string {
  const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
    'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
  const [a, m, d] = fecha.slice(0, 10).split('-')
  const mes = MESES[Number(m) - 1]
  return mes ? `${Number(d)} de ${mes} de ${a}` : fecha
}

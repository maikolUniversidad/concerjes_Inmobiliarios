'use client'

import { useCallback, useEffect, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import Link from 'next/link'
import { Bug, Loader2, Camera, Copy, Paperclip, ImageOff, ListChecks, Terminal, Globe, MousePointerClick } from 'lucide-react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { Hoja, inputMant, labelMant } from '@/components/mantenimiento/Hoja'
import { navigation } from '@/components/layout/navigation'
import { capturarContexto, capturarPantalla, instalarCaptura, registrarNavegacion, type ContextoSoporte } from '@/lib/soporte/captura'
import {
  TIPO_SOPORTE_META, PRIORIDADES_SOPORTE, PRIORIDAD_SOPORTE_META, MAX_ADJUNTO_SOPORTE,
  subirArchivoSoporte, copiarTexto, type TipoSoporte, type AdjuntoSubido,
} from '@/lib/soporte'
import { construirPrompt } from '@/lib/soporte/prompt'

// La grabadora se instala al cargar el módulo (antes del primer render) para
// no perder los logs del arranque.
if (typeof window !== 'undefined') instalarCaptura()

/** "Inventario › Stock" a partir de la ruta actual. */
export function moduloDeRuta(ruta: string): string | null {
  let mejor: { mod: string; item: string; len: number } | null = null
  for (const mod of navigation) {
    for (const it of mod.items) {
      if ((ruta === it.href || ruta.startsWith(it.href + '/')) && (!mejor || it.href.length > mejor.len)) {
        mejor = { mod: mod.title, item: it.label, len: it.href.length }
      }
    }
  }
  return mejor ? `${mejor.mod} › ${mejor.item}` : null
}

/** Abre el reporte desde cualquier parte: `window.dispatchEvent(new Event('soporte:abrir'))`. */
export const EVENTO_ABRIR_SOPORTE = 'soporte:abrir'

export function BotonSoporte() {
  const pathname = usePathname()
  const router = useRouter()
  const [preparando, setPreparando] = useState(false)
  const [abierta, setAbierta] = useState(false)
  const [contexto, setContexto] = useState<ContextoSoporte | null>(null)
  const [captura, setCaptura] = useState<Blob | null>(null)
  const [capturaUrl, setCapturaUrl] = useState<string | null>(null)
  const [incluirCaptura, setIncluirCaptura] = useState(true)
  const [tipo, setTipo] = useState<TipoSoporte>('ERROR')
  const [prioridad, setPrioridad] = useState('MEDIA')
  const [titulo, setTitulo] = useState('')
  const [descripcion, setDescripcion] = useState('')
  const [archivos, setArchivos] = useState<File[]>([])
  const [enviando, setEnviando] = useState(false)
  const [paso, setPaso] = useState('')

  useEffect(() => { if (pathname) registrarNavegacion(pathname) }, [pathname])

  // La captura se toma ANTES de abrir el formulario: así sale lo que el usuario veía.
  const abrir = useCallback(async () => {
    if (preparando) return
    setPreparando(true)
    try {
      const ctx = capturarContexto(moduloDeRuta(location.pathname))
      const img = await capturarPantalla()
      setContexto(ctx)
      setCaptura(img)
      setCapturaUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return img ? URL.createObjectURL(img) : null })
      setIncluirCaptura(!!img)
      if (ctx.errores.length > 0) setTipo('ERROR')
      setAbierta(true)
    } finally { setPreparando(false) }
  }, [preparando])

  useEffect(() => {
    const h = () => { abrir() }
    window.addEventListener(EVENTO_ABRIR_SOPORTE, h)
    return () => window.removeEventListener(EVENTO_ABRIR_SOPORTE, h)
  }, [abrir])

  const cerrar = useCallback(() => {
    if (enviando) return
    setAbierta(false)
  }, [enviando])

  function limpiar() {
    setTitulo(''); setDescripcion(''); setArchivos([]); setPrioridad('MEDIA'); setTipo('ERROR')
    setCaptura(null); setContexto(null)
    setCapturaUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return null })
  }

  function elegir(lista: FileList | null) {
    if (!lista) return
    const ok = Array.from(lista).filter((f) => {
      if (f.size > MAX_ADJUNTO_SOPORTE) { toast.error(`"${f.name}" supera 50 MB.`); return false }
      return true
    })
    setArchivos((prev) => [...prev, ...ok].slice(0, 6))
  }

  async function copiarPrompt() {
    if (!contexto) return
    const texto = construirPrompt({
      tipo, prioridad, titulo: titulo.trim() || '(sin título)', descripcion,
      modulo: contexto.modulo, ruta: contexto.url, contexto,
    })
    const ok = await copiarTexto(texto)
    if (ok) toast.success('Prompt copiado. Pégalo en Claude u otro chat (la captura no va en el texto: adjúntala aparte).')
    else toast.error('No se pudo copiar al portapapeles.')
  }

  async function enviar() {
    if (!contexto) return
    if (!titulo.trim()) { toast.error('Escribe un título corto: qué pasó o qué propones.'); return }
    setEnviando(true)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = createClient() as any
    const id = globalThis.crypto?.randomUUID?.()
    try {
      if (!id) throw new Error('Este navegador no permite generar el identificador del ticket.')
      let capturaPath: string | null = null
      if (incluirCaptura && captura) {
        setPaso('Subiendo captura de pantalla…')
        capturaPath = (await subirArchivoSoporte(sb, id, captura, 'captura.jpg')).path
      }
      const adjuntos: AdjuntoSubido[] = []
      for (let i = 0; i < archivos.length; i++) {
        setPaso(`Subiendo adjunto ${i + 1} de ${archivos.length}…`)
        adjuntos.push(await subirArchivoSoporte(sb, id, archivos[i], archivos[i].name))
      }
      setPaso('Creando ticket…')
      const { data, error } = await sb.rpc('soporte_crear', {
        p_id: id,
        p_tipo: tipo,
        p_prioridad: prioridad,
        p_titulo: titulo.trim(),
        p_descripcion: descripcion.trim() || null,
        p_ruta: contexto.url,
        p_modulo: contexto.modulo,
        p_contexto: contexto,
        p_captura: capturaPath,
        p_adjuntos: adjuntos,
      })
      if (error) throw new Error(error.message)
      toast.success(`Ticket ${data?.numero ?? ''} creado. Te avisaremos por el chat del ticket.`, {
        action: { label: 'Ver', onClick: () => router.push(`/soporte/${id}`) },
      })
      setAbierta(false)
      limpiar()
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se pudo crear el ticket.')
    } finally { setEnviando(false); setPaso('') }
  }

  return (
    <>
      <button
        onClick={abrir}
        disabled={preparando}
        data-soporte-ocultar
        className="relative p-2 rounded-lg hover:bg-gray-100 transition-colors disabled:opacity-60"
        aria-label="Reportar un error o pedir soporte"
        title="Reportar error · soporte · mejora"
      >
        {preparando ? <Loader2 className="w-5 h-5 text-gray-500 animate-spin" /> : <Bug className="w-5 h-5 text-gray-500" />}
      </button>

      <Hoja
        abierta={abierta}
        onClose={cerrar}
        titulo="Reportar / pedir soporte"
        icono={<Bug className="w-5 h-5 text-red-500" />}
        pie={
          <div className="space-y-2">
            {paso && <p className="text-xs text-gray-500 flex items-center gap-1.5"><Loader2 className="w-3 h-3 animate-spin" /> {paso}</p>}
            <div className="flex flex-wrap gap-2">
              <button onClick={copiarPrompt} disabled={!contexto}
                className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
                title="Copia todo lo capturado como prompt para Claude u otra IA">
                <Copy className="w-4 h-4" /> Copiar prompt
              </button>
              <Link href="/soporte" onClick={() => setAbierta(false)}
                className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm text-gray-500 hover:bg-gray-50">
                Mis tickets
              </Link>
              <button onClick={enviar} disabled={enviando}
                className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-brand-green px-4 py-2 text-sm font-semibold text-white hover:bg-brand-green-dark disabled:opacity-50">
                {enviando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Bug className="w-4 h-4" />} Enviar ticket
              </button>
            </div>
          </div>
        }
      >
        {/* Tipo */}
        <div className="grid grid-cols-3 gap-2">
          {(Object.keys(TIPO_SOPORTE_META) as TipoSoporte[]).map((t) => (
            <button key={t} onClick={() => setTipo(t)}
              className={`rounded-xl border px-2 py-2 text-left transition-colors ${tipo === t ? 'border-brand-green bg-brand-green/5 ring-2 ring-brand-green/20' : 'border-gray-200 hover:bg-gray-50'}`}>
              <span className="block text-sm font-semibold text-gray-900">{TIPO_SOPORTE_META[t].label}</span>
              <span className="block text-[11px] leading-tight text-gray-500">{TIPO_SOPORTE_META[t].desc}</span>
            </button>
          ))}
        </div>

        <div>
          <label className={labelMant}>Título *</label>
          <input value={titulo} onChange={(e) => setTitulo(e.target.value)} maxLength={200} className={inputMant}
            placeholder={tipo === 'MEJORA' ? 'Ej.: Poder filtrar el stock por bodega' : 'Ej.: Al guardar el movimiento sale un error'} autoFocus />
        </div>
        <div>
          <label className={labelMant}>{tipo === 'MEJORA' ? '¿Qué propones y para qué sirve?' : '¿Qué estabas haciendo y qué pasó?'}</label>
          <textarea value={descripcion} onChange={(e) => setDescripcion(e.target.value)} rows={4} className={inputMant}
            placeholder={tipo === 'MEJORA' ? 'Describe la idea…' : 'Pasos: 1) entré a… 2) di clic en… Esperaba… pero pasó…'} />
        </div>
        <div>
          <label className={labelMant}>Prioridad</label>
          <div className="flex gap-1.5">
            {PRIORIDADES_SOPORTE.map((p) => (
              <button key={p} onClick={() => setPrioridad(p)}
                className={`flex-1 rounded-lg px-2 py-1.5 text-xs font-semibold ${prioridad === p ? PRIORIDAD_SOPORTE_META[p].cls + ' ring-2 ring-offset-1 ring-gray-300' : 'bg-gray-50 text-gray-500 hover:bg-gray-100'}`}>
                {PRIORIDAD_SOPORTE_META[p].label}
              </button>
            ))}
          </div>
        </div>

        {/* Captura */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className={labelMant + ' !mb-0'}>Captura de pantalla</span>
            {captura && (
              <label className="flex items-center gap-1.5 text-xs text-gray-600">
                <input type="checkbox" checked={incluirCaptura} onChange={(e) => setIncluirCaptura(e.target.checked)} /> Incluir
              </label>
            )}
          </div>
          {capturaUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={capturaUrl} alt="Captura de la pantalla" className={`w-full max-h-48 object-contain rounded-lg border border-gray-100 bg-gray-50 ${incluirCaptura ? '' : 'opacity-30'}`} />
          ) : (
            <p className="flex items-center gap-1.5 text-xs text-gray-400"><ImageOff className="w-4 h-4" /> No se pudo tomar la captura en este navegador. Puedes adjuntar una.</p>
          )}
        </div>

        {/* Adjuntos */}
        <div>
          <span className={labelMant}>Fotos, video o archivos (opcional)</span>
          <div className="flex flex-wrap items-center gap-1.5">
            <label className="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs text-gray-600 hover:bg-gray-50">
              <Camera className="w-4 h-4" /> Cámara
              <input type="file" accept="image/*,video/*" capture="environment" className="hidden" onChange={(e) => { elegir(e.target.files); e.target.value = '' }} />
            </label>
            <label className="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs text-gray-600 hover:bg-gray-50">
              <Paperclip className="w-4 h-4" /> Archivos
              <input type="file" multiple className="hidden" onChange={(e) => { elegir(e.target.files); e.target.value = '' }} />
            </label>
            {archivos.map((f, i) => (
              <span key={`${f.name}-${i}`} className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-[11px] text-gray-600">
                <span className="max-w-[140px] truncate">{f.name}</span>
                <button onClick={() => setArchivos((a) => a.filter((_, j) => j !== i))} className="text-gray-400 hover:text-red-500" aria-label="Quitar">×</button>
              </span>
            ))}
          </div>
        </div>

        {/* Lo que se adjunta automáticamente */}
        {contexto && (
          <details className="rounded-xl bg-gray-50 px-3 py-2 text-xs text-gray-600">
            <summary className="cursor-pointer font-semibold text-gray-700">Datos técnicos que se adjuntan automáticamente</summary>
            <ul className="mt-2 space-y-1">
              <li className="flex items-center gap-1.5"><Globe className="w-3.5 h-3.5" /> {contexto.modulo ?? 'Sin módulo'} · {contexto.url}</li>
              <li className="flex items-center gap-1.5"><Terminal className="w-3.5 h-3.5" /> {contexto.consola.length} líneas de consola · <b className={contexto.errores.length ? 'text-red-600' : ''}>{contexto.errores.length} errores</b></li>
              <li className="flex items-center gap-1.5"><ListChecks className="w-3.5 h-3.5" /> {contexto.red.length} peticiones de red · <b className={contexto.red.some((r) => r.estado === null || r.estado >= 400) ? 'text-red-600' : ''}>{contexto.red.filter((r) => r.estado === null || r.estado >= 400).length} fallidas</b></li>
              <li className="flex items-center gap-1.5"><MousePointerClick className="w-3.5 h-3.5" /> {contexto.acciones.length} acciones recientes · navegador, pantalla y tu usuario</li>
            </ul>
            <p className="mt-2 text-[11px] text-gray-400">No se envían contraseñas, tokens ni lo que escribiste en los formularios.</p>
          </details>
        )}
      </Hoja>
    </>
  )
}

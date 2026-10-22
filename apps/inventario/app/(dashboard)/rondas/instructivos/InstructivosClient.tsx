'use client'

// Pantalla de instructivos. A diferencia del resto de /rondas, esta trabaja con
// el cliente de navegador y no con server actions, porque el archivo se SUBE
// DIRECTO al bucket (ADR-C: por un route handler propio pasaría todo el binario
// y el límite de cuerpo es de 4,5 MB) y porque leerlo necesita una URL firmada
// que caduca en 300 segundos, así que se pide en el momento de abrirla. Es el
// mismo patrón de /gestion-humana/plantillas.
//
// La RLS es la que manda: sin `gestionar_catalogo_rondas` el INSERT no entra y
// `ronda_instructivo_puede_subir()` rechaza la subida.

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  BookOpen, Plus, Save, Trash2, Upload, Loader2, Eye, X, Search, GitFork,
} from 'lucide-react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import {
  TIPOS_INSTRUCTIVO, TIPO_INSTRUCTIVO_LABEL, type TipoInstructivo,
} from '@/lib/ronda/pasos'

export interface InstructivoFila {
  id: string
  grupo_id: string | null
  tipo_actividad_id: string | null
  codigo: string
  version: number
  titulo: string
  tipo: TipoInstructivo
  momento: 'ANTES' | 'DURANTE'
  idioma: string
  archivo_path: string | null
  mime: string | null
  tamano: number | null
  duracion_seg: number | null
  texto: string | null
  estado: 'BORRADOR' | 'PUBLICADO' | 'ARCHIVADO'
  created_at: string
  actividad: { codigo: string; nombre: string } | null
  contrato: { codigo: string } | null
}

const campo = 'w-full rounded-lg border border-gray-200 px-3 py-2 font-body text-sm focus:border-brand-green focus:outline-none disabled:bg-gray-50'
const etiqueta = 'font-body text-[11px] font-semibold uppercase tracking-wide text-gray-400'

const ESTADO_BADGE: Record<InstructivoFila['estado'], string> = {
  BORRADOR: 'bg-amber-100 text-amber-700',
  PUBLICADO: 'bg-emerald-100 text-emerald-700',
  ARCHIVADO: 'bg-gray-200 text-gray-600',
}

/** Bytes a un texto corto: 1,4 MB. */
function tamanoCorto(bytes: number | null): string {
  if (!bytes) return '—'
  const mb = bytes / 1_048_576
  if (mb >= 1) return `${mb.toFixed(1).replace('.', ',')} MB`
  return `${Math.round(bytes / 1024)} kB`
}

export function InstructivosClient({
  instructivos, actividades, contratos, puedeGestionar,
}: {
  instructivos: InstructivoFila[]
  actividades: { id: string; codigo: string; nombre: string }[]
  contratos: { id: string; codigo: string; nombre: string }[]
  puedeGestionar: boolean
}) {
  const router = useRouter()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = createClient() as any

  const [abierto, setAbierto] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const [subiendo, setSubiendo] = useState<string | null>(null)
  const [busca, setBusca] = useState('')

  // Formulario de alta
  const [codigo, setCodigo] = useState('')
  const [titulo, setTitulo] = useState('')
  const [tipo, setTipo] = useState<TipoInstructivo>('VIDEO')
  const [momento, setMomento] = useState<'ANTES' | 'DURANTE'>('ANTES')
  const [idioma, setIdioma] = useState('es-CO')
  const [grupo, setGrupo] = useState('')
  const [actividad, setActividad] = useState('')
  const [texto, setTexto] = useState('')

  const filas = useMemo(() => {
    const q = busca.trim().toLowerCase()
    if (!q) return instructivos
    return instructivos.filter((i) =>
      `${i.codigo} ${i.titulo} ${i.texto ?? ''}`.toLowerCase().includes(q))
  }, [instructivos, busca])

  function limpiar() {
    setCodigo(''); setTitulo(''); setTipo('VIDEO'); setMomento('ANTES')
    setIdioma('es-CO'); setGrupo(''); setActividad(''); setTexto('')
    setAbierto(false)
  }

  async function crear() {
    const cod = codigo.trim().toUpperCase().replace(/\s+/g, '_')
    if (!/^[A-Z0-9_]{2,40}$/.test(cod)) {
      toast.error('El código va en MAYÚSCULAS, sin tildes ni espacios, de 2 a 40 caracteres.')
      return
    }
    if (!titulo.trim()) { toast.error('El título es obligatorio.'); return }

    setGuardando(true)
    const { error } = await sb.from('ronda_instructivos').insert({
      grupo_id: grupo || null,
      tipo_actividad_id: actividad || null,
      codigo: cod,
      version: 1,
      titulo: titulo.trim(),
      tipo,
      momento,
      idioma: idioma.trim() || 'es-CO',
      texto: texto.trim() || null,
      estado: 'BORRADOR',
    })
    setGuardando(false)
    if (error) {
      toast.error(error.message.includes('ux_ronda_instructivos')
        ? 'Ya hay un instructivo con ese código en ese ámbito.'
        : error.message)
      return
    }
    toast.success('Instructivo creado. Ahora súbele el archivo.')
    limpiar()
    router.refresh()
  }

  /** Sube el archivo a `instructivos/{id}/…` y completa la ficha. */
  async function subir(fila: InstructivoFila, file: File) {
    setSubiendo(fila.id)
    const ext = (file.name.split('.').pop() || 'bin').toLowerCase()
    const path = `instructivos/${fila.id}/${fila.codigo.toLowerCase()}-v${fila.version}.${ext}`

    const up = await sb.storage.from('rondas')
      .upload(path, file, { upsert: true, contentType: file.type || undefined })
    if (up.error) {
      setSubiendo(null)
      toast.error(up.error.message.includes('row-level security') || up.error.message.includes('Unauthorized')
        ? 'La base no te deja subir a esa carpeta.'
        : up.error.message)
      return
    }

    // La duración solo se puede medir en el navegador, y solo para audio y
    // video: el <video> también sirve para leer la de un audio.
    let duracion: number | null = null
    if (fila.tipo === 'VIDEO' || fila.tipo === 'AUDIO') {
      duracion = await medirDuracion(file).catch(() => null)
    }

    const { error } = await sb.from('ronda_instructivos').update({
      archivo_path: path,
      mime: file.type || null,
      tamano: file.size,
      duracion_seg: duracion,
    }).eq('id', fila.id)
    setSubiendo(null)
    if (error) { toast.error(error.message); return }
    toast.success('Archivo subido')
    router.refresh()
  }

  /** Abre el archivo con una URL firmada de 300 s, como manda el ADR-C. */
  async function ver(fila: InstructivoFila) {
    if (!fila.archivo_path) { toast.error('Este instructivo todavía no tiene archivo.'); return }
    const { data, error } = await sb.storage.from('rondas')
      .createSignedUrl(fila.archivo_path, 300)
    if (error || !data?.signedUrl) { toast.error('No se pudo abrir el archivo.'); return }
    window.open(data.signedUrl, '_blank', 'noopener')
  }

  async function cambiarEstado(fila: InstructivoFila, estado: InstructivoFila['estado']) {
    if (estado === 'PUBLICADO' && !fila.archivo_path) {
      toast.error('No se puede publicar un instructivo sin archivo.')
      return
    }
    const { error } = await sb.from('ronda_instructivos').update({ estado }).eq('id', fila.id)
    if (error) { toast.error(error.message); return }
    router.refresh()
  }

  /** Versión nueva del mismo código: fila nueva, archivo nuevo. */
  async function nuevaVersion(fila: InstructivoFila) {
    const siguiente = Math.max(...instructivos
      .filter((i) => i.codigo === fila.codigo && i.grupo_id === fila.grupo_id)
      .map((i) => i.version)) + 1
    const { error } = await sb.from('ronda_instructivos').insert({
      grupo_id: fila.grupo_id,
      tipo_actividad_id: fila.tipo_actividad_id,
      codigo: fila.codigo,
      version: siguiente,
      titulo: fila.titulo,
      tipo: fila.tipo,
      momento: fila.momento,
      idioma: fila.idioma,
      texto: fila.texto,
      estado: 'BORRADOR',
    })
    if (error) { toast.error(error.message); return }
    toast.success(`Versión ${siguiente} creada. Súbele el archivo nuevo.`)
    router.refresh()
  }

  async function borrar(fila: InstructivoFila) {
    if (!confirm(`¿Borrar ${fila.codigo} v${fila.version}? Si algún paso lo usa, la base no lo va a permitir.`)) return
    const { error } = await sb.from('ronda_instructivos').delete().eq('id', fila.id)
    if (error) {
      toast.error(error.message.includes('foreign key')
        ? 'No se puede borrar: hay pasos que lo están usando.'
        : error.message)
      return
    }
    if (fila.archivo_path) await sb.storage.from('rondas').remove([fila.archivo_path])
    router.refresh()
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[12rem]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input value={busca} onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar instructivo…" className={`${campo} pl-8`} />
        </div>
        {puedeGestionar && !abierto && (
          <button onClick={() => setAbierto(true)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-brand-green px-3 py-2 font-body text-sm font-semibold text-white">
            <Plus className="w-4 h-4" /> Nuevo instructivo
          </button>
        )}
      </div>

      {abierto && (
        <div className="rounded-lg border border-gray-200 bg-white p-4 sm:p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-heading font-semibold text-gray-900">Nuevo instructivo</h2>
            <button onClick={limpiar} className="text-gray-400 hover:text-gray-600">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <label className="space-y-1">
              <span className={etiqueta}>Código</span>
              <input value={codigo} onChange={(e) => setCodigo(e.target.value)}
                placeholder="LAVADO_BANO" className={campo} />
            </label>
            <label className="space-y-1">
              <span className={etiqueta}>Título</span>
              <input value={titulo} onChange={(e) => setTitulo(e.target.value)}
                placeholder="Cómo se lava un baño" className={campo} />
            </label>
            <label className="space-y-1">
              <span className={etiqueta}>Formato</span>
              <select value={tipo} onChange={(e) => setTipo(e.target.value as TipoInstructivo)} className={campo}>
                {TIPOS_INSTRUCTIVO.map((t) => (
                  <option key={t} value={t}>{TIPO_INSTRUCTIVO_LABEL[t]}</option>
                ))}
              </select>
            </label>
            <label className="space-y-1">
              <span className={etiqueta}>Actividad</span>
              <select value={actividad} onChange={(e) => setActividad(e.target.value)} className={campo}>
                <option value="">Sin actividad (se asocia a un paso)</option>
                {actividades.map((a) => <option key={a.id} value={a.id}>{a.nombre}</option>)}
              </select>
            </label>
            <label className="space-y-1">
              <span className={etiqueta}>Contrato</span>
              <select value={grupo} onChange={(e) => setGrupo(e.target.value)} className={campo}>
                <option value="">Todos los contratos</option>
                {contratos.map((c) => <option key={c.id} value={c.id}>{c.codigo} · {c.nombre}</option>)}
              </select>
            </label>
            <label className="space-y-1">
              <span className={etiqueta}>Cuándo se muestra</span>
              <select value={momento} onChange={(e) => setMomento(e.target.value as 'ANTES' | 'DURANTE')}
                className={campo}>
                <option value="ANTES">Antes de la actividad</option>
                <option value="DURANTE">Durante la actividad</option>
              </select>
            </label>
            <label className="space-y-1">
              <span className={etiqueta}>Idioma</span>
              <input value={idioma} onChange={(e) => setIdioma(e.target.value)} className={campo} />
            </label>
            <label className="space-y-1 sm:col-span-2">
              <span className={etiqueta}>Transcripción o descripción</span>
              <input value={texto} onChange={(e) => setTexto(e.target.value)} className={campo}
                placeholder="Para buscar, para el bot y para quien no pueda ver el video" />
            </label>
          </div>
          <div className="flex justify-end">
            <button onClick={crear} disabled={guardando}
              className="inline-flex items-center gap-1.5 rounded-lg bg-brand-green px-3 py-2 font-body text-sm font-semibold text-white disabled:opacity-60">
              {guardando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Crear
            </button>
          </div>
        </div>
      )}

      {filas.length === 0 ? (
        <p className="font-body text-sm text-gray-500 rounded-lg border border-gray-200 bg-white p-6">
          No hay instructivos todavía.
        </p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
          <table className="w-full text-left">
            <thead className="bg-gray-50">
              <tr className="font-body text-[11px] uppercase tracking-wide text-gray-500">
                <th className="px-4 py-2.5">Instructivo</th>
                <th className="px-4 py-2.5 hidden sm:table-cell">Formato</th>
                <th className="px-4 py-2.5">Estado</th>
                <th className="px-4 py-2.5 hidden lg:table-cell">Actividad</th>
                <th className="px-4 py-2.5 hidden md:table-cell">Archivo</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filas.map((i) => (
                <tr key={i.id} className={i.estado === 'ARCHIVADO' ? 'bg-gray-50/60' : undefined}>
                  <td className="px-4 py-3">
                    <p className="font-body text-sm font-semibold text-gray-900 inline-flex items-center gap-1.5">
                      <BookOpen className="w-3.5 h-3.5 text-gray-400" /> {i.titulo}
                    </p>
                    <p className="font-body text-xs text-gray-400">
                      {i.codigo} · v{i.version} · {i.idioma}
                      {i.contrato ? ` · ${i.contrato.codigo}` : ''}
                    </p>
                  </td>
                  <td className="px-4 py-3 hidden sm:table-cell font-body text-sm text-gray-600">
                    {TIPO_INSTRUCTIVO_LABEL[i.tipo]}
                    {i.duracion_seg ? ` · ${i.duracion_seg} s` : ''}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 font-body text-[11px] font-semibold ${ESTADO_BADGE[i.estado]}`}>
                      {i.estado.charAt(0) + i.estado.slice(1).toLowerCase()}
                    </span>
                  </td>
                  <td className="px-4 py-3 hidden lg:table-cell font-body text-sm text-gray-600">
                    {i.actividad?.nombre ?? <span className="text-gray-400">Por paso</span>}
                  </td>
                  <td className="px-4 py-3 hidden md:table-cell font-body text-sm text-gray-600">
                    {i.archivo_path
                      ? tamanoCorto(i.tamano)
                      : <span className="text-amber-600">Falta el archivo</span>}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-2">
                      {i.archivo_path && (
                        <button onClick={() => ver(i)} title="Abrir (enlace firmado, 5 minutos)"
                          className="inline-flex text-gray-400 hover:text-brand-green">
                          <Eye className="w-4 h-4" />
                        </button>
                      )}
                      {puedeGestionar && (
                        <>
                          <label className="inline-flex cursor-pointer text-gray-400 hover:text-brand-green"
                            title="Subir o reemplazar el archivo">
                            {subiendo === i.id
                              ? <Loader2 className="w-4 h-4 animate-spin" />
                              : <Upload className="w-4 h-4" />}
                            <input type="file" className="hidden"
                              onChange={(e) => {
                                const f = e.target.files?.[0]
                                if (f) subir(i, f)
                                e.target.value = ''
                              }} />
                          </label>
                          {i.estado === 'BORRADOR' && (
                            <button onClick={() => cambiarEstado(i, 'PUBLICADO')}
                              className="font-body text-xs font-semibold text-brand-green hover:underline">
                              Publicar
                            </button>
                          )}
                          {i.estado === 'PUBLICADO' && (
                            <>
                              <button onClick={() => nuevaVersion(i)} title="Versión nueva"
                                className="inline-flex text-gray-400 hover:text-brand-green">
                                <GitFork className="w-4 h-4" />
                              </button>
                              <button onClick={() => cambiarEstado(i, 'ARCHIVADO')}
                                className="font-body text-xs font-semibold text-gray-500 hover:underline">
                                Archivar
                              </button>
                            </>
                          )}
                          <button onClick={() => borrar(i)}
                            className="inline-flex text-gray-400 hover:text-red-600">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

/** Duración de un audio o un video, leída del propio archivo en el navegador. */
function medirDuracion(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const el = document.createElement('video')
    el.preload = 'metadata'
    el.onloadedmetadata = () => {
      URL.revokeObjectURL(url)
      resolve(Number.isFinite(el.duration) && el.duration > 0 ? Math.round(el.duration) : null)
    }
    el.onerror = () => { URL.revokeObjectURL(url); resolve(null) }
    el.src = url
  })
}

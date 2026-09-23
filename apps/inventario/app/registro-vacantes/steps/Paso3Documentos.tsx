'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Loader2, Upload, Check, Trash2, FileText, Camera, ArrowRight, AlertCircle, UserRound } from 'lucide-react'
import { toast } from 'sonner'
import type { WizardCtx } from '../RegistroWizard'
import { fetchTiposDocumentales } from '@/lib/registro/datos'
import {
  subirDocumento, listarDocumentos, eliminarDocumento, tipoAplica, fetchCargoFlags,
  marcarFotoPerfil, urlFotoPerfil,
  type DocumentoSubido,
} from '@/lib/registro/documentos'
import type { TipoDocumental } from '@/lib/registro/tipos'
import { getSupabase } from '@/lib/supabase/anon'
import { BotonesFoto } from '@/components/foto/BotonesFoto'
import { MiniaturaArchivo } from '@/components/documentos/MiniaturaArchivo'
import { VisorArchivo, type ArchivoVisible } from '@/components/documentos/VisorArchivo'
import { useUrlsFirmadas } from '@/components/documentos/useUrlsFirmadas'

const GRUPOS: Record<string, string> = {
  PERSONALES: 'Documentos personales',
  ESTUDIOS: 'Estudios',
  ANTECEDENTES: 'Antecedentes',
  REFERENCIAS: 'Referencias',
}

export function Paso3Documentos({ ctx }: { ctx: WizardCtx }) {
  const { candidatoId, form, next, prev } = ctx
  const [tipos, setTipos] = useState<TipoDocumental[]>([])
  const [docs, setDocs] = useState<DocumentoSubido[]>([])
  const [cargoFlags, setCargoFlags] = useState<Record<string, boolean> | null>(null)
  const [cargando, setCargando] = useState(true)
  const sb = useMemo(() => getSupabase(), [])
  const urls = useUrlsFirmadas(sb, docs.map((x) => x.storage_path))
  const [visor, setVisor] = useState<{ archivos: ArchivoVisible[]; inicial: number } | null>(null)

  useEffect(() => {
    if (!candidatoId) return
    ;(async () => {
      const [t, d, f] = await Promise.all([
        fetchTiposDocumentales(1),
        listarDocumentos(candidatoId),
        form.cargo_postulacion_id ? fetchCargoFlags(form.cargo_postulacion_id) : Promise.resolve({}),
      ])
      setTipos(t); setDocs(d); setCargoFlags(f)
      setCargando(false)
    })()
  }, [candidatoId, form.cargo_postulacion_id])

  const visibles = useMemo(
    () => tipos.filter((t) => tipoAplica(t, cargoFlags)),
    [tipos, cargoFlags]
  )
  const porGrupo = useMemo(() => {
    const g: Record<string, TipoDocumental[]> = {}
    for (const t of visibles) (g[t.grupo] ??= []).push(t)
    return g
  }, [visibles])

  const docsDe = (tipoId: string) => docs.filter((d) => d.tipo_documental_id === tipoId)

  const obligatoriosPendientes = visibles.filter(
    (t) => t.obligatorio && docsDe(t.id).length < t.min_archivos
  )

  function onSubido(doc: DocumentoSubido) { setDocs((p) => [...p, doc]) }
  async function onEliminar(doc: DocumentoSubido) {
    await eliminarDocumento(doc)
    setDocs((p) => p.filter((d) => d.id !== doc.id))
  }

  function continuar() {
    if (obligatoriosPendientes.length > 0) {
      toast.error('Te faltan documentos obligatorios (marcados en rojo).')
      return
    }
    next()
  }

  if (cargando) {
    return <div className="flex justify-center py-16"><Loader2 className="h-7 w-7 animate-spin text-brand-green" /></div>
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-heading text-xl font-bold text-gray-900">Sube tus documentos</h2>
        <p className="mt-1 text-sm text-gray-500">
          Toma una foto clara o sube el archivo. Puedes hacerlo por partes.
        </p>
      </div>

      {Object.entries(porGrupo).map(([grupo, lista]) => (
        <section key={grupo} className="space-y-3">
          <h3 className="font-heading text-sm font-bold uppercase tracking-wide text-gray-400">
            {GRUPOS[grupo] ?? grupo}
          </h3>
          {lista.map((tipo) => {
            const Tarjeta = tipo.codigo === 'FOTO_CARNET' ? FotoCard : TipoCard
            return (
              <Tarjeta
                key={tipo.id}
                tipo={tipo}
                candidatoId={candidatoId!}
                docs={docsDe(tipo.id)}
                urls={urls}
                onAbrir={(docsTipo, i) => setVisor({
                  inicial: i,
                  archivos: docsTipo.map((x) => ({ url: urls[x.storage_path] ?? null, nombre: x.nombre_original ?? tipo.nombre, mime: x.mime, grupo: tipo.nombre })),
                })}
                onSubido={onSubido}
                onEliminar={onEliminar}
              />
            )
          })}
        </section>
      ))}

      {visor && <VisorArchivo archivos={visor.archivos} inicial={visor.inicial} onCerrar={() => setVisor(null)} />}

      <div className="flex gap-3 pt-2">
        <button type="button" onClick={prev} className="rounded-xl border border-gray-300 px-5 py-3 font-body font-semibold text-gray-600">Atrás</button>
        <button type="button" onClick={continuar}
          className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-brand-green py-3 font-body text-base font-semibold text-white hover:bg-brand-green-dark">
          Continuar a revisión <ArrowRight className="h-5 w-5" />
        </button>
      </div>
    </div>
  )
}

interface PropsTarjeta {
  tipo: TipoDocumental; candidatoId: string; docs: DocumentoSubido[]
  urls: Record<string, string>; onAbrir: (docs: DocumentoSubido[], i: number) => void
  onSubido: (d: DocumentoSubido) => void; onEliminar: (d: DocumentoSubido) => void | Promise<void>
}

/**
 * Foto de perfil (tipo carné): se toma con la cámara o se sube, se ve de una
 * vez y queda como la foto del candidato en el expediente y en los formatos.
 */
function FotoCard({ tipo, candidatoId, docs, onSubido, onEliminar }: PropsTarjeta) {
  const actual = docs[docs.length - 1] ?? null
  const faltante = tipo.obligatorio && docs.length < tipo.min_archivos
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    let vivo = true
    if (!actual) { setUrl(null); return }
    void urlFotoPerfil(actual.storage_path, 900).then((u) => { if (vivo) setUrl(u) })
    return () => { vivo = false }
  }, [actual])

  async function guardar(file: File) {
    const r = await subirDocumento(candidatoId, tipo, file, docs.length + 1)
    if (r.error || !r.doc) { toast.error(r.error ?? 'No se pudo guardar la foto.'); return }
    await marcarFotoPerfil(candidatoId, r.doc.storage_path)
    const anteriores = docs
    onSubido(r.doc)
    // La foto nueva reemplaza a la anterior.
    for (const d of anteriores) await onEliminar(d)
    toast.success('Foto de perfil guardada.')
  }

  return (
    <div className={'rounded-xl border p-4 ' + (faltante ? 'border-red-300 bg-red-50/40' : 'border-gray-200')}>
      <div className="flex gap-4">
        <div className="h-28 w-[84px] shrink-0 overflow-hidden rounded-lg border border-gray-200 bg-gray-50">
          {url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={url} alt="Tu foto de perfil" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center"><UserRound className="h-9 w-9 text-gray-300" /></div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p className="font-body text-sm font-semibold text-gray-800">
              {tipo.nombre} {tipo.obligatorio && <span className="text-red-500">*</span>}
            </p>
            {actual ? (
              <span className="flex shrink-0 items-center gap-1 rounded-full bg-brand-green/10 px-2 py-1 text-xs font-semibold text-brand-green">
                <Check className="h-3.5 w-3.5" /> Lista
              </span>
            ) : faltante ? (
              <span className="flex shrink-0 items-center gap-1 text-xs font-semibold text-red-500">
                <AlertCircle className="h-3.5 w-3.5" /> Falta
              </span>
            ) : null}
          </div>
          <p className="mt-0.5 text-xs text-gray-600">{tipo.descripcion ?? 'De frente, con buena luz y fondo claro.'}</p>
          <div className="mt-3">
            <BotonesFoto onFoto={guardar} compacto
              textoTomar={actual ? 'Tomar otra' : 'Tomar mi foto'} textoSubir={actual ? 'Cambiar foto' : 'Subir una foto'} />
          </div>
        </div>
      </div>
    </div>
  )
}

function TipoCard({ tipo, candidatoId, docs, urls, onAbrir, onSubido, onEliminar }: PropsTarjeta) {
  const [subiendo, setSubiendo] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const fotoRef = useRef<HTMLInputElement>(null)
  const completo = docs.length >= tipo.min_archivos
  const lleno = docs.length >= tipo.max_archivos
  const faltante = tipo.obligatorio && !completo
  // Etiqueta especial para cédula (frente/reverso)
  const etiquetaSlot = (i: number) =>
    tipo.codigo === 'CEDULA' ? (i === 0 ? ' (frente)' : ' (reverso)') : ''

  async function subirArchivo(file: File) {
    setSubiendo(true)
    const r = await subirDocumento(candidatoId, tipo, file, docs.length + 1)
    setSubiendo(false)
    if (r.error) { toast.error(r.error); return }
    if (!r.doc) return
    onSubido(r.doc)
    toast.success('Documento cargado.')
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (file) await subirArchivo(file)
  }

  return (
    <div className={'rounded-xl border p-4 ' + (faltante ? 'border-red-300 bg-red-50/40' : 'border-gray-200')}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-body text-sm font-semibold text-gray-800">
            {tipo.nombre} {tipo.obligatorio && <span className="text-red-500">*</span>}
          </p>
          {tipo.descripcion && <p className="mt-0.5 text-xs text-gray-600">{tipo.descripcion}</p>}
          <p className="mt-0.5 text-xs text-gray-500">
            {tipo.min_archivos === tipo.max_archivos
              ? `${tipo.max_archivos} archivo${tipo.max_archivos > 1 ? 's' : ''}`
              : `De ${tipo.min_archivos} a ${tipo.max_archivos} archivos`}
            {tipo.vigencia_dias ? ` · vigencia máx. ${tipo.vigencia_dias} días` : ''}
          </p>
        </div>
        {completo ? (
          <span className="flex shrink-0 items-center gap-1 rounded-full bg-brand-green/10 px-2 py-1 text-xs font-semibold text-brand-green">
            <Check className="h-3.5 w-3.5" /> Listo
          </span>
        ) : faltante ? (
          <span className="flex shrink-0 items-center gap-1 text-xs font-semibold text-red-500">
            <AlertCircle className="h-3.5 w-3.5" /> Falta
          </span>
        ) : null}
      </div>

      {docs.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {docs.map((d, i) => (
            <li key={d.id} className="flex items-center justify-between gap-2 rounded-lg bg-gray-50 px-2 py-2">
              <span className="flex min-w-0 items-center gap-2.5 text-xs text-gray-600">
                <MiniaturaArchivo url={urls[d.storage_path] ?? null} nombre={d.nombre_original ?? 'archivo'} mime={d.mime} tamano="sm" onAbrir={() => onAbrir(docs, i)} />
                <span className="truncate">{d.nombre_original ?? `Archivo${etiquetaSlot(i)}`}{etiquetaSlot(i)}</span>
              </span>
              <button type="button" onClick={() => onEliminar(d)} className="shrink-0 text-red-400 hover:text-red-600">
                <Trash2 className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {!lleno && (
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => fotoRef.current?.click()}
            disabled={subiendo}
            className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-brand-green/10 py-2.5 text-sm font-semibold text-brand-green disabled:opacity-50"
          >
            {subiendo ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Camera className="h-4 w-4" /> Tomar foto{etiquetaSlot(docs.length)}</>}
          </button>
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={subiendo}
            className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-dashed border-brand-green/60 py-2.5 text-sm font-semibold text-brand-green disabled:opacity-50"
          >
            <Upload className="h-4 w-4" /> Seleccionar archivo
          </button>
        </div>
      )}
      {/* Dos entradas: con `capture` el celular abre directo la cámara; sin él deja escoger un archivo o PDF. */}
      <input ref={fotoRef} type="file" accept="image/*" capture="environment" hidden onChange={onFile} />
      <input ref={inputRef} type="file" accept="image/*,application/pdf,.heic,.doc,.docx" hidden onChange={onFile} />
    </div>
  )
}

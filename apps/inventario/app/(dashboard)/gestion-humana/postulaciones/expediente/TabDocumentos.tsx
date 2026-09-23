'use client'

import { useMemo, useRef, useState } from 'react'
import { Eye, Check, Ban, Sparkles, Upload, Loader2, RefreshCw, AlertTriangle, FileText, CheckCircle2 } from 'lucide-react'
import { toast } from 'sonner'
import { logActivity } from '@/lib/activity'
import { tipoAplicaCargo } from '@/lib/ats/fases'
import { MiniaturaArchivo } from '@/components/documentos/MiniaturaArchivo'
import { VisorArchivo, type ArchivoVisible } from '@/components/documentos/VisorArchivo'
import { useUrlsFirmadas } from '@/components/documentos/useUrlsFirmadas'
import { DOC_ESTADO } from '../estados'
import { subirDocumentoStaff } from '../acciones'
import { Seccion, Boton, Badge, fechaCorta } from '../ui'
import type { PropsTab } from './tipos'
import type { TipoDocOpcion } from '../tipos'

/* eslint-disable @typescript-eslint/no-explicit-any */

const GRUPOS: Record<string, string> = {
  PERSONALES: 'Documentos personales', ESTUDIOS: 'Estudios y cursos', ANTECEDENTES: 'Antecedentes',
  REFERENCIAS: 'Referencias', VINCULACION: 'Vinculación', CONTRATACION: 'Contratación (escaneados)',
}
const OLAS: Record<number, string> = { 1: 'Registro (los sube el candidato)', 2: 'Vinculación (preseleccionado)', 3: 'Ingreso (los carga RRHH)' }

const norm = (s: unknown) => String(s ?? '').normalize('NFD').replace(/\p{M}/gu, '').replace(/[^a-z0-9]/gi, '').toUpperCase()

/** Compara lo que leyó la IA con lo que digitó el candidato. */
function cruces(ocr: any, c: any, grupo?: string) {
  const f = ocr?.campos ?? {}
  const out: { label: string; ocr: string; ok: boolean }[] = []
  const push = (label: string, v: string, form: string, flexible = false) => {
    if (!v) return
    const ok = flexible ? norm(form).includes(norm(v)) || norm(v).includes(norm(form)) : norm(v) === norm(form)
    out.push({ label, ocr: v, ok })
  }
  push('Documento', f.numero_documento?.valor, c.numero_documento)
  push('Nombres', f.nombres?.valor, c.nombres, true)
  push('Apellidos', f.apellidos?.valor, c.apellidos, true)
  push('Nacimiento', f.fecha_nacimiento?.valor, c.fecha_nacimiento)
  if (grupo === 'ANTECEDENTES' && f.fecha_expedicion?.valor) {
    const dias = Math.floor((Date.now() - new Date(f.fecha_expedicion.valor).getTime()) / 86400000)
    out.push({ label: 'Expedición', ocr: `${f.fecha_expedicion.valor} (${dias} días)`, ok: dias <= 30 })
  }
  return out
}

/**
 * Documentos del candidato por olas: el registro (etapa de Postulación) o la
 * vinculación e ingreso (etapa de Contratación). Cada archivo tiene su
 * miniatura; al tocarla se abre a pantalla completa.
 */
export function TabDocumentos({
  d, sb, catalogos, puedeGestionar, recargar, onCambio, olas = [1, 2, 3],
}: PropsTab & { olas?: number[] }) {
  const [analizando, setAnalizando] = useState<string | null>(null)
  const [recargando, setRecargando] = useState(false)
  const [visor, setVisor] = useState<{ archivos: ArchivoVisible[]; inicial: number } | null>(null)
  const flags = catalogos.cargos.find((x) => x.id === d.c.cargo_postulacion_id) as unknown as Record<string, unknown> | undefined

  const tipos = useMemo(
    () => catalogos.tipos.filter((t) => t.activo !== false && olas.includes(t.ola) && tipoAplicaCargo(t, flags)),
    [catalogos.tipos, flags, olas],
  )
  const docsDe = (tipoId: string) => d.docs.filter((x) => x.tipo_documental_id === tipoId)
  const visibles = d.docs.filter((x) => tipos.some((t) => t.id === x.tipo_documental_id))
  const urls = useUrlsFirmadas(sb, visibles.map((x) => x.storage_path))
  const faltan = tipos.filter((t) => t.obligatorio && docsDe(t.id).filter((x) => x.estado !== 'RECHAZADO').length < Math.max(1, t.min_archivos))

  function abrir(tipo: TipoDocOpcion, docs: any[], i: number) {
    setVisor({
      inicial: i,
      archivos: docs.map((doc, j) => ({
        url: urls[doc.storage_path] ?? null, mime: doc.mime,
        nombre: doc.nombre_original ?? `${tipo.nombre} ${j + 1}`, grupo: `${tipo.nombre} · ${DOC_ESTADO[doc.estado]?.label ?? doc.estado}`,
      })),
    })
    void logActivity(sb, { accion: 'VER', modulo: 'Postulaciones', descripcion: `Documento visto de ${d.c.nombres} ${d.c.apellidos}`, entidad: 'candidato_documentos', entidad_id: docs[i]?.id })
  }

  async function validar(doc: any, aprobar: boolean) {
    let motivo: string | null = null
    if (!aprobar) {
      motivo = window.prompt('Motivo del rechazo (el candidato lo verá para volver a subirlo):') || null
      if (!motivo) return
    }
    const { error } = await sb.from('candidato_documentos').update({
      estado: aprobar ? 'VALIDADO' : 'RECHAZADO', motivo_rechazo: motivo, validado_por: d.yo.id, validado_at: new Date().toISOString(),
    }).eq('id', doc.id)
    if (error) { toast.error(error.message); return }
    toast.success(aprobar ? 'Documento validado.' : 'Documento rechazado.')
    await recargar(); onCambio()
  }

  async function analizar(doc: any) {
    setAnalizando(doc.id)
    try {
      const res = await fetch('/api/gestion-humana/postulaciones/ocr', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ docId: doc.id }),
      })
      const j = await res.json()
      if (!res.ok) { toast.error(j.error ?? 'No se pudo analizar.'); return }
      toast.success('Documento analizado con IA.')
      await recargar()
    } finally { setAnalizando(null) }
  }

  async function refrescar() {
    setRecargando(true)
    await recargar()
    setRecargando(false)
  }

  const grupos = olas.map((ola) => ({ ola, tipos: tipos.filter((t) => t.ola === ola) })).filter((g) => g.tipos.length)
  const nombreOlas = olas.length === 1 && olas[0] === 1 ? 'del registro' : 'de vinculación e ingreso'

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-gray-600"><strong>{visibles.length}</strong> archivo(s) cargado(s) · toque una miniatura para verla en grande</p>
        <Boton variante="secundario" onClick={refrescar} disabled={recargando}>
          {recargando ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Recargar
        </Boton>
      </div>

      {faltan.length > 0 ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          <p className="flex items-center gap-1 font-semibold"><AlertTriangle className="h-4 w-4" /> Faltan {faltan.length} documento(s) obligatorio(s) {nombreOlas}:</p>
          <p className="mt-1 text-xs">{faltan.map((t) => t.nombre).join(' · ')}</p>
          {puedeGestionar && <p className="mt-1 text-xs">Si el candidato los entregó en físico, cárguelos aquí abajo en su tipo.</p>}
        </div>
      ) : (
        <p className="flex items-center gap-1.5 rounded-xl bg-green-50 p-3 text-sm text-green-800"><CheckCircle2 className="h-4 w-4" /> Documentos obligatorios {nombreOlas} completos.</p>
      )}

      {grupos.map(({ ola, tipos: lista }) => (
        <Seccion key={ola} titulo={OLAS[ola]} icono={<FileText className="h-4 w-4 text-brand-green" />}>
          <div className="space-y-2">
            {lista.map((t) => (
              <TipoFila key={t.id} tipo={t} docs={docsDe(t.id)} c={d.c} urls={urls} puedeGestionar={puedeGestionar}
                analizando={analizando} onAbrir={(docs, i) => abrir(t, docs, i)} onValidar={validar} onAnalizar={analizar}
                onSubir={async (file) => {
                  const r = await subirDocumentoStaff(sb, d.c.id, t, file)
                  if (r.error) { toast.error(r.error); return }
                  toast.success('Documento cargado.')
                  await recargar(); onCambio()
                }} />
            ))}
          </div>
        </Seccion>
      ))}

      {visor && <VisorArchivo archivos={visor.archivos} inicial={visor.inicial} onCerrar={() => setVisor(null)} />}
    </div>
  )
}

function TipoFila({
  tipo, docs, c, urls, puedeGestionar, analizando, onAbrir, onValidar, onAnalizar, onSubir,
}: {
  tipo: TipoDocOpcion; docs: any[]; c: any; urls: Record<string, string>; puedeGestionar: boolean; analizando: string | null
  onAbrir: (docs: any[], i: number) => void; onValidar: (d: any, ok: boolean) => void; onAnalizar: (d: any) => void; onSubir: (f: File) => Promise<void>
}) {
  const ref = useRef<HTMLInputElement>(null)
  const [subiendo, setSubiendo] = useState(false)
  const vigentes = docs.filter((x) => x.estado !== 'RECHAZADO').length
  const completo = vigentes >= Math.max(1, tipo.min_archivos)
  return (
    <div className={'rounded-lg border p-2.5 ' + (tipo.obligatorio && !completo ? 'border-red-200 bg-red-50/30' : 'border-gray-100')}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-gray-800">
            {tipo.nombre} {tipo.obligatorio && <span className="text-red-500">*</span>}
            <span className="ml-1.5 text-xs font-normal text-gray-400">{GRUPOS[tipo.grupo] ?? tipo.grupo}{tipo.vigencia_dias ? ` · vigencia ${tipo.vigencia_dias} días` : ''}</span>
          </p>
          {tipo.descripcion && <p className="text-xs text-gray-500">{tipo.descripcion}</p>}
        </div>
        <div className="flex items-center gap-1.5">
          {completo ? <Badge className="bg-green-100 text-green-700">{vigentes} archivo(s)</Badge> : tipo.obligatorio ? <Badge className="bg-red-100 text-red-700">Falta</Badge> : <Badge className="bg-gray-100 text-gray-500">Opcional</Badge>}
          {puedeGestionar && (
            <>
              <button type="button" onClick={() => ref.current?.click()} disabled={subiendo}
                className="inline-flex items-center gap-1 rounded-md border border-brand-green/40 px-2 py-1 text-xs font-semibold text-brand-green hover:bg-brand-green/5 disabled:opacity-50">
                {subiendo ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />} Cargar
              </button>
              <input ref={ref} type="file" hidden accept="image/*,application/pdf,.doc,.docx,.heic"
                onChange={async (e) => {
                  const f = e.target.files?.[0]; e.target.value = ''
                  if (!f) return
                  setSubiendo(true); await onSubir(f); setSubiendo(false)
                }} />
            </>
          )}
        </div>
      </div>

      {docs.length > 0 && (
        <ul className="mt-2 space-y-1.5">
          {docs.map((doc, i) => {
            const de = DOC_ESTADO[doc.estado] ?? DOC_ESTADO.CARGADO
            const filas = doc.ocr_resultado ? cruces(doc.ocr_resultado, c, tipo.grupo) : []
            return (
              <li key={doc.id} className="flex gap-2.5 rounded-md bg-gray-50 px-2.5 py-2">
                <MiniaturaArchivo url={urls[doc.storage_path] ?? null} nombre={doc.nombre_original ?? 'archivo'} mime={doc.mime} onAbrir={() => onAbrir(docs, i)} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="min-w-0 truncate text-xs text-gray-700">
                      {doc.nombre_original ?? 'Archivo'} · {fechaCorta(doc.created_at)}
                      {doc.subido_por === 'STAFF' && <span className="ml-1 rounded bg-blue-50 px-1 text-[10px] text-blue-700">cargado por RRHH</span>}
                    </span>
                    <Badge className={de.color}>{de.label}</Badge>
                  </div>
                  {doc.motivo_rechazo && <p className="mt-0.5 text-[11px] text-red-600">Motivo: {doc.motivo_rechazo}</p>}
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    <button onClick={() => onAbrir(docs, i)} className="inline-flex items-center gap-1 rounded bg-white px-2 py-0.5 text-xs font-medium text-gray-600 ring-1 ring-gray-200 hover:bg-gray-100">
                      <Eye className="h-3.5 w-3.5" /> Ver
                    </button>
                    {puedeGestionar && !String(doc.mime ?? '').includes('pdf') && (
                      <button onClick={() => onAnalizar(doc)} disabled={analizando === doc.id}
                        className="inline-flex items-center gap-1 rounded bg-violet-50 px-2 py-0.5 text-xs font-medium text-violet-700 hover:bg-violet-100 disabled:opacity-50">
                        {analizando === doc.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />} Analizar IA
                      </button>
                    )}
                    {puedeGestionar && doc.estado !== 'VALIDADO' && (
                      <button onClick={() => onValidar(doc, true)} className="inline-flex items-center gap-1 rounded bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700 hover:bg-green-100">
                        <Check className="h-3.5 w-3.5" /> Validar
                      </button>
                    )}
                    {puedeGestionar && doc.estado !== 'RECHAZADO' && (
                      <button onClick={() => onValidar(doc, false)} className="inline-flex items-center gap-1 rounded bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700 hover:bg-red-100">
                        <Ban className="h-3.5 w-3.5" /> Rechazar
                      </button>
                    )}
                  </div>
                  {filas.length > 0 && (
                    <ul className="mt-1.5 space-y-0.5 rounded bg-violet-50/60 p-2 text-[11px]">
                      {filas.map((f, j) => (
                        <li key={j} className="flex justify-between gap-2">
                          <span className="text-gray-600">{f.label}: <strong>{f.ocr}</strong></span>
                          <span className={f.ok ? 'text-green-700' : 'text-amber-700'}>{f.ok ? 'coincide' : 'revisar'}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

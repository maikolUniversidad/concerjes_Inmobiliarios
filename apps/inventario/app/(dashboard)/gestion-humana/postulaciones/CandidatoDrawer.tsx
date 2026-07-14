'use client'

import { useEffect, useState } from 'react'
import {
  X, Loader2, FileText, Eye, Check, Ban, ExternalLink, Briefcase, ShieldCheck, IdCard, Sparkles, AlertTriangle,
} from 'lucide-react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { logActivity } from '@/lib/activity'
import { ESTADOS, estadoMeta, DOC_ESTADO } from './estados'
import type { CandidatoRow, PostulacionRow, VacanteRow, TipoDoc } from './PostulacionesClient'

/* eslint-disable @typescript-eslint/no-explicit-any */
interface DocFull {
  id: string; tipo_documental_id: string; orden: number; storage_path: string
  nombre_original: string | null; mime: string | null; estado: string; motivo_rechazo: string | null
  ocr_resultado: any | null; ocr_confianza: number | null
}

const norm = (s: unknown) =>
  String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/gi, '').toUpperCase()

/** Compara los campos extraídos por OCR con lo digitado por el candidato. */
function cruces(ocr: any, cand: CandidatoRow, grupo: string | undefined): { label: string; ocr: string; ok: boolean }[] {
  const c = ocr?.campos ?? {}
  const out: { label: string; ocr: string; ok: boolean }[] = []
  const push = (label: string, ocrVal: string, formVal: string, cmp?: (a: string, b: string) => boolean) => {
    if (!ocrVal) return
    const ok = cmp ? cmp(ocrVal, formVal) : norm(ocrVal) === norm(formVal)
    out.push({ label, ocr: ocrVal, ok })
  }
  push('Documento', c.numero_documento?.valor, cand.numero_documento)
  push('Nombres', c.nombres?.valor, cand.nombres, (a, b) => norm(a) === norm(b) || norm(b).includes(norm(a)) || norm(a).includes(norm(b)))
  push('Apellidos', c.apellidos?.valor, cand.apellidos, (a, b) => norm(a) === norm(b) || norm(b).includes(norm(a)) || norm(a).includes(norm(b)))
  push('Nacimiento', c.fecha_nacimiento?.valor, cand.fecha_nacimiento)
  // Antecedentes: vigencia ≤ 30 días
  if (grupo === 'ANTECEDENTES' && c.fecha_expedicion?.valor) {
    const exp = new Date(c.fecha_expedicion.valor)
    const dias = Math.floor((Date.now() - exp.getTime()) / 86400000)
    out.push({ label: 'Expedición', ocr: `${c.fecha_expedicion.valor} (${dias} días)`, ok: dias <= 30 })
  }
  return out
}
interface ConsentRow { id: string; tipo: string; otorgado: boolean; texto_version: string; created_at: string }

interface Props {
  candidato: CandidatoRow
  puedeGestionar: boolean
  vacantes: VacanteRow[]
  tipos: TipoDoc[]
  postulacion: PostulacionRow | null
  cargoMap: Map<string, string>
  epsMap: Map<string, string>
  muniMap: Map<string, string>
  onClose: () => void
  onActualizado: (c: CandidatoRow) => void
}

export function CandidatoDrawer({
  candidato, puedeGestionar, vacantes, tipos, postulacion, cargoMap, epsMap, muniMap, onClose, onActualizado,
}: Props) {
  const [sb] = useState<any>(() => createClient())
  const [docs, setDocs] = useState<DocFull[]>([])
  const [consents, setConsents] = useState<ConsentRow[]>([])
  const [direccion, setDireccion] = useState<any>(null)
  const [cargando, setCargando] = useState(true)
  const [estado, setEstado] = useState(candidato.estado)
  const [vacanteId, setVacanteId] = useState(postulacion?.vacante_id ?? '')
  const [guardando, setGuardando] = useState(false)
  const [analizando, setAnalizando] = useState<string | null>(null)

  const tipoMap = new Map(tipos.map((t) => [t.id, t]))

  useEffect(() => {
    let vivo = true
    ;(async () => {
      const [d, c, dir] = await Promise.all([
        sb.from('candidato_documentos').select('id, tipo_documental_id, orden, storage_path, nombre_original, mime, estado, motivo_rechazo, ocr_resultado, ocr_confianza').eq('candidato_id', candidato.id).order('created_at'),
        sb.from('consentimientos').select('id, tipo, otorgado, texto_version, created_at').eq('candidato_id', candidato.id).order('created_at'),
        sb.from('candidato_direcciones').select('direccion, barrio, municipio_codigo').eq('candidato_id', candidato.id).is('vigente_hasta', null).order('vigente_desde', { ascending: false }).limit(1).maybeSingle(),
      ])
      if (!vivo) return
      setDocs(d.data ?? []); setConsents(c.data ?? []); setDireccion(dir.data ?? null)
      setCargando(false)
    })()
    return () => { vivo = false }
  }, [candidato.id, sb])

  async function verDoc(doc: DocFull) {
    const { data, error } = await sb.storage.from('registro-vacantes').createSignedUrl(doc.storage_path, 120)
    if (error || !data?.signedUrl) { toast.error('No se pudo abrir el documento.'); return }
    window.open(data.signedUrl, '_blank', 'noopener')
    await logActivity(sb, { accion: 'VER', modulo: 'Postulaciones', descripcion: `Documento visto de ${candidato.nombres} ${candidato.apellidos}`, entidad: 'candidato_documentos', entidad_id: doc.id })
  }

  async function validarDoc(doc: DocFull, aprobar: boolean) {
    let motivo: string | null = null
    if (!aprobar) {
      motivo = window.prompt('Motivo del rechazo (se notificará al candidato):') || null
      if (!motivo) return
    }
    const nuevo = aprobar ? 'VALIDADO' : 'RECHAZADO'
    const { error } = await sb.from('candidato_documentos').update({ estado: nuevo, motivo_rechazo: motivo }).eq('id', doc.id)
    if (error) { toast.error('No se pudo actualizar.'); return }
    setDocs((p) => p.map((x) => (x.id === doc.id ? { ...x, estado: nuevo, motivo_rechazo: motivo } : x)))
    toast.success(aprobar ? 'Documento validado.' : 'Documento rechazado.')
  }

  async function analizarDoc(doc: DocFull) {
    setAnalizando(doc.id)
    try {
      const res = await fetch('/api/gestion-humana/postulaciones/ocr', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ docId: doc.id }),
      })
      const j = await res.json()
      if (!res.ok) { toast.error(j.error ?? 'No se pudo analizar.'); return }
      setDocs((p) => p.map((x) => (x.id === doc.id ? { ...x, ocr_resultado: j.ocr, ocr_confianza: j.confianza, estado: 'EN_VALIDACION' } : x)))
      toast.success('Documento analizado con IA.')
    } catch {
      toast.error('No se pudo analizar el documento.')
    } finally { setAnalizando(null) }
  }

  async function guardarEstado() {
    setGuardando(true)
    try {
      const { error } = await sb.from('candidatos').update({ estado }).eq('id', candidato.id)
      if (error) { toast.error(error.message); return }
      if (postulacion) await sb.from('postulaciones').update({ estado }).eq('id', postulacion.id)
      await logActivity(sb, { accion: 'EDITAR', modulo: 'Postulaciones', descripcion: `Estado → ${estado}: ${candidato.nombres} ${candidato.apellidos}`, entidad: 'candidatos', entidad_id: candidato.id })
      onActualizado({ ...candidato, estado })
      toast.success('Estado actualizado.')
    } finally { setGuardando(false) }
  }

  async function asignarVacante() {
    setGuardando(true)
    try {
      if (postulacion) {
        const { error } = await sb.from('postulaciones').update({ vacante_id: vacanteId || null }).eq('id', postulacion.id)
        if (error) { toast.error(error.message); return }
      } else {
        const { error } = await sb.from('postulaciones').insert({ candidato_id: candidato.id, vacante_id: vacanteId || null, estado })
        if (error) { toast.error(error.message); return }
      }
      await logActivity(sb, { accion: 'EDITAR', modulo: 'Postulaciones', descripcion: `Vacante asignada a ${candidato.nombres} ${candidato.apellidos}`, entidad: 'postulaciones', entidad_id: candidato.id })
      toast.success('Vacante asignada.')
    } finally { setGuardando(false) }
  }

  const m = estadoMeta(candidato.estado)
  const dato = (l: string, v: any) => (
    <div className="flex justify-between gap-3 py-1 text-sm">
      <span className="text-gray-500">{l}</span>
      <span className="text-right font-medium text-gray-800">{v || '—'}</span>
    </div>
  )
  const vacanteLabel = (v: VacanteRow) =>
    `${v.cargo?.nombre ?? 'Cargo'} · ${v.obra?.cliente?.nombre ?? ''} ${v.obra?.codigo_contrato_servicio ?? ''}`.trim()

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative flex h-full w-full max-w-lg flex-col bg-white shadow-xl">
        <div className="flex shrink-0 items-center justify-between border-b border-gray-100 px-5 py-4">
          <div className="flex items-center gap-2">
            <IdCard className="h-4 w-4 text-brand-green" />
            <h2 className="font-heading text-base font-bold text-gray-900">
              {candidato.nombres} {candidato.apellidos}
            </h2>
            <span className={'rounded-full px-2 py-0.5 text-[11px] font-semibold ' + m.color}>{m.label}</span>
          </div>
          <button onClick={onClose} className="rounded-lg p-1 text-gray-400 hover:bg-gray-100"><X className="h-5 w-5" /></button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
          {/* Gestión de estado + vacante */}
          {puedeGestionar && (
            <div className="space-y-3 rounded-xl border border-gray-200 bg-gray-50/60 p-3">
              <div>
                <label className="mb-1 block text-xs font-semibold text-gray-600">Estado del proceso</label>
                <div className="flex gap-2">
                  <select value={estado} onChange={(e) => setEstado(e.target.value)}
                    className="flex-1 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-brand-green">
                    <optgroup label="En proceso">
                      {ESTADOS.filter((e) => e.grupo === 'activo').map((e) => <option key={e.key} value={e.key}>{e.label}</option>)}
                    </optgroup>
                    <optgroup label="Cierre">
                      {ESTADOS.filter((e) => e.grupo === 'corte').map((e) => <option key={e.key} value={e.key}>{e.label}</option>)}
                    </optgroup>
                  </select>
                  <button onClick={guardarEstado} disabled={guardando || estado === candidato.estado}
                    className="rounded-lg bg-brand-green px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">
                    {guardando ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Guardar'}
                  </button>
                </div>
              </div>
              <div>
                <label className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-gray-600"><Briefcase className="h-3.5 w-3.5" /> Vacante (obra / cliente)</label>
                <div className="flex gap-2">
                  <select value={vacanteId} onChange={(e) => setVacanteId(e.target.value)}
                    className="flex-1 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-brand-green">
                    <option value="">— Sin asignar —</option>
                    {vacantes.map((v) => <option key={v.id} value={v.id}>{vacanteLabel(v)}</option>)}
                  </select>
                  <button onClick={asignarVacante} disabled={guardando}
                    className="rounded-lg border border-brand-green px-3 py-2 text-sm font-semibold text-brand-green disabled:opacity-50">
                    Asignar
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Datos */}
          <section>
            <h3 className="mb-1 font-heading text-sm font-bold text-gray-700">Datos del candidato</h3>
            <div className="divide-y divide-gray-100 rounded-xl border border-gray-100 px-3">
              {dato('Documento', `${candidato.tipo_documento} ${candidato.numero_documento}`)}
              {dato('Nacimiento', candidato.fecha_nacimiento)}
              {dato('Nacionalidad', candidato.nacionalidad)}
              {dato('Género', candidato.genero)}
              {dato('Celular', candidato.celular)}
              {dato('Correo', candidato.email)}
              {dato('Dirección', direccion ? `${direccion.direccion}${direccion.municipio_codigo ? ' · ' + (muniMap.get(direccion.municipio_codigo) ?? '') : ''}` : null)}
              {dato('EPS', epsMap.get(candidato.eps_id))}
              {dato('Cargo postulado', cargoMap.get(candidato.cargo_postulacion_id))}
              {dato('Banco', candidato.tipo_cuenta ? `${candidato.tipo_cuenta} ${candidato.numero_cuenta ?? ''}` : null)}
              {dato('Tallas', [candidato.talla_camisa, candidato.talla_pantalon, candidato.talla_calzado].filter(Boolean).join(' / '))}
            </div>
          </section>

          {/* Documentos */}
          <section>
            <h3 className="mb-1 font-heading text-sm font-bold text-gray-700">Documentos</h3>
            {cargando ? (
              <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-brand-green" /></div>
            ) : docs.length === 0 ? (
              <p className="rounded-lg bg-gray-50 px-3 py-4 text-center text-xs text-gray-400">Sin documentos cargados.</p>
            ) : (
              <div className="space-y-2">
                {docs.map((d) => {
                  const t = tipoMap.get(d.tipo_documental_id)
                  const de = DOC_ESTADO[d.estado] ?? DOC_ESTADO.CARGADO
                  return (
                    <div key={d.id} className="rounded-lg border border-gray-100 p-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="flex min-w-0 items-center gap-2">
                          <FileText className="h-4 w-4 shrink-0 text-brand-green" />
                          <span className="truncate text-sm text-gray-700">{t?.nombre ?? d.tipo_documental_id}</span>
                        </span>
                        <span className={'shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ' + de.color}>{de.label}</span>
                      </div>
                      {d.motivo_rechazo && <p className="mt-1 text-[11px] text-red-600">Motivo: {d.motivo_rechazo}</p>}
                      <div className="mt-2 flex flex-wrap gap-2">
                        <button onClick={() => verDoc(d)} className="flex items-center gap-1 rounded-md bg-gray-100 px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-200">
                          <Eye className="h-3.5 w-3.5" /> Ver <ExternalLink className="h-3 w-3" />
                        </button>
                        {puedeGestionar && !d.mime?.includes('pdf') && (
                          <button onClick={() => analizarDoc(d)} disabled={analizando === d.id}
                            className="flex items-center gap-1 rounded-md bg-violet-50 px-2 py-1 text-xs font-medium text-violet-700 hover:bg-violet-100 disabled:opacity-50">
                            {analizando === d.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />} Analizar IA
                          </button>
                        )}
                        {puedeGestionar && d.estado !== 'VALIDADO' && (
                          <button onClick={() => validarDoc(d, true)} className="flex items-center gap-1 rounded-md bg-green-50 px-2 py-1 text-xs font-medium text-green-700 hover:bg-green-100">
                            <Check className="h-3.5 w-3.5" /> Validar
                          </button>
                        )}
                        {puedeGestionar && d.estado !== 'RECHAZADO' && (
                          <button onClick={() => validarDoc(d, false)} className="flex items-center gap-1 rounded-md bg-red-50 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-100">
                            <Ban className="h-3.5 w-3.5" /> Rechazar
                          </button>
                        )}
                      </div>

                      {/* Resultado del OCR + validación cruzada */}
                      {d.ocr_resultado && (() => {
                        const filas = cruces(d.ocr_resultado, candidato, t?.grupo)
                        const conf = Math.round((d.ocr_confianza ?? 0) * 100)
                        return (
                          <div className="mt-2 rounded-lg bg-violet-50/60 p-2.5 text-xs">
                            <p className="mb-1 flex items-center gap-1 font-semibold text-violet-800">
                              <Sparkles className="h-3.5 w-3.5" /> Lectura IA
                              <span className="ml-1 font-normal text-violet-500">
                                {d.ocr_resultado.tipo_detectado ?? ''} · confianza {conf}%
                              </span>
                            </p>
                            {filas.length === 0 ? (
                              <p className="text-gray-500">Sin campos comparables con lo digitado.</p>
                            ) : (
                              <ul className="space-y-0.5">
                                {filas.map((f, k) => (
                                  <li key={k} className="flex items-center justify-between gap-2">
                                    <span className="text-gray-600">{f.label}: <span className="font-medium">{f.ocr}</span></span>
                                    {f.ok
                                      ? <span className="flex items-center gap-0.5 text-green-600"><Check className="h-3.5 w-3.5" /> coincide</span>
                                      : <span className="flex items-center gap-0.5 text-amber-600"><AlertTriangle className="h-3.5 w-3.5" /> revisar</span>}
                                  </li>
                                ))}
                              </ul>
                            )}
                            {Array.isArray(d.ocr_resultado.alertas) && d.ocr_resultado.alertas.length > 0 && (
                              <p className="mt-1 text-amber-700">⚠ {d.ocr_resultado.alertas.join(' · ')}</p>
                            )}
                          </div>
                        )
                      })()}
                    </div>
                  )
                })}
              </div>
            )}
          </section>

          {/* Consentimientos */}
          <section>
            <h3 className="mb-1 flex items-center gap-1.5 font-heading text-sm font-bold text-gray-700"><ShieldCheck className="h-4 w-4 text-brand-green" /> Autorizaciones</h3>
            {consents.length === 0 ? (
              <p className="rounded-lg bg-gray-50 px-3 py-3 text-center text-xs text-gray-400">Sin registros.</p>
            ) : (
              <ul className="space-y-1">
                {consents.map((c) => (
                  <li key={c.id} className="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-1.5 text-xs">
                    <span className="text-gray-600">{c.tipo.replaceAll('_', ' ')}</span>
                    <span className="text-gray-400">{c.otorgado ? '✓' : '✗'} · v{c.texto_version} · {new Date(c.created_at).toLocaleDateString('es-CO')}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}

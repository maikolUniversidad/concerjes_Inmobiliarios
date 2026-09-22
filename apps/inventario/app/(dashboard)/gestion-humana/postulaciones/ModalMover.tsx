'use client'

import { useEffect, useMemo, useState } from 'react'
import { ArrowRight, Loader2, AlertTriangle, CheckCircle2 } from 'lucide-react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { FLUJO, faseMeta, type TipoDocRegla } from '@/lib/ats/fases'
import { documentosDe, faltantesDe, moverCandidatos } from './acciones'
import { Modal, Boton, Badge, inputCls } from './ui'
import type { Catalogos, FilaBandeja } from './tipos'

/**
 * Transición de fase (uno o varios candidatos). Antes de mover valida los
 * documentos obligatorios y dice EXACTAMENTE cuáles faltan por candidato. Se
 * puede continuar igual con una justificación, que queda en la bitácora.
 */
export function ModalMover({
  filas, destinoInicial, catalogos, onClose, onHecho,
}: {
  filas: FilaBandeja[]
  destinoInicial?: string
  catalogos: Catalogos
  onClose: () => void
  onHecho: (ok: string[], destino: string) => void
}) {
  const [sb] = useState(() => createClient())
  const [destino, setDestino] = useState(destinoInicial ?? '')
  const [docs, setDocs] = useState<Map<string, { tipo_documental_id: string; estado: string }[]> | null>(null)
  const [justificar, setJustificar] = useState(false)
  const [justificacion, setJustificacion] = useState('')
  const [moviendo, setMoviendo] = useState(false)
  const [errores, setErrores] = useState<{ nombre: string; mensaje: string }[]>([])

  useEffect(() => {
    let vivo = true
    documentosDe(sb, filas.map((f) => f.id)).then((m) => { if (vivo) setDocs(m) })
    return () => { vivo = false }
  }, [sb, filas])

  const faltantes = useMemo(() => {
    if (!docs || !destino) return new Map<string, string[]>()
    return faltantesDe(filas, destino, catalogos.tipos as unknown as TipoDocRegla[], docs, catalogos.cargos)
  }, [docs, destino, filas, catalogos])

  const conFaltantes = filas.filter((f) => (faltantes.get(f.id) ?? []).length > 0)
  const bloqueado = !destino || (conFaltantes.length > 0 && (!justificar || justificacion.trim().length < 10))

  const porOrigen = useMemo(() => {
    const m = new Map<string, number>()
    for (const f of filas) m.set(f.estado, (m.get(f.estado) ?? 0) + 1)
    return [...m.entries()]
  }, [filas])

  async function mover() {
    setMoviendo(true)
    setErrores([])
    const r = await moverCandidatos(sb, filas, destino, { justificacion: justificar ? justificacion.trim() : undefined, faltantes })
    setMoviendo(false)
    if (r.errores.length) {
      setErrores(r.errores)
      toast.error(`${r.errores.length} candidato(s) no se pudieron mover. Revise el detalle.`)
    }
    if (r.ok.length) {
      toast.success(`${r.ok.length} candidato(s) movidos a «${faseMeta(destino).label}».`)
      onHecho(r.ok, destino)
    }
  }

  return (
    <Modal
      titulo={filas.length > 1 ? 'Transición masiva de candidatos' : 'Mover de fase'}
      subtitulo={porOrigen.map(([e, n]) => `${n} en ${faseMeta(e).label}`).join(' · ')}
      onClose={onClose}
      pie={
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Boton variante="secundario" onClick={onClose}>Cancelar</Boton>
          <Boton onClick={mover} disabled={bloqueado || moviendo}>
            {moviendo ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
            Mover {filas.length} candidato(s)
          </Boton>
        </div>
      }
    >
      <div className="space-y-4">
        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-gray-600">Mover a la fase</span>
          <select value={destino} onChange={(e) => setDestino(e.target.value)} className={inputCls}>
            <option value="">— Seleccione —</option>
            {FLUJO.map((k) => <option key={k} value={k}>{faseMeta(k).label}</option>)}
          </select>
          {destino === 'CONTRATADO' && (
            <span className="mt-1 block text-[11px] text-gray-500">
              Contratar crea la ficha en la planta de personal y la vinculación activa (entrega a nómina).
            </span>
          )}
        </label>

        {!docs ? (
          <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-brand-green" /></div>
        ) : (
          <ul className="divide-y divide-gray-100 rounded-xl border border-gray-100">
            {filas.map((f) => {
              const falt = faltantes.get(f.id) ?? []
              return (
                <li key={f.id} className="px-3 py-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-gray-900">{f.nombres} {f.apellidos}</p>
                      <p className="text-xs text-gray-500">{f.tipo_documento} {f.numero_documento} · {f.cargo ?? 'Sin cargo'}</p>
                    </div>
                    <div className="flex items-center gap-1.5 text-xs">
                      <Badge className={faseMeta(f.estado).color}>{faseMeta(f.estado).label}</Badge>
                      {destino && <><ArrowRight className="h-3.5 w-3.5 text-gray-400" /><Badge className={faseMeta(destino).color}>{faseMeta(destino).label}</Badge></>}
                    </div>
                  </div>
                  {destino && (falt.length ? (
                    <div className="mt-1.5 rounded-lg bg-red-50 px-2.5 py-1.5 text-xs text-red-700">
                      <span className="flex items-center gap-1 font-semibold"><AlertTriangle className="h-3.5 w-3.5" /> Le falta:</span>
                      {falt.join(' · ')}
                    </div>
                  ) : (
                    <p className="mt-1 flex items-center gap-1 text-xs text-green-700"><CheckCircle2 className="h-3.5 w-3.5" /> Documentos obligatorios completos</p>
                  ))}
                </li>
              )
            })}
          </ul>
        )}

        {conFaltantes.length > 0 && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
            <label className="flex items-start gap-2 text-sm text-amber-900">
              <input type="checkbox" checked={justificar} onChange={(e) => setJustificar(e.target.checked)} className="mt-0.5 h-4 w-4 accent-amber-600" />
              <span>Continuar de todos modos con {conFaltantes.length} candidato(s) con documentos pendientes.</span>
            </label>
            {justificar && (
              <textarea value={justificacion} onChange={(e) => setJustificacion(e.target.value)} rows={2}
                placeholder="Justificación (queda en la bitácora de cada candidato)…" className={inputCls + ' mt-2'} />
            )}
          </div>
        )}

        {errores.length > 0 && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-800">
            <p className="font-semibold">{errores.length} error(es):</p>
            <ul className="mt-1 list-inside list-disc">{errores.map((e, i) => <li key={i}><strong>{e.nombre}:</strong> {e.mensaje}</li>)}</ul>
          </div>
        )}
      </div>
    </Modal>
  )
}

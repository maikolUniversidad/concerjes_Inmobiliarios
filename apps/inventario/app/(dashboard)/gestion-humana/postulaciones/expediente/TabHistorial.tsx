'use client'

import { History, ShieldCheck, ArrowRight } from 'lucide-react'
import { faseMeta } from '@/lib/ats/fases'
import { Seccion, Badge, fechaHora } from '../ui'
import { ObservacionesCandidato } from './TabEvaluaciones'
import type { PropsTab } from './tipos'

/* eslint-disable @typescript-eslint/no-explicit-any */

const TIPO_EVENTO: Record<string, { label: string; color: string }> = {
  CAMBIO_ESTADO: { label: 'Cambio de fase', color: 'bg-blue-100 text-blue-700' },
  EXCEPCION_DOCUMENTAL: { label: 'Excepción documental', color: 'bg-amber-100 text-amber-800' },
  OBSERVACION: { label: 'Observación', color: 'bg-gray-100 text-gray-700' },
  EVALUACION: { label: 'Evaluación', color: 'bg-violet-100 text-violet-700' },
  DOCUMENTO: { label: 'Documento', color: 'bg-indigo-100 text-indigo-700' },
  REMISION_IPS: { label: 'Remisión IPS', color: 'bg-cyan-100 text-cyan-800' },
  CONTRATO: { label: 'Contrato', color: 'bg-lime-100 text-lime-800' },
  FIRMA: { label: 'Firma', color: 'bg-green-100 text-green-700' },
  PRUEBA: { label: 'Prueba', color: 'bg-sky-100 text-sky-700' },
  CENTRO_COSTO: { label: 'Vinculación', color: 'bg-teal-100 text-teal-700' },
}

export function TabHistorial(props: PropsTab) {
  const { d, catalogos } = props
  // El trigger guarda "CODIGO_MOTIVO · detalle": se muestra la etiqueta del motivo.
  const motivo = (m: string | null) => {
    if (!m) return m
    const [cod, ...resto] = m.split(' · ')
    const etiqueta = catalogos.motivos.find((x) => x.valor === cod)?.etiqueta
    return etiqueta ? [etiqueta, ...resto].join(' · ') : m
  }
  return (
    <div className="space-y-4">
    <ObservacionesCandidato {...props} />
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
      <Seccion titulo="Historial de cambios" icono={<History className="h-4 w-4 text-brand-green" />}>
        {d.eventos.length === 0 ? <p className="text-sm text-gray-400">No hay eventos registrados.</p> : (
          <ol className="relative space-y-3 border-l border-gray-200 pl-4">
            {d.eventos.map((e: any) => {
              const t = TIPO_EVENTO[e.tipo] ?? { label: e.tipo, color: 'bg-gray-100 text-gray-600' }
              return (
                <li key={e.id} className="relative">
                  <span className="absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-white bg-brand-green" />
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge className={t.color}>{t.label}</Badge>
                    {e.tipo === 'CAMBIO_ESTADO' && (
                      <span className="flex items-center gap-1 text-xs text-gray-600">
                        {e.de_estado ? faseMeta(e.de_estado).label : '—'} <ArrowRight className="h-3 w-3" /> <strong>{faseMeta(e.a_estado).label}</strong>
                      </span>
                    )}
                  </div>
                  {e.motivo && <p className="mt-0.5 text-sm text-gray-800">{motivo(e.motivo)}</p>}
                  {e.detalle?.faltantes && <p className="text-xs text-amber-700">Faltaban: {e.detalle.faltantes.join(' · ')}</p>}
                  <p className="text-[11px] text-gray-400">{fechaHora(e.created_at)} · {e.actor_nombre ?? 'Sistema'}</p>
                </li>
              )
            })}
          </ol>
        )}
      </Seccion>

      <Seccion titulo="Autorizaciones del candidato" icono={<ShieldCheck className="h-4 w-4 text-brand-green" />}>
        {d.consentimientos.length === 0 ? <p className="text-sm text-gray-400">Sin registros.</p> : (
          <ul className="space-y-1.5">
            {d.consentimientos.map((k: any) => (
              <li key={k.id} className="rounded-lg bg-gray-50 px-3 py-2 text-xs">
                <p className="font-semibold text-gray-700">{String(k.tipo).replaceAll('_', ' ')} {k.otorgado ? '✓' : '✗'}</p>
                <p className="text-gray-500">Versión {k.texto_version} · {fechaHora(k.created_at)}{k.ip ? ` · IP ${k.ip}` : ''}</p>
                {k.revocado_at && <p className="text-red-600">Revocado el {fechaHora(k.revocado_at)}</p>}
              </li>
            ))}
          </ul>
        )}
      </Seccion>
    </div>
    </div>
  )
}

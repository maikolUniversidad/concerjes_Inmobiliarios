'use client'

import { CheckCircle2, Circle, ArrowRight } from 'lucide-react'
import { ETAPAS, type EstadoEtapa, type EtapaKey, type Requisito } from '@/lib/ats/etapas'

const ESTADO: Record<EstadoEtapa, { label: string; color: string }> = {
  hecha: { label: 'Completada', color: 'bg-green-100 text-green-700' },
  actual: { label: 'En esta etapa', color: 'bg-brand-green text-white' },
  pendiente: { label: 'Más adelante', color: 'bg-gray-100 text-gray-500' },
  cerrada: { label: 'Proceso cerrado', color: 'bg-red-50 text-red-700' },
}

/**
 * Cabecera de cada etapa del expediente: en qué va y la lista de lo que falta
 * para pasar a la siguiente (con lo que ya está hecho en verde).
 */
export function EncabezadoEtapa({
  etapa, estado, requisitos, siguienteLabel,
}: {
  etapa: EtapaKey
  estado: EstadoEtapa
  requisitos: Requisito[]
  siguienteLabel?: string | null
}) {
  const meta = ETAPAS.find((e) => e.key === etapa)!
  if (etapa === 'historial') return null
  const listos = requisitos.filter((r) => r.ok).length
  const todo = requisitos.length > 0 && listos === requisitos.length
  const est = ESTADO[estado]

  return (
    <div className="rounded-xl border border-gray-100 bg-white p-3 sm:p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="font-heading text-base font-bold text-gray-900">
            {meta.n}. {meta.label} <span className="font-body text-sm font-normal text-gray-500">· {meta.subtitulo}</span>
          </p>
        </div>
        <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${est.color}`}>{est.label}</span>
      </div>
      {requisitos.length > 0 && (
        <>
          <ul className="mt-2.5 flex flex-wrap gap-1.5">
            {requisitos.map((r) => (
              <li key={r.texto} className={'inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs ' +
                (r.ok ? 'bg-green-50 text-green-800' : 'bg-amber-50 text-amber-900')}>
                {r.ok ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0" /> : <Circle className="h-3.5 w-3.5 shrink-0" />}
                <span>{r.texto}{r.detalle ? <span className="text-[11px] opacity-80"> · {r.detalle}</span> : null}</span>
              </li>
            ))}
          </ul>
          {estado === 'actual' && (
            <p className="mt-2 flex items-center gap-1 text-xs text-gray-500">
              {todo
                ? <><CheckCircle2 className="h-3.5 w-3.5 text-green-600" /> Todo listo en esta etapa{siguienteLabel ? <>: use «Aprobar <ArrowRight className="inline h-3 w-3" /> {siguienteLabel}» arriba.</> : '.'}</>
                : `${listos} de ${requisitos.length} listos para pasar a la siguiente etapa.`}
            </p>
          )}
        </>
      )}
    </div>
  )
}

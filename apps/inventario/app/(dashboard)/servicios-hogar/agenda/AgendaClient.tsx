'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronLeft, ChevronRight, Clock, Phone, RefreshCw } from 'lucide-react'

const DAYS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']

const EST_CLS: Record<string, string> = {
  PROGRAMADO: 'bg-blue-100 text-blue-700 border-l-4 border-blue-500',
  EN_CURSO:   'bg-purple-100 text-purple-700 border-l-4 border-purple-500',
  COMPLETADO: 'bg-green-100 text-green-700 border-l-4 border-green-500',
  CANCELADO:  'bg-red-100 text-red-700 border-l-4 border-red-500',
}

function getLunes(date: Date): Date {
  const d = new Date(date)
  const day = d.getDay()
  const diff = (day === 0 ? -6 : 1 - day)
  d.setDate(d.getDate() + diff)
  d.setHours(0, 0, 0, 0)
  return d
}

function addDays(date: Date, n: number): Date {
  const d = new Date(date)
  d.setDate(d.getDate() + n)
  return d
}

function fmt(date: Date): string {
  return date.toISOString().split('T')[0]
}

function fmtDisplay(iso: string): string {
  const d = new Date(iso + 'T12:00:00')
  return d.toLocaleDateString('es-CO', { weekday: 'short', day: 'numeric', month: 'short' })
}

interface Props {
  agenda: any[]
  semanaInicio: string
}

export default function AgendaClient({ agenda, semanaInicio }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const lunesActual = new Date(semanaInicio + 'T12:00:00')

  function navSemana(dir: number) {
    const nuevo = addDays(lunesActual, dir * 7)
    startTransition(() => router.push(`?semana=${fmt(nuevo)}`))
  }

  // Agrupa los eventos por fecha
  const eventosPorFecha: Record<string, any[]> = {}
  agenda.forEach(ev => {
    if (!eventosPorFecha[ev.fecha]) eventosPorFecha[ev.fecha] = []
    eventosPorFecha[ev.fecha].push(ev)
  })

  const totalEventos = agenda.length
  const semanaLabel = `${fmtDisplay(semanaInicio)} – ${fmtDisplay(fmt(addDays(lunesActual, 6)))}`

  return (
    <div className="space-y-4">
      {/* Navegación semana */}
      <div className="flex items-center justify-between bg-white border border-gray-100 rounded-2xl px-5 py-3">
        <button onClick={() => navSemana(-1)}
          className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors">
          <ChevronLeft className="w-5 h-5 text-gray-600" />
        </button>
        <div className="text-center">
          <p className="font-semibold text-gray-900 text-sm">{semanaLabel}</p>
          <p className="text-xs text-gray-400">{totalEventos} servicio{totalEventos !== 1 ? 's' : ''} esta semana</p>
        </div>
        <button onClick={() => navSemana(1)}
          className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors">
          <ChevronRight className="w-5 h-5 text-gray-600" />
        </button>
      </div>

      {isPending ? (
        <div className="flex justify-center py-20"><RefreshCw className="w-6 h-6 animate-spin text-brand-green" /></div>
      ) : (
        <div className="grid grid-cols-7 gap-2">
          {/* Cabeceras días */}
          {DAYS.map((d, i) => {
            const fecha = fmt(addDays(lunesActual, i))
            const hoy = fmt(new Date())
            return (
              <div key={d} className={`text-center py-2 rounded-xl text-xs font-semibold ${fecha === hoy ? 'bg-brand-green text-white' : 'bg-gray-100 text-gray-500'}`}>
                <div>{d}</div>
                <div className="text-lg font-bold">{addDays(lunesActual, i).getDate()}</div>
              </div>
            )
          })}

          {/* Eventos por día */}
          {Array.from({ length: 7 }, (_, i) => {
            const fecha = fmt(addDays(lunesActual, i))
            const evs = eventosPorFecha[fecha] ?? []
            return (
              <div key={fecha} className="min-h-[120px] space-y-1.5">
                {evs.length === 0 ? (
                  <div className="h-full rounded-xl border-2 border-dashed border-gray-100" />
                ) : evs.map((ev: any) => {
                  const cls = EST_CLS[ev.estado] ?? 'bg-gray-100 text-gray-700 border-l-4 border-gray-400'
                  return (
                    <div key={ev.id} className={`rounded-xl p-2 text-xs ${cls}`}>
                      <p className="font-semibold truncate">{ev.solicitudes_servicio_hogar?.tipos_servicio_hogar?.icono} {ev.solicitudes_servicio_hogar?.cliente_nombre}</p>
                      <div className="flex items-center gap-1 mt-0.5 text-current/70">
                        <Clock className="w-3 h-3" />
                        {ev.hora_inicio?.slice(0,5)}–{ev.hora_fin?.slice(0,5)}
                      </div>
                      {ev.solicitudes_servicio_hogar?.cliente_telefono && (
                        <div className="flex items-center gap-1 mt-0.5 text-current/70">
                          <Phone className="w-3 h-3" />
                          {ev.solicitudes_servicio_hogar.cliente_telefono}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>
      )}

      {/* Lista semana */}
      {totalEventos > 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
          <div className="p-4 border-b border-gray-50">
            <h3 className="font-semibold text-gray-900 text-sm">Detalle de la semana</h3>
          </div>
          <div className="divide-y divide-gray-50">
            {agenda.sort((a, b) => a.fecha.localeCompare(b.fecha) || a.hora_inicio.localeCompare(b.hora_inicio))
              .map((ev: any) => {
                const cls = EST_CLS[ev.estado] ?? 'bg-gray-100 text-gray-700 border-l-4 border-gray-400'
                return (
                  <div key={ev.id} className="flex items-center gap-4 px-4 py-3">
                    <div className="text-center shrink-0 w-14">
                      <p className="text-xs text-gray-400">{fmtDisplay(ev.fecha)}</p>
                    </div>
                    <div className={`flex-1 rounded-xl p-3 text-sm ${cls}`}>
                      <p className="font-semibold">{ev.solicitudes_servicio_hogar?.tipos_servicio_hogar?.icono} {ev.solicitudes_servicio_hogar?.cliente_nombre}</p>
                      <p className="text-xs opacity-80 mt-0.5">{ev.hora_inicio?.slice(0,5)} – {ev.hora_fin?.slice(0,5)} · {ev.solicitudes_servicio_hogar?.tipos_servicio_hogar?.nombre}</p>
                    </div>
                  </div>
                )
              })}
          </div>
        </div>
      )}
    </div>
  )
}

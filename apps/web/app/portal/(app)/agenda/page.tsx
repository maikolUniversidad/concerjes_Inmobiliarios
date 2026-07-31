'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, ChevronLeft, ChevronRight, CalendarPlus } from 'lucide-react'

interface Franja { hora: string; libres: number; estado: string }
interface Dia { fecha: string; franjas: Franja[] }

const DOW = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']

function lunesDeSemana(base: Date): Date {
  const d = new Date(base)
  const day = d.getDay()
  const diff = (day === 0 ? -6 : 1) - day // mover a lunes
  d.setDate(d.getDate() + diff)
  d.setHours(12, 0, 0, 0)
  return d
}

const COLORES: Record<string, string> = {
  disponible: 'bg-green-100 text-brand-green hover:bg-green-200 border-green-200',
  limitado:   'bg-amber-100 text-amber-700 hover:bg-amber-200 border-amber-200',
  lleno:      'bg-gray-100 text-gray-300 cursor-not-allowed border-gray-100',
  cerrado:    'bg-gray-50 text-gray-200 cursor-not-allowed border-gray-50',
}

export default function AgendaPage() {
  const router = useRouter()
  const [offset, setOffset] = useState(0) // semanas desde la actual
  const [dias, setDias] = useState<Dia[]>([])
  const [cargando, setCargando] = useState(true)

  const { lunes, domingo } = useMemo(() => {
    const l = lunesDeSemana(new Date())
    l.setDate(l.getDate() + offset * 7)
    const d = new Date(l)
    d.setDate(d.getDate() + 6)
    return { lunes: l, domingo: d }
  }, [offset])

  useEffect(() => {
    setCargando(true)
    const desde = lunes.toISOString().slice(0, 10)
    const hasta = domingo.toISOString().slice(0, 10)
    fetch(`/api/portal/disponibilidad?desde=${desde}&hasta=${hasta}`)
      .then((r) => r.json())
      .then((j) => { setDias(j.dias ?? []); setCargando(false) })
      .catch(() => setCargando(false))
  }, [lunes, domingo])

  const hoy = new Date().toISOString().slice(0, 10)
  const horas = dias[0]?.franjas.map((f) => f.hora) ?? []

  function elegir(fecha: string, franja: Franja) {
    if (franja.estado === 'lleno' || franja.estado === 'cerrado' || fecha < hoy) return
    router.push(`/portal/solicitar?fecha=${fecha}&hora=${franja.hora}`)
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-bold text-gray-900">Disponibilidad</h1>
        <p className="mt-1 text-gray-500">Elige un horario libre y agenda tu servicio con un clic.</p>
      </div>

      {/* Navegador de semana */}
      <div className="flex items-center justify-between rounded-xl border border-gray-200 bg-white px-4 py-3">
        <button onClick={() => setOffset((o) => Math.max(0, o - 1))} disabled={offset === 0}
          className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-sm font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-30">
          <ChevronLeft className="h-4 w-4" /> Anterior
        </button>
        <p className="text-sm font-semibold text-gray-800">
          {lunes.toLocaleDateString('es-CO', { day: 'numeric', month: 'short' })} – {domingo.toLocaleDateString('es-CO', { day: 'numeric', month: 'short' })}
        </p>
        <button onClick={() => setOffset((o) => Math.min(8, o + 1))} disabled={offset >= 8}
          className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-sm font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-30">
          Siguiente <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      {/* Leyenda */}
      <div className="flex flex-wrap gap-4 text-xs">
        <Leyenda color="bg-green-200" label="Disponible" />
        <Leyenda color="bg-amber-200" label="Pocos cupos" />
        <Leyenda color="bg-gray-200" label="Lleno / cerrado" />
      </div>

      {cargando ? (
        <div className="flex justify-center py-16"><Loader2 className="h-7 w-7 animate-spin text-brand-green" /></div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white">
          <table className="w-full min-w-[560px] border-collapse">
            <thead>
              <tr>
                <th className="sticky left-0 z-10 bg-white p-2 text-xs font-semibold text-gray-400">Hora</th>
                {dias.map((d) => {
                  const dt = new Date(d.fecha + 'T12:00:00')
                  const esHoy = d.fecha === hoy
                  return (
                    <th key={d.fecha} className="p-2 text-center">
                      <div className={`text-xs font-semibold ${esHoy ? 'text-brand-green' : 'text-gray-500'}`}>{DOW[dt.getDay()]}</div>
                      <div className={`text-sm font-bold ${esHoy ? 'text-brand-green' : 'text-gray-800'}`}>{dt.getDate()}</div>
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              {horas.map((hora) => (
                <tr key={hora}>
                  <td className="sticky left-0 z-10 bg-white p-2 text-center text-xs font-medium text-gray-500">{hora}</td>
                  {dias.map((d) => {
                    const f = d.franjas.find((x) => x.hora === hora)!
                    const pasado = d.fecha < hoy
                    const disabled = pasado || f.estado === 'lleno' || f.estado === 'cerrado'
                    return (
                      <td key={d.fecha} className="p-1">
                        <button
                          onClick={() => elegir(d.fecha, f)}
                          disabled={disabled}
                          title={disabled ? 'No disponible' : `${f.libres} cupo(s) libre(s)`}
                          className={`h-9 w-full rounded-md border text-xs font-semibold transition-colors ${pasado ? 'cursor-not-allowed border-gray-50 bg-gray-50 text-gray-200' : COLORES[f.estado]}`}
                        >
                          {pasado ? '·' : f.estado === 'cerrado' ? '—' : f.estado === 'lleno' ? 'Lleno' : f.libres}
                        </button>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-center text-xs text-gray-400">
        Los números indican cupos de personal disponibles en cada franja. <CalendarPlus className="inline h-3 w-3" /> Toca un horario libre para agendar.
      </p>
    </div>
  )
}

function Leyenda({ color, label }: { color: string; label: string }) {
  return <span className="flex items-center gap-1.5 text-gray-500"><span className={`h-3 w-3 rounded ${color}`} /> {label}</span>
}

'use client'

import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { CalendarDays, X } from 'lucide-react'

/** Devuelve la semana ISO ("YYYY-Www") de una fecha, en hora local. */
function semanaISO(d: Date): string {
  const date = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const dayNum = date.getDay() || 7
  date.setDate(date.getDate() + 4 - dayNum) // jueves de esa semana
  const yearStart = new Date(date.getFullYear(), 0, 1)
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)
  return `${date.getFullYear()}-W${String(week).padStart(2, '0')}`
}

/**
 * Filtro por semana. Escribe ?semana=YYYY-Www en la URL para que la página
 * servidor acote la lista. Botones rápidos: esta semana / semana pasada / todas.
 */
export function FiltroSemana() {
  const router = useRouter()
  const pathname = usePathname()
  const sp = useSearchParams()
  const semana = sp.get('semana') ?? ''

  function set(valor: string | null) {
    const params = new URLSearchParams(sp.toString())
    if (valor) params.set('semana', valor); else params.delete('semana')
    router.push(`${pathname}?${params.toString()}`)
  }

  const hoy = new Date()
  const estaSemana = semanaISO(hoy)
  const semanaPasada = semanaISO(new Date(Date.now() - 7 * 86400000))

  const btn = (activo: boolean) =>
    `rounded-lg border px-3 py-1.5 font-body text-xs font-semibold transition-all ${
      activo ? 'bg-brand-green text-white border-brand-green' : 'border-gray-200 text-gray-600 hover:border-gray-300'
    }`

  return (
    <div className="bg-white border border-gray-100 rounded-xl shadow-sm p-3 flex flex-wrap items-center gap-2">
      <span className="flex items-center gap-1.5 font-body font-semibold text-xs text-gray-500 uppercase tracking-wide">
        <CalendarDays className="w-3.5 h-3.5" /> Semana
      </span>
      <button onClick={() => set(estaSemana)} className={btn(semana === estaSemana)}>Esta semana</button>
      <button onClick={() => set(semanaPasada)} className={btn(semana === semanaPasada)}>Semana pasada</button>
      <input type="week" value={semana} onChange={(e) => set(e.target.value || null)}
        className="border border-gray-200 rounded-lg px-2 py-1.5 font-body text-xs outline-none focus:border-brand-green" />
      {semana && (
        <button onClick={() => set(null)} className="inline-flex items-center gap-1 font-body text-xs text-gray-400 hover:text-red-600">
          <X className="w-3 h-3" /> Todas
        </button>
      )}
    </div>
  )
}

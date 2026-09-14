'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { QrCode, Search, Wrench, MapPin, AlertTriangle, ChevronRight, Loader2, CalendarClock } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { BarcodeScanner } from '@/components/ui/BarcodeScanner'
import { ESTADO_MAQ_META } from '../maquinaria/estados'
import { CONDICION_META, extraerReferenciaEquipo } from '@/lib/mantenimiento'

export interface EquipoSedeRow {
  id: string; codigo: string; nombre: string; tipo: string | null; estado: string
  condicion: string; imagen_url: string | null; proximo_mant: string | null
  mantenimiento_tickets: { id: string; estado: string }[]
}
interface Sugerencia { id: string; codigo: string; nombre: string; estado: string; sedes: { nombre: string } | null }

const ABIERTOS = new Set(['ABIERTO', 'RECIBIDO', 'EN_PROCESO', 'EN_ESPERA'])

export function EquipoBuscar({ sede, equipos }: { sede: { id: string; nombre: string } | null; equipos: EquipoSedeRow[] }) {
  const router = useRouter()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [sb] = useState<any>(() => createClient())
  const [escaneando, setEscaneando] = useState(false)
  const [codigo, setCodigo] = useState('')
  const [sugerencias, setSugerencias] = useState<Sugerencia[]>([])
  const [buscando, setBuscando] = useState(false)
  const [abriendo, setAbriendo] = useState(false)

  function abrir(ref: string) {
    const r = extraerReferenciaEquipo(ref)
    if (!r) return
    setAbriendo(true)
    router.push(`/equipo/${encodeURIComponent(r)}`)
  }

  // Sugerencias mientras escribe (código o nombre).
  useEffect(() => {
    const q = codigo.trim()
    if (q.length < 2) { setSugerencias([]); return }
    const t = setTimeout(async () => {
      setBuscando(true)
      // Sin comodines ni separadores de PostgREST dentro de `.or()`.
      const patron = `%${q.replace(/[%_\\,()"*]/g, ' ').trim()}%`
      const { data } = await sb.from('maquinaria')
        .select('id, codigo, nombre, estado, sedes:ubicacion_sede_id(nombre)')
        .or(`codigo.ilike.${patron},nombre.ilike.${patron},serial.ilike.${patron}`)
        .eq('activo', true).order('codigo').limit(8)
      setSugerencias((data ?? []) as Sugerencia[])
      setBuscando(false)
    }, 250)
    return () => clearTimeout(t)
  }, [codigo, sb])

  return (
    <div className="space-y-5">
      {/* Escanear / digitar */}
      <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm space-y-4">
        <button onClick={() => setEscaneando(true)}
          className="w-full flex items-center justify-center gap-3 rounded-2xl bg-brand-green py-5 text-white font-heading font-bold text-lg hover:bg-brand-green-dark transition-colors">
          <QrCode className="w-7 h-7" /> Escanear código QR
        </button>

        <div className="flex items-center gap-3 text-xs text-gray-400">
          <span className="h-px flex-1 bg-gray-100" /> o escribe el código <span className="h-px flex-1 bg-gray-100" />
        </div>

        <form onSubmit={(e) => { e.preventDefault(); abrir(codigo) }} className="relative">
          <div className="flex gap-2">
            <div className="flex-1 flex items-center gap-2 rounded-xl border border-gray-200 px-3 focus-within:border-brand-green focus-within:ring-2 focus-within:ring-brand-green/20">
              <Search className="w-4 h-4 text-gray-400 shrink-0" />
              <input value={codigo} onChange={(e) => setCodigo(e.target.value)} placeholder="Ej: MAQ-001"
                className="flex-1 py-3 bg-transparent font-mono text-base uppercase placeholder:normal-case placeholder:font-body outline-none"
                autoCapitalize="characters" autoComplete="off" inputMode="text" />
              {buscando && <Loader2 className="w-4 h-4 animate-spin text-gray-300" />}
            </div>
            <button type="submit" disabled={!codigo.trim() || abriendo}
              className="rounded-xl bg-gray-900 px-5 text-white font-semibold text-sm disabled:opacity-40">
              {abriendo ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Abrir'}
            </button>
          </div>
          {sugerencias.length > 0 && (
            <ul className="mt-2 divide-y divide-gray-50 rounded-xl border border-gray-100 overflow-hidden">
              {sugerencias.map((s) => {
                const meta = ESTADO_MAQ_META[s.estado]
                return (
                  <li key={s.id}>
                    <button type="button" onClick={() => abrir(s.id)} className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-gray-50">
                      <span className={`h-2 w-2 rounded-full shrink-0 ${meta?.dot ?? 'bg-gray-300'}`} />
                      <span className="font-mono text-xs text-gray-500 w-24 shrink-0 truncate">{s.codigo}</span>
                      <span className="flex-1 min-w-0 truncate text-sm text-gray-800">{s.nombre}</span>
                      <span className="hidden sm:block text-xs text-gray-400 truncate max-w-[140px]">{s.sedes?.nombre}</span>
                      <ChevronRight className="w-4 h-4 text-gray-300" />
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </form>
      </div>

      {/* Equipos de mi sede */}
      {sede ? (
        <div className="rounded-2xl border border-gray-100 bg-white shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
            <h2 className="font-heading font-semibold text-sm text-gray-900 flex items-center gap-2">
              <MapPin className="w-4 h-4 text-brand-green" /> Equipos de {sede.nombre}
            </h2>
            <span className="text-xs text-gray-400">{equipos.length}</span>
          </div>
          {equipos.length === 0 ? (
            <p className="p-6 text-center text-sm text-gray-400">No hay equipos registrados en tu sede.</p>
          ) : (
            <ul className="divide-y divide-gray-50">
              {equipos.map((e) => {
                const meta = ESTADO_MAQ_META[e.estado] ?? { label: e.estado, cls: 'bg-gray-100 text-gray-600' }
                const abiertos = e.mantenimiento_tickets.filter((t) => ABIERTOS.has(t.estado)).length
                const vencido = e.proximo_mant && new Date(e.proximo_mant) <= new Date()
                return (
                  <li key={e.id}>
                    <Link href={`/equipo/${e.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50">
                      <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-gray-100">
                        {e.imagen_url
                          ? <Image src={e.imagen_url} alt={e.nombre} fill sizes="48px" className="object-cover" />
                          : <div className="flex h-full items-center justify-center text-gray-300"><Wrench className="w-5 h-5" /></div>}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-gray-900 truncate">{e.nombre}</p>
                        <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                          <span className="font-mono text-[11px] text-gray-500">{e.codigo}</span>
                          <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${meta.cls}`}>{meta.label}</span>
                          {e.condicion && e.condicion !== 'BUENA' && (
                            <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${CONDICION_META[e.condicion]?.cls}`}>Condición {CONDICION_META[e.condicion]?.label.toLowerCase()}</span>
                          )}
                          {abiertos > 0 && (
                            <span className="inline-flex items-center gap-0.5 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-red-50 text-red-600">
                              <AlertTriangle className="w-3 h-3" /> {abiertos} ticket{abiertos > 1 ? 's' : ''}
                            </span>
                          )}
                          {vencido && (
                            <span className="inline-flex items-center gap-0.5 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-purple-50 text-purple-600">
                              <CalendarClock className="w-3 h-3" /> Preventivo vencido
                            </span>
                          )}
                        </div>
                      </div>
                      <ChevronRight className="w-4 h-4 text-gray-300 shrink-0" />
                    </Link>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      ) : (
        <p className="text-center text-xs text-gray-400">
          Tu usuario no tiene una sede asignada; pide a un administrador que la configure en Usuarios para ver aquí los equipos de tu sede.
        </p>
      )}

      {escaneando && (
        <BarcodeScanner
          onDetected={(v) => { setEscaneando(false); abrir(v) }}
          onClose={() => setEscaneando(false)}
        />
      )}
    </div>
  )
}

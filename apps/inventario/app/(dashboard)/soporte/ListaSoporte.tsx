'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Bug, Search, Plus, MessageSquare } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { EVENTO_ABRIR_SOPORTE } from '@/components/soporte/BotonSoporte'
import {
  ESTADO_SOPORTE_META, ESTADOS_SOPORTE_ACTIVOS, PRIORIDAD_SOPORTE_META, TIPO_SOPORTE_META,
  type EstadoSoporte, type TipoSoporte,
} from '@/lib/soporte'
import { haceCuanto } from '@/lib/mantenimiento'

export interface TicketSoporteFila {
  id: string
  numero: string
  tipo: TipoSoporte
  prioridad: string
  estado: EstadoSoporte
  titulo: string
  modulo: string | null
  reportado_por: string | null
  reportado_nombre: string | null
  asignado_a: string | null
  asignado_nombre: string | null
  created_at: string
  updated_at: string
  ultimo_mensaje_at: string | null
}

type Vista = 'activos' | 'mios' | 'asignados' | 'todos'

export function ListaSoporte({ tickets, usuarioId, agente }: { tickets: TicketSoporteFila[]; usuarioId: string; agente: boolean }) {
  const router = useRouter()
  const [vista, setVista] = useState<Vista>('activos')
  const [tipo, setTipo] = useState<TipoSoporte | ''>('')
  const [q, setQ] = useState('')

  // En vivo: cualquier cambio en tickets refresca la lista.
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = createClient() as any
    let t: ReturnType<typeof setTimeout> | null = null
    const canal = sb.channel('soporte-lista')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'soporte_tickets' }, () => {
        if (t) clearTimeout(t)
        t = setTimeout(() => router.refresh(), 600)
      })
      .subscribe()
    return () => { if (t) clearTimeout(t); sb.removeChannel(canal) }
  }, [router])

  const kpis = useMemo(() => ({
    abiertos: tickets.filter((t) => t.estado === 'ABIERTO').length,
    enCurso: tickets.filter((t) => t.estado === 'EN_PROCESO' || t.estado === 'EN_ESPERA').length,
    porConfirmar: tickets.filter((t) => t.estado === 'RESUELTO').length,
    errores: tickets.filter((t) => t.tipo === 'ERROR' && ESTADOS_SOPORTE_ACTIVOS.includes(t.estado)).length,
    mejoras: tickets.filter((t) => t.tipo === 'MEJORA' && ESTADOS_SOPORTE_ACTIVOS.includes(t.estado)).length,
  }), [tickets])

  const filtrados = useMemo(() => {
    const txt = q.trim().toLowerCase()
    return tickets
      .filter((t) => vista === 'todos' ? true
        : vista === 'activos' ? ESTADOS_SOPORTE_ACTIVOS.includes(t.estado)
        : vista === 'mios' ? t.reportado_por === usuarioId
        : t.asignado_a === usuarioId)
      .filter((t) => !tipo || t.tipo === tipo)
      .filter((t) => !txt || [t.numero, t.titulo, t.modulo, t.reportado_nombre, t.asignado_nombre]
        .some((v) => v?.toLowerCase().includes(txt)))
      .sort((a, b) => vista === 'activos'
        ? (PRIORIDAD_SOPORTE_META[a.prioridad]?.orden ?? 9) - (PRIORIDAD_SOPORTE_META[b.prioridad]?.orden ?? 9)
          || b.created_at.localeCompare(a.created_at)
        : b.created_at.localeCompare(a.created_at))
  }, [tickets, vista, tipo, q, usuarioId])

  const vistas: { k: Vista; label: string }[] = [
    { k: 'activos', label: 'Activos' },
    { k: 'mios', label: 'Míos' },
    ...(agente ? [{ k: 'asignados' as Vista, label: 'Asignados' }] : []),
    { k: 'todos', label: 'Todos' },
  ]

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 [&>*:last-child]:col-span-2 sm:[&>*:last-child]:col-span-1">
        {[
          { label: 'Abiertos', v: kpis.abiertos, cls: 'text-red-600' },
          { label: 'En curso', v: kpis.enCurso, cls: 'text-amber-600' },
          { label: 'Por confirmar', v: kpis.porConfirmar, cls: 'text-emerald-600' },
          { label: 'Errores activos', v: kpis.errores, cls: 'text-gray-900' },
          { label: 'Mejoras propuestas', v: kpis.mejoras, cls: 'text-violet-600' },
        ].map((k) => (
          <div key={k.label} className="rounded-2xl border border-gray-100 bg-white px-4 py-3 shadow-sm">
            <p className="text-xs text-gray-500">{k.label}</p>
            <p className={`font-heading text-2xl font-bold ${k.cls}`}>{k.v}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-xl bg-gray-100 p-1">
          {vistas.map((v) => (
            <button key={v.k} onClick={() => setVista(v.k)}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${vista === v.k ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
              {v.label}
            </button>
          ))}
        </div>
        <select value={tipo} onChange={(e) => setTipo(e.target.value as TipoSoporte | '')}
          className="rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-sm">
          <option value="">Todos los tipos</option>
          {(Object.keys(TIPO_SOPORTE_META) as TipoSoporte[]).map((t) => <option key={t} value={t}>{TIPO_SOPORTE_META[t].label}</option>)}
        </select>
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-2.5 top-2 w-4 h-4 text-gray-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar número, título, módulo, persona…"
            className="w-full rounded-lg border border-gray-200 bg-white py-1.5 pl-8 pr-3 text-sm outline-none focus:border-brand-green" />
        </div>
        <button onClick={() => window.dispatchEvent(new Event(EVENTO_ABRIR_SOPORTE))}
          className="inline-flex items-center gap-1.5 rounded-lg bg-brand-green px-3 py-2 text-sm font-semibold text-white hover:bg-brand-green-dark">
          <Plus className="w-4 h-4" /> Nuevo ticket
        </button>
      </div>

      <div className="rounded-2xl border border-gray-100 bg-white shadow-sm divide-y divide-gray-50">
        {filtrados.length === 0 && (
          <div className="py-14 text-center text-sm text-gray-400">
            <Bug className="mx-auto mb-2 w-8 h-8 text-gray-300" />
            No hay tickets en esta vista. Usa el botón <Bug className="inline w-4 h-4" /> de la barra superior para reportar.
          </div>
        )}
        {filtrados.map((t) => (
          <Link key={t.id} href={`/soporte/${t.id}`} className="flex items-start gap-3 px-4 py-3 hover:bg-gray-50">
            <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${ESTADO_SOPORTE_META[t.estado]?.dot}`} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="font-mono text-xs text-gray-400">{t.numero}</span>
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${TIPO_SOPORTE_META[t.tipo]?.cls}`}>{TIPO_SOPORTE_META[t.tipo]?.label}</span>
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${ESTADO_SOPORTE_META[t.estado]?.cls}`}>{ESTADO_SOPORTE_META[t.estado]?.label}</span>
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${PRIORIDAD_SOPORTE_META[t.prioridad]?.cls}`}>{PRIORIDAD_SOPORTE_META[t.prioridad]?.label}</span>
              </div>
              <p className="mt-0.5 truncate font-semibold text-sm text-gray-900">{t.titulo}</p>
              <p className="truncate text-xs text-gray-500">
                {t.modulo ?? 'Sin módulo'} · {t.reportado_nombre ?? '—'} · {haceCuanto(t.created_at)}
                {t.asignado_nombre ? ` · atiende ${t.asignado_nombre}` : ''}
              </p>
            </div>
            {t.ultimo_mensaje_at && (
              <span className="flex shrink-0 items-center gap-1 text-[11px] text-gray-400">
                <MessageSquare className="w-3.5 h-3.5" /> {haceCuanto(t.ultimo_mensaje_at)}
              </span>
            )}
          </Link>
        ))}
      </div>
    </div>
  )
}

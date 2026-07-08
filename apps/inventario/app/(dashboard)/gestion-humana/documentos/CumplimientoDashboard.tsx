'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  Loader2, Users, TrendingUp, CheckCircle2, AlertTriangle, Search, ChevronRight, ListChecks,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { tiposParaSelect, type TipoDoc } from './tipos'

interface PersonaCumpl {
  id: string
  nombres: string
  apellidos: string
  documento: string
  estado: string
  empresa: string | null
  sede: string | null
}

interface Props {
  tipos: TipoDoc[]
}

const inputCls =
  'w-full border border-gray-200 rounded-lg px-3 py-2 font-body text-sm outline-none focus:border-brand-green bg-white transition-colors'

const ESTADO_BADGE: Record<string, string> = {
  ACTIVO: 'bg-green-100 text-green-700',
  RETIRADO: 'bg-gray-100 text-gray-600',
  SUSPENDIDO: 'bg-amber-100 text-amber-700',
}

export function CumplimientoDashboard({ tipos }: Props) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [sb] = useState<any>(() => createClient())
  const [loading, setLoading] = useState(true)
  const [personas, setPersonas] = useState<PersonaCumpl[]>([])
  const [docsMap, setDocsMap] = useState<Map<string, Set<string>>>(new Map())

  // Filtros
  const [fEmpresa, setFEmpresa] = useState('')
  const [fSede, setFSede] = useState('')
  const [fEstado, setFEstado] = useState('ACTIVO')
  const [q, setQ] = useState('')

  const opcionesTipo = useMemo(() => tiposParaSelect(tipos), [tipos])
  const tipoIds = useMemo(() => new Set(opcionesTipo.map((o) => o.id)), [opcionesTipo])
  const totalTipos = opcionesTipo.length

  useEffect(() => {
    let cancel = false
    async function cargar() {
      setLoading(true)
      const [{ data: pers }, { data: docs }] = await Promise.all([
        sb.from('personas').select('id, nombres, apellidos, documento, estado, empresas_usuarias(nombre), sedes(nombre)').order('apellidos'),
        sb.from('documentos_persona').select('persona_id, tipo_documental_id'),
      ])
      if (cancel) return
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setPersonas((pers ?? []).map((p: any) => ({
        id: p.id, nombres: p.nombres, apellidos: p.apellidos, documento: p.documento, estado: p.estado,
        empresa: p.empresas_usuarias?.nombre ?? null, sede: p.sedes?.nombre ?? null,
      })))
      const m = new Map<string, Set<string>>()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const d of (docs ?? []) as any[]) {
        if (!d.tipo_documental_id) continue
        if (!m.has(d.persona_id)) m.set(d.persona_id, new Set())
        m.get(d.persona_id)!.add(d.tipo_documental_id)
      }
      setDocsMap(m)
      setLoading(false)
    }
    cargar()
    return () => { cancel = true }
  }, [sb])

  // Opciones de filtro
  const empresas = useMemo(() => Array.from(new Set(personas.map((p) => p.empresa).filter(Boolean))).sort() as string[], [personas])
  const sedes = useMemo(() => Array.from(new Set(personas.map((p) => p.sede).filter(Boolean))).sort() as string[], [personas])

  // Cálculo de cumplimiento por persona + filtros
  const filas = useMemo(() => {
    const t = q.trim().toLowerCase()
    return personas
      .filter((p) => (!fEmpresa || p.empresa === fEmpresa)
        && (!fSede || p.sede === fSede)
        && (!fEstado || p.estado === fEstado)
        && (!t || `${p.nombres} ${p.apellidos} ${p.documento}`.toLowerCase().includes(t)))
      .map((p) => {
        const set = docsMap.get(p.id)
        let tiene = 0
        if (set) for (const id of set) if (tipoIds.has(id)) tiene++
        const falta = Math.max(0, totalTipos - tiene)
        const pct = totalTipos ? Math.round((tiene / totalTipos) * 100) : 0
        return { ...p, tiene, falta, pct }
      })
  }, [personas, docsMap, tipoIds, totalTipos, fEmpresa, fSede, fEstado, q])

  // KPIs
  const kpis = useMemo(() => {
    const n = filas.length
    const pctProm = n ? Math.round(filas.reduce((s, f) => s + f.pct, 0) / n) : 0
    const completos = filas.filter((f) => totalTipos > 0 && f.tiene >= totalTipos).length
    const pendientesTot = filas.reduce((s, f) => s + f.falta, 0)
    return { n, pctProm, completos, pendientesTot }
  }, [filas, totalTipos])

  // Ranking: más pendientes primero
  const ranking = useMemo(() =>
    [...filas].sort((a, b) => b.falta - a.falta || a.apellidos.localeCompare(b.apellidos)).slice(0, 50),
  [filas])

  // Tipos con más pendientes (entre las personas filtradas)
  const tiposPendientes = useMemo(() => {
    return opcionesTipo.map((o) => {
      const faltan = filas.filter((f) => !docsMap.get(f.id)?.has(o.id)).length
      return { ...o, faltan }
    }).sort((a, b) => b.faltan - a.faltan).slice(0, 8)
  }, [opcionesTipo, filas, docsMap])

  if (loading) {
    return <div className="py-16 text-center text-gray-400"><Loader2 className="w-7 h-7 animate-spin mx-auto" /></div>
  }

  return (
    <div className="space-y-5">
      {/* Filtros */}
      <div className="grid gap-2 sm:grid-cols-4">
        <div className="sm:col-span-1">
          <select value={fEmpresa} onChange={(e) => setFEmpresa(e.target.value)} className={inputCls}>
            <option value="">Todas las empresas</option>
            {empresas.map((e) => <option key={e} value={e}>{e}</option>)}
          </select>
        </div>
        <div>
          <select value={fSede} onChange={(e) => setFSede(e.target.value)} className={inputCls}>
            <option value="">Todas las sedes</option>
            {sedes.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <select value={fEstado} onChange={(e) => setFEstado(e.target.value)} className={inputCls}>
            <option value="">Todos los estados</option>
            <option value="ACTIVO">Activos</option>
            <option value="RETIRADO">Retirados</option>
            <option value="SUSPENDIDO">Suspendidos</option>
          </select>
        </div>
        <div className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3">
          <Search className="w-4 h-4 text-gray-400 shrink-0" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar persona…"
            className="flex-1 bg-transparent py-2 text-sm outline-none placeholder:text-gray-400" />
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { icon: Users, label: 'Personas', value: kpis.n.toLocaleString('es-CO'), color: 'text-blue-600 bg-blue-50 border-blue-100' },
          { icon: TrendingUp, label: 'Cumplimiento prom.', value: `${kpis.pctProm}%`, color: 'text-brand-green bg-green-50 border-green-100' },
          { icon: CheckCircle2, label: 'Al 100%', value: kpis.completos.toLocaleString('es-CO'), color: 'text-emerald-600 bg-emerald-50 border-emerald-100' },
          { icon: AlertTriangle, label: 'Docs pendientes', value: kpis.pendientesTot.toLocaleString('es-CO'), color: 'text-red-600 bg-red-50 border-red-100' },
        ].map((k) => (
          <div key={k.label} className={`rounded-xl border p-4 ${k.color} flex items-start gap-3`}>
            <k.icon className="w-5 h-5 mt-0.5 shrink-0" />
            <div>
              <p className="font-heading font-bold text-2xl text-gray-900">{k.value}</p>
              <p className="font-body text-xs">{k.label}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Ranking */}
        <div className="lg:col-span-2 rounded-2xl border border-gray-100 bg-white shadow-sm overflow-hidden">
          <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
            <h3 className="flex items-center gap-2 font-heading font-semibold text-sm text-gray-900">
              <AlertTriangle className="w-4 h-4 text-red-500" /> Top personas con documentación pendiente
            </h3>
            <span className="font-body text-xs text-gray-400">{filas.length} personas</span>
          </div>
          <div className="divide-y divide-gray-50 max-h-[30rem] overflow-y-auto">
            {ranking.length === 0 && <p className="px-4 py-10 text-center font-body text-sm text-gray-400">Sin personas para estos filtros.</p>}
            {ranking.map((f) => (
              <Link key={f.id} href={`/gestion-humana/documentos?persona=${f.id}`}
                className="flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50/70 transition-colors">
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-green/10 text-brand-green text-xs font-bold shrink-0">
                  {(f.nombres[0] ?? '') + (f.apellidos[0] ?? '')}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="font-body font-medium text-sm text-gray-900 truncate">{f.nombres} {f.apellidos}</p>
                    <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${ESTADO_BADGE[f.estado] ?? 'bg-gray-100 text-gray-600'}`}>
                      {f.estado.charAt(0) + f.estado.slice(1).toLowerCase()}
                    </span>
                  </div>
                  <p className="font-body text-xs text-gray-400 truncate">{f.empresa ?? 'Sin empresa'}{f.sede ? ` · ${f.sede}` : ''}</p>
                  <div className="mt-1 flex items-center gap-2">
                    <div className="h-1.5 flex-1 max-w-[140px] overflow-hidden rounded-full bg-gray-100">
                      <div className={`h-full rounded-full ${f.pct >= 100 ? 'bg-emerald-500' : f.pct >= 50 ? 'bg-amber-400' : 'bg-red-400'}`} style={{ width: `${f.pct}%` }} />
                    </div>
                    <span className="font-body text-[11px] text-gray-500">{f.tiene}/{totalTipos}</span>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <p className={`font-heading font-bold text-lg ${f.falta > 0 ? 'text-red-600' : 'text-emerald-600'}`}>{f.falta}</p>
                  <p className="font-body text-[10px] text-gray-400">faltan</p>
                </div>
                <ChevronRight className="w-4 h-4 text-gray-300 shrink-0" />
              </Link>
            ))}
          </div>
          {filas.length > ranking.length && (
            <p className="px-4 py-2 text-center font-body text-[11px] text-gray-400 border-t border-gray-50">
              Mostrando las {ranking.length} con más pendientes de {filas.length}.
            </p>
          )}
        </div>

        {/* Tipos más pendientes */}
        <div className="rounded-2xl border border-gray-100 bg-white shadow-sm overflow-hidden self-start">
          <div className="border-b border-gray-100 px-4 py-3">
            <h3 className="flex items-center gap-2 font-heading font-semibold text-sm text-gray-900">
              <ListChecks className="w-4 h-4 text-brand-green" /> Tipos con más pendientes
            </h3>
          </div>
          <div className="p-3 space-y-2.5">
            {tiposPendientes.length === 0 && <p className="py-6 text-center font-body text-sm text-gray-400">Sin tipos documentales.</p>}
            {tiposPendientes.map((t) => {
              const pctFalta = filas.length ? Math.round((t.faltan / filas.length) * 100) : 0
              return (
                <div key={t.id}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-body text-xs text-gray-700 truncate">{t.label}</span>
                    <span className="font-body text-xs font-semibold text-red-600 shrink-0">{t.faltan}</span>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-gray-100">
                    <div className="h-full rounded-full bg-red-400" style={{ width: `${pctFalta}%` }} />
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}

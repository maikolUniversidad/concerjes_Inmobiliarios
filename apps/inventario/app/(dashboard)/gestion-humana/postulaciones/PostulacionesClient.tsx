'use client'

import { useMemo, useState } from 'react'
import { Search, ChevronRight, FileText, UserSearch } from 'lucide-react'
import { usePermisos } from '@/components/permisos/PermisosProvider'
import { ESTADOS, estadoMeta } from './estados'
import { CandidatoDrawer } from './CandidatoDrawer'

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface CandidatoRow { id: string; estado: string; [k: string]: any }
export interface PostulacionRow { id: string; candidato_id: string; vacante_id: string | null; estado: string; created_at: string }
export interface DocMini { id: string; candidato_id: string; estado: string }
export interface Opcion { id: string; nombre: string }
export interface Muni { codigo_dane: string; nombre: string }
export interface VacanteRow {
  id: string; slug: string | null; cupos: number; cupos_ocupados: number; abierta: boolean
  cargo: { nombre: string } | null
  obra: { codigo_contrato_servicio: string; cliente: { nombre: string } | null } | null
}
export interface TipoDoc {
  id: string; codigo: string; nombre: string; grupo: string
  obligatorio: boolean; min_archivos: number; max_archivos: number; ola: number
}

interface Props {
  candidatos: CandidatoRow[]
  postulaciones: PostulacionRow[]
  docsMini: DocMini[]
  eps: Opcion[]
  cargos: Opcion[]
  municipios: Muni[]
  vacantes: VacanteRow[]
  tipos: TipoDoc[]
}

export function PostulacionesClient(props: Props) {
  const { puede } = usePermisos()
  const puedeGestionar = puede('gestionar_postulaciones')

  const [lista, setLista] = useState<CandidatoRow[]>(props.candidatos)
  const [filtro, setFiltro] = useState<string>('TODOS')
  const [q, setQ] = useState('')
  const [abierto, setAbierto] = useState<CandidatoRow | null>(null)

  const cargoMap = useMemo(() => new Map(props.cargos.map((c) => [c.id, c.nombre])), [props.cargos])
  const epsMap = useMemo(() => new Map(props.eps.map((c) => [c.id, c.nombre])), [props.eps])
  const muniMap = useMemo(() => new Map(props.municipios.map((m) => [m.codigo_dane, m.nombre])), [props.municipios])

  const docsPorCand = useMemo(() => {
    const m = new Map<string, { total: number; validados: number }>()
    for (const d of props.docsMini) {
      const e = m.get(d.candidato_id) ?? { total: 0, validados: 0 }
      e.total++; if (d.estado === 'VALIDADO') e.validados++
      m.set(d.candidato_id, e)
    }
    return m
  }, [props.docsMini])

  const conteos = useMemo(() => {
    const m = new Map<string, number>()
    for (const c of lista) m.set(c.estado, (m.get(c.estado) ?? 0) + 1)
    return m
  }, [lista])

  const filtrados = useMemo(() => {
    const term = q.trim().toLowerCase()
    return lista.filter((c) => {
      if (filtro !== 'TODOS' && c.estado !== filtro) return false
      if (!term) return true
      return (
        `${c.nombres ?? ''} ${c.apellidos ?? ''}`.toLowerCase().includes(term) ||
        String(c.numero_documento ?? '').includes(term)
      )
    })
  }, [lista, filtro, q])

  function onActualizado(c: CandidatoRow) {
    setLista((prev) => prev.map((x) => (x.id === c.id ? { ...x, ...c } : x)))
    setAbierto((a) => (a && a.id === c.id ? { ...a, ...c } : a))
  }

  const estadosConDatos = ESTADOS.filter((e) => (conteos.get(e.key) ?? 0) > 0)

  return (
    <div className="space-y-4">
      {/* Buscador */}
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar por nombre o documento…"
          className="w-full rounded-xl border border-gray-200 bg-white py-2.5 pl-10 pr-3 font-body text-sm outline-none focus:border-brand-green focus:ring-2 focus:ring-brand-green/20"
        />
      </div>

      {/* Filtros por estado */}
      <div className="flex flex-wrap gap-2">
        <button onClick={() => setFiltro('TODOS')}
          className={'rounded-full px-3 py-1.5 text-xs font-semibold ' + (filtro === 'TODOS' ? 'bg-brand-green text-white' : 'bg-gray-100 text-gray-600')}>
          Todos ({lista.length})
        </button>
        {estadosConDatos.map((e) => (
          <button key={e.key} onClick={() => setFiltro(e.key)}
            className={'rounded-full px-3 py-1.5 text-xs font-semibold ' + (filtro === e.key ? 'bg-brand-green text-white' : e.color)}>
            {e.label} ({conteos.get(e.key)})
          </button>
        ))}
      </div>

      {/* Lista */}
      {filtrados.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-gray-200 py-16 text-gray-400">
          <UserSearch className="h-8 w-8" />
          <p className="font-body text-sm">No hay postulaciones que coincidan.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtrados.map((c) => {
            const m = estadoMeta(c.estado)
            const dc = docsPorCand.get(c.id)
            return (
              <button key={c.id} onClick={() => setAbierto(c)}
                className="flex w-full items-center justify-between gap-3 rounded-xl border border-gray-100 bg-white p-3 text-left shadow-sm transition-colors hover:border-brand-green/40">
                <div className="min-w-0">
                  <p className="truncate font-body text-sm font-semibold text-gray-900">
                    {c.nombres ?? '—'} {c.apellidos ?? ''}
                  </p>
                  <p className="truncate text-xs text-gray-500">
                    {c.tipo_documento} {c.numero_documento} · {cargoMap.get(c.cargo_postulacion_id) ?? 'Sin cargo'}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {dc && (
                    <span className="hidden items-center gap-1 text-xs text-gray-400 sm:flex">
                      <FileText className="h-3.5 w-3.5" /> {dc.validados}/{dc.total}
                    </span>
                  )}
                  <span className={'rounded-full px-2 py-1 text-[11px] font-semibold ' + m.color}>{m.label}</span>
                  <ChevronRight className="h-4 w-4 text-gray-300" />
                </div>
              </button>
            )
          })}
        </div>
      )}

      {abierto && (
        <CandidatoDrawer
          candidato={abierto}
          puedeGestionar={puedeGestionar}
          vacantes={props.vacantes}
          tipos={props.tipos}
          postulacion={props.postulaciones.find((p) => p.candidato_id === abierto.id) ?? null}
          cargoMap={cargoMap}
          epsMap={epsMap}
          muniMap={muniMap}
          onClose={() => setAbierto(null)}
          onActualizado={onActualizado}
        />
      )}
    </div>
  )
}

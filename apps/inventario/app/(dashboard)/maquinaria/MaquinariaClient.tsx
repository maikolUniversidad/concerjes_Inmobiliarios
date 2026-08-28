'use client'

import { useMemo, useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { Wrench, Plus, Search, MapPin, PencilLine } from 'lucide-react'
import { ESTADOS_MAQ, ESTADO_MAQ_META } from './estados'
import { MaquinariaForm } from './MaquinariaForm'

export interface SedeOpt { id: string; nombre: string }
export interface MaquinariaRow {
  id: string
  codigo: string
  nombre: string
  tipo: string | null
  marca: string | null
  modelo: string | null
  serial: string | null
  estado: string
  ubicacion_sede_id: string | null
  ubicacion_texto: string | null
  responsable: string | null
  imagen_url: string | null
  fecha_adquisicion: string | null
  valor: number | null
  observaciones: string | null
  created_at: string
  sedes: { id: string; nombre: string } | null
}

interface Props {
  maquinas: MaquinariaRow[]
  sedes: SedeOpt[]
  puedeGestionar: boolean
}

export function MaquinariaClient({ maquinas: init, sedes, puedeGestionar }: Props) {
  const [maquinas, setMaquinas] = useState<MaquinariaRow[]>(init)
  const [q, setQ] = useState('')
  const [estado, setEstado] = useState('')
  const [drawer, setDrawer] = useState(false)
  const [sel, setSel] = useState<MaquinariaRow | null>(null)

  const filtradas = useMemo(() => {
    const t = q.trim().toLowerCase()
    return maquinas.filter(m =>
      (!estado || m.estado === estado) &&
      (!t || `${m.codigo} ${m.nombre} ${m.tipo ?? ''} ${m.marca ?? ''} ${m.serial ?? ''}`.toLowerCase().includes(t)))
  }, [maquinas, q, estado])

  const conteo = useMemo(() => {
    const c: Record<string, number> = {}
    for (const m of maquinas) c[m.estado] = (c[m.estado] ?? 0) + 1
    return c
  }, [maquinas])

  function nueva() { setSel(null); setDrawer(true) }
  function editar(m: MaquinariaRow) { setSel(m); setDrawer(true) }
  function onSaved(m: MaquinariaRow) {
    setMaquinas(prev => { const i = prev.findIndex(x => x.id === m.id); if (i === -1) return [m, ...prev]; const n = [...prev]; n[i] = m; return n })
    setDrawer(false)
  }
  function onDeleted(id: string) { setMaquinas(prev => prev.filter(x => x.id !== id)); setDrawer(false) }

  return (
    <div className="space-y-4">
      {/* KPIs por estado */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        {ESTADOS_MAQ.map(e => (
          <button key={e} onClick={() => setEstado(estado === e ? '' : e)}
            className={`rounded-xl border p-3 text-left transition-colors ${estado === e ? 'border-brand-green ring-1 ring-brand-green' : 'border-gray-100'} ${ESTADO_MAQ_META[e].cls}`}>
            <p className="font-heading font-bold text-xl">{conteo[e] ?? 0}</p>
            <p className="font-body text-[11px]">{ESTADO_MAQ_META[e].label}</p>
          </button>
        ))}
      </div>

      {/* Búsqueda + nueva */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 flex-1 min-w-[220px] focus-within:border-brand-green">
          <Search className="w-4 h-4 text-gray-400 shrink-0" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por código, nombre, tipo, marca o serial…"
            className="flex-1 bg-transparent font-body text-sm outline-none placeholder:text-gray-400" />
        </div>
        {puedeGestionar && (
          <button onClick={nueva} className="flex items-center gap-2 bg-brand-green hover:bg-brand-green-dark text-white font-body font-semibold text-sm px-4 py-2.5 rounded-xl transition-colors shrink-0">
            <Plus className="w-4 h-4" /> <span className="hidden sm:inline">Nueva máquina</span><span className="sm:hidden">Nueva</span>
          </button>
        )}
      </div>

      <p className="font-body text-xs text-gray-400">{filtradas.length} de {maquinas.length} máquinas</p>

      {/* Grid */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {filtradas.map(m => {
          const meta = ESTADO_MAQ_META[m.estado] ?? { label: m.estado, cls: 'bg-gray-100 text-gray-600' }
          const ubic = m.sedes?.nombre ?? m.ubicacion_texto
          return (
            <Link key={m.id} href={`/maquinaria/${m.id}`}
              className="group rounded-2xl border border-gray-100 bg-white shadow-sm hover:border-brand-green/40 hover:shadow-md transition-all overflow-hidden">
              <div className="relative aspect-[16/10] bg-gray-50">
                {m.imagen_url
                  ? <Image src={m.imagen_url} alt={m.nombre} fill className="object-cover" sizes="(max-width:640px) 100vw, 33vw" />
                  : <div className="flex h-full w-full items-center justify-center text-gray-300"><Wrench className="w-10 h-10" /></div>}
                <span className={`absolute top-2 right-2 font-body text-[11px] font-medium px-2 py-0.5 rounded-full ${meta.cls}`}>{meta.label}</span>
                {puedeGestionar && (
                  <button
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); editar(m) }}
                    title="Editar máquina"
                    className="absolute top-2 left-2 flex items-center justify-center h-7 w-7 rounded-full bg-white/90 text-gray-600 shadow-sm hover:bg-white hover:text-brand-green transition-colors opacity-100 sm:opacity-0 sm:group-hover:opacity-100 focus:opacity-100">
                    <PencilLine className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
              <div className="p-3">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">{m.codigo}</span>
                  {m.tipo && <span className="font-body text-xs text-gray-400 truncate">{m.tipo}</span>}
                </div>
                <p className="mt-1 font-body font-semibold text-sm text-gray-900 truncate">{m.nombre}</p>
                <p className="mt-0.5 flex min-w-0 items-center gap-1 font-body text-xs text-gray-500">
                  <MapPin className="w-3 h-3 text-gray-400 shrink-0" /> {ubic || 'Sin ubicación'}
                </p>
              </div>
            </Link>
          )
        })}
      </div>

      {filtradas.length === 0 && (
        <div className="py-16 text-center">
          <Wrench className="w-12 h-12 text-gray-200 mx-auto mb-3" />
          <p className="font-heading font-bold text-gray-400">{q || estado ? 'Sin resultados' : 'Aún no hay maquinaria'}</p>
        </div>
      )}

      {/* Drawer */}
      <div className={`fixed inset-0 z-30 bg-black/20 transition-opacity duration-300 ${drawer ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`} onClick={() => setDrawer(false)} />
      <div className={`fixed top-0 right-0 z-40 h-full w-full max-w-md bg-white shadow-2xl transition-transform duration-300 ease-out flex flex-col ${drawer ? 'translate-x-0' : 'translate-x-full'}`}>
        {drawer && <MaquinariaForm maquina={sel} sedes={sedes} onClose={() => setDrawer(false)} onSaved={onSaved} onDeleted={onDeleted} />}
      </div>
    </div>
  )
}

'use client'

import { useEffect, useState, useTransition } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  Users, UploadCloud, Building2, Search, UserPlus, ChevronRight, ChevronLeft,
  IdCard, KeyRound, KeySquare, Table2, LayoutGrid,
} from 'lucide-react'
import { BulkImport } from '@/components/import/BulkImport'
import { PERSONAS_CONFIG } from '@/lib/import/config'
import { usePermisos } from '@/components/permisos/PermisosProvider'
import { PersonaForm } from './PersonaForm'
import { EmpresasUsuariasPanel } from './EmpresasUsuariasPanel'

// ─── Tipos compartidos ────────────────────────────────────────────────────────
export interface EmpresaOption {
  id: string
  nombre: string
  nit: string | null
  ciudad: string | null
  contacto: string | null
  telefono: string | null
  email: string | null
}
export interface SedeOption { id: string; nombre: string }

export interface RolOption {
  id: string
  nombre: string
  descripcion: string | null
  permisos: Record<string, boolean> | null
}

/** Cuenta de plataforma vinculada a la persona (personas.usuario_id → usuarios). */
export interface CuentaRow {
  id: string
  email: string
  activo: boolean
  rol_id: string | null
  roles: { id: string; nombre: string } | null
}

export interface PersonaRow {
  id: string
  tipo_doc: string
  documento: string
  nombres: string
  apellidos: string
  nombre_completo: string | null
  cargo: string | null
  empresa_usuaria_id: string | null
  sede_id: string | null
  fecha_ingreso: string | null
  fecha_retiro: string | null
  estado: string
  email: string | null
  telefono: string | null
  direccion: string | null
  eps: string | null
  arl: string | null
  usuario_id: string | null
  created_at: string
  ciudad: string | null
  origen: string | null
  empresas_usuarias: { id: string; nombre: string } | null
  sedes: { id: string; nombre: string } | null
  centros_costo: { id: string; codigo: string } | null
  cuenta: CuentaRow | null
}

export interface FiltrosPersonas {
  q: string
  estado: string
  vista: 'tabla' | 'tarjetas'
  pagina: number
}

interface Props {
  personas: PersonaRow[]
  total: number
  tamanoPagina: number
  filtros: FiltrosPersonas
  empresas: EmpresaOption[]
  sedes: SedeOption[]
  roles: RolOption[]
  existentes: string[]
}

const ESTADO_BADGE: Record<string, string> = {
  ACTIVO: 'bg-green-100 text-green-700',
  RETIRADO: 'bg-gray-100 text-gray-600',
  SUSPENDIDO: 'bg-amber-100 text-amber-700',
}

const ESTADOS = [
  { valor: '', label: 'Todos' },
  { valor: 'ACTIVO', label: 'Activos' },
  { valor: 'RETIRADO', label: 'Retirados' },
  { valor: 'SUSPENDIDO', label: 'Suspendidos' },
]

function iniciales(n: string, a: string) {
  return ((n[0] ?? '') + (a[0] ?? '')).toUpperCase()
}

const nombreDe = (p: PersonaRow) =>
  `${p.nombres ?? ''} ${p.apellidos ?? ''}`.trim() || p.nombre_completo || p.documento

const capitaliza = (e: string) => e.charAt(0) + e.slice(1).toLowerCase()

type Tab = 'personas' | 'masivo' | 'empresas'

export function PersonasClient({
  personas: init, total, tamanoPagina, filtros,
  empresas: initEmpresas, sedes, roles, existentes,
}: Props) {
  const { puede } = usePermisos()
  const router = useRouter()
  const params = useSearchParams()
  const [pendiente, iniciar] = useTransition()

  const [tab, setTab] = useState<Tab>('personas')
  // Copia local de la página actual: deja que el drawer refleje el guardado al
  // instante sin esperar a que el servidor devuelva la página otra vez.
  const [personas, setPersonas] = useState<PersonaRow[]>(init)
  const [empresas, setEmpresas] = useState<EmpresaOption[]>(initEmpresas)
  const [q, setQ] = useState(filtros.q)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [selected, setSelected] = useState<PersonaRow | null>(null)

  useEffect(() => { setPersonas(init) }, [init])
  useEffect(() => { setQ(filtros.q) }, [filtros.q])

  // Los filtros viven en la URL: la pantalla se puede compartir y el botón de
  // atrás del navegador hace lo que uno espera.
  function navegar(cambios: Record<string, string>) {
    const p = new URLSearchParams(params.toString())
    for (const [k, v] of Object.entries(cambios)) {
      if (v) p.set(k, v)
      else p.delete(k)
    }
    if (!('pagina' in cambios)) p.delete('pagina')
    iniciar(() => router.push(`?${p.toString()}`))
  }

  function openNew() { setSelected(null); setDrawerOpen(true) }
  function openEdit(p: PersonaRow) { setSelected(p); setDrawerOpen(true) }
  function close() { setDrawerOpen(false); setSelected(null) }

  function onSaved(p: PersonaRow) {
    setPersonas((prev) => {
      const i = prev.findIndex((x) => x.id === p.id)
      if (i === -1) return [p, ...prev]
      const next = [...prev]; next[i] = p; return next
    })
    close()
    // La ficha nueva puede caer en otra página o dejar de cumplir el filtro:
    // se le pide al servidor la página real.
    router.refresh()
  }
  function onDeleted(id: string) {
    setPersonas((prev) => prev.filter((p) => p.id !== id))
    close()
    router.refresh()
  }

  const TABS = ([
    { id: 'personas', label: 'Personas', icon: Users },
    { id: 'masivo', label: 'Cargue masivo', icon: UploadCloud, permiso: 'importar_personas' },
    { id: 'empresas', label: 'Empresas usuarias', icon: Building2, permiso: 'ver_empresas_usuarias' },
  ] as { id: Tab; label: string; icon: typeof Users; permiso?: string }[])
    .filter((t) => puede(t.permiso))

  const puedeGestionar = puede('gestionar_personas')

  const paginas = Math.max(1, Math.ceil(total / tamanoPagina))
  const inicio = total === 0 ? 0 : (filtros.pagina - 1) * tamanoPagina + 1
  const fin = Math.min(filtros.pagina * tamanoPagina, total)

  return (
    <div className="space-y-5">
      {/* Tabs — scroll horizontal en móvil */}
      <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-1 px-1">
        {TABS.map((t) => {
          const active = tab === t.id
          return (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`flex items-center gap-2 shrink-0 font-body font-semibold text-sm px-4 py-2.5 rounded-xl border transition-colors ${
                active ? 'bg-brand-green text-white border-brand-green' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
              }`}>
              <t.icon className="w-4 h-4" /> {t.label}
            </button>
          )
        })}
      </div>

      {/* ── TAB: Personas ── */}
      {tab === 'personas' && (
        <>
          <div className="flex items-center gap-2 flex-wrap">
            <form
              onSubmit={(e) => { e.preventDefault(); navegar({ q }) }}
              className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 flex-1 min-w-[220px]"
            >
              <Search className="w-4 h-4 text-gray-400 shrink-0" />
              <input value={q} onChange={(e) => setQ(e.target.value)}
                placeholder="Buscar por nombre, documento o cargo…"
                className="flex-1 bg-transparent font-body text-sm outline-none placeholder:text-gray-400" />
            </form>

            <select
              value={filtros.estado}
              onChange={(e) => navegar({ estado: e.target.value })}
              className="rounded-xl border border-gray-200 bg-white px-3 py-2.5 font-body text-sm text-gray-700"
            >
              {ESTADOS.map((e) => <option key={e.valor} value={e.valor}>{e.label}</option>)}
            </select>

            {/* Tabla o tarjetas: la tabla es la base, las tarjetas quedan de opción. */}
            <div className="flex rounded-xl border border-gray-200 bg-white p-0.5">
              {([
                { id: 'tabla', icon: Table2, titulo: 'Ver como tabla' },
                { id: 'tarjetas', icon: LayoutGrid, titulo: 'Ver como tarjetas' },
              ] as const).map((v) => (
                <button key={v.id} onClick={() => navegar({ vista: v.id === 'tabla' ? '' : v.id })}
                  title={v.titulo} aria-label={v.titulo} aria-pressed={filtros.vista === v.id}
                  className={`rounded-[10px] p-2 transition-colors ${
                    filtros.vista === v.id ? 'bg-brand-green text-white' : 'text-gray-500 hover:bg-gray-50'
                  }`}>
                  <v.icon className="w-4 h-4" />
                </button>
              ))}
            </div>

            {puedeGestionar && (
              <button onClick={openNew} className="flex items-center gap-2 bg-brand-green hover:bg-brand-green-dark text-white font-body font-semibold text-sm px-4 py-2.5 rounded-xl transition-colors shrink-0">
                <UserPlus className="w-4 h-4" /> <span className="hidden sm:inline">Nueva persona</span><span className="sm:hidden">Nueva</span>
              </button>
            )}
          </div>

          <p className="font-body text-xs text-gray-400">
            {total === 0
              ? 'Sin resultados'
              : `${inicio.toLocaleString('es-CO')}–${fin.toLocaleString('es-CO')} de ${total.toLocaleString('es-CO')} personas`}
            {pendiente && ' · cargando…'}
          </p>

          {/* ── Vista base: tabla ── */}
          {filtros.vista === 'tabla' && personas.length > 0 && (
            <div className="overflow-x-auto rounded-xl border border-gray-100 bg-white shadow-sm">
              <table className="w-full min-w-[860px] border-collapse">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50/60 text-left">
                    {['Colaborador', 'Documento', 'Cargo', 'Centro de costos', 'Ciudad', 'Estado', 'Acceso', ''].map((h) => (
                      <th key={h} className="px-3 py-2.5 font-body text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {personas.map((p) => (
                    <tr key={p.id} onClick={() => openEdit(p)}
                      className="border-b border-gray-50 last:border-0 cursor-pointer hover:bg-brand-green/5 transition-colors">
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-2.5">
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-green font-heading text-[11px] font-bold text-white">
                            {iniciales(p.nombres, p.apellidos)}
                          </div>
                          <span className="font-body text-sm font-semibold text-gray-900">{nombreDe(p)}</span>
                        </div>
                      </td>
                      <td className="px-3 py-2.5 font-body text-sm text-gray-600 whitespace-nowrap">{p.tipo_doc} {p.documento}</td>
                      <td className="px-3 py-2.5 font-body text-sm text-gray-600">{p.cargo ?? '—'}</td>
                      <td className="px-3 py-2.5 font-body text-sm text-gray-500">{p.centros_costo?.codigo ?? p.empresas_usuarias?.nombre ?? '—'}</td>
                      <td className="px-3 py-2.5 font-body text-sm text-gray-500">{p.ciudad ?? '—'}</td>
                      <td className="px-3 py-2.5">
                        <span className={`font-body text-[10px] font-medium px-1.5 py-0.5 rounded-full whitespace-nowrap ${ESTADO_BADGE[p.estado] ?? 'bg-gray-100 text-gray-600'}`}>
                          {capitaliza(p.estado)}
                        </span>
                      </td>
                      <td className="px-3 py-2.5">
                        {p.usuario_id ? (
                          <span className="inline-flex items-center gap-0.5 font-body text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-brand-green/10 text-brand-green whitespace-nowrap">
                            <KeyRound className="w-2.5 h-2.5" /> {p.cuenta?.roles?.nombre ?? 'Acceso'}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-0.5 font-body text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500 whitespace-nowrap">
                            <KeySquare className="w-2.5 h-2.5" /> Sin acceso
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2.5"><ChevronRight className="w-4 h-4 text-gray-300" /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* ── Vista opcional: tarjetas ── */}
          {filtros.vista === 'tarjetas' && (
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {personas.map((p) => (
                <button key={p.id} onClick={() => openEdit(p)}
                  className="text-left flex items-center gap-3 rounded-xl border border-gray-100 bg-white p-3 shadow-sm hover:border-brand-green/40 hover:shadow-md transition-all">
                  <div className="flex h-11 w-11 items-center justify-center rounded-full bg-brand-green text-white font-heading font-bold text-sm shrink-0">
                    {iniciales(p.nombres, p.apellidos)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="font-body font-semibold text-sm text-gray-900 truncate">{nombreDe(p)}</p>
                      <span className={`shrink-0 font-body text-[10px] font-medium px-1.5 py-0.5 rounded-full ${ESTADO_BADGE[p.estado] ?? 'bg-gray-100 text-gray-600'}`}>
                        {capitaliza(p.estado)}
                      </span>
                      {p.usuario_id ? (
                        <span className="shrink-0 inline-flex items-center gap-0.5 font-body text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-brand-green/10 text-brand-green" title={p.cuenta?.roles?.nombre ? `Acceso: ${p.cuenta.roles.nombre}` : 'Con acceso'}>
                          <KeyRound className="w-2.5 h-2.5" /> {p.cuenta?.roles?.nombre ?? 'Acceso'}
                        </span>
                      ) : (
                        <span className="shrink-0 inline-flex items-center gap-0.5 font-body text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500" title="Sin acceso a la plataforma">
                          <KeySquare className="w-2.5 h-2.5" /> Sin acceso
                        </span>
                      )}
                    </div>
                    <p className="font-body text-xs text-gray-500 flex min-w-0 items-center gap-1">
                      <IdCard className="w-3 h-3 text-gray-400" /> {p.tipo_doc} {p.documento}
                      {p.cargo && <span className="text-gray-300">·</span>}
                      {p.cargo && <span className="truncate">{p.cargo}</span>}
                    </p>
                    <p className="font-body text-xs text-gray-400 truncate">
                      {p.centros_costo?.codigo ?? p.empresas_usuarias?.nombre ?? 'Sin centro de costos'}
                      {p.ciudad && ` · ${p.ciudad}`}
                    </p>
                  </div>
                  <ChevronRight className="w-4 h-4 text-gray-300 shrink-0" />
                </button>
              ))}
            </div>
          )}

          {personas.length === 0 && (
            <div className="py-16 text-center">
              <Users className="w-12 h-12 text-gray-200 mx-auto mb-3" />
              <p className="font-heading font-bold text-gray-400">{filtros.q ? 'Sin resultados' : 'Aún no hay personas'}</p>
              <p className="font-body text-sm text-gray-400 mt-1">
                {filtros.q ? 'Prueba con el documento completo o quita el filtro de estado.' : 'Crea una individualmente o usa el cargue masivo.'}
              </p>
            </div>
          )}

          {/* ── Paginación ── */}
          {paginas > 1 && (
            <div className="flex items-center justify-center gap-2 pt-1">
              <button disabled={filtros.pagina <= 1}
                onClick={() => navegar({ pagina: String(filtros.pagina - 1) })}
                className="flex items-center gap-1 rounded-xl border border-gray-200 bg-white px-3 py-2 font-body text-sm text-gray-600 disabled:opacity-40">
                <ChevronLeft className="w-4 h-4" /> Anterior
              </button>
              <span className="font-body text-sm text-gray-500">
                {filtros.pagina} / {paginas.toLocaleString('es-CO')}
              </span>
              <button disabled={filtros.pagina >= paginas}
                onClick={() => navegar({ pagina: String(filtros.pagina + 1) })}
                className="flex items-center gap-1 rounded-xl border border-gray-200 bg-white px-3 py-2 font-body text-sm text-gray-600 disabled:opacity-40">
                Siguiente <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          )}
        </>
      )}

      {/* ── TAB: Cargue masivo ── */}
      {tab === 'masivo' && (
        <BulkImport config={PERSONAS_CONFIG} existentes={existentes} />
      )}

      {/* ── TAB: Empresas usuarias ── */}
      {tab === 'empresas' && (
        <EmpresasUsuariasPanel empresas={empresas} onChange={setEmpresas} />
      )}

      {/* Drawer */}
      <div className={`fixed inset-0 z-30 bg-black/20 transition-opacity duration-300 ${drawerOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`} onClick={close} />
      <div className={`fixed top-0 right-0 z-40 h-full w-full max-w-md bg-white shadow-2xl transition-transform duration-300 ease-out flex flex-col ${drawerOpen ? 'translate-x-0' : 'translate-x-full'}`}>
        {drawerOpen && (
          <PersonaForm persona={selected} empresas={empresas} sedes={sedes} roles={roles} onClose={close} onSaved={onSaved} onDeleted={onDeleted} />
        )}
      </div>
    </div>
  )
}

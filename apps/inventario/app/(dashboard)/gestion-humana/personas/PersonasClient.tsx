'use client'

import { useMemo, useState } from 'react'
import {
  Users, UploadCloud, Building2, Search, UserPlus, ChevronRight, IdCard,
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

export interface PersonaRow {
  id: string
  tipo_doc: string
  documento: string
  nombres: string
  apellidos: string
  cargo: string | null
  empresa_usuaria_id: string | null
  sede_id: string | null
  fecha_ingreso: string | null
  estado: string
  email: string | null
  telefono: string | null
  direccion: string | null
  eps: string | null
  arl: string | null
  created_at: string
  empresas_usuarias: { id: string; nombre: string } | null
  sedes: { id: string; nombre: string } | null
}

interface Props {
  personas: PersonaRow[]
  empresas: EmpresaOption[]
  sedes: SedeOption[]
  existentes: string[]
}

const ESTADO_BADGE: Record<string, string> = {
  ACTIVO: 'bg-green-100 text-green-700',
  RETIRADO: 'bg-gray-100 text-gray-600',
  SUSPENDIDO: 'bg-amber-100 text-amber-700',
}

function iniciales(n: string, a: string) {
  return ((n[0] ?? '') + (a[0] ?? '')).toUpperCase()
}

type Tab = 'personas' | 'masivo' | 'empresas'

export function PersonasClient({ personas: init, empresas: initEmpresas, sedes, existentes }: Props) {
  const { puede } = usePermisos()
  const [tab, setTab] = useState<Tab>('personas')
  const [personas, setPersonas] = useState<PersonaRow[]>(init)
  const [empresas, setEmpresas] = useState<EmpresaOption[]>(initEmpresas)
  const [q, setQ] = useState('')
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [selected, setSelected] = useState<PersonaRow | null>(null)

  const filtradas = useMemo(() => {
    const t = q.trim().toLowerCase()
    if (!t) return personas
    return personas.filter((p) =>
      `${p.nombres} ${p.apellidos}`.toLowerCase().includes(t) ||
      p.documento.toLowerCase().includes(t) ||
      (p.cargo ?? '').toLowerCase().includes(t) ||
      (p.empresas_usuarias?.nombre ?? '').toLowerCase().includes(t)
    )
  }, [personas, q])

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
  }
  function onDeleted(id: string) {
    setPersonas((prev) => prev.filter((p) => p.id !== id))
    close()
  }

  const TABS = ([
    { id: 'personas', label: 'Personas', icon: Users },
    { id: 'masivo', label: 'Cargue masivo', icon: UploadCloud, permiso: 'importar_personas' },
    { id: 'empresas', label: 'Empresas usuarias', icon: Building2, permiso: 'ver_empresas_usuarias' },
  ] as { id: Tab; label: string; icon: typeof Users; permiso?: string }[])
    .filter((t) => puede(t.permiso))

  const puedeGestionar = puede('gestionar_personas')

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
            <div className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 flex-1 min-w-[200px]">
              <Search className="w-4 h-4 text-gray-400 shrink-0" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por nombre, documento, cargo o empresa…"
                className="flex-1 bg-transparent font-body text-sm outline-none placeholder:text-gray-400" />
            </div>
            {puedeGestionar && (
              <button onClick={openNew} className="flex items-center gap-2 bg-brand-green hover:bg-brand-green-dark text-white font-body font-semibold text-sm px-4 py-2.5 rounded-xl transition-colors shrink-0">
                <UserPlus className="w-4 h-4" /> <span className="hidden sm:inline">Nueva persona</span><span className="sm:hidden">Nueva</span>
              </button>
            )}
          </div>

          <p className="font-body text-xs text-gray-400">{filtradas.length} de {personas.length} personas</p>

          {/* Lista tipo tarjeta (mobile-first) */}
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {filtradas.map((p) => (
              <button key={p.id} onClick={() => openEdit(p)}
                className="text-left flex items-center gap-3 rounded-xl border border-gray-100 bg-white p-3 shadow-sm hover:border-brand-green/40 hover:shadow-md transition-all">
                <div className="flex h-11 w-11 items-center justify-center rounded-full bg-brand-green text-white font-heading font-bold text-sm shrink-0">
                  {iniciales(p.nombres, p.apellidos)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="font-body font-semibold text-sm text-gray-900 truncate">{p.nombres} {p.apellidos}</p>
                    <span className={`shrink-0 font-body text-[10px] font-medium px-1.5 py-0.5 rounded-full ${ESTADO_BADGE[p.estado] ?? 'bg-gray-100 text-gray-600'}`}>
                      {p.estado.charAt(0) + p.estado.slice(1).toLowerCase()}
                    </span>
                  </div>
                  <p className="font-body text-xs text-gray-500 truncate flex items-center gap-1">
                    <IdCard className="w-3 h-3 text-gray-400" /> {p.tipo_doc} {p.documento}
                    {p.cargo && <span className="text-gray-300">·</span>}
                    {p.cargo && <span className="truncate">{p.cargo}</span>}
                  </p>
                  <p className="font-body text-xs text-gray-400 truncate">
                    {p.empresas_usuarias?.nombre ?? 'Sin empresa usuaria'}
                    {p.sedes?.nombre && ` · ${p.sedes.nombre}`}
                  </p>
                </div>
                <ChevronRight className="w-4 h-4 text-gray-300 shrink-0" />
              </button>
            ))}
          </div>

          {filtradas.length === 0 && (
            <div className="py-16 text-center">
              <Users className="w-12 h-12 text-gray-200 mx-auto mb-3" />
              <p className="font-heading font-bold text-gray-400">{q ? 'Sin resultados' : 'Aún no hay personas'}</p>
              <p className="font-body text-sm text-gray-400 mt-1">Crea una individualmente o usa el cargue masivo.</p>
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
          <PersonaForm persona={selected} empresas={empresas} sedes={sedes} onClose={close} onSaved={onSaved} onDeleted={onDeleted} />
        )}
      </div>
    </div>
  )
}

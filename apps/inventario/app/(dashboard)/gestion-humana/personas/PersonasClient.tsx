'use client'

import { useState } from 'react'
import { Users, UploadCloud, Building2, UserPlus, Pencil, IdCard, KeyRound, KeySquare } from 'lucide-react'
import { BulkImport } from '@/components/import/BulkImport'
import { PERSONAS_CONFIG } from '@/lib/import/config'
import { usePermisos } from '@/components/permisos/PermisosProvider'
import { TablaEstandar, type ColumnaTabla } from '@/components/ui/tabla'
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
  /** ALTA | MEDIA | BAJA: confianza del corte automático apellidos/nombres. */
  nombre_confianza: string | null
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

interface Props {
  personas: PersonaRow[]
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

const capitaliza = (e: string) => e.charAt(0) + e.slice(1).toLowerCase()

const nombreDe = (p: PersonaRow) =>
  `${p.nombres ?? ''} ${p.apellidos ?? ''}`.trim() || p.nombre_completo || p.documento

function iniciales(n: string, a: string) {
  return ((n[0] ?? '') + (a[0] ?? '')).toUpperCase()
}

type Tab = 'personas' | 'masivo' | 'empresas'

export function PersonasClient({ personas: init, empresas: initEmpresas, sedes, roles, existentes }: Props) {
  const { puede } = usePermisos()
  const [tab, setTab] = useState<Tab>('personas')
  const [personas, setPersonas] = useState<PersonaRow[]>(init)
  const [empresas, setEmpresas] = useState<EmpresaOption[]>(initEmpresas)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [selected, setSelected] = useState<PersonaRow | null>(null)

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

  const columnas: ColumnaTabla<PersonaRow>[] = [
    {
      id: 'avatar', header: '', valor: () => '', copiable: false, filtrable: false, ordenable: false,
      ancho: 'w-12', prioridad: 2, tarjeta: 'oculto',
      celda: (p) => (
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-green font-heading text-xs font-bold text-white">
          {iniciales(p.nombres, p.apellidos)}
        </div>
      ),
    },
    {
      id: 'nombre', header: 'Colaborador', valor: nombreDe, ancho: 'min-w-[220px]', tarjeta: 'titulo',
      celda: (p) => (
        <div className="min-w-0">
          <p className="font-body text-sm font-semibold text-gray-900">{nombreDe(p)}</p>
          {/* El nombre tal como vino de nómina solo se muestra cuando el corte
              entre apellidos y nombres quedó dudoso: repetirlo siempre sería el
              mismo nombre al revés, y ahí no aporta nada. */}
          {p.nombre_completo && p.nombre_confianza && p.nombre_confianza !== 'ALTA' && (
            <p className="truncate font-body text-[11px] text-amber-700" title="El corte entre apellidos y nombres se dedujo automáticamente; este es el dato original de nómina.">
              {p.nombre_completo}
            </p>
          )}
        </div>
      ),
    },
    {
      id: 'documento', header: 'Documento', valor: (p) => `${p.tipo_doc} ${p.documento}`,
      ancho: 'w-40', tarjeta: 'subtitulo',
      celda: (p) => (
        <span className="font-body text-sm text-gray-600 whitespace-nowrap">
          <IdCard className="mr-1 inline h-3 w-3 text-gray-400" />{p.tipo_doc} {p.documento}
        </span>
      ),
    },
    { id: 'cargo', header: 'Cargo', valor: (p) => p.cargo ?? '', tarjeta: 'meta' },
    {
      id: 'centro', header: 'Centro de costos',
      valor: (p) => p.centros_costo?.codigo ?? p.empresas_usuarias?.nombre ?? '',
      prioridad: 2, tarjeta: 'meta',
    },
    { id: 'ciudad', header: 'Ciudad', valor: (p) => p.ciudad ?? '', prioridad: 2, tarjeta: 'meta' },
    { id: 'sede', header: 'Sede', valor: (p) => p.sedes?.nombre ?? '', prioridad: 3, tarjeta: 'oculto' },
    { id: 'telefono', header: 'Teléfono', valor: (p) => p.telefono ?? '', prioridad: 3, tarjeta: 'oculto' },
    {
      id: 'estado', header: 'Estado', valor: (p) => capitaliza(p.estado), ancho: 'w-28', tarjeta: 'badge',
      celda: (p) => (
        <span className={`font-body text-[10px] font-medium px-1.5 py-0.5 rounded-full whitespace-nowrap ${ESTADO_BADGE[p.estado] ?? 'bg-gray-100 text-gray-600'}`}>
          {capitaliza(p.estado)}
        </span>
      ),
    },
    {
      id: 'acceso', header: 'Acceso',
      valor: (p) => (p.usuario_id ? p.cuenta?.roles?.nombre ?? 'Con acceso' : 'Sin acceso'),
      ancho: 'w-36', tarjeta: 'badge',
      celda: (p) => p.usuario_id ? (
        <span className="inline-flex items-center gap-0.5 whitespace-nowrap rounded-full bg-brand-green/10 px-1.5 py-0.5 font-body text-[10px] font-medium text-brand-green">
          <KeyRound className="h-2.5 w-2.5" /> {p.cuenta?.roles?.nombre ?? 'Acceso'}
        </span>
      ) : (
        <span className="inline-flex items-center gap-0.5 whitespace-nowrap rounded-full bg-gray-100 px-1.5 py-0.5 font-body text-[10px] font-medium text-gray-500">
          <KeySquare className="h-2.5 w-2.5" /> Sin acceso
        </span>
      ),
    },
    { id: 'ingreso', header: 'Ingreso', valor: (p) => p.fecha_ingreso ?? '', prioridad: 3, tarjeta: 'oculto' },
    { id: 'retiro', header: 'Retiro', valor: (p) => p.fecha_retiro ?? '', prioridad: 3, tarjeta: 'oculto' },
  ]

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
        <TablaEstandar
          id="personas"
          titulo="Personas"
          modulo="Gestión Humana"
          entidad="personas"
          datos={personas}
          columnas={columnas}
          filaId={(p) => p.id}
          onFilaClick={openEdit}
          textoDetalle="Ver"
          busqueda="Buscar por nombre, documento, cargo o centro de costos…"
          gridTarjetas="grid gap-2 sm:grid-cols-2 xl:grid-cols-3"
          acciones={(p) => (
            puedeGestionar ? (
              <button
                onClick={(e) => { e.stopPropagation(); openEdit(p) }}
                title="Editar ficha"
                className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-blue-50 hover:text-blue-600"
              >
                <Pencil className="h-4 w-4" />
              </button>
            ) : null
          )}
          herramientas={puedeGestionar ? (
            <button onClick={openNew}
              className="flex shrink-0 items-center gap-2 rounded-xl bg-brand-green px-4 py-2.5 font-body text-sm font-semibold text-white transition-colors hover:bg-brand-green-dark">
              <UserPlus className="h-4 w-4" />
              <span className="hidden sm:inline">Nueva persona</span><span className="sm:hidden">Nueva</span>
            </button>
          ) : undefined}
          vacio={
            <div className="py-16 text-center">
              <Users className="mx-auto mb-3 h-12 w-12 text-gray-200" />
              <p className="font-heading font-bold text-gray-400">Sin resultados</p>
              <p className="mt-1 font-body text-sm text-gray-400">
                Crea una persona o usa el cargue masivo.
              </p>
            </div>
          }
        />
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

'use client'

import { useState } from 'react'
import { FolderTree, UploadCloud, FolderSearch, ScanLine, BarChart3, Wand2 } from 'lucide-react'
import { usePermisos } from '@/components/permisos/PermisosProvider'
import { TipoTree } from './TipoTree'
import { SubirDocumentos } from './SubirDocumentos'
import { DocumentosPersona } from './DocumentosPersona'
import { EscanerDocumentos } from './EscanerDocumentos'
import { ClasificarIA } from './ClasificarIA'
import { CumplimientoDashboard } from './CumplimientoDashboard'
import type { TipoDoc } from './tipos'

export interface PersonaLite {
  id: string
  nombres: string
  apellidos: string
  documento: string
  tipo_doc: string
}

interface Props {
  tipos: TipoDoc[]
  personas: PersonaLite[]
  initialPersonaId?: string
}

type Tab = 'arbol' | 'subir' | 'escaner' | 'clasificar' | 'consultar' | 'cumplimiento'

export function DocumentosClient({ tipos: initTipos, personas, initialPersonaId }: Props) {
  const { puede } = usePermisos()
  const [tipos, setTipos] = useState<TipoDoc[]>(initTipos)

  const TABS = ([
    { id: 'clasificar', label: 'Clasificar IA', icon: Wand2, permiso: 'gestionar_documentos_rrhh' },
    { id: 'escaner', label: 'Escáner', icon: ScanLine, permiso: 'gestionar_documentos_rrhh' },
    { id: 'subir', label: 'Subir documentos', icon: UploadCloud, permiso: 'gestionar_documentos_rrhh' },
    { id: 'consultar', label: 'Consultar por persona', icon: FolderSearch },
    { id: 'cumplimiento', label: 'Cumplimiento', icon: BarChart3 },
    { id: 'arbol', label: 'Tipos documentales', icon: FolderTree, permiso: 'gestionar_tipos_documentales' },
  ] as { id: Tab; label: string; icon: typeof FolderTree; permiso?: string }[])
    .filter((t) => puede(t.permiso))

  const [tab, setTab] = useState<Tab>(
    initialPersonaId ? 'consultar' : (TABS[0]?.id ?? 'consultar'),
  )

  return (
    <div className="space-y-5">
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

      {tab === 'arbol' && <TipoTree tipos={tipos} onChange={setTipos} />}
      {tab === 'escaner' && <EscanerDocumentos personas={personas} tipos={tipos} initialPersonaId={initialPersonaId} />}
      {tab === 'clasificar' && <ClasificarIA personas={personas} tipos={tipos} initialPersonaId={initialPersonaId} />}
      {tab === 'subir' && <SubirDocumentos personas={personas} tipos={tipos} />}
      {tab === 'consultar' && <DocumentosPersona personas={personas} tipos={tipos} initialPersonaId={initialPersonaId} />}
      {tab === 'cumplimiento' && <CumplimientoDashboard tipos={tipos} />}
    </div>
  )
}

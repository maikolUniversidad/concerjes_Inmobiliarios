'use client'

import { useState } from 'react'
import { UserCheck, Brain, FolderOpen, User } from 'lucide-react'
import { TabPersonal } from './TabPersonal'
import { TabDocumentos } from './TabDocumentos'
import { PruebasSeleccion } from './TabEvaluaciones'
import type { PropsTab } from './tipos'

/* eslint-disable @typescript-eslint/no-explicit-any */

type Vista = 'registro' | 'pruebas'

/**
 * Etapa 1 · Postulación. Abre en «Registro y validación»: los datos que el
 * candidato registró al lado de sus documentos, para compararlos y validar.
 * «Pruebas» muestra los resultados de las pruebas de selección.
 */
export function TabPostulacion(props: PropsTab) {
  const { d } = props
  const [vista, setVista] = useState<Vista>('registro')
  const obligatorias = d.pruebas.filter((p: any) => p.obligatoria)
  const presentadas = obligatorias.filter((p: any) => p.intento_estado && p.intento_estado !== 'EN_CURSO').length

  const OPCIONES: { key: Vista; label: string; icono: React.ReactNode; nota?: string }[] = [
    { key: 'registro', label: 'Registro y validación', icono: <UserCheck className="h-4 w-4" /> },
    { key: 'pruebas', label: 'Pruebas de selección', icono: <Brain className="h-4 w-4" />, nota: `${presentadas}/${obligatorias.length}` },
  ]

  return (
    <div className="space-y-4">
      <div className="inline-flex rounded-xl border border-gray-200 bg-white p-1">
        {OPCIONES.map((o) => (
          <button key={o.key} type="button" onClick={() => setVista(o.key)}
            className={'flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold ' +
              (vista === o.key ? 'bg-brand-green text-white' : 'text-gray-600 hover:bg-gray-50')}>
            {o.icono}{o.label}
            {o.nota && <span className={'rounded-full px-1.5 text-[10px] ' + (vista === o.key ? 'bg-white/20' : 'bg-gray-100 text-gray-500')}>{o.nota}</span>}
          </button>
        ))}
      </div>

      {vista === 'registro' ? (
        <div className="grid gap-4 xl:grid-cols-2">
          <div className="space-y-2">
            <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-gray-500"><User className="h-3.5 w-3.5" /> Datos que registró</p>
            <TabPersonal {...props} columnas={1} />
          </div>
          <div className="space-y-2">
            <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-gray-500"><FolderOpen className="h-3.5 w-3.5" /> Documentos que subió</p>
            <TabDocumentos {...props} olas={[1]} />
          </div>
        </div>
      ) : (
        <PruebasSeleccion {...props} />
      )}
    </div>
  )
}

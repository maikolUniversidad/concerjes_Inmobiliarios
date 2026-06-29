'use client'
import { useState } from 'react'
import { Package, Truck, Users, History } from 'lucide-react'
import { BulkImport } from '@/components/import/BulkImport'
import { PRODUCTOS_CONFIG, PROVEEDORES_CONFIG, USUARIOS_CONFIG } from '@/lib/import/config'

export interface HistorialCarga {
  id: string
  entidad: string
  archivo_nombre: string | null
  total: number
  creados: number
  actualizados: number
  errores: number
  usuario_email: string | null
  created_at: string
}

interface Props {
  existentes: { productos: string[]; proveedores: string[]; usuarios: string[] }
  historial: HistorialCarga[]
}

const TABS = [
  { id: 'productos', label: 'Productos', icon: Package, config: PRODUCTOS_CONFIG },
  { id: 'proveedores', label: 'Proveedores', icon: Truck, config: PROVEEDORES_CONFIG },
  { id: 'usuarios', label: 'Usuarios', icon: Users, config: USUARIOS_CONFIG },
] as const

const ENTIDAD_LABEL: Record<string, string> = { productos: 'Productos', proveedores: 'Proveedores', usuarios: 'Usuarios' }

export function ImportarClient({ existentes, historial }: Props) {
  const [tab, setTab] = useState<'productos' | 'proveedores' | 'usuarios'>('productos')
  const activa = TABS.find(t => t.id === tab)!

  return (
    <div className="space-y-6">
      {/* Tabs */}
      <div className="flex gap-2 flex-wrap">
        {TABS.map(t => {
          const Icon = t.icon
          const active = tab === t.id
          return (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`flex items-center gap-2 font-body font-semibold text-sm px-4 py-2.5 rounded-xl border transition-colors
                ${active ? 'bg-brand-green text-white border-brand-green' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}>
              <Icon className="w-4 h-4" /> {t.label}
            </button>
          )
        })}
      </div>

      <BulkImport key={tab} config={activa.config} existentes={existentes[tab]} />

      {/* Historial de cargas */}
      <div className="bg-white border border-gray-100 rounded-2xl shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100 flex items-center gap-2">
          <History className="w-4 h-4 text-brand-green" />
          <h3 className="font-heading font-semibold text-sm text-gray-900">Historial de cargas recientes</h3>
        </div>
        {historial.length === 0 ? (
          <p className="px-5 py-8 text-center font-body text-sm text-gray-400">Aún no se han realizado cargas masivas.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <th className="text-left font-body font-semibold text-xs text-gray-500 uppercase px-4 py-2.5">Entidad</th>
                  <th className="text-left font-body font-semibold text-xs text-gray-500 uppercase px-4 py-2.5">Archivo</th>
                  <th className="text-right font-body font-semibold text-xs text-gray-500 uppercase px-4 py-2.5">Creados</th>
                  <th className="text-right font-body font-semibold text-xs text-gray-500 uppercase px-4 py-2.5">Actualizados</th>
                  <th className="text-right font-body font-semibold text-xs text-gray-500 uppercase px-4 py-2.5">Errores</th>
                  <th className="text-left font-body font-semibold text-xs text-gray-500 uppercase px-4 py-2.5">Usuario</th>
                  <th className="text-right font-body font-semibold text-xs text-gray-500 uppercase px-4 py-2.5">Fecha</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {historial.map(h => (
                  <tr key={h.id} className="hover:bg-gray-50/50">
                    <td className="px-4 py-2.5 font-body text-sm text-gray-900">{ENTIDAD_LABEL[h.entidad] ?? h.entidad}</td>
                    <td className="px-4 py-2.5 font-body text-xs text-gray-500 max-w-[180px] truncate">{h.archivo_nombre ?? '—'}</td>
                    <td className="px-4 py-2.5 text-right font-body text-sm text-green-700 font-semibold">{h.creados}</td>
                    <td className="px-4 py-2.5 text-right font-body text-sm text-blue-700 font-semibold">{h.actualizados}</td>
                    <td className="px-4 py-2.5 text-right font-body text-sm text-red-600 font-semibold">{h.errores}</td>
                    <td className="px-4 py-2.5 font-body text-xs text-gray-500 max-w-[160px] truncate">{h.usuario_email ?? '—'}</td>
                    <td className="px-4 py-2.5 text-right font-body text-xs text-gray-400">{new Date(h.created_at).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

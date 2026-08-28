'use client'
import { useState } from 'react'
import { Package, Truck, Users, History, Building2, MapPin } from 'lucide-react'
import { BulkImport } from '@/components/import/BulkImport'
import { TablaEstandar, type ColumnaTabla } from '@/components/ui/tabla'
import {
  PRODUCTOS_CONFIG, PROVEEDORES_CONFIG, USUARIOS_CONFIG,
  EMPRESAS_USUARIAS_CONFIG, SEDES_CONFIG,
} from '@/lib/import/config'

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

type TabId = 'productos' | 'proveedores' | 'usuarios' | 'empresas_usuarias' | 'sedes'

interface Props {
  existentes: Record<TabId, string[]>
  historial: HistorialCarga[]
}

const TABS = [
  { id: 'productos', label: 'Productos', icon: Package, config: PRODUCTOS_CONFIG },
  { id: 'empresas_usuarias', label: 'Clientes', icon: Building2, config: EMPRESAS_USUARIAS_CONFIG },
  { id: 'sedes', label: 'Sedes', icon: MapPin, config: SEDES_CONFIG },
  { id: 'proveedores', label: 'Proveedores', icon: Truck, config: PROVEEDORES_CONFIG },
  { id: 'usuarios', label: 'Usuarios', icon: Users, config: USUARIOS_CONFIG },
] as const

const ENTIDAD_LABEL: Record<string, string> = {
  productos: 'Productos', proveedores: 'Proveedores', usuarios: 'Usuarios',
  empresas_usuarias: 'Clientes', sedes: 'Sedes', personas: 'Personas',
}

export function ImportarClient({ existentes, historial }: Props) {
  const [tab, setTab] = useState<TabId>('productos')
  const activa = TABS.find(t => t.id === tab)!

  const columnasHistorial: ColumnaTabla<HistorialCarga>[] = [
    { id: 'entidad', header: 'Entidad', valor: (h) => ENTIDAD_LABEL[h.entidad] ?? h.entidad, className: 'text-gray-900', tarjeta: 'titulo' },
    { id: 'archivo', header: 'Archivo', valor: (h) => h.archivo_nombre ?? '', ancho: 'max-w-[180px]', className: 'truncate text-xs text-gray-500', tarjeta: 'subtitulo' },
    { id: 'total', header: 'Filas', valor: (h) => h.total, align: 'right', prioridad: 3, className: 'text-gray-600', tarjeta: 'meta' },
    { id: 'creados', header: 'Creados', valor: (h) => h.creados, align: 'right', className: 'font-semibold text-green-700', tarjeta: 'meta' },
    { id: 'actualizados', header: 'Actualizados', valor: (h) => h.actualizados, align: 'right', prioridad: 2, className: 'font-semibold text-blue-700', tarjeta: 'meta' },
    { id: 'errores', header: 'Errores', valor: (h) => h.errores, align: 'right', className: 'font-semibold text-red-600', tarjeta: 'badge' },
    { id: 'usuario', header: 'Usuario', valor: (h) => h.usuario_email ?? '', prioridad: 2, ancho: 'max-w-[160px]', className: 'truncate text-xs text-gray-500', tarjeta: 'meta' },
    {
      id: 'fecha', header: 'Fecha', align: 'right', prioridad: 2, className: 'text-xs text-gray-400 whitespace-nowrap', tarjeta: 'meta',
      valor: (h) => new Date(h.created_at).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' }),
    },
  ]

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
        <div className="p-4">
          <TablaEstandar
            id="importar-historial"
            titulo="Historial de cargas"
            modulo="Sistema"
            entidad="cargas_masivas"
            datos={historial}
            columnas={columnasHistorial}
            filaId={(h) => h.id}
            busqueda="Buscar por entidad, archivo o usuario…"
            vacio={<p className="font-body text-sm text-gray-400">Aún no se han realizado cargas masivas.</p>}
          />
        </div>
      </div>
    </div>
  )
}

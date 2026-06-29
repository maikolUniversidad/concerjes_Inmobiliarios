import type { Metadata } from 'next'
import { Package, Plus, Search, Filter, Download } from 'lucide-react'
import Link from 'next/link'
import { CATEGORIA_LABELS, type CategoriaRotacion, type TipoInsumo } from '@/lib/types/database'

export const metadata: Metadata = { title: 'Productos' }

const TIPOS: TipoInsumo[] = ['CAFETERIA','LIQUIDOS','ASEO','EPP','PAPELERIA','MAQUINARIA','JARDINERIA','REPUESTOS','NO_DISPONIBLE','OTROS']
const CATS: CategoriaRotacion[] = ['A','B','C','D']

// Mock data - reemplazar con query Supabase
const mockProductos = [
  { id:'1', ref:720, codigo:1, nombre_estandar:'CAFE SOCIAL ORGANICO Y/O ARTESANAL', presentacion:'PAQUETE X LIBRA', tipo_insumo:'CAFETERIA' as TipoInsumo, cat_rotacion:'A' as CategoriaRotacion, stock_actual:183, stock_minimo_def:50 },
  { id:'2', ref:719, codigo:2, nombre_estandar:'CAFE SOCIAL TIPO BORBON 100% TOSTADO', presentacion:'PAQUETE X LIBRA', tipo_insumo:'CAFETERIA' as TipoInsumo, cat_rotacion:'A' as CategoriaRotacion, stock_actual:387, stock_minimo_def:40 },
  { id:'3', ref:718, codigo:3, nombre_estandar:'JABON PARA LOZA LIQUIDO CON FRAGANCIA', presentacion:'GALON', tipo_insumo:'LIQUIDOS' as TipoInsumo, cat_rotacion:'A' as CategoriaRotacion, stock_actual:188, stock_minimo_def:80 },
  { id:'4', ref:717, codigo:4, nombre_estandar:'JABON PARA LOZA LIQUIDO CON FRAGANCIA', presentacion:'TARRO X 500 ML', tipo_insumo:'LIQUIDOS' as TipoInsumo, cat_rotacion:'A' as CategoriaRotacion, stock_actual:63, stock_minimo_def:30 },
  { id:'5', ref:716, codigo:5, nombre_estandar:'HOMOLOGO JABON PARA LOZA EN CREMA', presentacion:'TARRO X 900 GR', tipo_insumo:'NO_DISPONIBLE' as TipoInsumo, cat_rotacion:'D' as CategoriaRotacion, stock_actual:0, stock_minimo_def:0 },
  { id:'6', ref:715, codigo:6, nombre_estandar:'JABON MULTIUSOS CONCENTRADO', presentacion:'TARRO X KILO', tipo_insumo:'ASEO' as TipoInsumo, cat_rotacion:'A' as CategoriaRotacion, stock_actual:40, stock_minimo_def:20 },
]

function getStockStatus(actual: number, minimo: number) {
  if (actual === 0) return { label: 'Agotado', color: 'bg-red-100 text-red-700' }
  if (actual <= minimo) return { label: 'Crítico', color: 'bg-orange-100 text-orange-700' }
  if (actual <= minimo * 1.5) return { label: 'Bajo', color: 'bg-yellow-100 text-yellow-700' }
  return { label: 'Normal', color: 'bg-green-100 text-green-700' }
}

export default function ProductosPage() {
  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-heading font-bold text-2xl text-gray-900">Catálogo de Productos</h1>
          <p className="font-body text-sm text-gray-500 mt-0.5">~720 productos · Basado en CMI Reabastecimiento</p>
        </div>
        <div className="flex gap-2">
          <button className="flex items-center gap-2 border border-gray-200 text-gray-600 font-body text-sm px-4 py-2 rounded-lg hover:bg-gray-50 transition-colors">
            <Download className="w-4 h-4" />
            Exportar
          </button>
          <Link
            href="/productos/nuevo"
            className="flex items-center gap-2 bg-brand-green text-white font-body font-semibold text-sm px-4 py-2 rounded-lg hover:bg-brand-green-dark transition-colors shadow-sm"
          >
            <Plus className="w-4 h-4" />
            Nuevo producto
          </Link>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white border border-gray-100 rounded-xl p-4 flex flex-wrap gap-3 shadow-sm">
        <div className="flex items-center gap-2 border border-gray-200 rounded-lg px-3 py-2 flex-1 min-w-[200px]">
          <Search className="w-4 h-4 text-gray-400 shrink-0" />
          <input
            placeholder="Buscar por nombre, REF o código..."
            className="font-body text-sm flex-1 outline-none placeholder:text-gray-400"
          />
        </div>
        <select className="border border-gray-200 rounded-lg px-3 py-2 font-body text-sm text-gray-700 outline-none focus:border-brand-green min-w-[140px] bg-white">
          <option value="">Tipo insumo</option>
          {TIPOS.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <select className="border border-gray-200 rounded-lg px-3 py-2 font-body text-sm text-gray-700 outline-none focus:border-brand-green min-w-[120px] bg-white">
          <option value="">Categoría</option>
          {CATS.map(c => <option key={c} value={c}>Cat. {c} — {CATEGORIA_LABELS[c].label}</option>)}
        </select>
        <select className="border border-gray-200 rounded-lg px-3 py-2 font-body text-sm text-gray-700 outline-none focus:border-brand-green min-w-[120px] bg-white">
          <option value="">Estado stock</option>
          <option value="critico">Crítico</option>
          <option value="agotado">Agotado</option>
          <option value="normal">Normal</option>
        </select>
      </div>

      {/* Stats chips */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Total productos', value: '720', color: 'bg-blue-50 text-blue-700 border-blue-100' },
          { label: 'Cat. A (alta rot.)', value: '284', color: 'bg-green-50 text-green-700 border-green-100' },
          { label: 'Stock crítico', value: '23', color: 'bg-red-50 text-red-700 border-red-100' },
          { label: 'No disponibles', value: '45', color: 'bg-gray-50 text-gray-600 border-gray-100' },
        ].map(s => (
          <div key={s.label} className={`rounded-xl border p-3 ${s.color}`}>
            <p className="font-heading font-bold text-xl">{s.value}</p>
            <p className="font-body text-xs mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Table */}
      <div className="bg-white border border-gray-100 rounded-xl shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                <th className="text-left font-body font-semibold text-xs text-gray-500 uppercase tracking-wide px-4 py-3">REF</th>
                <th className="text-left font-body font-semibold text-xs text-gray-500 uppercase tracking-wide px-4 py-3">Producto</th>
                <th className="text-left font-body font-semibold text-xs text-gray-500 uppercase tracking-wide px-4 py-3 hidden md:table-cell">Tipo</th>
                <th className="text-center font-body font-semibold text-xs text-gray-500 uppercase tracking-wide px-4 py-3">Cat.</th>
                <th className="text-right font-body font-semibold text-xs text-gray-500 uppercase tracking-wide px-4 py-3">Stock</th>
                <th className="text-center font-body font-semibold text-xs text-gray-500 uppercase tracking-wide px-4 py-3">Estado</th>
                <th className="text-center font-body font-semibold text-xs text-gray-500 uppercase tracking-wide px-4 py-3">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {mockProductos.map((p) => {
                const status = getStockStatus(p.stock_actual, p.stock_minimo_def)
                const cat = CATEGORIA_LABELS[p.cat_rotacion]
                return (
                  <tr key={p.id} className="hover:bg-gray-50/50 transition-colors">
                    <td className="px-4 py-3">
                      <span className="font-body text-xs font-mono text-gray-500 bg-gray-100 px-2 py-0.5 rounded">
                        {p.ref ?? p.codigo}
                      </span>
                    </td>
                    <td className="px-4 py-3 max-w-[280px]">
                      <p className="font-body font-medium text-sm text-gray-900 truncate">{p.nombre_estandar}</p>
                      <p className="font-body text-xs text-gray-400">{p.presentacion}</p>
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell">
                      <span className="font-body text-xs text-gray-600 bg-gray-100 px-2 py-0.5 rounded">
                        {p.tipo_insumo}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`font-body font-bold text-xs px-2 py-1 rounded-full ${cat.bg} ${cat.color}`}>
                        {p.cat_rotacion}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className="font-heading font-bold text-base text-gray-900">{p.stock_actual}</span>
                      <span className="font-body text-xs text-gray-400 ml-1">/ mín {p.stock_minimo_def}</span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`font-body text-xs font-medium px-2.5 py-1 rounded-full ${status.color}`}>
                        {status.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <div className="flex items-center justify-center gap-1">
                        <Link
                          href={`/productos/${p.id}`}
                          className="text-xs font-body text-brand-green hover:underline px-2 py-1"
                        >
                          Ver
                        </Link>
                        <Link
                          href={`/productos/${p.id}/editar`}
                          className="text-xs font-body text-gray-500 hover:text-gray-700 px-2 py-1"
                        >
                          Editar
                        </Link>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="border-t border-gray-100 px-4 py-3 flex items-center justify-between">
          <p className="font-body text-xs text-gray-500">Mostrando 6 de 720 productos</p>
          <div className="flex gap-1">
            {[1,2,3,'...',72].map((p, i) => (
              <button key={i} className={`w-8 h-8 rounded-lg font-body text-xs transition-colors ${p === 1 ? 'bg-brand-green text-white' : 'text-gray-600 hover:bg-gray-100'}`}>
                {p}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

'use client'
import { useState, useMemo } from 'react'
import { Boxes, TrendingDown, TrendingUp, AlertCircle, Search } from 'lucide-react'
import Link from 'next/link'
import { CATEGORIA_LABELS, type CategoriaRotacion } from '@/lib/types/database'

export interface StockRow {
  id: string
  ref: number | null
  nombre: string
  presentacion: string | null
  cat: CategoriaRotacion
  real: number
  disp: number
  entrante: number
  saliente: number
  minimo: number
}

function estado(real: number, minimo: number) {
  if (minimo <= 0 && real === 0) return { key: 'nd', label: 'N/D', cls: 'bg-gray-100 text-gray-400' }
  if (real === 0) return { key: 'critico', label: 'Agotado', cls: 'bg-red-100 text-red-700' }
  if (real <= minimo) return { key: 'critico', label: 'Crítico', cls: 'bg-red-100 text-red-700' }
  if (real <= minimo * 1.5) return { key: 'bajo', label: 'Bajo', cls: 'bg-yellow-100 text-yellow-700' }
  return { key: 'normal', label: 'Normal', cls: 'bg-green-100 text-green-700' }
}

export function StockClient({ rows }: { rows: StockRow[] }) {
  const [search, setSearch] = useState('')
  const [filtro, setFiltro] = useState('')

  const filtered = useMemo(() => rows.filter(r => {
    const q = search.toLowerCase()
    const matchSearch = !q || r.nombre.toLowerCase().includes(q) || String(r.ref).includes(q)
    const e = estado(r.real, r.minimo).key
    const matchFiltro = !filtro || (filtro === 'alerta' ? (e === 'critico' || e === 'bajo') : e === filtro)
    return matchSearch && matchFiltro
  }), [rows, search, filtro])

  const totalReal = rows.reduce((a, s) => a + s.real, 0)
  const totalEntrante = rows.reduce((a, s) => a + s.entrante, 0)
  const totalSaliente = rows.reduce((a, s) => a + s.saliente, 0)
  const alertas = rows.filter(s => { const e = estado(s.real, s.minimo).key; return e === 'critico' || e === 'bajo' }).length

  const kpis = [
    { icon: Boxes, label: 'Unidades totales', value: totalReal.toLocaleString('es-CO'), color: 'text-blue-600', bg: 'bg-blue-50 border-blue-100' },
    { icon: TrendingUp, label: 'Entrante', value: '+' + totalEntrante.toLocaleString('es-CO'), color: 'text-green-600', bg: 'bg-green-50 border-green-100' },
    { icon: TrendingDown, label: 'Saliente', value: '-' + totalSaliente.toLocaleString('es-CO'), color: 'text-orange-600', bg: 'bg-orange-50 border-orange-100' },
    { icon: AlertCircle, label: 'Alertas stock', value: alertas.toString(), color: 'text-red-600', bg: 'bg-red-50 border-red-100' },
  ]

  return (
    <div className="space-y-5">
      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {kpis.map(k => (
          <div key={k.label} className={`rounded-xl border p-4 ${k.bg} flex items-start gap-3`}>
            <k.icon className={`w-5 h-5 mt-0.5 ${k.color}`} />
            <div>
              <p className="font-heading font-bold text-2xl text-gray-900">{k.value}</p>
              <p className={`font-body text-xs ${k.color}`}>{k.label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Filtros */}
      <div className="bg-white border border-gray-100 rounded-xl p-4 flex flex-wrap gap-3 shadow-sm items-center">
        <div className="flex items-center gap-2 border border-gray-200 rounded-lg px-3 py-2 flex-1 min-w-[200px]">
          <Search className="w-4 h-4 text-gray-400 shrink-0" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar por nombre o REF..."
            className="font-body text-sm flex-1 outline-none placeholder:text-gray-400" />
        </div>
        <select value={filtro} onChange={e => setFiltro(e.target.value)}
          className="border border-gray-200 rounded-lg px-3 py-2 font-body text-sm text-gray-700 outline-none bg-white">
          <option value="">Todos los estados</option>
          <option value="alerta">Con alerta (crítico/bajo)</option>
          <option value="critico">Crítico / Agotado</option>
          <option value="bajo">Bajo</option>
          <option value="normal">Normal</option>
        </select>
        <Link href="/movimientos/nuevo" className="ml-auto bg-brand-green text-white font-body font-semibold text-sm px-4 py-2 rounded-lg hover:bg-brand-green-dark transition-colors">
          Registrar movimiento
        </Link>
      </div>

      {/* Tabla */}
      <div className="bg-white border border-gray-100 rounded-xl shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                <th className="text-left font-body font-semibold text-xs text-gray-500 uppercase px-4 py-3">Producto</th>
                <th className="text-center font-body font-semibold text-xs text-gray-500 uppercase px-4 py-3">Cat.</th>
                <th className="text-right font-body font-semibold text-xs text-gray-500 uppercase px-4 py-3 bg-gray-100/60">Real</th>
                <th className="text-right font-body font-semibold text-xs text-green-600 uppercase px-4 py-3 bg-green-50">Disp.</th>
                <th className="text-right font-body font-semibold text-xs text-blue-600 uppercase px-4 py-3 bg-blue-50">Entr.</th>
                <th className="text-right font-body font-semibold text-xs text-orange-600 uppercase px-4 py-3 bg-orange-50">Sal.</th>
                <th className="text-right font-body font-semibold text-xs text-gray-500 uppercase px-4 py-3">Mín.</th>
                <th className="text-center font-body font-semibold text-xs text-gray-500 uppercase px-4 py-3">Estado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filtered.map(s => {
                const e = estado(s.real, s.minimo)
                const cat = CATEGORIA_LABELS[s.cat]
                return (
                  <tr key={s.id} className={`hover:bg-gray-50/50 transition-colors ${e.key === 'critico' ? 'bg-red-50/20' : ''}`}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs text-gray-400">{s.ref ?? '—'}</span>
                        <div>
                          <Link href={`/productos/${s.id}`} className="font-body font-medium text-sm text-gray-900 hover:text-brand-green">{s.nombre}</Link>
                          <p className="font-body text-xs text-gray-400">{s.presentacion}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`font-body font-bold text-xs px-2 py-0.5 rounded-full ${cat.bg} ${cat.color}`}>{s.cat}</span>
                    </td>
                    <td className="px-4 py-3 text-right bg-gray-50/40"><span className="font-heading font-bold text-base text-gray-900">{s.real}</span></td>
                    <td className="px-4 py-3 text-right bg-green-50/30"><span className="font-heading font-semibold text-sm text-green-700">{s.disp}</span></td>
                    <td className="px-4 py-3 text-right bg-blue-50/30">{s.entrante > 0 ? <span className="font-body text-sm text-blue-600 font-semibold">+{s.entrante}</span> : <span className="text-gray-300 text-xs">—</span>}</td>
                    <td className="px-4 py-3 text-right bg-orange-50/30">{s.saliente > 0 ? <span className="font-body text-sm text-orange-600 font-semibold">-{s.saliente}</span> : <span className="text-gray-300 text-xs">—</span>}</td>
                    <td className="px-4 py-3 text-right font-body text-sm text-gray-500">{s.minimo || '—'}</td>
                    <td className="px-4 py-3 text-center"><span className={`font-body text-xs font-medium px-2.5 py-1 rounded-full ${e.cls}`}>{e.label}</span></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <div className="border-t border-gray-100 px-4 py-3">
          <p className="font-body text-xs text-gray-500">Mostrando {filtered.length} de {rows.length} productos</p>
        </div>
      </div>

      {filtered.length === 0 && (
        <div className="text-center py-12 text-gray-400">
          <p className="font-heading font-bold">Sin resultados</p>
          <p className="font-body text-sm mt-1">Ajusta la búsqueda o los filtros</p>
        </div>
      )}
    </div>
  )
}

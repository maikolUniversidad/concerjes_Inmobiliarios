import type { Metadata } from 'next'
import Link from 'next/link'
import { Package, AlertTriangle, TrendingUp, ArrowLeftRight, Boxes, Users, Share2, ChevronRight } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { requirePermiso } from '@/lib/permisos-server'
import type { CategoriaRotacion, TipoInsumo } from '@/lib/types/database'
import { ReportesExport } from './ReportesExport'

export const metadata: Metadata = { title: 'Reportes' }
export const revalidate = 0

const cop = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 })

interface Prod {
  tipo_insumo: TipoInsumo
  cat_rotacion: CategoriaRotacion
  stock_minimo_def: number
  precio_lista: number | null
  stock: { cantidad_real: number } | null
}

interface ActLog { usuario_nombre: string | null; usuario_email: string | null; modulo: string | null; created_at: string }
interface UsuarioActividad { clave: string; nombre: string; email: string; total: number; modulos: Set<string>; ultima: string }

export default async function ReportesPage() {
  await requirePermiso('ver_reportes')
  const supabase = await createClient()

  const { data: prodRaw } = await supabase
    .from('productos')
    .select('tipo_insumo, cat_rotacion, stock_minimo_def, precio_lista, stock ( cantidad_real )')
    .eq('activo', true)
  const productos = (prodRaw as unknown as Prod[]) ?? []

  const desde = new Date(); desde.setDate(desde.getDate() - 30)
  const { count: movs30 } = await supabase
    .from('movimientos')
    .select('*', { count: 'exact', head: true })
    .gte('created_at', desde.toISOString())

  // Actividad por usuario (qué ha hecho cada quien)
  const { data: actsRaw } = await supabase
    .from('actividad_log')
    .select('usuario_nombre, usuario_email, modulo, created_at')
    .order('created_at', { ascending: false })
    .limit(5000)
  const acts = (actsRaw as unknown as ActLog[]) ?? []
  const mapaUsuarios = new Map<string, UsuarioActividad>()
  for (const a of acts) {
    const clave = a.usuario_email || a.usuario_nombre || '—'
    let e = mapaUsuarios.get(clave)
    if (!e) { e = { clave, nombre: a.usuario_nombre || clave, email: a.usuario_email || '', total: 0, modulos: new Set(), ultima: a.created_at }; mapaUsuarios.set(clave, e) }
    e.total++
    if (a.modulo) e.modulos.add(a.modulo)
  }
  const usuariosAct = [...mapaUsuarios.values()].sort((x, y) => y.total - x.total)

  const totalProductos = productos.length
  const valorInventario = productos.reduce((a, p) => a + (p.stock?.cantidad_real ?? 0) * (p.precio_lista ?? 0), 0)
  const unidades = productos.reduce((a, p) => a + (p.stock?.cantidad_real ?? 0), 0)
  const criticos = productos.filter(p => p.stock_minimo_def > 0 && (p.stock?.cantidad_real ?? 0) <= p.stock_minimo_def).length

  // Por tipo de insumo
  const porTipo = new Map<string, number>()
  productos.forEach(p => porTipo.set(p.tipo_insumo, (porTipo.get(p.tipo_insumo) ?? 0) + 1))
  const tipos = [...porTipo.entries()].sort((a, b) => b[1] - a[1])
  const maxTipo = Math.max(1, ...tipos.map(t => t[1]))

  // Por categoría de rotación
  const cats: CategoriaRotacion[] = ['A', 'B', 'C', 'D']
  const porCat = cats.map(c => ({ cat: c, n: productos.filter(p => p.cat_rotacion === c).length }))

  const kpis = [
    { label: 'Productos activos', value: totalProductos.toLocaleString('es-CO'), icon: Package, color: 'bg-blue-50 text-blue-600' },
    { label: 'Unidades en stock', value: unidades.toLocaleString('es-CO'), icon: Boxes, color: 'bg-indigo-50 text-indigo-600' },
    { label: 'Valor inventario', value: cop.format(valorInventario), icon: TrendingUp, color: 'bg-amber-50 text-amber-600' },
    { label: 'Stock crítico', value: criticos.toString(), icon: AlertTriangle, color: 'bg-red-50 text-red-600' },
    { label: 'Movimientos (30d)', value: (movs30 ?? 0).toLocaleString('es-CO'), icon: ArrowLeftRight, color: 'bg-green-50 text-green-600' },
  ]

  return (
    <div className="p-4 sm:p-6 space-y-5">
      <div>
        <h1 className="font-heading font-bold text-2xl text-gray-900">Reportes</h1>
        <p className="font-body text-sm text-gray-500 mt-0.5">Indicadores del inventario en tiempo real</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {kpis.map(k => (
          <div key={k.label} className="bg-white border border-gray-100 rounded-2xl p-4 shadow-sm">
            <div className={`w-9 h-9 rounded-xl ${k.color} flex items-center justify-center mb-3`}>
              <k.icon className="w-4.5 h-4.5" />
            </div>
            <p className="font-heading font-bold text-xl text-gray-900">{k.value}</p>
            <p className="font-body text-xs text-gray-500 mt-0.5">{k.label}</p>
          </div>
        ))}
      </div>

      <div className="grid lg:grid-cols-2 gap-5">
        {/* Por tipo de insumo */}
        <div className="bg-white border border-gray-100 rounded-2xl p-6 shadow-sm">
          <h2 className="font-heading font-semibold text-lg text-gray-900 mb-4">Productos por tipo de insumo</h2>
          <div className="space-y-3">
            {tipos.map(([tipo, n]) => (
              <div key={tipo}>
                <div className="flex justify-between font-body text-xs text-gray-600 mb-1">
                  <span>{tipo}</span><span className="font-semibold">{n}</span>
                </div>
                <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                  <div className="h-full bg-brand-green rounded-full" style={{ width: `${(n / maxTipo) * 100}%` }} />
                </div>
              </div>
            ))}
            {tipos.length === 0 && <p className="font-body text-sm text-gray-400">Sin datos</p>}
          </div>
        </div>

        {/* Por categoría */}
        <div className="bg-white border border-gray-100 rounded-2xl p-6 shadow-sm">
          <h2 className="font-heading font-semibold text-lg text-gray-900 mb-4">Distribución por rotación (A/B/C/D)</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {porCat.map(({ cat, n }) => (
              <div key={cat} className="text-center rounded-xl border border-gray-100 p-4">
                <p className="font-heading font-bold text-2xl text-gray-900">{n}</p>
                <p className="font-body text-xs text-gray-500 mt-1">Cat. {cat}</p>
              </div>
            ))}
          </div>
          <p className="font-body text-xs text-gray-400 mt-4">
            La categoría A corresponde a productos de alta rotación; D a no disponibles.
          </p>
        </div>
      </div>

      {/* Exportar a Excel + Grafo de relaciones */}
      <div className="grid lg:grid-cols-[2fr,1fr] gap-5">
        <ReportesExport />
        <Link href="/reportes/grafo"
          className="bg-gradient-to-br from-brand-green to-brand-green-mid rounded-2xl p-6 text-white shadow-sm hover:shadow-md transition-shadow flex flex-col">
          <Share2 className="w-6 h-6 text-green-200 mb-2" />
          <h2 className="font-heading font-bold text-lg">Grafo de relaciones</h2>
          <p className="font-body text-sm text-green-100 mt-1 flex-1">
            Visualiza cómo se conectan todas las tablas del sistema: productos, stock, movimientos, bodegas, usuarios y más.
          </p>
          <span className="mt-3 inline-flex items-center gap-1 font-body font-semibold text-sm">
            Abrir grafo <ChevronRight className="w-4 h-4" />
          </span>
        </Link>
      </div>

      {/* Actividad por usuario */}
      <div className="bg-white border border-gray-100 rounded-2xl shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center gap-2">
          <Users className="w-5 h-5 text-brand-green" />
          <h2 className="font-heading font-semibold text-lg text-gray-900">Actividad por usuario</h2>
          <span className="font-body text-xs text-gray-400 ml-auto">qué ha hecho cada quien</span>
        </div>
        {usuariosAct.length === 0 ? (
          <p className="px-6 py-8 text-center font-body text-sm text-gray-400">
            Aún no hay actividad registrada. Las acciones de los usuarios aparecerán aquí.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <th className="text-left font-body font-semibold text-xs text-gray-500 uppercase px-6 py-3">Usuario</th>
                  <th className="text-right font-body font-semibold text-xs text-gray-500 uppercase px-4 py-3">Acciones</th>
                  <th className="text-left font-body font-semibold text-xs text-gray-500 uppercase px-4 py-3">Módulos</th>
                  <th className="text-right font-body font-semibold text-xs text-gray-500 uppercase px-6 py-3">Última actividad</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {usuariosAct.map(u => (
                  <tr key={u.clave} className="hover:bg-gray-50/50">
                    <td className="px-6 py-3">
                      <p className="font-body font-medium text-sm text-gray-900">{u.nombre}</p>
                      {u.email && <p className="font-body text-xs text-gray-400">{u.email}</p>}
                    </td>
                    <td className="px-4 py-3 text-right font-heading font-bold text-base text-gray-900">{u.total}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {[...u.modulos].slice(0, 6).map(m => (
                          <span key={m} className="font-body text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">{m}</span>
                        ))}
                        {u.modulos.size > 6 && <span className="font-body text-xs text-gray-400">+{u.modulos.size - 6}</span>}
                      </div>
                    </td>
                    <td className="px-6 py-3 text-right font-body text-xs text-gray-400">
                      {new Date(u.ultima).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="px-6 py-3 font-body text-xs text-gray-400">
              Basado en las últimas {acts.length.toLocaleString('es-CO')} acciones. Descarga el detalle completo en “Exportar datos → Auditoría”.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

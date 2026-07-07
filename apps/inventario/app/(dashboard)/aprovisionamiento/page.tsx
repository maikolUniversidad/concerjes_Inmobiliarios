import type { Metadata } from 'next'
import { RefreshCw, FileText, AlertTriangle, Download, ChevronRight } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { requirePermiso } from '@/lib/permisos-server'

export const metadata: Metadata = { title: 'Aprovisionamiento' }
export const revalidate = 0

function getCatColor(cat: string) {
  return (
    { A: 'bg-green-100 text-green-700', B: 'bg-blue-100 text-blue-700',
      C: 'bg-amber-100 text-amber-700', D: 'bg-red-100 text-red-700' }[cat]
    ?? 'bg-gray-100 text-gray-700'
  )
}

function getStockAlert(real: number, minimo: number) {
  if (real <= 0) return 'text-red-600 font-bold'
  if (real <= minimo) return 'text-red-600'
  if (real <= minimo * 1.5) return 'text-amber-600'
  return 'text-gray-900'
}

function formatCOP(n: number) {
  return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(n)
}

export default async function AprovisionamientoPage() {
  await requirePermiso('ver_aprovisionamiento')
  const supabase = await createClient()
  const periodo = 'JUNIO 2026'

  // Traer productos activos con su stock y datos de aprovisionamiento
  const [{ data: aprovData }, { data: gruposData }] = await Promise.all([
    supabase
      .from('aprovisionamiento')
      .select(`
        producto_id, pedido_calculado, pedido_ajustado, sugerido_compra,
        oc_pendiente, adicional, total_compras, saldo_insumos,
        productos!inner (
          codigo, nombre_estandar, presentacion, cat_rotacion, precio_lista, activo,
          stock ( cantidad_real, cantidad_disp )
        )
      `)
      .eq('periodo', '2026-06-01')
      .eq('productos.activo', true)
      .order('producto_id')
      .limit(300),
    supabase
      .from('pedidos_sede')
      .select(`
        producto_id, cantidad,
        sedes!inner ( grupo_id, grupos_contrato!inner ( codigo ) )
      `)
      .eq('periodo', '2026-06-01'),
  ])

  // Agrupar pedidos por producto_id + grupo
  type PedidosPorProducto = Record<string, Record<string, number>>
  const pedidosPorProd: PedidosPorProducto = {}
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const p of ((gruposData ?? []) as any[])) {
    const pid = p.producto_id
    const grupo = p.sedes?.grupos_contrato?.codigo as string
    if (!pid || !grupo) continue
    pedidosPorProd[pid] = pedidosPorProd[pid] ?? {}
    pedidosPorProd[pid][grupo] = (pedidosPorProd[pid][grupo] ?? 0) + Number(p.cantidad)
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = (aprovData ?? []).map((a: any) => {
    const prod = a.productos
    const stock = prod?.stock?.[0] ?? prod?.stock ?? {}
    const real = Number(stock.cantidad_real ?? 0)
    const minimo = Number(prod?.stock_minimo_def ?? 0)
    const precio = Number(prod?.precio_lista ?? 0)
    const total = Number(a.total_compras ?? 0)
    const pedidos = pedidosPorProd[a.producto_id] ?? {}
    return {
      producto_id: a.producto_id,
      codigo: prod?.codigo,
      nombre: prod?.nombre_estandar ?? '',
      presentacion: prod?.presentacion ?? '',
      cat: prod?.cat_rotacion ?? 'C',
      stock_real: real,
      stock_minimo: minimo,
      pedido_ca: pedidos['CA'] ?? 0,
      pedido_mo: pedidos['MO'] ?? 0,
      pedido_mb: pedidos['MB'] ?? 0,
      pedido_pb: pedidos['PB'] ?? 0,
      pedido_ad: pedidos['AD'] ?? 0,
      pedido_calculado: Number(a.pedido_calculado ?? 0),
      sugerido_compra: Number(a.sugerido_compra ?? 0),
      oc_pendiente: Number(a.oc_pendiente ?? 0),
      adicional: Number(a.adicional ?? 0),
      total_compras: total,
      precio,
    }
  }).filter(r => r.nombre)

  const totalComprar = rows.reduce((s, r) => s + r.total_compras, 0)
  const valorTotal   = rows.reduce((s, r) => s + r.total_compras * r.precio, 0)
  const enAlerta     = rows.filter(r => r.stock_real <= r.stock_minimo && r.stock_minimo > 0).length
  const conPedido    = rows.filter(r => r.total_compras > 0).length

  return (
    <div className="p-4 sm:p-6 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="font-heading font-bold text-2xl text-gray-900">Aprovisionamiento</h1>
            <span className="bg-brand-green text-white font-body text-xs font-semibold px-2.5 py-1 rounded-full">{periodo}</span>
          </div>
          <p className="font-body text-sm text-gray-500 mt-0.5">
            Plan de reabastecimiento · {rows.length} productos · datos reales CMI
          </p>
        </div>
        <div className="flex gap-2">
          <button className="flex items-center gap-2 border border-gray-200 text-gray-600 font-body text-sm px-4 py-2 rounded-lg hover:bg-gray-50 transition-colors">
            <Download className="w-4 h-4" />
            Exportar
          </button>
          <button className="flex items-center gap-2 bg-brand-green text-white font-body font-semibold text-sm px-4 py-2 rounded-lg hover:bg-brand-green-dark transition-colors shadow-sm">
            <FileText className="w-4 h-4" />
            Generar OC
          </button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: 'Productos a comprar', value: conPedido.toString(),   sub: `de ${rows.length} en plan`,  color: 'border-blue-200 bg-blue-50 text-blue-700' },
          { label: 'Unidades totales',    value: totalComprar.toString(), sub: 'en pedido calculado',        color: 'border-green-200 bg-green-50 text-green-700' },
          { label: 'Valor estimado',      value: formatCOP(valorTotal),   sub: 'precio lista',               color: 'border-purple-200 bg-purple-50 text-purple-700' },
          { label: 'En alerta stock',     value: enAlerta.toString(),     sub: 'bajo mínimo',                color: 'border-red-200 bg-red-50 text-red-700' },
        ].map(k => (
          <div key={k.label} className={`rounded-xl border p-4 ${k.color}`}>
            <p className="font-heading font-bold text-2xl">{k.value}</p>
            <p className="font-body font-semibold text-xs mt-0.5">{k.label}</p>
            <p className="font-body text-xs opacity-70">{k.sub}</p>
          </div>
        ))}
      </div>

      {/* Tabla */}
      <div className="bg-white border border-gray-100 rounded-xl shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
          <RefreshCw className="w-4 h-4 text-brand-green" />
          <h2 className="font-heading font-semibold text-sm text-gray-900">Plan de Reabastecimiento</h2>
          <span className="font-body text-xs text-gray-400 ml-auto">{rows.length} productos</span>
        </div>

        {rows.length === 0 ? (
          <div className="py-20 text-center">
            <p className="font-heading font-bold text-gray-400">Sin datos de aprovisionamiento para {periodo}</p>
            <p className="font-body text-sm text-gray-400 mt-1">Ejecuta el script de carga o genera el plan desde la hoja CMI</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <th className="text-left font-body font-semibold text-gray-500 uppercase tracking-wide px-3 py-2.5 min-w-[40px]">Cód</th>
                  <th className="text-left font-body font-semibold text-gray-500 uppercase tracking-wide px-3 py-2.5 min-w-[200px]">Producto</th>
                  <th className="text-center font-body font-semibold text-gray-500 uppercase tracking-wide px-3 py-2.5">Cat.</th>
                  <th className="text-right font-body font-semibold text-gray-500 uppercase tracking-wide px-3 py-2.5 bg-blue-50/50">Stock</th>
                  <th className="text-right font-body font-semibold text-gray-500 uppercase tracking-wide px-3 py-2.5 bg-blue-50/50">Mín.</th>
                  <th className="text-right font-body font-semibold text-blue-600 uppercase tracking-wide px-3 py-2.5 bg-blue-50">C.A.</th>
                  <th className="text-right font-body font-semibold text-purple-600 uppercase tracking-wide px-3 py-2.5 bg-purple-50">M.O.</th>
                  <th className="text-right font-body font-semibold text-green-600 uppercase tracking-wide px-3 py-2.5 bg-green-50">M.B.</th>
                  <th className="text-right font-body font-semibold text-orange-600 uppercase tracking-wide px-3 py-2.5 bg-orange-50">P.B.</th>
                  <th className="text-right font-body font-semibold text-gray-600 uppercase tracking-wide px-3 py-2.5 bg-gray-100">A.D.</th>
                  <th className="text-right font-body font-semibold text-gray-500 uppercase tracking-wide px-3 py-2.5">Ped. Calc.</th>
                  <th className="text-right font-body font-semibold text-gray-500 uppercase tracking-wide px-3 py-2.5">Sug. Compra</th>
                  <th className="text-right font-body font-semibold text-gray-500 uppercase tracking-wide px-3 py-2.5">OC Pend.</th>
                  <th className="text-right font-body font-semibold text-gray-500 uppercase tracking-wide px-3 py-2.5">Adicional</th>
                  <th className="text-right font-body font-semibold text-brand-green uppercase tracking-wide px-3 py-2.5 bg-green-50">Total</th>
                  <th className="text-right font-body font-semibold text-gray-500 uppercase tracking-wide px-3 py-2.5">Valor</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {rows.map(r => (
                  <tr key={r.producto_id} className={`hover:bg-gray-50/50 transition-colors ${r.stock_real <= r.stock_minimo && r.stock_minimo > 0 ? 'bg-red-50/30' : ''}`}>
                    <td className="px-3 py-2.5 font-mono text-gray-500">{r.codigo}</td>
                    <td className="px-3 py-2.5">
                      <p className="font-medium text-gray-900 max-w-[200px] truncate">{r.nombre}</p>
                      <p className="text-gray-400">{r.presentacion}</p>
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      <span className={`font-bold px-1.5 py-0.5 rounded ${getCatColor(r.cat)}`}>{r.cat}</span>
                    </td>
                    <td className={`px-3 py-2.5 text-right font-bold bg-blue-50/30 ${getStockAlert(r.stock_real, r.stock_minimo)}`}>
                      {r.stock_real}
                      {r.stock_real <= r.stock_minimo && r.stock_minimo > 0 && (
                        <AlertTriangle className="w-3 h-3 inline ml-1 text-red-500" />
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right text-gray-500 bg-blue-50/30">{r.stock_minimo || '—'}</td>
                    <td className="px-3 py-2.5 text-right bg-blue-50/20">{r.pedido_ca || '—'}</td>
                    <td className="px-3 py-2.5 text-right bg-purple-50/20">{r.pedido_mo || '—'}</td>
                    <td className="px-3 py-2.5 text-right bg-green-50/20">{r.pedido_mb || '—'}</td>
                    <td className="px-3 py-2.5 text-right bg-orange-50/20">{r.pedido_pb || '—'}</td>
                    <td className="px-3 py-2.5 text-right bg-gray-50">{r.pedido_ad || '—'}</td>
                    <td className="px-3 py-2.5 text-right font-semibold text-gray-700">{r.pedido_calculado || '—'}</td>
                    <td className="px-3 py-2.5 text-right font-semibold">{r.sugerido_compra || '—'}</td>
                    <td className="px-3 py-2.5 text-right text-amber-600">{r.oc_pendiente > 0 ? r.oc_pendiente : '—'}</td>
                    <td className="px-3 py-2.5 text-right">{r.adicional > 0 ? r.adicional : '—'}</td>
                    <td className={`px-3 py-2.5 text-right font-bold bg-green-50/50 ${r.total_compras > 0 ? 'text-brand-green' : 'text-gray-300'}`}>
                      {r.total_compras > 0 ? r.total_compras : '—'}
                    </td>
                    <td className="px-3 py-2.5 text-right text-gray-600">
                      {r.total_compras > 0 && r.precio > 0 ? formatCOP(r.total_compras * r.precio) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-gray-50 border-t-2 border-gray-200 font-semibold">
                  <td colSpan={14} className="px-3 py-2.5 text-right text-sm text-gray-700">TOTALES →</td>
                  <td className="px-3 py-2.5 text-right text-brand-green font-bold text-sm bg-green-100">{totalComprar}</td>
                  <td className="px-3 py-2.5 text-right text-gray-700 text-sm">{formatCOP(valorTotal)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      {/* Grupos */}
      <div className="bg-white border border-gray-100 rounded-xl shadow-sm p-4">
        <p className="font-heading font-semibold text-sm text-gray-700 mb-3">Pedidos por Grupo de Contrato</p>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
          {(['CA','MO','MB','PB','AD'] as const).map(g => (
            <a key={g} href={`/contratos`}
              className="flex items-center justify-between gap-2 border border-gray-200 rounded-xl px-3 py-2.5 hover:border-brand-green hover:bg-green-50/30 transition-all group">
              <div>
                <p className="font-heading font-bold text-sm text-gray-900">{g}</p>
                <p className="font-body text-xs text-gray-400">Ver pedidos</p>
              </div>
              <ChevronRight className="w-4 h-4 text-gray-300 group-hover:text-brand-green transition-colors" />
            </a>
          ))}
        </div>
      </div>
    </div>
  )
}

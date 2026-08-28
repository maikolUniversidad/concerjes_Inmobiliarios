import type { Metadata } from 'next'
import { RefreshCw, FileText, Download, ChevronRight, Sparkles, TrendingUp } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { traerTodo } from '@/lib/supabase/paginado'
import { requirePermiso } from '@/lib/permisos-server'
import { PlanReabastecimientoTabla, RecomendacionTabla, type RecFila } from './AprovisionamientoTablas'

export const metadata: Metadata = { title: 'Aprovisionamiento' }
export const dynamic = 'force-dynamic'

function formatCOP(n: number) {
  return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(n)
}

export default async function AprovisionamientoPage() {
  await requirePermiso('ver_aprovisionamiento')
  const supabase = await createClient()
  const periodo = 'JUNIO 2026'

  // Traer productos activos con su stock y datos de aprovisionamiento
  const [{ data: aprovData }, gruposData] = await Promise.all([
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
    // Paginado: los pedidos de un periodo pasan de las 1.000 filas que devuelve
    // PostgREST por respuesta, y aquí se agregan TODOS para repartir por grupo.
    traerTodo((desde, hasta) => supabase
      .from('pedidos_sede')
      .select(`
        producto_id, cantidad,
        sedes!inner ( grupo_id, grupos_contrato!inner ( codigo ) )
      `)
      .eq('periodo', '2026-06-01')
      .order('id')
      .range(desde, hasta)),
  ])

  // Recomendación de compra EN VIVO (no depende de la tabla CMI): qué comprar
  // para cubrir la demanda comprometida en órdenes de insumo que el stock actual
  // más lo ya pedido en OC no alcanzan a cubrir.
  const { data: recData } = await supabase
    .from('v_recomendacion_compra')
    .select('producto_id, codigo, nombre_estandar, presentacion, cat_rotacion, precio_lista, stock_real, comprometido, oc_pendiente, recomendado')
    .gt('recomendado', 0)
    .order('recomendado', { ascending: false })
    .limit(300)
  const recs = (recData as unknown as RecFila[]) ?? []
  const recUnidades = recs.reduce((s, r) => s + Number(r.recomendado), 0)
  const recValor = recs.reduce((s, r) => s + Number(r.recomendado) * Number(r.precio_lista ?? 0), 0)

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

      {/* ── Recomendación de compra EN VIVO ── */}
      <div className="bg-white border border-brand-green/20 rounded-2xl shadow-sm overflow-hidden">
        <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-gray-100 bg-brand-green/5 flex-wrap">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-brand-green" />
            <h2 className="font-heading font-semibold text-sm text-gray-900">Recomendación de compra (en vivo)</h2>
          </div>
          <div className="flex items-center gap-4 font-body text-xs">
            <span className="text-gray-500"><span className="font-bold text-gray-900">{recs.length}</span> productos</span>
            <span className="text-gray-500">Unidades <span className="font-bold text-gray-900">{recUnidades.toLocaleString('es-CO')}</span></span>
            <span className="inline-flex items-center gap-1 text-gray-500"><TrendingUp className="w-3.5 h-3.5 text-brand-green" /> <span className="font-bold text-gray-900">{formatCOP(recValor)}</span></span>
          </div>
        </div>
        <p className="px-4 pt-2 font-body text-xs text-gray-400">
          Qué comprar para cubrir la demanda de las órdenes de insumo en cola que el stock actual y lo ya pedido en OC no alcanzan a cubrir.
        </p>
        <div className="p-4">
          <RecomendacionTabla recs={recs} />
        </div>
      </div>

      {/* KPIs (plan CMI importado) */}
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

        <div className="p-4">
          <PlanReabastecimientoTabla rows={rows} periodo={periodo} />
        </div>
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

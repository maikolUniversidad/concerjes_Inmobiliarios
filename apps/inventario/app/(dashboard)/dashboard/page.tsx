import type { Metadata } from 'next'
import Link from 'next/link'
import {
  Package, ArrowLeftRight, AlertTriangle, TrendingUp, Sparkles, Boxes,
  ClipboardList, PackageCheck, Truck, ClipboardCheck, CheckCircle2, ChevronRight,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { getPermisosUsuario } from '@/lib/permisos-server'
import { CATEGORIA_LABELS, type CategoriaRotacion } from '@/lib/types/database'
import { MovimientosChart, type ChartPoint } from './MovimientosChart'
import { PedidosBodegaTabla, type PedidoFila } from './PedidosBodegaTabla'

export const metadata: Metadata = { title: 'Dashboard' }
export const dynamic = 'force-dynamic'

const cop = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 })
const num = (n: number) => n.toLocaleString('es-CO')

interface ProductoDash {
  id: string; nombre_estandar: string; presentacion: string | null
  cat_rotacion: CategoriaRotacion; stock_minimo_def: number; precio_lista: number | null
  stock: { cantidad_real: number; cantidad_disp: number } | null
}

function startOfDay(offsetDays = 0) {
  const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - offsetDays); return d
}

export default async function DashboardPage() {
  const supabase = await createClient()
  const perm = await getPermisosUsuario()
  const verPedidos = perm.puede('ver_ordenes_insumo') || perm.puede('ver_alistamiento')
  const verInventario = perm.puede('ver_stock') || perm.puede('ver_productos')
  const verMovs = perm.puede('ver_movimientos')

  // ── Pedidos (pipeline de órdenes de insumo) ──────────────────────────────
  let ped = { porAlistar: 0, enAlistamiento: 0, listos: 0, porEntregar: 0, recibidos: 0 }
  let pedidosBodega: PedidoFila[] = []
  let responsables: Record<string, string[]> = {}
  if (verPedidos) {
    const { data: est } = await supabase.from('ordenes_insumo').select('estado')
    const e = ((est ?? []) as { estado: string }[]).map((r) => r.estado)
    const c = (fn: (s: string) => boolean) => e.filter(fn).length
    ped = {
      porAlistar:     c((s) => s === 'APROBADA' || s === 'PENDIENTE'),
      enAlistamiento: c((s) => s === 'EN_ALISTAMIENTO'),
      listos:         c((s) => s === 'ALISTADO'),
      porEntregar:    c((s) => s === 'DESPACHADO' || s === 'EN_RUTA' || s === 'ENTREGADO'),
      recibidos:      c((s) => s === 'RECIBIDO'),
    }

    // Órdenes en proceso de alistamiento (para la tabla de control de bodega)
    const { data: act } = await supabase
      .from('ordenes_insumo')
      .select('id, numero, estado, aprobado_at, sede:sede_id ( nombre ), items:orden_insumo_items ( alistado )')
      .in('estado', ['APROBADA', 'EN_ALISTAMIENTO', 'ALISTADO'])
      .order('aprobado_at', { ascending: false, nullsFirst: false })
      .limit(50)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    pedidosBodega = ((act ?? []) as any[]).map((o) => ({
      id: o.id, numero: o.numero, estado: o.estado,
      sede: o.sede?.nombre ?? null,
      total: o.items?.length ?? 0,
      listos: (o.items ?? []).filter((i: { alistado: boolean }) => i.alistado).length,
    }))

    if (pedidosBodega.length > 0) {
      const { data: resp } = await supabase
        .from('responsables_opciones')
        .select('orden_id, nombre')
        .in('orden_id', pedidosBodega.map((p) => p.id))
      for (const r of ((resp ?? []) as { orden_id: string; nombre: string }[])) {
        (responsables[r.orden_id] ??= []).push(r.nombre)
      }
    }
  }

  // ── Inventario (productos + stock) ───────────────────────────────────────
  let productos: ProductoDash[] = []
  if (verInventario) {
    const { data } = await supabase
      .from('productos')
      .select('id, nombre_estandar, presentacion, cat_rotacion, stock_minimo_def, precio_lista, stock ( cantidad_real, cantidad_disp )')
      .eq('activo', true)
    productos = (data ?? []) as unknown as ProductoDash[]
  }
  const criticos = productos.filter((p) => (p.stock_minimo_def > 0) && (p.stock?.cantidad_real ?? 0) <= p.stock_minimo_def)
  const unidadesStock = productos.reduce((a, p) => a + (p.stock?.cantidad_real ?? 0), 0)
  const valorInventario = productos.reduce((a, p) => a + (p.stock?.cantidad_real ?? 0) * (p.precio_lista ?? 0), 0)

  // ── Movimientos (14 días + hoy) ──────────────────────────────────────────
  let movs: { tipo: string; cantidad: number; created_at: string }[] = []
  if (verMovs) {
    const { data } = await supabase.from('movimientos').select('tipo, cantidad, created_at').gte('created_at', startOfDay(13).toISOString())
    movs = (data ?? []) as unknown as typeof movs
  }
  const hoy = startOfDay(0)
  const movsHoy = movs.filter((m) => new Date(m.created_at) >= hoy)
  const entradasHoy = movsHoy.filter((m) => m.tipo === 'ENTRADA' || m.tipo === 'DEVOLUCION').length
  const salidasHoy = movsHoy.filter((m) => m.tipo === 'SALIDA').length

  const dias: ChartPoint[] = []
  for (let i = 13; i >= 0; i--) {
    const d = startOfDay(i); const next = startOfDay(i - 1)
    const r = movs.filter((m) => { const t = new Date(m.created_at); return t >= d && t < next })
    dias.push({
      dia: d.toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit' }),
      entradas: r.filter((m) => m.tipo === 'ENTRADA' || m.tipo === 'DEVOLUCION').reduce((a, m) => a + Number(m.cantidad), 0),
      salidas: r.filter((m) => m.tipo === 'SALIDA').reduce((a, m) => a + Number(m.cantidad), 0),
    })
  }

  return (
    <div className="p-4 sm:p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading font-bold text-2xl text-gray-900">Dashboard</h1>
          <p className="font-body text-sm text-gray-500 mt-0.5">Panel de control · toca cualquier dato para ver el detalle</p>
        </div>
        <div className="text-right hidden sm:block">
          <p className="font-body text-xs text-gray-400">Conserjes Inmobiliarios Ltda</p>
          <p className="font-body text-xs text-gray-400">NIT 800093388-2</p>
        </div>
      </div>

      {/* ── Pedidos ── */}
      {verPedidos && (
        <section>
          <h2 className="mb-3 flex items-center gap-2 font-heading font-semibold text-sm text-gray-500 uppercase tracking-wide">
            <ClipboardList className="w-4 h-4" /> Pedidos de insumo
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-4">
            <Kpi label="Por alistar" value={ped.porAlistar} sub="aprobadas en bodega" icon={ClipboardCheck} color="bg-blue-50 text-blue-600" href="/ordenes-insumo?estado=APROBADA" />
            <Kpi label="En alistamiento" value={ped.enAlistamiento} sub="en curso" icon={PackageCheck} color="bg-violet-50 text-violet-600" href="/ordenes-insumo?estado=EN_ALISTAMIENTO" />
            <Kpi label="Listas" value={ped.listos} sub="alistadas, sin despachar" icon={Boxes} color="bg-teal-50 text-teal-600" href="/ordenes-insumo?estado=ALISTADO" />
            <Kpi label="Por entregar" value={ped.porEntregar} sub="despachadas / en ruta" icon={Truck} color="bg-amber-50 text-amber-600" href="/ordenes-insumo?estado=DESPACHADO" />
            <Kpi label="Recibidas" value={ped.recibidos} sub="entregadas en sede" icon={CheckCircle2} color="bg-green-50 text-green-600" href="/ordenes-insumo?estado=RECIBIDO" />
          </div>

          {/* Tabla de control de bodega: qué falta por alistar y qué ya está */}
          <div className="mt-4">
            <PedidosBodegaTabla pedidos={pedidosBodega} responsables={responsables} />
          </div>
        </section>
      )}

      {/* ── Inventario ── */}
      {verInventario && (
        <section>
          <h2 className="mb-3 flex items-center gap-2 font-heading font-semibold text-sm text-gray-500 uppercase tracking-wide">
            <Package className="w-4 h-4" /> Inventario
          </h2>
          <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
            <Kpi label="Productos" value={productos.length} sub="en catálogo activo" icon={Package} color="bg-blue-50 text-blue-600" href="/productos" />
            <Kpi label="Unidades en stock" value={unidadesStock} sub="cantidad total real" icon={Boxes} color="bg-indigo-50 text-indigo-600" href="/stock" />
            <Kpi label="Valor inventario" valueText={cop.format(valorInventario)} sub="COP estimado" icon={TrendingUp} color="bg-emerald-50 text-emerald-600" href="/reportes" />
            <Kpi label="Stock crítico" value={criticos.length} sub="productos bajo mínimo" icon={AlertTriangle} color="bg-red-50 text-red-600" href="/aprovisionamiento" alerta={criticos.length > 0} />
          </div>
        </section>
      )}

      {/* ── Movimientos ── */}
      {verMovs && (
        <section>
          <h2 className="mb-3 flex items-center gap-2 font-heading font-semibold text-sm text-gray-500 uppercase tracking-wide">
            <ArrowLeftRight className="w-4 h-4" /> Movimientos
          </h2>
          <div className="grid lg:grid-cols-3 gap-5">
            <div className="grid grid-cols-2 lg:grid-cols-1 gap-4 lg:col-span-1">
              <Kpi label="Movimientos hoy" value={movsHoy.length} sub={`${entradasHoy} entradas · ${salidasHoy} salidas`} icon={ArrowLeftRight} color="bg-green-50 text-green-600" href="/movimientos" />
              <Link href="/ia/asistente" className="rounded-2xl bg-gradient-to-br from-brand-green to-brand-green-mid p-5 text-white shadow-sm hover:shadow-md transition-shadow flex flex-col justify-between">
                <div className="flex items-center gap-2"><Sparkles className="w-5 h-5 text-green-300" /><span className="font-heading font-semibold text-sm">Asistente IA</span></div>
                <p className="font-body text-xs text-green-100 mt-2">Pregunta sobre el inventario en lenguaje natural →</p>
              </Link>
            </div>
            <div className="lg:col-span-2 bg-white border border-gray-100 rounded-2xl p-6 shadow-sm">
              <h3 className="font-heading font-semibold text-base text-gray-900 mb-4">Entradas y salidas — últimos 14 días</h3>
              <MovimientosChart data={dias} />
            </div>
          </div>
        </section>
      )}

      {/* ── Alertas de stock crítico ── */}
      {verInventario && (
        <div className="bg-white border border-gray-100 rounded-2xl p-6 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-heading font-semibold text-lg text-gray-900">Alertas de stock crítico</h2>
            {criticos.length > 0 && (
              <Link href="/aprovisionamiento" className="flex items-center gap-1 text-xs font-body font-semibold text-brand-green hover:underline">
                Ver plan de compras <ChevronRight className="w-3.5 h-3.5" />
              </Link>
            )}
          </div>
          {criticos.length === 0 ? (
            <div className="h-32 bg-green-50/50 rounded-xl border border-green-100 flex flex-col items-center justify-center text-green-700">
              <Package className="w-8 h-8 mb-2 opacity-60" />
              <p className="font-body text-sm">Todo el inventario está por encima del mínimo ✅</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-100">
                    <th className="text-left font-body font-semibold text-xs text-gray-500 uppercase px-3 py-2">Producto</th>
                    <th className="text-center font-body font-semibold text-xs text-gray-500 uppercase px-3 py-2">Cat.</th>
                    <th className="text-right font-body font-semibold text-xs text-gray-500 uppercase px-3 py-2">Disponible</th>
                    <th className="text-right font-body font-semibold text-xs text-gray-500 uppercase px-3 py-2">Mínimo</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {criticos.slice(0, 8).map((p) => {
                    const cat = CATEGORIA_LABELS[p.cat_rotacion]
                    const real = p.stock?.cantidad_real ?? 0
                    return (
                      <tr key={p.id} className="hover:bg-gray-50/50">
                        <td className="px-3 py-2.5">
                          <Link href={`/productos/${p.id}`} className="font-body font-medium text-sm text-gray-900 hover:text-brand-green">{p.nombre_estandar}</Link>
                          <p className="font-body text-xs text-gray-400">{p.presentacion}</p>
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          <span className={`font-body font-bold text-xs px-2 py-0.5 rounded-full ${cat.bg} ${cat.color}`}>{p.cat_rotacion}</span>
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          <span className={`font-heading font-bold text-base ${real === 0 ? 'text-red-600' : 'text-orange-600'}`}>{real}</span>
                        </td>
                        <td className="px-3 py-2.5 text-right font-body text-sm text-gray-500">{p.stock_minimo_def}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              {criticos.length > 8 && (
                <p className="font-body text-xs text-gray-400 mt-3 text-center">+ {criticos.length - 8} productos más en estado crítico</p>
              )}
            </div>
          )}
        </div>
      )}

      {!verPedidos && !verInventario && !verMovs && (
        <div className="bg-white border border-gray-100 rounded-2xl p-12 text-center text-gray-400">
          <p className="font-body text-sm">No tienes módulos con datos para mostrar en el panel.</p>
        </div>
      )}
    </div>
  )
}

// ── Tarjeta KPI clicable ──────────────────────────────────────────────────────
function Kpi({
  label, value, valueText, sub, icon: Icon, color, href, alerta,
}: {
  label: string; value?: number; valueText?: string; sub: string
  icon: React.ComponentType<{ className?: string }>; color: string; href?: string; alerta?: boolean
}) {
  const inner = (
    <>
      <div className="flex items-start justify-between mb-3">
        <div className={`w-10 h-10 rounded-xl ${color} flex items-center justify-center`}><Icon className="w-5 h-5" /></div>
        {href && <ChevronRight className="w-4 h-4 text-gray-300 group-hover:text-brand-green transition-colors" />}
      </div>
      <p className={`font-heading font-bold text-3xl mb-1 ${alerta ? 'text-red-600' : 'text-gray-900'}`}>
        {valueText ?? num(value ?? 0)}
      </p>
      <p className="font-body font-semibold text-sm text-gray-700">{label}</p>
      <p className="font-body text-xs text-gray-400 mt-0.5">{sub}</p>
    </>
  )
  const cls = 'group block bg-white border border-gray-100 rounded-2xl p-5 shadow-sm transition-all hover:shadow-md hover:border-brand-green/40'
  return href ? <Link href={href} className={cls}>{inner}</Link> : <div className={cls}>{inner}</div>
}

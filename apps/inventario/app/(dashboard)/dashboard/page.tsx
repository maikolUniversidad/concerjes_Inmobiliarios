import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import {
  Package, ArrowLeftRight, AlertTriangle, TrendingUp, Sparkles, Boxes,
  ClipboardList, PackageCheck, Truck, ClipboardCheck, CheckCircle2, ChevronRight,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { getPermisosUsuario } from '@/lib/permisos-server'
import { type CategoriaRotacion } from '@/lib/types/database'
import { MovimientosChart } from './MovimientosChartLazy'
// Solo el tipo viene del componente real: TypeScript lo borra al compilar, así
// que no arrastra recharts al paquete inicial del tablero.
import type { ChartPoint } from './MovimientosChart'
import { PedidosBodegaTabla, type PedidoFila } from './PedidosBodegaTabla'
import { AlertasStockTabla } from './AlertasStockTabla'
import { ordenarPorItem } from '@/lib/stock-reservas'

export const metadata: Metadata = { title: 'Dashboard' }
export const dynamic = 'force-dynamic'

const cop = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 })
const num = (n: number) => n.toLocaleString('es-CO')

/** Fila única de `v_dashboard_inventario`: los totales ya sumados por la base. */
interface TotalesInventario {
  n_productos: number; unidades_real: number; unidades_disp: number
  valor_inventario: number; n_criticos: number
}

/** Fila de `v_stock_critico` (sólo los productos bajo el mínimo). */
interface CriticoDash {
  id: string; codigo: number | null; nombre_estandar: string; presentacion: string | null
  cat_rotacion: CategoriaRotacion; stock_minimo_def: number
  cantidad_real: number; cantidad_disp: number
}

/** Cuántos críticos se listan en la tabla; el KPI usa el total exacto de la vista. */
const MAX_CRITICOS = 200

export default async function DashboardPage() {
  const supabase = await createClient()
  const perm = await getPermisosUsuario()
  const verPedidos = perm.puede('ver_ordenes_insumo') || perm.puede('ver_alistamiento')
  const verInventario = perm.puede('ver_stock') || perm.puede('ver_productos')
  const verMovs = perm.puede('ver_movimientos')

  // Un colaborador de planta (rol «Empleado») no tiene nada que hacer en el
  // tablero de inventario: sin ninguno de estos permisos vería una página en
  // blanco. Se le lleva a su carnet, que sí es su pantalla.
  if (!verPedidos && !verInventario && !verMovs && !perm.puede('ver_reportes')) {
    redirect('/carnet')
  }

  // Las tres secciones del tablero no dependen una de otra, así que se piden a
  // la vez. Antes iban encadenadas con `await` y la página tardaba la SUMA de
  // todas (y cada viaje a Supabase se paga entero, ida y vuelta).
  const [estadosRes, activasRes, totalesRes, criticosRes, diasRes] = await Promise.all([
    // Cuentas por estado: las hace la base (v_ordenes_insumo_por_estado). Antes
    // se traía una fila por cada orden que existe solo para contarlas.
    verPedidos
      ? supabase.from('v_ordenes_insumo_por_estado').select('estado, total')
      : Promise.resolve({ data: [] }),

    // Órdenes en curso (bodega + en camino): se siguen hasta que la sede recibe.
    verPedidos
      ? supabase
          .from('ordenes_insumo')
          .select('id, numero, estado, aprobado_at, sede:sede_id ( nombre ), items:orden_insumo_items ( alistado )')
          .in('estado', ['APROBADA', 'EN_ALISTAMIENTO', 'ALISTADO', 'DESPACHADO', 'EN_RUTA', 'ENTREGADO'])
          .order('aprobado_at', { ascending: false, nullsFirst: false })
          .limit(100)
      : Promise.resolve({ data: [] }),

    // Inventario: los cuatro totales los suma la base (v_dashboard_inventario,
    // UNA fila). Antes se traía el catálogo activo COMPLETO —paginado de 1.000
    // en 1.000, con el stock anidado— para sumarlo aquí: 498 filas para sacar
    // cuatro números y encontrar diez críticos.
    verInventario
      ? supabase
          .from('v_dashboard_inventario')
          .select('n_productos, unidades_real, unidades_disp, valor_inventario, n_criticos')
          .maybeSingle()
      : Promise.resolve({ data: null }),

    // Los críticos, acotados: hoy son 10. El KPI usa el total exacto de la
    // vista de arriba, así que la tabla puede estar topada sin mentir.
    verInventario
      ? supabase
          .from('v_stock_critico')
          .select('id, codigo, nombre_estandar, presentacion, cat_rotacion, stock_minimo_def, cantidad_real, cantidad_disp')
          .order('codigo', { nullsFirst: false })
          .limit(MAX_CRITICOS)
      : Promise.resolve({ data: [] }),

    // Movimientos ya agrupados por día (14 filas en vez de ~1.400).
    verMovs
      ? supabase.from('v_movimientos_dia').select('dia, entradas, salidas, n_entradas, n_salidas, n_total')
      : Promise.resolve({ data: [] }),
  ])

  // ── Pedidos (pipeline de órdenes de insumo) ──────────────────────────────
  const porEstado = new Map(
    ((estadosRes.data ?? []) as { estado: string; total: number }[]).map((r) => [r.estado, Number(r.total)]),
  )
  const sumar = (...estados: string[]) => estados.reduce((a, e) => a + (porEstado.get(e) ?? 0), 0)
  const ped = {
    porAlistar:     sumar('APROBADA', 'PENDIENTE'),
    enAlistamiento: sumar('EN_ALISTAMIENTO'),
    listos:         sumar('ALISTADO'),
    porEntregar:    sumar('DESPACHADO', 'EN_RUTA', 'ENTREGADO'),
    recibidos:      sumar('RECIBIDO'),
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pedidosBodega: PedidoFila[] = ((activasRes.data ?? []) as any[]).map((o) => ({
    id: o.id, numero: o.numero, estado: o.estado,
    sede: o.sede?.nombre ?? null,
    total: o.items?.length ?? 0,
    listos: (o.items ?? []).filter((i: { alistado: boolean }) => i.alistado).length,
  }))

  const responsables: Record<string, string[]> = {}
  if (pedidosBodega.length > 0) {
    const { data: resp } = await supabase
      .from('responsables_opciones')
      .select('orden_id, nombre')
      .in('orden_id', pedidosBodega.map((p) => p.id))
    for (const r of ((resp ?? []) as { orden_id: string; nombre: string }[])) {
      (responsables[r.orden_id] ??= []).push(r.nombre)
    }
  }

  // ── Inventario (totales + críticos) ──────────────────────────────────────
  // "Con cuánto se cuenta" = DISPONIBLE REAL (stock real − lo reservado por
  // pedidos aprobados sin despachar; lo fija la BD en stock.cantidad_disp).
  // El crítico se mide contra el disponible; las unidades y el valor del
  // inventario siguen siendo lo físico en bodega. Esa es la semántica de las
  // vistas: aquí sólo se convierten los numeric, que llegan como string.
  const tot = (totalesRes.data ?? null) as TotalesInventario | null
  const totalProductos = Number(tot?.n_productos ?? 0)
  const unidadesStock = Number(tot?.unidades_real ?? 0)
  const unidadesDisp = Number(tot?.unidades_disp ?? 0)
  const valorInventario = Number(tot?.valor_inventario ?? 0)
  const totalCriticos = Number(tot?.n_criticos ?? 0)

  // Orden por ítem y luego alfabético (la regla de todo el sistema).
  const criticos = ordenarPorItem(
    ((criticosRes.data ?? []) as unknown as CriticoDash[]),
    (p) => ({ codigo: p.codigo, nombre: p.nombre_estandar }),
  )

  // ── Movimientos (14 días + hoy) ──────────────────────────────────────────
  // Las sumas por día las hace la vista v_movimientos_dia, y corta el día en
  // hora de Bogotá. Antes se traían los ~1.400 movimientos de 14 días y se
  // agrupaban aquí con la hora DEL SERVIDOR, que en Vercel es UTC: entre las
  // 7 y las 12 de la noche, lo de esa noche se contaba como del día siguiente.
  const porDia = new Map(
    ((diasRes.data ?? []) as { dia: string; entradas: number; salidas: number; n_entradas: number; n_salidas: number; n_total: number }[])
      .map((r) => [String(r.dia).slice(0, 10), r]),
  )

  const fechaBogota = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit',
  })
  const hoyISO = fechaBogota.format(new Date())
  // Mediodía UTC como ancla: restar días enteros nunca cae en otro día.
  const ancla = new Date(`${hoyISO}T12:00:00Z`)

  const dias: ChartPoint[] = []
  for (let i = 13; i >= 0; i--) {
    const d = new Date(ancla)
    d.setUTCDate(d.getUTCDate() - i)
    const iso = d.toISOString().slice(0, 10)
    const fila = porDia.get(iso)
    const [, mm, dd] = iso.split('-')
    dias.push({
      dia: `${dd}/${mm}`,
      entradas: Number(fila?.entradas ?? 0),
      salidas: Number(fila?.salidas ?? 0),
    })
  }

  const entradasHoy = Number(porDia.get(hoyISO)?.n_entradas ?? 0)
  const salidasHoy = Number(porDia.get(hoyISO)?.n_salidas ?? 0)
  const movimientosHoy = Number(porDia.get(hoyISO)?.n_total ?? 0)

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
            <Kpi label="Productos" value={totalProductos} sub="en catálogo activo" icon={Package} color="bg-blue-50 text-blue-600" href="/productos" />
            <Kpi label="Disponible real" value={unidadesDisp} sub={`${num(unidadesStock)} en bodega · ${num(unidadesStock - unidadesDisp)} reservado`} icon={Boxes} color="bg-indigo-50 text-indigo-600" href="/stock" />
            <Kpi label="Valor inventario" valueText={cop.format(valorInventario)} sub="COP estimado" icon={TrendingUp} color="bg-emerald-50 text-emerald-600" href="/reportes" />
            <Kpi label="Stock crítico" value={totalCriticos} sub="disponible bajo mínimo" icon={AlertTriangle} color="bg-red-50 text-red-600" href="/aprovisionamiento" alerta={totalCriticos > 0} />
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
              <Kpi label="Movimientos hoy" value={movimientosHoy} sub={`${entradasHoy} entradas · ${salidasHoy} salidas`} icon={ArrowLeftRight} color="bg-green-50 text-green-600" href="/movimientos" />
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
            {totalCriticos > 0 && (
              <Link href="/aprovisionamiento" className="flex items-center gap-1 text-xs font-body font-semibold text-brand-green hover:underline">
                Ver plan de compras <ChevronRight className="w-3.5 h-3.5" />
              </Link>
            )}
          </div>
          <AlertasStockTabla
            criticos={criticos.map((p) => ({
              id: p.id,
              nombre_estandar: p.nombre_estandar,
              presentacion: p.presentacion,
              cat_rotacion: p.cat_rotacion,
              stock_minimo_def: Number(p.stock_minimo_def),
              codigo: p.codigo,
              real: Number(p.cantidad_real),
              disp: Number(p.cantidad_disp),
            }))}
          />
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

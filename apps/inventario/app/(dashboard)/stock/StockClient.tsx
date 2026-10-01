'use client'
import { useMemo, useState } from 'react'
import { Boxes, TrendingDown, TrendingUp, AlertCircle, Share2, Lock, PackageCheck, PackageMinus, Radio, ClipboardCheck, Truck } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { CATEGORIA_LABELS, type CategoriaRotacion } from '@/lib/types/database'
import { TablaEstandar, type ColumnaTabla } from '@/components/ui/tabla'
import { useEnVivo } from '@/lib/supabase/useEnVivo'
import { type FlujoProducto } from '@/lib/stock-flujo'
import { columnasFlujo } from '@/components/inventario/columnasFlujo'

export interface StockRow {
  id: string
  ref: number | null
  /** Ítem (productos.codigo). */
  codigo: number | null
  nombre: string
  presentacion: string | null
  cat: CategoriaRotacion
  real: number
  /** Disponible real = real − reservado. Negativo: se pidió más de lo que hay. */
  disp: number
  /** Reservado por órdenes aprobadas aún sin despachar. */
  reservado: number
  entrante: number
  saliente: number
  minimo: number
  /** Flujo de las órdenes (v_stock_flujo): alistado en bodega, despachado, en tránsito. */
  flujo: FlujoProducto
  cceTipo: 'PROPIO' | 'COMPARTIDO' | null
  cceReal: number | null
  cceDisp: number | null
}

/**
 * Estado contra el mínimo, medido sobre el DISPONIBLE REAL (lo que queda libre
 * después de las reservas): es con lo que de verdad se cuenta.
 */
function estado(disp: number, minimo: number) {
  if (minimo <= 0 && disp === 0) return { key: 'nd', label: 'N/D', cls: 'bg-gray-100 text-gray-400' }
  if (disp <= 0) return { key: 'critico', label: 'Agotado', cls: 'bg-red-100 text-red-700' }
  if (disp <= minimo) return { key: 'critico', label: 'Crítico', cls: 'bg-red-100 text-red-700' }
  if (disp <= minimo * 1.5) return { key: 'bajo', label: 'Bajo', cls: 'bg-yellow-100 text-yellow-700' }
  return { key: 'normal', label: 'Normal', cls: 'bg-green-100 text-green-700' }
}

const cceLabel = (r: StockRow) =>
  r.cceTipo === 'PROPIO' ? 'Propio' : r.cceTipo === 'COMPARTIDO' ? 'Compartido' : 'Sin CCE'

export function StockClient({ rows }: { rows: StockRow[] }) {
  const router = useRouter()
  const [filtro, setFiltro] = useState('')
  const [cceFilter, setCceFilter] = useState('')
  // En vivo: aprobar/anular/despachar una orden o mover stock refresca la tabla.
  useEnVivo(['stock', 'ordenes_insumo', 'orden_insumo_items'])

  // Los filtros por columna viven dentro de la tabla; aquí solo quedan los
  // atajos de negocio (alertas de stock e inventario CCE).
  const filtered = useMemo(() => {
    return rows.filter((r) => {
      const e = estado(r.disp, r.minimo).key
      const matchFiltro =
        !filtro ||
        (filtro === 'alerta'
          ? e === 'critico' || e === 'bajo'
          : filtro === 'sobrepedido'
            ? r.disp < 0
            : filtro === 'reservado'
              ? r.reservado > 0
              : e === filtro)
      const matchCce =
        !cceFilter ||
        (cceFilter === 'propio'
          ? r.cceTipo === 'PROPIO'
          : cceFilter === 'compartido'
            ? r.cceTipo === 'COMPARTIDO'
            : cceFilter === 'cce'
              ? r.cceTipo !== null
              : cceFilter === 'sin_cce'
                ? r.cceTipo === null
                : true)
      return matchFiltro && matchCce
    })
  }, [rows, filtro, cceFilter])

  const totalReal = rows.reduce((a, s) => a + s.real, 0)
  const totalReservado = rows.reduce((a, s) => a + s.reservado, 0)
  const totalDisp = rows.reduce((a, s) => a + s.disp, 0)
  const totalAlistado = rows.reduce((a, s) => a + s.flujo.alistado, 0)
  const totalDespachado = rows.reduce((a, s) => a + s.flujo.despachadoMes, 0)
  const totalTransito = rows.reduce((a, s) => a + s.flujo.enTransito, 0)
  const sobrePedidos = rows.filter((s) => s.disp < 0).length
  const totalEntrante = rows.reduce((a, s) => a + s.entrante, 0)
  const totalSaliente = rows.reduce((a, s) => a + s.saliente, 0)
  const alertas = rows.filter((s) => {
    const e = estado(s.disp, s.minimo).key
    return e === 'critico' || e === 'bajo'
  }).length

  const kpis = [
    { icon: Boxes, label: 'Stock real (bodega)', value: totalReal.toLocaleString('es-CO'), color: 'text-blue-600', bg: 'bg-blue-50 border-blue-100' },
    { icon: PackageCheck, label: 'Reservado (pedidos aprobados)', value: totalReservado.toLocaleString('es-CO'), color: 'text-amber-700', bg: 'bg-amber-50 border-amber-100' },
    { icon: Boxes, label: 'Disponible real (con lo que se cuenta)', value: totalDisp.toLocaleString('es-CO'), color: 'text-green-700', bg: 'bg-green-50 border-green-100' },
    { icon: ClipboardCheck, label: 'Alistado (ya ordenado, en bodega)', value: totalAlistado.toLocaleString('es-CO'), color: 'text-indigo-700', bg: 'bg-indigo-50 border-indigo-100' },
    { icon: Truck, label: `Despachado este mes · ${totalTransito.toLocaleString('es-CO')} en tránsito`, value: totalDespachado.toLocaleString('es-CO'), color: 'text-sky-700', bg: 'bg-sky-50 border-sky-100' },
    { icon: PackageMinus, label: 'Productos sobre-pedidos', value: sobrePedidos.toString(), color: 'text-red-600', bg: 'bg-red-50 border-red-100' },
    { icon: TrendingUp, label: 'Entrante', value: '+' + totalEntrante.toLocaleString('es-CO'), color: 'text-green-600', bg: 'bg-green-50 border-green-100' },
    { icon: TrendingDown, label: 'Saliente', value: '-' + totalSaliente.toLocaleString('es-CO'), color: 'text-orange-600', bg: 'bg-orange-50 border-orange-100' },
    { icon: AlertCircle, label: 'Alertas stock', value: alertas.toString(), color: 'text-red-600', bg: 'bg-red-50 border-red-100' },
  ]

  const columnas: ColumnaTabla<StockRow>[] = [
    {
      id: 'codigo',
      header: 'Ítem',
      valor: (s) => s.codigo ?? '',
      celda: (s) => <span className="font-mono text-xs text-gray-500">{s.codigo ?? '—'}</span>,
      ancho: 'w-16',
      tarjeta: 'meta',
    },
    {
      id: 'nombre',
      header: 'Producto',
      valor: (s) => s.nombre,
      celda: (s) => (
        <Link
          href={`/productos/${s.id}`}
          onClick={(e) => e.stopPropagation()}
          className="font-body text-sm font-medium text-gray-900 hover:text-brand-green"
        >
          {s.nombre}
        </Link>
      ),
      ancho: 'min-w-[200px]',
      tarjeta: 'titulo',
    },
    {
      id: 'presentacion',
      header: 'Presentación',
      valor: (s) => s.presentacion ?? '',
      prioridad: 3,
      className: 'text-gray-400 text-xs',
      tarjeta: 'subtitulo',
    },
    {
      id: 'cat',
      header: 'Cat.',
      valor: (s) => s.cat,
      align: 'center',
      prioridad: 2,
      celda: (s) => {
        const cat = CATEGORIA_LABELS[s.cat]
        return (
          <span className={`rounded-full px-2 py-0.5 font-body text-xs font-bold ${cat.bg} ${cat.color}`}>
            {s.cat}
          </span>
        )
      },
      tarjeta: 'meta',
    },
    {
      id: 'real',
      header: 'Stock real',
      valor: (s) => s.real,
      align: 'right',
      className: 'bg-gray-50/40',
      headerClassName: 'bg-gray-100/60',
      celda: (s) => <span className="font-heading text-base font-bold text-gray-900">{s.real}</span>,
      tarjeta: 'meta',
    },
    {
      id: 'reservado',
      header: 'Reservado (pedidos aprobados)',
      valor: (s) => s.reservado,
      align: 'right',
      className: 'bg-amber-50/30',
      headerClassName: 'bg-amber-50 text-amber-700',
      celda: (s) =>
        s.reservado > 0 ? (
          <span className="font-heading text-sm font-semibold text-amber-700">{s.reservado}</span>
        ) : (
          <span className="text-xs text-gray-300">—</span>
        ),
      tarjeta: 'meta',
    },
    {
      id: 'disp',
      header: 'Disponible real',
      valor: (s) => s.disp,
      align: 'right',
      className: 'bg-green-50/30',
      headerClassName: 'bg-green-50 text-green-600',
      celda: (s) => (
        <span
          title={s.disp < 0 ? `Se pidió ${-s.disp} más de lo que hay en bodega` : undefined}
          className={`font-heading text-sm font-semibold ${s.disp < 0 ? 'text-red-600' : 'text-green-700'}`}
        >
          {s.disp}
        </span>
      ),
      tarjeta: 'meta',
    },
    ...columnasFlujo<StockRow>((s) => s.flujo),
    {
      id: 'entrante',
      header: 'Entr.',
      valor: (s) => s.entrante,
      align: 'right',
      prioridad: 2,
      className: 'bg-blue-50/30',
      headerClassName: 'bg-blue-50 text-blue-600',
      celda: (s) =>
        s.entrante > 0 ? (
          <span className="font-body text-sm font-semibold text-blue-600">+{s.entrante}</span>
        ) : (
          <span className="text-xs text-gray-300">—</span>
        ),
      tarjeta: 'oculto',
    },
    {
      id: 'saliente',
      header: 'Sal.',
      valor: (s) => s.saliente,
      align: 'right',
      prioridad: 2,
      className: 'bg-orange-50/30',
      headerClassName: 'bg-orange-50 text-orange-600',
      celda: (s) =>
        s.saliente > 0 ? (
          <span className="font-body text-sm font-semibold text-orange-600">-{s.saliente}</span>
        ) : (
          <span className="text-xs text-gray-300">—</span>
        ),
      tarjeta: 'oculto',
    },
    {
      id: 'minimo',
      header: 'Mín.',
      valor: (s) => s.minimo,
      align: 'right',
      prioridad: 3,
      className: 'text-gray-500',
      tarjeta: 'oculto',
    },
    {
      id: 'cce',
      header: 'CCE',
      valor: (s) => cceLabel(s),
      copiaTexto: (s) =>
        s.cceTipo === 'PROPIO' ? `Propio (${s.cceReal ?? 0})` : cceLabel(s),
      align: 'center',
      prioridad: 2,
      className: 'bg-purple-50/20',
      headerClassName: 'bg-purple-50/60 text-purple-600',
      celda: (s) => (
        <>
          {s.cceTipo === 'PROPIO' && (
            <div className="flex flex-col items-center gap-0.5">
              <div className="flex items-center gap-1">
                <Lock className="h-3 w-3 text-purple-500" />
                <span className="font-body text-[10px] font-bold text-purple-700">PROPIO</span>
              </div>
              <span className="font-heading text-sm font-bold text-purple-900">{s.cceReal ?? 0}</span>
            </div>
          )}
          {s.cceTipo === 'COMPARTIDO' && (
            <div className="flex items-center justify-center gap-1">
              <Share2 className="h-3 w-3 text-teal-500" />
              <span className="font-body text-[10px] font-bold text-teal-700">COMPARTIDO</span>
            </div>
          )}
          {!s.cceTipo && <span className="text-xs text-gray-200">—</span>}
        </>
      ),
      tarjeta: 'meta',
    },
    {
      id: 'estado',
      header: 'Estado',
      valor: (s) => estado(s.disp, s.minimo).label,
      align: 'center',
      celda: (s) => {
        const e = estado(s.disp, s.minimo)
        return (
          <span className={`rounded-full px-2.5 py-1 font-body text-xs font-medium ${e.cls}`}>
            {e.label}
          </span>
        )
      },
      tarjeta: 'badge',
    },
  ]

  return (
    <div className="space-y-5">
      {/* KPIs */}
      <p className="flex items-center gap-1.5 font-body text-xs text-gray-500">
        <Radio className="h-3.5 w-3.5 text-green-600" />
        En vivo. <span className="font-semibold">Disponible real</span> = stock real − lo reservado por órdenes de insumo
        que ya salieron de borrador y aún no se despachan. Al despachar, la reserva se libera y el stock real baja.
        En rojo: se pidió más de lo que hay. <span className="font-semibold">Alistamiento</span>: lo ya ordenado (chuleado) que
        sigue en bodega. <span className="font-semibold">Despacho</span>: lo que ya salió este mes. El estado se mide sobre el disponible real.
      </p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {kpis.map((k) => (
          <div key={k.label} className={`rounded-xl border p-4 ${k.bg} flex items-start gap-3`}>
            <k.icon className={`mt-0.5 h-5 w-5 ${k.color}`} />
            <div>
              <p className="font-heading text-2xl font-bold text-gray-900">{k.value}</p>
              <p className={`font-body text-xs ${k.color}`}>{k.label}</p>
            </div>
          </div>
        ))}
      </div>

      <TablaEstandar
        id="stock"
        titulo="Stock"
        modulo="Inventario"
        entidad="stock"
        datos={filtered}
        columnas={columnas}
        filaId={(s) => s.id}
        onFilaClick={(s) => router.push(`/productos/${s.id}`)}
        anchoAcciones="w-28"
        busqueda="Buscar por ítem, nombre, categoría, estado…"
        filaClassName={(s) => (s.disp < 0 || estado(s.disp, s.minimo).key === 'critico' ? 'bg-red-50/20' : '')}
        vacio={
          <>
            <p className="font-heading font-bold text-gray-500">Sin resultados</p>
            <p className="mt-1 font-body text-sm text-gray-400">Ajusta la búsqueda o los filtros</p>
          </>
        }
        herramientas={
          <>
            <select
              value={filtro}
              onChange={(e) => setFiltro(e.target.value)}
              className="rounded-xl border border-gray-200 bg-white px-3 py-2 font-body text-sm text-gray-700 outline-none"
            >
              <option value="">Todos los estados</option>
              <option value="alerta">Con alerta (crítico/bajo)</option>
              <option value="critico">Crítico / Agotado</option>
              <option value="bajo">Bajo</option>
              <option value="normal">Normal</option>
              <option value="reservado">Con reserva de pedidos</option>
              <option value="sobrepedido">Sobre-pedidos (disponible negativo)</option>
            </select>
            <select
              value={cceFilter}
              onChange={(e) => setCceFilter(e.target.value)}
              className="rounded-xl border border-gray-200 bg-white px-3 py-2 font-body text-sm text-gray-700 outline-none"
            >
              <option value="">Inventario CCE</option>
              <option value="cce">Con categoría CCE</option>
              <option value="propio">🔒 Propio CCE</option>
              <option value="compartido">↔ Compartido</option>
              <option value="sin_cce">Sin CCE</option>
            </select>
            <Link
              href="/movimientos/nuevo"
              className="rounded-xl bg-brand-green px-4 py-2 font-body text-sm font-semibold text-white transition-colors hover:bg-brand-green-dark"
            >
              Registrar movimiento
            </Link>
          </>
        }
      />
    </div>
  )
}

'use client'
import { useMemo, useState } from 'react'
import { Boxes, TrendingDown, TrendingUp, AlertCircle, Share2, Lock } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { CATEGORIA_LABELS, type CategoriaRotacion } from '@/lib/types/database'
import { TablaEstandar, type ColumnaTabla } from '@/components/ui/tabla'

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
  cceTipo: 'PROPIO' | 'COMPARTIDO' | null
  cceReal: number | null
  cceDisp: number | null
}

function estado(real: number, minimo: number) {
  if (minimo <= 0 && real === 0) return { key: 'nd', label: 'N/D', cls: 'bg-gray-100 text-gray-400' }
  if (real === 0) return { key: 'critico', label: 'Agotado', cls: 'bg-red-100 text-red-700' }
  if (real <= minimo) return { key: 'critico', label: 'Crítico', cls: 'bg-red-100 text-red-700' }
  if (real <= minimo * 1.5) return { key: 'bajo', label: 'Bajo', cls: 'bg-yellow-100 text-yellow-700' }
  return { key: 'normal', label: 'Normal', cls: 'bg-green-100 text-green-700' }
}

const cceLabel = (r: StockRow) =>
  r.cceTipo === 'PROPIO' ? 'Propio' : r.cceTipo === 'COMPARTIDO' ? 'Compartido' : 'Sin CCE'

export function StockClient({ rows }: { rows: StockRow[] }) {
  const router = useRouter()
  const [filtro, setFiltro] = useState('')
  const [cceFilter, setCceFilter] = useState('')

  // Los filtros por columna viven dentro de la tabla; aquí solo quedan los
  // atajos de negocio (alertas de stock e inventario CCE).
  const filtered = useMemo(() => {
    return rows.filter((r) => {
      const e = estado(r.real, r.minimo).key
      const matchFiltro =
        !filtro || (filtro === 'alerta' ? e === 'critico' || e === 'bajo' : e === filtro)
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
  const totalEntrante = rows.reduce((a, s) => a + s.entrante, 0)
  const totalSaliente = rows.reduce((a, s) => a + s.saliente, 0)
  const alertas = rows.filter((s) => {
    const e = estado(s.real, s.minimo).key
    return e === 'critico' || e === 'bajo'
  }).length

  const kpis = [
    { icon: Boxes, label: 'Unidades totales', value: totalReal.toLocaleString('es-CO'), color: 'text-blue-600', bg: 'bg-blue-50 border-blue-100' },
    { icon: TrendingUp, label: 'Entrante', value: '+' + totalEntrante.toLocaleString('es-CO'), color: 'text-green-600', bg: 'bg-green-50 border-green-100' },
    { icon: TrendingDown, label: 'Saliente', value: '-' + totalSaliente.toLocaleString('es-CO'), color: 'text-orange-600', bg: 'bg-orange-50 border-orange-100' },
    { icon: AlertCircle, label: 'Alertas stock', value: alertas.toString(), color: 'text-red-600', bg: 'bg-red-50 border-red-100' },
  ]

  const columnas: ColumnaTabla<StockRow>[] = [
    {
      id: 'ref',
      header: 'REF',
      valor: (s) => s.ref ?? '',
      celda: (s) => <span className="font-mono text-xs text-gray-400">{s.ref ?? '—'}</span>,
      ancho: 'w-20',
      prioridad: 2,
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
      header: 'Real',
      valor: (s) => s.real,
      align: 'right',
      className: 'bg-gray-50/40',
      headerClassName: 'bg-gray-100/60',
      celda: (s) => <span className="font-heading text-base font-bold text-gray-900">{s.real}</span>,
      tarjeta: 'meta',
    },
    {
      id: 'disp',
      header: 'Disp.',
      valor: (s) => s.disp,
      align: 'right',
      className: 'bg-green-50/30',
      headerClassName: 'bg-green-50 text-green-600',
      celda: (s) => <span className="font-heading text-sm font-semibold text-green-700">{s.disp}</span>,
      tarjeta: 'meta',
    },
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
      valor: (s) => estado(s.real, s.minimo).label,
      align: 'center',
      celda: (s) => {
        const e = estado(s.real, s.minimo)
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
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
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
        busqueda="Buscar por nombre, ref, categoría, estado…"
        filaClassName={(s) => (estado(s.real, s.minimo).key === 'critico' ? 'bg-red-50/20' : '')}
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

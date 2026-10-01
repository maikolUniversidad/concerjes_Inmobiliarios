'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import {
  ClipboardList, GitCompareArrows, Scale, TrendingUp, Upload, Download, Search,
  ArrowDownRight, ArrowUpRight, Minus, History, FileBarChart, ChevronRight,
} from 'lucide-react'
import {
  ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend,
} from 'recharts'
import {
  compararConteos, resumenComparacion, estadoSistema, tendencia,
  ETIQUETA_COMPARACION, ETIQUETA_SISTEMA,
  type InventarioFisico, type ItemFisico, type EstadoComparacion, type EstadoSistema,
} from '@/lib/inventario-fisico'
import { ordenarPorItem } from '@/lib/reportes/orden'
import { CargarInventario } from './CargarInventario'

const fmt = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 2 })
const cop = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 })
const fecha = (d: string) => new Date(d + 'T12:00:00-05:00').toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'America/Bogota' })
const q = (v: number | null | undefined) => (v === null || v === undefined ? '—' : fmt.format(v))

type Tab = 'resumen' | 'comparar' | 'sistema' | 'tendencia'

const CLS_COMPARACION: Record<EstadoComparacion, string> = {
  FALTANTE: 'bg-red-100 text-red-700',
  AGOTADO: 'bg-orange-100 text-orange-700',
  BAJO: 'bg-amber-50 text-amber-700',
  SUBIO: 'bg-green-50 text-green-700',
  REPUESTO: 'bg-emerald-100 text-emerald-700',
  NUEVO: 'bg-blue-100 text-blue-700',
  IGUAL: 'bg-gray-100 text-gray-500',
  SIN_DATO: 'bg-gray-100 text-gray-400',
}

const CLS_SISTEMA: Record<EstadoSistema, string> = {
  FALTANTE: 'bg-red-100 text-red-700',
  SOBRANTE: 'bg-blue-100 text-blue-700',
  CUADRA: 'bg-green-50 text-green-700',
  NO_HALLADO: 'bg-orange-100 text-orange-700',
  SIN_CANTIDAD: 'bg-gray-100 text-gray-500',
  SIN_SISTEMA: 'bg-gray-50 text-gray-400',
}

async function exportar(nombre: string, hoja: string, filas: Record<string, unknown>[]) {
  // Excel siempre por ítem y luego alfabético, sin importar el orden de pantalla
  filas = ordenarPorItem(filas, f => f.ITEM, f => f.PRODUCTO)
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet(hoja)
  if (filas.length) {
    ws.columns = Object.keys(filas[0]).map(k => ({ header: k, key: k, width: k.length > 12 ? 40 : 16 }))
    filas.forEach(f => ws.addRow(f))
    ws.getRow(1).font = { bold: true }
    ws.views = [{ state: 'frozen', ySplit: 1 }]
  }
  const buf = await wb.xlsx.writeBuffer()
  const url = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
  const a = document.createElement('a')
  a.href = url
  a.download = nombre
  a.click()
  URL.revokeObjectURL(url)
}

export function InventarioFisicoClient({ inventarios, items, puedeCargar }: {
  inventarios: InventarioFisico[]
  items: ItemFisico[]
  puedeCargar: boolean
}) {
  const [tab, setTab] = useState<Tab>(inventarios.length >= 2 ? 'comparar' : 'resumen')
  const [cargando, setCargando] = useState(false)

  const porInventario = useMemo(() => {
    const m = new Map<string, ItemFisico[]>()
    for (const it of items) {
      const l = m.get(it.inventario_id)
      if (l) l.push(it)
      else m.set(it.inventario_id, [it])
    }
    return m
  }, [items])

  const TABS: { id: Tab; label: string; icon: typeof ClipboardList }[] = [
    { id: 'resumen', label: 'Conteos', icon: ClipboardList },
    { id: 'comparar', label: 'Comparar periodos', icon: GitCompareArrows },
    { id: 'sistema', label: 'Conteo vs sistema', icon: Scale },
    { id: 'tendencia', label: 'Tendencia', icon: TrendingUp },
  ]

  return (
    <div className="p-4 sm:p-6 space-y-5">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-heading font-bold text-2xl text-gray-900 flex items-center gap-2">
            <History className="w-6 h-6 text-brand-green" /> Inventario físico
          </h1>
          <p className="font-body text-sm text-gray-500 mt-0.5">
            Historial de conteos físicos: qué falta, qué se agotó y cómo cambia cada producto en el tiempo.
          </p>
        </div>
        {puedeCargar && (
          <button onClick={() => setCargando(true)}
            className="flex items-center gap-2 bg-brand-green text-white font-body font-semibold text-sm px-4 py-2 rounded-lg hover:bg-brand-green-dark transition-colors shadow-sm">
            <Upload className="w-4 h-4" /> Cargar inventario
          </button>
        )}
      </div>

      <div className="flex gap-1 overflow-x-auto border-b border-gray-200">
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`flex items-center gap-1.5 px-3 py-2 font-body text-sm font-semibold whitespace-nowrap border-b-2 -mb-px transition-colors ${
              tab === t.id ? 'border-brand-green text-brand-green' : 'border-transparent text-gray-500 hover:text-gray-800'}`}>
            <t.icon className="w-4 h-4" /> {t.label}
          </button>
        ))}
      </div>

      {inventarios.length === 0 ? (
        <div className="bg-white border border-gray-100 rounded-2xl p-12 text-center text-gray-400">
          <ClipboardList className="w-10 h-10 mx-auto mb-3 text-gray-300" />
          <p className="font-heading font-bold text-lg text-gray-600">Aún no hay conteos físicos</p>
          <p className="font-body text-sm mt-1">Carga el Excel del primer inventario para empezar a comparar.</p>
        </div>
      ) : tab === 'resumen' ? (
        <Resumen inventarios={inventarios} />
      ) : tab === 'comparar' ? (
        <Comparar inventarios={inventarios} porInventario={porInventario} />
      ) : tab === 'sistema' ? (
        <VsSistema inventarios={inventarios} porInventario={porInventario} />
      ) : (
        <Tendencia inventarios={inventarios} items={items} />
      )}

      {cargando && <CargarInventario periodos={inventarios.map(i => i.periodo)} onClose={() => setCargando(false)} />}
    </div>
  )
}

// ── Pestaña: conteos ────────────────────────────────────────────────────────

function Resumen({ inventarios }: { inventarios: InventarioFisico[] }) {
  const data = inventarios.map(i => ({
    periodo: i.periodo,
    unidades: i.total_unidades,
    'con existencias': i.items_con_cantidad - i.items_en_cero,
    'en cero': i.items_en_cero,
  }))
  const recientes = [...inventarios].reverse()
  return (
    <div className="space-y-5">
      <div className="bg-white border border-gray-100 rounded-2xl p-4 shadow-sm">
        <h2 className="font-heading font-bold text-base text-gray-900 mb-2">Evolución de los conteos</h2>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data} margin={{ top: 5, right: 5, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
              <XAxis dataKey="periodo" tick={{ fontSize: 11, fill: '#6b7280' }} axisLine={false} tickLine={false} />
              <YAxis yAxisId="items" tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} allowDecimals={false} />
              <YAxis yAxisId="unid" orientation="right" tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false}
                tickFormatter={v => fmt.format(v)} />
              <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid #f0f0f0', fontSize: 12 }}
                formatter={(v: number) => fmt.format(v)} cursor={{ fill: '#f9fafb' }} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar yAxisId="items" dataKey="con existencias" stackId="i" fill="#16a34a" maxBarSize={48} />
              <Bar yAxisId="items" dataKey="en cero" stackId="i" fill="#f97316" radius={[4, 4, 0, 0]} maxBarSize={48} />
              <Line yAxisId="unid" dataKey="unidades" name="Unidades contadas" stroke="#2563eb" strokeWidth={2} dot={{ r: 4 }} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {recientes.map(i => (
          <Link key={i.id} href={`/inventario-fisico/${i.id}`} title="Ver el informe comparativo de este conteo"
            className="block bg-white border border-gray-100 rounded-2xl p-5 shadow-sm hover:shadow-md hover:border-brand-green/30 transition-all">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h3 className="font-heading font-bold text-base text-gray-900">{i.periodo}</h3>
                <p className="font-body text-xs text-gray-500">Corte {fecha(i.fecha_corte)}{i.archivo_nombre ? ` · ${i.archivo_nombre}` : ''}</p>
              </div>
              {i.historico && (
                <span className="font-body text-[11px] font-semibold px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 shrink-0"
                  title="Foto reconstruida después de aplicar el cruce">Histórico</span>
              )}
            </div>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 mt-4 font-body text-sm">
              <Dato k="Productos contados" v={fmt.format(i.total_items)} />
              <Dato k="Unidades" v={fmt.format(i.total_unidades)} />
              <Dato k="En cero" v={fmt.format(i.items_en_cero)} tono="text-orange-600" />
              <Dato k="Stock ajustado" v={fmt.format(i.items_ajustados)} />
              <Dato k="Productos nuevos" v={fmt.format(i.items_nuevos)} />
              <Dato k="No hallados" v={fmt.format(i.items_no_hallados)} tono="text-red-600" />
            </dl>
            {i.observacion && <p className="font-body text-xs text-gray-400 mt-3">{i.observacion}</p>}
            <p className="flex items-center gap-1.5 font-body text-sm font-semibold text-brand-green mt-4">
              <FileBarChart className="w-4 h-4" /> Ver informe comparativo <ChevronRight className="w-4 h-4" />
            </p>
          </Link>
        ))}
      </div>
    </div>
  )
}

function Dato({ k, v, tono = 'text-gray-900' }: { k: string; v: string; tono?: string }) {
  return (
    <div>
      <dt className="text-xs text-gray-500">{k}</dt>
      <dd className={`font-semibold ${tono}`}>{v}</dd>
    </div>
  )
}

// ── Pestaña: comparar dos periodos ──────────────────────────────────────────

function Selector({ label, value, onChange, inventarios }: {
  label: string; value: string; onChange: (v: string) => void; inventarios: InventarioFisico[]
}) {
  return (
    <label className="font-body text-sm text-gray-600 flex flex-col gap-1">
      {label}
      <select value={value} onChange={e => onChange(e.target.value)}
        className="border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900 bg-white min-w-[12rem]">
        {inventarios.map(i => <option key={i.id} value={i.id}>{i.periodo} · {fecha(i.fecha_corte)}</option>)}
      </select>
    </label>
  )
}

function Buscador({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="relative flex-1 min-w-[12rem]">
      <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
      <input value={value} onChange={e => onChange(e.target.value)} placeholder="Buscar por ítem o nombre…"
        className="w-full border border-gray-200 rounded-lg pl-9 pr-3 py-2 font-body text-sm" />
    </div>
  )
}

const coincide = (busca: string, codigo: number | null, nombre: string) => {
  const b = busca.trim().toLowerCase()
  return !b || String(codigo ?? '').startsWith(b) || nombre.toLowerCase().includes(b)
}

function Comparar({ inventarios, porInventario }: { inventarios: InventarioFisico[]; porInventario: Map<string, ItemFisico[]> }) {
  const ult = inventarios.length - 1
  const [idA, setIdA] = useState(inventarios[Math.max(0, ult - 1)].id)
  const [idB, setIdB] = useState(inventarios[ult].id)
  const [filtro, setFiltro] = useState<EstadoComparacion | 'CAMBIOS' | 'TODOS'>('CAMBIOS')
  const [busca, setBusca] = useState('')

  const filas = useMemo(
    () => compararConteos(porInventario.get(idA) ?? [], porInventario.get(idB) ?? []),
    [idA, idB, porInventario],
  )
  const r = useMemo(() => resumenComparacion(filas), [filas])
  const visibles = filas.filter(f =>
    (filtro === 'TODOS' || (filtro === 'CAMBIOS' ? f.estado !== 'IGUAL' : f.estado === filtro))
    && coincide(busca, f.codigo, f.nombre))

  const invA = inventarios.find(i => i.id === idA)!
  const invB = inventarios.find(i => i.id === idB)!
  const mismo = idA === idB

  const chips: { id: typeof filtro; label: string; n: number }[] = [
    { id: 'CAMBIOS', label: 'Con cambios', n: filas.length - r.iguales },
    { id: 'FALTANTE', label: 'Faltantes', n: r.faltantes },
    { id: 'AGOTADO', label: 'Se agotaron', n: r.agotados },
    { id: 'BAJO', label: 'Bajaron', n: r.bajaron },
    { id: 'SUBIO', label: 'Subieron', n: r.subieron },
    { id: 'REPUESTO', label: 'Repuestos', n: r.repuestos },
    { id: 'NUEVO', label: 'Nuevos', n: r.nuevos },
    { id: 'TODOS', label: 'Todos', n: filas.length },
  ]

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <Selector label="Periodo anterior" value={idA} onChange={setIdA} inventarios={inventarios} />
        <Selector label="Periodo actual" value={idB} onChange={setIdB} inventarios={inventarios} />
        {inventarios.length < 2 && (
          <p className="font-body text-sm text-gray-500 pb-2">Solo hay un conteo: carga otro para comparar.</p>
        )}
      </div>

      {mismo ? (
        <p className="font-body text-sm text-gray-500">Elige dos periodos distintos.</p>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Kpi titulo="Faltantes" valor={r.faltantes} nota={`estaban en ${invA.periodo} y no vinieron`} tono="text-red-600" />
            <Kpi titulo="Se agotaron" valor={r.agotados} nota="tenían existencias y quedaron en cero" tono="text-orange-600" />
            <Kpi titulo="Bajaron / subieron" valor={`${r.bajaron} / ${r.subieron}`} nota={`${r.repuestos} repuestos desde cero`} />
            <Kpi titulo="Unidades" valor={fmt.format(r.unidadesActual)}
              nota={`${r.unidadesActual - r.unidadesAnterior >= 0 ? '+' : ''}${fmt.format(r.unidadesActual - r.unidadesAnterior)} vs ${fmt.format(r.unidadesAnterior)}`} />
          </div>
          {(r.valorPerdido !== 0 || r.valorGanado !== 0) && (
            <p className="font-body text-xs text-gray-500">
              Valorizado a precio de lista: bajas por <b className="text-red-600">{cop.format(r.valorPerdido)}</b> y alzas por{' '}
              <b className="text-green-700">{cop.format(r.valorGanado)}</b> (solo productos con precio).
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            {chips.map(c => (
              <button key={c.id} onClick={() => setFiltro(c.id)}
                className={`font-body text-xs font-semibold px-3 py-1.5 rounded-full border transition-colors ${
                  filtro === c.id ? 'bg-brand-green text-white border-brand-green' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'}`}>
                {c.label} <span className="opacity-70">{c.n}</span>
              </button>
            ))}
          </div>

          <div className="flex flex-wrap gap-2 items-center">
            <Buscador value={busca} onChange={setBusca} />
            <button onClick={() => exportar(`comparativa-${invA.periodo}-vs-${invB.periodo}.xlsx`, 'Comparativa', visibles.map(f => ({
              ITEM: f.codigo, PRODUCTO: f.nombre, PRESENTACION: f.presentacion ?? '',
              [invA.periodo]: f.estado === 'NUEVO' ? 'no vino' : f.anterior ?? 'sin cantidad',
              [invB.periodo]: f.estado === 'FALTANTE' ? 'no vino' : f.actual ?? 'sin cantidad',
              DIFERENCIA: f.diferencia,
              'VARIACION %': f.porcentaje === null ? null : Math.round(f.porcentaje), ESTADO: ETIQUETA_COMPARACION[f.estado],
              'VALOR DIFERENCIA': f.valorDiferencia,
            })))}
              className="flex items-center gap-1.5 border border-gray-200 bg-white rounded-lg px-3 py-2 font-body text-sm font-semibold text-gray-700 hover:bg-gray-50">
              <Download className="w-4 h-4" /> Excel
            </button>
          </div>

          <Tabla
            cabeceras={['Ítem', 'Producto', invA.periodo, invB.periodo, 'Diferencia', 'Estado']}
            vacio="Nada que mostrar con este filtro."
            filas={visibles.map(f => ({
              key: f.clave,
              celdas: [
                <span key="c" className="text-gray-500">{f.codigo ?? '—'}</span>,
                <Nombre key="n" nombre={f.nombre} presentacion={f.presentacion} />,
                <span key="a" className="tabular-nums">{f.estado === 'NUEVO' ? <i className="text-gray-400">no vino</i> : f.anterior === null ? <SinCantidad /> : q(f.anterior)}</span>,
                <span key="b" className="tabular-nums">{f.estado === 'FALTANTE' ? <i className="text-gray-400">no vino</i> : f.actual === null ? <SinCantidad /> : q(f.actual)}</span>,
                <Delta key="d" valor={f.diferencia} porcentaje={f.porcentaje} />,
                <Badge key="e" cls={CLS_COMPARACION[f.estado]} texto={ETIQUETA_COMPARACION[f.estado]} />,
              ],
            }))}
          />
        </>
      )}
    </div>
  )
}

// ── Pestaña: lo contado frente a lo que decía el sistema ────────────────────

function VsSistema({ inventarios, porInventario }: { inventarios: InventarioFisico[]; porInventario: Map<string, ItemFisico[]> }) {
  const [id, setId] = useState(inventarios[inventarios.length - 1].id)
  const [filtro, setFiltro] = useState<EstadoSistema | 'DIFERENCIAS'>('DIFERENCIAS')
  const [busca, setBusca] = useState('')
  const inv = inventarios.find(i => i.id === id)!
  // Por ítem y luego alfabético, como todo el módulo
  const lista = useMemo(() => ordenarPorItem((porInventario.get(id) ?? []).map(i => ({ ...i, es: estadoSistema(i) })),
    i => i.codigo, i => i.nombre), [id, porInventario])

  const cuenta = (e: EstadoSistema) => lista.filter(i => i.es === e).length
  const valor = (e: EstadoSistema) => lista.filter(i => i.es === e)
    .reduce((s, i) => s + (i.diferencia ?? 0) * (i.precio_unitario ?? 0), 0)
  const unidades = (e: EstadoSistema) => lista.filter(i => i.es === e).reduce((s, i) => s + (i.diferencia ?? 0), 0)

  const visibles = lista.filter(i =>
    (filtro === 'DIFERENCIAS' ? i.es === 'FALTANTE' || i.es === 'SOBRANTE' : i.es === filtro)
    && coincide(busca, i.codigo, i.nombre))

  const chips: { id: typeof filtro; label: string; n: number }[] = [
    { id: 'DIFERENCIAS', label: 'Con diferencia', n: cuenta('FALTANTE') + cuenta('SOBRANTE') },
    { id: 'FALTANTE', label: 'Faltantes físicos', n: cuenta('FALTANTE') },
    { id: 'SOBRANTE', label: 'Sobrantes', n: cuenta('SOBRANTE') },
    { id: 'NO_HALLADO', label: 'No hallados', n: cuenta('NO_HALLADO') },
    { id: 'SIN_CANTIDAD', label: 'Sin cantidad', n: cuenta('SIN_CANTIDAD') },
    ...(cuenta('SIN_SISTEMA') ? [{ id: 'SIN_SISTEMA' as const, label: 'Sin dato del sistema', n: cuenta('SIN_SISTEMA') }] : []),
    { id: 'CUADRA', label: 'Cuadran', n: cuenta('CUADRA') },
  ]

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <Selector label="Conteo" value={id} onChange={setId} inventarios={inventarios} />
        <p className="font-body text-xs text-gray-500 pb-2 max-w-md">
          Compara lo contado con el stock que tenía el sistema justo antes de aplicar el conteo.
          {inv.historico && ' En este conteo histórico el stock previo se reconstruyó del reporte del cruce.'}
        </p>
        <Link href={`/inventario-fisico/${id}`} className="flex items-center gap-1.5 font-body text-sm font-semibold text-brand-green pb-2 hover:underline">
          <FileBarChart className="w-4 h-4" /> Informe completo de {inv.periodo}
        </Link>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi titulo="Faltantes físicos" valor={cuenta('FALTANTE')} nota={`${fmt.format(unidades('FALTANTE'))} unidades`} tono="text-red-600" />
        <Kpi titulo="Sobrantes" valor={cuenta('SOBRANTE')} nota={`+${fmt.format(unidades('SOBRANTE'))} unidades`} tono="text-blue-600" />
        <Kpi titulo="Cuadran" valor={cuenta('CUADRA')} nota="contado = sistema" tono="text-green-700" />
        <Kpi titulo="No hallados" valor={cuenta('NO_HALLADO')} nota="activos que no vinieron en el archivo" tono="text-orange-600" />
      </div>
      {(valor('FALTANTE') !== 0 || valor('SOBRANTE') !== 0) && (
        <p className="font-body text-xs text-gray-500">
          Valorizado a precio de lista: faltantes <b className="text-red-600">{cop.format(valor('FALTANTE'))}</b>, sobrantes{' '}
          <b className="text-blue-700">{cop.format(valor('SOBRANTE'))}</b>.
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {chips.map(c => (
          <button key={c.id} onClick={() => setFiltro(c.id)}
            className={`font-body text-xs font-semibold px-3 py-1.5 rounded-full border transition-colors ${
              filtro === c.id ? 'bg-brand-green text-white border-brand-green' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'}`}>
            {c.label} <span className="opacity-70">{c.n}</span>
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        <Buscador value={busca} onChange={setBusca} />
        <button onClick={() => exportar(`conteo-vs-sistema-${inv.periodo}.xlsx`, 'Conteo vs sistema', visibles.map(i => ({
          ITEM: i.codigo, PRODUCTO: i.nombre, PRESENTACION: i.presentacion ?? '',
          'STOCK SISTEMA': i.stock_sistema,
          CONTADO: i.es === 'NO_HALLADO' ? 'no vino' : i.cantidad_contada ?? 'sin cantidad', DIFERENCIA: i.diferencia,
          ESTADO: ETIQUETA_SISTEMA[i.es],
          'VALOR DIFERENCIA': i.diferencia !== null && i.precio_unitario ? i.diferencia * i.precio_unitario : null,
        })))}
          className="flex items-center gap-1.5 border border-gray-200 bg-white rounded-lg px-3 py-2 font-body text-sm font-semibold text-gray-700 hover:bg-gray-50">
          <Download className="w-4 h-4" /> Excel
        </button>
      </div>

      <Tabla
        cabeceras={['Ítem', 'Producto', 'Sistema', 'Contado', 'Diferencia', 'Estado']}
        vacio="Nada que mostrar con este filtro."
        filas={visibles.map(i => ({
          key: `${i.producto_id ?? i.codigo}-${i.nombre}`,
          celdas: [
            <span key="c" className="text-gray-500">{i.codigo ?? '—'}</span>,
            <Nombre key="n" nombre={i.nombre} presentacion={i.presentacion} />,
            <span key="s" className="tabular-nums">{q(i.stock_sistema)}</span>,
            <span key="q" className="tabular-nums">{i.es === 'NO_HALLADO' ? <i className="text-gray-400">no vino</i> : i.cantidad_contada === null ? <SinCantidad /> : q(i.cantidad_contada)}</span>,
            <Delta key="d" valor={i.diferencia} />,
            <Badge key="e" cls={CLS_SISTEMA[i.es]} texto={ETIQUETA_SISTEMA[i.es]} />,
          ],
        }))}
      />
    </div>
  )
}

// ── Pestaña: tendencia de cada producto en todos los conteos ────────────────

type FiltroTendencia = 'TODOS' | 'DESAPARECIERON' | 'SIEMPRE_CERO' | 'BAJANDO'

function Tendencia({ inventarios, items }: { inventarios: InventarioFisico[]; items: ItemFisico[] }) {
  const [busca, setBusca] = useState('')
  const [filtro, setFiltro] = useState<FiltroTendencia>('TODOS')
  const filas = useMemo(() => tendencia(inventarios, items), [inventarios, items])
  const ultimo = inventarios[inventarios.length - 1].id

  const serie = (f: (typeof filas)[number]) => inventarios.map(i => f.valores[i.id]).filter((v): v is number => typeof v === 'number')
  const esBajando = (f: (typeof filas)[number]) => {
    const s = serie(f)
    return s.length >= 2 && s[s.length - 1] < s[0]
  }
  const cumple = (f: (typeof filas)[number], fl: FiltroTendencia) => {
    if (fl === 'DESAPARECIERON') return f.ultimo !== ultimo
    if (fl === 'SIEMPRE_CERO') return serie(f).length > 0 && serie(f).every(v => v === 0)
    if (fl === 'BAJANDO') return esBajando(f)
    return true
  }
  const visibles = filas.filter(f => cumple(f, filtro) && coincide(busca, f.codigo, f.nombre))
  const nTotal = (fl: FiltroTendencia) => filas.filter(f => cumple(f, fl)).length

  const chips: { id: FiltroTendencia; label: string }[] = [
    { id: 'TODOS', label: 'Todos' },
    { id: 'DESAPARECIERON', label: 'Dejaron de venir' },
    { id: 'BAJANDO', label: 'Van bajando' },
    { id: 'SIEMPRE_CERO', label: 'Siempre en cero' },
  ]

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {chips.map(c => (
          <button key={c.id} onClick={() => setFiltro(c.id)}
            className={`font-body text-xs font-semibold px-3 py-1.5 rounded-full border transition-colors ${
              filtro === c.id ? 'bg-brand-green text-white border-brand-green' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'}`}>
            {c.label} <span className="opacity-70">{nTotal(c.id)}</span>
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-2 items-center">
        <Buscador value={busca} onChange={setBusca} />
        <button onClick={() => exportar('tendencia-inventario-fisico.xlsx', 'Tendencia', visibles.map(f => ({
          ITEM: f.codigo, PRODUCTO: f.nombre, PRESENTACION: f.presentacion ?? '',
          ...Object.fromEntries(inventarios.map(i => [i.periodo,
            !(i.id in f.valores) ? 'no vino' : f.valores[i.id] === null ? 'sin cantidad' : f.valores[i.id]])),
        })))}
          className="flex items-center gap-1.5 border border-gray-200 bg-white rounded-lg px-3 py-2 font-body text-sm font-semibold text-gray-700 hover:bg-gray-50">
          <Download className="w-4 h-4" /> Excel
        </button>
      </div>

      <Tabla
        cabeceras={['Ítem', 'Producto', ...inventarios.map(i => i.periodo), 'Tendencia']}
        vacio="Nada que mostrar con este filtro."
        filas={visibles.map(f => {
          const s = serie(f)
          const t = s.length < 2 ? 0 : Math.sign(s[s.length - 1] - s[0])
          return {
            key: f.clave,
            celdas: [
              <span key="c" className="text-gray-500">{f.codigo ?? '—'}</span>,
              <Nombre key="n" nombre={f.nombre} presentacion={f.presentacion} />,
              ...inventarios.map(i => (
                <span key={i.id} className="tabular-nums">
                  {!(i.id in f.valores) ? <i className="text-red-400">no vino</i>
                    : f.valores[i.id] === null ? <i className="text-gray-400 whitespace-nowrap" title="Celda vacía en el archivo">sin cantidad</i>
                    : q(f.valores[i.id])}
                </span>
              )),
              <span key="t" title={s.length < 2 ? 'Un solo conteo' : `${q(s[0])} → ${q(s[s.length - 1])}`}>
                {t < 0 ? <ArrowDownRight className="w-4 h-4 text-red-500" />
                  : t > 0 ? <ArrowUpRight className="w-4 h-4 text-green-600" />
                  : <Minus className="w-4 h-4 text-gray-300" />}
              </span>,
            ],
          }
        })}
      />
    </div>
  )
}

// ── Piezas comunes ──────────────────────────────────────────────────────────

/** Celda vacía en el archivo: no es 0, no se sabe cuánto había. */
function SinCantidad() {
  return <i className="text-gray-400 whitespace-nowrap" title="Celda vacía en el archivo">sin cantidad</i>
}

function Kpi({ titulo, valor, nota, tono = 'text-gray-900' }: { titulo: string; valor: number | string; nota?: string; tono?: string }) {
  return (
    <div className="bg-white border border-gray-100 rounded-2xl p-4 shadow-sm">
      <p className="font-body text-xs text-gray-500">{titulo}</p>
      <p className={`font-heading font-bold text-2xl ${tono}`}>{typeof valor === 'number' ? fmt.format(valor) : valor}</p>
      {nota && <p className="font-body text-[11px] text-gray-400 mt-0.5">{nota}</p>}
    </div>
  )
}

function Nombre({ nombre, presentacion }: { nombre: string; presentacion: string | null }) {
  return (
    <div className="min-w-[14rem]">
      <p className="text-gray-900 leading-tight">{nombre}</p>
      {presentacion && <p className="text-xs text-gray-400">{presentacion}</p>}
    </div>
  )
}

function Delta({ valor, porcentaje }: { valor: number | null; porcentaje?: number | null }) {
  if (valor === null) return <span className="text-gray-300">—</span>
  const cls = valor < 0 ? 'text-red-600' : valor > 0 ? 'text-green-700' : 'text-gray-400'
  return (
    <span className={`tabular-nums font-semibold ${cls}`}>
      {valor > 0 ? '+' : ''}{fmt.format(valor)}
      {porcentaje !== undefined && porcentaje !== null && (
        <span className="font-normal text-xs opacity-70"> ({porcentaje > 0 ? '+' : ''}{Math.round(porcentaje)}%)</span>
      )}
    </span>
  )
}

function Badge({ cls, texto }: { cls: string; texto: string }) {
  return <span className={`inline-block font-body text-[11px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${cls}`}>{texto}</span>
}

const PAGINA = 200

function Tabla({ cabeceras, filas, vacio }: {
  cabeceras: string[]
  filas: { key: string; celdas: React.ReactNode[] }[]
  vacio: string
}) {
  const [limite, setLimite] = useState(PAGINA)
  if (!filas.length) {
    return <div className="bg-white border border-gray-100 rounded-2xl p-8 text-center font-body text-sm text-gray-400">{vacio}</div>
  }
  return (
    <div className="bg-white border border-gray-100 rounded-2xl shadow-sm overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full font-body text-sm">
          <thead className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wide">
            <tr>{cabeceras.map((c, i) => <th key={i} className="text-left font-semibold px-3 py-2 whitespace-nowrap">{c}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {filas.slice(0, limite).map(f => (
              <tr key={f.key} className="hover:bg-gray-50/60">
                {f.celdas.map((c, i) => <td key={i} className="px-3 py-2 align-top">{c}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between px-3 py-2 border-t border-gray-100 font-body text-xs text-gray-500">
        <span>{Math.min(limite, filas.length)} de {filas.length}</span>
        {limite < filas.length && (
          <button onClick={() => setLimite(l => l + PAGINA)} className="text-brand-green font-semibold hover:underline">Ver más</button>
        )}
      </div>
    </div>
  )
}

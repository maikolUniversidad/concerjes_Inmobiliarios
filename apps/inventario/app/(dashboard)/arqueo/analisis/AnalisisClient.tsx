'use client'

import { useMemo, useState } from 'react'
import {
  CalendarRange, GitCompareArrows, Grid3x3, Download, Search, Monitor, FileSpreadsheet, Info,
} from 'lucide-react'
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend, ReferenceLine,
} from 'recharts'
import {
  resumenPorMes, compararDosConteos, resumenCambios, parPorDefecto, matrizConteos, seriePorMes,
  coincideBusqueda, etiquetaMes, ETIQUETA_CAMBIO,
  type Conteo, type EstadoCambio, type FuenteConteo, type Metricas,
} from '@/lib/arqueo-analisis'

const fmt = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 2 })
const cop = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 })
const pct = (v: number | null) => (v === null ? '—' : `${fmt.format(Math.round(v * 10) / 10)}%`)
const q = (v: number | null | undefined) => (v === null || v === undefined ? '—' : fmt.format(v))

function fecha(f: string) {
  const d = /^\d{4}-\d{2}-\d{2}$/.test(f) ? new Date(f + 'T12:00:00-05:00') : new Date(f)
  return d.toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'America/Bogota' })
}

const ORIGEN: Record<FuenteConteo, { label: string; cls: string; icon: typeof Monitor }> = {
  PLATAFORMA: { label: 'Plataforma', cls: 'bg-brand-green-bg text-brand-green', icon: Monitor },
  CARGUE: { label: 'Cargue masivo', cls: 'bg-indigo-50 text-indigo-700', icon: FileSpreadsheet },
}
const ESTADO_ARQUEO = {
  ABIERTO: { label: 'En progreso', cls: 'bg-blue-100 text-blue-700' },
  CERRADO: { label: 'Cerrado', cls: 'bg-green-100 text-green-700' },
  ANULADO: { label: 'Anulado', cls: 'bg-gray-100 text-gray-500' },
}
const CLS_CAMBIO: Record<EstadoCambio, string> = {
  FALTANTE: 'bg-red-100 text-red-700',
  AGOTADO: 'bg-orange-100 text-orange-700',
  BAJO: 'bg-amber-50 text-amber-700',
  SUBIO: 'bg-green-50 text-green-700',
  NUEVO: 'bg-blue-100 text-blue-700',
  IGUAL: 'bg-gray-100 text-gray-500',
  SIN_COMPARAR: 'bg-gray-50 text-gray-400',
}

/** Nombre corto de un conteo para columnas y selectores. */
const rotulo = (c: Conteo) => `${c.nombre} (${c.fuente === 'CARGUE' ? 'cargue' : 'plataforma'}${c.parcial ? ', parcial' : ''})`

async function exportar(nombre: string, hoja: string, filas: Record<string, unknown>[]) {
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet(hoja.slice(0, 31))
  if (filas.length) {
    ws.columns = Object.keys(filas[0]).map(k => ({ header: k, key: k, width: k === 'PRODUCTO' ? 44 : Math.max(12, Math.min(28, k.length + 2)) }))
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

type Tab = 'meses' | 'comparar' | 'matriz'
type FiltroFuente = 'TODAS' | FuenteConteo

export function AnalisisClient({ conteos, sinCargues }: { conteos: Conteo[]; sinCargues: boolean }) {
  const [tab, setTab] = useState<Tab>('meses')
  const [fuente, setFuente] = useState<FiltroFuente>('TODAS')
  const [conVacios, setConVacios] = useState(false)

  // Conteos que entran a Meses y Matriz según el origen elegido
  const visibles = useMemo(() => conteos.filter(c =>
    (fuente === 'TODAS' || c.fuente === fuente) && (conVacios || c.items.length > 0)), [conteos, fuente, conVacios])
  const vacios = conteos.filter(c => c.items.length === 0).length

  const TABS: { id: Tab; label: string; icon: typeof CalendarRange }[] = [
    { id: 'meses', label: 'Resumen por mes', icon: CalendarRange },
    { id: 'comparar', label: 'Comparar dos conteos', icon: GitCompareArrows },
    { id: 'matriz', label: 'Todos los conteos', icon: Grid3x3 },
  ]

  if (conteos.length === 0) {
    return (
      <div className="bg-white border border-gray-100 rounded-2xl p-12 text-center text-gray-400">
        <CalendarRange className="w-10 h-10 mx-auto mb-3 text-gray-300" />
        <p className="font-heading font-bold text-lg text-gray-600">Aún no hay conteos para analizar</p>
        <p className="font-body text-sm mt-1">Haz un arqueo en la plataforma o carga un inventario físico por Excel.</p>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <LineaDeTiempo conteos={conteos} />

      {sinCargues && (
        <p className="font-body text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2 flex items-center gap-2">
          <Info className="w-4 h-4 shrink-0" /> No tienes el permiso &quot;Ver inventario físico&quot;: solo ves los arqueos hechos en la plataforma, no los cargues masivos.
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200">
        <div className="flex flex-wrap gap-1">
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`flex items-center gap-1.5 px-3 py-2 font-body text-sm font-semibold whitespace-nowrap border-b-2 -mb-px transition-colors ${
                tab === t.id ? 'border-brand-green text-brand-green' : 'border-transparent text-gray-500 hover:text-gray-800'}`}>
              <t.icon className="w-4 h-4" /> {t.label}
            </button>
          ))}
        </div>
        {tab !== 'comparar' && (
          <div className="flex flex-wrap items-center gap-2 pb-2">
            {([['TODAS', 'Todos los orígenes'], ['PLATAFORMA', 'Plataforma'], ['CARGUE', 'Cargue masivo']] as const).map(([id, label]) => (
              <Chip key={id} activo={fuente === id} onClick={() => setFuente(id)} label={label} />
            ))}
            {vacios > 0 && (
              <label className="flex items-center gap-1.5 font-body text-xs text-gray-600 ml-1">
                <input type="checkbox" checked={conVacios} onChange={e => setConVacios(e.target.checked)} className="accent-brand-green" />
                Incluir arqueos sin ítems contados ({vacios})
              </label>
            )}
          </div>
        )}
      </div>

      {tab === 'meses' ? <Meses conteos={visibles} />
        : tab === 'comparar' ? <Comparar conteos={conteos} />
        : <Matriz conteos={visibles} />}
    </div>
  )
}

// ── Línea de tiempo de todos los conteos ────────────────────────────────────

function LineaDeTiempo({ conteos }: { conteos: Conteo[] }) {
  return (
    <div className="bg-white border border-gray-100 rounded-2xl p-4 shadow-sm">
      <h2 className="font-heading font-bold text-base text-gray-900 mb-3">Línea de tiempo de conteos</h2>
      <ol className="flex gap-3 overflow-x-auto pb-1">
        {conteos.map(c => {
          const o = ORIGEN[c.fuente]
          const m = resumenRapido(c)
          return (
            <li key={c.id} className="min-w-[13rem] max-w-[15rem] shrink-0 rounded-xl border border-gray-100 p-3 relative">
              <p className="font-body text-[11px] text-gray-400">{fecha(c.fecha)}</p>
              <p className="font-heading font-bold text-sm text-gray-900 line-clamp-1" title={c.nombre}>{c.nombre}</p>
              <div className="flex flex-wrap gap-1 mt-1">
                <Badge cls={o.cls} texto={o.label} />
                {c.estado && <Badge cls={ESTADO_ARQUEO[c.estado].cls} texto={ESTADO_ARQUEO[c.estado].label} />}
                {c.parcial && <Badge cls="bg-amber-50 text-amber-700" texto="Parcial" />}
              </div>
              <p className="font-body text-xs text-gray-500 mt-2">
                {fmt.format(c.items.length)} {c.fuente === 'PLATAFORMA' ? `de ${fmt.format(c.alcance)} ` : ''}contados
                {m.exactitud !== null && <> · <b className="text-gray-700">{pct(m.exactitud)}</b> exactitud</>}
              </p>
            </li>
          )
        })}
      </ol>
    </div>
  )
}

function resumenRapido(c: Conteo) {
  const comparables = c.items.filter(i => i.diferencia !== null)
  return { exactitud: comparables.length ? (comparables.filter(i => i.diferencia === 0).length / comparables.length) * 100 : null }
}

// ── Pestaña: resumen por mes ────────────────────────────────────────────────

function Meses({ conteos }: { conteos: Conteo[] }) {
  const meses = useMemo(() => resumenPorMes(conteos), [conteos])
  const serie = useMemo(() => seriePorMes(conteos), [conteos])

  if (!conteos.length) return <Vacio texto="No hay conteos con este filtro." />

  const filaExcel = (mes: string, c: Conteo | null, m: Metricas) => ({
    MES: etiquetaMes(mes),
    CONTEO: c ? c.nombre : 'TOTAL DEL MES',
    ORIGEN: c ? ORIGEN[c.fuente].label : '',
    ESTADO: c?.estado ? ESTADO_ARQUEO[c.estado].label + (c.parcial ? ' (parcial)' : '') : '',
    FECHA: c ? fecha(c.fecha) : '',
    'PRODUCTOS CONTADOS': m.contados,
    UNIDADES: m.unidades,
    'FALTANTES (ÍTEMS)': m.faltantes,
    'FALTANTES (UNIDADES)': m.unidadesFaltantes,
    'SOBRANTES (ÍTEMS)': m.sobrantes,
    'SOBRANTES (UNIDADES)': m.unidadesSobrantes,
    CUADRAN: m.cuadran,
    'VALOR FALTANTES': Math.round(m.valorFaltantes),
    'VALOR SOBRANTES': Math.round(m.valorSobrantes),
    'VALOR NETO': Math.round(m.valorNeto),
    'EXACTITUD %': m.exactitud === null ? null : Math.round(m.exactitud * 10) / 10,
  })

  return (
    <div className="space-y-5">
      {serie.length > 0 && (
        <div className="grid lg:grid-cols-2 gap-4">
          <div className="bg-white border border-gray-100 rounded-2xl p-4 shadow-sm">
            <h3 className="font-heading font-bold text-sm text-gray-900">Exactitud por mes</h3>
            <p className="font-body text-xs text-gray-500 mb-2">% de productos contados que cuadran con el sistema</p>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={serie} margin={{ top: 8, right: 12, left: -16, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
                  <XAxis dataKey="etiqueta" tick={{ fontSize: 11, fill: '#6b7280' }} axisLine={false} tickLine={false} />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} tickFormatter={v => `${v}%`} />
                  <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid #f0f0f0', fontSize: 12 }}
                    formatter={(v: number) => [`${fmt.format(v)}%`, 'Exactitud']} />
                  <Line dataKey="exactitud" name="Exactitud" stroke="#2E7D32" strokeWidth={2} dot={{ r: 5 }} activeDot={{ r: 7 }} connectNulls />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div className="bg-white border border-gray-100 rounded-2xl p-4 shadow-sm">
            <h3 className="font-heading font-bold text-sm text-gray-900">Valor de las diferencias por mes</h3>
            <p className="font-body text-xs text-gray-500 mb-2">Faltantes y sobrantes contra el sistema, a precio de lista</p>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={serie} stackOffset="sign" margin={{ top: 8, right: 12, left: 8, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
                  <XAxis dataKey="etiqueta" tick={{ fontSize: 11, fill: '#6b7280' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false}
                    tickFormatter={v => new Intl.NumberFormat('es-CO', { notation: 'compact', maximumFractionDigits: 1 }).format(v)} />
                  <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid #f0f0f0', fontSize: 12 }}
                    formatter={(v: number, k: string) => [cop.format(v), k]} cursor={{ fill: '#f9fafb' }} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <ReferenceLine y={0} stroke="#d1d5db" />
                  <Bar dataKey="faltantes" name="Faltantes" stackId="v" fill="#dc2626" radius={[0, 0, 4, 4]} maxBarSize={48} />
                  <Bar dataKey="sobrantes" name="Sobrantes" stackId="v" fill="#2563eb" radius={[4, 4, 0, 0]} maxBarSize={48} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}

      <div className="flex justify-end">
        <BotonExcel onClick={() => exportar('arqueo-resumen-por-mes.xlsx', 'Resumen por mes', meses.flatMap(r => [
          ...r.conteos.map(({ conteo, m }) => filaExcel(r.mes, conteo, m)),
          ...(r.conteos.length > 1 ? [filaExcel(r.mes, null, r.total)] : []),
        ]))} />
      </div>

      {meses.map(r => (
        <div key={r.mes} className="bg-white border border-gray-100 rounded-2xl shadow-sm overflow-hidden">
          <div className="flex items-center justify-between gap-3 flex-wrap px-4 py-3 border-b border-gray-100">
            <h3 className="font-heading font-bold text-base text-gray-900">{r.etiqueta}</h3>
            <p className="font-body text-xs text-gray-500">
              {r.conteos.length} {r.conteos.length === 1 ? 'conteo' : 'conteos'} · exactitud <b className="text-gray-800">{pct(r.total.exactitud)}</b>
              {' '}· valor neto <b className={r.total.valorNeto < 0 ? 'text-red-600' : 'text-gray-800'}>{cop.format(r.total.valorNeto)}</b>
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full font-body text-sm">
              <thead className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wide">
                <tr>
                  {['Conteo', 'Origen', 'Productos', 'Unidades', 'Faltantes', 'Sobrantes', 'Cuadran', 'Valor diferencias', 'Exactitud'].map(h => (
                    <th key={h} className={`font-semibold px-3 py-2 whitespace-nowrap ${h === 'Conteo' || h === 'Origen' ? 'text-left' : 'text-right'}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {r.conteos.map(({ conteo: c, m }) => (
                  <FilaMes key={c.id} c={c} m={m} />
                ))}
                {r.conteos.length > 1 && <FilaMes c={null} m={r.total} />}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  )
}

function FilaMes({ c, m }: { c: Conteo | null; m: Metricas }) {
  const num = 'px-3 py-2 text-right tabular-nums whitespace-nowrap'
  return (
    <tr className={c ? 'hover:bg-gray-50/60' : 'bg-gray-50 font-semibold'}>
      <td className="px-3 py-2 min-w-[13rem]">
        {c ? (
          <>
            <p className="text-gray-900 leading-tight">{c.nombre}</p>
            <p className="text-xs text-gray-400">
              {fecha(c.fecha)}{c.parcial ? ` · parcial: ${fmt.format(c.items.length)} de ${fmt.format(c.alcance)} contados` : ''}
            </p>
          </>
        ) : <span className="text-gray-700">Total del mes</span>}
      </td>
      <td className="px-3 py-2">
        {c && (
          <div className="flex flex-wrap gap-1">
            <Badge cls={ORIGEN[c.fuente].cls} texto={ORIGEN[c.fuente].label} />
            {c.estado && <Badge cls={ESTADO_ARQUEO[c.estado].cls} texto={ESTADO_ARQUEO[c.estado].label} />}
          </div>
        )}
      </td>
      <td className={num}>{fmt.format(m.contados)}</td>
      <td className={num}>{fmt.format(m.unidades)}</td>
      <td className={`${num} text-red-600`} title={`${fmt.format(m.unidadesFaltantes)} unidades`}>{fmt.format(m.faltantes)}</td>
      <td className={`${num} text-blue-700`} title={`+${fmt.format(m.unidadesSobrantes)} unidades`}>{fmt.format(m.sobrantes)}</td>
      <td className={`${num} text-green-700`}>{fmt.format(m.cuadran)}</td>
      <td className={`${num} ${m.valorNeto < 0 ? 'text-red-600' : 'text-gray-800'}`}
        title={`Faltantes ${cop.format(m.valorFaltantes)} · sobrantes ${cop.format(m.valorSobrantes)}`}>{cop.format(m.valorNeto)}</td>
      <td className={`${num} font-semibold`}>{pct(m.exactitud)}</td>
    </tr>
  )
}

// ── Pestaña: comparar dos conteos cualesquiera ──────────────────────────────

type FiltroCambio = EstadoCambio | 'CAMBIOS' | 'AMBOS' | 'TODOS'

function Comparar({ conteos }: { conteos: Conteo[] }) {
  const par = parPorDefecto(conteos)
  const [idA, setIdA] = useState(par?.[0] ?? conteos[0].id)
  const [idB, setIdB] = useState(par?.[1] ?? conteos[conteos.length - 1].id)
  const [filtro, setFiltro] = useState<FiltroCambio>('CAMBIOS')
  const [busca, setBusca] = useState('')

  const A = conteos.find(c => c.id === idA)!
  const B = conteos.find(c => c.id === idB)!
  const filas = useMemo(() => compararDosConteos(A, B), [A, B])
  const r = useMemo(() => resumenCambios(filas), [filas])

  const cumple = (f: (typeof filas)[number], fl: FiltroCambio) =>
    fl === 'TODOS' ? true
      : fl === 'CAMBIOS' ? f.estado !== 'IGUAL' && f.estado !== 'SIN_COMPARAR'
      : fl === 'AMBOS' ? f.a !== null && f.b !== null
      : f.estado === fl
  const visibles = filas.filter(f => cumple(f, filtro) && coincideBusqueda(busca, f.codigo, f.nombre))

  const chips: { id: FiltroCambio; label: string; n: number }[] = [
    { id: 'CAMBIOS', label: 'Con cambios', n: filas.length - r.IGUAL - r.SIN_COMPARAR },
    { id: 'FALTANTE', label: 'Dejaron de aparecer', n: r.FALTANTE },
    { id: 'NUEVO', label: 'Nuevos', n: r.NUEVO },
    { id: 'AGOTADO', label: 'Se agotaron', n: r.AGOTADO },
    { id: 'BAJO', label: 'Bajaron', n: r.BAJO },
    { id: 'SUBIO', label: 'Subieron', n: r.SUBIO },
    { id: 'IGUAL', label: 'Iguales', n: r.IGUAL },
    { id: 'AMBOS', label: 'Contados en ambos', n: r.enAmbos },
    ...(r.SIN_COMPARAR ? [{ id: 'SIN_COMPARAR' as const, label: 'Faltan en el parcial', n: r.SIN_COMPARAR }] : []),
    { id: 'TODOS', label: 'Todos', n: filas.length },
  ]

  const nA = rotulo(A)
  const nB = rotulo(B)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <SelectorConteo label="Conteo anterior (A)" value={idA} onChange={setIdA} conteos={conteos} />
        <SelectorConteo label="Conteo actual (B)" value={idB} onChange={setIdB} conteos={conteos} />
        <button onClick={() => { setIdA(idB); setIdB(idA) }}
          className="border border-gray-200 bg-white rounded-lg px-3 py-2 font-body text-sm font-semibold text-gray-700 hover:bg-gray-50">
          Intercambiar
        </button>
      </div>

      {(A.parcial || B.parcial) && idA !== idB && (
        <p className="font-body text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2 flex items-center gap-2">
          <Info className="w-4 h-4 shrink-0" />
          {[A, B].filter(c => c.parcial).map(c => `"${c.nombre}" está en progreso (${c.items.length} de ${c.alcance} contados)`).join(' y ')}:
          solo se comparan los ítems ya contados. Usa &quot;Contados en ambos&quot; para ver solo lo que se puede comparar.
        </p>
      )}

      {idA === idB ? (
        <Vacio texto="Elige dos conteos distintos." />
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Kpi titulo="Dejaron de aparecer" valor={r.FALTANTE} nota={`contados en A y no en B`} tono="text-red-600" />
            <Kpi titulo="Nuevos" valor={r.NUEVO} nota="contados en B y no en A" tono="text-blue-600" />
            <Kpi titulo="Bajaron / subieron" valor={`${r.BAJO + r.AGOTADO} / ${r.SUBIO}`} nota={`${r.AGOTADO} se agotaron · ${r.IGUAL} iguales`} />
            <Kpi titulo="Unidades" valor={fmt.format(r.unidadesB)}
              nota={`${r.unidadesB - r.unidadesA >= 0 ? '+' : ''}${fmt.format(r.unidadesB - r.unidadesA)} vs ${fmt.format(r.unidadesA)} en A`} />
          </div>
          {(r.valorBajas !== 0 || r.valorAlzas !== 0) && (
            <p className="font-body text-xs text-gray-500">
              Valorizado a precio de lista: bajas por <b className="text-red-600">{cop.format(r.valorBajas)}</b> y alzas por{' '}
              <b className="text-green-700">{cop.format(r.valorAlzas)}</b> (solo productos con precio).
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            {chips.map(c => <Chip key={c.id} activo={filtro === c.id} onClick={() => setFiltro(c.id)} label={c.label} n={c.n} />)}
          </div>

          <div className="flex flex-wrap gap-2 items-center">
            <Buscador value={busca} onChange={setBusca} />
            <BotonExcel onClick={() => exportar(`arqueo-comparativa-${A.nombre}-vs-${B.nombre}.xlsx`, 'Comparativa', visibles.map(f => ({
              ITEM: f.codigo, PRODUCTO: f.nombre, PRESENTACION: f.presentacion ?? '',
              [`A: ${nA}`]: f.a, [`B: ${nB}`]: f.b, DIFERENCIA: f.diferencia,
              'VARIACION %': f.porcentaje === null ? null : Math.round(f.porcentaje), ESTADO: ETIQUETA_CAMBIO[f.estado],
              'DIF. VS SISTEMA A': f.difSistemaA, 'DIF. VS SISTEMA B': f.difSistemaB,
              'VALOR DIFERENCIA': f.valor === null ? null : Math.round(f.valor),
            })))} />
          </div>

          <Tabla
            cabeceras={['Ítem', 'Producto', `A · ${A.nombre}`, `B · ${B.nombre}`, 'Diferencia', 'Estado', 'Vs sistema A', 'Vs sistema B']}
            vacio="Nada que mostrar con este filtro."
            filas={visibles.map(f => ({
              key: f.clave,
              celdas: [
                <span key="c" className="text-gray-500">{f.codigo ?? '—'}</span>,
                <Nombre key="n" nombre={f.nombre} presentacion={f.presentacion} />,
                <span key="a" className="tabular-nums">{f.a === null ? <i className="text-gray-400">no contado</i> : q(f.a)}</span>,
                <span key="b" className="tabular-nums">{f.b === null ? <i className="text-gray-400">no contado</i> : q(f.b)}</span>,
                <Delta key="d" valor={f.diferencia} porcentaje={f.porcentaje} />,
                <Badge key="e" cls={CLS_CAMBIO[f.estado]} texto={ETIQUETA_CAMBIO[f.estado]} />,
                <Delta key="sa" valor={f.difSistemaA} tenue />,
                <Delta key="sb" valor={f.difSistemaB} tenue />,
              ],
            }))}
          />
        </>
      )}
    </div>
  )
}

function SelectorConteo({ label, value, onChange, conteos }: {
  label: string; value: string; onChange: (v: string) => void; conteos: Conteo[]
}) {
  return (
    <label className="font-body text-sm text-gray-600 flex flex-col gap-1">
      {label}
      <select value={value} onChange={e => onChange(e.target.value)}
        className="border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900 bg-white min-w-[16rem] max-w-full">
        {[...conteos].reverse().map(c => (
          <option key={c.id} value={c.id}>
            {fecha(c.fecha)} · {c.nombre} · {ORIGEN[c.fuente].label}{c.parcial ? ' (parcial)' : ''} · {c.items.length} contados
          </option>
        ))}
      </select>
    </label>
  )
}

// ── Pestaña: matriz producto × conteo ───────────────────────────────────────

type FiltroMatriz = 'RECURRENTES' | 'ALGUNA' | 'TODOS_CONTEOS' | 'TODOS'

function Matriz({ conteos }: { conteos: Conteo[] }) {
  const [filtro, setFiltro] = useState<FiltroMatriz>('RECURRENTES')
  const [busca, setBusca] = useState('')
  const filas = useMemo(() => matrizConteos(conteos), [conteos])

  const cumple = (f: (typeof filas)[number], fl: FiltroMatriz) =>
    fl === 'RECURRENTES' ? f.conDiferencia >= 2
      : fl === 'ALGUNA' ? f.conDiferencia >= 1
      : fl === 'TODOS_CONTEOS' ? f.veces === conteos.length
      : true
  const visibles = filas.filter(f => cumple(f, filtro) && coincideBusqueda(busca, f.codigo, f.nombre))

  const chips: { id: FiltroMatriz; label: string }[] = [
    { id: 'RECURRENTES', label: 'Con diferencia en 2 o más conteos' },
    { id: 'ALGUNA', label: 'Con diferencia en algún conteo' },
    { id: 'TODOS_CONTEOS', label: 'Contados en todos' },
    { id: 'TODOS', label: 'Todos' },
  ]

  if (!conteos.length) return <Vacio texto="No hay conteos con este filtro." />

  return (
    <div className="space-y-4">
      <p className="font-body text-xs text-gray-500">
        Cada celda es la diferencia contra el sistema (contado − sistema) en ese conteo. Rojo = faltante, azul = sobrante,
        ✓ = cuadra, vacío = no se contó. Pasa el cursor por una celda para ver contado y sistema.
      </p>
      <div className="flex flex-wrap gap-2">
        {chips.map(c => <Chip key={c.id} activo={filtro === c.id} onClick={() => setFiltro(c.id)} label={c.label}
          n={filas.filter(f => cumple(f, c.id)).length} />)}
      </div>
      <div className="flex flex-wrap gap-2 items-center">
        <Buscador value={busca} onChange={setBusca} />
        <BotonExcel onClick={() => exportar('arqueo-matriz-conteos.xlsx', 'Matriz de conteos', visibles.map(f => ({
          ITEM: f.codigo, PRODUCTO: f.nombre, PRESENTACION: f.presentacion ?? '',
          ...Object.fromEntries(conteos.flatMap(c => {
            const cel = f.celdas[c.id]
            const base = `${fecha(c.fecha)} ${rotulo(c)}`
            return [
              [`${base} CONTADO`, cel ? cel.contado : null],
              [`${base} DIF`, cel ? cel.diferencia : null],
            ]
          })),
          'CONTEOS CON DIFERENCIA': f.conDiferencia, 'VECES CONTADO': f.veces, 'DIFERENCIA ACUMULADA': f.acumulado,
        })))} />
      </div>

      <Tabla
        cabeceras={['Ítem', 'Producto', ...conteos.map(c => `${c.nombre}\n${fecha(c.fecha)} · ${c.fuente === 'CARGUE' ? 'cargue' : 'plataforma'}`), 'Con dif.', 'Acumulado']}
        vacio="Nada que mostrar con este filtro."
        filas={visibles.map(f => ({
          key: f.clave,
          celdas: [
            <span key="c" className="text-gray-500">{f.codigo ?? '—'}</span>,
            <Nombre key="n" nombre={f.nombre} presentacion={f.presentacion} />,
            ...conteos.map(c => <CeldaDif key={c.id} cel={f.celdas[c.id]} />),
            <span key="v" className={`tabular-nums font-semibold ${f.conDiferencia >= 2 ? 'text-red-600' : 'text-gray-500'}`}>
              {f.conDiferencia} / {f.veces}
            </span>,
            <Delta key="t" valor={f.acumulado} />,
          ],
        }))}
      />
    </div>
  )
}

function CeldaDif({ cel }: { cel: { contado: number; sistema: number | null; diferencia: number | null } | undefined }) {
  if (!cel) return <span className="text-gray-200">·</span>
  const t = `Contado ${q(cel.contado)} · sistema ${q(cel.sistema)}`
  if (cel.diferencia === null) return <span title={t} className="text-gray-400 text-xs">sin sistema</span>
  if (cel.diferencia === 0) return <span title={t} className="text-green-600">✓</span>
  return (
    <span title={t} className={`inline-block tabular-nums font-semibold px-1.5 rounded ${cel.diferencia < 0 ? 'bg-red-50 text-red-700' : 'bg-blue-50 text-blue-700'}`}>
      {cel.diferencia > 0 ? '+' : ''}{fmt.format(cel.diferencia)}
    </span>
  )
}

// ── Piezas comunes ──────────────────────────────────────────────────────────

function Chip({ activo, onClick, label, n }: { activo: boolean; onClick: () => void; label: string; n?: number }) {
  return (
    <button onClick={onClick}
      className={`font-body text-xs font-semibold px-3 py-1.5 rounded-full border transition-colors ${
        activo ? 'bg-brand-green text-white border-brand-green' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'}`}>
      {label}{n !== undefined && <span className="opacity-70"> {fmt.format(n)}</span>}
    </button>
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

function BotonExcel({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick}
      className="flex items-center gap-1.5 border border-gray-200 bg-white rounded-lg px-3 py-2 font-body text-sm font-semibold text-gray-700 hover:bg-gray-50">
      <Download className="w-4 h-4" /> Excel
    </button>
  )
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

function Delta({ valor, porcentaje, tenue }: { valor: number | null; porcentaje?: number | null; tenue?: boolean }) {
  if (valor === null) return <span className="text-gray-300">—</span>
  const cls = valor < 0 ? 'text-red-600' : valor > 0 ? 'text-green-700' : 'text-gray-400'
  return (
    <span className={`tabular-nums whitespace-nowrap ${tenue ? 'text-xs' : 'font-semibold'} ${cls}`}>
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

function Vacio({ texto }: { texto: string }) {
  return <div className="bg-white border border-gray-100 rounded-2xl p-8 text-center font-body text-sm text-gray-400">{texto}</div>
}

const PAGINA = 200

function Tabla({ cabeceras, filas, vacio }: {
  cabeceras: string[]
  filas: { key: string; celdas: React.ReactNode[] }[]
  vacio: string
}) {
  const [limite, setLimite] = useState(PAGINA)
  if (!filas.length) return <Vacio texto={vacio} />
  return (
    <div className="bg-white border border-gray-100 rounded-2xl shadow-sm overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full font-body text-sm">
          <thead className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wide">
            <tr>{cabeceras.map((c, i) => <th key={i} className="text-left font-semibold px-3 py-2 whitespace-pre-line align-bottom">{c}</th>)}</tr>
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
        <span>{fmt.format(Math.min(limite, filas.length))} de {fmt.format(filas.length)}</span>
        {limite < filas.length && (
          <button onClick={() => setLimite(l => l + PAGINA)} className="text-brand-green font-semibold hover:underline">Ver más</button>
        )}
      </div>
    </div>
  )
}

'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import {
  ArrowLeft, Download, Search, FileSpreadsheet, Repeat, Info, Loader2, Scale, GitCompareArrows,
} from 'lucide-react'
import {
  ETIQUETA_COMPARACION, ETIQUETA_SISTEMA,
  type InventarioFisico, type ItemFisico, type EstadoComparacion, type EstadoSistema,
} from '@/lib/inventario-fisico'
import { informeCargue, type CeldaConteo, type FilaInforme } from '@/lib/inventario-fisico-informe'
import { ordenarAlfabetico, ordenarPorItem } from '@/lib/reportes/orden'
import { descargarInformeCargue } from '@/lib/reportes/informe-inventario-fisico'

const fmt = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 2 })
const cop = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 })
const fecha = (d: string) => new Date(d + 'T12:00:00-05:00').toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'America/Bogota' })
const signo = (v: number) => `${v > 0 ? '+' : ''}${fmt.format(v)}`

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

type Filtro =
  | 'TODOS' | 'CAMBIOS' | 'RECURRENTES'
  | `ANT_${EstadoComparacion}`
  | `SIS_${EstadoSistema}` | 'SIS_DIFERENCIAS'
type Orden = 'ITEM' | 'ALFABETICO'

const plano = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
const coincide = (busca: string, f: FilaInforme) => {
  const b = plano(busca.trim())
  return !b || String(f.codigo ?? '').startsWith(b) || plano(f.nombre).includes(b)
}

function cumple(f: FilaInforme, fl: Filtro): boolean {
  if (fl === 'TODOS') return true
  if (fl === 'CAMBIOS') return (f.estadoAnterior !== null && f.estadoAnterior !== 'IGUAL')
    || f.estadoSistema === 'FALTANTE' || f.estadoSistema === 'SOBRANTE'
  if (fl === 'RECURRENTES') return f.recurrente
  if (fl === 'SIS_DIFERENCIAS') return f.estadoSistema === 'FALTANTE' || f.estadoSistema === 'SOBRANTE'
  if (fl.startsWith('ANT_')) return f.estadoAnterior === fl.slice(4)
  return f.estadoSistema === fl.slice(4)
}

export function InformeCargueClient({ inventarios, items, id }: {
  inventarios: InventarioFisico[]
  items: ItemFisico[]
  id: string
}) {
  const inf = useMemo(() => informeCargue(inventarios, items, id), [inventarios, items, id])
  const [filtro, setFiltro] = useState<Filtro>('CAMBIOS')
  const [busca, setBusca] = useState('')
  const [orden, setOrden] = useState<Orden>('ITEM')
  const [descargando, setDescargando] = useState(false)
  const [errorExcel, setErrorExcel] = useState<string | null>(null)

  if (!inf) {
    return <div className="p-4 sm:p-6 font-body text-sm text-gray-500">No se encontró el conteo.</div>
  }

  const { actual, anteriores, anteriorInmediato: ant, vsAnterior: va, vsSistema: vs } = inf
  const columnas = [...anteriores, actual]
  const n = (fl: Filtro) => inf.filas.filter(f => cumple(f, fl)).length
  const filtradas = inf.filas.filter(f => cumple(f, filtro) && coincide(busca, f))
  const visibles = orden === 'ITEM'
    ? ordenarPorItem(filtradas, f => f.codigo, f => f.nombre)
    : ordenarAlfabetico(filtradas, f => f.nombre, f => f.presentacion)
  const recurrentes = inf.filas.filter(f => f.recurrente)

  async function descargar() {
    setDescargando(true)
    setErrorExcel(null)
    try {
      await descargarInformeCargue(inf!)
    } catch (e) {
      setErrorExcel(e instanceof Error ? e.message : String(e))
    } finally {
      setDescargando(false)
    }
  }

  const chipsAnterior: { id: Filtro; label: string }[] = ant ? [
    { id: 'ANT_FALTANTE', label: 'Dejaron de venir' },
    { id: 'ANT_NUEVO', label: 'Nuevos' },
    { id: 'ANT_AGOTADO', label: 'Se agotaron' },
    { id: 'ANT_BAJO', label: 'Bajaron' },
    { id: 'ANT_SUBIO', label: 'Subieron' },
    { id: 'ANT_REPUESTO', label: 'Repuestos' },
    { id: 'ANT_IGUAL', label: 'Sin cambio' },
    { id: 'ANT_SIN_DATO', label: 'Sin dato' },
  ] : []
  const chipsSistema: { id: Filtro; label: string }[] = [
    { id: 'SIS_DIFERENCIAS', label: 'Con diferencia' },
    { id: 'SIS_FALTANTE', label: 'Faltantes físicos' },
    { id: 'SIS_SOBRANTE', label: 'Sobrantes' },
    { id: 'SIS_NO_HALLADO', label: 'No hallados' },
    { id: 'SIS_SIN_CANTIDAD', label: 'Sin cantidad' },
    ...(vs.sinSistema ? [{ id: 'SIS_SIN_SISTEMA' as const, label: 'Sin dato del sistema' }] : []),
    { id: 'SIS_CUADRA', label: 'Cuadran' },
  ]

  return (
    <div className="p-4 sm:p-6 space-y-5">
      {/* ── Encabezado ── */}
      <div className="space-y-3">
        <Link href="/inventario-fisico" className="inline-flex items-center gap-1.5 font-body text-sm text-gray-500 hover:text-brand-green">
          <ArrowLeft className="w-4 h-4" /> Inventario físico
        </Link>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <p className="font-body text-xs font-semibold uppercase tracking-wide text-brand-green">Informe del cargue</p>
            <h1 className="font-heading font-bold text-2xl text-gray-900 flex items-center gap-2 flex-wrap">
              {actual.periodo}
              {actual.historico && (
                <span className="font-body text-[11px] font-semibold px-2 py-0.5 rounded-full bg-gray-100 text-gray-500"
                  title="Foto reconstruida después de aplicar el cruce">Histórico</span>
              )}
            </h1>
            <p className="font-body text-sm text-gray-500 mt-0.5 flex items-center gap-1.5 flex-wrap">
              Corte {fecha(actual.fecha_corte)}
              {actual.archivo_nombre && <><span>·</span><FileSpreadsheet className="w-4 h-4 text-gray-400" /> <span className="break-all">{actual.archivo_nombre}</span></>}
            </p>
            {actual.observacion && <p className="font-body text-xs text-gray-400 mt-1">{actual.observacion}</p>}
          </div>
          <button onClick={descargar} disabled={descargando}
            className="flex items-center gap-2 bg-brand-green text-white font-body font-semibold text-sm px-4 py-2 rounded-lg hover:bg-brand-green-dark transition-colors shadow-sm disabled:opacity-60">
            {descargando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />} Descargar informe
          </button>
        </div>
        {errorExcel && <p className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2 font-body text-sm">{errorExcel}</p>}

        <div className="bg-white border border-gray-100 rounded-2xl p-4 shadow-sm">
          <dl className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-x-4 gap-y-3 font-body text-sm">
            <Dato k="En el archivo" v={fmt.format(actual.total_items)} />
            <Dato k="Con cantidad" v={fmt.format(actual.items_con_cantidad)} />
            <Dato k="En cero" v={fmt.format(actual.items_en_cero)} tono="text-orange-600" />
            <Dato k="Celda vacía" v={fmt.format(actual.total_items - actual.items_con_cantidad)} />
            <Dato k="Unidades" v={fmt.format(actual.total_unidades)} />
            <Dato k="Stock ajustado" v={fmt.format(actual.items_ajustados)} />
            <Dato k="Productos nuevos" v={fmt.format(actual.items_nuevos)} />
            <Dato k="No hallados" v={fmt.format(actual.items_no_hallados)} tono="text-red-600" />
          </dl>
        </div>

        <p className="font-body text-xs text-gray-500 flex items-start gap-1.5">
          <Info className="w-4 h-4 shrink-0 text-gray-400" />
          <span>
            {anteriores.length === 0
              ? 'Es el primer conteo cargado: no hay conteos anteriores para comparar, así que el informe muestra solo el conteo frente al sistema.'
              : <>Se compara contra {anteriores.length === 1 ? 'el conteo anterior' : `los ${anteriores.length} conteos anteriores`} por fecha de corte: {anteriores.map(a => a.periodo).join(', ')}.</>}
            {inf.posteriores.length > 0 && <> Hay {inf.posteriores.length} conteo(s) posterior(es) que no entran en este informe.</>}
          </span>
        </p>
        {inventarios.length > 1 && (
          <div className="flex gap-2 overflow-x-auto pb-1">
            {[...inventarios].reverse().map(i => (
              <Link key={i.id} href={`/inventario-fisico/${i.id}`}
                className={`shrink-0 font-body text-xs font-semibold px-3 py-1.5 rounded-full border transition-colors ${
                  i.id === actual.id ? 'bg-brand-green text-white border-brand-green' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'}`}>
                {i.periodo}
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* ── KPIs ── */}
      {ant && va && (
        <section className="space-y-2">
          <h2 className="font-heading font-bold text-base text-gray-900 flex items-center gap-2">
            <GitCompareArrows className="w-4 h-4 text-brand-green" /> Contra {ant.periodo} <span className="font-body font-normal text-xs text-gray-400">corte {fecha(ant.fecha_corte)}</span>
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Kpi titulo="Dejaron de venir" valor={va.faltantes} nota={`estaban en ${ant.periodo} y no vinieron`} tono="text-red-600" />
            <Kpi titulo="Nuevos" valor={va.nuevos} nota={`no estaban en ${ant.periodo}`} tono="text-blue-600" />
            <Kpi titulo="Se agotaron" valor={va.agotados} nota={`${va.repuestos} repuestos desde cero`} tono="text-orange-600" />
            <Kpi titulo="Bajaron / subieron" valor={`${fmt.format(va.bajaron)} / ${fmt.format(va.subieron)}`} nota={`${va.iguales} sin cambio · ${va.sinDato} sin dato`} />
            <Kpi titulo="Unidades" valor={fmt.format(va.unidadesActual)}
              nota={`${signo(va.unidadesActual - va.unidadesAnterior)} vs ${fmt.format(va.unidadesAnterior)}`} />
            <Kpi titulo="Valor de las bajas" valor={cop.format(va.valorPerdido)} nota="a precio de lista" tono="text-red-600" />
            <Kpi titulo="Valor de las alzas" valor={cop.format(va.valorGanado)} nota="a precio de lista" tono="text-green-700" />
            <Kpi titulo="Diferencias recurrentes" valor={inf.recurrentes} nota="también tuvieron diferencia antes" tono="text-red-600" />
          </div>
        </section>
      )}

      <section className="space-y-2">
        <h2 className="font-heading font-bold text-base text-gray-900 flex items-center gap-2">
          <Scale className="w-4 h-4 text-brand-green" /> Contra el sistema
          <span className="font-body font-normal text-xs text-gray-400">stock justo antes de aplicar el conteo</span>
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Kpi titulo="Faltantes físicos" valor={vs.faltantes} nota={`${fmt.format(vs.unidadesFaltantes)} unidades · ${cop.format(vs.valorFaltantes)}`} tono="text-red-600" />
          <Kpi titulo="Sobrantes" valor={vs.sobrantes} nota={`${signo(vs.unidadesSobrantes)} unidades · ${cop.format(vs.valorSobrantes)}`} tono="text-blue-600" />
          <Kpi titulo="No hallados" valor={vs.noHallados} nota={`${fmt.format(vs.unidadesNoHallados)} unidades en el sistema · ${cop.format(vs.valorNoHallados)}`} tono="text-orange-600" />
          <Kpi titulo="Cuadran" valor={vs.cuadran}
            nota={`${vs.exactitud === null ? '—' : `${fmt.format(Math.round(vs.exactitud * 10) / 10)}%`} de exactitud · ${vs.sinCantidad} sin cantidad`} tono="text-green-700" />
        </div>
      </section>

      {/* ── Recurrentes ── */}
      {anteriores.length > 0 && (
        <section className="bg-white border border-gray-100 rounded-2xl shadow-sm overflow-hidden">
          <div className="flex items-center justify-between gap-3 flex-wrap px-4 py-3 border-b border-gray-100">
            <h2 className="font-heading font-bold text-base text-gray-900 flex items-center gap-2">
              <Repeat className="w-4 h-4 text-red-500" /> Diferencias recurrentes
            </h2>
            <p className="font-body text-xs text-gray-500">Diferencia contra el sistema en este conteo y en algún conteo anterior</p>
          </div>
          {recurrentes.length === 0 ? (
            <p className="px-4 py-6 text-center font-body text-sm text-gray-400">Ningún producto repite diferencia contra el sistema.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full font-body text-sm">
                <thead className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wide">
                  <tr>
                    <th className="text-left font-semibold px-3 py-2">Ítem</th>
                    <th className="text-left font-semibold px-3 py-2">Producto</th>
                    {columnas.map(c => <th key={c.id} className="text-right font-semibold px-3 py-2 whitespace-nowrap">Dif. {c.periodo}</th>)}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {recurrentes.map(f => (
                    <tr key={f.clave}>
                      <td className="px-3 py-2 text-gray-500">{f.codigo ?? '—'}</td>
                      <td className="px-3 py-2"><Nombre nombre={f.nombre} presentacion={f.presentacion} /></td>
                      {columnas.map(c => <td key={c.id} className="px-3 py-2 text-right"><Delta valor={f.celdas[c.id]?.difSistema ?? null} /></td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {/* ── Comparativo por producto ── */}
      <section className="space-y-3">
        <h2 className="font-heading font-bold text-base text-gray-900">Comparativo por producto</h2>
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2">
            <Chip activo={filtro === 'CAMBIOS'} onClick={() => setFiltro('CAMBIOS')} label="Con cambios" n={n('CAMBIOS')} />
            {anteriores.length > 0 && <Chip activo={filtro === 'RECURRENTES'} onClick={() => setFiltro('RECURRENTES')} label="Recurrentes" n={inf.recurrentes} />}
            <Chip activo={filtro === 'TODOS'} onClick={() => setFiltro('TODOS')} label="Todos" n={inf.filas.length} />
          </div>
          {chipsAnterior.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-body text-xs text-gray-400 w-20 shrink-0">Vs anterior</span>
              {chipsAnterior.map(c => <Chip key={c.id} activo={filtro === c.id} onClick={() => setFiltro(c.id)} label={c.label} n={n(c.id)} />)}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-body text-xs text-gray-400 w-20 shrink-0">Vs sistema</span>
            {chipsSistema.map(c => <Chip key={c.id} activo={filtro === c.id} onClick={() => setFiltro(c.id)} label={c.label} n={n(c.id)} />)}
          </div>
        </div>

        <div className="flex flex-wrap gap-2 items-center">
          <div className="relative flex-1 min-w-[12rem]">
            <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar por ítem o nombre…"
              className="w-full border border-gray-200 rounded-lg pl-9 pr-3 py-2 font-body text-sm" />
          </div>
          <div className="flex rounded-lg border border-gray-200 overflow-hidden font-body text-sm" role="group" aria-label="Orden">
            {([['ITEM', 'Por ítem'], ['ALFABETICO', 'Alfabético']] as const).map(([o, label]) => (
              <button key={o} onClick={() => setOrden(o)}
                className={`px-3 py-2 font-semibold ${orden === o ? 'bg-brand-green text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>
                {label}
              </button>
            ))}
          </div>
        </div>

        <TablaInforme filas={visibles} columnas={columnas} actualId={actual.id} conAnterior={!!ant} />
        <p className="font-body text-[11px] text-gray-400">
          &quot;sin cantidad&quot; = vino en el archivo con la celda vacía (no se toma como 0) · &quot;no vino&quot; = activo del catálogo que no vino en el archivo ·
          &quot;·&quot; = no figuraba en ese conteo. Un producto que dejó de venir cuenta como 0 en las diferencias.
        </p>
      </section>
    </div>
  )
}

// ── Tabla principal ─────────────────────────────────────────────────────────

const PAGINA = 200

function TablaInforme({ filas, columnas, actualId, conAnterior }: {
  filas: FilaInforme[]
  columnas: InventarioFisico[]
  actualId: string
  conAnterior: boolean
}) {
  const [limite, setLimite] = useState(PAGINA)
  if (!filas.length) {
    return <div className="bg-white border border-gray-100 rounded-2xl p-8 text-center font-body text-sm text-gray-400">Nada que mostrar con este filtro.</div>
  }
  const th = 'font-semibold px-3 py-2 whitespace-nowrap align-bottom'
  return (
    <div className="bg-white border border-gray-100 rounded-2xl shadow-sm overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full font-body text-sm">
          <thead className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wide">
            <tr>
              <th className={`${th} text-left`}>Ítem</th>
              <th className={`${th} text-left`}>Producto</th>
              {columnas.map(c => (
                <th key={c.id} className={`${th} text-right ${c.id === actualId ? 'text-brand-green' : ''}`}>
                  {c.periodo}<br /><span className="font-normal normal-case">{fecha(c.fecha_corte)}</span>
                </th>
              ))}
              {conAnterior && <th className={`${th} text-right`}>Dif. vs<br />anterior</th>}
              {conAnterior && <th className={`${th} text-right`}>Dif. vs<br />promedio</th>}
              <th className={`${th} text-right`}>Sistema</th>
              <th className={`${th} text-right`}>Dif. vs<br />sistema</th>
              <th className={`${th} text-left`}>Estado</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {filas.slice(0, limite).map(f => (
              <tr key={f.clave} className="hover:bg-gray-50/60">
                <td className="px-3 py-2 align-top text-gray-500">{f.codigo ?? '—'}</td>
                <td className="px-3 py-2 align-top">
                  <Nombre nombre={f.nombre} presentacion={f.presentacion} />
                  {f.recurrente && (
                    <span className="inline-flex items-center gap-1 mt-0.5 font-body text-[11px] text-red-600" title={`Con diferencia contra el sistema en ${f.difSistemaAntes} conteo(s) anterior(es)`}>
                      <Repeat className="w-3 h-3" /> recurrente
                    </span>
                  )}
                </td>
                {columnas.map(c => (
                  <td key={c.id} className={`px-3 py-2 align-top text-right ${c.id === actualId ? 'bg-brand-green-bg/40 font-semibold' : ''}`}>
                    <Celda c={f.celdas[c.id]} />
                  </td>
                ))}
                {conAnterior && <td className="px-3 py-2 align-top text-right"><Delta valor={f.difAnterior} /></td>}
                {conAnterior && (
                  <td className="px-3 py-2 align-top text-right"
                    title={f.promedioAnteriores === null ? 'Sin cantidades anteriores' : `Promedio de ${f.vecesContadoAntes} conteo(s): ${fmt.format(f.promedioAnteriores)}`}>
                    <Delta valor={f.difPromedio === null ? null : Math.round(f.difPromedio * 100) / 100} tenue />
                  </td>
                )}
                <td className="px-3 py-2 align-top text-right tabular-nums text-gray-600">{f.stockSistema === null ? <span className="text-gray-300">—</span> : fmt.format(f.stockSistema)}</td>
                <td className="px-3 py-2 align-top text-right"><Delta valor={f.difSistema} /></td>
                <td className="px-3 py-2 align-top">
                  <div className="flex flex-col items-start gap-1">
                    {f.estadoAnterior && <Badge cls={CLS_COMPARACION[f.estadoAnterior]} texto={ETIQUETA_COMPARACION[f.estadoAnterior]} />}
                    {f.estadoSistema
                      ? <Badge cls={CLS_SISTEMA[f.estadoSistema]} texto={ETIQUETA_SISTEMA[f.estadoSistema]} />
                      : <Badge cls="bg-gray-50 text-gray-400" texto="No figura en este conteo" />}
                  </div>
                </td>
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

// ── Piezas ──────────────────────────────────────────────────────────────────

function Celda({ c }: { c: CeldaConteo | undefined }) {
  if (!c || c.estado === 'AUSENTE') return <span className="text-gray-300" title="No figuraba en ese conteo">·</span>
  if (c.estado === 'NO_HALLADO') return <i className="text-red-400 font-normal whitespace-nowrap">no vino</i>
  if (c.estado === 'SIN_CANTIDAD' || c.cantidad === null) return <i className="text-gray-400 font-normal whitespace-nowrap" title="Celda vacía en el archivo">sin cantidad</i>
  return <span className="tabular-nums">{fmt.format(c.cantidad)}</span>
}

function Dato({ k, v, tono = 'text-gray-900' }: { k: string; v: string; tono?: string }) {
  return (
    <div>
      <dt className="text-xs text-gray-500">{k}</dt>
      <dd className={`font-semibold ${tono}`}>{v}</dd>
    </div>
  )
}

function Kpi({ titulo, valor, nota, tono = 'text-gray-900' }: { titulo: string; valor: number | string; nota?: string; tono?: string }) {
  return (
    <div className="bg-white border border-gray-100 rounded-2xl p-4 shadow-sm min-w-0">
      <p className="font-body text-xs text-gray-500">{titulo}</p>
      <p className={`font-heading font-bold text-xl sm:text-2xl break-words ${tono}`}>{typeof valor === 'number' ? fmt.format(valor) : valor}</p>
      {nota && <p className="font-body text-[11px] text-gray-400 mt-0.5">{nota}</p>}
    </div>
  )
}

function Chip({ activo, onClick, label, n }: { activo: boolean; onClick: () => void; label: string; n: number }) {
  return (
    <button onClick={onClick}
      className={`font-body text-xs font-semibold px-3 py-1.5 rounded-full border transition-colors ${
        activo ? 'bg-brand-green text-white border-brand-green' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'}`}>
      {label} <span className="opacity-70">{fmt.format(n)}</span>
    </button>
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

function Delta({ valor, tenue }: { valor: number | null; tenue?: boolean }) {
  if (valor === null) return <span className="text-gray-300">—</span>
  const cls = valor < 0 ? 'text-red-600' : valor > 0 ? 'text-green-700' : 'text-gray-400'
  return <span className={`tabular-nums whitespace-nowrap ${tenue ? 'text-xs' : 'font-semibold'} ${cls}`}>{signo(valor)}</span>
}

function Badge({ cls, texto }: { cls: string; texto: string }) {
  return <span className={`inline-block font-body text-[11px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${cls}`}>{texto}</span>
}

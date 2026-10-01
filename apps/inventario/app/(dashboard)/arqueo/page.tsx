import type { Metadata } from 'next'
import Link from 'next/link'
import { ClipboardCheck, CheckCircle2, Clock, Ban, Monitor, FileSpreadsheet, BarChart3, ArrowRight } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { requirePermiso } from '@/lib/permisos-server'
import { etiquetaMes, instante, mesDe } from '@/lib/arqueo-analisis'
import { ArqueoTabs } from './ArqueoTabs'

export const metadata: Metadata = { title: 'Arqueo de inventario' }
export const revalidate = 0

interface ArqueoRow {
  id: string
  nombre: string
  descripcion: string | null
  estado: 'ABIERTO' | 'CERRADO' | 'ANULADO'
  total_items: number
  items_contados: number
  items_con_diferencia: number
  valor_diferencia: number | string | null
  created_at: string
  cerrado_at: string | null
}

interface CargueRow {
  id: string
  periodo: string
  fecha_corte: string
  archivo_nombre: string | null
  historico: boolean
  total_items: number
  items_con_cantidad: number
  total_unidades: number | string
  items_ajustados: number
  items_no_hallados: number
}

type Tarjeta =
  | { tipo: 'PLATAFORMA'; fecha: string; a: ArqueoRow; contados: number }
  | { tipo: 'CARGUE'; fecha: string; c: CargueRow }

const cop = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 })
const num = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 2 })

const ESTADO = {
  ABIERTO: { label: 'En progreso', cls: 'bg-blue-100 text-blue-700', icon: Clock },
  CERRADO: { label: 'Cerrado', cls: 'bg-green-100 text-green-700', icon: CheckCircle2 },
  ANULADO: { label: 'Anulado', cls: 'bg-gray-100 text-gray-500', icon: Ban },
}

function fechaCorta(f: string) {
  const d = /^\d{4}-\d{2}-\d{2}$/.test(f) ? new Date(f + 'T12:00:00-05:00') : new Date(f)
  return d.toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'America/Bogota' })
}

export default async function ArqueoPage() {
  const permisos = await requirePermiso('ver_arqueo')
  const verCargues = permisos.puede('ver_inventario_fisico') || permisos.puede('cargar_inventario_fisico')
  const supabase = await createClient()

  const [{ data }, { data: cargues }] = await Promise.all([
    supabase
      .from('arqueos')
      .select('id, nombre, descripcion, estado, total_items, items_contados, items_con_diferencia, valor_diferencia, created_at, cerrado_at')
      .order('created_at', { ascending: false })
      .limit(100),
    verCargues
      ? supabase
          .from('inventarios_fisicos' as never)
          .select('id, periodo, fecha_corte, archivo_nombre, historico, total_items, items_con_cantidad, total_unidades, items_ajustados, items_no_hallados')
          .order('fecha_corte', { ascending: false })
      : Promise.resolve({ data: [] }),
  ])

  const arqueos = (data as unknown as ArqueoRow[]) ?? []

  // `items_contados` solo se actualiza al cerrar: para los abiertos se cuenta en vivo
  const contadosVivos = new Map<string, number>()
  await Promise.all(arqueos.filter(a => a.estado === 'ABIERTO').map(async a => {
    const { count } = await supabase.from('arqueo_items')
      .select('id', { count: 'exact', head: true })
      .eq('arqueo_id', a.id).neq('estado', 'PENDIENTE')
    contadosVivos.set(a.id, count ?? 0)
  }))

  const tarjetas: Tarjeta[] = [
    ...arqueos.map(a => ({ tipo: 'PLATAFORMA' as const, fecha: a.created_at, a, contados: contadosVivos.get(a.id) ?? a.items_contados })),
    ...((cargues as unknown as CargueRow[]) ?? []).map(c => ({ tipo: 'CARGUE' as const, fecha: c.fecha_corte, c })),
  ].sort((x, y) => instante(y.fecha) - instante(x.fecha))

  const porMes = new Map<string, Tarjeta[]>()
  for (const t of tarjetas) {
    const m = mesDe(t.fecha)
    const l = porMes.get(m)
    if (l) l.push(t)
    else porMes.set(m, [t])
  }

  return (
    <div className="p-4 sm:p-6 space-y-5">
      <ArqueoTabs activa="conteos" puedeCrear={permisos.puede('realizar_arqueo')} />

      {tarjetas.length >= 2 && (
        <Link href="/arqueo/analisis"
          className="flex items-center justify-between gap-3 bg-brand-green-bg border border-brand-green/20 rounded-2xl px-4 py-3 hover:border-brand-green/40 transition-colors">
          <span className="flex items-center gap-3">
            <BarChart3 className="w-5 h-5 text-brand-green shrink-0" />
            <span className="font-body text-sm text-gray-700">
              <b className="text-gray-900">Análisis entre meses:</b> compara los {tarjetas.length} conteos (plataforma y cargue masivo), exactitud, faltantes y productos con diferencias recurrentes.
            </span>
          </span>
          <ArrowRight className="w-4 h-4 text-brand-green shrink-0" />
        </Link>
      )}

      {tarjetas.length === 0 ? (
        <div className="bg-white border border-gray-100 rounded-2xl p-12 text-center text-gray-400">
          <ClipboardCheck className="w-10 h-10 mx-auto mb-3 text-gray-300" />
          <p className="font-heading font-bold text-lg text-gray-600">Aún no hay arqueos</p>
          <p className="font-body text-sm mt-1">Inicia el primer conteo físico de inventario.</p>
          <Link href="/arqueo/nuevo" className="inline-block mt-4 text-brand-green font-body font-semibold text-sm hover:underline">Nuevo arqueo →</Link>
        </div>
      ) : (
        [...porMes.entries()].map(([mes, lista]) => (
          <section key={mes} className="space-y-3">
            <h2 className="font-heading font-bold text-sm text-gray-500 uppercase tracking-wide">{etiquetaMes(mes)}</h2>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {lista.map(t => t.tipo === 'PLATAFORMA'
                ? <TarjetaArqueo key={t.a.id} a={t.a} contados={t.contados} />
                : <TarjetaCargue key={t.c.id} c={t.c} />)}
            </div>
          </section>
        ))
      )}
    </div>
  )
}

function Origen({ tipo }: { tipo: 'PLATAFORMA' | 'CARGUE' }) {
  return tipo === 'PLATAFORMA' ? (
    <span className="inline-flex items-center gap-1 font-body text-[11px] font-semibold px-2 py-0.5 rounded-full bg-brand-green-bg text-brand-green">
      <Monitor className="w-3 h-3" /> Plataforma
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 font-body text-[11px] font-semibold px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700">
      <FileSpreadsheet className="w-3 h-3" /> Cargue masivo
    </span>
  )
}

function TarjetaArqueo({ a, contados }: { a: ArqueoRow; contados: number }) {
  const e = ESTADO[a.estado]
  const Icon = e.icon
  const progreso = a.total_items > 0 ? Math.round((contados / a.total_items) * 100) : 0
  const valor = Number(a.valor_diferencia ?? 0)
  return (
    <Link href={`/arqueo/${a.id}`}
      className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm hover:shadow-md hover:border-brand-green/30 transition-all">
      <div className="flex items-start justify-between gap-2 mb-1">
        <h3 className="font-heading font-bold text-base text-gray-900 line-clamp-1">{a.nombre}</h3>
        <span className={`inline-flex items-center gap-1 font-body text-xs font-semibold px-2 py-0.5 rounded-full shrink-0 ${e.cls}`}>
          <Icon className="w-3 h-3" /> {e.label}
        </span>
      </div>
      <div className="mb-2"><Origen tipo="PLATAFORMA" /></div>
      {a.descripcion && <p className="font-body text-xs text-gray-400 line-clamp-1 mb-3">{a.descripcion}</p>}

      {a.estado === 'ABIERTO' ? (
        <>
          <div className="flex justify-between font-body text-xs text-gray-500 mb-1">
            <span>{num.format(contados)} de {num.format(a.total_items)} contados</span><span>{progreso}%</span>
          </div>
          <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
            <div className="h-full bg-brand-green rounded-full" style={{ width: `${progreso}%` }} />
          </div>
        </>
      ) : (
        <div className="grid grid-cols-2 gap-2 mt-2">
          <div className="rounded-lg bg-gray-50 p-2 text-center">
            <p className="font-heading font-bold text-lg text-gray-900">{a.items_con_diferencia}</p>
            <p className="font-body text-xs text-gray-500">con diferencia</p>
          </div>
          <div className="rounded-lg bg-gray-50 p-2 text-center">
            <p className={`font-heading font-bold text-lg ${valor < 0 ? 'text-red-600' : 'text-green-700'}`}>{cop.format(valor)}</p>
            <p className="font-body text-xs text-gray-500">impacto</p>
          </div>
        </div>
      )}
      <p className="font-body text-xs text-gray-400 mt-3">
        Iniciado {fechaCorta(a.created_at)}{a.cerrado_at ? ` · cerrado ${fechaCorta(a.cerrado_at)}` : ''}
      </p>
    </Link>
  )
}

function TarjetaCargue({ c }: { c: CargueRow }) {
  return (
    <Link href={`/inventario-fisico/${c.id}`} title="Ver el informe comparativo de este cargue"
      className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm hover:shadow-md hover:border-indigo-200 transition-all">
      <div className="flex items-start justify-between gap-2 mb-1">
        <h3 className="font-heading font-bold text-base text-gray-900 line-clamp-1">{c.periodo}</h3>
        {c.historico && (
          <span className="font-body text-[11px] font-semibold px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 shrink-0"
            title="Foto reconstruida después de aplicar el cruce">Histórico</span>
        )}
      </div>
      <div className="mb-2"><Origen tipo="CARGUE" /></div>
      {c.archivo_nombre && <p className="font-body text-xs text-gray-400 line-clamp-1 mb-3">{c.archivo_nombre}</p>}
      <div className="grid grid-cols-2 gap-2 mt-2">
        <div className="rounded-lg bg-gray-50 p-2 text-center">
          <p className="font-heading font-bold text-lg text-gray-900">{num.format(c.items_con_cantidad)}</p>
          <p className="font-body text-xs text-gray-500">contados</p>
        </div>
        <div className="rounded-lg bg-gray-50 p-2 text-center">
          <p className="font-heading font-bold text-lg text-gray-900">{num.format(Number(c.total_unidades))}</p>
          <p className="font-body text-xs text-gray-500">unidades</p>
        </div>
      </div>
      <p className="font-body text-xs text-gray-400 mt-3">
        Corte {fechaCorta(c.fecha_corte)} · {num.format(c.items_ajustados)} ajustados · {num.format(c.items_no_hallados)} no hallados
      </p>
    </Link>
  )
}

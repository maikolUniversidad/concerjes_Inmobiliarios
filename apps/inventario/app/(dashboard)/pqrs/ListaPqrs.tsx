'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Plus, MessageSquare, AlarmClock, TriangleAlert, Gauge, Tags } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { TablaEstandar, type ColumnaTabla } from '@/components/ui/tabla'
import {
  CANAL_PQRS_META, ESTADO_PQRS_META, ESTADOS_PQRS_ABIERTAS, ESTADOS_PQRS_ACTIVAS,
  PRIORIDAD_PQRS_META, TIPO_PQRS_META, TIPOS_PQRS,
  estadoPlazo, fechaCorta, hoyBogota, indicadoresPqrs, solicitante,
  type EstadoPqrs, type PqrsFila, type TipoPqrs,
} from '@/lib/pqrs'

type Vista = 'activas' | 'vencidas' | 'mias' | 'asignadas' | 'todas'

const VISTAS: { k: Vista; label: string }[] = [
  { k: 'activas', label: 'Activas' },
  { k: 'vencidas', label: 'Vencidas' },
  { k: 'mias', label: 'Radiqué yo' },
  { k: 'asignadas', label: 'A mi cargo' },
  { k: 'todas', label: 'Todas' },
]

export function ListaPqrs({ filas, usuarioId, puedeRadicar, verIndicadores, puedeParametrizar }: {
  filas: PqrsFila[]
  usuarioId: string
  puedeRadicar: boolean
  verIndicadores: boolean
  /** F5: entra al catálogo de categorías del QR público (`parametrizar_pqrs`). */
  puedeParametrizar?: boolean
}) {
  const router = useRouter()
  const [vista, setVista] = useState<Vista>('activas')
  const [tipo, setTipo] = useState<TipoPqrs | ''>('')
  const [estado, setEstado] = useState<EstadoPqrs | ''>('')
  // Se calcula una sola vez por render del servidor y del navegador: así el
  // semáforo de vencimiento sale igual en los dos y no rompe la hidratación.
  const hoy = useMemo(() => hoyBogota(), [])

  // En vivo: cualquier cambio en las PQRS refresca la lista.
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = createClient() as any
    let t: ReturnType<typeof setTimeout> | null = null
    const canal = sb.channel('pqrs-lista')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pqrs' }, () => {
        if (t) clearTimeout(t)
        t = setTimeout(() => router.refresh(), 600)
      })
      .subscribe()
    return () => { if (t) clearTimeout(t); sb.removeChannel(canal) }
  }, [router])

  const ind = useMemo(() => indicadoresPqrs(filas, hoy), [filas, hoy])

  const datos = useMemo(() => filas
    .filter((p) => {
      if (vista === 'todas') return true
      if (vista === 'activas') return ESTADOS_PQRS_ACTIVAS.includes(p.estado)
      if (vista === 'vencidas') return estadoPlazo(p.fecha_limite, p.estado, hoy).semaforo === 'VENCIDA'
      if (vista === 'mias') return p.radicada_por === usuarioId
      return p.responsable_id === usuarioId
    })
    .filter((p) => !tipo || p.tipo === tipo)
    .filter((p) => !estado || p.estado === estado)
    .sort((a, b) => {
      // Lo urgente primero: lo que está en plazo abierto, por fecha límite.
      const aAb = ESTADOS_PQRS_ABIERTAS.includes(a.estado)
      const bAb = ESTADOS_PQRS_ABIERTAS.includes(b.estado)
      if (aAb !== bAb) return aAb ? -1 : 1
      if (aAb) return a.fecha_limite.localeCompare(b.fecha_limite)
        || (PRIORIDAD_PQRS_META[a.prioridad]?.orden ?? 9) - (PRIORIDAD_PQRS_META[b.prioridad]?.orden ?? 9)
      return b.created_at.localeCompare(a.created_at)
    }), [filas, vista, tipo, estado, usuarioId, hoy])

  const columnas: ColumnaTabla<PqrsFila>[] = useMemo(() => [
    {
      id: 'numero', header: 'Radicado', ancho: 'w-28', tarjeta: 'titulo',
      valor: (p) => p.numero,
      celda: (p) => <span className="font-mono text-xs text-gray-500">{p.numero}</span>,
    },
    {
      id: 'tipo', header: 'Tipo', align: 'center', tarjeta: 'badge',
      valor: (p) => TIPO_PQRS_META[p.tipo]?.label ?? p.tipo,
      celda: (p) => (
        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${TIPO_PQRS_META[p.tipo]?.cls}`}>
          {TIPO_PQRS_META[p.tipo]?.label ?? p.tipo}
        </span>
      ),
    },
    {
      id: 'asunto', header: 'Asunto', ancho: 'min-w-[220px]', tarjeta: 'cuerpo',
      valor: (p) => p.asunto,
    },
    {
      id: 'sede', header: 'Sede', ancho: 'min-w-[180px]', prioridad: 2, tarjeta: 'subtitulo',
      valor: (p) => p.sede_nombre ?? '—',
    },
    {
      id: 'solicitante', header: 'Quién radica', prioridad: 3, tarjeta: 'meta',
      valor: (p) => solicitante(p),
    },
    {
      // F5: lo que llegó por el QR de un punto trae punto y categoría. Los dos
      // vienen desnormalizados en la fila, así que el Conserje los ve sin
      // necesitar `ver_puntos_ronda`. El `min-w` no sobra: sin él, el nombre
      // del punto se parte en tres renglones y la fila crece.
      id: 'punto', header: 'Punto / categoría', ancho: 'min-w-[180px]', prioridad: 2, tarjeta: 'meta',
      valor: (p) => [p.punto_nombre, p.categoria_nombre].filter(Boolean).join(' · ') || '—',
      celda: (p) => p.punto_nombre || p.categoria_nombre ? (
        <span className="text-xs text-gray-600">
          {p.punto_nombre ?? '—'}
          {p.categoria_nombre && <span className="block text-gray-400">{p.categoria_nombre}</span>}
        </span>
      ) : <span className="text-xs text-gray-300">—</span>,
    },
    {
      id: 'canal', header: 'Canal', prioridad: 3,
      valor: (p) => CANAL_PQRS_META[p.canal]?.label ?? p.canal,
    },
    {
      id: 'estado', header: 'Estado', align: 'center', tarjeta: 'badge',
      valor: (p) => ESTADO_PQRS_META[p.estado]?.label ?? p.estado,
      celda: (p) => (
        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${ESTADO_PQRS_META[p.estado]?.cls}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${ESTADO_PQRS_META[p.estado]?.dot}`} />
          {ESTADO_PQRS_META[p.estado]?.label ?? p.estado}
        </span>
      ),
    },
    {
      id: 'prioridad', header: 'Prioridad', align: 'center', prioridad: 3,
      valor: (p) => PRIORIDAD_PQRS_META[p.prioridad]?.label ?? p.prioridad,
      celda: (p) => (
        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${PRIORIDAD_PQRS_META[p.prioridad]?.cls}`}>
          {PRIORIDAD_PQRS_META[p.prioridad]?.label ?? p.prioridad}
        </span>
      ),
    },
    {
      id: 'responsable', header: 'Responsable', prioridad: 2, tarjeta: 'meta',
      valor: (p) => p.responsable_nombre ?? 'Sin asignar',
    },
    {
      id: 'radicada', header: 'Radicada', align: 'center', prioridad: 3,
      valor: (p) => p.created_at.slice(0, 10),
      celda: (p) => <span className="text-xs text-gray-500">{fechaCorta(p.created_at)}</span>,
    },
    {
      id: 'vence', header: 'Plazo de respuesta', align: 'center', tarjeta: 'meta',
      // El valor plano es la fecha: así el filtro y el orden de la columna sirven.
      valor: (p) => p.fecha_limite,
      copiaTexto: (p) => fechaCorta(p.fecha_limite),
      celda: (p) => {
        const x = estadoPlazo(p.fecha_limite, p.estado, hoy)
        return <span className={`text-xs ${x.cls}`} title={`Fecha límite: ${fechaCorta(p.fecha_limite)} (${p.dias_plazo} días hábiles)`}>{x.texto}</span>
      },
    },
  ], [hoy])

  return (
    <div className="space-y-4">
      {/* Semáforo del módulo */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        <Kpi label="Radicadas" n={ind.radicadas} cls="text-red-600" onClick={() => { setVista('todas'); setEstado('RADICADA') }} />
        <Kpi label="En trámite" n={ind.enTramite} cls="text-amber-600" onClick={() => { setVista('activas'); setEstado('') }} />
        <Kpi label="Por cerrar" n={ind.porCerrar} cls="text-emerald-600" onClick={() => { setVista('todas'); setEstado('RESPONDIDA') }} />
        <Kpi label="Vencidas" n={ind.vencidas} cls="text-red-700" icon={TriangleAlert} onClick={() => { setVista('vencidas'); setEstado('') }} />
        <Kpi label="Vencen en ≤3 días" n={ind.porVencer} cls="text-amber-700" icon={AlarmClock} onClick={() => { setVista('activas'); setEstado('') }} />
      </div>

      {verIndicadores && <PanelGerencia ind={ind} />}

      {/* Vistas + filtros de negocio */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1">
          {VISTAS.map((v) => (
            <button key={v.k} onClick={() => setVista(v.k)}
              className={`rounded-lg px-3 py-1.5 font-body text-xs font-semibold transition-colors ${
                vista === v.k ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
              {v.label}
            </button>
          ))}
        </div>
        {puedeParametrizar && (
          <Link href="/pqrs/categorias"
            className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 font-body text-sm font-semibold text-gray-600 hover:bg-gray-50">
            <Tags className="w-4 h-4" /> Categorías
          </Link>
        )}
        {puedeRadicar && (
          <Link href="/pqrs/nueva"
            className={`${puedeParametrizar ? '' : 'ml-auto '}inline-flex items-center gap-1.5 rounded-lg bg-brand-green px-3 py-2 font-body text-sm font-semibold text-white hover:bg-brand-green-dark`}>
            <Plus className="w-4 h-4" /> Radicar PQRS
          </Link>
        )}
      </div>

      <TablaEstandar
        id="pqrs"
        titulo="PQRS"
        modulo="PQRS"
        entidad="pqrs"
        datos={datos}
        columnas={columnas}
        filaId={(p) => p.id}
        busqueda="Buscar por radicado, asunto, sede, quién radica…"
        onFilaClick={(p) => router.push(`/pqrs/${p.id}`)}
        textoDetalle="Abrir"
        filaClassName={(p) => estadoPlazo(p.fecha_limite, p.estado, hoy).semaforo === 'VENCIDA' ? 'bg-red-50/60' : ''}
        vacio={
          <div className="py-10 text-center">
            <MessageSquare className="mx-auto mb-2 h-8 w-8 text-gray-300" />
            <p className="font-body text-sm text-gray-500">No hay PQRS con estos filtros.</p>
          </div>
        }
        herramientas={
          /* `w-full sm:w-auto`: en móvil los dos filtros bajan a su propia
             línea. Sin eso le roban el ancho al buscador de la tabla, que
             queda de 30 px y con el contador "0 de 0" encima. */
          <div className="flex w-full flex-wrap gap-1.5 sm:w-auto">
            <select value={tipo} onChange={(e) => setTipo(e.target.value as TipoPqrs | '')}
              aria-label="Filtrar por tipo"
              className="min-w-0 flex-1 rounded-lg border border-gray-200 bg-white px-2 py-1.5 font-body text-sm sm:flex-none">
              <option value="">Todos los tipos</option>
              {TIPOS_PQRS.map((t) => <option key={t} value={t}>{TIPO_PQRS_META[t].label}</option>)}
            </select>
            <select value={estado} onChange={(e) => setEstado(e.target.value as EstadoPqrs | '')}
              aria-label="Filtrar por estado"
              className="min-w-0 flex-1 rounded-lg border border-gray-200 bg-white px-2 py-1.5 font-body text-sm sm:flex-none">
              <option value="">Todos los estados</option>
              {(Object.keys(ESTADO_PQRS_META) as EstadoPqrs[]).map((e) => (
                <option key={e} value={e}>{ESTADO_PQRS_META[e].label}</option>
              ))}
            </select>
          </div>
        }
      />
    </div>
  )
}

function Kpi({ label, n, cls, icon: Icon, onClick }: {
  label: string
  n: number
  cls: string
  icon?: typeof AlarmClock
  onClick: () => void
}) {
  return (
    <button onClick={onClick}
      className="rounded-2xl border border-gray-100 bg-white px-3 py-2.5 text-left shadow-sm transition-shadow hover:shadow-md">
      <p className="flex items-center gap-1 font-body text-[11px] text-gray-500">
        {Icon && <Icon className="w-3.5 h-3.5" />} {label}
      </p>
      <p className={`font-heading text-2xl font-bold ${n > 0 ? cls : 'text-gray-300'}`}>{n}</p>
    </button>
  )
}

/** Indicadores de dirección (permiso `ver_panel_gerencia`). */
function PanelGerencia({ ind }: { ind: ReturnType<typeof indicadoresPqrs> }) {
  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
      <h2 className="mb-3 flex items-center gap-1.5 font-heading text-sm font-semibold text-gray-900">
        <Gauge className="w-4 h-4 text-brand-green" /> Indicadores de la operación
      </h2>
      {/* `min-w-0` en cada celda: sin eso un nombre de sede largo ensancha la
          rejilla y empuja los conteos fuera de la tarjeta en móvil. */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="min-w-0">
          <p className="font-body text-[11px] text-gray-500">Tiempo promedio de respuesta</p>
          <p className="font-heading text-xl font-bold text-gray-900">
            {ind.diasPromedioRespuesta === null ? '—' : `${ind.diasPromedioRespuesta} d`}
          </p>
          <p className="font-body text-[10px] text-gray-400">días de calendario desde la radicación</p>
        </div>
        <div className="min-w-0">
          <p className="font-body text-[11px] text-gray-500">Respondidas dentro del plazo</p>
          <p className={`font-heading text-xl font-bold ${
            ind.cumplimiento === null ? 'text-gray-300' : ind.cumplimiento >= 90 ? 'text-emerald-600' : ind.cumplimiento >= 70 ? 'text-amber-600' : 'text-red-600'}`}>
            {ind.cumplimiento === null ? '—' : `${ind.cumplimiento}%`}
          </p>
        </div>
        <div className="min-w-0">
          <p className="mb-1 font-body text-[11px] text-gray-500">Sedes con más PQRS</p>
          {ind.topSedes.length === 0 ? <p className="font-body text-xs text-gray-400">—</p> : (
            <ul className="space-y-0.5">
              {ind.topSedes.map((s) => (
                <li key={s.nombre} className="flex gap-2 font-body text-xs text-gray-700">
                  <span className="min-w-0 truncate">{s.nombre}</span>
                  <span className="ml-auto font-semibold text-gray-900">{s.n}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="min-w-0">
          <p className="mb-1 font-body text-[11px] text-gray-500">Por tipo</p>
          {ind.porTipo.length === 0 ? <p className="font-body text-xs text-gray-400">—</p> : (
            <ul className="space-y-0.5">
              {ind.porTipo.map((t) => (
                <li key={t.tipo} className="flex gap-2 font-body text-xs text-gray-700">
                  <span>{TIPO_PQRS_META[t.tipo].label}</span>
                  <span className="ml-auto font-semibold text-gray-900">{t.n}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}

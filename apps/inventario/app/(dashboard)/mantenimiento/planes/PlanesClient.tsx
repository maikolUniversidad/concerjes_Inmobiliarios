'use client'

// Los planes preventivos (F7). Dos cosas en una pantalla, a propósito:
//   · la lista de PLANES, que es la regla («cada 3 meses», «cada 500 horas»);
//   · y «LO QUE TOCA», que es la consecuencia de la regla sobre cada objeto.
// Separarlas en dos rutas obligaría a saltar para entender por qué una orden
// aparece hoy y no la semana pasada.

import { useMemo, useState, useTransition } from 'react'
import Link from 'next/link'
import {
  CalendarClock, Plus, Pencil, Power, Trash2, Loader2, ListChecks, Package,
  ShieldCheck, Gauge, AlertTriangle, CheckCircle2, X,
} from 'lucide-react'
import { toast } from 'sonner'
import { TablaEstandar, type ColumnaTabla } from '@/components/ui/tabla'
import { Hoja, inputMant, labelMant } from '@/components/mantenimiento/Hoja'
import {
  FRECUENCIAS_PLAN, FRECUENCIA_PLAN_META, PRIORIDADES, PRIORIDAD_META,
  TIPO_PLAN_TICKET, textoFrecuencia,
} from '@/lib/mantenimiento'
import {
  guardarPlan, cambiarActivoPlan, borrarPlan, guardarTarea, borrarTarea,
  guardarMaterialPlan, borrarMaterialPlan,
} from './actions'

export interface PlanFila {
  id: string; codigo: string; nombre: string; descripcion: string | null
  grupo_id: string | null; activo_tipo_id: string | null; activo_id: string | null; maquinaria_id: string | null
  frecuencia_tipo: string; frecuencia_valor: number; medidor_id: string | null
  anticipacion_dias: number; tolerancia_dias: number; vence_alerta_dias: number
  obligatorio_normativo: boolean; normativa: string | null
  tipo_ticket: string; prioridad: string; duracion_estimada_min: number | null
  asignado_a: string | null; proveedor_id: string | null; activo: boolean; created_at: string
  grupo: { codigo: string; nombre: string } | null
  tipo: { nombre: string; normativa: string | null } | null
  objeto_activo: { codigo: string; nombre: string } | null
  objeto_maquinaria: { codigo: string; nombre: string } | null
  proveedor: { nombre: string } | null
  tareas: { id: string; orden: number; plantilla_id: string | null; descripcion: string | null; plantilla: { codigo: string; nombre: string; version: number } | null }[]
  materiales: { id: string; cantidad: number; producto_id: string; producto: { nombre_estandar: string; presentacion: string | null } | null }[]
}

export interface ProximoFila {
  plan_id: string; plan_codigo: string; plan_nombre: string
  objeto_codigo: string; objeto_nombre: string
  activo_id: string | null; maquinaria_id: string | null; sede_id: string | null
  frecuencia_tipo: string; proximo_el: string | null; proximo_medidor: number | null
  medidor_actual: number | null; medidor_unidad: string | null
  ultimo_at: string | null; ticket_abierto_id: string | null
}

export interface Opciones {
  grupos: { id: string; codigo: string; nombre: string }[]
  tipos: { id: string; nombre: string; normativa: string | null; obligatorio_normativo: boolean; exige_medidor: boolean }[]
  plantillas: { id: string; codigo: string; nombre: string; version: number; grupo_id: string | null }[]
  tecnicos: { id: string; nombre: string; rol_nombre: string | null }[]
  proveedores: { id: string; nombre: string }[]
}

const fecha = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' })
const num = (n: number) => new Intl.NumberFormat('es-CO', { maximumFractionDigits: 2 }).format(n)

/** A qué se aplica un plan, en una línea. */
function objetoDe(p: PlanFila): string {
  if (p.tipo) return `Todos los ${p.tipo.nombre.toLowerCase()}`
  if (p.objeto_activo) return `${p.objeto_activo.codigo} · ${p.objeto_activo.nombre}`
  if (p.objeto_maquinaria) return `${p.objeto_maquinaria.codigo} · ${p.objeto_maquinaria.nombre} (equipo propio)`
  return '—'
}

export function PlanesClient({ planes, proximos, opciones, puedeGestionar }: {
  planes: PlanFila[]
  proximos: ProximoFila[]
  opciones: Opciones
  puedeGestionar: boolean
}) {
  const [editando, setEditando] = useState<PlanFila | null | 'nuevo'>(null)
  const [detalle, setDetalle] = useState<PlanFila | null>(null)
  const [pending, startTransition] = useTransition()

  // Lo que toca: vencido primero, y lo que ya tiene orden abierta al final.
  const pendientes = useMemo(() => {
    const hoy = new Date().toISOString().slice(0, 10)
    return proximos
      .map((p) => ({
        ...p,
        vencido: p.frecuencia_tipo === 'MEDIDOR'
          ? p.medidor_actual != null && p.proximo_medidor != null && Number(p.medidor_actual) >= Number(p.proximo_medidor)
          : !!p.proximo_el && p.proximo_el <= hoy,
      }))
      .sort((a, b) => {
        if (!!a.ticket_abierto_id !== !!b.ticket_abierto_id) return a.ticket_abierto_id ? 1 : -1
        if (a.vencido !== b.vencido) return a.vencido ? -1 : 1
        return (a.proximo_el ?? '9999').localeCompare(b.proximo_el ?? '9999')
      })
  }, [proximos])

  const vencidos = pendientes.filter((p) => p.vencido && !p.ticket_abierto_id).length
  const conOrden = pendientes.filter((p) => p.ticket_abierto_id).length

  function accion(fn: () => Promise<{ error?: string }>, exito: string) {
    startTransition(async () => {
      const r = await fn()
      if (r.error) { toast.error(r.error); return }
      toast.success(exito)
    })
  }

  const columnas: ColumnaTabla<PlanFila>[] = [
    { id: 'codigo', header: 'Plan', valor: (p) => p.codigo, tarjeta: 'subtitulo', className: 'font-mono text-xs text-gray-600 whitespace-nowrap' },
    {
      id: 'nombre', header: 'Nombre', valor: (p) => p.nombre, tarjeta: 'titulo', ancho: 'min-w-[200px]',
      celda: (p) => (
        <div className="min-w-0">
          <p className="truncate font-medium text-gray-900">{p.nombre}</p>
          {p.obligatorio_normativo && (
            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-700">
              <ShieldCheck className="w-3 h-3" /> Obligatorio{p.normativa ? ` · ${p.normativa}` : ''}
            </span>
          )}
        </div>
      ),
    },
    { id: 'objeto', header: 'Se aplica a', valor: objetoDe, tarjeta: 'meta', className: 'text-xs text-gray-700 max-w-[240px] truncate' },
    {
      id: 'frecuencia', header: 'Cada', tarjeta: 'badge',
      valor: (p) => textoFrecuencia(p.frecuencia_tipo, p.frecuencia_valor),
      celda: (p) => (
        <span className="inline-flex items-center gap-1 text-xs text-gray-700">
          {p.frecuencia_tipo === 'MEDIDOR' && <Gauge className="w-3 h-3 text-gray-400" />}
          {textoFrecuencia(p.frecuencia_tipo, p.frecuencia_valor)}
        </span>
      ),
    },
    { id: 'contrato', header: 'Contrato', prioridad: 2, tarjeta: 'meta', valor: (p) => p.grupo?.codigo ?? 'Todos', className: 'text-xs text-gray-600' },
    {
      id: 'prioridad', header: 'Prioridad', prioridad: 2, tarjeta: 'badge',
      valor: (p) => PRIORIDAD_META[p.prioridad]?.label ?? p.prioridad,
      celda: (p) => <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${PRIORIDAD_META[p.prioridad]?.cls ?? ''}`}>{PRIORIDAD_META[p.prioridad]?.label ?? p.prioridad}</span>,
    },
    {
      id: 'tareas', header: 'Tareas', align: 'right', prioridad: 2, tarjeta: 'meta',
      valor: (p) => p.tareas?.length ?? 0,
      celda: (p) => <span className="text-xs text-gray-600">{p.tareas?.length ?? 0}</span>,
    },
    { id: 'anticipacion', header: 'Avisa con', align: 'right', prioridad: 3, tarjeta: 'oculto', valor: (p) => p.anticipacion_dias, celda: (p) => <span className="text-xs text-gray-600">{p.anticipacion_dias} d</span> },
    {
      id: 'activo', header: 'Estado', tarjeta: 'badge', valor: (p) => (p.activo ? 'Activo' : 'Inactivo'),
      celda: (p) => p.activo
        ? <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">Activo</span>
        : <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-semibold text-gray-500">Inactivo</span>,
    },
  ]

  return (
    <div className="space-y-5">
      {/* Lo que toca */}
      <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="font-heading text-sm font-bold text-gray-900">Lo que toca</p>
          <div className="flex flex-wrap gap-2 text-[11px]">
            {vencidos > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-1 font-medium text-red-700">
                <AlertTriangle className="w-3 h-3" /> {vencidos} vencido(s) sin orden
              </span>
            )}
            {conOrden > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-sky-50 px-2 py-1 font-medium text-sky-700">
                <CheckCircle2 className="w-3 h-3" /> {conOrden} ya con orden abierta
              </span>
            )}
          </div>
        </div>
        {pendientes.length === 0 ? (
          <p className="mt-2 text-sm text-gray-500">
            Ningún plan activo apunta todavía a un objeto. Un plan por tipo de activo se expande solo
            cuando existen activos de ese tipo en los contratos a tu alcance.
          </p>
        ) : (
          <>
            <ul className="mt-2 divide-y divide-gray-100">
              {pendientes.slice(0, 12).map((p) => (
                <li key={`${p.plan_id}-${p.activo_id ?? p.maquinaria_id}`} className="flex flex-wrap items-center gap-x-2 gap-y-1 py-2 text-sm">
                  <span className="font-mono text-xs text-gray-500">{p.objeto_codigo}</span>
                  <span className="min-w-0 flex-1 truncate text-gray-900">{p.objeto_nombre}</span>
                  <span className="text-xs text-gray-500">{p.plan_nombre}</span>
                  {p.frecuencia_tipo === 'MEDIDOR' ? (
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${p.vencido ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-600'}`}>
                      {p.medidor_actual != null ? `${num(Number(p.medidor_actual))} de ${num(Number(p.proximo_medidor ?? 0))} ${p.medidor_unidad ?? ''}` : 'sin lectura'}
                    </span>
                  ) : (
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${p.vencido ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-600'}`}>
                      {p.proximo_el ? fecha(p.proximo_el) : 'sin fecha'}
                    </span>
                  )}
                  {p.ticket_abierto_id && (
                    <Link href={`/mantenimiento/${p.ticket_abierto_id}`}
                      className="text-[11px] font-semibold text-brand-green hover:underline">ver orden</Link>
                  )}
                </li>
              ))}
            </ul>
            {pendientes.length > 12 && (
              <p className="mt-2 text-xs text-gray-400">y {pendientes.length - 12} más.</p>
            )}
            <p className="mt-3 text-xs text-gray-500">
              Las órdenes no se crean aquí: el botón «Programar» del tablero llama a
              <code className="mx-1 rounded bg-gray-100 px-1">mant_generar_preventivos</code>, que es
              idempotente y no duplica la orden de un objeto que ya tiene una abierta.
            </p>
          </>
        )}
      </div>

      {/* Los planes */}
      <TablaEstandar
        id="mant-planes"
        datos={planes}
        columnas={columnas}
        filaId={(p) => p.id}
        titulo="Planes preventivos"
        modulo="Mantenimiento"
        entidad="plan"
        onFilaClick={(p) => setDetalle(p)}
        textoDetalle="Ver plan"
        anchoAcciones="w-28"
        acciones={puedeGestionar ? (p) => (
          <div className="flex items-center gap-1">
            <button onClick={(e) => { e.stopPropagation(); setEditando(p) }} title="Editar"
              className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700">
              <Pencil className="w-4 h-4" />
            </button>
            <button onClick={(e) => { e.stopPropagation(); accion(() => cambiarActivoPlan(p.id, !p.activo), p.activo ? 'Plan desactivado.' : 'Plan activado.') }}
              title={p.activo ? 'Desactivar' : 'Activar'} disabled={pending}
              className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-50">
              <Power className="w-4 h-4" />
            </button>
            <button onClick={(e) => {
              e.stopPropagation()
              if (confirm(`¿Borrar el plan ${p.codigo}? Si ya generó órdenes, mejor desactívalo.`)) {
                accion(() => borrarPlan(p.id), 'Plan borrado.')
              }
            }} title="Borrar" disabled={pending}
              className="rounded-lg p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-50">
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        ) : undefined}
        herramientas={puedeGestionar ? (
          <button onClick={() => setEditando('nuevo')}
            className="inline-flex items-center gap-1.5 rounded-xl bg-brand-green px-3 py-2 text-sm font-semibold text-white hover:bg-brand-green-dark">
            <Plus className="w-4 h-4" /> Nuevo plan
          </button>
        ) : undefined}
        vacio={
          <div className="py-10 text-center">
            <CalendarClock className="mx-auto h-8 w-8 text-gray-300" />
            <p className="mt-2 text-sm text-gray-500">Todavía no hay planes preventivos.</p>
            {puedeGestionar && (
              <p className="mt-1 text-xs text-gray-400">
                Empieza por un plan por tipo de activo: con uno solo quedan cubiertos todos los
                extintores, por ejemplo.
              </p>
            )}
          </div>
        }
      />

      {editando && (
        <PlanHoja plan={editando === 'nuevo' ? null : editando} opciones={opciones}
          onClose={() => setEditando(null)}
          onListo={() => { setEditando(null); toast.success('Plan guardado.') }} />
      )}
      {detalle && (
        <DetalleHoja plan={detalle} opciones={opciones} puedeGestionar={puedeGestionar}
          onClose={() => setDetalle(null)} />
      )}
    </div>
  )
}

function PlanHoja({ plan, opciones, onClose, onListo }: {
  plan: PlanFila | null
  opciones: Opciones
  onClose: () => void
  onListo: () => void
}) {
  const [pending, startTransition] = useTransition()
  const [objetoTipo, setObjetoTipo] = useState(
    plan?.activo_id ? 'ACTIVO' : plan?.maquinaria_id ? 'MAQUINARIA' : 'TIPO',
  )
  const [frecuencia, setFrecuencia] = useState(plan?.frecuencia_tipo ?? 'MESES')
  const [tipoElegido, setTipoElegido] = useState(plan?.activo_tipo_id ?? '')
  const [normativo, setNormativo] = useState(plan?.obligatorio_normativo ?? false)

  const tipo = opciones.tipos.find((t) => t.id === tipoElegido)

  function enviar(fd: FormData) {
    startTransition(async () => {
      const r = await guardarPlan(fd)
      if (r.error) { toast.error(r.error); return }
      onListo()
    })
  }

  return (
    <Hoja abierta titulo={plan ? `Editar ${plan.codigo}` : 'Nuevo plan preventivo'} onClose={onClose}
      pie={
        <button type="submit" form="form-plan" disabled={pending}
          className="w-full flex items-center justify-center gap-2 rounded-xl bg-brand-green py-3 text-sm font-semibold text-white hover:bg-brand-green-dark disabled:opacity-60">
          {pending && <Loader2 className="w-4 h-4 animate-spin" />} Guardar
        </button>
      }>
      <form id="form-plan" action={enviar} className="space-y-4">
        {plan && <input type="hidden" name="id" value={plan.id} />}

        <div>
          <label className={labelMant}>Nombre <span className="text-red-500">*</span></label>
          <input name="nombre" defaultValue={plan?.nombre ?? ''} className={inputMant}
            placeholder="Revisión trimestral de extintores" required />
        </div>

        <div>
          <label className={labelMant}>Qué incluye</label>
          <textarea name="descripcion" defaultValue={plan?.descripcion ?? ''} rows={2}
            className={`${inputMant} resize-none`} placeholder="Presión, precinto, fecha de recarga, señalización…" />
        </div>

        {/* A qué se aplica: uno de tres */}
        <div>
          <label className={labelMant}>Se aplica a <span className="text-red-500">*</span></label>
          <div className="flex gap-1 rounded-xl bg-gray-100 p-1 text-xs">
            {[
              { k: 'TIPO', label: 'Un tipo de activo' },
              { k: 'ACTIVO', label: 'Un activo' },
              { k: 'MAQUINARIA', label: 'Un equipo propio' },
            ].map((o) => (
              <button key={o.k} type="button" onClick={() => setObjetoTipo(o.k)}
                className={`flex-1 rounded-lg px-2 py-1.5 font-medium ${objetoTipo === o.k ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}>
                {o.label}
              </button>
            ))}
          </div>
          <input type="hidden" name="objeto_tipo" value={objetoTipo} />
          <p className="mt-1 text-[11px] text-gray-500">
            Por tipo es lo normal: un plan cubre todos los activos de ese tipo en los contratos a tu
            alcance, y no hay que escribirlo una vez por activo.
          </p>
        </div>

        {objetoTipo === 'TIPO' && (
          <div>
            <label className={labelMant}>Tipo de activo <span className="text-red-500">*</span></label>
            <select name="activo_tipo_id" value={tipoElegido} onChange={(e) => setTipoElegido(e.target.value)} className={inputMant}>
              <option value="">— Seleccionar —</option>
              {opciones.tipos.map((t) => (
                <option key={t.id} value={t.id}>{t.nombre}{t.normativa ? ` · ${t.normativa}` : ''}</option>
              ))}
            </select>
            {tipo?.obligatorio_normativo && (
              <p className="mt-1 text-[11px] text-amber-700">
                Este tipo está marcado como obligatorio por normativa{tipo.normativa ? ` (${tipo.normativa})` : ''}.
              </p>
            )}
          </div>
        )}
        {objetoTipo === 'ACTIVO' && (
          <div>
            <label className={labelMant}>Id del activo <span className="text-red-500">*</span></label>
            <input name="activo_id" defaultValue={plan?.activo_id ?? ''} className={inputMant}
              placeholder="Pega el id del activo desde su ficha" />
            <p className="mt-1 text-[11px] text-gray-500">
              Un plan para un solo activo: úsalo cuando ese equipo necesita algo que su tipo no.
            </p>
          </div>
        )}
        {objetoTipo === 'MAQUINARIA' && (
          <div>
            <label className={labelMant}>Id del equipo propio <span className="text-red-500">*</span></label>
            <input name="maquinaria_id" defaultValue={plan?.maquinaria_id ?? ''} className={inputMant}
              placeholder="Pega el id del equipo desde su ficha" />
            <p className="mt-1 text-[11px] text-gray-500">
              Para un equipo de la empresa. Si lo que quieres es una frecuencia simple, la ficha del
              equipo ya tiene «cada N días» y sigue funcionando.
            </p>
          </div>
        )}

        <div>
          <label className={labelMant}>Contrato</label>
          <select name="grupo_id" defaultValue={plan?.grupo_id ?? ''} className={inputMant}>
            <option value="">Todos los contratos</option>
            {opciones.grupos.map((g) => <option key={g.id} value={g.id}>{g.codigo} · {g.nombre}</option>)}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className={labelMant}>Frecuencia <span className="text-red-500">*</span></label>
            <select name="frecuencia_tipo" value={frecuencia} onChange={(e) => setFrecuencia(e.target.value)} className={inputMant}>
              {FRECUENCIAS_PLAN.map((f) => <option key={f} value={f}>{FRECUENCIA_PLAN_META[f].label}</option>)}
            </select>
          </div>
          <div>
            <label className={labelMant}>Cada cuántos <span className="text-red-500">*</span></label>
            <input name="frecuencia_valor" type="number" min={1} step="0.01"
              defaultValue={plan?.frecuencia_valor ?? 3} className={inputMant} required />
          </div>
        </div>
        <p className="-mt-2 text-[11px] text-gray-500">{FRECUENCIA_PLAN_META[frecuencia as keyof typeof FRECUENCIA_PLAN_META]?.ayuda}</p>

        {frecuencia === 'MEDIDOR' && (
          <div>
            <label className={labelMant}>Id del medidor <span className="text-red-500">*</span></label>
            <input name="medidor_id" defaultValue={plan?.medidor_id ?? ''} className={inputMant}
              placeholder="Pega el id del medidor desde la ficha del activo" />
            <p className="mt-1 text-[11px] text-gray-500">
              La lectura la mantiene el medidor del activo: el plan dispara cuando el contador pasa el
              salto, sin que nadie tenga que recalcularlo.
            </p>
          </div>
        )}

        <div className="grid grid-cols-3 gap-2">
          <div>
            <label className={labelMant}>Avisa con</label>
            <input name="anticipacion_dias" type="number" min={0} defaultValue={plan?.anticipacion_dias ?? 7} className={inputMant} />
            <p className="mt-0.5 text-[10px] text-gray-400">días antes</p>
          </div>
          <div>
            <label className={labelMant}>Tolerancia</label>
            <input name="tolerancia_dias" type="number" min={0} defaultValue={plan?.tolerancia_dias ?? 0} className={inputMant} />
            <p className="mt-0.5 text-[10px] text-gray-400">días de gracia</p>
          </div>
          <div>
            <label className={labelMant}>Alerta al vencer</label>
            <input name="vence_alerta_dias" type="number" min={0} defaultValue={plan?.vence_alerta_dias ?? 3} className={inputMant} />
            <p className="mt-0.5 text-[10px] text-gray-400">días después</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className={labelMant}>Tipo de orden</label>
            <select name="tipo_ticket" defaultValue={plan?.tipo_ticket ?? 'PREVENTIVO'} className={inputMant}>
              {TIPO_PLAN_TICKET.map((t) => <option key={t} value={t}>{t === 'PREVENTIVO' ? 'Preventivo' : 'Inspección'}</option>)}
            </select>
          </div>
          <div>
            <label className={labelMant}>Prioridad</label>
            <select name="prioridad" defaultValue={plan?.prioridad ?? 'MEDIA'} className={inputMant}>
              {PRIORIDADES.map((p) => <option key={p} value={p}>{PRIORIDAD_META[p].label}</option>)}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className={labelMant}>Duración estimada</label>
            <input name="duracion_estimada_min" type="number" min={1} defaultValue={plan?.duracion_estimada_min ?? ''} className={inputMant} placeholder="minutos" />
          </div>
          <div>
            <label className={labelMant}>Técnico de siempre</label>
            <select name="asignado_a" defaultValue={plan?.asignado_a ?? ''} className={inputMant}>
              <option value="">Sin asignar (lo toma quien reciba)</option>
              {opciones.tecnicos.map((u) => <option key={u.id} value={u.id}>{u.nombre}</option>)}
            </select>
          </div>
        </div>

        <div>
          <label className={labelMant}>Proveedor externo</label>
          <select name="proveedor_id" defaultValue={plan?.proveedor_id ?? ''} className={inputMant}>
            <option value="">Lo hace personal interno</option>
            {opciones.proveedores.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
          </select>
          <p className="mt-1 text-[11px] text-gray-500">
            El proveedor no tiene cuenta en el sistema: queda como dato de quién ejecuta, y el registro
            del trabajo lo hace alguien interno.
          </p>
        </div>

        <label className="flex items-start gap-2 text-sm text-gray-700">
          <input type="checkbox" name="obligatorio_normativo" checked={normativo}
            onChange={(e) => setNormativo(e.target.checked)} className="mt-0.5" />
          <span>
            Obligatorio por normativa
            <span className="block text-[11px] text-gray-500">
              Queda en el informe como incumplimiento si no se hace, no solo como atraso.
            </span>
          </span>
        </label>
        {normativo && (
          <div>
            <label className={labelMant}>Norma</label>
            <input name="normativa" defaultValue={plan?.normativa ?? tipo?.normativa ?? ''} className={inputMant}
              placeholder="NTC 2885, RETIE…" />
          </div>
        )}

        {plan && (
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" name="activo" defaultChecked={plan.activo} />
            Plan activo (un plan inactivo no genera órdenes)
          </label>
        )}
      </form>
    </Hoja>
  )
}

function DetalleHoja({ plan, opciones, puedeGestionar, onClose }: {
  plan: PlanFila
  opciones: Opciones
  puedeGestionar: boolean
  onClose: () => void
}) {
  const [pending, startTransition] = useTransition()
  const [plantilla, setPlantilla] = useState('')

  function accion(fn: () => Promise<{ error?: string }>, exito: string) {
    startTransition(async () => {
      const r = await fn()
      if (r.error) { toast.error(r.error); return }
      toast.success(exito)
    })
  }

  const tareas = [...(plan.tareas ?? [])].sort((a, b) => a.orden - b.orden)

  return (
    <Hoja abierta titulo={`${plan.codigo} · ${plan.nombre}`} onClose={onClose}>
      <div className="space-y-1 text-sm text-gray-700">
        <p><b>Se aplica a:</b> {objetoDe(plan)}</p>
        <p><b>Frecuencia:</b> {textoFrecuencia(plan.frecuencia_tipo, plan.frecuencia_valor)}</p>
        <p><b>Contrato:</b> {plan.grupo ? `${plan.grupo.codigo} · ${plan.grupo.nombre}` : 'todos'}</p>
        <p><b>Avisa:</b> {plan.anticipacion_dias} días antes · tolerancia {plan.tolerancia_dias} d</p>
        {plan.proveedor && <p><b>Proveedor:</b> {plan.proveedor.nombre}</p>}
        {plan.descripcion && <p className="whitespace-pre-line text-gray-600">{plan.descripcion}</p>}
      </div>

      {/* Tareas: son plantillas del catálogo de F4, no un segundo catálogo */}
      <div>
        <p className={`${labelMant} flex items-center gap-1`}><ListChecks className="w-3.5 h-3.5" /> Tareas del plan</p>
        {tareas.length === 0 ? (
          <p className="text-sm text-gray-500">
            Sin tareas. La orden se puede ejecutar igual con la tarea genérica «MANT-OT», pero una
            tarea propia deja los pasos y la evidencia que hace falta.
          </p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {tareas.map((t) => (
              <li key={t.id} className="flex items-center gap-2 py-2 text-sm">
                <span className="w-5 text-xs text-gray-400">{t.orden}</span>
                <span className="min-w-0 flex-1">
                  {t.plantilla ? (
                    <>
                      <span className="font-mono text-xs text-gray-500">{t.plantilla.codigo}</span> v{t.plantilla.version} ·{' '}
                      {t.plantilla.nombre}
                    </>
                  ) : '—'}
                </span>
                {puedeGestionar && (
                  <button onClick={() => accion(() => borrarTarea(t.id), 'Tarea quitada.')} disabled={pending}
                    className="rounded-lg p-1 text-gray-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-50">
                    <X className="w-4 h-4" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        {puedeGestionar && (
          <form action={(fd) => { accion(() => guardarTarea(fd), 'Tarea agregada.'); setPlantilla('') }}
            className="mt-2 flex gap-2">
            <input type="hidden" name="plan_id" value={plan.id} />
            <select name="plantilla_id" value={plantilla} onChange={(e) => setPlantilla(e.target.value)}
              className={`${inputMant} flex-1`}>
              <option value="">— Agregar una tarea del catálogo —</option>
              {opciones.plantillas
                .filter((p) => p.grupo_id === null || p.grupo_id === plan.grupo_id)
                .map((p) => <option key={p.id} value={p.id}>{p.codigo} v{p.version} · {p.nombre}</option>)}
            </select>
            <button type="submit" disabled={pending || !plantilla}
              className="rounded-xl border border-gray-200 px-3 text-sm font-semibold text-gray-700 hover:border-brand-green hover:text-brand-green disabled:opacity-50">
              <Plus className="w-4 h-4" />
            </button>
          </form>
        )}
      </div>

      {/* Materiales esperados: no mueven stock */}
      <div>
        <p className={`${labelMant} flex items-center gap-1`}><Package className="w-3.5 h-3.5" /> Materiales esperados</p>
        {(plan.materiales?.length ?? 0) === 0 ? (
          <p className="text-sm text-gray-500">Sin materiales previstos.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {plan.materiales.map((m) => (
              <li key={m.id} className="flex items-center gap-2 py-2 text-sm">
                <span className="min-w-0 flex-1 truncate">
                  {m.producto?.nombre_estandar ?? 'Producto'}
                  {m.producto?.presentacion ? ` · ${m.producto.presentacion}` : ''}
                </span>
                <span className="text-xs text-gray-600">{num(Number(m.cantidad))}</span>
                {puedeGestionar && (
                  <button onClick={() => accion(() => borrarMaterialPlan(m.id), 'Material quitado.')} disabled={pending}
                    className="rounded-lg p-1 text-gray-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-50">
                    <X className="w-4 h-4" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-1 text-[11px] text-gray-500">
          Sirven para alistar antes de salir: NO mueven inventario. El stock lo mueve el consumo real
          que se carga en la orden.
        </p>
      </div>
    </Hoja>
  )
}

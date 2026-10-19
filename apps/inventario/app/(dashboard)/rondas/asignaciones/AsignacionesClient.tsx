'use client'

import { useActionState, useEffect, useMemo, useState } from 'react'
import { useFormStatus } from 'react-dom'
import { Loader2, Save, Plus, Trash2, X, Search, Power, AlertTriangle } from 'lucide-react'
import { toast } from 'sonner'
import { DeleteButton } from '@/components/ui/DeleteButton'
import {
  DIAS_SEMANA, FRECUENCIAS, FRECUENCIA_LABEL, PRIORIDADES, PRIORIDAD_META,
  textoDias, textoVentana,
  type FrecuenciaAsignacion, type PrioridadAsignacion,
} from '@/lib/ronda/pasos'
import { alternarAsignacion, eliminarAsignacion, guardarAsignacion, type ActionResult } from './actions'

export interface AsignacionFila {
  id: string
  grupo_id: string
  sede_id: string
  punto_id: string
  plantilla_codigo: string
  frecuencia: FrecuenciaAsignacion
  cada_horas: number | null
  veces_por_periodo: number
  dias: number[]
  ventana_desde: string | null
  ventana_hasta: string | null
  tolerancia_min: number
  evento: string | null
  rol_id: string | null
  cargo_id: string | null
  persona_id: string | null
  prioridad: PrioridadAsignacion
  sla_min: number | null
  vigente_desde: string | null
  vigente_hasta: string | null
  activo: boolean
  observacion: string | null
  contrato: { codigo: string; nombre: string } | null
  sede: { nombre: string } | null
  rol: { nombre: string } | null
  cargo: { nombre: string } | null
}

export interface PuntoOpcion {
  id: string
  codigo: string
  nombre: string
  sede_id: string
  grupo_id: string
}

const INICIAL: ActionResult = {}
const campo = 'w-full rounded-lg border border-gray-200 px-3 py-2 font-body text-sm focus:border-brand-green focus:outline-none disabled:bg-gray-50 disabled:text-gray-500'
const etiqueta = 'font-body text-[11px] font-semibold uppercase tracking-wide text-gray-400'

function Guardar() {
  const { pending } = useFormStatus()
  return (
    <button type="submit" disabled={pending}
      className="inline-flex items-center gap-1.5 rounded-lg bg-brand-green px-3 py-2 font-body text-sm font-semibold text-white disabled:opacity-60">
      {pending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
      Guardar
    </button>
  )
}

export function AsignacionesClient({
  asignaciones, plantillas, contratos, sedes, roles, cargos, puntos, puedeGestionar,
}: {
  asignaciones: AsignacionFila[]
  plantillas: { codigo: string; nombre: string; grupo_id: string | null }[]
  contratos: { id: string; codigo: string; nombre: string }[]
  sedes: { id: string; nombre: string; grupo_id: string | null }[]
  roles: { id: string; nombre: string }[]
  cargos: { id: string; nombre: string }[]
  puntos: PuntoOpcion[] | null
  puedeGestionar: boolean
}) {
  const [estado, accion] = useActionState(guardarAsignacion, INICIAL)
  const [editando, setEditando] = useState<AsignacionFila | null>(null)
  const [creando, setCreando] = useState(false)
  const [busca, setBusca] = useState('')
  const [soloActivas, setSoloActivas] = useState(true)

  useEffect(() => {
    if (estado.error) toast.error(estado.error)
    else if (estado.ok) {
      toast.success('Asignación guardada')
      setEditando(null); setCreando(false)
    }
  }, [estado])

  const filas = useMemo(() => {
    const q = busca.trim().toLowerCase()
    return asignaciones.filter((a) => {
      if (soloActivas && !a.activo) return false
      if (!q) return true
      const punto = puntos?.find((p) => p.id === a.punto_id)
      return `${a.plantilla_codigo} ${a.sede?.nombre ?? ''} ${a.contrato?.codigo ?? ''} ${punto?.codigo ?? ''} ${punto?.nombre ?? ''}`
        .toLowerCase().includes(q)
    })
  }, [asignaciones, busca, soloActivas, puntos])

  const nombrePunto = (id: string) => {
    const p = puntos?.find((x) => x.id === id)
    return p ? `${p.codigo} · ${p.nombre}` : id.slice(0, 8) + '…'
  }

  return (
    <div className="space-y-4">
      {puntos === null && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 font-body text-sm text-amber-800 inline-flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          Los puntos de control todavía no están en la base (los crea la fase de zonas y QR).
          Mientras tanto, la asignación pide el identificador del punto a mano; cuando esa fase
          entre, aquí aparece la lista de puntos sin tocar nada.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[12rem]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input value={busca} onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por tarea, sede o punto…" className={`${campo} pl-8`} />
        </div>
        <label className="inline-flex items-center gap-1.5 font-body text-sm text-gray-600">
          <input type="checkbox" checked={soloActivas} onChange={(e) => setSoloActivas(e.target.checked)}
            className="rounded border-gray-300" />
          Solo activas
        </label>
        {puedeGestionar && (
          <button onClick={() => { setEditando(null); setCreando(true) }}
            className="inline-flex items-center gap-1.5 rounded-lg bg-brand-green px-3 py-2 font-body text-sm font-semibold text-white">
            <Plus className="w-4 h-4" /> Nueva asignación
          </button>
        )}
      </div>

      {(creando || editando) && (
        <Formulario accion={accion} fila={editando} plantillas={plantillas} contratos={contratos}
          sedes={sedes} roles={roles} cargos={cargos} puntos={puntos}
          alCerrar={() => { setEditando(null); setCreando(false) }} />
      )}

      {filas.length === 0 ? (
        <p className="font-body text-sm text-gray-500 rounded-lg border border-gray-200 bg-white p-6">
          No hay asignaciones que coincidan.
        </p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
          <table className="w-full text-left">
            <thead className="bg-gray-50">
              <tr className="font-body text-[11px] uppercase tracking-wide text-gray-500">
                <th className="px-4 py-2.5">Tarea y punto</th>
                <th className="px-4 py-2.5 hidden md:table-cell">Cuándo</th>
                <th className="px-4 py-2.5 hidden lg:table-cell">Quién</th>
                <th className="px-4 py-2.5">Prioridad</th>
                <th className="px-4 py-2.5 hidden lg:table-cell text-right">ANS (min)</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filas.map((a) => (
                <tr key={a.id} className={a.activo ? undefined : 'bg-gray-50/60'}>
                  <td className="px-4 py-3">
                    <p className="font-body text-sm font-semibold text-gray-900">{a.plantilla_codigo}</p>
                    <p className="font-body text-xs text-gray-400">
                      {nombrePunto(a.punto_id)} · {a.sede?.nombre ?? '—'}
                      {a.contrato ? ` · ${a.contrato.codigo}` : ''}
                      {a.activo ? '' : ' · inactiva'}
                    </p>
                  </td>
                  <td className="px-4 py-3 hidden md:table-cell font-body text-sm text-gray-600">
                    {FRECUENCIA_LABEL[a.frecuencia]}
                    {a.cada_horas ? ` (${a.cada_horas} h)` : ''}
                    {a.evento ? ` · ${a.evento}` : ''}
                    <br />
                    <span className="text-xs text-gray-400">
                      {textoDias(a.dias)} · {textoVentana(a.ventana_desde, a.ventana_hasta)}
                      {a.tolerancia_min ? ` · ${a.tolerancia_min} min de tolerancia` : ''}
                    </span>
                  </td>
                  <td className="px-4 py-3 hidden lg:table-cell font-body text-sm text-gray-600">
                    {a.rol?.nombre ?? a.cargo?.nombre
                      ?? (a.persona_id ? 'Una persona' : <span className="text-gray-400">—</span>)}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 font-body text-[11px] font-semibold ${PRIORIDAD_META[a.prioridad].badge}`}>
                      {PRIORIDAD_META[a.prioridad].label}
                    </span>
                  </td>
                  <td className="px-4 py-3 hidden lg:table-cell font-body text-sm text-gray-600 text-right tabular-nums">
                    {a.sla_min ?? '—'}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {puedeGestionar && (
                      <div className="flex items-center justify-end gap-2">
                        <button onClick={() => { setCreando(false); setEditando(a) }}
                          className="font-body text-xs font-semibold text-brand-green hover:underline">
                          Editar
                        </button>
                        <form action={alternarAsignacion}>
                          <input type="hidden" name="id" value={a.id} />
                          <button type="submit" title={a.activo ? 'Desactivar' : 'Activar'}
                            className="inline-flex text-gray-400 hover:text-brand-green">
                            <Power className="w-3.5 h-3.5" />
                          </button>
                        </form>
                        <DeleteButton action={eliminarAsignacion} id={a.id}
                          mensaje="¿Borrar esta asignación? Si solo quieres parar la tarea un rato, mejor desactívala."
                          className="inline-flex text-gray-400 hover:text-red-600">
                          <Trash2 className="w-3.5 h-3.5" />
                        </DeleteButton>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function Formulario({
  accion, fila, plantillas, contratos, sedes, roles, cargos, puntos, alCerrar,
}: {
  accion: (fd: FormData) => void
  fila: AsignacionFila | null
  plantillas: { codigo: string; nombre: string; grupo_id: string | null }[]
  contratos: { id: string; codigo: string; nombre: string }[]
  sedes: { id: string; nombre: string; grupo_id: string | null }[]
  roles: { id: string; nombre: string }[]
  cargos: { id: string; nombre: string }[]
  puntos: PuntoOpcion[] | null
  alCerrar: () => void
}) {
  const [grupo, setGrupo] = useState(fila?.grupo_id ?? '')
  const [frecuencia, setFrecuencia] = useState<FrecuenciaAsignacion>(fila?.frecuencia ?? 'DIARIA')

  // Las sedes y los puntos se filtran por contrato: una asignación cruzada
  // (punto de un contrato, sede de otro) la rechazaría la RLS de todos modos.
  const sedesDelGrupo = grupo ? sedes.filter((s) => s.grupo_id === grupo) : sedes
  const puntosDelGrupo = puntos && grupo ? puntos.filter((p) => p.grupo_id === grupo) : puntos
  // Las plantillas generales valen para todos; las de un contrato, solo para él.
  const plantillasUtiles = plantillas.filter((p) => !p.grupo_id || p.grupo_id === grupo)
  const codigosUnicos = [...new Map(plantillasUtiles.map((p) => [p.codigo, p])).values()]

  return (
    <form action={accion} className="rounded-lg border border-gray-200 bg-white p-4 sm:p-5 space-y-4">
      {fila && <input type="hidden" name="id" value={fila.id} />}
      <div className="flex items-center justify-between">
        <h2 className="font-heading font-semibold text-gray-900">
          {fila ? 'Editar la asignación' : 'Nueva asignación'}
        </h2>
        <button type="button" onClick={alCerrar} className="text-gray-400 hover:text-gray-600">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <label className="space-y-1">
          <span className={etiqueta}>Contrato</span>
          <select name="grupo_id" value={grupo} onChange={(e) => setGrupo(e.target.value)}
            required className={campo}>
            <option value="" disabled>Elige el contrato…</option>
            {contratos.map((c) => <option key={c.id} value={c.id}>{c.codigo} · {c.nombre}</option>)}
          </select>
        </label>
        <label className="space-y-1">
          <span className={etiqueta}>Sede</span>
          <select name="sede_id" defaultValue={fila?.sede_id ?? ''} required className={campo}>
            <option value="" disabled>Elige la sede…</option>
            {sedesDelGrupo.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
          </select>
        </label>
        <label className="space-y-1">
          <span className={etiqueta}>Punto de control</span>
          {puntosDelGrupo
            ? (
              <select name="punto_id" defaultValue={fila?.punto_id ?? ''} required className={campo}>
                <option value="" disabled>Elige el punto…</option>
                {puntosDelGrupo.map((p) => (
                  <option key={p.id} value={p.id}>{p.codigo} · {p.nombre}</option>
                ))}
              </select>
            )
            : (
              <>
                <input name="punto_id" defaultValue={fila?.punto_id ?? ''} required
                  placeholder="Identificador del punto" className={campo} />
                <span className="font-body text-[11px] text-gray-400">
                  Se podrá elegir de una lista cuando entren las zonas y los puntos.
                </span>
              </>
            )}
        </label>
        <label className="space-y-1">
          <span className={etiqueta}>Tarea</span>
          <select name="plantilla_codigo" defaultValue={fila?.plantilla_codigo ?? ''} required
            className={campo}>
            <option value="" disabled>Elige la tarea…</option>
            {codigosUnicos.map((p) => (
              <option key={p.codigo} value={p.codigo}>{p.codigo} · {p.nombre}</option>
            ))}
          </select>
          <span className="font-body text-[11px] text-gray-400">
            Solo las plantillas publicadas. Se guarda el código, no la versión.
          </span>
        </label>
        <label className="space-y-1">
          <span className={etiqueta}>Frecuencia</span>
          <select name="frecuencia" value={frecuencia}
            onChange={(e) => setFrecuencia(e.target.value as FrecuenciaAsignacion)} className={campo}>
            {FRECUENCIAS.map((f) => <option key={f} value={f}>{FRECUENCIA_LABEL[f]}</option>)}
          </select>
        </label>
        {frecuencia === 'CADA_N_HORAS' && (
          <label className="space-y-1">
            <span className={etiqueta}>Cada cuántas horas</span>
            <input name="cada_horas" type="number" min={1} max={168}
              defaultValue={fila?.cada_horas ?? 4} required className={campo} />
          </label>
        )}
        {frecuencia === 'POR_EVENTO' && (
          <label className="space-y-1">
            <span className={etiqueta}>Qué la dispara</span>
            <input name="evento" defaultValue={fila?.evento ?? ''} required
              placeholder="NOVEDAD, PQRS, ALARMA…" className={campo} />
          </label>
        )}
        {frecuencia !== 'POR_EVENTO' && (
          <label className="space-y-1">
            <span className={etiqueta}>Veces por periodo</span>
            <input name="veces_por_periodo" type="number" min={1} max={96}
              defaultValue={fila?.veces_por_periodo ?? 1} className={campo} />
          </label>
        )}
      </div>

      <div className="space-y-2">
        <span className={etiqueta}>Días</span>
        <div className="flex flex-wrap gap-3">
          {DIAS_SEMANA.map((d) => (
            <label key={d.valor} className="inline-flex items-center gap-1.5 font-body text-sm text-gray-700">
              <input type="checkbox" name="dias" value={d.valor}
                defaultChecked={(fila?.dias ?? [1, 2, 3, 4, 5, 6, 7]).includes(d.valor)}
                className="rounded border-gray-300" />
              {d.label}
            </label>
          ))}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="space-y-1">
          <span className={etiqueta}>Ventana desde</span>
          <input name="ventana_desde" type="time"
            defaultValue={fila?.ventana_desde?.slice(0, 5) ?? ''} className={campo} />
        </label>
        <label className="space-y-1">
          <span className={etiqueta}>Ventana hasta</span>
          <input name="ventana_hasta" type="time"
            defaultValue={fila?.ventana_hasta?.slice(0, 5) ?? ''} className={campo} />
          <span className="font-body text-[11px] text-gray-400">
            Si la hora de fin es menor, la ventana pasa de medianoche.
          </span>
        </label>
        <label className="space-y-1">
          <span className={etiqueta}>Tolerancia (min)</span>
          <input name="tolerancia_min" type="number" min={0} max={720}
            defaultValue={fila?.tolerancia_min ?? 30} className={campo} />
        </label>
        <label className="space-y-1">
          <span className={etiqueta}>ANS de la tarea (min)</span>
          <input name="sla_min" type="number" min={1} max={1440}
            defaultValue={fila?.sla_min ?? ''} className={campo} />
        </label>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="space-y-1">
          <span className={etiqueta}>Responsable por rol</span>
          <select name="rol_id" defaultValue={fila?.rol_id ?? ''} className={campo}>
            <option value="">Sin rol</option>
            {roles.map((r) => <option key={r.id} value={r.id}>{r.nombre}</option>)}
          </select>
        </label>
        <label className="space-y-1">
          <span className={etiqueta}>…o por cargo</span>
          <select name="cargo_id" defaultValue={fila?.cargo_id ?? ''} className={campo}>
            <option value="">Sin cargo</option>
            {cargos.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </select>
        </label>
        <label className="space-y-1">
          <span className={etiqueta}>…o una persona (documento)</span>
          <input name="persona_documento" placeholder="Número de documento" className={campo} />
          <span className="font-body text-[11px] text-gray-400">
            {fila?.persona_id ? 'Ya tiene una persona asignada; escribe otro documento para cambiarla.' : 'Opcional.'}
          </span>
        </label>
        <label className="space-y-1">
          <span className={etiqueta}>Prioridad</span>
          <select name="prioridad" defaultValue={fila?.prioridad ?? 'MEDIA'} className={campo}>
            {PRIORIDADES.map((p) => <option key={p} value={p}>{PRIORIDAD_META[p].label}</option>)}
          </select>
        </label>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="space-y-1">
          <span className={etiqueta}>Vigente desde</span>
          <input name="vigente_desde" type="date" defaultValue={fila?.vigente_desde ?? ''} className={campo} />
        </label>
        <label className="space-y-1">
          <span className={etiqueta}>Vigente hasta</span>
          <input name="vigente_hasta" type="date" defaultValue={fila?.vigente_hasta ?? ''} className={campo} />
        </label>
        <label className="space-y-1 sm:col-span-2">
          <span className={etiqueta}>Observación</span>
          <input name="observacion" defaultValue={fila?.observacion ?? ''} className={campo} />
        </label>
      </div>

      <div className="flex items-center justify-between">
        <label className="inline-flex items-center gap-2 font-body text-sm text-gray-700">
          <input type="checkbox" name="activo" defaultChecked={fila?.activo ?? true}
            className="rounded border-gray-300" />
          Activa
        </label>
        <Guardar />
      </div>
    </form>
  )
}

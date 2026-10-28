'use client'

import { useMemo, useState, useTransition } from 'react'
import {
  ArrowDown, ArrowUp, ChevronDown, ChevronRight, Clock, MapPin, Plus, Trash2, X,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  agregarParada, borrarRuta, cambiarEstadoRuta, crearRuta, ordenarParadas, quitarParada,
  type ActionResult,
} from './actions'

export interface RutaFila {
  id: string
  codigo: string
  grupo_id: string
  sede_id: string
  nombre: string
  fecha: string
  persona_id: string | null
  turno_id: string | null
  estado: 'PLANEADA' | 'EN_CURSO' | 'COMPLETADA' | 'CANCELADA'
  hora_inicio: string | null
  iniciado_at: string | null
  finalizado_at: string | null
  observacion: string | null
  activo: boolean
  contrato: { codigo: string; nombre: string } | null
  sede: { nombre: string } | null
  persona: { nombres: string | null; apellidos: string | null } | null
}

export interface ParadaFila {
  id: string
  ruta_id: string
  punto_id: string
  numero_parada: number
  hora_estimada: string | null
  tolerancia_min: number
  estado: 'PENDIENTE' | 'EN_CURSO' | 'CUMPLIDA' | 'OMITIDA'
  llegado_at: string | null
  visita_id: string | null
  observacion: string | null
  punto: { codigo: string; nombre: string; piso: string | null } | null
}

export interface PuntoOpcion {
  id: string
  codigo: string
  nombre: string
  sede_id: string
  grupo_id: string
  piso: string | null
}

/** `fecha` es un DATE. Se corta a los 10 primeros caracteres antes de parsear:
 *  llega como `2026-10-28`, pero si alguna vez llegara con hora, concatenarle
 *  `T00:00:00` daría «Invalid Date». Y se fuerza la hora para que el navegador
 *  no reste la zona horaria y muestre el día anterior. */
function fechaCorta(fecha: string): string {
  const d = new Date(`${String(fecha).slice(0, 10)}T00:00:00`)
  return Number.isNaN(d.getTime()) ? String(fecha) : d.toLocaleDateString('es-CO')
}

const campo = 'w-full rounded-lg border border-gray-200 px-3 py-2 font-body text-sm focus:border-brand-green focus:outline-none'
const etiqueta = 'font-body text-[11px] font-semibold uppercase tracking-wide text-gray-400'

const COLOR_ESTADO: Record<string, string> = {
  PLANEADA: 'bg-gray-100 text-gray-700',
  EN_CURSO: 'bg-blue-100 text-blue-800',
  COMPLETADA: 'bg-emerald-100 text-emerald-800',
  CANCELADA: 'bg-red-100 text-red-800',
}
const COLOR_PARADA: Record<string, string> = {
  PENDIENTE: 'bg-gray-100 text-gray-600',
  EN_CURSO: 'bg-blue-100 text-blue-800',
  CUMPLIDA: 'bg-emerald-100 text-emerald-800',
  OMITIDA: 'bg-purple-100 text-purple-800',
}

export function RutasClient({
  rutas, paradas, contratos, sedes, puntos, puedeGestionar,
}: {
  rutas: RutaFila[]
  paradas: ParadaFila[]
  contratos: { id: string; codigo: string; nombre: string }[]
  sedes: { id: string; nombre: string; grupo_id: string | null }[]
  puntos: PuntoOpcion[]
  puedeGestionar: boolean
}) {
  const [abierta, setAbierta] = useState<string | null>(rutas[0]?.id ?? null)
  const [nueva, setNueva] = useState(false)
  const [grupoNueva, setGrupoNueva] = useState('')
  const [pendiente, empezar] = useTransition()

  const porRuta = useMemo(() => {
    const m = new Map<string, ParadaFila[]>()
    for (const p of paradas) {
      const lista = m.get(p.ruta_id) ?? []
      lista.push(p)
      m.set(p.ruta_id, lista)
    }
    for (const lista of m.values()) lista.sort((a, b) => a.numero_parada - b.numero_parada)
    return m
  }, [paradas])

  function correr(fn: () => Promise<ActionResult>, exito: string) {
    empezar(async () => {
      const r = await fn()
      if (r.error) toast.error(r.error)
      else toast.success(exito)
    })
  }

  /** Mueve una parada una posición y manda la lista COMPLETA a la RPC, que es
   *  la única que puede renumerar sin chocar con la unicidad del número. */
  function mover(ruta: RutaFila, id: string, delta: number) {
    const lista = (porRuta.get(ruta.id) ?? []).map((p) => p.id)
    const i = lista.indexOf(id)
    const j = i + delta
    if (i < 0 || j < 0 || j >= lista.length) return
    ;[lista[i], lista[j]] = [lista[j], lista[i]]
    correr(() => ordenarParadas(ruta.id, lista), 'Orden de las paradas actualizado')
  }

  const sedesDelGrupo = sedes.filter((s) => !grupoNueva || s.grupo_id === grupoNueva)

  return (
    <div className="space-y-4">
      {puedeGestionar && (
        <div>
          {nueva ? (
            <form
              action={(fd) => correr(() => crearRuta(fd), 'Ruta creada')}
              className="space-y-3 rounded-xl border border-gray-200 bg-white p-4"
            >
              <div className="flex items-center justify-between">
                <h2 className="font-heading text-sm font-bold text-gray-900">Nueva ruta</h2>
                <button type="button" onClick={() => setNueva(false)} className="text-gray-400">
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <label className="space-y-1">
                  <span className={etiqueta}>Contrato</span>
                  <select name="grupo_id" required className={campo}
                    value={grupoNueva} onChange={(e) => setGrupoNueva(e.target.value)}>
                    <option value="">Elige…</option>
                    {contratos.map((c) => (
                      <option key={c.id} value={c.id}>{c.codigo} · {c.nombre}</option>
                    ))}
                  </select>
                </label>
                <label className="space-y-1">
                  <span className={etiqueta}>Sede</span>
                  <select name="sede_id" required className={campo}>
                    <option value="">Elige…</option>
                    {sedesDelGrupo.map((s) => (
                      <option key={s.id} value={s.id}>{s.nombre}</option>
                    ))}
                  </select>
                </label>
                <label className="space-y-1">
                  <span className={etiqueta}>Nombre</span>
                  <input name="nombre" required maxLength={200} className={campo}
                    placeholder="Ronda de la mañana" />
                </label>
                <label className="space-y-1">
                  <span className={etiqueta}>Fecha</span>
                  <input name="fecha" type="date" className={campo}
                    defaultValue={new Date().toISOString().slice(0, 10)} />
                </label>
                <label className="space-y-1">
                  <span className={etiqueta}>Hora de inicio</span>
                  <input name="hora_inicio" type="time" className={campo} />
                </label>
                <label className="space-y-1 sm:col-span-2 lg:col-span-1">
                  <span className={etiqueta}>Observación</span>
                  <input name="observacion" maxLength={300} className={campo} />
                </label>
              </div>
              <p className="text-xs text-gray-500">
                La persona que la hace se puede asignar después: una ruta se planea antes de saber
                a quién le toca.
              </p>
              <button type="submit" disabled={pendiente}
                className="rounded-lg bg-brand-green px-3 py-2 font-body text-sm font-semibold text-white disabled:opacity-60">
                Crear la ruta
              </button>
            </form>
          ) : (
            <button type="button" onClick={() => setNueva(true)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-brand-green px-3 py-2 font-body text-sm font-semibold text-white">
              <Plus className="h-4 w-4" /> Nueva ruta
            </button>
          )}
        </div>
      )}

      {rutas.length === 0 ? (
        <p className="rounded-xl border border-gray-200 bg-white p-6 text-center text-sm text-gray-500">
          Todavía no hay rutas de ronda.
        </p>
      ) : (
        <ul className="space-y-2">
          {rutas.map((r) => {
            const lista = porRuta.get(r.id) ?? []
            const esta = abierta === r.id
            const nombrePersona = r.persona
              ? `${r.persona.nombres ?? ''} ${r.persona.apellidos ?? ''}`.trim()
              : null
            const puntosDeSede = puntos.filter(
              (p) => p.sede_id === r.sede_id && !lista.some((x) => x.punto_id === p.id))
            return (
              <li key={r.id} className="overflow-hidden rounded-xl border border-gray-200 bg-white">
                <button type="button" onClick={() => setAbierta(esta ? null : r.id)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-gray-50">
                  {esta ? <ChevronDown className="h-4 w-4 shrink-0 text-gray-400" />
                        : <ChevronRight className="h-4 w-4 shrink-0 text-gray-400" />}
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs text-gray-500">{r.codigo}</span>
                      <span className="font-heading text-sm font-bold text-gray-900">{r.nombre}</span>
                      <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${COLOR_ESTADO[r.estado]}`}>
                        {r.estado.replace('_', ' ')}
                      </span>
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-gray-500">
                      {r.sede?.nombre ?? 'Sin sede'}
                      {' · '}{fechaCorta(r.fecha)}
                      {r.hora_inicio && ` · ${r.hora_inicio.slice(0, 5)}`}
                      {' · '}{lista.length} {lista.length === 1 ? 'parada' : 'paradas'}
                      {nombrePersona && ` · ${nombrePersona}`}
                      {!nombrePersona && ' · sin asignar'}
                    </span>
                  </span>
                </button>

                {esta && (
                  <div className="space-y-3 border-t border-gray-100 px-4 py-3">
                    {lista.length === 0 ? (
                      <p className="text-sm text-gray-500">
                        Esta ruta no tiene paradas todavía.
                      </p>
                    ) : (
                      <ol className="space-y-1.5">
                        {lista.map((p, i) => (
                          <li key={p.id}
                            className="flex items-center gap-2 rounded-lg border border-gray-100 px-2.5 py-2">
                            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border-2 border-indigo-400 text-xs font-bold text-indigo-600">
                              {p.numero_parada}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-semibold text-gray-900">
                                {p.punto?.codigo} · {p.punto?.nombre}
                              </span>
                              <span className="block text-xs text-gray-500">
                                {p.punto?.piso && `Piso ${p.punto.piso} · `}
                                {p.hora_estimada
                                  ? `${p.hora_estimada.slice(0, 5)} (±${p.tolerancia_min} min)`
                                  : 'sin hora estimada'}
                                {p.llegado_at && ` · llegó ${new Date(p.llegado_at).toLocaleTimeString('es-CO',
                                  { hour: '2-digit', minute: '2-digit' })}`}
                              </span>
                            </span>
                            <span className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] font-semibold ${COLOR_PARADA[p.estado]}`}>
                              {p.estado.replace('_', ' ')}
                            </span>
                            {puedeGestionar && (
                              <span className="flex shrink-0 items-center gap-0.5">
                                <button type="button" onClick={() => mover(r, p.id, -1)}
                                  disabled={i === 0 || pendiente}
                                  className="rounded p-1 text-gray-400 hover:bg-gray-100 disabled:opacity-30"
                                  aria-label="Subir">
                                  <ArrowUp className="h-3.5 w-3.5" />
                                </button>
                                <button type="button" onClick={() => mover(r, p.id, 1)}
                                  disabled={i === lista.length - 1 || pendiente}
                                  className="rounded p-1 text-gray-400 hover:bg-gray-100 disabled:opacity-30"
                                  aria-label="Bajar">
                                  <ArrowDown className="h-3.5 w-3.5" />
                                </button>
                                <button type="button" disabled={pendiente}
                                  onClick={() => {
                                    if (!window.confirm(
                                      `¿Quitar la parada ${p.numero_parada} (${p.punto?.nombre ?? ''})?`)) return
                                    correr(() => quitarParada(p.id), 'Parada quitada')
                                  }}
                                  className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-30"
                                  aria-label="Quitar la parada">
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              </span>
                            )}
                          </li>
                        ))}
                      </ol>
                    )}

                    {puedeGestionar && (
                      <form
                        action={(fd) => correr(() => agregarParada(fd), 'Parada agregada')}
                        className="flex flex-wrap items-end gap-2 rounded-lg bg-gray-50 p-2.5"
                      >
                        <input type="hidden" name="ruta_id" value={r.id} />
                        <label className="min-w-[14rem] flex-1 space-y-1">
                          <span className={etiqueta}>Agregar un punto de control</span>
                          <select name="punto_id" required className={campo}>
                            <option value="">Elige un punto de la sede…</option>
                            {puntosDeSede.map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.codigo} · {p.nombre}{p.piso ? ` (piso ${p.piso})` : ''}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="space-y-1">
                          <span className={etiqueta}>Hora estimada</span>
                          <input name="hora_estimada" type="time" className={campo} />
                        </label>
                        <button type="submit" disabled={pendiente || puntosDeSede.length === 0}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-gray-900 px-3 py-2 font-body text-sm font-semibold text-white disabled:opacity-40">
                          <MapPin className="h-4 w-4" /> Agregar
                        </button>
                        {puntosDeSede.length === 0 && (
                          <p className="w-full text-xs text-gray-500">
                            No quedan puntos de esta sede sin asignar a la ruta.
                          </p>
                        )}
                      </form>
                    )}

                    {puedeGestionar && (
                      <div className="flex flex-wrap items-center gap-2 border-t border-gray-100 pt-3">
                        <span className={etiqueta}>Estado de la ruta</span>
                        {(['PLANEADA', 'EN_CURSO', 'COMPLETADA', 'CANCELADA'] as const)
                          .filter((e) => e !== r.estado)
                          .map((e) => (
                            <button key={e} type="button" disabled={pendiente}
                              onClick={() => correr(() => cambiarEstadoRuta(r.id, e),
                                `Ruta marcada como ${e.replace('_', ' ').toLowerCase()}`)}
                              className="rounded-lg border border-gray-200 px-2.5 py-1 text-xs font-semibold text-gray-700 disabled:opacity-50">
                              {e.replace('_', ' ')}
                            </button>
                          ))}
                        <button type="button" disabled={pendiente}
                          onClick={() => {
                            if (!window.confirm(
                              `¿Borrar la ruta ${r.codigo} y sus ${lista.length} paradas?`)) return
                            correr(() => borrarRuta(r.id), 'Ruta borrada')
                          }}
                          className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-red-200 px-2.5 py-1 text-xs font-semibold text-red-700 disabled:opacity-50">
                          <Trash2 className="h-3.5 w-3.5" /> Borrar la ruta
                        </button>
                      </div>
                    )}

                    {r.observacion && (
                      <p className="flex items-start gap-1.5 text-xs text-gray-500">
                        <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {r.observacion}
                      </p>
                    )}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

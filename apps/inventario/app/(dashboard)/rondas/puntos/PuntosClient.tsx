'use client'

// Listado y edición de zonas y puntos de control (F2 del módulo de Puntos QR).
//
// Lo único que esta pantalla hace y no es "un CRUD más" es capturar la
// ubicación: el punto se levanta parado frente a la pared donde va el QR, y lo
// que se guarda es la coordenada CON la precisión que el GPS reportó en ese
// momento. Si la precisión fue peor que el radio de la geocerca, la geocerca de
// ese punto no significa nada, y la pantalla lo dice en vez de esconderlo.

import { useActionState, useEffect, useMemo, useState } from 'react'
import { useFormStatus } from 'react-dom'
import {
  Loader2, Save, Plus, X, Crosshair, QrCode, Pencil, Trash2,
  AlertTriangle, Layers, MapPin, Search,
} from 'lucide-react'
import { toast } from 'sonner'
import Link from 'next/link'
import { DeleteButton } from '@/components/ui/DeleteButton'
import {
  DIAS_SEMANA, ESTADOS_PUNTO, ESTADO_PUNTO, calidadGps, formatearManual, textoHorario,
  type EstadoPunto,
} from '@/lib/puntos-qr'
import {
  eliminarPunto, eliminarZona, guardarPunto, guardarZona, type ActionResult,
} from './actions'

export interface SedeOpcion {
  id: string; nombre: string; ciudad: string | null
  contrato: string; contratoNombre: string; contratoEstado: string | null
}
export interface ZonaFila {
  id: string; sedeId: string; codigo: string; nombre: string
  piso: string | null; orden: number; activo: boolean; puntos: number
}
export interface PuntoFila {
  id: string; sedeId: string; sedeNombre: string
  zonaId: string | null; zonaNombre: string | null
  codigo: string; nombre: string; descripcion: string | null; piso: string | null
  lat: number | null; lng: number | null; precisionMetros: number | null
  geocercaMetros: number; exigeGeocerca: boolean
  horarioDias: number[]; horarioDesde: string | null; horarioHasta: string | null
  orden: number; estado: EstadoPunto
  qrVersiones: number
  qrActivo: { id: string; version: number; codigoManual: string } | null
}

const INICIAL: ActionResult = {}
const campo = 'w-full rounded-lg border border-gray-200 px-3 py-2 font-body text-sm focus:border-brand-green focus:outline-none disabled:bg-gray-50 disabled:text-gray-500'
const etiqueta = 'font-body text-[11px] font-semibold uppercase tracking-wide text-gray-400'

function Guardar({ label = 'Guardar' }: { label?: string }) {
  const { pending } = useFormStatus()
  return (
    <button type="submit" disabled={pending}
      className="inline-flex items-center gap-1.5 rounded-lg bg-brand-green px-3 py-2 font-body text-sm font-semibold text-white disabled:opacity-60">
      {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
      {label}
    </button>
  )
}

function useAviso(estado: ActionResult, exito: string, alTerminar?: () => void) {
  useEffect(() => {
    if (estado.error) toast.error(estado.error)
    else if (estado.ok) { toast.success(exito); alTerminar?.() }
    // `alTerminar` cierra el formulario; no entra en las dependencias para no
    // reabrirlo en cada render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado, exito])
}

export function PuntosClient({
  sedes, zonas, puntos, puedeGestionar,
}: { sedes: SedeOpcion[]; zonas: ZonaFila[]; puntos: PuntoFila[]; puedeGestionar: boolean }) {
  const [sedeFiltro, setSedeFiltro] = useState('')
  const [estadoFiltro, setEstadoFiltro] = useState('')
  const [busqueda, setBusqueda] = useState('')
  const [editando, setEditando] = useState<PuntoFila | 'nuevo' | null>(null)
  const [editandoZona, setEditandoZona] = useState<ZonaFila | 'nueva' | null>(null)

  const filtrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase()
    return puntos.filter((p) =>
      (!sedeFiltro || p.sedeId === sedeFiltro)
      && (!estadoFiltro || p.estado === estadoFiltro)
      && (!q || p.nombre.toLowerCase().includes(q) || p.codigo.toLowerCase().includes(q)
          || p.sedeNombre.toLowerCase().includes(q)
          || (p.zonaNombre ?? '').toLowerCase().includes(q)))
  }, [puntos, sedeFiltro, estadoFiltro, busqueda])

  const zonasFiltradas = useMemo(
    () => zonas.filter((z) => !sedeFiltro || z.sedeId === sedeFiltro),
    [zonas, sedeFiltro],
  )

  return (
    <div className="space-y-5">
      {/* Filtros */}
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-[180px] flex-1">
          <label className={etiqueta}>Buscar</label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input value={busqueda} onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Punto, código, sede o zona"
              className={campo + ' pl-8'} />
          </div>
        </div>
        <div>
          <label className={etiqueta}>Sede</label>
          <select value={sedeFiltro} onChange={(e) => setSedeFiltro(e.target.value)} className={campo}>
            <option value="">Todas las sedes</option>
            {sedes.map((s) => (
              <option key={s.id} value={s.id}>{s.contrato} · {s.nombre}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={etiqueta}>Estado</label>
          <select value={estadoFiltro} onChange={(e) => setEstadoFiltro(e.target.value)} className={campo}>
            <option value="">Todos</option>
            {ESTADOS_PUNTO.map((e) => (
              <option key={e} value={e}>{ESTADO_PUNTO[e].label}</option>
            ))}
          </select>
        </div>
        {puedeGestionar && (
          <div className="flex gap-2">
            <button onClick={() => setEditandoZona('nueva')}
              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 font-body text-sm font-medium text-gray-600 hover:bg-gray-50">
              <Layers className="h-4 w-4" /> Nueva zona
            </button>
            <button onClick={() => setEditando('nuevo')}
              className="inline-flex items-center gap-1.5 rounded-lg bg-brand-green px-3 py-2 font-body text-sm font-semibold text-white hover:bg-brand-green-dark">
              <Plus className="h-4 w-4" /> Nuevo punto
            </button>
          </div>
        )}
      </div>

      {/* Zonas */}
      <section className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <header className="flex items-center justify-between border-b border-gray-100 bg-gray-50 px-4 py-2.5">
          <h2 className="font-heading flex items-center gap-1.5 text-sm font-semibold text-gray-700">
            <Layers className="h-4 w-4 text-brand-green" /> Zonas
          </h2>
          <span className="font-body text-xs text-gray-400">{zonasFiltradas.length}</span>
        </header>
        {zonasFiltradas.length === 0 ? (
          <p className="font-body p-4 text-sm text-gray-500">
            No hay zonas. Una zona es un piso, una torre o un área de la sede; los puntos se
            agrupan en ellas para recorrerlos en orden.
          </p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {zonasFiltradas.map((z) => (
              <li key={z.id} className="flex items-center gap-3 px-4 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="font-body truncate text-sm font-medium text-gray-900">
                    {z.nombre}
                    {!z.activo && (
                      <span className="ml-2 rounded-full bg-gray-100 px-2 py-0.5 font-body text-[11px] text-gray-500">
                        Inactiva
                      </span>
                    )}
                  </p>
                  <p className="font-body text-xs text-gray-400">
                    {z.codigo}
                    {z.piso ? ` · ${z.piso}` : ''}
                    {` · ${sedes.find((s) => s.id === z.sedeId)?.nombre ?? 'sede desconocida'}`}
                    {` · ${z.puntos} puntos`}
                  </p>
                </div>
                {puedeGestionar && (
                  <div className="flex items-center gap-1">
                    <button onClick={() => setEditandoZona(z)}
                      className="rounded p-1.5 text-gray-400 hover:bg-gray-50 hover:text-brand-green"
                      title="Editar zona">
                      <Pencil className="h-4 w-4" />
                    </button>
                    <DeleteButton
                      action={eliminarZona} id={z.id}
                      mensaje={`¿Eliminar la zona "${z.nombre}"? Sus ${z.puntos} puntos quedan sin zona, pero no se borran.`}
                      className="rounded p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600">
                      <Trash2 className="h-4 w-4" />
                    </DeleteButton>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Puntos */}
      <section className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <header className="flex items-center justify-between border-b border-gray-100 bg-gray-50 px-4 py-2.5">
          <h2 className="font-heading flex items-center gap-1.5 text-sm font-semibold text-gray-700">
            <MapPin className="h-4 w-4 text-brand-green" /> Puntos de control
          </h2>
          <span className="font-body text-xs text-gray-400">{filtrados.length}</span>
        </header>

        {filtrados.length === 0 ? (
          <p className="font-body p-4 text-sm text-gray-500">
            No hay puntos con ese filtro.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="bg-white">
                <tr className="font-body text-[11px] uppercase tracking-wide text-gray-500">
                  <th className="px-4 py-2.5">Punto</th>
                  <th className="hidden px-4 py-2.5 md:table-cell">Sede y zona</th>
                  <th className="hidden px-4 py-2.5 lg:table-cell">Ubicación</th>
                  <th className="hidden px-4 py-2.5 xl:table-cell">Horario</th>
                  <th className="px-4 py-2.5">Estado</th>
                  <th className="px-4 py-2.5">QR</th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtrados.map((p) => {
                  const gps = calidadGps(p.precisionMetros, p.geocercaMetros)
                  const meta = ESTADO_PUNTO[p.estado]
                  const apagado = p.estado === 'RETIRADO' || p.estado === 'SUSPENDIDO'
                  return (
                    <tr key={p.id} className={apagado ? 'bg-gray-50/60' : undefined}>
                      <td className="px-4 py-3">
                        <p className="font-body text-sm font-semibold text-gray-900">{p.nombre}</p>
                        <p className="font-body text-xs text-gray-400">{p.codigo}</p>
                      </td>
                      <td className="font-body hidden px-4 py-3 text-sm text-gray-600 md:table-cell">
                        {p.sedeNombre}
                        <span className="block text-xs text-gray-400">
                          {[p.zonaNombre, p.piso].filter(Boolean).join(' · ') || 'Sin zona'}
                        </span>
                      </td>
                      <td className="font-body hidden px-4 py-3 text-sm text-gray-600 lg:table-cell">
                        {p.lat === null ? (
                          <span className="inline-flex items-center gap-1 text-amber-700">
                            <AlertTriangle className="h-3.5 w-3.5" /> Sin capturar
                          </span>
                        ) : (
                          <>
                            <span className="tabular-nums">
                              {p.lat.toFixed(5)}, {p.lng?.toFixed(5)}
                            </span>
                            <span className={`block text-xs ${gps.alerta ? 'text-amber-700' : 'text-gray-400'}`}>
                              {gps.texto} · geocerca {p.geocercaMetros} m
                              {!p.exigeGeocerca && ' (no exigida)'}
                            </span>
                          </>
                        )}
                      </td>
                      <td className="font-body hidden px-4 py-3 text-sm text-gray-600 xl:table-cell">
                        {textoHorario(p.horarioDias, p.horarioDesde, p.horarioHasta)}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`font-body inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${meta.badge}`}>
                          {meta.label}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {p.qrActivo ? (
                          <Link href={`/rondas/qr?punto=${p.id}`}
                            className="font-mono inline-flex items-center gap-1.5 text-xs font-semibold text-brand-green hover:underline">
                            <QrCode className="h-3.5 w-3.5" />
                            {formatearManual(p.qrActivo.codigoManual)}
                            <span className="font-body text-gray-400">v{p.qrActivo.version}</span>
                          </Link>
                        ) : (
                          <Link href={`/rondas/qr?punto=${p.id}`}
                            className="font-body text-xs text-gray-400 hover:text-brand-green hover:underline">
                            Sin emitir
                          </Link>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {puedeGestionar && (
                          <div className="flex items-center justify-end gap-1">
                            <button onClick={() => setEditando(p)}
                              className="rounded p-1.5 text-gray-400 hover:bg-gray-50 hover:text-brand-green"
                              title="Editar punto">
                              <Pencil className="h-4 w-4" />
                            </button>
                            <DeleteButton
                              action={eliminarPunto} id={p.id}
                              mensaje={p.qrVersiones > 0
                                ? `"${p.nombre}" tiene ${p.qrVersiones} códigos QR emitidos, así que no se borra: queda RETIRADO y sus placas dejan de abrir. ¿Continuar?`
                                : `¿Eliminar el punto "${p.nombre}"?`}
                              className="rounded p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600">
                              <Trash2 className="h-4 w-4" />
                            </DeleteButton>
                          </div>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {editando && (
        <EditorPunto
          punto={editando === 'nuevo' ? null : editando}
          sedes={sedes} zonas={zonas}
          cerrar={() => setEditando(null)}
        />
      )}
      {editandoZona && (
        <EditorZona
          zona={editandoZona === 'nueva' ? null : editandoZona}
          sedes={sedes}
          cerrar={() => setEditandoZona(null)}
        />
      )}
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────────
// Editor de punto
// ──────────────────────────────────────────────────────────────────────────────

function EditorPunto({
  punto, sedes, zonas, cerrar,
}: { punto: PuntoFila | null; sedes: SedeOpcion[]; zonas: ZonaFila[]; cerrar: () => void }) {
  const [estado, accion] = useActionState(guardarPunto, INICIAL)
  useAviso(estado, punto ? 'Punto guardado' : 'Punto creado', cerrar)

  const [sedeId, setSedeId] = useState(punto?.sedeId ?? sedes[0]?.id ?? '')
  const [coord, setCoord] = useState<{ lat: number; lng: number; precision: number } | null>(
    punto?.lat !== null && punto?.lat !== undefined && punto?.lng !== null && punto?.lng !== undefined
      ? { lat: punto.lat, lng: punto.lng, precision: punto.precisionMetros ?? 0 }
      : null,
  )
  const [capturando, setCapturando] = useState(false)
  const [geocerca, setGeocerca] = useState(punto?.geocercaMetros ?? 30)

  const zonasDeSede = zonas.filter((z) => z.sedeId === sedeId)
  const gps = coord ? calidadGps(coord.precision, geocerca) : null

  function capturar() {
    if (!('geolocation' in navigator)) {
      toast.error('Este dispositivo no permite capturar la ubicación.')
      return
    }
    setCapturando(true)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCapturando(false)
        setCoord({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          // `accuracy` viene en metros y es el radio del 68 % de confianza. Se
          // guarda tal cual: es el dato que dice si la geocerca de este punto
          // se puede creer.
          precision: pos.coords.accuracy,
        })
        toast.success(`Ubicación capturada con ±${Math.round(pos.coords.accuracy)} m`)
      },
      (err) => {
        setCapturando(false)
        toast.error(err.code === err.PERMISSION_DENIED
          ? 'No diste permiso de ubicación al navegador.'
          : 'No se pudo obtener la ubicación. Sal al aire libre e intenta de nuevo.')
      },
      // Sin caché y con el GPS de verdad: una posición vieja o deducida de la
      // red daría una geocerca que no sirve.
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 },
    )
  }

  return (
    <Modal titulo={punto ? `Editar ${punto.nombre}` : 'Nuevo punto de control'} cerrar={cerrar}>
      <form action={accion} className="space-y-4">
        {punto && <input type="hidden" name="id" value={punto.id} />}
        <input type="hidden" name="lat" value={coord?.lat ?? ''} />
        <input type="hidden" name="lng" value={coord?.lng ?? ''} />
        <input type="hidden" name="precision_metros" value={coord?.precision ?? ''} />

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className={etiqueta}>Sede *</label>
            <select name="sede_id" value={sedeId} onChange={(e) => setSedeId(e.target.value)}
              required className={campo}>
              {sedes.map((s) => (
                <option key={s.id} value={s.id}>{s.contrato} · {s.nombre}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={etiqueta}>Zona</label>
            <select name="zona_id" defaultValue={punto?.zonaId ?? ''} className={campo}>
              <option value="">Sin zona</option>
              {zonasDeSede.map((z) => (
                <option key={z.id} value={z.id}>{z.nombre}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={etiqueta}>Código corto *</label>
            <input name="codigo" defaultValue={punto?.codigo ?? ''} required maxLength={20}
              placeholder="P-001" className={campo + ' font-mono uppercase'} />
            <p className="font-body mt-1 text-[11px] text-gray-400">
              Único por sede. Es el que la operación usa para nombrar el punto.
            </p>
          </div>
          <div>
            <label className={etiqueta}>Orden de recorrido</label>
            <input name="orden" type="number" defaultValue={punto?.orden ?? 0} className={campo} />
          </div>
          <div className="sm:col-span-2">
            <label className={etiqueta}>Nombre *</label>
            <input name="nombre" defaultValue={punto?.nombre ?? ''} required maxLength={200}
              placeholder="Portería principal" className={campo} />
          </div>
          <div className="sm:col-span-2">
            <label className={etiqueta}>Cómo llegar</label>
            <textarea name="descripcion" defaultValue={punto?.descripcion ?? ''} rows={2}
              placeholder="Al entrar, a la derecha del ascensor" className={campo} />
          </div>
          <div>
            <label className={etiqueta}>Piso o nivel</label>
            <input name="piso" defaultValue={punto?.piso ?? ''} maxLength={20}
              placeholder="SÓTANO 2" className={campo} />
          </div>
          <div>
            <label className={etiqueta}>Estado</label>
            <select name="estado" defaultValue={punto?.estado ?? 'BORRADOR'} className={campo}>
              {ESTADOS_PUNTO.map((e) => (
                <option key={e} value={e}>{ESTADO_PUNTO[e].label}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Ubicación */}
        <div className="rounded-lg border border-gray-200 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className={etiqueta}>Ubicación del punto</p>
            <button type="button" onClick={capturar} disabled={capturando}
              className="inline-flex items-center gap-1.5 rounded-lg border border-brand-green px-2.5 py-1.5 font-body text-xs font-semibold text-brand-green hover:bg-brand-green-bg disabled:opacity-60">
              {capturando
                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                : <Crosshair className="h-3.5 w-3.5" />}
              {coord ? 'Volver a capturar' : 'Capturar aquí'}
            </button>
          </div>
          {coord ? (
            <>
              <p className="font-mono mt-2 text-sm text-gray-800 tabular-nums">
                {coord.lat.toFixed(6)}, {coord.lng.toFixed(6)}
              </p>
              <p className={`font-body mt-0.5 text-xs ${gps?.alerta ? 'text-amber-700' : 'text-gray-500'}`}>
                Precisión {gps?.texto}
              </p>
              {gps?.alerta && (
                <p className="font-body mt-1 flex items-start gap-1 text-xs text-amber-700">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  Con esta precisión la geocerca no distingue si alguien estuvo en el punto.
                  Vuelve a capturar al aire libre, o sube el radio, o desactiva la geocerca
                  para este punto si está en un sótano sin señal.
                </p>
              )}
              <button type="button" onClick={() => setCoord(null)}
                className="font-body mt-2 text-xs text-gray-400 hover:text-red-600">
                Quitar la ubicación
              </button>
            </>
          ) : (
            <p className="font-body mt-2 text-xs text-gray-500">
              Captúrala parado frente al lugar donde va a quedar la placa. Se guarda la
              coordenada y la precisión que reportó el GPS en ese momento.
            </p>
          )}

          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div>
              <label className={etiqueta}>Radio de la geocerca (m)</label>
              <input name="geocerca_metros" type="number" min={5} max={2000}
                value={geocerca} onChange={(e) => setGeocerca(Number(e.target.value))}
                className={campo} />
            </div>
            <label className="flex items-end gap-2 pb-2">
              <input type="checkbox" name="exige_geocerca"
                defaultChecked={punto?.exigeGeocerca ?? true}
                className="h-4 w-4 rounded border-gray-300 text-brand-green" />
              <span className="font-body text-sm text-gray-700">
                Exigir la geocerca
                <span className="block text-[11px] text-gray-400">
                  Desactívala en sótanos y cuartos técnicos sin señal.
                </span>
              </span>
            </label>
          </div>
        </div>

        {/* Horario */}
        <div className="rounded-lg border border-gray-200 p-3">
          <p className={etiqueta}>Cuándo aplica el punto</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {DIAS_SEMANA.map((d) => (
              <label key={d.n}
                className="flex cursor-pointer items-center gap-1 rounded-lg border border-gray-200 px-2 py-1">
                <input type="checkbox" name="horario_dias" value={d.n}
                  defaultChecked={(punto?.horarioDias ?? [1, 2, 3, 4, 5, 6, 7]).includes(d.n)}
                  className="h-3.5 w-3.5 rounded border-gray-300 text-brand-green" />
                <span className="font-body text-xs text-gray-700">{d.corto}</span>
              </label>
            ))}
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div>
              <label className={etiqueta}>Desde</label>
              <input name="horario_desde" type="time"
                defaultValue={punto?.horarioDesde?.slice(0, 5) ?? ''} className={campo} />
            </div>
            <div>
              <label className={etiqueta}>Hasta</label>
              <input name="horario_hasta" type="time"
                defaultValue={punto?.horarioHasta?.slice(0, 5) ?? ''} className={campo} />
            </div>
          </div>
          <p className="font-body mt-1.5 text-[11px] text-gray-400">
            Vacío = aplica a toda hora. Si la hora de fin es menor que la de inicio, el punto
            aplica de noche, cruzando la medianoche.
          </p>
        </div>

        <div className="flex items-center justify-end gap-2 pt-1">
          <button type="button" onClick={cerrar}
            className="font-body rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50">
            Cancelar
          </button>
          <Guardar label={punto ? 'Guardar cambios' : 'Crear punto'} />
        </div>
      </form>
    </Modal>
  )
}

// ──────────────────────────────────────────────────────────────────────────────
// Editor de zona
// ──────────────────────────────────────────────────────────────────────────────

function EditorZona({
  zona, sedes, cerrar,
}: { zona: ZonaFila | null; sedes: SedeOpcion[]; cerrar: () => void }) {
  const [estado, accion] = useActionState(guardarZona, INICIAL)
  useAviso(estado, zona ? 'Zona guardada' : 'Zona creada', cerrar)

  return (
    <Modal titulo={zona ? `Editar ${zona.nombre}` : 'Nueva zona'} cerrar={cerrar}>
      <form action={accion} className="space-y-3">
        {zona && <input type="hidden" name="id" value={zona.id} />}
        <div>
          <label className={etiqueta}>Sede *</label>
          <select name="sede_id" defaultValue={zona?.sedeId ?? sedes[0]?.id ?? ''}
            required className={campo}>
            {sedes.map((s) => (
              <option key={s.id} value={s.id}>{s.contrato} · {s.nombre}</option>
            ))}
          </select>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className={etiqueta}>Código *</label>
            <input name="codigo" defaultValue={zona?.codigo ?? ''} required maxLength={40}
              placeholder="T1-P3" className={campo + ' font-mono uppercase'} />
          </div>
          <div>
            <label className={etiqueta}>Orden de recorrido</label>
            <input name="orden" type="number" defaultValue={zona?.orden ?? 0} className={campo} />
          </div>
        </div>
        <div>
          <label className={etiqueta}>Nombre *</label>
          <input name="nombre" defaultValue={zona?.nombre ?? ''} required maxLength={200}
            placeholder="Torre A — piso 3" className={campo} />
        </div>
        <div>
          <label className={etiqueta}>Piso o nivel</label>
          <input name="piso" defaultValue={zona?.piso ?? ''} maxLength={20}
            placeholder="MEZZANINE" className={campo} />
        </div>
        <label className="flex items-center gap-2">
          <input type="checkbox" name="activo" defaultChecked={zona?.activo ?? true}
            className="h-4 w-4 rounded border-gray-300 text-brand-green" />
          <span className="font-body text-sm text-gray-700">Zona activa</span>
        </label>
        <div className="flex items-center justify-end gap-2 pt-1">
          <button type="button" onClick={cerrar}
            className="font-body rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50">
            Cancelar
          </button>
          <Guardar label={zona ? 'Guardar cambios' : 'Crear zona'} />
        </div>
      </form>
    </Modal>
  )
}

function Modal({
  titulo, cerrar, children,
}: { titulo: string; cerrar: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') cerrar() }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [cerrar])

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:items-center">
      <div className="w-full max-w-2xl rounded-2xl bg-white shadow-xl">
        <header className="flex items-center justify-between border-b border-gray-100 px-5 py-3">
          <h2 className="font-heading text-base font-bold text-gray-900">{titulo}</h2>
          <button onClick={cerrar} className="rounded p-1 text-gray-400 hover:bg-gray-50">
            <X className="h-5 w-5" />
          </button>
        </header>
        <div className="p-5">{children}</div>
      </div>
    </div>
  )
}

'use client'
import { useActionState, useEffect, useState } from 'react'
import { useFormStatus } from 'react-dom'
import { Plus, X, Loader2, Building2, MapPin, Pencil, Trash2, Navigation, Crosshair, Check } from 'lucide-react'
import { toast } from 'sonner'
import { crearSede, actualizarSede, eliminarSede, geocodificarSede, type ActionResult } from './actions'
import { DeleteButton } from '@/components/ui/DeleteButton'
import { grupoColor, type GrupoContrato } from '@/lib/types/database'
import { TIPO_CONTRATO_META, TIPO_CONTRATO_OPCIONES, type Categoria, type Etiqueta, type TipoContrato } from '@/lib/clasificacion'
import { EtiquetaPicker, TipoBadge, EtiquetaChip } from './Clasificacion'

export interface GrupoOpt { id: string; codigo: GrupoContrato; nombre: string }
export interface SedeRow {
  id: string; nombre: string; zona: string | null; ciudad: string; codigo_interno: string | null
  grupo_id: string; grupo_codigo: GrupoContrato | null; grupo_nombre?: string | null
  direccion?: string | null; lat?: number | null; lng?: number | null
  tipo_contrato?: TipoContrato | null; etiquetaIds?: string[]
}

const inputCls = 'w-full border border-gray-200 rounded-lg px-3 py-2 font-body text-sm outline-none focus:border-brand-green'

function SubmitBtn({ editando }: { editando: boolean }) {
  const { pending } = useFormStatus()
  return (
    <button type="submit" disabled={pending}
      className="flex items-center gap-2 bg-brand-green text-white font-body font-semibold text-sm px-4 py-2 rounded-lg hover:bg-brand-green-dark disabled:opacity-60">
      {pending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
      {editando ? 'Guardar cambios' : 'Crear sede'}
    </button>
  )
}

export function SedesClient({ grupos, sedes, categorias = [], etiquetas = [] }: { grupos: GrupoOpt[]; sedes: SedeRow[]; categorias?: Categoria[]; etiquetas?: Etiqueta[] }) {
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<SedeRow | null>(null)
  const action = editing ? actualizarSede : crearSede
  const [state, formAction] = useActionState<ActionResult, FormData>(action, {})

  // Coordenadas del punto de entrega (controladas para geocodificar / geolocalizar).
  const [direccion, setDireccion] = useState('')
  const [lat, setLat] = useState('')
  const [lng, setLng] = useState('')
  const [geocodificando, setGeocodificando] = useState(false)
  const [tipoContrato, setTipoContrato] = useState<TipoContrato | ''>('')
  const [etiquetaIds, setEtiquetaIds] = useState<string[]>([])

  // Sincroniza los campos de ubicación al abrir/cambiar la sede en edición.
  useEffect(() => {
    setDireccion(editing?.direccion ?? '')
    setLat(editing?.lat != null ? String(editing.lat) : '')
    setLng(editing?.lng != null ? String(editing.lng) : '')
    setTipoContrato(editing?.tipo_contrato ?? '')
    setEtiquetaIds(editing?.etiquetaIds ?? [])
  }, [editing])

  useEffect(() => { if (state.ok) { setShowForm(false); setEditing(null) } }, [state.ok])

  async function geocodificar() {
    const ciudad = (document.querySelector('input[name="ciudad"]') as HTMLInputElement | null)?.value ?? ''
    const q = [direccion, ciudad].filter(Boolean).join(', ')
    if (q.trim().length < 4) { toast.error('Escribe la dirección primero'); return }
    setGeocodificando(true)
    try {
      const r = await geocodificarSede(q)
      if (r) {
        setLat(r.lat.toFixed(6)); setLng(r.lng.toFixed(6))
        toast.success('Ubicación encontrada: ' + r.label.split(',').slice(0, 3).join(', '))
      } else {
        toast.error('No se encontró la dirección. Ajusta el texto o usa tu ubicación.')
      }
    } finally { setGeocodificando(false) }
  }

  function usarMiUbicacion() {
    if (!navigator.geolocation) { toast.error('Geolocalización no disponible'); return }
    navigator.geolocation.getCurrentPosition(
      pos => {
        setLat(pos.coords.latitude.toFixed(6)); setLng(pos.coords.longitude.toFixed(6))
        toast.success('Ubicación tomada de tu dispositivo')
      },
      () => toast.error('No se pudo obtener tu ubicación'),
      { enableHighAccuracy: true, timeout: 10000 },
    )
  }

  return (
    <div className="bg-white border border-gray-100 rounded-xl shadow-sm overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Building2 className="w-4 h-4 text-brand-green" />
          <h2 className="font-heading font-semibold text-sm text-gray-900">Sedes / contratos cliente</h2>
        </div>
        <button onClick={() => { setEditing(null); setShowForm(v => !v) }}
          className="flex items-center gap-1.5 bg-brand-green text-white font-body font-semibold text-xs px-3 py-1.5 rounded-lg hover:bg-brand-green-dark">
          {showForm ? <X className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
          {showForm ? 'Cerrar' : 'Nueva sede'}
        </button>
      </div>

      {showForm && (
        <form action={formAction} key={editing?.id ?? 'nueva'} className="p-4 border-b border-gray-100 bg-gray-50/50 space-y-3">
          {editing && <input type="hidden" name="id" value={editing.id} />}
          {state.error && <p className="font-body text-sm text-red-700 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{state.error}</p>}
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label className="font-body font-semibold text-xs text-gray-600">Contrato *</label>
              <select name="grupo_id" required defaultValue={editing?.grupo_id ?? ''} className={inputCls + ' mt-1 bg-white'}>
                <option value="" disabled>— Selecciona —</option>
                {grupos.map(g => <option key={g.id} value={g.id}>{g.codigo} · {g.nombre}</option>)}
              </select>
              {grupos.length === 0 && (
                <p className="font-body text-[11px] text-amber-700 mt-1">No hay contratos. Crea uno arriba en «Contratos» antes de registrar sedes.</p>
              )}
            </div>
            <div>
              <label className="font-body font-semibold text-xs text-gray-600">N° contrato</label>
              <input name="codigo_interno" defaultValue={editing?.codigo_interno ?? ''} className={inputCls + ' mt-1'} />
            </div>
            <div className="sm:col-span-2">
              <label className="font-body font-semibold text-xs text-gray-600">Nombre de la sede *</label>
              <input name="nombre" required defaultValue={editing?.nombre ?? ''} className={inputCls + ' mt-1'} />
            </div>
            <div>
              <label className="font-body font-semibold text-xs text-gray-600">Zona</label>
              <input name="zona" defaultValue={editing?.zona ?? ''} className={inputCls + ' mt-1'} placeholder="Ej: ZONA 21" />
            </div>
            <div>
              <label className="font-body font-semibold text-xs text-gray-600">Ciudad</label>
              <input name="ciudad" defaultValue={editing?.ciudad ?? 'BOGOTÁ D.C.'} className={inputCls + ' mt-1'} />
            </div>
          </div>

          {/* Ubicación / punto de entrega */}
          <div className="rounded-lg border border-gray-200 bg-white p-3 space-y-3">
            <div className="flex items-center gap-1.5">
              <MapPin className="w-3.5 h-3.5 text-brand-green" />
              <span className="font-body font-semibold text-xs text-gray-600">Punto de entrega (para el mapa de logística)</span>
            </div>
            <div>
              <label className="font-body font-semibold text-xs text-gray-600">Dirección</label>
              <input name="direccion" value={direccion} onChange={e => setDireccion(e.target.value)}
                className={inputCls + ' mt-1'} placeholder="Ej: Calle 100 # 15-20, Bogotá" />
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <div className="flex-1 min-w-[110px]">
                <label className="font-body font-semibold text-xs text-gray-600">Latitud</label>
                <input name="lat" value={lat} onChange={e => setLat(e.target.value)}
                  className={inputCls + ' mt-1'} placeholder="4.7110" inputMode="decimal" />
              </div>
              <div className="flex-1 min-w-[110px]">
                <label className="font-body font-semibold text-xs text-gray-600">Longitud</label>
                <input name="lng" value={lng} onChange={e => setLng(e.target.value)}
                  className={inputCls + ' mt-1'} placeholder="-74.0721" inputMode="decimal" />
              </div>
              <button type="button" onClick={geocodificar} disabled={geocodificando}
                className="flex items-center gap-1.5 border border-gray-200 rounded-lg px-3 py-2 text-xs font-body font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-60">
                {geocodificando ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Crosshair className="w-3.5 h-3.5" />}
                Geocodificar
              </button>
              <button type="button" onClick={usarMiUbicacion}
                className="flex items-center gap-1.5 border border-gray-200 rounded-lg px-3 py-2 text-xs font-body font-semibold text-gray-700 hover:bg-gray-50">
                <Navigation className="w-3.5 h-3.5" /> Mi ubicación
              </button>
            </div>
            {lat && lng && (
              <a href={`https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=17/${lat}/${lng}`} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1 font-body text-xs text-brand-green hover:underline">
                <Check className="w-3.5 h-3.5" /> Ver punto en OpenStreetMap
              </a>
            )}
          </div>

          {/* Clasificación del contrato */}
          <div className="rounded-lg border border-gray-200 bg-white p-3 space-y-3">
            <span className="font-body font-semibold text-xs text-gray-600">Clasificación del contrato</span>
            <input type="hidden" name="tipo_contrato" value={tipoContrato} />
            <div>
              <label className="font-body font-semibold text-xs text-gray-600 block mb-1">Tipo de contrato</label>
              <div className="flex gap-1.5">
                {TIPO_CONTRATO_OPCIONES.map(o => (
                  <button key={o.value} type="button" onClick={() => setTipoContrato(t => t === o.value ? '' : o.value)}
                    className={`rounded-lg border px-3 py-1.5 font-body text-xs font-semibold transition-all ${
                      tipoContrato === o.value ? `${TIPO_CONTRATO_META[o.value].badge} border-transparent` : 'border-gray-200 text-gray-500 hover:border-gray-300'
                    }`}>{o.label}</button>
                ))}
                <span className="font-body text-[11px] text-gray-400 self-center ml-1">Si lo dejas vacío, hereda del grupo.</span>
              </div>
            </div>
            <EtiquetaPicker categorias={categorias} etiquetas={etiquetas} value={etiquetaIds} onChange={setEtiquetaIds} name="etiqueta_id" />
          </div>

          <SubmitBtn editando={!!editing} />
        </form>
      )}

      {sedes.length === 0 ? (
        <div className="p-10 text-center text-gray-400">
          <MapPin className="w-8 h-8 mx-auto mb-2 text-gray-300" />
          <p className="font-body text-sm">No hay sedes registradas todavía.</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                <th className="text-left font-body font-semibold text-xs text-gray-500 uppercase px-4 py-3">Sede</th>
                <th className="text-left font-body font-semibold text-xs text-gray-500 uppercase px-4 py-3">Grupo</th>
                <th className="text-left font-body font-semibold text-xs text-gray-500 uppercase px-4 py-3">Zona</th>
                <th className="text-left font-body font-semibold text-xs text-gray-500 uppercase px-4 py-3">Ciudad</th>
                <th className="text-center font-body font-semibold text-xs text-gray-500 uppercase px-4 py-3 w-24">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {sedes.map(s => {
                return (
                  <tr key={s.id} className="hover:bg-gray-50/50 group">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <p className="font-body font-medium text-sm text-gray-900">{s.nombre}</p>
                        {s.lat != null && s.lng != null
                          ? <MapPin className="w-3.5 h-3.5 text-brand-green" aria-label="Con ubicación" />
                          : <MapPin className="w-3.5 h-3.5 text-gray-300" aria-label="Sin ubicación" />}
                      </div>
                      {s.codigo_interno && <p className="font-body text-xs text-gray-400">N° {s.codigo_interno}</p>}
                      <div className="mt-1 flex flex-wrap items-center gap-1">
                        {s.tipo_contrato && <TipoBadge tipo={s.tipo_contrato} />}
                        {(s.etiquetaIds ?? []).map(id => {
                          const et = etiquetas.find(e => e.id === id)
                          return et ? <EtiquetaChip key={id} et={et} /> : null
                        })}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {s.grupo_codigo && (
                        <span className="inline-flex items-center gap-1.5">
                          <span className={`font-body text-[11px] font-bold px-1.5 py-0.5 rounded ${grupoColor(s.grupo_codigo)}`}>{s.grupo_codigo}</span>
                          {s.grupo_nombre && <span className="font-body text-xs text-gray-500 max-w-[12rem] truncate">{s.grupo_nombre}</span>}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 font-body text-sm text-gray-500">{s.zona ?? '—'}</td>
                    <td className="px-4 py-3 font-body text-sm text-gray-500">{s.ciudad}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-center gap-1">
                        <button onClick={() => { setEditing(s); setShowForm(true) }} title="Editar"
                          className="p-1.5 rounded-lg text-gray-400 hover:text-brand-green hover:bg-green-50 opacity-0 group-hover:opacity-100 transition-all">
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <DeleteButton action={eliminarSede} id={s.id} mensaje={`¿Eliminar sede “${s.nombre}”?`}
                          className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-all">
                          <Trash2 className="w-3.5 h-3.5" />
                        </DeleteButton>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

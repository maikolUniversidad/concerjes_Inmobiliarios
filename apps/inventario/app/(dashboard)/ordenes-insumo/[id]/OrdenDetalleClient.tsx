'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  ArrowLeft, MapPin, Package, Truck, Loader2, Check,
  Ban, Video, CheckCircle2, User2, Building2,
} from 'lucide-react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import type { EstadoOrdenInsumo } from '@/lib/types/database'
import { metaEstado } from '../OrdenesInsumoClient'
import { actualizarItemAlistamiento, despacharOrden, anularOrden } from '../actions'
import { VideoDespacho } from './VideoDespacho'
import { ProductoThumb } from './ProductoThumb'

interface Item {
  id: string
  producto_id: string
  cantidad_solicitada: number
  cantidad_maxima_ref: number | null
  cantidad_alistada: number
  alistado: boolean
  es_adicional?: boolean
  producto: { nombre_estandar: string; presentacion: string | null; imagen_url?: string | null } | null
}
interface Orden {
  id: string
  numero: string
  estado: EstadoOrdenInsumo
  observacion: string | null
  created_at: string
  despachado_at: string | null
  video_path: string | null
  tipo_despacho: string | null
  transportadora_nombre: string | null
  transportadora_guia: string | null
  conductor: { nombre: string } | null
  sede: { nombre: string; grupo: { nombre: string } | null } | null
  bodega: { nombre: string } | null
  items: Item[]
}
interface ConductorOpt { usuario_id: string; nombre: string; placa: string | null }
type TipoDespacho = 'CONDUCTOR_PROPIO' | 'TRANSPORTADORA'

function fmt(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('es-CO', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export function OrdenDetalleClient({ orden, puedeAlistar }: {
  orden: Orden
  puedeAlistar: boolean
}) {
  const router = useRouter()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [sb] = useState<any>(() => createClient())
  const [items, setItems] = useState<Item[]>(orden.items ?? [])
  const [busyItem, setBusyItem] = useState<string | null>(null)
  const [showVideo, setShowVideo] = useState(false)
  const [videoUrl, setVideoUrl] = useState<string | null>(null)
  const [despachando, setDespachando] = useState(false)

  // Tipo de despacho: conductor propio (flota) vs transportadora tercera.
  const [tipoDespacho, setTipoDespacho] = useState<TipoDespacho | ''>('')
  const [conductores, setConductores] = useState<ConductorOpt[]>([])
  const [conductorId, setConductorId] = useState('')
  const [transpNombre, setTranspNombre] = useState('')
  const [transpGuia, setTranspGuia] = useState('')

  const meta = metaEstado(orden.estado)
  const despachado = orden.estado === 'DESPACHADO'
  const anulada = orden.estado === 'ANULADA'
  const editable = puedeAlistar && !despachado && !anulada

  const alistados = items.filter((i) => i.alistado).length
  const pct = items.length > 0 ? Math.round((alistados / items.length) * 100) : 0
  const hayAlistados = items.some((i) => i.alistado && Number(i.cantidad_alistada) > 0)

  // Video del despacho (bucket privado → URL firmada)
  useEffect(() => {
    if (!orden.video_path) return
    sb.storage.from('ordenes-insumo').createSignedUrl(orden.video_path, 3600).then(({ data }: { data: { signedUrl: string } | null }) => {
      if (data?.signedUrl) setVideoUrl(data.signedUrl)
    })
  }, [sb, orden.video_path])

  // Conductores propios activos (para el despacho con flota propia).
  // Se lee de la vista `conductores_opciones` (no de `conductores` con join a
  // usuarios) para que el nombre sea visible también al BODEGUERO: la RLS de
  // `usuarios` bloquea leer nombres de otros usuarios, y la vista lo evita.
  useEffect(() => {
    if (despachado || anulada) return
    sb.from('conductores_opciones')
      .select('usuario_id, nombre, placa')
      .eq('activo', true)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .then(({ data }: { data: any[] | null }) => {
        setConductores((data ?? [])
          .map((c) => ({ usuario_id: c.usuario_id, nombre: c.nombre, placa: c.placa ?? null })))
      })
  }, [sb, despachado, anulada])

  async function toggleAlistado(it: Item) {
    if (!editable) return
    setBusyItem(it.id)
    const nuevo = !it.alistado
    // Al chulear un ítem sin cantidad, se asume que se alista todo lo solicitado.
    const cantPrev = Number(it.cantidad_alistada)
    const cant = nuevo && cantPrev <= 0 ? Number(it.cantidad_solicitada) : cantPrev
    setItems((prev) => prev.map((x) => x.id === it.id ? { ...x, alistado: nuevo, cantidad_alistada: cant } : x))
    const res = await actualizarItemAlistamiento(orden.id, it.id, {
      alistado: nuevo,
      ...(cant !== cantPrev ? { cantidad_alistada: cant } : {}),
    })
    setBusyItem(null)
    if (res.error) {
      toast.error(res.error)
      setItems((prev) => prev.map((x) => x.id === it.id ? { ...x, alistado: !nuevo, cantidad_alistada: cantPrev } : x))
      return
    }
    router.refresh()
  }

  async function setCantAlistada(it: Item, v: number) {
    const val = Math.max(0, v)
    setItems((prev) => prev.map((x) => x.id === it.id ? { ...x, cantidad_alistada: val } : x))
  }
  async function guardarCant(it: Item) {
    if (!editable) return
    const res = await actualizarItemAlistamiento(orden.id, it.id, { cantidad_alistada: it.cantidad_alistada })
    if (res.error) toast.error(res.error)
  }

  // Validación del tipo de despacho antes de abrir la grabación del video.
  const despachoValido =
    tipoDespacho === 'CONDUCTOR_PROPIO' ? Boolean(conductorId)
    : tipoDespacho === 'TRANSPORTADORA' ? Boolean(transpNombre.trim())
    : false

  async function onVideoListo(path: string, mime: string | null) {
    setShowVideo(false)
    setDespachando(true)
    const res = await despacharOrden(orden.id, path, mime, {
      tipo: tipoDespacho as TipoDespacho,
      conductorId: tipoDespacho === 'CONDUCTOR_PROPIO' ? conductorId : null,
      transportadoraNombre: tipoDespacho === 'TRANSPORTADORA' ? transpNombre : null,
      transportadoraGuia: tipoDespacho === 'TRANSPORTADORA' ? transpGuia : null,
    })
    setDespachando(false)
    if (res.error && !res.ok) { toast.error(res.error); return }
    if (res.error) toast.warning(res.error)
    toast.success('Orden despachada.')
    router.refresh()
  }

  async function anular() {
    if (!window.confirm('¿Anular esta orden? No se podrá despachar.')) return
    const res = await anularOrden(orden.id)
    if (res.error) { toast.error(res.error); return }
    router.refresh()
  }

  return (
    <div className="space-y-4">
      <Link href="/ordenes-insumo" className="inline-flex items-center gap-1.5 font-body text-sm text-gray-500 hover:text-brand-green">
        <ArrowLeft className="w-4 h-4" /> Volver a órdenes
      </Link>

      {/* Header */}
      <div className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-heading font-bold text-xl text-gray-900">{orden.numero}</h1>
              <span className={`font-body text-[11px] font-semibold px-2 py-0.5 rounded-full ${meta.cls}`}>{meta.label}</span>
            </div>
            <p className="font-body text-sm text-gray-500 mt-1 flex items-center gap-1.5">
              <MapPin className="w-3.5 h-3.5 text-brand-green" /> {orden.sede?.nombre ?? '—'}
              {orden.sede?.grupo?.nombre ? ` · ${orden.sede.grupo.nombre}` : ''}
            </p>
            <p className="font-body text-xs text-gray-400 mt-0.5">
              Creada {fmt(orden.created_at)}{orden.bodega?.nombre ? ` · Bodega: ${orden.bodega.nombre}` : ''}
            </p>
          </div>
          {editable && (
            <button onClick={anular} className="inline-flex items-center gap-1.5 border border-gray-200 text-gray-600 font-body text-xs font-semibold px-3 py-1.5 rounded-lg hover:bg-red-50 hover:text-red-600 hover:border-red-200 transition-colors">
              <Ban className="w-3.5 h-3.5" /> Anular
            </button>
          )}
        </div>
        {orden.observacion && <p className="mt-3 font-body text-sm text-gray-600 bg-gray-50 rounded-lg px-3 py-2">{orden.observacion}</p>}

        {/* Progreso */}
        {!anulada && (
          <div className="mt-4">
            <div className="flex items-center justify-between font-body text-xs text-gray-500 mb-1">
              <span>Alistamiento</span><span>{alistados}/{items.length} ítems</span>
            </div>
            <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
              <div className="h-full bg-brand-green transition-all" style={{ width: `${pct}%` }} />
            </div>
          </div>
        )}
      </div>

      {/* Alistamiento (checklist) */}
      <div className="bg-white border border-gray-100 rounded-2xl shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100">
          <p className="font-heading font-semibold text-sm text-gray-900 flex items-center gap-2">
            <Package className="w-4 h-4 text-brand-green" /> Alistamiento
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px]">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                <th className="text-center font-body font-semibold text-xs text-gray-500 uppercase px-3 py-2.5 w-12">OK</th>
                <th className="text-left font-body font-semibold text-xs text-gray-500 uppercase px-3 py-2.5">Producto</th>
                <th className="text-center font-body font-semibold text-xs text-gray-500 uppercase px-3 py-2.5 w-24">Solicitado</th>
                <th className="text-center font-body font-semibold text-xs text-gray-500 uppercase px-3 py-2.5 w-28">Alistado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {items.map((it) => (
                <tr key={it.id} className={it.alistado ? 'bg-green-50/40' : ''}>
                  <td className="px-3 py-2.5 text-center">
                    <button onClick={() => toggleAlistado(it)} disabled={!editable || busyItem === it.id}
                      className={`w-6 h-6 rounded-md border-2 inline-flex items-center justify-center transition-colors ${it.alistado ? 'bg-brand-green border-brand-green' : 'border-gray-300 bg-white'} disabled:opacity-60`}>
                      {busyItem === it.id ? <Loader2 className="w-3.5 h-3.5 animate-spin text-gray-400" /> : it.alistado ? <Check className="w-3.5 h-3.5 text-white" /> : null}
                    </button>
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-2.5">
                      <ProductoThumb url={it.producto?.imagen_url} nombre={it.producto?.nombre_estandar} />
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <p className="font-body text-sm text-gray-900 truncate max-w-[200px]">{it.producto?.nombre_estandar ?? '—'}</p>
                          {it.es_adicional ? (
                            <span className="font-body text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-800">Adicional</span>
                          ) : (
                            <span className="font-body text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-teal-100 text-teal-700">Parametrizado</span>
                          )}
                        </div>
                        {it.producto?.presentacion && <p className="font-body text-[11px] text-gray-400">{it.producto.presentacion}</p>}
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-center font-body text-sm font-semibold text-gray-700">{Number(it.cantidad_solicitada)}</td>
                  <td className="px-3 py-2.5">
                    <input type="number" min={0} step="1" value={Number(it.cantidad_alistada)} disabled={!editable}
                      onChange={(e) => setCantAlistada(it, Number(e.target.value) || 0)} onBlur={() => guardarCant(it)}
                      className="w-full border border-gray-200 rounded-lg px-2 py-1.5 font-body text-sm text-center outline-none focus:border-brand-green disabled:bg-gray-50" />
                  </td>
                </tr>
              ))}
              {items.length === 0 && (
                <tr><td colSpan={4} className="py-10 text-center font-body text-sm text-gray-400">La orden no tiene ítems.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Despacho / video */}
      <div className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm">
        <p className="font-heading font-semibold text-sm text-gray-900 flex items-center gap-2 mb-3">
          <Truck className="w-4 h-4 text-brand-green" /> Despacho
        </p>

        {despachado ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-green-700 font-body text-sm font-semibold">
              <CheckCircle2 className="w-4 h-4" /> Despachada el {fmt(orden.despachado_at)}
            </div>
            {/* Cómo salió el pedido */}
            <div className="flex items-start gap-2 rounded-lg bg-gray-50 px-3 py-2">
              {orden.tipo_despacho === 'TRANSPORTADORA'
                ? <Building2 className="w-4 h-4 text-brand-green mt-0.5 shrink-0" />
                : <User2 className="w-4 h-4 text-brand-green mt-0.5 shrink-0" />}
              <div className="font-body text-sm text-gray-700">
                {orden.tipo_despacho === 'TRANSPORTADORA' ? (
                  <>
                    <span className="font-semibold">Transportadora tercera:</span> {orden.transportadora_nombre ?? '—'}
                    {orden.transportadora_guia && <span className="text-gray-500"> · Guía {orden.transportadora_guia}</span>}
                  </>
                ) : orden.tipo_despacho === 'CONDUCTOR_PROPIO' ? (
                  <><span className="font-semibold">Conductor propio:</span> {orden.conductor?.nombre ?? '—'}</>
                ) : (
                  <span className="text-gray-400">Tipo de despacho no registrado.</span>
                )}
              </div>
            </div>
            {videoUrl ? (
              <video src={videoUrl} controls playsInline className="w-full rounded-xl bg-black aspect-video" />
            ) : orden.video_path ? (
              <p className="font-body text-xs text-gray-400 flex items-center gap-1.5"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Cargando video…</p>
            ) : (
              <p className="font-body text-xs text-gray-400">Sin video registrado.</p>
            )}
          </div>
        ) : anulada ? (
          <p className="font-body text-sm text-gray-400">Orden anulada.</p>
        ) : (
          <div className="space-y-4">
            <p className="font-body text-sm text-gray-500">
              Al despachar se graba/sube un video que queda ligado a la orden y se registra la salida de stock de los ítems alistados hacia la sede.
            </p>

            {/* ¿Cómo sale el pedido? */}
            <div>
              <p className="font-body text-sm font-semibold text-gray-800 mb-2">¿Cómo sale el pedido?</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <button type="button" onClick={() => setTipoDespacho('CONDUCTOR_PROPIO')} disabled={!editable}
                  className={`flex items-center gap-2 rounded-xl border px-3 py-2.5 text-left transition-colors disabled:opacity-50 ${
                    tipoDespacho === 'CONDUCTOR_PROPIO' ? 'border-brand-green bg-brand-green/5 ring-1 ring-brand-green/30' : 'border-gray-200 hover:bg-gray-50'}`}>
                  <User2 className={`w-4 h-4 ${tipoDespacho === 'CONDUCTOR_PROPIO' ? 'text-brand-green' : 'text-gray-400'}`} />
                  <span className="font-body text-sm text-gray-800">Conductor propio</span>
                </button>
                <button type="button" onClick={() => setTipoDespacho('TRANSPORTADORA')} disabled={!editable}
                  className={`flex items-center gap-2 rounded-xl border px-3 py-2.5 text-left transition-colors disabled:opacity-50 ${
                    tipoDespacho === 'TRANSPORTADORA' ? 'border-brand-green bg-brand-green/5 ring-1 ring-brand-green/30' : 'border-gray-200 hover:bg-gray-50'}`}>
                  <Building2 className={`w-4 h-4 ${tipoDespacho === 'TRANSPORTADORA' ? 'text-brand-green' : 'text-gray-400'}`} />
                  <span className="font-body text-sm text-gray-800">Transportadora (tercero)</span>
                </button>
              </div>

              {/* Datos según el tipo elegido */}
              {tipoDespacho === 'CONDUCTOR_PROPIO' && (
                <div className="mt-2">
                  <select value={conductorId} onChange={(e) => setConductorId(e.target.value)} disabled={!editable}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 font-body text-sm outline-none focus:border-brand-green bg-white">
                    <option value="">Selecciona el conductor…</option>
                    {conductores.map((c) => (
                      <option key={c.usuario_id} value={c.usuario_id}>{c.nombre}{c.placa ? ` · ${c.placa}` : ''}</option>
                    ))}
                  </select>
                  {conductores.length === 0 && (
                    <p className="font-body text-xs text-gray-400 mt-1">No hay conductores registrados. Regístralos en Logística › Conductores.</p>
                  )}
                </div>
              )}
              {tipoDespacho === 'TRANSPORTADORA' && (
                <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <input value={transpNombre} onChange={(e) => setTranspNombre(e.target.value)} disabled={!editable}
                    placeholder="Nombre de la transportadora *"
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 font-body text-sm outline-none focus:border-brand-green" />
                  <input value={transpGuia} onChange={(e) => setTranspGuia(e.target.value)} disabled={!editable}
                    placeholder="N.º de guía (opcional)"
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 font-body text-sm outline-none focus:border-brand-green" />
                </div>
              )}
            </div>

            <button
              onClick={() => setShowVideo(true)}
              disabled={!puedeAlistar || despachando || !despachoValido}
              className="inline-flex items-center gap-2 bg-brand-green hover:bg-brand-green-dark text-white font-body font-semibold text-sm px-5 py-2.5 rounded-xl transition-colors disabled:opacity-50">
              {despachando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Video className="w-4 h-4" />}
              Grabar video y despachar
            </button>
            {!despachoValido && <p className="font-body text-xs text-gray-400">Indica si el pedido sale con conductor propio o con transportadora.</p>}
            {despachoValido && !hayAlistados && (
              <p className="font-body text-xs text-amber-600">
                Ningún ítem tiene cantidad alistada: se despachará con las cantidades solicitadas.
              </p>
            )}
          </div>
        )}
      </div>

      {showVideo && (
        <VideoDespacho ordenId={orden.id} onListo={onVideoListo} onCancel={() => setShowVideo(false)} />
      )}
    </div>
  )
}

'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  ArrowLeft, MapPin, Package, Truck, Loader2, Check,
  Ban, Video, CheckCircle2,
} from 'lucide-react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import type { EstadoOrdenInsumo } from '@/lib/types/database'
import { metaEstado } from '../OrdenesInsumoClient'
import { actualizarItemAlistamiento, despacharOrden, anularOrden } from '../actions'
import { VideoDespacho } from './VideoDespacho'

interface Item {
  id: string
  producto_id: string
  cantidad_solicitada: number
  cantidad_maxima_ref: number | null
  cantidad_alistada: number
  alistado: boolean
  es_adicional?: boolean
  producto: { nombre_estandar: string; presentacion: string | null } | null
}
interface Orden {
  id: string
  numero: string
  estado: EstadoOrdenInsumo
  observacion: string | null
  created_at: string
  despachado_at: string | null
  video_path: string | null
  sede: { nombre: string; grupo: { nombre: string } | null } | null
  bodega: { nombre: string } | null
  items: Item[]
}

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

  async function toggleAlistado(it: Item) {
    if (!editable) return
    setBusyItem(it.id)
    const nuevo = !it.alistado
    setItems((prev) => prev.map((x) => x.id === it.id ? { ...x, alistado: nuevo } : x))
    const res = await actualizarItemAlistamiento(orden.id, it.id, { alistado: nuevo })
    setBusyItem(null)
    if (res.error) { toast.error(res.error); setItems((prev) => prev.map((x) => x.id === it.id ? { ...x, alistado: !nuevo } : x)); return }
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

  async function onVideoListo(path: string, mime: string | null) {
    setShowVideo(false)
    setDespachando(true)
    const res = await despacharOrden(orden.id, path, mime)
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
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <p className="font-body text-sm text-gray-900 truncate max-w-[240px]">{it.producto?.nombre_estandar ?? '—'}</p>
                      {it.es_adicional ? (
                        <span className="font-body text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-800">Adicional</span>
                      ) : (
                        <span className="font-body text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-teal-100 text-teal-700">Parametrizado</span>
                      )}
                    </div>
                    {it.producto?.presentacion && <p className="font-body text-[11px] text-gray-400">{it.producto.presentacion}</p>}
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
          <div className="space-y-3">
            <p className="font-body text-sm text-gray-500">
              Al despachar se graba/sube un video que queda ligado a la orden y se registra la salida de stock de los ítems alistados hacia la sede.
            </p>
            <button
              onClick={() => setShowVideo(true)}
              disabled={!puedeAlistar || !hayAlistados || despachando}
              className="inline-flex items-center gap-2 bg-brand-green hover:bg-brand-green-dark text-white font-body font-semibold text-sm px-5 py-2.5 rounded-xl transition-colors disabled:opacity-50">
              {despachando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Video className="w-4 h-4" />}
              Grabar video y despachar
            </button>
            {!hayAlistados && <p className="font-body text-xs text-gray-400">Marca al menos un ítem como alistado (con cantidad) para poder despachar.</p>}
          </div>
        )}
      </div>

      {showVideo && (
        <VideoDespacho ordenId={orden.id} onListo={onVideoListo} onCancel={() => setShowVideo(false)} />
      )}
    </div>
  )
}

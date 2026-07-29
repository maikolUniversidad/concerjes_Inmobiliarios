'use client'

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import dynamic from 'next/dynamic'
import { toast } from 'sonner'
import {
  Navigation, MapPin, Phone, Clock, CheckCircle2, AlertTriangle,
  Camera, PenTool, User, CreditCard, ChevronDown, ChevronUp,
  Wifi, WifiOff, Play, Package, FileText, Map as MapIcon
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { iniciarRuta, llegarParada, confirmarEntrega, reportarNovedad } from '../actions'
import FirmaDigital from '@/components/logistica/FirmaDigital'
import type { PuntoMapa } from '@/components/logistica/MapaLeaflet'

const MapaLeaflet = dynamic(() => import('@/components/logistica/MapaLeaflet'), {
  ssr: false,
  loading: () => (
    <div style={{ height: 300 }} className="flex items-center justify-center text-gray-400 bg-gray-50 dark:bg-gray-800 rounded-xl">
      Cargando mapa…
    </div>
  ),
})

type EstadoParada = 'PENDIENTE' | 'EN_RUTA' | 'ENTREGADO' | 'NOVEDAD' | 'REPROGRAMADO'
type TipoNovedad  = 'DEVOLUCION' | 'FALTA_MERCANCIA' | 'ACCIDENTE' | 'SEDE_CERRADA' | 'TIEMPO_EXCEDIDO' | 'OTRO'

interface Parada {
  id: string
  ruta_id: string
  orden_id: string
  sede_id: string
  numero_parada: number
  estado: EstadoParada
  llegado_at: string | null
  entregado_at: string | null
  sede: { id: string; nombre: string; ciudad: string; zona: string | null; codigo_interno: string | null; direccion: string | null; lat: number | null; lng: number | null } | null
  orden: { id: string; numero: string; estado: string; observacion: string | null } | null
  confirmacion: {receptor_nombre: string; created_at: string} | null
  novedades: {id: string; tipo: string; estado: string}[] | null
  horario: {
    ventana_am_inicio: string | null; ventana_am_fin: string | null
    ventana_pm_inicio: string | null; ventana_pm_fin: string | null
    supervisor_nombre: string | null; supervisor_contacto: string | null
  } | null
}

interface Ruta {
  id: string
  codigo: string
  estado: string
  fecha: string
  observaciones: string | null
  paradas: Parada[]
}

interface Props { rutaInicial: Ruta | null }

const TIPOS_NOVEDAD: {value: TipoNovedad; label: string}[] = [
  { value: 'DEVOLUCION',      label: 'Devolución' },
  { value: 'FALTA_MERCANCIA', label: 'Falta mercancía' },
  { value: 'ACCIDENTE',       label: 'Accidente' },
  { value: 'SEDE_CERRADA',    label: 'Sede cerrada' },
  { value: 'TIEMPO_EXCEDIDO', label: 'Tiempo excedido' },
  { value: 'OTRO',            label: 'Otro' },
]

export default function MisRutasClient({ rutaInicial }: Props) {
  const [ruta, setRuta] = useState(rutaInicial)
  const [gpsActivo, setGpsActivo] = useState(false)
  const [posicion, setPosicion] = useState<{lat: number; lng: number; precision: number} | null>(null)
  const [paradaAbierta, setParadaAbierta] = useState<string | null>(null)
  const [modalConfirmar, setModalConfirmar] = useState<Parada | null>(null)
  const [modalNovedad, setModalNovedad]     = useState<Parada | null>(null)
  const [cargando, setCargando] = useState(false)
  const watchId = useRef<number | null>(null)
  const supabase = createClient()

  // Obtener conductor_id al montar
  const [conductorId, setConductorId] = useState<string | null>(null)
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(supabase as any).from('conductores').select('id').then(({ data }: any) => {
      if (data?.[0]) setConductorId(data[0].id)
    })
  }, [])

  // GPS tracking
  const enviarPosicion = useCallback(async (pos: GeolocationPosition) => {
    const { latitude: lat, longitude: lng, accuracy } = pos.coords
    setPosicion({ lat, lng, precision: accuracy })
    if (!conductorId || !ruta) return

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase as any).from('conductor_ubicacion_actual').upsert({
      conductor_id: conductorId,
      ruta_id: ruta.id,
      lat, lng,
      precision_metros: accuracy,
      velocidad_kmh: pos.coords.speed ? pos.coords.speed * 3.6 : null,
      rumbo: pos.coords.heading,
      activo: true,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'conductor_id' })
  }, [conductorId, ruta, supabase])

  function iniciarGPS() {
    if (!navigator.geolocation) { toast.error('GPS no disponible en este dispositivo'); return }
    watchId.current = navigator.geolocation.watchPosition(
      enviarPosicion,
      () => toast.error('No se pudo obtener la ubicación'),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 5000 }
    )
    setGpsActivo(true)
    toast.success('GPS activo — enviando ubicación en tiempo real')
  }

  function detenerGPS() {
    if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current)
    setGpsActivo(false)
    if (conductorId) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(supabase as any).from('conductor_ubicacion_actual').upsert({ conductor_id: conductorId, activo: false }, { onConflict: 'conductor_id' })
    }
    toast('GPS desactivado')
  }

  useEffect(() => () => { if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current) }, [])

  async function handleIniciarRuta() {
    if (!ruta) return
    setCargando(true)
    try {
      await iniciarRuta(ruta.id)
      setRuta(p => p ? { ...p, estado: 'EN_CURSO' } : p)
      iniciarGPS()
      toast.success('¡Ruta iniciada! GPS activado.')
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : 'Error') }
    finally { setCargando(false) }
  }

  async function handleLlegarParada(p: Parada) {
    setCargando(true)
    try {
      await llegarParada(p.id)
      setRuta(prev => prev ? {
        ...prev,
        paradas: prev.paradas.map(x => x.id === p.id ? { ...x, estado: 'EN_RUTA' as EstadoParada } : x)
      } : prev)
      toast.success(`Llegaste a ${p.sede?.nombre}`)
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : 'Error') }
    finally { setCargando(false) }
  }

  // Estado del modal de confirmación
  const [confForm, setConfForm] = useState({
    receptor_nombre: '', receptor_cedula: '', receptor_cargo: '',
    foto_entrega_url: '', observaciones: '',
  })
  const [firmaBase64, setFirmaBase64] = useState<string | null>(null)
  const [fotoFile, setFotoFile] = useState<File | null>(null)

  async function handleConfirmar() {
    if (!modalConfirmar || !confForm.receptor_nombre) { toast.error('Nombre del receptor requerido'); return }
    setCargando(true)
    try {
      let foto_entrega_url: string | undefined
      let firma_url: string | undefined

      // Subir foto
      if (fotoFile) {
        const ext = fotoFile.name.split('.').pop()
        const path = `confirmaciones/${modalConfirmar.orden_id}/${Date.now()}.${ext}`
        const { error } = await supabase.storage.from('logistica-evidencia').upload(path, fotoFile)
        if (!error) foto_entrega_url = path
      }

      // Subir firma como PNG
      if (firmaBase64) {
        const blob = await (await fetch(firmaBase64)).blob()
        const path = `firmas/${modalConfirmar.orden_id}/${Date.now()}.png`
        const { error } = await supabase.storage.from('logistica-evidencia').upload(path, blob)
        if (!error) firma_url = path
      }

      await confirmarEntrega({
        parada_id: modalConfirmar.id,
        ruta_id: modalConfirmar.ruta_id,
        orden_id: modalConfirmar.orden_id,
        receptor_nombre: confForm.receptor_nombre,
        receptor_cedula: confForm.receptor_cedula || undefined,
        receptor_cargo: confForm.receptor_cargo || undefined,
        foto_entrega_url,
        firma_url,
        lat: posicion?.lat,
        lng: posicion?.lng,
        observaciones: confForm.observaciones || undefined,
      })

      setRuta(prev => prev ? {
        ...prev,
        paradas: prev.paradas.map(x => x.id === modalConfirmar.id
          ? { ...x, estado: 'ENTREGADO' as EstadoParada, confirmacion: { receptor_nombre: confForm.receptor_nombre, created_at: new Date().toISOString() } }
          : x
        )
      } : prev)

      setModalConfirmar(null)
      setFirmaBase64(null)
      setFotoFile(null)
      setConfForm({ receptor_nombre: '', receptor_cedula: '', receptor_cargo: '', foto_entrega_url: '', observaciones: '' })
      toast.success('¡Entrega confirmada!')
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : 'Error') }
    finally { setCargando(false) }
  }

  // Modal novedad
  const [novedadForm, setNovedadForm] = useState<{tipo: TipoNovedad; descripcion: string}>({ tipo: 'OTRO', descripcion: '' })

  async function handleReportarNovedad() {
    if (!modalNovedad || !novedadForm.descripcion) { toast.error('Descripción requerida'); return }
    setCargando(true)
    try {
      await reportarNovedad({
        ruta_id: modalNovedad.ruta_id,
        parada_id: modalNovedad.id,
        orden_id: modalNovedad.orden_id,
        tipo: novedadForm.tipo,
        descripcion: novedadForm.descripcion,
        lat: posicion?.lat,
        lng: posicion?.lng,
      })
      setRuta(prev => prev ? {
        ...prev,
        paradas: prev.paradas.map(x => x.id === modalNovedad.id
          ? { ...x, estado: 'NOVEDAD' as EstadoParada }
          : x
        )
      } : prev)
      setModalNovedad(null)
      setNovedadForm({ tipo: 'OTRO', descripcion: '' })
      toast.success('Novedad reportada')
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : 'Error') }
    finally { setCargando(false) }
  }

  const completadas = ruta?.paradas.filter(p => p.estado === 'ENTREGADO').length ?? 0
  const total = ruta?.paradas.length ?? 0

  // Puntos del mapa: mis paradas (con coordenadas) + mi posición actual.
  const puntosMapa = useMemo<PuntoMapa[]>(() => {
    const out: PuntoMapa[] = []
    for (const p of ruta?.paradas ?? []) {
      if (p.sede?.lat != null && p.sede?.lng != null) {
        out.push({
          id: 's-' + p.id, lat: p.sede.lat, lng: p.sede.lng, tipo: 'sede',
          titulo: `${p.numero_parada}. ${p.sede.nombre}`,
          detalle: `${p.sede.ciudad}${p.orden?.numero ? ` · OI ${p.orden.numero}` : ''}`,
          estado: p.estado, orden: p.numero_parada,
        })
      }
    }
    if (posicion) {
      out.push({ id: 'yo', lat: posicion.lat, lng: posicion.lng, tipo: 'conductor', titulo: 'Mi ubicación', activo: true })
    }
    return out
  }, [ruta, posicion])

  const paradasSinCoords = (ruta?.paradas ?? []).filter(p => p.sede?.lat == null).length

  if (!ruta) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center space-y-3">
        <Navigation className="h-16 w-16 text-gray-300" />
        <h2 className="text-xl font-bold text-gray-700 dark:text-gray-300">Sin ruta para hoy</h2>
        <p className="text-sm text-gray-500">No tienes ninguna ruta asignada para el día de hoy.<br/>Contacta a tu coordinador para que te asigne una.</p>
      </div>
    )
  }

  const estadoColor: Record<string, string> = {
    PENDIENTE: 'bg-gray-100 text-gray-700 dark:bg-gray-800',
    EN_CURSO:  'bg-blue-100 text-blue-700 dark:bg-blue-900',
    COMPLETADA:'bg-green-100 text-green-700 dark:bg-green-900',
    CANCELADA: 'bg-red-100 text-red-700 dark:bg-red-900',
  }

  const paradaColor: Record<EstadoParada, string> = {
    PENDIENTE:    'border-gray-200',
    EN_RUTA:      'border-blue-400 bg-blue-50 dark:bg-blue-950',
    ENTREGADO:    'border-green-400 bg-green-50 dark:bg-green-950',
    NOVEDAD:      'border-red-400 bg-red-50 dark:bg-red-950',
    REPROGRAMADO: 'border-yellow-400 bg-yellow-50 dark:bg-yellow-950',
  }

  return (
    <div className="max-w-2xl mx-auto space-y-4 pb-24">
      {/* Header ruta */}
      <div className="bg-white dark:bg-gray-900 rounded-xl border p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">Ruta del día</p>
            <h1 className="text-xl font-bold text-gray-900 dark:text-white">{ruta.codigo}</h1>
          </div>
          <span className={`text-xs font-medium px-3 py-1 rounded-full ${estadoColor[ruta.estado]}`}>{ruta.estado.replace('_', ' ')}</span>
        </div>

        {/* Progreso */}
        <div className="space-y-1">
          <div className="flex justify-between text-xs text-gray-500">
            <span>{completadas} de {total} entregas completadas</span>
            <span>{total > 0 ? Math.round((completadas / total) * 100) : 0}%</span>
          </div>
          <div className="h-2 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-green-500 rounded-full transition-all"
              style={{ width: `${total > 0 ? (completadas / total) * 100 : 0}%` }}
            />
          </div>
        </div>

        {/* GPS */}
        <div className="flex items-center justify-between pt-1">
          <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
            {gpsActivo
              ? <><Wifi className="h-4 w-4 text-green-500 animate-pulse" /><span>GPS activo {posicion ? `(±${Math.round(posicion.precision)}m)` : ''}</span></>
              : <><WifiOff className="h-4 w-4 text-gray-400" /><span>GPS inactivo</span></>
            }
          </div>
          {ruta.estado === 'PENDIENTE' ? (
            <button
              onClick={handleIniciarRuta}
              disabled={cargando}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
            >
              <Play className="h-4 w-4" /> Iniciar ruta
            </button>
          ) : ruta.estado === 'EN_CURSO' && !gpsActivo ? (
            <button onClick={iniciarGPS} className="flex items-center gap-2 px-3 py-1.5 bg-green-600 text-white rounded-lg text-xs font-medium hover:bg-green-700">
              <Wifi className="h-3.5 w-3.5" /> Activar GPS
            </button>
          ) : gpsActivo ? (
            <button onClick={detenerGPS} className="px-3 py-1.5 border border-gray-300 rounded-lg text-xs font-medium hover:bg-gray-50 dark:hover:bg-gray-800">
              Detener GPS
            </button>
          ) : null}
        </div>

        {ruta.observaciones && (
          <div className="text-xs text-gray-500 bg-gray-50 dark:bg-gray-800 rounded-lg p-2">
            {ruta.observaciones}
          </div>
        )}
      </div>

      {/* Mapa de mis puntos de entrega */}
      {puntosMapa.some(p => p.tipo === 'sede') && (
        <div className="bg-white dark:bg-gray-900 rounded-xl border overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-2.5 border-b dark:border-gray-800">
            <MapIcon className="h-4 w-4 text-blue-600 dark:text-blue-400" />
            <span className="text-sm font-semibold text-gray-900 dark:text-white">Mis puntos de entrega</span>
            <span className="text-xs text-gray-500">({puntosMapa.filter(p => p.tipo === 'sede').length})</span>
          </div>
          <div className="p-1">
            <MapaLeaflet puntos={puntosMapa} dibujarRuta alto={300} />
          </div>
          {paradasSinCoords > 0 && (
            <p className="px-4 py-2 text-xs text-amber-600 dark:text-amber-400">
              {paradasSinCoords} parada{paradasSinCoords !== 1 ? 's' : ''} sin ubicación en el mapa (falta coordenada de la sede).
            </p>
          )}
        </div>
      )}

      {/* Paradas */}
      {ruta.paradas.map((parada, idx) => {
        const abierta = paradaAbierta === parada.id
        const horario = parada.horario

        return (
          <div key={parada.id} className={`bg-white dark:bg-gray-900 rounded-xl border-2 overflow-hidden transition-all ${paradaColor[parada.estado]}`}>
            {/* Header parada */}
            <button
              onClick={() => setParadaAbierta(abierta ? null : parada.id)}
              className="w-full flex items-center gap-3 p-4 text-left"
            >
              <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
                parada.estado === 'ENTREGADO' ? 'bg-green-500 text-white' :
                parada.estado === 'NOVEDAD'   ? 'bg-red-500 text-white' :
                parada.estado === 'EN_RUTA'   ? 'bg-blue-500 text-white' :
                'bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-300'
              }`}>
                {parada.estado === 'ENTREGADO' ? <CheckCircle2 className="h-4 w-4" /> :
                 parada.estado === 'NOVEDAD'   ? <AlertTriangle className="h-4 w-4" /> :
                 idx + 1}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-gray-900 dark:text-white truncate">{parada.sede?.nombre}</p>
                <p className="text-xs text-gray-500">{parada.sede?.ciudad} · OI {parada.orden?.numero}</p>
              </div>
              {abierta ? <ChevronUp className="h-4 w-4 text-gray-400" /> : <ChevronDown className="h-4 w-4 text-gray-400" />}
            </button>

            {abierta && (
              <div className="border-t px-4 pb-4 space-y-3">
                {/* Info sede */}
                <div className="grid grid-cols-2 gap-2 text-xs text-gray-600 dark:text-gray-400 pt-2">
                  {horario?.supervisor_nombre && (
                    <div className="flex items-center gap-1.5">
                      <User className="h-3.5 w-3.5" />
                      <span>{horario.supervisor_nombre}</span>
                    </div>
                  )}
                  {horario?.supervisor_contacto && (
                    <div className="flex items-center gap-1.5">
                      <Phone className="h-3.5 w-3.5" />
                      <a href={`tel:${horario.supervisor_contacto}`} className="text-blue-600 underline">
                        {horario.supervisor_contacto}
                      </a>
                    </div>
                  )}
                  {(horario?.ventana_am_inicio || horario?.ventana_pm_inicio) && (
                    <div className="col-span-2 flex items-center gap-1.5">
                      <Clock className="h-3.5 w-3.5" />
                      <span>
                        {horario.ventana_am_inicio && `AM: ${horario.ventana_am_inicio}–${horario.ventana_am_fin}`}
                        {horario.ventana_am_inicio && horario.ventana_pm_inicio && ' · '}
                        {horario.ventana_pm_inicio && `PM: ${horario.ventana_pm_inicio}–${horario.ventana_pm_fin}`}
                      </span>
                    </div>
                  )}
                  {parada.orden?.observacion && (
                    <div className="col-span-2 flex items-start gap-1.5">
                      <FileText className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
                      <span>{parada.orden.observacion}</span>
                    </div>
                  )}
                </div>

                {/* Novedades activas */}
                {parada.novedades && parada.novedades.length > 0 && (
                  <div className="space-y-1">
                    {parada.novedades.map(n => (
                      <div key={n.id} className="flex items-center gap-2 text-xs bg-red-50 dark:bg-red-950 border border-red-200 rounded px-2 py-1">
                        <AlertTriangle className="h-3.5 w-3.5 text-red-500" />
                        <span className="text-red-700 dark:text-red-300">{n.tipo.replace('_', ' ')} · {n.estado}</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Confirmación existente */}
                {parada.confirmacion && (
                  <div className="flex items-center gap-2 text-xs bg-green-50 dark:bg-green-950 border border-green-200 rounded px-2 py-1.5">
                    <CheckCircle2 className="h-4 w-4 text-green-500 flex-shrink-0" />
                    <span className="text-green-700 dark:text-green-300">
                      Recibido por <strong>{parada.confirmacion.receptor_nombre}</strong>
                    </span>
                  </div>
                )}

                {/* Botones de acción */}
                {ruta.estado === 'EN_CURSO' && parada.estado !== 'ENTREGADO' && (
                  <div className="flex gap-2 pt-1">
                    {parada.estado === 'PENDIENTE' && (
                      <button
                        onClick={() => handleLlegarParada(parada)}
                        disabled={cargando}
                        className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-blue-600 text-white rounded-lg text-xs font-medium hover:bg-blue-700 disabled:opacity-50"
                      >
                        <MapPin className="h-3.5 w-3.5" /> Llegué aquí
                      </button>
                    )}
                    {parada.estado === 'EN_RUTA' && (
                      <button
                        onClick={() => { setModalConfirmar(parada); setConfForm({ receptor_nombre: '', receptor_cedula: '', receptor_cargo: '', foto_entrega_url: '', observaciones: '' }) }}
                        className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-green-600 text-white rounded-lg text-xs font-medium hover:bg-green-700"
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" /> Confirmar entrega
                      </button>
                    )}
                    <button
                      onClick={() => { setModalNovedad(parada); setNovedadForm({ tipo: 'OTRO', descripcion: '' }) }}
                      className="flex items-center justify-center gap-1.5 px-3 py-2 border border-red-300 text-red-600 rounded-lg text-xs font-medium hover:bg-red-50"
                    >
                      <AlertTriangle className="h-3.5 w-3.5" /> Novedad
                    </button>
                  </div>
                )}

                {/* Link Google Maps */}
                {parada.sede && (
                  <a
                    href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${parada.sede.nombre}, ${parada.sede.ciudad}`)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 text-xs text-blue-600 hover:underline"
                  >
                    <MapPin className="h-3.5 w-3.5" /> Abrir en Google Maps
                  </a>
                )}
              </div>
            )}
          </div>
        )
      })}

      {/* Modal Confirmar Entrega */}
      {modalConfirmar && (
        <div className="fixed inset-0 bg-black/60 flex items-end sm:items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-900 rounded-xl w-full max-w-md max-h-[90vh] overflow-y-auto space-y-4 p-5">
            <h2 className="text-lg font-bold">Confirmar entrega</h2>
            <p className="text-sm text-gray-500">{modalConfirmar.sede?.nombre} · OI {modalConfirmar.orden?.numero}</p>

            {/* Foto */}
            <div>
              <label className="block text-sm font-medium mb-1">Foto de la entrega *</label>
              <label className="flex items-center gap-2 justify-center border-2 border-dashed rounded-xl p-4 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800">
                <Camera className="h-5 w-5 text-gray-400" />
                <span className="text-sm text-gray-500">{fotoFile ? fotoFile.name : 'Tomar foto / seleccionar'}</span>
                <input type="file" accept="image/*" capture="environment" className="sr-only"
                  onChange={e => setFotoFile(e.target.files?.[0] ?? null)} />
              </label>
            </div>

            {/* Receptor */}
            <div className="space-y-2">
              <div>
                <label className="flex items-center gap-1.5 text-sm font-medium mb-1"><User className="h-4 w-4" /> Nombre del receptor *</label>
                <input type="text" value={confForm.receptor_nombre}
                  onChange={e => setConfForm(p => ({...p, receptor_nombre: e.target.value}))}
                  placeholder="Nombre completo"
                  className="w-full border rounded-lg px-3 py-2 text-sm dark:bg-gray-800 dark:border-gray-700" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="flex items-center gap-1 text-xs font-medium mb-1"><CreditCard className="h-3.5 w-3.5" /> Cédula</label>
                  <input type="text" value={confForm.receptor_cedula}
                    onChange={e => setConfForm(p => ({...p, receptor_cedula: e.target.value}))}
                    placeholder="000000000"
                    className="w-full border rounded-lg px-3 py-2 text-sm dark:bg-gray-800 dark:border-gray-700" />
                </div>
                <div>
                  <label className="text-xs font-medium mb-1 block">Cargo</label>
                  <input type="text" value={confForm.receptor_cargo}
                    onChange={e => setConfForm(p => ({...p, receptor_cargo: e.target.value}))}
                    placeholder="Supervisor, etc."
                    className="w-full border rounded-lg px-3 py-2 text-sm dark:bg-gray-800 dark:border-gray-700" />
                </div>
              </div>
            </div>

            {/* Firma digital */}
            <div>
              <label className="flex items-center gap-1.5 text-sm font-medium mb-2"><PenTool className="h-4 w-4" /> Firma digital del receptor *</label>
              <FirmaDigital onChange={setFirmaBase64} />
            </div>

            {/* Observaciones */}
            <div>
              <label className="text-sm font-medium mb-1 block">Observaciones</label>
              <textarea value={confForm.observaciones}
                onChange={e => setConfForm(p => ({...p, observaciones: e.target.value}))}
                placeholder="Ej: entrega parcial, faltó 1 unidad..."
                rows={2}
                className="w-full border rounded-lg px-3 py-2 text-sm dark:bg-gray-800 dark:border-gray-700 resize-none" />
            </div>

            {/* Items */}
            {modalConfirmar.orden && (
              <div className="flex items-center gap-2 text-xs text-gray-500 bg-gray-50 dark:bg-gray-800 rounded-lg px-3 py-2">
                <Package className="h-4 w-4" />
                <span>Orden <strong>{modalConfirmar.orden.numero}</strong> — los ítems se confirman automáticamente</span>
              </div>
            )}

            {posicion && (
              <p className="text-xs text-green-600 dark:text-green-400">📍 Geolocalización registrada (±{Math.round(posicion.precision)}m)</p>
            )}

            <div className="flex gap-3 pt-2">
              <button onClick={() => setModalConfirmar(null)} className="flex-1 px-4 py-2.5 border rounded-lg text-sm hover:bg-gray-50 dark:hover:bg-gray-800">
                Cancelar
              </button>
              <button
                onClick={handleConfirmar}
                disabled={cargando || !confForm.receptor_nombre || !firmaBase64}
                className="flex-1 px-4 py-2.5 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50"
              >
                {cargando ? 'Confirmando...' : 'Confirmar ✓'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Novedad */}
      {modalNovedad && (
        <div className="fixed inset-0 bg-black/60 flex items-end sm:items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-900 rounded-xl w-full max-w-md p-5 space-y-4">
            <h2 className="text-lg font-bold text-red-700 dark:text-red-400">Reportar novedad</h2>
            <p className="text-sm text-gray-500">{modalNovedad.sede?.nombre}</p>

            <div>
              <label className="text-sm font-medium mb-1 block">Tipo de novedad</label>
              <select value={novedadForm.tipo}
                onChange={e => setNovedadForm(p => ({...p, tipo: e.target.value as TipoNovedad}))}
                className="w-full border rounded-lg px-3 py-2 text-sm dark:bg-gray-800 dark:border-gray-700"
              >
                {TIPOS_NOVEDAD.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>

            <div>
              <label className="text-sm font-medium mb-1 block">Descripción *</label>
              <textarea value={novedadForm.descripcion}
                onChange={e => setNovedadForm(p => ({...p, descripcion: e.target.value}))}
                placeholder="Describe lo que ocurrió..."
                rows={3}
                className="w-full border rounded-lg px-3 py-2 text-sm dark:bg-gray-800 dark:border-gray-700 resize-none"
              />
            </div>

            <div className="flex gap-3">
              <button onClick={() => setModalNovedad(null)} className="flex-1 px-4 py-2.5 border rounded-lg text-sm hover:bg-gray-50 dark:hover:bg-gray-800">
                Cancelar
              </button>
              <button
                onClick={handleReportarNovedad}
                disabled={cargando || !novedadForm.descripcion}
                className="flex-1 px-4 py-2.5 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 disabled:opacity-50"
              >
                {cargando ? 'Reportando...' : 'Reportar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

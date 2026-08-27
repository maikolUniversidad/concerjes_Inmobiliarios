'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import {
  Loader2, CalendarPlus, MapPin, Clock, ChevronDown, Star, X, CheckCircle2, Circle, Wallet,
} from 'lucide-react'
import { toast } from 'sonner'
import { getPortalSupabase } from '@/lib/supabase/portal'
import { usePortal } from '../_portal/PortalProvider'
import { ESTADOS, ESTADOS_COBRO, ICONO_SERVICIO, estadoCobro, fmtFecha, fmtHora, fmtPrecio, fmtMoneda } from '../_portal/datos'

interface Sesion { id: string; fecha: string; hora_inicio: string; hora_fin: string; estado: string }
interface Cobro {
  id: string; numero: string; solicitud_id: string | null
  total: number; saldo: number; estado: string; fecha_vencimiento: string | null
}
interface Solicitud {
  id: string; numero: string; estado: string; frecuencia: string; tipo_id: string | null
  cliente_direccion: string; cliente_barrio: string | null; cliente_ciudad: string
  fecha_deseada: string; hora_inicio: string
  precio_cotizado: number | null; notas: string | null
  calificacion: number | null; comentario_calificacion: string | null
  tipos_servicio_hogar: { nombre: string } | null
  tarifas_servicio_hogar: { nombre: string } | null
  agenda_servicio_hogar: Sesion[]
}

// Nombre a mostrar públicamente: primer nombre + inicial del apellido ("María G.").
function nombrePublico(nombre?: string | null): string {
  if (!nombre || nombre === 'Cliente') return 'Cliente'
  const partes = nombre.trim().split(/\s+/)
  if (partes.length === 1) return partes[0]
  return `${partes[0]} ${partes[partes.length - 1].charAt(0).toUpperCase()}.`
}

const FLUJO = ['PENDIENTE', 'CONFIRMADA', 'EN_SERVICIO', 'COMPLETADA'] as const
const FLUJO_LABEL: Record<string, string> = {
  PENDIENTE: 'Solicitud recibida', CONFIRMADA: 'Confirmada', EN_SERVICIO: 'En servicio', COMPLETADA: 'Completada',
}

export default function MisServiciosPage() {
  const { session, cliente } = usePortal()
  const [items, setItems] = useState<Solicitud[]>([])
  const [cobros, setCobros] = useState<Record<string, Cobro>>({})
  const [cargando, setCargando] = useState(true)
  const [abierto, setAbierto] = useState<string | null>(null)
  const [filtro, setFiltro] = useState<'activos' | 'todos'>('activos')

  async function cargar() {
    const sb = getPortalSupabase()
    const { data } = await sb
      .from('solicitudes_servicio_hogar')
      .select('*, tipos_servicio_hogar(nombre), tarifas_servicio_hogar(nombre), agenda_servicio_hogar(id, fecha, hora_inicio, hora_fin, estado)')
      .eq('cliente_id', session.user.id)
      .order('created_at', { ascending: false })
    setItems((data as unknown as Solicitud[]) ?? [])

    // Cuenta de cobro asociada a cada servicio (la más reciente por solicitud).
    const { data: cbs } = await sb
      .from('cobros_servicio_hogar')
      .select('id, numero, solicitud_id, total, saldo, estado, fecha_vencimiento')
      .eq('cliente_id', session.user.id)
      .neq('estado', 'BORRADOR')
      .order('created_at', { ascending: false })
    const mapa: Record<string, Cobro> = {}
    for (const c of (cbs as unknown as Cobro[]) ?? []) {
      if (c.solicitud_id && !mapa[c.solicitud_id]) mapa[c.solicitud_id] = c
    }
    setCobros(mapa)
    setCargando(false)
  }
  useEffect(() => { cargar() }, [session.user.id])

  async function cancelar(id: string) {
    const sb = getPortalSupabase()
    const { error } = await sb.from('solicitudes_servicio_hogar')
      .update({ estado: 'CANCELADA', motivo_cancelacion: 'Cancelada por el cliente' }).eq('id', id)
    if (error) { toast.error('No se pudo cancelar.'); return }
    toast.success('Servicio cancelado.')
    cargar()
  }

  const visibles = filtro === 'activos'
    ? items.filter((s) => ['PENDIENTE', 'CONFIRMADA', 'EN_SERVICIO'].includes(s.estado))
    : items

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-heading text-2xl font-bold text-gray-900">Mis servicios</h1>
        <Link href="/portal/solicitar" className="inline-flex items-center gap-2 rounded-xl bg-brand-green px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-green-dark">
          <CalendarPlus className="h-4 w-4" /> Agendar
        </Link>
      </div>

      <div className="flex rounded-xl bg-gray-100 p-1">
        {(['activos', 'todos'] as const).map((f) => (
          <button key={f} onClick={() => setFiltro(f)}
            className={`flex-1 rounded-lg py-2 text-sm font-semibold capitalize transition-colors ${filtro === f ? 'bg-white text-brand-green shadow-sm' : 'text-gray-500'}`}>
            {f === 'activos' ? 'Activos' : 'Todos'}
          </button>
        ))}
      </div>

      {cargando ? (
        <div className="flex justify-center py-16"><Loader2 className="h-7 w-7 animate-spin text-brand-green" /></div>
      ) : visibles.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-10 text-center">
          <p className="font-heading text-lg font-bold text-gray-900">
            {filtro === 'activos' ? 'No tienes servicios activos' : 'Aún no tienes servicios'}
          </p>
          <Link href="/portal/solicitar" className="mt-4 inline-flex items-center gap-2 rounded-xl bg-brand-green px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-green-dark">
            <CalendarPlus className="h-4 w-4" /> Agendar mi primer servicio
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {visibles.map((s) => {
            const est = ESTADOS[s.estado] ?? ESTADOS.PENDIENTE
            const open = abierto === s.id
            const cancelable = ['PENDIENTE', 'CONFIRMADA'].includes(s.estado)
            const calificable = s.estado === 'COMPLETADA' && !s.calificacion
            return (
              <div key={s.id} className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
                <button onClick={() => setAbierto(open ? null : s.id)} className="flex w-full items-center gap-4 p-4 text-left">
                  <span className="text-3xl">{ICONO_SERVICIO[s.tipos_servicio_hogar?.nombre ?? ''] ?? '🧹'}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate font-heading font-bold text-gray-900">{s.tipos_servicio_hogar?.nombre ?? 'Servicio'}</p>
                      <span className={`shrink-0 rounded-full border px-2 py-0.5 text-xs font-semibold ${est.bg} ${est.texto}`}>{est.label}</span>
                    </div>
                    <p className="mt-0.5 flex items-center gap-3 text-xs text-gray-400">
                      <span className="flex items-center gap-1"><Clock className="h-3 w-3" /> {fmtFecha(s.fecha_deseada).replace(/,.*/, '')} · {fmtHora(s.hora_inicio)}</span>
                    </p>
                  </div>
                  <ChevronDown className={`h-5 w-5 shrink-0 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} />
                </button>

                {open && (
                  <div className="border-t border-gray-100 px-4 pb-5 pt-4">
                    {/* Timeline seguimiento */}
                    {s.estado !== 'CANCELADA' ? (
                      <ol className="mb-5">
                        {FLUJO.map((paso, i) => {
                          const idx = FLUJO.indexOf(s.estado as typeof FLUJO[number])
                          const hecho = idx >= i
                          const actual = idx === i
                          return (
                            <li key={paso} className="flex gap-3">
                              <div className="flex flex-col items-center">
                                {hecho ? <CheckCircle2 className={`h-5 w-5 ${actual ? 'text-brand-green' : 'text-brand-green/70'}`} /> : <Circle className="h-5 w-5 text-gray-300" />}
                                {i < FLUJO.length - 1 && <div className={`w-0.5 flex-1 ${idx > i ? 'bg-brand-green/70' : 'bg-gray-200'}`} style={{ minHeight: 20 }} />}
                              </div>
                              <span className={`pb-4 text-sm ${hecho ? 'font-semibold text-gray-800' : 'text-gray-400'}`}>{FLUJO_LABEL[paso]}</span>
                            </li>
                          )
                        })}
                      </ol>
                    ) : (
                      <div className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">Este servicio fue cancelado.</div>
                    )}

                    <dl className="grid grid-cols-2 gap-3 text-sm">
                      <div><dt className="text-gray-400">N° solicitud</dt><dd className="font-semibold text-gray-800">{s.numero}</dd></div>
                      <div><dt className="text-gray-400">Frecuencia</dt><dd className="font-semibold text-gray-800 capitalize">{s.frecuencia.toLowerCase()}</dd></div>
                      <div className="col-span-2"><dt className="text-gray-400">Dirección</dt><dd className="flex items-center gap-1 font-semibold text-gray-800"><MapPin className="h-3.5 w-3.5 text-brand-green" /> {s.cliente_direccion}{s.cliente_barrio ? `, ${s.cliente_barrio}` : ''} — {s.cliente_ciudad}</dd></div>
                      {s.tarifas_servicio_hogar?.nombre && <div><dt className="text-gray-400">Plan</dt><dd className="font-semibold text-gray-800">{s.tarifas_servicio_hogar.nombre}</dd></div>}
                      <div><dt className="text-gray-400">Precio</dt><dd className="font-semibold text-brand-green">{fmtPrecio(s.precio_cotizado)}</dd></div>
                      {s.notas && <div className="col-span-2"><dt className="text-gray-400">Notas</dt><dd className="text-gray-700">{s.notas}</dd></div>}
                    </dl>

                    {s.agenda_servicio_hogar?.length > 0 && (
                      <div className="mt-4">
                        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">Sesiones programadas</p>
                        <div className="space-y-1.5">
                          {s.agenda_servicio_hogar.map((se) => (
                            <div key={se.id} className="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2 text-sm">
                              <span className="text-gray-700">{fmtFecha(se.fecha).replace(/,.*/, '')}</span>
                              <span className="text-gray-500">{fmtHora(se.hora_inicio)}–{fmtHora(se.hora_fin)}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {cobros[s.id] && (() => {
                      const c = cobros[s.id]
                      const e = estadoCobro(c.estado, c.fecha_vencimiento, Number(c.saldo))
                      const b = ESTADOS_COBRO[e] ?? ESTADOS_COBRO.EMITIDO
                      return (
                        <Link href={`/portal/pagos/${c.id}`}
                          className="mt-4 flex items-center gap-3 rounded-xl border border-gray-200 p-3.5 transition-colors hover:border-brand-green/40 hover:bg-brand-green/5">
                          <Wallet className="h-5 w-5 shrink-0 text-brand-green" />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-semibold text-gray-800">Cuenta de cobro {c.numero}</p>
                            <p className="text-xs text-gray-400">
                              {Number(c.saldo) > 0 ? `Saldo ${fmtMoneda(c.saldo)}` : `Total ${fmtMoneda(c.total)}`}
                            </p>
                          </div>
                          <span className={`shrink-0 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${b.bg} ${b.texto}`}>{b.label}</span>
                        </Link>
                      )
                    })()}

                    {s.calificacion && (
                      <div className="mt-4 flex items-center gap-1">
                        <span className="text-xs text-gray-400">Tu calificación:</span>
                        {[1, 2, 3, 4, 5].map((n) => <Star key={n} className={`h-4 w-4 ${n <= s.calificacion! ? 'fill-amber-400 text-amber-400' : 'text-gray-300'}`} />)}
                      </div>
                    )}

                    {(cancelable || calificable) && (
                      <div className="mt-5 flex flex-wrap gap-2">
                        {calificable && (
                          <Calificar
                            id={s.id}
                            clienteId={session.user.id}
                            tipoId={s.tipo_id}
                            servicioNombre={s.tipos_servicio_hogar?.nombre ?? null}
                            clienteNombre={nombrePublico(cliente?.nombre)}
                            onListo={cargar}
                          />
                        )}
                        {cancelable && (
                          <button onClick={() => cancelar(s.id)}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 px-4 py-2 text-sm font-semibold text-red-600 hover:bg-red-50">
                            <X className="h-4 w-4" /> Cancelar servicio
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function Calificar({ id, clienteId, tipoId, servicioNombre, clienteNombre, onListo }: {
  id: string; clienteId: string; tipoId: string | null; servicioNombre: string | null; clienteNombre: string; onListo: () => void
}) {
  const [abierto, setAbierto] = useState(false)
  const [valor, setValor] = useState(0)
  const [hover, setHover] = useState(0)
  const [comentario, setComentario] = useState('')
  const [enviando, setEnviando] = useState(false)

  async function enviar() {
    if (!valor) { toast.error('Selecciona una calificación.'); return }
    setEnviando(true)
    const sb = getPortalSupabase()
    // 1) Guarda la calificación en la solicitud (registro interno).
    const { error } = await sb.from('solicitudes_servicio_hogar')
      .update({ calificacion: valor, comentario_calificacion: comentario || null }).eq('id', id)
    if (error) { setEnviando(false); toast.error('No se pudo enviar.'); return }
    // 2) Crea la reseña pública (queda PENDIENTE de aprobación del personal).
    await sb.from('resenas_servicio_hogar').upsert({
      solicitud_id: id,
      cliente_id: clienteId,
      tipo_id: tipoId,
      cliente_nombre: clienteNombre,
      servicio_nombre: servicioNombre,
      calificacion: valor,
      comentario: comentario || null,
      aprobada: false,
    }, { onConflict: 'solicitud_id' })
    setEnviando(false)
    toast.success('¡Gracias! Tu reseña será publicada tras una breve revisión.')
    onListo()
  }

  if (!abierto) {
    return (
      <button onClick={() => setAbierto(true)} className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-600">
        <Star className="h-4 w-4" /> Calificar servicio
      </button>
    )
  }
  return (
    <div className="w-full rounded-xl border border-amber-200 bg-amber-50 p-4">
      <p className="mb-2 text-sm font-semibold text-gray-700">¿Cómo estuvo el servicio?</p>
      <div className="mb-3 flex gap-1">
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} onMouseEnter={() => setHover(n)} onMouseLeave={() => setHover(0)} onClick={() => setValor(n)}>
            <Star className={`h-7 w-7 transition-colors ${n <= (hover || valor) ? 'fill-amber-400 text-amber-400' : 'text-gray-300'}`} />
          </button>
        ))}
      </div>
      <textarea value={comentario} onChange={(e) => setComentario(e.target.value)} rows={2} placeholder="Cuéntanos tu experiencia (opcional)"
        className="mb-3 w-full resize-none rounded-lg border border-amber-200 px-3 py-2 text-sm outline-none focus:border-amber-400" />
      <div className="flex gap-2">
        <button onClick={enviar} disabled={enviando} className="inline-flex items-center gap-1.5 rounded-lg bg-brand-green px-4 py-2 text-sm font-semibold text-white hover:bg-brand-green-dark disabled:opacity-50">
          {enviando ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Enviar
        </button>
        <button onClick={() => setAbierto(false)} className="rounded-lg px-3 py-2 text-sm text-gray-500 hover:bg-white">Cancelar</button>
      </div>
    </div>
  )
}

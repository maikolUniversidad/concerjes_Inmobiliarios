'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  AlarmClock, Building2, CheckCircle2, Camera, Loader2, Mail, MessageSquareWarning,
  Paperclip, Phone, User, UserCog,
} from 'lucide-react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { ArchivosPendientes, VeloSoltar } from '@/components/ui/ArchivosPendientes'
import { useAdjuntosPegables } from '@/lib/adjuntos-chat'
import {
  CALIDAD_PQRS_META, CANAL_PQRS_META, ESTADO_PQRS_META, MAX_ADJUNTO_PQRS,
  PRIORIDAD_PQRS_META, PRIORIDADES_PQRS, TIPO_PQRS_META,
  accionesPqrs, estadoPlazo, fechaCorta, fechaHoraPqrs, firmarRutasPqrs, hoyBogota,
  solicitante, subirArchivoPqrs,
  type AdjuntoPqrs, type EstadoPqrs, type GestorPqrs, type Pqrs, type PqrsMensaje,
} from '@/lib/pqrs'
import { BitacoraPqrs } from './BitacoraPqrs'

export function PqrsClient({ pqrs: inicial, mensajes: mensajesIniciales, gestores, usuarioId, coordina, puedeEscribir }: {
  pqrs: Pqrs
  mensajes: PqrsMensaje[]
  gestores: GestorPqrs[]
  usuarioId: string
  coordina: boolean
  puedeEscribir: boolean
}) {
  const router = useRouter()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [sb] = useState<any>(() => createClient())
  const [pqrs, setPqrs] = useState(inicial)
  const [mensajes, setMensajes] = useState(mensajesIniciales)
  const [urls, setUrls] = useState<Record<string, string>>({})
  const hoy = useRef(hoyBogota()).current

  useEffect(() => { setPqrs(inicial) }, [inicial])

  const agregar = useCallback((m: PqrsMensaje) => {
    setMensajes((prev) => prev.some((x) => x.id === m.id)
      ? prev
      : [...prev, m].sort((a, b) => a.created_at.localeCompare(b.created_at)))
  }, [])

  // En vivo: mensajes nuevos y cambios de la PQRS.
  useEffect(() => {
    const canal = sb.channel(`pqrs:${pqrs.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'pqrs_bitacora', filter: `pqrs_id=eq.${pqrs.id}` },
        (p: { new: PqrsMensaje }) => agregar(p.new))
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'pqrs', filter: `id=eq.${pqrs.id}` },
        (p: { new: Pqrs }) => setPqrs((x) => ({ ...x, ...p.new })))
      .subscribe()
    return () => { sb.removeChannel(canal) }
  }, [sb, pqrs.id, agregar])

  // Firmar la evidencia (una vez por ruta).
  const firmadasRef = useRef(new Set<string>())
  useEffect(() => {
    const rutas = mensajes.map((m) => m.adjunto_path)
      .filter((p): p is string => !!p && !firmadasRef.current.has(p))
    if (rutas.length === 0) return
    rutas.forEach((p) => firmadasRef.current.add(p))
    firmarRutasPqrs(sb, rutas).then((u) => setUrls((prev) => ({ ...prev, ...u })))
  }, [mensajes, sb])

  const plazo = estadoPlazo(pqrs.fecha_limite, pqrs.estado, hoy)

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_420px]">
      <div className="min-w-0 space-y-4">
        {/* Cabecera */}
        <div className="space-y-3 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-mono text-sm text-gray-400">{pqrs.numero}</span>
            <span className={`rounded-full px-2 py-0.5 font-body text-xs font-semibold ${TIPO_PQRS_META[pqrs.tipo]?.cls}`}>
              {TIPO_PQRS_META[pqrs.tipo]?.label}
            </span>
            <span className={`rounded-full px-2 py-0.5 font-body text-xs font-semibold ${ESTADO_PQRS_META[pqrs.estado]?.cls}`}>
              {ESTADO_PQRS_META[pqrs.estado]?.label}
            </span>
            <span className={`rounded-full px-2 py-0.5 font-body text-xs font-semibold ${PRIORIDAD_PQRS_META[pqrs.prioridad]?.cls}`}>
              {PRIORIDAD_PQRS_META[pqrs.prioridad]?.label}
            </span>
            <span className={`ml-auto inline-flex items-center gap-1 font-body text-xs ${plazo.cls}`}>
              <AlarmClock className="w-3.5 h-3.5" />
              {plazo.semaforo === 'CERRADA'
                ? `Fecha límite ${fechaCorta(pqrs.fecha_limite)}`
                : `${plazo.texto} · límite ${fechaCorta(pqrs.fecha_limite)}`}
            </span>
          </div>

          <h1 className="font-heading text-xl font-bold text-gray-900">{pqrs.asunto}</h1>
          <p className="whitespace-pre-wrap font-body text-sm text-gray-700">{pqrs.descripcion}</p>

          <dl className="grid grid-cols-1 gap-x-4 gap-y-1.5 font-body text-xs sm:grid-cols-2">
            <Dato icon={Building2} etiqueta="Sede">{pqrs.sede_nombre ?? '—'}</Dato>
            <Dato icon={User} etiqueta="Radica">
              {solicitante(pqrs)}
              {pqrs.solicitante_doc ? ` · doc. ${pqrs.solicitante_doc}` : ''}
            </Dato>
            <Dato icon={Phone} etiqueta="Teléfono">{pqrs.solicitante_telefono ?? '—'}</Dato>
            <Dato icon={Mail} etiqueta="Correo">{pqrs.solicitante_email ?? '—'}</Dato>
            <Dato etiqueta="Llegó por">{CANAL_PQRS_META[pqrs.canal]?.label ?? pqrs.canal}</Dato>
            <Dato etiqueta="En calidad de">{CALIDAD_PQRS_META[pqrs.solicitante_calidad]?.label ?? '—'}</Dato>
            <Dato icon={UserCog} etiqueta="Colaborador señalado">{pqrs.persona_nombre ?? 'Ninguno'}</Dato>
            <Dato etiqueta="Responsable">{pqrs.responsable_nombre ?? 'Sin asignar'}</Dato>
            <Dato etiqueta="Radicada">
              {fechaHoraPqrs(pqrs.created_at)}{pqrs.radicada_nombre ? ` · por ${pqrs.radicada_nombre}` : ''}
            </Dato>
            <Dato etiqueta="Plazo">{pqrs.dias_plazo} días hábiles</Dato>
            {pqrs.respondida_at && (
              <Dato etiqueta="Respondida">
                {fechaHoraPqrs(pqrs.respondida_at)}{pqrs.respondida_nombre ? ` · por ${pqrs.respondida_nombre}` : ''}
              </Dato>
            )}
            {pqrs.cerrada_at && <Dato etiqueta="Cerrada">{fechaHoraPqrs(pqrs.cerrada_at)}</Dato>}
          </dl>

          {pqrs.respuesta && (
            <div className="rounded-xl bg-emerald-50 px-3 py-2 font-body text-sm text-emerald-800">
              <p className="flex items-center gap-1.5 text-xs font-semibold"><CheckCircle2 className="w-4 h-4" /> Respuesta</p>
              <p className="mt-0.5 whitespace-pre-wrap">{pqrs.respuesta}</p>
            </div>
          )}
        </div>

        <Atender pqrs={pqrs} sb={sb} coordina={coordina} esRadicador={pqrs.radicada_por === usuarioId}
          gestores={gestores} onHecho={(p) => { setPqrs((prev) => ({ ...prev, ...p })); router.refresh() }} />
      </div>

      <BitacoraPqrs sb={sb} pqrs={pqrs} usuarioId={usuarioId} mensajes={mensajes} urls={urls}
        puedeEscribir={puedeEscribir} onNuevo={agregar} />
    </div>
  )
}

function Dato({ icon: Icon, etiqueta, children }: {
  icon?: typeof User
  etiqueta: string
  children: React.ReactNode
}) {
  return (
    <div className="flex gap-1.5">
      {Icon ? <Icon className="mt-0.5 w-3.5 h-3.5 shrink-0 text-gray-400" /> : <span className="w-3.5 shrink-0" />}
      <dt className="shrink-0 text-gray-500">{etiqueta}:</dt>
      <dd className="min-w-0 text-gray-800">{children}</dd>
    </div>
  )
}

/** Cambiar estado, asignar responsable, mover prioridad o plazo, con evidencia. */
function Atender({ pqrs, sb, coordina, esRadicador, gestores, onHecho }: {
  pqrs: Pqrs
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sb: any
  coordina: boolean
  esRadicador: boolean
  gestores: GestorPqrs[]
  onHecho: (p: Pqrs) => void
}) {
  const acciones = accionesPqrs(pqrs.estado, coordina, esRadicador)
  const [destino, setDestino] = useState<EstadoPqrs | ''>('')
  const [comentario, setComentario] = useState('')
  const [archivos, setArchivos] = useState<File[]>([])
  const [responsable, setResponsable] = useState('')
  const [prioridad, setPrioridad] = useState('')
  const [dias, setDias] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [paso, setPaso] = useState('')

  const accion = acciones.find((a) => a.estado === destino)
  const hayCambio = !!destino || !!responsable || !!prioridad || !!dias
  const { arrastrando, zona } = useAdjuntosPegables((f) => elegir(f), !hayCambio)

  // Si otra persona la mueve, la acción elegida puede ya no aplicar.
  useEffect(() => { setDestino('') }, [pqrs.estado])

  if (acciones.length === 0 && !coordina) return null

  function elegir(lista: File[] | FileList | null) {
    if (!lista) return
    const ok = Array.from(lista).filter((f) => {
      if (f.size > MAX_ADJUNTO_PQRS) { toast.error(`"${f.name}" supera 50 MB.`); return false }
      return true
    })
    setArchivos((prev) => [...prev, ...ok].slice(0, 6))
  }

  async function aplicar() {
    if (!hayCambio) { toast.error('Elige un estado nuevo, un responsable, una prioridad o un plazo.'); return }
    if (accion?.comentario && !comentario.trim()) {
      toast.error(destino === 'RESPONDIDA'
        ? 'Escribe la respuesta que se le dio a quien radicó.'
        : 'Escribe el comentario (obligatorio para este paso).')
      return
    }
    setEnviando(true)
    try {
      const adjuntos: AdjuntoPqrs[] = []
      for (let i = 0; i < archivos.length; i++) {
        setPaso(`Subiendo evidencia ${i + 1} de ${archivos.length}…`)
        adjuntos.push(await subirArchivoPqrs(sb, pqrs.id, archivos[i], archivos[i].name))
      }
      setPaso('Guardando…')
      const { data, error } = await sb.rpc('pqrs_cambiar_estado', {
        p_pqrs: pqrs.id,
        p_estado: destino || pqrs.estado,
        p_comentario: comentario.trim() || null,
        p_adjuntos: adjuntos,
        p_responsable: responsable || null,
        p_prioridad: prioridad || null,
        p_dias_plazo: dias ? Number(dias) : null,
      })
      if (error) throw new Error(error.message)
      toast.success('PQRS actualizada.')
      setDestino(''); setComentario(''); setArchivos([]); setResponsable(''); setPrioridad(''); setDias('')
      onHecho(data)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se pudo actualizar.')
    } finally { setEnviando(false); setPaso('') }
  }

  return (
    <div {...zona} className="relative space-y-3 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
      <VeloSoltar visible={arrastrando && hayCambio} texto="Suelta para adjuntar como evidencia" />
      <h2 className="flex items-center gap-1.5 font-heading text-sm font-semibold text-gray-900">
        <MessageSquareWarning className="w-4 h-4 text-brand-green" /> {coordina ? 'Atender la PQRS' : 'Acciones'}
      </h2>

      <div className="flex flex-wrap gap-1.5">
        {acciones.map((a) => (
          <button key={a.estado} onClick={() => setDestino(destino === a.estado ? '' : a.estado)}
            className={`rounded-lg px-3 py-1.5 font-body text-xs font-semibold transition-colors ${
              destino === a.estado ? 'bg-gray-900 text-white' : `${ESTADO_PQRS_META[a.estado].cls.replace('line-through', '')} hover:opacity-80`}`}>
            {a.label}{a.comentario ? ' *' : ''}
          </button>
        ))}
      </div>

      {coordina && (
        <div className="grid gap-2 sm:grid-cols-3">
          <select value={responsable} onChange={(e) => setResponsable(e.target.value)}
            aria-label="Responsable"
            className="rounded-lg border border-gray-200 bg-white px-2 py-1.5 font-body text-sm">
            <option value="">Responsable: {pqrs.responsable_nombre ?? 'sin asignar'}</option>
            {gestores.map((g) => (
              <option key={g.id} value={g.id}>{g.nombre}{g.rol_nombre ? ` · ${g.rol_nombre}` : ''}</option>
            ))}
          </select>
          <select value={prioridad} onChange={(e) => setPrioridad(e.target.value)}
            aria-label="Prioridad"
            className="rounded-lg border border-gray-200 bg-white px-2 py-1.5 font-body text-sm">
            <option value="">Prioridad: {PRIORIDAD_PQRS_META[pqrs.prioridad]?.label}</option>
            {PRIORIDADES_PQRS.map((p) => <option key={p} value={p}>{PRIORIDAD_PQRS_META[p].label}</option>)}
          </select>
          <input value={dias} onChange={(e) => setDias(e.target.value.replace(/\D/g, '').slice(0, 3))}
            inputMode="numeric" aria-label="Plazo en días hábiles"
            placeholder={`Plazo: ${pqrs.dias_plazo} días hábiles`}
            className="rounded-lg border border-gray-200 bg-white px-2 py-1.5 font-body text-sm" />
        </div>
      )}

      {hayCambio && (
        <>
          <textarea value={comentario} onChange={(e) => setComentario(e.target.value)} rows={3}
            placeholder={
              destino === 'RESPONDIDA' ? 'Respuesta que se le dio a quien radicó (obligatoria)…'
                : accion?.comentario ? 'Comentario obligatorio: qué se hizo o por qué…'
                : 'Comentario (opcional)…'}
            className="w-full rounded-lg border border-gray-200 px-3 py-2 font-body text-sm outline-none focus:border-brand-green" />
          <ArchivosPendientes archivos={archivos} onQuitar={(i) => setArchivos((a) => a.filter((_, j) => j !== i))} />
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-body text-xs text-gray-500">Evidencia:</span>
            <label className="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1.5 font-body text-xs text-gray-600 hover:bg-gray-50">
              <Camera className="w-4 h-4" /> Foto / video
              <input type="file" accept="image/*,video/*" capture="environment" className="hidden"
                onChange={(e) => { elegir(e.target.files); e.target.value = '' }} />
            </label>
            <label className="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1.5 font-body text-xs text-gray-600 hover:bg-gray-50">
              <Paperclip className="w-4 h-4" /> Archivos
              <input type="file" multiple className="hidden"
                onChange={(e) => { elegir(e.target.files); e.target.value = '' }} />
            </label>
            <span className="font-body text-[11px] text-gray-400">o pega con Ctrl+V</span>
          </div>
          <div className="flex items-center gap-2">
            {paso && <span className="flex items-center gap-1 font-body text-xs text-gray-500"><Loader2 className="w-3 h-3 animate-spin" /> {paso}</span>}
            <button onClick={aplicar} disabled={enviando}
              className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-brand-green px-4 py-2 font-body text-sm font-semibold text-white hover:bg-brand-green-dark disabled:opacity-50">
              {enviando && <Loader2 className="w-4 h-4 animate-spin" />}
              {accion ? accion.label : 'Guardar cambios'}
            </button>
          </div>
        </>
      )}
    </div>
  )
}

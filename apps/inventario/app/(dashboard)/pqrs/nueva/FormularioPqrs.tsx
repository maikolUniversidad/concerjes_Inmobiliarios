'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Camera, Loader2, Paperclip, Send } from 'lucide-react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { ArchivosPendientes, VeloSoltar } from '@/components/ui/ArchivosPendientes'
import { useAdjuntosPegables } from '@/lib/adjuntos-chat'
import {
  CALIDAD_PQRS_META, CALIDADES_PQRS, CANAL_PQRS_META, CANALES_PQRS_CONSOLA, MAX_ADJUNTO_PQRS,
  PRIORIDAD_PQRS_META, PRIORIDADES_PQRS, TIPO_PQRS_META, TIPOS_PQRS,
  subirArchivoPqrs,
  type AdjuntoPqrs, type CalidadPqrs, type CanalPqrs, type SedePqrs, type TipoPqrs,
} from '@/lib/pqrs'

interface PersonaSede { id: string; nombre: string; cargo: string | null }

export function FormularioPqrs({ sedes, plazos, coordina }: {
  sedes: SedePqrs[]
  plazos: Partial<Record<TipoPqrs, number>>
  coordina: boolean
}) {
  const router = useRouter()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [sb] = useState<any>(() => createClient())

  const [tipo, setTipo] = useState<TipoPqrs>('QUEJA')
  const [canal, setCanal] = useState<CanalPqrs>('SEDE')
  const [prioridad, setPrioridad] = useState('MEDIA')
  const [sedeId, setSedeId] = useState(sedes.length === 1 ? sedes[0].id : '')
  const [personas, setPersonas] = useState<PersonaSede[]>([])
  const [personaId, setPersonaId] = useState('')
  const [anonima, setAnonima] = useState(false)
  const [nombre, setNombre] = useState('')
  const [calidad, setCalidad] = useState<CalidadPqrs>('RESIDENTE')
  const [documento, setDocumento] = useState('')
  const [telefono, setTelefono] = useState('')
  const [email, setEmail] = useState('')
  const [asunto, setAsunto] = useState('')
  const [descripcion, setDescripcion] = useState('')
  const [dias, setDias] = useState('')
  const [archivos, setArchivos] = useState<File[]>([])
  const [enviando, setEnviando] = useState(false)
  const [paso, setPaso] = useState('')

  const diasPorDefecto = plazos[tipo] ?? 15
  const { arrastrando, zona } = useAdjuntosPegables((f) => elegir(f), enviando)

  // Colaboradores de la sede elegida (por RPC: el Conserje no ve toda la nómina).
  useEffect(() => {
    setPersonaId('')
    if (!sedeId) { setPersonas([]); return }
    let vivo = true
    sb.rpc('pqrs_personas_sede', { p_sede: sedeId }).then(({ data }: { data: PersonaSede[] | null }) => {
      if (vivo) setPersonas(data ?? [])
    })
    return () => { vivo = false }
  }, [sb, sedeId])

  const sede = useMemo(() => sedes.find((s) => s.id === sedeId), [sedes, sedeId])

  function elegir(lista: File[] | FileList | null) {
    if (!lista) return
    const ok = Array.from(lista).filter((f) => {
      if (f.size > MAX_ADJUNTO_PQRS) { toast.error(`"${f.name}" supera 50 MB.`); return false }
      return true
    })
    if (ok.length === 0) return
    setArchivos((prev) => {
      const todos = [...prev, ...ok]
      if (todos.length > 6) toast.message('Máximo 6 archivos de evidencia.')
      return todos.slice(0, 6)
    })
  }

  async function radicar() {
    if (!sedeId) { toast.error('Elige la sede.'); return }
    if (!anonima && !nombre.trim()) { toast.error('Di quién radica, o márcala como anónima.'); return }
    if (!asunto.trim()) { toast.error('Escribe el asunto.'); return }
    if (!descripcion.trim()) { toast.error('Escribe la descripción.'); return }

    setEnviando(true)
    try {
      // El id se genera aquí para poder subir la evidencia ANTES, a pqrs/{id}/…
      const id = globalThis.crypto?.randomUUID?.() ?? String(Date.now())
      const adjuntos: AdjuntoPqrs[] = []
      for (let i = 0; i < archivos.length; i++) {
        setPaso(`Subiendo evidencia ${i + 1} de ${archivos.length}…`)
        adjuntos.push(await subirArchivoPqrs(sb, id, archivos[i], archivos[i].name))
      }
      setPaso('Radicando…')
      const { data, error } = await sb.rpc('pqrs_radicar', {
        p_id: id,
        p_tipo: tipo,
        p_canal: canal,
        p_sede: sedeId,
        p_asunto: asunto.trim(),
        p_descripcion: descripcion.trim(),
        p_anonima: anonima,
        p_solicitante: anonima
          ? { calidad, telefono: telefono.trim() || null, email: email.trim() || null }
          : {
              nombre: nombre.trim(), calidad,
              documento: documento.trim() || null,
              telefono: telefono.trim() || null,
              email: email.trim() || null,
            },
        p_persona: personaId || null,
        p_prioridad: prioridad,
        p_dias_plazo: coordina && dias ? Number(dias) : null,
        p_adjuntos: adjuntos,
      })
      if (error) throw new Error(error.message)
      toast.success(`PQRS ${data?.numero ?? ''} radicada.`)
      router.push(`/pqrs/${data?.id ?? id}`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se pudo radicar la PQRS.')
    } finally { setEnviando(false); setPaso('') }
  }

  return (
    <div {...zona} className="relative space-y-4">
      <VeloSoltar visible={arrastrando} texto="Suelta para adjuntar como evidencia" />

      {/* Qué es */}
      <Bloque titulo="Qué es">
        <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
          {TIPOS_PQRS.map((t) => (
            <button key={t} type="button" onClick={() => setTipo(t)}
              className={`rounded-xl border px-3 py-2 text-left transition-colors ${
                tipo === t ? 'border-brand-green bg-brand-green/5' : 'border-gray-200 hover:bg-gray-50'}`}>
              <span className={`inline-block rounded-full px-2 py-0.5 font-body text-xs font-semibold ${TIPO_PQRS_META[t].cls}`}>
                {TIPO_PQRS_META[t].label}
              </span>
              <span className="mt-1 block font-body text-[11px] text-gray-500">{TIPO_PQRS_META[t].desc}</span>
            </button>
          ))}
        </div>
        <p className="font-body text-xs text-gray-500">
          Plazo de respuesta para {TIPO_PQRS_META[tipo].label.toLowerCase()}: <strong>{diasPorDefecto} días hábiles</strong>.
          {coordina ? ' Puedes cambiarlo abajo.' : ''}
        </p>
      </Bloque>

      {/* Dónde */}
      <Bloque titulo="Dónde">
        <Campo etiqueta="Sede" requerido>
          <select value={sedeId} onChange={(e) => setSedeId(e.target.value)} className={CLASE_CONTROL}>
            <option value="">Elige la sede…</option>
            {sedes.map((s) => (
              <option key={s.id} value={s.id}>
                {s.codigo_interno ? `${s.codigo_interno} · ` : ''}{s.nombre}
              </option>
            ))}
          </select>
        </Campo>
        {sede && (sede.zona || sede.ciudad) && (
          <p className="font-body text-xs text-gray-500">
            {[sede.zona, sede.ciudad].filter(Boolean).join(' · ')}
          </p>
        )}
        <Campo etiqueta="Colaborador involucrado" ayuda="Opcional. Solo la planta activa de esta sede.">
          <select value={personaId} onChange={(e) => setPersonaId(e.target.value)} disabled={!sedeId} className={CLASE_CONTROL}>
            <option value="">{sedeId ? 'Ninguno en particular' : 'Elige primero la sede'}</option>
            {personas.map((p) => (
              <option key={p.id} value={p.id}>{p.nombre}{p.cargo ? ` · ${p.cargo}` : ''}</option>
            ))}
          </select>
        </Campo>
      </Bloque>

      {/* Quién radica */}
      <Bloque titulo="Quién radica">
        <label className="flex items-center gap-2 font-body text-sm text-gray-700">
          <input type="checkbox" checked={anonima} onChange={(e) => setAnonima(e.target.checked)}
            className="h-4 w-4 rounded border-gray-300 text-brand-green" />
          Es anónima (no se guarda nombre ni documento)
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          {!anonima && (
            <Campo etiqueta="Nombre" requerido>
              <input value={nombre} onChange={(e) => setNombre(e.target.value)} maxLength={200}
                placeholder="Nombre de quien radica" className={CLASE_CONTROL} />
            </Campo>
          )}
          <Campo etiqueta="En calidad de">
            <select value={calidad} onChange={(e) => setCalidad(e.target.value as CalidadPqrs)} className={CLASE_CONTROL}>
              {CALIDADES_PQRS.map((c) => <option key={c} value={c}>{CALIDAD_PQRS_META[c].label}</option>)}
            </select>
          </Campo>
          {!anonima && (
            <Campo etiqueta="Documento" ayuda="Opcional.">
              <input value={documento} onChange={(e) => setDocumento(e.target.value)} maxLength={30} className={CLASE_CONTROL} />
            </Campo>
          )}
          <Campo etiqueta="Teléfono" ayuda="Para poder responderle.">
            <input value={telefono} onChange={(e) => setTelefono(e.target.value)} maxLength={30} inputMode="tel" className={CLASE_CONTROL} />
          </Campo>
          <Campo etiqueta="Correo" ayuda="Para poder responderle.">
            <input value={email} onChange={(e) => setEmail(e.target.value)} maxLength={160} type="email" className={CLASE_CONTROL} />
          </Campo>
          <Campo etiqueta="Por dónde llegó">
            <select value={canal} onChange={(e) => setCanal(e.target.value as CanalPqrs)} className={CLASE_CONTROL}>
              {CANALES_PQRS_CONSOLA.map((c) => <option key={c} value={c}>{CANAL_PQRS_META[c].label}</option>)}
            </select>
          </Campo>
        </div>
      </Bloque>

      {/* Qué pasó */}
      <Bloque titulo="Qué pasó">
        <Campo etiqueta="Asunto" requerido>
          <input value={asunto} onChange={(e) => setAsunto(e.target.value)} maxLength={200}
            placeholder="En una línea: de qué se trata" className={CLASE_CONTROL} />
        </Campo>
        <Campo etiqueta="Descripción" requerido>
          <textarea value={descripcion} onChange={(e) => setDescripcion(e.target.value)} rows={5}
            placeholder="Qué pasó, cuándo, dónde y qué se pide…" className={CLASE_CONTROL} />
        </Campo>
        <div className="grid gap-3 sm:grid-cols-2">
          <Campo etiqueta="Prioridad">
            <select value={prioridad} onChange={(e) => setPrioridad(e.target.value)} className={CLASE_CONTROL}>
              {PRIORIDADES_PQRS.map((p) => <option key={p} value={p}>{PRIORIDAD_PQRS_META[p].label}</option>)}
            </select>
          </Campo>
          {coordina && (
            <Campo etiqueta="Plazo de respuesta" ayuda={`Días hábiles. Vacío = ${diasPorDefecto} (el del tipo).`}>
              <input value={dias} onChange={(e) => setDias(e.target.value.replace(/\D/g, '').slice(0, 3))}
                inputMode="numeric" placeholder={String(diasPorDefecto)} className={CLASE_CONTROL} />
            </Campo>
          )}
        </div>
      </Bloque>

      {/* Evidencia */}
      <Bloque titulo="Evidencia" ayuda="Opcional: fotos, audios o documentos. También puedes pegar con Ctrl+V.">
        <ArchivosPendientes archivos={archivos} onQuitar={(i) => setArchivos((a) => a.filter((_, j) => j !== i))} />
        <div className="flex flex-wrap items-center gap-1.5">
          <label className="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1.5 font-body text-xs text-gray-600 hover:bg-gray-50">
            <Camera className="w-4 h-4" /> Foto / video
            <input type="file" accept="image/*,video/*" capture="environment" className="hidden"
              onChange={(e) => { elegir(e.target.files); e.target.value = '' }} />
          </label>
          <label className="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1.5 font-body text-xs text-gray-600 hover:bg-gray-50">
            <Paperclip className="w-4 h-4" /> Archivos
            <input type="file" multiple accept="image/*,video/*,audio/*,application/pdf,.doc,.docx,.txt,.csv,.xlsx"
              className="hidden" onChange={(e) => { elegir(e.target.files); e.target.value = '' }} />
          </label>
        </div>
      </Bloque>

      <div className="flex items-center gap-2 pb-2">
        {paso && <span className="flex items-center gap-1 font-body text-xs text-gray-500"><Loader2 className="w-3 h-3 animate-spin" /> {paso}</span>}
        <button type="button" onClick={radicar} disabled={enviando}
          className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-brand-green px-5 py-2.5 font-body text-sm font-semibold text-white hover:bg-brand-green-dark disabled:opacity-50">
          {enviando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} Radicar
        </button>
      </div>
    </div>
  )
}

const CLASE_CONTROL =
  'w-full rounded-lg border border-gray-200 bg-white px-3 py-2 font-body text-sm outline-none focus:border-brand-green'

function Bloque({ titulo, ayuda, children }: { titulo: string; ayuda?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
      <div>
        <h2 className="font-heading text-sm font-semibold text-gray-900">{titulo}</h2>
        {ayuda && <p className="font-body text-xs text-gray-500">{ayuda}</p>}
      </div>
      {children}
    </section>
  )
}

function Campo({ etiqueta, ayuda, requerido, children }: {
  etiqueta: string
  ayuda?: string
  requerido?: boolean
  children: React.ReactNode
}) {
  return (
    <label className="block space-y-1">
      <span className="font-body text-xs font-semibold text-gray-700">
        {etiqueta}{requerido && <span className="text-red-500"> *</span>}
      </span>
      {children}
      {ayuda && <span className="block font-body text-[11px] text-gray-400">{ayuda}</span>}
    </label>
  )
}

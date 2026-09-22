'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { Loader2, Clock, CheckCircle2, Brain, ClipboardCheck, ArrowRight, LogIn, MapPin, AlertTriangle } from 'lucide-react'
import { toast } from 'sonner'
import { getSupabase } from '@/lib/supabase/anon'
import { Field, Input } from '../ui'

/* eslint-disable @typescript-eslint/no-explicit-any */

interface PruebaFila {
  prueba_id: string; codigo: string; nombre: string; tipo: 'APTITUD' | 'CONOCIMIENTOS'; descripcion: string | null
  instrucciones: string | null; tiempo_limite_min: number | null; requiere_firma: boolean; obligatoria: boolean
  intento_id: string | null; intento_estado: string | null; limite_at: string | null; total_preguntas: number
}
interface Pregunta { id: string; orden: number; enunciado: string; opciones: { clave: string; texto: string }[] }

type Fase = 'cargando' | 'sin_sesion' | 'sin_registro' | 'lista' | 'prueba' | 'fin'

export function PruebasClient() {
  const sb = useMemo(() => getSupabase(), [])
  const [fase, setFase] = useState<Fase>('cargando')
  const [cand, setCand] = useState<any>(null)
  const [pruebas, setPruebas] = useState<PruebaFila[]>([])
  const [empresa, setEmpresa] = useState<any>(null)
  const [activa, setActiva] = useState<{ prueba: PruebaFila; intento: any; preguntas: Pregunta[] } | null>(null)

  const cargar = useCallback(async () => {
    const { data: s } = await sb.auth.getSession()
    if (!s.session?.user) { setFase('sin_sesion'); return }
    const [{ data: c }, { data: emp }] = await Promise.all([
      sb.from('candidatos').select('id, nombres, apellidos, numero_documento, estado, cargo_postulacion_id')
        .eq('auth_uid', s.session.user.id).order('updated_at', { ascending: false }).limit(1).maybeSingle(),
      sb.from('vac_empresa').select('razon_social, direccion, ciudad, telefono, correo_seleccion').eq('id', 1).maybeSingle(),
    ])
    setEmpresa(emp)
    if (!c || c.estado === 'BORRADOR') { setFase('sin_registro'); return }
    setCand(c)
    const { data: p, error } = await sb.rpc('vac_pruebas_de_candidato', { p_candidato: c.id })
    if (error) { toast.error(error.message); setFase('lista'); return }
    const lista = (p ?? []) as PruebaFila[]
    setPruebas(lista)
    const pendientes = lista.filter((x) => x.obligatoria && (!x.intento_estado || x.intento_estado === 'EN_CURSO'))
    setFase(lista.length && !pendientes.length ? 'fin' : 'lista')
  }, [sb])

  useEffect(() => { void cargar() }, [cargar])

  async function empezar(p: PruebaFila) {
    const { data: intento, error } = await sb.rpc('vac_iniciar_prueba', { p_prueba: p.prueba_id })
    if (error) { toast.error(error.message); return }
    const { data: preguntas } = await sb.from('vw_prueba_preguntas').select('*').eq('prueba_id', p.prueba_id).order('orden')
    setActiva({ prueba: p, intento, preguntas: (preguntas ?? []) as Pregunta[] })
    setFase('prueba')
    window.scrollTo({ top: 0 })
  }

  if (fase === 'cargando') {
    return <div className="flex justify-center py-24"><Loader2 className="h-8 w-8 animate-spin text-brand-green" /></div>
  }
  if (fase === 'sin_sesion' || fase === 'sin_registro') {
    return (
      <div className="rounded-2xl bg-white p-6 text-center shadow-sm ring-1 ring-gray-100">
        <p className="font-heading text-lg font-bold text-gray-900">{fase === 'sin_sesion' ? 'Ingresa para presentar las pruebas' : 'Primero completa tu registro'}</p>
        <p className="mt-2 text-sm text-gray-500">
          {fase === 'sin_sesion' ? 'Usa tu número de documento y tu contraseña.' : 'Las pruebas se habilitan cuando envías tu hoja de vida.'}
        </p>
        <Link href={fase === 'sin_sesion' ? '/ingresar' : '/registro-vacantes'}
          className="mt-4 inline-flex items-center gap-2 rounded-xl bg-brand-green px-5 py-2.5 font-semibold text-white hover:bg-brand-green-dark">
          <LogIn className="h-4 w-4" /> {fase === 'sin_sesion' ? 'Ingresar' : 'Ir al registro'}
        </Link>
      </div>
    )
  }
  if (fase === 'fin') {
    return (
      <div className="flex flex-col items-center gap-4 rounded-2xl bg-white p-6 py-10 text-center shadow-sm ring-1 ring-gray-100">
        <div className="flex h-20 w-20 items-center justify-center rounded-full bg-brand-green/10"><CheckCircle2 className="h-12 w-12 text-brand-green" /></div>
        <h1 className="font-heading text-2xl font-bold text-gray-900">¡Proceso completado!</h1>
        <p className="max-w-md text-gray-600">Has finalizado todas las pruebas del proceso de selección.</p>
        <div className="w-full max-w-md rounded-xl border-2 border-amber-300 bg-amber-50 p-4 text-left">
          <p className="font-bold uppercase text-amber-900">Es indispensable que te acerques a las oficinas de {empresa?.razon_social ?? 'Conserjes Inmobiliarios'} cuanto antes.</p>
          <p className="mt-2 flex items-start gap-1.5 text-sm text-amber-900"><MapPin className="mt-0.5 h-4 w-4 shrink-0" /> {empresa?.direccion ?? 'Cra 19 No. 166 – 34'}, {empresa?.ciudad ?? 'Bogotá D.C.'}</p>
          {empresa?.telefono && <p className="mt-1 text-sm text-amber-900">Teléfono: {empresa.telefono}</p>}
        </div>
        <Link href="/registro-vacantes/mi-proceso" className="inline-flex items-center gap-2 rounded-xl bg-brand-green px-6 py-3 font-semibold text-white hover:bg-brand-green-dark">
          Ver mi proceso <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
    )
  }
  if (fase === 'prueba' && activa && cand) {
    return (
      <Examen
        prueba={activa.prueba} intento={activa.intento} preguntas={activa.preguntas} cand={cand}
        onTerminado={async (res) => {
          setActiva(null)
          if (res?.estado === 'EXPIRADA') toast.warning('La prueba se envió fuera del tiempo; quedó registrada así.')
          else toast.success('Prueba enviada. ¡Gracias!')
          setFase('cargando')
          await cargar()
        }}
      />
    )
  }

  // Lista de pruebas
  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-gray-100">
        <h1 className="font-heading text-xl font-bold text-gray-900">Pruebas de selección</h1>
        <p className="mt-1 text-sm text-gray-500">Hola {cand?.nombres}. Completarás estas pruebas en este orden. ¡Tómate tu tiempo y responde con sinceridad!</p>
      </div>
      {pruebas.map((p, i) => {
        const hecha = p.intento_estado && p.intento_estado !== 'EN_CURSO'
        const bloqueada = i > 0 && pruebas.slice(0, i).some((x) => x.obligatoria && (!x.intento_estado || x.intento_estado === 'EN_CURSO'))
        return (
          <div key={p.prueba_id} className={'rounded-2xl bg-white p-5 shadow-sm ring-1 ' + (hecha ? 'ring-green-200' : 'ring-gray-100')}>
            <div className="flex items-start gap-3">
              <div className={'flex h-10 w-10 shrink-0 items-center justify-center rounded-full ' + (hecha ? 'bg-green-100 text-green-700' : 'bg-brand-green/10 text-brand-green')}>
                {hecha ? <CheckCircle2 className="h-5 w-5" /> : p.tipo === 'APTITUD' ? <Brain className="h-5 w-5" /> : <ClipboardCheck className="h-5 w-5" />}
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-heading font-bold text-gray-900">{i + 1}. {p.nombre}</p>
                {p.descripcion && <p className="mt-0.5 text-sm text-gray-600">{p.descripcion}</p>}
                <p className="mt-1 text-xs text-gray-400">
                  {p.total_preguntas} preguntas{p.tiempo_limite_min ? ` · ${p.tiempo_limite_min} minutos` : ' · sin tiempo límite'}{p.requiere_firma ? ' · al final firmas con tu nombre' : ''}
                </p>
                {hecha ? (
                  <p className="mt-2 text-sm font-semibold text-green-700">Completada. Ya no se puede repetir.</p>
                ) : (
                  <button type="button" onClick={() => empezar(p)} disabled={bloqueada}
                    className="mt-3 inline-flex items-center gap-2 rounded-xl bg-brand-green px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-green-dark disabled:opacity-40">
                    {p.intento_estado === 'EN_CURSO' ? 'Continuar la prueba' : 'Empezar'} <ArrowRight className="h-4 w-4" />
                  </button>
                )}
                {bloqueada && !hecha && <p className="mt-1 text-xs text-gray-400">Primero termina la prueba anterior.</p>}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── Una prueba en curso ─────────────────────────────────────────────────────
function Examen({
  prueba, intento, preguntas, cand, onTerminado,
}: {
  prueba: PruebaFila; intento: any; preguntas: Pregunta[]; cand: any; onTerminado: (r: any) => void
}) {
  const sb = useMemo(() => getSupabase(), [])
  const clave = `ci-prueba-${intento.id}`
  const [resp, setResp] = useState<Record<string, string>>(() => {
    try { return JSON.parse(sessionStorage.getItem(clave) ?? '{}') } catch { return {} }
  })
  const [firma, setFirma] = useState('')
  const [cedula, setCedula] = useState('')
  const [enviando, setEnviando] = useState(false)
  const limite = intento.limite_at ? new Date(intento.limite_at).getTime() : null
  const [restante, setRestante] = useState<number | null>(limite ? Math.max(0, limite - Date.now()) : null)
  const avisado = useRef(false)

  useEffect(() => {
    try { sessionStorage.setItem(clave, JSON.stringify(resp)) } catch { /* sin almacenamiento: se sigue en memoria */ }
  }, [resp, clave])

  useEffect(() => {
    if (!limite) return
    const t = setInterval(() => {
      const r = Math.max(0, limite - Date.now())
      setRestante(r)
      if (r === 0 && !avisado.current) {
        avisado.current = true
        toast.warning('Se acabó el tiempo. Firma y envía tu prueba ahora.')
      }
    }, 500)
    return () => clearInterval(t)
  }, [limite])

  const agotado = restante === 0
  const respondidas = preguntas.filter((q) => resp[q.id]).length
  const mm = restante !== null ? Math.floor(restante / 60000) : 0
  const ss = restante !== null ? Math.floor((restante % 60000) / 1000) : 0

  async function enviar() {
    if (!agotado && respondidas < preguntas.length && !window.confirm(`Te faltan ${preguntas.length - respondidas} pregunta(s). ¿Enviar de todos modos?`)) return
    if (prueba.requiere_firma) {
      if (firma.trim().split(/\s+/).length < 2) { toast.error('Escribe tu nombre completo como firma.'); return }
      if (cedula.replace(/\D/g, '') !== String(cand.numero_documento).replace(/\D/g, '')) { toast.error('El número de cédula no coincide con el de tu registro.'); return }
    }
    setEnviando(true)
    const { data, error } = await sb.rpc('vac_finalizar_prueba', {
      p_intento: intento.id, p_respuestas: resp, p_firma_nombre: prueba.requiere_firma ? firma.trim().toUpperCase() : null,
      p_firma_documento: prueba.requiere_firma ? cedula.replace(/\D/g, '') : null, p_user_agent: navigator.userAgent,
    })
    setEnviando(false)
    if (error) { toast.error(error.message); return }
    try { sessionStorage.removeItem(clave) } catch { /* nada */ }
    onTerminado(data)
  }

  return (
    <div className="space-y-4">
      <div className="sticky top-[60px] z-30 rounded-2xl bg-white/95 p-4 shadow-sm ring-1 ring-gray-100 backdrop-blur">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate font-heading font-bold text-gray-900">{prueba.nombre}</p>
            <p className="text-xs text-gray-500">{respondidas} de {preguntas.length} respondidas</p>
          </div>
          {restante !== null && (
            <span className={'flex shrink-0 items-center gap-1 rounded-lg px-3 py-1.5 font-mono text-lg font-bold ' +
              (restante < 60000 ? 'bg-red-100 text-red-700' : restante < 180000 ? 'bg-amber-100 text-amber-800' : 'bg-brand-green/10 text-brand-green')}>
              <Clock className="h-4 w-4" /> {String(mm).padStart(2, '0')}:{String(ss).padStart(2, '0')}
            </span>
          )}
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-gray-100">
          <div className="h-full rounded-full bg-brand-green transition-all" style={{ width: `${preguntas.length ? (respondidas / preguntas.length) * 100 : 0}%` }} />
        </div>
      </div>

      {prueba.instrucciones && <p className="rounded-xl bg-brand-green-bg/60 p-4 text-sm text-gray-700">{prueba.instrucciones}</p>}

      {prueba.requiere_firma && (
        <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-gray-100">
          <p className="mb-2 text-sm font-semibold text-gray-700">Datos del postulante</p>
          <dl className="grid grid-cols-2 gap-2 text-sm">
            <dt className="text-gray-500">Cédula</dt><dd className="font-medium">{cand.numero_documento}</dd>
            <dt className="text-gray-500">Nombre</dt><dd className="font-medium">{cand.nombres} {cand.apellidos}</dd>
            <dt className="text-gray-500">Fecha</dt><dd className="font-medium">{new Date().toLocaleDateString('es-CO')}</dd>
          </dl>
        </div>
      )}

      {preguntas.map((q, i) => (
        <fieldset key={q.id} disabled={agotado} className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-gray-100 disabled:opacity-70">
          <legend className="sr-only">Pregunta {i + 1}</legend>
          <p className="font-body font-semibold text-gray-900">{i + 1}. {q.enunciado}</p>
          <div className="mt-3 space-y-2">
            {q.opciones.map((o) => {
              const sel = resp[q.id] === o.clave
              return (
                <label key={o.clave} className={'flex cursor-pointer items-start gap-3 rounded-xl border-2 p-3 text-sm transition-colors ' +
                  (sel ? 'border-brand-green bg-brand-green/5' : 'border-gray-200 hover:border-brand-green/40')}>
                  <input type="radio" name={q.id} checked={sel} onChange={() => setResp({ ...resp, [q.id]: o.clave })} className="mt-0.5 h-4 w-4 accent-[#2E7D32]" />
                  <span><strong className="mr-1">{prueba.tipo === 'APTITUD' ? o.clave : o.clave.toLowerCase()})</strong>{o.texto}</span>
                </label>
              )
            })}
          </div>
        </fieldset>
      ))}

      {prueba.requiere_firma && (
        <div className="space-y-4 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-gray-100">
          <p className="font-heading font-bold text-gray-900">Firma y verificación</p>
          {agotado && <p className="flex items-center gap-1.5 rounded-lg bg-amber-50 p-2 text-sm text-amber-900"><AlertTriangle className="h-4 w-4" /> Se acabó el tiempo: firma y envía.</p>}
          <Field label="Firma del postulante" req hint="Escribe tu nombre completo como firma">
            <Input value={firma} onChange={(e) => setFirma(e.target.value)} placeholder="NOMBRES Y APELLIDOS" autoComplete="name" />
          </Field>
          <Field label="Cédula (verificación)" req hint="Ingresa tu número de cédula">
            <Input inputMode="numeric" value={cedula} onChange={(e) => setCedula(e.target.value.replace(/\D/g, ''))} />
          </Field>
        </div>
      )}

      <button type="button" onClick={enviar} disabled={enviando}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand-green py-3.5 font-body text-base font-semibold text-white hover:bg-brand-green-dark disabled:opacity-50">
        {enviando ? <Loader2 className="h-5 w-5 animate-spin" /> : <CheckCircle2 className="h-5 w-5" />} {prueba.requiere_firma ? 'Finalizar prueba' : 'Enviar prueba'}
      </button>
    </div>
  )
}

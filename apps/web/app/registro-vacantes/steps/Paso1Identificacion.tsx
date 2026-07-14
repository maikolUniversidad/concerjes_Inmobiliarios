'use client'

import { useState } from 'react'
import { Loader2, IdCard, ScanFace, ArrowRight } from 'lucide-react'
import { toast } from 'sonner'
import type { WizardCtx } from '../RegistroWizard'
import { Field, Input, Select, SiNo } from '../ui'
import { CapturaFacial, type ResultadoFacial } from '../CapturaFacial'
import { TIPOS_DOC } from '@/lib/registro/tipos'
import { crearCandidato, identificarPorDocumento, registrarConsentimientos } from '@/lib/registro/datos'
import {
  CONSENTIMIENTO_DATOS, CONSENTIMIENTO_BIOMETRICO, VERSION_CONSENTIMIENTOS, hashTexto,
} from '@/lib/registro/consentimientos'

export function Paso1Identificacion({ ctx }: { ctx: WizardCtx }) {
  const { form, update, setCandidatoId, consentBiometrico, next, goTo } = ctx
  const [antes, setAntes] = useState<boolean | null>(form.ha_hecho_proceso_antes ?? null)
  const [trabajado, setTrabajado] = useState<boolean | null>(form.ha_trabajado_antes ?? null)
  const [tipo, setTipo] = useState(form.tipo_documento)
  const [numero, setNumero] = useState(form.numero_documento)
  const [ultimos4, setUltimos4] = useState('')
  const [necesita2fa, setNecesita2fa] = useState(false)
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [mostrarCamara, setMostrarCamara] = useState(false)

  async function registrarConsentimientosDe(candidatoId: string) {
    const consentimientos = [
      { tipo: 'DATOS_PERSONALES', otorgado: true, texto_version: VERSION_CONSENTIMIENTOS, texto_hash: await hashTexto(CONSENTIMIENTO_DATOS) },
    ]
    if (consentBiometrico) {
      consentimientos.push({
        tipo: 'BIOMETRICO', otorgado: true, texto_version: VERSION_CONSENTIMIENTOS,
        texto_hash: await hashTexto(CONSENTIMIENTO_BIOMETRICO),
      })
    }
    await registrarConsentimientos(candidatoId, consentimientos)
  }

  async function reanudarExistente(cand: Record<string, unknown>) {
    setCandidatoId(cand.id as string)
    update(cand as never)
    toast.success(`Hola ${cand.nombres ?? ''}, retomamos tu registro.`)
    goTo(2)
  }

  async function continuar() {
    setError(null)
    const num = numero.trim()
    if (!num || num.length < 4) { setError('Escribe tu número de documento completo.'); return }
    setCargando(true)
    try {
      // 1) ¿Ya existe un registro con este documento?
      const r = await identificarPorDocumento(tipo, num)
      if (r.encontrado) {
        setNecesita2fa(true)
        setCargando(false)
        return
      }
      // 2) Registro nuevo.
      const c = await crearCandidato(tipo, num, { antes, trabajado })
      if (c.duplicado) { setNecesita2fa(true); setCargando(false); return }
      if (c.error || !c.id) { setError(c.error ?? 'No se pudo crear el registro.'); setCargando(false); return }
      setCandidatoId(c.id)
      update({
        tipo_documento: tipo, numero_documento: num,
        ha_hecho_proceso_antes: antes, ha_trabajado_antes: trabajado,
      })
      await registrarConsentimientosDe(c.id)
      next()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ocurrió un error.')
    } finally {
      setCargando(false)
    }
  }

  async function verificar2fa() {
    setError(null)
    if (ultimos4.trim().length !== 4) { setError('Escribe los últimos 4 dígitos.'); return }
    setCargando(true)
    try {
      const r = await identificarPorDocumento(tipo, numero.trim(), ultimos4)
      if (r.candidato) { await reanudarExistente(r.candidato as never) }
      else setError(r.error ?? 'No pudimos verificar. Revisa los datos.')
    } finally {
      setCargando(false)
    }
  }

  // El biométrico solo SUGIERE identidad: cualquier resultado enruta a confirmar
  // con el documento (Ruta B). Nunca autentica por sí solo.
  function onResultadoFacial(r: ResultadoFacial) {
    if (r.disponible === false) {
      toast.info('La identificación por rostro no está disponible por ahora. Usa tu documento.')
      return
    }
    switch (r.resultado) {
      case 'MATCH':
        toast.success('Te reconocimos. Confirma tu documento para continuar de forma segura.')
        break
      case 'DUDA':
        toast.info('No estamos seguros de reconocerte. Continúa con tu documento.')
        break
      case 'NO_MATCH':
        toast.info('No encontramos un registro previo. Continúa con tu documento.')
        break
      default:
        toast.info('Continúa con tu documento.')
    }
  }

  if (necesita2fa) {
    return (
      <div className="space-y-5">
        <div>
          <h2 className="font-heading text-xl font-bold text-gray-900">Ya tienes un registro</h2>
          <p className="mt-1 text-sm text-gray-500">
            Para proteger tus datos, confirma los <strong>últimos 4 dígitos</strong> de tu documento.
          </p>
        </div>
        <Field label="Últimos 4 dígitos del documento" req error={error ?? undefined}>
          <Input
            inputMode="numeric" maxLength={4} value={ultimos4}
            onChange={(e) => setUltimos4(e.target.value.replace(/\D/g, ''))}
            placeholder="0000" className="tracking-widest"
          />
        </Field>
        <div className="flex gap-3">
          <button type="button" onClick={() => { setNecesita2fa(false); setUltimos4('') }}
            className="flex-1 rounded-xl border border-gray-300 py-3 font-body font-semibold text-gray-600">
            Volver
          </button>
          <button type="button" onClick={verificar2fa} disabled={cargando}
            className="flex-1 rounded-xl bg-brand-green py-3 font-body font-semibold text-white disabled:opacity-50">
            {cargando ? <Loader2 className="mx-auto h-5 w-5 animate-spin" /> : 'Confirmar'}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="font-heading text-xl font-bold text-gray-900">Identifícate</h2>
        <p className="mt-1 text-sm text-gray-500">Con tu documento empezamos o retomamos tu hoja de vida.</p>
      </div>

      <Field label="¿Habías hecho el proceso de contratación con nosotros antes?">
        <SiNo value={antes} onChange={setAntes} />
      </Field>
      <Field label="¿Habías trabajado con nosotros antes?">
        <SiNo value={trabajado} onChange={setTrabajado} />
      </Field>

      <div className="rounded-xl border border-gray-200 p-4">
        <div className="mb-3 flex items-center gap-2 text-brand-green">
          <IdCard className="h-5 w-5" />
          <span className="font-body text-sm font-semibold">Con tu documento</span>
        </div>
        <div className="space-y-4">
          <Field label="Tipo de documento" req>
            <Select value={tipo} onChange={(e) => setTipo(e.target.value as typeof tipo)}>
              {TIPOS_DOC.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </Select>
          </Field>
          <Field label="Número de documento" req error={error ?? undefined}>
            <Input
              inputMode="numeric" value={numero}
              onChange={(e) => setNumero(e.target.value.replace(/[^0-9A-Za-z]/g, ''))}
              placeholder="1020304050"
            />
          </Field>
          <button type="button" onClick={continuar} disabled={cargando}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand-green py-3.5 font-body text-base font-semibold text-white transition-colors hover:bg-brand-green-dark disabled:opacity-50">
            {cargando ? <Loader2 className="h-5 w-5 animate-spin" /> : <>Continuar <ArrowRight className="h-5 w-5" /></>}
          </button>
        </div>
      </div>

      {/* Ruta A — facial (opcional, solo si autorizó). Cae a documento si no está disponible. */}
      {consentBiometrico && (
        <div className="rounded-xl border border-dashed border-gray-300 p-4 text-center">
          <button type="button" onClick={() => setMostrarCamara(true)} disabled={cargando}
            className="mx-auto flex items-center gap-2 font-body text-sm font-semibold text-brand-green">
            <ScanFace className="h-5 w-5" /> Identificarme con mi rostro
          </button>
          <p className="mt-1 text-xs text-gray-400">Opcional. Si no está disponible, sigue con tu documento.</p>
        </div>
      )}

      {mostrarCamara && (
        <CapturaFacial
          modo="identificar"
          onResultado={onResultadoFacial}
          onCerrar={() => setMostrarCamara(false)}
        />
      )}
    </div>
  )
}

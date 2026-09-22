'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Loader2, Check, ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'
import {
  fetchCatalogos, cargarCandidatoActual, guardarCandidato, cargarDireccion, cargarBeneficiarios, cargarHojaVida,
  type Credenciales,
} from '@/lib/registro/datos'
import type { Catalogos, CandidatoForm, DireccionForm, Beneficiario, Estudio, Experiencia, Referencia } from '@/lib/registro/tipos'
import { Paso0Consentimientos } from './steps/Paso0Consentimientos'
import { Paso1Identificacion } from './steps/Paso1Identificacion'
import { Paso2Formulario } from './steps/Paso2Formulario'
import { Paso3Documentos } from './steps/Paso3Documentos'
import { Paso4Revision } from './steps/Paso4Revision'
import { Paso5Envio } from './steps/Paso5Envio'

const PASOS = ['Permisos', 'Identidad', 'Datos', 'Documentos', 'Revisión', 'Listo']

export interface WizardCtx {
  catalogos: Catalogos
  form: CandidatoForm
  update: (patch: Partial<CandidatoForm>) => void
  candidatoId: string | null
  setCandidatoId: (id: string) => void
  direccion: DireccionForm
  setDireccion: (d: DireccionForm) => void
  beneficiarios: Beneficiario[]
  setBeneficiarios: (b: Beneficiario[]) => void
  estudios: Estudio[]
  setEstudios: (e: Estudio[]) => void
  experiencias: Experiencia[]
  setExperiencias: (e: Experiencia[]) => void
  referencias: Referencia[]
  setReferencias: (r: Referencia[]) => void
  consentBiometrico: boolean
  vacanteSlug: string | null
  setCredenciales: (c: Credenciales) => void
  next: () => void
  prev: () => void
  goTo: (n: number) => void
}

/** Dos referencias familiares y dos personales, como pide la actualización de datos. */
const REFERENCIAS_VACIAS: Referencia[] = [
  { tipo: 'FAMILIAR', nombre: '' }, { tipo: 'FAMILIAR', nombre: '' },
  { tipo: 'PERSONAL', nombre: '' }, { tipo: 'PERSONAL', nombre: '' },
]

const FORM_VACIO: CandidatoForm = {
  tipo_documento: 'CC',
  numero_documento: '',
  nacionalidad: 'COLOMBIANA',
}

export function RegistroWizard() {
  const search = useSearchParams()
  const router = useRouter()
  const vacanteSlug = search.get('vacante')

  const [cargando, setCargando] = useState(true)
  const [errorCarga, setErrorCarga] = useState<string | null>(null)
  const [paso, setPaso] = useState(0)
  const [catalogos, setCatalogos] = useState<Catalogos | null>(null)
  const [candidatoId, setCandidatoIdState] = useState<string | null>(null)
  const [form, setForm] = useState<CandidatoForm>(FORM_VACIO)
  const [direccion, setDireccion] = useState<DireccionForm>({ direccion: '' })
  const [beneficiarios, setBeneficiarios] = useState<Beneficiario[]>([])
  const [estudios, setEstudios] = useState<Estudio[]>([{ nivel: 'SECUNDARIA' }])
  const [experiencias, setExperiencias] = useState<Experiencia[]>([])
  const [referencias, setReferencias] = useState<Referencia[]>(REFERENCIAS_VACIAS)
  const [consentBiometrico, setConsentBiometrico] = useState(false)
  const [credenciales, setCredenciales] = useState<Credenciales | null>(null)

  const dirtyRef = useRef(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Carga inicial: catálogos + reanudar si hay registro previo ──────────────
  useEffect(() => {
    let vivo = true
    let redirige = false
    ;(async () => {
      try {
        const cat = await fetchCatalogos()
        if (!vivo) return
        setCatalogos(cat)
        const previo = await cargarCandidatoActual()
        if (previo && vivo) {
          // Quien ya envió su registro sigue su proceso en "Mi proceso"
          // (pruebas, documentos para firmar y estado).
          if (previo.estado && previo.estado !== 'BORRADOR') {
            redirige = true
            router.replace('/registro-vacantes/mi-proceso')
            return
          }
          setCandidatoIdState(previo.id!)
          setForm({ ...FORM_VACIO, ...previo })
          const [dir, bens, hv] = await Promise.all([
            cargarDireccion(previo.id!), cargarBeneficiarios(previo.id!), cargarHojaVida(previo.id!),
          ])
          if (dir) setDireccion(dir)
          if (bens.length) setBeneficiarios(bens)
          if (hv.estudios.length) setEstudios(hv.estudios)
          if (hv.experiencias.length) setExperiencias(hv.experiencias)
          if (hv.referencias.length) {
            // Completa hasta 2 + 2 renglones para que el formulario se vea igual.
            const fam = hv.referencias.filter((r) => r.tipo === 'FAMILIAR')
            const per = hv.referencias.filter((r) => r.tipo === 'PERSONAL')
            while (fam.length < 2) fam.push({ tipo: 'FAMILIAR', nombre: '' })
            while (per.length < 2) per.push({ tipo: 'PERSONAL', nombre: '' })
            setReferencias([...fam, ...per, ...hv.referencias.filter((r) => r.tipo === 'LABORAL')])
          }
          // Reanuda donde quedó (mínimo el paso 2 = formulario).
          setPaso(Math.max(2, Math.min(4, previo.paso_actual ?? 2)))
          toast.info('Retomamos tu registro donde lo dejaste.')
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'No se pudo iniciar.'
        if (vivo) setErrorCarga(msg)
        toast.error(msg)
      } finally {
        if (vivo && !redirige) setCargando(false)
      }
    })()
    return () => { vivo = false }
  }, [router])

  // ── Autosave con rebote (solo cuando ya existe el candidato) ────────────────
  const update = useCallback((patch: Partial<CandidatoForm>) => {
    setForm((prev) => ({ ...prev, ...patch }))
    dirtyRef.current = true
  }, [])

  useEffect(() => {
    if (!candidatoId || !dirtyRef.current) return
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(async () => {
      dirtyRef.current = false
      // No enviar id/estado en el patch de autosave.
      const { id, estado, paso_actual, ...campos } = form
      void id; void estado; void paso_actual
      const err = await guardarCandidato(candidatoId, campos)
      if (err) toast.error('No se pudo guardar automáticamente.')
    }, 1200)
    return () => { if (timerRef.current) clearTimeout(timerRef.current) }
  }, [form, candidatoId])

  const setCandidatoId = useCallback((id: string) => setCandidatoIdState(id), [])

  const persistPaso = useCallback((n: number) => {
    if (candidatoId) void guardarCandidato(candidatoId, { paso_actual: n })
  }, [candidatoId])

  const goTo = useCallback((n: number) => {
    setPaso(n); persistPaso(n)
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [persistPaso])
  const next = useCallback(() => goTo(Math.min(5, paso + 1)), [goTo, paso])
  const prev = useCallback(() => goTo(Math.max(0, paso - 1)), [goTo, paso])

  if (!cargando && (errorCarga || !catalogos)) {
    return (
      <div className="rounded-2xl bg-white p-6 text-center shadow-sm ring-1 ring-gray-100">
        <p className="font-heading text-lg font-bold text-gray-900">No pudimos cargar el registro</p>
        <p className="mt-2 text-sm text-gray-500">
          {errorCarga ?? 'Intenta de nuevo en unos minutos.'}
        </p>
        <button onClick={() => window.location.reload()}
          className="mt-4 rounded-xl bg-brand-green px-5 py-2.5 font-body font-semibold text-white hover:bg-brand-green-dark">
          Reintentar
        </button>
      </div>
    )
  }

  if (cargando || !catalogos) {
    return (
      <div className="flex flex-col items-center gap-3 py-24 text-gray-500">
        <Loader2 className="h-8 w-8 animate-spin text-brand-green" />
        <p>Preparando tu registro…</p>
      </div>
    )
  }

  const ctx: WizardCtx = {
    catalogos, form, update, candidatoId, setCandidatoId,
    direccion, setDireccion, beneficiarios, setBeneficiarios,
    estudios, setEstudios, experiencias, setExperiencias, referencias, setReferencias,
    consentBiometrico, vacanteSlug, setCredenciales, next, prev, goTo,
  }

  return (
    <div>
      {/* Barra de progreso */}
      {paso < 5 && (
        <div className="mb-6">
          <div className="mb-2 flex items-center justify-between">
            {PASOS.map((p, i) => (
              <div key={p} className="flex flex-1 flex-col items-center">
                <div
                  className={
                    'flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold transition-colors ' +
                    (i < paso
                      ? 'bg-brand-green text-white'
                      : i === paso
                        ? 'bg-brand-green text-white ring-4 ring-brand-green/20'
                        : 'bg-gray-200 text-gray-500')
                  }
                >
                  {i < paso ? <Check className="h-4 w-4" /> : i + 1}
                </div>
                <span className={'mt-1 hidden text-[11px] sm:block ' + (i <= paso ? 'text-brand-green' : 'text-gray-400')}>
                  {p}
                </span>
              </div>
            ))}
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-200">
            <div className="h-full rounded-full bg-brand-green transition-all" style={{ width: `${(paso / 5) * 100}%` }} />
          </div>
        </div>
      )}

      <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-gray-100 sm:p-7">
        {paso === 0 && (
          <Paso0Consentimientos
            onContinuar={(bio) => { setConsentBiometrico(bio); next() }}
          />
        )}
        {paso === 1 && <Paso1Identificacion ctx={ctx} />}
        {paso === 2 && <Paso2Formulario ctx={ctx} />}
        {paso === 3 && <Paso3Documentos ctx={ctx} />}
        {paso === 4 && <Paso4Revision ctx={ctx} />}
        {paso === 5 && <Paso5Envio candidatoId={candidatoId} consentBiometrico={consentBiometrico} credenciales={credenciales} />}
      </div>

      {paso < 5 && (
        <p className="mt-4 flex items-center justify-center gap-1.5 text-center text-xs text-gray-400">
          <ShieldCheck className="h-3.5 w-3.5" /> Tus datos se guardan solos. Puedes cerrar y volver cuando quieras.
        </p>
      )}
    </div>
  )
}

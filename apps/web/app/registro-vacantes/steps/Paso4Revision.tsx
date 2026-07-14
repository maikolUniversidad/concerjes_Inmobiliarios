'use client'

import { useState } from 'react'
import { Loader2, Send } from 'lucide-react'
import { toast } from 'sonner'
import type { WizardCtx } from '../RegistroWizard'
import { registrarConsentimientos, enviarPostulacion, guardarCandidato, crearCuentaAcceso } from '@/lib/registro/datos'
import { VERSION_CONSENTIMIENTOS, hashTexto } from '@/lib/registro/consentimientos'

const DECLARACIONES = [
  { tipo: 'VERACIDAD', req: true, texto: 'Declaro que la información suministrada es veraz y autorizo su verificación.' },
  { tipo: 'REFERENCIAS', req: true, texto: 'Autorizo la verificación de mis referencias laborales y personales.' },
  { tipo: 'LISTAS_RESTRICTIVAS', req: true, texto: 'Autorizo la consulta en listas restrictivas y de control (SARLAFT/OFAC).' },
  { tipo: 'ANTECEDENTES', req: true, texto: 'Autorizo la consulta de mis antecedentes (Policía, Procuraduría, Contraloría, RNMC).' },
  { tipo: 'NOTIFICACIONES', req: false, texto: 'Autorizo recibir notificaciones por correo y WhatsApp.' },
]

export function Paso4Revision({ ctx }: { ctx: WizardCtx }) {
  const { form, candidatoId, direccion, catalogos, vacanteSlug, setCredenciales, goTo, prev } = ctx
  const [marcadas, setMarcadas] = useState<Record<string, boolean>>({})
  const [enviando, setEnviando] = useState(false)

  const nombreMun = (cod?: string | null) => catalogos.municipios.find((m) => m.codigo_dane === cod)?.nombre ?? '—'
  const nombreCat = (arr: { id: string; nombre: string }[], id?: string | null) => arr.find((o) => o.id === id)?.nombre ?? '—'

  const faltanReq = DECLARACIONES.some((d) => d.req && !marcadas[d.tipo])

  async function enviar() {
    if (!candidatoId) return
    if (faltanReq) { toast.error('Debes aceptar las autorizaciones obligatorias.'); return }
    setEnviando(true)
    try {
      const consentimientos = await Promise.all(
        DECLARACIONES.filter((d) => marcadas[d.tipo]).map(async (d) => ({
          tipo: d.tipo, otorgado: true, texto_version: VERSION_CONSENTIMIENTOS, texto_hash: await hashTexto(d.texto),
        }))
      )
      await registrarConsentimientos(candidatoId, consentimientos)
      await guardarCandidato(candidatoId, { paso_actual: 4 })
      // vacanteSlug se resuelve a vacante_id en backoffice; aquí lo dejamos sin vincular.
      void vacanteSlug
      const err = await enviarPostulacion(candidatoId, null)
      if (err) { toast.error(err); return }
      // Crea la cuenta de acceso (sesión anónima → permanente), ligada a su info.
      const cuenta = await crearCuentaAcceso()
      if (cuenta.credenciales) setCredenciales(cuenta.credenciales)
      else if (cuenta.error && !cuenta.yaExiste) console.warn('crear-cuenta:', cuenta.error)
      goTo(5)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se pudo enviar.')
    } finally {
      setEnviando(false)
    }
  }

  const dato = (label: string, valor: React.ReactNode) => (
    <div className="flex justify-between gap-3 py-1.5 text-sm">
      <span className="text-gray-500">{label}</span>
      <span className="text-right font-medium text-gray-800">{valor || '—'}</span>
    </div>
  )

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-heading text-xl font-bold text-gray-900">Revisa y confirma</h2>
        <p className="mt-1 text-sm text-gray-500">Verifica que todo esté bien antes de enviar.</p>
      </div>

      <div className="divide-y divide-gray-100 rounded-xl border border-gray-200 px-4">
        {dato('Nombre', `${form.nombres ?? ''} ${form.apellidos ?? ''}`.trim())}
        {dato('Documento', `${form.tipo_documento} ${form.numero_documento}`)}
        {dato('Celular', form.celular)}
        {dato('Correo', form.email)}
        {dato('Dirección', direccion.direccion)}
        {dato('Ciudad', nombreMun(direccion.municipio_codigo))}
        {dato('EPS', nombreCat(catalogos.eps, form.eps_id))}
        {dato('Cargo', nombreCat(catalogos.cargos, form.cargo_postulacion_id))}
      </div>

      <div className="space-y-2">
        <p className="font-body text-sm font-semibold text-gray-700">Autorizaciones</p>
        {DECLARACIONES.map((d) => (
          <label key={d.tipo} className="flex cursor-pointer gap-3 rounded-lg border border-gray-200 p-3 has-[:checked]:border-brand-green has-[:checked]:bg-brand-green/5">
            <input
              type="checkbox"
              checked={!!marcadas[d.tipo]}
              onChange={(e) => setMarcadas((m) => ({ ...m, [d.tipo]: e.target.checked }))}
              className="mt-0.5 h-5 w-5 shrink-0 accent-[#2E7D32]"
            />
            <span className="text-sm text-gray-700">
              {d.texto} {d.req && <span className="text-red-500">*</span>}
            </span>
          </label>
        ))}
      </div>

      <div className="flex gap-3">
        <button type="button" onClick={prev} className="rounded-xl border border-gray-300 px-5 py-3 font-body font-semibold text-gray-600">Atrás</button>
        <button type="button" onClick={enviar} disabled={enviando || faltanReq}
          className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-brand-green py-3 font-body text-base font-semibold text-white hover:bg-brand-green-dark disabled:opacity-50">
          {enviando ? <Loader2 className="h-5 w-5 animate-spin" /> : <><Send className="h-5 w-5" /> Enviar mi registro</>}
        </button>
      </div>
    </div>
  )
}

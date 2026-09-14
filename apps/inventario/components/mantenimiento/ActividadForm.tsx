'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ClipboardCheck, Loader2, Check, X as XIcon } from 'lucide-react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import {
  ACTIVIDADES_SEDE, ACTIVIDADES_TECNICO, CHECKLIST_INSPECCION, CONDICION_META, TIPO_ACTIVIDAD_META, subirArchivoMant,
} from '@/lib/mantenimiento'
import { Hoja, inputMant, labelMant } from './Hoja'
import { FotosPicker } from './FotosPicker'

export function ActividadForm({ abierta, onClose, maquina, esTecnico, ticketId, onNovedad }: {
  abierta: boolean
  onClose: () => void
  maquina: { id: string; codigo: string; nombre: string; condicion: string }
  esTecnico: boolean
  ticketId?: string
  /** Si la actividad terminó con novedad, ofrecer reportar la falla. */
  onNovedad?: () => void
}) {
  const router = useRouter()
  const tipos = esTecnico ? ACTIVIDADES_TECNICO : ACTIVIDADES_SEDE
  const [tipo, setTipo] = useState<string>(esTecnico && ticketId ? 'REVISION' : 'INSPECCION')
  const [checks, setChecks] = useState<Record<string, boolean | null>>(
    () => Object.fromEntries(CHECKLIST_INSPECCION.map((i) => [i, null])))
  const [resultadoManual, setResultadoManual] = useState<'OK' | 'NOVEDAD'>('OK')
  const [condicion, setCondicion] = useState(maquina.condicion || 'BUENA')
  const [descripcion, setDescripcion] = useState('')
  const [fotos, setFotos] = useState<File[]>([])
  const [enviando, setEnviando] = useState(false)

  const conChecklist = tipo === 'INSPECCION'
  const algunaFalla = conChecklist && Object.values(checks).some((v) => v === false)
  const resultado: 'OK' | 'NOVEDAD' = conChecklist ? (algunaFalla ? 'NOVEDAD' : 'OK') : resultadoManual

  async function guardar() {
    if (conChecklist && Object.values(checks).some((v) => v === null)) {
      toast.error('Marca cada punto de la inspección como bien o con novedad.'); return
    }
    if (resultado === 'NOVEDAD' && !descripcion.trim()) { toast.error('Describe la novedad encontrada.'); return }
    setEnviando(true)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = createClient() as any
    try {
      const rutas: string[] = []
      for (const f of fotos) rutas.push(await subirArchivoMant(sb, maquina.id, 'actividades', f))
      const { error } = await sb.rpc('mant_registrar_actividad', {
        p_maquinaria: maquina.id,
        p_tipo: tipo,
        p_resultado: resultado,
        p_descripcion: descripcion.trim() || null,
        p_checklist: conChecklist ? Object.entries(checks).map(([item, ok]) => ({ item, ok: !!ok })) : [],
        p_fotos: rutas,
        p_condicion: condicion,
        p_ticket: ticketId ?? null,
      })
      if (error) throw new Error(error.message)
      toast.success('Actividad registrada.')
      onClose()
      router.refresh()
      if (resultado === 'NOVEDAD' && onNovedad && !ticketId) onNovedad()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se pudo registrar.')
    } finally { setEnviando(false) }
  }

  return (
    <Hoja abierta={abierta} onClose={enviando ? () => {} : onClose} titulo="Registrar actividad"
      icono={<ClipboardCheck className="w-4 h-4 text-brand-green" />}
      pie={
        <button onClick={guardar} disabled={enviando}
          className="w-full flex items-center justify-center gap-2 rounded-xl bg-brand-green py-3 text-white font-semibold text-sm hover:bg-brand-green-dark disabled:opacity-60">
          {enviando && <Loader2 className="w-4 h-4 animate-spin" />} Guardar actividad
        </button>
      }>
      <div className="rounded-lg bg-gray-50 px-3 py-2 text-sm">
        <span className="font-mono text-xs text-gray-500">{maquina.codigo}</span> · <span className="text-gray-800">{maquina.nombre}</span>
      </div>

      <div>
        <label className={labelMant}>Actividad</label>
        <select value={tipo} onChange={(e) => setTipo(e.target.value)} className={inputMant}>
          {tipos.map((t) => <option key={t} value={t}>{TIPO_ACTIVIDAD_META[t].label}</option>)}
        </select>
      </div>

      {conChecklist ? (
        <div>
          <span className={labelMant}>Lista de chequeo</span>
          <ul className="divide-y divide-gray-50 rounded-xl border border-gray-100">
            {CHECKLIST_INSPECCION.map((item) => (
              <li key={item} className="flex items-center gap-2 px-3 py-2">
                <span className="flex-1 text-sm text-gray-700">{item}</span>
                <button type="button" onClick={() => setChecks((c) => ({ ...c, [item]: true }))} aria-label={`${item}: bien`}
                  className={`rounded-lg p-1.5 ${checks[item] === true ? 'bg-green-500 text-white' : 'bg-gray-100 text-gray-400'}`}><Check className="w-4 h-4" /></button>
                <button type="button" onClick={() => setChecks((c) => ({ ...c, [item]: false }))} aria-label={`${item}: con novedad`}
                  className={`rounded-lg p-1.5 ${checks[item] === false ? 'bg-red-500 text-white' : 'bg-gray-100 text-gray-400'}`}><XIcon className="w-4 h-4" /></button>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div>
          <span className={labelMant}>Resultado</span>
          <div className="grid grid-cols-2 gap-2">
            {(['OK', 'NOVEDAD'] as const).map((r) => (
              <button key={r} type="button" onClick={() => setResultadoManual(r)}
                className={`rounded-lg border py-2 text-sm font-medium ${resultadoManual === r
                  ? r === 'OK' ? 'border-green-400 bg-green-50 text-green-700' : 'border-red-400 bg-red-50 text-red-700'
                  : 'border-gray-200 text-gray-600'}`}>
                {r === 'OK' ? 'Sin novedad' : 'Con novedad'}
              </button>
            ))}
          </div>
        </div>
      )}

      <div>
        <span className={labelMant}>Condición física del equipo</span>
        <div className="grid grid-cols-3 gap-2">
          {Object.entries(CONDICION_META).map(([k, m]) => (
            <button key={k} type="button" onClick={() => setCondicion(k)}
              className={`rounded-lg border py-2 text-xs font-semibold ${condicion === k ? `${m.cls} border-transparent` : 'border-gray-200 text-gray-500'}`}>
              {m.label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className={labelMant}>Observaciones {resultado === 'NOVEDAD' && <span className="text-red-500">*</span>}</label>
        <textarea value={descripcion} onChange={(e) => setDescripcion(e.target.value)} rows={3} className={`${inputMant} resize-none`}
          placeholder={resultado === 'NOVEDAD' ? '¿Qué novedad encontraste?' : 'Opcional'} />
      </div>

      <div>
        <span className={labelMant}>Fotos</span>
        <FotosPicker fotos={fotos} onChange={setFotos} max={4} />
      </div>
    </Hoja>
  )
}

'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, Loader2, Headset } from 'lucide-react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { PRIORIDADES, PRIORIDAD_META, TIPO_TICKET_META, subirArchivoMant } from '@/lib/mantenimiento'
import { Hoja, inputMant, labelMant } from './Hoja'
import { FotosPicker } from './FotosPicker'

type Modo = 'CORRECTIVO' | 'SOPORTE_REMOTO' | 'PREVENTIVO' | 'INSPECCION'

export function ReportarFallaForm({ abierta, onClose, maquina, modoInicial = 'CORRECTIVO', esTecnico }: {
  abierta: boolean
  onClose: () => void
  maquina: { id: string; codigo: string; nombre: string }
  modoInicial?: Modo
  esTecnico: boolean
}) {
  const router = useRouter()
  const [tipo, setTipo] = useState<Modo>(modoInicial)
  const [funciona, setFunciona] = useState<'SI' | 'CON_FALLA' | 'NO'>('CON_FALLA')
  const [prioridad, setPrioridad] = useState<string>('MEDIA')
  const [titulo, setTitulo] = useState('')
  const [descripcion, setDescripcion] = useState('')
  const [programado, setProgramado] = useState('')
  const [fotos, setFotos] = useState<File[]>([])
  const [enviando, setEnviando] = useState(false)
  const [paso, setPaso] = useState('')

  const tipos: Modo[] = esTecnico ? ['CORRECTIVO', 'SOPORTE_REMOTO', 'PREVENTIVO', 'INSPECCION'] : ['CORRECTIVO', 'SOPORTE_REMOTO']
  const programable = tipo === 'PREVENTIVO' || tipo === 'INSPECCION'

  async function enviar() {
    if (!titulo.trim()) { toast.error(programable ? 'Escribe qué se va a hacer.' : 'Cuenta brevemente qué le pasa al equipo.'); return }
    setEnviando(true)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = createClient() as any
    try {
      const rutas: string[] = []
      for (let i = 0; i < fotos.length; i++) {
        setPaso(`Subiendo foto ${i + 1} de ${fotos.length}…`)
        rutas.push(await subirArchivoMant(sb, maquina.id, 'reportes', fotos[i]))
      }
      setPaso('Creando ticket…')
      const estadoEquipo = programable ? null : funciona === 'NO' ? 'DANADA' : null
      const { data, error } = await sb.rpc('mant_reportar', {
        p_maquinaria: maquina.id,
        p_tipo: tipo,
        p_prioridad: funciona === 'NO' && prioridad === 'BAJA' ? 'MEDIA' : prioridad,
        p_titulo: titulo.trim(),
        p_descripcion: [
          descripcion.trim(),
          !programable ? `Estado al reportar: ${funciona === 'SI' ? 'funciona' : funciona === 'NO' ? 'no funciona' : 'funciona con falla'}.` : '',
        ].filter(Boolean).join('\n\n'),
        p_estado_equipo: estadoEquipo,
        p_fotos: rutas,
        p_programado: programable && programado ? programado : null,
      })
      if (error) throw new Error(error.message)
      toast.success(`Ticket ${data.numero} creado. Mantenimiento ya fue notificado.`)
      onClose()
      router.push(`/mantenimiento/${data.id}`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se pudo crear el reporte.')
    } finally {
      setEnviando(false); setPaso('')
    }
  }

  return (
    <Hoja abierta={abierta} onClose={enviando ? () => {} : onClose}
      titulo={tipo === 'SOPORTE_REMOTO' ? 'Pedir soporte remoto' : programable ? 'Programar mantenimiento' : 'Reportar falla'}
      icono={tipo === 'SOPORTE_REMOTO' ? <Headset className="w-4 h-4 text-brand-green" /> : <AlertTriangle className="w-4 h-4 text-red-500" />}
      pie={
        <button onClick={enviar} disabled={enviando}
          className="w-full flex items-center justify-center gap-2 rounded-xl bg-brand-green py-3 text-white font-semibold text-sm hover:bg-brand-green-dark disabled:opacity-60">
          {enviando && <Loader2 className="w-4 h-4 animate-spin" />} {enviando ? paso || 'Enviando…' : 'Enviar a mantenimiento'}
        </button>
      }>
      <div className="rounded-lg bg-gray-50 px-3 py-2 text-sm">
        <span className="font-mono text-xs text-gray-500">{maquina.codigo}</span> · <span className="text-gray-800">{maquina.nombre}</span>
      </div>

      <div>
        <span className={labelMant}>Tipo de solicitud</span>
        <div className="grid grid-cols-2 gap-2">
          {tipos.map((t) => (
            <button key={t} type="button" onClick={() => setTipo(t)}
              className={`rounded-xl border px-3 py-2 text-left transition-colors ${tipo === t ? 'border-brand-green bg-brand-green/5' : 'border-gray-200 hover:bg-gray-50'}`}>
              <span className="block text-sm font-semibold text-gray-800">{TIPO_TICKET_META[t].label}</span>
              <span className="block text-[11px] text-gray-500">{TIPO_TICKET_META[t].desc}</span>
            </button>
          ))}
        </div>
      </div>

      {!programable && (
        <div>
          <span className={labelMant}>¿Cómo está el equipo ahora?</span>
          <div className="grid grid-cols-3 gap-2">
            {([['SI', 'Funciona bien'], ['CON_FALLA', 'Funciona con falla'], ['NO', 'No funciona']] as const).map(([k, l]) => (
              <button key={k} type="button" onClick={() => setFunciona(k)}
                className={`rounded-lg border px-2 py-2 text-xs font-medium ${funciona === k
                  ? k === 'NO' ? 'border-red-400 bg-red-50 text-red-700' : 'border-brand-green bg-brand-green/5 text-brand-green'
                  : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
                {l}
              </button>
            ))}
          </div>
          {funciona === 'NO' && <p className="mt-1 text-[11px] text-red-600">La ficha del equipo quedará como <b>Dañada</b> hasta que mantenimiento la revise.</p>}
        </div>
      )}

      <div>
        <label className={labelMant}>{programable ? '¿Qué se va a hacer?' : '¿Qué le pasa?'} <span className="text-red-500">*</span></label>
        <input value={titulo} onChange={(e) => setTitulo(e.target.value)} maxLength={200} className={inputMant}
          placeholder={programable ? 'Cambio de carbones y revisión general' : 'No enciende / hace ruido / pierde agua…'} />
      </div>
      <div>
        <label className={labelMant}>Detalle</label>
        <textarea value={descripcion} onChange={(e) => setDescripcion(e.target.value)} rows={3} className={`${inputMant} resize-none`}
          placeholder="Desde cuándo pasa, qué se estaba haciendo, qué se intentó…" />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <span className={labelMant}>Prioridad</span>
          <div className="flex flex-wrap gap-1.5">
            {PRIORIDADES.map((p) => (
              <button key={p} type="button" onClick={() => setPrioridad(p)}
                className={`rounded-full px-3 py-1 text-xs font-semibold border ${prioridad === p ? `${PRIORIDAD_META[p].cls} border-transparent` : 'border-gray-200 text-gray-500'}`}>
                {PRIORIDAD_META[p].label}
              </button>
            ))}
          </div>
        </div>
        {programable && (
          <div>
            <label className={labelMant}>Programado para</label>
            <input type="date" value={programado} onChange={(e) => setProgramado(e.target.value)} className={inputMant} />
          </div>
        )}
      </div>

      <div>
        <span className={labelMant}>Fotos {programable ? '' : '(ayudan a diagnosticar a distancia)'}</span>
        <FotosPicker fotos={fotos} onChange={setFotos} />
      </div>
    </Hoja>
  )
}

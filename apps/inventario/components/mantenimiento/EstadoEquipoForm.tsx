'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Gauge, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { ESTADOS_MAQ, ESTADO_MAQ_META } from '@/app/(dashboard)/maquinaria/estados'
import { CONDICION_META } from '@/lib/mantenimiento'
import { Hoja, inputMant, labelMant } from './Hoja'

/** Mantenimiento define el estado operativo y la condición física del equipo. */
export function EstadoEquipoForm({ abierta, onClose, maquina }: {
  abierta: boolean
  onClose: () => void
  maquina: { id: string; codigo: string; estado: string; condicion: string }
}) {
  const router = useRouter()
  const [estado, setEstado] = useState(maquina.estado)
  const [condicion, setCondicion] = useState(maquina.condicion || 'BUENA')
  const [nota, setNota] = useState('')
  const [enviando, setEnviando] = useState(false)

  async function guardar() {
    if (estado === maquina.estado && condicion === maquina.condicion && !nota.trim()) { onClose(); return }
    setEnviando(true)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (createClient() as any).rpc('mant_definir_estado_equipo', {
      p_maquinaria: maquina.id, p_estado: estado, p_condicion: condicion, p_nota: nota.trim() || null,
    })
    setEnviando(false)
    if (error) { toast.error(error.message); return }
    toast.success('Estado del equipo actualizado.')
    onClose(); router.refresh()
  }

  return (
    <Hoja abierta={abierta} onClose={onClose} titulo={`Estado de ${maquina.codigo}`} icono={<Gauge className="w-4 h-4 text-brand-green" />}
      pie={
        <button onClick={guardar} disabled={enviando}
          className="w-full flex items-center justify-center gap-2 rounded-xl bg-brand-green py-3 text-white font-semibold text-sm hover:bg-brand-green-dark disabled:opacity-60">
          {enviando && <Loader2 className="w-4 h-4 animate-spin" />} Guardar
        </button>
      }>
      <div>
        <span className={labelMant}>Estado operativo</span>
        <div className="grid grid-cols-2 gap-2">
          {ESTADOS_MAQ.map((e) => (
            <button key={e} type="button" onClick={() => setEstado(e)}
              className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${estado === e ? 'border-brand-green bg-brand-green/5 font-semibold' : 'border-gray-200 text-gray-600'}`}>
              <span className={`h-2 w-2 rounded-full ${ESTADO_MAQ_META[e].dot}`} /> {ESTADO_MAQ_META[e].label}
            </button>
          ))}
        </div>
      </div>
      <div>
        <span className={labelMant}>Condición física</span>
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
        <label className={labelMant}>Nota para la hoja de vida</label>
        <textarea value={nota} onChange={(e) => setNota(e.target.value)} rows={2} className={`${inputMant} resize-none`} placeholder="Opcional" />
      </div>
    </Hoja>
  )
}

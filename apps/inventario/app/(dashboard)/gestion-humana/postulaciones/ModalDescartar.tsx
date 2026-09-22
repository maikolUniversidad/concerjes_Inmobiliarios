'use client'

import { useState } from 'react'
import { Ban, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { descartarCandidatos } from './acciones'
import { Modal, Boton, Campo, inputCls } from './ui'
import type { FilaBandeja, MotivoOpcion } from './tipos'

export function ModalDescartar({
  filas, motivos, motivoInicial, onClose, onHecho,
}: {
  filas: FilaBandeja[]
  motivos: MotivoOpcion[]
  motivoInicial?: string
  onClose: () => void
  onHecho: (ok: string[]) => void
}) {
  const [sb] = useState(() => createClient())
  const [motivo, setMotivo] = useState(motivoInicial ?? '')
  const [detalle, setDetalle] = useState('')
  const [banco, setBanco] = useState(false)
  const [guardando, setGuardando] = useState(false)

  async function descartar() {
    setGuardando(true)
    const r = await descartarCandidatos(sb, filas, motivo, detalle.trim(), banco)
    setGuardando(false)
    if (r.errores.length) toast.error(r.errores.map((e) => `${e.nombre}: ${e.mensaje}`).join(' · '))
    if (r.ok.length) {
      toast.success(banco ? `${r.ok.length} candidato(s) enviados al banco de talento.` : `${r.ok.length} candidato(s) descartados.`)
      onHecho(r.ok)
    }
  }

  const nombres = filas.map((f) => `${f.nombres ?? ''} ${f.apellidos ?? ''}`.trim()).join(', ')

  return (
    <Modal
      titulo={filas.length > 1 ? `Descartar ${filas.length} candidatos` : 'Descartar candidato'}
      subtitulo={nombres}
      onClose={onClose}
      ancho="max-w-lg"
      pie={
        <div className="flex justify-end gap-2">
          <Boton variante="secundario" onClick={onClose}>Cancelar</Boton>
          <Boton variante="peligro" onClick={descartar} disabled={!motivo || guardando}>
            {guardando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Ban className="h-4 w-4" />} {banco ? 'Enviar al banco' : 'Descartar'}
          </Boton>
        </div>
      }
    >
      <div className="space-y-3">
        <p className="rounded-lg bg-red-50 p-3 text-xs text-red-800">
          Esta acción marca al candidato como descartado y cierra su proceso. Queda en la bandeja de descartados, desde donde se puede reactivar.
        </p>
        <Campo label="Motivo de descarte *">
          <select value={motivo} onChange={(e) => setMotivo(e.target.value)} className={inputCls}>
            <option value="">— Seleccione —</option>
            {motivos.map((m) => <option key={m.valor} value={m.valor}>{m.etiqueta}</option>)}
          </select>
        </Campo>
        <Campo label="Detalle (opcional)">
          <textarea value={detalle} onChange={(e) => setDetalle(e.target.value)} rows={3} className={inputCls} placeholder="Qué pasó, quién lo decidió…" />
        </Campo>
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" checked={banco} onChange={(e) => setBanco(e.target.checked)} className="h-4 w-4 accent-[#2E7D32]" />
          Guardar en el banco de talento para futuras vacantes
        </label>
      </div>
    </Modal>
  )
}

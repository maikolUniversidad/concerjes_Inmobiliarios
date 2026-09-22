'use client'

import { useRef, useState } from 'react'
import { Camera, ImageUp, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { prepararFotoPerfil } from '@/lib/registro/foto'
import { CamaraFoto } from './CamaraFoto'

/**
 * "Tomar foto" (cámara con guía y revisión) y "Subir foto" (archivo del
 * equipo). Las dos entregan la foto ya recortada tipo carné; quien lo usa
 * decide dónde guardarla (el candidato o RRHH).
 */
export function BotonesFoto({
  onFoto, ocupado = false, textoTomar = 'Tomar foto', textoSubir = 'Subir foto', compacto = false,
}: {
  onFoto: (f: File) => Promise<void>
  ocupado?: boolean
  textoTomar?: string
  textoSubir?: string
  compacto?: boolean
}) {
  const [camara, setCamara] = useState(false)
  const [procesando, setProcesando] = useState(false)
  const ref = useRef<HTMLInputElement>(null)
  const ocup = ocupado || procesando

  async function entregar(f: File) {
    setProcesando(true)
    try { await onFoto(f) } finally { setProcesando(false) }
  }

  async function onArchivo(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    setProcesando(true)
    try {
      await onFoto(await prepararFotoPerfil(f))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo usar esa imagen.')
    } finally {
      setProcesando(false)
    }
  }

  const tam = compacto ? 'px-3 py-1.5 text-xs' : 'px-4 py-2.5 text-sm'
  return (
    <>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => setCamara(true)} disabled={ocup}
          className={`inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-brand-green font-semibold text-white hover:bg-brand-green-dark disabled:opacity-50 ${tam}`}>
          {ocup ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />} {textoTomar}
        </button>
        <button type="button" onClick={() => ref.current?.click()} disabled={ocup}
          className={`inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-dashed border-brand-green/60 font-semibold text-brand-green disabled:opacity-50 ${tam}`}>
          <ImageUp className="h-4 w-4" /> {textoSubir}
        </button>
      </div>
      {/* Solo formatos que se ven en cualquier navegador (el iPhone convierte HEIC a JPG). */}
      <input ref={ref} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={onArchivo} />
      {camara && <CamaraFoto onFoto={entregar} onCerrar={() => setCamara(false)} />}
    </>
  )
}

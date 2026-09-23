'use client'

import { Camera, CheckCircle2, IdCard } from 'lucide-react'
import { toast } from 'sonner'
import { BotonesFoto } from '@/components/foto/BotonesFoto'
import { subirDocumentoStaff } from '../acciones'
import { Seccion } from '../ui'
import type { PropsTab } from './tipos'

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Guarda la foto que toma RRHH (cámara de la oficina con la persona al frente,
 * o un archivo): queda como documento FOTO_CARNET ya validado y como la foto de
 * perfil que sale en la hoja de vida, la actualización de datos y la carpeta.
 */
export async function guardarFotoStaff(sb: any, candidatoId: string, catalogos: PropsTab['catalogos'], file: File): Promise<boolean> {
  const tipo = catalogos.tipos.find((t) => t.codigo === 'FOTO_CARNET')
  if (!tipo) { toast.error('No está configurado el tipo de documento de la foto (FOTO_CARNET).'); return false }
  const r = await subirDocumentoStaff(sb, candidatoId, tipo, file, 'Foto de perfil tomada por RRHH', { validado: true })
  if (r.error || !r.path) { toast.error(r.error ?? 'No se pudo guardar la foto.'); return false }
  const { error } = await sb.from('candidatos').update({ foto_perfil_path: r.path, foto_perfil_at: new Date().toISOString() }).eq('id', candidatoId)
  if (error) { toast.error(error.message); return false }
  toast.success('Foto de perfil guardada.')
  return true
}

export function FotoTrabajador({ d, sb, catalogos, puedeGestionar, recargar, onCambio, enModal = false }: PropsTab & { enModal?: boolean }) {
  const tiene = !!d.fotoUrl

  const contenido = (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
      {tiene ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={d.fotoUrl!} alt="Foto de perfil" className="h-48 w-36 shrink-0 self-center rounded-xl border border-gray-200 object-cover sm:self-start" />
      ) : (
        <div className="flex h-48 w-36 shrink-0 flex-col items-center justify-center gap-1 self-center rounded-xl border-2 border-dashed border-gray-200 bg-gray-50 text-gray-400 sm:self-start">
          <IdCard className="h-8 w-8" /><span className="text-xs">Sin foto</span>
        </div>
      )}
      <div className="min-w-0 flex-1 space-y-3">
        <div className="text-sm text-gray-600">
          {tiene
            ? <p className="flex items-center gap-1.5 font-semibold text-green-700"><CheckCircle2 className="h-4 w-4" /> Ya tiene foto de perfil.</p>
            : <p className="font-semibold text-amber-700">Falta la foto de perfil.</p>}
          <p className="mt-1 text-xs text-gray-500">
            Con la persona al frente: de frente a la cámara, con buena luz y fondo claro, sin gorra ni gafas oscuras. La foto queda
            validada y sale en la hoja de vida, la actualización de datos, los resultados de las pruebas y la carpeta de contratación.
            Los formatos que se generen después ya la llevan.
          </p>
        </div>
        {puedeGestionar && (
          <BotonesFoto
            textoTomar={tiene ? 'Tomar otra con la cámara' : 'Tomar foto con la cámara'}
            textoSubir={tiene ? 'Cambiar por un archivo' : 'Subir foto'}
            onFoto={async (file) => { if (await guardarFotoStaff(sb, d.c.id, catalogos, file)) { await recargar(); onCambio() } }}
          />
        )}
      </div>
    </div>
  )

  if (enModal) return contenido
  return (
    <Seccion titulo="Foto del trabajador" icono={<Camera className="h-4 w-4 text-brand-green" />}>
      {contenido}
    </Seccion>
  )
}

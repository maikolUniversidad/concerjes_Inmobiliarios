export const ESTADOS_MAQ = ['OPERATIVA', 'EN_USO', 'MANTENIMIENTO', 'DANADA', 'BAJA'] as const
export type EstadoMaq = typeof ESTADOS_MAQ[number]

export const ESTADO_MAQ_META: Record<string, { label: string; cls: string; dot: string }> = {
  OPERATIVA:     { label: 'Operativa',      cls: 'bg-green-100 text-green-700',   dot: 'bg-green-500' },
  EN_USO:        { label: 'En uso',         cls: 'bg-blue-100 text-blue-700',     dot: 'bg-blue-500' },
  MANTENIMIENTO: { label: 'Mantenimiento',  cls: 'bg-amber-100 text-amber-700',   dot: 'bg-amber-500' },
  DANADA:        { label: 'Dañada',         cls: 'bg-red-100 text-red-700',       dot: 'bg-red-500' },
  BAJA:          { label: 'Dada de baja',   cls: 'bg-gray-200 text-gray-600',     dot: 'bg-gray-500' },
}

export function estadoMaqLabel(e: string) {
  return ESTADO_MAQ_META[e]?.label ?? e
}

/** Sube una foto al bucket público 'maquinaria' y devuelve su URL pública. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function subirFotoMaq(sb: any, file: File): Promise<string> {
  const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg'
  const id = globalThis.crypto?.randomUUID?.() ?? String(Date.now())
  const path = `${id}.${ext}`
  const { error } = await sb.storage.from('maquinaria').upload(path, file, {
    upsert: false, contentType: file.type || 'image/jpeg',
  })
  if (error) throw error
  return sb.storage.from('maquinaria').getPublicUrl(path).data.publicUrl as string
}

/* eslint-disable @typescript-eslint/no-explicit-any */
import { getSupabase, ensureAnonSession } from '@/lib/supabase/anon'
import type { TipoDocumental } from './tipos'

const BUCKET = 'registro-vacantes'
export const MAX_BYTES = 8 * 1024 * 1024 // 8 MB

export interface DocumentoSubido {
  id: string
  tipo_documental_id: string
  orden: number
  storage_path: string
  nombre_original: string | null
  mime: string | null
  estado: string
}

export async function sha256(file: File): Promise<string> {
  const buf = await file.arrayBuffer()
  const hash = await crypto.subtle.digest('SHA-256', buf)
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

export function extDe(file: File): string {
  const m = file.name.split('.').pop()?.toLowerCase()
  if (m && m.length <= 5) return m
  return file.type.includes('pdf') ? 'pdf' : 'jpg'
}

export interface ResultadoSubida { doc?: DocumentoSubido; error?: string }

export async function subirDocumento(
  candidatoId: string, tipo: TipoDocumental, file: File, orden: number
): Promise<ResultadoSubida> {
  if (file.size > MAX_BYTES) return { error: 'El archivo supera 8 MB. Toma la foto con menos resolución.' }
  const ext = extDe(file)
  if (tipo.formatos_permitidos?.length && !tipo.formatos_permitidos.includes(ext)) {
    return { error: `Formato no permitido. Usa: ${tipo.formatos_permitidos.join(', ')}.` }
  }
  await ensureAnonSession()
  const sb = getSupabase()
  const hash = await sha256(file)
  const path = `${candidatoId}/${tipo.codigo}/${crypto.randomUUID()}.${ext}`

  const up = await sb.storage.from(BUCKET).upload(path, file, {
    contentType: file.type || undefined, upsert: false,
  })
  if (up.error) return { error: up.error.message }

  const ins = await sb.from('candidato_documentos').insert({
    candidato_id: candidatoId,
    tipo_documental_id: tipo.id,
    orden,
    storage_path: path,
    nombre_original: file.name,
    mime: file.type || null,
    tamano_bytes: file.size,
    sha256: hash,
    estado: 'CARGADO',
  } as any).select('id, tipo_documental_id, orden, storage_path, nombre_original, mime, estado').single()

  if (ins.error) {
    // Limpia el archivo huérfano si falla el insert.
    await sb.storage.from(BUCKET).remove([path])
    return { error: ins.error.message }
  }
  return { doc: ins.data as any }
}

/** Convierte el data-url de la cámara en un File subible. */
export function dataUrlAFile(dataUrl: string, nombre = 'foto-perfil.jpg'): File {
  const [cabecera, base64] = dataUrl.split(',')
  const mime = /:(.*?);/.exec(cabecera)?.[1] ?? 'image/jpeg'
  const bin = atob(base64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new File([bytes], nombre, { type: mime })
}

/**
 * Marca un archivo ya subido como la foto de perfil / carnet del candidato.
 * Se guarda la RUTA (no la imagen) para poder procesarla después y generar el
 * embedding facial cuando exista el motor de comparación.
 */
export async function marcarFotoPerfil(candidatoId: string, storagePath: string): Promise<void> {
  const sb = getSupabase()
  await sb.from('candidatos').update({
    foto_perfil_path: storagePath,
    foto_perfil_at: new Date().toISOString(),
  } as any).eq('id', candidatoId)
}

/** URL firmada de vida corta para mostrar la foto de perfil. */
export async function urlFotoPerfil(path: string, segundos = 300): Promise<string | null> {
  const sb = getSupabase()
  const { data } = await sb.storage.from(BUCKET).createSignedUrl(path, segundos)
  return data?.signedUrl ?? null
}

export async function listarDocumentos(candidatoId: string): Promise<DocumentoSubido[]> {
  const sb = getSupabase()
  const { data } = await sb
    .from('candidato_documentos')
    .select('id, tipo_documental_id, orden, storage_path, nombre_original, mime, estado')
    .eq('candidato_id', candidatoId)
    .order('created_at')
  return (data as any) ?? []
}

export async function eliminarDocumento(doc: DocumentoSubido): Promise<void> {
  const sb = getSupabase()
  await sb.storage.from(BUCKET).remove([doc.storage_path])
  await sb.from('candidato_documentos').delete().eq('id', doc.id)
}

/** Evalúa la regla condicional aplica_si contra los flags del cargo. */
export function tipoAplica(
  tipo: TipoDocumental, cargoFlags: Record<string, boolean> | null
): boolean {
  if (!tipo.aplica_si) return true
  for (const [clave, esperado] of Object.entries(tipo.aplica_si)) {
    // claves tipo "cargo.requiere_manipulacion_alimentos"
    const campo = clave.replace(/^cargo\./, '')
    if ((cargoFlags?.[campo] ?? false) !== esperado) return false
  }
  return true
}

export async function fetchCargoFlags(cargoId: string): Promise<Record<string, boolean>> {
  const sb = getSupabase()
  const { data } = await sb
    .from('cargos')
    .select('requiere_manipulacion_alimentos, requiere_trabajo_alturas, requiere_libreta_militar')
    .eq('id', cargoId)
    .maybeSingle()
  return (data as any) ?? {}
}

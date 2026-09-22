// Acciones del área administrativa sobre candidatos (lado cliente, bajo RLS).
/* eslint-disable @typescript-eslint/no-explicit-any */
import { documentosFaltantes, estadoPorMotivo, type TipoDocRegla } from '@/lib/ats/fases'
import type { CargoOpcion, FilaBandeja } from './tipos'

export interface ResultadoLote { ok: string[]; errores: { id: string; nombre: string; mensaje: string }[] }

const nombreDe = (f: Pick<FilaBandeja, 'nombres' | 'apellidos' | 'numero_documento'>) =>
  `${f.nombres ?? ''} ${f.apellidos ?? ''}`.trim() || f.numero_documento

/** Documentos cargados de varios candidatos (para validar antes de mover). */
export async function documentosDe(sb: any, ids: string[]): Promise<Map<string, { tipo_documental_id: string; estado: string }[]>> {
  const m = new Map<string, { tipo_documental_id: string; estado: string }[]>()
  if (!ids.length) return m
  for (let i = 0; i < ids.length; i += 60) {
    const { data } = await sb.from('candidato_documentos').select('candidato_id, tipo_documental_id, estado').in('candidato_id', ids.slice(i, i + 60))
    for (const d of data ?? []) {
      const l = m.get(d.candidato_id) ?? []
      l.push(d)
      m.set(d.candidato_id, l)
    }
  }
  return m
}

/** Qué le falta a cada candidato para pasar a `destino` (vacío = puede pasar). */
export function faltantesDe(
  filas: FilaBandeja[], destino: string, tipos: TipoDocRegla[], docs: Map<string, { tipo_documental_id: string; estado: string }[]>,
  cargos: CargoOpcion[],
): Map<string, string[]> {
  const out = new Map<string, string[]>()
  for (const f of filas) {
    const flags = cargos.find((c) => c.id === f.cargo_postulacion_id) as unknown as Record<string, unknown> | undefined
    out.set(f.id, documentosFaltantes(destino, tipos, docs.get(f.id) ?? [], flags))
  }
  return out
}

/**
 * Mueve candidatos a una fase. CONTRATADO pasa por el RPC que crea la ficha en
 * la planta de personal. Si faltaban documentos y se continuó, la
 * justificación queda en la bitácora.
 */
export async function moverCandidatos(
  sb: any, filas: FilaBandeja[], destino: string,
  op: { justificacion?: string; faltantes?: Map<string, string[]>; actorNombre?: string | null } = {},
): Promise<ResultadoLote> {
  const res: ResultadoLote = { ok: [], errores: [] }
  const { data: { user } } = await sb.auth.getUser()
  for (const f of filas) {
    try {
      if (destino === 'CONTRATADO') {
        const { error } = await sb.rpc('vac_contratar_candidato', { p_candidato: f.id, p_contrato: null })
        if (error) throw new Error(error.message)
      } else {
        const { error } = await sb.from('candidatos')
          .update({ estado: destino, motivo_descarte: null, descarte_detalle: null }).eq('id', f.id)
        if (error) throw new Error(error.message)
      }
      await sb.from('postulaciones').update({ estado: destino }).eq('candidato_id', f.id)
      const falt = op.faltantes?.get(f.id) ?? []
      if (falt.length && op.justificacion) {
        await sb.from('candidato_eventos').insert({
          candidato_id: f.id, tipo: 'EXCEPCION_DOCUMENTAL', a_estado: destino,
          motivo: op.justificacion, detalle: { faltantes: falt }, actor: user?.id ?? null, actor_nombre: op.actorNombre ?? user?.email ?? null,
        })
      }
      res.ok.push(f.id)
    } catch (e) {
      res.errores.push({ id: f.id, nombre: nombreDe(f), mensaje: e instanceof Error ? e.message : 'Error' })
    }
  }
  return res
}

/** Descarta candidatos con motivo tipificado (o los guarda en el banco de talento). */
export async function descartarCandidatos(
  sb: any, filas: FilaBandeja[], motivo: string, detalle: string, bancoTalento: boolean,
): Promise<ResultadoLote> {
  const res: ResultadoLote = { ok: [], errores: [] }
  const estado = bancoTalento ? 'BANCO_TALENTO' : estadoPorMotivo(motivo)
  for (const f of filas) {
    const { error } = await sb.from('candidatos')
      .update({ estado, motivo_descarte: motivo, descarte_detalle: detalle || null }).eq('id', f.id)
    if (error) { res.errores.push({ id: f.id, nombre: nombreDe(f), mensaje: error.message }); continue }
    await sb.from('postulaciones').update({ estado }).eq('candidato_id', f.id)
    res.ok.push(f.id)
  }
  return res
}

/** SHA-256 de un archivo (para detectar duplicados y dejar evidencia). */
export async function sha256Archivo(file: File): Promise<string> {
  const buf = await file.arrayBuffer()
  const h = await crypto.subtle.digest('SHA-256', buf)
  return Array.from(new Uint8Array(h)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** RRHH sube un documento en nombre del candidato ("cárgalos manualmente desde aquí"). */
export async function subirDocumentoStaff(
  sb: any, candidatoId: string, tipo: { id: string; codigo: string }, file: File, observacion?: string,
  opciones: { validado?: boolean } = {},
): Promise<{ error?: string; id?: string; path?: string }> {
  if (file.size > 15 * 1024 * 1024) return { error: 'El archivo supera 15 MB.' }
  const ext = (file.name.split('.').pop() || (file.type.includes('pdf') ? 'pdf' : 'jpg')).toLowerCase().slice(0, 5)
  const path = `${candidatoId}/${tipo.codigo}/${crypto.randomUUID()}.${ext}`
  const up = await sb.storage.from('registro-vacantes').upload(path, file, { contentType: file.type || undefined, upsert: false })
  if (up.error) return { error: up.error.message }
  const { data: { user } } = await sb.auth.getUser()
  const { count } = await sb.from('candidato_documentos').select('id', { count: 'exact', head: true })
    .eq('candidato_id', candidatoId).eq('tipo_documental_id', tipo.id)
  const ins = await sb.from('candidato_documentos').insert({
    candidato_id: candidatoId, tipo_documental_id: tipo.id, orden: (count ?? 0) + 1, storage_path: path,
    nombre_original: file.name, mime: file.type || null, tamano_bytes: file.size, sha256: await sha256Archivo(file),
    estado: opciones.validado ? 'VALIDADO' : 'CARGADO', subido_por: 'STAFF', subido_por_uid: user?.id ?? null, observacion: observacion ?? null,
    ...(opciones.validado ? { validado_por: user?.id ?? null, validado_at: new Date().toISOString() } : {}),
  }).select('id').single()
  if (ins.error) {
    await sb.storage.from('registro-vacantes').remove([path])
    return { error: ins.error.message }
  }
  await sb.from('candidato_eventos').insert({
    candidato_id: candidatoId, tipo: 'DOCUMENTO', motivo: `Documento cargado por RRHH: ${tipo.codigo}`,
    detalle: { documento_id: ins.data.id, archivo: file.name }, actor: user?.id ?? null, actor_nombre: user?.email ?? null,
  })
  return { id: ins.data.id, path }
}

/** Descarga un Excel devuelto por una ruta de API. */
export async function descargarDesdeApi(url: string, body: unknown, nombre: string): Promise<string | null> {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  if (!res.ok) {
    const j = await res.json().catch(() => ({}))
    return j.error ?? 'No se pudo descargar.'
  }
  const blob = await res.blob()
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = nombre
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 5000)
  return null
}

import type { TipoContrato } from '@/lib/clasificacion'
import { traerTodo } from '@/lib/supabase/paginado'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Sb = any

export interface FiltroClasif { tipo?: TipoContrato | null; etiquetaIds?: string[] }

/**
 * Devuelve las sedes cuya clasificación EFECTIVA cumple el filtro:
 *  - tipo efectivo = tipo de la sede, o el del grupo si la sede no tiene.
 *  - etiquetas efectivas = etiquetas de la sede ∪ etiquetas del grupo.
 * Devuelve `null` cuando no hay filtro activo (el módulo no debe filtrar).
 */
export async function sedesPorClasificacion(supabase: Sb, filtro: FiltroClasif): Promise<string[] | null> {
  const tipo = filtro.tipo ?? null
  const etiquetaIds = (filtro.etiquetaIds ?? []).filter(Boolean)
  if (!tipo && etiquetaIds.length === 0) return null

  // Paginado: este resultado se convierte en el filtro `sede_id IN (…)` de las
  // pantallas. Si PostgREST lo cortara en 1.000 filas, las sedes que quedaran
  // fuera harían desaparecer sus órdenes del listado sin ningún aviso.
  const data = await traerTodo((desde, hasta) => supabase
    .from('sedes')
    .select('id, tipo_contrato, sede_etiquetas ( etiqueta_id ), grupo:grupos_contrato ( tipo_contrato, grupo_etiquetas ( etiqueta_id ) )')
    .eq('activo', true)
    .order('id')
    .range(desde, hasta))

  const ids: string[] = []
  for (const s of data as Array<{
    id: string; tipo_contrato: TipoContrato | null
    sede_etiquetas?: { etiqueta_id: string }[] | null
    grupo?: { tipo_contrato: TipoContrato | null; grupo_etiquetas?: { etiqueta_id: string }[] | null } | null
  }>) {
    const tipoEf = s.tipo_contrato ?? s.grupo?.tipo_contrato ?? null
    if (tipo && tipoEf !== tipo) continue
    if (etiquetaIds.length) {
      const efectivas = new Set<string>([
        ...(s.sede_etiquetas ?? []).map(e => e.etiqueta_id),
        ...(s.grupo?.grupo_etiquetas ?? []).map(e => e.etiqueta_id),
      ])
      if (!etiquetaIds.every(id => efectivas.has(id))) continue
    }
    ids.push(s.id)
  }
  return ids
}

/** Lee tipo + etiquetas desde los searchParams de una página (?tipo=&etq=a,b). */
export function leerFiltroClasif(sp: Record<string, string | string[] | undefined>): FiltroClasif {
  const tipoRaw = String(sp.tipo ?? '').toUpperCase()
  const tipo = tipoRaw === 'DIRECTO' || tipoRaw === 'PRIVADO' ? (tipoRaw as TipoContrato) : null
  const etq = String(sp.etq ?? '').split(',').map(s => s.trim()).filter(Boolean)
  return { tipo, etiquetaIds: etq }
}

/** Carga las categorías + etiquetas activas para poblar el filtro. */
export async function cargarEtiquetas(supabase: Sb) {
  const [{ data: cats }, { data: ets }] = await Promise.all([
    supabase.from('etiqueta_categorias').select('id, nombre, descripcion, color, multiple, orden').eq('activo', true).order('orden'),
    supabase.from('etiquetas').select('id, categoria_id, nombre, color, orden').eq('activo', true).order('orden'),
  ])
  return { categorias: cats ?? [], etiquetas: ets ?? [] }
}

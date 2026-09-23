// Qué entra en el paquete de contratación y de dónde sale cada parte, según
// lo que tiene el candidato. Sin dependencias: lo usa la pantalla para mostrar
// qué hay y qué falta, y para saber qué descargar al armar el PDF.

import type { ItemPaquete } from './paquete'

export interface FuentesPaquete {
  generados: { id: string; codigo_plantilla: string; nombre: string; estado: string; archivo_firmado_path: string | null; generado_at: string }[]
  docs: { id: string; tipo_documental_id: string; estado: string; orden: number | null; storage_path: string; nombre_original: string | null; mime: string | null }[]
  tipos: { id: string; codigo: string; nombre: string }[]
  plantillas: { codigo: string; nombre: string }[]
  intentos: { id: string; estado: string; prueba?: { tipo: string; nombre?: string | null } | null }[]
}

export type FuentePaquete =
  | { clase: 'generado'; id: string }
  | { clase: 'escaneado'; path: string; nombre: string }
  | { clase: 'archivos'; archivos: { path: string; nombre: string; mime: string | null }[] }
  | { clase: 'prueba'; intentoId: string }

export interface ParteDelPaquete {
  item: ItemPaquete
  titulo: string
  /** Qué hay (se muestra al lado del nombre). */
  texto: string
  fuente: FuentePaquete | null
}

export const PRUEBAS_PAQUETE: Record<string, string> = {
  APTITUD: 'Resultado de la prueba de aptitud',
  CONOCIMIENTOS: 'Resultado de la prueba de conocimientos',
}

/** Nombre legible de un elemento del orden. */
export function nombreItem(item: ItemPaquete, f: Pick<FuentesPaquete, 'tipos' | 'plantillas'>): string {
  if (item.tipo === 'plantilla') return f.plantillas.find((p) => p.codigo === item.codigo)?.nombre ?? item.codigo
  if (item.tipo === 'documento') return f.tipos.find((t) => t.codigo === item.codigo)?.nombre ?? item.codigo
  return PRUEBAS_PAQUETE[item.codigo] ?? `Prueba ${item.codigo}`
}

const clave = (i: ItemPaquete) => `${i.tipo}:${i.codigo}`

/** Todos los elementos que se pueden poner en un orden (formatos, documentos y pruebas). */
export function catalogoItems(f: Pick<FuentesPaquete, 'tipos' | 'plantillas'>): ItemPaquete[] {
  return [
    ...f.plantillas.map((p) => ({ tipo: 'plantilla' as const, codigo: p.codigo })),
    ...f.tipos.map((t) => ({ tipo: 'documento' as const, codigo: t.codigo })),
    ...Object.keys(PRUEBAS_PAQUETE).map((codigo) => ({ tipo: 'prueba' as const, codigo })),
  ]
}

/** Los elementos que no están en el orden actual (para «Agregar»). */
export function itemsFaltantes(orden: ItemPaquete[], f: Pick<FuentesPaquete, 'tipos' | 'plantillas'>): ItemPaquete[] {
  const ya = new Set(orden.map(clave))
  return catalogoItems(f).filter((i) => !ya.has(clave(i)))
}

/** Para cada elemento del orden: qué tiene el candidato y de dónde sale (null = no hay, se salta). */
export function planPaquete(orden: ItemPaquete[], f: FuentesPaquete): ParteDelPaquete[] {
  return orden.map((item) => {
    const titulo = nombreItem(item, f)
    if (item.tipo === 'plantilla') {
      const g = f.generados
        .filter((x) => x.codigo_plantilla === item.codigo && x.estado !== 'ANULADO')
        .sort((a, b) => b.generado_at.localeCompare(a.generado_at))[0]
      if (!g) return { item, titulo, texto: 'No se ha generado', fuente: null }
      // Si se firmó en papel, va el escaneado firmado; si no, el formato de la plataforma.
      if (g.archivo_firmado_path) {
        const ext = g.archivo_firmado_path.split('.').pop() ?? 'pdf'
        return { item, titulo, texto: 'Firmado en papel (escaneado)', fuente: { clase: 'escaneado', path: g.archivo_firmado_path, nombre: `${g.nombre}.${ext}` } }
      }
      const texto = g.estado === 'FIRMADO' ? 'Firmado en la plataforma' : g.estado === 'PENDIENTE_FIRMA' ? 'Generado, sin firmar' : 'Generado'
      return { item, titulo, texto, fuente: { clase: 'generado', id: g.id } }
    }
    if (item.tipo === 'documento') {
      const tipo = f.tipos.find((t) => t.codigo === item.codigo)
      const archivos = tipo
        ? f.docs.filter((x) => x.tipo_documental_id === tipo.id && x.estado !== 'RECHAZADO')
          .sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0))
          .map((x) => ({ path: x.storage_path, nombre: x.nombre_original ?? `${tipo.nombre}`, mime: x.mime }))
        : []
      if (archivos.length === 0) return { item, titulo, texto: 'No está cargado', fuente: null }
      return { item, titulo, texto: `${archivos.length} archivo(s)`, fuente: { clase: 'archivos', archivos } }
    }
    const intento = f.intentos.find((x) => x.prueba?.tipo === item.codigo && x.estado !== 'EN_CURSO')
    if (!intento) return { item, titulo, texto: 'No la ha presentado', fuente: null }
    return { item, titulo, texto: 'Presentada', fuente: { clase: 'prueba', intentoId: intento.id } }
  })
}

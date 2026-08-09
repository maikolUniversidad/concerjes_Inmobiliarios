// Cálculo de urgencia de una orden de insumo, según su fecha de entrega pactada
// y/o su marca manual de urgente. Se usa en el listado (etiquetas + orden) y en
// el detalle. Menor `rank` = más urgente.

export type NivelUrgencia = 'VENCIDA' | 'HOY' | 'URGENTE' | 'PROGRAMADA' | 'NORMAL'

export interface UrgenciaInfo {
  nivel: NivelUrgencia
  rank: number
  label: string
  cls: string
  /** Días hasta la fecha pactada (negativo = vencida, null = sin fecha). */
  dias: number | null
}

/** Días entre hoy (local) y una fecha 'YYYY-MM-DD'. */
function diasHasta(fecha: string): number {
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0)
  const [y, m, d] = fecha.split('-').map(Number)
  const f = new Date(y, m - 1, d); f.setHours(0, 0, 0, 0)
  return Math.round((f.getTime() - hoy.getTime()) / 86_400_000)
}

export function calcularUrgencia(o: {
  urgente?: boolean | null
  fecha_entrega_pactada?: string | null
  estado: string
}): UrgenciaInfo {
  // Las órdenes ya recibidas o anuladas no tienen urgencia de entrega.
  const cerrada = ['RECIBIDO', 'ANULADA'].includes(o.estado)
  const f = o.fecha_entrega_pactada || null
  const dias = f ? diasHasta(f) : null

  let info: UrgenciaInfo
  if (!cerrada && dias !== null) {
    if (dias < 0)        info = { nivel: 'VENCIDA',   rank: 0, label: `Vencida ${Math.abs(dias)}d`, cls: 'bg-red-100 text-red-700', dias }
    else if (dias === 0) info = { nivel: 'HOY',       rank: 1, label: 'Entrega hoy',                cls: 'bg-orange-100 text-orange-700', dias }
    else if (dias <= 2)  info = { nivel: 'URGENTE',   rank: 2, label: `En ${dias} día${dias === 1 ? '' : 's'}`, cls: 'bg-amber-100 text-amber-800', dias }
    else                 info = { nivel: 'PROGRAMADA', rank: 4, label: `En ${dias} días`,           cls: 'bg-gray-100 text-gray-500', dias }
  } else {
    info = { nivel: 'NORMAL', rank: 5, label: '', cls: '', dias }
  }

  // La marca manual de urgente empuja a URGENTE si la fecha no la puso ya más arriba.
  if (!cerrada && o.urgente && info.rank > 2) {
    info = { nivel: 'URGENTE', rank: 2, label: info.dias !== null ? `Urgente · ${info.label}` : 'Urgente', cls: 'bg-amber-100 text-amber-800', dias: info.dias }
  }
  return info
}

/** Fecha 'YYYY-MM-DD' legible en es-CO. */
export function fmtFecha(fecha?: string | null): string {
  if (!fecha) return '—'
  const [y, m, d] = fecha.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' })
}

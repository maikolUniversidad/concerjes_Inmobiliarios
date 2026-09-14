// Periodos del tablero de mantenimiento, en hora de Bogotá (UTC-5, sin horario de verano).

export type Periodo = 'hoy' | '7d' | 'mes' | 'mes_anterior' | '90d' | 'anio' | 'todo' | 'rango'

export const PERIODOS: { k: Periodo; label: string }[] = [
  { k: 'hoy', label: 'Hoy' },
  { k: '7d', label: 'Últimos 7 días' },
  { k: 'mes', label: 'Este mes' },
  { k: 'mes_anterior', label: 'Mes anterior' },
  { k: '90d', label: 'Últimos 90 días' },
  { k: 'anio', label: 'Este año' },
  { k: 'todo', label: 'Todo el historial' },
  { k: 'rango', label: 'Rango de fechas…' },
]

const OFFSET_MS = 5 * 3600 * 1000
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']

/** Medianoche de Bogotá de (y, m, d) como ISO UTC. */
const inicioDia = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d) + OFFSET_MS).toISOString()

/** `desde` incluido, `hasta` excluido; null = sin límite. */
export function rangoPeriodo(periodo: Periodo, desde?: string, hasta?: string): { desde: string | null; hasta: string | null; etiqueta: string } {
  const bog = new Date(Date.now() - OFFSET_MS)
  const y = bog.getUTCFullYear(), m = bog.getUTCMonth(), d = bog.getUTCDate()
  switch (periodo) {
    case 'hoy': return { desde: inicioDia(y, m, d), hasta: null, etiqueta: 'hoy' }
    case '7d': return { desde: inicioDia(y, m, d - 6), hasta: null, etiqueta: 'los últimos 7 días' }
    case 'mes': return { desde: inicioDia(y, m, 1), hasta: null, etiqueta: `${MESES[m]} ${y}` }
    case 'mes_anterior': {
      const f = new Date(Date.UTC(y, m - 1, 1))
      return { desde: inicioDia(f.getUTCFullYear(), f.getUTCMonth(), 1), hasta: inicioDia(y, m, 1), etiqueta: `${MESES[f.getUTCMonth()]} ${f.getUTCFullYear()}` }
    }
    case '90d': return { desde: inicioDia(y, m, d - 89), hasta: null, etiqueta: 'los últimos 90 días' }
    case 'anio': return { desde: inicioDia(y, 0, 1), hasta: null, etiqueta: `${y}` }
    case 'todo': return { desde: null, hasta: null, etiqueta: 'todo el historial' }
    case 'rango': {
      const ok = (s?: string) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s)
      const partes = (s: string) => s.split('-').map(Number)
      const di = ok(desde) ? (() => { const [a, b, c] = partes(desde!); return inicioDia(a, b - 1, c) })() : null
      const hf = ok(hasta) ? (() => { const [a, b, c] = partes(hasta!); return inicioDia(a, b - 1, c + 1) })() : null
      const fmt = (s: string) => { const [a, b, c] = partes(s); return `${c} ${MESES[b - 1].slice(0, 3)} ${a}` }
      const etiqueta = ok(desde) && ok(hasta) ? `${fmt(desde!)} – ${fmt(hasta!)}` : ok(desde) ? `desde ${fmt(desde!)}` : ok(hasta) ? `hasta ${fmt(hasta!)}` : 'todo el historial'
      return { desde: di, hasta: hf, etiqueta }
    }
  }
}

export const SERVICIOS = [
  { nombre: 'Aseo Regular',        icono: '🧹', duraciones: ['2 horas', 'Medio día', 'Día completo'] },
  { nombre: 'Limpieza Profunda',   icono: '✨', duraciones: ['Medio día', 'Día completo', '2 personas - Medio día'] },
  { nombre: 'Post-Obra',           icono: '🏗️', duraciones: ['Cotización personalizada'] },
  { nombre: 'Atención en Eventos', icono: '🎉', duraciones: ['4h · 1 persona', '8h · 1 persona', '8h · 2 personas', '12h · 2 personas'] },
  { nombre: 'Servicio de Cocina',  icono: '🍳', duraciones: ['Medio día', 'Día completo'] },
  { nombre: 'Jardín y Exteriores', icono: '🌿', duraciones: ['2 horas', 'Medio día'] },
]

export const FRECUENCIAS = [
  { value: 'UNICA',     label: 'Una vez',   desc: 'Servicio puntual sin compromiso' },
  { value: 'SEMANAL',   label: 'Semanal',   desc: 'Cada semana, con descuento' },
  { value: 'QUINCENAL', label: 'Quincenal', desc: 'Cada 15 días, con descuento' },
  { value: 'MENSUAL',   label: 'Mensual',   desc: 'Una vez al mes, con descuento' },
]

export const HORAS = ['07:00', '08:00', '09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00']

export const ESTADOS: Record<string, { label: string; color: string; bg: string; texto: string }> = {
  PENDIENTE:   { label: 'Pendiente',   color: 'amber',   bg: 'bg-amber-50 border-amber-200',   texto: 'text-amber-700' },
  CONFIRMADA:  { label: 'Confirmada',  color: 'blue',    bg: 'bg-blue-50 border-blue-200',     texto: 'text-blue-700' },
  EN_SERVICIO: { label: 'En servicio', color: 'indigo',  bg: 'bg-indigo-50 border-indigo-200', texto: 'text-indigo-700' },
  COMPLETADA:  { label: 'Completada',  color: 'green',   bg: 'bg-green-50 border-green-200',    texto: 'text-brand-green' },
  CANCELADA:   { label: 'Cancelada',   color: 'red',     bg: 'bg-red-50 border-red-200',        texto: 'text-red-700' },
}

// Progreso 0..1 para la barra de seguimiento.
export const PROGRESO: Record<string, number> = {
  PENDIENTE: 0.15, CONFIRMADA: 0.45, EN_SERVICIO: 0.75, COMPLETADA: 1, CANCELADA: 0,
}

export const ICONO_SERVICIO: Record<string, string> = Object.fromEntries(
  SERVICIOS.map((s) => [s.nombre, s.icono])
)

export function fmtFecha(f: string | null): string {
  if (!f) return '—'
  return new Date(f + 'T12:00:00').toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
}

export function fmtFechaCorta(f: string | null): string {
  if (!f) return '—'
  return new Date(f + 'T12:00:00').toLocaleDateString('es-CO', { day: '2-digit', month: 'short' })
}

export function fmtHora(h: string | null): string {
  if (!h) return '—'
  return h.slice(0, 5)
}

export function fmtPrecio(p: number | null): string {
  if (p === null || p === undefined) return 'A consultar'
  return `$${Number(p).toLocaleString('es-CO')}`
}

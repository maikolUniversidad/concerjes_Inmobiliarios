import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatCOP(value: number): string {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    minimumFractionDigits: 0,
  }).format(value)
}

/**
 * Zona horaria de la operación. Sin fijarla, lo que se pinta en el servidor
 * (Vercel corre en UTC) sale corrido 5 horas: un movimiento de las 9 p.m. se
 * veía como las 2 a.m. del día siguiente.
 */
export const TZ_CO = 'America/Bogota'

export function formatDate(date: string | Date): string {
  return new Intl.DateTimeFormat('es-CO', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: TZ_CO,
  }).format(new Date(date))
}

/** Fecha + hora en hora de Colombia (ej.: 18/08/2026, 9:10 p. m.). */
export function formatFechaHora(date: string | Date): string {
  return new Intl.DateTimeFormat('es-CO', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
    timeZone: TZ_CO,
  }).format(new Date(date))
}

/** Solo la hora, en hora de Colombia (ej.: 9:10 p. m.). */
export function formatHora(date: string | Date): string {
  return new Intl.DateTimeFormat('es-CO', {
    hour: 'numeric', minute: '2-digit', timeZone: TZ_CO,
  }).format(new Date(date))
}

export function generateSKU(categoria: string, year: number, sequence: number): string {
  const cat = categoria.slice(0, 4).toUpperCase().padEnd(4, 'X')
  const seq = String(sequence).padStart(4, '0')
  return `CI-${cat}-${year}-${seq}`
}

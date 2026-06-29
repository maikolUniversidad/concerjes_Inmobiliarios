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

export function formatDate(date: string | Date): string {
  return new Intl.DateTimeFormat('es-CO', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date(date))
}

export function generateSKU(categoria: string, year: number, sequence: number): string {
  const cat = categoria.slice(0, 4).toUpperCase().padEnd(4, 'X')
  const seq = String(sequence).padStart(4, '0')
  return `CI-${cat}-${year}-${seq}`
}

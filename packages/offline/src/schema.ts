import type { TablaSync } from './types'

// Tablas que se replican al dispositivo para trabajar offline.
// Tras la migración 20240110, todas las editables tienen `updated_at`, así que
// usan modo incremental. `movimientos` es un ledger inmutable → append.
export const TABLAS_SYNC: TablaSync[] = [
  { tabla: 'grupos_contrato',   modo: 'incremental' },
  { tabla: 'roles',             modo: 'incremental' },
  { tabla: 'usuarios',          modo: 'incremental' },
  { tabla: 'proveedores',       modo: 'incremental' },
  { tabla: 'productos',         modo: 'incremental' },
  { tabla: 'stock',             modo: 'incremental' },
  { tabla: 'sedes',             modo: 'incremental' },
  { tabla: 'bodegas',           modo: 'incremental' },
  { tabla: 'ubicaciones',       modo: 'incremental' },
  { tabla: 'ordenes_compra',    modo: 'incremental' },
  { tabla: 'oc_items',          modo: 'incremental' },
  { tabla: 'aprovisionamiento', modo: 'incremental' },
  { tabla: 'rotacion',          modo: 'incremental' },
  { tabla: 'pedidos_sede',      modo: 'incremental' },
  { tabla: 'arqueos',           modo: 'incremental' },
  { tabla: 'arqueo_items',      modo: 'incremental' },
  { tabla: 'movimientos',       modo: 'append', tsCol: 'created_at' },
]

/** Columna watermark efectiva para una tabla. */
export function watermarkCol(t: TablaSync): string {
  return t.tsCol ?? (t.modo === 'append' ? 'created_at' : 'updated_at')
}

export const EPOCH = '1970-01-01T00:00:00.000Z'

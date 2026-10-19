import { describe, it, expect } from 'vitest'
import { join } from 'node:path'
import { archivos, leer, rel, RAIZ } from './_fs'

// Un archivo 'use server' solo puede exportar funciones async. Si exporta otra
// cosa (una constante, un objeto, una función normal) el build pasa, pero en
// producción Next lanza al cargar el módulo y TODAS sus acciones fallan con
// "This page couldn't load". Pasó en movimientos/actions.ts con ORIGENES_ENTRADA.
// Los `export type` / `export interface` se borran al compilar y sí se permiten.

const archivosServidor = archivos(join(RAIZ, 'apps/inventario'), ['.ts', '.tsx'])
  .filter((f) => /^\s*(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/\s*)*\s*['"]use server['"]/.test(leer(f)))

/** Exportaciones que no son funciones async (lo que rompe el módulo). */
function exportacionesInvalidas(codigo: string): string[] {
  const malas: string[] = []
  for (const linea of codigo.split('\n')) {
    const l = linea.trim()
    if (!l.startsWith('export ')) continue
    if (/^export\s+(type|interface)\s/.test(l)) continue
    if (/^export\s+(default\s+)?async\s+function\b/.test(l)) continue
    // `export const x = async (...) =>` también es una función async.
    if (/^export\s+const\s+\w+\s*(:[^=]+)?=\s*async\b/.test(l)) continue
    malas.push(l.slice(0, 80))
  }
  return malas
}

describe("archivos 'use server'", () => {
  it('el recorrido encuentra los archivos de acciones', () => {
    expect(archivosServidor.length).toBeGreaterThan(5)
  })

  it('solo exportan funciones async (y tipos)', () => {
    for (const f of archivosServidor) {
      expect(exportacionesInvalidas(leer(f)), `${rel(f)} exporta algo que no es una función async`).toEqual([])
    }
  })

  it('el detector sí atrapa una constante exportada', () => {
    expect(exportacionesInvalidas("'use server'\nexport const LISTA = ['A'] as const\n")).toHaveLength(1)
    expect(exportacionesInvalidas("'use server'\nexport function f() {}\n")).toHaveLength(1)
    expect(exportacionesInvalidas("'use server'\nexport async function f() {}\nexport type T = string\n")).toEqual([])
  })
})

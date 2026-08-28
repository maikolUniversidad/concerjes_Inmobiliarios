import { describe, it, expect } from 'vitest'
import { readdirSync } from 'node:fs'
import { join, basename } from 'node:path'
import { leer, RAIZ } from './_fs'

const DIR = join(RAIZ, 'supabase/migrations')
const nombres = readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort()
const NOMBRE = /^(\d{14})_[a-z0-9_]+\.sql$/

describe('migraciones de Supabase', () => {
  it('hay migraciones y todas terminan en .sql', () => {
    expect(nombres.length).toBeGreaterThan(50)
  })

  it('el nombre sigue el patrón AAAAMMDDHHMMSS_descripcion.sql', () => {
    for (const n of nombres) {
      expect(n, `nombre fuera de convención: ${n}`).toMatch(NOMBRE)
    }
  })

  it('la marca de tiempo es una fecha válida', () => {
    for (const n of nombres) {
      const t = n.match(NOMBRE)![1]
      const [a, m, d] = [+t.slice(0, 4), +t.slice(4, 6), +t.slice(6, 8)]
      expect(a, n).toBeGreaterThanOrEqual(2024)
      expect(m, `mes inválido en ${n}`).toBeGreaterThanOrEqual(1)
      expect(m, `mes inválido en ${n}`).toBeLessThanOrEqual(12)
      expect(d, `día inválido en ${n}`).toBeGreaterThanOrEqual(1)
      expect(d, `día inválido en ${n}`).toBeLessThanOrEqual(31)
    }
  })

  it('no hay dos migraciones con el mismo nombre', () => {
    expect(new Set(nombres).size).toBe(nombres.length)
  })

  it('ninguna migración está vacía', () => {
    for (const n of nombres) {
      expect(leer(join(DIR, n)).trim().length, `${n} está vacía`).toBeGreaterThan(10)
    }
  })

  it('ninguna migración quedó con un conflicto de merge', () => {
    for (const n of nombres) {
      expect(leer(join(DIR, n)), `${n} tiene un conflicto sin resolver`)
        .not.toMatch(/^(<{7}|={7}|>{7})( |$)/m)
    }
  })

  it('las migraciones destructivas son explícitas y acotadas', () => {
    // DROP TABLE sin IF EXISTS revienta el despliegue si la tabla ya no está;
    // y un DROP SCHEMA public borraría la base entera.
    for (const n of nombres) {
      const sql = leer(join(DIR, n))
      expect(sql, `${n} tiene DROP SCHEMA`).not.toMatch(/DROP\s+SCHEMA/i)
      for (const m of sql.matchAll(/DROP\s+TABLE\s+(?!IF\s+EXISTS)/gi)) {
        expect.fail(`${n}: DROP TABLE sin IF EXISTS (${m[0].trim()})`)
      }
    }
  })

  it('el orden alfabético coincide con el cronológico (así las aplica el CLI)', () => {
    const marcas = nombres.map((n) => n.match(NOMBRE)![1])
    expect(marcas).toEqual([...marcas].sort())
  })

  it('la carpeta no tiene subcarpetas ni archivos sueltos que confundan al CLI', () => {
    const todo = readdirSync(DIR, { withFileTypes: true })
    for (const e of todo) {
      expect(e.isFile(), `${e.name} no es un archivo`).toBe(true)
      expect(basename(e.name), `${e.name} no es .sql`).toMatch(/\.sql$/)
    }
  })
})

import { describe, it, expect } from 'vitest'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { archivos, leer, rel, RAIZ, APPS_NEXT } from './_fs'

// Rutas estáticas escritas en el código: "/images/...", "/logo.svg", etc.
const RUTA_ESTATICA = /['"`](\/(?:images|img|fotos|assets|icons)\/[^'"`\s)]+)['"`]/g

interface Referencia { app: string; archivo: string; ruta: string }

function referencias(): Referencia[] {
  const salida: Referencia[] = []
  for (const app of APPS_NEXT) {
    for (const f of archivos(join(RAIZ, app), ['.ts', '.tsx'])) {
      for (const m of leer(f).matchAll(RUTA_ESTATICA)) {
        salida.push({ app, archivo: f, ruta: m[1] })
      }
    }
  }
  return salida
}

const refs = referencias()

describe('imágenes y archivos estáticos', () => {
  it('el proyecto referencia archivos estáticos (el recorrido encuentra algo)', () => {
    expect(refs.length).toBeGreaterThan(5)
  })

  it('toda imagen referenciada existe en la carpeta public de su app', () => {
    // Guarda contra fotos rotas: en producción una ruta mal escrita solo se ve
    // como un hueco en la página.
    const rotas = refs
      .filter((r) => !existsSync(join(RAIZ, r.app, 'public', r.ruta)))
      .map((r) => `${r.ruta} (usada en ${rel(r.archivo)})`)
    expect([...new Set(rotas)]).toEqual([])
  })

  it('las rutas no llevan la carpeta public dentro (Next la sirve desde la raíz)', () => {
    for (const r of refs) {
      expect(r.ruta, `${rel(r.archivo)}: ${r.ruta}`).not.toMatch(/^\/public\//)
    }
  })

  it('no quedan rutas apuntando a la máquina de alguien', () => {
    for (const app of APPS_NEXT) {
      for (const f of archivos(join(RAIZ, app), ['.ts', '.tsx'])) {
        expect(leer(f), `${rel(f)} tiene una ruta absoluta local`)
          .not.toMatch(/['"`][A-Za-z]:[\\/]Users[\\/]/)
      }
    }
  })
})

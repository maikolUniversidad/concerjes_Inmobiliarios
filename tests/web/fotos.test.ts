import { describe, it, expect } from 'vitest'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { FOTOS_SERVICIO } from '@/lib/fotos'

const RAIZ = join(process.cwd(), 'apps/web')
const PUBLIC = join(RAIZ, 'public')

/** Todos los .tsx/.ts del sitio, sin node_modules ni la build de Next. */
function fuentes(dir: string, acc: string[] = []): string[] {
  for (const entrada of readdirSync(dir)) {
    if (entrada === 'node_modules' || entrada === '.next' || entrada === '.turbo') continue
    const ruta = join(dir, entrada)
    if (statSync(ruta).isDirectory()) fuentes(ruta, acc)
    else if (/\.tsx?$/.test(entrada)) acc.push(ruta)
  }
  return acc
}

describe('fotos de los servicios', () => {
  it('cada foto declarada existe en public/', () => {
    for (const [servicio, foto] of Object.entries(FOTOS_SERVICIO)) {
      expect(existsSync(join(PUBLIC, foto.src)), `${servicio}: no existe ${foto.src}`).toBe(true)
    }
  })

  it('las rutas son absolutas desde la raíz del sitio', () => {
    for (const [servicio, foto] of Object.entries(FOTOS_SERVICIO)) {
      expect(foto.src.startsWith('/'), servicio).toBe(true)
      expect(foto.src, servicio).toMatch(/\.(jpg|jpeg|png|webp|avif)$/i)
    }
  })

  it('toda foto trae texto alternativo con sentido (accesibilidad y SEO)', () => {
    for (const [servicio, foto] of Object.entries(FOTOS_SERVICIO)) {
      expect(foto.alt.trim().length, `${servicio} sin alt`).toBeGreaterThan(15)
    }
  })

  it('están los servicios que muestran la portada y la página de servicios', () => {
    for (const servicio of ['aseo', 'cafeteria', 'conserjeria', 'jardineria', 'especiales', 'alturas']) {
      expect(FOTOS_SERVICIO[servicio], `falta la foto de ${servicio}`).toBeDefined()
    }
  })
})

describe('imágenes referenciadas desde el código', () => {
  it('toda ruta /images/… o /logo… escrita en el código existe en public/', () => {
    const faltantes: string[] = []
    for (const archivo of fuentes(RAIZ)) {
      const codigo = readFileSync(archivo, 'utf8')
      for (const m of codigo.matchAll(/['"`(]((?:\/images\/|\/logo)[A-Za-z0-9_./-]+\.(?:jpg|jpeg|png|webp|avif|svg))/g)) {
        if (!existsSync(join(PUBLIC, m[1]))) faltantes.push(`${relative(RAIZ, archivo)} → ${m[1]}`)
      }
    }
    expect(faltantes, `rutas de imagen sin archivo:\n${faltantes.join('\n')}`).toEqual([])
  })

  it('el sitio tiene favicon e icono de aplicación', () => {
    for (const icono of ['app/icon.png', 'app/apple-icon.png', 'app/favicon.ico']) {
      expect(existsSync(join(RAIZ, icono)), `falta ${icono}`).toBe(true)
    }
  })
})

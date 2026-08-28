import { describe, it, expect } from 'vitest'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { FOTOS_SERVICIO } from '@/lib/fotos'

const PUBLIC = join(process.cwd(), 'apps/web/public')

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

import { describe, it, expect } from 'vitest'
import {
  detectarHoja, enderezar, homografia, aplicarHomografia, mejorarDocumento, tamanoSalida, ordenarEsquinas,
  cuadrilateroValido, rotar90, type Imagen, type Punto, type Esquinas,
} from '@/lib/escaner/procesamiento'

// ── Imágenes sintéticas ──────────────────────────────────────────────────────
function lienzo(w: number, h: number, color: [number, number, number]): Imagen {
  const data = new Uint8ClampedArray(w * h * 4)
  for (let i = 0; i < w * h; i++) data.set([...color, 255], i * 4)
  return { width: w, height: h, data }
}
function dentro(p: Punto, q: Punto[]): boolean {
  let s = 0
  for (let i = 0; i < q.length; i++) {
    const a = q[i], b = q[(i + 1) % q.length]
    const c = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)
    if (c !== 0) { if (s && Math.sign(c) !== s) return false; s = Math.sign(c) }
  }
  return true
}
function pintarPoligono(img: Imagen, q: Punto[], color: [number, number, number]) {
  for (let y = 0; y < img.height; y++)
    for (let x = 0; x < img.width; x++)
      if (dentro({ x: x + 0.5, y: y + 0.5 }, q)) img.data.set(color, (y * img.width + x) * 4)
}
const cerca = (a: Punto, b: Punto, tol: number) => Math.hypot(a.x - b.x, a.y - b.y) <= tol

describe('detección de la hoja', () => {
  it('encuentra una hoja blanca inclinada sobre un fondo de madera, aun con texto encima', () => {
    const img = lienzo(400, 300, [120, 82, 50])
    const hoja: Esquinas = [{ x: 90, y: 40 }, { x: 320, y: 60 }, { x: 300, y: 270 }, { x: 70, y: 250 }]
    pintarPoligono(img, hoja, [242, 240, 236])
    // renglones de texto dentro de la hoja
    for (let r = 0; r < 8; r++) pintarPoligono(img, [{ x: 110, y: 80 + r * 20 }, { x: 280, y: 80 + r * 20 }, { x: 280, y: 84 + r * 20 }, { x: 110, y: 84 + r * 20 }], [30, 30, 30])
    const q = detectarHoja(img)
    expect(q).not.toBeNull()
    q!.forEach((p, i) => expect(cerca(p, hoja[i], 4), `esquina ${i}: ${JSON.stringify(p)}`).toBe(true))
  })

  it('una hoja gris sobre una mesa blanca también se encuentra (la región oscura que no toca el borde)', () => {
    const img = lienzo(400, 300, [250, 250, 250])
    const hoja: Esquinas = [{ x: 100, y: 50 }, { x: 300, y: 50 }, { x: 300, y: 260 }, { x: 100, y: 260 }]
    pintarPoligono(img, hoja, [175, 175, 170])
    const q = detectarHoja(img)
    expect(q).not.toBeNull()
    q!.forEach((p, i) => expect(cerca(p, hoja[i], 4)).toBe(true))
  })

  it('sin hoja (todo parejo) no inventa esquinas', () => {
    expect(detectarHoja(lienzo(200, 150, [128, 128, 128]))).toBeNull()
  })

  it('ordena las esquinas y descarta formas que no son una hoja', () => {
    const q = ordenarEsquinas([{ x: 10, y: 90 }, { x: 90, y: 10 }, { x: 10, y: 10 }, { x: 90, y: 90 }])
    expect(q).toEqual([{ x: 10, y: 10 }, { x: 90, y: 10 }, { x: 90, y: 90 }, { x: 10, y: 90 }])
    expect(cuadrilateroValido(q, 100, 100)).toBe(true)
    // demasiado pequeña
    expect(cuadrilateroValido([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }], 100, 100)).toBe(false)
  })
})

describe('perspectiva', () => {
  it('la homografía lleva cada esquina a su lugar', () => {
    const de: Punto[] = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 150 }, { x: 0, y: 150 }]
    const a: Punto[] = [{ x: 12, y: 8 }, { x: 118, y: 20 }, { x: 110, y: 170 }, { x: 5, y: 160 }]
    const H = homografia(de, a)
    de.forEach((p, i) => expect(cerca(aplicarHomografia(H, p), a[i], 1e-6)).toBe(true))
  })

  it('endereza la hoja: una marca en una esquina de la hoja queda en esa esquina de la imagen', () => {
    const img = lienzo(300, 300, [60, 60, 60])
    const hoja: Esquinas = [{ x: 60, y: 40 }, { x: 250, y: 70 }, { x: 230, y: 260 }, { x: 40, y: 240 }]
    pintarPoligono(img, hoja, [240, 240, 240])
    // marca roja cerca de la esquina de arriba a la derecha
    pintarPoligono(img, [{ x: 225, y: 72 }, { x: 240, y: 74 }, { x: 239, y: 88 }, { x: 224, y: 86 }], [220, 20, 20])
    const out = enderezar(img, hoja, 200, 200)
    const px = (x: number, y: number) => Array.from(out.data.slice((y * 200 + x) * 4, (y * 200 + x) * 4 + 3))
    expect(px(178, 16)[0]).toBeGreaterThan(180)       // rojo arriba a la derecha (centro de la marca)
    expect(px(178, 16)[1]).toBeLessThan(80)
    expect(px(10, 190)).toEqual([240, 240, 240])       // abajo a la izquierda: papel
    expect(px(100, 100)).toEqual([240, 240, 240])
  })

  it('el tamaño de salida se ajusta a carta cuando la hoja se parece', () => {
    const q: Esquinas = [{ x: 0, y: 0 }, { x: 800, y: 0 }, { x: 800, y: 1010 }, { x: 0, y: 1010 }]
    const t = tamanoSalida(q, 2000)
    expect(t.ancho / t.alto).toBeCloseTo(8.5 / 11, 2)
    expect(Math.max(t.ancho, t.alto)).toBeLessThanOrEqual(2000)
  })

  it('gira 90°', () => {
    const img = lienzo(3, 2, [0, 0, 0])
    img.data.set([255, 0, 0, 255], 0) // arriba a la izquierda
    const r = rotar90(img)
    expect([r.width, r.height]).toEqual([2, 3])
    expect(Array.from(r.data.slice(4, 8))).toEqual([255, 0, 0, 255]) // queda arriba a la derecha
  })
})

describe('aspecto de escaneado', () => {
  it('deja el papel blanco parejo aunque tenga sombra, el texto oscuro y la tinta azul azul', () => {
    const w = 240, h = 160
    const img = lienzo(w, h, [0, 0, 0])
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const luz = x < w / 2 ? 235 : 150        // media hoja en sombra
        img.data.set([luz, luz, luz - 5, 255], (y * w + x) * 4)
      }
    pintarPoligono(img, [{ x: 20, y: 40 }, { x: 100, y: 40 }, { x: 100, y: 44 }, { x: 20, y: 44 }], [40, 40, 40])       // texto en la luz
    pintarPoligono(img, [{ x: 140, y: 40 }, { x: 220, y: 40 }, { x: 220, y: 44 }, { x: 140, y: 44 }], [25, 25, 25])     // texto en la sombra
    pintarPoligono(img, [{ x: 140, y: 100 }, { x: 220, y: 100 }, { x: 220, y: 104 }, { x: 140, y: 104 }], [40, 55, 120]) // firma azul en la sombra
    const out = mejorarDocumento(img, 'color')
    const px = (x: number, y: number) => Array.from(out.data.slice((y * w + x) * 4, (y * w + x) * 4 + 3))
    expect(Math.min(...px(60, 120))).toBeGreaterThan(235)  // papel iluminado → blanco
    expect(Math.min(...px(180, 130))).toBeGreaterThan(225) // papel en sombra → blanco
    expect(Math.max(...px(60, 42))).toBeLessThan(40)       // texto → negro
    expect(Math.max(...px(180, 42))).toBeLessThan(60)
    const azul = px(180, 102)
    expect(azul[2]).toBeGreaterThan(azul[0] + 60)          // la firma sigue siendo azul
    const bn = mejorarDocumento(img, 'bn')
    expect(new Set(Array.from(bn.data.filter((_, i) => i % 4 === 0)))).toEqual(new Set([0, 255]))
  })
})

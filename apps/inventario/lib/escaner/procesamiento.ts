// Escáner de documentos: detecta la hoja en una foto, la endereza (quita la
// perspectiva) y la deja con aspecto de escaneado: fondo blanco parejo, sin
// sombras, texto nítido y la tinta azul de las firmas conservada.
//
// Funciones puras sobre píxeles RGBA, sin dependencias: en el navegador se usan
// con canvas y en las pruebas con imágenes sintéticas.

export interface Imagen { width: number; height: number; data: Uint8ClampedArray }
export interface Punto { x: number; y: number }
/** Arriba-izquierda, arriba-derecha, abajo-derecha, abajo-izquierda. */
export type Esquinas = [Punto, Punto, Punto, Punto]
export type ModoMejora = 'color' | 'grises' | 'bn' | 'original'

// ── Canales y filtros básicos ────────────────────────────────────────────────

/** Mínimo de R, G y B: alto solo en blancos y grises claros (el papel), bajo en fondos de color (madera, telas). */
export function canalMinimo(img: Imagen): Uint8Array {
  const n = img.width * img.height
  const out = new Uint8Array(n)
  const d = img.data
  for (let i = 0, j = 0; i < n; i++, j += 4) out[i] = Math.min(d[j], d[j + 1], d[j + 2])
  return out
}

export function luminancia(img: Imagen): Uint8Array {
  const n = img.width * img.height
  const out = new Uint8Array(n)
  const d = img.data
  for (let i = 0, j = 0; i < n; i++, j += 4) out[i] = (d[j] * 77 + d[j + 1] * 150 + d[j + 2] * 29) >> 8
  return out
}

/** Desenfoque de caja separable (radio r), con sumas corridas; bordes repetidos. */
export function desenfocar(src: ArrayLike<number>, w: number, h: number, r: number): Float32Array {
  const tmp = new Float32Array(w * h)
  const out = new Float32Array(w * h)
  const k = 2 * r + 1
  for (let y = 0; y < h; y++) {
    const fila = y * w
    let s = 0
    for (let i = -r; i <= r; i++) s += src[fila + Math.min(w - 1, Math.max(0, i))]
    for (let x = 0; x < w; x++) {
      tmp[fila + x] = s / k
      s += src[fila + Math.min(w - 1, x + r + 1)] - src[fila + Math.max(0, x - r)]
    }
  }
  for (let x = 0; x < w; x++) {
    let s = 0
    for (let i = -r; i <= r; i++) s += tmp[Math.min(h - 1, Math.max(0, i)) * w + x]
    for (let y = 0; y < h; y++) {
      out[y * w + x] = s / k
      s += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x]
    }
  }
  return out
}

/** Umbral de Otsu: el valor que mejor separa claros (papel) de oscuros (fondo). */
export function umbralOtsu(valores: ArrayLike<number>): number {
  const hist = new Float64Array(256)
  for (let i = 0; i < valores.length; i++) hist[Math.min(255, Math.max(0, Math.round(valores[i])))]++
  const total = valores.length
  let suma = 0
  for (let t = 0; t < 256; t++) suma += t * hist[t]
  let sumaB = 0, pesoB = 0, mejor = -1, umbral = 127
  for (let t = 0; t < 256; t++) {
    pesoB += hist[t]
    if (!pesoB) continue
    const pesoF = total - pesoB
    if (!pesoF) break
    sumaB += t * hist[t]
    const mB = sumaB / pesoB
    const mF = (suma - sumaB) / pesoF
    const entre = pesoB * pesoF * (mB - mF) * (mB - mF)
    if (entre > mejor) { mejor = entre; umbral = t }
  }
  return umbral
}

// ── Geometría ────────────────────────────────────────────────────────────────

export function area(pol: Punto[]): number {
  let a = 0
  for (let i = 0; i < pol.length; i++) {
    const p = pol[i], q = pol[(i + 1) % pol.length]
    a += p.x * q.y - q.x * p.y
  }
  return Math.abs(a) / 2
}

const cruz = (o: Punto, a: Punto, b: Punto) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)

/** Envolvente convexa (cadena monótona). */
export function envolvente(puntos: Punto[]): Punto[] {
  const p = [...puntos].sort((a, b) => a.x - b.x || a.y - b.y)
  if (p.length < 3) return p
  const abajo: Punto[] = []
  for (const q of p) {
    while (abajo.length >= 2 && cruz(abajo[abajo.length - 2], abajo[abajo.length - 1], q) <= 0) abajo.pop()
    abajo.push(q)
  }
  const arriba: Punto[] = []
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i]
    while (arriba.length >= 2 && cruz(arriba[arriba.length - 2], arriba[arriba.length - 1], q) <= 0) arriba.pop()
    arriba.push(q)
  }
  return abajo.slice(0, -1).concat(arriba.slice(0, -1))
}

/** Deja en orden: arriba-izquierda, arriba-derecha, abajo-derecha, abajo-izquierda. */
export function ordenarEsquinas(pts: Punto[]): Esquinas {
  const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length
  const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length
  const orden = [...pts].sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx))
  // Empieza por la de arriba a la izquierda (menor x + y) y sigue en el sentido del reloj.
  let inicio = 0
  for (let i = 1; i < orden.length; i++) if (orden[i].x + orden[i].y < orden[inicio].x + orden[inicio].y) inicio = i
  const r = [0, 1, 2, 3].map((k) => orden[(inicio + k) % 4])
  return [r[0], r[1], r[2], r[3]]
}

/** De la envolvente, las cuatro esquinas que encierran más área. */
export function mejorCuadrilatero(hull: Punto[]): Esquinas | null {
  if (hull.length < 4) return null
  let pts = hull
  // Muchos puntos: se quedan los que más «doblan» la envolvente (máx. 24).
  if (pts.length > 24) {
    const giro = pts.map((p, i) => {
      const a = pts[(i - 1 + pts.length) % pts.length], b = pts[(i + 1) % pts.length]
      return { p, g: Math.abs(cruz(a, p, b)) }
    })
    const umbral = [...giro].sort((x, y) => y.g - x.g)[23].g
    pts = giro.filter((x) => x.g >= umbral).map((x) => x.p)
  }
  let mejor: Punto[] | null = null
  let mejorArea = 0
  const n = pts.length
  for (let a = 0; a < n; a++)
    for (let b = a + 1; b < n; b++)
      for (let c = b + 1; c < n; c++)
        for (let d = c + 1; d < n; d++) {
          const q = [pts[a], pts[b], pts[c], pts[d]]
          const s = area(q)
          if (s > mejorArea) { mejorArea = s; mejor = q }
        }
  return mejor ? ordenarEsquinas(mejor) : null
}

/** ¿Parece una hoja? Suficientemente grande, convexa y con ángulos razonables. */
export function cuadrilateroValido(q: Esquinas, w: number, h: number, areaMinima = 0.12): boolean {
  if (area(q) < areaMinima * w * h) return false
  let signo = 0
  for (let i = 0; i < 4; i++) {
    const c = cruz(q[i], q[(i + 1) % 4], q[(i + 2) % 4])
    if (c === 0) return false
    const s = Math.sign(c)
    if (signo && s !== signo) return false
    signo = s
  }
  for (let i = 0; i < 4; i++) {
    const a = q[(i + 3) % 4], p = q[i], b = q[(i + 1) % 4]
    const v1 = { x: a.x - p.x, y: a.y - p.y }, v2 = { x: b.x - p.x, y: b.y - p.y }
    const cos = (v1.x * v2.x + v1.y * v2.y) / (Math.hypot(v1.x, v1.y) * Math.hypot(v2.x, v2.y))
    const ang = (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI
    if (ang < 45 || ang > 135) return false
  }
  return true
}

// ── Detección de la hoja ─────────────────────────────────────────────────────

/** Región conectada (4 vecinos) más grande de la máscara; devuelve sus etiquetas. */
function regionMayor(mascara: Uint8Array, w: number, h: number, evitarBorde: boolean): { etiquetas: Int32Array; etiqueta: number; tamano: number } | null {
  const etiquetas = new Int32Array(w * h)
  const pila = new Int32Array(w * h)
  let siguiente = 0, mejor = 0, mejorTam = 0
  for (let i = 0; i < w * h; i++) {
    if (!mascara[i] || etiquetas[i]) continue
    siguiente++
    let tam = 0, tocaBorde = false, tope = 0
    pila[tope++] = i
    etiquetas[i] = siguiente
    while (tope) {
      const p = pila[--tope]
      tam++
      const x = p % w, y = (p - x) / w
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) tocaBorde = true
      if (x > 0 && mascara[p - 1] && !etiquetas[p - 1]) { etiquetas[p - 1] = siguiente; pila[tope++] = p - 1 }
      if (x < w - 1 && mascara[p + 1] && !etiquetas[p + 1]) { etiquetas[p + 1] = siguiente; pila[tope++] = p + 1 }
      if (y > 0 && mascara[p - w] && !etiquetas[p - w]) { etiquetas[p - w] = siguiente; pila[tope++] = p - w }
      if (y < h - 1 && mascara[p + w] && !etiquetas[p + w]) { etiquetas[p + w] = siguiente; pila[tope++] = p + w }
    }
    if (evitarBorde && tocaBorde) continue
    if (tam > mejorTam) { mejorTam = tam; mejor = siguiente }
  }
  return mejor ? { etiquetas, etiqueta: mejor, tamano: mejorTam } : null
}

function esquinasDeRegion(r: { etiquetas: Int32Array; etiqueta: number }, w: number, h: number): Esquinas | null {
  const borde: Punto[] = []
  const e = r.etiquetas, k = r.etiqueta
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      if (e[i] !== k) continue
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1 || e[i - 1] !== k || e[i + 1] !== k || e[i - w] !== k || e[i + w] !== k) {
        borde.push({ x: x + 0.5, y: y + 0.5 })
      }
    }
  return mejorCuadrilatero(envolvente(borde))
}

/**
 * Busca la hoja en la foto (conviene pasarla reducida, ~400 px de ancho).
 * La hoja es la región clara y sin color más grande; si el fondo es más claro
 * que la hoja, se busca la región oscura más grande que no toque el borde.
 * Devuelve null si no hay una hoja clara (la persona ajusta las esquinas a mano).
 */
export function detectarHoja(img: Imagen): Esquinas | null {
  const { width: w, height: h } = img
  const suave = desenfocar(canalMinimo(img), w, h, 2)
  const t = umbralOtsu(suave)
  const claro = new Uint8Array(w * h)
  for (let i = 0; i < w * h; i++) claro[i] = suave[i] > t ? 1 : 0

  const candidatas: Esquinas[] = []
  const r1 = regionMayor(claro, w, h, false)
  if (r1 && r1.tamano > 0.1 * w * h) {
    const q = esquinasDeRegion(r1, w, h)
    if (q) candidatas.push(q)
  }
  const oscuro = claro.map((v) => 1 - v)
  const r2 = regionMayor(oscuro, w, h, true)
  if (r2 && r2.tamano > 0.1 * w * h) {
    const q = esquinasDeRegion(r2, w, h)
    if (q) candidatas.push(q)
  }
  // Una «hoja» que ocupa casi toda la foto no es una detección: es el fondo.
  const validas = candidatas.filter((q) => cuadrilateroValido(q, w, h) && area(q) < 0.96 * w * h)
  if (!validas.length) return null
  return validas.sort((a, b) => area(b) - area(a))[0]
}

/** Esquinas por defecto: un rectángulo un poco adentro de los bordes. */
export function esquinasPorDefecto(w: number, h: number, margen = 0.06): Esquinas {
  const mx = w * margen, my = h * margen
  return [{ x: mx, y: my }, { x: w - mx, y: my }, { x: w - mx, y: h - my }, { x: mx, y: h - my }]
}

export function escalarEsquinas(q: Esquinas, f: number): Esquinas {
  return q.map((p) => ({ x: p.x * f, y: p.y * f })) as Esquinas
}

// ── Perspectiva ──────────────────────────────────────────────────────────────

/** Homografía 3×3 que lleva los puntos `de` a los puntos `a` (cuatro parejas). */
export function homografia(de: Punto[], a: Punto[]): number[] {
  const A: number[][] = []
  const b: number[] = []
  for (let i = 0; i < 4; i++) {
    const { x, y } = de[i], { x: u, y: v } = a[i]
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u)
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v)
  }
  // Eliminación gaussiana con pivoteo parcial.
  for (let c = 0; c < 8; c++) {
    let piv = c
    for (let f = c + 1; f < 8; f++) if (Math.abs(A[f][c]) > Math.abs(A[piv][c])) piv = f
    ;[A[c], A[piv]] = [A[piv], A[c]]
    ;[b[c], b[piv]] = [b[piv], b[c]]
    const diag = A[c][c] || 1e-12
    for (let f = c + 1; f < 8; f++) {
      const m = A[f][c] / diag
      if (!m) continue
      for (let k = c; k < 8; k++) A[f][k] -= m * A[c][k]
      b[f] -= m * b[c]
    }
  }
  const hs = new Array(8).fill(0)
  for (let f = 7; f >= 0; f--) {
    let s = b[f]
    for (let k = f + 1; k < 8; k++) s -= A[f][k] * hs[k]
    hs[f] = s / (A[f][f] || 1e-12)
  }
  return [...hs, 1]
}

export function aplicarHomografia(H: number[], p: Punto): Punto {
  const d = H[6] * p.x + H[7] * p.y + H[8]
  return { x: (H[0] * p.x + H[1] * p.y + H[2]) / d, y: (H[3] * p.x + H[4] * p.y + H[5]) / d }
}

const PROPORCIONES = [8.5 / 11, 210 / 297, 8.5 / 13, 8.5 / 14] // carta, A4, oficio, legal

/** Tamaño de salida según los lados de la hoja; si se parece a un tamaño de papel conocido, se ajusta a él. */
export function tamanoSalida(q: Esquinas, maxLado = 2000): { ancho: number; alto: number } {
  const d = (a: Punto, b: Punto) => Math.hypot(a.x - b.x, a.y - b.y)
  let ancho = Math.max(d(q[0], q[1]), d(q[3], q[2]))
  let alto = Math.max(d(q[0], q[3]), d(q[1], q[2]))
  const r = ancho / alto
  for (const p of PROPORCIONES) {
    for (const obj of [p, 1 / p]) {
      if (Math.abs(r - obj) / obj < 0.08) { alto = ancho / obj; break }
    }
  }
  const f = Math.min(maxLado / Math.max(ancho, alto), 1.5)
  return { ancho: Math.max(1, Math.round(ancho * f)), alto: Math.max(1, Math.round(alto * f)) }
}

/** Endereza la hoja: el cuadrilátero de la foto pasa a un rectángulo ancho × alto (interpolación bilineal). */
export function enderezar(img: Imagen, q: Esquinas, ancho: number, alto: number): Imagen {
  const H = homografia([{ x: 0, y: 0 }, { x: ancho, y: 0 }, { x: ancho, y: alto }, { x: 0, y: alto }], q)
  const out = new Uint8ClampedArray(ancho * alto * 4)
  const src = img.data, sw = img.width, sh = img.height
  for (let v = 0; v < alto; v++) {
    const vy = v + 0.5
    // A lo largo de la fila, numerador y denominador crecen en línea recta.
    let nx = H[0] * 0.5 + H[1] * vy + H[2]
    let ny = H[3] * 0.5 + H[4] * vy + H[5]
    let dd = H[6] * 0.5 + H[7] * vy + H[8]
    let o = v * ancho * 4
    for (let u = 0; u < ancho; u++) {
      const x = nx / dd - 0.5, y = ny / dd - 0.5
      const x0 = Math.max(0, Math.min(sw - 2, Math.floor(x))), y0 = Math.max(0, Math.min(sh - 2, Math.floor(y)))
      const fx = Math.max(0, Math.min(1, x - x0)), fy = Math.max(0, Math.min(1, y - y0))
      const i00 = (y0 * sw + x0) * 4, i10 = i00 + 4, i01 = i00 + sw * 4, i11 = i01 + 4
      for (let c = 0; c < 3; c++) {
        const arriba = src[i00 + c] + (src[i10 + c] - src[i00 + c]) * fx
        const abajo = src[i01 + c] + (src[i11 + c] - src[i01 + c]) * fx
        out[o + c] = arriba + (abajo - arriba) * fy
      }
      out[o + 3] = 255
      o += 4
      nx += H[0]; ny += H[3]; dd += H[6]
    }
  }
  return { width: ancho, height: alto, data: out }
}

// ── Aspecto de escaneado ─────────────────────────────────────────────────────

/** Iluminación del papel en cada punto (lo más claro alrededor, suavizado). */
function fondoPapel(L: Uint8Array, w: number, h: number): Float32Array {
  const f = 8
  const sw = Math.ceil(w / f), sh = Math.ceil(h / f)
  const peq = new Float32Array(sw * sh)
  for (let by = 0; by < sh; by++)
    for (let bx = 0; bx < sw; bx++) {
      let m = 0
      for (let y = by * f; y < Math.min(h, by * f + f); y++)
        for (let x = bx * f; x < Math.min(w, bx * f + f); x++) if (L[y * w + x] > m) m = L[y * w + x]
      peq[by * sw + bx] = m
    }
  // Un máximo local más amplio tapa letras grandes y firmas; luego se suaviza la luz.
  const dil = new Float32Array(sw * sh)
  const rr = 2
  for (let y = 0; y < sh; y++)
    for (let x = 0; x < sw; x++) {
      let m = 0
      for (let dy = -rr; dy <= rr; dy++)
        for (let dx = -rr; dx <= rr; dx++) {
          const xx = Math.min(sw - 1, Math.max(0, x + dx)), yy = Math.min(sh - 1, Math.max(0, y + dy))
          if (peq[yy * sw + xx] > m) m = peq[yy * sw + xx]
        }
      dil[y * sw + x] = m
    }
  const suave = desenfocar(desenfocar(dil, sw, sh, 2), sw, sh, 2)
  const out = new Float32Array(w * h)
  for (let y = 0; y < h; y++) {
    const gy = Math.min(sh - 1, Math.max(0, (y + 0.5) / f - 0.5))
    const y0 = Math.floor(gy), y1 = Math.min(sh - 1, y0 + 1), ty = gy - y0
    for (let x = 0; x < w; x++) {
      const gx = Math.min(sw - 1, Math.max(0, (x + 0.5) / f - 0.5))
      const x0 = Math.floor(gx), x1 = Math.min(sw - 1, x0 + 1), tx = gx - x0
      const a = suave[y0 * sw + x0] + (suave[y0 * sw + x1] - suave[y0 * sw + x0]) * tx
      const b = suave[y1 * sw + x0] + (suave[y1 * sw + x1] - suave[y1 * sw + x0]) * tx
      out[y * w + x] = a + (b - a) * ty
    }
  }
  return out
}

/** Curva de contraste: papel → blanco, texto → casi negro. */
function curva(n: number): number {
  const x = Math.max(0, Math.min(1, (n - 45) / (232 - 45)))
  return 255 * Math.pow(x, 1.3)
}

/**
 * Aspecto de escaneado. «color» (recomendado para firmados): fondo blanco
 * parejo conservando la tinta azul y los sellos; «grises»; «bn»: blanco y
 * negro puro; «original»: sin cambios.
 */
export function mejorarDocumento(img: Imagen, modo: ModoMejora): Imagen {
  if (modo === 'original') return img
  const { width: w, height: h, data: d } = img
  const L = luminancia(img)
  const fondo = fondoPapel(L, w, h)
  const out = new Uint8ClampedArray(w * h * 4)
  for (let i = 0, j = 0; i < w * h; i++, j += 4) {
    const escala = 255 / Math.max(fondo[i], 24)
    if (modo === 'color') {
      out[j] = curva(d[j] * escala)
      out[j + 1] = curva(d[j + 1] * escala)
      out[j + 2] = curva(d[j + 2] * escala)
    } else {
      const n = L[i] * escala
      const v = modo === 'bn' ? (n < 180 ? 0 : 255) : curva(n)
      out[j] = v; out[j + 1] = v; out[j + 2] = v
    }
    out[j + 3] = 255
  }
  return { width: w, height: h, data: out }
}

/** Gira 90° en el sentido del reloj. */
export function rotar90(img: Imagen): Imagen {
  const { width: w, height: h, data: d } = img
  const out = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const s = (y * w + x) * 4
      const nx = h - 1 - y, ny = x
      const t = (ny * h + nx) * 4
      out[t] = d[s]; out[t + 1] = d[s + 1]; out[t + 2] = d[s + 2]; out[t + 3] = d[s + 3]
    }
  return { width: h, height: w, data: out }
}

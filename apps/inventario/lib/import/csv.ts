// Lectura de CSV para las cargas masivas.
//
// Excel en español exporta CSV separado por punto y coma, no por coma: el
// archivo que la gente guarda desde Excel llegaba con TODO en una sola columna.
// Aquí se detecta el separador antes de partir las líneas.

import { columnaDeEncabezado, type EntityConfig, type FilaParseada } from './config'

const SEPARADORES = [',', ';', '\t', '|'] as const

/** Separador más probable: el que produce más columnas en la fila de encabezados. */
export function detectarSeparador(primeraLinea: string): string {
  let mejor = ','
  let max = 0
  for (const sep of SEPARADORES) {
    const n = partirLinea(primeraLinea, sep).length
    if (n > max) { max = n; mejor = sep }
  }
  return mejor
}

/** Parte una línea respetando las comillas dobles (y las comillas escapadas ""). */
export function partirLinea(linea: string, sep: string): string[] {
  const out: string[] = []
  let cur = ''
  let enComillas = false
  for (let i = 0; i < linea.length; i++) {
    const ch = linea[i]
    if (ch === '"') {
      if (enComillas && linea[i + 1] === '"') { cur += '"'; i++ } else enComillas = !enComillas
    } else if (ch === sep && !enComillas) {
      out.push(cur); cur = ''
    } else {
      cur += ch
    }
  }
  out.push(cur)
  return out
}

/**
 * Parte el texto en líneas lógicas: un salto de línea DENTRO de comillas
 * (una dirección en varias líneas, por ejemplo) no corta el registro.
 */
export function partirLineas(texto: string): string[] {
  const sinBom = texto.charCodeAt(0) === 0xfeff ? texto.slice(1) : texto
  const lineas: string[] = []
  let cur = ''
  let enComillas = false
  for (let i = 0; i < sinBom.length; i++) {
    const ch = sinBom[i]
    if (ch === '"') { enComillas = !enComillas; cur += ch; continue }
    if (!enComillas && (ch === '\n' || ch === '\r')) {
      if (ch === '\r' && sinBom[i + 1] === '\n') i++
      lineas.push(cur); cur = ''
      continue
    }
    cur += ch
  }
  if (cur !== '') lineas.push(cur)
  return lineas.filter((l) => l.trim() !== '')
}

export interface EncabezadosMapeados {
  /** índice de columna del archivo → clave de la columna de la plantilla */
  porIndice: (string | null)[]
  reconocidas: string[]
  desconocidas: string[]
  faltantes: string[]
}

/** Empareja los encabezados del archivo con las columnas de la plantilla. */
export function mapearEncabezados(config: EntityConfig, encabezados: unknown[]): EncabezadosMapeados {
  const porIndice: (string | null)[] = []
  const reconocidas: string[] = []
  const desconocidas: string[] = []
  const usadas = new Set<string>()

  encabezados.forEach((h, i) => {
    const texto = String(h ?? '').trim()
    if (!texto) { porIndice[i] = null; return }
    const col = columnaDeEncabezado(config, texto)
    // Una columna repetida en el archivo se toma una sola vez (la primera).
    if (!col || usadas.has(col.key)) {
      porIndice[i] = null
      if (!col) desconocidas.push(texto)
      return
    }
    usadas.add(col.key)
    porIndice[i] = col.key
    reconocidas.push(col.label)
  })

  const faltantes = config.columns
    .filter((c) => c.required && !usadas.has(c.key))
    .map((c) => c.label)

  return { porIndice, reconocidas, desconocidas, faltantes }
}

export interface ArchivoParseado {
  filas: FilaParseada[]
  reconocidas: string[]
  desconocidas: string[]
  faltantes: string[]
}

/** Parsea un CSV completo a filas mapeadas por clave de columna. */
export function parsearCSV(texto: string, config: EntityConfig): ArchivoParseado {
  const lineas = partirLineas(texto)
  if (lineas.length === 0) {
    return { filas: [], reconocidas: [], desconocidas: [], faltantes: config.columns.filter((c) => c.required).map((c) => c.label) }
  }

  const sep = detectarSeparador(lineas[0])
  const mapa = mapearEncabezados(config, partirLinea(lineas[0], sep))
  const filas: FilaParseada[] = []

  for (let i = 1; i < lineas.length; i++) {
    const celdas = partirLinea(lineas[i], sep)
    const obj: FilaParseada = { _fila: i + 1 }
    let algo = false
    celdas.forEach((celda, idx) => {
      const key = mapa.porIndice[idx]
      if (!key) return
      const v = celda.trim().replace(/^"|"$/g, '')
      if (v !== '') algo = true
      obj[key] = v
    })
    if (algo) filas.push(obj)
  }

  return { filas, reconocidas: mapa.reconocidas, desconocidas: mapa.desconocidas, faltantes: mapa.faltantes }
}

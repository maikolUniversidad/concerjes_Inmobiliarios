// Utilidades para recorrer el repositorio en las pruebas de estructura.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

export const RAIZ = process.cwd()

const IGNORAR = new Set([
  'node_modules', '.next', '.turbo', '.git', '.vercel', 'dist', 'dist-desktop',
  'desktop-stage', 'android', 'ios', 'build', 'coverage', 'public', '_cloner_ref',
])

/** Lista recursiva de archivos bajo `dir` (rutas absolutas), saltando build y dependencias. */
export function archivos(dir: string, extensiones?: string[]): string[] {
  const salida: string[] = []
  const recorrer = (actual: string) => {
    let entradas: string[]
    try {
      entradas = readdirSync(actual)
    } catch {
      return
    }
    for (const nombre of entradas) {
      if (IGNORAR.has(nombre)) continue
      const ruta = join(actual, nombre)
      const st = statSync(ruta)
      if (st.isDirectory()) recorrer(ruta)
      else if (!extensiones || extensiones.some((e) => nombre.endsWith(e))) salida.push(ruta)
    }
  }
  recorrer(dir)
  return salida
}

/** Ruta relativa a la raíz del repo, con separadores '/' (para mensajes legibles). */
export function rel(ruta: string): string {
  return relative(RAIZ, ruta).split(sep).join('/')
}

export function leer(ruta: string): string {
  return readFileSync(ruta, 'utf8')
}

// El sitio público se fue a maikolUniversidad/Concerjes_Web; aquí queda una sola app Next.
export const APPS_NEXT = ['apps/inventario'] as const

/** Archivos de código de las apps y del motor offline. */
export function codigoFuente(): string[] {
  return [
    ...archivos(join(RAIZ, 'apps/inventario'), ['.ts', '.tsx']),
    ...archivos(join(RAIZ, 'apps/movil/src'), ['.ts', '.tsx']),
    ...archivos(join(RAIZ, 'packages/offline/src'), ['.ts']),
  ]
}

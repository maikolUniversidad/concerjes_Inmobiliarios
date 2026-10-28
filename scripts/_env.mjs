/**
 * Lee una clave de la `.env.local` de la raíz del repositorio.
 *
 * Los scripts de mantenimiento NO llevan credenciales escritas dentro: las
 * piden por aquí. `.env.local` está en `.gitignore`, así que nada de esto
 * entra al repositorio, que es público.
 */
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..')

export function leerEnv(clave) {
  let env
  try {
    env = readFileSync(join(raiz, '.env.local'), 'utf8')
  } catch {
    console.error('No se pudo leer .env.local en la raíz del repositorio.')
    process.exit(1)
  }
  const m = env.match(new RegExp(`^${clave}="?([^"\\n]+)"?`, 'm'))
  if (!m) {
    console.error(`Falta ${clave} en .env.local`)
    process.exit(1)
  }
  return m[1].trim()
}

import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { defineConfig } from 'vitest/config'

const raiz = dirname(fileURLToPath(import.meta.url))
const inventario = join(raiz, 'apps/inventario')
// `server-only` es un marcador de Next sin implementación en Node.
const serverOnly = join(raiz, 'tests/stubs/server-only.ts')

// Las pruebas viven todas en /tests para no entrar en el tsconfig de la app
// (si estuvieran dentro de apps/*, `next build` intentaría compilarlas).
// Las del sitio público se fueron con él a maikolUniversidad/Concerjes_Web.
const comun = {
  environment: 'node' as const,
  globals: false,
  clearMocks: true,
}

export default defineConfig({
  test: {
    projects: [
      {
        test: { ...comun, name: 'offline', include: ['tests/offline/**/*.test.ts'] },
      },
      {
        resolve: { alias: { '@': inventario, 'server-only': serverOnly } },
        test: { ...comun, name: 'inventario', include: ['tests/inventario/**/*.test.ts'] },
      },
      {
        test: { ...comun, name: 'proyecto', include: ['tests/proyecto/**/*.test.ts'] },
      },
    ],
  },
})

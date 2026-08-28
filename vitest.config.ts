import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { defineConfig } from 'vitest/config'

const raiz = dirname(fileURLToPath(import.meta.url))
const inventario = join(raiz, 'apps/inventario')
const web = join(raiz, 'apps/web')
// `server-only` es un marcador de Next sin implementación en Node.
const serverOnly = join(raiz, 'tests/stubs/server-only.ts')

// Las pruebas viven todas en /tests para no entrar en el tsconfig de cada app
// (si estuvieran dentro de apps/*, `next build` intentaría compilarlas).
// Cada proyecto trae su propio alias "@" porque en las dos apps Next apunta a
// raíces distintas.
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
        resolve: { alias: { '@': web, 'server-only': serverOnly } },
        test: { ...comun, name: 'web', include: ['tests/web/**/*.test.ts'] },
      },
      {
        test: { ...comun, name: 'proyecto', include: ['tests/proyecto/**/*.test.ts'] },
      },
    ],
  },
})

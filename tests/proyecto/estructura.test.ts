import { describe, it, expect } from 'vitest'
import { join } from 'node:path'
import { archivos, codigoFuente, leer, rel, RAIZ, APPS_NEXT } from './_fs'

const METODOS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']

const appsDir = APPS_NEXT.map((a) => join(RAIZ, a, 'app'))
const rutasApi = appsDir.flatMap((d) => archivos(d, ['route.ts', 'route.tsx']))
const paginas = appsDir.flatMap((d) => archivos(d, ['page.tsx']))
const layouts = appsDir.flatMap((d) => archivos(d, ['layout.tsx']))
const acciones = appsDir.flatMap((d) => archivos(d, ['actions.ts']))
const fuentes = codigoFuente()

/** Primeras líneas de un archivo (donde deben ir las directivas de Next). */
const cabecera = (texto: string) => texto.split('\n').slice(0, 5).join('\n')

describe('inventario de archivos', () => {
  it('encuentra las rutas, páginas y acciones del proyecto', () => {
    // Si estos números caen a cero, el recorrido se rompió y las demás pruebas
    // de esta sección estarían pasando en vacío.
    expect(rutasApi.length).toBeGreaterThan(10)
    expect(paginas.length).toBeGreaterThan(40)
    expect(acciones.length).toBeGreaterThan(5)
    expect(fuentes.length).toBeGreaterThan(200)
  })
})

describe('rutas de API', () => {
  it('cada route.ts exporta al menos un método HTTP', () => {
    for (const f of rutasApi) {
      const texto = leer(f)
      const tiene = METODOS.some((m) =>
        new RegExp(`export\\s+(async\\s+)?function\\s+${m}\\b`).test(texto) ||
        new RegExp(`export\\s+const\\s+${m}\\b`).test(texto))
      expect(tiene, `${rel(f)} no exporta ningún método HTTP`).toBe(true)
    }
  })

  it('ninguna ruta de API se marca como componente de cliente', () => {
    for (const f of rutasApi) {
      expect(cabecera(leer(f)), rel(f)).not.toContain('use client')
    }
  })
})

describe('páginas y layouts', () => {
  it('cada page.tsx tiene export default', () => {
    for (const f of paginas) {
      expect(leer(f), `${rel(f)} sin export default`).toContain('export default')
    }
  })

  it('cada layout.tsx tiene export default', () => {
    for (const f of layouts) {
      expect(leer(f), `${rel(f)} sin export default`).toContain('export default')
    }
  })
})

describe('server actions', () => {
  it('todo actions.ts empieza con la directiva "use server"', () => {
    for (const f of acciones) {
      expect(cabecera(leer(f)), `${rel(f)} sin "use server"`).toMatch(/['"]use server['"]/)
    }
  })
})

describe('frontera cliente / servidor', () => {
  const clientes = fuentes.filter((f) => /['"]use client['"]/.test(cabecera(leer(f))))

  it('hay componentes de cliente que revisar', () => {
    expect(clientes.length).toBeGreaterThan(20)
  })

  it('ningún componente de cliente toca la llave de service role', () => {
    for (const f of clientes) {
      expect(leer(f), `${rel(f)} expondría SUPABASE_SERVICE_ROLE_KEY al navegador`)
        .not.toContain('SUPABASE_SERVICE_ROLE_KEY')
    }
  })

  it('ningún componente de cliente importa el cliente admin ni "server-only"', () => {
    for (const f of clientes) {
      const texto = leer(f)
      expect(texto, `${rel(f)} importa supabase/admin`).not.toMatch(/from\s+['"][^'"]*supabase\/admin['"]/)
      expect(texto, `${rel(f)} importa server-only`).not.toMatch(/['"]server-only['"]/)
    }
  })
})

describe('higiene del repositorio', () => {
  it('no quedan marcadores de conflicto de merge', () => {
    const sql = archivos(join(RAIZ, 'supabase'), ['.sql'])
    for (const f of [...fuentes, ...sql]) {
      const texto = leer(f)
      expect(texto, `${rel(f)} tiene un conflicto de merge sin resolver`)
        .not.toMatch(/^(<{7}|={7}|>{7})( |$)/m)
    }
  })

  it('no hay pruebas enfocadas (.only) que apaguen al resto de la suite', () => {
    for (const f of archivos(join(RAIZ, 'tests'), ['.test.ts'])) {
      expect(leer(f), `${rel(f)} dejó un .only`).not.toMatch(/\b(describe|it|test)\.only\(/)
    }
  })
})

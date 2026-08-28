import { describe, it, expect } from 'vitest'
import { join } from 'node:path'
import { archivos, codigoFuente, leer, rel, RAIZ } from './_fs'

const ejemplo = leer(join(RAIZ, '.env.example'))
const turbo = JSON.parse(leer(join(RAIZ, 'turbo.json')))
const envTurbo: string[] = turbo.tasks?.build?.env ?? []

const fuentes = codigoFuente()

/** Variables leídas con process.env.X en el código de las apps. */
function variablesUsadas(): Set<string> {
  const encontradas = new Set<string>()
  for (const f of fuentes) {
    for (const m of leer(f).matchAll(/process\.env\.([A-Z0-9_]+)/g)) encontradas.add(m[1])
  }
  return encontradas
}

/** Variables VITE_* que usa la app móvil/escritorio. */
function variablesVite(): Set<string> {
  const encontradas = new Set<string>()
  for (const f of archivos(join(RAIZ, 'apps/movil/src'), ['.ts', '.tsx'])) {
    for (const m of leer(f).matchAll(/import\.meta\.env\.([A-Z0-9_]+)/g)) encontradas.add(m[1])
  }
  return encontradas
}

const declarada = (nombre: string) => new RegExp(`^\\s*${nombre}\\s*=`, 'm').test(ejemplo)

describe('variables de entorno', () => {
  it('el código sí lee variables de entorno (el recorrido funciona)', () => {
    expect(variablesUsadas().size).toBeGreaterThan(5)
  })

  it('toda variable usada en el código está documentada en .env.example', () => {
    // Si falta aquí, quien clone el repo (o el próximo despliegue) se queda sin
    // saber que hace falta configurarla.
    for (const v of variablesUsadas()) {
      expect(declarada(v), `falta ${v} en .env.example`).toBe(true)
    }
  })

  it('las variables VITE_* de la app móvil también están documentadas', () => {
    for (const v of variablesVite()) {
      expect(declarada(v), `falta ${v} en .env.example`).toBe(true)
    }
  })

  it('turbo.json declara las variables de servidor que necesita el build', () => {
    // Turborepo cachea por hash: una variable no declarada se queda fuera del
    // hash y el build puede reutilizar una caché con la configuración vieja.
    const usadas = [...variablesUsadas()].filter((v) => !v.startsWith('NEXT_PUBLIC_'))
    for (const v of usadas) {
      expect(envTurbo, `falta ${v} en turbo.json > tasks.build.env`).toContain(v)
    }
  })

  it('.env.example no trae secretos reales', () => {
    expect(ejemplo, '.env.example parece traer una llave de Supabase real')
      .not.toMatch(/=\s*"eyJ[A-Za-z0-9_-]{30,}/)
    expect(ejemplo, '.env.example parece traer una llave de OpenAI real')
      .not.toMatch(/sk-[A-Za-z0-9]{20,}/)
  })

  it('no hay llaves de Supabase incrustadas en el código', () => {
    for (const f of fuentes) {
      expect(leer(f), `${rel(f)} parece tener un JWT incrustado`)
        .not.toMatch(/eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9\./)
    }
  })

  it('los secretos no se filtran a variables NEXT_PUBLIC_', () => {
    for (const f of fuentes) {
      expect(leer(f), `${rel(f)} expone el service role al navegador`)
        .not.toMatch(/NEXT_PUBLIC_[A-Z0-9_]*SERVICE_ROLE/)
    }
  })
})

describe('.gitignore', () => {
  const ignorados = leer(join(RAIZ, '.gitignore'))

  it('los archivos de entorno reales no se suben al repositorio', () => {
    expect(ignorados).toMatch(/^\.env(\*|\.local)?$/m)
  })
})

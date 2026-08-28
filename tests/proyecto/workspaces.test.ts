import { describe, it, expect } from 'vitest'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { leer, RAIZ } from './_fs'

const paquete = (ruta: string) => JSON.parse(leer(join(RAIZ, ruta, 'package.json')))

const raiz = paquete('.')
const WORKSPACES = ['apps/web', 'apps/inventario', 'apps/movil', 'packages/offline']
const web = paquete('apps/web')
const inventario = paquete('apps/inventario')

const deps = (p: Record<string, Record<string, string>>) => ({
  ...p.dependencies, ...p.devDependencies,
})

describe('monorepo', () => {
  it('cada workspace declarado existe y tiene package.json', () => {
    for (const w of WORKSPACES) {
      expect(existsSync(join(RAIZ, w, 'package.json')), `falta ${w}`).toBe(true)
    }
  })

  it('los nombres de los paquetes no se repiten', () => {
    const nombres = WORKSPACES.map((w) => paquete(w).name)
    expect(new Set(nombres).size).toBe(nombres.length)
  })

  it('todos los paquetes son privados (nada se publica por accidente en npm)', () => {
    for (const w of WORKSPACES) {
      expect(paquete(w).private, `${w} no está marcado como private`).toBe(true)
    }
  })

  it('la raíz expone los comandos que usan el equipo y el despliegue', () => {
    for (const cmd of ['dev', 'build', 'typecheck', 'test', 'verificar', 'deploy']) {
      expect(raiz.scripts, `falta el script "${cmd}"`).toHaveProperty(cmd)
    }
  })

  it('cada workspace se puede revisar con typecheck', () => {
    for (const w of WORKSPACES) {
      expect(paquete(w).scripts?.typecheck, `${w} no tiene script typecheck`).toBeTruthy()
    }
  })

  it('el despliegue a producción pasa por la verificación', () => {
    expect(raiz.scripts.deploy, 'npm run deploy no verifica antes de publicar')
      .toContain('verificar')
    // La puerta de escape existe, pero es explícita.
    expect(raiz.scripts).toHaveProperty('deploy:sin-verificar')
  })
})

describe('turbo.json', () => {
  const turbo = JSON.parse(leer(join(RAIZ, 'turbo.json')))

  it('define las tareas que invocan los scripts de la raíz', () => {
    for (const tarea of ['build', 'dev', 'typecheck']) {
      expect(turbo.tasks, `falta la tarea ${tarea}`).toHaveProperty(tarea)
    }
  })

  it('toda tarea de turbo existe como script en algún workspace', () => {
    const scripts = new Set(WORKSPACES.flatMap((w) => Object.keys(paquete(w).scripts ?? {})))
    for (const tarea of Object.keys(turbo.tasks)) {
      expect(scripts.has(tarea), `la tarea "${tarea}" de turbo.json no existe en ningún workspace`).toBe(true)
    }
  })

  it('dev no se cachea (es un proceso persistente)', () => {
    expect(turbo.tasks.dev.cache).toBe(false)
    expect(turbo.tasks.dev.persistent).toBe(true)
  })

  it('build declara sus salidas para poder cachearlas', () => {
    expect(turbo.tasks.build.outputs).toContain('.next/**')
  })
})

describe('versiones compartidas entre las dos apps Next', () => {
  it('no hay dependencias con versiones distintas entre web e inventario', () => {
    // Dos versiones de React o de Next en el mismo monorepo producen errores
    // que solo aparecen en producción.
    const a = deps(web)
    const b = deps(inventario)
    const divergentes = Object.keys(a)
      .filter((k) => b[k] && b[k] !== a[k])
      .map((k) => `${k}: web ${a[k]} vs inventario ${b[k]}`)
    expect(divergentes).toEqual([])
  })

  it('ambas apps comparten React, Next y el cliente de Supabase', () => {
    for (const dep of ['next', 'react', 'react-dom', '@supabase/supabase-js']) {
      expect(web.dependencies[dep], `web no depende de ${dep}`).toBeTruthy()
      expect(inventario.dependencies[dep], `inventario no depende de ${dep}`).toBeTruthy()
    }
  })
})

describe('node', () => {
  it('la raíz fija la versión mínima de Node', () => {
    expect(raiz.engines?.node).toBeTruthy()
  })

  it('el CI usa una versión de Node compatible con la exigida', () => {
    const ci = leer(join(RAIZ, '.github/workflows/ci.yml'))
    const minimo = Number(String(raiz.engines.node).replace(/[^\d.]/g, '').split('.')[0])
    const enCi = ci.match(/node-version:\s*'?(\d+)/)
    expect(enCi, 'el CI no fija node-version').not.toBeNull()
    expect(Number(enCi![1]), 'el CI usa un Node más viejo que el exigido')
      .toBeGreaterThanOrEqual(minimo)
  })
})

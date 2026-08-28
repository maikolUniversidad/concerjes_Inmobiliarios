#!/usr/bin/env node
/**
 * Verificación previa al despliegue.
 *
 * Corre, en orden y parando en el primer fallo, todo lo que debe estar sano
 * antes de publicar: pruebas automatizadas, chequeo de tipos y el build real de
 * las tres aplicaciones. Si algo falla, no se despliega.
 *
 * Uso:
 *   npm run verificar               (todo: pruebas + tipos + build)
 *   npm run verificar -- --rapido   (solo pruebas + tipos, sin build)
 *   npm run verificar -- --solo-pruebas
 *
 * Lo invoca automáticamente `npm run deploy`. Para saltárselo (bajo tu
 * responsabilidad): npm run deploy:sin-verificar
 */
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const rapido = args.includes('--rapido')
const soloPruebas = args.includes('--solo-pruebas')

// La red corporativa intercepta TLS; sin esto npm/vercel fallan al validar.
const env = { ...process.env, NODE_OPTIONS: '--use-system-ca' }

const PASOS = [
  {
    nombre: 'Pruebas automatizadas',
    detalle: 'lógica de negocio, rutas de API y estructura del proyecto',
    comando: 'npx vitest run',
  },
  {
    nombre: 'Chequeo de tipos',
    detalle: 'web, inventario, móvil y el motor offline',
    comando: 'npx turbo run typecheck',
    saltar: soloPruebas,
  },
  {
    nombre: 'Build de web',
    detalle: 'apps/web',
    comando: 'npx turbo run build --filter=web',
    saltar: rapido || soloPruebas,
  },
  {
    nombre: 'Build de inventario',
    detalle: 'apps/inventario',
    comando: 'npx turbo run build --filter=inventario',
    saltar: rapido || soloPruebas,
  },
  {
    nombre: 'Build de la app móvil/escritorio',
    detalle: 'apps/movil',
    comando: 'npm run build --workspace=movil',
    saltar: rapido || soloPruebas,
  },
]

const segundos = (ms) => `${(ms / 1000).toFixed(1)}s`

console.log('\n🔎 Verificación previa al despliegue\n')

const resultados = []
const inicioTotal = Date.now()

for (const paso of PASOS) {
  if (paso.saltar) {
    resultados.push({ ...paso, estado: 'saltado' })
    continue
  }

  console.log(`▶  ${paso.nombre} — ${paso.detalle}`)
  const inicio = Date.now()
  const r = spawnSync(paso.comando, [], { stdio: 'inherit', shell: true, cwd: raiz, env })
  const duracion = Date.now() - inicio

  if (r.status !== 0) {
    resultados.push({ ...paso, estado: 'falló', duracion })
    console.error(`\n❌ Falló: ${paso.nombre}`)
    console.error('   NO se debe desplegar hasta corregirlo.\n')
    resumen(resultados, inicioTotal)
    process.exit(r.status ?? 1)
  }

  resultados.push({ ...paso, estado: 'ok', duracion })
  console.log(`✅ ${paso.nombre} (${segundos(duracion)})\n`)
}

resumen(resultados, inicioTotal)
console.log('\n✅ Todo en orden. El proyecto está listo para desplegar.\n')

function resumen(lista, inicio) {
  console.log('── Resumen ' + '─'.repeat(40))
  for (const p of lista) {
    const icono = p.estado === 'ok' ? '✅' : p.estado === 'falló' ? '❌' : '⏭️ '
    const tiempo = p.duracion ? ` (${segundos(p.duracion)})` : ''
    console.log(`${icono} ${p.nombre}${tiempo}`)
  }
  console.log(`   Total: ${segundos(Date.now() - inicio)}`)
}

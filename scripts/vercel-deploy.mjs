#!/usr/bin/env node
/**
 * Wrapper para la CLI de Vercel que:
 *  - Lee VERCEL_TOKEN desde .env.local (no lo imprime).
 *  - Aplica NODE_OPTIONS=--use-system-ca (red corporativa con TLS interceptado).
 *  - Reenvía los argumentos a `vercel`.
 *  - Comando especial `logs`: muestra el log de build del último despliegue
 *    (o de una URL dada).
 *
 * Uso:
 *   node scripts/vercel-deploy.mjs deploy --prod --yes   (producción)
 *   node scripts/vercel-deploy.mjs deploy --yes          (preview)
 *   node scripts/vercel-deploy.mjs ls                    (estado/listado)
 *   node scripts/vercel-deploy.mjs logs                  (log del último build)
 *   node scripts/vercel-deploy.mjs logs <url>            (log de un build concreto)
 *
 * Requiere: `npm i -g vercel` y un VERCEL_TOKEN en .env.local
 * (créalo en https://vercel.com/account/tokens).
 */
import { spawn, execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const env = { ...process.env, NODE_OPTIONS: '--use-system-ca' }

try {
  for (const line of readFileSync(join(root, '.env.local'), 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*VERCEL_TOKEN\s*=\s*(.+?)\s*$/)
    if (m && m[1]) env.VERCEL_TOKEN = m[1].replace(/^["']|["']$/g, '')
  }
} catch {
  // sin .env.local: se usará VERCEL_TOKEN del entorno si existe
}

if (!env.VERCEL_TOKEN) {
  console.error('\n❌ Falta VERCEL_TOKEN.')
  console.error('   1) Crea un token en https://vercel.com/account/tokens')
  console.error('   2) Pégalo en .env.local:  VERCEL_TOKEN=tu_token\n')
  process.exit(1)
}

const args = process.argv.slice(2)
if (args.length === 0) args.push('deploy', '--prod', '--yes')

// `vercel` se ejecuta con shell (en Windows es vercel.cmd). Como los argumentos
// son banderas/URLs sin espacios, construimos un único comando para evitar el
// DeprecationWarning DEP0190 de pasar args con shell:true.
function vercel(comando) {
  const child = spawn(`vercel ${comando}`, [], { stdio: 'inherit', shell: true, cwd: root, env })
  child.on('exit', (code) => process.exit(code ?? 0))
  child.on('error', (e) => { console.error('No se pudo ejecutar vercel:', e.message); process.exit(1) })
}

if (args[0] === 'logs') {
  let url = args[1]
  if (!url) {
    try {
      const out = execSync('vercel ls', { cwd: root, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
      const m = out.match(/https:\/\/[a-z0-9-]+\.vercel\.app/i)
      if (!m) { console.error('No se encontró un despliegue reciente. Pasa una URL: ... logs <url>'); process.exit(1) }
      url = m[0]
    } catch (e) {
      console.error('No se pudo obtener el último despliegue:', e.message); process.exit(1)
    }
  }
  console.log(`📋 Log de build de ${url}\n`)
  vercel(`inspect ${url} --logs`)
} else {
  vercel(args.join(' '))
}

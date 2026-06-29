#!/usr/bin/env node
/**
 * Wrapper para la CLI de Vercel que:
 *  - Lee VERCEL_TOKEN desde .env.local (no lo imprime).
 *  - Aplica NODE_OPTIONS=--use-system-ca (red corporativa con TLS interceptado).
 *  - Reenvía los argumentos a `vercel`.
 *
 * Uso:
 *   node scripts/vercel-deploy.mjs deploy --prod --yes   (producción)
 *   node scripts/vercel-deploy.mjs deploy --yes          (preview)
 *   node scripts/vercel-deploy.mjs ls                    (estado/listado)
 *   node scripts/vercel-deploy.mjs inspect <url> --logs  (logs de un deploy)
 *
 * Requiere: `npm i -g vercel` y un VERCEL_TOKEN en .env.local
 * (créalo en https://vercel.com/account/tokens).
 */
import { spawn } from 'node:child_process'
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

const child = spawn('vercel', args, { stdio: 'inherit', shell: true, cwd: root, env })
child.on('exit', (code) => process.exit(code ?? 0))
child.on('error', (e) => { console.error('No se pudo ejecutar vercel:', e.message); process.exit(1) })

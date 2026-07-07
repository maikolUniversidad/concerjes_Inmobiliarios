// Aplica migraciones SQL a Supabase usando la conexión directa (session mode).
// Las migraciones están escritas de forma idempotente, así que es seguro repetir.
// Uso: node scripts/apply-migrations.mjs <archivo1.sql> <archivo2.sql> ...
import { createRequire } from 'module'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const require = createRequire(import.meta.url)
const pg = require('pg')
const { Client } = pg

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')

// Leer DIRECT_URL de .env.local
const env = readFileSync(join(root, '.env.local'), 'utf8')
const m = env.match(/^DIRECT_URL="?([^"\n]+)"?/m)
if (!m) { console.error('No se encontró DIRECT_URL en .env.local'); process.exit(1) }
const connectionString = m[1].trim()

const archivos = process.argv.slice(2)
if (archivos.length === 0) { console.error('Indica al menos un archivo .sql'); process.exit(1) }

const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } })
await client.connect()
console.log('🔌 Conectado a la base de datos\n')

let fallos = 0
for (const rel of archivos) {
  const ruta = join(root, rel)
  const sql = readFileSync(ruta, 'utf8')
  process.stdout.write(`▶ ${rel} … `)
  try {
    await client.query('BEGIN')
    await client.query(sql)
    await client.query('COMMIT')
    console.log('✅')
  } catch (e) {
    await client.query('ROLLBACK')
    fallos++
    console.log('❌')
    console.error(`   ${e.message}\n`)
  }
}

await client.end()
console.log(`\n${fallos === 0 ? '✅ Todas las migraciones aplicadas' : `⚠️ ${fallos} migración(es) con error`}`)
process.exit(fallos === 0 ? 0 : 1)

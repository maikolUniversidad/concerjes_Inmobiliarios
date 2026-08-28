import { createRequire } from 'module'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
const require = createRequire(import.meta.url)
const { Client } = require('pg')
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const env = readFileSync(join(root, '.env.local'), 'utf8')
const m = env.match(/^DIRECT_URL="?([^"\n]+)"?/m)
const client = new Client({ connectionString: m[1].trim(), ssl: { rejectUnauthorized: false } })
await client.connect()
const sql = process.argv[2] === '-f' ? readFileSync(join(root, process.argv[3]), 'utf8') : process.argv.slice(2).join(' ')
const r = await client.query(sql)
console.log(JSON.stringify(r.rows, null, 2))
await client.end()

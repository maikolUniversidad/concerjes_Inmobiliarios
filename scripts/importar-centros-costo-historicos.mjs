// Carga el catálogo COMPLETO de centros de costo de nómina (hoja "Hoja1" del
// informe «Informe de Personal Por Centro de Costos») en `centros_costo`.
//
// Los 92 centros que ya existían vienen del informe de ACTIVOS: son los
// contratos vigentes. Los demás (contratos ya terminados) entran como
// `activo = false` para que el combo del ATS muestre solo los vigentes, pero
// queden disponibles para reactivar desde Planta de personal.
//
// Uso: NODE_OPTIONS=--use-system-ca node scripts/importar-centros-costo-historicos.mjs "<ruta al .xlsx>"
import { createRequire } from 'module'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const require = createRequire(import.meta.url)
const { Client } = require('pg')
const ExcelJS = require('exceljs')

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const env = readFileSync(join(root, '.env.local'), 'utf8')
const url = env.match(/^DIRECT_URL="?([^"\n]+)"?/m)?.[1]?.trim()
if (!url) { console.error('Falta DIRECT_URL en .env.local'); process.exit(1) }

const archivo = process.argv[2]
if (!archivo) { console.error('Indica la ruta del Excel de centros de costo.'); process.exit(1) }

// "TRANSMILENIO 2026-BOGOTA" → nombre "TRANSMILENIO 2026", ciudad "BOGOTA".
function partir(codigo) {
  const i = codigo.lastIndexOf('-')
  if (i <= 0) return { nombre: codigo, ciudad: null }
  const ciudad = codigo.slice(i + 1).trim()
  // Si lo que sigue al guion no parece ciudad (tiene dígitos), se deja entero.
  if (/\d/.test(ciudad) || ciudad.length < 3) return { nombre: codigo, ciudad: null }
  return { nombre: codigo.slice(0, i).trim(), ciudad }
}

const wb = new ExcelJS.Workbook()
await wb.xlsx.readFile(archivo)
const hoja = wb.getWorksheet('Hoja1') ?? wb.worksheets[0]
const codigos = new Set()
hoja.eachRow((row, n) => {
  const v = String(row.getCell(1).value ?? '').trim()
  if (n === 1 && /cargo_centros/i.test(v)) return
  if (v) codigos.add(v)
})
console.log(`Centros en el archivo: ${codigos.size}`)

const client = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
await client.connect()
const { rows: existentes } = await client.query('SELECT codigo FROM centros_costo')
const ya = new Set(existentes.map((r) => r.codigo))

let nuevos = 0
await client.query('BEGIN')
for (const codigo of codigos) {
  if (ya.has(codigo)) continue
  const { nombre, ciudad } = partir(codigo)
  const esDisp = /^DISPONIBLE/i.test(codigo)
  const esAdm = /^ADMINISTRATIVO/i.test(codigo)
  await client.query(
    `INSERT INTO centros_costo (codigo, nombre, ciudad, es_disponibilidad, es_administrativo, activo)
     VALUES ($1, $2, $3, $4, $5, false) ON CONFLICT (codigo) DO NOTHING`,
    [codigo, nombre, ciudad, esDisp, esAdm],
  )
  nuevos++
}
await client.query('COMMIT')
const { rows: [tot] } = await client.query('SELECT count(*)::int total, count(*) filter (where activo)::int activos FROM centros_costo')
console.log(`Nuevos (históricos, inactivos): ${nuevos} · Total ahora: ${tot.total} (${tot.activos} activos)`)
await client.end()

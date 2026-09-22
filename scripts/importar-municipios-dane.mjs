// Carga el listado COMPLETO de municipios (DIVIPOLA del DANE) en `municipios`.
//
// El seed del registro de vacantes solo traía capitales y ciudades principales
// (73). Con eso una aspirante nacida en Chinchiná no podía ni escoger su lugar
// de nacimiento, y los formatos de contratación salían con ese campo vacío.
//
// Fuente: datos.gov.co, conjunto gdxc-w37w (DIVIPOLA · municipios).
// No pisa los nombres que ya existen; agrega los que faltan y su equivalencia
// de nómina (ciudad/departamento WO) para que el expediente arme los códigos.
//
// Uso: NODE_OPTIONS=--use-system-ca node scripts/importar-municipios-dane.mjs
import { createRequire } from 'module'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const require = createRequire(import.meta.url)
const { Client } = require('pg')

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const env = readFileSync(join(root, '.env.local'), 'utf8')
const url = env.match(/^DIRECT_URL="?([^"\n]+)"?/m)?.[1]?.trim()
if (!url) { console.error('Falta DIRECT_URL en .env.local'); process.exit(1) }

const res = await fetch('https://www.datos.gov.co/resource/gdxc-w37w.json?$limit=5000')
if (!res.ok) { console.error('No se pudo descargar DIVIPOLA:', res.status); process.exit(1) }
const filas = await res.json()
console.log(`Municipios en DIVIPOLA: ${filas.length}`)

const client = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
await client.connect()
const { rows: deptos } = await client.query('SELECT codigo_dane FROM departamentos')
const hay = new Set(deptos.map((d) => d.codigo_dane))

let nuevos = 0, sinDepto = 0
await client.query('BEGIN')
for (const f of filas) {
  const cod = String(f.cod_mpio ?? '').padStart(5, '0')
  const dep = String(f.cod_dpto ?? '').padStart(2, '0')
  const nombre = String(f.nom_mpio ?? '').trim().toUpperCase()
  if (!cod || !nombre) continue
  if (!hay.has(dep)) { sinDepto++; continue }
  const r = await client.query(
    `INSERT INTO municipios (codigo_dane, departamento_codigo, nombre) VALUES ($1, $2, $3)
     ON CONFLICT (codigo_dane) DO NOTHING`, [cod, dep, nombre])
  nuevos += r.rowCount
}
// Equivalencia de nómina por defecto para los nuevos: la caja del departamento.
await client.query(`
  INSERT INTO municipios_nomina (municipio_codigo, ciudad_wo, depto_wo, ciudad_arl, depto_arl, ccf_id)
  SELECT m.codigo_dane, m.nombre, d.nombre, m.nombre, d.nombre,
         (SELECT c.id FROM cajas_compensacion c WHERE c.departamento_codigo = d.codigo_dane ORDER BY c.nombre LIMIT 1)
    FROM municipios m JOIN departamentos d ON d.codigo_dane = m.departamento_codigo
  ON CONFLICT (municipio_codigo) DO NOTHING`)
await client.query('COMMIT')
const { rows: [t] } = await client.query('SELECT count(*)::int n FROM municipios')
console.log(`Nuevos: ${nuevos} · Sin departamento en catálogo: ${sinDepto} · Total ahora: ${t.n}`)
await client.end()

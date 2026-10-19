// Paridad entre la vigencia del contrato en la BASE y en TypeScript.
//
// `grupo_vigente()` / `grupo_vigencia_fin()` (migración 20261019000010) y
// `estaVigente()` / `vigenciaFin()` / `vigenciaInicio()`
// (apps/inventario/lib/contratos-conserjeria.ts) calculan LO MISMO a propósito:
// la base es la que manda —la consultan los QR y las visitas— y el TypeScript
// es para pintar el estado en la pantalla sin una consulta por fila. Esa
// duplicación se paga con este script: si alguien cambia una de las dos y no la
// otra, aquí se nota. Ya pasó una vez: `textoVigencia` ignoraba el `desde` de
// los periodos y la base no.
//
// Todo va dentro de BEGIN … ROLLBACK: no deja nada escrito.
// Uso, desde la raíz del repo (el flag es para poder importar el .ts):
//   node --use-system-ca --experimental-strip-types scripts/probar-vigencia-paridad.mjs
import { createRequire } from 'module'
import { readFileSync, existsSync } from 'fs'
import { fileURLToPath, pathToFileURL } from 'url'
import { dirname, join, resolve } from 'path'

const require = createRequire(import.meta.url)
const { Client } = require('pg')

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..')
const { estaVigente, vigenciaFin, vigenciaInicio } = await import(
  pathToFileURL(join(raiz, 'apps', 'inventario', 'lib', 'contratos-conserjeria.ts')).href)

function cadena() {
  if (process.env.DIRECT_URL) return process.env.DIRECT_URL.trim()
  // El worktree no siempre tiene .env.local: está en el checkout principal.
  const candidatos = [join(raiz, '.env.local'), resolve(raiz, '..', '..', '..', '.env.local')]
  for (const f of candidatos) {
    if (!existsSync(f)) continue
    const m = readFileSync(f, 'utf8').match(/^DIRECT_URL="?([^"\n]+)"?/m)
    if (m) return m[1].trim()
  }
  console.error('No se encontró DIRECT_URL (ni en el entorno ni en .env.local)')
  process.exit(1)
}

const c = new Client({ connectionString: cadena(), ssl: { rejectUnauthorized: false } })
await c.connect()
const HOY = (await c.query('select current_date::text d')).rows[0].d

// Cada caso: estado, fechas del contrato y periodos [desde, hasta].
const casos = [
  { n: 'vigente simple',             estado: 'VIGENTE',    desde: '2026-01-01', hasta: '2026-12-31', per: [] },
  { n: 'vencido sin prórroga',       estado: 'VIGENTE',    desde: '2025-01-01', hasta: '2026-08-31', per: [] },
  { n: 'vencido con prórroga',       estado: 'VIGENTE',    desde: '2025-07-01', hasta: '2026-06-30', per: [['2026-07-01', '2027-03-31']] },
  { n: 'prórroga sin fin',           estado: 'VIGENTE',    desde: '2025-07-01', hasta: '2026-06-30', per: [['2026-07-01', null]] },
  { n: 'sin fechas, otrosí abierto', estado: 'VIGENTE',    desde: null,         hasta: null,         per: [['2024-02-01', null]] },
  { n: 'sin fechas ni periodos',     estado: 'VIGENTE',    desde: null,         hasta: null,         per: [] },
  { n: 'aún no empieza',             estado: 'VIGENTE',    desde: '2027-01-01', hasta: '2027-12-31', per: [] },
  { n: 'periodo antes del inicio',   estado: 'VIGENTE',    desde: '2027-01-01', hasta: '2027-12-31', per: [['2026-01-01', '2026-12-31']] },
  { n: 'suspendido en fechas',       estado: 'SUSPENDIDO', desde: '2026-01-01', hasta: '2026-12-31', per: [] },
  { n: 'borrador en fechas',         estado: 'BORRADOR',   desde: '2026-01-01', hasta: '2026-12-31', per: [] },
  { n: 'terminado con prórroga',     estado: 'TERMINADO',  desde: '2026-01-01', hasta: '2026-12-31', per: [['2026-07-01', '2027-03-31']] },
]

await c.query('BEGIN')
let i = 0, mal = 0
try {
  for (const k of casos) {
    const { rows: [g] } = await c.query(
      `insert into grupos_contrato (codigo, nombre, estado, vigencia_desde, vigencia_hasta)
       values ($1, $2, $3, $4, $5) returning id`,
      [`ZP${++i}`, `paridad ${i}`, k.estado, k.desde, k.hasta])
    for (const [desde, hasta] of k.per) {
      await c.query(
        `insert into grupo_vigencias (grupo_id, desde, hasta, tipo) values ($1, $2, $3, 'PRORROGA')`,
        [g.id, desde, hasta])
    }
    const { rows: [r] } = await c.query(
      'select grupo_vigente($1) v, grupo_vigencia_fin($1)::text f', [g.id])

    const contrato = { estado: k.estado, activo: true, vigencia_desde: k.desde, vigencia_hasta: k.hasta }
    const periodos = k.per.map(([desde, hasta]) => ({ desde, hasta }))
    const ts = estaVigente(contrato, periodos, HOY)
    const tsFin = vigenciaFin(contrato, periodos)

    const igualVigente = ts === r.v
    const igualFin = (tsFin ?? null) === (r.f ?? null)
    if (!igualVigente || !igualFin) mal++
    console.log(
      `${igualVigente && igualFin ? 'OK     ' : 'DIFIERE'} ${k.n.padEnd(26)}` +
      ` vigente sql=${r.v} ts=${ts} | fin sql=${r.f ?? 'null'} ts=${tsFin ?? 'null'}` +
      ` | inicio ts=${vigenciaInicio(contrato, periodos) ?? 'null'}`)
  }
} finally {
  await c.query('ROLLBACK')
  await c.end()
}

console.log(`\n${casos.length - mal}/${casos.length} coinciden entre la base y TypeScript.` +
  ' Todo revertido con ROLLBACK.')
process.exit(mal ? 1 : 0)

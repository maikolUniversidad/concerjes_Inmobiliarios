// =============================================================================
// Tanda 3 · fichas de nómina sin ciudad
// =============================================================================
// `vw_planta_inconsistencias` marca con SIN_CIUDAD 35 fichas. La pregunta del
// encargo era si la ciudad se puede DEDUCIR DEL CENTRO DE COSTO. No se puede, y
// la razón está en la forma de los informes:
//
//   · Las 35 están RETIRADAS y vienen solo del «Informe Personal por Fecha de
//     Retiro». Ese informe NO trae columna de centro de costos —mírese el
//     encabezado: CentroTrabajo, Apellidos y Nombres, Identificacion, Codigo
//     Empleado, Direccion, Telefono, Fecha de Ingreso, Periodo Prueba, Fecha
//     Fin Contrato, Fecha de Retiro, Tipo de Contrato—. Por eso las 35 no
//     tienen `centro_costo_id` ni en `personas` ni en su vinculación: no hay
//     de dónde deducir.
//   · La ciudad de ese informe viene en el encabezado de grupo `CentroTrabajo`
//     («Ciudad: X Depto: Y»), que solo se imprime cuando cambia. Las 35 caen en
//     el PRIMER bloque del archivo (filas 5 a 51), y ese bloque tiene la celda
//     VACÍA en el origen: no es que el cargue perdiera el encabezado, es que
//     nómina no lo imprimió. El primer «Ciudad:» aparece en la fila 52.
//
// Qué se sabe de ese primer bloque: son 47 personas; 12 también salen en el
// informe de activos y las 12 están en el centro de costo POLICIA-SAN ANDRES,
// ciudad SAN ANDRES PROVIDENCIA. Las 35 restantes son los retiros más recientes
// del archivo (2026-07-31 a 2026-08-22; en todo el archivo no hay ningún otro
// retiro en esa ventana) y 2 de sus direcciones nombran sectores de la isla.
//
// Eso es indicio, NO es prueba: el bloque se agrupa por «sin centro de trabajo»
// —los retiros recién procesados, a los que ya les quitaron el centro—, no por
// ciudad, así que podría mezclar varias. Por eso:
//
//   · por defecto no se resuelve nada, solo se informa;
//   · --mapa <archivo>  aplica un mapeo documento→ciudad que alguien llenó a
//     mano o sacó de nómina (JSON {"<doc>":"CIUDAD"} o CSV documento,ciudad).
//     Este es el camino bueno;
//   · --hipotesis-san-andres  rellena el bloque entero con SAN ANDRES
//     PROVIDENCIA. Hay que pedirlo a propósito, porque es una inferencia.
//
// Uso:
//   node --use-system-ca scripts/limpiar-planta-ciudad.mjs
//   node --use-system-ca scripts/limpiar-planta-ciudad.mjs --mapa C:/tmp/ciudades.csv
//   node --use-system-ca scripts/limpiar-planta-ciudad.mjs --mapa C:/tmp/ciudades.csv --aplicar
//   node --use-system-ca scripts/limpiar-planta-ciudad.mjs --hipotesis-san-andres --aplicar
//   node --use-system-ca scripts/limpiar-planta-ciudad.mjs --plantilla C:/tmp/ciudades.csv
// =============================================================================
import { createRequire } from 'module'
import { readFileSync, writeFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const require = createRequire(import.meta.url)
const { Client } = require('pg')
const root = join(dirname(fileURLToPath(import.meta.url)), '..')

const args = process.argv.slice(2)
const flag = (n, def) => {
  const i = args.indexOf(`--${n}`)
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : def
}
const APLICAR = args.includes('--aplicar')
const HIPOTESIS = args.includes('--hipotesis-san-andres')
const MAPA = flag('mapa', null)
const PLANTILLA = flag('plantilla', null)
const CIUDAD_HIPOTESIS = flag('ciudad', 'SAN ANDRES PROVIDENCIA')

const env = readFileSync(join(root, '.env.local'), 'utf8')
const c = new Client({
  connectionString: env.match(/^DIRECT_URL="?([^"\n]+)"?/m)[1].trim(),
  ssl: { rejectUnauthorized: false },
})
await c.connect()

const sinCiudad = (await c.query(`
  SELECT p.id, p.documento, p.estado, p.cargo, p.centro_costo_id, p.departamento,
         p.fecha_retiro, p.direccion, p.sede_id,
         (SELECT COUNT(*) FROM persona_vinculaciones v
           WHERE v.persona_id = p.id AND v.centro_costo_id IS NOT NULL)::int AS vinc_con_centro
    FROM vw_planta_inconsistencias i
    JOIN personas p ON p.id = i.id
   WHERE i.motivo = 'SIN_CIUDAD'
   ORDER BY p.fecha_retiro
`)).rows

console.log(`\nTanda 3 · fichas sin ciudad  (${APLICAR ? 'APLICANDO' : 'SIMULACIÓN'})\n`)
console.log(`fichas marcadas SIN_CIUDAD : ${sinCiudad.length}`)
console.log('\n¿se puede deducir del centro de costo?')
console.log(`  ${sinCiudad.filter((p) => p.centro_costo_id).length} / ${sinCiudad.length}  tienen centro de costo en la ficha`)
console.log(`  ${sinCiudad.filter((p) => p.vinc_con_centro > 0).length} / ${sinCiudad.length}  tienen centro de costo en alguna vinculación`)
console.log('  → NO. El informe de retiros no trae columna de centro de costos.')

const estados = {}
for (const p of sinCiudad) estados[p.estado] = (estados[p.estado] || 0) + 1
console.log('\nqué son:')
for (const [k, v] of Object.entries(estados)) console.log(`  ${String(v).padStart(4)}  ${k}`)
const fechas = sinCiudad
  .map((p) => (p.fecha_retiro ? new Date(p.fecha_retiro).toISOString().slice(0, 10) : null))
  .filter(Boolean).sort()
if (fechas.length) console.log(`  retiros entre ${fechas[0]} y ${fechas[fechas.length - 1]}`)
console.log(`  ${sinCiudad.filter((p) => p.direccion).length} con dirección, ${sinCiudad.filter((p) => p.cargo).length} con cargo`)

// El resto del primer bloque del informe: los que SÍ se pudieron ubicar.
const bloque = (await c.query(`
  SELECT ciudad, COUNT(*)::int n FROM personas
   WHERE ciudad IS NOT NULL
     AND id IN (SELECT p.id FROM personas p
                  JOIN centros_costo cc ON cc.id = p.centro_costo_id
                 WHERE cc.codigo = 'POLICIA-SAN ANDRES')
   GROUP BY 1
`)).rows
console.log('\nel indicio · los 12 compañeros del mismo bloque del informe que sí se')
console.log('pudieron ubicar están todos en POLICIA-SAN ANDRES, que quedó así de ciudad:')
for (const b of bloque) console.log(`  ${String(b.n).padStart(4)}  ${b.ciudad}`)

if (PLANTILLA) {
  const csv = ['documento,ciudad,departamento']
    .concat(sinCiudad.map((p) => `${p.documento},,`))
    .join('\n')
  writeFileSync(PLANTILLA, csv + '\n', 'utf8')
  console.log(`\nplantilla para llenar a mano: ${PLANTILLA}`)
}

// ── Qué se va a escribir ─────────────────────────────────────────────────────
let plan = []
if (MAPA) {
  const bruto = readFileSync(MAPA, 'utf8')
  const mapa = new Map()
  if (bruto.trim().startsWith('{')) {
    for (const [k, v] of Object.entries(JSON.parse(bruto))) mapa.set(String(k).trim(), String(v).trim())
  } else {
    for (const linea of bruto.split(/\r?\n/).slice(1)) {
      const [doc, ciudad, depto] = linea.split(',').map((x) => (x ?? '').trim())
      if (doc && ciudad) mapa.set(doc, ciudad + (depto ? '|' + depto : ''))
    }
  }
  for (const p of sinCiudad) {
    const v = mapa.get(p.documento)
    if (!v) continue
    const [ciudad, depto] = v.split('|')
    plan.push({ id: p.id, documento: p.documento, ciudad, departamento: depto || null, fuente: 'mapa' })
  }
  console.log(`\n--mapa: ${plan.length} de ${sinCiudad.length} fichas traen ciudad en el archivo`)
} else if (HIPOTESIS) {
  plan = sinCiudad.map((p) => ({ id: p.id, documento: p.documento, ciudad: CIUDAD_HIPOTESIS, departamento: null, fuente: 'hipótesis' }))
  console.log(`\n--hipotesis-san-andres: ${plan.length} fichas quedarían en «${CIUDAD_HIPOTESIS}»`)
  console.log('  OJO: es una inferencia a partir de 12 compañeros de bloque, no un dato del informe.')
} else {
  console.log('\nSin --mapa ni --hipotesis-san-andres no se resuelve nada: las 35 se quedan marcadas.')
  console.log('Lo que de verdad las cierra es un reexporte del informe de retiros con el')
  console.log('centro de trabajo impreso en todas las filas, o llenar la plantilla a mano')
  console.log('(--plantilla) y volver con --mapa.\n')
  await c.end()
  process.exit(0)
}

console.log('\nantes y después:')
for (const p of plan.slice(0, 10)) {
  console.log(`  doc ${p.documento.slice(0, 2)}****${p.documento.slice(-2)}:  ciudad NULL → ${p.ciudad}`)
}
if (plan.length > 10) console.log(`  … y ${plan.length - 10} más`)

if (!APLICAR) {
  console.log('\nSimulación: no se escribió nada. Para aplicar: --aplicar\n')
  await c.end()
  process.exit(0)
}

await c.query('BEGIN')
let n = 0
for (const p of plan) {
  // Solo rellena lo vacío: si alguien ya le puso ciudad, no se pisa.
  const res = await c.query(
    `UPDATE personas SET ciudad = $2, departamento = COALESCE(departamento, $3)
      WHERE id = $1 AND ciudad IS NULL`,
    [p.id, p.ciudad, p.departamento]
  )
  n += res.rowCount
}
await c.query('COMMIT')
const quedan = (await c.query(
  `SELECT COUNT(*)::int n FROM vw_planta_inconsistencias WHERE motivo = 'SIN_CIUDAD'`
)).rows[0].n
console.log(`\nactualizadas: ${n} fichas`)
console.log(`SIN_CIUDAD en la vista: ${sinCiudad.length} → ${quedan}\n`)
await c.end()

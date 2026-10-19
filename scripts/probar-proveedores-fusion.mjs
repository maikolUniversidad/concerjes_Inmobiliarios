// Pruebas de la fusión de proveedores duplicados, contra la base REAL dentro de
// una transacción que se revierte al final.
//
// Qué comprueba: que no quede ningún nombre repetido entre los activos, que
// NINGUNA referencia quede apuntando a un proveedor desactivado (las siete
// columnas con FK a proveedores.id, leídas de pg_constraint y no de una lista a
// mano), que la orden de compra de BEAUTE termine junto a sus precios, que no se
// pierda cobertura de precios, que correrla dos veces no cambie nada, y que el
// índice único impida volver a crear un duplicado.
//
// No deja nada escrito: todo va dentro de BEGIN … ROLLBACK.
// Uso: node --use-system-ca scripts/probar-proveedores-fusion.mjs
import { createRequire } from 'module'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const require = createRequire(import.meta.url)
const { Client } = require('pg')

const __dirname = dirname(fileURLToPath(import.meta.url))
const raiz = join(__dirname, '..')
const env = readFileSync(join(raiz, '.env.local'), 'utf8')
const m = env.match(/^DIRECT_URL="?([^"\n]+)"?/m)
if (!m) { console.error('No se encontró DIRECT_URL en .env.local'); process.exit(1) }

// La transacción la pone esta prueba, igual que se la pone apply-migrations.mjs
// cuando se aplica de verdad. Si alguien le agrega un BEGIN/COMMIT a la
// migración, se le quitan aquí para que el ROLLBACK del final alcance a
// revertirla.
const MIGRACION = join(raiz, 'supabase', 'migrations', '20261019000002_proveedores_fusionar_duplicados.sql')
const sqlMigracion = readFileSync(MIGRACION, 'utf8')
  .replace(/^[ \t]*BEGIN[ \t]*;[ \t]*$/gim, '')
  .replace(/^[ \t]*COMMIT[ \t]*;[ \t]*$/gim, '')

const c = new Client({ connectionString: m[1].trim(), ssl: { rejectUnauthorized: false } })
await c.connect()
let ok = 0, fail = 0
const check = (titulo, cond, detalle = '') => {
  if (cond) { ok++; console.log(`  OK   ${titulo}${detalle ? ' · ' + detalle : ''}`) }
  else { fail++; console.log(`  MAL  ${titulo}${detalle ? ' · ' + detalle : ''}`) }
}
let sp = 0
const falla = async (sql, params = []) => {
  const nombre = `p${++sp}`
  await c.query(`SAVEPOINT ${nombre}`)
  try { await c.query(sql, params); await c.query(`RELEASE SAVEPOINT ${nombre}`); return null }
  catch (e) { await c.query(`ROLLBACK TO SAVEPOINT ${nombre}`); return e.message }
}
const uno = async (sql, params = []) => (await c.query(sql, params)).rows[0]

// Las columnas que referencian proveedores.id, leídas del catálogo.
const FKS = `
  SELECT src.relname AS tabla,
         (SELECT a.attname FROM pg_attribute a
           WHERE a.attrelid = con.conrelid AND a.attnum = con.conkey[1]) AS col
    FROM pg_constraint con
    JOIN pg_class src ON src.oid = con.conrelid
    JOIN pg_class tgt ON tgt.oid = con.confrelid
    JOIN pg_namespace n ON n.oid = tgt.relnamespace
   WHERE con.contype = 'f' AND tgt.relname = 'proveedores' AND n.nspname = 'public'
   ORDER BY 1, 2`

await c.query('BEGIN')
try {
  const { rows: fks } = await c.query(FKS)
  console.log(`Referencias a proveedores.id en la base: ${fks.length}`)
  fks.forEach((f) => console.log(`  · ${f.tabla}.${f.col}`))
  check('Están al menos las siete columnas conocidas', fks.length >= 7, `${fks.length} columnas`)

  // 0) Estado antes
  console.log('\n0) Estado antes de fusionar')
  const antes = await uno(`
    SELECT COUNT(*) FILTER (WHERE activo) activos,
           COUNT(DISTINCT upper(btrim(nombre))) FILTER (WHERE activo) nombres,
           COUNT(*) total
      FROM proveedores`)
  console.log(`  ${antes.activos} activos para ${antes.nombres} nombres distintos (${antes.total} filas)`)
  const preciosAntes = Number((await uno(`SELECT COUNT(DISTINCT producto_id) n FROM precios_proveedor`)).n)
  const ocBeaute = await uno(`
    SELECT COUNT(*) n FROM ordenes_compra oc JOIN proveedores p ON p.id = oc.proveedor_id
     WHERE upper(btrim(p.nombre)) = 'BEAUTE'`)

  // 1) La migración
  console.log('\n1) Correr la migración')
  await c.query(sqlMigracion)
  const despues = await uno(`
    SELECT COUNT(*) FILTER (WHERE activo) activos,
           COUNT(DISTINCT upper(btrim(nombre))) FILTER (WHERE activo) nombres,
           COUNT(*) total
      FROM proveedores`)
  check('Un activo por nombre', despues.activos === despues.nombres,
    `${despues.activos} activos / ${despues.nombres} nombres`)
  check('No se perdió ningún nombre', despues.nombres === antes.nombres, `${despues.nombres} nombres`)
  check('No se borró ningún proveedor, solo se desactivó', despues.total === antes.total,
    `${despues.total} filas en la tabla`)

  // 2) Ninguna referencia huérfana, tabla por tabla
  console.log('\n2) Ninguna referencia queda en un proveedor desactivado')
  for (const f of fks) {
    const r = await uno(
      `SELECT COUNT(*) n FROM ${f.tabla} x JOIN proveedores p ON p.id = x.${f.col} WHERE NOT p.activo`)
    check(`${f.tabla}.${f.col}`, r.n === '0', `${r.n} filas apuntando a un inactivo`)
  }

  // 3) BEAUTE, el único grupo con datos repartidos
  console.log('\n3) BEAUTE: la orden de compra queda con el registro que tiene los precios')
  const beaute = await uno(`
    SELECT p.id,
           (SELECT COUNT(*) FROM precios_proveedor x WHERE x.proveedor_id = p.id) precios,
           (SELECT COUNT(*) FROM ordenes_compra    x WHERE x.proveedor_id = p.id) ordenes
      FROM proveedores p WHERE p.activo AND upper(btrim(p.nombre)) = 'BEAUTE'`)
  check('Un solo BEAUTE activo, con los precios Y la orden',
    Number(beaute.precios) > 0 && beaute.ordenes === ocBeaute.n,
    `${beaute.precios} precios, ${beaute.ordenes} órdenes (antes estaban en registros distintos)`)

  // 4) Los precios
  console.log('\n4) Los precios')
  const preciosDespues = Number((await uno(`SELECT COUNT(DISTINCT producto_id) n FROM precios_proveedor`)).n)
  check('Ningún producto se queda sin precio en el comparador',
    preciosDespues === preciosAntes, `${preciosDespues} productos con precio (antes ${preciosAntes})`)
  const colision = await uno(`
    SELECT COUNT(*) n FROM (
      SELECT producto_id, proveedor_id FROM precios_proveedor
       GROUP BY 1, 2 HAVING COUNT(*) > 1) s`)
  check('Sin duplicados por (producto, proveedor)', colision.n === '0')
  const preciosInactivos = await uno(`
    SELECT COUNT(*) n FROM precios_proveedor pp JOIN proveedores p ON p.id = pp.proveedor_id
     WHERE NOT p.activo`)
  check('Ningún precio cuelga de un proveedor desactivado', preciosInactivos.n === '0',
    'compras_precio_sugerido() no filtra por activo, así que esto importa')

  // 5) Fichas de producto
  console.log('\n5) Fichas de producto')
  const mismoDosVeces = await uno(`
    SELECT COUNT(*) n FROM productos WHERE proveedor2_id IS NOT NULL AND proveedor2_id = proveedor_id`)
  check('Ningún producto tiene el mismo proveedor como principal y como segundo', mismoDosVeces.n === '0')

  // 6) La función que arma la orden
  console.log('\n6) compras_precio_sugerido() ya no puede caer en un duplicado vacío')
  const sugerido = await uno(`
    SELECT COUNT(*) total,
           COUNT(*) FILTER (WHERE pv.id IS NOT NULL AND NOT pv.activo) inactivos
      FROM productos pr
      CROSS JOIN LATERAL compras_precio_sugerido(pr.id) s
      LEFT JOIN proveedores pv ON pv.id = s.proveedor_id
     WHERE pr.activo`)
  check('Nunca sugiere un proveedor desactivado', sugerido.inactivos === '0',
    `${sugerido.total} productos activos evaluados`)

  // 7) Idempotencia
  console.log('\n7) Correrla otra vez no cambia nada')
  const huella = async () => (await uno(`
    SELECT md5(string_agg(id::text || activo::text, ',' ORDER BY id)) h FROM proveedores`)).h
  const h1 = await huella()
  const preciosH1 = (await uno(`SELECT COUNT(*) n FROM precios_proveedor`)).n
  await c.query(sqlMigracion)
  check('Segunda corrida: proveedores queda idéntica', h1 === (await huella()))
  check('Segunda corrida: no borra ningún precio',
    preciosH1 === (await uno(`SELECT COUNT(*) n FROM precios_proveedor`)).n, `${preciosH1} precios`)

  // 8) El índice único
  console.log('\n8) El índice único impide volver a crear el duplicado')
  const nombreVivo = (await uno(`SELECT nombre FROM proveedores WHERE activo ORDER BY nombre LIMIT 1`)).nombre
  let e = await falla(`INSERT INTO proveedores (nombre, activo) VALUES ($1, true)`, [nombreVivo])
  check('Rechaza un activo con el mismo nombre',
    /duplicate key|proveedores_nombre_activo_key/.test(e || ''), e || 'lo dejó entrar')
  e = await falla(`INSERT INTO proveedores (nombre, activo) VALUES ($1, true)`,
    [`  ${nombreVivo.toLowerCase()} `])
  check('Lo rechaza también con otras mayúsculas y con espacios alrededor',
    /duplicate key|proveedores_nombre_activo_key/.test(e || ''), e || 'lo dejó entrar')
  e = await falla(`INSERT INTO proveedores (nombre, activo) VALUES ($1, false)`, [nombreVivo])
  check('Pero deja conservar el nombre en uno retirado', e === null, e || 'insertado')
  e = await falla(`INSERT INTO proveedores (nombre, activo) VALUES ('PROVEEDOR DE PRUEBA FUSION', true)`)
  check('Un nombre nuevo entra sin problema', e === null, e || 'insertado')
} finally {
  await c.query('ROLLBACK')
  console.log('\n(ROLLBACK: la base quedó como estaba)')
}
console.log(`\n${ok} bien, ${fail} mal`)
await c.end()
process.exit(fail ? 1 : 0)

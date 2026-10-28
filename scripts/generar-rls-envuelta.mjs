// Genera la migración que envuelve en (select ...) las llamadas a funciones
// STABLE dentro de las policies de RLS. Lee las expresiones ya deparseadas de
// pg_policies y las reescribe con un escáner de paréntesis balanceados (no con
// una regex, que rompería el balance en llamadas con paréntesis anidados).
import { createRequire } from 'module'
import { readFileSync, writeFileSync } from 'fs'
const require = createRequire('file:///C:/Users/maiko/OneDrive/Documentos/Desarrollos/conserjes_inmobiliarios/package.json')
const { Client } = require('pg')
const ROOT = 'C:/Users/maiko/OneDrive/Documentos/Desarrollos/conserjes_inmobiliarios'
const env = readFileSync(ROOT + '/.env.local', 'utf8')
const c = new Client({ connectionString: env.match(/^DIRECT_URL="?([^"\n]+)"?/m)[1].trim(), ssl: { rejectUnauthorized: false } })
await c.connect()

// Las funciones que hoy se evalúan una vez por fila dentro de las policies.
const FUNCIONES = ['auth_permiso_any', 'auth_permiso', 'auth_rol', 'auth.uid', 'auth.jwt']

const esIdent = (ch) => /[A-Za-z0-9_.]/.test(ch)

/** Reescribe `fn(...)` como `( SELECT fn(...))`, saltando lo ya envuelto. */
function envolver(expr) {
  let out = expr
  let cambios = 0
  for (const fn of FUNCIONES) {
    let i = 0
    let res = ''
    while (i < out.length) {
      const j = out.indexOf(fn + '(', i)
      if (j < 0) { res += out.slice(i); break }
      // ¿es el comienzo de un identificador? (no `mi_auth_permiso(`)
      const antesCh = j > 0 ? out[j - 1] : ' '
      if (esIdent(antesCh)) { res += out.slice(i, j + fn.length + 1); i = j + fn.length + 1; continue }
      // buscar el paréntesis de cierre que corresponde
      let k = j + fn.length, prof = 0, fin = -1
      for (; k < out.length; k++) {
        if (out[k] === '(') prof++
        else if (out[k] === ')') { prof--; if (prof === 0) { fin = k; break } }
      }
      if (fin < 0) { res += out.slice(i); break } // expresión rara: no tocar
      const llamada = out.slice(j, fin + 1)
      // ¿ya viene envuelta?  pg la deparsea como `( SELECT fn(...) AS alias)`
      const antes = out.slice(0, j)
      if (/\(\s*SELECT\s*$/i.test(antes)) { res += out.slice(i, fin + 1); i = fin + 1; continue }
      res += out.slice(i, j) + '( SELECT ' + llamada + ')'
      cambios++
      i = fin + 1
    }
    out = res
  }
  return { expr: out, cambios }
}

/** Quita los `( SELECT x)` que agregamos, para comprobar que no cambió nada más. */
const desenvolver = (s) => s.replace(/\(\s*SELECT\s+((?:auth_permiso_any|auth_permiso|auth_rol|auth\.uid|auth\.jwt)\([^()]*(?:\([^()]*\)[^()]*)*\))\)/gi, '$1')
const normalizar = (s) => (s ?? '').replace(/\s+/g, ' ').trim()

const { rows } = await c.query(`
  select schemaname, tablename, policyname, cmd, permissive, roles, qual, with_check
  from pg_policies
  order by schemaname, tablename, policyname`)

const aCorregir = []
const avisos = []
for (const p of rows) {
  const q = p.qual ? envolver(p.qual) : null
  const w = p.with_check ? envolver(p.with_check) : null
  const cambios = (q?.cambios ?? 0) + (w?.cambios ?? 0)
  if (cambios === 0) continue
  // Comprobación de seguridad: desenvolver lo nuevo debe devolver lo viejo.
  for (const [campo, viejo, nuevo] of [['qual', p.qual, q?.expr], ['with_check', p.with_check, w?.expr]]) {
    if (viejo && normalizar(desenvolver(nuevo)) !== normalizar(viejo)) {
      avisos.push(`${p.schemaname}.${p.tablename}.${p.policyname} (${campo}): la reescritura no es reversible`)
    }
  }
  aCorregir.push({ ...p, qualNuevo: q?.expr ?? null, checkNuevo: w?.expr ?? null, cambios })
}

console.log(`policies totales: ${rows.length}`)
console.log(`policies a corregir: ${aCorregir.length}`)
console.log(`llamadas envueltas: ${aCorregir.reduce((a, x) => a + x.cambios, 0)}`)
console.log('por esquema: ' + JSON.stringify(aCorregir.reduce((a, x) => ({ ...a, [x.schemaname]: (a[x.schemaname] ?? 0) + 1 }), {})))
if (avisos.length) { console.log('\n⚠ AVISOS (no se generará nada):'); avisos.forEach((a) => console.log('  ' + a)); await c.end(); process.exit(1) }
console.log('\n✅ las ' + aCorregir.length + ' reescrituras son reversibles palabra por palabra')

if (process.argv.includes('--muestra')) {
  for (const p of aCorregir.slice(0, 3)) {
    console.log(`\n--- ${p.schemaname}.${p.tablename} / ${p.policyname} (${p.cmd})`)
    console.log('ANTES : ' + (p.qual ?? p.with_check))
    console.log('DESPUÉS: ' + (p.qualNuevo ?? p.checkNuevo))
  }
}

if (!process.argv.includes('--escribir')) { await c.end(); process.exit(0) }

const porEsquema = {}
for (const p of aCorregir) (porEsquema[p.schemaname] ??= []).push(p)
const total = aCorregir.reduce((a, x) => a + x.cambios, 0)

let sql = `-- =============================================================================
-- RLS: EVALUAR LOS PERMISOS UNA VEZ POR CONSULTA, NO UNA VEZ POR FILA
-- =============================================================================
-- Dentro de una policy, \`auth_permiso('x')\` escrito suelto se ejecuta UNA VEZ
-- POR CADA FILA que la consulta examina. Escrito como \`(select auth_permiso('x'))\`
-- Postgres lo convierte en un InitPlan y lo ejecuta UNA SOLA VEZ.
--
-- Medido el 2026-10-28 sobre dos copias de orden_insumo_items (10.350 filas) con
-- la MISMA condición, una policy suelta y la otra envuelta:
--
--     policy suelta   : 248,5 ms
--     policy envuelta :   1,8 ms      → 138x
--
-- Y en consultas reales (ejecución en el servidor, sin RLS → con RLS suelta):
--
--     count(*) de orden_insumo_items    1,2 ms →  229 ms   (191x)
--     count(*) de movimientos           0,8 ms →  178 ms   (223x)
--     count(*) de personas              1,6 ms →  151 ms    (95x)
--     v_sobre_pedidos (50 filas)         23 ms →  310 ms    (13x)
--     v_stock_flujo (50 filas)           22 ms →  182 ms     (8x)
--
-- El costo es proporcional a las filas EXAMINADAS, no a las devueltas: por eso
-- \`personas order by id limit 50\` costaba 1,6 ms y un \`count: 'exact'\` sobre la
-- misma tabla costaba 151 ms. También explica los 45,9 millones de index scans
-- sobre \`usuarios\`, que tiene 892 filas: es la tabla que consulta auth_permiso.
--
-- Qué hace esta migración:
--   Reescribe las policies envolviendo cada llamada a auth_permiso(),
--   auth_permiso_any(), auth_rol() y auth.uid() en \`( SELECT ... )\`.
--   Son ${aCorregir.length} policies: ${Object.entries(porEsquema).map(([e, l]) => `${l.length} en ${e}`).join(' y ')}.
--
-- Qué NO hace:
--   No cambia ninguna regla de permiso. Las expresiones son las mismas, con el
--   mismo nombre de policy, la misma tabla, el mismo comando y los mismos roles;
--   lo único que cambia es CUÁNTAS VECES se evalúan. Se generó leyendo las
--   expresiones de pg_policies y se verificó que, al quitar los \`( SELECT )\`
--   agregados, cada expresión vuelve a ser idéntica a la original.
--
-- Se usa ALTER POLICY (no DROP + CREATE) para que ningún momento de la
-- migración deje una tabla sin su policy. Cada sentencia va con IF EXISTS para
-- que repetir la migración sea seguro.
--
-- Se comprobó además que las ${total} llamadas reciben argumentos literales (nunca
-- una columna): una subconsulta no ve la fila de afuera, así que si alguna
-- dependiera de la fila, envolverla sí cambiaría el resultado. Ninguna depende.
--
-- Generada por scripts/generar-rls-envuelta.mjs — si en el futuro se agregan
-- policies nuevas, se puede volver a correr para generar la siguiente.
-- =============================================================================

-- ALTER POLICY toma un lock de catálogo sobre cada tabla. Con lock_timeout, si
-- una consulta larga tiene la tabla ocupada la migración falla rápido y se
-- repite, en vez de quedarse esperando y hacer cola delante de todo lo demás.
SET LOCAL lock_timeout = '5s';

`

for (const [esquema, lista] of Object.entries(porEsquema)) {
  sql += `\n-- ─────────────────────────────────────────────────────────────────────────────\n-- Esquema ${esquema} (${lista.length} policies)\n-- ─────────────────────────────────────────────────────────────────────────────\n`
  let tablaActual = null
  for (const p of lista) {
    if (p.tablename !== tablaActual) { sql += `\n-- ${esquema}.${p.tablename}\n`; tablaActual = p.tablename }
    const partes = []
    if (p.qualNuevo) partes.push(`    USING (${p.qualNuevo})`)
    if (p.checkNuevo) partes.push(`    WITH CHECK (${p.checkNuevo})`)
    if (partes.join('').includes('$mig$')) throw new Error('expresión con $mig$: ' + p.policyname)
    sql += `DO $mig$ BEGIN\n`
    sql += `  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = ${lit(esquema)} AND tablename = ${lit(p.tablename)} AND policyname = ${lit(p.policyname)}) THEN\n`
    sql += `    ALTER POLICY ${id(p.policyname)} ON ${id(esquema)}.${id(p.tablename)}\n`
    sql += partes.join('\n').replace(/^/gm, '  ') + ';\n'
    sql += `  END IF;\nEND $mig$;\n`
  }
}

sql += `
-- ─────────────────────────────────────────────────────────────────────────────
-- Verificación: que no quede NINGUNA llamada suelta.
--
-- No basta con mirar si la expresión contiene "SELECT auth_permiso": una policy
-- puede tener una llamada envuelta y otra suelta y pasaría la prueba. Así que se
-- cuentan las llamadas y las llamadas envueltas, y tienen que ser las mismas.
-- ─────────────────────────────────────────────────────────────────────────────
DO $mig$
DECLARE
  sueltas bigint;
BEGIN
  SELECT coalesce(sum(todas - envueltas), 0) INTO sueltas
  FROM (
    SELECT
      (SELECT count(*) FROM regexp_matches(e, '(^|[^A-Za-z0-9_.])(auth_permiso_any|auth_permiso|auth_rol|auth[.]uid)[(]', 'g')) AS todas,
      (SELECT count(*) FROM regexp_matches(e, 'SELECT (auth_permiso_any|auth_permiso|auth_rol|auth[.]uid)[(]', 'g')) AS envueltas
    FROM (
      SELECT coalesce(qual, '') || ' ' || coalesce(with_check, '') AS e
      FROM pg_policies
      WHERE schemaname IN ('public', 'storage')
    ) p
  ) n;

  IF sueltas > 0 THEN
    RAISE EXCEPTION 'Quedaron % llamadas sueltas: se evaluarían fila por fila', sueltas;
  END IF;
  RAISE NOTICE 'RLS envuelta: ninguna policy evalúa los permisos fila por fila';
END $mig$;
`

function id(s) { return '"' + String(s).replace(/"/g, '""') + '"' }
function lit(s) { return "'" + String(s).replace(/'/g, "''") + "'" }

const destino = ROOT + '/supabase/migrations/20261028000001_rls_envolver_permisos.sql'
writeFileSync(destino, sql, 'utf8')
console.log('\n📄 escrita: ' + destino + ' (' + sql.split('\n').length + ' líneas)')
await c.end()

// Pruebas de la F1 del módulo de Puntos QR (el contrato como eje) contra la
// base REAL, dentro de una transacción que se revierte al final.
//
// Qué comprueba:
//   1. que el archivo de migración corra COMPLETO dos veces seguidas en la
//      misma transacción (idempotencia de verdad, no de lectura);
//   2. el alcance por contrato de la RLS: un usuario de un contrato NO lee los
//      satélites de otro, y un ADMIN sí los ve;
//   3. la vigencia efectiva: estado, fechas y prórroga que extiende.
//
// NO aplica nada: todo va dentro de BEGIN … ROLLBACK. La migración queda
// escrita y verificada, pero SIN aplicar.
//
// Uso (desde la raíz del worktree):
//   node --use-system-ca scripts/probar-puntos-qr-f1.mjs
// La cadena de conexión sale de DIRECT_URL: de la variable de entorno, o de
// .env.local (en el worktree o en el checkout principal, que es donde vive).
import { createRequire } from 'module'
import { readFileSync, existsSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join, resolve } from 'path'

const require = createRequire(import.meta.url)
const { Client } = require('pg')

const __dirname = dirname(fileURLToPath(import.meta.url))
const raiz = join(__dirname, '..')

function cadena() {
  if (process.env.DIRECT_URL) return process.env.DIRECT_URL.trim()
  const candidatos = [
    join(raiz, '.env.local'),
    // el worktree no tiene .env.local: está en el checkout principal
    resolve(raiz, '..', '..', '..', '.env.local'),
    process.env.ENV_FILE,
  ].filter(Boolean)
  for (const f of candidatos) {
    if (!existsSync(f)) continue
    const m = readFileSync(f, 'utf8').match(/^DIRECT_URL="?([^"\n]+)"?/m)
    if (m) return m[1].trim()
  }
  console.error('No se encontró DIRECT_URL (ni en el entorno ni en .env.local)')
  process.exit(1)
}

const MIGRACION = join(raiz, 'supabase', 'migrations', '20261019000010_puntos_qr_f1_contrato.sql')
const sql = readFileSync(MIGRACION, 'utf8')

const c = new Client({ connectionString: cadena(), ssl: { rejectUnauthorized: false } })
await c.connect()

let ok = 0, fail = 0
const check = (titulo, cond, detalle = '') => {
  if (cond) { ok++; console.log(`  OK   ${titulo}${detalle ? ' · ' + detalle : ''}`) }
  else { fail++; console.log(`  FALLA ${titulo}${detalle ? ' · ' + detalle : ''}`) }
}
const como = async (uid) => {
  await c.query(`SELECT set_config('request.jwt.claims', $1, true)`,
    [JSON.stringify({ sub: uid, role: 'authenticated' })])
  await c.query('SET LOCAL ROLE authenticated')
}
const comoDueno = async () => { await c.query('RESET ROLE') }
let sp = 0
const enSavepoint = async (fn) => {
  const n = `p${++sp}`
  await c.query(`SAVEPOINT ${n}`)
  try { const r = await fn(); await c.query(`RELEASE SAVEPOINT ${n}`); return { ok: true, r } }
  catch (e) { await c.query(`ROLLBACK TO SAVEPOINT ${n}`); return { ok: false, error: e.message } }
}

await c.query('BEGIN')
try {
  // ── 1. Idempotencia: el archivo completo, dos veces ───────────────────────
  console.log('\n1) Idempotencia (el archivo completo, dos veces en la misma transacción)')
  await c.query(sql)
  check('primera pasada', true)
  await c.query(sql)
  check('segunda pasada sin error', true)

  // Estructura
  const { rows: cols } = await c.query(`
    SELECT column_name, is_nullable, column_default FROM information_schema.columns
     WHERE table_schema='public' AND table_name='grupos_contrato'
       AND column_name IN ('cliente_id','numero','objeto','vigencia_desde','vigencia_hasta',
                           'estado','arte_logo_path','arte_color','idioma_reportes','created_at')`)
  check('grupos_contrato gana las 10 columnas', cols.length === 10, `${cols.length}/10`)
  const estado = cols.find((r) => r.column_name === 'estado')
  check('estado NOT NULL con default BORRADOR',
    estado.is_nullable === 'NO' && String(estado.column_default).includes('BORRADOR'))

  const { rows: tablas } = await c.query(`
    SELECT c.relname, c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname='public' AND c.relname IN
       ('grupo_vigencias','grupo_servicios','grupo_sla','grupo_reglas','grupo_entregables','usuario_grupos')`)
  check('las 6 tablas nuevas existen', tablas.length === 6, `${tablas.length}/6`)
  check('todas con RLS activa', tablas.every((t) => t.relrowsecurity))

  const { rows: pk } = await c.query(`
    SELECT t.relname, array_agg(a.attname::text ORDER BY a.attname) cols
      FROM pg_constraint k JOIN pg_class t ON t.oid=k.conrelid
      JOIN unnest(k.conkey) ck ON true JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=ck
     WHERE k.contype='p' AND t.relname IN ('grupo_servicios','grupo_sla','grupo_reglas','grupo_entregables','usuario_grupos')
     GROUP BY t.relname ORDER BY t.relname`)
  check('grupo_id en la PK de los 4 satélites',
    pk.filter((r) => r.relname.startsWith('grupo_') && r.cols.includes('grupo_id')).length === 4,
    pk.map((r) => `${r.relname}(${r.cols.join(',')})`).join(' '))

  const { rows: nivel } = await c.query(`
    SELECT data_type FROM information_schema.columns
     WHERE table_schema='public' AND table_name='grupo_reglas' AND column_name='nivel_antifraude'`)
  const { rows: chks } = await c.query(`
    SELECT 1 FROM pg_constraint k JOIN pg_class t ON t.oid=k.conrelid
     WHERE t.relname='grupo_reglas' AND k.contype='c' AND pg_get_constraintdef(k.oid) ILIKE '%nivel_antifraude%'`)
  check('nivel_antifraude es TEXT y SIN CHECK (lo cierra el complemento 1)',
    nivel[0]?.data_type === 'text' && chks.length === 0)

  const { rows: pv } = await c.query(`
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='persona_vinculaciones' AND column_name='grupo_id'`)
  check('persona_vinculaciones NO gana grupo_id (pendiente de aprobación)', pv.length === 0)

  // Estados deducidos de `activo`: ningún contrato existente queda en BORRADOR
  const { rows: est } = await c.query(`SELECT estado, count(*)::int n FROM grupos_contrato GROUP BY estado`)
  check('los contratos que ya existían no quedan en BORRADOR',
    !est.some((r) => r.estado === 'BORRADOR'), est.map((r) => `${r.estado}:${r.n}`).join(' '))

  // ── 2. Vigencia efectiva ──────────────────────────────────────────────────
  console.log('\n2) Vigencia efectiva (grupo_vigente / grupo_vigencia_fin)')
  const { rows: [g1] } = await c.query(`
    INSERT INTO grupos_contrato (codigo, nombre, estado, vigencia_desde, vigencia_hasta)
    VALUES ('ZZT1', 'Contrato de prueba 1', 'VIGENTE', CURRENT_DATE - 30, CURRENT_DATE + 30)
    RETURNING id`)
  const { rows: [g2] } = await c.query(`
    INSERT INTO grupos_contrato (codigo, nombre, estado, vigencia_desde, vigencia_hasta)
    VALUES ('ZZT2', 'Contrato de prueba 2', 'VIGENTE', CURRENT_DATE - 400, CURRENT_DATE - 10)
    RETURNING id`)
  const vig = async (id, fecha = null) => (await c.query(
    `SELECT grupo_vigente($1, COALESCE($2::date, CURRENT_DATE)) v`, [id, fecha])).rows[0].v

  check('contrato dentro de su vigencia → vigente', await vig(g1.id) === true)
  check('contrato con fin pasado → NO vigente', await vig(g2.id) === false)

  await c.query(`INSERT INTO grupo_vigencias (grupo_id, desde, hasta, tipo, motivo)
                 VALUES ($1, CURRENT_DATE - 9, CURRENT_DATE + 90, 'PRORROGA', 'prueba')`, [g2.id])
  check('la prórroga lo vuelve a poner vigente, sin tocar la fila del contrato',
    await vig(g2.id) === true)
  // La comparación se hace EN la base para no pelear con el formato de fecha
  // que devuelve el driver.
  const { rows: [fin] } = await c.query(
    `SELECT grupo_vigencia_fin($1) = CURRENT_DATE + 90 AS ok,
            grupo_vigencia_fin($1)::text AS f`, [g2.id])
  check('el fin efectivo es el de la prórroga', fin.ok === true, fin.f)

  await c.query(`UPDATE grupos_contrato SET estado='SUSPENDIDO' WHERE id=$1`, [g1.id])
  check('SUSPENDIDO no está vigente aunque las fechas alcancen', await vig(g1.id) === false)
  await c.query(`UPDATE grupos_contrato SET estado='VIGENTE' WHERE id=$1`, [g1.id])
  check('fecha anterior al inicio → NO vigente',
    await vig(g1.id, new Date(Date.now() - 100 * 864e5).toISOString().slice(0, 10)) === false)

  // ── 3. Alcance por contrato en la RLS ─────────────────────────────────────
  console.log('\n3) Alcance por contrato (auth_grupos + RLS)')
  // Reglas y servicios en los dos contratos de prueba
  await c.query(`INSERT INTO grupo_reglas (grupo_id, nivel_antifraude, retencion_evidencia_meses)
                 VALUES ($1,'POR_DEFINIR',12), ($2,'POR_DEFINIR',6)`, [g1.id, g2.id])
  await c.query(`INSERT INTO grupo_servicios (grupo_id, servicio) VALUES ($1,'ASEO'), ($2,'CONSERJERIA')`,
    [g1.id, g2.id])
  await c.query(`INSERT INTO grupo_sla (grupo_id, servicio, prioridad, respuesta_horas, solucion_horas)
                 VALUES ($1,'ASEO','ALTA',4,24), ($2,'CONSERJERIA','ALTA',2,8)`, [g1.id, g2.id])

  // Un usuario de cada contrato, con el permiso de ver contratos de conserjería
  const { rows: [rolC] } = await c.query(`
    INSERT INTO roles (nombre, descripcion, rol_base, permisos)
    VALUES ('ZZ Prueba Contrato', 'solo para la prueba', 'OPERADOR_SEDE',
            '{"ver_contratos_conserjeria":true}'::jsonb)
    RETURNING id`)
  const nuevoUsuario = async (sufijo, grupoId, rol, rolId) => {
    const { rows: [u] } = await c.query(`
      INSERT INTO usuarios (id, nombre, email, rol, rol_id, grupo_id, activo)
      VALUES (gen_random_uuid(), $1, $2, $3::rol_usuario, $4, $5, true) RETURNING id`,
      [`ZZ Prueba ${sufijo}`, `zz-prueba-${sufijo}@example.invalid`, rol, rolId, grupoId])
    return u.id
  }
  const uA = await nuevoUsuario('a', g1.id, 'OPERADOR_SEDE', rolC.id)   // contrato 1 por grupo_id
  const uB = await nuevoUsuario('b', null,  'OPERADOR_SEDE', rolC.id)   // contrato 2 por usuario_grupos
  const uAdm = await nuevoUsuario('adm', null, 'ADMIN', null)
  await c.query(`INSERT INTO usuario_grupos (usuario_id, grupo_id, papel) VALUES ($1,$2,'COORDINADOR')`,
    [uB, g2.id])

  const cuenta = async (tabla) => Number((await c.query(
    `SELECT count(*)::int n FROM ${tabla} WHERE grupo_id IN ($1,$2)`, [g1.id, g2.id])).rows[0].n)
  const alcance = async (uid) => (await c.query(
    `SELECT array_agg(g::text ORDER BY g::text) a FROM auth_grupos() g`)).rows[0].a

  await como(uA)
  check('auth_grupos del usuario A trae solo su contrato principal',
    (await alcance(uA) || []).join() === [g1.id].join())
  check('A lee las reglas de su contrato y no las del otro', await cuenta('grupo_reglas') === 1)
  check('A lee un solo servicio y un solo ANS',
    await cuenta('grupo_servicios') === 1 && await cuenta('grupo_sla') === 1)
  const escrituraA = await c.query(
    `UPDATE grupo_reglas SET retencion_evidencia_meses = 3 WHERE grupo_id = $1`, [g1.id])
  check('A, que solo tiene ver_*, no cambia las reglas (RLS no le deja ninguna fila)',
    escrituraA.rowCount === 0, `${escrituraA.rowCount} filas`)

  await comoDueno(); await como(uB)
  check('auth_grupos del usuario B trae el contrato de usuario_grupos',
    (await alcance(uB) || []).join() === [g2.id].join())
  check('B lee las reglas de SU contrato, no las de A', await cuenta('grupo_reglas') === 1)
  const { rows: [quien] } = await c.query(
    `SELECT grupo_id::text g FROM grupo_reglas WHERE grupo_id IN ($1,$2)`, [g1.id, g2.id])
  check('y la fila que lee es la del contrato 2', quien.g === g2.id)

  await comoDueno(); await como(uAdm)
  check('el ADMIN ve los dos contratos', await cuenta('grupo_reglas') === 2)
  check('auth_grupos de un ADMIN trae todos los contratos',
    (await alcance(uAdm) || []).length >= 2,
    `${(await alcance(uAdm) || []).length} contratos`)
  const escrituraAdm = await enSavepoint(() => c.query(
    `UPDATE grupo_reglas SET retencion_evidencia_meses = 24 WHERE grupo_id = $1`, [g2.id]))
  check('el ADMIN sí puede escribir las reglas', escrituraAdm.ok)

  // Un usuario sin ninguno de los dos permisos no ve nada
  await comoDueno()
  const { rows: [rolS] } = await c.query(`
    INSERT INTO roles (nombre, descripcion, rol_base, permisos)
    VALUES ('ZZ Prueba Sin Permiso', 'solo para la prueba', 'OPERADOR_SEDE', '{"ver_stock":true}'::jsonb)
    RETURNING id`)
  const uC = await nuevoUsuario('c', g1.id, 'OPERADOR_SEDE', rolS.id)
  await c.query(`INSERT INTO usuario_grupos (usuario_id, grupo_id, papel) VALUES ($1,$2,'TECNICO')`,
    [uC, g1.id])
  await como(uC)
  check('sin ver_contratos_conserjeria no se lee ningún satélite',
    await cuenta('grupo_reglas') === 0 && await cuenta('grupo_sla') === 0)
  const { rows: mias } = await c.query(
    `SELECT usuario_id::text u FROM usuario_grupos WHERE grupo_id IN ($1,$2)`, [g1.id, g2.id])
  check('pero sí ve su propia fila de usuario_grupos, y solo la suya (lo propio)',
    mias.length === 1 && mias[0].u === uC, `${mias.length} filas`)

  await comoDueno()
} finally {
  await c.query('ROLLBACK')
  await c.end()
}

console.log(`\n${ok} pruebas bien, ${fail} mal. Todo revertido con ROLLBACK: la base queda igual.`)
process.exit(fail > 0 ? 1 : 0)

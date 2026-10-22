// Pruebas de la F2 del módulo de Puntos QR (zonas, puntos de control y código
// QR) contra la base REAL, dentro de una transacción que se revierte al final.
//
// Qué comprueba:
//   1. que los archivos de migración de F1 y F2 corran COMPLETOS dos veces
//      seguidas en la misma transacción (idempotencia de verdad, no de lectura);
//   2. la estructura que mandan la §2.4 del complemento 2 y la §2.1/§2.2 del
//      plan: qué columna lleva cada tabla y con qué nulabilidad;
//   3. que `grupo_id` se DERIVE de la sede y no se pueda inyectar, y que la
//      clave pública del punto sea inmutable (si cambiara, las placas pegadas
//      en la pared quedarían muertas);
//   4. el token firmado del ADR-B con el MISMO código que usa la aplicación
//      (se importan `lib/puntos-qr.ts` y `lib/puntos-qr-firma.ts` tal cual);
//   5. la invariante del módulo: un solo QR ACTIVO por punto, y que revocar
//      deje el anterior REVOCADO y permita nacer la versión siguiente;
//   6. la vigencia efectiva (§2.5): el QR deja de servir cuando el contrato
//      vence, SIN que ninguna fila cambie, y vuelve a servir con la prórroga;
//   7. el alcance por contrato de la RLS: un usuario de un contrato NO lee los
//      puntos de otro, ni escribe sin la clave de gestión;
//   8. que `ronda_eventos` sea append-only de verdad (sin política de UPDATE ni
//      de DELETE) y que el encadenado por entidad enlace.
//   9. la ruta pública /q/<token>: se ejecuta la DECISIÓN REAL de
//      `app/q/decidir.ts` contra esta misma base (con una puerta de datos sobre
//      `pg` en vez de PostgREST) y se comprueba que abre lo que debe abrir,
//      rechaza lo que debe rechazar y deja el evento de auditoría de cada caso.
//
// NO aplica nada: todo va dentro de BEGIN … ROLLBACK. Las migraciones quedan
// escritas y verificadas, pero SIN aplicar.
//
// Uso (desde la raíz del worktree):
//   node --use-system-ca scripts/probar-puntos-qr-f2.mjs
// La cadena de conexión sale de DIRECT_URL: de la variable de entorno, o de
// .env.local (en el worktree o en el checkout principal, que es donde vive).
import { createRequire } from 'module'
import { registerHooks } from 'node:module'
import { readFileSync, existsSync } from 'fs'
import { fileURLToPath, pathToFileURL } from 'url'
import { dirname, join, resolve } from 'path'

const require = createRequire(import.meta.url)
const { Client } = require('pg')

const __dirname = dirname(fileURLToPath(import.meta.url))
const raiz = join(__dirname, '..')

// Node 24 ejecuta TypeScript quitando los tipos, pero la resolución de ESM
// exige extensión. Este gancho la agrega cuando falta, para poder importar los
// módulos REALES de la aplicación en vez de copiar su lógica aquí: si la firma
// del QR cambia en la app, esta prueba lo nota.
registerHooks({
  resolve(spec, ctx, next) {
    try {
      return next(spec, ctx)
    } catch (e) {
      if (/^[./]/.test(spec) && ctx.parentURL) {
        const url = new URL(spec + '.ts', ctx.parentURL)
        if (existsSync(fileURLToPath(url))) return { url: url.href, shortCircuit: true }
      }
      throw e
    }
  },
})

const libDir = join(raiz, 'apps', 'inventario', 'lib')
const QR = await import(pathToFileURL(join(libDir, 'puntos-qr.ts')).href)
const FIRMA = await import(pathToFileURL(join(libDir, 'puntos-qr-firma.ts')).href)
const DECIDIR = await import(
  pathToFileURL(join(raiz, 'apps', 'inventario', 'app', 'q', 'decidir.ts')).href)

function cadena() {
  if (process.env.DIRECT_URL) return process.env.DIRECT_URL.trim()
  const candidatos = [
    join(raiz, '.env.local'),
    // el worktree puede no tener .env.local: está en el checkout principal
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

const migracion = (n) => readFileSync(join(raiz, 'supabase', 'migrations', n), 'utf8')
const SQL_F1 = migracion('20261019000010_puntos_qr_f1_contrato.sql')
const SQL_F2 = migracion('20261019000020_puntos_qr_f2_puntos.sql')

// Llave de firma de mentira, solo para estas pruebas. La de verdad vive en
// variables de entorno y nunca en el repositorio.
const LLAVE_ID = 'cli-prueba-v1'
const SECRETO = 'llave-de-prueba-no-es-la-de-produccion'

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
  // ── 1. Idempotencia: los dos archivos completos, dos veces ────────────────
  console.log('\n1) Idempotencia (F1 y F2 completas, dos veces en la misma transacción)')
  await c.query(SQL_F1)
  await c.query(SQL_F2)
  check('primera pasada de F1 + F2', true)
  await c.query(SQL_F1)
  await c.query(SQL_F2)
  check('segunda pasada sin error', true)

  // ── 2. Estructura ─────────────────────────────────────────────────────────
  console.log('\n2) Estructura (§2.1 y §2.2 del plan, §2.4 del complemento 2)')
  const { rows: tablas } = await c.query(`
    SELECT c.relname, c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname='public' AND c.relname IN
       ('ronda_zonas','ronda_puntos','ronda_qr','ronda_qr_lotes','ronda_eventos')`)
  check('las 5 tablas de F2 existen', tablas.length === 5, `${tablas.length}/5`)
  check('todas con RLS activa', tablas.every((t) => t.relrowsecurity))

  const nulabilidad = async (tabla, col) => (await c.query(`
    SELECT is_nullable FROM information_schema.columns
     WHERE table_schema='public' AND table_name=$1 AND column_name=$2`, [tabla, col])).rows[0]?.is_nullable
  check('ronda_zonas: grupo_id y sede_id NOT NULL',
    await nulabilidad('ronda_zonas', 'grupo_id') === 'NO' && await nulabilidad('ronda_zonas', 'sede_id') === 'NO')
  check('ronda_puntos: grupo_id y sede_id NOT NULL',
    await nulabilidad('ronda_puntos', 'grupo_id') === 'NO' && await nulabilidad('ronda_puntos', 'sede_id') === 'NO')
  check('ronda_qr y ronda_qr_lotes: grupo_id NOT NULL',
    await nulabilidad('ronda_qr', 'grupo_id') === 'NO' && await nulabilidad('ronda_qr_lotes', 'grupo_id') === 'NO')
  check('ronda_eventos: grupo_id y sede_id NULLABLE (lo que se sepa en el momento)',
    await nulabilidad('ronda_eventos', 'grupo_id') === 'YES' && await nulabilidad('ronda_eventos', 'sede_id') === 'YES')

  const { rows: ix } = await c.query(`
    SELECT indexname, indexdef FROM pg_indexes
     WHERE schemaname='public' AND indexname='ux_ronda_qr_activo'`)
  check('existe el índice único PARCIAL de un solo QR activo por punto',
    ix.length === 1 && /WHERE.*ACTIVO/i.test(ix[0].indexdef), ix[0]?.indexdef ?? 'no existe')

  const { rows: polEv } = await c.query(`
    SELECT cmd FROM pg_policies WHERE schemaname='public' AND tablename='ronda_eventos'`)
  check('ronda_eventos no tiene política de UPDATE ni de DELETE (append-only)',
    !polEv.some((p) => ['UPDATE', 'DELETE', 'ALL'].includes(p.cmd)),
    polEv.map((p) => p.cmd).join(','))

  const { rows: hueco } = await c.query(`
    SELECT table_name, column_name FROM information_schema.columns
     WHERE table_schema='public'
       AND ((table_name='ronda_qr' AND column_name='foto_instalacion')
         OR (table_name='ronda_puntos' AND column_name='fotos_referencia'))`)
  check('los dos huecos del complemento 1 están RESERVADOS', hueco.length === 2,
    hueco.map((h) => `${h.table_name}.${h.column_name}`).join(' '))
  const { rows: anclas } = await c.query(`
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname='public' AND c.relname='ronda_anclas'`)
  check('y NO se inventó la tabla de anclas 360° (la define el complemento 1)', anclas.length === 0)

  const { rows: niv } = await c.query(`
    SELECT 1 FROM pg_constraint k JOIN pg_class t ON t.oid=k.conrelid
     WHERE t.relname='grupo_reglas' AND k.contype='c'
       AND pg_get_constraintdef(k.oid) ILIKE '%nivel_antifraude%'`)
  check('nivel_antifraude sigue SIN CHECK: F2 no inventó niveles de antifraude', niv.length === 0)

  // ── 3. Datos de prueba ────────────────────────────────────────────────────
  console.log('\n3) Derivación y coherencia (grupo_id sale de la sede)')
  const { rows: [g1] } = await c.query(`
    INSERT INTO grupos_contrato (codigo, nombre, estado, vigencia_desde, vigencia_hasta)
    VALUES ('ZZF2A', 'Contrato de prueba F2 A', 'VIGENTE', CURRENT_DATE - 30, CURRENT_DATE + 30)
    RETURNING id`)
  const { rows: [g2] } = await c.query(`
    INSERT INTO grupos_contrato (codigo, nombre, estado, vigencia_desde, vigencia_hasta)
    VALUES ('ZZF2B', 'Contrato de prueba F2 B', 'VIGENTE', CURRENT_DATE - 30, CURRENT_DATE + 30)
    RETURNING id`)
  const nuevaSede = async (grupo, nombre) => (await c.query(`
    INSERT INTO sedes (grupo_id, nombre, ciudad, lat, lng) VALUES ($1,$2,'BOGOTÁ D.C.',4.65,-74.05)
    RETURNING id`, [grupo, nombre])).rows[0].id
  const s1 = await nuevaSede(g1.id, 'ZZ Sede de prueba A')
  const s2 = await nuevaSede(g2.id, 'ZZ Sede de prueba B')

  const { rows: [z1] } = await c.query(`
    INSERT INTO ronda_zonas (sede_id, grupo_id, codigo, nombre, piso, orden)
    VALUES ($1, $2, 'T1-P3', 'Torre A — piso 3', 'PISO 3', 1)
    RETURNING id, grupo_id::text`, [s1, g2.id])    // grupo_id MAL a propósito
  check('la zona ignora el grupo_id que le manden y deriva el de la sede',
    z1.grupo_id === g1.id, `quedó ${z1.grupo_id === g1.id ? 'el de la sede' : 'el inyectado'}`)

  const { rows: [z2] } = await c.query(`
    INSERT INTO ronda_zonas (sede_id, grupo_id, codigo, nombre)
    VALUES ($1, $1, 'SOT-2', 'Sótano 2') RETURNING id`, [s2])

  // `grupo_id` se manda MAL a propósito (va el id de la sede, que ni siquiera
  // es un contrato): si el trigger no lo derivara, la llave foránea reventaría.
  const nuevoPunto = async (sede, codigo, nombre) => (await c.query(`
    INSERT INTO ronda_puntos (sede_id, grupo_id, codigo, nombre, lat, lng, precision_metros)
    VALUES ($1, $1, $2, $3, 4.6501234, -74.0509876, 8.5)
    RETURNING id, grupo_id::text, sede_nombre, clave_publica, geocerca_metros, horario_dias, estado`,
    [sede, codigo, nombre])).rows[0]

  const p1 = await nuevoPunto(s1, 'P-001', 'Portería principal')
  check('el punto deriva grupo_id de la sede', p1.grupo_id === g1.id)
  check('y desnormaliza el nombre de la sede para los listados',
    p1.sede_nombre === 'ZZ Sede de prueba A', p1.sede_nombre)
  check('la geocerca nace en 30 m, como pide §2.1', Number(p1.geocerca_metros) === 30)
  check('el horario aplica los 7 días por defecto (1 = lunes … 7 = domingo)',
    JSON.stringify(p1.horario_dias) === JSON.stringify([1, 2, 3, 4, 5, 6, 7]), String(p1.horario_dias))
  check('el punto nace en BORRADOR', p1.estado === 'BORRADOR')
  check('y recibe una clave pública de 8 caracteres del alfabeto sin ambigüedades',
    p1.clave_publica.length === 8 && QR.esDeAlfabeto(p1.clave_publica, QR.ALFABETO_TOKEN),
    p1.clave_publica)

  const zonaAjena = await enSavepoint(() => c.query(`
    UPDATE ronda_puntos SET zona_id = $1 WHERE id = $2`, [z2.id, p1.id]))
  check('un punto NO puede apuntar a una zona de otra sede',
    !zonaAjena.ok && /zona no pertenece/i.test(zonaAjena.error || ''), zonaAjena.error ?? 'pasó')

  await c.query(`UPDATE ronda_puntos SET zona_id = $1 WHERE id = $2`, [z1.id, p1.id])
  const { rows: [tras] } = await c.query(`
    UPDATE ronda_puntos SET clave_publica = 'ZZZZZZZZ', estado='ACTIVO' WHERE id = $1
    RETURNING clave_publica`, [p1.id])
  check('la clave pública es INMUTABLE: cambiarla dejaría muertas las placas pegadas',
    tras.clave_publica === p1.clave_publica, `${p1.clave_publica} → ${tras.clave_publica}`)

  const sinCoord = await enSavepoint(() => c.query(`
    INSERT INTO ronda_puntos (sede_id, grupo_id, codigo, nombre, lat)
    VALUES ($1,$1,'P-MAL','Media coordenada', 4.65)`, [s1]))
  check('media coordenada se rechaza (lat sin lng no ubica nada)', !sinCoord.ok)

  const geoFuera = await enSavepoint(() => c.query(`
    INSERT INTO ronda_puntos (sede_id, grupo_id, codigo, nombre, geocerca_metros)
    VALUES ($1,$1,'P-GEO','Geocerca imposible', 1)`, [s1]))
  check('una geocerca de 1 m se rechaza (el CHECK es 5–2000 m)', !geoFuera.ok)

  // ── 4. Token firmado (ADR-B), con el código real de la aplicación ─────────
  console.log('\n4) Token firmado del ADR-B (importando lib/puntos-qr-firma.ts)')
  const armar = (punto, version) => FIRMA.armarToken({
    clavePublica: punto.clave_publica, puntoId: punto.id, version,
    llaveId: LLAVE_ID, secreto: SECRETO,
  })
  const t1 = armar(p1, 1)
  check('el token mide 21 caracteres y es todo base32 sin ambigüedades',
    t1.token.length === 21 && QR.esDeAlfabeto(t1.token, QR.ALFABETO_TOKEN), t1.token)
  const partido = QR.partirToken(t1.token)
  check('se parte en versión de formato, clave del punto, versión y firma',
    partido && partido.clavePublica === p1.clave_publica && partido.version === 1
      && partido.firma.length === 10)
  check('la firma verifica con el punto, la versión y la llave correctos',
    FIRMA.verificarFirma(t1.token, p1.id, 1, SECRETO) === true)
  check('y NO verifica con otra llave (una llave rotada no valida lo de otra)',
    FIRMA.verificarFirma(t1.token, p1.id, 1, SECRETO + 'x') === false)
  check('ni con otro punto (no se puede mover un token de pared)',
    FIRMA.verificarFirma(t1.token, p1.id.slice(0, -1) + (p1.id.endsWith('a') ? 'b' : 'a'), 1, SECRETO) === false)
  check('ni con otra versión',
    FIRMA.verificarFirma(t1.token, p1.id, 2, SECRETO) === false)
  const alterado = t1.token.slice(0, 20) + (t1.token[20] === 'Z' ? 'Y' : 'Z')
  check('un token con un carácter cambiado se rechaza',
    FIRMA.verificarFirma(alterado, p1.id, 1, SECRETO) === false, alterado)
  check('el alfabeto del código manual no tiene I, L, O, U, 0 ni 1',
    !/[ILOU01]/.test(QR.ALFABETO_MANUAL) && QR.ALFABETO_MANUAL.length === 30,
    QR.ALFABETO_MANUAL)
  check('el código manual se agrupa 4-4 y no pierde caracteres',
    QR.formatearManual('K7M4QX9T') === 'K7M4-QX9T',
    QR.formatearManual('K7M4QX9T'))
  check('la URL impresa es /q/<token>, no /p/',
    QR.urlDelQr(t1.token, 'https://ejemplo.app') === `https://ejemplo.app/q/${t1.token}`)

  // ── 5. El QR en la base ───────────────────────────────────────────────────
  console.log('\n5) ronda_qr: versiones, código manual y un solo activo por punto')
  const insertarQr = (punto, token, estado = 'ACTIVO', version = null) => c.query(`
    INSERT INTO ronda_qr (tipo_objeto, punto_id, grupo_id, sede_id, version, token,
                          firma_llave_id, estado, instalado_canal, instalado_at,
                          lat, lng, precision_metros)
    VALUES ('PUNTO', $1, $2, $3, $4, $5, $6, $7, 'CONSOLA', NOW(), 4.6501, -74.0509, 9.0)
    RETURNING id, version, codigo_manual, estado`,
    [punto.id, punto.grupo_id, s1, version, token, LLAVE_ID, estado])

  const { rows: [qr1] } = await insertarQr(p1, t1.token)
  check('la primera versión del QR nace en 1 sin que la aplicación la calcule',
    Number(qr1.version) === 1, String(qr1.version))
  check('el código manual se genera solo, con 8 caracteres del alfabeto tecleable',
    qr1.codigo_manual.length === 8 && QR.esCodigoManual(qr1.codigo_manual), qr1.codigo_manual)

  const dosActivos = await enSavepoint(() => insertarQr(p1, armar(p1, 2).token, 'ACTIVO', 2))
  check('NO se puede tener dos QR activos del mismo punto',
    !dosActivos.ok && /ux_ronda_qr_activo/.test(dosActivos.error || ''), dosActivos.error ?? 'pasó')

  const tokenRepetido = await enSavepoint(() => insertarQr(p1, t1.token, 'BORRADOR', 9))
  check('el token es único en toda la base', !tokenRepetido.ok)

  const tokenFeo = await enSavepoint(() => insertarQr(p1, 'TOKEN-CON-GUION', 'BORRADOR', 8))
  check('un token que no es base32 sin ambigüedades se rechaza', !tokenFeo.ok)

  const { rows: [vigencia1] } = await c.query(
    `SELECT ronda_qr_vigente($1) v, (SELECT estado FROM ronda_qr WHERE id=$1) e`, [qr1.id])
  check('el QR activo de un contrato vigente SIRVE', vigencia1.v === true)

  const { rows: [porToken] } = await c.query(
    `SELECT * FROM ronda_qr_por_token($1)`, [t1.token])
  check('ronda_qr_por_token resuelve el QR y dice que está vigente',
    porToken.qr_id === qr1.id && porToken.punto_id === p1.id && porToken.vigente === true)
  const { rows: inventado } = await c.query(
    `SELECT * FROM ronda_qr_por_token($1)`, ['1ZZZZZZZZ01ZZZZZZZZZZ'])
  check('un token inventado no resuelve nada (cero filas, no un error)', inventado.length === 0)

  // ── 6. Revocar y reemplazar ───────────────────────────────────────────────
  console.log('\n6) Revocar deja el anterior cerrado y la versión siguiente nace al lado')
  // Se necesita un usuario con la clave de gestión: la RPC la exige.
  const { rows: [rolQr] } = await c.query(`
    INSERT INTO roles (nombre, descripcion, rol_base, permisos)
    VALUES ('ZZ Prueba QR', 'solo para la prueba', 'OPERADOR_SEDE',
            '{"ver_puntos_ronda":true,"gestionar_puntos_ronda":true,"gestionar_qr_ronda":true}'::jsonb)
    RETURNING id`)
  const { rows: [rolVer] } = await c.query(`
    INSERT INTO roles (nombre, descripcion, rol_base, permisos)
    VALUES ('ZZ Prueba Solo Ver', 'solo para la prueba', 'OPERADOR_SEDE',
            '{"ver_puntos_ronda":true}'::jsonb)
    RETURNING id`)
  const { rows: [rolNada] } = await c.query(`
    INSERT INTO roles (nombre, descripcion, rol_base, permisos)
    VALUES ('ZZ Prueba Sin Nada', 'solo para la prueba', 'OPERADOR_SEDE', '{"ver_stock":true}'::jsonb)
    RETURNING id`)
  const nuevoUsuario = async (sufijo, grupoId, rol, rolId) => (await c.query(`
    INSERT INTO usuarios (id, nombre, email, rol, rol_id, grupo_id, sede_id, activo)
    VALUES (gen_random_uuid(), $1, $2, $3::rol_usuario, $4, $5, NULL, true) RETURNING id`,
    [`ZZ Prueba F2 ${sufijo}`, `zz-f2-${sufijo}@example.invalid`, rol, rolId, grupoId])).rows[0].id

  const uGestor = await nuevoUsuario('gestor', g1.id, 'OPERADOR_SEDE', rolQr.id)
  const uLector = await nuevoUsuario('lector', g1.id, 'OPERADOR_SEDE', rolVer.id)
  const uOtro   = await nuevoUsuario('otro',   g2.id, 'OPERADOR_SEDE', rolQr.id)
  const uCiego  = await nuevoUsuario('ciego',  g1.id, 'OPERADOR_SEDE', rolNada.id)

  await como(uGestor)
  await c.query(`SELECT ronda_qr_revocar($1, 'placa rayada')`, [qr1.id])
  await comoDueno()
  const { rows: [revocado] } = await c.query(
    `SELECT estado, motivo_cambio, revocado_at IS NOT NULL tiene_fecha,
            revocado_por::text, ronda_qr_vigente(id) v FROM ronda_qr WHERE id=$1`, [qr1.id])
  check('el QR revocado queda en REVOCADO, con fecha, motivo y quién',
    revocado.estado === 'REVOCADO' && revocado.tiene_fecha && revocado.motivo_cambio === 'placa rayada'
      && revocado.revocado_por === uGestor)
  check('y deja de servir aunque el contrato siga vigente', revocado.v === false)

  const { rows: [siguiente] } = await c.query(
    `SELECT ronda_qr_siguiente_version($1) v`, [p1.id])
  check('la siguiente versión del punto es la 2', Number(siguiente.v) === 2)

  const t2 = armar(p1, 2)
  const { rows: [qr2] } = await c.query(`
    INSERT INTO ronda_qr (tipo_objeto, punto_id, grupo_id, sede_id, token, firma_llave_id,
                          estado, reemplaza_a, motivo_cambio, instalado_canal, instalado_at)
    VALUES ('PUNTO', $1, $2, $3, $4, $5, 'ACTIVO', $6, 'reemplazo de placa rayada', 'CONSOLA', NOW())
    RETURNING id, version, codigo_manual`, [p1.id, p1.grupo_id, s1, t2.token, LLAVE_ID, qr1.id])
  check('la versión 2 nace ACTIVA al lado de la revocada, sin tocarla',
    Number(qr2.version) === 2)
  check('y con un código manual distinto', qr2.codigo_manual !== qr1.codigo_manual,
    `${qr1.codigo_manual} → ${qr2.codigo_manual}`)
  const { rows: [cuantas] } = await c.query(`
    SELECT count(*)::int total, count(*) FILTER (WHERE estado='ACTIVO')::int activos
      FROM ronda_qr WHERE punto_id = $1`, [p1.id])
  check('el punto tiene 2 versiones y exactamente 1 activa',
    cuantas.total === 2 && cuantas.activos === 1, `${cuantas.total} versiones, ${cuantas.activos} activa`)
  const { rows: [viejo] } = await c.query(
    `SELECT ronda_qr_vigente($1) v FROM ronda_qr WHERE id=$1`, [qr1.id])
  check('el QR viejo fotografiado antes del cambio ya no sirve', viejo.v === false)

  await como(uOtro)
  const revocarAjeno = await enSavepoint(() => c.query(
    `SELECT ronda_qr_revocar($1, 'no deberia poder')`, [qr2.id]))
  check('un gestor de OTRO contrato no puede revocar este QR',
    !revocarAjeno.ok && /permiso/i.test(revocarAjeno.error || ''), revocarAjeno.error ?? 'pasó')
  await comoDueno()
  await como(uLector)
  const revocarSinClave = await enSavepoint(() => c.query(
    `SELECT ronda_qr_revocar($1, 'no deberia poder')`, [qr2.id]))
  check('quien solo puede VER tampoco revoca', !revocarSinClave.ok)
  await comoDueno()

  // ── 7. Vigencia efectiva: el contrato manda, sin UPDATE masivo ────────────
  console.log('\n7) Vigencia efectiva del QR (§2.5): se pregunta, no se actualiza')
  const estadosAntes = (await c.query(
    `SELECT id::text, estado FROM ronda_qr WHERE punto_id=$1 ORDER BY version`, [p1.id])).rows
  await c.query(`UPDATE grupos_contrato SET vigencia_hasta = CURRENT_DATE - 1 WHERE id=$1`, [g1.id])
  const { rows: [vencido] } = await c.query(
    `SELECT ronda_qr_vigente($1) v, grupo_vigente($2) c`, [qr2.id, g1.id])
  check('contrato vencido → su QR activo deja de servir', vencido.v === false && vencido.c === false)
  const estadosDespues = (await c.query(
    `SELECT id::text, estado FROM ronda_qr WHERE punto_id=$1 ORDER BY version`, [p1.id])).rows
  check('y NINGUNA fila de ronda_qr cambió de estado (nada de UPDATE masivo)',
    JSON.stringify(estadosAntes) === JSON.stringify(estadosDespues),
    estadosDespues.map((r) => r.estado).join(','))

  await c.query(`INSERT INTO grupo_vigencias (grupo_id, desde, hasta, tipo, motivo)
                 VALUES ($1, CURRENT_DATE, CURRENT_DATE + 180, 'RENOVACION', 'prueba')`, [g1.id])
  const { rows: [renovado] } = await c.query(`SELECT ronda_qr_vigente($1) v`, [qr2.id])
  check('al renovar, el QR vuelve a servir sin tocar ninguna fila', renovado.v === true)
  await c.query(`UPDATE grupos_contrato SET vigencia_hasta = CURRENT_DATE + 30 WHERE id=$1`, [g1.id])

  // ── 8. Alcance por contrato en la RLS ─────────────────────────────────────
  console.log('\n8) Alcance por contrato (auth_grupos + RLS, también en las lecturas)')
  const pB = await nuevoPunto(s2, 'P-001', 'Portería de la otra sede')
  check('el mismo código de punto vale en otra sede (es único POR sede)',
    pB.grupo_id === g2.id, `quedó en el contrato ${pB.grupo_id === g2.id ? 'B' : 'equivocado'}`)
  const codigoRepetido = await enSavepoint(() => c.query(`
    INSERT INTO ronda_puntos (sede_id, grupo_id, codigo, nombre)
    VALUES ($1,$1,'P-001','Repetido en la misma sede')`, [s1]))
  check('pero no dos veces en la MISMA sede', !codigoRepetido.ok)

  await c.query(`
    INSERT INTO ronda_qr (tipo_objeto, punto_id, grupo_id, sede_id, token, firma_llave_id, estado)
    VALUES ('PUNTO', $1, $2, $3, $4, $5, 'ACTIVO')`,
    [pB.id, pB.grupo_id, s2, armar(pB, 1).token, LLAVE_ID])

  const cuenta = async (tabla) => Number((await c.query(
    `SELECT count(*)::int n FROM ${tabla} WHERE grupo_id IN ($1,$2)`, [g1.id, g2.id])).rows[0].n)

  await como(uLector)
  check('un lector del contrato A ve solo SU punto, no el del contrato B',
    await cuenta('ronda_puntos') === 1)
  check('ve solo su zona', await cuenta('ronda_zonas') === 1)
  check('y solo los QR de su contrato', await cuenta('ronda_qr') === 2, '2 versiones del punto A')
  const escrituraLector = await c.query(
    `UPDATE ronda_puntos SET nombre = 'cambiado' WHERE id = $1`, [p1.id])
  check('un lector no edita el punto (la RLS no le deja ninguna fila)',
    escrituraLector.rowCount === 0, `${escrituraLector.rowCount} filas`)

  await comoDueno(); await como(uGestor)
  const escrituraGestor = await c.query(
    `UPDATE ronda_puntos SET descripcion = 'Al entrar, a la derecha' WHERE id = $1`, [p1.id])
  check('el gestor de puntos sí edita el suyo', escrituraGestor.rowCount === 1)
  const escrituraAjena = await c.query(
    `UPDATE ronda_puntos SET descripcion = 'no deberia' WHERE id = $1`, [pB.id])
  check('pero no el de otro contrato', escrituraAjena.rowCount === 0)
  const insertarEnAjeno = await enSavepoint(() => c.query(`
    INSERT INTO ronda_puntos (sede_id, grupo_id, codigo, nombre)
    VALUES ($1,$1,'P-999','Colado en el contrato ajeno')`, [s2]))
  check('ni crea puntos en la sede de otro contrato (el grupo_id derivado se verifica)',
    !insertarEnAjeno.ok, insertarEnAjeno.error ?? 'pasó')

  await comoDueno(); await como(uCiego)
  check('sin ninguna clave del módulo no se lee ni un punto ni un QR',
    await cuenta('ronda_puntos') === 0 && await cuenta('ronda_qr') === 0)

  await comoDueno()
  const uAdm = await nuevoUsuario('adm', null, 'ADMIN', null)
  await como(uAdm)
  check('un ADMIN ve los puntos de los dos contratos', await cuenta('ronda_puntos') === 2)
  await comoDueno()

  // ── 9. Lote de impresión ──────────────────────────────────────────────────
  console.log('\n9) Lote de impresión: consecutivo de SEQUENCE y registro de cada impresión')
  const { rows: [lote] } = await c.query(`
    INSERT INTO ronda_qr_lotes (grupo_id, sede_id, nombre, formato, cantidad)
    VALUES ($1, $2, 'Lote de prueba', 'HOJA_A4', 2) RETURNING numero`, [g1.id, s1])
  check('el consecutivo del lote tiene la forma LQ-000000', /^LQ-\d{6}$/.test(lote.numero), lote.numero)
  const { rows: [lote2] } = await c.query(`
    INSERT INTO ronda_qr_lotes (grupo_id, sede_id, formato) VALUES ($1,$2,'STICKER_8X8')
    RETURNING numero`, [g1.id, s1])
  check('y dos lotes seguidos no colisionan', lote.numero !== lote2.numero,
    `${lote.numero} y ${lote2.numero}`)
  const formatoMalo = await enSavepoint(() => c.query(`
    INSERT INTO ronda_qr_lotes (grupo_id, sede_id, formato) VALUES ($1,$2,'A4_12UP')`, [g1.id, s1]))
  check('un formato que no está en el catálogo se rechaza', !formatoMalo.ok)
  check('los cuatro formatos del CHECK son los de lib/puntos-qr.ts',
    JSON.stringify(QR.FORMATOS_LOTE.slice().sort())
      === JSON.stringify(['HOJA_A4', 'PLACA_A5', 'PLACA_A6', 'STICKER_8X8']),
    QR.FORMATOS_LOTE.join(','))
  check('y ninguno imprime el QR a menos de 50 mm (ADR-B)',
    QR.FORMATOS_LOTE.every((f) => QR.FORMATOS[f].qr >= 50),
    QR.FORMATOS_LOTE.map((f) => `${f}:${QR.FORMATOS[f].qr}mm`).join(' '))

  await como(uGestor)
  await c.query(`SELECT ronda_qr_registrar_impresion($1, 'HOJA_A4', NULL)`, [qr2.id])
  await c.query(`SELECT ronda_qr_registrar_impresion($1, 'PLACA_A6', NULL)`, [qr2.id])
  await comoDueno()
  const { rows: [impresiones] } = await c.query(
    `SELECT impresiones FROM ronda_qr WHERE id=$1`, [qr2.id])
  check('cada impresión suma al contador del QR', Number(impresiones.impresiones) === 2)
  const { rows: evImpr } = await c.query(`
    SELECT accion, detalle->>'formato' f FROM ronda_eventos
     WHERE entidad='ronda_qr' AND entidad_id=$1 AND accion='IMPRIMIR' ORDER BY id`, [qr2.id])
  check('y queda registrada una por una, con su formato',
    evImpr.length === 2 && evImpr[0].f === 'HOJA_A4' && evImpr[1].f === 'PLACA_A6',
    evImpr.map((e) => e.f).join(','))

  // ── 10. Auditoría append-only y encadenado ────────────────────────────────
  console.log('\n10) ronda_eventos: solo agregar, y encadenado por entidad')
  const { rows: cadena2 } = await c.query(`
    SELECT id, hash, hash_anterior, accion FROM ronda_eventos
     WHERE entidad='ronda_qr' AND entidad_id=$1 ORDER BY id`, [qr2.id])
  check('todos los eventos traen hash', cadena2.every((e) => e.hash && e.hash.length === 64))
  check('el primero de la entidad no tiene anterior y los demás enlazan con el previo',
    cadena2[0].hash_anterior === null
      && cadena2.slice(1).every((e, i) => e.hash_anterior === cadena2[i].hash),
    `${cadena2.length} eventos`)

  const { rows: [evRechazo] } = await c.query(`
    INSERT INTO ronda_eventos (entidad, entidad_id, accion, actor_tipo, canal, detalle, ip)
    VALUES ('ronda_qr', NULL, 'APERTURA_RECHAZADA', 'ANONIMO', 'PUBLICO',
            '{"motivo":"FIRMA_INVALIDA","token":"1ZZZZZZZZ01ZZZZZZZZZZ"}'::jsonb, '192.0.2.10')
    RETURNING id, grupo_id, hash`)
  check('un rechazo de la ruta pública se puede registrar SIN contrato conocido',
    evRechazo.grupo_id === null && evRechazo.hash !== null)

  await como(uGestor)
  const upEvento = await c.query(
    `UPDATE ronda_eventos SET accion='MANIPULADO' WHERE id=$1`, [cadena2[0].id])
  check('nadie puede editar un evento (append-only: sin política de UPDATE)',
    upEvento.rowCount === 0, `${upEvento.rowCount} filas`)
  const delEvento = await c.query(`DELETE FROM ronda_eventos WHERE id=$1`, [cadena2[0].id])
  check('ni borrarlo', delEvento.rowCount === 0, `${delEvento.rowCount} filas`)
  const { rows: veRechazo } = await c.query(
    `SELECT id FROM ronda_eventos WHERE id=$1`, [evRechazo.id])
  check('pero el rechazo sin contrato sí se puede leer desde la consola', veRechazo.length === 1)
  await comoDueno()

  // ── 11. La ruta pública /q/<token>, con su decisión de verdad ────────────
  // Se ejecuta `resolverCodigo` de `app/q/decidir.ts` — el MISMO código que corre
  // en producción — contra esta transacción, con una puerta de datos sobre `pg`
  // en lugar de PostgREST. Así se prueba el orden de las comprobaciones y la
  // auditoría, que es lo que importa de esa página.
  console.log('\n11) Ruta pública /q/<token> (app/q/decidir.ts contra esta base)')
  process.env.RONDA_HMAC_LLAVE_ACTUAL = LLAVE_ID
  process.env['RONDA_HMAC_' + LLAVE_ID.toUpperCase().replace(/[^A-Z0-9]+/g, '_')] = SECRETO

  const puerta = {
    async buscarQr(porToken, codigo) {
      const { rows } = await c.query(
        `SELECT id, punto_id, grupo_id, sede_id, version, estado, firma_llave_id, codigo_manual
           FROM ronda_qr WHERE ${porToken ? 'token' : 'codigo_manual'} = $1`, [codigo])
      return rows[0] ?? null
    },
    async qrVigente(qrId) {
      const { rows } = await c.query(`SELECT ronda_qr_vigente($1) v`, [qrId])
      return rows[0].v === true
    },
    async buscarPunto(puntoId) {
      const { rows } = await c.query(`
        SELECT p.id, p.codigo, p.nombre, p.descripcion, p.piso, p.estado,
               p.exige_geocerca, p.geocerca_metros,
               z.nombre AS zona_nombre, s.nombre AS sede_nombre,
               s.ciudad AS sede_ciudad, s.direccion AS sede_direccion
          FROM ronda_puntos p
          LEFT JOIN ronda_zonas z ON z.id = p.zona_id
          JOIN sedes s ON s.id = p.sede_id
         WHERE p.id = $1`, [puntoId])
      return rows[0] ?? null
    },
    async registrarEvento(e) {
      await c.query(`
        INSERT INTO ronda_eventos (grupo_id, sede_id, entidad, entidad_id, accion,
                                   actor_tipo, canal, detalle, ip)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9)`,
        [e.grupo_id, e.sede_id, e.entidad, e.entidad_id, e.accion,
         e.actor_tipo, e.canal, JSON.stringify(e.detalle), e.ip])
    },
  }
  const abrir = (codigo) => DECIDIR.resolverCodigo(codigo, '192.0.2.50', puerta)
  const ultimoEvento = async (entidadId) => (await c.query(`
    SELECT accion, detalle->>'motivo' motivo, detalle->>'modo' modo, actor_tipo, canal
      FROM ronda_eventos
     WHERE entidad='ronda_qr' AND entidad_id IS NOT DISTINCT FROM $1
     ORDER BY id DESC LIMIT 1`, [entidadId])).rows[0]

  // El QR activo del punto A, versión 2, con su contrato vigente.
  const buena = await abrir(t2.token)
  check('un token válido abre el punto, con su nombre y su lugar',
    buena.ok === true && buena.punto?.nombre === 'Portería principal'
      && buena.punto?.sedeNombre === 'ZZ Sede de prueba A' && buena.aperturaModo === 'QR',
    buena.ok ? `${buena.punto.nombre} · ${buena.punto.sedeNombre}` : buena.motivo)
  const evAp = await ultimoEvento(qr2.id)
  check('y deja el evento APERTURA como anónimo por el canal público',
    evAp.accion === 'APERTURA' && evAp.actor_tipo === 'ANONIMO' && evAp.canal === 'PUBLICO')

  // El código manual impreso bajo el QR abre lo mismo, marcado como manual.
  const manual = await abrir(QR.formatearManual(qr2.codigo_manual))
  check('el código manual (con guión y todo) abre el MISMO punto',
    manual.ok === true && manual.punto?.id === p1.id)
  check('y queda marcado como apertura MANUAL, que pesa distinto en el antifraude',
    manual.ok === true && manual.aperturaModo === 'MANUAL'
      && (await ultimoEvento(qr2.id)).modo === 'MANUAL')

  // Firma alterada: el cuerpo del token existe, la firma no corresponde. No hay
  // fila con ESE token, así que ni se sabe de qué contrato era.
  const falsificado = t2.token.slice(0, 20) + (t2.token[20] === 'Z' ? 'Y' : 'Z')
  const falso = await abrir(falsificado)
  check('un token con la firma alterada NO abre nada',
    falso.ok === false && falso.motivo === 'NO_EXISTE', falso.motivo)
  check('y el intento queda registrado aunque no se sepa de qué contrato era',
    (await ultimoEvento(null)).motivo === 'NO_EXISTE')

  // Firma válida pero de OTRA llave, que el servidor no tiene configurada.
  const otraLlave = FIRMA.armarToken({
    clavePublica: p1.clave_publica, puntoId: p1.id, version: 3,
    llaveId: 'cli-que-no-existe-v9', secreto: 'otro-secreto',
  })
  await c.query(`
    INSERT INTO ronda_qr (tipo_objeto, punto_id, grupo_id, sede_id, version, token,
                          firma_llave_id, estado)
    VALUES ('PUNTO', $1, $2, $3, 3, $4, 'cli-que-no-existe-v9', 'BORRADOR')`,
    [p1.id, p1.grupo_id, s1, otraLlave.token])
  const sinLlave = await abrir(otraLlave.token)
  check('un token firmado con una llave que el servidor no tiene no se abre',
    sinLlave.ok === false && sinLlave.motivo === 'SIN_LLAVE', sinLlave.motivo)

  // Token bien firmado con la llave buena, pero cuyo QR está en BORRADOR.
  const borrador = FIRMA.armarToken({
    clavePublica: p1.clave_publica, puntoId: p1.id, version: 4,
    llaveId: LLAVE_ID, secreto: SECRETO,
  })
  await c.query(`
    INSERT INTO ronda_qr (tipo_objeto, punto_id, grupo_id, sede_id, version, token,
                          firma_llave_id, estado)
    VALUES ('PUNTO', $1, $2, $3, 4, $4, $5, 'BORRADOR')`,
    [p1.id, p1.grupo_id, s1, borrador.token, LLAVE_ID])
  const enBorrador = await abrir(borrador.token)
  check('una placa en BORRADOR no abre, aunque la firma sea buena',
    enBorrador.ok === false && enBorrador.motivo === 'QR_BORRADOR', enBorrador.motivo)

  // El caso que de verdad ejerce la verificación de la firma: una fila cuyo
  // token EXISTE pero no corresponde. Pasa si alguien cambia el secreto sin
  // cambiar el identificador de la llave — el error de operación más probable
  // de todo el ADR-B —, o si alguien escribe una fila a mano en la base.
  const malFirmado = FIRMA.armarToken({
    clavePublica: p1.clave_publica, puntoId: p1.id, version: 5,
    llaveId: LLAVE_ID, secreto: 'el-secreto-que-ya-no-es',
  })
  await c.query(`
    INSERT INTO ronda_qr (tipo_objeto, punto_id, grupo_id, sede_id, version, token,
                          firma_llave_id, estado)
    VALUES ('PUNTO', $1, $2, $3, 5, $4, $5, 'BORRADOR')`,
    [p1.id, p1.grupo_id, s1, malFirmado.token, LLAVE_ID])
  const firmaMala = await abrir(malFirmado.token)
  check('un token que existe pero cuya firma no corresponde se rechaza por FIRMA',
    firmaMala.ok === false && firmaMala.motivo === 'FIRMA_INVALIDA', firmaMala.motivo)

  // Y la firma de una versión pegada en el cuerpo de otra.
  const cruzado = FIRMA.armarToken({
    clavePublica: p1.clave_publica, puntoId: p1.id, version: 7,
    llaveId: LLAVE_ID, secreto: SECRETO,
  })
  await c.query(`
    INSERT INTO ronda_qr (tipo_objeto, punto_id, grupo_id, sede_id, version, token,
                          firma_llave_id, estado)
    VALUES ('PUNTO', $1, $2, $3, 6, $4, $5, 'BORRADOR')`,
    [p1.id, p1.grupo_id, s1, cruzado.token, LLAVE_ID])
  const versionCruzada = await abrir(cruzado.token)
  check('ni la firma de una versión sirve para otra',
    versionCruzada.ok === false && versionCruzada.motivo === 'FIRMA_INVALIDA',
    versionCruzada.motivo)

  // Un token válido de OTRO punto no abre este: la firma ata el token al punto.
  const { rows: [qrOtro] } = await c.query(
    `SELECT token FROM ronda_qr WHERE punto_id = $1 AND estado='ACTIVO'`, [pB.id])
  const otroPunto = await abrir(qrOtro.token)
  check('el token del punto de la otra sede abre SU punto, no este',
    otroPunto.ok === true && otroPunto.punto?.id === pB.id,
    otroPunto.ok ? otroPunto.punto.nombre : otroPunto.motivo)

  // La placa revocada de la versión 1: la que alguien pudo fotografiar antes.
  const revocadoAbre = await abrir(t1.token)
  check('la placa revocada se rechaza por REVOCADA, no por firma',
    revocadoAbre.ok === false && revocadoAbre.motivo === 'QR_REVOCADO', revocadoAbre.motivo)
  check('y su rechazo queda en la cadena de auditoría de ESE QR',
    (await ultimoEvento(qr1.id)).motivo === 'QR_REVOCADO')

  // Contrato vencido: el QR sigue ACTIVO y la firma es buena, pero no abre.
  // La prórroga de la sección 7 extiende la vigencia, así que para vencer el
  // contrato de verdad hay que quitarla: es justo lo que prueba que la vigencia
  // es efectiva y no un estado guardado.
  await c.query(`SAVEPOINT vencer`)
  await c.query(`DELETE FROM grupo_vigencias WHERE grupo_id=$1`, [g1.id])
  await c.query(`UPDATE grupos_contrato SET vigencia_hasta = CURRENT_DATE - 1 WHERE id=$1`, [g1.id])
  const vencidoAbre = await abrir(t2.token)
  check('con el contrato vencido la placa buena tampoco abre',
    vencidoAbre.ok === false && vencidoAbre.motivo === 'CONTRATO_NO_VIGENTE', vencidoAbre.motivo)
  await c.query(`ROLLBACK TO SAVEPOINT vencer`)
  await c.query(`RELEASE SAVEPOINT vencer`)
  const otraVez = await abrir(t2.token)
  check('y al volver a estar vigente abre otra vez, sin tocar ninguna fila del QR',
    otraVez.ok === true, otraVez.ok ? '' : otraVez.motivo)

  // Punto retirado: la placa sigue en la pared, el punto salió de la operación.
  await c.query(`UPDATE ronda_puntos SET estado='RETIRADO' WHERE id=$1`, [p1.id])
  const retirado = await abrir(t2.token)
  check('un punto RETIRADO no abre aunque su placa siga pegada',
    retirado.ok === false && retirado.motivo === 'PUNTO_RETIRADO', retirado.motivo)
  await c.query(`UPDATE ronda_puntos SET estado='ACTIVO' WHERE id=$1`, [p1.id])

  // Formas inválidas y confusiones de alfabeto.
  const basura = await abrir('no-es-un-codigo')
  check('una forma inválida se rechaza antes de tocar la base',
    basura.ok === false && basura.motivo === 'FORMA_INVALIDA', basura.motivo)
  const cambiado = qr2.codigo_manual.includes('0')
    ? qr2.codigo_manual.replace('0', 'O')
    : qr2.codigo_manual.slice(0, 7) + (qr2.codigo_manual[7] === 'X' ? 'Y' : 'X')
  const confundido = await abrir(cambiado)
  check('cambiar un carácter del código manual NO abre el punto de al lado',
    confundido.ok === false, confundido.ok ? 'abrió' : confundido.motivo)
  const vacio = await abrir('')
  check('un código vacío se rechaza sin reventar', vacio.ok === false)

  const { rows: [rechazos] } = await c.query(`
    SELECT count(*)::int n FROM ronda_eventos WHERE accion='APERTURA_RECHAZADA'`)
  check('cada rechazo dejó su evento de auditoría', rechazos.n >= 8, `${rechazos.n} rechazos`)


} finally {
  await c.query('ROLLBACK')
  await c.end()
}

console.log(`\n${ok} pruebas bien, ${fail} mal. Todo revertido con ROLLBACK: la base queda igual.`)
process.exit(fail > 0 ? 1 : 0)

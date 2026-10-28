// Pruebas de la F6 del módulo de Puntos QR (activos del cliente: tipos,
// activos, documentos, medidores, lecturas y QR de activo) contra la base REAL,
// dentro de una transacción que se revierte al final.
//
// Qué comprueba:
//   1. que el archivo de migración de F6 corra COMPLETO dos veces seguidas en la
//      misma transacción (idempotencia de verdad, no de lectura);
//   2. la estructura que mandan §2.4 y §4.2 del complemento 2: qué columna de
//      alcance lleva cada tabla, que `activo_lecturas` sea append (sin política
//      de UPDATE) y que `ronda_qr` exija exactamente uno de punto / activo;
//   3. que `grupo_id` se DERIVE de la sede y no se pueda inyectar, que la clave
//      pública del activo sea inmutable (si cambiara, las placas pegadas al
//      equipo quedarían muertas) y que la jerarquía padre/hijo no admita ciclos
//      ni padres de otro contrato;
//   4. las reglas del medidor: un contador no baja, una lectura del futuro se
//      rechaza, `valor_actual` sale SIEMPRE de la última lectura y se recalcula
//      al borrar una;
//   5. el QR del activo con el MISMO código que usa la aplicación (se importa
//      `lib/puntos-qr-firma.ts` tal cual): firmado sobre el UUID del ACTIVO, una
//      sola placa activa por activo, y la vigencia efectiva del contrato;
//   6. la ruta pública /q/<token>: se ejecuta la DECISIÓN REAL de
//      `app/q/decidir.ts` contra esta misma base y se comprueba que una placa de
//      activo abre su ficha, que una de punto sigue abriendo el punto y lista
//      los activos que están en él (§2.1), y que cada rechazo deja su evento;
//   7. el alcance por contrato de la RLS: un usuario de un contrato NO lee los
//      activos de otro, quien solo ve no escribe, y quien solo registra lecturas
//      no edita la ficha del activo.
//
// NO deja nada en la base: todo va dentro de BEGIN … ROLLBACK.
//
// Uso (desde la raíz del worktree):
//   node --use-system-ca scripts/probar-puntos-qr-f6.mjs
import { createRequire } from 'module'
import { registerHooks } from 'node:module'
import { readFileSync, existsSync } from 'fs'
import { fileURLToPath, pathToFileURL } from 'url'
import { dirname, join, resolve } from 'path'

const require = createRequire(import.meta.url)
const { Client } = require('pg')

const __dirname = dirname(fileURLToPath(import.meta.url))
const raiz = join(__dirname, '..')

// Mismo gancho de resolución que la prueba de F2: Node ejecuta TypeScript
// quitando los tipos, pero la resolución de ESM exige extensión. Así se importan
// los módulos REALES de la aplicación en vez de copiar su lógica aquí.
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
const ACTIVOS = await import(pathToFileURL(join(libDir, 'activos.ts')).href)
const DECIDIR = await import(
  pathToFileURL(join(raiz, 'apps', 'inventario', 'app', 'q', 'decidir.ts')).href)

function cadena() {
  if (process.env.DIRECT_URL) return process.env.DIRECT_URL.trim()
  const candidatos = [
    join(raiz, '.env.local'),
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

const SQL_F6 = readFileSync(
  join(raiz, 'supabase', 'migrations', '20261028000600_puntos_qr_f6_activos.sql'), 'utf8')

// Llave de firma de mentira, solo para estas pruebas.
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
  // ── 1. Idempotencia ───────────────────────────────────────────────────────
  console.log('\n1) Idempotencia (F6 completa, dos veces en la misma transacción)')
  await c.query(SQL_F6)
  check('primera pasada de F6', true)
  await c.query(SQL_F6)
  check('segunda pasada sin error', true)

  // ── 2. Estructura ─────────────────────────────────────────────────────────
  console.log('\n2) Estructura (§2.4 y §4.2 del complemento 2)')
  const { rows: tablas } = await c.query(`
    SELECT c.relname, c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname='public' AND c.relname IN
       ('activo_tipos','activos','activo_documentos','activo_medidores','activo_lecturas')`)
  check('las 5 tablas de F6 existen', tablas.length === 5, `${tablas.length}/5`)
  check('todas con RLS activa', tablas.every((t) => t.relrowsecurity))

  const nulabilidad = async (tabla, col) => (await c.query(`
    SELECT is_nullable FROM information_schema.columns
     WHERE table_schema='public' AND table_name=$1 AND column_name=$2`,
    [tabla, col])).rows[0]?.is_nullable
  check('activos: grupo_id y sede_id NOT NULL (el activo es del cliente, en su sede)',
    await nulabilidad('activos', 'grupo_id') === 'NO'
      && await nulabilidad('activos', 'sede_id') === 'NO')
  check('activo_medidores y activo_lecturas: grupo_id y sede_id NOT NULL',
    await nulabilidad('activo_medidores', 'grupo_id') === 'NO'
      && await nulabilidad('activo_medidores', 'sede_id') === 'NO'
      && await nulabilidad('activo_lecturas', 'grupo_id') === 'NO'
      && await nulabilidad('activo_lecturas', 'sede_id') === 'NO')
  check('activo_tipos: grupo_id NULLABLE (catálogo general, NULL = todos)',
    await nulabilidad('activo_tipos', 'grupo_id') === 'YES')
  check('activo_documentos NO lleva grupo_id: hereda el alcance de su activo',
    await nulabilidad('activo_documentos', 'grupo_id') === undefined)

  const { rows: polLec } = await c.query(`
    SELECT cmd FROM pg_policies WHERE schemaname='public' AND tablename='activo_lecturas'`)
  check('activo_lecturas no tiene política de UPDATE (una lectura no se edita)',
    !polLec.some((p) => ['UPDATE', 'ALL'].includes(p.cmd)),
    polLec.map((p) => p.cmd).join(','))
  check('pero sí de DELETE, para deshacer una digitación mala',
    polLec.some((p) => p.cmd === 'DELETE'))

  const { rows: lecturaEnEstados } = await c.query(`
    SELECT indexname, indexdef FROM pg_indexes
     WHERE schemaname='public' AND indexname IN ('ux_ronda_qr_unico_act','ux_ronda_qr_version_act')`)
  check('existen los dos índices que protegen la placa del activo',
    lecturaEnEstados.length === 2, lecturaEnEstados.map((i) => i.indexname).join(' '))
  check('y el de "un solo QR activo por activo" es PARCIAL por estado',
    /WHERE.*ACTIVO/i.test(
      lecturaEnEstados.find((i) => i.indexname === 'ux_ronda_qr_unico_act')?.indexdef ?? ''))

  const { rows: [chk] } = await c.query(`
    SELECT pg_get_constraintdef(k.oid) def FROM pg_constraint k JOIN pg_class t ON t.oid=k.conrelid
     WHERE t.relname='ronda_qr' AND k.conname='ronda_qr_objeto_chk'`)
  check('el CHECK de ronda_qr exige EXACTAMENTE UNO de punto_id / activo_id',
    /activo_id IS NULL/.test(chk?.def ?? '') && /punto_id IS NULL/.test(chk?.def ?? ''),
    chk?.def ?? 'no existe')

  const { rows: [vista] } = await c.query(`
    SELECT c.reloptions::text opts FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname='public' AND c.relname='vw_activos_medidor_vencido'`)
  check('la vista de medidores vencidos es security_invoker (si no, se saltaría la RLS)',
    /security_invoker=true/.test(vista?.opts ?? ''), vista?.opts ?? 'no existe')

  const { rows: tiposSeed } = await c.query(`
    SELECT codigo, obligatorio_normativo FROM activo_tipos WHERE grupo_id IS NULL ORDER BY codigo`)
  check('el catálogo general trae los seis tipos de §2.1 (y dos más)',
    ['EXTINTOR', 'ASCENSOR', 'BOMBA', 'LUMINARIA', 'GRIFERIA', 'PUERTA_AUTOMATICA']
      .every((t) => tiposSeed.some((s) => s.codigo === t)),
    tiposSeed.map((t) => t.codigo).join(' '))
  check('y el extintor queda marcado como obligatorio por norma (recarga anual, §2.2)',
    tiposSeed.find((t) => t.codigo === 'EXTINTOR')?.obligatorio_normativo === true)

  // Lo que F6 NO tiene que haber tocado: es de F7.
  const { rows: tocado } = await c.query(`
    SELECT column_name FROM information_schema.columns
     WHERE table_schema='public' AND table_name='mantenimiento_tickets'
       AND column_name IN ('activo_id','plan_id','grupo_id')`)
  check('F6 NO extendió mantenimiento_tickets: eso es F7',
    tocado.length === 0, tocado.map((t) => t.column_name).join(' ') || 'ninguna columna nueva')
  const { rows: planes } = await c.query(`
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname='public' AND c.relname IN ('mant_planes','mant_plan_tareas')`)
  check('ni creó mant_planes / mant_plan_tareas', planes.length === 0)

  // ── 3. Derivación y coherencia ────────────────────────────────────────────
  console.log('\n3) Derivación y coherencia (grupo_id sale de la sede)')
  const { rows: [g1] } = await c.query(`
    INSERT INTO grupos_contrato (codigo, nombre, estado, vigencia_desde, vigencia_hasta)
    VALUES ('ZZF6A', 'Contrato de prueba F6 A', 'VIGENTE', CURRENT_DATE - 30, CURRENT_DATE + 30)
    RETURNING id`)
  const { rows: [g2] } = await c.query(`
    INSERT INTO grupos_contrato (codigo, nombre, estado, vigencia_desde, vigencia_hasta)
    VALUES ('ZZF6B', 'Contrato de prueba F6 B', 'VIGENTE', CURRENT_DATE - 30, CURRENT_DATE + 30)
    RETURNING id`)
  const nuevaSede = async (grupo, nombre) => (await c.query(`
    INSERT INTO sedes (grupo_id, nombre, ciudad, direccion, lat, lng)
    VALUES ($1,$2,'BOGOTÁ D.C.','Calle de prueba 1',4.65,-74.05) RETURNING id`,
    [grupo, nombre])).rows[0].id
  const s1 = await nuevaSede(g1.id, 'ZZ Sede F6 A')
  const s2 = await nuevaSede(g2.id, 'ZZ Sede F6 B')

  const { rows: [z1] } = await c.query(`
    INSERT INTO ronda_zonas (sede_id, grupo_id, codigo, nombre, piso)
    VALUES ($1,$1,'SOT-2','Sótano 2','SÓTANO 2') RETURNING id`, [s1])
  const { rows: [z2] } = await c.query(`
    INSERT INTO ronda_zonas (sede_id, grupo_id, codigo, nombre)
    VALUES ($1,$1,'T1','Torre 1') RETURNING id`, [s2])
  const { rows: [pt1] } = await c.query(`
    INSERT INTO ronda_puntos (sede_id, grupo_id, codigo, nombre, estado, lat, lng, precision_metros)
    VALUES ($1,$1,'P-001','Cuarto de bombas','ACTIVO',4.6501,-74.0509,8.0)
    RETURNING id, clave_publica, grupo_id::text`, [s1])

  const { rows: [tipoBomba] } = await c.query(
    `SELECT id FROM activo_tipos WHERE codigo='BOMBA' AND grupo_id IS NULL`)

  // `grupo_id` se manda MAL a propósito (va el id de la sede, que ni siquiera es
  // un contrato): si el trigger no lo derivara, la llave foránea reventaría.
  const nuevoActivo = async (sede, extra = {}) => {
    const campos = {
      sede_id: sede, grupo_id: sede, nombre: 'Bomba de presión 1',
      activo_tipo_id: tipoBomba.id, ...extra,
    }
    const cols = Object.keys(campos)
    const { rows } = await c.query(
      `INSERT INTO activos (${cols.join(',')})
       VALUES (${cols.map((_, i) => '$' + (i + 1)).join(',')})
       RETURNING id, codigo, clave_publica, grupo_id::text, sede_nombre, estado, criticidad`,
      cols.map((k) => campos[k]))
    return rows[0]
  }

  const a1 = await nuevoActivo(s1, { zona_id: z1.id, punto_id: pt1.id })
  check('el activo deriva grupo_id de la sede y no del que le manden',
    a1.grupo_id === g1.id, `quedó ${a1.grupo_id === g1.id ? 'el de la sede' : 'el inyectado'}`)
  check('y desnormaliza el nombre de la sede para los listados',
    a1.sede_nombre === 'ZZ Sede F6 A', a1.sede_nombre)
  check('el código se genera de una SEQUENCE con el formato AC-000001 (§4 nomenclatura)',
    /^AC-\d{6}$/.test(a1.codigo), a1.codigo)
  check('recibe clave pública de 8 caracteres del alfabeto sin ambigüedades',
    a1.clave_publica.length === 8 && QR.esDeAlfabeto(a1.clave_publica, QR.ALFABETO_TOKEN),
    a1.clave_publica)
  check('nace OPERATIVO (no hay estado BAJA: el activo es del cliente)', a1.estado === 'OPERATIVO')

  const { rows: [sinChoque] } = await c.query(
    `SELECT EXISTS (SELECT 1 FROM ronda_puntos p WHERE p.clave_publica = $1) choca`,
    [a1.clave_publica])
  check('la clave del activo no choca con la de ningún punto (generador compartido)',
    sinChoque.choca === false)

  const zonaAjena = await enSavepoint(() => c.query(
    `UPDATE activos SET zona_id = $1 WHERE id = $2`, [z2.id, a1.id]))
  check('un activo NO puede apuntar a una zona de otra sede',
    !zonaAjena.ok && /zona no pertenece/i.test(zonaAjena.error || ''), zonaAjena.error ?? 'pasó')

  const { rows: [trasClave] } = await c.query(
    `UPDATE activos SET clave_publica='ZZZZZZZZ' WHERE id=$1 RETURNING clave_publica`, [a1.id])
  check('la clave pública es INMUTABLE: cambiarla dejaría muerta la placa pegada al equipo',
    trasClave.clave_publica === a1.clave_publica,
    `${a1.clave_publica} → ${trasClave.clave_publica}`)

  const a2 = await nuevoActivo(s1, { nombre: 'Motor de la bomba 1', padre_id: a1.id })
  check('un activo puede colgar de otro del mismo contrato (padre/hijo de §2.1)', !!a2.id)
  const cicloPropio = await enSavepoint(() => c.query(
    `UPDATE activos SET padre_id = id WHERE id = $1`, [a1.id]))
  check('un activo no puede ser su propio padre', !cicloPropio.ok)
  const cicloLargo = await enSavepoint(() => c.query(
    `UPDATE activos SET padre_id = $1 WHERE id = $2`, [a2.id, a1.id]))
  check('ni descendiente de sí mismo (el ciclo A→B→A se rechaza)',
    !cicloLargo.ok && /descendiente de sí mismo/i.test(cicloLargo.error || ''),
    cicloLargo.error ?? 'pasó')

  const aOtro = await nuevoActivo(s2, { nombre: 'Bomba de la sede B', activo_tipo_id: null })
  const padreAjeno = await enSavepoint(() => c.query(
    `UPDATE activos SET padre_id = $1 WHERE id = $2`, [aOtro.id, a1.id]))
  check('el activo padre tiene que ser del MISMO contrato',
    !padreAjeno.ok && /otro contrato/i.test(padreAjeno.error || ''), padreAjeno.error ?? 'pasó')

  const { rows: [tipoPropio] } = await c.query(`
    INSERT INTO activo_tipos (grupo_id, codigo, nombre, categoria)
    VALUES ($1,'ZZ_PROPIO','Tipo propio de B','OTRO') RETURNING id`, [g2.id])
  const tipoAjeno = await enSavepoint(() => c.query(
    `UPDATE activos SET activo_tipo_id = $1 WHERE id = $2`, [tipoPropio.id, a1.id]))
  check('un tipo de OTRO contrato no se le puede poner al activo',
    !tipoAjeno.ok && /otro contrato/i.test(tipoAjeno.error || ''), tipoAjeno.error ?? 'pasó')

  const codigoRepetido = await enSavepoint(() => nuevoActivo(s1, { codigo: a1.codigo }))
  check('el código es único por contrato',
    !codigoRepetido.ok && /ux_activos_codigo/.test(codigoRepetido.error || ''),
    codigoRepetido.error ?? 'pasó')
  const mismoCodigoOtroContrato = await enSavepoint(
    () => nuevoActivo(s2, { codigo: a1.codigo, activo_tipo_id: null }))
  check('pero el MISMO código sí puede existir en otro contrato',
    mismoCodigoOtroContrato.ok, mismoCodigoOtroContrato.error ?? 'pasó')

  const garantiaAlReves = await enSavepoint(() => c.query(`
    UPDATE activos SET fecha_instalacion = CURRENT_DATE,
                       garantia_hasta = CURRENT_DATE - 10 WHERE id = $1`, [a1.id]))
  check('la garantía no puede vencer antes de la instalación', !garantiaAlReves.ok)

  // ── 4. Medidores y lecturas ───────────────────────────────────────────────
  console.log('\n4) Medidores: valor_actual sale SIEMPRE de la última lectura')
  const { rows: [med] } = await c.query(`
    INSERT INTO activo_medidores (activo_id, grupo_id, sede_id, codigo, nombre, tipo, unidad,
                                  acumulativo, valor_alerta)
    VALUES ($1, $1, $1, 'PRINCIPAL', 'Horómetro', 'HORAS', 'h', true, 5000)
    RETURNING id, grupo_id::text, sede_id::text, valor_actual, leido_at`, [a1.id])
  check('el medidor deriva contrato y sede del activo, no del que le manden',
    med.grupo_id === g1.id && med.sede_id === s1)
  check('y nace en cero, sin fecha de lectura',
    Number(med.valor_actual) === 0 && med.leido_at === null)

  // `leido_at` se pasa explícito y DISTINTO en cada lectura: dentro de una
  // transacción `NOW()` vale lo mismo para todas, y una prueba donde todas las
  // lecturas son de la misma hora no se parece a nada de lo que pasa en campo.
  let minuto = 0
  const lectura = async (valor, cuando = null) => c.query(`
    INSERT INTO activo_lecturas (medidor_id, activo_id, grupo_id, sede_id, valor, leido_at, origen, nota)
    VALUES ($1, $1, $1, $1, $2, ${cuando ?? `NOW() - INTERVAL '${100 - (minuto += 1)} minutes'`}, 'CONSOLA', NULL)
    RETURNING id, activo_id::text, grupo_id::text, valor_anterior, delta`, [med.id, valor])

  const { rows: [l1] } = await lectura(1200)
  check('la lectura deriva activo, contrato y sede del medidor',
    l1.activo_id === a1.id && l1.grupo_id === g1.id)
  check('la primera lectura no tiene anterior ni delta',
    l1.valor_anterior === null && l1.delta === null)
  const { rows: [m1] } = await c.query(
    `SELECT valor_actual, leido_at IS NOT NULL tiene_fecha FROM activo_medidores WHERE id=$1`,
    [med.id])
  check('y el medidor queda en 1200 h sin que nadie escriba valor_actual',
    Number(m1.valor_actual) === 1200 && m1.tiene_fecha === true, String(m1.valor_actual))

  const { rows: [l2] } = await lectura(1450)
  check('la segunda lectura calcula el anterior y el delta',
    Number(l2.valor_anterior) === 1200 && Number(l2.delta) === 250,
    `anterior ${l2.valor_anterior}, delta ${l2.delta}`)

  const haciaAtras = await enSavepoint(() => lectura(1000))
  check('un contador acumulativo NO baja: la lectura menor se rechaza',
    !haciaAtras.ok && /acumulativo/i.test(haciaAtras.error || ''), haciaAtras.error ?? 'pasó')

  const delFuturo = await enSavepoint(() => lectura(1500, "NOW() + INTERVAL '2 days'"))

  check('una lectura con fecha del futuro se rechaza (es un reloj mal puesto)',
    !delFuturo.ok && /futuro/i.test(delFuturo.error || ''), delFuturo.error ?? 'pasó')

  await c.query(`DELETE FROM activo_lecturas WHERE id = $1`, [l2.id])
  const { rows: [m2] } = await c.query(
    `SELECT valor_actual FROM activo_medidores WHERE id=$1`, [med.id])
  check('al borrar la última lectura, el medidor vuelve al valor de la que queda',
    Number(m2.valor_actual) === 1200, String(m2.valor_actual))

  // Un medidor de instrumento (no acumulativo) sí puede bajar.
  const { rows: [medIns] } = await c.query(`
    INSERT INTO activo_medidores (activo_id, grupo_id, sede_id, codigo, nombre, tipo, unidad, acumulativo)
    VALUES ($1,$1,$1,'PRESION','Presión de salida','LECTURA','bar', false) RETURNING id`, [a1.id])
  await c.query(`
    INSERT INTO activo_lecturas (medidor_id, activo_id, grupo_id, sede_id, valor)
    VALUES ($1,$1,$1,$1,4.5)`, [medIns.id])
  const baja = await enSavepoint(() => c.query(`
    INSERT INTO activo_lecturas (medidor_id, activo_id, grupo_id, sede_id, valor)
    VALUES ($1,$1,$1,$1,3.2)`, [medIns.id]))
  check('una LECTURA de instrumento sí puede bajar (presión, nivel)', baja.ok,
    baja.error ?? 'entró')
  check('y lo que dice la lógica de la aplicación coincide con lo que exige la base',
    ACTIVOS.acumulativoPorDefecto('HORAS') === true
      && ACTIVOS.acumulativoPorDefecto('CICLOS') === true
      && ACTIVOS.acumulativoPorDefecto('LECTURA') === false)

  await lectura(5200)
  const { rows: vencidos } = await c.query(
    `SELECT medidor_id, excedido_en FROM vw_activos_medidor_vencido WHERE activo_id = $1`, [a1.id])
  check('la vista de medidores vencidos lo muestra al pasar el valor de alerta',
    vencidos.length === 1 && Number(vencidos[0].excedido_en) === 200,
    vencidos.map((v) => v.excedido_en).join(' '))
  check('y la lógica de la pantalla dice lo mismo sin volver a la base',
    ACTIVOS.medidorEnAlerta(5200, 5000) === true && ACTIVOS.medidorEnAlerta(4999, 5000) === false)

  // El activo, el contrato y la sede se mandan MAL a propósito (va el id de otro
  // activo en las tres columnas): el trigger del medidor los tiene que pisar.
  const medidorAjeno = await enSavepoint(() => c.query(`
    INSERT INTO activo_lecturas (medidor_id, activo_id, grupo_id, sede_id, valor)
    VALUES ($1, $2, $2, $2, 5500) RETURNING id, activo_id::text, grupo_id::text`,
    [med.id, aOtro.id]))
  check('la lectura ignora el activo y el contrato que le manden y usa los del medidor',
    medidorAjeno.ok
      && medidorAjeno.r.rows[0].activo_id === a1.id
      && medidorAjeno.r.rows[0].grupo_id === g1.id,
    medidorAjeno.error ?? 'entró')

  // ── 5. Documentos ─────────────────────────────────────────────────────────
  console.log('\n5) Documentos: ficha técnica, manual y garantía')
  const { rows: [doc] } = await c.query(`
    INSERT INTO activo_documentos (activo_id, tipo, nombre, nombre_archivo, archivo_path, mime, tamano, vence_at)
    VALUES ($1,'FICHA_TECNICA','Ficha del fabricante','ficha.pdf',
            $2,'application/pdf', 240000, NULL)
    RETURNING id, archivo_path`, [a1.id, `activos/${a1.id}/ficha.pdf`])
  check('el documento guarda la RUTA del bucket privado, no una URL pública',
    doc.archivo_path.startsWith(`activos/${a1.id}/`) && !/^https?:/.test(doc.archivo_path),
    doc.archivo_path)
  const { rows: [deRuta] } = await c.query(`SELECT activo_de_ruta($1)::text a`, [doc.archivo_path])
  check('activo_de_ruta() saca el id del activo de la ruta del bucket', deRuta.a === a1.id)
  const { rows: [fueraDeCarpeta] } = await c.query(
    `SELECT activo_de_ruta('instructivos/abc/x.pdf')::text a`)
  check('y devuelve NULL para una ruta de otra carpeta del mismo bucket',
    fueraDeCarpeta.a === null)
  const mismaRuta = await enSavepoint(() => c.query(`
    INSERT INTO activo_documentos (activo_id, tipo, nombre, archivo_path)
    VALUES ($1,'MANUAL','Otro', $2)`, [a1.id, doc.archivo_path]))
  check('el mismo archivo no se puede registrar dos veces', !mismaRuta.ok)
  check('la ruta que arma la aplicación cae en la carpeta que la base reconoce',
    ACTIVOS.rutaArchivoActivo(a1.id, 'Manual del Usuario.PDF')
      .startsWith(`activos/${a1.id}/`))

  // ── 6. El QR del activo ───────────────────────────────────────────────────
  console.log('\n6) El QR del activo: el motor de F2 tal cual, firmado sobre el activo')
  const armar = (objetoId, clave, version) => FIRMA.armarToken({
    clavePublica: clave, puntoId: objetoId, version, llaveId: LLAVE_ID, secreto: SECRETO,
  })
  const tA1 = armar(a1.id, a1.clave_publica, 1)
  check('la firma del token del activo verifica con el UUID del ACTIVO',
    FIRMA.verificarFirma(tA1.token, a1.id, 1, SECRETO) === true)
  check('y NO verifica con el UUID del punto donde está (un token no se muda de objeto)',
    FIRMA.verificarFirma(tA1.token, pt1.id, 1, SECRETO) === false)

  const insertarQrActivo = (activoId, token, estado = 'ACTIVO', version = null) => c.query(`
    INSERT INTO ronda_qr (tipo_objeto, activo_id, grupo_id, sede_id, version, token,
                          firma_llave_id, estado, instalado_canal, instalado_at)
    VALUES ('ACTIVO', $1, $1, $1, $2, $3, $4, $5, 'CONSOLA', NOW())
    RETURNING id, version, codigo_manual, grupo_id::text, sede_id::text`,
    [activoId, version, token, LLAVE_ID, estado])

  const { rows: [qrA1] } = await insertarQrActivo(a1.id, tA1.token)
  check('el QR del activo deriva contrato y sede del ACTIVO',
    qrA1.grupo_id === g1.id && qrA1.sede_id === s1)
  check('la primera versión nace en 1 sin que la aplicación la calcule',
    Number(qrA1.version) === 1, String(qrA1.version))
  check('y el código manual se genera solo, del alfabeto tecleable',
    QR.esCodigoManual(qrA1.codigo_manual), qrA1.codigo_manual)

  const dosActivas = await enSavepoint(
    () => insertarQrActivo(a1.id, armar(a1.id, a1.clave_publica, 2).token, 'ACTIVO', 2))
  check('NO se puede tener dos placas activas del mismo activo',
    !dosActivas.ok && /ux_ronda_qr_unico_act/.test(dosActivas.error || ''),
    dosActivas.error ?? 'pasó')

  const dosObjetos = await enSavepoint(() => c.query(`
    INSERT INTO ronda_qr (tipo_objeto, activo_id, punto_id, grupo_id, sede_id, version, token,
                          firma_llave_id, estado)
    VALUES ('ACTIVO', $1, $2, $1, $1, 9, $3, $4, 'BORRADOR')`,
    [a1.id, pt1.id, armar(a1.id, a1.clave_publica, 9).token, LLAVE_ID]))
  check('un QR no puede ser de un punto Y de un activo a la vez',
    !dosObjetos.ok && /ronda_qr_objeto_chk/.test(dosObjetos.error || ''),
    dosObjetos.error ?? 'pasó')
  const sinObjeto = await enSavepoint(() => c.query(`
    INSERT INTO ronda_qr (tipo_objeto, grupo_id, sede_id, version, token, firma_llave_id, estado)
    VALUES ('ACTIVO', $1, $1, 8, $2, $3, 'BORRADOR')`,
    [s1, armar(a1.id, a1.clave_publica, 8).token, LLAVE_ID]))
  check('ni de ninguno de los dos', !sinObjeto.ok)

  const { rows: [porToken] } = await c.query(
    `SELECT * FROM ronda_qr_objeto_por_token($1)`, [tA1.token])
  check('ronda_qr_objeto_por_token dice que es un ACTIVO y cuál',
    porToken.tipo_objeto === 'ACTIVO' && porToken.activo_id === a1.id
      && porToken.vigente === true && porToken.punto_id === null,
    `${porToken.tipo_objeto} · vigente ${porToken.vigente}`)

  // La de F2 tiene que seguir DEVOLVIENDO LO MISMO QUE EN F2: si F6 le cambiara
  // la forma, volver a aplicar la migración de F2 fallaría con "cannot change
  // return type of existing function".
  const { rows: [columnasF2] } = await c.query(`
    SELECT array_length(p.proallargtypes, 1) n FROM pg_proc p
     JOIN pg_namespace ns ON ns.oid = p.pronamespace
     WHERE ns.nspname='public' AND p.proname='ronda_qr_por_token'`)
  check('ronda_qr_por_token conserva la forma de F2 (parámetro + 10 columnas)',
    Number(columnasF2.n) === 11, String(columnasF2.n))

  // Vigencia efectiva (§2.5): el contrato vence y la placa deja de servir SIN
  // que ninguna fila del QR cambie.
  await c.query(`UPDATE grupos_contrato SET vigencia_hasta = CURRENT_DATE - 1 WHERE id = $1`, [g1.id])
  const { rows: [vencido] } = await c.query(
    `SELECT ronda_qr_vigente($1) v, (SELECT estado FROM ronda_qr WHERE id=$1) e`, [qrA1.id])
  check('con el contrato vencido la placa del activo deja de servir, sin tocar su estado',
    vencido.v === false && vencido.e === 'ACTIVO')
  await c.query(`UPDATE grupos_contrato SET vigencia_hasta = CURRENT_DATE + 30 WHERE id = $1`, [g1.id])
  const { rows: [renovado] } = await c.query(`SELECT ronda_qr_vigente($1) v`, [qrA1.id])
  check('y al renovar vuelve a servir sin que nadie reimprima nada', renovado.v === true)

  // ── 7. La ruta pública /q/<token>, con la decisión REAL ───────────────────
  console.log('\n7) /q/<token>: la decisión real de app/q/decidir.ts')
  process.env.RONDA_HMAC_LLAVE_ACTUAL = LLAVE_ID
  process.env[FIRMA.variableDeLlave(LLAVE_ID)] = SECRETO

  const puerta = {
    async buscarQr(porToken, codigo) {
      const { rows } = await c.query(
        `SELECT id, punto_id, activo_id, tipo_objeto, grupo_id, sede_id, version, estado,
                firma_llave_id, codigo_manual
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
    async buscarActivo(activoId) {
      const { rows } = await c.query(`
        SELECT a.id, a.codigo, a.nombre, a.descripcion, a.estado, a.ubicacion_texto,
               a.piso, a.marca, a.modelo, t.nombre AS tipo_nombre,
               z.nombre AS zona_nombre, s.nombre AS sede_nombre,
               s.ciudad AS sede_ciudad, s.direccion AS sede_direccion
          FROM activos a
          LEFT JOIN activo_tipos t ON t.id = a.activo_tipo_id
          LEFT JOIN ronda_zonas z ON z.id = a.zona_id
          JOIN sedes s ON s.id = a.sede_id
         WHERE a.id = $1`, [activoId])
      return rows[0] ?? null
    },
    async activosDePunto(puntoId) {
      const { rows } = await c.query(`
        SELECT a.id, a.codigo, a.nombre, t.nombre AS tipo_nombre
          FROM activos a LEFT JOIN activo_tipos t ON t.id = a.activo_tipo_id
         WHERE a.punto_id = $1 AND a.activo AND a.estado <> 'RETIRADO'
         ORDER BY a.codigo`, [puntoId])
      return rows
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
    SELECT accion, detalle->>'motivo' motivo, detalle->>'activo' activo, actor_tipo, canal
      FROM ronda_eventos
     WHERE entidad='ronda_qr' AND entidad_id IS NOT DISTINCT FROM $1
     ORDER BY id DESC LIMIT 1`, [entidadId])).rows[0]

  const abierto = await abrir(tA1.token)
  check('un token de activo abre la ficha del ACTIVO, no la de un punto',
    abierto.ok === true && abierto.objeto === 'ACTIVO'
      && abierto.activo?.nombre === 'Bomba de presión 1'
      && abierto.activo?.sedeNombre === 'ZZ Sede F6 A',
    abierto.ok ? `${abierto.objeto} · ${abierto.activo.nombre}` : abierto.motivo)
  check('con el tipo y el lugar resueltos',
    abierto.ok === true && abierto.activo.tipo === 'Bomba de agua'
      && /Sótano 2/.test(abierto.activo.lugar ?? ''),
    abierto.ok ? `${abierto.activo.tipo} · ${abierto.activo.lugar}` : '')
  const evAp = await ultimoEvento(qrA1.id)
  check('y deja el evento APERTURA como anónimo por el canal público, con el código del activo',
    evAp.accion === 'APERTURA' && evAp.actor_tipo === 'ANONIMO'
      && evAp.canal === 'PUBLICO' && evAp.activo === a1.codigo)

  const manual = await abrir(QR.formatearManual(qrA1.codigo_manual))
  check('el código manual impreso bajo el QR abre el MISMO activo, marcado como manual',
    manual.ok === true && manual.objeto === 'ACTIVO'
      && manual.activo.id === a1.id && manual.aperturaModo === 'MANUAL')

  const falsificado = tA1.token.slice(0, 20) + (tA1.token[20] === 'Z' ? 'Y' : 'Z')
  const falso = await abrir(falsificado)
  check('un token con la firma alterada no abre nada',
    falso.ok === false && falso.motivo === 'NO_EXISTE', falso.motivo)

  // Una placa de activo firmada con el UUID del PUNTO: existe la fila, la firma
  // no corresponde al objeto. Es el caso que la F6 tenía que cerrar.
  const { rows: [a3] } = await c.query(`
    INSERT INTO activos (sede_id, grupo_id, nombre, codigo)
    VALUES ($1,$1,'Puerta del parqueadero','ZZ-PUERTA') RETURNING id, clave_publica`, [s1])
  const tCruzado = armar(pt1.id, a3.clave_publica, 1)   // firmado sobre el PUNTO
  await insertarQrActivo(a3.id, tCruzado.token)
  const cruzado = await abrir(tCruzado.token)
  check('una placa de activo firmada con el UUID de un punto se rechaza por firma',
    cruzado.ok === false && cruzado.motivo === 'FIRMA_INVALIDA', cruzado.motivo)

  await c.query(`UPDATE activos SET estado='RETIRADO' WHERE id=$1`, [a1.id])
  const retirado = await abrir(tA1.token)
  check('un activo RETIRADO no abre, y con su propio motivo',
    retirado.ok === false && retirado.motivo === 'ACTIVO_RETIRADO', retirado.motivo)
  check('y el texto del rechazo habla de un equipo, no de un punto de control',
    /equipo/i.test(DECIDIR.TEXTO_RECHAZO.ACTIVO_RETIRADO.titulo))
  await c.query(`UPDATE activos SET estado='OPERATIVO' WHERE id=$1`, [a1.id])

  // La placa del PUNTO sigue funcionando y ahora lista los activos que están en
  // él (§2.1): un equipo donde ya hay placa no necesita placa propia.
  const tP1 = armar(pt1.id, pt1.clave_publica, 1)
  const { rows: [qrP1] } = await c.query(`
    INSERT INTO ronda_qr (tipo_objeto, punto_id, grupo_id, sede_id, version, token,
                          firma_llave_id, estado, instalado_canal, instalado_at)
    VALUES ('PUNTO', $1, $1, $1, 1, $2, $3, 'ACTIVO', 'CONSOLA', NOW()) RETURNING id`,
    [pt1.id, tP1.token, LLAVE_ID])
  const puntoAbierto = await abrir(tP1.token)
  check('la placa de un PUNTO sigue abriendo el punto (F2 no se rompió)',
    puntoAbierto.ok === true && puntoAbierto.objeto === 'PUNTO'
      && puntoAbierto.punto?.codigo === 'P-001',
    puntoAbierto.ok ? puntoAbierto.punto.codigo : puntoAbierto.motivo)
  check('y lista los activos que están en ese punto (§2.1)',
    puntoAbierto.ok === true && puntoAbierto.activos.some((x) => x.id === a1.id),
    puntoAbierto.ok ? puntoAbierto.activos.map((x) => x.codigo).join(' ') : '')

  // ── 8. Alcance por contrato (RLS) ─────────────────────────────────────────
  console.log('\n8) RLS: el alcance por contrato y los tres permisos')
  const { rows: [rolGestor] } = await c.query(`
    INSERT INTO roles (nombre, descripcion, rol_base, permisos)
    VALUES ('ZZ Prueba Activos', 'solo para la prueba', 'OPERADOR_SEDE',
            '{"ver_activos_ronda":true,"gestionar_activos_ronda":true}'::jsonb)
    RETURNING id`)
  const { rows: [rolVer] } = await c.query(`
    INSERT INTO roles (nombre, descripcion, rol_base, permisos)
    VALUES ('ZZ Prueba Activos Ver', 'solo para la prueba', 'OPERADOR_SEDE',
            '{"ver_activos_ronda":true}'::jsonb) RETURNING id`)
  const { rows: [rolLecturas] } = await c.query(`
    INSERT INTO roles (nombre, descripcion, rol_base, permisos)
    VALUES ('ZZ Prueba Lecturas', 'solo para la prueba', 'OPERADOR_SEDE',
            '{"registrar_lecturas_activos":true}'::jsonb) RETURNING id`)
  const { rows: [rolNada] } = await c.query(`
    INSERT INTO roles (nombre, descripcion, rol_base, permisos)
    VALUES ('ZZ Prueba Ciego', 'solo para la prueba', 'OPERADOR_SEDE',
            '{"ver_stock":true}'::jsonb) RETURNING id`)
  const nuevoUsuario = async (sufijo, grupoId, rolId) => (await c.query(`
    INSERT INTO usuarios (id, nombre, email, rol, rol_id, grupo_id, sede_id, activo)
    VALUES (gen_random_uuid(), $1, $2, 'OPERADOR_SEDE'::rol_usuario, $3, $4, NULL, true)
    RETURNING id`,
    [`ZZ Prueba F6 ${sufijo}`, `zz-f6-${sufijo}@example.invalid`, rolId, grupoId])).rows[0].id

  const uGestor   = await nuevoUsuario('gestor',   g1.id, rolGestor.id)
  const uLector   = await nuevoUsuario('lector',   g1.id, rolVer.id)
  const uTecnico  = await nuevoUsuario('tecnico',  g1.id, rolLecturas.id)
  const uOtro     = await nuevoUsuario('otro',     g2.id, rolGestor.id)
  const uCiego    = await nuevoUsuario('ciego',    g1.id, rolNada.id)

  const cuantosActivos = async () =>
    Number((await c.query(`SELECT count(*) n FROM activos`)).rows[0].n)

  await como(uGestor)
  const nGestor = await cuantosActivos()
  await comoDueno()
  check('el gestor del contrato A ve los activos de A y solo los de A',
    nGestor >= 3, String(nGestor))

  await como(uOtro)
  const { rows: delOtro } = await c.query(`SELECT id::text FROM activos WHERE id = $1`, [a1.id])
  await comoDueno()
  check('un usuario del contrato B NO ve un activo del contrato A', delOtro.length === 0)

  await como(uCiego)
  const nCiego = await cuantosActivos()
  await comoDueno()
  check('sin ninguna de las tres claves no ve NINGÚN activo (auth_permiso también al leer)',
    nCiego === 0, String(nCiego))

  await como(uLector)
  const lectorEscribe = await enSavepoint(() => c.query(
    `UPDATE activos SET nombre = 'cambiado por el lector' WHERE id = $1`, [a1.id]))
  const { rows: [lectorVe] } = await c.query(`SELECT count(*) n FROM activos WHERE id=$1`, [a1.id])
  await comoDueno()
  check('quien solo puede VER no escribe', Number(lectorVe.n) === 1
    && (!lectorEscribe.ok || lectorEscribe.r.rowCount === 0),
    lectorEscribe.error ?? `filas tocadas: ${lectorEscribe.r?.rowCount}`)

  await como(uTecnico)
  const tecnicoLee = await enSavepoint(() => c.query(`
    INSERT INTO activo_lecturas (medidor_id, activo_id, grupo_id, sede_id, valor, usuario_id)
    VALUES ($1,$1,$1,$1, 6000, $2) RETURNING id`, [med.id, uTecnico]))
  const tecnicoEdita = await enSavepoint(() => c.query(
    `UPDATE activos SET nombre='cambiado por el técnico' WHERE id=$1`, [a1.id]))
  const tecnicoBorraLectura = await enSavepoint(() => c.query(
    `DELETE FROM activo_lecturas WHERE id = $1`, [l1.id]))
  await comoDueno()
  check('quien solo registra lecturas SÍ puede registrar una', tecnicoLee.ok,
    tecnicoLee.error ?? 'entró')
  check('pero NO puede editar la ficha del activo',
    !tecnicoEdita.ok || tecnicoEdita.r.rowCount === 0,
    tecnicoEdita.error ?? `filas tocadas: ${tecnicoEdita.r?.rowCount}`)
  check('ni borrar una lectura (eso pide gestionar_activos_ronda)',
    !tecnicoBorraLectura.ok || tecnicoBorraLectura.r.rowCount === 0,
    tecnicoBorraLectura.error ?? `filas tocadas: ${tecnicoBorraLectura.r?.rowCount}`)

  await como(uGestor)
  const editarLectura = await enSavepoint(() => c.query(
    `UPDATE activo_lecturas SET valor = 99999 WHERE id = $1`, [l1.id]))
  await comoDueno()
  check('NADIE puede EDITAR una lectura: no hay política de UPDATE',
    !editarLectura.ok || editarLectura.r.rowCount === 0,
    editarLectura.error ?? `filas tocadas: ${editarLectura.r?.rowCount}`)

  await como(uGestor)
  const { rows: tiposQueVe } = await c.query(
    `SELECT codigo FROM activo_tipos WHERE codigo IN ('BOMBA','ZZ_PROPIO')`)
  await comoDueno()
  check('ve los tipos GENERALES y no el tipo propio de otro contrato',
    tiposQueVe.length === 1 && tiposQueVe[0].codigo === 'BOMBA',
    tiposQueVe.map((t) => t.codigo).join(' '))

  await como(uGestor)
  const { rows: docsQueVe } = await c.query(
    `SELECT id::text FROM activo_documentos WHERE id = $1`, [doc.id])
  await comoDueno()
  check('y los documentos del activo, que heredan el alcance por activo_id',
    docsQueVe.length === 1)

  await como(uOtro)
  const { rows: docsAjenos } = await c.query(
    `SELECT id::text FROM activo_documentos WHERE id = $1`, [doc.id])
  await comoDueno()
  check('un usuario de otro contrato NO ve esos documentos', docsAjenos.length === 0)

  await como(uGestor)
  const { rows: [puedeSubir] } = await c.query(
    `SELECT activo_archivo_puede_subir($1) s, activo_archivo_puede_ver($1) v`,
    [`activos/${a1.id}/otro.pdf`])
  await comoDueno()
  check('las políticas de storage dejan subir y ver en la carpeta de su activo',
    puedeSubir.s === true && puedeSubir.v === true)

  await como(uOtro)
  const { rows: [noPuede] } = await c.query(
    `SELECT activo_archivo_puede_subir($1) s, activo_archivo_puede_ver($1) v`,
    [`activos/${a1.id}/otro.pdf`])
  await comoDueno()
  check('y no en la de un activo de otro contrato',
    noPuede.s === false && noPuede.v === false)
} catch (e) {
  fail++
  console.error('\nERROR inesperado:', e.message)
  console.error(e.stack)
} finally {
  await c.query('ROLLBACK')
  await c.end()
}

console.log(`\n${ok} bien, ${fail} mal`)
process.exit(fail === 0 ? 0 : 1)

// Pruebas de la F5 del módulo de Puntos QR (PQRS por el mismo QR) contra la
// base REAL, dentro de una transacción que se revierte al final.
//
// Qué comprueba:
//   1. que el archivo de migración corra COMPLETO dos veces seguidas en la
//      misma transacción (idempotencia de verdad, no de lectura);
//   2. la estructura: `pqrs_categorias` con su alcance por contrato, las
//      columnas nuevas de `pqrs` y de `pqrs_bitacora`, el valor `QR` en el
//      CHECK del canal y el índice del `ip_hash`;
//   3. que el catálogo efectivo de un contrato sean sus categorías más las
//      generales que no haya reemplazado por código;
//   4. `pqrs_radicar_publica()` de punta a punta: lo que escribe, lo que
//      deriva (sede, contrato, zona, plazo en días hábiles) y lo que rechaza
//      —QR revocado, contrato vencido, punto retirado, contrato sin PQRS
//      pública, categoría de otro contrato, descripción vacía—;
//   5. el antispam: el tope por origen (`ip_hash`) y el tope por punto;
//   6. que la PQRS radicada así entre al módulo que ya existe: la ve quien
//      tiene `ver_pqrs` en esa sede por la RLS que ya estaba, con su punto y
//      su categoría legibles sin `ver_puntos_ronda`;
//   7. que el catálogo solo lo cambie quien tiene `parametrizar_pqrs`;
//   8. que la IP en claro NO quede en ninguna parte y que `ip_hash` sea el
//      mismo hash que calcula la aplicación (se importa lib/pqrs/publico.ts);
//   9. `pqrs_estado_publico()`: solo lo del canal QR, nunca una PQRS interna.
//
// NO aplica nada: todo va dentro de BEGIN … ROLLBACK.
//
// Uso (desde la raíz del worktree):
//   node --use-system-ca scripts/probar-puntos-qr-f5.mjs
import { createRequire } from 'module'
import { registerHooks } from 'node:module'
import { readFileSync, existsSync } from 'fs'
import { fileURLToPath, pathToFileURL } from 'url'
import { dirname, join, resolve } from 'path'

const require = createRequire(import.meta.url)
const { Client } = require('pg')

const __dirname = dirname(fileURLToPath(import.meta.url))
const raiz = join(__dirname, '..')

// Mismo gancho que las pruebas de F2: así se importan los módulos REALES de la
// aplicación en vez de copiar su lógica aquí.
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
const PUB = await import(pathToFileURL(join(libDir, 'pqrs', 'ip-hash.ts')).href)

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

const SQL_F5 = readFileSync(
  join(raiz, 'supabase', 'migrations', '20261028000500_puntos_qr_f5_pqrs.sql'), 'utf8')

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
const una = async (sql, args) => (await c.query(sql, args)).rows[0]

await c.query('BEGIN')
try {
  // ── 1. Idempotencia ───────────────────────────────────────────────────────
  console.log('\n1) Idempotencia (la migración completa, dos veces en la misma transacción)')
  await c.query(SQL_F5)
  check('primera pasada', true)
  await c.query(SQL_F5)
  check('segunda pasada sin error', true)

  // ── 2. Estructura ─────────────────────────────────────────────────────────
  console.log('\n2) Estructura (§4.6 y §2.4 del complemento 2)')
  const tabla = async (n) => (await c.query(`
    SELECT c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname='public' AND c.relname=$1`, [n])).rows[0]
  const cat = await tabla('pqrs_categorias')
  check('pqrs_categorias existe y con RLS activa', !!cat && cat.relrowsecurity === true)

  const col = async (t, x) => (await c.query(`
    SELECT data_type, is_nullable FROM information_schema.columns
     WHERE table_schema='public' AND table_name=$1 AND column_name=$2`, [t, x])).rows[0]
  for (const x of ['punto_id', 'zona_id', 'qr_id', 'categoria_id', 'ip_hash', 'satisfaccion', 'satisfaccion_at']) {
    check(`pqrs.${x} existe`, !!(await col('pqrs', x)))
  }
  check('pqrs.grupo_id sigue existiendo y nullable (la §2.4 dice que no se toca)',
    (await col('pqrs', 'grupo_id'))?.is_nullable === 'YES')
  check('pqrs_categorias.grupo_id es NULLABLE (NULL = aplica a todos los contratos)',
    (await col('pqrs_categorias', 'grupo_id'))?.is_nullable === 'YES')
  check('pqrs_bitacora gana canal y direccion',
    !!(await col('pqrs_bitacora', 'canal')) && !!(await col('pqrs_bitacora', 'direccion')))

  const { rows: canalChk } = await c.query(`
    SELECT pg_get_constraintdef(k.oid) d FROM pg_constraint k JOIN pg_class t ON t.oid=k.conrelid
     WHERE t.relname='pqrs' AND k.contype='c' AND pg_get_constraintdef(k.oid) ILIKE '%SEDE%'`)
  check("el canal de pqrs admite 'QR' sin perder los que ya había",
    canalChk.some((r) => /'QR'/.test(r.d) && /WHATSAPP/.test(r.d) && /PORTAL/.test(r.d)),
    canalChk.map((r) => r.d).join(' | '))

  const { rows: ix } = await c.query(`
    SELECT indexname, indexdef FROM pg_indexes
     WHERE schemaname='public' AND tablename='pqrs' AND indexname='idx_pqrs_ip_hash_fecha'`)
  check('existe el índice (ip_hash, created_at DESC) que hace baratos los conteos por hora',
    ix.length === 1 && /created_at DESC/i.test(ix[0].indexdef), ix[0]?.indexdef ?? 'no existe')

  const { rows: unicos } = await c.query(`
    SELECT indexname FROM pg_indexes WHERE schemaname='public' AND tablename='pqrs_categorias'
       AND indexname IN ('ux_pqrs_categorias_grupo','ux_pqrs_categorias_general')`)
  check('los dos índices únicos parciales del catálogo existen', unicos.length === 2)

  const { rows: semilla } = await c.query(`
    SELECT codigo FROM pqrs_categorias WHERE grupo_id IS NULL ORDER BY orden`)
  check('las seis categorías de §6.2 vienen sembradas como catálogo general',
    semilla.length >= 6 && ['LIMPIEZA', 'INSUMOS', 'OLORES', 'BASURAS', 'DANO', 'OTRO']
      .every((k) => semilla.some((s) => s.codigo === k)),
    semilla.map((s) => s.codigo).join(','))

  const dosGenerales = await enSavepoint(() => c.query(`
    INSERT INTO pqrs_categorias (grupo_id, codigo, nombre) VALUES (NULL, 'LIMPIEZA', 'Repetida')`))
  check('no se pueden sembrar dos categorías generales con el mismo código', !dosGenerales.ok)

  // ── 3. Datos de prueba ────────────────────────────────────────────────────
  console.log('\n3) Un contrato, una sede, un punto y su placa')
  const nuevoContrato = async (codigo, nombre) => (await una(`
    INSERT INTO grupos_contrato (codigo, nombre, estado, vigencia_desde, vigencia_hasta)
    VALUES ($1, $2, 'VIGENTE', CURRENT_DATE - 30, CURRENT_DATE + 30) RETURNING id`, [codigo, nombre])).id
  const gA = await nuevoContrato('ZZF5A', 'Contrato de prueba F5 A')
  const gB = await nuevoContrato('ZZF5B', 'Contrato de prueba F5 B')
  const nuevaSede = async (grupo, nombre) => (await una(`
    INSERT INTO sedes (grupo_id, nombre, ciudad, lat, lng) VALUES ($1,$2,'BOGOTÁ D.C.',4.65,-74.05)
    RETURNING id`, [grupo, nombre])).id
  const sA = await nuevaSede(gA, 'ZZ Sede de prueba F5 A')
  const sB = await nuevaSede(gB, 'ZZ Sede de prueba F5 B')

  const zA = (await una(`
    INSERT INTO ronda_zonas (sede_id, grupo_id, codigo, nombre, piso)
    VALUES ($1, $1, 'T1-P3', 'Torre A — piso 3', 'PISO 3') RETURNING id`, [sA])).id
  const punto = await una(`
    INSERT INTO ronda_puntos (sede_id, grupo_id, zona_id, codigo, nombre, estado, lat, lng, precision_metros)
    VALUES ($1, $1, $2, 'P-010', 'Baño social piso 3', 'ACTIVO', 4.6501, -74.0509, 8.0)
    RETURNING id, grupo_id::text, clave_publica, zona_id::text`, [sA, zA])
  const puntoB = await una(`
    INSERT INTO ronda_puntos (sede_id, grupo_id, codigo, nombre, estado)
    VALUES ($1, $1, 'P-010', 'Punto del otro contrato', 'ACTIVO')
    RETURNING id, grupo_id::text, clave_publica`, [sB])

  const armar = (p, version) => FIRMA.armarToken({
    clavePublica: p.clave_publica, puntoId: p.id, version, llaveId: LLAVE_ID, secreto: SECRETO,
  }).token
  const insertarQr = (p, sede, token, estado = 'ACTIVO', version = null) => c.query(`
    INSERT INTO ronda_qr (tipo_objeto, punto_id, grupo_id, sede_id, version, token,
                          firma_llave_id, estado, instalado_canal, instalado_at)
    VALUES ('PUNTO', $1, $2, $3, $4, $5, $6, $7, 'CONSOLA', NOW())
    RETURNING id, codigo_manual, version`, [p.id, p.grupo_id, sede, version, token, LLAVE_ID, estado])

  const tokenA = armar(punto, 1)
  const qrA = (await insertarQr(punto, sA, tokenA)).rows[0]
  const qrB = (await insertarQr(puntoB, sB, armar(puntoB, 1))).rows[0]
  check('la placa del punto quedó activa, con su código manual tecleable',
    QR.esCodigoManual(qrA.codigo_manual), qrA.codigo_manual)

  // ── 4. El catálogo efectivo de un contrato ────────────────────────────────
  console.log('\n4) Catálogo por contrato: lo propio manda sobre lo general')
  const generales = (await c.query(`SELECT count(*)::int n FROM pqrs_categorias WHERE grupo_id IS NULL AND activo`)).rows[0].n
  const { rows: catA } = await c.query(`SELECT * FROM pqrs_categorias_de($1)`, [gA])
  check('sin categorías propias, el contrato ve exactamente las generales',
    catA.length === generales, `${catA.length} de ${generales}`)

  await c.query(`
    INSERT INTO pqrs_categorias (grupo_id, codigo, nombre, tipo_sugerido, prioridad_sugerida, orden)
    VALUES ($1, 'LIMPIEZA', 'Aseo (reglas del contrato)', 'RECLAMO', 'CRITICA', 5)`, [gA])
  const { rows: catA2 } = await c.query(`SELECT * FROM pqrs_categorias_de($1)`, [gA])
  const limpieza = catA2.find((x) => x.codigo === 'LIMPIEZA')
  check('la categoría del contrato REEMPLAZA a la general del mismo código',
    catA2.length === generales && limpieza?.propia === true && limpieza?.prioridad_sugerida === 'CRITICA',
    `${catA2.length} categorías · ${limpieza?.nombre}`)
  const { rows: catB } = await c.query(`SELECT * FROM pqrs_categorias_de($1)`, [gB])
  check('y el otro contrato sigue viendo la general, no la del vecino',
    catB.find((x) => x.codigo === 'LIMPIEZA')?.propia === false)

  const catOtro = catB.find((x) => x.codigo === 'OTRO')
  const catLimpiezaA = limpieza
  const catPropiaB = (await una(`
    INSERT INTO pqrs_categorias (grupo_id, codigo, nombre) VALUES ($1, 'SOLO_B', 'Solo del contrato B')
    RETURNING id`, [gB])).id

  // ── 5. Radicar desde el QR ────────────────────────────────────────────────
  console.log('\n5) pqrs_radicar_publica(): el contrato tiene que tener la PQRS pública encendida')
  const radicar = (args = {}) => c.query(`
    SELECT * FROM pqrs_radicar_publica($1, $2, $3, $4, $5, $6, $7, $8)`, [
    args.codigo ?? tokenA,
    args.categoria ?? catLimpiezaA.id,
    args.asunto ?? null,
    args.descripcion ?? 'El baño del piso 3 está sin aseo desde ayer y huele muy mal.',
    args.anonima ?? true,
    JSON.stringify(args.solicitante ?? {}),
    args.ipHash ?? null,
    args.modo ?? 'QR',
  ])

  const sinRegla = await enSavepoint(() => radicar())
  check('sin fila de reglas NO se recibe nada (el valor por defecto es "no")',
    !sinRegla.ok && /no recibe PQRS/i.test(sinRegla.error || ''), sinRegla.error ?? 'pasó')

  await c.query(`INSERT INTO grupo_reglas (grupo_id, pqrs_publico) VALUES ($1, false)
                 ON CONFLICT (grupo_id) DO UPDATE SET pqrs_publico = false`, [gA])
  const apagada = await enSavepoint(() => radicar())
  check('con pqrs_publico = false tampoco', !apagada.ok)

  await c.query(`UPDATE grupo_reglas SET pqrs_publico = true WHERE grupo_id = $1`, [gA])
  await c.query(`INSERT INTO grupo_reglas (grupo_id, pqrs_publico) VALUES ($1, true)
                 ON CONFLICT (grupo_id) DO UPDATE SET pqrs_publico = true`, [gB])

  const ipHashA = PUB.hashDeIp('190.10.20.30', 'sal-de-prueba')
  const { rows: [p1] } = await radicar({ ipHash: ipHashA })
  check('con la PQRS pública encendida se radica y sale con número PQ-…',
    /^PQ-\d{5}$/.test(p1.numero), p1.numero)
  check('el canal es QR', p1.canal === 'QR')
  check('queda atada al punto, a la zona y a la placa exacta que se escaneó',
    p1.punto_id === punto.id && p1.zona_id === punto.zona_id && p1.qr_id === qrA.id)
  check('y al CONTRATO y la sede correctos, derivados por el trigger que ya existía',
    p1.sede_id === sA && p1.grupo_id === gA)
  check('nace RADICADA, anónima y sin responsable',
    p1.estado === 'RADICADA' && p1.anonima === true && p1.responsable_id === null)
  check('toma el tipo y la prioridad que sugiere la categoría del contrato',
    p1.tipo === 'RECLAMO' && p1.prioridad === 'CRITICA', `${p1.tipo}/${p1.prioridad}`)
  check('el plazo es el de pqrs_plazos para ese tipo, en días hábiles',
    Number(p1.dias_plazo) === (await una(`SELECT dias_habiles d FROM pqrs_plazos WHERE tipo='RECLAMO'`)).d)
  check('la fecha límite cae en día hábil (ni sábado ni domingo)',
    (await una(`SELECT EXTRACT(ISODOW FROM $1::date)::int d`, [p1.fecha_limite])).d <= 5)
  check('el asunto se arma solo con la categoría y el punto si no lo mandan',
    /Aseo \(reglas del contrato\)/.test(p1.asunto) && /Baño social piso 3/.test(p1.asunto), p1.asunto)
  check('el punto y la categoría quedan desnormalizados: /pqrs los muestra sin ver_puntos_ronda',
    /P-010/.test(p1.punto_nombre || '') && p1.categoria_nombre === 'Aseo (reglas del contrato)',
    `${p1.punto_nombre} · ${p1.categoria_nombre}`)
  check('radicada_nombre dice por dónde entró, porque no hay usuario que la radicara',
    p1.radicada_por === null && /QR/.test(p1.radicada_nombre || ''), p1.radicada_nombre)

  const { rows: bita } = await c.query(`
    SELECT tipo, canal, direccion, mensaje FROM pqrs_bitacora WHERE pqrs_id=$1 ORDER BY created_at`, [p1.id])
  check('deja el mensaje de SISTEMA de la radicación, como canal QR y ENTRADA',
    bita.length === 1 && bita[0].tipo === 'SISTEMA' && bita[0].canal === 'QR'
      && bita[0].direccion === 'ENTRADA' && /P-010/.test(bita[0].mensaje),
    bita[0]?.mensaje?.slice(0, 80))

  const { rows: [ev] } = await c.query(`
    SELECT accion, actor_tipo, canal, detalle FROM ronda_eventos
     WHERE entidad='pqrs' AND entidad_id=$1`, [p1.id])
  check('y el escaneo que terminó en PQRS queda en la auditoría del módulo de puntos',
    ev?.accion === 'PQRS_RADICADA' && ev.actor_tipo === 'ANONIMO' && ev.canal === 'PUBLICO'
      && ev.detalle.punto === 'P-010', JSON.stringify(ev?.detalle ?? {}))

  // El motor de notificaciones: se reutiliza el evento PQRS_RADICADA que ya
  // existía, no se inventa uno nuevo. `emitir_evento()` solo encola si hay un
  // flujo configurado para el código; lo que esta prueba comprueba es que el
  // código existe, está activo y que notificar no tumbó la radicación.
  const { rows: [evNotif] } = await c.query(`
    SELECT activo, modulo FROM eventos_notificacion WHERE codigo='PQRS_RADICADA'`)
  check('el evento PQRS_RADICADA del módulo de PQRS sigue siendo el único, y activo',
    evNotif?.activo === true && evNotif.modulo === 'PQRS')
  const { rows: [eventosPqrs] } = await c.query(`
    SELECT count(*)::int n FROM eventos_notificacion WHERE modulo='PQRS'`)
  check('y F5 no agregó un evento aparte para lo que entra por el QR',
    eventosPqrs.n === 2, `${eventosPqrs.n} eventos del módulo PQRS`)

  // Con nombre, no anónima.
  const { rows: [p2] } = await radicar({
    anonima: false,
    solicitante: { nombre: 'Residente de prueba', calidad: 'PROPIETARIO', telefono: '3000000000', email: 'zz@example.invalid' },
    categoria: catA2.find((x) => x.codigo === 'BASURAS').id,
    descripcion: 'Las canecas del shut están desbordadas desde el fin de semana.',
    modo: 'MANUAL',
    codigo: qrA.codigo_manual,
  })
  check('también sirve el código TECLEADO de la placa, y queda marcado como manual',
    p2.canal === 'QR' && /tecleado/i.test(p2.radicada_nombre || ''), p2.radicada_nombre)
  check('si no es anónima, guarda nombre, calidad, teléfono y correo',
    p2.anonima === false && p2.solicitante_nombre === 'Residente de prueba'
      && p2.solicitante_calidad === 'PROPIETARIO' && p2.solicitante_telefono === '3000000000')

  // El código impreso se lee en dos grupos de cuatro: «7PP6-WNGB». El guion no
  // puede hacer que falle lo que la página sí abrió.
  const conGuion = await enSavepoint(() => radicar({
    codigo: `${qrA.codigo_manual.slice(0, 4)}-${qrA.codigo_manual.slice(4)}`,
    modo: 'MANUAL',
    descripcion: 'Probando que el guion del código impreso no estorbe.',
  }))
  check('el guion del código impreso no estorba', conGuion.ok, conGuion.error ?? '')

  // ── 6. Lo que rechaza ─────────────────────────────────────────────────────
  console.log('\n6) Lo que NO entra')
  const casos = [
    ['un código que no existe', { codigo: '1ZZZZZZZZ01ZZZZZZZZZZ' }, /ningún punto/i],
    ['un código vacío', { codigo: '' }, /Falta el código/i],
    ['una descripción vacía', { descripcion: '   ' }, /qué pasó/i],
    ['una descripción de tres letras', { descripcion: 'eso' }, /un poco más/i],
    ['no anónima sin nombre', { anonima: false }, /nombre/i],
    ['una categoría de OTRO contrato', { categoria: catPropiaB }, /de qué se trata/i],
    ['una categoría inventada', { categoria: '00000000-0000-0000-0000-000000000000' }, /de qué se trata/i],
    ['una calidad de solicitante inventada',
      { anonima: false, solicitante: { nombre: 'X', calidad: 'ALCALDE' } }, /[Cc]alidad/],
  ]
  for (const [titulo, args, patron] of casos) {
    const r = await enSavepoint(() => radicar(args))
    check(`se rechaza ${titulo}`, !r.ok && patron.test(r.error || ''), r.error ?? 'pasó')
  }

  // La categoría general que el contrato reemplazó ya no se puede elegir: es
  // así como se "apaga" una categoría sin tocar el catálogo de todos.
  const generalReemplazada = (await una(`
    SELECT id FROM pqrs_categorias WHERE grupo_id IS NULL AND codigo='LIMPIEZA'`)).id
  const reemplazada = await enSavepoint(() => radicar({ categoria: generalReemplazada }))
  check('la categoría general que el contrato reemplazó ya no se puede elegir', !reemplazada.ok)

  const inactiva = (await una(`
    INSERT INTO pqrs_categorias (grupo_id, codigo, nombre, activo) VALUES ($1,'APAGADA','Apagada',false)
    RETURNING id`, [gA])).id
  const conInactiva = await enSavepoint(() => radicar({ categoria: inactiva }))
  check('una categoría inactiva tampoco', !conInactiva.ok)

  // Estado del QR y del punto, y vigencia del contrato: la misma puerta que /q.
  await c.query(`SAVEPOINT estados`)
  await c.query(`UPDATE ronda_qr SET estado='REVOCADO', revocado_at=NOW() WHERE id=$1`, [qrA.id])
  const revocado = await enSavepoint(() => radicar())
  check('un QR revocado no recibe PQRS (la placa ya no está en uso)',
    !revocado.ok && /no está en uso/i.test(revocado.error || ''), revocado.error ?? 'pasó')
  await c.query(`ROLLBACK TO SAVEPOINT estados`)

  await c.query(`UPDATE ronda_puntos SET estado='RETIRADO' WHERE id=$1`, [punto.id])
  const retirado = await enSavepoint(() => radicar())
  check('un punto retirado tampoco, aunque su placa siga pegada',
    !retirado.ok && /retirado/i.test(retirado.error || ''), retirado.error ?? 'pasó')
  await c.query(`ROLLBACK TO SAVEPOINT estados`)

  await c.query(`UPDATE grupos_contrato SET vigencia_hasta = CURRENT_DATE - 1 WHERE id=$1`, [gA])
  const vencido = await enSavepoint(() => radicar())
  check('un contrato vencido apaga la radicación por su QR, sin tocar ninguna fila',
    !vencido.ok && /no está vigente/i.test(vencido.error || ''), vencido.error ?? 'pasó')
  await c.query(`ROLLBACK TO SAVEPOINT estados`)
  await c.query(`RELEASE SAVEPOINT estados`)

  const sigueSirviendo = await enSavepoint(() => radicar())
  check('y al revertir todo vuelve a recibir (nada quedó marcado)', sigueSirviendo.ok)

  // ── 7. Antispam ───────────────────────────────────────────────────────────
  console.log('\n7) Antispam: tope por origen y tope por punto')
  const { rows: [cupo0] } = await c.query(`SELECT * FROM pqrs_publica_cupo($1,$2)`, [ipHashA, punto.id])
  check('los topes son 5 por origen y 10 por punto en una hora',
    cupo0.tope_origen === 5 && cupo0.tope_punto === 10, `${cupo0.tope_origen}/${cupo0.tope_punto}`)

  await c.query(`SAVEPOINT antispam`)
  const ipTope = PUB.hashDeIp('10.1.1.1', 'sal-de-prueba')
  let hastaQue = 0
  for (let i = 0; i < 6; i++) {
    const r = await enSavepoint(() => radicar({ ipHash: ipTope, descripcion: `Reporte número ${i} de la prueba de tope.` }))
    if (!r.ok) { hastaQue = i; break }
    hastaQue = i + 1
  }
  check('el mismo origen no pasa de 5 radicaciones por hora', hastaQue === 5, `pasaron ${hastaQue}`)
  await c.query(`ROLLBACK TO SAVEPOINT antispam`)
  await c.query(`RELEASE SAVEPOINT antispam`)

  await c.query(`SAVEPOINT antispam2`)
  // Sin ip_hash (despliegue sin sal): el límite que protege es el del PUNTO.
  let porPunto = (await una(`SELECT * FROM pqrs_publica_cupo(NULL,$1)`, [punto.id])).por_punto
  let tope = 0
  for (let i = porPunto; i < 12; i++) {
    const r = await enSavepoint(() => radicar({ descripcion: `Otro reporte del mismo punto, el ${i}.` }))
    if (!r.ok) { tope = i; break }
  }
  check('un punto no acumula más de 10 reportes por QR en una hora, aunque no haya ip_hash',
    tope === 10, `se frenó en ${tope}`)
  const { rows: [cupoSinIp] } = await c.query(`SELECT * FROM pqrs_publica_cupo(NULL,$1)`, [punto.id])
  check('y sin ip_hash el conteo por origen es 0, no el total de la tabla',
    cupoSinIp.por_origen === 0)
  await c.query(`ROLLBACK TO SAVEPOINT antispam2`)
  await c.query(`RELEASE SAVEPOINT antispam2`)

  // ── 8. La IP nunca en claro, y el hash es el de la aplicación ─────────────
  console.log('\n8) ip_hash: 64 hex, el mismo que calcula la aplicación, y ninguna IP en claro')
  check('hashDeIp devuelve 64 caracteres hex', /^[0-9a-f]{64}$/.test(ipHashA), ipHashA)
  check('el mismo par (IP, sal) da el mismo hash', PUB.hashDeIp('190.10.20.30', 'sal-de-prueba') === ipHashA)
  check('otra sal da otro hash', PUB.hashDeIp('190.10.20.30', 'otra-sal') !== ipHashA)
  check('otra IP da otro hash', PUB.hashDeIp('190.10.20.31', 'sal-de-prueba') !== ipHashA)
  const { rows: [enClaro] } = await c.query(`
    SELECT count(*)::int n FROM pqrs
     WHERE canal='QR' AND (ip_hash LIKE '%.%' OR ip_hash LIKE '%:%')`)
  check('ninguna fila guardó algo con forma de IP en ip_hash', enClaro.n === 0)

  // ── 9. Entra al módulo que ya existe ──────────────────────────────────────
  console.log('\n9) La PQRS del QR entra al módulo de /pqrs, con la RLS que ya estaba')
  const rolSede = (await una(`
    INSERT INTO roles (nombre, descripcion, rol_base, permisos)
    VALUES ('ZZ Prueba F5 Conserje', 'solo para la prueba', 'OPERADOR_SEDE',
            '{"ver_pqrs":true,"gestionar_pqrs":true}'::jsonb) RETURNING id`)).id
  const rolParam = (await una(`
    INSERT INTO roles (nombre, descripcion, rol_base, permisos)
    VALUES ('ZZ Prueba F5 Parametriza', 'solo para la prueba', 'ADMIN',
            '{"ver_pqrs":true,"gestionar_pqrs":true,"parametrizar_pqrs":true}'::jsonb) RETURNING id`)).id
  const nuevoUsuario = async (sufijo, rol, rolId, sede) => (await una(`
    INSERT INTO usuarios (id, nombre, email, rol, rol_id, sede_id, activo)
    VALUES (gen_random_uuid(), $1, $2, $3::rol_usuario, $4, $5, true) RETURNING id`,
    [`ZZ Prueba F5 ${sufijo}`, `zz-f5-${sufijo}@example.invalid`, rol, rolId, sede])).id
  const uSede = await nuevoUsuario('conserje', 'OPERADOR_SEDE', rolSede, sA)
  const uOtraSede = await nuevoUsuario('otra-sede', 'OPERADOR_SEDE', rolSede, sB)
  const uParam = await nuevoUsuario('parametriza', 'ADMIN', rolParam, sA)

  await como(uSede)
  const { rows: ve } = await c.query(`
    SELECT numero, punto_nombre, categoria_nombre, canal FROM pqrs WHERE id=$1`, [p1.id])
  check('el conserje de esa sede ve la PQRS del QR en su listado, con punto y categoría',
    ve.length === 1 && /P-010/.test(ve[0].punto_nombre || '') && ve[0].canal === 'QR')
  const { rows: catVe } = await c.query(`SELECT count(*)::int n FROM pqrs_categorias`)
  check('y puede LEER el catálogo (lo necesita para radicar desde la consola)', catVe[0].n > 0)
  const escribeCat = await enSavepoint(() => c.query(`
    INSERT INTO pqrs_categorias (grupo_id, codigo, nombre) VALUES (NULL,'NO_DEBERIA','No debería')`))
  check('pero NO puede cambiarlo sin parametrizar_pqrs', !escribeCat.ok)
  await comoDueno()

  await como(uOtraSede)
  const { rows: noVe } = await c.query(`SELECT numero FROM pqrs WHERE id=$1`, [p1.id])
  check('el conserje de OTRA sede no la ve (el alcance por sede sigue intacto)', noVe.length === 0)
  await comoDueno()

  await como(uParam)
  const escribeOk = await enSavepoint(() => c.query(`
    INSERT INTO pqrs_categorias (grupo_id, codigo, nombre) VALUES ($1,'NUEVA','Nueva del contrato')`, [gA]))
  check('quien tiene parametrizar_pqrs sí cambia el catálogo', escribeOk.ok, escribeOk.error ?? '')
  const radicarDirecto = await enSavepoint(() => c.query(`
    SELECT pqrs_radicar_publica($1,$2,NULL,$3)`, [tokenA, catOtro.id, 'Intento desde una sesión normal.']))
  check('y la RPC pública NO está al alcance de un usuario con sesión (es del servidor)',
    !radicarDirecto.ok && /permission denied|no existe|does not exist/i.test(radicarDirecto.error || ''),
    radicarDirecto.error ?? 'pasó')
  await comoDueno()

  // El flujo completo del módulo sigue funcionando sobre una PQRS del QR.
  // El rol_base del ROL manda: el trigger de 20240105000000_roles_dinamicos
  // sincroniza `usuarios.rol` desde `roles.rol_base`, y `pqrs_coordina()` mira
  // esa columna. Un usuario "SUPERVISOR" con un rol OPERADOR_SEDE no coordina.
  const rolCoord = (await una(`
    INSERT INTO roles (nombre, descripcion, rol_base, permisos)
    VALUES ('ZZ Prueba F5 Coordina', 'solo para la prueba', 'SUPERVISOR',
            '{"ver_pqrs":true,"gestionar_pqrs":true}'::jsonb) RETURNING id`)).id
  const uCoord = await nuevoUsuario('coordina', 'SUPERVISOR', rolCoord, sA)
  await como(uCoord)
  const tramite = await enSavepoint(() => c.query(`
    SELECT pqrs_cambiar_estado($1,'EN_TRAMITE','Tomada desde la consola.')`, [p1.id]))
  check('coordinación la toma y la atiende como cualquier otra PQRS', tramite.ok, tramite.error ?? '')
  const responder = await enSavepoint(() => c.query(`
    SELECT pqrs_cambiar_estado($1,'RESPONDIDA','Se hizo el aseo y se repuso el insumo.')`, [p1.id]))
  check('y la responde (el plazo, la bitácora y los estados son los que ya existían)',
    responder.ok, responder.error ?? '')
  await comoDueno()

  // ── 10. Seguimiento público del radicado ──────────────────────────────────
  console.log('\n10) pqrs_estado_publico(): solo lo del canal QR')
  const { rows: seg } = await c.query(`SELECT * FROM pqrs_estado_publico($1)`, [p1.numero])
  check('devuelve el estado, la categoría, el punto y la respuesta de su radicado',
    seg.length === 1 && seg[0].numero === p1.numero && /P-010/.test(seg[0].punto || ''),
    `${seg[0]?.estado} · ${seg[0]?.categoria}`)
  check('en minúsculas o con espacios también encuentra el radicado',
    (await c.query(`SELECT * FROM pqrs_estado_publico($1)`, [` ${p1.numero.toLowerCase()} `])).rows.length === 1)

  const interna = await una(`
    INSERT INTO pqrs (numero, tipo, canal, sede_id, asunto, descripcion, dias_plazo, fecha_limite, anonima)
    VALUES ('PQ-ZZ999','QUEJA','SEDE',$1,'Interna de prueba','Interna',15,CURRENT_DATE+20,true)
    RETURNING numero`, [sA])
  const { rows: fuga } = await c.query(`SELECT * FROM pqrs_estado_publico($1)`, [interna.numero])
  check('una PQRS interna NO se puede consultar por el enlace público', fuga.length === 0)

} finally {
  await c.query('ROLLBACK')
  await c.end()
}

console.log(`\n${ok} pruebas bien, ${fail} mal. Todo revertido con ROLLBACK: la base queda igual.`)
process.exit(fail > 0 ? 1 : 0)
